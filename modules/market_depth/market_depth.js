// =========================================================
// CAPITAL DESK - MARKET DEPTH (LEVEL 2 ORDER BOOK) MODULE
// Location: modules/market_depth/market_depth.js
// Provides live Top-5 Bids/Asks, Order Counts, Imbalance Bar,
// OHLC statistics & real-time sync with parent stock quotes.
// =========================================================

(function() {
    let _activeDepthSymbol = '';
    let _activeDepthCompanyName = '';
    let _depthPriceSyncTimer = null;
    let _lastRenderedLTP = null;

    function cleanSym(sym) {
        if (!sym) return '';
        if (typeof cleanDisplaySymbol === 'function') return cleanDisplaySymbol(sym);
        return String(sym).trim().toUpperCase().replace(/\.(NS|BO|BS)$/i, '');
    }

    function formatNumber(num) {
        if (num === null || num === undefined || isNaN(num)) return '0';
        return Number(num).toLocaleString('en-IN');
    }

    function formatPrice(val) {
        if (val === null || val === undefined || isNaN(val)) return '0.00';
        return Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    async function openMarketDepthModal(symbol, companyName) {
        if (!symbol) return;
        const normSym = cleanSym(symbol);
        _activeDepthSymbol = normSym;

        // Resolve company name
        let compName = companyName || '';
        if (!compName && typeof stockPricesData !== 'undefined' && stockPricesData) {
            const info = stockPricesData[symbol] || stockPricesData[normSym] || stockPricesData[normSym + '.NS'] || stockPricesData[normSym + '.BO'];
            if (info && info.name) compName = info.name;
        }
        if (!compName) compName = normSym;
        _activeDepthCompanyName = compName;

        // Set Header details
        const symEl = document.getElementById('marketDepthSymbol');
        const nameEl = document.getElementById('marketDepthCompanyName');
        if (symEl) symEl.innerText = normSym;
        if (nameEl) nameEl.innerText = compName;

        // Sync parent price immediately
        syncParentPrice();

        // Open modal
        const modal = document.getElementById('marketDepthModal');
        if (modal) modal.style.display = 'block';

        // Start real-time parent price listener while modal is open
        startParentPriceSync();

        // Fetch depth data
        await fetchMarketDepth(normSym);
    }

    function closeMarketDepthModal() {
        const modal = document.getElementById('marketDepthModal');
        if (modal) modal.style.display = 'none';
        _activeDepthSymbol = '';
        _activeDepthCompanyName = '';
        _lastRenderedLTP = null;
        stopParentPriceSync();
    }

    function syncParentPrice() {
        if (!_activeDepthSymbol) return;
        const sym = _activeDepthSymbol;
        let ltp = null;
        let change = null;
        let changePct = null;

        // Check stockPricesData (Watchlist & Portfolio global store)
        if (typeof stockPricesData !== 'undefined' && stockPricesData) {
            const info = stockPricesData[sym] || stockPricesData[sym + '.NS'] || stockPricesData[sym + '.BO'];
            if (info) {
                ltp = (info.price !== undefined && info.price !== null) ? Number(info.price) : (info.ltp !== undefined ? Number(info.ltp) : null);
                change = info.change !== undefined ? Number(info.change) : null;
                changePct = (info.change_percent !== undefined) ? Number(info.change_percent) : (info.change_pct !== undefined ? Number(info.change_pct) : null);
            }
        }

        // If not in stockPricesData, check if Chart modal is open for current symbol
        if (ltp === null && typeof currentChartSymbol !== 'undefined') {
            const cleanChartSym = cleanSym(currentChartSymbol);
            if (cleanChartSym === sym) {
                const chartLtpEl = document.getElementById('chartLtpDisplay');
                if (chartLtpEl) {
                    const parsed = parseFloat(chartLtpEl.innerText.replace(/[₹,]/g, ''));
                    if (!isNaN(parsed)) ltp = parsed;
                }
            }
        }

        if (ltp !== null && ltp > 0) {
            updateLTPDisplay(ltp, change, changePct);
        }
    }

    function updateLTPDisplay(ltp, change, changePct) {
        const ltpEl = document.getElementById('marketDepthLTP');
        const chgEl = document.getElementById('marketDepthChange');
        if (!ltpEl) return;

        ltpEl.innerText = `₹${formatPrice(ltp)}`;
        _lastRenderedLTP = ltp;

        if (chgEl) {
            if (change !== null && changePct !== null) {
                const isPos = change >= 0;
                const sign = isPos ? '+' : '';
                chgEl.innerText = `${sign}${formatPrice(change)} (${sign}${changePct.toFixed(2)}%)`;
                chgEl.className = `market-depth-change ${isPos ? 'pos' : 'neg'}`;
            } else {
                chgEl.innerText = '';
            }
        }
    }

    function startParentPriceSync() {
        stopParentPriceSync();
        _depthPriceSyncTimer = setInterval(() => {
            syncParentPrice();
        }, 1000);
    }

    function stopParentPriceSync() {
        if (_depthPriceSyncTimer) {
            clearInterval(_depthPriceSyncTimer);
            _depthPriceSyncTimer = null;
        }
    }

    async function fetchMarketDepth(symbol) {
        if (!symbol) return;
        const loader = document.getElementById('marketDepthLoader');
        const errBox = document.getElementById('marketDepthError');
        const tableWrap = document.getElementById('marketDepthTableWrap');
        const refreshIcon = document.querySelector('.market-depth-refresh-icon');

        if (refreshIcon) refreshIcon.classList.add('is-spinning');
        if (errBox) errBox.style.display = 'none';

        // Only show centered loader if table has no data yet
        const rowsEl = document.getElementById('marketDepthRows');
        if (rowsEl && rowsEl.children.length === 0) {
            if (loader) loader.style.display = 'flex';
            if (tableWrap) tableWrap.style.display = 'none';
        }

        const startTime = Date.now();

        try {
            const res = await fetch(`/api/market-depth/${encodeURIComponent(symbol)}`);
            const data = await res.json();

            if (data.success) {
                renderMarketDepth(data);
                if (loader) loader.style.display = 'none';
                if (tableWrap) tableWrap.style.display = 'block';
            } else {
                throw new Error(data.error || 'Failed to retrieve market depth');
            }
        } catch (err) {
            console.error('[Market Depth] Fetch failed:', err);
            if (loader) loader.style.display = 'none';
            if (rowsEl && rowsEl.children.length === 0) {
                if (errBox) {
                    const errText = document.getElementById('marketDepthErrorText');
                    if (errText) errText.innerText = err.message || 'Market depth temporarily unavailable.';
                    errBox.style.display = 'flex';
                }
            } else {
                if (typeof showToast === 'function') {
                    showToast('Could not refresh Market Depth. Please try again.', 'error');
                }
            }
        } finally {
            // Keep spinning for at least 400ms for smooth user interaction
            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, 400 - elapsed);
            setTimeout(() => {
                if (refreshIcon) refreshIcon.classList.remove('is-spinning');
            }, remaining);
        }
    }

    function renderMarketDepth(data) {
        // 1. Update Company Name if available
        if (data.company_name) {
            const nameEl = document.getElementById('marketDepthCompanyName');
            if (nameEl) nameEl.innerText = data.company_name;
        }

        // 2. Update Price if not already updated by live parent ticker
        if (data.ltp > 0 && (_lastRenderedLTP === null || Math.abs(_lastRenderedLTP - data.ltp) > 0.001)) {
            updateLTPDisplay(data.ltp, data.change, data.change_pct);
        }

        // 3. Render 5 Depth Rows
        const rowsEl = document.getElementById('marketDepthRows');
        if (rowsEl) {
            rowsEl.innerHTML = '';
            const bids = Array.isArray(data.bids) ? data.bids : [];
            const asks = Array.isArray(data.asks) ? data.asks : [];

            for (let i = 0; i < 5; i++) {
                const b = bids[i] || { qty: 0, orders: 0, price: 0.0 };
                const a = asks[i] || { price: 0.0, orders: 0, qty: 0 };

                const row = document.createElement('div');
                row.className = 'market-depth-row';
                row.innerHTML = `
                    <div class="depth-cell cell-buy-qty">${b.qty > 0 ? formatNumber(b.qty) : '-'}</div>
                    <div class="depth-cell cell-buy-orders">${b.orders > 0 ? formatNumber(b.orders) : '-'}</div>
                    <div class="depth-cell cell-buy-price">${b.price > 0 ? formatPrice(b.price) : '-'}</div>
                    <div class="depth-cell cell-sell-price">${a.price > 0 ? formatPrice(a.price) : '-'}</div>
                    <div class="depth-cell cell-sell-orders">${a.orders > 0 ? formatNumber(a.orders) : '-'}</div>
                    <div class="depth-cell cell-sell-qty">${a.qty > 0 ? formatNumber(a.qty) : '-'}</div>
                `;
                rowsEl.appendChild(row);
            }
        }

        // 4. Update Imbalance Bar & Total Quantities
        const buyBar = document.getElementById('marketDepthBuyBar');
        const sellBar = document.getElementById('marketDepthSellBar');
        const totalBuyEl = document.getElementById('marketDepthTotalBuy');
        const totalSellEl = document.getElementById('marketDepthTotalSell');

        const buyRatio = data.buy_ratio_pct !== undefined ? data.buy_ratio_pct : 50;
        const sellRatio = data.sell_ratio_pct !== undefined ? data.sell_ratio_pct : 50;

        if (buyBar) buyBar.style.width = `${buyRatio}%`;
        if (sellBar) sellBar.style.width = `${sellRatio}%`;
        if (totalBuyEl) totalBuyEl.innerText = formatNumber(data.total_buy_qty || 0);
        if (totalSellEl) totalSellEl.innerText = formatNumber(data.total_sell_qty || 0);

        // 5. Update Statistics Footer (Open, High, Low, Close)
        const openEl = document.getElementById('marketDepthOpen');
        const highEl = document.getElementById('marketDepthHigh');
        const lowEl = document.getElementById('marketDepthLow');
        const closeEl = document.getElementById('marketDepthClose');

        if (openEl) openEl.innerText = data.open > 0 ? `₹${formatPrice(data.open)}` : '-';
        if (highEl) highEl.innerText = data.high > 0 ? `₹${formatPrice(data.high)}` : '-';
        if (lowEl) lowEl.innerText = data.low > 0 ? `₹${formatPrice(data.low)}` : '-';
        if (closeEl) closeEl.innerText = data.close > 0 ? `₹${formatPrice(data.close)}` : '-';

        // 6. Timestamp
        const timeEl = document.getElementById('marketDepthTimestamp');
        if (timeEl) {
            timeEl.innerText = `Updated: ${data.timestamp || new Date().toLocaleTimeString('en-IN')}`;
        }
    }

    async function refreshMarketDepthModal() {
        if (!_activeDepthSymbol) return;
        await fetchMarketDepth(_activeDepthSymbol);
    }

    // Expose global methods
    window.openMarketDepthModal = openMarketDepthModal;
    window.closeMarketDepthModal = closeMarketDepthModal;
    window.refreshMarketDepthModal = refreshMarketDepthModal;

    // ESC key closes modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('marketDepthModal');
            if (modal && modal.style.display === 'block') {
                closeMarketDepthModal();
            }
        }
    });
})();
