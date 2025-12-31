import os
import threading
import time
import base64
from dataclasses import dataclass
from typing import Optional, Union
from urllib.error import URLError, HTTPError
from urllib.request import Request, urlopen

import cv2
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from starlette.responses import Response, StreamingResponse

try:
    import pytesseract
except Exception:
    pytesseract = None

try:
    from PIL import Image
except Exception:
    Image = None

try:
    import numpy as np
except Exception:
    np = None


def _parse_source(value: str) -> Union[int, str]:
    value = value.strip()
    if value.isdigit():
        return int(value)
    return value


def _is_http_url(value: Union[int, str]) -> bool:
    return isinstance(value, str) and (value.startswith("http://") or value.startswith("https://"))


def _derive_snapshot_url(source_url: str) -> str:
    # If the user points at a MJPEG endpoint like /video, assume snapshots are at /snapshots.
    if source_url.rstrip("/").endswith("/video"):
        return source_url.rstrip("/")[:-len("/video")] + "/snapshots"
    return source_url


def _looks_like_mjpeg_endpoint(source_url: str) -> bool:
    url = source_url.rstrip("/")
    return url.endswith("/video") or url.endswith("/stream") or url.endswith("/mjpeg")


def _iter_jpegs_from_mjpeg(url: str, timeout_sec: float = 5.0):
    # Very small MJPEG parser: scans for JPEG SOI/EOI markers.
    # Works for typical multipart/x-mixed-replace streams.
    req = Request(url, headers={"User-Agent": "camera-proxy/1.0", "Cache-Control": "no-cache"})
    with urlopen(req, timeout=timeout_sec) as resp:
        buffer = bytearray()
        while True:
            chunk = resp.read(4096)
            if not chunk:
                raise RuntimeError("MJPEG stream ended")
            buffer.extend(chunk)

            # Find a complete JPEG in the buffer.
            start = buffer.find(b"\xff\xd8")
            if start == -1:
                # Keep buffer bounded.
                if len(buffer) > 2_000_000:
                    del buffer[:-1024]
                continue

            end = buffer.find(b"\xff\xd9", start + 2)
            if end == -1:
                # Wait for more bytes.
                if start > 0:
                    del buffer[:start]
                continue

            jpeg = bytes(buffer[start : end + 2])
            del buffer[: end + 2]
            yield jpeg


@dataclass
class CameraState:
    source: Union[int, str]
    fps: float
    jpeg_quality: int
    snapshot_url: Optional[str] = None
    idle_stop_sec: float = 5.0
    running: bool = False
    last_jpeg: Optional[bytes] = None
    last_frame_time: float = 0.0
    last_error: Optional[str] = None
    client_count: int = 0
    last_client_time: float = 0.0
    _lock: threading.Lock = threading.Lock()
    _stop: threading.Event = threading.Event()
    _thread: Optional[threading.Thread] = None


