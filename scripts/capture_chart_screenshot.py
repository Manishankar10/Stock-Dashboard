import time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

options = Options()
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--window-size=1400,900")

driver = webdriver.Chrome(options=options)

try:
    # 1. Login
    driver.get("http://127.0.0.1:5000/login")
    time.sleep(1)
    driver.find_element(By.ID, "username").send_keys("admin")
    driver.find_element(By.ID, "password").send_keys("admin123")
    driver.find_element(By.ID, "btn-submit").click()
    time.sleep(2.5)

    # 2. Watchlists page
    driver.get("http://127.0.0.1:5000/watchlists")
    time.sleep(3)

    # 3. Open chart for TCS
    driver.execute_script("handleWatchlistStockClick('TCS');")
    time.sleep(4)

    # 4. Change interval to 5m
    driver.execute_script("changeInterval('5m');")
    time.sleep(4)

    # 5. Hide watermark/overlays if needed and capture screenshot
    out_path = r"C:\Users\DELL\.gemini\antigravity\brain\c5aff83d-72ca-40a5-90eb-e5ed7a1a4bf7\chart_5m_rectified_wicks.png"
    driver.save_screenshot(out_path)
    print("Screenshot saved to:", out_path)

finally:
    driver.quit()
