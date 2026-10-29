/**
 * Custom Query Manager for Capital Desk
 * Handles saving, updating, renaming, deleting, auto-incrementing, and loading
 * custom screener queries across modules (Quarterly Results, Shareholding, Transactions).
 */
(function() {
    window._customQueryManagers = window._customQueryManagers || {};

    class CustomQueryManager {
        constructor(config) {
            this.moduleName = config.moduleName; // e.g. 'quarterly_results'
            this.prefix = config.prefix; // e.g. 'qr'
            this.textareaId = config.textareaId;
            this.selectId = config.selectId;
            this.saveBtnId = config.saveBtnId;
            this.renameBtnId = config.renameBtnId;
            this.deleteBtnId = config.deleteBtnId;
            this.clearBtnId = config.clearBtnId;
            this.onSelectQuery = config.onSelectQuery; // callback(expression, queryObj)

            this.queries = [];
            this.activeQuery = null; // { id, name, expression } currently loaded from saved queries

            this.init();
        }

        async init() {
            this.bindEvents();
            await this.loadQueries();
        }

        getTextarea() {
            return document.getElementById(this.textareaId);
        }

        getSelect() {
            return document.getElementById(this.selectId);
        }

        async loadQueries() {
            try {
                const res = await fetch(`/api/custom-queries/${this.moduleName}`);
                const data = await res.json();
                if (data.success && Array.isArray(data.queries)) {
                    this.queries = data.queries;
                    this.renderDropdown();
                }
            } catch (err) {
                console.error(`Error loading custom queries for ${this.moduleName}:`, err);
            }
        }

        renderDropdown() {
            const select = this.getSelect();
            if (!select) return;

            const currentVal = this.activeQuery ? this.activeQuery.id : '';
            select.innerHTML = '';

            const defaultOpt = document.createElement('option');
            defaultOpt.value = '';
            defaultOpt.textContent = `📁 Saved Queries (${this.queries.length})`;
            select.appendChild(defaultOpt);

            this.queries.forEach(q => {
                const opt = document.createElement('option');
                opt.value = q.id;
                opt.textContent = q.name;
                if (currentVal && q.id === currentVal) {
                    opt.selected = true;
                }
                select.appendChild(opt);
            });

            this.updateActionButtonsVisibility();
        }

        updateActionButtonsVisibility() {
            const renameBtn = document.getElementById(this.renameBtnId);
            const deleteBtn = document.getElementById(this.deleteBtnId);
            const isSelected = !!this.activeQuery;

            if (renameBtn) renameBtn.style.display = isSelected ? 'inline-flex' : 'none';
            if (deleteBtn) deleteBtn.style.display = isSelected ? 'inline-flex' : 'none';
        }

        selectQueryById(queryId) {
            const textarea = this.getTextarea();
            if (!queryId) {
                this.activeQuery = null;
                this.updateActionButtonsVisibility();
                return;
            }

            const found = this.queries.find(q => q.id === queryId);
            if (found) {
                this.activeQuery = { ...found };
                if (textarea) {
                    textarea.value = found.expression;
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                }
                this.updateActionButtonsVisibility();
                if (typeof this.onSelectQuery === 'function') {
                    this.onSelectQuery(found.expression, found);
                }
            }
        }

        suggestNextName(baseName = 'Query') {
            const existingNames = this.queries.map(q => q.name.trim().toLowerCase());
            baseName = String(baseName || 'Query').trim();
            if (!existingNames.includes(baseName.toLowerCase())) {
                return baseName;
            }

            const match = baseName.match(/^(.*?)\s+(\d+)$/);
            const prefix = match ? match[1].trim() : baseName;

            let counter = 1;
            let candidate = `${prefix} ${counter}`;
            while (existingNames.includes(candidate.toLowerCase()) || candidate.toLowerCase() === baseName.toLowerCase()) {
                counter++;
                candidate = `${prefix} ${counter}`;
            }
            return candidate;
        }

        handleSaveClick() {
            const textarea = this.getTextarea();
            const expression = textarea ? textarea.value.trim() : '';
            if (!expression) {
                if (typeof showToast === 'function') showToast('Please enter a query expression before saving.', 'warning');
                else alert('Please enter a query expression before saving.');
                return;
            }

            // Check if user is working on an existing query
            if (this.activeQuery) {
                window.openCustomQueryChoiceModal({
                    queryName: this.activeQuery.name,
                    onUpdate: async () => {
                        await this.updateExistingQuery(this.activeQuery.id, this.activeQuery.name, expression);
                    },
                    onSaveNew: () => {
                        const suggested = this.suggestNextName(this.activeQuery.name);
                        window.openCustomQueryNameModal({
                            title: '💾 Save as New Query',
                            description: 'Enter a name for the new query:',
                            submitText: 'Save as New',
                            initialValue: suggested,
                            onSubmit: async (name) => {
                                await this.saveNewQuery(name, expression);
                            }
                        });
                    }
                });
            } else {
                const suggested = this.suggestNextName('Query');
                window.openCustomQueryNameModal({
                    title: '💾 Save Custom Query',
                    description: 'Enter a name for this custom query:',
                    submitText: 'Save Query',
                    initialValue: suggested,
                    onSubmit: async (name) => {
                        await this.saveNewQuery(name, expression);
                    }
                });
            }
        }

        async saveNewQuery(name, expression) {
            try {
                const res = await fetch(`/api/custom-queries/${this.moduleName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: name,
                        expression: expression,
                        action: 'new'
                    })
                });
                const data = await res.json();
                if (data.success) {
                    this.queries = data.queries || [];
                    this.activeQuery = data.query ? { ...data.query } : null;
                    this.renderDropdown();
                    if (this.activeQuery) {
                        const select = this.getSelect();
                        if (select) select.value = this.activeQuery.id;
                    }
                    if (typeof showToast === 'function') {
                        showToast(`Saved query "${data.query.name}"`, 'success');
                    }
                } else {
                    if (typeof showToast === 'function') showToast(data.error || 'Failed to save query', 'error');
                }
            } catch (err) {
                console.error('Error saving new query:', err);
                if (typeof showToast === 'function') showToast('Network error saving query.', 'error');
            }
        }

        async updateExistingQuery(queryId, name, expression) {
            try {
                const res = await fetch(`/api/custom-queries/${this.moduleName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: queryId,
                        name: name,
                        expression: expression,
                        action: 'update'
                    })
                });
                const data = await res.json();
                if (data.success) {
                    this.queries = data.queries || [];
                    this.activeQuery = data.query ? { ...data.query } : null;
                    this.renderDropdown();
                    if (typeof showToast === 'function') {
                        showToast(`Updated query "${this.activeQuery.name}"`, 'success');
                    }
                } else {
                    if (typeof showToast === 'function') showToast(data.error || 'Failed to update query', 'error');
                }
            } catch (err) {
                console.error('Error updating query:', err);
                if (typeof showToast === 'function') showToast('Network error updating query.', 'error');
            }
        }

        handleRenameClick() {
            if (!this.activeQuery) return;
            const currentName = this.activeQuery.name;
            window.openCustomQueryNameModal({
                title: '✏️ Rename Custom Query',
                description: `Enter a new name for query "${currentName}":`,
                submitText: 'Rename Query',
                initialValue: currentName,
                onSubmit: async (newName) => {
                    await this.renameQuery(this.activeQuery.id, newName);
                }
            });
        }

        async renameQuery(queryId, newName) {
            try {
                const res = await fetch(`/api/custom-queries/${this.moduleName}/${encodeURIComponent(queryId)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: newName })
                });
                const data = await res.json();
                if (data.success) {
                    this.queries = data.queries || [];
                    this.activeQuery = data.query ? { ...data.query } : null;
                    this.renderDropdown();
                    if (typeof showToast === 'function') {
                        showToast(`Renamed query to "${this.activeQuery.name}"`, 'success');
                    }
                } else {
                    if (typeof showToast === 'function') showToast(data.error || 'Failed to rename query', 'error');
                }
            } catch (err) {
                console.error('Error renaming query:', err);
                if (typeof showToast === 'function') showToast('Network error renaming query.', 'error');
            }
        }

        async handleDeleteClick() {
            if (!this.activeQuery) return;
            const q = this.activeQuery;
            const confirmed = window.confirm ? window.confirm(`Are you sure you want to delete query "${q.name}"?`) : true;
            if (!confirmed) return;

            try {
                const res = await fetch(`/api/custom-queries/${this.moduleName}/${encodeURIComponent(q.id)}`, {
                    method: 'DELETE'
                });
                const data = await res.json();
                if (data.success) {
                    this.queries = data.queries || [];
                    this.activeQuery = null;
                    this.renderDropdown();
                    if (typeof showToast === 'function') {
                        showToast(`Deleted query "${q.name}"`, 'info');
                    }
                } else {
                    if (typeof showToast === 'function') showToast(data.error || 'Failed to delete query', 'error');
                }
            } catch (err) {
                console.error('Error deleting query:', err);
                if (typeof showToast === 'function') showToast('Network error deleting query.', 'error');
            }
        }

        bindEvents() {
            const select = this.getSelect();
            if (select) {
                select.addEventListener('change', (e) => {
                    this.selectQueryById(e.target.value);
                });
            }

            const saveBtn = document.getElementById(this.saveBtnId);
            if (saveBtn) {
                saveBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.handleSaveClick();
                });
            }

            const renameBtn = document.getElementById(this.renameBtnId);
            if (renameBtn) {
                renameBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.handleRenameClick();
                });
            }

            const deleteBtn = document.getElementById(this.deleteBtnId);
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.handleDeleteClick();
                });
            }

            if (this.clearBtnId) {
                const clearBtn = document.getElementById(this.clearBtnId);
                if (clearBtn) {
                    clearBtn.addEventListener('click', () => {
                        this.activeQuery = null;
                        if (select) select.value = '';
                        this.updateActionButtonsVisibility();
                    });
                }
            }
        }
    }

    window.openCustomQueryChoiceModal = function({ queryName, onUpdate, onSaveNew }) {
        const modal = document.getElementById('customQueryChoiceModal');
        const nameSpan = document.getElementById('cqChoiceQueryName');
        const btnNameSpan = document.getElementById('cqChoiceBtnQueryName');
        const updateBtn = document.getElementById('cqChoiceUpdateBtn');
        const newBtn = document.getElementById('cqChoiceNewBtn');
        const cancelBtn = document.getElementById('cqChoiceCancelBtn');

        if (nameSpan) nameSpan.textContent = queryName;
        if (btnNameSpan) btnNameSpan.textContent = queryName;

        const close = () => {
            if (modal) modal.style.display = 'none';
        };

        if (updateBtn) {
            updateBtn.onclick = () => {
                close();
                if (onUpdate) onUpdate();
            };
        }

        if (newBtn) {
            newBtn.onclick = () => {
                close();
                if (onSaveNew) onSaveNew();
            };
        }

        if (cancelBtn) cancelBtn.onclick = close;

        if (modal) modal.style.display = 'flex';
    };

    window.openCustomQueryNameModal = function({ title, description, submitText, initialValue, onSubmit }) {
        const modal = document.getElementById('customQueryNameModal');
        const titleEl = document.getElementById('cqNameModalTitle');
        const descEl = document.getElementById('cqNameModalDesc');
        const input = document.getElementById('cqNameInput');
        const submitBtn = document.getElementById('cqNameSubmitBtn');
        const cancelBtn = document.getElementById('cqNameCancelBtn');

        if (titleEl && title) titleEl.textContent = title;
        if (descEl && description) descEl.textContent = description;
        if (submitBtn && submitText) submitBtn.textContent = submitText;
        if (input) {
            input.value = initialValue || '';
            setTimeout(() => {
                input.focus();
                input.select();
            }, 100);
        }

        const close = () => {
            if (modal) modal.style.display = 'none';
        };

        const handleConfirm = () => {
            const val = input ? input.value.trim() : '';
            if (!val) {
                if (typeof showToast === 'function') showToast('Please enter a query name.', 'warning');
                return;
            }
            close();
            if (onSubmit) onSubmit(val);
        };

        if (submitBtn) submitBtn.onclick = handleConfirm;
        if (cancelBtn) cancelBtn.onclick = close;

        if (input) {
            input.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConfirm();
                } else if (e.key === 'Escape') {
                    close();
                }
            };
        }

        if (modal) modal.style.display = 'flex';
    };

    window.initCustomQueryManager = function(config) {
        const mgr = new CustomQueryManager(config);
        window._customQueryManagers[config.moduleName] = mgr;
        return mgr;
    };
})();
