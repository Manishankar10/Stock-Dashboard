file_path = "modules/market_data/market_data_routes.py"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update open_v fallback to distinguish between daily and other intervals
old_open_block = '''        if open_v is None:
            open_v = meta.get('regularMarketOpen') or (candles[-1]['close'] if candles else None) or meta.get('chartPreviousClose') or meta.get('previousClose') or close_v
        if high_v is None: high_v = max(open_v, close_v)
        if low_v is None: low_v = min(open_v, close_v)'''

new_open_block = '''        is_daily = (interval == '1d')
        if open_v is None:
            if is_daily:
                open_v = meta.get('regularMarketOpen') or (candles[-1]['close'] if candles else None) or meta.get('chartPreviousClose') or meta.get('previousClose') or close_v
            else:
                open_v = (candles[-1]['close'] if candles else None) or meta.get('chartPreviousClose') or meta.get('previousClose') or close_v
        if high_v is None: high_v = max(open_v, close_v)
        if low_v is None: low_v = min(open_v, close_v)'''

assert old_open_block in content, "old_open_block not found"
content = content.replace(old_open_block, new_open_block, 1)

# 2. Update regularMarketPrice merge block
old_merge_block = '''    # Merge meta regularMarketPrice if market time date is available
    if reg_price and reg_time:
        reg_dt = datetime.datetime.fromtimestamp(reg_time, tz=ist_tz)
        if is_intraday:
            reg_key = reg_time
            reg_time_val = reg_time
        elif interval in ('1w', '1wk'):
            iso_year, iso_week, _ = reg_dt.isocalendar()
            reg_key = f"{iso_year}-W{iso_week:02d}"
            monday = reg_dt - datetime.timedelta(days=reg_dt.weekday())
            reg_time_val = monday.strftime('%Y-%m-%d')
        elif interval in ('1m', '1mo'):
            reg_key = reg_dt.strftime('%Y-%m')
            reg_time_val = reg_dt.strftime('%Y-%m-01')
        else:
            reg_key = reg_dt.strftime('%Y-%m-%d')
            reg_time_val = reg_dt.strftime('%Y-%m-%d')

        reg_price_val = round(float(reg_price), 2)

        if reg_key in candle_map:
            idx = candle_map[reg_key]
            existing_c = candles[idx]
            existing_v = volume_data[idx]
            existing_c['high'] = max(existing_c['high'], reg_price_val, meta.get('regularMarketDayHigh') or reg_price_val)
            existing_c['low'] = min(existing_c['low'], reg_price_val, meta.get('regularMarketDayLow') or reg_price_val)
            existing_c['close'] = reg_price_val
            existing_c['volume'] = int(meta.get('regularMarketVolume') or existing_c.get('volume', 0))
            is_up = existing_c['close'] >= existing_c['open']
            existing_v['color'] = '#26a69a' if is_up else '#ef5350'
        else:
            reg_open_val = meta.get('regularMarketOpen') or (candles[-1]['close'] if candles else None) or meta.get('chartPreviousClose') or meta.get('previousClose') or reg_price_val
            reg_open_val = round(float(reg_open_val), 2)
            reg_high_val = round(float(meta.get('regularMarketDayHigh') or max(reg_open_val, reg_price_val)), 2)
            reg_low_val = round(float(meta.get('regularMarketDayLow') or min(reg_open_val, reg_price_val)), 2)

            is_up = reg_price_val >= reg_open_val
            candle_map[reg_key] = len(candles)
            candles.append({
                'time': reg_time_val,
                'open': reg_open_val,
                'high': max(reg_high_val, reg_open_val, reg_price_val),
                'low': min(reg_low_val, reg_open_val, reg_price_val),
                'close': reg_price_val,
                'volume': int(meta.get('regularMarketVolume') or 0)
            })
            volume_data.append({
                'time': reg_time_val,
                'value': int(meta.get('regularMarketVolume') or 0),
                'color': '#26a69a' if is_up else '#ef5350'
            })'''

