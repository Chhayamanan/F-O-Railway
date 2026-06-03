"""
mStock Nifty Breakout Trading Bot
==================================
Strategy:
  - Track Nifty 50 day's High & Low
  - If current price breaks above Day High → Buy CALL option
  - If current price breaks below Day Low  → Buy PUT option
  - Runs every POLL_INTERVAL seconds during market hours
"""

import os
import time
import json
import logging
import requests
import pyotp
from datetime import datetime, time as dtime

# ─────────────────────────────────────────────
# CONFIGURATION — Fill these before running
# ─────────────────────────────────────────────
CONFIG = {
    "client_code":   "YOUR_CLIENT_CODE",       # e.g. "MA12345"
    "password":      "YOUR_PASSWORD",           # your mStock login password
    "api_key":       "YOUR_API_KEY",            # from trade.mstock.com
    "totp_secret":   "YOUR_TOTP_SECRET",        # base32 secret from TOTP QR code (leave "" to use OTP instead)

    # Nifty 50 token on NSE (standard token — verify via ScripMaster if needed)
    "nifty_token":   "26000",
    "nifty_exchange": "NSE",

    # Option buying settings
    "option_exchange":   "NFO",                 # NFO for Nifty options
    "option_lot_size":   25,                    # 1 lot = 25 qty (verify current lot size)
    "option_lots":       1,                     # number of lots to buy
    "option_product":    "CARRYFORWARD",        # CARRYFORWARD for F&O
    "strike_offset":     100,                   # nearest strike rounded to 100

    # Polling
    "poll_interval_sec": 30,                    # how often to check price (seconds)

    # Market hours (IST)
    "market_open":  dtime(9, 15),
    "market_close": dtime(15, 30),
}

BASE_URL = "https://api.mstock.trade/openapi/typeb"

# ─────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("nifty_trader.log"),
    ],
)
log = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# SESSION STATE
# ─────────────────────────────────────────────
class Session:
    jwt_token:     str = ""
    refresh_token: str = ""
    order_placed:  str = ""   # "CALL" | "PUT" | ""


session = Session()


# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────
def _headers(auth: bool = True) -> dict:
    h = {
        "X-Mirae-Version": "1",
        "X-PrivateKey":    CONFIG["api_key"],
        "Content-Type":    "application/json",
    }
    if auth:
        h["Authorization"] = f"Bearer {session.jwt_token}"
    return h


def _raise_if_error(resp: requests.Response, context: str):
    try:
        data = resp.json()
    except Exception:
        raise RuntimeError(f"{context}: non-JSON response [{resp.status_code}] {resp.text}")
    status = str(data.get("status", "")).lower()
    if status not in ("true", "success", "1"):
        raise RuntimeError(f"{context} failed: {data.get('message', data)}")
    return data


# ─────────────────────────────────────────────
# STEP 1 — LOGIN  (triggers OTP / uses TOTP)
# ─────────────────────────────────────────────
def login() -> str:
    """Returns refreshToken from login response."""
    log.info("Logging in as %s …", CONFIG["client_code"])

    totp_val = ""
    if CONFIG["totp_secret"]:
        totp_val = pyotp.TOTP(CONFIG["totp_secret"]).now()
        log.info("TOTP generated: %s", totp_val)

    resp = requests.post(
        f"{BASE_URL}/connect/login",
        headers=_headers(auth=False),
        json={
            "clientcode": CONFIG["client_code"],
            "password":   CONFIG["password"],
            "totp":       totp_val,
            "state":      "",
        },
    )
    data = _raise_if_error(resp, "Login")
    refresh_token = data["data"]["jwtToken"]   # this is the refreshToken used in next step
    log.info("Login OK — OTP sent / TOTP accepted")
    return refresh_token


# ─────────────────────────────────────────────
# STEP 2A — GENERATE SESSION WITH OTP
# ─────────────────────────────────────────────
def generate_session_otp(refresh_token: str, otp: str) -> str:
    """Exchange refreshToken + OTP for a JWT access token."""
    log.info("Generating session with OTP …")
    resp = requests.post(
        f"{BASE_URL}/session/token",
        headers=_headers(auth=False),
        json={"refreshToken": refresh_token, "otp": otp},
    )
    data = _raise_if_error(resp, "Session/token")
    return data["data"]["jwtToken"]


