(() => {
  const symbol = String(window.fundamentalsSymbol || '').toUpperCase();
  const content = document.getElementById('concallsContent');
  const moreWrap = document.getElementById('concallsMoreWrap');
  const moreButton = document.getElementById('concallsMore');
  const sourceLink = document.getElementById('concallsSource');
  const summaryModal = document.getElementById('concallSummaryModal');
  const summaryMeta = document.getElementById('concallSummaryMeta');
  const summaryBody = document.getElementById('concallSummaryBody');
  const summarySource = document.getElementById('concallSummarySource');
  if (!content || !moreWrap || !moreButton) return;

  let page = 0;
  let loading = false;
  let hasMore = true;
  const QUARTERS_PER_BATCH = 4;
  const seenIds = new Set();
  const groups = new Map();
  const recordsById = new Map();

  const esc = (value) => {
    const node = document.createElement('span');
    node.textContent = String(value ?? '');
    return node.innerHTML;
  };

  function quarterKey(item) {
    return item.year && item.quarter
      ? `${item.year}-Q${item.quarter}`
      : 'Undated';
  }

  function displayDate(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function render() {
    const sorted = [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    recordsById.clear();
    sorted.forEach(([, docs]) => docs.forEach((doc) => recordsById.set(String(doc.id), doc)));
    if (!sorted.length) {
      if (page > 0) content.innerHTML = hasMore
        ? '<div class="empty-state">No concall documents found in these four quarters. Select “Load more” to check older NSE filings.</div>'
        : '<div class="empty-state">No concall presentations or transcripts were found in the available NSE filings.</div>';
      return;
    }
    content.innerHTML = sorted.map(([key, docs]) => {
      const [year, quarter] = key.split('-');
      const title = key === 'Undated' ? 'Date not available' : `${quarter.replace('Q', 'Quarter ')} · ${year}`;
      const docRows = docs.map((doc) => {
        const dateText = displayDate(doc.date);
        const label = `${esc(doc.subject)}${dateText ? ` · ${esc(dateText)}` : ''}`;
        let actions = '';
        if (doc.type === 'transcript') {
          actions = `<a class="concalls-action" href="${esc(doc.url)}" target="_blank" rel="noopener noreferrer">Transcript ↗</a>
            <button class="concalls-action summary" type="button" data-summary="${esc(doc.id)}">AI Summary</button>`;
        } else if (doc.type === 'ppt') {
          actions = `<a class="concalls-action" href="${esc(doc.url)}" target="_blank" rel="noopener noreferrer">PPT ↗</a>`;
        }
        return `<div class="concalls-row"><div class="concalls-label">${label}</div><div class="concalls-actions">${actions}</div></div>`;
      }).join('');
      return `<div class="concalls-group"><div class="concalls-quarter">${esc(title)}</div>${docRows}</div>`;
    }).join('');
    content.querySelectorAll('[data-summary]').forEach((button) => button.addEventListener('click', () => summarize(button)));
  }

  async function summarize(button) {
    const record = recordsById.get(button.dataset.summary);
    if (!record || !summaryModal || !summaryBody) return;
    button.disabled = true;
    button.textContent = 'Summarizing…';
    summaryModal.hidden = false;
    document.body.classList.add('concall-summary-open');
    summaryMeta.textContent = [record.company, record.subject, displayDate(record.date)].filter(Boolean).join(' · ');
    summarySource.href = record.url;
    summaryBody.innerHTML = '<div class="concall-summary-loading"><span class="concall-summary-spinner"></span><span>Reading the transcript and preparing a clear, brief summary…</span></div>';
    try {
      const response = await fetch('/api/fundamentals/concalls/summarize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not summarize the transcript.');
      summaryBody.innerHTML = renderSummary(result.summary || {});
      button.textContent = 'AI Summary';
    } catch (error) {
      summaryBody.innerHTML = `<div class="concalls-error">${esc(error.message)}</div>`;
      button.textContent = 'Retry AI Summary';
    } finally {
      button.disabled = false;
    }
  }

  function renderSummary(summary) {
    const bulletSection = (title, values, extraClass = '') => {
      if (!Array.isArray(values) || !values.length) return '';
      return `<section class="concall-summary-section ${extraClass}"><h3>${title}</h3><ul class="concall-summary-points">${values.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></section>`;
    };
    const overview = summary.overview
      ? `<div class="concall-summary-overview"><span class="concall-summary-overview-label">In brief</span>${esc(summary.overview)}</div>`
      : '';
    const sections = [
      bulletSection('Key takeaways', summary.key_points),
      bulletSection('Financials & guidance', summary.financials_and_guidance, 'financials'),
      bulletSection('Risks & watchpoints', summary.risks_or_watchpoints, 'watchpoints'),
    ].join('');
    if (!overview && !sections) return '<div class="concalls-error">No readable summary was returned. Please open the transcript for full details.</div>';
    return `${overview}${sections}`;
  }

  function closeSummaryModal() {
    if (!summaryModal) return;
    summaryModal.hidden = true;
    document.body.classList.remove('concall-summary-open');
  }

  summaryModal?.querySelectorAll('[data-summary-close]').forEach((control) => control.addEventListener('click', closeSummaryModal));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && summaryModal && !summaryModal.hidden) closeSummaryModal();
  });

  async function loadNextBatch() {
    if (loading || !hasMore) return;
    loading = true;
    moreButton.disabled = true;
    moreButton.textContent = 'Loading four quarters…';
    if (page === 0) content.innerHTML = '<div class="empty-state">Loading official concall documents…</div>';
    try {
      for (let index = 0; index < QUARTERS_PER_BATCH && hasMore; index += 1) {
        const nextPage = page + 1;
        const query = new URLSearchParams({ symbol, page: String(nextPage) });
        const response = await fetch(`/api/fundamentals/concalls?${query}`, { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load official concall documents.');

        const incoming = result.items || [];
        const newItems = incoming.filter((item) => !seenIds.has(item.id));
        incoming.forEach((item) => seenIds.add(item.id));
        page = nextPage;
        hasMore = Boolean(result.has_more);
        newItems.forEach((item) => {
          const key = quarterKey(item);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(item);
        });
        groups.forEach((docs) => docs.sort((a, b) => String(b.date).localeCompare(String(a.date))));
        if (sourceLink && result.source_url) sourceLink.href = result.source_url;
        render();
      }
    } catch (error) {
      const message = `<div class="concalls-error">${esc(error.message)} ${sourceLink?.href ? ` <a class="concalls-source" href="${esc(sourceLink.href)}" target="_blank" rel="noopener noreferrer">Open NSE filings ↗</a>` : ''}</div>`;
      content.insertAdjacentHTML(groups.size ? 'beforeend' : 'afterbegin', message);
      hasMore = false;
    } finally {
      loading = false;
      moreButton.disabled = false;
      moreWrap.hidden = !hasMore;
      if (hasMore) moreButton.textContent = 'Load more';
    }
  }

  moreButton.addEventListener('click', loadNextBatch);
  loadNextBatch();
})();
