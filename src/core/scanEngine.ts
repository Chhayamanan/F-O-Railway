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
  recommendedAction?: 'BUY' | 'SELL';
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

  static async runScan(universe: string[], config: { 
    futHighDistance?: number, 
    futBaseVolMultiplier?: number,
    optHighDistance?: number,
    optBaseVolMultiplier?: number,
    mtfHighDistance?: number,
    mtfBaseVolMultiplier?: number,
    intradayHighDistance?: number,
    intradayBaseVolMultiplier?: number
  } = {}) {
    const futVolMult = config.futBaseVolMultiplier || 2.0;
    const optVolMult = config.optBaseVolMultiplier || 2.0;
    const mtfVolMult = config.mtfBaseVolMultiplier || 3.0;
    const intradayVolMult = config.intradayBaseVolMultiplier || 2.5;
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
         const rangePct = cached.low90d && cached.low90d > 0 ? (cached.high90d - cached.low90d) / cached.low90d : 0;
         const isRangeOk = rangePct > 0 && rangePct <= 0.30;
         
         const lotSize = future?.lotSize || this.MOCK_LOT_SIZES[plainSymbol] || 500;
         const contractValue = ltp * lotSize;
         const riskValue = contractValue * 0.05; // 5% stop loss risk
         const mtfMargin = MTF_MARGINS[plainSymbol];

         // --- FUTURES ---
         // 1. Range <= 30%
         // 2. Crosses high
         // 3. Vol >= x times average
         const isFutScanScope = isRangeOk && isCrossHigh && volMultiplier >= futVolMult;
         if (isFutScanScope) {
            const item: ScanResult = {
               symbol: plainSymbol, ltp, spotPrice, latestVolume, high90d: cached.high90d, low90d: cached.low90d, avgVol90d: cached.avgVol90d,
               isCeoDesk: true, contractValue, riskValue, lotSize, changePct, volMultiplier, type: 'FUT', mtfMargin
            };
            results.push(item);
            if (!this.ceoDeskItems.find(x => x.symbol === plainSymbol && x.type === 'FUT')) newCeoItems.push(item);
         }

         // --- OPTIONS ---
         // 1. Check average volume vs current volume (volMultiplier >= optVolMult)
         // 2. Buy CALL if change +ve, PUT if -ve
         const isOptScanScope = volMultiplier >= optVolMult;
         const isOptionsEligible = FNO_STOCKS.includes(plainSymbol) && isOptScanScope;
         if (isOptionsEligible) {
            const optionAction = changePct >= 0 ? 'CALL' : 'PUT';
            const optionsItem: ScanResult = {
               symbol: plainSymbol, ltp, spotPrice, latestVolume, high90d: cached.high90d, low90d: cached.low90d, avgVol90d: cached.avgVol90d,
               isCeoDesk: true, changePct, volMultiplier, type: 'OPTIONS', recommendedOption: optionAction, mtfMargin
            };
            results.push(optionsItem);
            if (!this.ceoDeskItems.find(x => x.symbol === plainSymbol && x.type === 'OPTIONS')) newCeoItems.push(optionsItem);
         }

         // --- MTF ---
         // 1. Range <= 30%
         // 2. Crosses high
         // 3. Vol >= x times average
         const isMtfEligible = Object.keys(MTF_MARGINS).includes(plainSymbol);
         const isMtfScanScope = isRangeOk && isCrossHigh && volMultiplier >= mtfVolMult;
         if (isMtfEligible && isMtfScanScope) {
             const mtfItem: ScanResult = {
                symbol: plainSymbol, ltp: spotPrice, spotPrice, latestVolume, high90d: cached.high90d, low90d: cached.low90d, avgVol90d: cached.avgVol90d,
                isCeoDesk: true, changePct, volMultiplier, type: 'MTF', mtfMargin
             };
             results.push(mtfItem);
             if (!this.ceoDeskItems.find(x => x.symbol === plainSymbol && x.type === 'MTF')) newCeoItems.push(mtfItem);
         }

         // --- INTRADAY ---
         // 1. Check average volume vs current volume (volMultiplier >= intradayVolMult)
         // 2. Buy if +ve, Sell if -ve
         const isIntradayScanScope = volMultiplier >= intradayVolMult;
         if (isIntradayScanScope) {
             const intradayAction = changePct >= 0 ? 'BUY' : 'SELL';
             const intradayItem: ScanResult = {
                symbol: plainSymbol, ltp: spotPrice, spotPrice, latestVolume, high90d: cached.high90d, low90d: cached.low90d, avgVol90d: cached.avgVol90d,
                isCeoDesk: true, changePct, volMultiplier, type: 'INTRADAY', recommendedAction: intradayAction, mtfMargin
             };
             results.push(intradayItem);
             if (!this.ceoDeskItems.find(x => x.symbol === plainSymbol && x.type === 'INTRADAY')) newCeoItems.push(intradayItem);
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

  
  static async actionCeoItem(symbol: string, action: 'BUY' | 'HOLD' | 'CANCEL', type: 'FUT' | 'OPTIONS' | 'MTF' | 'INTRADAY' = 'FUT') {
      const index = this.ceoDeskItems.findIndex(x => x.symbol === symbol && (x.type === type || (!x.type && type === 'FUT')));
      if (index === -1) return { success: false, message: "Item not in CEO Desk" };
      
      const item = this.ceoDeskItems[index];

      // helper to clear out all related entries for the same symbol
      const clearSymbolFromDesk = (sym: string) => {
          this.ceoDeskItems = this.ceoDeskItems.filter(x => x.symbol !== sym);
      };

      if (action === 'BUY') { // 'BUY' here means EXECUTE signal
         const direction = item.recommendedAction === 'SELL' ? 'SELL' : 'BUY';
         const orderPrice = direction === 'BUY' ? item.ltp * 0.995 : item.ltp * 1.005;
         
         try {
             if (type === 'OPTIONS') {
                 const res = await MstockService.placeOptionBracketOrder(symbol, item.recommendedOption || 'CALL', item.spotPrice || item.ltp, item.lotSize || 1);
                 clearSymbolFromDesk(symbol);
                 return { success: true, message: `Placed Order for ${item.recommendedOption} Option [${res.tradingSymbol}] @ RS ${res.entryPrice.toFixed(2)}, SL (-20%) @ RS ${res.stopLossPrice.toFixed(2)}, TGT (+40%) @ RS ${res.targetPrice.toFixed(2)}` };
             } else if (type === 'INTRADAY') {
                 const slPrice = direction === 'BUY' ? item.ltp * 0.99 : item.ltp * 1.01;
                 await MstockService.placeCoverOrder(symbol, item.lotSize || 1, orderPrice, slPrice, direction);
                 clearSymbolFromDesk(symbol);
                 return { success: true, message: `Placed Intraday ${direction} Order for ${symbol} @ RS ${orderPrice.toFixed(2)} and SL @ RS ${slPrice.toFixed(2)}` };
             } else {
                 const slPrice = direction === 'BUY' ? item.ltp * 0.95 : item.ltp * 1.05;
                 await MstockService.placeCoverOrder(symbol, item.lotSize || 1, orderPrice, slPrice, direction);
                 clearSymbolFromDesk(symbol);
                 return { success: true, message: `Placed Cover ${direction} Order for ${symbol} @ RS ${orderPrice.toFixed(2)} and SL @ RS ${slPrice.toFixed(2)}` };
             }
         } catch (e: any) {
             console.error(`[CEO DESK] Cover Order failed for ${symbol}: ${e.message}`);
             return { success: false, message: e.message };
         }
      } else if (action === 'HOLD') {
         return { success: true, message: `Holding ${symbol} (${type}). Item remains open.` };
      } else if (action === 'CANCEL') {
         this.cancelledItems.add(symbol); 
         clearSymbolFromDesk(symbol);
         
         this.currentScanScope = this.currentScanScope.filter(x => x.symbol !== symbol);
         
         return { success: true, message: `Cancelled ${symbol} for the day.` };
      }
      return { success: false, message: "Invalid action" };
  }
}
