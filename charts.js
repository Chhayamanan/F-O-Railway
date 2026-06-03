const https = require("https");

const INTERVAL_COUNT = 10;
const TOP_N = 4;

https.get(
  "https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=5y&interval=1d",
  (res) => {
    let data = "";

    res.on("data", (chunk) => {
      data += chunk;
    });

    res.on("end", () => {
      try {
        const json = JSON.parse(data);

        const result = json.chart.result[0];

        const ts = result.timestamp;
        const q = result.indicators.quote[0];

        const rows = [];

        for (let i = 0; i < ts.length; i++) {
          if (
            q.open[i] == null ||
            q.high[i] == null ||
            q.low[i] == null ||
            q.close[i] == null ||
            q.volume[i] == null
          )
            continue;

          rows.push({
            open: q.open[i],
            high: q.high[i],
            low: q.low[i],
            close: q.close[i],
            volume: q.volume[i],
          });
        }

        const closes = rows.map((r) => r.close);

        const closeMin = Math.min(...closes);
        const closeMax = Math.max(...closes);

        const step = (closeMax - closeMin) / INTERVAL_COUNT;

        const bins = [];

        for (let i = 0; i < INTERVAL_COUNT; i++) {
          bins.push({
            bin: i + 1,
            low: closeMin + i * step,
            high: closeMin + (i + 1) * step,
            totalVol: 0,
            upVol: 0,
            downVol: 0,
          });
        }

        rows.forEach((r) => {
          const mid = (r.high + r.low) / 2;

          let idx = Math.floor((mid - closeMin) / step);

          if (idx < 0) idx = 0;
          if (idx >= INTERVAL_COUNT) idx = INTERVAL_COUNT - 1;

          bins[idx].totalVol += r.volume;

          if (r.close > r.open)
            bins[idx].upVol += r.volume;
          else if (r.close < r.open)
            bins[idx].downVol += r.volume;
        });

        bins.forEach((b) => {
          if (b.upVol > b.downVol) b.type = "Positive";
          else if (b.downVol > b.upVol) b.type = "Negative";
          else b.type = "Neutral";
        });

        const top4 = [...bins]
          .sort((a, b) => b.totalVol - a.totalVol)
          .slice(0, TOP_N);

        let support = top4
          .filter((x) => x.upVol > x.downVol)
          .sort((a, b) => b.upVol - a.upVol)[0];

        if (!support)
          support = [...bins].sort((a, b) => b.upVol - a.upVol)[0];

        let resistance = top4
          .filter((x) => x.downVol > x.upVol)
          .sort((a, b) => b.downVol - a.downVol)[0];

        if (!resistance)
          resistance = [...bins].sort((a, b) => b.downVol - a.downVol)[0];

        console.log("\n===== TOP 4 INTERVALS =====\n");

        console.table(
          top4.map((x) => ({
            Bin: x.bin,
            Low: x.low.toFixed(2),
            High: x.high.toFixed(2),
            TotalVol: Math.round(x.totalVol),
            UpVol: Math.round(x.upVol),
            DownVol: Math.round(x.downVol),
            Type: x.type,
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
      } catch (e) {
        console.error(e);
      }
    });
  }
);