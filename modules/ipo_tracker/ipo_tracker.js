(function () {
    const rowsElement = document.getElementById('ipo-rows');
    const noticeElement = document.getElementById('feed-notice');
    const emptyElement = document.getElementById('empty-state');
    const refreshButton = document.getElementById('refresh-button');
    const searchInput = document.getElementById('ipo-search');
    const segmentSelect = document.getElementById('segment-filter');
    const updatedLabel = document.getElementById('updated-label');
    const fetchedLabel = document.getElementById('fetched-label');
    const liveDot = document.querySelector('.live-dot');
    let ipos = [];
    let statusFilter = 'all';

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
        });
    }

    function externalUrl(value) {
        try {
            const url = new URL(value, window.location.href);
            return url.protocol === 'https:' ? url.href : '';
        } catch (error) {
            return '';
        }
    }

    function formatNumber(value, digits) {
        const number = Number(value);
        if (!Number.isFinite(number)) return '—';
        return number.toLocaleString('en-IN', { maximumFractionDigits: digits == null ? 2 : digits });
    }

    function formatCurrency(value) {
        return value == null || !Number.isFinite(Number(value)) ? '—' : '₹' + formatNumber(value, 2);
    }

    function classifyStatus(status) {
        const value = String(status || '').toLowerCase();
        if (value.includes('open') || value.includes('bidding')) return 'open';
        if (value.includes('upcoming') || value.includes('pre-open')) return 'upcoming';
        if (value.includes('closed') || value.includes('allot') || value.includes('listed') || value.includes('listing')) return 'closed';
        return 'other';
    }

    function classifySegment(segment) {
        const value = String(segment || '').toLowerCase();
        if (value.includes('sme')) return 'sme';
        if (value.includes('main')) return 'mainboard';
        return value;
    }

    function statusBadge(status) {
        const group = classifyStatus(status);
        const className = group === 'other' ? 'status-other' : 'status-' + group;
        return '<span class="status-badge ' + className + '">' + escapeHtml(status || 'Status unavailable') + '</span>';
    }

    function sourceDetails(ipo) {
        const sources = Array.isArray(ipo.source_rows) ? ipo.source_rows : [];
        if (!sources.length) {
            const detailUrl = externalUrl(ipo.detail_url);
            return detailUrl
                ? '<a class="source-link" href="' + detailUrl + '" target="_blank" rel="noopener noreferrer">Provider ↗</a>'
                : '<span class="value-muted">Provider</span>';
        }
        const list = sources.map(function (source) {
            const url = externalUrl(source.url);
            const label = escapeHtml(source.label || 'Source');
            const amount = source.gmp == null ? '' : ' · ' + escapeHtml(formatCurrency(source.gmp));
            return '<li>' + (url ? '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + amount + ' ↗</a>' : label + amount) + '</li>';
        }).join('');
        const count = Number(ipo.source_count) || sources.length;
        return '<details class="source-details"><summary>' + count + ' source' + (count === 1 ? '' : 's') + '</summary><ul>' + list + '</ul></details>';
    }

    function renderRow(ipo) {
        const group = classifyStatus(ipo.status);
        const segment = String(ipo.segment || 'IPO').toUpperCase();
        const gmp = ipo.gmp;
        const gmpClass = Number(gmp) < 0 ? 'gmp-negative' : 'gmp-value';
        let gmpHtml = '<span class="value-muted">Not reported</span>';
        if (gmp != null && Number.isFinite(Number(gmp))) {
            let range = '';
            if (ipo.gmp_min != null && ipo.gmp_max != null && Number(ipo.gmp_min) !== Number(ipo.gmp_max)) {
                range = '<span class="secondary-line gmp-range">Range ' + escapeHtml(formatCurrency(ipo.gmp_min)) + '–' + escapeHtml(formatCurrency(ipo.gmp_max)) + '</span>';
            }
            const confidence = ipo.confidence ? '<span class="secondary-line confidence">' + escapeHtml(ipo.confidence) + ' confidence</span>' : '';
            gmpHtml = '<span class="value-main ' + gmpClass + '">' + escapeHtml(formatCurrency(gmp)) + '</span>' + range + confidence;
        }

        const percentage = ipo.gmp_pct == null
            ? '<span class="value-muted">—</span>'
            : '<span class="value-main ' + gmpClass + '">' + (Number(ipo.gmp_pct) > 0 ? '+' : '') + escapeHtml(formatNumber(ipo.gmp_pct, 2)) + '%</span>';
        const upperPrice = ipo.upper_price == null
            ? '<span class="value-muted">Not reported</span>'
            : '<span class="value-main">' + escapeHtml(formatCurrency(ipo.upper_price)) + '</span><span class="secondary-line">upper band</span>';
        const subscription = ipo.subscription == null
            ? '<span class="value-muted">—</span>'
            : '<span class="value-main">' + escapeHtml(formatNumber(ipo.subscription, 2)) + '×</span>';
        const lotSize = ipo.lot_size == null ? '' : '<span class="secondary-line">Lot ' + escapeHtml(formatNumber(ipo.lot_size, 0)) + '</span>';
        const detailUrl = externalUrl(ipo.detail_url);
        const name = escapeHtml(ipo.name || 'IPO');
        const company = detailUrl
            ? '<a class="company-name" href="' + detailUrl + '" target="_blank" rel="noopener noreferrer">' + name + ' ↗</a>'
            : '<span class="company-name">' + name + '</span>';

        return '<tr data-status="' + group + '" data-segment="' + escapeHtml(classifySegment(segment)) + '" data-name="' + name.toLowerCase() + '">' +
            '<td>' + company + '<span class="secondary-line">' + escapeHtml(segment) + '</span></td>' +
            '<td><span class="value-main">' + escapeHtml(ipo.dates || 'Dates not reported') + '</span>' + statusBadge(ipo.status) + (ipo.listing_date ? '<span class="secondary-line">Lists ' + escapeHtml(ipo.listing_date) + '</span>' : '') + '</td>' +
            '<td>' + upperPrice + '</td>' +
            '<td><span class="value-main">' + escapeHtml(ipo.issue_size || 'Not reported') + '</span>' + lotSize + '</td>' +
            '<td>' + subscription + '</td>' +
            '<td>' + gmpHtml + '</td>' +
            '<td>' + percentage + '</td>' +
            '<td>' + sourceDetails(ipo) + '</td>' +
            '</tr>';
    }

    function updateCounts() {
        const counts = { open: 0, upcoming: 0, closed: 0 };
        ipos.forEach(function (ipo) {
            const group = classifyStatus(ipo.status);
            if (Object.prototype.hasOwnProperty.call(counts, group)) counts[group] += 1;
        });
        document.getElementById('count-open').textContent = counts.open;
        document.getElementById('count-upcoming').textContent = counts.upcoming;
        document.getElementById('count-closed').textContent = counts.closed;
        document.getElementById('count-all').textContent = ipos.length;
    }

    function render() {
        const query = searchInput.value.trim().toLowerCase();
        const segment = segmentSelect.value;
        const visible = ipos.filter(function (ipo) {
            const statusMatches = statusFilter === 'all' || classifyStatus(ipo.status) === statusFilter;
            const segmentMatches = segment === 'all' || classifySegment(ipo.segment) === segment;
            const nameMatches = !query || String(ipo.name || '').toLowerCase().includes(query);
            return statusMatches && segmentMatches && nameMatches;
        });

        rowsElement.innerHTML = visible.length
            ? visible.map(renderRow).join('')
            : '<tr><td class="table-message" colspan="8">No IPOs match these filters.</td></tr>';
        emptyElement.hidden = true;
    }

    function setFreshness(data) {
        updatedLabel.textContent = 'Provider updated: ' + (data.generated_display || data.generated_at || 'time unavailable');
        fetchedLabel.textContent = data.is_stale
            ? 'Showing the last successful refresh'
            : (data.cache_status === 'cached' ? 'Using cached data' : 'Data refreshed from provider');
        liveDot.classList.toggle('stale', Boolean(data.is_stale));
        noticeElement.hidden = !data.is_stale;
        noticeElement.textContent = data.is_stale
            ? 'The provider could not be refreshed. Showing cached results; the update time above is from the last successful feed.'
            : '';
        if (data.provider_url) document.getElementById('provider-link').href = externalUrl(data.provider_url) || 'https://gmptoday.in/';
        if (data.official_ipo_url) document.getElementById('official-link').href = externalUrl(data.official_ipo_url) || 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo';
    }

    async function load(forceRefresh) {
        refreshButton.disabled = true;
        refreshButton.textContent = forceRefresh ? 'Refreshing…' : '↻ Refresh';
        if (!ipos.length) rowsElement.innerHTML = '<tr><td class="table-message" colspan="8">Loading IPOs and GMP data…</td></tr>';
        noticeElement.hidden = true;
        try {
            const response = await fetch('/api/ipos' + (forceRefresh ? '?refresh=1' : ''), { cache: 'no-store' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'IPO data could not be loaded.');
            ipos = Array.isArray(data.ipos) ? data.ipos : [];
            updateCounts();
            setFreshness(data);
            render();
        } catch (error) {
            if (!ipos.length) rowsElement.innerHTML = '<tr><td class="table-message" colspan="8">' + escapeHtml(error.message || 'IPO data could not be loaded.') + '</td></tr>';
            updatedLabel.textContent = 'IPO data unavailable';
            fetchedLabel.textContent = 'Check your connection and refresh';
            noticeElement.hidden = false;
            noticeElement.textContent = error.message || 'The IPO feed could not be reached.';
            liveDot.classList.add('stale');
        } finally {
            refreshButton.disabled = false;
            refreshButton.textContent = '↻ Refresh';
        }
    }

    document.querySelectorAll('[data-status-filter]').forEach(function (button) {
        button.addEventListener('click', function () {
            document.querySelectorAll('[data-status-filter]').forEach(function (item) { item.classList.remove('active'); });
            button.classList.add('active');
            statusFilter = button.dataset.statusFilter;
            render();
        });
    });
    searchInput.addEventListener('input', render);
    segmentSelect.addEventListener('change', render);
    refreshButton.addEventListener('click', function () { load(true); });
    load(false);
}());
