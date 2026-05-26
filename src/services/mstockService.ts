import axios from 'axios';
import * as OTPAuth from 'otpauth';
import { FNO_STOCKS, MTF_MARGINS } from './marketDataService';

export class MstockService {
  private static cachedToken: string | null = null;
  private static tokenExpiry: number = 0;
  private static MSTOCK_BASE_URL = "https://tradingapi.mstock.com/v1";

  public static tokenToSymbolMap = new Map<string, string>();
  public static cachedUserId: string | null = null;
  public static cachedApiKey: string | null = null;
  public static cachedAccessToken: string | null = null;

  static getEqTokenOnlySync(symbol: string): string | null {
     if (!this.scripMasterDataMap) return null;
     return this.scripMasterDataMap.get(symbol.toUpperCase())?.token || null;
  }
  
  static getFutTokenOnlySync(symbol: string): string | null {
     if (!this.scripMasterFuturesMap) return null;
     const futures = this.scripMasterFuturesMap.get(symbol.toUpperCase()) || [];
     if (futures.length === 0) return null;
     const sorted = [...futures].sort((a, b) => {
         const d1 = new Date(a.expiryStr).getTime();
         const d2 = new Date(b.expiryStr).getTime();
         return (d1 || Infinity) - (d2 || Infinity);
     });
     return sorted[0]?.token || null;
  }

  static getSymbolFromTokenSync(token: string): string | null {
     return this.tokenToSymbolMap.get(token) || null;
  }

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

        // Save for WebSocket
        this.cachedUserId = response.data?.data?.user_id || "1199015";
        this.cachedApiKey = response.data?.data?.api_key || apiKey;
        this.cachedAccessToken = response.data?.data?.access_token || jwtToken;

