import os
import io
from PIL import Image, ImageDraw, ImageFont

# Try loading system fonts or fallback
def _get_font(size, bold=False):
    font_paths = [
        r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\calibrib.ttf" if bold else r"C:\Windows\Fonts\calibri.ttf",
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                continue
    return ImageFont.load_default()

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
    # Gold Title
    draw.text((32, sec1_y), "👑 Standard Gold (22 Karat)", font=font_title, fill=(255, 255, 255, 255))
    
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
    draw.text((32, sec2_y), "🥈 Ready Silver", font=font_title, fill=(255, 255, 255, 255))

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
    draw.text((32, sec_y), "📈 Portfolio Performance Digest", font=font_title, fill=(255, 255, 255, 255))
    
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
    draw.text((54, box_y + 130), "✅ Net Daily Market Return" if is_positive else "⚠️ Daily Drawdown", font=font_sub, fill=text_muted)
    draw.text((54, box_y + 160), "CAPITAL DESK ANALYTICS", font=_get_font(13, bold=True), fill=(99, 102, 241, 255))

    # Right Col: Top Gainer (Upper) & Top Loser (Lower)
    col2_x = 32 + col1_w + 20
    half_h = (box_total_h - 16) // 2

    # Top Gainer Box
    draw.rounded_rectangle([col2_x, box_y, col2_x + col2_w, box_y + half_h], radius=14, fill=card_box_bg, outline=card_box_border, width=2)
    draw.text((col2_x + 24, box_y + 16), "🚀 TOP GAINER", font=font_label, fill=text_muted)
    draw.text((col2_x + 24, box_y + 44), str(top_gainer_symbol), font=font_symbol, fill=(255, 255, 255, 255))
    
    g_change = str(top_gainer_change).strip()
    if not g_change.startswith("+") and not g_change.startswith("-"):
        g_change = f"+{g_change}"
    if not g_change.endswith("%"):
        g_change += "%"
    
    # Gainer badge pill
    g_pill_w = 120
    g_pill_x = col2_x + col2_w - 24 - g_pill_w
    draw.rounded_rectangle([g_pill_x, box_y + 40, g_pill_x + g_pill_w, box_y + 80], radius=8, fill=(16, 45, 35, 255), outline=green_color, width=1)
    draw.text((g_pill_x + 14, box_y + 48), g_change, font=font_change, fill=green_color)

    # Top Loser Box
    box_loser_y = box_y + half_h + 16
    draw.rounded_rectangle([col2_x, box_loser_y, col2_x + col2_w, box_loser_y + half_h], radius=14, fill=card_box_bg, outline=card_box_border, width=2)
    draw.text((col2_x + 24, box_loser_y + 16), "🔻 TOP LOSER", font=font_label, fill=text_muted)
    draw.text((col2_x + 24, box_loser_y + 44), str(top_loser_symbol), font=font_symbol, fill=(255, 255, 255, 255))

    l_change = str(top_loser_change).strip()
    if not l_change.startswith("-"):
        l_change = f"-{l_change}"
    if not l_change.endswith("%"):
        l_change += "%"

    # Loser badge pill
    l_pill_w = 120
    l_pill_x = col2_x + col2_w - 24 - l_pill_w
    draw.rounded_rectangle([l_pill_x, box_loser_y + 40, l_pill_x + l_pill_w, box_loser_y + 80], radius=8, fill=(45, 20, 20, 255), outline=red_color, width=1)
    draw.text((l_pill_x + 14, box_loser_y + 48), l_change, font=font_change, fill=red_color)

    if output_path:
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        im.save(output_path, "PNG", optimize=True)

    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    buf.seek(0)
    return buf
