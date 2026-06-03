import React, { useState, useEffect, useRef } from 'react';

function App() {
  const [apiKey, setApiKey] = useState('');
  const [jwtToken, setJwtToken] = useState('');
  const [intervalSecs, setIntervalSecs] = useState(15);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [quote, setQuote] = useState<{ ltp: number, open: number, high: number, low: number } | null>(null);
  const [currentSignal, setCurrentSignal] = useState<'BUY' | 'SELL' | null>(null);
  
  const prevSignalRef = useRef<'BUY' | 'SELL' | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  const [logs, setLogs] = useState<{ id: number, timestamp: string, message: string, type: 'info' | 'buy' | 'sell' | 'error' | 'clear' }[]>([]);

  const addLog = (message: string, type: 'info' | 'buy' | 'sell' | 'error' | 'clear' = 'info') => {
    setLogs(prev => [...prev, { 
      id: Date.now() + Math.random(), 
      timestamp: new Date().toLocaleTimeString("en-IN"), 
      message, 
      type 
    }].slice(-50));
  };

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  useEffect(() => {
    let intervalId: any;

    const fetchQuote = async () => {
      try {
        const response = await fetch('/api/nifty/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey, jwtToken })
        });

        const data = await response.json();

        if (!response.ok) {
           setError(data.error || "Failed to fetch data");
           addLog(`[ERROR] Request failed: ${data.error}`, 'error');
           return;
        }

        if (data.status !== "true" || !data.data?.fetched || data.data.fetched.length === 0) {
            const errorMsg = data.message || data.error || "No data in response";
            setError(`Error: ${errorMsg}`);
            addLog(`[ERROR] ${errorMsg} (${data.errorcode || 'Unknown'})`, 'error');
            return;
        }

        setError(null);
        const fetchedData = data.data.fetched[0];
        const { ltp, open, high, low } = fetchedData;
        
        const pLtp = parseFloat(ltp);
        const pHigh = parseFloat(high);
        const pLow = parseFloat(low);
        const pOpen = parseFloat(open);

        setQuote({ ltp: pLtp, open: pOpen, high: pHigh, low: pLow });

        addLog(`LTP: ${pLtp.toFixed(2)} | Open: ${pOpen.toFixed(2)} | High: ${pHigh.toFixed(2)} | Low: ${pLow.toFixed(2)}`, 'info');

        let newSignal = prevSignalRef.current;

        if (pLtp > pHigh) {
            if (prevSignalRef.current !== 'BUY') {
                addLog(`🟢 BUY SIGNAL: LTP ₹${pLtp.toFixed(2)} crossed Day High ₹${pHigh.toFixed(2)}`, 'buy');
                newSignal = 'BUY';
            }
        } else if (pLtp < pLow) {
             if (prevSignalRef.current !== 'SELL') {
                addLog(`🔴 SELL SIGNAL: LTP ₹${pLtp.toFixed(2)} crossed Day Low ₹${pLow.toFixed(2)}`, 'sell');
                newSignal = 'SELL';
             }
        } else {
             if (prevSignalRef.current !== null) {
                addLog(`Signal cleared — LTP within day range.`, 'clear');
                newSignal = null;
             }
        }

        prevSignalRef.current = newSignal;
        setCurrentSignal(newSignal);

      } catch (err: any) {
         setError("Network or server error.");
         addLog(`[ERROR] Request failed: ${err.message}`, 'error');
      }
    };

    if (isRunning) {
        fetchQuote();
        intervalId = setInterval(fetchQuote, intervalSecs * 1000);
    } else {
        prevSignalRef.current = null;
        setCurrentSignal(null);
    }

    return () => {
        if (intervalId) clearInterval(intervalId);
    };
  }, [isRunning, apiKey, jwtToken, intervalSecs]);

  const toggleRun = () => {
    if (!apiKey || !jwtToken) {
      alert("Please provide valid mStock API Key and JWT Token.");
      return;
    }
    setIsRunning(!isRunning);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-slate-200 flex flex-col p-4 md:p-8 font-mono">
      <div className="max-w-4xl w-full mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-[#121212] border border-slate-800 rounded-xl p-6 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight shrink-0 flex items-center gap-2">
              <span className="text-blue-500">⚡</span> Nifty 50 Signal Tracker
            </h1>
            <p className="text-slate-500 text-sm mt-1">Price Action Breakout Monitor (IA401 Protected)</p>
          </div>
          
          <button 
            onClick={toggleRun}
            className={`px-8 py-3 rounded-lg font-bold text-sm tracking-wide transition-all ${
              isRunning ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30' : 'bg-blue-600 text-white hover:bg-blue-500 shadow-[0_0_15px_rgba(37,99,235,0.3)]'
            }`}
          >
            {isRunning ? '🛑 STOP TRACKER' : '🚀 START POLLING'}
          </button>
        </div>

        {/* Config Panel */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1 border border-slate-800 bg-[#121212] p-4 rounded-xl">
             <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest pl-1 block mb-2">API Key</label>
             <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} disabled={isRunning}
                className="w-full bg-[#0A0A0A] border border-slate-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50 text-slate-300"
                placeholder="mStock API Key"
             />
          </div>
          <div className="space-y-1 border border-slate-800 bg-[#121212] p-4 rounded-xl md:col-span-1">
             <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest pl-1 block mb-2">JWT Token</label>
             <input type="password" value={jwtToken} onChange={e => setJwtToken(e.target.value)} disabled={isRunning}
                className="w-full bg-[#0A0A0A] border border-slate-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50 text-slate-300"
                placeholder="Paste Bearer Token"
             />
          </div>
          <div className="space-y-1 border border-slate-800 bg-[#121212] p-4 rounded-xl">
             <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest pl-1 block mb-2">Interval (Secs)</label>
             <input type="number" min="1" value={intervalSecs} onChange={e => setIntervalSecs(Number(e.target.value) || 15)} disabled={isRunning}
                className="w-full bg-[#0A0A0A] border border-slate-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50 text-slate-300"
             />
          </div>
        </div>

        {/* Status Display */}
        {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-sm font-medium flex items-center gap-3">
                <span className="text-xl">⚠️</span> {error}
            </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[#121212] border border-slate-800 rounded-xl p-5 flex flex-col items-center justify-center">
                <span className="text-xs text-slate-500 uppercase tracking-wider mb-1">Spot LTP</span>
                <span className="text-2xl font-bold text-white tracking-tight">{quote?.ltp ? quote.ltp.toFixed(2) : '---.--'}</span>
            </div>
            <div className="bg-[#121212] border border-slate-800 rounded-xl p-5 flex flex-col items-center justify-center">
                <span className="text-xs text-slate-500 uppercase tracking-wider mb-1">Open Price</span>
                <span className="text-2xl font-bold text-slate-300 tracking-tight">{quote?.open ? quote.open.toFixed(2) : '---.--'}</span>
            </div>
            <div className="bg-[#121212] border border-green-900/40 rounded-xl p-5 flex flex-col items-center justify-center relative overflow-hidden">
                <span className="text-xs text-green-500 uppercase tracking-wider mb-1 z-10">Session High</span>
                <span className="text-2xl font-bold text-green-400 tracking-tight z-10">{quote?.high ? quote.high.toFixed(2) : '---.--'}</span>
                <div className="absolute inset-0 bg-green-500 opacity-[0.03] z-0 pointer-events-none"></div>
            </div>
            <div className="bg-[#121212] border border-red-900/40 rounded-xl p-5 flex flex-col items-center justify-center relative overflow-hidden">
                <span className="text-xs text-red-500 uppercase tracking-wider mb-1 z-10">Session Low</span>
                <span className="text-2xl font-bold text-red-400 tracking-tight z-10">{quote?.low ? quote.low.toFixed(2) : '---.--'}</span>
                <div className="absolute inset-0 bg-red-500 opacity-[0.03] z-0 pointer-events-none"></div>
            </div>
        </div>

        {/* Current Signal Banner */}
        <div className={`transition-all duration-300 rounded-xl border flex flex-col items-center justify-center py-8 
            ${currentSignal === 'BUY' ? 'bg-green-500/10 border-green-500/30' : 
              currentSignal === 'SELL' ? 'bg-red-500/10 border-red-500/30' : 'bg-[#121212] border-slate-800'}`}>
            <span className="text-xs text-slate-400 uppercase tracking-widest mb-2 font-semibold">Active Tracker Status</span>
            {currentSignal === 'BUY' ? (
                <div className="flex flex-col items-center animate-pulse">
                    <span className="text-4xl mb-2">🟢</span>
                    <h2 className="text-3xl font-black text-green-400 tracking-wider">BUY SIGNAL</h2>
                </div>
            ) : currentSignal === 'SELL' ? (
                <div className="flex flex-col items-center animate-pulse">
                    <span className="text-4xl mb-2">🔴</span>
                    <h2 className="text-3xl font-black text-red-400 tracking-wider">SELL SIGNAL</h2>
                </div>
            ) : (
                <h2 className="text-xl font-bold text-slate-500 tracking-wider mt-2 flex items-center gap-2">
                    {isRunning ? (
                      <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span> POLLING MARKET DATA</span>
                    ) : 'WAITING FOR INITIALIZATION'}
                </h2>
            )}
        </div>

        {/* Terminal output equivalent */}
        <div className="bg-[#0A0A0A] border border-slate-800 rounded-xl flex flex-col overflow-hidden">
            <div className="bg-[#151515] px-4 py-2 border-b border-slate-800 flex justify-between items-center">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Terminal Output</span>
                {isRunning && <span className="text-[10px] text-blue-400 font-semibold uppercase px-2 py-0.5 bg-blue-500/10 rounded-sm animate-pulse">Live</span>}
            </div>
            <div className="h-80 overflow-y-auto p-4 space-y-2 text-sm">
                {logs.length === 0 ? (
                    <div className="text-slate-600 italic">No output yet. Start the tracker.</div>
                ) : (
                    logs.map((log) => (
                        <div key={log.id} className={`flex items-start gap-4 ${
                            log.type === 'buy' ? 'text-green-400 font-semibold bg-green-950/20 p-2 rounded -mx-2' :
                            log.type === 'sell' ? 'text-red-400 font-semibold bg-red-950/20 p-2 rounded -mx-2' :
                            log.type === 'error' ? 'text-orange-400/90' :
                            log.type === 'clear' ? 'text-orange-200/60 object-none italic' : 'text-slate-300'
                        }`}>
                            <span className="text-slate-500 shrink-0 font-medium opacity-70">[{log.timestamp}]</span>
                            <span className="break-all whitespace-pre-wrap">{log.message}</span>
                        </div>
                    ))
                )}
                <div ref={logsEndRef} />
            </div>
        </div>

      </div>
    </div>
  );
}

export default App;
