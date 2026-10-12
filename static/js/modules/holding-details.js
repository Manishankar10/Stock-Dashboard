        let currentDetailHolding = null;

        function openHoldingDetailsModal(item) {
            currentDetailHolding = item;
            const sym = item.symbol;
            const info = stockPricesData[sym] || {};
            const ltp = info.price || 0;
            const dayChange = info.change || 0;
            const invAmt = item.buy_price * item.quantity;
            const curVal = ltp > 0 ? (ltp * item.quantity) : invAmt;
            const pnlAmt = curVal - invAmt;
            const pnlPct = invAmt > 0 ? (pnlAmt / invAmt) * 100 : 0;
            
            const dayPnLAmt = ltp > 0 ? dayChange * item.quantity : 0;
            const dayPnlPct = info.change_pct !== undefined ? info.change_pct : 0;

            const daysHeld = getHoldingDays(item.buy_date);
            const durationText = formatHoldingDuration(item.buy_date);
            const dateStr = formatDateFormatted(item.buy_date);
            const isLongTerm = daysHeld >= 365;

            const bInfo = getSymbolBadge(sym);

            document.getElementById('detail-modal-sym').innerHTML = `<span class="stock-symbol-title">${cleanDisplaySymbol(sym)}</span> <span class="badge ${bInfo.class}">${bInfo.label}</span> <span class="badge ${isLongTerm ? 'badge-lt' : 'badge-st'}">${isLongTerm ? 'Long Term' : 'Short Term'}</span>`;
            document.getElementById('detail-modal-name').innerText = (info.name || sym) + (item.portfolioName ? ` • 📁 ${item.portfolioName}` : '');

            document.getElementById('detail-modal-duration').innerText = `⏱️ ${durationText}`;
            document.getElementById('detail-modal-buydate').innerText = `📅 ${dateStr}`;
            document.getElementById('detail-modal-qty').innerText = formatQty(item.quantity);
            document.getElementById('detail-modal-buyprice').innerText = formatMoney(item.buy_price);
            document.getElementById('detail-modal-invested').innerText = formatMoney(invAmt);
            const curValEl = document.getElementById('detail-modal-curval');
            if (curValEl) {
                curValEl.innerHTML = ltp > 0 ? formatMoney(curVal) : '<span class="skeleton-box" style="width: 70px; height: 14px;"></span>';
            }

            const pnlSign = pnlAmt >= 0 ? '+' : '';
            const pnlEl = document.getElementById('detail-modal-pnl');
            pnlEl.innerText = isPrivacyMode 
                ? `₹ •••••• (${pnlSign}${pnlPct.toFixed(2)}%)` 
                : `${pnlSign}₹${Math.abs(pnlAmt).toLocaleString('en-IN', {minimumFractionDigits: 2})} (${pnlSign}${pnlPct.toFixed(2)}%)`;
            pnlEl.className = pnlAmt >= 0 ? 'pos' : 'neg';

            const daySign = dayPnLAmt >= 0 ? '+' : '';
            const dayPnlEl = document.getElementById('detail-modal-daypnl');
            if (dayPnlEl) {
                dayPnlEl.innerText = isPrivacyMode 
                    ? `₹ •••••• (${daySign}${dayPnlPct.toFixed(2)}%)` 
                    : `${daySign}₹${Math.abs(dayPnLAmt).toLocaleString('en-IN', {minimumFractionDigits: 2})} (${daySign}${dayPnlPct.toFixed(2)}%)`;
                dayPnlEl.className = dayPnLAmt >= 0 ? 'pos' : 'neg';
            }

            const reasonText = item.buy_reason || item.notes || 'No buy reason recorded.';
            const reasonEl = document.getElementById('detail-modal-reason');
            if (reasonEl) reasonEl.innerText = reasonText;

            const btnBuyMore = document.getElementById('btn-detail-buymore');
            if (btnBuyMore) {
                btnBuyMore.onclick = (e) => { e.stopPropagation(); closeHoldingDetailsModal(); openBuyMoreModal(sym, item.buy_price, item.portfolioName); };
            }
            const btnSell = document.getElementById('btn-detail-sell');
            if (btnSell) {
                btnSell.onclick = (e) => { e.stopPropagation(); closeHoldingDetailsModal(); openSellHoldingModal(sym, item.quantity, item.buy_price, item.portfolioName); };
            }

            const btnNews = document.getElementById('btn-detail-news');
            if (btnNews) {
                btnNews.onclick = (e) => { e.stopPropagation(); closeHoldingDetailsModal(); openStockNewsModal(sym); };
            }
            document.getElementById('btn-detail-alert').onclick = (e) => { e.stopPropagation(); closeHoldingDetailsModal(); openCreateAlertModal(sym); };
            document.getElementById('btn-detail-chart').onclick = (e) => { e.stopPropagation(); closeHoldingDetailsModal(); openInHouseChart(sym); };
            document.getElementById('btn-detail-edit').onclick = (e) => { e.stopPropagation(); closeHoldingDetailsModal(); openEditModal(sym, item.buy_price, item.quantity, item.buy_date, item.buy_reason || item.notes || '', item.portfolioName); };
            document.getElementById('btn-detail-delete').onclick = (e) => { e.stopPropagation(); closeHoldingDetailsModal(); removePortfolioStock(sym, item.portfolioName); };

            document.getElementById('holdingDetailsModal').style.display = 'block';
        }

        function closeHoldingDetailsModal() {
            document.getElementById('holdingDetailsModal').style.display = 'none';
        }

