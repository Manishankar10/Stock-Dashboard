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

                // If user triggered manual refresh, notify on exchange status / 15m window
                if (forceRefresh && typeof window.showToast === 'function') {
                    if (data.official_called) {
                        window.showToast('Official exchange transactions refreshed from NSE India.', 'success', 3000);
                    } else if (state.cooldownRemainingSeconds > 0) {
                        const remMin = Math.max(1, Math.ceil(state.cooldownRemainingSeconds / 60));
                        window.showToast(`Official exchanges maintain a 15m window (${remMin}m remaining). Data is current.`, 'info', 3200);
                    }
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
            updatedTag.innerHTML = `🕒 Updated: <strong>${escapeHtml(state.lastUpdatedText)}</strong> <span class="tx-cadence-badge" style="opacity: 0.75; font-size: 11px; margin-left: 6px; font-weight: normal;">(15m exchange window)</span>`;
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
            wrapper.style.display = 'inline-block';
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
                            <a href="javascript:void(0)" class="tx-stock-ticker" onclick="window.openTxStockFundamentals('${deal.symbol}')" title="Open fundamentals for ${deal.symbol}">
                                ${escapeHtml(deal.symbol)} <span class="tx-exch-tag">NSE</span>
                            </a>
                        </div>
                        <a href="javascript:void(0)" class="tx-stock-name" onclick="window.openTxStockFundamentals('${deal.symbol}')" title="Open fundamentals for ${escapeHtml(deal.company || deal.symbol)}">
                            ${escapeHtml(deal.company || deal.symbol)}
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
            <div class="tx-card-item" onclick="window.openTxStockFundamentals('${deal.symbol}')" title="Open fundamentals for ${escapeHtml(deal.company || deal.symbol)}">
                <div class="tx-card-header">
                    <div class="tx-card-stock">
                        <span class="tx-card-ticker">${escapeHtml(deal.symbol)}</span>
                        <span class="tx-exch-tag">NSE</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="tx-action-pill ${actionClass}">${actionText}</span>
                        <span class="tx-card-date">${escapeHtml(deal.date_display || deal.date || '')}</span>
                    </div>
                </div>

                <div class="tx-card-company-row">
                    <div class="tx-card-company" title="Open fundamentals for ${escapeHtml(deal.company || deal.symbol)}">
                        ${escapeHtml(deal.company || deal.symbol)}
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

    window.handleTxDateInputChange = function () {
        document.querySelectorAll('.tx-date-preset-pills [data-preset]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-preset') === 'custom');
        });
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
        state.page = 1;

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
        const clean = symbol.replace(/\.(?:NS|BO)$/i, '').trim();
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
        const clean = symbol.replace(/\.(?:NS|BO)$/i, '').trim();
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
})();
