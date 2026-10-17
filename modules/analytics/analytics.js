        // DASHBOARD & ANALYTICS CHARTS (CHART.JS)
        // =========================================================
        let chartAlloc = null;
        let chartVs = null;
        let chartTop = null;

        function renderDashboard() {
            let overallInvested = 0;
            let overallCurrentVal = 0;
            let overallDayPnL = 0;

            let portfolioSummaries = [];
            let allHoldingsList = [];

            for (const [pfName, holdings] of Object.entries(portfoliosData || {})) {
                let pfInv = 0;
                let pfVal = 0;
                let pfDayPnL = 0;

                holdings.forEach(h => {
                    const info = stockPricesData[h.symbol] || {};
                    const ltp = info.price || 0;
                    const dayChange = info.change || 0;

                    const invAmt = h.buy_price * h.quantity;
                    const curVal = ltp > 0 ? (ltp * h.quantity) : invAmt;
                    const pnlAmt = curVal - invAmt;
                    const pnlPct = invAmt > 0 ? (pnlAmt / invAmt) * 100 : 0;
                    const dayPnLAmt = ltp > 0 ? dayChange * h.quantity : 0;

                    pfInv += invAmt;
                    pfVal += curVal;
                    pfDayPnL += dayPnLAmt;

                    allHoldingsList.push({
                        symbol: h.symbol,
                        name: info.name || h.symbol,
                        pnlPct: pnlPct,
                        currentVal: curVal,
                        pfName: pfName
                    });
                });

                overallInvested += pfInv;
                overallCurrentVal += pfVal;
                overallDayPnL += pfDayPnL;

                portfolioSummaries.push({
                    name: pfName,
                    invested: pfInv,
                    value: pfVal,
                    pnl: pfVal - pfInv,
                    pnlPct: pfInv > 0 ? ((pfVal - pfInv) / pfInv) * 100 : 0
                });
            }

            const overallPnL = overallCurrentVal - overallInvested;
            const overallPnLPct = overallInvested > 0 ? (overallPnL / overallInvested) * 100 : 0;
            const prevOverallVal = overallCurrentVal - overallDayPnL;
            const overallDayPnLPct = prevOverallVal > 0 ? (overallDayPnL / prevOverallVal) * 100 : 0;

            const netWorthEl = document.getElementById('dash-net-worth');
            const investedEl = document.getElementById('dash-invested');
            if (netWorthEl) netWorthEl.innerText = formatMoney(overallCurrentVal);
            if (investedEl) investedEl.innerText = formatMoney(overallInvested);
            
            const pnlSign = overallPnL >= 0 ? '+' : '';
            const dashPnlEl = document.getElementById('dash-pnl');
            const dashPnlPctEl = document.getElementById('dash-pnl-pct');
            if (dashPnlEl) {
                dashPnlEl.innerText = isPrivacyMode ? '₹ ••••••' : `${pnlSign}₹${Math.abs(overallPnL).toLocaleString('en-IN', {minimumFractionDigits: 2})}`;
                dashPnlEl.style.color = overallPnL >= 0 ? '#27ae60' : '#c0392b';
            }
            if (dashPnlPctEl) {
                dashPnlPctEl.innerText = `${pnlSign}${overallPnLPct.toFixed(2)}% Overall`;
                dashPnlPctEl.style.color = overallPnL >= 0 ? '#27ae60' : '#c0392b';
            }

            const daySign = overallDayPnL >= 0 ? '+' : '';
            const dashDayPnlEl = document.getElementById('dash-day-pnl');
            const dashDayPnlPctEl = document.getElementById('dash-day-pnl-pct');
            if (dashDayPnlEl) {
                dashDayPnlEl.innerText = isPrivacyMode ? '₹ ••••••' : `${daySign}₹${Math.abs(overallDayPnL).toLocaleString('en-IN', {minimumFractionDigits: 2})}`;
                dashDayPnlEl.style.color = overallDayPnL >= 0 ? '#27ae60' : '#c0392b';
            }
            if (dashDayPnlPctEl) {
                dashDayPnlPctEl.innerText = `${daySign}${overallDayPnLPct.toFixed(2)}% Today`;
                dashDayPnlPctEl.style.color = overallDayPnL >= 0 ? '#27ae60' : '#c0392b';
            }

            // 1. Chart: Portfolio Allocation
            const allocCanvas = document.getElementById('chartPortfolioAllocation');
            if (allocCanvas) {
                const allocCtx = allocCanvas.getContext('2d');
                if (chartAlloc) chartAlloc.destroy();
                
                chartAlloc = new Chart(allocCtx, {
                    type: 'doughnut',
                    data: {
                        labels: portfolioSummaries.map(p => p.name),
                        datasets: [{
                            data: portfolioSummaries.map(p => p.value),
                            backgroundColor: ['#2962ff', '#27ae60', '#f39c12', '#9b59b6', '#e74c3c', '#1abc9c']
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom' },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const val = context.raw || 0;
                                        return ` ${context.label}: ₹${val.toLocaleString('en-IN')}`;
                                    }
                                }
                            }
                        }
                    }
                });
            }

            // 2. Chart: Invested vs Current Value
            const vsCanvas = document.getElementById('chartInvestedVsCurrent');
            if (vsCanvas) {
                const vsCtx = vsCanvas.getContext('2d');
                if (chartVs) chartVs.destroy();

                chartVs = new Chart(vsCtx, {
                    type: 'bar',
                    data: {
                        labels: portfolioSummaries.map(p => p.name),
                        datasets: [
                            {
                                label: 'Invested Amount (₹)',
                                data: portfolioSummaries.map(p => p.invested),
                                backgroundColor: '#94a3b8'
                            },
                            {
                                label: 'Current Value (₹)',
                                data: portfolioSummaries.map(p => p.value),
                                backgroundColor: '#2962ff'
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom' }
                        },
                        scales: {
                            y: {
                                ticks: {
                                    callback: function(value) { return '₹' + value.toLocaleString('en-IN'); }
                                }
                            }
                        }
                    }
                });
            }

            // 3. Chart: Top Performers
            const topCanvas = document.getElementById('chartTopHoldings');
            if (topCanvas) {
                const topCtx = topCanvas.getContext('2d');
                if (chartTop) chartTop.destroy();

                allHoldingsList.sort((a, b) => b.pnlPct - a.pnlPct);
                const topHoldings = allHoldingsList.slice(0, 8);

                chartTop = new Chart(topCtx, {
                    type: 'bar',
                    data: {
                        labels: topHoldings.map(h => `${h.symbol} (${h.pfName})`),
                        datasets: [{
                            label: 'Overall ROI (%)',
                            data: topHoldings.map(h => parseFloat(h.pnlPct.toFixed(2))),
                            backgroundColor: topHoldings.map(h => h.pnlPct >= 0 ? '#27ae60' : '#e74c3c')
                        }]
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false }
                        },
                        scales: {
                            x: {
                                ticks: {
                                    callback: function(value) { return value + '%'; }
                                }
                            }
                        }
                    }
                });
            }

            // 4. Render Portfolio Analyser Component
            if (typeof renderPortfolioAnalyser === 'function') {
                renderPortfolioAnalyser();
            }
        }


        // =========================================================
        // PORTFOLIO ANALYSER ENGINE & CONTROLLER
        // Market (Cap), Sector, and Dynamic Top Holdings Analysis
        // =========================================================

        const paState = {
            activePortfolio: 'ALL', // 'ALL' or specific portfolio name
            activeTab: 'market',    // 'market' | 'sector' | 'top-holdings'
            chartInstance: null,
            lastAnalysisData: null,
            cachedHoldings: []
        };

        // Master stock classification database for Indian Equities
        const CD_STOCK_CLASSIFICATION = {
            'RELIANCE': { name: 'Reliance Industries', sector: 'Oil, Gas & Energy', cap: 'LargeCap' },
            'TCS': { name: 'Tata Consultancy Services', sector: 'IT - Software', cap: 'LargeCap' },
            'INFY': { name: 'Infosys', sector: 'IT - Software', cap: 'LargeCap' },
            'HDFCBANK': { name: 'HDFC Bank', sector: 'Finance/NBFC', cap: 'LargeCap' },
            'ICICIBANK': { name: 'ICICI Bank', sector: 'Finance/NBFC', cap: 'LargeCap' },
            'BHARTIARTL': { name: 'Bharti Airtel', sector: 'Telecommunication', cap: 'LargeCap' },
            'ITC': { name: 'ITC Ltd', sector: 'FMCG', cap: 'LargeCap' },
            'SBIN': { name: 'State Bank of India', sector: 'Finance/NBFC', cap: 'LargeCap' },
            'LT': { name: 'Larsen & Toubro', sector: 'Capital Goods & Engg', cap: 'LargeCap' },
            'BAJFINANCE': { name: 'Bajaj Finance', sector: 'Finance/NBFC', cap: 'LargeCap' },
            'AXISBANK': { name: 'Axis Bank', sector: 'Finance/NBFC', cap: 'LargeCap' },
            'KOTAKBANK': { name: 'Kotak Mahindra Bank', sector: 'Finance/NBFC', cap: 'LargeCap' },
            'HINDUNILVR': { name: 'Hindustan Unilever', sector: 'FMCG', cap: 'LargeCap' },
            'TATAMOTORS': { name: 'Tata Motors', sector: 'Automobiles', cap: 'LargeCap' },
            'MARUTI': { name: 'Maruti Suzuki', sector: 'Automobiles', cap: 'LargeCap' },
            'SUNPHARMA': { name: 'Sun Pharma', sector: 'Pharmaceuticals', cap: 'LargeCap' },
            'TITAN': { name: 'Titan Company', sector: 'Consumer Goods', cap: 'LargeCap' },
            'WIPRO': { name: 'Wipro', sector: 'IT - Software', cap: 'LargeCap' },
            'HCLTECH': { name: 'HCL Technologies', sector: 'IT - Software', cap: 'LargeCap' },
            'TECHM': { name: 'Tech Mahindra', sector: 'IT - Software', cap: 'LargeCap' },
            'ASIANPAINT': { name: 'Asian Paints', sector: 'Paints & Consumer', cap: 'LargeCap' },
            'NTPC': { name: 'NTPC', sector: 'Oil, Gas & Energy', cap: 'LargeCap' },
            'POWERGRID': { name: 'Power Grid Corporation', sector: 'Oil, Gas & Energy', cap: 'LargeCap' },
            'ONGC': { name: 'Oil & Natural Gas Corp', sector: 'Oil, Gas & Energy', cap: 'LargeCap' },
            'COALINDIA': { name: 'Coal India', sector: 'Mining', cap: 'LargeCap' },
            'TATASTEEL': { name: 'Tata Steel', sector: 'Metals & Mining', cap: 'LargeCap' },
            'JSWSTEEL': { name: 'JSW Steel', sector: 'Metals & Mining', cap: 'LargeCap' },

            // Portfolio & MidCap / SmallCap Stocks
            'PINELABS': { name: 'Pine Labs', sector: 'IT - Software', cap: 'SmallCap' },
            'ADSL': { name: 'Allied Digital Services', sector: 'IT - Software', cap: 'Others' },
            'INDHOTEL': { name: 'Indian Hotels Co', sector: 'Hospitality', cap: 'MidCap' },
            'CLEAN': { name: 'Clean Science & Technology', sector: 'Chemicals', cap: 'MidCap' },
            'BELRISE': { name: 'Belrise Industries', sector: 'Auto Ancillary', cap: 'SmallCap' },
            'ROLEXRINGS': { name: 'Rolex Rings', sector: 'Auto Ancillary', cap: 'SmallCap' },
            'NETWEB': { name: 'Netweb Technologies', sector: 'IT - Software', cap: 'SmallCap' },
            'INDGN': { name: 'Indegene', sector: 'Healthcare Services', cap: 'SmallCap' },
            'BBOX': { name: 'Black Box', sector: 'IT - Software', cap: 'SmallCap' },
            'BHEL': { name: 'Bharat Heavy Electricals', sector: 'Capital Goods & Engg', cap: 'MidCap' },
            'CSBBANK': { name: 'CSB Bank', sector: 'Finance/NBFC', cap: 'SmallCap' },
            'PPLPHARMA': { name: 'Piramal Pharma', sector: 'Pharmaceuticals', cap: 'MidCap' },
            'FCL': { name: 'Finolex Cables', sector: 'Cables / Industrials', cap: 'MidCap' },
            'GAUDIUMIVF': { name: 'Gaudium IVF', sector: 'Healthcare Services', cap: 'Others' },
            'DIXON': { name: 'Dixon Technologies', sector: 'Electronics - Components', cap: 'MidCap' },
            'KAYNES': { name: 'Kaynes Technology', sector: 'Electronics - Components', cap: 'MidCap' },
            'AMBER': { name: 'Amber Enterprises', sector: 'Electronics - Components', cap: 'MidCap' },
            'DEEPAKNTR': { name: 'Deepak Nitrite', sector: 'Chemicals', cap: 'MidCap' },
            'TATACHEM': { name: 'Tata Chemicals', sector: 'Chemicals', cap: 'MidCap' },
            'SRF': { name: 'SRF Ltd', sector: 'Chemicals', cap: 'MidCap' },
            'AARTIIND': { name: 'Aarti Industries', sector: 'Chemicals', cap: 'MidCap' },
            'TATAELXSI': { name: 'Tata Elxsi', sector: 'IT - Software', cap: 'MidCap' },
            'PERSISTENT': { name: 'Persistent Systems', sector: 'IT - Software', cap: 'MidCap' },
            'COFORGE': { name: 'Coforge', sector: 'IT - Software', cap: 'MidCap' },
            'ANGELONE': { name: 'Angel One', sector: 'Finance/NBFC', cap: 'MidCap' },
            'MOTILALOFS': { name: 'Motilal Oswal Financial', sector: 'Finance/NBFC', cap: 'MidCap' },
            'CIPLA': { name: 'Cipla', sector: 'Pharmaceuticals', cap: 'LargeCap' },
            'DRREDDY': { name: 'Dr. Reddy Laboratories', sector: 'Pharmaceuticals', cap: 'LargeCap' },
            'LUPIN': { name: 'Lupin', sector: 'Pharmaceuticals', cap: 'MidCap' },
            'AUROPHARMA': { name: 'Aurobindo Pharma', sector: 'Pharmaceuticals', cap: 'MidCap' },
            'EIHOTEL': { name: 'EIH Limited (Oberoi)', sector: 'Hospitality', cap: 'MidCap' },
            'LEMONTREE': { name: 'Lemon Tree Hotels', sector: 'Hospitality', cap: 'SmallCap' },
            'CHALET': { name: 'Chalet Hotels', sector: 'Hospitality', cap: 'SmallCap' },
            'ZOMATO': { name: 'Zomato', sector: 'Consumer Internet', cap: 'LargeCap' },
            'SWIGGY': { name: 'Swiggy', sector: 'Consumer Internet', cap: 'LargeCap' },
            'PAYTM': { name: 'One97 Communications (Paytm)', sector: 'Consumer Internet', cap: 'MidCap' },
            'POLICYBZR': { name: 'PB Fintech (Policybazaar)', sector: 'Consumer Internet', cap: 'MidCap' }
        };

        // Normalize stock ticker symbols (strip .NS, .BO, clean spaces)
        function cleanStockSymbol(sym) {
            if (!sym) return '';
            return String(sym).replace(/\.NS$/i, '').replace(/\.BO$/i, '').trim().toUpperCase();
        }

        // Intelligently resolve sector and cap tier for any stock
        function resolveStockClassification(rawSymbol, companyName) {
            const sym = cleanStockSymbol(rawSymbol);
            if (CD_STOCK_CLASSIFICATION[sym]) {
                return {
                    name: CD_STOCK_CLASSIFICATION[sym].name || companyName || sym,
                    sector: CD_STOCK_CLASSIFICATION[sym].sector || 'Others',
                    cap: CD_STOCK_CLASSIFICATION[sym].cap || 'SmallCap'
                };
            }

            // Heuristic detection based on company name or symbol keywords
            const str = `${sym} ${companyName || ''}`.toUpperCase();
            let sector = 'Others';
            let cap = 'SmallCap';

            if (str.includes('BANK') || str.includes('FINANCE') || str.includes('FINANCIAL') || str.includes('CAPITAL') || str.includes('INVEST')) {
                sector = 'Finance/NBFC';
            } else if (str.includes('TECH') || str.includes('INFOTECH') || str.includes('SOFTWARE') || str.includes('DIGITAL') || str.includes('SYSTEMS')) {
                sector = 'IT - Software';
            } else if (str.includes('PHARMA') || str.includes('HEALTH') || str.includes('LAB') || str.includes('DRUG') || str.includes('HOSPITAL') || str.includes('IVF') || str.includes('MEDIC')) {
                sector = str.includes('HOSPITAL') || str.includes('IVF') || str.includes('LAB') ? 'Healthcare Services' : 'Pharmaceuticals';
            } else if (str.includes('CHEM') || str.includes('FERTILIZ') || str.includes('AGRO')) {
                sector = 'Chemicals';
            } else if (str.includes('AUTO') || str.includes('MOTOR') || str.includes('GEAR') || str.includes('RINGS') || str.includes('TYRE')) {
                sector = 'Auto Ancillary';
            } else if (str.includes('HOTEL') || str.includes('HOSPITALITY') || str.includes('RESORT')) {
                sector = 'Hospitality';
            } else if (str.includes('POWER') || str.includes('ENERGY') || str.includes('OIL') || str.includes('GAS') || str.includes('SOLAR')) {
                sector = 'Oil, Gas & Energy';
            } else if (str.includes('STEEL') || str.includes('IRON') || str.includes('MINING') || str.includes('MINERAL') || str.includes('MET')) {
                sector = 'Metals & Mining';
            } else if (str.includes('ELECTRON') || str.includes('CIRCUIT') || str.includes('ELECTR')) {
                sector = 'Electronics - Components';
            } else if (str.includes('CABLE') || str.includes('WIRE')) {
                sector = 'Cables / Industrials';
            } else if (str.includes('ENGINEER') || str.includes('INFRA') || str.includes('CONSTRUCT')) {
                sector = 'Capital Goods & Engg';
            }

            return {
                name: companyName || sym,
                sector: sector,
                cap: cap
            };
        }

        /**
         * Main Render Function for Portfolio Analyser
         */
        function renderPortfolioAnalyser() {
            const sectionEl = document.getElementById('portfolio-analyser-section');
            if (!sectionEl) return;

            const selectorContainer = document.getElementById('pa-portfolio-selector-container');
            const mountEl = document.getElementById('pa-analysis-mount');
            if (!mountEl) return;

            const allPfNames = Object.keys(portfoliosData || {});

            // 1. Portfolio Selection Handling
            if (allPfNames.length === 0) {
                if (selectorContainer) selectorContainer.innerHTML = '';
                mountEl.innerHTML = `
                    <div class="pa-empty-state">
                        <div class="pa-empty-icon">📁</div>
                        <div class="pa-empty-title">No Portfolios Found</div>
                        <div class="pa-empty-desc">Create a portfolio and add stock holdings in the Portfolios tab to view in-depth market, sector, and holdings intelligence.</div>
                    </div>
                `;
                return;
            }

            // Sync selector container (dropdown if > 1 portfolio, single badge if 1 portfolio)
            if (selectorContainer) {
                if (allPfNames.length > 1) {
                    let optionsHtml = `<option value="ALL" ${paState.activePortfolio === 'ALL' ? 'selected' : ''}>All Portfolios (${allPfNames.length})</option>`;
                    allPfNames.forEach(name => {
                        const isSel = paState.activePortfolio === name ? 'selected' : '';
                        optionsHtml += `<option value="${escapeHtml(name)}" ${isSel}>${escapeHtml(name)}</option>`;
                    });

                    selectorContainer.innerHTML = `
                        <span class="pa-portfolio-select-label">Select:</span>
                        <select class="pa-portfolio-select" id="pa-portfolio-select" onchange="window.setPaPortfolio(this.value)">
                            ${optionsHtml}
                        </select>
                    `;
                } else {
                    const singleName = allPfNames[0];
                    paState.activePortfolio = singleName;
                    selectorContainer.innerHTML = `
                        <span class="pa-single-pf-badge">📁 Portfolio: <strong>${escapeHtml(singleName)}</strong></span>
                    `;
                }
            }

            // 2. Extract holdings for the selected scope
            let targetHoldings = [];
            if (paState.activePortfolio === 'ALL') {
                allPfNames.forEach(pfName => {
                    const hList = portfoliosData[pfName] || [];
                    hList.forEach(h => {
                        targetHoldings.push({ ...h, pfName: pfName });
                    });
                });
            } else {
                const hList = portfoliosData[paState.activePortfolio] || [];
                hList.forEach(h => {
                    targetHoldings.push({ ...h, pfName: paState.activePortfolio });
                });
            }

            if (targetHoldings.length === 0) {
                mountEl.innerHTML = `
                    <div class="pa-empty-state">
                        <div class="pa-empty-icon">📊</div>
                        <div class="pa-empty-title">Portfolio is Empty</div>
                        <div class="pa-empty-desc">Add stock holdings to "${escapeHtml(paState.activePortfolio)}" to generate comprehensive portfolio analytics.</div>
                    </div>
                `;
                updatePaSummaryBanner(0, 0, 0, 0, 0, 0);
                return;
            }

            // 3. Calculate live market values, gains, and classifications
            let totalCurrentVal = 0;
            let totalInvestedVal = 0;
            let totalDayPnL = 0;

            const enrichedHoldings = targetHoldings.map(h => {
                const sym = cleanStockSymbol(h.symbol);
                const info = stockPricesData[h.symbol] || stockPricesData[sym] || {};
                const ltp = Number(info.price || h.buy_price || 0);
                const dayChange = Number(info.change || 0);
                const qty = Number(h.quantity || 0);
                const buyPrice = Number(h.buy_price || 0);

                const invAmt = qty * buyPrice;
                const curVal = ltp > 0 ? (qty * ltp) : invAmt;
                const pnlAmt = curVal - invAmt;
                const pnlPct = invAmt > 0 ? (pnlAmt / invAmt) * 100 : 0;
                const dayPnLAmt = ltp > 0 ? (qty * dayChange) : 0;

                totalCurrentVal += curVal;
                totalInvestedVal += invAmt;
                totalDayPnL += dayPnLAmt;

                const meta = resolveStockClassification(h.symbol, info.name);

                return {
                    rawSymbol: h.symbol,
                    symbol: sym,
                    name: meta.name || info.name || sym,
                    sector: meta.sector,
                    cap: meta.cap,
                    quantity: qty,
                    buyPrice: buyPrice,
                    ltp: ltp,
                    invVal: invAmt,
                    curVal: curVal,
                    pnlAmt: pnlAmt,
                    pnlPct: pnlPct,
                    dayPnLAmt: dayPnLAmt,
                    pfName: h.pfName
                };
            });

            // Calculate weightages based on total portfolio value
            enrichedHoldings.forEach(h => {
                h.weightage = totalCurrentVal > 0 ? (h.curVal / totalCurrentVal) * 100 : 0;
            });

            paState.cachedHoldings = enrichedHoldings;

            // 4. Update Summary Banner Card
            const overallPnL = totalCurrentVal - totalInvestedVal;
            const overallPnLPct = totalInvestedVal > 0 ? (overallPnL / totalInvestedVal) * 100 : 0;
            const prevTotalVal = totalCurrentVal - totalDayPnL;
            const dayPnLPct = prevTotalVal > 0 ? (totalDayPnL / prevTotalVal) * 100 : 0;

            updatePaSummaryBanner(totalCurrentVal, totalInvestedVal, overallPnL, overallPnLPct, totalDayPnL, dayPnLPct);

            // 5. Render active tab data
            renderPaActiveTabContent(enrichedHoldings, totalCurrentVal);
        }

        /**
         * Update Value & P&L Summary Banner
         */
        function updatePaSummaryBanner(currentVal, investedVal, overallPnL, overallPnLPct, dayPnL, dayPnLPct) {
            const curValEl = document.getElementById('pa-total-current-val');
            const invValEl = document.getElementById('pa-invested-val');
            const pnlWrap = document.getElementById('pa-overall-pnl-wrap');
            const pnlArrow = document.getElementById('pa-pnl-arrow');
            const pnlLabel = document.getElementById('pa-pnl-label');
            const pnlAmt = document.getElementById('pa-overall-pnl-amt');
            const pnlPct = document.getElementById('pa-overall-pnl-pct');
            const dayValEl = document.getElementById('pa-day-pnl-val');
            const dayLabelEl = document.getElementById('pa-day-pnl-label');
            const eyeBtn = document.getElementById('pa-eye-toggle');

            const isPriv = (typeof isPrivacyMode !== 'undefined') ? isPrivacyMode : (localStorage.getItem('capital_desk_privacy_mode') === 'true');

            if (curValEl) {
                curValEl.innerText = isPriv ? '₹ ••••••' : `₹${Math.round(currentVal).toLocaleString('en-IN')}`;
            }
            if (invValEl) {
                invValEl.innerText = isPriv ? '₹ ••••••' : `₹${Math.round(investedVal).toLocaleString('en-IN')}`;
            }

            const isPos = overallPnL >= 0;
            if (pnlWrap) {
                pnlWrap.className = `pa-overall-pnl-row ${isPos ? 'pos' : 'neg'}`;
            }
            if (pnlArrow) {
                pnlArrow.innerText = isPos ? '↑' : '↓';
            }
            if (pnlLabel) {
                pnlLabel.innerText = isPos ? 'Overall Profit' : 'Overall Loss';
            }
            if (pnlAmt) {
                const sign = isPos ? '+' : '-';
                pnlAmt.innerText = isPriv ? '₹ ••••••' : `${sign}₹${Math.abs(overallPnL).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            }
            if (pnlPct) {
                const sign = isPos ? '+' : '';
                pnlPct.innerText = `(${sign}${overallPnLPct.toFixed(2)}%)`;
            }

            const isDayPos = dayPnL >= 0;
            if (dayLabelEl) {
                dayLabelEl.innerText = isDayPos ? "Today's Profit" : "Today's Loss";
            }
            if (dayValEl) {
                dayValEl.className = `pa-sub-val pa-day-pnl-val ${isDayPos ? 'pos' : 'neg'}`;
                const daySign = isDayPos ? '+' : '-';
                const dayPctSign = isDayPos ? '+' : '';
                dayValEl.innerText = isPriv 
                    ? `₹ •••••• (${dayPctSign}${dayPnLPct.toFixed(2)}%)`
                    : `${daySign}₹${Math.abs(dayPnL).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${dayPctSign}${dayPnLPct.toFixed(2)}%)`;
            }

            if (eyeBtn) {
                eyeBtn.style.color = isPriv ? '#10b981' : '';
            }
        }

        /**
         * Render Active Analysis Tab (Market | Sector | Top Holdings)
         */
        function renderPaActiveTabContent(holdings, totalVal) {
            const mountEl = document.getElementById('pa-analysis-mount');
            if (!mountEl) return;

            // Sync Tab Button active states
            ['market', 'sector', 'top-holdings'].forEach(tKey => {
                const btn = document.getElementById(`pa-tab-${tKey}`);
                if (btn) {
                    if (paState.activeTab === tKey) btn.classList.add('active');
                    else btn.classList.remove('active');
                }
            });

            let categories = [];
            const tab = paState.activeTab;

            if (tab === 'market') {
                // Group by Cap Tier: LargeCap, MidCap, SmallCap, Others
                const capOrder = ['LargeCap', 'MidCap', 'SmallCap', 'Others'];
                const capColors = {
                    'LargeCap': '#10b981', // green
                    'MidCap': '#3b82f6',   // blue
                    'SmallCap': '#f43f5e', // coral red
                    'Others': '#14b8a6'    // teal
                };

                const groups = { 'LargeCap': [], 'MidCap': [], 'SmallCap': [], 'Others': [] };
                holdings.forEach(h => {
                    const c = h.cap || 'Others';
                    if (groups[c]) groups[c].push(h);
                    else groups['Others'].push(h);
                });

                capOrder.forEach(capKey => {
                    const items = groups[capKey];
                    if (items && items.length > 0) {
                        const val = items.reduce((sum, x) => sum + x.curVal, 0);
                        const inv = items.reduce((sum, x) => sum + x.invVal, 0);
                        const pnl = val - inv;
                        const pnlPct = inv > 0 ? (pnl / inv) * 100 : 0;
                        const weight = totalVal > 0 ? (val / totalVal) * 100 : 0;

                        categories.push({
                            key: capKey,
                            name: capKey,
                            color: capColors[capKey] || '#94a3b8',
                            marketValue: val,
                            investedValue: inv,
                            pnlAmt: pnl,
                            pnlPct: pnlPct,
                            weightage: weight,
                            items: items
                        });
                    }
                });
            } else if (tab === 'sector') {
                // Group by Sector
                const sectorPalette = [
                    '#3b82f6', '#06b6d4', '#a855f7', '#6366f1', '#ec4899', 
                    '#10b981', '#f59e0b', '#84cc16', '#64748b', '#f97316'
                ];
                const groups = {};
                holdings.forEach(h => {
                    const sec = h.sector || 'Others';
                    if (!groups[sec]) groups[sec] = [];
                    groups[sec].push(h);
                });

                const sortedSectors = Object.keys(groups).sort((a, b) => {
                    const valA = groups[a].reduce((sum, x) => sum + x.curVal, 0);
                    const valB = groups[b].reduce((sum, x) => sum + x.curVal, 0);
                    return valB - valA;
                });

                sortedSectors.forEach((sec, idx) => {
                    const items = groups[sec];
                    const val = items.reduce((sum, x) => sum + x.curVal, 0);
                    const inv = items.reduce((sum, x) => sum + x.invVal, 0);
                    const pnl = val - inv;
                    const pnlPct = inv > 0 ? (pnl / inv) * 100 : 0;
                    const weight = totalVal > 0 ? (val / totalVal) * 100 : 0;

                    categories.push({
                        key: sec,
                        name: sec,
                        color: sectorPalette[idx % sectorPalette.length],
                        marketValue: val,
                        investedValue: inv,
                        pnlAmt: pnl,
                        pnlPct: pnlPct,
                        weightage: weight,
                        items: items
                    });
                });
            } else if (tab === 'top-holdings') {
                // Dynamic Top Holdings Calculation (e.g. Top 3 / Top 5 / Top 10 based on no. of stocks)
                // Sorted descending by Market Value
                const sorted = [...holdings].sort((a, b) => b.curVal - a.curVal);
                const N = sorted.length;

                let topCount = 3;
                let tailCount = 1;

                if (N <= 3) {
                    topCount = Math.min(N, 1);
                    tailCount = Math.max(0, N - topCount);
                } else if (N <= 8) {
                    topCount = 3;
                    tailCount = N >= 6 ? 2 : 1;
                } else if (N <= 18) {
                    topCount = 5;
                    tailCount = Math.max(2, Math.round(N * 0.2));
                } else {
                    topCount = 10;
                    tailCount = Math.max(3, Math.round(N * 0.15));
                }

                // Ensure non-overlapping partitions
                topCount = Math.min(topCount, N);
                let remainingCount = Math.max(0, N - topCount - tailCount);
                if (topCount + remainingCount + tailCount > N) {
                    tailCount = Math.max(0, N - topCount - remainingCount);
                }

                const topSlice = sorted.slice(0, topCount);
                const remainingSlice = sorted.slice(topCount, topCount + remainingCount);
                const tailSlice = sorted.slice(topCount + remainingCount);

                const tiers = [
                    { key: `top_${topCount}`, name: `Top ${topCount} Holdings`, color: '#3b82f6', items: topSlice },
                    { key: 'remaining', name: 'Remaining', color: '#f43f5e', items: remainingSlice },
                    { key: 'tail_stocks', name: 'Tail Stocks', color: '#10b981', items: tailSlice }
                ];

                tiers.forEach(t => {
                    if (t.items.length > 0) {
                        const val = t.items.reduce((sum, x) => sum + x.curVal, 0);
                        const inv = t.items.reduce((sum, x) => sum + x.invVal, 0);
                        const pnl = val - inv;
                        const pnlPct = inv > 0 ? (pnl / inv) * 100 : 0;
                        const weight = totalVal > 0 ? (val / totalVal) * 100 : 0;

                        categories.push({
                            key: t.key,
                            name: t.name,
                            color: t.color,
                            marketValue: val,
                            investedValue: inv,
                            pnlAmt: pnl,
                            pnlPct: pnlPct,
                            weightage: weight,
                            items: t.items
                        });
                    }
                });
            }

            paState.lastAnalysisData = categories;

            // Render Layout: Chart Card (Left) + Table Card (Right)
            mountEl.innerHTML = `
                <div class="pa-analysis-grid">
                    <!-- Left: Donut Chart -->
                    <div class="pa-chart-card">
                        <div class="pa-chart-canvas-box">
                            <canvas id="paDonutChart"></canvas>
                            <div class="pa-chart-center-text">
                                <div class="pa-chart-center-sub">${escapeHtml(tab.toUpperCase().replace('-', ' '))}</div>
                                <div class="pa-chart-center-main">${categories.length} Types</div>
                            </div>
                        </div>
                    </div>

                    <!-- Right: Breakdown Table -->
                    <div class="pa-table-card">
                        <table class="pa-breakdown-table">
                            <thead>
                                <tr>
                                    <th class="pa-col-comp">Company / Segment</th>
                                    <th class="pa-col-val">Market Value</th>
                                    <th class="pa-col-pnl">Total G/L</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${categories.map(c => {
                                    const pnlPos = c.pnlPct >= 0;
                                    const sign = pnlPos ? '+' : '';
                                    return `
                                        <tr onclick="window.openPaDetailsModal('${escapeHtml(c.key)}')">
                                            <td>
                                                <div class="pa-row-name-wrap">
                                                    <span class="pa-row-dot" style="background-color: ${c.color};"></span>
                                                    <span class="pa-row-name">${escapeHtml(c.name)}</span>
                                                    <span class="pa-row-count">(${c.items.length})</span>
                                                </div>
                                            </td>
                                            <td class="pa-row-val-cell">
                                                <div class="pa-row-mktval">₹${Math.round(c.marketValue).toLocaleString('en-IN')}</div>
                                                <div class="pa-row-weight">${c.weightage.toFixed(1)}% weight</div>
                                            </td>
                                            <td class="pa-row-pnl-cell">
                                                <span class="pa-pnl-pill ${pnlPos ? 'pos' : 'neg'}">
                                                    ${sign}${c.pnlPct.toFixed(2)}%
                                                </span>
                                                <span class="pa-row-chevron">›</span>
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            // Initialize or Rebuild Chart.js Donut
            initPaDonutChart(categories);
        }

        /**
         * Initialize Donut Chart using Chart.js
         */
        function initPaDonutChart(categories) {
            const canvas = document.getElementById('paDonutChart');
            if (!canvas) return;

            if (paState.chartInstance) {
                try { paState.chartInstance.destroy(); } catch (e) {}
                paState.chartInstance = null;
            }

            const ctx = canvas.getContext('2d');
            paState.chartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: categories.map(c => c.name),
                    datasets: [{
                        data: categories.map(c => c.marketValue),
                        backgroundColor: categories.map(c => c.color),
                        borderWidth: 2,
                        borderColor: document.documentElement.getAttribute('data-theme') === 'light' ? '#ffffff' : '#1e293b',
                        hoverOffset: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '70%',
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const cat = categories[context.dataIndex];
                                    if (!cat) return '';
                                    return ` ${cat.name}: ₹${Math.round(cat.marketValue).toLocaleString('en-IN')} (${cat.weightage.toFixed(1)}%)`;
                                }
                            }
                        }
                    },
                    onClick: function(event, elements) {
                        if (elements && elements.length > 0) {
                            const idx = elements[0].index;
                            if (categories[idx]) {
                                window.openPaDetailsModal(categories[idx].key);
                            }
                        }
                    }
                }
            });
        }

        /**
         * Open Details Breakdown Modal / Mobile Bottom Sheet Popup
         */
        function openPaDetailsModal(categoryKey) {
            if (!paState.lastAnalysisData) return;
            const category = paState.lastAnalysisData.find(c => c.key === categoryKey);
            if (!category) return;

            const modal = document.getElementById('pa-details-modal');
            const titleEl = document.getElementById('pa-modal-title');
            const subEl = document.getElementById('pa-modal-subtitle');
            const tbody = document.getElementById('pa-modal-table-body');
            if (!modal || !titleEl || !tbody) return;

            titleEl.innerText = category.name;
            if (subEl) {
                subEl.innerText = `${category.items.length} ${category.items.length === 1 ? 'Stock' : 'Stocks'} · ₹${Math.round(category.marketValue).toLocaleString('en-IN')} (${category.weightage.toFixed(1)}% of Portfolio)`;
            }

            // Sort stocks in category by market value descending
            const sortedItems = [...category.items].sort((a, b) => b.curVal - a.curVal);

            tbody.innerHTML = sortedItems.map(item => {
                const isPos = item.pnlPct >= 0;
                const sign = isPos ? '+' : '';
                return `
                    <tr>
                        <td>
                            <div class="pa-modal-comp-name" onclick="window.openStockFundamentals ? window.openStockFundamentals('${escapeHtml(item.symbol)}') : null" title="View Fundamentals">
                                ${escapeHtml(item.name || item.symbol)}
                            </div>
                            <div class="pa-modal-comp-sym">
                                ${escapeHtml(item.symbol)} · ${escapeHtml(item.pfName || '')}
                            </div>
                        </td>
                        <td class="pa-modal-mktval-wrap">
                            <div class="pa-modal-mktval">₹${Math.round(item.curVal).toLocaleString('en-IN')}</div>
                            <div class="pa-modal-weightage">${item.weightage.toFixed(2)} %</div>
                        </td>
                        <td class="pa-modal-pnl-wrap">
                            <div class="pa-modal-pnl-pct ${isPos ? 'pos' : 'neg'}">${sign}${item.pnlPct.toFixed(2)} %</div>
                            <div class="pa-modal-pnl-amt">${sign}₹${Math.abs(Math.round(item.pnlAmt)).toLocaleString('en-IN')}</div>
                        </td>
                    </tr>
                `;
            }).join('');

            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }

        /**
         * Close Details Breakdown Modal
         */
        function closePaModal(event) {
            const modal = document.getElementById('pa-details-modal');
            if (modal) {
                modal.style.display = 'none';
                document.body.style.overflow = '';
            }
        }

        /**
         * Switch Analysis Tab (market | sector | top-holdings)
         */
        function switchPaTab(tabKey) {
            paState.activeTab = tabKey;
            if (paState.cachedHoldings && paState.cachedHoldings.length > 0) {
                const totalVal = paState.cachedHoldings.reduce((sum, h) => sum + h.curVal, 0);
                renderPaActiveTabContent(paState.cachedHoldings, totalVal);
            } else {
                renderPortfolioAnalyser();
            }
        }

        /**
         * Set Selected Portfolio Filter
         */
        function setPaPortfolio(pfName) {
            paState.activePortfolio = pfName;
            renderPortfolioAnalyser();
        }

        /**
         * Toggle Privacy Mode from Portfolio Analyser Eye Icon
         */
        function togglePaPrivacy() {
            if (typeof togglePrivacyMode === 'function') {
                togglePrivacyMode();
            } else {
                const cur = localStorage.getItem('capital_desk_privacy_mode') === 'true';
                localStorage.setItem('capital_desk_privacy_mode', (!cur).toString());
                if (typeof isPrivacyMode !== 'undefined') isPrivacyMode = !cur;
            }
            renderPortfolioAnalyser();
        }

        // Global Keyboard Event: Close modal on Escape
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closePaModal();
            }
        });

        // Global Exposure
        window.renderPortfolioAnalyser = renderPortfolioAnalyser;
        window.switchPaTab = switchPaTab;
        window.setPaPortfolio = setPaPortfolio;
        window.togglePaPrivacy = togglePaPrivacy;
        window.openPaDetailsModal = openPaDetailsModal;
        window.closePaModal = closePaModal;
