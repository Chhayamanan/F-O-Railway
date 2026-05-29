import { INTRADAY_STOCKS } from '../services/marketDataService';
import { MstockService } from '../services/mstockService';
import { INTRADAY_MARGINS_DATA } from '../services/intradayData';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

export const INTRADAY_TOKEN_MAP: Record<string, string> = {
    "SETFNIF50": "10176", "MANORAMA": "10227", "SATIN": "10453", "BHARTIARTL": "10604",
    "360ONE": "13061", "3MINDIA": "474", "AARTIDRUGS": "4481", "AARTIIND": "7",
    "AARTIPHARM": "13868", "AAVAS": "5385", "ABB": "13", "ABBOTINDIA": "17903",
    "ABCAPITAL": "21614", "ABFRL": "30108", "ABREL": "625", "ABSLAMC": "6018", "ACC": "22"
};

// Dynamically populate any other keys from standard margins data for complete coverage
for (const sym of Object.keys(INTRADAY_MARGINS_DATA)) {
    if (!INTRADAY_TOKEN_MAP[sym]) {
        INTRADAY_TOKEN_MAP[sym] = INTRADAY_MARGINS_DATA[sym].fToken;
    }
}

export interface VolumeRadarItem {
    symbol: string;
    ltp: number;
    avgVol: number;
    currentVol: number;
    multiplierHit: number;
    timestamp: number;
}

export interface BaselineItem {
    symbol: string;
    avgVol: number;
}

export class VolumeRadarScanner {
    public static isRunning    = false;
    public static timeoutId: any = null;
    public static multiplier   = 10;
    public static avgVolumes: Record<string, number> = {};
    public static radarResults: VolumeRadarItem[] = [];

    // ── STEP 1: Build baselines using Type A (Historical with exact Date Windows) ──
    public static async initializeBaselines() {
        console.log("[BASELINE] Fetching historical baselines using Type A endpoints...");

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

        const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
        const saved: BaselineItem[] = [];

        // Build proper query formats for Type A History: YYYY-MM-DD HH:MM:SS
        const now = new Date();
        const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
        
        const fmtTypeA = (d: Date) => {
            const Y = d.getUTCFullYear();
            const M = String(d.getUTCMonth() + 1).padStart(2, '0');
            const D = String(d.getUTCDate()).padStart(2, '0');
            return `${Y}-${M}-${D}+09:15:00`;
        };

        const toDateStr   = fmtTypeA(ist);
        const fromDateStr = fmtTypeA(new Date(ist.getTime() - 7 * 24 * 60 * 60 * 1000));

        for (const sym of INTRADAY_STOCKS) {
            const cleanSym = sym.replace('.NS', '');
            const symboltoken = INTRADAY_TOKEN_MAP[cleanSym] || MstockService.getEqTokenOnlySync(cleanSym);

            if (!symboltoken) continue;

            try {
                // Type A expects path params and standard GET strategy
                const response = await axios({
                    method: 'GET',
                    url: `https://api.mstock.trade/openapi/typea/instruments/historical/NSE/${symboltoken}/5minute`,
                    params: {
                        from: fromDateStr,
                        to: toDateStr
                    },
                    headers: {
                        'X-Mirae-Version': '1',
                        'Authorization': `Bearer ${token}`
                    }
                });

                const candles: any[][] = response.data?.data?.candles;
                if (!Array.isArray(candles) || candles.length === 0) continue;

                // Format structure: [timestamp, open, high, low, close, volume]
                const volumes = candles.map(c => Number(c[5])).filter(v => !isNaN(v) && v > 0);
                if (volumes.length === 0) continue;

                const avg = Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length);
                this.avgVolumes[cleanSym] = avg;
                saved.push({ symbol: cleanSym, avgVol: avg });

                console.log(`[BASELINE] ${cleanSym} → calculated avg vol: ${avg}`);
            } catch (err: any) {
                console.error(`[BASELINE] Failed for ${cleanSym}:`, err.message);
            }
            await delay(300);
        }

