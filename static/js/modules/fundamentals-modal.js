        // =========================================================
        // FUNDAMENTALS MODAL
        // =========================================================
        let _fundamentalsMsgListenerAttached = false;

        function openFundamentalsModal(symbol) {
            const modal = document.getElementById('fundamentalsModal');
            const frame = document.getElementById('fundamentalsFrame');
            const subtitle = document.getElementById('fundamentals-modal-subtitle');
            const companyNameEl = document.getElementById('fundamentals-modal-company-name');
            const companyDetailsEl = document.getElementById('fundamentals-modal-company-details');
            const logoEl = document.getElementById('fundamentals-modal-logo');
            const placeholderEl = document.getElementById('fundamentals-modal-logo-placeholder');

            if (!modal || !frame) return;

            const safeSymbol = String(symbol || '').trim();
            if (!safeSymbol) return;

            const cleanSym = safeSymbol.replace(/\.(NS|BO)$/i, '').toUpperCase();
            let _currentModalSymbol = safeSymbol;

            // Reset logo & placeholder with clean stock monogram
            if (logoEl) {
                logoEl.src = '';
                logoEl.style.display = 'none';
            }
            if (placeholderEl) {
                placeholderEl.textContent = cleanSym.slice(0, 3);
                placeholderEl.style.display = 'flex';
            }
            const webLogoEl = document.getElementById('fundamentals-modal-logo-web');
            const webLogoPhEl = document.getElementById('fundamentals-modal-logo-web-placeholder');
            const webNameEl = document.getElementById('fundamentals-modal-web-name');
            const updatedEl = document.getElementById('fundamentals-modal-updated');
            const screenerBtnEl = document.getElementById('fundamentals-modal-screener-btn');

            if (webLogoEl) {
                webLogoEl.src = '';
                webLogoEl.style.display = 'none';
            }
            if (webLogoPhEl) {
                webLogoPhEl.textContent = cleanSym.slice(0, 3);
                webLogoPhEl.style.display = 'flex';
            }
            if (webNameEl) {
                webNameEl.textContent = safeSymbol;
            }
            if (subtitle) {
                subtitle.textContent = `${safeSymbol} · SCREENER.IN DIRECT REPLICA`;
            }
            if (updatedEl) {
                updatedEl.textContent = 'Updating...';
            }
            if (screenerBtnEl) {
                screenerBtnEl.href = `https://www.screener.in/company/${encodeURIComponent(cleanSym)}/`;
            }

            // Prefill with stock symbol and live price if available
            if (companyNameEl) companyNameEl.textContent = safeSymbol;
            let initialDetails = `${safeSymbol} · NSE`;
            try {
                const stock = (window.stockPricesData && window.stockPricesData[safeSymbol]) || null;
                if (stock && stock.current_price != null) {
                    const p = Number(stock.current_price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    const chg = Number(stock.change_percent || 0);
                    const sign = chg >= 0 ? '+' : '';
                    initialDetails = `${safeSymbol} · ₹${p} (${sign}${chg.toFixed(2)}%)`;
                }
            } catch (e) {}
            if (companyDetailsEl) companyDetailsEl.textContent = initialDetails;

            frame.src = `/fundamentals?symbol=${encodeURIComponent(safeSymbol)}`;
            modal.style.display = 'block';
            document.body.style.overflow = 'hidden';

            frame.onload = () => {
                if (subtitle && !subtitle.textContent.includes('SCREENER.IN DIRECT REPLICA')) {
                    subtitle.textContent = `${safeSymbol} · SCREENER.IN DIRECT REPLICA`;
                }
            };

            // Attach one-time postMessage listener to receive full company name and logo from iframe
            if (!_fundamentalsMsgListenerAttached) {
                window.addEventListener('message', (event) => {
                    if (event.data && event.data.type === 'FUNDAMENTALS_INFO') {
                        const { name, symbol: retSym, logo, price, changePercent, updatedAt, screenerUrl } = event.data;
                        const nEl = document.getElementById('fundamentals-modal-company-name');
                        const dEl = document.getElementById('fundamentals-modal-company-details');
                        const lEl = document.getElementById('fundamentals-modal-logo');
                        const pEl = document.getElementById('fundamentals-modal-logo-placeholder');
                        const wLogoEl = document.getElementById('fundamentals-modal-logo-web');
                        const wLogoPhEl = document.getElementById('fundamentals-modal-logo-web-placeholder');
                        const wNameEl = document.getElementById('fundamentals-modal-web-name');
                        const subEl = document.getElementById('fundamentals-modal-subtitle');
                        const uEl = document.getElementById('fundamentals-modal-updated');
                        const scrEl = document.getElementById('fundamentals-modal-screener-btn');

                        const dispSymbol = retSym || _currentModalSymbol;

                        if (nEl && name) {
                            nEl.textContent = name;
                        }
                        if (wNameEl && name) {
                            wNameEl.textContent = name;
                        }
                        if (subEl) {
                            subEl.textContent = `${dispSymbol} · SCREENER.IN DIRECT REPLICA`;
                        }
                        if (uEl) {
                            uEl.textContent = updatedAt || ('Updated ' + new Date().toLocaleTimeString());
                        }
                        if (scrEl) {
                            if (screenerUrl) {
                                scrEl.href = screenerUrl;
                            } else {
                                const bSym = String(dispSymbol).replace(/\.(NS|BO)$/i, '');
                                scrEl.href = `https://www.screener.in/company/${encodeURIComponent(bSym)}/`;
                            }
                        }

                        if (dEl) {
                            let det = dispSymbol;
                            if (price != null && price !== '') {
                                const chg = changePercent != null && !isNaN(Number(changePercent)) ? Number(changePercent) : null;
                                const sign = (chg != null && chg >= 0) ? '+' : '';
                                det += ` · ₹${price}${chg != null ? ` (${sign}${chg.toFixed(2)}%)` : ''}`;
                            } else {
                                det += ' · Screener.in';
                            }
                            dEl.textContent = det;
                        }
                        if (logo) {
                            if (lEl) {
                                lEl.src = logo;
                                lEl.style.display = 'block';
                            }
                            if (wLogoEl) {
                                wLogoEl.src = logo;
                                wLogoEl.style.display = 'block';
                            }
                            if (pEl) pEl.style.display = 'none';
                            if (wLogoPhEl) wLogoPhEl.style.display = 'none';
                        } else {
                            const dispSym = (dispSymbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
                            if (pEl) {
                                pEl.textContent = dispSym.slice(0, 3) || 'STK';
                                pEl.style.display = 'flex';
                            }
                            if (wLogoPhEl) {
                                wLogoPhEl.textContent = dispSym.slice(0, 3) || 'STK';
                                wLogoPhEl.style.display = 'flex';
                            }
                            if (lEl) lEl.style.display = 'none';
                            if (wLogoEl) wLogoEl.style.display = 'none';
                        }
                    }
                });
                _fundamentalsMsgListenerAttached = true;
            }
        }

        function refreshFundamentalsModal() {
            const frame = document.getElementById('fundamentalsFrame');
            if (!frame) return;
            const uEl = document.getElementById('fundamentals-modal-updated');
            if (uEl) uEl.textContent = 'Updating...';
            try {
                if (frame.contentWindow && typeof frame.contentWindow.loadFundamentals === 'function') {
                    frame.contentWindow.loadFundamentals();
                    return;
                }
            } catch (e) {}
            // Fallback: reload frame
            const currentSrc = frame.src;
            frame.src = 'about:blank';
            setTimeout(() => { frame.src = currentSrc; }, 50);
        }

        function closeFundamentalsModal() {
            const modal = document.getElementById('fundamentalsModal');
            const frame = document.getElementById('fundamentalsFrame');
            const logoEl = document.getElementById('fundamentals-modal-logo');
            const placeholderEl = document.getElementById('fundamentals-modal-logo-placeholder');
            if (modal) modal.style.display = 'none';
            if (frame) frame.src = 'about:blank';
            if (logoEl) {
                logoEl.src = '';
                logoEl.style.display = 'none';
            }
            const webLogoEl = document.getElementById('fundamentals-modal-logo-web');
            if (webLogoEl) {
                webLogoEl.src = '';
                webLogoEl.style.display = 'none';
            }
            if (placeholderEl) {
                placeholderEl.style.display = 'flex';
                placeholderEl.textContent = '';
            }
            document.body.style.overflow = '';
        }

        const stockNewsState = {
            symbol: '',
            allArticles: [],
            displayedCount: 0,
            pageSize: 15,
            isLoadingMore: false,
            fetchedMax: false
        };

        function getArticleTimestamp(art) {
            if (!art || !art.pub_date) return 0;
            const ts = Date.parse(art.pub_date);
            return isNaN(ts) ? 0 : ts;
        }

        function renderStockNewsCard(art) {
            const escapeHtml = (str) => {
                if (!str) return '';
                return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            };

            const card = document.createElement('div');
            card.className = 'stock-news-card';
            card.style.cssText = `
                background: var(--bg-subtle);
                border: 1px solid var(--border-color);
                border-radius: 8px;
                padding: 13px 14px;
                transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
                cursor: pointer;
            `;

            let timeStr = art.pub_date || '';
            if (art.pub_date) {
                timeStr = window.formatAppDateTime ? window.formatAppDateTime(art.pub_date) : art.pub_date;
            }

            card.onmouseenter = () => {
                card.style.borderColor = 'var(--accent-primary, #10b981)';
                card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
            };
            card.onmouseleave = () => {
                card.style.borderColor = 'var(--border-color)';
                card.style.boxShadow = 'none';
            };

            card.onclick = (e) => {
                if (!e.target.closest('a')) {
                    window.open(art.link, '_blank', 'noopener,noreferrer');
                }
            };

            const catBadge = art.category && art.category !== 'GENERAL'
                ? `<span style="background: rgba(59, 130, 246, 0.1); color: #3b82f6; font-weight: 600; padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(59, 130, 246, 0.2); font-size: 10px;">🏷️ ${escapeHtml(art.category)}</span>`
                : '';

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 6px;">
                    <a href="${art.link}" target="_blank" rel="noopener noreferrer" style="font-weight: 600; font-size: 13.5px; color: var(--text-primary); text-decoration: none; line-height: 1.4;" onmouseover="this.style.color='#10b981'" onmouseout="this.style.color='var(--text-primary)'">
                        ${escapeHtml(art.title)} ↗
                    </a>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-secondary); border-top: 1px solid var(--border-color); padding-top: 8px; margin-top: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span style="background: rgba(16, 185, 129, 0.1); color: #10b981; font-weight: 600; padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(16, 185, 129, 0.2);">
                            🏢 ${escapeHtml(art.publisher)}
                        </span>
                        ${catBadge}
                        <span>🕒 ${escapeHtml(timeStr)}</span>
                    </div>
                    <a href="${art.link}" target="_blank" rel="noopener noreferrer" style="color: #10b981; font-weight: 600; text-decoration: none; white-space: nowrap;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">Read full story →</a>
                </div>
            `;
            return card;
        }

        function updateStockNewsLoadMoreUI() {
            const inlineWrap = document.getElementById('stock-news-inline-load-more-wrap');
            const inlineBtn = document.getElementById('btn-inline-load-more-stock-news');
            if (!inlineWrap || !inlineBtn) return;

            const total = stockNewsState.allArticles.length;
            const shown = stockNewsState.displayedCount;
            const hasMore = shown < total || !stockNewsState.fetchedMax;

            if (hasMore) {
                inlineWrap.style.display = 'block';
                inlineBtn.disabled = stockNewsState.isLoadingMore;
                inlineBtn.innerHTML = stockNewsState.isLoadingMore 
                    ? '⏳ Loading Stories...' 
                    : '📥 Load More Stories';
            } else {
                inlineWrap.style.display = total > 0 ? 'block' : 'none';
                inlineBtn.disabled = true;
                inlineBtn.innerHTML = '✨ All Latest News Loaded';
                inlineBtn.style.opacity = '0.75';
                inlineBtn.style.cursor = 'default';
            }
        }

        function renderNextStockNewsBatch(append = true) {
            const container = document.getElementById('news-articles-container');
            if (!container) return;

            const oldInline = document.getElementById('stock-news-inline-load-more-wrap');
            if (oldInline) oldInline.remove();

            if (!append) {
                container.innerHTML = '';
                stockNewsState.displayedCount = 0;
            }

            const startIndex = stockNewsState.displayedCount;
            const endIndex = Math.min(startIndex + stockNewsState.pageSize, stockNewsState.allArticles.length);

            for (let i = startIndex; i < endIndex; i++) {
                container.appendChild(renderStockNewsCard(stockNewsState.allArticles[i]));
            }

            stockNewsState.displayedCount = endIndex;

            const hasMore = stockNewsState.displayedCount < stockNewsState.allArticles.length || !stockNewsState.fetchedMax;
            if (hasMore || stockNewsState.displayedCount > 0) {
                const inlineWrap = document.createElement('div');
                inlineWrap.id = 'stock-news-inline-load-more-wrap';
                inlineWrap.style.cssText = 'text-align: center; padding: 14px 0 8px; margin-top: 4px;';
                inlineWrap.innerHTML = `
                    <button type="button" id="btn-inline-load-more-stock-news" class="btn-primary" onclick="loadMoreStockNews()" style="font-size: 12.5px; padding: 8px 22px; border-radius: 8px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                        📥 Load More Stories
                    </button>
                `;
                container.appendChild(inlineWrap);
            }

            updateStockNewsLoadMoreUI();
        }

        async function loadMoreStockNews() {
            if (stockNewsState.isLoadingMore) return;
            stockNewsState.isLoadingMore = true;
            updateStockNewsLoadMoreUI();

            const cleanSym = stockNewsState.symbol;

            // 1. If we already have unrendered articles in memory, render next 15
            if (stockNewsState.displayedCount < stockNewsState.allArticles.length) {
                setTimeout(() => {
                    renderNextStockNewsBatch(true);
                    stockNewsState.isLoadingMore = false;
                    updateStockNewsLoadMoreUI();
                }, 100);
                return;
            }

            // 2. If all local articles are rendered and haven't fetched max yet, fetch older news archive (window=90d)
            if (!stockNewsState.fetchedMax) {
                try {
                    const url = cleanSym 
                        ? `/api/insights/news?stock=${encodeURIComponent(cleanSym)}&scope=all&category=all&limit=150&window=90d` 
                        : `/api/insights/news?scope=all&category=all&limit=150&window=90d`;
                    
                    const res = await fetch(url);
                    const data = await res.json();
                    
                    const existingTitles = new Set(stockNewsState.allArticles.map(a => (a.title || '').trim().toLowerCase()));
                    let added = 0;

                    if (data.success && Array.isArray(data.articles)) {
                        data.articles.forEach(art => {
                            const key = (art.title || '').trim().toLowerCase();
                            if (key && !existingTitles.has(key)) {
                                existingTitles.add(key);
                                stockNewsState.allArticles.push(art);
                                added++;
                            }
                        });
                    }

                    // Sort newly merged list strictly by date descending
                    stockNewsState.allArticles.sort((a, b) => getArticleTimestamp(b) - getArticleTimestamp(a));
                    stockNewsState.fetchedMax = true;

                    if (added > 0) {
                        renderNextStockNewsBatch(true);
                    }
                } catch (e) {
                    console.warn('Error fetching older stock news:', e);
                    stockNewsState.fetchedMax = true;
                }
            }

            stockNewsState.isLoadingMore = false;
            updateStockNewsLoadMoreUI();
        }

        async function openStockNewsModal(symbol = '') {
            const modal = document.getElementById('stockNewsModal');
            const titleEl = document.getElementById('news-modal-title');
            const subtitleEl = document.getElementById('news-modal-subtitle');
            const container = document.getElementById('news-articles-container');

            const cleanSym = symbol ? symbol.trim() : '';
            stockNewsState.symbol = cleanSym;
            stockNewsState.allArticles = [];
            stockNewsState.displayedCount = 0;
            stockNewsState.pageSize = 15;
            stockNewsState.isLoadingMore = false;
            stockNewsState.fetchedMax = false;

            titleEl.innerHTML = cleanSym ? `📰 News for <strong>${cleanSym}</strong>` : `📰 Latest Market News`;
            subtitleEl.innerText = cleanSym ? `Real-time news headlines & coverage for ${cleanSym}` : `Real-time updates for Indian Stock Market & Economy`;
            
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
                    <span class="spinning" style="display: inline-block; font-size: 24px; margin-bottom: 10px;">⏳</span><br>
                    Fetching latest live news...
                </div>
            `;

            modal.style.display = 'block';

            const escapeHtml = (str) => {
                if (!str) return '';
                return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            };

            try {
                const insightsUrl = cleanSym 
                    ? `/api/insights/news?stock=${encodeURIComponent(cleanSym)}&scope=all&category=all&limit=150` 
                    : `/api/insights/news?scope=all&category=all&limit=150`;

                const fetches = [fetch(insightsUrl).then(r => r.json()).catch(() => ({ success: false, articles: [] }))];
                if (cleanSym) {
                    fetches.push(fetch(`/api/news/${encodeURIComponent(cleanSym)}`).then(r => r.json()).catch(() => ({ success: false, articles: [] })));
                }

                const results = await Promise.all(fetches);
                const seenTitles = new Set();
                const combined = [];

                results.forEach(res => {
                    if (res && res.success && Array.isArray(res.articles)) {
                        res.articles.forEach(art => {
                            const key = (art.title || '').trim().toLowerCase();
                            if (key && !seenTitles.has(key)) {
                                seenTitles.add(key);
                                combined.push(art);
                            }
                        });
                    }
                });

                // Strict date sorting (newest first)
                combined.sort((a, b) => getArticleTimestamp(b) - getArticleTimestamp(a));
                stockNewsState.allArticles = combined;

                if (stockNewsState.allArticles.length > 0) {
                    renderNextStockNewsBatch(false);
                } else {
                    container.innerHTML = `
                        <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
                            📰 No recent news articles found for ${escapeHtml(cleanSym) || 'the market'}.
                        </div>
                    `;
                }
            } catch(err) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: #ef4444;">
                        ❌ Failed to load news updates: ${escapeHtml(err.message)}
                    </div>
                `;
            }
        }

        function closeStockNewsModal() {
            document.getElementById('stockNewsModal').style.display = 'none';
        }

        window.openFundamentalsModal = openFundamentalsModal;
        window.closeFundamentalsModal = closeFundamentalsModal;
        window.openStockNewsModal = openStockNewsModal;
        window.closeStockNewsModal = closeStockNewsModal;
        window.loadMoreStockNews = loadMoreStockNews;

