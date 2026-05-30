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
    console.log("Mstock Auth with key:", apiKey, "Secret:", apiSecret ? "***" : "None");
    return true;
  }

  private static getPast5MinWindow(): { fromDateStr: string; toDateStr: string } {
    const now = new Date();

    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    const parts = formatter.formatToParts(now);
    const getValue = (type: string) => parts.find(p => p.type === type)!.value;

    const yyyy = getValue('year');
    const mm = getValue('month');
    const dd = getValue('day');
    const hh = parseInt(getValue('hour'));
    const min = parseInt(getValue('minute'));

    const istDate = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd), hh, min, 0);

    const currentBlockMin = Math.floor(istDate.getMinutes() / 5) * 5;
    
    const toDate = new Date(istDate);
    toDate.setMinutes(currentBlockMin, 0, 0); 
    
    const fromDate = new Date(toDate);
    fromDate.setMinutes(fromDate.getMinutes() - 5); 

    const formatPayload = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dayStr = String(d.getDate()).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0');
        const mn = String(d.getMinutes()).padStart(2, '0');
        return `${y}-${m}-${dayStr} ${h}:${mn}`;
    };

    const fromDateStr = formatPayload(fromDate);
    const toDateStr = formatPayload(toDate);
    console.log(`[SCANNER] Target timeframe processing blocks: ${fromDateStr} to ${toDateStr}`);

    return {
        fromDateStr,
        toDateStr
    };
  }

  static async getIntradayData(symbol: string) {
    const apiKey = process.env.MSTOCK_API_KEY;
    const sessionToken = await this.getMstockJwtToken().catch(() => null);

    if (!apiKey || !sessionToken) {
       console.warn("[MSTOCK] Missing credentials for intraday data fetch");
       return [];
    }

    const symbolInfo = await this.getSymbolToken(symbol, apiKey, sessionToken);
    if (!symbolInfo) return [];

    const { fromDateStr, toDateStr } = this.getPast5MinWindow();

    const chartUrl = 'https://api.mstock.trade/openapi/typeb/charts/intraday';
    try {
      const response = await axios.post(chartUrl, {
          exchange: "NSE",
          symboltoken: symbolInfo.token,
          interval: "5",
          fromdate: fromDateStr,
          todate: toDateStr
      }, {
        headers: {
          'X-Mirae-Version': '1',
          'X-PrivateKey': apiKey,
          'Authorization': `Bearer ${sessionToken}`,
          'Content-Type': 'application/json'
        }
      });
      if (response.data?.status === true || response.data?.status === 'true' || response.data?.status === 'success') {
          const rawData = response.data.data || [];
          return rawData.map((d: any) => ({
             date: new Date(d.timestamp).toISOString(),
             open: Number(d.open),
             high: Number(d.high),
             low: Number(d.low),
             close: Number(d.close),
             volume: Number(d.volume)
          }));
      }
    } catch (e: any) {
       console.error(`[MSTOCK CHART] Failed to fetch 5m data for ${symbol}: ${e.message}`);
    }
    return [];
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
        const exchSeg = (item.exch_seg || item.exchange || '').toUpperCase();
        const plainSymbol = (item.symbol || '').toUpperCase();        
        const instrType = (item.instrumenttype || '').toUpperCase();

        if (exchSeg === 'NSE' && instrType === 'EQ' && plainSymbol === symbol.toUpperCase()) {
            console.log(`[MSTOCK] Found scrip: symbol=${item.symbol}, name=${item.name}, token=${item.token}`);
            return {
                token: String(item.token),
                tradingSymbol: String(item.name)   
            };
        }
    }
    return null;
  }
}