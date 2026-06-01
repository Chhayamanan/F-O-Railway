import React, { useState, useEffect } from 'react';

function App() {
  const [activeTab, setActiveTab] = useState<'stocks' | 'nifty'>('stocks');
  const [message, setMessage] = useState('');
  
  // Stock States
  const [stocksData, setStocksData] = useState<any[]>([]);
  const [isScanningStocks, setIsScanningStocks] = useState(false);

  // Nifty States
  const [niftyData, setNiftyData] = useState<any>(null);
  const [isScanningNifty, setIsScanningNifty] = useState(false);
  const [niftyQty, setNiftyQty] = useState(25);

  // Poll Backend for Stock Price Action Breakouts
  const checkStocksBreakout = async () => {
    try {
      const resp = await fetch('/api/stocks/check-breakout', { method: 'POST' });
      const data = await resp.json();
      if (data.success) {
        setStocksData(data.data);
        if (data.executedAction) {
          setMessage(`🚨 STOCK BOT: Executed order on price breakout!`);
        }
      }
    } catch (e) { console.error("Stock tracking error", e); }
  };

  // Poll Backend for Nifty Price Action Breakouts
  const checkNiftyBreakout = async () => {
    try {
      const resp = await fetch('/api/nifty/check-breakout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty: niftyQty })
      });
      const data = await resp.json();
      if (data.success) {
        setNiftyData(data.metrics);
        if (data.executedTrade) {
          setMessage(`🚨 NIFTY BOT: Executed ${data.executedTrade} on dynamic range breakout!`);
        }
      }
    } catch (e) { console.error("Nifty tracking error", e); }
  };

  // Timers for automated background checking
  useEffect(() => {
    let stockInterval: any;
    if (isScanningStocks) {
      stockInterval = setInterval(checkStocksBreakout, 5000); // 5-second tight loop for price action
    }
    return () => clearInterval(stockInterval);
  }, [isScanningStocks]);

  useEffect(() => {
    let niftyInterval: any;
    if (isScanningNifty) {
      niftyInterval = setInterval(checkNiftyBreakout, 5000); // 5-second tight loop for options action
    }
    return () => clearInterval(niftyInterval);
  }, [isScanningNifty, niftyQty]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex items-start justify-center p-8 font-sans">
      <div className="max-w-5xl w-full bg-slate-800 rounded-xl shadow-2xl border border-slate-700 p-8 space-y-6">
        
        {/* Navigation Tab Header */}
        <div className="flex gap-4 border-b border-slate-700 pb-4">
          <button 
            onClick={() => setActiveTab('stocks')}
            className={`px-5 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'stocks' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            📈 Stocks High/Low Breakout
          </button>
          <button 
            onClick={() => setActiveTab('nifty')}
            className={`px-5 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'nifty' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            ⚡ Nifty Options Breakout
          </button>
        </div>

        {message && (
          <div className="p-4 rounded-lg bg-blue-900/40 border border-blue-700 text-sm text-blue-300 text-center">
            {message}
          </div>
        )}

        {/* TAB 1: STOCKS */}
        {activeTab === 'stocks' && (
          <div className="space-y-6">
            <div className="flex items-center justify-end bg-slate-850 p-4 rounded-xl border border-slate-700">
              <button 
                onClick={() => setIsScanningStocks(!isScanningStocks)}
                className={`px-6 py-2 rounded-lg font-bold text-sm ${isScanningStocks ? 'bg-red-600 animate-pulse' : 'bg-green-600'}`}
              >
                {isScanningStocks ? '🛑 STOP STOCKS BOT' : '🚀 RUN STOCKS BOT'}
              </button>
            </div>
            
            <div className="overflow-x-auto rounded-lg border border-slate-700">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-700 text-slate-300">
                  <tr>
                    <th className="p-4">Stock Name</th>
                    <th className="p-4 text-right">Current Price</th>
                    <th className="p-4 text-right text-green-400">Session High</th>
                    <th className="p-4 text-right text-red-400">Session Low</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700 bg-slate-800">
                  {stocksData.length === 0 ? (
                    <tr><td colSpan={4} className="p-8 text-center text-slate-500">Click Run to stream live high/low boundaries...</td></tr>
                  ) : (
                    stocksData.map((stock, i) => (
                      <tr key={i} className="hover:bg-slate-750 font-mono">
                        <td className="p-4 font-bold font-sans text-slate-200">{stock.symbol}</td>
                        <td className="p-4 text-right text-blue-400 font-bold">{stock.ltp.toFixed(2)}</td>
                        <td className="p-4 text-right text-green-400">{stock.high.toFixed(2)}</td>
                        <td className="p-4 text-right text-red-400">{stock.low.toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: NIFTY OPTIONS */}
        {activeTab === 'nifty' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-slate-700/50 rounded-xl border border-slate-600 text-center">
                <p className="text-xs font-semibold text-slate-400 uppercase">Nifty Spot LTP</p>
                <p className="text-3xl font-mono font-bold text-blue-400 mt-1">
                  {niftyData?.ltp ? niftyData.ltp.toFixed(2) : '---.--'}
                </p>
              </div>
              <div className="p-4 bg-green-950/30 rounded-xl border border-green-800/50 text-center">
                <p className="text-xs font-semibold text-green-400 uppercase">Session High</p>
                <p className="text-3xl font-mono font-bold text-green-400 mt-1">
                  {niftyData?.high ? niftyData.high.toFixed(2) : '---.--'}
                </p>
              </div>
              <div className="p-4 bg-red-950/30 rounded-xl border border-red-800/50 text-center">
                <p className="text-xs font-semibold text-red-400 uppercase">Session Low</p>
                <p className="text-3xl font-mono font-bold text-red-400 mt-1">
                  {niftyData?.low ? niftyData.low.toFixed(2) : '---.--'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between bg-slate-850 p-4 rounded-xl border border-slate-700">
              <div className="flex items-center gap-4">
                <label className="text-sm font-medium text-slate-300">Options Trading Qty:</label>
                <input 
                  type="number" step="25" value={niftyQty} 
                  onChange={(e) => setNiftyQty(parseInt(e.target.value) || 25)}
                  className="w-24 px-2 py-1 rounded bg-slate-700 text-white text-center border border-slate-600 focus:outline-none"
                />
              </div>
              <button 
                onClick={() => setIsScanningNifty(!isScanningNifty)}
                className={`px-6 py-2 rounded-lg font-bold text-sm transition-all ${isScanningNifty ? 'bg-red-600 animate-pulse' : 'bg-purple-600'}`}
              >
                {isScanningNifty ? '🛑 STOP NIFTY BOT' : '🚀 RUN NIFTY BOT'}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;
