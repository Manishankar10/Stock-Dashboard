import os
import json
import time
import datetime
import threading
from concurrent.futures import ThreadPoolExecutor
from flask import Blueprint, jsonify, request, session, render_template

import requests
from modules.common.auth_utils import login_required
from db_store import (
    load_technical_screener_hierarchy_db,
    save_technical_screener_hierarchy_db,
    load_technical_screener_info_db,
    batch_append_technical_screener_info_db
)

technical_screener_bp = Blueprint("technical_screener", __name__)

_SCREENER_CACHE = {}
_SCREENER_LOCK = threading.Lock()

# Standard Liquid Universe for "All Market" scope
POPULAR_INDIAN_STOCKS = {
    'RELIANCE': 'Reliance Industries Ltd.',
    'TCS': 'Tata Consultancy Services Ltd.',
    'HDFCBANK': 'HDFC Bank Ltd.',
    'INFY': 'Infosys Ltd.',
    'ICICIBANK': 'ICICI Bank Ltd.',
    'HINDUNILVR': 'Hindustan Unilever Ltd.',
    'ITC': 'ITC Ltd.',
    'SBIN': 'State Bank of India',
    'BHARTIARTL': 'Bharti Airtel Ltd.',
    'KOTAKBANK': 'Kotak Mahindra Bank Ltd.',
    'LT': 'Larsen & Toubro Ltd.',
    'AXISBANK': 'Axis Bank Ltd.',
    'ASIANPAINT': 'Asian Paints Ltd.',
    'HCLTECH': 'HCL Technologies Ltd.',
    'BAJFINANCE': 'Bajaj Finance Ltd.',
    'MARUTI': 'Maruti Suzuki India Ltd.',
    'SUNPHARMA': 'Sun Pharmaceutical Industries Ltd.',
    'TITAN': 'Titan Company Ltd.',
    'ULTRACEMCO': 'UltraTech Cement Ltd.',
    'TATASTEEL': 'Tata Steel Ltd.',
    'NTPC': 'NTPC Ltd.',
    'POWERGRID': 'Power Grid Corporation of India Ltd.',
    'M&M': 'Mahindra & Mahindra Ltd.',
    'TATAMOTORS': 'Tata Motors Ltd.',
    'ADANIENT': 'Adani Enterprises Ltd.',
    'ADANIPORTS': 'Adani Ports and Special Economic Zone Ltd.',
    'COALINDIA': 'Coal India Ltd.',
    'BAJAJFINSV': 'Bajaj Finserv Ltd.',
    'ONGC': 'Oil and Natural Gas Corporation Ltd.',
    'JSWSTEEL': 'JSW Steel Ltd.',
    'GRASIM': 'Grasim Industries Ltd.',
    'HINDALCO': 'Hindalco Industries Ltd.',
    'TECHM': 'Tech Mahindra Ltd.',
    'INDUSINDBK': 'IndusInd Bank Ltd.',
    'WIPRO': 'Wipro Ltd.',
    'NESTLEIND': 'Nestle India Ltd.',
    'DRREDDY': 'Dr. Reddy\'s Laboratories Ltd.',
    'CIPLA': 'Cipla Ltd.',
    'BPCL': 'Bharat Petroleum Corporation Ltd.',
    'EICHERMOT': 'Eicher Motors Ltd.',
    'HEROMOTOCO': 'Hero MotoCorp Ltd.',
    'BRITANNIA': 'Britannia Industries Ltd.',
    'APOLLOHOSP': 'Apollo Hospitals Enterprise Ltd.',
    'DIVISLAB': 'Divi\'s Laboratories Ltd.',
    'TATACONSUM': 'Tata Consumer Products Ltd.',
    'BAJAJ-AUTO': 'Bajaj Auto Ltd.',
    'SBILIFE': 'SBI Life Insurance Company Ltd.',
    'HDFCLIFE': 'HDFC Life Insurance Company Ltd.',
    'SHRIRAMFIN': 'Shriram Finance Ltd.',
    'LTIM': 'LTIMindtree Ltd.',
    'BEL': 'Bharat Electronics Ltd.',
    'HAL': 'Hindustan Aeronautics Ltd.',
    'ZOMATO': 'Zomato Ltd.',
    'JIOFIN': 'Jio Financial Services Ltd.',
    'VEDL': 'Vedanta Ltd.',
    'TRENT': 'Trent Ltd.',
    'VBL': 'Varun Beverages Ltd.',
    'POLYCAB': 'Polycab India Ltd.',
    'CHOLAFIN': 'Cholamandalam Investment and Finance',
    'PIDILITIND': 'Pidilite Industries Ltd.',
    'SIEMENS': 'Siemens Ltd.',
    'ABB': 'ABB India Ltd.',
    'DLF': 'DLF Ltd.',
    'BSE': 'BSE Ltd.',
    'CDSL': 'Central Depository Services Ltd.',
    'MCX': 'Multi Commodity Exchange of India',
    'DIXON': 'Dixon Technologies (India) Ltd.',
    'KALYANKJIL': 'Kalyan Jewellers India Ltd.',
    'SUZLON': 'Suzlon Energy Ltd.',
    'IREDA': 'Indian Renewable Energy Dev Agency',
    'IRFC': 'Indian Railway Finance Corp'
}

