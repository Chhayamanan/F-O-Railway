import { DataKeeper } from './dataKeeper';
import { MstockService } from '../services/mstockService';

export interface ScanResult {
  symbol: string;
  ltp: number;
  spotPrice?: number;
  latestVolume: number;
  high90d: number;
  avgVol90d: number;
  isCeoDesk: boolean;
  contractValue?: number;
  riskValue?: number;
  lotSize?: number;
  changePct?: number;
  volMultiplier?: number;
  type?: 'FUT' | 'OPTIONS';
  recommendedOption?: 'CALL' | 'PUT';
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
         
         const future = futureData ? futureData[plainSymbol] : null;

         const ltp = future && future.price > 0 ? future.price : live.price;
         const spotPrice = live.price;
         const latestVolume = live.volume;
         const changePct = live.prevClose > 0 ? ((spotPrice - live.prevClose) / live.prevClose) * 100 : 0;
         const volMultiplier = cached.avgVol90d > 0 ? (latestVolume / cached.avgVol90d) : 0;
         
         const isCrossHigh = spotPrice > cached.high90d;
         
         // Options Criteria
         const isOptionsEligible = volMultiplier >= 1.5;
         const optionAction = spotPrice > live.prevClose ? 'CALL' : 'PUT';

         // Original criteria
         const isScanScope = (spotPrice >= 0.98 * cached.high90d) || (latestVolume >= 2 * cached.avgVol90d) || isCrossHigh;
         
         const lotSize = future?.lotSize || this.MOCK_LOT_SIZES[plainSymbol] || 500;
         const contractValue = ltp * lotSize;
         const riskValue = contractValue * 0.05; // 5% stop loss risk

         if (isScanScope) {
            const item: ScanResult = {
               symbol: plainSymbol,
               ltp,
               spotPrice,
               latestVolume,
               high90d: cached.high90d,
               avgVol90d: cached.avgVol90d,
               isCeoDesk: true,
               contractValue,
               riskValue,
               lotSize,
               changePct,
               volMultiplier,
               type: 'FUT'
            };
            results.push(item);
            
            if (!this.ceoDeskItems.find(x => x.symbol === plainSymbol && x.type === 'FUT')) {
               newCeoItems.push(item);
            }
         }

         if (isOptionsEligible) {
            const optionsItem: ScanResult = {
               symbol: plainSymbol,
               ltp,
               spotPrice,
               latestVolume,
               high90d: cached.high90d,
               avgVol90d: cached.avgVol90d,
               isCeoDesk: true,
               changePct,
               volMultiplier,
               type: 'OPTIONS',
               recommendedOption: optionAction
            };
            results.push(optionsItem);

            if (!this.ceoDeskItems.find(x => x.symbol === plainSymbol && x.type === 'OPTIONS')) {
               newCeoItems.push(optionsItem);
            }
         }
       }
    }
    
    this.currentScanScope = results;
    // Append new CEO items (items remain in desk until actioned)
    for (const item of newCeoItems) {
        if (!this.ceoDeskItems.some(x => x.symbol === item.symbol && x.type === item.type)) {
             this.ceoDeskItems.push(item);
        }
    }
    
    return { scanScope: this.currentScanScope, ceoDesk: this.ceoDeskItems };
  }

  
  static async actionCeoItem(symbol: string, action: 'BUY' | 'HOLD' | 'CANCEL', type: 'FUT' | 'OPTIONS' = 'FUT') {
      const index = this.ceoDeskItems.findIndex(x => x.symbol === symbol && (x.type === type || (!x.type && type === 'FUT')));
      if (index === -1) return { success: false, message: "Item not in CEO Desk" };
      
      const item = this.ceoDeskItems[index];

      if (action === 'BUY') {
         if (type === 'OPTIONS') {
             // Let's just hold for options or implement optional buy logic if they have the API
             // For now, we return success with dummy or standard message
             this.ceoDeskItems.splice(index, 1);
             return { success: true, message: `Placed Buy Order for ${item.recommendedOption} Option on ${symbol} (Simulated for Options)` };
         } else {
             const orderPrice = item.ltp * 0.995;
             const slPrice = item.ltp * 0.95;
             try {
                 // Buy 1 lot (this implies FNO, but we use the lotSize equity equivalent as proxy due to API instrument limits)
                 await MstockService.placeCoverOrder(symbol, item.lotSize || 1, orderPrice, slPrice);

                 this.ceoDeskItems.splice(index, 1);
                 return { success: true, message: `Placed Cover Order for ${symbol} @ RS ${orderPrice.toFixed(2)} and SL @ RS ${slPrice.toFixed(2)}` };
             } catch (e: any) {
                 console.error(`[CEO DESK] Cover Order failed for ${symbol}: ${e.message}`);
                 return { success: false, message: e.message };
             }
         }
      } else if (action === 'HOLD') {
         // Keep in the list
         return { success: true, message: `Holding ${symbol} (${type}). Item remains open.` };
      } else if (action === 'CANCEL') {
         // Remove from scan scope for the entire day if both are cancelled or something, but let's just mark the specific type
         if (type === 'FUT') this.cancelledItems.add(symbol); 
         this.ceoDeskItems.splice(index, 1);
         if (type === 'FUT') {
             this.currentScanScope = this.currentScanScope.filter(x => x.symbol !== symbol || x.type !== 'FUT');
         }
         return { success: true, message: `Cancelled ${symbol} (${type}) for the day.` };
      }
      return { success: false, message: "Invalid action" };
  }
}
