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
                "badge": "12 Active",
                "description": "Rising, Falling & Horizontal Trendline S/R, Breakouts & Breakdowns",
                "status": "ready",
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
                "badge": "8 Active",
                "description": "Ascending, Descending & Symmetrical Geometric Triangle Breakouts",
                "status": "ready",
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
                "badge": "10 Active",
                "description": "Ascending, Descending & Rectangle Dynamic Price Channels",
                "status": "ready",
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
                "badge": "18 Active",
                "description": "Narrow Range (NR) Volatility Contraction & Wide Range (WR) Expansion",
                "status": "ready",
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
                "badge": "26 Active",
                "description": "Classic Reversal & Continuation Patterns (Double/Triple, H&S, Flags, Cups)",
                "status": "ready",
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
                matched_key = None
                if watchlist_id and watchlist_id != "__all__":
                    for k in wl_data.keys():
                        if k.strip().lower() == watchlist_id.strip().lower():
                            matched_key = k
                            break

                if matched_key:
                    wl_items = wl_data.get(matched_key, [])
                    if isinstance(wl_items, list):
                        for it in wl_items:
                            if isinstance(it, dict) and it.get("symbol"):
                                symbols.append(it["symbol"])
                            elif isinstance(it, str):
                                symbols.append(it)
                else:
                    # All watchlists combined
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

    if scope == "all":
        # All tracked stocks across portfolio and all watchlists, plus popular liquid stocks
        target_set = set()
        try:
            from modules.portfolio.portfolio_routes import load_portfolios
            from modules.insights.insights_routes import _extract_pf_symbols_set
            pf_syms = _extract_pf_symbols_set(load_portfolios(uname))
            target_set.update(pf_syms)
        except Exception as e:
            print(f"Error loading portfolio symbols for all scope: {e}")

        try:
            from modules.watchlist.watchlist_routes import load_data as load_watchlists
            wl_data = load_watchlists(uname)
            if isinstance(wl_data, dict):
                for w_name, items in wl_data.items():
                    if isinstance(items, list):
                        for it in items:
                            if isinstance(it, dict) and it.get("symbol"):
                                target_set.add(it["symbol"])
                            elif isinstance(it, str):
                                target_set.add(it)
        except Exception as e:
            print(f"Error loading watchlist symbols for all scope: {e}")

        try:
            from modules.common.market_fetcher import POPULAR_INDIAN_STOCKS
            if isinstance(POPULAR_INDIAN_STOCKS, dict):
                target_set.update(POPULAR_INDIAN_STOCKS.keys())
            elif isinstance(POPULAR_INDIAN_STOCKS, list):
                target_set.update(POPULAR_INDIAN_STOCKS)
        except Exception as e:
            print(f"Error loading popular stocks for all scope: {e}")

        symbols = list(target_set)
    elif not symbols:
        # User selected portfolio or watchlist but it has 0 stocks
        return []

    # Clean & normalize symbols
    clean_syms = []
    for s in symbols:
        if not s:
            continue
        cleaned = s.upper().replace(".NS", "").replace(".BO", "").strip()
        if cleaned and cleaned not in clean_syms:
            clean_syms.append(cleaned)

    return clean_syms

