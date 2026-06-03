npm install yahoo-finance2 asciichart
import yahooFinance from "yahoo-finance2";
import asciichart from "asciichart";

const INTERVAL_COUNT = 10;
const TOP_N = 4;

async function run() {

    const data = await yahooFinance.historical("RELIANCE.NS", {
        period1: "2020-01-01",
        interval: "1d"
    });

    if (!data || data.length === 0) {
        console.log("No data found");
        return;
    }

    const closes = data.map(x => x.close);
    const closeMin = Math.min(...closes);
    const closeMax = Math.max(...closes);

    const range = closeMax - closeMin;
    const stepSize = range / INTERVAL_COUNT;

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

    for (const row of data) {

        if (
            row.high == null ||
            row.low == null ||
            row.open == null ||
            row.close == null ||
            row.volume == null
        ) continue;

        const midPrice = (row.high + row.low) / 2;

        let idx = Math.floor((midPrice - closeMin) / stepSize);

        idx = Math.max(0, Math.min(idx, INTERVAL_COUNT - 1));

        bins[idx].totalVol += row.volume;

        if (row.close > row.open) {
            bins[idx].upVol += row.volume;
        } else if (row.close < row.open) {
            bins[idx].downVol += row.volume;
        }
    }

    bins.forEach(b => {

        if (b.upVol > b.downVol) {
            b.type = "Positive";
        } else if (b.downVol > b.upVol) {
            b.type = "Negative";
        } else {
            b.type = "Neutral";
        }
    });

    const top4 = [...bins]
        .sort((a, b) => b.totalVol - a.totalVol)
        .slice(0, TOP_N);

    let support = top4
        .filter(x => x.upVol > x.downVol)
        .sort((a, b) => b.upVol - a.upVol)[0];

    if (!support) {
        support = [...bins]
            .sort((a, b) => b.upVol - a.upVol)[0];
    }

    let resistance = top4
        .filter(x => x.downVol > x.upVol)
        .sort((a, b) => b.downVol - a.downVol)[0];

    if (!resistance) {
        resistance = [...bins]
            .sort((a, b) => b.downVol - a.downVol)[0];
    }

    console.log("\n============================");
    console.log("RIL INTERVAL VOLUME ANALYSIS");
    console.log("============================\n");

    console.table(
        top4.map(x => ({
            Bin: x.bin,
            Low: x.low.toFixed(2),
            High: x.high.toFixed(2),
            TotalVol: Math.round(x.totalVol),
            UpVol: Math.round(x.upVol),
            DownVol: Math.round(x.downVol),
            Type: x.type
        }))
    );

    console.log(
        `Support Zone : ${support.low.toFixed(2)} - ${support.high.toFixed(2)}`
    );

    console.log(
        `Resistance Zone : ${resistance.low.toFixed(2)} - ${resistance.high.toFixed(2)}`
    );

    console.log("\nClose Price Chart\n");

    const last250 = data
        .slice(-250)
        .map(x => x.close);

    console.log(
        asciichart.plot(last250, {
            height: 25
        })
    );
}

run().catch(console.error);