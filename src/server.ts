import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { DataFetcher } from "./services/dataFetcher";
import { placeOrder, getMConnectClient } from "./services/mStockService";
import yahooFinance from "yahoo-finance2";

// Local memory state tracking for daily Nifty metrics boundaries
let niftySessionTracker = {
  dailyHigh: -Infinity,
  dailyLow: Infinity,
  hasTradedToday: false
};

// Reset metrics at market open
const resetDailyNiftyBounds = () => {
  niftySessionTracker.dailyHigh = -Infinity;
  niftySessionTracker.dailyLow = Infinity;
  niftySessionTracker.hasTradedToday = false;
  console.log("[NIFTY ENGINE] State initialized. Awaiting market boundaries...");
};
resetDailyNiftyBounds();

async function startServer() {
  const app = express();
  
  const isAIStudio = !!process.env.APPLET_ID;
  const serverPort = (process.env.PORT && !isAIStudio) ? Number(process.env.PORT) : 3000;
  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/generate-report", async (req, res) => {
    try {
      const saveExcel = req.body.saveExcel !== false;
      const { filePath, data } = await DataFetcher.generateReport(saveExcel);
      res.json({ success: true, message: "Report generated successfully.", data });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/download-report", (req, res) => {
    const filePath = path.join(process.cwd(), 'Stock_Baseline_Report.xlsx');
    if (!fs.existsSync(filePath)) {
      return res.status(404).send("Report not generated yet. Please click 'Refresh Now' first.");
    }
    res.download(filePath, 'Stock_Baseline_Report.xlsx');
  });

  app.post("/api/order", async (req, res) => {
    try {
      const { symbol, token, action } = req.body;
      
      console.log(`Received ${action} request for ${symbol}`);
      const finalToken = token || "11050";
      const result = await placeOrder(symbol, finalToken, action);
      res.json({ success: true, result });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/nifty/check-breakout", async (req, res) => {
    try {
      const { qty } = req.body;
      const targetQuantity = qty || 25;
  
      // 1. Fetch current spot price from Yahoo Finance
      const response = await yahooFinance.chart('^NSEI', { period1: Math.floor(Date.now() / 1000) - 86400, interval: '1m' });
      const quotes = response?.quotes || [];
      
      if (quotes.length === 0) {
        throw new Error("Unable to capture Yahoo index chart data feed.");
      }
  
      const currentQuote = quotes[quotes.length - 1];
      const spotPrice = currentQuote.close;
  
      // Establish historical high/low bounds across active market hours if not populated yet
      if (niftySessionTracker.dailyHigh === -Infinity || niftySessionTracker.dailyLow === Infinity) {
        quotes.forEach((q: any) => {
          if (q.high) niftySessionTracker.dailyHigh = Math.max(niftySessionTracker.dailyHigh, q.high);
          if (q.low) niftySessionTracker.dailyLow = Math.min(niftySessionTracker.dailyLow, q.low);
        });
      }
  
      let executedTrade = null;
  
      // 2. Evaluate breakout logic boundaries
      if (!niftySessionTracker.hasTradedToday) {
        if (spotPrice > niftySessionTracker.dailyHigh) {
          executedTrade = "CALL OPTION (CE)";
          niftySessionTracker.hasTradedToday = true;
          await routeOptionsOrder("CE", spotPrice, targetQuantity);
        } else if (spotPrice < niftySessionTracker.dailyLow) {
          executedTrade = "PUT OPTION (PE)";
          niftySessionTracker.hasTradedToday = true;
          await routeOptionsOrder("PE", spotPrice, targetQuantity);
        }
      }
  
      // Dynamic trailing loop calculation safety update
      if (spotPrice > niftySessionTracker.dailyHigh) niftySessionTracker.dailyHigh = spotPrice;
      if (spotPrice < niftySessionTracker.dailyLow) niftySessionTracker.dailyLow = spotPrice;
  
      res.json({
        success: true,
        executedTrade,
        metrics: {
          ltp: spotPrice,
          high: niftySessionTracker.dailyHigh,
          low: niftySessionTracker.dailyLow,
          lastUpdated: new Date().toLocaleTimeString()
        }
      });
  
    } catch (err: any) {
      console.error("[NIFTY BOT ERROR]", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  
  // Helper function to resolve At-The-Money (ATM) contract details and map to mStock exchange routing
  async function routeOptionsOrder(optionType: 'CE' | 'PE', spotPrice: number, quantity: number) {
    // Round Nifty spot price to the nearest 50-point strike interval (e.g., 22143 -> 22150)
    const strikePrice = Math.round(spotPrice / 50) * 50;
    
    // Construct a standard instrument string structure
    const tradingSymbolString = `NIFTY26JUN${strikePrice}${optionType}`; 
    
    // Notice: Derivative options are placed under the "NFO" exchange category parameter mapping instead of standard stock "NSE"
    const params = {
      variety: "NORMAL",
      tradingsymbol: tradingSymbolString,
      symboltoken: "1", // MConnect allows "1" for dynamic derivatives market sweeps when string token is specified
      exchange: "NFO", 
      transactiontype: "BUY", // Both CE and PE strategies require BUYING the respective contract option
      ordertype: "MARKET",
      quantity: String(quantity),
      producttype: "INTRADAY",
      duration: "DAY"
    };
  
    console.log(`[mStock Option Bot] Breakout Detected! Buying contract: ${tradingSymbolString} | Lots: ${quantity}`);
    const client = await getMConnectClient();
    if (typeof (client as any).placeOrder === 'function') {
       return await (client as any).placeOrder(params);
    }
  }

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

  if (isAIStudio) {
    app.listen(serverPort, '0.0.0.0', () => {
      console.log(`[SYSTEM] Server successfully running on port ${serverPort}.`);
    });
  } else {
    app.listen(serverPort, () => {
      console.log(`[SYSTEM] Server successfully running on port ${serverPort}.`);
    });
  }
}

startServer();
