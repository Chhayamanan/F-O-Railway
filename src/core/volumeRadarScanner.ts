import { INTRADAY_STOCKS } from '../services/marketDataService';
import { MstockService } from '../services/mstockService';
import { YahooService } from '../services/yahooService';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Token is already provided for the every stocks as requested by the user
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

export interface VolumeRadarItem {
    symbol: string;
    ltp: number;
    avg5mVol400: number;
    latest5mVol: number;
    timestamp: number;
}

// Structure for your downloadable baseline JSON file
export interface BaselineExportItem {
    "Sr Number": number;
    "Stock Name/Symbol": string;
    "400 Average volume": number;
}

export class VolumeRadarScanner {
    public static isRunning = false;
    public static timeoutId: any = null;
    public static avg5mVolumes: Record<string, number> = {};
    public static lastCumulativeVolumes: Record<string, number> = {};
    public static lastPrices: Record<string, number> = {};
    public static radarResults: VolumeRadarItem[] = [];
    public static multiplier: number = 10;
    public static lastScanTime: number = 0;

    /**
     * STEP 1: Manual Baseline Initialization (Run once daily)
     * Fetches historical 5m data from Yahoo Finance to calculate the 400-period average volume baseline.
     */
    public static async initializeHistoricalAverages() {
        console.log("[RADAR] Fetching 400-period 5m historical baselines using Yahoo Finance...");
        let loadedCount = 0;
        const exportData: BaselineExportItem[] = [];
        const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

        for (const sym of INTRADAY_STOCKS) {
            const cleanSym = sym.replace('.NS', '');
            try {
                // Yahoo finance limits range depending on interval. For 5m, maximum range is 60 days
                const history = await YahooService.get5MinData(sym, 14); 
                if (Array.isArray(history) && history.length > 0) {
                    // Filter out any candles where volume is NaN, null, or undefined
                    const validHistory = history.filter((curr: any) => curr && curr.volume !== null && !isNaN(curr.volume));
                    
                    const last400 = validHistory.slice(-400);

                    if (last400.length > 0) {
                        const sum = last400.reduce((acc: number, curr: any) => acc + (curr.volume || 0), 0);
                        const avg = Math.round(sum / last400.length);
                        
                        this.avg5mVolumes[cleanSym] = avg;
                        loadedCount++;

                        // Push strictly formatted structure for the JSON export
                        exportData.push({
                            "Sr Number": loadedCount,
                            "Stock Name/Symbol": cleanSym,
                            "400 Average volume": avg
                        });
                    }
                }
            } catch (e: any) {
                 // Fail silently per ticker to keep loop running
            }
            await delay(1500); // Increased delay to avoid rate limits
        }
        console.log(`[RADAR] Successfully derived baselines for ${loadedCount}/${INTRADAY_STOCKS.length} stocks.`);
        
        // Save the downloadable JSON baseline report (overwrites previous runs)
        this.exportBaselineJson(exportData);
    }

    /**
     * Generates and writes the downloadable snapshot file to the disk.
     */
    private static exportBaselineJson(data: BaselineExportItem[]) {
        try {
            const filePath = path.join(process.cwd(), 'volume_baseline_report.json');
            
            // JSON.stringify formatting generates a clean, readable text structure
            fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf-8');
            console.log(`[EXPORT] Downloadable report successfully updated at: ${filePath}`);
        } catch (err) {
            console.error("[EXPORT] Failed to write baseline report file:", err);
        }
    }

    /**
     * Loads baselines from the local JSON report if it exists.
     */
    public static loadBaselinesFromFile(): boolean {
        try {
            const filePath = path.join(process.cwd(), 'volume_baseline_report.json');
            if (fs.existsSync(filePath)) {
                console.log(`[RADAR] Reading baselines from ${filePath}...`);
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                let count = 0;
                for (const item of data) {
                    if (item["Stock Name/Symbol"] && typeof item["400 Average volume"] === 'number') {
                        this.avg5mVolumes[item["Stock Name/Symbol"]] = item["400 Average volume"];
                        count++;
                    }
                }
                console.log(`[RADAR] Loaded ${count} baselines from file.`);
                return count > 0;
            }
        } catch (err) {
            console.error("[RADAR] Failed to load baselines from file:", err);
        }
        return false;
    }

