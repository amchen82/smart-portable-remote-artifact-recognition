
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Camera, RefreshCcw, Sliders, Image as ImageIcon, Trash2, Download, Maximize2 } from 'lucide-react';
import { CAMERA_CONFIG } from './constants';
import { Snapshot, AppStatus } from './types';
import { applyThreshold } from './services/imageProcessor';

const App: React.FC = () => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [currentThreshold, setCurrentThreshold] = useState(CAMERA_CONFIG.DEFAULT_THRESHOLD);
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [streamConnected, setStreamConnected] = useState(true);

  // Auto-refresh stream if needed
  const refreshStream = () => {
    setStreamConnected(false);
    setTimeout(() => setStreamConnected(true), 100);
  };

  const captureSnapshot = async () => {
    setStatus(AppStatus.CAPTURING);
    setError(null);
    try {
      // Append timestamp to prevent caching
      const snapshotUrl = `${CAMERA_CONFIG.SNAPSHOT_ENDPOINT}?t=${Date.now()}`;
      
      // We don't fetch-blob here to avoid CORS issues if the server isn't configured,
      // but we treat the URL as the source for our canvas processing.
      const newSnapshot: Snapshot = {
        id: crypto.randomUUID(),
        url: snapshotUrl,
        timestamp: new Date(),
        threshold: currentThreshold
      };

      // Apply initial processing
      const processed = await applyThreshold(snapshotUrl, currentThreshold);
      newSnapshot.processedUrl = processed;

      setSnapshots(prev => [newSnapshot, ...prev]);
      setSelectedSnapshotId(newSnapshot.id);
      setStatus(AppStatus.IDLE);
    } catch (err) {
      console.error("Capture failed", err);
      setError("Failed to capture snapshot. Ensure the camera server is reachable at 172.20.10.2");
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
      {/* Sidebar - Gallery */}
      <aside className="w-80 border-r border-slate-800 bg-slate-900/50 flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-blue-400" />
            Gallery
          </h2>
          <span className="text-xs bg-slate-800 px-2 py-1 rounded-full text-slate-400">
            {snapshots.length} Items
          </span>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          {snapshots.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 text-center p-8 space-y-4">
              <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center">
                <Camera className="w-8 h-8 opacity-20" />
              </div>
              <p className="text-sm">No snapshots captured yet. Press capture to begin.</p>
            </div>
          ) : (
            snapshots.map(snap => (
              <div 
                key={snap.id}
                onClick={() => setSelectedSnapshotId(snap.id)}
                className={`group relative rounded-xl border-2 transition-all cursor-pointer overflow-hidden ${
                  selectedSnapshotId === snap.id ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-transparent hover:border-slate-700'
                }`}
              >
                <img 
                  src={snap.processedUrl || snap.url} 
                  alt="Snapshot" 
                  className="w-full h-32 object-cover bg-black"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2 flex items-end justify-between">
                  <span className="text-[10px] text-white">
                    {snap.timestamp.toLocaleTimeString()}
                  </span>
                  <button 
                    onClick={(e) => { e.stopPropagation(); deleteSnapshot(snap.id); }}
                    className="p-1.5 bg-red-500/80 hover:bg-red-500 rounded-lg"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md flex items-center justify-between px-6 sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              <h1 className="font-semibold text-lg">Vision Studio Pro</h1>
            </div>
            <div className="hidden md:flex h-6 w-[1px] bg-slate-700 mx-2" />
            <p className="hidden md:block text-xs text-slate-400">IP: 172.20.10.2</p>
          </div>
          
          <div className="flex items-center gap-3">
             <button 
              onClick={refreshStream}
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors"
              title="Refresh Stream"
            >
              <RefreshCcw className="w-5 h-5" />
            </button>
            <button 
              onClick={captureSnapshot}
              disabled={status === AppStatus.CAPTURING}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full font-medium transition-all transform active:scale-95 ${
                status === AppStatus.CAPTURING 
                ? 'bg-slate-700 text-slate-400 cursor-not-allowed' 
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20'
              }`}
            >
              <Camera className="w-5 h-5" />
              {status === AppStatus.CAPTURING ? 'Capturing...' : 'Capture Now'}
            </button>
          </div>
        </header>

        {/* Viewport Grid */}
        <div className="flex-1 overflow-auto p-6 bg-slate-950 space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center gap-3 text-red-400">
              <div className="bg-red-500 rounded-full p-1"><RefreshCcw className="w-4 h-4 text-white" /></div>
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 h-[calc(100%-4rem)]">
            {/* Live Feed Container */}
            <div className="flex flex-col gap-3 group">
              <div className="flex items-center justify-between px-1">
                <span className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Live Monitor</span>
                <span className="text-[10px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded border border-green-500/20 uppercase">Streaming</span>
              </div>
              <div className="flex-1 bg-black rounded-3xl border border-slate-800 overflow-hidden shadow-2xl relative min-h-[400px]">
                {streamConnected ? (
                   <img 
                    src={CAMERA_CONFIG.VIDEO_ENDPOINT} 
                    alt="Live Stream" 
                    className="w-full h-full object-contain"
                    onError={() => {
                       setError("Live stream connection lost. Is the camera active?");
                       setStreamConnected(false);
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-slate-900">
                    <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                    <p className="text-slate-400 text-sm">Attempting to reconnect...</p>
                    <button onClick={refreshStream} className="text-blue-400 text-xs hover:underline">Retry Manually</button>
                  </div>
                )}
                
                <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                   <button className="p-2 bg-black/50 backdrop-blur-md rounded-lg hover:bg-black/70 transition-colors">
                    <Maximize2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Processing/Adjustment Container */}
            <div className="flex flex-col gap-3 group">
              <div className="flex items-center justify-between px-1">
                <span className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Processing Workbench</span>
                {selectedSnapshot && (
                   <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20 uppercase">
                    ID: {selectedSnapshot.id.slice(0, 8)}
                  </span>
                )}
              </div>
              <div className="flex-1 bg-slate-900 rounded-3xl border border-slate-800 overflow-hidden shadow-2xl flex flex-col min-h-[400px]">
                {selectedSnapshot ? (
                  <>
                    <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
                       <img 
                        src={selectedSnapshot.processedUrl || selectedSnapshot.url} 
                        alt="Processed View" 
                        className="max-w-full max-h-full object-contain"
                      />
                      <div className="absolute top-4 right-4 flex gap-2">
                        <a 
                          href={selectedSnapshot.processedUrl} 
                          download={`snapshot_${selectedSnapshot.id.slice(0,8)}.png`}
                          className="p-2 bg-black/50 backdrop-blur-md rounded-lg hover:bg-black/70 transition-colors"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
                    </div>
                    
                    {/* Controls Footer */}
                    <div className="p-6 bg-slate-900 border-t border-slate-800 space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sliders className="w-5 h-5 text-blue-400" />
                          <h3 className="font-semibold">Thresholding</h3>
                        </div>
                        <span className="text-2xl font-mono text-blue-400 font-bold bg-blue-500/10 px-3 py-1 rounded-lg border border-blue-500/20">
                          {selectedSnapshot.threshold}
                        </span>
                      </div>
                      
                      <div className="space-y-4">
                        <input 
                          type="range" 
                          min="0" 
                          max="255" 
                          value={selectedSnapshot.threshold}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            updateThreshold(selectedSnapshot.id, val);
                          }}
                          className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-all"
                        />
                        <div className="flex justify-between text-[10px] text-slate-500 uppercase font-bold tracking-widest px-1">
                          <span>Darker</span>
                          <span>Contrast Sensitivity</span>
                          <span>Lighter</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2">
                        {[64, 128, 192, 220].map((preset) => (
                          <button 
                            key={preset}
                            onClick={() => updateThreshold(selectedSnapshot.id, preset)}
                            className="text-[10px] py-2 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors uppercase font-bold text-slate-400"
                          >
                            Set {preset}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-4 p-12 text-center">
                    <div className="w-20 h-20 rounded-full bg-slate-800/50 flex items-center justify-center border-2 border-dashed border-slate-700">
                      <ImageIcon className="w-10 h-10 opacity-30" />
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-lg font-medium text-slate-300">No Target Selected</h4>
                      <p className="text-sm max-w-xs mx-auto">Select a snapshot from the gallery to begin vision processing and threshold analysis.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Global CSS for scrollbar */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #334155;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #475569;
        }
      `}</style>
    </div>
  );
};

export default App;
