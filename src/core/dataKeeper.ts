import fs from 'fs/promises';
import path from 'path';
import { YahooService } from '../services/yahooService';
import { RAW_UNIVERSE } from '../services/marketDataService';

const CACHE_FILE = path.join(process.cwd(), 'market_cache.json');

export interface CachedStockData {
  high180d: number;
  low180d: number;
  avgVol180d: number;
  lastUpdated: number;
}

export class DataKeeper {
  private static cache: Record<string, CachedStockData> | null = null;

  static async init() {
    try {
      const data = await fs.readFile(CACHE_FILE, 'utf8');
      this.cache = JSON.parse(data);
    } catch (e) {
      this.cache = {};
    }
  }

  static async saveCache() {
    if (this.cache) {
      await fs.writeFile(CACHE_FILE, JSON.stringify(this.cache, null, 2));
    }
  }

  static async getCache() {
    if (!this.cache) await this.init();
    return this.cache;
  }

  static async syncAllStocks() {
    if (!this.cache) await this.init();

    // 1. Transform clean names into explicit Yahoo Tickers (appending .NS)
    const uniqueUniverse = Array.from(new Set(RAW_UNIVERSE));
    const targetSymbols = uniqueUniverse.map(symbol => 
      symbol.endsWith('.NS') || symbol.startsWith('^') || symbol.endsWith('.BO') ? symbol : `${symbol}.NS`
    );

    console.log(`[DATA KEEPER] Memory-safe sync for ${targetSymbols.length} unique targets...`);
    
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;

    for (let i = 0; i < targetSymbols.length; i++) {
        const symbol = targetSymbols[i];
        
        const existing = this.cache![symbol];
        if (existing && (Date.now() - existing.lastUpdated < TWELVE_HOURS)) {
          continue; // Skips instantly, zero memory overhead
        }

        try {
          const data = await YahooService.get180DayData(symbol);
          
          if (data && data.length > 0) {
            let maxHigh = 0;
            let minLow = Infinity;
            let totalVol = 0;
            let validDays = 0;
            
            for (const day of data) {
              if (day.high) maxHigh = Math.max(maxHigh, day.high);
              if (day.low) minLow = Math.min(minLow, day.low);
              if (day.volume) {
                totalVol += day.volume;
                validDays++;
              }
            }
            
            this.cache![symbol] = {
              high180d: maxHigh,
              low180d: minLow === Infinity ? 0 : minLow,
              avgVol180d: validDays > 0 ? totalVol / validDays : 0,
              lastUpdated: Date.now()
            };
          }
        } catch (error) {
          console.error(`[DATA KEEPER] Fetch skipped/failed for ${symbol}`);
        }

        // Pacing window per single stock to prevent rate-limiting AND let memory clear out
        await new Promise(res => setTimeout(res, 250));
        
        // Save to disk incrementally every 10 stocks so you never lose progress if killed
        if (i % 10 === 0 && i !== 0) {
          console.log(`[DATA KEEPER] Safely committed progress: ${i}/${targetSymbols.length}`);
          await this.saveCache();
        }
    }
    
    await this.saveCache();
    console.log('[DATA KEEPER] Sequential Memory-Safe Sync Complete.');
  }

  static getStockData(symbol: string): CachedStockData | null {
    if (!this.cache) return null;
    const formattedSymbol = symbol.endsWith('.NS') ? symbol : `${symbol}.NS`;
    return this.cache[formattedSymbol] || null;
  }
}
