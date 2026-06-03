import "dotenv/config";
import express from "express";
import path from "path";

async function startServer() {
  const app = express();
  
  const isAIStudio = !!process.env.APPLET_ID;
  const serverPort = (process.env.PORT && !isAIStudio) ? Number(process.env.PORT) : 3000;
  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/nifty/quote", async (req, res) => {
    try {
      const apiKey = req.body.apiKey || process.env.MSTOCK_API_KEY;
      const jwtToken = req.body.jwtToken || process.env.MSTOCK_JWT_TOKEN;

      if (!apiKey || !jwtToken) {
          return res.status(400).json({ error: "Missing API Key or JWT Token" });
      }

      const response = await fetch("https://api.mstock.trade/openapi/typeb/instruments/quote", {
        method: "POST", // Needs to be POST to send the exchangeTokens body
        headers: {
          "X-Mirae-Version": "1",
          "Authorization": `Bearer ${jwtToken}`,
          "X-PrivateKey": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mode: "OHLC",
          exchangeTokens: { NSE: ["26000"] }
        })
      });

      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      console.error("[QUOTE ERROR]", err.message);
      res.status(500).json({ error: err.message });
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
