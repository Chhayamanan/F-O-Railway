import React, { useState, useEffect } from 'react';
import { Activity, Play, Square, Settings, RefreshCw, Clock } from 'lucide-react';

export default function Radar5mTab() {
  const [status, setStatus] = useState<any>(null);
  const [threshold, setThreshold] = useState<number>(10000);
  const [inputThreshold, setInputThreshold] = useState<string>('10000');
  
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/radar5m/status');
      const data = await res.json();
      setStatus(data);
    } catch (e) {}
  };

  useEffect(() => {
    fetchStatus();
    const int = setInterval(fetchStatus, 5000);
    return () => clearInterval(int);
  }, []);

  useEffect(() => {
      if (status && status.threshold) {
          setThreshold(status.threshold);
          setInputThreshold(status.threshold.toString());
      }
  }, [status?.threshold]);

  const toggleScan = async () => {
    if (!status) return;
    if (status.isRunning) {
        await fetch('/api/radar5m/stop', { method: 'POST' });
    } else {
        await fetch('/api/radar5m/start', { method: 'POST' });
    }
    fetchStatus();
  };

  const updateThreshold = async () => {
    const val = parseInt(inputThreshold);
    if (!isNaN(val)) {
        await fetch('/api/radar5m/threshold', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ threshold: val })
        });
        fetchStatus();
    }
  };

  if (!status) return <div className="p-8 text-center text-zinc-500 animate-pulse">Loading Radar Engine...</div>;

  const nextScanSeconds = status.isRunning && status.lastScanTime 
      ? Math.max(0, Math.floor(300 - ((Date.now() - status.lastScanTime) / 1000))) 
      : 0;

  return (
    <div className="space-y-6">
       <div className="bg-zinc-900/40 p-5 rounded-xl border border-zinc-800 flex flex-wrap items-center justify-between gap-4">
           <div className="flex items-center gap-6">
               <div className="flex items-center gap-3">
                   <div className={`w-3 h-3 rounded-full ${status.isRunning ? 'bg-emerald-500 animate-pulse box-shadow-glow' : 'bg-zinc-600'}`}></div>
                   <span className="text-zinc-300 font-medium">{status.isRunning ? 'Engine Online' : 'Engine Offline'}</span>
               </div>
               
               {status.isRunning && (
                  <div className="flex items-center gap-2 text-sm text-zinc-400 bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800">
                     <Clock size={14} className="text-indigo-400" />
                     <span>Next Scan In: </span>
                     <span className="font-mono text-indigo-300">{Math.floor(nextScanSeconds / 60)}m {nextScanSeconds % 60}s</span>
                  </div>
               )}
           </div>

           <div className="flex items-center gap-4">
               <div className="flex items-center gap-2 bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800">
                   <label className="text-xs text-zinc-500 font-medium">Vol Threshold</label>
                   <input
                      type="number"
                      value={inputThreshold}
                      onChange={(e) => setInputThreshold(e.target.value)}
                      onBlur={updateThreshold}
                      className="bg-transparent text-emerald-400 font-mono text-sm w-20 text-right outline-none"
                   />
               </div>
               <button 
                  onClick={toggleScan}
                  className={`px-6 py-2 rounded-lg font-medium flex items-center gap-2 transition-all ${status.isRunning ? 'bg-rose-950/50 hover:bg-rose-900 text-rose-400 border border-rose-900' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg'}`}
               >
                  {status.isRunning ? <><Square size={16} /> Stop Scanner</> : <><Play size={16} fill="currentColor" /> Start Radar</>}
               </button>
           </div>
       </div>

       <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl overflow-hidden">
           <div className="p-4 border-b border-zinc-800 flex items-center gap-3">
              <Activity className="text-indigo-400" />
              <h2 className="text-lg font-medium text-white">5-Min Volume Breakouts</h2>
              <span className="ml-auto bg-indigo-900/40 text-indigo-300 px-3 py-1 rounded-full text-xs font-mono border border-indigo-800">
                 {status.radarList?.length || 0} Triggers
              </span>
           </div>

           <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                 <thead className="bg-zinc-900/80 text-zinc-500 border-b border-zinc-800">
                    <tr>
                       <th className="font-medium p-4">Symbol</th>
                       <th className="font-medium p-4">LTP</th>
                       <th className="font-medium p-4 text-right">Latest 5m Vol</th>
                       <th className="font-medium p-4 text-right">Avg 5m Vol (400)</th>
                       <th className="font-medium p-4 text-right">Trigger Time</th>
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-zinc-800/50">
                    {(!status.radarList || status.radarList.length === 0) ? (
                      <tr>
                        <td colSpan={5} className="p-12 text-center text-zinc-500">
                          {status.isRunning ? "Scanner is monitoring. Waiting for volume breakouts..." : "Scanner is offline. Start the radar to monitor 5-min volumes."}
                        </td>
                      </tr>
                    ) : status.radarList.map((item: any) => {
                       const t = new Date(item.timestamp);
                       return (
                       <tr key={item.symbol} className="hover:bg-zinc-800/20 transition-colors">
                          <td className="p-4 font-bold text-indigo-300">{item.symbol}</td>
                          <td className="p-4 font-mono text-zinc-200">₹{item.ltp.toFixed(2)}</td>
                          <td className="p-4 font-mono text-emerald-400 text-right">{(item.latest5mVol).toLocaleString()}</td>
                          <td className="p-4 font-mono text-zinc-500 text-right">{(item.avg5mVol400).toLocaleString()}</td>
                          <td className="p-4 font-mono text-zinc-400 text-right">{t.toLocaleTimeString()}</td>
                       </tr>
                       )
                    })}
                 </tbody>
              </table>
           </div>
       </div>
    </div>
  );
}
