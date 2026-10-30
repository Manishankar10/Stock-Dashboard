// ==============================================================================
// CAPITAL DESK - WEB & PWA PUSH NOTIFICATION CLIENT
// Handles user permission, FCM VAPID subscription & in-app foreground alerts
// ==============================================================================

(function () {
    'use strict';

    function urlB64ToUint8Array(base64String) {
        if (!base64String) return new Uint8Array(0);
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding)
            .replace(/\-/g, '+')
            .replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    const CapitalDeskPush = {
        config: null,
        isSubscribed: false,
        currentToken: null,

        loadFirebaseCompat: function () {
            if (typeof firebase !== 'undefined' && firebase.messaging) {
                return Promise.resolve(true);
            }
            return new Promise((resolve) => {
                const s1 = document.createElement('script');
                s1.src = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js';
                s1.onload = () => {
                    const s2 = document.createElement('script');
                    s2.src = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js';
                    s2.onload = () => resolve(true);
                    s2.onerror = () => resolve(false);
                    document.head.appendChild(s2);
                };
                s1.onerror = () => resolve(false);
                document.head.appendChild(s1);
            });
        },

        isSupported: function () {
            return (
                'serviceWorker' in navigator &&
                'Notification' in window
            );
        },

        getPermission: function () {
            if (!('Notification' in window)) return 'unsupported';
            return Notification.permission;
        },

        cleanupRogueRegistrations: async function () {
            if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
                try {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    for (const reg of registrations) {
                        if (reg.scope && reg.scope.includes('firebase-cloud-messaging-push-scope')) {
                            console.info('[Push] Pruned rogue Firebase scope registration:', reg.scope);
                            await reg.unregister();
                        }
                    }
                } catch (e) {
                    console.warn('[Push] Error cleaning up rogue registrations:', e);
                }
            }
        },

        init: async function () {
            if (!this.isSupported()) {
                console.info('[Push] Browser does not support Web Push / Service Workers.');
                return;
            }

            await this.cleanupRogueRegistrations();

            try {
                const res = await fetch('/api/notifications/config');
                if (res.ok) {
                    this.config = await res.json();
                }
            } catch (e) {
                console.warn('[Push] Could not fetch push config:', e);
            }

            await this.checkCurrentSubscription();
            this.checkPwaNotificationPrompt();
        },

        checkPwaNotificationPrompt: function () {
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                                 window.navigator.standalone === true ||
                                 document.referrer.includes('android-app://');
            if (isStandalone && 'Notification' in window && Notification.permission === 'default') {
                if (!sessionStorage.getItem('cd_pwa_notif_prompt_dismissed')) {
                    setTimeout(() => this.showPwaPromptBanner(), 1500);
                }
            }
        },

        showPwaPromptBanner: function () {
            if (document.getElementById('cd-pwa-push-prompt-banner')) return;
            const banner = document.createElement('div');
            banner.id = 'cd-pwa-push-prompt-banner';
            banner.className = 'cd-pwa-push-prompt';
            banner.innerHTML = `
                <div class="cd-pwa-prompt-card">
                    <div class="cd-pwa-prompt-icon">🔔</div>
                    <div class="cd-pwa-prompt-body">
                        <div class="cd-pwa-prompt-title">Enable App Push Alerts</div>
                        <div class="cd-pwa-prompt-desc">Receive real-time Gold/Silver updates and daily EOD portfolio summaries directly on this device.</div>
                    </div>
                    <div class="cd-pwa-prompt-actions">
                        <button type="button" class="btn-pwa-push-allow" id="btn-pwa-push-allow">Enable Alerts</button>
                        <button type="button" class="btn-pwa-push-dismiss" id="btn-pwa-push-dismiss">Later</button>
                    </div>
                </div>
            `;
            document.body.appendChild(banner);

            document.getElementById('btn-pwa-push-allow')?.addEventListener('click', async () => {
                banner.remove();
                await this.subscribe(["gold_silver_rates", "portfolio_performance"], false);
            });
            document.getElementById('btn-pwa-push-dismiss')?.addEventListener('click', () => {
                banner.remove();
                sessionStorage.setItem('cd_pwa_notif_prompt_dismissed', '1');
            });
        },

        checkCurrentSubscription: async function () {
            if (!this.isSupported()) return;

            try {
                if (Notification.permission === 'granted') {
                    // Silently refresh & ensure token is registered with current device context (PWA / Web)
                    if (this.config && this.config.vapid_public_key) {
                        await this.subscribe(["gold_silver_rates", "portfolio_performance"], true);
                        return;
                    }

                    if ('serviceWorker' in navigator && 'PushManager' in window) {
                        const registration = await navigator.serviceWorker.ready;
                        const subscription = await registration.pushManager.getSubscription();
                        if (subscription) {
                            this.isSubscribed = true;
                            this.currentToken = subscription.endpoint;
                            this.updateToggleUi(true);
                            return;
                        }
                    }
                }
                this.isSubscribed = false;
                this.currentToken = null;
                this.updateToggleUi(false);
            } catch (err) {
                console.warn('[Push] Error checking subscription:', err);
                this.updateToggleUi(false);
            }
        },

        subscribe: async function (topics = ["gold_silver_rates", "portfolio_performance"], silent = false) {
            if (!this.isSupported()) {
                if (!silent) alert('Push notifications are not supported on this browser or platform.');
                return { success: false, error: 'Unsupported' };
            }

            const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                                 window.navigator.standalone === true ||
                                 document.referrer.includes('android-app://');

            // iOS Safari check
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
            if (isIOS && !isStandalone) {
                if (!silent) alert('On iOS / iPhone, you must first tap Share ⎋ -> "Add to Home Screen" to enable push notifications.');
                return { success: false, error: 'iOS requires Home Screen installation' };
            }

            try {
                // Request Browser Notification Permission
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    if (!silent) alert('Notification permission was blocked or dismissed. Please allow notifications in your browser address bar settings.');
                    this.updateToggleUi(false);
                    return { success: false, error: 'Permission denied' };
                }

                // Ensure config is fresh
                if (!this.config || !this.config.vapid_public_key) {
                    try {
                        const res = await fetch('/api/notifications/config');
                        if (res.ok) this.config = await res.json();
                    } catch (e) {}
                }

                const vapidKey = this.config ? (this.config.vapid_public_key || '').trim() : '';
                if (!vapidKey) {
                    const errMsg = 'Web Push VAPID Key is not configured yet. Please configure it in the Admin Panel (Notifications tab) first.';
                    if (!silent) alert(errMsg);
                    this.updateToggleUi(false);
                    return { success: false, error: errMsg };
                }

                if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
                    throw new Error('Push messaging is not supported in this environment.');
                }

                const registration = await navigator.serviceWorker.ready;
                if (!registration) {
                    throw new Error('Service Worker registration is not active.');
                }

                let subscription = await registration.pushManager.getSubscription();
                const targetKey = urlB64ToUint8Array(vapidKey);

                // Verify VAPID key match
                if (subscription) {
                    try {
                        const currentKey = subscription.options && subscription.options.applicationServerKey;
                        let match = false;
                        if (currentKey) {
                            const curBytes = new Uint8Array(currentKey);
                            if (curBytes.length === targetKey.length) {
                                match = true;
                                for (let i = 0; i < curBytes.length; i++) {
                                    if (curBytes[i] !== targetKey[i]) {
                                        match = false;
                                        break;
                                    }
                                }
                            }
                        }
                        if (!match) {
                            console.info('[Push] Renewing push subscription with updated VAPID key...');
                            await subscription.unsubscribe();
                            subscription = null;
                        }
                    } catch (e) {
                        console.warn('[Push] Key verification check warning:', e);
                    }
                }

                if (!subscription) {
                    subscription = await registration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: targetKey
                    });
                }

                let subJson = subscription.toJSON();
                let tokenString = subscription.endpoint;

                // Optional FCM Token retrieval using swReg ONLY (never standalone to prevent rogue worker)
                if (this.config && this.config.project_id && this.config.api_key) {
                    try {
                        await this.loadFirebaseCompat();
                        if (typeof firebase !== 'undefined' && firebase.messaging) {
                            if (!firebase.apps.length) {
                                firebase.initializeApp({
                                    projectId: this.config.project_id,
                                    messagingSenderId: this.config.messaging_sender_id,
                                    apiKey: this.config.api_key,
                                    appId: this.config.app_id
                                });
                            }
                            const messaging = firebase.messaging();
                            const fcmTok = await messaging.getToken({
                                vapidKey: vapidKey,
                                serviceWorkerRegistration: registration
                            });
                            if (fcmTok) {
                                tokenString = fcmTok;
                            }
                        }
                    } catch (fbErr) {
                        // Safe: fallback to standard W3C subscription endpoint
                        console.info('[Push] Using direct W3C WebPush endpoint for PWA delivery.');
                    }
                }

                if (!tokenString) {
                    throw new Error('Could not establish push subscription with browser.');
                }

                // Register token with backend DB, including is_pwa flag
                const resp = await fetch('/api/notifications/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token: tokenString,
                        subscription: subJson,
                        topics: topics,
                        is_pwa: isStandalone
                    })
                });

                const data = await resp.json();
                if (data.success) {
                    this.isSubscribed = true;
                    this.currentToken = tokenString;
                    this.updateToggleUi(true);

                    // Dismiss any PWA prompt banner
                    const promptBanner = document.getElementById('cd-pwa-push-prompt-banner');
                    if (promptBanner) promptBanner.remove();

                    if (!silent) {
                        const devMsg = data.registered_keys_count > 1 ? ` (${data.registered_keys_count} active devices)` : '';
                        const appType = isStandalone ? 'Capital Desk App' : 'Browser';
                        const successMsg = `🔔 Notifications enabled on ${appType} for ${data.username || 'your account'}${devMsg}!`;
                        if (typeof window.showToast === 'function') {
                            window.showToast(successMsg, 'success', 3500);
                        } else {
                            alert(successMsg);
                        }
                    }
                    return { success: true };
                } else {
                    const errMsg = data.error || 'Server rejected subscription';
                    this.updateToggleUi(false);
                    if (!silent) {
                        if (resp.status === 401 || errMsg.toLowerCase().includes('log in') || errMsg.toLowerCase().includes('unregistered')) {
                            if (typeof window.showToast === 'function') {
                                window.showToast('Please log in with a registered account to enable notifications.', 'warning', 4500);
                            } else {
                                alert('Please log in with a registered Capital Desk account to enable notifications.');
                            }
                        } else {
                            if (typeof window.showToast === 'function') {
                                window.showToast('Subscription error: ' + errMsg, 'error', 4000);
                            } else {
                                alert('Could not enable notifications: ' + errMsg);
                            }
                        }
                    }
                    return { success: false, error: errMsg };
                }
            } catch (err) {
                console.error('[Push] Subscription failed:', err);
                this.updateToggleUi(false);
                if (!silent) alert('Could not enable notifications: ' + err.message);
                return { success: false, error: err.message };
            }
        },

        unsubscribe: async function () {
            if (!this.isSupported()) return;

            try {
                const tokensToUnregister = [];
                if (this.currentToken) {
                    tokensToUnregister.push(this.currentToken);
                }

                if ('serviceWorker' in navigator && 'PushManager' in window) {
                    const registration = await navigator.serviceWorker.ready;
                    const subscription = await registration.pushManager.getSubscription();

                    if (subscription) {
                        if (subscription.endpoint && !tokensToUnregister.includes(subscription.endpoint)) {
                            tokensToUnregister.push(subscription.endpoint);
                        }
                        await subscription.unsubscribe().catch(() => {});
                    }
                }

                for (const tok of tokensToUnregister) {
                    await fetch('/api/notifications/unsubscribe', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: tok })
                    }).catch(() => {});
                }

                this.isSubscribed = false;
                this.currentToken = null;
                this.updateToggleUi(false);

                if (typeof window.showToast === 'function') {
                    window.showToast('Push notifications disabled.', 'info');
                } else {
                    alert('Push notifications disabled.');
                }
                return { success: true };
            } catch (err) {
                console.error('[Push] Unsubscribe error:', err);
                return { success: false, error: err.message };
            }
        },

        toggle: async function (topics) {
            if (this.isSubscribed) {
                return await this.unsubscribe();
            } else {
                return await this.subscribe(topics);
            }
        },

        updateToggleUi: function (active) {
            const btns = document.querySelectorAll('.cd-push-toggle-btn');
            btns.forEach((btn) => {
                const isBullionBtn = btn.id === 'insights-bullion-notif-btn' || btn.classList.contains('cd-bullion-push-btn');
                if (isBullionBtn) {
                    if (active) {
                        btn.classList.add('active');
                        btn.style.background = 'rgba(16, 185, 129, 0.15)';
                        btn.style.color = '#10b981';
                        btn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                        btn.title = 'Daily Bullion Alerts Active (Click to Disable)';
                        btn.innerHTML = '✅ <span class="push-btn-text">Daily Bullion Alerts Active</span>';
                    } else {
                        btn.classList.remove('active');
                        btn.style.background = 'rgba(234, 179, 8, 0.12)';
                        btn.style.color = '#eab308';
                        btn.style.borderColor = 'rgba(234, 179, 8, 0.35)';
                        btn.title = 'Click to Enable Daily Bullion Push Alerts';
                        btn.innerHTML = '🔔 <span class="push-btn-text">Enable Daily Bullion Notifications</span>';
                    }
                } else {
                    if (active) {
                        btn.classList.add('active');
                        btn.style.background = '#10b981';
                        btn.style.color = '#ffffff';
                        btn.style.borderColor = '#10b981';
                        btn.title = 'Push Alerts Active (Click to Disable)';
                        btn.innerHTML = '✅ <span class="push-btn-text">Push Active</span>';
                    } else {
                        btn.classList.remove('active');
                        btn.style.background = '#3b82f6';
                        btn.style.color = '#ffffff';
                        btn.style.borderColor = '#3b82f6';
                        btn.title = 'Click to Enable Market & Portfolio Push Alerts';
                        btn.innerHTML = '🔔 <span class="push-btn-text">Enable Push Alerts</span>';
                    }
                }
            });

            const banner = document.getElementById('modal-push-banner');
            if (banner) {
                if (active) {
                    banner.classList.add('active');
                } else {
                    banner.classList.remove('active');
                }
            }

            const desc = document.getElementById('modal-push-desc');
            if (desc) {
                if (active) {
                    desc.innerHTML = '<span style="color: #10b981; font-weight: 600;">✅ Active: Receiving live Gold/Silver updates and daily EOD portfolio summaries.</span>';
                } else {
                    desc.innerText = 'Receive real-time Gold/Silver rates and personal EOD portfolio performance';
                }
            }
        }
    };

    window.CapitalDeskPush = CapitalDeskPush;

    // Auto-init on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => CapitalDeskPush.init());
    } else {
        CapitalDeskPush.init();
    }
})();