# ─────────────────────────────────────────────
# STEP 2B — GENERATE SESSION WITH TOTP
# ─────────────────────────────────────────────
def generate_session_totp(refresh_token: str) -> str:
    """Exchange refreshToken + live TOTP for a JWT access token."""
    totp_val = pyotp.TOTP(CONFIG["totp_secret"]).now()
    log.info("Verifying TOTP session …")
    resp = requests.post(
        f"{BASE_URL}/session/verifytotp",
        headers=_headers(auth=False),
        json={"refreshToken": refresh_token, "totp": totp_val},
    )
    data = _raise_if_error(resp, "VerifyTOTP")
    return data["data"]["jwtToken"]


# ─────────────────────────────────────────────
# FULL LOGIN FLOW
# ─────────────────────────────────────────────
def do_login():
    refresh_token = login()

    if CONFIG["totp_secret"]:
        session.jwt_token = generate_session_totp(refresh_token)
    else:
        otp = input("Enter OTP received on mobile/email: ").strip()
        session.jwt_token = generate_session_otp(refresh_token, otp)

    log.info("Session established. JWT obtained.")


# ─────────────────────────────────────────────
# MARKET DATA — NIFTY OHLC
# ─────────────────────────────────────────────
def get_nifty_ohlc() -> dict:
    """Returns dict with keys: open, high, low, close, ltp"""
    resp = requests.get(
        f"{BASE_URL}/instruments/quote",
        headers=_headers(),
        json={
            "mode": "OHLC",
            "exchangeTokens": {
                CONFIG["nifty_exchange"]: [CONFIG["nifty_token"]]
            },
        },
    )
    data = _raise_if_error(resp, "OHLC")
    fetched = data["data"]["fetched"]
    if not fetched:
        raise RuntimeError("OHLC: empty fetched list — check Nifty token")
    return fetched[0]   # {exchange, tradingSymbol, symbolToken, ltp, open, high, low, close}


# ─────────────────────────────────────────────
# INSTRUMENT LOOKUP — find option token from ScripMaster
# ─────────────────────────────────────────────
_scrip_master_cache: list = []

def get_scrip_master() -> list:
    global _scrip_master_cache
    if _scrip_master_cache:
        return _scrip_master_cache
    log.info("Downloading ScripMaster …")
    resp = requests.get(
        f"{BASE_URL}/instruments/OpenAPIScripMaster",
        headers=_headers(),
    )
    if resp.status_code != 200:
        raise RuntimeError(f"ScripMaster download failed: {resp.status_code}")
    _scrip_master_cache = resp.json()
    log.info("ScripMaster loaded: %d instruments", len(_scrip_master_cache))
    return _scrip_master_cache


def find_nifty_option(option_type: str, spot: float) -> dict:
    """
    Find the nearest ATM Nifty weekly/monthly option.
    option_type: "CE" or "PE"
    Returns instrument dict with token, symbol, expiry, strike, lotsize
    """
    strike = round(spot / CONFIG["strike_offset"]) * CONFIG["strike_offset"]
    instruments = get_scrip_master()
    today = datetime.now().date()

    candidates = []
    for inst in instruments:
        if (
            inst.get("exch_seg") == "NFO"
            and inst.get("instrumenttype") == "OPTIDX"
            and "NIFTY" in inst.get("name", "").upper()
            and inst.get("symbol", "").upper() == option_type   # CE or PE
        ):
            try:
                exp_date = datetime.strptime(inst["expiry"], "%d%b%Y").date()
            except Exception:
                continue
            if exp_date < today:
                continue
            inst_strike = float(inst.get("strike", 0))
            candidates.append((abs(inst_strike - strike), exp_date, inst))

    if not candidates:
        raise RuntimeError(
            f"No {option_type} option found near strike {strike}. "
            "Check ScripMaster format / token."
        )

    # Sort: nearest strike first, then nearest expiry
    candidates.sort(key=lambda x: (x[0], x[1]))
    _, exp_date, best = candidates[0]
    log.info(
        "Selected option: %s | strike=%s | expiry=%s | token=%s",
        best.get("name"), best.get("strike"), best.get("expiry"), best.get("token"),
    )
    return best


