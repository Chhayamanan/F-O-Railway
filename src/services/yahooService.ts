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

  static async getCurrentPrices(symbols: string[]) {
    try {
      const results: Record<string, any> = {};
      
      const CHUNK_SIZE = 250; 
      for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
         const chunk = symbols.slice(i, i + CHUNK_SIZE).map(s => s.endsWith('.NS') ? s : s + '.NS');
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
         } catch (chunkErr: any) {
            console.error(`[YAHOO] Error fetching chunk of size ${chunk.length}: ${chunkErr.message}`);
         }
      }
      return results;
    } catch (e: any) {
      console.error("[YAHOO] Global fail fetching live quotes:", e.message);
      return {};
    }
  }
}
