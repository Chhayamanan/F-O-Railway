import * as YFModule from 'yahoo-finance2';
import { DataKeeper } from '../core/dataKeeper';

let YFClass = YFModule.default || YFModule;
if (typeof YFClass !== 'function' && typeof YFModule.default?.default === 'function') {
    YFClass = YFModule.default.default;
}
const yahooFinance = typeof YFClass === 'function' ? new YFClass() : null;

export class DataFetcher {
    // Session state stores for both stock baskets and indices to calculate High/Low bounds
    private static stockSessionTracker: Record<string, { high: number; low: number; traded: boolean }> = {};
    private static niftySession = { dailyHigh: -Infinity, dailyLow: Infinity, hasTradedCE: false, hasTradedPE: false };

    /**
     * PURE PRICE ACTION: Checks stock prices against daily High/Low bounds
     */
    public static async checkStocksPriceBreakout(): Promise<{ executedAction: boolean; data: any[] }> {
        const stocks = DataKeeper.getAllStocks();
        const results: any[] = [];
        let executedAction = false;

        for (const stock of stocks) {
            try {
                const querySymbol = `${stock.symbol}.NS`;
                const chartData = await yahooFinance!.chart(querySymbol, { period1: Math.floor(Date.now() / 1000) - 86400, interval: '1m' });
                const quotes = chartData?.quotes || [];
                
                if (quotes.length === 0) continue;
                
                const currentQuote = quotes[quotes.length - 1];
                const ltp = currentQuote.close || currentQuote.open;

                // Initialize boundary markers if tracking session is empty
                if (!this.stockSessionTracker[stock.symbol]) {
                    let sHigh = -Infinity;
                    let sLow = Infinity;
                    quotes.forEach((q: any) => {
                        if (q.high) sHigh = Math.max(sHigh, q.high);
                        if (q.low) sLow = Math.min(sLow, q.low);
                    });
                    this.stockSessionTracker[stock.symbol] = { high: sHigh, low: sLow, traded: false };
                }

                const session = this.stockSessionTracker[stock.symbol];

                // Breakout Logic
                if (!session.traded && ltp !== null) {
                    if (ltp > session.high) {
                        executedAction = true;
                        session.traded = true;
                        await this.dispatchOrder(stock.symbol, stock.mstockToken, 'BUY');
                    } else if (ltp < session.low) {
                        executedAction = true;
                        session.traded = true;
                        await this.dispatchOrder(stock.symbol, stock.mstockToken, 'SELL');
                    }
                }

                // Keep bounds dynamically matched to true peaks
                if (ltp !== null && ltp > session.high) session.high = ltp;
                if (ltp !== null && ltp < session.low) session.low = ltp;

                results.push({ symbol: stock.symbol, ltp, high: session.high, low: session.low });
            } catch (e) {
                console.error(`Error processing stock ${stock.symbol}`, e);
            }
        }
        return { executedAction, data: results };
    }

    /**
     * PURE PRICE ACTION: Checks Nifty Index Spot against daily High/Low bounds
     */
    public static async fetchNiftyBreakoutStatus(): Promise<{
        metrics: { ltp: number; high: number; low: number }
    }> {
        // Fetch today's summary data directly from Yahoo Finance
        const summary = await yahooFinance!.quote('^NSEI');

        return {
            metrics: {
                ltp: summary.regularMarketPrice || 0,
                high: summary.regularMarketDayHigh || 0,
                low: summary.regularMarketDayLow || 0
            }
        };
    }

    private static buildOptionsPayload(type: 'CE' | 'PE', spot: number, qty: number) {
        const strike = Math.round(spot / 50) * 50;
        const symbolString = `NIFTY26JUN${strike}${type}`;
        return {
            variety: "NORMAL", tradingsymbol: symbolString, symboltoken: "1",
            exchange: "NFO", transactiontype: "BUY", ordertype: "MARKET",
            quantity: String(qty), producttype: "INTRADAY", duration: "DAY"
        };
    }

    private static async dispatchOrder(symbol: string, token: string, action: 'BUY' | 'SELL') {
        try {
            await fetch(`http://localhost:${process.env.PORT || 3000}/api/order`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol, token, action })
            });
            console.log(`[PRICE BREAKOUT EXECUTION] Fired ${action} for ${symbol}`);
        } catch (e) { console.error("Failed dispatching price action execution order", e); }
    }
}
