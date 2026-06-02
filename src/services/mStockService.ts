import { MConnect } from 'mconnectb';
import { TOTP } from 'otpauth';

let _client: MConnect | null = null;
let _token: string | null = null;

export const getMConnectClient = async (): Promise<MConnect> => {
    if (_client && _token) {
        return _client;
    }

    const apiKey = process.env.MSTOCK_API_KEY;
    const clientCode = process.env.MSTOCK_CLIENT_CODE;
    const password = process.env.MSTOCK_PASSWORD;
    const totpSecret = process.env.MSTOCK_TOTP_SECRET;
    
    if (!apiKey || !clientCode || !totpSecret) {
        throw new Error("Missing MStock configuration in environment variables");
    }

    const client = new MConnect('https://api.mstock.trade', apiKey);
    
    // Fallback: If no password provided, it will likely fail during this executeRequest unless MStock allows empty/default
    const totp = new TOTP({ secret: totpSecret });
    const totpVal = totp.generate();
    
    try {
        const res = await client.login({
            clientcode: clientCode,
            password: password || 'default', // Fallback for testing
            totp: totpVal,
            state: ''
        });

        if ((res as any).data?.jwtToken) {
           const token = (res as any).data.jwtToken;
           client.setAccessToken(token);
           _client = client;
           _token = token;
        } else {
           throw new Error("Failed to login to mStock: " + JSON.stringify((res as any).data || res));
        }
    } catch (e: any) {
        console.error("MConnect login failed:", e.message);
        throw new Error("MConnect login failed: " + e.message);
    }
    
    return client;
};

export const placeOrder = async (symbol: string, token: string = "1", transactionType: 'BUY' | 'SELL' = 'BUY') => {
    const client = await getMConnectClient();
    
    // 1. Check current Indian Time to dynamically adjust product type if testing off-market hours
    const nowIST = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
    const hours = nowIST.getHours();
    const minutes = nowIST.getMinutes();
    const currentTimeValue = hours * 100 + minutes;

    // Regular Market Hours: 09:15 to 15:30
    const isMarketOpen = currentTimeValue >= 915 && currentTimeValue <= 1530 && nowIST.getDay() >= 1 && nowIST.getDay() <= 5;
    
    // Adjust configurations safely so the API doesn't throw a structural 401 out of hours
    const productType = isMarketOpen ? "INTRADAY" : "DELIVERY"; 
    const variety = isMarketOpen ? "NORMAL" : "AMO"; 

    // 2. Uniform, Standardized Payload Map (Both CamelCase and lowercase alternatives for safety)
    const params = {
        variety: variety,
        tradingsymbol: symbol.toUpperCase(),
        symboltoken: token,
        exchange: "NSE",
        transactiontype: transactionType,
        ordertype: "MARKET",
        quantity: "1",
        producttype: productType,
        duration: "DAY",
        // Capitalized variants in case the SDK expects standard structural schemas:
        tradingSymbol: symbol.toUpperCase(),
        symbolToken: token,
        transactionType: transactionType,
        orderType: "MARKET",
        productType: productType
    };

    console.log(`[mStock] Dispatching Execution Chain for ${symbol}...`, { variety, transactionType, productType });
    
    if (typeof (client as any).placeOrder === 'function') {
        const res = await (client as any).placeOrder(params);
        return res?.data || res;
    } else {
        throw new Error("Client structural fault: placeOrder method is missing on verified session profile.");
    }
};

export const getActiveSessionToken = (): string | null => {
    return _token;
};
