import { BrokerService } from "../../services/brokerService";
import { SETTINGS } from "../../config/settings";

export class DarvasExecuter {
  static async execute(symbol: string, entry: number) {
    if (entry > SETTINGS.MAX_STOCK_PRICE) {
      console.log(`[EXECUTER] Skipping ${symbol} — price ₹${entry} exceeds limit`);
      return null;
    }
    const marginFactor = 100 / SETTINGS.MTF_MARGIN_PERCENT; // e.g. 2x for 50 %
    const effectiveBudget = SETTINGS.ORDER_BUDGET * marginFactor;
    const quantity = Math.floor(effectiveBudget / entry);
    if (quantity < 1) {
      console.log(`[EXECUTER] Skipping ${symbol} — quantity rounds to 0`);
      return null;
    }
    return await BrokerService.executeBuy(symbol, entry, quantity);
  }
}
