const https = require("https");

// Hardcoded for Reliance Industries
const TICKER = "RELIANCE.NS";

/**
 * BACKEND LOGIC: Handles Steps 1, 2, and 3 entirely in RAM
 */
function handleChartData(req, res) {
  try {
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - (10 * 365 * 24 * 60 * 60); // 10 Year Lookback

    const yahooCsvUrl = `https://query1.finance.yahoo.com/v7/finance/download/${TICKER}?period1=${period1}&period2=${period2}&interval=1mo&events=history&includeAdjustedClose=true`;

    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9"
      }
    };

    // STEP 1: Fetch raw data from Yahoo Finance
    https.get(yahooCsvUrl, options, (response) => {
      if (response.statusCode !== 200) {
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Yahoo engine rejected request. Status: " + response.statusCode }));
      }

      let rawData = "";
      response.on("data", (chunk) => { rawData += chunk; });
      
      response.on("end", () => {
        try {
          // STEP 2 & 3: Read CSV data streams directly out of memory and calculate
          const lines = rawData.split("\n");
          if (lines.length <= 1) {
            res.writeHead(500, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Empty stream returned from data provider." }));
          }

          const headers = lines[0].trim().split(",");
          const dateIdx = headers.indexOf("Date");
          const openIdx = headers.indexOf("Open");
          const highIdx = headers.indexOf("High");
          const lowIdx = headers.indexOf("Low");
          const closeIdx = headers.indexOf("Close");
          const volumeIdx = headers.indexOf("Volume");

          const results = [];

          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const values = line.split(",");
            if (values.length < headers.length) continue;

            const closeVal = values[closeIdx];
            if (values[dateIdx] && closeVal && closeVal !== "null") {
              results.push({
                date: values[dateIdx],
                open: parseFloat(values[openIdx]),
                high: parseFloat(values[highIdx]),
                low: parseFloat(values[lowIdx]),
                close: parseFloat(closeVal),
                volume: parseInt(values[volumeIdx], 10) || 0
              });
            }
          }

          // Calculation Pipeline: 3-Month Moving Average
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

        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "In-memory processing malfunction." }));
        }
      });
    }).on("error", (e) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Network stream connection dropped." }));
    });

  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal service logic error." }));
  }
}

/**
 * FRONTEND LOGIC: Handles Steps 4 and 5 (Build and Render Chart)
 */
function handleChartsHtml(req, res) {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>RIL Automation Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: sans-serif; background: #f4f6f9; margin: 40px; color: #333; }
        .container { max-width: 1000px; margin: 0 auto; background: white; padding: 25px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
        #status { color: #666; font-weight: bold; margin-bottom: 15px; }
    </style>
</head>
<body>

<div class="container">
    <h2>Reliance Industries (RIL) Automated Performance Chart</h2>
    <div id="status">Execution Status: Syncing with Financial Pipeline...</div>
    <canvas id="stockCanvas" width="400" height="180"></canvas>
</div>

<script>
var activeChartInstance = null;

async function runAutomationPipeline() {
    var statusText = document.getElementById("status");

    try {
        var response = await fetch("/api/chart-data");
        var data = await response.json();

        if (data.error) {
            statusText.innerText = "Execution Status: Failed - " + data.error;
            return;
        }

        statusText.innerText = "Execution Status: Steps 1-3 Complete. Processing Visual Layer...";

        var dateLabels = data.map(function(item) { return item.date; });
        var closingPrices = data.map(function(item) { return item.close; });
        var movingAverages = data.map(function(item) { return item.movingAverage3Mo; });

        if (activeChartInstance) {
            activeChartInstance.destroy();
        }

        // STEP 4 & 5: Make and Display the Chart Layout
        var ctx = document.getElementById("stockCanvas").getContext("2d");
        activeChartInstance = new Chart(ctx, {
            type: "line",
            data: {
                labels: dateLabels,
                datasets: [
                    {
                        label: "RIL Close Price (INR)",
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
                    y: { ticks: { callback: function(value) { return "₹" + value; } } }
                }
            }
        });

        statusText.innerText = "Execution Status: Live Chart Display Active.";

    } catch (err) {
        statusText.innerText = "Execution Status: Critical Display Layout Failure.";
    }
}

window.onload = runAutomationPipeline;
</script>

</body>
</html>`);
}

module.exports = { handleChartData, handleChartsHtml };