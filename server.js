
const http = require("http");
const bot = require("./bot");
const charts = require("./charts");

const dashPort = process.env.PORT || 3000;

function startDashboard() {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/api/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...bot.state, marketOpen: bot.isMarketOpen() }));
    } else if (req.url.startsWith("/api/chart-data?ticker=")) {
      charts.handleChartData(req, res);
    } else if (req.url === "/charts") {
      charts.handleChartsHtml(req, res);
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(bot.dashboardHTML());
    }
  });
  server.listen(dashPort, () => {
    bot.info("Dashboard running at http://localhost:" + dashPort);
  });
}

(async () => {
  try {
    startDashboard();
    await bot.doLogin();

    try {
      const funds = await bot.apiCall("GET", "/user/fundsummary");
      if (funds.status === true || funds.status === "true") {
        bot.state.balance = funds.data[0].AVAILABLE_BALANCE;
        bot.info(`Balance: Rs. ${bot.state.balance}`);
      }
    } catch (e) { bot.warn("Fund summary: " + e.message); }

    await bot.tradingLoop();
  } catch (e) {
    bot.error("Fatal: " + e.message);
    process.exit(1);
  }
})();