        // Lazy initialize and connect WebSocket subscription stream
        import('./mstockSocketService').then(({ MstockSocketService }) => {
            if (this.cachedUserId && this.cachedAccessToken && this.cachedApiKey) {
                MstockSocketService.connect(this.cachedUserId, this.cachedAccessToken, this.cachedApiKey).catch(wsErr => {
                    console.error("[MSTOCK SERVICE] Websocket initial connection error:", wsErr);
                });
            }
        }).catch(wsImportErr => {
            console.error("[MSTOCK SERVICE] Failed to import MstockSocketService module:", wsImportErr);
        });

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
    this.scripMasterDataMap = null;
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
    try {
      const apiKey = process.env.MSTOCK_API_KEY;
      if (!apiKey) return {};
      
      const sessionToken = await this.getMstockJwtToken();
      if (!sessionToken) return {};

      // Load streaming state from live web socket cache
      const { MstockSocketService } = await import('./mstockSocketService');
      
      const nseTokens: string[] = [];
      const symMap: Record<string, string> = {};
      const result: Record<string, {price: number, volume: number, prevClose: number}> = {};

      for (const rawSym of symbols) {
         const cleanSym = rawSym.replace(".NS", "").replace(".BO", "").toUpperCase();
         const eqTokenInfo = this.getEqTokenOnlySync(cleanSym);
         const cached = MstockSocketService.liveStateMap[cleanSym] || (eqTokenInfo ? MstockSocketService.liveStateMap[eqTokenInfo] : null);

         if (cached && cached.price > 0) {
            result[cleanSym] = {
                price: cached.price,
                volume: cached.volume,
                prevClose: cached.prevClose
            };
         } else {
             // Fallback to HTTP query
             const info = await this.getSymbolToken(cleanSym, apiKey, sessionToken);
             if (info && info.token) {
                 nseTokens.push(info.token);
                 symMap[info.token] = cleanSym;
             }
         }
      }

      if (nseTokens.length === 0) return result;

      const url = "https://api.mstock.trade/openapi/typeb/instruments/quote";
      const body = {
          mode: "FULL",
          exchangeTokens: {
              NSE: nseTokens
          }
      };

      const response = await axios({
          method: 'POST',
          url: url,
          headers: {
              'X-Mirae-Version': '1',
              'Authorization': `Bearer ${sessionToken}`,
              'X-PrivateKey': apiKey,
              'Content-Type': 'application/json'
          },
          data: body 
      });

       if (response.data && response.data.data && Array.isArray(response.data.data.fetched)) {
          if (response.data.data.fetched.length > 0) {
              console.log("[MSTOCK DEBUG] FETCHED KEYS:", Object.keys(response.data.data.fetched[0]), "SAMPLE:", JSON.stringify(response.data.data.fetched[0]));
          }
          for (const item of response.data.data.fetched) {
              const sym = symMap[item.symbolToken];
              if (sym) {
                  result[sym] = {
                      price: item.ltp || item.close || item.c || item.price || 0,
                      volume: item.volume || item.vtt || item.v || item.vol || item.traded_quantity || item.volume_traded || item.tradedVolume || item.lastTradedVolume || item.tradedQty || item.totalTradedVolume || 0,
                      prevClose: item.pc || item.previousClose || item.closePrice || item.close || item.c || 0
                  };
              }
          }
      }
      return result;
    } catch (e: any) {
      console.error("[MSTOCK] Error fetching live quotes:", e.response?.data || e.message);
      return {};
    }
  }

  static async getCurrentFuturePrices(symbols: string[]) {
    try {
      const apiKey = process.env.MSTOCK_API_KEY;
      if (!apiKey) return {};
      
      const sessionToken = await this.getMstockJwtToken();
      if (!sessionToken) return {};

      // Load streaming state from live web socket cache
      const { MstockSocketService } = await import('./mstockSocketService');

      const nfoTokens: string[] = [];
      const symMap: Record<string, string> = {};
      const result: Record<string, {price: number, volume: number, prevClose: number, lotSize?: number}> = {};

      for (const rawSym of symbols) {
         const cleanSym = rawSym.replace(".NS", "").replace(".BO", "").toUpperCase();
         const futTokenInfo = this.getFutTokenOnlySync(cleanSym);
         const cached = MstockSocketService.liveStateMap[cleanSym] || (futTokenInfo ? MstockSocketService.liveStateMap[futTokenInfo] : null);

         if (cached && cached.price > 0) {
            const info = await this.getFutureSymbolToken(cleanSym, apiKey, sessionToken);
            result[cleanSym] = {
                price: cached.price,
                volume: cached.volume,
                prevClose: cached.prevClose,
                lotSize: info?.lotSize || 1
            };
         } else {
             // Fallback to HTTP query
             const info = await this.getFutureSymbolToken(cleanSym, apiKey, sessionToken);
             if (info && info.token) {
                 nfoTokens.push(info.token);
                 symMap[info.token] = cleanSym;
             }
         }
      }

      if (nfoTokens.length === 0) return result;

      const url = "https://api.mstock.trade/openapi/typeb/instruments/quote";
      const body = {
          mode: "FULL",
          exchangeTokens: {
              NFO: nfoTokens
          }
      };

      const response = await axios({
          method: 'POST',
          url: url,
          headers: {
              'X-Mirae-Version': '1',
              'Authorization': `Bearer ${sessionToken}`,
              'X-PrivateKey': apiKey,
              'Content-Type': 'application/json'
          },
          data: body 
      });

      if (response.data && response.data.data && Array.isArray(response.data.data.fetched)) {
          if (response.data.data.fetched.length > 0) {
              console.log("[MSTOCK FUT DEBUG] FETCHED KEYS:", Object.keys(response.data.data.fetched[0]), "SAMPLE:", JSON.stringify(response.data.data.fetched[0]));
          }
          for (const item of response.data.data.fetched) {
              const sym = symMap[item.symbolToken];
              if (sym) {
                  const info = await this.getFutureSymbolToken(sym, apiKey, sessionToken);
                  result[sym] = {
                      price: item.ltp || item.close || item.c || item.price || 0,
                      volume: item.volume || item.vtt || item.v || item.vol || item.traded_quantity || item.volume_traded || item.tradedVolume || item.lastTradedVolume || item.tradedQty || item.totalTradedVolume || 0,
                      prevClose: item.pc || item.previousClose || item.closePrice || item.close || item.c || 0,
                      lotSize: info?.lotSize || 1
                  };
              }
          }
      }
      return result;
    } catch (e: any) {
      console.error("[MSTOCK] Error fetching live future quotes:", e.message);
      return {};
    }
  }

  private static scripMasterDataMap: Map<string, {token: string; tradingSymbol: string}> | null = null;
  private static scripMasterFuturesMap: Map<string, {token: string; tradingSymbol: string; expiryStr: string; lotSize: number}[]> | null = null;
  private static scripMasterOptionsMap: Map<string, {token: string; tradingSymbol: string; expiryStr: string; lotSize: number; strike: number; optionType: 'CE' | 'PE'}[]> | null = null;

  static async getSymbolToken(symbol: string, apiKey: string, sessionToken: string): Promise<{token: string; tradingSymbol: string} | null> {
    await this.initScripMaster(apiKey, sessionToken);
    return this.scripMasterDataMap?.get(symbol.toUpperCase()) || null;
  }

  static async getFutureSymbolToken(symbol: string, apiKey: string, sessionToken: string): Promise<{token: string; tradingSymbol: string; lotSize: number} | null> {
    await this.initScripMaster(apiKey, sessionToken);
    const futures = this.scripMasterFuturesMap?.get(symbol.toUpperCase()) || [];
    if (futures.length === 0) return null;
    
    // Sort by expiry (assuming format like 28Jul2026 => parse it)
    const sorted = [...futures].sort((a, b) => {
        const d1 = new Date(a.expiryStr).getTime();
        const d2 = new Date(b.expiryStr).getTime();
        return (d1 || Infinity) - (d2 || Infinity);
    });
    
    return sorted[0];
  }

  static async getAtmOptionSymbolToken(symbol: string, apiKey: string, sessionToken: string, targetOption: 'CALL' | 'PUT', spotPrice: number): Promise<{token: string; tradingSymbol: string; lotSize: number; strike: number} | null> {
    await this.initScripMaster(apiKey, sessionToken);
    const options = this.scripMasterOptionsMap?.get(symbol.toUpperCase()) || [];
    if (options.length === 0) return null;

    const reqOptType = targetOption === 'CALL' ? 'CE' : 'PE';
    
    // Sort by expiry
    const sorted = [...options]
      .filter(x => x.optionType === reqOptType)
      .sort((a, b) => {
        const d1 = new Date(a.expiryStr).getTime();
        const d2 = new Date(b.expiryStr).getTime();
        return (d1 || Infinity) - (d2 || Infinity);
    });

    if (sorted.length === 0) return null;

    // Grab the nearest expiry
    const nearestExpiry = sorted[0].expiryStr;
    const currentExpiryOptions = sorted.filter(x => x.expiryStr === nearestExpiry);

    // Find the one with strike closest to spotPrice
    let closestOpt = currentExpiryOptions[0];
    let minDiff = Math.abs(closestOpt.strike - spotPrice);

    for (const opt of currentExpiryOptions) {
        const diff = Math.abs(opt.strike - spotPrice);
        if (diff < minDiff) {
            closestOpt = opt;
            minDiff = diff;
        }
    }

    return closestOpt;
  }

  private static async initScripMaster(apiKey: string, sessionToken: string) {
    if (!this.scripMasterDataMap) {
      console.log("[MSTOCK] Downloading live master scrip file from m.Stock...");
      const url = "https://api.mstock.trade/openapi/typeb/instruments/OpenAPIScripMaster";
      const response = await axios.get(url, {
        headers: {
            "X-Mirae-Version": "1",
            "Authorization": `Bearer ${sessionToken}`,
            "X-PrivateKey": apiKey
        }
      });
      let arrayData = [];
      if (Array.isArray(response.data)) {
        arrayData = response.data;
      } else if (response.data?.data && Array.isArray(response.data.data)) {
        arrayData = response.data.data;
      } else {
        throw new Error("Invalid scrip master data format");
      }

      this.scripMasterDataMap = new Map();
      this.scripMasterFuturesMap = new Map();
      this.scripMasterOptionsMap = new Map();
      this.tokenToSymbolMap = new Map();
      
      const now = Date.now();

      for (const item of arrayData) {
        const exchSeg = (item.exch_seg || item.exchange || '').toUpperCase();
        const plainSymbol = (item.symbol || '').toUpperCase();
        const tradingName = (item.name || item.symbol || '').toUpperCase();
        const instrType = (item.instrumenttype || '').toUpperCase();

        if (exchSeg === 'NSE' && instrType === 'EQ') {
          const tokenStr = String(item.token);
          this.scripMasterDataMap.set(plainSymbol, {
            token: tokenStr,
            tradingSymbol: String(item.name)
          });
          this.tokenToSymbolMap.set(tokenStr, plainSymbol);
        }
        
        if (exchSeg === 'NFO' && instrType === 'FUTSTK') {
           const tokenStr = String(item.token);
           this.tokenToSymbolMap.set(tokenStr, plainSymbol);
           const expiryStr = String(item.expiry || '');
           const expDate = new Date(expiryStr).getTime();
           if (!isNaN(expDate) && expDate > now - 86400000) {
               if (!this.scripMasterFuturesMap.has(plainSymbol)) {
                   this.scripMasterFuturesMap.set(plainSymbol, []);
               }
               this.scripMasterFuturesMap.get(plainSymbol)!.push({
                   token: tokenStr,
                   tradingSymbol: String(item.name),
                   expiryStr,
                   lotSize: Number(item.lotsize) || 1
               });
           }
        }

        if (exchSeg === 'NFO' && instrType === 'OPTSTK') {
           const tokenStr = String(item.token);
           this.tokenToSymbolMap.set(tokenStr, plainSymbol);
           const expiryStr = String(item.expiry || '');
           const expDate = new Date(expiryStr).getTime();
           if (!isNaN(expDate) && expDate > now - 86400000) {
               if (!this.scripMasterOptionsMap.has(plainSymbol)) {
                   this.scripMasterOptionsMap.set(plainSymbol, []);
               }
               
               const rawStrike = Number(item.strike || item.strikeprice);
               const strike = isNaN(rawStrike) ? 0 : rawStrike / 100; // it's usually in multiples of 100 on Indian exchanges if it has no decimal
               // Note: check the data format carefully, some might say 'strike' with 2 trailing decimals, eg 250000 = 2500.
               // It's safer to use parseFloat(item.strike) directly.
               const parsedStrike = Number.parseFloat(String(item.strike || item.strikeprice));

               this.scripMasterOptionsMap.get(plainSymbol)!.push({
                   token: tokenStr,
                   tradingSymbol: String(item.name),
                   expiryStr,
                   lotSize: Number(item.lotsize) || 1,
                   strike: isNaN(parsedStrike) ? 0 : parsedStrike,
                   optionType: item.optiontype === 'PE' ? 'PE' : 'CE'
               });
           }
        }
      }
      console.log(`[MSTOCK] Indexed ${this.scripMasterDataMap.size} NSE symbols, ${this.scripMasterFuturesMap.size} Futures, ${this.scripMasterOptionsMap.size} Options.`);
    }
  }

  static async placeCoverOrder(symbol: string, quantity: number = 1, entryPrice: number, stopLossPrice: number, direction: 'BUY' | 'SELL' = 'BUY') {
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
    
    const symbolInfo = await this.getFutureSymbolToken(symbol, apiKey!, sessionToken);
    if (!symbolInfo) {
       throw new Error(`Future symbol token not found for ${symbol}. Market lot and symbol cannot be resolved.`);
    }

    const orderUrl = 'https://api.mstock.trade/openapi/typeb/orders/regular';

    const orderHeaders = {
      'X-Mirae-Version': '1',
      'X-PrivateKey': apiKey,
      'Authorization': `Bearer ${sessionToken}`,
      'Content-Type': 'application/json'
    };

    let finalQuantity = quantity;
    if (quantity < symbolInfo.lotSize) {
        finalQuantity = symbolInfo.lotSize;
    } else {
        finalQuantity = Math.floor(quantity / symbolInfo.lotSize) * symbolInfo.lotSize;
    }

    try {
      const orderPayload = {
        variety: "regular",
        tradingsymbol: symbolInfo.tradingSymbol,
        symboltoken: symbolInfo.token,
        exchange: "NFO",
        transactiontype: direction,       
        ordertype: "LIMIT",
        quantity: finalQuantity.toString(),
        producttype: "INTRADAY",
        price: (Math.round(entryPrice * 20) / 20).toFixed(2),
        triggerprice: "0",            
        squareoff: "0",               
        stoploss: "0",                
        trailingStopLoss: "",         
        disclosedquantity: "0",        
        duration: "DAY",              
        ordertag: ""                  
      };

      console.log(`[BROKER] Placing Cover Order — full payload: ${JSON.stringify(orderPayload)}`);

      const response = await axios({
        method: 'POST',
        url: orderUrl,
        headers: orderHeaders,
        data: orderPayload
      });

      console.log("[SUCCESS] Broker Accepted Request:", response.data);
      if (response.data?.status === 'true' || response.data?.status === true || response.data?.status === 'success') {
        return response.data?.data?.orderid;
      } else {
        throw new Error(response.data?.message || "Order rejected by broker");
      }
    } catch (error: any) {
      console.error(`[ERROR] Cover Order placement failed for ${symbolInfo.tradingSymbol}:`);
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

  static async placeOptionBracketOrder(
    baseSymbol: string, 
    optionType: 'CALL' | 'PUT', 
    spotPrice: number, 
    quantity: number
  ) {
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

    const symbolInfo = await this.getAtmOptionSymbolToken(baseSymbol, apiKey, sessionToken, optionType, spotPrice);
    if (!symbolInfo) {
       throw new Error(`ATM Option symbol token not found for ${baseSymbol}. Market lot and symbol cannot be resolved.`);
    }

    // Fetch the live option price
    const quoteUrl = `https://api.mstock.trade/openapi/typeb/marketdata/Livequotes?exchange=NFO&symbolToken=${symbolInfo.token}`;
    const quoteHeaders = {
        'X-Mirae-Version': '1',
        'X-PrivateKey': apiKey,
        'Authorization': `Bearer ${sessionToken}`
    };

    let optionLtp = 0;
    try {
        const quoteRes = await axios.get(quoteUrl, { headers: quoteHeaders });
        if (quoteRes.data && quoteRes.data.data && Array.isArray(quoteRes.data.data.fetched) && quoteRes.data.data.fetched.length > 0) {
            optionLtp = quoteRes.data.data.fetched[0].ltp;
        }
    } catch (e: any) {
        console.warn(`[BROKER] Failed to fetch live option quote for token ${symbolInfo.token}: ${e.message}`);
    }

    if (!optionLtp || optionLtp <= 0) {
       throw new Error(`Failed to retrieve live price for option ${symbolInfo.tradingSymbol}. Order aborted.`);
    }

    // Bracket Logic: 
    // Target = 40% gain, StopLoss = 20% loss
    const entryPrice = optionLtp;
    const stopLossPrice = optionLtp * 0.80;
    const targetPrice = optionLtp * 1.40;

    const orderUrl = 'https://api.mstock.trade/openapi/typeb/orders/regular';

    const orderHeaders = {
      'X-Mirae-Version': '1',
      'X-PrivateKey': apiKey,
      'Authorization': `Bearer ${sessionToken}`,
      'Content-Type': 'application/json'
    };

    let finalQuantity = quantity;
    if (quantity < symbolInfo.lotSize) {
        finalQuantity = symbolInfo.lotSize;
    } else {
        finalQuantity = Math.floor(quantity / symbolInfo.lotSize) * symbolInfo.lotSize;
    }

    const stopLossDiff = Math.abs(entryPrice - stopLossPrice);
    const targetDiff = Math.abs(targetPrice - entryPrice);

    try {
      const orderPayload = {
        variety: "bo",
        tradingsymbol: symbolInfo.tradingSymbol,
        symboltoken: symbolInfo.token,
        exchange: "NFO",
        transactiontype: "BUY",       
        ordertype: "LIMIT",
        quantity: finalQuantity.toString(),
        producttype: "INTRADAY",
        price: (Math.round(entryPrice * 20) / 20).toFixed(2),
        triggerprice: "0",            
        squareoff: (Math.round(targetDiff * 20) / 20).toFixed(2),               
        stoploss: (Math.round(stopLossDiff * 20) / 20).toFixed(2),                
        trailingStopLoss: "",         
        disclosedquantity: "0",        
        duration: "DAY",              
        ordertag: ""                  
      };

      console.log(`[BROKER] Placing Option Bracket Order — full payload: ${JSON.stringify(orderPayload)}`);

      const response = await axios({
        method: 'POST',
        url: orderUrl,
        headers: orderHeaders,
        data: orderPayload
      });

      console.log("[SUCCESS] Broker Accepted Request:", response.data);
      if (response.data?.status === 'true' || response.data?.status === true || response.data?.status === 'success') {
        const orderId = response.data?.data?.orderid;
        return {
            orderId,
            entryPrice,
            stopLossPrice,
            targetPrice,
            tradingSymbol: symbolInfo.tradingSymbol
        };
      } else {
        throw new Error(response.data?.message || "Order rejected by broker");
      }
    } catch (error: any) {
      console.error(`[ERROR] Option Bracket Order placement failed for ${symbolInfo.tradingSymbol}:`);
      if (error.response) {
        throw new Error(`ERROR: ${error.response?.data?.message || error.message || "Unknown error placing order on Mstock"}`);
      } else {
        throw new Error(`ERROR: ${error.message || "Unknown error placing order on Mstock"}`);
      }
    }
  }

  static async placeBracketOrder(symbol: string, quantity: number = 1, entryPrice: number, stopLossPrice: number, targetPrice: number) {
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
    
    const symbolInfo = await this.getFutureSymbolToken(symbol, apiKey!, sessionToken);
    if (!symbolInfo) {
       throw new Error(`Future symbol token not found for ${symbol}. Market lot and symbol cannot be resolved.`);
    }

    const orderUrl = 'https://api.mstock.trade/openapi/typeb/orders/regular';

    const orderHeaders = {
      'X-Mirae-Version': '1',
      'X-PrivateKey': apiKey,
      'Authorization': `Bearer ${sessionToken}`,
      'Content-Type': 'application/json'
    };

    let finalQuantity = quantity;
    if (quantity < symbolInfo.lotSize) {
        finalQuantity = symbolInfo.lotSize;
    } else {
        finalQuantity = Math.floor(quantity / symbolInfo.lotSize) * symbolInfo.lotSize;
    }

    // Usually BO uses absolute diffs for target/sl points
    const stopLossDiff = Math.abs(entryPrice - stopLossPrice);
    const targetDiff = Math.abs(targetPrice - entryPrice);

    try {
      const orderPayload = {
        variety: "bo",
        tradingsymbol: symbolInfo.tradingSymbol,
        symboltoken: symbolInfo.token,
        exchange: "NFO",
        transactiontype: "BUY",       
        ordertype: "LIMIT",
        quantity: finalQuantity.toString(),
        producttype: "INTRADAY",
        price: (Math.round(entryPrice * 20) / 20).toFixed(2),
        triggerprice: "0",            
        squareoff: (Math.round(targetDiff * 20) / 20).toFixed(2),               
        stoploss: (Math.round(stopLossDiff * 20) / 20).toFixed(2),                
        trailingStopLoss: "",         
        disclosedquantity: "0",        
        duration: "DAY",              
        ordertag: ""                  
      };

      console.log(`[BROKER] Placing Bracket Order — full payload: ${JSON.stringify(orderPayload)}`);

      const response = await axios({
        method: 'POST',
        url: orderUrl,
        headers: orderHeaders,
        data: orderPayload
      });

      console.log("[SUCCESS] Broker Accepted Request:", response.data);
      if (response.data?.status === 'true' || response.data?.status === true || response.data?.status === 'success') {
        return response.data?.data?.orderid;
      } else {
        throw new Error(response.data?.message || "Order rejected by broker");
      }
    } catch (error: any) {
      console.error(`[ERROR] Bracket Order placement failed for ${symbolInfo.tradingSymbol}:`);
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

  static async placeStopLossOrder(symbol: string, quantity: number, stopLossPrice: number, productType: string = "MTF", providedSymbolToken?: string, providedTradingSymbol?: string) {
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
    
    // For EQ we use getSymbolToken, for NFO we use getFutureSymbolToken
    let isFno = false;
    let symbolInfo: any = null;

    if (providedSymbolToken && providedTradingSymbol) {
       symbolInfo = {
          token: providedSymbolToken,
          tradingSymbol: providedTradingSymbol
       };
       if (symbol.includes("^") || symbol.includes("FUT")) {
          isFno = true;
       }
    } else {
       symbolInfo = await this.getSymbolToken(symbol, apiKey!, sessionToken);
      
       if (!symbolInfo) {
         symbolInfo = await this.getFutureSymbolToken(symbol, apiKey!, sessionToken);
         isFno = true;
       }
    }
    
    if (!symbolInfo) {
       throw new Error(`Symbol token not found for ${symbol}. Cannot resolve symbol for stop loss.`);
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
        variety: "regular",
        tradingsymbol: symbolInfo.tradingSymbol,
        symboltoken: symbolInfo.token,
        exchange: isFno ? "NFO" : "NSE",
        transactiontype: "SELL",       
        ordertype: "SL-LMT",   // Alternatively "SL" depending on broker
        quantity: quantity.toString(),
        producttype: isFno ? "INTRADAY" : productType, // Usually MTF or DELIVERY
        price: (Math.round(stopLossPrice * 0.99 * 20) / 20).toFixed(2), // slight buffer below trigger
        triggerprice: (Math.round(stopLossPrice * 20) / 20).toFixed(2),            
        squareoff: "0",               
        stoploss: "0",                
        trailingStopLoss: "",         
        disclosedquantity: "0",        
        duration: "DAY",              
        ordertag: ""                  
      };

      console.log(`[BROKER] Placing Stop Loss Order — full payload: ${JSON.stringify(orderPayload)}`);

      const response = await axios({
        method: 'POST',
        url: orderUrl,
        headers: orderHeaders,
        data: orderPayload
      });

      console.log("[SUCCESS] Broker Accepted Request:", response.data);
      if (response.data?.status === 'true' || response.data?.status === true || response.data?.status === 'success') {
        return response.data?.data?.orderid;
      } else {
        throw new Error(response.data?.message || "Order rejected by broker");
      }
    } catch (error: any) {
      console.error(`[ERROR] Stop Loss Order placement failed for ${symbolInfo.tradingSymbol}:`);
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

      console.log('[MSTOCK SERVICE] Fetching client portfolio holdings...');
      const url = 'https://api.mstock.trade/openapi/typeb/portfolio/holdings';

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Mirae-Version': '1',
          'X-PrivateKey': apiKey,
          // The API explicitly notes 'Bearer jwtToken' format
          'Authorization': jwtToken.startsWith('Bearer ') ? jwtToken : `Bearer ${jwtToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP Error Status: ${response.status}`);
      }

      const result: any = await response.json();

      const isSuccessful = result.status === "true" || result.status === true || String(result.status).toLowerCase() === "success";

      if (isSuccessful) {
        const holdingsList = result.data || [];
        console.log(`[MSTOCK SERVICE] Connection clear. Retrieved ${holdingsList.length} long-term holding items.`);
        return this.normalizeHoldings(holdingsList);
      } else {
        console.error(`[MSTOCK SERVICE] Portfolio fetch rejected: ${result.message} (Code: ${result.errorcode})`);
        return null;
      }
    } catch (error: any) {
      console.error('[MSTOCK SERVICE] Network or Parsing Error while retrieving portfolio:', error instanceof Error ? error.message : error);
      throw new Error(`Mstock API Error: ${error.message}`);
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
        item.tradingsymbol,
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
        item.averageprice,
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

      // Extract symboltoken and plain tradingsymbol for order placement
      const symbolToken = item.symboltoken || item.symbolToken || item.token || "";
      const rawTradingSymbol = item.tradingsymbol || item.tradingSymbol || item.symbol || "";

      let type = 'CASH';
      const cleanSymbol = symbol.replace('.NS', '').replace('.BO', '');
      if (FNO_STOCKS.includes(cleanSymbol)) {
         type = 'FNO';
      } else if (MTF_MARGINS[cleanSymbol]) {
         type = 'MTF';
      }

      return {
        symbol,
        cleanSymbol,
        tradingSymbol: rawTradingSymbol,
        symbolToken: String(symbolToken),
        qty,
        avgPrice: Number(avgPrice.toFixed(2)),
        currentPrice: Number(currentPrice.toFixed(2)),
        pnl,
        value,
        type
      };
    }).filter(Boolean);
  }
}
