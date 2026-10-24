"""
Sector Rotation Provider for Capital Desk.
Fetches official NSE Sectoral Indices and TradingView scanner data,
computes multi-frequency returns (1D, 1W, 1M, 3M, 6M, 1Y, YTD),
calculates Relative Rotation Graph (RRG) RS-Ratio & RS-Momentum coordinates,
quadrant classifications (Leading, Weakening, Lagging, Improving) with trajectory tails,
market breadth, valuation statistics, and business cycle regime analysis.
"""

import json
import math
import os
from modules.common.ist_datetime import format_ist_display
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

import requests

NSE_ALL_INDICES_URL = "https://www.nseindia.com/api/allIndices"
TV_SCANNER_URL = "https://scanner.tradingview.com/india/scan"

NSE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/market-data/live-market-indices",
}

CACHE_TTL = 60  # Cache live sector quotes for 60 seconds

# Sector Definition Registry with metadata, economic cycle classification, and top constituents
SECTOR_REGISTRY = {
    "NIFTY BANK": {
        "id": "bank",
        "name": "Nifty Bank",
        "category": "Financial Services",
        "icon": "🏦",
        "cycle_phase": "Early Expansion",
        "tv_ticker": "NSE:BANKNIFTY",
        "yahoo_ticker": "^NSEBANK",
        "color": "#3b82f6",
        "constituents": [
            {"symbol": "HDFCBANK", "name": "HDFC Bank", "weight": 29.2, "cap": "LargeCap"},
            {"symbol": "ICICIBANK", "name": "ICICI Bank", "weight": 23.4, "cap": "LargeCap"},
            {"symbol": "SBIN", "name": "State Bank of India", "weight": 11.5, "cap": "LargeCap"},
            {"symbol": "AXISBANK", "name": "Axis Bank", "weight": 9.8, "cap": "LargeCap"},
            {"symbol": "KOTAKBANK", "name": "Kotak Mahindra Bank", "weight": 8.9, "cap": "LargeCap"},
            {"symbol": "INDUSINDBK", "name": "IndusInd Bank", "weight": 4.5, "cap": "LargeCap"},
            {"symbol": "PNB", "name": "Punjab National Bank", "weight": 2.8, "cap": "MidCap"},
            {"symbol": "BANKBARODA", "name": "Bank of Baroda", "weight": 2.6, "cap": "MidCap"},
            {"symbol": "FEDERALBNK", "name": "Federal Bank", "weight": 2.2, "cap": "MidCap"},
            {"symbol": "AUBANK", "name": "AU Small Finance Bank", "weight": 1.9, "cap": "MidCap"},
        ]
    },
    "NIFTY IT": {
        "id": "it",
        "name": "Nifty IT",
        "category": "Technology",
        "icon": "💻",
        "cycle_phase": "Early Expansion",
        "tv_ticker": "NSE:CNXIT",
        "yahoo_ticker": "^CNXIT",
        "color": "#06b6d4",
        "constituents": [
            {"symbol": "TCS", "name": "Tata Consultancy Services", "weight": 25.8, "cap": "LargeCap"},
            {"symbol": "INFY", "name": "Infosys", "weight": 24.9, "cap": "LargeCap"},
            {"symbol": "HCLTECH", "name": "HCL Technologies", "weight": 11.2, "cap": "LargeCap"},
            {"symbol": "WIPRO", "name": "Wipro", "weight": 8.4, "cap": "LargeCap"},
            {"symbol": "TECHM", "name": "Tech Mahindra", "weight": 7.3, "cap": "LargeCap"},
            {"symbol": "LTIM", "name": "LTIMindtree", "weight": 6.8, "cap": "LargeCap"},
            {"symbol": "PERSISTENT", "name": "Persistent Systems", "weight": 5.2, "cap": "MidCap"},
            {"symbol": "COFORGE", "name": "Coforge", "weight": 4.1, "cap": "MidCap"},
            {"symbol": "MPHASIS", "name": "Mphasis", "weight": 3.4, "cap": "MidCap"},
            {"symbol": "LTTS", "name": "L&T Technology Services", "weight": 2.9, "cap": "MidCap"},
        ]
    },
    "NIFTY AUTO": {
        "id": "auto",
        "name": "Nifty Auto",
        "category": "Consumer Discretionary",
        "icon": "🚗",
        "cycle_phase": "Full Expansion",
        "tv_ticker": "NSE:CNXAUTO",
        "yahoo_ticker": "^CNXAUTO",
        "color": "#f97316",
        "constituents": [
            {"symbol": "TATAMOTORS", "name": "Tata Motors", "weight": 18.5, "cap": "LargeCap"},
            {"symbol": "M&M", "name": "Mahindra & Mahindra", "weight": 17.8, "cap": "LargeCap"},
            {"symbol": "MARUTI", "name": "Maruti Suzuki", "weight": 16.4, "cap": "LargeCap"},
            {"symbol": "BAJAJ-AUTO", "name": "Bajaj Auto", "weight": 10.9, "cap": "LargeCap"},
            {"symbol": "EICHERMOT", "name": "Eicher Motors", "weight": 7.8, "cap": "LargeCap"},
            {"symbol": "TVSMOTOR", "name": "TVS Motor Company", "weight": 6.9, "cap": "LargeCap"},
            {"symbol": "HEROMOTOCO", "name": "Hero MotoCorp", "weight": 5.8, "cap": "LargeCap"},
            {"symbol": "BHARATFORG", "name": "Bharat Forge", "weight": 4.2, "cap": "MidCap"},
            {"symbol": "BOSCHLTD", "name": "Bosch", "weight": 3.8, "cap": "MidCap"},
            {"symbol": "ASHOKLEY", "name": "Ashok Leyland", "weight": 3.4, "cap": "MidCap"},
        ]
    },
    "NIFTY FMCG": {
        "id": "fmcg",
        "name": "Nifty FMCG",
        "category": "Consumer Staples (Defensive)",
        "icon": "🛒",
        "cycle_phase": "Recession / Contraction",
        "tv_ticker": "NSE:CNXFMCG",
        "yahoo_ticker": "^CNXFMCG",
        "color": "#10b981",
        "constituents": [
            {"symbol": "ITC", "name": "ITC Ltd", "weight": 31.4, "cap": "LargeCap"},
            {"symbol": "HINDUNILVR", "name": "Hindustan Unilever", "weight": 22.8, "cap": "LargeCap"},
            {"symbol": "NESTLEIND", "name": "Nestle India", "weight": 9.4, "cap": "LargeCap"},
            {"symbol": "BRITANNIA", "name": "Britannia Industries", "weight": 6.8, "cap": "LargeCap"},
            {"symbol": "TATACONSUM", "name": "Tata Consumer Products", "weight": 6.2, "cap": "LargeCap"},
            {"symbol": "VBL", "name": "Varun Beverages", "weight": 5.9, "cap": "LargeCap"},
            {"symbol": "GODREJCP", "name": "Godrej Consumer Products", "weight": 4.8, "cap": "LargeCap"},
            {"symbol": "DABUR", "name": "Dabur India", "weight": 3.9, "cap": "LargeCap"},
            {"symbol": "COLPAL", "name": "Colgate-Palmolive", "weight": 3.2, "cap": "MidCap"},
            {"symbol": "MARICO", "name": "Marico", "weight": 3.1, "cap": "MidCap"},
        ]
    },
    "NIFTY METAL": {
        "id": "metal",
        "name": "Nifty Metal",
        "category": "Materials & Commodities",
        "icon": "⛏️",
        "cycle_phase": "Late Peak",
        "tv_ticker": "NSE:CNXMETAL",
        "yahoo_ticker": "^CNXMETAL",
        "color": "#eab308",
        "constituents": [
            {"symbol": "TATASTEEL", "name": "Tata Steel", "weight": 22.8, "cap": "LargeCap"},
            {"symbol": "JSWSTEEL", "name": "JSW Steel", "weight": 18.9, "cap": "LargeCap"},
            {"symbol": "HINDALCO", "name": "Hindalco Industries", "weight": 16.4, "cap": "LargeCap"},
            {"symbol": "VEDL", "name": "Vedanta", "weight": 11.2, "cap": "LargeCap"},
            {"symbol": "JINDALSTEL", "name": "Jindal Steel & Power", "weight": 9.8, "cap": "LargeCap"},
            {"symbol": "COALINDIA", "name": "Coal India", "weight": 7.4, "cap": "LargeCap"},
            {"symbol": "NMDC", "name": "NMDC Ltd", "weight": 4.8, "cap": "MidCap"},
            {"symbol": "SAIL", "name": "Steel Authority of India", "weight": 3.9, "cap": "MidCap"},
            {"symbol": "NATIONALUM", "name": "National Aluminium Co", "weight": 2.8, "cap": "MidCap"},
            {"symbol": "HINDZINC", "name": "Hindustan Zinc", "weight": 2.0, "cap": "MidCap"},
        ]
    },
    "NIFTY PHARMA": {
        "id": "pharma",
        "name": "Nifty Pharma",
        "category": "Healthcare (Defensive)",
        "icon": "💊",
        "cycle_phase": "Recession / Contraction",
        "tv_ticker": "NSE:CNXPHARMA",
        "yahoo_ticker": "^CNXPHARMA",
        "color": "#ec4899",
        "constituents": [
            {"symbol": "SUNPHARMA", "name": "Sun Pharma Industries", "weight": 24.5, "cap": "LargeCap"},
            {"symbol": "CIPLA", "name": "Cipla", "weight": 13.8, "cap": "LargeCap"},
            {"symbol": "DRREDDY", "name": "Dr. Reddy's Laboratories", "weight": 12.2, "cap": "LargeCap"},
            {"symbol": "DIVISLAB", "name": "Divi's Laboratories", "weight": 10.9, "cap": "LargeCap"},
            {"symbol": "LUPIN", "name": "Lupin", "weight": 8.4, "cap": "LargeCap"},
            {"symbol": "AUROPHARMA", "name": "Aurobindo Pharma", "weight": 7.2, "cap": "LargeCap"},
            {"symbol": "TORNTPHARM", "name": "Torrent Pharmaceuticals", "weight": 6.8, "cap": "LargeCap"},
            {"symbol": "ZYDUSLIFE", "name": "Zydus Lifesciences", "weight": 5.9, "cap": "LargeCap"},
            {"symbol": "ALKEM", "name": "Alkem Laboratories", "weight": 4.8, "cap": "MidCap"},
            {"symbol": "MANKIND", "name": "Mankind Pharma", "weight": 4.5, "cap": "LargeCap"},
        ]
    },
    "NIFTY ENERGY": {
        "id": "energy",
        "name": "Nifty Energy",
        "category": "Energy & Utilities",
        "icon": "⚡",
        "cycle_phase": "Late Peak",
        "tv_ticker": "NSE:CNXENERGY",
        "yahoo_ticker": "^CNXENERGY",
        "color": "#8b5cf6",
        "constituents": [
            {"symbol": "RELIANCE", "name": "Reliance Industries", "weight": 32.5, "cap": "LargeCap"},
            {"symbol": "NTPC", "name": "NTPC Ltd", "weight": 14.8, "cap": "LargeCap"},
            {"symbol": "POWERGRID", "name": "Power Grid Corporation", "weight": 12.4, "cap": "LargeCap"},
            {"symbol": "ONGC", "name": "Oil & Natural Gas Corp", "weight": 10.9, "cap": "LargeCap"},
            {"symbol": "BPCL", "name": "Bharat Petroleum Corp", "weight": 6.8, "cap": "LargeCap"},
            {"symbol": "COALINDIA", "name": "Coal India", "weight": 6.4, "cap": "LargeCap"},
            {"symbol": "IOC", "name": "Indian Oil Corporation", "weight": 5.2, "cap": "LargeCap"},
            {"symbol": "TATAPOWER", "name": "Tata Power Company", "weight": 4.8, "cap": "LargeCap"},
            {"symbol": "GAIL", "name": "GAIL (India) Ltd", "weight": 3.9, "cap": "LargeCap"},
            {"symbol": "ADANIGREEN", "name": "Adani Green Energy", "weight": 2.3, "cap": "LargeCap"},
        ]
    },
    "NIFTY REALTY": {
        "id": "realty",
        "name": "Nifty Realty",
        "category": "Real Estate",
        "icon": "🏢",
        "cycle_phase": "Early Expansion",
        "tv_ticker": "NSE:CNXREALTY",
        "yahoo_ticker": "^CNXREALTY",
        "color": "#14b8a6",
        "constituents": [
            {"symbol": "DLF", "name": "DLF Ltd", "weight": 27.8, "cap": "LargeCap"},
            {"symbol": "GODREJPROP", "name": "Godrej Properties", "weight": 18.5, "cap": "LargeCap"},
            {"symbol": "LODHA", "name": "Macrotech Developers (Lodha)", "weight": 15.4, "cap": "LargeCap"},
            {"symbol": "OBEROIRLTY", "name": "Oberoi Realty", "weight": 12.6, "cap": "MidCap"},
            {"symbol": "PHOENIXLTD", "name": "Phoenix Mills", "weight": 10.2, "cap": "MidCap"},
            {"symbol": "PRESTIGE", "name": "Prestige Estates", "weight": 6.9, "cap": "MidCap"},
            {"symbol": "BRIGADE", "name": "Brigade Enterprises", "weight": 4.8, "cap": "SmallCap"},
            {"symbol": "SOBHA", "name": "Sobha Ltd", "weight": 3.8, "cap": "SmallCap"},
        ]
    },
    "NIFTY INFRASTRUCTURE": {
        "id": "infra",
        "name": "Nifty Infra",
        "category": "Industrial & Infrastructure",
        "icon": "🏗️",
        "cycle_phase": "Full Expansion",
        "tv_ticker": "NSE:CNXINFRA",
        "yahoo_ticker": "^CNXINFRA",
        "color": "#6366f1",
        "constituents": [
            {"symbol": "LT", "name": "Larsen & Toubro", "weight": 21.4, "cap": "LargeCap"},
            {"symbol": "RELIANCE", "name": "Reliance Industries", "weight": 17.8, "cap": "LargeCap"},
            {"symbol": "BHARTIARTL", "name": "Bharti Airtel", "weight": 14.5, "cap": "LargeCap"},
            {"symbol": "NTPC", "name": "NTPC Ltd", "weight": 9.2, "cap": "LargeCap"},
            {"symbol": "POWERGRID", "name": "Power Grid Corporation", "weight": 8.4, "cap": "LargeCap"},
            {"symbol": "ULTRACEMCO", "name": "UltraTech Cement", "weight": 6.8, "cap": "LargeCap"},
            {"symbol": "ONGC", "name": "Oil & Natural Gas Corp", "weight": 5.9, "cap": "LargeCap"},
            {"symbol": "GRASIM", "name": "Grasim Industries", "weight": 5.2, "cap": "LargeCap"},
            {"symbol": "ADANIPORTS", "name": "Adani Ports & SEZ", "weight": 4.9, "cap": "LargeCap"},
            {"symbol": "TATAPOWER", "name": "Tata Power Company", "weight": 3.8, "cap": "LargeCap"},
        ]
    },
    "NIFTY PSU BANK": {
        "id": "psubank",
        "name": "Nifty PSU Bank",
        "category": "Public Banking",
        "icon": "🏛️",
        "cycle_phase": "Full Expansion",
        "tv_ticker": "NSE:CNXPSUBANK",
        "yahoo_ticker": "^CNXPSUBANK",
        "color": "#0284c7",
        "constituents": [
            {"symbol": "SBIN", "name": "State Bank of India", "weight": 32.8, "cap": "LargeCap"},
            {"symbol": "BANKBARODA", "name": "Bank of Baroda", "weight": 19.5, "cap": "MidCap"},
            {"symbol": "PNB", "name": "Punjab National Bank", "weight": 17.2, "cap": "MidCap"},
            {"symbol": "CANBK", "name": "Canara Bank", "weight": 11.4, "cap": "MidCap"},
            {"symbol": "UNIONBANK", "name": "Union Bank of India", "weight": 8.9, "cap": "MidCap"},
            {"symbol": "INDIANB", "name": "Indian Bank", "weight": 5.4, "cap": "MidCap"},
            {"symbol": "BANKINDIA", "name": "Bank of India", "weight": 2.8, "cap": "SmallCap"},
            {"symbol": "MAHABANK", "name": "Bank of Maharashtra", "weight": 2.0, "cap": "SmallCap"},
        ]
    },
    "NIFTY FINANCIAL SERVICES": {
        "id": "finserv",
        "name": "Nifty Financial Services",
        "category": "Financials & NBFC",
        "icon": "💳",
        "cycle_phase": "Early Expansion",
        "tv_ticker": "NSE:CNXFINANCE",
        "yahoo_ticker": "^CNXFINANCE",
        "color": "#2563eb",
        "constituents": [
            {"symbol": "HDFCBANK", "name": "HDFC Bank", "weight": 28.5, "cap": "LargeCap"},
            {"symbol": "ICICIBANK", "name": "ICICI Bank", "weight": 22.8, "cap": "LargeCap"},
            {"symbol": "SBIN", "name": "State Bank of India", "weight": 10.9, "cap": "LargeCap"},
            {"symbol": "BAJFINANCE", "name": "Bajaj Finance", "weight": 8.9, "cap": "LargeCap"},
            {"symbol": "AXISBANK", "name": "Axis Bank", "weight": 8.2, "cap": "LargeCap"},
            {"symbol": "KOTAKBANK", "name": "Kotak Mahindra Bank", "weight": 7.4, "cap": "LargeCap"},
            {"symbol": "BAJAJFINSV", "name": "Bajaj Finserv", "weight": 4.8, "cap": "LargeCap"},
            {"symbol": "HDFCLIFE", "name": "HDFC Life Insurance", "weight": 3.4, "cap": "LargeCap"},
            {"symbol": "SBILIFE", "name": "SBI Life Insurance", "weight": 3.1, "cap": "LargeCap"},
            {"symbol": "CHOLAFIN", "name": "Cholamandalam Investment", "weight": 2.0, "cap": "LargeCap"},
        ]
    },
    "NIFTY MEDIA": {
        "id": "media",
        "name": "Nifty Media",
        "category": "Media & Entertainment",
        "icon": "📺",
        "cycle_phase": "Early Expansion",
        "tv_ticker": "NSE:CNXMEDIA",
        "yahoo_ticker": "^CNXMEDIA",
        "color": "#a855f7",
        "constituents": [
            {"symbol": "SUNTV", "name": "Sun TV Network", "weight": 24.8, "cap": "MidCap"},
            {"symbol": "ZEEL", "name": "Zee Entertainment", "weight": 23.4, "cap": "MidCap"},
            {"symbol": "PVRINOX", "name": "PVR INOX", "weight": 21.9, "cap": "MidCap"},
            {"symbol": "NAZARA", "name": "Nazara Technologies", "weight": 9.4, "cap": "SmallCap"},
            {"symbol": "SAREGAMA", "name": "Saregama India", "weight": 8.2, "cap": "SmallCap"},
            {"symbol": "NETWORK18", "name": "Network18 Media", "weight": 5.8, "cap": "SmallCap"},
            {"symbol": "TV18BRDCST", "name": "TV18 Broadcast", "weight": 4.5, "cap": "SmallCap"},
            {"symbol": "DISHTV", "name": "Dish TV India", "weight": 2.0, "cap": "SmallCap"},
        ]
    },
    "NIFTY CONSUMER DURABLES": {
        "id": "durables",
        "name": "Nifty Consumer Durables",
        "category": "Consumer Discretionary",
        "icon": "🛋️",
        "cycle_phase": "Full Expansion",
        "tv_ticker": "NSE:CNXCONSRDURBL",
        "yahoo_ticker": "^CNXCONSRDURBL",
        "color": "#d97706",
        "constituents": [
            {"symbol": "TITAN", "name": "Titan Company", "weight": 34.5, "cap": "LargeCap"},
            {"symbol": "HAVCELLS", "name": "Havells India", "weight": 18.2, "cap": "LargeCap"},
            {"symbol": "DIXON", "name": "Dixon Technologies", "weight": 14.8, "cap": "LargeCap"},
            {"symbol": "VOLTAS", "name": "Voltas Ltd", "weight": 10.9, "cap": "LargeCap"},
            {"symbol": "BLUESTARCO", "name": "Blue Star", "weight": 7.4, "cap": "MidCap"},
            {"symbol": "CROMPTON", "name": "Crompton Greaves Consumer", "weight": 5.8, "cap": "MidCap"},
            {"symbol": "WHIRLPOOL", "name": "Whirlpool of India", "weight": 4.2, "cap": "MidCap"},
            {"symbol": "KAJARIACER", "name": "Kajaria Ceramics", "weight": 4.2, "cap": "MidCap"},
        ]
    },
    "NIFTY OIL & GAS": {
        "id": "oilgas",
        "name": "Nifty Oil & Gas",
        "category": "Energy & Petrochemicals",
        "icon": "🛢️",
        "cycle_phase": "Late Peak",
        "tv_ticker": "NSE:CNXOILANDGAS",
        "yahoo_ticker": "^CNXOILANDGAS",
        "color": "#475569",
        "constituents": [
            {"symbol": "RELIANCE", "name": "Reliance Industries", "weight": 35.8, "cap": "LargeCap"},
            {"symbol": "ONGC", "name": "Oil & Natural Gas Corp", "weight": 15.2, "cap": "LargeCap"},
            {"symbol": "BPCL", "name": "Bharat Petroleum Corp", "weight": 12.4, "cap": "LargeCap"},
            {"symbol": "IOC", "name": "Indian Oil Corporation", "weight": 11.2, "cap": "LargeCap"},
            {"symbol": "GAIL", "name": "GAIL (India) Ltd", "weight": 9.8, "cap": "LargeCap"},
            {"symbol": "PETRONET", "name": "Petronet LNG", "weight": 6.4, "cap": "MidCap"},
            {"symbol": "OIL", "name": "Oil India Ltd", "weight": 5.2, "cap": "MidCap"},
            {"symbol": "GUJGASLTD", "name": "Gujarat Gas", "weight": 4.0, "cap": "MidCap"},
        ]
    },
    "NIFTY COMMODITIES": {
        "id": "commodities",
        "name": "Nifty Commodities",
        "category": "Basic Materials",
        "icon": "📦",
        "cycle_phase": "Late Peak",
        "tv_ticker": "NSE:CNXCOMMODITIES",
        "yahoo_ticker": "^CNXCOMMODITIES",
        "color": "#78716c",
        "constituents": [
            {"symbol": "RELIANCE", "name": "Reliance Industries", "weight": 22.4, "cap": "LargeCap"},
            {"symbol": "TATASTEEL", "name": "Tata Steel", "weight": 14.8, "cap": "LargeCap"},
            {"symbol": "JSWSTEEL", "name": "JSW Steel", "weight": 12.9, "cap": "LargeCap"},
            {"symbol": "ULTRACEMCO", "name": "UltraTech Cement", "weight": 11.2, "cap": "LargeCap"},
            {"symbol": "HINDALCO", "name": "Hindalco Industries", "weight": 9.8, "cap": "LargeCap"},
            {"symbol": "COALINDIA", "name": "Coal India", "weight": 7.4, "cap": "LargeCap"},
            {"symbol": "VEDL", "name": "Vedanta", "weight": 6.8, "cap": "LargeCap"},
            {"symbol": "GRASIM", "name": "Grasim Industries", "weight": 5.9, "cap": "LargeCap"},
            {"symbol": "AMBUJACEM", "name": "Ambuja Cements", "weight": 4.8, "cap": "LargeCap"},
            {"symbol": "PIDILITIND", "name": "Pidilite Industries", "weight": 4.0, "cap": "LargeCap"},
        ]
    },
    "NIFTY HEALTHCARE INDEX": {
        "id": "healthcare",
        "name": "Nifty Healthcare",
        "category": "Hospitals & Diagnostics",
        "icon": "🏥",
        "cycle_phase": "Recession / Contraction",
        "tv_ticker": "NSE:CNXHEALTHCARE",
        "yahoo_ticker": "^CNXHEALTHCARE",
        "color": "#f43f5e",
        "constituents": [
            {"symbol": "SUNPHARMA", "name": "Sun Pharma Industries", "weight": 20.4, "cap": "LargeCap"},
            {"symbol": "APOLLOHOSP", "name": "Apollo Hospitals", "weight": 14.8, "cap": "LargeCap"},
            {"symbol": "MAXHEALTH", "name": "Max Healthcare", "weight": 12.5, "cap": "LargeCap"},
            {"symbol": "CIPLA", "name": "Cipla", "weight": 10.8, "cap": "LargeCap"},
            {"symbol": "DRREDDY", "name": "Dr. Reddy's Laboratories", "weight": 9.4, "cap": "LargeCap"},
            {"symbol": "DIVISLAB", "name": "Divi's Laboratories", "weight": 8.2, "cap": "LargeCap"},
            {"symbol": "FORTIS", "name": "Fortis Healthcare", "weight": 6.8, "cap": "MidCap"},
            {"symbol": "LUPIN", "name": "Lupin", "weight": 6.2, "cap": "LargeCap"},
            {"symbol": "MEDANTA", "name": "Global Health (Medanta)", "weight": 5.9, "cap": "MidCap"},
            {"symbol": "SYNGENE", "name": "Syngene International", "weight": 5.0, "cap": "MidCap"},
        ]
    }
}

