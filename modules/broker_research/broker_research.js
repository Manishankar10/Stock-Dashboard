/**
 * CAPITAL DESK - INSTITUTIONAL & BROKER RESEARCH COMPONENT
 * Location: modules/broker_research/broker_research.js
 * Sourced recent 6-months institutional & mutual fund research papers,
 * with interactive table view, glassy modals, and AI summarization.
 */

(function () {
    let _activeModalReports = [];
    let _currentSymbol = null;
    let _currentWatchlist = null;
    let _currentCompanyName = null;

    // Helper: Escape HTML
    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Helper: Convert Markdown to HTML for AI modal
    function renderMarkdown(md) {
        if (!md) return '';
        let html = esc(md);
        // Headers
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        // Bold
        html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
        // Italics
        html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');
        // Unordered lists
        html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>)/gims, '<ul>$1</ul>');
        // Fix multiple consecutive uls
        html = html.replace(/<\/ul>\s*<ul>/g, '');
        // Horizontal rule
        html = html.replace(/^---$/gim, '<hr>');
        // Line breaks
        html = html.replace(/\n\n/g, '<br><br>');
        return html;
    }

    // Ensure Standalone Modal Exists
    function ensureModal() {
        let modal = document.getElementById('brokerResearchModal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'brokerResearchModal';
        modal.className = 'br-modal-overlay';
        modal.onclick = function (e) {
            if (e.target === modal) window.closeBrokerResearchModal();
        };

        modal.innerHTML = `
            <div class="br-modal-content" onclick="event.stopPropagation()">
                <div class="br-modal-header">
                    <div class="br-header-left">
                        <div class="br-icon-badge">🏛️</div>
                        <div>
                            <h3 class="br-header-title">
                                Institutional &amp; Broker Research
                                <span id="br-modal-badge" style="font-size:12px; font-weight:700; color:#10b981; padding:2px 8px; border-radius:9999px; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.25);"></span>
                            </h3>
                            <div class="br-header-sub" id="br-modal-subtitle">Recent 6 months research reports, papers &amp; broker coverage</div>
                        </div>
                    </div>
                    <div class="br-header-actions">
                        <select id="br-stock-select" class="br-stock-select" style="display:none;" onchange="window.onBrokerResearchStockChange(this.value)">
                            <option value="">All Watchlist Stocks</option>
                        </select>
                        <button type="button" class="br-close-btn" onclick="window.closeBrokerResearchModal()" title="Close dialog">✕</button>
                    </div>
                </div>

                <div class="br-filter-bar">
                    <div class="br-stats-pill-group" id="br-stats-pills">
                        <span class="br-stat-pill emerald" id="br-stat-count">0 Reports</span>
                        <span class="br-stat-pill" id="br-stat-window">Past 6 Months</span>
                        <span class="br-stat-pill" id="br-stat-sources">Institutions, MFs &amp; Brokers</span>
                    </div>
                    <div>
                        <input type="text" id="br-search-input" class="br-search-input" placeholder="Search by author, title or reco..." oninput="window.filterBrokerResearchTable(this.value)">
                    </div>
                </div>

                <div class="br-table-viewport" id="br-table-viewport">
                    <table class="br-table" id="br-main-table">
                        <thead>
                            <tr>
                                <th style="width: 100px;">Date</th>
                                <th style="width: 190px;">Author / Institution</th>
                                <th style="min-width: 280px;">Report &amp; Recommendation</th>
                                <th class="text-center" style="width: 110px;">Document</th>
                                <th class="text-center" style="width: 120px;">AI Summary</th>
                            </tr>
                        </thead>
                        <tbody id="br-table-tbody">
                            <!-- Populated dynamically -->
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        return modal;
    }

    // Ensure AI Summary Popup Modal Exists
    function ensureAiModal() {
        let aiModal = document.getElementById('brokerResearchAiModal');
        if (aiModal) return aiModal;

        aiModal = document.createElement('div');
        aiModal.id = 'brokerResearchAiModal';
        aiModal.className = 'br-ai-modal-overlay';
        aiModal.onclick = function (e) {
            if (e.target === aiModal) window.closeBrokerResearchAiModal();
        };

        aiModal.innerHTML = `
            <div class="br-ai-modal-content" onclick="event.stopPropagation()">
                <div class="br-ai-modal-header">
                    <div class="br-ai-modal-title-group">
                        <span class="br-ai-spark-icon">✨</span>
                        <div>
                            <h4 class="br-ai-modal-title" id="br-ai-title">Institutional Equity Research Summary</h4>
                            <div class="br-ai-modal-sub" id="br-ai-sub">Key takeaways &amp; investment thesis synthesized by AI</div>
                        </div>
                    </div>
                    <button type="button" class="br-close-btn" onclick="window.closeBrokerResearchAiModal()" title="Close dialog">✕</button>
                </div>

                <div class="br-ai-body" id="br-ai-content">
                    <div style="text-align:center; padding: 40px; color: var(--br-text-secondary);">
                        <div class="spin" style="font-size:24px; margin-bottom:10px;">✨</div>
                        <div>Synthesizing Institutional Research Highlights...</div>
                    </div>
                </div>

                <div class="br-ai-modal-footer">
                    <div class="br-ai-footer-left">
                        <span id="br-ai-report-author"></span> • <span id="br-ai-report-date"></span>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button type="button" class="br-btn-copy" onclick="window.copyBrokerResearchAiSummary()">📋 Copy Summary</button>
                        <a id="br-ai-source-link" class="br-btn-doc" href="#" target="_blank" rel="noopener noreferrer">📄 View Report ↗</a>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(aiModal);
        return aiModal;
    }

    // Render Table Rows
    function renderRows(reports, tbodyEl) {
        if (!tbodyEl) return;
        if (!reports || reports.length === 0) {
            tbodyEl.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center" style="padding: 48px 16px; color: var(--br-text-secondary);">
                        <div style="font-size: 26px; margin-bottom: 8px;">📑</div>
                        <div style="font-weight: 700; font-size: 14px;">No Research Reports Found</div>
                        <div style="font-size: 12px; opacity: 0.8; margin-top: 4px;">No institutional coverage or broker reports match the query.</div>
                    </td>
                </tr>
            `;
            return;
        }

        let html = '';
        reports.forEach((rep, idx) => {
            const rating = (rep.rating || 'BUY').toUpperCase();
            let ratingCls = 'br-rating-buy';
            if (rating.includes('ACCUM') || rating.includes('OVERWEIGHT')) ratingCls = 'br-rating-accumulate';
            else if (rating.includes('HOLD') || rating.includes('NEUTRAL')) ratingCls = 'br-rating-hold';
            else if (rating.includes('SELL') || rating.includes('REDUCE') || rating.includes('UNDERPERFORM')) ratingCls = 'br-rating-reduce';

            const instType = rep.institution_type || 'Brokerage';
            let instCls = 'br-inst-broker';
            if (instType.includes('Mutual Fund') || instType.includes('AMC')) instCls = 'br-inst-mf';
            else if (instType.includes('Equity') || instType.includes('Institutional')) instCls = 'br-inst-equity';
            else if (instType.includes('Global')) instCls = 'br-inst-global';

            const tp = rep.target_price && rep.target_price !== 'N/A' && rep.target_price !== 'Available' ? `₹${rep.target_price}` : '';
            const upside = rep.upside ? `<span class="upside">${esc(rep.upside)}</span>` : '';

            const repJson = esc(JSON.stringify(rep));

            html += `
                <tr class="br-row">
                    <td class="br-col-date">
                        ${esc(rep.date || 'Recent')}
                    </td>
                    <td>
                        <div class="br-author-wrap">
                            <span class="br-author-name">${esc(rep.author || 'Institutional Research')}</span>
                            <span class="br-inst-badge ${instCls}">${esc(instType)}</span>
                        </div>
                    </td>
                    <td>
                        <div class="br-report-cell">
                            <span class="br-report-title">${esc(rep.title || `${typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(rep.symbol) : rep.symbol} Research Report`)}</span>
                            <div class="br-report-meta-row">
                                <span class="br-rating-badge ${ratingCls}">${esc(rating)}</span>
                                ${tp ? `<span class="br-target-tag">Target: <strong>${esc(tp)}</strong> ${upside}</span>` : ''}
                            </div>
                        </div>
                    </td>
                    <td class="text-center">
                        <a class="br-btn-doc" href="${esc(rep.url || '#')}" target="_blank" rel="noopener noreferrer" title="View Source Document / Research Paper">
                            📄 Report ↗
                        </a>
                    </td>
                    <td class="text-center">
                        <button type="button" class="br-btn-ai" onclick='window.openBrokerResearchAiModal(${repJson})' title="Open AI synthesized key insights &amp; thesis">
                            ✦ AI Summary
                        </button>
                    </td>
                </tr>
            `;
        });

        tbodyEl.innerHTML = html;
    }

    // Public API: Open Standalone Modal
    window.openBrokerResearchModal = async function (symbol, companyName, watchlistName) {
        _currentSymbol = symbol || null;
        _currentCompanyName = companyName || null;
        _currentWatchlist = watchlistName || null;

        const modal = ensureModal();
        const badgeEl = modal.querySelector('#br-modal-badge');
        const selectEl = modal.querySelector('#br-stock-select');
        const countEl = modal.querySelector('#br-stat-count');
        const tbody = modal.querySelector('#br-table-tbody');

        let displayLabel = '';
        if (symbol) {
            displayLabel = `${typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(symbol) : symbol.replace(/\.(NS|BS|BO)$/i, '')}${companyName ? ' • ' + companyName : ''}`;
            if (selectEl) selectEl.style.display = 'none';
        } else if (watchlistName) {
            displayLabel = `Watchlist: ${watchlistName}`;
            if (selectEl) selectEl.style.display = 'inline-block';
        } else {
            displayLabel = 'All Institutional Reports';
            if (selectEl) selectEl.style.display = 'none';
        }

        if (badgeEl) badgeEl.innerText = displayLabel;
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center" style="padding: 40px; color: var(--br-text-secondary);">
                        <div style="font-size:24px; margin-bottom:8px;">⏳</div>
                        <div>Fetching recent 6 months institutional &amp; broker research papers...</div>
                    </td>
                </tr>
            `;
        }

        modal.style.display = 'flex';
        requestAnimationFrame(() => modal.classList.add('is-open'));
        document.body.style.overflow = 'hidden';

        // Load data from backend
        let url = '/api/broker-research';
        const params = new URLSearchParams();
        if (symbol) {
            params.set('symbol', symbol);
            if (companyName) params.set('company', companyName);
        } else if (watchlistName) {
            params.set('watchlist', watchlistName);
        }
        if (params.toString()) url += `?${params.toString()}`;

        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data.success && data.reports) {
                _activeModalReports = data.reports;
                renderRows(_activeModalReports, tbody);
                if (countEl) countEl.innerText = `${_activeModalReports.length} Reports Found`;

                // If watchlist, populate stock select dropdown
                if (watchlistName && selectEl && data.symbols) {
                    selectEl.innerHTML = '<option value="">All Watchlist Stocks</option>' +
                        data.symbols.map(s => `<option value="${esc(s)}">${esc(typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(s) : s.replace(/\.(NS|BS|BO)$/i, ''))}</option>`).join('');
                }
            } else {
                tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding:30px; color:#ef4444;">Could not load research reports.</td></tr>`;
            }
        } catch (e) {
            console.error('Error fetching broker research:', e);
            if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding:30px; color:#ef4444;">Error retrieving research data.</td></tr>`;
        }
    };

    window.closeBrokerResearchModal = function () {
        const modal = document.getElementById('brokerResearchModal');
        if (modal) {
            modal.classList.remove('is-open');
            setTimeout(() => { modal.style.display = 'none'; }, 200);
        }
        document.body.style.overflow = '';
    };

    // Filter Table by Stock Dropdown inside Watchlist view
    window.onBrokerResearchStockChange = function (selectedStock) {
        const tbody = document.getElementById('br-table-tbody');
        if (!selectedStock) {
            renderRows(_activeModalReports, tbody);
            return;
        }
        const filtered = _activeModalReports.filter(r => (r.symbol || '').toUpperCase() === selectedStock.toUpperCase());
        renderRows(filtered, tbody);
    };

    // Filter Table by Text Search Input
    window.filterBrokerResearchTable = function (query) {
        const q = (query || '').toLowerCase().trim();
        const tbody = document.getElementById('br-table-tbody');
        if (!q) {
            renderRows(_activeModalReports, tbody);
            return;
        }
        const filtered = _activeModalReports.filter(r => {
            const author = (r.author || '').toLowerCase();
            const title = (r.title || '').toLowerCase();
            const rating = (r.rating || '').toLowerCase();
            const sym = (r.symbol || '').toLowerCase();
            return author.includes(q) || title.includes(q) || rating.includes(q) || sym.includes(q);
        });
        renderRows(filtered, tbody);
    };

    // Public API: Render Embedded Section inside Fundamentals Popup
    window.renderBrokerResearchSection = async function (containerEl, symbol, companyName) {
        if (!containerEl || !symbol) return;

        containerEl.innerHTML = `
            <div style="text-align: center; padding: 24px; color: var(--text-secondary);">
                <div style="font-size: 20px; margin-bottom: 6px;">⏳</div>
                <div>Fetching recent 6 months institutional &amp; broker research papers for ${esc(typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(symbol) : symbol.replace(/\.(NS|BS|BO)$/i, ''))}...</div>
            </div>
        `;

        try {
            const res = await fetch(`/api/broker-research?symbol=${encodeURIComponent(symbol)}&company=${encodeURIComponent(companyName || '')}`);
            const data = await res.json();
            if (data.success && data.reports && data.reports.length > 0) {
                containerEl.innerHTML = `
                    <div class="br-embedded-table-wrap">
                        <table class="br-table" style="min-width: 720px;">
                            <thead>
                                <tr>
                                    <th style="width: 100px;">Date</th>
                                    <th style="width: 190px;">Author / Institution</th>
                                    <th style="min-width: 260px;">Report &amp; Recommendation</th>
                                    <th class="text-center" style="width: 110px;">Document</th>
                                    <th class="text-center" style="width: 120px;">AI Summary</th>
                                </tr>
                            </thead>
                            <tbody id="br-embedded-tbody-${esc(symbol)}"></tbody>
                        </table>
                    </div>
                `;
                const tbody = document.getElementById(`br-embedded-tbody-${symbol}`);
                renderRows(data.reports, tbody);
            } else {
                containerEl.innerHTML = `
                    <div style="text-align: center; padding: 24px; color: var(--text-secondary); font-size: 13px;">
                        No recent institutional research reports found for ${esc(typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(symbol) : symbol.replace(/\.(NS|BS|BO)$/i, ''))}.
                    </div>
                `;
            }
        } catch (e) {
            console.error('Error rendering embedded broker research:', e);
            containerEl.innerHTML = `
                <div style="text-align: center; padding: 20px; color: #ef4444; font-size: 13px;">
                    Failed to load research papers.
                </div>
            `;
        }
    };

    // Public API: Open Separate AI Summary Popup Modal
    window.openBrokerResearchAiModal = async function (reportData) {
        if (!reportData) return;

        const aiModal = ensureAiModal();
        const titleEl = aiModal.querySelector('#br-ai-title');
        const subEl = aiModal.querySelector('#br-ai-sub');
        const authorEl = aiModal.querySelector('#br-ai-report-author');
        const dateEl = aiModal.querySelector('#br-ai-report-date');
        const sourceLinkEl = aiModal.querySelector('#br-ai-source-link');
        const contentEl = aiModal.querySelector('#br-ai-content');

        if (titleEl) titleEl.innerText = `${(typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(reportData.symbol) : reportData.symbol) || 'Stock'} - AI Research Briefing`;
        if (subEl) subEl.innerText = reportData.title || 'Institutional Equity Research & Valuation Report';
        if (authorEl) authorEl.innerText = reportData.author || 'Institutional Research';
        if (dateEl) dateEl.innerText = reportData.date || 'Recent';
        if (sourceLinkEl) {
            sourceLinkEl.href = reportData.url || '#';
            sourceLinkEl.style.display = reportData.url ? 'inline-flex' : 'none';
        }

        if (contentEl) {
            contentEl.innerHTML = `
                <div style="text-align:center; padding: 48px; color: var(--br-text-secondary);">
                    <div style="font-size:28px; margin-bottom:12px; animation: br-pulse 1.4s infinite;">✨</div>
                    <div style="font-weight:700; font-size:14px; color:var(--br-text-primary);">Synthesizing Institutional Equity Research...</div>
                    <div style="font-size:12px; opacity:0.8; margin-top:4px;">Analyzing investment thesis, financial growth estimates, catalysts and key risks</div>
                </div>
            `;
        }

        aiModal.style.display = 'flex';
        requestAnimationFrame(() => aiModal.classList.add('is-open'));

        // Request backend AI summary
        try {
            const res = await fetch('/api/broker-research/summarize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reportData)
            });
            const data = await res.json();
            if (data.success && data.summary) {
                window._lastAiSummaryMarkdown = data.summary;
                contentEl.innerHTML = renderMarkdown(data.summary);
            } else {
                contentEl.innerHTML = `<div style="padding:24px; color:#ef4444;">Could not generate AI summary: ${esc(data.error || 'Server error')}</div>`;
            }
        } catch (e) {
            console.error('Error in AI summary:', e);
            if (contentEl) contentEl.innerHTML = `<div style="padding:24px; color:#ef4444;">Network error while generating AI research summary.</div>`;
        }
    };

    window.closeBrokerResearchAiModal = function () {
        const aiModal = document.getElementById('brokerResearchAiModal');
        if (aiModal) {
            aiModal.classList.remove('is-open');
            setTimeout(() => { aiModal.style.display = 'none'; }, 200);
        }
    };

    window.copyBrokerResearchAiSummary = function () {
        const text = window._lastAiSummaryMarkdown || document.getElementById('br-ai-content')?.innerText || '';
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            const btn = document.querySelector('.br-btn-copy');
            if (btn) {
                const old = btn.innerText;
                btn.innerText = '✓ Copied!';
                setTimeout(() => { btn.innerText = old; }, 1800);
            }
        }).catch(() => {
            alert('Failed to copy to clipboard.');
        });
    };

    // ESC key closes modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const aiModal = document.getElementById('brokerResearchAiModal');
            if (aiModal && aiModal.style.display === 'flex') {
                window.closeBrokerResearchAiModal();
                return;
            }
            const modal = document.getElementById('brokerResearchModal');
            if (modal && modal.style.display === 'flex') {
                window.closeBrokerResearchModal();
            }
        }
    });
})();
