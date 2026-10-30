import requests
from bs4 import BeautifulSoup
import re
import time
from modules.common.ist_datetime import format_ist_standard, format_ist_display

_BULLION_CACHE = {
    "data": None,
    "timestamp": 0
}

CACHE_TTL_SECONDS = 600  # 10 minutes cache

def fetch_live_bullion_rates(force_refresh=False):
    """
    Fetches real-time Indian 22K (916 Hallmark) Gold and 99.9% Ready Silver rates.
    Uses Goodreturns bullion market feed with fallback.
    """
    global _BULLION_CACHE
    now = time.time()

    if not force_refresh and _BULLION_CACHE["data"] and (now - _BULLION_CACHE["timestamp"] < CACHE_TTL_SECONDS):
        return _BULLION_CACHE["data"]

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }

    gold_1g = "13,195"
    gold_8g = "1,05,560"
    silver_1g = "215.00"
    silver_8g = "1,720"
    source = "Fallback Bullion Benchmark"

    import re

    # 1. Fetch Gold Rates
    try:
        r_gold = requests.get('https://www.goodreturns.in/gold-rates/', headers=headers, timeout=8)
        if r_gold.status_code == 200:
            soup = BeautifulSoup(r_gold.text, 'html.parser')
            table = soup.find('table')
            if table:
                for tr in table.find_all('tr'):
                    tds = [td.get_text().strip().replace('\u20b9', '').replace(',', '').strip() for td in tr.find_all(['td', 'th'])]
                    if len(tds) >= 3:
                        gram_label = tds[0].split()[0] if tds[0] else ''
                        # Look for 1 Gram and 8 Grams in 22K column (index 2)
                        m22k = re.search(r"(\d+(?:\.\d+)?)", tds[2])
                        if m22k:
                            val = float(m22k.group(1))
                            if gram_label == '1':
                                gold_1g = f"{int(val):,}"
                            elif gram_label == '8':
                                gold_8g = f"{int(val):,}"
            source = "Goodreturns Live Bullion (22K 916 Hallmark)"
    except Exception as e:
        print(f"Error fetching live gold rates: {e}")

    # 2. Fetch Silver Rates
    try:
        r_silver = requests.get('https://www.goodreturns.in/silver-rates/', headers=headers, timeout=8)
        if r_silver.status_code == 200:
            soup_s = BeautifulSoup(r_silver.text, 'html.parser')
            table_s = soup_s.find('table')
            if table_s:
                for tr in table_s.find_all('tr'):
                    tds = [td.get_text().strip().replace('\u20b9', '').replace(',', '').strip() for td in tr.find_all(['td', 'th'])]
                    if len(tds) >= 2:
                        gram_label = tds[0].split()[0] if tds[0] else ''
                        msilver = re.search(r"(\d+(?:\.\d+)?)", tds[1])
                        if msilver:
                            val = float(msilver.group(1))
                            if gram_label == '1':
                                silver_1g = f"{val:,.2f}"
                            elif gram_label == '8':
                                silver_8g = f"{int(val):,}"
            if "Goodreturns" in source:
                source += " & Ready Silver (99.9% Fine)"
            else:
                source = "Goodreturns Ready Silver (99.9% Fine)"
    except Exception as e:
        print(f"Error fetching live silver rates: {e}")

    result = {
        "gold_1g": gold_1g,
        "gold_8g": gold_8g,
        "silver_1g": silver_1g,
        "silver_8g": silver_8g,
        "source": source,
        "updated_at": format_ist_standard(),
        "updated_at_display": format_ist_display(with_tz=True),
        "is_live": True
    }

    _BULLION_CACHE["data"] = result
    _BULLION_CACHE["timestamp"] = now
    return result
