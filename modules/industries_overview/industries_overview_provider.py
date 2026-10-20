import os
import json
import time
import re
import requests
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.screener.in/'
}

def clean_num(s):
    if not s or s == '-' or s == 'None':
        return None
    s = s.replace(',', '').replace('%', '').strip()
    try:
        return float(s)
    except:
        return None

class IndustriesOverviewProvider:
    def __init__(self, data_dir="data"):
        self.data_dir = data_dir
        self.overview_file = os.path.join(data_dir, "app_data", "industries_overview.json")
        self.stocks_cache_file = os.path.join(data_dir, "app_data", "industry_stocks_cache.json")
        self._stocks_cache = {}
        self._load_stocks_cache()

    def _load_stocks_cache(self):
        if os.path.exists(self.stocks_cache_file):
            try:
                with open(self.stocks_cache_file, "r", encoding="utf-8") as f:
                    self._stocks_cache = json.load(f)
            except Exception:
                self._stocks_cache = {}

    def _save_stocks_cache(self):
        try:
            os.makedirs(self.data_dir, exist_ok=True)
            with open(self.stocks_cache_file, "w", encoding="utf-8") as f:
                json.dump(self._stocks_cache, f, ensure_ascii=False)
        except Exception as e:
            print("Error saving stocks cache:", e)

    def get_industries_overview(self, force_refresh=False):
        if not force_refresh:
            if os.path.exists(self.overview_file):
                try:
                    with open(self.overview_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if isinstance(data, dict):
                            return data
                except Exception as e:
                    print(f"Error reading overview file from {self.overview_file}:", e)

        return self.refresh_overview()

    def refresh_overview(self):
        r = requests.get('https://www.screener.in/market/', headers=HEADERS, timeout=15)
        if r.status_code != 200:
            raise Exception(f"Failed to fetch screener market page: HTTP {r.status_code}")

        soup = BeautifulSoup(r.text, 'html.parser')
        table = soup.find('table')
        if not table:
            raise Exception("Table not found on market page")

        raw_industries = []
        group_urls = set()

        for tr in table.find_all('tr')[1:]:
            tds = tr.find_all('td')
            if len(tds) >= 10:
                a = tds[1].find('a')
                if a:
                    href = a.get('href', '').strip('/')
                    parts = href.split('/')
                    if len(parts) == 5:
                        macro_code = parts[1]
                        sector_code = parts[2]
                        group_code = parts[3]
                        ind_code = parts[4]

                        group_url = f"https://www.screener.in/market/{macro_code}/{sector_code}/{group_code}/"
                        group_urls.add((macro_code, sector_code, group_code, group_url))

                        stats = [td.get_text(strip=True) for td in tds]
                        raw_industries.append({
                            'code': ind_code,
                            'name': a.get_text(strip=True),
                            'path': f"{macro_code}/{sector_code}/{group_code}/{ind_code}",
                            'macro_code': macro_code,
                            'sector_code': sector_code,
                            'group_code': group_code,
                            'company_count': int(clean_num(stats[2]) or 0),
                            'total_market_cap': clean_num(stats[3]) or 0.0,
                            'median_market_cap': clean_num(stats[4]) or 0.0,
                            'median_pe': clean_num(stats[5]),
                            'sales_growth': clean_num(stats[6]),
                            'opm': clean_num(stats[7]),
                            'wtd_roce': clean_num(stats[8]),
                            'return_1y': clean_num(stats[9])
                        })

        hierarchy_dict = {}

        def fetch_group_meta(item):
            macro_code, sector_code, group_code, g_url = item
            try:
                res = requests.get(g_url, headers=HEADERS, timeout=12)
                if res.status_code == 200:
                    sp = BeautifulSoup(res.text, 'html.parser')
                    h1 = sp.find('h1')
                    g_title = h1.get_text(strip=True) if h1 else ''
                    g_title = re.sub(r'\s*Companies\s*$', '', g_title, flags=re.I).strip()

                    macro_name = ''
                    sector_name = ''
                    for anc in sp.find_all('a'):
                        hr = anc.get('href', '')
                        if hr == f"/market/{macro_code}/":
                            macro_name = anc.get_text(strip=True)
                        elif hr == f"/market/{macro_code}/{sector_code}/":
                            sector_name = anc.get_text(strip=True)

                    return group_code, {
                        'macro_name': macro_name,
                        'sector_name': sector_name,
                        'group_name': g_title
                    }
            except Exception as err:
                print(f"Error fetching group {g_url}: {err}")
            return group_code, None

        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(fetch_group_meta, item) for item in group_urls]
            for f in as_completed(futures):
                g_code, meta = f.result()
                if meta:
                    hierarchy_dict[g_code] = meta

        for ind in raw_industries:
            g_meta = hierarchy_dict.get(ind['group_code'], {})
            ind['macro_name'] = g_meta.get('macro_name') or ind['macro_code']
            ind['sector_name'] = g_meta.get('sector_name') or ind['sector_code']
            ind['industry_group_name'] = g_meta.get('group_name') or ind['group_code']

        macro_map = {}
        for ind in raw_industries:
            m_code = ind['macro_code']
            if m_code not in macro_map:
                macro_map[m_code] = {
                    'code': m_code,
                    'name': ind['macro_name'],
                    'sectors': {}
                }
            s_code = ind['sector_code']
            if s_code not in macro_map[m_code]['sectors']:
                macro_map[m_code]['sectors'][s_code] = {
                    'code': s_code,
                    'name': ind['sector_name']
                }

        final_output = {
            'count': len(raw_industries),
            'last_updated': time.strftime('%Y-%m-%d %H:%M:%S'),
            'industries': raw_industries,
            'macro_sectors': [
                {
                    'code': m['code'],
                    'name': m['name'],
                    'sectors': list(m['sectors'].values())
                }
                for m in macro_map.values()
            ]
        }

        os.makedirs(self.data_dir, exist_ok=True)
        with open(self.overview_file, 'w', encoding='utf-8') as fp:
            json.dump(final_output, fp, indent=2, ensure_ascii=False)

        return final_output

    def get_industry_stocks(self, path_or_code, force_refresh=False):
        # Resolve industry record from overview
        overview = self.get_industries_overview()
        industries = overview.get('industries', [])
        
        target_ind = None
        for ind in industries:
            if ind['code'] == path_or_code or ind['path'] == path_or_code or ind['path'].strip('/') == path_or_code.strip('/'):
                target_ind = ind
                break
            if ind['name'].lower() == path_or_code.lower():
                target_ind = ind
                break

        if not target_ind:
            # Fallback search by partial code
            for ind in industries:
                if ind['code'].endswith(path_or_code) or path_or_code in ind['path']:
                    target_ind = ind
                    break

        clean_path = target_ind['path'] if target_ind else path_or_code.strip('/')
        now = time.time()

        # Check cache (1 hour TTL)
        cached = self._stocks_cache.get(clean_path)
        if not force_refresh and cached and (now - cached.get('timestamp', 0) < 3600):
            return cached['data']

        # Scrape Screener stocks table for this industry
        target_url = f"https://www.screener.in/market/{clean_path}/"
        r = requests.get(target_url, headers=HEADERS, timeout=12)
        if r.status_code != 200:
            raise Exception(f"Failed to fetch stocks for {clean_path}: HTTP {r.status_code}")

        soup = BeautifulSoup(r.text, 'html.parser')
        table = soup.find('table')
        stocks = []

        if table:
            for tr in table.find_all('tr')[1:]:
                tds = tr.find_all('td')
                if tds:
                    a = tds[1].find('a')
                    name = a.get_text(strip=True) if a else tds[1].get_text(strip=True)
                    href = a.get('href', '') if a else ''
                    m = re.search(r'/company/([^/]+)/', href)
                    sym = m.group(1) if m else ''
                    cols = [td.get_text(strip=True) for td in tds]

                    stocks.append({
                        'sno': int(clean_num(cols[0]) or len(stocks) + 1),
                        'name': name,
                        'symbol': sym,
                        'href': href,
                        'cmp': clean_num(cols[2]) if len(cols) > 2 else None,
                        'pe': clean_num(cols[3]) if len(cols) > 3 else None,
                        'mar_cap': clean_num(cols[4]) if len(cols) > 4 else None,
                        'div_yield': clean_num(cols[5]) if len(cols) > 5 else None,
                        'np_qtr': clean_num(cols[6]) if len(cols) > 6 else None,
                        'qtr_profit_var': clean_num(cols[7]) if len(cols) > 7 else None,
                        'sales_qtr': clean_num(cols[8]) if len(cols) > 8 else None,
                        'qtr_sales_var': clean_num(cols[9]) if len(cols) > 9 else None,
                        'roce': clean_num(cols[10]) if len(cols) > 10 else None
                    })

        breadcrumbs = [
            {'name': 'Industries', 'path': ''}
        ]
        if target_ind:
            breadcrumbs.append({'name': target_ind['macro_name'], 'code': target_ind['macro_code'], 'type': 'macro'})
            breadcrumbs.append({'name': target_ind['sector_name'], 'code': target_ind['sector_code'], 'type': 'sector'})
            breadcrumbs.append({'name': target_ind['industry_group_name'], 'code': target_ind['group_code'], 'type': 'group'})
            breadcrumbs.append({'name': target_ind['name'], 'code': target_ind['code'], 'type': 'industry'})

        result_payload = {
            'success': True,
            'industry': target_ind,
            'breadcrumbs': breadcrumbs,
            'stocks': stocks,
            'count': len(stocks),
            'fetched_at': time.strftime('%Y-%m-%d %H:%M:%S')
        }

        self._stocks_cache[clean_path] = {
            'timestamp': now,
            'data': result_payload
        }
        self._save_stocks_cache()

        return result_payload
