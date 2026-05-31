import React, { useState, useMemo } from 'react';

function App() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [multiplier, setMultiplier] = useState(1.5);
  const [results, setResults] = useState<any[]>([]);

  const generateReport = async () => {
    setLoading(true);
    setMessage('Generating report... this may take some time depending on the number of stocks.');
    try {
      const resp = await fetch('/api/generate-report', { method: 'POST' });
      const data = await resp.json();
      if (data.success) {
        setMessage('Report generated successfully! You can now download it.');
        if (data.data) {
           setResults(data.data);
        }
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const downloadReport = () => {
    window.location.href = '/api/download-report';
  };

  const filteredResults = useMemo(() => {
    return results.filter(stock => 
      stock.last5mVolume > (multiplier * stock.avg5mVol60d)
    );
  }, [results, multiplier]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-start justify-center p-8 font-sans text-slate-900 mt-10">
      <div className="max-w-4xl w-full bg-white rounded-xl shadow-sm border border-slate-200 p-8 space-y-8">
        
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 mb-2">Data Keeper</h1>
          <p className="text-slate-500">Generate and download historical volume baselines and highs/lows for tracked stocks.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={generateReport}
            disabled={loading}
            className={`w-full py-3 px-4 rounded-lg font-medium transition-colors ${loading ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
          >
            {loading ? 'Processing...' : 'Generate New Report & Refresh Data'}
          </button>
          
          <button
            onClick={downloadReport}
            className="w-full py-3 px-4 rounded-lg font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
          >
            Download Latest Report.xlsx
          </button>
        </div>

        {message && (
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-100 text-sm text-slate-600 text-center">
            {message}
          </div>
        )}

        {results.length > 0 && (
          <div className="pt-8 border-t border-slate-200 space-y-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Volume Analytics</h2>
                <p className="text-sm text-slate-500">Showing stocks where Last 5 Min Volume &gt; (Multiplier × Avg 5 Min Volume for 60 Days)</p>
              </div>
              <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg p-2">
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

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 border-y border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-3 px-4 font-medium">Stock</th>
                    <th className="py-3 px-4 font-medium text-right">Avg 5m Vol (60d)</th>
                    <th className="py-3 px-4 font-medium text-right">Last 5m Vol</th>
                    <th className="py-3 px-4 font-medium text-right text-blue-600">Multiplier Met</th>
                    <th className="py-3 px-4 font-medium text-right">1m Vol (MStock)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredResults.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        No stocks meet the current multiplier criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredResults.map((stock, i) => {
                      const actualMultiplier = stock.avg5mVol60d > 0 ? (stock.last5mVolume / stock.avg5mVol60d) : 0;
                      return (
                        <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                          <td className="py-3 px-4 font-medium text-slate-900">{stock.symbol}</td>
                          <td className="py-3 px-4 text-right text-slate-600">{Math.round(stock.avg5mVol60d).toLocaleString()}</td>
                          <td className="py-3 px-4 text-right font-medium text-slate-900">{Math.round(stock.last5mVolume).toLocaleString()}</td>
                          <td className="py-3 px-4 text-right font-medium text-blue-600">{actualMultiplier.toFixed(2)}x</td>
                          <td className="py-3 px-4 text-right text-slate-600">{stock.last1mVolume.toLocaleString()}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
