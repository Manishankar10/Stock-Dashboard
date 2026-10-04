(function () {
    const modal = document.getElementById('investment-modal');
    if (!modal) return;
    const catalog = [];
    let rows = [];
    let mode = 'sip';
    let toastTimer;
    const today = () => { const now = new Date(); return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'); };
    const money = value => Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

    function toast(message, error) {
        const target = document.getElementById('mf-toast');
        target.textContent = message;
        target.classList.toggle('error', Boolean(error));
        target.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => target.classList.remove('show'), 3500);
    }

    function setMode(value) {
        mode = value;
        const sip = mode === 'sip';
        document.getElementById('sip-form').hidden = !sip;
        document.getElementById('investment-form').hidden = sip;
        document.getElementById('sip-form').querySelectorAll('input').forEach(input => { input.disabled = !sip; });
        document.getElementById('investment-form').querySelectorAll('input').forEach(input => { input.disabled = sip; });
        document.querySelectorAll('[data-investment-mode]').forEach(button => button.classList.toggle('active', button.dataset.investmentMode === mode));
        document.getElementById('investment-modal-title').textContent = sip ? 'Start SIP' : 'One-Time Investment';
    }

    function selectScheme(row) {
        if (!row) return;
        ['sip', 'investment'].forEach(prefix => {
            document.getElementById(prefix + '-scheme-search').value = row.name;
            document.getElementById(prefix + '-scheme-code').value = row.scheme_code;
            document.getElementById(prefix + '-scheme-selected').textContent = row.amc + ' · AMFI code ' + row.scheme_code + ' · NAV ₹' + money(row.nav) + ' dated ' + row.nav_date;
            document.getElementById(prefix + '-scheme-results').hidden = true;
        });
        const isOpenEnded = /open.?ended/i.test(row.scheme_type || '');
        document.querySelector('[data-investment-mode="sip"]').hidden = !isOpenEnded;
        document.querySelector('[data-investment-mode="lumpsum"]').hidden = false;
        if (!isOpenEnded && mode === 'sip') setMode('lumpsum');
    }

    async function loadCatalog() {
        if (catalog.length) return;
        const response = await fetch('/api/mutual-funds/catalog?refresh=1', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load the current fund list.');
        catalog.push(...(data.schemes || []));
    }

    function bindPicker(prefix) {
        const input = document.getElementById(prefix + '-scheme-search');
        const results = document.getElementById(prefix + '-scheme-results');
        input.addEventListener('input', () => {
            const query = input.value.trim().toLowerCase();
            document.getElementById(prefix + '-scheme-code').value = '';
            if (query.length < 2) { results.hidden = true; return; }
            const matches = catalog.filter(row => (row.name + ' ' + row.amc + ' ' + row.scheme_code).toLowerCase().includes(query)).slice(0, 10);
            results.innerHTML = matches.map(row => '<button type="button" class="mf-scheme-option" data-code="' + escapeHtml(row.scheme_code) + '"><strong>' + escapeHtml(row.name) + '</strong><small>' + escapeHtml(row.amc) + ' · ' + escapeHtml(row.plan) + ' / ' + escapeHtml(row.option) + ' · NAV ₹' + money(row.nav) + '</small></button>').join('') || '<div class="mf-scheme-option"><small>No matching funds.</small></div>';
            results.hidden = false;
            results.querySelectorAll('[data-code]').forEach(button => button.addEventListener('click', () => selectScheme(catalog.find(row => String(row.scheme_code) === button.dataset.code))));
        });
    }

    async function open(code) {
        modal.hidden = false;
        document.body.style.overflow = 'hidden';
        document.getElementById('sip-form').reset();
        document.getElementById('investment-form').reset();
        document.getElementById('sip-amount').value = '500';
        document.getElementById('investment-amount').value = '500';
        document.getElementById('sip-start-date').value = today();
        document.getElementById('investment-date').value = today();
        document.getElementById('investment-date').max = today();
        document.querySelectorAll('[data-investment-mode]').forEach(button => { button.hidden = false; });
        ['sip', 'investment'].forEach(prefix => {
            document.getElementById(prefix + '-scheme-search').value = '';
            document.getElementById(prefix + '-scheme-code').value = '';
            document.getElementById(prefix + '-scheme-selected').textContent = 'Select a scheme from the search results.';
        });
        setMode('sip');
        try {
            await loadCatalog();
            const selected = catalog.find(row => String(row.scheme_code) === String(code));
            if (selected) selectScheme(selected);
            else document.getElementById('sip-scheme-search').focus();
        } catch (error) { toast(error.message, true); }
    }

    function close() { modal.hidden = true; document.body.style.overflow = ''; }
    async function submit(event, sip) {
        event.preventDefault();
        const prefix = sip ? 'sip' : 'investment';
        const code = document.getElementById(prefix + '-scheme-code').value;
        if (!code) { toast('Select a fund from the search results.', true); return; }
        const button = document.getElementById(sip ? 'sip-submit' : 'investment-submit');
        button.disabled = true;
        const previous = button.textContent;
        button.textContent = 'Saving…';
        try {
            const payload = sip ? {
                scheme_code: code, amount: document.getElementById('sip-amount').value,
                start_date: document.getElementById('sip-start-date').value,
                installment_day: document.getElementById('sip-installment-day').value || undefined,
            } : {
                scheme_code: code, amount: document.getElementById('investment-amount').value,
                investment_date: document.getElementById('investment-date').value, kind: 'LUMPSUM',
            };
            const response = await fetch(sip ? '/api/mutual-funds/sips' : '/api/mutual-funds/investments', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), cache: 'no-store',
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Could not save this investment.');
            close();
            toast(sip ? 'Monthly investment plan saved.' : 'Investment saved at NAV dated ' + data.transaction.nav_date + '.');
        } catch (error) { toast(error.message, true); }
        finally { button.disabled = false; button.textContent = previous; }
    }

    document.querySelectorAll('[data-investment-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.investmentMode)));
    document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', close));
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.hidden) close(); });
    document.getElementById('sip-form').addEventListener('submit', event => submit(event, true));
    document.getElementById('investment-form').addEventListener('submit', event => submit(event, false));
    bindPicker('sip');
    bindPicker('investment');
    window.openMFInvestmentModal = open;
})();
