"use strict";

/**
 * mStock Indices Breakout Trading Bot + Live Dashboard
 * ===================================================
 * - Trades: login → track OHLC for Nifty, BankNifty, Sensex → buy CE/PE on breakout
 * - Dashboard: HTTP server on PORT showing live tickers
 */

const https   = require("https");
const http    = require("http");
const fs      = require("fs");
const { authenticator } = require("otplib");
const YahooFinance = require("yahoo-finance2").default;
const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical'] });

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────
const CONFIG = {
  clientCode:     "MA2468211",
  password:       "Chh@ya001",
  apiKey:         "pznEP6Gnv3kRsradk+fCeAw3/Q4Fx2quQg3hEl4q2BA=",
  totpSecret:     "I2QG4TGM6HZ5ZGG23OED33A3HZSS3J2B",   // set "" to use OTP SMS

  pollIntervalMs: 30_000,
  marketOpenH:  9,  marketOpenM:  15,
  marketCloseH: 15, marketCloseM: 30,

  dashPort: process.env.PORT || 3000,
  
  indices: {
    NIFTY: {
      token: "26000",
      exchange: "NSE",
      optExchange: "NFO",
      strikeOffset: 50,
      lotSize: 25,
      lots: 1
    },
    BANKNIFTY: {
      token: "26009",
      exchange: "NSE",
      optExchange: "NFO",
      strikeOffset: 100,
      lotSize: 15,
      lots: 1
    },
    SENSEX: {
      token: "1", // SENSEX BSE Token might be "1" or "999901" depending on broker mappings
      exchange: "BSE",
      optExchange: "BFO",
      strikeOffset: 100,
      lotSize: 10,
      lots: 1
    }
  }
};

const BASE = "https://api.mstock.trade/openapi/typeb";

// ─────────────────────────────────────────────
// STATE  (shared between trading loop + dashboard)
// ─────────────────────────────────────────────
let jwtToken    = "";
let scripMaster = null;

const state = {
  lastUpdate: null,
  logs: [],
  balance: null,
  marketOpen: false,
  indices: {
    NIFTY:     { ltp: null, open: null, high: null, low: null, close: null, chgAbs: null, chgPct: null, dayHigh: null, dayLow: null, signal: "watching", orderPlaced: "" },
    BANKNIFTY: { ltp: null, open: null, high: null, low: null, close: null, chgAbs: null, chgPct: null, dayHigh: null, dayLow: null, signal: "watching", orderPlaced: "" },
    SENSEX:    { ltp: null, open: null, high: null, low: null, close: null, chgAbs: null, chgPct: null, dayHigh: null, dayLow: null, signal: "watching", orderPlaced: "" },
  }
};

// ─────────────────────────────────────────────
// TIME HELPER (IST)
// ─────────────────────────────────────────────
function getISTDate() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

// ─────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────
const logFile = fs.createWriteStream("nifty_trader.log", { flags: "a" });

function log(level, msg) {
  const dt = getISTDate();
  const pad = n => n.toString().padStart(2, '0');
  const dateStr = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;

  const line = `${dateStr}  ${level.padEnd(7)}  ${msg}`;
  console.log(line);
  logFile.write(line + "\n");
  state.logs.unshift({ t: `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`, level, msg });
  if (state.logs.length > 100) state.logs.pop();
}
const info  = (m) => log("INFO",  m);
const warn  = (m) => log("WARN",  m);
const error = (m) => log("ERROR", m);

// ─────────────────────────────────────────────
// HTTP HELPER (mStock API)
// ─────────────────────────────────────────────
function apiCall(method, path, body = null, auth = true) {
  return new Promise((resolve, reject) => {
    const url     = new URL(BASE + path);
    const lib     = url.protocol === "https:" ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = {
      "X-Mirae-Version": "1",
      "X-PrivateKey":    CONFIG.apiKey,
      "Content-Type":    "application/json",
    };
    if (auth)    headers["Authorization"]  = `Bearer ${jwtToken}`;
    if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr);

    const req = lib.request(
      { hostname: url.hostname, path: url.pathname + url.search, method, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error(`Non-JSON: ${data.slice(0, 200)}`)); }
        });
      }
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────
async function login() {
  info("Logging in as " + CONFIG.clientCode + " ...");
  const totpVal = CONFIG.totpSecret ? authenticator.generate(CONFIG.totpSecret) : "";
  const data = await apiCall("POST", "/connect/login",
    { clientcode: CONFIG.clientCode, password: CONFIG.password, totp: totpVal, state: "" }, false);
  if (String(data.status).toLowerCase() !== "true")
    throw new Error("Login failed: " + data.message);
  info("Login OK");
  return data.data.jwtToken;
}

