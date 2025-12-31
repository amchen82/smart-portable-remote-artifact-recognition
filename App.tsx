
import React, { useState, useEffect, useCallback } from 'react';
import { Camera, RefreshCcw, Sliders, RotateCcw, Settings, Server, CheckCircle2, AlertCircle, Info, FlipHorizontal, ScanText, Download } from 'lucide-react';
import { DEFAULT_CONFIG } from './constants';
import { AppStatus } from './types';
import { applyThreshold } from './services/imageProcessor';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [streamConnected, setStreamConnected] = useState(true);
  const [isFrozen, setIsFrozen] = useState(false);
  const [frozenImageUrl, setFrozenImageUrl] = useState<string | null>(null);
  
  const [backendUrl, setBackendUrl] = useState(DEFAULT_CONFIG.BASE_URL);
  const [showSettings, setShowSettings] = useState(false);

  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrText, setOcrText] = useState<string>('');
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [mirrorFlip, setMirrorFlip] = useState(false);
  const [liveThreshold, setLiveThreshold] = useState(128);
  const [processedLiveImage, setProcessedLiveImage] = useState<string | null>(null);
  const [frozenThreshold, setFrozenThreshold] = useState(128);

  const videoUrl = `${backendUrl}${DEFAULT_CONFIG.VIDEO_PATH}`;
  const snapshotBaseUrl = `${backendUrl}${DEFAULT_CONFIG.SNAPSHOT_PATH}`;

  const refreshStream = () => {
    setStreamConnected(false);
    setError(null);
    setIsFrozen(false);
    setFrozenImageUrl(null);
    setProcessedLiveImage(null);
    setOcrText('');
    setOcrError(null);
    setTimeout(() => setStreamConnected(true), 100);
  };

  const freezeStream = async () => {
    setStatus(AppStatus.CAPTURING);
    setError(null);
    try {
      const snapshotUrl = `${snapshotBaseUrl}?t=${Date.now()}`;
      
      // Convert to data URL to truly freeze the image
      const response = await fetch(snapshotUrl);
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      
      setFrozenImageUrl(dataUrl);
      setIsFrozen(true);
      setFrozenThreshold(liveThreshold);
      setStatus(AppStatus.IDLE);
      
      console.log('Frozen image captured as data URL:', dataUrl.substring(0, 50) + '...');
    } catch (err) {
      setError(`Failed to freeze stream: Check if backend is running at ${backendUrl}. If using Chrome, you may need to allow 'Insecure content' in Site Settings.`);
      setStatus(AppStatus.ERROR);
      console.error('Freeze error:', err);
    }
  };

  const unfreezeStream = () => {
    setIsFrozen(false);
    setFrozenImageUrl(null);
    setProcessedLiveImage(null);
    setOcrText('');
    setOcrError(null);
    setOcrProgress(null);
  };

  const updateFrozenThreshold = useCallback(async (val: number) => {
    if (!frozenImageUrl || !isFrozen) return;
    setFrozenThreshold(val);
    console.log('Applying threshold', val, 'to frozen image:', frozenImageUrl.substring(0, 50) + '...');
    try {
      const processed = await applyThreshold(frozenImageUrl, val);
      setProcessedLiveImage(processed);
      console.log('Processed image:', processed.substring(0, 50) + '...');
    } catch (err) {
      console.error("Threshold update failed", err);
    }
  }, [frozenImageUrl, isFrozen]);

  const runOcr = async () => {
    setOcrBusy(true);
    setOcrError(null);
    setOcrProgress(null);
    setOcrText('');
    try {
      let imageUrl: string;
      if (isFrozen) {
        // Use processed image if available, otherwise use frozen image
        imageUrl = processedLiveImage || frozenImageUrl || `${snapshotBaseUrl}?t=${Date.now()}`;
      } else {
        // For live stream, capture a snapshot
        imageUrl = `${snapshotBaseUrl}?t=${Date.now()}`;
      }
      
      const mod = await import('tesseract.js');
      const result = await mod.recognize(imageUrl, 'eng', {
        logger: (m: any) => {
          if (m && typeof m.progress === 'number') {
            setOcrProgress(Math.round(m.progress * 100));
          }
        }
      });

      const text = result?.data?.text ?? '';
      setOcrText(text.trim() || '(no text found)');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setOcrError(msg);
    } finally {
      setOcrBusy(false);
    }
  };

  const downloadFrozenImage = () => {
    if (!isFrozen) return;
    
    // Use the processed image if available, otherwise use the original frozen image
    const imageUrl = processedLiveImage || frozenImageUrl;
    if (!imageUrl) return;

    // Create a download link
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `frozen_frame_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 text-slate-900">
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-purple-200 bg-gradient-to-r from-white via-purple-50 to-pink-50/80 backdrop-blur flex items-center justify-between px-6 z-20">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Server className={`w-6 h-6 ${streamConnected ? 'text-cyan-600' : 'text-rose-600'}`} />
              <h1 className="font-bold text-2xl tracking-tight bg-gradient-to-r from-purple-600 via-pink-600 to-fuchsia-600 bg-clip-text text-transparent">Smart Portable Artifact Recovery<span> Kit </span></h1>
            </div>
            <div className="text-xs bg-slate-50 px-2 py-1 rounded font-mono text-slate-600 border border-slate-200">
              {backendUrl}
            </div>
          </div>
          
          <div className="flex items-center gap-3">
             <button 
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded-lg transition-colors ${showSettings ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white' : 'hover:bg-purple-100 text-purple-700'}`}
            >
              <Settings className="w-6 h-6" />
            </button>
            <button 
              onClick={refreshStream}
              className="p-2 hover:bg-cyan-100 rounded-lg text-cyan-700"
            >
              <RefreshCcw className={`w-6 h-6 ${!streamConnected ? 'animate-spin' : ''}`} />
            </button>
            {isFrozen ? (
              <button 
                onClick={unfreezeStream}
                className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 rounded-full font-bold transition-all shadow-md hover:shadow-lg active:scale-95 text-white"
              >
                <RotateCcw className="w-5 h-5" />
                Reset
              </button>
            ) : (
              <button 
                onClick={freezeStream}
                disabled={status === AppStatus.CAPTURING}
                className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-fuchsia-500 to-pink-500 hover:from-fuchsia-400 hover:to-pink-400 disabled:bg-slate-200 rounded-full font-bold transition-all shadow-md hover:shadow-lg active:scale-95 text-white"
              >
                <Camera className="w-5 h-5" />
                {status === AppStatus.CAPTURING ? 'Processing...' : 'Capture'}
              </button>
            )}
          </div>
        </header>

        {showSettings && (
          <div className="absolute top-16 right-6 w-80 bg-white/95 border border-purple-200 rounded-2xl shadow-xl z-30 p-4 backdrop-blur">
            <h3 className="text-sm font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent uppercase tracking-widest mb-4">Backend Connection</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-purple-700 block mb-1.5 font-semibold">Server URL</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={backendUrl}
                    onChange={(e) => setBackendUrl(e.target.value)}
                    placeholder="http://192.168.86.31:8000"
                    className="flex-1 bg-white border border-purple-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-200 transition-colors"
                  />
                  <button onClick={refreshStream} className="p-2 bg-purple-100 rounded-lg hover:bg-purple-200"><CheckCircle2 className="w-4 h-4 text-cyan-600" /></button>
                </div>
              </div>
              <div className="p-3 bg-gradient-to-r from-fuchsia-50 to-pink-50 border border-fuchsia-200 rounded-lg space-y-2">
                <div className="flex gap-2 text-fuchsia-700">
                    <Info className="w-3 h-3 shrink-0 mt-0.5" />
                    <p className="text-[10px] leading-relaxed">
                      Browsers block HTTPS to local HTTP. If connection fails:
                    </p>
                </div>
                <ul className="text-[9px] text-slate-600 list-disc pl-4 space-y-1">
                    <li>Click the 🔒 or 🛡️ icon in the address bar.</li>
                    <li>Go to <strong>Site Settings</strong>.</li>
                    <li>Set <strong>Insecure content</strong> to <strong>Allow</strong>.</li>
                    <li>Ensure <strong>main.py</strong> is running on the host.</li>
                </ul>
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

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Live Stream Frame */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold text-purple-700 uppercase tracking-[0.2em]">Live Stream</span>
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-white bg-gradient-to-r from-cyan-500 to-blue-500 px-2 py-0.5 rounded border border-cyan-300 shadow-sm">
                  LIVE
                </span>
              </div>
              <div className="h-64 bg-white rounded-2xl border border-cyan-200 overflow-hidden shadow-lg hover:shadow-xl transition-shadow relative">
                {streamConnected ? (
                  <img 
                    src={videoUrl}
                    alt="Live" 
                    className={`w-full h-full object-contain bg-gradient-to-br from-blue-50 to-cyan-50 ${mirrorFlip ? 'scale-x-[-1]' : ''}`}
                    crossOrigin="anonymous"
                    onError={() => {
                       setError(`Connection to ${videoUrl} failed. Ensure the Python server is running and your browser allows insecure content for this site.`);
                       setStreamConnected(false);
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-cyan-50 gap-4">
                    <RefreshCcw className="w-8 h-8 text-cyan-500 animate-spin" />
                    <p className="text-cyan-700 text-xs font-mono font-semibold">Connecting…</p>
                  </div>
                )}
                <div className="absolute top-4 left-4 p-2 bg-white/90 backdrop-blur rounded-lg text-[10px] font-mono border border-cyan-300 uppercase tracking-widest text-cyan-700 font-bold shadow-sm">
                  Cam_Esp32
                </div>
              </div>
            </div>

            {/* Frozen Frame */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold text-purple-700 uppercase tracking-[0.2em]">Captured Frame</span>
              </div>
              <div className="h-64 bg-white rounded-2xl border border-purple-200 overflow-hidden shadow-lg hover:shadow-xl transition-shadow relative">
                {isFrozen && frozenImageUrl ? (
                  <>
                    <img 
                      src={processedLiveImage || frozenImageUrl}
                      alt="Frozen" 
                      className={`w-full h-full object-contain bg-gradient-to-br from-purple-50 to-pink-50 ${mirrorFlip ? 'scale-x-[-1]' : ''}`}
                      crossOrigin="anonymous"
                    />
                    <div className="absolute bottom-4 right-4 p-2 bg-black/70 backdrop-blur rounded-lg text-[8px] font-mono text-white">
                      {processedLiveImage ? 'Processed' : 'Original'}
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-purple-50 to-pink-50 gap-4">
                    <Camera className="w-12 h-12 text-purple-300" />
                    <p className="text-purple-400 text-xs font-mono font-semibold">Click Capture to freeze frame</p>
                  </div>
                )}
              </div>

              {/* Image Controls */}
              <div className="bg-white rounded-xl border border-cyan-200 p-4 shadow-md space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-cyan-600" />
                      <span className="text-xs font-bold text-slate-800">Threshold</span>
                    </div>
                    <span className="text-lg font-mono text-cyan-700 font-black">
                      {isFrozen ? frozenThreshold : liveThreshold}
                    </span>
                  </div>
                  
                  <input 
                    type="range" 
                    min="0" 
                    max="255" 
                    value={isFrozen ? frozenThreshold : liveThreshold}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      if (isFrozen) {
                        updateFrozenThreshold(val);
                      } else {
                        setLiveThreshold(val);
                      }
                    }}
                    disabled={!isFrozen}
                    className="w-full h-2 bg-gradient-to-r from-cyan-300 to-blue-300 rounded-lg appearance-none cursor-pointer accent-cyan-600 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                <div className="pt-3 border-t border-cyan-200 grid grid-cols-3 gap-2">
                  <button
                    onClick={runOcr}
                    disabled={ocrBusy || !isFrozen}
                    className="flex items-center justify-center gap-2 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg text-white text-xs font-bold shadow-md hover:shadow-lg transition-all"
                  >
                    <ScanText className="w-4 h-4" />
                    OCR
                  </button>
                  
                  <button
                    onClick={downloadFrozenImage}
                    disabled={!isFrozen}
                    className="flex items-center justify-center gap-2 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg text-white text-xs font-bold shadow-md hover:shadow-lg transition-all"
                  >
                    <Download className="w-4 h-4" />
                    Save
                  </button>
                  
                  <button
                    onClick={() => setMirrorFlip(!mirrorFlip)}
                    className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold shadow-md hover:shadow-lg transition-all ${
                      mirrorFlip 
                        ? 'bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 text-white' 
                        : 'bg-gradient-to-r from-slate-200 to-slate-300 hover:from-slate-300 hover:to-slate-400 text-slate-700'
                    }`}
                  >
                    <FlipHorizontal className="w-4 h-4" />
                    Mirror
                  </button>
                </div>

                {ocrBusy && (
                  <div className="text-xs text-cyan-700 font-semibold text-center">
                    {ocrProgress != null ? `Progress: ${ocrProgress}%` : 'Loading OCR…'}
                  </div>
                )}

                {ocrError && (
                  <div className="text-xs text-rose-900 bg-rose-100 border border-rose-400 rounded-lg p-2 font-semibold">
                    {ocrError}
                  </div>
                )}

                {ocrText && isFrozen && (
                  <div className="bg-gradient-to-r from-cyan-50 to-blue-50 border border-cyan-200 rounded-lg p-3">
                    <div className="text-[10px] text-cyan-700 font-bold uppercase tracking-[0.2em] mb-2">OCR Result</div>
                    <pre className="whitespace-pre-wrap text-xs text-slate-800 leading-relaxed font-mono max-h-32 overflow-y-auto">
                      {ocrText}
                    </pre>
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
