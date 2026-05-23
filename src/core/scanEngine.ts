import { DataKeeper } from './dataKeeper';
import { MstockService } from '../services/mstockService';

export interface ScanResult {
  symbol: string;
  ltp: number;
  latestVolume: number;
  high90d: number;
  avgVol90d: number;
  isCeoDesk: boolean;
  contractValue?: number;
  riskValue?: number;
  lotSize?: number;
}

// Store scan results and CEO decisions in memory for now
export class ScanEngine {
  public static currentScanScope: ScanResult[] = [];
  public static ceoDeskItems: ScanResult[] = [];
  public static cancelledItems: Set<string> = new Set();
  
  // Approximate Lot Sizes for well known stocks (Fallback proxy)
  private static MOCK_LOT_SIZES: Record<string, number> = {
    "RIL": 250, "RELIANCE": 250, "HDFCBANK": 550, "INFY": 400, "TCS": 175, "ICICIBANK": 700, "SBI": 1500, "SBIN": 1500
  };

  static async runScan(universe: string[]) {
    const results: ScanResult[] = [];
    const newCeoItems: ScanResult[] = [];
    
    // Chunking to avoid Mstock API limits
    const CHUNK_SIZE = 50;
    for (let i = 0; i < universe.length; i += CHUNK_SIZE) {
       const chunk = universe.slice(i, i + CHUNK_SIZE);
       
       // live quote from Mstock
       const liveData = await MstockService.getCurrentPrices(chunk);
       const futureData = await MstockService.getCurrentFuturePrices(chunk);
       
       for (const symbol of chunk) {
         if (this.cancelledItems.has(symbol)) continue; // skip cancelled
         
         const cached = DataKeeper.getStockData(symbol);
         if (!cached) continue; 
         
         const plainSymbol = symbol.replace('.NS', '');
         const live = liveData[plainSymbol];
         if (!live || live.price === 0) continue;
         
         const future = futureData[plainSymbol];
         if (!future || future.price === 0) continue;

         const ltp = future.price;
         const spotPrice = live.price;
         const latestVolume = live.volume;
         
         const isCrossHigh = spotPrice > cached.high90d;
         const isVol3x = latestVolume >= 3 * cached.avgVol90d;
         
         const isScanScope = (spotPrice >= 0.98 * cached.high90d) || (latestVolume >= 2 * cached.avgVol90d) || isCrossHigh;
         const isCeoDesk = isScanScope;
         
         if (isScanScope) {
            const lotSize = future.lotSize || this.MOCK_LOT_SIZES[plainSymbol] || 500;
            const contractValue = ltp * lotSize;
            const riskValue = contractValue * 0.05; // 5% stop loss risk
            
            const item: ScanResult = {
               symbol: plainSymbol,
               ltp,
               latestVolume,
               high90d: cached.high90d,
               avgVol90d: cached.avgVol90d,
               isCeoDesk,
               contractValue,
               riskValue,
               lotSize
            };
            results.push(item);
            
            if (isCeoDesk && !this.ceoDeskItems.find(x => x.symbol === plainSymbol)) {
               newCeoItems.push(item);
            }
         }
       }
    }
    
    this.currentScanScope = results;
    // Append new CEO items (items remain in desk until actioned)
    for (const item of newCeoItems) {
        if (!this.ceoDeskItems.some(x => x.symbol === item.symbol)) {
             this.ceoDeskItems.push(item);
        }
    }
    
    return { scanScope: this.currentScanScope, ceoDesk: this.ceoDeskItems };
  }
  
  static async actionCeoItem(symbol: string, action: 'BUY' | 'HOLD' | 'CANCEL') {
      const index = this.ceoDeskItems.findIndex(x => x.symbol === symbol);
      if (index === -1) return { success: false, message: "Item not in CEO Desk" };
      
      const item = this.ceoDeskItems[index];

      if (action === 'BUY') {
         const orderPrice = item.ltp * 0.995;
         try {
             // Buy 1 lot (this implies FNO, but we use the lotSize equity equivalent as proxy due to API instrument limits)
             await MstockService.placeOrder(symbol, item.lotSize || 1, orderPrice);
             
             // Place 5% Stop Loss Order
             const slPrice = item.ltp * 0.95;
             try {
                await MstockService.placeStopLossOrder(symbol, item.lotSize || 1, slPrice);
             } catch (slErr: any) {
                console.error(`[CEO DESK] Buy succeeded but SL failed for ${symbol}: ${slErr.message}`);
                // Don't fail the whole block if Buy succeeded, but maybe note it.
             }

             this.ceoDeskItems.splice(index, 1);
             return { success: true, message: `Placed Buy Order for ${symbol} @ RS ${orderPrice.toFixed(2)} and SL @ RS ${slPrice.toFixed(2)}` };
         } catch (e: any) {
             console.error(`[CEO DESK] Buy failed for ${symbol}: ${e.message}`);
             return { success: false, message: e.message };
         }
      } else if (action === 'HOLD') {
         // Keep in the list
         return { success: true, message: `Holding ${symbol}. Options remain open.` };
      } else if (action === 'CANCEL') {
         // Remove from scan scope for the entire day
         this.cancelledItems.add(symbol);
         this.ceoDeskItems.splice(index, 1);
         this.currentScanScope = this.currentScanScope.filter(x => x.symbol !== symbol);
         return { success: true, message: `Cancelled ${symbol} for the day.` };
      }
      return { success: false, message: "Invalid action" };
  }
}
