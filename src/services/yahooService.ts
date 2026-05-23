import yahooFinanceLib from 'yahoo-finance2';

const yahooFinance = (yahooFinanceLib as any).default || yahooFinanceLib;

export class YahooService {
  static async get90DayData(symbol: string) {
    const ticker = (symbol.includes(".") || symbol.startsWith("^")) ? symbol : `${symbol}.NS`;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);
    const today = new Date();

    try {
      const result = await yahooFinance.chart(ticker, {
        period1: startDate,
        period2: today,
        interval: "1d"
      });
      return result.quotes || [];
    } catch (e: any) {
      console.warn(`[YAHOO] NSE fetch failed for ${ticker}: ${e.message}`);
      // Retry with BSE if NSE failed
      if (!symbol.includes(".")) {
        try {
          const bseTicker = `${symbol}.BO`;
          const result = await yahooFinance.chart(bseTicker, {
            period1: startDate,
            period2: today,
            interval: "1d"
          });
          return result.quotes || [];
        } catch (e2: any) {
             console.warn(`[YAHOO] BSE fetch failed for ${ticker}: ${e2.message}`);
        }
      }
      return [];
    }
  }
}
