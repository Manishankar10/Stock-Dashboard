        let currentInsightsScope = 'all';
        let currentNewsCategory = 'all';
        let cachedInsightsArticles = [];

        async function setNewsCategory(cat) {
            currentNewsCategory = cat;
            const categories = ['all', 'research', 'corporate', 'macro'];
            categories.forEach(c => {
                const btn = document.getElementById(`cat-pill-${c}`);
                if (btn) btn.className = c === cat ? 'btn-primary' : 'btn-secondary';
            });

            showNewsSkeletonsOnly();
            const stockFilter = document.getElementById('insights-stock-filter')?.value || 'all';
            const stockParam = stockFilter !== 'all' ? `&stock=${encodeURIComponent(stockFilter)}` : '';
            
            try {
                const res = await fetch(`/api/insights/news?scope=${encodeURIComponent(currentInsightsScope)}${stockParam}&category=${encodeURIComponent(cat)}&limit=30`);
                const data = await res.json();
                if (data.success && data.articles) {
                    cachedInsightsArticles = data.articles;
                    filterAndRenderInsightsNews();
                } else {
                    filterAndRenderInsightsNews();
                }
            } catch(e) {
                filterAndRenderInsightsNews();
            }
        }

        function showNewsSkeletonsOnly() {
            const feedEl = document.getElementById('insights-news-feed');
            if (feedEl) {
                let newsSkeletons = '';
                for (let i = 0; i < 4; i++) {
                    newsSkeletons += `
                        <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 10px; box-shadow: var(--shadow-sm);">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="display: flex; gap: 6px; align-items: center;">
                                    <span class="skeleton-box" style="width: 80px; height: 16px;"></span>
                                    <span class="skeleton-box" style="width: 60px; height: 16px;"></span>
                                </div>
                                <span class="skeleton-box" style="width: 70px; height: 12px;"></span>
                            </div>
                            <span class="skeleton-box" style="width: 95%; height: 16px;"></span>
                            <span class="skeleton-box" style="width: 65%; height: 14px;"></span>
                            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-color); padding-top: 8px; margin-top: 4px;">
                                <span class="skeleton-box" style="width: 110px; height: 12px;"></span>
                                <span class="skeleton-box" style="width: 90px; height: 12px;"></span>
                            </div>
                        </div>
                    `;
                }
                feedEl.innerHTML = newsSkeletons;
            }
        }

        function showInsightsSkeletons() {
            // 1. News Feed Skeletons
            showNewsSkeletonsOnly();

            // 2. Market Indexes Grid Skeletons
            const idxGrid = document.getElementById('insights-indexes-grid');
            if (idxGrid) {
                let idxSkeletons = '';
                for (let i = 0; i < 5; i++) {
                    idxSkeletons += `
                        <div style="background: var(--bg-subtle); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px 12px; height: 68px; display: flex; flex-direction: column; justify-content: space-between;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span class="skeleton-box" style="width: 55px; height: 12px;"></span>
                                <span class="skeleton-box" style="width: 32px; height: 12px;"></span>
                            </div>
                            <span class="skeleton-box" style="width: 75px; height: 15px;"></span>
                            <span class="skeleton-box" style="width: 90px; height: 11px;"></span>
                        </div>
                    `;
                }
                idxGrid.innerHTML = idxSkeletons;
            }

            // 3. FII / DII Flow Skeletons
            const fiiMount = document.getElementById('insights-fiidii-mount');
            if (fiiMount) {
                fiiMount.innerHTML = `
                    <div style="background: var(--bg-subtle); padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; height: 34px;">
                        <span class="skeleton-box" style="width: 70px; height: 12px;"></span>
                        <span class="skeleton-box" style="width: 85px; height: 14px;"></span>
                    </div>
                    <div style="background: var(--bg-subtle); padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; height: 34px;">
                        <span class="skeleton-box" style="width: 70px; height: 12px;"></span>
                        <span class="skeleton-box" style="width: 85px; height: 14px;"></span>
                    </div>
                    <div style="background: var(--bg-subtle); padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; height: 34px;">
                        <span class="skeleton-box" style="width: 100px; height: 12px;"></span>
                        <span class="skeleton-box" style="width: 90px; height: 14px;"></span>
                    </div>
                `;
            }

            // 4. Highlights Skeletons
            const gainerSymEl = document.getElementById('insights-top-gainer-sym');
            const gainerValEl = document.getElementById('insights-top-gainer-val');
            if (gainerSymEl) gainerSymEl.innerHTML = '<span class="skeleton-box" style="width: 70px; height: 14px;"></span>';
            if (gainerValEl) gainerValEl.innerHTML = '<span class="skeleton-box" style="width: 90px; height: 12px;"></span>';

            const loserSymEl = document.getElementById('insights-top-loser-sym');
            const loserValEl = document.getElementById('insights-top-loser-val');
            if (loserSymEl) loserSymEl.innerHTML = '<span class="skeleton-box" style="width: 70px; height: 14px;"></span>';
            if (loserValEl) loserValEl.innerHTML = '<span class="skeleton-box" style="width: 90px; height: 12px;"></span>';

            const dayGainEl = document.getElementById('insights-day-gain-val');
            if (dayGainEl) dayGainEl.innerHTML = '<span class="skeleton-box" style="width: 80px; height: 14px;"></span>';

            // 5. Distribution Skeletons
            const distMount = document.getElementById('insights-distribution-mount');
            if (distMount) {
                distMount.innerHTML = `
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span class="skeleton-box" style="width: 80px; height: 12px;"></span>
                                <span class="skeleton-box" style="width: 35px; height: 12px;"></span>
                            </div>
                            <div class="skeleton-box" style="width: 100%; height: 8px;"></div>
                        </div>
                        <div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span class="skeleton-box" style="width: 90px; height: 12px;"></span>
                                <span class="skeleton-box" style="width: 35px; height: 12px;"></span>
                            </div>
                            <div class="skeleton-box" style="width: 100%; height: 8px;"></div>
                        </div>
                    </div>
                `;
            }

            // 6. Investment Thesis Skeleton
            const thesisMount = document.getElementById('insights-thesis-mount');
            if (thesisMount) {
                thesisMount.innerHTML = `
                    <div style="background: var(--bg-subtle); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;">
                        <div style="display: flex; justify-content: space-between;">
                            <span class="skeleton-box" style="width: 70px; height: 13px;"></span>
                            <span class="skeleton-box" style="width: 65px; height: 13px;"></span>
                        </div>
                        <span class="skeleton-box" style="width: 90%; height: 11px;"></span>
                    </div>
                `;
            }
        }

        async function loadInsightsTab(scope = null) {
            const isScopeChange = (scope !== null);
            if (scope) currentInsightsScope = scope;
            
            const btnAll = document.getElementById('insights-scope-all');
            const btnPf = document.getElementById('insights-scope-portfolio');
            const btnWl = document.getElementById('insights-scope-watchlist');

            if (btnAll) btnAll.className = currentInsightsScope === 'all' ? 'btn-primary' : 'btn-secondary';
            if (btnPf) btnPf.className = currentInsightsScope === 'portfolio' ? 'btn-primary' : 'btn-secondary';
            if (btnWl) btnWl.className = currentInsightsScope === 'watchlist' ? 'btn-primary' : 'btn-secondary';

            if (isScopeChange) {
                showNewsSkeletonsOnly();
                populateInsightsStockFilterOptions();
                const feedEl = document.getElementById('insights-news-feed');
                fetch(`/api/insights/news?scope=${encodeURIComponent(currentInsightsScope)}`)
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            cachedInsightsArticles = data.articles || [];
                            populateInsightsStockFilterOptions();
                            filterAndRenderInsightsNews();
                        } else if (feedEl) {
                            feedEl.innerHTML = `<div style="padding: 20px; color: #ef4444;">Error loading news: ${data.error}</div>`;
                        }
                    })
                    .catch(err => {
                        if (feedEl) {
                            feedEl.innerHTML = `<div style="padding: 20px; color: #ef4444;">Failed to load insights feed: ${err.message}</div>`;
                        }
                    });
                return;
            }

            showInsightsSkeletons();

            // 1. Parallel Fetch: Highlights, Distribution & Thesis Summary (~100ms)
            const pfParam = activePortfolioName ? `?portfolio=${encodeURIComponent(activePortfolioName)}` : '';
            fetch(`/api/insights/summary${pfParam}`)
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        renderInsightsSummaryUI(data);
                    }
                })
                .catch(err => console.error('Error loading insights summary:', err));

            // 2. Parallel Fetch: Market Indexes Grid (~300ms)
            fetch('/api/insights/indexes')
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        renderInsightsIndexesUI(data.market_indexes || []);
                    }
                })
                .catch(err => console.error('Error loading market indexes:', err));

            // 3. Parallel Fetch: FII / DII Flow (~300ms)
            fetch('/api/insights/fiidii')
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        renderInsightsFiiDiiUI(data.fii_dii);
                    }
                })
                .catch(err => console.error('Error loading FII/DII data:', err));

            // 4. Parallel Fetch: News Articles Feed (~400ms)
            const feedEl = document.getElementById('insights-news-feed');
            const loadMoreContainer = document.getElementById('insights-load-more-container');
            fetch(`/api/insights/news?scope=${encodeURIComponent(currentInsightsScope)}&limit=30`)
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        cachedInsightsArticles = data.articles || [];
                        populateInsightsStockFilterOptions();
                        filterAndRenderInsightsNews();
                        if (loadMoreContainer) {
                            loadMoreContainer.style.display = 'block';
                        }
                    } else if (feedEl) {
                        feedEl.innerHTML = `<div style="padding: 20px; color: #ef4444;">Error loading news: ${data.error}</div>`;
                    }
                })
            // 5. Parallel Fetch: Technical Intelligence Screeners (~400ms)
            loadTechnicalInsights();
        }

        // =========================================================
        // TECHNICAL SIGNALS & STOCK SCREENERS JS
        // =========================================================
        let activeScreenerId = 'golden_cross';
        let technicalsData = null;

        function toggleTechnicalScreenerAccordion() {
            const body = document.getElementById('technicals-accordion-body');
            const icon = document.getElementById('technicals-accordion-icon');
            const label = document.getElementById('technicals-accordion-label');

            if (!body) return;

            if (body.style.display === 'none') {
                body.style.display = 'block';
                if (icon) icon.textContent = '▲';
                if (label) label.textContent = 'Collapse';
            } else {
                body.style.display = 'none';
                if (icon) icon.textContent = '▼';
                if (label) label.textContent = 'Expand';
            }
        }

        async function loadTechnicalInsights(forceRefresh = false) {
            const pillsContainer = document.getElementById('technical-screener-pills');
            const tableBody = document.getElementById('technical-screener-table-body');
            const scannedCountEl = document.getElementById('technicals-scanned-count');

            if (!pillsContainer || !tableBody) return;

            if (forceRefresh) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; padding: 30px; color: var(--text-secondary);">
                            <span class="spinning" style="display: inline-block; font-size: 20px; margin-bottom: 8px;">⏳</span><br>
                            Rescanning live technical signals...
                        </td>
                    </tr>
                `;
            }

            try {
                const response = await fetch('/api/insights/technicals');
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const data = await response.json();
                if (data.success && data.scanners) {
                    technicalsData = data;
                    if (scannedCountEl) scannedCountEl.textContent = `(Scanned ${data.total_scanned || 0} stocks)`;
                    renderTechnicalScreenerPills();
                    renderTechnicalScreenerTable();
                } else {
                    tableBody.innerHTML = `
                        <tr>
                            <td colspan="5" style="text-align: center; padding: 20px; color: var(--text-secondary);">
                                ⚠️ Unable to load technical signals. ${escapeHtml(data.error || '')} <button class="btn-secondary" style="font-size: 11px; padding: 3px 10px; margin-left: 8px;" onclick="loadTechnicalInsights(true)">Retry</button>
                            </td>
                        </tr>
                    `;
                }
            } catch (err) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; padding: 20px; color: #ef4444;">
                            ⚠️ Technical scanner is updating (${escapeHtml(err.message || 'Network error')}). <button class="btn-secondary" style="font-size: 11px; padding: 3px 10px; margin-left: 8px;" onclick="loadTechnicalInsights(true)">🔄 Retry Scan</button>
                        </td>
                    </tr>
                `;
            }
        }

        function selectTechnicalScreener(screenerId) {
            activeScreenerId = screenerId;
            renderTechnicalScreenerPills();
            renderTechnicalScreenerTable();
        }

        function renderTechnicalScreenerPills() {
            const container = document.getElementById('technical-screener-pills');
            if (!container || !technicalsData || !technicalsData.scanners) return;

            const keys = ['golden_cross', 'supertrend_buy', 'rsi_momentum', 'ema_bull_cross', 'high_52w', 'volume_surge', 'rsi_oversold', 'triple_confluence', 'death_cross'];
            let html = '';

            keys.forEach(key => {
                const scanner = technicalsData.scanners[key];
                if (!scanner) return;
                const isActive = key === activeScreenerId;
                const btnClass = isActive ? 'btn-primary' : 'btn-secondary';
                const activeStyle = isActive ? 'background: var(--accent-color); color: #fff; border-color: var(--accent-color);' : '';

                html += `
                    <button type="button" class="${btnClass}" onclick="selectTechnicalScreener('${key}')" style="font-size: 11.5px; padding: 5px 12px; border-radius: 6px; display: flex; align-items: center; gap: 6px; ${activeStyle}">
                        ${scanner.title}
                        <span style="font-size: 10px; font-weight: 700; background: ${isActive ? 'rgba(255,255,255,0.25)' : 'var(--bg-card)'}; color: ${isActive ? '#fff' : 'var(--text-primary)'}; padding: 1px 6px; border-radius: 8px;">
                            ${scanner.count || 0}
                        </span>
                    </button>
                `;
            });

            container.innerHTML = html;
        }

        function renderTechnicalScreenerTable() {
            const tableBody = document.getElementById('technical-screener-table-body');
            const titleEl = document.getElementById('screener-meta-title');
            const descEl = document.getElementById('screener-meta-desc');
            const countEl = document.getElementById('screener-meta-count');

            if (!tableBody || !technicalsData || !technicalsData.scanners) return;

            const scanner = technicalsData.scanners[activeScreenerId];
            if (!scanner) return;

            if (titleEl) titleEl.textContent = scanner.title;
            if (descEl) descEl.textContent = scanner.description;
            if (countEl) countEl.textContent = `${scanner.count || 0} Stocks`;

            const stocks = scanner.stocks || [];
            if (stocks.length === 0) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; padding: 35px; color: var(--text-secondary);">
                            🔍 No stocks currently meet the criteria for <strong>${escapeHtml(scanner.title)}</strong> in tracked symbols.
                        </td>
                    </tr>
                `;
                return;
            }

            let rowsHtml = '';
            stocks.forEach(stock => {
                const displaySym = cleanDisplaySymbol(stock.symbol);
                const exchangeClass = stock.symbol.endsWith('.BO') ? 'badge-bse' : 'badge-nse';
                const exchangeLabel = stock.symbol.endsWith('.BO') ? 'BSE' : 'NSE';
                
                const isPos = stock.change_pct >= 0;
                const changeClass = isPos ? 'profit' : 'loss';
                const changeSign = isPos ? '+' : '';

                rowsHtml += `
                    <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="padding: 10px 12px;">
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <span class="stock-symbol" style="font-weight: 700; font-size: 13px;">${escapeHtml(displaySym)}</span>
                                <span class="badge ${exchangeClass}" style="font-size: 9.5px; padding: 1px 4px;">${exchangeLabel}</span>
                            </div>
                            <div style="font-size: 11px; color: var(--text-secondary); max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                ${escapeHtml(stock.name)}
                            </div>
                        </td>
                        <td style="text-align: right; padding: 10px 12px; font-weight: 700; font-size: 13px;">
                            ₹${stock.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td style="text-align: right; padding: 10px 12px; font-weight: 700; font-size: 12.5px;" class="${changeClass}">
                            ${changeSign}${stock.change_pct}%
                        </td>
                        <td style="padding: 10px 12px; font-size: 12px; font-weight: 600; color: var(--text-primary);">
                            <span style="background: var(--bg-subtle); padding: 3px 8px; border-radius: 6px; border: 1px solid var(--border-color); display: inline-block;">
                                ${escapeHtml(stock.metric)}
                            </span>
                        </td>
                        <td style="text-align: center; padding: 10px 12px;">
                            <div style="display: flex; gap: 6px; justify-content: center;">
                                <button class="btn-secondary" style="font-size: 11px; padding: 3px 8px; border-radius: 4px;" onclick="openChart('${escapeHtml(stock.symbol)}')" title="View Chart">
                                    📊 Chart
                                </button>
                                <button class="btn-secondary" style="font-size: 11px; padding: 3px 8px; border-radius: 4px;" onclick="openFundamentalsModal('${escapeHtml(stock.symbol)}')" title="View Fundamentals">
                                    📈 Fundamentals
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            });

            tableBody.innerHTML = rowsHtml;
        }

        function updateHighlightsFromLivePrices() {
            if (!portfoliosData || !stockPricesData) return;

            let allActiveHoldings = [];
            let seenSymbols = new Set();
            let totalDayGain = 0;
            let hasAnyLiveData = false;

            Object.values(portfoliosData).forEach(holdings => {
                (holdings || []).forEach(h => {
                    const sym = h.symbol;
                    const qty = parseFloat(h.quantity || 0);
                    if (sym && qty > 0) {
                        const info = stockPricesData[sym];
                        if (info && info.price !== undefined && !info.error) {
                            hasAnyLiveData = true;
                            const ltp = info.price;
                            const changeAmt = info.change !== undefined ? info.change : 0;
                            const changePct = info.change_pct !== undefined ? info.change_pct : 0;

                            totalDayGain += (changeAmt * qty);

                            if (!seenSymbols.has(sym)) {
                                seenSymbols.add(sym);
                                allActiveHoldings.push({
                                    symbol: sym,
                                    name: info.name || sym,
                                    ltp: ltp,
                                    change_amt: changeAmt,
                                    change_pct: changePct,
                                    qty: qty
                                });
                            }
                        }
                    }
                });
            });

            const gainerSymEl = document.getElementById('insights-top-gainer-sym');
            const gainerValEl = document.getElementById('insights-top-gainer-val');
            const loserLabelEl = document.getElementById('insights-top-loser-label');
            const loserSymEl = document.getElementById('insights-top-loser-sym');
            const loserValEl = document.getElementById('insights-top-loser-val');
            const dayGainEl = document.getElementById('insights-day-gain-val');

            if (!hasAnyLiveData) return;

            if (allActiveHoldings.length === 0) {
                if (gainerSymEl) { gainerSymEl.innerText = 'N/A'; gainerSymEl.style.color = 'var(--text-secondary)'; if (gainerValEl) { gainerValEl.innerText = '-'; gainerValEl.style.color = 'var(--text-secondary)'; } }
                if (loserSymEl) { loserSymEl.innerText = 'N/A'; loserSymEl.style.color = 'var(--text-secondary)'; if (loserValEl) { loserValEl.innerText = '-'; loserValEl.style.color = 'var(--text-secondary)'; } }
                if (dayGainEl) { dayGainEl.innerText = '₹0.00'; dayGainEl.style.color = '#10b981'; }
                return;
            }

            allActiveHoldings.sort((a, b) => b.change_pct - a.change_pct);

            const topGainer = allActiveHoldings[0];
            const topLoser = allActiveHoldings.length > 1 ? allActiveHoldings[allActiveHoldings.length - 1] : null;

            if (gainerSymEl && topGainer) {
                gainerSymEl.innerText = topGainer.symbol;
                const sign = topGainer.change_pct >= 0 ? '+' : '';
                gainerValEl.innerText = `${sign}${topGainer.change_pct.toFixed(2)}% (₹${topGainer.ltp.toLocaleString('en-IN', {minimumFractionDigits: 2})})`;
                const color = topGainer.change_pct >= 0 ? '#10b981' : '#ef4444';
                gainerSymEl.style.color = color;
                gainerValEl.style.color = color;
            }

            if (loserSymEl && topLoser) {
                loserSymEl.innerText = topLoser.symbol;
                const sign = topLoser.change_pct >= 0 ? '+' : '';
                loserValEl.innerText = `${sign}${topLoser.change_pct.toFixed(2)}% (₹${topLoser.ltp.toLocaleString('en-IN', {minimumFractionDigits: 2})})`;
                const color = topLoser.change_pct >= 0 ? '#10b981' : '#ef4444';
                loserSymEl.style.color = color;
                loserValEl.style.color = color;

                if (loserLabelEl) {
                    loserLabelEl.innerText = topLoser.change_pct < 0 ? 'Largest Lag' : 'Lowest Gain';
                }
            } else if (loserSymEl) {
                loserSymEl.innerText = 'N/A';
                loserSymEl.style.color = 'var(--text-secondary)';
                if (loserValEl) { loserValEl.innerText = '-'; loserValEl.style.color = 'var(--text-secondary)'; }
                if (loserLabelEl) loserLabelEl.innerText = 'Largest Lag';
            }

            if (dayGainEl) {
                const sign = totalDayGain >= 0 ? '+' : '';
                dayGainEl.innerText = isPrivacyMode ? `₹ ••••••` : `${sign}₹${Math.abs(totalDayGain).toLocaleString('en-IN', {minimumFractionDigits: 2})}`;
                dayGainEl.style.color = totalDayGain >= 0 ? '#10b981' : '#ef4444';
            }
        }

        function renderInsightsSummaryUI(data) {
            updateHighlightsFromLivePrices();
            const m = data.metrics || {};
            const gainer = m.top_gainer;
            const loser = m.top_loser;

            const gainerSymEl = document.getElementById('insights-top-gainer-sym');
            const gainerValEl = document.getElementById('insights-top-gainer-val');
            if (gainerSymEl && gainer) {
                gainerSymEl.innerText = gainer.symbol;
                const sign = gainer.change_pct >= 0 ? '+' : '';
                gainerValEl.innerText = `${sign}${gainer.change_pct.toFixed(2)}% (₹${gainer.ltp.toLocaleString('en-IN', {minimumFractionDigits: 2})})`;
                const color = gainer.change_pct >= 0 ? '#10b981' : '#ef4444';
                gainerSymEl.style.color = color;
                gainerValEl.style.color = color;
            } else if (gainerSymEl) {
                gainerSymEl.innerText = 'N/A';
                gainerSymEl.style.color = 'var(--text-secondary)';
                gainerValEl.innerText = '-';
                gainerValEl.style.color = 'var(--text-secondary)';
            }

            const loserLabelEl = document.getElementById('insights-top-loser-label');
            const loserSymEl = document.getElementById('insights-top-loser-sym');
            const loserValEl = document.getElementById('insights-top-loser-val');
            if (loserSymEl && loser) {
                loserSymEl.innerText = loser.symbol;
                const sign = loser.change_pct >= 0 ? '+' : '';
                loserValEl.innerText = `${sign}${loser.change_pct.toFixed(2)}% (₹${loser.ltp.toLocaleString('en-IN', {minimumFractionDigits: 2})})`;
                const color = loser.change_pct >= 0 ? '#10b981' : '#ef4444';
                loserSymEl.style.color = color;
                loserValEl.style.color = color;
                if (loserLabelEl) {
                    loserLabelEl.innerText = loser.change_pct < 0 ? 'Largest Lag' : 'Lowest Gain';
                }
            } else if (loserSymEl) {
                loserSymEl.innerText = 'N/A';
                loserSymEl.style.color = 'var(--text-secondary)';
                loserValEl.innerText = '-';
                loserValEl.style.color = 'var(--text-secondary)';
                if (loserLabelEl) loserLabelEl.innerText = 'Largest Lag';
            }

            const dayGainEl = document.getElementById('insights-day-gain-val');
            if (dayGainEl) {
                const dg = m.day_pnl_amt || 0;
                const sign = dg >= 0 ? '+' : '';
                dayGainEl.innerText = isPrivacyMode ? `₹ ••••••` : `${sign}₹${Math.abs(dg).toLocaleString('en-IN', {minimumFractionDigits:2})}`;
                dayGainEl.style.color = dg >= 0 ? '#10b981' : '#ef4444';
            }

            const distMount = document.getElementById('insights-distribution-mount');
            if (distMount && data.distribution) {
                const dist = data.distribution;
                distMount.innerHTML = `
                    <div>
                        <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">
                            <span>📈 Equities (${dist.equities.count})</span>
                            <span>${dist.equities.pct}%</span>
                        </div>
                        <div style="width: 100%; background: var(--bg-subtle); height: 8px; border-radius: 4px; overflow: hidden;">
                            <div style="width: ${dist.equities.pct}%; background: #10b981; height: 100%;"></div>
                        </div>
                    </div>
                    <div>
                        <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">
                            <span>📊 Market Indices (${dist.indices.count})</span>
                            <span>${dist.indices.pct}%</span>
                        </div>
                        <div style="width: 100%; background: var(--bg-subtle); height: 8px; border-radius: 4px; overflow: hidden;">
                            <div style="width: ${dist.indices.pct}%; background: #06b6d4; height: 100%;"></div>
                        </div>
                    </div>
                    <div>
                        <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">
                            <span>🪙 Commodities & Gold (${dist.commodities.count})</span>
                            <span>${dist.commodities.pct}%</span>
                        </div>
                        <div style="width: 100%; background: var(--bg-subtle); height: 8px; border-radius: 4px; overflow: hidden;">
                            <div style="width: ${dist.commodities.pct}%; background: #f59e0b; height: 100%;"></div>
                        </div>
                    </div>
                `;
            }

            const thesisMount = document.getElementById('insights-thesis-mount');
            const thesisCountEl = document.getElementById('insights-thesis-count');
            const theses = data.theses || [];
            if (thesisCountEl) thesisCountEl.innerText = `${theses.length} Active Notes`;

            if (thesisMount) {
                if (theses.length === 0) {
                    thesisMount.innerHTML = `<div style="font-size: 12px; color: var(--text-secondary); text-align: center; padding: 15px;">No buy reasons added yet. Edit a holding to record your investment thesis!</div>`;
                } else {
                    thesisMount.innerHTML = '';
                    theses.forEach(t => {
                        const item = document.createElement('div');
                        item.style.cssText = `
                            background: var(--bg-subtle);
                            border: 1px solid var(--border-color);
                            border-radius: 8px;
                            padding: 10px 12px;
                            font-size: 12px;
                        `;
                        const pnlSign = t.pnl_pct >= 0 ? '+' : '';
                        const pnlColor = t.pnl_pct >= 0 ? '#10b981' : '#ef4444';

                        item.innerHTML = `
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                <strong style="color: var(--text-primary); font-size: 13px;">${escapeHtml(t.symbol)}</strong>
                                <span style="color: ${pnlColor}; font-weight: 700;">${pnlSign}${t.pnl_pct}% Return</span>
                            </div>
                            <div style="color: var(--text-secondary); font-style: italic; font-size: 11px;">"${escapeHtml(t.buy_reason)}"</div>
                        `;
                        thesisMount.appendChild(item);
                    });
                }
            }
        }

        function renderInsightsIndexesUI(marketIndexes) {
            const idxGrid = document.getElementById('insights-indexes-grid');
            if (!idxGrid) return;
            idxGrid.innerHTML = '';
            if (marketIndexes.length === 0) {
                idxGrid.innerHTML = '<span style="font-size:12px; color:var(--text-secondary);">No indexes available</span>';
                return;
            }
            marketIndexes.forEach(idx => {
                const isPos = idx.change >= 0;
                const sign = isPos ? '+' : '';
                const colorClass = isPos ? '#10b981' : '#ef4444';
                const card = document.createElement('div');
                card.style.cssText = `
                    background: var(--bg-subtle);
                    border: 1px solid var(--border-color);
                    border-radius: 8px;
                    padding: 10px 12px;
                    display: flex;
                    flex-direction: column;
                    justify-content: space-between;
                    cursor: pointer;
                    transition: transform 0.15s ease, border-color 0.15s ease;
                `;
                card.onclick = () => openInHouseChart(idx.symbol);
                card.title = `Click to view technical chart for ${idx.name}`;
                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span style="font-weight: 700; font-size: 12px; color: var(--text-primary);">${escapeHtml(idx.badge || idx.name)}</span>
                        <span class="badge badge-idx" style="font-size: 9px; padding: 1px 5px;">INDEX</span>
                    </div>
                    <div style="font-weight: 800; font-size: 14px; color: var(--text-primary);">₹${idx.price ? idx.price.toLocaleString('en-IN', {minimumFractionDigits: 2}) : '-'}</div>
                    <div style="font-size: 11px; font-weight: 600; color: ${colorClass}; margin-top: 2px;">
                        ${sign}${idx.change_pct}% (${sign}₹${Math.abs(idx.change).toFixed(2)})
                    </div>
                `;
                idxGrid.appendChild(card);
            });
        }

        function renderInsightsFiiDiiUI(fd) {
            const fiiMount = document.getElementById('insights-fiidii-mount');
            const fiiDateTag = document.getElementById('fiidii-date-tag');
            if (!fiiMount || !fd) return;

            if (fiiDateTag && fd.date) fiiDateTag.innerText = window.formatAppDate ? window.formatAppDate(fd.date) : fd.date;

            const fiiPos = fd.fii_net >= 0;
            const diiPos = fd.dii_net >= 0;
            const totPos = fd.total_net >= 0;

            const fiiSign = fiiPos ? '+' : '-';
            const diiSign = diiPos ? '+' : '-';
            const totSign = totPos ? '+' : '-';

            fiiMount.innerHTML = `
                <div style="background: var(--bg-subtle); padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span style="font-size: 11px; font-weight: 700; color: var(--text-secondary);">FII Flow</span>
                        <span style="font-size: 9.5px; padding: 1px 6px; border-radius: 4px; font-weight: 700; margin-left: 6px; ${fiiPos ? 'background: rgba(16,185,129,0.15); color: #10b981;' : 'background: rgba(239,68,68,0.15); color: #ef4444;'}">${fd.fii_action || (fiiPos ? 'BUY' : 'SELL')}</span>
                    </div>
                    <span style="font-size: 13px; font-weight: 700; color: ${fiiPos ? '#10b981' : '#ef4444'};">${fiiSign}₹${Math.abs(fd.fii_net).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})} Cr</span>
                </div>
                <div style="background: var(--bg-subtle); padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span style="font-size: 11px; font-weight: 700; color: var(--text-secondary);">DII Flow</span>
                        <span style="font-size: 9.5px; padding: 1px 6px; border-radius: 4px; font-weight: 700; margin-left: 6px; ${diiPos ? 'background: rgba(16,185,129,0.15); color: #10b981;' : 'background: rgba(239,68,68,0.15); color: #ef4444;'}">${fd.dii_action || (diiPos ? 'BUY' : 'SELL')}</span>
                    </div>
                    <span style="font-size: 13px; font-weight: 700; color: ${diiPos ? '#10b981' : '#ef4444'};">${diiSign}₹${Math.abs(fd.dii_net).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})} Cr</span>
                </div>
                <div style="background: ${totPos ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'}; border: 1px solid ${totPos ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}; padding: 8px 10px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 11.5px; color: var(--text-primary); font-weight: 700;">Net Institutional:</span>
                    <span style="font-size: 13px; font-weight: 800; color: ${totPos ? '#10b981' : '#ef4444'};">${totSign}₹${Math.abs(fd.total_net).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})} Cr</span>
                </div>
            `;
        }

        function isPortfolioSymbol(sym) {
            if (!sym || sym === 'MARKET' || sym === 'GENERAL') return false;
            for (const holdings of Object.values(portfoliosData || {})) {
                if (holdings.some(h => h.symbol === sym)) return true;
            }
            return false;
        }

        function isWatchlistSymbol(sym) {
            if (!sym || sym === 'MARKET' || sym === 'GENERAL') return false;
            for (const list of Object.values(watchlistsData || {})) {
                if (list.includes(sym)) return true;
            }
            return false;
        }

        function populateInsightsStockFilterOptions() {
            const selectEl = document.getElementById('insights-stock-filter');
            if (!selectEl) return;

            const selectedVal = selectEl.value || 'all';
            const symbols = new Set();

            if (currentInsightsScope === 'portfolio') {
                for (const holdings of Object.values(portfoliosData || {})) {
                    holdings.forEach(h => symbols.add(h.symbol));
                }
                (cachedInsightsArticles || []).forEach(art => {
                    if (art.symbol && isPortfolioSymbol(art.symbol)) {
                        symbols.add(art.symbol);
                    }
                });
            } else if (currentInsightsScope === 'watchlist') {
                for (const wlSymbols of Object.values(watchlistsData || {})) {
                    wlSymbols.forEach(s => symbols.add(s));
                }
                (cachedInsightsArticles || []).forEach(art => {
                    if (art.symbol && isWatchlistSymbol(art.symbol)) {
                        symbols.add(art.symbol);
                    }
                });
            } else {
                for (const wlSymbols of Object.values(watchlistsData || {})) {
                    wlSymbols.forEach(s => symbols.add(s));
                }
                for (const holdings of Object.values(portfoliosData || {})) {
                    holdings.forEach(h => symbols.add(h.symbol));
                }
                (cachedInsightsArticles || []).forEach(art => {
                    if (art.symbol && art.symbol !== 'MARKET' && art.symbol !== 'GENERAL') {
                        symbols.add(art.symbol);
                    }
                });
            }

            const sortedSymbols = Array.from(symbols).sort();

            selectEl.innerHTML = '<option value="all">All Stocks</option>';
            let foundSelected = false;
            sortedSymbols.forEach(sym => {
                const opt = document.createElement('option');
                opt.value = sym;
                opt.innerText = sym;
                if (sym === selectedVal) {
                    opt.selected = true;
                    foundSelected = true;
                }
                selectEl.appendChild(opt);
            });

            if (!foundSelected) {
                selectEl.value = 'all';
            }
        }

        function filterAndRenderInsightsNews() {
            const feedEl = document.getElementById('insights-news-feed');
            const countEl = document.getElementById('insights-news-count');
            const stockFilter = document.getElementById('insights-stock-filter')?.value || 'all';
            const dateSort = document.getElementById('insights-date-sort')?.value || 'date_desc';

            if (!feedEl) return;

            let articles = cachedInsightsArticles.slice();

            // Scope Strict Filtering
            if (currentInsightsScope === 'portfolio') {
                articles = articles.filter(art => art.tag_type === 'PORTFOLIO' || isPortfolioSymbol(art.symbol));
            } else if (currentInsightsScope === 'watchlist') {
                articles = articles.filter(art => art.tag_type === 'WATCHLIST' || isWatchlistSymbol(art.symbol));
            }

            // Single Stock Specific Filter
            if (stockFilter !== 'all') {
                articles = articles.filter(art => art.symbol === stockFilter);
            }

            articles.sort((a, b) => {
                const timeA = a.pub_date ? new Date(a.pub_date).getTime() : 0;
                const timeB = b.pub_date ? new Date(b.pub_date).getTime() : 0;
                if (dateSort === 'date_asc') {
                    return timeA - timeB;
                } else {
                    return timeB - timeA;
                }
            });

            if (countEl) {
                const scopeName = currentInsightsScope === 'portfolio' ? 'Portfolio' : (currentInsightsScope === 'watchlist' ? 'Watchlist' : 'All Market');
                const catLabel = currentNewsCategory !== 'all' ? ` • ${currentNewsCategory.toUpperCase()}` : '';
                const filterLabel = stockFilter !== 'all' ? ` (${stockFilter}${catLabel})` : ` (${scopeName}${catLabel})`;
                countEl.innerText = `${articles.length} stories found${filterLabel}`;
            }

            if (articles.length === 0) {
                const scopeTitle = currentInsightsScope === 'portfolio' ? 'your portfolio holdings' : (currentInsightsScope === 'watchlist' ? 'your watchlist stocks' : 'the market');
                const emptyMsg = stockFilter !== 'all' 
                    ? `No news articles found matching stock ${escapeHtml(stockFilter)} (${currentNewsCategory.toUpperCase()}).`
                    : `No news articles found for ${scopeTitle} (${currentNewsCategory.toUpperCase()}).`;
                feedEl.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: var(--text-secondary); background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-color);">
                        📰 ${emptyMsg}
                    </div>
                `;
                return;
            }

            feedEl.innerHTML = '';
            articles.forEach(art => {
                const card = document.createElement('div');
                card.style.cssText = `
                    background: var(--bg-card);
                    border: 1px solid var(--border-color);
                    border-radius: 12px;
                    padding: 16px;
                    box-shadow: var(--shadow-sm);
                    transition: transform 0.15s ease, border-color 0.15s ease;
                `;
                
                let timeStr = art.pub_date || '';
                if (art.pub_date) {
                    timeStr = window.formatAppDateTime ? window.formatAppDateTime(art.pub_date) : art.pub_date;
                }

                const tagBadgeClass = art.tag_type === 'PORTFOLIO' ? 'badge-nse' : (art.tag_type === 'WATCHLIST' ? 'badge-bse' : 'badge-idx');

                let catBadge = '';
                if (art.category === 'RESEARCH') {
                    catBadge = '<span class="badge" style="background: rgba(168,85,247,0.15); color: #a855f7; border: 1px solid rgba(168,85,247,0.3); font-size: 10px;">📊 RESEARCH</span>';
                } else if (art.category === 'EARNINGS') {
                    catBadge = '<span class="badge" style="background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3); font-size: 10px;">📢 EARNINGS</span>';
                } else if (art.category === 'MACRO') {
                    catBadge = '<span class="badge" style="background: rgba(6,182,212,0.15); color: #06b6d4; border: 1px solid rgba(6,182,212,0.3); font-size: 10px;">💡 MACRO</span>';
                }

                card.style.cursor = 'pointer';
                card.onclick = (e) => {
                    if (!e.target.closest('a')) {
                        window.open(art.link, '_blank', 'noopener,noreferrer');
                    }
                };

                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <span class="stock-symbol" style="font-size: 12.5px;">${escapeHtml(cleanDisplaySymbol(art.symbol))}</span>
                            <span class="badge ${tagBadgeClass}" style="font-size: 10px;">${art.tag_type}</span>
                            ${catBadge}
                        </div>
                        <span style="font-size: 11px; color: var(--text-secondary);">🕒 ${timeStr}</span>
                    </div>
                    <a href="${art.link}" target="_blank" rel="noopener noreferrer" style="font-weight: 600; font-size: 14px; color: var(--text-primary); text-decoration: none; line-height: 1.4; display: block; margin-bottom: 8px;" onmouseover="this.style.color='#10b981'" onmouseout="this.style.color='var(--text-primary)'">
                        ${escapeHtml(art.title)} ↗
                    </a>
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-secondary); border-top: 1px solid var(--border-color); padding-top: 8px; margin-top: 6px;">
                        <span>🏢 ${escapeHtml(art.publisher)}</span>
                        <a href="${art.link}" target="_blank" rel="noopener noreferrer" style="color: #10b981; font-weight: 600; text-decoration: none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">Read full story →</a>
                    </div>
                `;
                feedEl.appendChild(card);
            });
        }

        async function handleInsightsStockFilterChange() {
            const stockFilter = document.getElementById('insights-stock-filter')?.value || 'all';
            const feedEl = document.getElementById('insights-news-feed');
            const loadMoreContainer = document.getElementById('insights-load-more-container');

            if (stockFilter !== 'all') {
                if (feedEl) {
                    feedEl.innerHTML = `
                        <div style="text-align: center; padding: 30px; color: var(--text-secondary); background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-color);">
                            <span class="spinning" style="display: inline-block; font-size: 20px; margin-bottom: 8px;">⏳</span><br>
                            Fetching dedicated live news stories for <strong>${escapeHtml(stockFilter)}</strong>...
                        </div>
                    `;
                }
                try {
                    const res = await fetch(`/api/insights/news?scope=${encodeURIComponent(currentInsightsScope)}&stock=${encodeURIComponent(stockFilter)}&category=${encodeURIComponent(currentNewsCategory)}&limit=50`);
                    const data = await res.json();
                    if (data.success && data.articles) {
                        cachedInsightsArticles = data.articles;
                        filterAndRenderInsightsNews();
                    } else {
                        filterAndRenderInsightsNews();
                    }
                } catch(e) {
                    filterAndRenderInsightsNews();
                }
            } else {
                try {
                    const res = await fetch(`/api/insights/news?scope=${encodeURIComponent(currentInsightsScope)}&category=${encodeURIComponent(currentNewsCategory)}&limit=30`);
                    const data = await res.json();
                    if (data.success && data.articles) {
                        cachedInsightsArticles = data.articles;
                        filterAndRenderInsightsNews();
                    }
                } catch(e) {
                    filterAndRenderInsightsNews();
                }
            }

            if (loadMoreContainer) {
                loadMoreContainer.style.display = 'block';
            }
        }

        async function loadMoreInsightsNews() {
            const btn = document.getElementById('btn-load-more-news');
            const stockFilter = document.getElementById('insights-stock-filter')?.value || 'all';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '⏳ Fetching More Stories...';
            }

            try {
                const stockParam = stockFilter !== 'all' ? `&stock=${encodeURIComponent(stockFilter)}` : '';
                const res = await fetch(`/api/insights/news?scope=${encodeURIComponent(currentInsightsScope)}${stockParam}&category=${encodeURIComponent(currentNewsCategory)}&limit=100`);
                const data = await res.json();
                if (data.success && data.articles) {
                    const existingTitles = new Set(cachedInsightsArticles.map(a => a.title));
                    let addedCount = 0;
                    data.articles.forEach(art => {
                        if (!existingTitles.has(art.title)) {
                            cachedInsightsArticles.push(art);
                            existingTitles.add(art.title);
                            addedCount++;
                        }
                    });
                    populateInsightsStockFilterOptions();
                    filterAndRenderInsightsNews();

                    if (btn) {
                        if (addedCount > 0) {
                            btn.innerHTML = `✅ Added ${addedCount} More Stories (Total: ${cachedInsightsArticles.length})`;
                            setTimeout(() => {
                                btn.disabled = false;
                                btn.innerHTML = '📥 Load More News Stories';
                            }, 2500);
                        } else {
                            btn.innerHTML = '✨ All Latest News Loaded';
                            setTimeout(() => {
                                btn.disabled = false;
                                btn.innerHTML = '📥 Load More News Stories';
                            }, 2500);
                        }
                    }
                }
            } catch(e) {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '⚠️ Failed to Load - Try Again';
                }
            }
        }
