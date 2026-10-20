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

        function getSmallcasePnlColor(val) {
            if (val === null || val === undefined || val === '') return 'var(--text-secondary)';
            const n = Number(val);
            if (isNaN(n) || n === 0) return 'var(--text-secondary)';
            return n > 0 ? '#10b981' : '#ef4444';
        }

        function getSmallcasePnlClass(val) {
            if (val === null || val === undefined || val === '') return 'neutral';
            const n = Number(val);
            if (isNaN(n) || n === 0) return 'neutral';
            return n > 0 ? 'pos' : 'neg';
        }

        function formatSmallcaseDate(value) {
            if (!value && value !== 0) return '-';
            try {
                let d;
                if (typeof value === 'string') {
                    const clean = value.split('T')[0].trim();
                    const parts = clean.split('-');
                    if (parts.length === 3) {
                        if (parts[0].length === 4) {
                            d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
                        } else {
                            d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
                        }
                    }
                }
                if (!d || isNaN(d.getTime())) d = new Date(value);
                if (isNaN(d.getTime())) return String(value || '-');
                const day = String(d.getDate()).padStart(2, '0');
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                const month = months[d.getMonth()];
                const year = d.getFullYear();
                return `${day} ${month} ${year}`;
            } catch (e) {
                return String(value || '-');
            }
        }

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
                grid.innerHTML = Array(9).fill(0).map(() => `
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

            const todayColor = getSmallcasePnlColor(s.today_change);
            const todayClass = getSmallcasePnlClass(s.today_change);
            const todaySign = (s.today_change || 0) > 0 ? '+' : ((s.today_change || 0) < 0 ? '-' : '');
            const todayPctSign = (s.today_change_pct || 0) > 0 ? '+' : ((s.today_change_pct || 0) < 0 ? '-' : '');
            const todayStr = s.today_change == null ? '—' : (isPrivacyMode ? '₹ ••••••' : `${todaySign}₹${Math.abs(s.today_change).toLocaleString('en-IN', {minimumFractionDigits: 2})} (${todayPctSign}${Math.abs(s.today_change_pct || 0).toFixed(2)}%)`);

            const realPnl = s.realized_pnl != null ? s.realized_pnl : 0;
            const realColor = getSmallcasePnlColor(realPnl);
            const realClass = getSmallcasePnlClass(realPnl);
            const realSign = realPnl > 0 ? '+' : (realPnl < 0 ? '-' : '');
            const realStr = isPrivacyMode ? '₹ ••••••' : `${realSign}₹${Math.abs(realPnl).toLocaleString('en-IN', {minimumFractionDigits: 2})}`;

            const totalPnl = s.total_pnl != null ? s.total_pnl : 0;
            const totalColor = getSmallcasePnlColor(totalPnl);
            const totalClass = getSmallcasePnlClass(totalPnl);
            const totalSign = totalPnl > 0 ? '+' : (totalPnl < 0 ? '-' : '');
            const totalStr = isPrivacyMode ? '₹ ••••••' : `${totalSign}₹${Math.abs(totalPnl).toLocaleString('en-IN', {minimumFractionDigits: 2})}`;

            const ret = s.return_pct != null ? s.return_pct : 0;
            const retColor = getSmallcasePnlColor(ret);
            const retClass = getSmallcasePnlClass(ret);
            const retSign = ret > 0 ? '+' : (ret < 0 ? '-' : '');
            const retStr = `${retSign}${Math.abs(ret).toFixed(2)}%`;

            const xirr = s.overall_xirr;
            const xirrColor = getSmallcasePnlColor(xirr);
            const xirrClass = getSmallcasePnlClass(xirr);
            const xirrSign = (xirr || 0) > 0 ? '+' : ((xirr || 0) < 0 ? '-' : '');
            const xirrStr = xirr == null ? 'Not Available' : `${xirrSign}${Math.abs(xirr).toFixed(2)}%`;

            const items = [
                ['Total Smallcases', s.total_smallcases || 0, 'neutral', 'var(--text-primary)'],
                ['Active Positions', s.active_smallcases || 0, 'neutral', 'var(--text-primary)'],
                ['Total Invested', isPrivacyMode ? '₹ ••••••' : `₹${(s.total_invested || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}`, 'neutral', 'var(--text-primary)'],
                ['Current Value', isPrivacyMode ? '₹ ••••••' : `₹${(s.current_value || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}`, 'neutral', 'var(--text-primary)'],
                ["Today's Change", todayStr, todayClass, todayColor],
                ['Realized P&L', realStr, realClass, realColor],
                ['Total P&L', totalStr, totalClass, totalColor],
                ['Overall Return', retStr, retClass, retColor],
                ['Overall XIRR', xirrStr, xirrClass, xirrColor]
            ];

            grid.innerHTML = items.map(x => `
                <div class="metric-card" style="padding: 12px 14px;">
                    <div class="title" style="font-size: 11px;">${x[0]}</div>
                    <div class="value ${x[2]}" style="font-size: 18px; margin-top: 4px; color: ${x[3]} !important;">${x[1]}</div>
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
                const todayColor = getSmallcasePnlColor(s.today_change);
                const todayClass = getSmallcasePnlClass(s.today_change);
                const todaySign = (s.today_change || 0) > 0 ? '+' : ((s.today_change || 0) < 0 ? '-' : '');
                const todayPctSign = (s.today_change_pct || 0) > 0 ? '+' : ((s.today_change_pct || 0) < 0 ? '-' : '');
                const todayStr = s.today_change == null ? '—' : (isPrivacyMode ? '₹ ••••••' : `${todaySign}₹${Math.abs(s.today_change).toLocaleString('en-IN', {minimumFractionDigits:2})}<br><span style="font-size:11px; color:${todayColor} !important;">${todayPctSign}${Math.abs(s.today_change_pct || 0).toFixed(2)}%</span>`);

                const pnlColor = getSmallcasePnlColor(s.total_pnl);
                const pnlSign = (s.total_pnl || 0) > 0 ? '+' : ((s.total_pnl || 0) < 0 ? '-' : '');

                const retColor = getSmallcasePnlColor(s.return_pct);
                const retClass = getSmallcasePnlClass(s.return_pct);
                const retSign = (s.return_pct || 0) > 0 ? '+' : ((s.return_pct || 0) < 0 ? '-' : '');

                const realColor = getSmallcasePnlColor(s.realized_pnl);
                const realSign = (s.realized_pnl || 0) > 0 ? '+' : ((s.realized_pnl || 0) < 0 ? '-' : '');
                const realStr = s.realized_pnl ? `<div style="font-size:10px; margin-top:2px; color:${realColor} !important;" title="Realized P&L">Realized: ${isPrivacyMode ? '₹ ••••••' : `${realSign}₹${Math.abs(s.realized_pnl).toLocaleString('en-IN', {minimumFractionDigits:2})}`}</div>` : '';

                const xirrColor = getSmallcasePnlColor(s.xirr);
                const xirrClass = getSmallcasePnlClass(s.xirr);
                const xirrSign = (s.xirr || 0) > 0 ? '+' : ((s.xirr || 0) < 0 ? '-' : '');
                const xirrStr = s.xirr == null ? '—' : `${xirrSign}${Math.abs(s.xirr).toFixed(2)}%`;

                const statusClass = s.status === 'CLOSED' ? 'badge-st' : s.status === 'PARTIALLY EXITED' ? 'badge-nse' : 'badge-lt';

                const valStr = isPrivacyMode ? '₹ ••••••' : `₹${(s.current_value || 0).toLocaleString('en-IN', {minimumFractionDigits:2})}`;
                const invStr = isPrivacyMode ? '₹ ••••••' : `₹${(s.total_invested || 0).toLocaleString('en-IN', {minimumFractionDigits:2})}`;

                html += `
                    <tr class="pf-row" onclick="viewSmallcaseDetails('${escapeHtml(s.id)}')" title="Click to view Smallcase details">
                        <td>
                            <div class="stock-symbol">${escapeHtml(s.name)}</div>
                            <div class="company-name">${escapeHtml(s.description || 'No description')}</div>
                        </td>
                        <td><span class="badge badge-nse">${escapeHtml(s.category || 'General')}</span></td>
                        <td>
                            <strong>${s.stocks_count}</strong> <span style="font-size:11px; color:var(--text-secondary);">(${s.active_positions} active)</span>
                            ${s.stocks_count === 0 ? `
                                <div style="margin-top: 3px;" onclick="event.stopPropagation();">
                                    <a href="javascript:void(0)" onclick="openBulkStockModal('${escapeHtml(s.id)}')" style="font-size: 11px; color: #3b82f6; font-weight: 600; text-decoration: underline;">
                                        + Add bulk stock
                                    </a>
                                </div>
                            ` : ''}
                        </td>
                        <td>
                            <strong>${valStr}</strong>
                            <div class="company-name">Invested ${invStr}</div>
                        </td>
                        <td class="${todayClass}" style="color: ${todayColor} !important;">${todayStr}</td>
                        <td class="${retClass}" style="color: ${retColor} !important;">
                            <strong>${retSign}${s.return_pct != null ? Math.abs(s.return_pct).toFixed(2) : '0.00'}%</strong>
                            <div style="font-size: 11px; margin-top: 2px; color: ${pnlColor} !important;">
                                ${isPrivacyMode ? '₹ ••••••' : `${pnlSign}₹${Math.abs(s.total_pnl || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}`}
                            </div>
                            ${realStr}
                        </td>
                        <td class="${xirrClass}" style="color: ${xirrColor} !important;"><strong>${xirrStr}</strong></td>
                        <td><span class="badge ${statusClass}">${escapeHtml(s.status || 'ACTIVE')}</span></td>
                        <td style="text-align: right;" onclick="event.stopPropagation();">
                            <div style="display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap;">
                                ${s.stocks_count === 0 ? `<button class="btn-secondary" style="font-size: 11px; padding: 4px 8px; color: #3b82f6; border-color: #93c5fd;" onclick="openBulkStockModal('${escapeHtml(s.id)}')">⚖️ Add bulk</button>` : ''}
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
            
            const submitBtn = document.getElementById('scCreateSubmitBtn');
            const cancelBtn = document.getElementById('scCreateCancelBtn');
            const overlay = document.getElementById('scCreateLoaderOverlay');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = 'Create Smallcase';
            }
            if (cancelBtn) cancelBtn.disabled = false;
            if (overlay) overlay.style.display = 'none';

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

            const submitBtn = document.getElementById('scCreateSubmitBtn');
            const cancelBtn = document.getElementById('scCreateCancelBtn');
            const overlay = document.getElementById('scCreateLoaderOverlay');

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span class="sc-btn-spinner"></span> Adding Smallcase...';
            }
            if (cancelBtn) cancelBtn.disabled = true;
            if (overlay) overlay.style.display = 'flex';

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
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerText = 'Create Smallcase';
                }
                if (cancelBtn) cancelBtn.disabled = false;
                if (overlay) overlay.style.display = 'none';
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
                document.getElementById('scDetailSub').innerText = `${d.description || 'No description'} • ${d.status} • XIRR as of ${formatSmallcaseDate(d.xirr_as_of)}`;

                const holdings = sortSmallcaseRows(d.holdings, smallcaseSortState.holdings.key, smallcaseSortState.holdings.dir);
                const transactions = sortSmallcaseRows(d.transactions, smallcaseSortState.transactions.key, smallcaseSortState.transactions.dir);

                const bodyEl = document.getElementById('scDetailBody');

                const dTodayColor = getSmallcasePnlColor(d.today_change);
                const dTodayClass = getSmallcasePnlClass(d.today_change);
                const dTodaySign = (d.today_change || 0) > 0 ? '+' : ((d.today_change || 0) < 0 ? '-' : '');
                const dTodayPctSign = (d.today_change_pct || 0) > 0 ? '+' : ((d.today_change_pct || 0) < 0 ? '-' : '');
                const dTodayPctStr = d.today_change_pct != null ? ` (${dTodayPctSign}${Math.abs(d.today_change_pct).toFixed(2)}%)` : '';
                const dTodayStr = d.today_change == null ? '—' : (isPrivacyMode ? '₹ ••••••' : `${dTodaySign}₹${Math.abs(d.today_change).toLocaleString('en-IN', {minimumFractionDigits:2})}${dTodayPctStr}`);

                const dRealColor = getSmallcasePnlColor(d.realized_pnl);
                const dRealClass = getSmallcasePnlClass(d.realized_pnl);
                const dRealSign = (d.realized_pnl || 0) > 0 ? '+' : ((d.realized_pnl || 0) < 0 ? '-' : '');
                const dRealStr = isPrivacyMode ? '₹ ••••••' : `${dRealSign}₹${Math.abs(d.realized_pnl || 0).toLocaleString('en-IN', {minimumFractionDigits:2})}`;

                const dTotalColor = getSmallcasePnlColor(d.total_pnl);
                const dTotalClass = getSmallcasePnlClass(d.total_pnl);
                const dTotalSign = (d.total_pnl || 0) > 0 ? '+' : ((d.total_pnl || 0) < 0 ? '-' : '');
                const dTotalStr = isPrivacyMode ? '₹ ••••••' : `${dTotalSign}₹${Math.abs(d.total_pnl || 0).toLocaleString('en-IN', {minimumFractionDigits:2})}`;

                const dRetColor = getSmallcasePnlColor(d.return_pct);
                const dRetClass = getSmallcasePnlClass(d.return_pct);
                const dRetSign = (d.return_pct || 0) > 0 ? '+' : ((d.return_pct || 0) < 0 ? '-' : '');
                const dRetStr = d.return_pct != null ? `${dRetSign}${Math.abs(d.return_pct).toFixed(2)}%` : '0.00%';

                const dXirrColor = getSmallcasePnlColor(d.xirr);
                const dXirrClass = getSmallcasePnlClass(d.xirr);
                const dXirrSign = (d.xirr || 0) > 0 ? '+' : ((d.xirr || 0) < 0 ? '-' : '');
                const dXirrStr = d.xirr == null ? 'Not Available' : `${dXirrSign}${Math.abs(d.xirr).toFixed(2)}%`;

                let html = `
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 18px;">
                        <div class="metric-card" style="padding: 10px 12px;"><div class="title" style="font-size:10px;">Total Invested</div><div class="value" style="font-size:16px;">${isPrivacyMode ? '₹ ••••••' : `₹${d.total_invested.toLocaleString('en-IN', {minimumFractionDigits:2})}`}</div></div>
                        <div class="metric-card" style="padding: 10px 12px;"><div class="title" style="font-size:10px;">Current Value</div><div class="value" style="font-size:16px;">${isPrivacyMode ? '₹ ••••••' : `₹${d.current_value.toLocaleString('en-IN', {minimumFractionDigits:2})}`}</div></div>
                        <div class="metric-card" style="padding: 10px 12px;"><div class="title" style="font-size:10px;">Today's Change</div><div class="value ${dTodayClass}" style="font-size:16px; color: ${dTodayColor} !important;">${dTodayStr}</div></div>
                        <div class="metric-card" style="padding: 10px 12px;"><div class="title" style="font-size:10px;">Realized P&L</div><div class="value ${dRealClass}" style="font-size:16px; color: ${dRealColor} !important;">${dRealStr}</div></div>
                        <div class="metric-card" style="padding: 10px 12px;"><div class="title" style="font-size:10px;">Total P&L</div><div class="value ${dTotalClass}" style="font-size:16px; color: ${dTotalColor} !important;">${dTotalStr}</div></div>
                        <div class="metric-card" style="padding: 10px 12px;"><div class="title" style="font-size:10px;">Return %</div><div class="value ${dRetClass}" style="font-size:16px; color: ${dRetColor} !important;">${dRetStr}</div></div>
                        <div class="metric-card" style="padding: 10px 12px;"><div class="title" style="font-size:10px;">XIRR</div><div class="value ${dXirrClass}" style="font-size:16px; color: ${dXirrColor} !important;">${dXirrStr}</div></div>
                    </div>

                    <div class="sc-holdings-header">
                        <h4 class="sc-holdings-title" style="margin: 0; font-size: 14px; font-weight: 700; color: var(--text-primary); text-transform: uppercase;">Holdings (${holdings.length})</h4>
                        <div class="sc-holdings-actions">
                            <button class="btn-primary sc-holdings-btn sc-btn-bulk" onclick="openBulkStockModal('${escapeHtml(id)}')">
                                <span class="sc-btn-icon">⚖️</span>
                                <span class="sc-btn-text">Add bulk stocks</span>
                            </button>
                            <button class="btn-secondary sc-holdings-btn sc-btn-import" onclick="openSmallcaseImportModal('${escapeHtml(id)}')">
                                <span class="sc-btn-icon">⬆</span>
                                <span class="sc-btn-text">Import Excel</span>
                            </button>
                            <button class="btn-primary sc-holdings-btn sc-btn-trade" onclick="openSmallcaseTxModal('${escapeHtml(id)}','BUY')">
                                <span class="sc-btn-icon">🟢</span>
                                <span class="sc-btn-text">Buy / Sell<span class="sc-btn-holding-text"> Holding</span></span>
                            </button>
                        </div>
                    </div>

                    ${holdings.length === 0 ? `
                        <div class="sc-empty-holdings-card">
                            <div style="font-size: 32px; margin-bottom: 8px;">⚖️</div>
                            <h4 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 700; color: var(--text-primary);">This smallcase has no stocks yet</h4>
                            <p style="margin: 0 0 16px 0; font-size: 13px; color: var(--text-secondary); max-width: 480px; line-height: 1.5;">
                                Build an equal weight portfolio basket based on your planned investment amount. Stocks will be split automatically with live market prices.
                            </p>
                            <button class="btn-primary" style="font-size: 13px; padding: 8px 18px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; background: #3b82f6; border-color: #2563eb;" onclick="openBulkStockModal('${escapeHtml(id)}')">
                                ⚖️ Add bulk stock (Equal Weight)
                            </button>
                        </div>
                    ` : `
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
                                    ${holdings.map(h => {
                                        const hPnlColor = getSmallcasePnlColor(h.total_pnl);
                                        const hPnlClass = getSmallcasePnlClass(h.total_pnl);
                                        const hPnlSign = (h.total_pnl || 0) > 0 ? '+' : ((h.total_pnl || 0) < 0 ? '-' : '');

                                        const hRetColor = getSmallcasePnlColor(h.return_pct);
                                        const hRetClass = getSmallcasePnlClass(h.return_pct);
                                        const hRetSign = (h.return_pct || 0) > 0 ? '+' : ((h.return_pct || 0) < 0 ? '-' : '');

                                        const hRealColor = getSmallcasePnlColor(h.realized_pnl);
                                        const hRealSign = (h.realized_pnl || 0) > 0 ? '+' : ((h.realized_pnl || 0) < 0 ? '-' : '');
                                        const hRealStr = h.realized_pnl ? `<div style="font-size:10px; color:${hRealColor} !important;">Realized: ${isPrivacyMode ? '₹ ••••••' : `${hRealSign}₹${Math.abs(h.realized_pnl).toLocaleString('en-IN', {minimumFractionDigits:2})}`}</div>` : '';

                                        const hTodayColor = getSmallcasePnlColor(h.today_change);
                                        const hTodaySign = (h.today_change || 0) > 0 ? '+' : ((h.today_change || 0) < 0 ? '-' : '');
                                        const hTodayPctSign = (h.today_change_pct || 0) > 0 ? '+' : ((h.today_change_pct || 0) < 0 ? '-' : '');
                                        const hTodayStr = h.today_change != null ? `<div style="font-size:10px; color:${hTodayColor} !important;">1D: ${hTodaySign}₹${Math.abs(h.today_change).toFixed(2)} (${hTodayPctSign}${Math.abs(h.today_change_pct || 0).toFixed(2)}%)</div>` : '';

                                        return `
                                            <tr>
                                                <td><strong>${escapeHtml(h.stock_name)}</strong><div class="company-name">${escapeHtml(h.symbol)}</div></td>
                                                <td>${h.quantity}</td>
                                                <td>₹${h.average_buy_price ? h.average_buy_price.toFixed(2) : '-'}</td>
                                                <td>${isPrivacyMode ? '₹ ••••••' : `₹${(h.invested || 0).toLocaleString('en-IN', {minimumFractionDigits:2})}`}</td>
                                                <td>
                                                    ₹${h.current_price ? h.current_price.toFixed(2) : '-'}
                                                    ${hTodayStr}
                                                </td>
                                                <td>${isPrivacyMode ? '₹ ••••••' : `₹${(h.current_value || 0).toLocaleString('en-IN', {minimumFractionDigits:2})}`}</td>
                                                <td class="${hPnlClass}" style="color: ${hPnlColor} !important;">
                                                    <strong>${isPrivacyMode ? '₹ ••••••' : `${hPnlSign}₹${Math.abs(h.total_pnl || 0).toLocaleString('en-IN', {minimumFractionDigits:2})}`}</strong>
                                                    ${hRealStr}
                                                </td>
                                                <td class="${hRetClass}" style="color: ${hRetColor} !important;">
                                                    <strong>${hRetSign}${h.return_pct ? Math.abs(h.return_pct).toFixed(2) : '0.00'}%</strong>
                                                </td>
                                                <td><span class="badge ${h.status === 'ACTIVE' ? 'badge-lt' : 'badge-st'}">${escapeHtml(h.status)}</span></td>
                                                <td style="text-align: right;">
                                                    ${h.status === 'ACTIVE' ? `<button class="btn-secondary" style="font-size: 11px; padding: 3px 8px; color:#ef4444; border-color:#fca5a5;" onclick="openSmallcaseExitModal('${escapeHtml(id)}','${escapeHtml(h.symbol)}',${h.quantity},${h.current_price || 0})">🔴 Exit</button>` : ''}
                                                </td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    `}

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

            const txSubmitBtn = document.getElementById('scTxSubmitBtn');
            const txCancelBtn = document.getElementById('scTxCancelBtn');
            const txOverlay = document.getElementById('scTxLoaderOverlay');
            if (txSubmitBtn) {
                txSubmitBtn.disabled = true;
                txSubmitBtn.innerHTML = '<span class="sc-btn-spinner"></span> Saving Holding...';
            }
            if (txCancelBtn) txCancelBtn.disabled = true;
            if (txOverlay) txOverlay.style.display = 'flex';

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
            } finally {
                if (txSubmitBtn) {
                    txSubmitBtn.disabled = false;
                    txSubmitBtn.innerText = 'Confirm Transaction';
                }
                if (txCancelBtn) txCancelBtn.disabled = false;
                if (txOverlay) txOverlay.style.display = 'none';
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

        // =========================================================
        // ADD BULK STOCKS (EQUAL WEIGHT) CONTROLLERS
        // =========================================================
        let bulkStockBasket = [];
        let bulkStockSmallcaseId = null;
        let bulkSearchTimeout = null;

        function openBulkStockModal(id) {
            bulkStockSmallcaseId = id;
            let sc = (smallcaseListCache || []).find(x => String(x.id) === String(id));
            if (!sc && selectedSmallcaseDetail && String(selectedSmallcaseDetail.id) === String(id)) {
                sc = selectedSmallcaseDetail;
            }
            const nameEl = document.getElementById('scBulkSmallcaseName');
            if (nameEl) nameEl.innerText = sc ? sc.name : id;

            const dateInput = document.getElementById('scBulkDate');
            if (dateInput) {
                const today = new Date().toISOString().split('T')[0];
                dateInput.value = today;
            }

            const plannedInput = document.getElementById('scBulkPlannedAmount');
            if (plannedInput) {
                plannedInput.value = '100000'; // Default 1 Lakh
            }

            const searchInput = document.getElementById('scBulkSearchInput');
            if (searchInput) searchInput.value = '';
            const dropdown = document.getElementById('dropdown-scBulk');
            if (dropdown) dropdown.style.display = 'none';

            const pasteArea = document.getElementById('scBulkPasteArea');
            if (pasteArea) pasteArea.style.display = 'none';
            const pasteInput = document.getElementById('scBulkPasteInput');
            if (pasteInput) pasteInput.value = '';

            const statusEl = document.getElementById('scBulkStatus');
            if (statusEl) {
                statusEl.style.display = 'none';
                statusEl.innerText = '';
            }

            bulkStockBasket = [];
            renderBulkStocksTable();
            recalcBulkWeights(true);

            openSmallcaseModal('bulkStockSmallcaseModal');
        }

        function setBulkPlannedAmount(amt) {
            const plannedInput = document.getElementById('scBulkPlannedAmount');
            if (plannedInput) {
                plannedInput.value = amt;
            }
            updateBulkPresetChips();
            recalcBulkWeights(true);
        }

        function updateBulkPresetChips() {
            const plannedInput = document.getElementById('scBulkPlannedAmount');
            const val = plannedInput ? Number(plannedInput.value) : 0;
            document.querySelectorAll('.sc-bulk-chip').forEach(btn => {
                const clickText = btn.getAttribute('onclick') || '';
                const match = clickText.match(/\d+/);
                const chipVal = match ? Number(match[0]) : 0;
                btn.classList.toggle('active', chipVal === val);
            });
        }

        function toggleBulkPasteBox() {
            const pasteArea = document.getElementById('scBulkPasteArea');
            if (!pasteArea) return;
            const isHidden = pasteArea.style.display === 'none';
            pasteArea.style.display = isHidden ? 'block' : 'none';
            if (isHidden) {
                const pasteInput = document.getElementById('scBulkPasteInput');
                if (pasteInput) pasteInput.focus();
            }
        }

        function cleanSymbolForBulk(sym) {
            if (!sym) return '';
            let s = String(sym).trim().toUpperCase();
            if (!s.endsWith('.NS') && !s.endsWith('.BO')) {
                s += '.NS';
            }
            return s;
        }

        async function fetchLiveStockPrice(symbol) {
            const cleanSym = cleanSymbolForBulk(symbol);
            const globalPrices = window.stockPricesData || (typeof stockPricesData !== 'undefined' ? stockPricesData : {});
            if (globalPrices && globalPrices[cleanSym] && globalPrices[cleanSym].price) {
                return {
                    price: Number(globalPrices[cleanSym].price),
                    name: globalPrices[cleanSym].name || cleanSym
                };
            }
            const baseSym = cleanSym.replace(/\.(NS|BO)$/, '');
            if (globalPrices && globalPrices[baseSym] && globalPrices[baseSym].price) {
                return {
                    price: Number(globalPrices[baseSym].price),
                    name: globalPrices[baseSym].name || baseSym
                };
            }

            try {
                const res = await fetch('/api/stock_data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbols: [cleanSym] })
                });
                const data = await res.json();
                if (data && data[cleanSym] && data[cleanSym].price) {
                    return {
                        price: Number(data[cleanSym].price),
                        name: data[cleanSym].name || cleanSym
                    };
                }
            } catch (e) {
                console.warn('Could not fetch price for', cleanSym, e);
            }
            return { price: 0, name: cleanSym };
        }

        async function handleBulkStockSearch(inputElement, event) {
            const query = inputElement.value.trim();
            const dropdown = document.getElementById('dropdown-scBulk');
            if (!dropdown) return;

            if (bulkSearchTimeout) clearTimeout(bulkSearchTimeout);

            if (query.length < 2) {
                dropdown.style.display = 'none';
                return;
            }

            bulkSearchTimeout = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
                    const results = await res.json();
                    dropdown.innerHTML = '';
                    if (results && results.length > 0) {
                        results.forEach(item => {
                            const div = document.createElement('div');
                            div.className = 'autocomplete-item';
                            div.style.padding = '8px 12px';
                            div.style.cursor = 'pointer';
                            div.style.borderBottom = '1px solid var(--border-color)';
                            div.innerHTML = `
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <div>
                                        <strong style="color: var(--text-primary);">${escapeHtml(item.symbol || '')}</strong>
                                        <div style="font-size: 11px; color: var(--text-secondary);">${escapeHtml(item.name || '')}</div>
                                    </div>
                                    <span class="badge badge-nse" style="font-size: 10px;">${escapeHtml(item.exchange || 'NSE')}</span>
                                </div>
                            `;
                            div.onclick = async () => {
                                dropdown.style.display = 'none';
                                inputElement.value = '';
                                await addStockToBulkBasket(item.symbol, item.name, item.exchange);
                            };
                            dropdown.appendChild(div);
                        });
                        dropdown.style.display = 'block';
                    } else {
                        dropdown.style.display = 'none';
                    }
                } catch (e) {
                    dropdown.style.display = 'none';
                }
            }, 250);
        }

        async function addStockToBulkBasket(symbol, name, exchange) {
            const cleanSym = cleanSymbolForBulk(symbol);
            if (!cleanSym) return;

            const exists = bulkStockBasket.some(x => x.symbol === cleanSym);
            if (exists) {
                showBulkStatus(`Stock ${cleanSym} is already in the basket!`, 'warning');
                return;
            }

            const quote = await fetchLiveStockPrice(cleanSym);
            const livePrice = quote.price > 0 ? quote.price : 0;
            const stockName = name || quote.name || cleanSym;

            bulkStockBasket.push({
                symbol: cleanSym,
                name: stockName,
                exchange: exchange || 'NSE',
                price: livePrice,
                quantity: 1,
                userEditedQty: false
            });

            showBulkStatus(`Added ${cleanSym} (Live price: ₹${livePrice.toFixed(2)})`, 'success');
            recalcBulkWeights(true);
            renderBulkStocksTable();
            setTimeout(() => {
                const tbl = document.getElementById('scBulkTableContainer');
                if (tbl) tbl.scrollTop = tbl.scrollHeight;
            }, 50);
        }

        async function addPastedBulkStocks() {
            const pasteInput = document.getElementById('scBulkPasteInput');
            if (!pasteInput || !pasteInput.value.trim()) return;

            const rawText = pasteInput.value;
            const rawTokens = rawText.split(/[\r\n,;]+/).map(s => s.trim()).filter(Boolean);
            if (!rawTokens.length) return;

            const uniqueSymbols = [];
            rawTokens.forEach(t => {
                const clean = cleanSymbolForBulk(t);
                if (clean && !uniqueSymbols.includes(clean) && !bulkStockBasket.some(x => x.symbol === clean)) {
                    uniqueSymbols.push(clean);
                }
            });

            if (!uniqueSymbols.length) {
                showBulkStatus('All pasted symbols are already in the basket or invalid.', 'warning');
                return;
            }

            showBulkStatus(`Fetching live prices for ${uniqueSymbols.length} stocks...`, 'info');

            let priceMap = {};
            try {
                const res = await fetch('/api/stock_data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbols: uniqueSymbols })
                });
                priceMap = await res.json() || {};
            } catch (e) {
                console.warn('Batch price fetch failed, falling back', e);
            }

            const globalPrices = window.stockPricesData || (typeof stockPricesData !== 'undefined' ? stockPricesData : {});

            uniqueSymbols.forEach(sym => {
                let p = 0;
                let n = sym;
                if (priceMap[sym] && priceMap[sym].price) {
                    p = Number(priceMap[sym].price);
                    n = priceMap[sym].name || sym;
                } else if (globalPrices && globalPrices[sym] && globalPrices[sym].price) {
                    p = Number(globalPrices[sym].price);
                    n = globalPrices[sym].name || sym;
                }
                bulkStockBasket.push({
                    symbol: sym,
                    name: n,
                    exchange: 'NSE',
                    price: p,
                    quantity: 1,
                    userEditedQty: false
                });
            });

            pasteInput.value = '';
            const pasteArea = document.getElementById('scBulkPasteArea');
            if (pasteArea) pasteArea.style.display = 'none';
            showBulkStatus(`Added ${uniqueSymbols.length} stocks to basket with live prices!`, 'success');
            recalcBulkWeights(true);
            renderBulkStocksTable();
            setTimeout(() => {
                const tbl = document.getElementById('scBulkTableContainer');
                if (tbl) tbl.scrollTop = tbl.scrollHeight;
            }, 50);
        }

        function removeStockFromBulkBasket(idx) {
            if (idx >= 0 && idx < bulkStockBasket.length) {
                const removed = bulkStockBasket.splice(idx, 1);
                recalcBulkWeights(true);
                renderBulkStocksTable();
                if (removed.length) {
                    showBulkStatus(`Removed ${removed[0].symbol}`, 'info');
                }
            }
        }

        function clearAllBulkStocks() {
            if (!bulkStockBasket.length) return;
            if (confirm('Clear all stocks from the basket?')) {
                bulkStockBasket = [];
                recalcBulkWeights(true);
                renderBulkStocksTable();
                showBulkStatus('Cleared all stocks.', 'info');
            }
        }

        function onBulkQtyChange(idx, val) {
            const item = bulkStockBasket[idx];
            if (!item) return;
            const num = parseFloat(val);
            item.quantity = Math.max(1, isNaN(num) ? 1 : num);
            item.userEditedQty = true;
            recalcBulkWeights(false);
            updateBulkRowDisplay(idx);
        }

        function onBulkPriceChange(idx, val) {
            const item = bulkStockBasket[idx];
            if (!item) return;
            const num = parseFloat(val);
            item.price = Math.max(0, isNaN(num) ? 0 : num);
            recalcBulkWeights(true);
            renderBulkStocksTable();
        }

        function recalcBulkWeights(forceEqual = true) {
            const plannedInput = document.getElementById('scBulkPlannedAmount');
            const plannedAmount = plannedInput ? Math.max(0, parseFloat(plannedInput.value) || 0) : 100000;
            const N = bulkStockBasket.length;

            const targetWeight = N > 0 ? (100 / N) : 0;
            const targetAmountPerStock = N > 0 ? (plannedAmount / N) : 0;

            if (N > 0 && targetAmountPerStock > 0) {
                bulkStockBasket.forEach(item => {
                    if (item.price > 0) {
                        item.quantity = Math.max(1, Math.floor(targetAmountPerStock / item.price));
                    } else {
                        item.quantity = 1;
                    }
                });
            }

            let totalAllocated = 0;
            bulkStockBasket.forEach(item => {
                totalAllocated += (item.quantity * item.price);
            });

            bulkStockBasket.forEach(item => {
                const amount = item.quantity * item.price;
                item.amount = amount;
                item.weight = totalAllocated > 0 ? ((amount / totalAllocated) * 100) : targetWeight;
                item.targetWeight = targetWeight;
            });

            const countEl = document.getElementById('scBulkCount');
            if (countEl) countEl.innerText = N;

            const targetWeightEl = document.getElementById('scBulkTargetWeight');
            if (targetWeightEl) targetWeightEl.innerText = `${targetWeight.toFixed(2)}% each`;

            const plannedDisp = document.getElementById('scBulkPlannedDisp');
            if (plannedDisp) plannedDisp.innerText = `₹${plannedAmount.toLocaleString('en-IN')}`;

            const actualDisp = document.getElementById('scBulkActualDisp');
            if (actualDisp) actualDisp.innerText = `₹${totalAllocated.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

            const cashDiff = document.getElementById('scBulkCashDiff');
            if (cashDiff) {
                const diff = plannedAmount - totalAllocated;
                cashDiff.innerText = `${diff >= 0 ? '₹' : '-₹'}${Math.abs(diff).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                cashDiff.style.color = diff >= 0 ? 'var(--text-secondary)' : '#ef4444';
            }
        }

        function renderBulkStocksTable() {
            const tbody = document.getElementById('scBulkTableBody');
            const emptyRow = document.getElementById('scBulkEmptyRow');
            if (!tbody) return;

            if (!bulkStockBasket.length) {
                tbody.innerHTML = '';
                if (emptyRow) emptyRow.style.display = 'block';
                return;
            }

            if (emptyRow) emptyRow.style.display = 'none';

            let html = '';
            bulkStockBasket.forEach((item, idx) => {
                const amount = item.amount != null ? item.amount : (item.quantity * item.price);
                const weight = item.weight != null ? item.weight : item.targetWeight;
                const isLive = item.price > 0;

                html += `
                    <tr class="sc-bulk-row" id="scBulkRow-${idx}" style="border-bottom: 1px solid var(--border-color);">
                        <td style="padding: 10px 12px; vertical-align: middle;">
                            <div style="font-weight: 700; color: var(--text-primary);">${escapeHtml(item.name || item.symbol)}</div>
                            <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                                <span class="stock-symbol" style="font-size: 11px;">${escapeHtml(item.symbol)}</span>
                                <span class="badge badge-nse" style="font-size: 9.5px; padding: 1px 4px;">${escapeHtml(item.exchange || 'NSE')}</span>
                            </div>
                        </td>
                        <td style="padding: 10px 12px; text-align: right; vertical-align: middle;">
                            <div style="display: flex; align-items: center; justify-content: flex-end; gap: 4px;">
                                ${isLive ? '<span class="sc-live-indicator" title="Live Market Price"></span>' : ''}
                                <span>₹</span>
                                <input type="number" step="0.05" min="0.01" class="sc-bulk-input sc-bulk-price-input" value="${item.price.toFixed(2)}" onchange="onBulkPriceChange(${idx}, this.value)" style="width: 85px;">
                            </div>
                        </td>
                        <td style="padding: 10px 12px; text-align: right; vertical-align: middle;">
                            <input type="number" class="sc-bulk-input sc-bulk-qty-input" value="${item.quantity}" readonly tabindex="-1" onkeydown="return false;" onpaste="return false;" style="width: 75px;" title="Auto-calculated equal weight quantity (non-editable)">
                        </td>
                        <td style="padding: 10px 12px; text-align: right; vertical-align: middle; font-weight: 700; color: var(--text-primary);" id="scBulkAmount-${idx}">
                            ₹${amount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                        </td>
                        <td style="padding: 10px 12px; text-align: right; vertical-align: middle;" id="scBulkWeight-${idx}">
                            <span class="sc-bulk-weight-pill">
                                ⚖️ ${weight.toFixed(2)}%
                            </span>
                            <div style="font-size: 10px; color: var(--text-secondary); margin-top: 2px;">Target: ${item.targetWeight ? item.targetWeight.toFixed(2) : '0.00'}%</div>
                        </td>
                        <td style="padding: 10px 12px; text-align: center; vertical-align: middle;">
                            <button type="button" class="sc-bulk-delete-btn" onclick="removeStockFromBulkBasket(${idx})" title="Remove stock">✕</button>
                        </td>
                    </tr>
                `;
            });

            tbody.innerHTML = html;
        }

        function updateBulkRowDisplay(idx) {
            const item = bulkStockBasket[idx];
            if (!item) return;

            const amountEl = document.getElementById(`scBulkAmount-${idx}`);
            if (amountEl) {
                amountEl.innerText = `₹${item.amount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            }

            const weightEl = document.getElementById(`scBulkWeight-${idx}`);
            if (weightEl) {
                weightEl.innerHTML = `
                    <span class="sc-bulk-weight-pill">
                        ⚖️ ${item.weight.toFixed(2)}%
                    </span>
                    <div style="font-size: 10px; color: var(--text-secondary); margin-top: 2px;">Target: ${item.targetWeight ? item.targetWeight.toFixed(2) : '0.00'}%</div>
                `;
            }

            bulkStockBasket.forEach((other, oIdx) => {
                if (oIdx !== idx) {
                    const oWeightEl = document.getElementById(`scBulkWeight-${oIdx}`);
                    if (oWeightEl) {
                        oWeightEl.innerHTML = `
                            <span class="sc-bulk-weight-pill">
                                ⚖️ ${other.weight.toFixed(2)}%
                            </span>
                            <div style="font-size: 10px; color: var(--text-secondary); margin-top: 2px;">Target: ${other.targetWeight ? other.targetWeight.toFixed(2) : '0.00'}%</div>
                        `;
                    }
                }
            });
        }

        function showBulkStatus(msg, type = 'info') {
            const el = document.getElementById('scBulkStatus');
            if (!el) return;
            el.innerText = msg;
            el.style.display = 'block';
            if (type === 'error') {
                el.style.color = '#ef4444';
            } else if (type === 'success') {
                el.style.color = '#10b981';
            } else if (type === 'warning') {
                el.style.color = '#f59e0b';
            } else {
                el.style.color = 'var(--text-secondary)';
            }
        }

        async function submitBulkStockBasket() {
            if (!bulkStockSmallcaseId) {
                showBulkStatus('No Smallcase selected!', 'error');
                return;
            }

            if (!bulkStockBasket.length) {
                showBulkStatus('Please add at least one stock to the basket.', 'error');
                return;
            }

            const dateInput = document.getElementById('scBulkDate');
            const txDate = (dateInput && dateInput.value) ? dateInput.value : new Date().toISOString().split('T')[0];

            for (let i = 0; i < bulkStockBasket.length; i++) {
                const s = bulkStockBasket[i];
                if (!s.price || s.price <= 0) {
                    showBulkStatus(`Invalid price for ${s.symbol}. Please enter a positive price.`, 'error');
                    return;
                }
                if (!s.quantity || s.quantity <= 0) {
                    showBulkStatus(`Invalid quantity for ${s.symbol}. Please enter at least 1 share.`, 'error');
                    return;
                }
            }

            const submitBtn = document.getElementById('scBulkSubmitBtn');
            const bulkOverlay = document.getElementById('scBulkLoaderOverlay');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span class="sc-btn-spinner"></span> Adding stocks...';
            }
            if (bulkOverlay) bulkOverlay.style.display = 'flex';

            const plannedAmount = document.getElementById('scBulkPlannedAmount')?.value || '';
            const txs = bulkStockBasket.map(s => ({
                symbol: s.symbol,
                stock_name: s.name,
                price: s.price,
                quantity: s.quantity,
                transaction_date: txDate,
                transaction_type: 'BUY',
                charges: 0,
                notes: `Equal weight basket (Planned: ₹${plannedAmount})`
            }));

            try {
                const res = await fetch(`/api/smallcases/${encodeURIComponent(bulkStockSmallcaseId)}/transactions/bulk`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ transactions: txs })
                });

                const data = await res.json();
                if (!res.ok || data.error) {
                    throw new Error(data.error || 'Failed to add bulk stocks');
                }

                showBulkStatus(`Success! Added ${data.count} stocks to smallcase.`, 'success');

                setTimeout(async () => {
                    closeSmallcaseModal('bulkStockSmallcaseModal');
                    await loadSmallcasesTab();
                    if (selectedSmallcaseId && String(selectedSmallcaseId) === String(bulkStockSmallcaseId)) {
                        await viewSmallcaseDetails(bulkStockSmallcaseId);
                    }
                }, 400);

            } catch (err) {
                showBulkStatus(err.message, 'error');
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerText = '✓ Add All Stocks to Smallcase';
                }
                if (bulkOverlay) bulkOverlay.style.display = 'none';
            }
        }

        // Global dropdown closer for bulk search
        document.addEventListener('click', (e) => {
            const scBulkDrop = document.getElementById('dropdown-scBulk');
            if (scBulkDrop && !e.target.closest('#scBulkSearchInput') && !e.target.closest('#dropdown-scBulk')) {
                scBulkDrop.style.display = 'none';
            }
        });

        // Expose global window hooks
        window.openBulkStockModal = openBulkStockModal;
        window.setBulkPlannedAmount = setBulkPlannedAmount;
        window.recalcBulkWeights = recalcBulkWeights;
        window.handleBulkStockSearch = handleBulkStockSearch;
        window.toggleBulkPasteBox = toggleBulkPasteBox;
        window.addPastedBulkStocks = addPastedBulkStocks;
        window.removeStockFromBulkBasket = removeStockFromBulkBasket;
        window.clearAllBulkStocks = clearAllBulkStocks;
        window.onBulkQtyChange = onBulkQtyChange;
        window.onBulkPriceChange = onBulkPriceChange;
        window.submitBulkStockBasket = submitBulkStockBasket;
