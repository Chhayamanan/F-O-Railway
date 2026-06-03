import { getMConnectClient, getActiveSessionToken } from './mStockService';

export class DataFetcher {
    // Keep a lock to ensure only one trade per direction is executed today
    private static tradedCE = false;
    private static tradedPE = false;

    public static async fetchNiftyBreakoutStatus(targetQty: number): Promise<{
        metrics: { ltp: number; high: number; low: number };
        executedTrade: string | null;
        orderParams: any | null;
    }> {
        let executedTrade: string | null = null;
        let orderParams: any | null = null;

        // 1. Extract environment keys and verified session token from Code 5 client wrapper
        const apiKey = process.env.MSTOCK_API_KEY || '';
        const clientWrapper = await getMConnectClient();
        // Extracting your internal session variable safely
        let accessToken = (clientWrapper as any).getAccessToken ? (clientWrapper as any).getAccessToken() : process.env.MSTOCK_ACCESS_TOKEN;

        if (!accessToken) {
            accessToken = getActiveSessionToken();
        }

        // 2. Query the exact mStock quote endpoint using the documentation parameters
        const response = await fetch('https://api.mstock.trade/openapi/typeb/instruments/quote', {
            method: 'POST', // mStock requires POST to send the exchangeTokens JSON data payload
            headers: {
                'X-Mirae-Version': '1',
                'Authorization': `Bearer ${accessToken}`,
                'X-PrivateKey': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                mode: "OHLC",
                exchangeTokens: {
                    "NSE": ["26000"] // "26000" is the standard NSE index token for NIFTY 50 Spot
                }
            })
        });

        if (!response.ok) {
            throw new Error(`mStock API Connection Error: Status Code ${response.status}`);
        }

        const json: any = await response.json();
        
        if (json.status !== "true" || !json.data?.fetched?.[0]) {
            throw new Error(`mStock Data Error: ${json.message || "Empty payload response"}`);
        }

        const niftyData = json.data.fetched[0];
        const ltp = parseFloat(niftyData.ltp) || 0;
        const high = parseFloat(niftyData.high) || 0;
        const low = parseFloat(niftyData.low) || 0;

        // 3. PURE PRICE ACTION RULES
        // If spot price crosses ABOVE today's high -> Buy CALL (CE)
        if (ltp > high && !this.tradedCE) {
            executedTrade = "CALL OPTION (CE)";
            this.tradedCE = true;
            orderParams = this.buildPayload("CE", ltp, targetQty);
        } 
        // If spot price drops BELOW today's low -> Buy PUT (PE)
        else if (ltp < low && !this.tradedPE) {
            executedTrade = "PUT OPTION (PE)";
            this.tradedPE = true;
            orderParams = this.buildPayload("PE", ltp, targetQty);
        }

        return {
            metrics: { ltp, high, low },
            executedTrade,
            orderParams
        };
    }

    private static buildPayload(type: 'CE' | 'PE', spot: number, qty: number) {
        // Round spot to closest 50 increment to hit the At-The-Money strike option
        const strike = Math.round(spot / 50) * 50;
        
        return {
            variety: "NORMAL",
            tradingsymbol: `NIFTY26JUN${strike}${type}`,
            symboltoken: "1",
            exchange: "NFO",
            transactiontype: "BUY",
            ordertype: "MARKET",
            quantity: String(qty),
            producttype: "INTRADAY",
            duration: "DAY"
        };
    }
}
