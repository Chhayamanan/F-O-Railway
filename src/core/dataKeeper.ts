import fs from 'fs/promises';
import path from 'path';
import { YahooService } from '../services/yahooService';

const CACHE_FILE = path.join(process.cwd(), 'market_cache.json');

export interface CachedStockData {
  high90d: number;
  avgVol90d: number;
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

  static async syncStockData(symbols: string[]) {
    if (!this.cache) await this.init();

    console.log(`[DATA KEEPER] Syncing data for ${symbols.length} stocks...`);
    for (const symbol of symbols) {
      const data = await YahooService.get90DayData(symbol);
      if (data && data.length > 0) {
        let maxHigh = 0;
        let totalVol = 0;
        let validDays = 0;
        
        for (const day of data) {
          if (day.high) maxHigh = Math.max(maxHigh, day.high);
          if (day.volume) {
            totalVol += day.volume;
            validDays++;
          }
        }
        
        const avgVol = validDays > 0 ? totalVol / validDays : 0;
        
        this.cache![symbol] = {
          high90d: maxHigh,
          avgVol90d: avgVol,
          lastUpdated: Date.now()
        };
      }
      
      // Delay to avoid Yahoo rate limits
      await new Promise(res => setTimeout(res, 100));
    }
    
    await this.saveCache();
    console.log('[DATA KEEPER] Sync Complete.');
  }

  static getStockData(symbol: string): CachedStockData | null {
    if (!this.cache) return null;
    return this.cache[symbol] || null;
  }
}
