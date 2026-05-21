export interface StockCandidate {
  symbol: string;
  boxHigh: number;
  boxLow: number;
  currentPrice: number;
  avgVolume90d: number;
  currentVolume: number;
  volumeRatio: number;
  marketCap: 'Large' | 'Mid' | 'Small';
  dailyChange?: number;
  distFromHigh?: number;
  rsNifty?: { rpi90: number; rpi60: number; rpi30: number; rpi10: number };
  rsIndex?: { rpi90: number; rpi60: number; rpi30: number; rpi10: number; benchSymbol: string };
}
