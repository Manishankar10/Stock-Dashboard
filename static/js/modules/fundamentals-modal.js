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

        async function openStockNewsModal(symbol = '') {
            const modal = document.getElementById('stockNewsModal');
            const titleEl = document.getElementById('news-modal-title');
            const subtitleEl = document.getElementById('news-modal-subtitle');
            const container = document.getElementById('news-articles-container');

            const cleanSym = symbol ? symbol.trim() : '';
            titleEl.innerHTML = cleanSym ? `📰 News for <strong>${cleanSym}</strong>` : `📰 Latest Market News`;
            subtitleEl.innerText = cleanSym ? `Real-time news headlines & coverage for ${cleanSym}` : `Real-time updates for Indian Stock Market & Economy`;
            
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
                    <span class="spinning" style="display: inline-block; font-size: 24px; margin-bottom: 10px;">⏳</span><br>
                    Fetching latest live news...
                </div>
            `;

            modal.style.display = 'block';

            try {
                const url = cleanSym ? `/api/news/${encodeURIComponent(cleanSym)}` : `/api/news`;
                const res = await fetch(url);
                const data = await res.json();

                if (data.success && data.articles && data.articles.length > 0) {
                    container.innerHTML = '';
                    data.articles.forEach(art => {
                        const card = document.createElement('div');
                        card.style.cssText = `
                            background: var(--bg-subtle);
                            border: 1px solid var(--border-color);
                            border-radius: 8px;
                            padding: 14px;
                            transition: transform 0.15s ease, box-shadow 0.15s ease;
                        `;
                        
                        let timeStr = art.pub_date || '';
                        if (art.pub_date) {
                            timeStr = window.formatAppDateTime ? window.formatAppDateTime(art.pub_date) : art.pub_date;
                        }

                        card.style.cursor = 'pointer';
                        card.onclick = (e) => {
                            if (!e.target.closest('a')) {
                                window.open(art.link, '_blank', 'noopener,noreferrer');
                            }
                        };

                        card.innerHTML = `
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 6px;">
                                <a href="${art.link}" target="_blank" rel="noopener noreferrer" style="font-weight: 600; font-size: 14px; color: var(--text-primary); text-decoration: none; line-height: 1.4;" onmouseover="this.style.color='#10b981'" onmouseout="this.style.color='var(--text-primary)'">
                                    ${art.title} ↗
                                </a>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-secondary); border-top: 1px solid var(--border-color); padding-top: 8px; margin-top: 8px;">
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <span style="background: rgba(16, 185, 129, 0.1); color: #10b981; font-weight: 600; padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(16, 185, 129, 0.2);">
                                        🏢 ${art.publisher}
                                    </span>
                                    <span>🕒 ${timeStr}</span>
                                </div>
                                <a href="${art.link}" target="_blank" rel="noopener noreferrer" style="color: #10b981; font-weight: 600; text-decoration: none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">Read full story →</a>
                            </div>
                        `;
                        container.appendChild(card);
                    });
                } else {
                    container.innerHTML = `
                        <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
                            📰 No recent news articles found for ${cleanSym || 'the market'}.
                        </div>
                    `;
                }
            } catch(err) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: #ef4444;">
                        ❌ Failed to load news updates: ${err.message}
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

