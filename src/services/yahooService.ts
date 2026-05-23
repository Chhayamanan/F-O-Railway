import yahooFinanceLib from 'yahoo-finance2';

const YahooFinanceClass = (yahooFinanceLib as any).default || yahooFinanceLib;
const yahooFinance = new YahooFinanceClass({
  fetchOptions: {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    }
  }
});

export class YahooService {
  static async fetchWithRetry(ticker: string, queryOptions: any, retries: number = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
      try {
        return await yahooFinance.chart(ticker, queryOptions);
      } catch (e: any) {
        if (i === retries - 1) throw e;
        // Exponential backoff
        await new Promise(res => setTimeout(res, (i + 1) * 1000));
      }
    }
  }

  static async get90DayData(symbol: string) {
    const ticker = (symbol.includes(".") || symbol.startsWith("^")) ? symbol : `${symbol}.NS`;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);
    const today = new Date();
    
    const queryOptions = {
        period1: startDate,
        period2: today,
        interval: "1d" as const
    };

    try {
      const result = await this.fetchWithRetry(ticker, queryOptions);
      return result.quotes || [];
    } catch (e: any) {
      console.warn(`[YAHOO] NSE fetch failed for ${ticker}: ${e.message}`);
      // Retry with BSE if NSE failed
      if (!symbol.includes(".")) {
        const bseTicker = `${symbol}.BO`;
        try {
          const result = await this.fetchWithRetry(bseTicker, queryOptions);
          return result.quotes || [];
        } catch (e2: any) {
             console.warn(`[YAHOO] BSE fetch failed for ${bseTicker}: ${e2.message}`);
        }
      }
      return [];
    }
  }
}
