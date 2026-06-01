const YFModule = require('yahoo-finance2');
import * as xlsx from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { DataKeeper, StockData } from '../core/dataKeeper';

let YFClass = YFModule.default || YFModule;
if (typeof YFClass !== 'function' && typeof YFModule.default?.default === 'function') {
  YFClass = YFModule.default.default;
}
const yahooFinance = typeof YFClass === 'function' ? new YFClass() : (typeof YFClass.default === 'function' ? new YFClass.default() : null);

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

    public static async generateReport(): Promise<{filePath: string; data: StockStats[]}> {
        const stocks = DataKeeper.getAllStocks();
        const results: StockStats[] = [];

        for (const stock of stocks) {
            try {
                const querySymbol = `${stock.symbol}.NS`; 

                let cached = this.cache[stock.symbol];
                const now = Date.now();
                // Cache for 1 hour
                if (!cached || (now - cached.timestamp > 60 * 60 * 1000)) {
                    // Fetch 90 days daily
                    const dailyData = await yahooFinance.chart(querySymbol, {
                        period1: this.getDaysAgoTimestamp(90),
                        interval: '1d'
                    });

                    // Fetch 60 days 5m (Yahoo allows max 60 days for 5m, effectively 59 days to be safe)
                    let min5Data;
                    try {
                        min5Data = await yahooFinance.chart(querySymbol, {
                            period1: this.getDaysAgoTimestamp(59), 
                            interval: '5m'
                        });
                    } catch (e) {
                        min5Data = await yahooFinance.chart(querySymbol, {
                             period1: this.getDaysAgoTimestamp(30), 
                             interval: '5m'
                        });
                    }

                    if (!dailyData || !dailyData.quotes || !min5Data || !min5Data.quotes) {
                        continue;
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

                    if (high90d === -Infinity || low90d === Infinity || validDailyDays === 0) continue;

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

                    if (valid5mPeriods === 0) continue;
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

                // Fetch 1 min & 5 min recent data using 1-5 day buffer to account for weekends
                let recent5Data;
                let last5mVolume = 0;
                try {
                    recent5Data = await yahooFinance.chart(querySymbol, {
                        period1: this.getDaysAgoTimestamp(5),
                        interval: '5m'
                    });
                    if (recent5Data && recent5Data.quotes) {
                        for (let i = 0; i < recent5Data.quotes.length; i++) {
                            const quote = recent5Data.quotes[i];
                            if (quote.volume !== null && quote.volume !== undefined && quote.volume > 0) {
                                last5mVolume = quote.volume;
                            }
                        }
                    }
                } catch(e) {}

                let min1Data;
                try {
                    min1Data = await yahooFinance.chart(querySymbol, {
                        period1: this.getDaysAgoTimestamp(2),
                        interval: '1m'
                    });
                } catch(e) {}

                // 1 min info
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
                    last5mVolume,
                    last1mVolume,
                    last1mChangePct
                });

                console.log(`[DataFetcher] Processed ${stock.symbol}`);

            } catch (err: any) {
                console.warn(`[DataFetcher] Failed to fetch data for ${stock.symbol}: ${err.message}`);
            }
        }

        const filePath = this.saveToExcel(results);
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
