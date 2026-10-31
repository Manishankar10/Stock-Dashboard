(function () {
    const API_URL = '/api/watchlist-official-feeds';
    let currentWatchlist = '';
    let currentPage = 1;
    let currentSubcategory = '';
    let currentSymbol = '';
    let loading = false;
    let loadedItems = [];
    let knownSubcategories = new Set();
    let hasMore = true;

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[char]));
    }

    function getDisplayTitle(val) {
        if (!val || val === 'All Watchlists' || val.toLowerCase() === 'all watchlists' || val.toLowerCase() === 'all_watchlists') {
            return '';
        }
        if (val === 'Portfolio' || val.toLowerCase() === 'portfolio' || val.toLowerCase() === 'all portfolios') {
            return 'Portfolio';
        }
        if (typeof val === 'string' && val.startsWith('portfolio:')) {
            return val.replace('portfolio:', '').trim() + ' (Portfolio)';
        }
        return val;
    }

    function populateWatchlistSelect(modal, targetVal, watchlistsList, portfoliosList) {
        const watchlistSelect = modal.querySelector('#of-watchlist');
        if (!watchlistSelect) return;

        let wls = watchlistsList;
        if (!wls && window.watchlistsData) {
            wls = Object.keys(window.watchlistsData);
        }
        let pfs = portfoliosList;
        if (!pfs && window.portfoliosData) {
            pfs = Object.keys(window.portfoliosData);
        }

        let effectiveVal = targetVal || currentWatchlist;
        if (!effectiveVal || effectiveVal === 'All Watchlists' || effectiveVal.toLowerCase() === 'all watchlists' || effectiveVal.toLowerCase() === 'all_watchlists') {
            const activeFromDom = document.querySelector('#watchlist-selector-mount .pf-select-btn.active')?.dataset.watchlistName;
            if (activeFromDom && wls && wls.includes(activeFromDom)) {
                effectiveVal = activeFromDom;
            } else if (wls && wls.length > 0) {
                effectiveVal = wls[0];
            } else if (pfs && pfs.length > 0) {
                effectiveVal = 'Portfolio';
            } else {
                effectiveVal = '';
            }
        }

        let optionsHtml = '';

        // 1. Individual Watchlists
        if (wls && wls.length > 0) {
            optionsHtml += `<optgroup label="Watchlists">`;
            wls.forEach(wl => {
                const isSel = effectiveVal === wl ? 'selected' : '';
                optionsHtml += `<option value="${esc(wl)}" ${isSel}>${esc(wl)}</option>`;
            });
            optionsHtml += `</optgroup>`;
        }

        // 2. Portfolio Options
        optionsHtml += `<optgroup label="Portfolio">`;
        const isPf = (effectiveVal === 'Portfolio');
        optionsHtml += `<option value="Portfolio" ${isPf ? 'selected' : ''}>💼 Portfolio (All)</option>`;
        if (pfs && pfs.length > 0) {
            pfs.forEach(pf => {
                const pfVal = `portfolio:${pf}`;
                const isSel = effectiveVal === pfVal ? 'selected' : '';
                optionsHtml += `<option value="${esc(pfVal)}" ${isSel}>💼 ${esc(pf)}</option>`;
            });
        }
        optionsHtml += `</optgroup>`;

        watchlistSelect.innerHTML = optionsHtml;
        watchlistSelect.value = effectiveVal;
        currentWatchlist = watchlistSelect.value || effectiveVal;
        const titleEl = modal.querySelector('#of-watchlist-title');
        if (titleEl) titleEl.textContent = getDisplayTitle(currentWatchlist);
    }

    function ensureModal() {
        let overlay = document.getElementById('watchlistOfficialFeedsModal');
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'watchlistOfficialFeedsModal';
        overlay.className = 'of-modal-overlay';
        overlay.innerHTML = `
            <section class="of-modal" role="dialog" aria-modal="true" aria-labelledby="of-modal-title">
                <header class="of-header">
                    <div>
                        <h2 id="of-modal-title">Official Feeds - <span id="of-watchlist-title"></span></h2>
                    </div>
                    <div class="of-header-actions">
                        <button type="button" class="wl-refresh-btn of-refresh" id="of-refresh" title="Refresh Official Feeds" aria-label="Refresh Official Feeds">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                            </svg>
                        </button>
                        <button type="button" class="of-close" aria-label="Close official feeds" id="of-close">×</button>
                    </div>
                </header>
                <div class="of-toolbar">
                    <span class="of-category">Company Update</span>
                    <label class="of-filter-label" for="of-watchlist">Watchlist</label>
                    <select id="of-watchlist" class="of-select"></select>
                    <label class="of-filter-label" for="of-stock">Stock</label>
                    <select id="of-stock" class="of-select"><option value="">All stocks</option></select>
                    <label class="of-filter-label" for="of-subcategory">Subcategory</label>
                    <select id="of-subcategory" class="of-select"><option value="">All subcategories</option></select>
                    <span id="of-count" class="of-count"></span>
                </div>
                <main id="of-feed" class="of-feed" aria-live="polite"></main>
                <div class="of-source-note">Filings link to official exchange pages. AI summaries send the linked public filing to Google Gemini when requested.</div>
            </section>`;
        document.body.appendChild(overlay);
        populateWatchlistSelect(overlay, currentWatchlist);

        overlay.addEventListener('click', event => {
            if (event.target === overlay) closeWatchlistOfficialFeeds();
        });
        overlay.querySelector('#of-close').addEventListener('click', closeWatchlistOfficialFeeds);
        overlay.querySelector('#of-refresh').addEventListener('click', () => {
            currentPage = 1;
            loadedItems = [];
            knownSubcategories = new Set();
            hasMore = true;
            loadPage(true);
        });
        overlay.querySelector('#of-subcategory').addEventListener('change', event => {
            currentSubcategory = event.target.value;
            currentPage = 1;
            loadedItems = [];
            knownSubcategories = new Set();
            hasMore = true;
            loadPage();
        });
        overlay.querySelector('#of-watchlist').addEventListener('change', event => {
            currentWatchlist = event.target.value;
            currentSymbol = '';
            currentSubcategory = '';
            currentPage = 1;
            loadedItems = [];
            knownSubcategories = new Set();
            hasMore = true;
            overlay.querySelector('#of-watchlist-title').textContent = getDisplayTitle(currentWatchlist);
            overlay.querySelector('#of-stock').value = '';
            overlay.querySelector('#of-subcategory').value = '';
            loadPage();
        });
        overlay.querySelector('#of-stock').addEventListener('change', event => {
            currentSymbol = event.target.value;
            currentSubcategory = '';
            currentPage = 1;
            loadedItems = [];
            knownSubcategories = new Set();
            hasMore = true;
            overlay.querySelector('#of-subcategory').value = '';
            loadPage();
        });
        return overlay;
    }

    window.openWatchlistOfficialFeeds = function (watchlistName, targetSymbol) {
        let initialWl = watchlistName;
        if (!initialWl || initialWl === 'All Watchlists' || initialWl.toLowerCase() === 'all watchlists' || initialWl.toLowerCase() === 'all_watchlists') {
            const activeFromDom = document.querySelector('#watchlist-selector-mount .pf-select-btn.active')?.dataset.watchlistName;
            if (activeFromDom) {
                initialWl = activeFromDom;
            } else if (window.watchlistsData && Object.keys(window.watchlistsData).length > 0) {
                initialWl = Object.keys(window.watchlistsData)[0];
            } else {
                initialWl = '';
            }
        }
        currentWatchlist = initialWl;
        currentPage = 1;
        currentSubcategory = '';
        loadedItems = [];
        knownSubcategories = new Set();
        hasMore = true;
        const modal = ensureModal();
        populateWatchlistSelect(modal, currentWatchlist);
        currentSymbol = targetSymbol ? String(targetSymbol).trim().toUpperCase().replace(/\.(NS|BO)$/i, '') : '';
        const stockSelect = modal.querySelector('#of-stock');
        if (stockSelect) stockSelect.value = currentSymbol;
        modal.querySelector('#of-subcategory').value = '';
        modal.classList.add('is-open');
        document.body.classList.add('of-modal-open');
        loadPage();
    };

    window.openOfficialFeedsModal = function (symbol, watchlistName) {
        let targetWl = watchlistName;
        const clean = (typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(symbol) : String(symbol || '').replace(/\.(NS|BS|BO)$/i, '')).trim().toUpperCase();
        if (!targetWl && window.watchlistsData && clean) {
            for (const [wl, list] of Object.entries(window.watchlistsData)) {
                if (Array.isArray(list) && list.some(item => {
                    const s = (typeof item === 'string' ? item : (item && item.symbol ? item.symbol : '')).replace(/\.(NS|BO)$/i, '').trim().toUpperCase();
                    return s === clean;
                })) {
                    targetWl = wl;
                    break;
                }
            }
        }
        window.openWatchlistOfficialFeeds(targetWl || '', clean || '');
    };

    window.closeWatchlistOfficialFeeds = function () {
        const modal = document.getElementById('watchlistOfficialFeedsModal');
        if (modal) modal.classList.remove('is-open');
        document.body.classList.remove('of-modal-open');
    };

    function formatDate(raw) {
        if (!raw) return 'Date unavailable';
        if (window.formatAppDateTime) return window.formatAppDateTime(raw);
        const date = new Date(raw);
        if (Number.isNaN(date.getTime())) return raw;
        const datePart = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
        const timePart = date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
        return `${datePart} at ${timePart}`;
    }

    function dateGroup(raw) {
        if (!raw) return 'Date unavailable';
        if (window.formatAppDate) return window.formatAppDate(raw);
        const date = new Date(raw);
        if (Number.isNaN(date.getTime())) return raw;
        return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    function renderItems(items, errorText) {
        const feed = document.getElementById('of-feed');
        const seen = new Set(loadedItems.map(item => item.id));
        (items || []).forEach(item => {
            if (!seen.has(item.id)) {
                seen.add(item.id);
                loadedItems.push(item);
            }
        });
        let previousGroup = '';
        const cards = loadedItems.map(item => {
            const group = dateGroup(item.date);
            const heading = group !== previousGroup ? `<div class="of-date-group">${esc(group)}</div>` : '';
            previousGroup = group;
            const link = item.url || item.source_page || '#';
            return `${heading}<article class="of-item">
                <div class="of-item-top">
                    <div class="of-company-line"><a class="of-company-link" href="#" data-of-fundamental="${esc(item.chart_symbol || item.symbol || '')}">${esc(item.company || 'Company')}</a><span class="of-name-separator"> - </span><a class="of-symbol-link" href="#" data-of-chart="${esc(item.chart_symbol || item.symbol || '')}">${esc(typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(item.symbol || '') : (item.symbol || '').replace(/\.(NS|BS|BO)$/i, ''))}</a></div>
                    <span class="of-item-date">${esc(formatDate(item.date))}</span>
                </div>
                <a class="of-subject" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(item.subject || 'Company announcement')} ↗</a>
                ${item.details ? `<p>${esc(item.details)}</p>` : ''}
                <div class="of-ai-summary">
                    ${item.ai_summary ? `<div class="of-ai-summary-text"><strong>Short description</strong><div>${esc(item.ai_summary)}</div></div>` : ''}
                    ${item.summary_error ? `<div class="of-ai-summary-error">${esc(item.summary_error)}</div>` : ''}
                    <button type="button" class="btn-secondary of-summary-button" data-of-summary-id="${esc(item.id || '')}" ${item.summarizing || item.ai_summary ? 'disabled' : ''}>${item.summarizing ? '<span class="of-spinner"></span> Summarizing…' : (item.ai_summary ? 'Summary ready' : '✨ Short description')}</button>
                </div>
            </article>`;
        }).join('');
        const empty = !loadedItems.length && !errorText ? '<div class="of-empty">No official company updates match this filter.</div>' : '';
        const loadButton = hasMore && !loading ? '<div class="of-load-more-wrap"><button type="button" class="btn-secondary of-load-more" id="of-load-more">Load more</button></div>' : '';
        const loader = loading && loadedItems.length ? '<div class="of-more-loading"><span class="of-spinner"></span>Loading more updates…</div>' : '';
        const endMessage = !hasMore && !loading && !errorText && loadedItems.length ? '<div class="of-end-message">that\'s it folks..</div>' : '';
        const error = errorText ? `<div class="of-error">${esc(errorText)}</div>` : '';
        feed.innerHTML = cards + empty + loader + error + loadButton + endMessage;
        feed.querySelectorAll('[data-of-fundamental]').forEach(link => link.addEventListener('click', event => {
            event.preventDefault();
            if (typeof window.openFundamentalsModal === 'function') window.openFundamentalsModal(link.dataset.ofFundamental);
        }));
        feed.querySelectorAll('[data-of-chart]').forEach(link => link.addEventListener('click', event => {
            event.preventDefault();
            if (typeof window.openInHouseChart === 'function') window.openInHouseChart(link.dataset.ofChart);
        }));
        feed.querySelectorAll('.of-summary-button:not(:disabled)').forEach(button => button.addEventListener('click', async () => {
            const item = loadedItems.find(candidate => String(candidate.id || '') === button.dataset.ofSummaryId && !candidate.ai_summary && !candidate.summarizing);
            if (!item) return;
            item.summarizing = true;
            item.summary_error = '';
            renderItems([]);
            try {
                const response = await fetch(`${API_URL}/summarize`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: item.url || item.source_page, company: item.company, subject: item.subject, details: item.details })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Could not summarize this filing.');
                item.ai_summary = result.summary;
            } catch (error) {
                item.summary_error = error.message || 'Could not summarize this filing.';
            } finally {
                item.summarizing = false;
                renderItems([]);
            }
        }));
        const moreButton = feed.querySelector('#of-load-more');
        if (moreButton) moreButton.addEventListener('click', () => {
            if (!loading && hasMore) { currentPage++; loadPage(); }
        });
    }

    async function loadPage(refresh) {
        const modal = ensureModal();
        const feed = modal.querySelector('#of-feed');
        if (loading) return;
        loading = true;
        let scopeMsg = 'this watchlist';
        if (currentWatchlist.toLowerCase().includes('portfolio')) scopeMsg = 'your portfolio';
        else if (currentWatchlist) scopeMsg = `"${currentWatchlist}"`;
        if (loadedItems.length) renderItems([]);
        else feed.innerHTML = `<div class="of-loading"><span class="of-spinner"></span>Loading official exchange announcements for ${scopeMsg}…</div>`;
        const refreshButton = modal.querySelector('#of-refresh');
        if (refreshButton) refreshButton.classList.add('refreshing');
        let loadError = '';
        try {
            const params = new URLSearchParams({ watchlist: currentWatchlist, page: String(currentPage) });
            if (currentSubcategory) params.set('subcategory', currentSubcategory);
            if (currentSymbol) params.set('symbol', currentSymbol);
            if (refresh) params.set('refresh', '1');
            const response = await fetch(`${API_URL}?${params.toString()}`, { cache: 'no-store' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Could not load official feeds.');

            const select = modal.querySelector('#of-subcategory');
            const selected = currentSubcategory;
            populateWatchlistSelect(modal, data.watchlist || currentWatchlist, data.watchlists, data.portfolios);

            const stockSelect = modal.querySelector('#of-stock');
            const stocksList = (data.stocks || []).slice();
            if (currentSymbol && !stocksList.includes(currentSymbol)) {
                stocksList.unshift(currentSymbol);
            }
            stockSelect.innerHTML = '<option value="">All stocks</option>' + stocksList.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
            stockSelect.value = currentSymbol;
            (data.subcategories || []).forEach(value => knownSubcategories.add(value));
            select.innerHTML = '<option value="">All subcategories</option>' + [...knownSubcategories].sort((a, b) => a.localeCompare(b)).map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
            select.value = selected;
            hasMore = Boolean(data.has_more);
            renderItems(data.items);
            const isPf = currentWatchlist.toLowerCase().includes('portfolio');
            const countSuffix = isPf ? 'portfolio stocks' : 'stocks';
            modal.querySelector('#of-count').textContent = `${loadedItems.length} loaded\n${(typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(currentSymbol) : currentSymbol) || `${data.symbols_count || 0} ${countSuffix}`}`;
            if (data.failed_symbols) modal.querySelector('#of-count').title = `${data.failed_symbols} exchange queries did not return data.`;
        } catch (error) {
            loadError = error.message || 'Could not load official feeds.';
        } finally {
            loading = false;
            if (refreshButton) refreshButton.classList.remove('refreshing');
            renderItems([], loadError);
        }
    }

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') window.closeWatchlistOfficialFeeds();
    });
})();
