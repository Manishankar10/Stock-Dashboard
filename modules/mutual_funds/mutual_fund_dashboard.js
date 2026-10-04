(function () {
    const fmtMoney = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }) : '—';
    const fmtNumber = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
    const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    const fmtDate = value => {
        if (!value) return '—';
        const date = new Date(value + 'T00:00:00');
        return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    };
    const localToday = () => {
        const now = new Date();
        return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    };

    let portfolio = null;
    let catalog = [];
    let performance = [];
    let filteredMissed = [];
    let performanceRequest = 0;
    let toastTimer;

    async function api(url, options) {
        const response = await fetch(url, Object.assign({ cache: 'no-store' }, options || {}));
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Request failed.');
        return data;
    }

    function toast(message, error) {
        const el = document.getElementById('mf-toast');
        el.textContent = message;
        el.classList.toggle('error', Boolean(error));
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('show'), 3300);
    }

    function setBusy(button, busy, label) {
        button.disabled = busy;
        button.dataset.originalLabel = button.dataset.originalLabel || button.textContent;
        button.textContent = busy ? label : button.dataset.originalLabel;
    }

    function renderPortfolio(data) {
        portfolio = data;
        const fundFilter = document.getElementById('dashboard-scheme');
        const previousFund = fundFilter.value;
        const allFunds = new Map();
        ['holdings', 'sip_plans', 'transactions', 'missed_sips'].forEach(key => (data[key] || []).forEach(row => {
            const code = String(row.scheme_code || '');
            if (code && !allFunds.has(code)) allFunds.set(code, row.scheme_name || 'Mutual fund scheme');
        }));
        fundFilter.innerHTML = '<option value="">All funds</option>' + [...allFunds.entries()].map(([code, name]) => '<option value="' + escapeHtml(code) + '">' + escapeHtml(name) + '</option>').join('');
        if ([...fundFilter.options].some(option => option.value === previousFund)) fundFilter.value = previousFund;
        else fundFilter.value = '';
        applyDashboardFilter();
        const notice = document.getElementById('portfolio-feed-notice');
        notice.hidden = true;
        if ((data.transactions || []).length && !performance.length) loadPerformance();
    }

    function applyDashboardFilter() {
        if (!portfolio) return;
        const schemeCode = document.getElementById('dashboard-scheme').value;
        const matches = row => !schemeCode || String(row.scheme_code) === schemeCode;
        const holdings = (portfolio.holdings || []).filter(matches);
        const transactions = (portfolio.transactions || []).filter(matches);
        const missed = (portfolio.missed_sips || []).filter(matches);
        const plans = (portfolio.sip_plans || []).filter(matches);
        const summary = schemeCode ? summarizeFund(holdings[0], transactions) : (portfolio.summary || {});
        filteredMissed = missed;
        document.getElementById('portfolio-invested').textContent = fmtMoney(summary.invested);
        document.getElementById('portfolio-value').textContent = fmtMoney(summary.current_value);
        const pnl = document.getElementById('portfolio-pnl');
        pnl.textContent = fmtMoney(summary.pnl);
        pnl.classList.toggle('mf-pnl-positive', Number(summary.pnl) >= 0);
        pnl.classList.toggle('mf-pnl-negative', Number(summary.pnl) < 0);
        document.getElementById('portfolio-return').textContent = summary.return_pct == null ? 'No recorded investments' : fmtNumber(summary.return_pct, 2) + '% total return';
        document.getElementById('portfolio-xirr').textContent = summary.xirr == null ? '—' : fmtNumber(summary.xirr, 2) + '%';
        document.getElementById('portfolio-nav-date').textContent = 'NAVs as of ' + fmtDate(portfolio.nav_as_of) + (portfolio.refreshed_at ? ' · checked ' + new Date(portfolio.refreshed_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ' · refresh unavailable');
        renderHoldings(holdings);
        renderMissed(missed);
        renderPlans(plans);
        renderTransactions(transactions);
        document.getElementById('performance-subtitle').textContent = schemeCode ? 'NAV history for ' + allFundsName(schemeCode) + '.' : 'NAV history for your portfolio.';
    }

    function allFundsName(schemeCode) {
        const selected = Array.from(document.getElementById('dashboard-scheme').options).find(option => option.value === schemeCode);
        return selected ? selected.textContent : 'the selected fund';
    }

    function summarizeFund(holding, transactions) {
        const invested = transactions.reduce((total, row) => total + (Number(row.amount) || 0), 0);
        const currentValue = holding ? Number(holding.current_value) || 0 : 0;
        const pnl = currentValue - invested;
        return {
            invested,
            current_value: currentValue,
            pnl,
            return_pct: invested ? (currentValue / invested - 1) * 100 : null,
            xirr: calculateXirr(transactions, currentValue),
        };
    }

    function calculateXirr(transactions, currentValue) {
        if (!transactions.length) return null;
        const flows = transactions.map(row => ({ date: Date.parse(row.investment_date + 'T00:00:00Z'), amount: -Math.abs(Number(row.amount) || 0) })).filter(row => Number.isFinite(row.date));
        if (currentValue > 0) flows.push({ date: Date.now(), amount: currentValue });
        if (!flows.some(row => row.amount < 0) || !flows.some(row => row.amount > 0)) return null;
        flows.sort((a, b) => a.date - b.date);
        const origin = flows[0].date;
        const npv = rate => flows.reduce((sum, flow) => sum + flow.amount / Math.pow(1 + rate, (flow.date - origin) / 31557600000), 0);
        let low = -0.9999, high = 10, lowValue = npv(low), highValue = npv(high);
        if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) return null;
        for (let index = 0; index < 100; index++) {
            const middle = (low + high) / 2, middleValue = npv(middle);
            if (Math.abs(middleValue) < 1e-7) { low = high = middle; break; }
            if (lowValue * middleValue <= 0) { high = middle; highValue = middleValue; }
            else { low = middle; lowValue = middleValue; }
        }
        return ((low + high) / 2) * 100;
    }

    function renderHoldings(rows) {
        const body = document.getElementById('holding-rows');
        document.getElementById('holding-count').textContent = rows.length + (rows.length === 1 ? ' scheme' : ' schemes');
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="7" class="mf-table-message">No investments yet. Select “Start SIP” to add a fund to your portfolio.</td></tr>';
            return;
        }
        body.innerHTML = rows.map(row => {
            const pnlClass = Number(row.pnl) >= 0 ? 'mf-pnl-positive' : 'mf-pnl-negative';
            return '<tr><td><div class="mf-scheme-name"><a class="mf-detail-link" href="/mutual-funds/fund/' + encodeURIComponent(row.scheme_code) + '">' + escapeHtml(row.scheme_name) + '</a><small>' + escapeHtml(row.amc || 'AMFI') + ' · Code ' + escapeHtml(row.scheme_code) + '</small></div></td>' +
                '<td>' + fmtNumber(row.units, 4) + '</td><td class="mf-right">' + fmtMoney(row.invested) + '</td><td class="mf-right mf-nav-value">₹' + fmtNumber(row.current_nav, 4) + '</td>' +
                '<td>' + fmtDate(row.nav_date) + (row.nav_updated ? '' : ' <span class="mf-cell-muted">(saved NAV)</span>') + '</td><td class="mf-right">' + fmtMoney(row.current_value) + '</td><td class="mf-right ' + pnlClass + '">' + fmtMoney(row.pnl) + '<br><small>' + (row.return_pct == null ? '—' : fmtNumber(row.return_pct, 2) + '%') + '</small></td></tr>';
        }).join('');
    }

    function renderMissed(rows) {
        const body = document.getElementById('missed-rows');
        document.getElementById('clear-due').disabled = rows.length === 0;
        document.getElementById('missed-count').textContent = rows.length + (rows.length === 1 ? ' due' : ' due');
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="5" class="mf-table-message">No missed installments. A scheduled installment will appear here when its date passes.</td></tr>';
            return;
        }
        body.innerHTML = rows.map(row => '<tr><td><div class="mf-scheme-name"><a class="mf-detail-link" href="/mutual-funds/fund/' + encodeURIComponent(row.scheme_code) + '">' + escapeHtml(row.scheme_name) + '</a><small>Monthly investment</small></div></td><td>' + fmtDate(row.scheduled_date) + '</td><td class="mf-right">' + fmtMoney(row.amount) + '</td><td class="mf-cell-muted">Looked up when recorded</td><td><button type="button" class="mf-row-action mf-catch-up" data-sip="' + escapeHtml(row.sip_id) + '" data-date="' + escapeHtml(row.scheduled_date) + '">Record installment</button></td></tr>').join('');
        body.querySelectorAll('.mf-catch-up').forEach(button => button.addEventListener('click', () => catchUp(button)));
    }

    function renderPlans(rows) {
        const body = document.getElementById('sip-rows');
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="6" class="mf-table-message">No monthly investment plans yet. Start a SIP to keep a recurring schedule.</td></tr>';
            return;
        }
        body.innerHTML = rows.map(row => {
            const active = row.status === 'ACTIVE';
            return '<tr><td><div class="mf-scheme-name"><a class="mf-detail-link" href="/mutual-funds/fund/' + encodeURIComponent(row.scheme_code) + '">' + escapeHtml(row.scheme_name) + '</a><small>' + escapeHtml(row.amc || '') + '</small></div></td><td>Day ' + escapeHtml(row.installment_day) + ' · Monthly</td><td>' + fmtDate(row.start_date) + '</td><td class="mf-right">' + fmtMoney(row.amount) + '</td><td><span class="mf-status-pill ' + (active ? '' : 'paused') + '">' + escapeHtml(row.status || 'ACTIVE') + '</span></td><td><button type="button" class="mf-row-action mf-toggle-sip" data-sip="' + escapeHtml(row.id) + '" data-status="' + (active ? 'PAUSED' : 'ACTIVE') + '">' + (active ? 'Pause' : 'Resume') + '</button></td></tr>';
        }).join('');
        body.querySelectorAll('.mf-toggle-sip').forEach(button => button.addEventListener('click', () => toggleSip(button)));
    }

    function renderTransactions(rows) {
        const body = document.getElementById('transaction-rows');
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="7" class="mf-table-message">Your saved investment history will appear here.</td></tr>';
            return;
        }
        body.innerHTML = rows.map(row => '<tr><td>' + fmtDate(row.investment_date) + '</td><td><div class="mf-scheme-name"><a class="mf-detail-link" href="/mutual-funds/fund/' + encodeURIComponent(row.scheme_code) + '">' + escapeHtml(row.scheme_name) + '</a><small>Code ' + escapeHtml(row.scheme_code) + '</small></div></td><td><span class="mf-tag">' + escapeHtml((row.kind || 'LUMPSUM').replace('_', ' ')) + '</span></td><td class="mf-right">' + fmtMoney(row.amount) + '</td><td class="mf-right">₹' + fmtNumber(row.nav, 4) + '</td><td>' + fmtDate(row.nav_date) + '</td><td class="mf-right">' + fmtNumber(row.units, 4) + '</td></tr>').join('');
    }

    async function loadPortfolio(button) {
        if (button) setBusy(button, true, '↻ Refreshing…');
        const body = document.getElementById('holding-rows');
        if (!portfolio) body.innerHTML = '<tr><td colspan="7" class="mf-table-message">Refreshing official AMFI NAVs and loading your saved records…</td></tr>';
        try {
            const data = await api('/api/mutual-funds/portfolio?refresh=1');
            renderPortfolio(data);
            const notice = document.getElementById('portfolio-feed-notice');
        } catch (error) {
            const notice = document.getElementById('portfolio-feed-notice');
            notice.hidden = false;
            notice.textContent = error.message + ' No cached NAV is being presented as current.';
            toast(error.message, true);
            if (!portfolio) body.innerHTML = '<tr><td colspan="7" class="mf-table-message">AMFI NAV data could not be refreshed. Your saved data remains on this account.</td></tr>';
        } finally {
            if (button) setBusy(button, false);
        }
    }

    function rangeStart(range, points) {
        if (!points.length || range === 'all') return null;
        const months = range === '1m' ? 1 : range === '6m' ? 6 : 12;
        const last = new Date(points[points.length - 1].date + 'T00:00:00');
        last.setMonth(last.getMonth() - months);
        return last;
    }

    function shortMoney(value) {
        const n = Number(value) || 0;
        if (Math.abs(n) >= 10000000) return '₹' + (n / 10000000).toFixed(1) + 'Cr';
        if (Math.abs(n) >= 100000) return '₹' + (n / 100000).toFixed(1) + 'L';
        if (Math.abs(n) >= 1000) return '₹' + (n / 1000).toFixed(0) + 'k';
        return '₹' + n.toFixed(0);
    }

    function drawChart() {
        const range = document.getElementById('performance-range').value;
        const cutoff = rangeStart(range, performance);
        const points = performance.filter(point => !cutoff || new Date(point.date + 'T00:00:00') >= cutoff);
        const chart = document.getElementById('performance-chart');
        const message = document.getElementById('performance-message');
        if (!points.length) {
            chart.hidden = true;
            message.hidden = false;
            message.textContent = performance.length ? 'No NAV history is available for this period.' : 'Start a SIP or One-Time investment to build your performance history.';
            return;
        }
        message.hidden = true;
        chart.hidden = false;
        const svg = document.getElementById('performance-svg');
        const width = 960, height = 300, left = 68, right = 18, top = 18, bottom = 16;
        const values = points.flatMap(point => [Number(point.value) || 0, Number(point.invested) || 0]);
        let max = Math.max(1, ...values);
        max *= 1.12;
        const innerW = width - left - right, innerH = height - top - bottom;
        const x = index => left + (points.length === 1 ? innerW / 2 : index * innerW / (points.length - 1));
        const y = value => top + innerH - (Number(value) || 0) / max * innerH;
        let markup = '';
        for (let tick = 0; tick <= 4; tick += 1) {
            const amount = max * tick / 4;
            const ypos = y(amount);
            markup += '<line class="mf-grid-line" x1="' + left + '" x2="' + (width - right) + '" y1="' + ypos + '" y2="' + ypos + '"></line>';
            markup += '<text class="mf-axis-label" x="' + (left - 9) + '" y="' + (ypos + 3) + '" text-anchor="end">' + shortMoney(amount) + '</text>';
        }
        const valuePath = points.map((point, index) => (index ? 'L' : 'M') + x(index).toFixed(2) + ',' + y(point.value).toFixed(2)).join(' ');
        const investedPath = points.map((point, index) => (index ? 'L' : 'M') + x(index).toFixed(2) + ',' + y(point.invested).toFixed(2)).join(' ');
        markup += '<path class="mf-invested-line" d="' + investedPath + '"></path><path class="mf-value-line" d="' + valuePath + '"></path>';
        const final = points[points.length - 1];
        markup += '<circle cx="' + x(points.length - 1) + '" cy="' + y(final.value) + '" r="4" fill="#10b981"><title>' + escapeHtml(fmtDate(final.date) + ' · ' + fmtMoney(final.value)) + '</title></circle>';
        svg.innerHTML = markup;
        document.getElementById('chart-start-date').textContent = fmtDate(points[0].date);
        document.getElementById('chart-end-date').textContent = fmtDate(points[points.length - 1].date);
        const selectedCode = document.getElementById('dashboard-scheme').value;
        const selectionLabel = selectedCode ? allFundsName(selectedCode) + ' · ' : 'Portfolio · ';
        document.getElementById('performance-subtitle').textContent = selectionLabel + 'value compared with contributions · ' + points.length.toLocaleString('en-IN') + ' AMFI NAV dates';
    }

    async function loadPerformance() {
        const requestId = ++performanceRequest;
        const message = document.getElementById('performance-message');
        const button = document.getElementById('load-performance');
        const schemeCode = document.getElementById('dashboard-scheme').value;
        message.hidden = false;
        message.textContent = schemeCode ? 'Loading NAV history for the selected fund…' : 'Loading saved NAV history for your portfolio. This can take a moment.';
        document.getElementById('performance-chart').hidden = true;
        setBusy(button, true, 'Loading…');
        try {
            const data = await api('/api/mutual-funds/performance?period=all' + (schemeCode ? '&scheme_code=' + encodeURIComponent(schemeCode) : ''));
            if (requestId !== performanceRequest) return;
            performance = data.points || [];
            if (!performance.length) {
                message.textContent = data.message || 'No performance history is available yet.';
                return;
            }
            drawChart();
        } catch (error) {
            if (requestId !== performanceRequest) return;
            message.textContent = 'NAV history could not be loaded. ' + error.message;
            toast(error.message, true);
        } finally {
            if (requestId === performanceRequest) setBusy(button, false);
        }
    }

    function showModal(id) {
        document.getElementById('investment-modal').hidden = false;
        setInvestmentMode(id === 'investment-modal' ? 'lumpsum' : 'sip');
        document.body.style.overflow = 'hidden';
    }
    function setInvestmentMode(mode) {
        const sip = mode === 'sip';
        document.getElementById('sip-form').hidden = !sip;
        document.getElementById('investment-form').hidden = sip;
        document.getElementById('sip-form').querySelectorAll('input').forEach(input => { input.disabled = !sip; });
        document.getElementById('investment-form').querySelectorAll('input').forEach(input => { input.disabled = sip; });
        document.querySelectorAll('[data-investment-mode]').forEach(button => button.classList.toggle('active', button.dataset.investmentMode === mode));
        document.getElementById('investment-modal-title').textContent = sip ? 'Start SIP' : 'One-Time Investment';
    }
    function closeModals() {
        document.querySelectorAll('.mf-modal-backdrop').forEach(modal => { modal.hidden = true; });
        document.body.style.overflow = '';
    }
    function resetPicker(prefix) {
        document.getElementById(prefix + '-scheme-search').value = '';
        document.getElementById(prefix + '-scheme-code').value = '';
        document.getElementById(prefix + '-scheme-selected').textContent = 'Select a scheme from the search results.';
        const results = document.getElementById(prefix + '-scheme-results');
        results.innerHTML = '';
        results.hidden = true;
    }

    async function loadCatalogForPicker() {
        if (catalog.length) return;
        const data = await api('/api/mutual-funds/catalog?refresh=1');
        catalog = data.schemes || [];
    }

    function bindPicker(prefix) {
        const input = document.getElementById(prefix + '-scheme-search');
        const codeInput = document.getElementById(prefix + '-scheme-code');
        const results = document.getElementById(prefix + '-scheme-results');
        const selected = document.getElementById(prefix + '-scheme-selected');
        input.addEventListener('input', function () {
            codeInput.value = '';
            selected.textContent = 'Select a scheme from the search results.';
            const query = input.value.trim().toLowerCase();
            if (query.length < 2 || !catalog.length) { results.hidden = true; return; }
            const matches = catalog.filter(row => (row.name + ' ' + row.amc + ' ' + row.scheme_code + ' ' + row.isin).toLowerCase().includes(query)).slice(0, 12);
            results.innerHTML = matches.length ? matches.map(row => '<button type="button" class="mf-scheme-option" data-code="' + escapeHtml(row.scheme_code) + '"><strong>' + escapeHtml(row.name) + '</strong><small>' + escapeHtml(row.amc) + ' · ' + escapeHtml(row.plan) + ' / ' + escapeHtml(row.option) + ' · NAV ₹' + fmtNumber(row.nav, 4) + ' · ' + fmtDate(row.nav_date) + '</small></button>').join('') : '<div class="mf-scheme-option"><small>No schemes match. Try another name.</small></div>';
            results.hidden = false;
            results.querySelectorAll('[data-code]').forEach(option => option.addEventListener('click', function () {
                const row = catalog.find(item => String(item.scheme_code) === this.dataset.code);
                if (!row) return;
                codeInput.value = row.scheme_code;
                input.value = row.name;
                selected.textContent = row.amc + ' · AMFI code ' + row.scheme_code + ' · Latest NAV ₹' + fmtNumber(row.nav, 4) + ' dated ' + fmtDate(row.nav_date);
                results.hidden = true;
                const otherPrefix = prefix === 'sip' ? 'investment' : 'sip';
                document.getElementById(otherPrefix + '-scheme-search').value = row.name;
                document.getElementById(otherPrefix + '-scheme-code').value = row.scheme_code;
                document.getElementById(otherPrefix + '-scheme-selected').textContent = row.amc + ' · AMFI code ' + row.scheme_code + ' · Latest NAV ₹' + fmtNumber(row.nav, 4) + ' dated ' + fmtDate(row.nav_date);
                const supportsSip = !/closed.?ended|interval/i.test(row.scheme_type || '');
                const supportsOneTime = !/closed.?ended|interval/i.test(row.scheme_type || '');
                document.querySelector('[data-investment-mode="sip"]').hidden = !supportsSip;
                document.querySelector('[data-investment-mode="lumpsum"]').hidden = !supportsOneTime;
                if (!supportsSip) setInvestmentMode('lumpsum');
                if (prefix === 'investment') updateInvestmentPreview();
            }));
        });
        document.addEventListener('click', event => { if (!results.contains(event.target) && event.target !== input) results.hidden = true; });
    }

    function updateInvestmentPreview() {
        const code = document.getElementById('investment-scheme-code').value;
        const date = document.getElementById('investment-date').value;
        const preview = document.getElementById('investment-nav-preview');
        const row = catalog.find(item => String(item.scheme_code) === code);
        if (!row || !date) { preview.hidden = true; return; }
        preview.hidden = false;
        if (date === row.nav_date) preview.textContent = 'Estimated units will use ₹' + fmtNumber(row.nav, 4) + ' NAV dated ' + fmtDate(row.nav_date) + '.';
        else preview.textContent = 'The saved record will look up AMFI history for this date and use the first published NAV on or after it.';
    }

    async function openInvestmentModal() {
        document.getElementById('investment-form').reset();
        resetPicker('investment');
        const today = localToday();
        const date = document.getElementById('investment-date');
        date.max = today;
        date.value = today;
        document.getElementById('investment-nav-preview').hidden = true;
        showModal('investment-modal');
        try {
            await loadCatalogForPicker();
            if (document.getElementById('investment-scheme-search').value.trim()) {
                document.getElementById('investment-scheme-search').dispatchEvent(new Event('input', { bubbles: true }));
            }
            const wanted = new URLSearchParams(location.search).get('scheme_code');
            if (wanted) {
                const row = catalog.find(item => String(item.scheme_code) === wanted);
                if (row) {
                    document.getElementById('investment-scheme-search').value = row.name;
                    document.getElementById('investment-scheme-code').value = row.scheme_code;
                    document.getElementById('investment-scheme-selected').textContent = row.amc + ' · AMFI code ' + row.scheme_code + ' · NAV ₹' + fmtNumber(row.nav, 4) + ' dated ' + fmtDate(row.nav_date);
                    updateInvestmentPreview();
                    history.replaceState(null, '', '/mutual-funds/dashboard');
                }
            }
        } catch (error) { toast(error.message, true); }
    }

    async function openSipModal() {
        document.querySelectorAll('[data-investment-mode]').forEach(button => { button.hidden = false; });
        document.getElementById('sip-form').reset();
        document.getElementById('investment-form').reset();
        resetPicker('sip');
        resetPicker('investment');
        document.getElementById('sip-start-date').value = localToday();
        const investmentDate = document.getElementById('investment-date');
        investmentDate.max = localToday();
        investmentDate.value = localToday();
        document.getElementById('sip-amount').value = 500;
        document.getElementById('investment-amount').value = 500;
        document.getElementById('investment-nav-preview').hidden = true;
        showModal('sip-modal');
        try {
            await loadCatalogForPicker();
            if (document.getElementById('sip-scheme-search').value.trim()) {
                document.getElementById('sip-scheme-search').dispatchEvent(new Event('input', { bubbles: true }));
            }
            const wanted = new URLSearchParams(location.search).get('scheme_code');
            if (wanted) {
                const row = catalog.find(item => String(item.scheme_code) === wanted);
                if (row) {
                    document.getElementById('sip-scheme-search').value = row.name;
                    document.getElementById('sip-scheme-code').value = row.scheme_code;
                    document.getElementById('sip-scheme-selected').textContent = row.amc + ' · AMFI code ' + row.scheme_code;
                    document.getElementById('investment-scheme-search').value = row.name;
                    document.getElementById('investment-scheme-code').value = row.scheme_code;
                    document.getElementById('investment-scheme-selected').textContent = row.amc + ' · AMFI code ' + row.scheme_code;
                    const supportsNewInvestment = !/closed.?ended|interval/i.test(row.scheme_type || '');
                    document.querySelector('[data-investment-mode="sip"]').hidden = !supportsNewInvestment;
                    document.querySelector('[data-investment-mode="lumpsum"]').hidden = !supportsNewInvestment;
                    if (!supportsNewInvestment) setInvestmentMode('lumpsum');
                    history.replaceState(null, '', '/mutual-funds/dashboard');
                }
            }
        } catch (error) { toast(error.message, true); }
    }

    async function submitInvestment(event) {
        event.preventDefault();
        const button = document.getElementById('investment-submit');
        const payload = {
            scheme_code: document.getElementById('investment-scheme-code').value,
            amount: document.getElementById('investment-amount').value,
            investment_date: document.getElementById('investment-date').value,
            kind: 'LUMPSUM',
        };
        if (!payload.scheme_code) { toast('Select a scheme from the search results.', true); return; }
        setBusy(button, true, 'Saving…');
        try {
            const data = await api('/api/mutual-funds/investments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            closeModals();
            toast('Investment saved at AMFI NAV dated ' + fmtDate(data.transaction.nav_date) + '.');
            performance = [];
            await loadPortfolio();
        } catch (error) { toast(error.message, true); }
        finally { setBusy(button, false); }
    }

    async function submitSip(event) {
        event.preventDefault();
        const button = document.getElementById('sip-submit');
        const payload = {
            scheme_code: document.getElementById('sip-scheme-code').value,
            amount: document.getElementById('sip-amount').value,
            start_date: document.getElementById('sip-start-date').value,
            installment_day: document.getElementById('sip-installment-day').value || undefined,
        };
        if (!payload.scheme_code) { toast('Select a scheme from the search results.', true); return; }
        setBusy(button, true, 'Saving…');
        try {
            await api('/api/mutual-funds/sips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            closeModals();
            toast('Monthly investment plan saved.');
            await loadPortfolio();
        } catch (error) { toast(error.message, true); }
        finally { setBusy(button, false); }
    }

    async function catchUp(button) {
        const oldText = button.textContent;
        button.disabled = true;
        button.textContent = 'Looking up NAV…';
        try {
            const data = await api('/api/mutual-funds/sips/' + encodeURIComponent(button.dataset.sip) + '/catch-up', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scheduled_date: button.dataset.date }) });
            toast(data.message);
            performance = [];
            await loadPortfolio();
        } catch (error) { toast(error.message, true); button.disabled = false; button.textContent = oldText; }
    }

    async function clearDue(button) {
        if (!filteredMissed.length || !portfolio) return;
        const dueRows = filteredMissed.slice();
        button.disabled = true;
        let completed = 0;
        const failures = [];
        try {
            for (let index = 0; index < dueRows.length; index++) {
                const row = dueRows[index];
                button.textContent = 'Clearing ' + (index + 1) + '/' + dueRows.length + '…';
                try {
                    await api('/api/mutual-funds/sips/' + encodeURIComponent(row.sip_id) + '/catch-up', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ scheduled_date: row.scheduled_date }),
                    });
                    completed++;
                } catch (error) {
                    failures.push(row.scheme_name + ' (' + fmtDate(row.scheduled_date) + '): ' + error.message);
                }
            }
            if (completed) {
                performance = [];
                await loadPortfolio();
            }
            if (failures.length) {
                toast(completed + ' installment' + (completed === 1 ? '' : 's') + ' completed; ' + failures.length + ' could not be recorded. ' + failures[0], true);
            } else {
                toast(completed + ' due installment' + (completed === 1 ? '' : 's') + ' completed.');
            }
        } finally {
            button.textContent = 'Clear Due';
            button.disabled = !filteredMissed.length;
        }
    }

    async function toggleSip(button) {
        const status = button.dataset.status;
        button.disabled = true;
        try {
            await api('/api/mutual-funds/sips/' + encodeURIComponent(button.dataset.sip) + '/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
            await loadPortfolio();
            toast(status === 'PAUSED' ? 'Monthly plan paused.' : 'Monthly plan resumed.');
        } catch (error) { toast(error.message, true); button.disabled = false; }
    }

    document.getElementById('portfolio-refresh').addEventListener('click', function () { performance = []; loadPortfolio(this); });
    document.getElementById('open-sip').addEventListener('click', openSipModal);
    document.getElementById('plan-start-button').addEventListener('click', openSipModal);
    document.getElementById('investment-form').addEventListener('submit', submitInvestment);
    document.getElementById('sip-form').addEventListener('submit', submitSip);
    document.getElementById('investment-date').addEventListener('change', updateInvestmentPreview);
    document.getElementById('load-performance').addEventListener('click', loadPerformance);
    document.getElementById('performance-range').addEventListener('change', drawChart);
    document.getElementById('dashboard-scheme').addEventListener('change', function () {
        applyDashboardFilter();
        performance = [];
        loadPerformance();
    });
    document.getElementById('clear-due').addEventListener('click', function () { clearDue(this); });
    document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeModals));
    document.querySelectorAll('.mf-modal-backdrop').forEach(modal => modal.addEventListener('click', event => { if (event.target === modal) closeModals(); }));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModals(); });
    bindPicker('investment');
    bindPicker('sip');
    document.getElementById('portfolio-value').setAttribute('title', 'Latest AMFI NAV valuation');
    renderPlans([]);
    loadPortfolio();
    document.querySelectorAll('[data-investment-mode]').forEach(button => button.addEventListener('click', () => setInvestmentMode(button.dataset.investmentMode)));
    if (new URLSearchParams(location.search).has('scheme_code')) setTimeout(openSipModal, 350);
    setInvestmentMode('sip');
})();
