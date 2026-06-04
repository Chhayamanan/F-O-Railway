import datetime
import yfinance as yf

# Define the ticker symbol for Reliance Industries Limited on NSE
ticker_symbol = "RELIANCE.NS"

# Calculate the date range for the past 5 years
end_date = datetime.date.today()
start_date = end_date - datetime.timedelta(days=5 * 365)

print(f"Fetching data for {ticker_symbol} from {start_date} to {end_date}...")

try:
    # Fetch the historical data using yfinance
    # 'period' can also be used (e.g., period="5y"), but start/end dates offer precise control
    ril_data = yf.download(ticker_symbol, start=start_date, end=end_date, interval="1d")

    # Check if data was successfully retrieved
    if not ril_data.empty:
        # Display the first few rows of the dataframe
        print("\n--- First 5 Rows of Data ---")
        print(ril_data.head())

        # Save the data to a CSV file
        file_name = "RIL_5y_historical_data.csv"
        ril_data.to_csv(file_name)
        print(f"\nSuccess! Data successfully saved to '{file_name}'.")
    else:
        print("No data found. Please check the ticker symbol or your internet connection.")

except Exception as e:
    print(f"An error occurred: {e}")