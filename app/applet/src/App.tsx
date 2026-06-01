import React, { useState, useEffect, useMemo } from 'react';

function App() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [processing, setProcessing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [multiplier, setMultiplier] = useState(2.0);

  // 1. Calculate matching stocks on the fly based on your formula
  const filteredResults = useMemo(() => {
    return results.filter(stock => 
      stock.last1mVolume > (multiplier * stock.avg5mVol60d)
    );
  }, [results, multiplier]);

  // Single order API runner
  const executeSingleOrder = async (stock: any, action: 'BUY' | 'SELL') => {
    try {
      const res = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: stock.symbol,
          token: stock.mstockToken,
          action
        })
      });
      const data = await res.json();
      if (data.success) {
        console.log(`[AUTO] Successfully placed ${action} order for ${stock.symbol}`);
      } else {
        console.error(`[AUTO] Failed ${action} order for ${stock.symbol}: ${data.error}`);
      }
    } catch (e: any) {
      console.error(`[AUTO] Fetch error during execution: ${e.message}`);
    }
  };

  // 2. Main data generator that triggers Auto-Execution right after receiving data
  const generateReportAndAutoTrade = async (silent: boolean = false, runAutoExecute: boolean = false) => {
    if (!silent) {
      setLoading(true);
      setMessage('Refreshing data...');
    }
    try {
      const resp = await fetch('/api/generate-report', { method: 'POST' });
      const data = await resp.json();
      
      if (data.success && data.data) {
        setResults(data.data);
        setLastRefreshed(new Date());
        if (!silent) setMessage('Data refreshed successfully!');

        // --- FULL AUTOMATION LOGIC ---
        if (runAutoExecute) {
          // Re-calculate math locally using incoming data to avoid stale state issues
          const currentMatches = data.data.filter((stock: any) => 
            stock.last1mVolume > (multiplier * stock.avg5mVol60d)
          );

          if (currentMatches.length > 0) {
            console.log(`[AUTO] Found ${currentMatches.length} breakout matches. Processing trades...`);
            setProcessing(true);
            
            for (const stock of currentMatches) {
              const action = stock.last1mChangePct >= 0 ? 'BUY' : 'SELL';
              await executeSingleOrder(stock, action);
            }
            
            setProcessing(false);
          }
        }
        // ------------------------------

      } else {
        if (!silent) setMessage(`Error: ${data.error}`);
      }
    } catch (err: any) {
      if (!silent) setMessage(`Error: ${err.message}`);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Initial fetch on page mount (safely checks data without entering live market orders)
  useEffect(() => {
    generateReportAndAutoTrade(true, false);
  }, []);

  // 3. Hands-Free Scanning & Order Loop (Runs every 60 seconds)
  useEffect(() => {
    let intervalId: any;
    if (isScanning) {
      intervalId = setInterval(() => {
        // Automatically fetch data AND execute matching trades
        generateReportAndAutoTrade(true, true);
      }, 60 * 1000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isScanning, multiplier]); // list multiplier to keep scope updated

  const downloadReport = () => {
    window.location.href = '/api/download-report';
  };

  const handleManualOrder = (stock: any) => {
    const action = stock.last1mChangePct >= 0 ? 'BUY' : 'SELL';
    executeSingleOrder(stock, action);
    alert(`Dispatched manual manual ${action} target request for ${stock.symbol}`);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-start justify-center p-8 font-sans text-slate-900 mt-10">
      <div className="max-w-5xl w-full bg-white rounded-xl shadow-sm border border-slate-200 p-8 space-y-8">
        
        <div className="flex flex-col md:flex-row items-center justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 mb-2">1-Min Action Radar</h1>
              <p className="text-slate-500 text-sm">
                Real-time 1m tracking for Intraday Buy/Sell decisions.
                {lastRefreshed && <span className="ml-2 font-medium text-slate-700">Last updated: {lastRefreshed.toLocaleTimeString()}</span>}
              </p>
              {isScanning && (
                <p className="text-blue-600 font-semibold text-xs mt-1 animate-pulse">
                  ⚡ Fully Automated Robot Trading Mode is Active!
                </p>
              )}
            </div>
            <div className="flex gap-2 mt-4 md:mt-0">
                <button
                    onClick={() => setIsScanning(!isScanning)}
                    className={`px-4 py-2 rounded-lg font-bold transition-all text-sm shadow-sm ${
                      isScanning 
                        ? 'bg-red-500 text-white hover:bg-red-600 animate-pulse' 
                        : 'bg-green-600 text-white hover:bg-green-700'
                    }`}
                >
                    {isScanning ? '🛑 STOP AUTOMATED BOT' : '🚀 START AUTOMATED BOT'}
                </button>
                <button
                    onClick={downloadReport}
                    className="px-4 py-2 bg-slate-100 text-slate-700 border border-slate-200 rounded-lg font-medium hover:bg-slate-200 text-sm shadow-sm"
                >
                    Download Excel
                </button>
                <button
                    onClick={() => generateReportAndAutoTrade(false, false)}
                    disabled={loading}
                    className="px-4 py-2 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 text-sm shadow-sm"
                >
                    {loading ? 'Refreshing...' : 'Refresh Now'}
                </button>
            </div>
        </div>

        {message && message.startsWith('Error') && (
          <div className="p-4 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600 text-center">
            {message}
          </div>
        )}

        <div className="pt-4 border-t border-slate-200 space-y-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Live Tracker</h2>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-2 shadow-sm">
                  <label className="text-sm font-medium text-slate-700 whitespace-nowrap pl-2">Volume Multiplier:</label>
                  <input 
                    type="number"
                    step="0.1"
                    min="0"
                    value={multiplier}
                    onChange={(e) => setMultiplier(parseFloat(e.target.value) || 0)}
                    className="w-20 px-2 py-1 rounded bg-white border border-slate-300 text-sm text-center focus:outline-none focus:ring-2 focus:ring-slate-900" 
                  />
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200 shadow-sm">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-medium">Stock Name</th>
                    <th className="py-3 px-4 font-medium text-right">Avg 5m Vol (60d)</th>
                    <th className="py-3 px-4 font-medium text-right">1m Vol</th>
                    <th className="py-3 px-4 font-medium text-right">1m Change</th>
                    <th className="py-3 px-4 font-medium text-center">Radar Match Direction</th>
                    <th className="py-3 px-4 font-medium text-center">Manual Force Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredResults.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 bg-white text-center text-slate-500">
                        <p className="text-base text-slate-600 font-medium mb-1">No stocks currently breakout over requirements</p>
                        <p className="text-sm text-slate-400">Turn on the Auto Bot or click Refresh Now.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredResults.map((stock, i) => {
                      const changePositive = stock.last1mChangePct >= 0;
                      const actionType = changePositive ? 'BUY' : 'SELL';
                      
                      return (
                        <tr key={i} className="bg-white hover:bg-slate-50 transition-colors">
                          <td className="py-3 px-4 font-medium text-slate-900">{stock.symbol}</td>
                          <td className="py-3 px-4 text-right text-slate-600">{Math.round(stock.avg5mVol60d).toLocaleString()}</td>
                          <td className="py-3 px-4 text-right text-slate-600">{stock.last1mVolume.toLocaleString()}</td>
                          <td className={`py-3 px-4 text-right font-medium ${changePositive ? 'text-green-600' : 'text-red-500'}`}>
                             {changePositive ? '+' : ''}{stock.last1mChangePct.toFixed(2)}%
                          </td>
                          <td className={`py-3 px-4 text-center font-bold ${actionType === 'BUY' ? 'text-green-600' : 'text-red-600'}`}>
                            🚨 MATCH: {actionType}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button onClick={() => handleManualOrder(stock)} className={`px-4 py-1.5 text-white rounded text-xs font-medium transition-colors shadow-sm ${actionType === 'BUY' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
                              Force {actionType} 1 Qty
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

        </div>
      </div>
    </div>
  );
}

export default App;
