import WebSocket from 'ws';
import { RAW_UNIVERSE } from './marketDataService';
import { MstockService } from './mstockService';

export interface LiveFeedSnapshot {
  price: number;
  volume: number;
  prevClose: number;
  timestamp: number;
}

export class MstockSocketService {
  private static ws: WebSocket | null = null;
  public static liveStateMap: Record<string, LiveFeedSnapshot> = {};
  public static isConnected = false;
  private static isConnecting = false;
  private static connectionAttempts = 0;
  private static reconnectTimeout: NodeJS.Timeout | null = null;

  static async connect(userId: string, accessToken: string, apiKey: string) {
    if (this.isConnected || this.isConnecting) return;
    this.isConnecting = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // SDK explicitly passes plain tokens in this parameter order without encoding
    const socketUrl = `wss://ws.mstock.trade?ACCESS_TOKEN=${accessToken}&API_KEY=${apiKey}`;
    
    console.log('[MSTOCK WEBSOCKET] Initiating secure gateway handshake...');

    // Remove custom headers to avoid WAF/cloudflare 502 rejections
    this.ws = new WebSocket(socketUrl);
    this.ws.binaryType = 'arraybuffer';

    this.ws.on('open', () => {
      console.log('[MSTOCK WEBSOCKET] TCP Pipe established. Confirming authentication...');
      this.isConnected = true;
      this.isConnecting = false;
      this.connectionAttempts = 0;

      // 3. MANDATORY CORE PROTOCOL: Transmit explicit post-connection login frame
      this.ws?.send(`LOGIN:${accessToken}`);

      // 4. Subscribe to targets (Ensure arrays pass clean exchange tokens)
      const cleanSymbols = RAW_UNIVERSE.map(sym => sym.replace('.NS', ''));
      // Wait we need to look up token identifiers!
      const tokens: number[] = [];
      cleanSymbols.forEach(sym => {
         const tknStr = MstockService.getEqTokenOnlySync(sym);
         if (tknStr) tokens.push(Number(tknStr));
      });
      
      const subscriptionPayload = {
        a: "subscribe",
        v: tokens
      };
      this.ws?.send(JSON.stringify(subscriptionPayload));

      // Set target mode explicitly
      const modePayload = {
        a: "mode",
        v: ["full", tokens]
      };
      this.ws?.send(JSON.stringify(modePayload));
      console.log(`[MSTOCK WEBSOCKET] Streaming matrices activated for ${tokens.length} core assets.`);
    });

    this.ws.on('message', (rawData: WebSocket.Data) => {
      try {
        if (typeof rawData === 'string') {
            const messageDict = JSON.parse(rawData);
            // Ignore text order/trade updates for now as we use HTTP polling
        } else if (rawData instanceof Buffer || rawData instanceof ArrayBuffer) {
           try {
               const buf = rawData instanceof ArrayBuffer ? Buffer.from(rawData) : rawData;
               if (buf.length >= 20) {
                   const token = buf.readInt32BE(0);          // token identifier
                   const ltp   = buf.readInt32BE(4) / 100;   // price (paise → rupees)
                   const volume = buf.readInt32BE(16);        // cumulative traded volume
                   const prevClose = buf.readInt32BE(12) / 100;
       
                   const sym = MstockService.getSymbolFromTokenSync(String(token));
                   if (sym) {
                       MstockSocketService.liveStateMap[sym] = {
                           price: ltp,
                           volume,
                           prevClose,
                           timestamp: Date.now()
                       };
                       // Also store by token string as fallback key
                       MstockSocketService.liveStateMap[String(token)] = MstockSocketService.liveStateMap[sym];
                   }
               }
           } catch (_) {}
        }
      } catch (err) {
        // Keeps the socket silent during periodic gateway heartbeat pings
      }
    });

    this.ws.on('close', (code, reason) => {
      const isWasConnected = this.isConnected;
      this.isConnected = false;
      this.isConnecting = false;

      try {
        this.ws?.removeAllListeners();
      } catch (e) {}
      this.ws = null;

      this.connectionAttempts++;
      
      if (this.connectionAttempts >= 4) {
        console.error(`[MSTOCK WEBSOCKET] Maximum reconnection attempts reached (502 Bad Gateway persistent). Suspending WebSocket feed. System will rely entirely on REST polling.`);
        return;
      }
      
      // Exponential backoff starting at 5s, multiplying by 1.8x, max 120s (2 minutes)
      const delay = Math.min(120000, 5000 * Math.pow(1.8, Math.min(this.connectionAttempts - 1, 8)));

      if (isWasConnected) {
        console.warn(`[MSTOCK WEBSOCKET] Stream closed [Code: ${code}]. Reason: ${reason ? reason.toString() : 'None'}. Re-connecting in ${Math.round(delay / 1000)}s...`);
      } else {
        console.warn(`[MSTOCK WEBSOCKET] Stream gateway unreachable (Attempt #${this.connectionAttempts}). Re-trying in ${Math.round(delay / 1000)}s...`);
      }

      if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = setTimeout(() => this.connect(userId, accessToken, apiKey), delay);
    });

    this.ws.on('error', (err: any) => {
      // Gracefully capture handshaking failures (e.g. 502 Bad Gateway) without stack traces
      console.warn(`[MSTOCK WEBSOCKET] Network stream anomaly: ${err.message || err}`);
      this.isConnecting = false;
    });
  }
}