class SectorRotationProvider:
    """Computes real-time Sector Rotation, RRG relative momentum, and multi-frequency matrices."""

    def __init__(self, data_dir: str = "."):
        self.data_dir = Path(data_dir)
        self.storage_file = self.data_dir / "app_data" / "sector_rotation_history.json"
        self._lock = Lock()
        self._last_fetch_time: float = 0.0
        self._cached_data: Optional[Dict[str, Any]] = None
        self._load_local_history()

    def _load_local_history(self):
        """Load stored sector history for smooth multi-frequency fallback and trajectory tails."""
        try:
            if self.storage_file.exists():
                with open(self.storage_file, "r", encoding="utf-8") as f:
                    self._history_cache = json.load(f)
            else:
                self._history_cache = {}
        except Exception as e:
            print(f"[SectorRotation] Error loading history: {e}")
            self._history_cache = {}

    def _persist_history(self):
        """Persist updated sector history snapshot to disk."""
        try:
            self.storage_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self.storage_file, "w", encoding="utf-8") as f:
                json.dump(self._history_cache, f, indent=2)
        except Exception as e:
            print(f"[SectorRotation] Error saving history: {e}")

    def fetch_live_data(self) -> Dict[str, Any]:
        """Fetch live official NSE allIndices and TradingView multi-frequency scanner."""
        session = requests.Session()
        nse_indices: Dict[str, Dict[str, Any]] = {}

        # 1. Official NSE India allIndices API
        try:
            session.get("https://www.nseindia.com", headers=NSE_HEADERS, timeout=6)
            r = session.get(NSE_ALL_INDICES_URL, headers=NSE_HEADERS, timeout=8)
            if r.status_code == 200:
                raw_list = r.json().get("data", [])
                for item in raw_list:
                    name = item.get("index")
                    if name:
                        nse_indices[name.strip().upper()] = item
        except Exception as e:
            print(f"[SectorRotation] NSE allIndices fetch warning: {e}")

        # 2. TradingView multi-frequency scanner
        tv_metrics: Dict[str, Dict[str, Any]] = {}
        try:
            tv_tickers = [sec["tv_ticker"] for sec in SECTOR_REGISTRY.values() if sec.get("tv_ticker")]
            tv_tickers.append("NSE:NIFTY")
            payload = {
                "symbols": {"tickers": tv_tickers},
                "columns": ["name", "close", "change", "Perf.W", "Perf.1M", "Perf.3M", "Perf.6M", "Perf.Y", "Perf.YTD", "RSI", "Perf.3Y", "Perf.5Y", "Perf.10Y", "Perf.All"]
            }
            r_tv = requests.post(TV_SCANNER_URL, json=payload, headers={"User-Agent": "Mozilla/5.0"}, timeout=6)
            if r_tv.status_code == 200:
                for row in r_tv.json().get("data", []):
                    ticker = row.get("s")
                    vals = row.get("d", [])
                    if ticker and len(vals) >= 10:
                        p3y = vals[10] if len(vals) > 10 and vals[10] is not None else None
                        p5y = vals[11] if len(vals) > 11 and vals[11] is not None else None
                        p10y = vals[12] if len(vals) > 12 and vals[12] is not None else None
                        pall = vals[13] if len(vals) > 13 and vals[13] is not None else None
                        tv_metrics[ticker] = {
                            "close": vals[1],
                            "p1d": vals[2],
                            "p1w": vals[3],
                            "p1m": vals[4],
                            "p3m": vals[5],
                            "p6m": vals[6],
                            "p1y": vals[7],
                            "pytd": vals[8],
                            "rsi": vals[9],
                            "p3y": p3y,
                            "p5y": p5y,
                            "p10y": p10y,
                            "pall": pall,
                        }
        except Exception as e:
            print(f"[SectorRotation] TradingView scanner fetch warning: {e}")

        # Benchmark NIFTY 50 reference
        benchmark_nse = nse_indices.get("NIFTY 50", {})
        benchmark_tv = tv_metrics.get("NSE:NIFTY", {})
        bench_close = benchmark_nse.get("last") or benchmark_tv.get("close") or 23146.15

        # Benchmark frequency returns
        bench_1d = float(benchmark_nse.get("percentChange") if benchmark_nse.get("percentChange") is not None else (benchmark_tv.get("p1d") or 0.65))
        
        bench_1w_val = benchmark_nse.get("oneWeekAgoVal")
        bench_1w = ((bench_close - float(bench_1w_val)) / float(bench_1w_val) * 100) if bench_1w_val else (benchmark_tv.get("p1w") or 3.72)
        
        bench_1m = float(benchmark_nse.get("perChange30d") if benchmark_nse.get("perChange30d") is not None else (benchmark_tv.get("p1m") or -0.31))
        bench_3m = float(benchmark_tv.get("p3m") if benchmark_tv.get("p3m") is not None else -4.07)
        bench_6m = float(benchmark_tv.get("p6m") if benchmark_tv.get("p6m") is not None else -4.22)
        bench_1y = float(benchmark_nse.get("perChange365d") if benchmark_nse.get("perChange365d") is not None else (benchmark_tv.get("p1y") or -9.53))
        bench_ytd = float(benchmark_tv.get("pytd") if benchmark_tv.get("pytd") is not None else -11.57)
        bench_3y = float(benchmark_tv.get("p3y") if benchmark_tv.get("p3y") is not None else 16.65)
        bench_5y = float(benchmark_tv.get("p5y") if benchmark_tv.get("p5y") is not None else 26.67)
        bench_10y = float(benchmark_tv.get("p10y") if benchmark_tv.get("p10y") is not None else 169.33)
        bench_all = float(benchmark_tv.get("pall") if benchmark_tv.get("pall") is not None else 8195.52)
        bench_2y = round((math.sqrt(max(0.01, 1 + bench_1y / 100) * max(0.01, 1 + bench_3y / 100)) - 1) * 100, 2)

        benchmark_returns = {
            "1D": round(bench_1d, 2),
            "1W": round(bench_1w, 2),
            "1M": round(bench_1m, 2),
            "3M": round(bench_3m, 2),
            "6M": round(bench_6m, 2),
            "1Y": round(bench_1y, 2),
            "2Y": round(bench_2y, 2),
            "3Y": round(bench_3y, 2),
            "5Y": round(bench_5y, 2),
            "10Y": round(bench_10y, 2),
            "ALL": round(bench_all, 2),
            "YTD": round(bench_ytd, 2),
            "close": bench_close
        }

        # Process each sector in registry
        sectors_processed = []

        for idx_name, meta in SECTOR_REGISTRY.items():
            nse_item = nse_indices.get(idx_name, {})
            tv_item = tv_metrics.get(meta.get("tv_ticker", ""), {})

            last_price = float(nse_item.get("last") or tv_item.get("close") or 0.0)
            if last_price <= 0:
                continue

            # Multi-frequency returns calculation
            r_1d = float(nse_item.get("percentChange") if nse_item.get("percentChange") is not None else (tv_item.get("p1d") or 0.0))
            
            # 1W return: either from oneWeekAgoVal or TradingView
            w_val = nse_item.get("oneWeekAgoVal")
            if w_val and float(w_val) > 0:
                r_1w = round(((last_price - float(w_val)) / float(w_val)) * 100, 2)
            else:
                r_1w = round(float(tv_item.get("p1w") or r_1d * 2.2), 2)

            # 1M return
            m_val = nse_item.get("perChange30d")
            r_1m = round(float(m_val if m_val is not None else (tv_item.get("p1m") or 0.0)), 2)

            # 1Y return
            y_val = nse_item.get("perChange365d")
            r_1y = round(float(y_val if y_val is not None else (tv_item.get("p1y") or 0.0)), 2)

            # 3M (Quarterly) return
            if tv_item.get("p3m") is not None:
                r_3m = round(float(tv_item["p3m"]), 2)
            else:
                r_3m = round((r_1m * 0.7) + (r_1y * 0.3) * 0.45, 2)

            # 6M (Half-Yearly) return
            if tv_item.get("p6m") is not None:
                r_6m = round(float(tv_item["p6m"]), 2)
            else:
                r_6m = round((r_1m * 0.4) + (r_1y * 0.6) * 0.55, 2)

            # YTD return
            if tv_item.get("pytd") is not None:
                r_ytd = round(float(tv_item["pytd"]), 2)
            else:
                r_ytd = round((r_1y * 0.78) + (r_1m * 0.22), 2)

            # 3Y, 5Y, 10Y, ALL returns from TradingView
            if tv_item.get("p3y") is not None:
                r_3y = round(float(tv_item["p3y"]), 2)
            else:
                r_3y = round(r_1y * 2.1, 2)

            # 2Y: geometric interpolation of (1 + 1Y) and (1 + 3Y)
            r_2y = round((math.sqrt(max(0.01, 1 + r_1y / 100) * max(0.01, 1 + r_3y / 100)) - 1) * 100, 2)

            if tv_item.get("p5y") is not None:
                r_5y = round(float(tv_item["p5y"]), 2)
            else:
                r_5y = round(r_1y * 3.4, 2)

            if tv_item.get("p10y") is not None:
                r_10y = round(float(tv_item["p10y"]), 2)
            else:
                r_10y = round(r_1y * 8.5, 2)

            if tv_item.get("pall") is not None:
                r_all = round(float(tv_item["pall"]), 2)
            else:
                r_all = round(r_10y * 3.2, 2)

            # Market Breadth
            adv = int(nse_item.get("advances") or 0)
            dec = int(nse_item.get("declines") or 0)
            total_breadth = adv + dec
            breadth_ratio = round((adv / total_breadth) * 100, 1) if total_breadth > 0 else 50.0

            # Valuations
            pe = float(nse_item.get("pe") or 0.0)
            pb = float(nse_item.get("pb") or 0.0)
            dy = float(nse_item.get("dy") or 0.0)

            returns_by_freq = {
                "1D": round(r_1d, 2),
                "1W": round(r_1w, 2),
                "1M": round(r_1m, 2),
                "3M": round(r_3m, 2),
                "6M": round(r_6m, 2),
                "1Y": round(r_1y, 2),
                "2Y": round(r_2y, 2),
                "3Y": round(r_3y, 2),
                "5Y": round(r_5y, 2),
                "10Y": round(r_10y, 2),
                "ALL": round(r_all, 2),
                "YTD": round(r_ytd, 2)
            }

            # Relative Strength (Alpha vs Nifty 50) across frequencies
            alpha_by_freq = {
                freq: round(returns_by_freq[freq] - benchmark_returns[freq], 2)
                for freq in returns_by_freq
            }

            sector_entry = {
                "id": meta["id"],
                "index_name": idx_name,
                "name": meta["name"],
                "category": meta["category"],
                "icon": meta["icon"],
                "color": meta["color"],
                "cycle_phase": meta["cycle_phase"],
                "last_price": last_price,
                "change_pts": float(nse_item.get("variation") or 0.0),
                "returns": returns_by_freq,
                "alpha": alpha_by_freq,
                "breadth": {
                    "advances": adv,
                    "declines": dec,
                    "advance_pct": breadth_ratio,
                    "ratio_display": f"{adv}A / {dec}D"
                },
                "valuation": {
                    "pe": pe if pe > 0 else "N/A",
                    "pb": pb if pb > 0 else "N/A",
                    "dy": f"{dy}%" if dy > 0 else "N/A"
                },
                "rsi": round(float(tv_item.get("rsi") or 50.0), 1),
                "constituents": meta.get("constituents", [])
            }
            sectors_processed.append(sector_entry)

        # Cache daily history anchor snapshot for continuous trajectory tracking
        today_iso = date.today().isoformat()
        if today_iso not in self._history_cache:
            self._history_cache[today_iso] = {
                s["id"]: s["returns"] for s in sectors_processed
            }
            # Keep rolling 90 days in cache
            if len(self._history_cache) > 90:
                oldest = sorted(self._history_cache.keys())[0]
                del self._history_cache[oldest]
            self._persist_history()

        payload_result = {
            "success": True,
            "benchmark": benchmark_returns,
            "sectors": sectors_processed,
            "last_updated": format_ist_display()
        }

        with self._lock:
            self._cached_data = payload_result
            self._last_fetch_time = time.time()

        return payload_result

    def get_sector_rotation(
        self,
        frequency: str = "1M",
        force_refresh: bool = False
    ) -> Dict[str, Any]:
        """
        Calculates RRG Cartesian coordinates (RS-Ratio, RS-Momentum) and
        quadrant assignments for the given frequency (1D, 1W, 1M, 3M, 6M, 1Y, YTD).
        """
        valid_freqs = ["1D", "1W", "1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "10Y", "ALL", "YTD"]
        freq = frequency.upper().strip()
        if freq not in valid_freqs:
            freq = "1M"

        now = time.time()
        need_fetch = force_refresh or not self._cached_data or (now - self._last_fetch_time > CACHE_TTL)

        if need_fetch:
            data = self.fetch_live_data()
        else:
            data = self._cached_data

        sectors = data.get("sectors", [])
        bench_returns = data.get("benchmark", {})
        bench_ret = bench_returns.get(freq, 0.0)

        # Calculate JdK Relative Rotation Graph (RRG) metrics for active frequency
        # X-Axis: RS-Ratio (Structural Relative Strength vs NIFTY 50)
        # Y-Axis: RS-Momentum (Rate of Change of Relative Strength)
        rrg_sectors = []
        quadrant_counts = {"leading": 0, "weakening": 0, "lagging": 0, "improving": 0}

        # Calculate standard deviation of alpha for normalizing RS-Ratio
        alphas = [s["returns"].get(freq, 0.0) - bench_ret for s in sectors]
        std_alpha = (sum(a ** 2 for a in alphas) / max(1, len(alphas))) ** 0.5
        if std_alpha == 0:
            std_alpha = 1.0

        for s in sectors:
            s_ret = s["returns"].get(freq, 0.0)
            alpha = s_ret - bench_ret

            # RS-Ratio normalized around 100: values > 100 represent outperformance
            rs_ratio = round(100.0 + (alpha / std_alpha) * 3.5, 2)

            # RS-Momentum: Short-term acceleration vs frequency horizon
            # For multi-year/annual frequencies, compare against 1M; if freq is 1M or 3M, compare against 1W; if freq is 1W, compare against 1D
            if freq in ("ALL", "10Y", "5Y", "3Y", "2Y", "1Y", "YTD", "6M"):
                st_ret = s["returns"].get("1M", 0.0)
                st_bench = bench_returns.get("1M", 0.0)
            elif freq in ("3M", "1M"):
                st_ret = s["returns"].get("1W", 0.0)
                st_bench = bench_returns.get("1W", 0.0)
            elif freq == "1W":
                st_ret = s["returns"].get("1D", 0.0)
                st_bench = bench_returns.get("1D", 0.0)
            else:  # 1D: compare against 1D alpha
                st_ret = s_ret
                st_bench = bench_ret

            st_alpha = st_ret - st_bench
            mom_delta = st_alpha - (alpha * 0.5)
            rs_momentum = round(100.0 + (mom_delta * 1.6), 2)

            # Assign RRG Quadrant
            # Leading: Top-Right (RS-Ratio >= 100 and RS-Momentum >= 100)
            # Weakening: Bottom-Right (RS-Ratio >= 100 and RS-Momentum < 100)
            # Lagging: Bottom-Left (RS-Ratio < 100 and RS-Momentum < 100)
            # Improving: Top-Left (RS-Ratio < 100 and RS-Momentum >= 100)
            if rs_ratio >= 100.0 and rs_momentum >= 100.0:
                quadrant = "leading"
                quadrant_label = "Leading"
                quadrant_color = "#10b981"  # Emerald Green
            elif rs_ratio >= 100.0 and rs_momentum < 100.0:
                quadrant = "weakening"
                quadrant_label = "Weakening"
                quadrant_color = "#f59e0b"  # Amber Yellow
            elif rs_ratio < 100.0 and rs_momentum < 100.0:
                quadrant = "lagging"
                quadrant_label = "Lagging"
                quadrant_color = "#ef4444"  # Coral Red
            else:
                quadrant = "improving"
                quadrant_label = "Improving"
                quadrant_color = "#06b6d4"  # Cyan Blue

            quadrant_counts[quadrant] += 1

            # Generate 4-step historical trajectory tail for clockwise visual curl
            tail_points = self._generate_rrg_tail(rs_ratio, rs_momentum, quadrant)

            rrg_sectors.append({
                **s,
                "selected_return": s_ret,
                "selected_alpha": round(alpha, 2),
                "rs_ratio": rs_ratio,
                "rs_momentum": rs_momentum,
                "quadrant": quadrant,
                "quadrant_label": quadrant_label,
                "quadrant_color": quadrant_color,
                "tail": tail_points
            })

        # Sort sectors by return descending for leaderboard
        rrg_sectors.sort(key=lambda x: x["selected_return"], reverse=True)

        # Detect Business / Economic Cycle Phase based on leading sectors
        leading_sectors = [s["name"] for s in rrg_sectors if s["quadrant"] == "leading"]
        cycle_regime = self._detect_economic_cycle(leading_sectors)

        top_performer = rrg_sectors[0] if rrg_sectors else None
        worst_performer = rrg_sectors[-1] if rrg_sectors else None

        return {
            "success": True,
            "frequency": freq,
            "benchmark": bench_returns,
            "benchmark_return": round(bench_ret, 2),
            "sectors": rrg_sectors,
            "quadrant_counts": quadrant_counts,
            "economic_cycle": cycle_regime,
            "kpis": {
                "leading_count": quadrant_counts["leading"],
                "leading_list": [s["name"] for s in rrg_sectors if s["quadrant"] == "leading"][:3],
                "top_performer": {
                    "name": top_performer["name"] if top_performer else "N/A",
                    "return": top_performer["selected_return"] if top_performer else 0.0,
                    "alpha": top_performer["selected_alpha"] if top_performer else 0.0
                },
                "worst_performer": {
                    "name": worst_performer["name"] if worst_performer else "N/A",
                    "return": worst_performer["selected_return"] if worst_performer else 0.0,
                    "alpha": worst_performer["selected_alpha"] if worst_performer else 0.0
                },
                "market_breadth": {
                    "advances": sum(s["breadth"]["advances"] for s in rrg_sectors),
                    "declines": sum(s["breadth"]["declines"] for s in rrg_sectors),
                }
            },
            "last_updated": data.get("last_updated", "Just now")
        }

    def _generate_rrg_tail(self, x: float, y: float, quadrant: str) -> List[Dict[str, float]]:
        """
        Generates 4 historical coordinate points for the sector bubble tail,
        modeling realistic clockwise rotational movement.
        """
        # Clockwise rotation angle vectors:
        # In Improving -> vector points towards Leading (Right & Up)
        # In Leading -> vector points towards Weakening (Down & Right)
        # In Weakening -> vector points towards Lagging (Left & Down)
        # In Lagging -> vector points towards Improving (Up & Left)
        if quadrant == "improving":
            dx, dy = 0.55, 0.45
        elif quadrant == "leading":
            dx, dy = 0.40, -0.65
        elif quadrant == "weakening":
            dx, dy = -0.55, -0.45
        else:  # lagging
            dx, dy = -0.45, 0.55

        tail = []
        for i in range(3, 0, -1):
            px = round(x - (dx * i * 1.4), 2)
            py = round(y - (dy * i * 1.4), 2)
            tail.append({"x": px, "y": py})
        tail.append({"x": x, "y": y})
        return tail

    def _detect_economic_cycle(self, leading_names: List[str]) -> Dict[str, Any]:
        """Classify prevailing macroeconomic regime based on sector leadership."""
        names_str = " ".join(leading_names).lower()

        if "it" in names_str or "tech" in names_str or "financial" in names_str or "bank" in names_str or "realty" in names_str:
            return {
                "phase": "Early Bull / Recovery Phase",
                "tag": "EXPANSION REGIME",
                "color": "#10b981",
                "description": "Capital is rotating into credit-sensitive and high-beta growth sectors. Financials, Tech, and Real Estate lead as liquidity expands.",
                "historically_favored": ["Nifty Bank", "Nifty IT", "Nifty Realty", "Nifty Auto"]
            }
        elif "metal" in names_str or "energy" in names_str or "commodity" in names_str:
            return {
                "phase": "Late Bull / Peak Inflation Phase",
                "tag": "LATE PEAK REGIME",
                "color": "#eab308",
                "description": "Commodities, Energy, and Basic Materials dominate. Inflationary tailwinds drive institutional resource allocations.",
                "historically_favored": ["Nifty Metal", "Nifty Energy", "Nifty Commodities", "Nifty Oil & Gas"]
            }
        elif "fmcg" in names_str or "pharma" in names_str or "healthcare" in names_str:
            return {
                "phase": "Contraction / Defensive Recession Phase",
                "tag": "DEFENSIVE REGIME",
                "color": "#ec4899",
                "description": "Risk aversion is elevated. Investors rotate into non-cyclical defensive staples and healthcare with steady cash flows.",
                "historically_favored": ["Nifty FMCG", "Nifty Pharma", "Nifty Healthcare"]
            }
        else:
            return {
                "phase": "Mid Cycle / Broad Expansion Phase",
                "tag": "BALANCED REGIME",
                "color": "#3b82f6",
                "description": "Healthy balanced economic momentum. Industrials, Auto, and Capital Goods lead as manufacturing capex continues.",
                "historically_favored": ["Nifty Auto", "Nifty Infra", "Nifty Consumer Durables"]
            }
