/**
 * Capital Desk - Shareholding Patterns Module
 * Location: modules/shareholding/shareholding.js
 * Handles data rendering, searching, filtering, sorting on all percentage categories,
 * QoQ comparison, pagination, and manual rate-limited refresh.
 */

(function () {
    'use strict';

    let currentBoard = 'all';
    let currentCategory = 'all';
    let currentCustomQuery = '';
    let currentScope = 'all';
    let currentSearch = '';
    let currentSortKey = 'broadcastDate';
    let currentSortDir = 'desc';
    let currentPage = 1;
    let pageSize = 50;
    let totalPages = 1;
    let searchDebounceTimer = null;
    let validationTimer = null;
    let isFetching = false;

    const rowsEl = document.getElementById('shp-rows');
    const searchInput = document.getElementById('shp-search-input');
    const refreshBtn = document.getElementById('shp-refresh-btn');
    const refreshIcon = document.getElementById('shp-refresh-icon');
    const updatedLabel = document.getElementById('shp-updated-label');
    const windowLabel = document.getElementById('shp-window-label');
    const noticeEl = document.getElementById('shp-notice');
    const prevBtn = document.getElementById('shp-prev-btn');
    const nextBtn = document.getElementById('shp-next-btn');
    const pageSelect = document.getElementById('shp-page-size-select');
    const pageDisplay = document.getElementById('shp-page-display');
    const pageInfo = document.getElementById('shp-pagination-info');

    // Counts
    const countAllEl = document.getElementById('shp-count-all');
    const countMbEl = document.getElementById('shp-count-mainboard');
    const countSmeEl = document.getElementById('shp-count-sme');

    // Remarks Modal elements
    const remarksModal = document.getElementById('shp-remarks-modal');
    const remarksModalTitle = document.getElementById('shp-modal-title');
    const remarksModalBody = document.getElementById('shp-modal-body');
    const remarksModalClose = document.getElementById('shp-modal-close');
    const remarksModalOk = document.getElementById('shp-modal-ok');

    // Custom Query Modal elements
    const customChip = document.getElementById('shp-chip-custom');
    const customModal = document.getElementById('shp-custom-modal');
    const customModalClose = document.getElementById('shp-custom-modal-close');
    const customQueryInput = document.getElementById('shp-custom-query-input');
    const customQueryFeedback = document.getElementById('shp-custom-query-feedback');
    const customClearInput = document.getElementById('shp-custom-clear-input');
    const customApplyBtn = document.getElementById('shp-custom-apply-btn');
    const customResetBtn = document.getElementById('shp-custom-reset-btn');
    const customCancelBtn = document.getElementById('shp-custom-cancel-btn');
    const applyCountBadge = document.getElementById('shp-apply-count-badge');

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[char];
        });
    }

    function showNotice(msg, type = 'info', durationMs = 6000) {
        if (!noticeEl) return;
        noticeEl.textContent = msg;
        noticeEl.style.display = 'block';
        if (type === 'error') {
            noticeEl.style.background = 'rgba(239, 68, 68, 0.12)';
            noticeEl.style.color = '#ef4444';
            noticeEl.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        } else if (type === 'success') {
            noticeEl.style.background = 'rgba(16, 185, 129, 0.12)';
            noticeEl.style.color = '#10b981';
            noticeEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
        } else {
            noticeEl.style.background = 'rgba(59, 130, 246, 0.12)';
            noticeEl.style.color = '#3b82f6';
            noticeEl.style.border = '1px solid rgba(59, 130, 246, 0.3)';
        }
        if (durationMs > 0) {
            setTimeout(function () {
                if (noticeEl) noticeEl.style.display = 'none';
            }, durationMs);
        }
    }

    function updateSortHeaders() {
        document.querySelectorAll('#tab-shareholding .sortable-th').forEach(function (th) {
            const key = th.dataset.sortKey;
            const icon = th.querySelector('.sort-icon');
            if (key === currentSortKey) {
                th.classList.add('active-sort');
                if (icon) icon.textContent = currentSortDir === 'asc' ? '▲' : '▼';
            } else {
                th.classList.remove('active-sort');
                if (icon) icon.textContent = '↕';
            }
        });
    }

    function formatQuarterMonthYear(dateStr) {
        if (!dateStr || typeof dateStr !== 'string') return '';
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            const mon = parts[1].toUpperCase();
            const yr = parts[2].slice(-2);
            const monthNames = {
                'JAN': 'January', 'FEB': 'February', 'MAR': 'March',
                'APR': 'April', 'MAY': 'May', 'JUN': 'June',
                'JUL': 'July', 'AUG': 'August', 'SEP': 'September',
                'OCT': 'October', 'NOV': 'November', 'DEC': 'December'
            };
            const m = monthNames[mon] || mon;
            return `${m} ${yr}`;
        }
        return dateStr;
    }

    function getChangeTooltip(chg, prevVal, prevDate) {
        if (chg === null || chg === undefined || isNaN(Number(chg))) {
            return 'Previous quarter comparison not available';
        }
        const num = Number(chg);
        const qtrStr = formatQuarterMonthYear(prevDate);
        const prevText = (prevVal != null && !isNaN(Number(prevVal)))
            ? `${Number(prevVal).toFixed(2)}%${qtrStr ? ' ' + qtrStr : ''}`
            : '';
        const prevPart = prevText ? ` (previous: ${prevText})` : '';

        if (num > 0) {
            return `Increased by ${num.toFixed(2)}% QoQ${prevPart}`;
        } else if (num < 0) {
            return `Decreased by ${Math.abs(num).toFixed(2)}% QoQ${prevPart}`;
        } else {
            return `Unchanged at 0.00% QoQ${prevPart}`;
        }
    }

    function formatPctCell(val, fillClass) {
        if (val === null || val === undefined || isNaN(Number(val))) {
            return '<span style="color: var(--text-secondary); opacity: 0.5;">—</span>';
        }
        const num = Number(val);
        const barClass = (fillClass === 'promoter' && num > 75) ? 'warning' : fillClass;
        return `
            <div class="shp-pct-cell">
                <span class="shp-pct-val">${num.toFixed(2)}%</span>
                <div class="shp-bar-wrap">
                    <div class="shp-bar-fill ${barClass}" style="width: ${Math.min(100, Math.max(0, num))}%;"></div>
                </div>
            </div>
        `;
    }

    function formatChangePill(chg, prevVal, prevDate) {
        if (chg === null || chg === undefined || isNaN(Number(chg))) {
            return '<span class="shp-chg-pill na" title="Previous quarter comparison not available">—</span>';
        }
        const num = Number(chg);
        const tooltip = getChangeTooltip(chg, prevVal, prevDate);
        if (num > 0) {
            return `<span class="shp-chg-pill pos" title="${escapeHtml(tooltip)}">+${num.toFixed(2)}%</span>`;
        } else if (num < 0) {
            return `<span class="shp-chg-pill neg" title="${escapeHtml(tooltip)}">${num.toFixed(2)}%</span>`;
        } else {
            return `<span class="shp-chg-pill zero" title="${escapeHtml(tooltip)}">0.00%</span>`;
        }
    }

    function renderRow(record) {
        const symbol = escapeHtml(record.symbol || '');
        const name = escapeHtml(record.name || symbol);
        const isin = escapeHtml(record.isin || '');
        const board = (record.board || 'Mainboard').toLowerCase() === 'sme' ? 'SME' : 'Mainboard';
        const boardClass = board.toLowerCase();

        const quarter = escapeHtml(record.date || '—');
        const prevQuarter = record.prev_date ? `vs ${escapeHtml(record.prev_date)}` : '';
        const submissionDate = escapeHtml(record.submissionDate || '—');
        const broadcastDate = escapeHtml(record.broadcastDate || record.systemDate || submissionDate);
        const prevDate = record.prev_date || '';

        // Core Percentages
        const promoterPct = record.promoter_pct != null ? record.promoter_pct : (record.pr_and_prgrp != null ? Number(record.pr_and_prgrp) : null);
        const fiiPct = record.fii_pct != null ? record.fii_pct : null;
        const diiPct = record.dii_pct != null ? record.dii_pct : null;
        const publicPct = record.public_pct != null ? record.public_pct : (record.public_val != null ? Number(record.public_val) : null);

        // QoQ Changes
        const chgPromoter = record.change_promoter_pct;
        const chgFii = record.change_fii_pct;
        const chgDii = record.change_dii_pct;
        const chgPublic = record.change_public_pct;

        const tipPromoter = getChangeTooltip(chgPromoter, record.prev_promoter_pct, prevDate);
        const tipFii = getChangeTooltip(chgFii, record.prev_fii_pct, prevDate);
        const tipDii = getChangeTooltip(chgDii, record.prev_dii_pct, prevDate);
        const tipPublic = getChangeTooltip(chgPublic, record.prev_public_pct, prevDate);

        // Remarks
        const rawRemarks = record.remarksWeb || '';
        const hasRemarks = rawRemarks && rawRemarks.trim().toLowerCase() !== 'n' && rawRemarks.trim() !== '-';
        let remarksHtml = '<span style="color: var(--text-secondary); opacity: 0.4;">—</span>';
        if (hasRemarks) {
            const shortRemark = rawRemarks.length > 25 ? rawRemarks.substring(0, 22) + '…' : rawRemarks;
            remarksHtml = `
                <button type="button" class="shp-remarks-btn" data-record-id="${escapeHtml(record.recordId)}" title="Click to view complete disclosure note">
                    📝 ${escapeHtml(shortRemark)}
                </button>
            `;
        }

        // XBRL link
        let xbrlHtml = '<span style="color: var(--text-secondary); opacity: 0.4;">—</span>';
        if (record.xbrl) {
            const sizeStr = record.xbrlFileSize ? ` (${escapeHtml(record.xbrlFileSize)})` : '';
            xbrlHtml = `
                <a href="${escapeHtml(record.xbrl)}" target="_blank" rel="noopener noreferrer" class="shp-xbrl-link" title="Download official NSE XBRL XML file${sizeStr}">
                    <span>XML</span> ↗
                </a>
            `;
        }

        return `
            <tr>
                <td class="shp-col-company">
                    <span class="shp-comp-title" onclick="if(window.openFundamentalsModal) window.openFundamentalsModal('${symbol}');" title="Click to view ${name} fundamentals">
                        ${name}
                    </span>
                    <span class="shp-symbol-badge">${symbol}</span>
                    <div class="shp-sub-details">
                        <span class="shp-board-tag ${boardClass}">${board}</span>
                    </div>
                </td>
                <td>
                    <span class="shp-quarter-badge">${quarter}</span>
                    ${prevQuarter ? `<div class="shp-prev-date-sub">${prevQuarter}</div>` : ''}
                </td>
                <!-- Promoter -->
                <td>${formatPctCell(promoterPct, 'promoter')}</td>
                <td title="${escapeHtml(tipPromoter)}">${formatChangePill(chgPromoter, record.prev_promoter_pct, prevDate)}</td>
                <!-- FII -->
                <td>${formatPctCell(fiiPct, 'fii')}</td>
                <td title="${escapeHtml(tipFii)}">${formatChangePill(chgFii, record.prev_fii_pct, prevDate)}</td>
                <!-- DII -->
                <td>${formatPctCell(diiPct, 'dii')}</td>
                <td title="${escapeHtml(tipDii)}">${formatChangePill(chgDii, record.prev_dii_pct, prevDate)}</td>
                <!-- Public -->
                <td>${formatPctCell(publicPct, 'public')}</td>
                <td title="${escapeHtml(tipPublic)}">${formatChangePill(chgPublic, record.prev_public_pct, prevDate)}</td>
                <!-- Filing Date -->
                <td>
                    <div style="font-weight: 600; color: var(--text-primary); font-size: 11.5px;">${submissionDate}</div>
                    <div style="font-size: 10px; color: var(--text-secondary); margin-top: 2px;">${broadcastDate}</div>
                </td>
                <!-- Disclosures & Remarks -->
                <td>${remarksHtml}</td>
                <!-- Filing Download -->
                <td style="text-align: center;">${xbrlHtml}</td>
            </tr>
        `;
    }

    let refreshPollTimer = null;

    async function safeFetchJson(url, options = {}) {
        const res = await fetch(url, {
            ...options,
            headers: {
                'Accept': 'application/json',
                ...(options.headers || {})
            }
        });

        if (res.status === 401) {
            showNotice('Your session has expired. Please log in again.', 'warning', 6000);
            setTimeout(() => { window.location.href = '/login'; }, 1500);
            throw new Error('Session expired (HTTP 401). Redirecting to login...');
        }

        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        let data;
        if (contentType.includes('application/json')) {
            try {
                data = await res.json();
            } catch (err) {
                throw new Error('Malformed JSON received from server.');
            }
        } else {
            const rawText = await res.text();
            if (rawText.trim().startsWith('<') || rawText.includes('<html')) {
                if (res.status === 504 || rawText.includes('504')) {
                    throw new Error('Gateway Timeout (504). External exchange feed took too long to respond.');
                }
                if (res.status === 502 || rawText.includes('502')) {
                    throw new Error('Bad Gateway (502). Upstream server is temporarily unavailable.');
                }
                throw new Error(`Server returned an HTML response (HTTP ${res.status}). Service may be temporarily busy; please retry shortly.`);
            }
            try {
                data = JSON.parse(rawText);
            } catch (err) {
                throw new Error(`Invalid response format from server (HTTP ${res.status}).`);
            }
        }

        if (!res.ok && data && (data.error || data.message)) {
            throw new Error(data.error || data.message);
        }
        return data;
    }

    function loadShareholding(targetPage) {
        if (targetPage !== undefined) currentPage = targetPage;
        if (!rowsEl) return;

        rowsEl.innerHTML = '<tr><td class="table-message" colspan="13" style="text-align: center; padding: 30px; color: var(--text-secondary);">Loading records…</td></tr>';
        updateSortHeaders();

        const params = new URLSearchParams({
            board: currentBoard,
            category: currentCategory,
            scope: currentScope,
            search: currentSearch,
            sort_key: currentSortKey,
            sort_dir: currentSortDir,
            page: currentPage,
            page_size: pageSize
        });
        if (currentCustomQuery && currentCategory === 'custom') {
            params.set('custom_query', currentCustomQuery);
        }

        safeFetchJson(`/api/shareholding/data?${params.toString()}`)
            .then(data => {
                if (data.error) {
                    rowsEl.innerHTML = `<tr><td class="table-message" colspan="13" style="text-align: center; padding: 30px; color: #ef4444;">Error: ${escapeHtml(data.error)}</td></tr>`;
                    return;
                }

                // Update Status & Counts
                const st = data.status || {};
                if (updatedLabel && st.last_synced_display) {
                    updatedLabel.textContent = `Synced: ${st.last_synced_display}`;
                }
                const counts = data.counts || st;
                if (countAllEl && (counts.all !== undefined || st.total_records !== undefined)) {
                    countAllEl.textContent = (counts.all !== undefined ? counts.all : st.total_records).toLocaleString();
                }
                if (countMbEl && (counts.mainboard !== undefined || st.count_equities !== undefined)) {
                    countMbEl.textContent = (counts.mainboard !== undefined ? counts.mainboard : st.count_equities).toLocaleString();
                }
                if (countSmeEl && (counts.sme !== undefined || st.count_sme !== undefined)) {
                    countSmeEl.textContent = (counts.sme !== undefined ? counts.sme : st.count_sme).toLocaleString();
                }

                // Dynamically update header quarter badge (e.g. Sep 26 vs Jun 26)
                if (data.two_quarters_label) {
                    const qBadge = document.getElementById('shp-quarter-badge');
                    if (qBadge) {
                        qBadge.textContent = data.two_quarters_label;
                        qBadge.style.display = 'inline-block';
                    }
                }

                const records = data.records || [];
                const pag = data.pagination || {};
                totalPages = pag.total_pages || 1;

                if (records.length === 0) {
                    let emptyMsg = 'No shareholding records match your filter criteria.';
                    if (currentScope === 'portfolio') {
                        emptyMsg = 'No stocks in your portfolio found in shareholding records.';
                    } else if (currentScope === 'watchlist') {
                        emptyMsg = 'No stocks in your watchlists found in shareholding records.';
                    }
                    rowsEl.innerHTML = `<tr><td class="table-message" colspan="13" style="text-align: center; padding: 40px; color: var(--text-secondary);">${emptyMsg} Click "Refresh" to fetch latest filings.</td></tr>`;
                } else {
                    rowsEl.innerHTML = records.map(renderRow).join('');
                }

                // Attach remarks click listeners
                document.querySelectorAll('#shp-rows .shp-remarks-btn').forEach(btn => {
                    btn.addEventListener('click', function () {
                        const recId = btn.dataset.recordId;
                        const match = records.find(r => String(r.recordId) === recId);
                        if (match) {
                            openRemarksModal(match);
                        }
                    });
                });

                // Update Pagination Controls
                if (pageInfo) {
                    const total = pag.total_records || 0;
                    const start = total > 0 ? (currentPage - 1) * pageSize + 1 : 0;
                    const end = Math.min(start + pageSize - 1, total);
                    pageInfo.textContent = `Showing ${start.toLocaleString()} to ${end.toLocaleString()} of ${total.toLocaleString()} records`;
                }
                if (pageDisplay) {
                    pageDisplay.textContent = `${currentPage} / ${totalPages}`;
                }
                if (prevBtn) prevBtn.disabled = !pag.has_prev;
                if (nextBtn) nextBtn.disabled = !pag.has_next;
            })
            .catch(err => {
                rowsEl.innerHTML = `<tr><td class="table-message" colspan="13" style="text-align: center; padding: 30px; color: #ef4444;">Failed to load data: ${escapeHtml(err.message)}</td></tr>`;
            });
    }

    async function manualRefresh() {
        if (isFetching) return;
        isFetching = true;

        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.classList.add('shp-refreshing');
        }
        if (refreshIcon) refreshIcon.classList.add('spinning');

        try {
            const result = await safeFetchJson('/api/shareholding/refresh?force=true', { method: 'POST' });

            if (result.status === 'throttled') {
                showNotice(`⏳ ${result.message}`, 'info', 7000);
                isFetching = false;
                if (refreshBtn) {
                    refreshBtn.disabled = false;
                    refreshBtn.classList.remove('shp-refreshing');
                }
                if (refreshIcon) refreshIcon.classList.remove('spinning');
                return;
            }

            if (result.status === 'started' || result.status === 'in_progress') {
                showNotice(`⏳ ${result.message || 'Refreshing shareholding filings in the background...'}`, 'info', 6000);
                pollRefreshStatus();
                return;
            }

            if (result.status === 'success') {
                showNotice(`✓ ${result.message}`, 'success', 6000);
                currentPage = 1;
                loadShareholding();
            } else {
                showNotice(`Notice: ${result.message || 'Refresh completed.'}`, 'info', 6000);
                currentPage = 1;
                loadShareholding();
            }

            isFetching = false;
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.classList.remove('shp-refreshing');
            }
            if (refreshIcon) refreshIcon.classList.remove('spinning');
        } catch (err) {
            showNotice(`Refresh error: ${err.message}`, 'error', 6000);
            isFetching = false;
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.classList.remove('shp-refreshing');
            }
            if (refreshIcon) refreshIcon.classList.remove('spinning');
        }
    }

    async function pollRefreshStatus() {
        if (refreshPollTimer) clearTimeout(refreshPollTimer);

        try {
            const data = await safeFetchJson('/api/shareholding/status');
            if (data.is_refreshing) {
                refreshPollTimer = setTimeout(pollRefreshStatus, 2500);
            } else {
                isFetching = false;
                if (refreshBtn) {
                    refreshBtn.disabled = false;
                    refreshBtn.classList.remove('shp-refreshing');
                }
                if (refreshIcon) refreshIcon.classList.remove('spinning');

                if (data.last_error) {
                    showNotice(`Refresh note: ${data.last_error}`, 'warning', 7000);
                } else if (data.last_result && data.last_result.message) {
                    showNotice(`✓ ${data.last_result.message}`, 'success', 5000);
                } else {
                    showNotice('✓ Latest shareholding filings synchronized!', 'success', 5000);
                }
                currentPage = 1;
                loadShareholding();
            }
        } catch (e) {
            console.error('Error polling shareholding status:', e);
            refreshPollTimer = setTimeout(pollRefreshStatus, 3000);
        }
    }

    function openRemarksModal(record) {
        if (!remarksModal) return;
        const comp = record.name || record.symbol || 'Company';
        if (remarksModalTitle) {
            remarksModalTitle.textContent = `${comp} (${record.symbol}) - Disclosures & Remarks`;
        }
        let fullRemarks = record.remarksWeb || 'No general remarks provided.';
        if (record.promoterDematNotes) {
            fullRemarks += `\n\n[Promoter Demat Notes]:\n${record.promoterDematNotes}`;
        }
        if (record.publicShareholdingNotes) {
            fullRemarks += `\n\n[Public Shareholding Notes]:\n${record.publicShareholdingNotes}`;
        }
        if (record.shareholdingPatternNotes) {
            fullRemarks += `\n\n[Shareholding Pattern Notes]:\n${record.shareholdingPatternNotes}`;
        }
        if (remarksModalBody) {
            remarksModalBody.textContent = fullRemarks;
        }
        remarksModal.style.display = 'flex';
    }

    function closeRemarksModal() {
        if (remarksModal) remarksModal.style.display = 'none';
    }

    // =========================================================
    // Custom Query Screener Builder
    // =========================================================
    function openCustomModal() {
        if (!customModal) return;
        if (customQueryInput) {
            customQueryInput.value = currentCustomQuery || '';
        }
        customModal.style.display = 'flex';
        if (currentCustomQuery) {
            validateQueryDebounced();
        } else if (customQueryFeedback) {
            customQueryFeedback.style.display = 'none';
            if (applyCountBadge) applyCountBadge.style.display = 'none';
        }
        setTimeout(() => {
            if (customQueryInput) customQueryInput.focus();
        }, 100);
    }

    function closeCustomModal() {
        if (customModal) customModal.style.display = 'none';
    }

    function insertTokenAtCursor(token) {
        if (!customQueryInput) return;
        customQueryInput.focus();
        const start = customQueryInput.selectionStart;
        const end = customQueryInput.selectionEnd;
        const text = customQueryInput.value;

        const before = text.substring(0, start);
        const after = text.substring(end);

        let prefix = '';
        let suffix = '';

        if (before.length > 0 && !/[\s(]/.test(before.slice(-1))) {
            prefix = ' ';
        }

        if (token === '(') {
            suffix = '';
        } else if (token === ')') {
            suffix = ' ';
        } else {
            if (after.length > 0 && !/[\s)]/.test(after.charAt(0))) {
                suffix = ' ';
            } else if (after.length === 0) {
                suffix = ' ';
            }
        }

        const inserted = prefix + token + suffix;
        customQueryInput.value = before + inserted + after;
        const newPos = start + inserted.length;
        customQueryInput.selectionStart = newPos;
        customQueryInput.selectionEnd = newPos;

        validateQueryDebounced();
    }

    function validateQueryDebounced() {
        clearTimeout(validationTimer);
        const val = customQueryInput ? customQueryInput.value.trim() : '';
        if (!val) {
            if (customQueryFeedback) customQueryFeedback.style.display = 'none';
            if (applyCountBadge) applyCountBadge.style.display = 'none';
            return;
        }

        validationTimer = setTimeout(() => {
            safeFetchJson(`/api/shareholding/validate-query?query=${encodeURIComponent(val)}`)
                .then(data => {
                    if (!customQueryFeedback) return;
                    customQueryFeedback.style.display = 'block';
                    if (data.valid) {
                        customQueryFeedback.className = 'shp-query-feedback valid';
                        const count = data.match_count || 0;
                        const sample = (data.matches || []).slice(0, 5).map(m => m.symbol).join(', ');
                        const sampleSuffix = count > 5 ? `, +${count - 5} more` : '';
                        customQueryFeedback.innerHTML = `✓ <strong>Valid Query</strong> — matches <strong>${count}</strong> stocks${sample ? ` (${sample}${sampleSuffix})` : ''}`;
                        if (applyCountBadge) {
                            applyCountBadge.textContent = count;
                            applyCountBadge.style.display = 'inline-block';
                        }
                    } else {
                        customQueryFeedback.className = 'shp-query-feedback error';
                        customQueryFeedback.innerHTML = `✗ <strong>Syntax Error:</strong> ${escapeHtml(data.error || 'Invalid query expression')}`;
                        if (applyCountBadge) {
                            applyCountBadge.style.display = 'none';
                        }
                    }
                })
                .catch(err => {
                    if (customQueryFeedback) {
                        customQueryFeedback.style.display = 'block';
                        customQueryFeedback.className = 'shp-query-feedback error';
                        customQueryFeedback.textContent = `Validation error: ${err.message}`;
                    }
                });
        }, 200);
    }

    // Attach Event Handlers
    if (refreshBtn) refreshBtn.addEventListener('click', manualRefresh);

    // Board Filter Chips
    document.querySelectorAll('.shp-board-chips button').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.shp-board-chips button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentBoard = btn.dataset.boardFilter || 'all';
            currentPage = 1;
            loadShareholding();
        });
    });

    // Scope Filter Pills (All Stocks / All Portfolio / All Watchlists)
    document.querySelectorAll('#tab-shareholding .shp-scope-pill').forEach(pill => {
        pill.addEventListener('click', function () {
            document.querySelectorAll('#tab-shareholding .shp-scope-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            currentScope = pill.dataset.scope || 'all';
            currentPage = 1;
            loadShareholding();
        });
    });

    // Category Filter Chips
    document.querySelectorAll('.shp-filter-chip').forEach(chip => {
        chip.addEventListener('click', function () {
            if (chip.dataset.category === 'custom') {
                openCustomModal();
                return;
            }
            document.querySelectorAll('.shp-filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentCategory = chip.dataset.category || 'all';
            currentPage = 1;
            loadShareholding();
        });
    });

    // Token Chips (Click to append into query at cursor)
    document.querySelectorAll('.shp-token-chip').forEach(chip => {
        chip.addEventListener('click', function (e) {
            e.preventDefault();
            const token = chip.dataset.token;
            if (token) insertTokenAtCursor(token);
        });
    });

    // Preset Strategy Cards
    document.querySelectorAll('.shp-preset-card').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            const presetQuery = btn.dataset.preset;
            if (presetQuery && customQueryInput) {
                customQueryInput.value = presetQuery;
                customQueryInput.focus();
                validateQueryDebounced();
            }
        });
    });

    // Textarea input
    if (customQueryInput) {
        customQueryInput.addEventListener('input', validateQueryDebounced);
        customQueryInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (customApplyBtn) customApplyBtn.click();
            }
        });
    }

    // Clear input button
    if (customClearInput) {
        customClearInput.addEventListener('click', function () {
            if (customQueryInput) {
                customQueryInput.value = '';
                customQueryInput.focus();
                validateQueryDebounced();
            }
        });
    }

    // Apply Filter
    if (customApplyBtn) {
        customApplyBtn.addEventListener('click', function () {
            const queryVal = customQueryInput ? customQueryInput.value.trim() : '';
            if (!queryVal) {
                showNotice('Please write a query expression or select a preset strategy.', 'error', 4000);
                return;
            }

            safeFetchJson(`/api/shareholding/validate-query?query=${encodeURIComponent(queryVal)}`)
                .then(data => {
                    if (!data.valid) {
                        if (customQueryFeedback) {
                            customQueryFeedback.style.display = 'block';
                            customQueryFeedback.className = 'shp-query-feedback error';
                            customQueryFeedback.innerHTML = `✗ <strong>Cannot Apply:</strong> ${escapeHtml(data.error)}`;
                        }
                        return;
                    }

                    currentCustomQuery = queryVal;
                    currentCategory = 'custom';

                    document.querySelectorAll('.shp-filter-chip').forEach(c => c.classList.remove('active'));
                    if (customChip) {
                        customChip.classList.add('active');
                        customChip.title = `Active Custom Query: ${currentCustomQuery}`;
                    }

                    closeCustomModal();
                    currentPage = 1;
                    loadShareholding();
                })
                .catch(err => {
                    showNotice(`Error applying query: ${err.message}`, 'error', 5000);
                });
        });
    }

    // Reset Filter to All
    if (customResetBtn) {
        customResetBtn.addEventListener('click', function () {
            currentCustomQuery = '';
            if (customQueryInput) customQueryInput.value = '';
            currentCategory = 'all';

            document.querySelectorAll('.shp-filter-chip').forEach(c => c.classList.remove('active'));
            const allChip = document.querySelector('.shp-filter-chip[data-category="all"]');
            if (allChip) allChip.classList.add('active');
            if (customChip) {
                customChip.title = 'Build custom query screener';
            }

            closeCustomModal();
            currentPage = 1;
            loadShareholding();
        });
    }

    // Close Custom Modal
    if (customCancelBtn) customCancelBtn.addEventListener('click', closeCustomModal);
    if (customModalClose) customModalClose.addEventListener('click', closeCustomModal);
    if (customModal) {
        customModal.addEventListener('click', function (e) {
            if (e.target === customModal) closeCustomModal();
        });
    }

    // Search Input with Debounce
    if (searchInput) {
        searchInput.addEventListener('input', function () {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(function () {
                currentSearch = searchInput.value.trim();
                currentPage = 1;
                loadShareholding();
            }, 300);
        });
    }

    // Sortable Headers
    document.querySelectorAll('#tab-shareholding .sortable-th').forEach(th => {
        th.addEventListener('click', function () {
            const key = th.dataset.sortKey;
            if (currentSortKey === key) {
                currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortKey = key;
                // Default to descending for percentage & change columns so biggest holding/gainers appear first
                currentSortDir = (key === 'name' || key === 'symbol') ? 'asc' : 'desc';
            }
            currentPage = 1;
            loadShareholding();
        });
    });

    // Pagination
    if (prevBtn) {
        prevBtn.addEventListener('click', function () {
            if (currentPage > 1) {
                currentPage--;
                loadShareholding();
            }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', function () {
            if (currentPage < totalPages) {
                currentPage++;
                loadShareholding();
            }
        });
    }
    if (pageSelect) {
        pageSelect.addEventListener('change', function () {
            pageSize = parseInt(pageSelect.value, 10) || 50;
            currentPage = 1;
            loadShareholding();
        });
    }

    // Modal Close
    if (remarksModalClose) remarksModalClose.addEventListener('click', closeRemarksModal);
    if (remarksModalOk) remarksModalOk.addEventListener('click', closeRemarksModal);
    if (remarksModal) {
        remarksModal.addEventListener('click', function (e) {
            if (e.target === remarksModal) closeRemarksModal();
        });
    }

    // Global Export
    window.loadShareholding = loadShareholding;

    if (window.INITIAL_TAB === 'shareholding' || window.currentTab === 'shareholding' || window.location.pathname === '/shareholding') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => loadShareholding());
        } else {
            loadShareholding();
        }
    }
}());
