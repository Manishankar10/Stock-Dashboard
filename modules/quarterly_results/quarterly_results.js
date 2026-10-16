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
        watchlist: 'portfolio', // DEFAULT IS PORTFOLIO
        date: '',
        data: null,
        isFetching: false,
        pageSize: 10,
        currentPage: 1
    };

    let searchDebounceTimer = null;

    function cleanSymbol(sym) {
        if (!sym) return '';
        return String(sym).trim().toUpperCase().replace(/\.NS$|\.BO$/, '');
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

    /**
     * Load quarterly results data from API
     */
    async function loadQuarterlyResults(forceRefresh = false) {
        if (qrState.isFetching) return;
        qrState.isFetching = true;

        const refreshBtn = document.getElementById('qr-refresh-btn');
        if (refreshBtn) refreshBtn.classList.add('refreshing');

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
        if (qrState.watchlist) params.set('watchlist', qrState.watchlist);
        if (qrState.date) params.set('date', qrState.date);
        if (forceRefresh) params.set('refresh', '1');

        try {
            const res = await fetch(`/api/quarterly-results?${params.toString()}`);
            if (!res.ok) throw new Error(`HTTP error ${res.status}`);
            const data = await res.json();
            qrState.data = data;
            qrState.currentPage = 1;
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
            if (refreshBtn) refreshBtn.classList.remove('refreshing');
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
                        <span class="qr-company-name" onclick="window.openStockFundamentals('${sym}')" title="Click to view fundamentals for ${comp}">
                            ${comp} <span class="qr-ext-icon">↗</span>
                        </span>
                        ${item.pdf_url ? `<a href="${pdfUrl}" target="_blank" rel="noopener noreferrer" class="qr-pdf-link" title="Download Exchange PDF Filing">PDF <span class="qr-pdf-icon">📄</span></a>` : ''}
                        ${ind ? `<span class="qr-industry-pill">${ind}</span>` : ''}
                    </div>
                    <div class="qr-key-stats">
                        <span class="qr-stat-item qr-stat-price-clickable" onclick="window.openStockChart('${sym}')" title="Click to view technical chart for ${comp}">
                            <span class="qr-stat-label">Price</span> <span class="qr-stat-val qr-stat-price-val">${price} <span class="qr-price-chart-glyph">📈</span></span>
                        </span>
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

        // 0. Sync Quarter Title Tag
        const qLabel = data.quarter_label || data.current_quarter || 'Q2 FY27';
        const titleQuarterEl = document.getElementById('qr-title-quarter');
        if (titleQuarterEl) {
            titleQuarterEl.textContent = `(${qLabel})`;
        }

        // 1. Counters
        const count = data.total_count || 0;
        const total = data.market_total || 0;
        const totalCountEl = document.getElementById('qr-total-count');

        if (totalCountEl) totalCountEl.innerText = `(${total} total)`;

        // 2. Render Cards Stream with Pagination support
        renderCurrentResultsStream();

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
     * Render current results stream with pagination if No Filter is chosen
     */
    function renderCurrentResultsStream() {
        if (!qrState.data) return;

        const allResults = qrState.data.results || [];
        const total = allResults.length;
        const streamEl = document.getElementById('qr-cards-stream');
        const emptyEl = document.getElementById('qr-empty-state');
        const paginationToolbar = document.getElementById('qr-pagination-toolbar');
        const paginationBottom = document.getElementById('qr-pagination-bottom');
        const filteredCountEl = document.getElementById('qr-filtered-count');
        const bottomCountEl = document.getElementById('qr-bottom-count-text');

        if (filteredCountEl) filteredCountEl.innerText = total;
        if (bottomCountEl) bottomCountEl.innerText = `${total} results`;

        if (total === 0) {
            if (streamEl) {
                streamEl.innerHTML = '';
                streamEl.style.display = 'none';
            }
            if (emptyEl) emptyEl.style.display = 'block';
            if (paginationToolbar) paginationToolbar.style.display = 'none';
            if (paginationBottom) paginationBottom.style.display = 'none';
            return;
        }

        if (emptyEl) emptyEl.style.display = 'none';

        // Check if watchlist scope is 'all' ("No filter")
        const isNoFilter = qrState.watchlist === 'all';

        let pagedResults = allResults;
        let startIndex = 0;
        let endIndex = total;

        if (isNoFilter) {
            if (paginationToolbar) paginationToolbar.style.display = 'flex';
            if (paginationBottom) paginationBottom.style.display = 'flex';

            // Sync select element
            const selectEl = document.getElementById('qr-page-size-select');
            if (selectEl) selectEl.value = String(qrState.pageSize);

            if (qrState.pageSize === 'all') {
                pagedResults = allResults;
                startIndex = 0;
                endIndex = total;
                renderPaginationNav(1, 1, total);
            } else {
                const pageSize = Number(qrState.pageSize) || 10;
                const totalPages = Math.ceil(total / pageSize) || 1;
                if (qrState.currentPage > totalPages) qrState.currentPage = totalPages;
                if (qrState.currentPage < 1) qrState.currentPage = 1;

                startIndex = (qrState.currentPage - 1) * pageSize;
                endIndex = Math.min(startIndex + pageSize, total);
                pagedResults = allResults.slice(startIndex, endIndex);

                renderPaginationNav(qrState.currentPage, totalPages, total);
            }

            const startEl = document.getElementById('qr-page-start');
            const endEl = document.getElementById('qr-page-end');
            const totalEl = document.getElementById('qr-page-total');
            if (startEl) startEl.innerText = total > 0 ? (startIndex + 1) : 0;
            if (endEl) endEl.innerText = endIndex;
            if (totalEl) totalEl.innerText = total;
        } else {
            // Specific portfolio or watchlist: show directly without pagination
            if (paginationToolbar) paginationToolbar.style.display = 'none';
            if (paginationBottom) paginationBottom.style.display = 'none';
            pagedResults = allResults;
        }

        if (streamEl) {
            streamEl.innerHTML = pagedResults.map(item => buildResultCardHtml(item)).join('');
            streamEl.style.display = 'flex';
        }
    }

    /**
     * Render bottom pagination navigation controls
     */
    function renderPaginationNav(currentPage, totalPages, total) {
        const navEl = document.getElementById('qr-pagination-nav');
        if (!navEl) return;

        if (totalPages <= 1) {
            navEl.innerHTML = `<span class="qr-page-static-info">Showing all ${total} results</span>`;
            return;
        }

        let html = '';

        // Previous button
        const prevDisabled = currentPage <= 1 ? 'disabled' : '';
        html += `
            <button type="button" class="qr-page-btn qr-page-prev ${prevDisabled}" ${prevDisabled ? 'disabled' : ''} onclick="window.setQrPage(${currentPage - 1})" title="Previous Page">
                ‹ Prev
            </button>
        `;

        // Page numbers
        for (let p = 1; p <= totalPages; p++) {
            if (totalPages > 7) {
                if (p > 1 && p < currentPage - 2) {
                    if (p === 2) html += '<span class="qr-page-dots">…</span>';
                    continue;
                }
                if (p < totalPages && p > currentPage + 2) {
                    if (p === totalPages - 1) html += '<span class="qr-page-dots">…</span>';
                    continue;
                }
            }
            const isActive = p === currentPage;
            html += `
                <button type="button" class="qr-page-btn qr-page-num ${isActive ? 'active' : ''}" onclick="window.setQrPage(${p})">
                    ${p}
                </button>
            `;
        }

        // Next button
        const nextDisabled = currentPage >= totalPages ? 'disabled' : '';
        html += `
            <button type="button" class="qr-page-btn qr-page-next ${nextDisabled}" ${nextDisabled ? 'disabled' : ''} onclick="window.setQrPage(${currentPage + 1})" title="Next Page">
                Next ›
            </button>
        `;

        navEl.innerHTML = html;
    }

    function setQrPage(pageNum) {
        qrState.currentPage = Number(pageNum) || 1;
        renderCurrentResultsStream();
        const topEl = document.querySelector('.qr-controls-card');
        if (topEl) {
            topEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    function setQrPageSize(size) {
        qrState.pageSize = size === 'all' ? 'all' : Number(size);
        qrState.currentPage = 1;
        renderCurrentResultsStream();
    }

    /**
     * Smoothly scroll horizontal date pills
     */
    function scrollQrDates(direction) {
        const list = document.getElementById('qr-dates-list');
        if (!list) return;
        const scrollAmount = Math.max(180, Math.floor(list.clientWidth * 0.6));
        list.scrollBy({ left: direction * scrollAmount, behavior: 'smooth' });
    }

    /**
     * Update disabled / opacity state of left and right date scroll buttons
     */
    function updateQrDateNavButtons() {
        const list = document.getElementById('qr-dates-list');
        const prevBtn = document.getElementById('qr-date-prev');
        const nextBtn = document.getElementById('qr-date-next');
        if (!list) return;

        const hasOverflow = list.scrollWidth > list.clientWidth + 2;
        if (prevBtn) {
            if (!hasOverflow) {
                prevBtn.style.opacity = '0.25';
                prevBtn.disabled = true;
            } else {
                const atStart = list.scrollLeft <= 2;
                prevBtn.disabled = atStart;
                prevBtn.style.opacity = atStart ? '0.25' : '1';
            }
        }
        if (nextBtn) {
            if (!hasOverflow) {
                nextBtn.style.opacity = '0.25';
                nextBtn.disabled = true;
            } else {
                const atEnd = list.scrollLeft + list.clientWidth >= list.scrollWidth - 4;
                nextBtn.disabled = atEnd;
                nextBtn.style.opacity = atEnd ? '0.25' : '1';
            }
        }
    }

    /**
     * Bind mouse wheel, drag-to-scroll, and scroll listeners
     */
    function initQrDatesScroll() {
        const list = document.getElementById('qr-dates-list');
        if (!list || list.dataset.scrollBound) return;
        list.dataset.scrollBound = 'true';

        // Mouse wheel horizontal scroll
        list.addEventListener('wheel', function(e) {
            if (list.scrollWidth > list.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                e.preventDefault();
                list.scrollLeft += e.deltaY;
            }
        }, { passive: false });

        // Scroll listener to update nav arrows
        list.addEventListener('scroll', function() {
            updateQrDateNavButtons();
        }, { passive: true });

        // Mouse drag-to-scroll support
        let isDown = false;
        let startX = 0;
        let scrollStart = 0;
        let hasDragged = false;

        list.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            isDown = true;
            hasDragged = false;
            startX = e.pageX - list.offsetLeft;
            scrollStart = list.scrollLeft;
        });

        window.addEventListener('mouseup', function() {
            if (isDown) {
                isDown = false;
                list.style.cursor = '';
            }
        });

        list.addEventListener('mousemove', function(e) {
            if (!isDown) return;
            const x = e.pageX - list.offsetLeft;
            const walk = (x - startX);
            if (Math.abs(walk) > 4) {
                hasDragged = true;
                list.style.cursor = 'grabbing';
                list.scrollLeft = scrollStart - walk;
            }
        });

        // Prevent accidental pill click after dragging
        list.addEventListener('click', function(e) {
            if (hasDragged) {
                e.preventDefault();
                e.stopPropagation();
                hasDragged = false;
            }
        }, true);

        window.addEventListener('resize', function() {
            updateQrDateNavButtons();
        }, { passive: true });
    }

    /**
     * Render horizontal date pills
     */
    function renderDatesNav(dates) {
        const navEl = document.getElementById('qr-dates-list');
        if (!navEl) return;

        const isAllActive = !qrState.date;
        const qLabel = (qrState.data && (qrState.data.quarter_label || qrState.data.current_quarter)) || 'Q2';
        let html = `
            <button type="button" class="qr-date-pill ${isAllActive ? 'active' : ''}" data-date="" onclick="window.setQrDateFilter('')" title="Show all results for this quarter">
                All ${escapeHtml(qLabel)} Results
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

        initQrDatesScroll();

        // Auto-scroll active pill smoothly into view
        requestAnimationFrame(() => {
            const activePill = navEl.querySelector('.qr-date-pill.active');
            if (activePill) {
                const pillLeft = activePill.offsetLeft;
                const pillWidth = activePill.offsetWidth;
                const navWidth = navEl.clientWidth;
                const targetScroll = pillLeft - (navWidth / 2) + (pillWidth / 2);
                navEl.scrollTo({ left: Math.max(0, targetScroll), behavior: 'smooth' });
            }
            updateQrDateNavButtons();
        });
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
            const isPf = qrState.watchlist === 'portfolio';
            const isAny = qrState.watchlist === 'any';

            let html = `
                <label class="qr-radio-item ${isAll ? 'active' : ''}">
                    <input type="radio" name="qr-watchlist-${source}" value="all" ${isAll ? 'checked' : ''} onchange="window.setQrWatchlistScope('all')">
                    <span class="qr-radio-label">No filter</span>
                    <span class="qr-check-icon">✓</span>
                </label>
                <label class="qr-radio-item ${isPf ? 'active' : ''}">
                    <input type="radio" name="qr-watchlist-${source}" value="portfolio" ${isPf ? 'checked' : ''} onchange="window.setQrWatchlistScope('portfolio')">
                    <span class="qr-radio-label">In portfolio</span>
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
        qrState.watchlist = scope || 'portfolio';
        qrState.currentPage = 1;
        loadQuarterlyResults();
    }

    function setQrDateFilter(d) {
        qrState.date = d || '';
        qrState.currentPage = 1;
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
        qrState.watchlist = 'portfolio';
        qrState.date = '';
        qrState.currentPage = 1;
        qrState.pageSize = 10;

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

    function openStockFundamentals(symbol) {
        if (!symbol) return;
        const clean = cleanSymbol(symbol);
        if (typeof window.openFundamentalsModal === 'function') {
            window.openFundamentalsModal(clean);
        } else if (typeof openFundamentalsModal === 'function') {
            openFundamentalsModal(clean);
        }
    }

    function openStockChart(symbol) {
        if (!symbol) return;
        const clean = cleanSymbol(symbol);
        if (typeof window.openInHouseChart === 'function') {
            window.openInHouseChart(clean);
        } else if (typeof openInHouseChart === 'function') {
            openInHouseChart(clean);
        } else if (typeof window.openChart === 'function') {
            window.openChart(clean);
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
    window.openStockFundamentals = openStockFundamentals;
    window.openStockChart = openStockChart;
    window.setQrPage = setQrPage;
    window.setQrPageSize = setQrPageSize;
    window.scrollQrDates = scrollQrDates;
    window.updateQrDateNavButtons = updateQrDateNavButtons;
    window.initQrDatesScroll = initQrDatesScroll;
    window.qrState = qrState;

    // Auto-init on DOMContentLoaded if starting on quarterly-results tab
    document.addEventListener('DOMContentLoaded', () => {
        if (window.INITIAL_TAB === 'quarterly-results' || window.currentTab === 'quarterly-results') {
            loadQuarterlyResults();
        }
    });

})();
