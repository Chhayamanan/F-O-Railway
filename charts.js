const https = require("https");

/**
 * API End-point: Downloads Yahoo Finance CSV using native HTTPS, 
 * manually parses it line-by-line, and calculates a 3-Month Moving Average.
 */
function handleChartData(req, res) {
  try {
    const baseURL = req.headers.host ? `http://${req.headers.host}` : "http://localhost";
    const urlParams = new URL(req.url, baseURL).searchParams;
    const ticker = urlParams.get("ticker");

    if (!ticker) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Ticker parameter is required" }));
    }

    // Generate UNIX timestamps for a 10-year lookback period
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - (10 * 365 * 24 * 60 * 60);

    // Direct Yahoo Finance raw CSV download engine URL
    const yahooCsvUrl = `https://query1.finance.yahoo.com/v7/finance/download/${ticker.toUpperCase()}?period1=${period1}&period2=${period2}&interval=1mo&events=history&includeAdjustedClose=true`;

    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
      }
    };

    // Native HTTPS Request to bypass proxy/blocking rules
    https.get(yahooCsvUrl, options, (response) => {
      if (response.statusCode !== 200) {
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Yahoo Finance rejected request with status " + response.statusCode }));
      }

      let rawData = "";
      response.on("data", (chunk) => { rawData += chunk; });
      
      response.on("end", () => {
        try {
          const lines = rawData.split("\n");
          if (lines.length <= 1) {
            res.writeHead(500, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Empty CSV response received from financial engine." }));
          }

          // Extract headers dynamically: Date,Open,High,Low,Close,Adj Close,Volume
          const headers = lines[0].trim().split(",");
          const dateIdx = headers.indexOf("Date");
          const openIdx = headers.indexOf("Open");
          const highIdx = headers.indexOf("High");
          const lowIdx = headers.indexOf("Low");
          const closeIdx = headers.indexOf("Close");
          const volumeIdx = headers.indexOf("Volume");

          const results = [];

          // Manual string CSV parsing engine
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const values = line.split(",");
            if (values.length < headers.length) continue;

            const date = values[dateIdx];
            const openVal = values[openIdx];
            const closeVal = values[closeIdx];

            if (date && openVal && closeVal && closeVal !== "null") {
              results.push({
                date: date,
                open: parseFloat(openVal),
                high: parseFloat(values[highIdx]),
                low: parseFloat(values[lowIdx]),
                close: parseFloat(closeVal),
                volume: parseInt(values[volumeIdx], 10) || 0
              });
            }
          }

          // Calculation Engine: Generate a 3-Month Simple Moving Average (SMA)
          const computedData = results.map((row, index, array) => {
            if (index >= 2) {
              const sum = array[index].close + array[index - 1].close + array[index - 2].close;
              row.movingAverage3Mo = parseFloat((sum / 3).toFixed(2));
            } else {
              row.movingAverage3Mo = row.close;
            }
            return row;
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(computedData));

        } catch (parseError) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "CSV Stream processing execution broke." }));
        }
      });

    }).on("error", (e) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Network connection breakdown: " + e.message }));
    });

  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal processing crash scenario." }));
  }
}

/**
 * UI Route Handler: Directly serves the HTML Dashboard code interface
 */
function handleChartsHtml(req, res) {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Financial Analysis Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: sans-serif; background: #f4f6f9; margin: 40px; color: #333; }
        .container { max-width: 1000px; margin: 0 auto; background: white; padding: 25px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
        .controls { margin-bottom: 25px; display: flex; gap: 10px; }
        input { padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 4px; width: 150px; }
        button { padding: 10px 20px; font-size: 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background: #0056b3; }
        #loading { display: none; color: #666; font-weight: bold; margin-bottom: 15px; }
    </style>
</head>
<body>

<div class="container">
    <h2>10-Year CSV Stock Performance Matrix</h2>
    
    <div class="controls">
        <input type="text" id="tickerInput" value="AAPL" placeholder="e.g. AAPL, MSFT, TSLA">
        <button onclick="renderStockChart()">Update Chart</button>
    </div>

    <div id="loading">Streaming and processing CSV rows...</div>
    <canvas id="stockCanvas" width="400" height="180"></canvas>
</div>

<script>
var activeChartInstance = null;

async function renderStockChart() {
    var ticker = document.getElementById("tickerInput").value.trim();
    var loader = document.getElementById("loading");
    if(!ticker) return alert("Please enter a valid ticker!");

    loader.style.display = "block";

    try {
        var response = await fetch("/api/chart-data?ticker=" + ticker);
        var data = await response.json();

        if (data.error) {
            alert("Error: " + data.error);
            return;
        }

        var dateLabels = data.map(function(item) { return item.date; });
        var closingPrices = data.map(function(item) { return item.close; });
        var movingAverages = data.map(function(item) { return item.movingAverage3Mo; });

        if (activeChartInstance) {
            activeChartInstance.destroy();
        }

        var ctx = document.getElementById("stockCanvas").getContext("2d");
        activeChartInstance = new Chart(ctx, {
            type: "line",
            data: {
                labels: dateLabels,
                datasets: [
                    {
                        label: ticker.toUpperCase() + " Monthly Close",
                        data: closingPrices,
                        borderColor: "#007bff",
                        backgroundColor: "transparent",
                        borderWidth: 2,
                        pointRadius: 1
                    },
                    {
                        label: "3-Month Moving Average (Calculated)",
                        data: movingAverages,
                        borderColor: "#ffc107",
                        backgroundColor: "transparent",
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                scales: {
                    x: { grid: { display: false } },
                    y: { ticks: { callback: function(value) { return "$" + value; } } }
                }
            }
        });
    } catch (err) {
        alert("Failed loading frontend script payload.");
    } finally {
        loader.style.display = "none";
    }
}

window.onload = renderStockChart;
</script>

</body>
</html>`);
}

module.exports = { handleChartData, handleChartsHtml };