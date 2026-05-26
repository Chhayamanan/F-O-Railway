import { YahooService } from './src/services/yahooService';
import yahooFinanceDefault from 'yahoo-finance2';

const YahooFinanceClass = (yahooFinanceDefault as any).default || yahooFinanceDefault;
const yahooFinance = typeof YahooFinanceClass === 'function' ? new YahooFinanceClass({ suppressNotices: ['yahooSurvey'] }) : YahooFinanceClass;

async function test() {
    console.log("Testing Yahoo with 50 unique symbols...");
    const syms = ['RELIANCE.NS', 'TCS.NS', 'INFY.NS', 'HDFCBANK.NS', 'ICICIBANK.NS', 'SBIN.NS', 'KOTAKBANK.NS', 'BHARTIARTL.NS', 'ITC.NS', 'HINDUNILVR.NS', 'LT.NS', 'BAJFINANCE.NS', 'AXISBANK.NS', 'ASIANPAINT.NS', 'MARUTI.NS', 'TITAN.NS', 'WIPRO.NS', 'ULTRACEMCO.NS', 'SUNPHARMA.NS', 'HCLTECH.NS', 'TATASTEEL.NS', 'TATAMOTORS.NS', 'NTPC.NS', 'BAJAJFINSV.NS', 'POWERGRID.NS', 'INDUSINDBK.NS', 'NESTLEIND.NS', 'TECHM.NS', 'M&M.NS', 'ADANIENT.NS', 'GRASIM.NS', 'HINDALCO.NS', 'ONGC.NS', 'JSWSTEEL.NS', 'CIPLA.NS', 'DRREDDY.NS', 'BPCL.NS', 'EICHERMOT.NS', 'DIVISLAB.NS', 'SBILIFE.NS', 'BAJAJ-AUTO.NS', 'TATASTLLP.NS', 'TATACONSUM.NS', 'UPL.NS', 'HEROMOTOCO.NS', 'APOLLOHOSP.NS', 'COALINDIA.NS', 'HDFCLIFE.NS', 'BRITANNIA.NS', 'RELIANCE.NS'];
    console.log("Symbols len:", syms.length);
    try {
        const res = await yahooFinance.quote(syms);
        console.log("Success with 50: items =", res.length);
    } catch(e) {
        console.error("Failed with 50:", e);
    }
}
test();
