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
    // MODAL TELEPORTATION HELPER
    // Ensures all modals and global loaders are direct children of document.body
    // so they are never clipped or trapped by .tab-content CSS transforms.
    // =========================================================================
    const MSC_MODAL_ELEMENT_IDS = [
        'mscGlobalProcessLoader',
        'runRebalanceModal',
        'runAllRebalanceModal',
        'addStrategyModal',
        'editFormulaModal',
        'consolidatedStocksModal',
        'momentumIndexFormModal',
        'momentumIndexViewModal',
        'momentumIndexDeleteModal',
        'walletLogTransactionsModal',
        'performanceGraphModal'
    ];

    function ensureModalsAttachedToBody() {
        if (typeof document === 'undefined' || !document.body) return;
        MSC_MODAL_ELEMENT_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el && el.parentElement !== document.body) {
                document.body.appendChild(el);
            }
        });
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', ensureModalsAttachedToBody);
        } else {
            ensureModalsAttachedToBody();
        }
    }

    // =========================================================================
    // BRAND LOGO LOADER HELPERS
    // =========================================================================
    function showSmallcaseGlobalLoader({ title = 'Processing...', badge = 'Momentum Engine', subtitle = '' } = {}) {
        ensureModalsAttachedToBody();
        const overlay = document.getElementById('mscGlobalProcessLoader');
        if (!overlay) return;
        const titleEl = document.getElementById('mscGlobalLoaderTitle');
        const badgeEl = document.getElementById('mscGlobalLoaderBadge');
        const subEl = document.getElementById('mscGlobalLoaderSubtitle');
        if (titleEl && title) titleEl.textContent = title;
        if (badgeEl) {
            badgeEl.textContent = badge;
            badgeEl.style.display = badge ? 'inline-block' : 'none';
        }
        if (subEl) {
            subEl.textContent = subtitle;
            subEl.style.display = subtitle ? 'block' : 'none';
        }
        overlay.style.display = 'flex';
    }

    function hideSmallcaseGlobalLoader() {
        const overlay = document.getElementById('mscGlobalProcessLoader');
        if (overlay) overlay.style.display = 'none';
    }

    function setSmallcaseModalLoader(modalId, isLoading, options = {}) {
        if (typeof window.setModalBrandLoader === 'function') {
            return window.setModalBrandLoader(modalId, isLoading, options);
        }
        return false;
    }

    // Crisp SVG vector icons to avoid platform emoji rendering quirks (e.g. blue square emoji on Windows)
    function getRebalanceIconSVG(size = 15, strokeWidth = 2.4, extraStyle = '') {
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; ${extraStyle}"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>`;
    }

    function getCheckIconSVG(size = 15, strokeWidth = 2.8, extraStyle = '') {
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; ${extraStyle}"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    }

    function getClockIconSVG(size = 14, strokeWidth = 2, extraStyle = '') {
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; ${extraStyle}"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
    }

    function getPlayIconSVG(size = 13, extraStyle = '') {
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" style="display: inline-block; vertical-align: middle; ${extraStyle}"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
    }

    // Robust JSON fetch wrapper that intercepts 502/504 gateway timeouts and non-JSON error pages
    async function safeFetchJson(url, options = {}) {
        let res;
        try {
            res = await fetch(url, options);
        } catch (netErr) {
            throw new Error('Network error or server unreachable: ' + (netErr.message || 'connection failed'));
        }

        let data = null;
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json')) {
            try {
                data = await res.json();
            } catch (_) {
                data = null;
            }
        }

        if (data === null) {
            const rawText = await res.text().catch(() => '');
            const cleanText = rawText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
            if (res.status === 502) {
                throw new Error('502 Bad Gateway: Upstream connection timed out or server restarted. Please check if the Flask server is running.');
            }
            if (res.status === 504) {
                throw new Error('504 Gateway Timeout: The calculation took longer than the proxy timeout limit. Please retry now that data is partially cached.');
            }
            throw new Error(`Server returned HTTP ${res.status} (${res.statusText || 'Error'})${cleanText ? ': ' + cleanText : ''}`);
        }

        if (!res.ok) {
            const msg = (data && data.error) ? data.error : `HTTP ${res.status}: ${res.statusText || 'Request failed'}`;
            const err = new Error(msg);
            err.data = data;
            err.status = res.status;
            throw err;
        }

        return data;
    }

    // Polls background execution job until completion (immune to reverse proxy / Gunicorn 502/504 timeouts)
    async function pollJobUntilComplete(jobId, statusTitle = 'Executing...', strategyId = null) {
        const startTime = Date.now();
        const maxPollMs = 300000; // 5 minute max safety threshold
        const pollInterval = 1200; // 1.2s poll interval
        let consecutiveNotFound = 0;

        while (Date.now() - startTime < maxPollMs) {
            await new Promise(r => setTimeout(r, pollInterval));
            let res = null;
            try {
                const queryStr = strategyId ? `?strategy_id=${encodeURIComponent(strategyId)}` : '';
                res = await safeFetchJson(`/api/momentum-smallcases/jobs/${encodeURIComponent(jobId)}${queryStr}`);
            } catch (pollErr) {
                const errMsg = String(pollErr.message || '');
                if (pollErr.status === 404 || errMsg.includes('Job not found')) {
                    consecutiveNotFound++;
                    if (consecutiveNotFound >= 3) {
                        // Job was not found 3 times in a row. Check if strategy state has already updated in DB
                        if (strategyId) {
                            try {
                                const checkStrat = await safeFetchJson(`/api/momentum-smallcases/strategies/${encodeURIComponent(strategyId)}`);
                                if (checkStrat && checkStrat.strategy && (checkStrat.strategy.runs || []).length > 0) {
                                    console.info('Job not in memory but strategy has updated runs. Resolving successfully.');
                                    return { success: true, strategy: checkStrat.strategy, message: 'Execution completed.' };
                                }
                            } catch (_) {}
                        }
                        throw new Error('The execution job was interrupted (server was restarted or worker recycled). Please retry the rebalance.');
                    }
                }
                console.warn('Transient polling error:', pollErr);
                continue;
            }

            consecutiveNotFound = 0;
            if (!res || !res.success || !res.job) {
                continue;
            }

            const job = res.job;
            if (job.status === 'COMPLETED') {
                return job.result;
            }
            if (job.status === 'FAILED') {
                throw new Error(job.error || 'Execution failed');
            }
        }
        throw new Error('Calculation timed out after 5 minutes. Please refresh the page to view current progress.');
    }

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

    function formatSignedCurrency(val, withPlus = true) {
        if (val == null || isNaN(val)) return '₹0.00';
        const num = Number(val);
        const absStr = formatCurrency(Math.abs(num));
        if (num > 0) return (withPlus ? '+₹' : '₹') + absStr;
        if (num < 0) return '-₹' + absStr;
        return '₹' + absStr;
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

    // Helper to parse DD/MM/YYYY into timestamp for chronological sorting
    function parseDateAddedForSort(dtStr) {
        if (!dtStr || typeof dtStr !== 'string') return 0;
        const parts = dtStr.trim().replace(/[\-\.]/g, '/').split('/');
        if (parts.length === 3) {
            const d = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10) - 1;
            let y = parseInt(parts[2], 10);
            if (y < 100) y += 2000;
            return new Date(y, m, d).getTime();
        }
        const t = new Date(dtStr).getTime();
        return isNaN(t) ? 0 : t;
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

        // Fallback for unbracketed lines or comma-separated pairs
        if (results.length === 0 && stocksStr.trim()) {
            const lines = stocksStr.split(/[\r\n,]+/).map(l => l.trim()).filter(Boolean);
            const now = new Date();
            const todayStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
            for (const line of lines) {
                const dateMatch = line.match(/([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})\s*$/);
                let sym = '';
                let dt = todayStr;
                if (dateMatch) {
                    dt = dateMatch[1].replace(/[\-\.]/g, '/');
                    sym = line.slice(0, dateMatch.index).trim().replace(/[\[\(\"\'\],]+$/g, '').trim();
                } else {
                    sym = line.replace(/^[\[\(\"\'\s]+|[\]\)\"\'\s,]+$/g, '').trim();
                }
                sym = sym.toUpperCase();
                if (sym && sym.length > 1) {
                    const key = sym + '_' + dt;
                    if (!seen.has(key)) {
                        seen.add(key);
                        results.push({ symbol: sym, date_added: dt });
                    }
                }
            }
        }

        // Chronologically sort by date_added ascending, then symbol ascending
        results.sort((a, b) => {
            const dtA = parseDateAddedForSort(a.date_added);
            const dtB = parseDateAddedForSort(b.date_added);
            if (dtA !== dtB) return dtA - dtB;
            return (a.symbol || '').localeCompare(b.symbol || '');
        });
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
        ensureModalsAttachedToBody();
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

        if (typeof window.createBrandLoaderHTML === 'function') {
            mount.innerHTML = window.createBrandLoaderHTML({
                title: 'Loading Momentum Smallcases...',
                badge: 'Smallcase Dashboard',
                subtitle: 'Loading smallcase portfolios, rankings, and rebalance schedules...'
            });
        } else {
            mount.innerHTML = `
                <div style="text-align: center; padding: 45px 20px; color: var(--text-secondary);">
                    <span class="spinning" style="display: inline-block; font-size: 24px; margin-bottom: 8px;">⏳</span><br>
                    Loading Momentum Smallcases...
                </div>
            `;
        }

        try {
            const data = await safeFetchJson('/api/momentum-smallcases/strategies');
            if (!data || !data.success) {
                mount.innerHTML = `<div style="text-align: center; padding: 30px; color: #ef4444;">Failed to load strategies: ${escapeHtml(data?.error || 'Server error')}</div>`;
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

            const invested = Number(s.total_capital != null ? s.total_capital : (s.amount_to_invest || 0));
            const currVal = Number(s.current_portfolio_value || invested);
            const pnl = s.total_pnl != null ? Number(s.total_pnl) : (currVal - invested);
            const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;

            let pnlHtml = '';
            if (!isDraft) {
                const color = pnl >= 0 ? '#10b981' : '#ef4444';
                pnlHtml = `<div style="font-size: 11px; color: ${color}; font-weight: 600;">${formatSignedCurrency(pnl, true)} (${formatPercent(pnlPct, true)})</div>`;
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
                        <div style="font-size: 10.5px; color: var(--text-secondary); margin-top: 3px;">
                            Trim: <strong style="color: ${s.trim_existing === false ? '#eab308' : 'var(--text-primary)'};">${s.trim_existing === false ? 'No' : 'Yes'}</strong> &bull; <strong>${s.trading_days_per_month || 30}d/mo</strong>
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
                        <div style="display: inline-flex; gap: 6px; justify-content: flex-end; align-items: center;">
                            <button type="button" class="msc-action-btn view" onclick="openStrategyDetailView('${escapeHtml(s.id)}')" title="View Details & Timeline">
                                <span>👁️ Details</span>
                            </button>
                            <button type="button" class="msc-action-btn delete" onclick="openDeleteStrategyModal('${escapeHtml(s.id)}')" title="Delete Smallcase">
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
        ensureModalsAttachedToBody();
        setSmallcaseModalLoader('addStrategyModal', false);
        const modal = document.getElementById('addStrategyModal');
        const select = document.getElementById('stratIndexSelect');
        const submitBtn = document.getElementById('stratCreateSubmitBtn');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Create Smallcase';
        }

        // Set default date to today and clamp max to today
        const todayStr = new Date().toISOString().slice(0, 10);
        const dateInput = document.getElementById('stratStartDateInput');
        if (dateInput) {
            dateInput.value = todayStr;
            dateInput.max = todayStr;
        }
        document.getElementById('stratNameInput').value = '';
        document.getElementById('stratNoOfStocksInput').value = '12';
        document.getElementById('stratExitRegimeInput').value = '22';
        document.getElementById('stratRebalDayInput').value = '21';
        document.getElementById('stratAmountInput').value = '';
        const trimSelect = document.getElementById('stratTrimExistingSelect');
        if (trimSelect) trimSelect.value = 'no';
        const tdSelect = document.getElementById('stratTradingDaysPerMonthSelect');
        if (tdSelect) tdSelect.value = '21';
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
        setSmallcaseModalLoader('addStrategyModal', false);
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
        const trimExisting = (document.getElementById('stratTrimExistingSelect')?.value || 'no') === 'yes';
        const tradingDaysPerMonth = parseInt(document.getElementById('stratTradingDaysPerMonthSelect')?.value || '21', 10);
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
        const todayStr = new Date().toISOString().substring(0, 10);
        if (startDate > todayStr) {
            alertToast(`Cannot set start date in the future (${formatDateDisplay(startDate)}). Today is ${formatDateDisplay(todayStr)}.`, 'error');
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
            alertToast('Please enter an amount to invest (e.g. 100000)', 'warning');
            return;
        }

        const submitBtn = document.getElementById('stratCreateSubmitBtn');
        const origText = submitBtn ? submitBtn.innerText : 'Create';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span>⏳</span> Creating...';
        }
        isSubmitting = true;

        setSmallcaseModalLoader('addStrategyModal', true, {
            title: 'Creating Momentum Smallcase...',
            badge: 'Smallcase Engine',
            subtitle: 'Configuring universe, exit regime & scheduling rebalance dates...'
        });

        try {
            const data = await safeFetchJson('/api/momentum-smallcases/strategies', {
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
                    trim_existing: trimExisting,
                    trading_days_per_month: tradingDaysPerMonth,
                    formula: formula
                })
            });

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
            setSmallcaseModalLoader('addStrategyModal', false);
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = origText;
            }
        }
    }

    // =========================================================================
    // 3. STRATEGY DETAILS & EXECUTION TIMELINE VIEW
    // =========================================================================
    async function openStrategyDetailView(strategyId, optRunIndex = null) {
        switchMomentumSubView('strategy-detail');

        const container = document.getElementById('sd-selected-run-container');
        if (container) {
            container.innerHTML = (typeof window.createBrandLoaderHTML === 'function')
                ? window.createBrandLoaderHTML({
                    title: 'Loading Smallcase Details...',
                    badge: 'Strategy Analytics',
                    subtitle: 'Loading formula, execution timeline, and constituent holdings...'
                })
                : `
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
            const trimEl = document.getElementById('sd-trim-existing');
            if (trimEl) {
                trimEl.innerText = (s.trim_existing === false) ? 'No' : 'Yes';
                trimEl.style.color = (s.trim_existing === false) ? '#eab308' : 'var(--text-primary)';
            }
            const tdEl = document.getElementById('sd-trading-days');
            if (tdEl) {
                tdEl.innerText = `${s.trading_days_per_month || 30}d`;
            }
            const maxAllocEl = document.getElementById('sd-max-alloc');
            if (maxAllocEl) {
                maxAllocEl.innerText = 'Equal Weight';
            }

            // Render Financial Metrics
            const capVal = Number(s.total_capital != null ? s.total_capital : (s.amount_to_invest || 0));
            const portVal = Number(s.current_portfolio_value || capVal);
            const walletVal = Number(s.current_wallet || 0);
            const feesVal = Number(s.total_fees_paid || 0);
            const holdingsCount = (s.holdings || []).length;
            const pnlVal = s.total_pnl != null ? Number(s.total_pnl) : (portVal - capVal);
            const pnlPct = capVal > 0 ? (pnlVal / capVal) * 100 : 0;
            const isPnlPositive = pnlVal >= 0;
            const pnlColor = isPnlPositive ? '#10b981' : '#ef4444';

            document.getElementById('sd-metric-capital').innerText = `₹${formatCurrency(capVal)}`;
            
            const portValEl = document.getElementById('sd-metric-port-value');
            if (portValEl) {
                portValEl.innerText = `₹${formatCurrency(portVal)}`;
                portValEl.style.color = pnlColor;
            }

            const pnlEl = document.getElementById('sd-metric-pnl');
            if (pnlEl) {
                pnlEl.style.color = pnlColor;
                pnlEl.innerHTML = `${formatSignedCurrency(pnlVal, true)} <span id="sd-metric-pnl-pct" style="font-size: 12px; font-weight: 600; color: ${pnlColor};">(${formatPercent(pnlPct, true)})</span>`;
            }

            document.getElementById('sd-metric-wallet').innerText = `₹${formatCurrency(walletVal)}`;
            document.getElementById('sd-metric-fees').innerText = `₹${formatCurrency(feesVal)}`;
            document.getElementById('sd-metric-holdings-count').innerText = `${holdingsCount} ${holdingsCount === 1 ? 'stock' : 'stocks'}`;

            // Render Formula
            document.getElementById('sd-formula-text').innerText = s.formula || '—';

            // Render Timeline & Selected Run (focus the recent one / most right)
            const runs = s.runs || [];
            if (optRunIndex != null && optRunIndex >= 0 && optRunIndex < runs.length) {
                selectedRunIndex = optRunIndex;
            } else {
                selectedRunIndex = runs.length > 0 ? runs.length - 1 : null;
            }

            renderTimeline(runs, s.next_rebalance_date, s.status, true, optRunIndex);

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

    function renderTimeline(runs, nextRebalDate, status, isInitialLoad = false, optRunIndex = null) {
        const mount = document.getElementById('sd-timeline-mount');
        const actionSlot = document.getElementById('sd-timeline-action-slot');
        if (!mount) return;

        let actionBtnHtml = '';
        if (status === 'DRAFT' || runs.length === 0) {
            actionBtnHtml = `
                <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                    <button type="button" class="btn-primary" onclick="runStrategyInit('${escapeHtml(currentStrategy.id)}')" style="font-size: 13px; padding: 7px 18px; display: inline-flex; align-items: center; gap: 6px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); box-shadow: 0 2px 6px rgba(16, 185, 129, 0.35);">
                        <span>${getPlayIconSVG(12)}</span> <span>Run Init Only</span>
                    </button>
                </div>
            `;
        } else {
            const todayStr = new Date().toISOString().substring(0, 10);
            const isNextRebalFuture = nextRebalDate && nextRebalDate.substring(0, 10) > todayStr;

            if (isNextRebalFuture) {
                actionBtnHtml = `
                    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                        <button type="button" class="btn-secondary" style="font-size: 13px; padding: 7px 16px; display: inline-flex; align-items: center; gap: 6px; color: #10b981; border-color: rgba(16, 185, 129, 0.4); cursor: default;" title="All scheduled rebalances up to today are completed">
                            <span>✓</span> <span>Up to Date</span>
                        </button>
                        <button type="button" class="btn-secondary" onclick="openRunRebalanceModal()" style="font-size: 13px; padding: 7px 16px; display: inline-flex; align-items: center; gap: 6px; opacity: 0.7;" title="Next scheduled rebalance on ${formatDateDisplay(nextRebalDate)} is in the future">
                            <span style="display: inline-flex; align-items: center;">${getClockIconSVG(14)}</span> <span>Next: ${formatDateDisplay(nextRebalDate)}</span>
                        </button>
                    </div>
                `;
            } else {
                actionBtnHtml = `
                    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                        <button type="button" class="btn-primary" onclick="openRunRebalanceModal()" style="font-size: 13px; padding: 7px 18px; display: inline-flex; align-items: center; gap: 6px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); box-shadow: 0 2px 6px rgba(16, 185, 129, 0.35);">
                            <span style="display: inline-flex; align-items: center;">${getRebalanceIconSVG(14, 2.5)}</span> <span>Run Next Rebalance</span>
                        </button>
                    </div>
                `;
            }
        }
        if (actionSlot) actionSlot.innerHTML = actionBtnHtml;

        let html = '';

        if (runs.length === 0) {
            // Unrun Init Node
            html += `
                <div class="msc-timeline-node selected" onclick="selectTimelineRun(null)">
                    <div class="msc-timeline-icon current">${getPlayIconSVG(13)}</div>
                    <div class="msc-timeline-label">Init</div>
                    <div class="msc-timeline-subtext">Scheduled: ${formatDateDisplay(currentStrategy.start_date)}</div>
                </div>
                <div class="msc-timeline-connector"></div>
                <div class="msc-timeline-node" style="opacity: 0.6; cursor: default;">
                    <div class="msc-timeline-icon upcoming">${getClockIconSVG(14)}</div>
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

                // Clean vector icons for completed timeline milestones:
                // Checkmark for initial setup, crisp circular dual-arrows for rebalancing runs
                const nodeIcon = isInit ? getCheckIconSVG(16, 2.8) : getRebalanceIconSVG(16, 2.4);

                html += `
                    <div class="msc-timeline-node ${isSelected ? 'selected' : ''}" onclick="selectTimelineRun(${idx})" title="Click to view run results on ${execDate}">
                        <div class="msc-timeline-icon completed">${nodeIcon}</div>
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
                    <div class="msc-timeline-icon upcoming">${getClockIconSVG(14)}</div>
                    <div class="msc-timeline-label" style="color: var(--text-secondary);">Next Rebalance</div>
                    <div class="msc-timeline-subtext" style="color: #10b981; font-weight: 600;">${formatDateDisplay(nextRebalDate)}</div>
                </div>
            `;
        }

        mount.innerHTML = html;
        attachTimelineMouseScroll(mount);

        // Auto-scroll the timeline horizontally ONLY on initial page load to keep the active recent rightmost node in view
        if (isInitialLoad) {
            const scrollRecentNode = () => {
                if (optRunIndex == null && runs && runs.length > 0) {
                    // Focus the most recent rightmost run node on initial view load
                    mount.scrollTo({ left: mount.scrollWidth, behavior: 'smooth' });
                } else {
                    const selectedNode = mount.querySelector('.msc-timeline-node.selected');
                    if (selectedNode) {
                        const offsetLeft = selectedNode.offsetLeft - mount.offsetLeft;
                        const targetScrollLeft = offsetLeft - (mount.clientWidth / 2) + (selectedNode.offsetWidth / 2);
                        mount.scrollTo({ left: Math.max(0, targetScrollLeft), behavior: 'smooth' });
                    }
                }
            };

            requestAnimationFrame(scrollRecentNode);
            setTimeout(scrollRecentNode, 80);
            setTimeout(scrollRecentNode, 250);
        }
    }

    function attachTimelineMouseScroll(mount) {
        if (!mount || mount._hasMouseScrollAttached) return;
        mount._hasMouseScrollAttached = true;

        // 1. Mouse Wheel -> Horizontal Timeline Scroll
        // Translates vertical wheel rotation (deltaY) into horizontal scrolling
        mount.addEventListener('wheel', (evt) => {
            const maxScroll = mount.scrollWidth - mount.clientWidth;
            if (maxScroll <= 0) return;

            const delta = Math.abs(evt.deltaY) >= Math.abs(evt.deltaX) ? evt.deltaY : evt.deltaX;
            if (delta !== 0) {
                evt.preventDefault();
                mount.scrollLeft += delta;
            }
        }, { passive: false });

        // 2. Mouse Click-and-Drag (Grab to scroll horizontally)
        let isDown = false;
        let startX = 0;
        let initialScrollLeft = 0;
        let draggedDistance = 0;

        mount.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // Only primary/left mouse click
            isDown = true;
            mount.classList.add('is-dragging');
            startX = e.pageX - mount.offsetLeft;
            initialScrollLeft = mount.scrollLeft;
            draggedDistance = 0;
        });

        const handleMouseUp = () => {
            if (!isDown) return;
            isDown = false;
            mount.classList.remove('is-dragging');
        };

        window.addEventListener('mouseup', handleMouseUp);
        mount.addEventListener('mouseleave', handleMouseUp);

        mount.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            const x = e.pageX - mount.offsetLeft;
            const walk = (x - startX);
            draggedDistance = Math.abs(walk);
            if (draggedDistance > 3) {
                e.preventDefault();
                mount.scrollLeft = initialScrollLeft - walk;
            }
        });

        // Prevent accidental timeline node selection when dragging
        mount.addEventListener('click', (e) => {
            if (draggedDistance > 6) {
                e.stopPropagation();
                e.preventDefault();
            }
        }, true);
    }

    function selectTimelineRun(runIndex) {
        selectedRunIndex = runIndex;
        if (!currentStrategy) return;

        const runs = currentStrategy.runs || [];
        const mount = document.getElementById('sd-timeline-mount');
        if (mount) {
            const nodes = mount.querySelectorAll('.msc-timeline-node');
            if (nodes.length > 0) {
                // Update selected node classes in place without resetting or jumping the scroll position
                nodes.forEach((node, idx) => {
                    if (idx === runIndex || (runIndex === null && idx === 0 && runs.length === 0)) {
                        node.classList.add('selected');
                    } else {
                        node.classList.remove('selected');
                    }
                });
            } else {
                renderTimeline(runs, currentStrategy.next_rebalance_date, currentStrategy.status, false, runIndex);
            }
        }

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
                <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                    <button type="button" class="btn-primary" onclick="runStrategyInit('${escapeHtml(strategy.id)}')" style="font-size: 13.5px; padding: 9px 24px; display: inline-flex; align-items: center; gap: 8px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); box-shadow: 0 2px 8px rgba(16, 185, 129, 0.35);">
                        <span>▶</span> <span>Execute Init</span>
                    </button>
                </div>
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

        const snapVal = Number(portfolio.total_portfolio_value || 0);
        const snapCap = Number(portfolio.total_capital != null ? portfolio.total_capital : (currentStrategy.amount_to_invest || 0));
        const snapPnl = portfolio.total_pnl != null ? Number(portfolio.total_pnl) : (snapVal - snapCap);
        const snapPnlPct = snapCap > 0 ? (snapPnl / snapCap) * 100 : 0;
        const snapColor = snapPnl >= 0 ? '#10b981' : '#ef4444';

        let html = `
            <!-- Run Summary Banner -->
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px 18px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                <div>
                    <div style="font-size: 16px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                        <span style="display: inline-flex; align-items: center;">${isInit ? '🎯' : getRebalanceIconSVG(17, 2.4)}</span> <span>${escapeHtml(runTitle)}</span>
                    </div>
                    <div style="font-size: 12.5px; color: var(--text-secondary); margin-top: 4px;">
                        ${dateNote} &bull; Universe eligible stocks: <strong>${run.eligible_stocks_count || rankedStocks.length}</strong> &bull; Trim Overweight: <strong>${(currentStrategy && currentStrategy.trim_existing === false) ? 'No' : 'Yes'}</strong> &bull; Days/Mo: <strong>${(currentStrategy && currentStrategy.trading_days_per_month) || 30}d</strong>
                    </div>
                </div>
                <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
                    <span style="font-size: 12px; color: var(--text-secondary);">
                        Snapshot Value: <strong style="color: ${snapColor}; font-family: monospace;">₹${formatCurrency(snapVal)}</strong>
                        <span style="font-size: 11px; font-weight: 600; color: ${snapColor}; margin-left: 3px;">(${formatSignedCurrency(snapPnl, true)} / ${formatPercent(snapPnlPct, true)})</span>
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
                        <span class="msc-change-title" style="color: #3b82f6; display: flex; align-items: center; gap: 5px;">
                            ${getRebalanceIconSVG(13, 2.3)} Retained Stocks
                        </span>
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
                    <button type="button" class="btn-secondary" onclick="downloadAllRankedStocksExcel()" style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 6px 14px; font-weight: 600; border-radius: 6px; background: rgba(59, 130, 246, 0.12); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.35); cursor: pointer; transition: all 0.15s ease;" onmouseover="this.style.background='rgba(59, 130, 246, 0.22)'" onmouseout="this.style.background='rgba(59, 130, 246, 0.12)'" title="Download Excel covering all eligible universe stocks calculated and ordered by score (.xlsx)">
                        <span>📥</span> <span>Download All Ranked Stocks (.xlsx)</span>
                    </button>
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
                if (s.action_label) {
                    const actClass = s.action === 'BUY' ? 'buy' : (s.action === 'SELL' ? 'sell' : (s.action === 'HOLD' ? 'hold' : 'none'));
                    actionPill = `<span class="msc-action-pill ${actClass}">${escapeHtml(s.action_label)}</span>`;
                } else if (s.action === 'BUY') {
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
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
                    <h4 style="margin: 0; font-size: 14.5px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                        <span>💼</span> <span>Portfolio Holdings Snapshot (${holdings.length} stocks)</span>
                    </h4>
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <button type="button" class="btn-secondary" onclick="openPerformanceGraphModal()" style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 6px 14px; font-weight: 600; border-radius: 6px; background: rgba(59, 130, 246, 0.12); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.35); cursor: pointer; transition: all 0.15s ease;" onmouseover="this.style.background='rgba(59, 130, 246, 0.22)'" onmouseout="this.style.background='rgba(59, 130, 246, 0.12)'" title="View historical performance line graph of invested capital vs portfolio value with drawdowns and momentum KPIs">
                            <span>📈</span> <span>Performance Graph</span>
                        </button>
                        <button type="button" class="btn-secondary" onclick="openConsolidatedStocksModal()" style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 6px 14px; font-weight: 600; border-radius: 6px; background: rgba(16, 185, 129, 0.12); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35); cursor: pointer; transition: all 0.15s ease;" onmouseover="this.style.background='rgba(16, 185, 129, 0.22)'" onmouseout="this.style.background='rgba(16, 185, 129, 0.12)'" title="View all participated stocks history with holding durations and consolidated P&amp;L">
                            <span>📊</span> <span>Consolidated Stocks</span>
                        </button>
                    </div>
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
                                <th style="text-align: right;">ALLOC %</th>
                                <th style="text-align: right;">P&amp;L (₹)</th>
                                <th style="text-align: right;">P&amp;L %</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        if (holdings.length === 0) {
            html += `<tr><td colspan="10" style="text-align: center; padding: 20px; color: var(--text-secondary);">No active stock holdings in this snapshot.</td></tr>`;
        } else {
            holdings.forEach((h, idx) => {
                const pnl = Number(h.pnl || 0);
                const pnlPct = Number(h.pnl_percent || 0);
                const pnlColor = pnl >= 0 ? '#10b981' : '#ef4444';
                const weightDisplay = h.weight_percent != null
                    ? `${Number(h.weight_percent).toFixed(1)}%`
                    : (portfolio.total_portfolio_value > 0 ? `${((h.current_value / portfolio.total_portfolio_value) * 100).toFixed(1)}%` : '—');

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
                        <td style="text-align: right; font-family: monospace; font-weight: 600; color: #3b82f6;">${weightDisplay}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 600; color: ${pnlColor};">
                            ${formatSignedCurrency(pnl, true)}
                        </td>
                        <td style="text-align: right; font-family: monospace; font-weight: 600; color: ${pnlColor};">
                            ${formatPercent(pnlPct, true)}
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
        `;

        // In every rebalancing after Portfolio Holdings Snapshot: show Exited Stocks Details
        if (!isInit) {
            let exitedStocks = run.exited_stocks || portfolio.exited_stocks || (changes && changes.exited_stocks) || [];

            // Fallback derivation for any previous runs
            if ((!exitedStocks || exitedStocks.length === 0) && removed && removed.length > 0) {
                const prevHoldings = (currentStrategy.runs && selectedRunIndex > 0)
                    ? (currentStrategy.runs[selectedRunIndex - 1]?.portfolio_snapshot?.holdings || [])
                    : [];
                const prevMap = {};
                prevHoldings.forEach(h => { prevMap[h.symbol] = h; });
                const rankMap = {};
                (run.ranked_stocks || []).forEach(s => { rankMap[s.symbol] = s; });

                exitedStocks = removed.map(sym => {
                    const h = prevMap[sym] || {};
                    const stk = rankMap[sym] || {};
                    const qty = Number(h.quantity || 0);
                    const avgPrice = Number(h.buy_price || 0);
                    const exitPrice = Number(stk.price || h.current_price || avgPrice);
                    const invested = qty * avgPrice;
                    const exitVal = qty * exitPrice;
                    const pnl = exitVal - invested;
                    const pnlPct = avgPrice > 0 ? ((exitPrice - avgPrice) / avgPrice) * 100 : 0;
                    return {
                        symbol: sym,
                        quantity: qty,
                        average_price: avgPrice,
                        exit_price: exitPrice,
                        invested: invested,
                        exit_value: exitVal,
                        pnl: pnl,
                        pnl_percent: pnlPct
                    };
                });
            }

            const totalExitedPnl = (exitedStocks || []).reduce((sum, s) => sum + (Number(s.pnl) || 0), 0);
            const totalExitedInvested = (exitedStocks || []).reduce((sum, s) => sum + (Number(s.invested) || 0), 0);
            const totalExitedPnlPct = totalExitedInvested > 0 ? (totalExitedPnl / totalExitedInvested) * 100 : 0;
            const totalPnlColor = totalExitedPnl >= 0 ? '#10b981' : '#ef4444';

            html += `
                <!-- Exited Stocks Details Table -->
                <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 18px; margin-bottom: 22px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
                        <h4 style="margin: 0; font-size: 14.5px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                            <span style="color: #ef4444;">🚪</span> <span>Exited Stocks (${(exitedStocks || []).length} ${(exitedStocks || []).length === 1 ? 'stock' : 'stocks'})</span>
                        </h4>
                        ${(exitedStocks && exitedStocks.length > 0) ? `
                            <div style="font-size: 12.5px; font-family: monospace;">
                                <span style="color: var(--text-secondary);">Total Exited P&amp;L:</span>
                                <strong style="color: ${totalPnlColor}; font-weight: 700; margin-left: 4px;">
                                    ${formatSignedCurrency(totalExitedPnl, true)} (${formatPercent(totalExitedPnlPct, true)})
                                </strong>
                            </div>
                        ` : ''}
                    </div>
                    <div style="overflow-x: auto;">
                        <table class="msc-indices-table" style="font-size: 12px;">
                            <thead>
                                <tr style="background: var(--bg-subtle);">
                                    <th style="width: 45px;">S.NO</th>
                                    <th>STOCK SYMBOL</th>
                                    <th style="text-align: right;">QTY</th>
                                    <th style="text-align: right;">AVERAGE PRICE</th>
                                    <th style="text-align: right;">EXIT PRICE</th>
                                    <th style="text-align: right;">TOTAL P/L</th>
                                    <th style="text-align: right;">P/L %</th>
                                </tr>
                            </thead>
                            <tbody>
            `;

            if (!exitedStocks || exitedStocks.length === 0) {
                html += `
                    <tr>
                        <td colspan="7" style="text-align: center; padding: 22px; color: var(--text-secondary);">
                            No stocks exited during this rebalancing (all constituent holdings remained within the exit regime rank).
                        </td>
                    </tr>
                `;
            } else {
                exitedStocks.forEach((s, idx) => {
                    const pnl = Number(s.pnl || 0);
                    const pnlPct = Number(s.pnl_percent || 0);
                    const pnlColor = pnl >= 0 ? '#10b981' : '#ef4444';

                    html += `
                        <tr>
                            <td style="color: var(--text-secondary); font-weight: 500;">${idx + 1}</td>
                            <td>
                                <strong style="color: var(--text-primary); cursor: pointer;" onclick="if(typeof openInHouseChart==='function') openInHouseChart('${escapeHtml(s.symbol)}');" title="Open chart for ${escapeHtml(s.symbol)}">
                                    ${escapeHtml(s.symbol)}
                                </strong>
                            </td>
                            <td style="text-align: right; font-family: monospace; font-weight: 600;">${s.quantity}</td>
                            <td style="text-align: right; font-family: monospace;">₹${formatCurrency(s.average_price)}</td>
                            <td style="text-align: right; font-family: monospace; font-weight: 600;">₹${formatCurrency(s.exit_price)}</td>
                            <td style="text-align: right; font-family: monospace; font-weight: 700; color: ${pnlColor};">
                                ${formatSignedCurrency(pnl, true)}
                            </td>
                            <td style="text-align: right; font-family: monospace; font-weight: 700; color: ${pnlColor};">
                                ${formatPercent(pnlPct, true)}
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
            `;
        }

        html += `
            <!-- Capital & Wallet Audit Logs -->
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 18px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
                    <h4 style="margin: 0; font-size: 14.5px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                        <span>📜</span> <span>Capital &amp; Wallet Activity Logs</span>
                    </h4>
                    <button type="button" class="btn-sm btn-secondary" onclick="openLogTransactionsModal()" style="padding: 5px 12px; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; border-radius: 6px; font-weight: 600; cursor: pointer; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" title="View all stock buy and sell execution details">
                        <span>📋</span> <span>Transactions</span>
                    </button>
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
        showSmallcaseGlobalLoader({
            title: 'Executing Initial Portfolio Allocation...',
            badge: 'Momentum Engine',
            subtitle: 'Fetching historical quotes, evaluating 1M, 2M, 5M, 9M returns & volatilities, and executing equal-weight allocation...'
        });

        try {
            const data = await safeFetchJson(`/api/momentum-smallcases/strategies/${encodeURIComponent(strategyId)}/run-init`, {
                method: 'POST'
            });

            if (!data.success) {
                alertToast(data.error || 'Failed to execute Init', 'error');
                return;
            }

            if (data.async && data.job_id) {
                await pollJobUntilComplete(data.job_id, 'Executing Initial Allocation...', strategyId);
            }

            alertToast('Init execution completed successfully!', 'success');
            await openStrategyDetailView(strategyId);
            await loadStrategiesList();
        } catch (err) {
            console.error('Error running Init:', err);
            alertToast('Init execution failed: ' + err.message, 'error');
        } finally {
            hideSmallcaseGlobalLoader();
        }
    }

    function getPreviousRebalanceStepup(strategy) {
        if (!strategy) return null;
        const runs = strategy.runs || [];
        const rebalRuns = runs.filter(r => r && r.run_type === 'REBALANCE');
        if (rebalRuns.length === 0) {
            // Only Init has been executed (or no runs), so return null (show empty)
            return null;
        }
        // Get step-up amount from the most recent executed rebalance run
        const lastRebal = rebalRuns[rebalRuns.length - 1];
        if (lastRebal.stepup_amount !== undefined && lastRebal.stepup_amount !== null) {
            return Number(lastRebal.stepup_amount);
        }
        if (lastRebal.portfolio_snapshot && lastRebal.portfolio_snapshot.stepup_amount !== undefined && lastRebal.portfolio_snapshot.stepup_amount !== null) {
            return Number(lastRebal.portfolio_snapshot.stepup_amount);
        }
        const logs = strategy.capital_logs || [];
        for (let i = logs.length - 1; i >= 0; i--) {
            const l = logs[i];
            if (l.type === 'REBALANCE_EXECUTED' || l.type === 'STEPUP_DEPOSIT') {
                if (l.amount !== undefined && l.amount !== null) return Number(l.amount);
            }
        }
        if (strategy.last_stepup_amount !== undefined && strategy.last_stepup_amount !== null) {
            return Number(strategy.last_stepup_amount);
        }
        return null;
    }

    function openRunRebalanceModal() {
        if (!currentStrategy) return;
        ensureModalsAttachedToBody();

        const nextRebalStr = (currentStrategy.next_rebalance_date || '').substring(0, 10);
        const todayStr = new Date().toISOString().substring(0, 10);
        if (nextRebalStr && nextRebalStr > todayStr) {
            alertToast(`Cannot execute rebalance for future date (${formatDateDisplay(nextRebalStr)}). Market data is not available for future dates (today is ${formatDateDisplay(todayStr)}).`, 'error');
            return;
        }

        setSmallcaseModalLoader('runRebalanceModal', false);
        document.getElementById('rebal-modal-strat-name').innerText = currentStrategy.name;
        document.getElementById('rebal-modal-date').innerText = formatDateDisplay(currentStrategy.next_rebalance_date);
        
        // Get step-up amount from previous rebalance time. If only init has run, show empty.
        const prevStepup = getPreviousRebalanceStepup(currentStrategy);
        const stepupInput = document.getElementById('rebalStepupInput');
        if (stepupInput) {
            if (prevStepup !== null && prevStepup > 0) {
                stepupInput.value = prevStepup;
            } else {
                stepupInput.value = '';
            }
        }

        const trimSel = document.getElementById('rebalTrimSelect');
        if (trimSel) {
            trimSel.value = (currentStrategy.trim_existing === false) ? 'no' : 'yes';
        }

        const modal = document.getElementById('runRebalanceModal');
        if (modal) modal.style.display = 'flex';
        setTimeout(() => {
            const input = document.getElementById('rebalStepupInput');
            if (input) input.focus();
        }, 100);
    }

    function closeRunRebalanceModal() {
        setSmallcaseModalLoader('runRebalanceModal', false);
        const modal = document.getElementById('runRebalanceModal');
        if (modal) modal.style.display = 'none';
    }

    async function confirmRunRebalance() {
        if (!currentStrategy || isSubmitting) return;

        const nextRebalStr = (currentStrategy.next_rebalance_date || '').substring(0, 10);
        const todayStr = new Date().toISOString().substring(0, 10);
        if (nextRebalStr && nextRebalStr > todayStr) {
            alertToast(`Cannot execute rebalance for future date (${formatDateDisplay(nextRebalStr)}). Market data is not available for future dates (today is ${formatDateDisplay(todayStr)}).`, 'error');
            return;
        }

        // Empty string means 0
        const rawStepup = (document.getElementById('rebalStepupInput')?.value || '').trim();
        const stepupVal = rawStepup === '' ? 0 : parseFloat(rawStepup);
        if (isNaN(stepupVal) || stepupVal < 0) {
            alertToast('Step-up amount cannot be negative', 'warning');
            return;
        }

        const trimVal = (document.getElementById('rebalTrimSelect')?.value === 'no') ? false : true;

        const btn = document.getElementById('rebalConfirmSubmitBtn');
        const origText = btn ? btn.innerText : 'Confirm';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span>⏳</span> Rebalancing...';
        }
        isSubmitting = true;

        // Keep modal open and display brand loader inside it
        setSmallcaseModalLoader('runRebalanceModal', true, {
            title: 'Executing Rebalance...',
            badge: 'Scheduled Rebalance',
            subtitle: 'Re-evaluating momentum universe, liquidating exit stocks, and buying top momentum picks...'
        });

        try {
            const data = await safeFetchJson(`/api/momentum-smallcases/strategies/${encodeURIComponent(currentStrategy.id)}/run-rebalance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    stepup_amount: stepupVal,
                    trim_existing: trimVal
                })
            });

            if (!data.success) {
                alertToast(data.error || 'Failed to execute rebalance', 'error');
                return;
            }

            if (data.async && data.job_id) {
                await pollJobUntilComplete(data.job_id, 'Executing Rebalance...', currentStrategy.id);
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
            setSmallcaseModalLoader('runRebalanceModal', false);
            hideSmallcaseGlobalLoader();
            if (btn) {
                btn.disabled = false;
                btn.innerText = origText;
            }
        }
    }

    // =========================================================================
    // 4B. RUN ALL (INIT + REBALANCES) BATCH ENGINE
    // =========================================================================
    function openRunAllModal(strategyId) {
        ensureModalsAttachedToBody();
        setSmallcaseModalLoader('runAllRebalanceModal', false);
        let strat = currentStrategy;
        if (strategyId) {
            strat = (strategiesCache || []).find(s => s.id === strategyId) || currentStrategy;
            if (strat) currentStrategy = strat;
        }

        if (!currentStrategy) {
            alertToast('No strategy selected', 'warning');
            return;
        }

        const isDraft = currentStrategy.status === 'DRAFT' || !currentStrategy.runs || currentStrategy.runs.length === 0;
        const todayStr = new Date().toISOString().substring(0, 10);
        const nextRebalStr = (currentStrategy.next_rebalance_date || '').substring(0, 10);
        if (!isDraft && nextRebalStr && nextRebalStr > todayStr) {
            alertToast(`Cannot execute rebalance for future date (${formatDateDisplay(nextRebalStr)}). Smallcase is already up to date up to today (${formatDateDisplay(todayStr)}).`, 'error');
            return;
        }

        const modal = document.getElementById('runAllRebalanceModal');
        const titleEl = document.getElementById('runall-modal-title');
        const descEl = document.getElementById('runall-modal-desc');
        const subdescEl = document.getElementById('runall-modal-subdesc');
        const stepupInput = document.getElementById('runAllStepupInput');
        const cutoffInput = document.getElementById('runAllCutoffDateInput');

        const prevStepup = getPreviousRebalanceStepup(currentStrategy);
        if (stepupInput) {
            if (prevStepup !== null && prevStepup > 0) {
                stepupInput.value = prevStepup;
            } else {
                stepupInput.value = '';
            }
        }
        if (cutoffInput) {
            cutoffInput.value = todayStr;
            cutoffInput.max = todayStr;
        }

        if (isDraft) {
            if (titleEl) titleEl.innerText = `Run All (Init + Rebalances): ${currentStrategy.name}`;
            if (descEl) {
                descEl.innerHTML = `Will first execute <strong>Init</strong> on start date <strong>${formatDateDisplay(currentStrategy.start_date)}</strong>, and then sequentially execute all scheduled monthly rebalances up to the cutoff date.`;
            }
            if (subdescEl) {
                subdescEl.innerText = `Initial capital: ₹${formatCurrency(currentStrategy.amount_to_invest)}. Any step-up specified below will be added on each subsequent rebalance run.`;
            }
        } else {
            if (titleEl) titleEl.innerText = `Run All Rebalances: ${currentStrategy.name}`;
            if (descEl) {
                descEl.innerHTML = `Will iteratively execute all pending scheduled monthly rebalances starting from <strong>${formatDateDisplay(currentStrategy.next_rebalance_date)}</strong> up to the cutoff date.`;
            }
            if (subdescEl) {
                subdescEl.innerText = `Current wallet: ₹${formatCurrency(currentStrategy.current_wallet || 0)}. Any step-up specified below will be added before each rebalance run.`;
            }
        }

        const runAllTrim = document.getElementById('runAllTrimSelect');
        if (runAllTrim) {
            runAllTrim.value = (currentStrategy.trim_existing === false) ? 'no' : 'yes';
        }

        if (modal) modal.style.display = 'flex';
        setTimeout(() => {
            if (stepupInput) stepupInput.focus();
        }, 100);
    }

    function closeRunAllModal() {
        setSmallcaseModalLoader('runAllRebalanceModal', false);
        const modal = document.getElementById('runAllRebalanceModal');
        if (modal) modal.style.display = 'none';
    }

    async function confirmRunAllRebalances() {
        if (!currentStrategy || isSubmitting) return;

        // Consider empty means 0
        const rawStepup = (document.getElementById('runAllStepupInput')?.value || '').trim();
        const stepupVal = rawStepup === '' ? 0 : parseFloat(rawStepup);
        if (isNaN(stepupVal) || stepupVal < 0) {
            alertToast('Step-up amount cannot be negative', 'warning');
            return;
        }

        const trimVal = (document.getElementById('runAllTrimSelect')?.value === 'no') ? false : true;

        const cutoffVal = document.getElementById('runAllCutoffDateInput')?.value || '';
        const todayStr = new Date().toISOString().substring(0, 10);
        if (cutoffVal && cutoffVal > todayStr) {
            alertToast(`Cannot execute rebalance for future date (${formatDateDisplay(cutoffVal)}). Cutoff date cannot be in the future (today is ${formatDateDisplay(todayStr)}).`, 'error');
            return;
        }

        const isDraft = currentStrategy.status === 'DRAFT' || !currentStrategy.runs || currentStrategy.runs.length === 0;
        const nextRebalStr = (currentStrategy.next_rebalance_date || '').substring(0, 10);
        if (!isDraft && nextRebalStr && nextRebalStr > todayStr) {
            alertToast(`Cannot execute rebalance for future date (${formatDateDisplay(nextRebalStr)}). Smallcase is already up to date.`, 'error');
            return;
        }

        const btn = document.getElementById('runAllConfirmBtn');
        const origText = btn ? btn.innerText : '⚡ Run All Now';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span>⏳</span> Executing Runs...';
        }
        isSubmitting = true;

        // Keep modal open and display brand loader inside it
        setSmallcaseModalLoader('runAllRebalanceModal', true, {
            title: 'Running All Scheduled Rebalances...',
            badge: 'Batch Rebalance Engine',
            subtitle: 'Evaluating chronological universe, liquidating exit stocks, and buying top momentum picks...'
        });

        try {
            const data = await safeFetchJson(`/api/momentum-smallcases/strategies/${encodeURIComponent(currentStrategy.id)}/run-all`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    stepup_amount: stepupVal,
                    up_to_date: cutoffVal,
                    trim_existing: trimVal
                })
            });

            if (!data.success) {
                alertToast(data.error || 'Failed to complete all rebalances', 'error');
                if (data.strategy) {
                    currentStrategy = data.strategy;
                    selectedRunIndex = (currentStrategy.runs || []).length > 0 ? currentStrategy.runs.length - 1 : null;
                    await openStrategyDetailView(currentStrategy.id);
                }
                return;
            }

            let resultData = data;
            if (data.async && data.job_id) {
                resultData = await pollJobUntilComplete(data.job_id, 'Executing Batch Rebalances...', currentStrategy.id);
            }

            closeRunAllModal();
            alertToast((resultData && resultData.message) || 'All scheduled rebalances completed successfully!', 'success');

            // Refresh view and select latest run
            selectedRunIndex = null;
            await openStrategyDetailView(currentStrategy.id);
            await loadStrategiesList();
        } catch (err) {
            console.error('Error running all rebalances:', err);
            alertToast('Batch run failed: ' + err.message, 'error');
        } finally {
            isSubmitting = false;
            setSmallcaseModalLoader('runAllRebalanceModal', false);
            hideSmallcaseGlobalLoader();
            if (btn) {
                btn.disabled = false;
                btn.innerText = origText;
            }
        }
    }

    // =========================================================================
    // 5. FORMULA & SETTINGS EDIT MODAL
    // =========================================================================
    function openEditFormulaModal() {
        if (!currentStrategy) return;
        ensureModalsAttachedToBody();
        setSmallcaseModalLoader('editFormulaModal', false);
        document.getElementById('formulaEditInput').value = currentStrategy.formula || '';
        const trimSel = document.getElementById('formulaTrimExistingSelect');
        if (trimSel) {
            trimSel.value = (currentStrategy.trim_existing === false) ? 'no' : 'yes';
        }
        const modal = document.getElementById('editFormulaModal');
        if (modal) modal.style.display = 'flex';
        setTimeout(() => {
            const ta = document.getElementById('formulaEditInput');
            if (ta) ta.focus();
        }, 100);
    }

    function closeEditFormulaModal() {
        setSmallcaseModalLoader('editFormulaModal', false);
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

        const trimVal = (document.getElementById('formulaTrimExistingSelect')?.value === 'no') ? false : true;

        const btn = document.getElementById('formulaSaveSubmitBtn');
        const origText = btn ? btn.innerText : 'Save Settings';
        if (btn) {
            btn.disabled = true;
            btn.innerText = 'Saving...';
        }
        isSubmitting = true;

        setSmallcaseModalLoader('editFormulaModal', true, {
            title: 'Saving Smallcase Settings...',
            badge: 'Settings Editor',
            subtitle: 'Updating momentum formula & stock trim behavior for future rebalances...'
        });

        try {
            const data = await safeFetchJson(`/api/momentum-smallcases/strategies/${encodeURIComponent(currentStrategy.id)}/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    formula: formula,
                    trim_existing: trimVal
                })
            });

            if (!data.success) {
                alertToast(data.error || 'Failed to update settings', 'error');
                return;
            }

            if (data.strategy) {
                currentStrategy = data.strategy;
            } else {
                currentStrategy.formula = formula;
                currentStrategy.trim_existing = trimVal;
            }

            const formulaEl = document.getElementById('sd-formula-text');
            if (formulaEl) formulaEl.innerText = formula;
            const trimEl = document.getElementById('sd-trim-existing');
            if (trimEl) {
                trimEl.innerText = (currentStrategy.trim_existing === false) ? 'No' : 'Yes';
                trimEl.style.color = (currentStrategy.trim_existing === false) ? '#eab308' : 'var(--text-primary)';
            }

            closeEditFormulaModal();
            alertToast('Formula & settings updated successfully', 'success');
        } catch (err) {
            console.error('Error saving settings:', err);
            alertToast('Error saving settings: ' + err.message, 'error');
        } finally {
            isSubmitting = false;
            setSmallcaseModalLoader('editFormulaModal', false);
            if (btn) {
                btn.disabled = false;
                btn.innerText = origText;
            }
        }
    }

    async function toggleStrategyTrimExisting() {
        if (!currentStrategy || isSubmitting) return;
        const currentTrim = (currentStrategy.trim_existing !== false);
        const newTrim = !currentTrim;

        try {
            isSubmitting = true;
            const res = await safeFetchJson(`/api/momentum-smallcases/strategies/${encodeURIComponent(currentStrategy.id)}/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trim_existing: newTrim })
            });
            if (res.success && res.strategy) {
                currentStrategy = res.strategy;
                const trimEl = document.getElementById('sd-trim-existing');
                if (trimEl) {
                    trimEl.innerText = newTrim ? 'Yes' : 'No';
                    trimEl.style.color = newTrim ? 'var(--text-primary)' : '#eab308';
                }
                alertToast(
                    newTrim
                        ? 'Trim Overweight set to YES: Overweight stocks will be trimmed to target weight on rebalance.'
                        : 'Trim Overweight set to NO: Retained stock sizes will NEVER be decreased on rebalance.',
                    'info'
                );
            } else {
                alertToast(res.error || 'Failed to update trim setting', 'error');
            }
        } catch (e) {
            alertToast('Failed to update trim setting: ' + e.message, 'error');
        } finally {
            isSubmitting = false;
        }
    }

    // =========================================================================
    // 5a. EXCEL EXPORT FOR ALL RANKED STOCKS
    // =========================================================================
    function downloadAllRankedStocksExcel() {
        if (!currentStrategy) {
            alertToast('Please select a momentum smallcase strategy first.', 'error');
            return;
        }

        const runIdx = (selectedRunIndex != null) ? selectedRunIndex : (currentStrategy.runs ? currentStrategy.runs.length - 1 : 0);
        const url = `/api/momentum-smallcases/strategies/${encodeURIComponent(currentStrategy.id)}/runs/${encodeURIComponent(runIdx)}/export-ranked-excel`;

        alertToast('Downloading Excel workbook for all eligible stocks...', 'info');
        window.location.href = url;
    }

    // =========================================================================
    // 5b. CONSOLIDATED PARTICIPATED STOCKS HISTORY MODAL
    // Displays all participated stocks across Init and Rebalances
    // Ordered by longer holding period descending, with In/Out dates,
    // holding durations, stint P/L & %, total cumulative P/L & %, supporting negative returns,
    // and consolidated portfolio total at the bottom.
    // =========================================================================
    let consolidatedStocksData = null;
    let currentConsolidatedFilter = 'all';
    let consolidatedSearchQuery = '';

    function updateFilterPillStates() {
        const pills = [
            { id: 'csPillAll', filter: 'all' },
            { id: 'csPillHolding', filter: 'holding' },
            { id: 'csPillExited', filter: 'exited' }
        ];
        pills.forEach(p => {
            const btn = document.getElementById(p.id);
            if (!btn) return;
            if (p.filter === currentConsolidatedFilter) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    function setConsolidatedLoadingState() {
        const countEl = document.getElementById('csSummaryCount');
        const breakdownEl = document.getElementById('csSummaryBreakdown');
        const invEl = document.getElementById('csSummaryInvested');
        const valEl = document.getElementById('csSummaryValue');
        const pnlEl = document.getElementById('csSummaryPnl');
        const pnlPctEl = document.getElementById('csSummaryPnlPct');
        const tbody = document.getElementById('csStocksTbody');
        const tfoot = document.getElementById('csStocksTfoot');

        if (countEl) countEl.innerText = 'Calculating...';
        if (breakdownEl) breakdownEl.innerText = 'Evaluating all execution runs...';
        if (invEl) invEl.innerText = '₹...';
        if (valEl) valEl.innerText = '₹...';
        if (pnlEl) {
            pnlEl.innerText = '₹...';
            pnlEl.style.color = 'var(--text-primary)';
        }
        if (pnlPctEl) {
            pnlPctEl.innerText = '...%';
            pnlPctEl.style.color = 'var(--text-primary)';
        }
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; padding: 36px 20px; color: var(--text-secondary);"><div style="font-size: 14px; font-weight: 600; margin-bottom: 4px;">⏳ Loading Consolidated Stocks History...</div><div style="font-size: 11.5px;">Compiling holding periods, entry/exit dates and performance metrics</div></td></tr>`;
        }
        if (tfoot) tfoot.innerHTML = '';
    }

    function deriveConsolidatedStocksLocally(strategy) {
        if (!strategy || !strategy.runs || strategy.runs.length === 0) {
            return {
                stocks: [],
                summary: {
                    total_participated: 0,
                    holding_count: 0,
                    exited_count: 0,
                    total_invested: 0,
                    total_value: 0,
                    consolidated_pnl: 0,
                    consolidated_pnl_percent: 0
                }
            };
        }

        const parseDate = (dStr) => {
            if (!dStr) return null;
            try {
                const parts = String(dStr).slice(0, 10).split('-');
                if (parts.length === 3) {
                    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
                }
            } catch (_) {}
            return null;
        };

        const formatMonthYear = (dObj) => {
            if (!dObj || isNaN(dObj.getTime())) return '—';
            return dObj.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        };

        const activeStints = {};
        const allStints = [];
        const runs = strategy.runs || [];

        runs.forEach((run, runIdx) => {
            const execDateStr = run.executed_date || run.scheduled_date || '';
            const execDate = parseDate(execDateStr);
            const portfolio = run.portfolio_snapshot || {};
            const holdings = portfolio.holdings || [];
            const exited = portfolio.exited_stocks || (portfolio.changes && portfolio.changes.exited_stocks) || [];

            // Exited stocks
            exited.forEach(ex => {
                const sym = ex.symbol;
                if (!sym) return;
                const exitPrice = Number(ex.exit_price || 0);
                const qty = Number(ex.quantity || 0);
                const avgPrice = Number(ex.average_price || ex.buy_price || 0);
                const exitVal = Number(ex.exit_value || (qty * exitPrice));

                if (activeStints[sym]) {
                    const stint = activeStints[sym];
                    delete activeStints[sym];
                    stint.exit_date = execDateStr;
                    stint.exit_date_obj = execDate;
                    stint.exit_month_year = formatMonthYear(execDate);
                    stint.exit_price = exitPrice;
                    stint.exit_value = exitVal;
                    stint.current_or_exit_value = exitVal;
                    stint.status = 'EXITED';

                    const inv = stint.invested;
                    const pnl = Number((exitVal - inv).toFixed(2));
                    const pnlPct = inv > 0 ? Number((((exitVal - inv) / inv) * 100).toFixed(2)) : 0;
                    stint.pnl = pnl;
                    stint.pnl_percent = pnlPct;
                    allStints.push(stint);
                } else {
                    const inv = Number(ex.invested || (qty * avgPrice));
                    const pnl = ex.pnl !== undefined ? Number(ex.pnl) : Number((exitVal - inv).toFixed(2));
                    const pnlPct = ex.pnl_percent !== undefined ? Number(ex.pnl_percent) : (inv > 0 ? Number((((exitVal - inv) / inv) * 100).toFixed(2)) : 0);
                    const prevRunDateStr = runIdx > 0 ? (runs[runIdx - 1].executed_date || runs[runIdx - 1].scheduled_date) : execDateStr;
                    const prevDate = parseDate(prevRunDateStr);
                    allStints.push({
                        symbol: sym,
                        status: 'EXITED',
                        entry_date: prevRunDateStr,
                        entry_date_obj: prevDate,
                        entry_month_year: formatMonthYear(prevDate),
                        entry_price: avgPrice,
                        exit_date: execDateStr,
                        exit_date_obj: execDate,
                        exit_month_year: formatMonthYear(execDate),
                        exit_price: exitPrice,
                        quantity: qty,
                        invested: inv,
                        current_or_exit_value: exitVal,
                        pnl: pnl,
                        pnl_percent: pnlPct
                    });
                }
            });

            // Holdings in this run
            holdings.forEach(h => {
                const sym = h.symbol;
                if (!sym) return;
                const qty = Number(h.quantity || 0);
                const buyPrice = Number(h.buy_price || 0);
                const currPrice = Number(h.current_price || buyPrice);
                const inv = Number(h.invested || (qty * buyPrice));
                const currVal = Number(h.current_value || (qty * currPrice));
                const pnl = h.pnl !== undefined ? Number(h.pnl) : Number((currVal - inv).toFixed(2));
                const pnlPct = h.pnl_percent !== undefined ? Number(h.pnl_percent) : (inv > 0 ? Number((((currVal - inv) / inv) * 100).toFixed(2)) : 0);

                if (!activeStints[sym]) {
                    activeStints[sym] = {
                        symbol: sym,
                        status: 'HOLDING',
                        entry_date: execDateStr,
                        entry_date_obj: execDate,
                        entry_month_year: formatMonthYear(execDate),
                        entry_price: buyPrice,
                        exit_date: null,
                        exit_date_obj: null,
                        exit_month_year: 'Holding',
                        exit_price: null,
                        quantity: qty,
                        invested: inv,
                        current_price: currPrice,
                        current_or_exit_value: currVal,
                        pnl: pnl,
                        pnl_percent: pnlPct,
                        last_date_obj: execDate
                    };
                } else {
                    const s = activeStints[sym];
                    s.quantity = qty;
                    s.current_price = currPrice;
                    s.invested = inv;
                    s.current_or_exit_value = currVal;
                    s.pnl = pnl;
                    s.pnl_percent = pnlPct;
                    s.last_date_obj = execDate;
                }
            });
        });

        const latestRunDate = parseDate(runs[runs.length - 1].executed_date || runs[runs.length - 1].scheduled_date);
        Object.values(activeStints).forEach(stint => {
            stint.status = 'HOLDING';
            stint.exit_month_year = 'Holding';
            stint.exit_date = null;
            stint.exit_date_obj = stint.last_date_obj || latestRunDate;
            allStints.push(stint);
        });

        // Compute holding duration in days and text
        allStints.forEach(s => {
            const dStart = s.entry_date_obj || latestRunDate;
            const dEnd = s.exit_date_obj || latestRunDate;
            let days = 0;
            if (dStart && dEnd) {
                const diffTime = dEnd.getTime() - dStart.getTime();
                days = Math.max(0, Math.round(diffTime / (1000 * 60 * 60 * 24)));
            }
            s.days_held = days;
            const months = Math.round(days / 30.4);
            if (months >= 1) {
                s.holding_period_text = `${months} mo${months !== 1 ? 's' : ''} (${days}d)`;
            } else if (days > 0) {
                s.holding_period_text = `${days} day${days !== 1 ? 's' : ''}`;
            } else {
                s.holding_period_text = 'Current (0d)';
            }
        });

        // Total per symbol
        const symTotals = {};
        allStints.forEach(s => {
            if (!symTotals[s.symbol]) symTotals[s.symbol] = { invested: 0, pnl: 0 };
            symTotals[s.symbol].invested += s.invested;
            symTotals[s.symbol].pnl += s.pnl;
        });

        // Assign round numbers chronologically per symbol
        const stintsBySym = {};
        allStints.forEach(s => {
            if (!stintsBySym[s.symbol]) stintsBySym[s.symbol] = [];
            stintsBySym[s.symbol].push(s);
        });

        Object.values(stintsBySym).forEach(group => {
            group.sort((a, b) => String(a.entry_date || '').localeCompare(String(b.entry_date || '')));
            const tot = group.length;
            group.forEach((item, idx) => {
                item.round_number = idx + 1;
                item.total_rounds = tot;
            });
        });

        allStints.forEach(s => {
            const tInv = symTotals[s.symbol].invested;
            const tPnl = symTotals[s.symbol].pnl;
            s.total_stock_pnl = Number(tPnl.toFixed(2));
            s.total_stock_pnl_percent = tInv > 0 ? Number(((tPnl / tInv) * 100).toFixed(2)) : 0;
        });

        // Order by longer holding period descending
        allStints.sort((a, b) => {
            if (b.days_held !== a.days_held) return b.days_held - a.days_held;
            return b.pnl - a.pnl;
        });

        const totInvested = Number(allStints.reduce((acc, s) => acc + s.invested, 0).toFixed(2));
        const totVal = Number(allStints.reduce((acc, s) => acc + s.current_or_exit_value, 0).toFixed(2));
        const totPnl = Number(allStints.reduce((acc, s) => acc + s.pnl, 0).toFixed(2));
        const totPnlPct = totInvested > 0 ? Number(((totPnl / totInvested) * 100).toFixed(2)) : 0;

        return {
            stocks: allStints,
            summary: {
                total_participated: allStints.length,
                holding_count: allStints.filter(s => s.status === 'HOLDING').length,
                exited_count: allStints.filter(s => s.status === 'EXITED').length,
                total_invested: totInvested,
                total_value: totVal,
                consolidated_pnl: totPnl,
                consolidated_pnl_percent: totPnlPct
            }
        };
    }

    async function openConsolidatedStocksModal() {
        if (!currentStrategy) {
            alertToast('Please select a momentum smallcase strategy first.', 'error');
            return;
        }

        ensureModalsAttachedToBody();

        const badgeEl = document.getElementById('csModalStrategyBadge');
        if (badgeEl) badgeEl.innerText = currentStrategy.name || 'Strategy';

        const searchInput = document.getElementById('csSearchInput');
        if (searchInput) searchInput.value = '';
        consolidatedSearchQuery = '';
        currentConsolidatedFilter = 'all';
        updateFilterPillStates();

        setConsolidatedLoadingState();

        const modal = document.getElementById('consolidatedStocksModal');
        if (modal) modal.style.display = 'flex';

        try {
            const resp = await safeFetchJson(`/api/momentum-smallcases/strategies/${encodeURIComponent(currentStrategy.id)}/consolidated-stocks`);
            if (resp && resp.success && resp.data) {
                consolidatedStocksData = resp.data;
            } else {
                consolidatedStocksData = deriveConsolidatedStocksLocally(currentStrategy);
            }
        } catch (err) {
            console.warn('API error fetching consolidated stocks, falling back to client derivation:', err);
            consolidatedStocksData = deriveConsolidatedStocksLocally(currentStrategy);
        }

        renderConsolidatedStocksView();
    }

    function closeConsolidatedStocksModal() {
        const modal = document.getElementById('consolidatedStocksModal');
        if (modal) modal.style.display = 'none';
    }

    function filterConsolidatedTable(filterType) {
        currentConsolidatedFilter = filterType || 'all';
        updateFilterPillStates();
        renderConsolidatedStocksTableRows();
    }

    function handleConsolidatedSearch() {
        const input = document.getElementById('csSearchInput');
        consolidatedSearchQuery = (input ? input.value : '').trim().toUpperCase();
        renderConsolidatedStocksTableRows();
    }

    function renderConsolidatedStocksView() {
        if (!consolidatedStocksData) return;
        const summary = consolidatedStocksData.summary || {};

        // Top Summary Cards
        const countEl = document.getElementById('csSummaryCount');
        const breakdownEl = document.getElementById('csSummaryBreakdown');
        const invEl = document.getElementById('csSummaryInvested');
        const valEl = document.getElementById('csSummaryValue');
        const pnlEl = document.getElementById('csSummaryPnl');
        const pnlPctEl = document.getElementById('csSummaryPnlPct');

        if (countEl) countEl.innerText = `${summary.total_participated || 0} stocks`;
        if (breakdownEl) breakdownEl.innerText = `${summary.holding_count || 0} active holding · ${summary.exited_count || 0} exited`;
        if (invEl) invEl.innerText = `₹${formatCurrency(summary.total_invested || 0)}`;
        if (valEl) valEl.innerText = `₹${formatCurrency(summary.total_value || 0)}`;

        const pnl = Number(summary.consolidated_pnl || 0);
        const pnlPct = Number(summary.consolidated_pnl_percent || 0);
        const pnlColor = pnl >= 0 ? '#10b981' : '#ef4444';

        if (pnlEl) {
            pnlEl.innerText = formatSignedCurrency(pnl, true);
            pnlEl.style.color = pnlColor;
        }
        if (pnlPctEl) {
            pnlPctEl.innerText = formatPercent(pnlPct, true);
            pnlPctEl.style.color = pnlColor;
        }

        // Pill counts
        const pillAll = document.getElementById('csPillCountAll');
        const pillHold = document.getElementById('csPillCountHolding');
        const pillExit = document.getElementById('csPillCountExited');
        if (pillAll) pillAll.innerText = summary.total_participated || 0;
        if (pillHold) pillHold.innerText = summary.holding_count || 0;
        if (pillExit) pillExit.innerText = summary.exited_count || 0;

        renderConsolidatedStocksTableRows();
    }

    function renderConsolidatedStocksTableRows() {
        if (!consolidatedStocksData) return;
        const allStocks = consolidatedStocksData.stocks || [];
        const summary = consolidatedStocksData.summary || {};
        const tbody = document.getElementById('csStocksTbody');
        const tfoot = document.getElementById('csStocksTfoot');
        if (!tbody) return;

        // Apply filter
        let filtered = allStocks.filter(s => {
            if (currentConsolidatedFilter === 'holding') return s.status === 'HOLDING';
            if (currentConsolidatedFilter === 'exited') return s.status === 'EXITED';
            return true;
        });

        // Apply search
        if (consolidatedSearchQuery) {
            filtered = filtered.filter(s => (s.symbol || '').toUpperCase().includes(consolidatedSearchQuery));
        }

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; padding: 32px 20px; color: var(--text-secondary);"><div style="font-size: 13.5px;">No stocks match your filter criteria (${escapeHtml(currentConsolidatedFilter)}${consolidatedSearchQuery ? ' · ' + escapeHtml(consolidatedSearchQuery) : ''}).</div></td></tr>`;
        } else {
            let html = '';
            filtered.forEach((s, idx) => {
                const isHolding = s.status === 'HOLDING';
                const statusBadge = isHolding
                    ? `<span style="font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 9999px; background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35);">Holding</span>`
                    : `<span style="font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 9999px; background: rgba(148, 163, 184, 0.12); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25);">Exited</span>`;

                const outDisplay = isHolding
                    ? `<span style="color: #10b981; font-weight: 600;">Holding</span>`
                    : `<span style="color: var(--text-secondary);">${escapeHtml(s.exit_month_year || '—')}</span>`;

                const stintPnl = Number(s.pnl || 0);
                const stintPnlPct = Number(s.pnl_percent || 0);
                const stintColor = stintPnl >= 0 ? '#10b981' : '#ef4444';

                const totalPnl = Number(s.total_stock_pnl || 0);
                const totalPnlPct = Number(s.total_stock_pnl_percent || 0);
                const totalColor = totalPnl >= 0 ? '#10b981' : '#ef4444';

                const roundBadge = (s.total_rounds && s.total_rounds > 1)
                    ? `<span style="font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px; background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); margin-left: 6px; white-space: nowrap;" title="Participation round ${s.round_number} of ${s.total_rounds} for ${escapeHtml(s.symbol)}">Round ${s.round_number} of ${s.total_rounds}</span>`
                    : '';

                html += `
                    <tr style="border-bottom: 1px solid var(--border-color); transition: background-color 0.12s ease;">
                        <td style="text-align: center; color: var(--text-secondary); font-size: 11px;">${idx + 1}</td>
                        <td style="font-weight: 700; color: var(--text-primary); letter-spacing: 0.3px; white-space: nowrap;">
                            ${escapeHtml(s.symbol)}
                            ${roundBadge}
                        </td>
                        <td style="text-align: center;">${statusBadge}</td>
                        <td style="text-align: center; font-weight: 500; color: var(--text-primary);">${escapeHtml(s.entry_month_year || '—')}</td>
                        <td style="text-align: center;">${outDisplay}</td>
                        <td style="text-align: center; font-family: monospace; font-weight: 700; color: var(--text-primary);">
                            ${escapeHtml(s.holding_period_text || '—')}
                        </td>
                        <td style="text-align: right; font-family: monospace; color: var(--text-secondary);">
                            ₹${formatCurrency(s.invested || 0)}
                        </td>
                        <td style="text-align: right; font-family: monospace; font-weight: 600; color: var(--text-primary);">
                            ₹${formatCurrency(s.current_or_exit_value || 0)}
                        </td>
                        <td style="text-align: right; font-family: monospace; font-weight: 700; color: ${stintColor};">
                            ${formatSignedCurrency(stintPnl, true)}
                        </td>
                        <td style="text-align: right; font-family: monospace; font-weight: 700; color: ${stintColor};">
                            ${formatPercent(stintPnlPct, true)}
                        </td>
                        <td style="text-align: right; font-family: monospace; font-weight: 700; color: ${totalColor};">
                            ${formatSignedCurrency(totalPnl, true)}
                        </td>
                        <td style="text-align: right; font-family: monospace; font-weight: 700; color: ${totalColor};">
                            ${formatPercent(totalPnlPct, true)}
                        </td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        }

        // Consolidated Total in tfoot
        if (tfoot) {
            const totInvested = summary.total_invested || 0;
            const totValue = summary.total_value || 0;
            const totPnl = Number(summary.consolidated_pnl || 0);
            const totPnlPct = Number(summary.consolidated_pnl_percent || 0);
            const totPnlColor = totPnl >= 0 ? '#10b981' : '#ef4444';

            tfoot.innerHTML = `
                <tr style="background: var(--bg-subtle, rgba(255,255,255,0.04));">
                    <td colspan="6" style="text-align: left; padding: 12px 14px; font-weight: 700; color: var(--text-primary);">
                        📊 Consolidated Portfolio Total (${summary.total_participated || 0} participated stocks)
                    </td>
                    <td style="text-align: right; font-family: monospace; padding: 12px 8px; font-weight: 700; color: var(--text-primary);">
                        ₹${formatCurrency(totInvested)}
                    </td>
                    <td style="text-align: right; font-family: monospace; padding: 12px 8px; font-weight: 700; color: var(--text-primary);">
                        ₹${formatCurrency(totValue)}
                    </td>
                    <td style="text-align: right; font-family: monospace; padding: 12px 8px; font-weight: 700; color: ${totPnlColor};">
                        ${formatSignedCurrency(totPnl, true)}
                    </td>
                    <td style="text-align: right; font-family: monospace; padding: 12px 8px; font-weight: 700; color: ${totPnlColor};">
                        ${formatPercent(totPnlPct, true)}
                    </td>
                    <td style="text-align: right; font-family: monospace; padding: 12px 8px; font-weight: 700; color: ${totPnlColor};">
                        ${formatSignedCurrency(totPnl, true)}
                    </td>
                    <td style="text-align: right; font-family: monospace; padding: 12px 8px; font-weight: 700; color: ${totPnlColor};">
                        ${formatPercent(totPnlPct, true)}
                    </td>
                </tr>
            `;
        }
    }

    // =========================================================================
    // 5B. WALLET ACTIVITY LOG TRANSACTIONS MODAL
    // Shows all stock buy/sell order details with consolidated total amount and charges
    // =========================================================================
    let currentLogTradesState = {
        log: null,
        run: null,
        trades: [],
        filter: 'all',
        query: ''
    };

    function hasLogTransactions(log, strategy) {
        if (!log || !strategy) return false;
        if (log.type === 'PORTFOLIO_INIT' || log.type === 'REBALANCE_EXECUTED') return true;
        if (log.run_id) return true;
        if (log.type === 'INITIAL_DEPOSIT' && strategy.runs && strategy.runs.length > 0) return true;
        return false;
    }

    function getLogTransactions(log, strategy) {
        if (!log || !strategy) return { run: null, trades: [] };
        const runs = strategy.runs || [];
        let matchedRun = null;

        // 1. Match run by run_id
        if (log.run_id) {
            matchedRun = runs.find(r => r.run_id === log.run_id);
        }
        // 2. Match by run_number
        if (!matchedRun && log.run_number !== undefined && log.run_number !== null) {
            matchedRun = runs.find(r => r.run_number === log.run_number);
        }
        // 3. Match by notes regex (e.g. "Rebalance #1")
        if (!matchedRun && log.notes) {
            const m = log.notes.match(/Rebalance #(\d+)/i);
            if (m) {
                const num = parseInt(m[1], 10);
                matchedRun = runs.find(r => r.run_number === num || (r.title && r.title.includes('#' + num)));
            }
        }
        // 4. Match by log type
        if (!matchedRun) {
            if (log.type === 'PORTFOLIO_INIT' || log.type === 'INITIAL_DEPOSIT') {
                matchedRun = runs.find(r => r.run_type === 'INIT') || runs[0];
            } else if (log.type === 'REBALANCE_EXECUTED') {
                const rebalRuns = runs.filter(r => r.run_type === 'REBALANCE');
                if (rebalRuns.length > 0) {
                    matchedRun = rebalRuns[rebalRuns.length - 1];
                }
            }
        }

        if (!matchedRun) return { run: null, trades: [] };
        return { run: matchedRun, trades: getTransactionsForRun(matchedRun, strategy) };
    }

    function getTransactionsForRun(run, strategy) {
        if (!run || !strategy) return [];
        const runs = strategy.runs || [];
        const runIdx = runs.indexOf(run);
        const snapshot = run.portfolio_snapshot || {};
        const runDate = formatDateDisplay(run.executed_date || run.scheduled_date || '');
        const isInit = run.run_type === 'INIT' || runIdx === 0;
        const runTitle = isInit ? 'Init' : (run.title || `Rebalance #${runIdx}`);

        // 1. Check if pre-calculated transactions exist
        if (snapshot.transactions && Array.isArray(snapshot.transactions) && snapshot.transactions.length > 0) {
            return snapshot.transactions.map(t => ({
                ...t,
                run_index: runIdx,
                run_title: runTitle,
                run_date: runDate
            }));
        }
        if (run.transactions && Array.isArray(run.transactions) && run.transactions.length > 0) {
            return run.transactions.map(t => ({
                ...t,
                run_index: runIdx,
                run_title: runTitle,
                run_date: runDate
            }));
        }

        // 2. Fallback: derive trades dynamically from holdings, changes, and exited_stocks
        const trades = [];

        if (isInit) {
            const holdings = snapshot.holdings || [];
            holdings.forEach(h => {
                const qty = Number(h.quantity || 0);
                const price = Number(h.buy_price || h.current_price || 0);
                const amt = Number(h.invested || (qty * price));
                const fee = Number(h.fee || (amt * 0.0010));
                trades.push({
                    symbol: h.symbol,
                    action: 'BUY',
                    action_label: `BUY (${qty})`,
                    quantity: qty,
                    price: price,
                    amount: Math.round(amt * 100) / 100,
                    fee: Math.round(fee * 100) / 100,
                    trade_type: 'INITIAL_BUY',
                    notes: 'Initial Portfolio Allocation',
                    run_index: runIdx,
                    run_title: runTitle,
                    run_date: runDate
                });
            });
        } else {
            const prevRun = runIdx > 0 ? runs[runIdx - 1] : null;
            const prevHoldings = (prevRun && prevRun.portfolio_snapshot && prevRun.portfolio_snapshot.holdings) || [];
            const prevMap = {};
            prevHoldings.forEach(h => { prevMap[h.symbol] = h; });

            const currHoldings = snapshot.holdings || [];
            const currMap = {};
            currHoldings.forEach(h => { currMap[h.symbol] = h; });

            const exited = run.exited_stocks || snapshot.exited_stocks || (snapshot.changes && snapshot.changes.exited_stocks) || [];
            const exitedSyms = new Set();

            // Exits
            exited.forEach(ex => {
                exitedSyms.add(ex.symbol);
                const qty = Number(ex.quantity || 0);
                const price = Number(ex.exit_price || ex.average_price || 0);
                const amt = Number(ex.exit_value || (qty * price));
                const fee = Number(ex.fee || (amt * 0.0010));
                trades.push({
                    symbol: ex.symbol,
                    action: 'SELL',
                    action_label: 'SELL (Exit)',
                    quantity: qty,
                    price: price,
                    amount: Math.round(amt * 100) / 100,
                    fee: Math.round(fee * 100) / 100,
                    trade_type: 'EXIT_SELL',
                    notes: 'Exit (Dropped Rank)',
                    run_index: runIdx,
                    run_title: runTitle,
                    run_date: runDate
                });
            });

            // Any removed symbols not captured in exited list
            prevHoldings.forEach(prevH => {
                if (!currMap[prevH.symbol] && !exitedSyms.has(prevH.symbol)) {
                    const qty = Number(prevH.quantity || 0);
                    const price = Number(prevH.current_price || prevH.buy_price || 0);
                    const amt = Number(qty * price);
                    trades.push({
                        symbol: prevH.symbol,
                        action: 'SELL',
                        action_label: 'SELL (Exit)',
                        quantity: qty,
                        price: price,
                        amount: Math.round(amt * 100) / 100,
                        fee: Math.round(amt * 0.0010 * 100) / 100,
                        trade_type: 'EXIT_SELL',
                        notes: 'Exit (Dropped Rank)',
                        run_index: runIdx,
                        run_title: runTitle,
                        run_date: runDate
                    });
                }
            });

            // Trims and Buys
            currHoldings.forEach(currH => {
                const sym = currH.symbol;
                const prevH = prevMap[sym];
                const prevQ = prevH ? Number(prevH.quantity || 0) : 0;
                const currQ = Number(currH.quantity || 0);
                const price = Number(currH.current_price || currH.buy_price || 0);

                if (currQ < prevQ) {
                    const trimQty = prevQ - currQ;
                    const amt = trimQty * price;
                    trades.push({
                        symbol: sym,
                        action: 'SELL',
                        action_label: `TRIM (-${trimQty})`,
                        quantity: trimQty,
                        price: price,
                        amount: Math.round(amt * 100) / 100,
                        fee: Math.round(amt * 0.0010 * 100) / 100,
                        trade_type: 'TRIM_SELL',
                        notes: `Trim Overweight (-${trimQty} shares)`,
                        run_index: runIdx,
                        run_title: runTitle,
                        run_date: runDate
                    });
                } else if (currQ > prevQ) {
                    const buyQty = currQ - prevQ;
                    const amt = buyQty * price;
                    const isNew = !prevH || prevQ === 0;
                    trades.push({
                        symbol: sym,
                        action: 'BUY',
                        action_label: isNew ? `BUY (${currQ})` : `BUY (+${buyQty})`,
                        quantity: buyQty,
                        price: price,
                        amount: Math.round(amt * 100) / 100,
                        fee: Math.round(amt * 0.0010 * 100) / 100,
                        trade_type: isNew ? 'NEW_BUY' : 'ADD_BUY',
                        notes: isNew ? 'New Entry' : `Rebalance Addition (+${buyQty} shares)`,
                        run_index: runIdx,
                        run_title: runTitle,
                        run_date: runDate
                    });
                }
            });
        }

        return trades;
    }

    function getAllStrategyTrades(strategy) {
        if (!strategy) return [];
        const runs = strategy.runs || [];
        let all = [];
        runs.forEach(r => {
            const list = getTransactionsForRun(r, strategy);
            all = all.concat(list);
        });
        return all;
    }

    function openLogTransactionsModal(optParam) {
        if (!currentStrategy) return;
        ensureModalsAttachedToBody();

        const runs = currentStrategy.runs || [];
        if (runs.length === 0) {
            alertToast('No strategy runs or transactions recorded yet.', 'warning');
            return;
        }

        // Determine initial run index:
        // Priority: optParam (if number or logId) -> selectedRunIndex -> latest run
        let initialRunIdx = null;
        if (typeof optParam === 'number' && optParam >= 0 && optParam < runs.length) {
            initialRunIdx = optParam;
        } else if (typeof optParam === 'string' && optParam.startsWith('log_')) {
            const logs = currentStrategy.capital_logs || [];
            const log = logs.find(l => l.id === optParam);
            if (log) {
                const { run } = getLogTransactions(log, currentStrategy);
                if (run) initialRunIdx = runs.indexOf(run);
            }
        }

        if (initialRunIdx == null || initialRunIdx < 0 || initialRunIdx >= runs.length) {
            if (selectedRunIndex != null && selectedRunIndex >= 0 && selectedRunIndex < runs.length) {
                initialRunIdx = selectedRunIndex;
            } else {
                initialRunIdx = runs.length - 1;
            }
        }

        const modal = document.getElementById('walletLogTransactionsModal');
        if (!modal) return;

        // Reset search & filter
        const searchInput = document.getElementById('wltSearchInput');
        if (searchInput) searchInput.value = '';
        currentLogTradesState.filter = 'all';
        currentLogTradesState.query = '';
        ['all', 'buy', 'sell'].forEach(f => {
            const pill = document.getElementById(`wltPill${f.charAt(0).toUpperCase() + f.slice(1)}`);
            if (pill) {
                if (f === 'all') pill.classList.add('active');
                else pill.classList.remove('active');
            }
        });

        // Populate Scope Dropdown
        const scopeSelect = document.getElementById('wltScopeSelect');
        if (scopeSelect) {
            let optsHtml = `<option value="all">🌐 All Transactions (Entire History)</option>`;
            runs.forEach((r, idx) => {
                const isInit = r.run_type === 'INIT' || idx === 0;
                const title = isInit ? 'Init' : (r.title || `Rebalance #${idx}`);
                const dateStr = formatDateDisplay(r.executed_date || r.scheduled_date || '');
                optsHtml += `<option value="${idx}">${isInit ? '🚀' : '🔄'} ${title} (${dateStr})</option>`;
            });
            scopeSelect.innerHTML = optsHtml;
            // Initially select the active/selected rebalance or init milestone
            scopeSelect.value = String(initialRunIdx);
        }

        // Load trades for initial scope
        changeLogTransactionsScope(String(initialRunIdx));

        modal.style.display = 'flex';
    }

    function changeLogTransactionsScope(scopeVal) {
        if (!currentStrategy) return;
        const runs = currentStrategy.runs || [];
        let trades = [];
        let badgeText = 'Selected Run';
        let subText = '';

        if (scopeVal === 'all') {
            trades = getAllStrategyTrades(currentStrategy);
            badgeText = `All Transactions (${runs.length} Runs)`;
            subText = `${currentStrategy.name} · Complete strategy transaction history across all milestones`;
            currentLogTradesState.scope = 'all';
            currentLogTradesState.activeRunIndex = null;
        } else {
            const runIdx = parseInt(scopeVal, 10);
            const run = runs[runIdx] || runs[0];
            trades = getTransactionsForRun(run, currentStrategy);
            const isInit = run && (run.run_type === 'INIT' || runIdx === 0);
            const title = isInit ? 'Init' : (run ? run.title || `Rebalance #${runIdx}` : 'Run');
            const dateStr = run ? formatDateDisplay(run.executed_date || run.scheduled_date || '') : '';
            badgeText = `${title} (${dateStr})`;
            subText = `${currentStrategy.name} · Milestone: ${title} · Executed: ${dateStr}`;
            currentLogTradesState.scope = scopeVal;
            currentLogTradesState.activeRunIndex = runIdx;
        }

        currentLogTradesState.trades = trades;

        // Update Modal Badges & Subtitle
        const runBadge = document.getElementById('wltModalRunBadge');
        if (runBadge) {
            runBadge.innerText = badgeText;
            runBadge.style.display = 'inline-block';
        }
        const subEl = document.getElementById('wltModalSubtitle');
        if (subEl) {
            subEl.innerText = subText;
        }

        // Update KPI Cards
        const totalTrades = trades.length;
        const buyTrades = trades.filter(t => t.action === 'BUY');
        const sellTrades = trades.filter(t => t.action === 'SELL');
        const totalBuyAmt = buyTrades.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
        const totalSellAmt = sellTrades.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
        const totalCharges = trades.reduce((sum, t) => sum + (Number(t.fee) || 0), 0);

        const countEl = document.getElementById('wltSummaryTradesCount');
        if (countEl) countEl.innerText = `${totalTrades} ${totalTrades === 1 ? 'trade' : 'trades'}`;

        const breakdownEl = document.getElementById('wltSummaryTradesBreakdown');
        if (breakdownEl) breakdownEl.innerText = `${buyTrades.length} BUY · ${sellTrades.length} SELL`;

        const buyAmtEl = document.getElementById('wltSummaryBuyAmount');
        if (buyAmtEl) buyAmtEl.innerText = `₹${formatCurrency(totalBuyAmt)}`;

        const sellAmtEl = document.getElementById('wltSummarySellAmount');
        if (sellAmtEl) sellAmtEl.innerText = `₹${formatCurrency(totalSellAmt)}`;

        const chargesEl = document.getElementById('wltSummaryCharges');
        if (chargesEl) chargesEl.innerText = `₹${formatCurrency(totalCharges)}`;

        // Update Pill Counts
        const pAll = document.getElementById('wltPillCountAll');
        if (pAll) pAll.innerText = totalTrades;
        const pBuy = document.getElementById('wltPillCountBuy');
        if (pBuy) pBuy.innerText = buyTrades.length;
        const pSell = document.getElementById('wltPillCountSell');
        if (pSell) pSell.innerText = sellTrades.length;

        // Render Table & Footer
        renderLogTransactionsTable();
    }

    function closeLogTransactionsModal() {
        const modal = document.getElementById('walletLogTransactionsModal');
        if (modal) modal.style.display = 'none';
    }

    function renderLogTransactionsTable() {
        const tbody = document.getElementById('wltTransactionsTbody');
        const tfoot = document.getElementById('wltTransactionsTfoot');
        if (!tbody || !tfoot) return;

        const { trades, filter, query } = currentLogTradesState;
        let filtered = trades.slice();

        // 1. Filter by BUY / SELL
        if (filter === 'buy') {
            filtered = filtered.filter(t => t.action === 'BUY');
        } else if (filter === 'sell') {
            filtered = filtered.filter(t => t.action === 'SELL');
        }

        // 2. Filter by search query (symbol, action_label, notes, or run_title)
        if (query && query.trim()) {
            const q = query.trim().toUpperCase();
            filtered = filtered.filter(t => 
                (t.symbol || '').toUpperCase().includes(q) ||
                (t.notes || '').toUpperCase().includes(q) ||
                (t.action_label || '').toUpperCase().includes(q) ||
                (t.run_title || '').toUpperCase().includes(q)
            );
        }

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 28px; color: var(--text-secondary);">No transactions match your search/filter criteria.</td></tr>`;
            tfoot.innerHTML = '';
            return;
        }

        // Build Rows
        let rowsHtml = '';
        let totQty = 0;
        let totAmount = 0;
        let totFee = 0;
        let totBuy = 0;
        let totSell = 0;
        let buyCount = 0;
        let sellCount = 0;

        filtered.forEach((t, i) => {
            const isBuy = t.action === 'BUY';
            const isSell = t.action === 'SELL';
            const qty = Number(t.quantity || 0);
            const price = Number(t.price || 0);
            const amt = Number(t.amount || (qty * price));
            const fee = Number(t.fee || (amt * 0.0010));

            totQty += qty;
            totAmount += amt;
            totFee += fee;

            if (isBuy) {
                totBuy += amt;
                buyCount++;
            } else if (isSell) {
                totSell += amt;
                sellCount++;
            }

            const badgeBg = isBuy ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
            const badgeColor = isBuy ? '#10b981' : '#ef4444';
            const badgeBorder = isBuy ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)';
            const actionLabel = t.action_label || t.action || 'TRADE';

            rowsHtml += `
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="text-align: center; color: var(--text-secondary); font-size: 11px;">${i + 1}</td>
                    <td style="font-size: 11.5px; white-space: nowrap;">
                        <span style="font-weight: 600; color: var(--text-primary);">${escapeHtml(t.run_title || 'Run')}</span>
                        <div style="font-size: 10px; color: var(--text-secondary);">${escapeHtml(t.run_date || '')}</div>
                    </td>
                    <td>
                        <strong style="color: var(--text-primary); font-size: 12.5px; font-family: monospace;">${escapeHtml(t.symbol)}</strong>
                    </td>
                    <td style="text-align: center;">
                        <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder};">
                            ${escapeHtml(actionLabel)}
                        </span>
                    </td>
                    <td style="text-align: right; font-family: monospace; font-size: 12px; font-weight: 600;">
                        ${qty.toLocaleString('en-IN')}
                    </td>
                    <td style="text-align: right; font-family: monospace; font-size: 12px; color: var(--text-secondary);">
                        ₹${formatCurrency(price)}
                    </td>
                    <td style="text-align: right; font-family: monospace; font-size: 12px; font-weight: 700; color: ${badgeColor};">
                        ₹${formatCurrency(amt)}
                    </td>
                    <td style="text-align: right; font-family: monospace; font-size: 11.5px; color: var(--text-secondary);">
                        ₹${formatCurrency(fee)}
                    </td>
                    <td style="font-size: 11.5px; color: var(--text-secondary);">
                        ${escapeHtml(t.notes || '—')}
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = rowsHtml;

        // Table Footer with Consolidated Totals
        tfoot.innerHTML = `
            <tr style="background: var(--bg-subtle); border-top: 2px solid var(--border-color); font-weight: 700;">
                <td colspan="4" style="padding: 10px 14px;">
                    <div style="font-size: 12.5px; color: var(--text-primary); font-weight: 700;">Consolidated Totals</div>
                    <div style="font-size: 11px; font-weight: normal; color: var(--text-secondary); margin-top: 2px;">
                        ${filtered.length} ${filtered.length === 1 ? 'Trade' : 'Trades'} (${buyCount} BUY, ${sellCount} SELL)
                    </div>
                </td>
                <td style="text-align: right; font-family: monospace; font-size: 12px; font-weight: 700; padding: 10px 12px; color: var(--text-primary);">
                    ${totQty.toLocaleString('en-IN')} shares
                </td>
                <td style="text-align: right; color: var(--text-secondary); padding: 10px 12px;">—</td>
                <td style="text-align: right; font-family: monospace; padding: 10px 12px;">
                    <div style="font-size: 13px; font-weight: 700; color: var(--text-primary);">₹${formatCurrency(totAmount)}</div>
                    <div style="font-size: 10px; font-weight: normal; color: var(--text-secondary); margin-top: 2px;">
                        Buy: ₹${formatCurrency(totBuy)} · Sell: ₹${formatCurrency(totSell)}
                    </div>
                </td>
                <td style="text-align: right; font-family: monospace; font-size: 13px; color: #f59e0b; font-weight: 700; padding: 10px 12px;">
                    ₹${formatCurrency(totFee)}
                </td>
                <td style="font-size: 11px; font-weight: normal; color: var(--text-secondary); padding: 10px 14px;">
                    0.10% total transaction charges
                </td>
            </tr>
        `;
    }

    function filterLogTransactionsTable(type) {
        currentLogTradesState.filter = type;
        ['all', 'buy', 'sell'].forEach(f => {
            const pill = document.getElementById(`wltPill${f.charAt(0).toUpperCase() + f.slice(1)}`);
            if (pill) {
                if (f === type) pill.classList.add('active');
                else pill.classList.remove('active');
            }
        });
        renderLogTransactionsTable();
    }

    function handleLogTransactionsSearch() {
        const input = document.getElementById('wltSearchInput');
        currentLogTradesState.query = (input ? input.value : '') || '';
        renderLogTransactionsTable();
    }

    // =========================================================================
    // 5C. PERFORMANCE GRAPH & VALUATION DRILLDOWN ENGINE
    // Evaluates invested capital vs portfolio value with drawdown and momentum KPIs
    // =========================================================================
    let currentPerformanceGraphState = {
        strategyId: null,
        jobId: null,
        pollTimer: null,
        chartInstance: null,
        data: null,
        negTab: 'day',
        isMinimized: false,
        elapsedSeconds: 0,
        elapsedTimer: null
    };

    async function openPerformanceGraphModal(forceRefresh = false) {
        if (!currentStrategy) {
            alertToast('Please select a momentum smallcase strategy first.', 'error');
            return;
        }

        const runs = currentStrategy.runs || [];
        if (runs.length === 0) {
            alertToast('Cannot generate graph for an uninitialized smallcase. Please run Init first.', 'warning');
            return;
        }

        ensureModalsAttachedToBody();

        const modal = document.getElementById('performanceGraphModal');
        const dock = document.getElementById('mscPerformanceGraphDock');
        if (!modal) return;

        // Reset state if strategy changed
        if (currentPerformanceGraphState.strategyId !== currentStrategy.id) {
            if (currentPerformanceGraphState.pollTimer) clearInterval(currentPerformanceGraphState.pollTimer);
            if (currentPerformanceGraphState.elapsedTimer) clearInterval(currentPerformanceGraphState.elapsedTimer);
            currentPerformanceGraphState.jobId = null;
            currentPerformanceGraphState.data = null;
            currentPerformanceGraphState.strategyId = currentStrategy.id;
        }

        currentPerformanceGraphState.isMinimized = false;
        if (dock) dock.style.display = 'none';
        modal.style.display = 'flex';

        // Set Badges
        const stratBadge = document.getElementById('pgModalStratBadge');
        if (stratBadge) stratBadge.innerText = currentStrategy.name;

        const subEl = document.getElementById('pgModalSubtitle');
        if (subEl) subEl.innerText = `${currentStrategy.name} · Scheduled Day: ${currentStrategy.rebalance_day}th · Initial Capital: ₹${formatCurrency(currentStrategy.amount_to_invest)}`;

        // If we already have fresh data and not forceRefresh, render immediately
        if (!forceRefresh && currentPerformanceGraphState.data && currentPerformanceGraphState.data.strategy_id === currentStrategy.id) {
            renderPerformanceGraph(currentPerformanceGraphState.data);
            return;
        }

        // Show Loading State
        const loadingState = document.getElementById('pgLoadingState');
        const contentState = document.getElementById('pgContentState');
        const alreadyNotice = document.getElementById('pgAlreadyRunningNotice');
        if (loadingState) loadingState.style.display = 'block';
        if (contentState) contentState.style.display = 'none';
        if (alreadyNotice) alreadyNotice.style.display = 'none';

        const progressEl = document.getElementById('pgLoadingProgress');
        if (progressEl) progressEl.innerText = 'Evaluating stock prices (Priority 1: DB, Priority 2: Live Provider)...';

        // Start elapsed seconds timer
        currentPerformanceGraphState.elapsedSeconds = 0;
        if (currentPerformanceGraphState.elapsedTimer) clearInterval(currentPerformanceGraphState.elapsedTimer);
        currentPerformanceGraphState.elapsedTimer = setInterval(() => {
            currentPerformanceGraphState.elapsedSeconds++;
            const dockStatus = document.getElementById('pgDockStatus');
            if (dockStatus && currentPerformanceGraphState.isMinimized) {
                dockStatus.innerText = `⏳ Calculating... (${currentPerformanceGraphState.elapsedSeconds}s)`;
            }
        }, 1000);

        try {
            const res = await safeFetchJson(`/api/momentum-smallcases/strategies/${encodeURIComponent(currentStrategy.id)}/performance-graph`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force_refresh: forceRefresh })
            });

            if (!res.success) {
                if (progressEl) progressEl.innerText = `❌ Error: ${res.error || 'Failed to start calculation'}`;
                return;
            }

            if (res.already_running) {
                if (alreadyNotice) alreadyNotice.style.display = 'block';
                if (progressEl) progressEl.innerText = '⏳ Already calculating for smallcase. Attaching to existing background calculation...';
            }

            // If completed from cache
            if (res.status === 'COMPLETED' && res.data) {
                if (currentPerformanceGraphState.elapsedTimer) clearInterval(currentPerformanceGraphState.elapsedTimer);
                currentPerformanceGraphState.data = res.data;
                renderPerformanceGraph(res.data);
                return;
            }

            // Running in background -> Start 5-second polling loop
            currentPerformanceGraphState.jobId = res.job_id;
            startPerformanceGraphPolling();

        } catch (err) {
            console.error('Error starting performance graph:', err);
            if (progressEl) progressEl.innerText = `❌ Error: ${err.message || 'Network error'}`;
        }
    }

    function startPerformanceGraphPolling() {
        if (currentPerformanceGraphState.pollTimer) clearInterval(currentPerformanceGraphState.pollTimer);

        // Immediate first check after 1.5s then every 5000ms
        setTimeout(() => checkPerformanceGraphStatus(), 1500);

        currentPerformanceGraphState.pollTimer = setInterval(() => {
            checkPerformanceGraphStatus();
        }, 5000);
    }

    async function checkPerformanceGraphStatus() {
        const jobId = currentPerformanceGraphState.jobId;
        if (!jobId) return;

        try {
            const res = await safeFetchJson(`/api/momentum-smallcases/performance-graph/jobs/${encodeURIComponent(jobId)}`);
            if (!res.success || !res.job) return;

            const job = res.job;
            const progressEl = document.getElementById('pgLoadingProgress');

            if (job.status === 'RUNNING') {
                if (progressEl && job.progress) {
                    progressEl.innerText = job.progress;
                }
                const dockStatus = document.getElementById('pgDockStatus');
                if (dockStatus) {
                    dockStatus.innerText = `⏳ Calculating... (${currentPerformanceGraphState.elapsedSeconds}s)`;
                }
            } else if (job.status === 'COMPLETED') {
                if (currentPerformanceGraphState.pollTimer) clearInterval(currentPerformanceGraphState.pollTimer);
                if (currentPerformanceGraphState.elapsedTimer) clearInterval(currentPerformanceGraphState.elapsedTimer);

                currentPerformanceGraphState.data = job.result;

                const dockStatus = document.getElementById('pgDockStatus');
                if (dockStatus) dockStatus.innerText = '✅ Ready - View Graph';

                if (!currentPerformanceGraphState.isMinimized) {
                    renderPerformanceGraph(job.result);
                }
            } else if (job.status === 'FAILED') {
                if (currentPerformanceGraphState.pollTimer) clearInterval(currentPerformanceGraphState.pollTimer);
                if (currentPerformanceGraphState.elapsedTimer) clearInterval(currentPerformanceGraphState.elapsedTimer);

                if (progressEl) progressEl.innerText = `❌ Calculation failed: ${job.error || 'Unknown error'}`;
                const dockStatus = document.getElementById('pgDockStatus');
                if (dockStatus) dockStatus.innerText = '❌ Failed';
            }
        } catch (err) {
            console.error('Error polling performance graph status:', err);
        }
    }

    function renderPerformanceGraph(data) {
        if (!data) return;

        const loadingState = document.getElementById('pgLoadingState');
        const contentState = document.getElementById('pgContentState');
        if (loadingState) loadingState.style.display = 'none';
        if (contentState) contentState.style.display = 'block';

        const kpis = data.kpis || {};

        // 1. Badges & Headers
        const granBadge = document.getElementById('pgModalGranularityBadge');
        if (granBadge) granBadge.innerText = data.granularity_label || data.granularity;

        const subEl = document.getElementById('pgModalSubtitle');
        if (subEl) {
            subEl.innerText = `${formatDateDisplay(data.start_date)} → ${formatDateDisplay(data.end_date)} (${data.total_days} days) · ${data.points_count} valuation points`;
        }

        const dataCountEl = document.getElementById('pgChartDataCount');
        if (dataCountEl) {
            dataCountEl.innerText = `${data.points_count} data points (${data.granularity_label || data.granularity})`;
        }

        // 2. Top Summary KPI Cards
        const currValEl = document.getElementById('pgKpiCurrentVal');
        if (currValEl) currValEl.innerText = `₹${formatCurrency(kpis.current_value || 0)}`;

        const retSubEl = document.getElementById('pgKpiReturnSub');
        if (retSubEl) {
            const retAmt = kpis.total_return_amount || 0;
            const retPct = kpis.total_return_percent || 0;
            const color = retAmt >= 0 ? '#10b981' : '#ef4444';
            retSubEl.style.color = color;
            retSubEl.innerText = `${formatSignedCurrency(retAmt, true)} (${formatPercent(retPct, true)})`;
        }

        const maxDdEl = document.getElementById('pgKpiMaxDd');
        if (maxDdEl) {
            const dd = kpis.max_drawdown || {};
            maxDdEl.innerText = `${formatPercent(dd.max_drawdown_percent || 0, true)}`;
        }

        const maxDdSubEl = document.getElementById('pgKpiMaxDdSub');
        if (maxDdSubEl) {
            const dd = kpis.max_drawdown || {};
            maxDdSubEl.innerText = `Trough on ${formatDateDisplay(dd.trough_date)} (Peak: ₹${formatCurrency(dd.peak_value)})`;
        }

        // New KPI: Maximum Drilldown Below Investment Capital
        const maxBelowInvEl = document.getElementById('pgKpiMaxBelowInv');
        const maxBelowInvSubEl = document.getElementById('pgKpiMaxBelowInvSub');
        const belowInv = kpis.max_drilldown_below_investment || {};
        if (maxBelowInvEl) {
            if (belowInv.was_ever_below && belowInv.max_deficit_percent < 0) {
                maxBelowInvEl.style.color = '#ef4444';
                maxBelowInvEl.innerText = `${formatPercent(belowInv.max_deficit_percent, true)}`;
            } else {
                maxBelowInvEl.style.color = '#10b981';
                maxBelowInvEl.innerText = '0.00%';
            }
        }
        if (maxBelowInvSubEl) {
            if (belowInv.was_ever_below && belowInv.max_deficit_percent < 0) {
                maxBelowInvSubEl.innerText = `Deepest on ${formatDateDisplay(belowInv.date)} (₹${formatCurrency(belowInv.portfolio_value)} vs ₹${formatCurrency(belowInv.invested)})`;
            } else {
                maxBelowInvSubEl.innerText = 'Never dropped below investment';
            }
        }

        const topGainEl = document.getElementById('pgKpiTopGain');
        const topGainSubEl = document.getElementById('pgKpiTopGainSub');
        const topPos = kpis.top_3_positive || [];
        if (topPos.length > 0) {
            if (topGainEl) topGainEl.innerText = `+${formatPercent(topPos[0].change_percent, true)}`;
            if (topGainSubEl) topGainSubEl.innerText = `On ${formatDateDisplay(topPos[0].date)} (+₹${formatCurrency(topPos[0].change_amount)})`;
        } else {
            if (topGainEl) topGainEl.innerText = '—';
            if (topGainSubEl) topGainSubEl.innerText = 'No positive days recorded';
        }

        const cagrEl = document.getElementById('pgKpiCagr');
        if (cagrEl) cagrEl.innerText = `${formatPercent(kpis.cagr || 0, true)}`;

        const winRateSubEl = document.getElementById('pgKpiWinRateSub');
        if (winRateSubEl) {
            winRateSubEl.innerText = `Win Rate: ${formatPercent(kpis.win_rate || 0)} (${kpis.positive_days_count || 0}+ / ${kpis.negative_days_count || 0}-)`;
        }

        // 3. Negative Drilldown Drops / Below Investment Table
        renderNegativeTable();

        // 4. Top 3 Positive Momentum Days Table
        const posTbody = document.getElementById('pgTopPositiveTbody');
        if (posTbody) {
            if (topPos.length === 0) {
                posTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 14px; color: var(--text-secondary);">No positive momentum days recorded.</td></tr>`;
            } else {
                posTbody.innerHTML = topPos.map(item => `
                    <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="text-align: center; font-weight: 700; color: #10b981;">#${item.rank}</td>
                        <td style="font-weight: 600; color: var(--text-primary);">${formatDateDisplay(item.date)}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 700; color: #10b981;">+${formatPercent(item.change_percent, true)}</td>
                        <td style="text-align: right; font-family: monospace; color: #10b981;">+₹${formatCurrency(item.change_amount)}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 600; color: var(--text-primary);">₹${formatCurrency(item.portfolio_value)}</td>
                    </tr>
                `).join('');
            }
        }

        // 5. Consolidated Drawdown Breakdown
        const dd = kpis.max_drawdown || {};
        const maxDdHighlight = document.getElementById('pgMaxDdHighlight');
        if (maxDdHighlight) {
            maxDdHighlight.innerText = `${formatPercent(dd.max_drawdown_percent || 0, true)} (${formatSignedCurrency(dd.drawdown_amount || 0, true)})`;
        }

        const maxDdDetails = document.getElementById('pgMaxDdDetails');
        if (maxDdDetails) {
            maxDdDetails.innerText = `Peak: ₹${formatCurrency(dd.peak_value)} on ${formatDateDisplay(dd.peak_date)}  ➔  Trough: ₹${formatCurrency(dd.trough_value)} on ${formatDateDisplay(dd.trough_date)}`;
        }

        const maxBelowInvHighlight = document.getElementById('pgMaxBelowInvHighlight');
        const maxBelowInvDetails = document.getElementById('pgMaxBelowInvDetails');
        const belowDaysText = document.getElementById('pgBelowInvDaysText');

        if (maxBelowInvHighlight) {
            if (belowInv.was_ever_below && belowInv.max_deficit_percent < 0) {
                maxBelowInvHighlight.style.color = '#ef4444';
                maxBelowInvHighlight.innerText = `${formatPercent(belowInv.max_deficit_percent, true)} (${formatSignedCurrency(belowInv.max_deficit_amount || 0, true)})`;
            } else {
                maxBelowInvHighlight.style.color = '#10b981';
                maxBelowInvHighlight.innerText = '0.00% (₹0.00)';
            }
        }

        if (maxBelowInvDetails) {
            if (belowInv.was_ever_below && belowInv.max_deficit_percent < 0) {
                maxBelowInvDetails.innerText = `Deepest on ${formatDateDisplay(belowInv.date)} · Val: ₹${formatCurrency(belowInv.portfolio_value)} (Inv: ₹${formatCurrency(belowInv.invested)})`;
            } else {
                maxBelowInvDetails.innerText = 'Portfolio was always at or above cumulative capital';
            }
        }

        if (belowDaysText) {
            const count = belowInv.below_investment_days_count || 0;
            belowDaysText.innerText = count > 0 
                ? `Days Below Invested: ${count} days` 
                : 'Days Below Invested: 0 days (100% Above)';
        }

        const peakValText = document.getElementById('pgPeakValuationText');
        if (peakValText) {
            peakValText.innerText = `All-Time Peak: ₹${formatCurrency(kpis.peak_portfolio_value)} (${formatDateDisplay(kpis.peak_date)})`;
        }

        // 6. Dual-Line Chart.js
        renderChartJsInstance(data);
    }

    function renderNegativeTable() {
        const negTbody = document.getElementById('pgTopNegativeTbody');
        const tableTitle = document.getElementById('pgNegTableTitle');
        const colDropHeader = document.getElementById('pgNegColDropHeader');
        const colChangeHeader = document.getElementById('pgNegColChangeHeader');
        const colValHeader = document.getElementById('pgNegColValHeader');
        const btnDay = document.getElementById('pgBtnTabDayDrop');
        const btnBelow = document.getElementById('pgBtnTabBelowInv');

        if (!negTbody) return;

        const kpis = (currentPerformanceGraphState.data && currentPerformanceGraphState.data.kpis) || {};
        const isBelowInv = currentPerformanceGraphState.negTab === 'below_inv';

        if (btnDay && btnBelow) {
            if (isBelowInv) {
                btnDay.style.background = 'transparent';
                btnDay.style.color = 'var(--text-secondary)';
                btnDay.style.fontWeight = '500';
                btnBelow.style.background = 'var(--primary-color, #3b82f6)';
                btnBelow.style.color = '#fff';
                btnBelow.style.fontWeight = '600';
            } else {
                btnDay.style.background = 'var(--primary-color, #3b82f6)';
                btnDay.style.color = '#fff';
                btnDay.style.fontWeight = '600';
                btnBelow.style.background = 'transparent';
                btnBelow.style.color = 'var(--text-secondary)';
                btnBelow.style.fontWeight = '500';
            }
        }

        if (isBelowInv) {
            if (tableTitle) tableTitle.innerText = 'Top 3 Drilldowns Below Investment Capital';
            if (colDropHeader) colDropHeader.innerText = 'DEFICIT %';
            if (colChangeHeader) colChangeHeader.innerText = 'DEFICIT (₹)';
            if (colValHeader) colValHeader.innerText = 'VALUATION (vs CAPITAL)';

            const list = kpis.top_3_below_investment || [];
            if (list.length === 0) {
                negTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 14px; color: #10b981; font-weight: 500;">✨ Portfolio has never dropped below cumulative investment amount!</td></tr>`;
            } else {
                negTbody.innerHTML = list.map(item => `
                    <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="text-align: center; font-weight: 700; color: #ef4444;">#${item.rank}</td>
                        <td style="font-weight: 600; color: var(--text-primary);">${formatDateDisplay(item.date)}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 700; color: #ef4444;">${formatPercent(item.deficit_percent, true)}</td>
                        <td style="text-align: right; font-family: monospace; color: #ef4444;">${formatSignedCurrency(item.deficit_amount, true)}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 600; color: var(--text-primary);">₹${formatCurrency(item.portfolio_value)} <span style="font-size: 10.5px; color: var(--text-secondary);">(Inv: ₹${formatCurrency(item.invested)})</span></td>
                    </tr>
                `).join('');
            }
        } else {
            if (tableTitle) tableTitle.innerText = 'Maximum Top 3 Negative Drilldown %';
            if (colDropHeader) colDropHeader.innerText = 'DROP %';
            if (colChangeHeader) colChangeHeader.innerText = 'CHANGE (₹)';
            if (colValHeader) colValHeader.innerText = 'PORTFOLIO VALUE';

            const list = kpis.top_3_negative || [];
            if (list.length === 0) {
                negTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 14px; color: var(--text-secondary);">No negative drilldowns recorded.</td></tr>`;
            } else {
                negTbody.innerHTML = list.map(item => `
                    <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="text-align: center; font-weight: 700; color: #ef4444;">#${item.rank}</td>
                        <td style="font-weight: 600; color: var(--text-primary);">${formatDateDisplay(item.date)}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 700; color: #ef4444;">${formatPercent(item.change_percent, true)}</td>
                        <td style="text-align: right; font-family: monospace; color: #ef4444;">${formatSignedCurrency(item.change_amount, true)}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 600; color: var(--text-primary);">₹${formatCurrency(item.portfolio_value)}</td>
                    </tr>
                `).join('');
            }
        }
    }

    function switchPgNegativeTableTab(tabType) {
        currentPerformanceGraphState.negTab = tabType;
        renderNegativeTable();
    }

    function renderChartJsInstance(data) {
        const canvas = document.getElementById('mscPerformanceChartCanvas');
        if (!canvas || typeof Chart === 'undefined') return;

        if (currentPerformanceGraphState.chartInstance) {
            currentPerformanceGraphState.chartInstance.destroy();
            currentPerformanceGraphState.chartInstance = null;
        }

        const ctx = canvas.getContext('2d');
        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

        const labels = (data.dates || []).map(d => formatDateDisplay(d));
        const portfolioData = data.portfolio_value_series || [];
        const investedData = data.invested_series || [];
        const isDense = labels.length > 50;

        // Gradient for portfolio value
        const gradient = ctx.createLinearGradient(0, 0, 0, 350);
        gradient.addColorStop(0, 'rgba(16, 185, 129, 0.28)');
        gradient.addColorStop(1, 'rgba(16, 185, 129, 0.00)');

        currentPerformanceGraphState.chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Portfolio Value (₹)',
                        data: portfolioData,
                        borderColor: '#10b981',
                        borderWidth: 2.2,
                        backgroundColor: gradient,
                        fill: true,
                        tension: 0.2,
                        pointRadius: isDense ? 0 : 3.5,
                        pointHoverRadius: 6,
                        pointBackgroundColor: '#10b981',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 1.5
                    },
                    {
                        label: 'Invested Capital (₹)',
                        data: investedData,
                        borderColor: '#6366f1',
                        borderWidth: 1.8,
                        borderDash: [5, 4],
                        fill: false,
                        tension: 0.1,
                        pointRadius: isDense ? 0 : 2.5,
                        pointHoverRadius: 5,
                        pointBackgroundColor: '#6366f1',
                        pointBorderColor: '#ffffff'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: isDark ? 'rgba(15, 23, 42, 0.94)' : 'rgba(255, 255, 255, 0.96)',
                        titleColor: isDark ? '#ffffff' : '#0f172a',
                        bodyColor: isDark ? '#cbd5e1' : '#334155',
                        borderColor: isDark ? '#334155' : '#e2e8f0',
                        borderWidth: 1,
                        padding: 12,
                        boxPadding: 4,
                        callbacks: {
                            label: function(context) {
                                const val = Number(context.raw) || 0;
                                return `  ${context.dataset.label}: ₹${formatCurrency(val)}`;
                            },
                            afterBody: function(tooltipItems) {
                                if (!tooltipItems || tooltipItems.length === 0) return '';
                                const idx = tooltipItems[0].dataIndex;
                                const points = data.points || [];
                                const pt = points[idx];
                                if (!pt) return '';
                                const inv = pt.invested || 0;
                                const val = pt.portfolio_value || 0;
                                const pnl = val - inv;
                                const pnlPct = inv > 0 ? (pnl / inv) * 100 : 0;
                                const pnlStr = `${pnl >= 0 ? '+' : ''}₹${formatCurrency(pnl)} (${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`;
                                const dayChangeStr = pt.change_percent !== undefined ? `\n  Period Move: ${pt.change_percent >= 0 ? '+' : ''}${pt.change_percent.toFixed(2)}%` : '';
                                let drilldownStr = '';
                                if (pnl < 0) {
                                    drilldownStr = `\n  🔻 Deficit Below Capital: -₹${formatCurrency(Math.abs(pnl))} (${pnlPct.toFixed(2)}%)`;
                                }
                                return `  Net Return: ${pnlStr}${dayChangeStr}${drilldownStr}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
                            drawBorder: false
                        },
                        ticks: {
                            color: isDark ? '#94a3b8' : '#64748b',
                            font: { size: 11 },
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 12
                        }
                    },
                    y: {
                        grid: {
                            color: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
                            drawBorder: false
                        },
                        ticks: {
                            color: isDark ? '#94a3b8' : '#64748b',
                            font: { size: 11, family: 'monospace' },
                            callback: function(val) {
                                return '₹' + formatCurrency(val);
                            }
                        }
                    }
                }
            }
        });
    }

    function minimizePerformanceGraphModal() {
        currentPerformanceGraphState.isMinimized = true;
        const modal = document.getElementById('performanceGraphModal');
        const dock = document.getElementById('mscPerformanceGraphDock');
        if (modal) modal.style.display = 'none';
        if (dock) {
            dock.style.display = 'flex';
            const nameEl = document.getElementById('pgDockStratName');
            if (nameEl && currentStrategy) nameEl.innerText = `${currentStrategy.name} Graph`;
            const statusEl = document.getElementById('pgDockStatus');
            if (statusEl) {
                if (currentPerformanceGraphState.data) {
                    statusEl.innerText = '✅ Ready (Click to expand)';
                } else {
                    statusEl.innerText = `⏳ Calculating... (${currentPerformanceGraphState.elapsedSeconds}s)`;
                }
            }
        }
    }

    function restorePerformanceGraphModal() {
        currentPerformanceGraphState.isMinimized = false;
        const modal = document.getElementById('performanceGraphModal');
        const dock = document.getElementById('mscPerformanceGraphDock');
        if (dock) dock.style.display = 'none';
        if (modal) {
            modal.style.display = 'flex';
            if (currentPerformanceGraphState.data) {
                renderPerformanceGraph(currentPerformanceGraphState.data);
            }
        }
    }

    function closePerformanceGraphModal() {
        const modal = document.getElementById('performanceGraphModal');
        const dock = document.getElementById('mscPerformanceGraphDock');
        if (modal) modal.style.display = 'none';
        if (dock) dock.style.display = 'none';

        if (currentPerformanceGraphState.pollTimer) {
            clearInterval(currentPerformanceGraphState.pollTimer);
            currentPerformanceGraphState.pollTimer = null;
        }
        if (currentPerformanceGraphState.elapsedTimer) {
            clearInterval(currentPerformanceGraphState.elapsedTimer);
            currentPerformanceGraphState.elapsedTimer = null;
        }
    }

    function closePerformanceGraphDock() {
        const dock = document.getElementById('mscPerformanceGraphDock');
        if (dock) dock.style.display = 'none';
        if (currentPerformanceGraphState.pollTimer) {
            clearInterval(currentPerformanceGraphState.pollTimer);
            currentPerformanceGraphState.pollTimer = null;
        }
        if (currentPerformanceGraphState.elapsedTimer) {
            clearInterval(currentPerformanceGraphState.elapsedTimer);
            currentPerformanceGraphState.elapsedTimer = null;
        }
    }

    function refreshPerformanceGraph() {
        openPerformanceGraphModal(true);
    }

    // =========================================================================
    // 6. DELETE STRATEGY / INDEX HANDLER
    // =========================================================================
    function openDeleteStrategyModal(strategyId, optName) {
        if (!strategyId) return;
        ensureModalsAttachedToBody();
        setSmallcaseModalLoader('momentumIndexDeleteModal', false);
        const strat = (strategiesCache || []).find(x => x.id === strategyId) || (currentStrategy && currentStrategy.id === strategyId ? currentStrategy : null);
        const name = optName || (strat ? strat.name : '') || 'this smallcase';

        const idInput = document.getElementById('mIndexDeleteId');
        const typeInput = document.getElementById('mIndexDeleteType');
        const headerEl = document.getElementById('mscDeleteModalHeader');
        const nameEl = document.getElementById('mIndexDeleteName');

        if (idInput) idInput.value = strategyId;
        if (typeInput) typeInput.value = 'strategy';
        if (headerEl) headerEl.innerText = 'Delete Smallcase';
        if (nameEl) nameEl.innerText = name;

        const modal = document.getElementById('momentumIndexDeleteModal');
        if (modal) modal.style.display = 'flex';
    }

    function promptDeleteCurrentStrategy() {
        if (!currentStrategy || !currentStrategy.id) {
            alertToast('No strategy selected to delete', 'warning');
            return;
        }
        openDeleteStrategyModal(currentStrategy.id, currentStrategy.name);
    }

    function openDeleteManualIndexModal(indexId, optName) {
        if (!indexId) return;
        ensureModalsAttachedToBody();
        setSmallcaseModalLoader('momentumIndexDeleteModal', false);
        const idx = (momentumIndicesCache || []).find(x => x.id === indexId) || (currentViewingIndex && currentViewingIndex.id === indexId ? currentViewingIndex : null);
        const name = optName || (idx ? idx.name : '') || 'this index';

        const idInput = document.getElementById('mIndexDeleteId');
        const typeInput = document.getElementById('mIndexDeleteType');
        const headerEl = document.getElementById('mscDeleteModalHeader');
        const nameEl = document.getElementById('mIndexDeleteName');

        if (idInput) idInput.value = indexId;
        if (typeInput) typeInput.value = 'index';
        if (headerEl) headerEl.innerText = 'Delete Manual Index';
        if (nameEl) nameEl.innerText = name;

        const modal = document.getElementById('momentumIndexDeleteModal');
        if (modal) modal.style.display = 'flex';
    }

    function closeMomentumDeleteModal() {
        setSmallcaseModalLoader('momentumIndexDeleteModal', false);
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

        setSmallcaseModalLoader('momentumIndexDeleteModal', true, {
            title: 'Deleting Record...',
            badge: targetType === 'strategy' ? 'Momentum Smallcase' : 'Manual Index',
            subtitle: 'Permanently removing record and calculation logs...'
        });

        try {
            const baseUrl = targetType === 'strategy'
                ? `/api/momentum-smallcases/strategies/${encodeURIComponent(id)}`
                : `/api/momentum-smallcases/indices/${encodeURIComponent(id)}`;

            let data = null;
            try {
                data = await safeFetchJson(baseUrl, { method: 'DELETE' });
            } catch (delErr) {
                // Fallback to POST /delete if DELETE method is intercepted or blocked
                data = await safeFetchJson(`${baseUrl}/delete`, { method: 'POST' });
            }

            if (!data || !data.success) {
                alertToast(data?.error || 'Failed to delete record', 'error');
                return;
            }

            closeMomentumDeleteModal();
            alertToast(targetType === 'strategy' ? 'Smallcase deleted successfully' : 'Manual Index deleted successfully', 'info');

            if (targetType === 'strategy') {
                currentStrategy = null;
                if (activeSubView === 'strategy-detail') {
                    switchMomentumSubView('strategies');
                } else {
                    await loadStrategiesList();
                }
            } else {
                currentViewingIndex = null;
                await loadMomentumManualIndices();
            }
        } catch (err) {
            console.error('Error deleting target:', err);
            alertToast('Delete error: ' + err.message, 'error');
        } finally {
            setSmallcaseModalLoader('momentumIndexDeleteModal', false);
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

        if (typeof window.createBrandLoaderHTML === 'function') {
            mount.innerHTML = window.createBrandLoaderHTML({
                title: 'Loading Manual Indices...',
                badge: 'Constituent Universes',
                subtitle: 'Retrieving manual constituent lists and tracking dates...'
            });
        } else {
            mount.innerHTML = `
                <div style="text-align: center; padding: 45px 20px; color: var(--text-secondary);">
                    <span class="spinning" style="display: inline-block; font-size: 24px; margin-bottom: 8px;">⏳</span><br>
                    Loading Manual Indices...
                </div>
            `;
        }

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
                            <button type="button" class="msc-action-btn delete" onclick="openDeleteManualIndexModal('${escapeHtml(idx.id)}')" title="Delete Index">
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
        ensureModalsAttachedToBody();
        setSmallcaseModalLoader('momentumIndexFormModal', false);
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
        ensureModalsAttachedToBody();
        setSmallcaseModalLoader('momentumIndexFormModal', false);
        let idx = momentumIndicesCache.find(x => x.id === indexId);
        if (!idx) {
            try {
                const data = await safeFetchJson(`/api/momentum-smallcases/indices/${encodeURIComponent(indexId)}?enrich=0`);
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
        setSmallcaseModalLoader('momentumIndexFormModal', false);
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

    async function resolveStocksInput() {
        const textarea = document.getElementById('mIndexStocksInput');
        if (!textarea) return;
        const text = (textarea.value || '').trim();
        if (!text) {
            alertToast('Please enter stock names or symbols first', 'info');
            textarea.focus();
            return;
        }

        const resolveBtn = document.getElementById('mIndexResolveBtn');
        const origText = resolveBtn ? resolveBtn.innerHTML : '⚡ Resolve Symbols';
        if (resolveBtn) {
            resolveBtn.disabled = true;
            resolveBtn.innerHTML = '<span>⏳</span> Resolving...';
        }

        try {
            const res = await safeFetchJson('/api/momentum-smallcases/resolve-stocks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stocks: text })
            });

            if (res && res.success) {
                if (res.formatted_stocks) {
                    textarea.value = res.formatted_stocks;
                    updateLiveStocksChipsPreview(res.formatted_stocks);
                }
                const count = res.resolved_count || 0;
                if (count > 0) {
                    const sampleList = Object.entries(res.replacements || {})
                        .slice(0, 4)
                        .map(([k, v]) => `${k} → ${v}`)
                        .join(', ');
                    alertToast(`Resolved ${count} stock name(s) to NSE tickers: ${sampleList}`, 'success');
                } else {
                    alertToast(`All ${res.total_count || 0} stocks verified as valid NSE tickers!`, 'success');
                }
            } else {
                alertToast(res?.error || 'Could not resolve symbols', 'warning');
            }
        } catch (err) {
            console.error('Error resolving stock symbols:', err);
            alertToast('Error resolving stock symbols: ' + err.message, 'error');
        } finally {
            if (resolveBtn) {
                resolveBtn.disabled = false;
                resolveBtn.innerHTML = origText;
            }
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

        setSmallcaseModalLoader('momentumIndexFormModal', true, {
            title: editId ? 'Updating Manual Index...' : 'Creating Manual Index...',
            badge: 'Constituent Universe',
            subtitle: 'Validating format and registering constituent stocks...'
        });

        const url = editId ? `/api/momentum-smallcases/indices/${encodeURIComponent(editId)}` : '/api/momentum-smallcases/indices';
        const method = editId ? 'PUT' : 'POST';

        try {
            const data = await safeFetchJson(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    description: description,
                    stocks: stocks
                })
            });

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
            setSmallcaseModalLoader('momentumIndexFormModal', false);
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerText = originalText;
            }
        }
    }

    // View Manual Index Modal
    async function openViewManualIndexModal(indexId) {
        ensureModalsAttachedToBody();
        currentViewingIndex = null;
        setSmallcaseModalLoader('momentumIndexViewModal', true, {
            title: 'Loading Index Constituents...',
            badge: 'Constituent Universe',
            subtitle: 'Retrieving constituent stocks and tracking dates...'
        });
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
        if (tbody) tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 30px; color: var(--text-secondary);">⏳ Loading constituent stocks...</td></tr>`;

        try {
            const data = await safeFetchJson(`/api/momentum-smallcases/indices/${encodeURIComponent(indexId)}?enrich=0`);
            if (!data.success || !data.index) {
                if (tbody) tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #ef4444; padding: 20px;">Could not load index details.</td></tr>`;
                return;
            }

            const idx = data.index;
            currentViewingIndex = idx;

            if (nameEl) nameEl.innerText = idx.name || 'Unnamed Index';
            if (subEl) subEl.innerText = `ID: ${idx.id}`;
            if (descEl) {
                descEl.innerText = idx.description || 'No description provided for this index.';
            }

            // Strictly sort constituent stocks by date_added ascending, then symbol ascending
            const stocks = (idx.stocks || []).slice().sort((a, b) => {
                const dtA = parseDateAddedForSort(a.date_added);
                const dtB = parseDateAddedForSort(b.date_added);
                if (dtA !== dtB) return dtA - dtB;
                return (a.symbol || '').localeCompare(b.symbol || '');
            });
            idx.stocks = stocks;

            if (countEl) countEl.innerText = stocks.length;
            if (createdEl) createdEl.innerText = formatDateDisplay(idx.created_at);
            if (updatedEl) updatedEl.innerText = formatDateDisplay(idx.updated_at || idx.created_at);

            let rawStr = stocks.length > 0 ? stocks.map(s => `[${s.symbol}, ${s.date_added}]`).join(', ') : (idx.raw_stocks || '');
            if (rawEl) rawEl.innerText = rawStr || 'No constituent stocks registered.';

            if (counter) counter.innerText = `${stocks.length} ${stocks.length === 1 ? 'constituent' : 'constituents'} (ordered by Date Added ▲ ASC)`;

            if (stocks.length === 0) {
                if (tbody) tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-secondary); padding: 30px;">No stocks in this index. Click "Edit Index" to add stocks.</td></tr>`;
            } else {
                let rowsHtml = '';
                stocks.forEach((s, i) => {
                    rowsHtml += `
                        <tr>
                            <td style="color: var(--text-secondary); padding: 9px 14px; width: 45px;">${i + 1}</td>
                            <td style="padding: 9px 14px;">
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <strong style="color: var(--text-primary); font-size: 13px; cursor: pointer;" onclick="if(typeof openInHouseChart==='function') openInHouseChart('${escapeHtml(s.symbol)}');" title="Open chart for ${escapeHtml(s.symbol)}">
                                        ${escapeHtml(s.symbol)}
                                    </strong>
                                    ${s.company_name && s.company_name !== s.symbol ? `<span style="font-size: 11.5px; color: var(--text-secondary);">(${escapeHtml(s.company_name)})</span>` : ''}
                                </div>
                            </td>
                            <td style="padding: 9px 14px;">
                                <span class="badge" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #10b981; font-size: 11.5px; font-weight: 600; padding: 2px 8px; border-radius: 4px; font-family: monospace;">
                                    📅 ${escapeHtml(s.date_added)}
                                </span>
                            </td>
                        </tr>
                    `;
                });
                if (tbody) tbody.innerHTML = rowsHtml;
            }
        } catch (err) {
            console.error('Error fetching view details:', err);
            if (tbody) tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #ef4444; padding: 20px;">Failed to load details: ${escapeHtml(err.message)}</td></tr>`;
        } finally {
            setSmallcaseModalLoader('momentumIndexViewModal', false);
        }
    }

    function closeMomentumViewModal() {
        setSmallcaseModalLoader('momentumIndexViewModal', false);
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
    window.openRunAllModal = openRunAllModal;
    window.closeRunAllModal = closeRunAllModal;
    window.confirmRunAllRebalances = confirmRunAllRebalances;
    window.openEditFormulaModal = openEditFormulaModal;
    window.closeEditFormulaModal = closeEditFormulaModal;
    window.saveEditedFormula = saveEditedFormula;
    window.toggleStrategyTrimExisting = toggleStrategyTrimExisting;
    window.openDeleteStrategyModal = openDeleteStrategyModal;
    window.promptDeleteCurrentStrategy = promptDeleteCurrentStrategy;
    window.checkStratDateAndIndexMatch = checkStratDateAndIndexMatch;
    window.downloadAllRankedStocksExcel = downloadAllRankedStocksExcel;

    // Consolidated Stocks
    window.openConsolidatedStocksModal = openConsolidatedStocksModal;
    window.closeConsolidatedStocksModal = closeConsolidatedStocksModal;
    window.filterConsolidatedTable = filterConsolidatedTable;
    window.handleConsolidatedSearch = handleConsolidatedSearch;

    // Activity Log Transactions
    window.openLogTransactionsModal = openLogTransactionsModal;
    window.closeLogTransactionsModal = closeLogTransactionsModal;
    window.changeLogTransactionsScope = changeLogTransactionsScope;
    window.filterLogTransactionsTable = filterLogTransactionsTable;
    window.handleLogTransactionsSearch = handleLogTransactionsSearch;

    // Performance Graph
    window.openPerformanceGraphModal = openPerformanceGraphModal;
    window.minimizePerformanceGraphModal = minimizePerformanceGraphModal;
    window.restorePerformanceGraphModal = restorePerformanceGraphModal;
    window.closePerformanceGraphModal = closePerformanceGraphModal;
    window.closePerformanceGraphDock = closePerformanceGraphDock;
    window.refreshPerformanceGraph = refreshPerformanceGraph;
    window.switchPgNegativeTableTab = switchPgNegativeTableTab;

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
    window.resolveStocksInput = resolveStocksInput;
})();
