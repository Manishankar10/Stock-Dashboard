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

    function cleanSymbol(sym) {
        if (!sym) return '';
        return String(sym).replace(/\.(NS|BO)$/i, '').trim().toUpperCase();
    }

    // Extract live user symbols from frontend global stores if present
    function getLiveClientSymbols() {
        const portfolioSymbols = new Set();
        const watchlistSymbols = new Set();

        try {
            if (window.portfoliosData && typeof window.portfoliosData === 'object') {
                Object.values(window.portfoliosData).forEach(holdings => {
                    if (Array.isArray(holdings)) {
                        holdings.forEach(h => {
                            if (h && h.symbol) portfolioSymbols.add(cleanSymbol(h.symbol));
                        });
                    }
                });
            }

            if (window.watchlistsData && typeof window.watchlistsData === 'object') {
                Object.values(window.watchlistsData).forEach(items => {
                    if (Array.isArray(items)) {
                        items.forEach(item => {
                            const sym = typeof item === 'string' ? item : (item && item.symbol);
                            if (sym) watchlistSymbols.add(cleanSymbol(sym));
                        });
                    }
                });
            }
        } catch (_) {}

        return { portfolioSymbols, watchlistSymbols };
    }

    async function loadCorporateActions(forceRefresh = false) {
        const refreshBtn = document.getElementById('corp-btn-refresh');
        if (refreshBtn && forceRefresh) refreshBtn.classList.add('loading');

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
            if (refreshBtn) refreshBtn.classList.remove('loading');
        }
    }

    function updateTabCounters() {
        if (!window.corpState.data || !window.corpState.data.tabs) return;
        const tabs = window.corpState.data.tabs;
        Object.keys(TAB_CONFIGS).forEach(tabKey => {
            const counterEl = document.getElementById(`corp-count-${tabKey}`);
            if (counterEl && tabs[tabKey] && tabs[tabKey].counts) {
                const count = tabKey === 'dividend' ? tabs[tabKey].counts.total : tabs[tabKey].counts.upcoming;
                counterEl.textContent = count;
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

    function renderTableHead(theadEl, columns) {
        if (!theadEl) return;
        let html = '<tr>';
        columns.forEach(col => {
            html += `<th>${col.label}</th>`;
        });
        html += '</tr>';
        theadEl.innerHTML = html;
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
                <span class="corp-company-name" onclick="window.openStockOrChart('${sym}')" style="cursor: pointer;" title="View stock chart">${comp}</span>
                <span class="corp-symbol-badge">${sym}</span>
                <span class="corp-link-icon" onclick="window.openStockOrChart('${sym}')" title="Open chart">↗</span>
                ${badges}
            </div>
        `;

        let cellsHtml = `<td>${companyHtml}</td>`;

        if (tabKey === 'bonus') {
            cellsHtml += `<td>${item.ex_date_display || item.ex_date || '-'}</td>`;
            cellsHtml += `<td><span class="corp-val-highlight">${item.ratio || '-'}</span></td>`;
        } else if (tabKey === 'rights') {
            cellsHtml += `<td>${item.ex_date_display || item.ex_date || '-'}</td>`;
            cellsHtml += `<td>${item.premium ? Number(item.premium).toFixed(2) : '0.00'}</td>`;
            cellsHtml += `<td><span class="corp-val-highlight">${item.ratio || '-'}</span></td>`;
        } else if (tabKey === 'split') {
            cellsHtml += `<td>${item.ex_date_display || item.ex_date || '-'}</td>`;
            cellsHtml += `<td>${item.old_fv ? Number(item.old_fv).toFixed(2) : '-'}</td>`;
            cellsHtml += `<td><span class="corp-val-highlight">${item.new_fv ? Number(item.new_fv).toFixed(2) : '-'}</span></td>`;
        } else if (tabKey === 'buyback') {
            cellsHtml += `<td>${item.ex_date_display || item.ex_date || '-'}</td>`;
            cellsHtml += `<td>${item.end_date_display || item.end_date || '-'}</td>`;
            cellsHtml += `<td><span class="corp-offer-type">${item.offer_type || 'Tender Offer'}</span></td>`;
            cellsHtml += `<td>${item.max_price && Number(item.max_price) > 0 ? Number(item.max_price).toFixed(2) : '-'}</td>`;
            cellsHtml += `<td><span class="corp-val-highlight">${item.amount_cr && Number(item.amount_cr) > 0 ? Number(item.amount_cr).toFixed(2) : '-'}</span></td>`;
        } else if (tabKey === 'dividend') {
            cellsHtml += `<td>${item.ex_date_display || item.ex_date || '-'}</td>`;
            cellsHtml += `<td><span class="corp-div-type">${item.div_type || 'Interim'}</span></td>`;
            cellsHtml += `<td><span class="corp-val-highlight">${item.percent ? Number(item.percent).toFixed(2) : '-'}</span></td>`;
        }

        return `<tr>${cellsHtml}</tr>`;
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

        // 4. Handle Dividend Rule vs Remaining Tabs
        // User rule: "except dividend remaining show past 2 months records in the bottom with collapse. show only upcoming data first"
        const pastCardEl = document.getElementById('corp-past-section');
        const upcomingTitleEl = document.getElementById('corp-upcoming-title');
        const upcomingBadgeEl = document.getElementById('corp-upcoming-badge');
        const tbodyEl = document.getElementById('corp-upcoming-tbody');
        const emptyEl = document.getElementById('corp-upcoming-empty');
        const pastTbodyEl = document.getElementById('corp-past-tbody');
        const pastBadgeEl = document.getElementById('corp-past-badge');
        const pastEmptyEl = document.getElementById('corp-past-empty');

        if (tabKey === 'dividend') {
            // For dividend: Show all records directly in main table without collapse
            if (pastCardEl) pastCardEl.style.display = 'none';
            if (upcomingTitleEl) upcomingTitleEl.textContent = 'Dividend Announcements';
            if (upcomingBadgeEl) upcomingBadgeEl.textContent = `${filtered.length} announcements`;

            if (filtered.length === 0) {
                if (tbodyEl) tbodyEl.innerHTML = '';
                if (emptyEl) {
                    emptyEl.style.display = 'block';
                    emptyEl.querySelector('.corp-empty-title').textContent = 'No dividend announcements found';
                }
            } else {
                if (emptyEl) emptyEl.style.display = 'none';
                if (tbodyEl) {
                    tbodyEl.innerHTML = filtered.map(item => renderRow(item, tabKey)).join('');
                }
            }
        } else {
            // For Bonus, Rights, Split, Buy back:
            // Upcoming first, and past 2 months in bottom collapsible card
            if (pastCardEl) pastCardEl.style.display = 'block';
            if (upcomingTitleEl) upcomingTitleEl.textContent = `Upcoming ${tabConfig.title}`;
            if (upcomingBadgeEl) upcomingBadgeEl.textContent = `${upcomingItems.length} upcoming`;

            // Upcoming table
            if (upcomingItems.length === 0) {
                if (tbodyEl) tbodyEl.innerHTML = '';
                if (emptyEl) {
                    emptyEl.style.display = 'block';
                    emptyEl.querySelector('.corp-empty-title').textContent = `No upcoming ${tabConfig.title} actions`;
                }
            } else {
                if (emptyEl) emptyEl.style.display = 'none';
                if (tbodyEl) {
                    tbodyEl.innerHTML = upcomingItems.map(item => renderRow(item, tabKey)).join('');
                }
            }

            // Past section
            if (pastBadgeEl) pastBadgeEl.textContent = pastItems.length;
            if (pastItems.length === 0) {
                if (pastTbodyEl) pastTbodyEl.innerHTML = '';
                if (pastEmptyEl) pastEmptyEl.style.display = 'block';
            } else {
                if (pastEmptyEl) pastEmptyEl.style.display = 'none';
                if (pastTbodyEl) {
                    pastTbodyEl.innerHTML = pastItems.map(item => renderRow(item, tabKey)).join('');
                }
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

    // Load data when DOM is ready
    document.addEventListener('DOMContentLoaded', () => {
        loadCorporateActions(false);
    });
})();
