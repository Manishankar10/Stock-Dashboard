import math

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

    return {
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
        'macd_line': macd_line,
        'macd_signal': macd_signal,
        'macd_hist': macd_hist,
        'rsi': rsi
    }
