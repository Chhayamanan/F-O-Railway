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
  // Fast local memory cache map for real-time tick values
  public static liveStateMap: Record<string, LiveFeedSnapshot> = {};
  public static isConnected = false;

  static async connect(userId: string, accessToken: string, apiKey: string) {
    if (this.isConnected) return;

    // Production m.Stock stream gateway address
    const socketUrl = `wss://ws.mstock.trade?API_KEY=${encodeURIComponent(apiKey)}&ACCESS_TOKEN=${encodeURIComponent(accessToken)}`;
    
    console.log('[MSTOCK WEBSOCKET] Connecting to stream:', `wss://ws.mstock.trade?API_KEY=***&ACCESS_TOKEN=***`);
    this.ws = new WebSocket(socketUrl);

    this.ws.on('open', () => {
      console.log('[MSTOCK WEBSOCKET] Secure streaming pipe opened successfully.');
      this.isConnected = true;

      // 1. Subscribe to the universe tokens
      // Note: Map your RAW_UNIVERSE string names to the broker's specific exchange token ids
      const subscriptionTokens: string[] = [];

      // Add plain symbols
      RAW_UNIVERSE.forEach(sym => {
          const clean = sym.replace('.NS', '').replace('.BO', '');
          subscriptionTokens.push(clean);
      });

      // Add actual indexed exchange token ID strings for BOTH Equity and Futures
      RAW_UNIVERSE.forEach(sym => {
          const cleanSym = sym.replace('.NS', '').replace('.BO', '');
          const eqToken = MstockService.getEqTokenOnlySync(cleanSym);
          if (eqToken) {
              subscriptionTokens.push(eqToken);
          }
          const futToken = MstockService.getFutTokenOnlySync(cleanSym);
          if (futToken) {
              subscriptionTokens.push(futToken);
          }
      });

      console.log(`[MSTOCK WEBSOCKET] Sending subscription request for ${subscriptionTokens.length} tokens/symbols...`);
      const subscriptionPayload = {
        a: "subscribe",
        v: subscriptionTokens
      };
      this.ws?.send(JSON.stringify(subscriptionPayload));

      // 2. FORCE FULL MODE STREAM (Streams Live Volumes, Prices, and VTT bytes)
      const modePayload = {
        a: "mode",
        v: ["full"]
      };
      this.ws?.send(JSON.stringify(modePayload));
      console.log('[MSTOCK WEBSOCKET] Subscribed to Full Token Streaming Matrix.');
    });

    this.ws.on('message', (rawData: WebSocket.Data) => {
      try {
        const packet = JSON.parse(rawData.toString());
        
        // Map the incoming binary JSON parameters safely to your live state cache
        if (packet && (packet.symbol || packet.symbolToken || packet.token)) {
          const rawSym = packet.symbol || packet.symbolToken || packet.token;
          let symKey = String(rawSym).toUpperCase();

          // Try resolving mapping if it's a numeric exchange token mapping
          const mappedSym = MstockService.getSymbolFromTokenSync(symKey);
          if (mappedSym) {
              symKey = mappedSym;
          }

          const priceVal = Number(packet.ltp || packet.p || 0);
          const volVal = Number(packet.vtt || packet.v || packet.volume || 0);
          const prevCloseVal = Number(packet.c || packet.prevClose || 0);

          // Update cache map
          // Do not write zeroes if we already have non-zero cached entries (preserves state)
          const existing = this.liveStateMap[symKey];
          this.liveStateMap[symKey] = {
            price: priceVal > 0 ? priceVal : (existing?.price || 0),
            volume: volVal > 0 ? volVal : (existing?.volume || 0),
            prevClose: prevCloseVal > 0 ? prevCloseVal : (existing?.prevClose || 0),
            timestamp: Date.now()
          };
        }
      } catch (err) {
        // Suppress parsing noise from streaming heartbeats
      }
    });

    this.ws.on('close', () => {
      console.warn('[MSTOCK WEBSOCKET] Stream disconnected. Re-connecting in 5 seconds...');
      this.isConnected = false;
      setTimeout(() => this.connect(userId, accessToken, apiKey), 5000);
    });

    this.ws.on('error', (err: any) => {
      console.error('[MSTOCK WEBSOCKET] Network stream anomaly:', err.message || err);
    });
  }
}