    /**
     * Mathematically builds dynamic strings targeting closed time boxes 
     * Example: Running code at 09:28:40 targets fromdate: "09:20" -> todate: "09:25"
     */
    private static getPast5MinWindow(): { fromDateStr: string; toDateStr: string } {
        // 1. Get the current system time (regardless of whether it's UTC or Local)
        const now = new Date();

        // 2. Explicitly add 5 hours and 30 minutes (in milliseconds) to map to IST
        const IST_OFFSET = 5.5 * 60 * 60 * 1000; 
        const istTime = new Date(now.getTime() + IST_OFFSET);

        // 3. Drop down to the start of the current completed 5-minute block
        const currentBlockMin = Math.floor(istTime.getUTCMinutes() / 5) * 5;
        
        const toDate = new Date(istTime);
        // Note: We use UTC methods here because we manually shifted the absolute timeline forward
        toDate.setUTCMinutes(currentBlockMin, 0, 0); 
        
        const fromDate = new Date(toDate);
        fromDate.setUTCMinutes(fromDate.getUTCMinutes() - 5); 

        // 4. Format strictly to 'YYYY-MM-DD HH:mm' expected by the MStock endpoint
        const formatPayload = (d: Date) => {
            const y = d.getUTCFullYear();
            const m = String(d.getUTCMonth() + 1).padStart(2, '0');
            const dayStr = String(d.getUTCDate()).padStart(2, '0');
            const h = String(d.getUTCHours()).padStart(2, '0');
            const mn = String(d.getUTCMinutes()).padStart(2, '0');
            return `${y}-${m}-${dayStr} ${h}:${mn}`;
        };

        return {
            fromDateStr: formatPayload(fromDate),
            toDateStr: formatPayload(toDate)
        };
    }

    /**
     * CORE RUN ENGINE: Runs everywhere (Live or After-Hours) pulling direct data intervals
     */
    private static async runScanRound() {
        let sessionToken = null;
        try {
            sessionToken = await MstockService.getMstockJwtToken();
        } catch (e: any) {
            console.error("[RADAR] MStock Auth Failed. Skipping scan round. Reason:", e.message);
            return;
        }

        const apiKey = process.env.MSTOCK_API_KEY;
        if (!apiKey) {
            console.error("[RADAR] MSTOCK_API_KEY missing. Skipping scan round.");
            return;
        }

        const { fromDateStr, toDateStr } = this.getPast5MinWindow();
        console.log(`[SCANNER] Target timeframe processing blocks: ${fromDateStr} to ${toDateStr}`);

        const newRadarResults = [...this.radarResults];
        const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

        for (const sym of INTRADAY_STOCKS) {
            const cleanSym = sym.replace('.NS', '');
            const token = INTRADAY_TOKEN_MAP[cleanSym] || MstockService.getEqTokenOnlySync(cleanSym);
            if (!token) continue;

            try {
                const response = await axios({
                    method: 'get',
                    url: 'https://api.mstock.trade/openapi/typeb/instruments/historical',
                    headers: {
                        'X-Mirae-Version': '1',
                        'Authorization': `Bearer ${sessionToken}`,
                        'X-PrivateKey': apiKey,
                        'Content-Type': 'application/json',
                        'X-ClientLocalIP': '127.0.0.1',
                        'X-ClientPublicIP': '127.0.0.1',
                        'X-MACAddress': '00:00:00:00:00:00'
                    },
                    data: {
                        exchange: 'NSE',
                        symboltoken: token,
                        interval: 'FIVE_MINUTE',
                        fromdate: fromDateStr,
                        todate: toDateStr
                    }
                });
                
                // 1. Loosen the type restriction to check for both boolean true or string "true"
                const isStatusSuccess = response.data?.status === true || response.data?.status === "true";

                if (isStatusSuccess && response.data?.data) {
                    const candles = response.data.data.candles;
                    
                    // Check if candles array exists and has elements
                    if (Array.isArray(candles) && candles.length > 0) {
                        const targetCandle = candles[candles.length - 1]; // Pull the targeted closed window block
                        
                        const recent5mVol = Number(targetCandle[5]) || 0; 
                        const ltp = Number(targetCandle[4]) || 0;         
                        const openPrice = Number(targetCandle[1]) || 0;

                        const avg400 = this.avg5mVolumes[cleanSym] || 0;
                        const targetVolume = avg400 * this.multiplier;

                        const isPositiveChange = ltp > openPrice;

                        console.log(`[RADAR-MATH] ${cleanSym} -> 5mVol: ${recent5mVol}, Threshold: ${targetVolume} (Avg400: ${avg400})`);

                        if (avg400 > 0 && recent5mVol > targetVolume) {
                            console.log(`[ALERT] 🔥 breakout anomaly spotted on ${cleanSym}! Volume breached limit.`);
                            this.updateRadarList(newRadarResults, cleanSym, ltp, avg400, recent5mVol);

                            // Auto Trade execution block
                            if (isPositiveChange) {
                                const targetPrice = ltp * 1.04;
                                const slPrice = ltp * 0.98;
                                MstockService.placeEquityBracketOrder(sym, 1, ltp, slPrice, targetPrice)
                                   .then(orderId => console.log(`[AUTO-TRADE] Placed BO for ${sym} (ID: ${orderId})`))
                                   .catch(err => console.error(`[AUTO-TRADE] Failed BO for ${sym}:`, err.message));
                            }
                        }
                    } else {
                        console.log(`[RADAR-EMPTY] ${cleanSym} query worked, but returned no candles [] for this specific time box.`);
                    }
                } else {
                    console.error(`[RADAR-ERROR] MStock completely rejected ${cleanSym}. Raw Response Data:`, JSON.stringify(response.data));
                }
            } catch (err: any) {
                // Per ticker fallback container
            }
            await delay(100);
        }

        this.radarResults = newRadarResults;
        console.log(`[RADAR] Execution complete. Current matching anomaly alerts count: ${this.radarResults.length}`);
    }

