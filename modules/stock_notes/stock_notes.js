// =========================================================
// CAPITAL DESK - STOCK NOTES & TRADE COMMENTS MODULE
// Location: modules/stock_notes/stock_notes.js
// Provides full timeline of custom notes, trade thesis,
// buy comments & sell comments (ordered by date desc).
// =========================================================

(function() {
    let _currentStockNotesSymbol = '';
    let _currentStockNotesList = [];
    let _currentStockNotesFilter = 'ALL';

    function cleanSym(sym) {
        if (!sym) return '';
        if (typeof cleanDisplaySymbol === 'function') return cleanDisplaySymbol(sym);
        return String(sym).trim().toUpperCase().replace(/\.(NS|BO|BS)$/i, '');
    }

    function formatDateDisplay(dateStr, timestampStr) {
        if (!dateStr) return timestampStr || 'Recent';
        try {
            const parts = String(dateStr).split('-');
            if (parts.length === 3) {
                const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                if (!isNaN(d.getTime())) {
                    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
                }
            }
        } catch (_) {}
        return dateStr;
    }

    async function openStockNotesModal(symbol, companyName) {
        if (!symbol) return;
        const normSym = cleanSym(symbol);
        _currentStockNotesSymbol = normSym;
        _currentStockNotesFilter = 'ALL';

        // 1. Resolve Company Name
        let compName = companyName || '';
        if (!compName && typeof stockPricesData !== 'undefined' && stockPricesData) {
            const info = stockPricesData[symbol] || stockPricesData[normSym] || stockPricesData[normSym + '.NS'] || stockPricesData[normSym + '.BO'];
            if (info && info.name) compName = info.name;
        }
        if (!compName) compName = normSym;

        // 2. Set Modal Header Details
        const symEl = document.getElementById('stockNotesSymbol');
        const nameEl = document.getElementById('stockNotesCompanyName');
        if (symEl) symEl.innerText = normSym;
        if (nameEl) nameEl.innerText = compName;

        // 3. Reset Add Form Inputs
        const dateInput = document.getElementById('stockNoteDate');
        if (dateInput) {
            dateInput.value = new Date().toISOString().split('T')[0];
        }
        const textInput = document.getElementById('stockNoteText');
        if (textInput) textInput.value = '';
        const typeSelect = document.getElementById('stockNoteType');
        if (typeSelect) typeSelect.value = 'NOTE';

        // 4. Reset Filters
        document.querySelectorAll('.stock-notes-filter-pill').forEach(btn => {
            btn.classList.toggle('active', btn.innerText.trim().toUpperCase() === 'ALL');
        });

        // 5. Open Modal
        const modal = document.getElementById('stockNotesModal');
        if (modal) modal.style.display = 'block';

        // 6. Show Loading State & Fetch Notes
        const listEl = document.getElementById('stockNotesList');
        if (listEl) {
            listEl.innerHTML = `
                <div class="stock-notes-empty">
                    <div class="stock-notes-empty-icon">⏳</div>
                    <div class="stock-notes-empty-title">Loading notes &amp; trade history...</div>
                </div>
            `;
        }

        try {
            const res = await fetch(`/api/stock-notes/${encodeURIComponent(normSym)}`);
            const data = await res.json();
            if (data.success && Array.isArray(data.notes)) {
                _currentStockNotesList = data.notes;
                if (data.company_name && nameEl && (!compName || compName === normSym)) {
                    nameEl.innerText = data.company_name;
                }
                renderStockNotesList();
            } else {
                _currentStockNotesList = [];
                renderStockNotesList();
            }
        } catch (err) {
            console.error('[Stock Notes] Failed to fetch notes:', err);
            if (listEl) {
                listEl.innerHTML = `
                    <div class="stock-notes-empty">
                        <div class="stock-notes-empty-icon">⚠️</div>
                        <div class="stock-notes-empty-title">Failed to load notes</div>
                        <div class="stock-notes-empty-desc">${err.message || 'Please check your connection and try again.'}</div>
                    </div>
                `;
            }
        }
    }

    function renderStockNotesList() {
        const listEl = document.getElementById('stockNotesList');
        const countEl = document.getElementById('stockNotesCountText');
        if (!listEl) return;

        // Filter notes
        let filtered = _currentStockNotesList.slice();
        if (_currentStockNotesFilter === 'NOTE') {
            filtered = filtered.filter(n => n.type === 'NOTE' || n.type === 'ANALYSIS' || n.type === 'TARGET');
        } else if (_currentStockNotesFilter === 'BUY') {
            filtered = filtered.filter(n => n.type === 'BUY');
        } else if (_currentStockNotesFilter === 'SELL') {
            filtered = filtered.filter(n => n.type === 'SELL');
        }

        if (countEl) {
            countEl.innerText = `Showing ${filtered.length} of ${_currentStockNotesList.length} total entries`;
        }

        if (filtered.length === 0) {
            const isFiltered = _currentStockNotesFilter !== 'ALL';
            listEl.innerHTML = `
                <div class="stock-notes-empty">
                    <div class="stock-notes-empty-icon">📝</div>
                    <div class="stock-notes-empty-title">${isFiltered ? `No ${_currentStockNotesFilter} entries found` : 'No notes recorded yet'}</div>
                    <div class="stock-notes-empty-desc">
                        ${isFiltered ? 'Switch filter above to "All" to view other notes.' : `Write your trade thesis, buy/sell thoughts, or target notes for ${_currentStockNotesSymbol} above.`}
                    </div>
                </div>
            `;
            return;
        }

        listEl.innerHTML = '';
        filtered.forEach(note => {
            const card = document.createElement('div');
            const typeLower = (note.type || 'NOTE').toLowerCase();
            card.className = `stock-note-card type-${typeLower}`;

            // Header
            const header = document.createElement('div');
            header.className = 'stock-note-card-header';

            const badgeGroup = document.createElement('div');
            badgeGroup.className = 'stock-note-badge-group';

            // Type Badge
            const typeBadge = document.createElement('span');
            typeBadge.className = `stock-note-type-badge badge-${typeLower}`;
            if (note.type === 'BUY') typeBadge.innerText = '🟢 BUY';
            else if (note.type === 'SELL') typeBadge.innerText = '🔴 SELL';
            else if (note.type === 'ANALYSIS') typeBadge.innerText = '📊 ANALYSIS';
            else if (note.type === 'TARGET') typeBadge.innerText = '🎯 TARGET';
            else typeBadge.innerText = '📝 NOTE';
            badgeGroup.appendChild(typeBadge);

            // Source Badge (Portfolio Transaction vs Custom Note)
            if (note.is_transaction) {
                const srcBadge = document.createElement('span');
                srcBadge.className = 'stock-note-source-badge';
                srcBadge.innerText = note.portfolio ? `Trade · ${note.portfolio}` : 'Trade Ledger';
                badgeGroup.appendChild(srcBadge);
            }

            header.appendChild(badgeGroup);

            // Right header group (Date + delete button for custom notes)
            const rightGroup = document.createElement('div');
            rightGroup.style.display = 'flex';
            rightGroup.style.alignItems = 'center';
            rightGroup.style.gap = '8px';

            const dateSpan = document.createElement('span');
            dateSpan.className = 'stock-note-date-text';
            dateSpan.innerHTML = `📅 ${formatDateDisplay(note.date, note.timestamp)}`;
            rightGroup.appendChild(dateSpan);

            if (!note.is_transaction && note.id) {
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'stock-note-delete-btn';
                delBtn.title = 'Delete this note';
                delBtn.innerHTML = '🗑️';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    deleteStockNote(note.id);
                };
                rightGroup.appendChild(delBtn);
            }

            header.appendChild(rightGroup);
            card.appendChild(header);

            // Note Content
            const contentDiv = document.createElement('div');
            contentDiv.className = 'stock-note-content-text';
            contentDiv.innerText = note.content || '(No note text recorded)';
            card.appendChild(contentDiv);

            // Additional details (e.g. Bought 25 shares @ ₹2,500 | Realized P&L ...)
            if (note.details) {
                const detailsDiv = document.createElement('div');
                detailsDiv.className = 'stock-note-details-text';
                detailsDiv.innerText = note.details;
                card.appendChild(detailsDiv);
            }

            listEl.appendChild(card);
        });
    }

    async function submitStockNote() {
        if (!_currentStockNotesSymbol) return;
        const textInput = document.getElementById('stockNoteText');
        const dateInput = document.getElementById('stockNoteDate');
        const typeSelect = document.getElementById('stockNoteType');
        const saveBtn = document.getElementById('btnSaveStockNote');

        const content = textInput ? textInput.value.trim() : '';
        if (!content) {
            if (typeof showToast === 'function') showToast('Please enter note text before saving!', 'error');
            else alert('Please enter note text before saving!');
            if (textInput) textInput.focus();
            return;
        }

        const dateVal = dateInput ? dateInput.value : '';
        const typeVal = typeSelect ? typeSelect.value : 'NOTE';

        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerText = 'Saving...';
        }

        try {
            const res = await fetch(`/api/stock-notes/${encodeURIComponent(_currentStockNotesSymbol)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: dateVal,
                    type: typeVal,
                    content: content
                })
            });
            const data = await res.json();
            if (data.success && Array.isArray(data.notes)) {
                _currentStockNotesList = data.notes;
                if (textInput) textInput.value = '';
                renderStockNotesList();
                if (typeof showToast === 'function') {
                    showToast(`Note saved for ${_currentStockNotesSymbol}!`, 'success');
                }
            } else {
                throw new Error(data.error || 'Failed to save note');
            }
        } catch (err) {
            console.error('[Stock Notes] Save error:', err);
            if (typeof showToast === 'function') showToast(err.message || 'Error saving note', 'error');
            else alert(err.message || 'Error saving note');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerText = 'Save Note';
            }
        }
    }

    async function deleteStockNote(noteId) {
        if (!_currentStockNotesSymbol || !noteId) return;
        if (!confirm('Are you sure you want to delete this note?')) return;

        try {
            const res = await fetch(`/api/stock-notes/${encodeURIComponent(_currentStockNotesSymbol)}/${encodeURIComponent(noteId)}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (data.success && Array.isArray(data.notes)) {
                _currentStockNotesList = data.notes;
                renderStockNotesList();
                if (typeof showToast === 'function') {
                    showToast('Note deleted', 'info');
                }
            } else {
                throw new Error(data.error || 'Failed to delete note');
            }
        } catch (err) {
            console.error('[Stock Notes] Delete error:', err);
            if (typeof showToast === 'function') showToast(err.message || 'Error deleting note', 'error');
            else alert(err.message || 'Error deleting note');
        }
    }

    function filterStockNotes(type, btnEl) {
        _currentStockNotesFilter = type;
        document.querySelectorAll('.stock-notes-filter-pill').forEach(btn => {
            btn.classList.remove('active');
        });
        if (btnEl) btnEl.classList.add('active');
        renderStockNotesList();
    }

    function closeStockNotesModal() {
        const modal = document.getElementById('stockNotesModal');
        if (modal) modal.style.display = 'none';
        _currentStockNotesSymbol = '';
    }

    // Expose Global API
    window.openStockNotesModal = openStockNotesModal;
    window.closeStockNotesModal = closeStockNotesModal;
    window.submitStockNote = submitStockNote;
    window.deleteStockNote = deleteStockNote;
    window.filterStockNotes = filterStockNotes;

    // ESC key closes modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('stockNotesModal');
            if (modal && modal.style.display === 'block') {
                closeStockNotesModal();
            }
        }
    });
})();
