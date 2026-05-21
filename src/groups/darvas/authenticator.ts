import { BuySignal } from "../../models/signal";
import { YahooService } from "../../services/yahooService";
import { SETTINGS } from "../../config/settings";
import { DataKeeper } from "../../core/dataKeeper";

export class DarvasAuthenticator {
  static async authenticate(signal: BuySignal, multiplierOverride?: number) {
    try {
      const multiplier = multiplierOverride || Number(SETTINGS.VOLUME_MULTIPLIER);
      const validVolume = signal.currentVolume > signal.avgVolume * multiplier;
      
      // We use DataKeeper cached history to check the box range and breakout against the absolute high
      const candles = await DataKeeper.getData(signal.symbol);
      if (!candles || candles.length === 0) return { authenticated: false };

      const highs = candles.map((c: any) => c.high || 0);
      const lows = candles.map(c => c.low || 0).filter(l => l > 0);
      const high = Math.max(...highs);
      const low = lows.length > 0 ? Math.min(...lows) : 0;

      const range = low > 0 ? ((high - low) / low) * 100 : Infinity;
      const validRange = range <= Number(SETTINGS.BOX_RANGE_LIMIT);
      const isRecordHigh = signal.entry >= high * 0.99; // Within 1% of absolute high

      if (validRange && validVolume && isRecordHigh) {
        return { authenticated: true, confidence: 95, signal };
      } else {
        const reason = `Range (${range.toFixed(2)}% <= ${SETTINGS.BOX_RANGE_LIMIT}%)? ${validRange}, Vol (${signal.currentVolume} > ${signal.avgVolume * multiplier})? ${validVolume}, Breakout (${signal.entry} >= ${high * 0.99})? ${isRecordHigh}`;
        console.log(`[AUTH FAILED] ${signal.symbol}: ${reason}`);
        return { authenticated: false, reason };
      }
    } catch (err) {
      console.error(`Error authenticating ${signal.symbol}:`, err);
    }
    return { authenticated: false, reason: "Error in authentication check" };
  }
}
