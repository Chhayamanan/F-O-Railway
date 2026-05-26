import { MstockService } from './src/services/mstockService';
import axios from 'axios';

async function test() {
    const token = await MstockService.getMstockJwtToken();
    const apiKey = process.env.MSTOCK_API_KEY;

    const headers = {
        'X-Mirae-Version': '1',
        'Authorization': `Bearer ${token}`,
        'X-PrivateKey': apiKey,
        'Content-Type': 'application/json'
    };

    console.log("Token acquired", token ? "Yes" : "No");

    // Test 1: POST /instruments/quote mode OHLC
    try {
        console.log("Test 1: POST mode OHLC");
        const res = await axios.post("https://api.mstock.trade/openapi/typeb/instruments/quote", {
            mode: "OHLC",
            exchangeTokens: { NSE: ["2885"] }
        }, { headers });
        console.log("Success! Data keys:", Object.keys(res.data));
    } catch(e: any) {
        console.log("Failed 1:", e.response?.status, e.response?.data);
    }

    // Test 2: POST /instruments/quote mode FULL
    try {
        console.log("Test 2: POST mode FULL");
        const res = await axios.post("https://api.mstock.trade/openapi/typeb/instruments/quote", {
            mode: "FULL",
            exchangeTokens: { NSE: ["2885"] }
        }, { headers });
        console.log("Success! Data keys:", Object.keys(res.data));
    } catch(e: any) {
        console.log("Failed 2:", e.response?.status, e.response?.data);
    }

    // Test 3: POST /instruments/quote mode LTP
    try {
        console.log("Test 3: POST mode LTP");
        const res = await axios.post("https://api.mstock.trade/openapi/typeb/instruments/quote", {
            mode: "LTP",
            exchangeTokens: { NSE: ["2885"] }
        }, { headers });
        console.log("Success! Data keys:", Object.keys(res.data));
    } catch(e: any) {
        console.log("Failed 3:", e.response?.status, e.response?.data);
    }

    // Test 4: GET marketdata/Livequotes
    try {
        console.log("Test 4: GET marketdata/Livequotes");
        const res = await axios.get("https://api.mstock.trade/openapi/typeb/marketdata/Livequotes?exchange=NSE&symbolToken=2885", { headers });
        console.log("Success! Data keys:", Object.keys(res.data));
    } catch(e: any) {
        console.log("Failed 4:", e.response?.status, e.response?.data);
    }
}
test().catch(console.error);
