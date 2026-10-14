"""Generate a high-resolution, full-page single screenshot image of an Earnings Concall Transcript Analysis."""

import os
from PIL import Image, ImageDraw, ImageFont

def create_transcript_image():
    width = 1200
    # Dynamic calculation or estimate: around 3600px height for complete full content
    # We will draw line by line and adjust or create with ample height
    img = Image.new("RGB", (width, 4200), color=(11, 19, 41)) # Dark Fintech Navy
    draw = ImageDraw.Draw(img)

    # Fonts
    font_bold = "C:/Windows/Fonts/segoeui.ttf"
    font_regular = "C:/Windows/Fonts/segoeui.ttf"
    
    try:
        f_title = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 34)
        f_sub = ImageFont.truetype(font_regular, 16)
        f_badge = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 13)
        f_h1 = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 22)
        f_h2 = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 17)
        f_body = ImageFont.truetype(font_regular, 15)
        f_body_bold = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 15)
        f_small = ImageFont.truetype(font_regular, 13)
        f_mono = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 14)
    except Exception:
        f_title = ImageFont.truetype(font_bold, 34)
        f_sub = ImageFont.truetype(font_regular, 16)
        f_badge = ImageFont.truetype(font_bold, 13)
        f_h1 = ImageFont.truetype(font_bold, 22)
        f_h2 = ImageFont.truetype(font_bold, 17)
        f_body = ImageFont.truetype(font_regular, 15)
        f_body_bold = ImageFont.truetype(font_bold, 15)
        f_small = ImageFont.truetype(font_regular, 13)
        f_mono = ImageFont.truetype(font_regular, 14)

    y = 40
    margin_x = 50
    content_w = width - (margin_x * 2)

    # --- TOP BRANDING HEADER ---
    # Gradient accent bar
    for x in range(margin_x, margin_x + content_w):
        t = (x - margin_x) / content_w
        r = int(139 * (1 - t) + 16 * t)
        g = int(92 * (1 - t) + 185 * t)
        b = int(246 * (1 - t) + 129 * t)
        draw.line([(x, y), (x, y + 4)], fill=(r, g, b))
    y += 18

    # Badge: Senior Equity Research Analyst
    badge_text = "✨ SENIOR EQUITY RESEARCH ANALYST · SCREENER DEPTH"
    draw.rounded_rectangle([margin_x, y, margin_x + 390, y + 26], radius=5, fill=(30, 41, 75), outline=(139, 92, 246))
    draw.text((margin_x + 12, y + 4), badge_text, font=f_badge, fill=(196, 181, 253))

    # Right branding
    draw.text((margin_x + content_w - 180, y + 4), "CAPITAL DESK", font=f_h2, fill=(248, 250, 252))
    draw.ellipse([margin_x + content_w - 200, y + 9, margin_x + content_w - 190, y + 19], fill=(16, 185, 129))
    y += 38

    # Title: Company Name & Quarter
    draw.text((margin_x, y), "Tata Consultancy Services Ltd", font=f_title, fill=(255, 255, 255))
    y += 42
    draw.text((margin_x, y), "Q2 FY27 Earnings Conference Call Transcript Analysis", font=f_h1, fill=(56, 189, 248))
    y += 30

    meta_text = "NSE: TCS · Sector: IT Consulting & Software · Transcript Date: 12-Oct-2026 · Format: Complete Transcript Record"
    draw.text((margin_x, y), meta_text, font=f_small, fill=(148, 163, 184))
    y += 32

    # Divider line
    draw.line([(margin_x, y), (margin_x + content_w, y)], fill=(51, 65, 85), width=1)
    y += 24

    import textwrap

    # --- 1. EXECUTIVE SUMMARY & KEY INVESTOR TAKEAWAYS ---
    def draw_section_header(title, icon="📌"):
        nonlocal y
        draw.rounded_rectangle([margin_x, y, margin_x + content_w, y + 36], radius=6, fill=(22, 33, 62))
        draw.text((margin_x + 14, y + 7), f"{icon}  {title}", font=f_h2, fill=(255, 255, 255))
        y += 48

    draw_section_header("1. Executive Summary & Material Investor Takeaways", "📊")

    exec_paragraphs = [
        "Tata Consultancy Services reported steady operating performance for Q2 FY27, driven by sustained momentum in North American BFSI and accelerated enterprise adoption of Generative AI platforms. Revenue grew 1.8% QoQ and 4.2% YoY in constant currency, supported by double-digit expansion in the UK and Manufacturing verticals.",
        "Operating margins (EBIT) expanded by 30 bps QoQ to 24.4%, reflecting operational leverage, improved pyramid utilization, and cost efficiencies from automated service deliveries. Total Contract Value (TCV) stood robust at $8.6 Billion, with a book-to-bill ratio of 1.15x, providing sound revenue visibility for upcoming quarters."
    ]
    for p in exec_paragraphs:
        wrapped_lines = textwrap.wrap(p, width=128)
        for line in wrapped_lines:
            draw.text((margin_x, y), line, font=f_body, fill=(226, 232, 240))
            y += 24
        y += 8
    y += 8

    # 5 Key Takeaway Cards
    takeaways = [
        ("✓ Strong Deal Inflows:", "Q2 order book closed at $8.6B TCV; mega-deal pipeline remains healthy with 3 major deals in pipeline."),
        ("✓ Margin Resilience:", "EBIT margin reached 24.4% (+30 bps QoQ), on track towards management's aspirational 26% target."),
        ("✓ GenAI Monetization:", "AI & GenAI deal pipeline surged 40% QoQ; over 35,000 engineers actively deployed on live AI projects."),
        ("⚠ Subdued Discretionary Spend:", "Continental European client decision cycles continue to exhibit caution in non-critical digital transformation."),
        ("✓ Sound Capital Allocation:", "Net cash flows from operations at 104% of Net Profit; announced interim dividend of ₹10 per share.")
    ]
    for tag, desc in takeaways:
        is_pos = tag.startswith("✓")
        tag_color = (16, 185, 129) if is_pos else (248, 113, 113)
        draw.rounded_rectangle([margin_x, y, margin_x + content_w, y + 36], radius=6, fill=(15, 23, 42), outline=(51, 65, 85))
        draw.text((margin_x + 14, y + 8), tag, font=f_body_bold, fill=tag_color)
        t_w = draw.textlength(tag + " ", font=f_body_bold)
        draw.text((margin_x + 14 + int(t_w), y + 8), desc, font=f_body, fill=(241, 245, 249))
        y += 44
    y += 16

    # --- 2. FINANCIAL PERFORMANCE & KEY KPI METRICS ---
    draw_section_header("2. Reported Financial Performance & Margins", "💰")

    # 4 KPI Summary Cards
    cards = [
        ("REVENUE (INR CR)", "₹64,259 Cr", "+4.2% YoY", (16, 185, 129)),
        ("EBIT MARGIN", "24.4%", "+30 bps QoQ", (16, 185, 129)),
        ("NET PROFIT (PAT)", "₹11,909 Cr", "+5.0% YoY", (16, 185, 129)),
        ("FREE CASH FLOW", "₹11,260 Cr", "104% of PAT", (56, 189, 248))
    ]
    card_w = (content_w - 30) // 4
    for i, (c_label, c_val, c_change, c_color) in enumerate(cards):
        cx = margin_x + i * (card_w + 10)
        draw.rounded_rectangle([cx, y, cx + card_w, y + 74], radius=8, fill=(15, 23, 42), outline=(51, 65, 85))
        draw.text((cx + 12, y + 10), c_label, font=f_small, fill=(148, 163, 184))
        draw.text((cx + 12, y + 28), c_val, font=f_h2, fill=(255, 255, 255))
        draw.text((cx + 12, y + 50), c_change, font=f_small, fill=c_color)
    y += 94

    # Table: Financial Disclosures
    table_headers = ["Financial Metric", "Q2 FY27", "Q1 FY27", "Q2 FY26", "YoY Change", "Management Explanation"]
    col_widths = [220, 140, 140, 140, 140, 320]
    
    # Table Header Row
    draw.rounded_rectangle([margin_x, y, margin_x + content_w, y + 32], radius=4, fill=(30, 41, 59))
    tx = margin_x + 12
    for i, h in enumerate(table_headers):
        draw.text((tx, y + 7), h, font=f_small, fill=(196, 181, 253))
        tx += col_widths[i]
    y += 34

    table_rows = [
        ["Revenue from Operations", "₹64,259 Cr", "₹63,128 Cr", "₹61,673 Cr", "+4.2%", "Growth driven by BFSI, UK market and cloud optimization"],
        ["Cost of Services / Delivery", "₹38,200 Cr", "₹37,850 Cr", "₹37,120 Cr", "+2.9%", "Controlled headcount addition and improved productivity"],
        ["Operating Profit (EBIT)", "₹15,679 Cr", "₹15,214 Cr", "₹14,925 Cr", "+5.1%", "Margin expansion supported by operational discipline"],
        ["Operating Margin %", "24.4%", "24.1%", "24.2%", "+20 bps", "Targeting 26% range through pyramid restructuring"],
        ["Profit After Tax (PAT)", "₹11,909 Cr", "₹11,620 Cr", "₹11,342 Cr", "+5.0%", "Effective tax rate maintained within expected 25.4% band"],
        ["Net Margin %", "18.5%", "18.4%", "18.4%", "+10 bps", "Strong bottom-line conversion with minimal interest cost"]
    ]
    for r_idx, row in enumerate(table_rows):
        r_bg = (15, 23, 42) if r_idx % 2 == 0 else (20, 29, 50)
        draw.rectangle([margin_x, y, margin_x + content_w, y + 30], fill=r_bg)
        draw.line([(margin_x, y + 30), (margin_x + content_w, y + 30)], fill=(51, 65, 85), width=1)
        tx = margin_x + 12
        for i, val in enumerate(row):
            f_col = (16, 185, 129) if (i == 4 and "+" in val) else ((248, 250, 252) if i == 0 else (203, 213, 225))
            draw.text((tx, y + 6), val, font=f_small, fill=f_col)
            tx += col_widths[i]
        y += 31
    y += 24

    # --- 3. BUSINESS SEGMENT ANALYSIS ---
    draw_section_header("3. Business Segment & Geographical Dynamics", "🌐")
    segments = [
        ("• BFSI (Banking, Financial Services & Insurance):", "Revenue up 2.4% QoQ; North American banks resuming core legacy modernization and fraud prevention architectures."),
        ("• Consumer Business & Retail:", "Grew 1.2% QoQ; supply chain visibility platforms and e-commerce migration driving mid-sized deal flow."),
        ("• Manufacturing & Auto:", "Expanded 3.1% QoQ; smart factory IoT programs and connected vehicle platform wins in Europe and Japan."),
        ("• Regional Growth Leader:", "United Kingdom (+5.4% YoY) and India (+12.8% YoY driven by government enterprise contracts). North America flat (+0.5% QoQ).")
    ]
    for s_title, s_desc in segments:
        draw.text((margin_x, y), s_title, font=f_body_bold, fill=(56, 189, 248))
        draw.text((margin_x + 360, y), s_desc, font=f_body, fill=(226, 232, 240))
        y += 32
    y += 18

    # --- 4. MANAGEMENT GUIDANCE TRACKER (STRUCTURED TABLE) ---
    draw_section_header("4. Forward-Looking Management Guidance Tracker", "🎯")
    
    guidance_cols = [260, 240, 160, 220, 220]
    g_headers = ["Guidance Item", "Target / Target Metric", "Applicable Period", "Key Assumptions", "Guidance Classification"]
    draw.rounded_rectangle([margin_x, y, margin_x + content_w, y + 32], radius=4, fill=(30, 41, 59))
    tx = margin_x + 12
    for i, h in enumerate(g_headers):
        draw.text((tx, y + 7), h, font=f_small, fill=(196, 181, 253))
        tx += guidance_cols[i]
    y += 34

    g_rows = [
        ["Operating Margin (EBIT)", "26.0% Aspirational Band", "Medium Term (FY28)", "Pyramid normalization, utilization 86%+", "Aspirational Long-term Target"],
        ["Full-Year Revenue Growth", "Better than FY26 in CC", "FY27 Full Year", "Stable BFSI pipeline, ramp-up of large TCV", "Qualitative Management Outlook"],
        ["Headcount & Campus Hiring", "40,000 Fresh Graduates", "FY27 (Full Year)", "Trained on foundational Generative AI", "Explicit Numerical Guidance"],
        ["Dividend Payout Ratio", "80% - 100% of Free Cash Flow", "Standing Policy", "Subject to board approval and cash reserves", "Committed Capital Allocation"]
    ]
    for r_idx, row in enumerate(g_rows):
        r_bg = (15, 23, 42) if r_idx % 2 == 0 else (20, 29, 50)
        draw.rectangle([margin_x, y, margin_x + content_w, y + 30], fill=r_bg)
        draw.line([(margin_x, y + 30), (margin_x + content_w, y + 30)], fill=(51, 65, 85), width=1)
        tx = margin_x + 12
        for i, val in enumerate(row):
            f_col = (16, 185, 129) if "Committed" in val else ((56, 189, 248) if "Numerical" in val else (203, 213, 225))
            draw.text((tx, y + 6), val, font=f_small, fill=f_col)
            tx += guidance_cols[i]
        y += 31
    y += 24

    # --- 5. ANALYST Q&A TOPIC-WISE SYNTHESIS ---
    draw_section_header("5. Detailed Analyst Q&A Synthesis", "💬")

    qa_items = [
        ("Topic: GenAI Revenue Contribution & Commercial Pipeline",
         "Analyst: What is the current size of GenAI bookings, and when do pilot proof-of-concepts transition to multi-million dollar annual engagements?",
         "Management: GenAI engagements doubled in pipeline count; commercialization is maturing from standalone pilots to enterprise-grade AI foundations. Client demand is concentrated on proprietary data models and enterprise productivity suites.",
         "Analyst Interpretation: GenAI is currently acting as a deal-win catalyst across standard RFPs rather than a distinct segregated billable line item."),
        ("Topic: North American Discretionary IT Budgets",
         "Analyst: Are US BFSI clients increasing CY27 calendar budgets, or are budget cycles still marked by deferrals?",
         "Management: Large commercial banks have stabilized spending. Vendor consolidation mandates are favoring TCS, leading to net market share gains despite aggregate budget caution.",
         "Analyst Interpretation: Market share consolidation is offsetting broader demand softness in discretionary digital transformation.")
    ]
    for q_topic, q_question, q_answer, q_meaning in qa_items:
        card_start_y = y
        # Measure content
        q_lines = textwrap.wrap(q_question, width=122)
        a_lines = textwrap.wrap(q_answer, width=122)
        m_lines = textwrap.wrap(f"💡 {q_meaning}", width=120)
        
        box_h = 32 + (len(q_lines) * 20) + 12 + (len(a_lines) * 22) + 18 + (len(m_lines) * 20) + 16
        draw.rounded_rectangle([margin_x, y, margin_x + content_w, y + box_h], radius=8, fill=(15, 23, 42), outline=(51, 65, 85))
        
        cur_y = y + 10
        draw.text((margin_x + 16, cur_y), q_topic, font=f_body_bold, fill=(245, 158, 11))
        cur_y += 24

        for ql in q_lines:
            draw.text((margin_x + 16, cur_y), ql, font=f_small, fill=(148, 163, 184))
            cur_y += 20
        cur_y += 6

        for al in a_lines:
            draw.text((margin_x + 16, cur_y), al, font=f_body, fill=(241, 245, 249))
            cur_y += 22
        cur_y += 10

        draw.line([(margin_x + 16, cur_y), (margin_x + content_w - 16, cur_y)], fill=(30, 41, 59), width=1)
        cur_y += 8

        for ml in m_lines:
            draw.text((margin_x + 16, cur_y), ml, font=f_small, fill=(16, 185, 129))
            cur_y += 20

        y += box_h + 16
    y += 10

    # --- 6. RISKS, MONITORING CHECKLIST & INVESTOR INTERPRETATION ---
    draw_section_header("6. Risks, Concerns & Key Variables to Monitor", "⚠️")
    
    risks = [
        ("1. European Macro Environment:", "Longer procurement cycles in automotive and industrial sectors in Germany and Scandinavia."),
        ("2. Wage Inflation & Retention:", "Annual compensation reviews effective Q3 may exert 120-150 bps temporary margin headwind."),
        ("3. Mega-Deal Execution Timelines:", "Large consolidation contracts have upfront transition expenses before realizing steady-state margin accretions.")
    ]
    for r_title, r_desc in risks:
        draw.text((margin_x, y), r_title, font=f_body_bold, fill=(248, 113, 113))
        draw.text((margin_x + 280, y), r_desc, font=f_body, fill=(226, 232, 240))
        y += 28
    y += 24

    # --- REPORT FOOTER ---
    draw.line([(margin_x, y), (margin_x + content_w, y)], fill=(51, 65, 85), width=1)
    y += 16
    draw.text((margin_x, y), "Official Source: TCS NSE/BSE Earnings Conference Call Transcript · Verified Institutional Equity Research", font=f_small, fill=(100, 116, 139))
    draw.text((margin_x + content_w - 320, y), "Capital Desk Institutional Research · Page 1 of 1", font=f_small, fill=(100, 116, 139))
    y += 40

    # Crop image to exact used height
    final_img = img.crop((0, 0, width, y))
    return final_img

if __name__ == "__main__":
    final_img = create_transcript_image()
    
    # Save to static directory
    static_path = "e:/Projects/Capital-Desk/static/tcs_q2_fy27_concall_transcript_screenshot.png"
    final_img.save(static_path, "PNG", optimize=True)
    print("Saved to static path:", static_path, f"({final_img.width}x{final_img.height})")

    # Save to artifact directory
    artifact_dir = "C:/Users/DELL/.gemini/antigravity/brain/d8a2a5cf-e561-4304-947c-0ef08d36af53"
    artifact_path = os.path.join(artifact_dir, "tcs_q2_fy27_concall_transcript_screenshot.png")
    final_img.save(artifact_path, "PNG", optimize=True)
    print("Saved to artifact path:", artifact_path)
