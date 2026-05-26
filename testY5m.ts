import yahooFinanceDefault from 'yahoo-finance2';
const YahooFinanceClass = (yahooFinanceDefault as any).default || yahooFinanceDefault;
const yahooFinance = typeof YahooFinanceClass === 'function' ? new YahooFinanceClass({ suppressNotices: ['yahooSurvey'] }) : YahooFinanceClass;

async function test() {
    console.log("Testing Yahoo 5-minute data");
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 365);
    try {
        const chartData = await yahooFinance.chart('RELIANCE.NS', {
            period1: startDate,
            period2: new Date(),
            interval: "5m"
        });
        console.log("Success with 5m interval, items:", chartData.quotes.length);
    } catch(e) {
        console.error("Failed:", e.message);
    }
}
test();
