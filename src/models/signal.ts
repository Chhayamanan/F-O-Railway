export interface BuySignal {
  symbol: string;
  entry: number;
  currentVolume: number;
  avgVolume: number;
  volumeRatio: number;
  breakoutLevel: number;
}
