/**
 * CAPITAL DESK - MOMENTUM SMALLCASES MODULE
 * Location: modules/momentum_smallcases/momentum_smallcases.js
 * Front-end logic for managing Manual Momentum Indices.
 */

(function () {
    let momentumIndicesCache = [];
    let momentumSummaryCache = {};
    let currentViewingIndex = null;
    let isSubmitting = false;

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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

    // Client-side parser for live preview
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

    // Fetch and load Momentum Smallcases
    async function loadMomentumSmallcasesTab() {
        const mount = document.getElementById('momentum-indices-mount');
        if (!mount) return;

        mount.innerHTML = `
            <div style="text-align: center; padding: 50px 20px; color: var(--text-secondary);">
                <span class="spinning" style="display: inline-block; font-size: 26px; margin-bottom: 10px;">⏳</span><br>
                Loading Momentum Smallcases...
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

            renderSummaryStats();
            renderMomentumIndicesTable(momentumIndicesCache);
        } catch (err) {
            console.error('Error loading momentum indices:', err);
            mount.innerHTML = `<div style="text-align: center; padding: 30px; color: #ef4444;">Failed to load indices: ${escapeHtml(err.message)}</div>`;
        }
    }

    function renderSummaryStats() {
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

            // Generate previews for first 3 stocks
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
                                <span>👁️</span> <span>View</span>
                            </button>
                            <button type="button" class="msc-action-btn edit" onclick="openEditManualIndexModal('${escapeHtml(idx.id)}')" title="Edit Index">
                                <span>✏️</span> <span>Edit</span>
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

    // Modal Form: Add / Edit
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
            if (typeof window.showToast === 'function') {
                window.showToast('Could not load index for editing', 'error');
            } else {
                alert('Could not load index for editing');
            }
            return;
        }

        document.getElementById('mIndexEditId').value = idx.id;
        document.getElementById('mIndexNameInput').value = idx.name || '';
        document.getElementById('mIndexDescInput').value = idx.description || '';

        // Pre-fill stocks in canonical format
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
        const validBadge = document.getElementById('mIndexLiveValidBadge');
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
        const sample = `[RELIANCE, 15/10/2026], [TCS, 01/11/2026], [TITAN, 05/11/2026], [BAJFINANCE, 10/11/2026], [BHARTIARTL, 12/11/2026]`;
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
            if (typeof window.showToast === 'function') {
                window.showToast('Please enter an index name', 'warning');
            } else {
                alert('Please enter an index name');
            }
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
                if (typeof window.showToast === 'function') {
                    window.showToast(data.error || 'Failed to save index', 'error');
                } else {
                    alert(data.error || 'Failed to save index');
                }
                return;
            }

            closeMomentumFormModal();
            if (typeof window.showToast === 'function') {
                window.showToast(editId ? `Updated index "${name}"` : `Created index "${name}"`, 'success');
            }

            await loadMomentumSmallcasesTab();
        } catch (err) {
            console.error('Error saving manual index:', err);
            if (typeof window.showToast === 'function') {
                window.showToast('Error saving index: ' + err.message, 'error');
            } else {
                alert('Error saving index: ' + err.message);
            }
        } finally {
            isSubmitting = false;
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerText = originalText;
            }
        }
    }

    // Modal View Details
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
            if (typeof window.showToast === 'function') window.showToast('No stocks string to copy', 'info');
            return;
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                if (typeof window.showToast === 'function') window.showToast('Stocks string copied to clipboard!', 'success');
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
            if (typeof window.showToast === 'function') window.showToast('Stocks string copied to clipboard!', 'success');
        } catch (_) {
            if (typeof window.showToast === 'function') window.showToast('Could not copy string', 'error');
        }
        document.body.removeChild(ta);
    }

    // Modal Delete
    function openDeleteManualIndexModal(indexId, name) {
        document.getElementById('mIndexDeleteId').value = indexId;
        document.getElementById('mIndexDeleteName').innerText = name || 'this index';
        const modal = document.getElementById('momentumIndexDeleteModal');
        if (modal) modal.style.display = 'flex';
    }

    function closeMomentumDeleteModal() {
        const modal = document.getElementById('momentumIndexDeleteModal');
        if (modal) modal.style.display = 'none';
    }

    async function confirmDeleteManualIndex() {
        const id = document.getElementById('mIndexDeleteId')?.value;
        if (!id) return;

        const btn = document.getElementById('mIndexConfirmDeleteBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerText = 'Deleting...';
        }

        try {
            const res = await fetch(`/api/momentum-smallcases/indices/${encodeURIComponent(id)}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (!data.success) {
                if (typeof window.showToast === 'function') {
                    window.showToast(data.error || 'Failed to delete index', 'error');
                } else {
                    alert(data.error || 'Failed to delete index');
                }
                return;
            }

            closeMomentumDeleteModal();
            if (typeof window.showToast === 'function') {
                window.showToast('Manual Index deleted successfully', 'info');
            }
            await loadMomentumSmallcasesTab();
        } catch (err) {
            console.error('Error deleting index:', err);
            if (typeof window.showToast === 'function') {
                window.showToast('Delete error: ' + err.message, 'error');
            } else {
                alert('Delete error: ' + err.message);
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerText = 'Delete Index';
            }
        }
    }

    // Expose functions to global scope
    window.loadMomentumSmallcasesTab = loadMomentumSmallcasesTab;
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
    window.confirmDeleteManualIndex = confirmDeleteManualIndex;
    window.filterMomentumIndices = filterMomentumIndices;
    window.updateLiveStocksChipsPreview = updateLiveStocksChipsPreview;
    window.insertSampleStocksFormat = insertSampleStocksFormat;
    window.clearStocksInput = clearStocksInput;
})();
