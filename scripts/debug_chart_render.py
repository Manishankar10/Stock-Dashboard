import time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

options = Options()
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.set_capability('goog:loggingPrefs', {'browser': 'ALL'})
driver = webdriver.Chrome(options=options)

try:
    driver.get("http://127.0.0.1:5000/login")
    time.sleep(1)
    driver.find_element(By.ID, "username").send_keys("admin")
    driver.find_element(By.ID, "password").send_keys("admin123")
    driver.find_element(By.ID, "btn-submit").click()
    time.sleep(2.5)

    driver.get("http://127.0.0.1:5000/watchlists")
    time.sleep(2)

    # Call openInHouseChart and catch errors
    err = driver.execute_script("""
        try {
            openInHouseChart('TCS.NS', '5m');
            return 'called';
        } catch(e) {
            return e.toString() + ' \\n ' + e.stack;
        }
    """)
    print("Execute result:", err)

    time.sleep(4)

    logs = driver.get_log('browser')
    print("Browser logs:")
    for l in logs:
        print(l)

    res = driver.execute_script("""
        return {
            hasMainChart: !!window.mainChart,
            hasMainSeries: !!window.mainSeries,
            cachedCandles: window.cachedChartData ? window.cachedChartData.candles.length : 0,
            loaderOpacity: document.getElementById('chartLoaderOverlay') ? document.getElementById('chartLoaderOverlay').style.opacity : null,
            loaderDisplay: document.getElementById('chartLoaderOverlay') ? document.getElementById('chartLoaderOverlay').style.display : null
        };
    """)
    print("Chart state:", res)

finally:
    driver.quit()
