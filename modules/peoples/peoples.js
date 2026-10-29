/**
 * Capital Desk - Peoples (Superstar Investors, FII & DII) Client Module
 * Location: modules/peoples/peoples.js
 * Handles live directory viewing, tab segregation, search/filtering,
 * stake change highlight options, Last Qtr vs All Qtr view scopes,
 * and renders on-demand quarterly holding matrices.
 */

(function () {
    let _allInvestors = { ace: [], fii: [], dii: [] };
    let _currentCategory = 'ace';
    let _activePortfolioData = null;
    let _isLoadingDirectory = false;
    let _isLoadedOnce = false;
    let _highlightOption = 'all'; // 'all', 'inc', 'dec', 'both'
    let _quarterScope = 'last';    // 'last', 'all'

    // Helper: Escape HTML
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Helper: Generate Initials
    function getInitials(name) {
        if (!name) return 'IN';
        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    // Main entry point called by router.js when switching to 'peoples' tab
    window.loadPeoplesModule = async function (force = false) {
        if (_isLoadedOnce && !force) return;

        const gridEl = document.getElementById('peoples-grid');
        const emptyEl = document.getElementById('peoples-empty-state');
        if (gridEl) {
            gridEl.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px;">
                    <div class="spinner-border text-primary" style="width: 2rem; height: 2rem;" role="status">
                        <span class="sr-only">Loading investors...</span>
                    </div>
                    <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); margin-top: 10px;">
                        Fetching live Ace Investors, FII & DII directory...
                    </div>
                </div>
            `;
        }

        try {
            _isLoadingDirectory = true;
            const res = await fetch('/api/peoples/investors');
            const data = await res.json();

            _allInvestors = {
                ace: data.ace || [],
                fii: data.fii || [],
                dii: data.dii || []
            };

            // Update tab badge counters
            const countAce = document.getElementById('peoples-count-ace');
            const countFii = document.getElementById('peoples-count-fii');
            const countDii = document.getElementById('peoples-count-dii');
            if (countAce) countAce.innerText = _allInvestors.ace.length;
            if (countFii) countFii.innerText = _allInvestors.fii.length;
            if (countDii) countDii.innerText = _allInvestors.dii.length;

            _isLoadedOnce = true;
            renderInvestorsGrid();
        } catch (e) {
            console.error('Error fetching peoples investors:', e);
            if (gridEl) {
                gridEl.innerHTML = `
                    <div style="grid-column: 1 / -1; text-align: center; padding: 36px 20px; color: #ef4444;">
                        Failed to load investor directory. Please check network connection and try again.
                    </div>
                `;
            }
        } finally {
            _isLoadingDirectory = false;
        }
    };

    // Switch Category Tabs: 'ace', 'fii', 'dii'
    window.switchPeoplesCategory = function (category) {
        _currentCategory = category.toLowerCase();

        // Update active tab button style
        document.querySelectorAll('.peoples-category-bar .pf-select-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        const activeBtn = document.getElementById(`peoples-tab-btn-${_currentCategory}`);
        if (activeBtn) activeBtn.classList.add('active');

        // Reset search input
        const searchInput = document.getElementById('peoples-search-input');
        if (searchInput) searchInput.value = '';

        renderInvestorsGrid();
    };

    // Render Investor Cards for current category
    function renderInvestorsGrid() {
        const gridEl = document.getElementById('peoples-grid');
        const emptyEl = document.getElementById('peoples-empty-state');
        if (!gridEl) return;

        let list = [...(_allInvestors[_currentCategory] || [])];

        // Apply search query filter if any
        const searchInput = document.getElementById('peoples-search-input');
        const q = searchInput ? searchInput.value.trim().toLowerCase() : '';
        if (q) {
            list = list.filter(inv => {
                const name = (inv.name || '').toLowerCase();
                const sector = (inv.sector_preference || '').toLowerCase();
                const top = (inv.top_holdings || '').toLowerCase();
                return name.includes(q) || sector.includes(q) || top.includes(q);
            });
        }

        // Apply Sorting
        const sortSelect = document.getElementById('peoples-sort-select');
        const sortMode = sortSelect ? sortSelect.value : 'val-desc';
        if (sortMode === 'val-desc') {
            list.sort((a, b) => (b.numeric_value || 0) - (a.numeric_value || 0));
        } else if (sortMode === 'val-asc') {
            list.sort((a, b) => (a.numeric_value || 0) - (b.numeric_value || 0));
        } else if (sortMode === 'stocks-desc') {
            list.sort((a, b) => (b.stocks_count || 0) - (a.stocks_count || 0));
        } else if (sortMode === 'name-asc') {
            list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        }

        if (list.length === 0) {
            gridEl.innerHTML = '';
            if (emptyEl) emptyEl.style.display = 'block';
            return;
        }

        if (emptyEl) emptyEl.style.display = 'none';

        const catBadgeClass = _currentCategory === 'ace' ? 'badge-ace' : (_currentCategory === 'fii' ? 'badge-fii' : 'badge-dii');
        const catLabel = _currentCategory === 'ace' ? 'Ace Investor' : (_currentCategory === 'fii' ? 'FII' : 'DII');

        gridEl.innerHTML = list.map(inv => {
            const initials = getInitials(inv.name);
            const changePill = inv.change_pct ? `<span style="font-size: 11px; font-weight: 600; color: ${inv.change_pct.startsWith('-') ? '#ef4444' : '#10b981'}; margin-left: 4px;">(${inv.change_pct})</span>` : '';
            const topHoldingsText = inv.top_holdings && inv.top_holdings !== '-' ? `<strong>Top Holdings:</strong> ${escapeHtml(inv.top_holdings)}` : (inv.sector_preference && inv.sector_preference !== '-' ? `<strong>Focus:</strong> ${escapeHtml(inv.sector_preference)}` : 'Public shareholdings tracked under SEBI Reg 31');

            return `
                <div class="peoples-investor-card" onclick="openInvestorDetail('${inv.id}', '${inv.slug}', '${escapeHtml(inv.name)}', '${_currentCategory}', '${escapeHtml(inv.portfolio_value)}', '${inv.stocks_count}')">
                    <div class="peoples-card-top">
                        <div class="peoples-card-avatar">${initials}</div>
                        <div class="peoples-card-name-group">
                            <h3 class="peoples-card-name" title="${escapeHtml(inv.name)}">${escapeHtml(inv.name)}</h3>
                            <span class="peoples-card-cat-badge ${catBadgeClass}">${catLabel}</span>
                        </div>
                    </div>

                    <div class="peoples-card-stats">
                        <div class="peoples-card-stat-item peoples-card-stat-val-col">
                            <span class="peoples-stat-label">Portfolio Value</span>
                            <div class="peoples-stat-val-group">
                                <span class="peoples-stat-val">₹${escapeHtml(inv.portfolio_value || '—')}</span>
                                ${changePill}
                            </div>
                        </div>
                        <div class="peoples-card-stat-item peoples-card-stat-companies">
                            <span class="peoples-stat-label">Companies</span>
                            <span class="peoples-stat-val">${inv.stocks_count || 0} Stocks</span>
                        </div>
                    </div>

                    <div class="peoples-card-top-holdings" title="${escapeHtml(inv.top_holdings || '')}">
                        ${topHoldingsText}
                    </div>

                    <button type="button" class="peoples-card-btn">
                        <span>View Stock List</span>
                        <span aria-hidden="true">➔</span>
                    </button>
                </div>
            `;
        }).join('');
    }

    // Filter cards as user types in directory
    window.filterPeoplesList = function () {
        renderInvestorsGrid();
    };

    // Sort cards on dropdown change
    window.sortPeoplesList = function () {
        renderInvestorsGrid();
    };

    // Quarter Scope Selector Handler: 'last', 'all'
    window.changePeoplesQuarterScope = function (scope) {
        _quarterScope = scope;
        if (_activePortfolioData) {
            renderMatrixTable(_activePortfolioData);
        }
    };

    // Highlight Option Handler: 'all', 'inc', 'dec', 'both'
    window.setPeoplesHighlight = function (mode) {
        _highlightOption = mode;

        // Toggle active button style
        document.querySelectorAll('.peoples-chip-btn').forEach(btn => {
            if (btn.getAttribute('data-highlight') === mode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        applyHighlightOption();
    };

    // Fast DOM class toggle for dotted border highlight
    function applyHighlightOption() {
        const cells = document.querySelectorAll('#peoples-matrix-tbody td[data-change]');
        cells.forEach(td => {
            const change = td.getAttribute('data-change');
            td.classList.remove('peoples-border-up', 'peoples-border-down');

            if (_highlightOption === 'inc' && change === 'up') {
                td.classList.add('peoples-border-up');
            } else if (_highlightOption === 'dec' && change === 'down') {
                td.classList.add('peoples-border-down');
            } else if (_highlightOption === 'both') {
                if (change === 'up') td.classList.add('peoples-border-up');
                if (change === 'down') td.classList.add('peoples-border-down');
            }
        });
    }

    // Open Investor Stock List Detail View
    window.openInvestorDetail = async function (id, slug, name, category, val, stocksCount) {
        const dirView = document.getElementById('peoples-directory-view');
        const detailView = document.getElementById('peoples-detail-view');
        if (dirView) dirView.style.display = 'none';
        if (detailView) detailView.style.display = 'block';

        // Scroll page to top
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Reset stock filter input
        const stockFilterInput = document.getElementById('peoples-stock-filter-input');
        if (stockFilterInput) stockFilterInput.value = '';

        // Reset quarter scope dropdown to 'last'
        _quarterScope = 'last';
        const scopeSelect = document.getElementById('peoples-qtr-scope-select');
        if (scopeSelect) scopeSelect.value = 'last';

        // Reset highlight option to 'all'
        _highlightOption = 'all';
        document.querySelectorAll('.peoples-chip-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-highlight') === 'all');
        });

        // Update banner profile
        const nameEl = document.getElementById('peoples-detail-name');
        const valEl = document.getElementById('peoples-detail-val');
        const stocksEl = document.getElementById('peoples-detail-stocks-count');
        const avatarEl = document.getElementById('peoples-detail-avatar');
        const badgeEl = document.getElementById('peoples-detail-category-badge');

        if (nameEl) nameEl.innerText = name;
        if (valEl) valEl.innerText = val ? `₹${val}` : '—';
        if (stocksEl) stocksEl.innerText = stocksCount ? `${stocksCount} Companies` : '—';
        if (avatarEl) avatarEl.innerText = getInitials(name);

        const catLabel = category === 'ace' ? 'Ace Investor' : (category === 'fii' ? 'FII' : 'DII');
        const catBadgeClass = category === 'ace' ? 'badge-ace' : (category === 'fii' ? 'badge-fii' : 'badge-dii');
        if (badgeEl) {
            badgeEl.className = `badge ${catBadgeClass}`;
            badgeEl.innerText = catLabel;
        }

        // Show Brand Chart Loader
        const matrixWrapper = document.getElementById('peoples-matrix-wrapper');
        const loadingEl = document.getElementById('peoples-matrix-loading');
        if (matrixWrapper) matrixWrapper.style.display = 'none';
        if (loadingEl) loadingEl.style.display = 'flex';

        try {
            const res = await fetch(`/api/peoples/portfolio/${id}/${slug}`);
            const data = await res.json();
            _activePortfolioData = data;

            renderMatrixTable(data);
        } catch (e) {
            console.error('Error fetching investor portfolio:', e);
            if (loadingEl) {
                loadingEl.innerHTML = `
                    <div style="color: #ef4444; font-weight: 600; padding: 24px; text-align: center;">
                        Failed to fetch holding history from official exchanges. Please try again.
                    </div>
                `;
            }
        }
    };

    // Close Investor Detail & return to Directory View
    window.closeInvestorDetail = function () {
        const dirView = document.getElementById('peoples-directory-view');
        const detailView = document.getElementById('peoples-detail-view');
        if (detailView) detailView.style.display = 'none';
        if (dirView) dirView.style.display = 'block';
    };

    // Render Matrix Table matching user's requested layout & scope
    function renderMatrixTable(data) {
        const matrixWrapper = document.getElementById('peoples-matrix-wrapper');
        const loadingEl = document.getElementById('peoples-matrix-loading');
        const thead = document.getElementById('peoples-matrix-thead');
        const tbody = document.getElementById('peoples-matrix-tbody');

        if (!matrixWrapper || !thead || !tbody) return;

        const allQuarters = data.quarters || [];
        let quarters = [];

        // 1. Determine Quarters to display based on _quarterScope ('last' vs 'all')
        if (_quarterScope === 'last') {
            if (allQuarters.length >= 2) {
                quarters = [allQuarters[allQuarters.length - 2], allQuarters[allQuarters.length - 1]];
            } else if (allQuarters.length === 1) {
                quarters = [allQuarters[0]];
            }
        } else {
            quarters = [...allQuarters];
        }

        let stocks = data.stocks || [];

        // In 'last' quarter scope, filter out legacy stocks that had no holding in either the last or previous quarter
        if (_quarterScope === 'last' && allQuarters.length >= 2) {
            const lastQ = allQuarters[allQuarters.length - 1];
            const prevQ = allQuarters[allQuarters.length - 2];
            stocks = stocks.filter(s => {
                const vLast = s.quarters ? s.quarters[lastQ] : '';
                const vPrev = s.quarters ? s.quarters[prevQ] : '';
                return (vLast && vLast !== '—' && vLast !== '-') || (vPrev && vPrev !== '—' && vPrev !== '-');
            });
        }

        // Apply in-table search filter if any
        const stockFilterInput = document.getElementById('peoples-stock-filter-input');
        const q = stockFilterInput ? stockFilterInput.value.trim().toLowerCase() : '';
        if (q) {
            stocks = stocks.filter(s => {
                const name = (s.stock || '').toLowerCase();
                const sym = (s.symbol || '').toLowerCase();
                return name.includes(q) || sym.includes(q);
            });
        }

        // 2. Build Header Row
        let qHeadersHtml = '';
        if (_quarterScope === 'last' && allQuarters.length >= 2) {
            const prevQ = allQuarters[allQuarters.length - 2];
            const lastQ = allQuarters[allQuarters.length - 1];
            qHeadersHtml = `
                <th style="text-align: right;">${escapeHtml(prevQ)} <span style="font-size: 10px; opacity: 0.65; font-weight: 500;">(Prev Qtr)</span></th>
                <th style="text-align: right;">${escapeHtml(lastQ)} <span style="font-size: 10px; opacity: 0.65; font-weight: 500;">(Last Qtr)</span></th>
            `;
        } else if (_quarterScope === 'last' && allQuarters.length === 1) {
            const lastQ = allQuarters[0];
            qHeadersHtml = `
                <th style="text-align: right;">${escapeHtml(lastQ)} <span style="font-size: 10px; opacity: 0.65; font-weight: 500;">(Last Qtr)</span></th>
            `;
        } else {
            qHeadersHtml = quarters.map(qName => `<th style="text-align: right;">${escapeHtml(qName)}</th>`).join('');
        }

        thead.innerHTML = `
            <tr>
                <th style="text-align: left;">Stock</th>
                <th style="text-align: right;">Holding Value</th>
                <th style="text-align: right;">Qty Held</th>
                ${qHeadersHtml}
            </tr>
        `;

        // 3. Build Rows
        if (stocks.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="${quarters.length + 3}" style="text-align: center; padding: 36px 20px; color: var(--text-secondary);">
                        No holdings found matching your filter criteria.
                    </td>
                </tr>
            `;
        } else {
            tbody.innerHTML = stocks.map(item => {
                const stockName = item.stock;
                const sym = item.symbol || '';
                const holdingVal = item.holding_value ? `₹${item.holding_value}` : '—';
                const qtyHeld = item.qty_held || '—';

                // Render quarterly percentage cells
                const qCells = quarters.map((qName) => {
                    const rawVal = item.quarters ? item.quarters[qName] : '';
                    const hasCurr = Boolean(rawVal && rawVal !== '—' && rawVal !== '-');

                    // Find preceding chronological quarter in allQuarters to detect changes
                    const fullIdx = allQuarters.indexOf(qName);
                    let prevVal = null;
                    if (fullIdx > 0) {
                        for (let p = fullIdx - 1; p >= 0; p--) {
                            const pQ = allQuarters[p];
                            const v = item.quarters ? item.quarters[pQ] : '';
                            if (v && v !== '—' && v !== '-') {
                                prevVal = v;
                                break;
                            }
                        }
                    }

                    const hasPrev = Boolean(prevVal && prevVal !== '—' && prevVal !== '-');

                    let colorClass = 'peoples-pct-cell';
                    let changeType = 'none';
                    let displayVal = '—';
                    let cellTitle = '';

                    if (hasCurr && !hasPrev) {
                        // CASE 1: Freshly added! Even if no data compared with previous quarter -> Highlight as UP
                        colorClass += ' peoples-pct-up';
                        changeType = 'up';
                        cellTitle = 'Fresh addition (New holding ≥ 1%)';
                        try {
                            const num = parseFloat(rawVal);
                            displayVal = !isNaN(num) ? num.toFixed(2) : rawVal;
                        } catch (_) {
                            displayVal = rawVal;
                        }
                    } else if (!hasCurr && hasPrev) {
                        // CASE 2: No data compared with last quarter / Exited! Highlight as DOWN
                        colorClass += ' peoples-pct-down';
                        changeType = 'down';
                        displayVal = '—';
                        cellTitle = `Exited / below 1% (was ${prevVal}% in previous quarter)`;
                    } else if (hasCurr && hasPrev) {
                        // CASE 3: Both quarters have data -> compare values
                        try {
                            const currNum = parseFloat(rawVal);
                            const prevNum = parseFloat(prevVal);
                            if (!isNaN(currNum) && !isNaN(prevNum)) {
                                if (currNum > prevNum + 0.0001) {
                                    colorClass += ' peoples-pct-up';
                                    changeType = 'up';
                                    cellTitle = `Increased from ${prevNum.toFixed(2)}% (+${(currNum - prevNum).toFixed(2)}%)`;
                                } else if (currNum < prevNum - 0.0001) {
                                    colorClass += ' peoples-pct-down';
                                    changeType = 'down';
                                    cellTitle = `Decreased from ${prevNum.toFixed(2)}% (${(currNum - prevNum).toFixed(2)}%)`;
                                } else {
                                    cellTitle = `Unchanged (${currNum.toFixed(2)}%)`;
                                }
                            }
                            const num = parseFloat(rawVal);
                            displayVal = !isNaN(num) ? num.toFixed(2) : rawVal;
                        } catch (_) {
                            displayVal = rawVal;
                        }
                    } else {
                        // CASE 4: Neither quarter has data
                        colorClass = 'peoples-pct-empty';
                        changeType = 'none';
                        displayVal = '—';
                    }

                    // Determine dotted border highlight based on active option
                    let borderClass = '';
                    if (_highlightOption === 'inc' && changeType === 'up') {
                        borderClass = ' peoples-border-up';
                    } else if (_highlightOption === 'dec' && changeType === 'down') {
                        borderClass = ' peoples-border-down';
                    } else if (_highlightOption === 'both') {
                        if (changeType === 'up') borderClass = ' peoples-border-up';
                        if (changeType === 'down') borderClass = ' peoples-border-down';
                    }

                    const emptyClass = !hasCurr ? ' peoples-pct-empty' : '';

                    return `<td class="${colorClass}${emptyClass}${borderClass}" data-change="${changeType}" title="${escapeHtml(cellTitle)}">${displayVal}</td>`;
                }).join('');

                return `
                    <tr>
                        <td>
                            <div class="peoples-stock-cell">
                                <span class="peoples-stock-name" onclick="handleStockClick('${escapeHtml(sym || stockName)}')">
                                    ${escapeHtml(stockName)}
                                </span>
                                ${sym ? `<span class="peoples-stock-sub">${escapeHtml(sym)}</span>` : ''}
                            </div>
                        </td>
                        <td style="font-weight: 600; color: var(--text-primary);">${escapeHtml(holdingVal)}</td>
                        <td style="color: var(--text-secondary);">${escapeHtml(qtyHeld)}</td>
                        ${qCells}
                    </tr>
                `;
            }).join('');
        }

        if (loadingEl) loadingEl.style.display = 'none';
        if (matrixWrapper) {
            matrixWrapper.style.display = 'block';

            // If viewing All Quarters, auto-scroll horizontally to the latest quarter (right edge)
            if (_quarterScope === 'all') {
                setTimeout(() => {
                    matrixWrapper.scrollLeft = matrixWrapper.scrollWidth;
                }, 60);
            } else {
                matrixWrapper.scrollLeft = 0;
            }
        }
    }

    // Filter stocks inside table as user types
    window.filterInvestorStocks = function () {
        if (_activePortfolioData) {
            renderMatrixTable(_activePortfolioData);
        }
    };

    // Clicking a stock name opens chart / overview
    window.handleStockClick = function (symbol) {
        if (!symbol) return;
        const cleanSym = symbol.endsWith('.NS') || symbol.endsWith('.BO') ? symbol : `${symbol}.NS`;
        if (typeof openFundamentalsModal === 'function') {
            openFundamentalsModal(cleanSym);
        } else if (typeof showStockChart === 'function') {
            showStockChart(cleanSym);
        }
    };

})();
