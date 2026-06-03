"use strict";

/**
 * mStock Nifty Breakout Trading Bot (Node.js)
 * ============================================
 * Strategy:
 *   - Track Nifty 50 day High & Low via OHLC API
 *   - Price breaks above Day High → Buy CALL (CE)
 *   - Price breaks below Day Low  → Buy PUT  (PE)
 */

const https = require("https");
const http  = require("http");
const { authenticator } = require("otplib");  // npm install otplib

// ─────────────────────────────────────────────
// CONFIGURATION — fill before running
// ─────────────────────────────────────────────
const CONFIG = {
  clientCode:      "YOUR_CLIENT_CODE",   // e.g. "MA12345"
  password:        "YOUR_PASSWORD",
  apiKey:          "YOUR_API_KEY",       // from trade.mstock.com
  totpSecret:      "YOUR_TOTP_SECRET",   // base32 secret; set "" to use OTP SMS

  niftyToken:      "26000",              // Nifty 50 index token on NSE
  niftyExchange:   "NSE",

  optionExchange:  "NFO",
  optionLotSize:   25,                   // 1 lot = 25 qty
  optionLots:      1,
  optionProduct:   "CARRYFORWARD",
  strikeOffset:    100,                  // round to nearest 100

  pollIntervalMs:  30_000,              // 30 seconds
  marketOpenH:     9,  marketOpenM:  15,
  marketCloseH:   15,  marketCloseM: 30,
};

const BASE = "https://api.mstock.trade/openapi/typeb";

// ─────────────────────────────────────────────
// SESSION STATE
// ─────────────────────────────────────────────
let jwtToken      = "";
let orderPlaced   = "";   // "CALL" | "PUT" | ""
let scripMaster   = null;
let dayHigh       = null;
let dayLow        = null;

// ─────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────
const fs = require("fs");
const logFile = fs.createWriteStream("nifty_trader.log", { flags: "a" });

function log(level, msg) {
  const line = `${new Date().toISOString()}  ${level.padEnd(7)}  ${msg}`;
  console.log(line);
  logFile.write(line + "\n");
}
const info  = (m) => log("INFO",  m);
const warn  = (m) => log("WARN",  m);
const error = (m) => log("ERROR", m);

// ─────────────────────────────────────────────
// HTTP HELPER
// ─────────────────────────────────────────────
function apiCall(method, path, body = null, auth = true) {
  return new Promise((resolve, reject) => {
    const url    = new URL(BASE + path);
    const isHttps = url.protocol === "https:";
    const lib    = isHttps ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;

    const headers = {
      "X-Mirae-Version": "1",
      "X-PrivateKey":    CONFIG.apiKey,
      "Content-Type":    "application/json",
    };
    if (auth) headers["Authorization"] = `Bearer ${jwtToken}`;
    if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr);

    const req = lib.request(
      { hostname: url.hostname, path: url.pathname + url.search,
        method, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error(`Non-JSON response: ${data.slice(0, 200)}`)); }
        });
      }
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─────────────────────────────────────────────
// STEP 1 — LOGIN
// ─────────────────────────────────────────────
async function login() {
  info("Logging in as " + CONFIG.clientCode + " ...");
  const totpVal = CONFIG.totpSecret
    ? authenticator.generate(CONFIG.totpSecret)
    : "";
  if (totpVal) info("TOTP generated: " + totpVal);

  const data = await apiCall("POST", "/connect/login", {
    clientcode: CONFIG.clientCode,
    password:   CONFIG.password,
    totp:       totpVal,
    state:      "",
  }, false);

  if (String(data.status).toLowerCase() !== "true") {
    throw new Error("Login failed: " + data.message);
  }
  info("Login OK — " + data.message);
  return data.data.jwtToken;   // this is the refreshToken for step 2
}

// ─────────────────────────────────────────────
// STEP 2A — SESSION WITH OTP
// ─────────────────────────────────────────────
async function generateSessionOtp(refreshToken, otp) {
  info("Generating session with OTP ...");
  const data = await apiCall("POST", "/session/token",
    { refreshToken, otp }, false);
  if (String(data.status).toLowerCase() !== "true") {
    throw new Error("Session/OTP failed: " + data.message);
  }
  return data.data.jwtToken;
}

