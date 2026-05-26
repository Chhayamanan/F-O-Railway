import { RAW_UNIVERSE } from '../services/marketDataService';
import { MstockService } from '../services/mstockService';
import { YahooService } from '../services/yahooService';

export interface VolumeRadarItem {
    symbol: string;
    ltp: number;
    avg5mVol400: number;
    latest5mVol: number;
    timestamp: number;
}

export class VolumeRadarScanner {
    public static isRunning = false;
    public static intervalId: any = null;
    public static avg5mVolumes: Record<string, number> = {};
    public static lastCumulativeVolumes: Record<string, number> = {};
    public static radarResults: VolumeRadarItem[] = [];
    public static lastScanTime: number = 0;
    public static multiplier: number = 10;

    /**
     * STEP 1: Manual Trigger (Once a day)
     * Fetches historical 5-minute interval data from Yahoo Finance 
     * to calculate the 400-period average volume baseline.
     */
    public static async initializeHistoricalAverages() {
        console.log("[RADAR] Initializing historical 400-period averages from Yahoo Finance...");
        let loadedCount = 0;

        for (let i = 0; i < RAW_UNIVERSE.length; i++) {
            const sym = RAW_UNIVERSE[i];
            const cleanSym = sym.replace('.NS', '');
            try {
                // Fetch historical 5m data from Yahoo
                const history = await YahooService.get5MinData(sym, 14); // 14 days should give enough 5m candles (>400)
                
                if (Array.isArray(history) && history.length > 0) {
                    const last400 = history.slice(-400);
                    const sum = last400.reduce((acc: number, curr: any) => acc + (curr.volume || 0), 0);
                    const avg = Math.round(sum / last400.length);
                    
                    this.avg5mVolumes[cleanSym] = avg;
                    loadedCount++;
                }
            } catch (e) {
                console.error(`[RADAR] Failed to fetch Yahoo history for ${sym}:`, e);
            }
            
            // throttle to prevent rate limit
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        console.log(`[RADAR] Successfully calculated baselines for ${loadedCount}/${RAW_UNIVERSE.length} stocks.`);
    }

    /**
     * STEP 2 & 3: Live Scanner Round
     * Uses strictly MStock API to calculate current 5-minute volume deltas.
     */
    private static async runLiveScan(isInitialBaseline = false) {
        this.lastScanTime = Date.now();
        console.log(`[RADAR] Executing live MStock scan (Baseline snapshot: ${isInitialBaseline})...`);
        
        let liveData: any = {};
        try {
            liveData = await MstockService.getCurrentPrices(RAW_UNIVERSE);
            if (!liveData || Object.keys(liveData).length === 0) {
                throw new Error("MStock returned empty live data");
            }
        } catch (e) {
            console.error("[RADAR] Critical Error: MStock live fetch failed.", e);
            return; // No fallback to Yahoo for live data per requirement
        }

        const newRadarResults = [...this.radarResults];

        for (const sym of RAW_UNIVERSE) {
            const cleanSym = sym.replace('.NS', '');
            const item = liveData[sym] || liveData[cleanSym];
            if (!item) continue;

            const currentCumVol = item.volume || 0;
            const ltp = item.price || 0;

            // If it's the very first tick after starting, just establish the baseline volume
            if (isInitialBaseline) {
                this.lastCumulativeVolumes[sym] = currentCumVol;
                continue;
            }

            const lastCumVol = this.lastCumulativeVolumes[sym];
            if (lastCumVol !== undefined && currentCumVol >= lastCumVol) {
                const recent5mVol = currentCumVol - lastCumVol;
                const avg400 = this.avg5mVolumes[cleanSym] || 0;

                // Radar Logic Check
                const targetVolume = avg400 * this.multiplier;
                if (avg400 > 0 && recent5mVol > targetVolume) {
                    const existingIdx = newRadarResults.findIndex(r => r.symbol === cleanSym);
                    const radarItem: VolumeRadarItem = {
                        symbol: cleanSym,
                        ltp: ltp,
                        avg5mVol400: avg400,
                        latest5mVol: recent5mVol,
                        timestamp: Date.now()
                    };
                    
                    if (existingIdx !== -1) {
                        newRadarResults[existingIdx] = radarItem; // Update
                    } else {
                        newRadarResults.push(radarItem); // Add new anomaly
                    }
                }
            }
            
            // Save current total volume as the baseline for the next 5 minutes
            this.lastCumulativeVolumes[sym] = currentCumVol;
        }

        if (!isInitialBaseline) {
            this.radarResults = newRadarResults;
            console.log(`[RADAR] Scan complete. ${this.radarResults.length} assets currently in radar.`);
        }
    }

    /**
     * Starts the continuous 5-minute scanner execution loop.
     */
    public static async start() {
        if (this.isRunning) {
            console.log("[RADAR] Scanner is already running.");
            return;
        }

        if (Object.keys(this.avg5mVolumes).length === 0) {
            console.error("[RADAR] Cannot start yet, calculating historical baselines on fly...");
        }

        this.isRunning = true;

        // 1. Snapshot the initial volume using MStock immediately
        await this.runLiveScan(true);

        // 2. Keep it running every 5 minutes until explicitly stopped
        this.intervalId = setInterval(async () => {
            await this.runLiveScan(false);
        }, 5 * 60 * 1000);

        console.log("[RADAR] Continuous live 5-minute loop started.");
    }

    /**
     * Stops the loop execution.
     */
    public static stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        console.log("[RADAR] Live scanner stopped.");
    }

    public static setMultiplier(val: number) {
        this.multiplier = val;
    }
}
