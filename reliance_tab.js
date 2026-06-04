const http = require('http');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const { setGlobalDispatcher, Agent } = require('undici');
setGlobalDispatcher(new Agent({ connect: { timeout: 60000 } }));
const { default: YahooFinance } = require('yahoo-finance2');

// Initialize yahoo-finance2 with the configuration provided
const yahooFinance = new YahooFinance({ 
  suppressNotices: ['ripHistorical']
});

// 1. Data Fetcher
async function getRelianceData() {
  const symbol = 'RELIANCE.NS';
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(endDate.getFullYear() - 5);

  const queryOptions = {
    period1: startDate.toISOString().split('T')[0],
    period2: endDate.toISOString().split('T')[0],
    interval: '1d',
  };

  try {
    const data = await yahooFinance.historical(symbol, queryOptions);
    return data;
  } catch (err) {
    console.error("Error fetching Reliance data:", err);
    throw err;
  }
}

// 2. CSV Generation Utility
function convertToCSV(data) {
  if (!data || !data.length) return "";
  const header = "Date,Open,High,Low,Close,Adj Close,Volume\n";
  const rows = data.map(r => {
    const d = r.date ? new Date(r.date).toISOString().split('T')[0] : '';
    return `${d},${r.open},${r.high},${r.low},${r.close},${r.adjClose},${r.volume}`;
  });
  return header + rows.join('\n');
}

// 3. HTML Generation Utility
function relianceHTML(data) {
  const first5 = data.slice(0, 5);
  let rowsHtml = first5.map(r => {
    const d = r.date ? new Date(r.date).toISOString().split('T')[0] : '';
    return `<tr>
      <td>${d}</td>
      <td>${r.open ? r.open.toFixed(2) : 'N/A'}</td>
      <td>${r.high ? r.high.toFixed(2) : 'N/A'}</td>
      <td>${r.low ? r.low.toFixed(2) : 'N/A'}</td>
      <td>${r.close ? r.close.toFixed(2) : 'N/A'}</td>
      <td>${r.volume || 'N/A'}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reliance Historical Data</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f0f;color:#e0e0e0;min-height:100vh}
  header{background:#161616;border-bottom:1px solid #2a2a2a;padding:14px 24px;display:flex;align-items:center;justify-content:space-between}
  header h1{font-size:16px;font-weight:600;color:#fff;letter-spacing:-0.02em}
  .tabs{background:#1a1a1a;padding:10px 24px;border-bottom:1px solid #333;display:flex;gap:12px}
  .tabs a{color:#888;text-decoration:none;font-size:14px;padding:6px 12px;border-radius:6px;transition:0.2s}
  .tabs a:hover{color:#fff;background:#333}
  .tabs a.active{color:#fff;background:#16a34a;font-weight:500}
  .container{padding:24px;max-width:900px;margin:0 auto}
  .card{background:#161616;border:1px solid #2a2a2a;border-radius:10px;padding:20px;margin-bottom:20px;}
  h2{font-size:16px;margin-bottom:16px;color:#fff}
  table{width:100%;border-collapse:collapse;font-size:14px;text-align:left;margin-bottom:20px}
  th,td{padding:10px;border-bottom:1px solid #2a2a2a}
  th{color:#888;font-weight:500}
  .btn{display:inline-block;padding:10px 18px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px}
  .btn:hover{background:#15803d}
</style>
</head>
<body>
<header>
  <h1>Reliance Data (5 Years)</h1>
</header>
<div class="tabs">
  <a href="/" id="dash-tab">Dashboard</a>
  <a href="/reliance" class="active">Reliance Data</a>
</div>
<div class="container">
  <div class="card">
    <h2>First 5 Rows of Data (RELIANCE.NS)</h2>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Open</th>
          <th>High</th>
          <th>Low</th>
          <th>Close</th>
          <th>Volume</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
    <a href="/reliance/csv" class="btn">Download RIL_5y_historical_data.csv</a>
  </div>
</div>
<script>
  if(window.location.pathname === "/") {
    document.getElementById("dash-tab").classList.add("active");
  }
</script>
</body>
</html>`;
}

// 4. Router Handler
async function handleRelianceRoute(req, res) {
  if (req.url === "/reliance") {
    try {
      const data = await getRelianceData();
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(relianceHTML(data));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Error fetching data: " + e.message);
    }
  } else if (req.url === "/reliance/csv") {
    try {
      const data = await getRelianceData();
      const csv = convertToCSV(data);
      res.writeHead(200, {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=RIL_5y_historical_data.csv"
      });
      res.end(csv);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Error fetching data: " + e.message);
    }
  } else if (req.url === "/") {
    // Provide a simple response for the root URL
    try {
      const data = await getRelianceData();
      res.writeHead(200, { "Content-Type": "text/html" });
      // Reusing HTML template for the base path dashboard layout
      res.end(relianceHTML(data));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Error processing dashboard: " + e.message);
    }
  } else {
    // Catch-all 404 handler
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 Not Found");
  }
}

module.exports = { handleRelianceRoute };