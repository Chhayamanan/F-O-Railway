import { INTRADAY_STOCKS } from '../services/marketDataService';
import { MstockService } from '../services/mstockService';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// ─── Token Map ────────────────────────────────────────────────────────────────
export const INTRADAY_TOKEN_MAP: Record<string, string> = {
    "SETFNIF50": "10176",
    "MANORAMA": "10227",
    "SATIN": "10453",
    "BHARTIARTL": "10604",
    "360ONE": "13061",
    "3MINDIA": "474",
    "AARTIDRUGS": "4481",
    "AARTIIND": "7",
    "AARTIPHARM": "13868",
    "AAVAS": "5385",
    "ABB": "13",
    "ABBOTINDIA": "17903",
    "ABCAPITAL": "21614",
    "ABFRL": "30108",
    "ABREL": "625",
    "ABSLAMC": "6018",
    "ACC": "22"
};

// ─── Types ────────────────────────────────────────────────────────────────────
export interface VolumeRadarItem {
    symbol: string;
    ltp: number;
    avgVol: number;
    currentVol: number;
    multiplierHit: number;   // how many times the average was exceeded
    timestamp: number;
}

export interface BaselineItem {
    symbol: string;
    avgVol: number;
}

// ─── Scanner ──────────────────────────────────────────────────────────────────
export class VolumeRadarScanner {
    public static isRunning    = false;
    public static timeoutId: any = null;
    public static multiplier   = 10;

    // symbol → average 5m volume (populated once per day)
    public static avgVolumes: Record<string, number> = {};

    // live radar results
    public static radarResults: VolumeRadarItem[] = [];

    // ── STEP 1: Build baselines from Yahoo (run once manually each morning) ──
    public static async initializeBaselines() {
        console.log("[BASELINE] Fetching 5m baselines from MStock...");

        let token: string;
        try {
            token = await MstockService.getMstockJwtToken();
        } catch (err: any) {
            console.error("[BASELINE] Auth failed:", err.message);
            return;
        }

        const apiKey = process.env.MSTOCK_API_KEY;
        if (!apiKey) {
            console.error("[BASELINE] MSTOCK_API_KEY not set.");
            return;
        }

        // Fetch container's public IP to satisfy MStock IP binding
        let publicIp = '127.0.0.1';
        try {
            const ipRes = await axios.get('https://api.ipify.org?format=json');
            if (ipRes.data && ipRes.data.ip) {
                publicIp = ipRes.data.ip;
                console.log(`[BASELINE] Detected public IP: ${publicIp}`);
            }
        } catch (e: any) {
            console.warn("[BASELINE] Failed to fetch public IP, falling back to 127.0.0.1");
        }

        const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
        const saved: BaselineItem[] = [];

        // Build a window: last 7 calendar days → typically 5 trading days of 5m candles
        const now   = new Date();
        const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
        const ist   = new Date(istMs);

        const fmt = (d: Date) => {
            const Y = d.getUTCFullYear();
            const M = String(d.getUTCMonth() + 1).padStart(2, '0');
            const D = String(d.getUTCDate()).padStart(2, '0');
            return `${Y}-${M}-${D} 09:15`;
        };

        const todate   = fmt(ist);
        const fromDate = new Date(ist.getTime() - 7 * 24 * 60 * 60 * 1000);
        const fromdate = fmt(fromDate);

        console.log(`[BASELINE] Window: ${fromdate} → ${todate}`);

        for (const sym of INTRADAY_STOCKS) {
            const cleanSym    = sym.replace('.NS', '');
            const symboltoken = INTRADAY_TOKEN_MAP[cleanSym]
                             || MstockService.getEqTokenOnlySync(cleanSym);

            if (!symboltoken) {
                console.warn(`[BASELINE] No token for ${cleanSym}, skipping.`);
                continue;
            }

            try {
                const response = await axios({
                    method: 'POST',
                    url: 'https://api.mstock.trade/openapi/typeb/instruments/historical',
                    headers: {
                        'X-Mirae-Version':  '1',
                        'Authorization':    `Bearer ${token}`,
                        'X-PrivateKey':     apiKey,
                        'Content-Type':     'application/json',
                        'X-ClientLocalIP':  '127.0.0.1',
                        'X-ClientPublicIP': publicIp,
                        'X-MACAddress':     '00:00:00:00:00:00'
                    },
                    data: {
                        exchange: 'NSE', // Keep this consistent
                        symboltoken,
                        interval: 'FIVE_MINUTE', // Keep this consistent
                        fromdate,
                        todate
                    }
                });

                const ok = response.data?.status === true || response.data?.status === "true";
                if (!ok) {
                    console.warn(`[BASELINE] MStock rejected ${cleanSym}:`, JSON.stringify(response.data));
                    continue;
                }

                const candles: any[][] = response.data?.data?.candles;
                if (!Array.isArray(candles) || candles.length === 0) {
                    console.warn(`[BASELINE] No candles for ${cleanSym}`);
                    continue;
                }

                // candle: [timestamp, open, high, low, close, volume]
                const volumes = candles
                    .map(c => Number(c[5]))
                    .filter(v => !isNaN(v) && v > 0);

                if (volumes.length === 0) {
                    console.warn(`[BASELINE] Empty volumes for ${cleanSym}`);
                    continue;
                }

                const avg = Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length);
                this.avgVolumes[cleanSym] = avg;
                saved.push({ symbol: cleanSym, avgVol: avg });

                console.log(`[BASELINE] ${cleanSym} → avg vol: ${avg} (${volumes.length} candles)`);

            } catch (err: any) {
                console.error(`[BASELINE] Failed for ${cleanSym}:`, err.response?.data || err.message);
            }

            await delay(300); // MStock is your own broker — tighter delay is fine
        }

