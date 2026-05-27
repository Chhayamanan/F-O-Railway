import { YahooService } from './src/services/yahooService.js';
async function test() {
    const data = await YahooService.get5MinData('MANORAMA', 14);
    console.log('Got data length:', data.length);
}
test();
