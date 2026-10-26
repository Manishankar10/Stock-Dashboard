// =========================================================
// CAPITAL DESK - PWA MANAGER & CLIENT CONTROLLER
// Lifecycle registration, install prompt & offline sync
// =========================================================

(function () {
    'use strict';

    let deferredInstallPrompt = null;
    let isServiceWorkerRegistered = false;

    // Detect if running as standalone installed PWA
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                         window.navigator.standalone === true ||
                         document.referrer.includes('android-app://');

    window.isPWA = isStandalone;

    if (isStandalone) {
        document.documentElement.classList.add('pwa-standalone');
        if (document.body) {
            document.body.classList.add('pwa-standalone');
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                document.body.classList.add('pwa-standalone');
            });
        }
    }

    // 1. Service Worker Registration
    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) {
            return;
        }

        // Only register on http(s) or localhost
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            return;
        }

        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then((registration) => {
                isServiceWorkerRegistered = true;

                // Handle background updates to Service Worker
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    if (!newWorker) return;

                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            if (typeof window.showToast === 'function') {
                                window.showToast('App update available • Reloading with latest features...', 'info', 3000);
                            }
                            setTimeout(() => {
                                window.location.reload();
                            }, 1500);
                        }
                    });
                });
            })
            .catch((error) => {
                console.warn('[PWA] Service Worker registration failed:', error);
            });

        // Ensure refresh once when new SW claims clients
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                refreshing = true;
            }
        });
    }

    // 2. Install Prompt Capture & Custom UI Controls
    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent default mini-infobar from automatically appearing
        e.preventDefault();
        deferredInstallPrompt = e;
        window.deferredInstallPrompt = e;

        // Reveal any install buttons or banners in the DOM
        updateInstallUiVisibility(true);

        window.dispatchEvent(new CustomEvent('cd:pwa-installable'));
    });

    // 3. User Triggered Install Function
    window.installPwa = async function () {
        if (!deferredInstallPrompt) {
            if (isStandalone) {
                if (typeof window.showToast === 'function') {
                    window.showToast('Capital Desk is already installed and running as a native app.', 'info', 2500);
                }
            } else {
                if (typeof window.showToast === 'function') {
                    window.showToast('To install: tap your browser menu (⋮ or Share) and select "Add to Home Screen".', 'info', 4500);
                }
            }
            return false;
        }

        try {
            deferredInstallPrompt.prompt();
            const { outcome } = await deferredInstallPrompt.userChoice;
            if (outcome === 'accepted') {
                updateInstallUiVisibility(false);
            }
            deferredInstallPrompt = null;
            window.deferredInstallPrompt = null;
            return outcome === 'accepted';
        } catch (err) {
            console.warn('[PWA] Install prompt failed:', err);
            return false;
        }
    };

    // 4. App Installed Listener
    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        window.deferredInstallPrompt = null;
        updateInstallUiVisibility(false);
        if (typeof window.showToast === 'function') {
            window.showToast('Capital Desk installed successfully! Launch it anytime from your home screen or desktop.', 'success', 4000);
        }
    });

    function updateInstallUiVisibility(show) {
        if (isStandalone) show = false;
        const installBtns = document.querySelectorAll('.pwa-install-btn, #btn-pwa-install, #sidebar-pwa-install');
        installBtns.forEach(btn => {
            btn.style.display = show ? 'inline-flex' : 'none';
        });
    }

    // 5. Online / Offline Connectivity Notifications
    window.addEventListener('offline', () => {
        document.body.classList.add('cd-offline');
        if (typeof window.showToast === 'function') {
            window.showToast('Offline Mode • You are currently disconnected. Market feeds will pause.', 'warning', 4000);
        }
    });

    window.addEventListener('online', () => {
        document.body.classList.remove('cd-offline');
        if (typeof window.showToast === 'function') {
            window.showToast('Internet connection restored • Live market data reconnected.', 'success', 3000);
        }
    });

    // Initialize registration on page load
    if (document.readyState === 'complete') {
        registerServiceWorker();
    } else {
        window.addEventListener('load', registerServiceWorker);
    }
})();
