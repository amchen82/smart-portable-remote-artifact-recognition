
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Camera, RefreshCcw, Sliders, Image as ImageIcon, Trash2, Download, Settings, Server, AlertCircle, Info, Crop, X, ChevronDown } from 'lucide-react';
import { DEFAULT_CONFIG } from './constants';
import { Snapshot, AppStatus } from './types';
import { applyThreshold } from './services/imageProcessor';

const App: React.FC = () => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [currentThreshold, setCurrentThreshold] = useState(DEFAULT_CONFIG.DEFAULT_THRESHOLD);
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [streamConnected, setStreamConnected] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [cameraRefreshToken, setCameraRefreshToken] = useState(0);

  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrText, setOcrText] = useState<string>('');
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [ocrModel, setOcrModel] = useState<'trocr' | 'trocr-multi' | 'tesseract'>('tesseract');

  const [cropping, setCropping] = useState(false);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [cropEnd, setCropEnd] = useState<{ x: number; y: number } | null>(null);
  const cropImgRef = useRef<HTMLImageElement | null>(null);

  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const refreshStream = () => {
    setError(null);
    setStreamConnected(false);
    setCameraRefreshToken((value) => value + 1);
  };

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStreamConnected(false);
      setError('This browser does not support direct camera access.');
      return;
    }

    let cancelled = false;

    const startBrowserCamera = async () => {
      const cameraConstraints: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { ideal: 'environment' },
          },
          audio: false,
        },
        {
          video: true,
          audio: false,
        },
      ];

      try {
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }

        let stream: MediaStream | null = null;
        let lastError: unknown = null;

        for (const constraints of cameraConstraints) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            break;
          } catch (err) {
            lastError = err;
          }
        }

        if (!stream) {
          throw lastError instanceof Error ? lastError : new Error(String(lastError));
        }

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        mediaStreamRef.current = stream;
        if (liveVideoRef.current) {
          liveVideoRef.current.srcObject = stream;
          await liveVideoRef.current.play().catch(() => undefined);
        }

        setStreamConnected(true);
        setError(null);
      } catch (err) {
        let message = err instanceof Error ? err.message : String(err);
        if (err instanceof DOMException && err.name === 'NotFoundError') {
          message = 'No camera device is available to the browser.';
        }
        setStreamConnected(false);
        setError(`Failed to access local camera: ${message}`);
      }
    };

    void startBrowserCamera();

    return () => {
      cancelled = true;
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
    };
  }, [cameraRefreshToken]);

  const captureSnapshot = async () => {
    setStatus(AppStatus.CAPTURING);
    setError(null);
    try {
      const video = liveVideoRef.current;
      if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
        throw new Error('Local camera is not ready yet. Wait a second and try again.');
      }

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Could not create capture canvas.');
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const snapshotUrl = canvas.toDataURL('image/jpeg', 0.92);
      
      const newSnapshot: Snapshot = {
        id: crypto.randomUUID(),
        url: snapshotUrl,
        timestamp: new Date(),
        threshold: currentThreshold
      };

      // We use the canvas to process the snapshot URL
      const processed = await applyThreshold(snapshotUrl, currentThreshold);
      newSnapshot.processedUrl = processed;

      setSnapshots(prev => [newSnapshot, ...prev]);
      setSelectedSnapshotId(newSnapshot.id);
      setStatus(AppStatus.IDLE);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to capture from local camera: ${message}`);
      setStatus(AppStatus.ERROR);
    }
  };

  const updateThreshold = useCallback(async (id: string, val: number) => {
    const snap = snapshots.find(s => s.id === id);
    if (!snap) return;

    try {
      const processed = await applyThreshold(snap.url, val);
      setSnapshots(prev => prev.map(s => 
        s.id === id ? { ...s, threshold: val, processedUrl: processed } : s
      ));
    } catch (err) {
      console.error("Threshold update failed", err);
    }
  }, [snapshots]);

  const deleteSnapshot = (id: string) => {
    setSnapshots(prev => prev.filter(s => s.id !== id));
    if (selectedSnapshotId === id) setSelectedSnapshotId(null);
  };

  const selectedSnapshot = snapshots.find(s => s.id === selectedSnapshotId);

  useEffect(() => {
    // Clear OCR output and exit crop mode when switching snapshots.
    setOcrText('');
    setOcrError(null);
    setOcrProgress(null);
    setCropping(false);
    setCropStart(null);
    setCropEnd(null);
  }, [selectedSnapshotId]);

  const getCropRect = () => {
    if (!cropStart || !cropEnd || !cropImgRef.current) return null;
    const img = cropImgRef.current;
    const rect = img.getBoundingClientRect();
    // Convert page coords to fraction of displayed image
    const x1 = Math.max(0, Math.min(1, (Math.min(cropStart.x, cropEnd.x) - rect.left) / rect.width));
    const y1 = Math.max(0, Math.min(1, (Math.min(cropStart.y, cropEnd.y) - rect.top) / rect.height));
    const x2 = Math.max(0, Math.min(1, (Math.max(cropStart.x, cropEnd.x) - rect.left) / rect.width));
    const y2 = Math.max(0, Math.min(1, (Math.max(cropStart.y, cropEnd.y) - rect.top) / rect.height));
    return { x1, y1, x2, y2 };
  };

  const handleCropMouseDown = (e: React.MouseEvent) => {
    if (!cropping) return;
    e.preventDefault();
    setCropStart({ x: e.clientX, y: e.clientY });
    setCropEnd({ x: e.clientX, y: e.clientY });
  };

  const handleCropMouseMove = (e: React.MouseEvent) => {
    if (!cropping || !cropStart) return;
    setCropEnd({ x: e.clientX, y: e.clientY });
  };

  const handleCropMouseUp = () => {
    // selection is finalized, user can click Apply Crop
  };

  const applyCrop = async () => {
    if (!selectedSnapshot) return;
    const r = getCropRect();
    if (!r || (r.x2 - r.x1) < 0.01 || (r.y2 - r.y1) < 0.01) return;

    const img = new Image();
    img.src = selectedSnapshot.url;
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; });

    const sx = Math.round(r.x1 * img.width);
    const sy = Math.round(r.y1 * img.height);
    const sw = Math.round((r.x2 - r.x1) * img.width);
    const sh = Math.round((r.y2 - r.y1) * img.height);

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const croppedUrl = canvas.toDataURL('image/jpeg', 0.92);

    const processed = await applyThreshold(croppedUrl, selectedSnapshot.threshold);
    setSnapshots(prev => prev.map(s =>
      s.id === selectedSnapshot.id ? { ...s, url: croppedUrl, processedUrl: processed } : s
    ));

    setCropping(false);
    setCropStart(null);
    setCropEnd(null);
  };

  const cancelCrop = () => {
    setCropping(false);
    setCropStart(null);
    setCropEnd(null);
  };

  const cropOverlayStyle = (): React.CSSProperties | null => {
    if (!cropStart || !cropEnd || !cropImgRef.current) return null;
    const rect = cropImgRef.current.getBoundingClientRect();
    const parentRect = cropImgRef.current.parentElement!.getBoundingClientRect();
    const left = Math.min(cropStart.x, cropEnd.x) - parentRect.left;
    const top = Math.min(cropStart.y, cropEnd.y) - parentRect.top;
    const width = Math.abs(cropEnd.x - cropStart.x);
    const height = Math.abs(cropEnd.y - cropStart.y);
    return {
      position: 'absolute',
      left, top, width, height,
      border: '2px dashed #c026d3',
      backgroundColor: 'rgba(192,38,211,0.15)',
      pointerEvents: 'none',
      zIndex: 10,
    };
  };

  /** Detect horizontal text lines via projection profile and return data-URL crops. */
  const detectLines = (dataUrl: string, minGap = 4, minHeight = 8, padding = 4): Promise<string[]> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);

        // Build horizontal projection: count dark pixels per row
        const rowDark = new Uint32Array(height);
        for (let y = 0; y < height; y++) {
          let count = 0;
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            if (gray < 180) count++;
          }
          rowDark[y] = count;
        }

        // Threshold: a row is "text" if > 1% of pixels are dark
        const threshold = width * 0.01;
        const isText = Array.from(rowDark, (v) => v > threshold);

        // Group consecutive text rows into line regions
        const regions: { y1: number; y2: number }[] = [];
        let inRegion = false;
        let start = 0;
        for (let y = 0; y <= height; y++) {
          if (y < height && isText[y]) {
            if (!inRegion) { inRegion = true; start = y; }
          } else if (inRegion) {
            inRegion = false;
            // Merge with previous if gap is small
            if (regions.length > 0 && start - regions[regions.length - 1].y2 < minGap) {
              regions[regions.length - 1].y2 = y;
            } else {
              regions.push({ y1: start, y2: y });
            }
          }
        }

        // Filter tiny regions, add padding, and crop
        const crops: string[] = [];
        for (const r of regions) {
          if (r.y2 - r.y1 < minHeight) continue;
          const y1 = Math.max(0, r.y1 - padding);
          const y2 = Math.min(height, r.y2 + padding);
          const lineCanvas = document.createElement('canvas');
          lineCanvas.width = width;
          lineCanvas.height = y2 - y1;
          const lctx = lineCanvas.getContext('2d')!;
          lctx.drawImage(img, 0, y1, width, y2 - y1, 0, 0, width, y2 - y1);
          crops.push(lineCanvas.toDataURL('image/png'));
        }

        resolve(crops.length > 0 ? crops : [dataUrl]); // fallback: whole image
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  };

  const runOcr = async () => {
    if (!selectedSnapshot) return;
    setOcrBusy(true);
    setOcrError(null);
    setOcrProgress(null);
    try {
      const dataUrl = selectedSnapshot.processedUrl || selectedSnapshot.url;
      if (!dataUrl || !dataUrl.startsWith('data:image/')) {
        throw new Error('No image available yet.');
      }

      let text = '';

      if (ocrModel === 'trocr' || ocrModel === 'trocr-multi') {
        setOcrProgress(0);
        const { pipeline } = await import('@huggingface/transformers');
        setOcrProgress(10);
        const ocr = await pipeline('image-to-text', 'Xenova/trocr-small-printed', {
          dtype: 'q8',
          device: 'wasm',
        });
        setOcrProgress(50);

        if (ocrModel === 'trocr-multi') {
          // Detect lines, run TrOCR on each crop
          const crops = await detectLines(dataUrl);
          const lines: string[] = [];
          for (let i = 0; i < crops.length; i++) {
            setOcrProgress(50 + Math.round((i / crops.length) * 50));
            const result = await ocr(crops[i]);
            const lineText = Array.isArray(result)
              ? result.map((r: any) => r.generated_text).join(' ')
              : '';
            if (lineText.trim()) lines.push(lineText.trim());
          }
          text = lines.join('\n');
        } else {
          setOcrProgress(80);
          const result = await ocr(dataUrl);
          text = Array.isArray(result)
            ? result.map((r: any) => r.generated_text).join('\n')
            : '';
        }
        setOcrProgress(100);
      } else {
        const mod = await import('tesseract.js');
        const result = await mod.recognize(dataUrl, 'eng', {
          logger: (m: any) => {
            if (m && typeof m.progress === 'number') {
              setOcrProgress(Math.round(m.progress * 100));
            }
          }
        });
        text = result?.data?.text ?? '';
      }

      setOcrText(text.trim() || '(no text found)');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setOcrError(msg);
    } finally {
      setOcrBusy(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 text-slate-900">
      <aside className="w-80 border-r border-slate-200 bg-white/90 backdrop-blur flex flex-col shrink-0">
        <div className="p-4 border-b border-purple-200 bg-gradient-to-r from-purple-100 to-pink-100 flex justify-between items-center">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-purple-600" />
            Gallery
          </h2>
          <span className="text-xs bg-purple-200 px-2 py-1 rounded-full text-purple-800 border border-purple-300 font-semibold">
            {snapshots.length}
          </span>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {snapshots.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-600 text-center p-8 space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-sky-50 border border-sky-100 flex items-center justify-center">
                <Camera className="w-8 h-8 text-sky-600" />
              </div>
              <p className="text-sm font-semibold">No snapshots yet</p>
              <p className="text-xs text-slate-500">Press Capture to grab a frame.</p>
            </div>
          ) : (
            snapshots.map(snap => (
              <div 
                key={snap.id}
                onClick={() => setSelectedSnapshotId(snap.id)}
                className={`group relative rounded-xl border-2 transition-all cursor-pointer overflow-hidden ${
                  selectedSnapshotId === snap.id ? 'border-fuchsia-400 ring-4 ring-fuchsia-200/60 shadow-lg shadow-fuchsia-300/30' : 'border-transparent hover:border-purple-300 hover:shadow-md'
                }`}
              >
                <img src={snap.processedUrl || snap.url} alt="" className="w-full h-32 object-cover bg-white" />
                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-white/90 to-transparent flex justify-between items-end">
                  <span className="text-[10px] text-slate-700 font-mono">{snap.timestamp.toLocaleTimeString()}</span>
                  <button onClick={(e) => { e.stopPropagation(); deleteSnapshot(snap.id); }} className="p-1.5 bg-rose-500 hover:bg-rose-600 rounded text-white"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-purple-200 bg-gradient-to-r from-white via-purple-50 to-pink-50/80 backdrop-blur flex items-center justify-between px-6 z-20">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Server className={`w-4 h-4 ${streamConnected ? 'text-cyan-600' : 'text-rose-600'}`} />
              <h1 className="font-bold text-lg tracking-tight bg-gradient-to-r from-purple-600 via-pink-600 to-fuchsia-600 bg-clip-text text-transparent">ArtifactRecovery<span>Genie</span></h1>
            </div>
            <div className="text-[10px] bg-slate-50 px-2 py-1 rounded font-mono text-slate-600 border border-slate-200">
              browser://local-camera
            </div>
          </div>
          
          <div className="flex items-center gap-3">
             <button 
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded-lg transition-colors ${showSettings ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white' : 'hover:bg-purple-100 text-purple-700'}`}
            >
              <Settings className="w-5 h-5" />
            </button>
            <button 
              onClick={refreshStream}
              className="p-2 hover:bg-cyan-100 rounded-lg text-cyan-700"
            >
              <RefreshCcw className={`w-5 h-5 ${!streamConnected ? 'animate-spin' : ''}`} />
            </button>
            <button 
              onClick={captureSnapshot}
              disabled={status === AppStatus.CAPTURING}
              className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-fuchsia-500 to-pink-500 hover:from-fuchsia-400 hover:to-pink-400 disabled:bg-slate-200 rounded-full font-bold transition-all shadow-md hover:shadow-lg active:scale-95 text-white"
            >
              <Camera className="w-4 h-4" />
              {status === AppStatus.CAPTURING ? 'Processing...' : 'Capture'}
            </button>
          </div>
        </header>

        {showSettings && (
          <div className="absolute top-16 right-6 w-80 bg-white/95 border border-purple-200 rounded-2xl shadow-xl z-30 p-4 backdrop-blur">
            <h3 className="text-sm font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent uppercase tracking-widest mb-4">Local Camera</h3>
            <div className="space-y-4">
              <div className="p-3 bg-gradient-to-r from-cyan-50 to-blue-50 border border-cyan-200 rounded-lg space-y-2">
                <div className="flex gap-2 text-cyan-700">
                  <Info className="w-3 h-3 shrink-0 mt-0.5" />
                  <p className="text-[10px] leading-relaxed">
                    The app requests direct browser camera permission and captures frames locally on your machine.
                  </p>
                </div>
                <button onClick={refreshStream} className="w-full rounded-lg bg-cyan-100 hover:bg-cyan-200 text-cyan-800 text-[11px] font-bold px-3 py-2 transition-colors">
                  Reconnect Local Camera
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto p-6 space-y-6">
          {error && (
            <div className="bg-rose-100 border border-rose-400 p-4 rounded-xl flex items-start gap-3 text-rose-900 shadow-md">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-sm font-semibold">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 h-[calc(100%-2rem)]">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold text-purple-700 uppercase tracking-[0.2em]">Source Input</span>
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-white bg-gradient-to-r from-cyan-500 to-blue-500 px-2 py-0.5 rounded border border-cyan-300 shadow-sm">
                  WEBCAM
                </span>
              </div>
              <div className="h-48 bg-white rounded-2xl border border-cyan-200 overflow-hidden shadow-lg hover:shadow-xl transition-shadow relative">
                {streamConnected ? (
                  <video
                    ref={liveVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-contain bg-gradient-to-br from-blue-50 to-cyan-50"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-cyan-50 gap-4">
                    <RefreshCcw className="w-8 h-8 text-cyan-500 animate-spin" />
                    <p className="text-cyan-700 text-xs font-mono font-semibold">Opening local camera…</p>
                  </div>
                )}
                <div className="absolute top-4 left-4 p-2 bg-white/90 backdrop-blur rounded-lg text-[10px] font-mono border border-cyan-300 uppercase tracking-widest text-cyan-700 font-bold shadow-sm">
                  Local Cam
                </div>
              </div>

              {/* OCR Model Guide */}
              <div className="flex-1 bg-white rounded-2xl border border-purple-200 shadow-lg overflow-y-auto p-5 space-y-4">
                <h3 className="text-xs font-bold text-purple-700 uppercase tracking-[0.15em] flex items-center gap-2">
                  <Info className="w-4 h-4 text-purple-500" />
                  OCR Engine Guide
                </h3>

                {/* Workflow diagram */}
                <div className="bg-gradient-to-r from-slate-50 to-purple-50 border border-slate-200 rounded-xl p-4">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Pipeline</p>
                  <div className="flex items-center justify-center gap-1 text-[10px] font-bold flex-wrap">
                    <span className="px-2 py-1 bg-cyan-100 text-cyan-800 rounded border border-cyan-200">📷 Capture</span>
                    <span className="text-slate-400">→</span>
                    <span className="px-2 py-1 bg-fuchsia-100 text-fuchsia-800 rounded border border-fuchsia-200">✂️ Crop (optional)</span>
                    <span className="text-slate-400">→</span>
                    <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded border border-purple-200">🎚️ Threshold</span>
                    <span className="text-slate-400">→</span>
                    <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded border border-blue-200">🔍 OCR</span>
                    <span className="text-slate-400">→</span>
                    <span className="px-2 py-1 bg-green-100 text-green-800 rounded border border-green-200">📝 Text</span>
                  </div>
                </div>

                {/* Selected model detail */}
                {ocrModel === 'tesseract' && (
                  <div className="rounded-xl border border-cyan-300 bg-cyan-50/60 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-bold text-cyan-900">Tesseract (multi-line)</span>
                      <span className="text-[9px] bg-cyan-100 text-cyan-700 px-1.5 py-0.5 rounded font-mono font-bold border border-cyan-200">~15 MB</span>
                    </div>

                    <div className="rounded-lg border border-cyan-200 bg-white/80 p-3">
                      <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-cyan-700 mb-2">How It Reads A Page</p>
                      <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold text-cyan-900">
                        <span className="px-2 py-1 rounded border border-cyan-200 bg-cyan-50">Page image</span>
                        <span className="text-cyan-400">→</span>
                        <span className="px-2 py-1 rounded border border-cyan-200 bg-cyan-50">Layout analysis</span>
                        <span className="text-cyan-400">→</span>
                        <span className="px-2 py-1 rounded border border-cyan-200 bg-cyan-50">Lines / words</span>
                        <span className="text-cyan-400">→</span>
                        <span className="px-2 py-1 rounded border border-cyan-200 bg-cyan-50">LSTM reads sequence</span>
                        <span className="text-cyan-400">→</span>
                        <span className="px-2 py-1 rounded border border-cyan-200 bg-cyan-50">Text + dictionary cleanup</span>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-[9px] text-slate-600">
                        <div className="rounded border border-slate-200 bg-slate-50 p-2">
                          <p className="font-bold text-cyan-800 mb-1">1. Segment</p>
                          <p>Find blocks, lines, and character regions from the full page.</p>
                        </div>
                        <div className="rounded border border-slate-200 bg-slate-50 p-2">
                          <p className="font-bold text-cyan-800 mb-1">2. Decode</p>
                          <p>LSTM predicts the most likely character sequence across each line.</p>
                        </div>
                        <div className="rounded border border-slate-200 bg-slate-50 p-2">
                          <p className="font-bold text-cyan-800 mb-1">3. Correct</p>
                          <p>Language priors help fix likely OCR mistakes in printed text.</p>
                        </div>
                      </div>
                    </div>

                    <div className="text-[10px] text-slate-700 leading-[1.7] space-y-2">
                      <p>
                        <span className="font-bold text-cyan-800">What it is:</span> Tesseract is one of the oldest and most widely-used OCR engines, originally developed by HP in the 1980s and now maintained by Google. It uses an <span className="font-semibold">LSTM (Long Short-Term Memory)</span> neural network — a type of recurrent network designed for sequences — to recognize characters line by line.
                      </p>
                      <p>
                        <span className="font-bold text-cyan-800">How it works:</span> The engine first analyzes the page layout to find text blocks and lines. It then segments each line into words and characters. The LSTM network reads these sequences left-to-right, predicting the most likely character at each position. It uses a built-in language dictionary to correct common misreads.
                      </p>
                      <p>
                        <span className="font-bold text-cyan-800">Best for:</span> Clean printed documents, receipts, book pages, or any image with clear, high-contrast text across multiple lines. It processes the entire page in one pass, making it the fastest option.
                      </p>
                    </div>

                    <div className="flex gap-1.5 flex-wrap">
                      <span className="text-[9px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-bold">✓ Multi-line</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-bold">✓ Fast</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-bold">✓ Full page layout</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-bold">△ Struggles with noise</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-bold">△ Needs clean contrast</span>
                    </div>

                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                      <p className="text-[10px] text-amber-900 leading-relaxed">
                        <span className="font-bold">💡 Tip:</span> Use the threshold slider to make text as dark as possible against a white background before running Tesseract. This mimics a "clean photocopy" which Tesseract handles best.
                      </p>
                    </div>
                  </div>
                )}

                {ocrModel === 'trocr' && (
                  <div className="rounded-xl border border-purple-300 bg-purple-50/60 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-bold text-purple-900">TrOCR (single-line)</span>
                      <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-mono font-bold border border-purple-200">~60 MB</span>
                    </div>

                    <div className="rounded-lg border border-purple-200 bg-white/80 p-3">
                      <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-purple-700 mb-2">Model Diagram</p>
                      <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold text-purple-900">
                        <span className="px-2 py-1 rounded border border-purple-200 bg-purple-50">Single text line</span>
                        <span className="text-purple-400">→</span>
                        <span className="px-2 py-1 rounded border border-purple-200 bg-purple-50">16x16 image patches</span>
                        <span className="text-purple-400">→</span>
                        <span className="px-2 py-1 rounded border border-purple-200 bg-purple-50">Vision Transformer</span>
                        <span className="text-purple-400">→</span>
                        <span className="px-2 py-1 rounded border border-purple-200 bg-purple-50">GPT-2 decoder</span>
                        <span className="text-purple-400">→</span>
                        <span className="px-2 py-1 rounded border border-purple-200 bg-purple-50">Generated text</span>
                      </div>
                      <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-2 text-[9px] text-slate-600 leading-relaxed">
                        <p><span className="font-bold text-purple-800">Why cropping helps:</span> the model assumes the whole image is one reading sequence. If two lines are present, attention can jump between them and the decoder may merge or drop words.</p>
                      </div>
                    </div>

                    <div className="text-[10px] text-slate-700 leading-[1.7] space-y-2">
                      <p>
                        <span className="font-bold text-purple-800">What it is:</span> TrOCR (Transformer-based OCR) is a deep learning model by Microsoft Research that combines a <span className="font-semibold">Vision Transformer (ViT)</span> image encoder with a <span className="font-semibold">GPT-2 text decoder</span>. Unlike Tesseract which was engineered with rules, TrOCR learned to read entirely from training data — millions of text images paired with their correct transcriptions.
                      </p>
                      <p>
                        <span className="font-bold text-purple-800">How it works:</span> The ViT encoder splits the image into 16×16 pixel patches and processes them as a sequence (like words in a sentence). It learns spatial relationships between patches using self-attention. The GPT-2 decoder then generates text one character at a time, attending to the visual features. This approach is similar to how image captioning models work.
                      </p>
                      <p>
                        <span className="font-bold text-purple-800">Best for:</span> Single lines of text that are noisy, distorted, handwritten, or photographed at an angle. Crop your image to one line first using the ✂️ Crop tool, then run this model.
                      </p>
                    </div>

                    <div className="flex gap-1.5 flex-wrap">
                      <span className="text-[9px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-bold">✓ High accuracy</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-bold">✓ Handles noise</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-bold">✓ Handwriting</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-bold">△ Single line only</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-bold">△ Slower</span>
                    </div>

                    <div className="bg-purple-100/60 border border-purple-200 rounded-lg p-2.5">
                      <p className="text-[10px] text-purple-900 leading-relaxed">
                        <span className="font-bold">💡 Tip:</span> Use the Crop tool to select just one line of text. TrOCR reads the entire image as if it were a single line — if there are multiple lines, it may merge or skip them.
                      </p>
                    </div>
                  </div>
                )}

                {ocrModel === 'trocr-multi' && (
                  <div className="rounded-xl border border-fuchsia-300 bg-fuchsia-50/60 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-bold text-fuchsia-900">TrOCR (auto multi-line)</span>
                      <span className="text-[9px] bg-fuchsia-100 text-fuchsia-700 px-1.5 py-0.5 rounded font-mono font-bold border border-fuchsia-200">~60 MB</span>
                    </div>

                    <div className="rounded-lg border border-fuchsia-200 bg-white/80 p-3 space-y-3">
                      <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-fuchsia-700">Two-Stage Diagram</p>
                      <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold text-fuchsia-900">
                        <span className="px-2 py-1 rounded border border-fuchsia-200 bg-fuchsia-50">Full page</span>
                        <span className="text-fuchsia-400">→</span>
                        <span className="px-2 py-1 rounded border border-fuchsia-200 bg-fuchsia-50">Count dark pixels per row</span>
                        <span className="text-fuchsia-400">→</span>
                        <span className="px-2 py-1 rounded border border-fuchsia-200 bg-fuchsia-50">Line bands</span>
                        <span className="text-fuchsia-400">→</span>
                        <span className="px-2 py-1 rounded border border-fuchsia-200 bg-fuchsia-50">Crop each band</span>
                        <span className="text-fuchsia-400">→</span>
                        <span className="px-2 py-1 rounded border border-fuchsia-200 bg-fuchsia-50">Run TrOCR per line</span>
                        <span className="text-fuchsia-400">→</span>
                        <span className="px-2 py-1 rounded border border-fuchsia-200 bg-fuchsia-50">Join outputs</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[9px] text-slate-600">
                        <div className="rounded border border-slate-200 bg-slate-50 p-2">
                          <p className="font-bold text-fuchsia-800 mb-1">Stage A: Vision rule</p>
                          <p>Classical projection profile finds where lines probably are by looking for dense rows of ink.</p>
                        </div>
                        <div className="rounded border border-slate-200 bg-slate-50 p-2">
                          <p className="font-bold text-fuchsia-800 mb-1">Stage B: Deep OCR</p>
                          <p>Each detected line is fed into TrOCR, so the transformer still sees a single reading sequence.</p>
                        </div>
                      </div>
                    </div>

                    <div className="text-[10px] text-slate-700 leading-[1.7] space-y-2">
                      <p>
                        <span className="font-bold text-fuchsia-800">What it is:</span> This mode combines classical computer vision with deep learning. It first uses a <span className="font-semibold">horizontal projection profile</span> to detect where each line of text is, then feeds each line individually to the TrOCR model. You get the accuracy of TrOCR across an entire multi-line image.
                      </p>
                      <p>
                        <span className="font-bold text-fuchsia-800">How line detection works:</span> The algorithm scans every row of pixels and counts how many are "dark" (ink). Rows with many dark pixels are text; rows with few are gaps between lines. It groups consecutive text rows into bands, adds padding, and crops each band into a separate image. This technique has been used in document analysis since the 1960s.
                      </p>
                      <p>
                        <span className="font-bold text-fuchsia-800">Then what happens:</span> Each cropped line image is passed through the TrOCR Vision Transformer encoder → GPT-2 decoder pipeline. Results from all lines are combined top-to-bottom into the final output text.
                      </p>
                      <p>
                        <span className="font-bold text-fuchsia-800">Best for:</span> Multi-line handwritten or printed text where you want higher accuracy than Tesseract. Ideal for artifact inscriptions, letters, or notes with 2–10 lines.
                      </p>
                    </div>

                    <div className="flex gap-1.5 flex-wrap">
                      <span className="text-[9px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-bold">✓ Multi-line</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-bold">✓ High accuracy</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-bold">✓ Auto line detection</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-bold">△ Slowest option</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-bold">△ Needs horizontal text</span>
                    </div>

                    <div className="bg-fuchsia-100/60 border border-fuchsia-200 rounded-lg p-2.5">
                      <p className="text-[10px] text-fuchsia-900 leading-relaxed">
                        <span className="font-bold">💡 Tip:</span> The line detector works best when text lines are roughly horizontal. If the image is rotated, crop to straighten it first. Adjust threshold to maximize contrast between text and background — this helps the projection profile find clean line boundaries.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold text-purple-700 uppercase tracking-[0.2em]">Processing Layer</span>
                {selectedSnapshot && <span className="text-[10px] font-mono text-fuchsia-700 font-bold">THR: {selectedSnapshot.threshold}</span>}
              </div>
              <div className="flex-1 bg-white rounded-2xl border border-purple-200 overflow-hidden shadow-lg flex flex-col">
                {selectedSnapshot ? (
                  <>
                    <div
                      className={`flex-1 relative bg-gradient-to-br from-purple-50 to-pink-50 overflow-hidden flex items-center justify-center ${cropping ? 'cursor-crosshair select-none' : ''}`}
                      onMouseDown={handleCropMouseDown}
                      onMouseMove={handleCropMouseMove}
                      onMouseUp={handleCropMouseUp}
                    >
                       <img 
                        ref={cropImgRef}
                        src={selectedSnapshot.processedUrl || selectedSnapshot.url} 
                        alt="" 
                        className="max-w-full max-h-full object-contain"
                        draggable={false}
                      />
                      {cropping && cropStart && cropEnd && cropOverlayStyle() && (
                        <div style={cropOverlayStyle()!} />
                      )}
                      <div className="absolute top-4 right-4 flex gap-2">
                        {!cropping ? (
                          <>
                            <button
                              onClick={() => setCropping(true)}
                              className="p-2 bg-white/90 backdrop-blur rounded-lg hover:bg-white text-fuchsia-700 border border-purple-300 hover:shadow-md transition-all font-bold"
                              title="Crop"
                            >
                              <Crop className="w-4 h-4" />
                            </button>
                            <a 
                              href={selectedSnapshot.processedUrl} 
                              download={`capture_${Date.now()}.png`}
                              className="p-2 bg-white/90 backdrop-blur rounded-lg hover:bg-white text-fuchsia-700 border border-purple-300 hover:shadow-md transition-all font-bold"
                            >
                              <Download className="w-4 h-4" />
                            </a>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={applyCrop}
                              className="px-3 py-1.5 bg-gradient-to-r from-fuchsia-500 to-pink-500 hover:from-fuchsia-400 hover:to-pink-400 text-white text-[11px] font-bold rounded-lg shadow-md transition-all"
                            >
                              Apply Crop
                            </button>
                            <button
                              onClick={cancelCrop}
                              className="p-2 bg-white/90 backdrop-blur rounded-lg hover:bg-white text-rose-600 border border-rose-300 hover:shadow-md transition-all font-bold"
                              title="Cancel"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                      {cropping && !cropStart && (
                        <div className="absolute bottom-4 left-0 right-0 text-center">
                          <span className="px-3 py-1.5 bg-fuchsia-600/90 text-white text-[11px] font-bold rounded-lg shadow-md">
                            Drag to select crop area
                          </span>
                        </div>
                      )}
                    </div>
                    
                    <div className="p-6 bg-white border-t border-purple-200 space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sliders className="w-4 h-4 text-fuchsia-600" />
                          <h3 className="font-bold text-sm text-slate-800">Binary Threshold</h3>
                        </div>
                        <div className="text-xl font-mono text-fuchsia-700 font-black tracking-tighter">
                          {selectedSnapshot.threshold}
                        </div>
                      </div>
                      
                      <input 
                        type="range" 
                        min="0" 
                        max="255" 
                        value={selectedSnapshot.threshold}
                        onChange={(e) => updateThreshold(selectedSnapshot.id, parseInt(e.target.value))}
                        className="w-full h-2 bg-gradient-to-r from-purple-300 to-pink-300 rounded-lg appearance-none cursor-pointer accent-fuchsia-600 shadow-sm"
                      />

                      <div className="grid grid-cols-4 gap-2">
                        {[0, 128, 200, 255].map((v) => (
                          <button 
                            key={v}
                            onClick={() => updateThreshold(selectedSnapshot.id, v)}
                            className="text-[10px] py-1.5 bg-gradient-to-b from-purple-100 to-pink-100 hover:from-purple-200 hover:to-pink-200 rounded border border-purple-300 text-purple-800 font-bold transition-all"
                          >
                            {v === 0 ? 'Min' : v === 255 ? 'Max' : v}
                          </button>
                        ))}
                      </div>

                      <div className="pt-2 border-t border-purple-200 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-[10px] font-bold text-purple-700 uppercase tracking-[0.2em]">OCR</h4>
                          <div className="flex items-center gap-1.5">
                            <div className="relative">
                              <select
                                value={ocrModel}
                                onChange={(e) => setOcrModel(e.target.value as 'trocr' | 'trocr-multi' | 'tesseract')}
                                disabled={ocrBusy}
                                className="appearance-none pl-2 pr-6 py-1.5 rounded-l-lg border border-r-0 border-purple-300 bg-gradient-to-b from-purple-50 to-pink-50 text-[11px] font-bold text-purple-800 cursor-pointer focus:outline-none disabled:opacity-50"
                              >
                                <option value="tesseract">Tesseract (multi-line)</option>
                                <option value="trocr">TrOCR (single-line)</option>
                                <option value="trocr-multi">TrOCR (auto multi-line)</option>
                              </select>
                              <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-purple-500 pointer-events-none" />
                            </div>
                            <button
                              onClick={runOcr}
                              disabled={ocrBusy}
                              className="px-3 py-1.5 rounded-r-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:bg-slate-300 text-white text-[11px] font-bold shadow-md hover:shadow-lg transition-all"
                            >
                              {ocrBusy ? 'Reading…' : 'Run OCR'}
                            </button>
                          </div>
                        </div>

                        {ocrBusy && (
                          <div className="text-[11px] text-purple-700 font-semibold">
                            {ocrProgress != null ? `Progress: ${ocrProgress}%` : 'Loading OCR engine…'}
                          </div>
                        )}

                        {ocrError && (
                          <div className="text-[11px] text-rose-900 bg-rose-100 border border-rose-400 rounded-lg p-2 font-semibold">
                            {ocrError}
                          </div>
                        )}

                        <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-xl p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] text-purple-700 font-bold uppercase tracking-[0.2em]">Result</span>
                            <span className="text-[10px] text-slate-500 font-mono"></span>
                          </div>
                          <pre className="whitespace-pre-wrap text-[12px] text-slate-800 leading-relaxed font-mono">
                            {ocrText || '—'}
                          </pre>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-600 gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-100 to-pink-100 border border-purple-300 flex items-center justify-center shadow-sm">
                      <ImageIcon className="w-7 h-7 text-fuchsia-600" />
                    </div>
                    <p className="text-xs uppercase font-bold tracking-[0.2em] text-purple-700">Select Input Frame</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
