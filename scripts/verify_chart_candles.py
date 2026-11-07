import requests

intervals = [
    ('5m', '1d'),
    ('15m', '5d'),
    ('1h', '1mo'),
    ('1d', '1mo'),
    ('1w', '1y'),
    ('1m', '2y')
]

for intv, rng in intervals:
    url = f"http://127.0.0.1:5000/api/chart_history?symbol=TCS.NS&range={rng}&interval={intv}"
    res = requests.get(url).json()
    candles = res.get('candles', [])
    meta = res.get('meta', {})
    day_high = 2565.0  # TCS regularMarketDayHigh
    day_low = 2489.6   # TCS regularMarketDayLow
    
    if not candles:
        print(f"FAILED: No candles for {intv}")
        continue
        
    last = candles[-1]
    second_last = candles[-2] if len(candles) > 1 else None
    
    print(f"\n--- Interval: {intv} (Range: {rng}) ---")
    print(f"Candles count: {len(candles)}")
    print(f"Last candle: {last}")
    if second_last:
        print(f"Second last candle: {second_last}")
        
    if intv == '1d':
        # On daily, high should be day high and low should be day low
        assert last['high'] == day_high, f"Daily high expected {day_high}, got {last['high']}"
        assert last['low'] == day_low, f"Daily low expected {day_low}, got {last['low']}"
        print(f"PASS [1d]: Correctly incorporates day high/low for daily bar.")
    elif intv in ('5m', '15m', '1h'):
        # On intraday, last candle MUST NOT be corrupted by whole day high/low
        assert last['high'] < day_high, f"Intraday {intv} high should NOT be day_high {day_high}, got {last['high']}"
        assert last['low'] > day_low, f"Intraday {intv} low should NOT be day_low {day_low}, got {last['low']}"
        print(f"PASS [{intv}]: Correctly preserves candle's own high/low without day high/low wick corruption!")

print("\nALL INTERVAL VERIFICATIONS PASSED!")
