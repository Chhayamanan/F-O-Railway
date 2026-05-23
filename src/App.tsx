import React, { useState, useEffect } from 'react';
import { RefreshCw, Play, Search, AlertCircle, TrendingUp, CheckCircle, XCircle, Clock } from 'lucide-react';

interface ScanResult {
  symbol: string;
  ltp: number;
  latestVolume: number;
  high90d: number;
  avgVol90d: number;
  isCeoDesk: boolean;
  contractValue?: number;
  riskValue?: number;
}

function App() {
  const [scanScope, setScanScope] = useState<ScanResult[]>([]);
  const [ceoDesk, setCeoDesk] = useState<ScanResult[]>([]);
  const [syncedCount, setSyncedCount] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [actionLogs, setActionLogs] = useState<string[]>([]);
  
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/scan/status');
      const data = await res.json();
      if (data.success) setSyncedCount(data.syncedCount);
    } catch {}
  };

  const start90dSync = async () => {
    try {
      await fetch('/api/scan/sync-90d', { method: 'POST' });
      addLog("Initiated 90-day data sync (Background task).");
    } catch {}
  };

  const runScan = async () => {
    setIsScanning(true);
    try {
      const res = await fetch('/api/scan/results');
      const data = await res.json();
      if (data.success) {
        setScanScope(data.data.scanScope || []);
        setCeoDesk(data.data.ceoDesk || []);
        addLog(`Scan complete. Found ${data.data.scanScope?.length || 0} in Scope, ${data.data.ceoDesk?.length || 0} at CEO Desk.`);
      } else {
        addLog(`Scan failed: ${data.error}`);
      }
    } catch (e) {
      addLog(`Scan fetch error: ${String(e)}`);
    }
    setIsScanning(false);
  };

  const handleCeoAction = async (symbol: string, action: 'BUY' | 'HOLD' | 'CANCEL') => {
    try {
      addLog(`Sending ${action} directive for ${symbol}...`);
      const res = await fetch('/api/scan/ceo-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, action })
      });
      const data = await res.json();
      if (data.success) {
        addLog(`SUCCESS: ${data.message}`);
        // Refresh scan to update UI
        runScan();
      } else {
        addLog(`ERROR: ${data.message}`);
      }
    } catch (e) {
      addLog(`Action failed: ${String(e)}`);
    }
  };

  const addLog = (msg: string) => {
    setActionLogs(prev => [ `[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 10));
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-zinc-100 p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header Section */}
        <header className="flex justify-between items-end border-b border-zinc-800 pb-6">
          <div>
            <h1 className="text-3xl font-light tracking-tight text-white flex items-center gap-3">
              <TrendingUp className="text-indigo-400" />
              mTrade Scan Engine
            </h1>
            <p className="text-zinc-500 mt-2">Algorithmic scanner & CEO Desk Execution</p>
          </div>
          
          <div className="flex gap-4">
             <div className="bg-zinc-900 border border-zinc-800 px-4 py-2 rounded-lg flex items-center gap-3">
                <span className="text-sm text-zinc-400">90D Data Keeper:</span>
                <span className="text-emerald-400 font-mono">{syncedCount} Stocks</span>
                <button onClick={start90dSync} title="Sync 90D Data" className="text-zinc-500 hover:text-white transition-colors">
                  <RefreshCw size={16} />
                </button>
             </div>
             
             <button 
                onClick={runScan}
                disabled={isScanning}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg flex items-center gap-2 transition-all disabled:opacity-50"
             >
                {isScanning ? <RefreshCw className="animate-spin" size={18} /> : <Play size={18} />}
                {isScanning ? 'Scanning...' : 'Run Live Scan (mTrade)'}
             </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Scan Scope Column */}
          <div className="lg:col-span-2 space-y-6">
             {/* CEO Desk (High Priority) */}
             {ceoDesk.length > 0 && (
               <div className="bg-emerald-950/20 border border-emerald-900/50 rounded-xl overflow-hidden">
                 <div className="bg-emerald-900/40 p-4 border-b border-emerald-900/50 flex items-center gap-3">
                    <AlertCircle className="text-emerald-400 animate-pulse" />
                    <h2 className="text-lg font-medium text-emerald-100">CEO Desk (Action Required)</h2>
                 </div>
                 <div className="p-4 space-y-4">
                   {ceoDesk.map((item, idx) => (
                     <div key={idx} className="bg-black/40 border border-emerald-900/30 p-5 rounded-lg flex flex-col md:flex-row justify-between gap-4">
                        <div className="space-y-2">
                           <div className="flex items-baseline gap-3">
                             <span className="text-xl font-bold text-white">{item.symbol}</span>
                             <span className="text-emerald-400 font-mono flex items-center gap-1">
                               <TrendingUp size={14} /> ₹{item.ltp.toFixed(2)}
                             </span>
                           </div>
                           <div className="text-sm text-zinc-400 grid grid-cols-2 gap-x-6 gap-y-1">
                              <div>90D High: <span className="text-white">₹{item.high90d.toFixed(2)}</span></div>
                              <div>Volume: <span className="text-white">{(item.latestVolume/1000).toFixed(1)}k</span> <span className="text-xs text-zinc-500">(Avg: {(item.avgVol90d/1000).toFixed(1)}k)</span></div>
                              
                              <div className="col-span-2 mt-2 pt-2 border-t border-emerald-900/30 text-amber-200">
                                 <div>Estimated Contract Value: <span className="font-mono text-amber-400">₹{item.contractValue?.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                                 <div>Risk Value (5% SL): <span className="font-mono text-rose-400">₹{item.riskValue?.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                              </div>
                           </div>
                        </div>
                        
                        <div className="flex flex-row md:flex-col gap-2 justify-center">
                           <button 
                             onClick={() => handleCeoAction(item.symbol, 'BUY')}
                             className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded font-medium flex items-center justify-center gap-2 transition-colors border border-emerald-500/50"
                           >
                             <CheckCircle size={16} /> Execute Buy
                           </button>
                           <button 
                             onClick={() => handleCeoAction(item.symbol, 'HOLD')}
                             className="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-2 rounded font-medium flex items-center justify-center gap-2 transition-colors border border-zinc-700"
                           >
                             <Clock size={16} /> Hold (Keep Open)
                           </button>
                           <button 
                             onClick={() => handleCeoAction(item.symbol, 'CANCEL')}
                             className="bg-rose-950 hover:bg-rose-900 text-rose-200 px-6 py-2 rounded font-medium flex items-center justify-center gap-2 transition-colors border border-rose-900"
                           >
                             <XCircle size={16} /> Cancel (Remove)
                           </button>
                        </div>
                     </div>
                   ))}
                 </div>
               </div>
             )}

             {/* Standard Scan Scope */}
             <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl overflow-hidden">
                 <div className="p-4 border-b border-zinc-800 flex items-center gap-3">
                    <Search className="text-zinc-400" />
                    <h2 className="text-lg font-medium">Scan Scope (Radar)</h2>
                    <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded ml-auto">
                       Criteria: 0.98% High OR 2x Vol
                    </span>
                 </div>
                 
                 <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                       <thead className="bg-zinc-900/80 text-zinc-500 border-b border-zinc-800">
                          <tr>
                             <th className="font-medium p-4">Symbol</th>
                             <th className="font-medium p-4">LTP</th>
                             <th className="font-medium p-4">90D High</th>
                             <th className="font-medium p-4">Curr Vol</th>
                             <th className="font-medium p-4">90D Avg Vol</th>
                             <th className="font-medium p-4">Status</th>
                          </tr>
                       </thead>
                       <tbody className="divide-y divide-zinc-800/50">
                          {scanScope.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="p-8 text-center text-zinc-500">
                                {isScanning ? "Scanning universe..." : "No stocks currently in scan scope."}
                              </td>
                            </tr>
                          ) : scanScope.map((item, idx) => (
                             <tr key={idx} className="hover:bg-zinc-800/20 transition-colors">
                                <td className="p-4 font-bold text-indigo-300">{item.symbol}</td>
                                <td className="p-4 font-mono text-zinc-200">₹{item.ltp.toFixed(2)}</td>
                                <td className="p-4 font-mono text-zinc-500">₹{item.high90d.toFixed(2)}</td>
                                <td className={`p-4 font-mono ${item.latestVolume >= 2 * item.avgVol90d ? 'text-amber-400' : 'text-zinc-500'}`}>
                                  {(item.latestVolume).toLocaleString()}
                                </td>
                                <td className="p-4 font-mono text-zinc-500">{(item.avgVol90d).toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                                <td className="p-4">
                                  {item.isCeoDesk ? (
                                    <span className="text-xs bg-emerald-950 text-emerald-400 border border-emerald-900 px-2 py-1 rounded">CEO DESK</span>
                                  ) : (
                                    <span className="text-xs bg-indigo-950/50 text-indigo-400 border border-indigo-900/50 px-2 py-1 rounded">RADAR</span>
                                  )}
                                </td>
                             </tr>
                          ))}
                       </tbody>
                    </table>
                 </div>
             </div>
          </div>

          {/* Side Panel: Action Logs */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 h-fit sticky top-8">
             <h3 className="font-medium flex items-center gap-2 mb-4 text-zinc-300">
                System Activity
             </h3>
             <div className="space-y-3 font-mono text-xs text-zinc-400">
                {actionLogs.length === 0 && <div className="text-zinc-600 italic">No recent activity.</div>}
                {actionLogs.map((log, i) => (
                  <div key={i} className="border-l border-zinc-700 pl-3">
                     {log}
                  </div>
                ))}
             </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}

export default App;
