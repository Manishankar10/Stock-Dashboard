        // =========================================================
        // PRICE ALERTS & NOTIFICATIONS LOGIC (DB PERSISTED)
        // =========================================================
        let userAlertsData = { alerts: [], notifications: [] };
        let activeNotifTab = 'notifs';

        async function fetchAlerts() {
            try {
                const res = await fetch('/api/alerts');
                if (res.ok) {
                    userAlertsData = await res.json();
                    updateNotificationBadge();
                    const notifModal = document.getElementById('notificationsModal');
                    if (notifModal && notifModal.style.display === 'block') {
                        renderNotificationsModalContent();
                    }
                }
            } catch(e) {
                console.error('Error fetching alerts:', e);
            }
        }

        function updateNotificationBadge() {
            const notifs = userAlertsData.notifications || [];
            const unreadCount = notifs.filter(n => !n.read).length;
            const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);
            ['sidebar-notif-badge', 'mobile-notif-badge', 'notif-badge'].forEach(id => {
                const badge = document.getElementById(id);
                if (badge) {
                    if (unreadCount > 0) {
                        badge.innerText = badgeText;
                        badge.style.display = 'inline-block';
                    } else {
                        badge.style.display = 'none';
                    }
                }
            });
        }

        function openStockChartSafely(symbol) {
            if (!symbol) return;
            const cleanSym = symbol.replace(/\.(NS|BO)$/i, '').toUpperCase().trim();
            if (typeof window.openInHouseChart === 'function') {
                window.openInHouseChart(cleanSym);
            } else if (typeof window.openChart === 'function') {
                window.openChart(cleanSym);
            } else if (typeof openInHouseChart === 'function') {
                openInHouseChart(cleanSym);
            } else if (typeof openChart === 'function') {
                openChart(cleanSym);
            }
            const chartM = document.getElementById('chartModal') || document.getElementById('chart-modal');
            if (chartM && typeof window.bringModalToFront === 'function') {
                window.bringModalToFront(chartM);
            }
        }
        window.openStockChartSafely = openStockChartSafely;

        function updateCreateAlertChartLinkVisibility() {
            const symInput = document.getElementById('modal-alert-symbol');
            const linkWrap = document.getElementById('createAlertChartLinkWrap');
            if (symInput && linkWrap) {
                const val = symInput.value.trim();
                linkWrap.style.display = val ? 'inline' : 'none';
            }
        }
        window.updateCreateAlertChartLinkVisibility = updateCreateAlertChartLinkVisibility;

        function openChartFromCreateAlertModal() {
            const symInput = document.getElementById('modal-alert-symbol');
            const sym = (symInput ? symInput.value : '').trim().toUpperCase();
            if (sym) {
                openStockChartSafely(sym);
            }
        }
        window.openChartFromCreateAlertModal = openChartFromCreateAlertModal;

        function openCreateAlertModal(symbol = '', customPrice = null) {
            let sym = symbol || (typeof currentDetailHolding !== 'undefined' && currentDetailHolding ? currentDetailHolding.symbol : '') || (typeof currentChartSymbol !== 'undefined' && currentChartSymbol ? currentChartSymbol : '');
            sym = (sym || '').trim().toUpperCase();
            
            const symInput = document.getElementById('modal-alert-symbol');
            const chartLinkWrap = document.getElementById('createAlertChartLinkWrap');
            if (symInput) {
                symInput.value = sym;
                if (sym) {
                    symInput.readOnly = true;
                    symInput.style.background = 'var(--bg-subtle, #1e222d)';
                    if (chartLinkWrap) chartLinkWrap.style.display = 'inline';
                } else {
                    symInput.readOnly = false;
                    symInput.style.background = 'var(--input-bg, #1a1e29)';
                    if (chartLinkWrap) chartLinkWrap.style.display = 'none';
                    setTimeout(() => symInput.focus(), 80);
                }
            }

            const stockInfo = (typeof stockPricesData !== 'undefined' && sym && stockPricesData[sym]) ? stockPricesData[sym] : {};
            const valToSet = (customPrice !== null && customPrice !== undefined && customPrice !== '') ? customPrice : (stockInfo.price || '');
            const priceInput = document.getElementById('modal-alert-price');
            if (priceInput) priceInput.value = valToSet;

            const noteInput = document.getElementById('modal-alert-note');
            if (noteInput) noteInput.value = '';

            const modal = document.getElementById('createAlertModal');
            if (modal) {
                modal.style.display = 'block';
                if (typeof window.bringModalToFront === 'function') {
                    window.bringModalToFront('createAlertModal');
                }
            }
        }

        function closeCreateAlertModal() {
            const modal = document.getElementById('createAlertModal');
            if (modal) modal.style.display = 'none';
        }

        window.openCreateAlertModal = openCreateAlertModal;
        window.closeCreateAlertModal = closeCreateAlertModal;

        async function submitCreateAlert() {
            const symInput = document.getElementById('modal-alert-symbol');
            let symbol = (symInput ? symInput.value : '').trim().toUpperCase();
            const condition = document.getElementById('modal-alert-condition').value;
            const target_price = parseFloat(document.getElementById('modal-alert-price').value);
            const note = document.getElementById('modal-alert-note').value.trim();

            if (!symbol) {
                alert('Please enter a stock symbol (e.g. TCS, RELIANCE)');
                if (symInput) symInput.focus();
                return;
            }

            if (isNaN(target_price) || target_price <= 0) {
                alert('Please enter a valid target price greater than 0!');
                const pInput = document.getElementById('modal-alert-price');
                if (pInput) pInput.focus();
                return;
            }

            try {
                const res = await fetch('/api/alerts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbol, condition, target_price, note })
                });
                const data = await res.json();
                if (data.success) {
                    userAlertsData = data.alerts_data;
                    closeCreateAlertModal();
                    updateNotificationBadge();
                    renderNotificationsModalContent();
                    if (typeof showToast === 'function') {
                        showToast(`🎯 Price alert set for ${symbol} at ₹${target_price}`, 'success');
                    } else {
                        alert(`🎯 Price alert set for ${symbol} at ₹${target_price}!`);
                    }
                } else {
                    alert(data.error || 'Failed to create alert');
                }
            } catch (err) {
                console.error('Error creating alert:', err);
                alert('Failed to set price alert. Please check your connection.');
            }
        }

        async function deleteAlert(alertId) {
            let confirmed = false;
            try {
                if (typeof showCustomConfirm === 'function') {
                    confirmed = await showCustomConfirm({ 
                        title: 'Delete Price Alert', 
                        message: 'Are you sure you want to delete this price alert?', 
                        isDanger: true,
                        confirmText: 'Delete Alert'
                    });
                } else {
                    const confirmFn = window.nativeConfirm || window.confirm;
                    confirmed = confirmFn('Are you sure you want to delete this price alert?');
                }
            } catch (e) {
                const confirmFn = window.nativeConfirm || window.confirm;
                confirmed = confirmFn('Are you sure you want to delete this price alert?');
            }
            if (!confirmed) return;

            try {
                const res = await fetch(`/api/alerts/${encodeURIComponent(alertId)}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    if (typeof showToast === 'function') showToast('Price alert deleted', 'info');
                    userAlertsData = data.alerts_data;
                    updateNotificationBadge();
                    renderNotificationsModalContent();
                } else {
                    alert(data.error || 'Failed to delete alert');
                }
            } catch (err) {
                console.error('Delete alert error:', err);
            }
        }

        async function openNotificationsModal() {
            if (window.CapitalDeskPush) {
                window.CapitalDeskPush.checkCurrentSubscription();
            }
            await fetchAlerts();
            const notifModal = document.getElementById('notificationsModal');
            if (notifModal) {
                notifModal.style.display = 'block';
                if (typeof window.bringModalToFront === 'function') {
                    window.bringModalToFront('notificationsModal');
                }
            }
            switchNotifTab(activeNotifTab);
            fetch('/api/notifications/mark_read', { method: 'POST' }).then(r => r.json()).then(data => {
                if (data.success) {
                    userAlertsData = data.alerts_data;
                    updateNotificationBadge();
                }
            }).catch(e => {});
        }

        function closeNotificationsModal() {
            const notifModal = document.getElementById('notificationsModal');
            if (notifModal) notifModal.style.display = 'none';
        }

        function switchNotifTab(tab) {
            activeNotifTab = tab;
            const notifModal = document.getElementById('notificationsModal');
            if (notifModal) notifModal.setAttribute('data-tab', tab);
            const btnNotifs = document.getElementById('notif-tab-btn-notifs');
            const btnAlerts = document.getElementById('notif-tab-btn-alerts');
            const contentNotifs = document.getElementById('notif-tab-content-notifs');
            const contentAlerts = document.getElementById('notif-tab-content-alerts');

            if (tab === 'notifs') {
                if (btnNotifs) btnNotifs.classList.add('active');
                if (btnAlerts) btnAlerts.classList.remove('active');
                if (contentNotifs) {
                    contentNotifs.classList.remove('hidden');
                    contentNotifs.style.setProperty('display', 'flex', 'important');
                    contentNotifs.style.setProperty('flex-direction', 'column', 'important');
                }
                if (contentAlerts) {
                    contentAlerts.classList.add('hidden');
                    contentAlerts.style.setProperty('display', 'none', 'important');
                }
                const clearAllWebBtn = document.getElementById('notif-clear-all-btn-web');
                if (clearAllWebBtn) clearAllWebBtn.style.setProperty('display', '', '');
            } else {
                if (btnAlerts) btnAlerts.classList.add('active');
                if (btnNotifs) btnNotifs.classList.remove('active');
                if (contentAlerts) {
                    contentAlerts.classList.remove('hidden');
                    contentAlerts.style.setProperty('display', 'block', 'important');
                }
                if (contentNotifs) {
                    contentNotifs.classList.add('hidden');
                    contentNotifs.style.setProperty('display', 'none', 'important');
                }
                const clearAllWebBtn = document.getElementById('notif-clear-all-btn-web');
                if (clearAllWebBtn) clearAllWebBtn.style.setProperty('display', 'none', 'important');
            }
            renderNotificationsModalContent();
        }

        function renderNotificationsModalContent() {
            const notifs = userAlertsData.notifications || [];
            const alerts = userAlertsData.alerts || [];

            const notifLabel = document.getElementById('notif-count-label');
            const alertsLabel = document.getElementById('alerts-count-label');
            if (notifLabel) notifLabel.innerText = notifs.length;
            if (alertsLabel) alertsLabel.innerText = alerts.length;

            const clearAllWebBtn = document.getElementById('notif-clear-all-btn-web');
            if (clearAllWebBtn && activeNotifTab === 'notifs') {
                if (notifs.length === 0) {
                    clearAllWebBtn.style.opacity = '0.5';
                    clearAllWebBtn.style.pointerEvents = 'none';
                } else {
                    clearAllWebBtn.style.opacity = '1';
                    clearAllWebBtn.style.pointerEvents = 'auto';
                }
            }

            // Render Notifications Tab
            const notifMount = document.getElementById('notifications-list-mount');
            if (notifMount) {
                if (notifs.length === 0) {
                    notifMount.innerHTML = `
                        <div style="text-align:center; padding:40px 20px; color:var(--text-secondary);">
                            <div style="font-size:32px; margin-bottom:10px;">🔔</div>
                            <div style="font-weight:600; font-size:14px; color:var(--text-primary); margin-bottom:4px;">No Triggered Notifications</div>
                            <div style="font-size:12px; color:var(--text-muted);">You will see notifications here when stocks cross your target price thresholds.</div>
                        </div>
                    `;
                } else {
                    let html = '';
                    notifs.forEach(n => {
                        let sym = (n.symbol || '').trim().toUpperCase();
                        if (!sym && n.title) {
                            const m = n.title.match(/[:\s]([A-Za-z0-9_\-]+)$/);
                            if (m) sym = m[1].toUpperCase();
                        }
                        const chartBtnHtml = sym ? `
                            <button type="button" class="btn-secondary" style="padding:5px 9px; font-size:11.5px; display:inline-flex; align-items:center; gap:4px; cursor:pointer; border-radius:6px; font-weight:600;" onclick="openStockChartSafely('${escapeHtml(sym)}')" title="Open Interactive Chart for ${escapeHtml(sym)}">
                                <span>📊</span> <span>Chart</span>
                            </button>
                        ` : '';
                        const symLinkTitle = sym ? `
                            <a href="javascript:void(0)" onclick="openStockChartSafely('${escapeHtml(sym)}')" class="alert-stock-link" style="color:var(--accent, #10b981); text-decoration:none; display:inline-flex; align-items:center; gap:5px; font-weight:700; cursor:pointer;" title="Click to open chart for ${escapeHtml(sym)}">
                                <span>${escapeHtml(n.title)}</span>
                                <span style="font-size:12px; opacity:0.85;">📈</span>
                            </a>
                        ` : escapeHtml(n.title);

                        html += `
                            <div class="notif-item-card" style="background:var(--bg-subtle, #1e222d); border:1px solid var(--border-color, #334155); border-radius:8px; padding:12px 14px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
                                <div style="flex:1; min-width:200px;">
                                    <div style="font-weight:700; font-size:13.5px; color:var(--text-primary); margin-bottom:4px;">${symLinkTitle}</div>
                                    <div style="font-size:12.5px; color:var(--text-secondary); margin-bottom:6px;">${escapeHtml(n.message)}</div>
                                    <div style="font-size:10.5px; color:var(--text-muted);">${window.formatAppDateTime ? window.formatAppDateTime(n.created_at) : n.created_at}</div>
                                </div>
                                <div style="display:flex; align-items:center; gap:8px; margin-left:auto;">
                                    ${chartBtnHtml}
                                    <button type="button" class="btn-danger" style="padding:5px 9px; font-size:12px; border-radius:6px; cursor:pointer;" onclick="deleteNotification('${n.id}')" title="Delete Notification">🗑️</button>
                                </div>
                            </div>
                        `;
                    });
                    notifMount.innerHTML = html;
                }
            }

            // Render Active Alerts Tab
            const alertsMount = document.getElementById('alerts-list-mount');
            if (alertsMount) {
                if (alerts.length === 0) {
                    alertsMount.innerHTML = `
                        <div style="text-align:center; padding:35px 20px; color:var(--text-secondary);">
                            <div style="font-size:32px; margin-bottom:10px;">🎯</div>
                            <div style="font-weight:600; font-size:14px; color:var(--text-primary); margin-bottom:6px;">No Price Alerts Active</div>
                            <div style="font-size:12.5px; margin-bottom:16px;">Set target price alerts to receive instant notifications when stocks cross key technical levels.</div>
                            <button class="btn-primary" style="padding:6px 16px; font-size:12px;" onclick="openCreateAlertModal()">+ Create Your First Alert</button>
                        </div>
                    `;
                } else {
                    let html = '';
                    alerts.forEach(a => {
                        const sym = (a.symbol || '').trim().toUpperCase();
                        const condText = a.condition === 'above' ? '≥ (Crosses Above)' : '≤ (Crosses Below)';
                        const statusBadge = a.status === 'triggered' 
                            ? '<span class="badge" style="background:#fef3c7; color:#d97706; border:1px solid #fde68a;">Triggered</span>' 
                            : '<span class="badge" style="background:#ecfdf5; color:#059669; border:1px solid #a7f3d0;">Active</span>';
                        html += `
                            <div class="alert-item-card" style="background:var(--bg-subtle, #1e222d); border:1px solid var(--border-color, #334155); border-radius:8px; padding:12px 14px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
                                <div>
                                    <div style="font-weight:700; font-size:14px; color:var(--text-primary); display:flex; align-items:center; gap:8px;">
                                        <a href="javascript:void(0)" onclick="openStockChartSafely('${escapeHtml(sym)}')" class="alert-stock-link" style="color:var(--accent, #10b981); text-decoration:none; display:inline-flex; align-items:center; gap:5px; font-weight:700; cursor:pointer;" title="Click to open interactive chart for ${escapeHtml(sym)}">
                                            <span>${escapeHtml(sym)}</span>
                                            <span style="font-size:12px; opacity:0.85;">📈</span>
                                        </a>
                                        ${statusBadge}
                                    </div>
                                    <div style="font-size:12.5px; color:var(--text-secondary); margin-top:3px;">
                                        Target: <strong>₹${parseFloat(a.target_price).toLocaleString('en-IN', {minimumFractionDigits:2})}</strong> (${condText})
                                    </div>
                                    ${a.note ? `<div style="font-size:11.5px; color:var(--text-muted); margin-top:2px; font-style:italic;">Note: ${escapeHtml(a.note)}</div>` : ''}
                                    <div style="font-size:10.5px; color:var(--text-muted); margin-top:4px;">Created: ${window.formatAppDateTime ? window.formatAppDateTime(a.created_at) : a.created_at}</div>
                                </div>
                                <div style="display:flex; align-items:center; gap:8px; margin-left:auto;">
                                    <button type="button" class="btn-secondary" style="padding:6px 11px; font-size:12px; display:inline-flex; align-items:center; gap:5px; font-weight:600; cursor:pointer; border-radius:6px;" onclick="openStockChartSafely('${escapeHtml(sym)}')" title="Open Interactive Chart for ${escapeHtml(sym)}">
                                        <span>📊</span> <span>Chart</span>
                                    </button>
                                    <button type="button" class="btn-danger" style="padding:6px 11px; font-size:12px; display:inline-flex; align-items:center; gap:4px; cursor:pointer; border-radius:6px;" onclick="deleteAlert('${a.id}')" title="Delete Alert">
                                        <span>🗑️</span> <span>Delete</span>
                                    </button>
                                </div>
                            </div>
                        `;
                    });
                    alertsMount.innerHTML = html;
                }
            }
        }

        async function deleteNotification(notifId) {
            try {
                const res = await fetch(`/api/notifications/${encodeURIComponent(notifId)}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    userAlertsData = data.alerts_data;
                    updateNotificationBadge();
                    renderNotificationsModalContent();
                } else {
                    alert(data.error || 'Failed to delete notification');
                }
            } catch (err) {
                console.error('Delete notification error:', err);
            }
        }

        async function clearAllNotifications() {
            let confirmed = false;
            try {
                if (typeof showCustomConfirm === 'function') {
                    confirmed = await showCustomConfirm({ 
                        title: 'Clear Notifications', 
                        message: 'Are you sure you want to clear all notification history?', 
                        isDanger: true,
                        confirmText: 'Clear All'
                    });
                } else {
                    const confirmFn = window.nativeConfirm || window.confirm;
                    confirmed = confirmFn('Are you sure you want to clear all notification history?');
                }
            } catch (e) {
                const confirmFn = window.nativeConfirm || window.confirm;
                confirmed = confirmFn('Are you sure you want to clear all notification history?');
            }
            if (!confirmed) return;

            try {
                const res = await fetch('/api/notifications/clear_all', { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    if (typeof showToast === 'function') showToast('Notification history cleared', 'info');
                    userAlertsData = data.alerts_data;
                    updateNotificationBadge();
                    renderNotificationsModalContent();
                } else {
                    alert(data.error || 'Failed to clear notifications');
                }
            } catch (err) {
                console.error('Clear notifications error:', err);
            }
        }

        window.deleteAlert = deleteAlert;
        window.deleteNotification = deleteNotification;
        window.clearAllNotifications = clearAllNotifications;
        window.switchNotifTab = switchNotifTab;
        window.openNotificationsModal = openNotificationsModal;
        window.closeNotificationsModal = closeNotificationsModal;
        window.renderNotificationsModalContent = renderNotificationsModalContent;
        window.fetchAlerts = fetchAlerts;
        window.submitCreateAlert = submitCreateAlert;

        window.onclick = function(event) {
            const modal = document.getElementById('chartModal');
            const editModal = document.getElementById('editHoldingModal');
            const detailModal = document.getElementById('holdingDetailsModal');
            const createWlModal = document.getElementById('createWatchlistModal');
            const createPfModal = document.getElementById('createPortfolioModal');
            const addHoldingModal = document.getElementById('addHoldingModal');
            const createAlertModal = document.getElementById('createAlertModal');
            const notifModal = document.getElementById('notificationsModal');
            const stockNewsModal = document.getElementById('stockNewsModal');

            if (event.target == modal) closeChartModal();
            if (event.target == editModal) closeEditModal();
            if (event.target == detailModal) closeHoldingDetailsModal();
            if (event.target == createWlModal) closeCreateWatchlistModal();
            if (event.target == createPfModal) closeCreatePortfolioModal();
            if (event.target == addHoldingModal) closeAddHoldingModal();
            if (event.target == createAlertModal) closeCreateAlertModal();
            if (event.target == notifModal) closeNotificationsModal();
            if (event.target == stockNewsModal && window.closeStockNewsModal) closeStockNewsModal();

            if (!event.target.closest('.wl-overflow')) closeActionOverflow();

            const menuDropdown = document.querySelector('.menu-dropdown-content.show');
            if (menuDropdown && !event.target.closest('.menu-dropdown-wrapper, .sidebar-user-wrapper')) {
                closeSettingsMenu();
            }

            const plusMenu = document.getElementById('plusActionMenu');
            if (plusMenu && plusMenu.style.display === 'block' && !event.target.closest('#plusActionMenu') && !event.target.closest('#axisPlusBtn')) {
                hidePlusActionMenu();
            }
        };

        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
                hidePlusActionMenu();
                closeChartModal();
                closeEditModal();
                closeHoldingDetailsModal();
                closeCreateWatchlistModal();
                closeCreatePortfolioModal();
                closeAddHoldingModal();
                closeCreateAlertModal();
                closeNotificationsModal();
                if (window.closeStockNewsModal) closeStockNewsModal();
                closeSettingsMenu();
            }
        });

        // Auto-fetch alerts on page load
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fetchAlerts);
        } else {
            fetchAlerts();
        }
