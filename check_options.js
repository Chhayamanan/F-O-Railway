const https = require("https");
const fs = require("fs");

async function check() {
  const file = "market_cache.json";
  if (!fs.existsSync(file)) {
      console.log("no cache file");
      return;
  }
  const data = JSON.parse(fs.readFileSync(file));
  let count = 0;
  for (const inst of data) {
    const name = (inst.name || "").toUpperCase();
    const sym = (inst.symbol || "").toUpperCase();
    if (name.includes("NIFTY") && !name.includes("BANK") && !name.includes("FIN") && !name.includes("MID") && sym.endsWith("PE")) {
       console.log(inst.name, inst.symbol, inst.strike, inst.expiry);
       count++;
       if (count > 5) break;
    }
  }
}
check();
