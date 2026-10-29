// =========================================================
// CAPITAL DESK - SINGLE PAGE APPLICATION (SPA) ROUTER
// Location: static/js/core/router.js
// Handles instant zero-flicker client-side view transitions
// and syncs browser History API (pushState & popstate).
// =========================================================
// currentTab is already declared globally in app-core.js
window.currentTab = window.currentTab || 'watchlists';

const AppRouter = {
    pathMap: {
        'watchlists': '/watchlists',
        'portfolios': '/portfolios',
        'dashboard': '/analytics',
        'insights': '/insights',
        'smallcases': '/smallcases',
        'mutual-funds': '/mutual-funds',
        'mutual-fund-detail': '/mutual-funds',
        'ipos': '/ipos',
        'plan-calculator': '/plan-calculator',
        'corporate-actions': '/corporate-actions',
        'quarterly-results': '/quarterly-results',
        'transactions': '/transactions',
        'sector-rotation': '/sector-rotation',
        'industries-overview': '/industries-overview',
        'shareholding': '/shareholding',
        'peoples': '/peoples',
        'technical-screener': '/technical-screener'
    },

    reverseMap: {
        '/': 'watchlists',
        '/watchlists': 'watchlists',
        '/portfolios': 'portfolios',
        '/analytics': 'dashboard',
        '/insights': 'insights',
        '/smallcases': 'smallcases',
        '/mutual-funds': 'mutual-funds',
        '/mutual-funds/dashboard': 'mutual-funds',
        '/ipos': 'ipos',
        '/plan-calculator': 'plan-calculator',
        '/corporate-actions': 'corporate-actions',
        '/quarterly-results': 'quarterly-results',
        '/transactions': 'transactions',
        '/sector-rotation': 'sector-rotation',
        '/industries-overview': 'industries-overview',
        '/shareholding': 'shareholding',
        '/peoples': 'peoples',
        '/technical-screener': 'technical-screener'
    },

    closeAnyOpenModalOrDrawer() {
        // Helper to check computed visibility
        const isElVisible = (el) => {
            if (!el || !(el instanceof HTMLElement)) return false;
            if (el.hasAttribute('hidden') || el.closest('[hidden]')) return false;
            if (el.style.display === 'none' || el.classList.contains('hidden')) return false;
            try {
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
            } catch (e) {
                return false;
            }
            if (el.offsetWidth === 0 && el.offsetHeight === 0 && el.getClientRects().length === 0) {
                return false;
            }
            return true;
        };

        // 1. Popover menus, dropdowns, and floating tooltips (highest layer)
        const popover = document.getElementById('tx-deal-fields-popover');
        if (isElVisible(popover)) {
            if (typeof window.hideDealFieldsPopover === 'function') {
                window.hideDealFieldsPopover();
            }
            popover.style.display = 'none';
            if (window.ModalHistoryManager) window.ModalHistoryManager.remove(popover);
            return true;
        }

        const activePopover = document.querySelector('.chart-popover-menu.show, .popover.show');
        if (activePopover && isElVisible(activePopover)) {
            activePopover.classList.remove('show');
            activePopover.style.display = 'none';
            if (window.ModalHistoryManager) window.ModalHistoryManager.remove(activePopover);
            return true;
        }

        const openDropdowns = document.querySelectorAll('.upcoming-dropdown-menu.show, .action-dropdown-menu.show, .menu-dropdown-wrapper.active');
        if (openDropdowns.length > 0) {
            openDropdowns.forEach(d => {
                d.classList.remove('show');
                d.classList.remove('active');
            });
            return true;
        }

        // 2. System modal dialog / confirmation prompt
        const customModalOverlay = document.getElementById('customModalOverlay');
        if (isElVisible(customModalOverlay)) {
            if (typeof window.__systemModalCancel === 'function') {
                window.__systemModalCancel();
            } else {
                const cancelBtn = document.getElementById('customModalCancelBtn');
                if (cancelBtn && cancelBtn.style.display !== 'none') {
                    cancelBtn.click();
                } else {
                    customModalOverlay.style.setProperty('display', 'none', 'important');
                }
            }
            if (window.ModalHistoryManager) window.ModalHistoryManager.remove(customModalOverlay);
            return true;
        }

        // 3. Transactions Custom Screener Modal
        const txModal = document.getElementById('tx-custom-modal');
        if (isElVisible(txModal)) {
            if (typeof window.closeTxCustomModal === 'function') {
                window.closeTxCustomModal();
            } else {
                txModal.style.display = 'none';
            }
            if (window.ModalHistoryManager) window.ModalHistoryManager.remove(txModal);
            return true;
        }

        // 4. Quarterly Results Screener & Mobile Filter Modals
        const qrMobileModal = document.getElementById('qrMobileFilterModal');
        if (isElVisible(qrMobileModal)) {
            if (typeof window.closeQrMobileFilter === 'function') {
                window.closeQrMobileFilter();
            } else {
                qrMobileModal.style.display = 'none';
            }
            if (window.ModalHistoryManager) window.ModalHistoryManager.remove(qrMobileModal);
            return true;
        }

        const qrModal = document.getElementById('qr-custom-modal');
        if (isElVisible(qrModal)) {
            if (typeof window.closeQrCustomModal === 'function') {
                window.closeQrCustomModal();
            } else {
                qrModal.style.display = 'none';
            }
            if (window.ModalHistoryManager) window.ModalHistoryManager.remove(qrModal);
            return true;
        }

        // 5. Shareholding Screener Modal
        const shpModal = document.getElementById('shp-custom-modal');
        if (isElVisible(shpModal)) {
            if (typeof window.closeShpCustomModal === 'function') {
                window.closeShpCustomModal();
            } else {
                const closeBtn = document.getElementById('shp-custom-modal-close');
                if (closeBtn) closeBtn.click();
                else shpModal.style.display = 'none';
            }
            if (window.ModalHistoryManager) window.ModalHistoryManager.remove(shpModal);
            return true;
        }

        // 6. Portfolio Analytics Details Modal / Mobile Sheet
        const paModal = document.getElementById('pa-details-modal');
        if (isElVisible(paModal)) {
            if (typeof window.closePaModal === 'function') {
                window.closePaModal();
            } else {
                paModal.style.display = 'none';
            }
            if (window.ModalHistoryManager) window.ModalHistoryManager.remove(paModal);
            return true;
        }

        // 7. Analyser detail modal / sheet
        const analyserModal = document.getElementById('analyserDetailModal');
        if (analyserModal && (analyserModal.classList.contains('show') || isElVisible(analyserModal))) {
            if (typeof window.closeAnalyserModal === 'function') {
                window.closeAnalyserModal();
            } else {
                analyserModal.classList.remove('show');
                analyserModal.style.display = 'none';
            }
            if (window.ModalHistoryManager) window.ModalHistoryManager.remove(analyserModal);
            return true;
        }

        // 8. Stock Detail Chart Modal
        const chartModal = document.getElementById('chart-modal') || document.getElementById('chartModal');
        if (chartModal && (chartModal.classList.contains('show') || isElVisible(chartModal))) {
            if (typeof window.closeChartModal === 'function') {
                window.closeChartModal();
            } else {
                chartModal.classList.remove('show');
                chartModal.style.display = 'none';
            }
            if (window.ModalHistoryManager) window.ModalHistoryManager.remove(chartModal);
            return true;
        }

        // 9. Fundamentals Modal
        const fundModal = document.getElementById('fundamentals-modal');
        if (fundModal && (fundModal.classList.contains('show') || isElVisible(fundModal))) {
            if (typeof window.closeFundamentalsModal === 'function') {
                window.closeFundamentalsModal();
            } else {
                fundModal.classList.remove('show');
                fundModal.style.display = 'none';
            }
            if (window.ModalHistoryManager) window.ModalHistoryManager.remove(fundModal);
            return true;
        }

        // 10. Holding Details Modal
        const holdingModal = document.getElementById('holdingDetailModal') || document.getElementById('holding-details-modal');
        if (holdingModal && (holdingModal.classList.contains('show') || isElVisible(holdingModal))) {
            if (typeof window.closeHoldingDetailsModal === 'function') {
                window.closeHoldingDetailsModal();
            } else {
                holdingModal.classList.remove('show');
                holdingModal.style.display = 'none';
            }
            if (window.ModalHistoryManager) window.ModalHistoryManager.remove(holdingModal);
            return true;
        }

        // 11. Notifications Modal
        const notifModal = document.getElementById('notificationsModal');
        if (notifModal && (notifModal.classList.contains('show') || isElVisible(notifModal))) {
            if (typeof window.closeNotificationsModal === 'function') {
                window.closeNotificationsModal();
            } else {
                notifModal.classList.remove('show');
                notifModal.style.display = 'none';
            }
            if (window.ModalHistoryManager) window.ModalHistoryManager.remove(notifModal);
            return true;
        }

        // 12. Edit Drawing Modal
        const editDrawingModal = document.getElementById('editDrawingModal');
        if (isElVisible(editDrawingModal)) {
            if (typeof window.closeEditDrawingModal === 'function') {
                window.closeEditDrawingModal();
            } else {
                editDrawingModal.style.display = 'none';
            }
            if (window.ModalHistoryManager) window.ModalHistoryManager.remove(editDrawingModal);
            return true;
        }

        // 13. Universal Topmost Modal Scanner (catches any visible modal by z-index)
        const allVisibleModals = Array.from(document.querySelectorAll(
            '.modal, .small-modal, .fundamentals-modal, .mf-modal-backdrop, .br-modal-overlay, .of-modal-overlay, .qr-glass-modal, .qr-custom-modal-backdrop, .shp-custom-modal-backdrop, .tx-custom-modal-backdrop, .modal-backdrop, .modal-overlay, .pa-modal-overlay, [role="dialog"], [id$="Modal"], [id$="-modal"], [id$="_modal"]'
        )).filter(m => {
            if (!m || m.id === 'customModalOverlay') return false;
            return isElVisible(m);
        });

        if (allVisibleModals.length > 0) {
            allVisibleModals.sort((a, b) => {
                const zA = parseInt(window.getComputedStyle(a).zIndex, 10) || 0;
                const zB = parseInt(window.getComputedStyle(b).zIndex, 10) || 0;
                return zB - zA;
            });
            const topM = allVisibleModals[0];
            const closeBtn = topM.querySelector('.close-btn, .modal-close-btn, .pa-modal-close-btn, .br-close-btn, [data-dismiss="modal"], .btn-close, .close, [aria-label="Close"], .modal-close');
            if (closeBtn) {
                closeBtn.click();
            }
            topM.classList.remove('show');
            topM.classList.remove('open');
            topM.classList.remove('active');
            topM.style.setProperty('display', 'none', 'important');
            if (window.ModalHistoryManager) window.ModalHistoryManager.remove(topM);
            return true;
        }

        // 14. Mobile Sidebar Drawer (closes when no modal/popover is above it)
        const appSidebar = document.getElementById('app-sidebar') || document.getElementById('mobile-sidebar') || document.querySelector('.sidebar');
        const sidebarBackdrop = document.getElementById('sidebar-backdrop') || document.querySelector('.mobile-sidebar-backdrop');
        if (document.body.classList.contains('mobile-menu-open') || 
            (appSidebar && (appSidebar.classList.contains('mobile-open') || appSidebar.classList.contains('open'))) ||
            (sidebarBackdrop && sidebarBackdrop.classList.contains('mobile-open'))) {
            if (typeof window.toggleMobileSidebar === 'function') {
                window.toggleMobileSidebar(false);
            }
            if (typeof window.closeMobileSidebarOnSelect === 'function') {
                window.closeMobileSidebarOnSelect();
            }
            document.body.classList.remove('mobile-menu-open');
            document.body.style.overflow = '';
            if (appSidebar) {
                appSidebar.classList.remove('mobile-open');
                appSidebar.classList.remove('open');
            }
            if (sidebarBackdrop) sidebarBackdrop.classList.remove('mobile-open');
            return true;
        }

        return false;
    },

    init() {
        // Intercept clicks on links that have data-spa-route or internal sidebar links
        document.addEventListener('click', (e) => {
            const mfLink = e.target.closest('a.mf-detail-link, a.mf-similar-row');
            if (mfLink && mfLink.getAttribute('href') && mfLink.getAttribute('href').startsWith('/mutual-funds/fund/')) {
                const href = mfLink.getAttribute('href');
                const code = href.split('/mutual-funds/fund/')[1]?.split('/')[0];
                if (code) {
                    e.preventDefault();
                    if (typeof window.loadFundDetail === 'function') {
                        window.loadFundDetail(code);
                    }
                    switchTab('mutual-fund-detail');
                    try { window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
                    if (document.documentElement) document.documentElement.scrollTop = 0;
                    if (document.body) document.body.scrollTop = 0;
                    return;
                }
            }

            const link = e.target.closest('a[data-spa-route], button[data-spa-route]');
            if (!link) return;

            const route = link.getAttribute('data-spa-route');
            if (route) {
                e.preventDefault();
                this.navigate(route);
            }
        });

        // Establish root history barrier to prevent accidental exit from the app or back-navigation to login
        const initialTab = window.INITIAL_TAB || this.reverseMap[window.location.pathname] || 'watchlists';
        const initialPath = window.location.pathname === '/' ? '/watchlists' : window.location.pathname;

        try {
            window.history.replaceState({ tab: initialTab, isBarrier: true }, '', initialPath);
            window.history.pushState({ tab: initialTab, isAppActive: true }, '', initialPath);
        } catch (e) {}

        // Check for ?chart= query parameter on initial load
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const chartSym = urlParams.get('chart');
            if (chartSym) {
                setTimeout(() => {
                    if (typeof window.openInHouseChart === 'function') {
                        window.openInHouseChart(chartSym);
                    }
                }, 400);
            }
        } catch (e) {}

        // Listen for browser Back / Forward buttons & swipe navigation
        window.addEventListener('popstate', (event) => {
            // 0. Suppress programmatic pop from UI close (e.g. tap '✕', 'Cancel', or backdrop)
            if (window.ModalHistoryManager && window.ModalHistoryManager._suppressPopstate) {
                window.ModalHistoryManager._suppressPopstate = false;
                return;
            }

            // Priority 1: If any modal, sheet, drawer, or dropdown is open, dismiss it and maintain current route
            if (window.ModalHistoryManager) {
                window.ModalHistoryManager._isHandlingPopstate = true;
            }
            let modalDismissed = false;
            try {
                modalDismissed = this.closeAnyOpenModalOrDrawer();
            } finally {
                if (window.ModalHistoryManager) {
                    window.ModalHistoryManager._isHandlingPopstate = false;
                }
            }

            if (modalDismissed) {
                // If popping the modal caused state to revert to another tab or barrier, restore current route state
                if (!event.state || event.state.tab !== currentTab) {
                    const routeMap = (typeof AppRouter !== 'undefined' && AppRouter.routeMap) ? AppRouter.routeMap : (this.routeMap || {});
                    const currentPath = routeMap[currentTab] || window.location.pathname;
                    window.history.pushState({ tab: currentTab, isAppActive: true }, '', currentPath);
                }
                return;
            }

            // Priority 2: If we hit the root barrier or empty state, prevent exiting the app
            if (!event.state || event.state.isBarrier) {
                if (currentTab !== 'watchlists') {
                    // Navigate to primary watchlists hub first
                    switchTab('watchlists', true);
                } else {
                    // Stay securely inside Capital Desk and re-arm barrier
                    window.history.pushState({ tab: 'watchlists', isAppActive: true }, '', '/watchlists');
                    if (typeof showToast === 'function') {
                        showToast('App exit prevented • Session active for 24 hours', 'info', 1800);
                    }
                }
                return;
            }

            // Priority 3: Normal SPA back/forward tab switching
            if (event.state && event.state.tab) {
                switchTab(event.state.tab, false);
            } else {
                const path = window.location.pathname;
                let tab = this.reverseMap[path];
                if (!tab && path.startsWith('/mutual-funds/fund/')) {
                    tab = 'mutual-fund-detail';
                }
                switchTab(tab || 'watchlists', false);
            }
        });
    },

    navigate(tabOrPath) {
        let tab = tabOrPath;
        if (this.reverseMap[tabOrPath]) {
            tab = this.reverseMap[tabOrPath];
        } else if (typeof tabOrPath === 'string' && tabOrPath.startsWith('/mutual-funds/fund/')) {
            tab = 'mutual-fund-detail';
            const code = tabOrPath.split('/mutual-funds/fund/')[1]?.split('/')[0];
            if (code && typeof window.loadFundDetail === 'function') {
                window.loadFundDetail(code);
            }
        }
        switchTab(tab, true);
    }
};

