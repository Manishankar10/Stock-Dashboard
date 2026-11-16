/**
 * CAPITAL DESK - CHARTINK SCREENER REPLICA CONTROLLER
 * Location: modules/chartink/chartink.js
 * 
 * Replicates Chartink "My Scans" Category Table (View 1) and
 * Detailed Paginated Filtered Stocks Table (View 2) with DataTables-style pagination.
 */

(function () {
    // =========================================================
    // DEFAULT / FALLBACK SCREENERS (INSTANT ZERO-LATENCY LOAD)
    // =========================================================
    const FALLBACK_CATEGORIES = [
        {
            slug: 'pivot-point-scan-for-intraday',
            name: 'Pivot Point Scan for Intraday',
            description: "Intraday pivot point scan: today's close is higher than yesterday's pivot level (High + Low + Close) / 3",
            url: 'https://chartink.com/screener/pivot-point-scan-for-intraday',
            atlas_query: '( {cash} ( ( 1 day ago high + 1 day ago low + 1 day ago close ) / 3 < daily close ) )',
            category_group: 'Intraday',
            tags: 'Intraday, Pivot',
            is_favourite: 0,
            is_default: 1,
            created_at: '2026-07-24'
        },
        {
            slug: 'near-ath',
            name: 'Copy - Near ATH',
            description: 'Finds stocks whose current close is greater than latest max( 2000 , latest high * 0.95 )',
            url: 'https://chartink.com/screener/near-ath',
            atlas_query: '( {cash} ( latest close > latest max( 2000 , latest high * 0.95 ) ) )',
            category_group: 'Breakouts',
            tags: 'ATH, Breakouts',
            is_favourite: 0,
            is_default: 1,
            created_at: '2025-12-24'
        },
        {
            slug: 'cup-and-handle',
            name: 'Cup and Handle',
            description: 'Classic technical cup and handle pattern detecting consolidation and upward breakout',
            url: 'https://chartink.com/screener/cup-and-handle',
            atlas_query: '( {cash} ( ( {cash} ( 7 months ago high < 6 months ago high and 7 months ago high < 5 months ago high and 1 month ago high > 2 months ago high and latest close > 1 month ago high ) ) ) )',
            category_group: 'Patterns',
            tags: 'Patterns, Swing',
            is_favourite: 0,
            is_default: 1,
            created_at: '2025-10-12'
        },
        {
            slug: 'day-close-0',
            name: 'Day close > 0%',
            description: "Daily close higher than previous day close (Today's Gainers)",
            url: 'https://chartink.com/screener/day-close-0',
            atlas_query: '( {cash} ( daily close < 1 day ago close * 2 and daily close >= 1 day ago close * 1 ) )',
            category_group: 'Gainers',
            tags: 'Gainers, Momentum',
            is_favourite: 0,
            is_default: 1,
            created_at: '2025-10-01'
        },
        {
            slug: 'stocks-down-5-2',
            name: 'Stocks Down 3%',
            description: 'Stocks falling more than 3% today (Intraday Dips & Reversal Candidates)',
            url: 'https://chartink.com/screener/stocks-down-5-2',
            atlas_query: '( {cash} ( ( {cash} ( ( {cash} ( daily close < 1 day ago close * 0.97 ) ) ) ) ) )',
            category_group: 'Losers',
            tags: 'Losers, Dips',
            is_favourite: 0,
            is_default: 1,
            created_at: '2025-09-15'
        },
        {
            slug: 'short-term-breakouts',
            name: 'Short Term Breakouts',
            description: 'Multi-day resistance breakout with strong volume (> 100k)',
            url: 'https://chartink.com/screener/short-term-breakouts',
            atlas_query: '( {cash} ( daily max( 5 , daily close ) > 6 days ago max( 120 , daily close ) and daily close > 1 day ago close and daily volume > 100000 ) )',
            category_group: 'Breakouts',
            tags: 'Breakouts, Volume',
            is_favourite: 0,
            is_default: 1,
            created_at: '2025-08-20'
        },
        {
            slug: '15-minute-stock-breakouts',
            name: '15 Min Breakouts',
            description: 'Fresh 15-minute candlestick high breakouts with intraday volume surge',
            url: 'https://chartink.com/screener/15-minute-stock-breakouts',
            atlas_query: '( {57960} ( [0] 15 minute close > [-1] 15 minute max( 20 , [0] 15 minute close ) and [0] 15 minute volume > [0] 15 minute sma( volume,20 ) ) )',
            category_group: 'Intraday',
            tags: 'Intraday, Scalping',
            is_favourite: 0,
            is_default: 1,
            created_at: '2025-08-10'
        },
        {
            slug: 'volume-shockers',
            name: 'Volume Shockers',
            description: 'Surging volume today: latest volume > 5x 20-day average volume',
            url: 'https://chartink.com/screener/volume-shockers',
            atlas_query: '( {cash} ( latest volume > latest sma( volume,20 ) * 5 ) )',
            category_group: 'Volume',
            tags: 'Volume, Momentum',
            is_favourite: 0,
            is_default: 1,
            created_at: '2025-07-01'
        }
    ];

    // =========================================================
    // STATE VARIABLES
    // =========================================================
    let _scanners = [];
    let _scope = 'all'; // 'all' | 'fav'
    let _tagFilter = '';
    let _scannersSearchQuery = '';
    let _scannerSortCol = 'name';
    let _scannerSortDir = 'asc';
    let _expandedClauses = new Set();

    // View 2 (Detail View) State
    let _currentSlug = '';
    let _currentScanData = null;
    let _rawStocks = [];
    let _stocksFilter = 'all'; // 'all' | 'gainers' | 'losers' | 'high-vol'
    let _stocksSearch = '';
    let _stocksSort = 'per_chg_desc';
    let _currentPage = 1;
    let _pageSize = 25; // 10 | 25 | 50 | 100 | 'all'

    // Tag editing state
    let _editingSlugForTags = '';
    let _selectedStockForWl = '';

    // =========================================================
    // INITIALIZATION
    // =========================================================
    function getDeletedSlugs() {
        try {
            return JSON.parse(localStorage.getItem('ci_deleted_slugs') || '[]');
        } catch (e) {
            return [];
        }
    }

    async function initChartink() {
        const tabEl = document.getElementById('tab-chartink');
        if (!tabEl) return;

        const deletedSlugs = getDeletedSlugs();

        // Render fallback immediately so there is zero skeleton stall
        if (!_scanners || _scanners.length === 0) {
            _scanners = JSON.parse(JSON.stringify(FALLBACK_CATEGORIES)).filter(c => !deletedSlugs.includes(c.slug));
            populateTagFilterDropdown();
            renderScannersTable();
        }

        // Fetch fresh categories from backend
        try {
            const res = await fetch('/api/chartink/categories');
            const data = await res.json();
            if (data.success && Array.isArray(data.categories)) {
                _scanners = data.categories.filter(c => !deletedSlugs.includes(c.slug));
                populateTagFilterDropdown();
                renderScannersTable();
            }
        } catch (err) {
            console.warn('Could not fetch remote Chartink categories, using local cache:', err);
        }
    }
    window.initChartink = initChartink;

    // =========================================================
    // VIEW 1: SCANNERS & CATEGORIES DASHBOARD LOGIC
    // =========================================================
    function setChartinkScope(scope) {
        _scope = scope;
        const allBtn = document.getElementById('ci-scope-all');
        const favBtn = document.getElementById('ci-scope-fav');
        if (allBtn) allBtn.classList.toggle('active', scope === 'all');
        if (favBtn) favBtn.classList.toggle('active', scope === 'fav');
        renderScannersTable();
    }
    window.setChartinkScope = setChartinkScope;

    function handleChartinkTagFilter(tag) {
        _tagFilter = (tag || '').trim().toLowerCase();
        renderScannersTable();
    }
    window.handleChartinkTagFilter = handleChartinkTagFilter;

    function handleScannersSearch(query) {
        _scannersSearchQuery = (query || '').trim().toLowerCase();
        renderScannersTable();
    }
    window.handleScannersSearch = handleScannersSearch;

    function sortScannersBy(col) {
        if (_scannerSortCol === col) {
            _scannerSortDir = _scannerSortDir === 'asc' ? 'desc' : 'asc';
        } else {
            _scannerSortCol = col;
            _scannerSortDir = 'asc';
        }
        renderScannersTable();
    }
    window.sortScannersBy = sortScannersBy;

    function toggleChartinkChartPreview(enabled) {
        // Optional Chart preview toggle
        console.log('Chart preview toggled:', enabled);
    }
    window.toggleChartinkChartPreview = toggleChartinkChartPreview;

    function populateTagFilterDropdown() {
        const select = document.getElementById('ci-tag-filter');
        if (!select) return;

        const currentVal = select.value;
        const tagSet = new Set();

        _scanners.forEach(s => {
            if (s.tags) {
                s.tags.split(',').forEach(t => {
                    const clean = t.trim();
                    if (clean) tagSet.add(clean);
                });
            }
        });

        let html = '<option value="">Filter by tag</option>';
        Array.from(tagSet).sort().forEach(tag => {
            const selected = (tag.toLowerCase() === _tagFilter) ? 'selected' : '';
            html += `<option value="${escapeHtml(tag)}" ${selected}>${escapeHtml(tag)}</option>`;
        });
        select.innerHTML = html;
    }

    function renderScannersTable() {
        const tbody = document.getElementById('ci-scanners-tbody');
        if (!tbody) return;

        // 1. Filter
        let filtered = _scanners.filter(s => {
            if (_scope === 'fav' && !s.is_favourite) return false;

            if (_tagFilter) {
                const sTags = (s.tags || '').toLowerCase();
                if (!sTags.includes(_tagFilter)) return false;
            }

            if (_scannersSearchQuery) {
                const nameMatch = (s.name || '').toLowerCase().includes(_scannersSearchQuery);
                const descMatch = (s.description || '').toLowerCase().includes(_scannersSearchQuery);
                const clauseMatch = (s.atlas_query || '').toLowerCase().includes(_scannersSearchQuery);
                if (!nameMatch && !descMatch && !clauseMatch) return false;
            }

            return true;
        });

        // 2. Sort
        filtered.sort((a, b) => {
            let valA = '';
            let valB = '';
            if (_scannerSortCol === 'name') {
                valA = (a.name || '').toLowerCase();
                valB = (b.name || '').toLowerCase();
            } else if (_scannerSortCol === 'tag') {
                valA = (a.tags || '').toLowerCase();
                valB = (b.tags || '').toLowerCase();
            } else if (_scannerSortCol === 'date') {
                valA = a.created_at || '';
                valB = b.created_at || '';
            }
            if (valA < valB) return _scannerSortDir === 'asc' ? -1 : 1;
            if (valA > valB) return _scannerSortDir === 'asc' ? 1 : -1;
            return 0;
        });

        // 3. Render HTML
        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 40px 16px; color: var(--text-secondary);">
                        <div style="font-size: 26px; margin-bottom: 6px;">📂</div>
                        <div style="font-weight: 600; font-size: 14px;">No scanners match your filter criteria</div>
                        <div style="font-size: 12px; margin-top: 4px; color: var(--text-muted);">Switch to "All" or click "+ Create scanner" to import one from Chartink</div>
                    </td>
                </tr>
            `;
            const countLbl = document.getElementById('ci-scanners-count-lbl');
            if (countLbl) countLbl.textContent = 'Showing 0 scanners';
            return;
        }

        const rowsHtml = filtered.map(s => {
            const slug = escapeHtml(s.slug);
            const name = escapeHtml(s.name);
            const desc = escapeHtml(s.description || '—');
            const query = s.atlas_query || '';
            const isFav = s.is_favourite ? true : false;
            const isExpanded = _expandedClauses.has(s.slug);

            // Clause preview with ...more toggle
            let clauseHtml = '';
            if (query.length > 85 && !isExpanded) {
                const shortQuery = escapeHtml(query.substring(0, 80));
                clauseHtml = `
                    <div class="ci-clause-cell">
                        <span>${shortQuery}</span>
                        <button type="button" class="ci-clause-more-btn" onclick="toggleClauseExpand('${slug}', event)">...more</button>
                    </div>
                `;
            } else if (query.length > 85 && isExpanded) {
                clauseHtml = `
                    <div class="ci-clause-cell">
                        <span>${escapeHtml(query)}</span>
                        <button type="button" class="ci-clause-more-btn" onclick="toggleClauseExpand('${slug}', event)">...less</button>
                    </div>
                `;
            } else {
                clauseHtml = `<div class="ci-clause-cell">${escapeHtml(query || '—')}</div>`;
            }

            // Tags
            let tagsHtml = '';
            if (s.tags) {
                const tagList = s.tags.split(',').map(t => t.trim()).filter(Boolean);
                tagList.forEach(t => {
                    tagsHtml += `<span class="ci-tag-pill">${escapeHtml(t)}</span>`;
                });
            }
            tagsHtml += `
                <button type="button" class="ci-add-tag-btn" onclick="openEditTagsModal('${slug}', event)" title="Add or edit tags">
                    <span>+ Add tag</span>
                </button>
            `;

            // Created Date
            const dateStr = formatDate(s.created_at);

            // Actions (Icon-only: ⚡ Run, 🔗 Share, 🗑️ Delete for ALL categories)
            return `
                <tr>
                    <td>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <button type="button" class="ci-fav-star-btn ${isFav ? 'active' : ''}" 
                                onclick="toggleScreenerFavourite('${slug}', event)" 
                                title="${isFav ? 'Remove from favourites' : 'Mark as favourite'}">
                                ${isFav ? '★' : '☆'}
                            </button>
                            <a href="javascript:void(0)" class="ci-scanner-link" onclick="openScreenerDetail('${slug}')" title="Click to view live filtered stocks">
                                ${name}
                            </a>
                        </div>
                    </td>
                    <td><div class="ci-scanner-desc-cell">${desc}</div></td>
                    <td>${clauseHtml}</td>
                    <td>${tagsHtml}</td>
                    <td><span class="ci-scanner-date">${dateStr}</span></td>
                    <td>
                        <div class="ci-row-actions">
                            <button type="button" class="ci-icon-btn ci-btn-run" onclick="openScreenerDetail('${slug}')" title="Run Screener (View Stocks)">
                                ⚡
                            </button>
                            <button type="button" class="ci-icon-btn ci-btn-share" onclick="shareScreener('${slug}', this)" title="Share Scanner Link">
                                🔗
                            </button>
                            <button type="button" class="ci-icon-btn ci-btn-delete" onclick="deleteChartinkCategory('${slug}', event)" title="Delete Scanner">
                                🗑️
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = rowsHtml;

        const countLbl = document.getElementById('ci-scanners-count-lbl');
        if (countLbl) {
            countLbl.textContent = `Showing ${filtered.length} of ${_scanners.length} scanners`;
        }
    }

    function toggleClauseExpand(slug, event) {
        if (event) event.stopPropagation();
        if (_expandedClauses.has(slug)) {
            _expandedClauses.delete(slug);
        } else {
            _expandedClauses.add(slug);
        }
        renderScannersTable();
    }
    window.toggleClauseExpand = toggleClauseExpand;

    async function toggleScreenerFavourite(slug, event) {
        if (event) event.stopPropagation();
        const target = _scanners.find(s => s.slug === slug);
        if (!target) return;

        // Optimistic update
        target.is_favourite = target.is_favourite ? 0 : 1;
        renderScannersTable();

        try {
            await fetch(`/api/chartink/category/${encodeURIComponent(slug)}/favourite`, {
                method: 'POST'
            });
        } catch (e) {
            console.error('Failed to save favourite state:', e);
        }
    }
    window.toggleScreenerFavourite = toggleScreenerFavourite;

    function shareScreener(slug, btnEl) {
        const url = `${window.location.origin}/chartink?slug=${encodeURIComponent(slug)}`;
        navigator.clipboard.writeText(url).then(() => {
            if (btnEl) {
                const orig = btnEl.innerHTML;
                btnEl.innerHTML = '✓';
                btnEl.style.color = '#10b981';
                setTimeout(() => {
                    btnEl.innerHTML = orig;
                    btnEl.style.color = '';
                }, 1200);
            }
        }).catch(() => {
            prompt('Copy scanner link:', url);
        });
    }
    window.shareScreener = shareScreener;

    // =========================================================
    // VIEW 2: SCREENER DETAIL & PAGINATED RESULTS
    // =========================================================
    function openScreenerDetail(slug) {
        _currentSlug = slug;
        const screener = _scanners.find(s => s.slug === slug) || FALLBACK_CATEGORIES.find(s => s.slug === slug);

        // Switch Views
        const listView = document.getElementById('ci-view-scanners-list');
        const detailView = document.getElementById('ci-view-scanner-detail');
        if (listView) listView.style.display = 'none';
        if (detailView) detailView.style.display = 'flex';

        // Populate Screener Metadata Immediately
        const titleEl = document.getElementById('ci-detail-title');
        const badgeEl = document.getElementById('ci-detail-tag-badge');
        const countEl = document.getElementById('ci-detail-stock-count');
        const descEl = document.getElementById('ci-detail-desc');
        const queryEl = document.getElementById('ci-detail-query');
        const sourceLinkEl = document.getElementById('ci-detail-source-link');

        if (screener) {
            if (titleEl) titleEl.textContent = screener.name;
            if (badgeEl) badgeEl.textContent = screener.category_group || 'Technical';
            if (countEl) countEl.textContent = 'Loading stocks...';
            if (descEl) descEl.textContent = screener.description || "Filtered live by today's price action and technical rules.";
            if (queryEl) queryEl.textContent = screener.atlas_query || '—';
            if (sourceLinkEl) {
                sourceLinkEl.href = screener.url || `https://chartink.com/screener/${screener.slug}`;
            }
        }

        // Reset Filter / Search / Pagination State
        _currentPage = 1;
        _stocksFilter = 'all';
        _stocksSearch = '';
        _stocksSort = 'per_chg_desc';

        const searchInput = document.getElementById('ci-stocks-search-input');
        if (searchInput) searchInput.value = '';

        const pageSizeSelect = document.getElementById('ci-page-size-select');
        if (pageSizeSelect) pageSizeSelect.value = String(_pageSize);

        const sortSelect = document.getElementById('ci-stocks-sort-select');
        if (sortSelect) sortSelect.value = _stocksSort;

        document.querySelectorAll('.ci-filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-filter') === 'all');
        });

        // Run the scan
        loadScreenerStocks(slug);
    }
    window.openScreenerDetail = openScreenerDetail;

    function backToScannersList() {
        const listView = document.getElementById('ci-view-scanners-list');
        const detailView = document.getElementById('ci-view-scanner-detail');
        if (detailView) detailView.style.display = 'none';
        if (listView) listView.style.display = 'flex';

        // Refresh category table
        renderScannersTable();
    }
    window.backToScannersList = backToScannersList;

    async function loadScreenerStocks(slug, forceRefresh = false) {
        const refreshBtn = document.getElementById('ci-detail-refresh-btn');
        if (refreshBtn) refreshBtn.classList.add('spinning');

        showStocksTableSkeletons();

        try {
            const res = await fetch(`/api/chartink/scan/${encodeURIComponent(slug)}?refresh=${forceRefresh ? '1' : '0'}`);
            const data = await res.json();

            if (data.success && data.scan) {
                _currentScanData = data.scan;
                _rawStocks = data.scan.stocks || [];

                // Update detail header count
                const countEl = document.getElementById('ci-detail-stock-count');
                if (countEl) {
                    countEl.textContent = `${_rawStocks.length} Stocks`;
                }

                // Update formula if present
                const queryEl = document.getElementById('ci-detail-query');
                if (queryEl && data.scan.atlas_query) {
                    queryEl.textContent = data.scan.atlas_query;
                }

                // Render Paginated Stocks
                renderPaginatedStocks();
            } else {
                showStocksTableError(data.error || 'Failed to execute screener');
            }
        } catch (err) {
            console.error('Error executing Chartink scan:', err);
            showStocksTableError('Network error connecting to scan engine');
        } finally {
            if (refreshBtn) refreshBtn.classList.remove('spinning');
        }
    }
    window.loadScreenerStocks = loadScreenerStocks;

    function refreshCurrentScan() {
        if (_currentSlug) {
            loadScreenerStocks(_currentSlug, true);
        }
    }
    window.refreshCurrentScan = refreshCurrentScan;

    // =========================================================
    // PAGINATION ENGINE & STOCKS TABLE RENDERING
    // =========================================================
    function changePageSize(newSize) {
        _pageSize = (newSize === 'all') ? 'all' : parseInt(newSize, 10);
        _currentPage = 1;
        renderPaginatedStocks();
    }
    window.changePageSize = changePageSize;

    function goToPage(pageNum) {
        _currentPage = pageNum;
        renderPaginatedStocks();
        // Smooth scroll to top of table
        const tableCard = document.querySelector('.ci-table-card');
        if (tableCard) {
            tableCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
    window.goToPage = goToPage;

    function handleStocksSearch(query) {
        _stocksSearch = (query || '').trim().toLowerCase();
        _currentPage = 1;
        renderPaginatedStocks();
    }
    window.handleStocksSearch = handleStocksSearch;

    function setStocksFilter(filterType) {
        _stocksFilter = filterType;
        document.querySelectorAll('.ci-filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-filter') === filterType);
        });
        _currentPage = 1;
        renderPaginatedStocks();
    }
    window.setStocksFilter = setStocksFilter;

    function handleStocksSort(sortMode) {
        _stocksSort = sortMode;
        renderPaginatedStocks();
    }
    window.handleStocksSort = handleStocksSort;

    function renderPaginatedStocks() {
        const tbody = document.getElementById('ci-stocks-tbody');
        if (!tbody) return;

        if (!_rawStocks || _rawStocks.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 48px 16px; color: var(--text-secondary);">
                        <div style="font-size: 26px; margin-bottom: 8px;">📊</div>
                        <div style="font-weight: 600; font-size: 14px;">No stocks currently match this scanner criteria</div>
                        <div style="font-size: 12px; margin-top: 4px; color: var(--text-muted);">Try refreshing the scan or checking back when markets are active.</div>
                    </td>
                </tr>
            `;
            updatePaginationBar(0, 0, 0, 1);
            return;
        }

        // 1. Calculate Filter Pill Counts across all raw stocks
        const gainersCount = _rawStocks.filter(s => s.per_chg > 0).length;
        const losersCount = _rawStocks.filter(s => s.per_chg < 0).length;
        const totalCount = _rawStocks.length;

        const pillAll = document.getElementById('ci-pill-all-count');
        const pillG = document.getElementById('ci-pill-gainers-count');
        const pillL = document.getElementById('ci-pill-losers-count');
        if (pillAll) pillAll.textContent = totalCount;
        if (pillG) pillG.textContent = gainersCount;
        if (pillL) pillL.textContent = losersCount;

        // 2. Filter
        let filtered = _rawStocks.filter(stock => {
            if (_stocksFilter === 'gainers' && stock.per_chg <= 0) return false;
            if (_stocksFilter === 'losers' && stock.per_chg >= 0) return false;
            if (_stocksFilter === 'high-vol' && (stock.volume || 0) < 100000) return false;

            if (_stocksSearch) {
                const sym = (stock.symbol || '').toLowerCase();
                const nm = (stock.name || '').toLowerCase();
                if (!sym.includes(_stocksSearch) && !nm.includes(_stocksSearch)) return false;
            }
            return true;
        });

        // 3. Sort
        filtered.sort((a, b) => {
            switch (_stocksSort) {
                case 'per_chg_desc': return b.per_chg - a.per_chg;
                case 'per_chg_asc': return a.per_chg - b.per_chg;
                case 'close_desc': return b.close - a.close;
                case 'close_asc': return a.close - b.close;
                case 'volume_desc': return (b.volume || 0) - (a.volume || 0);
                case 'symbol_asc': return (a.symbol || '').localeCompare(b.symbol || '');
                default: return b.per_chg - a.per_chg;
            }
        });

        // 4. Pagination Slicing
        const totalFiltered = filtered.length;
        let startIndex = 0;
        let endIndex = totalFiltered;
        let totalPages = 1;
        let pageStocks = filtered;

        if (_pageSize !== 'all') {
            const size = parseInt(_pageSize, 10);
            totalPages = Math.max(1, Math.ceil(totalFiltered / size));
            if (_currentPage > totalPages) _currentPage = totalPages;
            if (_currentPage < 1) _currentPage = 1;

            startIndex = (_currentPage - 1) * size;
            endIndex = Math.min(startIndex + size, totalFiltered);
            pageStocks = filtered.slice(startIndex, endIndex);
        }

        // 5. Render Table Rows
        if (totalFiltered === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 40px 16px; color: var(--text-secondary);">
                        <div style="font-size: 24px; margin-bottom: 6px;">🔍</div>
                        <div style="font-weight: 600; font-size: 13.5px;">No stocks match your filter criteria</div>
                        <div style="font-size: 12px; margin-top: 4px; color: var(--text-muted);">Try adjusting your search query or selecting "All"</div>
                    </td>
                </tr>
            `;
            updatePaginationBar(0, 0, 0, 1);
            return;
        }

        const rowsHtml = pageStocks.map((stock, idx) => {
            const srNumber = startIndex + idx + 1;
            const sym = escapeHtml(stock.symbol);
            const name = escapeHtml(stock.name || sym);
            const closeFormatted = Number(stock.close).toLocaleString('en-IN', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            });

            // Change Badge
            const perChg = Number(stock.per_chg);
            let chgClass = 'ci-chg-zero';
            let arrow = '';
            if (perChg > 0) {
                chgClass = 'ci-chg-pos';
                arrow = '▲ ';
            } else if (perChg < 0) {
                chgClass = 'ci-chg-neg';
                arrow = '▼ ';
            }
            const sign = perChg > 0 ? '+' : '';
            const chgBadge = `<span class="ci-chg-badge ${chgClass}">${arrow}${sign}${perChg.toFixed(2)}%</span>`;

            // Formatted Volume
            const vol = stock.volume ? formatVolume(stock.volume) : '—';

            return `
                <tr>
                    <td class="ci-td-sr">${srNumber}</td>
                    <td>
                        <div class="ci-stock-cell">
                            <div class="ci-stock-symbol-row">
                                <span class="ci-stock-sym">${sym}</span>
                                <span class="ci-stock-exch">${stock.nsecode ? 'NSE' : 'BSE'}</span>
                            </div>
                            <div class="ci-stock-name" title="${name}">${name}</div>
                        </div>
                    </td>
                    <td class="ci-td-price">₹${closeFormatted}</td>
                    <td>${chgBadge}</td>
                    <td class="ci-td-vol">${vol}</td>
                    <td>
                        <div class="ci-actions-cell">
                            <button type="button" class="ci-action-btn" onclick="openChartinkStockChart('${sym}')" title="Open Native Interactive Chart">
                                <span>📈</span> <span>Chart</span>
                            </button>
                            <button type="button" class="ci-action-btn" onclick="openAddToWatchlistModal('${sym}')" title="Add ${sym} to Watchlist">
                                <span>➕</span> <span>Watchlist</span>
                            </button>
                            <button type="button" class="ci-action-btn" onclick="copyChartinkSymbol('${sym}', this)" title="Copy Symbol">
                                <span>📋</span>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = rowsHtml;

        // 6. Update Pagination Bar
        updatePaginationBar(startIndex + 1, endIndex, totalFiltered, totalPages);
    }

    function updatePaginationBar(start, end, total, totalPages) {
        const infoEl = document.getElementById('ci-pagination-info');
        const controlsEl = document.getElementById('ci-pagination-controls');
        if (!infoEl || !controlsEl) return;

        // Pagination Info Text
        if (total === 0) {
            infoEl.textContent = 'Showing 0 to 0 of 0 entries';
        } else {
            let infoText = `Showing ${start} to ${end} of ${total.toLocaleString()} entries`;
            if (total < _rawStocks.length) {
                infoText += ` (filtered from ${_rawStocks.length.toLocaleString()} total entries)`;
            }
            infoEl.textContent = infoText;
        }

        // Pagination Buttons
        if (totalPages <= 1) {
            controlsEl.innerHTML = '';
            return;
        }

        let buttonsHtml = '';

        // Previous Button
        const prevDisabled = (_currentPage === 1) ? 'disabled' : '';
        buttonsHtml += `
            <button type="button" class="ci-page-btn" ${prevDisabled} onclick="goToPage(${_currentPage - 1})">
                Previous
            </button>
        `;

        // Page Numbers with Ellipsis
        const pageNumbers = getPageNumbersList(_currentPage, totalPages);
        pageNumbers.forEach(p => {
            if (p === '...') {
                buttonsHtml += `<span class="ci-page-ellipsis">…</span>`;
            } else {
                const isActive = (p === _currentPage) ? 'active' : '';
                buttonsHtml += `
                    <button type="button" class="ci-page-btn ${isActive}" onclick="goToPage(${p})">
                        ${p}
                    </button>
                `;
            }
        });

        // Next Button
        const nextDisabled = (_currentPage === totalPages) ? 'disabled' : '';
        buttonsHtml += `
            <button type="button" class="ci-page-btn" ${nextDisabled} onclick="goToPage(${_currentPage + 1})">
                Next
            </button>
        `;

        controlsEl.innerHTML = buttonsHtml;
    }

    function getPageNumbersList(current, total) {
        if (total <= 7) {
            const list = [];
            for (let i = 1; i <= total; i++) list.push(i);
            return list;
        }

        if (current <= 4) {
            return [1, 2, 3, 4, 5, '...', total];
        }

        if (current >= total - 3) {
            return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
        }

        return [1, '...', current - 1, current, current + 1, '...', total];
    }

    function showStocksTableSkeletons() {
        const tbody = document.getElementById('ci-stocks-tbody');
        if (!tbody) return;
        tbody.innerHTML = `
            <tr><td colspan="6"><div class="ci-table-skeleton">
                <div class="skeleton-box" style="height: 40px; margin: 4px 0; border-radius: 6px;"></div>
                <div class="skeleton-box" style="height: 40px; margin: 4px 0; border-radius: 6px;"></div>
                <div class="skeleton-box" style="height: 40px; margin: 4px 0; border-radius: 6px;"></div>
                <div class="skeleton-box" style="height: 40px; margin: 4px 0; border-radius: 6px;"></div>
                <div class="skeleton-box" style="height: 40px; margin: 4px 0; border-radius: 6px;"></div>
            </div></td></tr>
        `;
    }

    function showStocksTableError(msg) {
        const tbody = document.getElementById('ci-stocks-tbody');
        if (!tbody) return;
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px 16px; color: var(--text-secondary);">
                    <div style="font-size: 26px; margin-bottom: 6px;">⚠️</div>
                    <div style="font-weight: 600; color: #ef4444; font-size: 14px;">${escapeHtml(msg)}</div>
                    <button type="button" class="btn btn-secondary" style="margin-top: 12px; font-size: 12px; padding: 5px 14px;" onclick="refreshCurrentScan()">
                        ↻ Try Again
                    </button>
                </td>
            </tr>
        `;
    }

    // =========================================================
    // TAG MANAGEMENT MODAL LOGIC
    // =========================================================
    function openEditTagsModal(slug, event) {
        if (event) event.stopPropagation();
        _editingSlugForTags = slug;
        const target = _scanners.find(s => s.slug === slug);
        if (!target) return;

        const nameEl = document.getElementById('ci-tag-scanner-name');
        const inputEl = document.getElementById('ci-tag-input');
        const modal = document.getElementById('chartinkTagModal');

        if (nameEl) nameEl.textContent = target.name;
        if (inputEl) inputEl.value = target.tags || '';
        if (modal) modal.style.display = 'flex';
        setTimeout(() => inputEl && inputEl.focus(), 60);
    }
    window.openEditTagsModal = openEditTagsModal;

    function closeChartinkTagModal() {
        const modal = document.getElementById('chartinkTagModal');
        if (modal) modal.style.display = 'none';
        _editingSlugForTags = '';
    }
    window.closeChartinkTagModal = closeChartinkTagModal;

    function appendChartinkTag(tag) {
        const input = document.getElementById('ci-tag-input');
        if (!input) return;
        const current = input.value.split(',').map(t => t.trim()).filter(Boolean);
        if (!current.includes(tag)) {
            current.push(tag);
            input.value = current.join(', ');
        }
    }
    window.appendChartinkTag = appendChartinkTag;

    async function saveChartinkTags() {
        if (!_editingSlugForTags) return;
        const input = document.getElementById('ci-tag-input');
        const newTags = (input?.value || '').trim();

        const target = _scanners.find(s => s.slug === _editingSlugForTags);
        if (target) {
            target.tags = newTags;
        }

        closeChartinkTagModal();
        populateTagFilterDropdown();
        renderScannersTable();

        try {
            await fetch(`/api/chartink/category/${encodeURIComponent(_editingSlugForTags)}/tags`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags: newTags })
            });
        } catch (e) {
            console.error('Failed to save tags on server:', e);
        }
    }
    window.saveChartinkTags = saveChartinkTags;

    function openManageTagsModal() {
        const select = document.getElementById('ci-tag-filter');
        if (select) {
            select.focus();
        }
    }
    window.openManageTagsModal = openManageTagsModal;

    // =========================================================
    // MODAL: IMPORT / COPY FROM CHARTINK
    // =========================================================
    function openChartinkImportModal() {
        const modal = document.getElementById('chartinkImportModal');
        const input = document.getElementById('ci-import-url');
        const errBox = document.getElementById('ci-modal-error');

        if (errBox) errBox.style.display = 'none';
        if (input) {
            input.value = '';
            setTimeout(() => input.focus(), 80);
        }
        if (modal) modal.style.display = 'flex';
    }
    window.openChartinkImportModal = openChartinkImportModal;

    function closeChartinkImportModal() {
        const modal = document.getElementById('chartinkImportModal');
        if (modal) modal.style.display = 'none';
    }
    window.closeChartinkImportModal = closeChartinkImportModal;

    function setChartinkImportUrl(url) {
        const input = document.getElementById('ci-import-url');
        if (input) {
            input.value = url;
            input.focus();
        }
    }
    window.setChartinkImportUrl = setChartinkImportUrl;

    async function pasteFromClipboard(targetId) {
        try {
            const text = await navigator.clipboard.readText();
            const el = document.getElementById(targetId);
            if (el && text) {
                el.value = text.trim();
                el.focus();
            }
        } catch (e) {
            alert('Clipboard access not permitted. Please paste manually (Ctrl+V).');
        }
    }
    window.pasteFromClipboard = pasteFromClipboard;

    async function submitChartinkImport() {
        const input = document.getElementById('ci-import-url');
        const tagsInput = document.getElementById('ci-import-tags');
        const submitBtn = document.getElementById('ci-submit-import-btn');
        const errBox = document.getElementById('ci-modal-error');

        const rawUrl = (input?.value || '').trim();
        if (!rawUrl) {
            if (errBox) {
                errBox.textContent = 'Please enter a valid Chartink screener URL or slug';
                errBox.style.display = 'block';
            }
            return;
        }

        const tags = (tagsInput?.value || '').trim() || 'Custom';
        if (errBox) errBox.style.display = 'none';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span>⏳</span> <span>Importing &amp; Scanning...</span>';
        }

        try {
            const res = await fetch('/api/chartink/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: rawUrl, tags: tags, category_group: 'Custom' })
            });
            const data = await res.json();

            if (data.success && data.screener) {
                closeChartinkImportModal();
                // Remove from deleted list if re-imported
                try {
                    let stored = JSON.parse(localStorage.getItem('ci_deleted_slugs') || '[]');
                    stored = stored.filter(s => s !== data.screener.slug);
                    localStorage.setItem('ci_deleted_slugs', JSON.stringify(stored));
                } catch (e) {}

                // Add to local list if not present
                const existingIdx = _scanners.findIndex(s => s.slug === data.screener.slug);
                if (existingIdx >= 0) {
                    _scanners[existingIdx] = data.screener;
                } else {
                    _scanners.unshift(data.screener);
                }

                populateTagFilterDropdown();
                renderScannersTable();

                // Open newly imported screener immediately!
                openScreenerDetail(data.screener.slug);
            } else {
                if (errBox) {
                    errBox.textContent = data.error || 'Failed to import screener. Please check the URL.';
                    errBox.style.display = 'block';
                }
            }
        } catch (err) {
            if (errBox) {
                errBox.textContent = 'Network error while importing from Chartink.';
                errBox.style.display = 'block';
            }
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<span>⚡</span> <span>Import &amp; Add Scanner</span>';
            }
        }
    }
    window.submitChartinkImport = submitChartinkImport;

    async function deleteChartinkCategory(slug, event) {
        if (event) event.stopPropagation();
        const target = _scanners.find(s => s.slug === slug);
        const displayName = target ? target.name : slug;
        if (!confirm(`Are you sure you want to delete scanner "${displayName}"?`)) return;

        // Remember deleted slug so it is never re-added from fallback
        try {
            const stored = JSON.parse(localStorage.getItem('ci_deleted_slugs') || '[]');
            if (!stored.includes(slug)) {
                stored.push(slug);
                localStorage.setItem('ci_deleted_slugs', JSON.stringify(stored));
            }
        } catch (e) {}

        // Optimistically remove from list immediately
        _scanners = _scanners.filter(s => s.slug !== slug);
        populateTagFilterDropdown();
        renderScannersTable();

        try {
            const res = await fetch(`/api/chartink/category/${encodeURIComponent(slug)}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (!data.success) {
                console.warn('Backend delete error:', data.error);
            }
        } catch (e) {
            console.error('Failed to delete scanner on backend:', e);
        }
    }
    window.deleteChartinkCategory = deleteChartinkCategory;

    // =========================================================
    // QUICK ACTIONS: CHART, WATCHLIST & EXPORT
    // =========================================================
    function openChartinkStockChart(symbol) {
        if (typeof window.openInHouseChart === 'function') {
            window.openInHouseChart(symbol);
        } else {
            window.open(`/tv-chart?symbol=NSE:${encodeURIComponent(symbol)}`, '_blank');
        }
    }
    window.openChartinkStockChart = openChartinkStockChart;

    async function openAddToWatchlistModal(symbol) {
        _selectedStockForWl = symbol;
        const symEl = document.getElementById('ci-wl-stock-symbol');
        if (symEl) symEl.textContent = symbol;

        const select = document.getElementById('ci-wl-select');
        if (select) {
            select.innerHTML = '<option value="">Loading watchlists...</option>';
            try {
                const res = await fetch('/api/watchlists');
                const data = await res.json();
                if (data.success && data.watchlists) {
                    const keys = Object.keys(data.watchlists);
                    if (keys.length > 0) {
                        select.innerHTML = keys.map(k => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join('');
                    } else {
                        select.innerHTML = '<option value="">No watchlists found</option>';
                    }
                }
            } catch (err) {
                select.innerHTML = '<option value="">Failed to load watchlists</option>';
            }
        }

        const modal = document.getElementById('chartinkAddToWatchlistModal');
        if (modal) modal.style.display = 'flex';
    }
    window.openAddToWatchlistModal = openAddToWatchlistModal;

    function closeChartinkWatchlistModal() {
        const modal = document.getElementById('chartinkAddToWatchlistModal');
        if (modal) modal.style.display = 'none';
    }
    window.closeChartinkWatchlistModal = closeChartinkWatchlistModal;

    async function confirmAddChartinkToWatchlist() {
        const select = document.getElementById('ci-wl-select');
        const wlName = select?.value;
        if (!wlName || !_selectedStockForWl) return;

        const btn = document.getElementById('ci-wl-confirm-btn');
        if (btn) btn.disabled = true;

        try {
            const res = await fetch(`/api/watchlists/${encodeURIComponent(wlName)}/stocks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol: _selectedStockForWl })
            });
            const data = await res.json();
            if (data.success) {
                closeChartinkWatchlistModal();
                alert(`Added ${_selectedStockForWl} to watchlist "${wlName}" successfully!`);
                if (typeof window.loadWatchlist === 'function') {
                    window.loadWatchlist();
                }
            } else {
                alert(data.error || 'Failed to add stock to watchlist');
            }
        } catch (e) {
            alert('Network error adding stock to watchlist');
        } finally {
            if (btn) btn.disabled = false;
        }
    }
    window.confirmAddChartinkToWatchlist = confirmAddChartinkToWatchlist;

    function copyChartinkSymbol(symbol, btnEl) {
        if (!symbol) return;
        navigator.clipboard.writeText(symbol).then(() => {
            if (btnEl) {
                const orig = btnEl.innerHTML;
                btnEl.innerHTML = '<span>✓</span>';
                setTimeout(() => { btnEl.innerHTML = orig; }, 1200);
            }
        }).catch(() => {
            prompt('Copy symbol:', symbol);
        });
    }
    window.copyChartinkSymbol = copyChartinkSymbol;

    function exportChartinkCsv() {
        if (!_rawStocks || _rawStocks.length === 0) {
            alert('No stocks available to export');
            return;
        }

        const headers = ['Sr', 'Symbol', 'Exchange', 'Company Name', 'LTP (INR)', 'Change (%)', 'Volume'];
        const csvRows = [headers.join(',')];

        _rawStocks.forEach((s, i) => {
            const row = [
                i + 1,
                `"${(s.symbol || '').replace(/"/g, '""')}"`,
                `"${s.nsecode ? 'NSE' : 'BSE'}"`,
                `"${(s.name || '').replace(/"/g, '""')}"`,
                s.close,
                s.per_chg,
                s.volume || 0
            ];
            csvRows.push(row.join(','));
        });

        const csvContent = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvRows.join('\n'));
        const link = document.createElement('a');
        const filename = `Chartink_${_currentSlug || 'scan'}_${new Date().toISOString().slice(0, 10)}.csv`;
        link.setAttribute('href', csvContent);
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    window.exportChartinkCsv = exportChartinkCsv;

    // =========================================================
    // UTILITY HELPERS
    // =========================================================
    function formatDate(dateStr) {
        if (!dateStr) return '—';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
        } catch (e) {
            return dateStr;
        }
    }

    function formatVolume(vol) {
        if (!vol || isNaN(vol)) return '0';
        const num = Number(vol);
        if (num >= 10000000) return (num / 10000000).toFixed(2) + ' Cr';
        if (num >= 100000) return (num / 100000).toFixed(2) + ' L';
        if (num >= 1000) return (num / 1000).toFixed(1) + ' K';
        return num.toLocaleString('en-IN');
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
})();
