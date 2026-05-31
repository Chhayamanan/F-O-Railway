import React, { useState, useMemo, useEffect } from 'react';

function App() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [multiplier, setMultiplier] = useState(2.0);
  const [results, setResults] = useState<any[]>([]);
  const [buying, setBuying] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const generateReport = async (silent: boolean = false) => {
    if (!silent) {
      setLoading(true);
      setMessage('Refreshing data...');
    }
    try {
      const resp = await fetch('/api/generate-report', { method: 'POST' });
      const data = await resp.json();
      if (data.success) {
        if (!silent) setMessage('Data refreshed successfully!');
        if (data.data) {
           setResults(data.data);
           setLastRefreshed(new Date());
        }
      } else {
        if (!silent) setMessage(`Error: ${data.error}`);
      }
    } catch (err: any) {
      if (!silent) setMessage(`Error: ${err.message}`);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch on mount
    generateReport(true);
    
    // Auto-refresh every 1 minute
    const intervalId = setInterval(() => {
        generateReport(true);
    }, 60 * 1000);

    return () => clearInterval(intervalId);
  }, []);

  const downloadReport = () => {
    window.location.href = '/api/download-report';
  };

  const filteredResults = useMemo(() => {
    return results.filter(stock => 
      stock.last5mVolume > (multiplier * stock.avg5mVol60d)
    );
  }, [results, multiplier]);

  const handleBuy = async (stock: any) => {
    try {
      const res = await fetch('/api/buy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          symbol: stock.symbol,
          token: stock.mstockToken
        })
      });
      const data = await res.json();
      if (data.success) {
        alert(`Successfully placed order for ${stock.symbol}`);
      } else {
        alert(`Failed to place order for ${stock.symbol}: ${data.error}`);
      }
    } catch (e: any) {
      alert(`Error placing order: ${e.message}`);
    }
  };

  const handleBuyAllEligible = async () => {
     if (!filteredResults.length) return;
     setBuying(true);
     let successCount = 0;
     let failCount = 0;
     for (const stock of filteredResults) {
        try {
          const res = await fetch('/api/buy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol: stock.symbol, token: stock.mstockToken })
          });
          const data = await res.json();
          if (data.success) successCount++;
          else failCount++;
        } catch (e) {
          failCount++;
        }
     }
     setBuying(false);
     alert(`Finished buying. Success: ${successCount}. Failed: ${failCount}`);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-start justify-center p-8 font-sans text-slate-900 mt-10">
      <div className="max-w-5xl w-full bg-white rounded-xl shadow-sm border border-slate-200 p-8 space-y-8">
        
        <div className="flex flex-col md:flex-row items-center justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 mb-2">Live Volume Radar</h1>
              <p className="text-slate-500 text-sm">
                Real-time tracking of volume surges.
                {lastRefreshed && <span className="ml-2 font-medium text-slate-700">Last updated: {lastRefreshed.toLocaleTimeString()}</span>}
              </p>
            </div>
            <div className="flex gap-2 mt-4 md:mt-0">
                <button
                    onClick={() => generateReport(false)}
                    disabled={loading}
                    className="px-4 py-2 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 disabled:opacity-50 transition-all text-sm"
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
                <h2 className="text-xl font-semibold text-slate-900">Eligible Breakouts</h2>
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
                <button onClick={handleBuyAllEligible} disabled={buying || filteredResults.length === 0} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 shadow-sm font-medium">
                  {buying ? 'Buying...' : 'Buy All Eligible'}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200 shadow-sm">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-medium">Stock Name</th>
                    <th className="py-3 px-4 font-medium text-right">Avg 5m Vol (60d)</th>
                    <th className="py-3 px-4 font-medium text-right">Last 5m Vol</th>
                    <th className="py-3 px-4 font-medium text-right text-blue-600">Surge Ratio</th>
                    <th className="py-3 px-4 font-medium text-right">1m Vol</th>
                    <th className="py-3 px-4 font-medium text-right">1m Change</th>
                    <th className="py-3 px-4 font-medium text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredResults.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 bg-white text-center text-slate-500">
                        <p className="text-base text-slate-600 font-medium mb-1">No breakout signals detected</p>
                        <p className="text-sm">Currently no stocks meet the {multiplier}x volume criteria.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredResults.map((stock, i) => {
                      const actualMultiplier = stock.avg5mVol60d > 0 ? (stock.last5mVolume / stock.avg5mVol60d) : 0;
                      const changePositive = stock.last1mChangePct >= 0;
                      return (
                        <tr key={i} className="bg-white hover:bg-slate-50 transition-colors">
                          <td className="py-3 px-4 font-medium text-slate-900">{stock.symbol}</td>
                          <td className="py-3 px-4 text-right text-slate-600">{Math.round(stock.avg5mVol60d).toLocaleString()}</td>
                          <td className="py-3 px-4 text-right font-semibold text-slate-900">{Math.round(stock.last5mVolume).toLocaleString()}</td>
                          <td className="py-3 px-4 text-right font-medium text-blue-600">{actualMultiplier.toFixed(2)}x</td>
                          <td className="py-3 px-4 text-right text-slate-600">{stock.last1mVolume.toLocaleString()}</td>
                          <td className={`py-3 px-4 text-right font-medium ${changePositive ? 'text-green-600' : 'text-red-500'}`}>
                             {changePositive ? '+' : ''}{stock.last1mChangePct.toFixed(2)}%
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button onClick={() => handleBuy(stock)} className="px-4 py-1.5 bg-slate-900 text-white rounded text-xs font-medium hover:bg-slate-800 transition-colors shadow-sm">
                              Buy 1 Qty
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

             {/* Show all stocks below the eligible ones for full visibility */}
             {results.length > 0 && results.length !== filteredResults.length && (
                <div className="pt-8 opacity-70 hover:opacity-100 transition-opacity">
                    <h3 className="text-sm font-medium text-slate-500 mb-3 uppercase tracking-wider">Other Tracked Stocks</h3>
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full text-left text-xs whitespace-nowrap">
                            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                            <tr>
                                <th className="py-2 px-4 font-medium">Stock Name</th>
                                <th className="py-2 px-4 font-medium text-right">Avg 5m Vol</th>
                                <th className="py-2 px-4 font-medium text-right">Last 5m Vol</th>
                                <th className="py-2 px-4 font-medium text-right">Surge Ratio</th>
                                <th className="py-2 px-4 font-medium text-right">1m Vol</th>
                            </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {results.filter(s => s.last5mVolume <= (multiplier * s.avg5mVol60d)).map((stock, i) => {
                                    const actualMultiplier = stock.avg5mVol60d > 0 ? (stock.last5mVolume / stock.avg5mVol60d) : 0;
                                    return (
                                        <tr key={i} className="bg-white">
                                            <td className="py-2 px-4 text-slate-700">{stock.symbol}</td>
                                            <td className="py-2 px-4 text-right text-slate-500">{Math.round(stock.avg5mVol60d).toLocaleString()}</td>
                                            <td className="py-2 px-4 text-right text-slate-700">{Math.round(stock.last5mVolume).toLocaleString()}</td>
                                            <td className="py-2 px-4 text-right text-slate-500">{actualMultiplier.toFixed(2)}x</td>
                                            <td className="py-2 px-4 text-right text-slate-500">{stock.last1mVolume.toLocaleString()}</td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
             )}

        </div>
      </div>
    </div>
  );
}

export default App;