def _get_master_screener_hierarchy():
    """
    Returns the complete hierarchy of the 6 parent categories and all screener definitions.
    Collection 1: technical_screener_hierarchy
    """
    return {
        "categories": [
            {
                "id": "smart_scanners",
                "name": "Smart Scanners",
                "icon": "⚡",
                "badge": "16 Scanners",
                "description": "Institutional Moving Averages, Momentum, Trend & Volatility Indicators",
                "status": "ready",
                "phase": 1,
                "subgroups": [
                    {
                        "id": "trend_momentum",
                        "name": "Trend & Momentum",
                        "screeners": [
                            "golden_cross",
                            "supertrend_buy",
                            "rsi_momentum",
                            "ema_bull_cross",
                            "macd_bullish",
                            "bollinger_breakout",
                            "donchian_breakout",
                            "st_trigger_bull"
                        ]
                    },
                    {
                        "id": "reversals_extremes",
                        "name": "Reversals & Extremes",
                        "screeners": [
                            "bullish_engulfing",
                            "high_52w",
                            "volume_surge",
                            "triple_confluence",
                            "rsi_oversold",
                            "oversold_extreme",
                            "death_cross",
                            "low_52w"
                        ]
                    }
                ]
            },
            {
                "id": "trendlines",
                "name": "Trendlines",
                "icon": "📈",
                "badge": "Phase 2",
                "description": "Rising, Falling & Horizontal Trendline S/R, Breakouts & Breakdowns",
                "status": "planned",
                "phase": 2,
                "subgroups": [
                    {
                        "id": "rising_trendlines",
                        "name": "Rising Trendlines",
                        "screeners": [
                            "rising_support",
                            "resistance_rising",
                            "support_rising_breakdown",
                            "resistance_rising_breakout"
                        ]
                    },
                    {
                        "id": "falling_trendlines",
                        "name": "Falling Trendlines",
                        "screeners": [
                            "falling_support",
                            "resistance_falling",
                            "resistance_falling_breakout",
                            "support_falling_breakdown"
                        ]
                    },
                    {
                        "id": "horizontal_trendlines",
                        "name": "Horizontal Trendlines",
                        "screeners": [
                            "horizontal_support",
                            "support_trendline_breakdown",
                            "horizontal_resistance",
                            "resistance_trendline_breakout"
                        ]
                    }
                ]
            },
            {
                "id": "triangles",
                "name": "Triangles",
                "icon": "📐",
                "badge": "Phase 3",
                "description": "Ascending, Descending & Symmetrical Geometric Triangle Breakouts",
                "status": "planned",
                "phase": 3,
                "subgroups": [
                    {
                        "id": "ascending_triangle",
                        "name": "Ascending Triangle",
                        "screeners": [
                            "ascending_triangle",
                            "ascending_triangle_breakout",
                            "ascending_triangle_breakdown"
                        ]
                    },
                    {
                        "id": "descending_triangle",
                        "name": "Descending Triangle",
                        "screeners": [
                            "descending_triangle",
                            "descending_triangle_breakdown"
                        ]
                    },
                    {
                        "id": "symmetrical_triangle",
                        "name": "Symmetrical Triangle",
                        "screeners": [
                            "symmetrical_triangle",
                            "symmetrical_triangle_breakout",
                            "symmetrical_triangle_breakdown"
                        ]
                    }
                ]
            },
            {
                "id": "channels",
                "name": "Channels",
                "icon": "⏸️",
                "badge": "Phase 4",
                "description": "Ascending, Descending & Rectangle Dynamic Price Channels",
                "status": "planned",
                "phase": 4,
                "subgroups": [
                    {
                        "id": "ascending_channel",
                        "name": "Ascending Channel",
                        "screeners": [
                            "ascending_channel",
                            "ascending_channel_breakout",
                            "ascending_channel_breakdown"
                        ]
                    },
                    {
                        "id": "descending_channel",
                        "name": "Descending Channel",
                        "screeners": [
                            "descending_channel",
                            "descending_channel_breakout",
                            "descending_channel_breakdown"
                        ]
                    },
                    {
                        "id": "rectangle_channel",
                        "name": "Rectangle Channel",
                        "screeners": [
                            "rectangle_channel",
                            "rectangle_channel_breakout",
                            "rectangle_channel_breakdown",
                            "rectangle_channel_potential"
                        ]
                    }
                ]
            },
            {
                "id": "nr_wr",
                "name": "NR / WR",
                "icon": "📏",
                "badge": "Phase 5",
                "description": "Narrow Range (NR) Volatility Contraction & Wide Range (WR) Expansion",
                "status": "planned",
                "phase": 5,
                "subgroups": [
                    {
                        "id": "narrow_range",
                        "name": "Narrow Range",
                        "screeners": [
                            "nr4",
                            "nr4_breakout",
                            "nr4_breakdown",
                            "nr7",
                            "nr7_breakout",
                            "nr7_breakdown",
                            "nr11",
                            "nr11_breakout",
                            "nr11_breakdown",
                            "nr15",
                            "nr15_breakout",
                            "nr15_breakdown"
                        ]
                    },
                    {
                        "id": "wide_range",
                        "name": "Wide Range",
                        "screeners": [
                            "wr7",
                            "wr7_bull_cont",
                            "wr7_bear_cont",
                            "wr14",
                            "wr14_bull_cont",
                            "wr14_bear_cont",
                            "wr20",
                            "wr20_bull_cont",
                            "wr20_bear_cont"
                        ]
                    }
                ]
            },
            {
                "id": "chart_patterns",
                "name": "Popular Chart Patterns",
                "icon": "📊",
                "badge": "Phase 6",
                "description": "Classic Reversal & Continuation Patterns (Double/Triple, H&S, Flags, Cups)",
                "status": "planned",
                "phase": 6,
                "subgroups": [
                    {
                        "id": "bullish_patterns",
                        "name": "Bullish Patterns",
                        "screeners": [
                            "double_bottom",
                            "double_bottom_potential",
                            "double_bottom_init",
                            "triple_bottom",
                            "triple_bottom_potential",
                            "reverse_head_shoulder",
                            "reverse_head_shoulder_potential",
                            "higher_highs_lows",
                            "rounding_bottom",
                            "bullish_flag",
                            "cup_and_handle",
                            "bullish_pennant",
                            "v_pattern"
                        ]
                    },
                    {
                        "id": "bearish_patterns",
                        "name": "Bearish Patterns",
                        "screeners": [
                            "double_top",
                            "double_top_potential",
                            "double_top_init",
                            "triple_top",
                            "triple_top_potential",
                            "head_shoulder",
                            "head_shoulder_potential",
                            "lower_highs_lows",
                            "rounding_top",
                            "bearish_flag",
                            "cup_and_handle_inverse",
                            "bearish_pennant",
                            "inverse_v_pattern"
                        ]
                    }
                ]
            }
        ],
        "definitions": {
            # --- SMART SCANNERS (16 Core Institutional Signals) ---
            "golden_cross": {
                "id": "golden_cross",
                "title": "Golden Crossover",
                "icon": "🌟",
                "badge": "Bullish Trend",
                "badge_type": "bullish",
                "color": "#10b981",
                "category_id": "smart_scanners",
                "subgroup_id": "trend_momentum",
                "description": "50-Day Moving Average crossed or trading above 200-Day Moving Average (Macro Uptrend)"
            },
            "supertrend_buy": {
                "id": "supertrend_buy",
                "title": "Supertrend BUY",
                "icon": "🟢",
                "badge": "Trend Buy",
                "badge_type": "bullish",
                "color": "#10b981",
                "category_id": "smart_scanners",
                "subgroup_id": "trend_momentum",
                "description": "Price trading above trailing Supertrend support line with active Buy signal"
            },
            "rsi_momentum": {
                "id": "rsi_momentum",
                "title": "RSI Momentum",
                "icon": "🚀",
                "badge": "Momentum",
                "badge_type": "momentum",
                "color": "#6366f1",
                "category_id": "smart_scanners",
                "subgroup_id": "trend_momentum",
                "description": "RSI(14) between 55 and 72, confirming strong bullish momentum"
            },
            "ema_bull_cross": {
                "id": "ema_bull_cross",
                "title": "EMA Bullish Cross",
                "icon": "⚡",
                "badge": "Short Bull",
                "badge_type": "bullish",
                "color": "#06b6d4",
                "category_id": "smart_scanners",
                "subgroup_id": "trend_momentum",
                "description": "Short-term 9 EMA trading above 21 EMA (Short-term trend trigger)"
            },
            "macd_bullish": {
                "id": "macd_bullish",
                "title": "MACD Bullish Cross",
                "icon": "🎯",
                "badge": "MACD Bull",
                "badge_type": "bullish",
                "color": "#3b82f6",
                "category_id": "smart_scanners",
                "subgroup_id": "trend_momentum",
                "description": "MACD Line (12, 26) trading above 9-day Signal line with positive histogram"
            },
            "bollinger_breakout": {
                "id": "bollinger_breakout",
                "title": "Bollinger Breakout",
                "icon": "🔥",
                "badge": "Breakout",
                "badge_type": "breakout",
                "color": "#f59e0b",
                "category_id": "smart_scanners",
                "subgroup_id": "trend_momentum",
                "description": "Price testing or breaking above Upper 20-day Bollinger Band (Volatility expansion)"
            },
            "donchian_breakout": {
                "id": "donchian_breakout",
                "title": "20D Donchian High",
                "icon": "📈",
                "badge": "Channel High",
                "badge_type": "breakout",
                "color": "#10b981",
                "category_id": "smart_scanners",
                "subgroup_id": "trend_momentum",
                "description": "Price at or breaking above 20-Day Donchian Channel High (New 20-day high)"
            },
            "st_trigger_bull": {
                "id": "st_trigger_bull",
                "title": "ST Trigger Bullish",
                "icon": "⚡",
                "badge": "Intraday Bull",
                "badge_type": "bullish",
                "color": "#22c55e",
                "category_id": "smart_scanners",
                "subgroup_id": "trend_momentum",
                "description": "Short-term momentum trigger actively bullish with higher highs"
            },
            "bullish_engulfing": {
                "id": "bullish_engulfing",
                "title": "Bullish Engulfing",
                "icon": "🕯️",
                "badge": "Reversal",
                "badge_type": "bullish",
                "color": "#10b981",
                "category_id": "smart_scanners",
                "subgroup_id": "reversals_extremes",
                "description": "Strong bullish candle completely engulfs prior session downward body"
            },
            "high_52w": {
                "id": "high_52w",
                "title": "Near 52W High",
                "icon": "💥",
                "badge": "52W High",
                "badge_type": "breakout",
                "color": "#8b5cf6",
                "category_id": "smart_scanners",
                "subgroup_id": "reversals_extremes",
                "description": "Trading within 3% of its 52-week high breakout zone"
            },
            "volume_surge": {
                "id": "volume_surge",
                "title": "Volume Surge",
                "icon": "📊",
                "badge": "High Vol",
                "badge_type": "volume",
                "color": "#f59e0b",
                "category_id": "smart_scanners",
                "subgroup_id": "reversals_extremes",
                "description": "Today's volume is >1.8x the 20-day average volume (Institutional Buying)"
            },
            "triple_confluence": {
                "id": "triple_confluence",
                "title": "Triple Confluence",
                "icon": "🏆",
                "badge": "Conviction",
                "badge_type": "bullish",
                "color": "#10b981",
                "category_id": "smart_scanners",
                "subgroup_id": "reversals_extremes",
                "description": "EMA 9 > 21 + RSI > 50 + Price > SMA 50 (Multi-indicator confirmation)"
            },
            "rsi_oversold": {
                "id": "rsi_oversold",
                "title": "RSI Oversold Rebound",
                "icon": "🧊",
                "badge": "Rebound",
                "badge_type": "reversal",
                "color": "#ec4899",
                "category_id": "smart_scanners",
                "subgroup_id": "reversals_extremes",
                "description": "RSI(14) under 38 (Oversold swing reversal candidate)"
            },
            "oversold_extreme": {
                "id": "oversold_extreme",
                "title": "Extreme Oversold (<30)",
                "icon": "💎",
                "badge": "Deep Value",
                "badge_type": "reversal",
                "color": "#e11d48",
                "category_id": "smart_scanners",
                "subgroup_id": "reversals_extremes",
                "description": "Deeply oversold with RSI(14) < 30 (High probability mean-reversion setup)"
            },
            "death_cross": {
                "id": "death_cross",
                "title": "Death Crossover",
                "icon": "💀",
                "badge": "Bearish",
                "badge_type": "bearish",
                "color": "#ef4444",
                "category_id": "smart_scanners",
                "subgroup_id": "reversals_extremes",
                "description": "50-Day Moving Average below 200-Day Moving Average (Macro Warning)"
            },
            "low_52w": {
                "id": "low_52w",
                "title": "Near 52W Low",
                "icon": "🔻",
                "badge": "52W Low",
                "badge_type": "bearish",
                "color": "#dc2626",
                "category_id": "smart_scanners",
                "subgroup_id": "reversals_extremes",
                "description": "Trading within 3% of 52-week low price (Deep value or breakdown risk)"
            },

            # --- TRENDLINES ---
            "rising_support": { "id": "rising_support", "title": "Rising Support Trendline", "icon": "📈", "badge": "Support", "badge_type": "bullish", "color": "#10b981", "category_id": "trendlines", "subgroup_id": "rising_trendlines", "description": "Stock testing upward rising support trendline with bullish bounce setup" },
            "resistance_rising": { "id": "resistance_rising", "title": "Resistance Rising Trendline", "icon": "📈", "badge": "Resistance", "badge_type": "neutral", "color": "#f59e0b", "category_id": "trendlines", "subgroup_id": "rising_trendlines", "description": "Price approaching ascending upper resistance boundary" },
            "support_rising_breakdown": { "id": "support_rising_breakdown", "title": "Support Rising Breakdown", "icon": "📉", "badge": "Breakdown", "badge_type": "bearish", "color": "#ef4444", "category_id": "trendlines", "subgroup_id": "rising_trendlines", "description": "Price broken below upward rising support line" },
            "resistance_rising_breakout": { "id": "resistance_rising_breakout", "title": "Resistance Rising Breakout", "icon": "🚀", "badge": "Breakout", "badge_type": "bullish", "color": "#10b981", "category_id": "trendlines", "subgroup_id": "rising_trendlines", "description": "Bullish breakout above ascending resistance line with volume" },
            "falling_support": { "id": "falling_support", "title": "Falling Support Trendline", "icon": "📉", "badge": "Support", "badge_type": "neutral", "color": "#64748b", "category_id": "trendlines", "subgroup_id": "falling_trendlines", "description": "Price testing downward falling lower support channel boundary" },
            "resistance_falling": { "id": "resistance_falling", "title": "Resistance Falling Trendline", "icon": "📉", "badge": "Resistance", "badge_type": "neutral", "color": "#f59e0b", "category_id": "trendlines", "subgroup_id": "falling_trendlines", "description": "Price testing descending resistance trendline" },
            "resistance_falling_breakout": { "id": "resistance_falling_breakout", "title": "Falling Resistance Breakout", "icon": "⚡", "badge": "Breakout", "badge_type": "bullish", "color": "#10b981", "category_id": "trendlines", "subgroup_id": "falling_trendlines", "description": "Crucial trend reversal breakout above downward falling resistance line" },
            "support_falling_breakdown": { "id": "support_falling_breakdown", "title": "Falling Support Breakdown", "icon": "🔻", "badge": "Breakdown", "badge_type": "bearish", "color": "#dc2626", "category_id": "trendlines", "subgroup_id": "falling_trendlines", "description": "Accelerating breakdown below falling support trendline" },
            "horizontal_support": { "id": "horizontal_support", "title": "Horizontal Support Line", "icon": "⏸️", "badge": "Floor Support", "badge_type": "bullish", "color": "#10b981", "category_id": "trendlines", "subgroup_id": "horizontal_trendlines", "description": "Price testing validated horizontal floor support zone" },
            "support_trendline_breakdown": { "id": "support_trendline_breakdown", "title": "Support Line Breakdown", "icon": "🔻", "badge": "Breakdown", "badge_type": "bearish", "color": "#ef4444", "category_id": "trendlines", "subgroup_id": "horizontal_trendlines", "description": "Decisive close below key horizontal support level" },
            "horizontal_resistance": { "id": "horizontal_resistance", "title": "Horizontal Resistance Line", "icon": "⏸️", "badge": "Ceiling", "badge_type": "neutral", "color": "#f59e0b", "category_id": "trendlines", "subgroup_id": "horizontal_trendlines", "description": "Testing major horizontal multi-touch resistance ceiling" },
            "resistance_trendline_breakout": { "id": "resistance_trendline_breakout", "title": "Resistance Line Breakout", "icon": "🚀", "badge": "Breakout", "badge_type": "bullish", "color": "#10b981", "category_id": "trendlines", "subgroup_id": "horizontal_trendlines", "description": "Clean breakout and close above horizontal resistance ceiling" },

            # --- TRIANGLES ---
            "ascending_triangle": { "id": "ascending_triangle", "title": "Ascending Triangle", "icon": "📐", "badge": "Forming", "badge_type": "bullish", "color": "#06b6d4", "category_id": "triangles", "subgroup_id": "ascending_triangle", "description": "Horizontal resistance with rising higher swing lows (Accumulation)" },
            "ascending_triangle_breakout": { "id": "ascending_triangle_breakout", "title": "Ascending Triangle Breakout", "icon": "🚀", "badge": "Breakout", "badge_type": "bullish", "color": "#10b981", "category_id": "triangles", "subgroup_id": "ascending_triangle", "description": "Decisive volume breakout above flat upper triangle resistance" },
            "ascending_triangle_breakdown": { "id": "ascending_triangle_breakdown", "title": "Ascending Triangle Breakdown", "icon": "🔻", "badge": "Breakdown", "badge_type": "bearish", "color": "#ef4444", "category_id": "triangles", "subgroup_id": "ascending_triangle", "description": "Failed triangle setup breaking down below ascending base" },
            "descending_triangle": { "id": "descending_triangle", "title": "Descending Triangle", "icon": "📐", "badge": "Forming", "badge_type": "bearish", "color": "#f59e0b", "category_id": "triangles", "subgroup_id": "descending_triangle", "description": "Flat lower support with lower swing highs (Distribution)" },
            "descending_triangle_breakdown": { "id": "descending_triangle_breakdown", "title": "Descending Triangle Breakdown", "icon": "🔻", "badge": "Breakdown", "badge_type": "bearish", "color": "#dc2626", "category_id": "triangles", "subgroup_id": "descending_triangle", "description": "Confirmed breakdown below flat base support level" },
            "symmetrical_triangle": { "id": "symmetrical_triangle", "title": "Symmetric Triangle", "icon": "📐", "badge": "Consolidation", "badge_type": "neutral", "color": "#6366f1", "category_id": "triangles", "subgroup_id": "symmetrical_triangle", "description": "Converging upper resistance and lower support into apex" },
            "symmetrical_triangle_breakout": { "id": "symmetrical_triangle_breakout", "title": "Symmetric Triangle Breakout", "icon": "🚀", "badge": "Breakout", "badge_type": "bullish", "color": "#10b981", "category_id": "triangles", "subgroup_id": "symmetrical_triangle", "description": "Upside expansion breakout from symmetrical coil" },
            "symmetrical_triangle_breakdown": { "id": "symmetrical_triangle_breakdown", "title": "Symmetric Triangle Breakdown", "icon": "🔻", "badge": "Breakdown", "badge_type": "bearish", "color": "#ef4444", "category_id": "triangles", "subgroup_id": "symmetrical_triangle", "description": "Downside breakdown from contracting symmetric triangle" },

            # --- CHANNELS ---
            "ascending_channel": { "id": "ascending_channel", "title": "Ascending Channel", "icon": "⏸️", "badge": "Channel", "badge_type": "bullish", "color": "#10b981", "category_id": "channels", "subgroup_id": "ascending_channel", "description": "Price oscillating within parallel upward-sloping boundaries" },
            "ascending_channel_breakout": { "id": "ascending_channel_breakout", "title": "Ascending Channel Breakout", "icon": "🔥", "badge": "Expansion", "badge_type": "bullish", "color": "#10b981", "category_id": "channels", "subgroup_id": "ascending_channel", "description": "Parabolic breakout above upper ascending channel band" },
            "ascending_channel_breakdown": { "id": "ascending_channel_breakdown", "title": "Ascending Channel Breakdown", "icon": "🔻", "badge": "Breakdown", "badge_type": "bearish", "color": "#ef4444", "category_id": "channels", "subgroup_id": "ascending_channel", "description": "Downtrend reversal breaking below lower ascending channel" },
            "descending_channel": { "id": "descending_channel", "title": "Descending Channel", "icon": "⏸️", "badge": "Channel", "badge_type": "bearish", "color": "#f43f5e", "category_id": "channels", "subgroup_id": "descending_channel", "description": "Price oscillating within parallel downward-sloping boundaries" },
            "descending_channel_breakout": { "id": "descending_channel_breakout", "title": "Descending Channel Breakout", "icon": "⚡", "badge": "Reversal", "badge_type": "bullish", "color": "#10b981", "category_id": "channels", "subgroup_id": "descending_channel", "description": "Trend reversal breakout above upper descending channel band" },
            "descending_channel_breakdown": { "id": "descending_channel_breakdown", "title": "Descending Channel Breakdown", "icon": "🔻", "badge": "Breakdown", "badge_type": "bearish", "color": "#dc2626", "category_id": "channels", "subgroup_id": "descending_channel", "description": "Downside channel breakdown with momentum acceleration" },
            "rectangle_channel": { "id": "rectangle_channel", "title": "Rectangle Channel", "icon": "⏸️", "badge": "Rangebound", "badge_type": "neutral", "color": "#6366f1", "category_id": "channels", "subgroup_id": "rectangle_channel", "description": "Defined horizontal consolidation channel between support & resistance" },
            "rectangle_channel_breakout": { "id": "rectangle_channel_breakout", "title": "Rectangle Breakout", "icon": "🚀", "badge": "Breakout", "badge_type": "bullish", "color": "#10b981", "category_id": "channels", "subgroup_id": "rectangle_channel", "description": "Explosive breakout above rectangle range resistance" },
            "rectangle_channel_breakdown": { "id": "rectangle_channel_breakdown", "title": "Rectangle Breakdown", "icon": "🔻", "badge": "Breakdown", "badge_type": "bearish", "color": "#ef4444", "category_id": "channels", "subgroup_id": "rectangle_channel", "description": "Breakdown below horizontal rectangle floor support" },
            "rectangle_channel_potential": { "id": "rectangle_channel_potential", "title": "Rectangle Potential", "icon": "⏳", "badge": "Potential", "badge_type": "neutral", "color": "#f59e0b", "category_id": "channels", "subgroup_id": "rectangle_channel", "description": "Consolidation forming 3rd touch inside horizontal rectangle" },

            # --- NR / WR ---
            "nr4": { "id": "nr4", "title": "Narrow Range (NR) 4", "icon": "📏", "badge": "NR 4", "badge_type": "neutral", "color": "#06b6d4", "category_id": "nr_wr", "subgroup_id": "narrow_range", "description": "Today's daily range is smallest among past 4 sessions (Volatility compression)" },
            "nr4_breakout": { "id": "nr4_breakout", "title": "NR 4 Bullish Breakout", "icon": "⚡", "badge": "Breakout", "badge_type": "bullish", "color": "#10b981", "category_id": "nr_wr", "subgroup_id": "narrow_range", "description": "Bullish expansion above the High of previous NR 4 day" },
            "nr4_breakdown": { "id": "nr4_breakdown", "title": "NR 4 Bearish Breakdown", "icon": "🔻", "badge": "Breakdown", "badge_type": "bearish", "color": "#ef4444", "category_id": "nr_wr", "subgroup_id": "narrow_range", "description": "Bearish breakdown below the Low of previous NR 4 day" },
            "nr7": { "id": "nr7", "title": "Narrow Range (NR) 7", "icon": "📏", "badge": "NR 7", "badge_type": "neutral", "color": "#6366f1", "category_id": "nr_wr", "subgroup_id": "narrow_range", "description": "Toby Crabel NR7 setup: Tightest daily bar of last 7 trading days" },
            "nr7_breakout": { "id": "nr7_breakout", "title": "NR 7 Bullish Breakout", "icon": "🚀", "badge": "Breakout", "badge_type": "bullish", "color": "#10b981", "category_id": "nr_wr", "subgroup_id": "narrow_range", "description": "Strong breakout above High of NR 7 candle with volatility expansion" },
            "nr7_breakdown": { "id": "nr7_breakdown", "title": "NR 7 Bearish Breakdown", "icon": "🔻", "badge": "Breakdown", "badge_type": "bearish", "color": "#dc2626", "category_id": "nr_wr", "subgroup_id": "narrow_range", "description": "Sharp breakdown below Low of NR 7 candle" },
            "nr11": { "id": "nr11", "title": "Narrow Range (NR) 11", "icon": "📏", "badge": "NR 11", "badge_type": "neutral", "color": "#8b5cf6", "category_id": "nr_wr", "subgroup_id": "narrow_range", "description": "Extreme range contraction: Smallest bar in 11 sessions" },
            "nr11_breakout": { "id": "nr11_breakout", "title": "NR 11 Bullish Breakout", "icon": "🚀", "badge": "Breakout", "badge_type": "bullish", "color": "#10b981", "category_id": "nr_wr", "subgroup_id": "narrow_range", "description": "Bullish expansion after NR 11 extreme compression" },
            "nr11_breakdown": { "id": "nr11_breakdown", "title": "NR 11 Bearish Breakdown", "icon": "🔻", "badge": "Breakdown", "badge_type": "bearish", "color": "#ef4444", "category_id": "nr_wr", "subgroup_id": "narrow_range", "description": "Bearish sell-off breaking below NR 11 boundary" },
            "nr15": { "id": "nr15", "title": "Narrow Range (NR) 15", "icon": "📏", "badge": "NR 15", "badge_type": "neutral", "color": "#a855f7", "category_id": "nr_wr", "subgroup_id": "narrow_range", "description": "Major multi-week volatility squeeze (Smallest bar of 15 days)" },
            "nr15_breakout": { "id": "nr15_breakout", "title": "NR 15 Bullish Breakout", "icon": "🔥", "badge": "Breakout", "badge_type": "bullish", "color": "#10b981", "category_id": "nr_wr", "subgroup_id": "narrow_range", "description": "Massive directional breakout following NR 15 multi-week squeeze" },
            "nr15_breakdown": { "id": "nr15_breakdown", "title": "NR 15 Bearish Breakdown", "icon": "🔻", "badge": "Breakdown", "badge_type": "bearish", "color": "#dc2626", "category_id": "nr_wr", "subgroup_id": "narrow_range", "description": "Severe breakdown following NR 15 multi-week squeeze" },
            "wr7": { "id": "wr7", "title": "Wide Range (WR) 7", "icon": "📊", "badge": "WR 7", "badge_type": "momentum", "color": "#f59e0b", "category_id": "nr_wr", "subgroup_id": "wide_range", "description": "Largest range bar of the last 7 trading days (Momentum thrust)" },
            "wr7_bull_cont": { "id": "wr7_bull_cont", "title": "WR 7 Bullish Continuation", "icon": "🚀", "badge": "Continuation", "badge_type": "bullish", "color": "#10b981", "category_id": "nr_wr", "subgroup_id": "wide_range", "description": "Follow-through buying after wide-range expansion day" },
            "wr7_bear_cont": { "id": "wr7_bear_cont", "title": "WR 7 Bearish Continuation", "icon": "🔻", "badge": "Continuation", "badge_type": "bearish", "color": "#ef4444", "category_id": "nr_wr", "subgroup_id": "wide_range", "description": "Follow-through selling after wide-range expansion down-day" },
            "wr14": { "id": "wr14", "title": "Wide Range (WR) 14", "icon": "📊", "badge": "WR 14", "badge_type": "momentum", "color": "#f59e0b", "category_id": "nr_wr", "subgroup_id": "wide_range", "description": "Largest range bar of the last 14 trading days" },
            "wr14_bull_cont": { "id": "wr14_bull_cont", "title": "WR 14 Bullish Continuation", "icon": "🚀", "badge": "Continuation", "badge_type": "bullish", "color": "#10b981", "category_id": "nr_wr", "subgroup_id": "wide_range", "description": "Bullish trend continuation following 14-day wide range bar" },
            "wr14_bear_cont": { "id": "wr14_bear_cont", "title": "WR 14 Bearish Continuation", "icon": "🔻", "badge": "Continuation", "badge_type": "bearish", "color": "#ef4444", "category_id": "nr_wr", "subgroup_id": "wide_range", "description": "Bearish trend continuation following 14-day wide range down-bar" },
            "wr20": { "id": "wr20", "title": "Wide Range (WR) 20", "icon": "📊", "badge": "WR 20", "badge_type": "momentum", "color": "#f59e0b", "category_id": "nr_wr", "subgroup_id": "wide_range", "description": "Month-wide range expansion (Largest single bar of past 20 sessions)" },
            "wr20_bull_cont": { "id": "wr20_bull_cont", "title": "WR 20 Bullish Continuation", "icon": "🚀", "badge": "Continuation", "badge_type": "bullish", "color": "#10b981", "category_id": "nr_wr", "subgroup_id": "wide_range", "description": "Institutional impulse continuation after 20-day wide range bar" },
            "wr20_bear_cont": { "id": "wr20_bear_cont", "title": "WR 20 Bearish Continuation", "icon": "🔻", "badge": "Continuation", "badge_type": "bearish", "color": "#dc2626", "category_id": "nr_wr", "subgroup_id": "wide_range", "description": "Heavy institutional selling continuation following 20-day wide range down-bar" },

            # --- POPULAR CHART PATTERNS ---
            "double_bottom": { "id": "double_bottom", "title": "Double Bottom", "icon": "🔄", "badge": "Confirmed", "badge_type": "bullish", "color": "#10b981", "category_id": "chart_patterns", "subgroup_id": "bullish_patterns", "description": "Confirmed 'W' pattern breakout above neckline resistance" },
            "double_bottom_potential": { "id": "double_bottom_potential", "title": "Double Bottom (Potential)", "icon": "⏳", "badge": "Potential", "badge_type": "bullish", "color": "#06b6d4", "category_id": "chart_patterns", "subgroup_id": "bullish_patterns", "description": "Second trough formed and bouncing toward the neckline" },
            "double_bottom_init": { "id": "double_bottom_init", "title": "Double Bottom Init", "icon": "🌱", "badge": "Init", "badge_type": "neutral", "color": "#6366f1", "category_id": "chart_patterns", "subgroup_id": "bullish_patterns", "description": "Early swing structure testing first trough support level" },
            "triple_bottom": { "id": "triple_bottom", "title": "Triple Bottom", "icon": "🔄", "badge": "Confirmed", "badge_type": "bullish", "color": "#10b981", "category_id": "chart_patterns", "subgroup_id": "bullish_patterns", "description": "Confirmed breakout from 3 distinct equal swing lows" },
            "triple_bottom_potential": { "id": "triple_bottom_potential", "title": "Triple Bottom (Potential)", "icon": "⏳", "badge": "Potential", "badge_type": "bullish", "color": "#06b6d4", "category_id": "chart_patterns", "subgroup_id": "bullish_patterns", "description": "Third trough tested and recovering toward neckline" },
            "reverse_head_shoulder": { "id": "reverse_head_shoulder", "title": "Reverse Head & Shoulder", "icon": "👤", "badge": "Confirmed", "badge_type": "bullish", "color": "#10b981", "category_id": "chart_patterns", "subgroup_id": "bullish_patterns", "description": "Inverted H&S neckline breakout (Major trend reversal)" },
            "reverse_head_shoulder_potential": { "id": "reverse_head_shoulder_potential", "title": "Reverse H&S (Potential)", "icon": "⏳", "badge": "Potential", "badge_type": "bullish", "color": "#06b6d4", "category_id": "chart_patterns", "subgroup_id": "bullish_patterns", "description": "Right shoulder completed, advancing toward neckline" },
            "higher_highs_lows": { "id": "higher_highs_lows", "title": "Higher Highs & Higher Lows", "icon": "📈", "badge": "Uptrend", "badge_type": "bullish", "color": "#10b981", "category_id": "chart_patterns", "subgroup_id": "bullish_patterns", "description": "Pure Dow Theory structural bull trend with consecutive swing steps" },
            "rounding_bottom": { "id": "rounding_bottom", "title": "Rounding Bottom", "icon": "🥣", "badge": "Reversal", "badge_type": "bullish", "color": "#10b981", "category_id": "chart_patterns", "subgroup_id": "bullish_patterns", "description": "Saucer / bowl-shaped gradual institutional accumulation base" },
            "bullish_flag": { "id": "bullish_flag", "title": "Bullish Flag", "icon": "🚩", "badge": "Continuation", "badge_type": "bullish", "color": "#10b981", "category_id": "chart_patterns", "subgroup_id": "bullish_patterns", "description": "Impulsive flagpole followed by tight downward consolidation channel" },
            "cup_and_handle": { "id": "cup_and_handle", "title": "Cup and Handle", "icon": "☕", "badge": "Breakout", "badge_type": "bullish", "color": "#10b981", "category_id": "chart_patterns", "subgroup_id": "bullish_patterns", "description": "William O'Neil classic: Rounded cup with shallow handle breakout" },
            "bullish_pennant": { "id": "bullish_pennant", "title": "Bullish Pennant", "icon": "🎪", "badge": "Continuation", "badge_type": "bullish", "color": "#10b981", "category_id": "chart_patterns", "subgroup_id": "bullish_patterns", "description": "Sharp trend pole followed by symmetrical tight contracting wedge" },
            "v_pattern": { "id": "v_pattern", "title": "V Pattern", "icon": "✌️", "badge": "V Reversal", "badge_type": "bullish", "color": "#10b981", "category_id": "chart_patterns", "subgroup_id": "bullish_patterns", "description": "Aggressive, high-velocity symmetrical recovery from sharp sell-off" },

            "double_top": { "id": "double_top", "title": "Double Top", "icon": "🔄", "badge": "Confirmed", "badge_type": "bearish", "color": "#ef4444", "category_id": "chart_patterns", "subgroup_id": "bearish_patterns", "description": "Confirmed 'M' pattern breakdown below intermediate support neckline" },
            "double_top_potential": { "id": "double_top_potential", "title": "Double Top (Potential)", "icon": "⏳", "badge": "Potential", "badge_type": "bearish", "color": "#f59e0b", "category_id": "chart_patterns", "subgroup_id": "bearish_patterns", "description": "Second peak formed and falling toward intermediate valley" },
            "double_top_init": { "id": "double_top_init", "title": "Double Top Init", "icon": "🌱", "badge": "Init", "badge_type": "neutral", "color": "#6366f1", "category_id": "chart_patterns", "subgroup_id": "bearish_patterns", "description": "Early swing structure rejecting near previous swing peak" },
            "triple_top": { "id": "triple_top", "title": "Triple Top", "icon": "🔄", "badge": "Confirmed", "badge_type": "bearish", "color": "#ef4444", "category_id": "chart_patterns", "subgroup_id": "bearish_patterns", "description": "Confirmed breakdown from 3 equal swing resistance tops" },
            "triple_top_potential": { "id": "triple_top_potential", "title": "Triple Top (Potential)", "icon": "⏳", "badge": "Potential", "badge_type": "bearish", "color": "#f59e0b", "category_id": "chart_patterns", "subgroup_id": "bearish_patterns", "description": "Third peak rejected and declining toward support neckline" },
            "head_shoulder": { "id": "head_shoulder", "title": "Head & Shoulder", "icon": "👤", "badge": "Confirmed", "badge_type": "bearish", "color": "#ef4444", "category_id": "chart_patterns", "subgroup_id": "bearish_patterns", "description": "Classic distribution: Neckline breakdown below Left/Head/Right shoulders" },
            "head_shoulder_potential": { "id": "head_shoulder_potential", "title": "Head & Shoulder (Potential)", "icon": "⏳", "badge": "Potential", "badge_type": "bearish", "color": "#f59e0b", "category_id": "chart_patterns", "subgroup_id": "bearish_patterns", "description": "Right shoulder rejected from peak, declining toward neckline" },
            "lower_highs_lows": { "id": "lower_highs_lows", "title": "Lower Highs & Lower Lows", "icon": "📉", "badge": "Downtrend", "badge_type": "bearish", "color": "#dc2626", "category_id": "chart_patterns", "subgroup_id": "bearish_patterns", "description": "Pure Dow Theory structural bear trend with consecutive lower steps" },
            "rounding_top": { "id": "rounding_top", "title": "Rounding Top", "icon": "🥣", "badge": "Distribution", "badge_type": "bearish", "color": "#ef4444", "category_id": "chart_patterns", "subgroup_id": "bearish_patterns", "description": "Inverted saucer gradual distribution top signaling major trend exhaustion" },
            "bearish_flag": { "id": "bearish_flag", "title": "Bearish Flag", "icon": "🚩", "badge": "Continuation", "badge_type": "bearish", "color": "#ef4444", "category_id": "chart_patterns", "subgroup_id": "bearish_patterns", "description": "Sharp downward pole followed by upward counter-trend consolidation channel" },
            "cup_and_handle_inverse": { "id": "cup_and_handle_inverse", "title": "Cup and Handle Inverse", "icon": "☕", "badge": "Breakdown", "badge_type": "bearish", "color": "#ef4444", "category_id": "chart_patterns", "subgroup_id": "bearish_patterns", "description": "Inverted dome base with upward drift handle breakdown" },
            "bearish_pennant": { "id": "bearish_pennant", "title": "Bearish Pennant", "icon": "🎪", "badge": "Continuation", "badge_type": "bearish", "color": "#ef4444", "category_id": "chart_patterns", "subgroup_id": "bearish_patterns", "description": "Sharp downward sell-off pole followed by tight contracting consolidation" },
            "inverse_v_pattern": { "id": "inverse_v_pattern", "title": "Inverse V Pattern", "icon": "✌️", "badge": "Inverted V", "badge_type": "bearish", "color": "#dc2626", "category_id": "chart_patterns", "subgroup_id": "bearish_patterns", "description": "Aggressive, high-velocity dump immediately following parabolic spike" }
        }
    }

