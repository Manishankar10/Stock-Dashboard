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
        'plan-calculator': '/plan-calculator'
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
        '/plan-calculator': 'plan-calculator'
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

        // Listen for browser Back / Forward buttons
        window.addEventListener('popstate', (event) => {
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

    // 1. Update navigation items active state in sidebar and buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.sidebar-nav-item').forEach(item => item.classList.remove('active'));
    
    const activeNavKey = tabName === 'mutual-fund-detail' ? 'mutual-funds' : tabName;
    const btnEl = document.getElementById(`btn-tab-${activeNavKey}`);
    const sidebarNavEl = document.getElementById(`sidebar-nav-${activeNavKey}`);
    if (btnEl) btnEl.classList.add('active');
    if (sidebarNavEl) sidebarNavEl.classList.add('active');

    // Highlight parent Tools button if a tool tab is active
    const isTool = ['mutual-funds', 'mutual-fund-detail', 'ipos', 'plan-calculator'].includes(tabName);
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
            window.history.pushState({ tab: tabName }, '', routePath);
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
        if (!window.watchlistsLoaded && typeof fetchWatchlists === 'function') {
            fetchWatchlists();
        } else {
            if (typeof renderWatchlists === 'function') renderWatchlists();
            if (typeof refreshPrices === 'function') refreshPrices();
        }
    } else if (tabName === 'portfolios') {
        if (!window.portfoliosLoaded && typeof fetchPortfolios === 'function') {
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
