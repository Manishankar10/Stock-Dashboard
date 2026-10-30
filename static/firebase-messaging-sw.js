// ==============================================================================
// CAPITAL DESK - FIREBASE CLOUD MESSAGING (FCM) SERVICE WORKER
// Web Push Notifications & Background Payload Handling
// ==============================================================================

// Optional Compat Firebase SDK (only attempted if online and supported)
try {
    if (typeof firebase === 'undefined' && self.navigator && self.navigator.onLine) {
        importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
        importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');
    }
} catch (e) {
    // Non-blocking: Standard W3C push handler below handles all notifications natively
}

// 1. Standard Web Push Protocol Handler (Guarded against double registration)
if (!self._cd_sw_push_registered) {
self._cd_sw_push_registered = true;
self.addEventListener('push', (event) => {
    let payload = {};
    if (event.data) {
        try {
            payload = event.data.json();
        } catch (err) {
            payload = {
                notification: {
                    title: 'Capital Desk Notification',
                    body: event.data.text()
                }
            };
        }
    }

    const notification = payload.notification || payload;
    const data = payload.data || {};

    const title = notification.title || 'Capital Desk Alert';
    const body = notification.body || 'New financial market update available.';
    const icon = notification.icon || '/static/favicon-192.png';
    const badge = notification.badge || '/static/favicon-32.png';
    const image = notification.image || data.image || null;
    const targetUrl = data.url || (notification.click_action || '/');

    const notificationOptions = {
        body: body,
        icon: icon,
        badge: badge,
        image: image,
        tag: data.tag || (data.type ? ('cd-' + data.type) : (data.timestamp ? ('cd-' + data.timestamp) : 'capital-desk-alert')),
        renotify: false,
        data: {
            url: targetUrl,
            timestamp: Date.now()
        },
        requireInteraction: true,
        vibrate: [200, 100, 200],
        actions: [
            { action: 'open', title: 'Open Capital Desk' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(title, notificationOptions)
    );
});

// 2. Notification Click Handling (Focus Existing or Open New Window)
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // If already open, focus it and navigate
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if (client.url && 'focus' in client) {
                    if (targetUrl && targetUrl !== '/') {
                        client.navigate(targetUrl);
                    }
                    return client.focus();
                }
            }
            // Otherwise open a new window
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});

}

// 3. Optional Compat Messaging initialization if config passed via message
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'INIT_FCM') {
        try {
            if (typeof firebase !== 'undefined' && !firebase.apps.length) {
                firebase.initializeApp(event.data.config);
                const messaging = firebase.messaging();
                messaging.onBackgroundMessage((payload) => {
                    console.log('[FCM-SW] Received background message via compat:', payload);
                });
            }
        } catch (err) {
            console.error('[FCM-SW] Failed to init compat Firebase:', err);
        }
    }
});
