import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { DataFetcher } from "./services/dataFetcher";
import { placeOrder, getMConnectClient } from "./services/mStockService";

async function startServer() {
  const app = express();
  
  const isAIStudio = !!process.env.APPLET_ID;
  const serverPort = (process.env.PORT && !isAIStudio) ? Number(process.env.PORT) : 3000;
  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/stocks/check-breakout", async (req, res) => {
    try {
      const status = await DataFetcher.checkStocksPriceBreakout();
      res.json({ success: true, executedAction: status.executedAction, data: status.data });
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
      
      const status = await DataFetcher.fetchNiftyBreakoutStatus(targetQuantity);
  
      if (status.orderParams) {
          const client = await getMConnectClient();
          if (typeof (client as any).placeOrder === 'function') {
             await (client as any).placeOrder(status.orderParams);
          }
      }
  
      res.json({
        success: true,
        executedTrade: status.executedTrade,
        metrics: status.metrics
      });
  
    } catch (err: any) {
      console.error("[NIFTY BOT ERROR]", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
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
