        let currentInsightsScope = 'all';
        let currentInsightsWatchlist = '';
        let currentNewsCategory = 'all';
        let cachedInsightsArticles = [];

        function openInsightsFundamentals(symbol) {
            if (!symbol) return;
            if (typeof window.openFundamentalsModal === 'function') {
                window.openFundamentalsModal(symbol);
            } else if (typeof openFundamentalsModal === 'function') {
                openFundamentalsModal(symbol);
            }
        }

        function openInsightsTechnical(symbol) {
            if (!symbol) return;
            if (typeof window.openInHouseChart === 'function') {
                window.openInHouseChart(symbol);
            } else if (typeof openInHouseChart === 'function') {
                openInHouseChart(symbol);
            } else if (typeof window.openChart === 'function') {
                window.openChart(symbol);
            } else if (typeof openChart === 'function') {
                openChart(symbol);
            }
        }

        window.openInsightsFundamentals = openInsightsFundamentals;
        window.openInsightsTechnical = openInsightsTechnical;
        window.loadInsightsBullion = loadInsightsBullion;
        window.filterBullionCards = filterBullionCards;
        window.renderInsightsBullionUI = renderInsightsBullionUI;

        async function ensureWatchlistsAndPortfolios() {
            const promises = [];
            if (!window.watchlistsLoaded || !watchlistsData || Object.keys(watchlistsData).length === 0) {
                promises.push(
                    fetch('/api/watchlists')
                        .then(res => res.json())
                        .then(data => {
                            watchlistsData = data || {};
                            window.watchlistsLoaded = true;
                        })
                        .catch(e => console.error('Error fetching watchlists:', e))
                );
            }
            if (!window.portfoliosLoaded || !portfoliosData || Object.keys(portfoliosData).length === 0) {
                promises.push(
                    fetch('/api/portfolios')
                        .then(res => res.json())
                        .then(data => {
                            portfoliosData = data || {};
                            window.portfoliosLoaded = true;
                        })
                        .catch(e => console.error('Error fetching portfolios:', e))
                );
            }
            if (promises.length > 0) {
                await Promise.all(promises);
            }
        }

        function getScopedSymbols() {
            if (currentInsightsScope === 'portfolio') {
                const pfSyms = new Set();
                Object.values(portfoliosData || {}).forEach(holdings => {
                    (holdings || []).forEach(h => {
                        if (h.symbol) {
                            pfSyms.add(h.symbol);
                            if (typeof cleanDisplaySymbol === 'function') pfSyms.add(cleanDisplaySymbol(h.symbol));
                            pfSyms.add(h.symbol.replace('.NS', '').replace('.BO', ''));
                        }
                    });
                });
                return pfSyms;
            } else if (currentInsightsScope === 'watchlist') {
                const wlSyms = new Set();
                if (currentInsightsWatchlist && watchlistsData && watchlistsData[currentInsightsWatchlist]) {
                    watchlistsData[currentInsightsWatchlist].forEach(s => {
                        if (s) {
                            wlSyms.add(s);
                            if (typeof cleanDisplaySymbol === 'function') wlSyms.add(cleanDisplaySymbol(s));
                            wlSyms.add(s.replace('.NS', '').replace('.BO', ''));
                        }
                    });
                }
                return wlSyms;
            }
            return null; // 'all' scope -> no symbol restriction
        }

        function getScopedScannerStocks(stocks) {
            if (!Array.isArray(stocks)) return [];
            const scopedSyms = getScopedSymbols();
            if (!scopedSyms) return stocks;
            return stocks.filter(stock => {
                const raw = stock.symbol || '';
                const clean = typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(raw) : raw;
                const bare = raw.replace('.NS', '').replace('.BO', '');
                return scopedSyms.has(raw) || scopedSyms.has(clean) || scopedSyms.has(bare);
            });
        }

        function renderInsightsWatchlistPills() {
            const pillsContainer = document.getElementById('insights-watchlist-pills');
            if (!pillsContainer) return;

            const names = Object.keys(watchlistsData || {});
            if (names.length === 0) {
                pillsContainer.innerHTML = '<span style="font-size: 11.5px; color: var(--text-secondary); font-style: italic;">No watchlists available</span>';
                return;
            }

            if (!currentInsightsWatchlist || !watchlistsData[currentInsightsWatchlist]) {
                currentInsightsWatchlist = names[0];
            }

            let html = '';
            names.forEach(name => {
                const count = (watchlistsData[name] || []).length;
                const isActive = name === currentInsightsWatchlist;
                const btnClass = isActive ? 'btn-primary' : 'btn-secondary';
                const activeStyle = isActive ? 'background: var(--accent-color, #10b981); color: #fff; border-color: var(--accent-color, #10b981);' : '';
                html += `
                    <button type="button" class="${btnClass}" onclick="selectInsightsWatchlist('${escapeHtml(name)}')" style="font-size: 11.5px; padding: 5px 12px; border-radius: 20px; display: flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap; ${activeStyle}">
                        <span>${escapeHtml(name)}</span>
                        <span style="font-size: 10px; font-weight: 700; background: ${isActive ? 'rgba(255,255,255,0.25)' : 'var(--bg-subtle)'}; color: ${isActive ? '#fff' : 'var(--text-secondary)'}; padding: 1px 6px; border-radius: 10px;">
                            ${count}
                        </span>
                    </button>
                `;
            });
            pillsContainer.innerHTML = html;
        }

        async function selectInsightsWatchlist(name) {
            currentInsightsWatchlist = name;
            renderInsightsWatchlistPills();

            populateInsightsStockFilterOptions();
            renderTechnicalScreenerPills();
            renderTechnicalScreenerTable();

            showNewsSkeletonsOnly();
            const feedEl = document.getElementById('insights-news-feed');
            const loadMoreContainer = document.getElementById('insights-load-more-container');
            const stockFilter = document.getElementById('insights-stock-filter')?.value || 'all';
            const stockParam = stockFilter !== 'all' ? `&stock=${encodeURIComponent(stockFilter)}` : '';

            try {
                const res = await fetch(`/api/insights/news?scope=watchlist&watchlist=${encodeURIComponent(currentInsightsWatchlist)}${stockParam}&category=${encodeURIComponent(currentNewsCategory)}&limit=30`);
                const data = await res.json();
                if (data.success) {
                    cachedInsightsArticles = data.articles || [];
                    populateInsightsStockFilterOptions();
                    filterAndRenderInsightsNews();
                    if (loadMoreContainer) loadMoreContainer.style.display = 'block';
                } else if (feedEl) {
                    feedEl.innerHTML = `<div style="padding: 20px; color: #ef4444;">Error loading news: ${escapeHtml(data.error || 'Failed')}</div>`;
                }
            } catch(err) {
                if (feedEl) feedEl.innerHTML = `<div style="padding: 20px; color: #ef4444;">Failed to load news: ${escapeHtml(err.message)}</div>`;
            }

            fetch(`/api/insights/summary?scope=watchlist&watchlist=${encodeURIComponent(currentInsightsWatchlist)}`)
                .then(res => res.json())
                .then(data => {
                    if (data.success) renderInsightsSummaryUI(data);
                })
                .catch(err => console.error('Error loading watchlist summary:', err));
        }

        async function setNewsCategory(cat) {
            currentNewsCategory = cat;
            const categories = ['all', 'research', 'corporate', 'macro'];
            categories.forEach(c => {
                const btn = document.getElementById(`cat-pill-${c}`);
                if (btn) btn.className = c === cat ? 'btn-primary' : 'btn-secondary';
            });

            showNewsSkeletonsOnly();
            const stockFilter = document.getElementById('insights-stock-filter')?.value || 'all';
            const stockParam = stockFilter !== 'all' ? `&stock=${encodeURIComponent(stockFilter)}` : '';
            const wlParam = currentInsightsScope === 'watchlist' && currentInsightsWatchlist ? `&watchlist=${encodeURIComponent(currentInsightsWatchlist)}` : '';
            
            try {
                const res = await fetch(`/api/insights/news?scope=${encodeURIComponent(currentInsightsScope)}${wlParam}${stockParam}&category=${encodeURIComponent(cat)}&limit=30`);
                const data = await res.json();
                if (data.success && data.articles) {
                    cachedInsightsArticles = data.articles;
                    filterAndRenderInsightsNews();
                } else {
                    filterAndRenderInsightsNews();
                }
            } catch(e) {
                filterAndRenderInsightsNews();
            }
        }

        function showNewsSkeletonsOnly() {
            const feedEl = document.getElementById('insights-news-feed');
            if (feedEl) {
                let newsSkeletons = '';
                for (let i = 0; i < 4; i++) {
                    newsSkeletons += `
                        <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 10px; box-shadow: var(--shadow-sm);">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="display: flex; gap: 6px; align-items: center;">
                                    <span class="skeleton-box" style="width: 80px; height: 16px;"></span>
                                    <span class="skeleton-box" style="width: 60px; height: 16px;"></span>
                                </div>
                                <span class="skeleton-box" style="width: 70px; height: 12px;"></span>
                            </div>
                            <span class="skeleton-box" style="width: 95%; height: 16px;"></span>
                            <span class="skeleton-box" style="width: 65%; height: 14px;"></span>
                            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-color); padding-top: 8px; margin-top: 4px;">
                                <span class="skeleton-box" style="width: 110px; height: 12px;"></span>
                                <span class="skeleton-box" style="width: 90px; height: 12px;"></span>
                            </div>
                        </div>
                    `;
                }
                feedEl.innerHTML = newsSkeletons;
            }
        }

        function showInsightsSkeletons() {
            // 1. News Feed Skeletons
            showNewsSkeletonsOnly();

            // 2. Market Indexes Grid Skeletons (8 cards)
            const idxGrid = document.getElementById('insights-indexes-grid');
            if (idxGrid) {
                let idxSkeletons = '';
                for (let i = 0; i < 8; i++) {
                    idxSkeletons += `
                        <div style="background: var(--bg-subtle); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px 12px; height: 68px; display: flex; flex-direction: column; justify-content: space-between;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span class="skeleton-box" style="width: 55px; height: 12px;"></span>
                                <span class="skeleton-box" style="width: 32px; height: 12px;"></span>
                            </div>
                            <span class="skeleton-box" style="width: 75px; height: 15px;"></span>
                            <span class="skeleton-box" style="width: 90px; height: 11px;"></span>
                        </div>
                    `;
                }
                idxGrid.innerHTML = idxSkeletons;
            }

            // 2b. Bullion Skeletons
            const bullionMount = document.getElementById('insights-bullion-mount');
            if (bullionMount) {
                bullionMount.innerHTML = `
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <div style="background: var(--bg-subtle); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px 14px; height: 84px; display: flex; flex-direction: column; justify-content: space-between;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span class="skeleton-box" style="width: 120px; height: 14px;"></span>
                                <span class="skeleton-box" style="width: 60px; height: 12px;"></span>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                                <span class="skeleton-box" style="width: 100%; height: 38px; border-radius: 6px;"></span>
                                <span class="skeleton-box" style="width: 100%; height: 38px; border-radius: 6px;"></span>
                            </div>
                        </div>
                        <div style="background: var(--bg-subtle); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px 14px; height: 84px; display: flex; flex-direction: column; justify-content: space-between;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span class="skeleton-box" style="width: 120px; height: 14px;"></span>
                                <span class="skeleton-box" style="width: 60px; height: 12px;"></span>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                                <span class="skeleton-box" style="width: 100%; height: 38px; border-radius: 6px;"></span>
                                <span class="skeleton-box" style="width: 100%; height: 38px; border-radius: 6px;"></span>
                            </div>
                        </div>
                    </div>
                `;
            }

            // 3. FII / DII Flow Skeletons
            const fiiMount = document.getElementById('insights-fiidii-mount');
            if (fiiMount) {
                fiiMount.innerHTML = `
                    <div style="background: var(--bg-subtle); padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; height: 34px;">
                        <span class="skeleton-box" style="width: 70px; height: 12px;"></span>
                        <span class="skeleton-box" style="width: 85px; height: 14px;"></span>
                    </div>
                    <div style="background: var(--bg-subtle); padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; height: 34px;">
                        <span class="skeleton-box" style="width: 70px; height: 12px;"></span>
                        <span class="skeleton-box" style="width: 85px; height: 14px;"></span>
                    </div>
                    <div style="background: var(--bg-subtle); padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; height: 34px;">
                        <span class="skeleton-box" style="width: 100px; height: 12px;"></span>
                        <span class="skeleton-box" style="width: 90px; height: 14px;"></span>
                    </div>
                `;
            }

            // 4. Highlights Skeletons
            const gainerSymEl = document.getElementById('insights-top-gainer-sym');
            const gainerValEl = document.getElementById('insights-top-gainer-val');
            if (gainerSymEl) gainerSymEl.innerHTML = '<span class="skeleton-box" style="width: 70px; height: 14px;"></span>';
            if (gainerValEl) gainerValEl.innerHTML = '<span class="skeleton-box" style="width: 90px; height: 12px;"></span>';

            const loserSymEl = document.getElementById('insights-top-loser-sym');
            const loserValEl = document.getElementById('insights-top-loser-val');
            if (loserSymEl) loserSymEl.innerHTML = '<span class="skeleton-box" style="width: 70px; height: 14px;"></span>';
            if (loserValEl) loserValEl.innerHTML = '<span class="skeleton-box" style="width: 90px; height: 12px;"></span>';

            const dayGainEl = document.getElementById('insights-day-gain-val');
            if (dayGainEl) dayGainEl.innerHTML = '<span class="skeleton-box" style="width: 80px; height: 14px;"></span>';

            // 5. Distribution Skeletons
            const distMount = document.getElementById('insights-distribution-mount');
            if (distMount) {
                distMount.innerHTML = `
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span class="skeleton-box" style="width: 80px; height: 12px;"></span>
                                <span class="skeleton-box" style="width: 35px; height: 12px;"></span>
                            </div>
                            <div class="skeleton-box" style="width: 100%; height: 8px;"></div>
                        </div>
                        <div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span class="skeleton-box" style="width: 90px; height: 12px;"></span>
                                <span class="skeleton-box" style="width: 35px; height: 12px;"></span>
                            </div>
                            <div class="skeleton-box" style="width: 100%; height: 8px;"></div>
                        </div>
                    </div>
                `;
            }

            // 6. Investment Thesis Skeleton
            const thesisMount = document.getElementById('insights-thesis-mount');
            if (thesisMount) {
                thesisMount.innerHTML = `
                    <div style="background: var(--bg-subtle); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;">
                        <div style="display: flex; justify-content: space-between;">
                            <span class="skeleton-box" style="width: 70px; height: 13px;"></span>
                            <span class="skeleton-box" style="width: 65px; height: 13px;"></span>
                        </div>
                        <span class="skeleton-box" style="width: 90%; height: 11px;"></span>
                    </div>
                `;
            }
        }

        async function loadInsightsTab(scope = null) {
            await ensureWatchlistsAndPortfolios();

            const isScopeChange = (scope !== null);
            if (scope) currentInsightsScope = scope;
            
            const btnAll = document.getElementById('insights-scope-all');
            const btnPf = document.getElementById('insights-scope-portfolio');
            const btnWl = document.getElementById('insights-scope-watchlist');
            const wlContainer = document.getElementById('insights-watchlist-container');

            if (btnAll) btnAll.className = currentInsightsScope === 'all' ? 'btn-primary' : 'btn-secondary';
            if (btnPf) btnPf.className = currentInsightsScope === 'portfolio' ? 'btn-primary' : 'btn-secondary';
            if (btnWl) btnWl.className = currentInsightsScope === 'watchlist' ? 'btn-primary' : 'btn-secondary';

            if (currentInsightsScope === 'watchlist') {
                if (wlContainer) wlContainer.style.display = 'flex';
                const names = Object.keys(watchlistsData || {});
                if (!currentInsightsWatchlist || !watchlistsData[currentInsightsWatchlist]) {
                    currentInsightsWatchlist = names.length > 0 ? names[0] : '';
                }
                renderInsightsWatchlistPills();
            } else {
                if (wlContainer) wlContainer.style.display = 'none';
            }

            const wlParam = currentInsightsScope === 'watchlist' && currentInsightsWatchlist ? `&watchlist=${encodeURIComponent(currentInsightsWatchlist)}` : '';

            if (isScopeChange) {
                showNewsSkeletonsOnly();
                populateInsightsStockFilterOptions();
                renderTechnicalScreenerPills();
                renderTechnicalScreenerTable();

                const feedEl = document.getElementById('insights-news-feed');
                const loadMoreContainer = document.getElementById('insights-load-more-container');
                fetch(`/api/insights/news?scope=${encodeURIComponent(currentInsightsScope)}${wlParam}&category=${encodeURIComponent(currentNewsCategory)}&limit=30`)
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            cachedInsightsArticles = data.articles || [];
                            populateInsightsStockFilterOptions();
                            filterAndRenderInsightsNews();
                            if (loadMoreContainer) loadMoreContainer.style.display = 'block';
                        } else if (feedEl) {
                            feedEl.innerHTML = `<div style="padding: 20px; color: #ef4444;">Error loading news: ${escapeHtml(data.error || 'Failed')}</div>`;
                        }
                    })
                    .catch(err => {
                        if (feedEl) {
                            feedEl.innerHTML = `<div style="padding: 20px; color: #ef4444;">Failed to load insights feed: ${escapeHtml(err.message)}</div>`;
                        }
                    });

                fetch(`/api/insights/summary?scope=${encodeURIComponent(currentInsightsScope)}${wlParam}`)
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) renderInsightsSummaryUI(data);
                    })
                    .catch(err => console.error('Error loading insights summary:', err));

                return;
            }

            showInsightsSkeletons();

            // 1. Parallel Fetch: Highlights, Distribution & Thesis Summary (~100ms)
            fetch(`/api/insights/summary?scope=${encodeURIComponent(currentInsightsScope)}${wlParam}`)
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        renderInsightsSummaryUI(data);
                    }
                })
                .catch(err => console.error('Error loading insights summary:', err));

            // 2. Parallel Fetch: Market Indexes Grid (~300ms)
            fetch('/api/insights/indexes')
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        renderInsightsIndexesUI(data.market_indexes || []);
                    }
                })
                .catch(err => console.error('Error loading market indexes:', err));

            // 3. Parallel Fetch: FII / DII Flow (~300ms)
            fetch('/api/insights/fiidii')
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        renderInsightsFiiDiiUI(data.fii_dii);
                    }
                })
                .catch(err => console.error('Error loading FII/DII data:', err));

            // 4. Parallel Fetch: News Articles Feed (~400ms)
            const feedEl = document.getElementById('insights-news-feed');
            const loadMoreContainer = document.getElementById('insights-load-more-container');
            fetch(`/api/insights/news?scope=${encodeURIComponent(currentInsightsScope)}${wlParam}&category=${encodeURIComponent(currentNewsCategory)}&limit=30`)
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        cachedInsightsArticles = data.articles || [];
                        populateInsightsStockFilterOptions();
                        filterAndRenderInsightsNews();
                        if (loadMoreContainer) {
                            loadMoreContainer.style.display = 'block';
                        }
                    } else if (feedEl) {
                        feedEl.innerHTML = `<div style="padding: 20px; color: #ef4444;">Error loading news: ${escapeHtml(data.error || 'Failed')}</div>`;
                    }
                })
                .catch(err => {
                    if (feedEl) {
                        feedEl.innerHTML = `<div style="padding: 20px; color: #ef4444;">Failed to load insights feed: ${escapeHtml(err.message)}</div>`;
                    }
                });

            // 5. Parallel Fetch: Technical Intelligence Screeners (~400ms)
            loadTechnicalInsights();

            // 6. Parallel Fetch: Live Bullion (Gold & Silver) Rates (~150ms)
            loadInsightsBullion();
        }

        // =========================================================
        // TECHNICAL SIGNALS & STOCK SCREENERS JS
        // =========================================================
        let activeScreenerId = 'golden_cross';
        let technicalsData = null;

        function toggleTechnicalScreenerAccordion() {
            const body = document.getElementById('technicals-accordion-body');
            const icon = document.getElementById('technicals-accordion-icon');
            const label = document.getElementById('technicals-accordion-label');

            if (!body) return;

            if (body.style.display === 'none') {
                body.style.display = 'block';
                if (icon) icon.textContent = '▲';
                if (label) label.textContent = 'Collapse';
            } else {
                body.style.display = 'none';
                if (icon) icon.textContent = '▼';
                if (label) label.textContent = 'Expand';
            }
        }

        async function loadTechnicalInsights(forceRefresh = false) {
            const pillsContainer = document.getElementById('technical-screener-pills');
            const tableBody = document.getElementById('technical-screener-table-body');
            const scannedCountEl = document.getElementById('technicals-scanned-count');

            if (!pillsContainer || !tableBody) return;

            if (forceRefresh) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; padding: 30px; color: var(--text-secondary);">
                            <span class="spinning" style="display: inline-block; font-size: 20px; margin-bottom: 8px;">⏳</span><br>
                            Rescanning live technical signals...
                        </td>
                    </tr>
                `;
            }

            try {
                const response = await fetch('/api/insights/technicals');
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const data = await response.json();
                if (data.success && data.scanners) {
                    technicalsData = data;
                    if (scannedCountEl) scannedCountEl.textContent = `(Scanned ${data.total_scanned || 0} stocks)`;
                    renderTechnicalScreenerPills();
                    renderTechnicalScreenerTable();
                } else {
                    tableBody.innerHTML = `
                        <tr>
                            <td colspan="5" style="text-align: center; padding: 20px; color: var(--text-secondary);">
                                ⚠️ Unable to load technical signals. ${escapeHtml(data.error || '')} <button class="btn-secondary" style="font-size: 11px; padding: 3px 10px; margin-left: 8px;" onclick="loadTechnicalInsights(true)">Retry</button>
                            </td>
                        </tr>
                    `;
                }
            } catch (err) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; padding: 20px; color: #ef4444;">
                            ⚠️ Technical scanner is updating (${escapeHtml(err.message || 'Network error')}). <button class="btn-secondary" style="font-size: 11px; padding: 3px 10px; margin-left: 8px;" onclick="loadTechnicalInsights(true)">🔄 Retry Scan</button>
                        </td>
                    </tr>
                `;
            }
        }

        function selectTechnicalScreener(screenerId) {
            activeScreenerId = screenerId;
            renderTechnicalScreenerPills();
            renderTechnicalScreenerTable();
        }

        function renderTechnicalScreenerPills() {
            const container = document.getElementById('technical-screener-pills');
            if (!container || !technicalsData || !technicalsData.scanners) return;

            const keys = ['golden_cross', 'supertrend_buy', 'rsi_momentum', 'ema_bull_cross', 'high_52w', 'volume_surge', 'rsi_oversold', 'triple_confluence', 'death_cross'];
            let html = '';

            keys.forEach(key => {
                const scanner = technicalsData.scanners[key];
                if (!scanner) return;
                const isActive = key === activeScreenerId;
                const btnClass = isActive ? 'btn-primary' : 'btn-secondary';
                const activeStyle = isActive ? 'background: var(--accent-color); color: #fff; border-color: var(--accent-color);' : '';
                
                const scopedStocks = getScopedScannerStocks(scanner.stocks);
                const count = scopedStocks.length;

                html += `
                    <button type="button" class="${btnClass}" onclick="selectTechnicalScreener('${key}')" style="font-size: 11.5px; padding: 5px 12px; border-radius: 6px; display: flex; align-items: center; gap: 6px; ${activeStyle}">
                        ${scanner.title}
                        <span style="font-size: 10px; font-weight: 700; background: ${isActive ? 'rgba(255,255,255,0.25)' : 'var(--bg-card)'}; color: ${isActive ? '#fff' : 'var(--text-primary)'}; padding: 1px 6px; border-radius: 8px;">
                            ${count}
                        </span>
                    </button>
                `;
            });

            container.innerHTML = html;
        }

        function renderTechnicalScreenerTable() {
            const tableBody = document.getElementById('technical-screener-table-body');
            const titleEl = document.getElementById('screener-meta-title');
            const descEl = document.getElementById('screener-meta-desc');
            const countEl = document.getElementById('screener-meta-count');
            const scannedCountEl = document.getElementById('technicals-scanned-count');

            if (!tableBody || !technicalsData || !technicalsData.scanners) return;

            const scanner = technicalsData.scanners[activeScreenerId];
            if (!scanner) return;

            const stocks = getScopedScannerStocks(scanner.stocks);

            if (titleEl) titleEl.textContent = scanner.title;
            if (descEl) descEl.textContent = scanner.description;
            if (countEl) countEl.textContent = `${stocks.length} Stocks`;

            if (scannedCountEl) {
                const scopedSyms = getScopedSymbols();
                if (currentInsightsScope === 'portfolio') {
                    scannedCountEl.textContent = `(${scopedSyms ? scopedSyms.size : 0} portfolio stocks)`;
                } else if (currentInsightsScope === 'watchlist') {
                    const wlCount = (watchlistsData && currentInsightsWatchlist && watchlistsData[currentInsightsWatchlist]) ? watchlistsData[currentInsightsWatchlist].length : 0;
                    scannedCountEl.textContent = `(${wlCount} stocks in ${currentInsightsWatchlist || 'Watchlist'})`;
                } else {
                    scannedCountEl.textContent = `(Scanned ${technicalsData.total_scanned || 0} stocks)`;
                }
            }

            if (stocks.length === 0) {
                let emptyMsg = `🔍 No stocks currently meet the criteria for <strong>${escapeHtml(scanner.title)}</strong> in tracked symbols.`;
                if (currentInsightsScope === 'portfolio') {
                    emptyMsg = `🔍 No stocks in your <strong>portfolio</strong> currently meet the criteria for <strong>${escapeHtml(scanner.title)}</strong>.`;
                } else if (currentInsightsScope === 'watchlist') {
                    emptyMsg = `🔍 No stocks in watchlist "<strong>${escapeHtml(currentInsightsWatchlist || '')}</strong>" currently meet the criteria for <strong>${escapeHtml(scanner.title)}</strong>.`;
                }
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; padding: 35px; color: var(--text-secondary);">
                            ${emptyMsg}
                        </td>
                    </tr>
                `;
                return;
            }

            let rowsHtml = '';
            stocks.forEach(stock => {
                const displaySym = cleanDisplaySymbol(stock.symbol);
                const exchangeClass = stock.symbol.endsWith('.BO') ? 'badge-bse' : 'badge-nse';
                const exchangeLabel = stock.symbol.endsWith('.BO') ? 'BSE' : 'NSE';
                
                const isPos = stock.change_pct >= 0;
                const changeClass = isPos ? 'profit' : 'loss';
                const changeSign = isPos ? '+' : '';

                rowsHtml += `
                    <tr class="insights-screener-row" style="border-bottom: 1px solid var(--border-color); cursor: pointer;" title="Click data to view technical chart" onclick="openInsightsTechnical('${escapeHtml(stock.symbol)}');">
                        <td class="insights-stock-col" style="padding: 10px 12px; cursor: pointer;" title="Click stock name to view fundamentals" onclick="event.stopPropagation(); openInsightsFundamentals('${escapeHtml(stock.symbol)}');">
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <span class="stock-symbol" style="font-weight: 700; font-size: 13px;">${escapeHtml(displaySym)}</span>
                                <span class="badge ${exchangeClass}" style="font-size: 9.5px; padding: 1px 4px;">${exchangeLabel}</span>
                            </div>
                            <div class="insights-stock-name" style="font-size: 11px; color: var(--text-secondary); max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                ${escapeHtml(stock.name)}
                            </div>
                        </td>
                        <td class="insights-data-col" style="text-align: right; padding: 10px 12px; font-weight: 700; font-size: 13px; cursor: pointer;" title="Click data to view technical chart" onclick="event.stopPropagation(); openInsightsTechnical('${escapeHtml(stock.symbol)}');">
                            ₹${stock.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td class="insights-data-col ${changeClass}" style="text-align: right; padding: 10px 12px; font-weight: 700; font-size: 12.5px; cursor: pointer;" title="Click data to view technical chart" onclick="event.stopPropagation(); openInsightsTechnical('${escapeHtml(stock.symbol)}');">
                            ${changeSign}${stock.change_pct}%
                        </td>
                        <td class="insights-data-col" style="padding: 10px 12px; font-size: 12px; font-weight: 600; color: var(--text-primary); cursor: pointer;" title="Click data to view technical chart" onclick="event.stopPropagation(); openInsightsTechnical('${escapeHtml(stock.symbol)}');">
                            <span style="background: var(--bg-subtle); padding: 3px 8px; border-radius: 6px; border: 1px solid var(--border-color); display: inline-block;">
                                ${escapeHtml(stock.metric)}
                            </span>
                        </td>
                        <td style="text-align: center; padding: 10px 12px;" onclick="event.stopPropagation();">
                            <div style="display: flex; gap: 6px; justify-content: center;">
                                <button class="btn-secondary" style="font-size: 11px; padding: 3px 8px; border-radius: 4px;" onclick="event.stopPropagation(); openInsightsTechnical('${escapeHtml(stock.symbol)}')" title="View Technical Chart">
                                    📊 Chart
                                </button>
                                <button class="btn-secondary" style="font-size: 11px; padding: 3px 8px; border-radius: 4px;" onclick="event.stopPropagation(); openInsightsFundamentals('${escapeHtml(stock.symbol)}')" title="View Fundamentals">
                                    📈 Fundamentals
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            });

            tableBody.innerHTML = rowsHtml;
        }

        function updateHighlightsFromLivePrices() {
            if (!portfoliosData || !stockPricesData) return;

            let allActiveHoldings = [];
            let seenSymbols = new Set();
            let totalDayGain = 0;
            let hasAnyLiveData = false;

            Object.values(portfoliosData).forEach(holdings => {
                (holdings || []).forEach(h => {
                    const sym = h.symbol;
                    const qty = parseFloat(h.quantity || 0);
                    if (sym && qty > 0) {
                        const info = stockPricesData[sym];
                        if (info && info.price !== undefined && !info.error) {
                            hasAnyLiveData = true;
                            const ltp = info.price;
                            const changeAmt = info.change !== undefined ? info.change : 0;
                            const changePct = info.change_pct !== undefined ? info.change_pct : 0;

                            totalDayGain += (changeAmt * qty);

                            if (!seenSymbols.has(sym)) {
                                seenSymbols.add(sym);
                                allActiveHoldings.push({
                                    symbol: sym,
                                    name: info.name || sym,
                                    ltp: ltp,
                                    change_amt: changeAmt,
                                    change_pct: changePct,
                                    qty: qty
                                });
                            }
                        }
                    }
                });
            });

            const gainerSymEl = document.getElementById('insights-top-gainer-sym');
            const gainerValEl = document.getElementById('insights-top-gainer-val');
            const loserLabelEl = document.getElementById('insights-top-loser-label');
            const loserSymEl = document.getElementById('insights-top-loser-sym');
            const loserValEl = document.getElementById('insights-top-loser-val');
            const dayGainEl = document.getElementById('insights-day-gain-val');

            if (!hasAnyLiveData) return;

            if (allActiveHoldings.length === 0) {
                if (gainerSymEl) { gainerSymEl.innerText = 'N/A'; gainerSymEl.style.color = 'var(--text-secondary)'; if (gainerValEl) { gainerValEl.innerText = '-'; gainerValEl.style.color = 'var(--text-secondary)'; } }
                if (loserSymEl) { loserSymEl.innerText = 'N/A'; loserSymEl.style.color = 'var(--text-secondary)'; if (loserValEl) { loserValEl.innerText = '-'; loserValEl.style.color = 'var(--text-secondary)'; } }
                if (dayGainEl) { dayGainEl.innerText = '₹0.00'; dayGainEl.style.color = '#10b981'; }
                return;
            }

            allActiveHoldings.sort((a, b) => b.change_pct - a.change_pct);

            const topGainer = allActiveHoldings[0];
            const topLoser = allActiveHoldings.length > 1 ? allActiveHoldings[allActiveHoldings.length - 1] : null;

            if (gainerSymEl && topGainer) {
                gainerSymEl.innerText = topGainer.symbol;
                const sign = topGainer.change_pct >= 0 ? '+' : '';
                gainerValEl.innerText = `${sign}${topGainer.change_pct.toFixed(2)}% (₹${topGainer.ltp.toLocaleString('en-IN', {minimumFractionDigits: 2})})`;
                const color = topGainer.change_pct >= 0 ? '#10b981' : '#ef4444';
                gainerSymEl.style.color = color;
                gainerValEl.style.color = color;
            }

            if (loserSymEl && topLoser) {
                loserSymEl.innerText = topLoser.symbol;
                const sign = topLoser.change_pct >= 0 ? '+' : '';
                loserValEl.innerText = `${sign}${topLoser.change_pct.toFixed(2)}% (₹${topLoser.ltp.toLocaleString('en-IN', {minimumFractionDigits: 2})})`;
                const color = topLoser.change_pct >= 0 ? '#10b981' : '#ef4444';
                loserSymEl.style.color = color;
                loserValEl.style.color = color;

                if (loserLabelEl) {
                    loserLabelEl.innerText = topLoser.change_pct < 0 ? 'Largest Lag' : 'Lowest Gain';
                }
            } else if (loserSymEl) {
                loserSymEl.innerText = 'N/A';
                loserSymEl.style.color = 'var(--text-secondary)';
                if (loserValEl) { loserValEl.innerText = '-'; loserValEl.style.color = 'var(--text-secondary)'; }
                if (loserLabelEl) loserLabelEl.innerText = 'Largest Lag';
            }

            if (dayGainEl) {
                const sign = totalDayGain >= 0 ? '+' : '';
                dayGainEl.innerText = isPrivacyMode ? `₹ ••••••` : `${sign}₹${Math.abs(totalDayGain).toLocaleString('en-IN', {minimumFractionDigits: 2})}`;
                dayGainEl.style.color = totalDayGain >= 0 ? '#10b981' : '#ef4444';
            }
        }

        function renderInsightsSummaryUI(data) {
            updateHighlightsFromLivePrices();
            const m = data.metrics || {};
            const gainer = m.top_gainer;
            const loser = m.top_loser;

            const gainerSymEl = document.getElementById('insights-top-gainer-sym');
            const gainerValEl = document.getElementById('insights-top-gainer-val');
            if (gainerSymEl && gainer) {
                gainerSymEl.innerText = gainer.symbol;
                const sign = gainer.change_pct >= 0 ? '+' : '';
                gainerValEl.innerText = `${sign}${gainer.change_pct.toFixed(2)}% (₹${gainer.ltp.toLocaleString('en-IN', {minimumFractionDigits: 2})})`;
                const color = gainer.change_pct >= 0 ? '#10b981' : '#ef4444';
                gainerSymEl.style.color = color;
                gainerValEl.style.color = color;
            } else if (gainerSymEl) {
                gainerSymEl.innerText = 'N/A';
                gainerSymEl.style.color = 'var(--text-secondary)';
                gainerValEl.innerText = '-';
                gainerValEl.style.color = 'var(--text-secondary)';
            }

            const loserLabelEl = document.getElementById('insights-top-loser-label');
            const loserSymEl = document.getElementById('insights-top-loser-sym');
            const loserValEl = document.getElementById('insights-top-loser-val');
            if (loserSymEl && loser) {
                loserSymEl.innerText = loser.symbol;
                const sign = loser.change_pct >= 0 ? '+' : '';
                loserValEl.innerText = `${sign}${loser.change_pct.toFixed(2)}% (₹${loser.ltp.toLocaleString('en-IN', {minimumFractionDigits: 2})})`;
                const color = loser.change_pct >= 0 ? '#10b981' : '#ef4444';
                loserSymEl.style.color = color;
                loserValEl.style.color = color;
                if (loserLabelEl) {
                    loserLabelEl.innerText = loser.change_pct < 0 ? 'Largest Lag' : 'Lowest Gain';
                }
            } else if (loserSymEl) {
                loserSymEl.innerText = 'N/A';
                loserSymEl.style.color = 'var(--text-secondary)';
                loserValEl.innerText = '-';
                loserValEl.style.color = 'var(--text-secondary)';
                if (loserLabelEl) loserLabelEl.innerText = 'Largest Lag';
            }

            const dayGainEl = document.getElementById('insights-day-gain-val');
            if (dayGainEl) {
                const dg = m.day_pnl_amt || 0;
                const sign = dg >= 0 ? '+' : '';
                dayGainEl.innerText = isPrivacyMode ? `₹ ••••••` : `${sign}₹${Math.abs(dg).toLocaleString('en-IN', {minimumFractionDigits:2})}`;
                dayGainEl.style.color = dg >= 0 ? '#10b981' : '#ef4444';
            }

            const distMount = document.getElementById('insights-distribution-mount');
            if (distMount && data.distribution) {
                const dist = data.distribution;
                distMount.innerHTML = `
                    <div>
                        <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">
                            <span>📈 Equities (${dist.equities.count})</span>
                            <span>${dist.equities.pct}%</span>
                        </div>
                        <div style="width: 100%; background: var(--bg-subtle); height: 8px; border-radius: 4px; overflow: hidden;">
                            <div style="width: ${dist.equities.pct}%; background: #10b981; height: 100%;"></div>
                        </div>
                    </div>
                    <div>
                        <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">
                            <span>📊 Market Indices (${dist.indices.count})</span>
                            <span>${dist.indices.pct}%</span>
                        </div>
                        <div style="width: 100%; background: var(--bg-subtle); height: 8px; border-radius: 4px; overflow: hidden;">
                            <div style="width: ${dist.indices.pct}%; background: #06b6d4; height: 100%;"></div>
                        </div>
                    </div>
                    <div>
                        <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">
                            <span>🟡 Commodities & Gold (${dist.commodities.count})</span>
                            <span>${dist.commodities.pct}%</span>
                        </div>
                        <div style="width: 100%; background: var(--bg-subtle); height: 8px; border-radius: 4px; overflow: hidden;">
                            <div style="width: ${dist.commodities.pct}%; background: #f59e0b; height: 100%;"></div>
                        </div>
                    </div>
                `;
            }

            const thesisMount = document.getElementById('insights-thesis-mount');
            const thesisCountEl = document.getElementById('insights-thesis-count');
            const theses = data.theses || [];
            if (thesisCountEl) thesisCountEl.innerText = `${theses.length} Active Notes`;

            if (thesisMount) {
                if (theses.length === 0) {
                    thesisMount.innerHTML = `<div style="font-size: 12px; color: var(--text-secondary); text-align: center; padding: 15px;">No buy reasons added yet. Edit a holding to record your investment thesis!</div>`;
                } else {
                    thesisMount.innerHTML = '';
                    theses.forEach(t => {
                        const item = document.createElement('div');
                        item.className = 'insights-thesis-item';
                        item.style.cssText = `
                            background: var(--bg-subtle);
                            border: 1px solid var(--border-color);
                            border-radius: 8px;
                            padding: 10px 12px;
                            font-size: 12px;
                            cursor: pointer;
                            transition: background-color 0.15s ease, border-color 0.15s ease;
                        `;
                        item.title = 'Click data to view technical chart';
                        item.onclick = (e) => {
                            if (e.target.closest('.insights-thesis-stock-trigger')) {
                                e.stopPropagation();
                                openInsightsFundamentals(t.symbol);
                            } else {
                                openInsightsTechnical(t.symbol);
                            }
                        };
                        const pnlSign = t.pnl_pct >= 0 ? '+' : '';
                        const pnlColor = t.pnl_pct >= 0 ? '#10b981' : '#ef4444';

                        item.innerHTML = `
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                <strong class="insights-thesis-stock-trigger" style="color: var(--text-primary); font-size: 13px; cursor: pointer;" title="Click stock name to view fundamentals" onclick="event.stopPropagation(); openInsightsFundamentals('${escapeHtml(t.symbol)}');">${escapeHtml(t.symbol)}</strong>
                                <span style="color: ${pnlColor}; font-weight: 700;" title="Click data to view technical chart">${pnlSign}${t.pnl_pct}% Return</span>
                            </div>
                            <div style="color: var(--text-secondary); font-style: italic; font-size: 11px;" title="Click data to view technical chart">"${escapeHtml(t.buy_reason)}"</div>
                        `;
                        thesisMount.appendChild(item);
                    });
                }
            }
        }

        function renderInsightsIndexesUI(marketIndexes) {
            const idxGrid = document.getElementById('insights-indexes-grid');
            if (!idxGrid) return;
            idxGrid.innerHTML = '';
            if (marketIndexes.length === 0) {
                idxGrid.innerHTML = '<span style="font-size:12px; color:var(--text-secondary);">No indexes available</span>';
                return;
            }
            marketIndexes.forEach(idx => {
                const isPos = idx.change >= 0;
                const sign = isPos ? '+' : '';
                const colorClass = isPos ? '#10b981' : '#ef4444';
                const curr = idx.currency || '₹';
                const isCommodity = idx.type === 'COMMODITY' || idx.badge?.includes('Gold') || idx.badge?.includes('Silver');
                const badgeLabel = isCommodity ? 'CFD TVC' : (idx.symbol === 'GIFTNIFTY' ? 'GIFT IX' : 'INDEX');
                const badgeStyle = isCommodity 
                    ? 'background: rgba(245, 158, 11, 0.16); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.35);'
                    : (idx.symbol === 'GIFTNIFTY' 
                        ? 'background: rgba(16, 185, 129, 0.16); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35);'
                        : 'background: rgba(92, 124, 250, 0.15); color: #5c7cfa; border: 1px solid rgba(92, 124, 250, 0.3);');

                const card = document.createElement('div');
                card.style.cssText = `
                    background: var(--bg-subtle);
                    border: 1px solid var(--border-color);
                    border-radius: 8px;
                    padding: 10px 12px;
                    display: flex;
                    flex-direction: column;
                    justify-content: space-between;
                    cursor: pointer;
                    transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
                `;
                card.onmouseenter = () => {
                    card.style.transform = 'translateY(-1.5px)';
                    card.style.borderColor = isCommodity ? 'rgba(245, 158, 11, 0.45)' : 'rgba(92, 124, 250, 0.45)';
                };
                card.onmouseleave = () => {
                    card.style.transform = 'none';
                    card.style.borderColor = 'var(--border-color)';
                };
                card.onclick = () => openInHouseChart(idx.symbol);
                card.title = `Click to view technical chart for ${idx.name}`;

                const formattedPrice = curr === '$'
                    ? (idx.price ? idx.price.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-')
                    : (idx.price ? idx.price.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-');

                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span style="font-weight: 700; font-size: 12px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 90px;">${escapeHtml(idx.badge || idx.name)}</span>
                        <span class="badge" style="font-size: 8px; padding: 1px 4.5px; border-radius: 4px; font-weight: 700; ${badgeStyle}">${escapeHtml(badgeLabel)}</span>
                    </div>
                    <div style="font-weight: 800; font-size: 14px; color: var(--text-primary); font-family: var(--font-family, sans-serif);">${curr}${formattedPrice}</div>
                    <div style="font-size: 11px; font-weight: 600; color: ${colorClass}; margin-top: 2px;">
                        ${sign}${idx.change_pct}% (${sign}${curr}${Math.abs(idx.change).toFixed(2)})
                    </div>
                `;
                idxGrid.appendChild(card);
            });
        }

        function renderInsightsFiiDiiUI(fd) {
            const fiiMount = document.getElementById('insights-fiidii-mount');
            const fiiDateTag = document.getElementById('fiidii-date-tag');
            if (!fiiMount || !fd) return;

            if (fiiDateTag && fd.date) fiiDateTag.innerText = window.formatAppDate ? window.formatAppDate(fd.date) : fd.date;

            const fiiPos = fd.fii_net >= 0;
            const diiPos = fd.dii_net >= 0;
            const totPos = fd.total_net >= 0;

            const fiiSign = fiiPos ? '+' : '-';
            const diiSign = diiPos ? '+' : '-';
            const totSign = totPos ? '+' : '-';

            fiiMount.innerHTML = `
                <div style="background: var(--bg-subtle); padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span style="font-size: 11px; font-weight: 700; color: var(--text-secondary);">FII Flow</span>
                        <span style="font-size: 9.5px; padding: 1px 6px; border-radius: 4px; font-weight: 700; margin-left: 6px; ${fiiPos ? 'background: rgba(16,185,129,0.15); color: #10b981;' : 'background: rgba(239,68,68,0.15); color: #ef4444;'}">${fd.fii_action || (fiiPos ? 'BUY' : 'SELL')}</span>
                    </div>
                    <span style="font-size: 13px; font-weight: 700; color: ${fiiPos ? '#10b981' : '#ef4444'};">${fiiSign}₹${Math.abs(fd.fii_net).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})} Cr</span>
                </div>
                <div style="background: var(--bg-subtle); padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span style="font-size: 11px; font-weight: 700; color: var(--text-secondary);">DII Flow</span>
                        <span style="font-size: 9.5px; padding: 1px 6px; border-radius: 4px; font-weight: 700; margin-left: 6px; ${diiPos ? 'background: rgba(16,185,129,0.15); color: #10b981;' : 'background: rgba(239,68,68,0.15); color: #ef4444;'}">${fd.dii_action || (diiPos ? 'BUY' : 'SELL')}</span>
                    </div>
                    <span style="font-size: 13px; font-weight: 700; color: ${diiPos ? '#10b981' : '#ef4444'};">${diiSign}₹${Math.abs(fd.dii_net).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})} Cr</span>
                </div>
                <div style="background: ${totPos ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'}; border: 1px solid ${totPos ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}; padding: 8px 10px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 11.5px; color: var(--text-primary); font-weight: 700;">Net Institutional:</span>
                    <span style="font-size: 13px; font-weight: 800; color: ${totPos ? '#10b981' : '#ef4444'};">${totSign}₹${Math.abs(fd.total_net).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})} Cr</span>
                </div>
            `;
        }

        // =========================================================
        // LIVE BULLION (GOLD & SILVER) RATES JS
        // =========================================================
        let cachedBullionData = null;
        let activeBullionFilter = 'all';

        function loadInsightsBullion(forceRefresh = false) {
            const refreshBtn = document.getElementById('bullion-refresh-btn');
            if (refreshBtn && forceRefresh) refreshBtn.classList.add('spinning');

            fetch(`/api/insights/bullion${forceRefresh ? '?refresh=1' : ''}`)
                .then(res => res.json())
                .then(data => {
                    if (data.success && data.bullion) {
                        cachedBullionData = data.bullion;
                        renderInsightsBullionUI(data.bullion);
                    }
                })
                .catch(err => {
                    console.error('Error fetching bullion rates:', err);
                })
                .finally(() => {
                    if (refreshBtn) refreshBtn.classList.remove('spinning');
                });
        }

        function filterBullionCards(metal) {
            activeBullionFilter = metal;
            document.querySelectorAll('.bullion-pill').forEach(btn => {
                btn.classList.toggle('active', btn.id === `bullion-pill-${metal}`);
            });
            if (cachedBullionData) {
                renderInsightsBullionUI(cachedBullionData);
            }
        }

        function renderInsightsBullionUI(data) {
            const mount = document.getElementById('insights-bullion-mount');
            const dateBadge = document.getElementById('bullion-date-badge');
            const updateTime = document.getElementById('bullion-update-time');
            if (!mount || !data) return;

            if (dateBadge && data.date) dateBadge.innerText = data.date;
            if (updateTime && data.update_time) updateTime.innerText = `⏱️ Updated: ${data.update_time}`;

            const f24k_1g = data.gold_24k_1g ? '₹' + data.gold_24k_1g.toLocaleString('en-IN') : '₹14,744';
            const f24k_8g = data.gold_24k_8g ? '₹' + data.gold_24k_8g.toLocaleString('en-IN') : '₹1,17,952';
            const f22k_1g = data.gold_22k_1g ? '₹' + data.gold_22k_1g.toLocaleString('en-IN') : '₹13,515';
            const f22k_8g = data.gold_22k_8g ? '₹' + data.gold_22k_8g.toLocaleString('en-IN') : '₹1,08,120';
            const fsilver_1g = data.silver_1g ? '₹' + data.silver_1g.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '₹240.00';
            const fsilver_8g = data.silver_8g ? '₹' + data.silver_8g.toLocaleString('en-IN') : '₹1,920';
            const fsilver_1kg = data.silver_1kg ? '₹' + data.silver_1kg.toLocaleString('en-IN') : '₹2,40,000';

            const show24k = activeBullionFilter === 'all' || activeBullionFilter === '24k';
            const show22k = activeBullionFilter === 'all' || activeBullionFilter === '22k';
            const showSilver = activeBullionFilter === 'all' || activeBullionFilter === 'silver';

            let html = '';

            // 1. Pure Gold 24K Card
            if (show24k) {
                html += `
                    <div class="bullion-metal-card bullion-card-24k" title="24 Karat Pure Fine Gold (99.9% Purity)">
                        <div class="bullion-metal-header">
                            <span class="bullion-metal-title">
                                <span>🥇</span> Pure Gold (24 Karat)
                            </span>
                            <span class="bullion-purity-tag bullion-purity-24k">99.9% PURE</span>
                        </div>
                        <div class="bullion-tiles-row">
                            <div class="bullion-tile">
                                <span class="bullion-tile-label">1 Gram</span>
                                <span class="bullion-tile-value bullion-val-gold">${f24k_1g}</span>
                                <span class="bullion-tile-sub">Daily Benchmark</span>
                            </div>
                            <div class="bullion-tile">
                                <span class="bullion-tile-label">8 Gm (1 Sovereign)</span>
                                <span class="bullion-tile-value bullion-val-gold">${f24k_8g}</span>
                                <span class="bullion-tile-sub">1 Pavan / Coin</span>
                            </div>
                        </div>
                    </div>
                `;
            }

            // 2. Standard Gold 22K Card
            if (show22k) {
                html += `
                    <div class="bullion-metal-card bullion-card-22k" title="22 Karat Standard Jewellery Gold (916 Hallmark)">
                        <div class="bullion-metal-header">
                            <span class="bullion-metal-title">
                                <span>👑</span> Standard Gold (22 Karat)
                            </span>
                            <span class="bullion-purity-tag bullion-purity-22k">916 HALLMARK</span>
                        </div>
                        <div class="bullion-tiles-row">
                            <div class="bullion-tile">
                                <span class="bullion-tile-label">1 Gram</span>
                                <span class="bullion-tile-value bullion-val-22k">${f22k_1g}</span>
                                <span class="bullion-tile-sub">Jewellery Rate</span>
                            </div>
                            <div class="bullion-tile">
                                <span class="bullion-tile-label">8 Gm (1 Sovereign)</span>
                                <span class="bullion-tile-value bullion-val-22k">${f22k_8g}</span>
                                <span class="bullion-tile-sub">1 Pavan / Sovereign</span>
                            </div>
                        </div>
                    </div>
                `;
            }

            // 3. Ready Silver Card
            if (showSilver) {
                html += `
                    <div class="bullion-metal-card bullion-card-silver" title="Ready Silver Rate (99.9% Fine Silver)">
                        <div class="bullion-metal-header">
                            <span class="bullion-metal-title">
                                <span>🥈</span> Ready Silver
                            </span>
                            <span class="bullion-purity-tag bullion-purity-silver">99.9% FINE</span>
                        </div>
                        <div class="bullion-tiles-row">
                            <div class="bullion-tile">
                                <span class="bullion-tile-label">1 Gram</span>
                                <span class="bullion-tile-value bullion-val-silver">${fsilver_1g}</span>
                                <span class="bullion-tile-sub">Retail Rate</span>
                            </div>
                            <div class="bullion-tile">
                                <span class="bullion-tile-label">8 Grams</span>
                                <span class="bullion-tile-value bullion-val-silver">${fsilver_8g}</span>
                                <span class="bullion-tile-sub">Coin Rate</span>
                            </div>
                        </div>
                        <div class="bullion-tile bullion-tile-full">
                            <div style="display: flex; flex-direction: column; min-width: 0;">
                                <span class="bullion-tile-label">1 Kg (Ready Silver)</span>
                                <span class="bullion-tile-sub">Wholesale Bar Benchmark</span>
                            </div>
                            <span class="bullion-tile-value bullion-val-silver" style="font-size: 14.5px; flex-shrink: 0;">${fsilver_1kg}</span>
                        </div>
                    </div>
                `;
            }

            mount.innerHTML = html;
        }

        function isPortfolioSymbol(sym) {
            if (!sym || sym === 'MARKET' || sym === 'GENERAL') return false;
            const clean = sym.replace('.NS', '').replace('.BO', '');
            for (const holdings of Object.values(portfoliosData || {})) {
                if (holdings.some(h => h.symbol === sym || h.symbol?.replace('.NS', '').replace('.BO', '') === clean)) return true;
            }
            return false;
        }

        function isWatchlistSymbol(sym, specificWl = null) {
            if (!sym || sym === 'MARKET' || sym === 'GENERAL') return false;
            const clean = sym.replace('.NS', '').replace('.BO', '');
            if (specificWl && watchlistsData && watchlistsData[specificWl]) {
                return watchlistsData[specificWl].some(s => s === sym || s?.replace('.NS', '').replace('.BO', '') === clean);
            }
            for (const list of Object.values(watchlistsData || {})) {
                if (list.some(s => s === sym || s?.replace('.NS', '').replace('.BO', '') === clean)) return true;
            }
            return false;
        }

        function populateInsightsStockFilterOptions() {
            const selectEl = document.getElementById('insights-stock-filter');
            if (!selectEl) return;

            const selectedVal = selectEl.value || 'all';
            const symbols = new Set();

            if (currentInsightsScope === 'portfolio') {
                for (const holdings of Object.values(portfoliosData || {})) {
                    holdings.forEach(h => {
                        if (h.symbol) symbols.add(h.symbol);
                    });
                }
                (cachedInsightsArticles || []).forEach(art => {
                    if (art.symbol && isPortfolioSymbol(art.symbol)) {
                        symbols.add(art.symbol);
                    }
                });
            } else if (currentInsightsScope === 'watchlist') {
                if (currentInsightsWatchlist && watchlistsData && watchlistsData[currentInsightsWatchlist]) {
                    watchlistsData[currentInsightsWatchlist].forEach(s => {
                        if (s) symbols.add(s);
                    });
                }
                (cachedInsightsArticles || []).forEach(art => {
                    if (art.symbol && isWatchlistSymbol(art.symbol, currentInsightsWatchlist)) {
                        symbols.add(art.symbol);
                    }
                });
            } else {
                for (const wlSymbols of Object.values(watchlistsData || {})) {
                    wlSymbols.forEach(s => { if (s) symbols.add(s); });
                }
                for (const holdings of Object.values(portfoliosData || {})) {
                    holdings.forEach(h => { if (h.symbol) symbols.add(h.symbol); });
                }
                (cachedInsightsArticles || []).forEach(art => {
                    if (art.symbol && art.symbol !== 'MARKET' && art.symbol !== 'GENERAL') {
                        symbols.add(art.symbol);
                    }
                });
            }

            const sortedSymbols = Array.from(symbols).sort();

            selectEl.innerHTML = '<option value="all">All Stocks</option>';
            let foundSelected = false;
            sortedSymbols.forEach(sym => {
                const opt = document.createElement('option');
                opt.value = sym;
                opt.innerText = typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(sym) : sym;
                if (sym === selectedVal) {
                    opt.selected = true;
                    foundSelected = true;
                }
                selectEl.appendChild(opt);
            });

            if (!foundSelected) {
                selectEl.value = 'all';
            }
        }

        function filterAndRenderInsightsNews() {
            const feedEl = document.getElementById('insights-news-feed');
            const countEl = document.getElementById('insights-news-count');
            const stockFilter = document.getElementById('insights-stock-filter')?.value || 'all';
            const dateSort = document.getElementById('insights-date-sort')?.value || 'date_desc';

            if (!feedEl) return;

            let articles = cachedInsightsArticles.slice();

            // If specific stock is selected, filter by that stock; otherwise filter by active scope
            if (stockFilter !== 'all') {
                const cleanSelected = stockFilter.replace('.NS', '').replace('.BO', '');
                articles = articles.filter(art => art.symbol === stockFilter || art.symbol?.replace('.NS', '').replace('.BO', '') === cleanSelected);
            } else {
                // Scope Strict Filtering for general feeds
                if (currentInsightsScope === 'portfolio') {
                    articles = articles.filter(art => art.tag_type === 'PORTFOLIO' || isPortfolioSymbol(art.symbol));
                } else if (currentInsightsScope === 'watchlist') {
                    if (currentInsightsWatchlist) {
                        articles = articles.filter(art => isWatchlistSymbol(art.symbol, currentInsightsWatchlist));
                    } else {
                        articles = articles.filter(art => art.tag_type === 'WATCHLIST' || isWatchlistSymbol(art.symbol));
                    }
                }
            }

            articles.sort((a, b) => {
                const timeA = a.pub_date ? new Date(a.pub_date).getTime() : 0;
                const timeB = b.pub_date ? new Date(b.pub_date).getTime() : 0;
                if (dateSort === 'date_asc') {
                    return timeA - timeB;
                } else {
                    return timeB - timeA;
                }
            });

            if (countEl) {
                const scopeName = currentInsightsScope === 'portfolio' ? 'Portfolio' : (currentInsightsScope === 'watchlist' ? `Watchlist: ${currentInsightsWatchlist || 'Selected'}` : 'All Market');
                const catLabel = currentNewsCategory !== 'all' ? ` • ${currentNewsCategory.toUpperCase()}` : '';
                const filterLabel = stockFilter !== 'all' ? ` (${stockFilter}${catLabel})` : ` (${scopeName}${catLabel})`;
                countEl.innerText = `${articles.length} stories found${filterLabel}`;
            }

            if (articles.length === 0) {
                const scopeTitle = currentInsightsScope === 'portfolio' ? 'your portfolio holdings' : (currentInsightsScope === 'watchlist' ? `watchlist "${currentInsightsWatchlist || 'Selected'}"` : 'the market');
                const emptyMsg = stockFilter !== 'all' 
                    ? `No news articles found matching stock ${escapeHtml(stockFilter)} (${currentNewsCategory.toUpperCase()}).`
                    : `No news articles found for ${scopeTitle} (${currentNewsCategory.toUpperCase()}).`;
                feedEl.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: var(--text-secondary); background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-color);">
                        📰 ${emptyMsg}
                    </div>
                `;
                return;
            }

            feedEl.innerHTML = '';
            articles.forEach(art => {
                const card = document.createElement('div');
                card.style.cssText = `
                    background: var(--bg-card);
                    border: 1px solid var(--border-color);
                    border-radius: 12px;
                    padding: 16px;
                    box-shadow: var(--shadow-sm);
                    transition: transform 0.15s ease, border-color 0.15s ease;
                `;
                
                let timeStr = art.pub_date || '';
                if (art.pub_date) {
                    timeStr = window.formatAppDateTime ? window.formatAppDateTime(art.pub_date) : art.pub_date;
                }

                const tagBadgeClass = art.tag_type === 'PORTFOLIO' ? 'badge-nse' : (art.tag_type === 'WATCHLIST' ? 'badge-bse' : 'badge-idx');

                let catBadge = '';
                if (art.category === 'RESEARCH') {
                    catBadge = '<span class="badge" style="background: rgba(168,85,247,0.15); color: #a855f7; border: 1px solid rgba(168,85,247,0.3); font-size: 10px;">📊 RESEARCH</span>';
                } else if (art.category === 'EARNINGS') {
                    catBadge = '<span class="badge" style="background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3); font-size: 10px;">📢 EARNINGS</span>';
                } else if (art.category === 'MACRO') {
                    catBadge = '<span class="badge" style="background: rgba(6,182,212,0.15); color: #06b6d4; border: 1px solid rgba(6,182,212,0.3); font-size: 10px;">💡 MACRO</span>';
                }

                card.style.cursor = 'pointer';
                card.onclick = (e) => {
                    if (!e.target.closest('a')) {
                        window.open(art.link, '_blank', 'noopener,noreferrer');
                    }
                };

                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <span class="stock-symbol insights-news-stock-trigger" style="font-size: 12.5px; cursor: pointer;" title="Click stock name to view fundamentals" onclick="event.stopPropagation(); openInsightsFundamentals('${escapeHtml(art.symbol)}');">${escapeHtml(cleanDisplaySymbol(art.symbol))}</span>
                            <span class="badge ${tagBadgeClass}" style="font-size: 10px;">${art.tag_type}</span>
                            ${catBadge}
                            <button type="button" class="btn-secondary" style="font-size: 9.5px; padding: 1px 6px; border-radius: 4px; line-height: 1.2; display: inline-flex; align-items: center; gap: 3px;" title="Click to view technical chart" onclick="event.stopPropagation(); openInsightsTechnical('${escapeHtml(art.symbol)}');">📊 Chart</button>
                        </div>
                        <span style="font-size: 11px; color: var(--text-secondary);">🕒 ${timeStr}</span>
                    </div>
                    <a href="${art.link}" target="_blank" rel="noopener noreferrer" style="font-weight: 600; font-size: 14px; color: var(--text-primary); text-decoration: none; line-height: 1.4; display: block; margin-bottom: 8px;" onmouseover="this.style.color='#10b981'" onmouseout="this.style.color='var(--text-primary)'">
                        ${escapeHtml(art.title)} ↗
                    </a>
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-secondary); border-top: 1px solid var(--border-color); padding-top: 8px; margin-top: 6px;">
                        <span>🏢 ${escapeHtml(art.publisher)}</span>
                        <a href="${art.link}" target="_blank" rel="noopener noreferrer" style="color: #10b981; font-weight: 600; text-decoration: none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">Read full story →</a>
                    </div>
                `;
                feedEl.appendChild(card);
            });
        }

        async function handleInsightsStockFilterChange() {
            const stockFilter = document.getElementById('insights-stock-filter')?.value || 'all';
            const feedEl = document.getElementById('insights-news-feed');
            const loadMoreContainer = document.getElementById('insights-load-more-container');
            const wlParam = currentInsightsScope === 'watchlist' && currentInsightsWatchlist ? `&watchlist=${encodeURIComponent(currentInsightsWatchlist)}` : '';

            if (stockFilter !== 'all') {
                if (feedEl) {
                    feedEl.innerHTML = `
                        <div style="text-align: center; padding: 30px; color: var(--text-secondary); background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-color);">
                            <span class="spinning" style="display: inline-block; font-size: 20px; margin-bottom: 8px;">⏳</span><br>
                            Fetching dedicated live news stories for <strong>${escapeHtml(stockFilter)}</strong>...
                        </div>
                    `;
                }
                try {
                    const res = await fetch(`/api/insights/news?scope=${encodeURIComponent(currentInsightsScope)}${wlParam}&stock=${encodeURIComponent(stockFilter)}&category=${encodeURIComponent(currentNewsCategory)}&limit=50`);
                    const data = await res.json();
                    if (data.success && data.articles) {
                        cachedInsightsArticles = data.articles;
                        filterAndRenderInsightsNews();
                    } else {
                        filterAndRenderInsightsNews();
                    }
                } catch(e) {
                    filterAndRenderInsightsNews();
                }
            } else {
                try {
                    const res = await fetch(`/api/insights/news?scope=${encodeURIComponent(currentInsightsScope)}${wlParam}&category=${encodeURIComponent(currentNewsCategory)}&limit=30`);
                    const data = await res.json();
                    if (data.success && data.articles) {
                        cachedInsightsArticles = data.articles;
                        filterAndRenderInsightsNews();
                    }
                } catch(e) {
                    filterAndRenderInsightsNews();
                }
            }

            if (loadMoreContainer) {
                loadMoreContainer.style.display = 'block';
            }
        }

        async function loadMoreInsightsNews() {
            const btn = document.getElementById('btn-load-more-news');
            const stockFilter = document.getElementById('insights-stock-filter')?.value || 'all';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '⏳ Fetching More Stories...';
            }

            try {
                const stockParam = stockFilter !== 'all' ? `&stock=${encodeURIComponent(stockFilter)}` : '';
                const wlParam = currentInsightsScope === 'watchlist' && currentInsightsWatchlist ? `&watchlist=${encodeURIComponent(currentInsightsWatchlist)}` : '';
                const res = await fetch(`/api/insights/news?scope=${encodeURIComponent(currentInsightsScope)}${wlParam}${stockParam}&category=${encodeURIComponent(currentNewsCategory)}&limit=100`);
                const data = await res.json();
                if (data.success && data.articles) {
                    const existingTitles = new Set(cachedInsightsArticles.map(a => a.title));
                    let addedCount = 0;
                    data.articles.forEach(art => {
                        if (!existingTitles.has(art.title)) {
                            cachedInsightsArticles.push(art);
                            existingTitles.add(art.title);
                            addedCount++;
                        }
                    });
                    populateInsightsStockFilterOptions();
                    filterAndRenderInsightsNews();

                    if (btn) {
                        if (addedCount > 0) {
                            btn.innerHTML = `✅ Added ${addedCount} More Stories (Total: ${cachedInsightsArticles.length})`;
                            setTimeout(() => {
                                btn.disabled = false;
                                btn.innerHTML = '📥 Load More News Stories';
                            }, 2500);
                        } else {
                            btn.innerHTML = '✨ All Latest News Loaded';
                            setTimeout(() => {
                                btn.disabled = false;
                                btn.innerHTML = '📥 Load More News Stories';
                            }, 2500);
                        }
                    }
                }
            } catch(e) {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '⚠️ Failed to Load - Try Again';
                }
            }
        }
