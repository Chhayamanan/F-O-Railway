import yfinance as yf
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

# ==========================================
# STEP 1 - FETCH RIL DATA
# ==========================================

symbol = "RELIANCE.NS"

df = yf.download(
    symbol,
    period="5y",
    auto_adjust=False,
    progress=False
)

df = df[['Open','High','Low','Close','Volume']]
df.dropna(inplace=True)

# ==========================================
# STEP 2 - INTERVAL CALCULATION
# ==========================================

INTERVAL_COUNT = 10
TOP_N = 4

close_min = df["Close"].min()
close_max = df["Close"].max()

price_range = close_max - close_min
step_size = price_range / INTERVAL_COUNT

bins = []

for i in range(INTERVAL_COUNT):
    low = close_min + i * step_size
    high = low + step_size

    bins.append({
        "Bin": i + 1,
        "Low": low,
        "High": high,
        "TotalVol": 0,
        "UpVol": 0,
        "DownVol": 0
    })

# ==========================================
# STEP 3 - ASSIGN VOLUME TO INTERVALS
# ==========================================

for _, row in df.iterrows():

    mid_price = (row["High"] + row["Low"]) / 2

    idx = int((mid_price - close_min) / step_size)

    idx = max(0, min(idx, INTERVAL_COUNT - 1))

    bins[idx]["TotalVol"] += row["Volume"]

    if row["Close"] > row["Open"]:
        bins[idx]["UpVol"] += row["Volume"]

    elif row["Close"] < row["Open"]:
        bins[idx]["DownVol"] += row["Volume"]

# ==========================================
# STEP 4 - CREATE TABLE
# ==========================================

interval_df = pd.DataFrame(bins)

interval_df["Type"] = np.where(
    interval_df["UpVol"] > interval_df["DownVol"],
    "Positive",
    np.where(
        interval_df["DownVol"] > interval_df["UpVol"],
        "Negative",
        "Neutral"
    )
)

interval_df = interval_df.sort_values(
    "TotalVol",
    ascending=False
)

top4 = interval_df.head(TOP_N)

# ==========================================
# STEP 5 - SUPPORT
# ==========================================

positive_bins = top4[top4["UpVol"] > top4["DownVol"]]

if len(positive_bins):
    support_row = positive_bins.loc[
        positive_bins["UpVol"].idxmax()
    ]
else:
    support_row = interval_df.loc[
        interval_df["UpVol"].idxmax()
    ]

support_low = support_row["Low"]
support_high = support_row["High"]

# ==========================================
# STEP 6 - RESISTANCE
# ==========================================

negative_bins = top4[top4["DownVol"] > top4["UpVol"]]

if len(negative_bins):
    resistance_row = negative_bins.loc[
        negative_bins["DownVol"].idxmax()
    ]
else:
    resistance_row = interval_df.loc[
        interval_df["DownVol"].idxmax()
    ]

resistance_low = resistance_row["Low"]
resistance_high = resistance_row["High"]

# ==========================================
# STEP 7 - OUTPUT TABLE
# ==========================================

print("\nTOP 4 INTERVALS")
print(top4[
    [
        "Bin",
        "Low",
        "High",
        "TotalVol",
        "UpVol",
        "DownVol",
        "Type"
    ]
].round(2))

print("\nSUPPORT ZONE")
print(
    f"{support_low:.2f} - {support_high:.2f}"
)

print("\nRESISTANCE ZONE")
print(
    f"{resistance_low:.2f} - {resistance_high:.2f}"
)

# ==========================================
# STEP 8 - CHART
# ==========================================

plt.figure(figsize=(16,8))

plt.plot(
    df.index,
    df["Close"],
    linewidth=1.2,
    label="Close Price"
)

plt.axhspan(
    support_low,
    support_high,
    alpha=0.25,
    label="Support Zone"
)

plt.axhspan(
    resistance_low,
    resistance_high,
    alpha=0.25,
    label="Resistance Zone"
)

plt.title(
    f"{symbol} Interval Volume Support Resistance"
)

plt.ylabel("Price")
plt.legend()
plt.grid(True)

plt.show()