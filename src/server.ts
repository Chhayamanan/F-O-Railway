// Bypass Railway proxy variables immediately before importing anything that brings in Undici/Fetch
process.env.NO_PROXY = "*";
process.env.no_proxy = "*";

import "dotenv/config";
import express from "express";
import path from "path";
import { RAW_UNIVERSE } from "./services/marketDataService";
import { MstockService } from "./services/mstockService";
import { DataKeeper } from "./core/dataKeeper";
import { ScanEngine } from "./core/scanEngine";

async function startServer() {
  const app = express();
  
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  app.use(express.json());

  // Init Data Keeper
  await DataKeeper.init();

  // ======== SCAN ENGINE API ========
  app.post("/api/scan/sync-180d", async (req, res) => {
    try {
      // Async background sync
      DataKeeper.syncAllStocks().catch(console.error);
      res.json({ success: true, message: "Started 90-day data sync in background." });
    } catch (e: any) {
      res.status(500).json({ success: false, error: String(e) });
    }
  });

  app.get("/api/scan/results", async (req, res) => {
    try {
      const futHighDistance = req.query.futHighDist ? parseFloat(req.query.futHighDist as string) : 0.98;
      const futBaseVolMultiplier = req.query.futVolMult ? parseFloat(req.query.futVolMult as string) : 2.0;
      const optHighDistance = req.query.optHighDist ? parseFloat(req.query.optHighDist as string) : 0.98;
      const optBaseVolMultiplier = req.query.optVolMult ? parseFloat(req.query.optVolMult as string) : 2.0;

      const results = await ScanEngine.runScan(RAW_UNIVERSE, { 
         futHighDistance, futBaseVolMultiplier, 
         optHighDistance, optBaseVolMultiplier 
      });
      res.json({ success: true, data: results });
    } catch (e: any) {
      res.status(500).json({ success: false, error: String(e) });
    }
  });

  app.post("/api/scan/ceo-action", async (req, res) => {
    try {
      const { symbol, action, type } = req.body;
      if (!symbol || !action) return res.status(400).json({ success: false, error: "Missing symbol or action" });
      const result = await ScanEngine.actionCeoItem(symbol, action, type || 'FUT');
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: String(e) });
    }
  });

  app.get("/api/scan/status", async (req, res) => {
     const cache = await DataKeeper.getCache();
     const syncedCount = Object.keys(cache).length;
     res.json({ success: true, syncedCount });
  });

  // ======== MSTOCK API ========
  app.post("/api/mstock/login", async (req, res) => {
    try {
      const token = await MstockService.autoLoginWithTOTP();
      res.json({ success: true, token });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
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

  app.get("/api/portfolio", async (req, res) => {
    try {
      const portfolio = await MstockService.getPortfolioHoldings();
      res.json({ success: true, portfolio });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
  
  app.post("/api/trade/stop-loss", async (req, res) => {
    try {
      const { symbol, quantity, stopLossPrice, type, symbolToken, tradingSymbol } = req.body;
      if (!symbol || !quantity || !stopLossPrice) {
        return res.status(400).json({ success: false, error: "Missing required fields for stop loss." });
      }
      const productType = type === 'FNO' ? 'INTRADAY' : (type === 'MTF' ? 'MTF' : 'DELIVERY');
      const orderId = await MstockService.placeStopLossOrder(symbol, quantity, stopLossPrice, productType, symbolToken, tradingSymbol);
      res.json({ success: true, orderId, message: `Placed SL for ${symbol} at ₹${stopLossPrice}` });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/live-quotes", async (req, res) => {
    try {
      const symbols = req.body.symbols || [];
      const quotes = await MstockService.getCurrentPrices(symbols);
      res.json({ success: true, quotes });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/market-universe", (req, res) => {
    res.json({ success: true, universe: RAW_UNIVERSE });
  });

  // ======== VITE MIDDLEWARE ========
  if (process.env.NODE_ENV !== 'production') {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
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
    console.log(`[SYSTEM] Server successfully bound to port ${PORT}.`);
  });
}

startServer();
