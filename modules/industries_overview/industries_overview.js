/**
 * CAPITAL DESK - INDUSTRIES OVERVIEW JAVASCRIPT MODULE
 * Location: modules/industries_overview/industries_overview.js
 */

(function () {
    let allIndustries = [];
    let filteredIndustries = [];
    let macroSectors = [];
    let currentMacroFilter = 'ALL';
    let currentSearchTerm = '';
    let currentSortCol = 'name';
    let currentSortAsc = true;

    // Current Active Industry Stocks State
    let currentIndustryMeta = null;
    let currentStocks = [];
    let filteredStocks = [];
    let stockSortCol = 'mar_cap';
    let stockSortAsc = false;

    // Macro Icons map matching main industry categories
    const macroIcons = {
        'IN01': '📦', // Commodities
        'IN02': '🚗', // Consumer Discretionary
        'IN03': '⚡', // Energy
        'IN04': '🛒', // Fast Moving Consumer Goods
        'IN05': '🏦', // Financial Services
        'IN06': '🏥', // Healthcare
        'IN07': '⚙️', // Industrials
        'IN08': '💻', // Information Technology
        'IN09': '🛎️', // Services
        'IN10': '📡', // Telecommunication
        'IN11': '💡', // Utilities
        'IN12': '🌐'  // Diversified
    };

    function getMacroIcon(ind) {
        if (!ind) return '📁';
        const code = ind.macro_code || '';
        if (macroIcons[code]) return macroIcons[code];

        const name = (ind.macro_name || '').toLowerCase();
        if (name.includes('consumer discretionary')) return '🚗';
        if (name.includes('industrial')) return '⚙️';
        if (name.includes('service')) return '🛎️';
        if (name.includes('commodit')) return '📦';
        if (name.includes('fast moving') || name.includes('fmcg')) return '🛒';
        if (name.includes('financial')) return '🏦';
        if (name.includes('health')) return '🏥';
        if (name.includes('energy')) return '⚡';
        if (name.includes('information tech') || name.includes('it')) return '💻';
        if (name.includes('telecom')) return '📡';
        if (name.includes('utilit') || name.includes('power')) return '💡';
        if (name.includes('diversif')) return '🌐';

        return '📁';
    }

    // Format helpers
    function fmtNum(val, decimals = 2) {
        if (val === null || val === undefined || isNaN(val)) return '-';
        return Number(val).toLocaleString('en-IN', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }

    function fmtPct(val) {
        if (val === null || val === undefined || isNaN(val)) return '-';
        const num = Number(val);
        const sign = num > 0 ? '+' : '';
        const colorCls = num > 0 ? 'val-pos' : (num < 0 ? 'val-neg' : 'val-neutral');
        return `<span class="${colorCls}">${sign}${num.toFixed(1)}%</span>`;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // 1. Initial Module Load
    async function loadIndustriesOverviewModule(forceRefresh = false) {
        const tbody = document.getElementById('indMasterTableBody');
        if (!allIndustries.length || forceRefresh) {
            if (tbody) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="13" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                            <div class="ind-spinner"></div>
                            <div style="margin-top: 10px;">Loading 188 Industries...</div>
                        </td>
                    </tr>
                `;
            }
        }

        try {
            const url = forceRefresh ? '/api/industries-overview/list?refresh=1' : '/api/industries-overview/list';
            const res = await fetch(url);
            const data = await res.json();

            if (data.error) {
                if (tbody) tbody.innerHTML = `<tr><td colspan="13" style="text-align:center;color:#ef4444;padding:24px;">Failed to load: ${escapeHtml(data.error)}</td></tr>`;
                return;
            }

            allIndustries = data.industries || [];
            macroSectors = data.macro_sectors || [];

            const totalBadge = document.getElementById('indTotalCountBadge');
            if (totalBadge) totalBadge.innerText = `${allIndustries.length} Industries`;

            renderMacroFilterPills();
            applyIndustriesFilter();
        } catch (err) {
            console.error('Industries overview fetch error:', err);
            if (tbody) tbody.innerHTML = `<tr><td colspan="13" style="text-align:center;color:#ef4444;padding:24px;">Error fetching industries overview.</td></tr>`;
        }
    }

    // 2. Render Macro Filter Pills
    function renderMacroFilterPills() {
        const container = document.getElementById('indMacroFilterBar');
        if (!container) return;

        // Count per macro
        const countMap = {};
        allIndustries.forEach(ind => {
            countMap[ind.macro_code] = (countMap[ind.macro_code] || 0) + 1;
        });

        let html = `
            <button type="button" class="macro-pill ${currentMacroFilter === 'ALL' ? 'active' : ''}" data-macro="ALL" onclick="filterByMacroSector('ALL', this)">
                🌐 All Sectors (${allIndustries.length})
            </button>
        `;

        macroSectors.forEach(m => {
            const cnt = countMap[m.code] || 0;
            const icon = macroIcons[m.code] || '📁';
            const isAct = currentMacroFilter === m.code ? 'active' : '';
            html += `
                <button type="button" class="macro-pill ${isAct}" data-macro="${m.code}" onclick="filterByMacroSector('${m.code}', this)">
                    ${icon} ${escapeHtml(m.name)} (${cnt})
                </button>
            `;
        });

        container.innerHTML = html;
        attachRibbonWheelScroll(container);
    }

    // Mouse wheel horizontal scroll for ribbon
    function attachRibbonWheelScroll(container) {
        if (!container || container.dataset.wheelBound) return;
        container.dataset.wheelBound = 'true';
        container.addEventListener('wheel', function (e) {
            if (e.deltaY !== 0) {
                e.preventDefault();
                container.scrollLeft += (e.deltaY * 1.2);
            }
        }, { passive: false });
    }

    // 3. Filter and Sorting
    function filterByMacroSector(macroCode, pillEl) {
        currentMacroFilter = macroCode;
        document.querySelectorAll('.macro-pill').forEach(p => p.classList.remove('active'));
        if (pillEl) pillEl.classList.add('active');

        const filterLabel = document.getElementById('indFilterLabel');
        if (filterLabel) {
            if (macroCode !== 'ALL') {
                const found = macroSectors.find(m => m.code === macroCode);
                filterLabel.innerText = `[Sector: ${found ? found.name : macroCode}]`;
                filterLabel.style.display = 'inline';
            } else {
                filterLabel.style.display = 'none';
            }
        }

        applyIndustriesFilter();
    }

    function handleIndustrySearch(val) {
        currentSearchTerm = (val || '').trim().toLowerCase();
        const clearBtn = document.getElementById('indClearSearchBtn');
        if (clearBtn) clearBtn.style.display = currentSearchTerm ? 'block' : 'none';
        applyIndustriesFilter();
    }

    function clearIndustrySearch() {
        const inp = document.getElementById('indSearchInput');
        if (inp) inp.value = '';
        handleIndustrySearch('');
    }

    function applyIndustriesFilter() {
        filteredIndustries = allIndustries.filter(ind => {
            if (currentMacroFilter !== 'ALL' && ind.macro_code !== currentMacroFilter) {
                return false;
            }
            if (currentSearchTerm) {
                const matchName = ind.name.toLowerCase().includes(currentSearchTerm);
                const matchMacro = ind.macro_name.toLowerCase().includes(currentSearchTerm);
                const matchSector = ind.sector_name.toLowerCase().includes(currentSearchTerm);
                const matchGroup = ind.industry_group_name.toLowerCase().includes(currentSearchTerm);
                if (!matchName && !matchMacro && !matchSector && !matchGroup) {
                    return false;
                }
            }
            return true;
        });

        sortIndustriesInternal();
        renderIndustriesTable();
    }

    function sortIndustries(colKey) {
        if (currentSortCol === colKey) {
            currentSortAsc = !currentSortAsc;
        } else {
            currentSortCol = colKey;
            currentSortAsc = ['name', 'macro_name', 'sector_name', 'industry_group_name', 'sno'].includes(colKey);
        }
        updateSortIcons();
        sortIndustriesInternal();
        renderIndustriesTable();
    }

    function updateSortIcons() {
        document.querySelectorAll('#indMasterTable thead .sort-icon').forEach(icon => {
            icon.innerText = '';
        });
        const activeIcon = document.getElementById(`sort-ind-${currentSortCol}`);
        if (activeIcon) {
            activeIcon.innerText = currentSortAsc ? '▲' : '▼';
        }
    }

    function sortIndustriesInternal() {
        filteredIndustries.sort((a, b) => {
            let va = a[currentSortCol];
            let vb = b[currentSortCol];

            if (currentSortCol === 'sno') {
                va = allIndustries.indexOf(a);
                vb = allIndustries.indexOf(b);
            }

            if (va === null || va === undefined) return 1;
            if (vb === null || vb === undefined) return -1;

            if (typeof va === 'string') {
                const res = va.localeCompare(vb);
                return currentSortAsc ? res : -res;
            } else {
                return currentSortAsc ? (va - vb) : (vb - va);
            }
        });
    }

    // 4. Render Master Industries Table
    function renderIndustriesTable() {
        const tbody = document.getElementById('indMasterTableBody');
        const countEl = document.getElementById('indShowingCount');
        if (countEl) countEl.innerText = filteredIndustries.length;

        if (!tbody) return;

        if (filteredIndustries.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="13" style="text-align: center; padding: 36px; color: var(--text-secondary);">
                        No industries found matching your criteria.
                    </td>
                </tr>
            `;
            return;
        }

        let html = '';
        filteredIndustries.forEach((ind, idx) => {
            const sno = idx + 1;
            const peVal = ind.median_pe ? ind.median_pe.toFixed(1) : '-';
            const roceVal = ind.wtd_roce ? `${ind.wtd_roce.toFixed(1)}%` : '-';
            const opmVal = ind.opm ? `${ind.opm.toFixed(1)}%` : '-';
            const macroIcon = getMacroIcon(ind);

            html += `
                <tr class="ind-row">
                    <td class="th-sno">${sno}</td>
                    <td class="td-industry-name" title="${escapeHtml(ind.name)}">
                        <a href="javascript:void(0)" class="ind-link-cell" onclick="openIndustryStocks('${escapeHtml(ind.path)}')" title="${escapeHtml(ind.name)}">
                            <span>${macroIcon}</span> <span class="ind-name-text">${escapeHtml(ind.name)}</span>
                        </a>
                    </td>
                    <td class="th-num"><strong>${ind.company_count}</strong></td>
                    <td class="th-num">₹${fmtNum(ind.total_market_cap, 0)}</td>
                    <td class="th-num">₹${fmtNum(ind.median_market_cap, 0)}</td>
                    <td class="th-num">${peVal}</td>
                    <td class="th-num">${fmtPct(ind.sales_growth)}</td>
                    <td class="th-num">${opmVal}</td>
                    <td class="th-num"><strong>${roceVal}</strong></td>
                    <td class="th-num">${fmtPct(ind.return_1y)}</td>
                    <td><span class="ind-tag-pill">${escapeHtml(ind.macro_name)}</span></td>
                    <td><span class="ind-tag-pill">${escapeHtml(ind.sector_name)}</span></td>
                    <td><span class="ind-tag-pill">${escapeHtml(ind.industry_group_name)}</span></td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    }

    // 5. Open Industry Stocks Drill-Down (Refer Image 1 & 2)
    async function openIndustryStocks(pathOrCode, forceRefresh = false) {
        const tableView = document.getElementById('indTableView');
        const stocksView = document.getElementById('indStocksView');
        const ribbon = document.getElementById('indMacroFilterBar');
        if (tableView) tableView.style.display = 'none';
        if (ribbon) ribbon.style.display = 'none';
        if (stocksView) stocksView.style.display = 'block';

        // Scroll to top of view
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch(e){}

        const stocksTbody = document.getElementById('indStocksTableBody');
        if (stocksTbody) {
            stocksTbody.innerHTML = `
                <tr>
                    <td colspan="12" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                        <div class="ind-spinner"></div>
                        <div style="margin-top: 10px;">${forceRefresh ? 'Syncing live exchange disclosures...' : 'Loading industry stocks...'}</div>
                    </td>
                </tr>
            `;
        }

        try {
            const url = forceRefresh
                ? `/api/industries-overview/stocks?path=${encodeURIComponent(pathOrCode)}&refresh=1`
                : `/api/industries-overview/stocks?path=${encodeURIComponent(pathOrCode)}`;
            const res = await fetch(url);
            const data = await res.json();

            if (data.error && (!data.stocks || data.stocks.length === 0)) {
                if (stocksTbody) {
                    stocksTbody.innerHTML = `
                        <tr>
                            <td colspan="12" style="text-align: center; padding: 40px 20px;">
                                <div style="font-size: 32px; margin-bottom: 12px;">📡</div>
                                <div style="font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">
                                    Live Exchange Feed Temporarily Unavailable
                                </div>
                                <div style="font-size: 13px; color: var(--text-secondary); max-width: 500px; margin: 0 auto 16px auto;">
                                    ${escapeHtml(data.error)}
                                </div>
                                <button type="button" class="btn btn-primary" onclick="openIndustryStocks('${escapeHtml(pathOrCode)}', true)" style="padding: 7px 18px; font-size: 13px; font-weight: 600; cursor: pointer; border-radius: 6px;">
                                    🔄 Retry Connection
                                </button>
                            </td>
                        </tr>
                    `;
                }
                return;
            }

            currentIndustryMeta = data.industry;
            currentStocks = data.stocks || [];
            filteredStocks = [...currentStocks];

            // 1. Populate Breadcrumbs (Image 2)
            const bcMacro = document.getElementById('bcMacroName');
            const bcSector = document.getElementById('bcSectorName');
            const bcGroup = document.getElementById('bcGroupName');
            const bcInd = document.getElementById('bcIndustryName');

            if (currentIndustryMeta) {
                const icon = getMacroIcon(currentIndustryMeta);
                const bcMacroIcon = document.getElementById('bcMacroIcon');
                const bcIndustryIcon = document.getElementById('bcIndustryIcon');
                if (bcMacroIcon) bcMacroIcon.innerText = icon;
                if (bcIndustryIcon) bcIndustryIcon.innerText = icon;

                if (bcMacro) bcMacro.innerText = currentIndustryMeta.macro_name;
                if (bcSector) bcSector.innerText = currentIndustryMeta.sector_name;
                if (bcGroup) bcGroup.innerText = currentIndustryMeta.industry_group_name;
                if (bcInd) bcInd.innerText = currentIndustryMeta.name;

                // Populate Banner
                const titleEl = document.getElementById('indDetailTitle');
                const codesEl = document.getElementById('indDetailCodes');
                if (titleEl) titleEl.innerText = `${currentIndustryMeta.name} Companies`;
                if (codesEl) codesEl.innerText = `SEBI FIC: ${currentIndustryMeta.code} · ${currentIndustryMeta.macro_name} > ${currentIndustryMeta.sector_name} > ${currentIndustryMeta.industry_group_name}`;

                const sComp = document.getElementById('indStatCompanies');
                const sMCap = document.getElementById('indStatMCap');
                const sPE = document.getElementById('indStatPE');
                const sROCE = document.getElementById('indStatROCE');
                const s1Y = document.getElementById('indStat1Y');

                if (sComp) sComp.innerText = currentStocks.length;
                if (sMCap) sMCap.innerText = `₹${fmtNum(currentIndustryMeta.total_market_cap, 0)} Cr`;
                if (sPE) sPE.innerText = currentIndustryMeta.median_pe ? currentIndustryMeta.median_pe.toFixed(1) : '-';
                if (sROCE) sROCE.innerText = currentIndustryMeta.wtd_roce ? `${currentIndustryMeta.wtd_roce.toFixed(1)}%` : '-';
                if (s1Y) s1Y.innerHTML = fmtPct(currentIndustryMeta.return_1y);

                const headName = document.getElementById('indStockHeadingName');
                if (headName) headName.innerText = currentIndustryMeta.name;
            }

            stockSortCol = 'mar_cap';
            stockSortAsc = false;
            sortStocksInternal();
            renderStocksTable();
        } catch (err) {
            console.error('Industry stocks fetch error:', err);
            if (stocksTbody) {
                stocksTbody.innerHTML = `
                    <tr>
                        <td colspan="12" style="text-align: center; padding: 40px 20px;">
                            <div style="font-size: 32px; margin-bottom: 12px;">⚠️</div>
                            <div style="font-size: 15px; font-weight: 600; color: #ef4444; margin-bottom: 6px;">
                                Market Feed Connection Error
                            </div>
                            <div style="font-size: 13px; color: var(--text-secondary); max-width: 500px; margin: 0 auto 16px auto;">
                                Unable to establish a connection to the exchange feed. Please check your network and retry.
                            </div>
                            <button type="button" class="btn btn-primary" onclick="openIndustryStocks('${escapeHtml(pathOrCode)}', true)" style="padding: 7px 18px; font-size: 13px; font-weight: 600; cursor: pointer; border-radius: 6px;">
                                🔄 Retry
                            </button>
                        </td>
                    </tr>
                `;
            }
        }
    }

    function closeIndustryStocksView() {
        const tableView = document.getElementById('indTableView');
        const stocksView = document.getElementById('indStocksView');
        const ribbon = document.getElementById('indMacroFilterBar');
        if (tableView) tableView.style.display = 'block';
        if (ribbon) ribbon.style.display = 'flex';
        if (stocksView) stocksView.style.display = 'none';
    }

    function filterByMacroFromBreadcrumb() {
        closeIndustryStocksView();
        if (currentIndustryMeta && currentIndustryMeta.macro_code) {
            const pill = document.querySelector(`.macro-pill[data-macro="${currentIndustryMeta.macro_code}"]`);
            filterByMacroSector(currentIndustryMeta.macro_code, pill);
        }
    }

    // 6. Stocks Filtering & Sorting
    function handleStockFilter(val) {
        const q = (val || '').trim().toLowerCase();
        filteredStocks = currentStocks.filter(stk => {
            if (!q) return true;
            return stk.name.toLowerCase().includes(q) || stk.symbol.toLowerCase().includes(q);
        });
        sortStocksInternal();
        renderStocksTable();
    }

    function sortStocks(colKey) {
        if (stockSortCol === colKey) {
            stockSortAsc = !stockSortAsc;
        } else {
            stockSortCol = colKey;
            stockSortAsc = ['name', 'sno'].includes(colKey);
        }
        updateStockSortIcons();
        sortStocksInternal();
        renderStocksTable();
    }

    function updateStockSortIcons() {
        document.querySelectorAll('#indStocksTable thead .sort-icon').forEach(icon => {
            icon.innerText = '';
        });
        const activeIcon = document.getElementById(`sort-stk-${stockSortCol}`);
        if (activeIcon) {
            activeIcon.innerText = stockSortAsc ? '▲' : '▼';
        }
    }

    function sortStocksInternal() {
        filteredStocks.sort((a, b) => {
            let va = a[stockSortCol];
            let vb = b[stockSortCol];

            if (stockSortCol === 'sno') {
                va = currentStocks.indexOf(a);
                vb = currentStocks.indexOf(b);
            }

            if (va === null || va === undefined) return 1;
            if (vb === null || vb === undefined) return -1;

            if (typeof va === 'string') {
                const res = va.localeCompare(vb);
                return stockSortAsc ? res : -res;
            } else {
                return stockSortAsc ? (va - vb) : (vb - va);
            }
        });
    }

    // 7. Render Stocks Table
    function renderStocksTable() {
        const tbody = document.getElementById('indStocksTableBody');
        const countEl = document.getElementById('indStockShowingCount');
        if (countEl) countEl.innerText = filteredStocks.length;

        if (!tbody) return;

        if (filteredStocks.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="12" style="text-align: center; padding: 36px; color: var(--text-secondary);">
                        <div style="font-size: 28px; margin-bottom: 8px;">📊</div>
                        <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">
                            ${(currentStocks.length > 0) ? 'No stocks match your search query.' : 'Live Stock Directory Sync'}
                        </div>
                        <div style="font-size: 12.5px; color: var(--text-secondary); max-width: 480px; margin: 0 auto 12px auto;">
                            ${(currentStocks.length > 0) ? 'Try clearing or modifying the search filter above.' : 'Exchange data for this industry is being synchronized. You can force sync with live feed below.'}
                        </div>
                        ${(currentStocks.length === 0 && currentIndustryMeta) ? `
                            <button type="button" class="btn btn-primary" onclick="openIndustryStocks('${escapeHtml(currentIndustryMeta.path || currentIndustryMeta.code)}', true)" style="padding: 6px 16px; font-size: 12.5px; cursor: pointer; border-radius: 6px;">
                                🔄 Sync Live Feed
                            </button>
                        ` : ''}
                    </td>
                </tr>
            `;
            return;
        }

        let html = '';
        filteredStocks.forEach((stk, idx) => {
            const sno = idx + 1;
            const cmpStr = stk.cmp !== null ? `₹${fmtNum(stk.cmp)}` : '-';
            const peStr = stk.pe !== null ? stk.pe.toFixed(2) : '-';
            const mcapStr = stk.mar_cap !== null ? `₹${fmtNum(stk.mar_cap, 2)}` : '-';
            const divStr = stk.div_yield !== null ? `${stk.div_yield.toFixed(2)}%` : '-';
            const npStr = stk.np_qtr !== null ? fmtNum(stk.np_qtr, 2) : '-';
            const npVarStr = fmtPct(stk.qtr_profit_var);
            const salesStr = stk.sales_qtr !== null ? fmtNum(stk.sales_qtr, 2) : '-';
            const salesVarStr = fmtPct(stk.qtr_sales_var);
            const roceStr = stk.roce !== null ? `${stk.roce.toFixed(2)}%` : '-';

            const sym = stk.symbol || '';
            const nseSym = sym ? (sym.endsWith('.NS') || sym.endsWith('.BO') ? sym : (/^\d+$/.test(sym) ? `${sym}.BO` : `${sym}.NS`)) : '';

            html += `
                <tr class="stock-row">
                    <td class="th-sno">${sno}</td>
                    <td class="td-company-name" title="${escapeHtml(stk.name)}">
                        <div style="display:flex; flex-direction:column; max-width: 100%; overflow: hidden;">
                            <a href="javascript:void(0)" class="ind-stock-link" onclick="openFundamentalsModal('${escapeHtml(nseSym || sym)}')" title="${escapeHtml(stk.name)}">
                                <span class="stock-name-text">${escapeHtml(stk.name)}</span>
                            </a>
                            ${sym ? `<span class="stock-sym-sub">${escapeHtml(sym)}</span>` : ''}
                        </div>
                    </td>
                    <td class="th-num"><strong>${cmpStr}</strong></td>
                    <td class="th-num">${peStr}</td>
                    <td class="th-num">${mcapStr}</td>
                    <td class="th-num">${npStr}</td>
                    <td class="th-num">${npVarStr}</td>
                    <td class="th-num">${salesStr}</td>
                    <td class="th-num">${salesVarStr}</td>
                    <td class="th-num"><strong>${roceStr}</strong></td>
                    <td class="th-num">${divStr}</td>
                    <td class="th-center">
                        <button type="button" class="stk-action-btn stk-action-chart" onclick="openStockChart('${escapeHtml(nseSym || sym)}')" title="Open Interactive Chart">📈</button>
                        <button type="button" class="stk-action-btn" onclick="openFundamentalsModal('${escapeHtml(nseSym || sym)}')" title="Open Fundamental Scorecard">📑</button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    }

    // 8. Refresh & Export
    async function refreshIndustriesData() {
        const btn = document.querySelector('.btn-ind-refresh');
        if (btn) {
            btn.innerText = '🔄 Refreshing...';
            btn.disabled = true;
        }
        await loadIndustriesOverviewModule(true);
        if (btn) {
            btn.innerText = '🔄 Refresh';
            btn.disabled = false;
        }
    }

    function exportIndustriesToCsv() {
        if (!allIndustries || !allIndustries.length) return;

        const headers = ['S.No', 'Industry', 'Macro Sector', 'Sector', 'Industry Group', 'Code', 'No. of Companies', 'Total M.Cap (Cr)', 'Median M.Cap (Cr)', 'Median P/E', 'Sales Growth (%)', 'OPM (%)', 'Wtd. Avg ROCE (%)', 'Median 1Y Return (%)'];
        const rows = allIndustries.map((ind, idx) => [
            idx + 1,
            `"${(ind.name || '').replace(/"/g, '""')}"`,
            `"${(ind.macro_name || '').replace(/"/g, '""')}"`,
            `"${(ind.sector_name || '').replace(/"/g, '""')}"`,
            `"${(ind.industry_group_name || '').replace(/"/g, '""')}"`,
            ind.code || '',
            ind.company_count || 0,
            ind.total_market_cap || 0,
            ind.median_market_cap || 0,
            ind.median_pe || '',
            ind.sales_growth || '',
            ind.opm || '',
            ind.wtd_roce || '',
            ind.return_1y || ''
        ]);

        const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `Industries_Overview_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Expose to window
    window.loadIndustriesOverviewModule = loadIndustriesOverviewModule;
    window.filterByMacroSector = filterByMacroSector;
    window.handleIndustrySearch = handleIndustrySearch;
    window.clearIndustrySearch = clearIndustrySearch;
    window.sortIndustries = sortIndustries;
    window.openIndustryStocks = openIndustryStocks;
    window.closeIndustryStocksView = closeIndustryStocksView;
    window.filterByMacroFromBreadcrumb = filterByMacroFromBreadcrumb;
    window.handleStockFilter = handleStockFilter;
    window.sortStocks = sortStocks;
    window.refreshIndustriesData = refreshIndustriesData;
    window.exportIndustriesToCsv = exportIndustriesToCsv;

    // Auto-init if industries-overview tab is active on page load
    if (window.INITIAL_TAB === 'industries-overview' || window.currentTab === 'industries-overview' || window.location.pathname === '/industries-overview') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => loadIndustriesOverviewModule());
        } else {
            loadIndustriesOverviewModule();
        }
    }
})();
