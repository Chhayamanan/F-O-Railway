import YahooFinance from 'yahoo-finance2';
import * as xlsx from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { DataKeeper, StockData } from '../core/dataKeeper';

const yahooFinance = new YahooFinance();

export interface StockStats {
    name: string;
    symbol: string;
    mstockToken: string;
    high90d: number;
    low90d: number;
    avgDailyVol90d: number;
    avg5mVol60d: number;
}

export class DataFetcher {
    public static async generateReport(): Promise<string> {
        const stocks = DataKeeper.getAllStocks();
        const results: StockStats[] = [];

        for (const stock of stocks) {
            try {
                const querySymbol = `${stock.symbol}.NS`; 

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
                    console.warn(`[DataFetcher] Failed to fetch 60-day 5m data for ${stock.symbol}, trying 30 days.`);
                    // Fallback to 30 days if 60 days fails due to date constraints
                    min5Data = await yahooFinance.chart(querySymbol, {
                         period1: this.getDaysAgoTimestamp(30), 
                         interval: '5m'
                    });
                }

                if (!dailyData || !dailyData.quotes || dailyData.quotes.length === 0 ||
                    !min5Data || !min5Data.quotes || min5Data.quotes.length === 0) {
                    console.log(`[DataFetcher] Skipping ${stock.symbol} due to insufficient data.`);
                    continue;
                }

                // Calculate 90d High, Low, Avg Vol
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

                if (high90d === -Infinity || low90d === Infinity || validDailyDays === 0) {
                    continue;
                }

                const avgDailyVol90d = totalDailyVol / validDailyDays;

                // Calculate 60d 5m Avg Vol
                let total5mVol = 0;
                let valid5mPeriods = 0;
                for (const quote of min5Data.quotes) {
                    if (quote.volume !== null && quote.volume !== undefined && quote.volume > 0) {
                        total5mVol += quote.volume;
                        valid5mPeriods++;
                    }
                }

                if (valid5mPeriods === 0) continue;

                const avg5mVol60d = total5mVol / valid5mPeriods;

                results.push({
                    name: stock.name,
                    symbol: stock.symbol,
                    mstockToken: stock.mstockToken,
                    high90d,
                    low90d,
                    avgDailyVol90d,
                    avg5mVol60d
                });

                console.log(`[DataFetcher] Processed ${stock.symbol}`);

            } catch (err: any) {
                console.warn(`[DataFetcher] Failed to fetch data for ${stock.symbol}: ${err.message}`);
            }
        }

        return this.saveToExcel(results);
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
            "5 min average volume for 60 days"
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
                Math.round(item.avg5mVol60d)
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