        console.log(`[BASELINE] Done. ${saved.length}/${INTRADAY_STOCKS.length} stocks loaded.`);
        this.saveBaselines(saved);
    }

    // ── Save / Load baselines to disk ─────────────────────────────────────────
    private static saveBaselines(data: BaselineItem[]) {
        try {
            const filePath = path.join(process.cwd(), 'volume_baseline_report.json');
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
            console.log(`[BASELINE] Saved to ${filePath}`);
        } catch (err) {
            console.error("[BASELINE] Save failed:", err);
        }
    }

    public static loadBaselines(): boolean {
        try {
            const filePath = path.join(process.cwd(), 'volume_baseline_report.json');
            if (!fs.existsSync(filePath)) return false;

            const data: BaselineItem[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            let count = 0;
            for (const item of data) {
                if (item.symbol && typeof item.avgVol === 'number') {
                    this.avgVolumes[item.symbol] = item.avgVol;
                    count++;
                }
            }
            console.log(`[BASELINE] Loaded ${count} baselines from file.`);
            return count > 0;
        } catch (err) {
            console.error("[BASELINE] Load failed:", err);
            return false;
        }
    }

    // ── STEP 2: Fetch last closed 5m candle from MStock ──────────────────────
    private static getLastClosed5mWindow(): { fromdate: string; todate: string } | null {
        const now = new Date();

        // Convert to IST (UTC+5:30)
        const istMs = now.getTime() + (5.5 * 60 * 60 * 1000);
        const ist   = new Date(istMs);

        const istHour = ist.getUTCHours();
        const istMin  = ist.getUTCMinutes();
        const totalMin = istHour * 60 + istMin;

        // Market hours: 09:15 – 15:30 IST
        const MARKET_OPEN  = 9  * 60 + 15;  // 555
        const MARKET_CLOSE = 15 * 60 + 30;  // 930

        let blockEndMin: number;
        let dateBase: Date = ist; // which day's candle

        if (totalMin < MARKET_OPEN + 5) {
            // Before first candle is closed (pre-market or very early)
            // Use last candle of PREVIOUS trading day: 15:25→15:30
            const prevDay = new Date(ist.getTime() - 24 * 60 * 60 * 1000);
            // Skip back over weekends
            while ([0, 6].includes(prevDay.getUTCDay())) {
                prevDay.setTime(prevDay.getTime() - 24 * 60 * 60 * 1000);
            }
            dateBase    = prevDay;
            blockEndMin = MARKET_CLOSE;
        } else if (totalMin >= MARKET_CLOSE) {
            // After market close → use last candle of today: 15:25→15:30
            blockEndMin = MARKET_CLOSE;
        } else {
            // During market hours → last fully closed 5m candle
            const flooredMin = Math.floor(totalMin / 5) * 5;
            blockEndMin = flooredMin; // this block just closed
        }

        const fmt = (Y: number, M: number, D: number, h: number, m: number) =>
            `${Y}-${String(M).padStart(2,'0')}-${String(D).padStart(2,'0')} ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;

        const Y = dateBase.getUTCFullYear();
        const M = dateBase.getUTCMonth() + 1;
        const D = dateBase.getUTCDate();

        const toH   = Math.floor(blockEndMin / 60);
        const toM   = blockEndMin % 60;
        const fromH = Math.floor((blockEndMin - 5) / 60);
        const fromM = (blockEndMin - 5) % 60;

        return {
            fromdate: fmt(Y, M, D, fromH, fromM),
            todate:   fmt(Y, M, D, toH, toM)
        };
    }

    // ── STEP 3: One full scan round across all stocks ─────────────────────────
    private static async runScanRound() {
        // Auth
        let token: string;
        try {
            token = await MstockService.getMstockJwtToken();
        } catch (err: any) {
            console.error("[RADAR] Auth failed:", err.message);
            return;
        }

        const apiKey = process.env.MSTOCK_API_KEY;
        if (!apiKey) {
            console.error("[RADAR] MSTOCK_API_KEY not set.");
            return;
        }

        // Fetch container's public IP to satisfy MStock IP binding
        let publicIp = '127.0.0.1';
        try {
            const ipRes = await axios.get('https://api.ipify.org?format=json');
            if (ipRes.data && ipRes.data.ip) {
                publicIp = ipRes.data.ip;
            }
        } catch (e: any) {
            // Ignore silently
        }

        const window = this.getLastClosed5mWindow();
        if (!window) {
            console.log("[RADAR] No valid market window. Skipping scan.");
            return;
        }

        const { fromdate, todate } = window;
        console.log(`[RADAR] Scanning window: ${fromdate} → ${todate}`);

        const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
        const freshResults: VolumeRadarItem[] = [...this.radarResults];

        for (const sym of INTRADAY_STOCKS) {
            const cleanSym = sym.replace('.NS', '');
            const symboltoken = INTRADAY_TOKEN_MAP[cleanSym] || MstockService.getEqTokenOnlySync(cleanSym);

            if (!symboltoken) {
                console.warn(`[RADAR] No token for ${cleanSym}, skipping.`);
                continue;
            }

            try {
                const response = await axios({
                    method: 'POST',                          // POST avoids GET-body stripping
                    url: 'https://api.mstock.trade/openapi/typeb/instruments/historical',
                    headers: {
                        'X-Mirae-Version': '1',
                        'Authorization': `Bearer ${token}`,
                        'X-PrivateKey': apiKey,
                        'Content-Type': 'application/json',
                        'X-ClientLocalIP': '127.0.0.1',
                        'X-ClientPublicIP': publicIp,
                        'X-MACAddress': '00:00:00:00:00:00'
                    },
                    data: {
                        exchange: 'NSE',                     // string name, not numeric
                        symboltoken,
                        interval: 'FIVE_MINUTE',             // check MStock docs for exact value
                        fromdate,
                        todate
                    }
                });

                const ok = response.data?.status === true || response.data?.status === "true";
                if (!ok) {
                    console.error(`[RADAR] MStock rejected ${cleanSym}:`, JSON.stringify(response.data));
                    continue;
                }

                const candles = response.data?.data?.candles;
                if (!Array.isArray(candles) || candles.length === 0) {
                    console.log(`[RADAR] No candles for ${cleanSym} in this window.`);
                    continue;
                }

                // Candle format: [timestamp, open, high, low, close, volume]
                const latest  = candles[candles.length - 1];
                const ltp     = Number(latest[4]) || 0;
                const vol5m   = Number(latest[5]) || 0;
                const avgVol  = this.avgVolumes[cleanSym] || 0;
                const threshold = avgVol * this.multiplier;

                console.log(`[RADAR] ${cleanSym} | vol: ${vol5m} | threshold: ${threshold} (avg: ${avgVol} × ${this.multiplier})`);

                if (avgVol > 0 && vol5m > threshold) {
                    const multiplierHit = parseFloat((vol5m / avgVol).toFixed(2));
                    console.log(`[ALERT] 🔥 ${cleanSym} volume spike! ${vol5m} > ${threshold} (${multiplierHit}x avg)`);
                    this.upsertRadar(freshResults, cleanSym, ltp, avgVol, vol5m, multiplierHit);
                }

            } catch (err: any) {
                console.error(`[RADAR-CATCH] ${cleanSym}:`, err.response?.data || err.message);
            }

            await delay(150); // throttle between stocks
        }

        this.radarResults = freshResults;
        console.log(`[RADAR] Scan complete. Alerts: ${this.radarResults.length}`);
    }

    // ── Upsert helper ─────────────────────────────────────────────────────────
    private static upsertRadar(
        list: VolumeRadarItem[],
        symbol: string,
        ltp: number,
        avgVol: number,
        currentVol: number,
        multiplierHit: number
    ) {
        const item: VolumeRadarItem = { symbol, ltp, avgVol, currentVol, multiplierHit, timestamp: Date.now() };
        const idx = list.findIndex(r => r.symbol === symbol);
        if (idx !== -1) list[idx] = item;
        else list.push(item);
    }

    // ── STEP 4: Schedule to run every 5 minutes aligned to clock ─────────────
    private static scheduleNext() {
        if (!this.isRunning) return;

        const now = new Date();
        const minsToNext = 5 - (now.getMinutes() % 5);
        const msToNext   = (minsToNext * 60 * 1000)
                         - (now.getSeconds() * 1000)
                         - now.getMilliseconds()
                         + 3000; // 3s buffer for MStock to finalize the candle

        console.log(`[SCHEDULER] Next scan in ${(msToNext / 1000).toFixed(1)}s`);

        this.timeoutId = setTimeout(async () => {
            await this.runScanRound();
            this.scheduleNext();
        }, msToNext);
    }

    // ── Public controls ───────────────────────────────────────────────────────
    public static async start() {
        if (this.isRunning) {
            console.log("[RADAR] Already running.");
            return;
        }

        // Load baselines — fail loudly if not initialized
        if (Object.keys(this.avgVolumes).length === 0) {
            const ok = this.loadBaselines();
            if (!ok) {
                console.error("[RADAR] No baselines found. Run initializeBaselines() first.");
                return;
            }
        }

        this.isRunning = true;
        console.log("[RADAR] Starting. Running first scan immediately...");
        await this.runScanRound();
        this.scheduleNext();
    }

    public static stop() {
        this.isRunning = false;
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        console.log("[RADAR] Stopped.");
    }

    public static setMultiplier(val: number) {
        this.multiplier = val;
        console.log(`[RADAR] Multiplier set to ${val}`);
    }
}
