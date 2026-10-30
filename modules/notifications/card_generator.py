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
    output_path=None
):
    """
    Renders a high-res 882x410 dark-themed card for End-of-Day Portfolio Performance.
    """
    top_gainer_symbol = clean_stock_symbol(top_gainer_symbol)
    top_loser_symbol = clean_stock_symbol(top_loser_symbol)

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
    
    # EOD Badge
    badge_text = "EOD SUMMARY"
    badge_w = 150
    badge_h = 32
    badge_x = width - 32 - badge_w
    draw.rounded_rectangle([badge_x, sec_y, badge_x + badge_w, sec_y + badge_h], radius=7, fill=(16, 40, 32, 255), outline=(16, 185, 129, 255), width=2)
    draw.text((badge_x + 18, sec_y + 6), badge_text, font=font_badge, fill=green_color)

    # Sub-header info
    draw.text((32, sec_y + 36), f"{portfolio_name} • Market Close {date_str}", font=font_sub, fill=text_muted)

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
    output_path=None
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

    width, height = 882, 440
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
    sec_y = 22
    draw.ellipse([30, sec_y + 6, 44, sec_y + 20], fill=color_green)
    display_name = f"{username.capitalize()}'s Watchlist Top Gainers" if username else "Watchlist Top Gainers"
    draw.text((54, sec_y), display_name, font=font_title, fill=color_white)

    # Right Badge: TOP 5 GAINERS
    badge_text = "TOP 5 GAINERS"
    badge_w = 150
    badge_h = 30
    badge_x = width - 30 - badge_w
    draw.rounded_rectangle([badge_x, sec_y - 2, badge_x + badge_w, sec_y + badge_h], radius=7, fill=(16, 45, 35, 255), outline=color_green, width=1)
    draw.text((badge_x + 18, sec_y + 4), badge_text, font=font_badge, fill=color_green)

    # Sub-header info
    draw.text((54, sec_y + 32), f"Market Momentum • {date_str} • Positive Gainers Only", font=font_sub, fill=color_muted)

    # Inner Glassy Table Frame
    tbl_x = 30
    tbl_y = sec_y + 64
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
    row_count = min(len(filtered_stocks), 5)
    row_h = 60 if row_count <= 4 else (tbl_h - th_h) / 5

    if not filtered_stocks:
        no_text = "No positive stock gainers found in watchlist today."
        draw.text((tbl_x + 180, row_y + 60), no_text, font=_get_font(18, bold=True), fill=color_muted)
    else:
        for i, s in enumerate(filtered_stocks[:5]):
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