    /**
     * Helper to insert or update entries in the radar collection
     */
    private static updateRadarList(resultsArray: VolumeRadarItem[], cleanSym: string, ltp: number, avg400: number, recentVol: number) {
        const existingIdx = resultsArray.findIndex(r => r.symbol === cleanSym);
        const radarItem: VolumeRadarItem = {
            symbol: cleanSym,
            ltp: ltp,
            avg5mVol400: avg400,
            latest5mVol: recentVol,
            timestamp: Date.now()
        };

        if (existingIdx !== -1) {
            resultsArray[existingIdx] = radarItem;
        } else {
            resultsArray.push(radarItem);
        }
    }

    /**
     * Loops indefinitely every 5 minutes synchronizing directly onto closed wall-clock blocks
     */
    private static scheduleNextScan() {
        if (!this.isRunning) return;

        const now = new Date();
        const minutesToNextInterval = 5 - (now.getMinutes() % 5);
        let msToNextInterval = (minutesToNextInterval * 60 * 1000) - (now.getSeconds() * 1000) - now.getMilliseconds();
        
        // 2-second extraction delay buffer ensures data aggregation has wrapped up cleanly inside MStock's cluster
        msToNextInterval += 2000; 

        console.log(`[SCHEDULER] Next precise tracking round scheduled in ${(msToNextInterval / 1000).toFixed(1)} seconds.`);

        this.timeoutId = setTimeout(async () => {
            await this.runScanRound();
            this.scheduleNextScan(); // Recurse loop configuration
        }, msToNextInterval);
    }

    /**
     * External Control Interface
     */
    public static async start() {
        if (this.isRunning) return;
        if (Object.keys(this.avg5mVolumes).length === 0) {
            const loaded = this.loadBaselinesFromFile();
            if (!loaded) {
                console.error("[RADAR] Run `initializeHistoricalAverages()` first.");
                return;
            }
        }

        this.isRunning = true;
        console.log("[RADAR] Core loop activated.");
        
        // Fire off first pass immediately upon activation, then start clock-aligned loop schedules
        await this.runScanRound();
        this.scheduleNextScan();
    }

    public static stop() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        this.isRunning = false;
        console.log("[RADAR] Engine halted.");
    }

    public static setMultiplier(val: number) {
        this.multiplier = val;
    }
}
