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
     * MODE A: Live Scan Engine (Uses MStock cumulative deltas)
     */
    private static async runLiveScan(isInitialBaseline = false) {
        console.log(`[RADAR] Live Scan triggered. (Baseline Snapshot: ${isInitialBaseline})`);
        let liveData: any = {};
        try {
            liveData = await MstockService.getCurrentPrices(RAW_UNIVERSE);
            if (!liveData || Object.keys(liveData).length === 0) return;
        } catch (e) {
            console.error("[RADAR] Live MStock API failed. Skipping round.");
            return;
        }

        const newRadarResults = [...this.radarResults];

        for (const sym of RAW_UNIVERSE) {
            const cleanSym = sym.replace('.NS', '');
            const item = liveData[sym] || liveData[cleanSym];
            if (!item) continue;

            const currentCumVol = item.volume || 0;
            const ltp = item.price || 0;

            if (isInitialBaseline) {
                this.lastCumulativeVolumes[sym] = currentCumVol;
                this.lastPrices[sym] = ltp;
                continue;
            }

            const lastCumVol = this.lastCumulativeVolumes[sym];
            const prevPrice = this.lastPrices[sym];
            
            if (lastCumVol !== undefined && currentCumVol >= lastCumVol) {
                const recent5mVol = currentCumVol - lastCumVol;
                const avg400 = this.avg5mVolumes[cleanSym] || 0;
                const targetVolume = avg400 * this.multiplier;

                // Positive price check
                const isPositiveChange = prevPrice !== undefined && ltp > prevPrice;

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
            this.lastCumulativeVolumes[sym] = currentCumVol;
            this.lastPrices[sym] = ltp;
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
