// Bypass Railway proxy variables immediately before importing anything that brings in Undici/Fetch
process.env.NO_PROXY = "*";
process.env.no_proxy = "*";

import "dotenv/config";
import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { RAW_UNIVERSE, MARKET_UNIVERSE, INDICES } from "./services/marketDataService";
import { DarvasScanner } from "./groups/darvas/scanner";
import { DarvasValidator } from "./groups/darvas/validator";
import { DarvasAuthenticator } from "./groups/darvas/authenticator";
import { TradeConfirmer } from "./core/tradeConfirmer";
import { DarvasExecuter } from "./groups/darvas/executer";
import { SETTINGS } from "./config/settings";
import { MstockService } from "./services/mstockService";

import { DataKeeper } from "./core/dataKeeper";
import { VolumeSpikeScanner } from "./groups/darvas/volumeSpikeScanner";

async function startServer() {
  const app = express();
  
  // App routing and deployments conflict resolution:
  // AI Studio (Cloud Run) proxy strictly routes to 3000, even though PORT env var might be 8080.
  // Railway provides process.env.PORT or user fallback to 3001 (based on your request).
  const isAIStudio = !!process.env.APPLET_ID;
  const PORT = isAIStudio ? 3000 : (Number(process.env.PORT) || 3001);

  app.use(express.json());

  // Mstock API
  app.post("/api/mstock/login", async (req, res) => {
    try {
      const token = await MstockService.autoLoginWithTOTP();
      res.json({ success: true, token });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Data Keeper Sync Endpoint
  app.post("/api/data-keeper/sync", async (req, res) => {
    try {
      // Start sync in background so Railway proxy doesn't timeout the HTTP request
      DataKeeper.fetchAndStore(MARKET_UNIVERSE)
        .then(() => console.log("Background sync finished successfully."))
        .catch(e => console.error("Background sync failed:", e));

      res.json({ success: true, message: "Synchronization started in background. This will take ~1-2 minutes. Please wait then refresh or perform scans.", lastSync: Date.now() });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.get("/api/data-keeper/status", async (req, res) => {
    try {
      const lastSync = await DataKeeper.getLastSyncTime();
      const healthy = await DataKeeper.isCacheHealthy();
      res.json({ lastSync, healthy });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // News Endpoint using Gemini Google Search Grounding
  app.get("/api/news", async (req, res) => {
    const symbol = req.query.symbol as string;
    if (!symbol) return res.status(400).json({ success: false, error: "symbol is required" });
    
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY is missing from environment variables.");
      
      const ai = new GoogleGenAI({ apiKey });
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

      res.json({ success: true, text, links });
    } catch (error: any) {
      console.error("News API Error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/portfolio", async (req, res) => {
    try {
      // Disabled per user request
      res.json({ success: true, portfolio: null });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/test-mstock-auth", async (req, res) => {
    try {
      const hasApiKey = !!process.env.MSTOCK_API_KEY;
      
      const result = await MstockService.authenticate();
      res.json({ 
        success: true, 
        result,
        envVarsPresent: {
           hasApiKey
        }
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: String(e) });
    }
  });

  app.get("/api/data-keeper/export", async (req, res) => {
    try {
      const type = req.query.type as string;
      const cache = type === "intraday" 
        ? await DataKeeper.getFullIntradayCache() 
        : await DataKeeper.getFullCache();
      
      if (!cache) {
        return res.status(404).json({ success: false, error: "Cache empty or not found" });
      }

      res.json({ success: true, cache });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // API Routes
  app.post("/api/run-all-scans", async (req, res) => {
    try {
      console.log(`===== STARTING UNIFIED SCAN =====`);
      const { customFilters, multiplier, excludeSymbols = [] } = req.body;
      
      const targetUniverse = RAW_UNIVERSE.filter(s => !excludeSymbols.includes(s));
      
      const darvasCandidates = await DarvasScanner.scan(targetUniverse, { volumeMultiplier: multiplier });
      const { signals: darvasSignals, liveMetrics: darvasLiveMetrics } = await DarvasValidator.validate(darvasCandidates, multiplier);
      
      const pendingTrades = [];
      const rejections: any[] = [];
      for (const signal of darvasSignals) {
        const authenticated = await DarvasAuthenticator.authenticate(signal, multiplier);
        if (!authenticated.authenticated || !authenticated.signal) {
          rejections.push({ symbol: signal.symbol, reason: authenticated.reason || 'Authentication failed' });
          continue;
        }

        const reviewed = await TradeConfirmer.confirm(authenticated.signal);
        if (!reviewed.approved) {
          rejections.push({ symbol: signal.symbol, reason: reviewed.reason });
          continue;
        }
        
        pendingTrades.push({
          signal: authenticated.signal,
          quantity: reviewed.quantity,
          fundRequired: reviewed.fundRequired
        });
      }
      
      const rsTrendCandidates = await DarvasScanner.scan(RAW_UNIVERSE, { rsTrendOnly: true });
      const { liveMetrics: rsLiveMetrics } = await DarvasValidator.validate(rsTrendCandidates);
      
      const customCandidates = await DarvasScanner.scan(RAW_UNIVERSE, { customFilters });
      const { liveMetrics: customLiveMetrics } = await DarvasValidator.validate(customCandidates);

      const combinedLiveMetrics = { ...darvasLiveMetrics, ...rsLiveMetrics, ...customLiveMetrics };
      
      res.json({
        success: true,
        darvas: { candidates: darvasCandidates, signals: darvasSignals, pendingTrades, rejections },
        rsTrend: { candidates: rsTrendCandidates },
        custom: { candidates: customCandidates },
        liveMetrics: combinedLiveMetrics
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/run-darvas-system", async (req, res) => {
    try {
      const multiplier = req.query.multiplier ? parseFloat(req.query.multiplier as string) : SETTINGS.VOLUME_MULTIPLIER;
      
      console.log(`===== STARTING DARVAS ENGINE (Vol Mult: ${multiplier}) =====`);

      // STEP 1: SCANNER
      const candidates = await DarvasScanner.scan(RAW_UNIVERSE, { volumeMultiplier: multiplier });
      
      // STEP 2: VALIDATOR
      const { signals, liveMetrics } = await DarvasValidator.validate(candidates, multiplier);
      
      const pendingTrades = [];
      const rejections: any[] = [];

      for (const signal of signals) {
        // STEP 3: AUTHENTICATOR
        const authenticated = await DarvasAuthenticator.authenticate(signal, multiplier);
        if (!authenticated.authenticated || !authenticated.signal) {
          rejections.push({ symbol: signal.symbol, reason: authenticated.reason || 'Authentication failed' });
          continue;
        }

        // STEP 4: TRADE CONFIRMER
        const reviewed = await TradeConfirmer.confirm(authenticated.signal);
        if (!reviewed.approved) {
          rejections.push({ symbol: signal.symbol, reason: reviewed.reason });
          continue;
        }

        pendingTrades.push({
          signal: authenticated.signal,
          quantity: reviewed.quantity,
          fundRequired: reviewed.fundRequired
        });
      }

      res.json({
        success: true,
        candidates,
        signals,
        liveMetrics,
        pendingTrades,
        rejections,
        config: { ...SETTINGS, VOLUME_MULTIPLIER: multiplier }
      });

    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/run-rs-trend-scan", async (req, res) => {
    try {
      console.log(`===== STARTING RS TREND SCAN (Scan 2) =====`);
      const candidates = await DarvasScanner.scan(RAW_UNIVERSE, { rsTrendOnly: true });
      const { liveMetrics } = await DarvasValidator.validate(candidates);
      
      res.json({
        success: true,
        candidates,
        signals: [],
        liveMetrics,
        executedTrades: [],
        config: SETTINGS
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/api/run-custom-scan", async (req, res) => {
    try {
      console.log(`===== STARTING CUSTOM SCAN (Scan 3) =====`);
      const { filters } = req.body;
      const candidates = await DarvasScanner.scan(RAW_UNIVERSE, { customFilters: filters });
      const { liveMetrics } = await DarvasValidator.validate(candidates);
      
      res.json({
        success: true,
        candidates,
        signals: [],
        liveMetrics,
        executedTrades: [],
        config: SETTINGS
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  app.get("/api/run-volume-spike-scan", async (req, res) => {
    try {
      console.log(`===== STARTING VOLUME SPIKE SCAN (Scan 4) =====`);
      const factor = req.query.factor ? parseFloat(req.query.factor as string) : 3;
      const spikes = await VolumeSpikeScanner.scan(RAW_UNIVERSE, factor);
      
      res.json({
        success: true,
        spikes,
        config: { ...SETTINGS, VOLUME_SPIKE_FACTOR: factor }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/api/approve-trades", async (req, res) => {
    try {
      const { approvedSignals } = req.body;
      const executedTrades = [];
      const executionErrors: any[] = [];
      
      for (const pending of approvedSignals) {
        try {
          // STEP 5: EXECUTER (triggered manually by CEO)
          const trade = await DarvasExecuter.execute(pending.signal.symbol, pending.signal.entry);
          if (trade) {
            executedTrades.push(trade);
          }
        } catch (e: any) {
          executionErrors.push({ symbol: pending.signal.symbol, reason: e.message || 'Broker execution failed' });
        }
      }
      
      res.json({ success: true, executedTrades, executionErrors });
    } catch (error) {
       res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.post("/api/re-validate", async (req, res) => {
    try {
      const { candidates, multiplier } = req.body;
      const result = await DarvasValidator.validate(candidates, multiplier);
      
      const pendingTrades = [];
      const rejections: any[] = [];
      for (const signal of result.signals) {
        const authenticated = await DarvasAuthenticator.authenticate(signal, multiplier);
        if (!authenticated.authenticated || !authenticated.signal) {
          rejections.push({ symbol: signal.symbol, reason: authenticated.reason || 'Authentication failed' });
          continue;
        }

        const reviewed = await TradeConfirmer.confirm(authenticated.signal);
        if (!reviewed.approved) {
          rejections.push({ symbol: signal.symbol, reason: reviewed.reason });
          continue;
        }

        pendingTrades.push({
          signal: authenticated.signal,
          quantity: reviewed.quantity,
          fundRequired: reviewed.fundRequired
        });
      }

      res.json({ success: true, ...result, pendingTrades, rejections });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Vite middleware and SPA fallback MUST be added before app.listen
  if (process.env.NODE_ENV !== "production") {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.error("Failed to start Vite dev server:", err);
    }
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SYSTEM] Server successfully bound to port ${PORT}. Railway check passed.`);
    
    // Wrap your 1-minute scanner inside a safe initialization delay
    setTimeout(() => {
        console.log("[SYSTEM] Initializing 1-minute Darvas Box scheduler...");
        
        let isScanRunning = false;
        
        // Use a safe interval that catches its own errors so it never kills the server
        setInterval(async () => {
            if (isScanRunning) return; // Prevent overlapping scans
            isScanRunning = true;
            try {
                console.log("[SCANNER] Running 1m automatic market scan / sync...");
                await runDarvasBoxScanner(); 
            } catch (scanError: any) {
                // Capturing the error stops the 502 / SIGTERM app crashes completely!
                console.error("[SCANNER ERROR] Scan execution failed, skipping this minute:", scanError.message);
            } finally {
                isScanRunning = false;
            }
        }, 1 * 60 * 1000); // 1-minute loop
        
    }, 5000); // Waits 5 seconds after boot before doing any heavy API work
  });
}

// Background auto-scanner implementation
async function runDarvasBoxScanner() {
  try {
    const isHealthy = await DataKeeper.isCacheHealthy();
    if (!isHealthy) {
       console.log("[SCANNER] Cache stale. Running background fetch...");
       await DataKeeper.fetchAndStore(MARKET_UNIVERSE);
    }
    console.log("[SCANNER] 1m autonomous check completed successfully.");
  } catch (error: any) {
    throw new Error(`Auto-scan failed: ${error.message}`);
  }
}

startServer();
