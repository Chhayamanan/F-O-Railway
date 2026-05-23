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
    
    // Increased chunk size slightly, but added explicit try/catch per symbol
    const CHUNK_SIZE = 8; 
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
      const chunk = symbols.slice(i, i + CHUNK_SIZE);
      
      await Promise.all(chunk.map(async (symbol) => {
        try {
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
            successCount++;
          } else {
            failCount++;
          }
        } catch (error) {
          // Captures individual fetch failures so the entire batch doesn't crash
          console.error(`[DATA KEEPER] Failed to process ${symbol}:`, error instanceof Error ? error.message : String(error));
          failCount++;
        }
      }));
      
      // Dynamic throttle: small break to respect rate limits
      await new Promise(res => setTimeout(res, 600));
      
      // Periodically save cache incrementally every 24 stocks so progress isn't lost
      if (i % 24 === 0 && i !== 0) {
        await this.saveCache();
        console.log(`[DATA KEEPER] Progress: Synced ${i}/${symbols.length} stocks...`);
      }
    }
    
    await this.saveCache();
    console.log(`[DATA KEEPER] Sync Complete. Success: ${successCount}, Failed: ${failCount}`);
  }

  static getStockData(symbol: string): CachedStockData | null {
    if (!this.cache) return null;
    return this.cache[symbol] || null;
  }
}
