export const SETTINGS = {
  // Manan Signal settings (formerly Darvas Box)
  BOX_RANGE_LIMIT: 30, // Keeping old props just in case
  POSITION_RANGE_MIN: 25,
  VOLUME_MULTIPLIER: 4, 
  SCAN_VOLUME_MULTIPLIER: 2,  // Manual threshold for Scan Scope (2x volume)
  VALID_VOLUME_MULTIPLIER: 3, // Manual threshold for Valid Signal (3x volume)
  SCAN_PERIOD_DAYS: 90,       // High of last 90 days

  RISK_PER_TRADE: 1,
  CAPITAL: 10000000, // 1 Crore (10 Million Rs) preferred for institutional scale
  ORDER_BUDGET: 200000,       // max spend per order in Rs
  MTF_MARGIN_PERCENT: 50,    // broker margin % (50 % = 2x leverage)
  MAX_STOCK_PRICE: 30000,    // skip stocks above this price
  MAX_SECTOR_EXPOSURE: 20
};
