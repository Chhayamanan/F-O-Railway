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

export class VolumeRadarScanner {
    public static isRunning = false;
    public static intervalId: any = null;
    public static avg5mVolumes: Record<string, number> = {};
    public static lastCumulativeVolumes: Record<string, number> = {};
    public static radarResults: VolumeRadarItem[] = [];
    public static lastScanTime: number = 0;
    public static threshold: number = 10000;

    static loadAverages() {
        const dir = path.join(process.cwd(), 'historical_data_5m');
        if (!fs.existsSync(dir)) {
            console.log("[RADAR 5M] No historical data directory found. Run export first.");
            return;
        }

        const files = fs.readdirSync(dir);
        let loadedCount = 0;

        for (const file of files) {
            if (file.endsWith('_5m.json')) {
                const sym = file.replace('_5m.json', '');
                try {
                    const content = fs.readFileSync(path.join(dir, file), 'utf-8');
                    const data = JSON.parse(content);
                    if (Array.isArray(data) && data.length > 0) {
                        const last400 = data.slice(-400);
                        const sum = last400.reduce((acc, curr) => acc + (curr.volume || 0), 0);
                        const avg = Math.round(sum / last400.length);
                        this.avg5mVolumes[sym] = avg;
                        loadedCount++;
                    }
                } catch(e) {
                    console.error(`[RADAR 5M] Failed to parse ${file}`);
                }
            }
        }
        console.log(`[RADAR 5M] Loaded 400-period 5m volume averages for ${loadedCount} stocks.`);
    }

    static async runScanRound(isInitialBaseline = false) {
        this.lastScanTime = Date.now();
        console.log(`[RADAR 5M] Running 5-min volume scan (Baseline: ${isInitialBaseline})...`);

        // Get current prices and cumulative volumes
        let liveData: any = {};
        try {
            const CHUNK_SIZE = 50;
            for (let i = 0; i < RAW_UNIVERSE.length; i += CHUNK_SIZE) {
                const chunk = RAW_UNIVERSE.slice(i, i + CHUNK_SIZE);
                let chunkData = {};
                try {
                    chunkData = await MstockService.getCurrentPrices(chunk);
                } catch(e) {
                    chunkData = await YahooService.getCurrentPrices(chunk);
                }
                liveData = { ...liveData, ...chunkData };
            }
        } catch(e) {
            console.log("[RADAR 5M] Fetch failed", e);
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
                continue;
            }

            const lastCumVol = this.lastCumulativeVolumes[sym];
            if (lastCumVol !== undefined && currentCumVol >= lastCumVol) {
                const recent5mVol = currentCumVol - lastCumVol;
                const avg400 = this.avg5mVolumes[cleanSym] || 0;

                // Threshold Check: The user specified "if its more than 10000"
                // Additionally, we might only care if it exceeds average by some margin, but let's stick to threshold
                if (recent5mVol > this.threshold) {
                    const existingIdx = newRadarResults.findIndex(r => r.symbol === cleanSym);
                    const radarItem: VolumeRadarItem = {
                        symbol: cleanSym,
                        ltp: ltp,
                        avg5mVol400: avg400,
                        latest5mVol: recent5mVol,
                        timestamp: Date.now()
                    };
                    
                    if (existingIdx !== -1) {
                        newRadarResults[existingIdx] = radarItem;
                    } else {
                        newRadarResults.push(radarItem);
                    }
                }
            }
            // Update baseline for next 5 mins
            this.lastCumulativeVolumes[sym] = currentCumVol;
        }

        if (!isInitialBaseline) {
            this.radarResults = newRadarResults;
            console.log(`[RADAR 5M] Found ${this.radarResults.length} stocks exceeding ${this.threshold} 5m volume.`);
        }
    }

    static start() {
        if (this.isRunning) return;
        this.isRunning = true;
        
        if (Object.keys(this.avg5mVolumes).length === 0) {
            this.loadAverages();
        }

        // 1. Snapshot cumulative volume initially
        this.runScanRound(true);

        // 2. Schedule every 5 mins exactly
        this.intervalId = setInterval(() => {
            this.runScanRound(false);
        }, 5 * 60 * 1000);
    }

    static stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        console.log("[RADAR 5M] Scanner stopped.");
    }

    static setThreshold(val: number) {
        this.threshold = val;
    }
}
