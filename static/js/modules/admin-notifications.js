// ==============================================================================
// CAPITAL DESK - ADMIN NOTIFICATIONS CONTROLLER
// Complete Client-side Controller for Dynamic Bullion & Personalized Portfolio Push
// ==============================================================================

(function () {
    'use strict';

    // 1. File Upload Helper for Service Account JSON
    window.handleServiceAccountFileUpload = function (event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const text = e.target.result;
                const parsed = JSON.parse(text);
                const saTextarea = document.getElementById('fcm-cfg-service-account');
                const projInput = document.getElementById('fcm-cfg-project-id');

                if (saTextarea) saTextarea.value = text;
                if (projInput && parsed.project_id) projInput.value = parsed.project_id;

                const alertBox = document.getElementById('fcm-status-alert-box');
                if (alertBox) {
                    alertBox.innerHTML = `<span style="color: #10b981; font-weight: 600;">📁 Loaded "${file.name}" (Project: ${parsed.project_id || 'valid'}). Click "Save Firebase Configuration" below.</span>`;
                }
                alert(`✅ Successfully loaded "${file.name}"!\n\nDetected Project ID: ${parsed.project_id || 'N/A'}\nClick "Save Firebase Configuration" to apply.`);
            } catch (err) {
                alert('❌ Failed to parse JSON file: ' + err.message);
            }
        };
        reader.readAsText(file);
    };

    // 2. Save Firebase FCM Configuration (Method A)
    window.saveFcmConfiguration = async function () {
        let vapid = (document.getElementById('fcm-cfg-vapid-key')?.value || '').trim();
        let projId = (document.getElementById('fcm-cfg-project-id')?.value || '').trim();
        let senderId = (document.getElementById('fcm-cfg-sender-id')?.value || '').trim();
        let apiKey = (document.getElementById('fcm-cfg-api-key')?.value || '').trim();
        const saJson = (document.getElementById('fcm-cfg-service-account')?.value || '').trim();

        if (!vapid && !projId && !saJson) {
            alert('Please enter your Web Push VAPID Key, Project ID, or Service Account JSON.');
            return;
        }

        // Smart Swap Detection
        if (vapid.startsWith('AIzaSy') && (apiKey.startsWith('B') || apiKey.length > 50)) {
            const temp = vapid;
            vapid = apiKey;
            apiKey = temp;
            if (document.getElementById('fcm-cfg-vapid-key')) document.getElementById('fcm-cfg-vapid-key').value = vapid;
            if (document.getElementById('fcm-cfg-api-key')) document.getElementById('fcm-cfg-api-key').value = apiKey;
            alert('🔄 Notice: We detected that your Web Push VAPID Key and Web API Key were swapped in the boxes and automatically corrected them for you!');
        } else if (vapid.startsWith('AIzaSy') && !apiKey) {
            apiKey = vapid;
            vapid = '';
            if (document.getElementById('fcm-cfg-vapid-key')) document.getElementById('fcm-cfg-vapid-key').value = '';
            if (document.getElementById('fcm-cfg-api-key')) document.getElementById('fcm-cfg-api-key').value = apiKey;
            alert('⚠️ Notice: The key you entered in "Web Push VAPID Key" is actually a Google Web API Key (starts with AIzaSy). We moved it to the Web API Key field. Please copy the real VAPID Key (starts with B...) from Cloud Messaging -> Web Configuration and paste it into Web Push VAPID Key.');
            return;
        }

        // Validate JSON client-side before sending
        if (saJson) {
            try {
                JSON.parse(saJson);
            } catch (e) {
                alert('❌ The Service Account JSON you pasted is not valid JSON:\n\n' + e.message);
                return;
            }
        }

        const saveBtn = document.getElementById('btn-save-fcm-cfg');
        const originalText = saveBtn ? saveBtn.innerHTML : '💾 Save Firebase Configuration';
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '⏳ Saving & Initializing...';
        }

        try {
            const res = await fetch('/api/admin/notifications/save-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vapid_public_key: vapid,
                    project_id: projId,
                    messaging_sender_id: senderId,
                    api_key: apiKey,
                    service_account_json: saJson
                })
            });

            const data = await res.json();
            if (data.success) {
                alert(`✅ ${data.message || 'Firebase FCM configuration saved successfully!'}`);
                if (window.CapitalDeskPush) {
                    window.CapitalDeskPush.init();
                }
                await window.loadNotificationStats();
            } else {
                alert('❌ Failed to save configuration: ' + (data.error || 'Unknown error'));
            }
        } catch (err) {
            alert('❌ Network/Server Error: ' + err.message);
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalText;
            }
        }
    };

    // 3. Dynamic Live Bullion Rates
    window.fetchLiveBullionRates = async function (force = false) {
        const badge = document.getElementById('gold-live-badge');
        if (badge) badge.innerText = '⏳ Syncing market...';

        try {
            const res = await fetch(`/api/notifications/live-bullion?refresh=${force ? '1' : '0'}`);
            const data = await res.json();
            if (data.success && data.rates) {
                const r = data.rates;
                const g1 = document.getElementById('input-gold-1g');
                const g8 = document.getElementById('input-gold-8g');
                const s1 = document.getElementById('input-silver-1g');
                const s8 = document.getElementById('input-silver-8g');

                if (g1) g1.value = r.gold_1g;
                if (g8) g8.value = r.gold_8g;
                if (s1) s1.value = r.silver_1g;
                if (s8) s8.value = r.silver_8g;

                window.updateGoldRatePreview();
                if (badge) {
                    badge.innerText = '🟢 Live Market Synced';
                    badge.title = `Source: ${r.source} (${r.updated_at})`;
                }
            }
        } catch (err) {
            console.warn('[Admin] Live bullion fetch failed:', err);
            if (badge) badge.innerText = '⚠️ Offline Benchmark';
        }
    };

    window.updateGoldRatePreview = function () {
        const g1 = document.getElementById('input-gold-1g')?.value || '13,195';
        const g8 = document.getElementById('input-gold-8g')?.value || '1,05,560';
        const s1 = document.getElementById('input-silver-1g')?.value || '215.00';
        const s8 = document.getElementById('input-silver-8g')?.value || '1,720';

        const ensureRupee = (val) => {
            val = String(val).trim();
            return val.startsWith('₹') ? val : '₹' + val;
        };

        const pG1 = document.getElementById('preview-gold-1g');
        const pG8 = document.getElementById('preview-gold-8g');
        const pS1 = document.getElementById('preview-silver-1g');
        const pS8 = document.getElementById('preview-silver-8g');

        if (pG1) pG1.innerText = ensureRupee(g1);
        if (pG8) pG8.innerText = ensureRupee(g8);
        if (pS1) pS1.innerText = ensureRupee(s1);
        if (pS8) pS8.innerText = ensureRupee(s8);

        const previewLink = document.getElementById('btn-preview-gold-img');
        if (previewLink) {
            previewLink.href = `/api/notifications/render-gold-card.png?gold_1g=${encodeURIComponent(g1)}&gold_8g=${encodeURIComponent(g8)}&silver_1g=${encodeURIComponent(s1)}&silver_8g=${encodeURIComponent(s8)}&t=${Date.now()}`;
        }
    };

    window.autoCalculate8gRates = function () {
        const g1Str = (document.getElementById('input-gold-1g')?.value || '13195').replace(/[^0-9.]/g, '');
        const s1Str = (document.getElementById('input-silver-1g')?.value || '215').replace(/[^0-9.]/g, '');

        const g1 = parseFloat(g1Str) || 13195;
        const s1 = parseFloat(s1Str) || 215;

        const g8 = Math.round(g1 * 8);
        const s8 = Math.round(s1 * 8);

        const inpG8 = document.getElementById('input-gold-8g');
        const inpS8 = document.getElementById('input-silver-8g');
        if (inpG8) inpG8.value = g8.toLocaleString('en-IN');
        if (inpS8) inpS8.value = s8.toLocaleString('en-IN');
        window.updateGoldRatePreview();
    };

    window.handleGoldTargetUserChange = function (val) {
        const customInput = document.getElementById('gold-custom-username');
        if (customInput) {
            customInput.style.display = (val === 'custom') ? 'inline-block' : 'none';
            if (val === 'custom') customInput.focus();
        }
    };

    window.sendSampleGoldToUser = async function (username = 'sampath') {
        const btn = event?.currentTarget;
        const originalText = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '⏳ Sending to ' + username + '...';
        }

        try {
            const res = await fetch('/api/admin/notifications/send-sample-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: username,
                    type: 'gold'
                })
            });
            const data = await res.json();
            if (data.success) {
                alert(`✅ Gold & Silver sample successfully delivered to ${username}!\n\n• Recipients: ${data.recipient_count} device(s)\n• Status: ${data.status}`);
            } else {
                alert(`⚠️ Notice: ${data.message || 'Could not dispatch'}`);
            }
            await window.loadNotificationStats();
        } catch (err) {
            alert('❌ Error sending sample: ' + err.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        }
    };

    window.sendGoldRatesNotification = async function () {
        const btn = document.getElementById('btn-send-gold');
        const originalText = btn ? btn.innerHTML : '🚀 Send Gold & Silver Notification';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '⏳ Dispatched via FCM...';
        }

        try {
            const g1 = document.getElementById('input-gold-1g')?.value || '13,195';
            const g8 = document.getElementById('input-gold-8g')?.value || '1,05,560';
            const s1 = document.getElementById('input-silver-1g')?.value || '215.00';
            const s8 = document.getElementById('input-silver-8g')?.value || '1,720';

            let targetUser = 'all';
            const targetSelect = document.getElementById('gold-target-user-select');
            if (targetSelect) {
                if (targetSelect.value === 'custom') {
                    targetUser = (document.getElementById('gold-custom-username')?.value || '').trim() || 'all';
                } else {
                    targetUser = targetSelect.value;
                }
            }

            const res = await fetch('/api/admin/notifications/send-gold', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    gold_1g: g1,
                    gold_8g: g8,
                    silver_1g: s1,
                    silver_8g: s8,
                    username: targetUser
                })
            });

            const data = await res.json();
            if (data.success) {
                alert(`✅ Gold & Silver Notification Dispatched!\n\n• Target: ${data.target_username || targetUser}\n• Status: ${data.status}\n• Recipients: ${data.recipient_count} device(s)\n• Message: ${data.message || 'Dispatched'}`);
            } else {
                alert(`⚠️ Notification Warning: ${data.message || 'Could not send'}`);
            }
            await window.loadNotificationStats();
        } catch (err) {
            alert('❌ Error sending notification: ' + err.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        }
    };

    // 4. Portfolio Performance Card Helpers
    window.updatePortfolioPerfPreview = function () {
        const perf = document.getElementById('input-perf-val')?.value || '+0.50%';
        const gSym = document.getElementById('input-perf-gainer-sym')?.value || 'POCL';
        const gPct = document.getElementById('input-perf-gainer-chg')?.value || '+4.56%';
        const lSym = document.getElementById('input-perf-loser-sym')?.value || 'Polymedicure';
        const lPct = document.getElementById('input-perf-loser-chg')?.value || '-0.65%';

        const perfEl = document.getElementById('preview-perf-val');
        if (perfEl) {
            perfEl.innerText = perf.startsWith('+') || perf.startsWith('-') ? perf : '+' + perf;
            perfEl.style.color = perf.includes('-') ? '#ef4444' : '#10b981';
        }

        const pGainerSym = document.getElementById('preview-perf-gainer-sym');
        const pGainerPct = document.getElementById('preview-perf-gainer-pct');
        const pLoserSym = document.getElementById('preview-perf-loser-sym');
        const pLoserPct = document.getElementById('preview-perf-loser-pct');

        if (pGainerSym) pGainerSym.innerText = gSym;
        if (pGainerPct) pGainerPct.innerText = gPct.startsWith('+') ? gPct : '+' + gPct;
        if (pLoserSym) pLoserSym.innerText = lSym;
        if (pLoserPct) pLoserPct.innerText = lPct.startsWith('-') ? lPct : '-' + lPct;

        const previewLink = document.getElementById('btn-preview-perf-img');
        if (previewLink) {
            previewLink.href = `/api/notifications/render-portfolio-card.png?perf=${encodeURIComponent(perf)}&top_gainer=${encodeURIComponent(gSym)}&top_gainer_pct=${encodeURIComponent(gPct)}&top_loser=${encodeURIComponent(lSym)}&top_loser_pct=${encodeURIComponent(lPct)}&t=${Date.now()}`;
        }
    };

    window.autoCalculateFromPortfolios = async function () {
        try {
            const res = await fetch('/api/admin/notifications/users-portfolio-overview');
            const data = await res.json();
            if (data.success && data.users && data.users.length > 0) {
                const u = data.users[0];
                document.getElementById('input-perf-val').value = u.net_return_pct;
                document.getElementById('input-perf-gainer-sym').value = u.top_gainer_symbol;
                document.getElementById('input-perf-gainer-chg').value = u.top_gainer_change;
                document.getElementById('input-perf-loser-sym').value = u.top_loser_symbol;
                document.getElementById('input-perf-loser-chg').value = u.top_loser_change;
                window.updatePortfolioPerfPreview();
                alert(`✅ Calculated live from ${u.username}'s portfolio:\n• Return: ${u.net_return_pct}\n• Top Gainer: ${u.top_gainer_symbol} (${u.top_gainer_change})\n• Top Loser: ${u.top_loser_symbol} (${u.top_loser_change})`);
            }
        } catch (e) {
            window.updatePortfolioPerfPreview();
        }
    };

    window.sendPortfolioPerformanceNotification = async function () {
        const btn = document.getElementById('btn-send-portfolio');
        const originalText = btn ? btn.innerHTML : '📊 Broadcast / Custom Send';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '⏳ Dispatched via FCM...';
        }

        try {
            const perf = document.getElementById('input-perf-val')?.value || '+0.50%';
            const gSym = document.getElementById('input-perf-gainer-sym')?.value || 'POCL';
            const gPct = document.getElementById('input-perf-gainer-chg')?.value || '+4.56%';
            const lSym = document.getElementById('input-perf-loser-sym')?.value || 'Polymedicure';
            const lPct = document.getElementById('input-perf-loser-chg')?.value || '-0.65%';

            const res = await fetch('/api/admin/notifications/send-portfolio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    perf: perf,
                    top_gainer: gSym,
                    top_gainer_pct: gPct,
                    top_loser: lSym,
                    top_loser_pct: lPct
                })
            });

            const data = await res.json();
            if (data.success) {
                alert(`✅ Portfolio Performance Notification Dispatched!\n\n• Status: ${data.status}\n• Recipients: ${data.recipient_count} device(s)\n• Message: ${data.message || 'Sent'}`);
            } else {
                alert(`⚠️ Notification Warning: ${data.message || 'Could not send'}`);
            }
            await window.loadNotificationStats();
        } catch (err) {
            alert('❌ Error sending notification: ' + err.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        }
    };

    // 5. Load Real-time User Portfolio Digest
    window.loadUsersPortfolioDigest = async function () {
        const tbody = document.getElementById('users-portfolio-digest-body');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--text-secondary);">Calculating portfolio performance for all users...</td></tr>';

        try {
            const res = await fetch('/api/admin/notifications/users-portfolio-overview');
            const data = await res.json();
            if (!data.success || !data.users || data.users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--text-secondary);">No user accounts found.</td></tr>';
                return;
            }

            tbody.innerHTML = data.users.map((u) => {
                const isPositive = !String(u.net_return_pct).startsWith('-');
                const retColor = isPositive ? '#10b981' : '#ef4444';
                const retBg = isPositive ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)';
                const cardUrl = `/api/notifications/render-portfolio-card.png?perf=${encodeURIComponent(u.net_return_pct)}&top_gainer=${encodeURIComponent(u.top_gainer_symbol)}&top_gainer_pct=${encodeURIComponent(u.top_gainer_change)}&top_loser=${encodeURIComponent(u.top_loser_symbol)}&top_loser_pct=${encodeURIComponent(u.top_loser_change)}&username=${encodeURIComponent(u.username)}`;

                return `
                    <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="padding: 10px 12px; font-weight: 700; color: var(--text-primary);">
                            👤 ${u.username}
                        </td>
                        <td style="padding: 10px 12px; text-align: center; font-weight: 600;">
                            ${u.holdings_count}
                        </td>
                        <td style="padding: 10px 12px; text-align: center;">
                            <span class="badge" style="padding: 3px 8px; border-radius: 6px; font-weight: 800; font-size: 12px; background: ${retBg}; color: ${retColor};">
                                ${u.net_return_pct}
                            </span>
                        </td>
                        <td style="padding: 10px 12px;">
                            <span style="font-weight: 700; color: var(--text-primary);">${u.top_gainer_symbol}</span>
                            <span style="color: #10b981; font-weight: 600; font-size: 11.5px; margin-left: 4px;">${u.top_gainer_change}</span>
                        </td>
                        <td style="padding: 10px 12px;">
                            <span style="font-weight: 700; color: var(--text-primary);">${u.top_loser_symbol}</span>
                            <span style="color: #ef4444; font-weight: 600; font-size: 11.5px; margin-left: 4px;">${u.top_loser_change}</span>
                        </td>
                        <td style="padding: 10px 12px; text-align: right; font-weight: 600; font-family: monospace;">
                            ₹${(u.total_current_val || 0).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                        </td>
                        <td style="padding: 10px 12px; text-align: center;">
                            <span class="badge" style="padding: 2px 7px; border-radius: 10px; font-size: 11px; ${u.registered_devices > 0 ? 'background: rgba(16,185,129,0.15); color: #10b981;' : 'background: var(--bg-subtle); color: var(--text-secondary);'}">
                                ${u.registered_devices} Device(s)
                            </span>
                        </td>
                        <td style="padding: 10px 12px; text-align: center;">
                            <a href="${cardUrl}" target="_blank" class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px; text-decoration: none;" title="Open this user's unique generated PNG card">
                                🖼️ View Card
                            </a>
                        </td>
                    </tr>
                `;
            }).join('');
        } catch (err) {
            console.error('[Admin] Error loading user portfolio digest:', err);
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: #ef4444;">Error calculating portfolios: ${err.message}</td></tr>`;
        }
    };

    // 6. Send Unique Personalized EOD to All Users
    window.sendPortfolioPersonalizedAllUsers = async function () {
        const btn = document.getElementById('btn-send-portfolio-all');
        const originalText = btn ? btn.innerHTML : '🚀 Send Unique EOD Notifications to ALL Users Individually (from DB)';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '⏳ Computing Real DB Portfolios & Dispatching Unique Pushes...';
        }

        try {
            const res = await fetch('/api/admin/notifications/send-portfolio-all-users', {
                method: 'POST'
            });
            const data = await res.json();
            if (data.success) {
                const breakdown = (data.user_breakdown || []).map(u => `• ${u.username}: ${u.performance} (Gainer: ${u.top_gainer}, Loser: ${u.top_loser}) -> ${u.status}`).join('\n');
                if (data.total_devices_targeted === 0) {
                    alert(`⚠️ No Push Devices Delivered:\n\n• Users Processed: ${data.total_users_processed}\n• Devices Delivered: 0\n\nBreakdown:\n${breakdown || 'No active devices registered'}`);
                } else {
                    alert(`✅ Personalized EOD Portfolio Push Completed!\n\n• Users Processed: ${data.total_users_processed}\n• Devices Delivered: ${data.total_devices_targeted}\n\nBreakdown:\n${breakdown}`);
                }
                await window.loadNotificationStats();
                await window.loadUsersPortfolioDigest();
            } else {
                alert('⚠️ Error dispatching notifications: ' + (data.error || data.message || 'Unknown error'));
            }
        } catch (err) {
            alert('❌ Network/Server Error: ' + err.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        }
    };

    // 7. Send Diagnostic Test Push
    window.sendTestPushAlert = async function () {
        try {
            const res = await fetch('/api/admin/notifications/send-test', { method: 'POST' });
            const data = await res.json();
            alert(`🧪 Test Alert Result:\n\n• Status: ${data.status}\n• Recipients: ${data.recipient_count}\n• Details: ${data.message}`);
            await window.loadNotificationStats();
        } catch (err) {
            alert('Error sending test push: ' + err.message);
        }
    };

    // 8. Load Stats & Notification History
    window.loadNotificationStats = async function () {
        try {
            const res = await fetch('/api/admin/notifications/stats');
            const data = await res.json();
            if (!data.success) return;

            const elSub = document.getElementById('stat-notif-subscribers');
            const elActive = document.getElementById('stat-notif-active-devices');
            if (elSub) elSub.innerText = data.total_subscribers || 0;
            if (elActive) elActive.innerText = `${data.active_subscribers || 0} Active Web & PWA devices`;

            const fcmStatusEl = document.getElementById('stat-notif-fcm-status');
            const fcmSubtextEl = document.getElementById('stat-notif-fcm-subtext');
            const fcmAlertBox = document.getElementById('fcm-status-alert-box');

            if (data.config && data.config.is_configured) {
                if (fcmStatusEl) {
                    fcmStatusEl.innerText = 'Connected & Active';
                    fcmStatusEl.style.color = '#10b981';
                }
                if (fcmSubtextEl) fcmSubtextEl.innerText = 'Live FCM Web Push Ready';
                if (fcmAlertBox) {
                    fcmAlertBox.innerHTML = '<span style="color:#10b981; font-weight:600;">✅ Firebase Admin Service Account connected and ready for live push dispatches.</span>';
                }
            } else if (data.config && data.config.service_account_detected) {
                if (fcmStatusEl) {
                    fcmStatusEl.innerText = 'Service Account Present';
                    fcmStatusEl.style.color = '#3b82f6';
                }
                if (fcmSubtextEl) fcmSubtextEl.innerText = 'Initializing...';
            } else {
                if (fcmStatusEl) {
                    fcmStatusEl.innerText = 'Setup Required';
                    fcmStatusEl.style.color = '#f59e0b';
                }
                if (fcmSubtextEl) fcmSubtextEl.innerText = 'Simulation Mode Active';
                if (fcmAlertBox) {
                    fcmAlertBox.innerHTML = '<span style="color:#f59e0b; font-weight:600;">⚠️ Firebase Service Account JSON pending. Dispatches will be simulated and logged in the audit trail until credentials are provided.</span>';
                }
            }

            // Fill inputs if currently empty
            if (data.config) {
                const vapidInput = document.getElementById('fcm-cfg-vapid-key');
                const projInput = document.getElementById('fcm-cfg-project-id');
                const senderInput = document.getElementById('fcm-cfg-sender-id');
                const apiKeyInput = document.getElementById('fcm-cfg-api-key');
                if (vapidInput && data.config.vapid_public_key && !vapidInput.value) {
                    vapidInput.value = data.config.vapid_public_key;
                }
                if (projInput && data.config.project_id && !projInput.value) {
                    projInput.value = data.config.project_id;
                }
                if (senderInput && data.config.messaging_sender_id && !senderInput.value) {
                    senderInput.value = data.config.messaging_sender_id;
                }
                if (apiKeyInput && data.config.api_key && !apiKeyInput.value) {
                    apiKeyInput.value = data.config.api_key;
                }
            }

            // Browser permission status
            const permEl = document.getElementById('stat-notif-client-perm');
            if (permEl) {
                if (window.CapitalDeskPush && window.CapitalDeskPush.isSupported()) {
                    const perm = window.CapitalDeskPush.getPermission();
                    if (perm === 'granted') {
                        permEl.innerText = 'Granted 🔔';
                        permEl.style.color = '#10b981';
                    } else if (perm === 'denied') {
                        permEl.innerText = 'Blocked 🚫';
                        permEl.style.color = '#ef4444';
                    } else {
                        permEl.innerText = 'Not Prompted ❓';
                        permEl.style.color = '#f59e0b';
                    }
                } else {
                    permEl.innerText = 'Unsupported';
                    permEl.style.color = '#94a3b8';
                }
            }

            // Audit Trail
            const history = data.history || [];
            const elSentCount = document.getElementById('stat-notif-sent-count');
            const elLastSent = document.getElementById('stat-notif-last-sent');
            if (elSentCount) elSentCount.innerText = history.length;
            if (elLastSent && history.length > 0) {
                elLastSent.innerText = `Last sent: ${history[0].timestamp}`;
            }

            const tbody = document.getElementById('notif-history-table-body');
            if (tbody) {
                if (history.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 25px; color: var(--text-secondary);">No notification dispatches recorded yet. Use the buttons above to test.</td></tr>';
                } else {
                    tbody.innerHTML = history.map((item) => {
                        const isSuccess = String(item.status).toLowerCase().includes('delivered') || String(item.status).toLowerCase().includes('sent');
                        const badgeStyle = isSuccess ? 'background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid #10b981;' : 'background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid #ca8a04;';
                        return `
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <td style="padding: 10px 12px; white-space: nowrap; font-family: monospace; font-size: 11.5px;">${item.timestamp || '-'}</td>
                                <td style="padding: 10px 12px; font-weight: 600;">${item.type || 'General'}</td>
                                <td style="padding: 10px 12px; font-weight: 600; color: var(--text-primary);">${item.title || '-'}</td>
                                <td style="padding: 10px 12px; color: var(--text-secondary); max-width: 320px; white-space: pre-wrap; font-size: 11.5px;">${item.body || '-'}</td>
                                <td style="padding: 10px 12px; text-align: center; font-weight: 700;">${item.recipient_count || 0}</td>
                                <td style="padding: 10px 12px; text-align: center;">
                                    <span class="badge" style="padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; ${badgeStyle}">
                                        ${item.status || 'Logged'}
                                    </span>
                                </td>
                            </tr>
                        `;
                    }).join('');
                }
            }
        } catch (err) {
            console.error('[Admin] Error loading notification stats:', err);
        }
    };
})();