def _calculate_ema(series, period):
    if len(series) < period:
        return [series[-1]] * len(series)
    k = 2.0 / (period + 1.0)
    ema_val = sum(series[:period]) / float(period)
    ema_series = [ema_val]
    for c in series[period:]:
        ema_val = (c * k) + (ema_val * (1.0 - k))
        ema_series.append(ema_val)
    return ema_series

def _get_target_symbols_for_scope(scope="all", watchlist_id=None, uname="admin"):
    """
    Extracts symbols based on user's Scope choice: 'all', 'portfolio', or 'watchlist'
    """
    symbols = []
    
    if scope == "portfolio":
        try:
            from modules.portfolio.portfolio_routes import load_portfolios
            from modules.insights.insights_routes import _extract_pf_symbols_set
            pf_data = load_portfolios(uname)
            symbols = list(_extract_pf_symbols_set(pf_data))
        except Exception as e:
            print(f"Error loading portfolio symbols for screener: {e}")
            symbols = []

    elif scope == "watchlist":
        try:
            from modules.watchlist.watchlist_routes import load_data as load_watchlists
            wl_data = load_watchlists(uname)
            if isinstance(wl_data, dict):
                if watchlist_id and watchlist_id in wl_data:
                    wl_items = wl_data.get(watchlist_id, [])
                    symbols = [item.get("symbol", "") for item in wl_items if isinstance(item, dict) and item.get("symbol")]
                else:
                    for w_name, items in wl_data.items():
                        if isinstance(items, list):
                            for it in items:
                                if isinstance(it, dict) and it.get("symbol"):
                                    symbols.append(it["symbol"])
                                elif isinstance(it, str):
                                    symbols.append(it)
        except Exception as e:
            print(f"Error loading watchlist symbols for screener: {e}")
            symbols = []

    if not symbols or scope == "all":
        # All market universe + user's active holdings/watchlists merged
        target_set = set(POPULAR_INDIAN_STOCKS.keys())
        try:
            from modules.portfolio.portfolio_routes import load_portfolios
            from modules.insights.insights_routes import _extract_pf_symbols_set
            pf_syms = _extract_pf_symbols_set(load_portfolios(uname))
            target_set.update(pf_syms)
        except Exception:
            pass
        symbols = list(target_set)

    # Clean & normalize symbols
    clean_syms = []
    for s in symbols:
        if not s:
            continue
        cleaned = s.upper().replace(".NS", "").replace(".BO", "").strip()
        if cleaned and cleaned not in clean_syms:
            clean_syms.append(cleaned)

    return clean_syms