async function generateSessionOtp(refreshToken, otp) {
  const data = await apiCall("POST", "/session/token", { refreshToken, otp }, false);
  if (String(data.status).toLowerCase() !== "true")
    throw new Error("OTP session failed: " + data.message);
  return data.data.jwtToken;
}

async function generateSessionTotp(refreshToken) {
  const totp = authenticator.generate(CONFIG.totpSecret);
  const data = await apiCall("POST", "/session/verifytotp", { refreshToken, totp }, false);
  if (!data.status) throw new Error("TOTP verify failed: " + data.message);
  return data.data.jwtToken;
}

async function doLogin() {
  const refreshToken = await login();
  if (CONFIG.totpSecret) {
    jwtToken = await generateSessionTotp(refreshToken);
  } else {
    const otp = await promptUser("Enter OTP: ");
    jwtToken  = await generateSessionOtp(refreshToken, otp.trim());
  }
  info("Session established.");
}

function promptUser(q) {
  return new Promise((resolve) => {
    process.stdout.write(q);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.once("data", (d) => { process.stdin.pause(); resolve(d.toString().trim()); });
  });
}

// ─────────────────────────────────────────────
// FETCH OHLC
// ─────────────────────────────────────────────
async function getIndicesOhlc() {
  const exchangeTokens = {};
  for (const [key, cfg] of Object.entries(CONFIG.indices)) {
    if (!exchangeTokens[cfg.exchange]) exchangeTokens[cfg.exchange] = [];
    exchangeTokens[cfg.exchange].push(cfg.token);
  }
  
  const data = await apiCall("GET", "/instruments/quote", {
    mode: "OHLC",
    exchangeTokens,
  });
  if (String(data.status).toLowerCase() !== "true")
    throw new Error("OHLC error: " + data.message);
  const fetched = data.data.fetched;
  if (!fetched || !fetched.length) throw new Error("OHLC: empty fetched");
  return fetched;
}

// ─────────────────────────────────────────────
// SCRIP MASTER + OPTION LOOKUP
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

async function findOption(indexKey, optionType, spot) {
  const cfg = CONFIG.indices[indexKey];
  const strike = Math.round(spot / cfg.strikeOffset) * cfg.strikeOffset;
  const instruments = await getScripMaster();
  const today = getISTDate(); today.setHours(0, 0, 0, 0);
  const candidates = [];
  
  for (const inst of instruments) {
    if (inst.exch_seg === cfg.optExchange && inst.instrumenttype === "OPTIDX" &&
        inst.name && inst.name.toUpperCase().includes(indexKey) &&
        inst.symbol && inst.symbol.toUpperCase() === optionType) {
      const expDate = new Date(inst.expiry);
      if (isNaN(expDate) || expDate < today) continue;
      candidates.push({ diff: Math.abs(parseFloat(inst.strike || 0) - strike), expDate, inst });
    }
  }
  if (!candidates.length) throw new Error(`No ${optionType} option near strike ${strike} for ${indexKey}`);
  candidates.sort((a, b) => a.diff - b.diff || a.expDate - b.expDate);
  const best = candidates[0].inst;
  info(`Selected ${indexKey}: ${best.name} | strike=${best.strike} | expiry=${best.expiry}`);
  return best;
}

