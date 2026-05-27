import { MstockService } from './mstockService';
import yahooFinanceDefault from 'yahoo-finance2';

const YahooFinanceClass = (yahooFinanceDefault as any).default || yahooFinanceDefault;
const yahooFinance = typeof YahooFinanceClass === 'function' ? new YahooFinanceClass({ suppressNotices: ['yahooSurvey'] }) : YahooFinanceClass;

export class YahooService {
  static async get180DayData(symbol: string) {
    const ticker = symbol.endsWith('.NS') || symbol.startsWith('^') ? symbol : `${symbol}.NS`;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 180);
    
    try {
        const chartData = await yahooFinance.chart(ticker, {
            period1: startDate,
            period2: new Date(),
            interval: "1d"
        });
        return (chartData.quotes || []).map((q: any) => ({
            high: q.high || 0,
            low: q.low || 0,
            volume: q.volume || 0
        }));
    } catch (e: any) {
        console.error(`[YAHOO F&O] Historical fetch failed for ${ticker}:`, e.message);
        return [];
    }
  }

  static async get5MinData(symbol: string, daysBack: number = 60) {
    const ticker = symbol.endsWith('.NS') || symbol.startsWith('^') ? symbol : `${symbol}.NS`;
    const startDate = new Date();
    // Yahoo Finance only allows max 60 days for 5m interval
    startDate.setDate(startDate.getDate() - Math.min(daysBack, 60));
    
    let attempt = 0;
    while (attempt < 3) {
        try {
            const chartData = await yahooFinance.chart(ticker, {
                period1: startDate,
                period2: new Date(),
                interval: "5m"
            });
            return (chartData.quotes || []).map((q: any) => ({
                date: q.date,
                open: q.open || 0,
                high: q.high || 0,
                low: q.low || 0,
                close: q.close || 0,
                volume: q.volume || 0
            }));
        } catch (e: any) {
            attempt++;
            console.error(`[YAHOO] 5-minute historical fetch failed for ${ticker} (Attempt ${attempt}):`, e.message);
            if (attempt >= 3) return [];
            await new Promise(resolve => setTimeout(resolve, attempt * 2000 + Math.random() * 1000));
        }
    }
    return [];
  }

  static async getCurrentPrices(symbols: string[]) {
    try {
      const results: Record<string, any> = {};
      
      const CHUNK_SIZE = 50; 
      for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
         const chunk = symbols.slice(i, i + CHUNK_SIZE).map(s => s.endsWith('.NS') ? s : s + '.NS');
         let attempt = 0;
         while (attempt < 3) {
             try {
                const data = await yahooFinance.quote(chunk) as any[];
                for (const item of data) {
                   const cleanSym = item.symbol.replace('.NS', '');
                   results[cleanSym] = {
                      price: item.regularMarketPrice || 0,
                      volume: item.regularMarketVolume || 0,
                      prevClose: item.regularMarketPreviousClose || 0
                   };
                }
                break; // Break the retry loop
             } catch (chunkErr: any) {
                attempt++;
                console.error(`[YAHOO] Error fetching chunk of size ${chunk.length} (Attempt ${attempt}): ${chunkErr.message}`);
                if (attempt >= 3) break;
                // Wait briefly before retrying
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
             }
         }
         // Short pause between chunks to respect Yahoo Finance rate limits
         await new Promise(resolve => setTimeout(resolve, 500));
      }
      return results;
    } catch (e: any) {
      console.error("[YAHOO] Global fail fetching live quotes:", e.message);
      return {};
    }
  }
}
