export const SETTINGS = {
  BOX_RANGE_LIMIT: 30,
  POSITION_RANGE_MIN: 25,
  VOLUME_MULTIPLIER: 4,
  RISK_PER_TRADE: 1,
  CAPITAL: 10000000, // 1 Crore (10 Million Rs) preferred for institutional scale
  ORDER_BUDGET: 30,       // max spend per order in Rs
  MTF_MARGIN_PERCENT: 50,    // broker margin % (50 % = 2x leverage)
  MAX_STOCK_PRICE: 30,    // skip stocks above this price
  MAX_SECTOR_EXPOSURE: 20
};