def _analyze_trendlines_for_stock(closes, highs, lows, dates, symbol, name, ltp, prev_close):
    """
    Mathematical Trendline & Channel Extrema Algorithm.
    Detects Rising, Falling, and Horizontal lines + Testing / Breakouts / Breakdowns.
    """
    n = len(closes)
    if n < 30:
        return {}

    # Analyze active 60-90 bar dynamic swing structure
    lookback = min(90, n)
    sub_closes = closes[-lookback:]
    sub_highs = highs[-lookback:]
    sub_lows = lows[-lookback:]
    sub_dates = dates[-lookback:] if dates else []
    curr_time = sub_dates[-1] if sub_dates else ""
    m_len = len(sub_closes)

    w = 3
    p_highs = []
    p_lows = []
    for i in range(w, m_len - w):
        if all(sub_highs[i] >= sub_highs[i - k] and sub_highs[i] >= sub_highs[i + k] for k in range(1, w + 1)):
            p_highs.append((i, sub_highs[i]))
        if all(sub_lows[i] <= sub_lows[i - k] and sub_lows[i] <= sub_lows[i + k] for k in range(1, w + 1)):
            p_lows.append((i, sub_lows[i]))

    # Always ensure the recent extreme is captured
    if m_len - w > 0:
        rh_idx = max(range(m_len - w, m_len), key=lambda x: sub_highs[x])
        p_highs.append((rh_idx, sub_highs[rh_idx]))
        rl_idx = min(range(m_len - w, m_len), key=lambda x: sub_lows[x])
        p_lows.append((rl_idx, sub_lows[rl_idx]))

    curr_idx = m_len - 1
    eps_slope = 0.08  # % change per bar threshold for horizontal

    base_scanner_result = {
        "ltp": ltp,
        "change_pct": round(((ltp - prev_close) / prev_close) * 100.0, 2) if prev_close else 0.0,
        "volume": 0,
        "rsi": None
    }

    matched = {}

    # Support Trendline fit (Swing Lows)
    best_support = None
    for i in range(len(p_lows)):
        for j in range(i + 1, len(p_lows)):
            x1, y1 = p_lows[i]
            x2, y2 = p_lows[j]
            dx = x2 - x1
            if dx < 6:
                continue
            m = (y2 - y1) / float(dx)
            c = y1 - m * x1
            pct_slope = (m / y1) * 100.0

            touches = 0
            violations = 0
            for idx in range(x1, curr_idx):
                tl_val = m * idx + c
                if sub_lows[idx] < tl_val * 0.985:
                    violations += 1
                if abs(sub_lows[idx] - tl_val) / tl_val <= 0.015:
                    touches += 1

            if violations > 2 or touches < 2:
                continue

            score = touches * 10 - violations * 5
            if best_support is None or score > best_support['score']:
                best_support = {
                    'm': m, 'c': c, 'pct_slope': pct_slope,
                    'touches': touches, 'score': score,
                    'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2,
                    'tl_curr': m * curr_idx + c,
                    'tl_prev': m * (curr_idx - 1) + c
                }

    if best_support:
        tl_c = best_support['tl_curr']
        tl_p = best_support['tl_prev']
        slope = best_support['pct_slope']
        t_count = best_support['touches']
        diff = ((ltp - tl_c) / tl_c) * 100.0 if tl_c else 0.0

        sup_start_time = sub_dates[best_support['x1']] if best_support['x1'] < len(sub_dates) else curr_time
        sup_start_price = round(best_support['y1'], 2)
        sup_end_price = round(tl_c, 2)

        def make_sup_drawing(color, name):
            return [{
                "type": "trendline",
                "time1": sup_start_time,
                "price1": sup_start_price,
                "time2": curr_time,
                "price2": sup_end_price,
                "color": color,
                "lineWidth": 2,
                "lineStyle": "solid",
                "name": name
            }]

        if slope > eps_slope:  # Rising Support
            if abs(diff) <= 2.2:
                item = dict(base_scanner_result)
                item["metric"] = f"Testing Rising Support ₹{tl_c:.1f} ({t_count} touches, {diff:+.1f}%)"
                item["markers"] = []
                item["drawings"] = make_sup_drawing("#10b981", "Rising Support Line")
                matched["rising_support"] = item
            elif ltp < tl_c * 0.985 and prev_close >= tl_p * 0.98:
                item = dict(base_scanner_result)
                item["metric"] = f"Breakdown Below Rising Support ₹{tl_c:.1f} ({diff:+.1f}%)"
                item["markers"] = [{"time": curr_time, "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": f"Breakdown ₹{tl_c:.1f}"}]
                item["drawings"] = make_sup_drawing("#ef5350", "Broken Rising Support")
                matched["support_rising_breakdown"] = item
        elif slope < -eps_slope:  # Falling Support
            if abs(diff) <= 2.2:
                item = dict(base_scanner_result)
                item["metric"] = f"Testing Falling Channel Support ₹{tl_c:.1f} ({t_count} touches)"
                item["markers"] = []
                item["drawings"] = make_sup_drawing("#10b981", "Falling Support Line")
                matched["falling_support"] = item
            elif ltp < tl_c * 0.985 and prev_close >= tl_p * 0.98:
                item = dict(base_scanner_result)
                item["metric"] = f"Breakdown Below Falling Support ₹{tl_c:.1f} ({diff:+.1f}%)"
                item["markers"] = [{"time": curr_time, "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": f"Breakdown ₹{tl_c:.1f}"}]
                item["drawings"] = make_sup_drawing("#ef5350", "Broken Falling Support")
                matched["support_falling_breakdown"] = item
        else:  # Horizontal Support
            if abs(diff) <= 2.2:
                item = dict(base_scanner_result)
                item["metric"] = f"Testing Horizontal Floor ₹{tl_c:.1f} ({t_count} touches)"
                item["markers"] = []
                item["drawings"] = make_sup_drawing("#10b981", "Horizontal Floor")
                matched["horizontal_support"] = item
            elif ltp < tl_c * 0.985 and prev_close >= tl_p * 0.98:
                item = dict(base_scanner_result)
                item["metric"] = f"Breakdown Below Horizontal Support ₹{tl_c:.1f} ({diff:+.1f}%)"
                item["markers"] = [{"time": curr_time, "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": f"Breakdown ₹{tl_c:.1f}"}]
                item["drawings"] = make_sup_drawing("#ef5350", "Broken Floor")
                matched["support_trendline_breakdown"] = item

    # Resistance Trendline fit (Swing Highs)
    best_resistance = None
    for i in range(len(p_highs)):
        for j in range(i + 1, len(p_highs)):
            x1, y1 = p_highs[i]
            x2, y2 = p_highs[j]
            dx = x2 - x1
            if dx < 6:
                continue
            m = (y2 - y1) / float(dx)
            c = y1 - m * x1
            pct_slope = (m / y1) * 100.0

            touches = 0
            violations = 0
            for idx in range(x1, curr_idx):
                tl_val = m * idx + c
                if sub_highs[idx] > tl_val * 1.015:
                    violations += 1
                if abs(sub_highs[idx] - tl_val) / tl_val <= 0.015:
                    touches += 1

            if violations > 2 or touches < 2:
                continue

            score = touches * 10 - violations * 5
            if best_resistance is None or score > best_resistance['score']:
                best_resistance = {
                    'm': m, 'c': c, 'pct_slope': pct_slope,
                    'touches': touches, 'score': score,
                    'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2,
                    'tl_curr': m * curr_idx + c,
                    'tl_prev': m * (curr_idx - 1) + c
                }

    if best_resistance:
        tl_c = best_resistance['tl_curr']
        tl_p = best_resistance['tl_prev']
        slope = best_resistance['pct_slope']
        t_count = best_resistance['touches']
        diff = ((ltp - tl_c) / tl_c) * 100.0 if tl_c else 0.0

        res_start_time = sub_dates[best_resistance['x1']] if best_resistance['x1'] < len(sub_dates) else curr_time
        res_start_price = round(best_resistance['y1'], 2)
        res_end_price = round(tl_c, 2)

        def make_res_drawing(color, name):
            return [{
                "type": "trendline",
                "time1": res_start_time,
                "price1": res_start_price,
                "time2": curr_time,
                "price2": res_end_price,
                "color": color,
                "lineWidth": 2,
                "lineStyle": "solid",
                "name": name
            }]

        if slope > eps_slope:  # Rising Resistance
            if abs(diff) <= 2.2 and ltp <= tl_c * 1.008:
                item = dict(base_scanner_result)
                item["metric"] = f"Testing Rising Resistance ₹{tl_c:.1f} ({t_count} touches)"
                item["markers"] = []
                item["drawings"] = make_res_drawing("#ef5350", "Rising Resistance Ceiling")
                matched["resistance_rising"] = item
            elif ltp > tl_c * 1.01 and prev_close <= tl_p * 1.01:
                item = dict(base_scanner_result)
                item["metric"] = f"Breakout Above Rising Resistance ₹{tl_c:.1f} ({diff:+.1f}%)"
                item["markers"] = [{"time": curr_time, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": f"Breakout ₹{tl_c:.1f}"}]
                item["drawings"] = make_res_drawing("#10b981", "Rising Resistance Breakout")
                matched["resistance_rising_breakout"] = item
        elif slope < -eps_slope:  # Falling Resistance
            if abs(diff) <= 2.2 and ltp <= tl_c * 1.008:
                item = dict(base_scanner_result)
                item["metric"] = f"Testing Falling Resistance ₹{tl_c:.1f} ({t_count} touches)"
                item["markers"] = []
                item["drawings"] = make_res_drawing("#ef5350", "Falling Resistance Line")
                matched["resistance_falling"] = item
            elif ltp > tl_c * 1.01 and prev_close <= tl_p * 1.01:
                item = dict(base_scanner_result)
                item["metric"] = f"Reversal Breakout Above Descending Resistance ₹{tl_c:.1f} ({diff:+.1f}%)"
                item["markers"] = [{"time": curr_time, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": f"Breakout ₹{tl_c:.1f}"}]
                item["drawings"] = make_res_drawing("#10b981", "Descending Line Breakout")
                matched["resistance_falling_breakout"] = item
        else:  # Horizontal Resistance
            if abs(diff) <= 2.2 and ltp <= tl_c * 1.008:
                item = dict(base_scanner_result)
                item["metric"] = f"Testing Horizontal Ceiling ₹{tl_c:.1f} ({t_count} touches)"
                item["markers"] = []
                item["drawings"] = make_res_drawing("#ef5350", "Horizontal Ceiling")
                matched["horizontal_resistance"] = item
            elif ltp > tl_c * 1.01 and prev_close <= tl_p * 1.01:
                item = dict(base_scanner_result)
                item["metric"] = f"Breakout Above Horizontal Ceiling ₹{tl_c:.1f} ({diff:+.1f}%)"
                item["markers"] = [{"time": curr_time, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": f"Breakout ₹{tl_c:.1f}"}]
                item["drawings"] = make_res_drawing("#10b981", "Ceiling Breakout")
                matched["resistance_trendline_breakout"] = item

    return matched

def _analyze_triangles_for_stock(closes, highs, lows, dates, symbol, name, ltp, prev_close):
    """
    Mathematical Geometric Triangle Detection Engine (Upgraded Institutional Algorithm).
    Detects Ascending, Descending, and Symmetrical Triangles + Breakouts, Breakdowns & Targets.
    Generates exact chart diagrams: triangle body, breakdown rays, projected target & stop lines.
    """
    n = len(closes)
    if n < 30:
        return {}

    lookback = min(90, n)
    sub_closes = closes[-lookback:]
    sub_highs = highs[-lookback:]
    sub_lows = lows[-lookback:]
    sub_dates = dates[-lookback:] if dates else []
    curr_time = sub_dates[-1] if sub_dates else ""
    m_len = len(sub_closes)
    curr_idx = m_len - 1

    w = 3
    p_highs = []
    p_lows = []
    for i in range(w, m_len - w):
        if all(sub_highs[i] >= sub_highs[i - k] and sub_highs[i] >= sub_highs[i + k] for k in range(1, w + 1)):
            p_highs.append((i, sub_highs[i]))
        if all(sub_lows[i] <= sub_lows[i - k] and sub_lows[i] <= sub_lows[i + k] for k in range(1, w + 1)):
            p_lows.append((i, sub_lows[i]))

    if m_len - w > 0:
        rh_idx = max(range(m_len - w, m_len), key=lambda x: sub_highs[x])
        if not p_highs or rh_idx != p_highs[-1][0]:
            p_highs.append((rh_idx, sub_highs[rh_idx]))
        rl_idx = min(range(m_len - w, m_len), key=lambda x: sub_lows[x])
        if not p_lows or rl_idx != p_lows[-1][0]:
            p_lows.append((rl_idx, sub_lows[rl_idx]))

    base_scanner_result = {
        "ltp": ltp,
        "change_pct": round(((ltp - prev_close) / prev_close) * 100.0, 2) if prev_close else 0.0,
        "volume": 0,
        "rsi": None
    }

    matched = {}

    def make_triangle_drawings(title, status, t_top_start, p_top_start, r_curr,
                               t_bot_start, p_bot_start, s_curr,
                               bd_price, bo_price, target_price, stop_price):
        drawings = []
        is_bd = status == "breakdown"
        is_bo = status == "breakout"

        # 1. Main Triangle Polygon Body
        drawings.append({
            "type": "triangle",
            "time1_top": t_top_start,
            "price1_top": round(p_top_start, 2),
            "time2_top": curr_time,
            "price2_top": round(r_curr, 2),
            "time1_bot": t_bot_start,
            "price1_bot": round(p_bot_start, 2),
            "time2_bot": curr_time,
            "price2_bot": round(s_curr, 2),
            "topColor": "#10b981" if is_bo else "#ef4444",
            "botColor": "#ef5350" if is_bd else "#10b981",
            "fillColor": "rgba(239, 68, 68, 0.12)" if is_bd else ("rgba(16, 185, 129, 0.12)" if is_bo else "rgba(99, 102, 241, 0.12)"),
            "status": status,
            "breakdownPrice": round(bd_price, 2) if bd_price else None,
            "breakoutPrice": round(bo_price, 2) if bo_price else None,
            "targetPrice": round(target_price, 2) if target_price else None,
            "stopPrice": round(stop_price, 2) if stop_price else None,
            "name": title
        })

        # 2. Projected Target Ray (dashed)
        if target_price:
            drawings.append({
                "type": "trendline",
                "time1": curr_time,
                "price1": round(target_price, 2),
                "time2": curr_time,
                "futureOffset2": 15,
                "price2": round(target_price, 2),
                "color": "#10b981" if is_bo else "#ef4444",
                "lineWidth": 1.5,
                "lineStyle": "dashed",
                "name": f"🎯 Target ₹{target_price:.1f}"
            })

        # 3. Stop Loss Ray (dashed amber)
        if stop_price:
            drawings.append({
                "type": "trendline",
                "time1": curr_time,
                "price1": round(stop_price, 2),
                "time2": curr_time,
                "futureOffset2": 12,
                "price2": round(stop_price, 2),
                "color": "#f59e0b",
                "lineWidth": 1.5,
                "lineStyle": "dashed",
                "name": f"🛑 Stop ₹{stop_price:.1f}"
            })

        # 4. Breakdown / Breakout Level Ray
        if bd_price:
            drawings.append({
                "type": "trendline",
                "time1": curr_time,
                "price1": round(bd_price, 2),
                "time2": curr_time,
                "futureOffset2": 12,
                "price2": round(bd_price, 2),
                "color": "#ef4444",
                "lineWidth": 2,
                "lineStyle": "solid",
                "name": f"🔻 Breakdown ₹{bd_price:.1f}"
            })
        elif bo_price:
            drawings.append({
                "type": "trendline",
                "time1": curr_time,
                "price1": round(bo_price, 2),
                "time2": curr_time,
                "futureOffset2": 12,
                "price2": round(bo_price, 2),
                "color": "#10b981",
                "lineWidth": 2,
                "lineStyle": "solid",
                "name": f"🚀 Breakout ₹{bo_price:.1f}"
            })

        return drawings

    # =========================================================================
    # 1. ASCENDING TRIANGLE: Flat Upper Ceiling (Tolerance <= 2.2%) + Rising Lower Support
    # =========================================================================
    best_asc = None
    for i in range(len(p_highs)):
        for j in range(i + 1, len(p_highs)):
            hx1, hy1 = p_highs[i]
            hx2, hy2 = p_highs[j]
            h_dx = hx2 - hx1
            if h_dx < 7: continue
            h_diff = abs(hy2 - hy1) / float(hy1)
            if h_diff <= 0.022:  # Flat resistance ceiling
                ceil_price = max(hy1, hy2)
                c_lows = [p for p in p_lows if p[0] >= hx1 - 4 and p[0] <= curr_idx]
                for li in range(len(c_lows)):
                    for lj in range(li + 1, len(c_lows)):
                        lx1, ly1 = c_lows[li]
                        lx2, ly2 = c_lows[lj]
                        l_dx = lx2 - lx1
                        if l_dx < 6: continue
                        if ly2 > ly1 * 1.012:  # Strictly rising support
                            sm = (ly2 - ly1) / float(l_dx)
                            sc = ly1 - sm * lx1
                            s_curr = sm * curr_idx + sc
                            if ceil_price > s_curr:
                                base_trough = min(ly1, min(sub_lows[hx1:curr_idx]))
                                height = ceil_price - base_trough
                                if height / ceil_price >= 0.035:
                                    touches = sum(1 for idx in range(hx1, curr_idx) if abs(sub_highs[idx] - ceil_price)/ceil_price <= 0.018) +                                               sum(1 for idx in range(lx1, curr_idx) if abs(sub_lows[idx] - (sm*idx+sc))/(sm*idx+sc) <= 0.018)
                                    if best_asc is None or touches > best_asc['touches']:
                                        best_asc = {
                                            'ceil': ceil_price, 's_curr': s_curr, 'height': height,
                                            'hx1': hx1, 'hy1': hy1, 'lx1': lx1, 'ly1': ly1,
                                            'touches': touches
                                        }

    if best_asc:
        ceil = best_asc['ceil']
        s_curr = best_asc['s_curr']
        height = best_asc['height']
        t_top_start = sub_dates[best_asc['hx1']] if best_asc['hx1'] < len(sub_dates) else curr_time
        t_bot_start = sub_dates[best_asc['lx1']] if best_asc['lx1'] < len(sub_dates) else curr_time
        p_top_start = best_asc['hy1']
        p_bot_start = best_asc['ly1']
        spread_pct = ((ceil - s_curr) / s_curr) * 100.0

        if ltp < s_curr * 0.990:
            target = max(0, round(s_curr - height, 2))
            stop = round(s_curr + 0.382 * height, 2)
            matched["ascending_triangle_breakdown"] = {
                **base_scanner_result,
                "metric": f"Ascending Triangle Breakdown: LTP ₹{ltp:.1f} < Support ₹{s_curr:.1f} · Target ₹{target:.1f} (-{height/s_curr*100:.1f}%) · Stop ₹{stop:.1f}",
                "markers": [
                    {"time": t_top_start, "position": "aboveBar", "color": "#f87171", "shape": "circle", "text": f"Ceiling ₹{ceil:.1f}"},
                    {"time": t_bot_start, "position": "belowBar", "color": "#34d399", "shape": "circle", "text": f"HL ₹{p_bot_start:.1f}"},
                    {"time": curr_time, "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": f"Breakdown ₹{s_curr:.1f}"}
                ],
                "drawings": make_triangle_drawings(
                    f"Ascending Triangle Breakdown · Target ₹{target:.1f}",
                    "breakdown", t_top_start, p_top_start, ceil,
                    t_bot_start, p_bot_start, s_curr,
                    s_curr, None, target, stop
                )
            }
        elif ltp > ceil * 1.008:
            target = round(ceil + height, 2)
            stop = round(ceil - 0.382 * height, 2)
            matched["ascending_triangle_breakout"] = {
                **base_scanner_result,
                "metric": f"Ascending Triangle Breakout: LTP ₹{ltp:.1f} > Ceiling ₹{ceil:.1f} (+{((ltp-ceil)/ceil)*100:.1f}%) · Target ₹{target:.1f} · Stop ₹{stop:.1f}",
                "markers": [
                    {"time": t_top_start, "position": "aboveBar", "color": "#f87171", "shape": "circle", "text": f"Ceiling ₹{ceil:.1f}"},
                    {"time": t_bot_start, "position": "belowBar", "color": "#34d399", "shape": "circle", "text": f"HL ₹{p_bot_start:.1f}"},
                    {"time": curr_time, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": f"Breakout ₹{ceil:.1f}"}
                ],
                "drawings": make_triangle_drawings(
                    f"Ascending Triangle Breakout · Target ₹{target:.1f}",
                    "breakout", t_top_start, p_top_start, ceil,
                    t_bot_start, p_bot_start, s_curr,
                    None, ceil, target, stop
                )
            }
        elif s_curr * 0.99 <= ltp <= ceil * 1.01:
            matched["ascending_triangle"] = {
                **base_scanner_result,
                "metric": f"Ascending Triangle Active (Spread {spread_pct:.1f}%, Resistance ₹{ceil:.1f}, Support ₹{s_curr:.1f})",
                "markers": [
                    {"time": t_top_start, "position": "aboveBar", "color": "#f87171", "shape": "circle", "text": f"Ceiling ₹{ceil:.1f}"},
                    {"time": t_bot_start, "position": "belowBar", "color": "#34d399", "shape": "circle", "text": f"HL ₹{p_bot_start:.1f}"},
                    {"time": curr_time, "position": "belowBar", "color": "#38bdf8", "shape": "circle", "text": "In Triangle"}
                ],
                "drawings": make_triangle_drawings(
                    "Ascending Triangle (Active Coil)",
                    "active", t_top_start, p_top_start, ceil,
                    t_bot_start, p_bot_start, s_curr,
                    None, None, None, None
                )
            }

    # =========================================================================
    # 2. DESCENDING TRIANGLE: Flat Lower Floor + Falling Upper Resistance
    # =========================================================================
    best_desc = None
    for li in range(len(p_lows)):
        for lj in range(li + 1, len(p_lows)):
            lx1, ly1 = p_lows[li]
            lx2, ly2 = p_lows[lj]
            l_dx = lx2 - lx1
            if l_dx < 7: continue
            l_diff = abs(ly2 - ly1) / float(ly1)
            if l_diff <= 0.022:  # Flat support floor
                floor_price = min(ly1, ly2)
                c_highs = [p for p in p_highs if p[0] >= lx1 - 4 and p[0] <= curr_idx]
                for hi in range(len(c_highs)):
                    for hj in range(hi + 1, len(c_highs)):
                        hx1, hy1 = c_highs[hi]
                        hx2, hy2 = c_highs[hj]
                        h_dx = hx2 - hx1
                        if h_dx < 6: continue
                        if hy2 < hy1 * 0.988:  # Strictly falling resistance
                            rm = (hy2 - hy1) / float(h_dx)
                            rc = hy1 - rm * hx1
                            r_curr = rm * curr_idx + rc
                            if r_curr > floor_price:
                                base_peak = max(hy1, max(sub_highs[lx1:curr_idx]))
                                height = base_peak - floor_price
                                if height / floor_price >= 0.035:
                                    touches = sum(1 for idx in range(lx1, curr_idx) if abs(sub_lows[idx] - floor_price)/floor_price <= 0.018) +                                               sum(1 for idx in range(hx1, curr_idx) if abs(sub_highs[idx] - (rm*idx+rc))/(rm*idx+rc) <= 0.018)
                                    if best_desc is None or touches > best_desc['touches']:
                                        best_desc = {
                                            'floor': floor_price, 'r_curr': r_curr, 'height': height,
                                            'hx1': hx1, 'hy1': hy1, 'lx1': lx1, 'ly1': ly1,
                                            'touches': touches
                                        }

    if best_desc:
        floor = best_desc['floor']
        r_curr = best_desc['r_curr']
        height = best_desc['height']
        t_top_start = sub_dates[best_desc['hx1']] if best_desc['hx1'] < len(sub_dates) else curr_time
        t_bot_start = sub_dates[best_desc['lx1']] if best_desc['lx1'] < len(sub_dates) else curr_time
        p_top_start = best_desc['hy1']
        p_bot_start = best_desc['ly1']
        spread_pct = ((r_curr - floor) / floor) * 100.0

        if ltp < floor * 0.990:
            target = max(0, round(floor - height, 2))
            stop = round(floor + 0.382 * height, 2)
            matched["descending_triangle_breakdown"] = {
                **base_scanner_result,
                "metric": f"Descending Triangle Breakdown: LTP ₹{ltp:.1f} < Floor ₹{floor:.1f} · Target ₹{target:.1f} (-{height/floor*100:.1f}%) · Stop ₹{stop:.1f}",
                "markers": [
                    {"time": t_bot_start, "position": "belowBar", "color": "#10b981", "shape": "circle", "text": f"Floor ₹{floor:.1f}"},
                    {"time": t_top_start, "position": "aboveBar", "color": "#ef5350", "shape": "circle", "text": f"LH ₹{p_top_start:.1f}"},
                    {"time": curr_time, "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": f"Breakdown ₹{floor:.1f}"}
                ],
                "drawings": make_triangle_drawings(
                    f"Descending Triangle Breakdown · Target ₹{target:.1f}",
                    "breakdown", t_top_start, p_top_start, r_curr,
                    t_bot_start, p_bot_start, floor,
                    floor, None, target, stop
                )
            }
        elif s_curr * 0.99 <= ltp <= r_curr * 1.01:
            matched["descending_triangle"] = {
                **base_scanner_result,
                "metric": f"Descending Triangle Active (Spread {spread_pct:.1f}%, Floor ₹{floor:.1f}, Resistance ₹{r_curr:.1f})",
                "markers": [
                    {"time": t_bot_start, "position": "belowBar", "color": "#10b981", "shape": "circle", "text": f"Floor ₹{floor:.1f}"},
                    {"time": t_top_start, "position": "aboveBar", "color": "#ef5350", "shape": "circle", "text": f"LH ₹{p_top_start:.1f}"},
                    {"time": curr_time, "position": "belowBar", "color": "#38bdf8", "shape": "circle", "text": "In Triangle"}
                ],
                "drawings": make_triangle_drawings(
                    "Descending Triangle (Active Coil)",
                    "active", t_top_start, p_top_start, r_curr,
                    t_bot_start, p_bot_start, floor,
                    None, None, None, None
                )
            }

    # =========================================================================
    # 3. SYMMETRICAL TRIANGLE: Converging Upper & Lower Boundaries into Apex
    # =========================================================================
    best_sym = None
    for hi in range(len(p_highs)):
        for hj in range(hi + 1, len(p_highs)):
            hx1, hy1 = p_highs[hi]
            hx2, hy2 = p_highs[hj]
            h_dx = hx2 - hx1
            if h_dx < 7 or hy2 >= hy1 * 0.99: continue
            rm = (hy2 - hy1) / float(h_dx)
            rc = hy1 - rm * hx1
            r_curr = rm * curr_idx + rc

            for li in range(len(p_lows)):
                for lj in range(li + 1, len(p_lows)):
                    lx1, ly1 = p_lows[li]
                    lx2, ly2 = p_lows[lj]
                    l_dx = lx2 - lx1
                    if l_dx < 7 or ly2 <= ly1 * 1.01: continue
                    sm = (ly2 - ly1) / float(l_dx)
                    sc = ly1 - sm * lx1
                    s_curr = sm * curr_idx + sc

                    if r_curr > s_curr:
                        height = hy1 - ly1
                        if height / hy1 >= 0.04:
                            touches = sum(1 for idx in range(hx1, curr_idx) if abs(sub_highs[idx] - (rm*idx+rc))/(rm*idx+rc) <= 0.018) +                                       sum(1 for idx in range(lx1, curr_idx) if abs(sub_lows[idx] - (sm*idx+sc))/(sm*idx+sc) <= 0.018)
                            if best_sym is None or touches > best_sym['touches']:
                                best_sym = {
                                    'r_curr': r_curr, 's_curr': s_curr, 'height': height,
                                    'hx1': hx1, 'hy1': hy1, 'lx1': lx1, 'ly1': ly1,
                                    'touches': touches
                                }

    if best_sym:
        r_curr = best_sym['r_curr']
        s_curr = best_sym['s_curr']
        height = best_sym['height']
        t_top_start = sub_dates[best_sym['hx1']] if best_sym['hx1'] < len(sub_dates) else curr_time
        t_bot_start = sub_dates[best_sym['lx1']] if best_sym['lx1'] < len(sub_dates) else curr_time
        p_top_start = best_sym['hy1']
        p_bot_start = best_sym['ly1']
        spread_pct = ((r_curr - s_curr) / s_curr) * 100.0

        if ltp > r_curr * 1.008:
            target = round(r_curr + height, 2)
            stop = round(r_curr - 0.382 * height, 2)
            matched["symmetrical_triangle_breakout"] = {
                **base_scanner_result,
                "metric": f"Symmetric Triangle Breakout: LTP ₹{ltp:.1f} > ₹{r_curr:.1f} (+{((ltp-r_curr)/r_curr)*100:.1f}%) · Target ₹{target:.1f} · Stop ₹{stop:.1f}",
                "markers": [
                    {"time": t_top_start, "position": "aboveBar", "color": "#f87171", "shape": "circle", "text": "Falling Res"},
                    {"time": t_bot_start, "position": "belowBar", "color": "#34d399", "shape": "circle", "text": "Rising Sup"},
                    {"time": curr_time, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": f"Breakout ₹{r_curr:.1f}"}
                ],
                "drawings": make_triangle_drawings(
                    f"Symmetric Triangle Breakout · Target ₹{target:.1f}",
                    "breakout", t_top_start, p_top_start, r_curr,
                    t_bot_start, p_bot_start, s_curr,
                    None, r_curr, target, stop
                )
            }
        elif ltp < s_curr * 0.990:
            target = max(0, round(s_curr - height, 2))
            stop = round(s_curr + 0.382 * height, 2)
            matched["symmetrical_triangle_breakdown"] = {
                **base_scanner_result,
                "metric": f"Symmetric Triangle Breakdown: LTP ₹{ltp:.1f} < ₹{s_curr:.1f} · Target ₹{target:.1f} (-{height/s_curr*100:.1f}%) · Stop ₹{stop:.1f}",
                "markers": [
                    {"time": t_top_start, "position": "aboveBar", "color": "#f87171", "shape": "circle", "text": "Falling Res"},
                    {"time": t_bot_start, "position": "belowBar", "color": "#34d399", "shape": "circle", "text": "Rising Sup"},
                    {"time": curr_time, "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": f"Breakdown ₹{s_curr:.1f}"}
                ],
                "drawings": make_triangle_drawings(
                    f"Symmetric Triangle Breakdown · Target ₹{target:.1f}",
                    "breakdown", t_top_start, p_top_start, r_curr,
                    t_bot_start, p_bot_start, s_curr,
                    s_curr, None, target, stop
                )
            }
        elif s_curr * 0.99 <= ltp <= r_curr * 1.01:
            matched["symmetrical_triangle"] = {
                **base_scanner_result,
                "metric": f"Symmetric Triangle Coil (Spread {spread_pct:.1f}%, Apex Converging ₹{s_curr:.1f} - ₹{r_curr:.1f})",
                "markers": [
                    {"time": t_top_start, "position": "aboveBar", "color": "#f87171", "shape": "circle", "text": "Falling Res"},
                    {"time": t_bot_start, "position": "belowBar", "color": "#34d399", "shape": "circle", "text": "Rising Sup"},
                    {"time": curr_time, "position": "belowBar", "color": "#38bdf8", "shape": "circle", "text": "Symmetric Coil"}
                ],
                "drawings": make_triangle_drawings(
                    "Symmetrical Triangle (Apex Coil)",
                    "active", t_top_start, p_top_start, r_curr,
                    t_bot_start, p_bot_start, s_curr,
                    None, None, None, None
                )
            }

    return matched

def _analyze_channels_for_stock(closes, highs, lows, dates, symbol, name, ltp, prev_close):
    """
    Parallel Channels & Rectangle Box Trading Engine.
    Detects Ascending, Descending, and Rectangle Channels + Breakouts/Breakdowns + Target lines.
    """
    n = len(closes)
    if n < 30:
        return {}

    lookback = min(90, n)
    sub_closes = closes[-lookback:]
    sub_highs = highs[-lookback:]
    sub_lows = lows[-lookback:]
    sub_dates = dates[-lookback:] if dates else []
    curr_time = sub_dates[-1] if sub_dates else ""
    m_len = len(sub_closes)
    curr_idx = m_len - 1

    w = 3
    p_highs = []
    p_lows = []
    for i in range(w, m_len - w):
        if all(sub_highs[i] >= sub_highs[i - k] and sub_highs[i] >= sub_highs[i + k] for k in range(1, w + 1)):
            p_highs.append((i, sub_highs[i]))
        if all(sub_lows[i] <= sub_lows[i - k] and sub_lows[i] <= sub_lows[i + k] for k in range(1, w + 1)):
            p_lows.append((i, sub_lows[i]))

    if m_len - w > 0:
        rh_idx = max(range(m_len - w, m_len), key=lambda x: sub_highs[x])
        if not p_highs or rh_idx != p_highs[-1][0]:
            p_highs.append((rh_idx, sub_highs[rh_idx]))
        rl_idx = min(range(m_len - w, m_len), key=lambda x: sub_lows[x])
        if not p_lows or rl_idx != p_lows[-1][0]:
            p_lows.append((rl_idx, sub_lows[rl_idx]))

    base_scanner_result = {
        "ltp": ltp,
        "change_pct": round(((ltp - prev_close) / prev_close) * 100.0, 2) if prev_close else 0.0,
        "volume": 0,
        "rsi": None
    }

    matched = {}

    def make_channel_drawings(title, c_top_start, c_top_price, r_c,
                              c_bot_start, c_bot_price, s_c,
                              top_color, bot_color, fill_color, target_price=None, stop_price=None):
        drawings = [{
            "type": "channel",
            "time1_top": c_top_start,
            "price1_top": c_top_price,
            "time2_top": curr_time,
            "price2_top": round(r_c, 2),
            "time1_bot": c_bot_start,
            "price1_bot": c_bot_price,
            "time2_bot": curr_time,
            "price2_bot": round(s_c, 2),
            "topColor": top_color,
            "botColor": bot_color,
            "fillColor": fill_color,
            "name": title
        }]
        if target_price:
            drawings.append({
                "type": "trendline",
                "time1": curr_time,
                "price1": round(target_price, 2),
                "time2": curr_time,
                "futureOffset2": 15,
                "price2": round(target_price, 2),
                "color": "#10b981" if target_price > ltp else "#ef4444",
                "lineWidth": 1.5,
                "lineStyle": "dashed",
                "name": f"🎯 Target ₹{target_price:.1f}"
            })
        if stop_price:
            drawings.append({
                "type": "trendline",
                "time1": curr_time,
                "price1": round(stop_price, 2),
                "time2": curr_time,
                "futureOffset2": 12,
                "price2": round(stop_price, 2),
                "color": "#f59e0b",
                "lineWidth": 1.5,
                "lineStyle": "dashed",
                "name": f"🛑 Stop ₹{stop_price:.1f}"
            })
        return drawings

    # Search for best channel
    best_channel = None
    for hi in range(len(p_highs)):
        for hj in range(hi + 1, len(p_highs)):
            hx1, hy1 = p_highs[hi]
            hx2, hy2 = p_highs[hj]
            h_dx = hx2 - hx1
            if h_dx < 6: continue
            rm = (hy2 - hy1) / float(h_dx)
            rc = hy1 - rm * hx1
            r_c = rm * curr_idx + rc
            r_s = (rm / hy1) * 100.0

            for li in range(len(p_lows)):
                for lj in range(li + 1, len(p_lows)):
                    lx1, ly1 = p_lows[li]
                    lx2, ly2 = p_lows[lj]
                    l_dx = lx2 - lx1
                    if l_dx < 6: continue
                    sm = (ly2 - ly1) / float(l_dx)
                    sc = ly1 - sm * lx1
                    s_c = sm * curr_idx + sc
                    s_s = (sm / ly1) * 100.0

                    if r_c > s_c:
                        slope_diff = abs(r_s - s_s)
                        width_pct = ((r_c - s_c) / s_c) * 100.0
                        if 2.5 <= width_pct <= 30.0:
                            touches = sum(1 for idx in range(hx1, curr_idx) if abs(sub_highs[idx] - (rm*idx+rc))/(rm*idx+rc) <= 0.018) +                                       sum(1 for idx in range(lx1, curr_idx) if abs(sub_lows[idx] - (sm*idx+sc))/(sm*idx+sc) <= 0.018)
                            if best_channel is None or touches > best_channel['touches']:
                                best_channel = {
                                    'r_s': r_s, 's_s': s_s, 'r_c': r_c, 's_c': s_c,
                                    'hx1': hx1, 'hy1': hy1, 'lx1': lx1, 'ly1': ly1,
                                    'width_pct': width_pct, 'slope_diff': slope_diff,
                                    'touches': touches
                                }

    if best_channel:
        r_s = best_channel['r_s']
        s_s = best_channel['s_s']
        r_c = best_channel['r_c']
        s_c = best_channel['s_c']
        width_pct = best_channel['width_pct']
        slope_diff = best_channel['slope_diff']
        c_w = r_c - s_c

        c_top_start = sub_dates[best_channel['hx1']] if best_channel['hx1'] < len(sub_dates) else curr_time
        c_top_price = round(best_channel['hy1'], 2)
        c_bot_start = sub_dates[best_channel['lx1']] if best_channel['lx1'] < len(sub_dates) else curr_time
        c_bot_price = round(best_channel['ly1'], 2)

        # 1. Ascending Channel (r_s > 0.05 and s_s > 0.05 and slope_diff <= 0.18)
        if r_s > 0.05 and s_s > 0.05 and slope_diff <= 0.18:
            if ltp > r_c * 1.01:
                tgt = round(r_c + c_w, 2)
                matched["ascending_channel_breakout"] = {
                    **base_scanner_result,
                    "metric": f"Ascending Channel Breakout: LTP ₹{ltp:.1f} > ₹{r_c:.1f} · Target ₹{tgt:.1f}",
                    "markers": [{"time": curr_time, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "Channel Breakout"}],
                    "drawings": make_channel_drawings("Ascending Channel Breakout", c_top_start, c_top_price, r_c, c_bot_start, c_bot_price, s_c, "#10b981", "#10b981", "rgba(16, 185, 129, 0.12)", target_price=tgt)
                }
            elif ltp < s_c * 0.985:
                tgt = max(0, round(s_c - c_w, 2))
                matched["ascending_channel_breakdown"] = {
                    **base_scanner_result,
                    "metric": f"Ascending Channel Breakdown: LTP ₹{ltp:.1f} < ₹{s_c:.1f} · Target ₹{tgt:.1f}",
                    "markers": [{"time": curr_time, "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": "Channel Breakdown"}],
                    "drawings": make_channel_drawings("Ascending Channel Breakdown", c_top_start, c_top_price, r_c, c_bot_start, c_bot_price, s_c, "#ef5350", "#ef5350", "rgba(239, 68, 68, 0.12)", target_price=tgt)
                }
            elif s_c * 0.985 <= ltp <= r_c * 1.015:
                matched["ascending_channel"] = {
                    **base_scanner_result,
                    "metric": f"Active Ascending Channel (Slope +{((r_s+s_s)/2):.2f}%, Band ₹{s_c:.1f} - ₹{r_c:.1f})",
                    "markers": [{"time": curr_time, "position": "belowBar", "color": "#38bdf8", "shape": "circle", "text": "Ascending Channel"}],
                    "drawings": make_channel_drawings("Ascending Channel", c_top_start, c_top_price, r_c, c_bot_start, c_bot_price, s_c, "#38bdf8", "#38bdf8", "rgba(56, 189, 248, 0.10)")
                }

        # 2. Descending Channel (r_s < -0.05 and s_s < -0.05 and slope_diff <= 0.18)
        elif r_s < -0.05 and s_s < -0.05 and slope_diff <= 0.18:
            if ltp > r_c * 1.01:
                tgt = round(r_c + c_w, 2)
                matched["descending_channel_breakout"] = {
                    **base_scanner_result,
                    "metric": f"Descending Channel Breakout: LTP ₹{ltp:.1f} > ₹{r_c:.1f} · Target ₹{tgt:.1f}",
                    "markers": [{"time": curr_time, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "Reversal Breakout"}],
                    "drawings": make_channel_drawings("Descending Channel Breakout", c_top_start, c_top_price, r_c, c_bot_start, c_bot_price, s_c, "#10b981", "#10b981", "rgba(16, 185, 129, 0.12)", target_price=tgt)
                }
            elif ltp < s_c * 0.985:
                tgt = max(0, round(s_c - c_w, 2))
                matched["descending_channel_breakdown"] = {
                    **base_scanner_result,
                    "metric": f"Descending Channel Breakdown: LTP ₹{ltp:.1f} < ₹{s_c:.1f} · Target ₹{tgt:.1f}",
                    "markers": [{"time": curr_time, "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": "Channel Breakdown"}],
                    "drawings": make_channel_drawings("Descending Channel Breakdown", c_top_start, c_top_price, r_c, c_bot_start, c_bot_price, s_c, "#ef5350", "#ef5350", "rgba(239, 68, 68, 0.12)", target_price=tgt)
                }
            elif s_c * 0.985 <= ltp <= r_c * 1.015:
                matched["descending_channel"] = {
                    **base_scanner_result,
                    "metric": f"Active Descending Channel (Slope {((r_s+s_s)/2):.2f}%, Band ₹{s_c:.1f} - ₹{r_c:.1f})",
                    "markers": [{"time": curr_time, "position": "belowBar", "color": "#38bdf8", "shape": "circle", "text": "Descending Channel"}],
                    "drawings": make_channel_drawings("Descending Channel", c_top_start, c_top_price, r_c, c_bot_start, c_bot_price, s_c, "#f43f5e", "#f43f5e", "rgba(244, 63, 94, 0.10)")
                }

        # 3. Rectangle Channel (Flat slope abs <= 0.08)
        elif abs(r_s) <= 0.08 and abs(s_s) <= 0.08:
            if ltp > r_c * 1.01:
                tgt = round(r_c + c_w, 2)
                matched["rectangle_channel_breakout"] = {
                    **base_scanner_result,
                    "metric": f"Rectangle Range Breakout: LTP ₹{ltp:.1f} > Ceiling ₹{r_c:.1f} · Target ₹{tgt:.1f}",
                    "markers": [{"time": curr_time, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "Rectangle Breakout"}],
                    "drawings": make_channel_drawings("Rectangle Range Breakout", c_top_start, c_top_price, r_c, c_bot_start, c_bot_price, s_c, "#10b981", "#10b981", "rgba(16, 185, 129, 0.12)", target_price=tgt)
                }
            elif ltp < s_c * 0.985:
                tgt = max(0, round(s_c - c_w, 2))
                matched["rectangle_channel_breakdown"] = {
                    **base_scanner_result,
                    "metric": f"Rectangle Range Breakdown: LTP ₹{ltp:.1f} < Floor ₹{s_c:.1f} · Target ₹{tgt:.1f}",
                    "markers": [{"time": curr_time, "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": "Rectangle Breakdown"}],
                    "drawings": make_channel_drawings("Rectangle Range Breakdown", c_top_start, c_top_price, r_c, c_bot_start, c_bot_price, s_c, "#ef5350", "#ef5350", "rgba(239, 68, 68, 0.12)", target_price=tgt)
                }
            elif s_c * 0.99 <= ltp <= r_c * 1.01:
                matched["rectangle_channel"] = {
                    **base_scanner_result,
                    "metric": f"Active Rectangle Range (Floor ₹{s_c:.1f} · Ceiling ₹{r_c:.1f}, Width {width_pct:.1f}%)",
                    "markers": [{"time": curr_time, "position": "belowBar", "color": "#38bdf8", "shape": "circle", "text": "In Rectangle"}],
                    "drawings": make_channel_drawings("Rectangle Channel", c_top_start, c_top_price, r_c, c_bot_start, c_bot_price, s_c, "#6366f1", "#6366f1", "rgba(99, 102, 241, 0.10)")
                }
                if abs(ltp - s_c) / s_c <= 0.02 or abs(ltp - r_c) / r_c <= 0.02:
                    matched["rectangle_channel_potential"] = {
                        **base_scanner_result,
                        "metric": f"Testing Rectangle Boundary Zone (LTP ₹{ltp:.1f} near Band)",
                        "markers": [{"time": curr_time, "position": "belowBar" if abs(ltp - s_c) < abs(ltp - r_c) else "aboveBar", "color": "#f59e0b", "shape": "circle", "text": "Boundary Test"}],
                        "drawings": make_channel_drawings("Rectangle Boundary Zone", c_top_start, c_top_price, r_c, c_bot_start, c_bot_price, s_c, "#f59e0b", "#f59e0b", "rgba(245, 158, 11, 0.10)")
                    }

    return matched

def _analyze_nr_wr_for_stock(closes, highs, lows, opens, dates, symbol, name, ltp, prev_close):
    """
    Toby Crabel Volatility Compression (NR) & Expansion (WR) Engine.
    Detects NR 4, 7, 11, 15 and WR 7, 14, 20 + Breakouts & Continuations.
    """
    n = len(closes)
    if n < 25:
        return {}

    curr_time = dates[-1] if dates else ""
    prev_time = dates[-2] if len(dates) >= 2 else curr_time

    ranges = [highs[i] - lows[i] for i in range(n)]
    curr_r = ranges[-1]
    prev_r = ranges[-2]
    prev_high = highs[-2]
    prev_low = lows[-2]

    base_scanner_result = {
        "ltp": ltp,
        "change_pct": round(((ltp - prev_close) / prev_close) * 100.0, 2) if prev_close else 0.0,
        "volume": 0,
        "rsi": None
    }

    matched = {}

    def test_nr(period, key_base):
        if len(ranges) >= period and curr_r < min(ranges[-period:-1]):
            m = dict(base_scanner_result)
            m["metric"] = f"NR {period} Squeeze: Range ₹{curr_r:.1f} is smallest of {period} bars"
            m["markers"] = [{"time": curr_time, "position": "belowBar", "color": "#f59e0b", "shape": "circle", "text": f"NR {period}"}]
            matched[key_base] = m
        elif len(ranges) >= period + 1 and prev_r < min(ranges[-(period + 1):-2]):
            if ltp > prev_high:
                m = dict(base_scanner_result)
                m["metric"] = f"NR {period} Bullish Breakout > Prev High ₹{prev_high:.1f} (LTP ₹{ltp:.1f})"
                m["markers"] = [
                    {"time": prev_time, "position": "belowBar", "color": "#f59e0b", "shape": "circle", "text": f"NR {period}"},
                    {"time": curr_time, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "Breakout"}
                ]
                matched[f"{key_base}_breakout"] = m
            elif ltp < prev_low:
                m = dict(base_scanner_result)
                m["metric"] = f"NR {period} Bearish Breakdown < Prev Low ₹{prev_low:.1f} (LTP ₹{ltp:.1f})"
                m["markers"] = [
                    {"time": prev_time, "position": "aboveBar", "color": "#f59e0b", "shape": "circle", "text": f"NR {period}"},
                    {"time": curr_time, "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": "Breakdown"}
                ]
                matched[f"{key_base}_breakdown"] = m

    def test_wr(period, key_base):
        if len(ranges) >= period and curr_r > max(ranges[-period:-1]):
            m = dict(base_scanner_result)
            m["metric"] = f"WR {period} Expansion: Range ₹{curr_r:.1f} is largest of {period} bars"
            m["markers"] = [{"time": curr_time, "position": "belowBar" if closes[-1] >= opens[-1] else "aboveBar", "color": "#8b5cf6", "shape": "circle", "text": f"WR {period}"}]
            matched[key_base] = m
        elif len(ranges) >= period + 1 and prev_r > max(ranges[-(period + 1):-2]):
            if ltp > prev_close and closes[-2] >= opens[-2]:
                m = dict(base_scanner_result)
                m["metric"] = f"WR {period} Bullish Continuation: Advancing past WR expansion bar"
                m["markers"] = [{"time": curr_time, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "Continuation"}]
                matched[f"{key_base}_bull_cont"] = m
            elif ltp < prev_close and closes[-2] <= opens[-2]:
                m = dict(base_scanner_result)
                m["metric"] = f"WR {period} Bearish Continuation: Selling follow-through past WR down-bar"
                m["markers"] = [{"time": curr_time, "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": "Continuation"}]
                matched[f"{key_base}_bear_cont"] = m

    test_nr(4, "nr4")
    test_nr(7, "nr7")
    test_nr(11, "nr11")
    test_nr(15, "nr15")

    test_wr(7, "wr7")
    test_wr(14, "wr14")
    test_wr(20, "wr20")

    return matched

def _analyze_chart_patterns_for_stock(closes, highs, lows, volumes, dates, symbol, name, ltp, prev_close):
    """
    Multi-Leg Classical Chart Pattern Engine (Upgraded Institutional Algorithm).
    Detects Double/Triple Tops & Bottoms, H&S, Flags, Cups, V-Patterns.
    Generates complete chart drawings: necklines, base/peak lines, target projections, and stop loss lines.
    """
    n = len(closes)
    if n < 40:
        return {}

    lookback = min(120, n)
    sub_closes = closes[-lookback:]
    sub_highs = highs[-lookback:]
    sub_lows = lows[-lookback:]
    sub_dates = dates[-lookback:] if dates else []
    curr_time = sub_dates[-1] if sub_dates else ""
    m_len = len(sub_closes)

    w = 3
    p_highs = []
    p_lows = []
    for i in range(w, m_len - w):
        if all(sub_highs[i] >= sub_highs[i - k] and sub_highs[i] >= sub_highs[i + k] for k in range(1, w + 1)):
            p_highs.append((i, sub_highs[i]))
        if all(sub_lows[i] <= sub_lows[i - k] and sub_lows[i] <= sub_lows[i + k] for k in range(1, w + 1)):
            p_lows.append((i, sub_lows[i]))

    if m_len - w > 0:
        rh_idx = max(range(m_len - w, m_len), key=lambda x: sub_highs[x])
        if not p_highs or rh_idx != p_highs[-1][0]:
            p_highs.append((rh_idx, sub_highs[rh_idx]))
        rl_idx = min(range(m_len - w, m_len), key=lambda x: sub_lows[x])
        if not p_lows or rl_idx != p_lows[-1][0]:
            p_lows.append((rl_idx, sub_lows[rl_idx]))

    base_scanner_result = {
        "ltp": ltp,
        "change_pct": round(((ltp - prev_close) / prev_close) * 100.0, 2) if prev_close else 0.0,
        "volume": volumes[-1] if volumes else 0,
        "rsi": None
    }

    matched = {}

    def make_target_stop_drawings(start_time, target_p, stop_p, is_bullish):
        lines = []
        if target_p:
            lines.append({
                "type": "trendline",
                "time1": start_time,
                "price1": round(target_p, 2),
                "time2": curr_time,
                "futureOffset2": 15,
                "price2": round(target_p, 2),
                "color": "#10b981" if is_bullish else "#ef4444",
                "lineWidth": 1.5,
                "lineStyle": "dashed",
                "name": f"🎯 Target ₹{target_p:.1f}"
            })
        if stop_p:
            lines.append({
                "type": "trendline",
                "time1": start_time,
                "price1": round(stop_p, 2),
                "time2": curr_time,
                "futureOffset2": 12,
                "price2": round(stop_p, 2),
                "color": "#f59e0b",
                "lineWidth": 1.5,
                "lineStyle": "dashed",
                "name": f"🛑 Stop ₹{stop_p:.1f}"
            })
        return lines

    # 1. Higher Highs & Higher Lows (Dow Theory Uptrend)
    if len(p_highs) >= 3 and len(p_lows) >= 3:
        h1, h2, h3 = p_highs[-3][1], p_highs[-2][1], p_highs[-1][1]
        l1, l2, l3 = p_lows[-3][1], p_lows[-2][1], p_lows[-1][1]
        if h3 > h2 > h1 and l3 > l2 > l1:
            m = dict(base_scanner_result)
            m["metric"] = f"Higher Highs & Higher Lows Uptrend (Swings: ₹{l3:.1f} > ₹{l2:.1f} > ₹{l1:.1f})"
            m["markers"] = [
                {"time": sub_dates[p_lows[-2][0]], "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "HL"},
                {"time": sub_dates[p_highs[-2][0]], "position": "aboveBar", "color": "#10b981", "shape": "arrowUp", "text": "HH"},
                {"time": sub_dates[p_lows[-1][0]], "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "HL"},
                {"time": sub_dates[p_highs[-1][0]], "position": "aboveBar", "color": "#10b981", "shape": "arrowUp", "text": "HH"}
            ]
            m["drawings"] = [
                {
                    "type": "trendline",
                    "time1": sub_dates[p_lows[-3][0]],
                    "price1": round(l1, 2),
                    "time2": curr_time,
                    "futureOffset2": 8,
                    "price2": round(l3, 2),
                    "color": "#10b981",
                    "lineWidth": 2,
                    "name": "Higher Lows Trendline"
                }
            ]
            matched["higher_highs_lows"] = m

    # 2. Lower Highs & Lower Lows (Dow Theory Downtrend)
    if len(p_highs) >= 3 and len(p_lows) >= 3:
        h1, h2, h3 = p_highs[-3][1], p_highs[-2][1], p_highs[-1][1]
        l1, l2, l3 = p_lows[-3][1], p_lows[-2][1], p_lows[-1][1]
        if h3 < h2 < h1 and l3 < l2 < l1:
            m = dict(base_scanner_result)
            m["metric"] = f"Lower Highs & Lower Lows Downtrend (Swings: ₹{h3:.1f} < ₹{h2:.1f} < ₹{h1:.1f})"
            m["markers"] = [
                {"time": sub_dates[p_highs[-2][0]], "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": "LH"},
                {"time": sub_dates[p_lows[-2][0]], "position": "belowBar", "color": "#ef5350", "shape": "arrowDown", "text": "LL"},
                {"time": sub_dates[p_highs[-1][0]], "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": "LH"},
                {"time": sub_dates[p_lows[-1][0]], "position": "belowBar", "color": "#ef5350", "shape": "arrowDown", "text": "LL"}
            ]
            m["drawings"] = [
                {
                    "type": "trendline",
                    "time1": sub_dates[p_highs[-3][0]],
                    "price1": round(h1, 2),
                    "time2": curr_time,
                    "futureOffset2": 8,
                    "price2": round(h3, 2),
                    "color": "#ef5350",
                    "lineWidth": 2,
                    "name": "Lower Highs Trendline"
                }
            ]
            matched["lower_highs_lows"] = m

    # 3. Double Bottom (Init, Potential, Confirmed Breakout)
    if len(p_lows) >= 2:
        idx1, l1 = p_lows[-2]
        idx2, l2 = p_lows[-1]
        mid_highs = [h for i, h in p_highs if idx1 < i < idx2]
        neckline = max(mid_highs) if mid_highs else (max(sub_highs[idx1:idx2]) if idx2 > idx1 else None)

        if neckline and abs(l1 - l2) / float(l1) <= 0.025:
            avg_base = (l1 + l2) / 2.0
            height = neckline - avg_base
            target = round(neckline + height, 2)
            stop = round(neckline - 0.382 * height, 2)

            t1 = sub_dates[idx1] if idx1 < len(sub_dates) else curr_time
            t2 = sub_dates[idx2] if idx2 < len(sub_dates) else curr_time

            base_drawings = [
                {
                    "type": "trendline",
                    "time1": t1,
                    "price1": round(neckline, 2),
                    "time2": curr_time,
                    "futureOffset2": 15,
                    "price2": round(neckline, 2),
                    "color": "#10b981",
                    "lineWidth": 2,
                    "name": f"Neckline ₹{neckline:.1f}"
                },
                {
                    "type": "trendline",
                    "time1": t1,
                    "price1": round(l1, 2),
                    "time2": t2,
                    "price2": round(l2, 2),
                    "color": "#34d399",
                    "lineWidth": 1.5,
                    "name": f"Double Bottom Base ~₹{avg_base:.1f}"
                }
            ]

            db_markers = [
                {"time": t1, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": f"Bottom 1 ₹{l1:.1f}"},
                {"time": t2, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": f"Bottom 2 ₹{l2:.1f}"}
            ]
            if ltp > neckline * 1.008:
                m = dict(base_scanner_result)
                m["metric"] = f"Double Bottom Confirmed: Breakout > Neckline ₹{neckline:.1f} · Target ₹{target:.1f} (+{((target-ltp)/ltp)*100:.1f}%) · Stop ₹{stop:.1f}"
                m["markers"] = db_markers + [{"time": curr_time, "position": "belowBar", "color": "#3b82f6", "shape": "circle", "text": f"Breakout ₹{neckline:.1f}"}]
                m["drawings"] = base_drawings + make_target_stop_drawings(curr_time, target, stop, True)
                matched["double_bottom"] = m
            elif ltp > l2 and ltp <= neckline:
                m = dict(base_scanner_result)
                m["metric"] = f"Double Bottom Potential: Rebounding from Trough ₹{l2:.1f} toward Neckline ₹{neckline:.1f}"
                m["markers"] = db_markers
                m["drawings"] = base_drawings
                matched["double_bottom_potential"] = m
            elif abs(ltp - l2) / float(l2) <= 0.015:
                m = dict(base_scanner_result)
                m["metric"] = f"Double Bottom Init: Testing Support Base around ₹{l2:.1f}"
                m["markers"] = db_markers
                m["drawings"] = base_drawings
                matched["double_bottom_init"] = m

    # 4. Double Top (Init, Potential, Confirmed Breakdown)
    if len(p_highs) >= 2:
        idx1, h1 = p_highs[-2]
        idx2, h2 = p_highs[-1]
        mid_lows = [l for i, l in p_lows if idx1 < i < idx2]
        neckline = min(mid_lows) if mid_lows else (min(sub_lows[idx1:idx2]) if idx2 > idx1 else None)

        if neckline and abs(h1 - h2) / float(h1) <= 0.025:
            avg_peak = (h1 + h2) / 2.0
            height = avg_peak - neckline
            target = max(0, round(neckline - height, 2))
            stop = round(neckline + 0.382 * height, 2)

            t1 = sub_dates[idx1] if idx1 < len(sub_dates) else curr_time
            t2 = sub_dates[idx2] if idx2 < len(sub_dates) else curr_time

            base_drawings = [
                {
                    "type": "trendline",
                    "time1": t1,
                    "price1": round(neckline, 2),
                    "time2": curr_time,
                    "futureOffset2": 15,
                    "price2": round(neckline, 2),
                    "color": "#ef4444",
                    "lineWidth": 2,
                    "name": f"Neckline ₹{neckline:.1f}"
                },
                {
                    "type": "trendline",
                    "time1": t1,
                    "price1": round(h1, 2),
                    "time2": t2,
                    "price2": round(h2, 2),
                    "color": "#f87171",
                    "lineWidth": 1.5,
                    "name": f"Double Top Peaks ~₹{avg_peak:.1f}"
                }
            ]

            dt_markers = [
                {"time": t1, "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": f"Top 1 ₹{h1:.1f}"},
                {"time": t2, "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": f"Top 2 ₹{h2:.1f}"}
            ]
            if ltp < neckline * 0.992:
                m = dict(base_scanner_result)
                m["metric"] = f"Double Top Confirmed: Breakdown < Neckline ₹{neckline:.1f} · Target ₹{target:.1f} (-{((ltp-target)/ltp)*100:.1f}%) · Stop ₹{stop:.1f}"
                m["markers"] = dt_markers + [{"time": curr_time, "position": "aboveBar", "color": "#f59e0b", "shape": "circle", "text": f"Breakdown ₹{neckline:.1f}"}]
                m["drawings"] = base_drawings + make_target_stop_drawings(curr_time, target, stop, False)
                matched["double_top"] = m
            elif ltp < h2 and ltp >= neckline:
                m = dict(base_scanner_result)
                m["metric"] = f"Double Top Potential: Declining from Peak ₹{h2:.1f} toward Neckline ₹{neckline:.1f}"
                m["markers"] = dt_markers
                m["drawings"] = base_drawings
                matched["double_top_potential"] = m
            elif abs(ltp - h2) / float(h2) <= 0.015:
                m = dict(base_scanner_result)
                m["metric"] = f"Double Top Init: Testing Resistance Ceiling around ₹{h2:.1f}"
                m["markers"] = dt_markers
                m["drawings"] = base_drawings
                matched["double_top_init"] = m

    # 5. Triple Bottom (Potential & Confirmed)
    if len(p_lows) >= 3:
        l1, l2, l3 = p_lows[-3][1], p_lows[-2][1], p_lows[-1][1]
        spread = (max(l1, l2, l3) - min(l1, l2, l3)) / float(min(l1, l2, l3))
        if spread <= 0.03:
            nl = max(p_highs[-2][1], p_highs[-1][1]) if len(p_highs) >= 2 else max(l1, l2, l3) * 1.05
            height = nl - min(l1, l2, l3)
            target = round(nl + height, 2)
            stop = round(nl - 0.382 * height, 2)
            tb_markers = [
                {"time": sub_dates[p_lows[-3][0]], "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "Trough 1"},
                {"time": sub_dates[p_lows[-2][0]], "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "Trough 2"},
                {"time": sub_dates[p_lows[-1][0]], "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "Trough 3"}
            ]
            tb_drawings = [
                {"type": "trendline", "time1": sub_dates[p_lows[-3][0]], "price1": round(nl, 2), "time2": curr_time, "futureOffset2": 15, "price2": round(nl, 2), "color": "#10b981", "lineWidth": 2, "name": f"Neckline ₹{nl:.1f}"}
            ]
            if ltp > nl * 1.008:
                m = dict(base_scanner_result)
                m["metric"] = f"Triple Bottom Confirmed: Breakout > Neckline ₹{nl:.1f} · Target ₹{target:.1f} · Stop ₹{stop:.1f}"
                m["markers"] = tb_markers + [{"time": curr_time, "position": "belowBar", "color": "#3b82f6", "shape": "circle", "text": "Breakout"}]
                m["drawings"] = tb_drawings + make_target_stop_drawings(curr_time, target, stop, True)
                matched["triple_bottom"] = m
            elif ltp > l3 and ltp <= nl:
                m = dict(base_scanner_result)
                m["metric"] = f"Triple Bottom Potential: Bouncing off 3rd Low ₹{l3:.1f}"
                m["markers"] = tb_markers
                m["drawings"] = tb_drawings
                matched["triple_bottom_potential"] = m

    # 6. Triple Top (Potential & Confirmed)
    if len(p_highs) >= 3:
        h1, h2, h3 = p_highs[-3][1], p_highs[-2][1], p_highs[-1][1]
        spread = (max(h1, h2, h3) - min(h1, h2, h3)) / float(min(h1, h2, h3))
        if spread <= 0.03:
            nl = min(p_lows[-2][1], p_lows[-1][1]) if len(p_lows) >= 2 else min(h1, h2, h3) * 0.95
            height = max(h1, h2, h3) - nl
            target = max(0, round(nl - height, 2))
            stop = round(nl + 0.382 * height, 2)
            tt_markers = [
                {"time": sub_dates[p_highs[-3][0]], "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": "Peak 1"},
                {"time": sub_dates[p_highs[-2][0]], "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": "Peak 2"},
                {"time": sub_dates[p_highs[-1][0]], "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": "Peak 3"}
            ]
            tt_drawings = [
                {"type": "trendline", "time1": sub_dates[p_highs[-3][0]], "price1": round(nl, 2), "time2": curr_time, "futureOffset2": 15, "price2": round(nl, 2), "color": "#ef4444", "lineWidth": 2, "name": f"Neckline ₹{nl:.1f}"}
            ]
            if ltp < nl * 0.992:
                m = dict(base_scanner_result)
                m["metric"] = f"Triple Top Confirmed: Breakdown < Neckline ₹{nl:.1f} · Target ₹{target:.1f} · Stop ₹{stop:.1f}"
                m["markers"] = tt_markers + [{"time": curr_time, "position": "aboveBar", "color": "#f59e0b", "shape": "circle", "text": "Breakdown"}]
                m["drawings"] = tt_drawings + make_target_stop_drawings(curr_time, target, stop, False)
                matched["triple_top"] = m
            elif ltp < h3 and ltp >= nl:
                m = dict(base_scanner_result)
                m["metric"] = f"Triple Top Potential: Falling from 3rd Peak ₹{h3:.1f}"
                m["markers"] = tt_markers
                m["drawings"] = tt_drawings
                matched["triple_top_potential"] = m

    # 7. Head & Shoulders & Reverse H&S
    if len(p_highs) >= 3 and len(p_lows) >= 2:
        s1, head, s2 = p_highs[-3][1], p_highs[-2][1], p_highs[-1][1]
        if head > s1 and head > s2 and abs(s1 - s2) / float(s1) <= 0.05:
            nl = (p_lows[-2][1] + p_lows[-1][1]) / 2.0
            height = head - nl
            target = max(0, round(nl - height, 2))
            stop = round(s2, 2)
            hs_markers = [
                {"time": sub_dates[p_highs[-3][0]], "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": f"L-Shoulder ₹{s1:.1f}"},
                {"time": sub_dates[p_highs[-2][0]], "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": f"Head ₹{head:.1f}"},
                {"time": sub_dates[p_highs[-1][0]], "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": f"R-Shoulder ₹{s2:.1f}"}
            ]
            hs_drawings = [
                {"type": "trendline", "time1": sub_dates[p_lows[-2][0]], "price1": round(p_lows[-2][1], 2), "time2": curr_time, "futureOffset2": 15, "price2": round(p_lows[-1][1], 2), "color": "#ef4444", "lineWidth": 2, "name": f"Neckline ₹{nl:.1f}"}
            ]
            if ltp < nl * 0.992:
                m = dict(base_scanner_result)
                m["metric"] = f"Head & Shoulder Breakdown < Neckline ₹{nl:.1f} · Target ₹{target:.1f} · Stop ₹{stop:.1f}"
                m["markers"] = hs_markers + [{"time": curr_time, "position": "aboveBar", "color": "#f59e0b", "shape": "circle", "text": "Breakdown"}]
                m["drawings"] = hs_drawings + make_target_stop_drawings(curr_time, target, stop, False)
                matched["head_shoulder"] = m
            elif ltp < s2 and ltp >= nl:
                m = dict(base_scanner_result)
                m["metric"] = f"Head & Shoulder Potential: Right Shoulder Rejection at ₹{s2:.1f}"
                m["markers"] = hs_markers
                m["drawings"] = hs_drawings
                matched["head_shoulder_potential"] = m

    if len(p_lows) >= 3 and len(p_highs) >= 2:
        s1, head, s2 = p_lows[-3][1], p_lows[-2][1], p_lows[-1][1]
        if head < s1 and head < s2 and abs(s1 - s2) / float(s1) <= 0.05:
            nl = (p_highs[-2][1] + p_highs[-1][1]) / 2.0
            height = nl - head
            target = round(nl + height, 2)
            stop = round(s2, 2)
            rhs_markers = [
                {"time": sub_dates[p_lows[-3][0]], "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": f"L-Shoulder ₹{s1:.1f}"},
                {"time": sub_dates[p_lows[-2][0]], "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": f"Head ₹{head:.1f}"},
                {"time": sub_dates[p_lows[-1][0]], "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": f"R-Shoulder ₹{s2:.1f}"}
            ]
            rhs_drawings = [
                {"type": "trendline", "time1": sub_dates[p_highs[-2][0]], "price1": round(p_highs[-2][1], 2), "time2": curr_time, "futureOffset2": 15, "price2": round(p_highs[-1][1], 2), "color": "#10b981", "lineWidth": 2, "name": f"Neckline ₹{nl:.1f}"}
            ]
            if ltp > nl * 1.008:
                m = dict(base_scanner_result)
                m["metric"] = f"Reverse Head & Shoulder Breakout > Neckline ₹{nl:.1f} · Target ₹{target:.1f} · Stop ₹{stop:.1f}"
                m["markers"] = rhs_markers + [{"time": curr_time, "position": "belowBar", "color": "#3b82f6", "shape": "circle", "text": "Breakout"}]
                m["drawings"] = rhs_drawings + make_target_stop_drawings(curr_time, target, stop, True)
                matched["reverse_head_shoulder"] = m
            elif ltp > s2 and ltp <= nl:
                m = dict(base_scanner_result)
                m["metric"] = f"Reverse H&S Potential: Right Shoulder Bouncing at ₹{s2:.1f}"
                m["markers"] = rhs_markers
                m["drawings"] = rhs_drawings
                matched["reverse_head_shoulder_potential"] = m

    # 8. V Pattern & Inverse V Pattern
    if m_len >= 12:
        min_10 = min(sub_lows[-10:-4]) if len(sub_lows) >= 10 else min(sub_lows)
        recent_max = max(sub_highs[-4:])
        prior_max = max(sub_highs[-12:-8]) if len(sub_highs) >= 12 else sub_highs[0]
        if prior_max > 0 and min_10 > 0:
            drop_pct = (prior_max - min_10) / float(prior_max)
            rec_pct = (recent_max - min_10) / float(min_10)
            if drop_pct >= 0.06 and rec_pct >= 0.05 and abs(drop_pct - rec_pct) <= 0.035:
                m = dict(base_scanner_result)
                m["metric"] = f"V Pattern Recovery: Rapid V-Bottom Recovery from ₹{min_10:.1f} to ₹{ltp:.1f}"
                m["markers"] = [
                    {"time": sub_dates[-7] if len(sub_dates) >= 7 else curr_time, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "V-Bottom"},
                    {"time": curr_time, "position": "belowBar", "color": "#3b82f6", "shape": "circle", "text": "Recovery"}
                ]
                m["drawings"] = [
                    {"type": "trendline", "time1": sub_dates[-10] if len(sub_dates) >= 10 else curr_time, "price1": round(prior_max, 2), "time2": sub_dates[-7] if len(sub_dates) >= 7 else curr_time, "price2": round(min_10, 2), "color": "#ef5350", "lineWidth": 1.5, "name": "V Drop"},
                    {"type": "trendline", "time1": sub_dates[-7] if len(sub_dates) >= 7 else curr_time, "price1": round(min_10, 2), "time2": curr_time, "price2": round(ltp, 2), "color": "#10b981", "lineWidth": 2, "name": "V Rally"}
                ]
                matched["v_pattern"] = m

        max_10 = max(sub_highs[-10:-4])
        recent_min = min(sub_lows[-4:])
        prior_min = min(sub_lows[-12:-8]) if len(sub_lows) >= 12 else sub_lows[0]
        if prior_min > 0 and max_10 > 0:
            rally_pct = (max_10 - prior_min) / float(prior_min)
            dump_pct = (max_10 - recent_min) / float(max_10)
            if rally_pct >= 0.06 and dump_pct >= 0.05 and abs(rally_pct - dump_pct) <= 0.035:
                m = dict(base_scanner_result)
                m["metric"] = f"Inverse V Pattern: Rapid Spike & Rejection from Peak ₹{max_10:.1f}"
                m["markers"] = [
                    {"time": sub_dates[-7] if len(sub_dates) >= 7 else curr_time, "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": "V-Top"},
                    {"time": curr_time, "position": "aboveBar", "color": "#ef5350", "shape": "circle", "text": "Rejection"}
                ]
                m["drawings"] = [
                    {"type": "trendline", "time1": sub_dates[-10] if len(sub_dates) >= 10 else curr_time, "price1": round(prior_min, 2), "time2": sub_dates[-7] if len(sub_dates) >= 7 else curr_time, "price2": round(max_10, 2), "color": "#10b981", "lineWidth": 1.5, "name": "Spike"},
                    {"type": "trendline", "time1": sub_dates[-7] if len(sub_dates) >= 7 else curr_time, "price1": round(max_10, 2), "time2": curr_time, "price2": round(ltp, 2), "color": "#ef5350", "lineWidth": 2, "name": "Rejection"}
                ]
                matched["inverse_v_pattern"] = m

    # 9. Bullish & Bearish Flags & Pennants
    if m_len >= 20:
        pole_base = sub_lows[-20]
        pole_top = max(sub_highs[-18:-8])
        pole_gain = ((pole_top - pole_base) / float(pole_base)) if pole_base else 0
        if pole_gain >= 0.07:
            recent_high = max(sub_highs[-8:])
            recent_low = min(sub_lows[-8:])
            tgt_flag = round(ltp + (pole_top - pole_base), 2)
            flag_drawings = [
                {"type": "trendline", "time1": sub_dates[-20], "price1": round(pole_base, 2), "time2": sub_dates[-12], "price2": round(pole_top, 2), "color": "#3b82f6", "lineWidth": 2.5, "name": f"Flagpole +{pole_gain*100:.1f}%"},
                {"type": "trendline", "time1": sub_dates[-8], "price1": round(recent_high, 2), "time2": curr_time, "futureOffset2": 6, "price2": round(recent_high, 2), "color": "#6366f1", "lineWidth": 1.5, "name": "Flag Ceiling"},
                {"type": "trendline", "time1": sub_dates[-8], "price1": round(recent_low, 2), "time2": curr_time, "futureOffset2": 6, "price2": round(recent_low, 2), "color": "#6366f1", "lineWidth": 1.5, "name": "Flag Floor"}
            ]
            if ltp > recent_high * 0.995:
                m = dict(base_scanner_result)
                m["metric"] = f"Bullish Flag Breakout: Flagpole +{pole_gain*100:.1f}% · Breakout at ₹{ltp:.1f} · Target ₹{tgt_flag:.1f}"
                m["markers"] = [
                    {"time": sub_dates[-15] if len(sub_dates) >= 15 else curr_time, "position": "belowBar", "color": "#3b82f6", "shape": "circle", "text": "Flagpole"},
                    {"time": curr_time, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": f"Flag Breakout ₹{ltp:.1f}"}
                ]
                m["drawings"] = flag_drawings + make_target_stop_drawings(curr_time, tgt_flag, round(recent_low, 2), True)
                matched["bullish_flag"] = m
            else:
                m = dict(base_scanner_result)
                m["metric"] = f"Bullish Pennant Consolidation (Pole +{pole_gain*100:.1f}%, tight coil ₹{recent_low:.1f} - ₹{recent_high:.1f})"
                m["markers"] = [
                    {"time": sub_dates[-15] if len(sub_dates) >= 15 else curr_time, "position": "belowBar", "color": "#3b82f6", "shape": "circle", "text": "Pennant Pole"},
                    {"time": curr_time, "position": "belowBar", "color": "#38bdf8", "shape": "circle", "text": "Pennant Coil"}
                ]
                m["drawings"] = flag_drawings
                matched["bullish_pennant"] = m

        pole_top_b = sub_highs[-20]
        pole_base_b = min(sub_lows[-18:-8])
        pole_drop = ((pole_top_b - pole_base_b) / float(pole_top_b)) if pole_top_b else 0
        if pole_drop >= 0.07:
            recent_high_b = max(sub_highs[-8:])
            recent_low_b = min(sub_lows[-8:])
            tgt_flag_b = max(0, round(ltp - (pole_top_b - pole_base_b), 2))
            flag_drawings_b = [
                {"type": "trendline", "time1": sub_dates[-20], "price1": round(pole_top_b, 2), "time2": sub_dates[-12], "price2": round(pole_base_b, 2), "color": "#ef5350", "lineWidth": 2.5, "name": f"Flagpole -{pole_drop*100:.1f}%"},
                {"type": "trendline", "time1": sub_dates[-8], "price1": round(recent_high_b, 2), "time2": curr_time, "futureOffset2": 6, "price2": round(recent_high_b, 2), "color": "#f59e0b", "lineWidth": 1.5, "name": "Flag Ceiling"},
                {"type": "trendline", "time1": sub_dates[-8], "price1": round(recent_low_b, 2), "time2": curr_time, "futureOffset2": 6, "price2": round(recent_low_b, 2), "color": "#f59e0b", "lineWidth": 1.5, "name": "Flag Floor"}
            ]
            if ltp < recent_low_b * 1.005:
                m = dict(base_scanner_result)
                m["metric"] = f"Bearish Flag Breakdown: Dump -{pole_drop*100:.1f}% · Breakdown at ₹{ltp:.1f} · Target ₹{tgt_flag_b:.1f}"
                m["markers"] = [
                    {"time": sub_dates[-15] if len(sub_dates) >= 15 else curr_time, "position": "aboveBar", "color": "#ef5350", "shape": "circle", "text": "Flagpole"},
                    {"time": curr_time, "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": f"Flag Breakdown ₹{ltp:.1f}"}
                ]
                m["drawings"] = flag_drawings_b + make_target_stop_drawings(curr_time, tgt_flag_b, round(recent_high_b, 2), False)
                matched["bearish_flag"] = m
            else:
                m = dict(base_scanner_result)
                m["metric"] = f"Bearish Pennant Consolidation (Dump -{pole_drop*100:.1f}%, coil ₹{recent_low_b:.1f} - ₹{recent_high_b:.1f})"
                m["markers"] = [
                    {"time": sub_dates[-15] if len(sub_dates) >= 15 else curr_time, "position": "aboveBar", "color": "#ef5350", "shape": "circle", "text": "Pennant Pole"},
                    {"time": curr_time, "position": "aboveBar", "color": "#f59e0b", "shape": "circle", "text": "Pennant Coil"}
                ]
                m["drawings"] = flag_drawings_b
                matched["bearish_pennant"] = m

    # 10. Cup and Handle & Rounding Bottom
    if m_len >= 45:
        rim_left = max(sub_highs[-45:-30])
        bottom_val = min(sub_lows[-30:-12])
        rim_right = max(sub_highs[-12:-4])
        depth = (rim_left - bottom_val) / float(rim_left) if rim_left else 0
        rim_diff = abs(rim_left - rim_right) / float(rim_left) if rim_left else 1
        if 0.06 <= depth <= 0.35 and rim_diff <= 0.045:
            tgt_cup = round(rim_right + (rim_left - bottom_val), 2)
            cup_drawings = [
                {"type": "trendline", "time1": sub_dates[-40], "price1": round(rim_left, 2), "time2": curr_time, "futureOffset2": 15, "price2": round(rim_right, 2), "color": "#10b981", "lineWidth": 2, "name": f"Cup Rim ₹{rim_right:.1f}"},
                {"type": "trendline", "time1": sub_dates[-30], "price1": round(bottom_val, 2), "time2": sub_dates[-15], "price2": round(bottom_val, 2), "color": "#6366f1", "lineWidth": 1.5, "lineStyle": "dashed", "name": f"Cup Base ₹{bottom_val:.1f}"}
            ]
            handle_low = min(sub_lows[-4:])
            if handle_low >= bottom_val + (rim_left - bottom_val) * 0.5:
                if ltp >= rim_right * 0.995:
                    m = dict(base_scanner_result)
                    m["metric"] = f"Cup and Handle Breakout: Base depth -{depth*100:.1f}%, Breakout > Rim ₹{rim_right:.1f} · Target ₹{tgt_cup:.1f}"
                    m["markers"] = [
                        {"time": sub_dates[-22] if len(sub_dates) >= 22 else curr_time, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "Cup Base"},
                        {"time": sub_dates[-3] if len(sub_dates) >= 3 else curr_time, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "Handle Low"},
                        {"time": curr_time, "position": "belowBar", "color": "#3b82f6", "shape": "circle", "text": "Cup Breakout"}
                    ]
                    m["drawings"] = cup_drawings + make_target_stop_drawings(curr_time, tgt_cup, round(handle_low, 2), True)
                    matched["cup_and_handle"] = m
                else:
                    m = dict(base_scanner_result)
                    m["metric"] = f"Rounding Bottom Base (Saucer Accumulation, Base ₹{bottom_val:.1f} to Rim ₹{rim_left:.1f})"
                    m["markers"] = [
                        {"time": sub_dates[-22] if len(sub_dates) >= 22 else curr_time, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "Saucer Base"},
                        {"time": curr_time, "position": "belowBar", "color": "#38bdf8", "shape": "circle", "text": "Accumulation"}
                    ]
                    m["drawings"] = cup_drawings
                    matched["rounding_bottom"] = m

    return matched

@technical_screener_bp.route("/api/technical-screener/hierarchy", methods=["GET"])
def get_technical_screener_hierarchy_api():
    """
    Returns the master screener hierarchy and definitions from Collection 1.
    If not in DB yet, seeds Collection 1. Synchronizes active phase status.
    """
    master = _get_master_screener_hierarchy()
    hierarchy = load_technical_screener_hierarchy_db()
    if not hierarchy or not hierarchy.get("categories"):
        hierarchy = master
        save_technical_screener_hierarchy_db(hierarchy)
    else:
        # Keep category status and phase badges synchronized with active phases
        updated = False
        master_cats_map = {c["id"]: c for c in master.get("categories", [])}
        for cat in hierarchy.get("categories", []):
            cid = cat.get("id")
            if cid in master_cats_map:
                m_cat = master_cats_map[cid]
                if cat.get("status") != m_cat.get("status") or cat.get("badge") != m_cat.get("badge"):
                    cat["status"] = m_cat.get("status")
                    cat["badge"] = m_cat.get("badge")
                    updated = True
        if updated:
            save_technical_screener_hierarchy_db(hierarchy)

    return jsonify({"success": True, "hierarchy": hierarchy})

@technical_screener_bp.route("/api/technical-screener/watchlists", methods=["GET"])
def get_technical_screener_watchlists_api():
    """
    Returns user's watchlists and item counts for screener dropdown selection.
    """
    uname = session.get("username", "admin") if hasattr(session, "get") else "admin"
    try:
        from modules.watchlist.watchlist_routes import load_data as load_watchlists
        wl_data = load_watchlists(uname) or {}
    except Exception as e:
        print(f"Error loading watchlists for screener dropdown: {e}")
        wl_data = {}

    summary = []
    total_combined = 0
    all_symbols_set = set()
    if isinstance(wl_data, dict):
        for name, items in wl_data.items():
            stk_count = 0
            if isinstance(items, list):
                for it in items:
                    sym = it.get("symbol") if isinstance(it, dict) else it
                    if sym:
                        stk_count += 1
                        all_symbols_set.add(sym.upper().replace(".NS", "").replace(".BO", "").strip())
            summary.append({"name": name, "count": stk_count})

    return jsonify({
        "success": True,
        "watchlists": summary,
        "total_combined": len(all_symbols_set)
    })

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
    timeframe = request.args.get("timeframe", "daily").strip().lower()
    if timeframe not in ("daily", "weekly", "monthly"):
        timeframe = "daily"
    watchlist_id = request.args.get("watchlist_id", "").strip()
    force_refresh = request.args.get("force_refresh", "false").lower() in ("true", "1", "yes")

    # Get master hierarchy to check category validity
    master = _get_master_screener_hierarchy()
    hierarchy = load_technical_screener_hierarchy_db()
    if not hierarchy or not hierarchy.get("definitions"):
        hierarchy = master
        save_technical_screener_hierarchy_db(hierarchy)
    else:
        master_cats_map = {c["id"]: c for c in master.get("categories", [])}
        for cat in hierarchy.get("categories", []):
            cid = cat.get("id")
            if cid in master_cats_map:
                cat["status"] = master_cats_map[cid].get("status")
                cat["badge"] = master_cats_map[cid].get("badge")

    cat_meta = next((c for c in hierarchy.get("categories", []) if c.get("id") == category), None)
    if not cat_meta:
        return jsonify({"success": False, "error": f"Unknown category: {category}"}), 400

    target_symbols = _get_target_symbols_for_scope(scope=scope, watchlist_id=watchlist_id, uname=uname)
    if not target_symbols:
        return jsonify({
            "success": True,
            "category": category,
            "scope": scope,
            "timeframe": timeframe,
            "total_scanned": 0,
            "no_stocks": True,
            "scanners": {},
            "stocks": {}
        })

    # All categories active
    cache_key = f"{uname}_{category}_{scope}_{watchlist_id}_{timeframe}"
    now_ts = time.time()

    if not force_refresh:
        # Check if we already have recent data in Collection 2 for this timeframe
        existing_info = load_technical_screener_info_db(symbols=target_symbols, timeframe=timeframe)
        valid_cached_stocks = 0
        for sym in target_symbols:
            doc = existing_info.get(sym.upper())
            if doc and doc.get("scanners") and doc.get("categories_scanned", {}).get(category):
                valid_cached_stocks += 1

        # If we have cached results for at least 1 stock, build response directly from Collection 2
        if valid_cached_stocks > 0:
            scanners_result = _build_category_scanners_response(hierarchy, category, existing_info, target_symbols)
            return jsonify({
                "success": True,
                "category": category,
                "scope": scope,
                "timeframe": timeframe,
                "total_scanned": len(target_symbols),
                "from_cache": True,
                "needs_scan": False,
                "scanners": scanners_result,
                "stocks": existing_info
            })
        else:
            # Don't auto-load heavy network scans by default! Wait for explicit "Scan Now" click
            return jsonify({
                "success": True,
                "category": category,
                "scope": scope,
                "timeframe": timeframe,
                "total_scanned": len(target_symbols),
                "from_cache": False,
                "needs_scan": True,
                "scanners": {},
                "stocks": {}
            })

    # Determine YF interval and range based on timeframe
    if timeframe == "weekly":
        yf_interval = "1wk"
        yf_range = "5y"
    elif timeframe == "monthly":
        yf_interval = "1mo"
        yf_range = "10y"
    else:
        yf_interval = "1d"
        yf_range = "1y"

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
                    url = f'https://{host}/v8/finance/chart/{yf_sym}?interval={yf_interval}&range={yf_range}&includeAdjustedClose=true'
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
                name = meta.get('shortName') or meta.get('longName') or symbol

                quote = data.get('indicators', {}).get('quote', [{}])[0]
                raw_closes = quote.get('close', []) or []
                raw_highs = quote.get('high', []) or []
                raw_lows = quote.get('low', []) or []
                raw_opens = quote.get('open', []) or []
                raw_vols = quote.get('volume', []) or []
                raw_timestamps = data.get('timestamp', []) or []

                valid_idx = [
                    i for i, c in enumerate(raw_closes)
                    if c is not None and i < len(raw_highs) and raw_highs[i] is not None and i < len(raw_lows) and raw_lows[i] is not None
                ]
                if len(valid_idx) < 30:
                    return None

                closes = [raw_closes[i] for i in valid_idx]
                highs = [raw_highs[i] for i in valid_idx]
                lows = [raw_lows[i] for i in valid_idx]
                opens = [raw_opens[i] if (i < len(raw_opens) and raw_opens[i] is not None) else closes[i] for i in valid_idx]
                volumes = [raw_vols[i] if (i < len(raw_vols) and raw_vols[i] is not None) else 0 for i in valid_idx]

                # Convert timestamps to exact candle dates aligned with Lightweight Charts
                dates = []
                for i in valid_idx:
                    raw_ts = raw_timestamps[i] if i < len(raw_timestamps) else None
                    if raw_ts:
                        dt = datetime.datetime.fromtimestamp(raw_ts, datetime.timezone.utc)
                        if timeframe == "weekly":
                            monday = dt - datetime.timedelta(days=dt.weekday())
                            dates.append(monday.strftime('%Y-%m-%d'))
                        elif timeframe == "monthly":
                            dates.append(dt.strftime('%Y-%m-01'))
                        else:
                            dates.append(dt.strftime('%Y-%m-%d'))
                    else:
                        dates.append("")

                ltp = round(closes[-1], 2)
                prev_close = round(closes[-2], 2) if len(closes) >= 2 else ltp
                change_pct = round(((ltp - prev_close) / prev_close) * 100.0, 2)
                vol_latest = volumes[-1]
                curr_date = dates[-1] if dates else ""
                prev_date = dates[-2] if len(dates) >= 2 else curr_date

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

                if category == "trendlines":
                    matched_scanners = _analyze_trendlines_for_stock(closes, highs, lows, dates, symbol, name, ltp, prev_close)
                elif category == "triangles":
                    matched_scanners = _analyze_triangles_for_stock(closes, highs, lows, dates, symbol, name, ltp, prev_close)
                elif category == "channels":
                    matched_scanners = _analyze_channels_for_stock(closes, highs, lows, dates, symbol, name, ltp, prev_close)
                elif category == "nr_wr":
                    matched_scanners = _analyze_nr_wr_for_stock(closes, highs, lows, opens, dates, symbol, name, ltp, prev_close)
                elif category == "chart_patterns":
                    matched_scanners = _analyze_chart_patterns_for_stock(closes, highs, lows, volumes, dates, symbol, name, ltp, prev_close)
                else:
                    # 1. Golden Crossover
                    if sma50_latest and sma200_latest and sma50_latest > sma200_latest:
                        s_item = dict(base_scanner_result)
                        s_item["metric"] = f"50 DMA (₹{sma50_latest:.1f}) > 200 DMA (₹{sma200_latest:.1f})"
                        
                        cross_date = curr_date
                        if len(closes) >= 200:
                            for k in range(len(closes) - 1, max(199, len(closes) - 120), -1):
                                s50_now = sum(closes[k-49:k+1]) / 50.0
                                s200_now = sum(closes[k-199:k+1]) / 200.0
                                s50_prev = sum(closes[k-50:k]) / 50.0
                                s200_prev = sum(closes[k-200:k]) / 200.0
                                if s50_now >= s200_now and s50_prev < s200_prev:
                                    if k < len(dates) and dates[k]:
                                        cross_date = dates[k]
                                    break
                        s_item["markers"] = [{"time": cross_date, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "Golden Cross"}]
                        s_item["indicators"] = {"showDmaCross": True, "showSma50": True, "showSma200": True}
                        matched_scanners["golden_cross"] = s_item

                    # 2. Supertrend BUY
                    if ltp > st_lower and ltp > (highs[-1] + lows[-1]) / 2.0:
                        s_item = dict(base_scanner_result)
                        s_item["metric"] = f"LTP ₹{ltp:.2f} > Supertrend ₹{st_lower:.2f}"
                        s_item["markers"] = [{"time": curr_date, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "ST BUY"}]
                        matched_scanners["supertrend_buy"] = s_item

                    # 3. RSI Momentum
                    if rsi14 is not None and 55 <= rsi14 <= 72:
                        s_item = dict(base_scanner_result)
                        s_item["metric"] = f"RSI(14) at {rsi14:.1f} (Bullish Momentum Range)"
                        s_item["markers"] = [{"time": curr_date, "position": "belowBar", "color": "#3b82f6", "shape": "arrowUp", "text": f"RSI {rsi14:.1f}"}]
                        matched_scanners["rsi_momentum"] = s_item

                    # 4. EMA Bullish Cross
                    if ema9_latest > ema21_latest:
                        s_item = dict(base_scanner_result)
                        s_item["metric"] = f"9 EMA (₹{ema9_latest:.1f}) > 21 EMA (₹{ema21_latest:.1f})"
                        
                        cross_date = curr_date
                        max_offset = min(len(ema21_series) - 1, 60, len(dates) - 1)
                        if max_offset > 1:
                            for offset in range(1, max_offset):
                                if ema9_series[-offset] >= ema21_series[-offset] and ema9_series[-(offset + 1)] < ema21_series[-(offset + 1)]:
                                    cross_date = dates[-offset]
                                    break
                        s_item["markers"] = [{"time": cross_date, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "EMA Cross"}]
                        s_item["indicators"] = {"showEmaCross": True, "showEma9": True, "showEma21": True}
                        matched_scanners["ema_bull_cross"] = s_item

                    # 5. MACD Bullish Cross
                    if macd_val > signal_val and macd_val > -10.0:
                        s_item = dict(base_scanner_result)
                        s_item["metric"] = f"MACD ({macd_val:+.1f}) > Signal ({signal_val:+.1f})"
                        s_item["markers"] = [{"time": curr_date, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "MACD Cross"}]
                        matched_scanners["macd_bullish"] = s_item

                    # 6. Bollinger Band Breakout
                    if upper_bb and ltp >= upper_bb * 0.995:
                        s_item = dict(base_scanner_result)
                        s_item["metric"] = f"LTP ₹{ltp:.2f} ≥ Upper BB ₹{upper_bb:.2f}"
                        s_item["markers"] = [{"time": curr_date, "position": "belowBar", "color": "#3b82f6", "shape": "arrowUp", "text": "BB Breakout"}]
                        matched_scanners["bollinger_breakout"] = s_item

                    # 7. Donchian Channel Breakout
                    if donchian_high and ltp >= donchian_high * 0.995:
                        s_item = dict(base_scanner_result)
                        s_item["metric"] = f"LTP ₹{ltp:.2f} at 20D High ₹{donchian_high:.2f}"
                        s_item["markers"] = [{"time": curr_date, "position": "belowBar", "color": "#3b82f6", "shape": "arrowUp", "text": "20D High"}]
                        matched_scanners["donchian_breakout"] = s_item

                    # 8. ST Trigger Bullish
                    if ltp > prev_close and ltp > (highs[-1] + lows[-1]) / 2.0 and highs[-1] >= highs[-2]:
                        s_item = dict(base_scanner_result)
                        s_item["metric"] = f"ST Trigger Bullish (Higher High ₹{highs[-1]:.2f})"
                        s_item["markers"] = [{"time": curr_date, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "ST Bull"}]
                        matched_scanners["st_trigger_bull"] = s_item

                    # 9. Bullish Engulfing
                    is_prev_red = closes[-2] < closes[-3] if len(closes) >= 3 else False
                    is_curr_green = ltp > prev_close
                    if is_curr_green and is_prev_red and ltp >= highs[-2] * 0.995:
                        s_item = dict(base_scanner_result)
                        s_item["metric"] = f"Engulfing: Green ₹{ltp:.2f} vs Prior Red ₹{prev_close:.2f}"
                        s_item["markers"] = [
                            {"time": prev_date, "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": "Prior Red"},
                            {"time": curr_date, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "Engulfing"}
                        ]
                        matched_scanners["bullish_engulfing"] = s_item

                    # 10. Near 52W High
                    if high_52w and ltp >= high_52w * 0.97:
                        away_pct = round(((high_52w - ltp) / high_52w) * 100.0, 1)
                        s_item = dict(base_scanner_result)
                        s_item["metric"] = f"52W High ₹{high_52w:.2f} ({away_pct}% away)"
                        s_item["markers"] = [{"time": curr_date, "position": "belowBar", "color": "#f59e0b", "shape": "arrowUp", "text": "52W High"}]
                        matched_scanners["high_52w"] = s_item

                    # 11. Volume Surge
                    if vol_surge >= 1.8 and vol_latest > 5000:
                        s_item = dict(base_scanner_result)
                        s_item["metric"] = f"{vol_surge:.1f}x vs 20d Avg Vol"
                        s_item["markers"] = [{"time": curr_date, "position": "belowBar", "color": "#8b5cf6", "shape": "arrowUp", "text": f"{vol_surge:.1f}x Vol"}]
                        matched_scanners["volume_surge"] = s_item

                    # 12. Triple Confluence
                    if ema9_latest > ema21_latest and (rsi14 is not None and rsi14 >= 50) and (sma50_latest and ltp > sma50_latest):
                        s_item = dict(base_scanner_result)
                        s_item["metric"] = f"EMA Cross + RSI {rsi14:.1f} + Above 50 DMA"
                        
                        cross_date = curr_date
                        max_offset = min(len(ema21_series) - 1, 60, len(dates) - 1)
                        if max_offset > 1:
                            for offset in range(1, max_offset):
                                if ema9_series[-offset] >= ema21_series[-offset] and ema9_series[-(offset + 1)] < ema21_series[-(offset + 1)]:
                                    cross_date = dates[-offset]
                                    break
                        s_item["markers"] = [{"time": cross_date, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": "Triple Confluence"}]
                        s_item["indicators"] = {"showEmaCross": True, "showEma9": True, "showEma21": True, "showSma50": True}
                        matched_scanners["triple_confluence"] = s_item

                    # 13. RSI Oversold Rebound
                    if rsi14 is not None and rsi14 <= 38:
                        s_item = dict(base_scanner_result)
                        s_item["metric"] = f"RSI(14) at {rsi14:.1f} (Oversold Range)"
                        s_item["markers"] = [{"time": curr_date, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": f"RSI {rsi14:.1f}"}]
                        matched_scanners["rsi_oversold"] = s_item

                    # 14. Extreme Oversold
                    if rsi14 is not None and rsi14 < 30.0:
                        s_item = dict(base_scanner_result)
                        s_item["metric"] = f"RSI(14) at {rsi14:.1f} (< 30 Extreme)"
                        s_item["markers"] = [{"time": curr_date, "position": "belowBar", "color": "#10b981", "shape": "arrowUp", "text": f"RSI {rsi14:.1f} (<30)"}]
                        matched_scanners["oversold_extreme"] = s_item

                    # 15. Death Cross
                    if sma50_latest and sma200_latest and sma50_latest < sma200_latest:
                        s_item = dict(base_scanner_result)
                        s_item["metric"] = f"50 DMA (₹{sma50_latest:.1f}) < 200 DMA (₹{sma200_latest:.1f})"
                        
                        cross_date = curr_date
                        if len(closes) >= 200:
                            for k in range(len(closes) - 1, max(199, len(closes) - 120), -1):
                                s50_now = sum(closes[k-49:k+1]) / 50.0
                                s200_now = sum(closes[k-199:k+1]) / 200.0
                                s50_prev = sum(closes[k-50:k]) / 50.0
                                s200_prev = sum(closes[k-200:k]) / 200.0
                                if s50_now <= s200_now and s50_prev > s200_prev:
                                    if k < len(dates) and dates[k]:
                                        cross_date = dates[k]
                                    break
                        s_item["markers"] = [{"time": cross_date, "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": "Death Cross"}]
                        s_item["indicators"] = {"showDmaCross": True, "showSma50": True, "showSma200": True}
                        matched_scanners["death_cross"] = s_item

                    # 16. Near 52W Low
                    if low_52w and ltp <= low_52w * 1.03:
                        away_pct = round(((ltp - low_52w) / low_52w) * 100.0, 1)
                        s_item = dict(base_scanner_result)
                        s_item["metric"] = f"52W Low ₹{low_52w:.2f} ({away_pct}% away)"
                        s_item["markers"] = [{"time": curr_date, "position": "aboveBar", "color": "#ef5350", "shape": "arrowDown", "text": "52W Low"}]
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

        # Append to Collection 2: technical_screener_info (scoped by timeframe)
        batch_append_technical_screener_info_db(stock_updates_to_save, category_id=category, timeframe=timeframe)

        # Load updated state from Collection 2 for the requested timeframe
        all_info = load_technical_screener_info_db(symbols=target_symbols, timeframe=timeframe)
        scanners_result = _build_category_scanners_response(hierarchy, category, all_info, target_symbols)

        return jsonify({
            "success": True,
            "category": category,
            "scope": scope,
            "timeframe": timeframe,
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
    timeframe = request.args.get("timeframe", "").strip().lower()
    data = load_technical_screener_info_db(symbols=[clean_sym], timeframe=timeframe if timeframe else None)
    stock_doc = data.get(clean_sym)
    if not stock_doc:
        return jsonify({"success": False, "error": f"No technical data found for {clean_sym}"}), 404
    return jsonify({"success": True, "stock": stock_doc})
