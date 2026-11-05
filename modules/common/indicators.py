import math

def calculate_iwrider(candles, times, closes, n):
    """
    IWRider 2.0 (InvestmentWorks Community by Ayyamuthu)
    - Moving Averages: Fast EMA 20, Mid EMA 50, Slow EMA 200
    - Stan Weinstein 4-Stage Analysis (Accumulation, Markup, Distribution, Markdown)
    - Signals:
        B: Buy (Stage 2 Breakout)
        A: Add (Pyramiding in Stage 2)
        C: Consolidation
        RS: Reduce / Caution (Below EMA 20)
        HS: Half Sell (Below EMA 50)
        E: Full Exit (Below EMA 200)
    - Current Stage & Duration Table Widget
    """
    if n < 5:
        return {
            'current_stage': 'Stage 1: Accumulation',
            'current_stage_num': 1,
            'duration': 1,
            'stage_color': '#64748b',
            'markers': [],
            'ema20': [],
            'ema50': [],
            'ema200': []
        }

    # Robust EMA generator
    def get_ema_series(period):
        eff_period = min(period, max(2, n // 2))
        k = 2.0 / (eff_period + 1)
        ema = [0.0] * n
        init_val = sum(closes[:eff_period]) / float(eff_period)
        ema[eff_period - 1] = init_val
        for j in range(eff_period, n):
            ema[j] = (closes[j] * k) + (ema[j - 1] * (1.0 - k))
        for j in range(eff_period - 1):
            ema[j] = ema[eff_period - 1]
        return ema

    ema20_vals = get_ema_series(20)
    ema50_vals = get_ema_series(50)
    ema200_vals = get_ema_series(200 if n >= 60 else min(50, n))

    # Lightweight Charts series data
    ema20_series = [{'time': times[i], 'value': round(ema20_vals[i], 2)} for i in range(n) if i >= min(19, n-1)]
    ema50_series = [{'time': times[i], 'value': round(ema50_vals[i], 2)} for i in range(n) if i >= min(49, n-1)]
    ema200_series = [{'time': times[i], 'value': round(ema200_vals[i], 2)} for i in range(n) if i >= min(199, n-1)]

    stages = [1] * n
    stage_names = ["Stage 1: Accumulation"] * n

    for i in range(n):
        c = closes[i]
        e20 = ema20_vals[i]
        e50 = ema50_vals[i]
        e200 = ema200_vals[i]
        prev_st = stages[i-1] if i > 0 else 1
        
        slope50 = (e50 - ema50_vals[max(0, i-3)])

        # Stage 2: Advancing / Markup (Strong uptrend)
        is_markup = (c > e50 and e20 >= e50 and (c > e200 or e50 >= e200 * 0.97) and slope50 >= -0.01)

        # Stage 4: Declining / Markdown (Downtrend)
        is_markdown = (c < e50 and e20 <= e50 and (c < e200 or e50 < e200) and slope50 <= 0.01)

        if is_markup:
            stages[i] = 2
            stage_names[i] = "Stage 2: Markup"
        elif is_markdown:
            stages[i] = 4
            stage_names[i] = "Stage 4: Markdown"
        else:
            if prev_st == 2 or prev_st == 3:
                if c < e200 and e50 < e200:
                    stages[i] = 4
                    stage_names[i] = "Stage 4: Markdown"
                else:
                    stages[i] = 3
                    stage_names[i] = "Stage 3: Distribution"
            else:
                if c > e50 and e20 > e50:
                    stages[i] = 2
                    stage_names[i] = "Stage 2: Markup"
                else:
                    stages[i] = 1
                    stage_names[i] = "Stage 1: Accumulation"

    curr_stage_num = stages[-1]
    curr_stage_name = stage_names[-1]

    stage_start_idx = n - 1
    while stage_start_idx > 0 and stages[stage_start_idx - 1] == curr_stage_num:
        stage_start_idx -= 1

    import datetime
    def parse_dt(t):
        if isinstance(t, str):
            try: return datetime.datetime.strptime(t[:10], '%Y-%m-%d').date()
            except Exception: return None
        elif isinstance(t, (int, float)):
            try: return datetime.datetime.fromtimestamp(t).date()
            except Exception: return None
        return None

    d_start = parse_dt(times[stage_start_idx])
    d_curr = parse_dt(times[-1])
    if d_start and d_curr:
        stage_duration = max(1, (d_curr - d_start).days)
    else:
        stage_duration = n - stage_start_idx

    stage_colors = {
        1: '#64748b', # Slate (Accumulation)
        2: '#10b981', # Green (Markup)
        3: '#f59e0b', # Amber / Orange (Distribution)
        4: '#ef4444'  # Red (Markdown)
    }
    curr_stage_color = stage_colors.get(curr_stage_num, '#f59e0b')

    markers = []
    last_signal_idx = -10
    last_signal_type = None

    for i in range(1, n):
        t = times[i]
        c = closes[i]
        prev_c = closes[i-1]
        o = candles[i].get('open', c)
        h = candles[i].get('high', c)
        l = candles[i].get('low', c)
        e20 = ema20_vals[i]
        e50 = ema50_vals[i]
        e200 = ema200_vals[i]
        prev_e50 = ema50_vals[i-1]
        prev_e200 = ema200_vals[i-1]
        st = stages[i]
        prev_st = stages[i-1]

        # 1. FULL EXIT (E) — below EMA 200 or Stage 4 trigger
        if (c < e200 and prev_c >= prev_e200) or (prev_st != 4 and st == 4 and last_signal_type != 'E'):
            markers.append({
                'time': t,
                'position': 'aboveBar',
                'color': '#a855f7',
                'shape': 'arrowDown',
                'text': 'E'
            })
            last_signal_idx = i
            last_signal_type = 'E'
            continue

        # 2. HALF SELL (HS) — below EMA 50
        if (c < e50 and prev_c >= prev_e50) and (prev_st in (2, 3) or st == 3) and last_signal_type not in ('HS', 'E'):
            markers.append({
                'time': t,
                'position': 'aboveBar',
                'color': '#ef4444',
                'shape': 'arrowDown',
                'text': 'HS'
            })
            last_signal_idx = i
            last_signal_type = 'HS'
            continue

        # 3. BUY (B) — Initial Stage 2 Breakout
        is_buy_trigger = (
            (st == 2 and prev_st != 2) or
            (st == 2 and c > e20 and c > e50 and prev_c <= e20 and c > o)
        )
        if is_buy_trigger and (i - last_signal_idx >= 6 or last_signal_type in ('E', 'HS')):
            markers.append({
                'time': t,
                'position': 'belowBar',
                'color': '#10b981',
                'shape': 'arrowUp',
                'text': 'B'
            })
            last_signal_idx = i
            last_signal_type = 'B'
            continue

        # 4. ADD (A) — Pyramiding in Stage 2
        if st == 2 and (i - last_signal_idx >= 3) and last_signal_type in ('B', 'A'):
            bounced_20 = (l <= e20 * 1.015 and c > e20 and c > o)
            prev_8_high = max([candles[k].get('high', closes[k]) for k in range(max(0, i-8), i)])
            breakout_high = (c > prev_8_high and c > e20 and c > o)

            if bounced_20 or breakout_high:
                markers.append({
                    'time': t,
                    'position': 'belowBar',
                    'color': '#10b981',
                    'shape': 'arrowUp',
                    'text': 'A'
                })
                last_signal_idx = i
                last_signal_type = 'A'
                continue

        # 5. REDUCE / CAUTION (RS) — warning below 20 EMA in Stage 3
        if st == 3 and c < e20 and prev_c >= e20 and c > e50 and (i - last_signal_idx >= 4):
            markers.append({
                'time': t,
                'position': 'aboveBar',
                'color': '#f59e0b',
                'shape': 'arrowDown',
                'text': 'RS'
            })
            last_signal_idx = i
            last_signal_type = 'RS'
            continue

    return {
        'current_stage': curr_stage_name,
        'current_stage_num': curr_stage_num,
        'duration': stage_duration,
        'stage_color': curr_stage_color,
        'markers': markers,
        'ema20': ema20_series,
        'ema50': ema50_series,
        'ema200': ema200_series
    }


def calculate_indicators(candles):
    closes = [c['close'] for c in candles]
    times = [c['time'] for c in candles]
    n = len(candles)
    
    sma20 = []
    sma50 = []
    sma200 = []
    bollinger_upper = []
    bollinger_lower = []
    bollinger_middle = []
    
    for i in range(n):
        if i >= 19:
            window = closes[i-19:i+1]
            avg_20 = sum(window) / 20.0
            sma20.append({'time': times[i], 'value': round(avg_20, 2)})
            
            variance = sum((x - avg_20) ** 2 for x in window) / 20.0
            std_dev = math.sqrt(variance)
            bollinger_middle.append({'time': times[i], 'value': round(avg_20, 2)})
            bollinger_upper.append({'time': times[i], 'value': round(avg_20 + 2 * std_dev, 2)})
            bollinger_lower.append({'time': times[i], 'value': round(avg_20 - 2 * std_dev, 2)})
            
        if i >= 49:
            avg_50 = sum(closes[i-49:i+1]) / 50.0
            sma50.append({'time': times[i], 'value': round(avg_50, 2)})
            
        if i >= 199:
            avg_200 = sum(closes[i-199:i+1]) / 200.0
            sma200.append({'time': times[i], 'value': round(avg_200, 2)})

    def calc_ema(period):
        if n < period:
            return []
        k = 2.0 / (period + 1)
        ema_list = []
        sma_init = sum(closes[:period]) / float(period)
        curr_ema = sma_init
        ema_list.append({'time': times[period-1], 'value': round(curr_ema, 2)})
        for j in range(period, n):
            curr_ema = (closes[j] * k) + (curr_ema * (1.0 - k))
            ema_list.append({'time': times[j], 'value': round(curr_ema, 2)})
        return ema_list

    ema9 = calc_ema(9)
    ema21 = calc_ema(21)
    ema50 = calc_ema(50)

    macd_line = []
    macd_signal = []
    macd_hist = []
    if n >= 26:
        k12 = 2.0 / 13.0
        k26 = 2.0 / 27.0
        ema12_val = sum(closes[:12]) / 12.0
        ema26_val = sum(closes[:26]) / 26.0
        
        for j in range(12, 26):
            ema12_val = (closes[j] * k12) + (ema12_val * (1.0 - k12))
            
        macd_vals = []
        macd_times = []
        for j in range(25, n):
            if j > 25:
                ema12_val = (closes[j] * k12) + (ema12_val * (1.0 - k12))
                ema26_val = (closes[j] * k26) + (ema26_val * (1.0 - k26))
            m_val = ema12_val - ema26_val
            macd_vals.append(m_val)
            macd_times.append(times[j])
            macd_line.append({'time': times[j], 'value': round(m_val, 2)})

        if len(macd_vals) >= 9:
            k9 = 2.0 / 10.0
            sig_val = sum(macd_vals[:9]) / 9.0
            macd_signal.append({'time': macd_times[8], 'value': round(sig_val, 2)})
            macd_hist.append({
                'time': macd_times[8],
                'value': round(macd_vals[8] - sig_val, 2),
                'color': '#26a69a' if (macd_vals[8] - sig_val) >= 0 else '#ef5350'
            })
            for j in range(9, len(macd_vals)):
                sig_val = (macd_vals[j] * k9) + (sig_val * (1.0 - k9))
                diff = macd_vals[j] - sig_val
                macd_signal.append({'time': macd_times[j], 'value': round(sig_val, 2)})
                macd_hist.append({
                    'time': macd_times[j],
                    'value': round(diff, 2),
                    'color': '#26a69a' if diff >= 0 else '#ef5350'
                })

    rsi = []
    gains = []
    losses = []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i-1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))
        
    if len(gains) >= 14:
        avg_gain = sum(gains[:14]) / 14.0
        avg_loss = sum(losses[:14]) / 14.0
        
        for i in range(13, len(gains)):
            if i > 13:
                avg_gain = (avg_gain * 13 + gains[i]) / 14.0
                avg_loss = (avg_loss * 13 + losses[i]) / 14.0
            
            rs = avg_gain / avg_loss if avg_loss != 0 else 100
            rsi_val = 100 - (100 / (1 + rs)) if avg_loss != 0 else 100
            rsi.append({'time': candles[i+1]['time'], 'value': round(rsi_val, 2)})
            
    # Gann 2-Day Swing Low (Trailing Stop)
    gann_2day = []
    trailing_stop = None
    for i in range(n):
        if i >= 2:
            high0 = candles[i]['high']
            high1 = candles[i-1]['high']
            high2 = candles[i-2]['high']
            if high2 < high1 and high1 < high0:
                trailing_stop = candles[i-2]['low']
        if trailing_stop is not None:
            gann_2day.append({'time': times[i], 'value': round(trailing_stop, 2)})

    # CDRider Indicator (Supertrend 10, 3.0 ATR)
    cdrider = []
    cdrider_buy = []
    cdrider_sell = []
    if n >= 10:
        tr = [0.0] * n
        tr[0] = candles[0]['high'] - candles[0]['low']
        for i in range(1, n):
            h = candles[i]['high']
            l = candles[i]['low']
            prev_c = candles[i-1]['close']
            tr[i] = max(h - l, abs(h - prev_c), abs(l - prev_c))

        atr = [0.0] * n
        atr[9] = sum(tr[:10]) / 10.0
        for i in range(10, n):
            atr[i] = (atr[i-1] * 9.0 + tr[i]) / 10.0

        up = [0.0] * n
        dn = [0.0] * n
        trend = [1] * n

        for i in range(10, n):
            hl2 = (candles[i]['high'] + candles[i]['low']) / 2.0
            basic_up = hl2 - (3.0 * atr[i])
            basic_dn = hl2 + (3.0 * atr[i])

            prev_up = up[i-1] if i > 10 else basic_up
            prev_dn = dn[i-1] if i > 10 else basic_dn
            prev_close = candles[i-1]['close']

            curr_up = max(basic_up, prev_up) if prev_close > prev_up else basic_up
            curr_dn = min(basic_dn, prev_dn) if prev_close < prev_dn else basic_dn

            up[i] = curr_up
            dn[i] = curr_dn

            prev_trend = trend[i-1] if i > 10 else 1
            curr_close = candles[i]['close']

            if prev_trend == -1 and curr_close > prev_dn:
                curr_trend = 1
            elif prev_trend == 1 and curr_close < prev_up:
                curr_trend = -1
            else:
                curr_trend = prev_trend

            trend[i] = curr_trend
            val = curr_up if curr_trend == 1 else curr_dn
            time_val = times[i]

            cdrider.append({
                'time': time_val,
                'value': round(val, 2),
                'color': '#10b981' if curr_trend == 1 else '#ef5350'
            })

            if i > 10:
                if curr_trend == 1 and prev_trend == -1:
                    cdrider_buy.append({
                        'time': time_val,
                        'position': 'belowBar',
                        'color': '#10b981',
                        'shape': 'arrowUp',
                        'text': 'BUY'
                    })
                elif curr_trend == -1 and prev_trend == 1:
                    cdrider_sell.append({
                        'time': time_val,
                        'position': 'aboveBar',
                        'color': '#ef5350',
                        'shape': 'arrowDown',
                        'text': 'SELL'
                    })

    # ── BS Donchian Channel with Super B (B/S) ──
    donchian_upper = []
    donchian_middle = []
    donchian_lower = []
    donchian_buy = []
    donchian_super_buy = []
    donchian_sell = []
    donchian_signals = []

    donchian_length = 20
    vol_avg_length = 20

    if n >= donchian_length:
        eligible_for_super_b = False
        highs = [c['high'] for c in candles]
        lows = [c['low'] for c in candles]
        opens = [c['open'] for c in candles]
        vols = [float(c.get('volume') or 0) for c in candles]

        for i in range(donchian_length - 1, n):
            win_highs = highs[i - donchian_length + 1 : i + 1]
            win_lows = lows[i - donchian_length + 1 : i + 1]
            up_band = max(win_highs)
            dn_band = min(win_lows)
            mid_band = (up_band + dn_band) / 2.0

            time_val = times[i]
            donchian_upper.append({'time': time_val, 'value': round(up_band, 2)})
            donchian_middle.append({'time': time_val, 'value': round(mid_band, 2)})
            donchian_lower.append({'time': time_val, 'value': round(dn_band, 2)})

            c_open = opens[i]
            c_high = highs[i]
            c_low = lows[i]
            c_close = closes[i]
            c_vol = vols[i]

            is_green = c_close > c_open
            is_red = c_close < c_open

            # Touching condition: band value falls within candle's high-low range
            touching_up = (c_high >= up_band - 0.01) and (c_low <= up_band + 0.01)
            touching_dn = (c_high >= dn_band - 0.01) and (c_low <= dn_band + 0.01)
            touching_mid = (c_high >= mid_band - 0.01) and (c_low <= mid_band + 0.01)

            # Volume condition: volume > 20-period volume SMA
            win_vols = vols[i - vol_avg_length + 1 : i + 1]
            avg_vol = sum(win_vols) / float(vol_avg_length)
            above_avg_vol = c_vol > avg_vol

            # Base signal conditions
            buy_condition = is_green and touching_up
            sell_condition = is_red and touching_mid and above_avg_vol

            # Super B Logic
            if touching_dn or touching_mid:
                eligible_for_super_b = True

            super_b_condition = buy_condition and eligible_for_super_b
            regular_b_condition = buy_condition and not eligible_for_super_b

            if super_b_condition:
                eligible_for_super_b = False

            if regular_b_condition:
                donchian_buy.append({
                    'time': time_val,
                    'position': 'belowBar',
                    'color': '#2962ff',
                    'shape': 'arrowUp',
                    'text': 'B',
                    'size': 1
                })
                donchian_signals.append({
                    'time': time_val,
                    'type': 'buy',
                    'label': 'B',
                    'price': c_close
                })
            elif super_b_condition:
                donchian_super_buy.append({
                    'time': time_val,
                    'position': 'belowBar',
                    'color': '#ffc300',
                    'shape': 'arrowUp',
                    'text': 'SB',
                    'size': 2
                })
                donchian_signals.append({
                    'time': time_val,
                    'type': 'super_buy',
                    'label': 'SB',
                    'price': c_close
                })

            if sell_condition:
                donchian_sell.append({
                    'time': time_val,
                    'position': 'aboveBar',
                    'color': '#ef5350',
                    'shape': 'arrowDown',
                    'text': 'S',
                    'size': 1
                })
                donchian_signals.append({
                    'time': time_val,
                    'type': 'sell',
                    'label': 'S',
                    'price': c_close
                })

    # ── Supertrend Trigger Levels (ST Trigger: ATR 1, Mult 2.5) ──
    st_trigger_series = []
    st_trigger_buy = []
    st_trigger_sell = []
    st_trigger_info = {}

    if n >= 2:
        st_atr_len = 1
        st_mult = 2.5

        # True Range calculation (ta.atr(1) == True Range)
        st_tr = [0.0] * n
        st_tr[0] = candles[0]['high'] - candles[0]['low']
        for i in range(1, n):
            h = candles[i]['high']
            l = candles[i]['low']
            prev_c = candles[i-1]['close']
            st_tr[i] = max(h - l, abs(h - prev_c), abs(l - prev_c))

        st_f_up = [0.0] * n
        st_f_lo = [0.0] * n
        st_dirn = [1] * n

        for i in range(n):
            c = candles[i]
            src = (c['high'] + c['low']) / 2.0
            ub = src + (st_mult * st_tr[i])
            lb = src - (st_mult * st_tr[i])

            if i == 0:
                st_f_up[0] = ub
                st_f_lo[0] = lb
                st_dirn[0] = 1
                curr_dirn = 1
            else:
                p_up = st_f_up[i-1]
                p_lo = st_f_lo[i-1]
                prev_c = candles[i-1]['close']

                curr_lo = lb if (lb > p_lo or prev_c < p_lo) else p_lo
                curr_up = ub if (ub < p_up or prev_c > p_up) else p_up

                st_f_lo[i] = curr_lo
                st_f_up[i] = curr_up

                prev_dirn = st_dirn[i-1]
                curr_close = c['close']

                if prev_dirn == 1:
                    curr_dirn = -1 if curr_close < curr_lo else 1
                else:
                    curr_dirn = 1 if curr_close > curr_up else -1

                st_dirn[i] = curr_dirn

                # Flips
                if curr_dirn == 1 and prev_dirn == -1:
                    st_trigger_buy.append({
                        'time': times[i],
                        'position': 'belowBar',
                        'color': '#10b981',
                        'shape': 'arrowUp',
                        'text': 'ST Buy'
                    })
                elif curr_dirn == -1 and prev_dirn == 1:
                    st_trigger_sell.append({
                        'time': times[i],
                        'position': 'aboveBar',
                        'color': '#ef5350',
                        'shape': 'arrowDown',
                        'text': 'ST Sell'
                    })

            is_down = (curr_dirn == -1)
            trig = st_f_up[i] if is_down else st_f_lo[i]
            dist_pct = ((trig / c['close']) - 1.0) * 100.0 if c['close'] else 0.0
            dist_pts = trig - c['close']

            st_trigger_series.append({
                'time': times[i],
                'value': round(trig, 2),
                'color': '#ef5350' if is_down else '#10b981',
                'trigger': round(trig, 2),
                'direction': 'SELL' if is_down else 'BUY',
                'dist_pct': round(dist_pct, 2),
                'dist_pts': round(dist_pts, 2)
            })

        latest_c = candles[-1]
        latest_is_down = (st_dirn[-1] == -1)
        latest_trig = st_f_up[-1] if latest_is_down else st_f_lo[-1]
        latest_dist_pct = ((latest_trig / latest_c['close']) - 1.0) * 100.0 if latest_c['close'] else 0.0
        latest_dist_pts = latest_trig - latest_c['close']
        fresh = 1 if (n > 1 and st_dirn[-1] != st_dirn[-2]) else 0

        st_trigger_info = {
            'direction': 'SELL' if latest_is_down else 'BUY',
            'trigger': round(latest_trig, 2),
            'dist_pct': round(latest_dist_pct, 2),
            'dist_pts': round(latest_dist_pts, 2),
            'prev_up': round(st_f_up[-2] if n > 1 else st_f_up[-1], 2),
            'prev_lo': round(st_f_lo[-2] if n > 1 else st_f_lo[-1], 2),
            'fresh': fresh,
            'atr_len': 1,
            'mult': 2.5
        }

    # IWRider 2.0 (Weinstein Stage Analysis + Trend Riding)
    try:
        iwrider = calculate_iwrider(candles, times, closes, n)
    except Exception as e:
        iwrider = {
            'current_stage': 'Stage 1: Accumulation',
            'current_stage_num': 1,
            'duration': 1,
            'stage_color': '#64748b',
            'markers': [],
            'ema20': [],
            'ema50': [],
            'ema200': []
        }

    return {
        'iwrider': iwrider,
        'sma20': sma20,
        'sma50': sma50,
        'sma200': sma200,
        'ema9': ema9,
        'ema21': ema21,
        'ema50': ema50,
        'bollinger_upper': bollinger_upper,
        'bollinger_middle': bollinger_middle,
        'bollinger_lower': bollinger_lower,
        'gann_2day': gann_2day,
        'cdrider': cdrider,
        'cdrider_buy': cdrider_buy,
        'cdrider_sell': cdrider_sell,
        'donchian_upper': donchian_upper,
        'donchian_middle': donchian_middle,
        'donchian_lower': donchian_lower,
        'donchian_buy': donchian_buy,
        'donchian_super_buy': donchian_super_buy,
        'donchian_sell': donchian_sell,
        'donchian_signals': donchian_signals,
        'st_trigger_series': st_trigger_series,
        'st_trigger_buy': st_trigger_buy,
        'st_trigger_sell': st_trigger_sell,
        'st_trigger_info': st_trigger_info,
        'macd_line': macd_line,
        'macd_signal': macd_signal,
        'macd_hist': macd_hist,
        'rsi': rsi
    }
