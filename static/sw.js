// =========================================================
// CAPITAL DESK - SERVICE WORKER (PWA)
// Institutional Offline Resilience & App Shell Caching
// =========================================================

const CACHE_VERSION = 'v1.0.2';
const STATIC_CACHE = `capital-desk-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `capital-desk-runtime-${CACHE_VERSION}`;

// Core App Shell assets to precache during install
const PRECACHE_ASSETS = [
    '/offline',
    '/static/manifest.json',
    '/static/favicon.ico',
    '/static/favicon-192.png',
    '/static/favicon-512.png',
    '/static/apple-touch-icon.png',
    '/static/icon-maskable-192.png',
    '/static/icon-maskable-512.png',
    '/static/css/common.css',
    '/static/css/responsive.css',
    '/static/js/core/app-core.js',
    '/static/js/core/router.js',
    '/static/js/core/pwa.js'
];

// 1. Install Event: Cache app shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => {
            return cache.addAll(PRECACHE_ASSETS).catch((err) => {
                console.warn('[SW] Some precache assets failed:', err);
            });
        }).then(() => {
            // Force active state immediately without waiting for browser restart
            return self.skipWaiting();
        })
    );
});

// 2. Activate Event: Clean up outdated caches & claim clients
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((name) => {
                    if (name !== STATIC_CACHE && name !== RUNTIME_CACHE) {
                        return caches.delete(name);
                    }
                })
            );
        }).then(() => {
            return self.clients.claim();
        })
    );
});

// 3. Fetch Event: Routing & Caching Strategies
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // Bypass non-GET requests (e.g. POST / PUT / DELETE)
    if (request.method !== 'GET') {
        return;
    }

    // Bypass browser-extension requests or non-http protocols
    if (!url.protocol.startsWith('http')) {
        return;
    }

    // STRATEGY A: Navigation requests (HTML pages)
    // Network-First with cached fallback, ultimately falling back to /offline
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(RUNTIME_CACHE).then((cache) => {
                        cache.put(request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(async () => {
                const cachedPage = await caches.match(request);
                if (cachedPage) {
                    return cachedPage;
                }
                const offlinePage = await caches.match('/offline');
                return offlinePage || new Response('Offline - No connection', {
                    status: 503,
                    headers: { 'Content-Type': 'text/plain' }
                });
            })
        );
        return;
    }

    // STRATEGY B: Live Financial API Requests (/api/*)
    // Network-First: Always fetch real-time market data first.
    // Fallback to cache only when disconnected.
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(RUNTIME_CACHE).then((cache) => {
                        cache.put(request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(async () => {
                const cachedApiResponse = await caches.match(request);
                if (cachedApiResponse) {
                    return cachedApiResponse;
                }
                return new Response(JSON.stringify({
                    offline: true,
                    error: 'Network connection unavailable. Real-time market data paused.'
                }), {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                });
            })
        );
        return;
    }

    // STRATEGY C: Static Assets (/static/*, CSS, JS, Fonts, Images)
    // Stale-While-Revalidate for maximum UI speed and offline availability
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            const fetchPromise = fetch(request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(STATIC_CACHE).then((cache) => {
                        cache.put(request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Ignore network errors for background revalidation
            });

            return cachedResponse || fetchPromise;
        })
    );
});

// 4. Message Event: Allow web clients to command service worker
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