def _camera_worker(state: CameraState) -> None:
    frame_delay = 1.0 / max(state.fps, 0.1)

    # Mode A: HTTP snapshot polling (reliable for browsers + cameras that don't like OpenCV MJPEG)
    if _is_http_url(state.source):
        source_url = str(state.source)

        # If the user provided an explicit snapshot URL, always poll it.
        # Otherwise, if the source looks like an MJPEG endpoint, parse frames from it.
        use_mjpeg = state.snapshot_url is None and _looks_like_mjpeg_endpoint(source_url)

        snapshot_url = state.snapshot_url or _derive_snapshot_url(source_url)
        while not state._stop.is_set():
            with state._lock:
                idle = state.client_count <= 0 and (time.time() - state.last_client_time) > state.idle_stop_sec
            if idle:
                break
            try:
                if use_mjpeg:
                    for jpeg in _iter_jpegs_from_mjpeg(source_url, timeout_sec=5.0):
                        with state._lock:
                            state.last_jpeg = jpeg
                            state.last_frame_time = time.time()
                            state.last_error = None
                        if state._stop.is_set():
                            break
                        with state._lock:
                            idle = state.client_count <= 0 and (time.time() - state.last_client_time) > state.idle_stop_sec
                        if idle:
                            break
                        time.sleep(frame_delay)
                else:
                    url = f"{snapshot_url}?t={int(time.time() * 1000)}"
                    req = Request(url, headers={"User-Agent": "camera-proxy/1.0", "Cache-Control": "no-cache"})
                    with urlopen(req, timeout=3) as resp:
                        content_type = resp.headers.get("Content-Type", "")
                        jpeg = resp.read()
                    if not jpeg:
                        raise RuntimeError("Empty snapshot response")
                    if "image" not in content_type and not jpeg.startswith(b"\xff\xd8"):
                        raise RuntimeError(f"Snapshot did not look like JPEG (Content-Type={content_type!r})")

                    with state._lock:
                        state.last_jpeg = jpeg
                        state.last_frame_time = time.time()
                        state.last_error = None
            except (HTTPError, URLError, TimeoutError) as exc:
                with state._lock:
                    state.last_error = str(exc)
                time.sleep(0.5)
            except Exception as exc:
                with state._lock:
                    state.last_error = str(exc)
                time.sleep(0.5)

            if not use_mjpeg:
                time.sleep(frame_delay)
        return

    # Mode B: OpenCV capture (webcam/file/rtsp/etc)
    encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), int(state.jpeg_quality)]

    cap: Optional[cv2.VideoCapture] = None
    try:
        while not state._stop.is_set():
            with state._lock:
                idle = state.client_count <= 0 and (time.time() - state.last_client_time) > state.idle_stop_sec
            if idle:
                break
            if cap is None or not cap.isOpened():
                if cap is not None:
                    try:
                        cap.release()
                    except Exception:
                        pass
                    cap = None

                cap = cv2.VideoCapture(state.source)
                if not cap.isOpened():
                    with state._lock:
                        state.last_error = f"Could not open camera source: {state.source!r}"
                    time.sleep(1.0)
                    continue

            ok, frame = cap.read()
            if not ok or frame is None:
                with state._lock:
                    state.last_error = "Failed to read frame from source"
                time.sleep(0.2)
                continue

            ok_enc, buf = cv2.imencode(".jpg", frame, encode_params)
            if not ok_enc:
                with state._lock:
                    state.last_error = "Failed to JPEG-encode frame"
                time.sleep(0.1)
                continue

            with state._lock:
                state.last_jpeg = buf.tobytes()
                state.last_frame_time = time.time()
                state.last_error = None

            time.sleep(frame_delay)

    except Exception as exc:
        with state._lock:
            state.last_error = str(exc)
    finally:
        with state._lock:
            state.running = False
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass


def _start_camera(state: CameraState) -> None:
    if state.running:
        return
    state._stop.clear()
    with state._lock:
        state.running = True
        state.last_client_time = time.time()
    state._thread = threading.Thread(target=_camera_worker, args=(state,), daemon=True)
    state._thread.start()


def _stop_camera(state: CameraState) -> None:
    if not state.running:
        return
    state._stop.set()
    state.running = False


def _touch_client(state: CameraState) -> None:
    with state._lock:
        state.last_client_time = time.time()


def _ensure_camera_running(state: CameraState) -> None:
    _touch_client(state)
    if not state.running:
        _start_camera(state)


class OcrRequest(BaseModel):
    data_url: Optional[str] = None
    threshold: Optional[int] = None
    invert: bool = False
    lang: str = "eng"
    psm: int = 6


def _decode_data_url(data_url: str) -> bytes:
    if "," not in data_url:
        raise ValueError("Invalid data_url (missing comma)")
    header, b64 = data_url.split(",", 1)
    if not header.startswith("data:"):
        raise ValueError("Invalid data_url header")
    return base64.b64decode(b64)


def _jpeg_bytes_to_cv2_image(image_bytes: bytes):
    if np is None:
        raise RuntimeError("numpy is required (should be installed with opencv-python)")
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image bytes")
    return img


def _preprocess_for_ocr(img_bgr, threshold: Optional[int], invert: bool):
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    if threshold is not None:
        thr_val = int(max(0, min(255, threshold)))
        _, bw = cv2.threshold(gray, thr_val, 255, cv2.THRESH_BINARY)
    else:
        bw = gray
    if invert:
        bw = cv2.bitwise_not(bw)
    return bw


APP_HOST = os.getenv("HOST", "0.0.0.0")
APP_PORT = int(os.getenv("PORT", "8000"))

CAMERA_SOURCE = _parse_source(os.getenv("CAMERA_SOURCE", "http://192.168.86.31/video"))
CAMERA_FPS = float(os.getenv("CAMERA_FPS", "12"))
JPEG_QUALITY = int(os.getenv("JPEG_QUALITY", "80"))
IDLE_STOP_SEC = float(os.getenv("IDLE_STOP_SEC", "5"))

# Optional override; if not set and CAMERA_SOURCE ends with /video, we derive /snapshots.
CAMERA_SNAPSHOT_URL = os.getenv("CAMERA_SNAPSHOT_URL")

state = CameraState(
    source=CAMERA_SOURCE,
    fps=CAMERA_FPS,
    jpeg_quality=JPEG_QUALITY,
    snapshot_url=CAMERA_SNAPSHOT_URL,
    idle_stop_sec=IDLE_STOP_SEC,
)