@technical_screener_bp.route("/api/technical-screener/hierarchy", methods=["GET"])
def get_technical_screener_hierarchy_api():
    """
    Returns the master screener hierarchy and definitions from Collection 1.
    If not in DB yet, seeds Collection 1.
    """
    hierarchy = load_technical_screener_hierarchy_db()
    if not hierarchy or not hierarchy.get("categories"):
        hierarchy = _get_master_screener_hierarchy()
        save_technical_screener_hierarchy_db(hierarchy)
    return jsonify({"success": True, "hierarchy": hierarchy})

@technical_screener_bp.route("/api/technical-screener/scan", methods=["GET"])
def run_technical_screener_scan_api():
    """
    On-demand scanning per Parent Category and Scope.
    Only computes scanners belonging to the requested category!
    Stores/appends results in Collection 2 (technical_screener_info) per stock symbol.
    """
    uname = session.get("username", "admin") if hasattr(session, "get") else "admin"
    category = request.args.get("category", "smart_scanners").strip().lower()
    scope = request.args.get("scope", "all").strip().lower()
    watchlist_id = request.args.get("watchlist_id", "").strip()
    force_refresh = request.args.get("force_refresh", "false").lower() in ("true", "1", "yes")

    # Get master hierarchy to check category validity
    hierarchy = load_technical_screener_hierarchy_db()
    if not hierarchy or not hierarchy.get("definitions"):
        hierarchy = _get_master_screener_hierarchy()
        save_technical_screener_hierarchy_db(hierarchy)

    cat_meta = next((c for c in hierarchy.get("categories", []) if c.get("id") == category), None)
    if not cat_meta:
        return jsonify({"success": False, "error": f"Unknown category: {category}"}), 400

    target_symbols = _get_target_symbols_for_scope(scope=scope, watchlist_id=watchlist_id, uname=uname)
    if not target_symbols:
        return jsonify({
            "success": True,
            "category": category,
            "scope": scope,
            "total_scanned": 0,
            "scanners": {},
            "stocks": {}
        })

    # If category is not smart_scanners (e.g. Trendlines, Triangles in Phase 2-6), return empty/planned state
    if category != "smart_scanners":
        # Extract screener ids in this category
        cat_screener_ids = []
        for sg in cat_meta.get("subgroups", []):
            cat_screener_ids.extend(sg.get("screeners", []))

        # Check existing data in Collection 2 if already calculated
        existing_info = load_technical_screener_info_db(symbols=target_symbols)
        scanners_result = {}
        for sc_id in cat_screener_ids:
            sc_def = hierarchy.get("definitions", {}).get(sc_id, {})
            scanners_result[sc_id] = {
                "id": sc_id,
                "title": sc_def.get("title", sc_id),
                "badge": sc_def.get("badge", "Neutral"),
                "badge_type": sc_def.get("badge_type", "neutral"),
                "color": sc_def.get("color", "#64748b"),
                "description": sc_def.get("description", ""),
                "phase": cat_meta.get("phase", 2),
                "stocks": []
            }
            # Populate any stocks that matched
            for sym, s_data in existing_info.items():
                scs = s_data.get("scanners", {})
                if sc_id in scs and scs[sc_id]:
                    match_item = dict(scs[sc_id])
                    match_item["symbol"] = sym
                    match_item["name"] = s_data.get("name", sym)
                    scanners_result[sc_id]["stocks"].append(match_item)

        return jsonify({
            "success": True,
            "category": category,
            "scope": scope,
            "status": cat_meta.get("status", "planned"),
            "total_scanned": len(target_symbols),
            "scanners": scanners_result,
            "stocks": existing_info
        })

    # Category is 'smart_scanners': Check Collection 2 cache
    cache_key = f"{uname}_{category}_{scope}_{watchlist_id}"
    now_ts = time.time()

    if not force_refresh:
        # Check if we already have recent data in Collection 2
        existing_info = load_technical_screener_info_db(symbols=target_symbols)
        valid_cached_stocks = 0
        for sym in target_symbols:
            doc = existing_info.get(sym.upper())
            if doc and doc.get("scanners") and doc.get("categories_scanned", {}).get("smart_scanners"):
                valid_cached_stocks += 1

        # If >= 80% of targets are already cached in DB and updated today, build response directly from Collection 2
        if valid_cached_stocks >= max(1, int(len(target_symbols) * 0.8)):
            scanners_result = _build_category_scanners_response(hierarchy, category, existing_info, target_symbols)
            return jsonify({
                "success": True,
                "category": category,
                "scope": scope,
                "total_scanned": len(target_symbols),
                "from_cache": True,
                "scanners": scanners_result,
                "stocks": existing_info
            })

    # Run on-demand calculation for target symbols
    with _SCREENER_LOCK:
        # Prepare Yahoo Finance Session
        y_session = requests.Session()
        y_session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        })

        def analyze_single_stock(symbol):
            try:
                hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']
                yf_sym = f"{symbol}.NS"
                data = None
                for host in hosts:
                    url = f'https://{host}/v8/finance/chart/{yf_sym}?interval=1d&range=1y&includeAdjustedClose=true'
                    try:
                        r = y_session.get(url, timeout=3.5)
                        if r.status_code == 200:
                            j = r.json()
                            res = j.get('chart', {}).get('result')
                            if res and len(res) > 0:
                                data = res[0]
                                break
                    except Exception:
                        pass

                if not data:
                    return None

                meta = data.get('meta', {})
                name = POPULAR_INDIAN_STOCKS.get(symbol, meta.get('shortName') or meta.get('longName') or symbol)

                quote = data.get('indicators', {}).get('quote', [{}])[0]
                raw_closes = quote.get('close', []) or []
                raw_highs = quote.get('high', []) or []
                raw_lows = quote.get('low', []) or []
                raw_vols = quote.get('volume', []) or []

                valid_idx = [
                    i for i, c in enumerate(raw_closes)
                    if c is not None and i < len(raw_highs) and raw_highs[i] is not None and i < len(raw_lows) and raw_lows[i] is not None
                ]
                if len(valid_idx) < 30:
                    return None

                closes = [raw_closes[i] for i in valid_idx]
                highs = [raw_highs[i] for i in valid_idx]
                lows = [raw_lows[i] for i in valid_idx]
                volumes = [raw_vols[i] if (i < len(raw_vols) and raw_vols[i] is not None) else 0 for i in valid_idx]

                ltp = round(closes[-1], 2)
                prev_close = round(closes[-2], 2) if len(closes) >= 2 else ltp
                change_pct = round(((ltp - prev_close) / prev_close) * 100.0, 2)
                vol_latest = volumes[-1]

                # Moving averages
                sma20_latest = sum(closes[-20:]) / 20.0 if len(closes) >= 20 else None
                sma50_latest = sum(closes[-50:]) / 50.0 if len(closes) >= 50 else None
                sma200_latest = sum(closes[-200:]) / 200.0 if len(closes) >= 200 else None

                ema9_series = _calculate_ema(closes, 9)
                ema21_series = _calculate_ema(closes, 21)
                ema12_series = _calculate_ema(closes, 12)
                ema26_series = _calculate_ema(closes, 26)

                ema9_latest = ema9_series[-1]
                ema21_latest = ema21_series[-1]

                # RSI 14
                gains = [max(closes[i] - closes[i-1], 0) for i in range(1, len(closes))]
                losses = [max(closes[i-1] - closes[i], 0) for i in range(1, len(closes))]
                rsi14 = None
                if len(gains) >= 14:
                    avg_gain = sum(gains[:14]) / 14.0
                    avg_loss = sum(losses[:14]) / 14.0
                    for i in range(14, len(gains)):
                        avg_gain = (avg_gain * 13 + gains[i]) / 14.0
                        avg_loss = (avg_loss * 13 + losses[i]) / 14.0
                    rs = avg_gain / avg_loss if avg_loss != 0 else 100.0
                    rsi14 = round(100.0 - (100.0 / (1.0 + rs)), 1) if avg_loss != 0 else 100.0

                # MACD
                macd_line = [c12 - c26 for c12, c26 in zip(ema12_series[-len(ema26_series):], ema26_series)]
                signal_series = _calculate_ema(macd_line, 9)
                macd_val = round(macd_line[-1], 2)
                signal_val = round(signal_series[-1], 2)

                # Bollinger Bands
                upper_bb = None
                if sma20_latest is not None:
                    variance = sum((c - sma20_latest) ** 2 for c in closes[-20:]) / 20.0
                    upper_bb = round(sma20_latest + (2.0 * (variance ** 0.5)), 2)

                # Donchian
                donchian_high = round(max(highs[-21:-1]), 2) if len(highs) >= 21 else round(max(highs), 2)
                high_52w = round(max(highs[-252:]), 2) if len(highs) >= 252 else round(max(highs), 2)
                low_52w = round(min(lows[-252:]), 2) if len(lows) >= 252 else round(min(lows), 2)

                # Volume Surge
                vol_20d_avg = sum(volumes[-21:-1]) / 20.0 if len(volumes) >= 21 else (sum(volumes) / len(volumes) if volumes else 1)
                vol_surge = round(vol_latest / vol_20d_avg, 1) if vol_20d_avg > 0 else 1.0

                # Supertrend calculation
                tr = [highs[0] - lows[0]]
                for i in range(1, len(closes)):
                    tr.append(max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1])))
                atr10 = sum(tr[-10:]) / 10.0 if len(tr) >= 10 else sum(tr) / len(tr)
                st_lower = round(((highs[-1] + lows[-1]) / 2.0) - (3.0 * atr10), 2)

                # Base stock info
                base_scanner_result = {
                    "ltp": ltp,
                    "change_pct": change_pct,
                    "volume": vol_latest,
                    "rsi": rsi14
                }

                matched_scanners = {}

                # 1. Golden Crossover
                if sma50_latest and sma200_latest and sma50_latest > sma200_latest:
                    s_item = dict(base_scanner_result)
                    s_item["metric"] = f"50 DMA (₹{sma50_latest:.1f}) > 200 DMA (₹{sma200_latest:.1f})"
                    matched_scanners["golden_cross"] = s_item

                # 2. Supertrend BUY
                if ltp > st_lower and ltp > (highs[-1] + lows[-1]) / 2.0:
                    s_item = dict(base_scanner_result)
                    s_item["metric"] = f"LTP ₹{ltp:.2f} > Supertrend ₹{st_lower:.2f}"
                    matched_scanners["supertrend_buy"] = s_item

                # 3. RSI Momentum
                if rsi14 is not None and 55 <= rsi14 <= 72:
                    s_item = dict(base_scanner_result)
                    s_item["metric"] = f"RSI(14) at {rsi14:.1f} (Bullish Momentum Range)"
                    matched_scanners["rsi_momentum"] = s_item

                # 4. EMA Bullish Cross
                if ema9_latest > ema21_latest:
                    s_item = dict(base_scanner_result)
                    s_item["metric"] = f"9 EMA (₹{ema9_latest:.1f}) > 21 EMA (₹{ema21_latest:.1f})"
                    matched_scanners["ema_bull_cross"] = s_item

                # 5. MACD Bullish Cross
                if macd_val > signal_val and macd_val > -10.0:
                    s_item = dict(base_scanner_result)
                    s_item["metric"] = f"MACD ({macd_val:+.1f}) > Signal ({signal_val:+.1f})"
                    matched_scanners["macd_bullish"] = s_item

                # 6. Bollinger Band Breakout
                if upper_bb and ltp >= upper_bb * 0.995:
                    s_item = dict(base_scanner_result)
                    s_item["metric"] = f"LTP ₹{ltp:.2f} ≥ Upper BB ₹{upper_bb:.2f}"
                    matched_scanners["bollinger_breakout"] = s_item

                # 7. Donchian Channel Breakout
                if donchian_high and ltp >= donchian_high * 0.995:
                    s_item = dict(base_scanner_result)
                    s_item["metric"] = f"LTP ₹{ltp:.2f} at 20D High ₹{donchian_high:.2f}"
                    matched_scanners["donchian_breakout"] = s_item

                # 8. ST Trigger Bullish
                if ltp > prev_close and ltp > (highs[-1] + lows[-1]) / 2.0 and highs[-1] >= highs[-2]:
                    s_item = dict(base_scanner_result)
                    s_item["metric"] = f"ST Trigger Bullish (Higher High ₹{highs[-1]:.2f})"
                    matched_scanners["st_trigger_bull"] = s_item

                # 9. Bullish Engulfing
                is_prev_red = closes[-2] < closes[-3] if len(closes) >= 3 else False
                is_curr_green = ltp > prev_close
                if is_curr_green and is_prev_red and ltp >= highs[-2] * 0.995:
                    s_item = dict(base_scanner_result)
                    s_item["metric"] = f"Engulfing: Green ₹{ltp:.2f} vs Prior Red ₹{prev_close:.2f}"
                    matched_scanners["bullish_engulfing"] = s_item

                # 10. Near 52W High
                if high_52w and ltp >= high_52w * 0.97:
                    away_pct = round(((high_52w - ltp) / high_52w) * 100.0, 1)
                    s_item = dict(base_scanner_result)
                    s_item["metric"] = f"52W High ₹{high_52w:.2f} ({away_pct}% away)"
                    matched_scanners["high_52w"] = s_item

                # 11. Volume Surge
                if vol_surge >= 1.8 and vol_latest > 5000:
                    s_item = dict(base_scanner_result)
                    s_item["metric"] = f"{vol_surge:.1f}x vs 20d Avg Vol"
                    matched_scanners["volume_surge"] = s_item

                # 12. Triple Confluence
                if ema9_latest > ema21_latest and (rsi14 is not None and rsi14 >= 50) and (sma50_latest and ltp > sma50_latest):
                    s_item = dict(base_scanner_result)
                    s_item["metric"] = f"EMA Cross + RSI {rsi14:.1f} + Above 50 DMA"
                    matched_scanners["triple_confluence"] = s_item

                # 13. RSI Oversold Rebound
                if rsi14 is not None and rsi14 <= 38:
                    s_item = dict(base_scanner_result)
                    s_item["metric"] = f"RSI(14) at {rsi14:.1f} (Oversold Range)"
                    matched_scanners["rsi_oversold"] = s_item

                # 14. Extreme Oversold
                if rsi14 is not None and rsi14 < 30.0:
                    s_item = dict(base_scanner_result)
                    s_item["metric"] = f"RSI(14) at {rsi14:.1f} (< 30 Extreme)"
                    matched_scanners["oversold_extreme"] = s_item

                # 15. Death Cross
                if sma50_latest and sma200_latest and sma50_latest < sma200_latest:
                    s_item = dict(base_scanner_result)
                    s_item["metric"] = f"50 DMA (₹{sma50_latest:.1f}) < 200 DMA (₹{sma200_latest:.1f})"
                    matched_scanners["death_cross"] = s_item

                # 16. Near 52W Low
                if low_52w and ltp <= low_52w * 1.03:
                    away_pct = round(((ltp - low_52w) / low_52w) * 100.0, 1)
                    s_item = dict(base_scanner_result)
                    s_item["metric"] = f"52W Low ₹{low_52w:.2f} ({away_pct}% away)"
                    matched_scanners["low_52w"] = s_item

                return {
                    "symbol": symbol,
                    "name": name,
                    "ltp": ltp,
                    "change_pct": change_pct,
                    "volume": vol_latest,
                    "rsi": rsi14,
                    "new_scanners": matched_scanners
                }
            except Exception as e:
                return None

        # Execute threaded batch scan
        max_threads = min(14, len(target_symbols))
        with ThreadPoolExecutor(max_workers=max_threads) as executor:
            analyzed_stocks = list(executor.map(analyze_single_stock, target_symbols))

        # Format stock updates dictionary for Collection 2
        stock_updates_to_save = {}
        for stock_res in analyzed_stocks:
            if stock_res and stock_res.get("symbol"):
                sym = stock_res["symbol"]
                stock_updates_to_save[sym] = stock_res

        # Append to Collection 2: technical_screener_info
        batch_append_technical_screener_info_db(stock_updates_to_save, category_id="smart_scanners")

        # Load updated state from Collection 2
        all_info = load_technical_screener_info_db(symbols=target_symbols)
        scanners_result = _build_category_scanners_response(hierarchy, category, all_info, target_symbols)

        return jsonify({
            "success": True,
            "category": category,
            "scope": scope,
            "total_scanned": len(target_symbols),
            "from_cache": False,
            "scanners": scanners_result,
            "stocks": all_info
        })

