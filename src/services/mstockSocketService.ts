import WebSocket from 'ws';
import { RAW_UNIVERSE } from './marketDataService';

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

    this.ws.on('open', () => {
      console.log('[MSTOCK WEBSOCKET] TCP Pipe established. Confirming authentication...');
      this.isConnected = true;
      this.isConnecting = false;
      this.connectionAttempts = 0;

      // 3. MANDATORY CORE PROTOCOL: Transmit explicit post-connection login frame
      this.ws?.send(`LOGIN:${accessToken}`);

      // 4. Subscribe to targets (Ensure arrays pass clean exchange tokens)
      const cleanSymbols = RAW_UNIVERSE.map(sym => sym.replace('.NS', ''));
      const subscriptionPayload = {
        a: "subscribe",
        v: cleanSymbols
      };
      this.ws?.send(JSON.stringify(subscriptionPayload));

      // Set target mode explicitly
      const modePayload = {
        a: "mode",
        v: ["full"]
      };
      this.ws?.send(JSON.stringify(modePayload));
      console.log(`[MSTOCK WEBSOCKET] Streaming matrices activated for ${cleanSymbols.length} core assets.`);
    });

    this.ws.on('message', (rawData: WebSocket.Data) => {
      try {
        const packet = JSON.parse(rawData.toString());
        
        // Parse the official exchange packet parameters seamlessly
        if (packet && packet.symbol) {
          const symKey = packet.symbol;
          this.liveStateMap[symKey] = {
            price: Number(packet.ltp || packet.p || 0),
            // m.Stock tracks live exchange volume cumulative bytes under 'vtt' or 'v'
            volume: Number(packet.vtt || packet.v || packet.volume || 0),
            prevClose: Number(packet.c || packet.prevClose || 0),
            timestamp: Date.now()
          };
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
