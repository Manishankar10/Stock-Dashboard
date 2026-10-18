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
                        window.location.replace('/login');
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

        let draggedWatchlistName = null;

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
                try {
                    localStorage.setItem('cd_cached_watchlists', JSON.stringify(watchlistsData));
                } catch(e) {}
                renderWatchlists();
            } catch (error) {
                showToast(error.message || 'Could not save watchlist order', 'error');
                await fetchWatchlists();
            }
        }
        window.saveWatchlistOrder = saveWatchlistOrder;

        function moveWatchlist(sourceName, targetName, position = 'auto') {
            const isWeb = window.innerWidth > 768;
            if (!isWeb) return;

            const names = Object.keys(watchlistsData || {});
            const sourceIndex = names.indexOf(sourceName);
            const targetIndex = names.indexOf(targetName);
            if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;

            // Remove source from current position
            names.splice(sourceIndex, 1);
            const newTargetIndex = names.indexOf(targetName);

            let insertIndex;
            if (position === 'before') {
                insertIndex = newTargetIndex;
            } else if (position === 'after') {
                insertIndex = newTargetIndex + 1;
            } else {
                insertIndex = (sourceIndex < targetIndex) ? (newTargetIndex + 1) : newTargetIndex;
            }

            names.splice(insertIndex, 0, sourceName);
            watchlistsData = Object.fromEntries(names.map(name => [name, watchlistsData[name]]));
            try {
                localStorage.setItem('cd_cached_watchlists', JSON.stringify(watchlistsData));
            } catch(e) {}
            renderWatchlists();
            saveWatchlistOrder(names);
        }
        window.moveWatchlist = moveWatchlist;

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
            const isSame = (activeWatchlistName === name);
            activeWatchlistName = name;

            // Strict Rule (Web & Responsive): moving to any watchlist must load only that watchlist's upcoming events
            if (typeof window.renderUpcomingEvents === 'function') {
                window.renderUpcomingEvents(name, true);
            }

            if (isSame) {
                // Already on this watchlist: avoid redundant re-render or re-scrolling tabs
                return;
            }

            renderWatchlists();
            if (typeof updateMobileHeaderActiveBadge === 'function') updateMobileHeaderActiveBadge();
            if (window.innerWidth <= 768 && typeof scrollActiveWatchlistTabIntoView === 'function') {
                scrollActiveWatchlistTabIntoView(name, true);
            }
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
                showToast('No active watchlist selected to delete.', 'warning');
                return;
            }

            let confirmed = false;
            if (typeof showCustomConfirm === 'function') {
                confirmed = await showCustomConfirm({
                    title: 'Delete Watchlist',
                    message: `Are you sure you want to permanently delete watchlist "${nameToDelete}"?\n\nAll stocks in this watchlist will be removed.`,
                    isDanger: true,
                    confirmText: 'Delete'
                });
            } else if (typeof window.showCustomConfirm === 'function') {
                confirmed = await window.showCustomConfirm({
                    title: 'Delete Watchlist',
                    message: `Are you sure you want to permanently delete watchlist "${nameToDelete}"?\n\nAll stocks in this watchlist will be removed.`,
                    isDanger: true,
                    confirmText: 'Delete'
                });
            } else {
                const confirmFn = window.nativeConfirm || window.confirm;
                confirmed = confirmFn(`Are you sure you want to permanently delete watchlist "${nameToDelete}"?\n\nAll stocks in this watchlist will be removed.`);
            }

            if (!confirmed) return;

            try {
                const res = await fetch(`/api/watchlists/${encodeURIComponent(nameToDelete)}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    showToast(`Watchlist "${nameToDelete}" deleted successfully`, 'info');
                    watchlistsData = data.watchlists;
                    try {
                        localStorage.setItem('cd_cached_watchlists', JSON.stringify(watchlistsData));
                    } catch(e) {}
                    const names = Object.keys(watchlistsData);
                    if (activeWatchlistName === nameToDelete) {
                        activeWatchlistName = names.length > 0 ? names[0] : '';
                    }
                    renderWatchlists();
                    refreshPrices();
                } else {
                    showToast(data.error || 'Failed to delete watchlist', 'error');
                }
            } catch (err) {
                console.error('Delete watchlist error:', err);
                showToast('Error deleting watchlist. Please check network connection.', 'error');
            }
        }
        window.deleteActiveWatchlist = deleteActiveWatchlist;

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
                showToast(`Added ${cleanDisplaySymbol(symbol)} to ${targetName}`, 'success');
                watchlistsData = data.watchlists;
                renderWatchlists();
                refreshPrices();
            } else {
                showToast(data.error || 'Failed to add stock', 'error');
            }
        }
        window.addWatchlistStock = addWatchlistStock;

        async function removeWatchlistStock(watchlistName, symbol) {
            const targetName = watchlistName || activeWatchlistName;
            if (!targetName || !symbol) return;

            let confirmed = false;
            if (typeof showCustomConfirm === 'function') {
                confirmed = await showCustomConfirm({
                    title: 'Remove Stock',
                    message: `Are you sure you want to remove ${cleanDisplaySymbol(symbol)} (${symbol}) from "${targetName}"?`,
                    isDanger: true,
                    confirmText: 'Remove'
                });
            } else if (typeof window.showCustomConfirm === 'function') {
                confirmed = await window.showCustomConfirm({
                    title: 'Remove Stock',
                    message: `Are you sure you want to remove ${cleanDisplaySymbol(symbol)} (${symbol}) from "${targetName}"?`,
                    isDanger: true,
                    confirmText: 'Remove'
                });
            } else {
                const confirmFn = window.nativeConfirm || window.confirm;
                confirmed = confirmFn(`Are you sure you want to remove ${cleanDisplaySymbol(symbol)} (${symbol}) from "${targetName}"?`);
            }

            if (!confirmed) return;

            try {
                const res = await fetch(`/api/watchlists/${encodeURIComponent(targetName)}/stocks/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    showToast(`Removed ${cleanDisplaySymbol(symbol)} from ${targetName}`, 'info');
                    watchlistsData = data.watchlists;
                    renderWatchlists();
                    refreshPrices();
                } else {
                    showToast(data.error || 'Failed to remove stock', 'error');
                }
            } catch (err) {
                console.error('Remove stock error:', err);
                showToast('Failed to remove stock. Please check network connection.', 'error');
            }
        }
        window.removeWatchlistStock = removeWatchlistStock;

        async function moveWatchlistStock(sourceWatchlist, targetWatchlist, symbol) {
            const src = sourceWatchlist || activeWatchlistName;
            const tgt = targetWatchlist;
            if (!src || !tgt || !symbol) return;
            if (src === tgt) {
                showToast('Source and target watchlists are the same.', 'info');
                return;
            }

            try {
                const res = await fetch('/api/watchlists/move-stock', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        source_watchlist: src,
                        target_watchlist: tgt,
                        symbol: symbol
                    })
                });
                const data = await res.json();
                if (data.success) {
                    showToast(`Moved ${cleanDisplaySymbol(symbol)} to "${tgt}"`, 'success');
                    watchlistsData = data.watchlists;
                    try {
                        localStorage.setItem('cd_cached_watchlists', JSON.stringify(watchlistsData));
                    } catch(e) {}
                    renderWatchlists();
                    refreshPrices();
                } else {
                    showToast(data.error || 'Failed to move stock', 'error');
                }
            } catch (err) {
                console.error('Move stock error:', err);
                showToast('Failed to move stock. Please check network connection.', 'error');
            }
        }
        window.moveWatchlistStock = moveWatchlistStock;

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

        async function triggerWatchlistRefresh(btnEl) {
            if (window._isWlRefreshing) return;
            window._isWlRefreshing = true;

            const btns = document.querySelectorAll('.wl-refresh-btn, .wl-mobile-refresh-btn');
            btns.forEach(b => b.classList.add('refreshing'));
            if (btnEl) btnEl.classList.add('refreshing');

            const wlTable = document.querySelector('#watchlist-view-mount table, #watchlist-table-mount table, .watchlist-container, #tab-watchlists table');
            if (wlTable) {
                wlTable.style.opacity = '0.65';
                wlTable.style.transition = 'opacity 0.2s ease';
            }

            try {
                if (typeof refreshPrices === 'function') {
                    await refreshPrices({ force_refresh: true });
                }
            } catch (err) {
                console.warn('Watchlist refresh error:', err);
            } finally {
                setTimeout(() => {
                    btns.forEach(b => b.classList.remove('refreshing'));
                    if (btnEl) btnEl.classList.remove('refreshing');
                    if (wlTable) {
                        wlTable.style.opacity = '1';
                    }
                    window._isWlRefreshing = false;
                }, 400);
            }
        }
        window.triggerWatchlistRefresh = triggerWatchlistRefresh;

        function renderWatchlists() {
            if (typeof updateMobileHeaderActiveBadge === 'function') updateMobileHeaderActiveBadge();
            // 1. Render Selector Bar
            const selectorMount = document.getElementById('watchlist-selector-mount');
            if (selectorMount) {
                const wlNames = Object.keys(watchlistsData);
                if (wlNames.length === 0) {
                    selectorMount.innerHTML = '<span style="color:var(--text-secondary); font-size:13px;">No watchlists created yet.</span>';
                } else {
                    const isWeb = window.innerWidth > 768;
                    const existingButtons = Array.from(selectorMount.querySelectorAll('.pf-select-btn'));
                    const existingNames = existingButtons.map(b => b.dataset.watchlistName);
                    const isMatching = (existingNames.length === wlNames.length) && existingNames.every((n, i) => n === wlNames[i]);

                    if (isMatching && selectorMount.querySelector('.wl-add-tab-btn')) {
                        // Watchlist tabs exist and match: just update active class without destroying DOM or resetting scroll
                        existingButtons.forEach(btn => {
                            btn.classList.toggle('active', btn.dataset.watchlistName === activeWatchlistName);
                        });
                    } else {
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
                    wlNames.forEach(name => {
                        const btn = document.createElement('button');
                        btn.className = `pf-select-btn ${name === activeWatchlistName ? 'active' : ''}`;
                        btn.innerText = name;
                        btn.dataset.watchlistName = name;
                        btn.onclick = () => selectWatchlist(name);

                        // Drag and drop reordering: web only
                        if (isWeb) {
                            btn.draggable = true;
                            btn.ondragstart = event => {
                                draggedWatchlistName = name;
                                if (event.dataTransfer) {
                                    try {
                                        event.dataTransfer.setData('text/plain', name);
                                    } catch (e) {}
                                    event.dataTransfer.effectAllowed = 'move';
                                }
                                btn.classList.add('selector-dragging');
                            };
                            btn.ondragend = () => {
                                draggedWatchlistName = null;
                                btn.classList.remove('selector-dragging');
                                selectorMount.querySelectorAll('.pf-select-btn').forEach(item => {
                                    item.classList.remove('selector-dragging', 'selector-drop-before', 'selector-drop-after', 'selector-drop-target');
                                });
                            };
                            btn.ondragover = event => {
                                event.preventDefault();
                                if (event.dataTransfer) {
                                    event.dataTransfer.dropEffect = 'move';
                                }
                                const rect = btn.getBoundingClientRect();
                                const isLeftHalf = (event.clientX - rect.left) < (rect.width / 2);
                                btn.classList.remove('selector-drop-before', 'selector-drop-after', 'selector-drop-target');
                                if (isLeftHalf) {
                                    btn.classList.add('selector-drop-before');
                                } else {
                                    btn.classList.add('selector-drop-after');
                                }
                            };
                            btn.ondragleave = () => {
                                btn.classList.remove('selector-drop-before', 'selector-drop-after', 'selector-drop-target');
                            };
                            btn.ondrop = event => {
                                event.preventDefault();
                                const rect = btn.getBoundingClientRect();
                                const isLeftHalf = (event.clientX - rect.left) < (rect.width / 2);
                                const dropPosition = isLeftHalf ? 'before' : 'after';
                                selectorMount.querySelectorAll('.pf-select-btn').forEach(item => {
                                    item.classList.remove('selector-dragging', 'selector-drop-before', 'selector-drop-after', 'selector-drop-target');
                                });
                                let sourceName = '';
                                try {
                                    if (event.dataTransfer) {
                                        sourceName = event.dataTransfer.getData('text/plain');
                                    }
                                } catch (e) {}
                                if (!sourceName) {
                                    sourceName = draggedWatchlistName;
                                }
                                if (sourceName && sourceName !== name) {
                                    moveWatchlist(sourceName, name, dropPosition);
                                }
                                draggedWatchlistName = null;
                            };
                        } else {
                            btn.draggable = false;
                        }
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

                        if (!isWeb && typeof scrollActiveWatchlistTabIntoView === 'function') {
                            scrollActiveWatchlistTabIntoView(activeWatchlistName, false);
                        }
                    }
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

            // Mobile Refresh Button (glassy button matching portfolio style)
            const mobRefreshBtn = document.createElement('button');
            mobRefreshBtn.type = 'button';
            mobRefreshBtn.className = 'wl-refresh-btn wl-mobile-refresh-btn';
            mobRefreshBtn.title = 'Refresh Watchlist Quotes';
            mobRefreshBtn.setAttribute('aria-label', 'Refresh Quotes');
            mobRefreshBtn.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>
            `;
            mobRefreshBtn.onclick = () => triggerWatchlistRefresh(mobRefreshBtn);
            searchRow.appendChild(mobRefreshBtn);

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
                openWlMobileMenuModal();
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

            // Watchlist Refresh Button (matching responsive portfolio style)
            const wlRefreshBtn = document.createElement('button');
            wlRefreshBtn.type = 'button';
            wlRefreshBtn.className = 'wl-refresh-btn';
            wlRefreshBtn.title = 'Refresh Watchlist Quotes';
            wlRefreshBtn.setAttribute('aria-label', 'Refresh Quotes');
            wlRefreshBtn.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>
            `;
            wlRefreshBtn.onclick = () => triggerWatchlistRefresh(wlRefreshBtn);
            watchlistFileControls.appendChild(wlRefreshBtn);

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
                <col class="wl-cg-symbol" style="width: 30%;">
                <col class="wl-cg-price" style="width: 22%;">
                <col class="wl-cg-change-amt" style="width: 20%;">
                <col class="wl-cg-change-pct" style="width: 18%;">
                <col class="wl-cg-actions" style="width: 10%;">
            `;
            table.appendChild(colgroup);

            const thead = document.createElement('thead');
            thead.innerHTML = `
                <tr>
                    <th class="wl-col-symbol" style="cursor:pointer; user-select:none;" onclick="toggleWatchlistSort('symbol')" title="Click to sort by Symbol">
                        <span class="col-lbl-full">Symbol</span><span class="col-lbl-compact">Symbol</span> ${getSortIcon('symbol')}
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
                    const info = stockPricesData[sym];
                    const hasData = info && !info.error && info.price !== undefined;
                    const compName = (hasData && info.name) ? info.name : cleanDisplaySymbol(sym);

                    const tr = document.createElement('tr');
                    tr.id = `row-${sym}`;
                    tr.className = 'pf-row';
                    tr.dataset.symbol = sym;
                    tr.dataset.companyName = compName;
                    if (window.innerWidth <= 768) {
                        tr.title = 'Click row to view interactive technical chart';
                    }
                    tr.onclick = (e) => {
                        if (e.target.closest('.wl-row-menu-btn') || e.target.closest('.menu-dropdown-content') || e.target.closest('button')) return;
                        if (window._wlMenuJustClosed) return;
                        if (typeof openInHouseChart === 'function') openInHouseChart(sym);
                        else if (typeof window.openInHouseChart === 'function') window.openInHouseChart(sym);
                    };
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
                    const amtSign = (hasData && info.change !== undefined) ? (info.change >= 0 ? '+' : '-') : '';
                    const changeAmtHtml = (hasData && info.change !== undefined)
                        ? `${amtSign}₹${Math.abs(info.change).toFixed(2)}`
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

                            menuWrapper.appendChild(menuBtn);
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

            if (typeof initWatchlistMobileSwipe === 'function') {
                initWatchlistMobileSwipe();
            }

            if (typeof window.renderUpcomingEvents === 'function') {
                window.renderUpcomingEvents(activeWatchlistName);
            }
        }

        // =========================================================
        // RESPONSIVE MOBILE MENU BOTTOM SHEET
        // =========================================================
        function openWlMobileMenuModal() {
            let modal = document.getElementById('wlMobileMenuModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'wlMobileMenuModal';
                modal.className = 'small-modal wl-mobile-menu-sheet';
                modal.onclick = (e) => { if (e.target === modal) closeWlMobileMenuModal(); };
                document.body.appendChild(modal);
            }

            const currentWl = activeWatchlistName || 'Watchlist';
            modal.innerHTML = `
                <div class="small-modal-content wl-action-sheet-content">
                    <div class="wl-action-sheet-handle"></div>
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 14px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 17px;">⚙️</span>
                            <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-primary); font-family: 'Plus Jakarta Sans', sans-serif;">
                                Watchlist Options (${escapeHtml(currentWl)})
                            </h3>
                        </div>
                        <span style="font-size: 24px; cursor: pointer; color: var(--text-secondary); line-height: 1; padding: 2px 6px;" onclick="closeWlMobileMenuModal()">&times;</span>
                    </div>

                    <div class="wl-action-sheet-list">
                        <!-- 1. Sort & Filter -->
                        <div class="wl-sheet-item" onclick="closeWlMobileMenuModal(); openWlMobileSortModal();">
                            <div class="wl-sheet-item-left">
                                <span class="wl-sheet-icon">⇄</span>
                                <div>
                                    <div class="wl-sheet-title">Sort & Filter</div>
                                    <div class="wl-sheet-sub">Change sorting order of stocks</div>
                                </div>
                            </div>
                            <span class="wl-sheet-chevron">›</span>
                        </div>

                        <!-- 2. Upcoming Events -->
                        <div class="wl-sheet-item" onclick="closeWlMobileMenuModal(); if (typeof window.openUpcomingEventsModal === 'function') window.openUpcomingEventsModal();">
                            <div class="wl-sheet-item-left">
                                <span class="wl-sheet-icon">📅</span>
                                <div>
                                    <div class="wl-sheet-title">Upcoming Events</div>
                                    <div class="wl-sheet-sub">Results, AGM, Concalls</div>
                                </div>
                            </div>
                            <span class="wl-sheet-chevron">›</span>
                        </div>

                        <!-- 3. Official Feeds -->
                        <div class="wl-sheet-item" onclick="closeWlMobileMenuModal(); openWatchlistOfficialFeeds('${escapeHtml(currentWl)}');">
                            <div class="wl-sheet-item-left">
                                <span class="wl-sheet-icon">◉</span>
                                <div>
                                    <div class="wl-sheet-title">Official Feeds</div>
                                    <div class="wl-sheet-sub">Exchange corporate announcements</div>
                                </div>
                            </div>
                            <span class="wl-sheet-chevron">↗</span>
                        </div>

                        <!-- 4. Actions (Collapsible: Export, Import, Delete) -->
                        <div class="wl-sheet-item wl-sheet-collapsible-trigger" id="wl-actions-collapse-trigger" onclick="toggleWlActionsCollapse(event)">
                            <div class="wl-sheet-item-left">
                                <span class="wl-sheet-icon">⚡</span>
                                <div>
                                    <div class="wl-sheet-title">Actions</div>
                                    <div class="wl-sheet-sub">Export, Import, Delete watchlist</div>
                                </div>
                            </div>
                            <span class="wl-sheet-chevron wl-actions-chevron" id="wl-actions-chevron">›</span>
                        </div>

                        <!-- Collapsible Content (Default is collapsed) -->
                        <div class="wl-actions-collapsible-content" id="wl-actions-collapsible-content" style="display: none;">
                            <!-- Export Watchlist -->
                            <div class="wl-sheet-item wl-sub-sheet-item" onclick="closeWlMobileMenuModal(); exportActiveWatchlistToTxt();">
                                <div class="wl-sheet-item-left">
                                    <span class="wl-sheet-icon">📤</span>
                                    <div>
                                        <div class="wl-sheet-title">Export Watchlist (.txt)</div>
                                        <div class="wl-sheet-sub">Download tickers text file</div>
                                    </div>
                                </div>
                                <span class="wl-sheet-chevron">⇩</span>
                            </div>

                            <!-- Import Watchlist -->
                            <div class="wl-sheet-item wl-sub-sheet-item" onclick="closeWlMobileMenuModal(); openWatchlistTxtImportModal();">
                                <div class="wl-sheet-item-left">
                                    <span class="wl-sheet-icon">📥</span>
                                    <div>
                                        <div class="wl-sheet-title">Import Watchlist (.txt)</div>
                                        <div class="wl-sheet-sub">Upload stock tickers list</div>
                                    </div>
                                </div>
                                <span class="wl-sheet-chevron">⇧</span>
                            </div>

                            <!-- Delete Watchlist -->
                            <div class="wl-sheet-item wl-sub-sheet-item danger" onclick="closeWlMobileMenuModal(); deleteActiveWatchlist();">
                                <div class="wl-sheet-item-left">
                                    <span class="wl-sheet-icon danger">🗑️</span>
                                    <div>
                                        <div class="wl-sheet-title danger">Delete Watchlist</div>
                                        <div class="wl-sheet-sub">Permanently delete "${escapeHtml(currentWl)}"</div>
                                    </div>
                                </div>
                                <span class="wl-sheet-chevron danger">✕</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            modal.style.display = 'flex';
        }

        function closeWlMobileMenuModal() {
            const modal = document.getElementById('wlMobileMenuModal');
            if (modal) modal.style.display = 'none';
        }

        function toggleWlActionsCollapse(event) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            const content = document.getElementById('wl-actions-collapsible-content');
            const chevron = document.getElementById('wl-actions-chevron');
            const trigger = document.getElementById('wl-actions-collapse-trigger');
            if (!content) return;
            const isHidden = (content.style.display === 'none' || getComputedStyle(content).display === 'none');
            if (isHidden) {
                content.style.display = 'flex';
                if (chevron) chevron.style.transform = 'rotate(90deg)';
                if (trigger) trigger.classList.add('wl-actions-expanded');
            } else {
                content.style.display = 'none';
                if (chevron) chevron.style.transform = 'rotate(0deg)';
                if (trigger) trigger.classList.remove('wl-actions-expanded');
            }
        }

        window.openWlMobileMenuModal = openWlMobileMenuModal;
        window.closeWlMobileMenuModal = closeWlMobileMenuModal;
        window.toggleWlMobileMenu = openWlMobileMenuModal;
        window.toggleWlActionsCollapse = toggleWlActionsCollapse;

        let _wlMenuOpenScrollY = 0;

        function toggleWlRowMenu(e, sym) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const btn = e ? (e.currentTarget || (e.target && e.target.closest ? e.target.closest('button') : null)) : null;
            if (!btn) return;

            let popover = document.getElementById('wl-global-stock-popover');
            const isAlreadyOpen = popover && popover.style.display === 'block' && popover.dataset.sym === sym;

            closeAllWlMenus();

            if (isAlreadyOpen) {
                return;
            }

            if (!popover) {
                popover = document.createElement('div');
                popover.id = 'wl-global-stock-popover';
                popover.className = 'menu-dropdown-content wl-global-popover';
                document.body.appendChild(popover);
            }

            popover.dataset.sym = sym;
            popover.innerHTML = '';

            const info = (stockPricesData && stockPricesData[sym]) || {};

            const menuItems = [
                { label: '📊 Technical Chart', action: () => {
                    if (typeof window.openInHouseChart === 'function') window.openInHouseChart(sym);
                    else if (typeof openInHouseChart === 'function') openInHouseChart(sym);
                }},
                { label: '📈 Fundamentals', action: () => {
                    if (typeof window.openFundamentalsModal === 'function') window.openFundamentalsModal(sym);
                    else if (typeof openFundamentalsModal === 'function') openFundamentalsModal(sym);
                }},
                { label: '🏛️ Institutional & Broker Research', action: () => {
                    if (typeof window.openBrokerResearchModal === 'function') window.openBrokerResearchModal(sym, info.name || sym);
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
                { isMove: true },
                { label: '🗑️ Remove Stock', danger: true, action: () => {
                    if (typeof window.removeWatchlistStock === 'function') window.removeWatchlistStock(null, sym);
                    else if (typeof removeWatchlistStock === 'function') removeWatchlistStock(null, sym);
                }}
            ];

            menuItems.forEach(item => {
                if (item.divider) {
                    const d = document.createElement('div');
                    d.style.cssText = 'height: 1px; background: var(--border-color); margin: 4px 0;';
                    popover.appendChild(d);
                    return;
                }

                if (item.isMove) {
                    const otherWatchlists = Object.keys(watchlistsData || {}).filter(wName => wName !== activeWatchlistName);
                    const mMove = document.createElement('div');
                    mMove.className = 'menu-item wl-move-menu-item';
                    mMove.style.cssText = 'padding: 8px 14px; font-size: 12px; font-weight: 500; cursor: pointer; display: flex; align-items: center; justify-content: space-between; position: relative; color: var(--text-primary);';

                    const labelSpan = document.createElement('span');
                    labelSpan.style.cssText = 'display: inline-flex; align-items: center; gap: 8px;';
                    labelSpan.innerHTML = '<span>📁</span><span>Move</span>';

                    const arrowSpan = document.createElement('span');
                    arrowSpan.className = 'wl-move-arrow';
                    arrowSpan.style.cssText = 'font-size: 10px; opacity: 0.7; margin-left: auto; padding-left: 10px;';
                    arrowSpan.innerHTML = '◂';

                    mMove.appendChild(labelSpan);
                    mMove.appendChild(arrowSpan);

                    const submenu = document.createElement('div');
                    submenu.className = 'wl-move-submenu';
                    submenu.style.cssText = `
                        display: none;
                        position: absolute;
                        right: 100%;
                        bottom: 0;
                        margin-right: 4px;
                        min-width: 170px;
                        max-width: 240px;
                        max-height: 240px;
                        overflow-y: auto;
                        overflow-x: hidden;
                        background: var(--bg-card);
                        border: 1px solid var(--border-color);
                        border-radius: 8px;
                        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.15);
                        padding: 4px 0;
                        z-index: 1000000;
                        text-align: left;
                        box-sizing: border-box;
                    `;

                    if (otherWatchlists.length === 0) {
                        const emptyItem = document.createElement('div');
                        emptyItem.className = 'wl-move-empty-item';
                        emptyItem.style.cssText = 'padding: 8px 14px; font-size: 11px; color: var(--text-secondary); font-style: italic;';
                        emptyItem.innerText = 'No other watchlists';
                        submenu.appendChild(emptyItem);
                    } else {
                        otherWatchlists.forEach(targetWl => {
                            const count = Array.isArray(watchlistsData[targetWl]) ? watchlistsData[targetWl].length : 0;
                            const targetItem = document.createElement('div');
                            targetItem.className = 'menu-item wl-move-target-item';
                            targetItem.style.cssText = `
                                padding: 8px 14px;
                                font-size: 12px;
                                font-weight: 500;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                justify-content: space-between;
                                gap: 10px;
                                box-sizing: border-box;
                                color: var(--text-primary);
                            `;

                            const targetNameSpan = document.createElement('span');
                            targetNameSpan.style.cssText = 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;';
                            targetNameSpan.title = targetWl;
                            targetNameSpan.innerText = targetWl;

                            const targetBadge = document.createElement('span');
                            targetBadge.style.cssText = 'font-size: 10px; color: var(--text-secondary); opacity: 0.8; font-weight: normal; flex-shrink: 0;';
                            targetBadge.innerText = `${count} ${count === 1 ? 'stock' : 'stocks'}`;

                            targetItem.appendChild(targetNameSpan);
                            targetItem.appendChild(targetBadge);

                            let targetTriggerTime = 0;
                            const handleTargetClick = (ev) => {
                                const now = Date.now();
                                if (now - targetTriggerTime < 350) return;
                                targetTriggerTime = now;
                                if (ev) {
                                    ev.preventDefault();
                                    ev.stopPropagation();
                                    ev.stopImmediatePropagation();
                                }
                                window._wlMenuJustClosed = true;
                                setTimeout(() => { window._wlMenuJustClosed = false; }, 400);
                                closeAllWlMenus();
                                moveWatchlistStock(activeWatchlistName, targetWl, sym);
                            };

                            targetItem.addEventListener('click', handleTargetClick);
                            targetItem.addEventListener('touchend', handleTargetClick);
                            submenu.appendChild(targetItem);
                        });
                    }

                    // Hover behavior
                    mMove.addEventListener('mouseenter', () => {
                        submenu.style.display = 'block';
                        const rect = submenu.getBoundingClientRect();
                        if (rect.left < 8) {
                            submenu.style.right = 'auto';
                            submenu.style.left = '100%';
                            submenu.style.marginRight = '0';
                            submenu.style.marginLeft = '4px';
                        } else {
                            submenu.style.right = '100%';
                            submenu.style.left = 'auto';
                            submenu.style.marginRight = '4px';
                            submenu.style.marginLeft = '0';
                        }
                        if (rect.top < 10) {
                            submenu.style.bottom = 'auto';
                            submenu.style.top = '0';
                        } else {
                            submenu.style.bottom = '0';
                            submenu.style.top = 'auto';
                        }
                    });
                    mMove.addEventListener('mouseleave', () => {
                        if (!mMove.classList.contains('active')) {
                            submenu.style.display = 'none';
                        }
                    });

                    // Mobile tap toggle
                    mMove.addEventListener('click', (ev) => {
                        if (ev.target.closest('.wl-move-target-item')) return;
                        ev.preventDefault();
                        ev.stopPropagation();
                        const isOpen = submenu.style.display === 'block';
                        if (isOpen) {
                            submenu.style.display = 'none';
                            mMove.classList.remove('active');
                        } else {
                            submenu.style.display = 'block';
                            mMove.classList.add('active');
                            const rect = submenu.getBoundingClientRect();
                            if (rect.left < 8) {
                                submenu.style.right = 'auto';
                                submenu.style.left = '100%';
                                submenu.style.marginRight = '0';
                                submenu.style.marginLeft = '4px';
                            } else {
                                submenu.style.right = '100%';
                                submenu.style.left = 'auto';
                                submenu.style.marginRight = '4px';
                                submenu.style.marginLeft = '0';
                            }
                            if (rect.top < 10) {
                                submenu.style.bottom = 'auto';
                                submenu.style.top = '0';
                            } else {
                                submenu.style.bottom = '0';
                                submenu.style.top = 'auto';
                            }
                        }
                    });

                    mMove.appendChild(submenu);
                    popover.appendChild(mMove);
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
                popover.appendChild(mBtn);
            });

            // Position popover relative to button in fixed viewport coordinates
            const btnRect = btn.getBoundingClientRect();
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

            popover.style.display = 'block';
            popover.style.position = 'fixed';
            popover.style.zIndex = '999999';

            const popoverHeight = popover.offsetHeight || 260;
            const spaceBelow = viewportHeight - btnRect.bottom;
            const spaceAbove = btnRect.top - 60; // 60px reserved for sticky header

            let desiredTop;
            if (spaceBelow >= popoverHeight) {
                desiredTop = btnRect.bottom + 4;
            } else if (spaceAbove >= popoverHeight) {
                desiredTop = btnRect.top - 4 - popoverHeight;
            } else {
                if (spaceAbove > spaceBelow) {
                    desiredTop = btnRect.top - 4 - popoverHeight;
                } else {
                    desiredTop = btnRect.bottom + 4;
                }
            }

            const clampedTop = Math.max(10, Math.min(viewportHeight - popoverHeight - 10, desiredTop));
            popover.style.top = `${clampedTop}px`;
            popover.style.bottom = 'auto';

            const rightOffset = viewportWidth - btnRect.right;
            popover.style.right = `${Math.max(8, rightOffset)}px`;
            popover.style.left = 'auto';
            popover.style.maxWidth = `${Math.min(260, viewportWidth - 16)}px`;

            const parentTr = btn.closest('tr');
            if (parentTr) parentTr.classList.add('wl-row-menu-open');
            _wlMenuOpenScrollY = window.scrollY || window.pageYOffset || 0;
        }
        window.toggleWlRowMenu = toggleWlRowMenu;

        function closeAllWlMenus() {
            let hadOpen = false;
            const popover = document.getElementById('wl-global-stock-popover');
            if (popover && popover.style.display === 'block') {
                hadOpen = true;
                popover.style.display = 'none';
                popover.dataset.sym = '';
            }
            document.querySelectorAll('[id^="wl-row-menu-"]').forEach(el => {
                if (el.style.display === 'block') {
                    hadOpen = true;
                    el.style.display = 'none';
                }
            });
            document.querySelectorAll('.wl-row-menu-open').forEach(el => el.classList.remove('wl-row-menu-open'));
            document.querySelectorAll('.wl-container-menu-open').forEach(el => el.classList.remove('wl-container-menu-open'));
            document.querySelectorAll('.wl-move-menu-item.active').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.wl-move-submenu').forEach(el => { el.style.display = 'none'; });
            if (hadOpen) {
                window._wlMenuJustClosed = true;
                setTimeout(() => { window._wlMenuJustClosed = false; }, 300);
            }
        }

        if (!window._wlRowMenuOutsideBound) {
            const handleOutside = (e) => {
                if (!e.target.closest('#wl-global-stock-popover') && !e.target.closest('.menu-dropdown-content') && !e.target.closest('.wl-row-menu-btn')) {
                    closeAllWlMenus();
                }
            };
            document.addEventListener('click', handleOutside);
            document.addEventListener('touchstart', handleOutside, { passive: true });
            window.addEventListener('scroll', () => {
                closeAllWlMenus();
            }, { passive: true });
            document.addEventListener('scroll', (e) => {
                if (e.target && e.target !== document) {
                    closeAllWlMenus();
                }
            }, { capture: true, passive: true });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    closeAllWlMenus();
                }
            });
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
                showToast(`Created watchlist "${name}"`, 'success');
                watchlistsData = data.watchlists;
                try {
                    localStorage.setItem('cd_cached_watchlists', JSON.stringify(watchlistsData));
                } catch(e) {}
                activeWatchlistName = name;
                renderWatchlists();
                refreshPrices();
            } else {
                showToast(data.error || 'Failed to create watchlist', 'error');
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
                showToast('No active watchlist selected to export!', 'warning');
                return;
            }

            const symbols = (watchlistsData[activeWatchlistName] || []).slice();
            if (symbols.length === 0) {
                showToast('The current watchlist is empty.', 'info');
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
            showToast(`Exported ${symbols.length} stocks from ${activeWatchlistName}`, 'success');
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

        // =========================================================
        // MOBILE WATCHLIST SMOOTH SWIPE ENGINE
        // Strictly active only on mobile view (window.innerWidth <= 768)
        // Rule: Swiping left-to-right or right-to-left moves between watchlists.
        // Rule: Don't do for first (left) and last (right).
        // =========================================================
        let _wlSwipeStartX = 0;
        let _wlSwipeStartY = 0;
        let _wlSwipeStartTime = 0;
        let _wlSwipeIsHorizontal = false;
        let _wlSwipeIsVertical = false;
        let _wlSwipeCard = null;
        let _isWlTransitioning = false;

        function scrollActiveWatchlistTabIntoView(name, smooth = true) {
            const targetName = name || activeWatchlistName;
            if (window.innerWidth > 768 || !targetName) return;
            requestAnimationFrame(() => {
                const selectorMount = document.getElementById('watchlist-selector-mount');
                if (!selectorMount) return;
                const buttons = Array.from(selectorMount.querySelectorAll('button'));
                const activeBtn = buttons.find(b => b.dataset.watchlistName === targetName) || selectorMount.querySelector('.pf-select-btn.active');
                if (activeBtn) {
                    const mountRect = selectorMount.getBoundingClientRect();
                    const btnRect = activeBtn.getBoundingClientRect();
                    const buffer = 16;
                    // If button is already comfortably visible, do NOT scroll or animate
                    const isVisible = (btnRect.left >= (mountRect.left + buffer) && btnRect.right <= (mountRect.right - buffer));
                    if (!isVisible) {
                        activeBtn.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'nearest', inline: 'center' });
                    }
                }
            });
        }
        window.scrollActiveWatchlistTabIntoView = scrollActiveWatchlistTabIntoView;

        function executeWatchlistSwipeTransition(direction, targetName, oldCard) {
            if (_isWlTransitioning || !targetName) return;
            _isWlTransitioning = true;

            // 1. Immediately highlight the target tab button in selector bar and smoothly center it
            const selectorMount = document.getElementById('watchlist-selector-mount');
            if (selectorMount) {
                const buttons = selectorMount.querySelectorAll('.pf-select-btn');
                buttons.forEach(b => {
                    b.classList.toggle('active', b.dataset.watchlistName === targetName);
                });
                scrollActiveWatchlistTabIntoView(targetName);
            }
            if (typeof updateMobileHeaderActiveBadge === 'function') {
                const badge = document.getElementById('mobile-active-name-badge');
                if (badge) badge.innerText = targetName;
            }

            // 2. Hardware-accelerated slide out of the current card
            const exitX = direction === 'next' ? -80 : 80;
            if (oldCard) {
                oldCard.style.willChange = 'transform, opacity';
                oldCard.style.transition = 'transform 0.16s cubic-bezier(0.4, 0, 1, 1), opacity 0.16s ease-out';
                oldCard.style.transform = `translateX(${exitX}px)`;
                oldCard.style.opacity = '0';
            }

            setTimeout(() => {
                // 3. Switch to target watchlist and re-render
                activeWatchlistName = targetName;
                renderWatchlists();

                // 4. Smooth slide-in of the new card from the incoming edge
                const newCard = document.querySelector('#watchlist-view-mount > .card-container') || document.getElementById('watchlist-view-mount');
                if (newCard) {
                    const enterStartX = direction === 'next' ? 75 : -75;
                    newCard.style.willChange = 'transform, opacity';
                    newCard.style.transition = 'none';
                    newCard.style.transform = `translateX(${enterStartX}px)`;
                    newCard.style.opacity = '0';

                    // Force browser reflow
                    void newCard.offsetWidth;

                    // Decelerate smoothly into natural position
                    newCard.style.transition = 'transform 0.24s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.24s ease-out';
                    newCard.style.transform = 'translateX(0)';
                    newCard.style.opacity = '1';
                }

                // 5. Clean up inline styles once transition completes
                setTimeout(() => {
                    if (newCard) {
                        newCard.style.transition = '';
                        newCard.style.transform = '';
                        newCard.style.opacity = '';
                        newCard.style.willChange = '';
                    }
                    _isWlTransitioning = false;
                }, 260);

                if (typeof refreshPrices === 'function') {
                    refreshPrices().catch(() => {});
                }
            }, 160);
        }

        function initWatchlistMobileSwipe() {
            if (window._wlSwipeInitialized) return;
            window._wlSwipeInitialized = true;

            document.addEventListener('touchstart', (e) => {
                // Strictly mobile view check
                if (window.innerWidth > 768) return;
                if (_isWlTransitioning) return;

                const tabWl = document.getElementById('tab-watchlists');
                if (!tabWl || !tabWl.classList.contains('active')) return;
                if (!e.touches || e.touches.length !== 1) return;

                const target = e.target;
                // Exclude touches inside open modals, off-canvas sidebar drawer, or active typing inputs
                if (document.querySelector('.modal.show, .small-modal.show, .modal[style*="display: block"]') ||
                    document.getElementById('app-sidebar')?.classList.contains('mobile-open') ||
                    target.closest('.modal, .small-modal, .sidebar-backdrop, .app-sidebar')) {
                    _wlSwipeCard = null;
                    return;
                }

                // If user is actively typing in an input/textarea, let text selection/editing proceed
                if ((target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) && document.activeElement === target) {
                    _wlSwipeCard = null;
                    return;
                }

                // Strict Rule: Horizontal swipe on watchlist tabs must ONLY scroll watchlist names, NOT switch watchlists.
                // Next/prev watchlist switching swipe ONLY applies to the content area strictly BELOW the search bar.
                const isContentBelowSearch = target.closest('.wl-table-container, .wl-table, tbody, tr.pf-row, .empty-watchlist-msg');
                const isHeaderOrControls = target.closest('.watchlist-top-card, .watchlist-selector-row, #watchlist-selector-mount, .watchlist-tabs-nav, .controls, .wl-search-row, #wl-search-input, .mobile-top-bar, .mobile-bottom-nav');
                if (!isContentBelowSearch || isHeaderOrControls) {
                    _wlSwipeCard = null;
                    return;
                }

                const t = e.touches[0];
                _wlSwipeStartX = t.clientX;
                _wlSwipeStartY = t.clientY;
                _wlSwipeStartTime = Date.now();
                _wlSwipeIsHorizontal = false;
                _wlSwipeIsVertical = false;

                _wlSwipeCard = document.querySelector('#watchlist-view-mount > .card-container') || document.querySelector('.wl-table-container') || document.getElementById('watchlist-view-mount');
            }, { passive: true });

            document.addEventListener('touchmove', (e) => {
                if (window.innerWidth > 768) return;
                if (!_wlSwipeCard || _isWlTransitioning) return;
                if (!e.touches || e.touches.length !== 1) return;

                const tabWl = document.getElementById('tab-watchlists');
                if (!tabWl || !tabWl.classList.contains('active')) return;

                const t = e.touches[0];
                const dx = t.clientX - _wlSwipeStartX;
                const dy = t.clientY - _wlSwipeStartY;

                // Determine gesture direction
                if (!_wlSwipeIsHorizontal && !_wlSwipeIsVertical) {
                    // Vertical scrolling prioritized for list rows
                    if (Math.abs(dy) > 7 && Math.abs(dy) >= Math.abs(dx)) {
                        _wlSwipeIsVertical = true;
                        return;
                    } else if (Math.abs(dx) > 9 && Math.abs(dx) > Math.abs(dy)) {
                        const names = Object.keys(watchlistsData || {});
                        const idx = names.indexOf(activeWatchlistName);

                        // Right to left swipe (dx < 0): Move to next watchlist.
                        // Rule: Don't do for last (right)
                        if (dx < 0 && (idx < 0 || idx >= names.length - 1)) {
                            _wlSwipeIsVertical = true;
                            return;
                        }
                        // Left to right swipe (dx > 0): Move to previous watchlist.
                        // Rule: Don't do for first (left)
                        if (dx > 0 && idx <= 0) {
                            _wlSwipeIsVertical = true;
                            return;
                        }

                        _wlSwipeIsHorizontal = true;
                        if (typeof closeAllWlMenus === 'function') closeAllWlMenus();
                    }
                }

                if (_wlSwipeIsHorizontal) {
                    if (e.cancelable) e.preventDefault();
                    const moveX = dx * 0.82; // Natural elastic feel
                    _wlSwipeCard.style.willChange = 'transform, opacity';
                    _wlSwipeCard.style.transition = 'none';
                    _wlSwipeCard.style.transform = `translateX(${moveX}px)`;
                    const fade = Math.max(0.65, 1 - (Math.abs(moveX) / 600));
                    _wlSwipeCard.style.opacity = String(fade);
                }
            }, { passive: false });

            const handleTouchEnd = (e) => {
                if (window.innerWidth > 768) return;
                if (!_wlSwipeCard) return;

                const card = _wlSwipeCard;
                _wlSwipeCard = null;

                if (!_wlSwipeIsHorizontal) {
                    return;
                }
                _wlSwipeIsHorizontal = false;

                const t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
                const endX = t ? t.clientX : _wlSwipeStartX;
                const dx = endX - _wlSwipeStartX;
                const elapsed = Math.max(Date.now() - _wlSwipeStartTime, 1);
                const velocity = Math.abs(dx) / elapsed;

                const names = Object.keys(watchlistsData || {});
                const idx = names.indexOf(activeWatchlistName);

                const isCommitted = Math.abs(dx) > 35 || (Math.abs(dx) > 20 && velocity > 0.28);

                // Right to left (dx < 0): Move to next watchlist
                if (isCommitted && dx < 0 && idx >= 0 && idx < names.length - 1) {
                    executeWatchlistSwipeTransition('next', names[idx + 1], card);
                }
                // Left to right (dx > 0): Move to previous watchlist
                else if (isCommitted && dx > 0 && idx > 0) {
                    executeWatchlistSwipeTransition('prev', names[idx - 1], card);
                }
                // Uncommitted or boundary: smooth spring return
                else {
                    card.style.transition = 'transform 0.22s cubic-bezier(0.175, 0.885, 0.32, 1.2), opacity 0.22s ease';
                    card.style.transform = 'translateX(0)';
                    card.style.opacity = '1';
                    setTimeout(() => {
                        if (card) {
                            card.style.transition = '';
                            card.style.transform = '';
                            card.style.opacity = '';
                            card.style.willChange = '';
                        }
                    }, 240);
                }
            };

            document.addEventListener('touchend', handleTouchEnd, { passive: true });
            document.addEventListener('touchcancel', handleTouchEnd, { passive: true });
        }
        window.initWatchlistMobileSwipe = initWatchlistMobileSwipe;

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initWatchlistMobileSwipe);
        } else {
            initWatchlistMobileSwipe();
        }

        // =========================================================
        // GLOBAL WATCHLIST ROW HOVER TOOLTIP (WEB ONLY)
        // Shows "Click to view {company name-bold} technical chart"
        // =========================================================
        (function initWlRowTooltip() {
            let wlTooltipEl = document.getElementById('wl-row-tooltip');
            if (!wlTooltipEl) {
                wlTooltipEl = document.createElement('div');
                wlTooltipEl.id = 'wl-row-tooltip';
                wlTooltipEl.className = 'wl-row-tooltip';
                document.body.appendChild(wlTooltipEl);
            }

            document.addEventListener('mouseover', (e) => {
                if (window.innerWidth <= 768) return; // Strict rule: Web only
                const symEl = e.target.closest('.stock-symbol');
                if (!symEl) return;
                const tr = symEl.closest('.wl-table tr.pf-row');
                if (!tr) return;
                const sym = tr.dataset.symbol || (tr.id ? tr.id.replace('row-', '') : '');
                const info = (typeof stockPricesData !== 'undefined' && stockPricesData[sym]) ? stockPricesData[sym] : {};
                const compName = tr.dataset.companyName || info.name || cleanDisplaySymbol(sym);
                wlTooltipEl.innerHTML = `Click to view <b>${escapeHtml(compName)}</b> technical chart`;
                wlTooltipEl.style.opacity = '1';
                wlTooltipEl.style.transform = 'translateY(0)';
            });

            document.addEventListener('mousemove', (e) => {
                if (window.innerWidth <= 768 || wlTooltipEl.style.opacity !== '1') return;
                if (!e.target.closest('.stock-symbol')) {
                    wlTooltipEl.style.opacity = '0';
                    return;
                }
                const pad = 12;
                let x = e.clientX + pad;
                let y = e.clientY + pad;
                const w = wlTooltipEl.offsetWidth || 180;
                const h = wlTooltipEl.offsetHeight || 30;
                if (x + w > window.innerWidth - 10) {
                    x = e.clientX - w - pad;
                }
                if (y + h > window.innerHeight - 10) {
                    y = e.clientY - h - pad;
                }
                wlTooltipEl.style.left = `${Math.max(10, x)}px`;
                wlTooltipEl.style.top = `${Math.max(10, y)}px`;
            });

            document.addEventListener('mouseout', (e) => {
                const symEl = e.target.closest('.stock-symbol');
                if (symEl) {
                    const related = e.relatedTarget;
                    if (!related || !related.closest || related.closest('.stock-symbol') !== symEl) {
                        wlTooltipEl.style.opacity = '0';
                        wlTooltipEl.style.transform = 'translateY(4px)';
                    }
                }
            });
        })();

