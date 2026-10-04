(function () {
    'use strict';

    const palette = { invested: '#10b981', growth: '#6366f1', pale: '#dbeafe' };
    const currentYear = new Date().getFullYear();
    const today = toISODate(new Date());
    const calculators = [
        { id: 'sip', label: 'SIP', title: 'SIP Calculator', description: 'Estimate the future value of regular monthly investments.' },
        { id: 'lumpsum', label: 'Lumpsum', title: 'Lumpsum Calculator', description: 'Estimate the future value of a one-time investment.' },
        { id: 'swp', label: 'SWP', title: 'SWP Calculator', description: 'Estimate withdrawals and the remaining value of your investment corpus.' },
        { id: 'fd', label: 'FD', title: 'FD Calculator', description: 'Estimate fixed deposit maturity and the effect of inflation.' },
        { id: 'emi', label: 'EMI', title: 'EMI Calculator', description: 'Estimate your monthly loan payment and repayment schedule.' },
        { id: 'xirr', label: 'XIRR', title: 'XIRR Calculator', description: 'Calculate annualized return from dated cash flows.' },
        { id: 'cagr', label: 'CAGR', title: 'CAGR Calculator', description: 'Calculate the compound annual growth rate over a period.' },
        { id: 'retirement', label: 'Retirement', title: 'Retirement Calculator', description: 'Compare your projected savings with an estimated retirement corpus.' },
        { id: 'averager', label: 'Averager', title: 'Averager', description: 'Calculate your weighted average share price after an additional buy.' },
    ];
    const configs = {
        sip: [
            numberField('monthly', 'Monthly investment', 25000, 500, 10000000, 500),
            numberField('returnRate', 'Expected return (p.a.)', 12, 0, 100, 0.1, '%'),
            numberField('years', 'Investment duration', 10, 1, null, 1, 'years'),
            toggleField('stepEnabled', 'Include step-up', true, 'stepRate', 10, '% p.a.'),
            toggleField('inflationEnabled', 'Inflation adjusted', true, 'inflationRate', 6, '% p.a.'),
        ],
        lumpsum: [
            numberField('principal', 'One-time investment amount', 100000, 1, 1000000000, 1000),
            numberField('returnRate', 'Expected return (p.a.)', 12, 0, 100, 0.1, '%'),
            numberField('years', 'Investment duration (years)', 10, 1, null, 1),
            numberField('annualTopup', 'Annual top-up (optional)', 0, 0, 1000000000, 1000),
            toggleField('stepEnabled', 'Increase annual top-up', false, 'stepRate', 10, '% p.a.'),
            toggleField('inflationEnabled', 'Inflation adjusted', true, 'inflationRate', 6, '% p.a.'),
        ],
        swp: [
            numberField('corpus', 'Initial investment corpus', 2500000, 1, 1000000000, 10000),
            numberField('withdrawal', 'Monthly withdrawal', 25000, 1, 10000000, 500),
            numberField('returnRate', 'Expected return (p.a.)', 9, 0, 100, 0.1, '%'),
            numberField('startAfter', 'Withdrawal starts after (years)', 0, 0, null, 0.5),
            numberField('years', 'Withdrawal duration', 15, 1, null, 1, 'years'),
            toggleField('stepEnabled', 'Increase withdrawal', false, 'stepRate', 5, '% p.a.'),
            toggleField('inflationEnabled', 'Inflation adjusted', true, 'inflationRate', 6, '% p.a.'),
        ],
        fd: [
            numberField('principal', 'Deposit amount', 500000, 1, 1000000000, 10000),
            numberField('returnRate', 'Interest rate (p.a.)', 7, 0, 100, 0.1, '%'),
            numberField('years', 'Deposit duration', 5, 1, null, 1, 'years'),
            selectField('frequency', 'Compounding frequency', '4', [['1', 'Yearly'], ['2', 'Half-yearly'], ['4', 'Quarterly'], ['12', 'Monthly']]),
            toggleField('inflationEnabled', 'Inflation adjusted', true, 'inflationRate', 6, '% p.a.'),
        ],
        emi: [
            numberField('principal', 'Loan amount', 2500000, 1, 1000000000, 10000),
            numberField('returnRate', 'Interest rate (p.a.)', 9, 0, 100, 0.1, '%'),
            numberField('years', 'Loan tenure', 20, 1, null, 1, 'years'),
            toggleField('stepEnabled', 'Include EMI step-up', false, 'stepRate', 5, '% p.a.'),
        ],
        xirr: [{ key: 'cashflows', label: 'Cash flows', type: 'cashflows' }],
        cagr: [
            numberField('startValue', 'Starting value', 100000, 1, 1000000000, 1000),
            numberField('endValue', 'Ending value', 180000, 1, 1000000000, 1000),
            { key: 'startDate', label: 'Start date', type: 'date', value: toISODate(addYears(new Date(), -5)) },
            { key: 'endDate', label: 'End date', type: 'date', value: today },
        ],
        retirement: [
            numberField('age', 'Your current age', 30, 18, 100, 1, 'years'),
            numberField('retireAge', 'Retirement age', 60, 19, 100, 1, 'years'),
            numberField('lifeAge', 'Plan until age', 85, 20, 120, 1, 'years'),
            numberField('monthlyExpenses', 'Monthly expenses today', 60000, 1, 10000000, 1000),
            numberField('currentSavings', 'Current retirement savings', 500000, 0, 1000000000, 10000),
            numberField('monthlySaving', 'Monthly retirement saving', 25000, 0, 10000000, 1000),
            numberField('inflation', 'Inflation rate (p.a.)', 6, 0, 100, 0.1, '%'),
            numberField('preReturn', 'Return before retirement (p.a.)', 10, 0, 100, 0.1, '%'),
            numberField('postReturn', 'Return after retirement (p.a.)', 7, 0, 100, 0.1, '%'),
        ],
        averager: [
            numberField('existingPrice', 'Existing price per share', 10, 0, null, 0.01, '₹'),
            numberField('existingQuantity', 'Existing quantity', 10, 0, null, 1, 'shares'),
            numberField('buyPrice', 'Current buy price', 8, 0, null, 0.01, '₹'),
            numberField('buyQuantity', 'Current buy quantity', 10, 0, null, 1, 'shares'),
        ],
    };
    const defaults = {
        sip: { monthly: 25000, returnRate: 12, years: 10, stepEnabled: true, stepRate: 10, inflationEnabled: true, inflationRate: 6 },
        lumpsum: { principal: 100000, returnRate: 12, years: 10, annualTopup: 0, stepEnabled: false, stepRate: 10, inflationEnabled: true, inflationRate: 6 },
        swp: { corpus: 2500000, withdrawal: 25000, returnRate: 9, startAfter: 0, years: 15, stepEnabled: false, stepRate: 5, inflationEnabled: true, inflationRate: 6 },
        fd: { principal: 500000, returnRate: 7, years: 5, frequency: '4', inflationEnabled: true, inflationRate: 6 },
        emi: { principal: 2500000, returnRate: 9, years: 20, stepEnabled: false, stepRate: 5 },
        xirr: { cashflows: [{ date: today, amount: -100000 }, { date: toISODate(addYears(new Date(), 1)), amount: 120000 }] },
        cagr: { startValue: 100000, endValue: 180000, startDate: toISODate(addYears(new Date(), -5)), endDate: today },
        retirement: { age: 30, retireAge: 60, lifeAge: 85, monthlyExpenses: 60000, currentSavings: 500000, monthlySaving: 25000, inflation: 6, preReturn: 10, postReturn: 7 },
        averager: { existingPrice: 10, existingQuantity: 10, buyPrice: 8, buyQuantity: 10 },
    };
    const state = JSON.parse(JSON.stringify(defaults));
    let active = 'sip';
    let lastResult = null;
    let saveTimer = null;
    let saveQueue = Promise.resolve();

    const elements = {
        tabs: document.getElementById('calculator-tabs'),
        title: document.getElementById('calculator-title'),
        description: document.getElementById('calculator-description'),
        inputs: document.getElementById('calculator-inputs'),
        summary: document.getElementById('calculator-summary'),
        chartTitle: document.getElementById('chart-title'),
        chartDescription: document.getElementById('chart-description'),
        chartLegend: document.getElementById('chart-legend'),
        chart: document.getElementById('calculator-chart'),
    };

    function toISODate(value) {
        const date = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
        return date.toISOString().slice(0, 10);
    }
    function addYears(date, years) { const next = new Date(date); next.setFullYear(next.getFullYear() + years); return next; }
    function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
    function numeric(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
    function numberField(key, label, value, min, max, step, suffix) { return { key, label, value, min, max, step, suffix: suffix || '', type: 'number' }; }
    function toggleField(key, label, checked, valueKey, value, suffix) { return { key, label, checked, type: 'toggle', valueKey, value, suffix }; }
    function selectField(key, label, value, options) { return { key, label, value, type: 'select', options }; }
    function money(value, decimals) {
        if (!Number.isFinite(value)) return '—';
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: decimals == null ? 0 : decimals, minimumFractionDigits: 0 }).format(value);
    }
    function compactMoney(value) {
        const absolute = Math.abs(value);
        if (absolute >= 10000000) return '₹' + (value / 10000000).toFixed(1) + 'Cr';
        if (absolute >= 100000) return '₹' + (value / 100000).toFixed(1) + 'L';
        if (absolute >= 1000) return '₹' + (value / 1000).toFixed(0) + 'K';
        return money(value);
    }
    function percent(value, decimals) { return Number.isFinite(value) ? value.toFixed(decimals == null ? 2 : decimals) + '%' : '—'; }
    function safeYears(value, fallback) { return Math.max(1, numeric(value, fallback)); }

    function scheduleStateSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            const body = JSON.stringify({ active, calculators: state });
            saveQueue = saveQueue.catch(() => {}).then(() => fetch('/api/plan-calculator/state', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body,
            })).catch(() => {});
        }, 350);
    }

    async function loadSavedState() {
        try {
            const response = await fetch('/api/plan-calculator/state', { cache: 'no-store', credentials: 'same-origin' });
            if (!response.ok) return;
            const saved = await response.json();
            if (saved.calculators && typeof saved.calculators === 'object') {
                Object.keys(defaults).forEach(id => {
                    const values = saved.calculators[id];
                    if (values && typeof values === 'object' && !Array.isArray(values)) state[id] = { ...state[id], ...values };
                });
                if (!Array.isArray(state.xirr.cashflows)) state.xirr.cashflows = defaults.xirr.cashflows;
            }
            if (calculators.some(item => item.id === saved.active)) active = saved.active;
        } catch (error) {
            // Keep calculator defaults available when saved settings cannot be reached.
        }
    }

    function renderTabs() {
        elements.tabs.innerHTML = calculators.map(item => '<button class="pc-tab' + (item.id === active ? ' active' : '') + '" type="button" role="tab" aria-selected="' + (item.id === active) + '" data-calculator="' + item.id + '">' + item.label + '</button>').join('');
    }
    function renderField(field) {
        if (field.type === 'cashflows') return renderCashflows();
        if (field.type === 'toggle') {
            const checked = Boolean(state[active][field.key]);
            const stepValue = state[active][field.valueKey];
            return '<div class="pc-field"><div class="pc-option-box"><input type="checkbox" id="field-' + field.key + '" data-field="' + field.key + '" ' + (checked ? 'checked' : '') + '><label for="field-' + field.key + '">' + escapeHtml(field.label) + '</label><input class="pc-control" aria-label="' + escapeHtml(field.label + ' percentage') + '" type="number" min="0" max="100" step="0.1" data-field="' + field.valueKey + '" value="' + escapeHtml(stepValue) + '" ' + (checked ? '' : 'disabled') + '><span class="pc-suffix">' + escapeHtml(field.suffix) + '</span></div></div>';
        }
        if (field.type === 'select') {
            const value = state[active][field.key];
            return '<div class="pc-field"><label for="field-' + field.key + '">' + escapeHtml(field.label) + '</label><select class="pc-control" id="field-' + field.key + '" data-field="' + field.key + '">' + field.options.map(option => '<option value="' + option[0] + '" ' + (String(value) === option[0] ? 'selected' : '') + '>' + escapeHtml(option[1]) + '</option>').join('') + '</select></div>';
        }
        const value = state[active][field.key] == null ? field.value : state[active][field.key];
        const type = field.type === 'date' ? 'date' : 'number';
        const attrs = type === 'date' ? '' : (field.min != null ? ' min="' + field.min + '"' : '') + (field.max != null ? ' max="' + field.max + '"' : '') + (field.step != null ? ' step="' + field.step + '"' : '');
        return '<div class="pc-field"><label for="field-' + field.key + '">' + escapeHtml(field.label) + '</label><input class="pc-control" id="field-' + field.key + '" type="' + type + '" data-field="' + field.key + '" value="' + escapeHtml(value) + '"' + attrs + '></div>';
    }
    function renderCashflows() {
        const rows = state.xirr.cashflows;
        return '<div class="pc-field pc-cashflow-field"><span class="pc-field-label">Cash flows</span><table class="pc-cashflow-table"><thead><tr><th>Date</th><th>Amount</th><th aria-label="Remove row"></th></tr></thead><tbody>' + rows.map((row, index) => '<tr><td><input class="pc-control" type="date" data-cashflow-date="' + index + '" value="' + escapeHtml(row.date) + '"></td><td><input class="pc-control" type="number" step="100" data-cashflow-amount="' + index + '" value="' + escapeHtml(row.amount) + '"></td><td><button class="pc-remove-row" type="button" data-remove-cashflow="' + index + '" aria-label="Remove cash flow">×</button></td></tr>').join('') + '</tbody></table><button class="pc-add-row" type="button" data-add-cashflow>+ Add cash flow</button></div>';
    }
    function renderInputs() {
        const note = active === 'sip'
            ? 'Contributions are assumed at each month end. Step-up increases the monthly contribution once per year.'
            : active === 'lumpsum'
                ? 'Optional annual top-ups start after year one. When enabled, each top-up increases by the selected step-up rate.'
                : active === 'averager'
                    ? 'Average price = (existing cost + current buy cost) ÷ total shares.'
                : 'Change the values to update the estimated result and projection.';
        elements.inputs.innerHTML = '<div class="pc-input-grid">' + configs[active].map(renderField).join('') + '</div><p class="pc-input-note">' + note + '</p>';
    }
    function pickInputs() {
        const input = state[active];
        if (active === 'sip') return calculateSip(input);
        if (active === 'lumpsum') return calculateLumpsum(input);
        if (active === 'swp') return calculateSwp(input);
        if (active === 'fd') return calculateFd(input);
        if (active === 'emi') return calculateEmi(input);
        if (active === 'xirr') return calculateXirr(input);
        if (active === 'cagr') return calculateCagr(input);
        if (active === 'averager') return calculateAverager(input);
        return calculateRetirement(input);
    }

    function calculateAverager(input) {
        const existingPrice = Math.max(0, numeric(input.existingPrice, 0));
        const existingQuantity = Math.max(0, numeric(input.existingQuantity, 0));
        const buyPrice = Math.max(0, numeric(input.buyPrice, 0));
        const buyQuantity = Math.max(0, numeric(input.buyQuantity, 0));
        const existingCost = existingPrice * existingQuantity;
        const buyCost = buyPrice * buyQuantity;
        const totalShares = existingQuantity + buyQuantity;
        const totalAmount = existingCost + buyCost;
        if (totalShares <= 0) return { error: 'Enter a quantity greater than zero for the existing holding or current buy.' };
        const averagePrice = totalAmount / totalShares;
        return {
            headline: money(averagePrice, 2),
            resultLabel: 'Average price',
            caption: 'Weighted average cost per share',
            metrics: [
                ['Total shares', totalShares.toLocaleString('en-IN', { maximumFractionDigits: 2 })],
                ['Total amount', money(totalAmount, 2)],
                ['Existing holding cost', money(existingCost, 2)],
                ['Current buy cost', money(buyCost, 2)],
            ],
            pie: [
                { name: 'Existing holding', value: existingCost, color: palette.invested },
                { name: 'Current buy', value: buyCost, color: palette.pale },
            ],
        };
    }

    function calculateSip(input) {
        const monthly = Math.max(0, numeric(input.monthly, 0));
        const annualReturn = Math.max(-99.99, numeric(input.returnRate, 0)) / 100;
        const years = safeYears(input.years, 1);
        const step = input.stepEnabled ? Math.max(0, numeric(input.stepRate, 0)) / 100 : 0;
        const months = Math.ceil(years * 12);
        const rate = Math.pow(1 + annualReturn, 1 / 12) - 1;
        let value = 0;
        let invested = 0;
        const series = [{ year: currentYear, invested: 0, returns: 0 }];
        for (let month = 1; month <= months; month++) {
            const contribution = monthly * Math.pow(1 + step, Math.floor((month - 1) / 12));
            value = Math.max(0, value * (1 + rate)) + contribution;
            invested += contribution;
            if (month % 12 === 0 || month === months) series.push({ year: currentYear + month / 12, invested, returns: Math.max(0, value - invested) });
        }
        const inflation = input.inflationEnabled ? Math.max(0, numeric(input.inflationRate, 0)) / 100 : 0;
        const real = value / Math.pow(1 + inflation, years);
        return { headline: money(value), caption: 'Estimated value after ' + years + ' years', metrics: [['Invested amount', money(invested)], ['Estimated returns', money(value - invested)], ...(input.inflationEnabled ? [['Value in today’s money', money(real)]] : [])], pie: [{ name: 'Invested amount', value: invested, color: palette.invested }, { name: 'Estimated returns', value: Math.max(0, value - invested), color: palette.pale }], series, graph: ['invested', 'returns'], years };
    }
    function calculateLumpsum(input) {
        const principal = Math.max(0, numeric(input.principal, 0));
        const years = safeYears(input.years, 1);
        const annualReturn = Math.max(-99.99, numeric(input.returnRate, 0)) / 100;
        const annualTopup = Math.max(0, numeric(input.annualTopup, 0));
        const topupStep = input.stepEnabled ? Math.max(0, numeric(input.stepRate, 0)) / 100 : 0;
        const annualInflation = input.inflationEnabled ? Math.max(0, numeric(input.inflationRate, 0)) / 100 : 0;
        const valueAt = elapsed => {
            let value = principal * Math.pow(1 + annualReturn, elapsed);
            for (let year = 1; year <= Math.floor(elapsed); year++) {
                const topup = annualTopup * Math.pow(1 + topupStep, year - 1);
                value += topup * Math.pow(1 + annualReturn, elapsed - year);
            }
            return value;
        };
        const investedAt = elapsed => principal + annualTopup * Array.from({ length: Math.floor(elapsed) }, (_, index) => Math.pow(1 + topupStep, index)).reduce((sum, amount) => sum + amount, 0);
        const series = [{ year: currentYear, invested: principal, returns: 0 }];
        for (let year = 1; year <= Math.ceil(years); year++) {
            const elapsed = Math.min(year, years);
            const invested = investedAt(elapsed);
            series.push({ year: currentYear + elapsed, invested, returns: Math.max(0, valueAt(elapsed) - invested) });
        }
        const finalValue = valueAt(years);
        const totalInvested = investedAt(years);
        const realValue = finalValue / Math.pow(1 + annualInflation, years);
        return { headline: money(finalValue), caption: 'Estimated value after ' + years + ' years', metrics: [['Total invested', money(totalInvested)], ['Estimated returns', money(finalValue - totalInvested)], ...(input.inflationEnabled ? [['Value in today’s money', money(realValue)]] : [])], pie: [{ name: 'Invested amount', value: totalInvested, color: palette.invested }, { name: 'Estimated returns', value: Math.max(0, finalValue - totalInvested), color: palette.pale }], series, graph: ['invested', 'returns'], years };
    }
    function calculateSwp(input) {
        const corpus = Math.max(0, numeric(input.corpus, 0));
        const monthlyWithdrawal = Math.max(0, numeric(input.withdrawal, 0));
        const years = safeYears(input.years, 1);
        const startAfter = Math.max(0, numeric(input.startAfter, 0));
        const annualReturn = Math.max(-99.99, numeric(input.returnRate, 0)) / 100;
        const rate = Math.pow(1 + annualReturn, 1 / 12) - 1;
        const step = input.stepEnabled ? Math.max(0, numeric(input.stepRate, 0)) / 100 : 0;
        const inflationStep = input.inflationEnabled ? Math.max(0, numeric(input.inflationRate, 0)) / 100 : 0;
        const withdrawalStep = (1 + step) * (1 + inflationStep) - 1;
        let balance = corpus;
        let withdrawn = 0;
        const series = [{ year: currentYear, withdrawn: 0, balance }];
        const waitMonths = Math.ceil(startAfter * 12);
        for (let month = 1; month <= waitMonths; month++) {
            balance *= 1 + rate;
            if (month % 12 === 0 || month === waitMonths) series.push({ year: currentYear + month / 12, withdrawn: 0, balance });
        }
        const startingCorpus = balance;
        const withdrawalMonths = Math.ceil(years * 12);
        const withdrawalStartYear = currentYear + waitMonths / 12;
        let depletedAt = null;
        for (let month = 0; month < withdrawalMonths; month++) {
            if (month > 0) balance *= 1 + rate;
            const amount = monthlyWithdrawal * Math.pow(1 + withdrawalStep, Math.floor(month / 12));
            const paid = Math.min(balance, amount);
            balance -= paid;
            withdrawn += paid;
            if (paid + 0.005 < amount && depletedAt == null) depletedAt = month;
            if ((month + 1) % 12 === 0 || month === withdrawalMonths - 1) series.push({ year: withdrawalStartYear + (month + 1) / 12, withdrawn, balance });
            if (balance <= 0) balance = 0;
        }
        const inflation = input.inflationEnabled ? Math.max(0, numeric(input.inflationRate, 0)) / 100 : 0;
        const totalYears = waitMonths / 12 + years;
        const realBalance = balance / Math.pow(1 + inflation, totalYears);
        return { headline: money(balance), caption: 'After ' + startAfter + ' years before withdrawals and ' + years + ' withdrawal years', metrics: [['Corpus when withdrawals begin', money(startingCorpus)], ['Total withdrawn', money(withdrawn)], ['Remaining corpus', money(balance)], ...(input.inflationEnabled ? [['Remaining value in today’s money', money(realBalance)]] : [])], pie: [{ name: 'Total withdrawn', value: withdrawn, color: palette.invested }, { name: 'Remaining corpus', value: balance, color: palette.pale }], series, graph: ['withdrawn', 'balance'], years: totalYears, depletionYears: depletedAt != null ? startAfter + depletedAt / 12 : null };
    }
    function calculateFd(input) {
        const principal = Math.max(0, numeric(input.principal, 0));
        const years = safeYears(input.years, 1);
        const annualRate = Math.max(0, numeric(input.returnRate, 0)) / 100;
        const periods = Math.max(1, Math.min(12, numeric(input.frequency, 4)));
        const rows = [{ year: currentYear, principal, interest: 0 }];
        for (let year = 1; year <= Math.ceil(years); year++) {
            const elapsed = Math.min(year, years);
            const value = principal * Math.pow(1 + annualRate / periods, periods * elapsed);
            rows.push({ year: currentYear + elapsed, principal, interest: Math.max(0, value - principal) });
        }
        const maturity = principal * Math.pow(1 + annualRate / periods, periods * years);
        const inflation = input.inflationEnabled ? Math.max(0, numeric(input.inflationRate, 0)) / 100 : 0;
        const real = maturity / Math.pow(1 + inflation, years);
        return { headline: money(maturity), caption: 'Estimated maturity value after ' + years + ' years', metrics: [['Principal', money(principal)], ['Interest earned', money(maturity - principal)], ...(input.inflationEnabled ? [['Value in today’s money', money(real)]] : [])], pie: [{ name: 'Principal', value: principal, color: palette.invested }, { name: 'Interest earned', value: Math.max(0, maturity - principal), color: palette.pale }], series: rows, graph: ['principal', 'interest'], years };
    }
    function calculateEmi(input) {
        const principal = Math.max(0, numeric(input.principal, 0));
        const years = safeYears(input.years, 1);
        const months = Math.max(1, Math.ceil(years * 12));
        const monthlyRate = Math.max(0, numeric(input.returnRate, 0)) / 1200;
        const step = input.stepEnabled ? Math.max(0, numeric(input.stepRate, 0)) / 100 : 0;
        const balanceAfter = start => {
            let balance = principal;
            for (let month = 1; month <= months; month++) {
                balance *= 1 + monthlyRate;
                balance -= Math.min(balance, start * Math.pow(1 + step, Math.floor((month - 1) / 12)));
            }
            return balance;
        };
        let low = 0, high = principal + principal * monthlyRate * months + 1;
        for (let iteration = 0; iteration < 70; iteration++) {
            const middle = (low + high) / 2;
            if (balanceAfter(middle) > 0) low = middle; else high = middle;
        }
        const firstEmi = (low + high) / 2;
        let balance = principal, totalInterest = 0, principalPaid = 0;
        const series = [{ year: currentYear, principalPaid: 0, interestPaid: 0 }];
        for (let month = 1; month <= months; month++) {
            const interest = balance * monthlyRate;
            const payment = Math.min(balance + interest, firstEmi * Math.pow(1 + step, Math.floor((month - 1) / 12)));
            const principalPart = Math.max(0, payment - interest);
            balance = Math.max(0, balance - principalPart);
            totalInterest += interest;
            principalPaid += principalPart;
            if (month % 12 === 0 || month === months) series.push({ year: currentYear + month / 12, principalPaid, interestPaid: totalInterest });
        }
        const total = principalPaid + totalInterest;
        return { headline: money(firstEmi), caption: 'Starting monthly EMI', metrics: [['Total interest', money(totalInterest)], ['Total repayment', money(total)], ['Final EMI', money(firstEmi * Math.pow(1 + step, Math.floor((months - 1) / 12)))]], pie: [{ name: 'Loan principal', value: principal, color: palette.invested }, { name: 'Total interest', value: totalInterest, color: palette.pale }], series, graph: ['principalPaid', 'interestPaid'], years };
    }
    function calculateXirr(input) {
        const cashflows = input.cashflows.map(row => ({ date: row.date, amount: numeric(row.amount, 0) })).filter(row => row.date && row.amount !== 0);
        const negative = cashflows.some(row => row.amount < 0), positive = cashflows.some(row => row.amount > 0);
        if (!negative || !positive || cashflows.length < 2) return { error: 'Enter at least one negative investment and one positive cash flow on valid dates.' };
        const dated = cashflows.map(row => ({ ...row, time: Date.parse(row.date + 'T00:00:00Z') })).sort((a, b) => a.time - b.time);
        const origin = dated[0].time;
        const npv = rate => dated.reduce((sum, row) => sum + row.amount / Math.pow(1 + rate, (row.time - origin) / 31557600000), 0);
        let low = -0.9999, high = 10, fLow = npv(low), fHigh = npv(high);
        if (!Number.isFinite(fLow) || !Number.isFinite(fHigh) || fLow * fHigh > 0) return { error: 'These cash flows do not have a single XIRR result within the supported range.' };
        for (let i = 0; i < 120; i++) {
            const middle = (low + high) / 2, fMiddle = npv(middle);
            if (Math.abs(fMiddle) < 1e-7) { low = high = middle; break; }
            if (fLow * fMiddle <= 0) { high = middle; fHigh = fMiddle; } else { low = middle; fLow = fMiddle; }
        }
        const value = (low + high) / 2;
        const start = Math.min(...dated.map(row => row.time)), end = Math.max(...dated.map(row => row.time));
        const invested = -dated.filter(row => row.amount < 0).reduce((sum, row) => sum + row.amount, 0);
        const received = dated.filter(row => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
        const years = Math.max(1, (end - start) / 31557600000);
        const series = [{ year: new Date(start).getFullYear(), invested: 0, returns: 0 }];
        const totalYears = Math.max(1, Math.ceil(years));
        for (let i = 1; i <= totalYears; i++) series.push({ year: new Date(start).getFullYear() + Math.min(i, years), invested: invested * Math.min(1, i / years), returns: received * Math.min(1, i / years) });
        const pieBase = Math.min(invested, received);
        return { headline: percent(value * 100), caption: 'Annualized return from entered cash flows', metrics: [['Total invested', money(invested)], ['Total received', money(received)], ['Net gain / loss', money(received - invested)]], pie: [{ name: received >= invested ? 'Total invested' : 'Total received', value: pieBase, color: palette.invested }, { name: received >= invested ? 'Net gain' : 'Net loss', value: Math.abs(received - invested), color: palette.pale }], series, graph: ['invested', 'returns'], years: totalYears };
    }
    function calculateCagr(input) {
        const startValue = Math.max(0, numeric(input.startValue, 0)), endValue = Math.max(0, numeric(input.endValue, 0));
        const start = Date.parse(input.startDate + 'T00:00:00'), end = Date.parse(input.endDate + 'T00:00:00');
        if (!(startValue > 0) || !(endValue > 0) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { error: 'Enter positive values and an end date after the start date.' };
        const years = (end - start) / 31557600000;
        const rate = (Math.pow(endValue / startValue, 1 / years) - 1) * 100;
        const points = 12;
        const series = [];
        for (let i = 0; i <= points; i++) {
            const fraction = i / points;
            const value = startValue * Math.pow(endValue / startValue, fraction);
            series.push({ year: new Date(start).getFullYear() + years * fraction, principal: startValue, growth: value });
        }
        const pieBase = Math.min(startValue, endValue);
        return { headline: percent(rate), caption: 'Compound annual growth over ' + years.toFixed(1) + ' years', metrics: [['Starting value', money(startValue)], ['Ending value', money(endValue)], ['Total change', money(endValue - startValue)]], pie: [{ name: endValue >= startValue ? 'Starting value' : 'Ending value', value: pieBase, color: palette.invested }, { name: endValue >= startValue ? 'Value growth' : 'Value decline', value: Math.abs(endValue - startValue), color: palette.pale }], series, graph: ['principal', 'growth'], years };
    }
    function calculateRetirement(input) {
        const age = numeric(input.age, 30), retireAge = numeric(input.retireAge, 60), lifeAge = numeric(input.lifeAge, 85);
        const yearsToRetire = retireAge - age, yearsInRetirement = lifeAge - retireAge;
        if (yearsToRetire <= 0 || yearsInRetirement <= 0 || lifeAge > 120) return { error: 'Retirement age must be after your current age, and plan age must be after retirement age.' };
        const expense = Math.max(0, numeric(input.monthlyExpenses, 0));
        const inflation = Math.max(0, numeric(input.inflation, 0)) / 100;
        const postAnnual = Math.max(0, numeric(input.postReturn, 0)) / 100;
        const monthlyPostReturn = Math.pow(1 + postAnnual, 1 / 12) - 1;
        const monthlyInflation = Math.pow(1 + inflation, 1 / 12) - 1;
        const retirementFirstExpense = expense * Math.pow(1 + inflation, yearsToRetire);
        let required = 0;
        for (let month = 1; month <= Math.ceil(yearsInRetirement * 12); month++) {
            const withdrawal = retirementFirstExpense * Math.pow(1 + monthlyInflation, month - 1);
            required += withdrawal / Math.pow(1 + monthlyPostReturn, month);
        }
        const monthlyPreReturn = Math.pow(1 + Math.max(0, numeric(input.preReturn, 0)) / 100, 1 / 12) - 1;
        const contribution = Math.max(0, numeric(input.monthlySaving, 0));
        let savings = Math.max(0, numeric(input.currentSavings, 0));
        const series = [{ year: currentYear, savings, required }];
        for (let year = 1; year <= Math.ceil(yearsToRetire); year++) {
            const months = Math.min(12, Math.ceil((yearsToRetire - year + 1) * 12));
            for (let month = 0; month < months; month++) savings = savings * (1 + monthlyPreReturn) + contribution;
            series.push({ year: currentYear + Math.min(year, yearsToRetire), savings, required });
        }
        const gap = savings - required;
        return { headline: money(required), caption: 'Estimated corpus needed at age ' + retireAge, metrics: [['Projected savings', money(savings)], [gap >= 0 ? 'Estimated surplus' : 'Estimated shortfall', money(Math.abs(gap))], ['Monthly expense at retirement', money(retirementFirstExpense)]], pie: [{ name: 'Projected savings', value: savings, color: palette.invested }, { name: gap >= 0 ? 'Estimated surplus' : 'Corpus shortfall', value: Math.abs(gap), color: palette.pale }], series, graph: ['savings', 'required'], years: yearsToRetire, notice: gap >= 0 ? 'Based on these assumptions, projected savings cover the estimated corpus.' : 'Based on these assumptions, projected savings are below the estimated corpus.' };
    }

    function renderSummary(result) {
        if (result.error) {
            elements.summary.innerHTML = '<div class="pc-error" role="alert">' + escapeHtml(result.error) + '</div>';
            return;
        }
        const pieValues = result.pie.filter(item => item.value > 0 && Number.isFinite(item.value));
        const total = pieValues.reduce((sum, item) => sum + item.value, 0);
        const circumference = 100;
        let offset = 0;
        const circles = pieValues.map(item => {
            const ratio = total > 0 ? item.value / total : 0;
            const circle = '<circle class="pc-pie-segment" data-pie-name="' + escapeHtml(item.name) + '" data-pie-value="' + item.value + '" data-pie-share="' + (ratio * 100).toFixed(1) + '" cx="60" cy="60" r="43" fill="none" stroke="' + item.color + '" stroke-width="17" pathLength="100" stroke-dasharray="' + (ratio * circumference) + ' ' + ((1 - ratio) * circumference) + '" stroke-dashoffset="-' + offset + '" transform="rotate(-90 60 60)" tabindex="0" role="img" aria-label="' + escapeHtml(item.name + ': ' + money(item.value)) + '"><title>' + escapeHtml(item.name + ': ' + money(item.value)) + '</title></circle>';
            offset += ratio * circumference;
            return circle;
        }).join('');
        const rows = result.metrics.map(row => '<div class="pc-summary-metric"><span>' + escapeHtml(row[0]) + '</span><strong>' + escapeHtml(row[1]) + '</strong></div>').join('');
        const extraNotice = result.depletionYears != null
            ? '<div class="pc-summary-extra pc-summary-extra-danger">Corpus depleted after <strong>' + escapeHtml(result.depletionYears.toFixed(1)) + ' years</strong> from now.</div>'
            : result.notice ? '<div class="pc-summary-extra">' + escapeHtml(result.notice) + '</div>' : '';
        elements.summary.innerHTML = '<div class="pc-result-label">' + escapeHtml(result.resultLabel || (active === 'xirr' || active === 'cagr' ? 'Result' : 'Estimated value')) + '</div><div class="pc-result-value">' + escapeHtml(result.headline) + '</div><p class="pc-result-caption">' + escapeHtml(result.caption) + '</p><div class="pc-pie-wrap"><svg class="pc-pie" viewBox="0 0 120 120" aria-label="Breakdown of estimated values"><circle cx="60" cy="60" r="43" fill="none" stroke="var(--pc-hover)" stroke-width="17"></circle>' + circles + '<circle cx="60" cy="60" r="29" fill="var(--pc-card)"></circle></svg><div class="pc-pie-tooltip" hidden></div></div><div class="pc-pie-legend">' + pieValues.map(item => '<span class="pc-legend-item"><i class="pc-legend-swatch" style="background:' + item.color + '"></i>' + escapeHtml(item.name) + '</span>').join('') + '</div><div class="pc-summary-metrics">' + rows + '</div>' + extraNotice;
        const wrap = elements.summary.querySelector('.pc-pie-wrap');
        const tooltip = wrap.querySelector('.pc-pie-tooltip');
        function showPieTooltip(target, event) {
            const name = target.getAttribute('data-pie-name');
            const value = Number(target.getAttribute('data-pie-value'));
            const share = target.getAttribute('data-pie-share');
            tooltip.innerHTML = '<div class="pc-tooltip-row"><span>' + escapeHtml(name) + '</span><strong>' + escapeHtml(money(value)) + '</strong></div><div class="pc-tooltip-row"><span>Share</span><strong>' + escapeHtml(share) + '%</strong></div>';
            tooltip.hidden = false;
            const bounds = wrap.getBoundingClientRect();
            let left = event && typeof event.clientX === 'number' ? event.clientX - bounds.left + 10 : bounds.width - tooltip.offsetWidth - 4;
            let top = event && typeof event.clientY === 'number' ? event.clientY - bounds.top + 8 : 4;
            left = Math.min(Math.max(0, left), Math.max(0, bounds.width - tooltip.offsetWidth));
            top = Math.min(Math.max(0, top), Math.max(0, bounds.height - tooltip.offsetHeight));
            tooltip.style.left = left + 'px'; tooltip.style.top = top + 'px';
        }
        wrap.querySelectorAll('.pc-pie-segment').forEach(segment => {
            segment.addEventListener('pointerenter', event => showPieTooltip(segment, event));
            segment.addEventListener('pointermove', event => showPieTooltip(segment, event));
            segment.addEventListener('pointerleave', () => { tooltip.hidden = true; });
            segment.addEventListener('focus', () => showPieTooltip(segment));
            segment.addEventListener('blur', () => { tooltip.hidden = true; });
        });
    }

    function renderChart(result) {
        const chartCard = elements.chart.closest('.pc-chart-card');
        if (chartCard) chartCard.hidden = active === 'averager';
        if (active === 'averager') return;
        elements.chartTitle.textContent = active === 'sip' || active === 'lumpsum' ? 'Investment growth' : active === 'swp' ? 'Withdrawals and remaining corpus' : active === 'fd' ? 'Deposit growth' : active === 'emi' ? 'Repayment breakdown' : active === 'retirement' ? 'Retirement projection' : active === 'cagr' ? 'Value growth' : 'Cash flow projection';
        elements.chartDescription.textContent = result.error ? 'Enter valid values to see a projection.' : active === 'sip' ? 'Invested amount and estimated returns from ' + currentYear + ' through ' + (currentYear + Math.ceil(result.years)) + '.' : 'Projection from ' + currentYear + ' through ' + (currentYear + Math.ceil(result.years || 1)) + '.';
        const legends = result.graph || [];
        const labelMap = { invested: 'Invested amount', returns: active === 'xirr' ? 'Cash received' : 'Estimated returns', withdrawn: 'Cumulative withdrawals', balance: 'Remaining corpus', principal: 'Principal', interest: 'Interest earned', principalPaid: 'Principal repaid', interestPaid: 'Interest paid', growth: active === 'cagr' ? 'Projected value' : 'Estimated returns', savings: 'Projected savings', required: 'Corpus required' };
        elements.chartLegend.innerHTML = legends.map((key, index) => '<span class="pc-legend-item"><i class="pc-legend-swatch" style="background:' + (index === 0 ? palette.invested : palette.growth) + '"></i>' + escapeHtml(labelMap[key] || key) + '</span>').join('');
        if (!result.series || result.series.length < 2) { elements.chart.innerHTML = '<div class="pc-chart-empty">A projection chart will appear when the inputs are valid.</div>'; return; }
        const width = 1120, height = 280, left = 72, right = 20, top = 20, bottom = 38;
        const plotWidth = width - left - right, plotHeight = height - top - bottom;
        const values = result.series.flatMap(point => legends.map(key => Math.max(0, numeric(point[key], 0))));
        const max = Math.max(1, ...values) * 1.12;
        const x = index => left + (result.series.length > 1 ? index / (result.series.length - 1) : 0) * plotWidth;
        const y = value => top + plotHeight - (Math.max(0, value) / max) * plotHeight;
        const grid = Array.from({ length: 4 }, (_, index) => {
            const value = max * index / 3, position = y(value);
            return '<line x1="' + left + '" y1="' + position + '" x2="' + (width - right) + '" y2="' + position + '" stroke="var(--pc-border)" stroke-width="1"/><text x="' + (left - 10) + '" y="' + (position + 4) + '" text-anchor="end" fill="var(--pc-muted)" font-size="10">' + escapeHtml(compactMoney(value)) + '</text>';
        }).join('');
        const colors = [palette.invested, palette.growth];
        const paths = legends.map((key, seriesIndex) => {
            const points = result.series.map((point, index) => x(index) + ',' + y(numeric(point[key], 0))).join(' ');
            const circles = result.series.map((point, index) => '<circle cx="' + x(index) + '" cy="' + y(numeric(point[key], 0)) + '" r="3" fill="' + colors[seriesIndex] + '"><title>' + escapeHtml(Math.round(point.year) + ': ' + (labelMap[key] || key) + ' ' + money(point[key])) + '</title></circle>').join('');
            return '<polyline points="' + points + '" fill="none" stroke="' + colors[seriesIndex] + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' + circles;
        }).join('');
        const labels = result.series.map((point, index) => ({ point, index })).filter((entry, index, all) => index === 0 || index === all.length - 1 || index % Math.max(1, Math.floor(all.length / 5)) === 0).map(entry => '<text x="' + x(entry.index) + '" y="' + (height - 10) + '" text-anchor="middle" fill="var(--pc-muted)" font-size="10">' + escapeHtml(String(Math.round(entry.point.year))) + '</text>').join('');
        const hoverLayer = '<line class="pc-chart-guide" x1="0" y1="' + top + '" x2="0" y2="' + (height - bottom) + '" visibility="hidden"></line><circle class="pc-chart-dot" data-series-dot="0" r="5" fill="' + colors[0] + '" visibility="hidden"></circle><circle class="pc-chart-dot" data-series-dot="1" r="5" fill="' + colors[1] + '" visibility="hidden"></circle>';
        elements.chart.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" aria-label="Projection values by year">' + grid + paths + labels + hoverLayer + '</svg><div class="pc-chart-tooltip" hidden></div>';
        const chartSvg = elements.chart.querySelector('svg');
        const tooltip = elements.chart.querySelector('.pc-chart-tooltip');
        const guide = chartSvg.querySelector('.pc-chart-guide');
        const dots = [...chartSvg.querySelectorAll('.pc-chart-dot')];
        chartSvg.addEventListener('pointermove', event => {
            const bounds = chartSvg.getBoundingClientRect();
            const plotLeft = (left / width) * bounds.width;
            const plotWidthPixels = (plotWidth / width) * bounds.width;
            const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left - plotLeft) / plotWidthPixels));
            const index = Math.round(ratio * (result.series.length - 1));
            const point = result.series[index];
            const xPosition = x(index);
            guide.setAttribute('x1', xPosition); guide.setAttribute('x2', xPosition); guide.setAttribute('visibility', 'visible');
            legends.forEach((key, seriesIndex) => {
                const dot = dots[seriesIndex];
                if (!dot) return;
                dot.setAttribute('cx', xPosition); dot.setAttribute('cy', y(numeric(point[key], 0))); dot.setAttribute('visibility', 'visible');
            });
            const yearLabel = Math.round(point.year);
            const valueRows = legends.map((key, seriesIndex) => '<div class="pc-tooltip-row"><span>' + escapeHtml(labelMap[key] || key) + '</span><strong>' + escapeHtml(money(point[key])) + '</strong></div>').join('');
            tooltip.innerHTML = '<strong>' + yearLabel + '</strong>' + valueRows;
            tooltip.hidden = false;
            const chartBounds = elements.chart.getBoundingClientRect();
            let tooltipLeft = event.clientX - chartBounds.left + 12;
            if (tooltipLeft + tooltip.offsetWidth > chartBounds.width) tooltipLeft = event.clientX - chartBounds.left - tooltip.offsetWidth - 12;
            tooltip.style.left = Math.max(0, tooltipLeft) + 'px';
            tooltip.style.top = '8px';
        });
        chartSvg.addEventListener('pointerleave', () => {
            tooltip.hidden = true;
            guide.setAttribute('visibility', 'hidden');
            dots.forEach(dot => dot.setAttribute('visibility', 'hidden'));
        });
    }
    function updateResults() {
        const result = pickInputs();
        lastResult = result;
        renderSummary(result);
        renderChart(result);
    }
    function renderCalculator() {
        const calculator = calculators.find(item => item.id === active);
        elements.title.textContent = calculator.title;
        elements.description.textContent = calculator.description;
        renderTabs();
        renderInputs();
        updateResults();
    }

    elements.tabs.addEventListener('click', event => {
        const button = event.target.closest('[data-calculator]');
        if (!button) return;
        active = button.getAttribute('data-calculator');
        scheduleStateSave();
        renderCalculator();
    });
    elements.inputs.addEventListener('input', event => {
        const field = event.target.getAttribute('data-field');
        if (field) {
            state[active][field] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
            if (event.target.type === 'checkbox') renderInputs();
            updateResults();
            scheduleStateSave();
            return;
        }
        const dateIndex = event.target.getAttribute('data-cashflow-date');
        const amountIndex = event.target.getAttribute('data-cashflow-amount');
        if (dateIndex != null) state.xirr.cashflows[Number(dateIndex)].date = event.target.value;
        if (amountIndex != null) state.xirr.cashflows[Number(amountIndex)].amount = event.target.value;
        updateResults();
        scheduleStateSave();
    });
    elements.inputs.addEventListener('change', event => {
        const field = event.target.getAttribute('data-field');
        if (field) {
            state[active][field] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
            if (event.target.type === 'checkbox') renderInputs();
            updateResults();
            scheduleStateSave();
        }
    });
    elements.inputs.addEventListener('click', event => {
        if (event.target.closest('[data-add-cashflow]')) {
            state.xirr.cashflows.push({ date: today, amount: 0 });
            renderInputs(); updateResults();
            scheduleStateSave();
        }
        const remove = event.target.closest('[data-remove-cashflow]');
        if (remove) {
            state.xirr.cashflows.splice(Number(remove.getAttribute('data-remove-cashflow')), 1);
            renderInputs(); updateResults();
            scheduleStateSave();
        }
    });
    loadSavedState().then(renderCalculator);
}());
