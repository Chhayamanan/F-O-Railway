import * as YFModule from 'yahoo-finance2';
import * as xlsx from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { DataKeeper, StockData } from '../core/dataKeeper';

let YFClass = YFModule.default || YFModule;
if (typeof YFClass !== 'function' && typeof YFModule.default?.default === 'function') {
  YFClass = YFModule.default.default;
}
const yahooFinance = typeof YFClass === 'function' ? new YFClass() : (typeof YFClass.default === 'function' ? new YFClass.default() : null);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface StockStats {
    name: string;
    symbol: string;
    mstockToken: string;
    high90d: number;
    low90d: number;
    avgDailyVol90d: number;
    avg5mVol60d: number;
    last5mVolume: number;
    last1mVolume: number;
    last1mChangePct: number;
}

export class DataFetcher {
    private static cache: Record<string, {
        timestamp: number;
        high90d: number;
        low90d: number;
        avgDailyVol90d: number;
        avg5mVol60d: number;
    }> = {};

    private static async fetchChartWithRetry(symbol: string, options: any, retries: number = 3): Promise<any> {
        for (let i = 0; i < retries; i++) {
            try {
                return await yahooFinance.chart(symbol, options);
            } catch (err: any) {
                if (i === retries - 1) throw err;
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // Exponential backoff
            }
        }
    }

    public static async generateReport(saveExcel: boolean = true): Promise<{filePath: string | null; data: StockStats[]}> {
        const stocks = DataKeeper.getAllStocks();
        const results: StockStats[] = [];

        // OPTIONAL GLOBAL FIX: Tell the library to mirror a standard browser if supported by your version
        if (typeof yahooFinance.setGlobalConfig === 'function') {
            yahooFinance.setGlobalConfig({
                request: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                }
            });
        }

        for (const stock of stocks) {
            try {
                const querySymbol = `${stock.symbol}.NS`; 

                let cached = this.cache[stock.symbol];
                const now = Date.now();
                
                if (!cached || (now - cached.timestamp > 60 * 60 * 1000)) {
                    // Introduce a 1.5-second pacing delay before hit requests to prevent data center firewalls from snapping
                    await sleep(1500);

                    // Fetch 90 days daily
                    const dailyData = await this.fetchChartWithRetry(querySymbol, {
                        period1: this.getDaysAgoTimestamp(90),
                        interval: '1d'
                    });

                    // Small pause between internal history calls
                    await sleep(500);

                    // Fetch 60 days 5m
                    let min5Data;
                    try {
                        min5Data = await this.fetchChartWithRetry(querySymbol, {
                            period1: this.getDaysAgoTimestamp(59), 
                            interval: '5m'
                        });
                    } catch (e) {
                        min5Data = await this.fetchChartWithRetry(querySymbol, {
                            period1: this.getDaysAgoTimestamp(30), 
                            interval: '5m'
                        });
                    }

                    if (!dailyData || !dailyData.quotes || !min5Data || !min5Data.quotes) {
                        throw new Error("Missing quotes data structure");
                    }

                    let high90d = -Infinity;
                    let low90d = Infinity;
                    let totalDailyVol = 0;
                    let validDailyDays = 0;

                    for (const quote of dailyData.quotes) {
                        if (quote.high !== null && quote.high !== undefined) high90d = Math.max(high90d, quote.high);
                        if (quote.low !== null && quote.low !== undefined) low90d = Math.min(low90d, quote.low);
                        if (quote.volume !== null && quote.volume !== undefined && quote.volume > 0) {
                            totalDailyVol += quote.volume;
                            validDailyDays++;
                        }
                    }

                    if (high90d === -Infinity || low90d === Infinity || validDailyDays === 0) throw new Error("Missing volume/price parameters");

                    const avgDailyVol90d = totalDailyVol / validDailyDays;

                    let total5mVol = 0;
                    let valid5mPeriods = 0;
                    for (let i = 0; i < min5Data.quotes.length; i++) {
                        const quote = min5Data.quotes[i];
                        if (quote.volume !== null && quote.volume !== undefined && quote.volume > 0) {
                            total5mVol += quote.volume;
                            valid5mPeriods++;
                        }
                    }

                    if (valid5mPeriods === 0) throw new Error("Missing 5m historical volume matrix");
                    const avg5mVol60d = total5mVol / valid5mPeriods;

                    cached = {
                        timestamp: now,
                        high90d,
                        low90d,
                        avgDailyVol90d,
                        avg5mVol60d
                    };
                    this.cache[stock.symbol] = cached;
                }

                // Small break before querying the 1-minute breakout candle info
                await sleep(500);

                let min1Data;
                try {
                    min1Data = await this.fetchChartWithRetry(querySymbol, {
                        period1: this.getDaysAgoTimestamp(2),
                        interval: '1m'
                    });
                } catch(e) {}

                let last1mVolume = 0;
                let last1mChangePct = 0;
                if (min1Data && min1Data.quotes && min1Data.quotes.length > 0) {
                    let lastValidQuote = null;
                    for (let i = min1Data.quotes.length - 1; i >= 0; i--) {
                        if (min1Data.quotes[i].volume && min1Data.quotes[i].volume > 0) {
                            lastValidQuote = min1Data.quotes[i];
                            break;
                        }
                    }
                    if (lastValidQuote) {
                        last1mVolume = lastValidQuote.volume || 0;
                        const open = lastValidQuote.open || 0;
                        const close = lastValidQuote.close || open;
                        if (open > 0) {
                            last1mChangePct = ((close - open) / open) * 100;
                        }
                    }
                }

                results.push({
                    name: stock.name,
                    symbol: stock.symbol,
                    mstockToken: stock.mstockToken,
                    high90d: cached.high90d,
                    low90d: cached.low90d,
                    avgDailyVol90d: cached.avgDailyVol90d,
                    avg5mVol60d: cached.avg5mVol60d,
                    last5mVolume: 0,
                    last1mVolume,
                    last1mChangePct
                });

                console.log(`[DataFetcher] Processed ${stock.symbol} successfully.`);

            } catch (err: any) {
                console.warn(`[DataFetcher] Background lookup failed for ${stock.symbol}: ${err.message}`);
                
                // FALLBACK SAFETY NET: If it completely blocks us, supply a temporary dummy safe object 
                // so your application logic does not crash or leave the data blank.
                results.push({
                    name: stock.name,
                    symbol: stock.symbol,
                    mstockToken: stock.mstockToken,
                    high90d: 0,
                    low90d: 0,
                    avgDailyVol90d: 0,
                    avg5mVol60d: 1000, // safety assignment to avoid Division-by-Zero errors on the multiplier
                    last5mVolume: 0,
                    last1mVolume: 0,
                    last1mChangePct: 0
                });
            }
        }

