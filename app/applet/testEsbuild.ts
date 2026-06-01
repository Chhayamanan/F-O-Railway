import YahooFinance from "yahoo-finance2";
console.log(typeof YahooFinance);
try {
  const yf = new YahooFinance();
  console.log("Success new!");
} catch (e) {
  console.log("Error new!", e.message);
}
