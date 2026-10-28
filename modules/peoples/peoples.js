/**
 * Capital Desk - Peoples (Superstar Investors, FII & DII) Client Module
 * Location: modules/peoples/peoples.js
 * Handles live directory viewing, tab segregation, search/filtering,
 * and renders on-time quarterly holding matrices from 2022 to the latest quarter.
 */

(function () {
    let _allInvestors = { ace: [], fii: [], dii: [] };
    let _currentCategory = 'ace';
    let _activePortfolioData = null;
    let _isLoadingDirectory = false;
    let _isLoadedOnce = false;

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
                        <div class="peoples-card-stat-item">
                            <span class="peoples-stat-label">Portfolio Value</span>
                            <span class="peoples-stat-val">₹${escapeHtml(inv.portfolio_value || '—')}${changePill}</span>
                        </div>
                        <div class="peoples-card-stat-item" style="text-align: right;">
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

    // Filter cards as user types
    window.filterPeoplesList = function () {
        renderInvestorsGrid();
    };

    // Sort cards on dropdown change
    window.sortPeoplesList = function () {
        renderInvestorsGrid();
    };

    // Open Investor Stock List Detail View (2022 to Latest Quarter Matrix)
    window.openInvestorDetail = async function (id, slug, name, category, val, stocksCount) {
        const dirView = document.getElementById('peoples-directory-view');
        const detailView = document.getElementById('peoples-detail-view');
        if (dirView) dirView.style.display = 'none';
        if (detailView) detailView.style.display = 'block';

        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Update header banner
        const nameEl = document.getElementById('peoples-detail-name');
        const crumbEl = document.getElementById('peoples-detail-crumb');
        const valEl = document.getElementById('peoples-detail-val');
        const stocksEl = document.getElementById('peoples-detail-stocks-count');
        const avatarEl = document.getElementById('peoples-detail-avatar');
        const badgeEl = document.getElementById('peoples-detail-category-badge');

        if (nameEl) nameEl.innerText = name;
        if (crumbEl) crumbEl.innerText = name;
        if (valEl) valEl.innerText = val ? `₹${val}` : '—';
        if (stocksEl) stocksEl.innerText = stocksCount ? `${stocksCount} Companies` : '—';
        if (avatarEl) avatarEl.innerText = getInitials(name);

        const catLabel = category === 'ace' ? 'Ace Investor' : (category === 'fii' ? 'FII' : 'DII');
        const catBadgeClass = category === 'ace' ? 'badge-ace' : (category === 'fii' ? 'badge-fii' : 'badge-dii');
        if (badgeEl) {
            badgeEl.className = `badge ${catBadgeClass}`;
            badgeEl.innerText = catLabel;
        }

        // Show loading shimmer
        const matrixTable = document.getElementById('peoples-matrix-table');
        const loadingEl = document.getElementById('peoples-matrix-loading');
        if (matrixTable) matrixTable.style.display = 'none';
        if (loadingEl) loadingEl.style.display = 'block';

        try {
            const res = await fetch(`/api/peoples/portfolio/${id}/${slug}`);
            const data = await res.json();
            _activePortfolioData = data;

            renderMatrixTable(data);
        } catch (e) {
            console.error('Error fetching investor portfolio:', e);
            if (loadingEl) {
                loadingEl.innerHTML = `
                    <div style="color: #ef4444; font-weight: 600; padding: 24px;">
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

    // Render Matrix Table matching user's uploaded screenshot
    function renderMatrixTable(data) {
        const matrixTable = document.getElementById('peoples-matrix-table');
        const loadingEl = document.getElementById('peoples-matrix-loading');
        const thead = document.getElementById('peoples-matrix-thead');
        const tbody = document.getElementById('peoples-matrix-tbody');

        if (!matrixTable || !thead || !tbody) return;

        const quarters = data.quarters || [];
        let stocks = data.stocks || [];

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

        // 1. Build Header Row: Stock, Holding Value, Qty Held, [Quarters from 2022]
        thead.innerHTML = `
            <tr>
                <th style="text-align: left;">Stock</th>
                <th style="text-align: right;">Holding Value</th>
                <th style="text-align: right;">Qty Held</th>
                ${quarters.map(qName => `<th style="text-align: right;">${escapeHtml(qName)}</th>`).join('')}
            </tr>
        `;

        // 2. Build Rows
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
                const qCells = quarters.map((qName, qIdx) => {
                    const rawVal = item.quarters ? item.quarters[qName] : '';
                    if (!rawVal) {
                        return `<td class="peoples-pct-empty">—</td>`;
                    }

                    // Compare with previous quarter to color code increase/decrease
                    let colorClass = 'peoples-pct-cell';
                    if (qIdx > 0) {
                        const prevQ = quarters[qIdx - 1];
                        const prevVal = item.quarters[prevQ];
                        if (prevVal) {
                            try {
                                const currNum = float(rawVal);
                                const prevNum = float(prevVal);
                                if (currNum > prevNum) colorClass += ' peoples-pct-up';
                                else if (currNum < prevNum) colorClass += ' peoples-pct-down';
                            } catch (_) {}
                        }
                    }

                    // Format as float with 2 decimals if possible, e.g. 1.08, 2.58
                    let formattedVal = rawVal;
                    try {
                        const num = parseFloat(rawVal);
                        if (!isNaN(num)) {
                            formattedVal = num.toFixed(2);
                        }
                    } catch (_) {}

                    return `<td class="${colorClass}">${formattedVal}</td>`;
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
        if (matrixTable) matrixTable.style.display = 'table';
    }

    // Filter stocks inside table
    window.filterInvestorStocks = function () {
        if (_activePortfolioData) {
            renderMatrixTable(_activePortfolioData);
        }
    };

    // Clicking a stock name opens chart / overview
    window.handleStockClick = function (symbol) {
        if (!symbol) return;
        // Clean symbol for Indian exchange format
        const cleanSym = symbol.endsWith('.NS') || symbol.endsWith('.BO') ? symbol : `${symbol}.NS`;
        if (typeof openFundamentalsModal === 'function') {
            openFundamentalsModal(cleanSym);
        } else if (typeof showStockChart === 'function') {
            showStockChart(cleanSym);
        }
    };

    // Export current investor's holding matrix as CSV
    window.exportPeoplesTableCSV = function () {
        if (!_activePortfolioData || !_activePortfolioData.stocks) return;

        const quarters = _activePortfolioData.quarters || [];
        const stocks = _activePortfolioData.stocks || [];
        const invName = (_activePortfolioData.investor && _activePortfolioData.investor.name) || 'investor';

        const headers = ['Stock', 'Symbol', 'Holding Value', 'Qty Held', ...quarters];
        const rows = [headers];

        stocks.forEach(s => {
            const row = [
                `"${(s.stock || '').replace(/"/g, '""')}"`,
                `"${(s.symbol || '').replace(/"/g, '""')}"`,
                `"${(s.holding_value || '').replace(/"/g, '""')}"`,
                `"${(s.qty_held || '').replace(/"/g, '""')}"`,
            ];
            quarters.forEach(q => {
                const val = (s.quarters && s.quarters[q]) || '';
                row.push(`"${val}"`);
            });
            rows.push(row);
        });

        const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(r => r.join(',')).join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `${invName.replace(/[^a-zA-Z0-9_-]/g, '_')}_shareholding_2022_to_latest.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

})();
