import yf from "yahoo-finance2";

const YahooFinanceClass = (yf as any).default || yf;
const yahooFinance = typeof YahooFinanceClass === 'function' ? new (YahooFinanceClass as any)({ suppressNotices: ['yahooSurvey'] }) : yf;

// Force bypass of any active proxy settings on serverless/Railway
delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.ALL_PROXY;
delete process.env.all_proxy;

if (yahooFinance._opts) {
  yahooFinance._opts.fetchOptions = {
    ...(yahooFinance._opts.fetchOptions || {}),
    // Bypass node-fetch proxy agents:
    agent: false,
    // Bypass native fetch (Node 18+) dispatcher proxies:
    dispatcher: undefined
  };
}


export class YahooService {
  static async getHistoricalData(symbol: string, excludeToday = false) {
    const ticker = (symbol.includes(".") || symbol.startsWith("^")) ? symbol : `${symbol}.NS`;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 150); 
    const today = new Date();
    
    // If excluding today, set end date to yesterday 23:59:59
    const endDate = excludeToday ? new Date(new Date().setDate(today.getDate() - 1)) : today;
    if (excludeToday) endDate.setHours(23, 59, 59, 999);

    let result;
    try {
      // @ts-ignore
      const chartData = await yahooFinance.chart(ticker, {
        period1: startDate,
        period2: endDate,
        interval: "1d"
      });
      result = chartData.quotes || [];
    } catch (e: any) {
      console.warn(`[YAHOO] NSE fetch failed for ${ticker}: ${e.message}`);
    }

    if (!result || result.length === 0) {
      if (!symbol.includes(".") && !symbol.startsWith("^")) {
        const bseTicker = `${symbol}.BO`;
        try {
          // @ts-ignore
          const chartData = await yahooFinance.chart(bseTicker, {
            period1: startDate,
            period2: endDate,
            interval: "1d"
          });
          result = chartData.quotes || [];
        } catch (e: any) {
          console.error(`[YAHOO] BSE fetch failed for ${bseTicker}: ${e.message}`);
        }
      }
    }

    if (!result || result.length === 0) {
      throw new Error("No data found, symbol may be delisted or incorrect");
    }

    return result;
  }

  static async get90DayData(symbol: string) {
    // Legacy support, now calls with excludeToday=true as requested
    return this.getHistoricalData(symbol, true);
  }

  static async getCurrentPrices(symbols: string[]) {
    const tickers = symbols.map(s => (s.includes(".") || s.startsWith("^")) ? s : `${s}.NS`);
    const map: Record<string, { price: number, volume: number }> = {};
    
    // Batch quotes to avoid Yahoo rate limits or blocking
    const BATCH_SIZE = 50;
    try {
      for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
        const batchTickers = tickers.slice(i, i + BATCH_SIZE);
        const quotes: any[] = await yahooFinance.quote(batchTickers, {}, { validateResult: false });
        
        quotes.forEach(q => {
          const sym = q.symbol.replace(".NS", "").replace(".BO", "");
          map[sym] = {
            price: q.regularMarketPrice || q.price || 0,
            volume: q.regularMarketVolume || q.volume || 0
          };
        });
        
        if (i + BATCH_SIZE < tickers.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      return map;
    } catch (e: any) {
      console.error(`[YAHOO] Batch quote failed: ${e.message}`);
      return map;
    }
  }

  static async getCurrentPrice(symbol: string) {
    const ticker = (symbol.includes(".") || symbol.startsWith("^")) ? symbol : `${symbol}.NS`;
    const quote: any = await yahooFinance.quote(ticker, {}, { validateResult: false });
    return {
      price: quote.regularMarketPrice || quote.price || 0,
      volume: quote.regularMarketVolume || quote.volume || 0
    };
  }
}
