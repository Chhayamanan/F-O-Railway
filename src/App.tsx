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
  type?: 'FUT' | 'OPTIONS' | 'MTF' | 'INTRADAY';
  recommendedOption?: 'CALL' | 'PUT';
  changePct?: number;
  volMultiplier?: number;
  mtfMargin?: number;
  message?: string;
  qty?: number;
}

function App() {
  const [scanScope, setScanScope] = useState<ScanResult[]>([]);
  const [ceoDesk, setCeoDesk] = useState<ScanResult[]>([]);
  const [syncedCount, setSyncedCount] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [actionLogs, setActionLogs] = useState<string[]>([]);
  const [isAutoScanning, setIsAutoScanning] = useState(false);
  const [activeTab, setActiveTab] = useState<'FNO' | 'MTF' | 'INTRADAY' | 'STOP_LOSS'>('FNO');
  const [volMultiplier, setVolMultiplier] = useState<number>(1.5);
  const [baseVolMultiplier, setBaseVolMultiplier] = useState<number>(2.0);
  const [highDistance, setHighDistance] = useState<number>(0.98);
  const [portfolio, setPortfolio] = useState<any[]>([]);
  
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

  const fetchPortfolio = async () => {
    try {
      addLog("Fetching portfolio holdings...");
      const res = await fetch('/api/portfolio');
      const data = await res.json();
      if (data.success && data.portfolio) {
        setPortfolio(data.portfolio);
        addLog(`Fetched ${data.portfolio.length} portfolio positions.`);
      } else {
        addLog(`Portfolio fetch failed: ${data.error || 'Unknown error'}`);
      }
    } catch (e) {
      addLog(`Portfolio fetch error: ${String(e)}`);
    }
  };

  const runScan = async () => {
    setIsScanning(true);
    if (activeTab === 'STOP_LOSS') {
       await fetchPortfolio();
       setIsScanning(false);
       return;
    }
    try {
      const queryParams = new URLSearchParams({
        volMultiplier: volMultiplier.toString(),
        baseVolMultiplier: baseVolMultiplier.toString(),
        highDistance: highDistance.toString()
      });
      const res = await fetch(`/api/scan/results?${queryParams.toString()}`);
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

  const handleCeoAction = async (symbol: string, action: 'BUY' | 'HOLD' | 'CANCEL', type: 'FUT' | 'OPTIONS' = 'FUT') => {
    try {
      addLog(`Sending ${action} directive for ${symbol} (${type})...`);
      const res = await fetch('/api/scan/ceo-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, action, type })
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

  const handleStopLoss = async (symbol: string, quantity: number, avgPrice: number, type: string, symbolToken?: string, tradingSymbol?: string) => {
    try {
      const stopLossPrice = avgPrice * 0.95; // 5% stop loss
      addLog(`Sending Execute Stop Loss for ${symbol} @ ₹${stopLossPrice.toFixed(2)}...`);
      const res = await fetch('/api/trade/stop-loss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, quantity, stopLossPrice, type, symbolToken, tradingSymbol })
      });
      const data = await res.json();
      if (data.success) {
        addLog(`SUCCESS: ${data.message} (Order ID: ${data.orderId})`);
      } else {
        addLog(`ERROR: ${data.error}`);
      }
    } catch (e) {
      addLog(`SL Action failed: ${String(e)}`);
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

  useEffect(() => {
    let autoScanInterval: NodeJS.Timeout;
    if (isAutoScanning) {
      runScan();
      autoScanInterval = setInterval(() => {
        runScan();
      }, 30000);
    }
    return () => clearInterval(autoScanInterval);
  }, [isAutoScanning]);

  useEffect(() => {
    if (activeTab === 'STOP_LOSS') {
      fetchPortfolio();
    }
  }, [activeTab]);

  const filteredCeoDesk = ceoDesk.filter(x => {
    if (activeTab === 'FNO') return x.type === 'FUT' || x.type === 'OPTIONS' || !x.type;
    return x.type === activeTab;
  });
  const filteredScanScope = scanScope.filter(x => {
    if (activeTab === 'FNO') return x.type === 'FUT' || x.type === 'OPTIONS' || !x.type;
    return x.type === activeTab;
  });

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
                onClick={() => setIsAutoScanning(!isAutoScanning)}
                className={`px-6 py-2 rounded-lg flex items-center gap-2 transition-all border ${isAutoScanning ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400' : 'bg-transparent border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500'}`}
             >
                {isAutoScanning ? <AlertCircle className="animate-pulse" size={18} /> : <Clock size={18} />}
                {isAutoScanning ? 'Auto Scan: ON (30s)' : 'Auto Scan: OFF'}
             </button>

             <button 
                onClick={runScan}
                disabled={isScanning || isAutoScanning}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg flex items-center gap-2 transition-all disabled:opacity-50"
             >
                {isScanning ? <RefreshCw className="animate-spin" size={18} /> : <Play size={18} />}
                {isScanning ? 'Scanning...' : 'Run Live Scan (mTrade)'}
             </button>
          </div>
        </header>

        <div className="flex gap-4 border-b border-zinc-800 pb-2">
          <button 
            onClick={() => setActiveTab('FNO')}
            className={`px-4 py-2 font-medium text-sm transition-colors ${activeTab === 'FNO' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            FNO (Futures & Options)
          </button>
          <button 
            onClick={() => setActiveTab('MTF')}
            className={`px-4 py-2 font-medium text-sm transition-colors ${activeTab === 'MTF' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            MTF
          </button>
          <button 
            onClick={() => setActiveTab('INTRADAY')}
            className={`px-4 py-2 font-medium text-sm transition-colors ${activeTab === 'INTRADAY' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Intraday
          </button>
          <button 
            onClick={() => setActiveTab('STOP_LOSS')}
            className={`px-4 py-2 font-medium text-sm transition-colors ${activeTab === 'STOP_LOSS' ? 'text-rose-400 border-b-2 border-rose-400' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Stop Loss
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Scan Scope Column */}
          <div className="lg:col-span-2 space-y-6">
             {activeTab === 'STOP_LOSS' ? (
                <div className="bg-rose-950/20 border border-rose-900/50 rounded-xl overflow-hidden">
                  <div className="bg-rose-900/40 p-4 border-b border-rose-900/50 flex items-center justify-between">
                     <div className="flex items-center gap-3">
                       <AlertCircle className="text-rose-400" />
                       <h2 className="text-lg font-medium text-rose-100">Portfolio Margin Drop (Stop Loss)</h2>
                     </div>
                     <button onClick={fetchPortfolio} className="text-sm bg-rose-900/50 hover:bg-rose-800 text-rose-200 px-3 py-1.5 rounded transition-colors border border-rose-700/50">
                        Refresh Portfolio
                     </button>
                  </div>
                  <div className="p-4 space-y-4">
                    {portfolio.length === 0 ? (
                      <div className="text-zinc-500 text-center py-8">No stocks found in portfolio.</div>
                    ) : portfolio.map((item, idx) => (
                      <div key={idx} className="bg-black/40 border border-rose-900/30 p-5 rounded-lg flex flex-col md:flex-row justify-between gap-4">
                         <div className="space-y-2 flex-grow">
                            <div className="flex items-baseline gap-3">
                              <span className="text-xl font-bold text-white">{item.symbol}</span>
                              <span className="text-rose-400 font-mono flex items-center gap-1">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${item.type === 'FNO' ? 'bg-indigo-900/50 border-indigo-700 text-indigo-300' : 'bg-rose-900/50 border-rose-700 text-rose-300'}`}>
                                   {item.type}
                                </span>
                              </span>
                            </div>
                            <div className="text-sm text-zinc-400 grid grid-cols-2 gap-x-6 gap-y-1">
                               <div>Avg Buy Price: <span className="text-white">₹{item.avgPrice.toFixed(2)}</span></div>
                               <div>Current Price: <span className="text-white">₹{item.currentPrice.toFixed(2)}</span></div>
                               <div>Qty: <span className="text-white">{item.qty}</span></div>
                               <div>Value: <span className="text-white">₹{item.value.toLocaleString()}</span></div>
                               
                               <div className="col-span-2 mt-2 pt-2 border-t border-rose-900/30">
                                  <div className="flex justify-between items-center text-rose-200">
                                    <span>Calculated Stop Loss (5%): <span className="font-mono text-rose-400 text-lg font-bold">₹{(item.avgPrice * 0.95).toFixed(2)}</span></span>
                                  </div>
                               </div>
                            </div>
                         </div>
                         
                         <div className="flex flex-row md:flex-col justify-center">
                            <button 
                              onClick={() => handleStopLoss(item.symbol, item.qty, item.avgPrice, item.type, item.symbolToken, item.tradingSymbol)}
                              className="bg-rose-600 hover:bg-rose-500 text-white px-6 py-2 rounded font-medium flex items-center justify-center gap-2 transition-colors border border-rose-500/50 h-fit"
                            >
                              <AlertCircle size={16} /> Execute 5% SL
                            </button>
                         </div>
                      </div>
                    ))}
                  </div>
                </div>
             ) : (
             <React.Fragment>
             {/* CEO Desk (High Priority) */}
             {filteredCeoDesk.length > 0 && (
               <div className="bg-emerald-950/20 border border-emerald-900/50 rounded-xl overflow-hidden">
                 <div className="bg-emerald-900/40 p-4 border-b border-emerald-900/50 flex items-center gap-3">
                    <AlertCircle className="text-emerald-400 animate-pulse" />
                    <h2 className="text-lg font-medium text-emerald-100">CEO Desk (Action Required)</h2>
                 </div>
                 <div className="p-4 space-y-4">
                   {filteredCeoDesk.map((item, idx) => (
                     <div key={idx} className="bg-black/40 border border-emerald-900/30 p-5 rounded-lg flex flex-col md:flex-row justify-between gap-4">
                        <div className="space-y-2 flex-grow">
                           <div className="flex items-baseline gap-3">
                             <span className="text-xl font-bold text-white">{item.symbol}</span>
                             <span className="text-emerald-400 font-mono flex items-center gap-1">
                               <TrendingUp size={14} /> ₹{item.ltp.toFixed(2)}
                             </span>
                             {item.changePct !== undefined && (
                               <span className={`text-sm font-mono ${item.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                 {item.changePct >= 0 ? '+' : ''}{item.changePct.toFixed(2)}%
                               </span>
                             )}
                             {item.type === 'OPTIONS' && (
                               <span className="bg-indigo-900/50 text-indigo-300 text-xs px-2 py-0.5 rounded font-mono border border-indigo-700/50">
                                 BUY {item.recommendedOption}
                               </span>
                             )}
                           </div>
                           <div className="text-sm text-zinc-400 grid grid-cols-2 gap-x-6 gap-y-1">
                              <div>90D High: <span className="text-white">₹{item.high90d.toFixed(2)}</span></div>
                              <div className="flex items-center gap-2">
                                Volume: <span className="text-white">{(item.latestVolume/1000).toFixed(1)}k</span> <span className="text-xs text-zinc-500">(Avg: {(item.avgVol90d/1000).toFixed(1)}k)</span>
                                {item.volMultiplier !== undefined && (
                                   <span className="text-amber-400 bg-amber-900/30 px-1.5 rounded text-xs ml-1">{item.volMultiplier.toFixed(1)}x</span>
                                )}
                              </div>
                              
                              <div className="col-span-2 mt-2 pt-2 border-t border-emerald-900/30 text-amber-200">
                                 {item.message ? (
                                   <div className="text-emerald-300 font-mono text-sm">{item.message}</div>
                                 ) : (
                                   <>
                                     {item.contractValue && <div>Estimated Contract Value: <span className="font-mono text-amber-400">₹{item.contractValue?.toLocaleString(undefined, {minimumFractionDigits: 2}) || 'N/A'}</span></div>}
                                     <div className="flex justify-between items-center pr-4">
                                       {item.riskValue && <span>Risk Value (5% SL): <span className="font-mono text-rose-400">₹{item.riskValue?.toLocaleString(undefined, {minimumFractionDigits: 2}) || 'N/A'}</span></span>}
                                       {item.mtfMargin && (
                                          <span className="text-xs text-indigo-300">MTF Margin: <span className="font-mono text-indigo-400 font-bold">{item.mtfMargin}%</span></span>
                                       )}
                                       {item.qty && (
                                          <span className="text-xs text-indigo-300">Calculated Qty: <span className="font-mono text-emerald-400 font-bold">{item.qty}</span></span>
                                       )}
                                     </div>
                                   </>
                                 )}
                              </div>
                           </div>
                        </div>
                        
                        <div className="flex flex-row md:flex-col gap-2 justify-center">
                           <button 
                             onClick={() => handleCeoAction(item.symbol, 'BUY', item.type || 'FUT')}
                             className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded font-medium flex items-center justify-center gap-2 transition-colors border border-emerald-500/50"
                           >
                             <CheckCircle size={16} /> Execute Buy
                           </button>
                           <button 
                             onClick={() => handleCeoAction(item.symbol, 'HOLD', item.type || 'FUT')}
                             className="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-2 rounded font-medium flex items-center justify-center gap-2 transition-colors border border-zinc-700"
                           >
                             <Clock size={16} /> Hold (Keep Open)
                           </button>
                           <button 
                             onClick={() => handleCeoAction(item.symbol, 'CANCEL', item.type || 'FUT')}
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
                 <div className="p-4 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                    <div className="flex items-center gap-3">
                       <Search className="text-zinc-400" />
                       <h2 className="text-lg font-medium">Scan Scope (Radar)</h2>
                    </div>
                    <div className="flex items-center gap-4 flex-wrap justify-end">
                        {activeTab !== 'STOP_LOSS' && (
                           <>
                              {activeTab === 'FNO' && (
                                <div className="flex items-center gap-2">
                                   <label className="text-xs text-zinc-400">Options Vol Factor:</label>
                                   <input 
                                     type="number" step="0.1" min="0.5" max="10.0" 
                                     value={volMultiplier} onChange={(e) => setVolMultiplier(Number(e.target.value))}
                                     className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white"
                                   />
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                 <label className="text-xs text-zinc-400">High Dist:</label>
                                 <input 
                                   type="number" step="0.01" min="0.8" max="1.0" 
                                   value={highDistance} onChange={(e) => setHighDistance(Number(e.target.value))}
                                   className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white"
                                 />
                              </div>
                              <div className="flex items-center gap-2">
                                 <label className="text-xs text-zinc-400">Base Vol Factor:</label>
                                 <input 
                                   type="number" step="0.1" min="0.5" max="10.0" 
                                   value={baseVolMultiplier} onChange={(e) => setBaseVolMultiplier(Number(e.target.value))}
                                   className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white"
                                 />
                              </div>
                           </>
                        )}
                        <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded whitespace-nowrap">
                           {activeTab === 'MTF' ? 'Criteria: Range <= 30%' : `Criteria: ${Math.round(highDistance * 100)}% High OR ${baseVolMultiplier}x Vol`}
                        </span>
                     </div>
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
                          {filteredScanScope.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="p-8 text-center text-zinc-500">
                                {isScanning ? "Scanning universe..." : "No stocks currently in scan scope."}
                              </td>
                            </tr>
                          ) : filteredScanScope.map((item, idx) => (
                             <tr key={idx} className="hover:bg-zinc-800/20 transition-colors">
                                <td className="p-4 font-bold text-indigo-300">
                                   {item.symbol}
                                   {item.type === 'OPTIONS' && (
                                      <span className="ml-2 bg-indigo-900/50 text-indigo-300 text-[10px] px-1.5 py-0.5 rounded border border-indigo-700/50">OPT</span>
                                   )}
                                   {item.mtfMargin && (
                                      <span className="ml-2 bg-zinc-800 text-zinc-400 text-[10px] px-1.5 py-0.5 rounded border border-zinc-700">MTF {item.mtfMargin}%</span>
                                   )}
                                </td>
                                <td className="p-4 font-mono text-zinc-200">
                                  ₹{item.ltp.toFixed(2)}
                                  {item.changePct !== undefined && (
                                    <span className={`block text-[10px] ${item.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {item.changePct >= 0 ? '+' : ''}{item.changePct.toFixed(2)}%
                                    </span>
                                  )}
                                </td>
                                <td className="p-4 font-mono text-zinc-500">₹{item.high90d.toFixed(2)}</td>
                                <td className={`p-4 font-mono ${item.latestVolume >= 2 * item.avgVol90d ? 'text-amber-400' : 'text-zinc-500'}`}>
                                  {(item.latestVolume).toLocaleString()}
                                  {item.volMultiplier !== undefined && (
                                     <span className="block text-[10px] text-amber-500">{item.volMultiplier.toFixed(1)}x avg</span>
                                  )}
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
             </React.Fragment>
             )}
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
