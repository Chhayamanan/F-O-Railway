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
  private static isConnected = false;

  static async connect(userId: string, accessToken: string, apiKey: string) {
    if (this.isConnected) return;

    // 1. STRICT KEY ENCODING: Guard against base64 symbol corruptions (+, =, /)
    const encodedKey = encodeURIComponent(apiKey);
    const encodedToken = encodeURIComponent(accessToken);
    
    // Explicit production streaming connection gateway
    const socketUrl = `wss://ws.mstock.trade?API_KEY=${encodedKey}&ACCESS_TOKEN=${encodedToken}`;
    
    console.log('[MSTOCK WEBSOCKET] Initiating secure gateway handshake...');

    // 2. Add custom connection configuration blocks to satisfy firewall fingerprints
    this.ws = new WebSocket(socketUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Node.js)',
        'X-Mirae-Version': '1'
      }
    });

    this.ws.on('open', () => {
      console.log('[MSTOCK WEBSOCKET] TCP Pipe established. Confirming authentication...');
      this.isConnected = true;

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
      console.warn(`[MSTOCK WEBSOCKET] Stream closed [Code: ${code}]. Reason: ${reason ? reason.toString() : 'None'}`);
      this.isConnected = false;
      // Linear backoff delay strategy to keep connection loop healthy
      setTimeout(() => this.connect(userId, accessToken, apiKey), 5000);
    });

    this.ws.on('error', (err) => {
      console.error('[MSTOCK WEBSOCKET] Connection exception:', err.message);
    });
  }
}
