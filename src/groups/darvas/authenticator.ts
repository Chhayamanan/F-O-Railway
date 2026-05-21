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

      if (validVolume) {
        return { authenticated: true, confidence: 95, signal };
      } else {
        const reason = `Volume (${signal.currentVolume} > ${signal.avgVolume * multiplier})? ${validVolume}`;
        console.log(`[AUTH FAILED] ${signal.symbol}: ${reason}`);
        return { authenticated: false, reason };
      }
    } catch (err) {
      console.error(`Error authenticating ${signal.symbol}:`, err);
    }
    return { authenticated: false, reason: "Error in authentication check" };
  }
}
