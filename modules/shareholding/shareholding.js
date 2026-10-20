/**
 * Capital Desk - Shareholding Patterns Module
 * Location: modules/shareholding/shareholding.js
 * Handles data rendering, searching, filtering, sorting, pagination, and 15m manual refresh.
 */

(function () {
    'use strict';

    let currentBoard = 'all';
    let currentCategory = 'all';
    let currentSearch = '';
    let currentSortKey = 'broadcastDate';
    let currentSortDir = 'desc';
    let currentPage = 1;
    let pageSize = 50;
    let totalPages = 1;
    let searchDebounceTimer = null;
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

    function renderRow(record) {
        const symbol = escapeHtml(record.symbol || '');
        const name = escapeHtml(record.name || symbol);
        const isin = escapeHtml(record.isin || '');
        const board = (record.board || 'Mainboard').toLowerCase() === 'sme' ? 'SME' : 'Mainboard';
        const boardClass = board.toLowerCase();

        const quarter = escapeHtml(record.date || '—');
        const submissionDate = escapeHtml(record.submissionDate || '—');
        const broadcastDate = escapeHtml(record.broadcastDate || record.systemDate || submissionDate);

        const promoterPct = record.pr_and_prgrp != null && !isNaN(Number(record.pr_and_prgrp)) ? Number(record.pr_and_prgrp) : null;
        const publicPct = record.public_val != null && !isNaN(Number(record.public_val)) ? Number(record.public_val) : null;
        const employeeTrusts = record.employeeTrusts != null ? String(record.employeeTrusts).trim() : '0';

        // Promoter bar
        let promoterHtml = '<span class="value-muted">—</span>';
        if (promoterPct !== null) {
            const barFillClass = promoterPct > 75 ? 'warning' : 'promoter';
            promoterHtml = `
                <div class="shp-pct-cell">
                    <span class="shp-pct-val">${promoterPct.toFixed(2)}%</span>
                    <div class="shp-bar-wrap">
                        <div class="shp-bar-fill ${barFillClass}" style="width: ${Math.min(100, Math.max(0, promoterPct))}%;"></div>
                    </div>
                </div>
            `;
        }

        // Public bar
        let publicHtml = '<span class="value-muted">—</span>';
        if (publicPct !== null) {
            publicHtml = `
                <div class="shp-pct-cell">
                    <span class="shp-pct-val" style="color: #10b981;">${publicPct.toFixed(2)}%</span>
                    <div class="shp-bar-wrap">
                        <div class="shp-bar-fill public" style="width: ${Math.min(100, Math.max(0, publicPct))}%;"></div>
                    </div>
                </div>
            `;
        }

        // Remarks
        const rawRemarks = record.remarksWeb || '';
        const hasRemarks = rawRemarks && rawRemarks.trim().toLowerCase() !== 'n' && rawRemarks.trim() !== '-';
        let remarksHtml = '<span style="color: var(--text-secondary); opacity: 0.5;">—</span>';
        if (hasRemarks) {
            const shortRemark = rawRemarks.length > 35 ? rawRemarks.substring(0, 32) + '…' : rawRemarks;
            remarksHtml = `
                <button type="button" class="shp-remarks-btn" data-record-id="${escapeHtml(record.recordId)}" title="Click to view complete disclosure note">
                    📝 ${escapeHtml(shortRemark)}
                </button>
            `;
        }

        // XBRL link
        let xbrlHtml = '<span style="color: var(--text-secondary); opacity: 0.5;">—</span>';
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
                <td>
                    <a href="javascript:void(0)" class="shp-comp-title" onclick="if(window.openFundamentalsModal) window.openFundamentalsModal('${symbol}'); return false;" title="Click to view ${name} fundamentals">
                        ${name}
                    </a>
                    <span class="shp-symbol-badge">${symbol}</span>
                    <div class="shp-sub-details">
                        <span class="shp-board-tag ${boardClass}">${board}</span>
                        <span>•</span>
                        <span>ISIN: ${isin || '—'}</span>
                    </div>
                </td>
                <td>
                    <span class="shp-quarter-badge">${quarter}</span>
                </td>
                <td>${promoterHtml}</td>
                <td>${publicHtml}</td>
                <td>
                    <span style="font-weight: ${Number(employeeTrusts) > 0 ? '700' : '500'}; color: ${Number(employeeTrusts) > 0 ? 'var(--text-primary)' : 'var(--text-secondary)'};">
                        ${employeeTrusts !== '0' && employeeTrusts !== '' ? escapeHtml(employeeTrusts) + '%' : '0.00%'}
                    </span>
                </td>
                <td>
                    <div style="font-weight: 600; color: var(--text-primary); font-size: 12px;">${submissionDate}</div>
                    <div style="font-size: 10.5px; color: var(--text-secondary); margin-top: 2px;">${broadcastDate}</div>
                </td>
                <td>${remarksHtml}</td>
                <td style="text-align: center;">${xbrlHtml}</td>
            </tr>
        `;
    }

    function loadShareholding(targetPage) {
        if (targetPage !== undefined) currentPage = targetPage;
        if (!rowsEl) return;

        rowsEl.innerHTML = '<tr><td class="table-message" colspan="8" style="text-align: center; padding: 30px; color: var(--text-secondary);">Loading records…</td></tr>';
        updateSortHeaders();

        const params = new URLSearchParams({
            board: currentBoard,
            category: currentCategory,
            search: currentSearch,
            sort_key: currentSortKey,
            sort_dir: currentSortDir,
            page: currentPage,
            page_size: pageSize
        });

        fetch(`/api/shareholding/data?${params.toString()}`)
            .then(res => res.json())
            .then(data => {
                if (data.error) {
                    rowsEl.innerHTML = `<tr><td class="table-message" colspan="8" style="text-align: center; padding: 30px; color: #ef4444;">Error: ${escapeHtml(data.error)}</td></tr>`;
                    return;
                }

                // Update Status & Counts
                const st = data.status || {};
                if (updatedLabel && st.last_synced_display) {
                    updatedLabel.textContent = `Synced: ${st.last_synced_display}`;
                }
                if (countAllEl && st.total_records !== undefined) countAllEl.textContent = st.total_records.toLocaleString();
                if (countMbEl && st.count_equities !== undefined) countMbEl.textContent = st.count_equities.toLocaleString();
                if (countSmeEl && st.count_sme !== undefined) countSmeEl.textContent = st.count_sme.toLocaleString();

                const records = data.records || [];
                const pag = data.pagination || {};
                totalPages = pag.total_pages || 1;

                if (records.length === 0) {
                    rowsEl.innerHTML = '<tr><td class="table-message" colspan="8" style="text-align: center; padding: 40px; color: var(--text-secondary);">No shareholding records match your filter criteria.</td></tr>';
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
                rowsEl.innerHTML = `<tr><td class="table-message" colspan="8" style="text-align: center; padding: 30px; color: #ef4444;">Failed to load data: ${escapeHtml(err.message)}</td></tr>`;
            });
    }

    function manualRefresh() {
        if (isFetching) return;
        isFetching = true;

        if (refreshBtn) refreshBtn.disabled = true;
        if (refreshIcon) refreshIcon.classList.add('spinning-icon');

        fetch('/api/shareholding/refresh', { method: 'POST' })
            .then(res => res.json())
            .then(result => {
                if (result.status === 'throttled') {
                    showNotice(`⏳ ${result.message}`, 'info', 7000);
                } else if (result.status === 'success') {
                    showNotice(`✓ ${result.message}`, 'success', 6000);
                    currentPage = 1;
                    loadShareholding();
                } else {
                    showNotice(`Notice: ${result.message || 'Refresh completed.'}`, 'info', 6000);
                }
            })
            .catch(err => {
                showNotice(`Refresh error: ${err.message}`, 'error', 6000);
            })
            .finally(() => {
                isFetching = false;
                if (refreshBtn) refreshBtn.disabled = false;
                if (refreshIcon) refreshIcon.classList.remove('spinning-icon');
            });
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

    // Category Filter Chips
    document.querySelectorAll('.shp-filter-chip').forEach(chip => {
        chip.addEventListener('click', function () {
            document.querySelectorAll('.shp-filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentCategory = chip.dataset.category || 'all';
            currentPage = 1;
            loadShareholding();
        });
    });

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
                currentSortDir = 'desc';
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
        loadShareholding();
    }
}());
