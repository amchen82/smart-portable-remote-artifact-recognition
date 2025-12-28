<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/13n9mzZToNnddD6xWyF4VAe8q1Ex9GfqV

## Run Locally

**Prerequisites:** Node.js, Python 3.10+

### 1) Start the Python backend (camera proxy)

This UI expects a backend that serves:

- `GET /video` (MJPEG stream)
- `GET /snapshots` (single JPEG)

By default the backend pulls frames from `http://172.20.10.2/video`. Override with `CAMERA_SOURCE`.

1. Install Python deps:
    `pip install -r requirements.txt`
2. Start the server (default: `http://localhost:8000`):
    `python main.py`

### OCR (optional)

The UI can run OCR directly in the browser on the captured/processed picture (no Python OCR setup required). If you don't need OCR, you can ignore it.

Optional:

- Use a different camera source:
   `set CAMERA_SOURCE=http://YOUR_CAMERA_IP/video`
- Use your local webcam instead:
   `set CAMERA_SOURCE=0`

### 2) Start the web UI


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

The UI defaults to the Python backend at `http://localhost:8000` (see [constants.ts](constants.ts)).
