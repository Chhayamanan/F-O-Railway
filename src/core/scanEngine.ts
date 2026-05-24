import { DataKeeper } from './dataKeeper';
import { MstockService } from '../services/mstockService';
import { MTF_MARGINS, FNO_STOCKS } from '../services/marketDataService';

export interface ScanResult {
  symbol: string;
  ltp: number;
  spotPrice?: number;
  latestVolume: number;
  high90d: number;
  low90d?: number;
  avgVol90d: number;
  isCeoDesk: boolean;
  contractValue?: number;
  riskValue?: number;
  lotSize?: number;
  changePct?: number;
  volMultiplier?: number;
  type?: 'FUT' | 'OPTIONS' | 'MTF' | 'INTRADAY';
  recommendedOption?: 'CALL' | 'PUT';
  mtfMargin?: number;
  message?: string;
  qty?: number;
}

// Store scan results and CEO decisions in memory for now
export class ScanEngine {
  public static currentScanScope: ScanResult[] = [];
  public static ceoDeskItems: ScanResult[] = [];
  public static cancelledItems: Set<string> = new Set();
  public static recentMTFBuys: Record<string, number> = {};
  
  // Approximate Lot Sizes for well known stocks (Fallback proxy)
  private static MOCK_LOT_SIZES: Record<string, number> = {
    "RIL": 250, "RELIANCE": 250, "HDFCBANK": 550, "INFY": 400, "TCS": 175, "ICICIBANK": 700, "SBI": 1500, "SBIN": 1500
  };

  static async runScan(universe: string[], config: { volMultiplier?: number, highDistance?: number, baseVolMultiplier?: number } = {}) {
    const minVolMultiplier = config.volMultiplier || 1.5;
    const minHighDistance = config.highDistance || 0.98;
    const minBaseVolMultiplier = config.baseVolMultiplier || 2.0;
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
         const futPrevClose = future && future.prevClose > 0 ? future.prevClose : live.prevClose;
         
         // Calculate change based on LTP vs Yesterday's close
         const changePct = futPrevClose > 0 ? ((ltp - futPrevClose) / futPrevClose) * 100 : 0;
         const volMultiplier = cached.avgVol90d > 0 ? (latestVolume / cached.avgVol90d) : 0;
         
         const isCrossHigh = spotPrice > cached.high90d;
         
         // Options Criteria: configurable volume factor (default 1.5x)
         const isOptionsEligible = FNO_STOCKS.includes(plainSymbol) && volMultiplier >= minVolMultiplier;
         // Compare current LTP with Yesterday's close
         const optionAction = ltp > futPrevClose ? 'CALL' : 'PUT';

         // Original criteria
         const isScanScope = (spotPrice >= minHighDistance * cached.high90d) || (volMultiplier >= minBaseVolMultiplier) || isCrossHigh;
         
         const lotSize = future?.lotSize || this.MOCK_LOT_SIZES[plainSymbol] || 500;
         const contractValue = ltp * lotSize;
         const riskValue = contractValue * 0.05; // 5% stop loss risk
         const mtfMargin = MTF_MARGINS[plainSymbol];

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
               type: 'FUT',
               mtfMargin
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
               recommendedOption: optionAction,
               mtfMargin
            };
            results.push(optionsItem);

            if (!this.ceoDeskItems.find(x => x.symbol === plainSymbol && x.type === 'OPTIONS')) {
               newCeoItems.push(optionsItem);
            }
         }

         const isMtfEligible = Object.keys(MTF_MARGINS).includes(plainSymbol);
         if (isMtfEligible && cached.low90d && cached.low90d > 0) {
            const rangePct = (cached.high90d - cached.low90d) / cached.low90d;
            if (rangePct <= 0.30) {
               // In MTF scan scope
               let mtfItem: ScanResult = {
                  symbol: plainSymbol,
                  ltp: spotPrice,
                  spotPrice,
                  latestVolume,
                  high90d: cached.high90d,
                  low90d: cached.low90d,
                  avgVol90d: cached.avgVol90d,
                  isCeoDesk: false,
                  changePct,
                  volMultiplier,
                  type: 'MTF',
                  mtfMargin
               };

               const isMtfSignal = spotPrice > cached.high90d && latestVolume >= 3 * cached.avgVol90d;
               if (isMtfSignal && spotPrice <= 3000) {
                  mtfItem.isCeoDesk = true;

                  const lastBuyTimestamp = this.recentMTFBuys[plainSymbol];
                  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
                  const canBuy = !lastBuyTimestamp || (Date.now() - lastBuyTimestamp) > twoDaysMs;

                  if (canBuy) {
                     if (mtfMargin && mtfMargin > 0) {
                        const marginFactor = mtfMargin / 100;
                        const qty = Math.floor(10000 / (spotPrice * marginFactor));

                        if (qty > 0) {
                           mtfItem.qty = qty;
                           try {
                              // We auto-buy for MTF
                              await MstockService.placeCoverOrder(plainSymbol, qty, spotPrice * 0.995, spotPrice * 0.95);
                              console.log(`[MTF BUY] Auto bought ${qty} ${plainSymbol} worth 10000 RS in margin`);
                              this.recentMTFBuys[plainSymbol] = Date.now();
                              mtfItem.message = `Auto Bought: ${qty} qty @ ${spotPrice.toFixed(2)}`;
                           } catch (e: any) {
                              console.error(`[MTF BUY] Failed for ${plainSymbol}: ${e.message}`);
                              mtfItem.message = `Auto Buy Failed: ${e.message}`;
                           }
                        } else {
                           mtfItem.message = `Signal valid but calculated qty was 0`;
                        }
                     }
                  } else {
                     mtfItem.message = `Valid signal but skipped rebuy (within 2 days)`;
                  }
               } else if (isMtfSignal && spotPrice > 3000) {
                  mtfItem.isCeoDesk = true;
                  mtfItem.message = `Valid signal but price > 3000 (Ignored)`;
               }

               results.push(mtfItem);

               if (mtfItem.isCeoDesk && !this.ceoDeskItems.find(x => x.symbol === plainSymbol && x.type === 'MTF')) {
                  newCeoItems.push(mtfItem);
               }
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
