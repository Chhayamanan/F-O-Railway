import { Trade } from "../models/trade";
import { MstockService } from "./mstockService";
import * as fs from 'fs';
import * as path from 'path';

export class BrokerService {
  /**
   * Same-day deduplication guard (Req 2).
   * executedToday stores symbols bought in the current calendar day.
   * It resets automatically when lastDate rolls over to a new day.
   */
  private static executedToday: Set<string> = new Set();
  private static lastDate: string = new Date().toDateString();
  private static cacheFile = path.resolve(process.cwd(), 'executed_trades_cache.json');

  private static loadCache() {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const data = fs.readFileSync(this.cacheFile, 'utf8');
        const parsed = JSON.parse(data);
        if (parsed.lastDate === this.lastDate && Array.isArray(parsed.executedToday)) {
          this.executedToday = new Set(parsed.executedToday);
        }
      }
    } catch (e) {
      console.warn("Could not load trades cache.", e);
    }
  }

  private static saveCache() {
    try {
      const data = {
        lastDate: this.lastDate,
        executedToday: Array.from(this.executedToday)
      };
      fs.writeFileSync(this.cacheFile, JSON.stringify(data), 'utf8');
    } catch (e) {
      console.warn("Could not save trades cache.", e);
    }
  }

  static async executeBuy(
    symbol: string,
    entry: number,
    quantity: number = 1
  ): Promise<Trade | null> {
    const today = new Date().toDateString();
    
    // Lazy load cache if it's empty
    if (this.executedToday.size === 0) {
      this.loadCache();
    }
    
    // Reset cache if it's a new day
    if (today !== this.lastDate) {
      this.executedToday.clear();
      this.lastDate = today;
      this.saveCache();
    }

    if (this.executedToday.has(symbol)) {
      console.log(`[BROKER] Skipping ${symbol} - Already traded today.`);
      return null;
    }

    console.log(`[BROKER] Requesting BUY ${symbol} @ ${entry} QTY: ${quantity}`);
    const orderId = await MstockService.placeOrder(symbol, quantity, entry).catch(e => e.message);

    // Add to executed cache ANYWAY to prevent spamming the broker with the same failed order every minute
    this.executedToday.add(symbol);
    this.saveCache();

    if (orderId && typeof orderId === 'string' && !orderId.startsWith("FAILED") && !orderId.startsWith("ERROR") && !orderId.includes("Failed")) {
      console.log(`[BROKER] Trade successful for ${symbol}: ${orderId}`);
    } else {
      console.log(`[BROKER] Trade failed for ${symbol}: ${orderId}`);
      throw new Error(`Broker API: ${orderId}`);
    }

    return {
      symbol,
      entry,
      quantity,
      orderId: orderId,
      timestamp: new Date().toISOString()
    };
  }
}
