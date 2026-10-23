// ==============================================================================
// CAPITAL DESK - TECHNICAL SCREENER & PATTERN INTELLIGENCE (PHASE 1)
// Ultra-Modern Glassmorphic Terminal UX Controller
// Location: modules/technical_screener/technical_screener.js
// ==============================================================================

(function() {
    'use strict';

    let currentCategory = 'smart_scanners';
    let currentScope = 'all';
    let currentTimeframe = 'daily';
    let currentWatchlistId = null;
    let hierarchyData = null;
    let scanResults = null;
    let isScanning = false;

    // Expose to window for Router integration
    window.loadTechnicalScreenerModule = loadTechnicalScreenerModule;
    window.switchTechnicalScreenerCategory = switchTechnicalScreenerCategory;
    window.setTechnicalScreenerScope = setTechnicalScreenerScope;
    window.setTechnicalScreenerTimeframe = setTechnicalScreenerTimeframe;
    window.setTechnicalScreenerWatchlist = onTechnicalScreenerWatchlistChange;
    window.onTechnicalScreenerWatchlistChange = onTechnicalScreenerWatchlistChange;
    window.triggerTechnicalScreenerScan = triggerTechnicalScreenerScan;
    window.filterTechnicalScreenerResults = filterTechnicalScreenerResults;
    window.openTechnicalStockChart = openTechnicalStockChart;
    window.openStockChartSafely = openTechnicalStockChart;
    window.openFundamentalsSafely = openFundamentalsSafely;

    /**
     * Entry point called on tab activation
     */
    async function loadTechnicalScreenerModule() {
        if (!hierarchyData) {
            await fetchHierarchy();
        }
        await triggerTechnicalScreenerScan(false);
    }

    /**
     * Fetch master hierarchy from Collection 1
     */
    async function fetchHierarchy() {
        try {
            const resp = await fetch('/api/technical-screener/hierarchy');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const json = await resp.json();
            if (json.success && json.hierarchy) {
                hierarchyData = json.hierarchy;
                renderCategoryDeck();
            }
        } catch (err) {
            console.error('Error fetching technical screener hierarchy:', err);
        }
    }

    /**
     * Render Parent Category Rails
     */
    function renderCategoryDeck() {
        const deck = document.getElementById('ts-category-deck');
        if (!deck || !hierarchyData || !hierarchyData.categories) return;

        let html = '';
        hierarchyData.categories.forEach(cat => {
            const isActive = cat.id === currentCategory;
            const isReady = cat.status === 'ready';
            const badgeClass = isReady ? 'ts-cat-tab-badge' : 'ts-cat-tab-badge planned';
            const badgeText = cat.badge || (isReady ? 'Active' : `Phase ${cat.phase || 2}`);

            html += `
                <button type="button" class="ts-cat-tab-btn ${isActive ? 'active' : ''}" 
                        onclick="switchTechnicalScreenerCategory('${escapeHtml(cat.id)}')">
                    <span>${cat.icon || '⚡'}</span>
                    <span>${escapeHtml(cat.name)}</span>
                    <span class="${badgeClass}">${escapeHtml(badgeText)}</span>
                </button>
            `;
        });
        deck.innerHTML = html;
        initCategoryDeckWheelScroll();
    }

    /**
     * Enable smooth horizontal wheel scrolling on category deck for desktop web
     */
    function initCategoryDeckWheelScroll() {
        const deck = document.getElementById('ts-category-deck');
        if (deck && !deck.dataset.wheelBound) {
            deck.dataset.wheelBound = 'true';
            deck.addEventListener('wheel', (e) => {
                if (e.deltaY !== 0) {
                    e.preventDefault();
                    deck.scrollLeft += e.deltaY;
                }
            }, { passive: false });
        }
    }

    /**
     * Switch Parent Category Tab
     */
    async function switchTechnicalScreenerCategory(categoryId) {
        if (isScanning) return;
        currentCategory = categoryId;
        renderCategoryDeck();
        await triggerTechnicalScreenerScan(false);
    }

    /**
     * Set Scope Filter ('all', 'portfolio', 'watchlist')
     */
    async function setTechnicalScreenerScope(scope) {
        if (isScanning) return;
        currentScope = scope;

        // Update button active state
        document.querySelectorAll('.ts-scope-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.getElementById(`ts-scope-${scope}`);
        if (activeBtn) activeBtn.classList.add('active');

        // Watchlist dropdown visibility
        const wlWrap = document.getElementById('ts-watchlist-dropdown-wrap');
        if (scope === 'watchlist') {
            if (wlWrap) {
                wlWrap.style.display = 'inline-flex';
                await populateWatchlistDropdown();
            }
        } else {
            if (wlWrap) wlWrap.style.display = 'none';
            currentWatchlistId = null;
        }

        await triggerTechnicalScreenerScan(false);
    }

    /**
     * Populate Watchlist selection dropdown
     */
    async function populateWatchlistDropdown() {
        const select = document.getElementById('ts-watchlist-select');
        if (!select) return;

        try {
            const resp = await fetch('/api/technical-screener/watchlists');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const json = await resp.json();

            const watchlists = (json && json.watchlists) || [];
            const totalCombined = json.total_combined || 0;

            if (watchlists.length === 0) {
                select.innerHTML = `<option value="__all__">📂 No watchlists found</option>`;
                return;
            }

            let html = `<option value="__all__" ${(!currentWatchlistId || currentWatchlistId === '__all__') ? 'selected' : ''}>📂 All Watchlists (${totalCombined} stocks)</option>`;

            watchlists.forEach(w => {
                const isSel = w.name === currentWatchlistId;
                html += `<option value="${escapeHtml(w.name)}" ${isSel ? 'selected' : ''}>⭐ ${escapeHtml(w.name)} (${w.count} stocks)</option>`;
            });

            select.innerHTML = html;
        } catch (e) {
            console.error('Error loading screener watchlists:', e);
            select.innerHTML = `<option value="__all__">📂 All Watchlists (Combined)</option>`;
        }
    }

    /**
     * Handle user changing Watchlist dropdown
     */
    async function onTechnicalScreenerWatchlistChange(wlId) {
        currentWatchlistId = (wlId && wlId !== '__all__') ? wlId : null;
        await triggerTechnicalScreenerScan(false);
    }

    /**
     * Set Timeframe Filter ('daily', 'weekly', 'monthly')
     */
    async function setTechnicalScreenerTimeframe(tf) {
        if (isScanning) return;
        const validTfs = ['daily', 'weekly', 'monthly'];
        if (!validTfs.includes(tf)) tf = 'daily';
        if (currentTimeframe === tf) return;

        currentTimeframe = tf;

        // Sync dropdown selection if changed programmatically
        const select = document.getElementById('ts-timeframe-select');
        if (select && select.value !== tf) {
            select.value = tf;
        }

        await triggerTechnicalScreenerScan(false);
    }

    /**
     * Trigger On-Demand Scan
     */
    async function triggerTechnicalScreenerScan(forceRefresh = false) {
        if (isScanning) return;
        isScanning = true;

        const refreshBtn = document.getElementById('ts-btn-refresh-scan');
        const refreshIcon = document.getElementById('ts-refresh-icon');
        const refreshLabel = document.getElementById('ts-refresh-label');
        const statsEl = document.getElementById('ts-stats-counter');
        const statusLabel = document.getElementById('ts-status-label');

        if (refreshIcon) refreshIcon.style.animation = 'spin 1s linear infinite';
        if (refreshLabel) refreshLabel.textContent = 'Scanning...';
        if (statusLabel) statusLabel.textContent = 'Computing...';

        renderSkeletons();

        try {
            let url = `/api/technical-screener/scan?category=${encodeURIComponent(currentCategory)}&scope=${encodeURIComponent(currentScope)}&timeframe=${encodeURIComponent(currentTimeframe)}`;
            if (currentWatchlistId && currentScope === 'watchlist') {
                url += `&watchlist_id=${encodeURIComponent(currentWatchlistId)}`;
            }
            if (forceRefresh) {
                url += `&force_refresh=true`;
            }

            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            if (data.success) {
                scanResults = data;
                renderScreenerView(data);
                if (statsEl) {
                    const tfLabel = currentTimeframe === 'weekly' ? 'Weekly 1W' : (currentTimeframe === 'monthly' ? 'Monthly 1M' : 'Daily 1D');
                    if (data.no_stocks) {
                        statsEl.innerHTML = `No stocks found in <b>${escapeHtml(formatScopeLabel(currentScope))}</b>`;
                    } else if (data.needs_scan) {
                        statsEl.innerHTML = `Timeframe: <b>${tfLabel}</b> · Universe: <b>${data.total_scanned || 0}</b> stocks · Click 'Scan Now' to run`;
                    } else {
                        const totalScanners = Object.keys(data.scanners || {}).length;
                        const totalMatched = Object.values(data.scanners || {}).reduce((acc, s) => acc + (s.stocks ? s.stocks.length : 0), 0);
                        const cacheNotice = data.from_cache ? ' · <span style="color:#10b981;">⚡ Cached Instant</span>' : '';
                        statsEl.innerHTML = `Timeframe: <b>${tfLabel}</b> · Showing <b>${totalScanners}</b> scanners · Analyzed <b>${data.total_scanned || 0}</b> stocks · <b>${totalMatched}</b> active signals${cacheNotice}`;
                    }
                }
            } else {
                renderError(data.error || 'Unable to complete technical scan');
            }
        } catch (err) {
            console.error('Technical scan error:', err);
            renderError(err.message || 'Network error scanning technicals');
        } finally {
            isScanning = false;
            if (refreshIcon) refreshIcon.style.animation = 'none';
            if (refreshLabel) refreshLabel.textContent = 'Scan Now';
            if (statusLabel) statusLabel.textContent = 'Live Radar';
        }
    }

    /**
     * Format scope human readable label
     */
    function formatScopeLabel(scope) {
        if (scope === 'portfolio') return 'Portfolio Holdings';
        if (scope === 'watchlist') {
            return currentWatchlistId ? `Watchlist (${currentWatchlistId})` : 'All Watchlists';
        }
        return 'All Tracked Stocks';
    }

    /**
     * Render Screener View based on Category
     */
    function renderScreenerView(data) {
        const container = document.getElementById('ts-scanners-container');
        if (!container) return;

        const catMeta = hierarchyData?.categories?.find(c => c.id === currentCategory);

        // Check if user has no stocks tracked in selected scope
        if (data.no_stocks) {
            container.innerHTML = `
                <div class="ts-scan-prompt-wrap">
                    <div class="ts-scan-prompt-card">
                        <div class="ts-prompt-icon">💼</div>
                        <h3 class="ts-prompt-title">No Stocks in ${escapeHtml(formatScopeLabel(currentScope))}</h3>
                        <p class="ts-prompt-desc">Add stocks to your Portfolio or Watchlists to start screening them with institutional technical signals.</p>
                    </div>
                </div>
            `;
            return;
        }

        // Check if on-demand scan is required (not loaded by default)
        if (data.needs_scan) {
            const catName = catMeta ? catMeta.name : 'Technical Signals';
            const tfLabel = currentTimeframe === 'weekly' ? 'Weekly (1W)' : (currentTimeframe === 'monthly' ? 'Monthly (1M)' : 'Daily (1D)');
            container.innerHTML = `
                <div class="ts-scan-prompt-wrap">
                    <div class="ts-scan-prompt-card">
                        <div class="ts-prompt-icon">📡</div>
                        <h3 class="ts-prompt-title">Ready to Scan ${escapeHtml(catName)}</h3>
                        <p class="ts-prompt-desc">Found <strong>${data.total_scanned || 0}</strong> stocks in <strong>${escapeHtml(formatScopeLabel(currentScope))}</strong> for <strong>${escapeHtml(tfLabel)}</strong> timeframe.</p>
                        <p class="ts-prompt-subdesc">Click <strong>Scan Now</strong> to compute real-time technical signals.</p>
                        <button type="button" class="ts-action-btn primary ts-prompt-btn" onclick="triggerTechnicalScreenerScan(true)">
                            <span>🔄</span> <span>Scan Now</span>
                        </button>
                    </div>
                </div>
            `;
            return;
        }

        // If category is planned, show planned roadmap banner
        if (catMeta?.status === 'planned') {
            renderPlannedCategoryView(container, catMeta, data);
            return;
        }

        // Phase 1: Smart Scanners View
        const subgroups = catMeta?.subgroups || [];
        const scannersMap = data.scanners || {};

        let html = '';

        subgroups.forEach(sub => {
            const scIds = sub.screeners || [];
            let totalSubMatches = 0;
            scIds.forEach(id => {
                if (scannersMap[id]?.stocks) {
                    totalSubMatches += scannersMap[id].stocks.length;
                }
            });

            html += `
                <section class="ts-subgroup-block" data-subgroup-id="${escapeHtml(sub.id)}">
                    <header class="ts-subgroup-header">
                        <h3 class="ts-subgroup-title">${escapeHtml(sub.name)}</h3>
                        <span class="ts-subgroup-count">${scIds.length} Scanners · ${totalSubMatches} Matches</span>
                    </header>
                    <div class="ts-screeners-grid">
            `;

            scIds.forEach(scId => {
                const sc = scannersMap[scId];
                if (!sc) return;

                const stocks = sc.stocks || [];
                const matchCount = stocks.length;
                const hasMatches = matchCount > 0;
                const badgeTypeClass = sc.badge_type || 'neutral';

                html += `
                    <div class="ts-screener-card" data-screener-id="${escapeHtml(sc.id)}">
                        <div class="ts-card-top">
                            <div class="ts-card-title-group">
                                <div class="ts-card-title-row">
                                    <span style="font-size: 16px;">${sc.icon || '⚡'}</span>
                                    <h4 class="ts-card-title">${escapeHtml(sc.title)}</h4>
                                    <span class="ts-badge ${badgeTypeClass}">${escapeHtml(sc.badge || 'Signal')}</span>
                                </div>
                                <p class="ts-card-desc">${escapeHtml(sc.description)}</p>
                            </div>
                            <span class="ts-match-pill ${hasMatches ? 'has-matches' : ''}">
                                <span>${matchCount}</span> ${matchCount === 1 ? 'Stock' : 'Stocks'}
                            </span>
                        </div>

                        <!-- Matched Stocks List -->
                        <div class="ts-stocks-list">
                `;

                if (!hasMatches) {
                    html += `
                        <div class="ts-card-empty">
                            <span>🔍 No stocks currently trigger this setup in ${currentScope.toUpperCase()} scope</span>
                        </div>
                    `;
                } else {
                    stocks.forEach(stk => {
                        const sym = stk.symbol || '';
                        const name = stk.name || sym;
                        const ltp = typeof stk.ltp === 'number' ? `₹${stk.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';
                        const chg = typeof stk.change_pct === 'number' ? stk.change_pct : 0;
                        const chgClass = chg >= 0 ? 'pos' : 'neg';
                        const chgSign = chg >= 0 ? '+' : '';
                        const metric = stk.metric || '';

                        html += `
                            <div class="ts-stock-row" data-stock-symbol="${escapeHtml(sym)}" data-stock-name="${escapeHtml(name)}">
                                <div class="ts-stock-meta">
                                    <div class="ts-stock-symbol-row">
                                        <span class="ts-stock-sym" onclick="openTechnicalStockChart('${escapeHtml(sym)}', '${escapeHtml(scId)}')">${escapeHtml(sym)}</span>
                                        <span class="ts-stock-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                                    </div>
                                    ${metric ? `<span class="ts-stock-metric-pill" title="${escapeHtml(metric)}">${escapeHtml(metric)}</span>` : ''}
                                </div>
                                <div class="ts-stock-right">
                                    <span class="ts-stock-ltp">${ltp}</span>
                                    <span class="ts-stock-chg ${chgClass}">${chgSign}${chg.toFixed(2)}%</span>
                                    <div class="ts-stock-actions">
                                        <button type="button" class="ts-mini-btn" onclick="openTechnicalStockChart('${escapeHtml(sym)}', '${escapeHtml(scId)}')">Chart</button>
                                        <button type="button" class="ts-mini-btn" onclick="openFundamentalsSafely('${escapeHtml(sym)}')">Info</button>
                                    </div>
                                </div>
                            </div>
                        `;
                    });
                }

                html += `
                        </div>
                    </div>
                `;
            });

            html += `
                    </div>
                </section>
            `;
        });

        container.innerHTML = html;
    }

    /**
     * Render Planned Phase Roadmaps (Trendlines, Triangles, Channels, NR/WR, Chart Patterns)
     */
    function renderPlannedCategoryView(container, catMeta, data) {
        const catName = catMeta?.name || 'Technical Patterns';
        const phaseNum = catMeta?.phase || 2;
        const icon = catMeta?.icon || '📈';
        const desc = catMeta?.description || '';
        const subgroups = catMeta?.subgroups || [];
        const scannersMap = data.scanners || {};

        let html = `
            <div class="ts-planned-banner">
                <span class="ts-planned-icon">${icon}</span>
                <h3 class="ts-planned-title">${escapeHtml(catName)} — Phase ${phaseNum} Architecture</h3>
                <p class="ts-planned-desc">
                    ${escapeHtml(desc)}. The database schema and hierarchy are initialized in 
                    <code>technical_screener_hierarchy</code> and ready to receive calculated signals in 
                    <code>technical_screener_info</code>.
                </p>
                <div style="display: flex; gap: 10px; align-items: center; margin-top: 6px;">
                    <button type="button" class="ts-action-btn primary" onclick="switchTechnicalScreenerCategory('smart_scanners')">
                        ⚡ Return to Smart Scanners (Phase 1 Active)
                    </button>
                </div>
            </div>
        `;

        // Render planned cards structure
        subgroups.forEach(sub => {
            const scIds = sub.screeners || [];
            html += `
                <section class="ts-subgroup-block" style="margin-top: 24px;">
                    <header class="ts-subgroup-header">
                        <h3 class="ts-subgroup-title">${escapeHtml(sub.name)}</h3>
                        <span class="ts-subgroup-count">${scIds.length} Scanners Planned</span>
                    </header>
                    <div class="ts-screeners-grid">
            `;

            scIds.forEach(scId => {
                const sc = scannersMap[scId] || hierarchyData?.definitions?.[scId];
                if (!sc) return;

                html += `
                    <div class="ts-screener-card">
                        <div class="ts-card-top">
                            <div class="ts-card-title-group">
                                <div class="ts-card-title-row">
                                    <span style="font-size: 16px;">${sc.icon || icon}</span>
                                    <h4 class="ts-card-title">${escapeHtml(sc.title || scId)}</h4>
                                    <span class="ts-badge neutral">Phase ${phaseNum}</span>
                                </div>
                                <p class="ts-card-desc">${escapeHtml(sc.description || '')}</p>
                            </div>
                            <span class="ts-match-pill">Scheduled</span>
                        </div>
                        <div class="ts-card-empty" style="padding: 16px 8px;">
                            <span>Ready for Phase ${phaseNum} Pattern Detection Algorithm</span>
                        </div>
                    </div>
                `;
            });

            html += `
                    </div>
                </section>
            `;
        });

        container.innerHTML = html;
    }

    /**
     * Real-time search filter inside active view
     */
    function filterTechnicalScreenerResults() {
        const input = document.getElementById('ts-search-input');
        if (!input) return;
        const query = input.value.trim().toLowerCase();

        const cards = document.querySelectorAll('.ts-screener-card');
        cards.forEach(card => {
            const title = card.querySelector('.ts-card-title')?.textContent?.toLowerCase() || '';
            const desc = card.querySelector('.ts-card-desc')?.textContent?.toLowerCase() || '';
            const rows = card.querySelectorAll('.ts-stock-row');

            let cardMatches = query === '' || title.includes(query) || desc.includes(query);
            let anyRowVisible = false;

            rows.forEach(row => {
                const sym = row.getAttribute('data-stock-symbol')?.toLowerCase() || '';
                const name = row.getAttribute('data-stock-name')?.toLowerCase() || '';
                const metric = row.querySelector('.ts-stock-metric-pill')?.textContent?.toLowerCase() || '';

                if (query === '' || sym.includes(query) || name.includes(query) || metric.includes(query)) {
                    row.style.display = 'flex';
                    anyRowVisible = true;
                } else {
                    row.style.display = 'none';
                }
            });

            if (cardMatches || anyRowVisible) {
                card.style.display = 'flex';
            } else {
                card.style.display = 'none';
            }
        });
    }

    /**
     * Render Skeleton State
     */
    function renderSkeletons() {
        const container = document.getElementById('ts-scanners-container');
        if (!container) return;
        container.innerHTML = `
            <div class="ts-screeners-grid">
                ${Array(6).fill(0).map(() => `
                    <div class="ts-screener-card ts-skeleton" style="height: 260px; border-radius: 16px;"></div>
                `).join('')}
            </div>
        `;
    }

    /**
     * Render Error State
     */
    function renderError(message) {
        const container = document.getElementById('ts-scanners-container');
        if (!container) return;
        container.innerHTML = `
            <div class="ts-planned-banner" style="border-color: rgba(239, 68, 68, 0.4);">
                <span style="font-size: 32px;">⚠️</span>
                <h3 class="ts-planned-title" style="color: #ef4444;">Unable to Load Technical Screener</h3>
                <p class="ts-planned-desc">${escapeHtml(message)}</p>
                <button type="button" class="ts-action-btn primary" onclick="triggerTechnicalScreenerScan(true)">
                    🔄 Retry Scan
                </button>
            </div>
        `;
    }

    function openTechnicalStockChart(symbol, scannerId) {
        if (!symbol) return;
        const cleanSym = symbol.replace(/\.(NS|BO)$/i, '').toUpperCase();

        let markers = [];
        let drawings = [];
        let indicators = null;
        if (scanResults && scanResults.scanners && scannerId && scanResults.scanners[scannerId]) {
            const sc = scanResults.scanners[scannerId];
            if (Array.isArray(sc.stocks)) {
                const match = sc.stocks.find(s => (s.symbol || '').toUpperCase() === cleanSym);
                if (match) {
                    if (Array.isArray(match.markers)) {
                        markers = match.markers;
                    }
                    if (Array.isArray(match.drawings)) {
                        drawings = match.drawings;
                    }
                    if (match.indicators) {
                        indicators = match.indicators;
                    }
                }
            }
        }

        // Map timeframe to chart interval
        let chartInterval = '1d';
        if (currentTimeframe === 'weekly') chartInterval = '1wk';
        else if (currentTimeframe === 'monthly') chartInterval = '1mo';

        if (typeof window.openInHouseChart === 'function') {
            window.openInHouseChart(cleanSym, chartInterval, markers, drawings, indicators);
        } else if (typeof window.openChart === 'function') {
            window.openChart(cleanSym, chartInterval, markers, drawings, indicators);
        } else {
            console.log('Opening chart for:', cleanSym, chartInterval, markers, drawings, indicators);
        }
    }

    function openStockChartSafely(symbol) {
        openTechnicalStockChart(symbol, null);
    }

    function openFundamentalsSafely(symbol) {
        if (!symbol) return;
        const cleanSym = symbol.replace(/\.(NS|BO)$/i, '').toUpperCase();
        if (typeof window.openFundamentalsModal === 'function') {
            window.openFundamentalsModal(cleanSym);
        } else {
            console.log('Opening fundamentals for:', cleanSym);
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Auto-run if initial tab is technical-screener
    document.addEventListener('DOMContentLoaded', () => {
        if (window.INITIAL_TAB === 'technical-screener') {
            loadTechnicalScreenerModule();
        }
    });

})();
