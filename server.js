"use strict";

/**
 * mStock Nifty Breakout Trading Bot + Live Dashboard
 * ===================================================
 * - Trades: login → track Nifty OHLC → buy CE/PE on breakout
 * - Dashboard: HTTP server on PORT (default 3000) showing live tickers
 */

const https   = require("https");
const http    = require("http");
const fs      = require("fs");
const { authenticator } = require("otplib");

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────
const CONFIG = {
  clientCode:     "MA2468211",
  password:       "Chh@ya001",
  apiKey:         "pznEP6Gnv3kRsradk+fCeAw3/Q4Fx2quQg3hEl4q2BA=",
  totpSecret:     "I2QG4TGM6HZ5ZGG23OED33A3HZSS3J2B",   // set "" to use OTP SMS

  niftyToken:     "26000",
  niftyExchange:  "NSE",

  optionExchange: "NFO",
  optionLotSize:  25,
  optionLots:     1,
  optionProduct:  "CARRYFORWARD",
  strikeOffset:   100,

  pollIntervalMs: 30_000,
  marketOpenH:  9,  marketOpenM:  15,
  marketCloseH: 15, marketCloseM: 30,

  dashPort: process.env.PORT || 3000,
};

const BASE = "https://api.mstock.trade/openapi/typeb";

// ─────────────────────────────────────────────
// STATE  (shared between trading loop + dashboard)
// ─────────────────────────────────────────────
let jwtToken    = "";
let orderPlaced = "";
let scripMaster = null;
let dayHigh     = null;
let dayLow      = null;

const state = {
  ltp: null, open: null, high: null, low: null, close: null,
  chgAbs: null, chgPct: null,
  dayHigh: null, dayLow: null,
  manualHigh: null, manualLow: null,
  signal: "watching",   // "watching" | "CALL" | "PUT"
  lastUpdate: null,
  logs: [],
  balance: null,
  orderPlaced: "",
};

