const yahooFinance = require('yahoo-finance2').default;
const symbol = 'RELIANCE.NS';
const queryOptions = { period1: '2020-01-01', period2: '2020-01-10', interval: '1d' };
try {
  yahooFinance.historical(symbol, queryOptions).then(console.log).catch(console.error);
} catch (e) {
  console.error(e);
}
