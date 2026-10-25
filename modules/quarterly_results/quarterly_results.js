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
        watchlist: 'portfolio', // DEFAULT IS IN PORTFOLIO
        date: '',
        custom_query: '',
        category: 'all',
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

        const refreshBtns = document.querySelectorAll('.qr-refresh-btn');
        refreshBtns.forEach(btn => btn.classList.add('refreshing'));

        const streamEl = document.getElementById('qr-cards-stream');
        if (streamEl) {
            streamEl.classList.remove('refreshing-drop');
            void streamEl.offsetWidth;
            streamEl.classList.add('refreshing-drop');
            setTimeout(() => {
                if (streamEl) streamEl.classList.remove('refreshing-drop');
            }, 600);
        }
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
        if (qrState.custom_query) params.set('custom_query', qrState.custom_query);
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
            refreshBtns.forEach(btn => btn.classList.remove('refreshing'));
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
        const ind = escapeHtml(item.industry || '');
        let rawPdf = item.pdf_url || '';
        let pdfUrl = '#';
        if (rawPdf) {
            if (rawPdf.includes('bseindia') || rawPdf.includes('nseindia')) {
                pdfUrl = escapeHtml(rawPdf);
            } else if (rawPdf.includes('screener.in')) {
                pdfUrl = `/api/quarterly-results/pdf-open?target=${encodeURIComponent(rawPdf)}`;
            } else {
                pdfUrl = escapeHtml(rawPdf);
            }
        }

        const quarters = item.quarters || (qrState.data && qrState.data.quarters) || {};

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

        const xbrlUrl = item.xbrl_url ? escapeHtml(item.xbrl_url) : '';

        return `
            <div class="qr-result-card" data-symbol="${sym}">
                <div class="qr-card-header">
                    <div class="qr-company-left">
                        <span class="qr-company-name" onclick="window.openStockFundamentals('${sym}')" title="Click to view fundamentals for ${comp}">
                            ${comp} <span class="qr-ext-icon">↗</span>
                        </span>
                        ${item.pdf_url ? `<a href="${pdfUrl}" target="_blank" rel="noopener noreferrer" class="qr-pdf-link" title="Download Exchange PDF Filing">PDF <span class="qr-pdf-icon">📄</span></a>` : ''}
                        ${xbrlUrl ? `<a href="${xbrlUrl}" target="_blank" rel="noopener noreferrer" class="qr-xbrl-link" title="View Official SEBI / BSE XBRL XML">XBRL <span class="qr-xbrl-icon">📑</span></a>` : ''}
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
                            <col class="qr-col-metric" style="width: 22%;">
                            <col class="qr-col-yoy" style="width: 18%;">
                            <col class="qr-col-q" style="width: 20%;">
                            <col class="qr-col-q" style="width: 20%;">
                            <col class="qr-col-q" style="width: 20%;">
                        </colgroup>
                        <thead>
                            ${buildShareholdingRowHtml(item.shareholding)}
                            <tr class="qr-dates-row">
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
        const qLabel = data.quarter_label || data.current_quarter || '';
        const titleQuarterEl = document.getElementById('qr-title-quarter');
        if (titleQuarterEl) {
            titleQuarterEl.textContent = qLabel ? `(${qLabel})` : '';
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

        // 8. Sync Custom Query UI & Chips
        updateCustomQueryUI();
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

        if (streamEl) streamEl.style.display = 'flex';
        if (emptyEl) emptyEl.style.display = 'none';

        // Check if pagination should be enabled:
        // Web: active when "No filter" (overall market)
        // Mobile: active at bottom of listing (as requested: "give pagination and how many to show options in bottom of listing in quarterly results in mobile")
        const isWeb = window.innerWidth > 768;
        const isNoFilter = qrState.watchlist === 'all';
        const enablePagination = isNoFilter || !isWeb;

        let pagedResults = allResults;
        let startIndex = 0;
        let endIndex = total;

        if (enablePagination) {
            if (paginationToolbar) paginationToolbar.style.display = isWeb ? 'flex' : 'none';
            if (paginationBottom) paginationBottom.style.display = 'flex';
            const bottomSummaryEl = document.getElementById('qr-bottom-summary');
            if (bottomSummaryEl) bottomSummaryEl.style.display = 'none';

            // Sync select elements
            const selectEl = document.getElementById('qr-page-size-select');
            if (selectEl) selectEl.value = String(qrState.pageSize);
            const bottomSelectEl = document.getElementById('qr-bottom-page-size-select');
            if (bottomSelectEl) bottomSelectEl.value = String(qrState.pageSize);

            // Sync size pills in bottom bar if present
            document.querySelectorAll('.qr-size-pill').forEach(pill => {
                const pSize = pill.getAttribute('data-size');
                pill.classList.toggle('active', String(pSize) === String(qrState.pageSize));
            });

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

            const bStartEl = document.getElementById('qr-bottom-page-start');
            const bEndEl = document.getElementById('qr-bottom-page-end');
            const bTotalEl = document.getElementById('qr-bottom-page-total');
            if (bStartEl) bStartEl.innerText = total > 0 ? (startIndex + 1) : 0;
            if (bEndEl) bEndEl.innerText = endIndex;
            if (bTotalEl) bTotalEl.innerText = total;
        } else {
            // Specific portfolio or watchlist on Web: show directly without pagination
            if (paginationToolbar) paginationToolbar.style.display = 'none';
            if (paginationBottom) paginationBottom.style.display = 'none';
            pagedResults = allResults;
        }

        if (streamEl) {
            streamEl.innerHTML = pagedResults.map(item => buildResultCardHtml(item)).join('');
            streamEl.style.display = 'flex';
        }

        if (enablePagination && paginationBottom) {
            paginationBottom.style.display = 'flex';
            // Force synchronous layout & compositor update so mobile browser paints footer immediately
            void paginationBottom.offsetHeight;
        }
    }

    /**
     * Render bottom pagination navigation controls
     */
    function renderPaginationNav(currentPage, totalPages, total) {
        const navEl = document.getElementById('qr-pagination-nav');
        const paginationBottom = document.getElementById('qr-pagination-bottom');
        if (!navEl) return;

        if (totalPages <= 1) {
            navEl.innerHTML = '';
            navEl.style.display = 'none';
            if (paginationBottom) paginationBottom.classList.remove('has-nav');
            return;
        }

        navEl.style.display = 'flex';
        if (paginationBottom) paginationBottom.classList.add('has-nav');

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
        qrState.pageSize = Number(size) || 10;
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
        const qLabel = (qrState.data && (qrState.data.quarter_label || qrState.data.current_quarter)) || '';
        let html = `
            <button type="button" class="qr-date-pill ${isAllActive ? 'active' : ''}" data-date="" onclick="window.setQrDateFilter('')" title="Show all results for this quarter">
                All ${qLabel ? escapeHtml(qLabel) + ' ' : ''}Results
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
        qrState.custom_query = '';
        qrState.category = 'all';
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


    /**
     * Helper to build shareholding row covering each column of results in quarterly table
     */
    function buildShareholdingRowHtml(shp) {
        if (!shp) return '';
        if (shp.promoter_pct === null && shp.fii_pct === null && shp.dii_pct === null && shp.public_pct === null) {
            return '';
        }
        const promVal = shp.promoter_pct !== null && shp.promoter_pct !== undefined ? `${Number(shp.promoter_pct).toFixed(1)}%` : '—';
        const fiiVal = shp.fii_pct !== null && shp.fii_pct !== undefined ? `${Number(shp.fii_pct).toFixed(2)}%` : '—';
        const diiVal = shp.dii_pct !== null && shp.dii_pct !== undefined ? `${Number(shp.dii_pct).toFixed(2)}%` : '—';
        const pubVal = shp.public_pct !== null && shp.public_pct !== undefined ? `${Number(shp.public_pct).toFixed(1)}%` : '—';

        let fiiChgHtml = '';
        if (shp.change_fii_pct !== null && shp.change_fii_pct !== undefined) {
            const c = Number(shp.change_fii_pct);
            if (c > 0) fiiChgHtml = ` <small class="pos">↑${c.toFixed(2)}%</small>`;
            else if (c < 0) fiiChgHtml = ` <small class="neg">↓${Math.abs(c).toFixed(2)}%</small>`;
        }

        let diiChgHtml = '';
        if (shp.change_dii_pct !== null && shp.change_dii_pct !== undefined) {
            const c = Number(shp.change_dii_pct);
            if (c > 0) diiChgHtml = ` <small class="pos">↑${c.toFixed(2)}%</small>`;
            else if (c < 0) diiChgHtml = ` <small class="neg">↓${Math.abs(c).toFixed(2)}%</small>`;
        }

        let promChgHtml = '';
        if (shp.change_promoter_pct !== null && shp.change_promoter_pct !== undefined) {
            const c = Number(shp.change_promoter_pct);
            if (c > 0) promChgHtml = ` <small class="pos">↑${c.toFixed(2)}%</small>`;
            else if (c < 0) promChgHtml = ` <small class="neg">↓${Math.abs(c).toFixed(2)}%</small>`;
        }

        return `
            <tr class="qr-shp-table-row">
                <th class="qr-col-metric qr-shp-hdr-label" title="Latest Shareholding Disclosures">
                    <span class="qr-shp-label-text">Shareholding</span>
                </th>
                <th class="qr-col-yoy qr-shp-col-cell">
                    <span class="qr-shp-pill promoter" title="Promoter Holding: ${promVal}">🏛️ Prom: <strong>${promVal}</strong>${promChgHtml}</span>
                </th>
                <th class="qr-col-q qr-shp-col-cell">
                    <span class="qr-shp-pill fii" title="FII / Foreign Institutional Holding: ${fiiVal}">🌐 FII: <strong>${fiiVal}</strong>${fiiChgHtml}</span>
                </th>
                <th class="qr-col-q qr-shp-col-cell">
                    <span class="qr-shp-pill dii" title="DII / Mutual Funds &amp; Domestic Institutional Holding: ${diiVal}">🏦 DII: <strong>${diiVal}</strong>${diiChgHtml}</span>
                </th>
                <th class="qr-col-q qr-shp-col-cell">
                    <span class="qr-shp-pill public" title="Public / Retail Holding: ${pubVal}">👥 Public: <strong>${pubVal}</strong></span>
                </th>
            </tr>
        `;
    }

    function buildShareholdingBadgeHtml(shp) {
        return buildShareholdingRowHtml(shp);
    }

    /**
     * Synchronize custom query banners and quick strategy chips
     */
    function updateCustomQueryUI() {
        const queryBar = document.getElementById('qr-active-query-bar');
        const queryTextEl = document.getElementById('qr-active-query-text');
        const customChip = document.getElementById('qr-chip-custom');
        const sidebarCustomStatus = document.getElementById('qr-sidebar-custom-status');
        const sidebarSnippet = document.getElementById('qr-sidebar-query-snippet');

        // Update chips active state
        document.querySelectorAll('.qr-category-chips-row .qr-filter-chip').forEach(btn => {
            const cat = btn.getAttribute('data-category');
            if (cat === qrState.category) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        if (qrState.custom_query) {
            if (queryBar) queryBar.style.display = 'flex';
            if (queryTextEl) queryTextEl.textContent = qrState.custom_query;
            if (customChip) {
                customChip.classList.add('active');
                customChip.title = `Active Custom Query: ${qrState.custom_query}`;
            }
            if (sidebarCustomStatus) sidebarCustomStatus.style.display = 'flex';
            if (sidebarSnippet) sidebarSnippet.textContent = qrState.custom_query;
        } else {
            if (queryBar) queryBar.style.display = 'none';
            if (sidebarCustomStatus) sidebarCustomStatus.style.display = 'none';
            if (customChip && qrState.category !== 'custom') {
                customChip.classList.remove('active');
                customChip.title = 'Build custom query combining quarterly results & shareholding data';
            }
        }
    }

    /**
     * Select a category quick strategy chip
     */
    function setQrCategoryChip(category) {
        if (category === 'custom') {
            openQrCustomModal();
            return;
        }

        qrState.category = category;
        qrState.currentPage = 1;

        if (category === 'all') {
            qrState.custom_query = '';
        } else if (category === 'qoq_momentum') {
            qrState.custom_query = 'qoq_sales > 10 and qoq_profit > 10';
        } else if (category === 'high_growth') {
            qrState.custom_query = 'yoy_sales > 15 and yoy_profit > 15';
        } else if (category === 'turnaround') {
            qrState.custom_query = 'yoy_profit > 30';
        } else if (category === 'fii_buying') {
            qrState.custom_query = 'fii_chg > 0.2';
        } else if (category === 'dii_buying') {
            qrState.custom_query = 'dii_chg > 0.2';
        } else if (category === 'promoter_gt50') {
            qrState.custom_query = 'promoter > 50';
        }

        updateCustomQueryUI();
        loadQuarterlyResults();
    }

    /**
     * Open Custom Query Modal
     */
    function openQrCustomModal() {
        const modal = document.getElementById('qr-custom-modal');
        if (!modal) return;
        const input = document.getElementById('qr-custom-query-input');
        if (input) {
            input.value = qrState.custom_query || '';
        }
        modal.style.display = 'flex';
        if (qrState.custom_query) {
            validateCustomQueryDebounced();
        } else {
            const feedback = document.getElementById('qr-custom-query-feedback');
            if (feedback) feedback.style.display = 'none';
            const badge = document.getElementById('qr-apply-count-badge');
            if (badge) badge.style.display = 'none';
        }
        setTimeout(() => {
            if (input) input.focus();
        }, 100);
    }

    /**
     * Close Custom Query Modal
     */
    function closeQrCustomModal() {
        const modal = document.getElementById('qr-custom-modal');
        if (modal) modal.style.display = 'none';
    }

    /**
     * Clear Custom Query
     */
    function clearQrCustomQuery() {
        qrState.custom_query = '';
        qrState.category = 'all';
        qrState.currentPage = 1;
        const input = document.getElementById('qr-custom-query-input');
        if (input) input.value = '';
        updateCustomQueryUI();
        loadQuarterlyResults();
    }

    /**
     * Token insertion helper for textarea
     */
    function insertTokenAtCursor(token) {
        const input = document.getElementById('qr-custom-query-input');
        if (!input) return;
        const start = input.selectionStart || 0;
        const end = input.selectionEnd || 0;
        const text = input.value;
        const before = text.substring(0, start);
        const after = text.substring(end, text.length);

        const padLeft = (before.length > 0 && !before.endsWith(' ') && !before.endsWith('(')) ? ' ' : '';
        const padRight = (!after.startsWith(' ') && !after.startsWith(')')) ? ' ' : '';

        input.value = before + padLeft + token + padRight + after;
        const newPos = start + padLeft.length + token.length + padRight.length;
        input.setSelectionRange(newPos, newPos);
        input.focus();
        validateCustomQueryDebounced();
    }

    /**
     * Live query validation via backend AST validator
     */
    let customValidateTimer = null;
    function validateCustomQueryDebounced() {
        if (customValidateTimer) clearTimeout(customValidateTimer);
        customValidateTimer = setTimeout(async () => {
            const input = document.getElementById('qr-custom-query-input');
            const feedback = document.getElementById('qr-custom-query-feedback');
            const applyBadge = document.getElementById('qr-apply-count-badge');
            if (!input || !feedback) return;

            const q = input.value.trim();
            if (!q) {
                feedback.style.display = 'none';
                if (applyBadge) applyBadge.style.display = 'none';
                return;
            }

            try {
                const res = await fetch(`/api/quarterly-results/validate-query?query=${encodeURIComponent(q)}`);
                const data = await res.json();
                feedback.style.display = 'block';

                if (data.valid) {
                    feedback.className = 'qr-query-feedback valid';
                    const sampleTxt = (data.matches && data.matches.length > 0) ? ` (${data.matches.join(', ')})` : '';
                    feedback.innerHTML = `<strong>✓ Valid Query:</strong> ${data.match_count} companies match${sampleTxt}`;
                    if (applyBadge) {
                        applyBadge.style.display = 'inline-block';
                        applyBadge.textContent = `${data.match_count} stocks`;
                    }
                } else {
                    feedback.className = 'qr-query-feedback error';
                    feedback.innerHTML = `<strong>✗ Syntax Error:</strong> ${escapeHtml(data.error || 'Invalid query expression')}`;
                    if (applyBadge) applyBadge.style.display = 'none';
                }
            } catch (err) {
                console.error('Validation error:', err);
            }
        }, 250);
    }

    /**
     * Bind Custom Query Modal Interactive Events
     */
    // Suggestion catalog for typeahead autocompletion while typing
    const QR_SUGGESTIONS = [
        // QoQ Financial Metrics
        { token: 'qoq_sales', badge: 'QoQ', type: 'qoq', desc: 'QoQ Sales / Revenue growth %' },
        { token: 'qoq_profit', badge: 'QoQ', type: 'qoq', desc: 'QoQ Net Profit / PAT growth %' },
        { token: 'qoq_op', badge: 'QoQ', type: 'qoq', desc: 'QoQ Operating profit growth %' },
        { token: 'qoq_eps', badge: 'QoQ', type: 'qoq', desc: 'QoQ EPS growth %' },
        { token: 'qoq_opm', badge: 'QoQ', type: 'qoq', desc: 'QoQ Operating margin change (pts)' },

        // YoY Financial Metrics
        { token: 'yoy_sales', badge: 'YoY', type: 'yoy', desc: 'YoY Sales / Revenue growth %' },
        { token: 'yoy_profit', badge: 'YoY', type: 'yoy', desc: 'YoY Net Profit / PAT growth %' },
        { token: 'yoy_op', badge: 'YoY', type: 'yoy', desc: 'YoY Operating profit growth %' },
        { token: 'yoy_eps', badge: 'YoY', type: 'yoy', desc: 'YoY EPS growth %' },
        { token: 'yoy_opm', badge: 'YoY', type: 'yoy', desc: 'YoY Operating margin change (pts)' },

        // Shareholding Shifts / Flows (QoQ)
        { token: 'fii_chg', badge: 'Flow', type: 'flow', desc: 'FII / Foreign QoQ shift %' },
        { token: 'dii_chg', badge: 'Flow', type: 'flow', desc: 'DII / Mutual funds QoQ shift %' },
        { token: 'promoter_chg', badge: 'Flow', type: 'flow', desc: 'Promoter QoQ stake shift %' },
        { token: 'public_chg', badge: 'Flow', type: 'flow', desc: 'Public / Retail QoQ shift %' },
        { token: 'inst_chg', badge: 'Flow', type: 'flow', desc: 'Total institutional (FII+DII) shift %' },

        // Shareholding Stake Levels
        { token: 'promoter', badge: 'Stake', type: 'stake', desc: 'Total Promoter holding %' },
        { token: 'fii', badge: 'Stake', type: 'stake', desc: 'Total FII holding %' },
        { token: 'dii', badge: 'Stake', type: 'stake', desc: 'Total DII holding %' },
        { token: 'public', badge: 'Stake', type: 'stake', desc: 'Total Public holding %' },

        // Absolute Values & Valuation
        { token: 'sales', badge: 'Values', type: 'val', desc: 'Latest quarter sales (₹ Cr)' },
        { token: 'net_profit', badge: 'Values', type: 'val', desc: 'Latest quarter net profit (₹ Cr)' },
        { token: 'opm', badge: 'Values', type: 'val', desc: 'Operating profit margin %' },
        { token: 'pe', badge: 'Valuation', type: 'val', desc: 'P/E ratio (TTM)' },
        { token: 'mcap', badge: 'Valuation', type: 'val', desc: 'Market capitalization (₹ Cr)' },
        { token: 'price', badge: 'Valuation', type: 'val', desc: 'Current stock price (₹)' },
        { token: 'eps', badge: 'Values', type: 'val', desc: 'Latest quarter EPS (₹)' },

        // Logic Operators
        { token: 'and', badge: 'Logic', type: 'logic', desc: 'Logical AND condition' },
        { token: 'or', badge: 'Logic', type: 'logic', desc: 'Logical OR condition' },
        { token: 'not', badge: 'Logic', type: 'logic', desc: 'Logical NOT operator' },
    ];

    let currentSuggMatches = [];
    let activeSuggIdx = 0;

    function escapeRegex(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function updateSuggestions() {
        const input = document.getElementById('qr-custom-query-input');
        const dropdown = document.getElementById('qr-query-suggestions');
        if (!input || !dropdown) return;

        const cursorPos = input.selectionStart || 0;
        const textBefore = input.value.substring(0, cursorPos);
        const match = textBefore.match(/([a-zA-Z_0-9]+)$/);

        if (!match) {
            dropdown.style.display = 'none';
            currentSuggMatches = [];
            activeSuggIdx = 0;
            return;
        }

        const query = match[1].toLowerCase();
        currentSuggMatches = QR_SUGGESTIONS.filter(item => item.token.toLowerCase().includes(query));

        if (currentSuggMatches.length === 0) {
            dropdown.style.display = 'none';
            activeSuggIdx = 0;
            return;
        }

        // Sort matches: startsWith query first, then shortest token length
        currentSuggMatches.sort((a, b) => {
            const aStarts = a.token.toLowerCase().startsWith(query);
            const bStarts = b.token.toLowerCase().startsWith(query);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            return a.token.length - b.token.length;
        });

        activeSuggIdx = 0;
        renderSuggestionsUI(query);
    }

    function renderSuggestionsUI(query) {
        const dropdown = document.getElementById('qr-query-suggestions');
        if (!dropdown) return;

        dropdown.innerHTML = currentSuggMatches.map((item, idx) => {
            const isActive = idx === activeSuggIdx ? 'active' : '';
            const reg = new RegExp(`(${escapeRegex(query)})`, 'gi');
            const tokenHl = escapeHtml(item.token).replace(reg, '<span class="match-hl">$1</span>');
            return `
                <div class="qr-suggestion-item ${isActive}" data-idx="${idx}">
                    <div class="qr-sugg-left">
                        <span class="qr-sugg-name">${tokenHl}</span>
                        <span class="qr-sugg-badge ${item.type}">${escapeHtml(item.badge)}</span>
                    </div>
                    <div class="qr-sugg-desc">${escapeHtml(item.desc)}</div>
                </div>
            `;
        }).join('');
        dropdown.style.display = 'block';
    }

    function highlightActiveSuggestion() {
        const dropdown = document.getElementById('qr-query-suggestions');
        if (!dropdown) return;
        const items = dropdown.querySelectorAll('.qr-suggestion-item');
        items.forEach((item, idx) => {
            if (idx === activeSuggIdx) {
                item.classList.add('active');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('active');
            }
        });
    }

    function applySelectedSuggestion(idx) {
        const input = document.getElementById('qr-custom-query-input');
        const dropdown = document.getElementById('qr-query-suggestions');
        if (!input || !currentSuggMatches[idx]) return;

        const item = currentSuggMatches[idx];
        const cursorPos = input.selectionStart || 0;
        const textBefore = input.value.substring(0, cursorPos);
        const textAfter = input.value.substring(cursorPos);
        const match = textBefore.match(/([a-zA-Z_0-9]+)$/);
        if (!match) return;

        const matchLen = match[1].length;
        const beforeWord = textBefore.substring(0, cursorPos - matchLen);
        const padRight = (textAfter.startsWith(' ') || textAfter.startsWith(')')) ? '' : ' ';

        input.value = beforeWord + item.token + padRight + textAfter;
        const newPos = beforeWord.length + item.token.length + padRight.length;
        input.setSelectionRange(newPos, newPos);
        input.focus();

        if (dropdown) dropdown.style.display = 'none';
        currentSuggMatches = [];
        activeSuggIdx = 0;

        validateCustomQueryDebounced();
    }

    function initCustomQueryModalListeners() {
        // Preset cards
        document.querySelectorAll('.qr-preset-card').forEach(card => {
            card.addEventListener('click', () => {
                const preset = card.getAttribute('data-preset');
                const input = document.getElementById('qr-custom-query-input');
                if (input && preset) {
                    input.value = preset;
                    input.focus();
                    validateCustomQueryDebounced();
                }
            });
        });

        // Token chips
        document.querySelectorAll('.qr-token-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const token = chip.getAttribute('data-token');
                if (token) insertTokenAtCursor(token);
            });
        });

        // Textarea input & autocomplete suggestion handling
        const input = document.getElementById('qr-custom-query-input');
        const suggDropdown = document.getElementById('qr-query-suggestions');

        if (input) {
            input.addEventListener('input', () => {
                updateSuggestions();
                validateCustomQueryDebounced();
            });

            input.addEventListener('click', updateSuggestions);

            input.addEventListener('keyup', (e) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                    updateSuggestions();
                }
            });

            input.addEventListener('keydown', (e) => {
                const isDropdownOpen = suggDropdown && suggDropdown.style.display === 'block' && currentSuggMatches.length > 0;

                if (isDropdownOpen) {
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        activeSuggIdx = (activeSuggIdx + 1) % currentSuggMatches.length;
                        highlightActiveSuggestion();
                        return;
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        activeSuggIdx = (activeSuggIdx - 1 + currentSuggMatches.length) % currentSuggMatches.length;
                        highlightActiveSuggestion();
                        return;
                    } else if (e.key === 'Enter' || e.key === 'Tab') {
                        e.preventDefault();
                        applySelectedSuggestion(activeSuggIdx);
                        return;
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        suggDropdown.style.display = 'none';
                        return;
                    }
                }

                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    const applyBtn = document.getElementById('qr-custom-apply-btn');
                    if (applyBtn) applyBtn.click();
                }
            });
        }

        // Suggestions mouse click
        if (suggDropdown) {
            suggDropdown.addEventListener('mousedown', (e) => {
                const item = e.target.closest('.qr-suggestion-item');
                if (item) {
                    e.preventDefault();
                    const idx = parseInt(item.getAttribute('data-idx'), 10);
                    applySelectedSuggestion(idx);
                }
            });
        }

        // Click outside closes suggestions
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.qr-query-input-wrap')) {
                if (suggDropdown) suggDropdown.style.display = 'none';
            }
        });

        // Clear input button
        const clearBtn = document.getElementById('qr-custom-clear-input');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (input) {
                    input.value = '';
                    input.focus();
                    validateCustomQueryDebounced();
                }
            });
        }

        // Apply filter button
        const applyBtn = document.getElementById('qr-custom-apply-btn');
        if (applyBtn) {
            applyBtn.addEventListener('click', async () => {
                const val = input ? input.value.trim() : '';
                if (!val) {
                    clearQrCustomQuery();
                    closeQrCustomModal();
                    return;
                }

                try {
                    const res = await fetch(`/api/quarterly-results/validate-query?query=${encodeURIComponent(val)}`);
                    const data = await res.json();
                    if (!data.valid) {
                        const feedback = document.getElementById('qr-custom-query-feedback');
                        if (feedback) {
                            feedback.style.display = 'block';
                            feedback.className = 'qr-query-feedback error';
                            feedback.innerHTML = `<strong>✗ Cannot Apply:</strong> ${escapeHtml(data.error)}`;
                        }
                        return;
                    }

                    qrState.custom_query = val;
                    qrState.category = 'custom';
                    qrState.currentPage = 1;
                    closeQrCustomModal();
                    updateCustomQueryUI();
                    loadQuarterlyResults();
                } catch (err) {
                    console.error('Error applying query:', err);
                }
            });
        }

        // Reset to all button
        const resetBtn = document.getElementById('qr-custom-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                clearQrCustomQuery();
                closeQrCustomModal();
            });
        }

        // Modal backdrop click to close
        const modal = document.getElementById('qr-custom-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeQrCustomModal();
            });
        }
    }

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
    window.openQrCustomModal = openQrCustomModal;
    window.closeQrCustomModal = closeQrCustomModal;
    window.clearQrCustomQuery = clearQrCustomQuery;
    window.setQrCategoryChip = setQrCategoryChip;
    window.setQrPage = setQrPage;
    window.setQrPageSize = setQrPageSize;
    window.scrollQrDates = scrollQrDates;
    window.updateQrDateNavButtons = updateQrDateNavButtons;
    window.initQrDatesScroll = initQrDatesScroll;
    window.qrState = qrState;

    // Auto-init on DOMContentLoaded if starting on quarterly-results tab
    document.addEventListener('DOMContentLoaded', () => {
        initCustomQueryModalListeners();
        if (window.INITIAL_TAB === 'quarterly-results' || window.currentTab === 'quarterly-results') {
            loadQuarterlyResults();
        }
    });

})();
