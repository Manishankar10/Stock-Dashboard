import os
import io
import logging

logger = logging.getLogger(__name__)

try:
    from PIL import Image, ImageDraw, ImageFont
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    Image = ImageDraw = ImageFont = None
    logger.warning("Pillow is not installed. Fallback notification badges will be used.")

# Try loading system fonts or fallback
def _get_font(size, bold=False):
    if not PIL_AVAILABLE or ImageFont is None:
        return None
    font_paths = [
        # Windows
        r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\calibrib.ttf" if bold else r"C:\Windows\Fonts\calibri.ttf",
        # Linux / Docker / Render
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf" if bold else "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                continue
    try:
        return ImageFont.load_default()
    except Exception:
        return None


def _measure_text_w(font, text):
    """Safely measures text width across all Pillow versions."""
    if not font or not text:
        return 0
    if hasattr(font, 'getlength'):
        try:
            return font.getlength(str(text))
        except Exception:
            pass
    if hasattr(font, 'getbbox'):
        try:
            bbox = font.getbbox(str(text))
            return bbox[2] - bbox[0]
        except Exception:
            pass
    return len(str(text)) * 10


def clean_stock_symbol(sym):
    """
    Strips exchange suffixes like .NS, .BS, .BO, .NSE, .BSE from stock symbols.
    E.g., 'GAUDIUMIVF.NS' -> 'GAUDIUMIVF', 'TCS.BO' -> 'TCS', 'INFY.BS' -> 'INFY'.
    """
    if not sym or not isinstance(sym, str):
        return "-"
    s = sym.strip()
    if s in ("-", "--", "N/A", "None", ""):
        return "-"
    for suffix in [".NS", ".ns", ".BO", ".bo", ".BS", ".bs", ".NSE", ".nse", ".BSE", ".bse"]:
        if s.endswith(suffix):
            s = s[:-len(suffix)]
            break
    return s.strip()

def format_currency_inr(val):
    if isinstance(val, (int, float)):
        return f"{val:,.2f}".rstrip('0').rstrip('.')
    return str(val)

def generate_gold_silver_card(
    gold_1g="₹13,195",
    gold_8g="₹1,05,560",
    silver_1g="₹215.00",
    silver_8g="₹1,720",
    output_path=None
):
    """
    Renders high-res 882x410 dark-themed card matching user's exact uploaded image.
    """
    if not PIL_AVAILABLE or Image is None:
        return "/static/favicon-192.png"
    width, height = 882, 410
    im = Image.new("RGBA", (width, height), (15, 23, 42, 255)) # Slate 900
    draw = ImageDraw.Draw(im)

    # Outer border & background
    draw.rounded_rectangle([6, 6, width - 6, height - 6], radius=20, fill=(19, 27, 43, 255), outline=(45, 60, 85, 255), width=2)

    # Fonts
    font_title = _get_font(26, bold=True)
    font_badge = _get_font(18, bold=True)
    font_label = _get_font(17, bold=True)
    font_price = _get_font(34, bold=True)
    font_sub = _get_font(16, bold=False)

    # Colors
    gold_yellow = (245, 180, 10, 255)
    silver_white = (226, 232, 240, 255)
    text_muted = (148, 163, 184, 255)
    card_box_bg = (28, 38, 58, 255)
    card_box_border = (47, 63, 92, 255)

    # Ensure ₹ symbol in strings
    def ensure_rupee(s):
        s = str(s).strip()
        if not s.startswith("₹") and not s.startswith("Rs"):
            return f"₹{s}"
        return s

    gold_1g_str = ensure_rupee(gold_1g)
    gold_8g_str = ensure_rupee(gold_8g)
    silver_1g_str = ensure_rupee(silver_1g)
    silver_8g_str = ensure_rupee(silver_8g)

    # SECTION 1: Standard Gold (22 Karat)
    # Header Row
    sec1_y = 20
    # Gold Title with sleek gold indicator
    draw.ellipse([32, sec1_y + 8, 44, sec1_y + 20], fill=gold_yellow)
    draw.text((54, sec1_y), "Standard Gold (22 Karat)", font=font_title, fill=(255, 255, 255, 255))
    
    # 916 Hallmark Badge
    badge_text = "916 HALLMARK"
    badge_w = 175
    badge_h = 32
    badge_x = width - 32 - badge_w
    draw.rounded_rectangle([badge_x, sec1_y, badge_x + badge_w, sec1_y + badge_h], radius=7, fill=(35, 32, 20, 255), outline=(217, 155, 0, 255), width=2)
    draw.text((badge_x + 18, sec1_y + 5), badge_text, font=font_badge, fill=gold_yellow)

    # Sub-cards (1 Gram & 8 Gram)
    box_y = sec1_y + 44
    box_w = (width - 64 - 20) // 2
    box_h = 118

    # Gold Box 1 (1 Gram)
    draw.rounded_rectangle([32, box_y, 32 + box_w, box_y + box_h], radius=14, fill=card_box_bg, outline=card_box_border, width=2)
    draw.text((52, box_y + 14), "1 GRAM", font=font_label, fill=text_muted)
    draw.text((52, box_y + 38), gold_1g_str, font=font_price, fill=gold_yellow)
    draw.text((52, box_y + 82), "Jewellery Rate", font=font_sub, fill=text_muted)

    # Gold Box 2 (8 Gram Sovereign)
    bx2 = 32 + box_w + 20
    draw.rounded_rectangle([bx2, box_y, bx2 + box_w, box_y + box_h], radius=14, fill=card_box_bg, outline=card_box_border, width=2)
    draw.text((bx2 + 20, box_y + 14), "8 GM (1 SOVEREIGN)", font=font_label, fill=text_muted)
    draw.text((bx2 + 20, box_y + 38), gold_8g_str, font=font_price, fill=gold_yellow)
    draw.text((bx2 + 20, box_y + 82), "1 Pavan / Sovereign", font=font_sub, fill=text_muted)

    # SECTION 2: Ready Silver
    sec2_y = box_y + box_h + 24
    draw.ellipse([32, sec2_y + 8, 44, sec2_y + 20], fill=silver_white)
    draw.text((54, sec2_y), "Ready Silver", font=font_title, fill=(255, 255, 255, 255))

    # 99.9% Fine Badge
    s_badge_text = "99.9% FINE"
    s_badge_w = 145
    s_badge_h = 32
    s_badge_x = width - 32 - s_badge_w
    draw.rounded_rectangle([s_badge_x, sec2_y, s_badge_x + s_badge_w, sec2_y + s_badge_h], radius=7, fill=(30, 41, 59, 255), outline=(100, 116, 139, 255), width=2)
    draw.text((s_badge_x + 18, sec2_y + 5), s_badge_text, font=font_badge, fill=(203, 213, 225, 255))

    # Silver Sub-cards
    s_box_y = sec2_y + 44

    # Silver Box 1 (1 Gram)
    draw.rounded_rectangle([32, s_box_y, 32 + box_w, s_box_y + box_h], radius=14, fill=card_box_bg, outline=card_box_border, width=2)
    draw.text((52, s_box_y + 14), "1 GRAM", font=font_label, fill=text_muted)
    draw.text((52, s_box_y + 38), silver_1g_str, font=font_price, fill=silver_white)
    draw.text((52, s_box_y + 82), "Retail Rate", font=font_sub, fill=text_muted)

    # Silver Box 2 (8 Grams)
    draw.rounded_rectangle([bx2, s_box_y, bx2 + box_w, s_box_y + box_h], radius=14, fill=card_box_bg, outline=card_box_border, width=2)
    draw.text((bx2 + 20, s_box_y + 14), "8 GRAMS", font=font_label, fill=text_muted)
    draw.text((bx2 + 20, s_box_y + 38), silver_8g_str, font=font_price, fill=silver_white)
    draw.text((bx2 + 20, s_box_y + 82), "Coin Rate", font=font_sub, fill=text_muted)

    if output_path:
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        im.save(output_path, "PNG", optimize=True)
    
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    buf.seek(0)
    return buf


def generate_portfolio_card(
    performance="+0.50%",
    top_gainer_symbol="POCL",
    top_gainer_change="+4.56%",
    top_loser_symbol="Polymedicure",
    top_loser_change="-0.65%",
    portfolio_name="Institutional Portfolio",
    date_str="Today",
    output_path=None,
    badge_text=None
):
    """
    Renders a high-res 882x410 dark-themed card for Portfolio Performance.
    Displays 'EOD SUMMARY' badge only after market hours (or weekends);
    displays live market time e.g. '03:20 PM' during active market trading hours.
    """
    from modules.common.ist_datetime import get_market_badge_text

    top_gainer_symbol = clean_stock_symbol(top_gainer_symbol)
    top_loser_symbol = clean_stock_symbol(top_loser_symbol)

    if not badge_text:
        badge_text, is_live = get_market_badge_text()
    else:
        badge_text = str(badge_text).strip()
        is_live = (badge_text.upper() != "EOD SUMMARY")

    width, height = 882, 410
    im = Image.new("RGBA", (width, height), (15, 23, 42, 255))
    draw = ImageDraw.Draw(im)

    # Outer border
    draw.rounded_rectangle([6, 6, width - 6, height - 6], radius=20, fill=(19, 27, 43, 255), outline=(45, 60, 85, 255), width=2)

    font_title = _get_font(24, bold=True)
    font_badge = _get_font(16, bold=True)
    font_label = _get_font(16, bold=True)
    font_large_perf = _get_font(42, bold=True)
    font_symbol = _get_font(26, bold=True)
    font_change = _get_font(24, bold=True)
    font_sub = _get_font(15, bold=False)

    text_muted = (148, 163, 184, 255)
    green_color = (16, 185, 129, 255)   # #10b981
    red_color = (239, 68, 68, 255)     # #ef4444
    card_box_bg = (28, 38, 58, 255)
    card_box_border = (47, 63, 92, 255)

    # Header
    sec_y = 22
    draw.ellipse([32, sec_y + 7, 44, sec_y + 19], fill=(59, 130, 246, 255))
    draw.text((54, sec_y), "Portfolio Performance Digest", font=font_title, fill=(255, 255, 255, 255))
    
    # Dynamic Badge (Live IST Time e.g. '03:20 PM' during market hours, or 'EOD SUMMARY' after market close)
    text_w = _measure_text_w(font_badge, badge_text)
    badge_w = max(116, int(text_w + 28))
    badge_h = 32
    badge_x = width - 32 - badge_w
    text_x = badge_x + int((badge_w - text_w) / 2)

    draw.rounded_rectangle([badge_x, sec_y, badge_x + badge_w, sec_y + badge_h], radius=7, fill=(16, 40, 32, 255), outline=(16, 185, 129, 255), width=2)
    draw.text((text_x, sec_y + 6), badge_text, font=font_badge, fill=green_color)

    # Sub-header info
    if is_live:
        sub_text = f"{portfolio_name} • Live Market {badge_text} IST"
    else:
        sub_text = f"{portfolio_name} • Market Close {date_str}"
    draw.text((32, sec_y + 36), sub_text, font=font_sub, fill=text_muted)

    # 3 Metrics Layout:
    # Box 1: Today's Performance (Left large box)
    # Box 2: Top Gainer (Right top)
    # Box 3: Top Loser (Right bottom)
    col1_w = 340
    col2_w = width - 64 - col1_w - 20
    box_y = sec_y + 72
    box_total_h = height - box_y - 28

    # Left Box: Performance
    is_positive = not str(performance).strip().startswith("-")
    perf_color = green_color if is_positive else red_color
    perf_sign = "+" if is_positive and not str(performance).strip().startswith("+") else ""
    perf_text = f"{perf_sign}{str(performance).strip()}"
    if not perf_text.endswith("%"):
        perf_text += "%"

    draw.rounded_rectangle([32, box_y, 32 + col1_w, box_y + box_total_h], radius=16, fill=card_box_bg, outline=card_box_border, width=2)
    draw.text((54, box_y + 24), "TODAY'S PERFORMANCE", font=font_label, fill=text_muted)
    draw.text((54, box_y + 65), perf_text, font=font_large_perf, fill=perf_color)
    dot_color = green_color if is_positive else red_color
    draw.ellipse([54, box_y + 135, 62, box_y + 143], fill=dot_color)
    draw.text((68, box_y + 128), "Net Daily Market Return" if is_positive else "Daily Drawdown", font=font_sub, fill=text_muted)
    draw.text((54, box_y + 160), "CAPITAL DESK ANALYTICS", font=_get_font(13, bold=True), fill=(99, 102, 241, 255))

    # Right Col: Top Gainer (Upper) & Top Loser (Lower)
    col2_x = 32 + col1_w + 20
    half_h = (box_total_h - 16) // 2

    # Top Gainer Box
    draw.rounded_rectangle([col2_x, box_y, col2_x + col2_w, box_y + half_h], radius=14, fill=card_box_bg, outline=card_box_border, width=2)
    # Sleek green up-triangle icon
    draw.polygon([(col2_x + 24, box_y + 27), (col2_x + 31, box_y + 18), (col2_x + 38, box_y + 27)], fill=green_color)
    draw.text((col2_x + 44, box_y + 16), "TOP GAINER", font=font_label, fill=text_muted)
    draw.text((col2_x + 24, box_y + 44), str(top_gainer_symbol), font=font_symbol, fill=(255, 255, 255, 255))
    
    g_change = str(top_gainer_change).strip()
    is_gainer_na = str(top_gainer_symbol).strip() in ("-", "--", "N/A", "None", "") or g_change in ("-", "--", "N/A", "None", "")
    if is_gainer_na:
        g_change = "-"
    else:
        if not g_change.startswith("+") and not g_change.startswith("-"):
            g_change = f"+{g_change}"
        if not g_change.endswith("%"):
            g_change += "%"
    
    # Gainer badge pill
    g_pill_w = 120
    g_pill_x = col2_x + col2_w - 24 - g_pill_w
    if is_gainer_na:
        draw.rounded_rectangle([g_pill_x, box_y + 40, g_pill_x + g_pill_w, box_y + 80], radius=8, fill=(30, 41, 59, 255), outline=(71, 85, 105, 255), width=1)
        draw.text((g_pill_x + 52, box_y + 48), "-", font=font_change, fill=text_muted)
    else:
        draw.rounded_rectangle([g_pill_x, box_y + 40, g_pill_x + g_pill_w, box_y + 80], radius=8, fill=(16, 45, 35, 255), outline=green_color, width=1)
        draw.text((g_pill_x + 14, box_y + 48), g_change, font=font_change, fill=green_color)

    # Top Loser Box
    box_loser_y = box_y + half_h + 16
    draw.rounded_rectangle([col2_x, box_loser_y, col2_x + col2_w, box_loser_y + half_h], radius=14, fill=card_box_bg, outline=card_box_border, width=2)
    # Sleek red down-triangle icon
    draw.polygon([(col2_x + 24, box_loser_y + 18), (col2_x + 38, box_loser_y + 18), (col2_x + 31, box_loser_y + 27)], fill=red_color)
    draw.text((col2_x + 44, box_loser_y + 16), "TOP LOSER", font=font_label, fill=text_muted)
    draw.text((col2_x + 24, box_loser_y + 44), str(top_loser_symbol), font=font_symbol, fill=(255, 255, 255, 255))

    l_change = str(top_loser_change).strip()
    is_loser_na = str(top_loser_symbol).strip() in ("-", "--", "N/A", "None", "") or l_change in ("-", "--", "N/A", "None", "")
    if is_loser_na:
        l_change = "-"
    else:
        if not l_change.startswith("-") and not l_change.startswith("+"):
            l_change = f"-{l_change}"
        if not l_change.endswith("%"):
            l_change += "%"

    # Loser badge pill
    l_pill_w = 120
    l_pill_x = col2_x + col2_w - 24 - l_pill_w
    if is_loser_na:
        draw.rounded_rectangle([l_pill_x, box_loser_y + 40, l_pill_x + l_pill_w, box_loser_y + 80], radius=8, fill=(30, 41, 59, 255), outline=(71, 85, 105, 255), width=1)
        draw.text((l_pill_x + 52, box_loser_y + 48), "-", font=font_change, fill=text_muted)
    else:
        draw.rounded_rectangle([l_pill_x, box_loser_y + 40, l_pill_x + l_pill_w, box_loser_y + 80], radius=8, fill=(45, 20, 20, 255), outline=red_color, width=1)
        draw.text((l_pill_x + 14, box_loser_y + 48), l_change, font=font_change, fill=red_color)

    if output_path:
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        im.save(output_path, "PNG", optimize=True)

    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    buf.seek(0)
    return buf


def _draw_sort_arrows(draw, x, y, color=(100, 116, 139, 255)):
    """Draws subtle sort indicators (up & down triangles) in table header."""
    # Up triangle
    draw.polygon([(x, y + 5), (x + 7, y + 5), (x + 3.5, y + 1)], fill=color)
    # Down triangle
    draw.polygon([(x, y + 8), (x + 7, y + 8), (x + 3.5, y + 12)], fill=color)


def generate_watchlist_card(
    stocks=None,
    username="Sampath",
    date_str="Today",
    output_path=None,
    limit=5
):
    """
    Renders high-res 882x440 dark glassy card matching user's watchlist image format:
    Columns: SYMBOL (with NSE/BSE badge), LTP (₹), CHANGE (₹), CHANGE (%) in emerald green.
    Excludes negative stocks. Up to 5 top gainers.
    """
    if not PIL_AVAILABLE or Image is None:
        return "/static/favicon-192.png"

    if stocks is None:
        stocks = [
            {"symbol": "POCL", "exchange": "NSE", "ltp": "₹392.75", "change_val": "+₹15.15", "change_pct": "+4.01%"},
            {"symbol": "INDHOTEL", "exchange": "NSE", "ltp": "₹823.10", "change_val": "+₹13.10", "change_pct": "+1.62%"},
            {"symbol": "TCS", "exchange": "NSE", "ltp": "₹3,940.50", "change_val": "+₹32.80", "change_pct": "+0.84%"},
            {"symbol": "INFY", "exchange": "NSE", "ltp": "₹1,855.20", "change_val": "+₹12.40", "change_pct": "+0.67%"},
            {"symbol": "RELIANCE", "exchange": "NSE", "ltp": "₹2,740.00", "change_val": "+₹14.50", "change_pct": "+0.53%"},
        ]

    # Strictly filter out negative and non-positive stocks
    filtered_stocks = []
    for s in stocks:
        raw_pct = str(s.get("change_pct", "0")).replace("%", "").replace("+", "").strip()
        try:
            val_pct = float(raw_pct)
        except Exception:
            val_pct = 0.0
        if val_pct > 0.0:
            filtered_stocks.append(s)

    try:
        limit = int(limit or 5)
    except Exception:
        limit = 5
    if limit < 1:
        limit = 5

    # Scale canvas height comfortably if limit > 5
    row_count = min(len(filtered_stocks), limit)
    tbl_y = 72
    th_h = 42
    if limit > 5:
        row_h = 52
        height = max(440, tbl_y + th_h + (max(row_count, 1) * row_h) + 24)
    else:
        height = 440
        row_h = 60 if row_count <= 4 else (height - tbl_y - 22 - th_h) / max(limit, 1)

    width = 882
    im = Image.new("RGBA", (width, height), (13, 20, 36, 255))
    draw = ImageDraw.Draw(im)

    # Outer border & glassy card canvas
    draw.rounded_rectangle(
        [6, 6, width - 6, height - 6],
        radius=20,
        fill=(17, 24, 43, 255),
        outline=(37, 52, 78, 255),
        width=2
    )

    # Fonts
    font_title = _get_font(23, bold=True)
    font_badge = _get_font(15, bold=True)
    font_sub = _get_font(14, bold=False)
    font_th = _get_font(13, bold=True)
    font_sym = _get_font(20, bold=True)
    font_exch = _get_font(12, bold=True)
    font_val = _get_font(19, bold=True)
    font_pct = _get_font(20, bold=True)

    # Palette
    color_green = (16, 185, 129, 255)      # #10b981
    color_muted = (148, 163, 184, 255)     # #94a3b8
    color_th_arrow = (100, 116, 139, 255)
    color_white = (255, 255, 255, 255)
    color_val = (241, 245, 249, 255)       # #f1f5f9
    tbl_bg = (19, 29, 49, 255)
    tbl_border = (33, 47, 72, 255)
    th_bg = (23, 34, 57, 255)
    row_line = (33, 47, 72, 255)

    # Header Row
    sec_y = 24
    draw.ellipse([30, sec_y + 5, 44, sec_y + 19], fill=color_green)
    display_name = f"Watchlist: Top {limit} Gainers"
    draw.text((54, sec_y), display_name, font=font_title, fill=color_white)

    # Right Badge: TOP _ GAINERS
    badge_text = f"TOP {limit} GAINERS"
    badge_w = 150
    badge_h = 30
    badge_x = width - 30 - badge_w
    draw.rounded_rectangle([badge_x, sec_y - 2, badge_x + badge_w, sec_y + badge_h], radius=7, fill=(16, 45, 35, 255), outline=color_green, width=1)
    draw.text((badge_x + 18, sec_y + 4), badge_text, font=font_badge, fill=color_green)

    # Inner Glassy Table Frame
    tbl_x = 30
    tbl_w = width - 60
    tbl_h = height - tbl_y - 22

    draw.rounded_rectangle([tbl_x, tbl_y, tbl_x + tbl_w, tbl_y + tbl_h], radius=12, fill=tbl_bg, outline=tbl_border, width=1)

    # Table Header
    th_h = 42
    draw.rounded_rectangle([tbl_x, tbl_y, tbl_x + tbl_w, tbl_y + th_h], radius=12, fill=th_bg)
    draw.rectangle([tbl_x, tbl_y + th_h - 10, tbl_x + tbl_w, tbl_y + th_h], fill=th_bg)
    draw.line([(tbl_x, tbl_y + th_h), (tbl_x + tbl_w, tbl_y + th_h)], fill=tbl_border, width=1)

    # Column Positions
    c1_x = tbl_x + 24   # SYMBOL
    c2_x = tbl_x + 360  # LTP (₹)
    c3_x = tbl_x + 530  # CHANGE (₹)
    c4_x = tbl_x + 700  # CHANGE (%)

    # Header Texts with Sort Indicators
    draw.text((c1_x, tbl_y + 12), "SYMBOL", font=font_th, fill=color_muted)
    _draw_sort_arrows(draw, c1_x + 64, tbl_y + 14, color_th_arrow)

    draw.text((c2_x, tbl_y + 12), "LTP (₹)", font=font_th, fill=color_muted)
    _draw_sort_arrows(draw, c2_x + 56, tbl_y + 14, color_th_arrow)

    draw.text((c3_x, tbl_y + 12), "CHANGE (₹)", font=font_th, fill=color_muted)
    _draw_sort_arrows(draw, c3_x + 84, tbl_y + 14, color_th_arrow)

    draw.text((c4_x, tbl_y + 12), "CHANGE (%)", font=font_th, fill=color_muted)
    # Down arrow in green next to CHANGE (%)
    draw.polygon([(c4_x + 92, tbl_y + 17), (c4_x + 102, tbl_y + 17), (c4_x + 97, tbl_y + 24)], fill=color_green)

    # Rows (up to 5)
    row_y = tbl_y + th_h
    row_count = min(len(filtered_stocks), limit)
    row_h = 60 if row_count <= 4 else (tbl_h - th_h) / 5

    if not filtered_stocks:
        no_text = "No positive stock gainers found in watchlist today."
        draw.text((tbl_x + 180, row_y + 60), no_text, font=_get_font(18, bold=True), fill=color_muted)
    else:
        for i, s in enumerate(filtered_stocks[:limit]):
            cur_y = row_y + (i * row_h)
            cent_y = cur_y + (row_h / 2) - 12

            if i > 0:
                draw.line([(tbl_x, cur_y), (tbl_x + tbl_w, cur_y)], fill=row_line, width=1)

            # 1. Symbol + Exchange Badge
            sym_text = clean_stock_symbol(str(s.get("symbol", "-"))).upper()
            draw.text((c1_x, cent_y), sym_text, font=font_sym, fill=color_white)

            try:
                sym_bbox = font_sym.getbbox(sym_text)
                sym_w = sym_bbox[2] - sym_bbox[0]
            except Exception:
                sym_w = len(sym_text) * 12

            exch_text = str(s.get("exchange", "NSE")).upper()
            badge_bx = c1_x + sym_w + 10
            badge_by = cent_y + 2
            b_w = 42
            b_h = 20
            draw.rounded_rectangle([badge_bx, badge_by, badge_bx + b_w, badge_by + b_h], radius=5, fill=(30, 58, 138, 255), outline=(59, 130, 246, 255), width=1)
            draw.text((badge_bx + 7, badge_by + 2), exch_text, font=font_exch, fill=(147, 197, 253, 255))

            # 2. LTP
            ltp_str = str(s.get("ltp", "-"))
            if not ltp_str.startswith("₹") and ltp_str != "-":
                ltp_str = f"₹{ltp_str}"
            draw.text((c2_x, cent_y), ltp_str, font=font_val, fill=color_val)

            # 3. Change (₹)
            chg_val = str(s.get("change_val", "-"))
            if chg_val != "-" and not chg_val.startswith("+") and not chg_val.startswith("-"):
                chg_val = f"+{chg_val}"
            if not "₹" in chg_val and chg_val != "-":
                if chg_val.startswith("+"):
                    chg_val = f"+₹{chg_val[1:]}"
                else:
                    chg_val = f"₹{chg_val}"
            draw.text((c3_x, cent_y), chg_val, font=font_val, fill=color_white)

            # 4. Change (%) in bright emerald green
            pct_val = str(s.get("change_pct", "-"))
            if pct_val != "-" and not pct_val.startswith("+") and not pct_val.startswith("-"):
                pct_val = f"+{pct_val}"
            if not pct_val.endswith("%") and pct_val != "-":
                pct_val += "%"
            draw.text((c4_x, cent_y), pct_val, font=font_pct, fill=color_green)

    if output_path:
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        im.save(output_path, "PNG", optimize=True)

    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    buf.seek(0)
    return buf




def generate_quarterly_results_card(
    stocks,
    username="",
    quarter_label="Q2 Earnings Update",
    output_path=None
):
    """
    Renders high-resolution dark glassy card for Quarterly Results.
    - If 1 stock: renders a 4-KPI scorecard layout (PAT, Revenue, EBIDT, EPS).
    - If 2+ stocks: renders a consolidated table layout for portfolio holdings.
    """
    if not PIL_AVAILABLE or Image is None:
        return None

    if not stocks or not isinstance(stocks, list):
        stocks = []

    width = 882
    color_purple = (147, 51, 234, 255)      # #9333ea
    color_green = (16, 185, 129, 255)       # #10b981
    color_red = (239, 68, 68, 255)          # #ef4444
    color_muted = (148, 163, 184, 255)      # #94a3b8
    color_white = (255, 255, 255, 255)
    box_bg = (23, 34, 57, 255)
    box_border = (37, 52, 78, 255)
    tbl_bg = (19, 29, 49, 255)
    tbl_border = (33, 47, 72, 255)
    th_bg = (23, 34, 57, 255)

    font_title = _get_font(23, bold=True)
    font_badge = _get_font(14, bold=True)
    font_sub = _get_font(14, bold=False)

    if len(stocks) == 1:
        # SINGLE STOCK: 4-KPI Scorecard
        stock = stocks[0]
        height = 430
        im = Image.new("RGBA", (width, height), (13, 20, 36, 255))
        draw = ImageDraw.Draw(im)

        # Outer border & glassy background
        draw.rounded_rectangle([6, 6, width - 6, height - 6], radius=20, fill=(17, 24, 43, 255), outline=(37, 52, 78, 255), width=2)

        font_box_label = _get_font(12, bold=True)
        font_box_val = _get_font(25, bold=True)
        font_box_yoy = _get_font(14, bold=True)
        font_sym = _get_font(24, bold=True)
        font_exch = _get_font(12, bold=True)
        font_comp = _get_font(15, bold=False)

        sec_y = 24
        draw.ellipse([30, sec_y + 5, 44, sec_y + 19], fill=color_purple)
        draw.text((54, sec_y), "Quarterly Results Digest", font=font_title, fill=color_white)

        q_name = stock.get("quarter") or quarter_label or "Latest Disclosures"
        holder_prefix = f"{username.capitalize()}'s Portfolio" if username else "Portfolio Holding"
        draw.text((32, sec_y + 36), f"{holder_prefix} • {q_name} Disclosures", font=font_sub, fill=color_muted)

        # Top right badge
        badge_text = "EARNINGS REPORT"
        badge_w = 160
        badge_h = 30
        badge_x = width - 30 - badge_w
        draw.rounded_rectangle([badge_x, sec_y - 2, badge_x + badge_w, sec_y + badge_h], radius=7, fill=(35, 24, 55, 255), outline=color_purple, width=1)
        draw.text((badge_x + 16, sec_y + 4), badge_text, font=font_badge, fill=(192, 132, 252, 255))

        # Company Banner Bar
        banner_y = 78
        banner_h = 58
        draw.rounded_rectangle([30, banner_y, width - 30, banner_y + banner_h], radius=12, fill=(20, 30, 52, 255), outline=box_border, width=1)

        sym_str = clean_stock_symbol(stock.get("symbol", "")).upper()
        draw.text((46, banner_y + 14), sym_str, font=font_sym, fill=color_white)
        sym_w = _measure_text_w(font_sym, sym_str)

        bx = int(46 + sym_w + 10)
        by = banner_y + 18
        draw.rounded_rectangle([bx, by, bx + 38, by + 20], radius=4, fill=(30, 58, 138, 255))
        draw.text((bx + 7, by + 3), str(stock.get("exchange", "NSE")).upper(), font=font_exch, fill=(147, 197, 253, 255))

        comp_name = str(stock.get("company", ""))
        draw.text((bx + 52, banner_y + 19), comp_name, font=font_comp, fill=color_muted)

        # 4 KPI Blocks
        grid_y = banner_y + banner_h + 16
        grid_w = width - 60
        box_w = (grid_w - 36) / 4
        box_h = height - grid_y - 24

        def _fmt_cr(val):
            s = str(val).strip()
            if not s or s == "-":
                return "-"
            if not s.startswith("₹"):
                s = f"₹{s}"
            if not s.endswith("Cr") and not s.endswith("cr"):
                s = f"{s} Cr"
            return s

        def _fmt_eps(val):
            s = str(val).strip()
            if not s or s == "-":
                return "-"
            if not s.startswith("₹"):
                s = f"₹{s}"
            return s

        kpis = [
            {"label": "NET PROFIT (PAT)", "val": _fmt_cr(stock.get("net_profit_val", "-")), "yoy": stock.get("net_profit_yoy", 0)},
            {"label": "REVENUE / SALES", "val": _fmt_cr(stock.get("sales_val", "-")), "yoy": stock.get("sales_yoy", 0)},
            {"label": "OPERATING PROFIT", "val": _fmt_cr(stock.get("ebidt_val", "-")), "yoy": stock.get("ebidt_yoy", 0)},
            {"label": "EPS", "val": _fmt_eps(stock.get("eps_val", "-")), "yoy": stock.get("eps_yoy", 0)},
        ]

        for idx, k in enumerate(kpis):
            cur_bx = int(30 + idx * (box_w + 12))
            draw.rounded_rectangle([cur_bx, grid_y, int(cur_bx + box_w), int(grid_y + box_h)], radius=14, fill=box_bg, outline=box_border, width=1)
            draw.text((cur_bx + 16, grid_y + 20), k["label"], font=font_box_label, fill=color_muted)
            draw.text((cur_bx + 16, grid_y + 54), k["val"], font=font_box_val, fill=color_white)

            yoy = k["yoy"]
            if isinstance(yoy, (int, float)):
                yoy_color = color_green if yoy >= 0 else color_red
                yoy_sign = "+" if yoy >= 0 else ""
                yoy_text = f"{yoy_sign}{yoy:.1f}% YoY"
            else:
                yoy_color = color_muted
                yoy_text = str(yoy)
            draw.text((cur_bx + 16, grid_y + 104), yoy_text, font=font_box_yoy, fill=yoy_color)

    else:
        # MULTI-STOCK CONSOLIDATED TABLE (2+ stocks, up to 5 shown)
        display_stocks = stocks[:5]
        row_count = len(display_stocks)
        height = max(440, 95 + 44 + (row_count * 64) + 24)

        im = Image.new("RGBA", (width, height), (13, 20, 36, 255))
        draw = ImageDraw.Draw(im)

        # Outer border & glassy background
        draw.rounded_rectangle([6, 6, width - 6, height - 6], radius=20, fill=(17, 24, 43, 255), outline=(37, 52, 78, 255), width=2)

        font_th = _get_font(13, bold=True)
        font_sym = _get_font(19, bold=True)
        font_exch = _get_font(11, bold=True)
        font_name = _get_font(12, bold=False)
        font_val = _get_font(18, bold=True)
        font_yoy = _get_font(13, bold=True)

        sec_y = 24
        draw.ellipse([30, sec_y + 5, 44, sec_y + 19], fill=color_purple)
        draw.text((54, sec_y), "Quarterly Results Digest", font=font_title, fill=color_white)

        holder_prefix = f"{username.capitalize()}'s Portfolio" if username else "Portfolio"
        subtitle = f"{len(stocks)} Holdings • {quarter_label or 'Earnings Update'}"
        draw.text((32, sec_y + 36), subtitle, font=font_sub, fill=color_muted)

        # Top right badge
        badge_text = "Q2 EARNINGS" if "Q2" in str(quarter_label).upper() else "EARNINGS SYNC"
        badge_w = 140
        badge_h = 30
        badge_x = width - 30 - badge_w
        draw.rounded_rectangle([badge_x, sec_y - 2, badge_x + badge_w, sec_y + badge_h], radius=7, fill=(35, 24, 55, 255), outline=color_purple, width=1)
        draw.text((badge_x + 18, sec_y + 4), badge_text, font=font_badge, fill=(192, 132, 252, 255))

        # Inner Table Frame
        tbl_x = 30
        tbl_y = 78
        tbl_w = width - 60
        tbl_h = height - tbl_y - 20
        draw.rounded_rectangle([tbl_x, tbl_y, tbl_x + tbl_w, tbl_y + tbl_h], radius=12, fill=tbl_bg, outline=tbl_border, width=1)

        # Table Header
        th_h = 42
        draw.rounded_rectangle([tbl_x, tbl_y, tbl_x + tbl_w, tbl_y + th_h], radius=12, fill=th_bg)
        draw.rectangle([tbl_x, tbl_y + th_h - 10, tbl_x + tbl_w, tbl_y + th_h], fill=th_bg)
        draw.line([(tbl_x, tbl_y + th_h), (tbl_x + tbl_w, tbl_y + th_h)], fill=tbl_border, width=1)

        c1_x = tbl_x + 24   # COMPANY / SYMBOL
        c2_x = tbl_x + 300  # NET PROFIT (PAT)
        c3_x = tbl_x + 500  # SALES / REVENUE
        c4_x = tbl_x + 690  # OPERATING PROFIT

        th_y = tbl_y + 12
        draw.text((c1_x, th_y), "PORTFOLIO STOCK", font=font_th, fill=color_muted)
        draw.text((c2_x, th_y), "NET PROFIT (PAT)", font=font_th, fill=color_muted)
        draw.text((c3_x, th_y), "SALES / REVENUE", font=font_th, fill=color_muted)
        draw.text((c4_x, th_y), "OPERATING PROFIT", font=font_th, fill=color_muted)

        # Table Rows
        row_y = tbl_y + th_h
        row_h = (tbl_h - th_h) / max(row_count, 1)

        for i, item in enumerate(display_stocks):
            curr_y = row_y + (i * row_h)
            if i > 0:
                draw.line([(tbl_x, curr_y), (tbl_x + tbl_w, curr_y)], fill=tbl_border, width=1)

            mid_y = curr_y + (row_h / 2)
            sym = clean_stock_symbol(item.get("symbol", "")).upper()
            sym_w = _measure_text_w(font_sym, sym)

            # Col 1: Symbol & Exchange & Name
            draw.text((c1_x, mid_y - 18), sym, font=font_sym, fill=color_white)

            bx = int(c1_x + sym_w + 8)
            by = int(mid_y - 16)
            draw.rounded_rectangle([bx, by, bx + 36, by + 18], radius=4, fill=(30, 58, 138, 255))
            draw.text((bx + 6, by + 2), str(item.get("exchange", "NSE")).upper(), font=font_exch, fill=(147, 197, 253, 255))

            comp = str(item.get("company", ""))
            if len(comp) > 28:
                comp = comp[:26] + ".."
            draw.text((c1_x, mid_y + 4), comp, font=font_name, fill=color_muted)

            # Col 2: Net Profit & YoY
            pat_str = str(item.get("net_profit_val", "-"))
            if not pat_str.startswith("₹") and pat_str != "-":
                pat_str = f"₹{pat_str} Cr"
            draw.text((c2_x, mid_y - 17), pat_str, font=font_val, fill=color_white)

            pat_yoy = item.get("net_profit_yoy", 0.0)
            if isinstance(pat_yoy, (int, float)):
                pat_color = color_green if pat_yoy >= 0 else color_red
                pat_sign = "+" if pat_yoy >= 0 else ""
                draw.text((c2_x, mid_y + 4), f"{pat_sign}{pat_yoy:.1f}% YoY", font=font_yoy, fill=pat_color)
            else:
                draw.text((c2_x, mid_y + 4), str(pat_yoy), font=font_yoy, fill=color_muted)

            # Col 3: Sales & YoY
            sales_str = str(item.get("sales_val", "-"))
            if not sales_str.startswith("₹") and sales_str != "-":
                sales_str = f"₹{sales_str} Cr"
            draw.text((c3_x, mid_y - 17), sales_str, font=font_val, fill=color_white)

            sales_yoy = item.get("sales_yoy", 0.0)
            if isinstance(sales_yoy, (int, float)):
                sales_color = color_green if sales_yoy >= 0 else color_red
                sales_sign = "+" if sales_yoy >= 0 else ""
                draw.text((c3_x, mid_y + 4), f"{sales_sign}{sales_yoy:.1f}% YoY", font=font_yoy, fill=sales_color)
            else:
                draw.text((c3_x, mid_y + 4), str(sales_yoy), font=font_yoy, fill=color_muted)

            # Col 4: EBIDT / Operating Profit & YoY
            ebidt_str = str(item.get("ebidt_val", "-"))
            if not ebidt_str.startswith("₹") and ebidt_str != "-":
                ebidt_str = f"₹{ebidt_str} Cr"
            draw.text((c4_x, mid_y - 17), ebidt_str, font=font_val, fill=color_white)

            ebidt_yoy = item.get("ebidt_yoy", 0.0)
            if isinstance(ebidt_yoy, (int, float)):
                ebidt_color = color_green if ebidt_yoy >= 0 else color_red
                ebidt_sign = "+" if ebidt_yoy >= 0 else ""
                draw.text((c4_x, mid_y + 4), f"{ebidt_sign}{ebidt_yoy:.1f}% YoY", font=font_yoy, fill=ebidt_color)
            else:
                draw.text((c4_x, mid_y + 4), str(ebidt_yoy), font=font_yoy, fill=color_muted)

    if output_path:
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        im.save(output_path, "PNG", optimize=True)

    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    buf.seek(0)
    return buf
