const fs = require("fs");
const path = require("path");
const YahooFinance = require("yahoo-finance2").default;

// Initialize Yahoo Finance with notice suppression
const yahooFinance = new YahooFinance({ suppressNotices: ["ripHistorical"] });

/**
 * Safely fetches 10 years of monthly historical data for a given ticker
 */
async function handleChartData(req, res) {
  try {
    // 1. Safe URL parsing: handles missing or corrupt request URLs gracefully
    const baseURL = req.headers.host ? `http://${req.headers.host}` : "http://localhost";
    const urlParams = new URL(req.url, baseURL).searchParams;
    const ticker = urlParams.get("ticker");

    // Validation: Return 400 Bad Request if ticker is missing
    if (!ticker) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Query parameter 'ticker' is required." }));
    }

    // 2. Setup safe date range (Last 10 Years)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - 10);

    // 3. Fetch data directly from Yahoo Finance API
    // We wrap this in standard ISO string conversions for absolute API stability
    const chartRes = await yahooFinance.chart(ticker.toUpperCase(), { 
      period1: startDate.toISOString().split('T')[0], 
      period2: endDate.toISOString().split('T')[0], 
      interval: "1mo" 
    });

    // 4. Sanitization: Filter out incomplete or null API data points
    const rawDf = chartRes.quotes || [];
    const cleanData = rawDf.filter(r => 
      r &&
      r.date !== null &&
      r.high !== null && 
      r.low !== null && 
      r.close !== null && 
      r.open !== null && 
      r.volume !== null
    );

    // 5. Successful Response
    res.writeHead(200, { 
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600" // Optional: cache data for 1 hour to prevent API rate-limiting
    });
    return res.end(JSON.stringify(cleanData));

  } catch (e) {
    // 6. Graceful Error Handling: Prevents node process from crashing on API failures
    console.error(`Error fetching data for ticker:`, e);
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Failed to fetch financial data", details: e.message }));
  }
}

/**
 * Safely serves the charts.html file
 */
function handleChartsHtml(req, res) {
  const filePath = path.join(__dirname, "charts.html");
  
  // Verify file exists before reading to avoid unhandled system crashes
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Error: charts.html file missing from server directory.");
  }

  res.writeHead(200, { "Content-Type": "text/html" });
  return res.end(fs.readFileSync(filePath, "utf8"));
}

module.exports = { handleChartData, handleChartsHtml };