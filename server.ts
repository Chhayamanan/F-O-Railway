import "dotenv/config";
import express from "express";
import path from "path";
import crypto from "crypto";

async function startServer() {
  const app = express();
  
  const isAIStudio = !!process.env.APPLET_ID;
  const serverPort = (process.env.PORT && !isAIStudio) ? Number(process.env.PORT) : 3000;
  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // STEP 1: Login to get refresh token
  app.post("/api/mstock/login", async (req, res) => {
    try {
      const { clientcode, password, totp } = req.body;

      if (!clientcode || !password) {
        return res.status(400).json({ error: "Missing clientcode or password" });
      }

      const response = await fetch("https://api.mstock.trade/openapi/typeb/connect/login", {
        method: "POST",
        headers: {
          "X-Mirae-Version": "1",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          clientcode,
          password,
          totp: totp || "",
          state: ""
        })
      });

      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      console.error("[LOGIN ERROR]", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // STEP 2: Generate session (JWT) from OTP and refresh token
  app.post("/api/mstock/session", async (req, res) => {
    try {
      const { clientcode, refreshToken, otp, apiKey } = req.body;
      
      if (!clientcode || !refreshToken || !otp || !apiKey) {
        return res.status(400).json({ error: "Missing required parameters for session generation." });
      }

      const cleanApiKey = apiKey.trim();
      const checksumRaw = clientcode + refreshToken + cleanApiKey;
      const checksum = crypto.createHash('sha256').update(checksumRaw).digest('hex');

      const response = await fetch("https://api.mstock.trade/openapi/typeb/session/token", {
        method: "POST",
        headers: {
          "X-Mirae-Version": "1",
          "X-PrivateKey": cleanApiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          refreshToken,
          otp,
          checksum
        })
      });

      const data = await response.json();
      res.json(data);
    } catch (err: any) {
       console.error("[SESSION ERROR]", err.message);
       res.status(500).json({ error: err.message });
    }
  });

  // STEP 3: Poll OHLC Quote
  app.post("/api/mstock/quote", async (req, res) => {
    try {
      const { apiKey, jwtToken } = req.body;

      if (!apiKey || !jwtToken) {
          return res.status(400).json({ error: "Missing API Key or JWT Token" });
      }

      const cleanJwtToken = jwtToken.replace(/^Bearer\s+/i, "").trim();
      const cleanApiKey = apiKey.trim();

      const response = await fetch("https://api.mstock.trade/openapi/typeb/instruments/quote", {
        method: "POST", // POST instead of GET because fetch blocks bodies in GET requests
        headers: {
          "X-Mirae-Version": "1",
          "Authorization": `Bearer ${cleanJwtToken}`,
          "X-PrivateKey": cleanApiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mode: "OHLC",
          exchangeTokens: { NSE: ["26000"] }
        })
      });

      const data = await response.json();
      
      if (data.status !== "true") {
          console.error(`[MSTOCK API ERROR] ${data.message} (${data.errorcode})`);
          return res.status(response.status !== 200 ? response.status : 400).json({ 
              error: `API Rejected: ${data.message} (${data.errorcode})` 
          });
      }

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