// ─────────────────────────────────────────────
// STEP 2B — SESSION WITH TOTP
// ─────────────────────────────────────────────
async function generateSessionTotp(refreshToken) {
  const totp = authenticator.generate(CONFIG.totpSecret);
  info("Verifying TOTP session ...");
  const data = await apiCall("POST", "/session/verifytotp",
    { refreshToken, totp }, false);
  if (!data.status) throw new Error("VerifyTOTP failed: " + data.message);
  return data.data.jwtToken;
}

// ─────────────────────────────────────────────
// FULL LOGIN FLOW
// ─────────────────────────────────────────────
async function doLogin() {
  const refreshToken = await login();

  if (CONFIG.totpSecret) {
    jwtToken = await generateSessionTotp(refreshToken);
  } else {
    const otp = await promptUser("Enter OTP received on mobile/email: ");
    jwtToken = await generateSessionOtp(refreshToken, otp.trim());
  }
  info("Session established.");
}

// ─────────────────────────────────────────────
// PROMPT HELPER (for OTP fallback)
// ─────────────────────────────────────────────
function promptUser(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    let answer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.once("data", (d) => {
      process.stdin.pause();
      resolve(d.toString().trim());
    });
  });
}

// ─────────────────────────────────────────────
// NIFTY OHLC
// ─────────────────────────────────────────────
async function getNiftyOhlc() {
  const data = await apiCall("GET", "/instruments/quote", {
    mode: "OHLC",
    exchangeTokens: { [CONFIG.niftyExchange]: [CONFIG.niftyToken] },
  });
  if (String(data.status).toLowerCase() !== "true") {
    throw new Error("OHLC error: " + data.message);
  }
  const fetched = data.data.fetched;
  if (!fetched || fetched.length === 0) {
    throw new Error("OHLC: empty fetched list — check Nifty token");
  }
  return fetched[0];
}

// ─────────────────────────────────────────────
// SCRIP MASTER
// ─────────────────────────────────────────────
async function getScripMaster() {
  if (scripMaster) return scripMaster;
  info("Downloading ScripMaster ...");
  const data = await apiCall("GET", "/instruments/OpenAPIScripMaster");
  if (!Array.isArray(data)) throw new Error("ScripMaster: unexpected format");
  scripMaster = data;
  info(`ScripMaster loaded: ${scripMaster.length} instruments`);
  return scripMaster;
}

async function findNiftyOption(optionType, spot) {
  const strike = Math.round(spot / CONFIG.strikeOffset) * CONFIG.strikeOffset;
  const instruments = await getScripMaster();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const candidates = [];
  for (const inst of instruments) {
    if (
      inst.exch_seg === "NFO" &&
      inst.instrumenttype === "OPTIDX" &&
      inst.name && inst.name.toUpperCase().includes("NIFTY") &&
      inst.symbol && inst.symbol.toUpperCase() === optionType
    ) {
      const expDate = new Date(inst.expiry);   // e.g. "23Oct2025"
      if (isNaN(expDate) || expDate < today) continue;
      const instStrike = parseFloat(inst.strike || 0);
      candidates.push({ diff: Math.abs(instStrike - strike), expDate, inst });
    }
  }

  if (candidates.length === 0) {
    throw new Error(`No ${optionType} option found near strike ${strike}`);
  }

  candidates.sort((a, b) => a.diff - b.diff || a.expDate - b.expDate);
  const best = candidates[0].inst;
  info(`Selected: ${best.name} | strike=${best.strike} | expiry=${best.expiry} | token=${best.token}`);
  return best;
}

// ─────────────────────────────────────────────
// ORDER PLACEMENT
// ─────────────────────────────────────────────
async function placeOrder(instrument, optionType) {
  const qty = CONFIG.optionLotSize * CONFIG.optionLots;
  info(`Placing ${optionType} order: ${instrument.name} x${qty} ...`);

  const data = await apiCall("POST", "/orders/regular", {
    variety:           "NORMAL",
    tradingsymbol:     instrument.name,
    symboltoken:       instrument.token,
    exchange:          CONFIG.optionExchange,
    transactiontype:   "BUY",
    ordertype:         "MARKET",
    quantity:          String(qty),
    producttype:       CONFIG.optionProduct,
    price:             "0",
    triggerprice:      "0",
    squareoff:         "0",
    stoploss:          "0",
    trailingStopLoss:  "",
    disclosedquantity: "",
    duration:          "DAY",
    ordertag:          `nifty_${optionType.toLowerCase()}`,
  });

  if (String(data.status).toLowerCase() !== "true") {
    throw new Error("Order failed: " + data.message);
  }
  const orderId = data.data.orderid;
  info(`Order placed! Order ID: ${orderId}`);
  return orderId;
}

