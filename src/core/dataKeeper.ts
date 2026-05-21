import fs from "fs/promises";
import path from "path";
import { YahooService } from "../services/yahooService";

const STORAGE_PATH = path.join(process.cwd(), "market_cache.json");

export interface CachedData {
  lastSync: number;
  data: Record<string, any>;
}

export class DataKeeper {
  private static memoryCache: CachedData | null = null;
  private static lastCacheLoad = 0;

  static async fetchAndStore(symbols: string[]) {
    // Unique symbols only
    const uniqueSymbols = [...new Set(symbols)];
    console.log(`[DATA KEEPER] Starting synchronization for ${uniqueSymbols.length} unique symbols...`);
    
    const currentCache = await this.readCache();

    const cache: CachedData = {
      lastSync: Date.now(),
      data: currentCache?.data || {}
    };

    for (let i = 0; i < uniqueSymbols.length; i++) {
      const symbol = uniqueSymbols[i];
      let retries = 3;
      while (retries > 0) {
        try {
          const candles = await YahooService.get90DayData(symbol);
          if (candles && candles.length > 0) {
            cache.data[symbol] = candles;
            console.log(`[DATA KEEPER] Updated ${symbol} (${i + 1}/${uniqueSymbols.length})`);
            break; 
          } else {
            console.warn(`[DATA KEEPER] Empty data for ${symbol}, retrying...`);
            retries--;
            if (retries > 0) await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (err) {
          console.error(`[DATA KEEPER] Failed to fetch ${symbol}, retries left ${retries - 1}:`, err);
          retries--;
           if (retries > 0) await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      // Sleep between requests
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Save only once at the end to avoid massive I/O
    console.log(`[DATA KEEPER] Saving cache to disk...`);
    await fs.writeFile(STORAGE_PATH, JSON.stringify(cache));

    this.memoryCache = cache;
    this.lastCacheLoad = Date.now();

    console.log(`[DATA KEEPER] Synchronization complete.`);
    return cache;
  }

  static async getData(symbol: string) {
    const cache = await this.readCache();
    if (!cache || !cache.data[symbol]) return null;
    
    return cache.data[symbol];
  }

  static async getIntradayData(symbol: string) {
    // Intraday Data removed per request
    return null;
  }

  static async getLastSyncTime() {
    const cache = await this.readCache();
    return cache ? cache.lastSync : 0;
  }

  static async isCacheHealthy() {
    const lastSync = await this.getLastSyncTime();
    if (!lastSync) return false;
    
    const twelveHours = 12 * 60 * 60 * 1000;
    return (Date.now() - lastSync) < twelveHours;
  }

  static async getFullCache() {
    return this.readCache();
  }

  static async getFullIntradayCache() {
    return { data: {}, lastSync: 0 };
  }

  private static async readCache(): Promise<CachedData | null> {
    const now = Date.now();
    if (this.memoryCache && (now - this.lastCacheLoad < 60000)) return this.memoryCache;
    try {
      const content = await fs.readFile(STORAGE_PATH, "utf-8");
      this.memoryCache = JSON.parse(content);
      this.lastCacheLoad = now;
      return this.memoryCache;
    } catch (err) {
      return null;
    }
  }
}
