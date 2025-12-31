
import React, { useState, useEffect, useCallback } from 'react';
import { Camera, RefreshCcw, Sliders, Image as ImageIcon, Trash2, Download, Maximize2, Settings, Server, CheckCircle2, AlertCircle, Info } from 'lucide-react';
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
  
  const [backendUrl, setBackendUrl] = useState(DEFAULT_CONFIG.BASE_URL);
  const [showSettings, setShowSettings] = useState(false);

  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrText, setOcrText] = useState<string>('');
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);

  const videoUrl = `${backendUrl}${DEFAULT_CONFIG.VIDEO_PATH}`;
  const snapshotBaseUrl = `${backendUrl}${DEFAULT_CONFIG.SNAPSHOT_PATH}`;

  const refreshStream = () => {
    setStreamConnected(false);
    setError(null);
    setTimeout(() => setStreamConnected(true), 100);
  };

  const captureSnapshot = async () => {
    setStatus(AppStatus.CAPTURING);
    setError(null);
    try {
      const snapshotUrl = `${snapshotBaseUrl}?t=${Date.now()}`;
      
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
      setError(`Failed to capture: Check if backend is running at ${backendUrl}. If using Chrome, you may need to allow 'Insecure content' in Site Settings.`);
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
    // Clear OCR output when switching snapshots.
    setOcrText('');
    setOcrError(null);
    setOcrProgress(null);
  }, [selectedSnapshotId]);

  const runOcr = async () => {
    if (!selectedSnapshot) return;
    setOcrBusy(true);
    setOcrError(null);
    setOcrProgress(null);
    try {
      // Only OCR the captured/processed picture (data URL), not the live stream.
      const dataUrl = selectedSnapshot.processedUrl;
      if (!dataUrl || !dataUrl.startsWith('data:image/')) {
        throw new Error('No processed image available yet. Move the threshold slider once, then try again.');
      }

      const mod = await import('tesseract.js');
      const result = await mod.recognize(dataUrl, 'eng', {
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
              {backendUrl}
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
            <h3 className="text-sm font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent uppercase tracking-widest mb-4">Backend Connection</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-purple-700 block mb-1.5 font-semibold">Server URL</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={backendUrl}
                    onChange={(e) => setBackendUrl(e.target.value)}
                    placeholder="http://192.168.86.38:8000"
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

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 h-[calc(100%-2rem)]">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold text-purple-700 uppercase tracking-[0.2em]">Source Input</span>
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-white bg-gradient-to-r from-cyan-500 to-blue-500 px-2 py-0.5 rounded border border-cyan-300 shadow-sm">
                  LIVE
                </span>
              </div>
              <div className="h-48 bg-white rounded-2xl border border-cyan-200 overflow-hidden shadow-lg hover:shadow-xl transition-shadow relative">
                {streamConnected ? (
                  <img 
                    src={videoUrl} 
                    alt="Live" 
                    className="w-full h-full object-contain bg-gradient-to-br from-blue-50 to-cyan-50"
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
                  Cam_01
                </div>
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
                    <div className="flex-1 relative bg-gradient-to-br from-purple-50 to-pink-50 overflow-hidden flex items-center justify-center">
                       <img 
                        src={selectedSnapshot.processedUrl || selectedSnapshot.url} 
                        alt="" 
                        className="max-w-full max-h-full object-contain"
                      />
                      <div className="absolute top-4 right-4 flex gap-2">
                        <a 
                          href={selectedSnapshot.processedUrl} 
                          download={`capture_${Date.now()}.png`}
                          className="p-2 bg-white/90 backdrop-blur rounded-lg hover:bg-white text-fuchsia-700 border border-purple-300 hover:shadow-md transition-all font-bold"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
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
                          <button
                            onClick={runOcr}
                            disabled={ocrBusy}
                            className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:bg-slate-300 text-white text-[11px] font-bold shadow-md hover:shadow-lg transition-all"
                          >
                            {ocrBusy ? 'Reading…' : 'Run OCR'}
                          </button>
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
