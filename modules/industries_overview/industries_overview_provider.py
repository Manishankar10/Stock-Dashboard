import db_store
import os
import json
import time
import re
import shutil
import threading
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
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

def _parse_stocks_table_rows(soup):
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
    return stocks


class IndustriesOverviewProvider:
    def __init__(self, data_dir="data"):
        self.data_dir = data_dir
        self.overview_file = os.path.join(data_dir, "app_data", "industries_overview.json")
        self._overview_data = {}
        self._lock = threading.Lock()
        self._is_refreshing = False
        self._refresh_progress = ""
        self._refresh_percent = 0
        self._refresh_error = None
        self._last_backup_file = None

        self._cache_etag = ""
        self._cache_timestamp = 0
        self._stocks_etag_map = {}

        # Load from Database (MongoDB Atlas & SQLite) into ultra-fast in-memory cache
        self._load_overview_data()

        # Remove deprecated industry_stocks_cache.json if present
        deprecated_cache = os.path.join(data_dir, "app_data", "industry_stocks_cache.json")
        if os.path.exists(deprecated_cache):
            try:
                os.remove(deprecated_cache)
            except Exception:
                pass

    def _load_overview_data(self):
        with self._lock:
            try:
                # 1. Primary: Load from Database (MongoDB Atlas & SQLite)
                db_res = db_store.load_industries_overview_db(fallback_filepath=self.overview_file)
                if db_res and isinstance(db_res.get('data'), dict) and len(db_res['data'].get('industries', [])) > 0:
                    self._overview_data = db_res['data']
                    print(f"Loaded industries overview from DB: {len(self._overview_data.get('industries', []))} industries.")
                elif os.path.exists(self.overview_file):
                    with open(self.overview_file, "r", encoding="utf-8") as f:
                        self._overview_data = json.load(f)
                else:
                    self._overview_data = {}

                if not isinstance(self._overview_data, dict):
                    self._overview_data = {}
                if 'industry_stocks' not in self._overview_data:
                    self._overview_data['industry_stocks'] = {}

                self._recompute_cache_etags()
            except Exception as e:
                print(f"Error loading industries overview: {e}")
                self._overview_data = {}

    def _recompute_cache_etags(self):
        import hashlib
        try:
            up = str(self._overview_data.get('last_updated') or self._overview_data.get('last_updated_display') or '')
            cnt = len(self._overview_data.get('industries', []))
            stocks_cnt = len(self._overview_data.get('industry_stocks', {}))
            raw = f"ind-v1-{cnt}-{stocks_cnt}-{up}"
            self._cache_etag = f'W/"{hashlib.sha1(raw.encode()).hexdigest()[:16]}"'

            stocks_map = self._overview_data.get('industry_stocks', {})
            self._stocks_etag_map = {}
            for p, stks in stocks_map.items():
                p_raw = f"stk-{p}-{len(stks)}-{up}"
                self._stocks_etag_map[p] = f'W/"{hashlib.sha1(p_raw.encode()).hexdigest()[:16]}"'
            self._cache_timestamp = time.time()
        except Exception:
            self._cache_etag = f'W/"ind-{time.time()}"'

    def get_etag(self) -> str:
        with self._lock:
            if not self._cache_etag:
                self._recompute_cache_etags()
            return self._cache_etag

    def get_stocks_etag(self, path: str) -> str:
        clean_path = path.strip('/')
        with self._lock:
            if clean_path in self._stocks_etag_map:
                return self._stocks_etag_map[clean_path]
            return f'W/"stk-{clean_path}-{int(self._cache_timestamp)}"'

    def _save_overview_data(self):
        try:
            now_str = datetime.now().strftime("%d %b %Y, %I:%M %p")
            iso_str = datetime.utcnow().isoformat() + "Z"
            if not self._overview_data.get('last_updated_display'):
                self._overview_data['last_updated_display'] = now_str
            if not self._overview_data.get('last_updated'):
                self._overview_data['last_updated'] = iso_str

            # 1. Save to Database (MongoDB Atlas & SQLite) and disk backup
            db_store.save_industries_overview_db(
                self._overview_data,
                last_updated_iso=self._overview_data.get('last_updated'),
                last_updated_display=self._overview_data.get('last_updated_display'),
                backup_filepath=self.overview_file
            )
            self._recompute_cache_etags()
        except Exception as e:
            print("Error saving overview data to DB:", e)

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
        """Strictly serve from local app_data/industries_overview.json. Zero external calls."""
        with self._lock:
            if not self._overview_data or not self._overview_data.get('industries'):
                self._load_overview_data()

            if self._overview_data and self._overview_data.get('industries'):
                return self._enrich_taxonomy(self._overview_data)

        # Only if file is completely missing on disk, scrape initially once
        return self._scrape_master_directory_initial()

    def get_industry_stocks(self, path_or_code, force_refresh=False):
        """Retrieve stocks for this industry strictly from single app_data/industries_overview.json.
        No 1-hour expiration. Zero external calls when already in file.
        """
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
            for ind in industries:
                if ind['code'].endswith(path_or_code) or path_or_code in ind['path']:
                    target_ind = ind
                    break

        if target_ind:
            target_ind['macro_name'] = SEBI_NSE_MACROS.get(target_ind.get('macro_code'), target_ind.get('macro_name'))
            target_ind['sector_name'] = SEBI_NSE_SECTORS.get(target_ind.get('sector_code'), target_ind.get('sector_name'))
            target_ind['industry_group_name'] = SEBI_NSE_GROUPS.get(target_ind.get('group_code'), target_ind.get('industry_group_name'))

        clean_path = target_ind['path'] if target_ind else path_or_code.strip('/')

        # 1. Check if stocks exist in single file
        with self._lock:
            cached_stocks = self._overview_data.get('industry_stocks', {}).get(clean_path)

        if cached_stocks is not None and len(cached_stocks) > 0:
            breadcrumbs = [{'name': 'Industries', 'path': ''}]
            if target_ind:
                target_ind['company_count'] = len(cached_stocks)
                breadcrumbs.append({'name': target_ind['macro_name'], 'code': target_ind['macro_code'], 'type': 'macro'})
                breadcrumbs.append({'name': target_ind['sector_name'], 'code': target_ind['sector_code'], 'type': 'sector'})
                breadcrumbs.append({'name': target_ind['industry_group_name'], 'code': target_ind['group_code'], 'type': 'group'})
                breadcrumbs.append({'name': target_ind['name'], 'code': target_ind['code'], 'type': 'industry'})

            return {
                'success': True,
                'industry': target_ind,
                'breadcrumbs': breadcrumbs,
                'stocks': cached_stocks,
                'count': len(cached_stocks),
                'fetched_at': self._overview_data.get('last_updated_display') or self._overview_data.get('last_updated')
            }

        # 2. Fallback: if not yet stored in file, scrape once and save to single file
        stocks = self._scrape_stocks_for_industry(clean_path)

        with self._lock:
            if 'industry_stocks' not in self._overview_data:
                self._overview_data['industry_stocks'] = {}
            self._overview_data['industry_stocks'][clean_path] = stocks
            self._save_overview_data()

        breadcrumbs = [{'name': 'Industries', 'path': ''}]
        if target_ind:
            target_ind['company_count'] = len(stocks)
            breadcrumbs.append({'name': target_ind['macro_name'], 'code': target_ind['macro_code'], 'type': 'macro'})
            breadcrumbs.append({'name': target_ind['sector_name'], 'code': target_ind['sector_code'], 'type': 'sector'})
            breadcrumbs.append({'name': target_ind['industry_group_name'], 'code': target_ind['group_code'], 'type': 'group'})
            breadcrumbs.append({'name': target_ind['name'], 'code': target_ind['code'], 'type': 'industry'})

        return {
            'success': True,
            'industry': target_ind,
            'breadcrumbs': breadcrumbs,
            'stocks': stocks,
            'count': len(stocks),
            'fetched_at': time.strftime('%Y-%m-%d %H:%M:%S')
        }

    def _scrape_stocks_for_industry(self, clean_path):
        target_url = f"https://www.screener.in/market/{clean_path}/"
        r = requests.get(target_url, headers=HEADERS, timeout=12)
        if r.status_code != 200:
            raise Exception(f"Failed to fetch stocks for {clean_path}: HTTP {r.status_code}")

        soup = BeautifulSoup(r.text, 'html.parser')
        stocks = _parse_stocks_table_rows(soup)

        total_pages = 1
        page_info = soup.find('div', attrs={'data-page-info': True})
        if page_info:
            m = re.search(r'Showing page \d+ of (\d+)', page_info.get_text())
            if m:
                total_pages = int(m.group(1))
        else:
            pag = soup.find(class_='pagination')
            if pag:
                for a in pag.find_all('a'):
                    href = a.get('href', '')
                    if 'limit=' in href:
                        continue
                    m = re.search(r'page=(\d+)', href)
                    if m:
                        total_pages = max(total_pages, int(m.group(1)))

        if total_pages > 1:
            def _fetch_page(p):
                try:
                    p_url = f"{target_url}?page={p}"
                    pr = requests.get(p_url, headers=HEADERS, timeout=12)
                    if pr.status_code == 200:
                        psoup = BeautifulSoup(pr.text, 'html.parser')
                        return p, _parse_stocks_table_rows(psoup)
                except Exception as e:
                    print(f"Failed to fetch page {p} of {clean_path}: {e}")
                return p, []

            workers = min(6, total_pages - 1)
            with ThreadPoolExecutor(max_workers=workers) as executor:
                page_results = list(executor.map(_fetch_page, range(2, total_pages + 1)))
                page_results.sort(key=lambda x: x[0])
                for _, p_stocks in page_results:
                    stocks.extend(p_stocks)

        for idx, stk in enumerate(stocks):
            stk['sno'] = idx + 1

        return stocks

    def start_admin_background_refresh(self):
        """Initiate background refresh by Admin. Does not block or disturb browsing users."""
        with self._lock:
            if self._is_refreshing:
                return {
                    "success": False,
                    "status": "in_progress",
                    "message": "A data refresh is already in progress.",
                    **self.get_refresh_status()
                }
            self._is_refreshing = True
            self._refresh_progress = "Starting background refresh..."
            self._refresh_percent = 5
            self._refresh_error = None

        thread = threading.Thread(target=self._run_background_refresh, daemon=True)
        thread.start()

        return {
            "success": True,
            "status": "started",
            "message": "Background refresh started. Users can continue browsing without interruption.",
            **self.get_refresh_status()
        }

    def _run_background_refresh(self):
        try:
            # 1. Immediate timestamped backup of existing file before any scraping
            backup_filename = None
            if os.path.exists(self.overview_file):
                ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                backup_filename = f"industries_overview_backup_{ts}.json"
                backup_path = os.path.join(os.path.dirname(self.overview_file), backup_filename)
                try:
                    shutil.copy2(self.overview_file, backup_path)
                    self._last_backup_file = backup_filename
                    print(f"Backed up industries_overview.json to: {backup_path}")
                except Exception as e:
                    print(f"Warning: backup error: {e}")

            self._refresh_progress = "Fetching latest master directory (188 industries)..."
            self._refresh_percent = 5

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
                    macro_map[m_code] = {'code': m_code, 'name': ind['macro_name'], 'sectors': {}}
                s_code = ind['sector_code']
                if s_code not in macro_map[m_code]['sectors']:
                    macro_map[m_code]['sectors'][s_code] = {'code': s_code, 'name': ind['sector_name']}

            macro_sectors_list = []
            for m_code in sorted(macro_map.keys()):
                m = macro_map[m_code]
                sectors_list = [m['sectors'][s_k] for s_k in sorted(m['sectors'].keys())]
                macro_sectors_list.append({'code': m['code'], 'name': m['name'], 'sectors': sectors_list})

            self._refresh_progress = "Directory scraped. Refreshing industry stocks..."
            self._refresh_percent = 15

            # 2. Scrape industry stocks
            new_industry_stocks = {}
            total = len(raw_industries)
            completed = 0

            def scrape_worker(item):
                idx, ind = item
                p = ind['path']
                try:
                    stks = self._scrape_stocks_for_industry(p)
                    return p, stks
                except Exception:
                    # Preserve previous stocks if failed
                    prev = self._overview_data.get('industry_stocks', {}).get(p, [])
                    return p, prev

            with ThreadPoolExecutor(max_workers=5) as ex:
                for p, stks in ex.map(scrape_worker, enumerate(raw_industries)):
                    new_industry_stocks[p] = stks
                    completed += 1
                    self._refresh_percent = 15 + int((completed / total) * 75)
                    self._refresh_progress = f"Scraped stocks for {completed}/{total} industries..."

            # 3. Existing file was already backed up at the start of refresh
            self._refresh_progress = "Finalizing dataset..."
            self._refresh_percent = 92

            # 4. Atomic write of new single file
            self._refresh_progress = "Saving fresh dataset to single JSON file..."
            self._refresh_percent = 96

            final_output = {
                'count': len(raw_industries),
                'last_updated': datetime.utcnow().isoformat() + "Z",
                'last_updated_display': datetime.now().strftime('%d %b %Y, %I:%M %p'),
                'last_backup': backup_filename,
                'industries': raw_industries,
                'macro_sectors': macro_sectors_list,
                'industry_stocks': new_industry_stocks
            }

            # Persist fresh dataset to Database (MongoDB Atlas & SQLite) & backup file
            db_store.save_industries_overview_db(
                final_output,
                last_updated_iso=final_output['last_updated'],
                last_updated_display=final_output['last_updated_display'],
                backup_filepath=self.overview_file
            )

            with self._lock:
                self._overview_data = final_output
                self._recompute_cache_etags()

            self._refresh_progress = "Completed successfully. All industries & stocks updated."
            self._refresh_percent = 100
        except Exception as e:
            self._refresh_error = str(e)
            self._refresh_progress = f"Refresh failed: {str(e)}"
            print(f"Error in background industries refresh: {e}")
        finally:
            with self._lock:
                self._is_refreshing = False

    def get_refresh_status(self):
        with self._lock:
            last_up = self._overview_data.get('last_updated_display') or self._overview_data.get('last_updated') or "Never"
            backup = self._last_backup_file or self._overview_data.get('last_backup')
            total_inds = len(self._overview_data.get('industries', []))
            total_cached_stocks = len(self._overview_data.get('industry_stocks', {}))

        return {
            "is_refreshing": self._is_refreshing,
            "progress": self._refresh_progress or ("Idle" if not self._is_refreshing else "In progress"),
            "percent": self._refresh_percent,
            "error": self._refresh_error,
            "total_industries": total_inds,
            "total_stocks_cached": total_cached_stocks,
            "last_updated": last_up,
            "last_backup": backup,
            "storage": "MongoDB Atlas & SQLite (Synced)"
        }

    def _scrape_master_directory_initial(self):
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
                macro_map[m_code] = {'code': m_code, 'name': ind['macro_name'], 'sectors': {}}
            s_code = ind['sector_code']
            if s_code not in macro_map[m_code]['sectors']:
                macro_map[m_code]['sectors'][s_code] = {'code': s_code, 'name': ind['sector_name']}

        macro_sectors_list = []
        for m_code in sorted(macro_map.keys()):
            m = macro_map[m_code]
            sectors_list = [m['sectors'][s_k] for s_k in sorted(m['sectors'].keys())]
            macro_sectors_list.append({'code': m['code'], 'name': m['name'], 'sectors': sectors_list})

        final_output = {
            'count': len(raw_industries),
            'last_updated': time.strftime('%Y-%m-%d %H:%M:%S'),
            'last_updated_display': datetime.now().strftime('%d %b %Y, %I:%M %p'),
            'industries': raw_industries,
            'macro_sectors': macro_sectors_list,
            'industry_stocks': {}
        }

        os.makedirs(os.path.dirname(self.overview_file), exist_ok=True)
        with open(self.overview_file, 'w', encoding='utf-8') as fp:
            json.dump(final_output, fp, indent=2, ensure_ascii=False)

        with self._lock:
            self._overview_data = final_output

        return final_output
