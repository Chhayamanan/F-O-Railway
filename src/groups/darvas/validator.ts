import { StockCandidate } from "../../models/stock";
import { BuySignal } from "../../models/signal";
import { YahooService } from "../../services/yahooService";
import { MstockService } from "../../services/mstockService";
import { SETTINGS } from "../../config/settings";

export class DarvasValidator {
  static async validate(stocks: StockCandidate[], multiplierOverride?: number): Promise<{ 
    signals: BuySignal[], 
    liveMetrics: Record<string, { price: number, volume: number, ratio: number, dailyChange: number, distFromHigh: number }> 
  }> {
    const signals: BuySignal[] = [];
    const liveMetrics: Record<string, { price: number, volume: number, ratio: number, dailyChange: number, distFromHigh: number }> = {};
    
    if (stocks.length === 0) return { signals: [], liveMetrics: {} };

    try {
      const symbols = stocks.map(s => s.symbol);
      let liveQuotes = await MstockService.getCurrentPrices(symbols);
      
      if (Object.keys(liveQuotes).length === 0 && symbols.length > 0) {
         liveQuotes = await YahooService.getCurrentPrices(symbols);
      }

      for (const stock of stocks) {
        const live = liveQuotes[stock.symbol];
        if (!live) continue;

        const currentVolume = live.volume || 0;
        const currentPrice = live.price || 0;

        const multiplier = multiplierOverride || Number(SETTINGS.VOLUME_MULTIPLIER) || 1;
        const avgVol = Number(stock.avgVolume90d) || 0;
        
        if (avgVol <= 0) continue;

        const ratio = currentVolume / avgVol;
        const dailyChange = stock.dailyChange !== undefined ? ((currentPrice - (stock.currentPrice / (1 + (stock.dailyChange/100)))) / (stock.currentPrice / (1 + (stock.dailyChange/100)))) * 100 : 0;
        // Simplified dist from high calculation based on original historical high
        const distFromHigh = stock.boxHigh > 0 ? Math.max(0, ((stock.boxHigh - currentPrice) / stock.boxHigh) * 100) : 0;

        liveMetrics[stock.symbol] = { price: currentPrice, volume: currentVolume, ratio, dailyChange, distFromHigh };

        const volumeCondition = ratio >= multiplier;
        const breakoutCondition = currentPrice >= stock.boxHigh;

        if (volumeCondition && breakoutCondition) {
          signals.push({
            symbol: stock.symbol,
            entry: currentPrice,
            currentVolume,
            avgVolume: avgVol,
            volumeRatio: ratio,
            breakoutLevel: stock.boxHigh
          });
        }
      }
    } catch (err) {
      console.error(`Error validating stocks:`, err);
    }
    
    return { signals, liveMetrics };
  }
}
