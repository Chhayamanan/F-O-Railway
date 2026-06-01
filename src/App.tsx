import React, { useState, useEffect } from 'react';

function App() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [processing, setProcessing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [isScanning, setIsScanning] = useState(false);

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
  }, []);

  useEffect(() => {
    let intervalId: any;
    if (isScanning) {
      intervalId = setInterval(() => {
        generateReport(true);
      }, 60 * 1000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isScanning]);

  const downloadReport = () => {
    window.location.href = '/api/download-report';
  };

  const handleOrder = async (stock: any) => {
    const action = stock.last1mChangePct >= 0 ? 'BUY' : 'SELL';
    try {
      const res = await fetch('/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          symbol: stock.symbol,
          token: stock.mstockToken,
          action
        })
      });
      const data = await res.json();
      if (data.success) {
        alert(`Successfully placed ${action} order for ${stock.symbol}`);
      } else {
        alert(`Failed to place ${action} order for ${stock.symbol}: ${data.error}`);
      }
    } catch (e: any) {
      alert(`Error placing order: ${e.message}`);
    }
  };

  const handleAutoAll = async () => {
     if (!results.length) return;
     setProcessing(true);
     let successCount = 0;
     let failCount = 0;
     for (const stock of results) {
        const action = stock.last1mChangePct >= 0 ? 'BUY' : 'SELL';
        try {
          const res = await fetch('/api/order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol: stock.symbol, token: stock.mstockToken, action })
          });
          const data = await res.json();
          if (data.success) successCount++;
          else failCount++;
        } catch (e) {
          failCount++;
        }
     }
     setProcessing(false);
     alert(`Finished processing. Success: ${successCount}. Failed: ${failCount}`);
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
            </div>
            <div className="flex gap-2 mt-4 md:mt-0">
                <button
                    onClick={() => setIsScanning(!isScanning)}
                    className={`px-4 py-2 rounded-lg font-medium transition-all text-sm shadow-sm ${
                      isScanning 
                        ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100' 
                        : 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
                    }`}
                >
                    {isScanning ? 'Stop Auto-Scan' : 'Start Auto-Scan'}
                </button>
                <button
                    onClick={downloadReport}
                    className="px-4 py-2 bg-slate-100 text-slate-700 border border-slate-200 rounded-lg font-medium hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-200 focus:ring-offset-2 transition-all text-sm shadow-sm"
                >
                    Download Excel
                </button>
                <button
                    onClick={() => generateReport(false)}
                    disabled={loading}
                    className="px-4 py-2 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 disabled:opacity-50 transition-all text-sm shadow-sm"
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
                <button onClick={handleAutoAll} disabled={processing || results.length === 0} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 shadow-sm font-medium">
                  {processing ? 'Processing...' : 'Auto-Execute All'}
                </button>
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
                    <th className="py-3 px-4 font-medium text-center">Decision</th>
                    <th className="py-3 px-4 font-medium text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 bg-white text-center text-slate-500">
                        <p className="text-base text-slate-600 font-medium mb-1">No data available</p>
                        <p className="text-sm">Click Refresh Now to load stock data.</p>
                      </td>
                    </tr>
                  ) : (
                    results.map((stock, i) => {
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
                            {actionType}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button onClick={() => handleOrder(stock)} className={`px-4 py-1.5 text-white rounded text-xs font-medium transition-colors shadow-sm ${actionType === 'BUY' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
                              {actionType} 1 Qty
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