# ─────────────────────────────────────────────
# ORDER PLACEMENT
# ─────────────────────────────────────────────
def place_order(instrument: dict, option_type: str) -> str:
    """Place a MARKET BUY order for the given option. Returns order ID."""
    qty = CONFIG["option_lot_size"] * CONFIG["option_lots"]
    payload = {
        "variety":         "NORMAL",
        "tradingsymbol":   instrument["name"],      # e.g. NIFTY25JUN24500CE
        "symboltoken":     instrument["token"],
        "exchange":        CONFIG["option_exchange"],
        "transactiontype": "BUY",
        "ordertype":       "MARKET",
        "quantity":        str(qty),
        "producttype":     CONFIG["option_product"],
        "price":           "0",
        "triggerprice":    "0",
        "squareoff":       "0",
        "stoploss":        "0",
        "trailingStopLoss": "",
        "disclosedquantity": "",
        "duration":        "DAY",
        "ordertag":        f"nifty_breakout_{option_type}",
    }

    log.info("Placing %s order: %s x%d …", option_type, instrument["name"], qty)
    resp = requests.post(
        f"{BASE_URL}/orders/regular",
        headers=_headers(),
        json=payload,
    )
    data = _raise_if_error(resp, "PlaceOrder")
    order_id = data["data"]["orderid"]
    log.info("Order placed! Order ID: %s", order_id)
    return order_id


# ─────────────────────────────────────────────
# MARKET HOURS CHECK
# ─────────────────────────────────────────────
def is_market_open() -> bool:
    now = datetime.now().time()
    return (
        datetime.now().weekday() < 5   # Mon–Fri
        and CONFIG["market_open"] <= now <= CONFIG["market_close"]
    )


# ─────────────────────────────────────────────
# MAIN TRADING LOOP
# ─────────────────────────────────────────────
def trading_loop():
    log.info("=" * 60)
    log.info("  mStock Nifty Breakout Bot  started")
    log.info("  Poll interval : %ds", CONFIG["poll_interval_sec"])
    log.info("=" * 60)

    day_high: float = None
    day_low:  float = None

    while True:
        try:
            if not is_market_open():
                now_str = datetime.now().strftime("%H:%M:%S")
                log.info("[%s] Market closed — waiting …", now_str)
                # Reset state for next day
                if datetime.now().time() > CONFIG["market_close"]:
                    session.order_placed = ""
                    day_high = None
                    day_low  = None
                time.sleep(60)
                continue

            # ── Fetch OHLC ──────────────────────────────────────
            ohlc = get_nifty_ohlc()
            ltp  = float(ohlc["ltp"])
            high = float(ohlc["high"])
            low  = float(ohlc["low"])

            # Initialise day levels on first fetch
            if day_high is None:
                day_high = high
                day_low  = low
                log.info("Day levels set → High: %.2f  Low: %.2f", day_high, day_low)

            # Update rolling day high/low
            day_high = max(day_high, high)
            day_low  = min(day_low,  low)

            log.info(
                "LTP: %.2f  |  Day High: %.2f  |  Day Low: %.2f  |  "
                "Order: %s",
                ltp, day_high, day_low,
                session.order_placed or "None",
            )

            # ── Breakout Logic ───────────────────────────────────
            if ltp > day_high and session.order_placed != "CALL":
                log.info("🚀 BREAKOUT ABOVE DAY HIGH! Buying CALL …")
                instrument = find_nifty_option("CE", ltp)
                order_id   = place_order(instrument, "CALL")
                session.order_placed = "CALL"
                log.info("✅ CALL order placed. Order ID: %s", order_id)

            elif ltp < day_low and session.order_placed != "PUT":
                log.info("📉 BREAKDOWN BELOW DAY LOW! Buying PUT …")
                instrument = find_nifty_option("PE", ltp)
                order_id   = place_order(instrument, "PUT")
                session.order_placed = "PUT"
                log.info("✅ PUT order placed. Order ID: %s", order_id)

        except requests.exceptions.ConnectionError as e:
            log.error("Network error: %s — retrying in 30s", e)

        except RuntimeError as e:
            log.error("API error: %s", e)
            # If session expired, re-login
            if "Invalid request" in str(e) or "suspended" in str(e):
                log.warning("Session may have expired — re-logging in …")
                try:
                    do_login()
                except Exception as login_err:
                    log.error("Re-login failed: %s", login_err)

        except KeyboardInterrupt:
            log.info("Interrupted by user. Exiting.")
            break

        except Exception as e:
            log.exception("Unexpected error: %s", e)

        time.sleep(CONFIG["poll_interval_sec"])


# ─────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────
if __name__ == "__main__":
    # 1. Login
    do_login()

    # 2. (Optional) verify funds
    try:
        resp = requests.get(
            f"{BASE_URL}/user/fundsummary",
            headers=_headers(),
        )
        funds = resp.json()
        if funds.get("status") in (True, "true"):
            avail = funds["data"][0].get("AVAILABLE_BALANCE", "N/A")
            log.info("Available balance: ₹%s", avail)
    except Exception as e:
        log.warning("Could not fetch fund summary: %s", e)

    # 3. Start trading loop
    trading_loop()