// ─────────────────────────────────────────────
// TIME HELPER (IST)
// ─────────────────────────────────────────────
function getISTDate() {
  // Convert current system time to Indian Standard Time explicitly
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
// NIFTY OHLC
// ─────────────────────────────────────────────
async function getNiftyOhlc() {
  const data = await apiCall("GET", "/instruments/quote", {
    mode: "OHLC",
    exchangeTokens: { [CONFIG.niftyExchange]: [CONFIG.niftyToken] },
  });
  if (String(data.status).toLowerCase() !== "true")
    throw new Error("OHLC error: " + data.message);
  const fetched = data.data.fetched;
  if (!fetched || !fetched.length) throw new Error("OHLC: empty fetched");
  return fetched[0];
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

async function findNiftyOption(optionType, spot) {
  const strike = Math.round(spot / CONFIG.strikeOffset) * CONFIG.strikeOffset;
  const instruments = await getScripMaster();
  const today = getISTDate(); today.setHours(0, 0, 0, 0);
  const candidates = [];
  for (const inst of instruments) {
    if (inst.exch_seg === "NFO" && inst.instrumenttype === "OPTIDX" &&
        inst.name && inst.name.toUpperCase() === "NIFTY" &&
        inst.symbol && inst.symbol.toUpperCase().endsWith(optionType)) {
      const expDate = new Date(inst.expiry);
      if (isNaN(expDate) || expDate < today) continue;
      let instStrike = parseFloat(inst.strike || 0);
      if (instStrike > 200000) instStrike /= 100;
      candidates.push({ diff: Math.abs(instStrike - strike), expDate, inst });
    }
  }
  if (!candidates.length) throw new Error(`No ${optionType} option near strike ${strike}`);
  candidates.sort((a, b) => a.diff - b.diff || a.expDate - b.expDate);
  const best = candidates[0].inst;
  info(`Selected: ${best.name} | strike=${best.strike} | expiry=${best.expiry}`);
  return best;
}

// ─────────────────────────────────────────────
// ORDER
// ─────────────────────────────────────────────
async function placeOrder(instrument, optionType) {
  const qty = CONFIG.optionLotSize * CONFIG.optionLots;
  info(`Placing ${optionType} order: ${instrument.symbol} x${qty}`);
  const data = await apiCall("POST", "/orders/regular", {
    variety: "NORMAL", tradingsymbol: instrument.symbol, symboltoken: instrument.token,
    exchange: CONFIG.optionExchange, transactiontype: "BUY", ordertype: "MARKET",
    quantity: String(qty), producttype: CONFIG.optionProduct,
    price: "0", triggerprice: "0", squareoff: "0", stoploss: "0",
    trailingStopLoss: "", disclosedquantity: "", duration: "DAY",
    ordertag: `nifty_${optionType.toLowerCase()}`,
  });
  if (String(data.status).toLowerCase() !== "true")
    throw new Error("Order failed: " + data.message);
  info(`Order placed! ID: ${data.data.orderid}`);
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
  info("  mStock Nifty Breakout Bot started");
  info(`  Dashboard: http://localhost:${CONFIG.dashPort}`);
  info("=".repeat(55));

  while (true) {
    try {
      if (!isMarketOpen()) {
        const now = getISTDate();
        const afterClose = now.getHours() * 60 + now.getMinutes() >
                           CONFIG.marketCloseH * 60 + CONFIG.marketCloseM;
        if (afterClose) { orderPlaced = ""; dayHigh = null; dayLow = null; state.signal = "watching"; }
        await sleep(60_000);
        continue;
      }

      const ohlc = await getNiftyOhlc();
      const ltp  = parseFloat(ohlc.ltp);
      const high = parseFloat(ohlc.high);
      const low  = parseFloat(ohlc.low);
      const cls  = parseFloat(ohlc.close);

      if (dayHigh === null) { dayHigh = high; dayLow = low; }
      const prevDayHigh = dayHigh;
      const prevDayLow = dayLow;
      
      dayHigh = Math.max(dayHigh, high);
      dayLow  = Math.min(dayLow,  low);

      // determine active limits
      const activeHigh = state.manualHigh !== null ? state.manualHigh : prevDayHigh;
      const activeLow  = state.manualLow !== null ? state.manualLow : prevDayLow;

      // update shared state for dashboard
      Object.assign(state, {
        ltp, open: parseFloat(ohlc.open), high, low, close: cls,
        chgAbs: ltp - cls, chgPct: ((ltp - cls) / cls) * 100,
        dayHigh, dayLow, lastUpdate: getISTDate().toLocaleTimeString("en-US", { hour12: false }),
        orderPlaced,
      });

      info(`LTP: ${ltp.toFixed(2)}  LimitUp: ${activeHigh.toFixed(2)}  LimitDn: ${activeLow.toFixed(2)}  Order: ${orderPlaced || "None"}`);

      if (ltp > activeHigh && orderPlaced !== "CALL") {
        info("BREAKOUT ABOVE UPPER LIMIT — Buying CALL");
        const inst = await findNiftyOption("CE", ltp);
        await placeOrder(inst, "CALL");
        orderPlaced = "CALL"; state.signal = "CALL"; state.orderPlaced = "CALL";
      } else if (ltp < activeLow && orderPlaced !== "PUT") {
        info("BREAKDOWN BELOW LOWER LIMIT — Buying PUT");
        const inst = await findNiftyOption("PE", ltp);
        await placeOrder(inst, "PUT");
        orderPlaced = "PUT"; state.signal = "PUT"; state.orderPlaced = "PUT";
      } else {
        state.signal = "watching";
      }

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
<title>Nifty Breakout Bot</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f0f;color:#e0e0e0;min-height:100vh}
  header{background:#161616;border-bottom:1px solid #2a2a2a;padding:14px 24px;display:flex;align-items:center;justify-content:space-between}
  header h1{font-size:16px;font-weight:600;color:#fff;letter-spacing:-0.02em}
  .dot{width:8px;height:8px;border-radius:50%;background:#4ade80;display:inline-block;margin-right:6px;animation:pulse 1.5s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
  .status{font-size:12px;color:#888}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:20px 24px}
  .manual-limits{grid-column:1 / -1;display:flex;gap:12px;align-items:flex-end;background:#1a1a1a;padding:12px;border-radius:10px;border:1px solid #333;}
  .input-group{flex:1;}
  .input-group input{width:100%;padding:8px 12px;border-radius:6px;background:#000;border:1px solid #444;color:#fff;font-size:14px;outline:none;}
  .input-group input:focus{border-color:#4ade80;}
  .btn-save{padding:9px 16px;background:#4ade80;color:#052e16;font-weight:600;border:none;border-radius:6px;cursor:pointer;}
  .btn-clear{padding:9px 16px;background:#333;color:#fff;font-weight:600;border:none;border-radius:6px;cursor:pointer;}
  .card{background:#161616;border:1px solid #2a2a2a;border-radius:10px;padding:16px}
  .card-label{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px}
  .card-value{font-size:26px;font-weight:600;letter-spacing:-0.03em;color:#fff}
  .card-sub{font-size:12px;margin-top:4px;color:#888}
  .up{color:#4ade80}.down{color:#f87171}.neutral{color:#888}
  .bar-section{padding:0 24px 16px}
  .bar-labels{display:flex;justify-content:space-between;font-size:12px;color:#666;margin-bottom:8px}
  .bar-track{position:relative;height:12px;background:#1e1e1e;border-radius:99px;overflow:visible}
  .bar-low{position:absolute;left:0;top:0;height:100%;background:#f87171;border-radius:99px 0 0 99px;transition:width .5s}
  .bar-high{position:absolute;right:0;top:0;height:100%;background:#4ade80;border-radius:0 99px 99px 0;transition:width .5s}
  .needle{position:absolute;top:-5px;width:3px;height:22px;background:#fff;border-radius:2px;transform:translateX(-50%);transition:left .5s}
  .signal{margin:0 24px 16px;padding:14px 18px;border-radius:10px;display:flex;align-items:center;gap:12px;font-size:14px;font-weight:500;border:1px solid}
  .sig-watch{background:#1a1a1a;border-color:#2a2a2a;color:#888}
  .sig-call{background:#052e16;border-color:#166534;color:#4ade80}
  .sig-put{background:#2d0a0a;border-color:#7f1d1d;color:#f87171}
  .badge{font-size:11px;padding:3px 10px;border-radius:99px;font-weight:600;margin-left:auto}
  .badge-watch{background:#2a2a2a;color:#666}
  .badge-call{background:#166534;color:#4ade80}
  .badge-put{background:#7f1d1d;color:#f87171}
  .log-section{margin:0 24px 24px}
  .log-title{font-size:11px;color:#555;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px}
  .log-box{background:#0a0a0a;border:1px solid #1e1e1e;border-radius:8px;padding:12px;height:200px;overflow-y:auto;font-family:'SF Mono','Fira Code',monospace;font-size:12px}
  .log-entry{padding:2px 0;border-bottom:1px solid #141414;display:flex;gap:8px}
  .log-t{color:#444;min-width:70px}
  .log-INFO{color:#60a5fa}.log-WARN{color:#fbbf24}.log-ERROR{color:#f87171}
  .footer{padding:10px 24px;font-size:11px;color:#444;display:flex;justify-content:space-between}
  @media(max-width:600px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
  <h1><span class="dot"></span>Nifty Breakout Bot</h1>
  <span class="status" id="mkt-status">Loading…</span>
</header>

<div class="grid">
  <div class="manual-limits">
    <div class="input-group">
      <div class="card-label">Manual Upper Limit / High</div>
      <input type="number" id="inp-high" placeholder="Leave blank for Auto (Day High)">
    </div>
    <div class="input-group">
      <div class="card-label">Manual Lower Limit / Low</div>
      <input type="number" id="inp-low" placeholder="Leave blank for Auto (Day Low)">
    </div>
    <div>
      <button class="btn-save" id="btn-save" onclick="saveLimits()">Save Limits</button>
      <button class="btn-clear" onclick="clearLimits()">Clear</button>
    </div>
  </div>

  <div class="card">
    <div class="card-label">Current LTP</div>
    <div class="card-value" id="ltp">—</div>
    <div class="card-sub" id="ltp-chg">—</div>
  </div>
  <div class="card">
    <div class="card-label">Breakout High</div>
    <div class="card-value up" id="d-high">—</div>
    <div class="card-sub" id="high-gap">—</div>
  </div>
  <div class="card">
    <div class="card-label">Breakdown Low</div>
    <div class="card-value down" id="d-low">—</div>
    <div class="card-sub" id="low-gap">—</div>
  </div>
  <div class="card">
    <div class="card-label">Open</div>
    <div class="card-value" id="d-open">—</div>
  </div>
  <div class="card">
    <div class="card-label">Prev Close</div>
    <div class="card-value" id="d-close">—</div>
  </div>
  <div class="card">
    <div class="card-label">Order placed</div>
    <div class="card-value" id="d-order">—</div>
    <div class="card-sub" id="d-balance">—</div>
  </div>
</div>

<div class="bar-section">
  <div class="bar-labels">
    <span id="bl-low">Low: —</span>
    <span style="color:#555">price within day range</span>
    <span id="bl-high">High: —</span>
  </div>
  <div class="bar-track">
    <div class="bar-low"  id="bar-l" style="width:40%"></div>
    <div class="bar-high" id="bar-h" style="width:40%"></div>
    <div class="needle"   id="needle" style="left:50%"></div>
  </div>
</div>

<div class="signal sig-watch" id="signal">
  <span id="sig-txt">Waiting for breakout…</span>
  <span class="badge badge-watch" id="sig-badge">Watching</span>
</div>

<div class="log-section">
  <div class="log-title">Bot log</div>
  <div class="log-box" id="log-box"></div>
</div>

<div class="footer">
  <span>Auto-refreshes every 5s</span>
  <span id="last-upd">—</span>
</div>

<script>
const fmt = n => Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const pct  = n => (n>=0?'+':'')+n.toFixed(2)+'%';

async function saveLimits() {
  const high = document.getElementById('inp-high').value;
  const low = document.getElementById('inp-low').value;
  const btn = document.getElementById('btn-save');
  const org = btn.textContent;
  btn.textContent = 'Saving...';
  try {
    await fetch('/api/limits', {
       method: 'POST', 
       headers:{'Content-Type': 'application/json'},
       body: JSON.stringify({high: high, low: low})
    });
    btn.textContent = 'Saved!';
    setTimeout(() => { btn.textContent = org; }, 2000);
    refresh();
  } catch(e) { console.error('Save limit err:', e); btn.textContent = org; }
}

async function clearLimits() {
  document.getElementById('inp-high').value = '';
  document.getElementById('inp-low').value = '';
  saveLimits();
}

async function refresh() {
  try {
    const r = await fetch('/api/state');
    const s = await r.json();

    document.getElementById('mkt-status').textContent = s.marketOpen ? 'Market open' : 'Market closed';

    if (s.ltp !== null) {
      document.getElementById('ltp').textContent    = fmt(s.ltp);
      const chgEl = document.getElementById('ltp-chg');
      chgEl.textContent = (s.chgAbs>=0?'▲ +':'▼ ')+fmt(Math.abs(s.chgAbs))+'  ('+pct(s.chgPct)+')';
      chgEl.className   = 'card-sub '+(s.chgAbs>=0?'up':'down');
    }

    const activeHigh = s.manualHigh !== null ? s.manualHigh : s.dayHigh;
    const activeLow = s.manualLow !== null ? s.manualLow : s.dayLow;
    
    if (document.activeElement !== document.getElementById('inp-high') && s.manualHigh !== null) {
      document.getElementById('inp-high').value = s.manualHigh;
    }
    if (document.activeElement !== document.getElementById('inp-low') && s.manualLow !== null) {
      document.getElementById('inp-low').value = s.manualLow;
    }

    if (activeHigh) {
      document.getElementById('d-high').textContent  = fmt(activeHigh) + (s.manualHigh !== null ? ' (M)' : ' (A)');
      document.getElementById('d-low').textContent   = fmt(activeLow) + (s.manualLow !== null ? ' (M)' : ' (A)');
      document.getElementById('high-gap').textContent = 'Gap: '+fmt(activeHigh - s.ltp)+' pts';
      document.getElementById('low-gap').textContent  = 'Gap: '+fmt(s.ltp - activeLow)+' pts';
      document.getElementById('bl-low').textContent   = 'Low: '+fmt(activeLow);
      document.getElementById('bl-high').textContent  = 'High: '+fmt(activeHigh);

      const range = activeHigh - activeLow || 1;
      const pos   = Math.min(Math.max((s.ltp - activeLow) / range, 0), 1);
      document.getElementById('bar-l').style.width  = (pos*40).toFixed(1)+'%';
      document.getElementById('bar-h').style.width  = ((1-pos)*40).toFixed(1)+'%';
      document.getElementById('needle').style.left  = (pos*100).toFixed(1)+'%';
    }

    if (s.open)  document.getElementById('d-open').textContent  = fmt(s.open);
    if (s.close) document.getElementById('d-close').textContent = fmt(s.close);

    const ordEl = document.getElementById('d-order');
    ordEl.textContent = s.orderPlaced || 'None';
    ordEl.className   = 'card-value '+(s.orderPlaced==='CALL'?'up':s.orderPlaced==='PUT'?'down':'neutral');
    if (s.balance) document.getElementById('d-balance').textContent = 'Balance: Rs. '+fmt(s.balance);

    const sb = document.getElementById('signal');
    const st = document.getElementById('sig-txt');
    const bd = document.getElementById('sig-badge');
    if (s.signal === 'CALL') {
      sb.className='signal sig-call'; bd.className='badge badge-call'; bd.textContent='BUY CALL';
      st.textContent='Price broke above day high — CALL order placed';
    } else if (s.signal === 'PUT') {
      sb.className='signal sig-put'; bd.className='badge badge-put'; bd.textContent='BUY PUT';
      st.textContent='Price broke below day low — PUT order placed';
    } else {
      sb.className='signal sig-watch'; bd.className='badge badge-watch'; bd.textContent='Watching';
      st.textContent='Price within day range — watching for breakout…';
    }

    const box = document.getElementById('log-box');
    box.innerHTML = s.logs.map(l =>
      '<div class="log-entry"><span class="log-t">'+l.t+'</span><span class="log-'+l.level+'">'+
      l.level.padEnd(5)+'</span><span>'+l.msg+'</span></div>'
    ).join('');

    document.getElementById('last-upd').textContent = 'Updated ' + (s.lastUpdate || '—');
  } catch(e) { console.error(e); }
}

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// DASHBOARD HTTP SERVER
// ─────────────────────────────────────────────
function startDashboard() {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...state, marketOpen: isMarketOpen() }));
    } else if (req.url === "/api/limits" && req.method === "POST") {
      let body = "";
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          const params = JSON.parse(body);
          if (params.high === null || params.high === "") state.manualHigh = null;
          else state.manualHigh = parseFloat(params.high);
          if (params.low === null || params.low === "") state.manualLow = null;
          else state.manualLow = parseFloat(params.low);
          
          info(`Manual Limits Updated -- High: ${state.manualHigh || 'Auto'}, Low: ${state.manualLow || 'Auto'}`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch(e) {
          res.writeHead(400); res.end("Bad Request");
        }
      });
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
