// =========================================================
// CAPITAL DESK - CORE ENGINE & GLOBAL UTILITIES
// =========================================================

        // Store original native browser popup dialogs
        const __originalNativeAlert = window.alert.bind(window);
        const __originalNativeConfirm = window.confirm.bind(window);
        window.nativeAlert = __originalNativeAlert;
        window.nativeConfirm = __originalNativeConfirm;

        // Core System Modal Function for all Alerts, Confirms, Prompts, Warnings, and Success Popups
        function showSystemModal(options = {}) {
            return new Promise((resolve) => {
                const overlay = document.getElementById('customModalOverlay');
                const box = document.getElementById('customModalBox');
                const titleEl = document.getElementById('customModalTitle');
                const msgEl = document.getElementById('customModalMessage');
                const iconEl = document.getElementById('customModalIcon');
                const iconBadge = overlay ? overlay.querySelector('.modal-icon-badge') : null;
                const inputGroup = document.getElementById('customModalInputGroup');
                const inputEl = document.getElementById('customModalInput');
                const confirmBtn = document.getElementById('customModalConfirmBtn');
                const cancelBtn = document.getElementById('customModalCancelBtn');

                if (!overlay) return resolve(false);

                const type = options.type || 'info';
                
                // Icon & Color mapping
                const icons = {
                    success: '✅',
                    error: '⚠️',
                    warning: '🔔',
                    info: 'ℹ️',
                    confirm: options.isDanger ? '🗑️' : '❓',
                    prompt: '✏️'
                };
                const bgColors = {
                    success: 'rgba(16, 185, 129, 0.15)',
                    error: 'rgba(239, 68, 68, 0.15)',
                    warning: 'rgba(245, 158, 11, 0.15)',
                    info: 'rgba(59, 130, 246, 0.15)',
                    confirm: options.isDanger ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                    prompt: 'rgba(16, 185, 129, 0.15)'
                };

                iconEl.innerText = options.icon || icons[type] || 'ℹ️';
                if (iconBadge) {
                    iconBadge.style.background = bgColors[type] || bgColors.info;
                }

                // Default titles
                const defaultTitles = {
                    success: 'Success',
                    error: 'Error Notice',
                    warning: 'Warning Alert',
                    info: 'System Notice',
                    confirm: options.title || (options.isDanger ? 'Delete Confirmation' : 'Confirm Action'),
                    prompt: options.title || 'Input Required'
                };
                titleEl.innerText = options.title || defaultTitles[type] || 'Notice';
                msgEl.innerText = options.message || options.msg || '';

                // Input box handling
                const isPrompt = (type === 'prompt' || options.isPrompt);
                if (isPrompt) {
                    inputGroup.style.display = 'block';
                    inputEl.value = options.defaultValue !== undefined ? options.defaultValue : '';
                    inputEl.placeholder = options.placeholder || 'Type details here...';
                    setTimeout(() => {
                        inputEl.focus();
                        inputEl.select();
                    }, 50);
                } else {
                    inputGroup.style.display = 'none';
                }

                // Buttons visibility & label
                const isConfirmOrPrompt = (type === 'confirm' || isPrompt || options.showCancel);
                
                cancelBtn.style.display = isConfirmOrPrompt ? 'inline-block' : 'none';
                cancelBtn.innerText = options.cancelText || 'Cancel';
                
                confirmBtn.innerText = options.confirmText || (isConfirmOrPrompt ? (options.isDanger ? 'Delete' : (isPrompt ? 'Submit' : 'Confirm')) : 'OK');

                // Button colors
                if (options.isDanger || type === 'error') {
                    confirmBtn.style.background = '#ef4444';
                    confirmBtn.style.color = '#ffffff';
                } else if (type === 'warning') {
                    confirmBtn.style.background = '#f59e0b';
                    confirmBtn.style.color = '#ffffff';
                } else {
                    confirmBtn.style.background = '#10b981';
                    confirmBtn.style.color = '#ffffff';
                }

                overlay.style.setProperty('display', 'flex', 'important');
                box.style.transform = 'scale(1)';

                const cleanup = () => {
                    overlay.style.display = 'none';
                    confirmBtn.onclick = null;
                    cancelBtn.onclick = null;
                    inputEl.onkeydown = null;
                    document.removeEventListener('keydown', handleKey);
                };

                const handleKey = (e) => {
                    if (e.key === 'Escape' && isConfirmOrPrompt) {
                        cleanup();
                        resolve(isPrompt ? null : false);
                    } else if (e.key === 'Enter' && !isPrompt) {
                        cleanup();
                        resolve(true);
                    }
                };
                document.addEventListener('keydown', handleKey);

                confirmBtn.onclick = () => {
                    const val = isPrompt ? inputEl.value : true;
                    cleanup();
                    resolve(val);
                };

                cancelBtn.onclick = () => {
                    cleanup();
                    resolve(isPrompt ? null : false);
                };

                if (isPrompt) {
                    inputEl.onkeydown = (e) => {
                        if (e.key === 'Enter') {
                            const val = inputEl.value;
                            cleanup();
                            resolve(val);
                        }
                    };
                }
            });
        }

        // Show Toast now directs to System Modal Popup for clean centered UI
        function showToast(message, type = 'info', title = null) {
            return showSystemModal({
                type: type,
                title: title,
                message: message
            });
        }

        // Override window.alert globally to force centered System Modal Dialog everywhere
        window.alert = function(msg) {
            if (msg === undefined || msg === null) return;
            const msgStr = String(msg);
            const lower = msgStr.toLowerCase();
            let type = 'info';
            let title = 'Notice';

            if (lower.includes('fail') || lower.includes('error') || lower.includes('invalid') || lower.includes('could not') || lower.includes('required') || lower.includes('cannot') || lower.includes('please enter') || lower.includes('no active')) {
                type = 'error';
                title = 'Error Notice';
            } else if (lower.includes('warning') || lower.includes('alert') || lower.includes('caution') || lower.includes('exceeded') || lower.includes('already')) {
                type = 'warning';
                title = 'Warning Alert';
            } else if (lower.includes('success') || lower.includes('restored') || lower.includes('created') || lower.includes('set') || lower.includes('added') || lower.includes('updated') || lower.includes('saved')) {
                type = 'success';
                title = 'Success';
            }

            return showSystemModal({
                type: type,
                title: title,
                message: msgStr
            });
        };

        // Custom Confirmation & Input Modals
        function showCustomConfirm(options = {}) {
            return showSystemModal({
                ...options,
                type: 'confirm'
            });
        }

        function showCustomPrompt(options = {}) {
            return showSystemModal({
                ...options,
                type: 'prompt',
                isPrompt: true
            });
        }

        function cleanDisplaySymbol(sym) {
            if (!sym) return '';
            const s = String(sym).trim();
            if (s.startsWith('^') || s.includes('=F')) return s;
            return s.replace(/\.(NS|BO)$/i, '');
        }

        // Global App State
        let currentTab = 'watchlists';
        let watchlistsData = {};
        let portfoliosData = {};
        let activeWatchlistName = '';
        let activePortfolioName = '';
        let stockPricesData = {};
        let searchTimeout = null;
        window.portfoliosLoaded = false;
        window.watchlistsLoaded = false;


        let pfFilterOption = 'all'; // 'all', 'st', 'lt'
        let pfSortOption = 'day_pnl_desc'; // 'day_pnl_desc', 'day_pnl_asc', 'duration_desc', 'duration_asc', 'pnl_desc', 'pnl_asc', 'val_desc', 'date_desc', 'date_asc', 'name_asc'

        // Watchlist Sort State
        let wlSortColumn = 'symbol'; // 'symbol', 'price', 'change', 'change_pct'
        let wlSortDirection = 'asc';  // 'asc', 'desc'


        let isPrivacyMode = localStorage.getItem('capital_desk_privacy_mode') === 'true';

        function updateMobileHeaderActiveBadge() {
            const badge = document.getElementById('mobile-active-name-badge');
            if (!badge) return;
            const tab = window.currentTab || currentTab;
            if (tab === 'portfolios' && activePortfolioName) {
                badge.innerText = activePortfolioName;
                badge.style.display = 'inline-block';
            } else if (tab === 'watchlists' && activeWatchlistName) {
                badge.innerText = activeWatchlistName;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
        window.updateMobileHeaderActiveBadge = updateMobileHeaderActiveBadge;

        function formatMoney(amount, forceShow = false) {
            if (isPrivacyMode && !forceShow) return '₹ ••••••';
            if (amount === undefined || amount === null || isNaN(amount)) return '-';
            return '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        function formatMoneyWithSign(amount, forceShow = false) {
            if (isPrivacyMode && !forceShow) return '₹ ••••••';
            if (amount === undefined || amount === null || isNaN(amount)) return '-';
            const sign = amount >= 0 ? '+' : '';
            return `${sign}₹${Math.abs(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }

        function formatQty(qty, forceShow = false) {
            if (isPrivacyMode && !forceShow) return '••••';
            if (qty === undefined || qty === null || isNaN(qty)) return '-';
            return qty.toString();
        }

        function togglePrivacyMode() {
            isPrivacyMode = !isPrivacyMode;
            localStorage.setItem('capital_desk_privacy_mode', isPrivacyMode ? 'true' : 'false');
            updatePrivacyUI();
            renderPortfolios();
            refreshPrices();
            if (currentTab === 'dashboard') {
                renderDashboard();
            }
        }

        function updatePrivacyUI() {
            const btnHeader = document.getElementById('btn-privacy-header');
            const btnPf = document.getElementById('btn-privacy-pf');
            const btnSidebar = document.getElementById('btn-sidebar-privacy');
            const menuIcon = document.getElementById('privacy-menu-icon');
            const menuText = document.getElementById('privacy-menu-text');

            const icon = isPrivacyMode ? '🙈' : '👁️';
            const titleStr = isPrivacyMode ? 'Click to show portfolio amounts' : 'Click to hide portfolio amounts (Privacy Mode)';

            if (btnHeader) {
                btnHeader.innerHTML = `${icon}`;
                btnHeader.title = titleStr;
                btnHeader.style.borderColor = isPrivacyMode ? '#10b981' : '';
            }
            if (btnPf) {
                btnPf.innerHTML = `${icon}`;
                btnPf.style.borderColor = isPrivacyMode ? '#10b981' : '';
            }
            if (btnSidebar) {
                btnSidebar.innerHTML = `${icon}`;
                btnSidebar.title = titleStr;
                btnSidebar.style.borderColor = isPrivacyMode ? '#10b981' : '';
            }
            if (menuIcon) menuIcon.innerText = icon;
            if (menuText) menuText.innerText = isPrivacyMode ? 'Show Amounts' : 'Hide Amounts (Privacy Mode)';
        }

        function initPrivacyMode() {
            isPrivacyMode = localStorage.getItem('capital_desk_privacy_mode') === 'true';
            updatePrivacyUI();
        }



        function escapeHtml(str) {
            return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        // Calculate holding days integer for sorting/filtering
        function getHoldingDays(buyDateStr) {
            if (!buyDateStr) return 0;
            const buyDate = new Date(buyDateStr);
            const today = new Date();
            const diff = today - buyDate;
            return diff > 0 ? Math.floor(diff / (1000 * 60 * 60 * 24)) : 0;
        }

        // Format holding duration into "20 days", "1 month 5 days", "2 years 3 months 2 days", etc.
        function formatHoldingDuration(buyDateStr) {
            if (!buyDateStr) return '0 days';
            
            const buyDate = new Date(buyDateStr);
            const today = new Date();
            
            if (isNaN(buyDate.getTime()) || buyDate > today) return '0 days';

            let years = today.getFullYear() - buyDate.getFullYear();
            let months = today.getMonth() - buyDate.getMonth();
            let days = today.getDate() - buyDate.getDate();

            if (days < 0) {
                months--;
                const prevMonth = new Date(today.getFullYear(), today.getMonth(), 0);
                days += prevMonth.getDate();
            }

            if (months < 0) {
                years--;
                months += 12;
            }

            let parts = [];
            if (years > 0) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
            if (months > 0) parts.push(`${months} ${months === 1 ? 'month' : 'months'}`);
            if (days > 0 || parts.length === 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);

            return parts.join(' ');
        }

        function formatAppDate(value, includeTime = false) {
            if (!value && value !== 0) return '-';
            let d;
            if (value instanceof Date) {
                d = value;
            } else if (typeof value === 'number') {
                d = new Date(value < 1e11 ? value * 1000 : value);
            } else if (typeof value === 'string') {
                const trimmed = value.trim();
                if (!trimmed) return '-';

                const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
                if (ymdMatch) {
                    const [, y, m, day] = ymdMatch;
                    return includeTime ? `${day}-${m}-${y} 00:00` : `${day}-${m}-${y}`;
                }

                const dmyMatch = /^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::\d{2})?)?$/.exec(trimmed);
                if (dmyMatch) {
                    const [, day, m, y, hh, mm] = dmyMatch;
                    if (includeTime && hh && mm) {
                        return `${day}-${m}-${y} ${hh}:${mm}`;
                    }
                    if (includeTime) {
                        return `${day}-${m}-${y} 00:00`;
                    }
                    return `${day}-${m}-${y}`;
                }

                if (trimmed.includes(' ') && !trimmed.includes('T')) {
                    d = new Date(trimmed.replace(' ', 'T'));
                } else {
                    d = new Date(trimmed);
                }
            } else {
                d = new Date(value);
            }

            if (!d || isNaN(d.getTime())) return String(value || '-');

            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            const dateStr = `${day}-${month}-${year}`;

            if (!includeTime) return dateStr;

            const hours = String(d.getHours()).padStart(2, '0');
            const minutes = String(d.getMinutes()).padStart(2, '0');
            return `${dateStr} ${hours}:${minutes}`;
        }

        function formatAppDateTime(value) {
            return formatAppDate(value, true);
        }

        function formatDateFormatted(value, includeTime = false) {
            return formatAppDate(value, includeTime);
        }

        window.formatAppDate = formatAppDate;
        window.formatAppDateTime = formatAppDateTime;
        window.formatDateFormatted = formatDateFormatted;

        function getSymbolBadge(sym, defaultExch = '') {
            if (!sym) return { label: 'NSE', class: 'badge-nse' };
            const s = sym.toUpperCase();
            if (s.startsWith('^') || defaultExch === 'INDEX') {
                return { label: 'INDEX', class: 'badge-idx' };
            }
            if (s.includes('=F') || s.includes('GOLDBEES') || s.includes('SILVERBEES') || defaultExch === 'COMMODITY') {
                return { label: 'COMMODITY', class: 'badge-cmd' };
            }
            if (s.endsWith('.BO') || defaultExch === 'BSE') {
                return { label: 'BSE', class: 'badge-bse' };
            }
            return { label: 'NSE', class: 'badge-nse' };
        }



        // Data Backup & Restore (Export / Import JSON)
        function exportDataBackup() {
            window.location.href = '/api/backup/export';
        }

        function triggerImportBackup() {
            document.getElementById('backup-file-input').click();
        }

        async function handleBackupFileSelect(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    const content = JSON.parse(e.target.result);
                    const res = await fetch('/api/backup/import', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(content)
                    });
                    const data = await res.json();
                    if (data.success) {
                        alert('✅ Data restored successfully! Watchlists & Portfolios updated.');
                        watchlistsData = data.watchlists || watchlistsData;
                        portfoliosData = data.portfolios || portfoliosData;
                        renderWatchlists();
                        renderPortfolios();
                        updateDashboardCharts();
                    } else {
                        alert('❌ Restore failed: ' + (data.error || 'Invalid file format'));
                    }
                } catch (err) {
                    alert('❌ Failed to read backup file: ' + err.message);
                } finally {
                    event.target.value = '';
                }
            };
            reader.readAsText(file);
        }



        // Theme Switcher (Light Mode & Dark Mode)
        function initTheme() {
            const savedTheme = localStorage.getItem('capital_desk_theme') || 'light';
            setTheme(savedTheme);
        }

        function getChartThemeColors(theme) {
            const isDark = theme === 'dark';
            return {
                isDark: isDark,
                bgColor: isDark ? '#131722' : '#ffffff',
                textColor: isDark ? '#d1d4dc' : '#1e293b',
                gridColor: isDark ? '#1f2434' : '#f0f3fa',
                borderColor: isDark ? '#2a2e39' : '#e2e8f0',
                crosshairLineColor: isDark ? '#758696' : '#94a3b8',
                crosshairLabelBg: isDark ? '#2a2e39' : '#cbd5e1',
                gannColor: isDark ? '#ffffff' : '#1e293b'
            };
        }

        function applyChartTheme(theme) {
            const colors = getChartThemeColors(theme || document.documentElement.getAttribute('data-theme') || 'light');
            if (typeof LightweightCharts === 'undefined') return;
            const options = {
                layout: {
                    background: { type: 'solid', color: colors.bgColor },
                    textColor: colors.textColor
                },
                grid: {
                    vertLines: { color: colors.gridColor, style: LightweightCharts.LineStyle.Dotted },
                    horzLines: { color: colors.gridColor, style: LightweightCharts.LineStyle.Dotted }
                },
                crosshair: {
                    vertLine: { labelBackgroundColor: colors.crosshairLabelBg, color: colors.crosshairLineColor },
                    horzLine: { labelBackgroundColor: colors.crosshairLabelBg, color: colors.crosshairLineColor }
                },
                rightPriceScale: { borderColor: colors.borderColor },
                timeScale: { borderColor: colors.borderColor }
            };

            if (typeof mainChart !== 'undefined' && mainChart) mainChart.applyOptions(options);
            if (typeof rsiChart !== 'undefined' && rsiChart) rsiChart.applyOptions(options);
            if (typeof macdChart !== 'undefined' && macdChart) macdChart.applyOptions(options);
            if (typeof gann2DaySeries !== 'undefined' && gann2DaySeries) gann2DaySeries.applyOptions({ color: colors.gannColor });

            if (typeof redrawCanvasOverlay === 'function') {
                redrawCanvasOverlay();
            }
        }

        function setTheme(theme) {
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('capital_desk_theme', theme);

            const icon = document.getElementById('theme-icon');
            const text = document.getElementById('theme-text');
            const menuIcon = document.getElementById('theme-menu-icon');
            const menuText = document.getElementById('theme-menu-text');
            const sidebarIcon = document.getElementById('sidebar-theme-icon');

            if (theme === 'dark') {
                if (icon) icon.innerText = '☀️';
                if (text) text.innerText = 'Light Mode';
                if (menuIcon) menuIcon.innerText = '☀️';
                if (menuText) menuText.innerText = 'Light Mode';
                if (sidebarIcon) sidebarIcon.innerText = '☀️';
            } else {
                if (icon) icon.innerText = '🌙';
                if (text) text.innerText = 'Dark Mode';
                if (menuIcon) menuIcon.innerText = '🌙';
                if (menuText) menuText.innerText = 'Dark Mode';
                if (sidebarIcon) sidebarIcon.innerText = '🌙';
            }
            if (currentTab === 'dashboard') {
                renderDashboard();
            }
            applyChartTheme(theme);
        }

        function toggleTheme() {
            const current = document.documentElement.getAttribute('data-theme') || 'light';
            const next = current === 'dark' ? 'light' : 'dark';
            setTheme(next);
        }

        // User Auth Check & Logout Helpers
        async function checkAuthAndLoadUserInfo() {
            try {
                const res = await fetch('/api/user_info');
                const data = await res.json();
                if (data.logged_in) {
                    const userEl = document.getElementById('header-username');
                    const mobileUserEl = document.getElementById('mobile-header-username');
                    const roleBadge = document.getElementById('sidebar-user-role-badge');
                    const sidebarAdminLink = document.getElementById('sidebar-nav-admin');
                    const adminLink = document.getElementById('admin-menu-link');

                    if (userEl) userEl.innerText = data.username;
                    if (mobileUserEl) mobileUserEl.innerText = data.username;
                    if (roleBadge) roleBadge.innerText = data.is_admin ? 'Administrator' : 'Member';

                    if (data.is_admin) {
                        if (adminLink) adminLink.style.display = 'flex';
                        if (sidebarAdminLink) sidebarAdminLink.style.display = 'flex';
                    }
                } else {
                    window.location.href = '/login';
                }
            } catch(e) {
                console.error('Auth check failed:', e);
            }
        }

        async function logoutUser() {
            await fetch('/api/logout');
            window.location.href = '/login';
        }

        // Global Brand Animated Loader Component Generator
        window.createBrandLoaderHTML = function({ title = 'Loading...', subtitle = '', badge = '', isOverlay = false, minHeight = '' } = {}) {
            return `
            <div class="cd-brand-loader ${isOverlay ? 'overlay' : ''}" ${minHeight ? `style="min-height: ${minHeight};"` : ''}>
                <div class="chart-loader-brand-box">
                    <div class="chart-loader-spinner-ring"></div>
                    <img src="/static/favicon-192.png" alt="Capital Desk Logo" class="chart-loader-logo">
                </div>
                <div class="cd-loader-text-box">
                    <div class="cd-loader-title">${title}</div>
                    ${badge ? `<div class="cd-loader-badge">${badge}</div>` : ''}
                    ${subtitle ? `<div class="cd-loader-subtitle">${subtitle}</div>` : ''}
                </div>
            </div>`;
        };

