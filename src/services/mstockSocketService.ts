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
  public static liveStateMap: Record<string, LiveFeedSnapshot> = {};
  public static isConnected = false;

  static async connect(userId: string, accessToken: string, apiKey: string) {
    // WebSockets disabled. The system will use standard full-form REST quotes on polling intervals instead.
    this.isConnected = false;
  }
}
