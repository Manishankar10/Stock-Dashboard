from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
import time

options = Options()
options.add_argument('--headless=new')
options.set_capability('goog:loggingPrefs', {'browser': 'ALL'})
driver = webdriver.Chrome(options=options)

try:
    driver.get('http://127.0.0.1:5000/login')
    time.sleep(1)
    driver.find_element(By.ID, 'username').send_keys('admin')
    driver.find_element(By.ID, 'password').send_keys('admin123')
    driver.find_element(By.ID, 'btn-submit').click()
    time.sleep(2)
    driver.get('http://127.0.0.1:5000/watchlists')
    time.sleep(2)
    driver.execute_script("openInHouseChart('TCS', '5m');")
    time.sleep(4)
    logs = driver.get_log('browser')
    print("Browser console logs:")
    for l in logs:
        print(l.get('level'), l.get('message'))
finally:
    driver.quit()
