// =========================================================
// CAPITAL DESK - TRANSACTIONS CONTROLLER (BLOCK / BULK / INSIDER)
// Location: modules/transactions/transactions.js
// Handles SPA rendering, tab switching, filters, sorting,
// date range controls, and official exchange data updates.
// =========================================================

(function () {
    const state = {
        dealType: 'block',       // 'block' | 'bulk' | 'insider'
        scope: 'all',            // 'all' | 'portfolio' | 'watchlist'
        selectedWatchlist: 'watchlist',
        datePreset: 'all',       // 'all' | 'today' | '7d' | '30d' | 'custom'
        fromDate: '',
        toDate: '',
        action: 'all',           // 'all' | 'buy' | 'sell'
        searchQuery: '',
        customQuery: '',         // Custom screener boolean query
        sortField: 'date',
        sortDir: 'desc',
        page: 1,
        perPage: 30,             // Default 30 deals per page
        deals: [],
        filteredDeals: [],
        kpis: {},
        countsByType: {},
        userWatchlists: [],
        isLoading: false,
        lastUpdatedText: 'Just now',
        cooldownRemainingSeconds: 0
    };

    let lastFetchTimestamp = 0;

    window.txState = state;

    // --- 1. Main Data Fetcher ---
    async function fetchTransactions(forceRefresh = false) {
        state.isLoading = true;
        showLoadingState(true);

        const refreshBtn = document.getElementById('tx-btn-refresh');
        if (refreshBtn) {
            refreshBtn.classList.add('spinning');
            refreshBtn.classList.add('refreshing');
        }

        try {
            const params = new URLSearchParams({
                deal_type: state.dealType,
                scope: state.scope === 'watchlist' && state.selectedWatchlist !== 'watchlist' ? state.selectedWatchlist : state.scope,
                action: state.action,
                search: state.searchQuery,
                refresh: forceRefresh ? '1' : '0'
            });

            if (state.customQuery) {
                params.append('custom_query', state.customQuery);
            }

            if (state.fromDate) params.append('from_date', state.fromDate);
            if (state.toDate) params.append('to_date', state.toDate);

            const res = await fetch(`/api/market-transactions?${params.toString()}`);
            if (!res.ok) throw new Error(`HTTP error ${res.status}`);

            const data = await res.json();
            if (data.success) {
                lastFetchTimestamp = Date.now();
                state.deals = data.deals || [];
                state.kpis = data.kpis || {};
                state.countsByType = data.counts_by_type || {};
                state.userWatchlists = data.user_watchlists || [];
                state.lastUpdatedText = data.last_updated || 'Just now';
                state.cooldownRemainingSeconds = data.cooldown_remaining_seconds || 0;

                // Sync date defaults from exchange payload if first load
                if (!state.fromDate && !state.toDate && data.date_range) {
                    const fromInput = document.getElementById('tx-date-from');
                    const toInput = document.getElementById('tx-date-to');
                    if (fromInput && data.date_range.earliest_date) fromInput.value = data.date_range.earliest_date;
                    if (toInput && data.date_range.latest_date) toInput.value = data.date_range.latest_date;
                }

                updateWatchlistDropdown();
                renderView();

                // If user triggered manual refresh, notify on database reload
                if (forceRefresh && typeof window.showToast === 'function') {
                    window.showToast('Transactions data reloaded from database.', 'success', 2500);
                }
            } else {
                console.error('[Transactions] Failed to load:', data.error);
            }
        } catch (err) {
            console.error('[Transactions] Network error fetching deals:', err);
        } finally {
            state.isLoading = false;
            showLoadingState(false);
            if (refreshBtn) {
                refreshBtn.classList.remove('spinning');
                refreshBtn.classList.remove('refreshing');
            }
        }
    }

    // --- 2. View Rendering Engine ---
    function renderView() {
        applyClientFiltersAndSort();
        renderKPIs();
        renderTabBadges();
        renderDesktopTable();
        renderMobileCards();
        renderPagination();

        const updatedTag = document.getElementById('tx-last-updated-tag');
        if (updatedTag) {
            updatedTag.innerHTML = `🕒 Synced: <strong>${escapeHtml(state.lastUpdatedText)}</strong> <span class="tx-cadence-badge" style="opacity: 0.75; font-size: 11px; margin-left: 6px; font-weight: normal;">(Database)</span>`;
        }

        // Update Active Custom Screener Query Banner
        const queryBar = document.getElementById('tx-active-query-bar');
        const queryText = document.getElementById('tx-active-query-text');
        const queryCount = document.getElementById('tx-active-query-count');
        const customBtn = document.getElementById('tx-btn-custom-screener');

        if (state.customQuery) {
            if (queryBar) queryBar.style.display = 'flex';
            if (queryText) queryText.textContent = state.customQuery;
            if (queryCount) queryCount.textContent = `(${state.filteredDeals.length || state.deals.length} deals match)`;
            if (customBtn) customBtn.classList.add('active');
        } else {
            if (queryBar) queryBar.style.display = 'none';
            if (customBtn) customBtn.classList.remove('active');
        }
    }

    function applyClientFiltersAndSort() {
        let list = [...state.deals];

        // Promoter Buying filter: strictly official promoter/promoter group acquisitions
        if (state.dealType === 'promoter') {
            list = list.filter(d =>
                (d.deal_type === 'insider' || !d.deal_type) &&
                (d.person_category || '').toLowerCase().includes('promoter') &&
                (d.action || '').toUpperCase() === 'BUY'
            );
        }

        // Search text filter
        if (state.searchQuery) {
            const q = state.searchQuery.toLowerCase().trim();
            list = list.filter(d =>
                (d.symbol && d.symbol.toLowerCase().includes(q)) ||
                (d.company && d.company.toLowerCase().includes(q)) ||
                (d.client_name && d.client_name.toLowerCase().includes(q)) ||
                (d.person_category && d.person_category.toLowerCase().includes(q))
            );
        }

        // Action direction filter
        if (state.action !== 'all') {
            list = list.filter(d => (d.action || '').toLowerCase() === state.action);
        }

        // Sort items
        list.sort((a, b) => {
            let valA = a[state.sortField];
            let valB = b[state.sortField];

            if (state.sortField === 'date') {
                valA = valA || '';
                valB = valB || '';
            } else if (state.sortField === 'value' || state.sortField === 'quantity' || state.sortField === 'price') {
                valA = Number(valA) || 0;
                valB = Number(valB) || 0;
            } else {
                valA = String(valA || '').toLowerCase();
                valB = String(valB || '').toLowerCase();
            }

            if (valA < valB) return state.sortDir === 'asc' ? -1 : 1;
            if (valA > valB) return state.sortDir === 'asc' ? 1 : -1;
            return 0;
        });

        state.filteredDeals = list;
    }

    function renderKPIs() {
        const kpis = state.kpis || {};
        const totalDealsEl = document.getElementById('tx-kpi-total-deals');
        const buyValEl = document.getElementById('tx-kpi-buy-val');
        const buyCountEl = document.getElementById('tx-kpi-buy-count');
        const sellValEl = document.getElementById('tx-kpi-sell-val');
        const sellCountEl = document.getElementById('tx-kpi-sell-count');
        const netValEl = document.getElementById('tx-kpi-net-val');
        const netDirEl = document.getElementById('tx-kpi-net-direction');
        const netIconEl = document.getElementById('tx-kpi-net-icon');

        if (totalDealsEl) totalDealsEl.innerText = state.filteredDeals.length.toLocaleString();
        if (buyValEl) buyValEl.innerText = kpis.buy_value_formatted || '₹0.00 Cr';
        if (buyCountEl) buyCountEl.innerText = `${kpis.buy_count || 0} Buy Deals`;
        if (sellValEl) sellValEl.innerText = kpis.sell_value_formatted || '₹0.00 Cr';
        if (sellCountEl) sellCountEl.innerText = `${kpis.sell_count || 0} Sell Deals`;

        if (netValEl) {
            netValEl.innerText = kpis.net_value_formatted || '₹0.00 Cr';
            netValEl.className = 'tx-kpi-value ' + (kpis.net_direction === 'BUY' ? 'text-buy' : 'text-sell');
        }
        if (netDirEl) {
            netDirEl.innerText = kpis.net_direction === 'BUY' ? 'Net Buying Inflow' : 'Net Selling Outflow';
        }
        if (netIconEl) {
            netIconEl.innerText = kpis.net_direction === 'BUY' ? '📈' : '📉';
        }
    }

    function renderTabBadges() {
        const counts = state.countsByType || {};
        const blockBadge = document.getElementById('tx-count-block');
        const bulkBadge = document.getElementById('tx-count-bulk');
        const insiderBadge = document.getElementById('tx-count-insider');
        const promoterBadge = document.getElementById('tx-count-promoter');

        if (blockBadge) blockBadge.innerText = counts.block || 0;
        if (bulkBadge) bulkBadge.innerText = counts.bulk || 0;
        if (insiderBadge) insiderBadge.innerText = counts.insider || 0;
        if (promoterBadge) promoterBadge.innerText = counts.promoter || 0;

        document.querySelectorAll('.tx-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === state.dealType);
        });

        // Dynamic column header adjustments for Promoter Buying vs Insider vs Block/Bulk
        const thClientText = document.getElementById('tx-th-client-text');
        const thClient = document.getElementById('tx-th-client');
        const thCategory = document.getElementById('tx-th-category');
        const targetClientEl = thClientText || thClient;
        if (targetClientEl) {
            if (state.dealType === 'promoter') {
                targetClientEl.innerText = 'Promoter / Buyer';
            } else if (state.dealType === 'insider') {
                targetClientEl.innerText = 'Acquirer / Disposer';
            } else {
                targetClientEl.innerText = 'Client / Institutional Party';
            }
        }
        if (thCategory) {
            if (state.dealType === 'promoter') {
                thCategory.style.display = 'none';
            } else if (state.dealType === 'insider') {
                thCategory.style.display = '';
                thCategory.innerText = 'Relationship / Role';
            } else {
                thCategory.style.display = '';
                thCategory.innerText = 'Category / Mode';
            }
        }
    }

    function updateWatchlistDropdown() {
        const wrapper = document.getElementById('tx-watchlist-dropdown-wrapper');
        const select = document.getElementById('tx-watchlist-select');
        if (!wrapper || !select) return;

        if (state.scope === 'watchlist') {
            wrapper.style.display = 'inline-flex';
            let html = '<option value="watchlist">All Watchlists</option>';
            state.userWatchlists.forEach(w => {
                const selected = state.selectedWatchlist === w ? 'selected' : '';
                html += `<option value="${escapeHtml(w)}" ${selected}>${escapeHtml(w)}</option>`;
            });
            select.innerHTML = html;
        } else {
            wrapper.style.display = 'none';
        }
    }

    // --- 3. Desktop Table View ---
    function renderDesktopTable() {
        const tbody = document.getElementById('tx-table-tbody');
        const emptyState = document.getElementById('tx-empty-state');
        if (!tbody) return;

        if (state.filteredDeals.length === 0) {
            tbody.innerHTML = '';
            if (emptyState) emptyState.style.display = 'block';
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        const pagedDeals = getPagedDeals();
        let html = '';

        pagedDeals.forEach(deal => {
            const isBuy = (deal.action || '').toUpperCase() === 'BUY';
            const actionClass = isBuy ? 'tx-action-buy' : 'tx-action-sell';
            const actionText = isBuy ? '+ BUY' : '- SELL';
            const valClass = isBuy ? 'text-buy' : 'text-sell';
            const isPromoter = (deal.person_category || '').toLowerCase().includes('promoter') || state.dealType === 'promoter';
            const catBadgeClass = isPromoter ? 'tx-category-badge tx-badge-promoter' : 'tx-category-badge';
            const catIcon = isPromoter ? '👑 ' : '';
            const filingLink = deal.filing_url
                ? `<a href="${deal.filing_url}" target="_blank" rel="noopener noreferrer" class="tx-source-link" title="Open official XBRL filing">Filing ↗</a>`
                : `<span style="font-size: 11px; color: var(--text-secondary);">${escapeHtml(deal.source || 'NSE')}</span>`;

            let valTitle = `₹${deal.value ? Number(deal.value).toLocaleString() : '0'}`;
            if (!deal.value && deal.quantity) {
                valTitle = `Consideration ₹0 (${escapeHtml(deal.mode || 'Disclosed Deal')})`;
            }

            const isPromoterTab = (state.dealType === 'promoter');
            let clientColHtml = '';
            let categoryColHtml = '';

            if (isPromoterTab) {
                clientColHtml = `
                <td class="tx-client-cell" title="${escapeHtml(deal.client_name || '')}">
                    <div class="tx-client-name">${escapeHtml(deal.client_name || 'Undisclosed Client')}</div>
                    <div class="tx-client-sub">
                        <span class="${catBadgeClass}">${catIcon}${escapeHtml(deal.person_category || 'Promoter')}</span>
                    </div>
                </td>`;
                categoryColHtml = '';
            } else {
                clientColHtml = `
                <td class="tx-client-cell" title="${escapeHtml(deal.client_name || '')}">
                    <div class="tx-client-name">${escapeHtml(deal.client_name || 'Undisclosed Client')}</div>
                </td>`;
                categoryColHtml = `
                <td>
                    <span class="${catBadgeClass}" title="${escapeHtml(deal.mode || '')}">
                        ${catIcon}${escapeHtml(deal.person_category || deal.mode || 'Market Trade')}
                    </span>
                </td>`;
            }

            html += `
            <tr>
                <td class="tx-date-cell">
                    <div class="tx-date-primary">${escapeHtml(deal.date_display || deal.date || '-')}</div>
                    <div class="tx-date-time">${escapeHtml(deal.time_display || '')}</div>
                </td>
                <td>
                    <div class="tx-stock-cell">
                        <div class="tx-stock-top-row">
                            <a href="javascript:void(0)" class="tx-stock-ticker" onclick="window.openTxStockFundamentals('${deal.symbol}')" title="Open fundamentals for ${escapeHtml(cleanDisplaySymbol(deal.symbol))}">
                                ${escapeHtml(cleanDisplaySymbol(deal.symbol))} <span class="tx-exch-tag">NSE</span>
                            </a>
                        </div>
                        <a href="javascript:void(0)" class="tx-stock-name" onclick="window.openTxStockFundamentals('${deal.symbol}')" title="Open fundamentals for ${escapeHtml(deal.company || cleanDisplaySymbol(deal.symbol))}">
                            ${escapeHtml(deal.company || cleanDisplaySymbol(deal.symbol))}
                        </a>
                    </div>
                </td>
                ${clientColHtml}
                ${categoryColHtml}
                <td class="text-center">
                    <span class="tx-action-pill ${actionClass}">${actionText}</span>
                </td>
                <td class="text-right tx-val-cell ${valClass}" title="${valTitle}">
                    ${deal.value_formatted || '₹0.00'}
                </td>
                <td class="text-right" style="font-family: 'Plus Jakarta Sans', var(--font-sans); font-weight: 600;">
                    ₹${deal.price ? deal.price.toFixed(2) : '0.00'}
                </td>
                <td class="text-right" style="font-family: 'Plus Jakarta Sans', var(--font-sans); font-weight: 600;">
                    ${deal.quantity ? deal.quantity.toLocaleString() : '-'}
                </td>
                <td class="text-center">
                    ${filingLink}
                </td>
            </tr>`;
        });

        tbody.innerHTML = html;
        updateSortIndicators();
    }

    // --- 4. Mobile Responsive Cards View (<= 768px) ---
    function renderMobileCards() {
        const container = document.getElementById('tx-mobile-cards-list');
        if (!container) return;

        if (state.filteredDeals.length === 0) {
            container.innerHTML = '';
            return;
        }

        const pagedDeals = getPagedDeals();
        let html = '';

        pagedDeals.forEach(deal => {
            const isBuy = (deal.action || '').toUpperCase() === 'BUY';
            const actionClass = isBuy ? 'tx-action-buy' : 'tx-action-sell';
            const actionText = isBuy ? '+ BUY' : '- SELL';
            const valClass = isBuy ? 'text-buy' : 'text-sell';
            const isPromoter = (deal.person_category || '').toLowerCase().includes('promoter') || state.dealType === 'promoter';
            const catBadgeClass = isPromoter ? 'tx-category-badge tx-badge-promoter' : 'tx-category-badge';
            const catIcon = isPromoter ? '👑 ' : '';

            html += `
            <div class="tx-card-item" onclick="window.openTxStockFundamentals('${deal.symbol}')" title="Open fundamentals for ${escapeHtml(deal.company || cleanDisplaySymbol(deal.symbol))}">
                <div class="tx-card-header">
                    <div class="tx-card-stock">
                        <span class="tx-card-ticker">${escapeHtml(cleanDisplaySymbol(deal.symbol))}</span>
                        <span class="tx-exch-tag">NSE</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="tx-action-pill ${actionClass}">${actionText}</span>
                        <span class="tx-card-date">${escapeHtml(deal.date_display || deal.date || '')}</span>
                    </div>
                </div>

                <div class="tx-card-company-row">
                    <div class="tx-card-company" title="Open fundamentals for ${escapeHtml(deal.company || cleanDisplaySymbol(deal.symbol))}">
                        ${escapeHtml(deal.company || cleanDisplaySymbol(deal.symbol))}
                    </div>
                </div>

                <div class="tx-card-party-row">
                    <span class="tx-card-client-name" title="${escapeHtml(deal.client_name || '')}">
                        ${escapeHtml(deal.client_name || 'Undisclosed Client')}
                    </span>
                    <span class="${catBadgeClass}">${catIcon}${escapeHtml(deal.person_category || deal.mode || 'Market Trade')}</span>
                </div>

                <div class="tx-card-stats-grid">
                    <div class="tx-card-stat-box">
                        <span class="tx-card-stat-label">TOTAL VALUE</span>
                        <span class="tx-card-stat-val ${valClass}">${deal.value_formatted || '₹0.00'}</span>
                    </div>
                    <div class="tx-card-stat-box">
                        <span class="tx-card-stat-label">AVG PRICE</span>
                        <span class="tx-card-stat-val">₹${deal.price ? deal.price.toFixed(2) : '0.00'}</span>
                    </div>
                    <div class="tx-card-stat-box">
                        <span class="tx-card-stat-label">QUANTITY</span>
                        <span class="tx-card-stat-val">${deal.quantity ? deal.quantity.toLocaleString() : '-'}</span>
                    </div>
                </div>
            </div>`;
        });

        container.innerHTML = html;
    }

    // --- 5. Pagination Helpers ---
    function getPagedDeals() {
        if (state.perPage === 'all') return state.filteredDeals;
        const per = Number(state.perPage) || 30;
        const start = (state.page - 1) * per;
        return state.filteredDeals.slice(start, start + per);
    }

    function renderPagination() {
        const paginationBar = document.getElementById('tx-pagination-bar');
        const infoEl = document.getElementById('tx-pagination-info');
        const buttonsEl = document.getElementById('tx-page-buttons');
        if (!paginationBar || !infoEl || !buttonsEl) return;

        const total = state.filteredDeals.length;
        if (total === 0) {
            paginationBar.style.display = 'none';
            return;
        }

        paginationBar.style.display = 'flex';

        const per = Number(state.perPage) || 30;
        const totalPages = Math.ceil(total / per);
        const start = (state.page - 1) * per + 1;
        const end = Math.min(state.page * per, total);

        infoEl.innerText = `Showing ${start}-${end} of ${total.toLocaleString()} deals`;

        let btnHtml = '';
        if (totalPages > 1) {
            btnHtml += `<button type="button" class="tx-page-btn" ${state.page <= 1 ? 'disabled' : ''} onclick="changeTxPage(${state.page - 1})">‹ Prev</button>`;

            const maxButtons = 5;
            let startPage = Math.max(1, state.page - 2);
            let endPage = Math.min(totalPages, startPage + maxButtons - 1);
            if (endPage - startPage < maxButtons - 1) {
                startPage = Math.max(1, endPage - maxButtons + 1);
            }

            for (let p = startPage; p <= endPage; p++) {
                btnHtml += `<button type="button" class="tx-page-btn ${p === state.page ? 'active' : ''}" onclick="changeTxPage(${p})">${p}</button>`;
            }

            btnHtml += `<button type="button" class="tx-page-btn" ${state.page >= totalPages ? 'disabled' : ''} onclick="changeTxPage(${state.page + 1})">Next ›</button>`;
        }
        buttonsEl.innerHTML = btnHtml;
    }

    function updateSortIndicators() {
        ['date', 'symbol', 'client_name', 'quantity', 'price', 'value'].forEach(field => {
            const ind = document.getElementById(`sort-ind-${field}`);
            if (ind) {
                if (state.sortField === field) {
                    ind.innerText = state.sortDir === 'asc' ? '▲' : '▼';
                    ind.style.opacity = '1';
                } else {
                    ind.innerText = '';
                    ind.style.opacity = '0.3';
                }
            }
        });
    }

    function showLoadingState(show) {
        const loader = document.getElementById('tx-loader-container');
        const content = document.getElementById('tx-content-wrapper');
        if (loader) {
            if (show) {
                loader.style.display = 'flex';
                if (typeof window.createBrandLoaderHTML === 'function') {
                    loader.innerHTML = window.createBrandLoaderHTML({
                        title: 'Fetching Official Exchange Deals...',
                        subtitle: 'Querying Block Deals, Bulk Deals & SEBI PIT Insider Disclosures'
                    });
                }
            } else {
                loader.style.display = 'none';
            }
        }
    }

    // --- 6. Event Handlers & Global Methods ---
    window.loadTransactionsModule = function (forceRefresh = false) {
        if (forceRefresh || !state.deals || state.deals.length === 0) {
            fetchTransactions(forceRefresh);
        } else {
            renderView();
        }
    };

    window.refreshTransactionsData = function (forceRefresh = true) {
        fetchTransactions(forceRefresh);
    };

    window.switchTxTab = function (dealType) {
        if (state.dealType === dealType) return;
        state.dealType = dealType;
        state.page = 1;
        fetchTransactions(false);
    };

    window.setTxScope = function (scope) {
        state.scope = scope;
        state.page = 1;
        document.querySelectorAll('.tx-toolbar [data-scope]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-scope') === scope);
        });
        updateWatchlistDropdown();
        fetchTransactions(false);
    };

    window.handleTxWatchlistChange = function (val) {
        state.selectedWatchlist = val;
        state.page = 1;
        fetchTransactions(false);
    };

    window.setTxDatePreset = function (preset) {
        state.datePreset = preset;
        document.querySelectorAll('.tx-date-preset-pills [data-preset]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-preset') === preset);
        });

        const fromInput = document.getElementById('tx-date-from');
        const toInput = document.getElementById('tx-date-to');

        const now = new Date();
        const formatDate = (d) => d.toISOString().split('T')[0];

        if (preset === 'all') {
            state.fromDate = '';
            state.toDate = '';
            if (fromInput) fromInput.value = '';
            if (toInput) toInput.value = '';
        } else if (preset === 'today') {
            const todayStr = formatDate(now);
            state.fromDate = todayStr;
            state.toDate = todayStr;
            if (fromInput) fromInput.value = todayStr;
            if (toInput) toInput.value = todayStr;
        } else if (preset === '7d') {
            const past7 = new Date();
            past7.setDate(now.getDate() - 7);
            state.fromDate = formatDate(past7);
            state.toDate = formatDate(now);
            if (fromInput) fromInput.value = state.fromDate;
            if (toInput) toInput.value = state.toDate;
        } else if (preset === '30d') {
            const past30 = new Date();
            past30.setDate(now.getDate() - 30);
            state.fromDate = formatDate(past30);
            state.toDate = formatDate(now);
            if (fromInput) fromInput.value = state.fromDate;
            if (toInput) toInput.value = state.toDate;
        }

        state.page = 1;
        fetchTransactions(false);
    };

    window.applyTxDateFilter = function () {
        const fromInput = document.getElementById('tx-date-from');
        const toInput = document.getElementById('tx-date-to');
        state.fromDate = fromInput ? fromInput.value : '';
        state.toDate = toInput ? toInput.value : '';
        state.datePreset = 'custom';

        document.querySelectorAll('.tx-date-preset-pills [data-preset]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-preset') === 'custom');
        });

        state.page = 1;
        fetchTransactions(false);
    };

    window.clearTxDateFilter = function () {
        setTxDatePreset('all');
    };

    window.applyTxFilters = function () {
        const fromInput = document.getElementById('tx-date-from');
        const toInput = document.getElementById('tx-date-to');
        if (fromInput) state.fromDate = fromInput.value;
        if (toInput) state.toDate = toInput.value;
        const searchInput = document.getElementById('tx-search-input');
        if (searchInput) state.searchQuery = searchInput.value;
        state.page = 1;
        fetchTransactions(false);
    };

    window.resetTxFilters = function () {
        window.resetAllTxFilters();
    };

    window.handleTxDateInputChange = function () {
        const fromInput = document.getElementById('tx-date-from');
        const toInput = document.getElementById('tx-date-to');
        state.fromDate = fromInput ? fromInput.value : '';
        state.toDate = toInput ? toInput.value : '';
        state.datePreset = 'custom';

        document.querySelectorAll('.tx-date-preset-pills [data-preset]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-preset') === 'custom');
        });

        state.page = 1;
        fetchTransactions(false);
    };

    window.setTxAction = function (action) {
        state.action = action;
        state.page = 1;
        document.querySelectorAll('.tx-toolbar [data-action]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-action') === action);
        });
        renderView();
    };

    let searchTimer = null;
    window.handleTxSearch = function (query) {
        const clearBtn = document.getElementById('tx-search-clear');
        if (clearBtn) clearBtn.style.display = query ? 'inline-block' : 'none';

        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            state.searchQuery = query;
            state.page = 1;
            renderView();
        }, 220);
    };

    window.clearTxSearch = function () {
        const input = document.getElementById('tx-search-input');
        if (input) input.value = '';
        handleTxSearch('');
    };

    window.handleTxSort = function (field) {
        if (state.sortField === field) {
            state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            state.sortField = field;
            state.sortDir = (field === 'symbol' || field === 'client_name') ? 'asc' : 'desc';
        }
        renderView();
    };

    window.handleTxPerPageChange = function (val) {
        state.perPage = Number(val) || 30;
        state.page = 1;
        renderView();
    };

    window.changeTxPage = function (page) {
        state.page = page;
        renderView();
        const tableContainer = document.querySelector('.tx-table-container');
        if (tableContainer) tableContainer.scrollTop = 0;
        const content = document.getElementById('tx-content-wrapper');
        if (content) content.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    window.resetAllTxFilters = function () {
        state.scope = 'all';
        state.datePreset = 'all';
        state.fromDate = '';
        state.toDate = '';
        state.action = 'all';
        state.searchQuery = '';
        state.customQuery = '';
        state.page = 1;

        const customModalInput = document.getElementById('tx-custom-query-input');
        if (customModalInput) customModalInput.value = '';
        const queryBar = document.getElementById('tx-active-query-bar');
        if (queryBar) queryBar.style.display = 'none';
        const customBtn = document.getElementById('tx-btn-custom-screener');
        if (customBtn) customBtn.classList.remove('active');

        const searchInput = document.getElementById('tx-search-input');
        if (searchInput) searchInput.value = '';

        const fromInput = document.getElementById('tx-date-from');
        const toInput = document.getElementById('tx-date-to');
        if (fromInput) fromInput.value = '';
        if (toInput) toInput.value = '';

        document.querySelectorAll('.tx-toolbar [data-scope]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-scope') === 'all');
        });
        document.querySelectorAll('.tx-toolbar [data-action]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-action') === 'all');
        });
        document.querySelectorAll('.tx-date-preset-pills [data-preset]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-preset') === 'all');
        });

        fetchTransactions(false);
    };

    window.openTxStockChart = function (symbol) {
        if (!symbol) return;
        const clean = cleanDisplaySymbol(symbol).trim();
        if (typeof window.openChart === 'function') {
            window.openChart(clean);
        } else if (typeof window.openInHouseChart === 'function') {
            window.openInHouseChart(clean);
        } else {
            console.log('Open chart for symbol:', clean);
        }
    };

    window.openTxStockFundamentals = function (symbol) {
        if (!symbol) return;
        const clean = cleanDisplaySymbol(symbol).trim();
        if (typeof window.openFundamentalsModal === 'function') {
            window.openFundamentalsModal(clean);
        } else if (typeof openFundamentalsModal === 'function') {
            openFundamentalsModal(clean);
        } else if (typeof window.openStockFundamentals === 'function') {
            window.openStockFundamentals(clean);
        } else {
            console.log('Open fundamentals for symbol:', clean);
        }
    };


    // =========================================================
    // CUSTOM TRANSACTIONS SCREENER MODAL CONTROLLER
    // =========================================================
    let txQueryValidationTimer = null;

    window.openTxCustomModal = function () {
        const modal = document.getElementById('tx-custom-modal');
        if (!modal) return;
        const input = document.getElementById('tx-custom-query-input');
        if (input) {
            input.value = state.customQuery || '';
        }
        modal.style.display = 'flex';
        if (typeof window.bringModalToFront === 'function') {
            window.bringModalToFront(modal);
        }
        if (state.customQuery) {
            validateTxQueryDebounced();
        } else {
            const feedback = document.getElementById('tx-custom-query-feedback');
            if (feedback) feedback.style.display = 'none';
            const badge = document.getElementById('tx-apply-count-badge');
            if (badge) badge.style.display = 'none';
        }
        if (typeof window.initCustomQueryManager === 'function' && !window._customQueryManagers['transactions']) {
            window.initCustomQueryManager({
                moduleName: 'transactions',
                prefix: 'tx',
                textareaId: 'tx-custom-query-input',
                selectId: 'tx-saved-queries-select',
                saveBtnId: 'tx-save-query-btn',
                renameBtnId: 'tx-rename-query-btn',
                deleteBtnId: 'tx-delete-query-btn',
                clearBtnId: 'tx-custom-clear-input',
                onSelectQuery: () => {
                    if (typeof validateTxQueryDebounced === 'function') {
                        validateTxQueryDebounced();
                    }
                }
            });
        }
        if (window._customQueryManagers && window._customQueryManagers['transactions']) {
            window._customQueryManagers['transactions'].loadQueries();
        }

        setTimeout(() => {
            if (input) input.focus();
        }, 80);
    };

    window.closeTxCustomModal = function () {
        const modal = document.getElementById('tx-custom-modal');
        if (modal) modal.style.display = 'none';
        const popover = document.getElementById('tx-deal-fields-popover');
        if (popover) popover.style.display = 'none';
    };

    window.insertTxTokenAtCursor = function (token) {
        const input = document.getElementById('tx-custom-query-input');
        if (!input) return;
        input.focus();
        const start = input.selectionStart || 0;
        const end = input.selectionEnd || 0;
        const text = input.value;

        const before = text.substring(0, start);
        const after = text.substring(end);

        let prefix = '';
        let suffix = '';

        if (before.length > 0 && !/[\s(]/.test(before.slice(-1))) {
            prefix = ' ';
        }

        if (token === '(') {
            suffix = '';
        } else if (token === ')') {
            suffix = ' ';
        } else {
            suffix = ' ';
        }

        const insert = prefix + token + suffix;
        input.value = before + insert + after;
        const newPos = start + insert.length;
        input.setSelectionRange(newPos, newPos);
        validateTxQueryDebounced();
    };

    window.validateTxQueryDebounced = function () {
        clearTimeout(txQueryValidationTimer);
        const feedback = document.getElementById('tx-custom-query-feedback');
        const badge = document.getElementById('tx-apply-count-badge');
        const input = document.getElementById('tx-custom-query-input');
        const query = input ? input.value.trim() : '';

        if (!query) {
            if (feedback) feedback.style.display = 'none';
            if (badge) badge.style.display = 'none';
            return;
        }

        txQueryValidationTimer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/market-transactions/validate-query?query=${encodeURIComponent(query)}`);
                const data = await res.json();
                if (data.valid) {
                    if (feedback) {
                        feedback.style.display = 'block';
                        feedback.className = 'tx-query-feedback valid';
                        feedback.innerHTML = `✓ <strong>Syntax Valid:</strong> ${data.match_count.toLocaleString()} deals match this criteria.`;
                    }
                    if (badge) {
                        badge.style.display = 'inline-block';
                        badge.textContent = `${data.match_count} deals`;
                    }
                } else {
                    if (feedback) {
                        feedback.style.display = 'block';
                        feedback.className = 'tx-query-feedback error';
                        feedback.innerHTML = `✕ <strong>Syntax Error:</strong> ${escapeHtml(data.error || 'Invalid query expression')}`;
                    }
                    if (badge) badge.style.display = 'none';
                }
            } catch (err) {
                if (feedback) {
                    feedback.style.display = 'block';
                    feedback.className = 'tx-query-feedback error';
                    feedback.textContent = `Validation error: ${err.message}`;
                }
            }
        }, 180);
    };

    window.applyTxCustomModalQuery = function () {
        const input = document.getElementById('tx-custom-query-input');
        const query = input ? input.value.trim() : '';
        state.customQuery = query;
        state.page = 1;
        closeTxCustomModal();
        fetchTransactions(false);
    };

    window.applyTxFiltersAndScreener = function () {
        state.page = 1;
        fetchTransactions(false);
    };

    window.clearTxCustomQuery = function () {
        state.customQuery = '';
        state.page = 1;
        const input = document.getElementById('tx-custom-query-input');
        if (input) input.value = '';
        fetchTransactions(false);
    };

    window.resetTxModalQuery = function () {
        const input = document.getElementById('tx-custom-query-input');
        if (input) input.value = '';
        const feedback = document.getElementById('tx-custom-query-feedback');
        if (feedback) feedback.style.display = 'none';
        const badge = document.getElementById('tx-apply-count-badge');
        if (badge) badge.style.display = 'none';
    };

    // Global event listeners for modal interactions
    document.addEventListener('click', (e) => {
        // Preset cards click
        const presetCard = e.target.closest('.tx-preset-card');
        if (presetCard) {
            const query = presetCard.getAttribute('data-preset');
            const input = document.getElementById('tx-custom-query-input');
            if (input && query) {
                input.value = query;
                input.focus();
                validateTxQueryDebounced();
            }
            return;
        }

        // Token chips click
        const tokenChip = e.target.closest('.tx-token-chip');
        if (tokenChip) {
            const token = tokenChip.getAttribute('data-token');
            if (token) {
                insertTxTokenAtCursor(token);
            }
            return;
        }

        // Clear query input button in modal
        if (e.target.closest('#tx-custom-clear-input')) {
            const input = document.getElementById('tx-custom-query-input');
            if (input) {
                input.value = '';
                input.focus();
                validateTxQueryDebounced();
            }
            return;
        }

        // Close on modal backdrop click
        if (e.target && e.target.classList && e.target.classList.contains('tx-custom-modal-backdrop')) {
            closeTxCustomModal();
        }
    });

    // Support Ctrl+Enter in modal query textarea
    document.addEventListener('keydown', (e) => {
        if (e.target && e.target.id === 'tx-custom-query-input') {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                applyTxCustomModalQuery();
            } else if (e.key === 'Escape') {
                closeTxCustomModal();
            }
        }
    });

    // Realtime input listener for textarea
    document.addEventListener('input', (e) => {
        if (e.target && e.target.id === 'tx-custom-query-input') {
            validateTxQueryDebounced();
        }
    });

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Auto-init on DOMContentLoaded if starting on transactions tab or /transactions route
    document.addEventListener('DOMContentLoaded', () => {
        if (window.INITIAL_TAB === 'transactions' || window.currentTab === 'transactions' || window.location.pathname === '/transactions') {
            if (typeof window.switchTab === 'function') {
                window.switchTab('transactions', false);
            }
            loadTransactionsModule();
        }
    });

    // ==========================================
    // DEAL FIELDS REAL DATA POPOVER CONTROLLER
    // ==========================================
    let popoverHideTimer = null;

    function getRepresentativeDeal() {
        if (state.deals && state.deals.length > 0) {
            // Find a deal with non-zero values and valid client
            const candidate = state.deals.find(d => Number(d.value) > 0 && Number(d.price) > 0 && d.client_name && d.client_name.length > 2);
            if (candidate) return candidate;
            return state.deals[0];
        }
        return {
            symbol: "HATSUN",
            company: "Hatsun Agro Product Ltd.",
            deal_type: "block",
            deal_type_label: "Block Deal",
            action: "BUY",
            value: 983400000,
            value_formatted: "₹98.34 Cr",
            price: 1192.00,
            quantity: 825000,
            client_name: "CHANDRAMOGAN R G",
            person_category: "Institutional / HNI",
            date: "2026-09-01",
            date_display: "01 Sep 2026"
        };
    }

    let lastMouseCoords = { x: 0, y: 0 };

    window.handleDealFieldsMouseMove = function (e) {
        if (e && typeof e.clientX === 'number') {
            lastMouseCoords.x = e.clientX;
            lastMouseCoords.y = e.clientY;
        }
    };

    function renderDealFieldsPopover() {
        const tbody = document.getElementById('tx-popover-tbody');
        const queryCode = document.getElementById('tx-popover-query-code');
        if (!tbody) return;

        // Comprehensive real examples per field covering all actions, types, and categories
        const fieldsData = [
            {
                field: 'action',
                examples: [
                    { label: '🟢 BUY', class: 'tx-popover-badge-buy', desc: 'Buy transaction (2,157 in DB)' },
                    { label: '🔴 SELL', class: 'tx-popover-badge-sell', desc: 'Sell transaction (1,864 in DB)' }
                ],
                syntaxes: [
                    "action == 'BUY'",
                    "action == 'SELL'"
                ]
            },
            {
                field: 'type',
                examples: [
                    { label: '🏢 Block', desc: 'Block Deals (300 in DB)' },
                    { label: '📦 Bulk', desc: 'Bulk Deals (663 in DB)' },
                    { label: '🕵️ Insider', desc: 'Insider Deals (3,058 in DB)' }
                ],
                syntaxes: [
                    "type == 'block'",
                    "type == 'bulk'",
                    "type == 'insider'"
                ]
            },
            {
                field: 'category',
                examples: [
                    { label: '👑 Promoters' },
                    { label: '👥 Promoter Group' },
                    { label: '🏦 Institutional / HNI' },
                    { label: '👔 Director' },
                    { label: '🗝️ Key Managerial' },
                    { label: '💼 Employees' },
                    { label: '👪 Relative' }
                ],
                syntaxes: [
                    "category contains 'Promoter'",
                    "category contains 'Institutional'",
                    "category contains 'Director'",
                    "category contains 'Key Managerial'"
                ]
            },
            {
                field: 'value',
                examples: [
                    { label: '₹660.80 Cr' },
                    { label: '₹149.84 Cr' },
                    { label: '₹98.34 Cr' },
                    { label: '₹50.23 Cr' }
                ],
                syntaxes: [
                    "value >= 10",
                    "value >= 25",
                    "value >= 50",
                    "value >= 100"
                ]
            },
            {
                field: 'qty',
                examples: [
                    { label: '4,953,560 shs' },
                    { label: '2,651,975 shs' },
                    { label: '825,000 shs' }
                ],
                syntaxes: [
                    "qty >= 100000",
                    "qty >= 500000",
                    "qty >= 1000000"
                ]
            },
            {
                field: 'price',
                examples: [
                    { label: '₹1,334.00' },
                    { label: '₹1,192.00' },
                    { label: '₹565.00' },
                    { label: '₹75.59' }
                ],
                syntaxes: [
                    "price >= 500",
                    "price >= 1000",
                    "price < 200"
                ]
            },
            {
                field: 'symbol',
                examples: [
                    { label: 'GALLANTT' },
                    { label: 'HATSUN' },
                    { label: 'ADANIENSOL' },
                    { label: 'TCS' }
                ],
                syntaxes: [
                    "symbol == 'GALLANTT'",
                    "symbol in ('TCS', 'INFY')"
                ]
            },
            {
                field: 'client',
                examples: [
                    { label: 'LARSEN & TOUBRO' },
                    { label: 'BOFA SECURITIES' },
                    { label: 'PI OPPORTUNITIES' },
                    { label: 'MUTUAL FUND' }
                ],
                syntaxes: [
                    "client contains 'MUTUAL'",
                    "client contains 'SECURITIES'",
                    "client contains 'LARSEN'"
                ]
            },
            {
                field: 'mode',
                examples: [
                    { label: 'Market Purchase' },
                    { label: 'Off Market' },
                    { label: 'Market Sale' }
                ],
                syntaxes: [
                    "mode contains 'Market'",
                    "mode contains 'Off Market'"
                ]
            }
        ];

        tbody.innerHTML = fieldsData.map(f => `
            <tr>
                <td class="field-name"><strong>${escapeHtml(f.field)}</strong></td>
                <td class="field-val">
                    <div class="tx-popover-pills-list">
                        ${f.examples.map(ex => `
                            <span class="tx-popover-pill ${ex.class || ''}" title="${escapeHtml(ex.desc || ex.label)}">
                                ${escapeHtml(ex.label)}
                            </span>
                        `).join('')}
                    </div>
                </td>
                <td>
                    <div class="tx-popover-pills-list">
                        ${f.syntaxes.map(syn => `
                            <button type="button" class="tx-popover-pill tx-popover-pill-code" 
                                    data-syntax="${escapeHtml(syn)}"
                                    onclick="window.insertPopoverSyntax && window.insertPopoverSyntax(this)"
                                    title="Click to insert into query">
                                <code>${escapeHtml(syn)}</code>
                            </button>
                        `).join('')}
                    </div>
                </td>
            </tr>
        `).join('');

        if (queryCode) {
            queryCode.innerText = "value >= 25 and action == 'BUY' and type == 'block'";
        }
    }

    window.insertPopoverSyntax = function (btn) {
        if (!btn) return;
        const syn = btn.getAttribute('data-syntax') || (btn.innerText || '').trim();
        if (syn && window.insertTxTokenAtCursor) {
            window.insertTxTokenAtCursor(syn);
        }
    };

    window.insertPopoverQuery = function () {
        const queryCode = document.getElementById('tx-popover-query-code');
        const input = document.getElementById('tx-custom-query-input');
        if (queryCode && input) {
            input.value = queryCode.innerText;
            if (typeof validateTxQueryDebounced === 'function') {
                validateTxQueryDebounced();
            }
        }
        hideDealFieldsPopover();
    };

    window.showDealFieldsPopover = function (e) {
        if (popoverHideTimer) clearTimeout(popoverHideTimer);
        const trigger = document.getElementById('tx-deal-fields-label');
        const popover = document.getElementById('tx-deal-fields-popover');
        if (!trigger || !popover) return;

        renderDealFieldsPopover();

        // 1. Make visible first so dimensions can be measured accurately
        popover.style.display = 'flex';
        popover.style.flexDirection = 'column';

        const popWidth = popover.offsetWidth || 620;
        const popHeight = popover.offsetHeight || 360;
        const vw = window.innerWidth || document.documentElement.clientWidth;
        const vh = window.innerHeight || document.documentElement.clientHeight;

        // 2. Extract mouse coordinates
        let mouseX = (e && typeof e.clientX === 'number' && e.clientX > 0) ? e.clientX : lastMouseCoords.x;
        let mouseY = (e && typeof e.clientY === 'number' && e.clientY > 0) ? e.clientY : lastMouseCoords.y;

        const triggerRect = trigger.getBoundingClientRect();
        if (!mouseX || !mouseY) {
            mouseX = triggerRect.left + (triggerRect.width / 2);
            mouseY = triggerRect.bottom;
        }

        // 3. Horizontal positioning (near mouse)
        let left = mouseX + 16;
        if (left + popWidth > vw - 16) {
            left = mouseX - popWidth - 16;
        }
        // Strict horizontal bounds: MUST fit within viewport
        if (left + popWidth > vw - 12) {
            left = vw - popWidth - 12;
        }
        if (left < 12) {
            left = 12;
        }

        // 4. Vertical positioning:
        // Try placing adjacent to mouse below cursor
        let top = mouseY + 10;
        if (top + popHeight > vh - 12) {
            // Not enough space below, try above cursor
            top = mouseY - popHeight - 10;
        }
        // Strict vertical clamping: NEVER go off top (min 12px) and NEVER exceed viewport bottom
        if (top + popHeight > vh - 12) {
            top = vh - popHeight - 12;
        }
        if (top < 12) {
            top = 12;
        }

        popover.style.left = `${Math.round(left)}px`;
        popover.style.top = `${Math.round(top)}px`;
    };

    window.cancelHideDealFieldsPopover = function () {
        if (popoverHideTimer) clearTimeout(popoverHideTimer);
    };

    window.hideDealFieldsPopover = function () {
        if (popoverHideTimer) clearTimeout(popoverHideTimer);
        popoverHideTimer = setTimeout(() => {
            const popover = document.getElementById('tx-deal-fields-popover');
            if (popover) popover.style.display = 'none';
        }, 280);
    };

    window.toggleDealFieldsPopover = function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        const popover = document.getElementById('tx-deal-fields-popover');
        if (popover && popover.style.display === 'block') {
            window.hideDealFieldsPopover();
        } else {
            window.showDealFieldsPopover(e);
        }
    };

    window.initDealFieldsPopoverListeners = function () {
        const trigger = document.getElementById('tx-deal-fields-label');
        const popover = document.getElementById('tx-deal-fields-popover');
        if (trigger && !trigger.dataset.listenersAttached) {
            trigger.dataset.listenersAttached = 'true';
            trigger.addEventListener('mouseenter', (e) => showDealFieldsPopover(e));
            trigger.addEventListener('mousemove', (e) => handleDealFieldsMouseMove(e));
            trigger.addEventListener('mouseleave', hideDealFieldsPopover);
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                if (popover && popover.style.display === 'block') hideDealFieldsPopover();
                else showDealFieldsPopover(e);
            });
        }
        if (popover && !popover.dataset.listenersAttached) {
            popover.dataset.listenersAttached = 'true';
            popover.addEventListener('mouseenter', cancelHideDealFieldsPopover);
            popover.addEventListener('mouseleave', hideDealFieldsPopover);
        }
    };

})();