// ─────────────────────────────────────────────
// ORDER
// ─────────────────────────────────────────────
async function placeOrder(indexKey, instrument, optionType) {
  const cfg = CONFIG.indices[indexKey];
  const qty = cfg.lotSize * cfg.lots;
  info(`Placing ${optionType} order for ${indexKey}: ${instrument.name} x${qty}`);
  const data = await apiCall("POST", "/orders/regular", {
    variety: "NORMAL", tradingsymbol: instrument.name, symboltoken: instrument.token,
    exchange: cfg.optExchange, transactiontype: "BUY", ordertype: "MARKET",
    quantity: String(qty), producttype: "CARRYFORWARD",
    price: "0", triggerprice: "0", squareoff: "0", stoploss: "0",
    trailingStopLoss: "", disclosedquantity: "", duration: "DAY",
    ordertag: `${indexKey.toLowerCase()}_${optionType.toLowerCase()}`,
  });
  if (String(data.status).toLowerCase() !== "true")
    throw new Error(`${indexKey} Order failed: ` + data.message);
  info(`${indexKey} Order placed! ID: ${data.data.orderid}`);
  return data.data.orderid;
}

// ─────────────────────────────────────────────
// MARKET HOURS
// ─────────────────────────────────────────────
function isMarketOpen() {
  const now = getISTDate();
  if (now.getDay() === 0 || now.getDay() === 6) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  return m >= CONFIG.marketOpenH * 60 + CONFIG.marketOpenM &&
         m <= CONFIG.marketCloseH * 60 + CONFIG.marketCloseM;
}

