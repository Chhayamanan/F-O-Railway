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
        console.log("[BASELINE] Fetching last-week 5m data from Yahoo Finance...");

        const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
        const saved: BaselineItem[] = [];

        for (const sym of INTRADAY_STOCKS) {
            const ticker = sym.endsWith('.NS') ? sym : `${sym}.NS`;
            const cleanSym = sym.replace('.NS', '');

            try {
                // Yahoo supports 5m data up to 60 days; '5d' gives last week cleanly
                const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=5m&range=5d`;
                const res = await axios.get(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    timeout: 10000
                });

                const result = res.data?.chart?.result?.[0];
                if (!result?.timestamp) {
                    console.warn(`[BASELINE] No data returned for ${cleanSym}`);
                    continue;
                }

                const volumes: number[] = result.indicators.quote[0].volume
                    .filter((v: any) => v !== null && !isNaN(v) && v > 0);

                if (volumes.length === 0) {
                    console.warn(`[BASELINE] Empty volume array for ${cleanSym}`);
                    continue;
                }

                const avg = Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length);
                this.avgVolumes[cleanSym] = avg;
                saved.push({ symbol: cleanSym, avgVol: avg });

                console.log(`[BASELINE] ${cleanSym} → avg vol: ${avg} (from ${volumes.length} candles)`);
            } catch (err: any) {
                console.error(`[BASELINE] Failed for ${cleanSym}:`, err.message);
            }

            await delay(1200); // polite rate limit
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
    private static getLastClosed5mWindow(): { fromdate: string; todate: string } {
        const now = new Date();

        // Convert to IST (UTC+5:30)
        const istMs = now.getTime() + (5.5 * 60 * 60 * 1000);
        const ist   = new Date(istMs);

        // Floor to current 5m block, then go back one full block (last closed candle)
        const flooredMin = Math.floor(ist.getUTCMinutes() / 5) * 5;
        const blockEnd   = new Date(ist);
        blockEnd.setUTCMinutes(flooredMin, 0, 0);

        const toDate   = new Date(blockEnd.getTime() - 5 * 60 * 1000);   // end of last candle
        const fromDate = new Date(toDate.getTime()   - 5 * 60 * 1000);   // start of last candle

        const fmt = (d: Date) => {
            const Y  = d.getUTCFullYear();
            const M  = String(d.getUTCMonth() + 1).padStart(2, '0');
            const D  = String(d.getUTCDate()).padStart(2, '0');
            const h  = String(d.getUTCHours()).padStart(2, '0');
            const m  = String(d.getUTCMinutes()).padStart(2, '0');
            return `${Y}-${M}-${D} ${h}:${m}`;
        };

        return { fromdate: fmt(fromDate), todate: fmt(toDate) };
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

        const { fromdate, todate } = this.getLastClosed5mWindow();
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
                        'X-ClientPublicIP': '127.0.0.1',
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
                console.error(`[RADAR] Error on ${cleanSym}:`, err.response?.data || err.message);
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
