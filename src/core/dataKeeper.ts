import fs from 'fs/promises';
import path from 'path';
import { YahooService } from '../services/yahooService';
import { RAW_UNIVERSE } from '../services/marketDataService';

const CACHE_FILE = path.join(process.cwd(), 'market_cache.json');

export interface CachedStockData {
  high90d: number;
  low90d: number;
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

  static async syncAllStocks() {
    if (!this.cache) await this.init();

    // 1. Transform clean names into explicit Yahoo Tickers (appending .NS)
    const targetSymbols = RAW_UNIVERSE.map(symbol => 
      symbol.endsWith('.NS') || symbol.startsWith('^') || symbol.endsWith('.BO') ? symbol : `${symbol}.NS`
    );

    console.log(`[DATA KEEPER] Strictly syncing ${targetSymbols.length} stocks from universe...`);
    
    // Keeping a safe chunk size to avoid Yahoo's aggressive blocks
    const CHUNK_SIZE = 4; 
    
    for (let i = 0; i < targetSymbols.length; i += CHUNK_SIZE) {
      const chunk = targetSymbols.slice(i, i + CHUNK_SIZE);
      
      await Promise.all(chunk.map(async (symbol) => {
        try {
          const data = await YahooService.get90DayData(symbol);
          
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
              high90d: maxHigh,
              low90d: minLow === Infinity ? 0 : minLow,
              avgVol90d: validDays > 0 ? totalVol / validDays : 0,
              lastUpdated: Date.now()
            };
          }
        } catch (error) {
          console.error(`[DATA KEEPER] Fetch skipped/failed for ${symbol}`);
        }
      }));
      
      // Mandatory pacing window to stop Yahoo from dropping the connection
      await new Promise(res => setTimeout(res, 800));
      
      if (i % 12 === 0 && i !== 0) {
        console.log(`[DATA KEEPER] Synced ${i}/${targetSymbols.length} targets...`);
        await this.saveCache(); // Incremental saves
      }
    }
    
    await this.saveCache();
    console.log('[DATA KEEPER] Full Universe Sync Complete.');
  }

  static getStockData(symbol: string): CachedStockData | null {
    if (!this.cache) return null;
    const formattedSymbol = symbol.endsWith('.NS') ? symbol : `${symbol}.NS`;
    return this.cache[formattedSymbol] || null;
  }
}
