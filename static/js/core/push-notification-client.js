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

        init: async function () {
            if (!this.isSupported()) {
                console.info('[Push] Browser does not support Web Push / Service Workers.');
                return;
            }

            try {
                const res = await fetch('/api/notifications/config');
                if (res.ok) {
                    this.config = await res.json();
                }
            } catch (e) {
                console.warn('[Push] Could not fetch push config:', e);
            }

            await this.checkCurrentSubscription();
        },

        checkCurrentSubscription: async function () {
            if (!this.isSupported()) return;

            try {
                if (Notification.permission === 'granted') {
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

        subscribe: async function (topics = ["gold_silver_rates", "portfolio_performance"]) {
            if (!this.isSupported()) {
                alert('Push notifications are not supported on this browser or platform.');
                return { success: false, error: 'Unsupported' };
            }

            // iOS Safari check
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
            if (isIOS && !isStandalone) {
                alert('On iOS / iPhone, you must first tap Share ⎋ -> "Add to Home Screen" to enable push notifications.');
                return { success: false, error: 'iOS requires Home Screen installation' };
            }

            try {
                // Request Browser Notification Permission
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    alert('Notification permission was blocked or dismissed. Please allow notifications in your browser address bar settings.');
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

                const vapidKey = this.config ? this.config.vapid_public_key : '';

                let tokenString = 'browser-granted-' + Date.now();
                let subJson = null;

                if ('PushManager' in window && 'serviceWorker' in navigator) {
                    const registration = await navigator.serviceWorker.ready;
                    let subscription = await registration.pushManager.getSubscription();

                    if (!subscription) {
                        const subscribeOptions = { userVisibleOnly: true };
                        if (vapidKey) {
                            subscribeOptions.applicationServerKey = urlB64ToUint8Array(vapidKey);
                        }
                        try {
                            subscription = await registration.pushManager.subscribe(subscribeOptions);
                        } catch (subErr) {
                            console.warn('[Push] Native PushManager subscribe warning:', subErr);
                        }
                    }

                    if (subscription) {
                        subJson = subscription.toJSON();
                        tokenString = subscription.endpoint;
                    }
                }

                // Register token with backend DB
                const resp = await fetch('/api/notifications/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token: tokenString,
                        subscription: subJson,
                        topics: topics
                    })
                });

                const data = await resp.json();
                if (data.success) {
                    this.isSubscribed = true;
                    this.currentToken = tokenString;
                    this.updateToggleUi(true);

                    if (typeof window.showToast === 'function') {
                        window.showToast('🔔 Notifications enabled! You will receive Gold rates & Portfolio alerts.', 'success', 3500);
                    } else {
                        alert('🔔 Notifications enabled successfully! You will receive live market and portfolio alerts.');
                    }
                    return { success: true };
                } else {
                    throw new Error(data.error || 'Server rejected subscription');
                }
            } catch (err) {
                console.error('[Push] Subscription failed:', err);
                alert('Could not enable notifications: ' + err.message);
                return { success: false, error: err.message };
            }
        },

        unsubscribe: async function () {
            if (!this.isSupported()) return;

            try {
                if ('serviceWorker' in navigator && 'PushManager' in window) {
                    const registration = await navigator.serviceWorker.ready;
                    const subscription = await registration.pushManager.getSubscription();

                    if (subscription) {
                        const tokenString = subscription.endpoint;
                        await subscription.unsubscribe();

                        await fetch('/api/notifications/unsubscribe', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ token: tokenString })
                        });
                    }
                } else if (this.currentToken) {
                    await fetch('/api/notifications/unsubscribe', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: this.currentToken })
                    });
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
