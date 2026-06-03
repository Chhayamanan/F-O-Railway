const https = require("https");

const INTERVAL_COUNT = 10;
const TOP_N = 4;

function fetchYahooData() {
    return new Promise((resolve, reject) => {

        const url =
            "https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=5y&interval=1d";

        const req = https.get(url, (res) => {

            let body = "";

            res.on("data", chunk => {
                body += chunk;
            });

            res.on("end", () => {

                try {

                    const json = JSON.parse(body);

                    if (
                        !json.chart ||
                        !json.chart.result ||
                        !json.chart.result.length
                    ) {
                        reject(new Error("No Yahoo data"));
                        return;
                    }

                    const result = json.chart.result[0];
                    const quote = result.indicators.quote[0];

                    const rows = [];

                    for (let i = 0; i < result.timestamp.length; i++) {

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

                    resolve(rows);

                } catch (e) {
                    reject(e);
                }
            });
        });

        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error("Yahoo timeout"));
        });

        req.on("error", reject);
    });
}

async function run() {

    try {

        const rows = await fetchYahooData();

        const closes = rows.map(r => r.close);

        const closeMin = Math.min(...closes);
        const closeMax = Math.max(...closes);

        const stepSize =
            (closeMax - closeMin) / INTERVAL_COUNT;

        const bins = [];

        for (let i = 0; i < INTERVAL_COUNT; i++) {

            bins.push({
                bin: i + 1,
                low: closeMin + (i * stepSize),
                high: closeMin + ((i + 1) * stepSize),
                totalVol: 0,
                upVol: 0,
                downVol: 0
            });
        }

        for (const row of rows) {

            const midPrice =
                (row.high + row.low) / 2;

            let idx =
                Math.floor(
                    (midPrice - closeMin) /
                    stepSize
                );

            idx = Math.max(
                0,
                Math.min(idx, INTERVAL_COUNT - 1)
            );

            bins[idx].totalVol += row.volume;

            if (row.close > row.open) {
                bins[idx].upVol += row.volume;
            }
            else if (row.close < row.open) {
                bins[idx].downVol += row.volume;
            }
        }

        bins.forEach(b => {

            if (b.upVol > b.downVol)
                b.type = "Positive";

            else if (b.downVol > b.upVol)
                b.type = "Negative";

            else
                b.type = "Neutral";
        });

        const top4 =
            [...bins]
                .sort(
                    (a, b) =>
                        b.totalVol - a.totalVol
                )
                .slice(0, TOP_N);

        let support =
            top4
                .filter(
                    x =>
                        x.upVol >
                        x.downVol
                )
                .sort(
                    (a, b) =>
                        b.upVol - a.upVol
                )[0];

        if (!support) {
            support =
                [...bins]
                    .sort(
                        (a, b) =>
                            b.upVol - a.upVol
                    )[0];
        }

        let resistance =
            top4
                .filter(
                    x =>
                        x.downVol >
                        x.upVol
                )
                .sort(
                    (a, b) =>
                        b.downVol -
                        a.downVol
                )[0];

        if (!resistance) {
            resistance =
                [...bins]
                    .sort(
                        (a, b) =>
                            b.downVol -
                            a.downVol
                    )[0];
        }

        console.log("\n===== TOP 4 INTERVALS =====\n");

        console.table(
            top4.map(x => ({
                Bin: x.bin,
                Low: x.low.toFixed(2),
                High: x.high.toFixed(2),
                TotalVol: Math.round(
                    x.totalVol
                ),
                UpVol: Math.round(
                    x.upVol
                ),
                DownVol: Math.round(
                    x.downVol
                ),
                Type: x.type
            }))
        );

        console.log(
            "\nSupport Zone:",
            support.low.toFixed(2),
            "-",
            support.high.toFixed(2)
        );

        console.log(
            "Resistance Zone:",
            resistance.low.toFixed(2),
            "-",
            resistance.high.toFixed(2)
        );

    }
    catch (err) {

        console.error(
            "ERROR:",
            err.message
        );
    }
}

run();