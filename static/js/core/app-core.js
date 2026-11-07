// =========================================================
// CAPITAL DESK - CORE ENGINE & GLOBAL UTILITIES
// =========================================================

        // Store original native browser popup dialogs
        const __originalNativeAlert = window.alert.bind(window);
        const __originalNativeConfirm = window.confirm.bind(window);
        window.nativeAlert = __originalNativeAlert;
        window.nativeConfirm = __originalNativeConfirm;

        // =========================================================
        // UNIVERSAL DYNAMIC MODAL STACKING MANAGER
        // Brings whichever modal is opened or clicked (latest) to top
        // =========================================================
        window.globalModalZIndexCounter = Math.max(window.globalModalZIndexCounter || 100100, 100100);

        const GLOBAL_MODAL_SELECTOR = '.modal, .small-modal, .fundamentals-modal, .mf-modal-backdrop, .br-modal-overlay, .of-modal-overlay, .qr-glass-modal, .qr-custom-modal-backdrop, .shp-custom-modal-backdrop, .tx-custom-modal-backdrop, .modal-backdrop, .modal-overlay, .pa-modal-overlay, #tx-deal-fields-popover, .tx-deal-fields-popover, .popover, [role="dialog"], [role="tooltip"], [id$="Modal"], [id$="-modal"], [id$="_modal"]';

        function getTopModalContainer(target) {
            if (!target || !(target instanceof HTMLElement)) return null;
            if (target.id === 'customModalOverlay' || target.id === 'customModalBox') return null;

            // Treat floating popovers or tooltips as self-contained containers
            if (target.matches && target.matches('#tx-deal-fields-popover, .tx-deal-fields-popover, .popover, [role="tooltip"], .chart-popover-menu')) {
                return target;
            }

            const modal = target.closest(GLOBAL_MODAL_SELECTOR);
            if (!modal) return null;
            if (modal.id === 'customModalOverlay') return null;

            if (modal.matches && modal.matches('#tx-deal-fields-popover, .tx-deal-fields-popover, .popover, [role="tooltip"], .chart-popover-menu')) {
                return modal;
            }

            let curr = modal;
            while (curr.parentElement) {
                const outer = curr.parentElement.closest(GLOBAL_MODAL_SELECTOR);
                if (outer && outer.id !== 'customModalOverlay' && !outer.matches('#tx-deal-fields-popover, .tx-deal-fields-popover, .popover, [role="tooltip"], .chart-popover-menu')) {
                    curr = outer;
                } else {
                    break;
                }
            }
            return curr;
        }

        function isModalElementVisible(modal) {
            if (!modal || !(modal instanceof HTMLElement)) return false;
            if (modal.id === 'mobile-sidebar') {
                return modal.classList.contains('open') || document.body.classList.contains('mobile-menu-open');
            }
            if (modal.hasAttribute('hidden') || modal.closest('[hidden]')) return false;
            if (modal.style.display === 'none' || modal.classList.contains('hidden')) return false;
            try {
                const style = window.getComputedStyle(modal);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
            } catch (e) {}
            if (modal.offsetWidth === 0 && modal.offsetHeight === 0 && modal.getClientRects().length === 0) {
                return false;
            }
            return true;
        }

        // =========================================================
        // MODAL HISTORY MANAGER (Mobile Back Button Interceptor)
        // Tracks opened modals and popups, handles pushState/popstate
        // so pressing Back dismisses the popup only, not the page/app
        // =========================================================
        let _pendingBackCount = 0;
        let _pendingBackTimer = null;

        function scheduleHistoryBack() {
            _pendingBackCount++;
            if (_pendingBackTimer) clearTimeout(_pendingBackTimer);
            _pendingBackTimer = setTimeout(() => {
                const count = _pendingBackCount;
                _pendingBackCount = 0;
                if (count > 0 && window.history.state && window.history.state.cdModal) {
                    window.ModalHistoryManager._suppressPopstate = true;
                    try {
                        window.history.go(-count);
                    } catch (e) {
                        window.ModalHistoryManager._suppressPopstate = false;
                    }
                    setTimeout(() => {
                        window.ModalHistoryManager._suppressPopstate = false;
                    }, 350);
                }
            }, 25);
        }

        window.ModalHistoryManager = {
            stack: [],
            _suppressPopstate: false,
            _isHandlingPopstate: false,
            _closedByBackSet: new WeakSet(),

            push(modal) {
                if (!modal || !(modal instanceof HTMLElement)) return;
                // If modal is already top of stack, don't push another history state
                if (this.stack.length > 0 && this.stack[this.stack.length - 1] === modal) {
                    return;
                }
                const lastIdx = this.stack.indexOf(modal);
                if (lastIdx !== -1) {
                    this.stack.splice(lastIdx, 1);
                }
                this.stack.push(modal);

                try {
                    const modalId = modal.id || (modal.className ? String(modal.className).split(' ')[0] : 'cd-modal');
                    window.history.pushState(
                        { cdModal: true, modalId: modalId, depth: this.stack.length },
                        '',
                        window.location.href
                    );
                } catch (e) {
                    console.warn('[ModalHistoryManager] pushState failed:', e);
                }
            },

            remove(modal) {
                if (!modal) return;
                this._closedByBackSet.add(modal);
                const idx = this.stack.indexOf(modal);
                if (idx !== -1) {
                    this.stack.splice(idx, 1);
                }
            },

            onModalClosed(modal) {
                if (!modal) return;
                const idx = this.stack.indexOf(modal);
                if (idx !== -1) {
                    this.stack.splice(idx, 1);
                }
                // If close was triggered by user pressing Back button,
                // history entry was already popped by browser, so DO NOT call history.back()
                if (this._isHandlingPopstate || this._closedByBackSet.has(modal)) {
                    this._closedByBackSet.delete(modal);
                    return;
                }
                // If closed via UI (e.g. tap '✕', 'Cancel', or backdrop), pop the pushed history state cleanly
                scheduleHistoryBack();
            },

            getTopModal() {
                for (let i = this.stack.length - 1; i >= 0; i--) {
                    const m = this.stack[i];
                    if (m && document.body.contains(m) && isModalElementVisible(m)) {
                        return m;
                    }
                }
                return null;
            }
        };

        const modalVisibilityTracker = new WeakMap();
        let _isInternalElevating = false;

        function bringModalToFront(modal) {
            if (!modal) return null;
            if (typeof modal === 'string') {
                modal = document.getElementById(modal);
            }
            if (!modal || !(modal instanceof HTMLElement)) return null;

            const container = getTopModalContainer(modal) || modal;
            const currentZ = parseInt(window.getComputedStyle(container).zIndex, 10) || 0;

            // If already at the top of stack and current z-index matches or exceeds top counter, avoid DOM churn
            if (window.globalModalZIndexCounter && currentZ >= window.globalModalZIndexCounter &&
                window.ModalHistoryManager && window.ModalHistoryManager.stack.length > 0 &&
                window.ModalHistoryManager.stack[window.ModalHistoryManager.stack.length - 1] === container) {
                return currentZ;
            }

            window.globalModalZIndexCounter = Math.max(window.globalModalZIndexCounter || 100100, currentZ, 100100) + 2;

            _isInternalElevating = true;
            try {
                container.style.setProperty('z-index', String(window.globalModalZIndexCounter), 'important');
                modalVisibilityTracker.set(container, true);
                if (window.ModalHistoryManager) {
                    window.ModalHistoryManager.push(container);
                }
            } finally {
                _isInternalElevating = false;
            }
            return window.globalModalZIndexCounter;
        }
        window.bringModalToFront = bringModalToFront;

        // Capture-phase pointerdown listener raises any clicked modal instantly
        document.addEventListener('pointerdown', function (e) {
            const modal = getTopModalContainer(e.target);
            if (!modal) return;
            if (isModalElementVisible(modal)) {
                bringModalToFront(modal);
            }
        }, true);

        // Universal MutationObserver: Automatically elevates any popup when it opens
        function checkAndElevateModal(target) {
            if (_isInternalElevating) return;
            const modal = getTopModalContainer(target);
            if (!modal) return;

            const visible = isModalElementVisible(modal);
            const wasVisible = modalVisibilityTracker.get(modal) || false;

            if (visible) {
                modalVisibilityTracker.set(modal, true);
                if (!wasVisible) {
                    bringModalToFront(modal);
                    if (window.ModalHistoryManager) {
                        window.ModalHistoryManager.push(modal);
                    }
                }
            } else {
                modalVisibilityTracker.set(modal, false);
                if (wasVisible) {
                    if (window.ModalHistoryManager) {
                        window.ModalHistoryManager.onModalClosed(modal);
                    }
                }
            }
        }

        function initGlobalModalObserver() {
            if (!window.MutationObserver) return;

            const observer = new MutationObserver((mutations) => {
                if (_isInternalElevating) return;
                for (let i = 0; i < mutations.length; i++) {
                    const m = mutations[i];
                    if (m.type === 'attributes') {
                        checkAndElevateModal(m.target);
                    } else if (m.type === 'childList') {
                        for (let j = 0; j < m.addedNodes.length; j++) {
                            const node = m.addedNodes[j];
                            if (node.nodeType === 1) {
                                checkAndElevateModal(node);
                            }
                        }
                    }
                }
            });

            const root = document.body || document.documentElement;
            if (root) {
                observer.observe(root, {
                    attributes: true,
                    attributeFilter: ['style', 'class', 'hidden'],
                    childList: true,
                    subtree: true
                });
            }
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initGlobalModalObserver);
        } else {
            initGlobalModalObserver();
        }

        // =========================================================
        // UNIVERSAL MODAL MANAGER - CLOSE TOPMOST ACTIVE MODAL
        // Allows Escape key to dismiss whichever modal is active on top.
        // Stacked modals close in reverse z-index order (topmost first).
        // =========================================================
        function closeTopmostActiveModal() {
            // 1. System alert / confirmation modal
            const customOverlay = document.getElementById('customModalOverlay');
            if (customOverlay && isModalElementVisible(customOverlay)) {
                if (typeof window.__systemModalCancel === 'function') {
                    window.__systemModalCancel();
                    return true;
                }
                const cancelBtn = document.getElementById('customModalCancelBtn');
                if (cancelBtn) { cancelBtn.click(); return true; }
                customOverlay.style.display = 'none';
                return true;
            }

            // 2. Explicit ID to close function mapping
            const modalCloseMap = {
                'chartModal': () => {
                    if (typeof window.closeChartModal === 'function') window.closeChartModal();
                },
                'fundamentalsModal': () => {
                    if (typeof window.closeFundamentalsModal === 'function') window.closeFundamentalsModal();
                },
                'stockNewsModal': () => {
                    if (typeof window.closeStockNewsModal === 'function') window.closeStockNewsModal();
                },
                'editHoldingModal': () => {
                    if (typeof window.closeEditModal === 'function') window.closeEditModal();
                },
                'holdingDetailsModal': () => {
                    if (typeof window.closeHoldingDetailsModal === 'function') window.closeHoldingDetailsModal();
                },
                'createWatchlistModal': () => {
                    if (typeof window.closeCreateWatchlistModal === 'function') window.closeCreateWatchlistModal();
                },
                'createPortfolioModal': () => {
                    if (typeof window.closeCreatePortfolioModal === 'function') window.closeCreatePortfolioModal();
                },
                'addHoldingModal': () => {
                    if (typeof window.closeAddHoldingModal === 'function') window.closeAddHoldingModal();
                },
                'sellHoldingModal': () => {
                    if (typeof window.closeSellHoldingModal === 'function') window.closeSellHoldingModal();
                },
                'buyMoreModal': () => {
                    if (typeof window.closeBuyMoreModal === 'function') window.closeBuyMoreModal();
                },
                'createAlertModal': () => {
                    if (typeof window.closeCreateAlertModal === 'function') window.closeCreateAlertModal();
                },
                'notificationsModal': () => {
                    if (typeof window.closeNotificationsModal === 'function') window.closeNotificationsModal();
                },
                'editDrawingModal': () => {
                    if (typeof window.closeEditDrawingModal === 'function') window.closeEditDrawingModal();
                },
                'stockWatchlistActionModal': () => {
                    if (typeof window.closeStockWatchlistActionModal === 'function') window.closeStockWatchlistActionModal();
                },
                'bullionHistoryModal': () => {
                    if (typeof window.closeBullionHistoryModal === 'function') window.closeBullionHistoryModal();
                },
                'upcomingEventsModal': () => {
                    if (typeof window.closeUpcomingEventsModal === 'function') window.closeUpcomingEventsModal();
                },
                'qrMobileFilterModal': () => {
                    if (typeof window.closeQrMobileFilter === 'function') window.closeQrMobileFilter();
                },
                'qr-custom-modal': () => {
                    if (typeof window.closeQrCustomModal === 'function') window.closeQrCustomModal();
                },
                'shp-custom-modal': () => {
                    if (typeof window.closeShpCustomModal === 'function') window.closeShpCustomModal();
                },
                'shp-remarks-modal': () => {
                    if (typeof window.closeRemarksModal === 'function') window.closeRemarksModal();
                },
                'tx-custom-modal': () => {
                    if (typeof window.closeTxCustomModal === 'function') window.closeTxCustomModal();
                },
                'pa-details-modal': () => {
                    if (typeof window.closePaModal === 'function') window.closePaModal();
                },
                'analyserDetailModal': () => {
                    if (typeof window.closeAnalyserModal === 'function') window.closeAnalyserModal();
                },
                'sr-constituents-modal': () => {
                    if (typeof window.closeSectorConstituentsModal === 'function') window.closeSectorConstituentsModal();
                },
                'createSmallcaseModal': () => {
                    if (typeof window.closeSmallcaseModal === 'function') window.closeSmallcaseModal('createSmallcaseModal');
                },
                'editSmallcaseModal': () => {
                    if (typeof window.closeSmallcaseModal === 'function') window.closeSmallcaseModal('editSmallcaseModal');
                },
                'txSmallcaseModal': () => {
                    if (typeof window.closeSmallcaseModal === 'function') window.closeSmallcaseModal('txSmallcaseModal');
                },
                'exitSmallcaseModal': () => {
                    if (typeof window.closeSmallcaseModal === 'function') window.closeSmallcaseModal('exitSmallcaseModal');
                },
                'bulkStockSmallcaseModal': () => {
                    if (typeof window.closeSmallcaseModal === 'function') window.closeSmallcaseModal('bulkStockSmallcaseModal');
                },
                'detailSmallcaseModal': () => {
                    if (typeof window.closeSmallcaseModal === 'function') window.closeSmallcaseModal('detailSmallcaseModal');
                },
                'importSmallcaseModal': () => {
                    if (typeof window.closeSmallcaseModal === 'function') window.closeSmallcaseModal('importSmallcaseModal');
                },
                'importWatchlistTxtModal': () => {
                    if (typeof window.closeWatchlistTxtImportModal === 'function') window.closeWatchlistTxtImportModal();
                },
                'customQueryChoiceModal': () => {
                    const m = document.getElementById('customQueryChoiceModal');
                    if (m) m.style.display = 'none';
                },
                'customQueryNameModal': () => {
                    const m = document.getElementById('customQueryNameModal');
                    if (m) m.style.display = 'none';
                },
                'inspectUserModal': () => {
                    if (typeof window.closeInspectModal === 'function') window.closeInspectModal();
                },
                'resetPassModal': () => {
                    if (typeof window.closeResetPassModal === 'function') window.closeResetPassModal();
                },
                'externalApiLogsModal': () => {
                    if (typeof window.closeExternalApiLogsModal === 'function') window.closeExternalApiLogsModal();
                },
                'externalApiLogDetailModal': () => {
                    if (typeof window.closeExternalApiLogDetail === 'function') window.closeExternalApiLogDetail();
                },
                'transcriptShareModal': () => {
                    if (typeof window.closeTranscriptShareModal === 'function') window.closeTranscriptShareModal();
                },
                'tradesModal': () => {
                    if (typeof window.closeTradesModal === 'function') window.closeTradesModal();
                },
                'brokerResearchModal': () => {
                    if (typeof window.closeBrokerResearchModal === 'function') window.closeBrokerResearchModal();
                },
                'brokerResearchAiModal': () => {
                    if (typeof window.closeBrokerResearchAiModal === 'function') window.closeBrokerResearchAiModal();
                },
                'wlMobileMenuModal': () => {
                    if (typeof window.closeWlMobileMenuModal === 'function') window.closeWlMobileMenuModal();
                },
                'wlMobileSortModal': () => {
                    if (typeof window.closeWlMobileSortModal === 'function') window.closeWlMobileSortModal();
                }
            };

            // Collect all visible modals matching GLOBAL_MODAL_SELECTOR
            const modalCandidates = Array.from(document.querySelectorAll(
                GLOBAL_MODAL_SELECTOR
            )).filter(m => {
                if (!m || m.id === 'customModalOverlay' || m.id === 'mobile-sidebar') return false;
                if (m.matches && m.matches('#tx-deal-fields-popover, .tx-deal-fields-popover, .popover, [role="tooltip"], .chart-popover-menu, .menu-dropdown-content, .autocomplete-dropdown')) return false;
                return isModalElementVisible(m);
            });

            if (modalCandidates.length === 0) {
                return false;
            }

            modalCandidates.sort((a, b) => {
                const zA = parseInt(window.getComputedStyle(a).zIndex, 10) || 0;
                const zB = parseInt(window.getComputedStyle(b).zIndex, 10) || 0;
                if (zB !== zA) return zB - zA;
                const idxA = window.ModalHistoryManager ? window.ModalHistoryManager.stack.indexOf(a) : -1;
                const idxB = window.ModalHistoryManager ? window.ModalHistoryManager.stack.indexOf(b) : -1;
                return idxB - idxA;
            });

            const topModal = modalCandidates[0];

            if (topModal.id && modalCloseMap[topModal.id]) {
                try {
                    modalCloseMap[topModal.id]();
                } catch(e) {}
            }

            // If modal is still visible after mapped handler, click its close icon / button
            if (isModalElementVisible(topModal)) {
                const closeBtn = topModal.querySelector('.close-btn, .modal-close-btn, .pa-modal-close-btn, .br-close-btn, .of-modal-close, .sr-modal-close, button.close, [data-dismiss="modal"], [data-close-modal]');
                if (closeBtn && typeof closeBtn.click === 'function') {
                    try {
                        closeBtn.click();
                    } catch(e) {}
                }
            }

            // Final fallback: if STILL visible, set display: none directly
            if (isModalElementVisible(topModal)) {
                topModal.style.display = 'none';
                topModal.classList.remove('show', 'open');
            }

            if (window.ModalHistoryManager) window.ModalHistoryManager.onModalClosed(topModal);
            return true;
        }
        window.closeTopmostActiveModal = closeTopmostActiveModal;

        // Capture-phase Keydown listener: Escape dismisses the topmost active modal
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                // If chart symbol search dropdown is open, let that close first
                const searchDropdown = document.getElementById('chartSymbolSearchDropdown');
                if (searchDropdown && searchDropdown.style.display === 'flex') return;

                // If drawing tool is active on open chart, let chart.js cancel the tool first
                if (typeof window.getCurrentDrawingTool === 'function' && window.getCurrentDrawingTool()) {
                    const chartModalEl = document.getElementById('chartModal');
                    if (chartModalEl && chartModalEl.style.display !== 'none' && !chartModalEl.hasAttribute('hidden')) {
                        return;
                    }
                }

                const closed = closeTopmostActiveModal();
                if (closed) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        }, true);

        // Capture-phase Click listener: Prevent ANY backdrop click from closing modals
        // Modals must ONLY be dismissed via the Escape key or the close button
        document.addEventListener('click', function (e) {
            const target = e.target;
            if (!target || !(target instanceof HTMLElement)) return;

            if (target.matches && target.matches(GLOBAL_MODAL_SELECTOR)) {
                const contentBox = target.closest('.modal-content, .small-modal-content, .pa-modal-sheet, .sr-modal-content, .upcoming-modal-sheet, .qr-modal-sheet, .shp-custom-modal-box, .tx-custom-modal-box, .share-modal-container, .trades-modal-container, .modal-dialog, .dialog-box, .mf-modal-content, .br-modal-content, .br-ai-modal-content, .of-modal-content');
                if (!contentBox) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    return false;
                }
            }
        }, true);


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
                overlay.style.setProperty('z-index', String((window.globalModalZIndexCounter || 100100) + 500), 'important');
                box.style.transform = 'scale(1)';

                if (window.ModalHistoryManager) {
                    window.ModalHistoryManager.push(overlay);
                }

                const cleanup = () => {
                    overlay.style.display = 'none';
                    overlay.onclick = null;
                    confirmBtn.onclick = null;
                    cancelBtn.onclick = null;
                    inputEl.onkeydown = null;
                    document.removeEventListener('keydown', handleKey);
                    window.__systemModalCancel = null;
                    if (window.ModalHistoryManager) {
                        window.ModalHistoryManager.onModalClosed(overlay);
                    }
                };

                window.__systemModalCancel = () => {
                    cleanup();
                    resolve(false);
                };

                // Modals must NOT close on backdrop click (only Escape or close/cancel buttons)
                overlay.onclick = (e) => {
                    if (e.target === overlay) {
                        e.stopPropagation();
                    }
                };

                const handleKey = (e) => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
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

        // =========================================================
        // BOTTOM CENTER TOASTER NOTIFICATION SYSTEM
        // Modern, non-intrusive floating toaster at bottom center
        // =========================================================
        function showToast(message, type = 'info', durationOrTitle = 2800) {
            if (!message) return;
            const msgStr = String(message);
            const duration = typeof durationOrTitle === 'number' ? durationOrTitle : 2800;

            let container = document.getElementById('appBottomToastContainer');
            if (!container) {
                container = document.createElement('div');
                container.id = 'appBottomToastContainer';
                container.className = 'app-bottom-toast-container';
                container.setAttribute('aria-live', 'polite');
                container.setAttribute('aria-atomic', 'true');
                document.body.appendChild(container);
            }

            // Keep at most 3 simultaneous toasts to prevent viewport clutter
            const existingToasts = container.querySelectorAll('.app-bottom-toast:not(.toast-hiding)');
            if (existingToasts.length >= 3) {
                const oldest = existingToasts[0];
                oldest.classList.add('toast-hiding');
                setTimeout(() => { if (oldest.parentElement) oldest.remove(); }, 220);
            }

            const icons = {
                success: '✅',
                error: '❌',
                warning: '⚠️',
                info: 'ℹ️'
            };

            const toastType = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';
            const icon = icons[toastType] || 'ℹ️';

            const toast = document.createElement('div');
            toast.className = `app-bottom-toast toast-${toastType}`;
            toast.role = 'status';
            toast.innerHTML = `
                <span class="app-toast-icon">${icon}</span>
                <span class="app-toast-text">${escapeHtml(msgStr)}</span>
                <span class="app-toast-dismiss" title="Dismiss">&times;</span>
            `;

            let isDismissed = false;
            const dismissToast = (e) => {
                if (e) e.stopPropagation();
                if (isDismissed) return;
                isDismissed = true;
                toast.classList.add('toast-hiding');
                setTimeout(() => {
                    if (toast.parentElement) toast.remove();
                }, 220);
            };

            toast.onclick = dismissToast;

            container.appendChild(toast);

            setTimeout(dismissToast, duration);
            return toast;
        }
        window.showToast = showToast;
        window.showBottomToast = showToast;

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
        window.showCustomConfirm = showCustomConfirm;

        function showCustomPrompt(options = {}) {
            return showSystemModal({
                ...options,
                type: 'prompt',
                isPrompt: true
            });
        }
        window.showCustomPrompt = showCustomPrompt;

        const INDEX_DISPLAY_NAMES = {
            '^IXIC': 'NASDAQ',
            '^NSEI': 'NIFTY 50',
            '^BSESN': 'SENSEX',
            '^NSEBANK': 'NIFTY BANK',
            '^CNXIT': 'NIFTY IT',
            '^CRSMID': 'NIFTY MIDCAP 100',
            'GIFTNIFTY': 'GIFT NIFTY',
            '^GSPC': 'S&P 500',
            '^DJI': 'DOW JONES',
            '^FTSE': 'FTSE 100',
            '^N225': 'NIKKEI 225',
            '^HSI': 'HANG SENG',
            '^VIX': 'INDIA VIX',
            '^INDIAVIX': 'INDIA VIX',
            '^RUT': 'RUSSELL 2000',
            '^GDAXI': 'DAX',
            '^FCHI': 'CAC 40',
            '^STOXX50E': 'EURO STOXX 50',
            '^KS11': 'KOSPI',
            '^CNX100': 'NIFTY 100',
            '^CNX200': 'NIFTY 200',
            '^CNX500': 'NIFTY 500',
            '^CNXAUTO': 'NIFTY AUTO',
            '^CNXFMCG': 'NIFTY FMCG',
            '^CNXMETAL': 'NIFTY METAL',
            '^CNXPHARMA': 'NIFTY PHARMA',
            '^CNXREALTY': 'NIFTY REALTY',
            '^CNXENERGY': 'NIFTY ENERGY',
            '^CNXINFRA': 'NIFTY INFRA',
            '^CNXCOMMODITIES': 'NIFTY COMMODITIES',
            '^CNXCONSUMPTION': 'NIFTY CONSUMPTION',
            '^CNXFINANCE': 'NIFTY FINANCIAL SERVICES',
            '^CNXMEDIA': 'NIFTY MEDIA',
            '^CNXPSE': 'NIFTY PSE',
            '^CNXPSUBANK': 'NIFTY PSU BANK',
            '^CNXSERVICE': 'NIFTY SERVICES SECTOR'
        };
        window.INDEX_DISPLAY_NAMES = INDEX_DISPLAY_NAMES;

        function cleanDisplaySymbol(sym) {
            if (sym === null || sym === undefined) return '';
            const s = String(sym).trim();
            const upper = s.toUpperCase();
            if (INDEX_DISPLAY_NAMES[upper]) {
                return INDEX_DISPLAY_NAMES[upper];
            }
            if (s.startsWith('^')) {
                const cachedInfo = (typeof stockPricesData !== 'undefined' && stockPricesData[s]) ? stockPricesData[s] : null;
                if (cachedInfo && cachedInfo.name && cachedInfo.name !== s) {
                    return cachedInfo.name.replace(/\s*Index\s*(\(US\))?/i, '').trim();
                }
                return s.substring(1);
            }
            if (s.includes('=F')) return s;
            // Hide .NS, .BS (and .BO, .NSE, .BSE) exchange suffixes only for display
            return s.replace(/\.(NS|BS|BO|NSE|BSE)$/i, '');
        }
        window.cleanDisplaySymbol = cleanDisplaySymbol;
        window.formatDisplaySymbol = cleanDisplaySymbol;
        window.displaySymbol = cleanDisplaySymbol;
        window.hideSymbolSuffix = cleanDisplaySymbol;
        window.stripExchangeSuffix = cleanDisplaySymbol;

        // Global App State
        let currentTab = 'watchlists';
        let watchlistsData = {};
        let portfoliosData = {};
        let activeWatchlistName = '';
        let activePortfolioName = '';
        let stockPricesData = {};
        try {
            const cachedPrices = localStorage.getItem('cd_cached_stock_prices');
            if (cachedPrices) {
                const parsed = JSON.parse(cachedPrices);
                if (parsed && typeof parsed === 'object') {
                    stockPricesData = parsed;
                }
            }
        } catch (e) {}
        let searchTimeout = null;
        window.portfoliosLoaded = false;
        window.watchlistsLoaded = false;


        let pfFilterOption = 'all'; // 'all', 'st', 'lt'
        let pfSortOption = 'day_pnl_desc'; // 'day_pnl_desc', 'day_pnl_asc', 'duration_desc', 'duration_asc', 'pnl_desc', 'pnl_asc', 'val_desc', 'date_desc', 'date_asc', 'name_asc'

        // Watchlist Sort State (Default: Day P&L % High to Low)
        var wlSortColumn = 'change_pct'; // 'symbol', 'price', 'change', 'change_pct'
        var wlSortDirection = 'desc';  // 'asc', 'desc'
        window.wlSortColumn = wlSortColumn;
        window.wlSortDirection = wlSortDirection;


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
            const _pfPrivLbl = (typeof window.PORTFOLIO_LABEL !== 'undefined' ? window.PORTFOLIO_LABEL.toLowerCase() : 'portfolio'); const titleStr = isPrivacyMode ? `Click to show ${_pfPrivLbl} amounts` : `Click to hide ${_pfPrivLbl} amounts (Privacy Mode)`;

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
        window.escapeHtml = escapeHtml;

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
                    return includeTime ? `${day}-${m}-${y} 00:00 IST` : `${day}-${m}-${y}`;
                }

                const dmyMatch = /^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::\d{2})?)?(?:\s*IST)?$/i.exec(trimmed);
                if (dmyMatch) {
                    const [, day, m, y, hh, mm] = dmyMatch;
                    if (includeTime && hh && mm) {
                        return `${day}-${m}-${y} ${hh}:${mm} IST`;
                    }
                    if (includeTime) {
                        return `${day}-${m}-${y} 00:00 IST`;
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

            try {
                const parts = new Intl.DateTimeFormat('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                }).formatToParts(d);
                const pMap = {};
                parts.forEach(p => pMap[p.type] = p.value);
                const day = pMap.day || String(d.getDate()).padStart(2, '0');
                const month = pMap.month || String(d.getMonth() + 1).padStart(2, '0');
                const year = pMap.year || d.getFullYear();
                const dateStr = `${day}-${month}-${year}`;

                if (!includeTime) return dateStr;

                const hours = pMap.hour || '00';
                const minutes = pMap.minute || '00';
                return `${dateStr} ${hours}:${minutes} IST`;
            } catch (e) {
                const day = String(d.getDate()).padStart(2, '0');
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const year = d.getFullYear();
                const dateStr = `${day}-${month}-${year}`;
                if (!includeTime) return dateStr;
                const hours = String(d.getHours()).padStart(2, '0');
                const minutes = String(d.getMinutes()).padStart(2, '0');
                return `${dateStr} ${hours}:${minutes} IST`;
            }
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
        window.getSymbolBadge = getSymbolBadge;



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
                        const _pfsRestLbl = (typeof window.PORTFOLIOS_LABEL !== 'undefined' ? window.PORTFOLIOS_LABEL : 'Portfolios'); alert(`✅ Data restored successfully! Watchlists & ${_pfsRestLbl} updated.`);
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
                if (res.status === 401) {
                    window.location.replace('/login');
                    return;
                }
                const data = await res.json();
                if (data && data.logged_in) {
                    const userEl = document.getElementById('header-username');
                    const mobileUserEl = document.getElementById('mobile-header-username');
                    const roleBadge = document.getElementById('sidebar-user-role-badge');
                    const sidebarAdminLink = document.getElementById('sidebar-nav-admin');
                    const adminLink = document.getElementById('admin-menu-link');

                    if (userEl) userEl.innerText = data.username;
                    if (mobileUserEl) mobileUserEl.innerText = data.username;
                    if (roleBadge) roleBadge.innerText = data.is_admin ? 'Administrator' : 'Member';
                    window.IS_ADMIN = Boolean(data.is_admin);
                    window.PORTFOLIO_LABEL = window.IS_ADMIN ? 'Portfolio' : 'Paperfolio';
                    window.PORTFOLIOS_LABEL = window.IS_ADMIN ? 'Portfolios' : 'Paperfolios';
                    if (!window.IS_ADMIN && typeof window.applyPaperfolioText === 'function') window.applyPaperfolioText();

                    if (data.is_admin) {
                        if (adminLink) adminLink.style.display = 'flex';
                        if (sidebarAdminLink) sidebarAdminLink.style.display = 'flex';
                        const adminRefreshMenuItem = document.getElementById('admin-refresh-intervals-menu-item');
                        const adminWlBtn = document.getElementById('adminWlIntervalBtn');
                        const adminPfBtn = document.getElementById('adminPfIntervalBtn');
                        const adminPfMobBtn = document.getElementById('adminPfMobIntervalBtn');
                        const adminChartBtn = document.getElementById('chartRefreshIntervalBtn');
                        if (adminRefreshMenuItem) adminRefreshMenuItem.style.display = 'flex';
                        if (adminWlBtn) adminWlBtn.style.display = 'inline-flex';
                        if (adminPfBtn) adminPfBtn.style.display = 'inline-flex';
                        if (adminPfMobBtn) adminPfMobBtn.style.display = 'flex';
                        if (adminChartBtn) adminChartBtn.style.display = 'inline-flex';
                        if (typeof updateRefreshIntervalLabels === 'function') updateRefreshIntervalLabels();
                    }

                    if (data.favorite_tools && Array.isArray(data.favorite_tools)) {
                        try {
                            localStorage.setItem('capital_desk_favorite_tools', JSON.stringify(data.favorite_tools));
                        } catch(e) {}
                        if (typeof window.renderFavoriteToolsShortcuts === 'function') {
                            window.renderFavoriteToolsShortcuts();
                        }
                    }
                } else if (data && data.logged_in === false) {
                    window.location.replace('/login');
                }
            } catch(e) {
                console.warn('Auth check network warning (preserving active session):', e);
            }
        }

        async function logoutUser() {
            try {
                await fetch('/api/logout');
            } catch(e) {
                console.error('Logout error:', e);
            } finally {
                window.location.replace('/login');
            }
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



        // =========================================================
        // MOBILE TOP HEADER SEARCH & TYPEAHEAD AUTOCOMPLETE
        // =========================================================
        let _mobileSearchTimeout = null;

        function openMobileHeaderSearch() {
            const defaultBar = document.getElementById('mobile-header-default');
            const searchBar = document.getElementById('mobile-header-search-active');
            const backdrop = document.getElementById('mobile-header-search-backdrop');
            const dropdown = document.getElementById('mobile-header-search-dropdown');
            const topBar = document.getElementById('mobile-top-bar');
            const input = document.getElementById('mobile-header-search-input');

            if (defaultBar) defaultBar.style.display = 'none';
            if (searchBar) searchBar.style.display = 'flex';
            if (backdrop) backdrop.style.display = 'block';
            if (dropdown) {
                dropdown.style.display = 'block';
                if (topBar) {
                    const rect = topBar.getBoundingClientRect();
                    dropdown.style.top = `${Math.round(rect.bottom)}px`;
                }
            }
            if (topBar) topBar.classList.add('search-active');

            if (input) {
                setTimeout(() => {
                    input.focus();
                    if (!input.value.trim()) {
                        renderMobileSearchInitialState();
                    } else {
                        handleMobileHeaderSearchInput();
                    }
                }, 50);
            }
        }
        window.openMobileHeaderSearch = openMobileHeaderSearch;

        function closeMobileHeaderSearch() {
            const defaultBar = document.getElementById('mobile-header-default');
            const searchBar = document.getElementById('mobile-header-search-active');
            const backdrop = document.getElementById('mobile-header-search-backdrop');
            const dropdown = document.getElementById('mobile-header-search-dropdown');
            const topBar = document.getElementById('mobile-top-bar');

            if (defaultBar) defaultBar.style.display = 'flex';
            if (searchBar) searchBar.style.display = 'none';
            if (backdrop) backdrop.style.display = 'none';
            if (dropdown) dropdown.style.display = 'none';
            if (topBar) topBar.classList.remove('search-active');

            if (typeof window.closeAllWlMenus === 'function') {
                window.closeAllWlMenus();
            } else {
                const popover = document.getElementById('wl-global-stock-popover');
                if (popover) popover.style.display = 'none';
            }
        }
        window.closeMobileHeaderSearch = closeMobileHeaderSearch;

        function clearMobileHeaderSearch() {
            const input = document.getElementById('mobile-header-search-input');
            const clearBtn = document.getElementById('mobile-header-search-clear');
            if (input) {
                input.value = '';
                input.focus();
            }
            if (clearBtn) clearBtn.style.display = 'none';
            renderMobileSearchInitialState();
        }
        window.clearMobileHeaderSearch = clearMobileHeaderSearch;

        function renderMobileSearchInitialState() {
            const list = document.getElementById('mobile-header-search-list');
            if (!list) return;
            list.innerHTML = `
                <div class="mobile-search-placeholder">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5; margin-bottom:4px;">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <div style="font-weight: 600; color: var(--text-primary); font-size: 13.5px;">Search Stocks & Indices</div>
                    <div style="font-size: 11.5px; color: var(--text-muted);">Type 2 or more letters to suggest stocks</div>
                </div>
            `;
        }

        function handleMobileHeaderSearchInput(event) {
            const input = document.getElementById('mobile-header-search-input');
            const clearBtn = document.getElementById('mobile-header-search-clear');
            const list = document.getElementById('mobile-header-search-list');
            if (!input || !list) return;

            const query = input.value.trim();
            if (clearBtn) clearBtn.style.display = query ? 'inline-flex' : 'none';

            if (_mobileSearchTimeout) {
                clearTimeout(_mobileSearchTimeout);
                _mobileSearchTimeout = null;
            }

            if (query.length < 2) {
                renderMobileSearchInitialState();
                return;
            }

            list.innerHTML = `
                <div class="mobile-search-loading">
                    <div style="width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.15); border-top-color: var(--accent, #3b82f6); border-radius: 50%; animation: spin 0.7s linear infinite;"></div>
                    <span style="font-size: 12px; margin-top: 6px;">Searching "${escapeHtml(query)}"...</span>
                </div>
            `;

            _mobileSearchTimeout = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
                    const results = await res.json();

                    if (input.value.trim() !== query) return;

                    renderMobileSearchResults(results, query);
                } catch (err) {
                    console.error('Mobile stock search error:', err);
                    list.innerHTML = `
                        <div class="mobile-search-empty">
                            <span style="color: #ef4444; font-size: 12px;">Failed to load suggestions. Please check connection.</span>
                        </div>
                    `;
                }
            }, 200);
        }
        window.handleMobileHeaderSearchInput = handleMobileHeaderSearchInput;

        function handleMobileHeaderSearchKeydown(event) {
            if (event.key === 'Escape') {
                closeMobileHeaderSearch();
            }
        }
        window.handleMobileHeaderSearchKeydown = handleMobileHeaderSearchKeydown;

        function renderMobileSearchResults(results, query) {
            const list = document.getElementById('mobile-header-search-list');
            if (!list) return;

            if (!Array.isArray(results) || results.length === 0) {
                list.innerHTML = `
                    <div class="mobile-search-empty">
                        <span style="font-size: 20px; opacity: 0.6; margin-bottom: 2px;">🔍</span>
                        <span style="font-weight: 600; color: var(--text-primary);">No stocks found</span>
                        <span style="font-size: 11.5px; color: var(--text-muted);">No matching symbol or company for "${escapeHtml(query)}"</span>
                    </div>
                `;
                return;
            }

            list.innerHTML = '';
            const prices = (typeof window.stockPricesData !== 'undefined' && window.stockPricesData) ? window.stockPricesData : {};

            results.forEach(item => {
                const sym = item.symbol;
                const bInfo = typeof window.getSymbolBadge === 'function' ? window.getSymbolBadge(sym, item.exchange) : { label: item.exchange || 'NSE', class: 'badge-nse' };
                const cleanSym = typeof window.cleanDisplaySymbol === 'function' ? window.cleanDisplaySymbol(sym) : sym;
                const info = prices[sym] || {};

                let priceHtml = '';
                if (info.price !== undefined) {
                    const priceVal = '₹' + Number(info.price).toLocaleString('en-IN', { minimumFractionDigits: 2 });
                    const sign = (info.change !== undefined && info.change >= 0) ? '+' : '';
                    const changeCls = (info.change !== undefined && info.change >= 0) ? 'pos' : 'neg';
                    const pctVal = (info.change_pct !== undefined) ? `${sign}${info.change_pct.toFixed(2)}%` : '';
                    priceHtml = `
                        <div style="margin-left: auto; text-align: right; font-size: 11px; line-height: 1.2;">
                            <div style="font-weight: 600; color: var(--text-primary);">${priceVal}</div>
                            ${pctVal ? `<div class="${changeCls}" style="font-size: 10px; font-weight: 500;">${pctVal}</div>` : ''}
                        </div>
                    `;
                }

                const itemEl = document.createElement('div');
                itemEl.className = 'mobile-search-result-item';
                itemEl.setAttribute('data-symbol', sym);
                itemEl.innerHTML = `
                    <div class="mobile-search-item-info">
                        <div class="mobile-search-item-top">
                            <span class="mobile-search-symbol">${escapeHtml(cleanSym)}</span>
                            <span class="badge ${bInfo.class}">${escapeHtml(bInfo.label)}</span>
                            ${priceHtml}
                        </div>
                        <div class="mobile-search-item-name">${escapeHtml(item.name || sym)}</div>
                    </div>
                    <div class="mobile-search-item-action">
                        <button type="button" class="btn-secondary wl-row-menu-btn mobile-search-setting-btn" title="Actions for ${escapeHtml(cleanSym)}" aria-label="Stock settings">
                            <span class="wl-setting-icon">⚙️</span>
                        </button>
                    </div>
                `;

                // Click directly on stock item -> go to chart
                itemEl.onclick = (e) => {
                    if (e.target.closest('.mobile-search-setting-btn') || e.target.closest('.wl-row-menu-btn')) {
                        return;
                    }
                    handleMobileSearchResultClick(sym);
                };

                // Click on setting icon button -> open watchlist stock setting popover
                const settingBtn = itemEl.querySelector('.mobile-search-setting-btn');
                if (settingBtn) {
                    settingBtn.onclick = (e) => {
                        handleMobileSearchSettingClick(e, sym);
                    };
                }

                list.appendChild(itemEl);
            });
        }

        function handleMobileSearchResultClick(sym) {
            if (window._wlMenuJustClosed) return;
            closeMobileHeaderSearch();
            if (typeof window.handleWatchlistStockClick === 'function') {
                window.handleWatchlistStockClick(sym);
            } else if (typeof window.openInHouseChart === 'function') {
                window.openInHouseChart(sym);
            }
        }
        window.handleMobileSearchResultClick = handleMobileSearchResultClick;

        function handleMobileSearchSettingClick(event, sym) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            if (typeof window.toggleWlRowMenu === 'function') {
                window.toggleWlRowMenu(event, sym);
            }
        }
        window.handleMobileSearchSettingClick = handleMobileSearchSettingClick;


        // =========================================================
        // PAPERFOLIO UI ADAPTER (Non-admin User Experience)
        // Dynamically reflects "Paperfolio" / "Paperfolios" across UI text
        // =========================================================
        function replacePaperfolioString(str) {
            if (!str || typeof str !== 'string') return str;
            return str.replace(/\bPortfolios\b/g, 'Paperfolios')
                      .replace(/\bPortfolio\b/g, 'Paperfolio')
                      .replace(/\bPORTFOLIOS\b/g, 'PAPERFOLIOS')
                      .replace(/\bPORTFOLIO\b/g, 'PAPERFOLIO')
                      .replace(/\bportfolios\b/g, 'paperfolios')
                      .replace(/\bportfolio\b/g, 'paperfolio');
        }

        window.applyPaperfolioText = function(root = document.body) {
            if (window.IS_ADMIN) return;
            if (!root) return;
            
            try {
                // Update document title if applicable
                if (document.title && /portfolio/i.test(document.title)) {
                    document.title = replacePaperfolioString(document.title);
                }

                const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                    acceptNode(node) {
                        const p = node.parentElement;
                        if (!p) return NodeFilter.FILTER_SKIP;
                        const tag = p.tagName;
                        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || p.isContentEditable) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        if (/portfolio/i.test(node.nodeValue)) {
                            return NodeFilter.FILTER_ACCEPT;
                        }
                        return NodeFilter.FILTER_SKIP;
                    }
                });

                const nodes = [];
                while (walker.nextNode()) {
                    nodes.push(walker.currentNode);
                }

                nodes.forEach(node => {
                    const orig = node.nodeValue;
                    const text = replacePaperfolioString(orig);
                    if (orig !== text) {
                        node.nodeValue = text;
                    }
                });

                const query = '[title*="ortfolio" i], [aria-label*="ortfolio" i], [placeholder*="ortfolio" i], [alt*="ortfolio" i], option';
                const els = root.querySelectorAll ? root.querySelectorAll(query) : [];
                els.forEach(el => {
                    if (el.title && /portfolio/i.test(el.title)) {
                        el.title = replacePaperfolioString(el.title);
                    }
                    if (el.getAttribute('aria-label') && /portfolio/i.test(el.getAttribute('aria-label'))) {
                        el.setAttribute('aria-label', replacePaperfolioString(el.getAttribute('aria-label')));
                    }
                    if (el.placeholder && /portfolio/i.test(el.placeholder)) {
                        el.placeholder = replacePaperfolioString(el.placeholder);
                    }
                    if (el.tagName === 'OPTION' && el.textContent && /portfolio/i.test(el.textContent)) {
                        el.textContent = replacePaperfolioString(el.textContent);
                    }
                });
            } catch(e) {}
        };

        // Initialize Paperfolio UI patcher & universal Observer
        let _paperfolioObserverStarted = false;
        function initPaperfolioObserver() {
            if (window.IS_ADMIN) return;
            if (_paperfolioObserverStarted) return;
            _paperfolioObserverStarted = true;

            // Intercept window.alert & window.confirm for non-admin to transform messages
            if (typeof window.nativeAlert === 'undefined') {
                window.nativeAlert = window.alert;
                window.alert = function(msg) {
                    if (!window.IS_ADMIN && typeof msg === 'string') {
                        msg = replacePaperfolioString(msg);
                    }
                    return window.nativeAlert(msg);
                };
            }
            if (typeof window.nativeConfirm === 'undefined') {
                window.nativeConfirm = window.confirm;
                window.confirm = function(msg) {
                    if (!window.IS_ADMIN && typeof msg === 'string') {
                        msg = replacePaperfolioString(msg);
                    }
                    return window.nativeConfirm(msg);
                };
            }

            // Wrap showCustomConfirm if present
            if (typeof window.showCustomConfirm === 'function' && !window._origShowCustomConfirm) {
                window._origShowCustomConfirm = window.showCustomConfirm;
                window.showCustomConfirm = function(opts) {
                    if (!window.IS_ADMIN && opts && typeof opts === 'object') {
                        if (opts.title) opts.title = replacePaperfolioString(opts.title);
                        if (opts.message) opts.message = replacePaperfolioString(opts.message);
                    }
                    return window._origShowCustomConfirm(opts);
                };
            }

            const runTransform = () => {
                if (document.body) {
                    window.applyPaperfolioText(document.body);
                }
            };

            runTransform();

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', runTransform);
            }
            window.addEventListener('load', runTransform);

            if (window.MutationObserver) {
                let _pfDebounce = null;
                const obs = new MutationObserver((mutations) => {
                    if (window.IS_ADMIN) return;
                    clearTimeout(_pfDebounce);
                    _pfDebounce = setTimeout(() => {
                        window.applyPaperfolioText(document.body);
                    }, 50);
                });
                obs.observe(document.documentElement, {
                    childList: true,
                    subtree: true,
                    characterData: true
                });
            }
        }
        window.initPaperfolioObserver = initPaperfolioObserver;

        if (typeof window.IS_ADMIN === 'undefined' || !window.IS_ADMIN) {
            initPaperfolioObserver();
        }


        // Auto-refresh intervals are configured in Admin Panel -> System Settings
        window.openRefreshIntervalsModal = function() {};
        window.closeRefreshIntervalsModal = function() {};
        window.handleSaveRefreshIntervals = function() {};
        window.updateRefreshIntervalLabels = function() {};
