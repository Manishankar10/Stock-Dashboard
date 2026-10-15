(function () {
    const root = document.querySelector('.mf-detail-shell');
    let currentCode = (root && root.dataset ? root.dataset.schemeCode : '') || window.INITIAL_SCHEME_CODE || '';
    let annualizedReturn = 0;
    let chartPoints = [];
    let chartCoords = [];
    let selectedChartIndex = 0;
    let maxDurationYears = 3;
    let detailFacts = {};
    let currentDetailsData = null;
    let calcAmounts = { invested: 0, gains: 0, share: 0 };

    const money = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }) : '—';
    const number = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
    const date = value => {
        if (!value) return '—';
        try {
            let d;
            if (typeof value === 'string') {
                const clean = value.split('T')[0];
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
            if (isNaN(d.getTime())) return String(value);
            return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        } catch(e) {
            return String(value);
        }
    };
    const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

    function drawChart(points) {
        const svg = document.getElementById('fund-chart');
        chartPoints = points || [];
        if (!points.length) { svg.innerHTML = ''; return; }
        const values = points.map(point => Number(point.nav));
        let min = Math.min(...values), max = Math.max(...values);
        if (min === max) { min *= 0.99; max *= 1.01; }
        const pad = (max - min) * 0.08;
        min = Math.max(0, min - pad); max += pad;
        chartCoords = values.map((value, index) => [index * 960 / Math.max(1, values.length - 1), 270 - ((value - min) / (max - min)) * 250 + 10]);
        let pathPoints = chartCoords;
        if (chartCoords.length > 250) {
            const step = Math.ceil(chartCoords.length / 250);
            pathPoints = chartCoords.filter((_, i) => i === 0 || i === chartCoords.length - 1 || i % step === 0);
        }
        const path = pathPoints.map((point, index) => (index ? 'L' : 'M') + point[0].toFixed(1) + ' ' + point[1].toFixed(1)).join(' ');
        svg.innerHTML = '<line class="mf-grid-line" x1="0" y1="10" x2="960" y2="10"></line><line class="mf-grid-line" x1="0" y1="135" x2="960" y2="135"></line><line class="mf-grid-line" x1="0" y1="270" x2="960" y2="270"></line><path class="mf-detail-nav-line" d="' + path + '"></path><line class="mf-chart-crosshair" id="chart-crosshair" x1="0" y1="10" x2="0" y2="270" visibility="hidden"></line><circle class="mf-chart-hover-point" id="chart-hover-point" cx="0" cy="0" r="5" visibility="hidden"></circle>';
        selectedChartIndex = chartPoints.length - 1;
        document.getElementById('chart-max').textContent = '₹' + number(max, 2);
        document.getElementById('chart-middle').textContent = '₹' + number((max + min) / 2, 2);
        document.getElementById('chart-min').textContent = '₹' + number(min, 2);
        document.getElementById('chart-start').textContent = date(points[0].date);
        document.getElementById('chart-end').textContent = date(points[points.length - 1].date);
    }

    function showChartPoint(index) {
        if (!chartPoints.length || !chartCoords.length) return;
        selectedChartIndex = Math.max(0, Math.min(chartPoints.length - 1, index));
        const point = chartPoints[selectedChartIndex];
        const coords = chartCoords[selectedChartIndex];
        const svg = document.getElementById('fund-chart');
        const wrap = document.querySelector('.mf-detail-chart-wrap');
        const tooltip = document.getElementById('chart-tooltip');
        const wrapRect = wrap.getBoundingClientRect();
        const svgPoint = svg.createSVGPoint();
        svgPoint.x = coords[0];
        svgPoint.y = coords[1];
        const screenPoint = svgPoint.matrixTransform(svg.getScreenCTM());
        const xInWrap = screenPoint.x - wrapRect.left;
        const yInWrap = screenPoint.y - wrapRect.top;
        const marker = document.getElementById('chart-hover-point');
        const crosshair = document.getElementById('chart-crosshair');
        if (marker && crosshair) {
            marker.setAttribute('cx', coords[0]);
            marker.setAttribute('cy', coords[1]);
            marker.setAttribute('visibility', 'visible');
            crosshair.setAttribute('x1', coords[0]);
            crosshair.setAttribute('x2', coords[0]);
            crosshair.setAttribute('visibility', 'visible');
        }
        tooltip.hidden = false;
        tooltip.style.left = Math.max(70, Math.min(wrapRect.width - 70, xInWrap)) + 'px';
        tooltip.style.top = Math.max(55, yInWrap - 8) + 'px';
        document.getElementById('chart-tooltip-nav').textContent = '₹' + number(point.nav, 4);
        document.getElementById('chart-tooltip-date').textContent = date(point.date);
        svg.setAttribute('aria-label', 'NAV ₹' + number(point.nav, 4) + ' on ' + date(point.date));
    }

    function hideChartPoint() {
        document.getElementById('chart-tooltip').hidden = true;
        const marker = document.getElementById('chart-hover-point');
        const crosshair = document.getElementById('chart-crosshair');
        if (marker) marker.setAttribute('visibility', 'hidden');
        if (crosshair) crosshair.setAttribute('visibility', 'hidden');
    }

    function bindChartHover() {
        const svg = document.getElementById('fund-chart');
        svg.addEventListener('pointermove', event => {
            if (!chartPoints.length) return;
            const pointer = svg.createSVGPoint();
            pointer.x = event.clientX;
            pointer.y = event.clientY;
            const chartX = Math.max(0, Math.min(960, pointer.matrixTransform(svg.getScreenCTM().inverse()).x));
            const index = Math.round(chartX / 960 * Math.max(0, chartPoints.length - 1));
            showChartPoint(index);
        });
        svg.addEventListener('pointerdown', event => {
            if (event.pointerType === 'touch' && chartPoints.length) {
                const pointer = svg.createSVGPoint();
                pointer.x = event.clientX;
                pointer.y = event.clientY;
                const x = Math.max(0, Math.min(960, pointer.matrixTransform(svg.getScreenCTM().inverse()).x));
                showChartPoint(Math.round(x / 960 * Math.max(0, chartPoints.length - 1)));
            }
        });
        svg.addEventListener('pointerleave', event => {
            if (event.pointerType !== 'touch') hideChartPoint();
        });
        svg.addEventListener('keydown', event => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                showChartPoint(selectedChartIndex + (event.key === 'ArrowRight' ? 1 : -1));
            } else if (event.key === 'Escape') {
                hideChartPoint();
            }
        });
    }

    function populateScheme(data) {
        const scheme = data.scheme;
        const launchDate = detailFacts.fund_age_start ? new Date(String(detailFacts.fund_age_start).slice(0, 10) + 'T00:00:00') : null;
        let fundAgeYears = null;
        if (launchDate && !Number.isNaN(launchDate.getTime())) {
            const now = new Date();
            fundAgeYears = now.getFullYear() - launchDate.getFullYear();
            if (now.getMonth() < launchDate.getMonth() || (now.getMonth() === launchDate.getMonth() && now.getDate() < launchDate.getDate())) fundAgeYears--;
        }
        document.title = scheme.name + ' | Capital Desk';
        document.getElementById('fund-mark').textContent = (scheme.amc || 'MF').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
        document.getElementById('fund-name').textContent = scheme.name;
        document.getElementById('fund-plan').textContent = scheme.plan || 'Plan not stated';
        document.getElementById('fund-option').textContent = scheme.option || 'Option not stated';
        document.getElementById('fund-category').textContent = scheme.category || 'Unclassified';
        document.getElementById('fund-type').textContent = scheme.scheme_type || 'Scheme type not stated';
        document.getElementById('fund-nav').textContent = '₹' + number(scheme.nav, 4);
        document.getElementById('fund-nav-date').textContent = 'on ' + date(scheme.nav_date);
        const facts = [
            ['Fund house', scheme.amc], ['AMFI scheme code', scheme.scheme_code],
            ['ISIN', scheme.isin || 'Not listed in AMFI report'], ['ISIN (reinvestment)', scheme.isin_reinvestment || 'Not listed in AMFI report'],
            ['Plan', scheme.plan], ['Option', scheme.option], ['Category', scheme.category],
            ['Scheme type', scheme.scheme_type], ['Latest published NAV', '₹' + number(scheme.nav, 4)], ['NAV date', date(scheme.nav_date)],
            ['Fund age', detailFacts.fund_age_years != null ? detailFacts.fund_age_years + ' years (launched ' + detailFacts.fund_launch_label + ')' : fundAgeYears != null ? Math.max(0, fundAgeYears) + ' years (since ' + date(detailFacts.fund_age_start) + ')' : 'Not found in the selected source'],
            ['AUM', detailFacts.aum_crore ? '₹' + number(detailFacts.aum_crore, 2) + ' Cr' + (detailFacts.aum_date ? ' · ' + date(String(detailFacts.aum_date).slice(0, 10)) : detailFacts.source_name ? ' · ' + detailFacts.source_name : '') : 'Not found in the selected source'],
            ['Expense ratio', detailFacts.expense_ratio || 'Not found in the selected source'], ['Exit load', detailFacts.exit_load || 'Not found in the selected source'],
            ['Lock-in period', detailFacts.lock_in || 'Not found in the selected source'], ['Tax implications', detailFacts.tax_implications || 'Not found in the selected source'],
        ];
        document.getElementById('fund-facts').innerHTML = facts.map(item => '<div class="mf-fact"><span>' + escapeHtml(item[0]) + '</span><strong>' + escapeHtml(item[1] || '—') + '</strong></div>').join('');
        document.getElementById('facts-notice').textContent = data.facts_notice || '';
        const managers = detailFacts.managers || [];
        document.getElementById('fund-managers').innerHTML = managers.length ? managers.map(item => '<div class="mf-manager-row"><span>' + escapeHtml((item.name || 'MF').split(/\s+/).map(part => part[0]).join('').slice(0, 2)) + '</span><div><strong>' + escapeHtml(item.name || 'Fund manager') + '</strong><small>' + escapeHtml(item.role || '') + '</small></div></div>').join('') : '<p class="mf-unavailable">Fund manager details were not found in the selected fund data source.</p>';
        const ratings = detailFacts.ratings || [];
        const ratingRows = ratings.length ? '<div class="mf-rating-list">' + ratings.map(item => '<span>' + escapeHtml(item.name) + '</span><strong>' + escapeHtml(item.rating) + ' ★</strong>').join('') + '</div>' : '';
        document.getElementById('fund-risk').innerHTML = '<div class="mf-risk-meter"><span>Scheme risk</span><strong>' + escapeHtml(detailFacts.riskometer || 'Not found in selected source') + '</strong></div>' + ratingRows + '<p class="mf-unavailable">' + (ratings.length ? 'Ratings displayed as listed by ' + escapeHtml(detailFacts.source_name || 'the selected source') + '.' : 'Agency ratings were not found in the selected source.') + '</p>';
        document.getElementById('holdings-asof').textContent = detailFacts.as_of ? 'Portfolio disclosure dated ' + detailFacts.as_of + ' · ' + (detailFacts.source_name || 'Fund house') : detailFacts.source_name === 'Angel One' ? 'Angel One scheme details' : 'Latest available fund house portfolio disclosure';
        renderHoldings('sectors');
        const officialLink = document.getElementById('official-fund-link');
        officialLink.href = data.official_scheme_url || '#';
        officialLink.hidden = !data.official_scheme_url;
        document.getElementById('fund-source').textContent = 'Latest NAV from AMFI · historical data: ' + (data.source_label || 'AMFI historical NAV') + ' · NAVs as of ' + date(data.nav_as_of);
    }

    function renderHoldings(tab) {
        const rows = tab === 'sectors' ? (detailFacts.sectors || []) : (detailFacts.holdings || []);
        const list = document.getElementById('fund-holdings');
        list.innerHTML = rows.length ? '<div class="mf-holdings-head"><span>' + (tab === 'sectors' ? 'Sector' : 'Holding') + '</span><span>Allocation</span></div>' + rows.map(row => '<div class="mf-holding-row"><span>' + escapeHtml(row.name || '—') + '</span><strong>' + escapeHtml(row.allocation || '—') + '</strong></div>').join('') : '<p class="mf-unavailable">' + escapeHtml(detailFacts.holdings_notice || 'This breakdown could not be read from the selected source. Open the source link above to check its current portfolio details.') + '</p>';
    }

    const similarCache = new Map();

    function renderSimilar(ranked, period) {
        const target = document.getElementById('similar-funds');
        target.innerHTML = ranked.length ? ranked.map((item, index) => {
            const ret = Number(item.return_pct);
            const retSign = Number.isFinite(ret) && ret >= 0 ? '+' : '';
            return '<a class="mf-similar-row" href="/mutual-funds/fund/' + encodeURIComponent(item.scheme_code) + '"><span class="mf-similar-rank">' + (index + 1) + '</span><strong class="mf-similar-name">' + escapeHtml(item.name) + '</strong><b class="mf-similar-return ' + (ret < 0 ? 'mf-pnl-negative' : 'mf-pnl-positive') + '">' + retSign + number(item.return_pct, 2) + '%' + (period === 'all' && item.age_years != null ? ' <small>(' + item.age_years + 'y)</small>' : '') + '</b></a>';
        }).join('') : '<p class="mf-unavailable">Comparable return history is not available for this period.</p>';
    }

    async function loadSimilar(period) {
        const target = document.getElementById('similar-funds');
        if (similarCache.has(period)) {
            renderSimilar(similarCache.get(period), period);
            return;
        }
        target.innerHTML = (typeof window.createBrandLoaderHTML === 'function')
            ? window.createBrandLoaderHTML({ title: 'Comparing Similar Funds...', badge: 'Top 5 in Category', subtitle: 'Analyzing category returns over ' + String(period).toUpperCase() + '...', minHeight: '140px' })
            : '<p class="mf-unavailable">Loading category return data…</p>';
        try {
            const response = await fetch('/api/mutual-funds/schemes/' + encodeURIComponent(currentCode) + '/similar?period=' + encodeURIComponent(period));
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Comparable return history is not available.');
            const list = data.similar || [];
            similarCache.set(period, list);
            renderSimilar(list, period);
        } catch (error) { target.innerHTML = '<p class="mf-unavailable">' + escapeHtml(error.message) + '</p>'; }
    }

    function updateCalculator() {
        const amount = Math.max(0, Number(document.getElementById('calc-amount').value) || 0);
        const years = Math.min(maxDurationYears, Math.max(1 / 12, Number(document.getElementById('custom-duration').value) || 1));
        const monthly = document.querySelector('input[name="calc-mode"]:checked').value === 'sip';
        const months = Math.max(1, Math.round(years * 12));
        const rate = Math.pow(1 + annualizedReturn / 100, 1 / 12) - 1;
        const invested = monthly ? amount * months : amount;
        const total = monthly ? (rate ? amount * ((Math.pow(1 + rate, months) - 1) / rate) : invested) : amount * Math.pow(1 + rate, months);
        const safeTotal = Number.isFinite(total) ? total : invested;
        const gains = safeTotal - invested;
        const pieTotal = invested + Math.abs(gains);
        calcAmounts = { invested: invested, gains: gains, share: pieTotal > 0 ? invested / pieTotal : 1 };
        document.getElementById('calc-amount-label').textContent = monthly ? 'Monthly Investment' : 'One-Time Investment';
        document.getElementById('calc-total-label').textContent = 'Estimated value';
        document.getElementById('calc-total').textContent = money(safeTotal);
        document.getElementById('calc-summary').textContent = 'Invest ' + money(amount) + (monthly ? ' monthly' : ' once') + ' for ' + (years < 1 ? '6 months' : years + (years === 1 ? ' year' : ' years'));
        document.getElementById('calc-rate').textContent = number(annualizedReturn, 2) + '% p.a. (fund annualized NAV return)';
        document.getElementById('calc-gains-label').textContent = gains < 0 ? 'Estimated loss' : 'Estimated gains';
        document.getElementById('calc-donut').style.setProperty('--invested-share', (Math.max(0, Math.min(1, calcAmounts.share)) * 100) + '%');
        document.getElementById('calc-donut').setAttribute('aria-label', 'Invested ' + money(invested) + ', estimated gains ' + money(gains));
    }

    function showPieAmount(event) {
        const pie = document.getElementById('calc-donut');
        const tooltip = document.getElementById('calc-pie-tooltip');
        let isInvested = true;
        if (event && Number.isFinite(event.clientX)) {
            const rect = pie.getBoundingClientRect();
            const dx = event.clientX - rect.left - rect.width / 2;
            const dy = event.clientY - rect.top - rect.height / 2;
            const angle = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
            isInvested = angle / 360 <= calcAmounts.share;
        }
        const label = isInvested ? 'Invested' : (calcAmounts.gains < 0 ? 'Estimated loss' : 'Estimated gains');
        const amount = isInvested ? calcAmounts.invested : calcAmounts.gains;
        tooltip.textContent = label + ' · ' + money(amount);
        tooltip.hidden = false;
    }

    function hidePieAmount() { document.getElementById('calc-pie-tooltip').hidden = true; }

    function renderDurationOptions(startDate) {
        const elapsed = Math.max(.08, (Date.now() - new Date(startDate + 'T00:00:00').getTime()) / 31557600000);
        maxDurationYears = elapsed;
        const custom = document.getElementById('custom-duration');
        custom.max = elapsed.toFixed(2);
        const current = Number(custom.value) || Math.min(3, elapsed);
        if (current > elapsed) custom.value = elapsed.toFixed(1);
        const presets = [[.5, '6 Months'], [1, '1 Year'], [3, '3 Years'], [5, '5 Years'], [10, '10 Years']].filter(item => item[0] <= elapsed);
        if (!presets.length || elapsed - presets[presets.length - 1][0] > .08) presets.push([elapsed, 'Since inception']);
        const options = document.getElementById('duration-options');
        options.innerHTML = presets.map(item => '<button type="button" data-years="' + item[0].toFixed(2) + '">' + item[1] + '</button>').join('');
        options.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
            custom.value = button.dataset.years;
            options.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
            updateCalculator();
        }));
        options.querySelectorAll('button').forEach(button => button.classList.toggle('active', Math.abs(Number(button.dataset.years) - Number(custom.value)) < .01));
    }

    const detailsCache = new Map();

    function renderDetailsData(data) {
        currentDetailsData = data;
        detailFacts = data.fund_facts || {};
        populateScheme(data);
        const isSubYear = ['1m', '3m', '6m'].includes(String(data.period).toLowerCase()) || data.is_sub_year;
        const displayReturn = isSubYear ? (data.return_pct ?? data.display_return_pct) : (data.annualized_return_pct ?? data.display_return_pct);
        const numReturn = Number(displayReturn) || 0;
        const value = document.getElementById('fund-return');
        value.textContent = (numReturn >= 0 ? '+' : '') + number(numReturn, 2) + '%';
        value.classList.toggle('mf-pnl-negative', numReturn < 0);
        value.classList.toggle('mf-pnl-positive', numReturn >= 0);
        document.getElementById('return-caption').textContent = data.display_return_label || (isSubYear
            ? ('Absolute NAV return in ' + String(data.period).toUpperCase())
            : 'Annualized NAV returns in selected period');
        document.getElementById('fund-daily-return').textContent = data.daily_return_pct == null ? '— 1D return unavailable' : (data.daily_return_pct < 0 ? '↓ ' : '↑ ') + number(Math.abs(data.daily_return_pct), 2) + '% 1D return';
        drawChart(data.points || []);
        const inception = data.available_start_date || (data.points || [])[0]?.date;
        if (inception) renderDurationOptions(inception);
        if (!isSubYear && Number.isFinite(Number(data.annualized_return_pct)) && Number(data.annualized_return_pct) > 0) {
            annualizedReturn = Number(data.annualized_return_pct);
        } else if (annualizedReturn === 0 && Number.isFinite(Number(data.annualized_return_pct))) {
            annualizedReturn = Number(data.annualized_return_pct);
        }
        updateCalculator();
    }

    function showChartLoader(period) {
        const overlay = document.getElementById('mf-chart-loader');
        if (overlay) {
            const titleEl = document.getElementById('mf-chart-loader-title');
            const badgeEl = document.getElementById('mf-chart-loader-badge');
            if (titleEl) titleEl.textContent = `Loading NAV History (${String(period).toUpperCase()})...`;
            if (badgeEl) badgeEl.textContent = (currentDetailsData && currentDetailsData.scheme && currentDetailsData.scheme.name) ? currentDetailsData.scheme.name : 'Official AMFI NAVs';
            overlay.style.display = 'flex';
            overlay.style.opacity = '1';
        }
    }

    function hideChartLoader() {
        const overlay = document.getElementById('mf-chart-loader');
        if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => {
                if (overlay.style.opacity === '0') overlay.style.display = 'none';
            }, 200);
        }
    }

    async function loadDetails(period) {
        if (!currentCode) return;
        const message = document.getElementById('detail-error');
        if (message) message.hidden = true;
        showChartLoader(period);
        if (detailsCache.has(period)) {
            renderDetailsData(detailsCache.get(period));
            hideChartLoader();
            const similarPeriodEl = document.getElementById('similar-period');
            if (similarPeriodEl) loadSimilar(similarPeriodEl.value);
            return;
        }
        const fundSourceEl = document.getElementById('fund-source');
        if (fundSourceEl) fundSourceEl.textContent = 'Loading official AMFI NAV history…';
        try {
            const response = await fetch('/api/mutual-funds/schemes/' + encodeURIComponent(currentCode) + '/details?period=' + encodeURIComponent(period));
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Could not load fund details.');
            detailsCache.set(period, data);
            renderDetailsData(data);
            hideChartLoader();
            const similarPeriodEl = document.getElementById('similar-period');
            if (similarPeriodEl) loadSimilar(similarPeriodEl.value);
        } catch (error) {
            hideChartLoader();
            if (message) {
                message.hidden = false;
                message.textContent = error.message;
            }
            if (fundSourceEl) fundSourceEl.textContent = 'AMFI history unavailable';
        }
    }

    const periodTabs = document.getElementById('period-tabs');
    if (periodTabs) {
        periodTabs.addEventListener('click', event => {
            const button = event.target.closest('button[data-period]');
            if (!button) return;
            document.querySelectorAll('#period-tabs button').forEach(item => item.classList.toggle('active', item === button));
            loadDetails(button.dataset.period);
        });
    }
    bindChartHover();
    const customDuration = document.getElementById('custom-duration');
    if (customDuration) {
        customDuration.addEventListener('input', event => {
            if (!event.target.value) return;
            let value = Number(event.target.value);
            if (!Number.isFinite(value)) return;
            if (value > maxDurationYears) { value = maxDurationYears; event.target.value = value.toFixed(1); }
            value = Math.max(1 / 12, value);
            document.querySelectorAll('#duration-options button').forEach(item => item.classList.toggle('active', Math.abs(Number(item.dataset.years) - value) < .01));
            updateCalculator();
        });
        customDuration.addEventListener('change', event => {
            const value = Math.min(maxDurationYears, Math.max(1 / 12, Number(event.target.value) || Math.min(1, maxDurationYears)));
            event.target.value = value.toFixed(1);
            updateCalculator();
        });
    }
    const calcDonut = document.getElementById('calc-donut');
    if (calcDonut) {
        calcDonut.addEventListener('pointermove', showPieAmount);
        calcDonut.addEventListener('pointerleave', hidePieAmount);
        calcDonut.addEventListener('focus', () => showPieAmount());
        calcDonut.addEventListener('blur', hidePieAmount);
    }
    const similarPeriod = document.getElementById('similar-period');
    if (similarPeriod) {
        similarPeriod.addEventListener('change', event => loadSimilar(event.target.value));
    }
    document.querySelectorAll('[data-holding-tab]').forEach(button => button.addEventListener('click', () => {
        document.querySelectorAll('[data-holding-tab]').forEach(item => item.classList.toggle('active', item === button));
        renderHoldings(button.dataset.holdingTab);
    }));
    const trackFund = document.getElementById('track-fund');
    if (trackFund) {
        trackFund.addEventListener('click', () => {
            if (typeof window.openMFInvestmentModal === 'function') {
                window.openMFInvestmentModal(currentCode);
            }
        });
    }
    const calcAmount = document.getElementById('calc-amount');
    const calcSlider = document.getElementById('calc-slider');
    if (calcAmount && calcSlider) {
        calcAmount.addEventListener('input', event => {
            const value = Math.min(Number(calcSlider.max), Math.max(Number(calcSlider.min), Number(event.target.value) || Number(calcSlider.min)));
            calcSlider.value = value;
            updateCalculator();
        });
        calcSlider.addEventListener('input', event => {
            calcAmount.value = event.target.value;
            updateCalculator();
        });
    }
    document.querySelectorAll('input[name="calc-mode"]').forEach(input => input.addEventListener('change', () => {
        const monthly = input.value === 'sip' && input.checked;
        if (calcAmount) calcAmount.value = monthly ? 500 : 10000;
        if (calcSlider) calcSlider.value = monthly ? 500 : 10000;
        updateCalculator();
    }));

    function scrollToTop() {
        try {
            window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
        } catch (e) {
            window.scrollTo(0, 0);
        }
        if (document.documentElement) document.documentElement.scrollTop = 0;
        if (document.body) document.body.scrollTop = 0;
        const main = document.querySelector('.main-content-wrapper');
        if (main) main.scrollTop = 0;
        const container = document.querySelector('.container');
        if (container) container.scrollTop = 0;
        const tabEl = document.getElementById('tab-mutual-fund-detail');
        if (tabEl) tabEl.scrollTop = 0;
    }

    const similarContainer = document.getElementById('similar-funds');
    if (similarContainer) {
        similarContainer.addEventListener('click', function (e) {
            const row = e.target.closest('.mf-similar-row');
            if (!row) return;
            const href = row.getAttribute('href');
            if (href && href.startsWith('/mutual-funds/fund/')) {
                const code = href.split('/mutual-funds/fund/')[1]?.split('/')[0];
                if (code) {
                    e.preventDefault();
                    window.loadFundDetail(code);
                    if (typeof switchTab === 'function') {
                        switchTab('mutual-fund-detail');
                    }
                    scrollToTop();
                }
            }
        });
    }

    window.loadFundDetail = function (schemeCode) {
        if (schemeCode) {
            currentCode = schemeCode;
            if (root) root.dataset.schemeCode = schemeCode;
            window.INITIAL_SCHEME_CODE = schemeCode;
        }
        if (!currentCode) return;
        detailsCache.clear();
        similarCache.clear();
        scrollToTop();
        loadDetails('3y');
    };

    if (currentCode) {
        loadDetails('3y');
    }
})();
