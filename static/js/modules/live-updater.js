        // =========================================================
        // REFRESH LIVE MARKET DATA & UPDATE CALCULATIONS
        // =========================================================
        async function refreshPrices() {
            // Request symbols for the current active view only to optimize network payload.
            const allSymbols = new Set();

            if (currentTab === 'watchlists') {
                const activeSymbols = (watchlistsData && activeWatchlistName && watchlistsData[activeWatchlistName]) || [];
                activeSymbols.forEach(s => {
                    if (s) allSymbols.add(s);
                });
            } else if (currentTab === 'portfolios' || !window.portfoliosLoaded) {
                if (activePortfolioName === 'All' || !activePortfolioName) {
                    Object.values(portfoliosData || {}).forEach(holdings => {
                        (holdings || []).forEach(h => {
                            if (h && h.symbol) allSymbols.add(h.symbol);
                        });
                    });
                } else {
                    const holdings = (portfoliosData && activePortfolioName && portfoliosData[activePortfolioName]) || [];
                    holdings.forEach(h => {
                        if (h && h.symbol) allSymbols.add(h.symbol);
                    });
                }
            } else if (currentTab === 'dashboard') {
                Object.values(portfoliosData || {}).forEach(holdings => {
                    (holdings || []).forEach(h => {
                        if (h && h.symbol) allSymbols.add(h.symbol);
                    });
                });
            } else if (currentTab === 'smallcases') {
                if (selectedSmallcaseDetail && Array.isArray(selectedSmallcaseDetail.holdings)) {
                    selectedSmallcaseDetail.holdings.forEach(h => {
                        if (h && h.symbol) allSymbols.add(h.symbol);
                    });
                } else if (typeof smallcaseListCache !== 'undefined' && Array.isArray(smallcaseListCache)) {
                    smallcaseListCache.forEach(sc => {
                        (sc.symbols || []).forEach(s => { if (s) allSymbols.add(s); });
                    });
                }
            } else if (currentTab === 'insights') {
                Object.values(portfoliosData || {}).forEach(holdings => {
                    (holdings || []).forEach(h => {
                        if (h && h.symbol) allSymbols.add(h.symbol);
                    });
                });
            }

            if (allSymbols.size === 0) return;

            const res = await fetch('/api/stock_data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbols: Array.from(allSymbols) })
            });
            const newPrices = await res.json();
            for (const [sym, info] of Object.entries(newPrices)) {
                if (info && (!info.error || !stockPricesData[sym])) {
                    stockPricesData[sym] = info;
                }
            }

            // On initial load, re-render watchlist so default sort (Day P&L % High to Low) uses fresh live prices
            if (!window._wlInitialSorted && currentTab === 'watchlists') {
                window._wlInitialSorted = true;
                if (typeof renderWatchlists === 'function') renderWatchlists();
            }

            // 1. Update Watchlist Rows
            for (const [sym, info] of Object.entries(stockPricesData)) {
                const nameEl = document.getElementById(`name-${sym}`);
                const priceEl = document.getElementById(`price-${sym}`);
                const changeAmtEl = document.getElementById(`change-amt-${sym}`);
                const changePctEl = document.getElementById(`change-pct-${sym}`);
                const subChangeEl = document.getElementById(`sub-change-${sym}`);

                if (info.error) {
                    if (nameEl) nameEl.innerText = 'Stock unavailable';
                    if (priceEl) priceEl.innerText = 'Error';
                    if (changeAmtEl) changeAmtEl.innerText = '-';
                    if (changePctEl) changePctEl.innerText = '-';
                    if (subChangeEl) subChangeEl.innerText = '-';
                    continue;
                }
                
                if (nameEl && info.name) nameEl.innerText = info.name;
                if (priceEl && info.price !== undefined) {
                    priceEl.innerText = '₹' + info.price.toLocaleString('en-IN', {minimumFractionDigits: 2});
                    if (info.change !== undefined) {
                        priceEl.classList.remove('pos', 'neg');
                        priceEl.classList.add(info.change >= 0 ? 'pos' : 'neg');
                    }
                }
                
                if (info.change !== undefined) {
                    const sign = info.change >= 0 ? '+' : '';
                    if (changeAmtEl) {
                        changeAmtEl.innerText = `${sign}₹${Math.abs(info.change).toFixed(2)}`;
                        changeAmtEl.classList.remove('pos', 'neg');
                        changeAmtEl.classList.add(info.change >= 0 ? 'pos' : 'neg');
                    }
                    if (changePctEl) {
                        changePctEl.innerText = `${sign}${info.change_pct.toFixed(2)}%`;
                        changePctEl.classList.remove('pos', 'neg');
                        changePctEl.classList.add(info.change >= 0 ? 'pos' : 'neg');
                    }
                    if (subChangeEl) {
                        subChangeEl.innerText = `${sign}₹${Math.abs(info.change).toFixed(2)} (${sign}${info.change_pct.toFixed(2)}%)`;
                        subChangeEl.classList.remove('pos', 'neg');
                        subChangeEl.classList.add(info.change >= 0 ? 'pos' : 'neg');
                    }
                }
            }

            // 2. Update Active Portfolio Rows & Calculations
            const pfNames = Object.keys(portfoliosData || {});
            const isAll = activePortfolioName === 'All' && pfNames.length > 1;
            if (isAll || (activePortfolioName && portfoliosData[activePortfolioName])) {
                let holdings = [];
                if (isAll) {
                    pfNames.forEach(name => {
                        (portfoliosData[name] || []).forEach(h => {
                            holdings.push({ ...h, portfolioName: name });
                        });
                    });
                } else {
                    holdings = (portfoliosData[activePortfolioName] || []).map(h => ({ ...h, portfolioName: activePortfolioName }));
                }

                let totInvested = 0;
                let totCurrentVal = 0;
                let totDayPnL = 0;

                holdings.forEach(h => {
                    const sym = h.symbol;
                    const safePf = (h.portfolioName || activePortfolioName || '').replace(/[^a-zA-Z0-9_-]/g, '_');
                    const safeSym = sym.replace(/[^a-zA-Z0-9_-]/g, '_');
                    const rowKey = `${safePf}_${safeSym}`;

                    const info = stockPricesData[sym] || {};
                    const ltp = info.price || 0;
                    const dayChange = info.change || 0;

                    const invAmt = h.buy_price * h.quantity;
                    const curVal = ltp > 0 ? (ltp * h.quantity) : invAmt;
                    const pnlAmt = curVal - invAmt;
                    const pnlPct = invAmt > 0 ? (pnlAmt / invAmt) * 100 : 0;
                    const dayPnLAmt = ltp > 0 ? dayChange * h.quantity : 0;
                    const dayPnlPct = info.change_pct !== undefined ? info.change_pct : 0;

                    totInvested += invAmt;
                    totCurrentVal += curVal;
                    totDayPnL += dayPnLAmt;

                    const pfNameEl = document.getElementById(`pf-name-${rowKey}`) || document.getElementById(`pf-name-${sym}`);
                    const pfLtpEl = document.getElementById(`pf-ltp-${rowKey}`) || document.getElementById(`pf-ltp-${sym}`);
                    const pfValEl = document.getElementById(`pf-val-${rowKey}`) || document.getElementById(`pf-val-${sym}`);
                    const pfPnlEl = document.getElementById(`pf-pnl-${rowKey}`) || document.getElementById(`pf-pnl-${sym}`);
                    const pfDayPnlEl = document.getElementById(`pf-daypnl-${rowKey}`) || document.getElementById(`pf-daypnl-${sym}`);
                    const pfDayPctEl = document.getElementById(`pf-day-pct-${rowKey}`);
                    const pfDayLblEl = document.getElementById(`pf-day-lbl-${rowKey}`);

                    if (pfNameEl && info.name) pfNameEl.innerText = info.name;
                    if (pfLtpEl) pfLtpEl.innerText = ltp > 0 ? (isPrivacyMode ? '••••••' : `₹${ltp.toLocaleString('en-IN', {minimumFractionDigits: 2})}`) : '-';
                    if (pfValEl) pfValEl.innerText = isPrivacyMode ? '₹ ••••••' : `₹${Math.round(curVal).toLocaleString('en-IN')}`;

                    if (pfPnlEl) {
                        const sign = pnlAmt >= 0 ? '+' : '';
                        if (pfPnlEl.classList.contains('pf-mob-pnl-line')) {
                            pfPnlEl.innerHTML = isPrivacyMode
                                ? `₹ •••••• <span class="pf-mob-pct-val">(${sign}${pnlPct.toFixed(2)}%)</span>`
                                : `${sign}₹${Math.abs(pnlAmt).toLocaleString('en-IN', {minimumFractionDigits: 2})} <span class="pf-mob-pct-val">(${sign}${pnlPct.toFixed(2)}%)</span>`;
                        } else {
                            pfPnlEl.innerText = isPrivacyMode
                                ? `₹ •••••• (${sign}${pnlPct.toFixed(2)}%)`
                                : `${sign}₹${Math.abs(pnlAmt).toLocaleString('en-IN', {minimumFractionDigits: 2})} (${sign}${pnlPct.toFixed(2)}%)`;
                        }
                        pfPnlEl.classList.remove('pos', 'neg');
                        pfPnlEl.classList.add(pnlAmt >= 0 ? 'pos' : 'neg');
                    }

                    if (pfDayPctEl) {
                        const daySign = dayChange >= 0 ? '+' : '';
                        pfDayPctEl.innerText = ltp > 0 ? `(${daySign}${dayPnlPct.toFixed(2)}%)` : '(0.00%)';
                        // Keep neutral without pos/neg class so title color var(--text-secondary) applies
                    }

                    if (pfDayLblEl) {
                        pfDayLblEl.innerText = dayPnLAmt >= 0 ? "Today's Gain" : "Today's Loss";
                    }

                    if (pfDayPnlEl) {
                        const sign = dayPnLAmt >= 0 ? '+' : '';
                        if (document.getElementById(`pf-mob-card-${rowKey}`)) {
                            pfDayPnlEl.innerHTML = ltp > 0
                                ? (isPrivacyMode
                                    ? `₹ •••••• <span class="pf-mob-pct-val">(${sign}${dayPnlPct.toFixed(2)}%)</span>`
                                    : `${sign}₹${Math.abs(dayPnLAmt).toLocaleString('en-IN', {minimumFractionDigits: 2})} <span class="pf-mob-pct-val">(${sign}${dayPnlPct.toFixed(2)}%)</span>`)
                                : '';
                        } else {
                            pfDayPnlEl.innerText = ltp > 0
                                ? (isPrivacyMode
                                    ? `₹ •••••• (${sign}${dayPnlPct.toFixed(2)}%)`
                                    : `${sign}₹${Math.abs(dayPnLAmt).toLocaleString('en-IN', {minimumFractionDigits: 2})} (${sign}${dayPnlPct.toFixed(2)}%)`)
                                : '';
                        }
                        pfDayPnlEl.classList.remove('pos', 'neg');
                        pfDayPnlEl.classList.add(dayPnLAmt >= 0 ? 'pos' : 'neg');
                    }
                });

                // Update Summary Header & Footer
                const totPnL = totCurrentVal - totInvested;
                const totPnLPct = totInvested > 0 ? (totPnL / totInvested) * 100 : 0;
                const prevVal = totCurrentVal - totDayPnL;
                const totDayPnLPct = prevVal > 0 ? (totDayPnL / prevVal) * 100 : 0;

                const invStr = formatMoney(totInvested);
                const valStr = formatMoney(totCurrentVal);
                
                const pnlSign = totPnL >= 0 ? '+' : '';
                const pnlStr = isPrivacyMode ? '₹ ••••••' : `${pnlSign}₹${Math.abs(totPnL).toLocaleString('en-IN', {minimumFractionDigits: 2})}`;
                const pnlPctStr = `${pnlSign}${totPnLPct.toFixed(2)}%`;

                const daySign = totDayPnL >= 0 ? '+' : '';
                const dayPnlStr = isPrivacyMode ? '₹ ••••••' : `${daySign}₹${Math.abs(totDayPnL).toLocaleString('en-IN', {minimumFractionDigits: 2})}`;
                const dayPnlPctStr = `${daySign}${totDayPnLPct.toFixed(2)}%`;

                const invCard = document.getElementById('pf-summary-invested');
                const valCard = document.getElementById('pf-summary-value');
                const pnlCard = document.getElementById('pf-summary-pnl');
                const pnlPctCard = document.getElementById('pf-summary-pnl-pct');
                const dayPnlCard = document.getElementById('pf-summary-daypnl');
                const dayPnlPctCard = document.getElementById('pf-summary-daypnl-pct');

                if (invCard) invCard.innerText = invStr;
                if (valCard) valCard.innerText = valStr;
                if (pnlCard) pnlCard.innerText = pnlStr;
                if (pnlPctCard) {
                    pnlPctCard.innerText = pnlPctStr;
                    pnlPctCard.style.color = totPnL >= 0 ? '#27ae60' : '#c0392b';
                }
                if (dayPnlCard) dayPnlCard.innerText = dayPnlStr;
                if (dayPnlPctCard) {
                    dayPnlPctCard.innerText = dayPnlPctStr;
                    dayPnlPctCard.style.color = totDayPnL >= 0 ? '#27ae60' : '#c0392b';
                }

                const footInv = document.getElementById('pf-foot-inv');
                const footVal = document.getElementById('pf-foot-val');
                const footPnl = document.getElementById('pf-foot-pnl');
                const footDayPnl = document.getElementById('pf-foot-daypnl');

                if (footInv) footInv.innerText = invStr;
                if (footVal) footVal.innerText = valStr;
                if (footPnl) {
                    footPnl.innerText = isPrivacyMode ? `₹ •••••• (${pnlPctStr})` : `${pnlStr} (${pnlPctStr})`;
                    footPnl.classList.remove('pos', 'neg');
                    footPnl.classList.add(totPnL >= 0 ? 'pos' : 'neg');
                }
                if (footDayPnl) {
                    footDayPnl.innerText = isPrivacyMode ? `₹ •••••• (${dayPnlPctStr})` : `${dayPnlStr} (${dayPnlPctStr})`;
                    footDayPnl.classList.remove('pos', 'neg');
                    footDayPnl.classList.add(totDayPnL >= 0 ? 'pos' : 'neg');
                }

                // Reorder portfolio rows in DOM according to active pfSortOption (e.g. Day P&L High to Low)
                if (typeof reorderPortfolioTableRows === 'function') {
                    reorderPortfolioTableRows();
                }
            }

            // Check Active Price Alerts
            if (userAlertsData && userAlertsData.alerts) {
                userAlertsData.alerts.forEach(alt => {
                    if (alt.status === 'active') {
                        const stockInfo = stockPricesData[alt.symbol];
                        if (stockInfo && stockInfo.price !== undefined && stockInfo.price > 0) {
                            const curPrice = stockInfo.price;
                            const targetPrice = parseFloat(alt.target_price);
                            let triggered = false;
                            if (alt.condition === 'above' && curPrice >= targetPrice) triggered = true;
                            if (alt.condition === 'below' && curPrice <= targetPrice) triggered = true;

                            if (triggered) {
                                fetch('/api/notifications/trigger', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        alert_id: alt.id,
                                        symbol: alt.symbol,
                                        current_price: curPrice,
                                        target_price: targetPrice,
                                        condition: alt.condition,
                                        note: alt.note || ''
                                    })
                                }).then(r => r.json()).then(data => {
                                    if (data.success) {
                                        userAlertsData = data.alerts_data;
                                        updateNotificationBadge();
                                    }
                                });
                            }
                        }
                    }
                });
            }

            updateHighlightsFromLivePrices();

            if (currentTab === 'dashboard') {
                renderDashboard();
            }

            const badge = document.getElementById('last-updated-badge');
            if (badge) {
                const now = new Date();
                const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                badge.innerHTML = `✅ Updated: ${timeStr}`;
            }
        }

        async function manualRefreshPrices() {
            const btn = document.getElementById('btn-manual-refresh');
            const icon = document.getElementById('refresh-icon');
            const badge = document.getElementById('last-updated-badge');

            if (btn) btn.disabled = true;
            if (icon) icon.classList.add('spinning');
            if (badge) badge.innerHTML = '⏳ Fetching live prices...';

            try {
                await refreshPrices();
            } catch (err) {
                if (badge) badge.innerHTML = '⚠️ Refresh failed';
            } finally {
                if (icon) icon.classList.remove('spinning');
                if (btn) btn.disabled = false;
            }
        }



        // Initialize App Data
        async function initApp() {
            initTheme();
            initPrivacyMode();
            await checkAuthAndLoadUserInfo();
            await fetchAlerts();

            const initialTab = window.INITIAL_TAB || 'watchlists';
            const pathname = window.location.pathname;
            let targetTab = initialTab;

            if (pathname === '/portfolios') targetTab = 'portfolios';
            else if (pathname === '/analytics') targetTab = 'dashboard';
            else if (pathname === '/insights') targetTab = 'insights';
            else if (pathname === '/smallcases') targetTab = 'smallcases';
            else if (pathname === '/mutual-funds' || pathname === '/mutual-funds/dashboard') targetTab = 'mutual-funds';
            else if (pathname === '/ipos') targetTab = 'ipos';
            else if (pathname === '/plan-calculator') targetTab = 'plan-calculator';
            else if (pathname === '/' || pathname === '/watchlists') targetTab = 'watchlists';

            if (targetTab === 'watchlists') {
                await fetchWatchlists();
            } else if (targetTab === 'portfolios') {
                if (typeof fetchPortfolios === 'function') {
                    await fetchPortfolios();
                }
            }

            switchTab(targetTab, false);
        }

        initApp();
        
        // Smart Adaptive Auto-Refresh Market Prices every 30 seconds (pauses when tab is hidden)
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                const modal = document.getElementById('fundamentalsModal');
                if (modal && modal.style.display === 'block') closeFundamentalsModal();
            }
        });

        setInterval(function() {
            if (document.visibilityState !== 'hidden') {
                refreshPrices();
            }
        }, 30000);