def _build_category_scanners_response(hierarchy, category_id, stock_info_map, target_symbols):
    """
    Groups matching stocks by screener_id for the given parent category.
    """
    cat_meta = next((c for c in hierarchy.get("categories", []) if c.get("id") == category_id), None)
    if not cat_meta:
        return {}

    cat_screener_ids = []
    for sg in cat_meta.get("subgroups", []):
        cat_screener_ids.extend(sg.get("screeners", []))

    definitions = hierarchy.get("definitions", {})
    output_scanners = {}

    for s_id in cat_screener_ids:
        s_def = definitions.get(s_id, {})
        output_scanners[s_id] = {
            "id": s_id,
            "title": s_def.get("title", s_id),
            "icon": s_def.get("icon", "⚡"),
            "badge": s_def.get("badge", "Bullish"),
            "badge_type": s_def.get("badge_type", "bullish"),
            "color": s_def.get("color", "#10b981"),
            "description": s_def.get("description", ""),
            "subgroup_id": s_def.get("subgroup_id", ""),
            "stocks": []
        }

    # Aggregate matched stocks from Collection 2
    for sym in target_symbols:
        clean_sym = sym.upper()
        doc = stock_info_map.get(clean_sym)
        if not doc:
            continue
        scs = doc.get("scanners", {})
        for s_id in cat_screener_ids:
            if s_id in scs and scs[s_id]:
                st_match = dict(scs[s_id])
                st_match["symbol"] = clean_sym
                st_match["name"] = doc.get("name", clean_sym)
                output_scanners[s_id]["stocks"].append(st_match)

    return output_scanners

@technical_screener_bp.route("/api/technical-screener/stock/<symbol>", methods=["GET"])
def get_stock_technical_summary_api(symbol):
    """
    Returns all technical signals accumulated across all categories for a single stock.
    Collection 2: technical_screener_info
    """
    clean_sym = symbol.upper().replace(".NS", "").replace(".BO", "").strip()
    data = load_technical_screener_info_db(symbols=[clean_sym])
    stock_doc = data.get(clean_sym)
    if not stock_doc:
        return jsonify({"success": False, "error": f"No technical data found for {clean_sym}"}), 404
    return jsonify({"success": True, "stock": stock_doc})
