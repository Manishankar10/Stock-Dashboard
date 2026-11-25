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
        'performanceGraphModal',
        'strategyWithdrawalModal',
        'mscIndexComparisonModal',
        'mscFloatingDocksContainer'
    ];

    function ensureModalsAttachedToBody() {
        if (typeof document === 'undefined' || !document.body) return;
        MSC_MODAL_ELEMENT_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el && el.parentElement !== document.body) {
                document.body.appendChild(el);
            }
        });

        // Ensure floating docks stay cleanly inside mscFloatingDocksContainer
        const container = document.getElementById('mscFloatingDocksContainer');
        if (container) {
            ['mscIndexComparisonDock', 'mscPerformanceGraphDock'].forEach(dockId => {
                const dock = document.getElementById(dockId);
                if (dock && dock.parentElement !== container) {
                    container.appendChild(dock);
                }
            });
        }

        // Ensure global toast notification container stays at the very end of body (highest in stacking context)
        const toastCont = document.getElementById('appBottomToastContainer');
        if (toastCont) {
            document.body.appendChild(toastCont);
        }

        // Enforce max date on start date pickers to prevent selecting future dates
        const todayStr = new Date().toISOString().slice(0, 10);
        const sDate = document.getElementById('stratStartDateInput');
        if (sDate) sDate.max = todayStr;
        const cDate = document.getElementById('mscCompStartDate');
        if (cDate) cDate.max = todayStr;
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

    function normalizeToIsoYMD(val) {
        if (!val) return '';
        const s = String(val).trim();
        if (!s || s === '—') return '';
        // 1. YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS...
        let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) {
            const yr = parseInt(m[1], 10);
            if (yr < 1990 || yr > 2100) return '';
            return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
        }
        // 2. DD/MM/YYYY or DD-MM-YYYY
        m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (m) {
            const yr = parseInt(m[3], 10);
            if (yr < 1990 || yr > 2100) return '';
            return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        }
        // 3. DD Mon YYYY (e.g. "21 Jan 2025")
        m = s.match(/^(\d{1,2})[\s\-]([A-Za-z]{3,})[\s\-,]+(\d{4})/);
        if (m) {
            const months = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
            const monKey = m[2].substring(0, 3).toLowerCase();
            if (months[monKey]) {
                return `${m[3]}-${months[monKey]}-${m[1].padStart(2, '0')}`;
            }
        }
        // 4. General Date fallback
        try {
            const dt = new Date(s);
            if (!isNaN(dt.getTime()) && dt.getFullYear() >= 1990 && dt.getFullYear() <= 2100) {
                const y = dt.getFullYear();
                const mo = String(dt.getMonth() + 1).padStart(2, '0');
                const da = String(dt.getDate()).padStart(2, '0');
                return `${y}-${mo}-${da}`;
            }
        } catch (_) {}
        return '';
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

        const refreshBtn = document.getElementById('msc-strategies-refresh-btn');
        if (refreshBtn) {
            refreshBtn.classList.add('refreshing');
            refreshBtn.setAttribute('aria-busy', 'true');
        }

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
        } finally {
            if (refreshBtn) {
                refreshBtn.classList.remove('refreshing');
                refreshBtn.removeAttribute('aria-busy');
            }
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
            <div class="msc-table-responsive" style="overflow-x: auto;">
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
            const currVal = Number(s.current_portfolio_value != null ? s.current_portfolio_value : invested);
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
                            <button type="button" class="msc-action-btn run" onclick="openRunAllModal('${escapeHtml(s.id)}')" title="Rebalance All (Init or Remaining Schedules)" style="background: rgba(99, 102, 241, 0.12); color: #818cf8; border-color: rgba(99, 102, 241, 0.3);">
                                <span>⚡ Rebalance All</span>
                            </button>
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
            const portVal = Number(s.current_portfolio_value != null ? s.current_portfolio_value : capVal);
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
                    <button type="button" class="btn-primary" onclick="runStrategyInit('${escapeHtml(currentStrategy.id)}')" style="font-size: 13px; padding: 7px 18px; display: inline-flex; align-items: center; gap: 6px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); box-shadow: 0 2px 6px rgba(16, 185, 129, 0.35);" title="Execute initial portfolio allocation only">
                        <span>${getPlayIconSVG(12)}</span> <span>Run Init Only</span>
                    </button>
                    <button type="button" class="btn-primary" onclick="openRunAllModal('${escapeHtml(currentStrategy.id)}')" style="font-size: 13px; padding: 7px 18px; display: inline-flex; align-items: center; gap: 6px; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); box-shadow: 0 2px 6px rgba(99, 102, 241, 0.35);" title="Run Init and all scheduled monthly rebalances sequentially">
                        <span>⚡</span> <span>Rebalance All (Init + Schedules)</span>
                    </button>
                </div>
            `;
        } else {
            const todayStr = new Date().toISOString().substring(0, 10);
            const isNextRebalFuture = nextRebalDate && nextRebalDate.substring(0, 10) > todayStr;
            const hasHoldings = Array.isArray(currentStrategy?.holdings) && currentStrategy.holdings.length > 0;
            const withdrawBtnHtml = hasHoldings ? `
                <button type="button" class="btn-secondary" onclick="openStrategyWithdrawalModal()" style="font-size: 13px; padding: 7px 16px; display: inline-flex; align-items: center; gap: 6px; background: rgba(245, 158, 11, 0.12); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 6px; font-weight: 600; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(245, 158, 11, 0.2)'" onmouseout="this.style.background='rgba(245, 158, 11, 0.12)'" title="Withdraw and liquidate shares from active smallcase holdings">
                    <span>💸</span> <span>Withdraw</span>
                </button>
            ` : '';

            if (isNextRebalFuture) {
                actionBtnHtml = `
                    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                        <button type="button" class="btn-secondary" style="font-size: 13px; padding: 7px 16px; display: inline-flex; align-items: center; gap: 6px; color: #10b981; border-color: rgba(16, 185, 129, 0.4); cursor: default;" title="All scheduled rebalances up to today are completed">
                            <span>✓</span> <span>Up to Date</span>
                        </button>
                        <button type="button" class="btn-secondary" onclick="openRunRebalanceModal()" style="font-size: 13px; padding: 7px 16px; display: inline-flex; align-items: center; gap: 6px; opacity: 0.7;" title="Next scheduled rebalance on ${formatDateDisplay(nextRebalDate)} is in the future">
                            <span style="display: inline-flex; align-items: center;">${getClockIconSVG(14)}</span> <span>Next: ${formatDateDisplay(nextRebalDate)}</span>
                        </button>
                        ${withdrawBtnHtml}
                    </div>
                `;
            } else {
                actionBtnHtml = `
                    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                        <button type="button" class="btn-primary" onclick="openRunRebalanceModal()" style="font-size: 13px; padding: 7px 18px; display: inline-flex; align-items: center; gap: 6px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); box-shadow: 0 2px 6px rgba(16, 185, 129, 0.35);">
                            <span style="display: inline-flex; align-items: center;">${getRebalanceIconSVG(14, 2.5)}</span> <span>Run Next Rebalance</span>
                        </button>
                        <button type="button" class="btn-primary" onclick="openRunAllModal('${escapeHtml(currentStrategy.id)}')" style="font-size: 13px; padding: 7px 18px; display: inline-flex; align-items: center; gap: 6px; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); box-shadow: 0 2px 6px rgba(99, 102, 241, 0.35);" title="Run all remaining scheduled monthly rebalances sequentially">
                            <span>⚡</span> <span>Rebalance All Remaining</span>
                        </button>
                        ${withdrawBtnHtml}
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
                const isWithdrawal = r.run_type === 'WITHDRAWAL';
                const label = isInit ? 'Init' : (isWithdrawal ? (r.title || 'Withdrawal') : (r.title || `Rebalance #${r.run_number || idx}`));
                const execDate = formatDateDisplay(r.executed_date || r.scheduled_date);
                const holidayNote = r.is_holiday_adjusted ? ' (Adj)' : '';

                let nodeIcon = getRebalanceIconSVG(16, 2.4);
                let iconClass = 'completed';
                if (isInit) {
                    nodeIcon = getCheckIconSVG(16, 2.8);
                } else if (isWithdrawal) {
                    nodeIcon = '💸';
                    iconClass = 'completed withdrawal';
                }

                html += `
                    <div class="msc-timeline-node ${isSelected ? 'selected' : ''}" onclick="selectTimelineRun(${idx})" title="Click to view run results on ${execDate}">
                        <div class="msc-timeline-icon ${iconClass}">${nodeIcon}</div>
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
        const isWithdrawal = run.run_type === 'WITHDRAWAL';
        const runTitle = isInit ? 'Initial Run (Init)' : (isWithdrawal ? (run.title || 'Withdrawal') : (run.title || 'Rebalance Run'));
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
            <div class="msc-run-summary-banner" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px 18px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                <div class="msc-run-summary-info">
                    <div style="font-size: 16px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                        <span style="display: inline-flex; align-items: center;">${isInit ? '🎯' : (isWithdrawal ? '💸' : getRebalanceIconSVG(17, 2.4))}</span> <span>${escapeHtml(runTitle)}</span>
                    </div>
                    <div style="font-size: 12.5px; color: var(--text-secondary); margin-top: 4px;">
                        ${dateNote} ${isWithdrawal ? `&bull; Withdrawn: <strong style="color: #3b82f6;">₹${formatCurrency(run.total_withdrawn_amount || 0)}</strong> &bull; Realized P&L: <strong style="color: ${(run.total_withdrawn_pnl || 0) >= 0 ? '#10b981' : '#ef4444'};">${(run.total_withdrawn_pnl || 0) >= 0 ? '+' : ''}₹${formatCurrency(run.total_withdrawn_pnl || 0)}</strong>` : `&bull; Universe eligible stocks: <strong>${run.eligible_stocks_count || rankedStocks.length}</strong> &bull; Trim Overweight: <strong>${(currentStrategy && currentStrategy.trim_existing === false) ? 'No' : 'Yes'}</strong> &bull; Days/Mo: <strong>${(currentStrategy && currentStrategy.trading_days_per_month) || 30}d</strong>`}
                    </div>
                </div>
                <div class="msc-run-summary-metrics" style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
                    <span style="font-size: 12px; color: var(--text-secondary);">
                        Snapshot Value: <strong style="color: ${snapColor}; font-family: monospace;">₹${formatCurrency(snapVal)}</strong>
                        <span style="font-size: 11px; font-weight: 600; color: ${snapColor}; margin-left: 3px;">(${formatSignedCurrency(snapPnl, true)} / ${formatPercent(snapPnlPct, true)})</span>
                    </span>
                    <span style="font-size: 12px; color: var(--text-secondary);">
                        Cash in Wallet: <strong style="color: var(--text-primary); font-family: monospace;">₹${formatCurrency(portfolio.wallet_balance || 0)}</strong>
                    </span>
                </div>
            </div>`;

        if (isWithdrawal) {
            html += `
                <!-- Withdrawn Stocks Detail Box -->
                <div class="msc-card-section" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 18px; margin-bottom: 22px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
                        <div>
                            <h4 style="margin: 0; font-size: 14.5px; font-weight: 700; color: #f59e0b; display: flex; align-items: center; gap: 6px;">
                                <span>💸</span> <span>Liquidated Positions (${(run.transactions || []).length} stocks)</span>
                            </h4>
                            <div style="font-size: 11.5px; color: var(--text-secondary); margin-top: 3px;">
                                Capital proceeds withdrawn from smallcase portfolio at CMP.
                            </div>
                        </div>
                        <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 12px;">
                            <span style="color: var(--text-secondary);">Withdrawn: <strong style="color: #3b82f6; font-family: monospace;">₹${formatCurrency(run.total_withdrawn_amount || 0)}</strong></span>
                            <span style="color: var(--text-secondary);">Realized P&L: <strong style="color: ${(run.total_withdrawn_pnl || 0) >= 0 ? '#10b981' : '#ef4444'}; font-family: monospace;">${(run.total_withdrawn_pnl || 0) >= 0 ? '+' : ''}₹${formatCurrency(run.total_withdrawn_pnl || 0)}</strong></span>
                            <span style="color: var(--text-secondary);">Fees: <strong style="color: var(--text-primary); font-family: monospace;">₹${formatCurrency(run.fees_paid || 0)}</strong></span>
                        </div>
                    </div>
                    ${run.comments ? `<div style="font-size: 12px; color: var(--text-secondary); background: rgba(255, 255, 255, 0.03); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); margin-bottom: 14px;"><strong>Comments:</strong> ${escapeHtml(run.comments)}</div>` : ''}
                    <div style="overflow-x: auto;">
                        <table class="table msc-indices-table" style="width: 100%; border-collapse: collapse; font-size: 12px;">
                            <thead>
                                <tr style="background: var(--bg-subtle); border-bottom: 1px solid var(--border-color); color: var(--text-secondary); font-size: 11px;">
                                    <th style="padding: 9px 12px;">STOCK</th>
                                    <th style="padding: 9px 12px; text-align: right;">WITHDRAWN QTY</th>
                                    <th style="padding: 9px 12px; text-align: right;">BUY PRICE</th>
                                    <th style="padding: 9px 12px; text-align: right;">SELL CMP</th>
                                    <th style="padding: 9px 12px; text-align: right;">PROCEEDS</th>
                                    <th style="padding: 9px 12px; text-align: right;">REALIZED P&L</th>
                                    <th style="padding: 9px 12px; text-align: right;">CHARGES</th>
                                    <th style="padding: 9px 12px;">COMMENTS</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(run.transactions || []).map(tx => {
                                    const txPnl = Number(tx.pnl || 0);
                                    const txPos = txPnl >= 0;
                                    return `
                                        <tr style="border-bottom: 1px solid var(--border-color);">
                                            <td style="padding: 9px 12px;">
                                                <strong style="color: var(--text-primary);">${escapeHtml(tx.symbol)}</strong>
                                                ${tx.company_name && tx.company_name !== tx.symbol ? `<div style="font-size: 11px; color: var(--text-secondary);">${escapeHtml(tx.company_name)}</div>` : ''}
                                            </td>
                                            <td style="padding: 9px 12px; text-align: right; font-family: monospace; font-weight: 600;">${tx.quantity}</td>
                                            <td style="padding: 9px 12px; text-align: right; font-family: monospace; color: var(--text-secondary);">₹${formatCurrency(tx.buy_price)}</td>
                                            <td style="padding: 9px 12px; text-align: right; font-family: monospace; font-weight: 600; color: var(--text-primary);">₹${formatCurrency(tx.price)}</td>
                                            <td style="padding: 9px 12px; text-align: right; font-family: monospace; font-weight: 700; color: #3b82f6;">₹${formatCurrency(tx.amount)}</td>
                                            <td style="padding: 9px 12px; text-align: right; font-family: monospace; font-weight: 700; color: ${txPos ? '#10b981' : '#ef4444'};">
                                                ${txPos ? '+' : ''}₹${formatCurrency(txPnl)} (${txPos ? '+' : ''}${Number(tx.pnl_percent || 0).toFixed(2)}%)
                                            </td>
                                            <td style="padding: 9px 12px; text-align: right; font-family: monospace; color: var(--text-secondary);">₹${formatCurrency(tx.fee || 0)}</td>
                                            <td style="padding: 9px 12px; font-size: 11.5px; color: var(--text-secondary);">${escapeHtml(tx.comments || tx.notes || '—')}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } else {
            html += `
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
            <div class="msc-card-section" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 18px; margin-bottom: 22px;">
                <div class="msc-section-header msc-ranked-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
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
                    <div style="display: inline-flex; align-items: center; gap: 6px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 6px; padding: 2px 4px;">
                        <select id="mscRankedExportScope" style="font-size: 11px; font-weight: 700; background: var(--bg-card); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 4px; padding: 3px 6px; cursor: pointer; outline: none;" title="Choose whether to download the Current run or All runs as separate tabs">
                            <option value="current" selected>Current</option>
                            <option value="all">All</option>
                        </select>
                        <button type="button" class="btn-secondary msc-header-btn" onclick="downloadAllRankedStocksExcel()" style="display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; padding: 5px 12px; font-weight: 600; border-radius: 4px; background: #3b82f6; color: #ffffff; border: none; cursor: pointer; transition: all 0.15s ease;" title="Download Excel covering ranked stocks (.xlsx)">
                            <span>📥</span> <span>Download Ranked Stocks (.xlsx)</span>
                        </button>
                    </div>
                </div>

                <div class="msc-table-responsive" style="overflow-x: auto; max-height: 480px;">
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
        `;
        }

        html += `
            <!-- Current Portfolio Holdings Snapshot Table -->
            <div class="msc-card-section" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 18px; margin-bottom: 22px;">
                <div class="msc-section-header msc-holdings-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
                    <h4 style="margin: 0; font-size: 14.5px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                        <span>💼</span> <span>Portfolio Holdings Snapshot (${holdings.length} stocks)</span>
                    </h4>
                    <div class="msc-holdings-header-actions" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <button type="button" class="btn-secondary msc-header-btn" onclick="openPerformanceGraphModal()" style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 6px 14px; font-weight: 600; border-radius: 6px; background: rgba(59, 130, 246, 0.12); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.35); cursor: pointer; transition: all 0.15s ease;" onmouseover="this.style.background='rgba(59, 130, 246, 0.22)'" onmouseout="this.style.background='rgba(59, 130, 246, 0.12)'" title="View historical performance line graph of invested capital vs portfolio value with drawdowns and momentum KPIs">
                            <span>📈</span> <span>Performance Graph</span>
                        </button>
                        <button type="button" class="btn-secondary msc-header-btn" onclick="openConsolidatedStocksModal()" style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 6px 14px; font-weight: 600; border-radius: 6px; background: rgba(16, 185, 129, 0.12); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35); cursor: pointer; transition: all 0.15s ease;" onmouseover="this.style.background='rgba(16, 185, 129, 0.22)'" onmouseout="this.style.background='rgba(16, 185, 129, 0.12)'" title="View all participated stocks history with holding durations and consolidated P&amp;L">
                            <span>📊</span> <span>Consolidated Stocks</span>
                        </button>
                    </div>
                </div>
                <div class="msc-table-responsive" style="overflow-x: auto;">
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
                const capBase = Number(portfolio.total_capital != null ? portfolio.total_capital : (portfolio.invested_value || (currentStrategy && currentStrategy.amount_to_invest) || 1));
                const weightDisplay = h.weight_percent != null
                    ? `${Number(h.weight_percent).toFixed(1)}%`
                    : (capBase > 0 ? `${((h.invested / capBase) * 100).toFixed(1)}%` : '—');

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
        if (!isInit && !isWithdrawal) {
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
                <div class="msc-card-section" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 18px; margin-bottom: 22px;">
                    <div class="msc-section-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
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
                    <div class="msc-table-responsive" style="overflow-x: auto;">
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
            <div class="msc-card-section" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 18px;">
                <div class="msc-section-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
                    <h4 style="margin: 0; font-size: 14.5px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                        <span>📜</span> <span>Capital &amp; Wallet Activity Logs</span>
                    </h4>
                    <button type="button" class="btn-sm btn-secondary msc-header-btn" onclick="openLogTransactionsModal()" style="padding: 5px 12px; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; border-radius: 6px; font-weight: 600; cursor: pointer; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" title="View all stock buy and sell execution details">
                        <span>📋</span> <span>Transactions</span>
                    </button>
                </div>
                <div class="msc-table-responsive" style="overflow-x: auto; max-height: 240px;">
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

        const effectiveCutoff = cutoffVal || todayStr;
        let isDraft = currentStrategy.status === 'DRAFT' || !currentStrategy.runs || currentStrategy.runs.length === 0;
        const nextRebalStr = (currentStrategy.next_rebalance_date || '').substring(0, 10);
        if (!isDraft && nextRebalStr && nextRebalStr > effectiveCutoff) {
            alertToast(`Cannot execute rebalance for future date (${formatDateDisplay(nextRebalStr)}). Smallcase is already up to date up to ${formatDateDisplay(effectiveCutoff)}.`, 'info');
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
            title: 'Starting Rebalance All (One-by-One Engine)...',
            badge: 'Safe Sequential Runner',
            subtitle: 'Preparing sequential schedule execution...'
        });

        let initExecuted = false;
        let rebalancesExecuted = 0;
        let strat = currentStrategy;

        try {
            // STEP 1: Execute Init if DRAFT
            if (strat.status === 'DRAFT' || !strat.runs || strat.runs.length === 0) {
                const startStr = (strat.start_date || '').substring(0, 10);
                if (startStr > effectiveCutoff) {
                    throw new Error(`Start date (${formatDateDisplay(startStr)}) is after cutoff date (${formatDateDisplay(effectiveCutoff)}). Cannot run Init.`);
                }

                setSmallcaseModalLoader('runAllRebalanceModal', true, {
                    title: 'Executing Initial Portfolio Allocation (Init)...',
                    badge: 'Step 1 of Rebalance All',
                    subtitle: `Allocating initial capital ₹${formatCurrency(strat.amount_to_invest)} on ${formatDateDisplay(strat.start_date)}...`
                });

                const initData = await safeFetchJson(`/api/momentum-smallcases/strategies/${encodeURIComponent(strat.id)}/run-init?sync=1`, {
                    method: 'POST'
                });

                if (!initData || !initData.success) {
                    throw new Error((initData && initData.error) || 'Failed to execute Init');
                }

                strat = initData.strategy || strat;
                currentStrategy = strat;
                initExecuted = true;
            }

            // STEP 2: Sequentially execute pending monthly rebalance schedules one by one
            const maxSchedules = 150; // Guard against infinite loop (12+ years)
            let lastProcessedDate = null;

            while (rebalancesExecuted < maxSchedules) {
                const schedRebalStr = (strat.next_rebalance_date || '').substring(0, 10);
                if (!schedRebalStr) break;
                if (schedRebalStr > effectiveCutoff) {
                    // Reached beyond cutoff date or today
                    break;
                }
                if (lastProcessedDate && schedRebalStr <= lastProcessedDate) {
                    console.warn(`Rebalance date did not advance: ${schedRebalStr} <= ${lastProcessedDate}`);
                    break;
                }

                const schedNum = rebalancesExecuted + 1;
                setSmallcaseModalLoader('runAllRebalanceModal', true, {
                    title: `Executing Rebalance #${schedNum}...`,
                    badge: `Schedule ${schedNum}`,
                    subtitle: `Running rebalance for ${formatDateDisplay(schedRebalStr)}${stepupVal > 0 ? ' with step-up ₹' + formatCurrency(stepupVal) : ''}...`
                });

                const rebalData = await safeFetchJson(`/api/momentum-smallcases/strategies/${encodeURIComponent(strat.id)}/run-rebalance?sync=1`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        stepup_amount: stepupVal,
                        trim_existing: trimVal
                    })
                });

                if (!rebalData || !rebalData.success) {
                    throw new Error((rebalData && rebalData.error) || `Failed during rebalance execution on ${formatDateDisplay(schedRebalStr)}`);
                }

                strat = rebalData.strategy || strat;
                currentStrategy = strat;
                lastProcessedDate = schedRebalStr;
                rebalancesExecuted++;
            }

            const totalRuns = (initExecuted ? 1 : 0) + rebalancesExecuted;
            closeRunAllModal();

            if (totalRuns === 0) {
                alertToast(`No rebalance schedules due before ${formatDateDisplay(effectiveCutoff)}. Smallcase is already up to date.`, 'info');
            } else {
                const parts = [];
                if (initExecuted) parts.push('Init');
                if (rebalancesExecuted > 0) parts.push(`${rebalancesExecuted} rebalance(s)`);
                alertToast(`Rebalance All completed successfully! Executed ${parts.join(' + ')}.`, 'success');
            }

            // Refresh view and select latest run
            selectedRunIndex = null;
            await openStrategyDetailView(currentStrategy.id);
            await loadStrategiesList();
        } catch (err) {
            console.error('Error running all rebalances one-by-one:', err);
            const partialDone = [];
            if (initExecuted) partialDone.push('Init');
            if (rebalancesExecuted > 0) partialDone.push(`${rebalancesExecuted} rebalance(s)`);
            const statusSummary = partialDone.length > 0 ? ` (Saved so far: ${partialDone.join(' + ')})` : '';
            alertToast(`Rebalance All stopped: ${err.message}${statusSummary}`, 'error');

            if (currentStrategy && currentStrategy.id) {
                selectedRunIndex = null;
                await openStrategyDetailView(currentStrategy.id);
                await loadStrategiesList();
            }
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
    // 4D. STRATEGY WITHDRAWAL POPUP & LOGIC
    // =========================================================================
    function openStrategyWithdrawalModal() {
        if (!currentStrategy) {
            alertToast('No active smallcase selected.', 'error');
            return;
        }
        ensureModalsAttachedToBody();

        const holdings = currentStrategy.holdings || [];
        if (holdings.length === 0) {
            alertToast('Current smallcase has no active holdings to withdraw.', 'error');
            return;
        }

        const badgeEl = document.getElementById('mscWithdrawalStratBadge');
        if (badgeEl) badgeEl.innerText = currentStrategy.name || 'Smallcase';

        const capVal = Number(currentStrategy.total_capital != null ? currentStrategy.total_capital : (currentStrategy.amount_to_invest || 0));
        const portVal = Number(currentStrategy.current_portfolio_value != null ? currentStrategy.current_portfolio_value : capVal);
        const capEl = document.getElementById('mscWithdrawCurrentCap');
        if (capEl) capEl.innerText = `₹${formatCurrency(capVal)}`;
        const portEl = document.getElementById('mscWithdrawPortfolioVal');
        if (portEl) {
            portEl.innerText = `₹${formatCurrency(portVal)}`;
            portEl.style.color = portVal >= capVal ? '#10b981' : '#ef4444';
        }

        const commentsInput = document.getElementById('mscWithdrawalComments');
        if (commentsInput) commentsInput.value = '';

        const submitBtn = document.getElementById('mscSubmitWithdrawalBtn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span>💸</span> <span>Confirm Withdrawal</span>';
        }

        const tbody = document.getElementById('mscWithdrawalTbody');
        if (!tbody) return;

        tbody.innerHTML = holdings.map((h, idx) => {
            const sym = h.symbol || 'STOCK';
            const company = h.company_name || sym;
            const qty = Number(h.quantity || 0);
            const buyPrice = Number(h.buy_price || 0);
            const cmp = Number(h.current_price || buyPrice);
            const pnl = Number(h.pnl != null ? h.pnl : ((cmp - buyPrice) * qty));
            const pnlPct = Number(h.pnl_percent != null ? h.pnl_percent : (buyPrice > 0 ? ((cmp - buyPrice) / buyPrice * 100) : 0));
            const pnlColor = pnl >= 0 ? '#10b981' : '#ef4444';
            const sign = pnl >= 0 ? '+' : '';

            return `
                <tr data-index="${idx}" data-symbol="${escapeHtml(sym)}" data-max-qty="${qty}" data-buy-price="${buyPrice}" data-cmp="${cmp}">
                    <td style="text-align: center; color: var(--text-secondary); font-size: 11px;">${idx + 1}</td>
                    <td>
                        <strong style="color: var(--text-primary); font-family: monospace; font-size: 12.5px;">${escapeHtml(sym)}</strong>
                        ${company && company !== sym ? `<div style="font-size: 11px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;">${escapeHtml(company)}</div>` : ''}
                    </td>
                    <td style="text-align: right; font-family: monospace;">
                        <div style="font-weight: 700; color: var(--text-primary);">${qty.toLocaleString('en-IN')}</div>
                        <div style="font-size: 10.5px; color: var(--text-secondary);">Avg: ₹${formatCurrency(buyPrice)}</div>
                    </td>
                    <td style="text-align: right; font-family: monospace; font-weight: 700; color: var(--text-primary);">
                        ₹${formatCurrency(cmp)}
                    </td>
                    <td style="text-align: right; font-family: monospace; font-weight: 700; color: ${pnlColor};">
                        <div>${sign}₹${formatCurrency(pnl)}</div>
                        <div style="font-size: 10.5px; font-weight: 600;">${sign}${pnlPct.toFixed(2)}%</div>
                    </td>
                    <td style="text-align: center;">
                        <div style="display: inline-flex; align-items: center; justify-content: center; gap: 5px;">
                            <input type="number" min="0" max="${qty}" step="1" value="0" class="msc-modal-input msc-withdraw-qty-input" data-index="${idx}" oninput="updateWithdrawalSummary()" onchange="updateWithdrawalSummary()" style="width: 78px; padding: 5px 8px; font-family: monospace; font-size: 12px; text-align: right;">
                            <button type="button" class="btn-secondary" onclick="setWithdrawalMax(${idx}, ${qty})" style="padding: 4px 8px; font-size: 10.5px; font-weight: 600; border-radius: 4px; cursor: pointer;" title="Withdraw all ${qty} shares of ${escapeHtml(sym)}">Max</button>
                        </div>
                    </td>
                    <td style="text-align: right; font-family: monospace;">
                        <div id="mscWithdrawVal_${idx}" style="font-weight: 700; color: var(--text-primary);">₹0.00</div>
                        <div id="mscWithdrawPnl_${idx}" style="font-size: 10.5px; font-weight: 600; color: var(--text-secondary);">₹0.00 (0.00%)</div>
                    </td>
                    <td>
                        <input type="text" class="msc-modal-input msc-withdraw-comment-input" data-index="${idx}" placeholder="Stock note / comment..." style="width: 100%; min-width: 145px; padding: 5px 8px; font-size: 11.5px;">
                    </td>
                </tr>
            `;
        }).join('');

        updateWithdrawalSummary();
        const modal = document.getElementById('strategyWithdrawalModal');
        if (modal) modal.style.display = 'flex';
    }

    function closeStrategyWithdrawalModal() {
        const modal = document.getElementById('strategyWithdrawalModal');
        if (modal) modal.style.display = 'none';
    }

    function setWithdrawalMax(idx, maxQty) {
        const input = document.querySelector(`.msc-withdraw-qty-input[data-index="${idx}"]`);
        if (input) {
            input.value = maxQty;
            updateWithdrawalSummary();
        }
    }

    function withdrawAllHoldingsMax() {
        const rows = document.querySelectorAll('#mscWithdrawalTbody tr');
        rows.forEach(tr => {
            const maxQty = parseInt(tr.getAttribute('data-max-qty'), 10) || 0;
            const input = tr.querySelector('.msc-withdraw-qty-input');
            if (input) input.value = maxQty;
        });
        updateWithdrawalSummary();
    }

    function resetWithdrawalInputs() {
        const rows = document.querySelectorAll('#mscWithdrawalTbody tr');
        rows.forEach(tr => {
            const qtyIn = tr.querySelector('.msc-withdraw-qty-input');
            const cmtIn = tr.querySelector('.msc-withdraw-comment-input');
            if (qtyIn) qtyIn.value = '0';
            if (cmtIn) cmtIn.value = '';
        });
        const genCmt = document.getElementById('mscWithdrawalComments');
        if (genCmt) genCmt.value = '';
        updateWithdrawalSummary();
    }

    function updateWithdrawalSummary() {
        const rows = document.querySelectorAll('#mscWithdrawalTbody tr');
        let totalStocks = 0;
        let totalShares = 0;
        let totalAmount = 0.0;
        let totalCost = 0.0;
        let totalPnl = 0.0;

        rows.forEach(tr => {
            const idx = tr.getAttribute('data-index');
            const maxQty = parseInt(tr.getAttribute('data-max-qty'), 10) || 0;
            const buyPrice = parseFloat(tr.getAttribute('data-buy-price')) || 0;
            const cmp = parseFloat(tr.getAttribute('data-cmp')) || buyPrice;
            const input = tr.querySelector('.msc-withdraw-qty-input');
            const valSpan = document.getElementById(`mscWithdrawVal_${idx}`);
            const pnlSpan = document.getElementById(`mscWithdrawPnl_${idx}`);

            let reqQty = parseInt(input?.value, 10);
            if (isNaN(reqQty) || reqQty < 0) reqQty = 0;
            if (reqQty > maxQty) {
                reqQty = maxQty;
                if (input) input.value = maxQty;
            }

            const rowVal = reqQty * cmp;
            const rowCost = reqQty * buyPrice;
            const rowPnl = rowVal - rowCost;
            const rowPnlPct = rowCost > 0 ? (rowPnl / rowCost * 100) : 0;

            if (valSpan) {
                valSpan.innerText = reqQty > 0 ? `₹${formatCurrency(rowVal)}` : '₹0.00';
                valSpan.style.color = reqQty > 0 ? '#3b82f6' : 'var(--text-primary)';
            }
            if (pnlSpan) {
                if (reqQty > 0) {
                    const isPos = rowPnl >= 0;
                    const sign = isPos ? '+' : '';
                    pnlSpan.innerText = `${sign}₹${formatCurrency(rowPnl)} (${sign}${rowPnlPct.toFixed(2)}%)`;
                    pnlSpan.style.color = isPos ? '#10b981' : '#ef4444';
                } else {
                    pnlSpan.innerText = '₹0.00 (0.00%)';
                    pnlSpan.style.color = 'var(--text-secondary)';
                }
            }

            if (reqQty > 0) {
                totalStocks += 1;
                totalShares += reqQty;
                totalAmount += rowVal;
                totalCost += rowCost;
                totalPnl += rowPnl;
            }
        });

        const totalFee = Math.round(totalAmount * 0.0010 * 100) / 100;
        const stocksEl = document.getElementById('mscWithdrawTotalStocks');
        const sharesEl = document.getElementById('mscWithdrawTotalShares');
        const amountEl = document.getElementById('mscWithdrawTotalAmount');
        const feeEl = document.getElementById('mscWithdrawTotalFee');
        const pnlEl = document.getElementById('mscWithdrawTotalPnl');
        const submitBtn = document.getElementById('mscSubmitWithdrawalBtn');

        if (stocksEl) stocksEl.innerText = `${totalStocks} ${totalStocks === 1 ? 'stock' : 'stocks'}`;
        if (sharesEl) sharesEl.innerText = totalShares.toLocaleString('en-IN');
        if (amountEl) amountEl.innerText = `₹${formatCurrency(totalAmount)}`;
        if (feeEl) feeEl.innerText = `₹${formatCurrency(totalFee)}`;
        if (pnlEl) {
            const isPos = totalPnl >= 0;
            const sign = isPos ? '+' : '';
            const pnlPct = totalCost > 0 ? (totalPnl / totalCost * 100) : 0;
            pnlEl.innerText = totalShares > 0
                ? `${sign}₹${formatCurrency(totalPnl)} (${sign}${pnlPct.toFixed(2)}%)`
                : '₹0.00 (0.00%)';
            pnlEl.style.color = totalShares > 0 ? (isPos ? '#10b981' : '#ef4444') : 'var(--text-secondary)';
        }

        if (submitBtn) {
            submitBtn.disabled = totalShares === 0;
        }
    }

    async function submitStrategyWithdrawal() {
        if (!currentStrategy || isSubmitting) return;

        const batchComments = (document.getElementById('mscWithdrawalComments')?.value || '').trim();
        const rows = document.querySelectorAll('#mscWithdrawalTbody tr');
        const withdrawals = [];

        rows.forEach(tr => {
            const sym = tr.getAttribute('data-symbol');
            const maxQty = parseInt(tr.getAttribute('data-max-qty'), 10) || 0;
            const cmp = parseFloat(tr.getAttribute('data-cmp')) || 0;
            const qtyInput = tr.querySelector('.msc-withdraw-qty-input');
            const commentInput = tr.querySelector('.msc-withdraw-comment-input');
            const reqQty = parseInt(qtyInput?.value, 10) || 0;
            const rowComment = (commentInput?.value || '').trim() || batchComments;

            if (reqQty > 0 && reqQty <= maxQty) {
                withdrawals.push({
                    symbol: sym,
                    quantity: reqQty,
                    price: cmp,
                    comments: rowComment
                });
            }
        });

        if (withdrawals.length === 0) {
            alertToast('Please enter a quantity greater than 0 for at least one stock.', 'warning');
            return;
        }

        const submitBtn = document.getElementById('mscSubmitWithdrawalBtn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span>⏳</span> <span>Executing Withdrawal...</span>';
        }
        isSubmitting = true;

        showSmallcaseGlobalLoader({
            title: 'Processing Withdrawal...',
            badge: 'Portfolio Liquidation',
            subtitle: `Liquidating ${withdrawals.length} position(s) and updating smallcase capital & transactions...`
        });

        try {
            const res = await fetch(`/api/momentum-smallcases/strategies/${encodeURIComponent(currentStrategy.id)}/withdraw`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    withdrawals: withdrawals,
                    comments: batchComments
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to execute withdrawal.');
            }

            closeStrategyWithdrawalModal();
            alertToast(data.message || `Withdrawn ₹${formatCurrency(data.withdrawn_amount || 0)} successfully!`, 'success');

            currentStrategy = data.strategy || currentStrategy;
            const runsLen = (currentStrategy.runs || []).length;
            const targetRunIdx = runsLen > 0 ? runsLen - 1 : null;
            selectedRunIndex = targetRunIdx;
            await openStrategyDetailView(currentStrategy.id, targetRunIdx);
            await loadStrategiesList();
        } catch (e) {
            console.error('Withdrawal error:', e);
            alertToast(`Withdrawal Error: ${e.message}`, 'error');
        } finally {
            isSubmitting = false;
            hideSmallcaseGlobalLoader();
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<span>💸</span> <span>Confirm Withdrawal</span>';
            }
            updateWithdrawalSummary();
        }
    }

    window.openStrategyWithdrawalModal = openStrategyWithdrawalModal;
    window.closeStrategyWithdrawalModal = closeStrategyWithdrawalModal;
    window.setWithdrawalMax = setWithdrawalMax;
    window.withdrawAllHoldingsMax = withdrawAllHoldingsMax;
    window.resetWithdrawalInputs = resetWithdrawalInputs;
    window.updateWithdrawalSummary = updateWithdrawalSummary;
    window.submitStrategyWithdrawal = submitStrategyWithdrawal;

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
    // 5a. EXCEL EXPORT FOR ALL / CURRENT RANKED STOCKS
    // =========================================================================
    function downloadAllRankedStocksExcel() {
        if (!currentStrategy) {
            alertToast('Please select a momentum smallcase strategy first.', 'error');
            return;
        }

        const runIdx = (selectedRunIndex != null) ? selectedRunIndex : (currentStrategy.runs ? currentStrategy.runs.length - 1 : 0);
        const scopeSelect = document.getElementById('mscRankedExportScope');
        const scope = (scopeSelect ? scopeSelect.value : 'current') || 'current';
        const url = `/api/momentum-smallcases/strategies/${encodeURIComponent(currentStrategy.id)}/runs/${encodeURIComponent(runIdx)}/export-ranked-excel?scope=${encodeURIComponent(scope)}`;

        alertToast(scope === 'all' ? 'Downloading Excel workbook for all runs (separate tabs)...' : 'Downloading Excel workbook for current run...', 'info');
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
        query: '',
        fromDate: null,
        toDate: null,
        scope: 'all'
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
        const runIsoDate = normalizeToIsoYMD(run.executed_date || run.scheduled_date || '');
        const runDate = formatDateDisplay(run.executed_date || run.scheduled_date || '');
        const isInit = run.run_type === 'INIT' || runIdx === 0;
        const isWithdraw = run.run_type === 'WITHDRAWAL';
        const runTitle = isInit ? 'Init' : (run.title || (isWithdraw ? 'Withdrawal' : `Rebalance #${runIdx}`));

        // 1. Check if pre-calculated transactions exist
        if (snapshot.transactions && Array.isArray(snapshot.transactions) && snapshot.transactions.length > 0) {
            return snapshot.transactions.map(t => {
                let pnl = t.pnl;
                let pnlPct = t.pnl_percent;
                if (pnl == null && t.action === 'SELL') {
                    const price = Number(t.price || 0);
                    const qty = Number(t.quantity || 0);
                    const buyP = Number(t.buy_price || t.average_price || 0);
                    if (buyP > 0) {
                        pnl = (price - buyP) * qty;
                        pnlPct = ((price - buyP) / buyP) * 100;
                    }
                }
                return {
                    ...t,
                    pnl: pnl != null ? Math.round(Number(pnl) * 100) / 100 : null,
                    pnl_percent: pnlPct != null ? Math.round(Number(pnlPct) * 100) / 100 : null,
                    run_index: runIdx,
                    run_title: t.run_title || runTitle,
                    run_date: runDate,
                    run_iso_date: runIsoDate
                };
            });
        }
        if (run.transactions && Array.isArray(run.transactions) && run.transactions.length > 0) {
            return run.transactions.map(t => {
                let pnl = t.pnl;
                let pnlPct = t.pnl_percent;
                if (pnl == null && t.action === 'SELL') {
                    const price = Number(t.price || 0);
                    const qty = Number(t.quantity || 0);
                    const buyP = Number(t.buy_price || t.average_price || 0);
                    if (buyP > 0) {
                        pnl = (price - buyP) * qty;
                        pnlPct = ((price - buyP) / buyP) * 100;
                    }
                }
                return {
                    ...t,
                    pnl: pnl != null ? Math.round(Number(pnl) * 100) / 100 : null,
                    pnl_percent: pnlPct != null ? Math.round(Number(pnlPct) * 100) / 100 : null,
                    run_index: runIdx,
                    run_title: t.run_title || runTitle,
                    run_date: runDate,
                    run_iso_date: runIsoDate
                };
            });
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
                const avgPrice = Number(ex.average_price || ex.buy_price || 0);
                let pnl = ex.pnl;
                let pnlPct = ex.pnl_percent;
                if (pnl == null && avgPrice > 0) {
                    pnl = (price - avgPrice) * qty;
                    pnlPct = ((price - avgPrice) / avgPrice) * 100;
                }
                trades.push({
                    symbol: ex.symbol,
                    action: 'SELL',
                    action_label: 'SELL (Exit)',
                    quantity: qty,
                    price: price,
                    amount: Math.round(amt * 100) / 100,
                    fee: Math.round(fee * 100) / 100,
                    pnl: pnl != null ? Math.round(Number(pnl) * 100) / 100 : null,
                    pnl_percent: pnlPct != null ? Math.round(Number(pnlPct) * 100) / 100 : null,
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
                    const avgPrice = Number(prevH.average_price || prevH.buy_price || price);
                    const pnl = (price - avgPrice) * qty;
                    const pnlPct = avgPrice > 0 ? ((price - avgPrice) / avgPrice) * 100 : 0;
                    trades.push({
                        symbol: prevH.symbol,
                        action: 'SELL',
                        action_label: 'SELL (Exit)',
                        quantity: qty,
                        price: price,
                        amount: Math.round(amt * 100) / 100,
                        fee: Math.round(amt * 0.0010 * 100) / 100,
                        pnl: Math.round(pnl * 100) / 100,
                        pnl_percent: Math.round(pnlPct * 100) / 100,
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
                    const avgPrice = Number(prevH ? (prevH.average_price || prevH.buy_price || price) : price);
                    const pnl = (price - avgPrice) * trimQty;
                    const pnlPct = avgPrice > 0 ? ((price - avgPrice) / avgPrice) * 100 : 0;
                    trades.push({
                        symbol: sym,
                        action: 'SELL',
                        action_label: `TRIM (-${trimQty})`,
                        quantity: trimQty,
                        price: price,
                        amount: Math.round(amt * 100) / 100,
                        fee: Math.round(amt * 0.0010 * 100) / 100,
                        pnl: Math.round(pnl * 100) / 100,
                        pnl_percent: Math.round(pnlPct * 100) / 100,
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

        return trades.map(t => ({
            ...t,
            run_iso_date: t.run_iso_date || runIsoDate
        }));
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
        const typeSelect = document.getElementById('wltTypeFilterSelect');
        if (typeSelect) typeSelect.value = 'all';

        // Populate Scope Dropdown
        const scopeSelect = document.getElementById('wltScopeSelect');
        if (scopeSelect) {
            let optsHtml = `<option value="all">🌐 All Transactions (Entire History)</option>`;
            runs.forEach((r, idx) => {
                const isInit = r.run_type === 'INIT' || idx === 0;
                const isWithdraw = r.run_type === 'WITHDRAWAL';
                const title = isInit ? 'Init' : (r.title || (isWithdraw ? 'Withdrawal' : `Rebalance #${idx}`));
                const dateStr = formatDateDisplay(r.executed_date || r.scheduled_date || '');
                const icon = isInit ? '🚀' : (isWithdraw ? '💸' : '🔄');
                optsHtml += `<option value="${idx}">${icon} ${title} (${dateStr})</option>`;
            });
            scopeSelect.innerHTML = optsHtml;
            // Initially select the active/selected rebalance or init milestone
            scopeSelect.value = String(initialRunIdx);
        }

        // Reset date filter
        const fromInput = document.getElementById('wltFromDate');
        const toInput = document.getElementById('wltToDate');
        if (fromInput) fromInput.value = '';
        if (toInput) toInput.value = '';
        currentLogTradesState.fromDate = null;
        currentLogTradesState.toDate = null;

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

        const dateRangeEl = document.getElementById('wltDateRangeContainer');
        if (scopeVal === 'all') {
            trades = getAllStrategyTrades(currentStrategy);
            badgeText = `All Transactions (${runs.length} Runs)`;
            subText = `${currentStrategy.name} · Complete strategy transaction history across all milestones`;
            currentLogTradesState.scope = 'all';
            currentLogTradesState.activeRunIndex = null;
            if (dateRangeEl) dateRangeEl.style.display = 'inline-flex';
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
            if (dateRangeEl) dateRangeEl.style.display = 'none';
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

        // Render Table & Footer
        renderLogTransactionsTable();
    }

    function handleLogTransactionsDateChange() {
        const fromInput = document.getElementById('wltFromDate');
        const toInput = document.getElementById('wltToDate');
        currentLogTradesState.fromDate = fromInput ? fromInput.value.trim() : null;
        currentLogTradesState.toDate = toInput ? toInput.value.trim() : null;
        renderLogTransactionsTable();
    }

    function clearLogTransactionsDateFilter() {
        const fromInput = document.getElementById('wltFromDate');
        const toInput = document.getElementById('wltToDate');
        if (fromInput) fromInput.value = '';
        if (toInput) toInput.value = '';
        currentLogTradesState.fromDate = null;
        currentLogTradesState.toDate = null;
        renderLogTransactionsTable();
    }

    function updateLogTransactionsKPIs(trades) {
        const totalTrades = trades.length;
        const buyTrades = trades.filter(t => t.action === 'BUY');
        const sellTrades = trades.filter(t => t.action === 'SELL' || t.type === 'WITHDRAWAL' || t.action === 'WITHDRAW');
        const totalBuyAmt = buyTrades.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
        const totalSellAmt = sellTrades.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
        const totalCharges = trades.reduce((sum, t) => sum + (Number(t.fee) || 0), 0);

        // Realized P&L from closed positions (exits & trims)
        const sellTradesWithPnl = sellTrades.filter(t => t.pnl != null);
        const totalRealizedPnl = sellTradesWithPnl.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
        const totalSoldCost = sellTradesWithPnl.reduce((sum, t) => sum + (Number(t.amount || 0) - Number(t.pnl || 0)), 0);
        const totalPnlPct = totalSoldCost > 0 ? ((totalRealizedPnl / totalSoldCost) * 100) : 0;

        const countEl = document.getElementById('wltSummaryTradesCount');
        if (countEl) countEl.innerText = `${totalTrades} ${totalTrades === 1 ? 'trade' : 'trades'}`;

        const breakdownEl = document.getElementById('wltSummaryTradesBreakdown');
        if (breakdownEl) breakdownEl.innerText = `${buyTrades.length} BUY · ${sellTrades.length} SELL`;

        const buyAmtEl = document.getElementById('wltSummaryBuyAmount');
        if (buyAmtEl) buyAmtEl.innerText = `₹${formatCurrency(totalBuyAmt)}`;

        const sellAmtEl = document.getElementById('wltSummarySellAmount');
        if (sellAmtEl) sellAmtEl.innerText = `₹${formatCurrency(totalSellAmt)}`;

        const pnlEl = document.getElementById('wltSummaryPnl');
        const pnlSubEl = document.getElementById('wltSummaryPnlSubtitle');
        if (pnlEl) {
            if (sellTrades.length === 0) {
                pnlEl.innerText = '₹0.00';
                pnlEl.style.color = 'var(--text-secondary)';
                if (pnlSubEl) pnlSubEl.innerText = 'No closed positions yet';
            } else {
                const isPos = totalRealizedPnl >= 0;
                const sign = isPos ? '+' : '';
                pnlEl.innerText = `${sign}₹${formatCurrency(totalRealizedPnl)} (${sign}${totalPnlPct.toFixed(2)}%)`;
                pnlEl.style.color = isPos ? '#10b981' : '#ef4444';
                if (pnlSubEl) pnlSubEl.innerText = `${sellTrades.length} closed position${sellTrades.length === 1 ? '' : 's'}`;
            }
        }

        const chargesEl = document.getElementById('wltSummaryCharges');
        if (chargesEl) chargesEl.innerText = `₹${formatCurrency(totalCharges)}`;

        // Update Dropdown Option Counts
        const optAll = document.getElementById('wltOptAll');
        if (optAll) optAll.textContent = `All (${totalTrades})`;
        const optBuy = document.getElementById('wltOptBuy');
        if (optBuy) optBuy.textContent = `Buy (${buyTrades.length})`;
        const optSell = document.getElementById('wltOptSell');
        if (optSell) optSell.textContent = `Sell (${sellTrades.length})`;
    }

    function closeLogTransactionsModal() {
        const modal = document.getElementById('walletLogTransactionsModal');
        if (modal) modal.style.display = 'none';
    }

    function renderLogTransactionsTable() {
        const tbody = document.getElementById('wltTransactionsTbody');
        const tfoot = document.getElementById('wltTransactionsTfoot');
        if (!tbody || !tfoot) return;

        const { trades, filter, query, fromDate, toDate, scope } = currentLogTradesState;
        let filtered = trades.slice();

        // 1. Filter by Date Range (when scope is all transactions)
        if (scope === 'all') {
            const fromIso = normalizeToIsoYMD(fromDate);
            const toIso = normalizeToIsoYMD(toDate);
            if (fromIso) {
                filtered = filtered.filter(t => {
                    const d = normalizeToIsoYMD(t.run_iso_date || t.date || t.executed_date || t.run_date);
                    return !d || d >= fromIso;
                });
            }
            if (toIso) {
                filtered = filtered.filter(t => {
                    const d = normalizeToIsoYMD(t.run_iso_date || t.date || t.executed_date || t.run_date);
                    return !d || d <= toIso;
                });
            }
        }

        // Update KPI Cards and Pill Counts for active date-filtered trades
        updateLogTransactionsKPIs(filtered);

        // 2. Filter by BUY / SELL
        if (filter === 'buy') {
            filtered = filtered.filter(t => t.action === 'BUY');
        } else if (filter === 'sell') {
            filtered = filtered.filter(t => t.action === 'SELL' || t.type === 'WITHDRAWAL' || t.action === 'WITHDRAW');
        }

        // 3. Filter by search query (symbol, action_label, notes, comments, or run_title)
        if (query && query.trim()) {
            const q = query.trim().toUpperCase();
            filtered = filtered.filter(t => 
                (t.symbol || '').toUpperCase().includes(q) ||
                (t.notes || '').toUpperCase().includes(q) ||
                (t.comments || '').toUpperCase().includes(q) ||
                (t.action_label || '').toUpperCase().includes(q) ||
                (t.run_title || '').toUpperCase().includes(q)
            );
        }

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 28px; color: var(--text-secondary);">No transactions match your search/filter criteria.</td></tr>`;
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
        let totRealizedPnl = 0;
        let totSoldCost = 0;
        let buyCount = 0;
        let sellCount = 0;

        filtered.forEach((t, i) => {
            const isBuy = t.action === 'BUY';
            const isWithdraw = t.type === 'WITHDRAWAL' || t.action === 'WITHDRAW' || (t.action_label && t.action_label.includes('WITHDRAW'));
            const isSell = t.action === 'SELL' || isWithdraw;
            const qty = Number(t.quantity || 0);
            const price = Number(t.price || 0);
            const amt = Number(t.amount || (qty * price));
            const fee = Number(t.fee || (amt * 0.0010));
            const pnl = t.pnl != null ? Number(t.pnl) : null;
            const pnlPct = t.pnl_percent != null ? Number(t.pnl_percent) : null;

            totQty += qty;
            totAmount += amt;
            totFee += fee;

            if (isBuy) {
                totBuy += amt;
                buyCount++;
            } else if (isSell) {
                totSell += amt;
                sellCount++;
                if (pnl != null) {
                    totRealizedPnl += pnl;
                    totSoldCost += (amt - pnl);
                }
            }

            let badgeBg = isBuy ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
            let badgeColor = isBuy ? '#10b981' : '#ef4444';
            let badgeBorder = isBuy ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)';
            if (isWithdraw) {
                badgeBg = 'rgba(245, 158, 11, 0.15)';
                badgeColor = '#f59e0b';
                badgeBorder = 'rgba(245, 158, 11, 0.35)';
            }
            const actionLabel = isWithdraw ? (t.action_label || 'WITHDRAW') : (t.action_label || t.action || 'TRADE');

            let pnlHtml = `<span style="color: var(--text-secondary); font-size: 11px;">—</span>`;
            if (isSell && pnl != null) {
                const isPnlPos = pnl >= 0;
                const pColor = isPnlPos ? '#10b981' : '#ef4444';
                const pSign = isPnlPos ? '+' : '';
                pnlHtml = `
                    <div style="font-weight: 700; color: ${pColor};">${pSign}₹${formatCurrency(pnl)}</div>
                    <div style="font-size: 10px; font-weight: 600; color: ${pColor}; opacity: 0.9;">${pSign}${Number(pnlPct || 0).toFixed(2)}%</div>
                `;
            }

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
                    <td style="text-align: right; font-family: monospace; font-size: 12px;">
                        ${pnlHtml}
                    </td>
                    <td style="text-align: right; font-family: monospace; font-size: 11.5px; color: var(--text-secondary);">
                        ₹${formatCurrency(fee)}
                    </td>
                    <td style="font-size: 11.5px; color: var(--text-secondary);">
                        ${escapeHtml(t.notes || t.comments || '—')}
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = rowsHtml;

        // Table Footer with Consolidated Totals & P&L
        const totPnlPct = totSoldCost > 0 ? ((totRealizedPnl / totSoldCost) * 100) : 0;
        const isTotPos = totRealizedPnl >= 0;
        const totPnlColor = isTotPos ? '#10b981' : '#ef4444';
        const totPnlSign = isTotPos ? '+' : '';
        const hasSells = sellCount > 0;

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
                    <div style="font-size: 13px; font-weight: 700; color: var(--text-primary); white-space: nowrap;">₹${formatCurrency(totAmount)}</div>
                    <div style="font-size: 10px; font-weight: normal; color: var(--text-secondary); margin-top: 2px; white-space: nowrap;">
                        Buy: ₹${formatCurrency(totBuy)} · Sell: ₹${formatCurrency(totSell)}
                    </div>
                    ${hasSells ? `
                    <div style="font-size: 10.5px; font-weight: 700; color: ${totPnlColor}; margin-top: 3px; white-space: nowrap;">
                        P&L: ${totPnlSign}₹${formatCurrency(totRealizedPnl)} (${totPnlSign}${totPnlPct.toFixed(2)}%)
                    </div>` : ''}
                </td>
                <td style="text-align: right; font-family: monospace; padding: 10px 12px;">
                    ${hasSells ? `
                    <div style="font-size: 13px; font-weight: 700; color: ${totPnlColor};">${totPnlSign}₹${formatCurrency(totRealizedPnl)}</div>
                    <div style="font-size: 10px; font-weight: 600; color: ${totPnlColor}; margin-top: 2px;">
                        ${totPnlSign}${totPnlPct.toFixed(2)}%
                    </div>` : `<span style="color: var(--text-secondary); font-weight: normal; font-size: 11px;">—</span>`}
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
        currentLogTradesState.filter = type || 'all';
        const sel = document.getElementById('wltTypeFilterSelect');
        if (sel && sel.value !== currentLogTradesState.filter) {
            sel.value = currentLogTradesState.filter;
        }
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
        const existingPerfTip = document.getElementById('mscPerfChartCustomTooltip');
        if (existingPerfTip) existingPerfTip.remove();

        const ctx = canvas.getContext('2d');
        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

        const labels = (data.dates || []).map(d => formatDateDisplay(d));
        const portfolioData = data.portfolio_value_series || [];
        const investedData = data.invested_series || [];
        const isDense = labels.length > 50;

        // Gradient for portfolio value
        const gradient = ctx.createLinearGradient(0, 0, 0, 360);
        gradient.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
        gradient.addColorStop(0.5, 'rgba(16, 185, 129, 0.12)');
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
                        borderWidth: 2.8,
                        backgroundColor: gradient,
                        fill: true,
                        tension: 0.22,
                        pointRadius: isDense ? 0 : 4,
                        pointHoverRadius: 7,
                        pointHitRadius: 12,
                        pointBackgroundColor: '#10b981',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2
                    },
                    {
                        label: 'Invested Capital (₹)',
                        data: investedData,
                        borderColor: '#818cf8',
                        borderWidth: 2.0,
                        borderDash: [6, 4],
                        fill: false,
                        tension: 0.1,
                        pointRadius: isDense ? 0 : 3,
                        pointHoverRadius: 6,
                        pointHitRadius: 10,
                        pointBackgroundColor: '#818cf8',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 1.5
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
                        enabled: false,
                        external: function(context) {
                            const { chart, tooltip } = context;
                            let tooltipEl = document.getElementById('mscPerfChartCustomTooltip');
                            if (!tooltipEl) {
                                tooltipEl = document.createElement('div');
                                tooltipEl.id = 'mscPerfChartCustomTooltip';
                                tooltipEl.style.position = 'absolute';
                                tooltipEl.style.pointerEvents = 'none';
                                tooltipEl.style.zIndex = '30';
                                tooltipEl.style.transition = 'opacity 0.12s ease, transform 0.12s ease';
                                tooltipEl.style.background = isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)';
                                tooltipEl.style.border = isDark ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid rgba(15, 23, 42, 0.14)';
                                tooltipEl.style.borderRadius = '8px';
                                tooltipEl.style.boxShadow = isDark ? '0 12px 30px rgba(0, 0, 0, 0.6)' : '0 10px 25px rgba(15, 23, 42, 0.15)';
                                tooltipEl.style.backdropFilter = 'blur(10px)';
                                tooltipEl.style.webkitBackdropFilter = 'blur(10px)';
                                tooltipEl.style.padding = '10px 14px';
                                tooltipEl.style.minWidth = '295px';
                                tooltipEl.style.width = 'max-content';
                                tooltipEl.style.maxWidth = 'none';
                                tooltipEl.style.whiteSpace = 'nowrap';
                                tooltipEl.style.boxSizing = 'border-box';
                                chart.canvas.parentNode.appendChild(tooltipEl);
                            }

                            if (tooltip.opacity === 0) {
                                tooltipEl.style.opacity = '0';
                                tooltipEl.style.display = 'none';
                                return;
                            }

                            const activeEls = chart.getActiveElements();
                            let dotX = tooltip.caretX;
                            let dotY = tooltip.caretY;
                            if (activeEls && activeEls.length > 0 && activeEls[0].element) {
                                const ptEl = activeEls[0].element;
                                if (typeof ptEl.x === 'number' && typeof ptEl.y === 'number') {
                                    dotX = ptEl.x;
                                    dotY = ptEl.y;
                                }
                            }

                            if (tooltip.dataPoints && tooltip.dataPoints.length > 0) {
                                const idx = tooltip.dataPoints[0].dataIndex;
                                const points = data.points || [];
                                const pt = points[idx] || {};
                                const dateLabel = labels[idx] || (tooltip.title ? tooltip.title[0] : '');

                                const inv = pt.invested != null ? Number(pt.invested) : Number(investedData[idx] || 0);
                                const val = pt.portfolio_value != null ? Number(pt.portfolio_value) : Number(portfolioData[idx] || 0);
                                const pnl = val - inv;
                                const pnlPct = inv > 0 ? ((pnl / inv) * 100) : 0;
                                const isPos = pnl >= 0;
                                const sign = isPos ? '+' : '';
                                const pctColor = isPos ? '#10b981' : '#ef4444';
                                const pctBg = isPos ? 'rgba(16, 185, 129, 0.16)' : 'rgba(239, 68, 68, 0.16)';
                                const pctBorder = isPos ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)';

                                const titleColor = isDark ? '#94a3b8' : '#64748b';
                                const labelColor = isDark ? '#f8fafc' : '#0f172a';
                                const mutedLabel = isDark ? '#94a3b8' : '#475569';
                                const amtColor = isDark ? '#e2e8f0' : '#1e293b';
                                const dividerColor = isDark ? 'rgba(255, 255, 255, 0.09)' : 'rgba(15, 23, 42, 0.09)';
                                const titleColBase = 'width: 152px; min-width: 152px; flex: 0 0 152px; white-space: nowrap;';

                                const eligStr = pt.eligible_count ? ` (${pt.eligible_count})` : '';
                                const milestoneBadge = pt.milestone
                                    ? `<span style="font-size: 10px; font-weight: 600; color: ${mutedLabel}; background: ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)'}; padding: 1px 6px; border-radius: 4px; white-space: nowrap;">${escapeHtml(pt.milestone)}</span>`
                                    : '';

                                let html = `
                                    <div style="font-size: 11px; font-weight: 700; color: ${titleColor}; margin-bottom: 8px; border-bottom: 1px solid ${dividerColor}; padding-bottom: 5px; display: flex; align-items: center; justify-content: space-between; gap: 14px; white-space: nowrap;">
                                        <span style="white-space: nowrap;">📅 ${escapeHtml(dateLabel)}</span>
                                        ${milestoneBadge}
                                    </div>
                                    <div style="display: flex; flex-direction: column; gap: 6px; white-space: nowrap;">
                                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 11.5px; white-space: nowrap;">
                                            <span style="${titleColBase} display: inline-flex; align-items: center; gap: 6px; color: ${labelColor}; font-weight: 600;">
                                                <span style="display: inline-block; width: 8px; height: 8px; flex-shrink: 0; border-radius: 50%; background: #10b981;"></span>
                                                <span>Portfolio Value${escapeHtml(eligStr)}</span>
                                            </span>
                                            <span style="font-family: monospace; font-weight: 600; color: ${amtColor}; white-space: nowrap;">₹${formatCurrency(val)}</span>
                                        </div>
                                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 11.5px; white-space: nowrap;">
                                            <span style="${titleColBase} display: inline-flex; align-items: center; gap: 6px; color: ${mutedLabel}; font-weight: 500;">
                                                <span style="display: inline-block; width: 8px; height: 8px; flex-shrink: 0; border-radius: 50%; background: #818cf8;"></span>
                                                <span>Invested Capital</span>
                                            </span>
                                            <span style="font-family: monospace; font-weight: 600; color: ${amtColor}; white-space: nowrap;">₹${formatCurrency(inv)}</span>
                                        </div>
                                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 11.5px; padding-top: 5px; border-top: 1px dashed ${dividerColor}; white-space: nowrap;">
                                            <span style="${titleColBase} color: ${mutedLabel}; font-weight: 500;">Net Return</span>
                                            <span style="display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; white-space: nowrap;">
                                                <span style="font-family: monospace; font-weight: 600; color: ${amtColor}; white-space: nowrap;">${formatSignedCurrency(pnl)}</span>
                                                <span style="font-family: monospace; font-size: 11px; font-weight: 700; color: ${pctColor}; background: ${pctBg}; border: 1px solid ${pctBorder}; padding: 1px 6px; border-radius: 4px; white-space: nowrap;">
                                                    ${sign}${pnlPct.toFixed(2)}%
                                                </span>
                                            </span>
                                        </div>
                                `;

                                if (pt.change_percent !== undefined && pt.change_percent !== null) {
                                    const chgPct = Number(pt.change_percent) || 0;
                                    const chgPos = chgPct >= 0;
                                    const chgSign = chgPos ? '+' : '';
                                    const chgColor = chgPos ? '#10b981' : '#ef4444';
                                    html += `
                                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 11.5px; white-space: nowrap;">
                                            <span style="${titleColBase} color: ${mutedLabel}; font-weight: 500;">Period Move</span>
                                            <span style="font-family: monospace; font-size: 11px; font-weight: 700; color: ${chgColor}; white-space: nowrap;">${chgSign}${chgPct.toFixed(2)}%</span>
                                        </div>
                                    `;
                                }

                                if (pnl < 0) {
                                    html += `
                                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 11px; white-space: nowrap;">
                                            <span style="${titleColBase} color: ${mutedLabel};">🔻 Deficit Below Capital</span>
                                            <span style="display: inline-flex; align-items: center; justify-content: flex-end; gap: 5px; white-space: nowrap;">
                                                <span style="font-family: monospace; color: ${amtColor}; white-space: nowrap;">-₹${formatCurrency(Math.abs(pnl))}</span>
                                                <span style="font-family: monospace; font-weight: 700; color: #ef4444; white-space: nowrap;">(${pnlPct.toFixed(2)}%)</span>
                                            </span>
                                        </div>
                                    `;
                                }

                                html += `</div>`;
                                tooltipEl.innerHTML = html;
                            }

                            tooltipEl.style.display = 'block';
                            const wrapRect = chart.canvas.parentNode.getBoundingClientRect();
                            const wrapWidth = wrapRect.width || chart.canvas.parentNode.clientWidth || 600;
                            const tipW = tooltipEl.offsetWidth || 300;
                            const isNearTop = dotY < 165;

                            let tipLeft = dotX - (tipW / 2);
                            if (dotX > wrapWidth - (tipW * 0.65)) {
                                tipLeft = dotX - tipW - 10;
                            } else if (dotX < (tipW * 0.65)) {
                                tipLeft = dotX + 10;
                            }
                            tipLeft = Math.max(8, Math.min(tipLeft, wrapWidth - tipW - 8));

                            tooltipEl.style.left = tipLeft + 'px';
                            tooltipEl.style.top = isNearTop ? ((dotY + 14) + 'px') : ((dotY - 10) + 'px');
                            tooltipEl.style.transform = isNearTop ? 'translateY(0)' : 'translateY(-100%)';
                            tooltipEl.style.opacity = '1';
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
        ensureModalsAttachedToBody();
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
        const tip = document.getElementById('mscPerfChartCustomTooltip');
        if (tip) tip.style.display = 'none';
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
            <div class="msc-table-responsive" style="overflow-x: auto;">
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

    // Compare Index Top Error Alert helpers
    function showComparisonTopError(msg, title = 'Comparison Error') {
        const banner = document.getElementById('mscCompTopErrorAlert');
        const msgEl = document.getElementById('mscCompTopErrorMsg');
        const titleEl = document.getElementById('mscCompTopErrorTitle');
        const body = document.querySelector('.msc-comp-body');
        if (msgEl) msgEl.innerText = msg;
        if (titleEl) titleEl.innerText = title;
        if (banner) {
            banner.style.display = 'flex';
            if (body) {
                try {
                    body.scrollTo({ top: 0, behavior: 'smooth' });
                } catch (_) {
                    body.scrollTop = 0;
                }
            }
        }
    }

    function hideComparisonTopError() {
        const banner = document.getElementById('mscCompTopErrorAlert');
        if (banner) banner.style.display = 'none';
    }

    window.showComparisonTopError = showComparisonTopError;
    window.hideComparisonTopError = hideComparisonTopError;

    // Unified Toast / Alert (Guaranteed to always show on top of any active popup)
    function alertToast(msg, type = 'info') {
        const compModal = document.getElementById('mscIndexComparisonModal');
        const isCompOpen = compModal && compModal.style.display !== 'none' && !comparisonState.isMinimized;
        if (isCompOpen && (type === 'error' || type === 'warning')) {
            showComparisonTopError(msg, type === 'error' ? 'Comparison Error' : 'Validation Notice');
        }

        // Always re-append toast container to body so it stays at the top of the stacking tree
        const toastCont = document.getElementById('appBottomToastContainer');
        if (toastCont && toastCont.parentElement) {
            toastCont.style.zIndex = '9999999';
            if (toastCont.parentElement !== document.body) {
                document.body.appendChild(toastCont);
            }
        }

        if (typeof window.showToast === 'function') {
            window.showToast(msg, type);
        } else {
            alert(msg);
        }
    }

    // =========================================================================
    // MULTI-INDEX MOMENTUM COMPARISON ENGINE (SAME GRAPH, DB DATA ONLY)
    // =========================================================================
    const comparisonState = {
        indicesCatalog: [],
        indexRows: [],
        chartInstance: null,
        simulationResults: null,
        activeSelectedIndexId: null,
        isRunning: false,
        isMinimized: false,
        cachedIndices: {},
        lastCacheDate: (function() {
            try { return localStorage.getItem('msc_comp_cache_date'); } catch(e) { return null; }
        })()
    };

    const COMPARISON_PALETTE = [
        '#3b82f6', // 0: Blue
        '#10b981', // 1: Emerald
        '#f59e0b', // 2: Amber
        '#ec4899', // 3: Pink
        '#8b5cf6', // 4: Purple
        '#06b6d4', // 5: Cyan
        '#ef4444', // 6: Red
        '#14b8a6', // 7: Teal
        '#f97316', // 8: Bright Orange
        '#6366f1', // 9: Indigo
        '#84cc16', // 10: Lime
        '#d946ef', // 11: Fuchsia
        '#0284c7', // 12: Sky Blue
        '#e11d48', // 13: Rose
        '#eab308', // 14: Yellow
        '#22c55e', // 15: Green
        '#a855f7', // 16: Violet
        '#38bdf8', // 17: Light Blue
        '#fb923c', // 18: Coral
        '#4ade80', // 19: Mint
        '#c084fc', // 20: Lavender
        '#f43f5e', // 21: Watermelon
        '#2dd4bf', // 22: Aqua
        '#fbbf24', // 23: Marigold
        '#818cf8', // 24: Periwinkle
    ];

    function getUniqueComparisonColor(existingRows) {
        const usedColors = new Set((existingRows || []).map(r => (r.color || '').trim().toLowerCase()).filter(Boolean));
        for (const c of COMPARISON_PALETTE) {
            if (!usedColors.has(c.toLowerCase())) {
                return c;
            }
        }
        // Fallback: Golden angle HSL generation for theoretically unlimited non-repeating colors
        const idx = existingRows ? existingRows.length : 0;
        const hue = Math.round((idx * 137.508) % 360);
        return `hsl(${hue}, 80%, 50%)`;
    }

    function ensureUniqueComparisonColors(rows) {
        if (!rows || !Array.isArray(rows)) return;
        const seen = new Set();
        rows.forEach((row, idx) => {
            const c = (row.color || '').trim().toLowerCase();
            if (!c || seen.has(c)) {
                row.color = getUniqueComparisonColor(rows.filter((_, i) => i < idx));
            }
            seen.add((row.color || '').trim().toLowerCase());
        });
    }

    async function loadComparisonIndicesCatalog() {
        if (comparisonState.indicesCatalog && comparisonState.indicesCatalog.length > 0) {
            return comparisonState.indicesCatalog;
        }
        try {
            const res = await fetch('/api/momentum-smallcases/indices-catalog');
            const data = await res.json();
            if (data.success && Array.isArray(data.indices)) {
                comparisonState.indicesCatalog = data.indices;
                if (data.earliest_month) {
                    const badge = document.getElementById('mscCompDataAvailableBadge');
                    if (badge) badge.innerText = `💡 Data available from ${data.earliest_month}`;
                }
                return data.indices;
            }
        } catch (e) {
            console.error('Error fetching indices catalog for comparison:', e);
        }
        return [];
    }

    async function openIndexComparisonModal() {
        ensureModalsAttachedToBody();
        comparisonState.isMinimized = false;
        const dock = document.getElementById('mscIndexComparisonDock');
        if (dock) dock.style.display = 'none';

        const modal = document.getElementById('mscIndexComparisonModal');
        if (!modal) return;
        modal.style.display = 'flex';

        // Check fresh day rollover: Clear cache once per day when date changes
        const todayStr = new Date().toISOString().split('T')[0];
        if (comparisonState.lastCacheDate !== todayStr) {
            console.log(`[Multi-Index Comparison] Fresh day detected (${todayStr} vs previous ${comparisonState.lastCacheDate}). Clearing cache once for today.`);
            comparisonState.cachedIndices = {};
            comparisonState.lastCacheDate = todayStr;
            try {
                localStorage.setItem('msc_comp_cache_date', todayStr);
            } catch (e) {}
        }

        // Set default dates and capital
        const startInput = document.getElementById('mscCompStartDate');
        const amountInput = document.getElementById('mscCompAmount');
        const stepupInput = document.getElementById('mscCompStepupAmount');
        const cutoffInput = document.getElementById('mscCompCutoffDate');

        if (startInput) {
            if (!startInput.value) startInput.value = '2024-01-01';
            startInput.min = '2013-01-01';
            startInput.max = new Date().toISOString().slice(0, 10);
        }
        if (amountInput && !amountInput.value) amountInput.value = '100000';
        if (stepupInput) stepupInput.value = '';
        if (cutoffInput) {
            const now = new Date();
            cutoffInput.value = now.toISOString().split('T')[0];
        }

        // Fetch catalog
        await loadComparisonIndicesCatalog();

        // Initialize default 2 rows if empty
        if (!comparisonState.indexRows || comparisonState.indexRows.length === 0) {
            const cat = comparisonState.indicesCatalog || [];
            const idx1 = cat[0] || { id: 'NIFTY_50', name: 'NIFTY 50', type: 'nifty' };
            const idx2 = cat[3] || cat[1] || { id: 'NIFTY_SMALLCAP_250', name: 'NIFTY SMALLCAP 250', type: 'nifty' };

            comparisonState.indexRows = [
                {
                    id: 'comp_row_1',
                    index_id: idx1.id,
                    index_name: idx1.name,
                    index_type: idx1.type || 'nifty',
                    no_of_stocks: 12,
                    exit_regime_ranking: 22,
                    rebalance_day: 21,
                    trim_existing: 'no',
                    trading_days_per_month: 21,
                    color: COMPARISON_PALETTE[0]
                },
                {
                    id: 'comp_row_2',
                    index_id: idx2.id,
                    index_name: idx2.name,
                    index_type: idx2.type || 'nifty',
                    no_of_stocks: 12,
                    exit_regime_ranking: 22,
                    rebalance_day: 21,
                    trim_existing: 'no',
                    trading_days_per_month: 21,
                    color: COMPARISON_PALETTE[1]
                }
            ];
        }

        renderComparisonIndexRows();

        // If results already exist and user was minimized or re-opened, render chart/summary
        if (comparisonState.simulationResults) {
            const emptyNotice = document.getElementById('mscCompChartEmptyNotice');
            if (emptyNotice) emptyNotice.style.display = 'none';
            setTimeout(() => {
                if (comparisonState.chartInstance) {
                    comparisonState.chartInstance.resize();
                } else {
                    renderComparisonMultiLineChart(comparisonState.simulationResults);
                }
            }, 50);
            return;
        }

        // Show friendly initial placeholder - only run simulation when user clicks 'Run Comparison'
        const emptyNotice = document.getElementById('mscCompChartEmptyNotice');
        const emptyText = document.getElementById('mscCompChartEmptyText');
        if (emptyNotice) {
            emptyNotice.style.display = 'flex';
            const iconSpan = emptyNotice.querySelector('span:first-child');
            if (iconSpan) iconSpan.innerText = '📊';
        }
        if (emptyText) {
            emptyText.innerText = "Configure parameters and indices above, then click 'Run Comparison' to simulate.";
        }
    }

    function closeIndexComparisonModal() {
        hideComparisonTopError();
        const existingCustomTip = document.getElementById('mscCompChartCustomTooltip');
        if (existingCustomTip) existingCustomTip.remove();
        comparisonState.isMinimized = false;
        const dock = document.getElementById('mscIndexComparisonDock');
        if (dock) dock.style.display = 'none';

        const modal = document.getElementById('mscIndexComparisonModal');
        if (modal) modal.style.display = 'none';
        if (comparisonState.chartInstance) {
            comparisonState.chartInstance.destroy();
            comparisonState.chartInstance = null;
        }
    }

    function minimizeIndexComparisonModal() {
        ensureModalsAttachedToBody();
        comparisonState.isMinimized = true;
        const modal = document.getElementById('mscIndexComparisonModal');
        const dock = document.getElementById('mscIndexComparisonDock');
        if (modal) modal.style.display = 'none';
        if (dock) {
            dock.style.display = 'flex';
            updateIndexComparisonDockUI();
        }
    }

    function restoreIndexComparisonModal() {
        comparisonState.isMinimized = false;
        const modal = document.getElementById('mscIndexComparisonModal');
        const dock = document.getElementById('mscIndexComparisonDock');
        if (dock) dock.style.display = 'none';
        if (modal) {
            modal.style.display = 'flex';
            if (comparisonState.simulationResults) {
                setTimeout(() => {
                    if (comparisonState.chartInstance) {
                        comparisonState.chartInstance.resize();
                    } else {
                        renderComparisonMultiLineChart(comparisonState.simulationResults);
                    }
                }, 50);
            }
        }
    }

    function closeIndexComparisonDock() {
        comparisonState.isMinimized = false;
        const dock = document.getElementById('mscIndexComparisonDock');
        if (dock) dock.style.display = 'none';
    }

    function updateIndexComparisonDockUI() {
        const dock = document.getElementById('mscIndexComparisonDock');
        if (!dock) return;
        const titleEl = document.getElementById('compDockTitle');
        const statusEl = document.getElementById('compDockStatus');
        const count = (comparisonState.indexRows || []).length;
        if (titleEl) {
            titleEl.innerText = `Index Comparison (${count} ${count === 1 ? 'Index' : 'Indices'})`;
        }
        if (statusEl) {
            if (comparisonState.isRunning) {
                statusEl.innerText = '⏳ Simulating...';
                statusEl.style.color = '#f59e0b';
            } else if (comparisonState.simulationResults) {
                statusEl.innerText = '✅ Results Ready (Click to expand)';
                statusEl.style.color = '#10b981';
            } else {
                statusEl.innerText = '📊 Configured (Click to expand)';
                statusEl.style.color = '#818cf8';
            }
        }
    }

    function renderComparisonIndexRows() {
        const container = document.getElementById('mscCompIndicesList');
        if (!container) return;

        // Ensure every active index row has a distinct non-repeating color
        ensureUniqueComparisonColors(comparisonState.indexRows);

        const countBadge = document.getElementById('mscCompIndexCountBadge');
        if (countBadge) {
            countBadge.innerText = `${comparisonState.indexRows.length} ${comparisonState.indexRows.length === 1 ? 'Index' : 'Indices'}`;
        }

        const cat = comparisonState.indicesCatalog || [];

        container.innerHTML = comparisonState.indexRows.map((row, idx) => {
            const color = row.color || getUniqueComparisonColor(comparisonState.indexRows.filter((_, i) => i < idx));
            row.color = color;
            const isFirst = (idx === 0);

            // Group catalog options
            const manualIndices = cat.filter(c => c.type === 'manual');
            const benchmarkIndices = cat.filter(c => c.type !== 'manual');

            const manualOptions = manualIndices.map(c => `
                <option value="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}" data-type="manual" ${c.id === row.index_id ? 'selected' : ''}>
                    ${escapeHtml(c.name)} (${c.stock_count || (c.stocks && c.stocks.length) || 0} stocks)
                </option>
            `).join('');

            const benchmarkOptions = benchmarkIndices.map(c => `
                <option value="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}" data-type="nifty" ${c.id === row.index_id ? 'selected' : ''}>
                    ${escapeHtml(c.name)}
                </option>
            `).join('');

            return `
                <div class="msc-comp-row-card" data-row-id="${escapeHtml(row.id)}" style="background: var(--bg-subtle); border: 1px solid var(--border-color); border-left: 4px solid ${color}; border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: ${color};"></span>
                            <strong style="font-size: 13px; color: var(--text-primary);">Index #${idx + 1}</strong>
                            ${isFirst ? '<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6; font-size: 10px; padding: 1px 6px; border-radius: 3px;">Primary / Default Template</span>' : ''}
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <button type="button" class="btn-secondary" onclick="removeComparisonIndexRow('${escapeHtml(row.id)}')" ${comparisonState.indexRows.length <= 1 ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : ''} style="font-size: 11px; padding: 3px 8px; color: #ef4444; border-color: rgba(239, 68, 68, 0.3);" title="Remove this index from comparison">
                                🗑️ Remove
                            </button>
                        </div>
                    </div>

                    <!-- Config Grid -->
                    <div style="display: grid; grid-template-columns: 2fr repeat(5, 1fr); gap: 10px; align-items: flex-end;" class="msc-comp-config-grid">
                        <!-- 1. Universe Selection -->
                        <div class="msc-form-group" style="margin-bottom: 0;">
                            <label style="font-size: 10.5px; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 3px;">
                                Index Universe <span style="color: #ef4444;">*</span>
                            </label>
                            <select class="msc-modal-input msc-comp-universe-select" data-row-id="${escapeHtml(row.id)}" onchange="updateComparisonRowUniverse('${escapeHtml(row.id)}', this)" style="font-size: 12px; padding: 5px 8px; cursor: pointer;">
                                ${manualOptions ? `<optgroup label="Manual Momentum Indices">${manualOptions}</optgroup>` : ''}
                                ${benchmarkOptions ? `<optgroup label="Official Benchmark Indices">${benchmarkOptions}</optgroup>` : ''}
                            </select>
                        </div>

                        <!-- 2. No. of Stocks -->
                        <div class="msc-form-group" style="margin-bottom: 0;">
                            <label style="font-size: 10.5px; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 3px;">
                                Top Picks
                            </label>
                            <input type="number" class="msc-modal-input msc-comp-stocks-input" data-row-id="${escapeHtml(row.id)}" value="${row.no_of_stocks || 12}" min="3" max="50" style="font-size: 12px; padding: 5px 8px;">
                        </div>

                        <!-- 3. Exit Regime Ranking -->
                        <div class="msc-form-group" style="margin-bottom: 0;">
                            <label style="font-size: 10.5px; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 3px;">
                                Exit Regime
                            </label>
                            <input type="number" class="msc-modal-input msc-comp-exit-input" data-row-id="${escapeHtml(row.id)}" value="${row.exit_regime_ranking || 22}" min="3" max="100" style="font-size: 12px; padding: 5px 8px;">
                        </div>

                        <!-- 4. Rebalance Day -->
                        <div class="msc-form-group" style="margin-bottom: 0;">
                            <label style="font-size: 10.5px; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 3px;">
                                Rebalance Day
                            </label>
                            <input type="number" class="msc-modal-input msc-comp-rebal-input" data-row-id="${escapeHtml(row.id)}" value="${row.rebalance_day || 21}" min="1" max="28" style="font-size: 12px; padding: 5px 8px; cursor: pointer;" title="Rebalance day of month (1 to 28)">
                        </div>

                        <!-- 5. Trim Existing Stock -->
                        <div class="msc-form-group" style="margin-bottom: 0;">
                            <label style="font-size: 10.5px; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 3px;">
                                Trim Existing
                            </label>
                            <select class="msc-modal-input msc-comp-trim-select" data-row-id="${escapeHtml(row.id)}" style="font-size: 12px; padding: 5px 8px; cursor: pointer;">
                                <option value="no" ${String(row.trim_existing).toLowerCase() !== 'yes' ? 'selected' : ''}>No (Default)</option>
                                <option value="yes" ${String(row.trim_existing).toLowerCase() === 'yes' ? 'selected' : ''}>Yes</option>
                            </select>
                        </div>

                        <!-- 6. Trading Days per Month -->
                        <div class="msc-form-group" style="margin-bottom: 0;">
                            <label style="font-size: 10.5px; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 3px;">
                                Days / Month
                            </label>
                            <select class="msc-modal-input msc-comp-days-select" data-row-id="${escapeHtml(row.id)}" style="font-size: 12px; padding: 5px 8px; cursor: pointer;">
                                <option value="21" ${Number(row.trading_days_per_month) === 21 ? 'selected' : ''}>21d (Default)</option>
                                <option value="30" ${Number(row.trading_days_per_month) === 30 ? 'selected' : ''}>30d</option>
                            </select>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function syncComparisonRowsFromDOM() {
        comparisonState.indexRows.forEach(row => {
            const card = document.querySelector(`.msc-comp-row-card[data-row-id="${row.id}"]`);
            if (!card) return;

            const uSelect = card.querySelector('.msc-comp-universe-select');
            if (uSelect) {
                row.index_id = uSelect.value;
                const opt = uSelect.selectedOptions[0];
                if (opt) {
                    row.index_name = opt.getAttribute('data-name') || opt.text.trim();
                    row.index_type = opt.getAttribute('data-type') || 'nifty';
                }
            }

            const stocksIn = card.querySelector('.msc-comp-stocks-input');
            if (stocksIn) row.no_of_stocks = parseInt(stocksIn.value, 10) || 12;

            const exitIn = card.querySelector('.msc-comp-exit-input');
            if (exitIn) row.exit_regime_ranking = parseInt(exitIn.value, 10) || 22;

            const rebalIn = card.querySelector('.msc-comp-rebal-input');
            if (rebalIn) {
                const parsedVal = parseInt(rebalIn.value, 10);
                row.rebalance_day = (!isNaN(parsedVal) && parsedVal >= 1 && parsedVal <= 28) ? parsedVal : (row.rebalance_day || 21);
            }

            const trimSel = card.querySelector('.msc-comp-trim-select');
            if (trimSel) row.trim_existing = trimSel.value === 'yes';

            const daysSel = card.querySelector('.msc-comp-days-select');
            if (daysSel) row.trading_days_per_month = parseInt(daysSel.value, 10) || 21;
        });
    }

    function updateComparisonRowUniverse(rowId, selectEl) {
        const row = comparisonState.indexRows.find(r => r.id === rowId);
        if (!row || !selectEl) return;
        row.index_id = selectEl.value;
        const opt = selectEl.selectedOptions[0];
        if (opt) {
            row.index_name = opt.getAttribute('data-name') || opt.text.trim();
            row.index_type = opt.getAttribute('data-type') || 'nifty';
        }
    }

    function addComparisonIndexRow() {
        syncComparisonRowsFromDOM();

        // 1. Read first index values as default for the new index
        const first = comparisonState.indexRows[0] || {};
        const defStocks = first.no_of_stocks || 12;
        const defExit = first.exit_regime_ranking || 22;
        const defRebal = first.rebalance_day || 21;
        const defTrim = (first.trim_existing === true || String(first.trim_existing).toLowerCase() === 'yes') ? 'yes' : 'no';
        const defDays = Number(first.trading_days_per_month) || 21;

        // 2. Pick next unused universe from catalog
        const cat = comparisonState.indicesCatalog || [];
        const usedIds = new Set(comparisonState.indexRows.map(r => r.index_id));
        const candidate = cat.find(c => !usedIds.has(c.id)) || cat[0] || { id: 'NIFTY_500', name: 'NIFTY 500', type: 'nifty' };

        const newRowId = `comp_row_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        // Assign a strictly unique non-repeating color
        const nextColor = getUniqueComparisonColor(comparisonState.indexRows);

        comparisonState.indexRows.push({
            id: newRowId,
            index_id: candidate.id,
            index_name: candidate.name,
            index_type: candidate.type || 'nifty',
            no_of_stocks: defStocks,
            exit_regime_ranking: defExit,
            rebalance_day: defRebal,
            trim_existing: defTrim,
            trading_days_per_month: defDays,
            color: nextColor
        });

        renderComparisonIndexRows();
        alertToast(`Added index #${comparisonState.indexRows.length} with defaults from Index #1`, 'info');
    }

    // Extract trade statistics (buys, sells, trades, unique stocks) with dynamic milestone points fallback
    function extractTradeStats(res) {
        if (!res) return { total_buys: 0, total_sells: 0, total_trades: 0, unique_stocks_count: 0 };
        const kpis = res.kpis || {};
        let buys = Number(res.total_buys != null ? res.total_buys : (kpis.total_buys != null ? kpis.total_buys : 0));
        let sells = Number(res.total_sells != null ? res.total_sells : (kpis.total_sells != null ? kpis.total_sells : 0));
        let trades = Number(res.total_trades != null ? res.total_trades : (kpis.total_trades != null ? kpis.total_trades : 0));
        let uniqueCount = Number(res.unique_stocks_count != null ? res.unique_stocks_count : (kpis.unique_stocks_count != null ? kpis.unique_stocks_count : 0));

        // If buys or sells already exist from backend calculation, use them directly
        if (buys > 0 || sells > 0) {
            if (uniqueCount === 0) {
                if (Array.isArray(res.unique_stocks) && res.unique_stocks.length > 0) {
                    uniqueCount = res.unique_stocks.length;
                } else if (Array.isArray(kpis.unique_stocks) && kpis.unique_stocks.length > 0) {
                    uniqueCount = kpis.unique_stocks.length;
                } else if (res.constituents_count > 0) {
                    uniqueCount = Math.min(buys, res.constituents_count);
                } else {
                    uniqueCount = buys;
                }
            }
            if (trades === 0) trades = buys + sells;
            return {
                total_buys: buys,
                total_sells: sells,
                total_trades: trades,
                unique_stocks_count: uniqueCount
            };
        }

        // Fallback: Calculate from points array only if buys and sells are both 0
        const pts = Array.isArray(res.points) ? res.points : [];
        const uniqueSet = new Set();
        let calcBuys = 0;
        let calcSells = 0;

        const hasTransactions = pts.some(pt => Array.isArray(pt.transactions) && pt.transactions.length > 0);
        if (hasTransactions) {
            pts.forEach((pt) => {
                if (Array.isArray(pt.transactions) && pt.transactions.length > 0) {
                    pt.transactions.forEach(tx => {
                        const sym = tx.symbol || tx.stock;
                        if (sym) uniqueSet.add(sym);
                        const act = String(tx.action || '').toUpperCase();
                        if (act === 'BUY') calcBuys++;
                        else if (act === 'SELL') calcSells++;
                    });
                }
                if (Array.isArray(pt.holdings)) {
                    pt.holdings.forEach(h => {
                        if (h.symbol && (h.quantity > 0 || h.current_value > 0)) {
                            uniqueSet.add(h.symbol);
                        }
                    });
                }
            });
        } else if (pts.length > 0) {
            let prevSymbols = new Set();
            pts.forEach((pt, pIdx) => {
                const currHoldings = Array.isArray(pt.holdings) ? pt.holdings : [];
                const currSymbols = new Set(
                    currHoldings.filter(h => h.symbol && (h.quantity > 0 || h.current_value > 0)).map(h => h.symbol)
                );
                currSymbols.forEach(s => uniqueSet.add(s));

                if (pIdx === 0 || (pIdx === 1 && prevSymbols.size === 0)) {
                    calcBuys += currSymbols.size;
                } else if (currSymbols.size > 0 && prevSymbols.size > 0) {
                    let sellsCount = 0;
                    prevSymbols.forEach(s => {
                        if (!currSymbols.has(s)) sellsCount++;
                    });
                    let buysCount = 0;
                    currSymbols.forEach(s => {
                        if (!prevSymbols.has(s)) buysCount++;
                    });
                    calcBuys += buysCount;
                    calcSells += sellsCount;
                }
                if (currSymbols.size > 0) {
                    prevSymbols = currSymbols;
                }
            });
        }

        pts.forEach(pt => {
            if (Array.isArray(pt.holdings)) {
                pt.holdings.forEach(h => {
                    if (h.symbol && (h.quantity > 0 || h.current_value > 0)) {
                        uniqueSet.add(h.symbol);
                    }
                });
            }
        });

        if (buys === 0 && sells === 0 && (calcBuys > 0 || calcSells > 0)) {
            buys = calcBuys;
            sells = calcSells;
        }
        if (uniqueCount === 0 && uniqueSet.size > 0) {
            uniqueCount = uniqueSet.size;
        }

        if (trades === 0 && (buys > 0 || sells > 0)) {
            trades = buys + sells;
        }

        return {
            total_buys: buys,
            total_sells: sells,
            total_trades: trades,
            unique_stocks_count: uniqueCount || (buys > 0 ? buys : 0)
        };
    }

    function resetComparisonKPIs() {
        const titleEl = document.getElementById('mscCompActiveTitle');
        const dotEl = document.getElementById('mscCompActiveDot');
        const badgeEl = document.getElementById('mscCompActiveBadge');
        if (titleEl) titleEl.innerText = 'Index Performance Metrics';
        if (dotEl) dotEl.style.background = '#6366f1';
        if (badgeEl) {
            badgeEl.innerText = 'Select or simulate an index';
            badgeEl.style.color = 'var(--text-secondary)';
            badgeEl.style.background = 'var(--bg-subtle)';
        }

        const finalValEl = document.getElementById('compKpiFinalVal');
        const netPnlEl = document.getElementById('compKpiNetPnl');
        if (finalValEl) finalValEl.innerText = '₹0.00';
        if (netPnlEl) netPnlEl.innerHTML = '<span style="color: var(--text-secondary);">₹0.00 (0.00%)</span>';

        const cagrEl = document.getElementById('compKpiCagr');
        const winRateEl = document.getElementById('compKpiWinRate');
        const tradesCountEl = document.getElementById('compKpiTradesCount');
        if (cagrEl) {
            cagrEl.innerText = '0.00%';
            cagrEl.style.color = 'var(--text-secondary)';
        }
        if (winRateEl) winRateEl.innerText = 'Win Rate: 0.0%';
        if (tradesCountEl) tradesCountEl.innerHTML = '<span style="color: #10b981; font-weight: 600;">0 Buys</span> / <span style="color: #ef4444; font-weight: 600;">0 Sells</span> &bull; 0 Unique Stocks';

        const maxDdEl = document.getElementById('compKpiMaxDd');
        const maxDdDetailsEl = document.getElementById('compKpiMaxDdDetails');
        if (maxDdEl) maxDdEl.innerText = '0.00%';
        if (maxDdDetailsEl) maxDdDetailsEl.innerText = 'Peak to trough decline';

        const belowInvEl = document.getElementById('compKpiBelowInv');
        const belowInvDetailsEl = document.getElementById('compKpiBelowInvDetails');
        if (belowInvEl) {
            belowInvEl.innerText = '0.00%';
            belowInvEl.style.color = 'var(--text-secondary)';
        }
        if (belowInvDetailsEl) belowInvDetailsEl.innerText = 'Below initial capital';

        const legendContainer = document.getElementById('mscCompLegendPills');
        const selectorContainer = document.getElementById('mscCompPillSelector');
        if (legendContainer) legendContainer.innerHTML = '';
        if (selectorContainer) selectorContainer.innerHTML = '';
    }

    function removeComparisonIndexRow(rowId) {
        if (comparisonState.indexRows.length <= 1) {
            alertToast('At least one index is required for comparison.', 'warning');
            return;
        }

        // Get index name before removing
        const removedRow = comparisonState.indexRows.find(r => r.id === rowId);
        const removedName = removedRow?.index_name || 'Index';

        syncComparisonRowsFromDOM();
        comparisonState.indexRows = comparisonState.indexRows.filter(r => r.id !== rowId);
        renderComparisonIndexRows();

        // If simulation results are currently active, remove line from graph and update details
        if (comparisonState.simulationResults) {
            if (Array.isArray(comparisonState.simulationResults.results)) {
                comparisonState.simulationResults.results = comparisonState.simulationResults.results.filter(r => r.id !== rowId);
            }

            if (Array.isArray(comparisonState.simulationResults.summary)) {
                comparisonState.simulationResults.summary = comparisonState.simulationResults.summary.filter(s => s.id !== rowId);
                // Re-calculate leaderboard ranks
                comparisonState.simulationResults.summary.forEach((item, idx) => {
                    item.rank = idx + 1;
                });
            }

            const remainingResults = comparisonState.simulationResults.results || [];

            if (remainingResults.length > 0) {
                // Re-render Chart.js multi-line canvas with remaining index lines
                renderComparisonMultiLineChart(comparisonState.simulationResults);

                // Re-render Leaderboard Summary Table
                renderComparisonSummaryTable(comparisonState.simulationResults.summary || []);

                // Showcase top remaining index (Rank #1) in KPI cards
                selectComparedIndexKPI(0);

                alertToast(`Removed '${removedName}' from comparison graph and details.`, 'info');
            } else {
                // No simulation results remaining
                comparisonState.simulationResults = null;
                if (comparisonState.chartInstance) {
                    comparisonState.chartInstance.destroy();
                    comparisonState.chartInstance = null;
                }
                const dateRangeBadge = document.getElementById('mscCompChartDateRangeBadge');
                if (dateRangeBadge) dateRangeBadge.style.display = 'none';
                const emptyNotice = document.getElementById('mscCompChartEmptyNotice');
                const emptyText = document.getElementById('mscCompChartEmptyText');
                if (emptyNotice) {
                    emptyNotice.style.display = 'flex';
                    const iconSpan = emptyNotice.querySelector('span:first-child');
                    if (iconSpan) iconSpan.innerText = '📊';
                }
                if (emptyText) {
                    emptyText.innerText = "Configure parameters and indices above, then click 'Run Comparison' to simulate.";
                }
                renderComparisonSummaryTable([]);
                resetComparisonKPIs();
                alertToast(`Removed '${removedName}'.`, 'info');
            }
        } else {
            alertToast(`Removed '${removedName}' from comparison configuration.`, 'info');
        }

        // Keep floating dock in sync if minimized
        if (comparisonState.isMinimized) {
            updateIndexComparisonDockUI();
        }
    }

    // Helper to enforce start date rule: minimum available date 01-01-2013 (supports any day with Pattern 2 daily bars)
    window.handleComparisonStartDateChange = function(inputEl) {
        if (!inputEl || !inputEl.value) return;
        const val = inputEl.value;
        const parts = val.split('-');
        if (parts.length === 3) {
            const year = parseInt(parts[0], 10);
            if (year < 2013) {
                inputEl.value = '2013-01-01';
                alertToast('Dates prior to 2013 are not available. Minimum start date is 01-01-2013.', 'warning');
            }
        }
    };

    async function runIndexComparisonSimulation() {
        if (comparisonState.isRunning) return;
        hideComparisonTopError();
        syncComparisonRowsFromDOM();
        ensureUniqueComparisonColors(comparisonState.indexRows);

        const startInput = document.getElementById('mscCompStartDate');
        const amountInput = document.getElementById('mscCompAmount');
        const stepupInput = document.getElementById('mscCompStepupAmount');
        const cutoffInput = document.getElementById('mscCompCutoffDate');

        let startDate = (startInput?.value || '').trim();
        const amount = parseFloat(amountInput?.value || 100000);
        const rawStepup = (stepupInput?.value || '').trim();
        const stepup = rawStepup === '' ? 0.0 : parseFloat(rawStepup);
        const cutoffDate = (cutoffInput?.value || '').trim();

        if (!startDate) {
            showComparisonTopError('Please choose a valid Start Date.', 'Validation Notice');
            alertToast('Please choose a valid Start Date.', 'warning');
            return;
        }

        // Calendar rule: Must be >= 2013-01-01 (supports any day of month)
        const dateParts = startDate.split('-');
        if (dateParts.length === 3) {
            const yr = parseInt(dateParts[0], 10);
            if (yr < 2013) {
                startDate = '2013-01-01';
                if (startInput) startInput.value = startDate;
                alertToast('Start date clamped to minimum available data date: 01-01-2013.', 'warning');
            }
        }

        if (isNaN(amount) || amount <= 0) {
            showComparisonTopError('Please enter a valid Investment Amount.', 'Validation Notice');
            alertToast('Please enter a valid Investment Amount.', 'warning');
            return;
        }
        if (isNaN(stepup) || stepup < 0) {
            showComparisonTopError('Step-up amount must be 0 or positive.', 'Validation Notice');
            alertToast('Step-up amount must be 0 or positive.', 'warning');
            return;
        }

        const runBtn = document.getElementById('mscCompRunBtn');
        const runIcon = document.getElementById('mscCompRunIcon');
        const runText = document.getElementById('mscCompRunText');
        const emptyNotice = document.getElementById('mscCompChartEmptyNotice');
        const emptyText = document.getElementById('mscCompChartEmptyText');

        comparisonState.isRunning = true;
        if (comparisonState.isMinimized) updateIndexComparisonDockUI();
        if (runBtn) runBtn.disabled = true;
        if (runIcon) runIcon.innerText = '⏳';

        function getIndexParamKey(common, row) {
            const trimVal = (row.trim_existing === true || String(row.trim_existing).toLowerCase() === 'yes' || row.trim_existing === 'true') ? 'yes' : 'no';
            return [
                common.start_date,
                common.cutoff_date || '',
                common.amount_to_invest,
                common.stepup_amount,
                (row.index_id || '').toUpperCase(),
                row.no_of_stocks,
                row.exit_regime_ranking,
                row.rebalance_day,
                trimVal,
                row.trading_days_per_month
            ].join('|');
        }

        const commonObj = {
            start_date: startDate,
            amount_to_invest: amount,
            stepup_amount: stepup,
            cutoff_date: cutoffDate
        };

        if (!comparisonState.cachedIndices) {
            comparisonState.cachedIndices = {};
        }

        // Identify which indices are newly added or not yet calculated in browser memory
        const uncachedRows = comparisonState.indexRows.filter(r => {
            const key = getIndexParamKey(commonObj, r);
            return !comparisonState.cachedIndices[key];
        });
        const cachedCount = comparisonState.indexRows.length - uncachedRows.length;

        if (runText) {
            runText.innerText = (uncachedRows.length > 0 && cachedCount > 0)
                ? `Simulating (${uncachedRows.length} new)...`
                : 'Simulating...';
        }
        if (emptyNotice) {
            emptyNotice.style.display = 'flex';
            const iconSpan = emptyNotice.querySelector('span:first-child');
            if (iconSpan) iconSpan.innerText = '⏳';
            if (emptyText) {
                if (uncachedRows.length > 0 && cachedCount > 0) {
                    const newNames = uncachedRows.map(r => r.index_name || r.index_id).join(', ');
                    emptyText.innerText = `Simulating newly added index (${newNames})... Reusing ${cachedCount} results from browser cache.`;
                } else if (cachedCount > 0 && uncachedRows.length === 0) {
                    emptyText.innerText = `Re-rendering ${cachedCount} comparison results instantly from browser cache...`;
                } else {
                    emptyText.innerText = 'Running multi-index momentum simulation from MongoDB (stock_closing_prices)...';
                }
            }
        }

        try {
            // Only call backend if there are newly added / uncached index universes
            if (uncachedRows.length > 0) {
                const res = await fetch('/api/momentum-smallcases/compare-indices', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        common: commonObj,
                        indices: uncachedRows
                    })
                });

                const contentType = res.headers.get('content-type') || '';
                let data;
                if (contentType.includes('application/json')) {
                    data = await res.json();
                    if (!res.ok && !data.error) {
                        throw new Error(`Server returned HTTP ${res.status}`);
                    }
                } else {
                    const rawText = await res.text();
                    let errMsg = `Server returned HTTP ${res.status}`;
                    if (res.status === 404) {
                        errMsg = 'Comparison endpoint not found (404). Please ensure the backend server has been restarted.';
                    } else if (res.status === 401 || res.status === 403) {
                        errMsg = 'Session expired (401). Please refresh the page to log in.';
                    } else {
                        const match = rawText.match(/<title>(.*?)<\/title>/i) || rawText.match(/<h1>(.*?)<\/h1>/i);
                        if (match && match[1]) {
                            errMsg += `: ${match[1].trim()}`;
                        }
                    }
                    throw new Error(errMsg);
                }

                if (!data.success) {
                    const errMsg = (data.error || 'Failed to simulate index comparison').replace(/^(?:Simulation failed:\s*)+/i, '').trim();
                    throw new Error(errMsg);
                }

                // Cache newly computed index results in browser memory
                if (data.results && Array.isArray(data.results)) {
                    data.results.forEach(item => {
                        if (item && item.config) {
                            const key = getIndexParamKey(commonObj, item.config);
                            comparisonState.cachedIndices[key] = item;
                        }
                    });
                }
            }

            // Combine all results from browser memory in order of configured index rows
            const allResults = [];
            comparisonState.indexRows.forEach((r, idx) => {
                const key = getIndexParamKey(commonObj, r);
                const cached = comparisonState.cachedIndices[key];
                if (cached) {
                    const item = JSON.parse(JSON.stringify(cached));
                    item.id = r.id || `idx_${idx + 1}`;
                    item.color = r.color || item.color;
                    const stats = extractTradeStats(item);
                    item.total_buys = stats.total_buys;
                    item.total_sells = stats.total_sells;
                    item.total_trades = stats.total_trades;
                    item.unique_stocks_count = stats.unique_stocks_count;
                    allResults.push(item);
                }
            });

            if (allResults.length === 0) {
                throw new Error('No simulation results could be assembled for the configured indices.');
            }

            // Build Leaderboard Summary Rows from combined results
            const allSummary = allResults.map((res, idx) => {
                const kpis = res.kpis || {};
                const cfg = res.config || {};
                const pts = res.points || [];
                const totalInvested = pts.length > 0 ? pts[pts.length - 1].invested : amount;
                const finalVal = kpis.current_value || (pts.length > 0 ? pts[pts.length - 1].portfolio_value : totalInvested);
                const totPnl = kpis.total_return_amount !== undefined ? kpis.total_return_amount : (finalVal - totalInvested);
                const totPnlPct = kpis.total_return_percent !== undefined ? kpis.total_return_percent : (totalInvested > 0 ? (totPnl / totalInvested) * 100 : 0);
                const maxDd = kpis.max_drawdown || {};
                const maxBelow = kpis.max_drilldown_below_investment || {};
                const tradeStats = extractTradeStats(res);

                res.total_buys = tradeStats.total_buys;
                res.total_sells = tradeStats.total_sells;
                res.total_trades = tradeStats.total_trades;
                res.unique_stocks_count = tradeStats.unique_stocks_count;
                if (res.kpis) {
                    res.kpis.total_buys = tradeStats.total_buys;
                    res.kpis.total_sells = tradeStats.total_sells;
                    res.kpis.total_trades = tradeStats.total_trades;
                    res.kpis.unique_stocks_count = tradeStats.unique_stocks_count;
                }

                return {
                    id: res.id || `idx_${idx + 1}`,
                    index_id: res.index_id || '',
                    index_name: res.index_name || 'Index',
                    color: res.color || '#3b82f6',
                    no_of_stocks: cfg.no_of_stocks,
                    exit_regime_ranking: cfg.exit_regime_ranking,
                    rebalance_day: cfg.rebalance_day,
                    trim_existing: cfg.trim_existing,
                    trading_days_per_month: cfg.trading_days_per_month,
                    final_valuation: Math.round(finalVal * 100) / 100,
                    total_invested: Math.round(totalInvested * 100) / 100,
                    stepup_amount: stepup,
                    total_pnl: Math.round(totPnl * 100) / 100,
                    total_pnl_percent: Math.round(totPnlPct * 100) / 100,
                    cagr: Math.round((kpis.cagr !== undefined ? kpis.cagr : totPnlPct) * 100) / 100,
                    max_drawdown_percent: Math.round((maxDd.max_drawdown_percent || 0) * 100) / 100,
                    max_drawdown_amount: Math.round((maxDd.drawdown_amount || 0) * 100) / 100,
                    max_drawdown_peak_date: maxDd.peak_date,
                    max_drawdown_trough_date: maxDd.trough_date,
                    max_below_investment_percent: Math.round((maxBelow.max_deficit_percent || 0) * 100) / 100,
                    max_below_investment_amount: Math.round((maxBelow.max_deficit_amount || 0) * 100) / 100,
                    max_below_investment_date: maxBelow.date,
                    win_rate: Math.round((kpis.win_rate || 0) * 100) / 100,
                    rebalances_count: res.rebalances_count || 0,
                    total_buys: tradeStats.total_buys,
                    total_sells: tradeStats.total_sells,
                    total_trades: tradeStats.total_trades,
                    unique_stocks_count: tradeStats.unique_stocks_count,
                    fees_paid: Math.round((res.total_fees || 0) * 100) / 100
                };
            });

            // Sort summary by highest total PnL %
            allSummary.sort((a, b) => b.total_pnl_percent - a.total_pnl_percent);
            allSummary.forEach((r, rIdx) => { r.rank = rIdx + 1; });

            const combinedPayload = {
                success: true,
                common: commonObj,
                results: allResults,
                summary: allSummary
            };

            comparisonState.simulationResults = combinedPayload;
            if (emptyNotice) emptyNotice.style.display = 'none';

            // Render Chart.js multi-line canvas
            renderComparisonMultiLineChart(combinedPayload);

            // Render Leaderboard Summary Table
            renderComparisonSummaryTable(combinedPayload.summary || []);

            // Automatically select and showcase Rank #1 (or first index)
            if (combinedPayload.results && combinedPayload.results.length > 0) {
                selectComparedIndexKPI(0);
            }

            hideComparisonTopError();

            if (uncachedRows.length > 0 && cachedCount > 0) {
                alertToast(`Simulated successfully! Reused ${cachedCount} browser-cached index results and computed ${uncachedRows.length} new index.`, 'success');
            } else if (uncachedRows.length === 0) {
                alertToast(`Loaded ${allResults.length} index comparison results instantly from browser cache!`, 'success');
            } else {
                alertToast(`Successfully simulated ${allResults.length} indices from MongoDB Atlas historical quotes!`, 'success');
            }
            if (comparisonState.isMinimized) updateIndexComparisonDockUI();

        } catch (e) {
            console.error('Error during index comparison simulation:', e);
            let cleanMsg = (e.message || 'Unknown error').replace(/^(?:Simulation failed:\s*)+/i, '').trim();
            if (!cleanMsg || cleanMsg === '1' || cleanMsg === 'true' || /^\d+$/.test(cleanMsg)) {
                cleanMsg = 'An unexpected calculation issue occurred during index simulation. Please verify date parameters or retry.';
            }
            showComparisonTopError(cleanMsg, 'Simulation Failed');
            alertToast(`Comparison Error: ${cleanMsg}`, 'error');
            if (emptyNotice) {
                emptyNotice.style.display = 'flex';
                const iconSpan = emptyNotice.querySelector('span:first-child');
                if (iconSpan) iconSpan.innerText = '⚠️';
                if (emptyText) emptyText.innerText = `Simulation failed: ${cleanMsg}`;
            }
            if (comparisonState.isMinimized) updateIndexComparisonDockUI();
        } finally {
            comparisonState.isRunning = false;
            if (comparisonState.isMinimized) updateIndexComparisonDockUI();
            if (runBtn) runBtn.disabled = false;
            if (runIcon) runIcon.innerText = '▶';
            if (runText) runText.innerText = 'Run Comparison';
        }
    }

    function renderComparisonMultiLineChart(data) {
        const canvas = document.getElementById('mscCompChartCanvas');
        if (!canvas) return;

        if (comparisonState.chartInstance) {
            comparisonState.chartInstance.destroy();
            comparisonState.chartInstance = null;
        }
        const existingCustomTip = document.getElementById('mscCompChartCustomTooltip');
        if (existingCustomTip) existingCustomTip.remove();

        const ctx = canvas.getContext('2d');
        const results = data.results || [];
        if (results.length === 0) return;

        // Collect all distinct dates sorted ascending
        const allDatesSet = new Set();
        results.forEach(res => {
            (res.points || []).forEach(pt => allDatesSet.add(pt.date));
        });
        const sortedDates = Array.from(allDatesSet).sort();
        const labels = sortedDates.map(d => formatDateDisplay(d));

        // Update chart header badge with explicit date range and point count
        const dateRangeBadge = document.getElementById('mscCompChartDateRangeBadge');
        if (dateRangeBadge && sortedDates.length > 0) {
            const firstDateDisp = formatDateDisplay(sortedDates[0]);
            const lastDateDisp = formatDateDisplay(sortedDates[sortedDates.length - 1]);
            dateRangeBadge.style.display = 'inline-block';
            dateRangeBadge.innerText = `📅 ${firstDateDisp} → ${lastDateDisp} (${sortedDates.length} milestones)`;
        } else if (dateRangeBadge) {
            dateRangeBadge.style.display = 'none';
        }

        const isDark = document.body.classList.contains('dark-theme') || document.documentElement.classList.contains('dark-theme') || true;

        // Build datasets for each index
        const datasets = results.map((res, resIdx) => {
            // Map valuations and eligible stock counts to sortedDates
            const dateMap = {};
            const eligibleMap = {};
            (res.points || []).forEach(pt => {
                dateMap[pt.date] = pt.portfolio_value;
                if (pt.eligible_count !== undefined && pt.eligible_count !== null) {
                    eligibleMap[pt.date] = pt.eligible_count;
                }
            });

            // Fallback default eligible count from points, constituents_count, or catalog
            const catalogItem = (comparisonState.indicesCatalog || []).find(c => c.id === res.index_id || c.name === res.index_name);
            const defaultEligible = (res.points || []).find(pt => pt.eligible_count !== undefined && pt.eligible_count > 0)?.eligible_count
                || res.constituents_count
                || (catalogItem ? catalogItem.stock_count : null);

            let lastVal = data.common.amount_to_invest;
            let lastEligible = defaultEligible;

            const eligibleSeries = sortedDates.map(d => {
                if (eligibleMap[d] !== undefined) {
                    lastEligible = eligibleMap[d];
                }
                return (lastEligible !== null && lastEligible !== undefined) ? lastEligible : defaultEligible;
            });

            const dataSeries = sortedDates.map(d => {
                if (dateMap[d] !== undefined) {
                    lastVal = dateMap[d];
                }
                return lastVal;
            });

            return {
                label: res.index_name,
                data: dataSeries,
                eligibleCounts: eligibleSeries,
                borderColor: res.color,
                backgroundColor: res.color,
                borderWidth: resIdx === 0 ? 3.2 : 2.8,
                tension: 0.22,
                fill: false,
                spanGaps: true,
                pointRadius: sortedDates.length > 50 ? 2.5 : 4.5,
                pointHoverRadius: 8,
                pointHitRadius: 14,
                pointBackgroundColor: res.color,
                pointBorderColor: '#ffffff',
                pointBorderWidth: 1.8,
                indexResultId: res.id,
                resultIndex: resIdx
            };
        });

        // Add Invested Capital Baseline (Dashed, steps up dynamically if step-up configured)
        const stepupAmt = Number(data.common.stepup_amount || 0);
        let baselineData;
        let baselineLabel;
        if (stepupAmt > 0 && results[0] && Array.isArray(results[0].points)) {
            const invMap = {};
            results[0].points.forEach(pt => {
                if (pt.invested !== undefined) invMap[pt.date] = pt.invested;
            });
            let lastInv = data.common.amount_to_invest;
            baselineData = sortedDates.map(d => {
                if (invMap[d] !== undefined) lastInv = invMap[d];
                return lastInv;
            });
            const finalInv = baselineData[baselineData.length - 1] || data.common.amount_to_invest;
            baselineLabel = `Invested Capital (₹${formatCurrency(data.common.amount_to_invest)} + ₹${formatCurrency(stepupAmt)}/mo → ₹${formatCurrency(finalInv)})`;
        } else {
            baselineData = sortedDates.map(() => data.common.amount_to_invest);
            baselineLabel = `Invested Baseline (₹${formatCurrency(data.common.amount_to_invest)})`;
        }

        datasets.push({
            label: baselineLabel,
            data: baselineData,
            borderColor: '#818cf8',
            borderWidth: 1.8,
            borderDash: [6, 4],
            fill: false,
            tension: 0,
            pointRadius: 0,
            pointHoverRadius: 0,
            isBaseline: true
        });

        // Create Chart.js instance with interactive onClick handler
        comparisonState.chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                // WHEN CLICKING GRAPH LINE OR POINT: SHOW APPROPRIATE KPI DATA
                onClick: function(evt, elements) {
                    if (!elements || elements.length === 0) return;
                    const dsIdx = elements[0].datasetIndex;
                    if (dsIdx < results.length) {
                        selectComparedIndexKPI(dsIdx);
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        enabled: false,
                        external: function(context) {
                            const { chart, tooltip } = context;
                            let tooltipEl = document.getElementById('mscCompChartCustomTooltip');
                            if (!tooltipEl) {
                                tooltipEl = document.createElement('div');
                                tooltipEl.id = 'mscCompChartCustomTooltip';
                                tooltipEl.style.position = 'absolute';
                                tooltipEl.style.pointerEvents = 'none';
                                tooltipEl.style.zIndex = '30';
                                tooltipEl.style.transition = 'opacity 0.12s ease, transform 0.12s ease';
                                tooltipEl.style.background = 'rgba(15, 23, 42, 0.96)';
                                tooltipEl.style.border = '1px solid rgba(255, 255, 255, 0.16)';
                                tooltipEl.style.borderRadius = '8px';
                                tooltipEl.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.6)';
                                tooltipEl.style.backdropFilter = 'blur(10px)';
                                tooltipEl.style.webkitBackdropFilter = 'blur(10px)';
                                tooltipEl.style.padding = '10px 14px';
                                tooltipEl.style.minWidth = '240px';
                                tooltipEl.style.maxWidth = '420px';
                                tooltipEl.style.boxSizing = 'border-box';
                                chart.canvas.parentNode.appendChild(tooltipEl);
                            }

                            if (tooltip.opacity === 0) {
                                tooltipEl.style.opacity = '0';
                                tooltipEl.style.display = 'none';
                                return;
                            }

                            const activeEls = chart.getActiveElements();
                            let dotX = tooltip.caretX;
                            let dotY = tooltip.caretY;
                            let activeDsIdx = -1;

                            if (activeEls && activeEls.length > 0) {
                                const ptEl = activeEls[0].element;
                                if (ptEl && typeof ptEl.x === 'number' && typeof ptEl.y === 'number') {
                                    dotX = ptEl.x;
                                    dotY = ptEl.y;
                                }
                                activeDsIdx = activeEls[0].datasetIndex;
                            }

                            if (tooltip.body && tooltip.dataPoints && tooltip.dataPoints.length > 0) {
                                const dataIndex = tooltip.dataPoints[0].dataIndex;
                                const dateLabel = labels[dataIndex] || (tooltip.title ? tooltip.title[0] : '');

                                let innerHtml = `<div style="font-size: 11px; font-weight: 700; color: #94a3b8; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 5px; display: flex; align-items: center; justify-content: space-between;">
                                    <span>📅 ${escapeHtml(dateLabel)}</span>
                                </div>`;

                                innerHtml += `<div style="display: flex; flex-direction: column; gap: 6px;">`;

                                tooltip.dataPoints.forEach(dp => {
                                    const ds = dp.dataset;
                                    const val = Number(dp.raw) || 0;
                                    const isHoveredLine = (dp.datasetIndex === activeDsIdx);
                                    if (ds.isBaseline) {
                                        innerHtml += `
                                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 11px; color: #94a3b8; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.1);">
                                                <span style="display: flex; align-items: center; gap: 5px;">
                                                    <span>🏁</span> <span>Invested Capital</span>
                                                </span>
                                                <span style="font-family: monospace; font-weight: 600; color: #cbd5e1;">₹${formatCurrency(val)}</span>
                                            </div>
                                        `;
                                    } else {
                                        const currentInv = baselineData[dataIndex] !== undefined ? baselineData[dataIndex] : data.common.amount_to_invest;
                                        const pnl = val - currentInv;
                                        const pnlPct = currentInv > 0 ? (pnl / currentInv) * 100 : 0;
                                        const isPos = pnl >= 0;
                                        const sign = isPos ? '+' : '';
                                        const pnlColor = isPos ? '#10b981' : '#ef4444';
                                        const pnlBg = isPos ? 'rgba(16, 185, 129, 0.16)' : 'rgba(239, 68, 68, 0.16)';
                                        const pnlBorder = isPos ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)';

                                        // Eligible stocks count at this date, e.g. "Nifty50 (49)"
                                        const elig = (ds.eligibleCounts && ds.eligibleCounts[dataIndex] !== undefined && ds.eligibleCounts[dataIndex] !== null)
                                            ? ds.eligibleCounts[dataIndex]
                                            : null;
                                        const displayLabel = elig !== null ? `${ds.label} (${elig})` : ds.label;
                                        const rowHighlightStyle = isHoveredLine 
                                            ? `background: rgba(255, 255, 255, 0.08); border-radius: 5px; padding: 3px 6px; border-left: 3px solid ${ds.borderColor};` 
                                            : `padding: 2px 0;`;

                                        innerHtml += `
                                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 11.5px; ${rowHighlightStyle}">
                                                <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                                                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${ds.borderColor}; flex-shrink: 0; ${isHoveredLine ? 'box-shadow: 0 0 6px ' + ds.borderColor + ';' : ''}"></span>
                                                    <span style="font-weight: ${isHoveredLine ? '700' : '600'}; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 175px;" title="${escapeHtml(displayLabel)}">${isHoveredLine ? '▸ ' : ''}${escapeHtml(displayLabel)}</span>
                                                </div>
                                                <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                                                    <span style="font-family: monospace; color: #e2e8f0; font-size: 11.5px; font-weight: 500;">₹${formatCurrency(val)}</span>
                                                    <span style="font-family: monospace; font-size: 11px; font-weight: 700; color: ${pnlColor}; background: ${pnlBg}; border: 1px solid ${pnlBorder}; padding: 1px 6px; border-radius: 4px; white-space: nowrap;">
                                                        ${sign}${pnlPct.toFixed(2)}%
                                                    </span>
                                                </div>
                                            </div>
                                        `;
                                    }
                                });

                                innerHtml += `</div>`;
                                tooltipEl.innerHTML = innerHtml;
                            }

                            const wrapRect = chart.canvas.parentNode.getBoundingClientRect();
                            const isNearTop = dotY < 150;

                            if (dotX > wrapRect.width - 210) {
                                tooltipEl.style.left = (dotX - 10) + 'px';
                                tooltipEl.style.transform = isNearTop ? 'translate(-100%, 14px)' : 'translate(-100%, -100%)';
                            } else if (dotX < 130) {
                                tooltipEl.style.left = (dotX + 10) + 'px';
                                tooltipEl.style.transform = isNearTop ? 'translate(0, 14px)' : 'translate(0, -100%)';
                            } else {
                                tooltipEl.style.left = dotX + 'px';
                                tooltipEl.style.transform = isNearTop ? 'translate(-50%, 14px)' : 'translate(-50%, -100%)';
                            }

                            tooltipEl.style.top = isNearTop ? (dotY + 'px') : ((dotY - 10) + 'px');
                            tooltipEl.style.display = 'block';
                            tooltipEl.style.opacity = '1';
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'
                        },
                        ticks: {
                            color: isDark ? '#94a3b8' : '#64748b',
                            font: { size: 11 },
                            maxRotation: 45,
                            autoSkip: true,
                            includeBounds: true,
                            maxTicksLimit: Math.min(14, labels.length)
                        }
                    },
                    y: {
                        grid: {
                            color: isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.07)'
                        },
                        ticks: {
                            color: isDark ? '#94a3b8' : '#64748b',
                            font: { size: 11, family: 'monospace' },
                            callback: function(value) {
                                return '₹' + formatCurrency(value);
                            }
                        }
                    }
                }
            }
        });

        // Render custom clickable legend pills
        renderComparisonLegendPills(results);
    }

    function renderComparisonLegendPills(results) {
        const legendContainer = document.getElementById('mscCompLegendPills');
        const selectorContainer = document.getElementById('mscCompPillSelector');

        if (legendContainer) {
            legendContainer.innerHTML = results.map((res, idx) => `
                <button type="button" class="msc-comp-pill" data-idx="${idx}" onclick="selectComparedIndexKPI(${idx})" style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; padding: 4px 10px; border-radius: 20px; background: rgba(15, 23, 42, 0.6); border: 1.5px solid ${res.color}; color: var(--text-primary); cursor: pointer; transition: all 0.15s ease;">
                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${res.color};"></span>
                    <strong>${escapeHtml(res.index_name)}</strong>
                </button>
            `).join('');
        }

        if (selectorContainer) {
            selectorContainer.innerHTML = results.map((res, idx) => `
                <button type="button" class="msc-comp-select-pill" id="compSelPill_${idx}" data-idx="${idx}" onclick="selectComparedIndexKPI(${idx})" style="display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; padding: 4px 12px; border-radius: 6px; background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-secondary); cursor: pointer; transition: all 0.15s ease;">
                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${res.color};"></span>
                    <span>${escapeHtml(res.index_name)}</span>
                </button>
            `).join('');
        }
    }

    function selectComparedIndexKPI(targetIdx) {
        if (!comparisonState.simulationResults || !comparisonState.simulationResults.results) return;
        const results = comparisonState.simulationResults.results;
        if (!results[targetIdx]) return;

        const sel = results[targetIdx];
        const kpis = sel.kpis || {};
        const cfg = sel.config || {};
        const finalVal = kpis.current_value || (sel.points && sel.points[sel.points.length - 1]?.portfolio_value) || 0;
        const invested = kpis.current_invested || comparisonState.simulationResults.common.amount_to_invest;
        const pnl = kpis.total_return_amount || (finalVal - invested);
        const pnlPct = kpis.total_return_percent || (invested > 0 ? (pnl / invested) * 100 : 0);
        const cagr = kpis.cagr || pnlPct;
        const winRate = kpis.win_rate || 0;

        const maxDd = kpis.max_drawdown || {};
        const maxBelow = kpis.max_drilldown_below_investment || {};

        // 1. Highlight chart dataset
        if (comparisonState.chartInstance) {
            comparisonState.chartInstance.data.datasets.forEach((ds, dIdx) => {
                if (ds.isBaseline) return;
                if (dIdx === targetIdx) {
                    ds.borderWidth = 3.8;
                    ds.pointRadius = 4.5;
                } else {
                    ds.borderWidth = 1.8;
                    ds.pointRadius = 2.0;
                }
            });
            comparisonState.chartInstance.update('none');
        }

        // 2. Update KPI Section Title & Badge
        const titleEl = document.getElementById('mscCompActiveTitle');
        const dotEl = document.getElementById('mscCompActiveDot');
        const badgeEl = document.getElementById('mscCompActiveBadge');

        if (titleEl) titleEl.innerText = `${sel.index_name} (Performance Metrics)`;
        if (dotEl) dotEl.style.background = sel.color;
        if (badgeEl) {
            badgeEl.innerText = `${cfg.no_of_stocks || 12} Picks • Exit ≤ ${cfg.exit_regime_ranking || 22} • Rebal ${cfg.rebalance_day || 21}th • Trim: ${cfg.trim_existing ? 'Yes' : 'No'} • ${cfg.trading_days_per_month || 21}d/mo`;
            badgeEl.style.color = sel.color;
            badgeEl.style.background = `${sel.color}22`;
        }

        // 3. Populate 4 KPI Stat Cards
        const pnlColor = pnl >= 0 ? '#10b981' : '#ef4444';
        const sign = pnl >= 0 ? '+' : '';

        const finalValEl = document.getElementById('compKpiFinalVal');
        const netPnlEl = document.getElementById('compKpiNetPnl');
        if (finalValEl) finalValEl.innerText = `₹${formatCurrency(finalVal)}`;
        if (netPnlEl) {
            netPnlEl.innerHTML = `<span style="color: ${pnlColor};">${sign}₹${formatCurrency(pnl)} (${sign}${pnlPct.toFixed(2)}%)</span> <span style="font-size: 11px; color: var(--text-secondary); font-weight: normal; margin-left: 4px;">(Invested: ₹${formatCurrency(invested)})</span>`;
        }

        const cagrEl = document.getElementById('compKpiCagr');
        const winRateEl = document.getElementById('compKpiWinRate');
        const tradesCountEl = document.getElementById('compKpiTradesCount');
        const tradeStats = extractTradeStats(sel);
        const totalBuys = tradeStats.total_buys;
        const totalSells = tradeStats.total_sells;
        const totalTrades = tradeStats.total_trades;
        const uniqueStocks = tradeStats.unique_stocks_count;

        if (cagrEl) {
            cagrEl.innerText = `${cagr.toFixed(2)}%`;
            cagrEl.style.color = cagr >= 0 ? '#10b981' : '#ef4444';
        }
        if (winRateEl) {
            winRateEl.innerText = `Win Rate: ${winRate.toFixed(1)}% • ${sel.rebalances_count || 0} Rebalance runs`;
        }
        if (tradesCountEl) {
            tradesCountEl.innerHTML = `<span style="color: #10b981; font-weight: 600;">${totalBuys} Buys</span> / <span style="color: #ef4444; font-weight: 600;">${totalSells} Sells</span> <span style="color: var(--text-secondary); font-size: 10px;">(${totalTrades} trades)</span> &bull; <span style="color: var(--text-primary); font-weight: 600;">${uniqueStocks} Unique Stocks</span>`;
        }

        const maxDdEl = document.getElementById('compKpiMaxDd');
        const maxDdDetailsEl = document.getElementById('compKpiMaxDdDetails');
        if (maxDdEl) {
            maxDdEl.innerText = `${Number(maxDd.max_drawdown_percent || 0).toFixed(2)}%`;
        }
        if (maxDdDetailsEl) {
            if (maxDd.peak_date && maxDd.trough_date) {
                maxDdDetailsEl.innerText = `Peak ₹${formatCurrency(maxDd.peak_value)} (${formatDateDisplay(maxDd.peak_date)}) → Trough ₹${formatCurrency(maxDd.trough_value)} (${formatDateDisplay(maxDd.trough_date)})`;
            } else {
                maxDdDetailsEl.innerText = `Max drop: -₹${formatCurrency(Math.abs(maxDd.drawdown_amount || 0))}`;
            }
        }

        const belowInvEl = document.getElementById('compKpiBelowInv');
        const belowInvDetailsEl = document.getElementById('compKpiBelowInvDetails');
        if (belowInvEl) {
            const deficitPct = Number(maxBelow.max_deficit_percent || 0);
            belowInvEl.innerText = `${deficitPct.toFixed(2)}%`;
            belowInvEl.style.color = deficitPct < 0 ? '#ef4444' : '#10b981';
        }
        if (belowInvDetailsEl) {
            if (maxBelow.was_ever_below) {
                belowInvDetailsEl.innerText = `Deepest deficit: -₹${formatCurrency(Math.abs(maxBelow.max_deficit_amount || 0))} on ${formatDateDisplay(maxBelow.date)}`;
            } else {
                belowInvDetailsEl.innerText = '✨ Never dropped below initial invested capital!';
            }
        }

        // 4. Update selector pills active state
        results.forEach((_, pIdx) => {
            const pEl = document.getElementById(`compSelPill_${pIdx}`);
            if (pEl) {
                if (pIdx === targetIdx) {
                    pEl.style.background = 'rgba(99, 102, 241, 0.18)';
                    pEl.style.borderColor = sel.color;
                    pEl.style.color = 'var(--text-primary)';
                    pEl.style.fontWeight = '700';
                } else {
                    pEl.style.background = 'var(--bg-card)';
                    pEl.style.borderColor = 'var(--border-color)';
                    pEl.style.color = 'var(--text-secondary)';
                    pEl.style.fontWeight = 'normal';
                }
            }
        });

        // 5. Highlight row in summary table
        const tbody = document.getElementById('mscCompSummaryTbody');
        if (tbody) {
            const rows = tbody.querySelectorAll('tr');
            rows.forEach(r => {
                if (r.getAttribute('data-index-id') === sel.id) {
                    r.style.background = 'rgba(99, 102, 241, 0.12)';
                } else {
                    r.style.background = 'transparent';
                }
            });
        }
    }

    function renderComparisonSummaryTable(summaryRows) {
        const tbody = document.getElementById('mscCompSummaryTbody');
        if (!tbody) return;

        if (!summaryRows || summaryRows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px; color: var(--text-secondary);">No simulation executed yet.</td></tr>';
            return;
        }

        tbody.innerHTML = summaryRows.map((row) => {
            const pnlColor = row.total_pnl >= 0 ? '#10b981' : '#ef4444';
            const sign = row.total_pnl >= 0 ? '+' : '';
            const cagrColor = row.cagr >= 0 ? '#10b981' : '#ef4444';
            const belowColor = row.max_below_investment_percent < 0 ? '#ef4444' : '#10b981';

            // Find matching index in results array for onclick and stats fallback
            const resIdx = (comparisonState.simulationResults?.results || []).findIndex(r => r.id === row.id || (r.index_id && r.index_id === row.index_id));
            const matchingRes = resIdx >= 0 ? comparisonState.simulationResults.results[resIdx] : null;
            const sourceObj = matchingRes || row;
            const stats = extractTradeStats(sourceObj);
            const rowBuys = Number(row.total_buys != null && row.total_buys > 0 ? row.total_buys : (matchingRes?.total_buys || stats.total_buys || 0));
            const rowSells = Number(row.total_sells != null && row.total_sells > 0 ? row.total_sells : (matchingRes?.total_sells || stats.total_sells || 0));
            const rowTrades = Number(row.total_trades != null && row.total_trades > 0 ? row.total_trades : (matchingRes?.total_trades || stats.total_trades || (rowBuys + rowSells)));
            const rowUnique = Number(row.unique_stocks_count != null && row.unique_stocks_count > 0 ? row.unique_stocks_count : (matchingRes?.unique_stocks_count || stats.unique_stocks_count || (rowBuys > 0 ? rowBuys : 0)));

            return `
                <tr data-index-id="${escapeHtml(row.id)}" style="border-bottom: 1px solid var(--border-color); cursor: pointer; transition: background 0.15s ease;" onclick="selectComparedIndexKPI(${resIdx >= 0 ? resIdx : 0})" onmouseover="this.style.background='rgba(255, 255, 255, 0.04)'" onmouseout="if(comparisonState.chartInstance && comparisonState.chartInstance.data.datasets[${resIdx}] && comparisonState.chartInstance.data.datasets[${resIdx}].borderWidth < 3.5) this.style.background='transparent'">
                    <td style="text-align: center; font-weight: 700; color: ${row.color}; font-size: 13px;">
                        #${row.rank}
                    </td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 7px;">
                            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${row.color};"></span>
                            <strong style="color: var(--text-primary); font-size: 12.5px;">${escapeHtml(row.index_name)}</strong>
                        </div>
                    </td>
                    <td>
                        <div style="font-size: 11px; color: var(--text-secondary);">
                            <span style="color: #10b981; font-weight: 600;">${row.no_of_stocks} Picks</span> &bull; 
                            Exit &le; ${row.exit_regime_ranking} &bull; 
                            ${row.rebalance_day}th rebal &bull; 
                            Trim: ${row.trim_existing ? 'Yes' : 'No'} &bull; 
                            ${row.trading_days_per_month}d
                        </div>
                    </td>
                    <td style="text-align: right; font-family: monospace; font-weight: 700; color: var(--text-primary);">
                        <div>₹${formatCurrency(row.final_valuation)}</div>
                        ${row.total_invested ? `<div style="font-size: 10px; color: var(--text-secondary); font-weight: normal; margin-top: 1px;">Inv: ₹${formatCurrency(row.total_invested)}</div>` : ''}
                    </td>
                    <td style="text-align: right; font-family: monospace; font-weight: 700; color: ${pnlColor};">
                        ${sign}₹${formatCurrency(row.total_pnl)} (${sign}${Number(row.total_pnl_percent).toFixed(2)}%)
                    </td>
                    <td style="text-align: right; font-family: monospace; font-weight: 600; color: ${cagrColor};">
                        ${Number(row.cagr).toFixed(2)}%
                    </td>
                    <td style="text-align: right; font-family: monospace; font-weight: 600; color: #ef4444;">
                        ${Number(row.max_drawdown_percent).toFixed(2)}%
                    </td>
                    <td style="text-align: right; font-family: monospace; font-weight: 600; color: ${belowColor};">
                        ${Number(row.max_below_investment_percent).toFixed(2)}%
                    </td>
                    <td style="text-align: right; font-family: monospace; font-weight: 600; color: var(--text-primary);">
                        ${Number(row.win_rate).toFixed(1)}%
                    </td>
                    <td style="text-align: right; font-size: 11px;">
                        <div><span style="color: #10b981; font-weight: 600;">${rowBuys}B</span> / <span style="color: #ef4444; font-weight: 600;">${rowSells}S</span> <span style="color: var(--text-secondary); font-size: 10px;">(${rowTrades})</span></div>
                        <div style="color: var(--text-secondary); font-size: 10px; margin-top: 1px;">${rowUnique} unique stocks</div>
                    </td>
                    <td style="text-align: center;">
                        <button type="button" class="btn-secondary" onclick="event.stopPropagation(); selectComparedIndexKPI(${resIdx >= 0 ? resIdx : 0})" style="font-size: 11px; padding: 3px 8px; color: ${row.color}; border-color: ${row.color}55;">
                            Inspect
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // =========================================================================
    // EXPOSE TO GLOBAL SCOPE
    // =========================================================================
    window.openIndexComparisonModal = openIndexComparisonModal;
    window.minimizeIndexComparisonModal = minimizeIndexComparisonModal;
    window.restoreIndexComparisonModal = restoreIndexComparisonModal;
    window.closeIndexComparisonModal = closeIndexComparisonModal;
    window.closeIndexComparisonDock = closeIndexComparisonDock;
    window.addComparisonIndexRow = addComparisonIndexRow;
    window.removeComparisonIndexRow = removeComparisonIndexRow;
    window.updateComparisonRowUniverse = updateComparisonRowUniverse;
    window.runIndexComparisonSimulation = runIndexComparisonSimulation;
    window.selectComparedIndexKPI = selectComparedIndexKPI;

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
    window.handleLogTransactionsDateChange = handleLogTransactionsDateChange;
    window.clearLogTransactionsDateFilter = clearLogTransactionsDateFilter;
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