// ─────────────────────────────────────────────
// TRADING LOOP
// ─────────────────────────────────────────────
async function tradingLoop() {
  info("=".repeat(55));
  info("  mStock Breakout Bot started (Nifty, BankNifty, Sensex)");
  info(`  Dashboard: http://localhost:${CONFIG.dashPort}`);
  info("=".repeat(55));

  while (true) {
    try {
      if (!isMarketOpen()) {
        const now = getISTDate();
        const afterClose = now.getHours() * 60 + now.getMinutes() >
                           CONFIG.marketCloseH * 60 + CONFIG.marketCloseM;
        if (afterClose) { 
          // Reset all indices state
          for (const key of Object.keys(state.indices)) {
            state.indices[key].orderPlaced = "";
            state.indices[key].dayHigh = null;
            state.indices[key].dayLow = null;
            state.indices[key].signal = "watching";
          }
        }
        state.marketOpen = false;
        await sleep(60_000);
        continue;
      }
      
      state.marketOpen = true;
      const fetchedOhlc = await getIndicesOhlc();

      for (const [indexKey, cfg] of Object.entries(CONFIG.indices)) {
        // Find matching OHLC data
        const ohlc = fetchedOhlc.find(item => item.token === cfg.token);
        if (!ohlc) continue;

        const ltp  = parseFloat(ohlc.ltp);
        const high = parseFloat(ohlc.high);
        const low  = parseFloat(ohlc.low);
        const cls  = parseFloat(ohlc.close);
        
        let indState = state.indices[indexKey];

        // 1. Check breakout against the High/Low from the PAST 30-second refresh
        if (indState.dayHigh !== null && indState.dayLow !== null) {
          if (ltp > indState.dayHigh && indState.orderPlaced !== "CALL") {
            info(`[${indexKey}] BREAKOUT: LTP (${ltp.toFixed(2)}) broke past 30s High (${indState.dayHigh.toFixed(2)}) — Buying CALL`);
            const inst = await findOption(indexKey, "CE", ltp);
            await placeOrder(indexKey, inst, "CALL");
            indState.orderPlaced = "CALL"; indState.signal = "CALL";
          } else if (ltp < indState.dayLow && indState.orderPlaced !== "PUT") {
            info(`[${indexKey}] BREAKDOWN: LTP (${ltp.toFixed(2)}) broke past 30s Low (${indState.dayLow.toFixed(2)}) — Buying PUT`);
            const inst = await findOption(indexKey, "PE", ltp);
            await placeOrder(indexKey, inst, "PUT");
            indState.orderPlaced = "PUT"; indState.signal = "PUT";
          } else if (!indState.orderPlaced) {
            indState.signal = "watching";
          }
        }

        // 2. Update current High/Low reference for the next cycle
        if (indState.dayHigh === null) { 
          indState.dayHigh = high; 
          indState.dayLow = low; 
        } else {
          indState.dayHigh = Math.max(indState.dayHigh, high);
          indState.dayLow  = Math.min(indState.dayLow,  low);
        }

        // 3. update shared state for dashboard
        Object.assign(indState, {
          ltp, open: parseFloat(ohlc.open), high, low, close: cls,
          chgAbs: ltp - cls, chgPct: ((ltp - cls) / cls) * 100,
        });
      }
      
      state.lastUpdate = getISTDate().toLocaleTimeString("en-US", { hour12: false });

    } catch (err) {
      error("Error: " + err.message);
      if (/Invalid request|suspended|expired/i.test(err.message)) {
        warn("Re-logging in ...");
        try { await doLogin(); } catch (e) { error("Re-login failed: " + e.message); }
      }
    }
    await sleep(CONFIG.pollIntervalMs);
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─────────────────────────────────────────────
// DASHBOARD HTML
// ─────────────────────────────────────────────
function dashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Breakout Bot Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f0f;color:#e0e0e0;min-height:100vh}
  header{background:#161616;border-bottom:1px solid #2a2a2a;padding:14px 24px;display:flex;align-items:center;justify-content:space-between}
  header h1{font-size:16px;font-weight:600;color:#fff;letter-spacing:-0.02em}
  .dot{width:8px;height:8px;border-radius:50%;background:#4ade80;display:inline-block;margin-right:6px;animation:pulse 1.5s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
  .status{font-size:12px;color:#888}
  
  .indices-wrapper { display: flex; flex-direction: column; gap: 20px; padding: 20px 24px; }
  
  .index-panel { background:#161616; border:1px solid #2a2a2a; border-radius:12px; padding: 20px; }
  .panel-header { font-size: 18px; font-weight: 600; color: #fff; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
  
  .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;}
  @media(max-width:1000px){.grid{grid-template-columns:repeat(3,1fr)}}
  @media(max-width:600px){.grid{grid-template-columns:1fr}}
  
  .card{background:#111; border:1px solid #222; border-radius:8px; padding:16px}
  .card-label{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px}
  .card-value{font-size:22px;font-weight:600;letter-spacing:-0.03em;color:#fff}
  .card-sub{font-size:12px;margin-top:4px;color:#888}
  
  .up{color:#4ade80}.down{color:#f87171}.neutral{color:#888}
  
  .bar-section{margin-top: 16px; padding: 12px 16px; background:#111; border-radius:8px; border:1px solid #222}
  .bar-labels{display:flex;justify-content:space-between;font-size:12px;color:#666;margin-bottom:8px}
  .bar-track{position:relative;height:8px;background:#1e1e1e;border-radius:99px;overflow:visible}
  .bar-low{position:absolute;left:0;top:0;height:100%;background:#f87171;border-radius:99px 0 0 99px;transition:width .5s}
  .bar-high{position:absolute;right:0;top:0;height:100%;background:#4ade80;border-radius:0 99px 99px 0;transition:width .5s}
  .needle{position:absolute;top:-4px;width:3px;height:16px;background:#fff;border-radius:2px;transform:translateX(-50%);transition:left .5s}
  
  .signal{margin-top: 16px; padding:12px 16px; border-radius:8px; display:flex; align-items:center; gap:12px; font-size:13px; font-weight:500; border:1px solid}
  .sig-watch{background:#1a1a1a;border-color:#2a2a2a;color:#888}
  .sig-call{background:#052e16;border-color:#166534;color:#4ade80}
  .sig-put{background:#2d0a0a;border-color:#7f1d1d;color:#f87171}
  .badge{font-size:11px;padding:3px 10px;border-radius:99px;font-weight:600;margin-left:auto}
  .badge-watch{background:#2a2a2a;color:#666}
  .badge-call{background:#166534;color:#4ade80}
  .badge-put{background:#7f1d1d;color:#f87171}
  
  .log-section{margin:0 24px 24px}
  .log-title{font-size:11px;color:#555;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px; display:flex; justify-content:space-between}
  .log-box{background:#0a0a0a;border:1px solid #1e1e1e;border-radius:8px;padding:12px;height:250px;overflow-y:auto;font-family:'SF Mono','Fira Code',monospace;font-size:12px}
  .log-entry{padding:2px 0;border-bottom:1px solid #141414;display:flex;gap:8px}
  .log-t{color:#444;min-width:70px}
  .log-INFO{color:#60a5fa}.log-WARN{color:#fbbf24}.log-ERROR{color:#f87171}
  .footer{padding:10px 24px;font-size:11px;color:#444;display:flex;justify-content:space-between}
  
  /* Tabs & Charts */
  .tabs{display:flex; gap:16px; margin: 0 24px; border-bottom:1px solid #2a2a2a;}
  .tab{padding:12px 16px; cursor:pointer; font-weight:600; color:#888; border-bottom:2px solid transparent;}
  .tab.active{color:#fff; border-bottom-color:#4ade80;}
  .tab-content{display:none;}
  .tab-content.active{display:block;}
  .chart-grid{display:grid; grid-template-columns:1fr 1fr; gap:20px; padding:20px 24px;}
  @media(max-width:1000px){.chart-grid{grid-template-columns:1fr;}}
  .chart-card{background:#161616; border:1px solid #2a2a2a; border-radius:12px; padding:0; overflow:hidden;}
</style>
</head>
<body>
<header>
  <h1><span class="dot"></span>Multi-Index Breakout Bot</h1>
  <span class="status" id="mkt-status">Loading…</span>
</header>

<div class="tabs">
  <div class="tab active" onclick="switchTab('bot')">Live Bot</div>
  <div class="tab" onclick="switchTab('charts')">10-Yr S/R Analysis</div>
</div>

<div id="tab-bot" class="tab-content active">
  <div class="indices-wrapper" id="indices-container">
    <!-- Rendered via JS -->
  </div>

  <div class="log-section">
    <div class="log-title">
      <span>Bot Log (Cross-Index)</span>
      <span id="d-balance">Balance: -</span>
    </div>
    <div class="log-box" id="log-box"></div>
  </div>
</div>

<div id="tab-charts" class="tab-content">
  <div style="padding: 20px 24px; color:#aaa; font-size:13px; line-height: 1.5;">
     <strong>Python Strategy Integration:</strong> Processing 10-year Yahoo Finance optimization matrices for Top 4 Volume Distribution Blocks to compute Support & Resistance zones.
  </div>
  <div class="chart-grid" id="charts-container">
     <div style="color:#666;">Select the tab to load. First load fetches & analyzes 10 years of data.</div>
  </div>
</div>

<div class="footer">
  <span>Auto-refreshes periodically</span>
  <span id="last-upd">—</span>
</div>

<template id="index-template">
  <div class="index-panel">
    <div class="panel-header">
      <span class="idx-name">NAME</span>
    </div>
    <div class="grid">
      <div class="card">
        <div class="card-label">Current LTP</div>
        <div class="card-value idx-ltp">—</div>
        <div class="card-sub idx-ltp-chg">—</div>
      </div>
      <div class="card">
        <div class="card-label">Past 30s High</div>
        <div class="card-value up idx-high">—</div>
        <div class="card-sub idx-high-gap">—</div>
      </div>
      <div class="card">
        <div class="card-label">Past 30s Low</div>
        <div class="card-value down idx-low">—</div>
        <div class="card-sub idx-low-gap">—</div>
      </div>
      <div class="card">
        <div class="card-label">Session Open</div>
        <div class="card-value idx-open">—</div>
      </div>
      <div class="card">
        <div class="card-label">Order Status</div>
        <div class="card-value idx-order">—</div>
      </div>
    </div>

    <div class="bar-section">
      <div class="bar-labels">
        <span class="idx-bl-low">Low: —</span>
        <span style="color:#555">range visualizer</span>
        <span class="idx-bl-high">High: —</span>
      </div>
      <div class="bar-track">
        <div class="bar-low idx-bar-l" style="width:40%"></div>
        <div class="bar-high idx-bar-h" style="width:40%"></div>
        <div class="needle idx-needle" style="left:50%"></div>
      </div>
    </div>

    <div class="signal sig-watch idx-signal-box">
      <span class="idx-sig-txt">Waiting for breakout…</span>
      <span class="badge badge-watch idx-sig-badge">Watching</span>
    </div>
  </div>
</template>

<script src="https://cdn.plot.ly/plotly-2.24.1.min.js"></script>
<script>
const fmt = n => Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const pct  = n => (n>=0?'+':'')+n.toFixed(2)+'%';

const container = document.getElementById('indices-container');
const tmpl = document.getElementById('index-template').content;
const uiNodes = {};

// Create nodes for each index exactly once
['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach(key => {
  const clone = document.importNode(tmpl, true);
  clone.querySelector('.idx-name').textContent = key;
  uiNodes[key] = {
    root: clone.querySelector('.index-panel'),
    ltp: clone.querySelector('.idx-ltp'),
    ltpchg: clone.querySelector('.idx-ltp-chg'),
    high: clone.querySelector('.idx-high'),
    low: clone.querySelector('.idx-low'),
    highgap: clone.querySelector('.idx-high-gap'),
    lowgap: clone.querySelector('.idx-low-gap'),
    open: clone.querySelector('.idx-open'),
    order: clone.querySelector('.idx-order'),
    bllow: clone.querySelector('.idx-bl-low'),
    blhigh: clone.querySelector('.idx-bl-high'),
    barl: clone.querySelector('.idx-bar-l'),
    barh: clone.querySelector('.idx-bar-h'),
    needle: clone.querySelector('.idx-needle'),
    sigbox: clone.querySelector('.idx-signal-box'),
    sigtxt: clone.querySelector('.idx-sig-txt'),
    sigbadge: clone.querySelector('.idx-sig-badge'),
  };
  container.appendChild(clone);
});

async function refresh() {
  try {
    const r = await fetch('/api/state');
    const s = await r.json();

    document.getElementById('mkt-status').textContent = s.marketOpen ? 'Market open' : 'Market closed';
    if (s.balance) document.getElementById('d-balance').textContent = 'Balance: Rs. '+fmt(s.balance);

    Object.keys(s.indices).forEach(key => {
      const idx = s.indices[key];
      const ui = uiNodes[key];
      if(!ui || idx.ltp === null) return;

      ui.ltp.textContent = fmt(idx.ltp);
      ui.ltpchg.textContent = (idx.chgAbs>=0?'▲ +':'▼ ')+fmt(Math.abs(idx.chgAbs))+'  ('+pct(idx.chgPct)+')';
      ui.ltpchg.className = 'card-sub '+(idx.chgAbs>=0?'up':'down');

      if (idx.dayHigh) {
        ui.high.textContent = fmt(idx.dayHigh);
        ui.low.textContent = fmt(idx.dayLow);
        ui.highgap.textContent = 'Gap: '+fmt(idx.dayHigh - idx.ltp)+' pts';
        ui.lowgap.textContent = 'Gap: '+fmt(idx.ltp - idx.dayLow)+' pts';
        ui.bllow.textContent = 'Low: '+fmt(idx.dayLow);
        ui.blhigh.textContent = 'High: '+fmt(idx.dayHigh);

        const range = idx.dayHigh - idx.dayLow || 1;
        const pos = Math.min(Math.max((idx.ltp - idx.dayLow) / range, 0), 1);
        ui.barl.style.width = (pos*40).toFixed(1)+'%';
        ui.barh.style.width = ((1-pos)*40).toFixed(1)+'%';
        ui.needle.style.left = (pos*100).toFixed(1)+'%';
      }

      ui.open.textContent = fmt(idx.open);
      ui.order.textContent = idx.orderPlaced || 'None';
      ui.order.className = 'card-value '+(idx.orderPlaced==='CALL'?'up':idx.orderPlaced==='PUT'?'down':'neutral');

      if (idx.signal === 'CALL') {
        ui.sigbox.className='signal sig-call'; ui.sigbadge.className='badge badge-call'; ui.sigbadge.textContent='BUY CALL';
        ui.sigtxt.textContent='Price broke past 30s high — CALL order placed';
      } else if (idx.signal === 'PUT') {
        ui.sigbox.className='signal sig-put'; ui.sigbadge.className='badge badge-put'; ui.sigbadge.textContent='BUY PUT';
        ui.sigtxt.textContent='Price broke past 30s low — PUT order placed';
      } else {
        ui.sigbox.className='signal sig-watch'; ui.sigbadge.className='badge badge-watch'; ui.sigbadge.textContent='Watching';
        ui.sigtxt.textContent='Watching past 30s high/low boundary for breakout…';
      }
    });

    const box = document.getElementById('log-box');
    box.innerHTML = s.logs.map(l =>
      '<div class="log-entry"><span class="log-t">'+l.t+'</span><span class="log-'+l.level+'">'+
      l.level.padEnd(5)+'</span><span>'+l.msg+'</span></div>'
    ).join('');

    document.getElementById('last-upd').textContent = 'Updated ' + (s.lastUpdate || '—');
  } catch(e) { console.error(e); }
}

function switchTab(id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  if(id === 'bot') {
    document.querySelector('.tab:nth-child(1)').classList.add('active');
    document.getElementById('tab-bot').classList.add('active');
  } else {
    document.querySelector('.tab:nth-child(2)').classList.add('active');
    document.getElementById('tab-charts').classList.add('active');
    loadCharts();
  }
}

let chartsLoaded = false;
async function loadCharts() {
  if (chartsLoaded) return;
  const container = document.getElementById('charts-container');
  container.innerHTML = '<div style="color:#888;">Ingesting 10-year data matrix and determining density zones (takes highly dense computation time)...</div>';
  try {
    const r = await fetch('/api/charts');
    const data = await r.json();
    if(data.status==='success') {
      container.innerHTML = '';
      data.charts.forEach((c, idx) => {
        const div = document.createElement('div');
        div.className = 'chart-card';
        div.id = 'plt-' + idx;
        container.appendChild(div);
        
        const shapes = [];
        const colors = ['rgba(255, 234, 167, 0.25)', 'rgba(250, 177, 160, 0.25)', 'rgba(255, 234, 167, 0.25)', 'rgba(223, 230, 233, 0.25)'];
        c.top_bins.forEach((b, i) => {
           shapes.push({
             type: 'rect', xref: 'x', yref: 'y', x0: c.dates[0], x1: c.dates[c.dates.length-1], y0: b.low, y1: b.high,
             fillcolor: colors[i] || colors[3], line: {width:0}, layer: 'below'
           });
        });
        
        shapes.push({
           type: 'rect', xref: 'x', yref: 'y', x0: c.dates[0], x1: c.dates[c.dates.length-1], y0: c.support.low, y1: c.support.high,
           fillcolor: 'rgba(46, 204, 113, 0.15)', line: {color: '#27ae60', width:1}, layer: 'below'
        });
        
        shapes.push({
           type: 'rect', xref: 'x', yref: 'y', x0: c.dates[0], x1: c.dates[c.dates.length-1], y0: c.resistance.low, y1: c.resistance.high,
           fillcolor: 'rgba(231, 76, 60, 0.15)', line: {color: '#c0392b', width:1}, layer: 'below'
        });
      
        const trace = { x: c.dates, y: c.closes, type: 'scatter', mode: 'lines', line: {color:'#3498db', width:1}, name: 'Close Price' };
        const layout = {
           title: '<span style="font-size:14px; font-weight:bold; color:#fff;">' + c.company + ' — 10-Yr S/R Analysis</span><br><span style="font-size:11px; color:#888;">Support: '+c.support.low.toFixed(1)+' - '+c.support.high.toFixed(1)+' | Resistance: '+c.resistance.low.toFixed(1)+' - '+c.resistance.high.toFixed(1)+'</span>',
           paper_bgcolor: '#161616', plot_bgcolor: '#111',
           font: {color: '#e0e0e0', size:11},
           margin: {l: 40, r: 20, t: 50, b: 30},
           shapes: shapes,
           showlegend: false,
           xaxis: { gridcolor: '#222' },
           yaxis: { gridcolor: '#222' }
        };
        Plotly.newPlot(div.id, [trace], layout, {responsive:true});
      });
      chartsLoaded = true;
    } else {
      container.innerHTML = '<div style="color:#e74c3c;">Failed to load charts: '+data.message+'</div>';
    }
  } catch(e) {
    container.innerHTML = '<div style="color:#e74c3c;">Failed to load charts: ' + e + '</div>';
  }
}

refresh();
setInterval(refresh, 100);
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// CHART DATA (PYTHON SCRIPT TRANSLATION)
// ─────────────────────────────────────────────
const CHART_CONFIG = {
  COMPANY_MASTER: {
    "Reliance": "RELIANCE.NS",
    "Infosys": "INFY.NS",
    "TCS": "TCS.NS",
    "TMPV": "TATAMOTORS.NS" // Mapped from TMPV
  },
  INTERVAL_COUNT: 10,
  TOP_N: 4,
  BOX_TRANSPARENCY: 0.35
};

const chartCache = {};
async function getChartDataCached(companyName, ticker) {
  if (chartCache[ticker] && (Date.now() - chartCache[ticker].ts < 12 * 3600 * 1000)) return chartCache[ticker].data;
  
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(endDate.getFullYear() - 10);
  info(`Chart Analysis: Downloading 10-yr data for ${companyName} (${ticker})...`);
  
  const chartRes = await yahooFinance.chart(ticker, { period1: startDate, period2: endDate, interval: '1d' });
  const df = chartRes.quotes;
  if (!df || !df.length) throw new Error("No data returned for " + ticker);
  
  let min = Infinity, max = -Infinity;
  for (let r of df) {
    if (r.low < min) min = r.low; 
    if (r.high > max) max = r.high; 
  }
  
  const step = (max - min) / CHART_CONFIG.INTERVAL_COUNT;
  let bins = Array.from({length: CHART_CONFIG.INTERVAL_COUNT}, (_, i) => ({
    bin: i+1, low: min + i*step, high: min + (i+1)*step, total: 0, up: 0, down: 0
  }));
  
  for (let r of df) {
    let idx = Math.floor(((r.high + r.low) / 2 - min) / step);
    if (idx < 0) idx = 0; if (idx >= CHART_CONFIG.INTERVAL_COUNT) idx = CHART_CONFIG.INTERVAL_COUNT - 1;
    bins[idx].total += r.volume;
    if (r.close > r.open) bins[idx].up += r.volume;
    else if (r.close < r.open) bins[idx].down += r.volume;
  }
  
  bins.forEach(b => b.sentiment = b.up > b.down ? 'Positive' : 'Negative');
  
  let sorted = [...bins].sort((a,b) => b.total - a.total);
  let topN = sorted.slice(0, CHART_CONFIG.TOP_N);
  
  let posTop = topN.filter(b => b.sentiment === 'Positive').sort((a,b) => b.up - a.up);
  let support = posTop.length > 0 ? posTop[0] : [...bins].sort((a,b) => b.up - a.up)[0];
  
  let negTop = topN.filter(b => b.sentiment === 'Negative').sort((a,b) => b.down - a.down);
  let resis = negTop.length > 0 ? negTop[0] : [...bins].sort((a,b) => b.down - a.down)[0];

  const result = { 
    dates: df.map(r=>r.date.toISOString().split('T')[0]), 
    closes: df.map(r=>r.close), 
    top_bins: topN, 
    support, 
    resistance: resis, 
    company: companyName 
  };
  chartCache[ticker] = { ts: Date.now(), data: result };
  return result;
}

// ─────────────────────────────────────────────
// DASHBOARD HTTP SERVER
// ─────────────────────────────────────────────
function startDashboard() {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/api/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...state, marketOpen: isMarketOpen() }));
    } else if (req.url === "/api/charts") {
      res.writeHead(200, { "Content-Type": "application/json" });
      try {
        const results = await Promise.all(
          Object.entries(CHART_CONFIG.COMPANY_MASTER).map(([name, ticker]) => getChartDataCached(name, ticker))
        );
        res.end(JSON.stringify({ status: "success", charts: results }));
      } catch (e) {
        res.end(JSON.stringify({ status: "error", message: e.message }));
      }
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(dashboardHTML());
    }
  });
  server.listen(CONFIG.dashPort, () => {
    info("Dashboard running at http://localhost:" + CONFIG.dashPort);
  });
}

// ─────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────
(async () => {
  try {
    startDashboard();
    await doLogin();

    try {
      const funds = await apiCall("GET", "/user/fundsummary");
      if (funds.status === true || funds.status === "true") {
        state.balance = funds.data[0].AVAILABLE_BALANCE;
        info(`Balance: Rs. ${state.balance}`);
      }
    } catch (e) { warn("Fund summary: " + e.message); }

    await tradingLoop();
  } catch (e) {
    error("Fatal: " + e.message);
    process.exit(1);
  }
})();
