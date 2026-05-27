import { RAW_UNIVERSE } from '../services/marketDataService';
import { MstockService } from '../services/mstockService';
import { YahooService } from '../services/yahooService';
import fs from 'fs';
import path from 'path';

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
     * Now includes NaN filtering and automatic downloadable JSON generation.
     */
    public static async initializeHistoricalAverages() {
        console.log("[RADAR] Fetching 400-period 5m historical baselines...");
        let loadedCount = 0;
        const exportData: BaselineExportItem[] = [];
        const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

        for (const sym of RAW_UNIVERSE) {
            const cleanSym = sym.replace('.NS', '');
            try {
                const history = await YahooService.get5MinData(sym, 14); // use 14 days back since yahoo limits depending on range
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
            } catch (e) {
                // Handle or log error silently per ticker
            }
            await delay(200);
        }
        console.log(`[RADAR] Loaded baselines for ${loadedCount}/${RAW_UNIVERSE.length} stocks.`);
        
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
     * Helper to verify if the exchange is actively operating live continuous trading.
     */
    private static isLiveMarketHours(): boolean {
        const now = new Date();
        const day = now.getDay();
        if (day === 0 || day === 6) return false; // Weekend

        const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
        return minutesSinceMidnight >= 555 && minutesSinceMidnight <= 930; // 9:15 AM - 3:30 PM
    }

    /**
     * Utility to calculate the exact fromdate and todate for the last completed 5m candle.
     * Example: 09:28:35 becomes fromdate: "09:20" and todate: "09:25"
     */
    private static getPast5MinWindow(): { fromDateStr: string; toDateStr: string } {
        const now = new Date();
        
        // 1. Drop down to the start of the current 5-minute block (e.g., 9:28 -> 9:25)
        const currentBlockMin = Math.floor(now.getMinutes() / 5) * 5;
        
        const toDate = new Date(now);
        toDate.setMinutes(currentBlockMin, 0, 0); // Sets to 09:25:00
        
        // 2. Subtract 5 full minutes to get the beginning of that candle block (e.g., 09:20:00)
        const fromDate = new Date(toDate);
        fromDate.setMinutes(fromDate.getMinutes() - 5); 

        // 3. Format strictly to 'YYYY-MM-DD HH:mm' as specified in MStock cURL
        const format = (d: Date) => {
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const hh = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
        };

        return {
            fromDateStr: format(fromDate),
            toDateStr: format(toDate)
        };
    }

    /**
     * CORE ROUTER: Decides whether to run a live scan or an after-hours static scan.
     */
    private static async executeScan(isInitialBaseline = false) {
        this.lastScanTime = Date.now();
        if (this.isLiveMarketHours()) {
            await this.runLiveScan(isInitialBaseline);
        } else {
            console.log("[RADAR] After-Market Hours detected. Running historical candle parsing...");
            await this.runAfterHoursScan();
        }
    }

    /**
     * MODE A: Live Scan Engine (Uses MStock historical candles)
     */
    private static async runLiveScan(isInitialBaseline = false) {
        console.log(`[RADAR] Starting MStock historical candle scan...`);
        let sessionToken = null;
        try {
            sessionToken = await MstockService.getMstockJwtToken();
        } catch (e: any) {
            console.error("[RADAR] MStock Auth Failed. Skipping live scan. Reason:", e.message);
            return;
        }

        const apiKey = process.env.MSTOCK_API_KEY;
        if (!apiKey) {
            console.error("[RADAR] MSTOCK_API_KEY missing. Skipping live scan.");
            return;
        }

        // Get dynamically rounded structural times (e.g., 9:20 and 9:25)
        const { fromDateStr, toDateStr } = this.getPast5MinWindow();
        console.log(`[RADAR] Fetching historical candle frame between: ${fromDateStr} -> ${toDateStr}`);

        const newRadarResults = [...this.radarResults];
        const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

        for (const sym of RAW_UNIVERSE) {
            const cleanSym = sym.replace('.NS', '');
            const token = MstockService.getEqTokenOnlySync(cleanSym);

            if (!token) {
                // Wait briefly between misses to avoid spamming the log if lots of tokens are missing
                continue;
            }

            if (isInitialBaseline) {
                // If it's an initial baseline snapshot, we just skip execution as there are no valid previous prices
                continue; 
            }

            try {
                const axios = require('axios');
                const response = await axios({
                    method: 'get',
                    url: 'https://api.mstock.trade/openapi/typeb/instruments/historical',
                    headers: {
                        'X-Mirae-Version': '1',
                        'Authorization': `Bearer ${sessionToken}`,
                        'X-PrivateKey': apiKey,
                        'Content-Type': 'application/json'
                    },
                    data: {
                        exchange: 'NSE',
                        symboltoken: token,
                        interval: 'FIVE_MINUTE', 
                        fromdate: fromDateStr,
                        todate: toDateStr
                    }
                });

                if (response.data?.status === "true" && response.data?.data?.candles) {
                    const candles = response.data.data.candles;
                    
                    if (candles.length > 0) {
                        const targetCandle = candles[0]; 
                        const recent5mVol = Number(targetCandle[5]) || 0; 
                        const ltp = Number(targetCandle[4]) || 0;         
                        const openPrice = Number(targetCandle[1]) || 0;

                        const avg400 = this.avg5mVolumes[cleanSym] || 0;
                        const targetVolume = avg400 * this.multiplier;

                        const isPositiveChange = ltp > openPrice;

                        if (avg400 > 0 && recent5mVol > targetVolume) {
                            this.updateRadarList(newRadarResults, cleanSym, ltp, avg400, recent5mVol);

                            // Auto Trade execution (1 share intraday BUY with 4% target, 2% SL)
                            if (isPositiveChange) {
                                const targetPrice = ltp * 1.04;
                                const slPrice = ltp * 0.98;
                                MstockService.placeEquityBracketOrder(sym, 1, ltp, slPrice, targetPrice)
                                   .then(orderId => console.log(`[AUTO-TRADE] Placed BO for ${sym} (ID: ${orderId}) targets 4%, SL 2%`))
                                   .catch(err => console.error(`[AUTO-TRADE] Failed BO for ${sym}. Reason:`, err.message));
                            }
                        }
                    }
                }

            } catch (error: any) {
                // Console error per token might be too spammy if 500 requests fail, we log quietly
            }
            await delay(100); // Prevent API rate limit per the user's past examples
        }

        if (!isInitialBaseline) {
            this.radarResults = newRadarResults;
            console.log(`[RADAR] Live Scan complete. Active alerts: ${this.radarResults.length}`);
        }
    }

    /**
     * MODE B: After-Hours Scan Engine (Queries Yahoo 5m candles directly)
     * Walks backwards through the evening's final candles to find matches.
     */
    private static async runAfterHoursScan() {
        const newRadarResults = [...this.radarResults];
        const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

        console.log("[RADAR] Analyzing latest closed 5-minute segments from today's session...");

        for (const sym of RAW_UNIVERSE) {
            const cleanSym = sym.replace('.NS', '');
            try {
                // Fetch the most recent day's intraday bars
                const history = await YahooService.get5MinData(sym, 1);
                if (!Array.isArray(history) || history.length === 0) continue;

                // Grab the very last closed candle
                const latestClosedCandle = history[history.length - 1]; 
                const recent5mVol = latestClosedCandle?.volume || 0;
                const ltp = latestClosedCandle?.close || 0;

                const avg400 = this.avg5mVolumes[cleanSym] || 0;
                const targetVolume = avg400 * this.multiplier;

                if (avg400 > 0 && recent5mVol > targetVolume) {
                    this.updateRadarList(newRadarResults, cleanSym, ltp, avg400, recent5mVol);
                }
            } catch (e) {
                // Fail silently per asset
            }
            await delay(100); // Gentle throttle
        }

        this.radarResults = newRadarResults;
        console.log(`[RADAR] After-hours scan finalized. Total matching triggers found: ${this.radarResults.length}`);
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
     * Precision Time Schedulers
     */
    private static scheduleNextScan() {
        if (!this.isRunning) return;

        // Force a static 5-minute interval check if the market is closed
        if (!this.isLiveMarketHours()) {
            this.timeoutId = setTimeout(async () => {
                await this.executeScan(false);
                this.scheduleNextScan();
            }, 5 * 60 * 1000);
            return;
        }

        // Live market precise wall-clock synchronization
        const now = new Date();
        const minutesToNextInterval = 5 - (now.getMinutes() % 5);
        let msToNextInterval = (minutesToNextInterval * 60 * 1000) - (now.getSeconds() * 1000) - now.getMilliseconds();
        
        msToNextInterval += 2000; // 2-second data aggregation buffer

        this.timeoutId = setTimeout(async () => {
            await this.executeScan(false);
            this.scheduleNextScan();
        }, msToNextInterval);
    }

    /**
     * External Control Interface
     */
    public static async start() {
        if (this.isRunning) return;
        if (Object.keys(this.avg5mVolumes).length === 0) {
            console.error("[RADAR] Run `initializeHistoricalAverages()` first.");
            return;
        }

        this.isRunning = true;

        // If starting during live market, set up initial snapshot. 
        // If starting after hours, process the historical scan immediately.
        await this.executeScan(true);
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
