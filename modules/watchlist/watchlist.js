        // =========================================================
        // WATCHLIST FUNCTIONS
        // =========================================================
        // Immediately restore watchlists from localStorage for 0ms initial paint
        try {
            const cachedWl = localStorage.getItem('cd_cached_watchlists');
            if (cachedWl) {
                const parsed = JSON.parse(cachedWl);
                if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                    watchlistsData = parsed;
                    const names = Object.keys(watchlistsData);
                    if (!activeWatchlistName || !watchlistsData[activeWatchlistName]) {
                        activeWatchlistName = names[0];
                    }
                    setTimeout(() => {
                        if (typeof renderWatchlists === 'function') renderWatchlists();
                    }, 0);
                }
            }
        } catch(e) {}

        async function fetchWatchlists() {
            try {
                const res = await fetch('/api/watchlists');
                if (!res.ok) {
                    if (res.status === 401) {
                        window.location.href = '/login';
                        return;
                    }
                    throw new Error('Watchlists API error: ' + res.status);
                }
                const data = await res.json();
                if (data && typeof data === 'object' && !data.error) {
                    watchlistsData = data;
                    window.watchlistsLoaded = true;
                    try {
                        localStorage.setItem('cd_cached_watchlists', JSON.stringify(watchlistsData));
                    } catch(e) {}
                    
                    const names = Object.keys(watchlistsData);
                    if (names.length > 0 && (!activeWatchlistName || !watchlistsData[activeWatchlistName])) {
                        activeWatchlistName = names[0];
                    }
                }
            } catch (error) {
                console.error('Error fetching watchlists:', error);
            } finally {
                renderWatchlists();
                if (typeof refreshPrices === 'function') {
                    refreshPrices().then(() => {
                        renderWatchlists();
                    });
                }
            }
        }
        window.fetchWatchlists = fetchWatchlists;

        async function saveWatchlistOrder(orderedNames) {
            try {
                const response = await fetch('/api/watchlists/order', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ names: orderedNames })
                });
                const data = await response.json();
                if (!response.ok || !data.success) throw new Error(data.error || 'Could not save watchlist order');
                watchlistsData = data.watchlists;
                renderWatchlists();
            } catch (error) {
                showToast(error.message || 'Could not save watchlist order', 'error');
                await fetchWatchlists();
            }
        }

        function moveWatchlist(sourceName, targetName) {
            const names = Object.keys(watchlistsData || {});
            const sourceIndex = names.indexOf(sourceName);
            const targetIndex = names.indexOf(targetName);
            if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
            names.splice(sourceIndex, 1);
            names.splice(sourceIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, sourceName);
            watchlistsData = Object.fromEntries(names.map(name => [name, watchlistsData[name]]));
            renderWatchlists();
            saveWatchlistOrder(names);
        }

        function toggleActionOverflow(event, menuId) {
            if (event) event.stopPropagation();
            const target = document.getElementById(menuId);
            if (!target) return;
            document.querySelectorAll('.wl-overflow.open').forEach(menu => { if (menu !== target) menu.classList.remove('open'); });
            target.classList.toggle('open');
        }

        function closeActionOverflow(event) {
            if (event) event.stopPropagation();
            document.querySelectorAll('.wl-overflow.open').forEach(menu => menu.classList.remove('open'));
        }

        function selectWatchlist(name) {
            activeWatchlistName = name;
            renderWatchlists();
            if (typeof updateMobileHeaderActiveBadge === 'function') updateMobileHeaderActiveBadge();
            if (typeof refreshPrices === 'function') {
                refreshPrices().then(() => {
                    renderWatchlists();
                });
            }
        }

        function toggleWatchlistSort(col) {
            if (wlSortColumn === col) {
                wlSortDirection = wlSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                wlSortColumn = col;
                wlSortDirection = col === 'symbol' ? 'asc' : 'desc';
            }
            renderWatchlists();
            refreshPrices();
        }

        async function createWatchlist() {
            const input = document.getElementById('new-watchlist-name');
            const name = input.value.trim();
            if (!name) return;
            
            const res = await fetch('/api/watchlists', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const data = await res.json();
            if (data.success) {
                input.value = '';
                watchlistsData = data.watchlists;
                activeWatchlistName = name;
                renderWatchlists();
                refreshPrices();
            } else {
                alert(data.error);
            }
        }

        async function deleteActiveWatchlist(targetName = null) {
            const nameToDelete = (typeof targetName === 'string' && targetName.trim() !== '') ? targetName.trim() : activeWatchlistName;
            if (!nameToDelete) {
                (window.nativeAlert || alert)('No active watchlist selected to delete. Please select or create a watchlist first.');
                return;
            }

            const confirmFn = window.nativeConfirm || confirm;
            const confirmed = confirmFn(`Are you sure you want to permanently delete watchlist "${nameToDelete}"?\n\nAll stocks in this watchlist will be removed.`);

            if (!confirmed) return;

            try {
                const res = await fetch(`/api/watchlists/${encodeURIComponent(nameToDelete)}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    (window.nativeAlert || alert)(`Watchlist "${nameToDelete}" deleted successfully.`);
                    watchlistsData = data.watchlists;
                    const names = Object.keys(watchlistsData);
                    if (activeWatchlistName === nameToDelete) {
                        activeWatchlistName = names.length > 0 ? names[0] : '';
                    }
                    renderWatchlists();
                    refreshPrices();
                } else {
                    (window.nativeAlert || alert)(data.error || 'Failed to delete watchlist.');
                }
            } catch (err) {
                console.error('Delete watchlist error:', err);
                (window.nativeAlert || alert)('Error deleting watchlist. Please check network connection.');
            }
        }

        async function addWatchlistStock(watchlistName, symbolInputValue = null) {
            const targetName = watchlistName || activeWatchlistName;
            if (!targetName) return;
            const input = document.getElementById('wl-search-input');
            const symbol = symbolInputValue || (input ? input.value.trim() : "");
            if (!symbol) return;
            
            const res = await fetch(`/api/watchlists/${encodeURIComponent(targetName)}/stocks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol })
            });
            const data = await res.json();
            if (data.success) {
                if (input) input.value = '';
                showToast(`Added ${symbol} to ${targetName}`, 'success');
                watchlistsData = data.watchlists;
                renderWatchlists();
                refreshPrices();
            } else {
                showToast(data.error || 'Failed to add stock', 'error');
            }
        }

        async function removeWatchlistStock(watchlistName, symbol) {
            const targetName = watchlistName || activeWatchlistName;
            if (!targetName) return;
            const confirmFn = window.nativeConfirm || window.confirm;
            if (!confirmFn(`Are you sure you want to remove ${cleanDisplaySymbol(symbol)} (${symbol}) from "${targetName}"?`)) return;
            try {
                const res = await fetch(`/api/watchlists/${encodeURIComponent(targetName)}/stocks/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    watchlistsData = data.watchlists;
                    renderWatchlists();
                    refreshPrices();
                } else {
                    alert(data.error || 'Failed to remove stock');
                }
            } catch (err) {
                console.error('Remove stock error:', err);
                alert('Failed to remove stock. Please check network connection.');
            }
        }

        function getSymbolBadge(sym, defaultExch = '') {
            if (!sym) return { label: 'NSE', class: 'badge-nse' };
            const s = sym.toUpperCase();
            if (s.startsWith('^') || defaultExch === 'INDEX') {
                return { label: 'INDEX', class: 'badge-idx' };
            }
            if (s.includes('=F') || s.includes('GOLDBEES') || s.includes('SILVERBEES') || defaultExch === 'COMMODITY') {
                return { label: 'COMMODITY', class: 'badge-cmd' };
            }
            if (s.endsWith('.BO') || defaultExch === 'BSE') {
                return { label: 'BSE', class: 'badge-bse' };
            }
            return { label: 'NSE', class: 'badge-nse' };
        }

        function renderWatchlists() {
            if (typeof updateMobileHeaderActiveBadge === 'function') updateMobileHeaderActiveBadge();
            // 1. Render Selector Bar
            const selectorMount = document.getElementById('watchlist-selector-mount');
            if (selectorMount) {
                selectorMount.innerHTML = '';
                if (!selectorMount.dataset.wheelBound) {
                    selectorMount.addEventListener('wheel', event => {
                        if (selectorMount.scrollWidth > selectorMount.clientWidth && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
                            selectorMount.scrollLeft += event.deltaY;
                            event.preventDefault();
                        }
                    }, { passive: false });
                    selectorMount.dataset.wheelBound = 'true';
                }
                const wlNames = Object.keys(watchlistsData);
                if (wlNames.length === 0) {
                    selectorMount.innerHTML = '<span style="color:var(--text-secondary); font-size:13px;">No watchlists created yet.</span>';
                } else {
                    wlNames.forEach(name => {
                        const btn = document.createElement('button');
                        btn.className = `pf-select-btn ${name === activeWatchlistName ? 'active' : ''}`;
                        btn.innerText = name;
                        btn.draggable = true;
                        btn.dataset.watchlistName = name;
                        btn.onclick = () => selectWatchlist(name);
                        btn.ondragstart = event => {
                            event.dataTransfer.setData('text/plain', name);
                            event.dataTransfer.effectAllowed = 'move';
                            btn.classList.add('selector-dragging');
                        };
                        btn.ondragend = () => {
                            btn.classList.remove('selector-dragging');
                            selectorMount.querySelectorAll('.selector-drop-target').forEach(item => item.classList.remove('selector-drop-target'));
                        };
                        btn.ondragover = event => { event.preventDefault(); btn.classList.add('selector-drop-target'); };
                        btn.ondragleave = () => btn.classList.remove('selector-drop-target');
                        btn.ondrop = event => {
                            event.preventDefault();
                            btn.classList.remove('selector-drop-target');
                            moveWatchlist(event.dataTransfer.getData('text/plain'), name);
                        };
                        selectorMount.appendChild(btn);
                    });
                    const addTabBtn = document.createElement('button');
                    addTabBtn.type = 'button';
                    addTabBtn.className = 'wl-add-tab-btn';
                    addTabBtn.title = 'Create New Watchlist';
                    addTabBtn.setAttribute('aria-label', 'Create New Watchlist');
                    addTabBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
                    addTabBtn.onclick = () => openCreateWatchlistModal();
                    selectorMount.appendChild(addTabBtn);
                }
            }

            // 2. Render Active Watchlist View
            const viewMount = document.getElementById('watchlist-view-mount');
            if (!viewMount) return;
            viewMount.innerHTML = '';

            if (!activeWatchlistName || !watchlistsData[activeWatchlistName]) {
                viewMount.innerHTML = '<div class="card-container" style="text-align:center; padding:40px; color:var(--text-secondary);">No active watchlist selected. Create or select a watchlist above!</div>';
                return;
            }

            const rawList = watchlistsData[activeWatchlistName];
            let symbols = Array.isArray(rawList) ? rawList.slice() : [];

            // Apply Watchlist Sorting
            symbols.sort((a, b) => {
                const infoA = stockPricesData[a] || {};
                const infoB = stockPricesData[b] || {};

                let valA, valB;
                if (wlSortColumn === 'symbol') {
                    valA = a;
                    valB = b;
                    return wlSortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
                } else if (wlSortColumn === 'price') {
                    valA = infoA.price !== undefined ? infoA.price : -Infinity;
                    valB = infoB.price !== undefined ? infoB.price : -Infinity;
                } else if (wlSortColumn === 'change') {
                    valA = infoA.change !== undefined ? infoA.change : -Infinity;
                    valB = infoB.change !== undefined ? infoB.change : -Infinity;
                } else if (wlSortColumn === 'change_pct') {
                    valA = (infoA && infoA.change_pct !== undefined && infoA.change_pct !== null) ? Number(infoA.change_pct) : -Infinity;
                    valB = (infoB && infoB.change_pct !== undefined && infoB.change_pct !== null) ? Number(infoB.change_pct) : -Infinity;
                }
                if (valA === -Infinity && valB === -Infinity) return 0;
                if (valA === -Infinity) return 1;
                if (valB === -Infinity) return -1;
                return wlSortDirection === 'asc' ? valA - valB : valB - valA;
            });

            const div = document.createElement('div');
            div.className = 'card-container';

            // Controls & Autocomplete search bar for active watchlist (Direct selection adds stock)
            const controlsDiv = document.createElement('div');
            controlsDiv.className = 'controls';
            controlsDiv.style.justifyContent = 'space-between';
            controlsDiv.style.alignItems = 'center';
            controlsDiv.style.flexWrap = 'wrap';
            controlsDiv.style.gap = '12px';
            controlsDiv.style.marginBottom = '20px';

            // Search Row (autocomplete search bar + mobile menu trigger)
            const searchRow = document.createElement('div');
            searchRow.className = 'wl-search-row';

            const wrapper = document.createElement('div');
            wrapper.className = 'autocomplete-wrapper';
            wrapper.style.width = '100%';
            wrapper.style.maxWidth = '420px';

            const input = document.createElement('input');
            input.type = 'text';
            input.id = 'wl-search-input';
            input.className = 'wl-input';
            input.setAttribute('data-wl-name', activeWatchlistName);
            input.placeholder = 'Search & click company to add (e.g. Reliance, TCS, Polymed)...';
            input.onkeyup = (e) => {
                if (e.key === 'Enter') {
                    const val = input.value.trim();
                    if (val) addWatchlistStock(activeWatchlistName, val);
                } else {
                    handleSearchInput('wl', input, e);
                }
            };
            input.autocomplete = 'off';

            const dropdown = document.createElement('div');
            dropdown.className = 'autocomplete-dropdown';

            wrapper.appendChild(input);
            wrapper.appendChild(dropdown);
            searchRow.appendChild(wrapper);

            // Responsive Mobile Menu Button (Placed at right end of search bar)
            const mobileMenuBtn = document.createElement('button');
            mobileMenuBtn.type = 'button';
            mobileMenuBtn.className = 'wl-mobile-menu-btn';
            mobileMenuBtn.id = 'wl-mobile-menu-btn';
            mobileMenuBtn.title = 'Watchlist Options & Actions';
            mobileMenuBtn.setAttribute('aria-label', 'Watchlist Menu');
            mobileMenuBtn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="4" y1="7" x2="20" y2="7"></line>
                    <line x1="4" y1="12" x2="20" y2="12"></line>
                    <line x1="4" y1="17" x2="20" y2="17"></line>
                </svg>
            `;
            mobileMenuBtn.onclick = (e) => {
                e.stopPropagation();
                toggleWlMobileMenu();
            };
            searchRow.appendChild(mobileMenuBtn);
            controlsDiv.appendChild(searchRow);

            // Desktop file controls (kept intact for web version)
            const watchlistFileControls = document.createElement('div');
            watchlistFileControls.className = 'watchlist-file-controls';
            watchlistFileControls.style.display = 'flex';
            watchlistFileControls.style.gap = '8px';
            watchlistFileControls.style.alignItems = 'center';
            watchlistFileControls.style.flexWrap = 'wrap';

            const officialFeedsBtn = document.createElement('button');
            officialFeedsBtn.className = 'btn-secondary';
            officialFeedsBtn.style.padding = '8px 14px';
            officialFeedsBtn.style.fontSize = '12px';
            officialFeedsBtn.title = 'View official exchange company announcements for this watchlist';
            officialFeedsBtn.innerHTML = '◉ Official Feeds';
            officialFeedsBtn.onclick = () => openWatchlistOfficialFeeds(activeWatchlistName);
            watchlistFileControls.appendChild(officialFeedsBtn);
            const watchlistOverflow = document.createElement('div');
            watchlistOverflow.className = 'wl-overflow';
            watchlistOverflow.id = 'watchlist-overflow-menu';
            watchlistOverflow.innerHTML = `
                <button type="button" class="wl-overflow-trigger" aria-label="More watchlist actions" title="More actions" onclick="toggleActionOverflow(event, 'watchlist-overflow-menu')">⋮</button>
                <div class="wl-overflow-menu" role="menu">
                    <button type="button" role="menuitem" onclick="exportActiveWatchlistToTxt(); closeActionOverflow(event)">⇩ Export</button>
                    <button type="button" role="menuitem" onclick="openWatchlistTxtImportModal(); closeActionOverflow(event)">⇧ Import</button>
                    <div class="wl-overflow-divider"></div>
                    <button type="button" class="danger" role="menuitem" onclick="deleteActiveWatchlist(); closeActionOverflow(event)">Delete Watchlist</button>
                </div>`;
            watchlistFileControls.appendChild(watchlistOverflow);
            controlsDiv.appendChild(watchlistFileControls);

            // Responsive Mobile Menu Drawer
            const mobileMenuDrawer = document.createElement('div');
            mobileMenuDrawer.id = 'wl-mobile-menu-drawer';
            mobileMenuDrawer.className = 'wl-mobile-menu-drawer';
            mobileMenuDrawer.innerHTML = `
                <div class="wl-mob-menu-container">
                    <!-- 1. Sort & Filter -->
                    <button type="button" class="wl-mob-menu-row" onclick="openWlMobileSortModal(); toggleWlMobileMenu(false);">
                        <div class="wl-mob-menu-row-left">
                            <span class="wl-mob-menu-icon">⇄</span>
                            <span class="wl-mob-menu-label">Sort & Filter</span>
                        </div>
                        <span class="wl-mob-menu-tag">Change Sort ▾</span>
                    </button>

                    <!-- 2. Official Exchange Feeds -->
                    <button type="button" class="wl-mob-menu-row" onclick="openWatchlistOfficialFeeds('${escapeHtml(activeWatchlistName)}'); toggleWlMobileMenu(false);">
                        <div class="wl-mob-menu-row-left">
                            <span class="wl-mob-menu-icon">◉</span>
                            <span class="wl-mob-menu-label">Official Feeds</span>
                        </div>
                        <span class="wl-mob-menu-tag">Announcements ↗</span>
                    </button>

                    <div class="wl-mob-menu-divider"></div>

                    <!-- 3. Actions Accordion (Collapsible & Expandable with Export, Import, Delete) -->
                    <div class="wl-mob-accordion">
                        <button type="button" class="wl-mob-menu-row wl-mob-accordion-btn" onclick="toggleWlMobActionsAccordion(event)">
                            <div class="wl-mob-menu-row-left">
                                <span class="wl-mob-menu-icon">⚙️</span>
                                <span class="wl-mob-menu-label">Watchlist Actions</span>
                            </div>
                            <span class="wl-mob-accordion-caret" id="wl-mob-accordion-caret">▸</span>
                        </button>
                        <div class="wl-mob-accordion-content" id="wl-mob-actions-content" style="display: none;">
                            <button type="button" class="wl-mob-sub-btn" onclick="exportActiveWatchlistToTxt(); toggleWlMobileMenu(false);">
                                <span>📤 Export Watchlist (.txt)</span>
                            </button>
                            <button type="button" class="wl-mob-sub-btn" onclick="openWatchlistTxtImportModal(); toggleWlMobileMenu(false);">
                                <span>📥 Import Watchlist (.txt)</span>
                            </button>
                            <button type="button" class="wl-mob-sub-btn danger" onclick="deleteActiveWatchlist(); toggleWlMobileMenu(false);">
                                <span>🗑️ Delete Watchlist</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;
            controlsDiv.appendChild(mobileMenuDrawer);

            // Table of stocks in active watchlist
            const scrollContainer = document.createElement('div');
            scrollContainer.className = 'table-responsive-container wl-table-container';

            const getSortIcon = (col) => {
                if (wlSortColumn !== col) return '<span style="opacity:0.3; margin-left:4px;">↕</span>';
                return wlSortDirection === 'asc' ? '<span style="color:#10b981; margin-left:4px;">▲</span>' : '<span style="color:#10b981; margin-left:4px;">▼</span>';
            };

            const table = document.createElement('table');
            table.className = 'wl-table';

            const colgroup = document.createElement('colgroup');
            colgroup.innerHTML = `
                <col class="wl-cg-symbol" style="width: 38%;">
                <col class="wl-cg-price" style="width: 18%;">
                <col class="wl-cg-change-amt" style="width: 17%;">
                <col class="wl-cg-change-pct" style="width: 16%;">
                <col class="wl-cg-actions" style="width: 11%;">
            `;
            table.appendChild(colgroup);

            const thead = document.createElement('thead');
            thead.innerHTML = `
                <tr>
                    <th class="wl-col-symbol" style="cursor:pointer; user-select:none;" onclick="toggleWatchlistSort('symbol')" title="Click to sort by Company / Symbol">
                        <span class="col-lbl-full">Company / Symbol</span><span class="col-lbl-compact">Symbol</span> ${getSortIcon('symbol')}
                    </th>
                    <th class="wl-col-price" style="text-align:right; cursor:pointer; user-select:none;" onclick="toggleWatchlistSort('price')" title="Click to sort by LTP">
                        <span class="col-lbl-full">LTP (₹)</span><span class="col-lbl-compact">LTP</span> ${getSortIcon('price')}
                    </th>
                    <th class="wl-col-change-amt" style="text-align:right; cursor:pointer; user-select:none;" onclick="toggleWatchlistSort('change')" title="Click to sort by Change Amount">
                        <span class="col-lbl-full">Change (₹)</span><span class="col-lbl-compact">Chg (₹)</span> ${getSortIcon('change')}
                    </th>
                    <th class="wl-col-change-pct" style="text-align:right; cursor:pointer; user-select:none;" onclick="toggleWatchlistSort('change_pct')" title="Click to sort by Change %">
                        <span class="col-lbl-full">Change (%)</span><span class="col-lbl-compact">Chg (%)</span> ${getSortIcon('change_pct')}
                    </th>
                    <th class="wl-col-actions" style="text-align:center;">
                        <span class="col-lbl-full">Actions</span><span class="col-lbl-compact">Act</span>
                    </th>
                </tr>
            `;

            let tbody = document.createElement('tbody');
            if (symbols.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-secondary); padding: 25px;">No stocks added to this watchlist yet. Use the search box above to add stocks!</td></tr>';
            } else {
                symbols.forEach(sym => {
                    const bInfo = getSymbolBadge(sym);

                    const tr = document.createElement('tr');
                    tr.id = `row-${sym}`;
                    tr.className = 'pf-row';
                    tr.title = 'Click row to view interactive technical chart';
                    tr.onclick = (e) => {
                        if (e.target.closest('.wl-row-menu-btn') || e.target.closest('.menu-dropdown-content') || e.target.closest('button')) return;
                        if (window._wlMenuJustClosed) return;
                        if (typeof openInHouseChart === 'function') openInHouseChart(sym);
                        else if (typeof window.openInHouseChart === 'function') window.openInHouseChart(sym);
                    };
                    
                    const info = stockPricesData[sym];
                    const hasData = info && !info.error && info.price !== undefined;
                    const nameHtml = (hasData && info.name) 
                        ? escapeHtml(info.name) 
                        : '<span class="skeleton-box" style="width: 100px; height: 11px;"></span>';
                    const priceVal = hasData 
                        ? '₹' + info.price.toLocaleString('en-IN', {minimumFractionDigits: 2}) 
                        : '<span class="skeleton-box" style="width: 60px; height: 14px;"></span>';
                    const priceCls = (hasData && info.change !== undefined) 
                        ? (info.change >= 0 ? 'pos' : 'neg') 
                        : '';
                    const sign = (hasData && info.change !== undefined && info.change >= 0) ? '+' : '';
                    const changeAmtHtml = (hasData && info.change !== undefined)
                        ? `${sign}₹${Math.abs(info.change).toFixed(2)}`
                        : '<span class="skeleton-box" style="width: 50px; height: 14px;"></span>';
                    const changePctHtml = (hasData && info.change_pct !== undefined)
                        ? `${sign}${info.change_pct.toFixed(2)}%`
                        : '<span class="skeleton-box" style="width: 45px; height: 14px;"></span>';
                    const subChangeHtml = (hasData && info.change !== undefined && info.change_pct !== undefined)
                        ? `${sign}₹${Math.abs(info.change).toFixed(2)} (${sign}${info.change_pct.toFixed(2)}%)`
                        : '';
                    const changeCls = (hasData && info.change !== undefined)
                        ? (info.change >= 0 ? 'pos' : 'neg')
                        : '';

                    const tdSymbol = document.createElement('td');
                    tdSymbol.className = 'wl-col-symbol';
                    tdSymbol.innerHTML = `<div class="stock-symbol-row"><span class="stock-symbol">${cleanDisplaySymbol(sym)}</span><span class="badge ${bInfo.class}">${bInfo.label}</span></div><div class="company-name" id="name-${sym}">${nameHtml}</div>`;

                    const tdPrice = document.createElement('td');
                    tdPrice.className = 'wl-col-price';
                    tdPrice.style.textAlign = 'right';
                    tdPrice.innerHTML = `
                        <span class="wl-price-val ${priceCls}" id="price-${sym}">${priceVal}</span>
                        <span class="wl-sub-change ${changeCls}" id="sub-change-${sym}">${subChangeHtml}</span>
                    `;

                    const tdChangeAmt = document.createElement('td');
                    tdChangeAmt.className = `wl-col-change-amt ${changeCls}`;
                    tdChangeAmt.style.textAlign = 'right';
                    tdChangeAmt.id = `change-amt-${sym}`;
                    tdChangeAmt.innerHTML = changeAmtHtml;

                    const tdChangePct = document.createElement('td');
                    tdChangePct.className = `wl-col-change-pct ${changeCls}`;
                    tdChangePct.style.textAlign = 'right';
                    tdChangePct.id = `change-pct-${sym}`;
                    tdChangePct.innerHTML = changePctHtml;

                    const tdActions = document.createElement('td');
                    tdActions.className = 'wl-col-actions';
                    tdActions.style.textAlign = 'center';
                    tdActions.style.position = 'relative';

                    const menuWrapper = document.createElement('div');
                    menuWrapper.style.position = 'relative';
                    menuWrapper.style.display = 'inline-block';

                    const menuBtn = document.createElement('button');
                    menuBtn.className = 'btn-secondary wl-row-menu-btn';
                    menuBtn.style.padding = '4px 8px';
                    menuBtn.style.fontSize = '12px';
                    menuBtn.style.fontWeight = '600';
                    menuBtn.title = `Actions for ${sym}`;
                    const isMob = window.innerWidth <= 768;
                    menuBtn.innerHTML = isMob
                        ? '<span class="wl-setting-icon">⚙️</span>'
                        : '<span class="wl-setting-icon">⚙️</span><span class="wl-setting-arrow"> ▾</span>';
                    menuBtn.onclick = (e) => {
                        e.stopPropagation();
                        toggleWlRowMenu(e, sym);
                    };

                    const menuDropdown = document.createElement('div');
                    menuDropdown.id = `wl-row-menu-${sym}`;
                    menuDropdown.className = 'menu-dropdown-content';
                    menuDropdown.style.cssText = `
                        display: none;
                        position: absolute;
                        right: 0;
                        top: 100%;
                        margin-top: 4px;
                        z-index: 1000;
                        min-width: 170px;
                        background: var(--bg-card);
                        border: 1px solid var(--border-color);
                        border-radius: 8px;
                        box-shadow: var(--shadow-md);
                        padding: 4px 0;
                        text-align: left;
                    `;

                    const menuItems = [
                        { label: '📊 Technical Chart', action: () => {
                            if (typeof window.openInHouseChart === 'function') window.openInHouseChart(sym);
                            else if (typeof openInHouseChart === 'function') openInHouseChart(sym);
                        }},
                        { label: '📈 Fundamentals', action: () => {
                            if (typeof window.openFundamentalsModal === 'function') window.openFundamentalsModal(sym);
                            else if (typeof openFundamentalsModal === 'function') openFundamentalsModal(sym);
                        }},
                        { label: '📰 Latest News', action: () => {
                            if (typeof window.openStockNewsModal === 'function') window.openStockNewsModal(sym);
                            else if (typeof openStockNewsModal === 'function') openStockNewsModal(sym);
                        }},
                        { label: '🔔 Set Price Alert', action: () => {
                            if (typeof window.openCreateAlertModal === 'function') window.openCreateAlertModal(sym);
                            else if (typeof openCreateAlertModal === 'function') openCreateAlertModal(sym);
                        }},
                        { divider: true },
                        { label: '🗑️ Remove Stock', danger: true, action: () => {
                            if (typeof window.removeWatchlistStock === 'function') window.removeWatchlistStock(null, sym);
                            else if (typeof removeWatchlistStock === 'function') removeWatchlistStock(null, sym);
                        }}
                    ];

                    menuItems.forEach(item => {
                        if (item.divider) {
                            const d = document.createElement('div');
                            d.style.cssText = 'height: 1px; background: var(--border-color); margin: 4px 0;';
                            menuDropdown.appendChild(d);
                            return;
                        }
                        const mBtn = document.createElement('div');
                        mBtn.className = 'menu-item';
                        mBtn.style.cssText = `padding: 8px 14px; font-size: 12px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 8px; color: ${item.danger ? '#ef4444' : 'var(--text-primary)'};`;
                        mBtn.innerText = item.label;

                        let lastTriggerTime = 0;
                        const handleAction = (ev) => {
                            const now = Date.now();
                            if (now - lastTriggerTime < 350) return;
                            lastTriggerTime = now;
                            if (ev) {
                                ev.preventDefault();
                                ev.stopPropagation();
                                ev.stopImmediatePropagation();
                            }
                            window._wlMenuJustClosed = true;
                            setTimeout(() => { window._wlMenuJustClosed = false; }, 400);
                            closeAllWlMenus();
                            try {
                                if (typeof item.action === 'function') {
                                    item.action();
                                }
                            } catch (err) {
                                console.error('Watchlist menu action error:', err);
                            }
                        };

                        mBtn.addEventListener('touchend', handleAction);
                        mBtn.addEventListener('click', handleAction);
                        menuDropdown.appendChild(mBtn);
                    });

                    menuWrapper.appendChild(menuBtn);
                    menuWrapper.appendChild(menuDropdown);
                    tdActions.appendChild(menuWrapper);


                    tr.appendChild(tdSymbol);
                    tr.appendChild(tdPrice);
                    tr.appendChild(tdChangeAmt);
                    tr.appendChild(tdChangePct);
                    tr.appendChild(tdActions);
                    tbody.appendChild(tr);
                });
            }

            table.appendChild(thead);
            table.appendChild(tbody);
            scrollContainer.appendChild(table);

            div.appendChild(controlsDiv);
            div.appendChild(scrollContainer);
            viewMount.appendChild(div);
        }

        // =========================================================
        // RESPONSIVE MOBILE MENU & ACCORDION CONTROLLERS
        // =========================================================
        function toggleWlMobileMenu(forceState) {
            const drawer = document.getElementById('wl-mobile-menu-drawer');
            const btn = document.getElementById('wl-mobile-menu-btn');
            if (!drawer) return;
            const shouldOpen = forceState !== undefined ? forceState : !drawer.classList.contains('open');
            if (shouldOpen) {
                drawer.classList.add('open');
                if (btn) btn.classList.add('active');
            } else {
                drawer.classList.remove('open');
                if (btn) btn.classList.remove('active');
            }
        }

        function toggleWlMobActionsAccordion(event) {
            if (event) event.stopPropagation();
            const content = document.getElementById('wl-mob-actions-content');
            const caret = document.getElementById('wl-mob-accordion-caret');
            if (!content) return;
            const isHidden = content.style.display === 'none';
            if (isHidden) {
                content.style.display = 'flex';
                if (caret) caret.innerText = '▾';
            } else {
                content.style.display = 'none';
                if (caret) caret.innerText = '▸';
            }
        }
        window.toggleWlMobileMenu = toggleWlMobileMenu;
        window.toggleWlMobActionsAccordion = toggleWlMobActionsAccordion;

        if (!window._wlMobileMenuBound) {
            document.addEventListener('click', (e) => {
                if (!e.target.closest('#wl-mobile-menu-drawer') && !e.target.closest('#wl-mobile-menu-btn')) {
                    if (typeof toggleWlMobileMenu === 'function') toggleWlMobileMenu(false);
                }
            });
            window._wlMobileMenuBound = true;
        }

        let _wlMenuOpenScrollY = 0;

        function toggleWlRowMenu(e, sym) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const dropdown = document.getElementById(`wl-row-menu-${sym}`);
            const btn = e ? (e.currentTarget || (e.target && e.target.closest ? e.target.closest('button') : null)) : null;
            const parentTr = dropdown ? dropdown.closest('tr') : null;
            const isAlreadyOpen = dropdown && dropdown.style.display === 'block';

            closeAllWlMenus();

            if (dropdown && !isAlreadyOpen) {
                if (window.innerWidth <= 768) {
                    const btnRect = btn ? btn.getBoundingClientRect() : (dropdown.parentElement ? dropdown.parentElement.getBoundingClientRect() : null);
                    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
                    
                    let shouldOpenUp = false;
                    if (btnRect) {
                        const spaceBelow = viewportHeight - btnRect.bottom;
                        const spaceAbove = btnRect.top - 60; // 60px reserved for sticky mobile header
                        const MENU_CLEARANCE = 190; // Dropdown height is ~180px

                        // Only flip upwards if it CANNOT fit below AND has more room above
                        if (spaceBelow < MENU_CLEARANCE) {
                            if (spaceAbove >= MENU_CLEARANCE || spaceAbove > spaceBelow) {
                                shouldOpenUp = true;
                            }
                        }
                    }

                    if (shouldOpenUp) {
                        dropdown.style.top = 'auto';
                        dropdown.style.bottom = '100%';
                        dropdown.style.marginTop = '0';
                        dropdown.style.marginBottom = '4px';
                    } else {
                        dropdown.style.top = '100%';
                        dropdown.style.bottom = 'auto';
                        dropdown.style.marginTop = '4px';
                        dropdown.style.marginBottom = '0';
                    }
                } else {
                    dropdown.style.top = '100%';
                    dropdown.style.bottom = 'auto';
                    dropdown.style.marginTop = '4px';
                    dropdown.style.marginBottom = '0';
                }

                dropdown.style.display = 'block';
                if (parentTr) parentTr.classList.add('wl-row-menu-open');
                _wlMenuOpenScrollY = window.scrollY || window.pageYOffset || 0;
            }
        }

        function closeAllWlMenus() {
            let hadOpen = false;
            document.querySelectorAll('[id^="wl-row-menu-"]').forEach(el => {
                if (el.style.display === 'block') {
                    hadOpen = true;
                    el.style.display = 'none';
                }
            });
            document.querySelectorAll('.wl-row-menu-open').forEach(el => el.classList.remove('wl-row-menu-open'));
            if (hadOpen) {
                window._wlMenuJustClosed = true;
                setTimeout(() => { window._wlMenuJustClosed = false; }, 300);
            }
        }

        if (!window._wlRowMenuOutsideBound) {
            const handleOutside = (e) => {
                if (!e.target.closest('.menu-dropdown-content') && !e.target.closest('.wl-row-menu-btn')) {
                    closeAllWlMenus();
                }
            };
            document.addEventListener('click', handleOutside);
            document.addEventListener('touchstart', handleOutside, { passive: true });
            window.addEventListener('scroll', () => {
                if (window.innerWidth <= 768) {
                    const currentY = window.scrollY || window.pageYOffset || 0;
                    if (Math.abs(currentY - _wlMenuOpenScrollY) > 8) {
                        closeAllWlMenus();
                    }
                }
            }, { passive: true });
            document.addEventListener('touchmove', (e) => {
                if (window.innerWidth <= 768 && !e.target.closest('.menu-dropdown-content')) {
                    closeAllWlMenus();
                }
            }, { passive: true });
            window._wlRowMenuOutsideBound = true;
        }

        // Search Autocomplete Handler
        function handleSearchInput(type, inputElement, event) {
            const query = inputElement.value.trim();
            let dropdown;
            if (type === 'wl') {
                dropdown = inputElement.nextElementSibling;
            } else if (type === 'modal-pf') {
                dropdown = document.getElementById('dropdown-modal-pf');
            } else if (type === 'scTx') {
                dropdown = document.getElementById('dropdown-scTx');
            } else {
                dropdown = document.getElementById('dropdown-pf');
            }
            
            if (searchTimeout) clearTimeout(searchTimeout);
            
            if (query.length < 2) {
                if (dropdown) dropdown.style.display = 'none';
                return;
            }

            searchTimeout = setTimeout(async () => {
                const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
                const results = await res.json();
                
                if (!dropdown) return;
                dropdown.innerHTML = '';
                if (results.length > 0) {
                    results.forEach(item => {
                        const div = document.createElement('div');
                        div.className = 'autocomplete-item';
                        const bInfo = getSymbolBadge(item.symbol, item.exchange);
                        div.innerHTML = `
                            <div>
                                <span class="autocomplete-symbol">${cleanDisplaySymbol(item.symbol)}</span>
                                <span class="badge ${bInfo.class}">${bInfo.label}</span>
                                <div class="autocomplete-name">${escapeHtml(item.name)}</div>
                            </div>
                        `;
                        div.onclick = () => {
                            if (type === 'wl') {
                                const targetName = inputElement.getAttribute('data-wl-name');
                                addWatchlistStock(targetName, item.symbol);
                            } else if (type === 'modal-pf') {
                                const symInput = document.getElementById('modal-pf-add-symbol');
                                if (symInput) symInput.value = item.symbol;
                            } else if (type === 'scTx') {
                                const symInput = document.getElementById('scTxSymbol');
                                if (symInput) symInput.value = item.symbol;
                                const priceInput = document.getElementById('scTxPrice');
                                const info = stockPricesData[item.symbol] || {};
                                if (priceInput && info.price) {
                                    priceInput.value = info.price.toFixed(2);
                                }
                            } else {
                                const symInput = document.getElementById('pf-add-symbol');
                                if (symInput) symInput.value = item.symbol;
                            }
                            dropdown.style.display = 'none';
                        };
                        dropdown.appendChild(div);
                    });
                    dropdown.style.display = 'block';
                } else {
                    dropdown.style.display = 'none';
                }
            }, 250);
        }

        // Modal Handler Functions for Watchlist, Portfolio, and Add Holding Popups
        function openCreateWatchlistModal() {
            const input = document.getElementById('modal-new-watchlist-name');
            if (input) input.value = '';
            const modal = document.getElementById('createWatchlistModal');
            if (modal) modal.style.display = 'block';
        }

        function closeCreateWatchlistModal() {
            const modal = document.getElementById('createWatchlistModal');
            if (modal) modal.style.display = 'none';
        }

        async function submitCreateWatchlist() {
            const input = document.getElementById('modal-new-watchlist-name');
            const name = input.value.trim();
            if (!name) {
                alert('Please enter a watchlist name!');
                return;
            }
            const res = await fetch('/api/watchlists', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const data = await res.json();
            if (data.success) {
                closeCreateWatchlistModal();
                watchlistsData = data.watchlists;
                activeWatchlistName = name;
                renderWatchlists();
                refreshPrices();
            } else {
                alert(data.error || 'Failed to create watchlist');
            }
        }

        // Close dropdowns on outside click
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.autocomplete-wrapper')) {
                document.querySelectorAll('.autocomplete-dropdown').forEach(el => el.style.display = 'none');
            }
        });

        // =========================================================
        // WATCHLIST TXT EXPORT / IMPORT
        // =========================================================
        function exportActiveWatchlistToTxt() {
            if (!activeWatchlistName || !watchlistsData[activeWatchlistName]) {
                alert('No active watchlist selected to export!');
                return;
            }

            const symbols = (watchlistsData[activeWatchlistName] || []).slice();
            if (symbols.length === 0) {
                alert('The current watchlist is empty.');
                return;
            }

            const content = symbols.join(',');
            const blob = new Blob([content + '\n'], { type: 'text/plain;charset=utf-8;' });
            const link = document.createElement('a');
            const safeName = activeWatchlistName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'watchlist';
            const dateStr = new Date().toISOString().split('T')[0];
            link.href = URL.createObjectURL(blob);
            link.download = `${safeName}_watchlist_${dateStr}.txt`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        }

        function openWatchlistTxtImportModal() {
            if (!activeWatchlistName || !watchlistsData[activeWatchlistName]) {
                alert('No active watchlist selected for import!');
                return;
            }

            const modal = document.getElementById('importWatchlistTxtModal');
            const input = document.getElementById('watchlist-txt-import-input');
            const report = document.getElementById('watchlist-import-report');
            if (input) input.value = '';
            if (report) {
                report.style.display = 'none';
                report.innerHTML = '';
            }
            if (modal) modal.style.display = 'block';
        }

        function closeWatchlistTxtImportModal() {
            const modal = document.getElementById('importWatchlistTxtModal');
            if (modal) modal.style.display = 'none';
        }

        async function handleWatchlistTxtImport(event) {
            const file = event.target.files && event.target.files[0];
            if (!file) return;

            const report = document.getElementById('watchlist-import-report');
            const showReport = (html) => {
                if (!report) return;
                report.style.display = 'block';
                report.innerHTML = html;
            };

            if (!file.name.toLowerCase().endsWith('.txt')) {
                showReport('<div style="color:#ef5350;">Please select a .txt file.</div>');
                event.target.value = '';
                return;
            }

            const formData = new FormData();
            formData.append('file', file);
            showReport('<div style="color:var(--text-secondary);">Importing and checking symbols with Yahoo Finance...</div>');

            try {
                const res = await fetch(`/api/watchlists/${encodeURIComponent(activeWatchlistName)}/stocks/import-txt`, {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();

                if (!res.ok || !data.success) {
                    showReport(`<div style="color:#ef5350;">${escapeHtml(data.error || 'Failed to import watchlist TXT file.')}</div>`);
                    return;
                }

                watchlistsData = data.watchlists || watchlistsData;
                    renderWatchlists();
                refreshPrices();

                const notAdded = data.not_added_symbols || [];
                const alreadyPresent = data.already_present_symbols || [];
                const bseSymbols = data.bse_symbols || [];

                let html = `
                    <div style="border:1px solid var(--border-color); border-radius:8px; padding:14px; background:var(--card-bg);">
                        <div style="font-weight:600; margin-bottom:12px;">Import Result</div>
                        <div style="display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; font-size:13px;">
                            <div>Total stocks: <strong>${data.total_stocks || 0}</strong></div>
                            <div>Total added: <strong>${data.added_count || 0}</strong></div>
                            <div>Total not added: <strong>${data.not_added_count || 0}</strong></div>
                            <div>Already present: <strong>${data.already_present_count || 0}</strong></div>
                            <div>Added from BSE: <strong>${data.bse_count || 0}</strong></div>
                        </div>`;

                if (notAdded.length) {
                    html += `<div style="margin-top:14px;"><strong>Not added:</strong><div style="margin-top:6px; color:#ef5350; word-break:break-word;">${notAdded.map(escapeHtml).join(', ')}</div></div>`;
                }
                if (alreadyPresent.length) {
                    html += `<div style="margin-top:12px;"><strong>Already present:</strong><div style="margin-top:6px; color:var(--text-secondary); word-break:break-word;">${alreadyPresent.map(escapeHtml).join(', ')}</div></div>`;
                }
                if (bseSymbols.length) {
                    html += `<div style="margin-top:12px;"><strong>Resolved through BSE:</strong><div style="margin-top:6px; color:var(--text-secondary); word-break:break-word;">${bseSymbols.map(escapeHtml).join(', ')}</div></div>`;
                }

                html += '</div>';
                showReport(html);
            } catch (err) {
                showReport(`<div style="color:#ef5350;">Import failed: ${escapeHtml(err.message)}</div>`);
            } finally {
                event.target.value = '';
            }
        }

        function escapeHtml(value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        function downloadWatchlistSampleTxt() {
            const link = document.createElement('a');
            link.href = '/static/sample_watchlist.txt';
            link.download = 'sample_watchlist.txt';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        function exportTableToExcel(tableId, filename) {
            const table = typeof tableId === 'string' ? document.getElementById(tableId) : tableId;
            if (!table) return;

            let csv = [];
            const rows = table.querySelectorAll('tr');

            rows.forEach(row => {
                let cols = row.querySelectorAll('th, td');
                let rowData = [];
                cols.forEach(col => {
                    if (col.querySelector('button') && !col.innerText.trim()) return;
                    let text = col.innerText.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
                    rowData.push(`"${text.replace(/"/g, '""')}"`);
                });
                if (rowData.length > 0) {
                    csv.push(rowData.join(','));
                }
            });

            const csvContent = '\uFEFF' + csv.join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.setAttribute('download', filename || 'export.csv');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        // =========================================================
        // MOBILE SORT MODAL CONTROLLER
        // =========================================================
        function openWlMobileSortModal() {
            let modal = document.getElementById('wlMobileSortModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'wlMobileSortModal';
                modal.className = 'small-modal wl-mobile-sort-sheet';
                modal.onclick = (e) => { if (e.target === modal) closeWlMobileSortModal(); };
                modal.innerHTML = `
                    <div class="small-modal-content wl-sort-sheet-content">
                        <div class="wl-sort-sheet-handle"></div>
                        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 12px;">
                            <h3 style="margin: 0; font-size: 16px; font-weight: 600;">Sort Stocks</h3>
                            <span style="font-size: 22px; cursor: pointer; color: var(--text-secondary);" onclick="closeWlMobileSortModal()">&times;</span>
                        </div>
                        <div class="wl-sort-options-list" id="wl-mobile-sort-options"></div>
                    </div>
                `;
                document.body.appendChild(modal);
            }

            const optionsContainer = modal.querySelector('#wl-mobile-sort-options');
            if (optionsContainer) {
                const options = [
                    { id: 'pct_desc', col: 'change_pct', dir: 'desc', label: 'Day P&L % (High to Low)' },
                    { id: 'pct_asc', col: 'change_pct', dir: 'asc', label: 'Day P&L % (Low to High)' },
                    { id: 'amt_desc', col: 'change', dir: 'desc', label: 'Day P&L ₹ (High to Low)' },
                    { id: 'amt_asc', col: 'change', dir: 'asc', label: 'Day P&L ₹ (Low to High)' },
                    { id: 'price_desc', col: 'price', dir: 'desc', label: 'LTP (High to Low)' },
                    { id: 'price_asc', col: 'price', dir: 'asc', label: 'LTP (Low to High)' },
                    { id: 'sym_asc', col: 'symbol', dir: 'asc', label: 'Company / Symbol (A to Z)' },
                    { id: 'sym_desc', col: 'symbol', dir: 'desc', label: 'Company / Symbol (Z to A)' },
                ];

                optionsContainer.innerHTML = '';
                options.forEach(opt => {
                    const isSelected = (wlSortColumn === opt.col && wlSortDirection === opt.dir);
                    const item = document.createElement('div');
                    item.className = `wl-sort-option-item ${isSelected ? 'selected' : ''}`;
                    item.innerHTML = `
                        <span>${opt.label}</span>
                        <span class="check-icon">✓</span>
                    `;
                    item.onclick = () => {
                        wlSortColumn = opt.col;
                        wlSortDirection = opt.dir;
                        closeWlMobileSortModal();
                        renderWatchlists();
                        refreshPrices();
                    };
                    optionsContainer.appendChild(item);
                });
            }

            modal.style.display = 'flex';
        }

        function closeWlMobileSortModal() {
            const modal = document.getElementById('wlMobileSortModal');
            if (modal) modal.style.display = 'none';
        }
        window.openWlMobileSortModal = openWlMobileSortModal;
        window.closeWlMobileSortModal = closeWlMobileSortModal;
