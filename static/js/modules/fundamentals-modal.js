        // =========================================================
        // FUNDAMENTALS MODAL
        // =========================================================
        function openFundamentalsModal(symbol) {
            const modal = document.getElementById('fundamentalsModal');
            const frame = document.getElementById('fundamentalsFrame');
            const subtitle = document.getElementById('fundamentals-modal-subtitle');
            if (!modal || !frame) return;

            const safeSymbol = String(symbol || '').trim();
            if (!safeSymbol) return;

            if (subtitle) subtitle.textContent = `Loading fundamentals for ${safeSymbol}...`;
            frame.src = `/fundamentals?symbol=${encodeURIComponent(safeSymbol)}`;
            modal.style.display = 'block';
            document.body.style.overflow = 'hidden';

            frame.onload = () => {
                if (subtitle) subtitle.textContent = `Fundamental analysis • ${safeSymbol}`;
            };
        }

        function closeFundamentalsModal() {
            const modal = document.getElementById('fundamentalsModal');
            const frame = document.getElementById('fundamentalsFrame');
            if (modal) modal.style.display = 'none';
            if (frame) frame.src = 'about:blank';
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

