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
        'sector-rotation': '/sector-rotation'
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
        '/sector-rotation': 'sector-rotation'
    },

    closeAnyOpenModalOrDrawer() {
        let dismissed = false;

        // 1. System modal dialog
        const customModalOverlay = document.getElementById('customModalOverlay');
        if (customModalOverlay && (customModalOverlay.style.display === 'flex' || window.getComputedStyle(customModalOverlay).display === 'flex')) {
            customModalOverlay.style.setProperty('display', 'none', 'important');
            dismissed = true;
        }

        // 2. Analyser detail modal / sheet
        const analyserModal = document.getElementById('analyserDetailModal');
        if (analyserModal && analyserModal.classList.contains('show')) {
            if (typeof window.closeAnalyserModal === 'function') {
                window.closeAnalyserModal();
            } else {
                analyserModal.classList.remove('show');
            }
            dismissed = true;
        }

        // 3. Stock Detail Chart Modal
        const chartModal = document.getElementById('chart-modal') || document.getElementById('chartModal');
        if (chartModal && (chartModal.classList.contains('show') || chartModal.style.display === 'block')) {
            if (typeof window.closeChartModal === 'function') {
                window.closeChartModal();
            } else {
                chartModal.classList.remove('show');
                chartModal.style.display = 'none';
            }
            dismissed = true;
        }

        // 4. Fundamentals Modal
        const fundModal = document.getElementById('fundamentals-modal');
        if (fundModal && (fundModal.classList.contains('show') || fundModal.style.display === 'block')) {
            if (typeof window.closeFundamentalsModal === 'function') {
                window.closeFundamentalsModal();
            } else {
                fundModal.classList.remove('show');
                fundModal.style.display = 'none';
            }
            dismissed = true;
        }

        // 5. Holding Details Modal
        const holdingModal = document.getElementById('holdingDetailModal') || document.getElementById('holding-details-modal');
        if (holdingModal && (holdingModal.classList.contains('show') || holdingModal.style.display === 'block')) {
            if (typeof window.closeHoldingDetailsModal === 'function') {
                window.closeHoldingDetailsModal();
            } else {
                holdingModal.classList.remove('show');
                holdingModal.style.display = 'none';
            }
            dismissed = true;
        }

        // 6. Generic Smallcase / MF / Bootstrap Modals
        document.querySelectorAll('.small-modal.show, .mf-modal.show, .modal.show').forEach(m => {
            m.classList.remove('show');
            m.style.display = 'none';
            dismissed = true;
        });

        // 7. Mobile Sidebar Drawer
        const mobileSidebar = document.getElementById('mobile-sidebar');
        const sidebar = document.querySelector('.sidebar');
        if (document.body.classList.contains('mobile-menu-open') || (mobileSidebar && mobileSidebar.classList.contains('open')) || (sidebar && sidebar.classList.contains('mobile-open'))) {
            if (typeof window.closeMobileSidebarOnSelect === 'function') {
                window.closeMobileSidebarOnSelect();
            }
            document.body.classList.remove('mobile-menu-open');
            if (mobileSidebar) mobileSidebar.classList.remove('open');
            if (sidebar) sidebar.classList.remove('mobile-open');
            dismissed = true;
        }

        // 8. Open Dropdown menus (actions, upcoming, etc.)
        const openDropdowns = document.querySelectorAll('.upcoming-dropdown-menu.show, .action-dropdown-menu.show, .menu-dropdown-wrapper.active');
        if (openDropdowns.length > 0) {
            openDropdowns.forEach(d => {
                d.classList.remove('show');
                d.classList.remove('active');
            });
            dismissed = true;
        }

        return dismissed;
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

        // Listen for browser Back / Forward buttons & swipe navigation
        window.addEventListener('popstate', (event) => {
            // Priority 1: If any modal, sheet, drawer, or dropdown is open, dismiss it and maintain current route
            if (this.closeAnyOpenModalOrDrawer()) {
                window.history.pushState({ tab: currentTab, isAppActive: true }, '', window.location.pathname);
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
    
    const activeNavKey = tabName === 'mutual-fund-detail' ? 'mutual-funds' : tabName;
    const btnEl = document.getElementById(`btn-tab-${activeNavKey}`);
    const sidebarNavEl = document.getElementById(`sidebar-nav-${activeNavKey}`);
    if (btnEl) btnEl.classList.add('active');
    if (sidebarNavEl) sidebarNavEl.classList.add('active');

    // Highlight parent Tools button if a tool tab is active
    const isTool = ['mutual-funds', 'mutual-fund-detail', 'ipos', 'plan-calculator', 'corporate-actions', 'quarterly-results', 'transactions', 'sector-rotation'].includes(tabName);
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
    }

    // 5. Automatically close tools submenu and mobile drawer if open
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