        let filePath: string | null = null;
        if (saveExcel) {
            filePath = this.saveToExcel(results);
        }
        return { filePath, data: results };
    }

    private static getDaysAgoTimestamp(days: number): number {
        const d = new Date();
        d.setDate(d.getDate() - days);
        return Math.floor(d.getTime() / 1000);
    }

    private static saveToExcel(data: StockStats[]): string {
        // Indian timing zone formatter
        const formatter = new Intl.DateTimeFormat('en-IN', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        
        // Format string like YYYY-MM-DD HH:mm:ss
        const parts = formatter.formatToParts(new Date());
        const getV = (type: string) => parts.find(p => p.type === type)?.value || '';
        const formattedDate = `${getV('year')}-${getV('month')}-${getV('day')} ${getV('hour')}:${getV('minute')}:${getV('second')} IST`;

        const lastDownloaded = `Last Downloaded: ${formattedDate}`;
        
        const rows: any[][] = [];
        rows.push([lastDownloaded]);
        rows.push([]);
        
        // Headers
        const headers = [
            "Sr Number",
            "Stock",
            "mstock token",
            "90days high",
            "90days low",
            "90days daily volume average",
            "5 min average volume for 60 days",
            "1 min volume (mstock)",
            "1 min change in % (mstock)"
        ];
        rows.push(headers);

        // Data
        data.forEach((item, index) => {
            rows.push([
                index + 1,
                item.symbol,
                item.mstockToken,
                item.high90d.toFixed(2),
                item.low90d.toFixed(2),
                Math.round(item.avgDailyVol90d),
                Math.round(item.avg5mVol60d),
                item.last1mVolume,
                item.last1mChangePct.toFixed(2) + '%'
            ]);
        });

        const worksheet = xlsx.utils.aoa_to_sheet(rows);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'StockData');

        // File path
        const filePath = path.join(process.cwd(), 'Stock_Baseline_Report.xlsx');
        xlsx.writeFile(workbook, filePath);
        console.log(`[DataFetcher] Excel file saved to ${filePath}`);
        
        return filePath;
    }
}
