import { MstockService } from './src/services/mstockService';
import axios from 'axios';

async function test() {
    const token = await MstockService.getMstockJwtToken();
    const apiKey = process.env.MSTOCK_API_KEY;
    console.log("Got token...");

    const headers = {
        'X-Mirae-Version': '1',
        'Authorization': `Bearer ${token}`,
        'X-PrivateKey': apiKey,
    };

    const tests = [
        "https://api.mstock.trade/openapi/typeb/marketdata/Livequotes?exchange=NFO&symbolToken=35458", // Reliance Futures token example
    ];

    for (const url of tests) {
        try {
            const res = await axios.get(url, { headers });
            console.log("Success for URL:", url);
            console.log(res.data);
        } catch (e: any) {
            console.error("Failed for URL:", url, "Status:", e.response?.status, "Data:", e.response?.data);
        }
    }
}
test().catch(console.error);
