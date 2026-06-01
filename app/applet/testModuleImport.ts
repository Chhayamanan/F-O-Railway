import yfModule from 'yahoo-finance2';
const YF = (yfModule as any).default || yfModule;
const yahooFinance = new YF();
yahooFinance.search('AAPL').then((r: any) => console.log(r.quotes[0].symbol));
