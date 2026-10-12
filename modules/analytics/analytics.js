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

            for (const [pfName, holdings] of Object.entries(portfoliosData)) {
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

            document.getElementById('dash-net-worth').innerText = formatMoney(overallCurrentVal);
            document.getElementById('dash-invested').innerText = formatMoney(overallInvested);
            
            const pnlSign = overallPnL >= 0 ? '+' : '';
            const dashPnlEl = document.getElementById('dash-pnl');
            const dashPnlPctEl = document.getElementById('dash-pnl-pct');
            dashPnlEl.innerText = isPrivacyMode ? '₹ ••••••' : `${pnlSign}₹${Math.abs(overallPnL).toLocaleString('en-IN', {minimumFractionDigits: 2})}`;
            dashPnlPctEl.innerText = `${pnlSign}${overallPnLPct.toFixed(2)}% Overall`;
            dashPnlEl.style.color = overallPnL >= 0 ? '#27ae60' : '#c0392b';
            dashPnlPctEl.style.color = overallPnL >= 0 ? '#27ae60' : '#c0392b';

            const daySign = overallDayPnL >= 0 ? '+' : '';
            const dashDayPnlEl = document.getElementById('dash-day-pnl');
            const dashDayPnlPctEl = document.getElementById('dash-day-pnl-pct');
            dashDayPnlEl.innerText = isPrivacyMode ? '₹ ••••••' : `${daySign}₹${Math.abs(overallDayPnL).toLocaleString('en-IN', {minimumFractionDigits: 2})}`;
            dashDayPnlPctEl.innerText = `${daySign}${overallDayPnLPct.toFixed(2)}% Today`;
            dashDayPnlEl.style.color = overallDayPnL >= 0 ? '#27ae60' : '#c0392b';
            dashDayPnlPctEl.style.color = overallDayPnL >= 0 ? '#27ae60' : '#c0392b';

            // 1. Chart: Portfolio Allocation
            const allocCtx = document.getElementById('chartPortfolioAllocation').getContext('2d');
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

            // 2. Chart: Invested vs Current Value
            const vsCtx = document.getElementById('chartInvestedVsCurrent').getContext('2d');
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

            // 3. Chart: Top Performers
            const topCtx = document.getElementById('chartTopHoldings').getContext('2d');
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



