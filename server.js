const https = require("https");

function handleChartsHtml(req, res) {
    res.writeHead(200, { "Content-Type": "text/html" });

    res.end(`
    <html>
    <head>
        <title>RIL Interval Volume</title>
    </head>
    <body>
        <h2>RIL Interval Volume Analysis</h2>
        <div id="data">Loading...</div>

        <script>
            fetch('/api/chart-data?ticker=RELIANCE.NS')
            .then(r => r.json())
            .then(d => {
                document.getElementById('data').innerHTML =
                    '<pre>' + JSON.stringify(d, null, 2) + '</pre>';
            })
            .catch(e => {
                document.getElementById('data').innerHTML =
                    'Error: ' + e.message;
            });
        </script>
    </body>
    </html>
    `);
}

function handleChartData(req, res) {

    const url =
        "https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=5y&interval=1d";

    https.get(url, yahooRes => {

        let body = "";

        yahooRes.on("data", chunk => {
            body += chunk;
        });

        yahooRes.on("end", () => {

            try {

                const json = JSON.parse(body);

                if (
                    !json.chart ||
                    !json.chart.result ||
                    !json.chart.result.length
                ) {
                    throw new Error("No Yahoo data");
                }

                const result =
                    json.chart.result[0];

                const quote =
                    result.indicators.quote[0];

                const rows = [];

                for (
                    let i = 0;
                    i < result.timestamp.length;
                    i++
                ) {

                    if (
                        quote.open[i] == null ||
                        quote.high[i] == null ||
                        quote.low[i] == null ||
                        quote.close[i] == null ||
                        quote.volume[i] == null
                    ) continue;

                    rows.push({
                        open: quote.open[i],
                        high: quote.high[i],
                        low: quote.low[i],
                        close: quote.close[i],
                        volume: quote.volume[i]
                    });
                }

                const INTERVAL_COUNT = 10;
                const TOP_N = 4;

                const closes =
                    rows.map(x => x.close);

                const closeMin =
                    Math.min(...closes);

                const closeMax =
                    Math.max(...closes);

                const step =
                    (closeMax - closeMin) /
                    INTERVAL_COUNT;

                const bins = [];

                for (
                    let i = 0;
                    i < INTERVAL_COUNT;
                    i++
                ) {

                    bins.push({
                        bin: i + 1,
                        low:
                            closeMin +
                            (i * step),
                        high:
                            closeMin +
                            ((i + 1) * step),
                        totalVol: 0,
                        upVol: 0,
                        downVol: 0
                    });
                }

                rows.forEach(r => {

                    const mid =
                        (r.high + r.low) / 2;

                    let idx =
                        Math.floor(
                            (mid - closeMin) /
                            step
                        );

                    idx = Math.max(
                        0,
                        Math.min(
                            idx,
                            INTERVAL_COUNT - 1
                        )
                    );

                    bins[idx].totalVol +=
                        r.volume;

                    if (r.close > r.open)
                        bins[idx].upVol +=
                            r.volume;

                    else if (
                        r.close < r.open
                    )
                        bins[idx].downVol +=
                            r.volume;
                });

                bins.forEach(b => {

                    if (
                        b.upVol >
                        b.downVol
                    )
                        b.type =
                            "Positive";

                    else if (
                        b.downVol >
                        b.upVol
                    )
                        b.type =
                            "Negative";

                    else
                        b.type =
                            "Neutral";
                });

                const top4 =
                    [...bins]
                        .sort(
                            (a, b) =>
                                b.totalVol -
                                a.totalVol
                        )
                        .slice(0, TOP_N);

                res.writeHead(200, {
                    "Content-Type":
                        "application/json"
                });

                res.end(
                    JSON.stringify({
                        success: true,
                        top4
                    })
                );

            } catch (e) {

                res.writeHead(500, {
                    "Content-Type":
                        "application/json"
                });

                res.end(
                    JSON.stringify({
                        success: false,
                        error: e.message
                    })
                );
            }
        });

    }).on("error", err => {

        res.writeHead(500, {
            "Content-Type":
                "application/json"
        });

        res.end(
            JSON.stringify({
                success: false,
                error: err.message
            })
        );
    });
}

module.exports = {
    handleChartData,
    handleChartsHtml
};