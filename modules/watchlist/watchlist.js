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


        // =========================================================
        // WATCHLIST REFRESH BUTTON SPIN CONTROLLER
        // Spins refresh button during any watchlist API call until finished
        // =========================================================
        window._wlActiveApiCount = window._wlActiveApiCount || 0;
        window._isWlRefreshing = false;

        function startWatchlistSpin() {
            window._wlActiveApiCount = (window._wlActiveApiCount || 0) + 1;
            window._isWlRefreshing = true;
            updateWatchlistRefreshButtonsState(true);
        }

        function stopWatchlistSpin() {
            window._wlActiveApiCount = Math.max(0, (window._wlActiveApiCount || 1) - 1);
            if (window._wlActiveApiCount === 0) {
                window._isWlRefreshing = false;
                updateWatchlistRefreshButtonsState(false);
            }
        }

        function updateWatchlistRefreshButtonsState(isSpinning) {
            const btns = document.querySelectorAll('.wl-refresh-btn, .wl-mobile-refresh-btn');
            btns.forEach(b => {
                const svg = b.querySelector('svg');
                if (isSpinning) {
                    b.classList.add('refreshing');
                    b.classList.remove('spinning'); // Outer button box strictly never rotates
                    b.setAttribute('aria-busy', 'true');
                    b.title = 'Updating watchlist quotes...';
                    if (svg) svg.classList.add('spinning');
                } else {
                    b.classList.remove('refreshing', 'spinning');
                    b.removeAttribute('aria-busy');
                    b.title = 'Refresh Watchlist Quotes';
                    if (svg) svg.classList.remove('spinning');
                }
            });

            // Strictly do NOT spin overall sidebar/header refresh icon in watchlist refresh
            // Sidebar icon remains untouched

            // Keep watchlist appearance completely normal during refresh (no fading or color alteration)
            const tableContainers = document.querySelectorAll('.wl-table-container, #watchlist-view-mount .wl-table-container, #watchlist-view-mount table, #watchlist-table-mount table, .watchlist-container table');
            tableContainers.forEach(container => {
                container.classList.remove('faded');
                container.style.opacity = '';
                container.style.pointerEvents = '';
                container.style.transition = '';
            });
        }

        window.startWatchlistSpin = startWatchlistSpin;
        window.stopWatchlistSpin = stopWatchlistSpin;
        window.updateWatchlistRefreshButtonsState = updateWatchlistRefreshButtonsState;

        async function fetchWatchlists() {
            startWatchlistSpin();
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
                    }).finally(() => {
                        stopWatchlistSpin();
                    });
                } else {
                    stopWatchlistSpin();
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
            if (!isSame) {
                selectedWatchlistStocks.clear();
            }
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
            
            startWatchlistSpin();
            try {
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
                    if (typeof refreshPrices === 'function') await refreshPrices();
                } else {
                    if (typeof showToast === 'function') {
                        showToast(data.error || 'Failed to create watchlist', 'error');
                    } else {
                        alert(data.error || 'Failed to create watchlist');
                    }
                }
            } catch (err) {
                console.error('Error creating watchlist:', err);
            } finally {
                stopWatchlistSpin();
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

            startWatchlistSpin();
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
                    if (typeof refreshPrices === 'function') await refreshPrices();
                } else {
                    showToast(data.error || 'Failed to delete watchlist', 'error');
                }
            } catch (err) {
                console.error('Delete watchlist error:', err);
                showToast('Error deleting watchlist. Please check network connection.', 'error');
            } finally {
                stopWatchlistSpin();
            }
        }
        window.deleteActiveWatchlist = deleteActiveWatchlist;

        async function addWatchlistStock(watchlistName, symbolInputValue = null) {
            const targetName = watchlistName || activeWatchlistName;
            if (!targetName) return;
            const input = document.getElementById('wl-search-input');
            const symbol = symbolInputValue || (input ? input.value.trim() : "");
            if (!symbol) return;
            
            startWatchlistSpin();
            try {
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
                    if (typeof refreshPrices === 'function') await refreshPrices();
                } else {
                    showToast(data.error || 'Failed to add stock', 'error');
                }
            } catch (err) {
                console.error('Error adding stock:', err);
                showToast('Failed to add stock.', 'error');
            } finally {
                stopWatchlistSpin();
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

            startWatchlistSpin();
            try {
                const res = await fetch(`/api/watchlists/${encodeURIComponent(targetName)}/stocks/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    showToast(`Removed ${cleanDisplaySymbol(symbol)} from ${targetName}`, 'info');
                    watchlistsData = data.watchlists;
                    renderWatchlists();
                    if (typeof refreshPrices === 'function') await refreshPrices();
                } else {
                    showToast(data.error || 'Failed to remove stock', 'error');
                }
            } catch (err) {
                console.error('Remove stock error:', err);
                showToast('Failed to remove stock. Please check network connection.', 'error');
            } finally {
                stopWatchlistSpin();
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

        async function syncStockWatchlists(symbol, targetWatchlists, addedCount = 0, removedCount = 0) {
            if (!symbol || !Array.isArray(targetWatchlists)) return;
            startWatchlistSpin();
            try {
                const res = await fetch('/api/watchlists/sync-stock-watchlists', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        symbol: symbol,
                        watchlists: targetWatchlists
                    })
                });
                const data = await res.json();
                if (data.success) {
                    watchlistsData = data.watchlists;
                    try {
                        localStorage.setItem('cd_cached_watchlists', JSON.stringify(watchlistsData));
                    } catch(e) {}

                    let msg = `Updated watchlists for ${cleanDisplaySymbol(symbol)}`;
                    if (data.added_to && data.added_to.length > 0 && (!data.removed_from || data.removed_from.length === 0)) {
                        msg = `Added ${cleanDisplaySymbol(symbol)} to "${data.added_to.join(', ')}"`;
                    } else if (data.removed_from && data.removed_from.length > 0 && (!data.added_to || data.added_to.length === 0)) {
                        msg = `Removed ${cleanDisplaySymbol(symbol)} from "${data.removed_from.join(', ')}"`;
                    }
                    showToast(msg, 'success');

                    if (data.errors && data.errors.length > 0) {
                        showToast(data.errors.join('; '), 'warning');
                    }

                    renderWatchlists();
                    if (typeof refreshPrices === 'function') await refreshPrices();
                } else {
                    showToast(data.error || 'Failed to update watchlists', 'error');
                }
            } catch (err) {
                console.error('Error syncing stock watchlists:', err);
                showToast('Failed to update watchlists. Please check network connection.', 'error');
            } finally {
                stopWatchlistSpin();
            }
        }
        window.syncStockWatchlists = syncStockWatchlists;


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
            startWatchlistSpin();
            const minSpinTime = new Promise(resolve => setTimeout(resolve, 500));
            try {
                if (typeof refreshPrices === 'function') {
                    await Promise.allSettled([
                        refreshPrices({ force_refresh: true }),
                        minSpinTime
                    ]);
                } else {
                    await minSpinTime;
                }
            } catch (err) {
                console.warn('Watchlist refresh error:', err);
            } finally {
                stopWatchlistSpin();
            }
        }
        window.triggerWatchlistRefresh = triggerWatchlistRefresh;

        // =========================================================
        // WATCHLIST TRADINGVIEW POPUP WINDOW & SYNC CONTROLLER
        // =========================================================
        let _tvAppWindow = null;
        let _tvBroadcastChannel = null;
        try {
            if ('BroadcastChannel' in window) {
                _tvBroadcastChannel = new BroadcastChannel('capital_desk_tv_sync');
            }
        } catch(_) {}

        function formatTradingViewSymbol(sym) {
            if (!sym) return 'NSE:NIFTY';
            let s = String(sym).trim();
            const upper = s.toUpperCase();
            if (upper === '^NSEI' || upper === 'NIFTY' || upper === 'NIFTY 50' || upper === 'NIFTY50') return 'NSE:NIFTY';
            if (upper === '^NSEBANK' || upper === '^BANKNIFTY' || upper === 'BANKNIFTY' || upper === 'NIFTY BANK') return 'NSE:BANKNIFTY';
            if (upper === '^CNXIT' || upper === 'NIFTY IT') return 'NSE:NIFTYIT';
            if (upper === '^IXIC' || upper === 'NASDAQ' || upper === 'NASDAQ COMPOSITE') return 'NASDAQ:IXIC';
            if (upper === '^GSPC' || upper === 'S&P 500' || upper === 'SP500') return 'SP:SPX';
            if (upper === '^DJI' || upper === 'DOW JONES' || upper === 'DJI') return 'DJ:DJI';
            if (upper === '^BSESN' || upper === 'SENSEX' || upper === 'BSE SENSEX') return 'BSE:SENSEX';
            
            // Check BSE suffix
            if (s.endsWith('.BO') || s.endsWith('.BS') || s.endsWith('.BSE') || s.startsWith('BSE:')) {
                const clean = s.replace(/^(BSE:)/i, '').replace(/\.(BO|BS|BSE)$/i, '');
                return 'BSE:' + clean;
            }
            
            // Default to NSE for Indian stocks
            const clean = s.replace(/^(NSE:)/i, '').replace(/\.(NS|NSE)$/i, '');
            return 'NSE:' + clean;
        }

        function openTradingViewAppWindow(sym) {
            const tvSym = formatTradingViewSymbol(sym);
            const clean = (typeof cleanDisplaySymbol === 'function') ? cleanDisplaySymbol(sym) : sym;
            
            // App Popup Window sizing & positioning
            const screenW = window.screen.availWidth || 1920;
            const screenH = window.screen.availHeight || 1080;
            
            const width = Math.min(1300, Math.max(900, Math.floor(screenW * 0.65)));
            const height = Math.min(920, Math.max(650, Math.floor(screenH * 0.88)));
            
            const left = Math.max(0, screenW - width - 20);
            const top = Math.max(0, Math.floor((screenH - height) / 2));
            
            const windowFeatures = [
                `width=${width}`,
                `height=${height}`,
                `left=${left}`,
                `top=${top}`,
                'menubar=no',
                'toolbar=no',
                'location=no',
                'status=no',
                'directories=no',
                'scrollbars=yes',
                'resizable=yes'
            ].join(',');

            if (typeof showToast === 'function') {
                showToast(`Syncing ${clean} to TradingView Window...`, 'info', 1800);
            }

            // 1. Broadcast to channel (all open TV windows instantly switch symbol)
            if (_tvBroadcastChannel) {
                try {
                    _tvBroadcastChannel.postMessage({ type: 'LOAD_SYMBOL', symbol: tvSym });
                } catch(_) {}
            }

            // 1. If already opened, close older window and open new (per user instruction: close older and open new)
            if (_tvAppWindow) {
                try {
                    _tvAppWindow.close();
                } catch(_) {}
                _tvAppWindow = null;
            }

            // 2. Open full TradingView site directly in dedicated window (NOT iframe)
            const tvUrl = `https://in.tradingview.com/chart/?symbol=${encodeURIComponent(tvSym)}`;
            try {
                _tvAppWindow = window.open(tvUrl, 'CapitalDesk_TV_Window', windowFeatures);
            } catch(err) {
                console.warn('Popup blocked, falling back to window.open:', err);
                _tvAppWindow = window.open(tvUrl, 'CapitalDesk_TV_Window');
            }

            if (_tvAppWindow) {
                try {
                    _tvAppWindow.focus();
                } catch(_) {}
            }
        }

        function handleWatchlistStockClick(sym) {
            const chartMode = localStorage.getItem('capital_desk_watchlist_chart_mode') || 'native';
            if (chartMode === 'tradingview') {
                openTradingViewAppWindow(sym);
            } else {
                if (typeof openInHouseChart === 'function') openInHouseChart(sym);
                else if (typeof window.openInHouseChart === 'function') window.openInHouseChart(sym);
            }
        }
        window.openTradingViewAppWindow = openTradingViewAppWindow;
        window.addEventListener('beforeunload', () => {
            if (_tvAppWindow && !_tvAppWindow.closed) {
                try { _tvAppWindow.close(); } catch (_) {}
            }
        });
        window.handleWatchlistStockClick = handleWatchlistStockClick;
        window.formatTradingViewSymbol = formatTradingViewSymbol;

        let selectedWatchlistStocks = new Set();

        function toggleWatchlistStocksDropdown(event) {
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }
            const menu = document.getElementById('wl-stocks-dropdown-menu');
            const btn = document.getElementById('wl-stocks-dropdown-btn');
            if (!menu) return;
            const isShown = menu.style.display !== 'none';
            let backdrop = document.getElementById('wl-stocks-dropdown-backdrop');

            if (isShown) {
                menu.style.display = 'none';
                if (btn) btn.classList.remove('open');
                if (backdrop) backdrop.style.display = 'none';
            } else {
                menu.style.display = 'flex';
                if (btn) btn.classList.add('open');

                if (window.innerWidth <= 768) {
                    if (!backdrop) {
                        backdrop = document.createElement('div');
                        backdrop.id = 'wl-stocks-dropdown-backdrop';
                        backdrop.className = 'wl-stocks-dropdown-backdrop';
                        backdrop.onclick = (e) => toggleWatchlistStocksDropdown(e);
                        document.body.appendChild(backdrop);
                    }
                    backdrop.style.display = 'block';
                }

                const searchInput = document.getElementById('wl-stocks-search-input');
                if (searchInput) {
                    searchInput.value = '';
                    filterStocksDropdownList('');
                    if (window.innerWidth > 768) {
                        setTimeout(() => searchInput.focus(), 50);
                    }
                }
            }
        }
        window.toggleWatchlistStocksDropdown = toggleWatchlistStocksDropdown;

        function filterStocksDropdownList(query) {
            const q = (query || '').trim().toLowerCase();
            const items = document.querySelectorAll('.wl-stock-menu-item');
            items.forEach(it => {
                const sym = (it.dataset.symbol || '').toLowerCase();
                const name = (it.dataset.companyName || '').toLowerCase();
                const matches = !q || sym.includes(q) || name.includes(q);
                it.style.display = matches ? 'flex' : 'none';
            });
        }
        window.filterStocksDropdownList = filterStocksDropdownList;

        function onWatchlistStockCheckboxChange(chk, event) {
            if (event) event.stopPropagation();
            const sym = chk.value;
            const rawList = watchlistsData[activeWatchlistName] || [];
            
            // If currently showing all (empty set), initialize with all stocks before unchecking
            if (selectedWatchlistStocks.size === 0) {
                rawList.forEach(s => selectedWatchlistStocks.add(s));
            }

            if (chk.checked) {
                selectedWatchlistStocks.add(sym);
            } else {
                selectedWatchlistStocks.delete(sym);
            }

            // If all stocks ended up checked, reset to empty set (clean default = show all)
            if (selectedWatchlistStocks.size === rawList.length) {
                selectedWatchlistStocks.clear();
            }

            applyWatchlistStockFilter();
        }
        window.onWatchlistStockCheckboxChange = onWatchlistStockCheckboxChange;

        function selectAllWatchlistStocks(event) {
            if (event) event.stopPropagation();
            selectedWatchlistStocks.clear();
            const checkboxes = document.querySelectorAll('.wl-stock-checkbox');
            checkboxes.forEach(chk => { chk.checked = true; });
            applyWatchlistStockFilter();
        }
        window.selectAllWatchlistStocks = selectAllWatchlistStocks;

        function clearAllWatchlistStocks(event) {
            if (event) event.stopPropagation();
            selectedWatchlistStocks.clear();
            const checkboxes = document.querySelectorAll('.wl-stock-checkbox');
            checkboxes.forEach(chk => { chk.checked = true; });
            applyWatchlistStockFilter();
        }
        window.clearAllWatchlistStocks = clearAllWatchlistStocks;

        function applyWatchlistStockFilter() {
            const rawList = watchlistsData[activeWatchlistName] || [];
            const totalCount = rawList.length;
            const isFiltered = (selectedWatchlistStocks.size > 0) && (selectedWatchlistStocks.size < totalCount);

            const rows = document.querySelectorAll('.wl-table tbody tr.pf-row');
            let visibleCount = 0;

            rows.forEach(r => {
                const sym = r.dataset.symbol || (r.id ? r.id.replace('row-', '') : '');
                const isVisible = !isFiltered || selectedWatchlistStocks.has(sym);
                r.style.display = isVisible ? '' : 'none';
                if (isVisible) visibleCount++;
            });

            // Handle no match state
            let noMatchRow = document.getElementById('wl-filter-no-match-row');
            if (visibleCount === 0 && totalCount > 0) {
                const tbody = document.querySelector('.wl-table tbody');
                if (tbody) {
                    if (!noMatchRow) {
                        noMatchRow = document.createElement('tr');
                        noMatchRow.id = 'wl-filter-no-match-row';
                        tbody.appendChild(noMatchRow);
                    }
                    noMatchRow.style.display = '';
                    noMatchRow.innerHTML = `<td colspan="5" style="text-align:center; padding:28px 16px; color:var(--text-secondary); font-size:13px;">
                        No stocks selected in filter. <button type="button" class="btn-secondary" style="padding:3px 8px; font-size:11px; margin-left:6px;" onclick="selectAllWatchlistStocks(event)">Select All</button>
                    </td>`;
                }
            } else if (noMatchRow) {
                noMatchRow.style.display = 'none';
            }

            // Update Dropdown button text
            const btnText = document.getElementById('wl-stocks-btn-text');
            if (btnText) {
                if (isFiltered) {
                    btnText.textContent = `Stocks (${selectedWatchlistStocks.size} of ${totalCount})`;
                } else {
                    btnText.textContent = `All Stocks (${totalCount})`;
                }
            }

        }
        window.applyWatchlistStockFilter = applyWatchlistStockFilter;

        function setWatchlistChartMode(mode, event) {
            if (event) {
                event.stopPropagation();
                if (typeof closeActionOverflow === 'function') closeActionOverflow(event);
            }
            localStorage.setItem('capital_desk_watchlist_chart_mode', mode);
            if (typeof showToast === 'function') {
                if (mode === 'tradingview') {
                    showToast('Tradingview chart active: Clicking any stock opens/syncs TradingView App Popup', 'info', 2800);
                } else {
                    showToast('Native chart active: Clicking any stock opens Capital Desk in-house chart', 'info', 2000);
                }
            }
            const rows = document.querySelectorAll('.wl-table tr.pf-row');
            rows.forEach(r => {
                if (window.innerWidth <= 768) {
                    r.title = mode === 'tradingview' ? 'Click row to sync TradingView chart' : 'Click row to view interactive technical chart';
                }
            });
            renderWatchlists();
        }
        window.setWatchlistChartMode = setWatchlistChartMode;

        function toggleWlMobileChartMode() {
            const currentMode = localStorage.getItem('capital_desk_watchlist_chart_mode') || 'native';
            const nextMode = currentMode === 'native' ? 'tradingview' : 'native';
            setWatchlistChartMode(nextMode);
        }
        window.toggleWlMobileChartMode = toggleWlMobileChartMode;

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
                        if (typeof updateWatchlistScrollArrows === 'function') {
                            requestAnimationFrame(updateWatchlistScrollArrows);
                        }
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
                if (typeof initWatchlistScrollArrows === 'function') {
                    initWatchlistScrollArrows();
                }
                if (typeof updateWatchlistScrollArrows === 'function') {
                    requestAnimationFrame(updateWatchlistScrollArrows);
                    setTimeout(updateWatchlistScrollArrows, 80);
                }
            }

            // 2. Render Active Watchlist View
            const viewMount = document.getElementById('watchlist-view-mount');
            if (!viewMount) return;

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

            // Check if existing controls and search input are already present for this active watchlist
            const existingCard = viewMount.querySelector('.card-container');
            const existingControls = existingCard ? existingCard.querySelector('.controls') : null;
            const existingInput = document.getElementById('wl-search-input');
            const existingTableContainer = existingCard ? existingCard.querySelector('.wl-table-container') : null;

            const canKeepControls = !!(existingCard && existingControls && existingInput && (existingInput.getAttribute('data-wl-name') === activeWatchlistName));

            function createWatchlistControls() {
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
                input.placeholder = '➕ Add stock to watchlist (e.g. Tata, Reliance)...';
                input.onkeydown = (e) => {
                    const dropdown = input.nextElementSibling;
                    const isOpen = dropdown && dropdown.style.display === 'block';
                    const items = dropdown ? dropdown.querySelectorAll('.autocomplete-item') : [];

                    if (e.key === 'ArrowDown') {
                        if (isOpen && items.length > 0) {
                            e.preventDefault();
                            const currIdx = (dropdown._selectedIndex !== undefined ? dropdown._selectedIndex : -1);
                            const nextIdx = (currIdx + 1) >= items.length ? 0 : currIdx + 1;
                            updateAutocompleteSelection(dropdown, nextIdx);
                        }
                        return;
                    }

                    if (e.key === 'ArrowUp') {
                        if (isOpen && items.length > 0) {
                            e.preventDefault();
                            const currIdx = (dropdown._selectedIndex !== undefined ? dropdown._selectedIndex : -1);
                            const prevIdx = currIdx <= 0 ? items.length - 1 : currIdx - 1;
                            updateAutocompleteSelection(dropdown, prevIdx);
                        }
                        return;
                    }

                    if (e.key === 'Escape') {
                        if (isOpen) {
                            e.preventDefault();
                            dropdown.style.display = 'none';
                            dropdown._selectedIndex = -1;
                        }
                        return;
                    }

                    if (e.key === 'Enter') {
                        e.preventDefault();
                        if (isOpen && items.length > 0) {
                            const selIdx = dropdown._selectedIndex;
                            if (selIdx >= 0 && items[selIdx]) {
                                items[selIdx].click();
                                return;
                            } else if (items.length > 0) {
                                items[0].click();
                                return;
                            }
                        }
                        const val = input.value.trim();
                        if (val) addWatchlistStock(activeWatchlistName, val);
                    }
                };
                input.onkeyup = (e) => {
                    if (!['Enter', 'ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) {
                        handleSearchInput('wl', input, e);
                    }
                };
                input.oninput = (e) => {
                    handleSearchInput('wl', input, e);
                };
                input.autocomplete = 'off';

                const dropdown = document.createElement('div');
                dropdown.className = 'autocomplete-dropdown';

                wrapper.appendChild(input);
                wrapper.appendChild(dropdown);
                searchRow.appendChild(wrapper);

                // Multi-Select Stocks Filter Dropdown (View all names & filter by checkbox)
                const stocksDropdownWrapper = document.createElement('div');
                stocksDropdownWrapper.className = 'wl-stocks-dropdown-wrapper';
                stocksDropdownWrapper.id = 'wl-stocks-dropdown-wrapper';

                const totalWlCount = symbols.length;
                const isFilteredNow = (selectedWatchlistStocks.size > 0) && (selectedWatchlistStocks.size < totalWlCount);
                const btnLabel = isFilteredNow ? `Stocks (${selectedWatchlistStocks.size} of ${totalWlCount})` : `All Stocks (${totalWlCount})`;

                let stockItemsHtml = '';
                symbols.forEach(sym => {
                    const bInfo = getSymbolBadge(sym);
                    const info = stockPricesData[sym] || {};
                    const compName = (info && info.name) ? info.name : cleanDisplaySymbol(sym);
                    const isChecked = (selectedWatchlistStocks.size === 0) || selectedWatchlistStocks.has(sym);
                    stockItemsHtml += `
                        <label class="wl-stock-menu-item" data-symbol="${escapeHtml(sym)}" data-company-name="${escapeHtml(compName)}">
                            <input type="checkbox" class="wl-stock-checkbox" value="${escapeHtml(sym)}" ${isChecked ? 'checked' : ''} onchange="onWatchlistStockCheckboxChange(this, event)">
                            <div class="wl-stock-item-info">
                                <div class="wl-stock-item-top">
                                    <span class="wl-stock-item-sym">${cleanDisplaySymbol(sym)}</span>
                                    <span class="badge ${bInfo.class}">${bInfo.label}</span>
                                </div>
                                <div class="wl-stock-item-name">${escapeHtml(compName)}</div>
                            </div>
                        </label>
                    `;
                });

                stocksDropdownWrapper.innerHTML = `
                    <button type="button" class="wl-stocks-dropdown-btn" id="wl-stocks-dropdown-btn" onclick="toggleWatchlistStocksDropdown(event)" title="View all stock names & multi-select filter">
                        <span class="wl-stocks-btn-icon">📋</span>
                        <span class="wl-stocks-btn-text" id="wl-stocks-btn-text">${btnLabel}</span>
                        <span class="wl-stocks-btn-arrow">▾</span>
                    </button>
                    <div class="wl-stocks-dropdown-menu" id="wl-stocks-dropdown-menu" style="display: none;">
                        <div class="wl-stocks-sheet-handle"></div>
                        <div class="wl-stocks-menu-header">
                            <span class="wl-stocks-menu-title">${escapeHtml(activeWatchlistName)} Stocks</span>
                            <div class="wl-stocks-menu-actions">
                                <button type="button" class="wl-stocks-action-btn" onclick="selectAllWatchlistStocks(event)">Select All</button>
                                <span class="wl-stocks-sep">|</span>
                                <button type="button" class="wl-stocks-action-btn" onclick="clearAllWatchlistStocks(event)">Reset</button>
                                <button type="button" class="wl-stocks-close-btn" onclick="toggleWatchlistStocksDropdown(event)" aria-label="Close" title="Close">&times;</button>
                            </div>
                        </div>
                        <div class="wl-stocks-search-box">
                            <input type="text" id="wl-stocks-search-input" class="wl-stocks-search-input" placeholder="Find stock name..." oninput="filterStocksDropdownList(this.value)" autocomplete="off">
                        </div>
                        <div class="wl-stocks-menu-list" id="wl-stocks-menu-list">
                            ${stockItemsHtml || '<div style="padding:15px; text-align:center; color:var(--text-secondary); font-size:12px;">No stocks in this watchlist</div>'}
                        </div>
                        <div class="wl-stocks-done-row">
                            <button type="button" class="wl-stocks-done-btn" onclick="toggleWatchlistStocksDropdown(event)">Done</button>
                        </div>
                    </div>
                `;

                searchRow.appendChild(stocksDropdownWrapper);

                // Mobile Refresh Button (glassy button matching portfolio style)
                const mobRefreshBtn = document.createElement('button');
                mobRefreshBtn.type = 'button';
                mobRefreshBtn.className = 'wl-refresh-btn wl-mobile-refresh-btn';
                const isMobSpinning = window._isWlRefreshing || (window._wlActiveApiCount && window._wlActiveApiCount > 0);
                if (isMobSpinning) {
                    mobRefreshBtn.classList.add('refreshing');
                    mobRefreshBtn.setAttribute('aria-busy', 'true');
                }
                mobRefreshBtn.title = 'Refresh Watchlist Quotes';
                mobRefreshBtn.setAttribute('aria-label', 'Refresh Quotes');
                mobRefreshBtn.innerHTML = `
                    <svg class="${isMobSpinning ? 'spinning' : ''}" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
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

                // Watchlist Refresh Button (matching responsive portfolio style)
                const wlRefreshBtn = document.createElement('button');
                wlRefreshBtn.type = 'button';
                wlRefreshBtn.className = 'wl-refresh-btn wl-desktop-refresh-btn';
                const isWebSpinning = window._isWlRefreshing || (window._wlActiveApiCount && window._wlActiveApiCount > 0);
                if (isWebSpinning) {
                    wlRefreshBtn.classList.add('refreshing');
                    wlRefreshBtn.setAttribute('aria-busy', 'true');
                }
                wlRefreshBtn.title = 'Refresh Watchlist Quotes';
                wlRefreshBtn.setAttribute('aria-label', 'Refresh Quotes');
                wlRefreshBtn.innerHTML = `
                    <svg class="${isWebSpinning ? 'spinning' : ''}" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                    </svg>
                `;
                wlRefreshBtn.onclick = () => triggerWatchlistRefresh(wlRefreshBtn);
                watchlistFileControls.appendChild(wlRefreshBtn);

                const savedChartMode = localStorage.getItem('capital_desk_watchlist_chart_mode') || 'native';
                const watchlistOverflow = document.createElement('div');
                watchlistOverflow.className = 'wl-overflow';
                watchlistOverflow.id = 'watchlist-overflow-menu';
                watchlistOverflow.innerHTML = `
                    <button type="button" class="wl-overflow-trigger" aria-label="More watchlist actions" title="More actions" onclick="toggleActionOverflow(event, 'watchlist-overflow-menu')">⋮</button>
                    <div class="wl-overflow-menu" role="menu">
                        <div class="wl-menu-section-title">Chart Engine</div>
                        <button type="button" role="menuitem" onclick="setWatchlistChartMode('native', event)">
                            <span>📊 Native chart</span>
                            ${savedChartMode === 'native' ? '<span style="margin-left:auto; color:#10b981; font-weight:700;">✓</span>' : ''}
                        </button>
                        <button type="button" role="menuitem" onclick="setWatchlistChartMode('tradingview', event)">
                            <span>📈 Tradingview chart</span>
                            ${savedChartMode === 'tradingview' ? '<span style="margin-left:auto; color:#10b981; font-weight:700;">✓</span>' : ''}
                        </button>
                        <div class="wl-overflow-divider"></div>
                        <button type="button" role="menuitem" onclick="openWatchlistOfficialFeeds('${escapeHtml(activeWatchlistName)}'); closeActionOverflow(event)">
                            <span>◉ Official Feeds</span>
                        </button>
                        <div class="wl-overflow-divider"></div>
                        <button type="button" role="menuitem" onclick="exportActiveWatchlistToTxt(); closeActionOverflow(event)">⇩ Export Watchlist</button>
                        <button type="button" role="menuitem" onclick="openWatchlistTxtImportModal(); closeActionOverflow(event)">⇧ Import Watchlist</button>
                        <div class="wl-overflow-divider"></div>
                        <button type="button" class="danger" role="menuitem" onclick="deleteActiveWatchlist(); closeActionOverflow(event)">Delete Watchlist</button>
                    </div>`;
                watchlistFileControls.appendChild(watchlistOverflow);
                controlsDiv.appendChild(watchlistFileControls);

                return { controlsDiv, input };
            }

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
                    tr.dataset.changePct = (hasData && info.change_pct !== undefined) ? String(info.change_pct) : '0';
                    const currentMode = localStorage.getItem('capital_desk_watchlist_chart_mode') || 'native';
                    if (window.innerWidth <= 768) {
                        tr.title = currentMode === 'tradingview' ? 'Click row to sync TradingView chart' : 'Click row to view interactive technical chart';
                    }
                    tr.onclick = (e) => {
                        if (e.target.closest('.wl-row-menu-btn') || e.target.closest('.menu-dropdown-content') || e.target.closest('button')) return;
                        if (window._wlMenuJustClosed) return;
                        handleWatchlistStockClick(sym);
                    };
                    const isIndex = (bInfo && bInfo.label === 'INDEX') || String(sym).startsWith('^') || sym === 'GIFTNIFTY';
                    const displaySym = cleanDisplaySymbol(sym);

                    let nameHtml = '';
                    if (hasData && info.name) {
                        if (isIndex && info.name.trim().toLowerCase() === displaySym.trim().toLowerCase()) {
                            nameHtml = escapeHtml(sym.startsWith('^') ? `${info.name} Index` : info.name);
                        } else {
                            nameHtml = escapeHtml(info.name);
                        }
                    } else if (isIndex) {
                        nameHtml = escapeHtml(sym);
                    } else {
                        nameHtml = '<span class="skeleton-box" style="width: 100px; height: 11px;"></span>';
                    }

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
                    tdSymbol.innerHTML = `<div class="stock-symbol-row"><span class="stock-symbol" id="sym-${sym}">${escapeHtml(displaySym)}</span><span class="badge ${bInfo.class}">${bInfo.label}</span></div><div class="company-name" id="name-${sym}">${nameHtml}</div>`;

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
                    menuBtn.title = `Actions for ${cleanDisplaySymbol(sym)}`;
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

            if (canKeepControls) {
                // Update dropdown list items if symbols changed
                const menuList = existingControls.querySelector('#wl-stocks-menu-list');
                if (menuList) {
                    let updatedItemsHtml = '';
                    symbols.forEach(sym => {
                        const bInfo = getSymbolBadge(sym);
                        const info = stockPricesData[sym] || {};
                        const compName = (info && info.name) ? info.name : cleanDisplaySymbol(sym);
                        const isChecked = (selectedWatchlistStocks.size === 0) || selectedWatchlistStocks.has(sym);
                        updatedItemsHtml += `
                            <label class="wl-stock-menu-item" data-symbol="${escapeHtml(sym)}" data-company-name="${escapeHtml(compName)}">
                                <input type="checkbox" class="wl-stock-checkbox" value="${escapeHtml(sym)}" ${isChecked ? 'checked' : ''} onchange="onWatchlistStockCheckboxChange(this, event)">
                                <div class="wl-stock-item-info">
                                    <div class="wl-stock-item-top">
                                        <span class="wl-stock-item-sym">${cleanDisplaySymbol(sym)}</span>
                                        <span class="badge ${bInfo.class}">${bInfo.label}</span>
                                    </div>
                                    <div class="wl-stock-item-name">${escapeHtml(compName)}</div>
                                </div>
                            </label>
                        `;
                    });
                    menuList.innerHTML = updatedItemsHtml || '<div style="padding:15px; text-align:center; color:var(--text-secondary); font-size:12px;">No stocks in this watchlist</div>';
                }
                // Update spinner state if refreshing
                const isSpinning = window._isWlRefreshing || (window._wlActiveApiCount && window._wlActiveApiCount > 0);
                const mobBtn = existingControls.querySelector('.wl-mobile-refresh-btn');
                if (mobBtn) {
                    mobBtn.classList.toggle('refreshing', isSpinning);
                    mobBtn.setAttribute('aria-busy', isSpinning ? 'true' : 'false');
                    const svg = mobBtn.querySelector('svg');
                    if (svg) svg.classList.toggle('spinning', isSpinning);
                }
                const deskBtn = existingControls.querySelector('.wl-desktop-refresh-btn') || existingControls.querySelector('.wl-refresh-btn:not(.wl-mobile-refresh-btn)');
                if (deskBtn) {
                    deskBtn.classList.toggle('refreshing', isSpinning);
                    deskBtn.setAttribute('aria-busy', isSpinning ? 'true' : 'false');
                    const svg = deskBtn.querySelector('svg');
                    if (svg) svg.classList.toggle('spinning', isSpinning);
                }

                // Seamlessly swap only the table container so active search typing, entered text, and focus are never lost
                if (existingTableContainer) {
                    existingCard.replaceChild(scrollContainer, existingTableContainer);
                } else {
                    existingCard.appendChild(scrollContainer);
                }
                applyWatchlistStockFilter();
            } else {
                // Full render for initial load or switching active watchlist
                let preservedValue = '';
                let preservedFocus = false;
                let preservedSelStart = 0;
                let preservedSelEnd = 0;
                if (existingInput && existingInput.getAttribute('data-wl-name') === activeWatchlistName) {
                    preservedValue = existingInput.value;
                    preservedFocus = (document.activeElement === existingInput);
                    try {
                        preservedSelStart = existingInput.selectionStart;
                        preservedSelEnd = existingInput.selectionEnd;
                    } catch (_) {}
                }

                viewMount.innerHTML = '';
                const { controlsDiv, input } = createWatchlistControls();
                const div = document.createElement('div');
                div.className = 'card-container';
                div.appendChild(controlsDiv);
                div.appendChild(scrollContainer);
                viewMount.appendChild(div);
                applyWatchlistStockFilter();

                if (preservedValue && input) {
                    input.value = preservedValue;
                    if (preservedFocus) {
                        input.focus();
                        try { input.setSelectionRange(preservedSelStart, preservedSelEnd); } catch(_) {}
                    }
                }
            }

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
                // modal closes ONLY via Escape or close button
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
                        <!-- 0. Chart Engine Mode (Mobile) -->
                        <div class="wl-sheet-item" onclick="closeWlMobileMenuModal(); toggleWlMobileChartMode();">
                            <div class="wl-sheet-item-left">
                                <span class="wl-sheet-icon">📊</span>
                                <div>
                                    <div class="wl-sheet-title">Chart: ${localStorage.getItem('capital_desk_watchlist_chart_mode') === 'tradingview' ? 'Tradingview Chart' : 'Native Chart'}</div>
                                    <div class="wl-sheet-sub">Tap to switch chart modal engine</div>
                                </div>
                            </div>
                            <span class="wl-sheet-chevron">⇄</span>
                        </div>

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

        function toggleWlRowMenu(e, sym, options = {}) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const btn = e ? (e.currentTarget || (e.target && e.target.closest ? (e.target.closest('button') || e.target.closest('.pf-col-details') || e.target.closest('.wl-col-actions') || e.target.closest('td')) : null)) : null;
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
                    handleWatchlistStockClick(sym);
                }},
                { label: '📈 Fundamentals', action: () => {
                    if (typeof window.openFundamentalsModal === 'function') window.openFundamentalsModal(sym);
                    else if (typeof openFundamentalsModal === 'function') openFundamentalsModal(sym);
                }},
                { label: '⚡ Market Depth', action: () => {
                    const compName = (options && options.item && (options.item.name || options.item.company)) || info.name || sym;
                    if (typeof window.openMarketDepthModal === 'function') window.openMarketDepthModal(sym, compName);
                    else if (typeof openMarketDepthModal === 'function') openMarketDepthModal(sym, compName);
                }},
                { label: '📝 Stock Notes', action: () => {
                    const compName = (options && options.item && (options.item.name || options.item.company)) || info.name || sym;
                    if (typeof window.openStockNotesModal === 'function') window.openStockNotesModal(sym, compName);
                    else if (typeof openStockNotesModal === 'function') openStockNotesModal(sym, compName);
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
                { isMove: true }
            ];

            const allWl = (typeof watchlistsData !== 'undefined' && watchlistsData) ? watchlistsData : {};
            const curWl = (typeof activeWatchlistName !== 'undefined') ? activeWatchlistName : '';
            const listForCur = (curWl && Array.isArray(allWl[curWl])) ? allWl[curWl] : [];
            const cleanSymVal = (typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(sym) : String(sym).replace(/\.(NS|BS|BO)$/i, '')).trim().toUpperCase();
            const isInCurrentWl = listForCur.some(item => {
                const itemStr = String(item).trim().toUpperCase();
                return itemStr === String(sym).trim().toUpperCase() || (typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(itemStr) : itemStr.replace(/\.(NS|BS|BO)$/i, '')) === cleanSymVal;
            });

            if (options && options.item) {
                menuItems.unshift({
                    label: '🔍 Holding Details',
                    action: () => {
                        if (typeof openHoldingDetailsModal === 'function') openHoldingDetailsModal(options.item);
                        else if (typeof window.openHoldingDetailsModal === 'function') window.openHoldingDetailsModal(options.item);
                    }
                });
            }

            if (!options || !options.hideDelete) {
                if (isInCurrentWl) {
                    menuItems.push({
                        label: '🗑️ Remove Stock',
                        danger: true,
                        action: () => {
                            if (typeof window.removeWatchlistStock === 'function') window.removeWatchlistStock(null, sym);
                            else if (typeof removeWatchlistStock === 'function') removeWatchlistStock(null, sym);
                        }
                    });
                } else if (curWl) {
                menuItems.push({
                    label: `➕ Add to "${curWl}"`,
                    action: () => {
                        if (typeof window.addWatchlistStock === 'function') window.addWatchlistStock(curWl, sym);
                        else if (typeof addWatchlistStock === 'function') addWatchlistStock(curWl, sym);
                    }
                });
                }
            }

            menuItems.forEach(item => {
                if (item.divider) {
                    const d = document.createElement('div');
                    d.style.cssText = 'height: 1px; background: var(--border-color); margin: 4px 0;';
                    popover.appendChild(d);
                    return;
                }

                if (item.isMove) {
                    const allWatchlists = Object.keys(watchlistsData || {});
                    const mMove = document.createElement('div');
                    mMove.className = 'menu-item wl-move-menu-item';
                    mMove.style.cssText = 'padding: 8px 14px; font-size: 12px; font-weight: 500; cursor: pointer; display: flex; align-items: center; justify-content: space-between; position: relative; color: var(--text-primary);';

                    const labelSpan = document.createElement('span');
                    labelSpan.style.cssText = 'display: inline-flex; align-items: center; gap: 8px;';
                    const isPortfolioMenu = !!(options && (options.isPortfolio || options.item));
                    const moveLabelText = isPortfolioMenu ? 'Add to Watchlist' : 'Move';
                    labelSpan.innerHTML = `<span>📁</span><span>${moveLabelText}</span>`;

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
                        min-width: 195px;
                        max-width: 260px;
                        max-height: 275px;
                        overflow: hidden;
                        background: var(--bg-card);
                        border: 1px solid var(--border-color);
                        border-radius: 8px;
                        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.15);
                        padding: 0;
                        z-index: 1000000;
                        text-align: left;
                        box-sizing: border-box;
                    `;

                    const positionSubmenu = () => {
                        submenu.style.display = 'block';
                        const smWidth = submenu.offsetWidth || 205;
                        const smHeight = submenu.offsetHeight || 230;
                        const popRect = popover.getBoundingClientRect();
                        const vh = window.innerHeight || document.documentElement.clientHeight;

                        // Check horizontal clearance: if flyout to left fits, go left, else flyout right
                        if (popRect.left - smWidth - 6 < 8) {
                            submenu.style.right = 'auto';
                            submenu.style.left = '100%';
                            submenu.style.marginRight = '0';
                            submenu.style.marginLeft = '4px';
                            submenu.classList.remove('bridge-right');
                            submenu.classList.add('bridge-left');
                        } else {
                            submenu.style.right = '100%';
                            submenu.style.left = 'auto';
                            submenu.style.marginRight = '4px';
                            submenu.style.marginLeft = '0';
                            submenu.classList.remove('bridge-left');
                            submenu.classList.add('bridge-right');
                        }

                        // Check vertical positioning relative to Move item
                        const mRect = mMove.getBoundingClientRect();
                        if (vh - mRect.top < smHeight + 10) {
                            submenu.style.top = 'auto';
                            submenu.style.bottom = '0';
                        } else {
                            submenu.style.bottom = 'auto';
                            submenu.style.top = '0';
                        }

                        // Viewport vertical clamping
                        const smRect = submenu.getBoundingClientRect();
                        if (smRect.bottom > vh - 8) {
                            const diff = smRect.bottom - (vh - 8);
                            submenu.style.transform = `translateY(-${Math.round(diff)}px)`;
                        } else if (smRect.top < 10) {
                            const diff = 10 - smRect.top;
                            submenu.style.transform = `translateY(${Math.round(diff)}px)`;
                        } else {
                            submenu.style.transform = 'none';
                        }
                    };

                    const showSubmenu = () => {
                        if (window._wlSubmenuHideTimer) {
                            clearTimeout(window._wlSubmenuHideTimer);
                            window._wlSubmenuHideTimer = null;
                        }
                        positionSubmenu();
                        submenu.style.display = 'block';
                    };

                    const delayHideSubmenu = () => {
                        if (window._wlSubmenuHideTimer) clearTimeout(window._wlSubmenuHideTimer);
                        window._wlSubmenuHideTimer = setTimeout(() => {
                            submenu.style.display = 'none';
                            mMove.classList.remove('active');
                            window._wlSubmenuHideTimer = null;
                        }, 1200);
                    };

                    if (allWatchlists.length === 0) {
                        const emptyItem = document.createElement('div');
                        emptyItem.className = 'wl-move-empty-item';
                        emptyItem.style.cssText = 'padding: 10px 14px; font-size: 11px; color: var(--text-secondary); font-style: italic;';
                        emptyItem.innerText = 'No watchlists';
                        submenu.appendChild(emptyItem);
                    } else {
                        // Top heading row with title on left and Done button on top right
                        const headingRow = document.createElement('div');
                        headingRow.className = 'wl-move-heading-row';
                        headingRow.style.cssText = `
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            gap: 8px;
                            padding: 6px 10px;
                            border-bottom: 1px solid var(--border-color);
                            background: var(--bg-subtle, rgba(255, 255, 255, 0.04));
                            user-select: none;
                        `;

                        const titleSpan = document.createElement('span');
                        titleSpan.style.cssText = 'font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted, #94a3b8); white-space: nowrap;';
                        titleSpan.innerText = 'Watchlists';

                        const doneBtn = document.createElement('button');
                        doneBtn.type = 'button';
                        doneBtn.className = 'wl-move-done-btn';
                        doneBtn.innerText = 'Done';
                        doneBtn.style.cssText = `
                            background: var(--accent, #3b82f6);
                            color: #ffffff;
                            border: none;
                            border-radius: 4px;
                            padding: 3px 10px;
                            font-size: 11px;
                            font-weight: 600;
                            cursor: pointer;
                            line-height: 1.2;
                            transition: opacity 0.15s ease;
                        `;
                        doneBtn.addEventListener('mouseenter', () => { doneBtn.style.opacity = '0.85'; });
                        doneBtn.addEventListener('mouseleave', () => { doneBtn.style.opacity = '1'; });

                        headingRow.appendChild(titleSpan);
                        headingRow.appendChild(doneBtn);
                        submenu.appendChild(headingRow);

                        // Scrollable list container
                        const listContainer = document.createElement('div');
                        listContainer.className = 'wl-move-list-container';
                        listContainer.style.cssText = `
                            max-height: 220px;
                            overflow-y: auto;
                            overflow-x: hidden;
                            padding: 3px 0;
                        `;

                        const isSymInWl = (targetWl) => {
                            const list = watchlistsData && watchlistsData[targetWl];
                            if (!Array.isArray(list)) return false;
                            const cleanSym = (typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(sym) : String(sym).replace(/\.(NS|BS|BO)$/i, '')).trim().toUpperCase();
                            return list.some(item => {
                                const itemStr = String(item).trim().toUpperCase();
                                return itemStr === String(sym).trim().toUpperCase() || (typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(itemStr) : itemStr.replace(/\.(NS|BS|BO)$/i, '')) === cleanSym;
                            });
                        };

                        allWatchlists.forEach(targetWl => {
                            const count = Array.isArray(watchlistsData[targetWl]) ? watchlistsData[targetWl].length : 0;
                            const isPrechecked = isSymInWl(targetWl);
                            const isCurrent = !isPortfolioMenu && isPrechecked && (targetWl === activeWatchlistName);

                            const targetItem = document.createElement('div');
                            targetItem.className = 'menu-item wl-move-target-item';
                            targetItem.style.cssText = `
                                padding: 6px 10px;
                                font-size: 12px;
                                font-weight: 500;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                justify-content: space-between;
                                gap: 8px;
                                box-sizing: border-box;
                                color: var(--text-primary);
                                user-select: none;
                            `;

                            const leftCol = document.createElement('div');
                            leftCol.style.cssText = 'display: inline-flex; align-items: center; gap: 8px; flex: 1; min-width: 0;';

                            const checkbox = document.createElement('input');
                            checkbox.type = 'checkbox';
                            checkbox.className = 'wl-move-checkbox';
                            checkbox.checked = isPrechecked;
                            checkbox.dataset.wlName = targetWl;
                            checkbox.dataset.initialChecked = isPrechecked ? '1' : '0';
                            checkbox.style.cssText = 'cursor: pointer; width: 14px; height: 14px; accent-color: var(--accent, #3b82f6); margin: 0; flex-shrink: 0;';

                            const targetNameSpan = document.createElement('span');
                            targetNameSpan.style.cssText = 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px;';
                            targetNameSpan.title = targetWl;
                            targetNameSpan.innerText = targetWl;

                            leftCol.appendChild(checkbox);
                            leftCol.appendChild(targetNameSpan);

                            if (isCurrent) {
                                const currentBadge = document.createElement('span');
                                currentBadge.style.cssText = 'font-size: 9px; padding: 1px 4px; border-radius: 3px; background: rgba(59, 130, 246, 0.18); color: var(--accent, #3b82f6); font-weight: 700; flex-shrink: 0; text-transform: uppercase; letter-spacing: 0.02em;';
                                currentBadge.innerText = 'Current';
                                leftCol.appendChild(currentBadge);
                            }

                            const targetBadge = document.createElement('span');
                            targetBadge.style.cssText = 'font-size: 10px; color: var(--text-secondary); opacity: 0.8; font-weight: normal; flex-shrink: 0;';
                            targetBadge.innerText = `${count}`;

                            targetItem.appendChild(leftCol);
                            targetItem.appendChild(targetBadge);

                            // Toggle checkbox on item click
                            targetItem.addEventListener('click', (ev) => {
                                ev.preventDefault();
                                ev.stopPropagation();
                                mMove.classList.add('active');
                                if (window._wlSubmenuHideTimer) {
                                    clearTimeout(window._wlSubmenuHideTimer);
                                    window._wlSubmenuHideTimer = null;
                                }
                                if (ev.target !== checkbox) {
                                    checkbox.checked = !checkbox.checked;
                                }
                            });

                            checkbox.addEventListener('click', (ev) => {
                                ev.stopPropagation();
                                mMove.classList.add('active');
                                if (window._wlSubmenuHideTimer) {
                                    clearTimeout(window._wlSubmenuHideTimer);
                                    window._wlSubmenuHideTimer = null;
                                }
                            });

                            listContainer.appendChild(targetItem);
                        });

                        submenu.appendChild(listContainer);

                        // Done button click handler
                        let doneTriggerTime = 0;
                        const handleDoneClick = async (ev) => {
                            const now = Date.now();
                            if (now - doneTriggerTime < 350) return;
                            doneTriggerTime = now;
                            if (ev) {
                                ev.preventDefault();
                                ev.stopPropagation();
                                ev.stopImmediatePropagation();
                            }
                            window._wlMenuJustClosed = true;
                            setTimeout(() => { window._wlMenuJustClosed = false; }, 400);

                            const checkboxes = listContainer.querySelectorAll('.wl-move-checkbox');
                            const targetWatchlists = [];
                            let hasChanges = false;
                            let addedCount = 0;
                            let removedCount = 0;

                            checkboxes.forEach(cb => {
                                const wName = cb.dataset.wlName;
                                const initial = cb.dataset.initialChecked === '1';
                                const current = cb.checked;
                                if (current) {
                                    targetWatchlists.push(wName);
                                }
                                if (current !== initial) {
                                    hasChanges = true;
                                    if (current) addedCount++;
                                    else removedCount++;
                                }
                            });

                            closeAllWlMenus();

                            if (!hasChanges) {
                                return;
                            }

                            await syncStockWatchlists(sym, targetWatchlists, addedCount, removedCount);
                        };

                        doneBtn.addEventListener('click', handleDoneClick);
                        doneBtn.addEventListener('touchend', handleDoneClick);
                    }

                    // Hover behavior: immediate open, wait before hiding when mouse leaves
                    mMove.addEventListener('mouseenter', showSubmenu);
                    mMove.addEventListener('mouseleave', (ev) => {
                        const rel = ev.relatedTarget;
                        if (rel && (rel === submenu || submenu.contains(rel))) return;
                        if (!mMove.classList.contains('active')) {
                            delayHideSubmenu();
                        }
                    });

                    submenu.addEventListener('mouseenter', showSubmenu);
                    submenu.addEventListener('mouseleave', (ev) => {
                        const rel = ev.relatedTarget;
                        if (rel && (rel === mMove || mMove.contains(rel))) return;
                        if (!mMove.classList.contains('active')) {
                            delayHideSubmenu();
                        }
                    });

                    // Mobile tap / click toggle: ensure submenu stays open
                    mMove.addEventListener('click', (ev) => {
                        if (ev.target.closest('.wl-move-target-item') || ev.target.closest('.wl-move-done-btn') || ev.target.closest('.wl-move-heading-row')) return;
                        ev.preventDefault();
                        ev.stopPropagation();
                        showSubmenu();
                        mMove.classList.add('active');
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
                    if (typeof window.closeMobileHeaderSearch === 'function') {
                        window.closeMobileHeaderSearch();
                    }
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

            const popoverWidth = popover.offsetWidth || 215;
            const popoverHeight = popover.offsetHeight || 260;

            // Detect sticky header in table container to prevent upward collisions
            const tableContainer = btn.closest('.table-responsive-container') || btn.closest('.wl-table-container');
            let topBoundary = 10;
            if (tableContainer) {
                const thead = tableContainer.querySelector('thead');
                if (thead) {
                    const theadRect = thead.getBoundingClientRect();
                    if (theadRect.bottom > 0 && theadRect.bottom < viewportHeight) {
                        topBoundary = Math.max(10, theadRect.bottom + 2);
                    }
                }
            }

            const spaceBelow = viewportHeight - btnRect.bottom - 10;
            const spaceAbove = btnRect.top - topBoundary - 4;

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

            const clampedTop = Math.max(topBoundary, Math.min(viewportHeight - popoverHeight - 10, desiredTop));
            popover.style.top = `${Math.round(clampedTop)}px`;
            popover.style.bottom = 'auto';

            // Precise horizontal positioning: align right edge of popover with right edge of button
            let desiredLeft = btnRect.right - popoverWidth;
            if (desiredLeft < 8) desiredLeft = 8;
            if (desiredLeft + popoverWidth > viewportWidth - 8) {
                desiredLeft = viewportWidth - popoverWidth - 8;
            }
            popover.style.left = `${Math.round(desiredLeft)}px`;
            popover.style.right = 'auto';
            popover.style.maxWidth = `${Math.min(260, viewportWidth - 16)}px`;

            const parentTr = btn.closest('tr');
            if (parentTr) parentTr.classList.add('wl-row-menu-open');
            _wlMenuOpenScrollY = window.scrollY || window.pageYOffset || 0;
        }
        window.toggleWlRowMenu = toggleWlRowMenu;

        function closeAllWlMenus() {
            let hadOpen = false;
            if (window._wlSubmenuHideTimer) {
                clearTimeout(window._wlSubmenuHideTimer);
                window._wlSubmenuHideTimer = null;
            }
            const popover = document.getElementById('wl-global-stock-popover');
            if (popover && popover.style.display === 'block') {
                hadOpen = true;
                popover.style.display = 'none';
                popover.dataset.sym = '';
            }
            document.querySelectorAll('.wl-move-submenu').forEach(el => {
                el.style.display = 'none';
            });
            document.querySelectorAll('.wl-move-menu-item.active').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('[id^="wl-row-menu-"]').forEach(el => {
                if (el.style.display === 'block') {
                    hadOpen = true;
                    el.style.display = 'none';
                }
            });
            document.querySelectorAll('.wl-row-menu-open').forEach(el => el.classList.remove('wl-row-menu-open'));
            document.querySelectorAll('.wl-container-menu-open').forEach(el => el.classList.remove('wl-container-menu-open'));
            if (hadOpen) {
                window._wlMenuJustClosed = true;
                setTimeout(() => { window._wlMenuJustClosed = false; }, 300);
            }
        }
        window.closeAllWlMenus = closeAllWlMenus;

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
                    if (e.target.closest && (e.target.closest('#wl-global-stock-popover') || e.target.closest('.wl-move-submenu'))) {
                        return; // Do not close if scrolling inside the popover or submenu
                    }
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

        function updateAutocompleteSelection(dropdown, index) {
            if (!dropdown) return;
            const items = dropdown.querySelectorAll('.autocomplete-item');
            if (!items.length) {
                dropdown._selectedIndex = -1;
                return;
            }
            if (index < 0) index = -1;
            if (index >= items.length) index = items.length - 1;
            dropdown._selectedIndex = index;
            items.forEach((item, i) => {
                if (i === index) {
                    item.classList.add('active');
                    item.scrollIntoView({ block: 'nearest' });
                } else {
                    item.classList.remove('active');
                }
            });
        }
        window.updateAutocompleteSelection = updateAutocompleteSelection;

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
                if (dropdown) {
                    dropdown.style.display = 'none';
                    dropdown._selectedIndex = -1;
                }
                return;
            }

            searchTimeout = setTimeout(async () => {
                const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
                const results = await res.json();
                
                if (!dropdown) return;
                dropdown.innerHTML = '';
                dropdown._selectedIndex = -1;
                if (results.length > 0) {
                    results.forEach((item, itemIdx) => {
                        const div = document.createElement('div');
                        div.className = 'autocomplete-item';
                        div.dataset.index = itemIdx;
                        div.onmouseenter = () => updateAutocompleteSelection(dropdown, itemIdx);
                        const bInfo = getSymbolBadge(item.symbol, item.exchange);
                        let alreadyInBadge = '';
                        if (type === 'wl') {
                            const targetName = inputElement.getAttribute('data-wl-name') || activeWatchlistName;
                            const currentStocks = (watchlistsData && watchlistsData[targetName]) || [];
                            if (currentStocks.includes(item.symbol)) {
                                alreadyInBadge = '<span class="wl-already-in-badge">✓ In Watchlist</span>';
                            }
                        }
                        div.innerHTML = `
                            <div>
                                <span class="autocomplete-symbol">${cleanDisplaySymbol(item.symbol)}</span>
                                <span class="badge ${bInfo.class}">${bInfo.label}</span>
                                ${alreadyInBadge}
                                <div class="autocomplete-name">${escapeHtml(item.name)}</div>
                            </div>
                        `;
                        div.onclick = () => {
                            if (type === 'wl') {
                                const targetName = inputElement.getAttribute('data-wl-name') || activeWatchlistName;
                                const currentStocks = (watchlistsData && watchlistsData[targetName]) || [];
                                if (currentStocks.includes(item.symbol)) {
                                    if (typeof showToast === 'function') {
                                        showToast(`${cleanDisplaySymbol(item.symbol)} is already in ${targetName}`, 'info', 2500);
                                    }
                                    if (dropdown) {
                                        dropdown.style.display = 'none';
                                        dropdown._selectedIndex = -1;
                                    }
                                    inputElement.value = '';
                                    const targetRow = document.getElementById(`row-${item.symbol}`);
                                    if (targetRow) {
                                        targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        targetRow.classList.add('row-highlight');
                                        setTimeout(() => targetRow.classList.remove('row-highlight'), 2000);
                                    }
                                    return;
                                }
                                addWatchlistStock(targetName, item.symbol);
                            } else if (type === 'modal-pf') {
                                const symInput = document.getElementById('modal-pf-add-symbol');
                                if (symInput) symInput.value = item.symbol;
                                const priceInput = document.getElementById('modal-pf-add-price');
                                const info = (typeof stockPricesData !== 'undefined' && stockPricesData[item.symbol]) || {};
                                if (priceInput && !priceInput.value && info.price) {
                                    priceInput.value = info.price.toFixed(2);
                                }
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
                            dropdown._selectedIndex = -1;
                        };
                        dropdown.appendChild(div);
                    });
                    dropdown.style.display = 'block';
                } else {
                    dropdown.style.display = 'none';
                    dropdown._selectedIndex = -1;
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
        window.openCreateWatchlistModal = openCreateWatchlistModal;
        window.closeCreateWatchlistModal = closeCreateWatchlistModal;

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
                // modal closes ONLY via Escape or close button
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

        function updateWatchlistScrollArrows() {
            const mount = document.getElementById('watchlist-selector-mount');
            const leftBtn = document.getElementById('wl-scroll-left-btn');
            const rightBtn = document.getElementById('wl-scroll-right-btn');
            if (!mount || !leftBtn || !rightBtn) return;
            if (window.innerWidth <= 768) {
                leftBtn.style.display = 'none';
                rightBtn.style.display = 'none';
                return;
            }

            const maxScroll = mount.scrollWidth - mount.clientWidth;
            const canScrollRight = maxScroll > 4 && (mount.scrollLeft < maxScroll - 4);
            const canScrollLeft = mount.scrollLeft > 4;

            rightBtn.style.display = canScrollRight ? 'flex' : 'none';
            leftBtn.style.display = canScrollLeft ? 'flex' : 'none';
        }
        window.updateWatchlistScrollArrows = updateWatchlistScrollArrows;

        function initWatchlistScrollArrows() {
            const mount = document.getElementById('watchlist-selector-mount');
            const leftBtn = document.getElementById('wl-scroll-left-btn');
            const rightBtn = document.getElementById('wl-scroll-right-btn');
            if (!mount || !leftBtn || !rightBtn) return;

            if (!leftBtn.dataset.bound) {
                leftBtn.onclick = () => {
                    mount.scrollBy({ left: -220, behavior: 'smooth' });
                    setTimeout(updateWatchlistScrollArrows, 260);
                };
                leftBtn.dataset.bound = 'true';
            }

            if (!rightBtn.dataset.bound) {
                rightBtn.onclick = () => {
                    mount.scrollBy({ left: 220, behavior: 'smooth' });
                    setTimeout(updateWatchlistScrollArrows, 260);
                };
                rightBtn.dataset.bound = 'true';
            }

            if (!mount.dataset.scrollArrowBound) {
                mount.addEventListener('scroll', updateWatchlistScrollArrows, { passive: true });
                window.addEventListener('resize', updateWatchlistScrollArrows);
                if (window.ResizeObserver) {
                    try {
                        new ResizeObserver(updateWatchlistScrollArrows).observe(mount);
                    } catch(e) {}
                }
                mount.dataset.scrollArrowBound = 'true';
            }
            updateWatchlistScrollArrows();
        }
        window.initWatchlistScrollArrows = initWatchlistScrollArrows;

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
                const currentMode = localStorage.getItem('capital_desk_watchlist_chart_mode') || 'native';
                if (currentMode === 'tradingview') {
                    wlTooltipEl.innerHTML = `Click to sync <b>${escapeHtml(compName)}</b> in TradingView App Window`;
                } else {
                    wlTooltipEl.innerHTML = `Click to view <b>${escapeHtml(compName)}</b> technical chart`;
                }
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


        // Close multi-select stocks dropdown when clicking outside
        document.addEventListener('click', function(e) {
            if (!e.target.closest('#wl-stocks-dropdown-wrapper') && !e.target.closest('#wl-stocks-dropdown-backdrop')) {
                const menu = document.getElementById('wl-stocks-dropdown-menu');
                if (menu && menu.style.display !== 'none') {
                    menu.style.display = 'none';
                    const btn = document.getElementById('wl-stocks-dropdown-btn');
                    if (btn) btn.classList.remove('open');
                    const backdrop = document.getElementById('wl-stocks-dropdown-backdrop');
                    if (backdrop) backdrop.style.display = 'none';
                }
            }
        });

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                const menu = document.getElementById('wl-stocks-dropdown-menu');
                if (menu && menu.style.display !== 'none') {
                    menu.style.display = 'none';
                    const btn = document.getElementById('wl-stocks-dropdown-btn');
                    if (btn) btn.classList.remove('open');
                    const backdrop = document.getElementById('wl-stocks-dropdown-backdrop');
                    if (backdrop) backdrop.style.display = 'none';
                }
            }
        });
