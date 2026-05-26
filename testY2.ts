import { YahooService } from './src/services/yahooService';
import yahooFinanceDefault from 'yahoo-finance2';

async function test() {
    console.log("Fetching TSCS...");
    try {
        const fetch = await YahooService.getCurrentPrices(['RELIANCE']);
        console.log("Data:", fetch);
    } catch(e) {
        console.error("error:", e);
    }
}
test().catch(console.error);
