import os
import json
import datetime
import time
import requests
import xml.etree.ElementTree as ET
import urllib.parse
from urllib.parse import quote_plus
from flask import Blueprint, request, jsonify, session
from modules.common.auth_utils import login_required
from modules.common.data_paths import BASE_DATA_DIR
from modules.common.market_fetcher import news_cache, POPULAR_INDIAN_STOCKS

news_bp = Blueprint("news_api", __name__)

API_SETTINGS_FILE = os.path.join(BASE_DATA_DIR, "api_settings.json")

def load_api_settings():
    if os.path.exists(API_SETTINGS_FILE):
        try:
            with open(API_SETTINGS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "active_provider": "auto",
        "alphavantage_key": os.environ.get("ALPHAVANTAGE_API_KEY", ""),
        "finnhub_key": os.environ.get("FINNHUB_API_KEY", ""),
        "newsapi_key": os.environ.get("NEWSAPI_KEY", "")
    }

def save_api_settings(settings):
    try:
        with open(API_SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2)
        return True
    except Exception:
        return False

class FinancialNewsEngine:
    @staticmethod
    def fetch_news_for_symbol(symbol=None):
        settings = load_api_settings()
        provider = settings.get("active_provider", "auto")
        
        av_key = settings.get("alphavantage_key") or os.environ.get("ALPHAVANTAGE_API_KEY")
        fh_key = settings.get("finnhub_key") or os.environ.get("FINNHUB_API_KEY")
        na_key = settings.get("newsapi_key") or os.environ.get("NEWSAPI_KEY")

        # 1. Alpha Vantage Dedicated News & Sentiment API
        if (provider in ["alphavantage", "auto"]) and av_key:
            articles = FinancialNewsEngine._fetch_alphavantage(symbol, av_key)
            if articles:
                return articles

        # 2. Finnhub Dedicated Company News API
        if (provider in ["finnhub", "auto"]) and fh_key:
            articles = FinancialNewsEngine._fetch_finnhub(symbol, fh_key)
            if articles:
                return articles

        # 3. NewsAPI.org Financial News API
        if (provider in ["newsapi", "auto"]) and na_key:
            articles = FinancialNewsEngine._fetch_newsapi(symbol, na_key)
            if articles:
                return articles

        # 4. Fallback: Keyless Financial News RSS Engine
        return FinancialNewsEngine._fetch_google_financial(symbol)

    @staticmethod
    def _fetch_alphavantage(symbol, api_key):
        try:
            raw_sym = (symbol or "").strip().upper()
            clean_ticker = raw_sym.replace(".NS", "").replace(".BO", "").replace("^", "")
            
            if not clean_ticker:
                url = f"https://www.alphavantage.co/query?function=NEWS_SENTIMENT&topics=financial_markets&limit=15&apikey={api_key}"
            else:
                url = f"https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers={clean_ticker}&limit=15&apikey={api_key}"
            
            headers = {'User-Agent': 'Mozilla/5.0'}
            resp = requests.get(url, headers=headers, timeout=6)
            if resp.status_code == 200:
                data = resp.json()
                feed = data.get("feed", [])
                if feed:
                    articles = []
                    for item in feed[:15]:
                        sent_label = item.get("overall_sentiment_label", "Neutral")
                        articles.append({
                            "title": item.get("title", ""),
                            "publisher": item.get("source", "Alpha Vantage News"),
                            "link": item.get("url", "#"),
                            "pub_date": item.get("time_published", ""),
                            "summary": item.get("summary", ""),
                            "sentiment": sent_label,
                            "image": item.get("banner_image", ""),
                            "provider": "Alpha Vantage API"
                        })
                    return articles
        except Exception:
            pass
        return None

    @staticmethod
    def _fetch_finnhub(symbol, api_key):
        try:
            raw_sym = (symbol or "").strip().upper()
            clean_sym = raw_sym.replace(".NS", "").replace(".BO", "").replace("^", "")
            headers = {'User-Agent': 'Mozilla/5.0'}

            if not clean_sym:
                url = f"https://finnhub.io/api/v1/news?category=general&token={api_key}"
            else:
                import datetime
                today_str = datetime.date.today().strftime("%Y-%m-%d")
                prev_str = (datetime.date.today() - datetime.timedelta(days=14)).strftime("%Y-%m-%d")
                url = f"https://finnhub.io/api/v1/company-news?symbol={clean_sym}&from={prev_str}&to={today_str}&token={api_key}"
            
            resp = requests.get(url, headers=headers, timeout=6)
            if resp.status_code == 200:
                feed = resp.json()
                if isinstance(feed, list) and len(feed) > 0:
                    articles = []
                    for item in feed[:15]:
                        dt_val = item.get("datetime")
                        pub_str = datetime.datetime.fromtimestamp(dt_val).strftime("%b %d, %Y %H:%M") if dt_val else ""
                        articles.append({
                            "title": item.get("headline", ""),
                            "publisher": item.get("source", "Finnhub Financial"),
                            "link": item.get("url", "#"),
                            "pub_date": pub_str,
                            "summary": item.get("summary", ""),
                            "sentiment": "Neutral",
                            "image": item.get("image", ""),
                            "provider": "Finnhub API"
                        })
                    return articles
        except Exception:
            pass
        return None

    @staticmethod
    def _fetch_newsapi(symbol, api_key):
        try:
            raw_sym = (symbol or "").strip().upper()
            clean_sym = raw_sym.replace(".NS", "").replace(".BO", "").replace("^", "")
            q_str = f'"{clean_sym}" stock' if clean_sym else "Indian Stock Market Nifty Sensex"
            encoded = urllib.parse.quote(q_str)
            url = f"https://newsapi.org/v2/everything?q={encoded}&sortBy=publishedAt&pageSize=15&apiKey={api_key}"
            
            headers = {'User-Agent': 'Mozilla/5.0'}
            resp = requests.get(url, headers=headers, timeout=6)
            if resp.status_code == 200:
                data = resp.json()
                articles_raw = data.get("articles", [])
                if articles_raw:
                    articles = []
                    for item in articles_raw[:15]:
                        articles.append({
                            "title": item.get("title", ""),
                            "publisher": item.get("source", {}).get("name", "NewsAPI Source"),
                            "link": item.get("url", "#"),
                            "pub_date": item.get("publishedAt", ""),
                            "summary": item.get("description", ""),
                            "sentiment": "Neutral",
                            "image": item.get("urlToImage", ""),
                            "provider": "NewsAPI.org"
                        })
                    return articles
        except Exception:
            pass
        return None

    @staticmethod
    def _fetch_google_financial(symbol):
        try:
            raw_sym = (symbol or "").strip()
            if not raw_sym:
                clean_query = "Indian Stock Market Nifty Sensex"
            else:
                upper_sym = raw_sym.upper()
                clean_query = upper_sym.replace('.NS', '').replace('.BO', '')
                if clean_query == '^NSEI': clean_query = 'Nifty 50'
                elif clean_query == '^NSEBANK': clean_query = 'Nifty Bank'
                elif clean_query == '^BSESN': clean_query = 'Sensex'
                elif clean_query in ['GOLDBEES', 'GC=F']: clean_query = 'Gold price'
                elif clean_query in ['SILVERBEES', 'SI=F']: clean_query = 'Silver price'
                elif clean_query == 'CL=F': clean_query = 'Crude Oil price'
                else:
                    comp = POPULAR_INDIAN_STOCKS.get(clean_query, "")
                    if comp:
                        clean_query = f'"{comp.replace(" Ltd", "").replace(" Limited", "").strip()}" OR "{clean_query}"'
                    else:
                        clean_query = f'"{clean_query}" stock news OR "{clean_query}" share price'

            if not raw_sym:
                query_str = clean_query
            elif 'stock news' in clean_query or 'share price' in clean_query:
                query_str = clean_query
            else:
                query_str = f"{clean_query} stock news"

            encoded_query = urllib.parse.quote(query_str)
            url = f"https://news.google.com/rss/search?q={encoded_query}+when:30d&hl=en-IN&gl=IN&ceid=IN:en"

            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
            resp = requests.get(url, headers=headers, timeout=6)
            
            articles = []
            if resp.status_code == 200:
                root = ET.fromstring(resp.content)
                for item in root.findall('.//item')[:15]:
                    title_elem = item.find('title')
                    link_elem = item.find('link')
                    pub_elem = item.find('pubDate')

                    title = title_elem.text if title_elem is not None else ""
                    link = link_elem.text if link_elem is not None else "#"
                    pub_date = pub_elem.text if pub_elem is not None else ""

                    parts = title.rsplit(' - ', 1)
                    headline = parts[0]
                    publisher = parts[1] if len(parts) > 1 else "Financial News"

                    articles.append({
                        'title': headline,
                        'publisher': publisher,
                        'link': link,
                        'pub_date': pub_date,
                        'provider': 'Google Financial Engine'
                    })
            return articles
        except Exception:
            return []

