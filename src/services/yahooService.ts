import { MstockService } from './mstockService';
import yahooFinanceDefault from 'yahoo-finance2';
import axios from 'axios';

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
    const range = daysBack > 14 ? '60m' : '14d'; // Just approximation, Yahoo supports 1d, 5d, 1mo, 3mo
    const exactRange = daysBack <= 14 ? '14d' : '60d';
    
    let attempt = 0;
    while (attempt < 3) {
        try {
            const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=5m&range=${exactRange}`;
            
            // Use axios to fetch directly
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Accept': '*/*, application/json'
                },
                timeout: 10000
            });
            
            const result = response.data?.chart?.result?.[0];
            if (!result || !result.timestamp) return [];
            
            const timestamps = result.timestamp;
            const quote = result.indicators.quote[0];
            
            return timestamps.map((time: number, i: number) => ({
                date: new Date(time * 1000),
                open: quote.open[i] || 0,
                high: quote.high[i] || 0,
                low: quote.low[i] || 0,
                close: quote.close[i] || 0,
                volume: quote.volume[i] || 0
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
