import React, { useState } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Play, 
  Activity, 
  ShieldCheck, 
  Terminal, 
  TrendingUp, 
  AlertCircle,
  CheckCircle2,
  Cpu,
  BarChart3,
  Zap,
  Database,
  CloudDownload,
  Clock,
  Filter,
  Newspaper,
  ExternalLink,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ lastSync: number, healthy: boolean } | null>(null);
  const [results, setResults] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeDetail, setActiveDetail] = useState<'scope' | 'signals' | null>(null);
  const [positionFilter, setPositionFilter] = useState<number>(0);
  const [volumeFilter, setVolumeFilter] = useState<number>(0);
  const [volMultiplier, setVolMultiplier] = useState<number>(4);
  const [spikeFactor, setSpikeFactor] = useState<number>(3);
  const [activeTab, setActiveTab] = useState<'darvas' | 'rsTrend' | 'custom' | 'spike' | 'pending'>('darvas');
  const [activeScan, setActiveScan] = useState<'darvas' | 'all' | null>(null);
  const [countdown, setCountdown] = useState<number>(20);
  const [portfolio, setPortfolio] = useState<any>(null);
  const [isPortfolioLoading, setIsPortfolioLoading] = useState<boolean>(false);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [liveMetrics, setLiveMetrics] = useState<Record<string, { price: number, volume: number, ratio: number, dailyChange: number, distFromHigh: number }>>({});
  const [maxDistFromHigh, setMaxDistFromHigh] = useState<number>(20); // 20% by default
  const [dailyChangeMin, setDailyChangeMin] = useState<number>(-10);
  const [dailyChangeMax, setDailyChangeMax] = useState<number>(10);
  const [selectedStock, setSelectedStock] = useState<string | null>(null);
  const [news, setNews] = useState<{ text: string, links: { uri: string, title: string }[] } | null>(null);
  const [isFetchingNews, setIsFetchingNews] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [mstockAuthState, setMstockAuthState] = useState<'idle' | 'awaiting_otp' | 'logged_in'>('idle');
  const [mstockAuthError, setMstockAuthError] = useState<string | null>(null);
  const [ceoTradeActions, setCeoTradeActions] = useState<Record<string, 'BUY' | 'SELL' | 'SKIP'>>({});
  const [expandedSignals, setExpandedSignals] = useState<Record<string, boolean>>({});

  const exportToCSV = () => {
    if (!results) return;
    
    let data: any[] = [];
    let filename = `scan_results_${new Date().toISOString().split('T')[0]}.csv`;

    if (activeTab === 'darvas' || activeTab === 'rsTrend' || activeTab === 'custom') {
      const activeResults = activeTab === 'darvas' ? results.darvas : activeTab === 'rsTrend' ? results.rsTrend : results.custom;
      if (activeResults?.candidates) {
        data = activeResults.candidates.map((c: any) => ({
          Symbol: c.symbol,
          Price: liveMetrics[c.symbol]?.price || c.currentPrice,
          Volume: liveMetrics[c.symbol]?.volume || c.currentVolume,
          VolRatio: (liveMetrics[c.symbol]?.ratio || c.volumeRatio || 0).toFixed(2),
          BoxHigh: c.boxHigh,
          BoxLow: c.boxLow,
          Cap: c.marketCap,
          DayChange: ((liveMetrics[c.symbol]?.dailyChange || c.dailyChange) || 0).toFixed(2) + '%'
        }));
      }
    } else if (activeTab === 'spike' && results.spikes) {
      data = results.spikes.map((s: any) => ({
        Symbol: s.symbol,
        Price: s.currentPrice,
        Volume: s.spikeVolume,
        VolRatio: s.ratio.toFixed(2),
        DayChange: s.priceChangePercent.toFixed(2) + '%',
        Time: s.time
      }));
    }

    if (data.length === 0) return;

    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(obj => Object.values(obj).join(',')).join('\n');
    const csvContent = "data:text/csv;charset=utf-8," + headers + "\n" + rows;
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addLog(`Exported ${data.length} records to CSV.`);
  };

  const exportDataKeeper = async (type: 'daily' | 'intraday') => {
    addLog(`Data Keeper: Extracting ${type} cache for export...`);
    try {
      const response = await fetch(`/api/data-keeper/export?type=${type}`);
      const data = await response.json();
      
      if (!data.success) {
        addLog(`Export Error: ${data.error}`);
        return;
      }

      const cache = data.cache.data;
      const symbols = Object.keys(cache);
      let csvRows = [];
      csvRows.push("Symbol,Date,Open,High,Low,Close,Volume");

      for (const symbol of symbols) {
        const candles = cache[symbol];
        if (!candles || !Array.isArray(candles)) continue;
        
        for (const candle of candles) {
          const date = new Date(candle.date).toISOString();
          csvRows.push(`${symbol},${date},${candle.open},${candle.high},${candle.low},${candle.close},${candle.volume}`);
        }
      }

      const filename = `data_keeper_${type}_${new Date().toISOString().split('T')[0]}.csv`;
      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      addLog(`Data Keeper: Successfully exported ${type} cache (${symbols.length} symbols).`);
    } catch (err) {
      addLog(`Export Failed: ${err}`);
    }
  };

  const resultsRef = React.useRef(results);

  React.useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  const stopMonitor = () => {
    setIsMonitoring(false);
    setActiveScan(null);
    addLog("Monitoring agents detached. Manual control restored.");
  };

  const addLog = (msg: string) => {
    setLogs(prev => [...prev.slice(-19), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const loggedErrorsRef = React.useRef(new Set<string>());

  const permanentlyRejectedRef = React.useRef(new Set<string>());

  const isFetchingRef = React.useRef(false);

  const handleLoginSubmit = async () => {
    try {
      setMstockAuthError(null);
      
      addLog("Connecting to m.Stock API Gateway via Type A JWT...");
      const response = await fetch('/api/mstock/login', { 
        method: 'POST'
      });
      const data = await response.json();
      if (data.success) {
        setMstockAuthState('logged_in');
        setOtpInput('');
        addLog("m.Stock Login successful! Dynamic Session Generated.");
      } else {
        setMstockAuthError(data.error || "Login Failed");
        addLog(`Login Failed: ${data.error}`);
      }
    } catch (e: any) {
      setMstockAuthError(e.message || "Network Error");
      addLog(`Login Error: ${e.message}`);
    }
  };

  // Fetch live portfolio statistics
  const fetchPortfolioData = async (silent = false) => {
    if (!silent) setIsPortfolioLoading(true);
    try {
      const response = await fetch('/api/portfolio');
      const data = await response.json();
      if (data.success) {
        setPortfolio(data.portfolio);
      }
    } catch (err) {
      console.error("[PORTFOLIO FETCH ERROR]", err);
    } finally {
      if (!silent) setIsPortfolioLoading(false);
    }
  };

  // Automated 1-minute Darvas Scanner callback
  const triggerDarvasMonitoringScan = async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    addLog(`Automated Darvas Box scanning triggered...`);
    try {
      const response = await fetch(`/api/run-darvas-system?multiplier=${volMultiplier}`);
      const data = await response.json();
      if (data.success) {
        addLog(`Auto-scan: ${data.candidates.length} candidates, ${data.signals.length} signals detected.`);
        if (data.rejections && data.rejections.length > 0) {
          data.rejections.forEach((rej: any) => {
            const key = rej.symbol;
            if (!loggedErrorsRef.current.has(key)) {
              addLog(`${rej.symbol} Validation Failed: ${rej.reason}`);
              loggedErrorsRef.current.add(key);
            }
          });
        }
        if (data.signals && data.signals.length > 0) {
          const prevPending = resultsRef.current?.darvas?.pendingTrades || [];
          const newPending = data.pendingTrades || [];
          const combinedPending = [...prevPending];
          newPending.forEach((newT: any) => {
            if (!combinedPending.some(t => t.signal.symbol === newT.signal.symbol)) {
              combinedPending.push(newT);
              addLog(`PENDING APPROVAL: ${newT.signal.symbol} requires ₹${newT.fundRequired.toFixed(2)}`);
            }
          });
          data.pendingTrades = combinedPending;
        }

        const mappedResults = {
          success: true,
          darvas: {
            candidates: data.candidates || [],
            signals: data.signals || [],
            pendingTrades: data.pendingTrades || [],
            executedTrades: resultsRef.current?.darvas?.executedTrades || [],
            rejections: data.rejections || []
          },
          rsTrend: resultsRef.current?.rsTrend || { candidates: [] },
          custom: resultsRef.current?.custom || { candidates: [] },
          spikes: resultsRef.current?.spikes || [],
          liveMetrics: { ...(resultsRef.current?.liveMetrics || {}), ...(data.liveMetrics || {}) }
        };

        setResults(mappedResults);
        if (data.liveMetrics) {
          setLiveMetrics(prev => ({ ...prev, ...data.liveMetrics }));
        }
      }
    } catch (e) {
      console.error("Monitor Error:", e);
      addLog(`Auto-scan Error: ${e}`);
    } finally {
      isFetchingRef.current = false;
    }
  };

  // Effect 1: 20-second Autoclose / Polling Countdown loop for Darvas Scanner
  React.useEffect(() => {
    let countdownInterval: NodeJS.Timeout;
    if (activeScan === 'darvas' && isMonitoring) {
      addLog(`Live Darvas Monitoring established (Auto-scanning every 20 seconds)`);
      setCountdown(20);
      countdownInterval = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            triggerDarvasMonitoringScan();
            return 20;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (countdownInterval) clearInterval(countdownInterval);
    };
  }, [activeScan, isMonitoring, volMultiplier]);

  // Effect 2: Independent 5-second Portfolio Agent Polling loop (Disabled per user request)
  // React.useEffect(() => {
  //   fetchPortfolioData(false);

  //   let portfolioInterval: NodeJS.Timeout;
  //   if (isMonitoring) {
  //     addLog("Portfolio Agent (CEOPA): Online and polling every 5 seconds.");
  //     portfolioInterval = setInterval(() => {
  //       fetchPortfolioData(true);
  //     }, 5000);
  //   }
  //   return () => {
  //     if (portfolioInterval) {
  //       clearInterval(portfolioInterval);
  //       addLog("Portfolio Agent (CEOPA): Polling paused.");
  //     }
  //   };
  // }, [isMonitoring]);

  // ISOLATED SCAN 1: Darvas Box Scanner (Main Monitoring Scan)
  const runDarvasScan = async () => {
    setIsRunning(true);
    setResults(null);
    setLogs([]);
    setActiveScan('darvas');
    setIsMonitoring(true);
    setCountdown(20);
    addLog("Initializing ISO-1: Darvas Box Scanning Engine...");

    try {
      const statusRes = await fetch('/api/data-keeper/status');
      const status = await statusRes.json();
      setSyncStatus(status);

      if (!status.healthy) {
        addLog("WARNING: Market data is stale (over 12h). Run Data Keeper Sync!");
      }

      addLog(`Step 1: Darvas Box Scanner deployed (Vol Multiplier: ${volMultiplier}x)`);
      const response = await fetch(`/api/run-darvas-system?multiplier=${volMultiplier}`);
      const data = await response.json();

      if (data.success) {
        addLog(`Darvas Box scan completed.`);
        addLog(`Darvas: ${data.candidates.length} candidates, ${data.signals.length} signals`);
        if (data.rejections && data.rejections.length > 0) {
          data.rejections.forEach((rej: any) => {
            addLog(`Blocked: ${rej.symbol} - ${rej.reason}`);
          });
        }
        
        if (data.pendingTrades && data.pendingTrades.length > 0) {
          data.pendingTrades.forEach((pending: any) => {
            addLog(`PENDING APPROVAL: ${pending.signal.symbol} requires ₹${pending.fundRequired.toFixed(2)}`);
          });
        }
        
        const mappedResults = {
          success: true,
          darvas: {
            candidates: data.candidates || [],
            signals: data.signals || [],
            pendingTrades: data.pendingTrades || [],
            executedTrades: data.executedTrades || [],
            rejections: data.rejections || []
          },
          rsTrend: { candidates: [] },
          custom: { candidates: [] },
          spikes: [],
          liveMetrics: data.liveMetrics || {}
        };

        setResults(mappedResults);
        if (data.liveMetrics) {
          setLiveMetrics(data.liveMetrics);
        }
      } else {
        addLog(`Engine failed: ${data.error}`);
      }
    } catch (err) {
      addLog(`Network Error: ${err}`);
      console.error(err);
    } finally {
      setIsRunning(false);
    }
  };

  // ISOLATED SCAN 2: RS Trend Scanner (Invididual Active)
  const runRsTrendScan = async () => {
    setIsRunning(true);
    addLog("Deploying RS Trend Agent for isolated scanning...");
    try {
      const response = await fetch('/api/run-rs-trend-scan');
      const data = await response.json();
      if (data.success) {
        addLog(`RS Trend isolation scan complete. Found ${data.candidates.length} candidates.`);
        setResults(prev => {
          const base = prev || { success: true };
          return {
            ...base,
            success: true,
            rsTrend: {
              candidates: data.candidates || [],
              signals: [],
              executedTrades: [],
              rejections: []
            },
            liveMetrics: { ...(base.liveMetrics || {}), ...(data.liveMetrics || {}) }
          };
        });
        if (data.liveMetrics) {
          setLiveMetrics(prev => ({ ...prev, ...data.liveMetrics }));
        }
      } else {
        addLog(`RS Trend scan failed: ${data.error}`);
      }
    } catch (err) {
      addLog(`RS Trend scan network error: ${err}`);
    } finally {
      setIsRunning(false);
    }
  };

  // ISOLATED SCAN 3: Custom Slicers Scanner (Individual Active)
  const runCustomFilterScan = async () => {
    setIsRunning(true);
    addLog(`Deploying Custom Filter Agent (High Dist: ${maxDistFromHigh}%, Daily Change: ${dailyChangeMin}% to ${dailyChangeMax}%)...`);
    try {
      const response = await fetch('/api/run-custom-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: {
            volMult: volMultiplier,
            distFromHigh: maxDistFromHigh,
            dailyChangeMin,
            dailyChangeMax
          }
        })
      });
      const data = await response.json();
      if (data.success) {
        addLog(`Custom Filter isolation scan complete. Found ${data.candidates.length} candidates.`);
        setResults(prev => {
          const base = prev || { success: true };
          return {
            ...base,
            success: true,
            custom: {
              candidates: data.candidates || [],
              signals: [],
              executedTrades: [],
              rejections: []
            },
            liveMetrics: { ...(base.liveMetrics || {}), ...(data.liveMetrics || {}) }
          };
        });
        if (data.liveMetrics) {
          setLiveMetrics(prev => ({ ...prev, ...data.liveMetrics }));
        }
      } else {
        addLog(`Custom scan failed: ${data.error}`);
      }
    } catch (err) {
      addLog(`Custom scan network error: ${err}`);
    } finally {
      setIsRunning(false);
    }
  };

  // ISOLATED SCAN 4: Volume Spike Detector (Individual Active)
  const runVolumeSpikeScan = async () => {
    setIsRunning(true);
    addLog(`Deploying Volume Spike Agent (Spike Factor: ${spikeFactor}x)...`);
    try {
      const response = await fetch(`/api/run-volume-spike-scan?factor=${spikeFactor}`);
      const data = await response.json();
      if (data.success) {
        addLog(`Volume Spike scan complete. Found ${data.spikes?.length || 0} active spikes.`);
        setResults(prev => {
          const base = prev || { success: true };
          return {
            ...base,
            success: true,
            spikes: data.spikes || []
          };
        });
      } else {
        addLog(`Volume Spike scan failed: ${data.error}`);
      }
    } catch (err) {
      addLog(`Spike scan network error: ${err}`);
    } finally {
      setIsRunning(false);
    }
  };

  // Auto-monitor logic
  const runSync = async () => {
    setIsSyncing(true);
    addLog("Data Keeper Agent: Starting background market synchronization...");
    try {
      const response = await fetch('/api/data-keeper/sync', { method: 'POST' });
      
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Server returned ${response.status}: ${text.slice(0, 100)}...`);
      }

      const data = await response.json();
      if (data.success) {
        addLog(`Data Keeper: Synchronization started in background. Please wait ~1-2 minutes for completion, then check status.`);
        // We do not immediately set healthy to true since it runs in the background. But we'll leave lastSync.
        setSyncStatus({ lastSync: data.lastSync, healthy: false });
      } else {
        addLog(`Data Keeper Error: ${data.error}`);
      }
    } catch (err) {
      addLog(`Sync Failed: ${err}`);
      console.error("Sync Error Details:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  const fetchNews = async (symbol: string) => {
    setIsFetchingNews(true);
    setNews(null);
    addLog(`News Agent: Searching for real-time news for ${symbol} in last 2 hours...`);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Search for very recent (last 2 hours) news for the stock symbol ${symbol} and the company it represents in the Indian stock market. Summarize the most important news. If no news is found in the last 2 hours, look for the most recent major news today. Keep it concise.`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const text = response.text || "No recent news found for this company.";
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      const links = chunks?.map((chunk: any) => ({
        uri: chunk.web?.uri || "",
        title: chunk.web?.title || "News Link"
      })).filter((l: any) => l.uri) || [];

      setNews({ text, links });
      addLog(`News Agent: News summary retrieved for ${symbol}.`);
    } catch (err) {
      console.error("News Fetch Error:", err);
      addLog(`News Agent Error: ${err}`);
      setNews({ text: "Failed to retrieve news at this moment.", links: [] });
    } finally {
      setIsFetchingNews(false);
    }
  };

  // Process CEO approval
  const approveFutureTrade = async (pending: any, direction: 'BUY' | 'SELL' | 'SKIP') => {
    setCeoTradeActions(prev => ({ ...prev, [pending.signal.symbol]: direction }));
    
    if (direction === 'SKIP') {
      addLog(`SIGNAL SKIPPED: ${pending.signal.symbol}`);
      setTimeout(() => {
        setResults((prev: any) => {
           if (!prev || !prev.darvas) return prev;
           return {
             ...prev,
             darvas: {
               ...prev.darvas,
               pendingTrades: prev.darvas.pendingTrades.filter((p: any) => 
                 p.signal.symbol !== pending.signal.symbol
               )
             }
           };
        });
      }, 1500); // 1.5s delay to show the locked status
      return;
    }

    addLog(`Authorizing ${direction} FUTURES order for ${pending.signal.symbol}...`);
    try {
      const response = await fetch('/api/approve-trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedSignals: [pending] })
      });
      const data = await response.json();
      
      if (data.success) {
        if (data.executedTrades && data.executedTrades.length > 0) {
          data.executedTrades.forEach((trade: any) => {
            addLog(`FUTURES EXECUTED [${direction}]: ${trade.symbol} at ₹${trade.entry}`);
          });
        }
        if (data.executionErrors && data.executionErrors.length > 0) {
          data.executionErrors.forEach((err: any) => {
             addLog(`Execution Failed: ${err.symbol} - ${err.reason}`);
          });
        }
        
        setTimeout(() => {
          setResults((prev: any) => {
             if (!prev || !prev.darvas) return prev;
             return {
               ...prev,
               darvas: {
                 ...prev.darvas,
                 pendingTrades: prev.darvas.pendingTrades.filter((p: any) => 
                   p.signal.symbol !== pending.signal.symbol
                 ),
                 executedTrades: [...(prev.darvas.executedTrades || []), ...(data.executedTrades || [])]
               }
             };
          });
        }, 1500); // delay to show locked signal card
        
      } else {
        addLog(`Approval request failed: ${data.error}`);
      }
    } catch (err) {
      addLog(`Approval network error: ${err}`);
      console.error(err);
    }
  };

  const toggleSignalExpand = (symbol: string) => {
    setExpandedSignals(prev => ({ ...prev, [symbol]: !prev[symbol] }));
  };

  const onCompanyClick = (symbol: string) => {
    setSelectedStock(symbol);
    fetchNews(symbol);
  };

  React.useEffect(() => {
    const checkSync = async () => {
      try {
        const res = await fetch('/api/data-keeper/status');
        const data = await res.json();
        setSyncStatus(data);
      } catch (e) {
        console.error("Failed to check sync status:", e);
      }
    };
    checkSync();
    
    // Poll the background sync status every 10 seconds
    const interval = setInterval(checkSync, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-zinc-100 font-sans selection:bg-indigo-500/30">
      {/* Header */}
      <header className="border-b border-zinc-800/50 bg-[#0d0d0f]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600 rounded-xl shadow-lg shadow-blue-500/30">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">Institutional Trading AI <span className="text-xs text-indigo-400 bg-indigo-500/20 px-2 py-0.5 rounded-full ml-2">v2.0 (20s Fast-Scan)</span></h1>
              <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-bold">Multi-Agent Operating System</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {isMonitoring && activeScan === 'darvas' && (
              <div className="flex items-center gap-2 px-3 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400 font-mono text-xs font-bold shadow-md shadow-indigo-500/5">
                <Clock className="w-3.5 h-3.5" />
                <span>Auto-Scan: {countdown}s</span>
              </div>
            )}

            <motion.button
              whileHover={{ scale: 1.02, translateY: -1 }}
              whileTap={{ scale: 0.98 }}
              onClick={runDarvasScan}
              disabled={isRunning}
              className={`flex items-center gap-2.5 px-6 py-3 rounded-2xl font-bold transition-all ${
                isRunning 
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' 
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-xl shadow-indigo-600/30'
              }`}
            >
              {isRunning ? <Activity className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
              <span className="text-sm">Scan Darvas Box</span>
            </motion.button>

            {isMonitoring && (
              <motion.button
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={stopMonitor}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 font-bold hover:bg-red-500 hover:text-white transition-all text-xs"
              >
                <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                Stop Scan
              </motion.button>
            )}

            {results && (
              <motion.button
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={exportToCSV}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 font-bold hover:bg-emerald-500 hover:text-white transition-all text-xs"
              >
                <Database className="w-4 h-4" />
                Export CSV
              </motion.button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Logs & Status */}
          <div className="lg:col-span-5 space-y-6">
            <section className="bg-[#0f0f12] border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/40">
                <div className="flex items-center gap-3">
                  <Database className="w-5 h-5 text-indigo-400" />
                  <span className="text-xs font-bold uppercase tracking-[0.1em] text-zinc-400">Data Keeper Agent</span>
                </div>
                <div className={`h-2.5 w-2.5 rounded-full ${syncStatus?.healthy ? 'bg-emerald-500' : 'bg-red-500'} shadow-[0_0_10px_rgba(16,185,129,0.5)]`} />
              </div>
              <div className="p-6">
                <div className="flex justify-between items-center mb-5">
                  <div>
                    <div className="text-[10px] text-zinc-600 uppercase font-black tracking-widest mb-1.5">Last Full Sync</div>
                    <div className="text-lg font-mono font-bold text-zinc-300">
                      {syncStatus?.lastSync ? new Date(syncStatus.lastSync).toLocaleString('en-US', {
                        year: 'numeric',
                        month: 'numeric',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: 'numeric',
                        second: 'numeric',
                        hour12: true
                      }) : 'Never Synced'}
                    </div>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={runSync}
                    disabled={isSyncing}
                    className={`p-3.5 rounded-2xl transition-all ${
                      isSyncing 
                        ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' 
                        : 'bg-[#1a1a2e] text-indigo-400 hover:bg-indigo-600 hover:text-white shadow-lg'
                    }`}
                  >
                    <CloudDownload className={`w-6 h-6 ${isSyncing ? 'animate-bounce' : ''}`} />
                  </motion.button>
                </div>
                {!syncStatus?.healthy && syncStatus?.lastSync !== 0 && (
                  <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-xl flex items-center gap-3">
                    <Clock className="w-4 h-4 text-red-400" />
                    <p className="text-[10px] text-red-400 font-medium">Cache is stale (&gt;12h). Run sync for fresh data.</p>
                  </div>
                )}
                
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <button
                    onClick={() => exportDataKeeper('daily')}
                    className="flex items-center justify-center gap-2 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-bold text-zinc-400 hover:text-white hover:border-zinc-700 transition-all uppercase tracking-widest"
                  >
                    <Database className="w-3 h-3" />
                    Export Daily
                  </button>
                  <button
                    onClick={() => exportDataKeeper('intraday')}
                    className="flex items-center justify-center gap-2 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-bold text-zinc-400 hover:text-white hover:border-zinc-700 transition-all uppercase tracking-widest"
                  >
                    <Database className="w-3 h-3" />
                    Export Intraday
                  </button>
                </div>

                <p className="text-[10px] text-zinc-600 mt-4 leading-relaxed">
                  The Data Keeper fetches 90-day candle data for the entire universe (NIFTY50, etc.) and stores it locally to improve scan speed and reliability.
                </p>
              </div>
            </section>

            {/* m.Stock Broker Auth Removed per user request */}
            {/* Portfolio Agent Removed per user request */}

            <section className="bg-[#0f0f12] border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/40">
                <div className="flex items-center gap-3">
                  <Terminal className="w-5 h-5 text-emerald-400" />
                  <span className="text-xs font-bold uppercase tracking-[0.1em] text-zinc-400">Agent Command Center</span>
                </div>
                <div className="flex items-center gap-4">
                  {isMonitoring && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center gap-2 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-md"
                    >
                      <div className="h-1.5 w-1.5 bg-emerald-500 rounded-full animate-pulse" />
                      <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-tighter">Live Monitor Active (20s)</span>
                    </motion.div>
                  )}
                  {isRunning && <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />}
                </div>
              </div>
              <div className="p-4 font-mono text-[13px] h-[400px] overflow-y-auto space-y-1.5 scrollbar-thin scrollbar-thumb-zinc-800">
                {logs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-600 space-y-3 opacity-50">
                    <Terminal className="w-8 h-8" />
                    <p>System idle. Waiting for deployment...</p>
                  </div>
                ) : (
                  logs.map((log, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="text-emerald-400/80"
                    >
                      <span className="text-zinc-600 mr-2">$</span>
                      {log}
                    </motion.div>
                  ))
                )}
              </div>
            </section>

            <div className="grid grid-cols-2 gap-4">
              <StatsCard 
                label="System Capital" 
                value="₹1,00,00,000" 
                sub="Risk Limit: 10%" 
                icon={TrendingUp}
                color="text-indigo-400"
              />
              <StatsCard 
                label="Active Group" 
                value="Darvas Box" 
                sub="Momentum Aggressive" 
                icon={ShieldCheck}
                color="text-emerald-400"
              />
            </div>
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-7">
            <AnimatePresence mode="wait">
              <motion.div 
                key={activeTab}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6"
              >
                {/* Tabs Selector (Always Available) */}
                <div className="flex bg-zinc-900/50 border border-zinc-800 p-1 rounded-xl w-full select-none">
                  <button
                    onClick={() => setActiveTab('darvas')}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                      activeTab === 'darvas'
                        ? 'bg-indigo-600 text-white shadow-md'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                    }`}
                  >
                    Darvas Monitor
                  </button>
                  <button
                    onClick={() => setActiveTab('pending')}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                      activeTab === 'pending'
                        ? 'bg-orange-600 text-white shadow-md'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                    }`}
                  >
                    CEO Desk
                    {results?.darvas?.pendingTrades?.length > 0 && (
                      <span className="bg-emerald-500 text-zinc-900 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
                        {results.darvas.pendingTrades.length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setActiveTab('rsTrend')}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                      activeTab === 'rsTrend'
                        ? 'bg-[#00ad6f] text-white shadow-md'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                    }`}
                  >
                    RS Trend Scan
                  </button>
                  <button
                    onClick={() => setActiveTab('custom')}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                      activeTab === 'custom'
                        ? 'bg-purple-600 text-white shadow-md'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                    }`}
                  >
                    Custom Scan
                  </button>
                  <button
                    onClick={() => setActiveTab('spike')}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                      activeTab === 'spike'
                        ? 'bg-amber-600 text-white shadow-md'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                    }`}
                  >
                    Volume Spike
                  </button>
                </div>

                {/* 1. Darvas Monitor Tab */}
                {activeTab === 'darvas' && (
                  <div className="space-y-6">
                    {/* Control Panel & Standalone Trigger */}
                    <div className="bg-[#0f0f12] p-6 rounded-2xl border border-zinc-800/80 space-y-4 shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-800/60 pb-4 gap-3">
                        <div>
                          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Darvas Box Agent Dashboard</h3>
                          <p className="text-[10px] text-zinc-500">Tracks price ranges and breakout metrics. Relayed to Broker Agent.</p>
                        </div>
                        <button
                          onClick={runDarvasScan}
                          disabled={isRunning}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 rounded-xl font-bold text-xs text-white transition-all shadow-md shadow-indigo-600/20 active:scale-95 flex items-center justify-center gap-1.5 self-start sm:self-auto"
                        >
                          {isRunning && activeScan === 'darvas' ? <Activity className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                          Start Darvas Auto-Monitor (20s)
                        </button>
                      </div>
                      
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        {/* Price Position */}
                        <div className="bg-zinc-900/35 border border-zinc-805 p-4 rounded-xl flex flex-col items-center justify-between gap-3">
                          <div className="flex items-center gap-3 w-full">
                            <div className="p-2 bg-indigo-500/10 rounded-lg">
                              <BarChart3 className="w-4 h-4 text-indigo-400" />
                            </div>
                            <div className="flex-1">
                              <div className="flex justify-between items-center">
                                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Price Position</h4>
                                <div className="bg-indigo-500/20 px-2 py-0.5 rounded text-[10px] font-bold text-indigo-400">{positionFilter}%</div>
                              </div>
                              <p className="text-[9px] text-zinc-500">Filter: Above % of range</p>
                            </div>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max="100" 
                            value={positionFilter}
                            onChange={(e) => setPositionFilter(Number(e.target.value))}
                            className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                          />
                        </div>

                        {/* Volume Filter */}
                        <div className="bg-zinc-900/35 border border-zinc-805 p-4 rounded-xl flex flex-col items-center justify-between gap-3">
                          <div className="flex items-center gap-3 w-full">
                            <div className="p-2 bg-emerald-500/10 rounded-lg">
                              <Activity className="w-4 h-4 text-emerald-400" />
                            </div>
                            <div className="flex-1">
                              <div className="flex justify-between items-center">
                                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Volume Filter</h4>
                                <div className="bg-emerald-500/20 px-2 py-0.5 rounded text-[10px] font-bold text-emerald-400">{volumeFilter}x</div>
                              </div>
                              <p className="text-[9px] text-zinc-500">Filter: Above avg volume</p>
                            </div>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max="10" 
                            step="0.5"
                            value={volumeFilter}
                            onChange={(e) => setVolumeFilter(Number(e.target.value))}
                            className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>

                        {/* System multiplier */}
                        <div className="bg-indigo-600/10 border border-indigo-500/20 p-4 rounded-xl flex flex-col items-center justify-between gap-3">
                          <div className="flex items-center gap-3 w-full">
                            <div className="p-2 bg-indigo-500 rounded-lg">
                              <Zap className="w-4 h-4 text-white" />
                            </div>
                            <div className="flex-1">
                              <div className="flex justify-between items-center">
                                <h4 className="text-xs font-bold text-indigo-100 uppercase tracking-wider">System Threshold</h4>
                                <div className="bg-indigo-500 px-2 py-0.5 rounded text-[10px] font-bold text-white">{volMultiplier}x</div>
                              </div>
                              <p className="text-[9px] text-indigo-300/70">Engine: Volume Multiplier</p>
                            </div>
                          </div>
                          <input 
                            type="range" 
                            min="0.5" 
                            max="10" 
                            step="0.1"
                            value={volMultiplier}
                            onChange={(e) => setVolMultiplier(Number(e.target.value))}
                            className="w-full h-1.5 bg-indigo-900 rounded-lg appearance-none cursor-pointer accent-white"
                          />
                        </div>
                      </div>
                    </div>

                    {results?.darvas ? (
                      <>
                        {/* Summary metrics header */}
                        <div className="grid grid-cols-4 gap-6">
                          <SummaryMetric 
                            label="Scan Scope" 
                            value={results.darvas.candidates?.length || 0} 
                            sub="Assets" 
                            onClick={() => setActiveDetail('scope')}
                          />
                          <SummaryMetric 
                            label="Valid Signals" 
                            value={results.darvas.signals?.length || 0} 
                            sub="Opportunities" 
                            onClick={() => setActiveDetail('signals')}
                          />
                          <SummaryMetric 
                            label="CEO Desk" 
                            value={results.darvas.pendingTrades?.length || 0} 
                            sub="Requires Action" 
                            onClick={() => setActiveTab('pending')}
                          />
                          <SummaryMetric 
                            label="Executions" 
                            value={results.darvas.executedTrades?.length || 0} 
                            sub="Orders" 
                          />
                        </div>

                        {/* Executions log */}
                        {results.darvas.executedTrades?.length > 0 && (
                          <section>
                            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4 px-1">Recent Executions</h3>
                            <div className="space-y-3">
                              {results.darvas.executedTrades.map((trade: any, i: number) => (
                                <TradeCard key={i} trade={trade} />
                              ))}
                            </div>
                          </section>
                        )}

                        {/* Pipeline grid */}
                        <section>
                          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4 px-1">Candidate Pipeline (Darvas)</h3>
                          {results.darvas.candidates?.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {results.darvas.candidates
                                ?.filter((c: any) => {
                                  const pos = ((c.currentPrice - c.boxLow) / (c.boxHigh - c.boxLow)) * 100;
                                  return pos >= positionFilter && c.volumeRatio >= volumeFilter;
                                })
                                .map((c: any, i: number) => (
                                  <CandidateCard key={i} candidate={c} live={liveMetrics[c.symbol]} onClick={() => onCompanyClick(c.symbol)} />
                                ))}
                            </div>
                          ) : (
                            <div className="text-center py-8 text-zinc-500 italic">No assets qualified for Darvas criteria.</div>
                          )}
                        </section>
                      </>
                    ) : (
                      <div className="bg-[#0f0f12]/30 border-2 border-dashed border-zinc-800 rounded-3xl p-16 text-center text-zinc-500">
                        <h4 className="text-sm font-bold text-zinc-400 mb-1">Darvas Monitor Idle</h4>
                        <p className="text-xs max-w-xs mx-auto mb-4 text-zinc-600">Start the auto-monitor above to begin collecting breakout trades and plotting box candidates.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. RS Trend Tab */}
                {activeTab === 'rsTrend' && (
                  <div className="space-y-6">
                    <div className="bg-[#0f0f12] p-6 rounded-2xl border border-zinc-800/80 space-y-4 shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-800/60 pb-4 gap-3">
                        <div>
                          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Relative Strength Trend Scanner</h3>
                          <p className="text-[10px] text-zinc-500">Compares asset performance indices relative to broad market benchmarks over 10D-90D.</p>
                        </div>
                        <button
                          onClick={runRsTrendScan}
                          disabled={isRunning}
                          className="px-4 py-2 bg-[#00ad6f] hover:bg-emerald-500 disabled:bg-zinc-800 rounded-xl font-bold text-xs text-white transition-all shadow-md shadow-emerald-600/20 active:scale-95 flex items-center justify-center gap-1.5 self-start sm:self-auto"
                        >
                          {isRunning ? <Activity className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                          Run RS Trend Scan
                        </button>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Price Position */}
                        <div className="bg-zinc-900/35 border border-zinc-805 p-4 rounded-xl flex flex-col items-center justify-between gap-3">
                          <div className="flex items-center gap-3 w-full">
                            <div className="p-2 bg-emerald-500/10 rounded-lg">
                              <BarChart3 className="w-4 h-4 text-emerald-400" />
                            </div>
                            <div className="flex-1">
                              <div className="flex justify-between items-center">
                                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Price Position</h4>
                                <div className="bg-emerald-500/20 px-2 py-0.5 rounded text-[10px] font-bold text-emerald-400">{positionFilter}%</div>
                              </div>
                              <p className="text-[9px] text-zinc-500">Filter: Above % of range</p>
                            </div>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max="100" 
                            value={positionFilter}
                            onChange={(e) => setPositionFilter(Number(e.target.value))}
                            className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>

                        {/* Volume Filter */}
                        <div className="bg-zinc-900/35 border border-zinc-805 p-4 rounded-xl flex flex-col items-center justify-between gap-3">
                          <div className="flex items-center gap-3 w-full">
                            <div className="p-2 bg-emerald-500/10 rounded-lg">
                              <Activity className="w-4 h-4 text-[#00ad6f]" />
                            </div>
                            <div className="flex-1">
                              <div className="flex justify-between items-center">
                                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Volume Filter</h4>
                                <div className="bg-emerald-500/20 px-2 py-0.5 rounded text-[10px] font-bold text-[#00ad6f]">{volumeFilter}x</div>
                              </div>
                              <p className="text-[9px] text-zinc-500">Filter: Above avg volume</p>
                            </div>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max="10" 
                            step="0.5"
                            value={volumeFilter}
                            onChange={(e) => setVolumeFilter(Number(e.target.value))}
                            className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>
                      </div>
                    </div>

                    {results?.rsTrend ? (
                      <>
                        <div className="grid grid-cols-3 gap-6">
                          <SummaryMetric 
                            label="Scan Scope" 
                            value={results.rsTrend.candidates?.length || 0} 
                            sub="Assets" 
                            onClick={() => setActiveDetail('scope')}
                          />
                          <SummaryMetric 
                            label="Valid Signals" 
                            value={results.rsTrend.signals?.length || 0} 
                            sub="Opportunities" 
                            onClick={() => setActiveDetail('signals')}
                          />
                          <SummaryMetric 
                            label="Executions" 
                            value={results.rsTrend.executedTrades?.length || 0} 
                            sub="Orders" 
                          />
                        </div>

                        <section>
                          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4 px-1">Candidate Pipeline (RS Trend)</h3>
                          {results.rsTrend.candidates?.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {results.rsTrend.candidates
                                ?.filter((c: any) => {
                                  const pos = ((c.currentPrice - c.boxLow) / (c.boxHigh - c.boxLow)) * 100;
                                  return pos >= positionFilter && c.volumeRatio >= volumeFilter;
                                })
                                .map((c: any, i: number) => (
                                  <CandidateCard key={i} candidate={c} live={liveMetrics[c.symbol]} onClick={() => onCompanyClick(c.symbol)} />
                                ))}
                            </div>
                          ) : (
                            <div className="text-center py-8 text-zinc-500 italic">No assets qualified for RS Trend.</div>
                          )}
                        </section>
                      </>
                    ) : (
                      <div className="bg-[#0f0f12]/30 border-2 border-dashed border-zinc-800 rounded-3xl p-16 text-center text-zinc-500">
                        <h4 className="text-sm font-bold text-zinc-400 mb-1">RS Trend Idle</h4>
                        <p className="text-xs max-w-xs mx-auto mb-4 text-zinc-600">Run the comparative RS Trend index scanner above to calculate asset values.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* 3. Custom Slicers Tab */}
                {activeTab === 'custom' && (
                  <div className="space-y-6">
                    <div className="bg-[#0f0f12] p-6 rounded-2xl border border-zinc-800/80 space-y-4 shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-800/60 pb-4 gap-3">
                        <div>
                          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Custom Filter Momentum Scan</h3>
                          <p className="text-[10px] text-zinc-500">Fine-tune range bounds off historical 90-day highs and daily percentage limits.</p>
                        </div>
                        <button
                          onClick={runCustomFilterScan}
                          disabled={isRunning}
                          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 rounded-xl font-bold text-xs text-white transition-all shadow-md shadow-purple-600/20 active:scale-95 flex items-center justify-center gap-1.5 self-start sm:self-auto"
                        >
                          {isRunning ? <Activity className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                          Run Custom Scan
                        </button>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Dist From High */}
                        <div className="bg-zinc-900/35 border border-zinc-805 p-4 rounded-xl flex flex-col items-center justify-between gap-3">
                          <div className="flex items-center gap-3 w-full">
                            <div className="p-2 bg-purple-500/10 rounded-lg">
                              <TrendingUp className="w-4 h-4 text-purple-400" />
                            </div>
                            <div className="flex-1">
                              <div className="flex justify-between items-center">
                                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Dist From 90D High</h4>
                                <div className="bg-purple-500/20 px-2 py-0.5 rounded text-[10px] font-bold text-purple-400">{maxDistFromHigh}%</div>
                              </div>
                              <p className="text-[9px] text-zinc-500">Filter: Max % off high</p>
                            </div>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max="100" 
                            value={maxDistFromHigh}
                            onChange={(e) => setMaxDistFromHigh(Number(e.target.value))}
                            className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                          />
                        </div>

                        {/* Daily Change */}
                        <div className="bg-zinc-900/35 border border-zinc-805 p-4 rounded-xl flex flex-col items-center justify-between gap-3">
                          <div className="flex items-center gap-3 w-full">
                            <div className="p-2 bg-amber-500/10 rounded-lg">
                              <Activity className="w-4 h-4 text-amber-400" />
                            </div>
                            <div className="flex-1">
                              <div className="flex justify-between items-center">
                                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Daily Change Range</h4>
                                <div className="bg-amber-500/20 px-2 py-0.5 rounded text-[10px] font-bold text-amber-400">{dailyChangeMin}% to {dailyChangeMax}%</div>
                              </div>
                              <p className="text-[9px] text-zinc-500">Filter: min/max daily % change</p>
                            </div>
                          </div>
                          <div className="flex gap-4 w-full pt-1">
                            <input 
                              type="number" 
                              value={dailyChangeMin}
                              onChange={(e) => setDailyChangeMin(Number(e.target.value))}
                              className="w-1/2 bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1 text-xs text-zinc-300 font-mono text-center"
                            />
                            <input 
                              type="number" 
                              value={dailyChangeMax}
                              onChange={(e) => setDailyChangeMax(Number(e.target.value))}
                              className="w-1/2 bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1 text-xs text-zinc-300 font-mono text-center"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {results?.custom ? (
                      <>
                        <div className="grid grid-cols-3 gap-6">
                          <SummaryMetric 
                            label="Scan Scope" 
                            value={results.custom.candidates?.length || 0} 
                            sub="Assets" 
                            onClick={() => setActiveDetail('scope')}
                          />
                          <SummaryMetric 
                            label="Valid Signals" 
                            value={results.custom.signals?.length || 0} 
                            sub="Opportunities" 
                            onClick={() => setActiveDetail('signals')}
                          />
                          <SummaryMetric 
                            label="Executions" 
                            value={results.custom.executedTrades?.length || 0} 
                            sub="Orders" 
                          />
                        </div>

                        <section>
                          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4 px-1">Candidate Pipeline (Custom Filter)</h3>
                          {results.custom.candidates?.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {results.custom.candidates
                                ?.filter((c: any) => {
                                  const pos = ((c.currentPrice - c.boxLow) / (c.boxHigh - c.boxLow)) * 100;
                                  return pos >= positionFilter && c.volumeRatio >= volumeFilter;
                                })
                                .map((c: any, i: number) => (
                                  <CandidateCard key={i} candidate={c} live={liveMetrics[c.symbol]} onClick={() => onCompanyClick(c.symbol)} />
                                ))}
                            </div>
                          ) : (
                            <div className="text-center py-8 text-zinc-500 italic">No assets qualified for Custom Filter.</div>
                          )}
                        </section>
                      </>
                    ) : (
                      <div className="bg-[#0f0f12]/30 border-2 border-dashed border-zinc-800 rounded-3xl p-16 text-center text-zinc-500">
                        <h4 className="text-sm font-bold text-zinc-400 mb-1">Custom Slicing Idle</h4>
                        <p className="text-xs max-w-xs mx-auto mb-4 text-zinc-600">Apply the fine-tuning sliders and trigger the custom momentum agent above.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* 4. Volume Spike Tab */}
                {activeTab === 'spike' && (
                  <div className="space-y-6">
                    <div className="bg-[#0f0f12] p-6 rounded-2xl border border-zinc-800/80 space-y-4 shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-800/60 pb-4 gap-3">
                        <div>
                          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Volume Spike Detection Agent</h3>
                          <p className="text-[10px] text-zinc-500">Detects real-time anomalous volume surges on Indian assets in reference to baseline averages.</p>
                        </div>
                        <button
                          onClick={runVolumeSpikeScan}
                          disabled={isRunning}
                          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-800 rounded-xl font-bold text-xs text-white transition-all shadow-md shadow-amber-600/20 active:scale-95 flex items-center justify-center gap-1.5 self-start sm:self-auto"
                        >
                          {isRunning ? <Activity className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                          Run Volume Spike Scan
                        </button>
                      </div>
                      
                      <div className="grid grid-cols-1 gap-4">
                        <div className="bg-zinc-900/35 border border-zinc-805 p-4 rounded-xl flex flex-col items-center justify-between gap-3">
                          <div className="flex items-center gap-3 w-full">
                            <div className="p-2 bg-amber-500/10 rounded-lg">
                              <Zap className="w-4 h-4 text-amber-400" />
                            </div>
                            <div className="flex-1">
                              <div className="flex justify-between items-center">
                                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Spike Multiplier Factor</h4>
                                <div className="bg-amber-500/20 px-2 py-0.5 rounded text-[10px] font-bold text-amber-500">{spikeFactor}x</div>
                              </div>
                              <p className="text-[9px] text-zinc-500">Filter: Candidates must exceed normal 1m rolling average volumes by factor ratio.</p>
                            </div>
                          </div>
                          <input 
                            type="range" 
                            min="2" 
                            max="10" 
                            step="1"
                            value={spikeFactor}
                            onChange={(e) => setSpikeFactor(Number(e.target.value))}
                            className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                          />
                        </div>
                      </div>
                    </div>

                    {results?.spikes ? (
                      <section>
                        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4 px-1">Detected Volume Spikes</h3>
                        {results.spikes.length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {results.spikes.map((spike: any, i: number) => (
                              <VolumeSpikeCard 
                                key={i} 
                                symbol={spike.symbol} 
                                time={spike.time} 
                                priceChangePercent={spike.priceChangePercent} 
                                todayLow={spike.todayLow} 
                                todayHigh={spike.todayHigh} 
                                currentPrice={spike.currentPrice} 
                                ratio={spike.ratio} 
                                avgVolume={spike.avgVolume} 
                                spikeVolume={spike.spikeVolume} 
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-12 text-zinc-500 italic bg-zinc-950/20 border border-zinc-800/50 rounded-2xl">
                            No anomalous volume spikes detected above the custom {spikeFactor}x baseline factor.
                          </div>
                        )}
                      </section>
                    ) : (
                      <div className="bg-[#0f0f12]/30 border-2 border-dashed border-zinc-800 rounded-3xl p-16 text-center text-zinc-500">
                        <h4 className="text-sm font-bold text-zinc-400 mb-1">Volume Spike Idle</h4>
                        <p className="text-xs max-w-xs mx-auto mb-4 text-zinc-600">Activate the Volume Spike detector above to evaluate and fetch trade volume anomalies.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* 5. Pending Approvals Tab */}
                {activeTab === 'pending' && (
                  <div className="space-y-6">
                    <div className="bg-[#0f0f12] p-6 rounded-2xl border border-zinc-800/80 space-y-4 shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-800/60 pb-4 gap-3">
                        <div>
                          <h3 className="text-sm font-bold text-white uppercase tracking-wider">CEO Trade Approval Center</h3>
                          <p className="text-[10px] text-zinc-500">Review and authorize algorithmic trade signals before execution.</p>
                        </div>
                      </div>
                      
                      {/* Pending Approvals */}
                      {results?.darvas?.pendingTrades?.length > 0 ? (
                        <section>
                          <div className="flex items-center justify-between mb-4 mt-6 px-1">
                            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Requires Your Authorization</h3>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {results.darvas.pendingTrades.map((pending: any, i: number) => {
                              const action = ceoTradeActions[pending.signal.symbol];
                              const isExpanded = expandedSignals[pending.signal.symbol];
                              const isLocked = !!action;
                              
                              let cardStyle = "bg-amber-500/10 border-amber-500/30";
                              let badgeStyle = "bg-amber-500/20 text-amber-500";
                              let badgeText = "PENDING";
                              
                              if (action === 'BUY') {
                                cardStyle = "bg-emerald-500/10 border-emerald-500/30";
                                badgeStyle = "bg-emerald-500/20 text-emerald-400";
                                badgeText = "✓ BUY FUTURES ORDER SENT";
                              } else if (action === 'SELL') {
                                cardStyle = "bg-red-500/10 border-red-500/30";
                                badgeStyle = "bg-red-500/20 text-red-400";
                                badgeText = "✓ SELL FUTURES ORDER SENT";
                              } else if (action === 'SKIP') {
                                cardStyle = "bg-zinc-800/20 border-zinc-700/50 opacity-60";
                                badgeStyle = "bg-zinc-800/50 text-zinc-400";
                                badgeText = "— SIGNAL SKIPPED";
                              }

                              return (
                                <div key={i} className={`border p-5 rounded-xl flex flex-col gap-4 transition-colors ${cardStyle}`}>
                                  <div 
                                    className="flex items-start justify-between cursor-pointer"
                                    onClick={() => toggleSignalExpand(pending.signal.symbol)}
                                  >
                                    <div>
                                      <h4 className="font-bold text-white text-xl">{pending.signal.symbol} <span className="text-sm font-mono tracking-widest ml-1 text-zinc-500">{pending.signal.volumeFactor}x VOL</span></h4>
                                      <p className="text-[10px] text-zinc-400 mt-1 flex items-center gap-2">
                                        <span>EST. PR: ₹{pending.signal.entry.toFixed(2)}</span>
                                        <span>•</span>
                                        <span>QTY: {pending.quantity}</span>
                                        <span>•</span>
                                        <span>FUND: ₹{pending.fundRequired.toFixed(2)}</span>
                                      </p>
                                    </div>
                                    <div className={`px-2 py-1 text-[10px] font-bold rounded ${badgeStyle}`}>
                                      {badgeText}
                                    </div>
                                  </div>

                                  {isExpanded && !isLocked && (
                                    <div className="pt-2 border-t border-zinc-800/50 mt-2 space-y-4">
                                      <div className="grid grid-cols-2 gap-4 bg-black/40 p-4 rounded-lg border border-zinc-800/50">
                                         <div>
                                            <p className="text-[10px] text-zinc-500 uppercase">Breakout Level</p>
                                            <p className="font-bold text-zinc-300">₹{pending.signal.boxTop.toFixed(2)}</p>
                                         </div>
                                         <div>
                                            <p className="text-[10px] text-zinc-500 uppercase">Live Entry Price</p>
                                            <p className="font-bold text-emerald-400">₹{pending.signal.entry.toFixed(2)}</p>
                                         </div>
                                         <div>
                                            <p className="text-[10px] text-zinc-500 uppercase">Volume Surge</p>
                                            <p className="font-bold text-indigo-400">{pending.signal.volumeFactor}x vs average</p>
                                         </div>
                                         <div>
                                            <p className="text-[10px] text-zinc-500 uppercase">Risk / Dist-High</p>
                                            <p className="font-bold text-zinc-300">{pending.signal.distFromHigh.toFixed(2)}%</p>
                                         </div>
                                         <div className="col-span-2 pt-2 border-t border-zinc-800/50">
                                            <p className="text-[10px] text-zinc-500 uppercase flex justify-between">
                                                <span>Fund Required (Margin ~50%)</span>
                                                <span className="font-bold text-emerald-400">₹{pending.fundRequired.toFixed(2)}</span>
                                            </p>
                                         </div>
                                      </div>
                                    </div>
                                  )}
                                  
                                  {!isLocked && (
                                    <div className="grid grid-cols-3 gap-2 mt-2">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); approveFutureTrade(pending, 'BUY'); }}
                                        className="py-2 bg-emerald-600/20 border border-emerald-500/50 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded-lg text-[11px] font-bold shadow-md shadow-emerald-500/20 active:scale-95 transition-all text-center"
                                      >
                                        BUY FUTURE
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); approveFutureTrade(pending, 'SELL'); }}
                                        className="py-2 bg-red-600/20 border border-red-500/50 hover:bg-red-600 text-red-400 hover:text-white rounded-lg text-[11px] font-bold shadow-md shadow-red-500/20 active:scale-95 transition-all text-center"
                                      >
                                        SELL FUTURE
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); approveFutureTrade(pending, 'SKIP'); }}
                                        className="py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-lg text-[11px] font-bold shadow-md active:scale-95 transition-all text-center"
                                      >
                                        SKIP
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      ) : (
                        <div className="bg-[#0f0f12]/30 border-2 border-dashed border-zinc-800 rounded-3xl p-16 text-center text-zinc-500 mt-6">
                          <h4 className="text-sm font-bold text-zinc-400 mb-1">Queue is Empty</h4>
                          <p className="text-xs max-w-xs mx-auto mb-4 text-zinc-600">No trades are pending CEO approval.</p>
                        </div>
                      )}

                      {/* Rejected Signals */}
                      {results?.darvas?.rejections?.length > 0 && (
                        <section className="mt-8 pt-8 border-t border-zinc-800/60">
                          <div className="flex items-center justify-between mb-4 px-1">
                            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Algorithm Rejections</h3>
                          </div>
                          <div className="space-y-3">
                            {results.darvas.rejections.map((rej: any, i: number) => (
                              <div key={i} className="bg-red-500/5 border border-red-500/20 p-4 rounded-xl flex items-center justify-between">
                                <div>
                                  <h4 className="font-bold text-red-400 text-sm">{rej.symbol}</h4>
                                  <p className="text-xs font-mono text-red-400/70 mt-1">{rej.reason}</p>
                                </div>
                                <div className="px-2 py-1 bg-red-500/10 border border-red-500/30 text-red-500 text-[10px] uppercase font-bold rounded">
                                  Rejected
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* News Modal */}
      <AnimatePresence>
        {selectedStock && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedStock(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-xl bg-[#0f0f12] border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-500/10 rounded-lg">
                    <Newspaper className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white leading-tight">{selectedStock} News Agent</h3>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Real-time News Extraction</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedStock(null)}
                  className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-500 hover:text-white"
                >
                  <AlertCircle className="w-5 h-5 rotate-45" />
                </button>
              </div>
              
              <div className="p-8 max-h-[70vh] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800">
                {isFetchingNews ? (
                  <div className="flex flex-col items-center justify-center py-12 space-y-4">
                    <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                    <p className="text-zinc-400 font-medium animate-pulse">Consulting global news papers...</p>
                    <p className="text-[10px] text-zinc-600 uppercase tracking-widest">Searching last 2 hours</p>
                  </div>
                ) : news ? (
                  <div className="space-y-6">
                    <div className="prose prose-invert max-w-none">
                      <p className="text-zinc-300 leading-relaxed text-sm">
                        {news.text}
                      </p>
                    </div>
                    
                    {news.links.length > 0 && (
                      <div className="space-y-3 pt-6 border-t border-zinc-800">
                        <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Verified Sources</h4>
                        <div className="space-y-2">
                          {news.links.map((link, idx) => (
                            <a 
                              key={idx}
                              href={link.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-between p-3 bg-zinc-900/50 border border-zinc-800 rounded-xl hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all group"
                            >
                              <span className="text-xs text-zinc-300 group-hover:text-indigo-300 font-medium truncate pr-4">{link.title}</span>
                              <ExternalLink className="w-3 h-3 text-zinc-600 group-hover:text-indigo-400 flex-shrink-0" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-zinc-500 italic">No news summary available for this symbol.</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Modals */}
      <AnimatePresence>
        {activeDetail && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveDetail(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-[#0f0f12] border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  {activeDetail === 'scope' ? (
                    <><BarChart3 className="w-5 h-5 text-indigo-400" /> Scanning Universe</>
                  ) : (
                    <><Activity className="w-5 h-5 text-emerald-400" /> Valid Trade Signals</>
                  )}
                </h3>
                <button 
                  onClick={() => setActiveDetail(null)}
                  className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-500 hover:text-white"
                >
                  <AlertCircle className="w-5 h-5 rotate-45" />
                </button>
              </div>
              
              <div className="p-6 max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800">
                {activeDetail === 'scope' ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {(() => {
                      const activeResults = activeTab === 'darvas' ? results?.darvas : activeTab === 'rsTrend' ? results?.rsTrend : results?.custom;
                      return activeResults?.candidates
                        ?.filter((c: any) => {
                          const pos = ((c.currentPrice - c.boxLow) / (c.boxHigh - c.boxLow)) * 100;
                          return pos >= positionFilter && c.volumeRatio >= volumeFilter;
                        })
                        .map((c: any, i: number) => (
                        <div 
                          key={i} 
                          onClick={() => {
                            setActiveDetail(null);
                            onCompanyClick(c.symbol);
                          }}
                          className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl cursor-pointer hover:border-indigo-500/50 hover:bg-zinc-800 transition-all group/sc"
                        >
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <div className="font-bold text-zinc-100 group-hover/sc:text-indigo-400 transition-colors text-base">{c.symbol}</div>
                              <span className={`text-[8px] px-1 py-0.5 rounded border font-bold uppercase ${
                                c.marketCap === 'Large' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
                                c.marketCap === 'Mid' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                                'bg-purple-500/10 border-purple-500/20 text-purple-400'
                              }`}>
                                {c.marketCap}
                              </span>
                            </div>
                          </div>
                          <div className="text-[10px] font-bold text-indigo-400 bg-indigo-400/10 px-2 py-1 rounded-md">{c.volumeRatio.toFixed(1)}x Vol</div>
                        </div>
                        
                        <div className="space-y-3">
                          {/* RS Table Mini */}
                          <div className="grid grid-cols-5 gap-1 text-center border-b border-zinc-800 pb-2 mb-2">
                            <span className="text-[9px] text-zinc-500 text-left">Bench</span>
                            <span className="text-[9px] text-zinc-500">10d</span>
                            <span className="text-[9px] text-zinc-500">30d</span>
                            <span className="text-[9px] text-zinc-500">60d</span>
                            <span className="text-[9px] text-zinc-500">90d</span>
                            
                            <span className="text-[9px] font-bold text-indigo-300 text-left truncate">Broad(N50)</span>
                            <span className={`text-[9px] font-mono ${c.rsNifty?.rpi10 > 1 ? 'text-emerald-400' : 'text-red-400'}`}>{c.rsNifty?.rpi10 || '0'}</span>
                            <span className={`text-[9px] font-mono ${c.rsNifty?.rpi30 > 1 ? 'text-emerald-400' : 'text-red-400'}`}>{c.rsNifty?.rpi30 || '0'}</span>
                            <span className={`text-[9px] font-mono ${c.rsNifty?.rpi60 > 1 ? 'text-emerald-400' : 'text-red-400'}`}>{c.rsNifty?.rpi60 || '0'}</span>
                            <span className={`text-[9px] font-mono ${c.rsNifty?.rpi90 > 1 ? 'text-emerald-400' : 'text-red-400'}`}>{c.rsNifty?.rpi90 || '0'}</span>

                            {c.rsIndex && (
                              <>
                                <span className={`text-[9px] font-bold text-left truncate ${
                                  c.marketCap === 'Large' ? 'text-blue-400' : 
                                  c.marketCap === 'Mid' ? 'text-amber-400' : 'text-purple-400'
                                }`}>
                                  {c.marketCap}-Cap
                                </span>
                                <span className={`text-[9px] font-mono ${c.rsIndex.rpi10 > 1 ? 'text-emerald-400' : 'text-red-400'}`}>{c.rsIndex.rpi10}</span>
                                <span className={`text-[9px] font-mono ${c.rsIndex.rpi30 > 1 ? 'text-emerald-400' : 'text-red-400'}`}>{c.rsIndex.rpi30}</span>
                                <span className={`text-[9px] font-mono ${c.rsIndex.rpi60 > 1 ? 'text-emerald-400' : 'text-red-400'}`}>{c.rsIndex.rpi60}</span>
                                <span className={`text-[9px] font-mono ${c.rsIndex.rpi90 > 1 ? 'text-emerald-400' : 'text-red-400'}`}>{c.rsIndex.rpi90}</span>
                              </>
                            )}
                          </div>

                          <div className="text-[10px] text-zinc-500 uppercase tracking-tighter flex justify-between">
                            <span>₹{c.currentPrice.toFixed(2)}</span>
                            <span>{(((c.currentPrice - c.boxLow) / (c.boxHigh - c.boxLow)) * 100).toFixed(0)}% Pos</span>
                          </div>
                        </div>
                      </div>
                      ));
                    })()}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(() => {
                      const activeResults = activeTab === 'darvas' ? results?.darvas : activeTab === 'rsTrend' ? results?.rsTrend : results?.custom;
                      return activeResults?.signals
                        ?.filter((s: any) => (s.volumeRatio || (s.currentVolume / s.avgVolume)) >= volumeFilter)
                        .map((s: any, i: number) => {
                        const volMult = (s.currentVolume && s.avgVolume) ? s.currentVolume / s.avgVolume : s.volumeRatio || 1;
                        return (
                          <div 
                            key={i} 
                            onClick={() => {
                              setActiveDetail(null);
                              onCompanyClick(s.symbol);
                            }}
                            className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl flex items-center justify-between cursor-pointer hover:border-emerald-500/50 hover:bg-zinc-800 transition-all group/sig"
                          >
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center group-hover/sig:bg-emerald-500/20 transition-all">
                              <TrendingUp className="w-5 h-5 text-emerald-500" />
                            </div>
                            <div>
                              <div className="font-bold text-white leading-tight group-hover/sig:text-emerald-400 transition-colors uppercase tracking-tight">{s.symbol}</div>
                              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Breakout: ₹{s.breakoutLevel.toFixed(2)}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-bold text-emerald-400">Vol: {volMult.toFixed(2)}x</div>
                            <div className="text-[10px] text-zinc-500 uppercase">Price: ₹{s.entry.toFixed(2)}</div>
                          </div>
                        </div>
                      );
                      });
                    })()}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatsCard({ label, value, sub, icon: Icon, color }: any) {
  return (
    <div className="bg-[#0f0f12] border border-zinc-800 p-5 rounded-2xl hover:border-zinc-700 transition-colors group">
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2 rounded-lg bg-zinc-900 group-hover:bg-zinc-800 transition-colors ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <p className="text-xs text-zinc-500 font-medium">{label}</p>
      <h4 className="text-xl font-bold text-zinc-100">{value}</h4>
      <p className="text-[10px] text-zinc-600 mt-1 uppercase tracking-wider">{sub}</p>
    </div>
  );
}

function SummaryMetric({ label, value, sub, onClick }: any) {
  return (
    <motion.div 
      whileHover={onClick ? { y: -4, borderColor: 'rgb(82 82 91)' } : {}}
      onClick={onClick}
      className={`bg-[#0f0f12] border border-zinc-800 p-6 rounded-2xl text-center transition-all ${onClick ? 'cursor-pointer hover:bg-zinc-900/50' : ''}`}
    >
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-1">{label}</p>
      <div className="text-3xl font-bold text-white mb-0.5">{value}</div>
      <p className="text-[10px] text-zinc-600 font-medium uppercase tracking-wider">{sub}</p>
    </motion.div>
  );
}