        this.saveBaselines(saved);
    }

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

    // ── STEP 2: Real-time Scanning using Type B (/instruments/intraday POST) ──
    private static async runScanRound() {
        let token: string;
        try {
            token = await MstockService.getMstockJwtToken();
        } catch (err: any) {
            console.error("[RADAR] Auth failed:", err.message);
            return;
        }

        const apiKey = process.env.MSTOCK_API_KEY;
        if (!apiKey) return;

        let publicIp = '127.0.0.1';
        try {
            const ipRes = await axios.get('https://api.ipify.org?format=json');
            if (ipRes.data?.ip) publicIp = ipRes.data.ip;
        } catch (e) {}

        console.log(`[RADAR] Polling live intraday 5m buckets...`);
        const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
        const freshResults: VolumeRadarItem[] = [...this.radarResults];

        for (const sym of INTRADAY_STOCKS) {
            const cleanSym = sym.replace('.NS', '');
            const symboltoken = INTRADAY_TOKEN_MAP[cleanSym] || MstockService.getEqTokenOnlySync(cleanSym);

            if (!symboltoken) continue;

            try {
                // Official Type B /instruments/intraday specifications applied
                const response = await axios({
                    method: 'POST',
                    url: 'https://api.mstock.trade/openapi/typeb/instruments/intraday',
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
                        exchange: '1',          // FIX: Must use string numerical code ('1' = NSE)
                        symboltoken,
                        interval: '5minute'    // FIX: Must use lowercase documentation pattern
                    }
                });

                const ok = response.data?.status === true || response.data?.status === "true";
                if (!ok) continue;

                const candles = response.data?.data?.candles;
                if (!Array.isArray(candles) || candles.length === 0) continue;

                // Type B returns current daily array; pick the latest closed frame
                const latest = candles[candles.length - 1]; 
                const open = Number(latest[1]) || 0;
                const ltp = Number(latest[4]) || 0;
                const vol5m = Number(latest[5]) || 0;
                const avgVol = this.avgVolumes[cleanSym] || 0;
                const threshold = avgVol * this.multiplier;
                const isPositive = ltp >= open;

                if (avgVol > 0 && vol5m > threshold) {
                    const multiplierHit = parseFloat((vol5m / avgVol).toFixed(2));
                    console.log(`[ALERT] 🔥 ${cleanSym} volume spike! ${vol5m} > ${threshold} (${multiplierHit}x)`);
                    
                    const existingIdx = freshResults.findIndex(r => r.symbol === cleanSym);

                    if (existingIdx === -1) {
                        try {
                            // First time it enters the radar: Fire Auto-Trade
                            const direction = isPositive ? 'BUY' : 'SELL';
                            console.log(`[AUTO-TRADE] Firing ${direction} for ${cleanSym} at ₹${ltp}`);
                            await MstockService.placeRadarAutoOrder(cleanSym, direction, ltp);
                        } catch (err: any) {
                            console.error(`[AUTO-TRADE ERROR] ${cleanSym}:`, err.message);
                        }
                    }

                    this.upsertRadar(freshResults, cleanSym, ltp, avgVol, vol5m, multiplierHit);
                }
            } catch (err: any) {
                console.error(`[RADAR-ERROR] ${cleanSym}:`, err.message);
            }

            await delay(150); // Keep token rate boundaries safe
        }

        freshResults.sort((a, b) => b.multiplierHit - a.multiplierHit);
        this.radarResults = freshResults;
        console.log(`[RADAR] Scan complete. Alerts: ${this.radarResults.length}`);
    }

    private static upsertRadar(list: VolumeRadarItem[], symbol: string, ltp: number, avgVol: number, currentVol: number, multiplierHit: number) {
        const item: VolumeRadarItem = { symbol, ltp, avgVol, currentVol, multiplierHit, timestamp: Date.now() };
        const idx = list.findIndex(r => r.symbol === symbol);
        if (idx !== -1) list[idx] = item;
        else list.push(item);
    }

    private static scheduleNext() {
        if (!this.isRunning) return;
        const now = new Date();
        const minsToNext = 5 - (now.getMinutes() % 5);
        const msToNext = (minsToNext * 60 * 1000) - (now.getSeconds() * 1000) - now.getMilliseconds() + 3000;

        console.log(`[SCHEDULER] Next scan in ${(msToNext / 1000).toFixed(1)}s`);

        this.timeoutId = setTimeout(async () => {
            await this.runScanRound();
            this.scheduleNext();
        }, msToNext);
    }

    public static async start() {
        if (this.isRunning) {
            console.log("[RADAR] Already running.");
            return;
        }
        if (Object.keys(this.avgVolumes).length === 0 && !this.loadBaselines()) {
            console.error("[RADAR] No baselines. Run initializeBaselines() first.");
            return;
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
