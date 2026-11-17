/**
 * CAPITAL DESK - MOMENTUM SMALLCASES MODULE
 * Location: modules/momentum_smallcases/momentum_smallcases.js
 * Front-end logic for managing:
 * 1. Momentum Smallcase Strategies (Dashboard, Add, Detail View, Timeline, Run Init, Run Rebalance, Step-up, Formula Edit)
 * 2. Manual Momentum Indices (CRUD, Parse, Live Preview, Format String)
 */

(function () {
    // State caches
    let activeSubView = 'strategies'; // 'strategies' | 'strategy-detail' | 'manual-indices'
    let strategiesCache = [];
    let strategiesSummary = {};
    let currentStrategy = null;
    let selectedRunIndex = null;
    let indicesCatalogCache = [];

    let momentumIndicesCache = [];
    let momentumSummaryCache = {};
    let currentViewingIndex = null;
    let isSubmitting = false;

    // =========================================================================
    // UTILITY FORMATTERS
    // =========================================================================
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatCurrency(val) {
        if (val == null || isNaN(val)) return '0.00';
        return Number(val).toLocaleString('en-IN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function formatPercent(val, withSign = true) {
        if (val == null || isNaN(val)) return '—';
        const num = Number(val);
        const formatted = Math.abs(num).toFixed(2) + '%';
        if (num > 0 && withSign) return `+${formatted}`;
        if (num < 0 && withSign) return `-${formatted}`;
        return formatted;
    }

    function formatDateDisplay(isoOrStr) {
        if (!isoOrStr) return '—';
        try {
            const d = new Date(isoOrStr);
            if (!isNaN(d.getTime())) {
                return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
            }
        } catch (_) {}
        return isoOrStr;
    }

    function formatDateTimeDisplay(isoOrStr) {
        if (!isoOrStr) return '—';
        try {
            const d = new Date(isoOrStr);
            if (!isNaN(d.getTime())) {
                return d.toLocaleString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }
        } catch (_) {}
        return isoOrStr;
    }

    // Client-side parser for manual index format: [stockname, DD/MM/YYYY]
    function parseStocksClient(stocksStr) {
        if (!stocksStr || typeof stocksStr !== 'string') return [];
        const results = [];
        const seen = new Set();
        const pattern = /\[\s*([^,\]\r\n]+?)\s*,\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})\s*\]/g;
        let match;
        while ((match = pattern.exec(stocksStr)) !== null) {
            const sym = match[1].trim().toUpperCase();
            let dt = match[2].trim().replace(/[\-\.]/g, '/');
            const parts = dt.split('/');
            if (parts.length === 3) {
                let d = parseInt(parts[0], 10);
                let m = parseInt(parts[1], 10);
                let y = parseInt(parts[2], 10);
                if (y < 100) y += 2000;
                dt = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
            }
            const key = sym + '_' + dt;
            if (!seen.has(key)) {
                seen.add(key);
                results.push({ symbol: sym, date_added: dt });
            }
        }
        return results;
    }

    // =========================================================================
    // SUB-VIEW SWITCHER
    // =========================================================================
    function switchMomentumSubView(subview, optStrategyId) {
        activeSubView = subview;

        const stratBtn = document.getElementById('msc-subnav-strategies-btn');
        const manualBtn = document.getElementById('msc-subnav-manual-btn');

        const secStrategies = document.getElementById('msc-subview-strategies');
        const secDetail = document.getElementById('msc-subview-strategy-detail');
        const secManual = document.getElementById('msc-subview-manual-indices');

        // Reset display
        if (secStrategies) secStrategies.style.display = 'none';
        if (secDetail) secDetail.style.display = 'none';
        if (secManual) secManual.style.display = 'none';

        if (stratBtn) stratBtn.classList.remove('active');
        if (manualBtn) manualBtn.classList.remove('active');

        if (subview === 'strategies') {
            if (stratBtn) stratBtn.classList.add('active');
            if (secStrategies) secStrategies.style.display = 'block';
            loadStrategiesList();
        } else if (subview === 'strategy-detail') {
            if (stratBtn) stratBtn.classList.add('active');
            if (secDetail) secDetail.style.display = 'block';
            if (optStrategyId) {
                openStrategyDetailView(optStrategyId);
            }
        } else if (subview === 'manual-indices') {
            if (manualBtn) manualBtn.classList.add('active');
            if (secManual) secManual.style.display = 'block';
            loadMomentumManualIndices();
        }
    }

    // Main entry point called by router on tab activation
    function loadMomentumSmallcasesTab() {
        if (activeSubView === 'manual-indices') {
            loadMomentumManualIndices();
        } else if (activeSubView === 'strategy-detail' && currentStrategy) {
            openStrategyDetailView(currentStrategy.id);
        } else {
            switchMomentumSubView('strategies');
        }
    }

    // =========================================================================
    // 1. MOMENTUM SMALLCASE STRATEGIES (DASHBOARD)
    // =========================================================================
    async function loadStrategiesList() {
        const mount = document.getElementById('momentum-strategies-mount');
        if (!mount) return;

        mount.innerHTML = `
            <div style="text-align: center; padding: 45px 20px; color: var(--text-secondary);">
                <span class="spinning" style="display: inline-block; font-size: 24px; margin-bottom: 8px;">⏳</span><br>
                Loading Momentum Smallcases...
            </div>
        `;

        try {
            const res = await fetch('/api/momentum-smallcases/strategies');
            const data = await res.json();
            if (!data.success) {
                mount.innerHTML = `<div style="text-align: center; padding: 30px; color: #ef4444;">Failed to load strategies: ${escapeHtml(data.error || 'Server error')}</div>`;
                return;
            }

            strategiesCache = data.strategies || [];
            strategiesSummary = data.summary || {};

            renderStrategiesStats();
            renderStrategiesTable(strategiesCache);
        } catch (err) {
            console.error('Error loading strategies list:', err);
            mount.innerHTML = `<div style="text-align: center; padding: 30px; color: #ef4444;">Failed to load strategies: ${escapeHtml(err.message)}</div>`;
        }
    }

    function renderStrategiesStats() {
        const s = strategiesSummary;
        const totalEl = document.getElementById('msc-stat-total-strats');
        const activeEl = document.getElementById('msc-stat-active-strats');
        const capEl = document.getElementById('msc-stat-total-capital');
        const portEl = document.getElementById('msc-stat-portfolio-val');

        if (totalEl) totalEl.innerText = s.total_strategies || 0;
        if (activeEl) activeEl.innerText = s.active_strategies || 0;
        if (capEl) capEl.innerText = `₹${formatCurrency(s.total_capital || 0)}`;
        if (portEl) portEl.innerText = `₹${formatCurrency(s.total_portfolio_value || 0)}`;
    }

    function renderStrategiesTable(strategies) {
        const mount = document.getElementById('momentum-strategies-mount');
        if (!mount) return;

        const countBadge = document.getElementById('msc-strategies-count-badge');
        if (countBadge) {
            countBadge.innerText = `${strategies.length} ${strategies.length === 1 ? 'Smallcase' : 'Smallcases'}`;
        }

        if (!strategies || strategies.length === 0) {
            mount.innerHTML = `
                <div style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
                    <div style="font-size: 44px; margin-bottom: 12px;">🚀</div>
                    <h3 style="margin: 0 0 6px 0; font-size: 17px; color: var(--text-primary);">No Momentum Smallcases Created</h3>
                    <p style="margin: 0 0 18px 0; font-size: 13px; max-width: 480px; margin-inline: auto; line-height: 1.5;">
                        Create your systematic momentum smallcase with your preferred universe (Nifty benchmark or Manual Custom Index), target portfolio size, exit regime ranking, and scheduled monthly rebalancing.
                    </p>
                    <button type="button" class="btn-primary" onclick="openAddStrategyModal()" style="font-size: 13px; padding: 8px 20px; display: inline-flex; align-items: center; gap: 6px;">
                        <span>➕</span> <span>Add Smallcase</span>
                    </button>
                </div>
            `;
            return;
        }

        let html = `
            <div style="overflow-x: auto;">
                <table class="msc-indices-table">
                    <thead>
                        <tr>
                            <th style="min-width: 220px;">SMALLCASE NAME</th>
                            <th style="min-width: 170px;">INDEX UNIVERSE</th>
                            <th style="min-width: 140px;">TARGETS</th>
                            <th style="min-width: 120px;">REBALANCE</th>
                            <th style="min-width: 130px; text-align: right;">INVESTED</th>
                            <th style="min-width: 130px; text-align: right;">CURRENT VALUE</th>
                            <th style="min-width: 110px; text-align: center;">STATUS</th>
                            <th style="min-width: 170px; text-align: right;">ACTIONS</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        strategies.forEach(s => {
            const isDraft = s.status === 'DRAFT' || !s.runs || s.runs.length === 0;
            const statusBadge = isDraft
                ? `<span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; font-size: 11px; padding: 3px 8px; border-radius: 4px;">DRAFT</span>`
                : `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700;">ACTIVE</span>`;

            const invested = Number(s.amount_to_invest || 0);
            const currVal = Number(s.current_portfolio_value || invested);
            const pnl = currVal - invested;
            const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;

            let pnlHtml = '';
            if (!isDraft) {
                const color = pnl >= 0 ? '#10b981' : '#ef4444';
                pnlHtml = `<div style="font-size: 11px; color: ${color}; font-weight: 600;">${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</div>`;
            }

            html += `
                <tr>
                    <td>
                        <div class="msc-index-name" style="cursor: pointer;" onclick="openStrategyDetailView('${escapeHtml(s.id)}')">
                            <span>🚀</span>
                            <span style="color: var(--text-primary); text-decoration: underline; text-decoration-color: transparent; transition: text-decoration-color 0.15s;" onmouseover="this.style.textDecorationColor='currentColor'" onmouseout="this.style.textDecorationColor='transparent'">${escapeHtml(s.name)}</span>
                        </div>
                        <div style="font-size: 11.5px; color: var(--text-secondary); margin-top: 3px;">
                            Start: ${formatDateDisplay(s.start_date)}
                        </div>
                    </td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <span style="font-size: 12px; font-weight: 600; color: var(--text-primary);">${escapeHtml(s.index_name || s.index_id)}</span>
                            ${s.index_type === 'manual' ? `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6; font-size: 10px; padding: 1px 5px; border-radius: 3px;">MANUAL</span>` : ''}
                        </div>
                    </td>
                    <td>
                        <div style="font-size: 12px;">
                            <span style="color: #10b981; font-weight: 700;">${s.no_of_stocks} Top</span> / 
                            <span style="color: #eab308; font-weight: 700;">Exit &le; ${s.exit_regime_ranking}</span>
                        </div>
                    </td>
                    <td>
                        <div style="font-size: 12.5px; color: var(--text-primary);">
                            <strong>${s.rebalance_day}th</strong> <span style="font-size: 11px; color: var(--text-secondary);">monthly</span>
                        </div>
                    </td>
                    <td style="text-align: right; font-family: monospace; font-size: 13px; font-weight: 600;">
                        ₹${formatCurrency(invested)}
                    </td>
                    <td style="text-align: right; font-family: monospace;">
                        <div style="font-size: 13px; font-weight: 700; color: var(--text-primary);">₹${formatCurrency(currVal)}</div>
                        ${pnlHtml}
                    </td>
                    <td style="text-align: center;">
                        ${statusBadge}
                    </td>
                    <td style="text-align: right;">
                        <div style="display: inline-flex; gap: 6px; justify-content: flex-end;">
                            <button type="button" class="msc-action-btn view" onclick="openStrategyDetailView('${escapeHtml(s.id)}')" title="View Details & Timeline">
                                <span>👁️ Details</span>
                            </button>
                            ${isDraft ? `
                                <button type="button" class="msc-action-btn edit" onclick="runStrategyInit('${escapeHtml(s.id)}')" title="Execute Initial Allocation" style="color: #10b981; border-color: rgba(16, 185, 129, 0.4);">
                                    <span>▶ Init</span>
                                </button>
                            ` : ''}
                            <button type="button" class="msc-action-btn delete" onclick="openDeleteStrategyModal('${escapeHtml(s.id)}', '${escapeHtml(s.name)}')" title="Delete Smallcase">
                                <span>🗑️</span>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        mount.innerHTML = html;
    }

    function filterStrategiesList(query) {
        query = (query || '').trim().toLowerCase();
        if (!query) {
            renderStrategiesTable(strategiesCache);
            return;
        }

        const filtered = strategiesCache.filter(s => {
            const nameMatch = (s.name || '').toLowerCase().includes(query);
            const idxMatch = (s.index_name || '').toLowerCase().includes(query);
            return nameMatch || idxMatch;
        });

        renderStrategiesTable(filtered);
    }

    // =========================================================================
    // 2. ADD STRATEGY MODAL
    // =========================================================================
    async function openAddStrategyModal() {
        const modal = document.getElementById('addStrategyModal');
        const select = document.getElementById('stratIndexSelect');
        const submitBtn = document.getElementById('stratCreateSubmitBtn');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Create Smallcase';
        }

        // Set default date to today
        const todayStr = new Date().toISOString().slice(0, 10);
        document.getElementById('stratStartDateInput').value = todayStr;
        document.getElementById('stratNameInput').value = '';
        document.getElementById('stratNoOfStocksInput').value = '12';
        document.getElementById('stratExitRegimeInput').value = '22';
        document.getElementById('stratRebalDayInput').value = '21';
        document.getElementById('stratAmountInput').value = '100000';
        document.getElementById('stratFormulaInput').value =
            '(50% * 1M price return + 30% * 2M price return + 10% * 5M price return + 10% * 9M price return ) / (1M Price Volatility + 3M Price Volatility)';

        // Populate indices catalog
        if (select) {
            select.innerHTML = '<option value="">Loading indices...</option>';
            try {
                const res = await fetch('/api/momentum-smallcases/indices-catalog');
                const data = await res.json();
                if (data.success && Array.isArray(data.indices)) {
                    indicesCatalogCache = data.indices;
                    let optHtml = '';

                    const manualIndices = indicesCatalogCache.filter(x => x.type === 'manual');
                    const niftyIndices = indicesCatalogCache.filter(x => x.type === 'nifty');

                    if (manualIndices.length > 0) {
                        optHtml += `<optgroup label="📑 Manual Momentum Indices">`;
                        manualIndices.forEach(idx => {
                            optHtml += `<option value="${escapeHtml(idx.id)}">${escapeHtml(idx.name)} (${idx.stock_count || 0} stocks)</option>`;
                        });
                        optHtml += `</optgroup>`;
                    }

                    if (niftyIndices.length > 0) {
                        optHtml += `<optgroup label="📊 Nifty Benchmark Indices">`;
                        niftyIndices.forEach(idx => {
                            optHtml += `<option value="${escapeHtml(idx.id)}">${escapeHtml(idx.name)} (${idx.stock_count || 0} stocks)</option>`;
                        });
                        optHtml += `</optgroup>`;
                    }

                    select.innerHTML = optHtml || '<option value="">No indices available</option>';
                    checkStratDateAndIndexMatch();
                } else {
                    select.innerHTML = '<option value="">Failed to load indices</option>';
                }
            } catch (e) {
                console.error('Error fetching indices catalog:', e);
                select.innerHTML = '<option value="">Error loading catalog</option>';
            }
        }

        if (modal) modal.style.display = 'flex';
        setTimeout(() => {
            const input = document.getElementById('stratNameInput');
            if (input) input.focus();
        }, 100);
    }

    async function checkStratDateAndIndexMatch() {
        const indexId = document.getElementById('stratIndexSelect')?.value;
        const startDateVal = document.getElementById('stratStartDateInput')?.value;
        const hintEl = document.getElementById('stratIndexHint');
        const dateHintEl = document.getElementById('stratStartDateHint');
        if (!hintEl) return;

        if (!indexId) {
            hintEl.innerHTML = `<span style="color: var(--text-secondary);">Select index universe to evaluate momentum rankings from.</span>`;
            if (dateHintEl) dateHintEl.innerHTML = `📅 If holiday/weekend, auto-advances to next trading day.`;
            return;
        }

        const found = indicesCatalogCache.find(x => x.id === indexId);
        if (!found) return;

        if (found.type === 'nifty') {
            hintEl.innerHTML = `<span style="color: #10b981; font-weight: 600;">✓ Official Nifty benchmark (${found.stock_count} constituents). All stocks eligible.</span>`;
            if (dateHintEl) dateHintEl.innerHTML = `📅 If holiday/weekend, auto-advances to next trading day.`;
            return;
        }

        // For manual index: fetch or find index constituents
        let manualIdx = momentumIndicesCache.find(x => x.id === indexId);
        if (!manualIdx || !manualIdx.stocks) {
            try {
                const res = await fetch(`/api/momentum-smallcases/indices/${encodeURIComponent(indexId)}?enrich=0`);
                const data = await res.json();
                if (data.success && data.index) {
                    manualIdx = data.index;
                }
            } catch (_) {}
        }

        if (!manualIdx || !manualIdx.stocks || manualIdx.stocks.length === 0) {
            hintEl.innerHTML = `<span style="color: #ef4444; font-weight: 600;">⚠️ This index has 0 constituent stocks! Please add stocks in Manual Indices first.</span>`;
            return;
        }

        const stocks = manualIdx.stocks;
        if (!startDateVal) {
            hintEl.innerHTML = `<span style="color: var(--text-secondary);">Index has ${stocks.length} stocks. Select a Start Date to check eligibility.</span>`;
            return;
        }

        const startD = new Date(startDateVal);
        let eligibleCount = 0;
        let earliestDate = null;
        let latestDate = null;

        stocks.forEach(s => {
            const dtStr = s.date_added;
            if (!dtStr) {
                eligibleCount++;
                return;
            }
            const parts = dtStr.replace(/[\-\.]/g, '/').split('/');
            if (parts.length === 3) {
                const d = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10) - 1;
                const y = parseInt(parts[2], 10);
                const stockD = new Date(y, m, d);
                if (!earliestDate || stockD < earliestDate) earliestDate = stockD;
                if (!latestDate || stockD > latestDate) latestDate = stockD;
                if (stockD <= startD) eligibleCount++;
            } else {
                eligibleCount++;
            }
        });

        const earliestFmt = earliestDate ? earliestDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';
        const latestFmt = latestDate ? latestDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';

        if (eligibleCount === 0) {
            hintEl.innerHTML = `<span style="color: #f59e0b; font-weight: 600;">⚠️ 0 of ${stocks.length} stocks eligible! Earliest stock added on ${earliestFmt}.</span>`;
            if (dateHintEl) {
                dateHintEl.innerHTML = `<span style="color: #f59e0b; font-weight: 600;">⚠️ Start Date is before all constituent stock dates (earliest: ${earliestFmt}). Set Start Date &ge; ${earliestFmt} to include stocks in Init.</span>`;
            }
        } else {
            hintEl.innerHTML = `<span style="color: #10b981; font-weight: 600;">✓ ${eligibleCount} of ${stocks.length} stocks eligible for Init on this start date (Added: ${earliestFmt} to ${latestFmt}).</span>`;
            if (dateHintEl) {
                dateHintEl.innerHTML = `📅 If holiday/weekend, auto-advances to next trading day.`;
            }
        }
    }

    function closeAddStrategyModal() {
        const modal = document.getElementById('addStrategyModal');
        if (modal) modal.style.display = 'none';
    }

    async function submitCreateStrategy() {
        if (isSubmitting) return;

        const name = (document.getElementById('stratNameInput')?.value || '').trim();
        const startDate = (document.getElementById('stratStartDateInput')?.value || '').trim();
        const indexId = (document.getElementById('stratIndexSelect')?.value || '').trim();
        const noOfStocks = parseInt(document.getElementById('stratNoOfStocksInput')?.value, 10);
        const exitRegime = parseInt(document.getElementById('stratExitRegimeInput')?.value, 10);
        const rebalDay = parseInt(document.getElementById('stratRebalDayInput')?.value, 10);
        const amount = parseFloat(document.getElementById('stratAmountInput')?.value);
        const formula = (document.getElementById('stratFormulaInput')?.value || '').trim();

        if (!name) {
            alertToast('Please enter a smallcase name', 'warning');
            document.getElementById('stratNameInput')?.focus();
            return;
        }
        if (!startDate) {
            alertToast('Please select a start date', 'warning');
            return;
        }
        if (!indexId) {
            alertToast('Please select an index universe', 'warning');
            return;
        }
        if (isNaN(noOfStocks) || noOfStocks < 1) {
            alertToast('No. of stocks must be at least 1', 'warning');
            return;
        }
        if (isNaN(exitRegime) || exitRegime < noOfStocks) {
            alertToast(`Exit regime ranking must be >= No. of stocks (${noOfStocks})`, 'warning');
            return;
        }
        if (isNaN(rebalDay) || rebalDay < 1 || rebalDay > 31) {
            alertToast('Rebalance day must be between 1 and 31', 'warning');
            return;
        }
        if (isNaN(amount) || amount <= 0) {
            alertToast('Amount to invest must be a positive number', 'warning');
            return;
        }

        const submitBtn = document.getElementById('stratCreateSubmitBtn');
        const origText = submitBtn ? submitBtn.innerText : 'Create';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span>⏳</span> Creating...';
        }
        isSubmitting = true;

        try {
            const res = await fetch('/api/momentum-smallcases/strategies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    start_date: startDate,
                    index_id: indexId,
                    no_of_stocks: noOfStocks,
                    exit_regime_ranking: exitRegime,
                    rebalance_day: rebalDay,
                    amount_to_invest: amount,
                    formula: formula
                })
            });

            const data = await res.json();
            if (!data.success) {
                alertToast(data.error || 'Failed to create strategy', 'error');
                return;
            }

            closeAddStrategyModal();
            alertToast(`Smallcase "${name}" created successfully!`, 'success');
            await loadStrategiesList();

            // Open detail view for new smallcase immediately
            if (data.strategy && data.strategy.id) {
                openStrategyDetailView(data.strategy.id);
            }
        } catch (err) {
            console.error('Error creating strategy:', err);
            alertToast('Failed to create smallcase: ' + err.message, 'error');
        } finally {
            isSubmitting = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = origText;
            }
        }
    }

    // =========================================================================
    // 3. STRATEGY DETAILS & EXECUTION TIMELINE VIEW
    // =========================================================================
    async function openStrategyDetailView(strategyId) {
        switchMomentumSubView('strategy-detail');

        const container = document.getElementById('sd-selected-run-container');
        if (container) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
                    <span class="spinning" style="display: inline-block; font-size: 24px; margin-bottom: 8px;">⏳</span><br>
                    Loading Smallcase Details...
                </div>
            `;
        }

        try {
            const res = await fetch(`/api/momentum-smallcases/strategies/${encodeURIComponent(strategyId)}`);
            const data = await res.json();
            if (!data.success || !data.strategy) {
                if (container) {
                    container.innerHTML = `<div style="text-align: center; padding: 30px; color: #ef4444;">Failed to load smallcase details.</div>`;
                }
                return;
            }

            currentStrategy = data.strategy;
            const s = currentStrategy;

            // Render Header
            document.getElementById('sd-strategy-name').innerHTML = `<span>🚀</span> <span>${escapeHtml(s.name)}</span>`;
            const badgeEl = document.getElementById('sd-status-badge');
            if (badgeEl) {
                if (s.status === 'ACTIVE') {
                    badgeEl.innerText = 'ACTIVE';
                    badgeEl.style.background = 'rgba(16, 185, 129, 0.15)';
                    badgeEl.style.color = '#10b981';
                    badgeEl.style.border = '1px solid rgba(16, 185, 129, 0.4)';
                } else {
                    badgeEl.innerText = 'DRAFT';
                    badgeEl.style.background = 'rgba(148, 163, 184, 0.15)';
                    badgeEl.style.color = '#94a3b8';
                    badgeEl.style.border = '1px solid rgba(148, 163, 184, 0.3)';
                }
            }

            document.getElementById('sd-index-name').innerText = s.index_name || s.index_id;
            let startText = formatDateDisplay(s.start_date);
            if (s.is_start_holiday_moved) {
                startText += ` (Trading day: ${formatDateDisplay(s.effective_start_date)})`;
            }
            document.getElementById('sd-start-date').innerText = startText;
            document.getElementById('sd-stock-counts').innerText = `Top ${s.no_of_stocks} (Green) / Exit Rank ${s.exit_regime_ranking} (Yellow)`;
            document.getElementById('sd-rebal-day').innerText = `${s.rebalance_day}th monthly`;

            // Render Financial Metrics
            const capVal = Number(s.amount_to_invest || 0);
            const portVal = Number(s.current_portfolio_value || capVal);
            const walletVal = Number(s.current_wallet || 0);
            const feesVal = Number(s.total_fees_paid || 0);
            const holdingsCount = (s.holdings || []).length;

            document.getElementById('sd-metric-capital').innerText = `₹${formatCurrency(capVal)}`;
            document.getElementById('sd-metric-port-value').innerText = `₹${formatCurrency(portVal)}`;
            document.getElementById('sd-metric-wallet').innerText = `₹${formatCurrency(walletVal)}`;
            document.getElementById('sd-metric-fees').innerText = `₹${formatCurrency(feesVal)}`;
            document.getElementById('sd-metric-holdings-count').innerText = `${holdingsCount} ${holdingsCount === 1 ? 'stock' : 'stocks'}`;

            // Render Formula
            document.getElementById('sd-formula-text').innerText = s.formula || '—';

            // Render Timeline & Selected Run
            const runs = s.runs || [];
            if (selectedRunIndex == null || selectedRunIndex >= runs.length) {
                selectedRunIndex = runs.length > 0 ? runs.length - 1 : null;
            }

            renderTimeline(runs, s.next_rebalance_date, s.status);

            if (runs.length > 0 && selectedRunIndex != null) {
                renderRunResults(runs[selectedRunIndex]);
            } else {
                renderUnrunStrategyView(s);
            }
        } catch (err) {
            console.error('Error fetching strategy detail:', err);
            if (container) {
                container.innerHTML = `<div style="text-align: center; padding: 30px; color: #ef4444;">Error: ${escapeHtml(err.message)}</div>`;
            }
        }
    }

    function renderTimeline(runs, nextRebalDate, status) {
        const mount = document.getElementById('sd-timeline-mount');
        const actionSlot = document.getElementById('sd-timeline-action-slot');
        if (!mount) return;

        let actionBtnHtml = '';
        if (status === 'DRAFT' || runs.length === 0) {
            actionBtnHtml = `
                <button type="button" class="btn-primary" onclick="runStrategyInit('${escapeHtml(currentStrategy.id)}')" style="font-size: 13px; padding: 7px 18px; display: inline-flex; align-items: center; gap: 6px;">
                    <span>▶</span> <span>Run Init</span>
                </button>
            `;
        } else {
            actionBtnHtml = `
                <button type="button" class="btn-primary" onclick="openRunRebalanceModal()" style="font-size: 13px; padding: 7px 18px; display: inline-flex; align-items: center; gap: 6px; background: #10b981;">
                    <span>🔄</span> <span>Run Rebalance</span>
                </button>
            `;
        }
        if (actionSlot) actionSlot.innerHTML = actionBtnHtml;

        let html = '';

        if (runs.length === 0) {
            // Unrun Init Node
            html += `
                <div class="msc-timeline-node selected" onclick="selectTimelineRun(null)">
                    <div class="msc-timeline-icon current">▶</div>
                    <div class="msc-timeline-label">Init</div>
                    <div class="msc-timeline-subtext">Scheduled: ${formatDateDisplay(currentStrategy.start_date)}</div>
                </div>
                <div class="msc-timeline-connector"></div>
                <div class="msc-timeline-node" style="opacity: 0.6; cursor: default;">
                    <div class="msc-timeline-icon upcoming">⏳</div>
                    <div class="msc-timeline-label">Next Rebalance</div>
                    <div class="msc-timeline-subtext">Scheduled: ${formatDateDisplay(nextRebalDate)}</div>
                </div>
            `;
        } else {
            runs.forEach((r, idx) => {
                const isSelected = idx === selectedRunIndex;
                const isInit = r.run_type === 'INIT';
                const label = isInit ? 'Init' : (r.title || `Rebalance #${r.run_number || idx}`);
                const execDate = formatDateDisplay(r.executed_date || r.scheduled_date);
                const holidayNote = r.is_holiday_adjusted ? ' (Adj)' : '';

                html += `
                    <div class="msc-timeline-node ${isSelected ? 'selected' : ''}" onclick="selectTimelineRun(${idx})" title="Click to view run results on ${execDate}">
                        <div class="msc-timeline-icon completed">${isInit ? '✓' : '🔄'}</div>
                        <div class="msc-timeline-label">${escapeHtml(label)}</div>
                        <div class="msc-timeline-subtext">${execDate}${holidayNote}</div>
                    </div>
                `;

                // Connecting line
                html += `<div class="msc-timeline-connector completed"></div>`;
            });

            // Upcoming Next Rebalance node (Readonly)
            html += `
                <div class="msc-timeline-node" style="opacity: 0.85; cursor: default;" title="Upcoming next scheduled rebalancing day">
                    <div class="msc-timeline-icon upcoming">⏳</div>
                    <div class="msc-timeline-label" style="color: var(--text-secondary);">Next Rebalance</div>
                    <div class="msc-timeline-subtext" style="color: #10b981; font-weight: 600;">${formatDateDisplay(nextRebalDate)}</div>
                </div>
            `;
        }

        mount.innerHTML = html;
    }

    function selectTimelineRun(runIndex) {
        selectedRunIndex = runIndex;
        if (!currentStrategy) return;

        const runs = currentStrategy.runs || [];
        renderTimeline(runs, currentStrategy.next_rebalance_date, currentStrategy.status);

        if (runIndex != null && runs[runIndex]) {
            renderRunResults(runs[runIndex]);
        } else {
            renderUnrunStrategyView(currentStrategy);
        }
    }

    function renderUnrunStrategyView(strategy) {
        const container = document.getElementById('sd-selected-run-container');
        if (!container) return;

        container.innerHTML = `
            <div style="background: var(--bg-card); border: 1px dashed var(--border-color); border-radius: 8px; padding: 40px 20px; text-align: center; margin-top: 10px;">
                <div style="font-size: 38px; margin-bottom: 10px;">🎯</div>
                <h3 style="margin: 0 0 8px 0; font-size: 17px; color: var(--text-primary);">Ready to Execute Initial Portfolio (Init)</h3>
                <p style="margin: 0 auto 20px auto; font-size: 13px; max-width: 520px; color: var(--text-secondary); line-height: 1.5;">
                    Executing Init will evaluate all constituent stocks added on or before <strong>${formatDateDisplay(strategy.start_date)}</strong>, rank them using your momentum formula, allocate equal capital across the top <strong>${strategy.no_of_stocks}</strong> stocks (deducting 0.10% transaction fees), and place the smallcase in <strong>ACTIVE</strong> state.
                </p>
                <button type="button" class="btn-primary" onclick="runStrategyInit('${escapeHtml(strategy.id)}')" style="font-size: 13.5px; padding: 9px 24px; display: inline-flex; align-items: center; gap: 8px;">
                    <span>▶</span> <span>Execute Initial Portfolio (Init)</span>
                </button>
            </div>
        `;
    }

    function renderRunResults(run) {
        const container = document.getElementById('sd-selected-run-container');
        if (!container) return;

        const changes = run.changes || { added: [], removed: [], retained: [] };
        const added = changes.added || [];
        const removed = changes.removed || [];
        const retained = changes.retained || [];

        const rankedStocks = run.ranked_stocks || [];
        const portfolio = run.portfolio_snapshot || {};
        const holdings = portfolio.holdings || currentStrategy.holdings || [];
        const capitalLogs = currentStrategy.capital_logs || [];

        // Header info of selected run
        const isInit = run.run_type === 'INIT';
        const runTitle = isInit ? 'Initial Run (Init)' : (run.title || 'Rebalance Run');
        const execDate = formatDateDisplay(run.executed_date);
        const schedDate = formatDateDisplay(run.scheduled_date);
        let dateNote = `Executed: <strong>${execDate}</strong>`;
        if (run.is_holiday_adjusted) {
            dateNote += ` <span class="badge" style="background: rgba(234, 179, 8, 0.15); color: #eab308; font-size: 11px;">Holiday Adjusted from ${schedDate}</span>`;
        }

        let html = `
            <!-- Run Summary Banner -->
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px 18px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                <div>
                    <div style="font-size: 16px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                        <span>${isInit ? '🎯' : '🔄'}</span> <span>${escapeHtml(runTitle)}</span>
                    </div>
                    <div style="font-size: 12.5px; color: var(--text-secondary); margin-top: 4px;">
                        ${dateNote} &bull; Universe eligible stocks: <strong>${run.eligible_stocks_count || rankedStocks.length}</strong>
                    </div>
                </div>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <span style="font-size: 12px; color: var(--text-secondary);">
                        Snapshot Value: <strong style="color: #10b981; font-family: monospace;">₹${formatCurrency(portfolio.total_portfolio_value || 0)}</strong>
                    </span>
                    <span style="font-size: 12px; color: var(--text-secondary);">
                        Cash in Wallet: <strong style="color: var(--text-primary); font-family: monospace;">₹${formatCurrency(portfolio.wallet_balance || 0)}</strong>
                    </span>
                </div>
            </div>

            <!-- Comparison & Changes Box -->
            <div class="msc-changes-grid">
                <div class="msc-change-card added">
                    <div class="msc-change-header">
                        <span class="msc-change-title" style="color: #10b981;">➕ Added Stocks</span>
                        <span class="msc-change-count" style="color: #10b981;">${added.length}</span>
                    </div>
                    <div class="msc-change-chips">
                        ${added.length === 0 ? '<span style="font-size: 12px; color: var(--text-secondary);">None</span>' : added.map(s => `<span class="msc-stock-chip add">${escapeHtml(typeof s === 'object' ? s.symbol : s)}</span>`).join('')}
                    </div>
                </div>
                <div class="msc-change-card removed">
                    <div class="msc-change-header">
                        <span class="msc-change-title" style="color: #ef4444;">➖ Removed / Exited</span>
                        <span class="msc-change-count" style="color: #ef4444;">${removed.length}</span>
                    </div>
                    <div class="msc-change-chips">
                        ${removed.length === 0 ? '<span style="font-size: 12px; color: var(--text-secondary);">None</span>' : removed.map(s => `<span class="msc-stock-chip rem">${escapeHtml(typeof s === 'object' ? s.symbol : s)}</span>`).join('')}
                    </div>
                </div>
                <div class="msc-change-card retained">
                    <div class="msc-change-header">
                        <span class="msc-change-title" style="color: #3b82f6;">🔄 Retained Stocks</span>
                        <span class="msc-change-count" style="color: #3b82f6;">${retained.length}</span>
                    </div>
                    <div class="msc-change-chips">
                        ${retained.length === 0 ? '<span style="font-size: 12px; color: var(--text-secondary);">None</span>' : retained.map(s => `<span class="msc-stock-chip ret">${escapeHtml(typeof s === 'object' ? s.symbol : s)}</span>`).join('')}
                    </div>
                </div>
            </div>

            <!-- Ranked Stocks Formula Evaluation Table -->
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 18px; margin-bottom: 22px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
                    <div>
                        <h4 style="margin: 0; font-size: 14.5px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                            <span>🏆</span> <span>Ranked Stocks by Momentum Formula (Limit: Exit Ranking + 15)</span>
                        </h4>
                        <div style="font-size: 11.5px; color: var(--text-secondary); margin-top: 3px;">
                            <span style="display: inline-block; width: 10px; height: 10px; background: #10b981; border-radius: 2px; margin-right: 3px; vertical-align: middle;"></span> Green: Top ${currentStrategy.no_of_stocks} picks &nbsp;|&nbsp;
                            <span style="display: inline-block; width: 10px; height: 10px; background: #ca8a04; border-radius: 2px; margin-right: 3px; vertical-align: middle;"></span> Dark Yellow: Exit Regime (Rank &le; ${currentStrategy.exit_regime_ranking}) &nbsp;|&nbsp;
                            Showing top ${rankedStocks.length} stocks
                        </div>
                    </div>
                </div>

                <div style="overflow-x: auto; max-height: 480px;">
                    <table class="msc-indices-table" style="font-size: 12px;">
                        <thead>
                            <tr style="position: sticky; top: 0; z-index: 2; background: var(--bg-subtle);">
                                <th style="width: 50px; text-align: center;">RANK</th>
                                <th style="min-width: 140px;">STOCK</th>
                                <th style="text-align: right; min-width: 85px;">1M RET</th>
                                <th style="text-align: right; min-width: 85px;">2M RET</th>
                                <th style="text-align: right; min-width: 85px;">5M RET</th>
                                <th style="text-align: right; min-width: 85px;">9M RET</th>
                                <th style="text-align: right; min-width: 85px;">1M VOL</th>
                                <th style="text-align: right; min-width: 85px;">3M VOL</th>
                                <th style="text-align: right; min-width: 95px;">TOTAL SCORE</th>
                                <th style="text-align: right; min-width: 95px;">PRICE (₹)</th>
                                <th style="text-align: center; min-width: 110px;">ACTION</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        if (rankedStocks.length === 0) {
            html += `<tr><td colspan="11" style="text-align: center; padding: 25px; color: var(--text-secondary);">No calculated stock rankings available for this run.</td></tr>`;
        } else {
            rankedStocks.forEach(s => {
                const rank = s.rank || 0;
                let rowClass = '';
                let tierBadge = '';

                if (rank <= currentStrategy.no_of_stocks) {
                    rowClass = 'msc-row-top-selection';
                    tierBadge = `<span class="msc-tier-badge top-pick">Top ${rank}</span>`;
                } else if (rank <= currentStrategy.exit_regime_ranking) {
                    rowClass = 'msc-row-exit-regime';
                    tierBadge = `<span class="msc-tier-badge exit-regime">Exit ${rank}</span>`;
                } else {
                    rowClass = 'msc-row-excluded';
                    tierBadge = `<span class="msc-tier-badge excluded">#${rank}</span>`;
                }

                // Action pill
                let actionPill = '<span class="msc-action-pill none">—</span>';
                if (s.action === 'BUY') {
                    actionPill = `<span class="msc-action-pill buy">BUY (${s.quantity || 0})</span>`;
                } else if (s.action === 'HOLD') {
                    actionPill = `<span class="msc-action-pill hold">HOLD (${s.quantity || 0})</span>`;
                } else if (s.action === 'SELL') {
                    actionPill = `<span class="msc-action-pill sell">SELL</span>`;
                } else if (s.action === 'SKIPPED') {
                    actionPill = `<span class="msc-action-pill none">SKIPPED</span>`;
                }

                html += `
                    <tr class="${rowClass}">
                        <td style="text-align: center; font-weight: 700;">
                            ${tierBadge}
                        </td>
                        <td>
                            <strong style="color: var(--text-primary); cursor: pointer;" onclick="if(typeof openInHouseChart==='function') openInHouseChart('${escapeHtml(s.symbol)}');" title="Open chart">
                                ${escapeHtml(s.symbol)}
                            </strong>
                            ${s.date_added ? `<div style="font-size: 10px; color: var(--text-secondary);">Added: ${escapeHtml(s.date_added)}</div>` : ''}
                        </td>
                        <td style="text-align: right; font-family: monospace; ${colorForNum(s.ret_1m)}">${formatPercent(s.ret_1m)}</td>
                        <td style="text-align: right; font-family: monospace; ${colorForNum(s.ret_2m)}">${formatPercent(s.ret_2m)}</td>
                        <td style="text-align: right; font-family: monospace; ${colorForNum(s.ret_5m)}">${formatPercent(s.ret_5m)}</td>
                        <td style="text-align: right; font-family: monospace; ${colorForNum(s.ret_9m)}">${formatPercent(s.ret_9m)}</td>
                        <td style="text-align: right; font-family: monospace; color: var(--text-secondary);">${formatPercent(s.vol_1m, false)}</td>
                        <td style="text-align: right; font-family: monospace; color: var(--text-secondary);">${formatPercent(s.vol_3m, false)}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 700; color: #10b981; font-size: 12.5px;">
                            ${s.total_score != null ? Number(s.total_score).toFixed(4) : '—'}
                        </td>
                        <td style="text-align: right; font-family: monospace; font-weight: 600;">
                            ₹${s.price != null ? formatCurrency(s.price) : '—'}
                        </td>
                        <td style="text-align: center;">
                            ${actionPill}
                        </td>
                    </tr>
                `;
            });
        }

        html += `
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Current Portfolio Holdings Snapshot Table -->
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 18px; margin-bottom: 22px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <h4 style="margin: 0; font-size: 14.5px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                        <span>💼</span> <span>Portfolio Holdings Snapshot (${holdings.length} stocks)</span>
                    </h4>
                </div>
                <div style="overflow-x: auto;">
                    <table class="msc-indices-table" style="font-size: 12px;">
                        <thead>
                            <tr style="background: var(--bg-subtle);">
                                <th style="width: 40px;">#</th>
                                <th>SYMBOL</th>
                                <th style="text-align: right;">QTY</th>
                                <th style="text-align: right;">BUY PRICE</th>
                                <th style="text-align: right;">CURRENT PRICE</th>
                                <th style="text-align: right;">INVESTED</th>
                                <th style="text-align: right;">CURRENT VALUE</th>
                                <th style="text-align: right;">P&amp;L (₹)</th>
                                <th style="text-align: right;">P&amp;L %</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        if (holdings.length === 0) {
            html += `<tr><td colspan="9" style="text-align: center; padding: 20px; color: var(--text-secondary);">No active stock holdings in this snapshot.</td></tr>`;
        } else {
            holdings.forEach((h, idx) => {
                const pnl = Number(h.pnl || 0);
                const pnlPct = Number(h.pnl_percent || 0);
                const pnlColor = pnl >= 0 ? '#10b981' : '#ef4444';

                html += `
                    <tr>
                        <td style="color: var(--text-secondary);">${idx + 1}</td>
                        <td>
                            <strong style="color: var(--text-primary); cursor: pointer;" onclick="if(typeof openInHouseChart==='function') openInHouseChart('${escapeHtml(h.symbol)}');">
                                ${escapeHtml(h.symbol)}
                            </strong>
                        </td>
                        <td style="text-align: right; font-family: monospace; font-weight: 600;">${h.quantity}</td>
                        <td style="text-align: right; font-family: monospace;">₹${formatCurrency(h.buy_price)}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 600;">₹${formatCurrency(h.current_price)}</td>
                        <td style="text-align: right; font-family: monospace;">₹${formatCurrency(h.invested)}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 700; color: var(--text-primary);">₹${formatCurrency(h.current_value)}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 600; color: ${pnlColor};">
                            ${pnl >= 0 ? '+' : ''}₹${formatCurrency(pnl)}
                        </td>
                        <td style="text-align: right; font-family: monospace; font-weight: 600; color: ${pnlColor};">
                            ${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%
                        </td>
                    </tr>
                `;
            });
        }

        html += `
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Capital & Wallet Audit Logs -->
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 18px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <h4 style="margin: 0; font-size: 14.5px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                        <span>📜</span> <span>Capital &amp; Wallet Activity Logs</span>
                    </h4>
                </div>
                <div style="overflow-x: auto; max-height: 240px;">
                    <table class="msc-indices-table" style="font-size: 12px;">
                        <thead>
                            <tr style="position: sticky; top: 0; z-index: 2; background: var(--bg-subtle);">
                                <th style="min-width: 130px;">DATE / TIME</th>
                                <th style="min-width: 140px;">EVENT TYPE</th>
                                <th style="text-align: right; min-width: 100px;">AMOUNT / STEP-UP</th>
                                <th style="text-align: right; min-width: 90px;">FEES (0.10%)</th>
                                <th style="text-align: right; min-width: 100px;">WALLET AFTER</th>
                                <th style="min-width: 250px;">NOTES</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        if (!capitalLogs || capitalLogs.length === 0) {
            html += `<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-secondary);">No capital logs recorded.</td></tr>`;
        } else {
            capitalLogs.slice().reverse().forEach(log => {
                html += `
                    <tr>
                        <td style="font-size: 11.5px; color: var(--text-secondary);">${formatDateTimeDisplay(log.timestamp)}</td>
                        <td>
                            <span class="badge" style="background: var(--bg-subtle); border: 1px solid var(--border-color); color: var(--text-primary); font-size: 10.5px; padding: 2px 6px;">
                                ${escapeHtml(log.type || 'LOG')}
                            </span>
                        </td>
                        <td style="text-align: right; font-family: monospace;">₹${formatCurrency(log.amount || 0)}</td>
                        <td style="text-align: right; font-family: monospace; color: var(--text-secondary);">₹${formatCurrency(log.fees || 0)}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 600; color: #10b981;">₹${formatCurrency(log.wallet_after || 0)}</td>
                        <td style="font-size: 12px; color: var(--text-secondary);">${escapeHtml(log.notes || '—')}</td>
                    </tr>
                `;
            });
        }

        html += `
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        container.innerHTML = html;
    }

    function colorForNum(val) {
        if (val == null) return 'color: var(--text-secondary);';
        const num = Number(val);
        if (num > 0) return 'color: #10b981; font-weight: 600;';
        if (num < 0) return 'color: #ef4444; font-weight: 600;';
        return 'color: var(--text-secondary);';
    }

    // =========================================================================
    // 4. EXECUTION ACTIONS: RUN INIT & RUN REBALANCE
    // =========================================================================
    async function runStrategyInit(strategyId) {
        if (!confirm('Run initial momentum calculation and allocate equal capital across top stocks?')) {
            return;
        }

        alertToast('Executing Init... Fetching quotes & computing momentum metrics', 'info');

        try {
            const res = await fetch(`/api/momentum-smallcases/strategies/${encodeURIComponent(strategyId)}/run-init`, {
                method: 'POST'
            });

            const data = await res.json();
            if (!data.success) {
                alertToast(data.error || 'Failed to execute Init', 'error');
                return;
            }

            alertToast('Init execution completed successfully!', 'success');
            await openStrategyDetailView(strategyId);
            await loadStrategiesList();
        } catch (err) {
            console.error('Error running Init:', err);
            alertToast('Init execution failed: ' + err.message, 'error');
        }
    }

    function openRunRebalanceModal() {
        if (!currentStrategy) return;
        document.getElementById('rebal-modal-strat-name').innerText = currentStrategy.name;
        document.getElementById('rebal-modal-date').innerText = formatDateDisplay(currentStrategy.next_rebalance_date);
        document.getElementById('rebalStepupInput').value = '0';

        const modal = document.getElementById('runRebalanceModal');
        if (modal) modal.style.display = 'flex';
        setTimeout(() => {
            const input = document.getElementById('rebalStepupInput');
            if (input) input.focus();
        }, 100);
    }

    function closeRunRebalanceModal() {
        const modal = document.getElementById('runRebalanceModal');
        if (modal) modal.style.display = 'none';
    }

    async function confirmRunRebalance() {
        if (!currentStrategy || isSubmitting) return;

        const stepupVal = parseFloat(document.getElementById('rebalStepupInput')?.value || 0) || 0;
        if (stepupVal < 0) {
            alertToast('Step-up amount cannot be negative', 'warning');
            return;
        }

        const btn = document.getElementById('rebalConfirmSubmitBtn');
        const origText = btn ? btn.innerText : 'Confirm';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span>⏳</span> Rebalancing...';
        }
        isSubmitting = true;

        try {
            const res = await fetch(`/api/momentum-smallcases/strategies/${encodeURIComponent(currentStrategy.id)}/run-rebalance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    stepup_amount: stepupVal
                })
            });

            const data = await res.json();
            if (!data.success) {
                alertToast(data.error || 'Failed to execute rebalance', 'error');
                return;
            }

            closeRunRebalanceModal();
            alertToast('Rebalance executed successfully!', 'success');
            await openStrategyDetailView(currentStrategy.id);
            await loadStrategiesList();
        } catch (err) {
            console.error('Error running rebalance:', err);
            alertToast('Rebalance failed: ' + err.message, 'error');
        } finally {
            isSubmitting = false;
            if (btn) {
                btn.disabled = false;
                btn.innerText = origText;
            }
        }
    }

    // =========================================================================
    // 5. FORMULA EDIT MODAL
    // =========================================================================
    function openEditFormulaModal() {
        if (!currentStrategy) return;
        document.getElementById('formulaEditInput').value = currentStrategy.formula || '';
        const modal = document.getElementById('editFormulaModal');
        if (modal) modal.style.display = 'flex';
        setTimeout(() => {
            const ta = document.getElementById('formulaEditInput');
            if (ta) ta.focus();
        }, 100);
    }

    function closeEditFormulaModal() {
        const modal = document.getElementById('editFormulaModal');
        if (modal) modal.style.display = 'none';
    }

    async function saveEditedFormula() {
        if (!currentStrategy || isSubmitting) return;

        const formula = (document.getElementById('formulaEditInput')?.value || '').trim();
        if (!formula) {
            alertToast('Formula cannot be empty', 'warning');
            return;
        }

        const btn = document.getElementById('formulaSaveSubmitBtn');
        const origText = btn ? btn.innerText : 'Save';
        if (btn) {
            btn.disabled = true;
            btn.innerText = 'Saving...';
        }
        isSubmitting = true;

        try {
            const res = await fetch(`/api/momentum-smallcases/strategies/${encodeURIComponent(currentStrategy.id)}/formula`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ formula: formula })
            });

            const data = await res.json();
            if (!data.success) {
                alertToast(data.error || 'Failed to update formula', 'error');
                return;
            }

            currentStrategy.formula = formula;
            document.getElementById('sd-formula-text').innerText = formula;
            closeEditFormulaModal();
            alertToast('Formula updated successfully', 'success');
        } catch (err) {
            console.error('Error saving formula:', err);
            alertToast('Error saving formula: ' + err.message, 'error');
        } finally {
            isSubmitting = false;
            if (btn) {
                btn.disabled = false;
                btn.innerText = origText;
            }
        }
    }

    // =========================================================================
    // 6. DELETE STRATEGY / INDEX HANDLER
    // =========================================================================
    function openDeleteStrategyModal(strategyId, name) {
        document.getElementById('mIndexDeleteId').value = strategyId;
        document.getElementById('mIndexDeleteType').value = 'strategy';
        document.getElementById('mscDeleteModalHeader').innerText = 'Delete Smallcase';
        document.getElementById('mIndexDeleteName').innerText = name || 'this smallcase';
        const modal = document.getElementById('momentumIndexDeleteModal');
        if (modal) modal.style.display = 'flex';
    }

    function promptDeleteCurrentStrategy() {
        if (!currentStrategy) return;
        openDeleteStrategyModal(currentStrategy.id, currentStrategy.name);
    }

    function openDeleteManualIndexModal(indexId, name) {
        document.getElementById('mIndexDeleteId').value = indexId;
        document.getElementById('mIndexDeleteType').value = 'index';
        document.getElementById('mscDeleteModalHeader').innerText = 'Delete Manual Index';
        document.getElementById('mIndexDeleteName').innerText = name || 'this index';
        const modal = document.getElementById('momentumIndexDeleteModal');
        if (modal) modal.style.display = 'flex';
    }

    function closeMomentumDeleteModal() {
        const modal = document.getElementById('momentumIndexDeleteModal');
        if (modal) modal.style.display = 'none';
    }

    async function confirmDeleteTarget() {
        const id = document.getElementById('mIndexDeleteId')?.value;
        const targetType = document.getElementById('mIndexDeleteType')?.value || 'index';
        if (!id) return;

        const btn = document.getElementById('mIndexConfirmDeleteBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerText = 'Deleting...';
        }

        try {
            const url = targetType === 'strategy'
                ? `/api/momentum-smallcases/strategies/${encodeURIComponent(id)}`
                : `/api/momentum-smallcases/indices/${encodeURIComponent(id)}`;

            const res = await fetch(url, { method: 'DELETE' });
            const data = await res.json();
            if (!data.success) {
                alertToast(data.error || 'Failed to delete record', 'error');
                return;
            }

            closeMomentumDeleteModal();
            alertToast(targetType === 'strategy' ? 'Smallcase deleted successfully' : 'Manual Index deleted successfully', 'info');

            if (targetType === 'strategy') {
                if (activeSubView === 'strategy-detail') {
                    switchMomentumSubView('strategies');
                } else {
                    await loadStrategiesList();
                }
            } else {
                await loadMomentumManualIndices();
            }
        } catch (err) {
            console.error('Error deleting target:', err);
            alertToast('Delete error: ' + err.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerText = 'Delete';
            }
        }
    }

    // =========================================================================
    // 7. MANUAL CUSTOM INDICES (CRUD & PREVIEW)
    // =========================================================================
    async function loadMomentumManualIndices() {
        const mount = document.getElementById('momentum-indices-mount');
        if (!mount) return;

        mount.innerHTML = `
            <div style="text-align: center; padding: 45px 20px; color: var(--text-secondary);">
                <span class="spinning" style="display: inline-block; font-size: 24px; margin-bottom: 8px;">⏳</span><br>
                Loading Manual Indices...
            </div>
        `;

        try {
            const res = await fetch('/api/momentum-smallcases/indices');
            const data = await res.json();
            if (!data.success) {
                mount.innerHTML = `<div style="text-align: center; padding: 30px; color: #ef4444;">Failed to load indices: ${escapeHtml(data.error || 'Server error')}</div>`;
                return;
            }

            momentumIndicesCache = data.indices || [];
            momentumSummaryCache = data.summary || {};

            renderManualIndicesSummaryStats();
            renderMomentumIndicesTable(momentumIndicesCache);
        } catch (err) {
            console.error('Error loading momentum indices:', err);
            mount.innerHTML = `<div style="text-align: center; padding: 30px; color: #ef4444;">Failed to load indices: ${escapeHtml(err.message)}</div>`;
        }
    }

    function renderManualIndicesSummaryStats() {
        const s = momentumSummaryCache;
        const totalIdxEl = document.getElementById('msc-stat-total-indices');
        const totalStocksEl = document.getElementById('msc-stat-total-stocks');
        const avgStocksEl = document.getElementById('msc-stat-avg-stocks');
        const lastActEl = document.getElementById('msc-stat-last-activity');

        if (totalIdxEl) totalIdxEl.innerText = s.total_indices || 0;
        if (totalStocksEl) totalStocksEl.innerText = s.total_stocks || 0;
        if (avgStocksEl) avgStocksEl.innerText = s.avg_stocks || 0;
        if (lastActEl) {
            lastActEl.innerText = s.last_updated ? formatDateDisplay(s.last_updated) : 'None';
        }
    }

    function renderMomentumIndicesTable(indices) {
        const mount = document.getElementById('momentum-indices-mount');
        if (!mount) return;

        const countBadge = document.getElementById('msc-indices-count-badge');
        if (countBadge) {
            countBadge.innerText = `${indices.length} ${indices.length === 1 ? 'Index' : 'Indices'}`;
        }

        if (!indices || indices.length === 0) {
            mount.innerHTML = `
                <div style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
                    <div style="font-size: 42px; margin-bottom: 12px;">📊</div>
                    <h3 style="margin: 0 0 6px 0; font-size: 17px; color: var(--text-primary);">No Manual Momentum Indices Yet</h3>
                    <p style="margin: 0 0 18px 0; font-size: 13px; max-width: 440px; margin-inline: auto; line-height: 1.5;">
                        Create your first manual momentum index with constituent stocks and dates in the format:
                        <code>[StockSymbol, DD/MM/YYYY]</code>.
                    </p>
                    <button type="button" class="btn-primary" onclick="openAddManualIndexModal()" style="font-size: 13px; padding: 8px 18px; display: inline-flex; align-items: center; gap: 6px;">
                        <span>➕</span> <span>Add Manual Index</span>
                    </button>
                </div>
            `;
            return;
        }

        let html = `
            <div style="overflow-x: auto;">
                <table class="msc-indices-table">
                    <thead>
                        <tr>
                            <th style="min-width: 200px;">INDEX NAME</th>
                            <th style="min-width: 220px;">DESCRIPTION</th>
                            <th style="min-width: 220px;">CONSTITUENT STOCKS</th>
                            <th style="min-width: 130px;">LAST UPDATED</th>
                            <th style="min-width: 170px; text-align: right;">ACTIONS</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        indices.forEach(idx => {
            const stocks = idx.stocks || [];
            const count = idx.stock_count || stocks.length;

            let previewsHtml = '';
            const previewCount = Math.min(stocks.length, 3);
            for (let i = 0; i < previewCount; i++) {
                const s = stocks[i];
                previewsHtml += `<span class="msc-stock-preview-badge">${escapeHtml(s.symbol)}</span>`;
            }
            if (stocks.length > 3) {
                previewsHtml += `<span class="msc-stock-preview-badge" style="color: var(--text-secondary); background: transparent; border-style: dashed;">+${stocks.length - 3} more</span>`;
            }

            html += `
                <tr>
                    <td>
                        <div class="msc-index-name">
                            <span>📈</span>
                            <span>${escapeHtml(idx.name)}</span>
                        </div>
                    </td>
                    <td>
                        <div class="msc-index-desc" title="${escapeHtml(idx.description || '')}">
                            ${escapeHtml(idx.description || 'No description provided')}
                        </div>
                    </td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <span class="msc-stock-count-pill">
                                <span>📦</span> ${count} ${count === 1 ? 'stock' : 'stocks'}
                            </span>
                            <div style="display: inline-flex; align-items: center; flex-wrap: wrap;">
                                ${previewsHtml}
                            </div>
                        </div>
                    </td>
                    <td>
                        <span style="font-size: 12.5px; color: var(--text-secondary);">
                            ${formatDateDisplay(idx.updated_at || idx.created_at)}
                        </span>
                    </td>
                    <td style="text-align: right;">
                        <div style="display: inline-flex; gap: 6px; justify-content: flex-end;">
                            <button type="button" class="msc-action-btn view" onclick="openViewManualIndexModal('${escapeHtml(idx.id)}')" title="View Index Details">
                                <span>👁️ View</span>
                            </button>
                            <button type="button" class="msc-action-btn edit" onclick="openEditManualIndexModal('${escapeHtml(idx.id)}')" title="Edit Index">
                                <span>✏️ Edit</span>
                            </button>
                            <button type="button" class="msc-action-btn delete" onclick="openDeleteManualIndexModal('${escapeHtml(idx.id)}', '${escapeHtml(idx.name)}')" title="Delete Index">
                                <span>🗑️</span>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        mount.innerHTML = html;
    }

    function filterMomentumIndices(query) {
        query = (query || '').trim().toLowerCase();
        if (!query) {
            renderMomentumIndicesTable(momentumIndicesCache);
            return;
        }

        const filtered = momentumIndicesCache.filter(idx => {
            const nameMatch = (idx.name || '').toLowerCase().includes(query);
            const descMatch = (idx.description || '').toLowerCase().includes(query);
            const stockMatch = (idx.stocks || []).some(s => (s.symbol || '').toLowerCase().includes(query));
            return nameMatch || descMatch || stockMatch;
        });

        renderMomentumIndicesTable(filtered);
    }

    // Manual Index Form: Add / Edit
    function openAddManualIndexModal() {
        document.getElementById('mIndexEditId').value = '';
        document.getElementById('mIndexNameInput').value = '';
        document.getElementById('mIndexDescInput').value = '';
        document.getElementById('mIndexStocksInput').value = '';

        document.getElementById('mIndexModalIcon').innerText = '➕';
        document.getElementById('mIndexModalTitle').innerText = 'Add Manual Index';
        document.getElementById('mIndexSaveBtn').innerText = 'Create Index';

        updateLiveStocksChipsPreview('');

        const modal = document.getElementById('momentumIndexFormModal');
        if (modal) modal.style.display = 'flex';
        setTimeout(() => {
            const input = document.getElementById('mIndexNameInput');
            if (input) input.focus();
        }, 100);
    }

    async function openEditManualIndexModal(indexId) {
        let idx = momentumIndicesCache.find(x => x.id === indexId);
        if (!idx) {
            try {
                const res = await fetch(`/api/momentum-smallcases/indices/${encodeURIComponent(indexId)}?enrich=0`);
                const data = await res.json();
                if (data.success && data.index) {
                    idx = data.index;
                }
            } catch (e) {
                console.error('Error fetching index for edit:', e);
            }
        }

        if (!idx) {
            alertToast('Could not load index for editing', 'error');
            return;
        }

        document.getElementById('mIndexEditId').value = idx.id;
        document.getElementById('mIndexNameInput').value = idx.name || '';
        document.getElementById('mIndexDescInput').value = idx.description || '';

        let stocksText = idx.raw_stocks || '';
        if (!stocksText && idx.stocks && idx.stocks.length > 0) {
            stocksText = idx.stocks.map(s => `[${s.symbol}, ${s.date_added}]`).join(', ');
        }
        document.getElementById('mIndexStocksInput').value = stocksText;

        document.getElementById('mIndexModalIcon').innerText = '✏️';
        document.getElementById('mIndexModalTitle').innerText = 'Edit Manual Index';
        document.getElementById('mIndexSaveBtn').innerText = 'Save Changes';

        updateLiveStocksChipsPreview(stocksText);

        const modal = document.getElementById('momentumIndexFormModal');
        if (modal) modal.style.display = 'flex';
        setTimeout(() => {
            const input = document.getElementById('mIndexNameInput');
            if (input) input.focus();
        }, 100);
    }

    function closeMomentumFormModal() {
        const modal = document.getElementById('momentumIndexFormModal');
        if (modal) modal.style.display = 'none';
    }

    function updateLiveStocksChipsPreview(text) {
        const container = document.getElementById('mIndexLiveChipsContainer');
        const list = document.getElementById('mIndexLiveChipsList');
        const countEl = document.getElementById('mIndexLiveChipsCount');
        if (!container || !list) return;

        const parsed = parseStocksClient(text);
        if (parsed.length === 0) {
            container.style.display = 'none';
            list.innerHTML = '';
            if (countEl) countEl.innerText = '0';
            return;
        }

        container.style.display = 'block';
        if (countEl) countEl.innerText = parsed.length;

        let chipsHtml = '';
        parsed.forEach(s => {
            chipsHtml += `
                <div class="msc-chip">
                    <span class="msc-chip-sym">${escapeHtml(s.symbol)}</span>
                    <span class="msc-chip-date">${escapeHtml(s.date_added)}</span>
                </div>
            `;
        });
        list.innerHTML = chipsHtml;
    }

    function insertSampleStocksFormat() {
        const sample = `[RELIANCE, 01/01/2026], [TCS, 15/01/2026], [TITAN, 01/02/2026], [BAJFINANCE, 15/02/2026], [BHARTIARTL, 20/02/2026]`;
        const textarea = document.getElementById('mIndexStocksInput');
        if (textarea) {
            textarea.value = sample;
            updateLiveStocksChipsPreview(sample);
            textarea.focus();
        }
    }

    function clearStocksInput() {
        const textarea = document.getElementById('mIndexStocksInput');
        if (textarea) {
            textarea.value = '';
            updateLiveStocksChipsPreview('');
            textarea.focus();
        }
    }

    async function saveManualIndex() {
        if (isSubmitting) return;

        const name = (document.getElementById('mIndexNameInput')?.value || '').trim();
        const description = (document.getElementById('mIndexDescInput')?.value || '').trim();
        const stocks = (document.getElementById('mIndexStocksInput')?.value || '').trim();
        const editId = (document.getElementById('mIndexEditId')?.value || '').trim();

        if (!name) {
            alertToast('Please enter an index name', 'warning');
            document.getElementById('mIndexNameInput')?.focus();
            return;
        }

        const saveBtn = document.getElementById('mIndexSaveBtn');
        const originalText = saveBtn ? saveBtn.innerText : 'Save';
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span>⏳</span> Saving...';
        }
        isSubmitting = true;

        const url = editId ? `/api/momentum-smallcases/indices/${encodeURIComponent(editId)}` : '/api/momentum-smallcases/indices';
        const method = editId ? 'PUT' : 'POST';

        try {
            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    description: description,
                    stocks: stocks
                })
            });

            const data = await res.json();
            if (!data.success) {
                alertToast(data.error || 'Failed to save index', 'error');
                return;
            }

            closeMomentumFormModal();
            alertToast(editId ? `Updated index "${name}"` : `Created index "${name}"`, 'success');
            await loadMomentumManualIndices();
        } catch (err) {
            console.error('Error saving manual index:', err);
            alertToast('Error saving index: ' + err.message, 'error');
        } finally {
            isSubmitting = false;
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerText = originalText;
            }
        }
    }

    // View Manual Index Modal
    async function openViewManualIndexModal(indexId) {
        currentViewingIndex = null;
        const modal = document.getElementById('momentumIndexViewModal');
        if (modal) modal.style.display = 'flex';

        const nameEl = document.getElementById('mIndexViewName');
        const subEl = document.getElementById('mIndexViewSubtitle');
        const descEl = document.getElementById('mIndexViewDescBox');
        const countEl = document.getElementById('mIndexViewCount');
        const createdEl = document.getElementById('mIndexViewCreated');
        const updatedEl = document.getElementById('mIndexViewUpdated');
        const tbody = document.getElementById('mIndexViewStocksTbody');
        const rawEl = document.getElementById('mIndexViewRawStocks');
        const counter = document.getElementById('mIndexViewStocksCounter');

        if (nameEl) nameEl.innerText = 'Loading Index...';
        if (subEl) subEl.innerText = 'Fetching constituent data...';
        if (descEl) descEl.innerText = '—';
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 30px; color: var(--text-secondary);">⏳ Loading stocks & live quotes...</td></tr>`;

        try {
            const res = await fetch(`/api/momentum-smallcases/indices/${encodeURIComponent(indexId)}?enrich=1`);
            const data = await res.json();
            if (!data.success || !data.index) {
                if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 20px;">Could not load index details.</td></tr>`;
                return;
            }

            const idx = data.index;
            currentViewingIndex = idx;

            if (nameEl) nameEl.innerText = idx.name || 'Unnamed Index';
            if (subEl) subEl.innerText = `ID: ${idx.id}`;
            if (descEl) {
                descEl.innerText = idx.description || 'No description provided for this index.';
            }
            if (countEl) countEl.innerText = (idx.stocks || []).length;
            if (createdEl) createdEl.innerText = formatDateDisplay(idx.created_at);
            if (updatedEl) updatedEl.innerText = formatDateDisplay(idx.updated_at || idx.created_at);

            let rawStr = idx.raw_stocks || '';
            if (!rawStr && idx.stocks && idx.stocks.length > 0) {
                rawStr = idx.stocks.map(s => `[${s.symbol}, ${s.date_added}]`).join(', ');
            }
            if (rawEl) rawEl.innerText = rawStr || 'No constituent stocks registered.';

            const stocks = idx.stocks || [];
            if (counter) counter.innerText = `${stocks.length} ${stocks.length === 1 ? 'constituent' : 'constituents'}`;

            if (stocks.length === 0) {
                if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-secondary); padding: 30px;">No stocks in this index. Click "Edit Index" to add stocks.</td></tr>`;
            } else {
                let rowsHtml = '';
                stocks.forEach((s, i) => {
                    const priceDisplay = (s.current_price != null && s.current_price > 0) ? `₹${Number(s.current_price).toFixed(2)}` : '—';
                    let chgDisplay = '—';
                    let chgClass = 'color: var(--text-secondary);';
                    if (s.change_percent != null) {
                        const val = Number(s.change_percent);
                        if (val > 0) {
                            chgDisplay = `+${val.toFixed(2)}%`;
                            chgClass = 'color: #10b981; font-weight: 600;';
                        } else if (val < 0) {
                            chgDisplay = `${val.toFixed(2)}%`;
                            chgClass = 'color: #ef4444; font-weight: 600;';
                        } else {
                            chgDisplay = `0.00%`;
                        }
                    }

                    rowsHtml += `
                        <tr>
                            <td style="color: var(--text-secondary);">${i + 1}</td>
                            <td>
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <strong style="color: var(--text-primary); cursor: pointer;" onclick="if(typeof openInHouseChart==='function') openInHouseChart('${escapeHtml(s.symbol)}');" title="Open chart for ${escapeHtml(s.symbol)}">
                                        ${escapeHtml(s.symbol)}
                                    </strong>
                                    ${s.company_name && s.company_name !== s.symbol ? `<span style="font-size: 11px; color: var(--text-secondary);">(${escapeHtml(s.company_name)})</span>` : ''}
                                </div>
                            </td>
                            <td>
                                <span class="badge" style="background: var(--bg-subtle); border: 1px solid var(--border-color); color: var(--text-primary); font-size: 11px;">
                                    📅 ${escapeHtml(s.date_added)}
                                </span>
                            </td>
                            <td>
                                <span style="font-size: 12px; color: var(--text-secondary);">
                                    ${s.days_active || 0} ${s.days_active === 1 ? 'day' : 'days'}
                                </span>
                            </td>
                            <td style="text-align: right; font-weight: 600; font-family: monospace;">${priceDisplay}</td>
                            <td style="text-align: right; font-family: monospace; ${chgClass}">${chgDisplay}</td>
                        </tr>
                    `;
                });
                if (tbody) tbody.innerHTML = rowsHtml;
            }
        } catch (err) {
            console.error('Error fetching view details:', err);
            if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 20px;">Failed to load details: ${escapeHtml(err.message)}</td></tr>`;
        }
    }

    function closeMomentumViewModal() {
        const modal = document.getElementById('momentumIndexViewModal');
        if (modal) modal.style.display = 'none';
        currentViewingIndex = null;
    }

    function editFromViewModal() {
        if (!currentViewingIndex || !currentViewingIndex.id) return;
        const id = currentViewingIndex.id;
        closeMomentumViewModal();
        openEditManualIndexModal(id);
    }

    function copyViewRawStocks() {
        const rawEl = document.getElementById('mIndexViewRawStocks');
        if (!rawEl) return;
        const text = rawEl.innerText || '';
        if (!text) {
            alertToast('No stocks string to copy', 'info');
            return;
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                alertToast('Stocks string copied to clipboard!', 'success');
            }).catch(() => {
                fallbackCopy(text);
            });
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            alertToast('Stocks string copied to clipboard!', 'success');
        } catch (_) {
            alertToast('Could not copy string', 'error');
        }
        document.body.removeChild(ta);
    }

    // Unified Toast / Alert
    function alertToast(msg, type = 'info') {
        if (typeof window.showToast === 'function') {
            window.showToast(msg, type);
        } else {
            alert(msg);
        }
    }

    // =========================================================================
    // EXPOSE TO GLOBAL SCOPE
    // =========================================================================
    window.loadMomentumSmallcasesTab = loadMomentumSmallcasesTab;
    window.switchMomentumSubView = switchMomentumSubView;

    // Strategies
    window.loadStrategiesList = loadStrategiesList;
    window.filterStrategiesList = filterStrategiesList;
    window.openAddStrategyModal = openAddStrategyModal;
    window.closeAddStrategyModal = closeAddStrategyModal;
    window.submitCreateStrategy = submitCreateStrategy;
    window.openStrategyDetailView = openStrategyDetailView;
    window.selectTimelineRun = selectTimelineRun;
    window.runStrategyInit = runStrategyInit;
    window.openRunRebalanceModal = openRunRebalanceModal;
    window.closeRunRebalanceModal = closeRunRebalanceModal;
    window.confirmRunRebalance = confirmRunRebalance;
    window.openEditFormulaModal = openEditFormulaModal;
    window.closeEditFormulaModal = closeEditFormulaModal;
    window.saveEditedFormula = saveEditedFormula;
    window.openDeleteStrategyModal = openDeleteStrategyModal;
    window.promptDeleteCurrentStrategy = promptDeleteCurrentStrategy;
    window.checkStratDateAndIndexMatch = checkStratDateAndIndexMatch;

    // Manual Indices
    window.openAddManualIndexModal = openAddManualIndexModal;
    window.openEditManualIndexModal = openEditManualIndexModal;
    window.closeMomentumFormModal = closeMomentumFormModal;
    window.saveManualIndex = saveManualIndex;
    window.openViewManualIndexModal = openViewManualIndexModal;
    window.closeMomentumViewModal = closeMomentumViewModal;
    window.editFromViewModal = editFromViewModal;
    window.copyViewRawStocks = copyViewRawStocks;
    window.openDeleteManualIndexModal = openDeleteManualIndexModal;
    window.closeMomentumDeleteModal = closeMomentumDeleteModal;
    window.confirmDeleteTarget = confirmDeleteTarget;
    window.confirmDeleteManualIndex = confirmDeleteTarget; // alias
    window.filterMomentumIndices = filterMomentumIndices;
    window.updateLiveStocksChipsPreview = updateLiveStocksChipsPreview;
    window.insertSampleStocksFormat = insertSampleStocksFormat;
    window.clearStocksInput = clearStocksInput;
})();