new_merge_block = '''    # Merge meta regularMarketPrice if market time date is available
    if reg_price and reg_time:
        reg_dt = datetime.datetime.fromtimestamp(reg_time, tz=ist_tz)
        reg_price_val = round(float(reg_price), 2)
        is_daily = (interval == '1d')

        if is_intraday:
            intraday_step = {
                '5m': 300,
                '15m': 900,
                '30m': 1800,
                '60m': 3600,
                '1h': 3600,
                '90m': 5400
            }.get(interval, 300)

            if candles:
                last_c = candles[-1]
                last_v = volume_data[-1] if volume_data else None
                last_ts = int(last_c['time']) if isinstance(last_c['time'], (int, float)) else None

                # If reg_time falls within the current candle's interval window:
                if last_ts is not None and abs(reg_time - last_ts) < intraday_step:
                    # Update existing candle in place; NEVER use day high / low
                    last_c['close'] = reg_price_val
                    last_c['high'] = max(last_c['high'], reg_price_val)
                    last_c['low'] = min(last_c['low'], reg_price_val)
                    is_up = last_c['close'] >= last_c['open']
                    if last_v:
                        last_v['color'] = '#26a69a' if is_up else '#ef5350'
                elif last_ts is not None and reg_time >= (last_ts + intraday_step):
                    # A subsequent intraday bar has started: bucket cleanly
                    new_ts = last_ts + intraday_step * int((reg_time - last_ts) // intraday_step)
                    reg_open_val = last_c['close']
                    candles.append({
                        'time': new_ts,
                        'open': reg_open_val,
                        'high': max(reg_open_val, reg_price_val),
                        'low': min(reg_open_val, reg_price_val),
                        'close': reg_price_val,
                        'volume': 0
                    })
                    volume_data.append({
                        'time': new_ts,
                        'value': 0,
                        'color': '#26a69a' if reg_price_val >= reg_open_val else '#ef5350'
                    })
            else:
                candles.append({
                    'time': reg_time,
                    'open': reg_price_val,
                    'high': reg_price_val,
                    'low': reg_price_val,
                    'close': reg_price_val,
                    'volume': 0
                })
                volume_data.append({
                    'time': reg_time,
                    'value': 0,
                    'color': '#26a69a'
                })

        elif interval in ('1w', '1wk'):
            iso_year, iso_week, _ = reg_dt.isocalendar()
            reg_key = f"{iso_year}-W{iso_week:02d}"
            monday = reg_dt - datetime.timedelta(days=reg_dt.weekday())
            reg_time_val = monday.strftime('%Y-%m-%d')

            if reg_key in candle_map:
                idx = candle_map[reg_key]
                existing_c = candles[idx]
                existing_v = volume_data[idx]
                existing_c['high'] = max(existing_c['high'], reg_price_val)
                existing_c['low'] = min(existing_c['low'], reg_price_val)
                existing_c['close'] = reg_price_val
                is_up = existing_c['close'] >= existing_c['open']
                existing_v['color'] = '#26a69a' if is_up else '#ef5350'
            else:
                reg_open_val = round(float((candles[-1]['close'] if candles else None) or reg_price_val), 2)
                candles.append({
                    'time': reg_time_val,
                    'open': reg_open_val,
                    'high': max(reg_open_val, reg_price_val),
                    'low': min(reg_open_val, reg_price_val),
                    'close': reg_price_val,
                    'volume': 0
                })
                volume_data.append({
                    'time': reg_time_val,
                    'value': 0,
                    'color': '#26a69a' if reg_price_val >= reg_open_val else '#ef5350'
                })

        elif interval in ('1m', '1mo'):
            reg_key = reg_dt.strftime('%Y-%m')
            reg_time_val = reg_dt.strftime('%Y-%m-01')

            if reg_key in candle_map:
                idx = candle_map[reg_key]
                existing_c = candles[idx]
                existing_v = volume_data[idx]
                existing_c['high'] = max(existing_c['high'], reg_price_val)
                existing_c['low'] = min(existing_c['low'], reg_price_val)
                existing_c['close'] = reg_price_val
                is_up = existing_c['close'] >= existing_c['open']
                existing_v['color'] = '#26a69a' if is_up else '#ef5350'
            else:
                reg_open_val = round(float((candles[-1]['close'] if candles else None) or reg_price_val), 2)
                candles.append({
                    'time': reg_time_val,
                    'open': reg_open_val,
                    'high': max(reg_open_val, reg_price_val),
                    'low': min(reg_open_val, reg_price_val),
                    'close': reg_price_val,
                    'volume': 0
                })
                volume_data.append({
                    'time': reg_time_val,
                    'value': 0,
                    'color': '#26a69a' if reg_price_val >= reg_open_val else '#ef5350'
                })

        else: # 1d (Daily)
            reg_key = reg_dt.strftime('%Y-%m-%d')
            reg_time_val = reg_dt.strftime('%Y-%m-%d')

            if reg_key in candle_map:
                idx = candle_map[reg_key]
                existing_c = candles[idx]
                existing_v = volume_data[idx]
                existing_c['high'] = max(existing_c['high'], reg_price_val, meta.get('regularMarketDayHigh') or reg_price_val)
                existing_c['low'] = min(existing_c['low'], reg_price_val, meta.get('regularMarketDayLow') or reg_price_val)
                existing_c['close'] = reg_price_val
                existing_c['volume'] = int(meta.get('regularMarketVolume') or existing_c.get('volume', 0))
                is_up = existing_c['close'] >= existing_c['open']
                existing_v['color'] = '#26a69a' if is_up else '#ef5350'
            else:
                reg_open_val = meta.get('regularMarketOpen') or (candles[-1]['close'] if candles else None) or meta.get('chartPreviousClose') or meta.get('previousClose') or reg_price_val
                reg_open_val = round(float(reg_open_val), 2)
                reg_high_val = round(float(meta.get('regularMarketDayHigh') or max(reg_open_val, reg_price_val)), 2)
                reg_low_val = round(float(meta.get('regularMarketDayLow') or min(reg_open_val, reg_price_val)), 2)

                is_up = reg_price_val >= reg_open_val
                candle_map[reg_key] = len(candles)
                candles.append({
                    'time': reg_time_val,
                    'open': reg_open_val,
                    'high': max(reg_high_val, reg_open_val, reg_price_val),
                    'low': min(reg_low_val, reg_open_val, reg_price_val),
                    'close': reg_price_val,
                    'volume': int(meta.get('regularMarketVolume') or 0)
                })
                volume_data.append({
                    'time': reg_time_val,
                    'value': int(meta.get('regularMarketVolume') or 0),
                    'color': '#26a69a' if is_up else '#ef5350'
                })'''

assert old_merge_block in content, "old_merge_block not found"
content = content.replace(old_merge_block, new_merge_block, 1)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Successfully patched market_data_routes.py!")
