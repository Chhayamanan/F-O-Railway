import React, { useState, useEffect } from 'react';

function App() {
  const [activeTab, setActiveTab] = useState<'stocks' | 'nifty'>('stocks');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  
  // Stock Tracker State
  const [results, setResults] = useState<any[]>([]);
  const [multiplier, setMultiplier] = useState(2.0);
  const [isScanningStocks, setIsScanningStocks] = useState(false);

  // Nifty Options State
  const [niftyData, setNiftyData] = useState<{
    ltp: number;
    high: number;
    low: number;
    lastUpdated: string;
  } | null>(null);
  const [isScanningNifty, setIsScanningNifty] = useState(false);
  const [niftyTargetQty, setNiftyTargetQty] = useState(25); // Standard Nifty Lot Size

  // Filter for stock criteria matching
  const filteredStocks = React.useMemo(() => {
    return results.filter(stock => stock.last1mVolume > (multiplier * stock.avg5mVol60d));
  }, [results, multiplier]);

  // Main Background Engine Core Routing
  const runStockTrackerLoop = async (runAutoTrade: boolean) => {
    try {
      const resp = await fetch('/api/generate-report', { method: 'POST' });
      const data = await resp.json();
      if (data.success && data.data) {
        setResults(data.data);
        if (runAutoTrade) {
          const matches = data.data.filter((s: any) => s.last1mVolume > (multiplier * s.avg5mVol60d));
          for (const stock of matches) {
            const action = stock.last1mChangePct >= 0 ? 'BUY' : 'SELL';
            await fetch('/api/order', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ symbol: stock.symbol, token: stock.mstockToken, action })
            });
          }
        }
      }
    } catch (e) { console.error("Stock track error", e); }
  };

  const runNiftyTrackerLoop = async () => {
    try {
      const resp = await fetch('/api/nifty/check-breakout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty: niftyTargetQty })
      });
      const data = await resp.json();
      if (data.success) {
        setNiftyData(data.metrics);
        if (data.executedTrade) {
          setMessage(`🚨 AUTO BOT: Successfully executed ${data.executedTrade} order!`);
        }
      }
    } catch (e) { console.error("Nifty track error", e); }
  };

  // Triggering Intervals Loops
  useEffect(() => {
    let stockInterval: any;
    if (isScanningStocks) {
      stockInterval = setInterval(() => runStockTrackerLoop(true), 60 * 1000);
    }
    return () => clearInterval(stockInterval);
  }, [isScanningStocks, multiplier]);

  useEffect(() => {
    let niftyInterval: any;
    if (isScanningNifty) {
      niftyInterval = setInterval(() => runNiftyTrackerLoop(), 5 * 1000); // Tight 5s loop for derivative options
    }
    return () => clearInterval(niftyInterval);
  }, [isScanningNifty, niftyTargetQty]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex items-start justify-center p-8 font-sans">
      <div className="max-w-5xl w-full bg-slate-800 rounded-xl shadow-2xl border border-slate-700 p-8 space-y-6">
        
        {/* Navigation Tabs Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-4">
          <div className="flex gap-4">
            <button 
              onClick={() => setActiveTab('stocks')}
              className={`px-5 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'stocks' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              📈 1-Min Stock Radar
            </button>
            <button 
              onClick={() => setActiveTab('nifty')}
              className={`px-5 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'nifty' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              ⚡ Nifty Options Range Breakout
            </button>
          </div>
          <span className="text-xs font-mono text-slate-400">System Mode: Automated High-Frequency Execution</span>
        </div>

        {message && (
          <div className="p-4 rounded-lg bg-blue-900/40 border border-blue-700 text-sm text-blue-300 text-center animate-pulse">
            {message}
          </div>
        )}

        {/* TAB 1: STOCKS RADAR */}
        {activeTab === 'stocks' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between bg-slate-850 p-4 rounded-xl border border-slate-700">
              <div className="flex items-center gap-4">
                <label className="text-sm font-medium text-slate-300">Volume Multiplier:</label>
                <input 
                  type="number" step="0.1" value={multiplier} 
                  onChange={(e) => setMultiplier(parseFloat(e.target.value) || 0)}
                  className="w-20 px-2 py-1 rounded bg-slate-700 text-white text-center border border-slate-600 focus:outline-none"
                />
              </div>
              <button 
                onClick={() => setIsScanningStocks(!isScanningStocks)}
                className={`px-6 py-2 rounded-lg font-bold text-sm ${isScanningStocks ? 'bg-red-600 animate-pulse' : 'bg-green-600'}`}
              >
                {isScanningStocks ? '🛑 STOP STOCK BOT' : '🚀 START STOCK BOT'}
              </button>
            </div>
            
            {/* Stock Rendering Grid */}
            <div className="overflow-x-auto rounded-lg border border-slate-700">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-700 text-slate-300">
                  <tr>
                    <th className="p-4">Symbol</th>
                    <th className="p-4 text-right">Avg 5m Vol</th>
                    <th className="p-4 text-right">Current 1m Vol</th>
                    <th className="p-4 text-right">1m Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700 bg-slate-800">
                  {filteredStocks.length === 0 ? (
                    <tr><td colSpan={4} className="p-8 text-center text-slate-500">No volume breakouts detected. Run tracking engine.</td></tr>
                  ) : (
                    filteredStocks.map((stock, i) => (
                      <tr key={i} className="hover:bg-slate-750">
                        <td className="p-4 font-bold">{stock.symbol}</td>
                        <td className="p-4 text-right text-slate-400">{Math.round(stock.avg5mVol60d).toLocaleString()}</td>
                        <td className="p-4 text-right text-slate-400">{stock.last1mVolume.toLocaleString()}</td>
                        <td className={`p-4 text-right font-medium ${stock.last1mChangePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {stock.last1mChangePct.toFixed(2)}%
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: NIFTY OPTIONS RANGE BREAKOUT */}
        {activeTab === 'nifty' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-slate-700/50 rounded-xl border border-slate-600 text-center">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Nifty Spot Price</p>
                <p className="text-3xl font-mono font-bold text-blue-400 mt-1">
                  {niftyData?.ltp ? niftyData.ltp.toFixed(2) : '---.--'}
                </p>
              </div>
              <div className="p-4 bg-green-950/30 rounded-xl border border-green-800/50 text-center">
                <p className="text-xs font-semibold text-green-400 uppercase tracking-wider">Session Range High</p>
                <p className="text-3xl font-mono font-bold text-green-400 mt-1">
                  {niftyData?.high ? niftyData.high.toFixed(2) : '---.--'}
                </p>
              </div>
              <div className="p-4 bg-red-950/30 rounded-xl border border-red-800/50 text-center">
                <p className="text-xs font-semibold text-red-400 uppercase tracking-wider">Session Range Low</p>
                <p className="text-3xl font-mono font-bold text-red-400 mt-1">
                  {niftyData?.low ? niftyData.low.toFixed(2) : '---.--'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between bg-slate-850 p-4 rounded-xl border border-slate-700">
              <div className="flex items-center gap-4">
                <label className="text-sm font-medium text-slate-300">Option Target Contract Qty Size:</label>
                <input 
                  type="number" step="25" value={niftyTargetQty} 
                  onChange={(e) => setNiftyTargetQty(parseInt(e.target.value) || 25)}
                  className="w-24 px-2 py-1 rounded bg-slate-700 text-white text-center border border-slate-600 focus:outline-none"
                />
              </div>
              <button 
                onClick={() => setIsScanningNifty(!isScanningNifty)}
                className={`px-6 py-2 rounded-lg font-bold text-sm transition-all ${isScanningNifty ? 'bg-red-600 animate-pulse' : 'bg-purple-600 hover:bg-purple-700'}`}
              >
                {isScanningNifty ? '🛑 STOP NIFTY OPTIONS ROBOT' : '🚀 RUN NIFTY OPTIONS ROBOT'}
              </button>
            </div>

            <div className="p-6 bg-slate-850 rounded-xl border border-slate-700 space-y-3 text-sm leading-relaxed text-slate-300">
              <h3 className="font-bold text-white text-base">🤖 Automated Derivative Execution Rules:</h3>
              <p>• The system continuously polls Nifty index price metrics inside an independent pipeline loop every 5 seconds.</p>
              <p>• If <span className="text-blue-400 font-mono">Current Spot Price</span> breaks above the established <span className="text-green-400 font-bold">Session High</span>, the bot automatically finds the nearest At-The-Money strike contract and purchases a <span className="text-green-400 font-bold">CALL Option (CE)</span>.</p>
              <p>• If <span className="text-blue-400 font-mono">Current Spot Price</span> drops below the established <span className="text-red-400 font-bold">Session Low</span>, the bot instantly fires a request to buy a <span className="text-red-400 font-bold">PUT Option (PE)</span> contract.</p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;
