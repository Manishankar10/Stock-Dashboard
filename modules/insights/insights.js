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

        function syncInsightsBullionSlot() {
            const card = document.getElementById('insights-bullion-card');
            const mobileSlot = document.getElementById('mobile-bullion-slot');
            const desktopSlot = document.getElementById('desktop-bullion-slot');
            if (!card || !mobileSlot || !desktopSlot) return;

            const isMobile = window.innerWidth <= 768;
            if (isMobile) {
                if (card.parentElement !== mobileSlot) {
                    mobileSlot.appendChild(card);
                }
            } else {
                if (card.parentElement !== desktopSlot) {
                    desktopSlot.appendChild(card);
                }
            }
        }

        window.openInsightsFundamentals = openInsightsFundamentals;
        window.openInsightsTechnical = openInsightsTechnical;
        window.loadInsightsBullion = loadInsightsBullion;
        window.loadMarketMoodIndex = loadMarketMoodIndex;
        window.toggleMmiView = toggleMmiView;
        window.filterBullionCards = filterBullionCards;
        window.renderInsightsBullionUI = renderInsightsBullionUI;
        window.syncInsightsBullionSlot = syncInsightsBullionSlot;
        window.showInsightsSkeletons = showInsightsSkeletons;
        window.showTechnicalSkeletons = showTechnicalSkeletons;
        window.showNewsSkeletonsOnly = showNewsSkeletonsOnly;
        window.loadInsightsTab = loadInsightsTab;
        window.loadTechnicalInsights = loadTechnicalInsights;
        window.selectTechnicalScreener = selectTechnicalScreener;

        function updateCategoryPillsNavBtns() {
            const pills = document.getElementById('insights-category-pills');
            const prevBtn = document.getElementById('insights-pills-prev');
            const nextBtn = document.getElementById('insights-pills-next');
            if (!pills || !prevBtn || !nextBtn) return;

            const isScrollable = pills.scrollWidth > (pills.clientWidth + 4);
            if (!isScrollable) {
                prevBtn.style.display = 'none';
                nextBtn.style.display = 'none';
                return;
            }

            prevBtn.style.display = 'inline-flex';
            nextBtn.style.display = 'inline-flex';

            const atStart = pills.scrollLeft <= 3;
            const atEnd = pills.scrollLeft + pills.clientWidth >= pills.scrollWidth - 5;

            prevBtn.disabled = atStart;
            prevBtn.classList.toggle('disabled', atStart);

            nextBtn.disabled = atEnd;
            nextBtn.classList.toggle('disabled', atEnd);
        }
        window.updateCategoryPillsNavBtns = updateCategoryPillsNavBtns;

        window.scrollInsightsCategoryPills = function(direction) {
            const pills = document.getElementById('insights-category-pills');
            if (!pills) return;
            const amount = 140 * direction;
            pills.scrollBy({ left: amount, behavior: 'smooth' });
            setTimeout(updateCategoryPillsNavBtns, 220);
        };

        function initCategoryPillsScroll() {
            const pills = document.getElementById('insights-category-pills');
            if (!pills || pills._hasScrollInit) {
                updateCategoryPillsNavBtns();
                return;
            }
            pills._hasScrollInit = true;

            pills.addEventListener('scroll', updateCategoryPillsNavBtns, { passive: true });

            // Mouse wheel listener: convert vertical wheel delta to horizontal scroll
            pills.addEventListener('wheel', (e) => {
                if (e.deltaY !== 0) {
                    e.preventDefault();
                    pills.scrollLeft += (e.deltaY * 0.9);
                    updateCategoryPillsNavBtns();
                }
            }, { passive: false });

            // Mouse drag-to-scroll
            let isDown = false;
            let startX = 0;
            let scrollLeft = 0;
            let hasDragged = false;

            pills.addEventListener('mousedown', (e) => {
                isDown = true;
                hasDragged = false;
                pills.style.cursor = 'grabbing';
                startX = e.pageX - pills.offsetLeft;
                scrollLeft = pills.scrollLeft;
            });

            const stopDrag = () => {
                isDown = false;
                if (pills) pills.style.cursor = 'grab';
                updateCategoryPillsNavBtns();
            };

            pills.addEventListener('mouseleave', stopDrag);
            pills.addEventListener('mouseup', stopDrag);
            window.addEventListener('mouseup', stopDrag);

            pills.addEventListener('mousemove', (e) => {
                if (!isDown) return;
                e.preventDefault();
                const x = e.pageX - pills.offsetLeft;
                const walk = (x - startX) * 1.5;
                if (Math.abs(walk) > 4) {
                    hasDragged = true;
                }
                pills.scrollLeft = scrollLeft - walk;
            });

            // Prevent button click if dragging
            pills.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    if (hasDragged) {
                        e.stopImmediatePropagation();
                        e.preventDefault();
                        hasDragged = false;
                    }
                }, true);
            });

            updateCategoryPillsNavBtns();
        }
        window.initCategoryPillsScroll = initCategoryPillsScroll;

        window.addEventListener('resize', () => {
            syncInsightsBullionSlot();
            initCategoryPillsScroll();
        });
        window.addEventListener('orientationchange', () => {
            syncInsightsBullionSlot();
            initCategoryPillsScroll();
        });
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                syncInsightsBullionSlot();
                initCategoryPillsScroll();
            });
        } else {
            syncInsightsBullionSlot();
            initCategoryPillsScroll();
        }

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
                if (currentInsightsWatchlist === 'ALL') {
                    Object.values(watchlistsData || {}).forEach(arr => {
                        (arr || []).forEach(s => {
                            if (s) {
                                wlSyms.add(s);
                                if (typeof cleanDisplaySymbol === 'function') wlSyms.add(cleanDisplaySymbol(s));
                                wlSyms.add(s.replace('.NS', '').replace('.BO', ''));
                            }
                        });
                    });
                } else if (currentInsightsWatchlist && watchlistsData && watchlistsData[currentInsightsWatchlist]) {
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

            if (!currentInsightsWatchlist) {
                currentInsightsWatchlist = 'ALL';
            }

            // Total distinct stocks across all watchlists
            const allWlSymbolsSet = new Set();
            names.forEach(n => (watchlistsData[n] || []).forEach(s => allWlSymbolsSet.add(s)));
            const isAllWl = currentInsightsWatchlist === 'ALL';
            const allBtnClass = isAllWl ? 'btn-primary' : 'btn-secondary';
            const allActiveStyle = isAllWl ? 'background: var(--accent-color, #10b981); color: #fff; border-color: var(--accent-color, #10b981);' : '';

            let html = `
                <button type="button" class="${allBtnClass}" onclick="selectInsightsWatchlist('ALL')" style="font-size: 11.5px; padding: 5px 12px; border-radius: 20px; display: flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap; ${allActiveStyle}">
                    <span>📁 All Watchlists</span>
                    <span style="font-size: 10px; font-weight: 700; background: ${isAllWl ? 'rgba(255,255,255,0.25)' : 'var(--bg-subtle)'}; color: ${isAllWl ? '#fff' : 'var(--text-secondary)'}; padding: 1px 6px; border-radius: 10px;">
                        ${allWlSymbolsSet.size}
                    </span>
                </button>
            `;

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

            const wlQuery = currentInsightsWatchlist && currentInsightsWatchlist !== 'ALL' ? `&watchlist=${encodeURIComponent(currentInsightsWatchlist)}` : '';

            try {
                const res = await fetch(`/api/insights/news?scope=watchlist${wlQuery}${stockParam}&category=${encodeURIComponent(currentNewsCategory)}&limit=30`);
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

            fetch(`/api/insights/summary?scope=watchlist${wlQuery}`)
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

        function showTechnicalSkeletons() {
            const tableBody = document.getElementById('technical-screener-table-body');
            const pillsContainer = document.getElementById('technical-screener-pills');
            const scannedCountEl = document.getElementById('technicals-scanned-count');
            const countEl = document.getElementById('screener-meta-count');

            if (scannedCountEl) scannedCountEl.innerHTML = '<span class="skeleton-box" style="width: 55px; height: 12px; display: inline-block; vertical-align: middle;"></span>';
            if (countEl) countEl.innerHTML = '<span class="skeleton-box" style="width: 45px; height: 12px; display: inline-block; vertical-align: middle;"></span>';

            if (pillsContainer && (!technicalsData || !technicalsData.scanners)) {
                pillsContainer.innerHTML = `
                    <span class="skeleton-box" style="width: 100px; height: 26px; border-radius: 6px;"></span>
                    <span class="skeleton-box" style="width: 90px; height: 26px; border-radius: 6px;"></span>
                    <span class="skeleton-box" style="width: 95px; height: 26px; border-radius: 6px;"></span>
                    <span class="skeleton-box" style="width: 105px; height: 26px; border-radius: 6px;"></span>
                    <span class="skeleton-box" style="width: 85px; height: 26px; border-radius: 6px;"></span>
                `;
            }

            if (tableBody) {
                let rows = '';
                for (let i = 0; i < 4; i++) {
                    rows += `
                        <tr>
                            <td style="padding: 10px 12px;">
                                <span class="skeleton-box" style="width: 85px; height: 14px;"></span><br>
                                <span class="skeleton-box" style="width: 120px; height: 11px; margin-top: 4px;"></span>
                            </td>
                            <td style="text-align: right; padding: 10px 12px;">
                                <span class="skeleton-box" style="width: 65px; height: 14px;"></span>
                            </td>
                            <td style="text-align: right; padding: 10px 12px;">
                                <span class="skeleton-box" style="width: 55px; height: 18px; border-radius: 4px;"></span>
                            </td>
                            <td style="padding: 10px 12px;">
                                <span class="skeleton-box" style="width: 155px; height: 12px;"></span>
                            </td>
                            <td style="text-align: center; padding: 10px 12px;">
                                <span class="skeleton-box" style="width: 65px; height: 24px; border-radius: 6px;"></span>
                            </td>
                        </tr>
                    `;
                }
                tableBody.innerHTML = rows;
            }
        }

        function showInsightsSkeletons() {
            // 1. News Feed Skeletons
            showNewsSkeletonsOnly();

            // 1b. Technical Screener Skeletons
            showTechnicalSkeletons();

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

            // 5. Market Mood Index (MMI) Skeleton
            const mmiMount = document.getElementById('insights-mmi-mount');
            if (mmiMount) {
                mmiMount.innerHTML = `
                    <div class="mmi-skeleton-wrap">
                        <div class="skeleton-box" style="width: 180px; height: 95px; border-radius: 95px 95px 0 0; margin: 10px auto;"></div>
                        <div class="skeleton-box" style="width: 110px; height: 26px; border-radius: 6px; margin: 8px auto;"></div>
                        <div class="skeleton-box" style="width: 85%; height: 12px; margin: 8px auto;"></div>
                        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 14px;">
                            <div class="skeleton-box" style="height: 48px; border-radius: 6px;"></div>
                            <div class="skeleton-box" style="height: 48px; border-radius: 6px;"></div>
                            <div class="skeleton-box" style="height: 48px; border-radius: 6px;"></div>
                            <div class="skeleton-box" style="height: 48px; border-radius: 6px;"></div>
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
            syncInsightsBullionSlot();
            initCategoryPillsScroll();
            if (scope === null) {
                showInsightsSkeletons();
            }
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
                if (!currentInsightsWatchlist || (currentInsightsWatchlist !== 'ALL' && !watchlistsData[currentInsightsWatchlist])) {
                    currentInsightsWatchlist = 'ALL';
                }
                renderInsightsWatchlistPills();
            } else {
                if (wlContainer) wlContainer.style.display = 'none';
            }

            const wlParam = currentInsightsScope === 'watchlist' && currentInsightsWatchlist && currentInsightsWatchlist !== 'ALL' ? `&watchlist=${encodeURIComponent(currentInsightsWatchlist)}` : '';

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

            // 7. Parallel Fetch: Market Mood Index (MMI) (~150ms)
            loadMarketMoodIndex();
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
                showTechnicalSkeletons();
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

            const preferredOrder = [
                'golden_cross', 'supertrend_buy', 'rsi_momentum', 'ema_bull_cross',
                'macd_bullish', 'bollinger_breakout', 'donchian_breakout', 'st_trigger_bull',
                'bullish_engulfing', 'high_52w', 'volume_surge', 'triple_confluence',
                'rsi_oversold', 'oversold_extreme', 'death_cross', 'low_52w'
            ];
            const allScannerKeys = Object.keys(technicalsData.scanners);
            const keys = [
                ...preferredOrder.filter(k => allScannerKeys.includes(k)),
                ...allScannerKeys.filter(k => !preferredOrder.includes(k))
            ];
            if (!technicalsData.scanners[activeScreenerId] && keys.length > 0) {
                activeScreenerId = keys[0];
            }
            let html = '';

            keys.forEach(key => {
                const scanner = technicalsData.scanners[key];
                if (!scanner) return;
                const isActive = key === activeScreenerId;
                const btnClass = isActive ? 'btn-primary' : 'btn-secondary';
                const activeStyle = isActive ? 'background: var(--btn-primary-bg, #10b981); color: #fff; border-color: var(--btn-primary-bg, #10b981);' : '';
                
                const scopedStocks = getScopedScannerStocks(scanner.stocks);
                const count = scopedStocks.length;

                html += `
                    <button type="button" class="${btnClass} screener-pill" data-screener="${key}" onclick="selectTechnicalScreener('${key}')" style="font-size: 11.5px; padding: 5px 12px; border-radius: 6px; display: flex; align-items: center; gap: 6px; ${activeStyle}">
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
                gainerSymEl.innerText = typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(gainer.symbol) : gainer.symbol;
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
                loserSymEl.innerText = typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(loser.symbol) : loser.symbol;
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
                                <strong class="insights-thesis-stock-trigger" style="color: var(--text-primary); font-size: 13px; cursor: pointer;" title="Click stock name to view fundamentals" onclick="event.stopPropagation(); openInsightsFundamentals('${escapeHtml(t.symbol)}');">${escapeHtml(typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(t.symbol) : t.symbol)}</strong>
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
            const sourceBadge = document.getElementById('fiidii-source-badge');
            if (!fiiMount || !fd) return;

            if (fiiDateTag && fd.date) fiiDateTag.innerText = window.formatAppDate ? window.formatAppDate(fd.date) : fd.date;
            if (sourceBadge && fd.source) {
                sourceBadge.innerText = fd.source.toUpperCase().includes('NSE') ? 'NSE DIRECT' : fd.source;
            }

            const fiiPos = fd.fii_net >= 0;
            const diiPos = fd.dii_net >= 0;
            const totPos = fd.total_net >= 0;

            const fiiSign = fiiPos ? '+' : '-';
            const diiSign = diiPos ? '+' : '-';
            const totSign = totPos ? '+' : '-';

            const fiiGrossTooltip = (fd.fii_buy && fd.fii_sell) ? `Gross Buy: ₹${fd.fii_buy.toLocaleString('en-IN')} Cr | Gross Sell: ₹${fd.fii_sell.toLocaleString('en-IN')} Cr (NSE Official)` : '';
            const diiGrossTooltip = (fd.dii_buy && fd.dii_sell) ? `Gross Buy: ₹${fd.dii_buy.toLocaleString('en-IN')} Cr | Gross Sell: ₹${fd.dii_sell.toLocaleString('en-IN')} Cr (NSE Official)` : '';

            fiiMount.innerHTML = `
                <div style="background: var(--bg-subtle); padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;" ${fiiGrossTooltip ? `title="${escapeHtml(fiiGrossTooltip)}"` : ''}>
                    <div>
                        <span style="font-size: 11px; font-weight: 700; color: var(--text-secondary);">FII / FPI Flow</span>
                        <span style="font-size: 9.5px; padding: 1px 6px; border-radius: 4px; font-weight: 700; margin-left: 6px; ${fiiPos ? 'background: rgba(16,185,129,0.15); color: #10b981;' : 'background: rgba(239,68,68,0.15); color: #ef4444;'}">${fd.fii_action || (fiiPos ? 'NET BUY' : 'NET SELL')}</span>
                    </div>
                    <span style="font-size: 13px; font-weight: 700; color: ${fiiPos ? '#10b981' : '#ef4444'};">${fiiSign}₹${Math.abs(fd.fii_net).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})} Cr</span>
                </div>
                <div style="background: var(--bg-subtle); padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;" ${diiGrossTooltip ? `title="${escapeHtml(diiGrossTooltip)}"` : ''}>
                    <div>
                        <span style="font-size: 11px; font-weight: 700; color: var(--text-secondary);">DII Flow</span>
                        <span style="font-size: 9.5px; padding: 1px 6px; border-radius: 4px; font-weight: 700; margin-left: 6px; ${diiPos ? 'background: rgba(16,185,129,0.15); color: #10b981;' : 'background: rgba(239,68,68,0.15); color: #ef4444;'}">${fd.dii_action || (diiPos ? 'NET BUY' : 'NET SELL')}</span>
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

            if (window.CapitalDeskPush && typeof window.CapitalDeskPush.checkCurrentSubscription === 'function') {
                window.CapitalDeskPush.checkCurrentSubscription();
            }

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

            const f22k_1g = data.gold_22k_1g ? '₹' + data.gold_22k_1g.toLocaleString('en-IN') : '₹13,515';
            const f22k_8g = data.gold_22k_8g ? '₹' + data.gold_22k_8g.toLocaleString('en-IN') : '₹1,08,120';
            const fsilver_1g = data.silver_1g ? '₹' + data.silver_1g.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '₹240.00';
            const fsilver_8g = data.silver_8g ? '₹' + data.silver_8g.toLocaleString('en-IN') : '₹1,920';
            const fsilver_1kg = data.silver_1kg ? '₹' + data.silver_1kg.toLocaleString('en-IN') : '₹2,40,000';

            const show22k = activeBullionFilter === 'all' || activeBullionFilter === '22k';
            const showSilver = activeBullionFilter === 'all' || activeBullionFilter === 'silver';

            let html = '';

            // 1. Standard Gold 22K Card (24K hidden per user request)
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
                                <span class="bullion-tile-sub">${formatBullionChangeBadge(data.gold_22k_change_amt, data.gold_22k_change_pct)}</span>
                            </div>
                            <div class="bullion-tile">
                                <span class="bullion-tile-label">8 Gm (1 Sovereign)</span>
                                <span class="bullion-tile-value bullion-val-22k">${f22k_8g}</span>
                                <span class="bullion-tile-sub">${formatBullionChangeBadge(data.gold_22k_change_amt ? data.gold_22k_change_amt * 8 : 0, data.gold_22k_change_pct)}</span>
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
                                <span class="bullion-tile-sub">${formatBullionChangeBadge(data.silver_change_amt, data.silver_change_pct)}</span>
                            </div>
                            <div class="bullion-tile">
                                <span class="bullion-tile-label">8 Grams</span>
                                <span class="bullion-tile-value bullion-val-silver">${fsilver_8g}</span>
                                <span class="bullion-tile-sub">${formatBullionChangeBadge(data.silver_change_amt ? data.silver_change_amt * 8 : 0, data.silver_change_pct)}</span>
                            </div>
                        </div>
                        <div class="bullion-tile bullion-tile-full">
                            <div style="display: flex; flex-direction: column; min-width: 0;">
                                <span class="bullion-tile-label">1 Kg (Ready Silver)</span>
                                <span class="bullion-tile-sub">${formatBullionChangeBadge(data.silver_change_amt ? data.silver_change_amt * 1000 : 0, data.silver_change_pct)}</span>
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
                    <a href="${art.link}" target="_blank" rel="noopener noreferrer" class="insights-news-title" style="font-weight: 400; font-size: 12px; color: var(--text-primary); text-decoration: none; line-height: 1.45; display: block; margin-bottom: 8px;">
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
                showNewsSkeletonsOnly();
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
                btn.innerHTML = '<svg class="spinning" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 6px;"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg> Fetching More Stories...';
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


        function formatBullionChangeBadge(amt, pct) {
            if (amt === undefined || amt === null || (amt === 0 && pct === 0)) {
                return '<span style="font-size: 10.5px; opacity: 0.7; color: var(--text-secondary);">Daily Benchmark</span>';
            }
            const isPos = amt >= 0;
            const sign = isPos ? '+' : '-';
            const color = isPos ? '#10b981' : '#ef4444';
            const icon = isPos ? '▲' : '▼';
            return `<span style="font-size: 11px; font-weight: 700; color: ${color};">${icon} ${sign}₹${Math.abs(amt).toLocaleString('en-IN', {minimumFractionDigits: 1, maximumFractionDigits: 2})} (${sign}${Math.abs(pct).toFixed(2)}%)</span>`;
        }

        async function openBullionHistoryModal() {
            const modal = document.getElementById('bullionHistoryModal');
            if (modal) {
                modal.style.display = 'block';
                if (typeof window.bringModalToFront === 'function') window.bringModalToFront(modal);
            }
            const tbody = document.getElementById('bullion-history-tbody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--text-secondary);">Loading historical bullion rates...</td></tr>';
            try {
                const res = await fetch('/api/insights/bullion/history');
                const data = await res.json();
                if (data.success && Array.isArray(data.history) && data.history.length > 0) {
                    tbody.innerHTML = data.history.map(row => {
                        const fmtChg = (amt, pct) => {
                            if (amt === undefined || amt === null) return '';
                            if (amt === 0) {
                                return '<div class="bullion-chg-line" style="color: var(--text-secondary); opacity: 0.75; font-weight: 500;"><span class="bullion-chg-amt">₹0</span><span class="bullion-chg-pct"> (0.00%)</span></div>';
                            }
                            const isPos = amt > 0;
                            const sign = isPos ? '+' : '-';
                            const color = isPos ? '#10b981' : '#ef4444';
                            const formattedAmt = Math.abs(amt).toLocaleString('en-IN', {
                                minimumFractionDigits: (amt % 1 !== 0 ? 2 : 0),
                                maximumFractionDigits: 2
                            });
                            return `<div class="bullion-chg-line" style="color: ${color}; font-weight: 600;"><span class="bullion-chg-amt">${sign}₹${formattedAmt}</span><span class="bullion-chg-pct"> (${sign}${Math.abs(pct).toFixed(2)}%)</span></div>`;
                        };

                        const g22_1gChg = fmtChg(row.gold_22k_change_amt, row.gold_22k_change_pct);
                        const g22_8gChg = fmtChg(row.gold_22k_change_amt ? row.gold_22k_change_amt * 8 : 0, row.gold_22k_change_pct);
                        const s_1gChg = fmtChg(row.silver_change_amt, row.silver_change_pct);
                        const s_1kgChg = fmtChg(row.silver_change_amt ? row.silver_change_amt * 1000 : 0, row.silver_change_pct);

                        let dateText = row.date_display || row.date || '';
                        if (dateText.includes('/')) {
                            const p = dateText.split('/');
                            if (p.length === 3) {
                                dateText = `${p[0]} ${p[1]} '${p[2].slice(-2)}`;
                            }
                        } else if (dateText.includes('-')) {
                            const p = dateText.split('-');
                            if (p.length === 3 && p[0].length === 4) {
                                const d = new Date(dateText);
                                if (!isNaN(d.getTime())) {
                                    const day = String(d.getDate()).padStart(2, '0');
                                    const mon = d.toLocaleString('en-US', { month: 'short' });
                                    const yr = String(d.getFullYear()).slice(-2);
                                    dateText = `${day} ${mon} '${yr}`;
                                }
                            }
                        }

                        return `
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <td class="col-date">${dateText}</td>
                                <td class="col-22k-1g" style="color: var(--text-secondary);"><span class="bullion-price-val">₹${Number(row.gold_22k_1g).toLocaleString('en-IN')}</span>${g22_1gChg}</td>
                                <td class="col-22k-8g" style="color: var(--text-primary);"><span class="bullion-price-val">₹${Number(row.gold_22k_8g).toLocaleString('en-IN')}</span>${g22_8gChg}</td>
                                <td class="col-sil-1g" style="color: var(--text-secondary);"><span class="bullion-price-val">₹${Number(row.silver_1g).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>${s_1gChg}</td>
                                <td class="col-sil-1kg" style="color: var(--text-secondary);"><span class="bullion-price-val">₹${Number(row.silver_1kg).toLocaleString('en-IN')}</span>${s_1kgChg}</td>
                            </tr>
                        `;
                    }).join('');
                } else {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--text-secondary);">No historical records recorded yet.</td></tr>';
                }
            } catch (err) {
                console.error('Error fetching bullion history:', err);
                if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: #ef4444;">Failed to load history.</td></tr>';
            }
        }

        function closeBullionHistoryModal() {
            const modal = document.getElementById('bullionHistoryModal');
            if (modal) modal.style.display = 'none';
        }

        window.openBullionHistoryModal = openBullionHistoryModal;
        window.closeBullionHistoryModal = closeBullionHistoryModal;


        // =========================================================
        // MARKET MOOD INDEX (MMI) GAUGE & SENTIMENT LOGIC
        // =========================================================
        let _cachedMmiData = null;
        let _mmiChartInstance = null;
        let _activeMmiView = 'gauge';

        const DEFAULT_FALLBACK_MMI = {
            current: {
                value: 77.5,
                zone: "Extreme Greed",
                code: "extreme_greed",
                color: "#10b981",
                bg_glow: "rgba(16, 185, 129, 0.14)",
                border: "rgba(16, 185, 129, 0.35)",
                description: "Market is overheated and overbought (> 70). Investors are euphoric. Good time to protect profits or avoid fresh aggressive buys."
            },
            comparisons: {
                yesterday: { value: 76.2, zone: "Extreme Greed", color: "#10b981" },
                last_week: { value: 68.4, zone: "Greed", color: "#06b6d4" },
                last_month: { value: 54.1, zone: "Greed", color: "#06b6d4" },
                last_year: { value: 42.8, zone: "Fear", color: "#f59e0b" }
            },
            context: {
                nifty: { value: 25044.65, change: 135.5, pChange: 0.56 },
                vix: { value: 17.42, change: -0.45, pChange: -2.95 }
            },
            factors: [
                { name: "FII Activity", desc: "Net open interest in Index Futures", status: "Bullish" },
                { name: "Volatility (VIX)", desc: "India VIX index level and trend", status: "Low Volatility" },
                { name: "Market Momentum", desc: "Price vs 50 DMA and 200 DMA", status: "Overbought" },
                { name: "Market Breadth", desc: "Advance / Decline ratio", status: "Positive" },
                { name: "Price Strength", desc: "52-week highs vs 52-week lows", status: "Strong" },
                { name: "Skew & Sentiment", desc: "Put/Call ratio and option volume", status: "Greed" }
            ],
            history: [
                { date: "10 Oct", value: 52.0 },
                { date: "15 Oct", value: 55.4 },
                { date: "20 Oct", value: 61.2 },
                { date: "25 Oct", value: 64.0 },
                { date: "28 Oct", value: 59.8 },
                { date: "01 Nov", value: 67.3 },
                { date: "04 Nov", value: 71.5 },
                { date: "06 Nov", value: 74.2 },
                { date: "08 Nov", value: 76.2 },
                { date: "09 Nov", value: 77.5 }
            ]
        };

        async function loadMarketMoodIndex(forceRefresh = false) {
            const refreshBtn = document.getElementById('mmi-refresh-btn');
            if (refreshBtn) refreshBtn.classList.add('spinning');

            try {
                const res = await fetch(`/api/insights/mmi?refresh=${forceRefresh ? '1' : '0'}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (data && data.success && data.mmi) {
                    _cachedMmiData = data.mmi;
                    renderMarketMoodIndexUI(data.mmi);
                } else {
                    throw new Error((data && data.error) ? data.error : 'Invalid response');
                }
            } catch (err) {
                console.warn('MMI fetch notice, rendering graceful fallback:', err);
                const fallbackData = _cachedMmiData || DEFAULT_FALLBACK_MMI;
                renderMarketMoodIndexUI(fallbackData);
            } finally {
                if (refreshBtn) refreshBtn.classList.remove('spinning');
            }
        }
        window.loadMarketMoodIndex = loadMarketMoodIndex;

        function toggleMmiView(view) {
            _activeMmiView = view;
            const navBtns = document.querySelectorAll('.mmi-nav-btn');
            navBtns.forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-view') === view);
            });

            const viewGauge = document.getElementById('mmi-view-gauge');
            const viewTrend = document.getElementById('mmi-view-trend');
            const viewFactors = document.getElementById('mmi-view-factors');

            if (viewGauge) viewGauge.style.display = (view === 'gauge') ? 'flex' : 'none';
            if (viewTrend) viewTrend.style.display = (view === 'trend') ? 'flex' : 'none';
            if (viewFactors) viewFactors.style.display = (view === 'factors') ? 'flex' : 'none';

            if (view === 'trend' && _cachedMmiData && _cachedMmiData.history) {
                setTimeout(() => {
                    renderMmiTrendChart(_cachedMmiData.history, _cachedMmiData.current?.color);
                }, 40);
            }
        }
        window.toggleMmiView = toggleMmiView;

        function renderMarketMoodIndexUI(mmiData) {
            const mount = document.getElementById('insights-mmi-mount');
            if (!mount || !mmiData) return;

            const cur = mmiData.current || {};
            const score = (cur.value !== undefined) ? Number(cur.value) : 50.0;
            const zone = cur.zone || 'Neutral';
            const color = cur.color || '#10b981';
            const comp = mmiData.comparisons || {};
            const factors = mmiData.factors || [];
            const history = mmiData.history || [];

            // Calculate needle angle (-90 deg at 0, 0 deg at 50, +90 deg at 100)
            const needleAngle = -90 + (Math.max(0, Math.min(100, score)) / 100.0) * 180.0;

            // Compute high / low from history
            const histVals = (history && history.length > 0) ? history.map(h => Number(h.value)) : [score];
            const highVal = Math.max(...histVals, score);
            const lowVal = Math.min(...histVals, score);

            // Factors list HTML
            const factorsHtml = factors.map(f => `
                <div class="mmi-factor-item">
                    <div>
                        <div class="mmi-factor-name">${escapeHtml(f.name)}</div>
                        <div class="mmi-factor-desc">${escapeHtml(f.desc)}</div>
                    </div>
                    <span class="mmi-factor-status">${escapeHtml(f.status)}</span>
                </div>
            `).join('');

            mount.innerHTML = `
                <!-- View Navigation Tabs -->
                <div class="mmi-view-nav">
                    <button type="button" class="mmi-nav-btn ${_activeMmiView === 'gauge' ? 'active' : ''}" data-view="gauge" onclick="toggleMmiView('gauge')">🧭 Speedometer</button>
                    <button type="button" class="mmi-nav-btn ${_activeMmiView === 'trend' ? 'active' : ''}" data-view="trend" onclick="toggleMmiView('trend')">📈 30D Trend</button>
                    <button type="button" class="mmi-nav-btn ${_activeMmiView === 'factors' ? 'active' : ''}" data-view="factors" onclick="toggleMmiView('factors')">💡 Drivers</button>
                </div>

                <!-- 1. SPEEDOMETER GAUGE VIEW -->
                <div class="mmi-gauge-view" id="mmi-view-gauge" style="display: ${_activeMmiView === 'gauge' ? 'flex' : 'none'};">
                    <div class="mmi-gauge-wrap">
                        <svg class="mmi-svg-chart" viewBox="0 0 240 125" aria-hidden="true">
                            <defs>
                                <filter id="mmiNeedleShadow" x="-30%" y="-30%" width="160%" height="160%">
                                    <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-opacity="0.3"/>
                                </filter>
                            </defs>

                            <!-- Background Track -->
                            <path d="M 40 110 A 80 80 0 0 1 200 110" fill="none" stroke="var(--bg-subtle, rgba(255,255,255,0.05))" stroke-width="13" stroke-linecap="round"/>

                            <!-- 4 Calibrated Color Arcs -->
                            <path d="M 40.0 110 A 80 80 0 0 1 72.0 46.5" fill="none" stroke="#ef4444" stroke-width="11" stroke-linecap="round" />
                            <path d="M 74.0 45.0 A 80 80 0 0 1 118.5 30.1" fill="none" stroke="#f59e0b" stroke-width="11" stroke-linecap="round" />
                            <path d="M 121.5 30.1 A 80 80 0 0 1 166.0 45.0" fill="none" stroke="#06b6d4" stroke-width="11" stroke-linecap="round" />
                            <path d="M 168.0 46.5 A 80 80 0 0 1 200.0 110" fill="none" stroke="#10b981" stroke-width="11" stroke-linecap="round" />

                            <!-- Clean Perimeter Numbers (No text overlap) -->
                            <text x="24" y="114" font-size="9" font-weight="700" fill="#ef4444" text-anchor="middle">0</text>
                            <text x="64" y="34" font-size="9" font-weight="700" fill="#f59e0b" text-anchor="middle">30</text>
                            <text x="120" y="18" font-size="9" font-weight="700" fill="var(--text-secondary)" text-anchor="middle">50</text>
                            <text x="176" y="34" font-size="9" font-weight="700" fill="#06b6d4" text-anchor="middle">70</text>
                            <text x="216" y="114" font-size="9" font-weight="700" fill="#10b981" text-anchor="middle">100</text>

                            <!-- Precision Animated Needle -->
                            <g style="transform: rotate(${needleAngle}deg); transform-origin: 120px 110px; transition: transform 1.2s cubic-bezier(0.16, 1, 0.3, 1);">
                                <polygon points="118,110 120,40 122,110" fill="var(--text-primary)" filter="url(#mmiNeedleShadow)"/>
                                <circle cx="120" cy="110" r="7" fill="var(--bg-card)" stroke="var(--border-color)" stroke-width="2.5" />
                                <circle cx="120" cy="110" r="3.5" fill="${color}" />
                            </g>
                        </svg>

                        <!-- Clean Score & Zone Badge -->
                        <div class="mmi-score-box">
                            <div class="mmi-score-num" style="color: ${color};">${score.toFixed(1)}</div>
                            <span class="mmi-zone-badge" style="background: ${cur.bg_glow || 'rgba(16,185,129,0.14)'}; color: ${color}; border: 1px solid ${cur.border || color};">
                                ${escapeHtml(zone.toUpperCase())}
                            </span>
                        </div>

                        <!-- 1-Line Action Guidance -->
                        <div class="mmi-action-text">${escapeHtml(cur.description || '')}</div>
                    </div>

                    <!-- 4-Box Historical Comparison Timeline -->
                    <div class="mmi-comparison-grid">
                        <div class="mmi-compare-card">
                            <div class="mmi-compare-lbl">YESTERDAY</div>
                            <div class="mmi-compare-val" style="color: ${comp.yesterday?.color || '#10b981'};">${(comp.yesterday?.value !== undefined ? Number(comp.yesterday.value).toFixed(1) : '-')}</div>
                            <div class="mmi-compare-zone">${escapeHtml(comp.yesterday?.zone || '-')}</div>
                        </div>
                        <div class="mmi-compare-card">
                            <div class="mmi-compare-lbl">LAST WEEK</div>
                            <div class="mmi-compare-val" style="color: ${comp.last_week?.color || '#06b6d4'};">${(comp.last_week?.value !== undefined ? Number(comp.last_week.value).toFixed(1) : '-')}</div>
                            <div class="mmi-compare-zone">${escapeHtml(comp.last_week?.zone || '-')}</div>
                        </div>
                        <div class="mmi-compare-card">
                            <div class="mmi-compare-lbl">LAST MONTH</div>
                            <div class="mmi-compare-val" style="color: ${comp.last_month?.color || '#ef4444'};">${(comp.last_month?.value !== undefined ? Number(comp.last_month.value).toFixed(1) : '-')}</div>
                            <div class="mmi-compare-zone">${escapeHtml(comp.last_month?.zone || '-')}</div>
                        </div>
                        <div class="mmi-compare-card">
                            <div class="mmi-compare-lbl">LAST YEAR</div>
                            <div class="mmi-compare-val" style="color: ${comp.last_year?.color || '#06b6d4'};">${(comp.last_year?.value !== undefined ? Number(comp.last_year.value).toFixed(1) : '-')}</div>
                            <div class="mmi-compare-zone">${escapeHtml(comp.last_year?.zone || '-')}</div>
                        </div>
                    </div>

                    <!-- Context Row (Nifty 50 & India VIX) -->
                    <div class="mmi-context-row">
                        <div class="mmi-context-item">
                            <span>🇮🇳 Nifty 50:</span>
                            <span class="mmi-context-val">₹${cur.nifty ? Number(cur.nifty).toLocaleString('en-IN', {minimumFractionDigits: 2}) : '25,044.65'}</span>
                        </div>
                        <div class="mmi-context-item">
                            <span>⚡ India VIX:</span>
                            <span class="mmi-context-val">${cur.vix ? Number(cur.vix).toFixed(2) : '17.42'}</span>
                        </div>
                    </div>
                </div>

                <!-- 2. 30-DAY TREND VIEW -->
                <div class="mmi-trend-view" id="mmi-view-trend" style="display: ${_activeMmiView === 'trend' ? 'flex' : 'none'};">
                    <div class="mmi-trend-stats">
                        <div class="mmi-trend-stat-chip">
                            <span class="mmi-stat-chip-lbl">Current</span>
                            <span class="mmi-stat-chip-val" style="color: ${color};">${score.toFixed(1)}</span>
                        </div>
                        <div class="mmi-trend-stat-chip">
                            <span class="mmi-stat-chip-lbl">30D High</span>
                            <span class="mmi-stat-chip-val" style="color: #10b981;">${highVal.toFixed(1)}</span>
                        </div>
                        <div class="mmi-trend-stat-chip">
                            <span class="mmi-stat-chip-lbl">30D Low</span>
                            <span class="mmi-stat-chip-val" style="color: #ef4444;">${lowVal.toFixed(1)}</span>
                        </div>
                    </div>
                    <div class="mmi-chart-wrap">
                        <canvas id="mmiTrendCanvas"></canvas>
                    </div>
                </div>

                <!-- 3. DRIVERS / FACTORS VIEW -->
                <div class="mmi-factors-view" id="mmi-view-factors" style="display: ${_activeMmiView === 'factors' ? 'flex' : 'none'};">
                    <div class="mmi-factors-list">
                        ${factorsHtml}
                    </div>
                </div>
            `;

            // If trend view is active, render chart
            if (_activeMmiView === 'trend' && history && history.length > 0) {
                renderMmiTrendChart(history, color);
            }
        }

        function renderMmiTrendChart(history, curColor) {
            const canvas = document.getElementById('mmiTrendCanvas');
            if (!canvas || typeof Chart === 'undefined') return;

            if (_mmiChartInstance) {
                _mmiChartInstance.destroy();
                _mmiChartInstance = null;
            }

            const ctx = canvas.getContext('2d');
            const labels = history.map(h => h.displayDate || h.date);
            const dataValues = history.map(h => h.value);

            const gradient = ctx.createLinearGradient(0, 0, 0, 160);
            gradient.addColorStop(0, curColor ? `${curColor}55` : 'rgba(16, 185, 129, 0.35)');
            gradient.addColorStop(1, 'rgba(16, 185, 129, 0.00)');

            const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
            const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';
            const textColor = isDark ? '#94a3b8' : '#64748b';

            _mmiChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Market Mood Index',
                        data: dataValues,
                        borderColor: curColor || '#10b981',
                        backgroundColor: gradient,
                        borderWidth: 2.2,
                        fill: true,
                        tension: 0.35,
                        pointRadius: 2,
                        pointHoverRadius: 5,
                        pointHoverBackgroundColor: curColor || '#10b981',
                        pointHoverBorderColor: '#ffffff',
                        pointHoverBorderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            mode: 'index',
                            intersect: false,
                            backgroundColor: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                            titleColor: isDark ? '#f8fafc' : '#0f172a',
                            bodyColor: isDark ? '#cbd5e1' : '#334155',
                            borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)',
                            borderWidth: 1,
                            padding: 8,
                            displayColors: false,
                            callbacks: {
                                label: function(context) {
                                    const val = context.parsed.y;
                                    let zone = 'Neutral';
                                    if (val < 30) zone = 'Extreme Fear';
                                    else if (val < 50) zone = 'Fear';
                                    else if (val < 70) zone = 'Greed';
                                    else zone = 'Extreme Greed';
                                    return `MMI: ${val.toFixed(1)} (${zone})`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: {
                                color: textColor,
                                font: { size: 9.5 },
                                maxRotation: 0,
                                autoSkip: true,
                                maxTicksLimit: 6
                            }
                        },
                        y: {
                            min: 0,
                            max: 100,
                            grid: { color: gridColor },
                            ticks: {
                                color: textColor,
                                font: { size: 9.5 },
                                stepSize: 25
                            }
                        }
                    }
                }
            });
        }
