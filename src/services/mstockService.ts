import axios from 'axios';
import * as OTPAuth from 'otpauth';

export class MstockService {
  private static cachedToken: string | null = null;
  private static tokenExpiry: number = 0;
  private static MSTOCK_BASE_URL = "https://tradingapi.mstock.com/v1";

  static async autoLoginWithTOTP() {
    const apiKey = process.env.MSTOCK_API_KEY;
    const totpSecret = process.env.MSTOCK_TOTP_SECRET;

    if (!apiKey || !totpSecret) {
      throw new Error("Missing MSTOCK_API_KEY or MSTOCK_TOTP_SECRET in environment variables.");
    }

    try {
      console.log("[MSTOCK SERVICE] Generating live TOTP...");

      let currentTotp;
      try {
        let cleanedSecret = totpSecret.replace(/\s+/g, "").toUpperCase();
        const missingPadding = cleanedSecret.length % 8;
        if (missingPadding !== 0) {
          cleanedSecret += "=".repeat(8 - missingPadding);
        }

        const totp = new OTPAuth.TOTP({
          algorithm: "SHA1",
          digits: 6,
          period: 30,
          secret: OTPAuth.Secret.fromBase32(cleanedSecret)
        });
        currentTotp = totp.generate();
      } catch (e: any) {
         throw new Error(`CRITICAL: String parsing failure. ${e.message}`);
      }

      console.log(`[MSTOCK SERVICE] Automatically generated live TOTP: ${currentTotp}`);

      console.log("[MSTOCK SERVICE] Exchanging credentials for a session token...");
      const authUrl = "https://api.mstock.trade/openapi/typea/session/verifytotp";
      
      const authData = new URLSearchParams();
      authData.append('api_key', apiKey);
      authData.append('totp', currentTotp);

      const response = await axios.post(authUrl, authData, {
        headers: {
          'X-Mirae-Version': '1',
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      console.log("[MSTOCK AUTH] Full response:", JSON.stringify(response.data));

      if (response.data?.status === "true" || response.data?.status === "success" || response.data?.status === true) {
        const jwtToken = response.data?.data?.jwtToken
                       || response.data?.data?.access_token 
                       || response.data?.data?.enctoken 
                       || response.data?.data?.token
                       || response.data?.jwtToken
                       || response.data?.access_token 
                       || response.data?.enctoken;
        if (!jwtToken) {
           throw new Error("Login did not return a known token. Status was success.");
        }

        console.log("[MSTOCK SERVICE] Authentication Successful! JWT Extracted.");
        this.cachedToken = jwtToken;
        this.tokenExpiry = Date.now() + (6 * 60 * 60 * 1000);  // expire after 6 hours
        return jwtToken;
      } else {
        throw new Error(`Authentication rejected: ${response.data?.message || "Unknown error"}`);
      }
    } catch (error: any) {
      console.error("[MSTOCK SERVICE] m.Stock authentication fallback error:", error.message);
      throw new Error(`m.Stock authentication failed: ${error.response?.data?.message || error.message}`);
    }
  }

  static async getMstockJwtToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.tokenExpiry) {
      return this.cachedToken;
    }
    this.cachedToken = null;
    this.scripMasterData = null;
    console.log("[MSTOCK SERVICE] Token missing or expired, re-authenticating...");
    try {
        return await this.autoLoginWithTOTP();
    } catch (e: any) {
        throw new Error("Mstock is not authenticated. Login dynamically failed: " + e.message);
    }
  }

  static async authenticate() {
    const apiKey = process.env.MSTOCK_API_KEY;
    const apiSecret = process.env.MSTOCK_API_SECRET;
    if (!apiKey) {
      throw new Error("MSTOCK_API_KEY is not defined in environment variables");
    }
    // Perform authentication with Mstock API
    // Since we don't have the exact undocumented endpoints, we will do a placeholder
    // that might fail if trying to hit a real undocumented url, revealing the error to the user
    console.log("Mstock Auth with key:", apiKey, "Secret:", apiSecret ? "***" : "None");
    return true;
  }

  static async getCurrentPrices(symbols: string[]) {
    // For Mstock, if we don't have their quote API mapped out,
    // we can return empty to trigger the Yahoo fallback, or try fetching.
    // Let's just return empty so it falls back to Yahoo gracefully.
    return {};
  }

  private static scripMasterData: any[] | null = null;

  static async getSymbolToken(symbol: string, apiKey: string, sessionToken: string): Promise<{token: string; tradingSymbol: string} | null> {
    if (!this.scripMasterData) {
      console.log("[MSTOCK] Downloading live master scrip file from m.Stock...");
      const url = "https://api.mstock.trade/openapi/typeb/instruments/OpenAPIScripMaster";
      const response = await axios.get(url, {
        headers: {
            "X-Mirae-Version": "1",
            "Authorization": `Bearer ${sessionToken}`,
            "X-PrivateKey": apiKey
        }
      });
      if (Array.isArray(response.data)) {
        this.scripMasterData = response.data;
      } else if (response.data?.data && Array.isArray(response.data.data)) {
        this.scripMasterData = response.data.data;
      } else {
        throw new Error("Invalid scrip master data format");
      }
    }

    for (const item of this.scripMasterData) {
        // mStock scrip master fields: token, symbol, name, exch_seg, instrumenttype
        const exchSeg = (item.exch_seg || item.exchange || '').toUpperCase();
        const plainSymbol = (item.symbol || '').toUpperCase();        // e.g. "RVNL"
        const tradingName = (item.name || item.symbol || '').toUpperCase(); // e.g. "RVNL-EQ"
        const instrType = (item.instrumenttype || '').toUpperCase();

        // Match NSE equity only: exch_seg=NSE, instrumenttype=EQ, symbol=GRASIM
        if (exchSeg === 'NSE' && instrType === 'EQ' && plainSymbol === symbol.toUpperCase()) {
            console.log(`[MSTOCK] Found scrip: symbol=${item.symbol}, name=${item.name}, token=${item.token}`);
            return {
                token: String(item.token),
                tradingSymbol: String(item.name)   // "GRASIM-EQ" — what order API expects
            };
        }
    }
    return null;
  }

  static async placeOrder(symbol: string, quantity: number = 1, price: number = 0) {
    const apiKey = process.env.MSTOCK_API_KEY;
    
    let sessionToken = null;
    try {
        sessionToken = await this.getMstockJwtToken();
    } catch (e: any) {
        throw new Error("Mstock Auth Failed: " + e.message);
    }
    
    if (!apiKey || !sessionToken) {
      throw new Error("Mstock Auth Failed. Missing API Key or session is not active. Cannot trade.");
    }
    
    const symbolInfo = await this.getSymbolToken(symbol, apiKey!, sessionToken);
    if (!symbolInfo) {
       throw new Error(`Symbol token not found for ${symbol}`);
    }

    const orderUrl = 'https://api.mstock.trade/openapi/typeb/orders/regular';

    const orderHeaders = {
      'X-Mirae-Version': '1',
      'X-PrivateKey': apiKey,
      'Authorization': `Bearer ${sessionToken}`,
      'Content-Type': 'application/json'
    };

    try {
      const orderPayload = {
        variety: "NORMAL",
        tradingsymbol: symbolInfo.tradingSymbol,
        symboltoken: symbolInfo.token,
        exchange: "NSE",
        transactiontype: "BUY",       // ← was txntype
        ordertype: price > 0 ? "LIMIT" : "MARKET",
        quantity: quantity.toString(),
        producttype: "MARGIN",           // ← change from "DELIVERY"
        price: price > 0 ? (Math.round(price * 20) / 20).toFixed(2) : "0",
        triggerprice: "0",            // ← was missing
        squareoff: "0",               // ← was missing
        stoploss: "0",                // ← was missing
        trailingStopLoss: "",         // ← was missing
        disclosedquantity: "0",        // ← was missing
        duration: "DAY",              // ← was validity
        ordertag: ""                  // ← was missing
      };

      console.log(`[BROKER] Placing order — full payload: ${JSON.stringify(orderPayload)}`);

      const response = await axios({
        method: 'POST',               // ← was GET
        url: orderUrl,
        headers: orderHeaders,
        data: orderPayload            // ← was params
      });

      console.log("[SUCCESS] Order Server Accepted Request:", response.data);
      if (response.data?.status === 'true' || response.data?.status === true || response.data?.status === 'success') {
        return response.data?.data?.orderid;           // ← was response.data.orderId
      } else {
        throw new Error(response.data?.message || "Order rejected by broker");
      }
    } catch (error: any) {
      console.error(`[ERROR] Order placement failed for ${symbolInfo.tradingSymbol}:`);
      if (error.response) {
        console.error(`Status Code: ${error.response.status}`);
        console.error("Server Message:", error.response.data);
        throw new Error(`ERROR: ${error.response?.data?.message || error.message || "Unknown error placing order on Mstock"}`);
      } else {
        console.error("Network Error:", error.message);
        throw new Error(`ERROR: ${error.message || "Unknown error placing order on Mstock"}`);
      }
    }
  }

  static async getPortfolioHoldings() {
    const apiKey = process.env.MSTOCK_API_KEY || process.env.BROKER_API_KEY;
    
    try {
      // Fetch the fresh dynamically updated morning session token
      const jwtToken = await this.getMstockJwtToken();
      if (!apiKey) {
        console.warn("[MSTOCK] MSTOCK_API_KEY or BROKER_API_KEY is not defined in environment variables");
        return null;
      }

      console.log("[MSTOCK SERVICE] Fetching portfolio holdings with dynamically generated JWT token...");
      const response = await axios.get('https://api.mstock.trade/openapi/typeb/portfolio/holdings', {
        headers: {
          'X-Mirae-Version': '1',
          'Authorization': `Bearer ${jwtToken}`,
          'X-PrivateKey': apiKey,
        },
        timeout: 10000
      });
      console.log("[MSTOCK SERVICE] Response from API:", JSON.stringify(response.data));
      return response.data;
    } catch (error: any) {
      console.error("[MSTOCK SERVICE] Error fetching portfolio holdings:", error.response?.data || error.message);
      throw new Error(`Mstock API Error: ${error.response?.data?.message || error.message}`);
    }
  }

  static normalizeHoldings(rawData: any): any[] {
    if (!rawData) return [];
    
    let list: any[] = [];
    if (Array.isArray(rawData)) {
      list = rawData;
    } else if (rawData && typeof rawData === 'object') {
      const arrays = [
        rawData.data,
        rawData.holdings,
        rawData.result,
        rawData.response,
        rawData.holdingsList,
        rawData.listOfHoldings
      ];
      const foundArray = arrays.find(a => Array.isArray(a));
      if (foundArray) {
        list = foundArray;
      } else {
        list = [rawData];
      }
    }

    return list.map(item => {
      if (!item || typeof item !== 'object') return null;

      // Extract symbol
      const symbolCandidates = [
        item.symbol,
        item.tradingSymbol,
        item.trading_symbol,
        item.scripName,
        item.scripCode,
        item.isin,
        item.symbolName,
        item.stockName
      ];
      let rawSymbol = symbolCandidates.find(s => typeof s === 'string' || typeof s === 'number') || 'UNKNOWN';
      let symbol = String(rawSymbol).toUpperCase();
      if (symbol && !symbol.includes('.') && !symbol.includes('^') && symbol !== 'UNKNOWN') {
        symbol = `${symbol}.NS`;
      }

      // Extract quantity
      const qtyCandidates = [
        item.qty,
        item.quantity,
        item.holdQty,
        item.holdQuantity,
        item.netQty,
        item.netQuantity,
        item.totalQty,
        item.balanceQty
      ];
      const qtyStr = qtyCandidates.find(q => typeof q === 'number' || (typeof q === 'string' && q !== ''));
      const qty = qtyStr !== undefined ? Number(qtyStr) : 0;

      // Extract avgPrice
      const avgPriceCandidates = [
        item.avgPrice,
        item.averagePrice,
        item.avg_price,
        item.buyPrice,
        item.avg_cost,
        item.average_cost,
        item.costPrice,
        item.price
      ];
      const avgPriceStr = avgPriceCandidates.find(p => typeof p === 'number' || (typeof p === 'string' && p !== ''));
      const avgPrice = avgPriceStr !== undefined ? Number(avgPriceStr) : 0;

      // Extract currentPrice
      const currentPriceCandidates = [
        item.currentPrice,
        item.ltp,
        item.lastTradedPrice,
        item.closePrice,
        item.current_price,
        item.last_price,
        item.lastPrice
      ];
      const currentPriceStr = currentPriceCandidates.find(p => typeof p === 'number' || (typeof p === 'string' && p !== ''));
      const currentPrice = currentPriceStr !== undefined ? Number(currentPriceStr) : avgPrice;

      const value = Number((qty * currentPrice).toFixed(2));
      const pnl = Number((value - (qty * avgPrice)).toFixed(2));

      return {
        symbol,
        qty,
        avgPrice: Number(avgPrice.toFixed(2)),
        currentPrice: Number(currentPrice.toFixed(2)),
        pnl,
        value
      };
    }).filter(Boolean);
  }
}