// ─────────────────────────────────────────────
// MARKET HOURS CHECK
// ─────────────────────────────────────────────
function isMarketOpen() {
  const now = new Date();
  const day = now.getDay();           // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const h = now.getHours(), m = now.getMinutes();
  const open  = h * 60 + m >= CONFIG.marketOpenH  * 60 + CONFIG.marketOpenM;
  const close = h * 60 + m <= CONFIG.marketCloseH * 60 + CONFIG.marketCloseM;
  return open && close;
}

// ─────────────────────────────────────────────
// MAIN TRADING LOOP
// ─────────────────────────────────────────────
async function tradingLoop() {
  info("=".repeat(55));
  info("  mStock Nifty Breakout Bot  started");
  info(`  Poll interval : ${CONFIG.pollIntervalMs / 1000}s`);
  info("=".repeat(55));

  while (true) {
    try {
      if (!isMarketOpen()) {
        const t = new Date().toTimeString().slice(0, 8);
        info(`[${t}] Market closed — waiting 60s ...`);
        // Reset state after close
        const now = new Date();
        const afterClose = now.getHours() * 60 + now.getMinutes() >
                           CONFIG.marketCloseH * 60 + CONFIG.marketCloseM;
        if (afterClose) {
          orderPlaced = "";
          dayHigh = null;
          dayLow  = null;
        }
        await sleep(60_000);
        continue;
      }

      // ── Fetch OHLC ─────────────────────────────────
      const ohlc = await getNiftyOhlc();
      const ltp  = parseFloat(ohlc.ltp);
      const high = parseFloat(ohlc.high);
      const low  = parseFloat(ohlc.low);

      if (dayHigh === null) {
        dayHigh = high;
        dayLow  = low;
        info(`Day levels set → High: ${dayHigh.toFixed(2)}  Low: ${dayLow.toFixed(2)}`);
      }

      dayHigh = Math.max(dayHigh, high);
      dayLow  = Math.min(dayLow,  low);

      info(
        `LTP: ${ltp.toFixed(2)}  |  ` +
        `Day High: ${dayHigh.toFixed(2)}  |  ` +
        `Day Low: ${dayLow.toFixed(2)}  |  ` +
        `Order: ${orderPlaced || "None"}`
      );

      // ── Breakout Logic ──────────────────────────────
      if (ltp > dayHigh && orderPlaced !== "CALL") {
        info("BREAKOUT ABOVE DAY HIGH! Buying CALL ...");
        const inst = await findNiftyOption("CE", ltp);
        await placeOrder(inst, "CALL");
        orderPlaced = "CALL";
      } else if (ltp < dayLow && orderPlaced !== "PUT") {
        info("BREAKDOWN BELOW DAY LOW! Buying PUT ...");
        const inst = await findNiftyOption("PE", ltp);
        await placeOrder(inst, "PUT");
        orderPlaced = "PUT";
      }

    } catch (err) {
      error("Error: " + err.message);
      if (/Invalid request|suspended|expired/i.test(err.message)) {
        warn("Session may have expired — re-logging in ...");
        try { await doLogin(); } catch (e) { error("Re-login failed: " + e.message); }
      }
    }

    await sleep(CONFIG.pollIntervalMs);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────
(async () => {
  // AI Studio runs apps detached, so we'll serve a simple HTTP page so the endpoint stays alive
  // and user can grab the code from the export settings if they want.
  const app = require('http').createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <body style="font-family: monospace; padding: 2rem; background: #111; color: #eee;">
          <h2 style="color: #60a5fa;">Node.js mStock Breakout Trading Bot Active</h2>
          <p>Bot is running in the background. Check <code>nifty_trader.log</code> for output.</p>
          <p>Export this code from Settings to run locally.</p>
        </body>
      </html>
    `);
  });
  app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log("Status server listening on port " + (process.env.PORT || 3000));
  });

  try {
    await doLogin();

    // Optional: show available balance
    try {
      const funds = await apiCall("GET", "/user/fundsummary");
      if (funds.status === true || funds.status === "true") {
        const bal = funds.data[0].AVAILABLE_BALANCE;
        info(`Available balance: Rs. ${bal}`);
      }
    } catch (e) {
      warn("Could not fetch fund summary: " + e.message);
    }

    await tradingLoop();
  } catch (e) {
    error("Fatal: " + e.message);
  }
})();
