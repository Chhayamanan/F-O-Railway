import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { DataFetcher } from "./services/dataFetcher";
import { placeOrder } from "./services/mStockService";

async function startServer() {
  const app = express();
  
  const PORT = process.env.PORT || 3000;
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

  app.listen(PORT, () => {
    console.log(`[SYSTEM] Server successfully bound to port ${PORT}.`);
  });
}

startServer();
