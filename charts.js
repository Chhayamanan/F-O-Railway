npm install axios csv-parser
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const csv = require("csv-parser");
const { Readable } = require("stream");

/**
 * Downloads the CSV directly from Yahoo Finance, 
 * parses it, and performs calculated analytics.
 */
async function handleChartData(req, res) {
  try {
    const baseURL = req.headers.host ? `http://${req.headers.host}` : "http://localhost";
    const urlParams = new URL(req.url, baseURL).searchParams;
    const ticker = urlParams.get("ticker");

    if (!ticker) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Ticker parameter is required" }));
    }

    // Calculate UNIX Timestamps for 10 years (Period1 = Start, Period2 = End)
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - (10 * 365 * 24 * 60 * 60); // 10 years ago

    // Directly query Yahoo Finance's raw CSV download system
    const yahooCsvUrl = `https://query1.finance.yahoo.com/v7/finance/download/${ticker.toUpperCase()}?period1=${period1}&period2=${period2}&interval=1mo&events=history&includeAdjustedClose=true`;

    // Fetch using desktop headers to safely clear firewalls
    const response = await axios.get(yahooCsvUrl, {
      responseType: "text",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
      }
    });

    const results = [];

    // Stream parse the CSV plain text response
    Readable.from(response.data)
      .pipe(csv())
      .on("data", (data) => {
        // Data cleaning: Ensure values are present and not "null" strings
        if (data.Date && data.Open && data.Close && data.Close !== "null") {
          results.push({
            date: data.Date,
            open: parseFloat(data.Open),
            high: parseFloat(data.High),
            low: parseFloat(data.Low),
            close: parseFloat(data.Close),
            volume: parseInt(data.Volume, 10)
          });
        }
      })
      .on("end", () => {
        // ---- CALCULATION STEP ----
        // Let's calculate a 3-Month Simple Moving Average (SMA) as our calculation example
        const analyzedData = results.map((row, index, array) => {
          if (index >= 2) {
            const sum = array[index].close + array[index - 1].close + array[index - 2].close;
            row.movingAverage3Mo = parseFloat((sum / 3).toFixed(2));
          } else {
            row.movingAverage3Mo = row.close; // Default fallback for first two months
          }
          return row;
        });

        // Send payload to UI
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(analyzedData));
      });

  } catch (error) {
    console.error("Failed downloading / processing CSV:", error.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to load/parse stock dataset from CSV source." }));
  }
}

/**
 * Serves the independent HTML file safely without unclosed syntax string blocks
 */
function handleChartsHtml(req, res) {
  const fileToLoad = path.join(__dirname, "charts.html");
  if (!fs.existsSync(fileToLoad)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Missing charts.html structure file.");
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(fs.readFileSync(fileToLoad, "utf8"));
}

module.exports = { handleChartData, handleChartsHtml };