// Global switchTab function (replaces monolithic inline switchTab)
function switchTab(tabName, pushState = true) {
    if (!tabName) tabName = 'watchlists';
    currentTab = tabName;
    window.currentTab = tabName;

    // 1. Update navigation items active state in sidebar and buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.sidebar-nav-item').forEach(item => item.classList.remove('active'));
    
    const activeNavKey = tabName === 'mutual-fund-detail' ? 'mutual-funds' : (tabName === 'dashboard' ? 'portfolios' : tabName);
    const btnEl = document.getElementById(`btn-tab-${activeNavKey}`);
    const sidebarNavEl = document.getElementById(`sidebar-nav-${activeNavKey}`);
    if (btnEl) btnEl.classList.add('active');
    if (sidebarNavEl) sidebarNavEl.classList.add('active');

    // Highlight parent Market Pulse or Tools button if a sub-tab is active
    const isMarketPulse = ['ipos', 'corporate-actions', 'quarterly-results', 'transactions', 'sector-rotation', 'industries-overview', 'shareholding', 'peoples'].includes(tabName);
    const marketPulseTrigger = document.getElementById('sidebar-nav-market-pulse');
    if (marketPulseTrigger) {
        marketPulseTrigger.classList.toggle('active', isMarketPulse);
    }
    if (typeof closeMarketPulseSubmenu === 'function') {
        closeMarketPulseSubmenu();
    }

    const isTool = ['mutual-funds', 'mutual-fund-detail', 'plan-calculator', 'technical-screener'].includes(tabName);
    const toolsTrigger = document.getElementById('sidebar-nav-tools');
    if (toolsTrigger) {
        toolsTrigger.classList.toggle('active', isTool);
    }
    if (typeof closeToolsSubmenu === 'function') {
        closeToolsSubmenu();
    }

    // 2. Smoothly switch active tab-content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
        content.style.display = 'none';
    });

    const targetTabEl = document.getElementById(`tab-${tabName}`);
    if (targetTabEl) {
        targetTabEl.style.display = 'block';
        // Force a reflow for smooth hardware-accelerated CSS transition
        requestAnimationFrame(() => {
            targetTabEl.classList.add('active');
        });
        if (tabName === 'mutual-fund-detail') {
            try { window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
            if (document.documentElement) document.documentElement.scrollTop = 0;
            if (document.body) document.body.scrollTop = 0;
            const mainContentWrapper = document.querySelector('.main-content-wrapper');
            if (mainContentWrapper) mainContentWrapper.scrollTop = 0;
        }
    } else {
        // If target tab does not exist in current DOM (e.g. on fund detail page), navigate to SPA route
        const routePath = AppRouter.pathMap[tabName] || '/watchlists';
        window.location.href = routePath;
        return;
    }

    // 3. Sync browser History state
    if (pushState) {
        let routePath = AppRouter.pathMap[tabName] || '/watchlists';
        if (tabName === 'mutual-fund-detail') {
            const currentCode = (document.querySelector('.mf-detail-shell')?.dataset?.schemeCode) || window.INITIAL_SCHEME_CODE || '';
            if (currentCode) routePath = '/mutual-funds/fund/' + encodeURIComponent(currentCode);
        }
        if (window.location.pathname !== routePath) {
            window.history.pushState({ tab: tabName, isAppActive: true }, '', routePath);
        }
    }

    // 4. Trigger view-specific renderers
    if (tabName === 'dashboard') {
        if (!window.portfoliosLoaded && typeof fetchPortfolios === 'function') {
            fetchPortfolios().then(() => {
                if (typeof renderDashboard === 'function') renderDashboard();
                if (typeof refreshPrices === 'function') refreshPrices();
            });
        } else {
            if (typeof renderDashboard === 'function') renderDashboard();
            if (typeof refreshPrices === 'function') refreshPrices();
        }
    } else if (tabName === 'insights') {
        if (typeof showInsightsSkeletons === 'function') showInsightsSkeletons();
        if (!window.portfoliosLoaded && typeof fetchPortfolios === 'function') {
            fetchPortfolios().then(() => {
                if (typeof loadInsightsTab === 'function') loadInsightsTab();
            });
        } else {
            if (typeof loadInsightsTab === 'function') loadInsightsTab();
        }
    } else if (tabName === 'smallcases') {
        if (typeof loadSmallcasesTab === 'function') loadSmallcasesTab();
    } else if (tabName === 'watchlists') {
        if (typeof renderWatchlists === 'function') renderWatchlists();
        if (!window.watchlistsLoaded && typeof fetchWatchlists === 'function') {
            fetchWatchlists();
        } else if (typeof refreshPrices === 'function') {
            refreshPrices().then(() => {
                if (typeof renderWatchlists === 'function') renderWatchlists();
            });
        }
    } else if (tabName === 'portfolios') {
        if (!window.portfoliosLoaded && typeof fetchPortfolios === 'function') {
            if (typeof renderPortfolioSkeletons === 'function') renderPortfolioSkeletons();
            fetchPortfolios();
        } else {
            if (typeof renderPortfolios === 'function') renderPortfolios();
            if (typeof refreshPrices === 'function') refreshPrices();
        }
    } else if (tabName === 'mutual-funds') {
        if (typeof window.switchMfSubView === 'function') window.switchMfSubView('portfolio');
        else if (typeof window.refreshMfDashboard === 'function') window.refreshMfDashboard();
    } else if (tabName === 'mutual-fund-detail') {
        const currentCode = (document.querySelector('.mf-detail-shell')?.dataset?.schemeCode) || window.INITIAL_SCHEME_CODE || '';
        if (currentCode && typeof window.loadFundDetail === 'function') {
            window.loadFundDetail(currentCode);
        }
    } else if (tabName === 'ipos') {
        if (typeof window.loadIpos === 'function') window.loadIpos();
    } else if (tabName === 'plan-calculator') {
        if (typeof window.loadPlanCalculatorState === 'function') window.loadPlanCalculatorState();
        else if (typeof window.renderCalculator === 'function') window.renderCalculator();
    } else if (tabName === 'corporate-actions') {
        if (typeof window.loadCorporateActions === 'function') window.loadCorporateActions();
        else if (typeof window.renderCorporateActions === 'function') window.renderCorporateActions();
    } else if (tabName === 'quarterly-results') {
        if (typeof window.loadQuarterlyResults === 'function') window.loadQuarterlyResults();
    } else if (tabName === 'transactions') {
        if (typeof window.loadTransactionsModule === 'function') window.loadTransactionsModule();
    } else if (tabName === 'sector-rotation') {
        if (typeof window.loadSectorRotationModule === 'function') window.loadSectorRotationModule();
    } else if (tabName === 'shareholding') {
        if (typeof window.loadShareholding === 'function') window.loadShareholding();
    } else if (tabName === 'peoples') {
        if (typeof window.loadPeoplesModule === 'function') window.loadPeoplesModule();
    } else if (tabName === 'industries-overview') {
        if (typeof window.loadIndustriesOverviewModule === 'function') window.loadIndustriesOverviewModule();
    } else if (tabName === 'technical-screener') {
        if (typeof window.loadTechnicalScreenerModule === 'function') window.loadTechnicalScreenerModule();
    }

    // 5. Automatically close submenus and mobile drawer if open
    if (typeof closeMarketPulseSubmenu === 'function') {
        closeMarketPulseSubmenu();
    }
    if (typeof closeToolsSubmenu === 'function') {
        closeToolsSubmenu();
    }
    if (typeof closeMobileSidebarOnSelect === 'function') {
        closeMobileSidebarOnSelect();
    }
    if (typeof updateMobileHeaderActiveBadge === 'function') {
        updateMobileHeaderActiveBadge();
    }
}

// Initialize Router when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    AppRouter.init();
});
