import { DataKeeper } from "../../core/dataKeeper";
import { YahooService } from "../../services/yahooService";
import { MstockService } from "../../services/mstockService";

export interface VolumeSpike {
  symbol: string;
  spikeVolume: number;
  avgVolume: number;
  ratio: number;
  priceChangePercent: number;
  time: string;
  todayHigh: number;
  todayLow: number;
  currentPrice: number;
}

export class VolumeSpikeScanner {
  static async scan(symbols: string[], factor = 3): Promise<VolumeSpike[]> {
    const spikes: VolumeSpike[] = [];
    
    // Fetch live quotes for current price and today's stats if possible
    let liveQuotes = await MstockService.getCurrentPrices(symbols);
    
    if (Object.keys(liveQuotes).length === 0 && symbols.length > 0) {
       liveQuotes = await YahooService.getCurrentPrices(symbols);
    }

    for (const symbol of symbols) {
      try {
        const intraday = await DataKeeper.getIntradayData(symbol);
        if (!intraday || intraday.length < 10) continue;

        const lastCandle = intraday[intraday.length - 1];
        const prevCandle = intraday[intraday.length - 2];
        const spikeVolume = lastCandle.volume || 0;

        // Skip the last 2 candles to avoid including the current spike in the baseline
        const historicalVolumes = intraday.slice(0, -2).map((c: any) => c.volume || 0).filter((v: number) => v > 0);
        
        if (historicalVolumes.length === 0) {
          // Fallback to a very small baseline if no history, but usually we skip
          continue;
        }
        
        // Calculate a cleaner average (removing 5% of top/bottom outliers to prevent skew)
        const sorted = [...historicalVolumes].sort((a, b) => a - b);
        const trim = Math.floor(sorted.length * 0.1);
        const baselineVolumes = sorted.slice(trim, sorted.length - trim);
        const avgVolume = baselineVolumes.length > 0 
          ? baselineVolumes.reduce((a, b) => a + b, 0) / baselineVolumes.length
          : historicalVolumes.reduce((a, b) => a + b, 0) / historicalVolumes.length;

        const ratio = spikeVolume / (avgVolume || 1);

        if (ratio >= factor) {
          // Calculate price change in this window
          const open = lastCandle.open || prevCandle.close || lastCandle.close;
          const close = lastCandle.close;
          const priceChangePercent = ((close - open) / (open || 1)) * 100;

          // Today's High/Low
          // Intraday data for 3 days, we need to filter for "today"
          // Or just use the whole intraday set if it's only 3 days and we want "recent" high/low
          // But user said "today's high/low"
          const now = new Date();
          const todayStr = now.toISOString().split('T')[0];
          
          const todayCandles = intraday.filter((c: any) => {
            const d = new Date(c.date);
            return d.toISOString().split('T')[0] === todayStr;
          });

          let todayHigh = lastCandle.high;
          let todayLow = lastCandle.low;

          if (todayCandles.length > 0) {
            todayHigh = Math.max(...todayCandles.map((c: any) => c.high || 0));
            todayLow = Math.min(...todayCandles.map((c: any) => c.low || 0));
          }

          spikes.push({
            symbol,
            spikeVolume,
            avgVolume,
            ratio,
            priceChangePercent,
            time: new Date(lastCandle.date).toLocaleTimeString(),
            todayHigh,
            todayLow,
            currentPrice: close
          });
        }
      } catch (err) {
        console.error(`Error scanning volume spikes for ${symbol}:`, err);
      }
    }

    return spikes;
  }
}