function TradeCard({ trade }: any) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-indigo-600/10 border border-indigo-500/30 p-4 rounded-xl flex items-center justify-between"
    >
      <div className="flex items-center gap-4">
        <div className="bg-indigo-500 p-2.5 rounded-lg shadow-lg shadow-indigo-500/20">
          <TrendingUp className="w-4 h-4 text-white" />
        </div>
        <div>
          <h4 className="font-bold text-white leading-tight">{trade.symbol}</h4>
          <p className="text-xs text-indigo-300/70 font-mono">{trade.orderId}</p>
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-bold text-indigo-100">₹{trade.entry.toFixed(2)}</div>
        <div className="text-[10px] text-indigo-400 font-medium uppercase tracking-wider">Qty: {trade.quantity}</div>
      </div>
      <div className="flex items-center gap-2 bg-emerald-500/20 px-3 py-1.5 rounded-full border border-emerald-500/20">
        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-tighter">Approved</span>
      </div>
    </motion.div>
  );
}

function VolumeSpikeCard({ spike, onClick }: any) {
  return (
    <div 
      onClick={onClick}
      className="bg-[#141418] border border-zinc-800 p-5 rounded-2xl hover:border-amber-500/50 transition-all cursor-pointer group/spike shadow-sm"
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center group-hover/spike:bg-amber-500/20 transition-all">
            <Zap className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h4 className="font-bold text-white group-hover/spike:text-amber-400 transition-colors uppercase tracking-tight text-lg">{spike.symbol}</h4>
            <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest flex items-center gap-2">
              <Clock className="w-3 h-3" />
              Detected @ {spike.time}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-bold ${spike.priceChangePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {spike.priceChangePercent >= 0 ? '+' : ''}{spike.priceChangePercent.toFixed(2)}%
          </div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">1m Window</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-zinc-900/50 p-3 rounded-xl border border-zinc-800/50">
          <div className="text-[9px] text-zinc-500 uppercase font-black tracking-widest mb-1">Today's Range</div>
          <div className="text-xs font-mono font-bold text-zinc-300">₹{spike.todayLow.toFixed(0)} - ₹{spike.todayHigh.toFixed(0)}</div>
        </div>
        <div className="bg-zinc-900/50 p-3 rounded-xl border border-zinc-800/50 text-right">
          <div className="text-[9px] text-zinc-500 uppercase font-black tracking-widest mb-1">Current Price</div>
          <div className="text-xs font-mono font-bold text-amber-400">₹{spike.currentPrice.toFixed(2)}</div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-tighter">
          <span className="text-zinc-500">Volume Intensity</span>
          <span className="text-amber-400">{spike.ratio.toFixed(2)}x Baseline</span>
        </div>
        <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, (spike.ratio / 10) * 100)}%` }}
            className="h-full bg-amber-500" 
          />
        </div>
        <div className="flex justify-between text-[9px] text-zinc-600 font-medium">
          <span>Avg 1m: {(spike.avgVolume / 1000).toFixed(0)}k</span>
          <span>Spike: {(spike.spikeVolume / 1000).toFixed(0)}k</span>
        </div>
      </div>
    </div>
  );
}

function CandidateCard({ candidate, live, onClick }: any) {
  const currentPrice = live?.price || candidate.currentPrice;
  const currentVolume = live?.volume || candidate.currentVolume;
  const volRatio = live?.ratio || candidate.volumeRatio || 0;
  const dailyChange = live?.dailyChange ?? candidate.dailyChange;
  const distFromHigh = live?.distFromHigh ?? candidate.distFromHigh;
  
  return (
    <div 
      onClick={onClick}
      className={`bg-[#141418] border p-4 rounded-xl transition-all duration-500 cursor-pointer group/card ${
      live ? 'border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.05)]' : 'border-zinc-800 hover:border-zinc-600'
    }`}>
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="font-bold text-zinc-200 group-hover/card:text-indigo-400 transition-colors uppercase tracking-tight">{candidate.symbol}</h4>
            {live && (
              <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            )}
            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase ${
              candidate.marketCap === 'Large' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
              candidate.marketCap === 'Mid' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
              'bg-purple-500/10 border-purple-500/20 text-purple-400'
            }`}>
              {candidate.marketCap}
            </span>
          </div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <div className={`text-[10px] font-bold uppercase tracking-widest ${volRatio >= 4 ? 'text-emerald-400' : 'text-zinc-500'}`}>
              {volRatio.toFixed(2)}x Factor
            </div>
            {dailyChange !== undefined && (
              <div className={`text-[10px] font-bold ${dailyChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {dailyChange >= 0 ? '+' : ''}{dailyChange.toFixed(2)}%
              </div>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono text-zinc-500">
            {distFromHigh !== undefined ? `Off High: ${distFromHigh.toFixed(1)}%` : `Box: ₹${candidate.boxLow.toFixed(0)}-₹${candidate.boxHigh.toFixed(0)}`}
          </div>
          <motion.div 
            key={currentPrice}
            initial={{ opacity: 0.5 }}
            animate={{ opacity: 1 }}
            className="text-sm font-mono font-bold text-zinc-200 mt-0.5"
          >
            ₹{currentPrice.toFixed(0)}
          </motion.div>
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex flex-col gap-1.5 p-2 bg-black/20 rounded-lg border border-zinc-800/50">
          <div className="flex justify-between items-center text-[9px] uppercase tracking-wider text-zinc-500 font-bold mb-1 border-b border-zinc-800 pb-1">
            <span>Benchmark RS</span>
            <span>10d</span>
            <span>30d</span>
            <span>60d</span>
            <span>90d</span>
          </div>
          {candidate.rsNifty && (
            <div className="flex justify-between items-center">
              <span className="text-[9px] font-bold text-indigo-400 w-12 text-left uppercase tracking-tighter">Nifty50</span>
              <span className={`text-[10px] font-mono ${candidate.rsNifty.rpi10 > candidate.rsNifty.rpi30 ? 'text-emerald-400 font-bold' : 'text-zinc-400'}`}>{candidate.rsNifty.rpi10}</span>
              <span className={`text-[10px] font-mono ${candidate.rsNifty.rpi30 > candidate.rsNifty.rpi60 ? 'text-emerald-400 font-bold' : 'text-zinc-400'}`}>{candidate.rsNifty.rpi30}</span>
              <span className={`text-[10px] font-mono ${candidate.rsNifty.rpi60 > candidate.rsNifty.rpi90 ? 'text-emerald-400 font-bold' : 'text-zinc-400'}`}>{candidate.rsNifty.rpi60}</span>
              <span className="text-[10px] font-mono text-zinc-400">{candidate.rsNifty.rpi90}</span>
            </div>
          )}
          {candidate.rsIndex && (
            <div className="flex justify-between items-center mt-0.5">
              <span className={`text-[9px] font-bold w-12 text-left uppercase tracking-tighter ${
                candidate.marketCap === 'Large' ? 'text-blue-400' :
                candidate.marketCap === 'Mid' ? 'text-amber-400' :
                'text-purple-400'
              }`}>{candidate.marketCap}Cap</span>
              <span className="text-[10px] font-mono text-zinc-500">{candidate.rsIndex.rpi10}</span>
              <span className="text-[10px] font-mono text-zinc-500">{candidate.rsIndex.rpi30}</span>
              <span className="text-[10px] font-mono text-zinc-500">{candidate.rsIndex.rpi60}</span>
              <span className="text-[10px] font-mono text-zinc-500">{candidate.rsIndex.rpi90}</span>
            </div>
          )}
        </div>

        <div className="flex justify-between text-[11px]">
          <span className="text-zinc-500">Relative Price Position</span>
          <span className="text-zinc-200 font-medium">{(((currentPrice - candidate.boxLow) / (Math.max(1, candidate.boxHigh - candidate.boxLow))) * 100).toFixed(0)}%</span>
        </div>
        <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
          <motion.div 
            className="h-full bg-indigo-500/50" 
            animate={{ width: `${Math.min(100, Math.max(0, ((currentPrice - candidate.boxLow) / (Math.max(1, candidate.boxHigh - candidate.boxLow))) * 100))}%` }} 
          />
        </div>
        <div className="flex justify-between text-[10px] pt-1">
          <span className="text-zinc-500">Live Vol: {(currentVolume / 1000).toFixed(0)}k</span>
          <span className={`uppercase tracking-tighter font-bold ${currentPrice >= candidate.boxHigh ? 'text-emerald-400' : 'text-zinc-400'}`}>
            {currentPrice >= candidate.boxHigh ? 'BREAKOUT' : 'CONS0LIDATING'}
          </span>
        </div>
      </div>
    </div>
  );
}
