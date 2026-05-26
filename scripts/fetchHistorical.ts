import { YahooService } from '../src/services/yahooService';
import { RAW_UNIVERSE } from '../src/services/marketDataService';
import fs from 'fs';
import path from 'path';

async function fetchHistorical() {
    console.log(`Starting 5-minute data fetch for ${RAW_UNIVERSE.length} stocks...`);
    console.log("NOTE: Yahoo Finance API enforces a strict 60-day maximum limit for 5-minute interval data. Fetching the last 60 days instead of 1 year.");

    const outputDir = path.join(process.cwd(), 'historical_data_5m');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < RAW_UNIVERSE.length; i++) {
        const symbol = RAW_UNIVERSE[i];
        console.log(`[${i+1}/${RAW_UNIVERSE.length}] Fetching ${symbol}...`);
        
        const data = await YahooService.get5MinData(symbol, 60);
        
        if (data && data.length > 0) {
            fs.writeFileSync(path.join(outputDir, `${symbol.replace('^', '')}_5m.json`), JSON.stringify(data, null, 2));
            successCount++;
        } else {
            failCount++;
        }

        // Throttle to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`\nFetch Complete!`);
    console.log(`Saved: ${successCount} symbols`);
    console.log(`Failed: ${failCount} symbols`);
    console.log(`Data saved to: ${outputDir}`);
}

fetchHistorical().catch(console.error);
