// modules/corporate_actions/corporate_actions.js
// Handles tab navigation, filters (All stocks, Portfolio, Watchlist), search, and live data rendering.

(function() {
    'use strict';

    const TAB_CONFIGS = {
        bonus: {
            title: 'Bonus',
            columns: [
                { key: 'company', label: 'Company' },
                { key: 'ex_date_display', label: 'Ex date ⇣' },
                { key: 'ratio', label: 'Ratio' }
            ]
        },
        rights: {
            title: 'Rights',
            columns: [
                { key: 'company', label: 'Company' },
                { key: 'ex_date_display', label: 'Ex date ⇣' },
                { key: 'premium', label: 'Premium' },
                { key: 'ratio', label: 'Ratio' }
            ]
        },
        split: {
            title: 'Split',
            columns: [
                { key: 'company', label: 'Company' },
                { key: 'ex_date_display', label: 'Ex-Date ⇣' },
                { key: 'old_fv', label: 'Old fv' },
                { key: 'new_fv', label: 'New fv' }
            ]
        },
        buyback: {
            title: 'Buy back',
            columns: [
                { key: 'company', label: 'Company' },
                { key: 'ex_date_display', label: 'Ex date ⇣' },
                { key: 'end_date_display', label: 'End date' },
                { key: 'offer_type', label: 'Offer Type' },
                { key: 'max_price', label: 'Max Price' },
                { key: 'amount_cr', label: 'Amount in Cr' }
            ]
        },
        dividend: {
            title: 'Dividend',
            columns: [
                { key: 'company', label: 'Company' },
                { key: 'ex_date_display', label: 'Ex date ⇣' },
                { key: 'amount', label: 'Amount (₹)' },
                { key: 'div_type', label: 'Div type' },
                { key: 'percent', label: 'Percent' }
            ]
        }
    };

    window.corpState = {
        activeTab: 'bonus',
        activeFilter: 'all',
        searchQuery: '',
        pastExpanded: false,
        data: null,
        loading: false
    };

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function cleanSymbol(sym) {
        if (!sym) return '';
        return String(sym).replace(/\.(NS|BO)$/i, '').trim().toUpperCase();
    }

    // Extract live user symbols from frontend global stores or API payload
    function getLiveClientSymbols() {
        const portfolioSymbols = new Set();
        const watchlistSymbols = new Set();

        try {
            // Check symbols returned directly by backend
            if (window.corpState.data && window.corpState.data.user_symbols) {
                const us = window.corpState.data.user_symbols;
                if (Array.isArray(us.portfolio)) {
                    us.portfolio.forEach(s => portfolioSymbols.add(cleanSymbol(s)));
                }
                if (Array.isArray(us.watchlist)) {
                    us.watchlist.forEach(s => watchlistSymbols.add(cleanSymbol(s)));
                }
            }

            if (window.portfoliosData && typeof window.portfoliosData === 'object') {
                Object.values(window.portfoliosData).forEach(holdings => {
                    if (Array.isArray(holdings)) {
                        holdings.forEach(h => {
                            const sym = typeof h === 'string' ? h : (h && (h.symbol || h.ticker));
                            if (sym) portfolioSymbols.add(cleanSymbol(sym));
                        });
                    }
                });
            }

            if (window.watchlistsData && typeof window.watchlistsData === 'object') {
                Object.values(window.watchlistsData).forEach(items => {
                    if (Array.isArray(items)) {
                        items.forEach(item => {
                            const sym = typeof item === 'string' ? item : (item && (item.symbol || item.ticker));
                            if (sym) watchlistSymbols.add(cleanSymbol(sym));
                        });
                    }
                });
            }

            try {
                const cachedWl = localStorage.getItem('cd_cached_watchlists') || localStorage.getItem('watchlistsData');
                if (cachedWl) {
                    const parsed = JSON.parse(cachedWl);
                    if (parsed && typeof parsed === 'object') {
                        Object.values(parsed).forEach(items => {
                            if (Array.isArray(items)) {
                                items.forEach(item => {
                                    const sym = typeof item === 'string' ? item : (item && (item.symbol || item.ticker));
                                    if (sym) watchlistSymbols.add(cleanSymbol(sym));
                                });
                            }
                        });
                    }
                }
            } catch (_) {}
        } catch (_) {}

        return { portfolioSymbols, watchlistSymbols };
    }

    async function loadCorporateActions(forceRefresh = false) {
        const refreshBtn = document.getElementById('corp-btn-refresh');
        if (refreshBtn && forceRefresh) {
            refreshBtn.classList.add('refreshing');
            refreshBtn.classList.add('loading');
        }

        try {
            const url = `/api/corporate-actions${forceRefresh ? '?refresh=true' : ''}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP error ${res.status}`);
            const json = await res.json();
            if (json && json.tabs) {
                window.corpState.data = json;
                updateTabCounters();
                renderCorporateActions();
            }
        } catch (err) {
            console.error('Failed to load corporate actions:', err);
        } finally {
            if (refreshBtn) {
                setTimeout(() => {
                    refreshBtn.classList.remove('refreshing');
                    refreshBtn.classList.remove('loading');
                }, 500);
            }
        }
    }

    function updateTabCounters() {
        if (!window.corpState.data || !window.corpState.data.tabs) return;
        const tabs = window.corpState.data.tabs;
        const { portfolioSymbols, watchlistSymbols } = getLiveClientSymbols();
        const filter = window.corpState.activeFilter || 'all';

        // Update timestamp
        const updateTag = document.getElementById('corp-last-updated-tag');
        if (updateTag) {
            const now = new Date();
            const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            updateTag.textContent = `🕒 Updated ${timeStr}`;
        }

        Object.keys(TAB_CONFIGS).forEach(tabKey => {
            const counterEl = document.getElementById(`corp-count-${tabKey}`);

            if (tabs[tabKey]) {
                let items = (tabs[tabKey].all || []).map(item => {
                    const sym = cleanSymbol(item.symbol);
                    const inPf = item.in_portfolio || portfolioSymbols.has(sym);
                    const inWl = item.in_watchlist || watchlistSymbols.has(sym);
                    return { ...item, in_portfolio: inPf, in_watchlist: inWl };
                });
                if (filter === 'portfolio') {
                    items = items.filter(x => x.in_portfolio);
                } else if (filter === 'watchlist') {
                    items = items.filter(x => x.in_watchlist);
                }

                const count = items.filter(x => x.is_upcoming).length;
                if (counterEl) counterEl.textContent = count;
            }
        });
    }

    function switchCorpTab(tabKey) {
        if (!TAB_CONFIGS[tabKey]) return;
        window.corpState.activeTab = tabKey;

        document.querySelectorAll('.corp-tab-btn').forEach(btn => {
            const isActive = btn.getAttribute('data-tab') === tabKey;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', String(isActive));
        });

        renderCorporateActions();
    }

    function setCorpFilter(filterKey) {
        window.corpState.activeFilter = filterKey;

        document.querySelectorAll('.corp-filter-pill').forEach(pill => {
            const isActive = pill.getAttribute('data-filter') === filterKey;
            pill.classList.toggle('active', isActive);
        });

        updateTabCounters();
        renderCorporateActions();
    }

    function handleCorpSearch(query) {
        window.corpState.searchQuery = (query || '').trim().toLowerCase();
        const clearBtn = document.getElementById('corp-search-clear');
        if (clearBtn) {
            clearBtn.style.display = window.corpState.searchQuery ? 'inline-block' : 'none';
        }
        renderCorporateActions();
    }

    function clearCorpSearch() {
        const input = document.getElementById('corp-search-input');
        if (input) input.value = '';
        handleCorpSearch('');
    }

    function toggleCorpPastSection() {
        const body = document.getElementById('corp-past-body');
        const header = document.getElementById('corp-past-header');
        const hint = document.getElementById('corp-past-hint');
        if (!body || !header) return;

        window.corpState.pastExpanded = !window.corpState.pastExpanded;
        body.style.display = window.corpState.pastExpanded ? 'block' : 'none';
        header.classList.toggle('open', window.corpState.pastExpanded);
        header.setAttribute('aria-expanded', String(window.corpState.pastExpanded));
        if (hint) {
            hint.textContent = window.corpState.pastExpanded ? 'Click to collapse' : 'Click to expand';
        }
    }

    function formatCorpDateHtml(rawDateDisplay, rawDate) {
        const full = rawDateDisplay || rawDate || '-';
        if (full === '-') return '-';

        let compact = full;
        const m = full.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
        if (m) {
            const day = m[1];
            const mon = m[2].slice(0, 3);
            const yr = m[3].slice(-2);
            compact = `${day}-${mon}-${yr}`;
        } else {
            const iso = full.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (iso) {
                const yr = iso[1].slice(-2);
                const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                const mon = monthNames[parseInt(iso[2], 10) - 1] || iso[2];
                const day = parseInt(iso[3], 10);
                compact = `${day}-${mon}-${yr}`;
            }
        }
        return `<span class="corp-date-full">${full}</span><span class="corp-date-compact">${compact}</span>`;
    }

    function renderTableHead(theadEl, columns) {
        if (!theadEl) return;
        let html = '<tr>';
        columns.forEach(col => {
            const keyClass = `corp-col-${col.key.replace(/_/g, '-')}`;
            const extraClass = col.key === 'amount' ? ` class="${keyClass} corp-col-amount"` : ` class="${keyClass}"`;
            html += `<th${extraClass}>${col.label}</th>`;
        });
        html += '</tr>';
        theadEl.innerHTML = html;
    }

    function openStockFundamentals(symbol) {
        if (!symbol) return;
        const clean = cleanSymbol(symbol);
        if (typeof window.openFundamentalsModal === 'function') {
            window.openFundamentalsModal(clean);
        } else {
            openStockOrChart(clean);
        }
    }

    function openStockOrChart(symbol) {
        if (!symbol) return;
        const clean = cleanSymbol(symbol);
        if (typeof window.openChart === 'function') {
            window.openChart(clean + '.NS');
        } else if (typeof window.openInHouseChart === 'function') {
            window.openInHouseChart(clean + '.NS');
        } else {
            window.open(`https://in.tradingview.com/chart/?symbol=NSE:${encodeURIComponent(clean)}`, '_blank');
        }
    }

    function renderRow(item, tabKey) {
        const sym = cleanSymbol(item.symbol);
        const comp = item.company || sym;

        let badges = '';
        if (item.in_portfolio) {
            badges += '<span class="corp-holding-badge portfolio" title="Stock in your Portfolio">Portfolio</span>';
        }
        if (item.in_watchlist) {
            badges += '<span class="corp-holding-badge watchlist" title="Stock in your Watchlist">Watchlist</span>';
        }

        const companyHtml = `
            <div class="corp-company-cell">
                <span class="corp-company-name" onclick="window.openStockFundamentals('${sym}')" style="cursor: pointer;" title="View fundamentals for ${escapeHtml(comp)}">${escapeHtml(comp)}</span>
                <span class="corp-symbol-badge" onclick="window.openStockFundamentals('${sym}')" title="View fundamentals for ${escapeHtml(sym)}">${escapeHtml(sym)}</span>
                <span class="corp-link-icon" onclick="event.stopPropagation(); window.openStockOrChart('${sym}')" title="Open Interactive Chart">📈</span>
                ${badges}
            </div>
        `;

        const dateHtml = formatCorpDateHtml(item.ex_date_display, item.ex_date);
        let cellsHtml = `<td class="corp-col-company">${companyHtml}</td>`;

        if (tabKey === 'bonus') {
            cellsHtml += `<td class="corp-col-ex-date-display">${dateHtml}</td>`;
            cellsHtml += `<td class="corp-col-ratio"><span class="corp-val-highlight">${item.ratio || '-'}</span></td>`;
        } else if (tabKey === 'rights') {
            cellsHtml += `<td class="corp-col-ex-date-display">${dateHtml}</td>`;
            cellsHtml += `<td class="corp-col-premium">${item.premium ? Number(item.premium).toFixed(2) : '0.00'}</td>`;
            cellsHtml += `<td class="corp-col-ratio"><span class="corp-val-highlight">${item.ratio || '-'}</span></td>`;
        } else if (tabKey === 'split') {
            cellsHtml += `<td class="corp-col-ex-date-display">${dateHtml}</td>`;
            cellsHtml += `<td class="corp-col-old-fv">${item.old_fv ? Number(item.old_fv).toFixed(2) : '-'}</td>`;
            cellsHtml += `<td class="corp-col-new-fv"><span class="corp-val-highlight">${item.new_fv ? Number(item.new_fv).toFixed(2) : '-'}</span></td>`;
        } else if (tabKey === 'buyback') {
            const endDateHtml = formatCorpDateHtml(item.end_date_display, item.end_date);
            cellsHtml += `<td class="corp-col-ex-date-display">${dateHtml}</td>`;
            cellsHtml += `<td class="corp-col-end-date-display">${endDateHtml}</td>`;
            cellsHtml += `<td class="corp-col-offer-type"><span class="corp-offer-type">${item.offer_type || 'Tender Offer'}</span></td>`;
            cellsHtml += `<td class="corp-col-max-price">${item.max_price && Number(item.max_price) > 0 ? Number(item.max_price).toFixed(2) : '-'}</td>`;
            cellsHtml += `<td class="corp-col-amount-cr"><span class="corp-val-highlight">${item.amount_cr && Number(item.amount_cr) > 0 ? Number(item.amount_cr).toFixed(2) : '-'}</span></td>`;
        } else if (tabKey === 'dividend') {
            cellsHtml += `<td class="corp-col-ex-date-display">${dateHtml}</td>`;
            const rawAmt = item.amount !== undefined ? item.amount : (item.percent ? (Number(item.percent) * 0.1).toFixed(2) : '-');
            const amtDisplay = (rawAmt !== '-' && !isNaN(Number(rawAmt))) ? `₹${Number(rawAmt).toFixed(2)}` : (rawAmt || '-');
            cellsHtml += `<td class="corp-col-amount"><span class="corp-val-highlight">${amtDisplay}</span></td>`;
            cellsHtml += `<td class="corp-col-div-type"><span class="corp-div-type">${item.div_type || 'Interim'}</span></td>`;
            cellsHtml += `<td class="corp-col-percent"><span class="corp-val-highlight">${item.percent ? Number(item.percent).toFixed(2) + '%' : '-'}</span></td>`;
        }

        return `<tr>${cellsHtml}</tr>`;
    }

    function renderMobileCard(item, tabKey) {
        const sym = cleanSymbol(item.symbol);
        const comp = item.company || sym;

        let badges = '';
        if (item.in_portfolio) {
            badges += '<span class="corp-holding-badge portfolio" title="Stock in your Portfolio">Portfolio</span>';
        }
        if (item.in_watchlist) {
            badges += '<span class="corp-holding-badge watchlist" title="Stock in your Watchlist">Watchlist</span>';
        }

        const dateDisplay = item.ex_date_display || item.ex_date || '-';

        let statsHtml = '';

        if (tabKey === 'bonus') {
            statsHtml = `
                <div class="corp-mcard-stat">
                    <span class="corp-mcard-stat-label">EX DATE</span>
                    <span class="corp-mcard-stat-val">${escapeHtml(dateDisplay)}</span>
                </div>
                <div class="corp-mcard-stat">
                    <span class="corp-mcard-stat-label">BONUS RATIO</span>
                    <span class="corp-mcard-stat-val highlight-val">${escapeHtml(item.ratio || '-')}</span>
                </div>
            `;
        } else if (tabKey === 'rights') {
            const premVal = item.premium ? ('₹' + Number(item.premium).toFixed(2)) : '₹0.00';
            statsHtml = `
                <div class="corp-mcard-stat">
                    <span class="corp-mcard-stat-label">EX DATE</span>
                    <span class="corp-mcard-stat-val">${escapeHtml(dateDisplay)}</span>
                </div>
                <div class="corp-mcard-stat">
                    <span class="corp-mcard-stat-label">PREMIUM</span>
                    <span class="corp-mcard-stat-val">${escapeHtml(premVal)}</span>
                </div>
                <div class="corp-mcard-stat" style="grid-column: span 2;">
                    <span class="corp-mcard-stat-label">RIGHTS RATIO</span>
                    <span class="corp-mcard-stat-val highlight-val">${escapeHtml(item.ratio || '-')}</span>
                </div>
            `;
        } else if (tabKey === 'split') {
            const oldFv = item.old_fv ? ('₹' + Number(item.old_fv).toFixed(2)) : '-';
            const newFv = item.new_fv ? ('₹' + Number(item.new_fv).toFixed(2)) : '-';
            statsHtml = `
                <div class="corp-mcard-stat" style="grid-column: span 2;">
                    <span class="corp-mcard-stat-label">EX DATE</span>
                    <span class="corp-mcard-stat-val">${escapeHtml(dateDisplay)}</span>
                </div>
                <div class="corp-mcard-stat">
                    <span class="corp-mcard-stat-label">OLD FACE VALUE</span>
                    <span class="corp-mcard-stat-val">${escapeHtml(oldFv)}</span>
                </div>
                <div class="corp-mcard-stat">
                    <span class="corp-mcard-stat-label">NEW FACE VALUE</span>
                    <span class="corp-mcard-stat-val highlight-val">${escapeHtml(newFv)}</span>
                </div>
            `;
        } else if (tabKey === 'buyback') {
            const endDateDisplay = item.end_date_display || item.end_date || '-';
            const maxPrice = item.max_price && Number(item.max_price) > 0 ? ('₹' + Number(item.max_price).toFixed(2)) : '-';
            const amtCr = item.amount_cr && Number(item.amount_cr) > 0 ? ('₹' + Number(item.amount_cr).toFixed(2) + ' Cr') : '-';
            statsHtml = `
                <div class="corp-mcard-stat">
                    <span class="corp-mcard-stat-label">EX DATE</span>
                    <span class="corp-mcard-stat-val">${escapeHtml(dateDisplay)}</span>
                </div>
                <div class="corp-mcard-stat">
                    <span class="corp-mcard-stat-label">END DATE</span>
                    <span class="corp-mcard-stat-val">${escapeHtml(endDateDisplay)}</span>
                </div>
                <div class="corp-mcard-stat">
                    <span class="corp-mcard-stat-label">OFFER TYPE</span>
                    <span class="corp-mcard-stat-val"><span class="corp-offer-type">${escapeHtml(item.offer_type || 'Tender Offer')}</span></span>
                </div>
                <div class="corp-mcard-stat">
                    <span class="corp-mcard-stat-label">MAX PRICE</span>
                    <span class="corp-mcard-stat-val">${escapeHtml(maxPrice)}</span>
                </div>
                <div class="corp-mcard-stat" style="grid-column: span 2;">
                    <span class="corp-mcard-stat-label">AMOUNT IN CR</span>
                    <span class="corp-mcard-stat-val highlight-val">${escapeHtml(amtCr)}</span>
                </div>
            `;
        } else if (tabKey === 'dividend') {
            const rawAmt = item.amount !== undefined ? item.amount : (item.percent ? (Number(item.percent) * 0.1).toFixed(2) : '-');
            const amtDisplay = (rawAmt !== '-' && !isNaN(Number(rawAmt))) ? `₹${Number(rawAmt).toFixed(2)}` : (rawAmt || '-');
            const pctDisplay = item.percent ? (Number(item.percent).toFixed(2) + '%') : '-';
            statsHtml = `
                <div class="corp-mcard-stat">
                    <span class="corp-mcard-stat-label">EX DATE</span>
                    <span class="corp-mcard-stat-val">${escapeHtml(dateDisplay)}</span>
                </div>
                <div class="corp-mcard-stat">
                    <span class="corp-mcard-stat-label">DIVIDEND AMOUNT</span>
                    <span class="corp-mcard-stat-val highlight-val text-buy">${escapeHtml(amtDisplay)}</span>
                </div>
                <div class="corp-mcard-stat">
                    <span class="corp-mcard-stat-label">DIV TYPE</span>
                    <span class="corp-mcard-stat-val"><span class="corp-div-type">${escapeHtml(item.div_type || 'Interim')}</span></span>
                </div>
                <div class="corp-mcard-stat">
                    <span class="corp-mcard-stat-label">PERCENTAGE</span>
                    <span class="corp-mcard-stat-val highlight-val">${escapeHtml(pctDisplay)}</span>
                </div>
            `;
        }

        return `
            <div class="corp-mobile-card">
                <div class="corp-mcard-top">
                    <div class="corp-mcard-company-wrap">
                        <div class="corp-mcard-company-name" onclick="window.openStockFundamentals('${sym}')" title="View fundamentals for ${escapeHtml(comp)}">
                            ${escapeHtml(comp)}
                        </div>
                        <div class="corp-mcard-ticker-row">
                            <span class="corp-symbol-badge" onclick="window.openStockFundamentals('${sym}')" title="View fundamentals for ${escapeHtml(sym)}">${escapeHtml(sym)}</span>
                            <span class="corp-link-icon" onclick="event.stopPropagation(); window.openStockOrChart('${sym}')" title="Open Interactive Chart">📈 Chart</span>
                            ${badges}
                        </div>
                    </div>
                </div>
                <div class="corp-mcard-grid">
                    ${statsHtml}
                </div>
            </div>
        `;
    }

    function renderCorporateActions() {
        const state = window.corpState;
        if (!state.data || !state.data.tabs) return;

        const tabKey = state.activeTab;
        const tabConfig = TAB_CONFIGS[tabKey];
        const tabData = state.data.tabs[tabKey];
        if (!tabConfig || !tabData) return;

        const { portfolioSymbols, watchlistSymbols } = getLiveClientSymbols();

        // 1. Filter items based on active filter and live holdings
        const allItems = (tabData.all || []).map(item => {
            const sym = cleanSymbol(item.symbol);
            const inPf = item.in_portfolio || portfolioSymbols.has(sym);
            const inWl = item.in_watchlist || watchlistSymbols.has(sym);
            return { ...item, in_portfolio: inPf, in_watchlist: inWl };
        });

        const query = state.searchQuery;
        const filter = state.activeFilter;

        const filtered = allItems.filter(item => {
            if (filter === 'portfolio' && !item.in_portfolio) return false;
            if (filter === 'watchlist' && !item.in_watchlist) return false;

            if (query) {
                const comp = (item.company || '').toLowerCase();
                const sym = (item.symbol || '').toLowerCase();
                if (!comp.includes(query) && !sym.includes(query)) return false;
            }
            return true;
        });

        // 2. Separate Upcoming and Past (last 2 months)
        let upcomingItems = filtered.filter(x => x.is_upcoming);
        let pastItems = filtered.filter(x => x.is_past_2m);

        // Sort upcoming: soonest ex-date first
        upcomingItems.sort((a, b) => (a.ex_date || '').localeCompare(b.ex_date || ''));
        // Sort past: newest ex-date first
        pastItems.sort((a, b) => (b.ex_date || '').localeCompare(a.ex_date || ''));

        // 3. Render Table Headers
        const headEl = document.getElementById('corp-table-head');
        const pastHeadEl = document.getElementById('corp-past-table-head');
        renderTableHead(headEl, tabConfig.columns);
        renderTableHead(pastHeadEl, tabConfig.columns);

        const upcomingTableEl = document.getElementById('corp-upcoming-table');
        if (upcomingTableEl) upcomingTableEl.setAttribute('data-tab', tabKey);
        const pastTableEl = document.getElementById('corp-past-table');
        if (pastTableEl) pastTableEl.setAttribute('data-tab', tabKey);
        const rootContainer = document.getElementById('tab-corporate-actions');
        if (rootContainer) rootContainer.setAttribute('data-active-tab', tabKey);

        // 4. Render Upcoming Actions and Past Actions (Last 2 Months)
        const pastCardEl = document.getElementById('corp-past-section');
        const upcomingTitleEl = document.getElementById('corp-upcoming-title');
        const upcomingBadgeEl = document.getElementById('corp-upcoming-badge');
        const tbodyEl = document.getElementById('corp-upcoming-tbody');
        const upcomingCardsEl = document.getElementById('corp-upcoming-mobile-cards');
        const emptyEl = document.getElementById('corp-upcoming-empty');

        const pastTbodyEl = document.getElementById('corp-past-tbody');
        const pastCardsEl = document.getElementById('corp-past-mobile-cards');
        const pastBadgeEl = document.getElementById('corp-past-badge');
        const pastEmptyEl = document.getElementById('corp-past-empty');
        const pastHeadingEl = document.getElementById('corp-past-heading');

        if (pastCardEl) pastCardEl.style.display = 'block';
        if (upcomingTitleEl) {
            upcomingTitleEl.textContent = tabKey === 'dividend' ? 'Upcoming Dividends' : `Upcoming ${tabConfig.title}`;
        }
        if (upcomingBadgeEl) {
            upcomingBadgeEl.textContent = `${upcomingItems.length} upcoming`;
        }
        if (pastHeadingEl) {
            pastHeadingEl.textContent = tabKey === 'dividend' 
                ? 'Past Dividends (Last 2 Months)' 
                : `Past ${tabConfig.title} Actions (Last 2 Months)`;
        }

        // Upcoming table & mobile cards
        if (upcomingItems.length === 0) {
            if (tbodyEl) tbodyEl.innerHTML = '';
            if (upcomingCardsEl) upcomingCardsEl.innerHTML = '';
            if (emptyEl) {
                emptyEl.style.display = 'block';
                let emptyMsg = `No upcoming ${tabConfig.title} actions`;
                if (filter === 'portfolio') {
                    emptyMsg = `No upcoming ${tabConfig.title} actions for your Portfolio stocks`;
                } else if (filter === 'watchlist') {
                    emptyMsg = `No upcoming ${tabConfig.title} actions for your Watchlist stocks`;
                }
                emptyEl.querySelector('.corp-empty-title').textContent = emptyMsg;
            }
        } else {
            if (emptyEl) emptyEl.style.display = 'none';
            if (tbodyEl) {
                tbodyEl.innerHTML = upcomingItems.map(item => renderRow(item, tabKey)).join('');
            }
            if (upcomingCardsEl) {
                upcomingCardsEl.innerHTML = upcomingItems.map(item => renderMobileCard(item, tabKey)).join('');
            }
        }

        // Past table & mobile cards
        if (pastBadgeEl) pastBadgeEl.textContent = pastItems.length;
        if (pastItems.length === 0) {
            if (pastTbodyEl) pastTbodyEl.innerHTML = '';
            if (pastCardsEl) pastCardsEl.innerHTML = '';
            if (pastEmptyEl) {
                pastEmptyEl.style.display = 'block';
                let pastEmptyMsg = 'No records in the last 2 months';
                if (filter === 'portfolio') {
                    pastEmptyMsg = 'No past actions in the last 2 months for your Portfolio stocks';
                } else if (filter === 'watchlist') {
                    pastEmptyMsg = 'No past actions in the last 2 months for your Watchlist stocks';
                }
                const titleNode = pastEmptyEl.querySelector('.corp-empty-title');
                if (titleNode) titleNode.textContent = pastEmptyMsg;
            }
        } else {
            if (pastEmptyEl) pastEmptyEl.style.display = 'none';
            if (pastTbodyEl) {
                pastTbodyEl.innerHTML = pastItems.map(item => renderRow(item, tabKey)).join('');
            }
            if (pastCardsEl) {
                pastCardsEl.innerHTML = pastItems.map(item => renderMobileCard(item, tabKey)).join('');
            }
        }
    }

    // Public API hooks
    window.loadCorporateActions = loadCorporateActions;
    window.refreshCorporateActions = (force) => loadCorporateActions(force);
    window.switchCorpTab = switchCorpTab;
    window.setCorpFilter = setCorpFilter;
    window.handleCorpSearch = handleCorpSearch;
    window.clearCorpSearch = clearCorpSearch;
    window.toggleCorpPastSection = toggleCorpPastSection;
    window.openStockOrChart = openStockOrChart;
    window.openStockFundamentals = openStockFundamentals;

    // Viewport resize listener for responsive / web adaptations
    window.addEventListener('resize', () => {
        updateTabCounters();
        renderCorporateActions();
    });

    // Load data when DOM is ready
    document.addEventListener('DOMContentLoaded', () => {
        loadCorporateActions(false);
    });
})();
