import os
import json
import time
import re
import requests
from bs4 import BeautifulSoup

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.screener.in/'
}

# Standardized SEBI / NSE 4-tier Industry Classification (12 Macros, 22 Sectors, 58 Industry Groups)
SEBI_NSE_MACROS = {
    "IN01": "Commodities",
    "IN02": "Consumer Discretionary",
    "IN03": "Energy",
    "IN04": "Fast Moving Consumer Goods",
    "IN05": "Financial Services",
    "IN06": "Healthcare",
    "IN07": "Industrials",
    "IN08": "Information Technology",
    "IN09": "Services",
    "IN10": "Telecommunication",
    "IN11": "Utilities",
    "IN12": "Diversified"
}

SEBI_NSE_SECTORS = {
    "IN0101": "Chemicals",
    "IN0102": "Construction Materials",
    "IN0103": "Metals & Mining",
    "IN0104": "Forest Materials",
    "IN0201": "Automobile and Auto Components",
    "IN0202": "Consumer Durables",
    "IN0203": "Textiles",
    "IN0204": "Media, Entertainment & Publication",
    "IN0205": "Realty",
    "IN0206": "Consumer Services",
    "IN0301": "Oil, Gas & Consumable Fuels",
    "IN0401": "Fast Moving Consumer Goods",
    "IN0501": "Financial Services",
    "IN0601": "Healthcare",
    "IN0701": "Construction",
    "IN0702": "Capital Goods",
    "IN0801": "Information Technology",
    "IN0901": "Services",
    "IN1001": "Telecommunication",
    "IN1101": "Power",
    "IN1102": "Utilities",
    "IN1201": "Diversified"
}

