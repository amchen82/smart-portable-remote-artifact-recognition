
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

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      <aside className="w-80 border-r border-slate-800 bg-slate-900/50 flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-blue-400" />
            Gallery
          </h2>
          <span className="text-xs bg-slate-800 px-2 py-1 rounded-full text-slate-400">
            {snapshots.length}
          </span>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          {snapshots.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 text-center p-8 space-y-4 opacity-50">
              <Camera className="w-12 h-12" />
              <p className="text-sm">No snapshots captured.</p>
            </div>
          ) : (
            snapshots.map(snap => (
              <div 
                key={snap.id}
                onClick={() => setSelectedSnapshotId(snap.id)}
                className={`group relative rounded-xl border-2 transition-all cursor-pointer overflow-hidden ${
                  selectedSnapshotId === snap.id ? 'border-blue-500 ring-4 ring-blue-500/10' : 'border-transparent hover:border-slate-700'
                }`}
              >
                <img src={snap.processedUrl || snap.url} alt="" className="w-full h-32 object-cover bg-black" />
                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent flex justify-between items-end">
                  <span className="text-[10px] text-white/70 font-mono">{snap.timestamp.toLocaleTimeString()}</span>
                  <button onClick={(e) => { e.stopPropagation(); deleteSnapshot(snap.id); }} className="p-1.5 bg-red-500/80 hover:bg-red-500 rounded text-white"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md flex items-center justify-between px-6 z-20">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Server className={`w-4 h-4 ${streamConnected ? 'text-green-400' : 'text-red-400'}`} />
              <h1 className="font-bold text-lg tracking-tight">Vision<span className="text-blue-500">Node</span></h1>
            </div>
            <div className="text-[10px] bg-slate-800 px-2 py-1 rounded font-mono text-slate-400 border border-slate-700">
              {backendUrl}
            </div>
          </div>
          
          <div className="flex items-center gap-3">
             <button 
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded-lg transition-colors ${showSettings ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 text-slate-400'}`}
            >
              <Settings className="w-5 h-5" />
            </button>
            <button 
              onClick={refreshStream}
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400"
            >
              <RefreshCcw className={`w-5 h-5 ${!streamConnected ? 'animate-spin' : ''}`} />
            </button>
            <button 
              onClick={captureSnapshot}
              disabled={status === AppStatus.CAPTURING}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 rounded-full font-bold transition-all shadow-lg shadow-blue-600/20 active:scale-95"
            >
              <Camera className="w-4 h-4" />
              {status === AppStatus.CAPTURING ? 'Processing...' : 'Capture'}
            </button>
          </div>
        </header>

        {showSettings && (
          <div className="absolute top-16 right-6 w-80 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl z-30 p-4 animate-in fade-in slide-in-from-top-2">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Backend Connection</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-slate-500 block mb-1.5">Server URL</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={backendUrl}
                    onChange={(e) => setBackendUrl(e.target.value)}
                    placeholder="http://172.20.10.2:8000"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  <button onClick={refreshStream} className="p-2 bg-slate-800 rounded-lg hover:bg-slate-700"><CheckCircle2 className="w-4 h-4 text-green-400" /></button>
                </div>
              </div>
              <div className="p-3 bg-blue-500/5 border border-blue-500/10 rounded-lg space-y-2">
                <div className="flex gap-2 text-blue-400">
                    <Info className="w-3 h-3 shrink-0 mt-0.5" />
                    <p className="text-[10px] leading-relaxed">
                      Browsers block HTTPS to local HTTP. If connection fails:
                    </p>
                </div>
                <ul className="text-[9px] text-slate-400 list-disc pl-4 space-y-1">
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
            <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-start gap-3 text-red-400">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 h-[calc(100%-2rem)] min-h-[500px]">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Source Input</span>
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-green-400 bg-green-400/10 px-2 py-0.5 rounded border border-green-400/20">
                  LIVE
                </span>
              </div>
              <div className="flex-1 bg-black rounded-3xl border border-slate-800 overflow-hidden shadow-2xl relative">
                {streamConnected ? (
                  <img 
                    src={videoUrl} 
                    alt="Live" 
                    className="w-full h-full object-contain"
                    crossOrigin="anonymous"
                    onError={() => {
                       setError(`Connection to ${videoUrl} failed. Ensure the Python server is running and your browser allows insecure content for this site.`);
                       setStreamConnected(false);
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 gap-4">
                    <RefreshCcw className="w-8 h-8 text-slate-700 animate-spin" />
                    <p className="text-slate-500 text-xs font-mono">Connecting to backend...</p>
                  </div>
                )}
                <div className="absolute top-4 left-4 p-2 bg-black/40 backdrop-blur-md rounded-lg text-[10px] font-mono border border-white/5 uppercase tracking-widest">
                  Cam_01
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Processing Layer</span>
                {selectedSnapshot && <span className="text-[10px] font-mono text-blue-400">THR: {selectedSnapshot.threshold}</span>}
              </div>
              <div className="flex-1 bg-slate-900 rounded-3xl border border-slate-800 overflow-hidden shadow-2xl flex flex-col">
                {selectedSnapshot ? (
                  <>
                    <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
                       <img 
                        src={selectedSnapshot.processedUrl || selectedSnapshot.url} 
                        alt="" 
                        className="max-w-full max-h-full object-contain"
                      />
                      <div className="absolute top-4 right-4 flex gap-2">
                        <a 
                          href={selectedSnapshot.processedUrl} 
                          download={`capture_${Date.now()}.png`}
                          className="p-2 bg-black/50 backdrop-blur-md rounded-lg hover:bg-black/70 text-white"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
                    </div>
                    
                    <div className="p-6 bg-slate-900 border-t border-slate-800 space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sliders className="w-4 h-4 text-blue-400" />
                          <h3 className="font-bold text-sm">Binary Threshold</h3>
                        </div>
                        <div className="text-xl font-mono text-blue-400 font-black tracking-tighter">
                          {selectedSnapshot.threshold}
                        </div>
                      </div>
                      
                      <input 
                        type="range" 
                        min="0" 
                        max="255" 
                        value={selectedSnapshot.threshold}
                        onChange={(e) => updateThreshold(selectedSnapshot.id, parseInt(e.target.value))}
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                      />

                      <div className="grid grid-cols-4 gap-2">
                        {[0, 128, 200, 255].map((v) => (
                          <button 
                            key={v}
                            onClick={() => updateThreshold(selectedSnapshot.id, v)}
                            className="text-[10px] py-1.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 text-slate-400 font-bold"
                          >
                            {v === 0 ? 'Min' : v === 255 ? 'Max' : v}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-600 gap-4">
                    <div className="w-16 h-16 rounded-full border-2 border-dashed border-slate-800 flex items-center justify-center">
                      <ImageIcon className="w-6 h-6 opacity-20" />
                    </div>
                    <p className="text-xs uppercase font-bold tracking-[0.2em]">Select Input Frame</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
      `}</style>
    </div>
  );
};

export default App;
