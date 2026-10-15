        // =========================================================
        // PRICE ALERTS & NOTIFICATIONS LOGIC
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
            const badge = document.getElementById('notif-badge');
            if (badge) {
                if (unreadCount > 0) {
                    badge.innerText = unreadCount > 99 ? '99+' : unreadCount;
                    badge.style.display = 'inline-block';
                } else {
                    badge.style.display = 'none';
                }
            }
        }

        function openCreateAlertModal(symbol, customPrice = null) {
            const sym = symbol || (currentDetailHolding ? currentDetailHolding.symbol : '');
            if (!sym) return;
            document.getElementById('modal-alert-symbol').value = sym;
            const stockInfo = (typeof stockPricesData !== 'undefined' && stockPricesData[sym]) ? stockPricesData[sym] : {};
            const valToSet = (customPrice !== null && customPrice !== undefined) ? customPrice : (stockInfo.price || '');
            document.getElementById('modal-alert-price').value = valToSet;
            document.getElementById('modal-alert-note').value = '';
            document.getElementById('createAlertModal').style.display = 'block';
        }

        function closeCreateAlertModal() {
            document.getElementById('createAlertModal').style.display = 'none';
        }
        window.openCreateAlertModal = openCreateAlertModal;
        window.closeCreateAlertModal = closeCreateAlertModal;

        async function submitCreateAlert() {
            const symbol = document.getElementById('modal-alert-symbol').value;
            const condition = document.getElementById('modal-alert-condition').value;
            const target_price = parseFloat(document.getElementById('modal-alert-price').value);
            const note = document.getElementById('modal-alert-note').value.trim();

            if (isNaN(target_price) || target_price <= 0) {
                alert('Please enter a valid target price!');
                return;
            }

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
                alert(`🎯 Price alert set for ${symbol} at ₹${target_price}!`);
            } else {
                alert(data.error || 'Failed to create alert');
            }
        }

        async function deleteAlert(alertId) {
            let confirmed = false;
            try {
                if (typeof showCustomConfirm === 'function') {
                    confirmed = await showCustomConfirm({ title: 'Delete Price Alert', message: 'Are you sure you want to delete this price alert?', isDanger: true });
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
            await fetchAlerts();
            const notifModal = document.getElementById('notificationsModal');
            if (notifModal) notifModal.style.display = 'block';
            switchNotifTab(activeNotifTab);
            fetch('/api/notifications/mark_read', { method: 'POST' }).then(r => r.json()).then(data => {
                if (data.success) {
                    userAlertsData = data.alerts_data;
                    updateNotificationBadge();
                }
            });
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
                }
                if (contentAlerts) {
                    contentAlerts.classList.add('hidden');
                    contentAlerts.style.setProperty('display', 'none', 'important');
                }
            } else {
                if (btnAlerts) btnAlerts.classList.add('active');
                if (btnNotifs) btnNotifs.classList.remove('active');
                if (contentAlerts) {
                    contentAlerts.classList.remove('hidden');
                    contentAlerts.style.setProperty('display', 'flex', 'important');
                }
                if (contentNotifs) {
                    contentNotifs.classList.add('hidden');
                    contentNotifs.style.setProperty('display', 'none', 'important');
                }
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

            // Render Notifications Tab
            const notifMount = document.getElementById('notifications-list-mount');
            if (notifMount) {
                if (notifs.length === 0) {
                    notifMount.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-secondary);">No triggered notifications yet.</div>';
                } else {
                    let html = '';
                    notifs.forEach(n => {
                        html += `
                            <div style="background:var(--bg-subtle); border:1px solid var(--border-color); border-radius:8px; padding:12px 14px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
                                <div>
                                    <div style="font-weight:700; font-size:13.5px; color:var(--text-primary); margin-bottom:4px;">${escapeHtml(n.title)}</div>
                                    <div style="font-size:12.5px; color:var(--text-secondary); margin-bottom:6px;">${escapeHtml(n.message)}</div>
                                    <div style="font-size:10.5px; color:var(--text-muted);">${window.formatAppDateTime ? window.formatAppDateTime(n.created_at) : n.created_at}</div>
                                </div>
                                <button class="btn-danger" style="padding:4px 8px; font-size:12px;" onclick="deleteNotification('${n.id}')" title="Delete Notification">🗑️</button>
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
                    alertsMount.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-secondary);">No price alerts set. Add price alerts from Watchlist or Portfolio details!</div>';
                } else {
                    let html = '';
                    alerts.forEach(a => {
                        const condText = a.condition === 'above' ? '≥ (Crosses Above)' : '≤ (Crosses Below)';
                        const statusBadge = a.status === 'triggered' 
                            ? '<span class="badge" style="background:#fef3c7; color:#d97706; border:1px solid #fde68a;">Triggered</span>' 
                            : '<span class="badge" style="background:#ecfdf5; color:#059669; border:1px solid #a7f3d0;">Active</span>';
                        html += `
                            <div style="background:var(--bg-subtle); border:1px solid var(--border-color); border-radius:8px; padding:12px 14px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; gap:10px;">
                                <div>
                                    <div style="font-weight:700; font-size:14px; color:var(--text-primary); display:flex; align-items:center; gap:8px;">
                                        ${escapeHtml(a.symbol)} ${statusBadge}
                                    </div>
                                    <div style="font-size:12.5px; color:var(--text-secondary); margin-top:3px;">
                                        Target: <strong>₹${parseFloat(a.target_price).toLocaleString('en-IN', {minimumFractionDigits:2})}</strong> (${condText})
                                    </div>
                                    ${a.note ? `<div style="font-size:11.5px; color:var(--text-muted); margin-top:2px; font-style:italic;">Note: ${escapeHtml(a.note)}</div>` : ''}
                                    <div style="font-size:10.5px; color:var(--text-muted); margin-top:4px;">Created: ${window.formatAppDateTime ? window.formatAppDateTime(a.created_at) : a.created_at}</div>
                                </div>
                                <button class="btn-danger" style="padding:6px 10px; font-size:13px;" onclick="deleteAlert('${a.id}')" title="Delete Alert">🗑️ Delete</button>
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
                    confirmed = await showCustomConfirm({ title: 'Clear Notifications', message: 'Are you sure you want to clear all notification history?', isDanger: true });
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

            if (event.target == modal) closeChartModal();
            if (event.target == editModal) closeEditModal();
            if (event.target == detailModal) closeHoldingDetailsModal();
            if (event.target == createWlModal) closeCreateWatchlistModal();
            if (event.target == createPfModal) closeCreatePortfolioModal();
            if (event.target == addHoldingModal) closeAddHoldingModal();
            if (event.target == createAlertModal) closeCreateAlertModal();
            if (event.target == notifModal) closeNotificationsModal();

            if (!event.target.closest('.wl-overflow')) closeActionOverflow();

            const menuDropdown = document.querySelector('.menu-dropdown-content.show');
            if (menuDropdown && !event.target.closest('.menu-dropdown-wrapper, .sidebar-user-wrapper')) {
                closeSettingsMenu();
            }

            const plusMenu = document.getElementById('plusActionMenu');
            if (plusMenu && plusMenu.style.display === 'block' && !event.target.closest('#plusActionMenu') && !event.target.closest('#axisPlusBtn')) {
                hidePlusActionMenu();
            }
        }
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
                closeSettingsMenu();
            }
        });

