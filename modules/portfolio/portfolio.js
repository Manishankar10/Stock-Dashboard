        // =========================================================
        // PORTFOLIO FUNCTIONS
        // =========================================================
        // Global Transactions State
        let userTransactionsData = [];

        async function fetchTransactions() {
            try {
                const res = await fetch('/api/transactions');
                if (res.ok) {
                    userTransactionsData = await res.json();
                    renderTransactionsTable();
                }
            } catch(e) {
                console.error('Error fetching transactions:', e);
            }
        }

        async function deleteTransaction(txId) {
            if (!await showCustomConfirm({ title: 'Delete Transaction Record', message: 'Are you sure you want to delete this transaction record?', isDanger: true })) return;
            try {
                const res = await fetch(`/api/transactions/${encodeURIComponent(txId)}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    showToast('Transaction record deleted', 'info');
                    userTransactionsData = data.transactions;
                    renderTransactionsTable();
                }
            } catch(e) {
                alert('Failed to delete transaction');
            }
        }

        // =========================================================
        // BUY MORE & SELL MODAL HANDLERS
        // =========================================================
        let currentSellHolding = null;
        let currentBuyMoreHolding = null;

        function openSellHoldingModal(symbol, curQty, curAvgPrice, targetPortfolio = null) {
            const pfNames = Object.keys(portfoliosData);
            const pfName = targetPortfolio || (currentDetailHolding && currentDetailHolding.portfolioName) || (activePortfolioName !== 'All' ? activePortfolioName : pfNames[0]);
            if (!pfName) return;
            const holdings = portfoliosData[pfName] || [];
            const item = holdings.find(h => h.symbol === symbol) || (currentDetailHolding && currentDetailHolding.symbol === symbol ? currentDetailHolding : null);
            if (!item) return;

            currentSellHolding = { ...item, portfolioName: pfName };
            const info = stockPricesData[symbol] || {};
            const ltp = info.price || item.buy_price;

            document.getElementById('modal-sell-symbol').value = symbol;
            document.getElementById('sellModalTitle').innerText = `🔴 Sell ${cleanDisplaySymbol(symbol)}`;
            document.getElementById('sell-info-qty').innerText = formatQty(item.quantity);
            document.getElementById('sell-info-avgprice').innerText = formatMoney(item.buy_price);
            document.getElementById('sell-info-ltp').innerText = ltp > 0 ? formatMoney(ltp) : '-';
            document.getElementById('sell-info-portfolio').innerText = pfName;

            document.getElementById('modal-sell-qty').value = item.quantity;
            document.getElementById('modal-sell-price').value = ltp > 0 ? ltp.toFixed(2) : item.buy_price.toFixed(2);
            document.getElementById('modal-sell-date').value = new Date().toISOString().split('T')[0];
            document.getElementById('modal-sell-notes').value = '';

            calculateSellPreview();
            document.getElementById('sellHoldingModal').style.display = 'block';
        }

        function closeSellHoldingModal() {
            document.getElementById('sellHoldingModal').style.display = 'none';
        }

        function calculateSellPreview() {
            if (!currentSellHolding) return;
            const qtyInput = parseFloat(document.getElementById('modal-sell-qty').value) || 0;
            const priceInput = parseFloat(document.getElementById('modal-sell-price').value) || 0;
            const avgBuyPrice = currentSellHolding.buy_price;

            const pnlAmt = (priceInput - avgBuyPrice) * qtyInput;
            const pnlPct = avgBuyPrice > 0 ? ((priceInput - avgBuyPrice) / avgBuyPrice) * 100 : 0;
            const pnlSign = pnlAmt >= 0 ? '+' : '';
            const pnlColor = pnlAmt >= 0 ? '#10b981' : '#ef4444';

            const previewEl = document.getElementById('sell-preview-pnl');
            if (previewEl) {
                previewEl.innerText = isPrivacyMode 
                    ? `₹ •••••• (${pnlSign}${pnlPct.toFixed(2)}%)` 
                    : `${pnlSign}₹${Math.abs(pnlAmt).toLocaleString('en-IN', {minimumFractionDigits:2})} (${pnlSign}${pnlPct.toFixed(2)}%)`;
                previewEl.style.color = pnlColor;
            }
        }

        async function submitSellHolding() {
            const pfName = (currentSellHolding && currentSellHolding.portfolioName) || (activePortfolioName !== 'All' ? activePortfolioName : '');
            if (!pfName || !currentSellHolding) return;
            const symbol = document.getElementById('modal-sell-symbol').value;
            const quantity = parseFloat(document.getElementById('modal-sell-qty').value);
            const sell_price = parseFloat(document.getElementById('modal-sell-price').value);
            const sell_date = document.getElementById('modal-sell-date').value || new Date().toISOString().split('T')[0];
            const notes = document.getElementById('modal-sell-notes').value.trim();

            if (isNaN(quantity) || quantity <= 0) {
                alert('Please enter a valid quantity to sell!');
                return;
            }
            if (quantity > currentSellHolding.quantity + 0.0001) {
                alert(`Cannot sell ${quantity} shares. You only hold ${currentSellHolding.quantity} shares!`);
                return;
            }
            if (isNaN(sell_price) || sell_price <= 0) {
                alert('Please enter a valid selling price!');
                return;
            }

            const res = await fetch(`/api/portfolios/${encodeURIComponent(pfName)}/stocks/sell`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol, quantity, sell_price, sell_date, notes })
            });
            const data = await res.json();
            if (data.success) {
                closeSellHoldingModal();
                portfoliosData = data.portfolios;
                if (data.transactions) userTransactionsData = data.transactions;
                renderPortfolios();
                refreshPrices();
            } else {
                alert(data.error || 'Failed to submit sell order');
            }
        }

        function openBuyMoreModal(symbol, curAvgPrice, targetPortfolio = null) {
            const pfNames = Object.keys(portfoliosData);
            const pfName = targetPortfolio || (currentDetailHolding && currentDetailHolding.portfolioName) || (activePortfolioName !== 'All' ? activePortfolioName : pfNames[0]);
            if (!pfName) return;
            const holdings = portfoliosData[pfName] || [];
            const item = holdings.find(h => h.symbol === symbol);

            currentBuyMoreHolding = item ? { ...item, portfolioName: pfName } : { symbol: symbol, quantity: 0, buy_price: curAvgPrice || 0, portfolioName: pfName };
            const info = stockPricesData[symbol] || {};
            const ltp = info.price || (item ? item.buy_price : 0);

            document.getElementById('modal-buymore-symbol').value = symbol;
            document.getElementById('buyMoreModalTitle').innerText = `🟢 Buy More ${cleanDisplaySymbol(symbol)}`;
            document.getElementById('buymore-info-qty').innerText = formatQty(currentBuyMoreHolding.quantity);
            document.getElementById('buymore-info-avgprice').innerText = formatMoney(currentBuyMoreHolding.buy_price);
            document.getElementById('buymore-info-ltp').innerText = ltp > 0 ? formatMoney(ltp) : '-';
            document.getElementById('buymore-info-portfolio').innerText = pfName;

            document.getElementById('modal-buymore-qty').value = '';
            document.getElementById('modal-buymore-price').value = ltp > 0 ? ltp.toFixed(2) : (currentBuyMoreHolding.buy_price || '');
            document.getElementById('modal-buymore-date').value = new Date().toISOString().split('T')[0];
            document.getElementById('modal-buymore-reason').value = '';

            calculateBuyMorePreview();
            document.getElementById('buyMoreModal').style.display = 'block';
        }

        function closeBuyMoreModal() {
            document.getElementById('buyMoreModal').style.display = 'none';
        }

        function calculateBuyMorePreview() {
            if (!currentBuyMoreHolding) return;
            const oldQty = currentBuyMoreHolding.quantity || 0;
            const oldPrice = currentBuyMoreHolding.buy_price || 0;

            const addQty = parseFloat(document.getElementById('modal-buymore-qty').value) || 0;
            const addPrice = parseFloat(document.getElementById('modal-buymore-price').value) || 0;

            const totalQty = oldQty + addQty;
            const avgPrice = totalQty > 0 ? ((oldQty * oldPrice) + (addQty * addPrice)) / totalQty : addPrice;

            document.getElementById('buymore-preview-qty').innerText = totalQty > 0 ? formatQty(totalQty) + ' shares' : '-';
            document.getElementById('buymore-preview-avgprice').innerText = avgPrice > 0 ? '₹' + avgPrice.toLocaleString('en-IN', {minimumFractionDigits: 2}) : '-';
        }

        async function submitBuyMoreHolding() {
            const pfName = (currentBuyMoreHolding && currentBuyMoreHolding.portfolioName) || (activePortfolioName !== 'All' ? activePortfolioName : '');
            if (!pfName || !currentBuyMoreHolding) return;
            const symbol = document.getElementById('modal-buymore-symbol').value;
            const quantity = parseFloat(document.getElementById('modal-buymore-qty').value);
            const buy_price = parseFloat(document.getElementById('modal-buymore-price').value);
            const buy_date = document.getElementById('modal-buymore-date').value || new Date().toISOString().split('T')[0];
            const buy_reason = document.getElementById('modal-buymore-reason').value.trim();

            if (isNaN(quantity) || quantity <= 0) {
                alert('Please enter a valid quantity to buy!');
                return;
            }
            if (isNaN(buy_price) || buy_price <= 0) {
                alert('Please enter a valid buy price!');
                return;
            }

            const res = await fetch(`/api/portfolios/${encodeURIComponent(pfName)}/stocks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol, quantity, buy_price, buy_date, buy_reason, mode: 'buy_more' })
            });
            const data = await res.json();
            if (data.success) {
                closeBuyMoreModal();
                portfoliosData = data.portfolios;
                if (data.transactions) userTransactionsData = data.transactions;
                renderPortfolios();
                refreshPrices();
            } else {
                alert(data.error || 'Failed to submit buy order');
            }
        }

        function exportTransactionsToCSV() {
            if (userTransactionsData.length === 0) {
                alert('No transaction records available to export!');
                return;
            }

            let csvRows = [];
            csvRows.push(['Date', 'Portfolio', 'Symbol', 'Type', 'Quantity', 'Price (INR)', 'Total Value (INR)', 'Realized P&L (INR)', 'Realized P&L (%)', 'Notes']);

            userTransactionsData.forEach(t => {
                csvRows.push([
                    `"${t.date || ''}"`,
                    `"${(t.portfolio || '').replace(/"/g, '""')}"`,
                    `"${t.symbol}"`,
                    `"${t.type}"`,
                    t.quantity,
                    t.price.toFixed(2),
                    t.total_amount.toFixed(2),
                    t.type === 'SELL' ? t.realized_pnl.toFixed(2) : '0.00',
                    t.type === 'SELL' ? `"${t.realized_pnl_pct.toFixed(2)}%"` : '"0.00%"',
                    `"${(t.notes || '').replace(/"/g, '""')}"`
                ]);
            });

            const csvContent = '\uFEFF' + csvRows.map(e => e.join(',')).join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const dateStr = new Date().toISOString().split('T')[0];
            link.href = URL.createObjectURL(blob);
            link.setAttribute('download', `portfolio_transactions_${dateStr}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        // =========================================================
        // PORTFOLIO FUNCTIONS & SORTING HELPERS
        // =========================================================
        function compareHoldings(symA, symB, qtyA, qtyB, buyPriceA, buyPriceB, buyDateA, buyDateB) {
            const infoA = stockPricesData[symA] || {};
            const infoB = stockPricesData[symB] || {};
            const qA = Number(qtyA) || 0;
            const qB = Number(qtyB) || 0;
            const bpA = Number(buyPriceA) || 0;
            const bpB = Number(buyPriceB) || 0;

            const ltpA = (infoA && !infoA.error && infoA.price !== undefined) ? Number(infoA.price) : bpA;
            const ltpB = (infoB && !infoB.error && infoB.price !== undefined) ? Number(infoB.price) : bpB;

            const invA = bpA * qA;
            const invB = bpB * qB;
            const valA = ltpA * qA;
            const valB = ltpB * qB;

            const pnlAmtA = valA - invA;
            const pnlAmtB = valB - invB;

            const pnlPctA = invA > 0 ? (pnlAmtA / invA) * 100 : 0;
            const pnlPctB = invB > 0 ? (pnlAmtB / invB) * 100 : 0;

            const dayAmtA = (infoA && !infoA.error && infoA.change !== undefined) ? (Number(infoA.change) * qA) : 0;
            const dayAmtB = (infoB && !infoB.error && infoB.change !== undefined) ? (Number(infoB.change) * qB) : 0;

            const dayPctA = (infoA && !infoA.error && infoA.change_pct !== undefined && infoA.change_pct !== null && !isNaN(infoA.change_pct)) ? Number(infoA.change_pct) : -Infinity;
            const dayPctB = (infoB && !infoB.error && infoB.change_pct !== undefined && infoB.change_pct !== null && !isNaN(infoB.change_pct)) ? Number(infoB.change_pct) : -Infinity;

            const daysA = typeof getHoldingDays === 'function' ? getHoldingDays(buyDateA) : 0;
            const daysB = typeof getHoldingDays === 'function' ? getHoldingDays(buyDateB) : 0;

            switch (pfSortOption) {
                case 'day_pnl_amt_desc':
                case 'day_pnl_desc':
                    return dayAmtB - dayAmtA;
                case 'day_pnl_amt_asc':
                case 'day_pnl_asc':
                    return dayAmtA - dayAmtB;
                case 'day_pnl_pct_desc':
                    return dayPctB - dayPctA;
                case 'day_pnl_pct_asc':
                    return dayPctA - dayPctB;
                case 'pnl_amt_desc':
                    return pnlAmtB - pnlAmtA;
                case 'pnl_amt_asc':
                    return pnlAmtA - pnlAmtB;
                case 'pnl_pct_desc':
                case 'pnl_desc':
                    return pnlPctB - pnlPctA;
                case 'pnl_pct_asc':
                case 'pnl_asc':
                    return pnlPctA - pnlPctB;
                case 'name_asc':
                    return (symA || '').localeCompare(symB || '');
                case 'name_desc':
                    return (symB || '').localeCompare(symA || '');
                case 'inv_desc':
                    return invB - invA;
                case 'inv_asc':
                    return invA - invB;
                case 'ltp_change_desc':
                    return dayPctB - dayPctA;
                case 'ltp_change_asc':
                    return dayPctA - dayPctB;
                case 'val_desc':
                    return valB - valA;
                case 'val_asc':
                    return valA - valB;
                case 'duration_desc':
                    return daysB - daysA;
                case 'duration_asc':
                    return daysA - daysB;
                case 'date_desc':
                    return (buyDateB || '').localeCompare(buyDateA || '');
                case 'date_asc':
                    return (buyDateA || '').localeCompare(buyDateB || '');
                default:
                    return 0;
            }
        }

        function compareDayPnl(symA, symB, qtyA, qtyB, desc = true) {
            return compareHoldings(symA, symB, qtyA, qtyB, 0, 0, '', '');
        }

        function getPfHeaderSortIcon(descOption, ascOption) {
            if (pfSortOption === descOption || (descOption === 'day_pnl_desc' && pfSortOption === 'day_pnl_amt_desc') || (descOption === 'pnl_desc' && pfSortOption === 'pnl_pct_desc')) return '<span style="color:#10b981; margin-left:4px;">▼</span>';
            if (ascOption && (pfSortOption === ascOption || (ascOption === 'day_pnl_asc' && pfSortOption === 'day_pnl_amt_asc') || (ascOption === 'pnl_asc' && pfSortOption === 'pnl_pct_asc'))) return '<span style="color:#10b981; margin-left:4px;">▲</span>';
            return '<span style="opacity:0.3; margin-left:4px;">↕</span>';
        }

        function togglePfSortHeader(descOption, ascOption) {
            if ((pfSortOption === descOption || (descOption === 'day_pnl_desc' && pfSortOption === 'day_pnl_amt_desc') || (descOption === 'pnl_desc' && pfSortOption === 'pnl_pct_desc')) && ascOption) {
                pfSortOption = ascOption;
            } else {
                pfSortOption = descOption;
            }
            const select = document.getElementById('pf-sort-select');
            if (select) select.value = pfSortOption;
            renderPortfolios();
        }
        window.togglePfSortHeader = togglePfSortHeader;

        function reorderPortfolioTableRows() {
            // 1. Desktop table
            const tbody = document.querySelector('.pf-table tbody');
            if (tbody) {
                const rows = Array.from(tbody.querySelectorAll('tr.pf-row'));
                if (rows.length > 1) {
                    rows.sort((rowA, rowB) => {
                        return compareHoldings(
                            rowA.getAttribute('data-symbol') || '',
                            rowB.getAttribute('data-symbol') || '',
                            parseFloat(rowA.getAttribute('data-qty') || '0'),
                            parseFloat(rowB.getAttribute('data-qty') || '0'),
                            parseFloat(rowA.getAttribute('data-buy-price') || '0'),
                            parseFloat(rowB.getAttribute('data-buy-price') || '0'),
                            rowA.getAttribute('data-buy-date') || '',
                            rowB.getAttribute('data-buy-date') || ''
                        );
                    });
                    rows.forEach(r => tbody.appendChild(r));
                }
            }

            // 2. Mobile cards
            const mobList = document.querySelector('.pf-mob-list');
            if (mobList) {
                const cards = Array.from(mobList.querySelectorAll('.pf-mob-card'));
                if (cards.length > 1) {
                    cards.sort((cardA, cardB) => {
                        return compareHoldings(
                            cardA.getAttribute('data-symbol') || '',
                            cardB.getAttribute('data-symbol') || '',
                            parseFloat(cardA.getAttribute('data-qty') || '0'),
                            parseFloat(cardB.getAttribute('data-qty') || '0'),
                            parseFloat(cardA.getAttribute('data-buy-price') || '0'),
                            parseFloat(cardB.getAttribute('data-buy-price') || '0'),
                            cardA.getAttribute('data-buy-date') || '',
                            cardB.getAttribute('data-buy-date') || ''
                        );
                    });
                    cards.forEach(c => mobList.appendChild(c));
                }
            }
        }
        window.reorderPortfolioTableRows = reorderPortfolioTableRows;

        async function fetchPortfolios() {
            const res = await fetch('/api/portfolios');
            portfoliosData = await res.json();
            window.portfoliosLoaded = true;
            
            await fetchTransactions();

            const names = Object.keys(portfoliosData);
            if (names.length > 1) {
                if (!activePortfolioName || (!portfoliosData[activePortfolioName] && activePortfolioName !== 'All')) {
                    activePortfolioName = 'All';
                }
            } else if (names.length === 1) {
                if (!activePortfolioName || !portfoliosData[activePortfolioName] || activePortfolioName === 'All') {
                    activePortfolioName = names[0];
                }
            } else {
                activePortfolioName = '';
            }

            // Initial render with placeholders / cached state
            renderPortfolios();

            // Fetch live prices and re-render so Day P&L High to Low sort is fully applied initially
            if (typeof refreshPrices === 'function') {
                await refreshPrices();
            }
            renderPortfolios();
        }
        window.fetchPortfolios = fetchPortfolios;

        async function createPortfolio() {
            const input = document.getElementById('new-portfolio-name');
            const name = input.value.trim();
            if (!name) return;

            const res = await fetch('/api/portfolios', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const data = await res.json();
            if (data.success) {
                input.value = '';
                portfoliosData = data.portfolios;
                activePortfolioName = name;
                renderPortfolios();
                refreshPrices();
            } else {
                alert(data.error);
            }
        }

        function openCreatePortfolioModal() {
            const input = document.getElementById('modal-new-portfolio-name');
            if (input) input.value = '';
            const modal = document.getElementById('createPortfolioModal');
            if (modal) modal.style.display = 'block';
        }

        function closeCreatePortfolioModal() {
            const modal = document.getElementById('createPortfolioModal');
            if (modal) modal.style.display = 'none';
        }

        async function submitCreatePortfolio() {
            const input = document.getElementById('modal-new-portfolio-name');
            const name = input.value.trim();
            if (!name) {
                alert('Please enter a portfolio name!');
                return;
            }
            const res = await fetch('/api/portfolios', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const data = await res.json();
            if (data.success) {
                closeCreatePortfolioModal();
                portfoliosData = data.portfolios;
                activePortfolioName = name;
                renderPortfolios();
                refreshPrices();
            } else {
                alert(data.error || 'Failed to create portfolio');
            }
        }

        function openAddHoldingModal() {
            const pfNames = Object.keys(portfoliosData);
            if (pfNames.length === 0) {
                alert('Please create a portfolio first!');
                return;
            }
            const isAll = activePortfolioName === 'All' && pfNames.length > 1;
            const titleEl = document.getElementById('addHoldingModalTitle');
            if (titleEl) {
                titleEl.innerText = isAll ? 'Add Holding to Portfolio' : `Add Holding to ${activePortfolioName}`;
            }

            const pfGroup = document.getElementById('modal-pf-add-portfolio-group');
            const pfSelect = document.getElementById('modal-pf-add-portfolio');
            if (pfGroup && pfSelect) {
                pfSelect.innerHTML = '';
                pfNames.forEach(name => {
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.innerText = name;
                    if (name === activePortfolioName) opt.selected = true;
                    pfSelect.appendChild(opt);
                });
                if (isAll || pfNames.length > 1) {
                    pfGroup.style.display = 'block';
                } else {
                    pfGroup.style.display = 'none';
                }
            }
            
            document.getElementById('modal-pf-add-symbol').value = '';
            document.getElementById('modal-pf-add-price').value = '';
            document.getElementById('modal-pf-add-qty').value = '';
            document.getElementById('modal-pf-add-date').value = new Date().toISOString().split('T')[0];
            const reasonInput = document.getElementById('modal-pf-add-reason');
            if (reasonInput) reasonInput.value = '';
            
            const modal = document.getElementById('addHoldingModal');
            if (modal) modal.style.display = 'block';
        }

        function closeAddHoldingModal() {
            const modal = document.getElementById('addHoldingModal');
            if (modal) modal.style.display = 'none';
        }

        async function submitAddHolding() {
            const pfNames = Object.keys(portfoliosData);
            const isAll = activePortfolioName === 'All' && pfNames.length > 1;
            let targetPf = activePortfolioName;
            if (isAll || !targetPf || !portfoliosData[targetPf]) {
                const pfSelect = document.getElementById('modal-pf-add-portfolio');
                targetPf = pfSelect ? pfSelect.value : (pfNames[0] || '');
            }
            if (!targetPf) {
                alert('Please select or create a portfolio first!');
                return;
            }

            const symInput = document.getElementById('modal-pf-add-symbol');
            const priceInput = document.getElementById('modal-pf-add-price');
            const qtyInput = document.getElementById('modal-pf-add-qty');
            const dateInput = document.getElementById('modal-pf-add-date');
            const reasonInput = document.getElementById('modal-pf-add-reason');

            const symbol = symInput.value.trim();
            const buy_price = parseFloat(priceInput.value);
            const quantity = parseFloat(qtyInput.value);
            const buy_date = dateInput.value || new Date().toISOString().split('T')[0];
            const buy_reason = reasonInput ? reasonInput.value.trim() : '';

            if (!symbol || isNaN(buy_price) || isNaN(quantity) || quantity <= 0) {
                alert('Please enter valid Stock Symbol, Buy Price, and Quantity!');
                return;
            }

            const res = await fetch(`/api/portfolios/${encodeURIComponent(targetPf)}/stocks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol, buy_price, quantity, buy_date, buy_reason })
            });
            const data = await res.json();
            if (data.success) {
                closeAddHoldingModal();
                portfoliosData = data.portfolios;
                renderPortfolios();
                refreshPrices();
            } else {
                alert(data.error || 'Failed to add holding');
            }
        }

        function exportActivePortfolioToExcel() {
            const pfNames = Object.keys(portfoliosData);
            const isAll = activePortfolioName === 'All' && pfNames.length > 1;
            if (!activePortfolioName || (!portfoliosData[activePortfolioName] && !isAll)) {
                alert('No active portfolio selected to export!');
                return;
            }

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

            if (holdings.length === 0) {
                alert('Active portfolio is empty!');
                return;
            }

            // Apply exact current Portfolio Filtering
            if (pfFilterOption === 'st') {
                holdings = holdings.filter(h => getHoldingDays(h.buy_date) < 365);
            } else if (pfFilterOption === 'lt') {
                holdings = holdings.filter(h => getHoldingDays(h.buy_date) >= 365);
            }

            // Apply exact current Portfolio Sorting
            holdings.sort((a, b) => compareHoldings(a.symbol, b.symbol, a.quantity, b.quantity, a.buy_price, b.buy_price, a.buy_date, b.buy_date));

            let csvRows = [];
            const headerRow = [
                'Stock Symbol'
            ];
            if (isAll) headerRow.push('Portfolio');
            headerRow.push(
                'Company Name',
                'Type',
                'Term',
                'Holding Duration',
                'Quantity',
                'Avg Buy Price (INR)',
                'LTP (INR)',
                'Invested Amount (INR)',
                'Current Value (INR)',
                'Overall P&L Amount (INR)',
                'Overall P&L (%)',
                'Day P&L Amount (INR)',
                'Day P&L (%)',
                'Buy Date',
                'Buy Reason / Thesis'
            );
            csvRows.push(headerRow);

            let totInv = 0;
            let totVal = 0;
            let totDayPnl = 0;

            holdings.forEach(item => {
                const sym = item.symbol;
                const info = stockPricesData[sym] || {};
                const ltp = info.price || item.buy_price;
                const dayChange = info.change || 0;

                const invAmt = item.buy_price * item.quantity;
                const curVal = ltp > 0 ? (ltp * item.quantity) : invAmt;
                const pnlAmt = curVal - invAmt;
                const pnlPct = invAmt > 0 ? (pnlAmt / invAmt) * 100 : 0;
                const dayPnLAmt = ltp > 0 ? dayChange * item.quantity : 0;
                const dayPnlPct = info.change_pct !== undefined ? info.change_pct : 0;

                const daysHeld = getHoldingDays(item.buy_date);
                const termLabel = daysHeld >= 365 ? 'Long Term' : 'Short Term';
                const durationStr = formatHoldingDuration(item.buy_date);
                const bInfo = getSymbolBadge(sym);
                const name = info.name || sym;
                const reason = item.buy_reason || item.notes || '';

                totInv += invAmt;
                totVal += curVal;
                totDayPnl += dayPnLAmt;

                const rowData = [`"${sym}"`];
                if (isAll) rowData.push(`"${(item.portfolioName || '').replace(/"/g, '""')}"`);
                rowData.push(
                    `"${name.replace(/"/g, '""')}"`,
                    `"${bInfo.label}"`,
                    `"${termLabel}"`,
                    `"${durationStr}"`,
                    item.quantity,
                    item.buy_price.toFixed(2),
                    ltp.toFixed(2),
                    invAmt.toFixed(2),
                    curVal.toFixed(2),
                    pnlAmt.toFixed(2),
                    `"${pnlPct.toFixed(2)}%"`,
                    dayPnLAmt.toFixed(2),
                    `"${dayPnlPct.toFixed(2)}%"`,
                    `"${item.buy_date || ''}"`,
                    `"${reason.replace(/"/g, '""')}"`
                );
                csvRows.push(rowData);
            });

            // Summary Totals Row
            const totPnlAmt = totVal - totInv;
            const totPnlPct = totInv > 0 ? (totPnlAmt / totInv) * 100 : 0;
            const prevTotVal = totVal - totDayPnl;
            const totDayPnlPct = prevTotVal > 0 ? (totDayPnl / prevTotVal) * 100 : 0;

            csvRows.push([]);
            const totalsRow = ['"TOTAL PORTFOLIO"'];
            if (isAll) totalsRow.push('""');
            totalsRow.push(
                '""',
                '""',
                '""',
                '""',
                '""',
                '""',
                '""',
                totInv.toFixed(2),
                totVal.toFixed(2),
                totPnlAmt.toFixed(2),
                `"${totPnlPct.toFixed(2)}%"`,
                totDayPnl.toFixed(2),
                `"${totDayPnlPct.toFixed(2)}%"`,
                '""',
                '""'
            );
            csvRows.push(totalsRow);

            const csvContent = '\uFEFF' + csvRows.map(e => e.join(',')).join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const safeName = isAll ? 'all_portfolios' : activePortfolioName.toLowerCase().replace(/[^a-z0-9]/g, '_');
            const dateStr = new Date().toISOString().split('T')[0];
            link.href = URL.createObjectURL(blob);
            link.setAttribute('download', `${safeName}_portfolio_${dateStr}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        async function deleteActivePortfolio(targetName = null) {
            const nameToDelete = (typeof targetName === 'string' && targetName.trim() !== '') ? targetName.trim() : activePortfolioName;
            if (!nameToDelete) {
                (window.nativeAlert || alert)('No active portfolio selected to delete. Please select or create a portfolio first.');
                return;
            }

            if (nameToDelete === 'All') {
                (window.nativeAlert || alert)('Cannot delete the aggregated "All" view. Please select an individual portfolio to delete.');
                return;
            }

            const confirmFn = window.nativeConfirm || confirm;
            const confirmed = confirmFn(`Are you sure you want to permanently delete portfolio "${nameToDelete}"?\n\nAll holdings, transaction history, and analytics in this portfolio will be removed.`);

            if (!confirmed) return;

            try {
                const res = await fetch(`/api/portfolios/${encodeURIComponent(nameToDelete)}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    (window.nativeAlert || alert)(`Portfolio "${nameToDelete}" deleted successfully.`);
                    portfoliosData = data.portfolios;
                    const names = Object.keys(portfoliosData);
                    if (activePortfolioName === nameToDelete) {
                        activePortfolioName = names.length > 1 ? 'All' : (names.length === 1 ? names[0] : '');
                    }
                    renderPortfolios();
                    refreshPrices();
                } else {
                    (window.nativeAlert || alert)(data.error || 'Failed to delete portfolio.');
                }
            } catch (err) {
                console.error('Delete portfolio error:', err);
                (window.nativeAlert || alert)('Error deleting portfolio. Please check network connection.');
            }
        }

        function selectPortfolio(name) {
            activePortfolioName = name;
            renderPortfolios();
            refreshPrices();
            if (typeof updateMobileHeaderActiveBadge === 'function') updateMobileHeaderActiveBadge();
        }

        function togglePfMobileMenu(eOrState) {
            if (eOrState && typeof eOrState.stopPropagation === 'function') {
                eOrState.stopPropagation();
            }
            const menu = document.getElementById('pf-mobile-menu-dropdown');
            const btn = document.getElementById('pf-mobile-menu-btn');
            if (!menu) return;

            let willShow;
            if (typeof eOrState === 'boolean') {
                willShow = eOrState;
            } else {
                willShow = !menu.classList.contains('show');
            }

            const delBtn = document.getElementById('pf-mob-delete-btn');
            const delDivider = document.getElementById('pf-mob-delete-divider');
            const isDeletable = activePortfolioName && activePortfolioName !== 'All' && portfoliosData[activePortfolioName];
            if (delBtn) delBtn.style.display = isDeletable ? 'flex' : 'none';
            if (delDivider) delDivider.style.display = isDeletable ? 'block' : 'none';

            if (willShow) {
                menu.classList.add('show');
                menu.style.display = 'flex';
                if (btn) btn.classList.add('active');
            } else {
                menu.classList.remove('show');
                menu.style.display = 'none';
                if (btn) btn.classList.remove('active');
            }
        }
        window.togglePfMobileMenu = togglePfMobileMenu;
        window.openAddHoldingModal = openAddHoldingModal;
        window.openCreatePortfolioModal = openCreatePortfolioModal;
        window.deleteActivePortfolio = deleteActivePortfolio;

        document.addEventListener('click', function(e) {
            const wrapper = document.querySelector('.portfolio-mobile-menu-wrapper');
            if (wrapper && !wrapper.contains(e.target)) {
                const menu = document.getElementById('pf-mobile-menu-dropdown');
                const btn = document.getElementById('pf-mobile-menu-btn');
                if (menu && (menu.classList.contains('show') || menu.style.display !== 'none')) {
                    menu.classList.remove('show');
                    menu.style.display = 'none';
                    if (btn) btn.classList.remove('active');
                }
            }
        });

        let lastPfIsMobile = window.innerWidth <= 768;
        window.addEventListener('resize', () => {
            const currentIsMobile = window.innerWidth <= 768;
            if (currentIsMobile !== lastPfIsMobile) {
                lastPfIsMobile = currentIsMobile;
                if (currentTab === 'portfolios' && window.portfoliosLoaded) {
                    renderPortfolios();
                    if (typeof refreshPrices === 'function') refreshPrices();
                }
            }
        });

        async function addPortfolioStock() {
            if (!activePortfolioName) return;
            const symInput = document.getElementById('pf-add-symbol');
            const priceInput = document.getElementById('pf-add-price');
            const qtyInput = document.getElementById('pf-add-qty');
            const dateInput = document.getElementById('pf-add-date');

            const symbol = symInput.value.trim();
            const buy_price = parseFloat(priceInput.value);
            const quantity = parseFloat(qtyInput.value);
            const buy_date = dateInput.value || new Date().toISOString().split('T')[0];

            if (!symbol || isNaN(buy_price) || isNaN(quantity) || quantity <= 0) {
                showToast('Please enter valid Stock Symbol, Buy Price, and Quantity!', 'error');
                return;
            }

            const res = await fetch(`/api/portfolios/${encodeURIComponent(activePortfolioName)}/stocks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol, buy_price, quantity, buy_date })
            });
            const data = await res.json();
            if (data.success) {
                symInput.value = '';
                priceInput.value = '';
                qtyInput.value = '';
                showToast(`Added ${symbol} to ${activePortfolioName}`, 'success');
                portfoliosData = data.portfolios;
                if (data.transactions) userTransactionsData = data.transactions;
                renderPortfolios();
                refreshPrices();
            } else {
                showToast(data.error || 'Failed to add portfolio stock', 'error');
            }
        }

        async function removePortfolioStock(symbol, targetPortfolio = null) {
            const pfNames = Object.keys(portfoliosData);
            const pfName = targetPortfolio || (currentDetailHolding && currentDetailHolding.portfolioName) || (activePortfolioName !== 'All' ? activePortfolioName : pfNames[0]);
            if (!pfName || !await showCustomConfirm({ title: 'Remove Stock', message: `Remove ${symbol} from ${pfName}? (This will delete it from database without a sell transaction)`, isDanger: true })) return;
            try {
                const res = await fetch(`/api/portfolios/${encodeURIComponent(pfName)}/stocks/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    portfoliosData = data.portfolios;
                    renderPortfolios();
                    refreshPrices();
                    showToast(`Removed ${symbol} from ${pfName}`, 'info');
                } else {
                    showToast(data.error || 'Failed to remove stock', 'error');
                }
            } catch (err) {
                console.error('Remove portfolio stock error:', err);
                showToast('Failed to remove stock. Please check network connection.', 'error');
            }
        }

        let currentEditHoldingPortfolio = '';

        function openEditModal(symbol, curPrice, curQty, curDate, curReason, targetPortfolio = null) {
            const pfNames = Object.keys(portfoliosData);
            currentEditHoldingPortfolio = targetPortfolio || (currentDetailHolding && currentDetailHolding.portfolioName) || (activePortfolioName !== 'All' ? activePortfolioName : pfNames[0]);
            document.getElementById('editHoldingSymbol').value = symbol;
            document.getElementById('editHoldingTitle').innerText = `Edit ${cleanDisplaySymbol(symbol)} (${currentEditHoldingPortfolio})`;
            document.getElementById('editBuyPrice').value = curPrice;
            document.getElementById('editQuantity').value = curQty;
            document.getElementById('editBuyDate').value = curDate || new Date().toISOString().split('T')[0];
            const reasonEl = document.getElementById('editBuyReason');
            if (reasonEl) reasonEl.value = curReason || '';
            document.getElementById('editHoldingModal').style.display = 'block';
        }

        function closeEditModal() {
            document.getElementById('editHoldingModal').style.display = 'none';
        }

        async function saveEditHolding() {
            const pfName = currentEditHoldingPortfolio || (activePortfolioName !== 'All' ? activePortfolioName : '');
            if (!pfName) return;
            const symbol = document.getElementById('editHoldingSymbol').value;
            const buy_price = parseFloat(document.getElementById('editBuyPrice').value);
            const quantity = parseFloat(document.getElementById('editQuantity').value);
            const buy_date = document.getElementById('editBuyDate').value;
            const reasonEl = document.getElementById('editBuyReason');
            const buy_reason = reasonEl ? reasonEl.value.trim() : '';

            if (isNaN(buy_price) || isNaN(quantity) || quantity <= 0) {
                alert('Invalid input values!');
                return;
            }

            const res = await fetch(`/api/portfolios/${encodeURIComponent(pfName)}/stocks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol, buy_price, quantity, buy_date, buy_reason, mode: 'edit' })
            });
            const data = await res.json();
            if (data.success) {
                closeEditModal();
                portfoliosData = data.portfolios;
                renderPortfolios();
                refreshPrices();
            } else {
                alert(data.error);
            }
        }

        function renderTransactionsTable() {
            const tbody = document.getElementById('transactions-tbody');
            const summaryMount = document.getElementById('tx-summary-cards');
            const footerMount = document.getElementById('tx-table-footer');
            if (!tbody) return;

            const query = (document.getElementById('tx-search-input')?.value || '').toLowerCase().trim();
            const rowLimitVal = document.getElementById('tx-rows-select')?.value || 'all';
            let txs = userTransactionsData.slice();

            if (query) {
                txs = txs.filter(t => 
                    t.symbol.toLowerCase().includes(query) ||
                    (t.portfolio || '').toLowerCase().includes(query) ||
                    (t.type || '').toLowerCase().includes(query) ||
                    (t.notes || '').toLowerCase().includes(query)
                );
            }

            let totalRealizedPnl = 0;
            let sellCount = 0;
            let buyCount = 0;

            userTransactionsData.forEach(t => {
                if (t.type === 'SELL') {
                    totalRealizedPnl += (t.realized_pnl || 0);
                    sellCount++;
                } else {
                    buyCount++;
                }
            });

            if (summaryMount) {
                const pnlPos = totalRealizedPnl >= 0;
                const pnlSign = pnlPos ? '+' : '';
                const pnlColor = pnlPos ? '#10b981' : '#ef4444';

                summaryMount.innerHTML = `
                    <div class="tx-kpi-card tx-kpi-pnl" style="background: var(--bg-subtle); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-size: 11px; color: var(--text-secondary); font-weight: 600;">TOTAL REALIZED P&L</div>
                        <div style="font-size: 15px; font-weight: 800; color: ${pnlColor}; margin-top: 2px;">
                            ${isPrivacyMode ? '₹ ••••••' : `${pnlSign}₹${Math.abs(totalRealizedPnl).toLocaleString('en-IN', {minimumFractionDigits: 2})}`}
                        </div>
                    </div>
                    <div class="tx-kpi-card tx-kpi-sell" style="background: var(--bg-subtle); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-size: 11px; color: var(--text-secondary); font-weight: 600;">SELL EXECUTIONS</div>
                        <div style="font-size: 15px; font-weight: 800; color: var(--text-primary); margin-top: 2px;">
                            ${sellCount} Trades Closed
                        </div>
                    </div>
                    <div class="tx-kpi-card tx-kpi-buy" style="background: var(--bg-subtle); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-size: 11px; color: var(--text-secondary); font-weight: 600;">BUY EXECUTIONS</div>
                        <div style="font-size: 15px; font-weight: 800; color: var(--text-primary); margin-top: 2px;">
                            ${buyCount} Purchases
                        </div>
                    </div>
                `;
            }

            if (txs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding: 25px; color: var(--text-secondary);">No transactions recorded yet. Executed Buy & Sell orders will appear here automatically!</td></tr>';
                if (footerMount) footerMount.innerHTML = '<span>Showing 0 transactions</span>';
                return;
            }

            let displayTxs = txs;
            if (rowLimitVal !== 'all') {
                const limit = parseInt(rowLimitVal, 10);
                if (!isNaN(limit)) {
                    displayTxs = txs.slice(0, limit);
                }
            }

            if (footerMount) {
                footerMount.innerHTML = `
                    <span>Showing <strong>${displayTxs.length}</strong> of <strong>${txs.length}</strong> recorded transactions ${rowLimitVal !== 'all' ? `(Limited to ${rowLimitVal})` : '(All)'}</span>
                    <span style="font-style: italic;">Sorted by execution date</span>
                `;
            }

            tbody.innerHTML = '';
            displayTxs.forEach(t => {
                const tr = document.createElement('tr');
                const isSell = t.type === 'SELL';

                const dateStr = formatDateFormatted(t.date || t.timestamp);
                const pnlAmt = t.realized_pnl || 0;
                const pnlPct = t.realized_pnl_pct || 0;
                const pnlSign = pnlAmt >= 0 ? '+' : '';
                const pnlColor = pnlAmt >= 0 ? '#10b981' : '#ef4444';

                tr.innerHTML = `
                    <td><span style="font-size: 12px; font-weight: 600; color: var(--text-primary);">${dateStr}</span></td>
                    <td><span style="font-size: 12px; color: var(--text-secondary);">${escapeHtml(t.portfolio || 'Portfolio')}</span></td>
                    <td>
                        <span class="stock-symbol" style="font-size: 13px;">${escapeHtml(cleanDisplaySymbol(t.symbol))}</span>
                    </td>
                    <td style="text-align:center;">
                        <span style="font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 4px; ${isSell ? 'background: rgba(239,68,68,0.15); color: #ef4444;' : 'background: rgba(16,185,129,0.15); color: #10b981;'}">
                            ${isSell ? 'SELL' : 'BUY'}
                        </span>
                    </td>
                    <td style="text-align:right; font-weight: 600;">${formatQty(t.quantity)}</td>
                    <td style="text-align:right;">₹${(t.price || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                    <td style="text-align:right; font-weight: 700;">₹${(t.total_amount || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                    <td style="text-align:right; font-weight: 700; color: ${isSell ? pnlColor : 'var(--text-secondary)'};">
                        ${isSell ? (isPrivacyMode ? '₹ ••••••' : `${pnlSign}₹${Math.abs(pnlAmt).toLocaleString('en-IN', {minimumFractionDigits:2})} (${pnlSign}${pnlPct.toFixed(2)}%)`) : '-'}
                    </td>
                    <td style="font-style: italic; font-size: 11px; color: var(--text-secondary);">${escapeHtml(t.notes || '-')}</td>
                    <td style="text-align:center;">
                        <button class="btn-danger" style="font-size: 10px; padding: 2px 6px;" onclick="deleteTransaction('${t.id}')" title="Delete transaction record">🗑️</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        function renderPortfolios() {
            const pfMenu = document.getElementById('pf-mobile-menu-dropdown');
            if (pfMenu) { pfMenu.classList.remove('show'); pfMenu.style.display = 'none'; }
            const pfBtn = document.getElementById('pf-mobile-menu-btn');
            if (pfBtn) pfBtn.classList.remove('active');
            if (typeof updateMobileHeaderActiveBadge === 'function') updateMobileHeaderActiveBadge();
            // 1. Render Selector Bar
            const selectorMount = document.getElementById('portfolio-selector-mount');
            selectorMount.innerHTML = '';

            const pfNames = Object.keys(portfoliosData);
            if (pfNames.length === 0) {
                selectorMount.innerHTML = '<span style="color:#95a5a6; font-size:13px;">No portfolios created yet.</span>';
            } else {
                if (pfNames.length > 1) {
                    const allBtn = document.createElement('button');
                    allBtn.className = `pf-select-btn ${activePortfolioName === 'All' ? 'active' : ''}`;
                    allBtn.innerText = 'All';
                    allBtn.onclick = () => selectPortfolio('All');
                    selectorMount.appendChild(allBtn);
                }
                pfNames.forEach(name => {
                    const btn = document.createElement('button');
                    btn.className = `pf-select-btn ${name === activePortfolioName ? 'active' : ''}`;
                    btn.innerText = name;
                    btn.onclick = () => selectPortfolio(name);
                    selectorMount.appendChild(btn);
                });
            }

            // 2. Render Active Portfolio Details View
            const viewMount = document.getElementById('portfolio-view-mount');
            viewMount.innerHTML = '';

            const isAll = activePortfolioName === 'All' && pfNames.length > 1;
            if (!activePortfolioName || (!portfoliosData[activePortfolioName] && !isAll)) {
                viewMount.innerHTML = `
                    <div class="card-container" style="text-align: center; padding: 40px;">
                        <h3 style="color: #7f8c8d;">No Active Portfolio Selected</h3>
                        <p style="color: #95a5a6;">Create a portfolio above to start tracking your investments!</p>
                    </div>
                `;
                return;
            }

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

            const container = document.createElement('div');
            container.className = 'card-container';

            const headerBar = document.createElement('div');
            headerBar.className = 'header-bar';
            headerBar.innerHTML = `
                <h2>${isAll ? 'All Portfolios' : escapeHtml(activePortfolioName)}</h2>
                <div class="actions">
                    <button onclick="openAddHoldingModal()">+ Add Holding</button>
                    ${!isAll ? `
                    <div class="wl-overflow" id="portfolio-overflow-menu">
                        <button type="button" class="wl-overflow-trigger" aria-label="More portfolio actions" title="More actions" onclick="toggleActionOverflow(event, 'portfolio-overflow-menu')">⋮</button>
                        <div class="wl-overflow-menu" role="menu">
                            <button type="button" class="danger" role="menuitem" onclick="deleteActivePortfolio(); closeActionOverflow(event)">Delete Portfolio</button>
                        </div>
                    </div>` : ''}
                </div>
            `;

            // Calculate instantaneous KPI Data across holdings
            let initialTotInvested = 0;
            let initialTotCurrentVal = 0;
            let initialTotDayPnL = 0;

            holdings.forEach(item => {
                const sym = item.symbol;
                const info = stockPricesData[sym] || {};
                const ltp = info.price || 0;
                const dayChange = info.change || 0;
                const invAmt = item.buy_price * item.quantity;
                const curVal = ltp > 0 ? (ltp * item.quantity) : invAmt;
                const dayPnLAmt = ltp > 0 ? dayChange * item.quantity : 0;

                initialTotInvested += invAmt;
                initialTotCurrentVal += curVal;
                initialTotDayPnL += dayPnLAmt;
            });

            const initialTotPnL = initialTotCurrentVal - initialTotInvested;
            const initialTotPnLPct = initialTotInvested > 0 ? (initialTotPnL / initialTotInvested) * 100 : 0;
            const initialPrevVal = initialTotCurrentVal - initialTotDayPnL;
            const initialTotDayPnLPct = initialPrevVal > 0 ? (initialTotDayPnL / initialPrevVal) * 100 : 0;

            const initInvStr = formatMoney(initialTotInvested);
            const initValStr = formatMoney(initialTotCurrentVal);
            const initPnlSign = initialTotPnL >= 0 ? '+' : '';
            const initPnlStr = isPrivacyMode ? '₹ ••••••' : `${initPnlSign}₹${Math.abs(initialTotPnL).toLocaleString('en-IN', {minimumFractionDigits: 2})}`;
            const initPnlPctStr = `${initPnlSign}${initialTotPnLPct.toFixed(2)}%`;
            const initDaySign = initialTotDayPnL >= 0 ? '+' : '';
            const initDayPnlStr = isPrivacyMode ? '₹ ••••••' : `${initDaySign}₹${Math.abs(initialTotDayPnL).toLocaleString('en-IN', {minimumFractionDigits: 2})}`;
            const initDayPnlPctStr = `${initDaySign}${initialTotDayPnLPct.toFixed(2)}%`;

            const summaryGrid = document.createElement('div');
            summaryGrid.className = 'summary-grid pf-summary-grid';
            summaryGrid.innerHTML = `
                <div class="metric-card">
                    <div class="title"><span class="kpi-lbl-full">Invested Amount</span><span class="kpi-lbl-compact">Invested</span></div>
                    <div class="value" id="pf-summary-invested">${initialTotInvested > 0 ? initInvStr : '<span class="skeleton-box" style="width: 85px; height: 18px;"></span>'}</div>
                    <div class="sub-value" style="color:var(--text-secondary);">${holdings.length} Holdings</div>
                </div>
                <div class="metric-card">
                    <div class="title"><span class="kpi-lbl-full">Current Value</span><span class="kpi-lbl-compact">Current Val</span></div>
                    <div class="value" id="pf-summary-value">${initialTotInvested > 0 ? initValStr : '<span class="skeleton-box" style="width: 85px; height: 18px;"></span>'}</div>
                    <div class="sub-value" style="color:var(--text-secondary);">Live Portfolio Value</div>
                </div>
                <div class="metric-card">
                    <div class="title"><span class="kpi-lbl-full">Overall Return (P&L)</span><span class="kpi-lbl-compact">Overall P&L</span></div>
                    <div class="value" id="pf-summary-pnl" style="color: ${initialTotPnL >= 0 ? '#10b981' : '#ef4444'};">${initialTotInvested > 0 ? initPnlStr : '<span class="skeleton-box" style="width: 85px; height: 18px;"></span>'}</div>
                    <div class="sub-value" id="pf-summary-pnl-pct" style="color: ${initialTotPnL >= 0 ? '#10b981' : '#ef4444'};">${initialTotInvested > 0 ? initPnlPctStr : '<span class="skeleton-box" style="width: 45px; height: 12px;"></span>'}</div>
                </div>
                <div class="metric-card">
                    <div class="title"><span class="kpi-lbl-full">Today's Return</span><span class="kpi-lbl-compact">Day P&L</span></div>
                    <div class="value" id="pf-summary-daypnl" style="color: ${initialTotDayPnL >= 0 ? '#10b981' : '#ef4444'};">${initialTotInvested > 0 ? initDayPnlStr : '<span class="skeleton-box" style="width: 85px; height: 18px;"></span>'}</div>
                    <div class="sub-value" id="pf-summary-daypnl-pct" style="color: ${initialTotDayPnL >= 0 ? '#10b981' : '#ef4444'};">${initialTotInvested > 0 ? initDayPnlPctStr : '<span class="skeleton-box" style="width: 45px; height: 12px;"></span>'}</div>
                </div>
            `;

            // Filter & Sort Control Bar with Export Action & Quick Refresh
            const filterSortDiv = document.createElement('div');
            filterSortDiv.className = 'filter-sort-bar';
            filterSortDiv.innerHTML = `
                <div class="pf-controls-left">
                    <div class="filter-group pf-filter-group">
                        <span class="pf-filter-title">🔍 Filter:</span>
                        <select id="pf-filter-select" onchange="pfFilterOption = this.value; renderPortfolios(); refreshPrices();">
                            <option value="all" ${pfFilterOption === 'all' ? 'selected' : ''}>All Holdings</option>
                            <option value="st" ${pfFilterOption === 'st' ? 'selected' : ''}>Short-Term (< 1 Year)</option>
                            <option value="lt" ${pfFilterOption === 'lt' ? 'selected' : ''}>Long-Term (≥ 1 Year)</option>
                        </select>
                    </div>
                    <div class="sort-group pf-sort-group">
                        <span class="pf-sort-title">↕️ Sort By:</span>
                        <select id="pf-sort-select" onchange="pfSortOption = this.value; renderPortfolios(); refreshPrices();">
                            <option value="day_pnl_amt_desc" ${pfSortOption === 'day_pnl_amt_desc' || pfSortOption === 'day_pnl_desc' ? 'selected' : ''}>Day P&L (High to Low)</option>
                            <option value="day_pnl_amt_asc" ${pfSortOption === 'day_pnl_amt_asc' || pfSortOption === 'day_pnl_asc' ? 'selected' : ''}>Day P&L (Low to High)</option>
                            <option value="day_pnl_pct_desc" ${pfSortOption === 'day_pnl_pct_desc' ? 'selected' : ''}>Day P&L % (High to Low)</option>
                            <option value="day_pnl_pct_asc" ${pfSortOption === 'day_pnl_pct_asc' ? 'selected' : ''}>Day P&L % (Low to High)</option>
                            <option value="pnl_amt_desc" ${pfSortOption === 'pnl_amt_desc' ? 'selected' : ''}>Overall P&L (High to Low)</option>
                            <option value="pnl_amt_asc" ${pfSortOption === 'pnl_amt_asc' ? 'selected' : ''}>Overall P&L (Low to High)</option>
                            <option value="pnl_pct_desc" ${pfSortOption === 'pnl_pct_desc' || pfSortOption === 'pnl_desc' ? 'selected' : ''}>Overall P&L % (High to Low)</option>
                            <option value="pnl_pct_asc" ${pfSortOption === 'pnl_pct_asc' || pfSortOption === 'pnl_asc' ? 'selected' : ''}>Overall P&L % (Low to High)</option>
                            <option value="name_asc" ${pfSortOption === 'name_asc' ? 'selected' : ''}>Stock Symbol (A-Z)</option>
                            <option value="name_desc" ${pfSortOption === 'name_desc' ? 'selected' : ''}>Stock Symbol (Z-A)</option>
                            <option value="inv_desc" ${pfSortOption === 'inv_desc' ? 'selected' : ''}>Invested Amount (High to Low)</option>
                            <option value="inv_asc" ${pfSortOption === 'inv_asc' ? 'selected' : ''}>Invested Amount (Low to High)</option>
                            <option value="ltp_change_desc" ${pfSortOption === 'ltp_change_desc' ? 'selected' : ''}>LTP Change % (High to Low)</option>
                            <option value="ltp_change_asc" ${pfSortOption === 'ltp_change_asc' ? 'selected' : ''}>LTP Change % (Low to High)</option>
                            <option value="val_desc" ${pfSortOption === 'val_desc' ? 'selected' : ''}>Current Value (High to Low)</option>
                            <option value="duration_desc" ${pfSortOption === 'duration_desc' ? 'selected' : ''}>Holding Duration (Longest First)</option>
                            <option value="duration_asc" ${pfSortOption === 'duration_asc' ? 'selected' : ''}>Holding Duration (Shortest First)</option>
                            <option value="date_desc" ${pfSortOption === 'date_desc' ? 'selected' : ''}>Buy Date (Newest First)</option>
                            <option value="date_asc" ${pfSortOption === 'date_asc' ? 'selected' : ''}>Buy Date (Oldest First)</option>
                        </select>
                    </div>
                </div>
                <div class="pf-controls-right">
                    <button class="pf-refresh-btn" onclick="if(typeof refreshPrices === 'function') refreshPrices();" title="Refresh Portfolio Quotes" aria-label="Refresh Quotes">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                        </svg>
                    </button>
                    <button class="btn-secondary pf-export-btn" style="font-size: 12px; padding: 6px 14px;" onclick="exportActivePortfolioToExcel()" title="Export current filtered & sorted portfolio table data to Excel">📥 Export Excel</button>
                </div>
            `;

            // Apply Filtering
            if (pfFilterOption === 'st') {
                holdings = holdings.filter(h => getHoldingDays(h.buy_date) < 365);
            } else if (pfFilterOption === 'lt') {
                holdings = holdings.filter(h => getHoldingDays(h.buy_date) >= 365);
            }

            // Apply Sorting
            holdings.sort((a, b) => compareHoldings(a.symbol, b.symbol, a.quantity, b.quantity, a.buy_price, b.buy_price, a.buy_date, b.buy_date));

            // Table Container (Non-congested, Fits 100% Screen Container)
            const scrollContainer = document.createElement('div');
            scrollContainer.className = 'table-responsive-container pf-table-responsive-container';

            const isMobile = window.innerWidth <= 768;

            if (isMobile) {
                // Mobile Native Fintech Holding Card Layout (Refer Image 2)
                const mobContainer = document.createElement('div');
                mobContainer.className = 'pf-mobile-list-container';

                const mobList = document.createElement('div');
                mobList.className = 'pf-mob-list';

                if (holdings.length === 0) {
                    mobList.innerHTML = `
                        <div class="pf-mob-empty">
                            <span style="font-size: 28px; margin-bottom: 8px; display: inline-block;">📁</span>
                            <div style="font-weight: 600; font-size: 14px; color: var(--text-primary); margin-bottom: 4px;">No holdings found</div>
                            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 14px;">No stocks match your filter criteria.</div>
                            <button class="btn-primary" style="font-size: 12px; padding: 6px 16px;" onclick="openAddHoldingModal()">+ Add Holding</button>
                        </div>
                    `;
                } else {
                    holdings.forEach(item => {
                        const sym = item.symbol;
                        const bInfo = getSymbolBadge(sym);
                        const safePf = (item.portfolioName || activePortfolioName || '').replace(/[^a-zA-Z0-9_-]/g, '_');
                        const safeSym = sym.replace(/[^a-zA-Z0-9_-]/g, '_');
                        const rowKey = `${safePf}_${safeSym}`;

                        const info = stockPricesData[sym] || {};
                        const ltp = info.price || 0;
                        const dayChange = info.change || 0;
                        const invAmt = item.buy_price * item.quantity;
                        const curVal = ltp > 0 ? (ltp * item.quantity) : invAmt;
                        const pnlAmt = curVal - invAmt;
                        const pnlPct = invAmt > 0 ? (pnlAmt / invAmt) * 100 : 0;
                        const dayPnLAmt = ltp > 0 ? dayChange * item.quantity : 0;
                        const dayPnlPct = info.change_pct !== undefined ? info.change_pct : 0;

                        const pnlSign = pnlAmt >= 0 ? '+' : '';
                        const pnlClass = pnlAmt >= 0 ? 'pos' : 'neg';
                        const daySign = dayPnLAmt >= 0 ? '+' : '';
                        const dayClass = dayPnLAmt >= 0 ? 'pos' : 'neg';

                        const itemEl = document.createElement('div');
                        itemEl.className = 'pf-mob-card';
                        itemEl.id = `pf-mob-card-${rowKey}`;
                        itemEl.setAttribute('data-symbol', sym);
                        itemEl.setAttribute('data-qty', item.quantity);
                        itemEl.setAttribute('data-buy-price', item.buy_price);
                        itemEl.setAttribute('data-buy-date', item.buy_date || '');
                        itemEl.title = 'Tap to view technical chart';
                        itemEl.onclick = (e) => {
                            if (typeof openInHouseChart === 'function') openInHouseChart(sym);
                            else if (typeof window.openInHouseChart === 'function') window.openInHouseChart(sym);
                        };

                        const atpStr = isPrivacyMode ? '••••••' : `₹${item.buy_price.toLocaleString('en-IN', {minimumFractionDigits: 2})}`;
                        const ltpStr = ltp > 0 ? (isPrivacyMode ? '••••••' : `₹${ltp.toLocaleString('en-IN', {minimumFractionDigits: 2})}`) : '-';
                        const invStr = isPrivacyMode ? '₹ ••••••' : `₹${Math.round(invAmt).toLocaleString('en-IN')}`;
                        const valStr = isPrivacyMode ? '₹ ••••••' : `₹${Math.round(curVal).toLocaleString('en-IN')}`;

                        itemEl.innerHTML = `
                            <!-- Row 1: Symbol & Badges (Left) | Total P&L & Overall % (Right) -->
                            <div class="pf-mob-card-header">
                                <div class="pf-mob-sym-group" title="Tap to view holding details">
                                    <div class="pf-mob-sym-row">
                                        <span class="pf-mob-sym">${cleanDisplaySymbol(sym)}</span>
                                        <span class="badge ${bInfo.class}">${bInfo.label}</span>
                                        ${isAll ? `<span class="badge pf-badge">📁 ${escapeHtml(item.portfolioName)}</span>` : ''}
                                    </div>
                                </div>
                                <div class="pf-mob-pnl-group">
                                    <span class="pf-mob-pnl-line ${pnlClass}" id="pf-pnl-${rowKey}">
                                        ${ltp > 0
                                            ? (isPrivacyMode
                                                ? `₹ •••••• <span class="pf-mob-pct-val">(${pnlSign}${pnlPct.toFixed(2)}%)</span>`
                                                : `${pnlSign}₹${Math.abs(pnlAmt).toLocaleString('en-IN', {minimumFractionDigits: 2})} <span class="pf-mob-pct-val">(${pnlSign}${pnlPct.toFixed(2)}%)</span>`)
                                            : '<span class="skeleton-box" style="width: 80px; height: 14px;"></span>'
                                        }
                                    </span>
                                </div>
                            </div>

                            <!-- Row 2 & 3: ATP & Shares (Left) | LTP & Today Gain/Loss (Right) -->
                            <div class="pf-mob-card-body">
                                <div class="pf-mob-body-col">
                                    <div class="pf-mob-stat-row">
                                        <span class="pf-mob-stat-label">ATP</span>
                                        <span class="pf-mob-stat-value">${atpStr}</span>
                                    </div>
                                    <div class="pf-mob-stat-row">
                                        <span class="pf-mob-stat-label">Shares</span>
                                        <span class="pf-mob-stat-value">${formatQty(item.quantity)}</span>
                                    </div>
                                </div>
                                <div class="pf-mob-body-col pf-mob-body-right">
                                    <div class="pf-mob-stat-row pf-mob-stat-row-right">
                                        <span class="pf-mob-stat-label">LTP</span>
                                        <span class="pf-mob-stat-value pf-mob-ltp-val" id="pf-ltp-${rowKey}">${ltpStr}</span>
                                        <span class="pf-mob-stat-change pf-mob-pct-val" id="pf-day-pct-${rowKey}">(${ltp > 0 ? `${daySign}${dayPnlPct.toFixed(2)}%` : '0.00%'})</span>
                                    </div>
                                    <div class="pf-mob-stat-row pf-mob-stat-row-right">
                                        <span class="pf-mob-stat-label" id="pf-day-lbl-${rowKey}">${dayPnLAmt >= 0 ? "Today's Gain" : "Today's Loss"}</span>
                                        <span class="pf-mob-stat-change ${dayClass}" id="pf-daypnl-${rowKey}">
                                            ${ltp > 0
                                                ? (isPrivacyMode
                                                    ? `₹ •••••• <span class="pf-mob-pct-val">(${daySign}${dayPnlPct.toFixed(2)}%)</span>`
                                                    : `${daySign}₹${Math.abs(dayPnLAmt).toLocaleString('en-IN', {minimumFractionDigits: 2})} <span class="pf-mob-pct-val">(${daySign}${dayPnlPct.toFixed(2)}%)</span>`)
                                                : ''
                                            }
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <!-- Divider Line -->
                            <div class="pf-mob-divider"></div>

                            <!-- Row 4: Invested (Left) | Current (Right) -->
                            <div class="pf-mob-card-footer">
                                <div class="pf-mob-footer-col">
                                    <span class="pf-mob-stat-label">Invested</span>
                                    <span class="pf-mob-footer-value" id="pf-inv-${rowKey}">${invStr}</span>
                                </div>
                                <div class="pf-mob-footer-col pf-mob-footer-right">
                                    <span class="pf-mob-stat-label">Current</span>
                                    <span class="pf-mob-footer-value" id="pf-val-${rowKey}">${valStr}</span>
                                </div>
                            </div>
                        `;

                        // Details modal trigger specifically on symbol / company name group
                        const symGroup = itemEl.querySelector('.pf-mob-sym-group');
                        if (symGroup) {
                            symGroup.onclick = (e) => {
                                e.stopPropagation();
                                openHoldingDetailsModal(item);
                            };
                        }

                        mobList.appendChild(itemEl);
                    });
                }
                mobContainer.appendChild(mobList);

                // 3. Mobile Sticky Bottom Summary Bar (Today's Gain / Total P&L)
                const mobBottomBar = document.createElement('div');
                mobBottomBar.className = 'pf-mob-bottom-bar';
                mobBottomBar.innerHTML = `
                    <div class="pf-mob-bar-col">
                        <div class="pf-mob-bar-label">Today's Gain</div>
                        <div class="pf-mob-bar-val ${initialTotDayPnL >= 0 ? 'pos' : 'neg'}" id="pf-foot-daypnl">
                            ${initialTotInvested > 0
                                ? (isPrivacyMode ? `₹ •••••• (${initDayPnlPctStr})` : `${initDayPnlStr} (${initDayPnlPctStr})`)
                                : '₹0.00'}
                        </div>
                    </div>
                    <div class="pf-mob-bar-col" style="text-align: right;">
                        <div class="pf-mob-bar-label">Total P&L</div>
                        <div class="pf-mob-bar-val ${initialTotPnL >= 0 ? 'pos' : 'neg'}" id="pf-foot-pnl">
                            ${initialTotInvested > 0
                                ? (isPrivacyMode ? `₹ •••••• (${initPnlPctStr})` : `${initPnlStr} (${initPnlPctStr})`)
                                : '₹0.00'}
                        </div>
                    </div>
                    <!-- Hidden hooks for live-updater summary calculations -->
                    <span id="pf-foot-inv" style="display:none;">${initialTotInvested > 0 ? initInvStr : '₹0.00'}</span>
                    <span id="pf-foot-val" style="display:none;">${initialTotInvested > 0 ? initValStr : '₹0.00'}</span>
                `;
                mobContainer.appendChild(mobBottomBar);

                scrollContainer.appendChild(mobContainer);
            } else {
                // Desktop 9-Column Table View
                const table = document.createElement('table');
                table.className = 'pf-table';
                const thead = document.createElement('thead');
                thead.innerHTML = `
                    <tr>
                        <th class="pf-col-stock" style="cursor: pointer;" onclick="togglePfSortHeader('name_asc')" title="Sort by Stock Symbol">Stock ${getPfHeaderSortIcon('name_asc')}</th>
                        <th class="pf-col-qty" style="text-align:right;">Qty</th>
                        <th class="pf-col-buy" style="text-align:right;">Avg Buy Price</th>
                        <th class="pf-col-ltp" style="text-align:right;">LTP (₹)</th>
                        <th class="pf-col-inv" style="text-align:right;">Invested (₹)</th>
                        <th class="pf-col-val" style="text-align:right; cursor: pointer;" onclick="togglePfSortHeader('val_desc')" title="Sort by Current Value">Current Val (₹) ${getPfHeaderSortIcon('val_desc')}</th>
                        <th class="pf-col-daypnl" style="text-align:right; cursor: pointer;" onclick="togglePfSortHeader('day_pnl_desc', 'day_pnl_asc')" title="Sort by Day P&L">Day P&L ${getPfHeaderSortIcon('day_pnl_desc', 'day_pnl_asc')}</th>
                        <th class="pf-col-pnl" style="text-align:right; cursor: pointer;" onclick="togglePfSortHeader('pnl_desc', 'pnl_asc')" title="Sort by Overall P&L">Overall P&L ${getPfHeaderSortIcon('pnl_desc', 'pnl_asc')}</th>
                        <th class="pf-col-details" style="text-align:center;">Details</th>
                    </tr>
                `;

                const tbody = document.createElement('tbody');

                if (holdings.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:#64748b; padding: 30px;">No holdings match the selected filter/sort criteria.</td></tr>';
                } else {
                    holdings.forEach(item => {
                        const sym = item.symbol;
                        const bInfo = getSymbolBadge(sym);
                        const safePf = (item.portfolioName || activePortfolioName || '').replace(/[^a-zA-Z0-9_-]/g, '_');
                        const safeSym = sym.replace(/[^a-zA-Z0-9_-]/g, '_');
                        const rowKey = `${safePf}_${safeSym}`;

                        const tr = document.createElement('tr');
                        tr.className = 'pf-row';
                        tr.id = `pf-row-${rowKey}`;
                        tr.setAttribute('data-symbol', sym);
                        tr.setAttribute('data-qty', item.quantity);
                        tr.setAttribute('data-buy-price', item.buy_price);
                        tr.setAttribute('data-buy-date', item.buy_date || '');
                        tr.title = 'Click row to view interactive technical chart';
                        tr.onclick = (e) => {
                            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
                            openInHouseChart(sym);
                        };

                        const tdStock = document.createElement('td');
                        tdStock.className = 'pf-col-stock';
                        tdStock.innerHTML = `<span class="stock-symbol">${cleanDisplaySymbol(sym)}</span> <span class="badge ${bInfo.class}">${bInfo.label}</span>${isAll ? ` <span class="badge pf-badge" style="background: var(--bg-subtle); border: 1px solid var(--border-color); color: var(--text-secondary); font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; margin-left: 4px;">📁 ${escapeHtml(item.portfolioName)}</span>` : ''}<div class="company-name" id="pf-name-${rowKey}"><span class="skeleton-box" style="width: 100px; height: 11px;"></span></div>`;

                        const tdQty = document.createElement('td');
                        tdQty.className = 'pf-col-qty';
                        tdQty.style.textAlign = 'right';
                        tdQty.innerText = formatQty(item.quantity);

                        const tdBuy = document.createElement('td');
                        tdBuy.className = 'pf-col-buy';
                        tdBuy.style.textAlign = 'right';
                        tdBuy.innerText = formatMoney(item.buy_price);

                        const info = stockPricesData[sym] || {};
                        const ltp = info.price || 0;
                        const dayChange = info.change || 0;
                        const invAmt = item.buy_price * item.quantity;
                        const curVal = ltp > 0 ? (ltp * item.quantity) : invAmt;
                        const pnlAmt = curVal - invAmt;
                        const pnlPct = invAmt > 0 ? (pnlAmt / invAmt) * 100 : 0;
                        const dayPnLAmt = ltp > 0 ? dayChange * item.quantity : 0;
                        const dayPnlPct = info.change_pct !== undefined ? info.change_pct : 0;

                        const tdLtp = document.createElement('td');
                        tdLtp.className = 'pf-col-ltp';
                        tdLtp.style.textAlign = 'right';
                        tdLtp.id = `pf-ltp-${rowKey}`;
                        tdLtp.innerText = ltp > 0 ? formatMoney(ltp) : '-';

                        const tdInv = document.createElement('td');
                        tdInv.className = 'pf-col-inv';
                        tdInv.style.textAlign = 'right';
                        tdInv.id = `pf-inv-${rowKey}`;
                        tdInv.innerText = formatMoney(invAmt);

                        const tdVal = document.createElement('td');
                        tdVal.className = 'pf-col-val';
                        tdVal.style.textAlign = 'right';
                        tdVal.id = `pf-val-${rowKey}`;
                        tdVal.innerText = ltp > 0 ? formatMoney(curVal) : formatMoney(invAmt);

                        const tdPnl = document.createElement('td');
                        tdPnl.className = 'pf-col-pnl';
                        tdPnl.style.textAlign = 'right';
                        tdPnl.id = `pf-pnl-${rowKey}`;
                        if (ltp > 0) {
                            const sign = pnlAmt >= 0 ? '+' : '';
                            tdPnl.innerText = isPrivacyMode
                                ? `₹ •••••• (${sign}${pnlPct.toFixed(2)}%)`
                                : `${sign}₹${Math.abs(pnlAmt).toLocaleString('en-IN', {minimumFractionDigits: 2})} (${sign}${pnlPct.toFixed(2)}%)`;
                            tdPnl.className = (pnlAmt >= 0 ? 'pos' : 'neg') + ' pf-col-pnl';
                        } else {
                            tdPnl.innerHTML = `<span class="skeleton-box" style="width: 65px; height: 14px;"></span>`;
                            tdPnl.className = 'pf-col-pnl';
                        }

                        const tdDayPnl = document.createElement('td');
                        tdDayPnl.className = 'pf-col-daypnl';
                        tdDayPnl.style.textAlign = 'right';
                        tdDayPnl.id = `pf-daypnl-${rowKey}`;
                        if (ltp > 0) {
                            const sign = dayPnLAmt >= 0 ? '+' : '';
                            tdDayPnl.innerText = isPrivacyMode
                                ? `₹ •••••• (${sign}${dayPnlPct.toFixed(2)}%)`
                                : `${sign}₹${Math.abs(dayPnLAmt).toLocaleString('en-IN', {minimumFractionDigits: 2})} (${sign}${dayPnlPct.toFixed(2)}%)`;
                            tdDayPnl.className = (dayPnLAmt >= 0 ? 'pos' : 'neg') + ' pf-col-daypnl';
                        } else {
                            tdDayPnl.innerHTML = `<span class="skeleton-box" style="width: 65px; height: 14px;"></span>`;
                            tdDayPnl.className = 'pf-col-daypnl';
                        }

                        const tdDetails = document.createElement('td');
                        tdDetails.className = 'pf-col-details';
                        tdDetails.style.textAlign = 'center';
                        const detailBtn = document.createElement('button');
                        detailBtn.className = 'btn-details';
                        detailBtn.innerHTML = '🔍 Details';
                        detailBtn.onclick = (e) => {
                            e.stopPropagation();
                            openHoldingDetailsModal(item);
                        };
                        tdDetails.appendChild(detailBtn);

                        tr.appendChild(tdStock);
                        tr.appendChild(tdQty);
                        tr.appendChild(tdBuy);
                        tr.appendChild(tdLtp);
                        tr.appendChild(tdInv);
                        tr.appendChild(tdVal);
                        tr.appendChild(tdDayPnl);
                        tr.appendChild(tdPnl);
                        tr.appendChild(tdDetails);

                        tbody.appendChild(tr);
                    });
                }

                const tfoot = document.createElement('tfoot');
                tfoot.innerHTML = `
                    <tr>
                        <td colspan="4" class="pf-col-total" style="text-align:left;">PORTFOLIO TOTAL:</td>
                        <td id="pf-foot-inv" class="pf-col-inv" style="text-align:right;">${initialTotInvested > 0 ? initInvStr : '₹0.00'}</td>
                        <td id="pf-foot-val" class="pf-col-val" style="text-align:right;">${initialTotInvested > 0 ? initValStr : '₹0.00'}</td>
                        <td id="pf-foot-daypnl" class="${initialTotDayPnL >= 0 ? 'pos' : 'neg'} pf-col-daypnl" style="text-align:right;">${initialTotInvested > 0 ? (isPrivacyMode ? `₹ •••••• (${initDayPnlPctStr})` : `${initDayPnlStr} (${initDayPnlPctStr})`) : '₹0.00'}</td>
                        <td id="pf-foot-pnl" class="${initialTotPnL >= 0 ? 'pos' : 'neg'} pf-col-pnl" style="text-align:right;">${initialTotInvested > 0 ? (isPrivacyMode ? `₹ •••••• (${initPnlPctStr})` : `${initPnlStr} (${initPnlPctStr})`) : '₹0.00'}</td>
                        <td class="pf-col-details" style="text-align:center;"></td>
                    </tr>
                `;

                table.appendChild(thead);
                table.appendChild(tbody);
                table.appendChild(tfoot);
                scrollContainer.appendChild(table);
            }

            container.appendChild(headerBar);
            container.appendChild(summaryGrid);
            container.appendChild(filterSortDiv);
            container.appendChild(scrollContainer);

            // 3. Render Realized P&L & Transactions Ledger
            const txContainer = document.createElement('div');
            txContainer.style.cssText = 'margin-top: 32px; padding-top: 24px; border-top: 1px solid var(--border-color);';
            txContainer.className = 'tx-ledger-section';
            txContainer.innerHTML = `
                <div class="tx-header-bar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
                    <div>
                        <h3 style="margin:0; font-size: 16px; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                            📜 Realized P&L & Transaction Log
                        </h3>
                        <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
                            Complete ledger of past Buy & Sell executions for accountability & tracking
                        </div>
                    </div>
                    <div class="tx-controls-wrapper" style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                        <input type="text" id="tx-search-input" class="tx-search-input" placeholder="Search transactions..." style="padding: 6px 12px; font-size: 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-subtle); color: var(--text-primary); min-width: 180px;" onkeyup="renderTransactionsTable()">
                        <div class="tx-filter-row" style="display: flex; align-items: center; gap: 10px;">
                            <div class="tx-rows-group" style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-secondary); font-weight: 600;">
                                <span>Show Rows:</span>
                                <select id="tx-rows-select" onchange="renderTransactionsTable()" style="padding: 5px 8px; font-size: 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-subtle); color: var(--text-primary); cursor: pointer;">
                                    <option value="all" selected>Show All</option>
                                    <option value="20">20 Rows</option>
                                    <option value="50">50 Rows</option>
                                    <option value="100">100 Rows</option>
                                </select>
                            </div>
                            <button class="btn-secondary tx-export-btn" style="font-size: 12px; padding: 6px 14px;" onclick="exportTransactionsToCSV()" title="Export transaction ledger to CSV/Excel">📊 Export Ledger</button>
                        </div>
                    </div>
                </div>
                
                <div id="tx-summary-cards" class="tx-summary-cards" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 16px;">
                </div>

                <div class="tx-table-container" style="max-height: 520px; overflow-x: auto; overflow-y: auto;">
                    <table class="tx-ledger-table" id="transactions-table">
                        <thead>
                            <tr>
                                <th>Execution Date</th>
                                <th>Portfolio</th>
                                <th>Stock Symbol</th>
                                <th style="text-align:center;">Type</th>
                                <th style="text-align:right;">Qty</th>
                                <th style="text-align:right;">Price (₹)</th>
                                <th style="text-align:right;">Total Value (₹)</th>
                                <th style="text-align:right;">Realized P&L</th>
                                <th>Notes / Thesis</th>
                                <th style="text-align:center; width: 60px;">Action</th>
                            </tr>
                        </thead>
                        <tbody id="transactions-tbody">
                            ${Array(3).fill(0).map(() => `
                                <tr>
                                    <td><span class="skeleton-box" style="width: 80px; height: 12px;"></span></td>
                                    <td><span class="skeleton-box" style="width: 70px; height: 12px;"></span></td>
                                    <td><span class="skeleton-box" style="width: 85px; height: 14px;"></span></td>
                                    <td style="text-align:center;"><span class="skeleton-box" style="width: 45px; height: 12px;"></span></td>
                                    <td style="text-align:right;"><span class="skeleton-box" style="width: 40px; height: 12px;"></span></td>
                                    <td style="text-align:right;"><span class="skeleton-box" style="width: 60px; height: 12px;"></span></td>
                                    <td style="text-align:right;"><span class="skeleton-box" style="width: 70px; height: 12px;"></span></td>
                                    <td style="text-align:right;"><span class="skeleton-box" style="width: 65px; height: 12px;"></span></td>
                                    <td><span class="skeleton-box" style="width: 110px; height: 12px;"></span></td>
                                    <td style="text-align:center;"><span class="skeleton-box" style="width: 25px; height: 25px;"></span></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div id="tx-table-footer" style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; font-size: 12px; color: var(--text-secondary); padding: 0 4px;"></div>
            `;
            container.appendChild(txContainer);

            viewMount.appendChild(container);
            renderTransactionsTable();
        }