app = FastAPI(title="Camera Proxy", version="1.0")

# Dev-friendly CORS so the Vite UI can pull /video + /snapshots without browser blocking.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"]
)


@app.on_event("startup")
def on_startup() -> None:
    # Start on-demand when /video or /snapshots is requested.
    _touch_client(state)


@app.on_event("shutdown")
def on_shutdown() -> None:
    _stop_camera(state)


@app.get("/healthz")
def healthz() -> dict:
    with state._lock:
        return {
            "running": state.running,
            "source": str(state.source),
            "snapshot_url": state.snapshot_url,
            "has_frame": state.last_jpeg is not None,
            "last_frame_age_sec": (time.time() - state.last_frame_time) if state.last_frame_time else None,
            "error": state.last_error,
            "client_count": state.client_count,
            "idle_stop_sec": state.idle_stop_sec,
        }


@app.get("/snapshots")
def snapshots() -> Response:
    _ensure_camera_running(state)
    deadline = time.time() + float(os.getenv("SNAPSHOT_WAIT_SEC", "2.0"))
    jpeg: Optional[bytes] = None
    err: Optional[str] = None

    while time.time() < deadline:
        with state._lock:
            jpeg = state.last_jpeg
            err = state.last_error
        if jpeg is not None:
            break
        time.sleep(0.05)

    if jpeg is None:
        raise HTTPException(status_code=503, detail=err or "No frame available yet")

    return Response(content=jpeg, media_type="image/jpeg")


def _mjpeg_stream():
    _ensure_camera_running(state)
    with state._lock:
        state.client_count += 1
    boundary = b"frame"
    try:
        while True:
            _touch_client(state)
            with state._lock:
                jpeg = state.last_jpeg
                err = state.last_error

            if jpeg is None:
                # Keep the connection alive; client can retry.
                time.sleep(0.2)
                if err:
                    # Yield a minimal text frame to surface the error in some clients.
                    payload = err.encode("utf-8", errors="replace")
                    yield (
                        b"--" + boundary + b"\r\n"
                        b"Content-Type: text/plain\r\n\r\n" + payload + b"\r\n"
                    )
                continue

            yield (
                b"--" + boundary + b"\r\n"
                b"Content-Type: image/jpeg\r\n"
                + f"Content-Length: {len(jpeg)}\r\n\r\n".encode("ascii")
                + jpeg
                + b"\r\n"
            )
            time.sleep(1.0 / max(state.fps, 0.1))
    finally:
        with state._lock:
            state.client_count = max(0, state.client_count - 1)


@app.get("/video")
def video() -> StreamingResponse:
    return StreamingResponse(
        _mjpeg_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-store"},
    )


@app.post("/ocr")
def ocr(req: OcrRequest) -> dict:
    if pytesseract is None or Image is None:
        raise HTTPException(
            status_code=501,
            detail=(
                "OCR not installed. Install Python deps: pip install pytesseract Pillow. "
                "Also install the Tesseract OCR engine and ensure it's on PATH."
            ),
        )

    # Optional: allow overriding the tesseract binary path on Windows.
    tesseract_cmd = os.getenv("TESSERACT_CMD")
    if tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = tesseract_cmd

    if req.data_url:
        try:
            image_bytes = _decode_data_url(req.data_url)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid data_url: {exc}")
        img_bgr = _jpeg_bytes_to_cv2_image(image_bytes)
    else:
        # Fall back to most recent frame.
        _ensure_camera_running(state)
        with state._lock:
            jpeg = state.last_jpeg
            err = state.last_error
        if jpeg is None:
            raise HTTPException(status_code=503, detail=err or "No frame available yet")
        img_bgr = _jpeg_bytes_to_cv2_image(jpeg)

    pre = _preprocess_for_ocr(img_bgr, req.threshold, req.invert)
    pil_img = Image.fromarray(pre)

    config = f"--oem 3 --psm {int(req.psm)}"
    text = pytesseract.image_to_string(pil_img, lang=req.lang, config=config)

    # Basic confidence summary (optional).
    confidence_avg = None
    try:
        data = pytesseract.image_to_data(pil_img, lang=req.lang, config=config, output_type=pytesseract.Output.DICT)
        confs = []
        for c in data.get("conf", []):
            try:
                v = float(c)
                if v >= 0:
                    confs.append(v)
            except Exception:
                pass
        if confs:
            confidence_avg = sum(confs) / len(confs)
    except Exception:
        pass

    return {
        "text": text.strip(),
        "confidence_avg": confidence_avg,
        "lang": req.lang,
        "psm": req.psm,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=APP_HOST, port=APP_PORT)
