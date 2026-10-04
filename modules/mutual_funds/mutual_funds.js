(function () {
    const pageSize = 50;
    const elements = {
        rows: document.getElementById('scheme-rows'), search: document.getElementById('scheme-search'),
        amc: document.getElementById('amc-filter'), category: document.getElementById('category-filter'),
        type: document.getElementById('type-filter'), plan: document.getElementById('plan-filter'),
        option: document.getElementById('option-filter'), refresh: document.getElementById('catalog-refresh'),
        notice: document.getElementById('catalog-notice'),
    };
    let schemes = [];
    let page = 0;
    let filtered = [];

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
        });
    }

    function formatNumber(value, digits) {
        const number = Number(value);
        if (!Number.isFinite(number)) return '—';
        return number.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }

    function formatDate(value) {
        if (!value) return '—';
        const date = new Date(value + 'T00:00:00');
        return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function formatTime(value) {
        if (!value) return 'AMFI update time unavailable';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : 'Checked ' + date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    }

    function setOptions(select, values, firstLabel) {
        const previous = select.value;
        select.innerHTML = '<option value="">' + escapeHtml(firstLabel) + '</option>' + values.map(value => '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>').join('');
        if (values.includes(previous)) select.value = previous;
    }

    function setStatus(message, error) {
        const label = document.getElementById('catalog-updated');
        const dot = document.querySelector('.mf-live-dot');
        label.textContent = message;
        dot.classList.toggle('is-error', Boolean(error));
    }

    function loadFilters(data) {
        setOptions(elements.amc, data.amcs || [], 'All fund houses');
        setOptions(elements.category, data.categories || [], 'All categories');
        setOptions(elements.type, data.scheme_types || [], 'All scheme types');
        document.getElementById('catalog-count').textContent = formatNumber(data.count || schemes.length, 0);
        document.getElementById('amc-count').textContent = formatNumber((data.amcs || []).length, 0);
        document.getElementById('nav-date').textContent = formatDate(data.nav_as_of);
        document.getElementById('catalog-asof').textContent = formatTime(data.refreshed_at) + ' · NAVs as of ' + formatDate(data.nav_as_of);
        elements.notice.hidden = true;
    }

    function updateFilterOptions() {
        const filters = [
            [elements.amc, 'amc', 'All fund houses'], [elements.category, 'category', 'All categories'],
            [elements.type, 'scheme_type', 'All scheme types'], [elements.plan, 'plan', 'All plans'], [elements.option, 'option', 'All options'],
        ];
        const selected = filters.map(([select, key]) => [select, key, select.value]);
        filters.forEach(([select, key, label]) => {
            const values = [...new Set(schemes.filter(scheme => selected.every(([otherSelect, otherKey, value]) => otherKey === key || !value || scheme[otherKey] === value)).map(scheme => scheme[key]).filter(Boolean))].sort();
            const oldValue = select.value;
            setOptions(select, values, label);
            select.value = values.includes(oldValue) ? oldValue : '';
        });
    }

    function applyFilters() {
        updateFilterOptions();
        const query = elements.search.value.trim().toLowerCase();
        filtered = schemes.filter(function (scheme) {
            if (elements.amc.value && scheme.amc !== elements.amc.value) return false;
            if (elements.category.value && scheme.category !== elements.category.value) return false;
            if (elements.type.value && scheme.scheme_type !== elements.type.value) return false;
            if (elements.plan.value && scheme.plan !== elements.plan.value) return false;
            if (elements.option.value && scheme.option !== elements.option.value) return false;
            return !query || [scheme.name, scheme.amc, scheme.category, scheme.scheme_code, scheme.isin, scheme.isin_reinvestment].join(' ').toLowerCase().includes(query);
        });
        page = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
        renderRows();
    }

    function renderRows() {
        const start = page * pageSize;
        const rows = filtered.slice(start, start + pageSize);
        if (!rows.length) {
            elements.rows.innerHTML = '<tr><td colspan="7" class="mf-table-message">No schemes match these filters.</td></tr>';
        } else {
            elements.rows.innerHTML = rows.map(function (scheme) {
                const classification = [scheme.scheme_type, scheme.category].filter(Boolean).join(' · ');
                const option = [scheme.plan, scheme.option].filter(Boolean).join(' / ');
                const isinText = scheme.isin ? 'ISIN ' + escapeHtml(scheme.isin) : 'AMFI code ' + escapeHtml(scheme.scheme_code);
                return '<tr class="mf-clickable-row" data-detail-url="/mutual-funds/fund/' + encodeURIComponent(scheme.scheme_code) + '">' +
                    '<td><div class="mf-scheme-name"><a class="mf-detail-link" href="/mutual-funds/fund/' + encodeURIComponent(scheme.scheme_code) + '">' + escapeHtml(scheme.name) + '</a><small>' + isinText + ' · Code ' + escapeHtml(scheme.scheme_code) + '</small></div></td>' +
                    '<td>' + escapeHtml(scheme.amc || '—') + '</td>' +
                    '<td><div class="mf-scheme-name"><span>' + escapeHtml(scheme.category || 'Unclassified') + '</span><small>' + escapeHtml(scheme.scheme_type || 'Scheme type not stated') + '</small></div></td>' +
                    '<td><span class="mf-tag">' + escapeHtml(option || 'Not stated') + '</span></td>' +
                    '<td class="mf-right mf-nav-value">₹' + formatNumber(scheme.nav, 4) + '</td>' +
                    '<td>' + formatDate(scheme.nav_date) + '</td>' +
                    '<td><button type="button" class="mf-row-action mf-start-sip" data-scheme-code="' + escapeHtml(scheme.scheme_code) + '">Start SIP</button></td>' +
                    '</tr>';
            }).join('');
        }
        const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
        const from = filtered.length ? start + 1 : 0;
        const to = Math.min(start + pageSize, filtered.length);
        document.getElementById('scheme-result-count').textContent = 'Showing ' + formatNumber(from, 0) + '–' + formatNumber(to, 0) + ' of ' + formatNumber(filtered.length, 0) + ' matching schemes';
        document.getElementById('page-label').textContent = 'Page ' + (page + 1) + ' of ' + totalPages;
        document.getElementById('page-prev').disabled = page <= 0;
        document.getElementById('page-next').disabled = page + 1 >= totalPages;
    }

    async function loadCatalog() {
        elements.refresh.disabled = true;
        elements.refresh.textContent = '↻ Refreshing…';
        setStatus('Refreshing official NAV feed…', false);
        elements.rows.innerHTML = '<tr><td colspan="7" class="mf-table-message">Fetching the latest AMFI NAV report…</td></tr>';
        try {
            const response = await fetch('/api/mutual-funds/catalog?refresh=1', { cache: 'no-store' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'AMFI data is unavailable.');
            schemes = Array.isArray(data.schemes) ? data.schemes : [];
            loadFilters(data);
            applyFilters();
            setStatus(formatNumber(schemes.length, 0) + ' schemes loaded', false);
        } catch (error) {
            elements.rows.innerHTML = '<tr><td colspan="7" class="mf-table-message">' + escapeHtml(error.message) + '</td></tr>';
            elements.notice.hidden = false;
            elements.notice.textContent = 'AMFI could not be refreshed. No older cached NAVs are being shown as current.';
            setStatus('AMFI feed unavailable', true);
        } finally {
            elements.refresh.disabled = false;
            elements.refresh.textContent = '↻ Refresh NAVs';
        }
    }

    [elements.search, elements.amc, elements.category, elements.type, elements.plan, elements.option].forEach(function (control) {
        control.addEventListener(control === elements.search ? 'input' : 'change', function () { page = 0; applyFilters(); });
    });
    document.getElementById('page-prev').addEventListener('click', function () { page = Math.max(0, page - 1); renderRows(); });
    document.getElementById('page-next').addEventListener('click', function () { page += 1; renderRows(); });
    elements.refresh.addEventListener('click', loadCatalog);
    document.getElementById('reset-filters').addEventListener('click', function () {
        elements.search.value = '';
        [elements.amc, elements.category, elements.type, elements.plan, elements.option].forEach(select => { select.value = ''; });
        page = 0;
        applyFilters();
    });
    elements.rows.addEventListener('click', function (event) {
        const investButton = event.target.closest('.mf-start-sip');
        if (investButton) { window.openMFInvestmentModal(investButton.dataset.schemeCode); return; }
        if (event.target.closest('a, button, input, select')) return;
        const row = event.target.closest('tr[data-detail-url]');
        if (row) location.href = row.dataset.detailUrl;
    });
    loadCatalog();
})();
