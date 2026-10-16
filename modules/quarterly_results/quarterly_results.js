// modules/quarterly_results/quarterly_results.js
// Standalone controller for Latest Quarterly Results Component

(function() {
    'use strict';

    let qrState = {
        search: '',
        industry: 'all',
        mcap_tier: 'all',
        min_mcap: null,
        max_mcap: null,
        sorting: 'latest',
        exchange: 'all',
        watchlist: 'all',
        date: '',
        data: null,
        isFetching: false
    };

    let searchDebounceTimer = null;

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Load quarterly results data from API
     */
    async function loadQuarterlyResults(forceRefresh = false) {
        if (qrState.isFetching) return;
        qrState.isFetching = true;

        const streamEl = document.getElementById('qr-cards-stream');
        if (!qrState.data && streamEl) {
            streamEl.innerHTML = `
                <div class="qr-card-skeleton"><div class="qr-skeleton-header"></div><div class="qr-skeleton-table"></div></div>
                <div class="qr-card-skeleton"><div class="qr-skeleton-header"></div><div class="qr-skeleton-table"></div></div>
            `;
        }

        const params = new URLSearchParams();
        if (qrState.search) params.set('search', qrState.search);
        if (qrState.industry && qrState.industry !== 'all') params.set('industry', qrState.industry);
        if (qrState.mcap_tier && qrState.mcap_tier !== 'all') params.set('mcap_tier', qrState.mcap_tier);
        if (qrState.min_mcap !== null && qrState.min_mcap !== undefined && qrState.min_mcap !== '') params.set('min_mcap', qrState.min_mcap);
        if (qrState.max_mcap !== null && qrState.max_mcap !== undefined && qrState.max_mcap !== '') params.set('max_mcap', qrState.max_mcap);
        if (qrState.sorting) params.set('sorting', qrState.sorting);
        if (qrState.exchange && qrState.exchange !== 'all') params.set('exchange', qrState.exchange);
        if (qrState.watchlist && qrState.watchlist !== 'all') params.set('watchlist', qrState.watchlist);
        if (qrState.date) params.set('date', qrState.date);
        if (forceRefresh) params.set('refresh', '1');

        try {
            const res = await fetch(`/api/quarterly-results?${params.toString()}`);
            if (!res.ok) throw new Error(`HTTP error ${res.status}`);
            const data = await res.json();
            qrState.data = data;
            renderQuarterlyResultsUI(data);
        } catch (err) {
            console.error('Failed to load quarterly results:', err);
            if (!qrState.data && streamEl) {
                streamEl.innerHTML = `
                    <div class="qr-empty-state" style="display:block;">
                        <div class="qr-empty-icon">⚠️</div>
                        <h3 class="qr-empty-title">Could not load quarterly results</h3>
                        <p class="qr-empty-desc">Check your connection and try refreshing.</p>
                        <button type="button" class="qr-btn-reset-filters" onclick="window.loadQuarterlyResults(true)">Retry</button>
                    </div>
                `;
            }
        } finally {
            qrState.isFetching = false;
        }
    }

    /**
     * Build HTML markup for a single company result card
     */
    function buildResultCardHtml(item) {
        const sym = escapeHtml(item.symbol || '');
        const comp = escapeHtml(item.company || item.symbol || 'Company');
        const price = item.price !== undefined ? `₹ ${Number(item.price).toLocaleString('en-IN', {minimumFractionDigits: 1, maximumFractionDigits: 2})}` : '—';
        const mcap = item.mcap_cr !== undefined ? `₹ ${Number(item.mcap_cr).toLocaleString('en-IN')} Cr` : '—';
        const pe = item.pe !== undefined ? Number(item.pe).toFixed(1) : '—';
        const pdfUrl = item.pdf_url ? escapeHtml(item.pdf_url) : '#';
        const ind = escapeHtml(item.industry || '');

        const quarters = item.quarters || { latest: 'Sep 2026', prev: 'Jun 2026', year_ago: 'Sep 2025' };

        const rowsHtml = (item.metrics || []).map(m => {
            const name = escapeHtml(m.name || '');
            const yoyPct = Number(m.yoy_pct || 0);
            let yoyClass = 'neutral';
            let yoyText = '—';
            if (yoyPct > 0) {
                yoyClass = 'pos';
                yoyText = `↑ ${yoyPct.toFixed(0)}%`;
            } else if (yoyPct < 0) {
                yoyClass = 'neg';
                yoyText = `↓ ${Math.abs(yoyPct).toFixed(0)}%`;
            } else if (m.yoy_pct === 0) {
                yoyText = '0%';
            }

            const latestVal = escapeHtml(m.latest || '—');
            const prevVal = escapeHtml(m.prev || '—');
            const yearAgoVal = escapeHtml(m.year_ago || '—');

            return `
                <tr>
                    <td class="qr-metric-name">${name}</td>
                    <td class="qr-metric-yoy ${yoyClass}">${yoyText}</td>
                    <td class="qr-metric-val">${latestVal}</td>
                    <td class="qr-metric-val">${prevVal}</td>
                    <td class="qr-metric-val">${yearAgoVal}</td>
                </tr>
            `;
        }).join('');

        return `
            <div class="qr-result-card" data-symbol="${sym}">
                <div class="qr-card-header">
                    <div class="qr-company-left">
                        <span class="qr-company-name" onclick="window.openStockChart('${sym}')" title="Click to view interactive chart">
                            ${comp} <span class="qr-ext-icon">↗</span>
                        </span>
                        ${item.pdf_url ? `<a href="${pdfUrl}" target="_blank" rel="noopener noreferrer" class="qr-pdf-link" title="Download Exchange PDF Filing">PDF <span class="qr-pdf-icon">📄</span></a>` : ''}
                        ${ind ? `<span class="qr-industry-pill">${ind}</span>` : ''}
                    </div>
                    <div class="qr-key-stats">
                        <span class="qr-stat-item"><span class="qr-stat-label">Price</span> <span class="qr-stat-val">${price}</span></span>
                        <span class="qr-stat-sep">•</span>
                        <span class="qr-stat-item"><span class="qr-stat-label">M.Cap</span> <span class="qr-stat-val">${mcap}</span></span>
                        <span class="qr-stat-sep">•</span>
                        <span class="qr-stat-item"><span class="qr-stat-label">PE</span> <span class="qr-stat-val">${pe}</span></span>
                    </div>
                </div>

                <div class="qr-table-wrapper">
                    <table class="qr-table">
                        <colgroup>
                            <col class="qr-col-metric" style="width: 24%;">
                            <col class="qr-col-yoy" style="width: 16%;">
                            <col class="qr-col-q" style="width: 20%;">
                            <col class="qr-col-q" style="width: 20%;">
                            <col class="qr-col-q" style="width: 20%;">
                        </colgroup>
                        <thead>
                            <tr>
                                <th class="qr-col-metric"></th>
                                <th class="qr-col-yoy">YOY</th>
                                <th class="qr-col-q">${escapeHtml(quarters.latest)}</th>
                                <th class="qr-col-q">${escapeHtml(quarters.prev)}</th>
                                <th class="qr-col-q">${escapeHtml(quarters.year_ago)}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    /**
     * Render data into the main UI
     */
    function renderQuarterlyResultsUI(data) {
        if (!data) return;

        // 1. Counters
        const count = data.total_count || 0;
        const total = data.market_total || 0;
        const filteredCountEl = document.getElementById('qr-filtered-count');
        const totalCountEl = document.getElementById('qr-total-count');
        const bottomCountEl = document.getElementById('qr-bottom-count-text');

        if (filteredCountEl) filteredCountEl.innerText = count;
        if (totalCountEl) totalCountEl.innerText = `(${total} total)`;
        if (bottomCountEl) bottomCountEl.innerText = `${count} results`;

        // 2. Render Cards Stream
        const streamEl = document.getElementById('qr-cards-stream');
        const emptyEl = document.getElementById('qr-empty-state');

        if (count > 0 && streamEl) {
            streamEl.innerHTML = data.results.map(item => buildResultCardHtml(item)).join('');
            streamEl.style.display = 'flex';
            if (emptyEl) emptyEl.style.display = 'none';
        } else if (streamEl) {
            streamEl.innerHTML = '';
            streamEl.style.display = 'none';
            if (emptyEl) emptyEl.style.display = 'block';
        }

        // 3. Render Dates Navigation
        renderDatesNav(data.available_dates || []);

        // 4. Render Industries
        renderIndustries(data.available_industries || []);

        // 5. Render Watchlists in filter
        renderWatchlistFilters(data.user_watchlists || []);

        // 6. Update Mobile Filter Badge
        updateActiveFilterBadge();

        // 7. Sync Radio Selections
        syncRadioUI();
    }

    /**
     * Render horizontal date pills
     */
    function renderDatesNav(dates) {
        const navEl = document.getElementById('qr-dates-list');
        if (!navEl) return;

        const isAllActive = !qrState.date;
        let html = `
            <button type="button" class="qr-date-pill ${isAllActive ? 'active' : ''}" data-date="" onclick="window.setQrDateFilter('')">
                All Recent
            </button>
        `;

        dates.forEach(item => {
            const isActive = qrState.date === item.date;
            html += `
                <button type="button" class="qr-date-pill ${isActive ? 'active' : ''}" data-date="${escapeHtml(item.date)}" onclick="window.setQrDateFilter('${escapeHtml(item.date)}')">
                    ${escapeHtml(item.label)}
                </button>
            `;
        });

        navEl.innerHTML = html;
    }

    /**
     * Render industry options in desktop and mobile sidebars
     */
    function renderIndustries(industries) {
        ['desktop', 'mobile'].forEach(source => {
            const listEl = document.getElementById(`qr-industry-list-${source}`);
            if (!listEl) return;

            const isAll = qrState.industry === 'all';
            let html = `
                <label class="qr-radio-item ${isAll ? 'active' : ''}">
                    <input type="radio" name="qr-industry-${source}" value="all" ${isAll ? 'checked' : ''} onchange="window.setQrIndustryFilter('all')">
                    <span class="qr-radio-label">All industries</span>
                    <span class="qr-check-icon">✓</span>
                </label>
            `;

            industries.forEach(item => {
                const isActive = qrState.industry.toLowerCase() === item.name.toLowerCase();
                html += `
                    <label class="qr-radio-item ${isActive ? 'active' : ''}" data-industry="${escapeHtml(item.name.toLowerCase())}">
                        <input type="radio" name="qr-industry-${source}" value="${escapeHtml(item.name)}" ${isActive ? 'checked' : ''} onchange="window.setQrIndustryFilter('${escapeHtml(item.name)}')">
                        <span class="qr-radio-label">${escapeHtml(item.name)} <span style="opacity:0.6; font-size:11px;">(${item.count})</span></span>
                        <span class="qr-check-icon">✓</span>
                    </label>
                `;
            });

            listEl.innerHTML = html;
        });
    }

    /**
     * Populate Watchlist radio options dynamically
     */
    function renderWatchlistFilters(watchlists) {
        ['desktop', 'mobile'].forEach(source => {
            const containerEl = document.getElementById(`qr-watchlist-options-${source}`);
            if (!containerEl) return;

            const isAll = qrState.watchlist === 'all';
            const isAny = qrState.watchlist === 'any';

            let html = `
                <label class="qr-radio-item ${isAll ? 'active' : ''}">
                    <input type="radio" name="qr-watchlist-${source}" value="all" ${isAll ? 'checked' : ''} onchange="window.setQrWatchlistScope('all')">
                    <span class="qr-radio-label">No Filter</span>
                    <span class="qr-check-icon">✓</span>
                </label>
                <label class="qr-radio-item ${isAny ? 'active' : ''}">
                    <input type="radio" name="qr-watchlist-${source}" value="any" ${isAny ? 'checked' : ''} onchange="window.setQrWatchlistScope('any')">
                    <span class="qr-radio-label">In any watchlist</span>
                    <span class="qr-check-icon">✓</span>
                </label>
            `;

            watchlists.forEach(name => {
                const isActive = qrState.watchlist === name;
                html += `
                    <label class="qr-radio-item ${isActive ? 'active' : ''}">
                        <input type="radio" name="qr-watchlist-${source}" value="${escapeHtml(name)}" ${isActive ? 'checked' : ''} onchange="window.setQrWatchlistScope('${escapeHtml(name)}')">
                        <span class="qr-radio-label">In ${escapeHtml(name)}</span>
                        <span class="qr-check-icon">✓</span>
                    </label>
                `;
            });

            containerEl.innerHTML = html;
        });
    }

    /**
     * Sync Radio Item Active CSS classes
     */
    function syncRadioUI() {
        ['desktop', 'mobile'].forEach(source => {
            // Mcap
            document.querySelectorAll(`input[name="qr-mcap-${source}"]`).forEach(input => {
                const parent = input.closest('.qr-radio-item');
                if (parent) parent.classList.toggle('active', input.value === qrState.mcap_tier);
            });
            // Sorting
            document.querySelectorAll(`input[name="qr-sort-${source}"]`).forEach(input => {
                const parent = input.closest('.qr-radio-item');
                if (parent) parent.classList.toggle('active', input.value === qrState.sorting);
            });
            // Exchange
            document.querySelectorAll(`input[name="qr-exchange-${source}"]`).forEach(input => {
                const parent = input.closest('.qr-radio-item');
                if (parent) parent.classList.toggle('active', input.value === qrState.exchange);
            });
            // Watchlist
            document.querySelectorAll(`input[name="qr-watchlist-${source}"]`).forEach(input => {
                const parent = input.closest('.qr-radio-item');
                if (parent) parent.classList.toggle('active', input.value === qrState.watchlist);
            });
        });
    }

    /**
     * Count active filters and update badge on mobile trigger
     */
    function updateActiveFilterBadge() {
        let count = 0;
        if (qrState.search) count++;
        if (qrState.industry && qrState.industry !== 'all') count++;
        if (qrState.mcap_tier && qrState.mcap_tier !== 'all') count++;
        if (qrState.min_mcap || qrState.max_mcap) count++;
        if (qrState.sorting && qrState.sorting !== 'latest') count++;
        if (qrState.exchange && qrState.exchange !== 'all') count++;
        if (qrState.watchlist && qrState.watchlist !== 'all') count++;
        if (qrState.date) count++;

        const badgeEl = document.getElementById('qr-mobile-active-filter-badge');
        if (badgeEl) {
            badgeEl.innerText = count;
            badgeEl.style.display = count > 0 ? 'inline-block' : 'none';
        }
    }

    // =========================================================
    // Filter Action Handlers
    // =========================================================
    function handleQrSearch(val) {
        qrState.search = val.trim();
        const clearBtn = document.getElementById('qr-search-clear');
        if (clearBtn) clearBtn.style.display = qrState.search ? 'block' : 'none';

        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            loadQuarterlyResults();
        }, 220);
    }

    function clearQrSearch() {
        qrState.search = '';
        const input = document.getElementById('qr-search-input');
        if (input) input.value = '';
        const clearBtn = document.getElementById('qr-search-clear');
        if (clearBtn) clearBtn.style.display = 'none';
        loadQuarterlyResults();
    }

    function setQrIndustryFilter(ind) {
        qrState.industry = ind || 'all';
        loadQuarterlyResults();
    }

    function setQrMcapTier(tier) {
        qrState.mcap_tier = tier || 'all';
        qrState.min_mcap = null;
        qrState.max_mcap = null;
        loadQuarterlyResults();
    }

    function applyCustomMcap(source) {
        const minEl = document.getElementById(`qr-mcap-min-${source}`);
        const maxEl = document.getElementById(`qr-mcap-max-${source}`);
        const minVal = minEl && minEl.value ? parseFloat(minEl.value) : null;
        const maxVal = maxEl && maxEl.value ? parseFloat(maxEl.value) : null;

        qrState.mcap_tier = 'custom';
        qrState.min_mcap = minVal;
        qrState.max_mcap = maxVal;
        loadQuarterlyResults();
    }

    function setQrSorting(sort) {
        qrState.sorting = sort || 'latest';
        loadQuarterlyResults();
    }

    function setQrExchange(exch) {
        qrState.exchange = exch || 'all';
        loadQuarterlyResults();
    }

    function setQrWatchlistScope(scope) {
        qrState.watchlist = scope || 'all';
        loadQuarterlyResults();
    }

    function setQrDateFilter(d) {
        qrState.date = d || '';
        loadQuarterlyResults();
    }

    function clearAllQrFilters() {
        qrState.search = '';
        qrState.industry = 'all';
        qrState.mcap_tier = 'all';
        qrState.min_mcap = null;
        qrState.max_mcap = null;
        qrState.sorting = 'latest';
        qrState.exchange = 'all';
        qrState.watchlist = 'all';
        qrState.date = '';

        const searchInput = document.getElementById('qr-search-input');
        if (searchInput) searchInput.value = '';
        const clearBtn = document.getElementById('qr-search-clear');
        if (clearBtn) clearBtn.style.display = 'none';

        const indSearchDesk = document.getElementById('qr-industry-search');
        if (indSearchDesk) indSearchDesk.value = '';
        const indSearchMob = document.getElementById('qr-industry-search-mobile');
        if (indSearchMob) indSearchMob.value = '';

        loadQuarterlyResults();
    }

    function toggleQrAccordion(el) {
        const section = el.closest('.qr-filter-section');
        if (section) section.classList.toggle('open');
    }

    function filterIndustryList(query, source) {
        const q = (query || '').toLowerCase().trim();
        const listEl = document.getElementById(`qr-industry-list-${source}`);
        if (!listEl) return;

        const items = listEl.querySelectorAll('.qr-radio-item');
        items.forEach(item => {
            const indName = item.getAttribute('data-industry');
            if (!indName) return; // 'all' stays visible
            if (!q || indName.includes(q)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    }

    // =========================================================
    // Responsive Mobile Filter Bottom Sheet
    // =========================================================
    function openQrMobileFilter() {
        const modal = document.getElementById('qrMobileFilterModal');
        if (!modal) return;
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function closeQrMobileFilter() {
        const modal = document.getElementById('qrMobileFilterModal');
        if (!modal) return;
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }

    function openStockChart(symbol) {
        if (!symbol) return;
        if (typeof window.openInHouseChart === 'function') {
            window.openInHouseChart(symbol);
        } else if (typeof openInHouseChart === 'function') {
            openInHouseChart(symbol);
        }
    }

    // Escape listener
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeQrMobileFilter();
        }
    });

    // Expose global methods
    window.loadQuarterlyResults = loadQuarterlyResults;
    window.handleQrSearch = handleQrSearch;
    window.clearQrSearch = clearQrSearch;
    window.setQrIndustryFilter = setQrIndustryFilter;
    window.setQrMcapTier = setQrMcapTier;
    window.applyCustomMcap = applyCustomMcap;
    window.setQrSorting = setQrSorting;
    window.setQrExchange = setQrExchange;
    window.setQrWatchlistScope = setQrWatchlistScope;
    window.setQrDateFilter = setQrDateFilter;
    window.clearAllQrFilters = clearAllQrFilters;
    window.toggleQrAccordion = toggleQrAccordion;
    window.filterIndustryList = filterIndustryList;
    window.openQrMobileFilter = openQrMobileFilter;
    window.closeQrMobileFilter = closeQrMobileFilter;
    window.openStockChart = openStockChart;
    window.qrState = qrState;

    // Auto-init on DOMContentLoaded if starting on quarterly-results tab
    document.addEventListener('DOMContentLoaded', () => {
        if (window.INITIAL_TAB === 'quarterly-results' || window.currentTab === 'quarterly-results') {
            loadQuarterlyResults();
        }
    });

})();