SEBI_NSE_GROUPS = {
    "IN010101": "Chemicals & Petrochemicals",
    "IN010102": "Fertilizers & Agrochemicals",
    "IN010203": "Cement & Cement Products",
    "IN010204": "Other Construction Materials",
    "IN010301": "Ferrous Metals",
    "IN010302": "Non - Ferrous Metals",
    "IN010303": "Diversified Metals",
    "IN010304": "Minerals & Mining",
    "IN010305": "Metals & Minerals Trading",
    "IN010401": "Paper, Forest & Jute Products",
    "IN020101": "Automobiles",
    "IN020102": "Auto Components",
    "IN020201": "Consumer Durables",
    "IN020301": "Textiles & Apparels",
    "IN020401": "Media",
    "IN020402": "Entertainment",
    "IN020403": "Printing & Publication",
    "IN020501": "Realty",
    "IN020601": "Leisure Services",
    "IN020602": "Other Consumer Services",
    "IN020603": "Retailing",
    "IN030101": "Gas",
    "IN030102": "Oil",
    "IN030103": "Petroleum Products",
    "IN030104": "Consumable Fuels",
    "IN040101": "Agricultural Food & other Products",
    "IN040102": "Beverages",
    "IN040103": "Cigarettes & Tobacco Products",
    "IN040104": "Food Products",
    "IN040105": "Personal Products",
    "IN040106": "Household Products",
    "IN040107": "Diversified FMCG",
    "IN050101": "Finance",
    "IN050102": "Banks",
    "IN050103": "Capital Markets",
    "IN050104": "Insurance",
    "IN050105": "Financial Technology (Fintech)",
    "IN060101": "Pharmaceuticals & Biotechnology",
    "IN060102": "Healthcare Equipment & Supplies",
    "IN060103": "Healthcare Services",
    "IN070101": "Construction",
    "IN070201": "Aerospace & Defense",
    "IN070202": "Agricultural, Commercial & Construction Vehicles",
    "IN070203": "Electrical Equipment",
    "IN070204": "Industrial Manufacturing",
    "IN070205": "Industrial Products",
    "IN080101": "IT - Software",
    "IN080102": "IT - Services",
    "IN080103": "IT - Hardware",
    "IN090101": "Engineering Services",
    "IN090102": "Transport Services",
    "IN090103": "Transport Infrastructure",
    "IN090104": "Commercial Services & Supplies",
    "IN100101": "Telecom - Services",
    "IN100102": "Telecom -  Equipment & Accessories",
    "IN110101": "Power",
    "IN110201": "Other Utilities",
    "IN120101": "Diversified"
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
            os.makedirs(os.path.dirname(self.stocks_cache_file), exist_ok=True)
            with open(self.stocks_cache_file, "w", encoding="utf-8") as f:
                json.dump(self._stocks_cache, f, ensure_ascii=False)
        except Exception as e:
            print("Error saving stocks cache:", e)

    def _enrich_taxonomy(self, data):
        if not isinstance(data, dict) or 'industries' not in data:
            return data

        changed = False
        for ind in data['industries']:
            m_code = ind.get('macro_code')
            s_code = ind.get('sector_code')
            g_code = ind.get('group_code')

            correct_macro = SEBI_NSE_MACROS.get(m_code, ind.get('macro_name') or m_code)
            correct_sector = SEBI_NSE_SECTORS.get(s_code, ind.get('sector_name') or s_code)
            correct_group = SEBI_NSE_GROUPS.get(g_code, ind.get('industry_group_name') or g_code)

            if ind.get('macro_name') != correct_macro:
                ind['macro_name'] = correct_macro
                changed = True
            if ind.get('sector_name') != correct_sector:
                ind['sector_name'] = correct_sector
                changed = True
            if ind.get('industry_group_name') != correct_group:
                ind['industry_group_name'] = correct_group
                changed = True

        # Rebuild macro_sectors canonically
        macro_map = {}
        for ind in data['industries']:
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

        macro_sectors_list = []
        for m_code in sorted(macro_map.keys()):
            m = macro_map[m_code]
            sectors_list = [m['sectors'][s_k] for s_k in sorted(m['sectors'].keys())]
            macro_sectors_list.append({
                'code': m['code'],
                'name': m['name'],
                'sectors': sectors_list
            })
        data['macro_sectors'] = macro_sectors_list

        if changed or not os.path.exists(self.overview_file):
            try:
                os.makedirs(os.path.dirname(self.overview_file), exist_ok=True)
                with open(self.overview_file, 'w', encoding='utf-8') as fp:
                    json.dump(data, fp, indent=2, ensure_ascii=False)
            except Exception as e:
                print("Error updating overview_file after enrichment:", e)

        return data

    def get_industries_overview(self, force_refresh=False):
        if not force_refresh:
            if os.path.exists(self.overview_file):
                try:
                    with open(self.overview_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if isinstance(data, dict) and data.get('industries'):
                            return self._enrich_taxonomy(data)
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

                        macro_name = SEBI_NSE_MACROS.get(macro_code, macro_code)
                        sector_name = SEBI_NSE_SECTORS.get(sector_code, sector_code)
                        industry_group_name = SEBI_NSE_GROUPS.get(group_code, group_code)

                        stats = [td.get_text(strip=True) for td in tds]
                        raw_industries.append({
                            'code': ind_code,
                            'name': a.get_text(strip=True),
                            'path': f"{macro_code}/{sector_code}/{group_code}/{ind_code}",
                            'macro_code': macro_code,
                            'sector_code': sector_code,
                            'group_code': group_code,
                            'macro_name': macro_name,
                            'sector_name': sector_name,
                            'industry_group_name': industry_group_name,
                            'company_count': int(clean_num(stats[2]) or 0),
                            'total_market_cap': clean_num(stats[3]) or 0.0,
                            'median_market_cap': clean_num(stats[4]) or 0.0,
                            'median_pe': clean_num(stats[5]),
                            'sales_growth': clean_num(stats[6]),
                            'opm': clean_num(stats[7]),
                            'wtd_roce': clean_num(stats[8]),
                            'return_1y': clean_num(stats[9])
                        })

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

        macro_sectors_list = []
        for m_code in sorted(macro_map.keys()):
            m = macro_map[m_code]
            sectors_list = [m['sectors'][s_k] for s_k in sorted(m['sectors'].keys())]
            macro_sectors_list.append({
                'code': m['code'],
                'name': m['name'],
                'sectors': sectors_list
            })

        final_output = {
            'count': len(raw_industries),
            'last_updated': time.strftime('%Y-%m-%d %H:%M:%S'),
            'industries': raw_industries,
            'macro_sectors': macro_sectors_list
        }

        os.makedirs(os.path.dirname(self.overview_file), exist_ok=True)
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

        if target_ind:
            target_ind['macro_name'] = SEBI_NSE_MACROS.get(target_ind.get('macro_code'), target_ind.get('macro_name'))
            target_ind['sector_name'] = SEBI_NSE_SECTORS.get(target_ind.get('sector_code'), target_ind.get('sector_name'))
            target_ind['industry_group_name'] = SEBI_NSE_GROUPS.get(target_ind.get('group_code'), target_ind.get('industry_group_name'))

        clean_path = target_ind['path'] if target_ind else path_or_code.strip('/')
        now = time.time()

        # Check cache (1 hour TTL)
        cached = self._stocks_cache.get(clean_path)
        if not force_refresh and cached and (now - cached.get('timestamp', 0) < 3600):
            # Ensure cached record industry metadata has fresh taxonomy names
            cached_data = cached['data']
            if cached_data.get('industry') and target_ind:
                cached_data['industry'] = target_ind
            return cached_data

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
