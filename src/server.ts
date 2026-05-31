import "dotenv/config";
import express from "express";
import path from "path";

async function startServer() {
  const app = express();
  
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/generate-report", async (req, res) => {
    try {
      const { DataFetcher } = await import("./services/dataFetcher");
      const { filePath, data } = await DataFetcher.generateReport();
      res.json({ success: true, message: "Report generated successfully.", data });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/download-report", (req, res) => {
    const filePath = path.join(process.cwd(), 'Stock_Baseline_Report.xlsx');
    res.download(filePath, 'Stock_Baseline_Report.xlsx');
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