@news_bp.route("/api/news", methods=["GET"])
@news_bp.route("/api/news/<path:symbol>", methods=["GET"])
@login_required
def get_stock_news_api(symbol=None):
    try:
        raw_sym = (symbol or "").strip()
        articles = FinancialNewsEngine.fetch_news_for_symbol(raw_sym)
        return jsonify({
            'success': True,
            'symbol': raw_sym or "Market Overview",
            'articles': articles
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e), 'articles': []})

@news_bp.route("/api/settings/news_keys", methods=["GET", "POST"])
@login_required
def api_news_keys_settings():
    if request.method == "POST":
        payload = request.get_json() or {}
        settings = load_api_settings()
        settings["active_provider"] = payload.get("active_provider", settings.get("active_provider", "auto"))
        settings["alphavantage_key"] = payload.get("alphavantage_key", "").strip()
        settings["finnhub_key"] = payload.get("finnhub_key", "").strip()
        settings["newsapi_key"] = payload.get("newsapi_key", "").strip()
        
        save_api_settings(settings)
        return jsonify({"success": True, "settings": settings})
    else:
        return jsonify({"success": True, "settings": load_api_settings()})

def get_stock_keywords(symbol):
    clean_sym = symbol.upper().replace(".NS", "").replace(".BO", "").replace("^", "")
    keywords = [clean_sym.lower()]
    
    comp_name = POPULAR_INDIAN_STOCKS.get(clean_sym, "")
    if not comp_name:
        try:
            info = fetcher.fetch_stock(symbol)
            comp_name = info.get("name", "")
        except Exception:
            comp_name = ""
            
    if comp_name:
        clean_name = comp_name.replace(" Ltd", "").replace(" Limited", "").replace(" Inc", "").replace(" India", "").strip().lower()
        if clean_name:
            keywords.append(clean_name)
            keywords.append(clean_name.replace(" ", ""))
            words = [w for w in clean_name.split() if len(w) >= 4 and w not in ("company", "group", "holdings", "industries", "systems", "india")]
            keywords.extend(words)

    custom_map = {
        "ROLEXRINGS": ["rolex rings", "rolex ring", "rolex"],
        "TEXRAIL": ["texmaco", "texrail", "texmaco rail"],
        "POLYMED": ["polymed", "poly medicure"],
        "SBIN": ["sbi", "state bank"],
        "HDFCBANK": ["hdfc bank", "hdfc"],
        "ICICIBANK": ["icici bank", "icici"],
        "TATAMOTORS": ["tata motors", "tata motor"],
        "TCS": ["tata consultancy", "tcs"],
        "INFY": ["infosys"],
        "BHARTIARTL": ["airtel", "bharti airtel"],
        "BAJFINANCE": ["bajaj finance"],
        "ASIANPAINT": ["asian paints", "asian paint"]
    }
    if clean_sym in custom_map:
        keywords.extend(custom_map[clean_sym])
        
    return list(set(keywords))

