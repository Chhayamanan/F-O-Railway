import { Trade } from "../models/trade";
import { BuySignal } from "../models/signal";
import { LoggerService } from "../services/loggerService";
import { SETTINGS } from "../config/settings";

export class TradeConfirmer {
  static async confirm(signal: BuySignal, trade?: Trade): Promise<{ approved: boolean; reason?: string; fundRequired?: number; quantity?: number }> {
    LoggerService.log(`[TradeConfirmer] Evaluating fund requirements for ${signal.symbol}`);
    
    const marginFactor = 100 / SETTINGS.MTF_MARGIN_PERCENT;
    const effectiveBudget = SETTINGS.ORDER_BUDGET * marginFactor;
    const quantity = Math.floor(effectiveBudget / signal.entry);
    const fundRequired = quantity * signal.entry;

    if (quantity < 1) {
      LoggerService.log(`[TradeConfirmer] Skipping ${signal.symbol} — quantity rounds to 0`);
      return { approved: false, reason: "Insufficient budget for 1 share" };
    }
    
    if (signal.entry > SETTINGS.MAX_STOCK_PRICE) {
      LoggerService.log(`[TradeConfirmer] Skipping ${signal.symbol} — price ₹${signal.entry} exceeds limit`);
      return { approved: false, reason: "Price exceeds limit" };
    }
    
    // Require CEO (User) Approval via UI. Return as approved by algorithmic check, 
    // but requires UI confirmation to execute.
    return {
      approved: true,
      fundRequired,
      quantity,
      reason: "Algorithmic checks passed. Pending manual CEO approval."
    };
  }
}
