// modules/upcoming_events/upcoming_events.js
// Standalone controller for Upcoming Events Component (Watchlist Split & Mobile Popup)

(function() {
    'use strict';

    let upcomingDataCache = null;
    let upcomingActiveWatchlist = '';
    let upcomingScope = 'watchlist'; // 'watchlist' | 'all'
    let isFetchingUpcoming = false;

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Fetch upcoming events from official API
     */
    async function loadUpcomingEvents(forceRefresh = false) {
        if (isFetchingUpcoming) return;
        isFetchingUpcoming = true;

        const currentWl = upcomingActiveWatchlist || (window.activeWatchlistName || '');
        const isAll = upcomingScope === 'all';
        const url = `/api/upcoming-events?watchlist=${encodeURIComponent(currentWl)}&all=${isAll ? 1 : 0}&refresh=${forceRefresh ? 1 : 0}`;

        // Show subtle loader if no cache
        const listEl = document.getElementById('upcoming-events-list');
        const modalListEl = document.getElementById('upcoming-modal-list');
        if (!upcomingDataCache && listEl) {
            listEl.innerHTML = `
                <div class="upcoming-skeleton-loader">
                    <div class="upcoming-skeleton-date"></div>
                    <div class="upcoming-skeleton-row"></div>
                    <div class="upcoming-skeleton-row"></div>
                    <div class="upcoming-skeleton-date" style="margin-top:14px;"></div>
                    <div class="upcoming-skeleton-row"></div>
                </div>
            `;
        }

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP error ${res.status}`);
            const data = await res.json();
            upcomingDataCache = data;
            renderUpcomingEventsUI(data);
        } catch (err) {
            console.error('Failed to load upcoming events:', err);
            if (!upcomingDataCache && listEl) {
                listEl.innerHTML = `
                    <div class="upcoming-empty-container">
                        <div class="upcoming-empty-icon">⚠️</div>
                        <div class="upcoming-empty-title">Events Unavailable</div>
                        <p class="upcoming-empty-desc">Could not connect to exchange feed. Please retry.</p>
                        <button type="button" class="upcoming-view-all-pill" onclick="window.loadUpcomingEvents(true)">Retry</button>
                    </div>
                `;
            }
        } finally {
            isFetchingUpcoming = false;
        }
    }

    /**
     * Build HTML markup for event date groups
     */
    function buildEventsHtml(dateGroups) {
        if (!dateGroups || !dateGroups.length) return '';

        return dateGroups.map(group => {
            const rowsHtml = group.events.map(ev => {
                const sym = escapeHtml(ev.symbol || '');
                const comp = escapeHtml(ev.company || ev.symbol || 'Company');
                const evType = (ev.type || '').toLowerCase();

                let badgeHtml = '';
                const badgeLabel = escapeHtml(ev.type_label || ev.badge_text || 'Event');
                if (evType === 'result') {
                    badgeHtml = `<span class="upcoming-badge result"><span class="upcoming-badge-icon">📊</span> ${badgeLabel}</span>`;
                } else if (evType === 'concall') {
                    const timeStr = escapeHtml(ev.time || ev.badge_text || 'Concall');
                    badgeHtml = `<span class="upcoming-badge concall"><span class="upcoming-badge-icon">📞</span> ${timeStr}</span>`;
                } else if (evType === 'ballot' || evType === 'agm' || evType === 'egm' || evType === 'meeting') {
                    badgeHtml = `<span class="upcoming-badge ballot"><span class="upcoming-badge-icon">🗳️</span> ${badgeLabel}</span>`;
                } else {
                    badgeHtml = `<span class="upcoming-badge default">${badgeLabel}</span>`;
                }

                return `
                    <div class="upcoming-event-row" onclick="window.upcomingEventStockClick('${sym}')" title="Click to view chart for ${sym}">
                        <div class="upcoming-company-info">
                            <span class="upcoming-company-name">${comp}</span>
                            <span class="upcoming-link-icon" title="View Chart">↗</span>
                        </div>
                        ${badgeHtml}
                    </div>
                `;
            }).join('');

            return `
                <div class="upcoming-date-group">
                    <div class="upcoming-date-header">${escapeHtml(group.date_header || group.date)}</div>
                    <div class="upcoming-group-items">
                        ${rowsHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Render data into both desktop split-screen card and responsive mobile modal
     */
    function renderUpcomingEventsUI(data) {
        if (!data) return;

        const currentWl = upcomingActiveWatchlist || (window.activeWatchlistName || 'Watchlist');
        const isAll = upcomingScope === 'all';
        const displayTitle = isAll ? 'All Market Stocks' : currentWl;

        // 1. Update Subtitles
        const subTitleEl = document.getElementById('upcoming-active-wl-title');
        if (subTitleEl) subTitleEl.innerText = `${displayTitle} (${data.total_events || 0})`;

        const modalWlEl = document.getElementById('upcoming-modal-wl-name');
        if (modalWlEl) modalWlEl.innerText = `${displayTitle} (${data.total_events || 0})`;

        // 2. Update Scope Button
        const scopeBtn = document.getElementById('upcoming-scope-label');
        if (scopeBtn) {
            scopeBtn.innerText = isAll ? 'Watchlist' : 'All';
            const btnParent = document.getElementById('upcoming-toggle-scope-btn');
            if (btnParent) {
                btnParent.title = isAll ? 'Switch to active watchlist' : 'Switch to all market events';
            }
        }

        // 3. Update Mobile Badge Counter in Watchlist bar
        const badgeCountEls = document.querySelectorAll('.wl-upcoming-badge-count');
        badgeCountEls.forEach(el => {
            el.innerText = data.total_events || 0;
            el.style.display = (data.total_events && data.total_events > 0) ? 'inline-block' : 'none';
        });

        // 4. Render Desktop List
        const listEl = document.getElementById('upcoming-events-list');
        const emptyEl = document.getElementById('upcoming-empty-container');
        const emptyDescEl = document.getElementById('upcoming-empty-desc');

        const hasEvents = data.date_groups && data.date_groups.length > 0;

        if (listEl) {
            if (hasEvents) {
                listEl.innerHTML = buildEventsHtml(data.date_groups);
                listEl.style.display = 'block';
                if (emptyEl) emptyEl.style.display = 'none';
            } else {
                listEl.innerHTML = '';
                listEl.style.display = 'none';
                if (emptyEl) {
                    emptyEl.style.display = 'block';
                    if (emptyDescEl) {
                        emptyDescEl.innerText = `No upcoming Results, AGMs, or Concalls announced for ${displayTitle}.`;
                    }
                }
            }
        }

        // 5. Render Mobile Modal List
        const modalListEl = document.getElementById('upcoming-modal-list');
        if (modalListEl) {
            if (hasEvents) {
                modalListEl.innerHTML = buildEventsHtml(data.date_groups);
            } else {
                modalListEl.innerHTML = `
                    <div class="upcoming-empty-container" style="display:block;">
                        <div class="upcoming-empty-icon">📅</div>
                        <div class="upcoming-empty-title">No upcoming events</div>
                        <p class="upcoming-empty-desc">No Results, AGMs, or Concalls announced for ${displayTitle}.</p>
                        <button type="button" class="upcoming-view-all-pill" onclick="window.toggleUpcomingScope(true)">
                            View All Market Events
                        </button>
                    </div>
                `;
            }
        }
    }

    /**
     * Entrypoint called whenever watchlist switches
     */
    function renderUpcomingEvents(watchlistName = null) {
        const targetWl = watchlistName || window.activeWatchlistName || '';
        if (targetWl && targetWl !== upcomingActiveWatchlist) {
            upcomingActiveWatchlist = targetWl;
            loadUpcomingEvents();
        } else if (!upcomingDataCache) {
            upcomingActiveWatchlist = targetWl;
            loadUpcomingEvents();
        } else {
            renderUpcomingEventsUI(upcomingDataCache);
        }
    }

    /**
     * Toggle Scope (All Market vs Active Watchlist)
     */
    function toggleUpcomingScope(forceAll = false) {
        if (forceAll) {
            upcomingScope = 'all';
        } else {
            upcomingScope = (upcomingScope === 'all') ? 'watchlist' : 'all';
        }
        loadUpcomingEvents();
    }

    /**
     * Responsive Glassy Modal Functions
     */
    function openUpcomingEventsModal() {
        const modal = document.getElementById('upcomingEventsModal');
        if (!modal) return;
        
        // Re-render latest data into modal
        if (upcomingDataCache) {
            renderUpcomingEventsUI(upcomingDataCache);
        } else {
            loadUpcomingEvents();
        }

        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // Lock background scroll on mobile
    }

    function closeUpcomingEventsModal() {
        const modal = document.getElementById('upcomingEventsModal');
        if (!modal) return;
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }

    /**
     * Stock Chart Interaction Handler
     */
    function upcomingEventStockClick(symbol) {
        if (!symbol) return;
        // Close mobile sheet if open
        closeUpcomingEventsModal();

        if (typeof window.openInHouseChart === 'function') {
            window.openInHouseChart(symbol);
        } else if (typeof openInHouseChart === 'function') {
            openInHouseChart(symbol);
        }
    }

    // Escape key listener to close modal
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeUpcomingEventsModal();
        }
    });

    // Expose global methods
    window.loadUpcomingEvents = loadUpcomingEvents;
    window.renderUpcomingEvents = renderUpcomingEvents;
    window.toggleUpcomingScope = toggleUpcomingScope;
    window.openUpcomingEventsModal = openUpcomingEventsModal;
    window.closeUpcomingEventsModal = closeUpcomingEventsModal;
    window.upcomingEventStockClick = upcomingEventStockClick;

    // Auto-init on page ready
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (window.activeWatchlistName) {
                renderUpcomingEvents(window.activeWatchlistName);
            }
        }, 300);
    });

})();
