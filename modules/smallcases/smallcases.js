        // SMALLCASES MODULE JAVASCRIPT
        // =========================================================
        let smallcaseListCache = [];
        let smallcaseSummaryCache = {};
        let selectedSmallcaseId = null;
        let selectedSmallcaseDetail = null;
        let selectedExitSymbol = null;
        let smallcaseSortState = {
            list: { key: 'name', dir: 1 },
            holdings: { key: 'stock_name', dir: 1 },
            transactions: { key: 'transaction_date', dir: -1 }
        };

        function openSmallcaseModal(id) {
            const el = document.getElementById(id);
            if (el) el.style.display = 'block';
        }

        function closeSmallcaseModal(id) {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
            if (id === 'scDetailModal') {
                selectedSmallcaseDetail = null;
                refreshPrices();
            }
        }

        async function loadSmallcasesTab() {
            const grid = document.getElementById('smallcase-summary-grid');
            if (grid) {
                grid.innerHTML = Array(8).fill(0).map(() => `
                    <div class="metric-card" style="padding: 12px 14px;">
                        <span class="skeleton-box" style="width: 75px; height: 11px;"></span>
                        <div style="margin-top: 6px;"><span class="skeleton-box" style="width: 90px; height: 18px;"></span></div>
                    </div>
                `).join('');
            }

            const mount = document.getElementById('smallcases-list-mount');
            if (mount) {
                mount.innerHTML = `
                    <div class="table-responsive-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Smallcase</th><th>Category</th><th>Stocks</th><th>Total Value</th><th>Today's Change</th><th>Return</th><th>XIRR</th><th>Status</th><th style="text-align:right;">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${Array(4).fill(0).map(() => `
                                    <tr>
                                        <td><span class="skeleton-box" style="width: 120px; height: 14px;"></span><br><span class="skeleton-box" style="width: 160px; height: 10px; margin-top: 4px;"></span></td>
                                        <td><span class="skeleton-box" style="width: 60px; height: 12px;"></span></td>
                                        <td><span class="skeleton-box" style="width: 40px; height: 14px;"></span></td>
                                        <td><span class="skeleton-box" style="width: 70px; height: 14px;"></span></td>
                                        <td><span class="skeleton-box" style="width: 65px; height: 14px;"></span></td>
                                        <td><span class="skeleton-box" style="width: 55px; height: 14px;"></span></td>
                                        <td><span class="skeleton-box" style="width: 55px; height: 14px;"></span></td>
                                        <td><span class="skeleton-box" style="width: 60px; height: 12px;"></span></td>
                                        <td style="text-align:right;"><span class="skeleton-box" style="width: 80px; height: 20px;"></span></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            }

            try {
                const res = await fetch('/api/smallcases');
                const data = await res.json();

                if (!data.summary) {
                    if (mount) mount.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-secondary);">Unable to load Smallcases data.</div>';
                    return;
                }

                smallcaseListCache = data.smallcases || [];
                smallcaseSummaryCache = data.summary || {};
                renderSmallcaseSummary();
                renderSmallcaseList();
            } catch (err) {
                console.error('Error loading smallcases:', err);
                if (mount) mount.innerHTML = `<div style="text-align:center; padding:30px; color:#ef4444;">Failed to load smallcases: ${err.message}</div>`;
            }
        }

        function refreshSmallcaseData() {
            loadSmallcasesTab();
        }

        function renderSmallcaseSummary() {
            const grid = document.getElementById('smallcase-summary-grid');
            if (!grid) return;

            const s = smallcaseSummaryCache;
            const items = [
                ['Total Smallcases', s.total_smallcases || 0, ''],
                ['Active Positions', s.active_smallcases || 0, ''],
                ['Total Invested', isPrivacyMode ? '₹ ••••••' : `₹${(s.total_invested || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}`, ''],
                ['Current Value', isPrivacyMode ? '₹ ••••••' : `₹${(s.current_value || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}`, ''],
                ['Total P&L', isPrivacyMode ? '₹ ••••••' : `${(s.total_pnl || 0) >= 0 ? '+' : ''}₹${Math.abs(s.total_pnl || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}`, (s.total_pnl || 0) >= 0 ? 'pos' : 'neg'],
                ['Overall Return', `${(s.return_pct || 0) >= 0 ? '+' : ''}${(s.return_pct || 0).toFixed(2)}%`, (s.return_pct || 0) >= 0 ? 'pos' : 'neg'],
                ['Today\'s Change', s.today_change == null ? '—' : (isPrivacyMode ? '₹ ••••••' : `${s.today_change >= 0 ? '+' : ''}₹${Math.abs(s.today_change).toLocaleString('en-IN', {minimumFractionDigits: 2})} (${(s.today_change_pct || 0) >= 0 ? '+' : ''}${(s.today_change_pct || 0).toFixed(2)}%)`), s.today_change >= 0 ? 'pos' : 'neg'],
                ['Overall XIRR', s.overall_xirr == null ? 'Not Available' : `${s.overall_xirr >= 0 ? '+' : ''}${s.overall_xirr.toFixed(2)}%`, s.overall_xirr >= 0 ? 'pos' : 'neg']
            ];

            grid.innerHTML = items.map(x => `
                <div class="metric-card" style="padding: 12px 14px;">
                    <div class="title" style="font-size: 11px;">${x[0]}</div>
                    <div class="value ${x[2]}" style="font-size: 18px; margin-top: 4px;">${x[1]}</div>
                </div>
            `).join('');
        }

        function renderSmallcaseList() {
            const mount = document.getElementById('smallcases-list-mount');
            if (!mount) return;

            if (!smallcaseListCache.length) {
                mount.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);">No Smallcases yet. Click <strong>“+ Add New Smallcase”</strong> to start creating your portfolio basket.</div>';
                return;
            }

            const rows = sortSmallcaseRows(smallcaseListCache, smallcaseSortState.list.key, smallcaseSortState.list.dir);

            let html = `
                <div class="table-responsive-container">
                    <table>
                        <thead>
                            <tr>
                                ${sortSmallcaseHead('Smallcase', 'list', 'name')}
                                ${sortSmallcaseHead('Category', 'list', 'category')}
                                ${sortSmallcaseHead('Stocks', 'list', 'stocks_count')}
                                ${sortSmallcaseHead('Total Value', 'list', 'current_value')}
                                ${sortSmallcaseHead("Today's Change", 'list', 'today_change')}
                                ${sortSmallcaseHead('Return', 'list', 'return_pct')}
                                ${sortSmallcaseHead('XIRR', 'list', 'xirr')}
                                ${sortSmallcaseHead('Status', 'list', 'status')}
                                <th style="text-align: right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            rows.forEach(s => {
                const isPos = (s.total_pnl || 0) >= 0;
                const pnlSign = isPos ? '+' : '';
                const pnlClass = isPos ? 'pos' : 'neg';

                const todayPos = (s.today_change || 0) >= 0;
                const todayClass = todayPos ? 'pos' : 'neg';
                const todaySign = todayPos ? '+' : '';

                const statusClass = s.status === 'CLOSED' ? 'badge-st' : s.status === 'PARTIALLY EXITED' ? 'badge-nse' : 'badge-lt';

                const valStr = isPrivacyMode ? '₹ ••••••' : `₹${(s.current_value || 0).toLocaleString('en-IN', {minimumFractionDigits:2})}`;
                const invStr = isPrivacyMode ? '₹ ••••••' : `₹${(s.total_invested || 0).toLocaleString('en-IN', {minimumFractionDigits:2})}`;
                const todayStr = s.today_change == null ? '—' : (isPrivacyMode ? '₹ ••••••' : `${todaySign}₹${Math.abs(s.today_change).toLocaleString('en-IN', {minimumFractionDigits:2})}<br><span style="font-size:11px">${todaySign}${(s.today_change_pct || 0).toFixed(2)}%</span>`);

                html += `
                    <tr class="pf-row" onclick="viewSmallcaseDetails('${escapeHtml(s.id)}')" title="Click to view Smallcase details">
                        <td>
                            <div class="stock-symbol">${escapeHtml(s.name)}</div>
                            <div class="company-name">${escapeHtml(s.description || 'No description')}</div>
                        </td>
                        <td><span class="badge badge-nse">${escapeHtml(s.category || 'General')}</span></td>
                        <td><strong>${s.stocks_count}</strong> <span style="font-size:11px; color:var(--text-secondary);">(${s.active_positions} active)</span></td>
                        <td>
                            <strong>${valStr}</strong>
                            <div class="company-name">Invested ${invStr}</div>
                        </td>
                        <td class="${todayClass}">${todayStr}</td>
                        <td class="${pnlClass}"><strong>${pnlSign}${s.return_pct ? s.return_pct.toFixed(2) : 0}%</strong></td>
                        <td class="${s.xirr >= 0 ? 'pos' : 'neg'}">${s.xirr == null ? '—' : `${s.xirr >= 0 ? '+' : ''}${s.xirr.toFixed(2)}%`}</td>
                        <td><span class="badge ${statusClass}">${escapeHtml(s.status || 'ACTIVE')}</span></td>
                        <td style="text-align: right;" onclick="event.stopPropagation();">
                            <div style="display: flex; gap: 6px; justify-content: flex-end;">
                                <button class="btn-primary" style="font-size: 11px; padding: 4px 10px;" onclick="viewSmallcaseDetails('${escapeHtml(s.id)}')">🔍 Details</button>
                                <button class="btn-secondary" style="font-size: 11px; padding: 4px 10px;" onclick="openEditSmallcaseModal('${escapeHtml(s.id)}')">✏️ Edit</button>
                            </div>
                        </td>
                    </tr>
                `;
            });

            html += `
                        </tbody>
                    </table>
                </div>
            `;

            mount.innerHTML = html;
        }

        function sortSmallcaseHead(label, scope, key) {
            const st = smallcaseSortState[scope];
            const arrow = st.key === key ? (st.dir === 1 ? ' ▲' : ' ▼') : '';
            return `<th style="cursor: pointer;" onclick="toggleSmallcaseSort('${scope}','${key}')">${label}${arrow}</th>`;
        }

        function toggleSmallcaseSort(scope, key) {
            const st = smallcaseSortState[scope];
            if (st.key === key) st.dir *= -1;
            else { st.key = key; st.dir = 1; }

            if (scope === 'list') renderSmallcaseList();
            else if ((scope === 'holdings' || scope === 'transactions') && selectedSmallcaseId) viewSmallcaseDetails(selectedSmallcaseId);
        }

        function sortSmallcaseRows(rows, key, dir) {
            return [...rows].sort((a, b) => {
                let av = a ? a[key] : '';
                let bv = b ? b[key] : '';
                if (av == null) av = '';
                if (bv == null) bv = '';
                const an = typeof av === 'number' || (!isNaN(Number(av)) && String(av).trim() !== '');
                const bn = typeof bv === 'number' || (!isNaN(Number(bv)) && String(bv).trim() !== '');
                if (an && bn) return (Number(av) - Number(bv)) * dir;
                return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir;
            });
        }

        function openCreateSmallcaseModal() {
            document.getElementById('scCreateName').value = '';
            document.getElementById('scCreateDescription').value = '';
            document.getElementById('scCreateCategory').value = '';
            document.getElementById('scCreateBenchmark').value = '';
            document.getElementById('scCreateNotes').value = '';
            document.getElementById('scCreateDate').value = new Date().toISOString().slice(0, 10);
            openSmallcaseModal('createSmallcaseModal');
        }

        async function submitCreateSmallcase() {
            const name = document.getElementById('scCreateName').value.trim();
            if (!name) {
                alert('Smallcase name is required');
                document.getElementById('scCreateName').focus();
                return;
            }

            const payload = {
                name: name,
                description: document.getElementById('scCreateDescription').value.trim(),
                category: document.getElementById('scCreateCategory').value.trim(),
                investment_date: document.getElementById('scCreateDate').value,
                benchmark: document.getElementById('scCreateBenchmark').value.trim(),
                notes: document.getElementById('scCreateNotes').value.trim()
            };

            if (!payload.investment_date) {
                alert('Investment Date is required');
                return;
            }

            try {
                const res = await fetch('/api/smallcases', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!data.success) {
                    alert(data.error || 'Could not create Smallcase');
                    return;
                }
                closeSmallcaseModal('createSmallcaseModal');
                await loadSmallcasesTab();
            } catch (err) {
                alert('Failed to create Smallcase: ' + err.message);
            }
        }

        async function viewSmallcaseDetails(id) {
            try {
                const res = await fetch('/api/smallcases/' + encodeURIComponent(id));
                const d = await res.json();
                if (!d.holdings) {
                    alert(d.error || 'Could not load details');
                    return;
                }
                selectedSmallcaseId = id;
                selectedSmallcaseDetail = d;
                document.getElementById('scDetailTitle').innerText = d.name;
                document.getElementById('scDetailSub').innerText = `${d.description || 'No description'} • ${d.status} • XIRR as of ${d.xirr_as_of ? d.xirr_as_of.slice(0,10) : '-'}`;

                const holdings = sortSmallcaseRows(d.holdings, smallcaseSortState.holdings.key, smallcaseSortState.holdings.dir);
                const transactions = sortSmallcaseRows(d.transactions, smallcaseSortState.transactions.key, smallcaseSortState.transactions.dir);

                const bodyEl = document.getElementById('scDetailBody');

                let html = `
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 18px;">
                        <div class="metric-card" style="padding: 10px 12px;"><div class="title" style="font-size:10px;">Total Invested</div><div class="value" style="font-size:16px;">${isPrivacyMode ? '₹ ••••••' : `₹${d.total_invested.toLocaleString('en-IN', {minimumFractionDigits:2})}`}</div></div>
                        <div class="metric-card" style="padding: 10px 12px;"><div class="title" style="font-size:10px;">Current Value</div><div class="value" style="font-size:16px;">${isPrivacyMode ? '₹ ••••••' : `₹${d.current_value.toLocaleString('en-IN', {minimumFractionDigits:2})}`}</div></div>
                        <div class="metric-card" style="padding: 10px 12px;"><div class="title" style="font-size:10px;">Today's Change</div><div class="value ${d.today_change >= 0 ? 'pos' : 'neg'}" style="font-size:16px;">${isPrivacyMode ? '₹ ••••••' : `${d.today_change >= 0 ? '+' : ''}₹${Math.abs(d.today_change).toLocaleString('en-IN', {minimumFractionDigits:2})}`}</div></div>
                        <div class="metric-card" style="padding: 10px 12px;"><div class="title" style="font-size:10px;">Realized P&L</div><div class="value ${d.realized_pnl >= 0 ? 'pos' : 'neg'}" style="font-size:16px;">${isPrivacyMode ? '₹ ••••••' : `${d.realized_pnl >= 0 ? '+' : ''}₹${Math.abs(d.realized_pnl).toLocaleString('en-IN', {minimumFractionDigits:2})}`}</div></div>
                        <div class="metric-card" style="padding: 10px 12px;"><div class="title" style="font-size:10px;">Total P&L</div><div class="value ${d.total_pnl >= 0 ? 'pos' : 'neg'}" style="font-size:16px;">${isPrivacyMode ? '₹ ••••••' : `${d.total_pnl >= 0 ? '+' : ''}₹${Math.abs(d.total_pnl).toLocaleString('en-IN', {minimumFractionDigits:2})}`}</div></div>
                        <div class="metric-card" style="padding: 10px 12px;"><div class="title" style="font-size:10px;">Return %</div><div class="value ${d.return_pct >= 0 ? 'pos' : 'neg'}" style="font-size:16px;">${d.return_pct >= 0 ? '+' : ''}${d.return_pct.toFixed(2)}%</div></div>
                        <div class="metric-card" style="padding: 10px 12px;"><div class="title" style="font-size:10px;">XIRR</div><div class="value ${d.xirr >= 0 ? 'pos' : 'neg'}" style="font-size:16px;">${d.xirr == null ? 'N/A' : `${d.xirr >= 0 ? '+' : ''}${d.xirr.toFixed(2)}%`}</div></div>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; margin: 20px 0 10px;">
                        <h4 style="margin: 0; font-size: 14px; font-weight: 700; color: var(--text-primary); text-transform: uppercase;">Holdings (${holdings.length})</h4>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn-secondary" style="font-size: 11px; padding: 4px 10px;" onclick="openSmallcaseImportModal('${escapeHtml(id)}')">⬆ Import Excel</button>
                            <button class="btn-primary" style="font-size: 11px; padding: 4px 12px;" onclick="openSmallcaseTxModal('${escapeHtml(id)}','BUY')">🟢 Buy / Sell Holding</button>
                        </div>
                    </div>

                    <div class="table-responsive-container" style="margin-bottom: 20px;">
                        <table>
                            <thead>
                                <tr>
                                    ${sortSmallcaseHead('Stock', 'holdings', 'stock_name')}
                                    ${sortSmallcaseHead('Qty', 'holdings', 'quantity')}
                                    ${sortSmallcaseHead('Avg Buy', 'holdings', 'average_buy_price')}
                                    ${sortSmallcaseHead('Invested', 'holdings', 'invested')}
                                    ${sortSmallcaseHead('Current Price', 'holdings', 'current_price')}
                                    ${sortSmallcaseHead('Current Value', 'holdings', 'current_value')}
                                    ${sortSmallcaseHead('P&L', 'holdings', 'total_pnl')}
                                    ${sortSmallcaseHead('Return', 'holdings', 'return_pct')}
                                    ${sortSmallcaseHead('Status', 'holdings', 'status')}
                                    <th style="text-align: right;">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                `;

                holdings.forEach(h => {
                    const pos = (h.total_pnl || 0) >= 0;
                    html += `
                        <tr>
                            <td><strong>${escapeHtml(h.stock_name)}</strong><div class="company-name">${escapeHtml(h.symbol)}</div></td>
                            <td>${h.quantity}</td>
                            <td>₹${h.average_buy_price ? h.average_buy_price.toFixed(2) : '-'}</td>
                            <td>${isPrivacyMode ? '₹ ••••••' : `₹${(h.invested || 0).toLocaleString('en-IN', {minimumFractionDigits:2})}`}</td>
                            <td>₹${h.current_price ? h.current_price.toFixed(2) : '-'}</td>
                            <td>${isPrivacyMode ? '₹ ••••••' : `₹${(h.current_value || 0).toLocaleString('en-IN', {minimumFractionDigits:2})}`}</td>
                            <td class="${pos ? 'pos' : 'neg'}">${isPrivacyMode ? '₹ ••••••' : `${pos ? '+' : ''}₹${Math.abs(h.total_pnl || 0).toLocaleString('en-IN', {minimumFractionDigits:2})}`}</td>
                            <td class="${pos ? 'pos' : 'neg'}">${pos ? '+' : ''}${h.return_pct ? h.return_pct.toFixed(2) : 0}%</td>
                            <td><span class="badge ${h.status === 'ACTIVE' ? 'badge-lt' : 'badge-st'}">${escapeHtml(h.status)}</span></td>
                            <td style="text-align: right;">
                                ${h.status === 'ACTIVE' ? `<button class="btn-secondary" style="font-size: 11px; padding: 3px 8px; color:#ef4444; border-color:#fca5a5;" onclick="openSmallcaseExitModal('${escapeHtml(id)}','${escapeHtml(h.symbol)}',${h.quantity},${h.current_price || 0})">🔴 Exit</button>` : ''}
                            </td>
                        </tr>
                    `;
                });

                html += `
                            </tbody>
                        </table>
                    </div>

                    <h4 style="margin: 20px 0 10px; font-size: 14px; font-weight: 700; color: var(--text-primary); text-transform: uppercase;">Transaction History (${transactions.length})</h4>
                    <div class="table-responsive-container">
                        <table>
                            <thead>
                                <tr>
                                    ${sortSmallcaseHead('Date', 'transactions', 'transaction_date')}
                                    ${sortSmallcaseHead('Stock', 'transactions', 'stock_name')}
                                    ${sortSmallcaseHead('Type', 'transactions', 'transaction_type')}
                                    ${sortSmallcaseHead('Qty', 'transactions', 'quantity')}
                                    ${sortSmallcaseHead('Price', 'transactions', 'price')}
                                    ${sortSmallcaseHead('Amount', 'transactions', 'net_amount')}
                                    ${sortSmallcaseHead('Notes', 'transactions', 'notes')}
                                </tr>
                            </thead>
                            <tbody>
                `;

                transactions.forEach(t => {
                    html += `
                        <tr>
                            <td>${escapeHtml(window.formatAppDate ? window.formatAppDate(t.transaction_date) : t.transaction_date)}</td>
                            <td><strong>${escapeHtml(t.stock_name || t.symbol)}</strong></td>
                            <td><span class="badge ${t.transaction_type === 'BUY' ? 'badge-lt' : 'badge-st'}">${escapeHtml(t.transaction_type)}</span></td>
                            <td>${t.quantity}</td>
                            <td>₹${t.price ? t.price.toFixed(2) : '-'}</td>
                            <td>${isPrivacyMode ? '₹ ••••••' : `₹${(t.net_amount || 0).toLocaleString('en-IN', {minimumFractionDigits:2})}`}</td>
                            <td style="font-size: 11px; color: var(--text-secondary);">${escapeHtml(t.notes || '')}</td>
                        </tr>
                    `;
                });

                html += `
                            </tbody>
                        </table>
                    </div>
                `;

                bodyEl.innerHTML = html;
                openSmallcaseModal('detailSmallcaseModal');
            } catch (err) {
                alert('Failed to load Smallcase details: ' + err.message);
            }
        }

        function openEditSmallcaseModal(id) {
            const sc = smallcaseListCache.find(x => String(x.id) === String(id));
            if (!sc) return;
            selectedSmallcaseId = id;
            document.getElementById('scEditName').value = sc.name || '';
            document.getElementById('scEditDescription').value = sc.description || '';
            document.getElementById('scEditCategory').value = sc.category || '';
            document.getElementById('scEditDate').value = sc.investment_date || '';
            document.getElementById('scEditBenchmark').value = sc.benchmark || '';
            document.getElementById('scEditNotes').value = sc.notes || '';
            openSmallcaseModal('editSmallcaseModal');
        }

        async function submitSaveEditSmallcase() {
            if (!selectedSmallcaseId) return;
            const payload = {
                name: document.getElementById('scEditName').value.trim(),
                description: document.getElementById('scEditDescription').value.trim(),
                category: document.getElementById('scEditCategory').value.trim(),
                investment_date: document.getElementById('scEditDate').value,
                benchmark: document.getElementById('scEditBenchmark').value.trim(),
                notes: document.getElementById('scEditNotes').value.trim()
            };

            try {
                const res = await fetch('/api/smallcases/' + encodeURIComponent(selectedSmallcaseId), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!data.success) {
                    alert(data.error || 'Could not update Smallcase');
                    return;
                }
                closeSmallcaseModal('editSmallcaseModal');
                await loadSmallcasesTab();
            } catch (err) {
                alert('Failed to update Smallcase: ' + err.message);
            }
        }

        function openSmallcaseTxModal(id, type = 'BUY', symbol = '') {
            selectedSmallcaseId = id;
            document.getElementById('scTxType').value = type;
            document.getElementById('scTxSymbol').value = symbol;
            document.getElementById('scTxQty').value = '';
            document.getElementById('scTxPrice').value = '';
            document.getElementById('scTxDate').value = new Date().toISOString().slice(0, 10);
            document.getElementById('scTxCharges').value = '0';
            document.getElementById('scTxNotes').value = '';
            openSmallcaseModal('txSmallcaseModal');
        }

        async function submitSaveSmallcaseTransaction() {
            if (!selectedSmallcaseId) return;
            const symbol = document.getElementById('scTxSymbol').value.trim();
            if (!symbol) {
                alert('Stock symbol is required');
                return;
            }

            const body = {
                transaction_type: document.getElementById('scTxType').value,
                symbol: symbol,
                quantity: parseFloat(document.getElementById('scTxQty').value),
                price: parseFloat(document.getElementById('scTxPrice').value),
                transaction_date: document.getElementById('scTxDate').value,
                charges: parseFloat(document.getElementById('scTxCharges').value) || 0,
                notes: document.getElementById('scTxNotes').value.trim()
            };

            if (isNaN(body.quantity) || body.quantity <= 0) { alert('Invalid quantity'); return; }
            if (isNaN(body.price) || body.price <= 0) { alert('Invalid price'); return; }

            try {
                const res = await fetch('/api/smallcases/' + encodeURIComponent(selectedSmallcaseId) + '/transactions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await res.json();
                if (!data.success) {
                    alert(data.error || 'Transaction failed');
                    return;
                }
                closeSmallcaseModal('txSmallcaseModal');
                await loadSmallcasesTab();
                await viewSmallcaseDetails(selectedSmallcaseId);
            } catch (err) {
                alert('Transaction error: ' + err.message);
            }
        }

        function openSmallcaseExitModal(id, sym, qty, price) {
            selectedSmallcaseId = id;
            selectedExitSymbol = sym;
            document.getElementById('scExitSymbol').value = sym;
            document.getElementById('scExitQty').value = qty;
            document.getElementById('scExitPrice').value = price || '';
            document.getElementById('scExitDate').value = new Date().toISOString().slice(0, 10);
            document.getElementById('scExitCharges').value = '0';
            document.getElementById('scExitNotes').value = '';
            openSmallcaseModal('exitSmallcaseModal');
        }

        async function submitConfirmExitSmallcase() {
            if (!selectedSmallcaseId || !selectedExitSymbol) return;

            const body = {
                transaction_type: 'SELL',
                symbol: selectedExitSymbol,
                quantity: parseFloat(document.getElementById('scExitQty').value),
                price: parseFloat(document.getElementById('scExitPrice').value),
                transaction_date: document.getElementById('scExitDate').value,
                charges: parseFloat(document.getElementById('scExitCharges').value) || 0,
                notes: document.getElementById('scExitNotes').value.trim()
            };

            try {
                const res = await fetch('/api/smallcases/' + encodeURIComponent(selectedSmallcaseId) + '/transactions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await res.json();
                if (!data.success) {
                    alert(data.error || 'Exit failed');
                    return;
                }
                closeSmallcaseModal('exitSmallcaseModal');
                await loadSmallcasesTab();
                await viewSmallcaseDetails(selectedSmallcaseId);
            } catch (err) {
                alert('Exit error: ' + err.message);
            }
        }

        function openSmallcaseImportModal(id) {
            const sc = smallcaseListCache.find(x => String(x.id) === String(id));
            if (!sc) return;
            document.getElementById('scImportSmallcaseId').value = sc.id;
            document.getElementById('scImportSmallcaseName').value = sc.name;
            document.getElementById('scImportFile').value = '';
            document.getElementById('scImportStatus').innerHTML = '';
            openSmallcaseModal('importSmallcaseModal');
        }

        async function submitImportSmallcaseExcel() {
            const id = document.getElementById('scImportSmallcaseId').value;
            const file = document.getElementById('scImportFile').files[0];
            if (!id || !file) {
                alert('Please select an Excel file.');
                return;
            }

            const btn = document.getElementById('scImportBtn');
            btn.disabled = true;
            btn.innerText = 'Importing...';
            document.getElementById('scImportStatus').innerHTML = '<div style="padding:10px; font-size:12px; color:var(--text-secondary);">Reading Excel file...</div>';

            try {
                const fd = new FormData();
                fd.append('file', file);
                const res = await fetch(`/api/smallcases/${encodeURIComponent(id)}/import`, {
                    method: 'POST',
                    body: fd
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    document.getElementById('scImportStatus').innerHTML = `<div style="padding:10px; color:#ef4444; font-size:12px;">Import failed: ${escapeHtml(data.error || 'Unknown error')}</div>`;
                    return;
                }
                document.getElementById('scImportStatus').innerHTML = `
                    <div style="padding:10px; font-size:12px; background:var(--bg-subtle); border-radius:6px; border:1px solid var(--border-color);">
                        <strong style="color:#10b981;">Import Complete!</strong><br>
                        Imported: ${data.imported_count || 0} rows | Already imported: ${data.already_imported_count || 0} rows | Errored: ${data.errored_count || 0}
                    </div>
                `;
                await loadSmallcasesTab();
                if (selectedSmallcaseId === id) viewSmallcaseDetails(id);
            } catch (err) {
                document.getElementById('scImportStatus').innerHTML = `<div style="padding:10px; color:#ef4444; font-size:12px;">Import failed: ${escapeHtml(err.message)}</div>`;
            } finally {
                btn.disabled = false;
                btn.innerText = 'Import Excel';
            }
        }
