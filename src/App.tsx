import React, { useState, useEffect, useRef } from 'react';

function App() {
  // Step Config
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Authentication States
  const [apiKey, setApiKey] = useState('');
  const [clientCode, setClientCode] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [otp, setOtp] = useState('');
  
  const [refreshToken, setRefreshToken] = useState('');
  const [jwtToken, setJwtToken] = useState('');

  // Tracker States
  const [intervalSecs, setIntervalSecs] = useState(15);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  // Step 1: Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    
    try {
      const res = await fetch('/api/mstock/login', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientcode: clientCode, password, totp })
      });
      const data = await res.json();
      
      if (!res.ok || data.status !== "true") {
        setError(data.error || data.message || "Failed to login.");
        setLoading(false);
        return;
      }
      
      const sessionData = data.data;
      const refToken = sessionData?.refreshToken || sessionData?.jwtToken || sessionData;
      setRefreshToken(refToken);
      setStep(2);

    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  // Step 2: Validate OTP
  const handleValidateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/mstock/session', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientcode: clientCode, refreshToken, otp, apiKey })
      });
      const data = await res.json();
      
      if (!res.ok || data.status !== "true") {
        setError(data.error || data.message || "Failed to generate session.");
        setLoading(false);
        return;
      }

      const token = data.data?.jwtToken || data.data?.accessToken;
      setJwtToken(token);
      setStep(3);
      setError(null);

    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  // Step 3: Polling Logic
  useEffect(() => {
    let intervalId: any;

    const fetchQuote = async () => {
      try {
        const response = await fetch('/api/mstock/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey, jwtToken })
        });

        const data = await response.json();

        if (!response.ok || data.status !== "true") {
            const errorMsg = data.error || data.message || "Unknown error";
            addLog(`[ERROR] ${errorMsg} (${data.errorcode || 'Unknown'})`, 'error');
            return;
        }

        if (!data.data?.fetched || data.data.fetched.length === 0) {
            addLog(`[ERROR] No data returned in fetched list.`, 'error');
            return;
        }

        const fetchedData = data.data.fetched[0];
        const { ltp, open, high, low } = fetchedData;
        
        const pLtp = parseFloat(ltp);
        const pHigh = parseFloat(high);
        const pLow = parseFloat(low);
        const pOpen = parseFloat(open);

        setQuote({ ltp: pLtp, open: pOpen, high: pHigh, low: pLow });

        addLog(`LTP: ₹${pLtp.toFixed(2)} | Open: ₹${pOpen.toFixed(2)} | High: ₹${pHigh.toFixed(2)} | Low: ₹${pLow.toFixed(2)}`, 'info');

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
                addLog(`⚪ Signal cleared — LTP back within day range.`, 'clear');
                newSignal = null;
             }
        }

        prevSignalRef.current = newSignal;
        setCurrentSignal(newSignal);

      } catch (err: any) {
         addLog(`[ERROR] Request failed: ${err.message}`, 'error');
      }
    };

    if (isRunning) {
        // Fetch immediately then schedule
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


  return (
    <div className="min-h-screen bg-[#0A0A0A] text-slate-200 flex flex-col p-4 md:p-8 font-mono">
      <div className="max-w-4xl w-full mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-[#121212] border border-slate-800 rounded-xl p-6 shadow-2xl flex flex-col items-center justify-center text-center">
            <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
              <span className="text-blue-500">⚡</span> mStock Nifty 50 Tracker
            </h1>
            <p className="text-slate-500 text-sm mt-2 max-w-xl">
              TypeB Authentication Flow: Login with your client credentials to securely grab a session token and ping real-time Spot Price Action.
            </p>
        </div>

        {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-sm font-medium flex items-center gap-3">
                <span className="text-xl">⚠️</span> {error}
            </div>
        )}

        {/* --- STEP 1: LOGIN --- */}
        {step === 1 && (
           <form onSubmit={handleLogin} className="bg-[#121212] border border-slate-800 rounded-xl p-6 shadow-2xl space-y-4">
              <h2 className="text-lg font-bold text-slate-200 border-b border-slate-800 pb-2 mb-4">Step 1: Login</h2>
              
              <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest pl-1">API Key (From mStock Developer)</label>
                    <input type="password" required value={apiKey} onChange={e => setApiKey(e.target.value)}
                        className="w-full bg-[#0A0A0A] border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-slate-300" placeholder="API Key" />
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest pl-1">Client Code</label>
                        <input type="text" required value={clientCode} onChange={e => setClientCode(e.target.value)}
                            className="w-full bg-[#0A0A0A] border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-slate-300" placeholder="e.g. 12345678" />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest pl-1">Password</label>
                        <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                            className="w-full bg-[#0A0A0A] border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-slate-300" placeholder="••••••••" />
                    </div>
                  </div>

                  <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest pl-1">Authenticator TOTP (Optional)</label>
                      <input type="text" value={totp} onChange={e => setTotp(e.target.value)}
                          className="w-full bg-[#0A0A0A] border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-slate-300" placeholder="6-digit code if enabled" />
                  </div>
              </div>

              <button type="submit" disabled={loading} className="w-full mt-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white font-bold py-3 rounded-lg transition-all flex items-center justify-center gap-2">
                  {loading ? 'Authenticating...' : 'Login & Request OTP'}
              </button>
           </form>
        )}

        {/* --- STEP 2: VERIFY OTP --- */}
        {step === 2 && (
           <form onSubmit={handleValidateSession} className="bg-[#121212] border border-slate-800 rounded-xl p-6 shadow-2xl space-y-4">
              <h2 className="text-lg font-bold text-slate-200 border-b border-slate-800 pb-2 mb-4 flex items-center gap-2">
                 <span>Step 2: Generate Session</span>
              </h2>
              
              <div className="bg-green-900/20 border border-green-500/20 text-green-400 p-4 rounded-lg text-sm mb-4">
                  Login successful! An OTP has been sent to your registered mobile number.
              </div>

              <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest pl-1">Enter OTP Received</label>
                  <input type="text" required value={otp} onChange={e => setOtp(e.target.value)}
                      className="w-full bg-[#0A0A0A] border border-slate-700 rounded-lg px-4 py-3 text-lg focus:outline-none focus:border-blue-500 text-slate-300 text-center tracking-widest font-bold" placeholder="••••••" />
              </div>

              <button type="submit" disabled={loading} className="w-full mt-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white font-bold py-3 rounded-lg transition-all flex items-center justify-center gap-2">
                  {loading ? 'Verifying...' : 'Verify & Start Session'}
              </button>

              <button type="button" onClick={() => setStep(1)} className="w-full mt-2 bg-transparent text-slate-500 hover:text-slate-300 text-sm font-semibold py-2 rounded-lg transition-all">
                  Back to Login
              </button>
           </form>
        )}

        {/* --- STEP 3: TRACKER DASHBOARD --- */}
        {step === 3 && (
            <div className="space-y-6 flex flex-col">
                <div className="bg-[#121212] border border-slate-800 rounded-xl p-4 flex items-center justify-between shadow-2xl">
                    <div className="flex items-center gap-4 text-sm font-semibold text-slate-400">
                        <span className="text-green-500">✅ Session Active</span>
                    </div>
                     <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                           <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Interval</label>
                           <input type="number" min="1" value={intervalSecs} onChange={e => setIntervalSecs(Number(e.target.value) || 15)} disabled={isRunning}
                              className="w-20 bg-[#0A0A0A] border border-slate-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500 text-slate-300 text-center"
                           />
                        </div>
                        <button onClick={() => setIsRunning(!isRunning)} className={`px-6 py-2 rounded-lg font-bold text-sm tracking-wide transition-all ${
                            isRunning ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30' : 'bg-blue-600 text-white hover:bg-blue-500'
                        }`}>
                            {isRunning ? '🛑 STOP' : '🚀 START TRACKER'}
                        </button>
                     </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-[#121212] border border-slate-800 rounded-xl p-5 flex flex-col justify-center items-center">
                        <span className="text-xs text-slate-500 uppercase tracking-wider mb-1">Spot LTP</span>
                        <span className="text-2xl font-bold text-white tracking-tight">{quote?.ltp ? quote.ltp.toFixed(2) : '---.--'}</span>
                    </div>
                    <div className="bg-[#121212] border border-slate-800 rounded-xl p-5 flex flex-col justify-center items-center">
                        <span className="text-xs text-slate-500 uppercase tracking-wider mb-1">Open Price</span>
                        <span className="text-2xl font-bold text-slate-300 tracking-tight">{quote?.open ? quote.open.toFixed(2) : '---.--'}</span>
                    </div>
                    <div className="bg-[#121212] border border-green-900/40 rounded-xl p-5 flex flex-col justify-center items-center overflow-hidden relative">
                        <span className="text-xs text-green-500 uppercase tracking-wider mb-1 z-10">Session High</span>
                        <span className="text-2xl font-bold text-green-400 tracking-tight z-10">{quote?.high ? quote.high.toFixed(2) : '---.--'}</span>
                        <div className="absolute inset-0 bg-green-500 opacity-[0.03] z-0 pointer-events-none"></div>
                    </div>
                    <div className="bg-[#121212] border border-red-900/40 rounded-xl p-5 flex flex-col justify-center items-center overflow-hidden relative">
                        <span className="text-xs text-red-500 uppercase tracking-wider mb-1 z-10">Session Low</span>
                        <span className="text-2xl font-bold text-red-400 tracking-tight z-10">{quote?.low ? quote.low.toFixed(2) : '---.--'}</span>
                        <div className="absolute inset-0 bg-red-500 opacity-[0.03] z-0 pointer-events-none"></div>
                    </div>
                </div>

                <div className={`transition-all duration-300 rounded-xl border flex flex-col items-center justify-center py-8 
                    ${currentSignal === 'BUY' ? 'bg-green-500/10 border-green-500/30' : 
                      currentSignal === 'SELL' ? 'bg-red-500/10 border-red-500/30' : 'bg-[#121212] border-slate-800'}`}>
                    <span className="text-xs text-slate-400 uppercase tracking-widest mb-2 font-semibold">Live Signal Status</span>
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
                        <h2 className="text-xl font-bold text-slate-500 tracking-wider mt-2 flex items-center gap-2 flex-col">
                            {isRunning ? (
                              <><span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span> POLLING MARKET DATA</span></>
                            ) : 'STANDBY MODE'}
                        </h2>
                    )}
                </div>

                <div className="bg-[#0A0A0A] border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                    <div className="bg-[#151515] px-4 py-2 border-b border-slate-800 flex justify-between items-center">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Execution Logs</span>
                        {isRunning && <span className="text-[10px] text-blue-400 font-semibold uppercase px-2 py-0.5 bg-blue-500/10 rounded-sm animate-pulse">Live</span>}
                    </div>
                    <div className="h-[300px] overflow-y-auto p-4 space-y-2 text-sm">
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
                                    <span className="break-all whitespace-pre-wrap flex-1">{log.message}</span>
                                </div>
                            ))
                        )}
                        <div ref={logsEndRef} />
                    </div>
                </div>

            </div>
        )}

      </div>
    </div>
  );
}

export default App;
