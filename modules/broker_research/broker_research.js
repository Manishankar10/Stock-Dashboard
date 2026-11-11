/**
 * CAPITAL DESK - INSTITUTIONAL & BROKER RESEARCH COMPONENT
 * Location: modules/broker_research/broker_research.js
 * Sourced recent 6-months institutional & mutual fund research papers,
 * concalls, annual reports, credit ratings and corporate filings,
 * with category tabs navigation, interactive table view, glassy modals, and AI summarization.
 */

(function () {
    let _activeModalReports = [];
    let _currentSymbol = null;
    let _currentWatchlist = null;
    let _currentCompanyName = null;
    let _activeCategory = 'all';
    let _searchQuery = '';
    let _selectedStock = '';

    const CATEGORY_DEFS = [
        { id: 'all', label: 'All', icon: '📑' },
        { id: 'broker_research', label: 'Broker Research', icon: '🏛️' },
        { id: 'concalls', label: 'Concalls & PPTs', icon: '🎙️' },
        { id: 'annual_reports', label: 'Annual Reports', icon: '📚' },
        { id: 'credit_ratings', label: 'Credit Ratings', icon: '⭐' },
        { id: 'announcements', label: 'Announcements', icon: '📢' }
    ];

    // Helper: Escape HTML
    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Helper: Convert Markdown to HTML for AI modal with full table & formatting support
    function parseMarkdownTables(text) {
        if (!text) return '';
        const lines = text.split('\n');
        let inTable = false;
        let tableLines = [];
        let output = [];

        function renderTable(tLines) {
            if (tLines.length < 2) return tLines.join('\n');
            const cleanRows = tLines.map(l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()));
            if (cleanRows.length < 2) return tLines.join('\n');
            const isSep = cleanRows[1] && cleanRows[1].every(c => /^:?-+:?$/.test(c));
            if (!isSep) return tLines.join('\n');

            let ths = cleanRows[0].map(c => `<th>${c}</th>`).join('');
            let thead = `<thead><tr>${ths}</tr></thead>`;
            let tbodyRows = cleanRows.slice(2).map(row => {
                let tds = row.map(c => `<td>${c}</td>`).join('');
                return `<tr>${tds}</tr>`;
            }).join('');
            let tbody = `<tbody>${tbodyRows}</tbody>`;
            return `<div class="br-ai-table-wrap"><table class="br-ai-table">${thead}${tbody}</table></div>`;
        }

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('|') && line.endsWith('|')) {
                inTable = true;
                tableLines.push(lines[i]);
            } else {
                if (inTable) {
                    output.push(renderTable(tableLines));
                    tableLines = [];
                    inTable = false;
                }
                output.push(lines[i]);
            }
        }
        if (inTable) {
            output.push(renderTable(tableLines));
        }
        return output.join('\n');
    }

    function renderMarkdown(md) {
        if (!md) return '';
        let html = esc(md);

        // 1. Process Markdown Tables
        html = parseMarkdownTables(html);

        // 2. Headers
        html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

        // 3. Bold & Italics
        html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
        html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');

        // 4. Links [text](url)
        html = html.replace(/\[(.*?)\]\((https?:\/\/[^\s\)]+)\)/gim, '<a href="$2" target="_blank" rel="noopener noreferrer" class="br-ai-link">$1 ↗</a>');

        // 5. Unordered Lists
        html = html.replace(/^[\-\*]\s+(.*$)/gim, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>)/gims, '<ul>$1</ul>');
        html = html.replace(/<\/ul>\s*<ul>/g, '');

        // 6. Horizontal Rules & Blockquotes
        html = html.replace(/^---$/gim, '<hr class="br-ai-divider">');
        html = html.replace(/^&gt;\s*(.*$)/gim, '<blockquote class="br-ai-quote">$1</blockquote>');

        // 7. Auto-highlight Recommendation and Risk Tags
        html = html.replace(/\b(STRONG BUY|BUY|ADD|ACCUMULATE)\b/g, '<span class="br-badge-reco-buy">$1</span>');
        html = html.replace(/\b(HOLD|NEUTRAL)\b/g, '<span class="br-badge-reco-hold">$1</span>');
        html = html.replace(/\b(SELL|REDUCE|UNDERPERFORM)\b/g, '<span class="br-badge-reco-sell">$1</span>');

        // 8. Line breaks
        html = html.replace(/\n\n+/g, '<br><br>');
        return html;
    }

    // Ensure Standalone Modal Exists
    function ensureModal() {
        let modal = document.getElementById('brokerResearchModal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'brokerResearchModal';
        modal.className = 'br-modal-overlay';
        // Modals close ONLY via Escape or close button (backdrop clicks disabled)

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
                            <div class="br-header-sub" id="br-modal-subtitle">Recent research reports, concalls, annual reports &amp; broker coverage</div>
                        </div>
                    </div>
                    <div class="br-header-actions">
                        <select id="br-stock-select" class="br-stock-select" style="display:none;" onchange="window.onBrokerResearchStockChange(this.value)">
                            <option value="">All Watchlist Stocks</option>
                        </select>
                        <button type="button" id="br-refresh-btn" class="br-refresh-btn" onclick="window.refreshBrokerResearchModal()" title="Refresh research documents" aria-label="Refresh research documents">
                            <svg class="br-refresh-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                            </svg>
                        </button>
                        <button type="button" class="br-close-btn" onclick="window.closeBrokerResearchModal()" title="Close dialog">✕</button>
                    </div>
                </div>

                <div class="br-filter-bar">
                    <div class="br-stats-pill-group" id="br-stats-pills">
                        <span class="br-stat-pill emerald" id="br-stat-count">0 Documents</span>
                        <span class="br-stat-pill" id="br-stat-window">Past 3 Years</span>
                        <span class="br-stat-pill" id="br-stat-sources">Sources: trendlyne.com, screener.in, bseindia.com</span>
                        <span class="br-stat-pill emerald" id="br-stat-verified">✓ PDF &amp; Content Verified</span>
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
        // Modals close ONLY via Escape or close button (backdrop clicks disabled)

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
                        <button type="button" class="br-btn-regen" id="br-ai-regen-btn" onclick="window.regenerateBrokerResearchAiSummary()" title="Re-run AI analysis with current prompt settings">🔄 Re-Analyze</button>
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
                        <div style="font-weight: 700; font-size: 14px;">No Research Documents Found</div>
                        <div style="font-size: 12px; opacity: 0.8; margin-top: 4px;">No research documents match the current search or filter criteria.</div>
                    </td>
                </tr>
            `;
            return;
        }

        let html = '';
        reports.forEach((rep, idx) => {
            const rating = (rep.rating || 'AVAILABLE').toUpperCase();
            let ratingCls = 'br-rating-buy';
            if (rating.includes('ACCUM') || rating.includes('OVERWEIGHT')) ratingCls = 'br-rating-accumulate';
            else if (rating.includes('HOLD') || rating.includes('NEUTRAL')) ratingCls = 'br-rating-hold';
            else if (rating.includes('SELL') || rating.includes('REDUCE') || rating.includes('UNDERPERFORM')) ratingCls = 'br-rating-reduce';
            else if (rating === 'TRANSCRIPT') ratingCls = 'br-rating-transcript';
            else if (rating === 'PPT') ratingCls = 'br-rating-ppt';
            else if (rating === 'AUDIO') ratingCls = 'br-rating-audio';
            else if (rating === 'REPORT') ratingCls = 'br-rating-report';
            else if (rating === 'RATING') ratingCls = 'br-rating-credit';
            else if (rating === 'FILING') ratingCls = 'br-rating-filing';

            const instType = rep.institution_type || 'Brokerage';
            let instCls = 'br-inst-broker';
            if (instType.includes('Mutual Fund') || instType.includes('AMC')) instCls = 'br-inst-mf';
            else if (instType.includes('Equity') || instType.includes('Institutional')) instCls = 'br-inst-equity';
            else if (instType.includes('Global')) instCls = 'br-inst-global';
            else if (instType.includes('Rating')) instCls = 'br-inst-rating';
            else if (instType.includes('Concall') || instType.includes('Audio')) instCls = 'br-inst-concall';
            else if (instType.includes('Annual')) instCls = 'br-inst-annual';
            else if (instType.includes('Regulatory') || instType.includes('Filing')) instCls = 'br-inst-filing';

            const tp = rep.target_price && rep.target_price !== 'N/A' && rep.target_price !== 'Available' && rep.target_price !== 'PDF Document' ? `₹${rep.target_price}` : '';
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
                            <span class="br-report-title">${esc(rep.title || `${typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(rep.symbol) : rep.symbol} Research Document`)}</span>
                            <div class="br-report-meta-row">
                                <span class="br-rating-badge ${ratingCls}">${esc(rating)}</span>
                                ${tp ? `<span class="br-target-tag">Target: <strong>${esc(tp)}</strong> ${upside}</span>` : ''}
                            </div>
                        </div>
                    </td>
                    <td class="text-center">
                        ${(() => {
                            const urlLower = (rep.url || '').toLowerCase();
                            const isAudio = rep.rating === 'AUDIO' || (rep.author && rep.author.toLowerCase().includes('audio')) || urlLower.includes('youtube') || urlLower.includes('youtu.be') || urlLower.endsWith('.mp3');
                            const isPdf = rep.has_pdf || urlLower.endsWith('.pdf') || urlLower.includes('/pdf/') || urlLower.includes('annpdfopen') || urlLower.includes('/corpfiling/');

                            let btnText = '📄 Report ↗';
                            let btnCls = 'br-btn-doc';
                            let btnTitle = 'View Document';

                            if (isAudio) {
                                btnText = '🔊 Audio ↗';
                                btnCls = 'br-btn-doc br-btn-audio';
                                btnTitle = 'Listen to Concall Recording / Webcast';
                            } else if (isPdf) {
                                btnText = '📕 PDF ↗';
                                btnCls = 'br-btn-doc br-btn-pdf';
                                btnTitle = 'Open Verified PDF Document';
                            }
                            return `<a class="${btnCls}" href="${esc(rep.url || '#')}" target="_blank" rel="noopener noreferrer" title="${btnTitle}">${btnText}</a>`;
                        })()}
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

    // Modal Filter Helper
    function applyModalFilters() {
        const modal = document.getElementById('brokerResearchModal');
        if (!modal) return;
        const tbody = modal.querySelector('#br-table-tbody');
        const countEl = modal.querySelector('#br-stat-count');

        let filtered = _activeModalReports || [];
        if (_selectedStock) {
            filtered = filtered.filter(r => (r.symbol || '').toUpperCase() === _selectedStock.toUpperCase());
        }
        if (_activeCategory && _activeCategory !== 'all') {
            filtered = filtered.filter(r => r.category === _activeCategory);
        }
        if (_searchQuery) {
            const q = _searchQuery.toLowerCase();
            filtered = filtered.filter(r => {
                const author = (r.author || '').toLowerCase();
                const title = (r.title || '').toLowerCase();
                const rating = (r.rating || '').toLowerCase();
                const sym = (r.symbol || '').toLowerCase();
                const tab = (r.tab_name || '').toLowerCase();
                return author.includes(q) || title.includes(q) || rating.includes(q) || sym.includes(q) || tab.includes(q);
            });
        }

        renderRows(filtered, tbody);

        if (countEl) {
            countEl.innerText = `${filtered.length} Document${filtered.length === 1 ? '' : 's'}`;
        }
    }

    // Modal Category Switcher
    window.setBrokerResearchCategory = function (catId) {
        _activeCategory = catId || 'all';
        applyModalFilters();
    };

    // Public API: Open Standalone Modal
    window.openBrokerResearchModal = async function (symbol, companyName, watchlistName, forceRefresh = false) {
        _currentSymbol = symbol || null;
        _currentCompanyName = companyName || null;
        _currentWatchlist = watchlistName || null;
        _activeCategory = 'all';
        _searchQuery = '';
        _selectedStock = '';

        const modal = ensureModal();
        const badgeEl = modal.querySelector('#br-modal-badge');
        const selectEl = modal.querySelector('#br-stock-select');
        const countEl = modal.querySelector('#br-stat-count');
        const searchInput = modal.querySelector('#br-search-input');
        const tbody = modal.querySelector('#br-table-tbody');

        if (searchInput) searchInput.value = '';

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
                        <div>Fetching recent research documents, concalls, annual reports &amp; broker coverage...</div>
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
        if (forceRefresh) {
            params.set('refresh', '1');
        }
        if (params.toString()) url += `?${params.toString()}`;

        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data.success && data.reports) {
                _activeModalReports = data.reports;

                applyModalFilters();

                const sourcesEl = modal.querySelector('#br-stat-sources');
                if (sourcesEl && data.allowed_sources && data.allowed_sources.length > 0) {
                    sourcesEl.innerText = `Sources: ${data.allowed_sources.join(', ')}`;
                    sourcesEl.title = `Admin configured sources: ${data.allowed_sources.join(', ')}`;
                }

                // If watchlist, populate stock select dropdown
                if (watchlistName && selectEl && data.symbols) {
                    selectEl.innerHTML = '<option value="">All Watchlist Stocks</option>' +
                        data.symbols.map(s => `<option value="${esc(s)}">${esc(typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(s) : s.replace(/\.(NS|BS|BO)$/i, ''))}</option>`).join('');
                }
            } else {
                if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding:30px; color:#ef4444;">Could not load research reports.</td></tr>`;
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

    // Public API: Force Refresh Modal Data (bypasses backend cache)
    window.refreshBrokerResearchModal = async function () {
        const btn = document.getElementById('br-refresh-btn');
        const icon = btn ? btn.querySelector('.br-refresh-icon') : null;
        if (icon) icon.classList.add('is-spinning');
        if (btn) btn.disabled = true;

        try {
            await window.openBrokerResearchModal(_currentSymbol, _currentCompanyName, _currentWatchlist, true);
        } catch (e) {
            console.error('Error refreshing broker research modal:', e);
        } finally {
            if (icon) icon.classList.remove('is-spinning');
            if (btn) btn.disabled = false;
        }
    };

    // Filter Table by Stock Dropdown inside Watchlist view
    window.onBrokerResearchStockChange = function (selectedStock) {
        _selectedStock = selectedStock || '';
        applyModalFilters();
    };

    // Filter Table by Text Search Input
    window.filterBrokerResearchTable = function (query) {
        _searchQuery = (query || '').trim();
        applyModalFilters();
    };

    // Public API: Render Embedded Section inside Fundamentals Popup
    window.renderBrokerResearchSection = async function (containerEl, symbol, companyName, forceRefresh = false) {
        if (!containerEl || !symbol) return;

        const cleanSym = typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(symbol) : symbol.replace(/\.(NS|BS|BO)$/i, '');

        if (!containerEl.querySelector('.br-loading-state')) {
            containerEl.innerHTML = `
                <div class="br-loading-state" style="text-align: center; padding: 26px 16px; color: var(--text-secondary);">
                    <div class="spinner" style="width: 24px; height: 24px; margin: 0 auto 10px; border-width: 2.5px; border-color: rgba(59,130,246,0.2); border-top-color: #3b82f6;"></div>
                    <div style="font-weight: 600; font-size: 13px; color: var(--text-primary); margin-bottom: 4px;">Loading Research Documents &amp; Reports...</div>
                    <div style="font-size: 11.5px; opacity: 0.8;">Sourcing recent verified research reports, concalls &amp; filings for ${esc(cleanSym)}</div>
                </div>
            `;
        }

        try {
            const refreshParam = forceRefresh ? '&refresh=1' : '';
            const res = await fetch(`/api/broker-research?symbol=${encodeURIComponent(symbol)}&company=${encodeURIComponent(companyName || '')}${refreshParam}`);
            const data = await res.json();
            if (data.success && data.reports && data.reports.length > 0) {
                const allReports = data.reports;
                const tabCounts = data.tab_counts || {};
                const sourcesStr = (data.allowed_sources && data.allowed_sources.length > 0) ? data.allowed_sources.join(', ') : 'trendlyne.com, screener.in, bseindia.com';
                let activeEmbeddedTab = 'all';

                containerEl.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; font-size:11.5px; color:var(--text-secondary); flex-wrap:wrap; gap:8px;">
                        <span style="font-weight:600; color:#10b981;" id="br-emb-count-${esc(cleanSym)}">✓ ${allReports.length} Verified Research Documents (PDFs &amp; Content Available)</span>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span style="opacity:0.85;">Sources: <strong>${esc(sourcesStr)}</strong></span>
                            <button type="button" class="br-refresh-btn" id="br-emb-refresh-${esc(cleanSym)}" onclick="window.renderBrokerResearchSection(document.getElementById('brokerResearchSection') ? document.getElementById('brokerResearchContent') : this.closest('.broker-research-card').querySelector('#brokerResearchContent'), '${esc(symbol)}', '${esc(companyName || '')}', true)" title="Refresh research documents" aria-label="Refresh research documents" style="width:26px; height:26px;">
                                <svg class="br-refresh-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <!-- Category Tabs Bar for Embedded Section -->
                    <div class="br-tabs-nav br-embedded-tabs" id="br-emb-tabs-${esc(cleanSym)}" style="margin-bottom: 12px; padding: 6px 0; border-bottom: 1px solid var(--border-color, rgba(148,163,184,0.15)); background: transparent;">
                        ${CATEGORY_DEFS.map(cat => {
                            const count = tabCounts[cat.id] !== undefined ? tabCounts[cat.id] : (cat.id === 'all' ? allReports.length : allReports.filter(r => r.category === cat.id).length);
                            return `
                                <button type="button" class="br-tab-btn ${cat.id === 'all' ? 'active' : ''}" data-cat="${cat.id}">
                                    <span class="br-tab-icon">${cat.icon}</span>
                                    <span class="br-tab-label">${cat.label}</span>
                                    <span class="br-tab-badge">${count}</span>
                                </button>
                            `;
                        }).join('')}
                    </div>

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
                            <tbody id="br-embedded-tbody-${esc(cleanSym)}"></tbody>
                        </table>
                    </div>
                `;

                const tbody = document.getElementById(`br-embedded-tbody-${cleanSym}`);
                const countBadge = document.getElementById(`br-emb-count-${cleanSym}`);

                function renderEmbeddedFiltered() {
                    let filtered = allReports;
                    if (activeEmbeddedTab !== 'all') {
                        filtered = filtered.filter(r => r.category === activeEmbeddedTab);
                    }
                    renderRows(filtered, tbody);
                    if (countBadge) {
                        const catObj = CATEGORY_DEFS.find(c => c.id === activeEmbeddedTab);
                        const catLabel = catObj && catObj.id !== 'all' ? catObj.label : 'All';
                        countBadge.innerText = `✓ ${filtered.length} Research Document${filtered.length === 1 ? '' : 's'} (${catLabel})`;
                    }
                }

                // Initial render
                renderEmbeddedFiltered();

                // Wire Tab Click Events
                const tabsContainer = document.getElementById(`br-emb-tabs-${cleanSym}`);
                if (tabsContainer) {
                    tabsContainer.querySelectorAll('.br-tab-btn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.preventDefault();
                            const targetCat = btn.getAttribute('data-cat');
                            activeEmbeddedTab = targetCat || 'all';
                            tabsContainer.querySelectorAll('.br-tab-btn').forEach(b => b.classList.remove('active'));
                            btn.classList.add('active');
                            renderEmbeddedFiltered();
                        });
                    });
                }

            } else {
                const sourcesStr = (data.allowed_sources && data.allowed_sources.length > 0) ? data.allowed_sources.join(', ') : 'trendlyne.com, screener.in, bseindia.com';
                containerEl.innerHTML = `
                    <div class="empty-state" style="text-align: center; padding: 28px 16px; color: var(--text-secondary); font-size: 13px;">
                        <div style="font-size: 24px; margin-bottom: 6px;">📑</div>
                        <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">No Research Documents or PDFs Available</div>
                        <div style="font-size: 12px; opacity: 0.8;">No verified PDF reports found for ${esc(cleanSym)} on configured sources (${esc(sourcesStr)}).</div>
                    </div>
                `;
            }
        } catch (e) {
            console.error('Error rendering embedded broker research:', e);
            containerEl.innerHTML = `
                <div class="empty-state" style="text-align: center; padding: 20px; color: #ef4444; font-size: 13px;">
                    Failed to load research papers.
                </div>
            `;
        }
    };

    // Public API: Open Separate AI Summary Popup Modal
    window.openBrokerResearchAiModal = async function (reportData, forceRefresh = false) {
        if (!reportData) return;
        window._currentReportForAi = reportData;

        const aiModal = ensureAiModal();
        const titleEl = aiModal.querySelector('#br-ai-title');
        const subEl = aiModal.querySelector('#br-ai-sub');
        const authorEl = aiModal.querySelector('#br-ai-report-author');
        const dateEl = aiModal.querySelector('#br-ai-report-date');
        const sourceLinkEl = aiModal.querySelector('#br-ai-source-link');
        const contentEl = aiModal.querySelector('#br-ai-content');

        if (titleEl) titleEl.innerText = `${(typeof cleanDisplaySymbol === 'function' ? cleanDisplaySymbol(reportData.symbol) : reportData.symbol) || 'Stock'} - Senior Equity Research Analyst Analysis`;
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
                    <div style="font-size:32px; margin-bottom:14px; animation: br-pulse 1.4s infinite;">✨</div>
                    <div style="font-weight:700; font-size:15px; color:var(--br-text-primary); margin-bottom: 6px;">Conducting Senior Equity Analyst Deep Audit...</div>
                    <div style="font-size:12px; opacity:0.85; max-width: 480px; margin: 0 auto; line-height: 1.5;">
                        Extracting institutional rating, price targets, valuation methodology, growth catalysts, financial performance metrics, and risk factors with Gemini AI.
                    </div>
                </div>
            `;
        }

        aiModal.style.display = 'flex';
        requestAnimationFrame(() => aiModal.classList.add('is-open'));

        // Request backend AI summary
        try {
            const reqBody = { ...reportData };
            if (forceRefresh) reqBody.refresh = 1;

            const res = await fetch('/api/broker-research/summarize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody)
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

    window.regenerateBrokerResearchAiSummary = async function () {
        if (!window._currentReportForAi) return;
        const btn = document.getElementById('br-ai-regen-btn');
        if (btn) {
            btn.disabled = true;
            btn.innerText = '⏳ Analyzing...';
        }
        try {
            await window.openBrokerResearchAiModal(window._currentReportForAi, true);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerText = '🔄 Re-Analyze';
            }
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
