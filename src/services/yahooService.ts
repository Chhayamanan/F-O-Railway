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
      console.warn(`[YAHOO] No data found for ${symbol}`);
      return [];
    }

    return result;
  }

  static async get90DayData(symbol: string) {
    // Legacy support, now calls with excludeToday=true as requested
    return this.getHistoricalData(symbol, true);
  }

  static async getCurrentPrices(symbols: string[]) {
    // Replaced Yahoo with generic API per user instruction
    const apiUrl = process.env.REALTIME_API_URL;
    
    if (!apiUrl) {
      console.warn("[API] REALTIME_API_URL is missing. Please add the given API URL to your environment secrets.");
      return {};
    }

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols })
      });
      
      if (!response.ok) {
         throw new Error(`API responded with status: ${response.status}`);
      }

      const data = await response.json();
      return data.quotes || data.data || data; 
    } catch (e: any) {
      console.error(`[API] Real-time fetch failed: ${e.message}`);
      return {};
    }
  }

  static async getCurrentPrice(symbol: string) {
    const data = await this.getCurrentPrices([symbol]);
    return data[symbol] || { price: 0, volume: 0 };
  }
}
