        // =========================================================
        // TECHNICAL CHARTS (PRO CANVAS ENGINE)
        // =========================================================
        var currentChartSymbol = window.currentChartSymbol || '';
        var savedChartInterval = '1d';
        try {
            savedChartInterval = localStorage.getItem('capital_desk_chart_interval') || window.currentChartInterval || '1d';
        } catch(e) {}
        var currentChartInterval = savedChartInterval;
        var currentChartRange = window.currentChartRange || '3y';
        var chartType = window.chartType || 'candlestick';

        function getIntervalDisplayLabel(intVal) {
            if (!intVal) return '1D';
            const s = String(intVal).toLowerCase();
            if (s === '1mo') return '1M';
            if (s === '1w') return '1W';
            if (s === '1d') return '1D';
            if (s === '1h' || s === '60m') return '1H';
            if (s === '15m') return '15M';
            if (s === '5m') return '5M';
            return s.toUpperCase();
        }
        
        var mainChart = window.mainChart || null;
        var mainSeries = window.mainSeries || null;
        var volumeSeries = window.volumeSeries || null;
        var volumeMaSeries = window.volumeMaSeries || null;
        
        // Indicator Series
        var cdRiderSeries = null;
        var cachedCdRiderMarkers = [];
        var stTriggerSeries = null;
        var stTriggerPriceLine = null;
        var cachedStTriggerMarkers = [];
        var cachedStTriggerInfo = null;
        var donchianUpperSeries = null;
        var donchianMiddleSeries = null;
        var donchianLowerSeries = null;
        var cachedBsDonchianMarkers = [];
        var sma50Series = null;
        var sma200Series = null;
        var ema9Series = null;
        var ema21Series = null;
        var gann2DaySeries = null;

        // Sub-pane Charts
        var rsiChart = null;
        var rsiSeries = null;

        var macdChart = null;
        var macdLineSeries = null;
        var macdSignalSeries = null;
        var macdHistSeries = null;

        // Active Drawing Price Lines
        var activePriceLines = [];
        var cachedChartData = null;
        var latestCandlePrice = 0;

        function escapeHtml(str) {
            if (!str) return '';
            return String(str).replace(/[&<>"']/g, function(m) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
            });
        }

        function toggleChartPopover(popoverId, event) {
            if (event) event.stopPropagation();
            const targetMenu = document.getElementById(popoverId);
            const isCurrentlyShown = targetMenu && targetMenu.classList.contains('show');
            closeAllChartPopovers();
            if (targetMenu && !isCurrentlyShown) {
                targetMenu.classList.add('show');
            }
        }

        function closeAllChartPopovers() {
            document.querySelectorAll('.chart-popover-menu').forEach(menu => {
                menu.classList.remove('show');
            });
        }

        function hasOpenChartPopover() {
            return !!document.querySelector('.chart-popover-menu.show');
        }

        function handleChartPointerOrClick(e) {
            if (hasOpenChartPopover()) {
                // Keep popovers open when interacting with controls inside a popover wrapper
                if (e.target && e.target.closest && e.target.closest('.chart-popover-wrapper')) {
                    return;
                }
                closeAllChartPopovers();
            }

            // Close more menu on outside click
            const moreMenu = document.getElementById('canvasObjMoreMenu');
            if (moreMenu && moreMenu.style.display === 'flex') {
                if (!e.target || !e.target.closest || (!e.target.closest('#canvasObjMoreMenu') && !e.target.closest('.canvas-obj-more-btn'))) {
                    moreMenu.style.display = 'none';
                }
            }

            // On mobile view only: close drawing action popup if user taps outside
            if (window.innerWidth <= 768) {
                const objPopup = document.getElementById('canvasObjectPopup');
                if (objPopup && objPopup.style.display === 'flex') {
                    if (e.target && e.target.closest && (e.target.closest('#canvasObjectPopup') || e.target.closest('#drawingCanvas') || e.target.closest('#mainChartPane'))) {
                        // Managed inside chart pane/drawing interactions
                    } else {
                        hideCanvasObjectMenu();
                    }
                }
            }
        }

        // Global capture listeners so any chart tap, canvas touch, or outside click closes popovers immediately
        window.addEventListener('pointerdown', handleChartPointerOrClick, true);
        window.addEventListener('touchstart', handleChartPointerOrClick, { capture: true, passive: true });
        window.addEventListener('mousedown', handleChartPointerOrClick, true);
        window.addEventListener('click', handleChartPointerOrClick, true);

        // When scrolling the chart via touch gesture/drag or mouse wheel
        window.addEventListener('touchmove', function(e) {
            if (hasOpenChartPopover()) {
                if (!e.target || !e.target.closest || !e.target.closest('.chart-popover-menu')) {
                    closeAllChartPopovers();
                }
            }
        }, { capture: true, passive: true });

        window.addEventListener('wheel', function(e) {
            if (hasOpenChartPopover()) {
                if (!e.target || !e.target.closest || !e.target.closest('.chart-popover-menu')) {
                    closeAllChartPopovers();
                }
            }
        }, { capture: true, passive: true });

        function loadSavedChartIndicators() {
            try {
                const saved = localStorage.getItem('capital_desk_chart_indicators');
                if (saved) {
                    const prefs = JSON.parse(saved);
                    const keys = ['chkCdRider', 'chkStTrigger', 'chkBsDonchian', 'chkVolume', 'chkVolumeMa', 'chkSma50', 'chkSma200', 'chkEma9', 'chkGann2Day', 'chkRsi', 'chkMacd'];
                    keys.forEach(k => {
                        const el = document.getElementById(k);
                        if (el && prefs[k] !== undefined) {
                            el.checked = prefs[k];
                        }
                    });
                }
            } catch(e){}
        }

        
        // =========================================================
        // DRAWING PERSISTENCE HELPERS (Trendline Color, Text, Size, Pos)
        // =========================================================
        function getLastTrendlineColor() {
            try {
                const c = localStorage.getItem('cd_last_trendline_color');
                if (c && /^#([0-9A-F]{3}){1,2}$/i.test(c)) return c;
            } catch(e) {}
            return '#3b82f6';
        }
        function setLastTrendlineColor(color) {
            if (!color) return;
            try {
                localStorage.setItem('cd_last_trendline_color', color);
            } catch(e) {}
        }

        function getLastDrawingTextColor() {
            try {
                const c = localStorage.getItem('cd_last_drawing_text_color');
                if (c && /^#([0-9A-F]{3}){1,2}$/i.test(c)) return c;
            } catch(e) {}
            return '#ffffff';
        }
        function setLastDrawingTextColor(color) {
            if (!color) return;
            try {
                localStorage.setItem('cd_last_drawing_text_color', color);
            } catch(e) {}
        }

        function getLastDrawingFontSize() {
            try {
                const s = localStorage.getItem('cd_last_drawing_font_size');
                const num = parseInt(s);
                if (!isNaN(num) && num > 0) return num;
            } catch(e) {}
            return 12;
        }
        function setLastDrawingFontSize(size) {
            const num = parseInt(size);
            if (isNaN(num) || num <= 0) return;
            try {
                localStorage.setItem('cd_last_drawing_font_size', String(num));
            } catch(e) {}
        }

        function getLastDrawingTextPos() {
            try {
                const p = localStorage.getItem('cd_last_drawing_text_pos');
                if (['left', 'center', 'right'].includes(p)) return p;
            } catch(e) {}
            return 'center';
        }
        function setLastDrawingTextPos(pos) {
            if (!['left', 'center', 'right'].includes(pos)) return;
            try {
                localStorage.setItem('cd_last_drawing_text_pos', pos);
            } catch(e) {}
        }

        function getLastDrawingTextValign() {
            try {
                const v = localStorage.getItem('cd_last_drawing_text_valign');
                if (['top', 'middle', 'bottom'].includes(v)) return v;
            } catch(e) {}
            return 'top';
        }
        function setLastDrawingTextValign(valign) {
            if (!['top', 'middle', 'bottom'].includes(valign)) return;
            try {
                localStorage.setItem('cd_last_drawing_text_valign', valign);
            } catch(e) {}
        }

        window.getLastTrendlineColor = getLastTrendlineColor;
        window.setLastTrendlineColor = setLastTrendlineColor;
        window.getLastDrawingTextColor = getLastDrawingTextColor;
        window.setLastDrawingTextColor = setLastDrawingTextColor;
        window.getLastDrawingFontSize = getLastDrawingFontSize;
        window.setLastDrawingFontSize = setLastDrawingFontSize;
        window.getLastDrawingTextPos = getLastDrawingTextPos;
        window.setLastDrawingTextPos = setLastDrawingTextPos;
        window.getLastDrawingTextValign = getLastDrawingTextValign;
        window.setLastDrawingTextValign = setLastDrawingTextValign;

        var activeToolColor = '#10b981'; // Active drawing color
        var activeToolLineWidth = 2; // Active line thickness (1, 2, 3, 4)
        var activeToolLineStyle = 'solid'; // Active line style ('solid', 'dashed', 'dotted')

        function renderLineStyleIcon(style) {
            if (style === 'dotted') {
                return `<svg width="18" height="14" viewBox="0 0 18 14"><line x1="2" y1="7" x2="16" y2="7" stroke="currentColor" stroke-width="2.5" stroke-dasharray="2 3" stroke-linecap="round"/></svg>`;
            } else if (style === 'dashed') {
                return `<svg width="18" height="14" viewBox="0 0 18 14"><line x1="2" y1="7" x2="16" y2="7" stroke="currentColor" stroke-width="2" stroke-dasharray="4 2"/></svg>`;
            } else {
                return `<svg width="18" height="14" viewBox="0 0 18 14"><line x1="2" y1="7" x2="16" y2="7" stroke="currentColor" stroke-width="2"/></svg>`;
            }
        }
        window.renderLineStyleIcon = renderLineStyleIcon;

        function setActiveToolColor(colorHex, el) {
            activeToolColor = colorHex;
            if (currentDrawingTool === 'trendline') {
                setLastTrendlineColor(colorHex);
            }
            document.querySelectorAll('.tool-color-selector .color-dot').forEach(dot => dot.classList.remove('active'));
            if (el) {
                el.classList.add('active');
            }
            const picker = document.getElementById('toolCustomColorPicker');
            if (picker) picker.value = colorHex;
        }

        function hexToRgba(hex, alpha) {
            if (!hex) return `rgba(16, 185, 129, ${alpha})`;
            let c = hex.replace('#', '');
            if (c.length === 3) c = c.split('').map(x => x + x).join('');
            const num = parseInt(c, 16);
            if (isNaN(num)) return `rgba(16, 185, 129, ${alpha})`;
            return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
        }

        // =========================================================
        // DRAWINGS STORAGE & INDIVIDUAL MANAGEMENT (Synced to app_data/drawings/{user_name})
        // =========================================================
        const _serverDrawingsCache = {};
        let _drawingsSyncDebounceTimer = null;

        function getSavedPriceLines(sym) {
            if (!sym) return [];
            if (_serverDrawingsCache[sym] && Array.isArray(_serverDrawingsCache[sym].lines)) {
                return _serverDrawingsCache[sym].lines;
            }
            try {
                const data = localStorage.getItem('capital_desk_chart_lines_' + sym);
                const lines = data ? JSON.parse(data) : [];
                if (!_serverDrawingsCache[sym]) _serverDrawingsCache[sym] = {};
                _serverDrawingsCache[sym].lines = lines;
                return lines;
            } catch(e) { return []; }
        }

        function getSavedChartShapes(sym) {
            if (!sym) return [];
            if (_serverDrawingsCache[sym] && Array.isArray(_serverDrawingsCache[sym].shapes)) {
                return _serverDrawingsCache[sym].shapes;
            }
            try {
                const data = localStorage.getItem('capital_desk_chart_shapes_' + sym);
                const shapes = data ? JSON.parse(data) : [];
                if (!_serverDrawingsCache[sym]) _serverDrawingsCache[sym] = {};
                _serverDrawingsCache[sym].shapes = shapes;
                return shapes;
            } catch(e) { return []; }
        }

        function persistLinesForSymbol(sym, lines) {
            if (!sym) return;
            if (!_serverDrawingsCache[sym]) _serverDrawingsCache[sym] = {};
            _serverDrawingsCache[sym].lines = lines;
            try {
                localStorage.setItem('capital_desk_chart_lines_' + sym, JSON.stringify(lines));
            } catch(e){}
            scheduleDrawingsSaveToServer(sym);
        }

        function persistShapesForSymbol(sym, shapes) {
            if (!sym) return;
            if (!_serverDrawingsCache[sym]) _serverDrawingsCache[sym] = {};
            _serverDrawingsCache[sym].shapes = shapes;
            try {
                localStorage.setItem('capital_desk_chart_shapes_' + sym, JSON.stringify(shapes));
            } catch(e){}
            scheduleDrawingsSaveToServer(sym);
        }

        function savePriceLineForSymbol(sym, lineData) {
            if (!sym) return;
            try {
                if (!lineData.id) {
                    lineData.id = 'pl_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
                }
                const existing = getSavedPriceLines(sym);
                const existingIdx = existing.findIndex(l => l.id === lineData.id);
                if (existingIdx !== -1) {
                    existing[existingIdx] = lineData;
                } else {
                    existing.push(lineData);
                }
                persistLinesForSymbol(sym, existing);
                renderActiveDrawingsList();
            } catch(e){}
        }

        function clearSavedPriceLines(sym) {
            if (!sym) return;
            try {
                if (_serverDrawingsCache[sym]) _serverDrawingsCache[sym].lines = [];
                localStorage.removeItem('capital_desk_chart_lines_' + sym);
                renderActiveDrawingsList();
                scheduleDrawingsSaveToServer(sym);
            } catch(e){}
        }

        function saveChartShapeForSymbol(sym, shapeData) {
            if (!sym) return;
            try {
                if (!shapeData.id) {
                    shapeData.id = 'sh_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
                }
                const existing = getSavedChartShapes(sym);
                const existingIdx = existing.findIndex(s => s.id === shapeData.id);
                if (existingIdx !== -1) {
                    existing[existingIdx] = shapeData;
                } else {
                    existing.push(shapeData);
                }
                persistShapesForSymbol(sym, existing);
                renderActiveDrawingsList();
            } catch(e){}
        }

        function clearSavedChartShapes(sym) {
            if (!sym) return;
            try {
                if (_serverDrawingsCache[sym]) _serverDrawingsCache[sym].shapes = [];
                localStorage.removeItem('capital_desk_chart_shapes_' + sym);
                renderActiveDrawingsList();
                scheduleDrawingsSaveToServer(sym);
            } catch(e){}
        }

        function scheduleDrawingsSaveToServer(sym) {
            if (!sym) return;
            if (_drawingsSyncDebounceTimer) clearTimeout(_drawingsSyncDebounceTimer);
            _drawingsSyncDebounceTimer = setTimeout(() => {
                syncSymbolDrawingsToServer(sym);
            }, 250);
        }

        async function syncSymbolDrawingsToServer(sym) {
            if (!sym) return;
            const lines = getSavedPriceLines(sym);
            const shapes = getSavedChartShapes(sym);

            try {
                if (lines.length === 0 && shapes.length === 0) {
                    await fetch('/api/drawings?symbol=' + encodeURIComponent(sym), {
                        method: 'DELETE'
                    });
                } else {
                    await fetch('/api/drawings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            symbol: sym,
                            lines: lines,
                            shapes: shapes
                        })
                    });
                }
            } catch (err) {
                console.warn('Failed to save chart drawings to server:', err);
            }
        }

        async function fetchSymbolDrawingsFromServer(sym) {
            if (!sym) return;
            try {
                const res = await fetch('/api/drawings?symbol=' + encodeURIComponent(sym));
                if (!res.ok) return;
                const data = await res.json();
                if (data.success && (data.lines || data.shapes)) {
                    const serverLines = data.lines || [];
                    const serverShapes = data.shapes || [];

                    if (!_serverDrawingsCache[sym]) _serverDrawingsCache[sym] = {};
                    _serverDrawingsCache[sym].lines = serverLines;
                    _serverDrawingsCache[sym].shapes = serverShapes;

                    localStorage.setItem('capital_desk_chart_lines_' + sym, JSON.stringify(serverLines));
                    localStorage.setItem('capital_desk_chart_shapes_' + sym, JSON.stringify(serverShapes));

                    if (currentChartSymbol === sym) {
                        restoreSavedPriceLines(sym);
                        redrawCanvasOverlay();
                        renderActiveDrawingsList();
                    }
                }
            } catch (err) {
                console.warn('Failed to fetch symbol drawings from server:', err);
            }
        }

        async function initServerDrawingsSync() {
            try {
                const res = await fetch('/api/drawings');
                if (!res.ok) return;
                const data = await res.json();
                if (data.success && data.drawings) {
                    const serverMap = data.drawings;
                    for (const [sym, rec] of Object.entries(serverMap)) {
                        if (!sym) continue;
                        const sLines = rec.lines || [];
                        const sShapes = rec.shapes || [];
                        _serverDrawingsCache[sym] = { lines: sLines, shapes: sShapes };
                        localStorage.setItem('capital_desk_chart_lines_' + sym, JSON.stringify(sLines));
                        localStorage.setItem('capital_desk_chart_shapes_' + sym, JSON.stringify(sShapes));
                    }
                }

                // Initial migration: check if client has local drawings that server does not have yet
                const localToMigrate = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith('capital_desk_chart_lines_')) {
                        const sym = k.replace('capital_desk_chart_lines_', '');
                        if (sym && (!_serverDrawingsCache[sym] || (_serverDrawingsCache[sym].lines || []).length === 0)) {
                            const lines = JSON.parse(localStorage.getItem(k) || '[]');
                            const shapes = JSON.parse(localStorage.getItem('capital_desk_chart_shapes_' + sym) || '[]');
                            if (lines.length > 0 || shapes.length > 0) {
                                localToMigrate[sym] = { lines, shapes };
                            }
                        }
                    }
                }
                if (Object.keys(localToMigrate).length > 0) {
                    await fetch('/api/drawings/sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ drawings: localToMigrate })
                    });
                }
            } catch (err) {
                console.warn('Error during initial server drawings sync:', err);
            }
        }

        let isAllDrawingsHidden = false;

        function togglePriceLineVisibility(id) {
            const lines = getSavedPriceLines(currentChartSymbol);
            const item = lines.find(x => x.id === id);
            if (item) {
                item.hidden = !item.hidden;
                persistLinesForSymbol(currentChartSymbol, lines);
                restoreSavedPriceLines(currentChartSymbol);
                redrawCanvasOverlay();
                renderActiveDrawingsList();
            }
        }

        function toggleShapeVisibility(id) {
            const shapes = getSavedChartShapes(currentChartSymbol);
            const shape = shapes.find(s => s.id === id);
            if (shape) {
                shape.hidden = !shape.hidden;
                persistShapesForSymbol(currentChartSymbol, shapes);
                redrawCanvasOverlay();
                renderActiveDrawingsList();
            }
        }

        function toggleHideAllDrawings() {
            isAllDrawingsHidden = !isAllDrawingsHidden;
            restoreSavedPriceLines(currentChartSymbol);
            redrawCanvasOverlay();
            renderActiveDrawingsList();

            const btn = document.getElementById('btnToggleHideAllDrawings');
            if (btn) {
                btn.innerText = isAllDrawingsHidden ? '👁️ Show All' : '🙈 Hide All';
                btn.style.color = isAllDrawingsHidden ? '#ef4444' : '#d1d4dc';
            }
        }

        function togglePriceLineLock(id) {
            const lines = getSavedPriceLines(currentChartSymbol);
            const item = lines.find(x => x.id === id);
            if (item) {
                item.locked = !item.locked;
                persistLinesForSymbol(currentChartSymbol, lines);
                restoreSavedPriceLines(currentChartSymbol);
                redrawCanvasOverlay();
                renderActiveDrawingsList();
                const popup = document.getElementById('canvasObjectPopup');
                if (popup && popup.dataset.activeObjId === String(id)) {
                    updateCanvasObjectPopupLockState(item.locked);
                }
                showToast(item.locked ? 'Drawing line locked' : 'Drawing line unlocked', 'info');
            }
        }
        window.togglePriceLineLock = togglePriceLineLock;

        function toggleShapeLock(id) {
            const shapes = getSavedChartShapes(currentChartSymbol);
            const shape = shapes.find(s => s.id === id);
            if (shape) {
                shape.locked = !shape.locked;
                persistShapesForSymbol(currentChartSymbol, shapes);
                redrawCanvasOverlay();
                renderActiveDrawingsList();
                const popup = document.getElementById('canvasObjectPopup');
                if (popup && popup.dataset.activeObjId === String(id)) {
                    updateCanvasObjectPopupLockState(shape.locked);
                }
                showToast(shape.locked ? 'Drawing shape locked' : 'Drawing shape unlocked', 'info');
            }
        }
        window.toggleShapeLock = toggleShapeLock;

        function toggleLockAllDrawings() {
            const lines = getSavedPriceLines(currentChartSymbol);
            const shapes = getSavedChartShapes(currentChartSymbol);
            if (lines.length === 0 && shapes.length === 0) {
                showToast('No active drawings to lock.', 'info');
                return;
            }
            const hasAnyUnlocked = lines.some(l => !l.locked) || shapes.some(s => !s.locked);
            const targetState = hasAnyUnlocked; // Lock all if any unlocked, else unlock all

            lines.forEach(l => { l.locked = targetState; });
            shapes.forEach(s => { s.locked = targetState; });

            persistLinesForSymbol(currentChartSymbol, lines);
            persistShapesForSymbol(currentChartSymbol, shapes);
            restoreSavedPriceLines(currentChartSymbol);
            redrawCanvasOverlay();
            renderActiveDrawingsList();

            const popup = document.getElementById('canvasObjectPopup');
            if (popup && popup.dataset.activeObjId) {
                updateCanvasObjectPopupLockState(targetState);
            }

            const btn = document.getElementById('btnToggleLockAllDrawings');
            if (btn) {
                btn.innerText = targetState ? '🔓 Unlock All' : '🔒 Lock All';
                btn.style.color = targetState ? '#3b82f6' : '#d1d4dc';
            }
            showToast(targetState ? 'All drawings locked' : 'All drawings unlocked', 'info');
        }
        window.toggleLockAllDrawings = toggleLockAllDrawings;

        function restoreSavedPriceLines(sym) {
            if (!mainSeries || !sym) return;
            // Remove existing line objects from series first
            if (activePriceLines.length > 0) {
                activePriceLines.forEach(item => {
                    try { mainSeries.removePriceLine(item.lineObj); } catch(e){}
                });
                activePriceLines = [];
            }

            if (isAllDrawingsHidden) {
                renderActiveDrawingsList();
                return;
            }

            const lines = getSavedPriceLines(sym);
            lines.forEach(item => {
                if (!item.hidden) {
                    try {
                        const lw = item.lineWidth ? parseInt(item.lineWidth) : 2;
                        let ls = LightweightCharts.LineStyle.Dashed;
                        if (item.lineStyle === 'solid') ls = LightweightCharts.LineStyle.Solid;
                        else if (item.lineStyle === 'dotted') ls = LightweightCharts.LineStyle.Dotted;
                        else if (item.lineStyle === 'dashed') ls = LightweightCharts.LineStyle.Dashed;

                        const lockPrefix = item.locked ? '🔒 ' : '';
                        const priceLine = mainSeries.createPriceLine({
                            price: item.price,
                            color: item.color || '#10b981',
                            lineWidth: lw,
                            lineStyle: ls,
                            axisLabelVisible: true,
                            title: '' // Label badge rendered on left side of drawing via canvas overlay
                        });
                        activePriceLines.push({ id: item.id, lineObj: priceLine, data: item });
                    } catch(e){}
                }
            });
            renderActiveDrawingsList();
        }

        function deletePriceLineById(id) {
            const lines = getSavedPriceLines(currentChartSymbol);
            const item = lines.find(x => x.id === id);
            if (item && item.locked) {
                showToast('This line is locked. Please unlock it to delete.', 'warning');
                return;
            }
            const idx = activePriceLines.findIndex(pl => pl.id === id);
            if (idx !== -1) {
                try { mainSeries.removePriceLine(activePriceLines[idx].lineObj); } catch(e){}
                activePriceLines.splice(idx, 1);
            }
            const updated = lines.filter(item => item.id !== id);
            persistLinesForSymbol(currentChartSymbol, updated);
            redrawCanvasOverlay();
            renderActiveDrawingsList();
        }

        function updatePriceLineColorById(id, newColor) {
            const lines = getSavedPriceLines(currentChartSymbol);
            const item = lines.find(x => x.id === id);
            if (item) {
                item.color = newColor;
                persistLinesForSymbol(currentChartSymbol, lines);
                restoreSavedPriceLines(currentChartSymbol);
                redrawCanvasOverlay();
            }
        }

// getSavedChartShapes, saveChartShapeForSymbol, clearSavedChartShapes defined above

        function deleteShapeById(id) {
            const shapes = getSavedChartShapes(currentChartSymbol);
            const shape = shapes.find(s => s.id === id);
            if (shape && shape.locked) {
                showToast('This shape is locked. Please unlock it to delete.', 'warning');
                return;
            }
            const updated = shapes.filter(s => s.id !== id);
            persistShapesForSymbol(currentChartSymbol, updated);
            redrawCanvasOverlay();
            renderActiveDrawingsList();
        }

        function updateShapeColorById(id, newColor) {
            const shapes = getSavedChartShapes(currentChartSymbol);
            const shape = shapes.find(s => s.id === id);
            if (shape) {
                shape.color = newColor;
                if (shape.type === 'trendline') {
                    setLastTrendlineColor(newColor);
                }
                if (shape.type === 'rectangle') {
                    shape.fillColor = hexToRgba(newColor, 0.18);
                }
                persistShapesForSymbol(currentChartSymbol, shapes);
                redrawCanvasOverlay();
                renderActiveDrawingsList();
            }
        }

        function renderActiveDrawingsList() {
            const mount = document.getElementById('activeDrawingsListMount');
            const countEl = document.getElementById('activeDrawingsCount');
            const countNavEl = document.getElementById('activeDrawingsCountNav');

            const lines = getSavedPriceLines(currentChartSymbol);
            const shapes = getSavedChartShapes(currentChartSymbol);
            const totalCount = lines.length + shapes.length;

            if (countEl) countEl.innerText = totalCount;
            if (countNavEl) countNavEl.innerText = totalCount;

            const btnLockAll = document.getElementById('btnToggleLockAllDrawings');
            if (btnLockAll) {
                const allLocked = totalCount > 0 && lines.every(l => l.locked) && shapes.every(s => s.locked);
                btnLockAll.innerText = allLocked ? '🔓 Unlock All' : '🔒 Lock All';
                btnLockAll.style.color = allLocked ? '#3b82f6' : '#d1d4dc';
            }

            if (!mount) return;

            if (totalCount === 0) {
                mount.innerHTML = `<div style="text-align: center; color: #787b86; padding: 18px 0; font-size: 12px; font-weight: 500;">No active drawings on chart.</div>`;
                return;
            }

            let html = '';

            lines.forEach(l => {
                const labelName = l.label || (l.type === 'target' ? 'Target' : l.type === 'stoploss' ? 'Stop Loss' : l.type === 'resistance' ? 'Resistance' : 'Support');
                const itemColor = l.color || (l.type === 'resistance' ? '#788325' : (l.type === 'target' ? '#0b845c' : (l.type === 'support' ? '#731717' : (l.type === 'stoploss' ? '#ef5350' : '#731717'))));
                const isHidden = !!l.hidden;
                const isLocked = !!l.locked;
                html += `
                    <div class="active-drawing-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: #1a1e29; border: 1px solid #2a2e39; border-radius: 6px; font-size: 12px; color: #d1d4dc; opacity: ${isHidden ? '0.6' : '1'};">
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
                            <div style="position: relative; display: flex; align-items: center; flex-shrink: 0;">
                                <span style="display: inline-block; width: 12px; height: 12px; border-radius: 3px; background: ${itemColor}; cursor: pointer;" title="Change line color"></span>
                                <input type="color" value="${itemColor}" onchange="updatePriceLineColorById('${l.id}', this.value)" style="position: absolute; top: 0; left: 0; width: 12px; height: 12px; opacity: 0; cursor: pointer;">
                            </div>
                            <span style="font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; color: ${isHidden ? '#787b86' : '#e1e3e6'}; text-decoration: ${isHidden ? 'line-through' : 'none'};">${isLocked ? '<span style="color: #60a5fa; font-size: 11px; margin-right: 2px;" title="Locked">🔒</span>' : ''}${escapeHtml(labelName)}: ₹${l.price}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                            <button class="active-drawing-lock-btn" onclick="togglePriceLineLock('${l.id}')" style="background: none; border: none; cursor: pointer; font-size: 13px; color: ${isLocked ? '#60a5fa' : '#787b86'}; padding: 2px 4px;" title="${isLocked ? 'Unlock this line' : 'Lock this line'}">${isLocked ? '🔒' : '🔓'}</button>
                            <button class="active-drawing-edit-btn" onclick="openEditDrawingModal('line', '${l.id}')" style="background: none; border: none; cursor: pointer; font-size: 13px; color: #60a5fa; padding: 2px 4px;" title="Edit this line">✏️</button>
                            <button onclick="togglePriceLineVisibility('${l.id}')" style="background: none; border: none; cursor: pointer; font-size: 13px; color: ${isHidden ? '#787b86' : '#10b981'}; padding: 2px 4px;" title="${isHidden ? 'Show this line' : 'Hide this line'}">${isHidden ? '🙈' : '👁️'}</button>
                            <button class="active-drawing-delete-btn" onclick="deletePriceLineById('${l.id}')" title="Delete this line">🗑️</button>
                        </div>
                    </div>
                `;
            });

            shapes.forEach(s => {
                let name = 'Shape';
                let icon = '📐';
                if (s.type === 'trendline') { name = 'Trendline'; icon = '📈'; }
                else if (s.type === 'rectangle') { name = 'Rectangle'; icon = '⬛'; }
                else if (s.type === 'pricerange') { name = 'Price Range & %'; icon = '📏'; }
                else if (s.type === 'parallelchannel') { name = 'Parallel Channel'; icon = '⛓️'; }
                else if (s.type === 'fib') { name = 'Fib Retracement'; icon = '🌀'; }
                else if (s.type === 'fibext') { name = 'Trend Fib Extension'; icon = '🎯'; }
                else if (s.type === 'vertical') { name = 'Time Line'; icon = '🕒'; }
                else if (s.type === 'note') { name = `Note: ${s.text || ''}`; icon = '📍'; }

                const itemColor = s.color || '#3b82f6';
                const isHidden = !!s.hidden;
                const isLocked = !!s.locked;
                html += `
                    <div class="active-drawing-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: #1a1e29; border: 1px solid #2a2e39; border-radius: 6px; font-size: 12px; color: #d1d4dc; opacity: ${isHidden ? '0.6' : '1'};">
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
                            <div style="position: relative; display: flex; align-items: center; flex-shrink: 0;">
                                <span style="display: inline-block; width: 12px; height: 12px; border-radius: 3px; background: ${itemColor}; cursor: pointer;" title="Change shape color"></span>
                                <input type="color" value="${itemColor}" onchange="updateShapeColorById('${s.id}', this.value)" style="position: absolute; top: 0; left: 0; width: 12px; height: 12px; opacity: 0; cursor: pointer;">
                            </div>
                            <span style="font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; color: ${isHidden ? '#787b86' : '#e1e3e6'}; text-decoration: ${isHidden ? 'line-through' : 'none'};">${isLocked ? '<span style="color: #60a5fa; font-size: 11px; margin-right: 2px;" title="Locked">🔒</span>' : ''}${icon} ${escapeHtml(name)}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                            <button class="active-drawing-lock-btn" onclick="toggleShapeLock('${s.id}')" style="background: none; border: none; cursor: pointer; font-size: 13px; color: ${isLocked ? '#60a5fa' : '#787b86'}; padding: 2px 4px;" title="${isLocked ? 'Unlock this shape' : 'Lock this shape'}">${isLocked ? '🔒' : '🔓'}</button>
                            <button class="active-drawing-edit-btn" onclick="openEditDrawingModal('shape', '${s.id}')" style="background: none; border: none; cursor: pointer; font-size: 13px; color: #60a5fa; padding: 2px 4px;" title="Edit this shape">✏️</button>
                            <button onclick="toggleShapeVisibility('${s.id}')" style="background: none; border: none; cursor: pointer; font-size: 13px; color: ${isHidden ? '#787b86' : '#10b981'}; padding: 2px 4px;" title="${isHidden ? 'Show this shape' : 'Hide this shape'}">${isHidden ? '🙈' : '👁️'}</button>
                            <button class="active-drawing-delete-btn" onclick="deleteShapeById('${s.id}')" title="Delete this shape">🗑️</button>
                        </div>
                    </div>
                `;
            });

            mount.innerHTML = html;
        }

        // =========================================================
        // EDIT EXISTING DRAWINGS (Web & Mobile)
        // =========================================================
        let currentEditDrawingTarget = null; // { kind, id }

        function rgbToHex(rgbStr) {
            if (!rgbStr || rgbStr.startsWith('#')) return (rgbStr || '').toLowerCase();
            const match = rgbStr.match(/\d+/g);
            if (!match || match.length < 3) return rgbStr;
            return '#' + match.slice(0, 3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
        }

        function switchEditDrawingTab(tabName, event) {
            if (event && typeof event.stopPropagation === 'function') {
                event.stopPropagation();
            }
            const tabs = ['style', 'text', 'coordinates'];
            tabs.forEach(t => {
                const pane = document.getElementById('editDrawingTab' + t.charAt(0).toUpperCase() + t.slice(1));
                const btn = document.getElementById('editDrawingTabBtn' + t.charAt(0).toUpperCase() + t.slice(1));
                if (pane) {
                    pane.style.display = (t === tabName) ? 'block' : 'none';
                }
                if (btn) {
                    if (t === tabName) {
                        btn.style.background = '#3b82f6';
                        btn.style.color = '#ffffff';
                        btn.classList.add('active');
                    } else {
                        btn.style.background = 'transparent';
                        btn.style.color = 'var(--text-secondary, #94a3b8)';
                        btn.classList.remove('active');
                    }
                }
            });
            if (tabName === 'text') {
                setTimeout(() => {
                    const ti = document.getElementById('editDrawingTextInput');
                    if (ti) ti.focus();
                }, 50);
            }
        }
        window.switchEditDrawingTab = switchEditDrawingTab;

        function setEditDrawingTextPos(pos, event) {
            if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
            const input = document.getElementById('editDrawingTextPos');
            if (input) input.value = pos;
            setLastDrawingTextPos(pos);
            document.querySelectorAll('#editDrawingTextPosGroup .edit-text-pos-btn').forEach(btn => {
                const active = btn.dataset.pos === pos;
                btn.style.borderColor = active ? '#3b82f6' : 'var(--border-color, #363a45)';
                btn.style.background = active ? 'rgba(59, 130, 246, 0.2)' : 'var(--bg-input, #131722)';
                btn.style.color = active ? '#3b82f6' : 'var(--text-primary, #ffffff)';
                btn.classList.toggle('active', active);
            });
        }
        window.setEditDrawingTextPos = setEditDrawingTextPos;

        function setEditDrawingTextValign(valign, event) {
            if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
            const input = document.getElementById('editDrawingTextValign');
            if (input) input.value = valign;
            setLastDrawingTextValign(valign);
            document.querySelectorAll('#editDrawingTextValignGroup .edit-text-valign-btn').forEach(btn => {
                const active = btn.dataset.valign === valign;
                btn.style.borderColor = active ? '#3b82f6' : 'var(--border-color, #363a45)';
                btn.style.background = active ? 'rgba(59, 130, 246, 0.2)' : 'var(--bg-input, #131722)';
                btn.style.color = active ? '#3b82f6' : 'var(--text-primary, #ffffff)';
                btn.classList.toggle('active', active);
            });
        }
        window.setEditDrawingTextValign = setEditDrawingTextValign;

        function openEditDrawingModal(kind, id, initialTab = 'style') {
            const modal = document.getElementById('editDrawingModal');
            if (!modal) return;

            currentEditDrawingTarget = { kind, id };
            const kindInput = document.getElementById('editDrawingKind');
            const idInput = document.getElementById('editDrawingId');
            if (kindInput) kindInput.value = kind;
            if (idInput) idInput.value = id;

            const titleEl = document.getElementById('editDrawingTitle');
            const textInput = document.getElementById('editDrawingTextInput');
            const textColorInput = document.getElementById('editDrawingTextColor');
            const textColorLabel = document.getElementById('editDrawingTextColorLabel');
            const fontSizeSelect = document.getElementById('editDrawingFontSize');
            const price1Group = document.getElementById('editDrawingPrice1Group');
            const price1Title = document.getElementById('editDrawingPrice1Title');
            const price1Input = document.getElementById('editDrawingPrice1');
            const price2Group = document.getElementById('editDrawingPrice2Group');
            const price2Title = document.getElementById('editDrawingPrice2Title');
            const price2Input = document.getElementById('editDrawingPrice2');

            let currentColor = '#10b981';
            let currentText = '';
            let currentTextColor = getLastDrawingTextColor();
            let currentFontSize = getLastDrawingFontSize();
            let currentTextPos = getLastDrawingTextPos();
            let currentTextValign = getLastDrawingTextValign();

            if (kind === 'line') {
                const lines = getSavedPriceLines(currentChartSymbol);
                const line = lines.find(l => l.id === id);
                if (!line) {
                    showToast('Drawing line not found', 'warning');
                    return;
                }
                const labelText = line.label || (line.type === 'target' ? 'Target' : line.type === 'stoploss' ? 'Stop Loss' : line.type === 'resistance' ? 'Resistance' : 'Support');
                if (titleEl) titleEl.innerHTML = `<span>✏️</span> <span>Edit ${escapeHtml(labelText)} Line</span>`;

                if (price1Group) price1Group.style.display = 'block';
                if (price1Title) price1Title.innerText = 'Price Level (₹)';
                if (price1Input) price1Input.value = line.price !== undefined ? line.price : '';

                if (price2Group) price2Group.style.display = 'none';

                currentColor = line.color || (line.type === 'resistance' ? '#788325' : (line.type === 'target' ? '#0b845c' : (line.type === 'support' ? '#731717' : (line.type === 'stoploss' ? '#ef5350' : '#731717'))));
                currentText = line.text || '';
                const hasCustomText = !!(line.text && line.text.trim());
                currentTextColor = (hasCustomText && line.textColor) ? line.textColor : getLastDrawingTextColor();
                currentFontSize = (hasCustomText && line.fontSize) ? line.fontSize : getLastDrawingFontSize();
                currentTextPos = (hasCustomText && line.textPos) ? line.textPos : getLastDrawingTextPos();
                currentTextValign = (hasCustomText && line.textValign) ? line.textValign : getLastDrawingTextValign();

                const currentWidth = line.lineWidth ? parseInt(line.lineWidth) : 2;
                const currentStyle = line.lineStyle || 'dashed';
                setEditDrawingLineWidth(currentWidth);
                const styleSelect = document.getElementById('editDrawingLineStyle');
                if (styleSelect) styleSelect.value = currentStyle;
                const propsGroup = document.getElementById('editDrawingLinePropsGroup');
                if (propsGroup) propsGroup.style.display = 'block';

                const lockInput = document.getElementById('editDrawingLocked');
                if (lockInput) lockInput.checked = !!line.locked;
            } else if (kind === 'shape') {
                const shapes = getSavedChartShapes(currentChartSymbol);
                const shape = shapes.find(s => s.id === id);
                if (!shape) {
                    showToast('Drawing shape not found', 'warning');
                    return;
                }
                const typeInput = document.getElementById('editDrawingType');
                if (typeInput) typeInput.value = shape.type;
                currentColor = shape.color || (shape.type === 'trendline' ? getLastTrendlineColor() : '#3b82f6');
                currentText = shape.text || '';
                const hasShapeCustomText = !!(shape.text && shape.text.trim());
                currentTextColor = (hasShapeCustomText && shape.textColor) ? shape.textColor : getLastDrawingTextColor();
                currentFontSize = (hasShapeCustomText && shape.fontSize) ? shape.fontSize : getLastDrawingFontSize();
                currentTextPos = (hasShapeCustomText && shape.textPos) ? shape.textPos : getLastDrawingTextPos();
                currentTextValign = (hasShapeCustomText && shape.textValign) ? shape.textValign : getLastDrawingTextValign();

                const propsGroup = document.getElementById('editDrawingLinePropsGroup');
                if (shape.type === 'note') {
                    if (propsGroup) propsGroup.style.display = 'none';
                } else {
                    if (propsGroup) propsGroup.style.display = 'block';
                    const currentWidth = shape.lineWidth ? parseInt(shape.lineWidth) : (shape.type === 'rectangle' ? 1 : 2);
                    const currentStyle = shape.lineStyle || (shape.type === 'vertical' ? 'dashed' : 'solid');
                    setEditDrawingLineWidth(currentWidth);
                    const styleSelect = document.getElementById('editDrawingLineStyle');
                    if (styleSelect) styleSelect.value = currentStyle;
                }

                const lockInput = document.getElementById('editDrawingLocked');
                if (lockInput) lockInput.checked = !!shape.locked;

                if (shape.type === 'note') {
                    if (titleEl) titleEl.innerHTML = `<span>✏️</span> <span>Edit Note Callout</span>`;
                    if (price1Group) price1Group.style.display = 'block';
                    if (price1Title) price1Title.innerText = 'Price Level (₹)';
                    if (price1Input) price1Input.value = shape.price !== undefined ? shape.price : '';
                    if (price2Group) price2Group.style.display = 'none';
                } else if (shape.type === 'trendline') {
                    if (titleEl) titleEl.innerHTML = `<span>✏️</span> <span>Edit Trendline</span>`;
                    if (price1Group) price1Group.style.display = 'block';
                    if (price1Title) price1Title.innerText = 'Start Price (₹)';
                    if (price1Input) price1Input.value = shape.price1 !== undefined ? shape.price1 : '';
                    if (price2Group) price2Group.style.display = 'block';
                    if (price2Title) price2Title.innerText = 'End Price (₹)';
                    if (price2Input) price2Input.value = shape.price2 !== undefined ? shape.price2 : '';
                } else if (shape.type === 'rectangle') {
                    if (titleEl) titleEl.innerHTML = `<span>✏️</span> <span>Edit Rectangle Zone</span>`;
                    if (price1Group) price1Group.style.display = 'block';
                    if (price1Title) price1Title.innerText = 'Top / Start Price (₹)';
                    if (price1Input) price1Input.value = shape.price1 !== undefined ? shape.price1 : '';
                    if (price2Group) price2Group.style.display = 'block';
                    if (price2Title) price2Title.innerText = 'Bottom / End Price (₹)';
                    if (price2Input) price2Input.value = shape.price2 !== undefined ? shape.price2 : '';
                } else if (shape.type === 'pricerange') {
                    if (titleEl) titleEl.innerHTML = `<span>✏️</span> <span>Edit Price Range Calculator</span>`;
                    if (price1Group) price1Group.style.display = 'block';
                    if (price1Title) price1Title.innerText = 'Base Price (₹)';
                    if (price1Input) price1Input.value = shape.price1 !== undefined ? shape.price1 : '';
                    if (price2Group) price2Group.style.display = 'block';
                    if (price2Title) price2Title.innerText = 'Target Price (₹)';
                    if (price2Input) price2Input.value = shape.price2 !== undefined ? shape.price2 : '';
                } else if (shape.type === 'parallelchannel') {
                    if (titleEl) titleEl.innerHTML = `<span>✏️</span> <span>Edit Parallel Channel</span>`;
                    if (price1Group) price1Group.style.display = 'block';
                    if (price1Title) price1Title.innerText = 'Baseline Start Price (₹)';
                    if (price1Input) price1Input.value = shape.price1 !== undefined ? shape.price1 : '';
                    if (price2Group) price2Group.style.display = 'block';
                    if (price2Title) price2Title.innerText = 'Baseline End Price (₹)';
                    if (price2Input) price2Input.value = shape.price2 !== undefined ? shape.price2 : '';
                } else if (shape.type === 'fib') {
                    if (titleEl) titleEl.innerHTML = `<span>✏️</span> <span>Edit Fib Retracement</span>`;
                    if (price1Group) price1Group.style.display = 'block';
                    if (price1Title) price1Title.innerText = 'Swing Start Price (₹)';
                    if (price1Input) price1Input.value = shape.price1 !== undefined ? shape.price1 : '';
                    if (price2Group) price2Group.style.display = 'block';
                    if (price2Title) price2Title.innerText = 'Swing End Price (₹)';
                    if (price2Input) price2Input.value = shape.price2 !== undefined ? shape.price2 : '';
                } else if (shape.type === 'fibext') {
                    if (titleEl) titleEl.innerHTML = `<span>✏️</span> <span>Edit Trend-Based Fib Extension</span>`;
                    if (price1Group) price1Group.style.display = 'block';
                    if (price1Title) price1Title.innerText = 'Wave 1 Start Price (₹)';
                    if (price1Input) price1Input.value = shape.price1 !== undefined ? shape.price1 : '';
                    if (price2Group) price2Group.style.display = 'block';
                    if (price2Title) price2Title.innerText = 'Wave 1 End Price (₹)';
                    if (price2Input) price2Input.value = shape.price2 !== undefined ? shape.price2 : '';
                } else if (shape.type === 'vertical') {
                    if (titleEl) titleEl.innerHTML = `<span>✏️</span> <span>Edit Time Line Marker</span>`;
                    if (price1Group) price1Group.style.display = 'none';
                    if (price2Group) price2Group.style.display = 'none';
                }
            }

            // Populate Text tab values
            if (textInput) textInput.value = currentText;
            if (textColorInput) textColorInput.value = currentTextColor;
            if (textColorLabel) textColorLabel.innerText = currentTextColor;
            if (fontSizeSelect) fontSizeSelect.value = String(currentFontSize);
            setEditDrawingTextPos(currentTextPos);
            setEditDrawingTextValign(currentTextValign);

            setEditDrawingColor(currentColor);
            switchEditDrawingTab(initialTab || 'style');

            // Programmatically bind tab switching listeners for bulletproof responsiveness
            ['style', 'text', 'coordinates'].forEach(t => {
                const btn = document.getElementById('editDrawingTabBtn' + t.charAt(0).toUpperCase() + t.slice(1));
                if (btn && !btn._hasEditTabBound) {
                    btn._hasEditTabBound = true;
                    const activate = (evt) => {
                        if (evt && typeof evt.stopPropagation === 'function') evt.stopPropagation();
                        switchEditDrawingTab(t, evt);
                    };
                    btn.addEventListener('pointerdown', activate);
                    btn.addEventListener('click', activate);
                }
            });

            modal.style.display = 'flex';
            if (typeof window.bringModalToFront === 'function') {
                window.bringModalToFront(modal);
            }

            if (initialTab === 'text') {
                setTimeout(() => {
                    const ti = document.getElementById('editDrawingTextInput');
                    if (ti) ti.focus();
                }, 80);
            }
        }

        function closeEditDrawingModal() {
            const modal = document.getElementById('editDrawingModal');
            if (modal) {
                modal.style.display = 'none';
                if (window.ModalHistoryManager) {
                    window.ModalHistoryManager.onModalClosed(modal);
                }
            }
            currentEditDrawingTarget = null;
        }

        function setEditDrawingLineWidth(width) {
            const input = document.getElementById('editDrawingLineWidth');
            if (input) input.value = width;
            const btns = document.querySelectorAll('#editDrawingWidthOptions .edit-width-btn');
            btns.forEach(b => {
                const w = parseInt(b.dataset.width);
                if (w === width) {
                    b.style.borderColor = '#3b82f6';
                    b.style.background = 'rgba(59, 130, 246, 0.2)';
                    b.style.color = '#3b82f6';
                } else {
                    b.style.borderColor = 'var(--border-color, #363a45)';
                    b.style.background = 'var(--bg-input, #131722)';
                    b.style.color = 'var(--text-primary, #ffffff)';
                }
            });
        }
        window.setEditDrawingLineWidth = setEditDrawingLineWidth;

        function setEditDrawingColor(color) {
            const picker = document.getElementById('editDrawingColorPicker');
            if (picker) picker.value = color;

            const hexNorm = rgbToHex(color);
            const dots = document.querySelectorAll('#editDrawingColorGroup .edit-color-dot');
            dots.forEach(d => {
                const dotBg = rgbToHex(d.style.backgroundColor);
                if (dotBg === hexNorm) {
                    d.style.outline = '2px solid #ffffff';
                    d.style.outlineOffset = '2px';
                    d.style.transform = 'scale(1.15)';
                } else {
                    d.style.outline = 'none';
                    d.style.transform = 'scale(1.0)';
                }
            });
        }

        function submitSaveEditDrawing() {
            if (!currentEditDrawingTarget) return;
            const { kind, id } = currentEditDrawingTarget;
            const colorPicker = document.getElementById('editDrawingColorPicker');
            const chosenColor = colorPicker ? colorPicker.value : '#10b981';
            const widthInput = document.getElementById('editDrawingLineWidth');
            const styleInput = document.getElementById('editDrawingLineStyle');
            const lockInput = document.getElementById('editDrawingLocked');
            const chosenWidth = widthInput ? (parseInt(widthInput.value) || 2) : 2;
            const chosenStyle = styleInput ? (styleInput.value || 'solid') : 'solid';
            const chosenLocked = lockInput ? !!lockInput.checked : false;

            const textInput = document.getElementById('editDrawingTextInput');
            const textColorInput = document.getElementById('editDrawingTextColor');
            const fontSizeSelect = document.getElementById('editDrawingFontSize');
            const textPosInput = document.getElementById('editDrawingTextPos');
            const textValignInput = document.getElementById('editDrawingTextValign');

            const chosenText = textInput ? textInput.value.trim() : '';
            const chosenTextColor = textColorInput ? textColorInput.value : chosenColor;
            const chosenFontSize = fontSizeSelect ? (parseInt(fontSizeSelect.value) || 12) : 12;
            const chosenTextPos = textPosInput ? (textPosInput.value || 'center') : 'center';
            const chosenTextValign = textValignInput ? (textValignInput.value || 'top') : 'top';

            setLastDrawingTextColor(chosenTextColor);
            setLastDrawingFontSize(chosenFontSize);
            setLastDrawingTextPos(chosenTextPos);
            setLastDrawingTextValign(chosenTextValign);

            if (kind === 'line') {
                const priceInput = document.getElementById('editDrawingPrice1');
                const newPrice = priceInput ? parseFloat(priceInput.value) : NaN;

                if (isNaN(newPrice)) {
                    showToast('Please enter a valid numeric price.', 'warning');
                    return;
                }

                const lines = getSavedPriceLines(currentChartSymbol);
                const line = lines.find(l => l.id === id);
                if (line) {
                    line.price = newPrice;
                    line.color = chosenColor;
                    line.lineWidth = chosenWidth;
                    line.lineStyle = chosenStyle;
                    line.locked = chosenLocked;
                    line.text = chosenText;
                    line.textColor = chosenTextColor;
                    line.fontSize = chosenFontSize;
                    line.textPos = chosenTextPos;
                    line.textValign = chosenTextValign;
                    persistLinesForSymbol(currentChartSymbol, lines);
                    restoreSavedPriceLines(currentChartSymbol);
                    redrawCanvasOverlay();
                    renderActiveDrawingsList();
                    const popup = document.getElementById('canvasObjectPopup');
                    if (popup && popup.dataset.activeObjId === String(id)) {
                        updateCanvasObjectPopupLockState(chosenLocked);
                    }
                    showToast('Price line updated successfully', 'success');
                }
            } else if (kind === 'shape') {
                const shapes = getSavedChartShapes(currentChartSymbol);
                const shape = shapes.find(s => s.id === id);
                if (shape) {
                    shape.color = chosenColor;
                    if (shape.type === 'trendline') {
                        setLastTrendlineColor(chosenColor);
                    }
                    shape.locked = chosenLocked;
                    shape.text = chosenText;
                    shape.textColor = chosenTextColor;
                    shape.fontSize = chosenFontSize;
                    shape.textPos = chosenTextPos;
                    shape.textValign = chosenTextValign;
                    if (shape.type === 'note') {
                        const priceInput = document.getElementById('editDrawingPrice1');
                        if (priceInput && !isNaN(parseFloat(priceInput.value))) {
                            shape.price = parseFloat(priceInput.value);
                        }
                    } else if (shape.type === 'trendline' || shape.type === 'rectangle' || shape.type === 'pricerange' || shape.type === 'parallelchannel' || shape.type === 'fib' || shape.type === 'fibext') {
                        const p1Input = document.getElementById('editDrawingPrice1');
                        const p2Input = document.getElementById('editDrawingPrice2');
                        if (p1Input && !isNaN(parseFloat(p1Input.value))) {
                            shape.price1 = parseFloat(p1Input.value);
                        }
                        if (p2Input && !isNaN(parseFloat(p2Input.value))) {
                            shape.price2 = parseFloat(p2Input.value);
                        }
                        if (shape.type === 'rectangle' || shape.type === 'parallelchannel') {
                            shape.fillColor = hexToRgba(chosenColor, shape.type === 'rectangle' ? 0.18 : 0.12);
                        }
                    }
                    if (shape.type !== 'note') {
                        shape.lineWidth = chosenWidth;
                        shape.lineStyle = chosenStyle;
                    }
                    persistShapesForSymbol(currentChartSymbol, shapes);
                    redrawCanvasOverlay();
                    renderActiveDrawingsList();
                    const popup = document.getElementById('canvasObjectPopup');
                    if (popup && popup.dataset.activeObjId === String(id)) {
                        updateCanvasObjectPopupLockState(chosenLocked);
                    }
                    showToast('Drawing shape updated successfully', 'success');
                }
            }

            closeEditDrawingModal();
        }

        function deleteCurrentEditDrawing() {
            if (!currentEditDrawingTarget) return;
            const { kind, id } = currentEditDrawingTarget;

            if (kind === 'line') {
                const lines = getSavedPriceLines(currentChartSymbol);
                const l = lines.find(x => x.id === id);
                if (l && l.locked) {
                    showToast('This drawing is locked. Please unlock it to delete.', 'warning');
                    return;
                }
                closeEditDrawingModal();
                deletePriceLineById(id);
                showToast('Price line deleted', 'info');
            } else if (kind === 'shape') {
                const shapes = getSavedChartShapes(currentChartSymbol);
                const s = shapes.find(x => x.id === id);
                if (s && s.locked) {
                    showToast('This drawing is locked. Please unlock it to delete.', 'warning');
                    return;
                }
                closeEditDrawingModal();
                deleteShapeById(id);
                showToast('Drawing shape deleted', 'info');
            }
        }

        window.openEditDrawingModal = openEditDrawingModal;
        window.closeEditDrawingModal = closeEditDrawingModal;
        window.setEditDrawingColor = setEditDrawingColor;
        window.setEditDrawingLineWidth = setEditDrawingLineWidth;
        window.switchEditDrawingTab = switchEditDrawingTab;
        window.setEditDrawingTextPos = setEditDrawingTextPos;
        window.setEditDrawingTextValign = setEditDrawingTextValign;
        window.submitSaveEditDrawing = submitSaveEditDrawing;
        window.deleteCurrentEditDrawing = deleteCurrentEditDrawing;


        async function addHorizontalLinePrompt(type) {
            if (!mainSeries || !latestCandlePrice) {
                showToast('Please wait for chart data to load.', 'warning');
                return;
            }

            let defaultPrice = latestCandlePrice;
            let label = 'Support';
            let color = '#731717';

            if (type === 'target') {
                defaultPrice = parseFloat((latestCandlePrice * 1.05).toFixed(2));
                label = 'Target';
                color = '#0b845c';
            } else if (type === 'stoploss') {
                defaultPrice = parseFloat((latestCandlePrice * 0.95).toFixed(2));
                label = 'Stop Loss';
                color = '#ef5350';
            } else if (type === 'resistance') {
                defaultPrice = parseFloat((latestCandlePrice * 1.03).toFixed(2));
                label = 'Resistance';
                color = '#788325';
            } else if (type === 'support') {
                label = 'Support';
                color = '#731717';
            }

            const inputVal = await showCustomPrompt({ title: `Add ${label} Line`, message: `Enter custom price for ${label}:`, defaultValue: defaultPrice, placeholder: 'e.g. 2450.00' });
            if (!inputVal) return;

            const price = parseFloat(inputVal);
            if (isNaN(price)) {
                showToast('Invalid price value entered.', 'error');
                return;
            }

            addHorizontalLineAtPrice(type, price, color, label);
        }

        function addHorizontalLineAtPrice(type, price, color, customLabel = null) {
            if (!mainSeries) return;
            const label = customLabel || (type === 'target' ? 'Target' : type === 'stoploss' ? 'Stop Loss' : type === 'resistance' ? 'Resistance' : 'Support');
            const lineId = 'pl_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
            const lw = activeToolLineWidth ? parseInt(activeToolLineWidth) : 2;
            let ls = LightweightCharts.LineStyle.Dashed;
            if (activeToolLineStyle === 'solid') ls = LightweightCharts.LineStyle.Solid;
            else if (activeToolLineStyle === 'dotted') ls = LightweightCharts.LineStyle.Dotted;
            else if (activeToolLineStyle === 'dashed') ls = LightweightCharts.LineStyle.Dashed;

            const defaultColor = type === 'resistance' ? '#788325' : (type === 'target' ? '#0b845c' : (type === 'support' ? '#731717' : (type === 'stoploss' ? '#ef5350' : '#731717')));
            const lineColor = color || defaultColor;

            const lineData = {
                id: lineId,
                type: type,
                price: price,
                color: lineColor,
                label: label,
                lineWidth: lw,
                lineStyle: activeToolLineStyle || 'dashed',
                fontSize: getLastDrawingFontSize(),
                textColor: getLastDrawingTextColor(),
                textPos: getLastDrawingTextPos(),
                textValign: getLastDrawingTextValign()
            };

            const priceLine = mainSeries.createPriceLine({
                price: price,
                color: lineColor,
                lineWidth: lw,
                lineStyle: ls,
                axisLabelVisible: true,
                title: '' // Label badge rendered on left side of drawing via canvas overlay
            });

            activePriceLines.push({ id: lineId, lineObj: priceLine, data: lineData });
            savePriceLineForSymbol(currentChartSymbol, lineData);
        }

        function clearDrawings() {
            clearTempMeasure();
            const lines = getSavedPriceLines(currentChartSymbol);
            const shapes = getSavedChartShapes(currentChartSymbol);
            const hasLocked = lines.some(l => l.locked) || shapes.some(s => s.locked);

            if (hasLocked) {
                // Remove unlocked lines from series
                if (mainSeries && activePriceLines.length > 0) {
                    activePriceLines.forEach(item => {
                        const l = lines.find(x => x.id === item.id);
                        if (!l || !l.locked) {
                            try { mainSeries.removePriceLine(item.lineObj); } catch(e){}
                        }
                    });
                    activePriceLines = activePriceLines.filter(item => {
                        const l = lines.find(x => x.id === item.id);
                        return l && l.locked;
                    });
                }
                const remainingLines = lines.filter(l => l.locked);
                const remainingShapes = shapes.filter(s => s.locked);
                persistLinesForSymbol(currentChartSymbol, remainingLines);
                persistShapesForSymbol(currentChartSymbol, remainingShapes);
                restoreSavedPriceLines(currentChartSymbol);
                cancelDrawingTool();
                hideCanvasObjectMenu();
                redrawCanvasOverlay();
                renderActiveDrawingsList();
                showToast('Unlocked drawings cleared. Locked drawings kept safe.', 'info');
                return;
            }

            if (mainSeries && activePriceLines.length > 0) {
                activePriceLines.forEach(item => {
                    try { mainSeries.removePriceLine(item.lineObj); } catch(e){}
                });
                activePriceLines = [];
            }
            clearSavedPriceLines(currentChartSymbol);
            clearSavedChartShapes(currentChartSymbol);
            cancelDrawingTool();
            hideCanvasObjectMenu();
            redrawCanvasOverlay();
            renderActiveDrawingsList();
        }

        // =========================================================
        // FAVORITE DRAWING TOOLS SHORTCUTS (Mobile & Web)
        // =========================================================
        const CHART_TOOL_META = {
            'trendline': {
                id: 'trendline',
                icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="3" y1="13" x2="13" y2="3"/><circle cx="3" cy="13" r="1.5" fill="currentColor"/><circle cx="13" cy="3" r="1.5" fill="currentColor"/></svg>',
                title: 'Diagonal Trendline',
                action: () => activateDrawingTool('trendline')
            },
            'support_click': {
                id: 'support_click',
                icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#731717" stroke-width="1.8" stroke-linecap="round"><line x1="1" y1="8" x2="15" y2="8"/><circle cx="8" cy="8" r="1.8" fill="#731717"/></svg>',
                title: 'Support Line (Click)',
                action: () => activateDrawingTool('support_click')
            },
            'resistance_click': {
                id: 'resistance_click',
                icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#788325" stroke-width="1.8" stroke-linecap="round"><line x1="1" y1="8" x2="15" y2="8"/><circle cx="8" cy="8" r="1.8" fill="#788325"/></svg>',
                title: 'Resistance Line (Click)',
                action: () => activateDrawingTool('resistance_click')
            },
            'support': {
                id: 'support',
                icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#731717" stroke-width="1.8" stroke-linecap="round"><line x1="1" y1="8" x2="15" y2="8"/><circle cx="4" cy="8" r="1.5" fill="#731717"/></svg>',
                title: 'Support Line (Price)',
                action: () => addHorizontalLinePrompt('support')
            },
            'resistance': {
                id: 'resistance',
                icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#788325" stroke-width="1.8" stroke-linecap="round"><line x1="1" y1="8" x2="15" y2="8"/><circle cx="4" cy="8" r="1.5" fill="#788325"/></svg>',
                title: 'Resistance Line (Price)',
                action: () => addHorizontalLinePrompt('resistance')
            },
            'target': {
                id: 'target',
                icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#0b845c" stroke-width="1.8" stroke-linecap="round"><line x1="1" y1="5" x2="15" y2="5"/><path d="M8 5 L8 12 M5 9 L8 12 L11 9"/></svg>',
                title: 'Target Price Line',
                action: () => addHorizontalLinePrompt('target')
            },
            'stoploss': {
                id: 'stoploss',
                icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#ef5350" stroke-width="1.8" stroke-linecap="round"><line x1="1" y1="11" x2="15" y2="11"/><path d="M8 11 L8 4 M5 7 L8 4 L11 7"/></svg>',
                title: 'StopLoss Line',
                action: () => addHorizontalLinePrompt('stoploss')
            },
            'rectangle': {
                id: 'rectangle',
                icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="3.5" width="11" height="9" rx="1"/><circle cx="2.5" cy="3.5" r="1" fill="currentColor"/><circle cx="13.5" cy="3.5" r="1" fill="currentColor"/><circle cx="2.5" cy="12.5" r="1" fill="currentColor"/><circle cx="13.5" cy="12.5" r="1" fill="currentColor"/></svg>',
                title: 'Rectangle Zone',
                action: () => activateDrawingTool('rectangle')
            },
            'pricerange': {
                id: 'pricerange',
                icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="3" y1="2.5" x2="13" y2="2.5"/><line x1="3" y1="13.5" x2="13" y2="13.5"/><line x1="8" y1="2.5" x2="8" y2="13.5"/><polyline points="5.5,5 8,2.5 10.5,5"/><polyline points="5.5,11 8,13.5 10.5,11"/></svg>',
                title: 'Price Range %',
                action: () => activateDrawingTool('pricerange')
            },
            'parallelchannel': {
                id: 'parallelchannel',
                icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="2" y1="12" x2="14" y2="6"/><line x1="2" y1="7" x2="14" y2="1"/><line x1="2" y1="9.5" x2="14" y2="3.5" stroke-dasharray="2 2" stroke-width="1.2"/></svg>',
                title: 'Parallel Channel',
                action: () => activateDrawingTool('parallelchannel')
            },
            'measure': {
                id: 'measure',
                icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="2" y="3" width="12" height="10" rx="1.5"/><line x1="5" y1="3" x2="5" y2="6"/><line x1="8" y1="3" x2="8" y2="8"/><line x1="11" y1="3" x2="11" y2="6"/></svg>',
                title: 'Measure (Temp Scale)',
                action: () => activateDrawingTool('measure')
            },
            'fib': {
                id: 'fib',
                icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="2" y1="2" x2="14" y2="2"/><line x1="2" y1="6" x2="14" y2="6"/><line x1="2" y1="10" x2="14" y2="10"/><line x1="2" y1="14" x2="14" y2="14"/><line x1="2" y1="14" x2="14" y2="2" stroke-dasharray="2 2" stroke-width="1"/></svg>',
                title: 'Fib Retracement',
                action: () => activateDrawingTool('fib')
            },
            'fibext': {
                id: 'fibext',
                icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><polyline points="2,13 6,5 9,10"/><line x1="9" y1="3" x2="15" y2="3"/><line x1="9" y1="6" x2="15" y2="6"/><line x1="9" y1="10" x2="15" y2="10"/><circle cx="2" cy="13" r="1.2" fill="currentColor"/><circle cx="6" cy="5" r="1.2" fill="currentColor"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/></svg>',
                title: 'Trend-Based Fib Extension',
                action: () => activateDrawingTool('fibext')
            },
            'vertical': {
                id: 'vertical',
                icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="8" y1="1.5" x2="8" y2="14.5"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/></svg>',
                title: 'Time Line Marker',
                action: () => activateDrawingTool('vertical')
            },
            'note': {
                id: 'note',
                icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="3" y1="3" x2="13" y2="3"/><line x1="8" y1="3" x2="8" y2="13.5"/></svg>',
                title: 'Text Note / Callout',
                action: () => activateDrawingTool('note')
            }
        };

        function getFavoriteTools() {
            try {
                const saved = localStorage.getItem('capital_desk_favorite_tools');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    if (Array.isArray(parsed)) return parsed;
                }
            } catch(e) {}
            return ['trendline', 'support', 'target', 'rectangle', 'pricerange'];
        }

        function setFavoriteTools(toolsList) {
            try {
                localStorage.setItem('capital_desk_favorite_tools', JSON.stringify(toolsList));
            } catch(e) {}
            renderFavoriteToolsShortcuts();
            updatePopoverToolStars();

            fetch('/api/user/favorite_tools', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ favorite_tools: toolsList })
            }).catch(e => console.warn('Could not save favorite tools:', e));
        }

        function toggleFavoriteTool(toolId, event) {
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }
            let favs = getFavoriteTools().slice();
            const idx = favs.indexOf(toolId);
            if (idx >= 0) {
                favs.splice(idx, 1);
            } else {
                favs.push(toolId);
            }
            setFavoriteTools(favs);
        }

        function executeToolById(toolId) {
            const meta = CHART_TOOL_META[toolId];
            if (meta && typeof meta.action === 'function') {
                meta.action();
            }
        }

        function updatePopoverToolStars() {
            const favs = getFavoriteTools();
            Object.keys(CHART_TOOL_META).forEach(id => {
                const btn = document.getElementById(`tool-btn-${id}`);
                if (!btn) return;
                const star = btn.querySelector('.tool-fav-star');
                if (!star) return;
                const isFav = favs.includes(id);
                star.innerHTML = isFav ? '★' : '☆';
                star.classList.toggle('active', isFav);
                star.title = isFav ? 'Remove from favorites' : 'Add to favorites';
            });
        }

        function renderFavoriteToolsShortcuts() {
            const favs = getFavoriteTools();
            const webBar = document.getElementById('chartWebFavBar');
            const mobileBar = document.getElementById('chartMobileFavBar');
            const mobileIcons = document.getElementById('mobileFavBarIcons');
            const isMobile = window.innerWidth <= 768 || (window.innerHeight <= 520 && window.innerWidth <= 1024);

            // Render Web Toolbar (Image 2 - at end of legend row)
            if (webBar) {
                if (isMobile) {
                    webBar.innerHTML = '';
                    webBar.style.display = 'none';
                } else {
                    webBar.style.display = 'flex';
                    webBar.innerHTML = '';
                    favs.forEach(id => {
                        const meta = CHART_TOOL_META[id];
                        if (!meta) return;
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = `chart-web-fav-btn ${currentDrawingTool === id ? 'active' : ''}`;
                        btn.setAttribute('data-tool-id', id);
                        btn.title = meta.title;
                        btn.innerHTML = meta.icon;
                        btn.onclick = (e) => {
                            e.stopPropagation();
                            executeToolById(id);
                        };
                        webBar.appendChild(btn);
                    });
                }
            }

            // Render Mobile Floating Toolbar (Image 1)
            if (mobileBar && mobileIcons) {
                mobileIcons.innerHTML = '';
                if (!isMobile || favs.length === 0) {
                    mobileBar.style.display = 'none';
                } else {
                    mobileBar.style.display = 'flex';
                    favs.forEach(id => {
                        const meta = CHART_TOOL_META[id];
                        if (!meta) return;
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = `chart-mobile-fav-btn ${currentDrawingTool === id ? 'active' : ''}`;
                        btn.setAttribute('data-tool-id', id);
                        btn.title = meta.title;
                        btn.innerHTML = meta.icon;
                        btn.onclick = (e) => {
                            e.stopPropagation();
                            executeToolById(id);
                        };
                        mobileIcons.appendChild(btn);
                    });
                    initMobileFavBarDrag();
                }
            }

            updatePopoverToolStars();
        }

        function initMobileFavBarDrag() {
            const bar = document.getElementById('chartMobileFavBar');
            if (!bar) return;

            // Restore persisted position
            try {
                const savedPos = localStorage.getItem('capital_desk_chart_fav_pos');
                if (savedPos) {
                    const pos = JSON.parse(savedPos);
                    if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
                        bar.style.setProperty('right', 'auto');
                        bar.style.setProperty('left', pos.left + 'px');
                        bar.style.setProperty('top', pos.top + 'px');
                    }
                }
            } catch(e) {}

            if (bar._dragInitialized) return;
            bar._dragInitialized = true;

            const handle = bar.querySelector('.fav-bar-handle') || bar;
            let isDragging = false;
            let startClientX = 0, startClientY = 0;
            let initialLeft = 0, initialTop = 0;

            const onDragStart = (e) => {
                // If clicked directly on an action tool button, let the tool execute without dragging
                if (e.target && e.target.closest && e.target.closest('.chart-mobile-fav-btn')) {
                    return;
                }
                e.stopPropagation();
                if (e.cancelable) e.preventDefault();

                isDragging = true;
                bar.classList.add('is-dragging');

                const rect = bar.getBoundingClientRect();
                const parent = bar.parentElement || document.body;
                const parentRect = parent.getBoundingClientRect();

                initialLeft = rect.left - parentRect.left;
                initialTop = rect.top - parentRect.top;

                const pt = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
                startClientX = pt.clientX;
                startClientY = pt.clientY;

                bar.style.setProperty('right', 'auto');
                bar.style.setProperty('left', initialLeft + 'px');
                bar.style.setProperty('top', initialTop + 'px');

                if (e.pointerId && typeof bar.setPointerCapture === 'function') {
                    try { bar.setPointerCapture(e.pointerId); } catch(err) {}
                }

                window.addEventListener('pointermove', onDragMove, { passive: false });
                window.addEventListener('pointerup', onDragEnd);
                window.addEventListener('touchmove', onDragMove, { passive: false });
                window.addEventListener('touchend', onDragEnd);
                window.addEventListener('pointercancel', onDragEnd);
            };

            const onDragMove = (e) => {
                if (!isDragging) return;
                e.stopPropagation();
                if (e.cancelable) e.preventDefault();

                const pt = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
                const dx = pt.clientX - startClientX;
                const dy = pt.clientY - startClientY;

                const parent = bar.parentElement || document.body;
                const parentRect = parent.getBoundingClientRect();

                const maxLeft = Math.max(0, parentRect.width - bar.offsetWidth - 4);
                const maxTop = Math.max(0, parentRect.height - bar.offsetHeight - 4);

                const newLeft = Math.max(4, Math.min(maxLeft, initialLeft + dx));
                const newTop = Math.max(4, Math.min(maxTop, initialTop + dy));

                bar.style.setProperty('left', newLeft + 'px');
                bar.style.setProperty('top', newTop + 'px');
            };

            const onDragEnd = (e) => {
                if (!isDragging) return;
                isDragging = false;
                bar.classList.remove('is-dragging');

                if (e && e.pointerId && typeof bar.releasePointerCapture === 'function') {
                    try { bar.releasePointerCapture(e.pointerId); } catch(err) {}
                }

                window.removeEventListener('pointermove', onDragMove);
                window.removeEventListener('pointerup', onDragEnd);
                window.removeEventListener('touchmove', onDragMove);
                window.removeEventListener('touchend', onDragEnd);
                window.removeEventListener('pointercancel', onDragEnd);

                // Persist new position in localStorage
                try {
                    const curLeft = parseFloat(bar.style.left);
                    const curTop = parseFloat(bar.style.top);
                    if (!isNaN(curLeft) && !isNaN(curTop)) {
                        localStorage.setItem('capital_desk_chart_fav_pos', JSON.stringify({ left: curLeft, top: curTop }));
                    }
                } catch(e) {}
            };

            handle.addEventListener('pointerdown', onDragStart);
            handle.addEventListener('touchstart', onDragStart, { passive: false });
            bar.addEventListener('pointerdown', onDragStart);
            bar.addEventListener('touchstart', onDragStart, { passive: false });

            window.addEventListener('resize', () => {
                const parent = bar.parentElement || document.body;
                const parentRect = parent.getBoundingClientRect();
                const curLeft = parseFloat(bar.style.left);
                const curTop = parseFloat(bar.style.top);
                if (!isNaN(curLeft) && !isNaN(curTop)) {
                    const maxLeft = Math.max(0, parentRect.width - bar.offsetWidth - 4);
                    const maxTop = Math.max(0, parentRect.height - bar.offsetHeight - 4);
                    if (curLeft > maxLeft) bar.style.setProperty('left', Math.max(4, maxLeft) + 'px');
                    if (curTop > maxTop) bar.style.setProperty('top', Math.max(4, maxTop) + 'px');
                }
            });
        }

        // =========================================================
        // ADVANCED CHART DRAWING TOOLS (Trendline, Rectangle, Time Line, Note, Support Click)
        // =========================================================
        let currentDrawingTool = null; // 'support_click' | 'resistance_click' | 'trendline' | 'rectangle' | 'vertical' | 'note' | 'parallelchannel' | 'measure' | 'fib' | 'fibext'
        let drawingPoints = [];
        let tempMousePos = null;
        let drawingCanvas = null;
        let tempMeasureData = null; // Temporary measure scale (TradingView behavior)
        let tempMeasureAnimFrame = null;
        let tempMeasureTimer = null;

        function clearTempMeasure() {
            if (tempMeasureAnimFrame) {
                cancelAnimationFrame(tempMeasureAnimFrame);
                tempMeasureAnimFrame = null;
            }
            if (tempMeasureTimer) {
                clearTimeout(tempMeasureTimer);
                tempMeasureTimer = null;
            }
            tempMeasureData = null;
        }

        function startTempMeasureFade() {
            if (tempMeasureAnimFrame) {
                cancelAnimationFrame(tempMeasureAnimFrame);
                tempMeasureAnimFrame = null;
            }
            if (tempMeasureTimer) {
                clearTimeout(tempMeasureTimer);
                tempMeasureTimer = null;
            }
            if (!tempMeasureData) return;

            tempMeasureData.createdAt = performance.now();
            tempMeasureData.opacity = 1.0;
            redrawCanvasOverlay();

            // Measure tool stays fully visible for 2 seconds (0s - 2s),
            // then slowly fades out from second 2 to second 3 (2s - 3s),
            // and completely disables/removes at 3 seconds (3000ms).
            tempMeasureTimer = setTimeout(() => {
                tempMeasureTimer = null;
                function animateFade() {
                    if (!tempMeasureData) return;
                    const elapsed = performance.now() - tempMeasureData.createdAt;
                    if (elapsed >= 3000) {
                        clearTempMeasure();
                        redrawCanvasOverlay();
                        return;
                    }
                    const progress = Math.min(1, Math.max(0, (elapsed - 2000) / 1000));
                    // Smooth ease-in-out curve for slow transition
                    const ease = progress * progress * (3 - 2 * progress);
                    tempMeasureData.opacity = Math.max(0, 1.0 - ease);
                    redrawCanvasOverlay();
                    tempMeasureAnimFrame = requestAnimationFrame(animateFade);
                }
                tempMeasureAnimFrame = requestAnimationFrame(animateFade);
            }, 2000);
        }

        function activateDrawingTool(toolType) {
            if (!mainSeries || !mainChart) {
                alert('Please wait for chart data to load.');
                return;
            }

            hideCanvasObjectMenu();
            clearTempMeasure();
            redrawCanvasOverlay();
            currentDrawingTool = toolType;
            drawingPoints = [];
            tempMousePos = null;

            if (toolType === 'trendline') {
                activeToolColor = getLastTrendlineColor();
                const picker = document.getElementById('toolCustomColorPicker');
                if (picker) picker.value = activeToolColor;
            } else if (toolType === 'support_click' || toolType === 'support') {
                activeToolColor = '#731717';
                const picker = document.getElementById('toolCustomColorPicker');
                if (picker) picker.value = activeToolColor;
            } else if (toolType === 'resistance_click' || toolType === 'resistance') {
                activeToolColor = '#788325';
                const picker = document.getElementById('toolCustomColorPicker');
                if (picker) picker.value = activeToolColor;
            } else if (toolType === 'target') {
                activeToolColor = '#0b845c';
                const picker = document.getElementById('toolCustomColorPicker');
                if (picker) picker.value = activeToolColor;
            }

            updateDrawingToolButtonsUI();
            showDrawingBanner(toolType);
            enableCanvasInteractions(true);
            try {
                if (mainChart) {
                    mainChart.applyOptions({
                        handleScroll: {
                            mouseWheel: true,
                            pressedMove: false,
                            horzTouchDrag: false,
                            vertTouchDrag: false
                        }
                    });
                }
            } catch(e) {}
        }

        function updateDrawingToolButtonsUI() {
            const tools = ['support_click', 'resistance_click', 'support', 'resistance', 'target', 'stoploss', 'trendline', 'rectangle', 'pricerange', 'parallelchannel', 'measure', 'fib', 'fibext', 'vertical', 'note'];
            tools.forEach(t => {
                const btn = document.getElementById(`tool-btn-${t}`);
                if (btn) {
                    if (t === currentDrawingTool) {
                        btn.classList.add('active');
                        if (t === 'resistance_click' || t === 'resistance') {
                            btn.style.background = '#788325';
                        } else if (t === 'support_click' || t === 'support') {
                            btn.style.background = '#731717';
                        } else if (t === 'target') {
                            btn.style.background = '#0b845c';
                        } else if (t === 'stoploss') {
                            btn.style.background = '#ef5350';
                        } else if (t === 'trendline') {
                            btn.style.background = getLastTrendlineColor();
                        } else {
                            btn.style.background = '#3b82f6';
                        }
                        btn.style.color = '#ffffff';
                    } else {
                        btn.classList.remove('active');
                        btn.style.background = 'transparent';
                        btn.style.color = '#787b86';
                    }
                }
            });
            document.querySelectorAll('.chart-mobile-fav-btn, .chart-web-fav-btn').forEach(btn => {
                const tid = btn.getAttribute('data-tool-id');
                btn.classList.toggle('active', tid === currentDrawingTool);
            });
        }

        function showDrawingBanner(toolType) {
            const isMobile = window.innerWidth <= 768;

            let msg = 'Click on chart to draw';
            let mobileMsg = 'Tap chart to draw';
            if (toolType === 'support_click') {
                msg = '🟢 Support Line: Click chart or Y-Axis to place';
                mobileMsg = '🟢 Tap to place line';
            } else if (toolType === 'resistance_click') {
                msg = '🔴 Resistance Line: Click chart or Y-Axis to place';
                mobileMsg = '🔴 Tap to place line';
            } else if (toolType === 'pricerange') {
                msg = '📏 Price Range: Click 1st, then 2nd point';
                mobileMsg = '📏 Drag or tap to draw range';
            } else if (toolType === 'parallelchannel') {
                msg = '⛓️ Parallel Channel: Click 1st point of baseline';
                mobileMsg = '⛓️ Drag or tap baseline';
            } else if (toolType === 'measure') {
                msg = '📐 Measure: Click 1st point to measure';
                mobileMsg = '📐 Drag or tap to measure';
            } else if (toolType === 'fib') {
                msg = '🌀 Fib Retracement: Click swing low/high point';
                mobileMsg = '🌀 Drag or tap swing point';
            } else if (toolType === 'fibext') {
                msg = '🎯 Trend Fib Extension: Click 1st point (Wave 1 start)';
                mobileMsg = '🎯 Drag or tap Wave 1 start';
            } else if (toolType === 'trendline') {
                msg = '📐 Trendline: Click 1st, then 2nd point';
                mobileMsg = '📈 Drag or tap to draw';
            } else if (toolType === 'rectangle') {
                msg = '⬜ Rectangle: Click 1st corner, then opposite corner';
                mobileMsg = '⬛ Drag or tap to draw box';
            } else if (toolType === 'vertical') {
                msg = '⏱️ Time Line: Click on chart to place';
                mobileMsg = '🕒 Tap to place line';
            } else if (toolType === 'note') {
                msg = '📍 Note: Click on chart to place text note';
                mobileMsg = '📝 Tap to place note';
            }

            // Mobile: display decreased size hint in top header bar (between stock name & close button)
            const mobileHint = document.getElementById('chartMobileToolHint');
            const mobileHintText = document.getElementById('chartMobileToolHintText');
            if (isMobile && mobileHint && mobileHintText) {
                mobileHintText.innerText = mobileMsg;
                mobileHint.style.display = 'inline-flex';
                const nameEl = document.getElementById('chartNameDisplay');
                if (nameEl) nameEl.classList.add('hide-on-active-tool');
            }

            // Web: display smaller hint banner at top left of chart (not centered)
            let banner = document.getElementById('drawingToolBanner');
            const mainContainer = document.getElementById('mainChartPane');
            if (!banner && mainContainer) {
                banner = document.createElement('div');
                banner.id = 'drawingToolBanner';
                banner.className = 'drawing-tool-banner';
                banner.style.cssText = `
                    position: absolute;
                    top: 10px;
                    left: 12px;
                    background: rgba(16, 185, 129, 0.95);
                    color: #ffffff;
                    padding: 3px 10px;
                    border-radius: 8px;
                    font-size: 11px;
                    font-weight: 600;
                    line-height: 1.3;
                    z-index: 100;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    backdrop-filter: blur(4px);
                    pointer-events: auto;
                `;
                mainContainer.appendChild(banner);
            }

            if (banner) {
                banner.innerHTML = `<span class="drawing-banner-msg" style="font-size: 11px;">${msg}</span> <button type="button" class="tool-cancel-btn" onclick="if (event) { event.stopPropagation(); event.preventDefault(); } cancelDrawingTool();" title="Cancel drawing (Esc)"><span class="tool-cancel-icon">✕</span><span>Cancel</span></button>`;
                const cancelBtn = banner.querySelector('.tool-cancel-btn');
                if (cancelBtn) {
                    cancelBtn.onclick = function(e) {
                        if (e) {
                            e.stopPropagation();
                            e.preventDefault();
                        }
                        cancelDrawingTool();
                    };
                }
                if (isMobile) {
                    banner.style.setProperty('display', 'none', 'important');
                } else {
                    banner.style.removeProperty('display');
                    banner.style.setProperty('display', 'flex', 'important');
                    banner.style.left = '12px';
                    banner.style.right = 'auto';
                    banner.style.transform = 'none';
                    banner.style.fontSize = '11px';
                    banner.style.padding = '3px 10px';
                }
            }
        }

        function hideDrawingBanner() {
            const banner = document.getElementById('drawingToolBanner');
            if (banner) {
                banner.style.setProperty('display', 'none', 'important');
            }

            const mobileHint = document.getElementById('chartMobileToolHint');
            if (mobileHint) {
                mobileHint.style.setProperty('display', 'none', 'important');
            }
            const nameEl = document.getElementById('chartNameDisplay');
            if (nameEl) nameEl.classList.remove('hide-on-active-tool');
        }

        function cancelDrawingTool() {
            if (mobileDrawSession && mobileDrawSession.dragRaf) {
                cancelAnimationFrame(mobileDrawSession.dragRaf);
            }
            mobileDrawSession = null;
            mobileDrawJustFinished = false;
            currentDrawingTool = null;
            drawingPoints = [];
            tempMousePos = null;
            updateDrawingToolButtonsUI();
            hideDrawingBanner();
            enableCanvasInteractions(false);
            try {
                if (mainChart) {
                    mainChart.applyOptions({
                        handleScroll: {
                            mouseWheel: true,
                            pressedMove: true,
                            horzTouchDrag: true,
                            vertTouchDrag: true
                        }
                    });
                }
            } catch(e) {}
            redrawCanvasOverlay();
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                cancelDrawingTool();
                hideCanvasObjectMenu();
                if (tempMeasureData) {
                    clearTempMeasure();
                    redrawCanvasOverlay();
                }
            }
        });

        function setupChartWatermark() {
            const mainContainer = document.getElementById('mainChartPane');
            if (!mainContainer) return;

            let watermark = document.getElementById('chartWatermark');
            if (!watermark) {
                watermark = document.createElement('div');
                watermark.id = 'chartWatermark';
                watermark.className = 'chart-watermark';
                watermark.innerHTML = `
                    <img src="/static/favicon-192.png" alt="Capital Desk Logo" class="chart-watermark-icon">
                    <span class="chart-watermark-text">Capital Desk</span>
                `;
                mainContainer.appendChild(watermark);
            } else {
                const img = watermark.querySelector('.chart-watermark-icon');
                if (img && !img.src.includes('favicon-192.png')) {
                    img.src = '/static/favicon-192.png';
                }
            }
        }
        window.setupChartWatermark = setupChartWatermark;

        function setupCanvasOverlay() {
            const mainContainer = document.getElementById('mainChartPane');
            if (!mainContainer) return;
            setupChartWatermark();

            let canvas = document.getElementById('chartDrawingCanvas');
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.id = 'chartDrawingCanvas';
                canvas.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    z-index: 20;
                `;
                mainContainer.appendChild(canvas);
            }
            drawingCanvas = canvas;

            mainContainer.removeEventListener('mousemove', handleChartPaneMouseMove);
            mainContainer.removeEventListener('mousedown', handleChartPaneMouseDown);
            mainContainer.removeEventListener('touchstart', onChartTouchStart);
            mainContainer.removeEventListener('touchmove', onChartTouchMove);
            mainContainer.removeEventListener('touchend', onChartTouchEnd);
            mainContainer.removeEventListener('touchcancel', onChartTouchCancel);
            mainContainer.removeEventListener('click', handleChartPaneClick);

            mainContainer.addEventListener('mousemove', handleChartPaneMouseMove);
            mainContainer.addEventListener('mousedown', handleChartPaneMouseDown);
            mainContainer.addEventListener('touchstart', onChartTouchStart, { passive: false });
            mainContainer.addEventListener('touchmove', onChartTouchMove, { passive: false });
            mainContainer.addEventListener('touchend', onChartTouchEnd, { passive: false });
            mainContainer.addEventListener('touchcancel', onChartTouchCancel, { passive: false });
            mainContainer.addEventListener('click', handleChartPaneClick);

            // Listen for user scaling/dragging the price scale or panning the chart
            let isUserDraggingChart = false;
            let chartDragRafId = null;

            const onWindowPointerMove = () => {
                if (!isUserDraggingChart) return;
                if (!chartDragRafId) {
                    chartDragRafId = requestAnimationFrame(() => {
                        chartDragRafId = null;
                        redrawCanvasOverlay();
                    });
                }
            };

            const onWindowPointerUp = () => {
                isUserDraggingChart = false;
                window.removeEventListener('pointermove', onWindowPointerMove);
                window.removeEventListener('pointerup', onWindowPointerUp);
                window.removeEventListener('touchmove', onWindowPointerMove);
                window.removeEventListener('touchend', onWindowPointerUp);
                if (chartDragRafId) {
                    cancelAnimationFrame(chartDragRafId);
                    chartDragRafId = null;
                }
                redrawCanvasOverlay();
            };

            mainContainer.addEventListener('pointerdown', (e) => {
                if (hasOpenChartPopover()) closeAllChartPopovers();
                const menu = document.getElementById('plusActionMenu');
                if (menu && menu.style.display === 'block') {
                    if (e.target && e.target.closest && !e.target.closest('#plusActionMenu') && !e.target.closest('#axisPlusBtn')) {
                        hidePlusActionMenu();
                    }
                }
                if (currentDrawingTool) return;
                if (e.target && e.target.closest && (e.target.closest('#canvasObjectPopup') || e.target.closest('.chart-popover-wrapper') || e.target.closest('.chart-popover-menu') || e.target.closest('#plusActionMenu') || e.target.closest('.chart-close-btn'))) return;

                const pt = getChartPointFromEvent(e);
                if (pt && (activeAddTextButtonBox || findShapeOrLineAtPoint(pt.x, pt.y))) {
                    // Handled by handleChartPaneMouseDown for drawing drag & click
                    return;
                }

                isUserDraggingChart = true;
                window.addEventListener('pointermove', onWindowPointerMove);
                window.addEventListener('pointerup', onWindowPointerUp);
                window.addEventListener('touchmove', onWindowPointerMove, { passive: true });
                window.addEventListener('touchend', onWindowPointerUp);
            });

            mainContainer.addEventListener('wheel', (e) => {
                if (hasOpenChartPopover()) closeAllChartPopovers();

                // Web desktop only: scroll over right Y-axis price scale to expand price as much as possible
                if (window.innerWidth > 768 && mainSeries && mainChart) {
                    const rect = mainContainer.getBoundingClientRect();
                    const isOverRightAxis = (e.clientX >= rect.right - 95);
                    if (isOverRightAxis) {
                        e.preventDefault();
                        e.stopPropagation();

                        // Scrolling UP (deltaY < 0) expands prices (taller candles, narrower visible price range)
                        // Scrolling DOWN (deltaY > 0) compresses prices (shorter candles, wider visible price range)
                        const zoomStep = e.deltaY < 0 ? 0.88 : 1.13;
                        yAxisScaleMultiplier *= zoomStep;

                        // Expand as much as possible (down to 0.001 = 1000x expansion)
                        yAxisScaleMultiplier = Math.max(0.001, Math.min(100.0, yAxisScaleMultiplier));

                        mainSeries.applyOptions({});
                        requestAnimationFrame(() => redrawCanvasOverlay());
                        return;
                    }
                }

                requestAnimationFrame(() => redrawCanvasOverlay());
            }, { passive: false });

            mainContainer.addEventListener('dblclick', () => {
                setTimeout(() => redrawCanvasOverlay(), 50);
            });

            resizeDrawingCanvas();
        }

        function attachDrawingSyncPrimitive(series) {
            if (!series || typeof series.attachPrimitive !== 'function') return;
            try {
                const syncPrimitive = {
                    updateAllViews: function() {
                        redrawCanvasOverlay();
                    },
                    paneViews: function() {
                        return [{
                            zOrder: function() { return 'top'; },
                            renderer: function() {
                                return {
                                    draw: function() {
                                        redrawCanvasOverlay();
                                    }
                                };
                            }
                        }];
                    }
                };
                series.attachPrimitive(syncPrimitive);
            } catch (err) {
                console.warn('Could not attach drawing sync primitive:', err);
            }
        }

        function resizeDrawingCanvas() {
            const mainContainer = document.getElementById('mainChartPane');
            if (drawingCanvas && mainContainer) {
                drawingCanvas.width = mainContainer.clientWidth;
                drawingCanvas.height = mainContainer.clientHeight;
                redrawCanvasOverlay();
            }
        }

        function enableCanvasInteractions(enable) {
            if (drawingCanvas) {
                // Keep pointerEvents 'none' so mouse movements reach LightweightCharts underneath
                // and display the native crosshair cursor and lines on both X and Y axis during new drawings
                drawingCanvas.style.pointerEvents = 'none';
                drawingCanvas.style.cursor = enable ? 'crosshair' : 'default';
                drawingCanvas.style.touchAction = enable ? 'none' : '';
            }
            const mainContainer = document.getElementById('mainChartPane');
            if (mainContainer) {
                mainContainer.style.cursor = enable ? 'crosshair' : 'default';
            }
        }

        function timeToEpochSeconds(t) {
            if (t === null || t === undefined) return null;
            if (typeof t === 'number') {
                return (t > 1e11) ? Math.floor(t / 1000) : Math.floor(t);
            }
            if (typeof t === 'string') {
                if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
                    const parts = t.split('-').map(Number);
                    return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / 1000);
                }
                const ms = Date.parse(t);
                if (!isNaN(ms)) return Math.floor(ms / 1000);
            }
            if (typeof t === 'object' && t.year && t.month && t.day) {
                return Math.floor(Date.UTC(t.year, t.month - 1, t.day) / 1000);
            }
            return null;
        }

        function formatEpochToDateStr(epochSec) {
            if (!epochSec) return '';
            const d = new Date(epochSec * 1000);
            const yyyy = d.getUTCFullYear();
            const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(d.getUTCDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }

        function calculateFutureEpoch(baseTime, futureBars, interval) {
            if (!baseTime || !futureBars || futureBars <= 0) return timeToEpochSeconds(baseTime);
            const baseSec = timeToEpochSeconds(baseTime);
            if (!baseSec) return null;
            const intv = (interval || currentChartInterval || '1d').toLowerCase();

            if (['5m', '15m', '30m', '60m', '1h'].includes(intv)) {
                const mins = intv === '5m' ? 5 : intv === '15m' ? 15 : intv === '30m' ? 30 : 60;
                return baseSec + (futureBars * mins * 60);
            }
            if (intv === '1w') {
                return baseSec + (futureBars * 7 * 86400);
            }
            if (intv === '1mo') {
                return baseSec + (futureBars * 30 * 86400);
            }
            // Daily (1d): each bar is 1 trading day (skipping Sat & Sun)
            const d = new Date(baseSec * 1000);
            let added = 0;
            while (added < futureBars) {
                d.setUTCDate(d.getUTCDate() + 1);
                const day = d.getUTCDay();
                if (day !== 0 && day !== 6) {
                    added++;
                }
            }
            return Math.floor(d.getTime() / 1000);
        }

        function calculateBarsFromFutureEpoch(lastCandleTime, futureEpoch, interval) {
            if (!lastCandleTime || !futureEpoch) return 0;
            const baseSec = timeToEpochSeconds(lastCandleTime);
            if (!baseSec || futureEpoch <= baseSec) return 0;
            const intv = (interval || currentChartInterval || '1d').toLowerCase();
            const diffSec = futureEpoch - baseSec;

            if (['5m', '15m', '30m', '60m', '1h'].includes(intv)) {
                const mins = intv === '5m' ? 5 : intv === '15m' ? 15 : intv === '30m' ? 30 : 60;
                return Math.max(1, Math.round(diffSec / (mins * 60)));
            }
            if (intv === '1w') {
                return Math.max(1, Math.round(diffSec / (7 * 86400)));
            }
            if (intv === '1mo') {
                return Math.max(1, Math.round(diffSec / (30 * 86400)));
            }
            // Daily: count business days between baseSec and futureEpoch
            const cur = new Date(baseSec * 1000);
            const target = new Date(futureEpoch * 1000);
            let count = 0;
            while (cur < target) {
                cur.setUTCDate(cur.getUTCDate() + 1);
                const day = cur.getUTCDay();
                if (day !== 0 && day !== 6) {
                    count++;
                }
            }
            return Math.max(1, count);
        }

        function normalizeTime(t) {
            if (t === null || t === undefined) return null;
            if (typeof t === 'string') return t;
            const isIntraday = ['5m', '15m', '30m', '60m', '1h'].includes((currentChartInterval || '').toLowerCase());
            if (typeof t === 'number') {
                if (isIntraday) {
                    return (t > 1e11) ? Math.floor(t / 1000) : Math.floor(t);
                }
                const d = new Date(t * 1000);
                const yyyy = d.getUTCFullYear();
                const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
                const dd = String(d.getUTCDate()).padStart(2, '0');
                return `${yyyy}-${mm}-${dd}`;
            }
            if (typeof t === 'object' && t.year && t.month && t.day) {
                if (isIntraday) {
                    return Math.floor(Date.UTC(t.year, t.month - 1, t.day) / 1000);
                }
                const yyyy = t.year;
                const mm = String(t.month).padStart(2, '0');
                const dd = String(t.day).padStart(2, '0');
                return `${yyyy}-${mm}-${dd}`;
            }
            return t;
        }

        function findClosestCandleByTime(candles, targetTime) {
            if (!candles || candles.length === 0) return null;
            const targetEpoch = timeToEpochSeconds(targetTime);
            if (!targetEpoch || isNaN(targetEpoch)) return candles[0];

            let low = 0;
            let high = candles.length - 1;

            const firstEpoch = timeToEpochSeconds(candles[0].time);
            if (firstEpoch !== null && targetEpoch <= firstEpoch) return candles[0];
            const lastEpoch = timeToEpochSeconds(candles[high].time);
            if (lastEpoch !== null && targetEpoch >= lastEpoch) return candles[high];

            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                const midEpoch = timeToEpochSeconds(candles[mid].time);
                if (midEpoch === targetEpoch) {
                    return candles[mid];
                } else if (midEpoch < targetEpoch) {
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }

            const candleHigh = candles[Math.max(0, high)] || candles[0];
            const candleLow = candles[Math.min(candles.length - 1, low)] || candles[candles.length - 1];
            const epHigh = timeToEpochSeconds(candleHigh.time);
            const epLow = timeToEpochSeconds(candleLow.time);
            const diffHigh = epHigh !== null ? Math.abs(epHigh - targetEpoch) : Infinity;
            const diffLow = epLow !== null ? Math.abs(epLow - targetEpoch) : Infinity;
            return diffHigh <= diffLow ? candleHigh : candleLow;
        }

        function getChartPointFromEvent(e) {
            if (!mainChart || !mainSeries || !drawingCanvas) return null;
            const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
            const clientX = touch.clientX !== undefined ? touch.clientX : (touch.pageX || 0);
            const clientY = touch.clientY !== undefined ? touch.clientY : (touch.pageY || 0);
            const rect = drawingCanvas.getBoundingClientRect();
            const x = clientX - rect.left;
            const y = clientY - rect.top;

            const price = mainSeries.coordinateToPrice(y);
            const rawTime = mainChart.timeScale().coordinateToTime(x);
            const logical = mainChart.timeScale().coordinateToLogical(x);

            let time = normalizeTime(rawTime);
            let futureOffset = 0;
            let futureTime = null;

            const candleCount = (cachedChartData && cachedChartData.candles) ? cachedChartData.candles.length : 0;
            const lastCandleIndex = candleCount > 0 ? candleCount - 1 : 0;

            if (logical !== null && logical !== undefined && candleCount > 0) {
                if (logical > lastCandleIndex) {
                    futureOffset = Math.round(logical - lastCandleIndex);
                    const lastCandleTime = cachedChartData.candles[lastCandleIndex].time;
                    time = normalizeTime(lastCandleTime);
                    futureTime = calculateFutureEpoch(lastCandleTime, futureOffset, currentChartInterval);
                } else if (!time && logical >= 0 && logical <= lastCandleIndex) {
                    const cIdx = Math.max(0, Math.min(lastCandleIndex, Math.round(logical)));
                    const candle = cachedChartData.candles[cIdx];
                    if (candle) time = normalizeTime(candle.time);
                } else if (!time && logical < 0) {
                    futureOffset = Math.round(logical);
                    time = normalizeTime(cachedChartData.candles[0].time);
                }
            }

            return { x, y, price, time, logical, futureOffset, futureTime };
        }

        function getShapeX(timeScale, time, logical, futureOffset = 0, futureTime = null, shapeTimeframe = null) {
            if (!timeScale) return null;

            const candleCount = (cachedChartData && cachedChartData.candles) ? cachedChartData.candles.length : 0;
            const lastCandleIndex = candleCount > 0 ? candleCount - 1 : 0;
            const lastCandle = candleCount > 0 ? cachedChartData.candles[lastCandleIndex] : null;

            // 1. If point extends into future right offset beyond the last candle
            if ((futureTime || (futureOffset && futureOffset > 0)) && lastCandle) {
                let targetFutureEpoch = futureTime ? timeToEpochSeconds(futureTime) : null;
                if (!targetFutureEpoch && futureOffset > 0) {
                    targetFutureEpoch = calculateFutureEpoch(lastCandle.time, futureOffset, shapeTimeframe || currentChartInterval);
                }
                if (targetFutureEpoch) {
                    const barsAhead = calculateBarsFromFutureEpoch(lastCandle.time, targetFutureEpoch, currentChartInterval);
                    const targetLogical = lastCandleIndex + barsAhead;
                    const x = timeScale.logicalToCoordinate(targetLogical);
                    if (x !== null && x !== undefined) return x;
                } else if (futureOffset > 0) {
                    const targetLogical = lastCandleIndex + futureOffset;
                    const x = timeScale.logicalToCoordinate(targetLogical);
                    if (x !== null && x !== undefined) return x;
                }
            }

            // 2. Normal date matching for points within chart history
            const normTime = normalizeTime(time);
            if (normTime !== null && normTime !== undefined) {
                let x = timeScale.timeToCoordinate(normTime);
                if (x !== null && x !== undefined) return x;

                if (candleCount > 0) {
                    const targetEpoch = timeToEpochSeconds(normTime);
                    if (targetEpoch) {
                        const closest = findClosestCandleByTime(cachedChartData.candles, targetEpoch);
                        if (closest && closest.time !== undefined && closest.time !== null) {
                            x = timeScale.timeToCoordinate(closest.time);
                            if (x !== null && x !== undefined) return x;
                        }
                    }
                }
            }

            // 3. Fallback to logical coordinate ONLY if on the exact same timeframe as drawn
            if (logical !== null && logical !== undefined) {
                if (!shapeTimeframe || shapeTimeframe === currentChartInterval) {
                    const x = timeScale.logicalToCoordinate(logical);
                    if (x !== null && x !== undefined) return x;
                }
            }
            return null;
        }

        function updateShapePointFromLogical(s, pointNum, newLogical) {
            if (pointNum === 1) s.logical1 = newLogical;
            else if (pointNum === 2) s.logical2 = newLogical;
            else if (pointNum === 3) s.logical3 = newLogical;
            else s.logical = newLogical;

            if (!cachedChartData || !cachedChartData.candles || cachedChartData.candles.length === 0) return;
            const candleCount = cachedChartData.candles.length;
            const lastIdx = candleCount - 1;
            const lastCandle = cachedChartData.candles[lastIdx];
            const idx = Math.round(newLogical);

            let time = null, futureOffset = 0, futureTime = null;
            if (idx > lastIdx) {
                futureOffset = idx - lastIdx;
                time = normalizeTime(lastCandle.time);
                futureTime = calculateFutureEpoch(lastCandle.time, futureOffset, currentChartInterval);
            } else if (idx >= 0 && idx <= lastIdx) {
                time = normalizeTime(cachedChartData.candles[idx].time);
                futureOffset = 0;
                futureTime = null;
            } else {
                futureOffset = idx;
                time = normalizeTime(cachedChartData.candles[0].time);
                futureTime = null;
            }

            if (pointNum === 1) { s.time1 = time; s.futureOffset1 = futureOffset; s.futureTime1 = futureTime; }
            else if (pointNum === 2) { s.time2 = time; s.futureOffset2 = futureOffset; s.futureTime2 = futureTime; }
            else if (pointNum === 3) { s.time3 = time; s.futureOffset3 = futureOffset; s.futureTime3 = futureTime; }
            else { s.time = time; s.futureOffset = futureOffset; s.futureTime = futureTime; }
        }

        let activeDrawingDrag = null;
        let lastDrawingClickTime = 0;
        let lastDrawingClickId = null;
        let activeDrawingCrosshair = null;

        function formatCrosshairPointTime(pt) {
            if (!pt) return '';
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            if ((pt.futureTime || (pt.futureOffset && pt.futureOffset > 0)) && cachedChartData && cachedChartData.candles && cachedChartData.candles.length > 0) {
                const lastCandle = cachedChartData.candles[cachedChartData.candles.length - 1];
                let futureEpoch = pt.futureTime ? timeToEpochSeconds(pt.futureTime) : null;
                if (!futureEpoch && pt.futureOffset) {
                    futureEpoch = calculateFutureEpoch(lastCandle.time, pt.futureOffset, currentChartInterval);
                }
                if (futureEpoch) {
                    const d = new Date(futureEpoch * 1000);
                    const intv = (currentChartInterval || '1d').toLowerCase();
                    if (['5m', '15m', '30m', '60m', '1h'].includes(intv)) {
                        const hh = String(d.getUTCHours()).padStart(2, '0');
                        const mm = String(d.getUTCMinutes()).padStart(2, '0');
                        return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm}`;
                    }
                    return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
                }
            }

            if (pt.time) {
                if (typeof formatCrosshairBadgeTime === 'function') {
                    return formatCrosshairBadgeTime(pt.time);
                }
                return String(pt.time);
            }
            return '';
        }

        function syncCrosshairToPoint(pt) {
            if (!mainChart || !mainSeries || !pt) return;
            try {
                if (pt.futureOffset && pt.futureOffset > 0) {
                    if (typeof mainChart.clearCrosshairPosition === 'function') {
                        mainChart.clearCrosshairPosition();
                    }
                    return;
                }

                let price = pt.price;
                if (price === null || price === undefined || isNaN(price)) {
                    if (pt.y !== null && pt.y !== undefined) {
                        price = mainSeries.coordinateToPrice(pt.y);
                    }
                }
                if (price === null || price === undefined || isNaN(price)) return;

                let targetTime = pt.time;
                if (!targetTime && cachedChartData && cachedChartData.candles && cachedChartData.candles.length > 0) {
                    if (pt.logical !== null && pt.logical !== undefined) {
                        const idx = Math.max(0, Math.min(cachedChartData.candles.length - 1, Math.round(pt.logical)));
                        targetTime = cachedChartData.candles[idx].time;
                    } else if (pt.x !== null && pt.x !== undefined) {
                        const rawTime = mainChart.timeScale().coordinateToTime(pt.x);
                        targetTime = rawTime || cachedChartData.candles[cachedChartData.candles.length - 1].time;
                    }
                }

                if (targetTime !== null && targetTime !== undefined) {
                    mainChart.setCrosshairPosition(price, targetTime, mainSeries);
                }
            } catch (err) {
                // Ignore crosshair errors
            }
        }

        function drawActiveDrawingCrosshair(ctx) {
            if (!activeDrawingCrosshair || !drawingCanvas || !mainChart || !mainSeries) return;
            if (!(activeDrawingCrosshair.futureOffset && activeDrawingCrosshair.futureOffset > 0)) return;

            const x = activeDrawingCrosshair.x;
            const y = activeDrawingCrosshair.y;
            if (x === null || x === undefined || y === null || y === undefined) return;

            const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
            const isDark = currentTheme === 'dark';
            const lineColor = isDark ? '#758696' : '#94a3b8';
            const labelBg = isDark ? '#2a2e39' : '#334155';
            const labelTextColor = '#ffffff';

            ctx.save();

            // 1. Vertical dashed line
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, drawingCanvas.height);
            ctx.stroke();

            // 2. Horizontal dashed line
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(drawingCanvas.width, y);
            ctx.stroke();
            ctx.setLineDash([]);

            // 3. Time badge at bottom
            const timeText = formatCrosshairPointTime(activeDrawingCrosshair);
            if (timeText) {
                ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                const textWidth = ctx.measureText(timeText).width;
                const badgeWidth = textWidth + 14;
                const badgeHeight = 20;
                const badgeX = Math.max(2, Math.min(drawingCanvas.width - badgeWidth - 2, x - badgeWidth / 2));
                const badgeY = drawingCanvas.height - badgeHeight - 2;

                ctx.fillStyle = labelBg;
                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') {
                    ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 3);
                } else {
                    ctx.rect(badgeX, badgeY, badgeWidth, badgeHeight);
                }
                ctx.fill();

                ctx.fillStyle = labelTextColor;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(timeText, badgeX + badgeWidth / 2, badgeY + badgeHeight / 2);
            }

            // 4. Price badge on right
            let price = activeDrawingCrosshair.price;
            if (price === null || price === undefined || isNaN(price)) {
                price = mainSeries.coordinateToPrice(y);
            }
            if (price !== null && price !== undefined && !isNaN(price)) {
                const priceText = `₹${price.toFixed(2)}`;
                ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                const pTextWidth = ctx.measureText(priceText).width;
                const pBadgeWidth = pTextWidth + 10;
                const pBadgeHeight = 18;
                const pBadgeX = drawingCanvas.width - pBadgeWidth - 2;
                const pBadgeY = Math.max(2, Math.min(drawingCanvas.height - pBadgeHeight - 2, y - pBadgeHeight / 2));

                ctx.fillStyle = labelBg;
                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') {
                    ctx.roundRect(pBadgeX, pBadgeY, pBadgeWidth, pBadgeHeight, 3);
                } else {
                    ctx.rect(pBadgeX, pBadgeY, pBadgeWidth, pBadgeHeight);
                }
                ctx.fill();

                ctx.fillStyle = labelTextColor;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(priceText, pBadgeX + pBadgeWidth / 2, pBadgeY + pBadgeHeight / 2);
            }

            ctx.restore();
        }

        function handleChartPaneMouseMove(e) {
            if (e.target && e.target.closest && e.target.closest('#canvasObjectPopup')) {
                if (drawingCanvas) {
                    drawingCanvas.style.pointerEvents = 'auto';
                }
                return;
            }

            const pt = getChartPointFromEvent(e);
            if (!pt) return;

            if (currentDrawingTool) {
                tempMousePos = pt;
                redrawCanvasOverlay();
                return;
            }

            if (activeDrawingDrag) return;

            if (activeAddTextButtonBox) {
                const b = activeAddTextButtonBox;
                if (pt.x >= b.x && pt.x <= b.x + b.width && pt.y >= b.y && pt.y <= b.y + b.height) {
                    if (drawingCanvas) {
                        drawingCanvas.style.pointerEvents = 'auto';
                        drawingCanvas.style.cursor = 'pointer';
                    }
                    return;
                }
            }

            const clickedObj = findShapeOrLineAtPoint(pt.x, pt.y);
            if (drawingCanvas) {
                if (clickedObj) {
                    drawingCanvas.style.pointerEvents = 'auto';
                    drawingCanvas.style.cursor = clickedObj.locked ? 'pointer' : (clickedObj.cursor || 'grab');
                    syncCrosshairToPoint(pt);
                } else {
                    drawingCanvas.style.pointerEvents = 'none';
                    drawingCanvas.style.cursor = 'default';
                }
            }
        }

        function handleChartPaneMouseDown(e) {
            if (e.target && e.target.closest && (e.target.closest('#canvasObjectPopup') || e.target.closest('.chart-popover-wrapper') || e.target.closest('.chart-popover-menu') || e.target.closest('#plusActionMenu') || e.target.closest('.chart-close-btn') || e.target.closest('#drawingToolBanner') || e.target.closest('#chartMobileToolHint') || e.target.closest('.tool-cancel-btn'))) {
                return;
            }
            if (currentDrawingTool) return;
            const pt = getChartPointFromEvent(e);
            if (!pt) return;

            // Direct click on "+ Add text" pill
            if (activeAddTextButtonBox) {
                const b = activeAddTextButtonBox;
                if (pt.x >= b.x && pt.x <= b.x + b.width && pt.y >= b.y && pt.y <= b.y + b.height) {
                    if (e.cancelable) e.preventDefault();
                    e.stopPropagation();
                    hideCanvasObjectMenu();
                    openEditDrawingModal(b.kind, b.id, 'text');
                    return;
                }
            }

            const clickedObj = findShapeOrLineAtPoint(pt.x, pt.y);
            if (!clickedObj) {
                hideCanvasObjectMenu();
                return;
            }

            // Clicked or touched on an existing drawing object
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();

            const isMobile = window.innerWidth <= 768;
            const existingPopup = document.getElementById('canvasObjectPopup');
            let wasPopupOpenForThis = false;
            if (isMobile && existingPopup && existingPopup.style.display === 'flex' && existingPopup.dataset.activeObjId === String(clickedObj.id)) {
                wasPopupOpenForThis = true;
            }

            const now = Date.now();
            if (lastDrawingClickId === clickedObj.id && (now - lastDrawingClickTime) < 350) {
                lastDrawingClickTime = 0;
                lastDrawingClickId = null;
                hideCanvasObjectMenu();
                openEditDrawingModal(clickedObj.kind, clickedObj.id);
                return;
            }
            lastDrawingClickTime = now;
            lastDrawingClickId = clickedObj.id;

            let dragPart = clickedObj.subPart || 'body';

            activeDrawingCrosshair = { x: pt.x, y: pt.y, price: pt.price, time: pt.time, logical: pt.logical, futureOffset: pt.futureOffset || 0 };
            syncCrosshairToPoint(pt);

            activeDrawingDrag = {
                target: clickedObj,
                dragPart: dragPart,
                wasPopupOpenForThis: wasPopupOpenForThis,
                startPt: { x: pt.x, y: pt.y, price: pt.price, time: pt.time, logical: pt.logical, futureOffset: pt.futureOffset || 0 },
                hasMoved: false,
                initialPrice: clickedObj.kind === 'line' ? (getSavedPriceLines(currentChartSymbol).find(l => l.id === clickedObj.id)?.price || pt.price) : null,
                initialShape: clickedObj.kind === 'shape' ? JSON.parse(JSON.stringify(getSavedChartShapes(currentChartSymbol).find(s => s.id === clickedObj.id) || {})) : null
            };
            redrawCanvasOverlay();

            const onWindowDrawingMove = (moveEvt) => {
                if (!activeDrawingDrag) return;
                if (activeDrawingDrag.target && activeDrawingDrag.target.locked) {
                    return; // Locked drawings cannot be moved or dragged
                }
                const curPt = getChartPointFromEvent(moveEvt);
                if (!curPt) return;

                activeDrawingCrosshair = { x: curPt.x, y: curPt.y, price: curPt.price, time: curPt.time, logical: curPt.logical, futureOffset: curPt.futureOffset || 0 };
                syncCrosshairToPoint(curPt);

                const dist = Math.hypot(curPt.x - activeDrawingDrag.startPt.x, curPt.y - activeDrawingDrag.startPt.y);
                if (dist >= 4) {
                    activeDrawingDrag.hasMoved = true;
                    hideCanvasObjectMenu();
                    if (drawingCanvas) drawingCanvas.style.cursor = 'grabbing';

                    if (activeDrawingDrag.target.kind === 'line') {
                        if (curPt.price !== null && !isNaN(curPt.price)) {
                            const newPrice = parseFloat(curPt.price.toFixed(2));
                            const pl = activePriceLines.find(p => p.id === activeDrawingDrag.target.id);
                            if (pl && pl.lineObj) {
                                pl.data.price = newPrice;
                                pl.lineObj.applyOptions({
                                    price: newPrice,
                                    title: ''
                                });
                            }
                            redrawCanvasOverlay();
                        }
                    } else if (activeDrawingDrag.target.kind === 'shape') {
                        const shapes = getSavedChartShapes(currentChartSymbol);
                        const s = shapes.find(x => x.id === activeDrawingDrag.target.id);
                        if (s && curPt.price !== null && !isNaN(curPt.price)) {
                            const initS = activeDrawingDrag.initialShape;
                            const dPrice = curPt.price - activeDrawingDrag.startPt.price;
                            const dLogical = (curPt.logical !== null && activeDrawingDrag.startPt.logical !== null) ? (curPt.logical - activeDrawingDrag.startPt.logical) : 0;

                            if (s.type === 'vertical') {
                                s.logical = curPt.logical;
                                s.time = curPt.time;
                                s.futureOffset = curPt.futureOffset || 0;
                                s.futureTime = curPt.futureTime || null;
                            } else if (s.type === 'note') {
                                s.price = parseFloat((initS.price + dPrice).toFixed(2));
                                updateShapePointFromLogical(s, 0, initS.logical + dLogical);
                            } else if (s.type === 'trendline' || s.type === 'fib') {
                                if (activeDrawingDrag.dragPart === 'p1') {
                                    s.price1 = parseFloat(curPt.price.toFixed(2));
                                    s.logical1 = curPt.logical;
                                    s.time1 = curPt.time || s.time1;
                                    s.futureOffset1 = curPt.futureOffset || 0;
                                    s.futureTime1 = curPt.futureTime || null;
                                } else if (activeDrawingDrag.dragPart === 'p2') {
                                    s.price2 = parseFloat(curPt.price.toFixed(2));
                                    s.logical2 = curPt.logical;
                                    s.time2 = curPt.time || s.time2;
                                    s.futureOffset2 = curPt.futureOffset || 0;
                                    s.futureTime2 = curPt.futureTime || null;
                                } else {
                                    s.price1 = parseFloat((initS.price1 + dPrice).toFixed(2));
                                    s.price2 = parseFloat((initS.price2 + dPrice).toFixed(2));
                                    updateShapePointFromLogical(s, 1, initS.logical1 + dLogical);
                                    updateShapePointFromLogical(s, 2, initS.logical2 + dLogical);
                                }
                            } else if (s.type === 'rectangle' || s.type === 'pricerange') {
                                const isP1Top = initS.price1 >= initS.price2;
                                const isP1Left = initS.logical1 <= (initS.logical2 !== undefined ? initS.logical2 : initS.logical1);

                                if (activeDrawingDrag.dragPart === 'border-top') {
                                    if (isP1Top) s.price1 = parseFloat(curPt.price.toFixed(2));
                                    else s.price2 = parseFloat(curPt.price.toFixed(2));
                                } else if (activeDrawingDrag.dragPart === 'border-bottom') {
                                    if (isP1Top) s.price2 = parseFloat(curPt.price.toFixed(2));
                                    else s.price1 = parseFloat(curPt.price.toFixed(2));
                                } else if (activeDrawingDrag.dragPart === 'border-left') {
                                    if (isP1Left) {
                                        s.logical1 = curPt.logical; s.time1 = curPt.time || s.time1; s.futureOffset1 = curPt.futureOffset || 0; s.futureTime1 = curPt.futureTime || null;
                                    } else {
                                        s.logical2 = curPt.logical; s.time2 = curPt.time || s.time2; s.futureOffset2 = curPt.futureOffset || 0; s.futureTime2 = curPt.futureTime || null;
                                    }
                                } else if (activeDrawingDrag.dragPart === 'border-right') {
                                    if (isP1Left) {
                                        s.logical2 = curPt.logical; s.time2 = curPt.time || s.time2; s.futureOffset2 = curPt.futureOffset || 0; s.futureTime2 = curPt.futureTime || null;
                                    } else {
                                        s.logical1 = curPt.logical; s.time1 = curPt.time || s.time1; s.futureOffset1 = curPt.futureOffset || 0; s.futureTime1 = curPt.futureTime || null;
                                    }
                                } else if (activeDrawingDrag.dragPart === 'corner-top-left') {
                                    if (isP1Top) s.price1 = parseFloat(curPt.price.toFixed(2));
                                    else s.price2 = parseFloat(curPt.price.toFixed(2));
                                    if (isP1Left) {
                                        s.logical1 = curPt.logical; s.time1 = curPt.time || s.time1; s.futureOffset1 = curPt.futureOffset || 0; s.futureTime1 = curPt.futureTime || null;
                                    } else {
                                        s.logical2 = curPt.logical; s.time2 = curPt.time || s.time2; s.futureOffset2 = curPt.futureOffset || 0; s.futureTime2 = curPt.futureTime || null;
                                    }
                                } else if (activeDrawingDrag.dragPart === 'corner-top-right') {
                                    if (isP1Top) s.price1 = parseFloat(curPt.price.toFixed(2));
                                    else s.price2 = parseFloat(curPt.price.toFixed(2));
                                    if (isP1Left) {
                                        s.logical2 = curPt.logical; s.time2 = curPt.time || s.time2; s.futureOffset2 = curPt.futureOffset || 0; s.futureTime2 = curPt.futureTime || null;
                                    } else {
                                        s.logical1 = curPt.logical; s.time1 = curPt.time || s.time1; s.futureOffset1 = curPt.futureOffset || 0; s.futureTime1 = curPt.futureTime || null;
                                    }
                                } else if (activeDrawingDrag.dragPart === 'corner-bottom-left') {
                                    if (isP1Top) s.price2 = parseFloat(curPt.price.toFixed(2));
                                    else s.price1 = parseFloat(curPt.price.toFixed(2));
                                    if (isP1Left) {
                                        s.logical1 = curPt.logical; s.time1 = curPt.time || s.time1; s.futureOffset1 = curPt.futureOffset || 0; s.futureTime1 = curPt.futureTime || null;
                                    } else {
                                        s.logical2 = curPt.logical; s.time2 = curPt.time || s.time2; s.futureOffset2 = curPt.futureOffset || 0; s.futureTime2 = curPt.futureTime || null;
                                    }
                                } else if (activeDrawingDrag.dragPart === 'corner-bottom-right') {
                                    if (isP1Top) s.price2 = parseFloat(curPt.price.toFixed(2));
                                    else s.price1 = parseFloat(curPt.price.toFixed(2));
                                    if (isP1Left) {
                                        s.logical2 = curPt.logical; s.time2 = curPt.time || s.time2; s.futureOffset2 = curPt.futureOffset || 0; s.futureTime2 = curPt.futureTime || null;
                                    } else {
                                        s.logical1 = curPt.logical; s.time1 = curPt.time || s.time1; s.futureOffset1 = curPt.futureOffset || 0; s.futureTime1 = curPt.futureTime || null;
                                    }
                                } else if (activeDrawingDrag.dragPart === 'p1') {
                                    s.price1 = parseFloat(curPt.price.toFixed(2));
                                    s.logical1 = curPt.logical;
                                    s.time1 = curPt.time || s.time1;
                                    s.futureOffset1 = curPt.futureOffset || 0;
                                    s.futureTime1 = curPt.futureTime || null;
                                } else if (activeDrawingDrag.dragPart === 'p2') {
                                    s.price2 = parseFloat(curPt.price.toFixed(2));
                                    s.logical2 = curPt.logical;
                                    s.time2 = curPt.time || s.time2;
                                    s.futureOffset2 = curPt.futureOffset || 0;
                                    s.futureTime2 = curPt.futureTime || null;
                                } else {
                                    // ONLY if clicked body -> move the entire shape!
                                    s.price1 = parseFloat((initS.price1 + dPrice).toFixed(2));
                                    s.price2 = parseFloat((initS.price2 + dPrice).toFixed(2));
                                    updateShapePointFromLogical(s, 1, initS.logical1 + dLogical);
                                    updateShapePointFromLogical(s, 2, (initS.logical2 !== undefined ? initS.logical2 : initS.logical1) + dLogical);
                                }
                            } else if (s.type === 'parallelchannel' || s.type === 'fibext') {
                                if (activeDrawingDrag.dragPart === 'parallel' || activeDrawingDrag.dragPart === 'p3') {
                                    s.price3 = parseFloat(curPt.price.toFixed(2));
                                    s.logical3 = curPt.logical;
                                    s.time3 = curPt.time || s.time3;
                                    s.futureOffset3 = curPt.futureOffset || 0;
                                    s.futureTime3 = curPt.futureTime || null;
                                } else if (activeDrawingDrag.dragPart === 'p1') {
                                    s.price1 = parseFloat(curPt.price.toFixed(2));
                                    s.logical1 = curPt.logical;
                                    s.time1 = curPt.time || s.time1;
                                    s.futureOffset1 = curPt.futureOffset || 0;
                                    s.futureTime1 = curPt.futureTime || null;
                                } else if (activeDrawingDrag.dragPart === 'p2') {
                                    s.price2 = parseFloat(curPt.price.toFixed(2));
                                    s.logical2 = curPt.logical;
                                    s.time2 = curPt.time || s.time2;
                                    s.futureOffset2 = curPt.futureOffset || 0;
                                    s.futureTime2 = curPt.futureTime || null;
                                } else {
                                    // ONLY if clicked body -> move the entire channel/ext!
                                    s.price1 = parseFloat((initS.price1 + dPrice).toFixed(2));
                                    s.price2 = parseFloat((initS.price2 + dPrice).toFixed(2));
                                    if (initS.price3 !== undefined) s.price3 = parseFloat((initS.price3 + dPrice).toFixed(2));
                                    updateShapePointFromLogical(s, 1, initS.logical1 + dLogical);
                                    updateShapePointFromLogical(s, 2, initS.logical2 + dLogical);
                                    if (initS.logical3 !== undefined) updateShapePointFromLogical(s, 3, initS.logical3 + dLogical);
                                }
                            }
                            persistShapesForSymbol(currentChartSymbol, shapes);
                            redrawCanvasOverlay();
                        }
                    }
                }
            };

            const onWindowDrawingUp = (upEvt) => {
                window.removeEventListener('mousemove', onWindowDrawingMove);
                window.removeEventListener('mouseup', onWindowDrawingUp);
                window.removeEventListener('touchmove', onWindowDrawingMove);
                window.removeEventListener('touchend', onWindowDrawingUp);

                activeDrawingCrosshair = null;
                if (mainChart && typeof mainChart.clearCrosshairPosition === 'function') {
                    mainChart.clearCrosshairPosition();
                }

                if (!activeDrawingDrag) {
                    redrawCanvasOverlay();
                    return;
                }

                if (activeDrawingDrag.hasMoved) {
                    lastDrawingClickTime = 0;
                    lastDrawingClickId = null;
                    if (activeDrawingDrag.target.kind === 'line') {
                        const finalPt = getChartPointFromEvent(upEvt) || activeDrawingDrag.startPt;
                        if (finalPt && finalPt.price !== null && !isNaN(finalPt.price)) {
                            const newPrice = parseFloat(finalPt.price.toFixed(2));
                            const lines = getSavedPriceLines(currentChartSymbol);
                            const line = lines.find(x => x.id === activeDrawingDrag.target.id);
                            if (line) {
                                line.price = newPrice;
                                persistLinesForSymbol(currentChartSymbol, lines);
                            }
                            const pl = activePriceLines.find(p => p.id === activeDrawingDrag.target.id);
                            if (pl && pl.data) {
                                pl.data.price = newPrice;
                                if (pl.lineObj) {
                                    pl.lineObj.applyOptions({
                                        price: newPrice,
                                        title: ''
                                    });
                                }
                            }
                        }
                    }
                    renderActiveDrawingsList();
                    redrawCanvasOverlay();
                } else {
                    const isMobile = window.innerWidth <= 768;
                    if (isMobile && activeDrawingDrag.wasPopupOpenForThis) {
                        hideCanvasObjectMenu();
                    } else {
                        // Single click: show menu with Hide and Delete options
                        showCanvasObjectMenu(activeDrawingDrag.target, activeDrawingDrag.startPt.x, activeDrawingDrag.startPt.y);
                    }
                }

                if (drawingCanvas) {
                    drawingCanvas.style.cursor = 'default';
                }
                activeDrawingDrag = null;
                redrawCanvasOverlay();
            };

            window.addEventListener('mousemove', onWindowDrawingMove);
            window.addEventListener('mouseup', onWindowDrawingUp);
            window.addEventListener('touchmove', onWindowDrawingMove, { passive: false });
            window.addEventListener('touchend', onWindowDrawingUp);
        }

        let mobileDrawSession = null;
        let mobileDrawJustFinished = false;

        function handleMobileDrawingTouchStart(e) {
            const isMobile = window.innerWidth <= 768 || (window.innerHeight <= 520 && window.innerWidth <= 1024);
            if (!isMobile || !currentDrawingTool) return false;

            if (e.target && e.target.closest && (
                e.target.closest('#canvasObjectPopup') ||
                e.target.closest('.chart-popover-wrapper') ||
                e.target.closest('.chart-popover-menu') ||
                e.target.closest('#plusActionMenu') ||
                e.target.closest('.chart-close-btn') ||
                e.target.closest('#drawingToolBanner') ||
                e.target.closest('#chartMobileToolHint') ||
                e.target.closest('.tool-cancel-btn') ||
                e.target.closest('#chartMobileFavBar') ||
                e.target.closest('#chartWebFavBar') ||
                e.target.closest('button')
            )) {
                return false;
            }

            const pt = getChartPointFromEvent(e);
            if (!pt || pt.price === null || isNaN(pt.price)) return false;

            if (e.cancelable) e.preventDefault();
            e.stopPropagation();

            mobileDrawSession = {
                startPt: pt,
                currentPt: pt,
                hasMoved: false,
                dragDistance: 0,
                startTime: performance.now(),
                initialPointsCount: drawingPoints.length,
                dragRaf: null
            };

            // If starting a 2-point or 3-point tool from scratch, establish anchor point 1 immediately
            if (drawingPoints.length === 0) {
                if (currentDrawingTool === 'trendline' || currentDrawingTool === 'rectangle' || currentDrawingTool === 'pricerange' || currentDrawingTool === 'fib' || currentDrawingTool === 'measure' || currentDrawingTool === 'parallelchannel' || currentDrawingTool === 'fibext') {
                    drawingPoints = [pt];
                    tempMousePos = pt;
                    redrawCanvasOverlay();
                }
            } else if (drawingPoints.length === 1 || drawingPoints.length === 2) {
                tempMousePos = pt;
                redrawCanvasOverlay();
            }

            return true;
        }

        function handleMobileDrawingTouchMove(e) {
            if (!mobileDrawSession || !currentDrawingTool) return;
            const isMobile = window.innerWidth <= 768 || (window.innerHeight <= 520 && window.innerWidth <= 1024);
            if (!isMobile) return;

            if (e.cancelable) e.preventDefault();
            e.stopPropagation();

            const pt = getChartPointFromEvent(e);
            if (!pt || pt.price === null || isNaN(pt.price)) return;

            const dist = Math.hypot(pt.x - mobileDrawSession.startPt.x, pt.y - mobileDrawSession.startPt.y);
            mobileDrawSession.currentPt = pt;
            mobileDrawSession.dragDistance = dist;

            if (dist >= 8) {
                mobileDrawSession.hasMoved = true;
            }

            tempMousePos = pt;

            if (!mobileDrawSession.dragRaf) {
                mobileDrawSession.dragRaf = requestAnimationFrame(() => {
                    if (mobileDrawSession) mobileDrawSession.dragRaf = null;
                    redrawCanvasOverlay();
                });
            }
        }

        function handleMobileDrawingTouchEnd(e) {
            if (!mobileDrawSession || !currentDrawingTool) return false;
            const isMobile = window.innerWidth <= 768 || (window.innerHeight <= 520 && window.innerWidth <= 1024);
            if (!isMobile) return false;

            if (e.cancelable) e.preventDefault();
            e.stopPropagation();

            if (mobileDrawSession.dragRaf) {
                cancelAnimationFrame(mobileDrawSession.dragRaf);
                mobileDrawSession.dragRaf = null;
            }

            const endPt = getChartPointFromEvent(e) || mobileDrawSession.currentPt || mobileDrawSession.startPt;
            const dist = mobileDrawSession.dragDistance;
            const hasMoved = mobileDrawSession.hasMoved && (dist >= 12);
            const initialCount = mobileDrawSession.initialPointsCount;
            const activeTool = currentDrawingTool;

            mobileDrawSession = null;
            mobileDrawJustFinished = true;
            setTimeout(() => { mobileDrawJustFinished = false; }, 350);

            if (!endPt || endPt.price === null || isNaN(endPt.price)) {
                redrawCanvasOverlay();
                return true;
            }

            // 1-Point Tools (Support Click, Resistance Click, Vertical, Note)
            if (activeTool === 'support_click') {
                addHorizontalLineAtPrice('support', parseFloat(endPt.price.toFixed(2)), '#731717', 'Support');
                showSupportAddedToast(parseFloat(endPt.price.toFixed(2)), '🟢 Support Line');
                cancelDrawingTool();
                return true;
            } else if (activeTool === 'resistance_click') {
                addHorizontalLineAtPrice('resistance', parseFloat(endPt.price.toFixed(2)), '#788325', 'Resistance');
                showSupportAddedToast(parseFloat(endPt.price.toFixed(2)), '🔴 Resistance Line');
                cancelDrawingTool();
                return true;
            } else if (activeTool === 'vertical') {
                if (endPt.logical === null || endPt.logical === undefined) return true;
                const shape = {
                    id: 'sh_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
                    type: 'vertical',
                    time: endPt.time,
                    logical: endPt.logical,
                    futureOffset: endPt.futureOffset || 0,
                    color: activeToolColor || '#f59e0b',
                    lineWidth: activeToolLineWidth || 2,
                    lineStyle: activeToolLineStyle || 'dashed'
                };
                saveChartShapeForSymbol(currentChartSymbol, shape);
                cancelDrawingTool();
                return true;
            } else if (activeTool === 'note') {
                if (endPt.logical === null || endPt.logical === undefined) return true;
                (async () => {
                    const noteText = await showCustomPrompt({ title: 'Add Chart Note', message: 'Enter text for chart note:', defaultValue: 'Key Support / Target', placeholder: 'e.g. Breakout level' });
                    if (noteText) {
                        const shape = {
                            id: 'sh_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
                            type: 'note',
                            time: endPt.time,
                            logical: endPt.logical,
                            futureOffset: endPt.futureOffset || 0,
                            price: endPt.price,
                            text: noteText,
                            color: activeToolColor || '#10b981'
                        };
                        saveChartShapeForSymbol(currentChartSymbol, shape);
                    }
                    cancelDrawingTool();
                })();
                return true;
            }

            // 2-Point Tools: Trendline, Rectangle, Price Range %, Fib Retracement, Measure
            if (activeTool === 'trendline' || activeTool === 'rectangle' || activeTool === 'pricerange' || activeTool === 'fib' || activeTool === 'measure') {
                if (hasMoved || initialCount === 1) {
                    const pt1 = (drawingPoints.length > 0) ? drawingPoints[0] : endPt;
                    const pt2 = endPt;

                    if (pt1.logical === null || pt2.logical === null) return true;

                    if (activeTool === 'measure') {
                        tempMeasureData = {
                            type: 'measure',
                            time1: pt1.time,
                            logical1: pt1.logical,
                            futureOffset1: pt1.futureOffset || 0,
                            price1: pt1.price,
                            time2: pt2.time,
                            logical2: pt2.logical,
                            futureOffset2: pt2.futureOffset || 0,
                            price2: pt2.price,
                            color: activeToolColor || '#3b82f6',
                            createdAt: performance.now(),
                            opacity: 1.0
                        };
                        cancelDrawingTool();
                        startTempMeasureFade();
                        return true;
                    }

                    const shape = {
                        id: 'sh_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
                        type: activeTool,
                        timeframe: currentChartInterval,
                        time1: pt1.time,
                        logical1: pt1.logical,
                        futureOffset1: pt1.futureOffset || 0,
                        futureTime1: pt1.futureTime || null,
                        price1: pt1.price,
                        time2: pt2.time,
                        logical2: pt2.logical,
                        futureOffset2: pt2.futureOffset || 0,
                        futureTime2: pt2.futureTime || null,
                        price2: pt2.price,
                        color: (activeTool === 'trendline') ? ((activeToolColor && activeToolColor !== '#10b981' && activeToolColor !== '#731717' && activeToolColor !== '#788325' && activeToolColor !== '#0b845c') ? activeToolColor : getLastTrendlineColor()) : (activeToolColor || '#10b981'),
                        fillColor: activeTool === 'rectangle' ? hexToRgba(activeToolColor || '#a855f7', 0.18) : null,
                        lineWidth: activeToolLineWidth || 2,
                        lineStyle: activeToolLineStyle || 'solid',
                        fontSize: getLastDrawingFontSize(),
                        textColor: getLastDrawingTextColor(),
                        textPos: getLastDrawingTextPos(),
                        textValign: getLastDrawingTextValign()
                    };

                    if (activeTool === 'trendline') {
                        setLastTrendlineColor(shape.color);
                    }
                    saveChartShapeForSymbol(currentChartSymbol, shape);
                    cancelDrawingTool();
                    return true;
                } else {
                    // Tap point 1
                    drawingPoints = [endPt];
                    tempMousePos = null;
                    const mobileHintText = document.getElementById('chartMobileToolHintText');
                    if (mobileHintText) {
                        mobileHintText.innerText = (activeTool === 'measure') ? '📐 Tap or drag 2nd point to measure' : '📈 Tap or drag 2nd point to finish';
                    }
                    redrawCanvasOverlay();
                    return true;
                }
            }

            // 3-Point Tools: Parallel Channel, Trend Fib Extension
            if (activeTool === 'parallelchannel' || activeTool === 'fibext') {
                if (initialCount === 0) {
                    if (hasMoved) {
                        // Dragged stroke 1: baseline created
                        const pt1 = drawingPoints[0] || endPt;
                        const pt2 = endPt;
                        drawingPoints = [pt1, pt2];
                        tempMousePos = null;
                        const mobileHintText = document.getElementById('chartMobileToolHintText');
                        if (mobileHintText) {
                            mobileHintText.innerText = (activeTool === 'parallelchannel') ? '⛓️ Drag or tap to set channel width' : '🎯 Drag or tap Wave 2 (3rd point)';
                        }
                        redrawCanvasOverlay();
                        return true;
                    } else {
                        // Tapped point 1
                        drawingPoints = [endPt];
                        tempMousePos = null;
                        const mobileHintText = document.getElementById('chartMobileToolHintText');
                        if (mobileHintText) {
                            mobileHintText.innerText = (activeTool === 'parallelchannel') ? '⛓️ Tap or drag 2nd point of baseline' : '🎯 Tap or drag Wave 1 end';
                        }
                        redrawCanvasOverlay();
                        return true;
                    }
                } else if (initialCount === 1) {
                    // Setting point 2
                    const pt1 = drawingPoints[0];
                    const pt2 = endPt;
                    drawingPoints = [pt1, pt2];
                    tempMousePos = null;
                    const mobileHintText = document.getElementById('chartMobileToolHintText');
                    if (mobileHintText) {
                        mobileHintText.innerText = (activeTool === 'parallelchannel') ? '⛓️ Drag or tap to set channel width' : '🎯 Drag or tap Wave 2 (3rd point)';
                    }
                    redrawCanvasOverlay();
                    return true;
                } else if (initialCount === 2) {
                    // Setting point 3 -> finalize
                    const pt1 = drawingPoints[0];
                    const pt2 = drawingPoints[1];
                    const pt3 = endPt;

                    const shape = {
                        id: 'sh_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
                        type: activeTool,
                        time1: pt1.time,
                        logical1: pt1.logical,
                        futureOffset1: pt1.futureOffset || 0,
                        price1: pt1.price,
                        time2: pt2.time,
                        logical2: pt2.logical,
                        futureOffset2: pt2.futureOffset || 0,
                        price2: pt2.price,
                        time3: pt3.time,
                        logical3: pt3.logical,
                        futureOffset3: pt3.futureOffset || 0,
                        price3: pt3.price,
                        color: activeToolColor || (activeTool === 'parallelchannel' ? '#3b82f6' : '#a855f7'),
                        fillColor: (activeTool === 'parallelchannel') ? hexToRgba(activeToolColor || '#3b82f6', 0.12) : null,
                        lineWidth: activeToolLineWidth || 2,
                        lineStyle: activeToolLineStyle || 'solid'
                    };

                    saveChartShapeForSymbol(currentChartSymbol, shape);
                    cancelDrawingTool();
                    return true;
                }
            }

            return true;
        }

        function handleMobileDrawingTouchCancel(e) {
            if (mobileDrawSession) {
                if (mobileDrawSession.dragRaf) {
                    cancelAnimationFrame(mobileDrawSession.dragRaf);
                }
                mobileDrawSession = null;
                redrawCanvasOverlay();
            }
        }

        function onChartTouchStart(e) {
            const isMobile = window.innerWidth <= 768 || (window.innerHeight <= 520 && window.innerWidth <= 1024);
            if (isMobile && currentDrawingTool) {
                const handled = handleMobileDrawingTouchStart(e);
                if (handled) return;
            }
            handleChartPaneMouseDown(e);
        }

        function onChartTouchMove(e) {
            const isMobile = window.innerWidth <= 768 || (window.innerHeight <= 520 && window.innerWidth <= 1024);
            if (isMobile && currentDrawingTool && mobileDrawSession) {
                handleMobileDrawingTouchMove(e);
            }
        }

        function onChartTouchEnd(e) {
            const isMobile = window.innerWidth <= 768 || (window.innerHeight <= 520 && window.innerWidth <= 1024);
            if (isMobile && currentDrawingTool && mobileDrawSession) {
                const handled = handleMobileDrawingTouchEnd(e);
                if (handled) return;
            }
            handleChartPaneTouchEnd(e);
        }

        function onChartTouchCancel(e) {
            handleMobileDrawingTouchCancel(e);
        }

        function handleChartPaneClick(e) {
            if (e.target && e.target.closest && (e.target.closest('#drawingToolBanner') || e.target.closest('#chartMobileToolHint') || e.target.closest('.tool-cancel-btn') || e.target.closest('button'))) {
                return;
            }
            const isMobile = window.innerWidth <= 768 || (window.innerHeight <= 520 && window.innerWidth <= 1024);
            if (isMobile && mobileDrawJustFinished) {
                mobileDrawJustFinished = false;
                return;
            }
            if (!currentDrawingTool) return;
            handleCanvasClick(e);
        }

        function handleChartPaneTouchEnd(e) {
            if (e.target && e.target.closest && (e.target.closest('#drawingToolBanner') || e.target.closest('#chartMobileToolHint') || e.target.closest('.tool-cancel-btn') || e.target.closest('button'))) {
                return;
            }
            const isMobile = window.innerWidth <= 768 || (window.innerHeight <= 520 && window.innerWidth <= 1024);
            if (isMobile && mobileDrawJustFinished) {
                mobileDrawJustFinished = false;
                return;
            }
            if (!currentDrawingTool) return;
            e.preventDefault();
            handleCanvasClick(e);
        }

        async function handleCanvasClick(e) {
            const pt = getChartPointFromEvent(e);
            if (!pt) return;

            // If a drawing tool is active:
            if (currentDrawingTool) {
                if (pt.price === null || pt.price === undefined) return;

                if (currentDrawingTool === 'support_click') {
                    addHorizontalLineAtPrice('support', parseFloat(pt.price.toFixed(2)), '#731717', 'Support');
                    showSupportAddedToast(parseFloat(pt.price.toFixed(2)), '🟢 Support Line');
                    cancelDrawingTool();
                    return;
                } else if (currentDrawingTool === 'resistance_click') {
                    addHorizontalLineAtPrice('resistance', parseFloat(pt.price.toFixed(2)), '#788325', 'Resistance');
                    showSupportAddedToast(parseFloat(pt.price.toFixed(2)), '🔴 Resistance Line');
                    cancelDrawingTool();
                    return;
                } else if (currentDrawingTool === 'vertical') {
                    if (pt.logical === null || pt.logical === undefined) return;
                    const shape = {
                        id: 'sh_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
                        type: 'vertical',
                        time: pt.time,
                        logical: pt.logical,
                        futureOffset: pt.futureOffset || 0,
                        color: activeToolColor || '#f59e0b',
                        lineWidth: activeToolLineWidth || 2,
                        lineStyle: activeToolLineStyle || 'dashed'
                    };
                    saveChartShapeForSymbol(currentChartSymbol, shape);
                    cancelDrawingTool();
                    return;
                } else if (currentDrawingTool === 'note') {
                    if (pt.logical === null || pt.logical === undefined) return;
                    const noteText = await showCustomPrompt({ title: 'Add Chart Note', message: 'Enter text for chart note:', defaultValue: 'Key Support / Target', placeholder: 'e.g. Breakout level' });
                    if (noteText) {
                        const shape = {
                            id: 'sh_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
                            type: 'note',
                            time: pt.time,
                            logical: pt.logical,
                            futureOffset: pt.futureOffset || 0,
                            price: pt.price,
                            text: noteText,
                            color: activeToolColor || '#10b981'
                        };
                        saveChartShapeForSymbol(currentChartSymbol, shape);
                    }
                    cancelDrawingTool();
                    return;
                } else if (currentDrawingTool === 'trendline' || currentDrawingTool === 'rectangle' || currentDrawingTool === 'pricerange' || currentDrawingTool === 'fib' || currentDrawingTool === 'measure') {
                    if (pt.logical === null || pt.logical === undefined) return;
                    if (drawingPoints.length === 0) {
                        drawingPoints.push(pt);
                        const banner = document.getElementById('drawingToolBanner');
                        if (banner) {
                            const span = banner.querySelector('.drawing-banner-msg') || banner.querySelector('span');
                            if (span) span.innerText = (currentDrawingTool === 'measure') ? 'Click 2nd point to measure' : 'Click 2nd point to finish';
                        }
                        const mobileHintText = document.getElementById('chartMobileToolHintText');
                        if (mobileHintText) {
                            mobileHintText.innerText = (currentDrawingTool === 'measure') ? 'Tap 2nd point to measure' : 'Tap 2nd point to finish';
                        }
                    } else {
                        const pt1 = drawingPoints[0];
                        const pt2 = pt;

                        if (currentDrawingTool === 'measure') {
                            tempMeasureData = {
                                type: 'measure',
                                time1: pt1.time,
                                logical1: pt1.logical,
                                futureOffset1: pt1.futureOffset || 0,
                                price1: pt1.price,
                                time2: pt2.time,
                                logical2: pt2.logical,
                                futureOffset2: pt2.futureOffset || 0,
                                price2: pt2.price,
                                color: activeToolColor || '#3b82f6',
                                createdAt: performance.now(),
                                opacity: 1.0
                            };
                            cancelDrawingTool();
                            startTempMeasureFade();
                            return;
                        }

                        const shape = {
                            id: 'sh_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
                            type: currentDrawingTool,
                            timeframe: currentChartInterval,
                            time1: pt1.time,
                            logical1: pt1.logical,
                            futureOffset1: pt1.futureOffset || 0,
                            futureTime1: pt1.futureTime || null,
                            price1: pt1.price,
                            time2: pt2.time,
                            logical2: pt2.logical,
                            futureOffset2: pt2.futureOffset || 0,
                            futureTime2: pt2.futureTime || null,
                            price2: pt2.price,
                            color: (currentDrawingTool === 'trendline') ? ((activeToolColor && activeToolColor !== '#10b981' && activeToolColor !== '#731717' && activeToolColor !== '#788325' && activeToolColor !== '#0b845c') ? activeToolColor : getLastTrendlineColor()) : (activeToolColor || '#10b981'),
                            fillColor: currentDrawingTool === 'rectangle' ? hexToRgba(activeToolColor || '#a855f7', 0.18) : null,
                            lineWidth: activeToolLineWidth || 2,
                            lineStyle: activeToolLineStyle || 'solid',
                            fontSize: getLastDrawingFontSize(),
                            textColor: getLastDrawingTextColor(),
                            textPos: getLastDrawingTextPos(),
                            textValign: getLastDrawingTextValign()
                        };

                        if (currentDrawingTool === 'trendline') {
                            setLastTrendlineColor(shape.color);
                        }
                        saveChartShapeForSymbol(currentChartSymbol, shape);
                        cancelDrawingTool();
                    }
                    return;
                } else if (currentDrawingTool === 'parallelchannel' || currentDrawingTool === 'fibext') {
                    if (pt.logical === null || pt.logical === undefined) return;
                    if (drawingPoints.length === 0) {
                        drawingPoints.push(pt);
                        const banner = document.getElementById('drawingToolBanner');
                        if (banner) {
                            const span = banner.querySelector('.drawing-banner-msg') || banner.querySelector('span');
                            if (span) span.innerText = (currentDrawingTool === 'parallelchannel') ? 'Click 2nd point to set baseline' : 'Click 2nd point (Wave 1 end)';
                        }
                        const mobileHintText = document.getElementById('chartMobileToolHintText');
                        if (mobileHintText) {
                            mobileHintText.innerText = (currentDrawingTool === 'parallelchannel') ? 'Tap 2nd point to set baseline' : 'Tap 2nd point (Wave 1 end)';
                        }
                    } else if (drawingPoints.length === 1) {
                        drawingPoints.push(pt);
                        const banner = document.getElementById('drawingToolBanner');
                        if (banner) {
                            const span = banner.querySelector('.drawing-banner-msg') || banner.querySelector('span');
                            if (span) span.innerText = (currentDrawingTool === 'parallelchannel') ? 'Click 3rd point to set channel width' : 'Click 3rd point (Wave 2 retracement)';
                        }
                        const mobileHintText = document.getElementById('chartMobileToolHintText');
                        if (mobileHintText) {
                            mobileHintText.innerText = (currentDrawingTool === 'parallelchannel') ? 'Tap 3rd point to set width' : 'Tap 3rd point (Wave 2 retracement)';
                        }
                    } else {
                        const pt1 = drawingPoints[0];
                        const pt2 = drawingPoints[1];
                        const pt3 = pt;

                        const shape = {
                            id: 'sh_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
                            type: currentDrawingTool,
                            timeframe: currentChartInterval,
                            time1: pt1.time,
                            logical1: pt1.logical,
                            futureOffset1: pt1.futureOffset || 0,
                            futureTime1: pt1.futureTime || null,
                            price1: pt1.price,
                            time2: pt2.time,
                            logical2: pt2.logical,
                            futureOffset2: pt2.futureOffset || 0,
                            futureTime2: pt2.futureTime || null,
                            price2: pt2.price,
                            time3: pt3.time,
                            logical3: pt3.logical,
                            futureOffset3: pt3.futureOffset || 0,
                            futureTime3: pt3.futureTime || null,
                            price3: pt3.price,
                            color: activeToolColor || (currentDrawingTool === 'parallelchannel' ? '#3b82f6' : '#a855f7'),
                            fillColor: (currentDrawingTool === 'parallelchannel') ? hexToRgba(activeToolColor || '#3b82f6', 0.12) : null,
                            lineWidth: activeToolLineWidth || 2,
                            lineStyle: activeToolLineStyle || 'solid'
                        };

                        saveChartShapeForSymbol(currentChartSymbol, shape);
                        cancelDrawingTool();
                    }
                    return;
                }
            }

            // Normal Mode: dismiss temporary measure or popup when clicking empty space
            if (tempMeasureData) {
                clearTempMeasure();
                redrawCanvasOverlay();
                return;
            }
            if (!findShapeOrLineAtPoint(pt.x, pt.y)) {
                hideCanvasObjectMenu();
            }
        }

        function findShapeOrLineAtPoint(x, y) {
            if (!mainChart || !mainSeries) return null;
            const timeScale = mainChart.timeScale();

            // Check price lines first (horizontal lines: hover/drag changes price)
            const lines = getSavedPriceLines(currentChartSymbol);
            for (let l of lines) {
                if (l.hidden) continue;
                const lineY = mainSeries.priceToCoordinate(l.price);
                if (lineY !== null && (Math.abs(y - lineY) < 10 || (x >= 6 && x <= 160 && Math.abs(y - lineY) <= 12))) {
                    const isLocked = !!l.locked;
                    return { kind: 'line', id: l.id, name: `${l.label || 'Line'}: ₹${l.price}`, color: l.color, hidden: !!l.hidden, locked: isLocked, price: l.price, subPart: 'body', cursor: isLocked ? 'pointer' : 'ns-resize' };
                }
            }

            // Check shapes
            const shapes = getSavedChartShapes(currentChartSymbol);
            for (let s of shapes) {
                if (s.hidden) continue;
                const isLocked = !!s.locked;
                if (s.type === 'vertical') {
                    const shapeX = getShapeX(timeScale, s.time, s.logical, s.futureOffset, s.futureTime, s.timeframe);
                    if (shapeX !== null && Math.abs(x - shapeX) < 10) {
                        return { kind: 'shape', id: s.id, name: 'Time Line', color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'body', cursor: isLocked ? 'pointer' : 'ew-resize' };
                    }
                } else if (s.type === 'note') {
                    const shapeX = getShapeX(timeScale, s.time, s.logical, s.futureOffset, s.futureTime, s.timeframe);
                    const shapeY = mainSeries.priceToCoordinate(s.price);
                    if (shapeX !== null && shapeY !== null && Math.abs(x - shapeX) < 35 && Math.abs(y - shapeY) < 22) {
                        return { kind: 'shape', id: s.id, name: `Note: ${s.text}`, color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'body', cursor: isLocked ? 'pointer' : 'grab' };
                    }
                } else if (s.type === 'trendline') {
                    const x1 = getShapeX(timeScale, s.time1, s.logical1, s.futureOffset1, s.futureTime1, s.timeframe);
                    const y1 = mainSeries.priceToCoordinate(s.price1);
                    const x2 = getShapeX(timeScale, s.time2, s.logical2, s.futureOffset2, s.futureTime2, s.timeframe);
                    const y2 = mainSeries.priceToCoordinate(s.price2);
                    if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
                        const d1 = Math.hypot(x - x1, y - y1);
                        const d2 = Math.hypot(x - x2, y - y2);
                        if (d1 <= 12) {
                            return { kind: 'shape', id: s.id, name: 'Trendline', color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'p1', cursor: isLocked ? 'pointer' : 'crosshair' };
                        }
                        if (d2 <= 12) {
                            return { kind: 'shape', id: s.id, name: 'Trendline', color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'p2', cursor: isLocked ? 'pointer' : 'crosshair' };
                        }
                        const dist = distanceToSegment(x, y, x1, y1, x2, y2);
                        if (dist < 10) {
                            return { kind: 'shape', id: s.id, name: 'Trendline', color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'body', cursor: isLocked ? 'pointer' : 'grab' };
                        }
                    }
                } else if (s.type === 'rectangle' || s.type === 'pricerange') {
                    const x1 = getShapeX(timeScale, s.time1, s.logical1, s.futureOffset1, s.futureTime1, s.timeframe);
                    const y1 = mainSeries.priceToCoordinate(s.price1);
                    const x2 = getShapeX(timeScale, s.time2 || s.time1, s.logical2 !== undefined ? s.logical2 : s.logical1, s.futureOffset2 || 0, s.futureTime2, s.timeframe);
                    const y2 = mainSeries.priceToCoordinate(s.price2);
                    if (x1 !== null && y1 !== null && y2 !== null) {
                        let startX = x1, endX = (x2 !== null) ? x2 : x1;
                        if (s.type === 'pricerange' && Math.abs(endX - startX) < 20) {
                            startX = x1 - 25;
                            endX = x1 + 25;
                        }
                        const minX = Math.min(startX, endX);
                        const maxX = Math.max(startX, endX);
                        const topY = Math.min(y1, y2);
                        const bottomY = Math.max(y1, y2);

                        let name = 'Rectangle Zone';
                        if (s.type === 'pricerange') {
                            const diff = s.price2 - s.price1;
                            const pct = (s.price1 !== 0) ? (diff / Math.abs(s.price1)) * 100 : 0;
                            const sign = diff >= 0 ? '+' : '-';
                            name = `Price Range: ${sign}₹${Math.abs(diff).toFixed(2)} (${sign}${Math.abs(pct).toFixed(2)}%)`;
                        }

                        // 1. Check corners first (for precision resize)
                        const C_PAD = 14;
                        if (Math.hypot(x - minX, y - topY) <= C_PAD) {
                            return { kind: 'shape', id: s.id, name, color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'corner-top-left', cursor: isLocked ? 'pointer' : 'nwse-resize' };
                        }
                        if (Math.hypot(x - maxX, y - topY) <= C_PAD) {
                            return { kind: 'shape', id: s.id, name, color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'corner-top-right', cursor: isLocked ? 'pointer' : 'nesw-resize' };
                        }
                        if (Math.hypot(x - minX, y - bottomY) <= C_PAD) {
                            return { kind: 'shape', id: s.id, name, color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'corner-bottom-left', cursor: isLocked ? 'pointer' : 'nesw-resize' };
                        }
                        if (Math.hypot(x - maxX, y - bottomY) <= C_PAD) {
                            return { kind: 'shape', id: s.id, name, color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'corner-bottom-right', cursor: isLocked ? 'pointer' : 'nwse-resize' };
                        }

                        // 2. Check borders (edges for resizing boundaries)
                        const B_PAD = 9;
                        if (Math.abs(y - topY) <= B_PAD && x >= minX - B_PAD && x <= maxX + B_PAD) {
                            return { kind: 'shape', id: s.id, name, color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'border-top', cursor: isLocked ? 'pointer' : 'ns-resize' };
                        }
                        if (Math.abs(y - bottomY) <= B_PAD && x >= minX - B_PAD && x <= maxX + B_PAD) {
                            return { kind: 'shape', id: s.id, name, color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'border-bottom', cursor: isLocked ? 'pointer' : 'ns-resize' };
                        }
                        if (Math.abs(x - minX) <= B_PAD && y >= topY - B_PAD && y <= bottomY + B_PAD) {
                            return { kind: 'shape', id: s.id, name, color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'border-left', cursor: isLocked ? 'pointer' : 'ew-resize' };
                        }
                        if (Math.abs(x - maxX) <= B_PAD && y >= topY - B_PAD && y <= bottomY + B_PAD) {
                            return { kind: 'shape', id: s.id, name, color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'border-right', cursor: isLocked ? 'pointer' : 'ew-resize' };
                        }

                        // 3. Interior is the body (strictly for moving the whole drawing)
                        if (x > minX && x < maxX && y > topY && y < bottomY) {
                            return { kind: 'shape', id: s.id, name, color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'body', cursor: isLocked ? 'pointer' : 'grab' };
                        }
                    }
                } else if (s.type === 'fib') {
                    const x1 = getShapeX(timeScale, s.time1, s.logical1, s.futureOffset1, s.futureTime1, s.timeframe);
                    const y1 = mainSeries.priceToCoordinate(s.price1);
                    const x2 = getShapeX(timeScale, s.time2 || s.time1, s.logical2 !== undefined ? s.logical2 : s.logical1, s.futureOffset2 || 0, s.futureTime2, s.timeframe);
                    const y2 = mainSeries.priceToCoordinate(s.price2);
                    if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
                        const d1 = Math.hypot(x - x1, y - y1);
                        const d2 = Math.hypot(x - x2, y - y2);
                        if (d1 <= 12) {
                            return { kind: 'shape', id: s.id, name: 'Fib Retracement', color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'p1', cursor: isLocked ? 'pointer' : 'crosshair' };
                        }
                        if (d2 <= 12) {
                            return { kind: 'shape', id: s.id, name: 'Fib Retracement', color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'p2', cursor: isLocked ? 'pointer' : 'crosshair' };
                        }
                        const dist = distanceToSegment(x, y, x1, y1, x2, y2);
                        const minX = Math.min(x1, x2) - 15, maxX = Math.max(x1, x2) + 90;
                        const minY = Math.min(y1, y2) - 20, maxY = Math.max(y1, y2) + 20;
                        if (dist < 12 || (x >= minX && x <= maxX && y >= minY && y <= maxY)) {
                            return { kind: 'shape', id: s.id, name: 'Fib Retracement', color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'body', cursor: isLocked ? 'pointer' : 'grab' };
                        }
                    }
                } else if (s.type === 'parallelchannel') {
                    const x1 = getShapeX(timeScale, s.time1, s.logical1, s.futureOffset1, s.futureTime1, s.timeframe);
                    const y1 = mainSeries.priceToCoordinate(s.price1);
                    const x2 = getShapeX(timeScale, s.time2 || s.time1, s.logical2 !== undefined ? s.logical2 : s.logical1, s.futureOffset2 || 0, s.futureTime2, s.timeframe);
                    const y2 = mainSeries.priceToCoordinate(s.price2);
                    const x3 = (s.time3 !== undefined || s.logical3 !== undefined) ? getShapeX(timeScale, s.time3 || s.time2, s.logical3 !== undefined ? s.logical3 : s.logical2, s.futureOffset3 || 0, s.futureTime3, s.timeframe) : null;
                    const y3 = (s.price3 !== undefined) ? mainSeries.priceToCoordinate(s.price3) : null;
                    if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
                        let dy = 0;
                        if (x3 !== null && y3 !== null) {
                            const baseLineYAtX3 = (x2 !== x1) ? (y1 + (y2 - y1) * ((x3 - x1) / (x2 - x1))) : y1;
                            dy = y3 - baseLineYAtX3;
                        }
                        // Check anchor handles
                        if (Math.hypot(x - x1, y - y1) <= 12) {
                            return { kind: 'shape', id: s.id, name: 'Parallel Channel', color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'p1', cursor: isLocked ? 'pointer' : 'crosshair' };
                        }
                        if (Math.hypot(x - x2, y - y2) <= 12) {
                            return { kind: 'shape', id: s.id, name: 'Parallel Channel', color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'p2', cursor: isLocked ? 'pointer' : 'crosshair' };
                        }
                        // Check parallel handle and parallel line (border)
                        const midX = (x1 + x2) / 2;
                        const midY = (y1 + y2) / 2 + dy;
                        if (Math.hypot(x - midX, y - midY) <= 12) {
                            return { kind: 'shape', id: s.id, name: 'Parallel Channel', color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'parallel', cursor: isLocked ? 'pointer' : 'ns-resize' };
                        }
                        const dist2 = distanceToSegment(x, y, x1, y1 + dy, x2, y2 + dy);
                        if (dist2 <= 8) {
                            return { kind: 'shape', id: s.id, name: 'Parallel Channel', color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'parallel', cursor: isLocked ? 'pointer' : 'ns-resize' };
                        }
                        // Check baseline
                        const dist1 = distanceToSegment(x, y, x1, y1, x2, y2);
                        if (dist1 <= 8) {
                            const d1 = Math.hypot(x - x1, y - y1);
                            const d2 = Math.hypot(x - x2, y - y2);
                            return { kind: 'shape', id: s.id, name: 'Parallel Channel', color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: (d1 < d2 ? 'p1' : 'p2'), cursor: isLocked ? 'pointer' : 'crosshair' };
                        }
                        // Interior check for body
                        const minX = Math.min(x1, x2) - 5, maxX = Math.max(x1, x2) + 5;
                        const minY = Math.min(y1, y2, y1 + dy, y2 + dy) - 5, maxY = Math.max(y1, y2, y1 + dy, y2 + dy) + 5;
                        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
                            return { kind: 'shape', id: s.id, name: 'Parallel Channel', color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'body', cursor: isLocked ? 'pointer' : 'grab' };
                        }
                    }
                } else if (s.type === 'fibext') {
                    const x1 = getShapeX(timeScale, s.time1, s.logical1, s.futureOffset1, s.futureTime1, s.timeframe);
                    const y1 = mainSeries.priceToCoordinate(s.price1);
                    const x2 = getShapeX(timeScale, s.time2 || s.time1, s.logical2 !== undefined ? s.logical2 : s.logical1, s.futureOffset2 || 0, s.futureTime2, s.timeframe);
                    const y2 = mainSeries.priceToCoordinate(s.price2);
                    const x3 = (s.time3 !== undefined || s.logical3 !== undefined) ? getShapeX(timeScale, s.time3 || s.time2, s.logical3 !== undefined ? s.logical3 : s.logical2, s.futureOffset3 || 0, s.futureTime3, s.timeframe) : null;
                    const y3 = (s.price3 !== undefined) ? mainSeries.priceToCoordinate(s.price3) : null;
                    if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
                        if (Math.hypot(x - x1, y - y1) <= 12) {
                            return { kind: 'shape', id: s.id, name: 'Trend Fib Extension', color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'p1', cursor: isLocked ? 'pointer' : 'crosshair' };
                        }
                        if (Math.hypot(x - x2, y - y2) <= 12) {
                            return { kind: 'shape', id: s.id, name: 'Trend Fib Extension', color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'p2', cursor: isLocked ? 'pointer' : 'crosshair' };
                        }
                        if (x3 !== null && y3 !== null && Math.hypot(x - x3, y - y3) <= 12) {
                            return { kind: 'shape', id: s.id, name: 'Trend Fib Extension', color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'p3', cursor: isLocked ? 'pointer' : 'crosshair' };
                        }
                        const dist1 = distanceToSegment(x, y, x1, y1, x2, y2);
                        let dist2 = 999;
                        if (x3 !== null && y3 !== null) dist2 = distanceToSegment(x, y, x2, y2, x3, y3);
                        const minX = Math.min(x1, x2, x3 || x2) - 15, maxX = Math.max(x1, x2, x3 || x2) + 160;
                        const minY = Math.min(y1, y2, y3 || y2) - 30, maxY = Math.max(y1, y2, y3 || y2) + 30;
                        if (dist1 < 10 || dist2 < 10 || (x >= minX && x <= maxX && y >= minY && y <= maxY)) {
                            return { kind: 'shape', id: s.id, name: 'Trend Fib Extension', color: s.color, hidden: !!s.hidden, locked: isLocked, type: s.type, subPart: 'body', cursor: isLocked ? 'pointer' : 'grab' };
                        }
                    }
                }
            }
            return null;
        }

        function distanceToSegment(px, py, x1, y1, x2, y2) {
            const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
            if (l2 === 0) return Math.hypot(px - x1, py - y1);
            let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
            t = Math.max(0, Math.min(1, t));
            return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
        }

        function makeCanvasPopupDraggable(popup, handle) {
            if (!popup || !handle || handle.dataset.dragBound) return;
            handle.dataset.dragBound = '1';

            function onStart(e) {
                if (e.type === 'mousedown' && e.button !== 0) return;
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                const startX = clientX;
                const startY = clientY;
                const initialLeft = popup.offsetLeft;
                const initialTop = popup.offsetTop;
                const mainContainer = document.getElementById('mainChartPane');

                handle.style.cursor = 'grabbing';
                document.body.style.userSelect = 'none';

                function onMove(ev) {
                    const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
                    const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
                    const dx = cx - startX;
                    const dy = cy - startY;
                    const maxW = (mainContainer ? mainContainer.clientWidth : window.innerWidth) - popup.offsetWidth - 8;
                    const maxH = (mainContainer ? mainContainer.clientHeight : window.innerHeight) - popup.offsetHeight - 8;
                    popup.style.left = Math.max(6, Math.min(initialLeft + dx, maxW)) + 'px';
                    popup.style.top = Math.max(6, Math.min(initialTop + dy, maxH)) + 'px';
                    if (ev.cancelable) ev.preventDefault();
                }

                function onEnd() {
                    handle.style.cursor = 'grab';
                    document.body.style.userSelect = '';
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onEnd);
                    window.removeEventListener('touchmove', onMove);
                    window.removeEventListener('touchend', onEnd);
                }

                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onEnd);
                window.addEventListener('touchmove', onMove, { passive: false });
                window.addEventListener('touchend', onEnd);

                e.preventDefault();
                e.stopPropagation();
            }

            handle.addEventListener('mousedown', onStart);
            handle.addEventListener('touchstart', onStart, { passive: false });
        }

        function toggleCanvasObjWidthMenu(event) {
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }
            const widthMenu = document.getElementById('canvasObjWidthMenu');
            const styleMenu = document.getElementById('canvasObjStyleMenu');
            const moreMenu = document.getElementById('canvasObjMoreMenu');
            if (styleMenu) styleMenu.style.display = 'none';
            if (moreMenu) moreMenu.style.display = 'none';
            if (!widthMenu) return;
            widthMenu.style.display = (widthMenu.style.display === 'flex') ? 'none' : 'flex';
        }
        window.toggleCanvasObjWidthMenu = toggleCanvasObjWidthMenu;

        function toggleCanvasObjStyleMenu(event) {
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }
            const widthMenu = document.getElementById('canvasObjWidthMenu');
            const styleMenu = document.getElementById('canvasObjStyleMenu');
            const moreMenu = document.getElementById('canvasObjMoreMenu');
            if (widthMenu) widthMenu.style.display = 'none';
            if (moreMenu) moreMenu.style.display = 'none';
            if (!styleMenu) return;
            styleMenu.style.display = (styleMenu.style.display === 'flex') ? 'none' : 'flex';
        }
        window.toggleCanvasObjStyleMenu = toggleCanvasObjStyleMenu;

        function toggleCanvasObjectMoreMenu(event) {
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }
            const widthMenu = document.getElementById('canvasObjWidthMenu');
            const styleMenu = document.getElementById('canvasObjStyleMenu');
            const moreMenu = document.getElementById('canvasObjMoreMenu');
            if (widthMenu) widthMenu.style.display = 'none';
            if (styleMenu) styleMenu.style.display = 'none';
            if (!moreMenu) return;
            moreMenu.style.display = (moreMenu.style.display === 'flex') ? 'none' : 'flex';
        }
        window.toggleCanvasObjectMoreMenu = toggleCanvasObjectMoreMenu;

        function setCanvasObjectLineWidth(width, event) {
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }
            const widthMenu = document.getElementById('canvasObjWidthMenu');
            if (widthMenu) widthMenu.style.display = 'none';

            activeToolLineWidth = width;

            const popup = document.getElementById('canvasObjectPopup');
            if (!popup || !popup.dataset.activeObjId) return;
            const objId = popup.dataset.activeObjId;
            const objKind = popup.dataset.activeObjKind;

            if (objKind === 'line') {
                const lines = getSavedPriceLines(currentChartSymbol);
                const line = lines.find(l => l.id === objId);
                if (line) {
                    line.lineWidth = width;
                    persistLinesForSymbol(currentChartSymbol, lines);
                    const pl = activePriceLines.find(p => p.id === objId);
                    if (pl) {
                        pl.data.lineWidth = width;
                        if (pl.lineObj) {
                            pl.lineObj.applyOptions({ lineWidth: width });
                        }
                    }
                }
            } else {
                const shapes = getSavedChartShapes(currentChartSymbol);
                const shape = shapes.find(s => s.id === objId);
                if (shape) {
                    shape.lineWidth = width;
                    persistShapesForSymbol(currentChartSymbol, shapes);
                    redrawCanvasOverlay();
                }
            }

            // Update width button UI in popup
            const widthBtn = popup.querySelector('.canvas-obj-width-btn');
            if (widthBtn) {
                const prev = widthBtn.querySelector('.canvas-obj-width-preview');
                if (prev) prev.style.height = `${width}px`;
                const lbl = widthBtn.querySelector('.canvas-obj-width-label');
                if (lbl) lbl.innerText = `${width}px`;
                widthBtn.title = `Line Width (${width}px)`;
            }
            if (widthMenu) {
                widthMenu.querySelectorAll('.canvas-obj-dropdown-item').forEach((item, idx) => {
                    item.classList.toggle('active', (idx + 1) === width);
                });
            }
        }
        window.setCanvasObjectLineWidth = setCanvasObjectLineWidth;

        function setCanvasObjectLineStyle(style, event) {
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }
            const styleMenu = document.getElementById('canvasObjStyleMenu');
            if (styleMenu) styleMenu.style.display = 'none';

            activeToolLineStyle = style;

            const popup = document.getElementById('canvasObjectPopup');
            if (!popup || !popup.dataset.activeObjId) return;
            const objId = popup.dataset.activeObjId;
            const objKind = popup.dataset.activeObjKind;

            if (objKind === 'line') {
                const lines = getSavedPriceLines(currentChartSymbol);
                const line = lines.find(l => l.id === objId);
                if (line) {
                    line.lineStyle = style;
                    persistLinesForSymbol(currentChartSymbol, lines);
                    const pl = activePriceLines.find(p => p.id === objId);
                    if (pl) {
                        pl.data.lineStyle = style;
                        if (pl.lineObj) {
                            const lwStyle = (style === 'solid') ? LightweightCharts.LineStyle.Solid :
                                            (style === 'dotted') ? LightweightCharts.LineStyle.Dotted :
                                            LightweightCharts.LineStyle.Dashed;
                            pl.lineObj.applyOptions({ lineStyle: lwStyle });
                        }
                    }
                }
            } else {
                const shapes = getSavedChartShapes(currentChartSymbol);
                const shape = shapes.find(s => s.id === objId);
                if (shape) {
                    shape.lineStyle = style;
                    persistShapesForSymbol(currentChartSymbol, shapes);
                    redrawCanvasOverlay();
                }
            }

            // Update style button UI in popup
            const styleBtn = popup.querySelector('.canvas-obj-style-btn');
            if (styleBtn) {
                styleBtn.innerHTML = renderLineStyleIcon(style);
                styleBtn.title = `Line Style (${style})`;
            }
            if (styleMenu) {
                const styles = ['solid', 'dashed', 'dotted'];
                styleMenu.querySelectorAll('.canvas-obj-dropdown-item').forEach((item, idx) => {
                    item.classList.toggle('active', styles[idx] === style);
                });
            }
        }
        window.setCanvasObjectLineStyle = setCanvasObjectLineStyle;

        function showCanvasObjectMenu(obj, x, y) {
            let popup = document.getElementById('canvasObjectPopup');
            const mainContainer = document.getElementById('mainChartPane');
            if (!popup && mainContainer) {
                popup = document.createElement('div');
                popup.id = 'canvasObjectPopup';
                popup.className = 'canvas-object-popup';
                popup.addEventListener('mousedown', function(evt) { evt.stopPropagation(); });
                popup.addEventListener('click', function(evt) {
                    if (!evt.target.closest('.canvas-obj-width-btn') && !evt.target.closest('#canvasObjWidthMenu')) {
                        const wm = document.getElementById('canvasObjWidthMenu');
                        if (wm) wm.style.display = 'none';
                    }
                    if (!evt.target.closest('.canvas-obj-style-btn') && !evt.target.closest('#canvasObjStyleMenu')) {
                        const sm = document.getElementById('canvasObjStyleMenu');
                        if (sm) sm.style.display = 'none';
                    }
                    if (!evt.target.closest('.canvas-obj-more-btn') && !evt.target.closest('#canvasObjMoreMenu')) {
                        const mm = document.getElementById('canvasObjMoreMenu');
                        if (mm) mm.style.display = 'none';
                    }
                    evt.stopPropagation();
                });
                popup.addEventListener('touchstart', function(evt) { evt.stopPropagation(); }, { passive: true });
                popup.addEventListener('touchend', function(evt) { evt.stopPropagation(); });
                mainContainer.appendChild(popup);
            }

            if (popup && mainContainer) {
                const isMobile = window.innerWidth <= 768;
                const estimatedWidth = isMobile ? 225 : 275;
                popup.style.left = Math.max(10, Math.min(x - 20, mainContainer.clientWidth - estimatedWidth - 10)) + 'px';
                popup.style.top = Math.max(10, (y > 55 ? (y - 46) : (y + 16))) + 'px';
                popup.dataset.activeObjId = String(obj.id);
                popup.dataset.activeObjKind = String(obj.kind);

                let currentWidth = 2;
                let currentStyle = 'solid';
                let currentColor = obj.color || '#10b981';
                let isLocked = false;

                if (obj.kind === 'line') {
                    const lines = getSavedPriceLines(currentChartSymbol);
                    const l = lines.find(x => x.id === obj.id);
                    if (l) {
                        currentWidth = l.lineWidth ? parseInt(l.lineWidth) : 2;
                        currentStyle = l.lineStyle || 'dashed';
                        currentColor = l.color || currentColor;
                        isLocked = !!l.locked;
                    }
                } else if (obj.kind === 'shape') {
                    const shapes = getSavedChartShapes(currentChartSymbol);
                    const s = shapes.find(x => x.id === obj.id);
                    if (s) {
                        currentWidth = s.lineWidth ? parseInt(s.lineWidth) : (s.type === 'rectangle' ? 1 : 2);
                        currentStyle = s.lineStyle || (s.type === 'vertical' ? 'dashed' : 'solid');
                        currentColor = s.color || currentColor;
                        isLocked = !!s.locked;
                    }
                }

                const deleteFn = obj.kind === 'line' ? `deletePriceLineById('${obj.id}'); hideCanvasObjectMenu();` : `deleteShapeById('${obj.id}'); hideCanvasObjectMenu();`;
                const toggleVisFn = obj.kind === 'line' ? `togglePriceLineVisibility('${obj.id}'); hideCanvasObjectMenu();` : `toggleShapeVisibility('${obj.id}'); hideCanvasObjectMenu();`;
                const toggleLockFn = obj.kind === 'line' ? `togglePriceLineLock('${obj.id}');` : `toggleShapeLock('${obj.id}');`;
                const visLabel = obj.hidden ? 'Show' : 'Hide';
                const lockTitle = isLocked ? 'Unlock Drawing' : 'Lock Drawing';
                const isNote = (obj.kind === 'shape' && obj.type === 'note');

                popup.innerHTML = `
                    <div class="canvas-obj-drag-handle" title="Drag toolbar" aria-label="Drag toolbar">
                        <svg width="6" height="14" viewBox="0 0 6 14" fill="currentColor">
                            <circle cx="1.5" cy="2" r="1.1"/>
                            <circle cx="4.5" cy="2" r="1.1"/>
                            <circle cx="1.5" cy="7" r="1.1"/>
                            <circle cx="4.5" cy="7" r="1.1"/>
                            <circle cx="1.5" cy="12" r="1.1"/>
                            <circle cx="4.5" cy="12" r="1.1"/>
                        </svg>
                    </div>
                    <label class="canvas-obj-btn canvas-obj-color-tool" title="Line Color" aria-label="Line Color">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                        </svg>
                        <span class="canvas-obj-color-bar" style="background-color: ${currentColor};"></span>
                        <input type="color" value="${currentColor}" class="canvas-obj-color-input" aria-label="Change Color">
                    </label>
                    ${isNote ? `
                    <button type="button" class="canvas-obj-btn canvas-obj-text-btn" title="Text Note Properties" aria-label="Text Note Properties" onclick="openEditDrawingModal('${obj.kind}', '${obj.id}'); hideCanvasObjectMenu();">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="4 7 4 4 20 4 20 7"/>
                            <line x1="12" y1="4" x2="12" y2="20"/>
                        </svg>
                        <span class="canvas-obj-color-bar" style="background-color: ${currentColor};"></span>
                    </button>
                    ` : `
                    <div class="canvas-obj-popover-wrapper" style="position: relative; display: inline-flex;">
                        <button type="button" class="canvas-obj-btn canvas-obj-width-btn" onclick="toggleCanvasObjWidthMenu(event)" title="Line Width (${currentWidth}px)" aria-label="Line Width">
                            <span class="canvas-obj-width-preview" style="height: ${currentWidth}px;"></span>
                            <span class="canvas-obj-width-label">${currentWidth}px</span>
                        </button>
                        <div id="canvasObjWidthMenu" class="canvas-obj-dropdown-menu" style="display: none;">
                            ${[1, 2, 3, 4].map(w => `
                                <button type="button" class="canvas-obj-dropdown-item ${currentWidth === w ? 'active' : ''}" onclick="setCanvasObjectLineWidth(${w}, event)">
                                    <span class="canvas-obj-line-sample width-${w}"></span>
                                    <span>${w}px</span>
                                </button>
                            `).join('')}
                        </div>
                    </div>
                    <div class="canvas-obj-popover-wrapper" style="position: relative; display: inline-flex;">
                        <button type="button" class="canvas-obj-btn canvas-obj-style-btn" onclick="toggleCanvasObjStyleMenu(event)" title="Line Style (${currentStyle})" aria-label="Line Style">
                            ${renderLineStyleIcon(currentStyle)}
                        </button>
                        <div id="canvasObjStyleMenu" class="canvas-obj-dropdown-menu" style="display: none;">
                            <button type="button" class="canvas-obj-dropdown-item ${currentStyle === 'solid' ? 'active' : ''}" onclick="setCanvasObjectLineStyle('solid', event)">
                                <svg width="22" height="14" viewBox="0 0 22 14">
                                    <line x1="2" y1="7" x2="20" y2="7" stroke="currentColor" stroke-width="2" />
                                </svg>
                                <span>Line</span>
                            </button>
                            <button type="button" class="canvas-obj-dropdown-item ${currentStyle === 'dashed' ? 'active' : ''}" onclick="setCanvasObjectLineStyle('dashed', event)">
                                <svg width="22" height="14" viewBox="0 0 22 14">
                                    <line x1="2" y1="7" x2="20" y2="7" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3" />
                                </svg>
                                <span>Dashed line</span>
                            </button>
                            <button type="button" class="canvas-obj-dropdown-item ${currentStyle === 'dotted' ? 'active' : ''}" onclick="setCanvasObjectLineStyle('dotted', event)">
                                <svg width="22" height="14" viewBox="0 0 22 14">
                                    <line x1="2" y1="7" x2="20" y2="7" stroke="currentColor" stroke-width="2.5" stroke-dasharray="2 3" stroke-linecap="round" />
                                </svg>
                                <span>Dotted line</span>
                            </button>
                        </div>
                    </div>
                    <button type="button" class="canvas-obj-btn canvas-obj-text-btn" title="Add / Edit Text" aria-label="Add / Edit Text" onclick="openEditDrawingModal('${obj.kind}', '${obj.id}', 'text'); hideCanvasObjectMenu();">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="4 7 4 4 20 4 20 7"/>
                            <line x1="12" y1="4" x2="12" y2="20"/>
                        </svg>
                    </button>
                    `}

                    <button type="button" class="canvas-obj-btn canvas-obj-lock-btn ${isLocked ? 'canvas-obj-locked active' : ''}" onclick="${toggleLockFn}" title="${lockTitle}" aria-label="${lockTitle}">
                        ${isLocked ? `
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>` : `
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                        </svg>`}
                    </button>
                    <span class="canvas-obj-divider"></span>
                    <button type="button" class="canvas-obj-btn canvas-obj-delete-btn" onclick="${deleteFn}" title="Delete Drawing" aria-label="Delete">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            <line x1="10" y1="11" x2="10" y2="17"/>
                            <line x1="14" y1="11" x2="14" y2="17"/>
                        </svg>
                    </button>
                    <button type="button" class="canvas-obj-btn canvas-obj-more-btn" onclick="toggleCanvasObjectMoreMenu(event)" title="More options" aria-label="More options">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="5" cy="12" r="2"/>
                            <circle cx="12" cy="12" r="2"/>
                            <circle cx="19" cy="12" r="2"/>
                        </svg>
                    </button>
                    <div id="canvasObjMoreMenu" class="canvas-obj-more-menu" style="display: none;">
                        <div class="canvas-obj-more-header" title="${escapeHtml(obj.name)}">${escapeHtml(obj.name)}</div>
                        <button type="button" class="canvas-obj-more-item" onclick="openEditDrawingModal('${obj.kind}', '${obj.id}', 'text'); hideCanvasObjectMenu();">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
                            <span>Add / Edit Text...</span>
                        </button>
                        <button type="button" class="canvas-obj-more-item" onclick="openEditDrawingModal('${obj.kind}', '${obj.id}', 'style'); hideCanvasObjectMenu();">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                            <span>Settings...</span>
                        </button>
                        <button type="button" class="canvas-obj-more-item canvas-obj-more-item-lock" onclick="${toggleLockFn}">
                            ${isLocked ? `
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
                            <span>Unlock Drawing</span>
                            ` : `
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                            <span>Lock Drawing</span>
                            `}
                        </button>
                        <button type="button" class="canvas-obj-more-item" onclick="${toggleVisFn}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            <span>${visLabel} Drawing</span>
                        </button>
                        <button type="button" class="canvas-obj-more-item danger" onclick="${deleteFn}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            <span>Delete Drawing</span>
                        </button>
                    </div>
                `;

                // Initialize draggable handle
                const dragHandle = popup.querySelector('.canvas-obj-drag-handle');
                if (dragHandle) {
                    makeCanvasPopupDraggable(popup, dragHandle);
                }

                // Color picker input handlers
                const colorInput = popup.querySelector('.canvas-obj-color-input');
                const colorBar = popup.querySelector('.canvas-obj-color-bar');
                if (colorInput) {
                    const onColorChange = function() {
                        const newColor = this.value;
                        if (colorBar) colorBar.style.backgroundColor = newColor;
                        if (obj.kind === 'line') {
                            updatePriceLineColorById(obj.id, newColor);
                        } else {
                            updateShapeColorById(obj.id, newColor);
                            const shapes = getSavedChartShapes(currentChartSymbol);
                            const s = shapes.find(x => x.id === obj.id);
                            if (s && s.type === 'trendline') {
                                setLastTrendlineColor(newColor);
                            }
                        }
                    };
                    colorInput.addEventListener('input', onColorChange);
                    colorInput.addEventListener('change', onColorChange);
                    if (isMobile) {
                        colorInput.addEventListener('change', () => {
                            hideCanvasObjectMenu();
                        });
                    }
                }

                // Mobile auto-close on action buttons (ignore menu triggers and dropdown items)
                if (isMobile) {
                    popup.querySelectorAll('button:not(.canvas-obj-more-btn):not(.canvas-obj-width-btn):not(.canvas-obj-style-btn):not(.canvas-obj-dropdown-item)').forEach(btn => {
                        btn.addEventListener('click', () => {
                            hideCanvasObjectMenu();
                        });
                    });
                }

                popup.style.setProperty('display', 'inline-flex', 'important');
            }
        }

        function hideCanvasObjectMenu() {
            const popup = document.getElementById('canvasObjectPopup');
            if (popup) {
                popup.style.setProperty('display', 'none', 'important');
                popup.dataset.activeObjId = '';
                popup.dataset.activeObjKind = '';
                const moreMenu = document.getElementById('canvasObjMoreMenu');
                if (moreMenu) moreMenu.style.display = 'none';
                const widthMenu = document.getElementById('canvasObjWidthMenu');
                if (widthMenu) widthMenu.style.display = 'none';
                const styleMenu = document.getElementById('canvasObjStyleMenu');
                if (styleMenu) styleMenu.style.display = 'none';
            }
        }

        function updateCanvasObjectPopupLockState(isLocked) {
            const popup = document.getElementById('canvasObjectPopup');
            if (!popup) return;
            const lockBtn = popup.querySelector('.canvas-obj-lock-btn');
            if (lockBtn) {
                const title = isLocked ? 'Unlock Drawing' : 'Lock Drawing';
                lockBtn.title = title;
                lockBtn.setAttribute('aria-label', title);
                if (isLocked) {
                    lockBtn.classList.add('canvas-obj-locked', 'active');
                    lockBtn.innerHTML = `
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>`;
                } else {
                    lockBtn.classList.remove('canvas-obj-locked', 'active');
                    lockBtn.innerHTML = `
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                        </svg>`;
                }
            }
            const moreMenuLockItem = popup.querySelector('.canvas-obj-more-item-lock');
            if (moreMenuLockItem) {
                if (isLocked) {
                    moreMenuLockItem.innerHTML = `
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
                        <span>Unlock Drawing</span>
                    `;
                } else {
                    moreMenuLockItem.innerHTML = `
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        <span>Lock Drawing</span>
                    `;
                }
            }
        }
        window.updateCanvasObjectPopupLockState = updateCanvasObjectPopupLockState;

        
        let activeAddTextButtonBox = null;

        function renderAddTextBadge(ctx, x, y, kind, id, isDark) {
            ctx.save();
            const text = '+ Add text';
            ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            const tm = ctx.measureText(text);
            const w = tm.width + 14;
            const h = 20;
            const rx = Math.round(x - w / 2);
            const ry = Math.round(y - h);

            activeAddTextButtonBox = {
                kind: kind,
                id: id,
                x: rx - 4,
                y: ry - 4,
                width: w + 8,
                height: h + 8
            };

            ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.94)' : 'rgba(255, 255, 255, 0.95)';
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
                ctx.roundRect(rx, ry, w, h, 4);
            } else {
                ctx.rect(rx, ry, w, h);
            }
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#3b82f6';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, rx + w / 2, ry + h / 2);
            ctx.restore();
        }

        function redrawCanvasOverlay() {
            if (!drawingCanvas) return;
            const ctx = drawingCanvas.getContext('2d');
            ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

            if (!mainChart || !mainSeries || !currentChartSymbol) return;

            let activePopupObjId = '';
            let activePopupObjKind = '';
            const popup = document.getElementById('canvasObjectPopup');
            if (popup && popup.style.display !== 'none') {
                activePopupObjId = popup.dataset.activeObjId || '';
                activePopupObjKind = popup.dataset.activeObjKind || '';
            }
            activeAddTextButtonBox = null;

            const shapes = getSavedChartShapes(currentChartSymbol);

            // Draw all saved shapes if not globally hidden
            if (!isAllDrawingsHidden) {
                shapes.forEach(s => {
                    if (!s.hidden) {
                        drawSingleShape(ctx, s);
                    }
                });
            }

            // Draw price line labels on left side of drawings if not globally hidden
            if (!isAllDrawingsHidden && activePriceLines && activePriceLines.length > 0) {
                activePriceLines.forEach(item => {
                    const lineData = item.data;
                    if (!lineData || lineData.hidden) return;
                    if (lineData.price === null || lineData.price === undefined || isNaN(lineData.price)) return;
                    const y = mainSeries.priceToCoordinate(lineData.price);
                    if (y === null || y === undefined || isNaN(y) || y < 0 || y > drawingCanvas.height) return;

                    const labelName = lineData.label || (lineData.type === 'target' ? 'Target' : lineData.type === 'stoploss' ? 'Stop Loss' : lineData.type === 'resistance' ? 'Resistance' : 'Support');
                    const lockPrefix = lineData.locked ? '🔒 ' : '';
                    const textStr = `${lockPrefix}${labelName}: ₹${lineData.price}`;
                    const lineColor = lineData.color || (lineData.type === 'resistance' ? '#788325' : (lineData.type === 'target' ? '#0b845c' : (lineData.type === 'support' ? '#731717' : (lineData.type === 'stoploss' ? '#ef5350' : '#731717'))));

                    ctx.save();
                    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif';
                    const textMetrics = ctx.measureText(textStr);
                    const badgeW = Math.round(textMetrics.width + 14);
                    const badgeH = 18;
                    const badgeX = 8;
                    const badgeY = Math.round(y - badgeH / 2);
                    const radius = 3;

                    ctx.beginPath();
                    if (typeof ctx.roundRect === 'function') {
                        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, radius);
                    } else {
                        ctx.moveTo(badgeX + radius, badgeY);
                        ctx.lineTo(badgeX + badgeW - radius, badgeY);
                        ctx.quadraticCurveTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + radius);
                        ctx.lineTo(badgeX + badgeW, badgeY + badgeH - radius);
                        ctx.quadraticCurveTo(badgeX + badgeW, badgeY + badgeH, badgeX + badgeW - radius, badgeY + badgeH);
                        ctx.lineTo(badgeX + radius, badgeY + badgeH);
                        ctx.quadraticCurveTo(badgeX, badgeY + badgeH, badgeX, badgeY + badgeH - radius);
                        ctx.lineTo(badgeX, badgeY + radius);
                        ctx.quadraticCurveTo(badgeX, badgeY, badgeX + radius, badgeY);
                        ctx.closePath();
                    }

                    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
                    ctx.shadowBlur = 4;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 1;
                    ctx.fillStyle = lineColor;
                    ctx.fill();

                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(textStr, badgeX + badgeW / 2, y);

                    // ============================================
                    // CUSTOM TEXT RENDERING FOR PRICE LINE
                    // ============================================
                    const isSelected = (activePopupObjKind === 'line' && activePopupObjId === String(lineData.id));

                    // If selected, draw TradingView endpoint handles
                    if (isSelected) {
                        const hY = y;
                        const h1X = Math.min(100, Math.max(50, drawingCanvas.width * 0.12));
                        const h2X = Math.max(drawingCanvas.width - 100, drawingCanvas.width * 0.88);

                        ctx.shadowBlur = 0;
                        ctx.fillStyle = '#ffffff';
                        ctx.strokeStyle = '#3b82f6';
                        ctx.lineWidth = 2.5;

                        ctx.beginPath(); ctx.arc(h1X, hY, 4.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                        ctx.beginPath(); ctx.arc(h2X, hY, 4.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                    }

                    if (lineData.text && lineData.text.trim()) {
                        const customText = lineData.text.trim();
                        const fontSize = lineData.fontSize || 12;
                        const fontColor = lineData.textColor || lineColor;
                        const pos = lineData.textPos || 'center';
                        const valign = lineData.textValign || 'top';

                        ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
                        const m = ctx.measureText(customText);

                        let tx = drawingCanvas.width / 2;
                        let textAlign = 'center';
                        if (pos === 'left') {
                            tx = badgeX + badgeW + 14;
                            textAlign = 'left';
                        } else if (pos === 'right') {
                            tx = drawingCanvas.width - 24;
                            textAlign = 'right';
                        }

                        let ty = y - 6;
                        let textBase = 'bottom';
                        if (valign === 'middle') {
                            ty = y;
                            textBase = 'middle';
                            const isDark = (document.documentElement.getAttribute('data-theme') || 'light') === 'dark';
                            ctx.fillStyle = isDark ? 'rgba(19, 23, 34, 0.9)' : 'rgba(255, 255, 255, 0.9)';
                            const bgLeft = (textAlign === 'center') ? (tx - m.width / 2 - 4) : (textAlign === 'left' ? tx - 4 : tx - m.width - 4);
                            ctx.fillRect(bgLeft, ty - fontSize / 2 - 2, m.width + 8, fontSize + 4);
                        } else if (valign === 'bottom') {
                            ty = y + 6;
                            textBase = 'top';
                        }

                        ctx.fillStyle = fontColor;
                        ctx.textAlign = textAlign;
                        ctx.textBaseline = textBase;
                        ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
                        ctx.shadowBlur = 3;
                        ctx.fillText(customText, tx, ty);
                    } else if (isSelected) {
                        // Drawing selected with NO text yet -> render "+ Add text" pill
                        const isDark = (document.documentElement.getAttribute('data-theme') || 'light') === 'dark';
                        renderAddTextBadge(ctx, drawingCanvas.width / 2, y - 6, 'line', lineData.id, isDark);
                    }

                    ctx.restore();
                });
            }

            // Draw active screener pattern shapes (trendlines, triangles, channels)
            if (window.activePatternShapes && Array.isArray(window.activePatternShapes) && window.activePatternShapes.length > 0) {
                window.activePatternShapes.forEach(s => {
                    drawSingleShape(ctx, s);
                });
            }

            // Draw temporary measure if present
            if (tempMeasureData) {
                drawSingleShape(ctx, tempMeasureData);
            }

            // Draw active live preview shape if in drawing mode
            if (currentDrawingTool && tempMousePos) {
                if ((currentDrawingTool === 'trendline' || currentDrawingTool === 'rectangle' || currentDrawingTool === 'pricerange' || currentDrawingTool === 'fib' || currentDrawingTool === 'measure') && drawingPoints.length === 1) {
                    const pt1 = drawingPoints[0];
                    const pt2 = tempMousePos;
                    const previewShape = {
                        type: currentDrawingTool,
                        time1: pt1.time,
                        logical1: pt1.logical,
                        futureOffset1: pt1.futureOffset || 0,
                        price1: pt1.price,
                        time2: pt2.time,
                        logical2: pt2.logical,
                        futureOffset2: pt2.futureOffset || 0,
                        price2: pt2.price,
                        color: activeToolColor || (currentDrawingTool === 'trendline' ? '#60a5fa' : currentDrawingTool === 'rectangle' ? '#c084fc' : currentDrawingTool === 'fib' ? '#6366f1' : '#10b981'),
                        fillColor: currentDrawingTool === 'rectangle' ? 'rgba(192, 132, 252, 0.25)' : null,
                        isPreview: true
                    };
                    drawSingleShape(ctx, previewShape);
                } else if (currentDrawingTool === 'parallelchannel') {
                    if (drawingPoints.length === 1) {
                        const pt1 = drawingPoints[0];
                        const pt2 = tempMousePos;
                        const previewShape = {
                            type: 'trendline',
                            time1: pt1.time, logical1: pt1.logical, futureOffset1: pt1.futureOffset || 0, price1: pt1.price,
                            time2: pt2.time, logical2: pt2.logical, futureOffset2: pt2.futureOffset || 0, price2: pt2.price,
                            color: activeToolColor || '#3b82f6',
                            isPreview: true
                        };
                        drawSingleShape(ctx, previewShape);
                    } else if (drawingPoints.length === 2) {
                        const pt1 = drawingPoints[0];
                        const pt2 = drawingPoints[1];
                        const pt3 = tempMousePos;
                        const previewShape = {
                            type: 'parallelchannel',
                            time1: pt1.time, logical1: pt1.logical, futureOffset1: pt1.futureOffset || 0, price1: pt1.price,
                            time2: pt2.time, logical2: pt2.logical, futureOffset2: pt2.futureOffset || 0, price2: pt2.price,
                            time3: pt3.time, logical3: pt3.logical, futureOffset3: pt3.futureOffset || 0, price3: pt3.price,
                            color: activeToolColor || '#3b82f6',
                            fillColor: hexToRgba(activeToolColor || '#3b82f6', 0.12),
                            isPreview: true
                        };
                        drawSingleShape(ctx, previewShape);
                    }
                } else if (currentDrawingTool === 'fibext') {
                    if (drawingPoints.length === 1) {
                        const pt1 = drawingPoints[0];
                        const pt2 = tempMousePos;
                        const previewShape = {
                            type: 'trendline',
                            time1: pt1.time, logical1: pt1.logical, futureOffset1: pt1.futureOffset || 0, price1: pt1.price,
                            time2: pt2.time, logical2: pt2.logical, futureOffset2: pt2.futureOffset || 0, price2: pt2.price,
                            color: activeToolColor || '#a855f7',
                            isPreview: true
                        };
                        drawSingleShape(ctx, previewShape);
                    } else if (drawingPoints.length === 2) {
                        const pt1 = drawingPoints[0];
                        const pt2 = drawingPoints[1];
                        const pt3 = tempMousePos;
                        const previewShape = {
                            type: 'fibext',
                            time1: pt1.time, logical1: pt1.logical, futureOffset1: pt1.futureOffset || 0, price1: pt1.price,
                            time2: pt2.time, logical2: pt2.logical, futureOffset2: pt2.futureOffset || 0, price2: pt2.price,
                            time3: pt3.time, logical3: pt3.logical, futureOffset3: pt3.futureOffset || 0, price3: pt3.price,
                            color: activeToolColor || '#a855f7',
                            isPreview: true
                        };
                        drawSingleShape(ctx, previewShape);
                    }
                } else if (currentDrawingTool === 'vertical') {
                    const previewShape = {
                        type: 'vertical',
                        time: tempMousePos.time,
                        logical: tempMousePos.logical,
                        futureOffset: tempMousePos.futureOffset || 0,
                        color: '#fbbf24',
                        isPreview: true
                    };
                    drawSingleShape(ctx, previewShape);
                }
            }

            if (activeDrawingCrosshair) {
                drawActiveDrawingCrosshair(ctx);
            }
        }

        function formatChartVolume(vol) {
            if (!vol || isNaN(vol)) return '';
            if (vol >= 10000000) return (vol / 10000000).toFixed(2) + ' Cr';
            if (vol >= 100000) return (vol / 100000).toFixed(2) + ' L';
            if (vol >= 1000) return (vol / 1000).toFixed(1) + ' K';
            return vol.toString();
        }

        function drawSingleShape(ctx, s) {
            const timeScale = mainChart.timeScale();
            const isDark = (document.documentElement.getAttribute('data-theme') || 'light') === 'dark';

            if (s.type === 'pricerange') {
                const x1 = getShapeX(timeScale, s.time1, s.logical1, s.futureOffset1, s.futureTime1, s.timeframe);
                const y1 = mainSeries.priceToCoordinate(s.price1);
                const x2 = getShapeX(timeScale, s.time2 || s.time1, s.logical2 !== undefined ? s.logical2 : s.logical1, s.futureOffset2 || 0, s.futureTime2, s.timeframe);
                const y2 = mainSeries.priceToCoordinate(s.price2);

                if (x1 !== null && y1 !== null && y2 !== null) {
                    ctx.save();

                    const isUp = s.price2 >= s.price1;
                    const color = s.color || (isUp ? '#10b981' : '#ef5350');
                    const fillColor = isUp ? 'rgba(16, 185, 129, 0.18)' : 'rgba(239, 83, 80, 0.18)';

                    let startX = x1, endX = (x2 !== null) ? x2 : x1;
                    if (Math.abs(endX - startX) < 20) {
                        startX = x1 - 25;
                        endX = x1 + 25;
                    }

                    const leftX = Math.min(startX, endX);
                    const rightX = Math.max(startX, endX);
                    const topY = Math.min(y1, y2);
                    const bottomY = Math.max(y1, y2);
                    const boxWidth = Math.max(20, rightX - leftX);
                    const boxHeight = Math.max(4, bottomY - topY);

                    // 1. Draw Shaded Translucent Range Box
                    ctx.fillStyle = fillColor;
                    ctx.fillRect(leftX, topY, boxWidth, boxHeight);

                    ctx.strokeStyle = color;
                    const lw = s.lineWidth || 1.5;
                    ctx.lineWidth = lw;
                    if (s.isPreview) {
                        ctx.setLineDash([4, 4]);
                    } else if (s.lineStyle === 'dotted') {
                        ctx.setLineDash([2, 3]);
                    } else if (s.lineStyle === 'dashed') {
                        ctx.setLineDash([6, 4]);
                    } else {
                        ctx.setLineDash([]);
                    }
                    ctx.strokeRect(leftX, topY, boxWidth, boxHeight);

                    // 2. Center Stem & Handles
                    const centerX = leftX + boxWidth / 2;
                    ctx.beginPath();
                    ctx.setLineDash([]);
                    ctx.moveTo(centerX, y1);
                    ctx.lineTo(centerX, y2);
                    ctx.lineWidth = Math.max(1.5, lw);
                    ctx.strokeStyle = color;
                    ctx.stroke();

                    // Handles (TradingView End Circles)
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;

                    ctx.beginPath(); ctx.arc(centerX, y1, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                    ctx.beginPath(); ctx.arc(centerX, y2, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();

                    if (!s.isPreview) {
                        ctx.beginPath(); ctx.arc(leftX, topY, 3, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                        ctx.beginPath(); ctx.arc(leftX + boxWidth, topY, 3, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                        ctx.beginPath(); ctx.arc(leftX, bottomY, 3, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                        ctx.beginPath(); ctx.arc(leftX + boxWidth, bottomY, 3, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                    }

                    // 3. Floating Price & Percentage Label (Clean floating text without border or background)
                    const diff = s.price2 - s.price1;
                    const pct = (s.price1 !== 0) ? (diff / Math.abs(s.price1)) * 100 : 0;
                    const sign = diff >= 0 ? '+' : '-';

                    const badgeText = `${sign}₹${Math.abs(diff).toFixed(2)} (${sign}${Math.abs(pct).toFixed(2)}%)`;

                    ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    ctx.fillStyle = color;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = (topY > 16) ? 'bottom' : 'top';
                    ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.75)' : 'rgba(255, 255, 255, 0.85)';
                    ctx.shadowBlur = 2;

                    const textY = (topY > 16) ? (topY - 4) : (topY + 4);
                    ctx.fillText(badgeText, centerX, textY);

                    ctx.restore();
                }
            } else if (s.type === 'measure') {
                const x1 = getShapeX(timeScale, s.time1, s.logical1, s.futureOffset1, s.futureTime1, s.timeframe);
                const y1 = mainSeries.priceToCoordinate(s.price1);
                const x2 = getShapeX(timeScale, s.time2 || s.time1, s.logical2 !== undefined ? s.logical2 : s.logical1, s.futureOffset2 || 0, s.futureTime2, s.timeframe);
                const y2 = mainSeries.priceToCoordinate(s.price2);

                if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
                    ctx.save();

                    // Measure tool lifetime: full opacity for 0s-2s, smooth fade out for 2s-3s, disabled at 3s
                    let opacity = 1.0;
                    if (s.createdAt) {
                        const elapsed = performance.now() - s.createdAt;
                        if (elapsed >= 3000) {
                            ctx.restore();
                            return;
                        } else if (elapsed >= 2000) {
                            const progress = Math.min(1, Math.max(0, (elapsed - 2000) / 1000));
                            const ease = progress * progress * (3 - 2 * progress);
                            opacity = Math.max(0, 1.0 - ease);
                        }
                    } else if (s.opacity !== undefined) {
                        opacity = s.opacity;
                    }
                    if (opacity <= 0) {
                        ctx.restore();
                        return;
                    }
                    ctx.globalAlpha = opacity;

                    const diff = s.price2 - s.price1;
                    const pct = (s.price1 !== 0) ? (diff / Math.abs(s.price1)) * 100 : 0;
                    const isUp = diff >= 0;
                    const color = isUp ? '#10b981' : '#ef5350';
                    const boxFill = isUp ? 'rgba(16, 185, 129, 0.16)' : 'rgba(239, 83, 80, 0.16)';

                    const leftX = Math.min(x1, x2);
                    const rightX = Math.max(x1, x2);
                    const topY = Math.min(y1, y2);
                    const bottomY = Math.max(y1, y2);
                    const width = Math.max(2, rightX - leftX);
                    const height = Math.max(2, bottomY - topY);

                    // 1. Shaded range box
                    ctx.fillStyle = boxFill;
                    ctx.fillRect(leftX, topY, width, height);
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 4]);
                    ctx.strokeRect(leftX, topY, width, height);
                    ctx.setLineDash([]);

                    // 2. Connecting diagonal line
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();

                    // 3. Handles at ends
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.arc(x1, y1, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                    ctx.beginPath(); ctx.arc(x2, y2, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();

                    // 4. Bar Count & Time calculation
                    const bars = Math.abs((s.logical2 !== undefined ? s.logical2 : s.logical1) - (s.logical1 || 0));
                    let daysStr = '';
                    if (s.time1 && s.time2) {
                        const t1 = typeof s.time1 === 'number' ? s.time1 * 1000 : new Date(s.time1).getTime();
                        const t2 = typeof s.time2 === 'number' ? s.time2 * 1000 : new Date(s.time2).getTime();
                        if (!isNaN(t1) && !isNaN(t2)) {
                            const diffDays = Math.round(Math.abs(t2 - t1) / (1000 * 60 * 60 * 24));
                            daysStr = `${diffDays}d`;
                        }
                    }

                    // Volume sum in range
                    let volSum = 0;
                    if (cachedChartData && cachedChartData.candles && cachedChartData.candles.length > 0) {
                        const minL = Math.max(0, Math.min(s.logical1, s.logical2 !== undefined ? s.logical2 : s.logical1));
                        const maxL = Math.min(cachedChartData.candles.length - 1, Math.max(s.logical1, s.logical2 !== undefined ? s.logical2 : s.logical1));
                        for (let i = minL; i <= maxL; i++) {
                            if (cachedChartData.candles[i] && cachedChartData.candles[i].volume) {
                                volSum += cachedChartData.candles[i].volume;
                            }
                        }
                    }
                    const volStr = volSum > 0 ? formatChartVolume(volSum) : '';

                    // 5. Floating Measure Info Badge
                    const sign = isUp ? '+' : '-';
                    const line1 = `${sign}₹${Math.abs(diff).toFixed(2)} (${sign}${Math.abs(pct).toFixed(2)}%)`;
                    const line2Parts = [];
                    if (bars > 0) line2Parts.push(`${bars} bars`);
                    if (daysStr) line2Parts.push(daysStr);
                    if (volStr) line2Parts.push(`Vol ${volStr}`);
                    const line2 = line2Parts.join(', ');

                    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    const m1 = ctx.measureText(line1);
                    ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    const m2 = ctx.measureText(line2);
                    const badgeW = Math.max(m1.width, m2.width) + 20;
                    const badgeH = line2 ? 38 : 22;

                    const centerX = leftX + width / 2;
                    const badgeX = Math.max(10, Math.min(drawingCanvas.width - badgeW - 10, centerX - badgeW / 2));
                    const badgeY = Math.max(10, Math.min(drawingCanvas.height - badgeH - 10, (y2 > y1 ? bottomY + 8 : topY - badgeH - 8)));

                    // Badge Pill Background
                    ctx.fillStyle = isDark ? 'rgba(30, 34, 45, 0.94)' : 'rgba(255, 255, 255, 0.95)';
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.2;
                    ctx.beginPath();
                    if (ctx.roundRect) ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
                    else ctx.rect(badgeX, badgeY, badgeW, badgeH);
                    ctx.fill();
                    ctx.stroke();

                    // Line 1 Text (Price & %)
                    ctx.fillStyle = color;
                    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    ctx.fillText(line1, badgeX + badgeW / 2, badgeY + 5);

                    // Line 2 Text (Bars, Duration, Vol)
                    if (line2) {
                        ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
                        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                        ctx.fillText(line2, badgeX + badgeW / 2, badgeY + 20);
                    }

                    ctx.restore();
                }
            } else if (s.type === 'parallelchannel') {
                const x1 = getShapeX(timeScale, s.time1, s.logical1, s.futureOffset1, s.futureTime1, s.timeframe);
                const y1 = mainSeries.priceToCoordinate(s.price1);
                const x2 = getShapeX(timeScale, s.time2 || s.time1, s.logical2 !== undefined ? s.logical2 : s.logical1, s.futureOffset2 || 0, s.futureTime2, s.timeframe);
                const y2 = mainSeries.priceToCoordinate(s.price2);

                if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
                    ctx.save();
                    const color = s.color || '#3b82f6';
                    const x3 = (s.time3 !== undefined || s.logical3 !== undefined) ? getShapeX(timeScale, s.time3 || s.time2, s.logical3 !== undefined ? s.logical3 : s.logical2, s.futureOffset3 || 0, s.futureTime3, s.timeframe) : null;
                    const y3 = (s.price3 !== undefined) ? mainSeries.priceToCoordinate(s.price3) : null;

                    let dy = 0;
                    if (x3 !== null && y3 !== null) {
                        const baseLineYAtX3 = (x2 !== x1) ? (y1 + (y2 - y1) * ((x3 - x1) / (x2 - x1))) : y1;
                        dy = y3 - baseLineYAtX3;
                    }

                    // Channel Polygon Fill
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.lineTo(x2, y2 + dy);
                    ctx.lineTo(x1, y1 + dy);
                    ctx.closePath();
                    ctx.fillStyle = s.fillColor || hexToRgba(color, 0.12);
                    ctx.fill();

                    // Baseline
                    ctx.strokeStyle = color;
                    const lw = s.lineWidth || 1.8;
                    ctx.lineWidth = lw;
                    if (s.isPreview) {
                        ctx.setLineDash([4, 4]);
                    } else if (s.lineStyle === 'dotted') {
                        ctx.setLineDash([2, 3]);
                    } else if (s.lineStyle === 'dashed') {
                        ctx.setLineDash([6, 4]);
                    } else {
                        ctx.setLineDash([]);
                    }
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();

                    // Parallel Line
                    ctx.beginPath();
                    ctx.moveTo(x1, y1 + dy);
                    ctx.lineTo(x2, y2 + dy);
                    ctx.stroke();

                    // Midline (Median dashed)
                    ctx.strokeStyle = color;
                    ctx.lineWidth = Math.max(1, lw * 0.7);
                    ctx.setLineDash([5, 5]);
                    ctx.beginPath();
                    ctx.moveTo(x1, y1 + dy / 2);
                    ctx.lineTo(x2, y2 + dy / 2);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // TradingView End Circles / Handles
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;

                    ctx.beginPath(); ctx.arc(x1, y1, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                    ctx.beginPath(); ctx.arc(x2, y2, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();

                    // Parallel handle
                    const midX = (x1 + x2) / 2;
                    const midY = (y1 + y2) / 2 + dy;
                    ctx.beginPath(); ctx.arc(midX, midY, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();

                    // Custom text or "+ Add text" for parallel channel
                    const popupEl = document.getElementById('canvasObjectPopup');
                    const isSelected = (popupEl && popupEl.style.display !== 'none' && popupEl.dataset.activeObjKind === 'shape' && popupEl.dataset.activeObjId === String(s.id));
                    const mx = (x1 + x2) / 2;
                    const my = (y1 + y2) / 2 + dy / 2;

                    if (s.text && s.text.trim()) {
                        const customText = s.text.trim();
                        const fontSize = s.fontSize || 12;
                        const fontColor = s.textColor || color || '#ffffff';
                        const pos = s.textPos || 'center';
                        const valign = s.textValign || 'top';

                        const t = (pos === 'left') ? 0.2 : (pos === 'right') ? 0.8 : 0.5;
                        const tx = x1 + (x2 - x1) * t;
                        let ty = (y1 + (y2 - y1) * t) + dy / 2;

                        ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
                        const m = ctx.measureText(customText);

                        let textBase = 'middle';
                        if (valign === 'top') {
                            ty -= 10;
                            textBase = 'bottom';
                        } else if (valign === 'bottom') {
                            ty += 12;
                            textBase = 'top';
                        } else {
                            ctx.fillStyle = isDark ? 'rgba(19, 23, 34, 0.9)' : 'rgba(255, 255, 255, 0.9)';
                            ctx.fillRect(tx - m.width / 2 - 4, ty - fontSize / 2 - 2, m.width + 8, fontSize + 4);
                        }

                        ctx.fillStyle = fontColor;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = textBase;
                        ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
                        ctx.shadowBlur = 3;
                        ctx.fillText(customText, tx, ty);
                    } else if (isSelected && !s.isPreview) {
                        renderAddTextBadge(ctx, mx, my - 10, 'shape', s.id, isDark);
                    }

                    ctx.restore();
                }
            } else if (s.type === 'fib') {
                const x1 = getShapeX(timeScale, s.time1, s.logical1, s.futureOffset1, s.futureTime1, s.timeframe);
                const y1 = mainSeries.priceToCoordinate(s.price1);
                const x2 = getShapeX(timeScale, s.time2 || s.time1, s.logical2 !== undefined ? s.logical2 : s.logical1, s.futureOffset2 || 0, s.futureTime2, s.timeframe);
                const y2 = mainSeries.priceToCoordinate(s.price2);

                if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
                    ctx.save();
                    const diff = s.price1 - s.price2; // swing diff
                    const startX = Math.min(x1, x2);
                    const endX = Math.max(x1, x2) + 75;

                    const FIB_LEVELS = [
                        { ratio: 0.0,   label: '0.0 (0%)',     color: '#787b86', fill: null },
                        { ratio: 0.236, label: '0.236 (23.6%)', color: '#ef5350', fill: 'rgba(239, 83, 80, 0.08)' },
                        { ratio: 0.382, label: '0.382 (38.2%)', color: '#f59e0b', fill: 'rgba(245, 158, 11, 0.08)' },
                        { ratio: 0.5,   label: '0.5 (50.0%)',   color: '#10b981', fill: 'rgba(16, 185, 129, 0.08)' },
                        { ratio: 0.618, label: '0.618 (61.8%)', color: '#06b6d4', fill: 'rgba(6, 182, 212, 0.08)' },
                        { ratio: 0.786, label: '0.786 (78.6%)', color: '#8b5cf6', fill: 'rgba(139, 92, 246, 0.08)' },
                        { ratio: 1.0,   label: '1.0 (100%)',    color: '#787b86', fill: 'rgba(120, 123, 134, 0.05)' },
                        { ratio: 1.618, label: '1.618 (161.8%)', color: '#ec4899', fill: 'rgba(236, 72, 153, 0.06)' }
                    ];

                    // Draw connecting trendline
                    const lw = s.lineWidth || 1.5;
                    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.35)';
                    ctx.lineWidth = lw;
                    if (s.lineStyle === 'dotted') ctx.setLineDash([2, 3]);
                    else if (s.lineStyle === 'solid') ctx.setLineDash([]);
                    else ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // Calculate Y for each level
                    const levelYs = FIB_LEVELS.map(lvl => {
                        const p = s.price2 + diff * lvl.ratio;
                        return {
                            lvl,
                            price: p,
                            y: mainSeries.priceToCoordinate(p)
                        };
                    });

                    // 1. Shaded bands between adjacent levels
                    for (let i = 1; i < levelYs.length; i++) {
                        const prev = levelYs[i - 1];
                        const curr = levelYs[i];
                        if (prev.y !== null && curr.y !== null && curr.lvl.fill) {
                            const top = Math.min(prev.y, curr.y);
                            const height = Math.abs(curr.y - prev.y);
                            ctx.fillStyle = curr.lvl.fill;
                            ctx.fillRect(startX, top, endX - startX, height);
                        }
                    }

                    // 2. Horizontal lines & text labels
                    levelYs.forEach(item => {
                        if (item.y === null) return;
                        const y = item.y;
                        ctx.strokeStyle = item.lvl.color;
                        ctx.lineWidth = (item.lvl.ratio === 0.0 || item.lvl.ratio === 0.618 || item.lvl.ratio === 1.0) ? Math.max(1.5, lw) : lw;
                        ctx.beginPath();
                        ctx.moveTo(startX, y);
                        ctx.lineTo(endX, y);
                        ctx.stroke();

                        // Label
                        const text = `${item.lvl.label} - ₹${item.price.toFixed(2)}`;
                        ctx.font = '9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                        ctx.fillStyle = item.lvl.color;
                        ctx.textAlign = 'right';
                        ctx.textBaseline = 'bottom';
                        ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)';
                        ctx.shadowBlur = 2;
                        ctx.fillText(text, endX - 4, y - 2);
                    });

                    // 3. Handles at swing anchor points
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = s.color || '#6366f1';
                    ctx.lineWidth = 2;
                    ctx.shadowBlur = 0;
                    ctx.beginPath(); ctx.arc(x1, y1, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                    ctx.beginPath(); ctx.arc(x2, y2, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();

                    ctx.restore();
                }
            } else if (s.type === 'fibext') {
                const x1 = getShapeX(timeScale, s.time1, s.logical1, s.futureOffset1, s.futureTime1, s.timeframe);
                const y1 = mainSeries.priceToCoordinate(s.price1);
                const x2 = getShapeX(timeScale, s.time2 || s.time1, s.logical2 !== undefined ? s.logical2 : s.logical1, s.futureOffset2 || 0, s.futureTime2, s.timeframe);
                const y2 = mainSeries.priceToCoordinate(s.price2);
                const x3 = (s.time3 !== undefined || s.logical3 !== undefined) ? getShapeX(timeScale, s.time3 || s.time2, s.logical3 !== undefined ? s.logical3 : s.logical2, s.futureOffset3 || 0, s.futureTime3, s.timeframe) : null;
                const y3 = (s.price3 !== undefined) ? mainSeries.priceToCoordinate(s.price3) : null;

                if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
                    ctx.save();
                    const color = s.color || '#a855f7';

                    const lw = s.lineWidth || 1.6;
                    // Wave 1 Line (Trend)
                    ctx.strokeStyle = color;
                    ctx.lineWidth = lw;
                    if (s.lineStyle === 'dotted') ctx.setLineDash([2, 3]);
                    else if (s.lineStyle === 'dashed') ctx.setLineDash([6, 4]);
                    else ctx.setLineDash([]);
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();

                    // Wave 2 Line (Retracement to Point 3)
                    if (x3 !== null && y3 !== null) {
                        ctx.strokeStyle = color;
                        ctx.lineWidth = Math.max(1, lw * 0.8);
                        ctx.setLineDash([4, 4]);
                        ctx.beginPath();
                        ctx.moveTo(x2, y2);
                        ctx.lineTo(x3, y3);
                        ctx.stroke();
                        ctx.setLineDash([]);

                        // Extension Levels from Point 3
                        const baseDiff = s.price2 - s.price1;
                        const startX = x3;
                        const endX = x3 + Math.max(90, Math.abs(x2 - x1) * 1.4);

                        const FIB_EXT_LEVELS = [
                            { ratio: 0.0,   label: '0.0 (0%)',     color: '#787b86', fill: null },
                            { ratio: 0.382, label: '0.382 (38.2%)', color: '#f59e0b', fill: 'rgba(245, 158, 11, 0.07)' },
                            { ratio: 0.618, label: '0.618 (61.8%)', color: '#06b6d4', fill: 'rgba(6, 182, 212, 0.07)' },
                            { ratio: 1.0,   label: '1.0 (100%)',    color: '#10b981', fill: 'rgba(16, 185, 129, 0.07)' },
                            { ratio: 1.272, label: '1.272 (127.2%)', color: '#3b82f6', fill: 'rgba(59, 130, 246, 0.07)' },
                            { ratio: 1.618, label: '1.618 (161.8%)', color: '#8b5cf6', fill: 'rgba(139, 92, 246, 0.07)' },
                            { ratio: 2.0,   label: '2.0 (200%)',    color: '#ec4899', fill: 'rgba(236, 72, 153, 0.06)' },
                            { ratio: 2.618, label: '2.618 (261.8%)', color: '#ef4444', fill: 'rgba(239, 68, 68, 0.06)' }
                        ];

                        const levelYs = FIB_EXT_LEVELS.map(lvl => {
                            const p = s.price3 + baseDiff * lvl.ratio;
                            return {
                                lvl,
                                price: p,
                                y: mainSeries.priceToCoordinate(p)
                            };
                        });

                        // 1. Shaded bands between adjacent extension levels
                        for (let i = 1; i < levelYs.length; i++) {
                            const prev = levelYs[i - 1];
                            const curr = levelYs[i];
                            if (prev.y !== null && curr.y !== null && curr.lvl.fill) {
                                const top = Math.min(prev.y, curr.y);
                                const height = Math.abs(curr.y - prev.y);
                                ctx.fillStyle = curr.lvl.fill;
                                ctx.fillRect(startX, top, endX - startX, height);
                            }
                        }

                        // 2. Horizontal extension lines & text labels
                        levelYs.forEach(item => {
                            if (item.y === null) return;
                            const y = item.y;
                            ctx.strokeStyle = item.lvl.color;
                            ctx.lineWidth = (item.lvl.ratio === 1.0 || item.lvl.ratio === 1.618) ? Math.max(1.5, lw) : lw;
                            ctx.beginPath();
                            ctx.moveTo(startX, y);
                            ctx.lineTo(endX, y);
                            ctx.stroke();

                            // Label
                            const text = `${item.lvl.label} - ₹${item.price.toFixed(2)}`;
                            ctx.font = '9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                            ctx.fillStyle = item.lvl.color;
                            ctx.textAlign = 'right';
                            ctx.textBaseline = 'bottom';
                            ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)';
                            ctx.shadowBlur = 2;
                            ctx.fillText(text, endX - 4, y - 2);
                        });

                        // Handle 3
                        ctx.fillStyle = '#ffffff';
                        ctx.strokeStyle = color;
                        ctx.lineWidth = 2;
                        ctx.shadowBlur = 0;
                        ctx.beginPath(); ctx.arc(x3, y3, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                    }

                    // Handles 1 and 2
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;
                    ctx.shadowBlur = 0;
                    ctx.beginPath(); ctx.arc(x1, y1, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                    ctx.beginPath(); ctx.arc(x2, y2, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();

                    ctx.restore();
                }
            } else if (s.type === 'trendline') {
                const x1 = getShapeX(timeScale, s.time1, s.logical1, s.futureOffset1, s.futureTime1, s.timeframe);
                const y1 = mainSeries.priceToCoordinate(s.price1);
                const x2 = getShapeX(timeScale, s.time2, s.logical2, s.futureOffset2, s.futureTime2, s.timeframe);
                const y2 = mainSeries.priceToCoordinate(s.price2);

                if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.strokeStyle = s.color || '#3b82f6';
                    const lw = s.lineWidth || 2;
                    ctx.lineWidth = s.isPreview ? 2 : lw;
                    if (s.isPreview) {
                        ctx.setLineDash([4, 4]);
                    } else if (s.lineStyle === 'dotted') {
                        ctx.setLineDash([2, 3]);
                    } else if (s.lineStyle === 'dashed') {
                        ctx.setLineDash([6, 4]);
                    } else {
                        ctx.setLineDash([]);
                    }
                    ctx.stroke();

                    // Draw end handle dots
                    ctx.fillStyle = s.color || '#3b82f6';
                    const handleR = Math.max(3.5, lw + 1.5);
                    ctx.beginPath(); ctx.arc(x1, y1, handleR, 0, 2 * Math.PI); ctx.fill();
                    ctx.beginPath(); ctx.arc(x2, y2, handleR, 0, 2 * Math.PI); ctx.fill();

                    // Custom text or "+ Add text" for trendline
                    const popupEl = document.getElementById('canvasObjectPopup');
                    const isSelected = (popupEl && popupEl.style.display !== 'none' && popupEl.dataset.activeObjKind === 'shape' && popupEl.dataset.activeObjId === String(s.id));
                    const midX = (x1 + x2) / 2;
                    const midY = (y1 + y2) / 2;

                    if (s.text && s.text.trim()) {
                        const customText = s.text.trim();
                        const fontSize = s.fontSize || 12;
                        const fontColor = s.textColor || s.color || '#ffffff';
                        const pos = s.textPos || 'center';
                        const valign = s.textValign || 'top';

                        const t = (pos === 'left') ? 0.2 : (pos === 'right') ? 0.8 : 0.5;
                        const tx = x1 + (x2 - x1) * t;
                        let ty = y1 + (y2 - y1) * t;

                        ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
                        const m = ctx.measureText(customText);

                        let textBase = 'middle';
                        if (valign === 'top') {
                            ty -= 10;
                            textBase = 'bottom';
                        } else if (valign === 'bottom') {
                            ty += 12;
                            textBase = 'top';
                        } else {
                            ctx.fillStyle = isDark ? 'rgba(19, 23, 34, 0.9)' : 'rgba(255, 255, 255, 0.9)';
                            ctx.fillRect(tx - m.width / 2 - 4, ty - fontSize / 2 - 2, m.width + 8, fontSize + 4);
                        }

                        ctx.fillStyle = fontColor;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = textBase;
                        ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
                        ctx.shadowBlur = 3;
                        ctx.fillText(customText, tx, ty);
                    } else if (isSelected && !s.isPreview) {
                        renderAddTextBadge(ctx, midX, midY - 10, 'shape', s.id, isDark);
                    }

                    // Pattern Name Pill
                    if (s.name) {
                        ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                        const textW = ctx.measureText(s.name).width;
                        const badgeW = textW + 12;
                        const badgeH = 18;
                        const badgeX = Math.max(10, Math.min(drawingCanvas.width - badgeW - 10, x2 - badgeW - 8));
                        const badgeY = Math.max(10, y2 - badgeH / 2);

                        ctx.fillStyle = isDark ? 'rgba(30, 34, 45, 0.92)' : 'rgba(255, 255, 255, 0.92)';
                        ctx.strokeStyle = s.color || '#3b82f6';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        if (ctx.roundRect) ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
                        else ctx.rect(badgeX, badgeY, badgeW, badgeH);
                        ctx.fill();
                        ctx.stroke();

                        ctx.fillStyle = s.color || '#3b82f6';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(s.name, badgeX + badgeW / 2, badgeY + badgeH / 2);
                    }
                    ctx.restore();
                }
            } else if (s.type === 'triangle') {
                const xTop1 = getShapeX(timeScale, s.time1_top, s.logical1_top, 0);
                const yTop1 = mainSeries.priceToCoordinate(s.price1_top);
                const xTop2 = getShapeX(timeScale, s.time2_top, s.logical2_top, s.futureOffset2_top || 0);
                const yTop2 = mainSeries.priceToCoordinate(s.price2_top);

                const xBot1 = getShapeX(timeScale, s.time1_bot, s.logical1_bot, 0);
                const yBot1 = mainSeries.priceToCoordinate(s.price1_bot);
                const xBot2 = getShapeX(timeScale, s.time2_bot, s.logical2_bot, s.futureOffset2_bot || 0);
                const yBot2 = mainSeries.priceToCoordinate(s.price2_bot);

                if (xTop1 !== null && yTop1 !== null && xTop2 !== null && yTop2 !== null &&
                    xBot1 !== null && yBot1 !== null && xBot2 !== null && yBot2 !== null) {
                    ctx.save();

                    const isBreakdown = s.status === 'breakdown' || (s.name && s.name.toLowerCase().includes('breakdown'));
                    const isBreakout = s.status === 'breakout' || (s.name && s.name.toLowerCase().includes('breakout'));

                    // 1. Shaded Triangle Area
                    ctx.beginPath();
                    ctx.moveTo(xTop1, yTop1);
                    ctx.lineTo(xTop2, yTop2);
                    ctx.lineTo(xBot2, yBot2);
                    ctx.lineTo(xBot1, yBot1);
                    ctx.closePath();
                    ctx.fillStyle = s.fillColor || (isBreakdown ? 'rgba(239, 68, 68, 0.12)' : (isBreakout ? 'rgba(16, 185, 129, 0.12)' : 'rgba(99, 102, 241, 0.12)'));
                    ctx.fill();

                    // 2. Upper Resistance Boundary Line
                    ctx.beginPath();
                    ctx.moveTo(xTop1, yTop1);
                    ctx.lineTo(xTop2, yTop2);
                    ctx.strokeStyle = s.topColor || (isBreakout ? '#10b981' : '#ef4444');
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    // 3. Lower Support Boundary Line
                    ctx.beginPath();
                    ctx.moveTo(xBot1, yBot1);
                    ctx.lineTo(xBot2, yBot2);
                    ctx.strokeStyle = s.botColor || (isBreakdown ? '#ef5350' : '#10b981');
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    // 4. Vertex Handle Dots
                    ctx.fillStyle = s.topColor || '#ef4444';
                    ctx.beginPath(); ctx.arc(xTop1, yTop1, 3.5, 0, 2 * Math.PI); ctx.fill();
                    ctx.beginPath(); ctx.arc(xTop2, yTop2, 3.5, 0, 2 * Math.PI); ctx.fill();

                    ctx.fillStyle = s.botColor || (isBreakdown ? '#ef5350' : '#10b981');
                    ctx.beginPath(); ctx.arc(xBot1, yBot1, 3.5, 0, 2 * Math.PI); ctx.fill();
                    ctx.beginPath(); ctx.arc(xBot2, yBot2, 3.5, 0, 2 * Math.PI); ctx.fill();

                    // 5. Projected Target Line & Badge
                    if (s.targetPrice !== null && s.targetPrice !== undefined) {
                        const yTarget = mainSeries.priceToCoordinate(s.targetPrice);
                        if (yTarget !== null && yTarget !== undefined) {
                            const startX = Math.min(xTop2, xBot2);
                            const endX = Math.min(drawingCanvas.width - 15, Math.max(xTop2, xBot2) + 120);

                            ctx.save();
                            ctx.beginPath();
                            ctx.moveTo(startX, yTarget);
                            ctx.lineTo(endX, yTarget);
                            ctx.strokeStyle = isBreakdown ? '#ef4444' : '#10b981';
                            ctx.lineWidth = 1.5;
                            ctx.setLineDash([5, 4]);
                            ctx.stroke();

                            const tgtLabel = `🎯 Target ₹${Number(s.targetPrice).toFixed(1)}`;
                            ctx.font = 'bold 9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                            const tW = ctx.measureText(tgtLabel).width;
                            const tBadgeW = tW + 12;
                            const tBadgeH = 18;
                            const tBadgeX = Math.max(10, Math.min(drawingCanvas.width - tBadgeW - 10, endX - tBadgeW));
                            const tBadgeY = Math.max(8, yTarget - tBadgeH / 2);

                            ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.94)' : 'rgba(255, 255, 255, 0.94)';
                            ctx.strokeStyle = isBreakdown ? '#ef4444' : '#10b981';
                            ctx.lineWidth = 1;
                            ctx.beginPath();
                            if (ctx.roundRect) ctx.roundRect(tBadgeX, tBadgeY, tBadgeW, tBadgeH, 4);
                            else ctx.rect(tBadgeX, tBadgeY, tBadgeW, tBadgeH);
                            ctx.fill();
                            ctx.stroke();

                            ctx.fillStyle = isBreakdown ? '#f87171' : '#34d399';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillText(tgtLabel, tBadgeX + tBadgeW / 2, tBadgeY + tBadgeH / 2);
                            ctx.restore();
                        }
                    }

                    // 6. Stop Loss / Invalidation Line & Badge
                    if (s.stopPrice !== null && s.stopPrice !== undefined) {
                        const yStop = mainSeries.priceToCoordinate(s.stopPrice);
                        if (yStop !== null && yStop !== undefined) {
                            const startX = Math.min(xTop2, xBot2);
                            const endX = Math.min(drawingCanvas.width - 15, Math.max(xTop2, xBot2) + 100);

                            ctx.save();
                            ctx.beginPath();
                            ctx.moveTo(startX, yStop);
                            ctx.lineTo(endX, yStop);
                            ctx.strokeStyle = '#f59e0b';
                            ctx.lineWidth = 1.5;
                            ctx.setLineDash([4, 4]);
                            ctx.stroke();

                            const stopLabel = `🛑 Stop ₹${Number(s.stopPrice).toFixed(1)}`;
                            ctx.font = 'bold 9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                            const sW = ctx.measureText(stopLabel).width;
                            const sBadgeW = sW + 12;
                            const sBadgeH = 18;
                            const sBadgeX = Math.max(10, Math.min(drawingCanvas.width - sBadgeW - 10, endX - sBadgeW));
                            const sBadgeY = Math.max(8, yStop - sBadgeH / 2);

                            ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.94)' : 'rgba(255, 255, 255, 0.94)';
                            ctx.strokeStyle = '#f59e0b';
                            ctx.lineWidth = 1;
                            ctx.beginPath();
                            if (ctx.roundRect) ctx.roundRect(sBadgeX, sBadgeY, sBadgeW, sBadgeH, 4);
                            else ctx.rect(sBadgeX, sBadgeY, sBadgeW, sBadgeH);
                            ctx.fill();
                            ctx.stroke();

                            ctx.fillStyle = '#fbbf24';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillText(stopLabel, sBadgeX + sBadgeW / 2, sBadgeY + sBadgeH / 2);
                            ctx.restore();
                        }
                    }

                    // 7. Breakdown Reference Ray
                    if (s.breakdownPrice !== null && s.breakdownPrice !== undefined) {
                        const yBd = mainSeries.priceToCoordinate(s.breakdownPrice);
                        if (yBd !== null && yBd !== undefined) {
                            const bdStartX = xBot2;
                            const bdEndX = Math.min(drawingCanvas.width - 15, xBot2 + 110);

                            ctx.save();
                            ctx.beginPath();
                            ctx.moveTo(bdStartX, yBd);
                            ctx.lineTo(bdEndX, yBd);
                            ctx.strokeStyle = '#ef4444';
                            ctx.lineWidth = 2;
                            ctx.stroke();

                            const bdLabel = `🔻 Breakdown ₹${Number(s.breakdownPrice).toFixed(1)}`;
                            ctx.font = 'bold 9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                            const bW = ctx.measureText(bdLabel).width;
                            const bBadgeW = bW + 12;
                            const bBadgeH = 18;
                            const bBadgeX = Math.max(10, Math.min(drawingCanvas.width - bBadgeW - 10, bdEndX - bBadgeW));
                            const bBadgeY = Math.max(8, yBd - bBadgeH / 2);

                            ctx.fillStyle = isDark ? 'rgba(30, 10, 10, 0.94)' : 'rgba(254, 242, 242, 0.94)';
                            ctx.strokeStyle = '#ef4444';
                            ctx.lineWidth = 1;
                            ctx.beginPath();
                            if (ctx.roundRect) ctx.roundRect(bBadgeX, bBadgeY, bBadgeW, bBadgeH, 4);
                            else ctx.rect(bBadgeX, bBadgeY, bBadgeW, bBadgeH);
                            ctx.fill();
                            ctx.stroke();

                            ctx.fillStyle = '#ef4444';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillText(bdLabel, bBadgeX + bBadgeW / 2, bBadgeY + bBadgeH / 2);
                            ctx.restore();
                        }
                    }

                    // 8. Refined Pattern Identification HUD Banner
                    if (s.name) {
                        ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                        const textW = ctx.measureText(s.name).width;
                        const badgeW = textW + 16;
                        const badgeH = 20;
                        const badgeX = Math.max(10, Math.min(drawingCanvas.width - badgeW - 10, (xTop1 + xTop2) / 2 - badgeW / 2));
                        const badgeY = Math.max(8, Math.min(yTop1, yTop2) - badgeH - 6);

                        ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.94)' : 'rgba(255, 255, 255, 0.94)';
                        ctx.strokeStyle = isBreakdown ? '#ef4444' : (isBreakout ? '#10b981' : '#6366f1');
                        ctx.lineWidth = 1.5;
                        ctx.beginPath();
                        if (ctx.roundRect) ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
                        else ctx.rect(badgeX, badgeY, badgeW, badgeH);
                        ctx.fill();
                        ctx.stroke();

                        ctx.fillStyle = isBreakdown ? '#ef4444' : (isBreakout ? '#10b981' : (isDark ? '#e0e7ff' : '#4338ca'));
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(s.name, badgeX + badgeW / 2, badgeY + badgeH / 2);
                    }
                    ctx.restore();
                }
            } else if (s.type === 'channel') {
                const xTop1 = getShapeX(timeScale, s.time1_top, s.logical1_top, 0);
                const yTop1 = mainSeries.priceToCoordinate(s.price1_top);
                const xTop2 = getShapeX(timeScale, s.time2_top, s.logical2_top, 0);
                const yTop2 = mainSeries.priceToCoordinate(s.price2_top);

                const xBot1 = getShapeX(timeScale, s.time1_bot, s.logical1_bot, 0);
                const yBot1 = mainSeries.priceToCoordinate(s.price1_bot);
                const xBot2 = getShapeX(timeScale, s.time2_bot, s.logical2_bot, 0);
                const yBot2 = mainSeries.priceToCoordinate(s.price2_bot);

                if (xTop1 !== null && yTop1 !== null && xTop2 !== null && yTop2 !== null &&
                    xBot1 !== null && yBot1 !== null && xBot2 !== null && yBot2 !== null) {
                    ctx.save();

                    // Shaded Channel Body
                    ctx.beginPath();
                    ctx.moveTo(xTop1, yTop1);
                    ctx.lineTo(xTop2, yTop2);
                    ctx.lineTo(xBot2, yBot2);
                    ctx.lineTo(xBot1, yBot1);
                    ctx.closePath();
                    ctx.fillStyle = s.fillColor || 'rgba(56, 189, 248, 0.10)';
                    ctx.fill();

                    // Upper Channel Line
                    ctx.beginPath();
                    ctx.moveTo(xTop1, yTop1);
                    ctx.lineTo(xTop2, yTop2);
                    ctx.strokeStyle = s.topColor || '#38bdf8';
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    // Lower Channel Line
                    ctx.beginPath();
                    ctx.moveTo(xBot1, yBot1);
                    ctx.lineTo(xBot2, yBot2);
                    ctx.strokeStyle = s.botColor || '#38bdf8';
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    // Midline dashed
                    ctx.beginPath();
                    ctx.moveTo((xTop1 + xBot1) / 2, (yTop1 + yBot1) / 2);
                    ctx.lineTo((xTop2 + xBot2) / 2, (yTop2 + yBot2) / 2);
                    ctx.strokeStyle = s.topColor || '#38bdf8';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 4]);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // Vertex handle dots
                    ctx.fillStyle = s.topColor || '#38bdf8';
                    ctx.beginPath(); ctx.arc(xTop1, yTop1, 3.5, 0, 2 * Math.PI); ctx.fill();
                    ctx.beginPath(); ctx.arc(xTop2, yTop2, 3.5, 0, 2 * Math.PI); ctx.fill();
                    ctx.beginPath(); ctx.arc(xBot1, yBot1, 3.5, 0, 2 * Math.PI); ctx.fill();
                    ctx.beginPath(); ctx.arc(xBot2, yBot2, 3.5, 0, 2 * Math.PI); ctx.fill();

                    // Channel Label
                    if (s.name) {
                        ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                        const textW = ctx.measureText(s.name).width;
                        const badgeW = textW + 14;
                        const badgeH = 18;
                        const badgeX = Math.max(10, Math.min(drawingCanvas.width - badgeW - 10, (xTop2 + xBot2) / 2 - badgeW / 2));
                        const badgeY = Math.max(10, (yTop2 + yBot2) / 2 - badgeH / 2);

                        ctx.fillStyle = isDark ? 'rgba(30, 34, 45, 0.92)' : 'rgba(255, 255, 255, 0.92)';
                        ctx.strokeStyle = '#38bdf8';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        if (ctx.roundRect) ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
                        else ctx.rect(badgeX, badgeY, badgeW, badgeH);
                        ctx.fill();
                        ctx.stroke();

                        ctx.fillStyle = isDark ? '#bae6fd' : '#0369a1';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(s.name, badgeX + badgeW / 2, badgeY + badgeH / 2);
                    }
                    ctx.restore();
                }
            } else if (s.type === 'rectangle') {
                const x1 = getShapeX(timeScale, s.time1, s.logical1, s.futureOffset1, s.futureTime1, s.timeframe);
                const y1 = mainSeries.priceToCoordinate(s.price1);
                const x2 = getShapeX(timeScale, s.time2, s.logical2, s.futureOffset2, s.futureTime2, s.timeframe);
                const y2 = mainSeries.priceToCoordinate(s.price2);

                if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
                    ctx.save();
                    const rectX = Math.min(x1, x2);
                    const rectY = Math.min(y1, y2);
                    const w = Math.abs(x2 - x1);
                    const h = Math.abs(y2 - y1);

                    ctx.fillStyle = s.fillColor || 'rgba(168, 85, 247, 0.18)';
                    ctx.fillRect(rectX, rectY, w, h);

                    ctx.strokeStyle = s.color || '#a855f7';
                    const lw = s.lineWidth || 1.5;
                    ctx.lineWidth = lw;
                    if (s.isPreview) {
                        ctx.setLineDash([4, 4]);
                    } else if (s.lineStyle === 'dotted') {
                        ctx.setLineDash([2, 3]);
                    } else if (s.lineStyle === 'dashed') {
                        ctx.setLineDash([6, 4]);
                    } else {
                        ctx.setLineDash([]);
                    }
                    ctx.strokeRect(rectX, rectY, w, h);

                    if (!s.isPreview) {
                        ctx.fillStyle = '#ffffff';
                        ctx.strokeStyle = s.color || '#a855f7';
                        ctx.lineWidth = 2;
                        const midX = rectX + w / 2;
                        const midY = rectY + h / 2;

                        // 4 Corners
                        ctx.beginPath(); ctx.arc(rectX, rectY, 3.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                        ctx.beginPath(); ctx.arc(rectX + w, rectY, 3.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                        ctx.beginPath(); ctx.arc(rectX, rectY + h, 3.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                        ctx.beginPath(); ctx.arc(rectX + w, rectY + h, 3.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();

                        // 4 Edge Midpoints
                        ctx.beginPath(); ctx.arc(midX, rectY, 3, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                        ctx.beginPath(); ctx.arc(midX, rectY + h, 3, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                        ctx.beginPath(); ctx.arc(rectX, midY, 3, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                        ctx.beginPath(); ctx.arc(rectX + w, midY, 3, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                    }

                    // Custom text or "+ Add text" for rectangle
                    const popupEl = document.getElementById('canvasObjectPopup');
                    const isSelected = (popupEl && popupEl.style.display !== 'none' && popupEl.dataset.activeObjKind === 'shape' && popupEl.dataset.activeObjId === String(s.id));
                    if (s.text && s.text.trim()) {
                        const customText = s.text.trim();
                        const fontSize = s.fontSize || 12;
                        const fontColor = s.textColor || s.color || '#ffffff';
                        const pos = s.textPos || 'center';
                        const valign = s.textValign || 'top';

                        let tx = rectX + w / 2;
                        let textAlign = 'center';
                        if (pos === 'left') {
                            tx = rectX + 12;
                            textAlign = 'left';
                        } else if (pos === 'right') {
                            tx = rectX + w - 12;
                            textAlign = 'right';
                        }

                        let ty = rectY + 14;
                        let textBase = 'middle';
                        if (valign === 'middle') {
                            ty = rectY + h / 2;
                        } else if (valign === 'bottom') {
                            ty = rectY + h - 14;
                        }

                        ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
                        ctx.fillStyle = fontColor;
                        ctx.textAlign = textAlign;
                        ctx.textBaseline = textBase;
                        ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
                        ctx.shadowBlur = 3;
                        ctx.fillText(customText, tx, ty);
                    } else if (isSelected && !s.isPreview) {
                        renderAddTextBadge(ctx, rectX + w / 2, rectY + 16, 'shape', s.id, isDark);
                    }

                    ctx.restore();
                }
            } else if (s.type === 'vertical') {
                const x = getShapeX(timeScale, s.time, s.logical, s.futureOffset, s.futureTime, s.timeframe);
                if (x !== null) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, drawingCanvas.height);
                    ctx.strokeStyle = s.color || '#f59e0b';
                    const lw = s.lineWidth || 1.5;
                    ctx.lineWidth = lw;
                    if (s.lineStyle === 'dotted') {
                        ctx.setLineDash([2, 3]);
                    } else if (s.lineStyle === 'solid') {
                        ctx.setLineDash([]);
                    } else {
                        ctx.setLineDash([5, 5]);
                    }
                    ctx.stroke();

                    // Draw top tag
                    ctx.fillStyle = s.color || '#f59e0b';
                    ctx.fillRect(x - 22, 4, 44, 16);
                    ctx.fillStyle = '#ffffff';
                    ctx.font = '10px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('TIME', x, 16);
                    ctx.restore();
                }
            } else if (s.type === 'note') {
                const x = getShapeX(timeScale, s.time, s.logical, s.futureOffset, s.futureTime, s.timeframe);
                const y = mainSeries.priceToCoordinate(s.price);

                if (x !== null && y !== null) {
                    ctx.save();
                    // Draw pin point
                    ctx.fillStyle = s.color || '#10b981';
                    ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI); ctx.fill();

                    // Draw note pill
                    const text = s.text || 'Note';
                    ctx.font = '11px sans-serif';
                    const textWidth = ctx.measureText(text).width;
                    const pillW = textWidth + 14;
                    const pillH = 20;

                    ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.95)';
                    ctx.strokeStyle = s.color || '#10b981';
                    ctx.lineWidth = 1;
                    ctx.fillRect(x + 8, y - 10, pillW, pillH);
                    ctx.strokeRect(x + 8, y - 10, pillW, pillH);

                    ctx.fillStyle = isDark ? '#ffffff' : '#0f172a';
                    ctx.textAlign = 'left';
                    ctx.fillText(text, x + 15, y + 4);
                    ctx.restore();
                }
            } else if (s.type === 'horizontal') {
                const y = mainSeries.priceToCoordinate(s.price);
                if (y !== null && y !== undefined) {
                    ctx.save();
                    ctx.beginPath();
                    let startX = 0;
                    if (s.time1) {
                        const x1 = getShapeX(timeScale, s.time1, s.logical1, 0, s.futureTime1, s.timeframe);
                        if (x1 !== null && x1 !== undefined) startX = x1;
                    }
                    let endX = drawingCanvas.width;
                    if (s.time2) {
                        const x2 = getShapeX(timeScale, s.time2, s.logical2, s.futureOffset2 || 0, s.futureTime2, s.timeframe);
                        if (x2 !== null && x2 !== undefined) endX = x2;
                    }
                    ctx.moveTo(startX, y);
                    ctx.lineTo(endX, y);
                    ctx.strokeStyle = s.color || '#3b82f6';
                    ctx.lineWidth = s.lineWidth || 1.5;
                    if (s.lineStyle === 'dashed') ctx.setLineDash([5, 4]);
                    else if (s.lineStyle === 'dotted') ctx.setLineDash([2, 3]);
                    else ctx.setLineDash([]);
                    ctx.stroke();

                    if (s.name) {
                        ctx.font = 'bold 9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                        const textW = ctx.measureText(s.name).width;
                        const badgeW = textW + 12;
                        const badgeH = 18;
                        const badgeX = Math.max(10, Math.min(drawingCanvas.width - badgeW - 10, endX - badgeW));
                        const badgeY = Math.max(8, y - badgeH / 2);

                        ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.94)' : 'rgba(255, 255, 255, 0.94)';
                        ctx.strokeStyle = s.color || '#3b82f6';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        if (ctx.roundRect) ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
                        else ctx.rect(badgeX, badgeY, badgeW, badgeH);
                        ctx.fill();
                        ctx.stroke();

                        ctx.fillStyle = s.color || '#3b82f6';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(s.name, badgeX + badgeW / 2, badgeY + badgeH / 2);
                    }
                    ctx.restore();
                }
            }
        }

        let indicatorDataMap = new Map();
        let isSyncingTimeScale = false;
        let chartResizeObserver = null;

        function buildIndicatorDataMap(data) {
            indicatorDataMap.clear();
            if (!data) return;

            const map = indicatorDataMap;

            const addSeriesToMap = (arr, fieldName) => {
                if (!arr || !Array.isArray(arr)) return;
                for (let i = 0; i < arr.length; i++) {
                    const item = arr[i];
                    if (!item || item.time === undefined) continue;
                    let record = map.get(item.time);
                    if (!record) {
                        record = {};
                        map.set(item.time, record);
                    }
                    record[fieldName] = item.value !== undefined ? item.value : item;
                }
            };

            if (data.candles && Array.isArray(data.candles)) {
                for (let i = 0; i < data.candles.length; i++) {
                    const c = data.candles[i];
                    map.set(c.time, { candle: c });
                }
            }

            addSeriesToMap(data.volume, 'vol');
            addSeriesToMap(data.volume_ma, 'vol_ma');
            addSeriesToMap(data.cdrider, 'cdrider');
            if (data.st_trigger_series && Array.isArray(data.st_trigger_series)) {
                data.st_trigger_series.forEach(item => {
                    if (item && item.time) {
                        const r = map.get(item.time) || {};
                        r.st_trigger = item.trigger;
                        r.st_direction = item.direction;
                        r.st_dist_pct = item.dist_pct;
                        r.st_dist_pts = item.dist_pts;
                        map.set(item.time, r);
                    }
                });
            }
            addSeriesToMap(data.donchian_upper, 'donchian_upper');
            addSeriesToMap(data.donchian_middle, 'donchian_middle');
            addSeriesToMap(data.donchian_lower, 'donchian_lower');
            addSeriesToMap(data.sma50, 'sma50');
            addSeriesToMap(data.sma200, 'sma200');
            addSeriesToMap(data.ema9, 'ema9');
            addSeriesToMap(data.gann_2day, 'gann_2day');
            addSeriesToMap(data.rsi, 'rsi');
            addSeriesToMap(data.macd_line, 'macd');
            addSeriesToMap(data.macd_signal, 'macdSignal');
            addSeriesToMap(data.macd_hist, 'macdHist');
        }

        function calculateVolumeMa(volumeData, period = 20) {
            if (!volumeData || !Array.isArray(volumeData) || volumeData.length === 0) return [];
            const result = [];
            let sum = 0;
            for (let i = 0; i < volumeData.length; i++) {
                sum += (volumeData[i].value || 0);
                if (i >= period) {
                    sum -= (volumeData[i - period].value || 0);
                    result.push({
                        time: volumeData[i].time,
                        value: Math.round(sum / period)
                    });
                } else {
                    result.push({
                        time: volumeData[i].time,
                        value: Math.round(sum / (i + 1))
                    });
                }
            }
            return result;
        }

        function zoomChart(factor) {
            if (!mainChart) return;
            const timeScale = mainChart.timeScale();
            const range = timeScale.getVisibleLogicalRange();
            if (!range) return;
            const center = (range.from + range.to) / 2;
            const halfLength = ((range.to - range.from) / 2) / factor;
            timeScale.setVisibleLogicalRange({
                from: center - halfLength,
                to: center + halfLength
            });
        }

        function resetChartView() {
            yAxisScaleMultiplier = 1.0;
            yAxisPanOffset = 0.0;
            if (mainSeries) {
                try { mainSeries.applyOptions({}); } catch(e){}
            }
            if (mainChart) {
                mainChart.timeScale().fitContent();
                mainChart.priceScale('right').applyOptions({ autoScale: true });
                try {
                    mainChart.priceScale('').applyOptions({
                        autoScale: true,
                        scaleMargins: { top: 0.8, bottom: 0 }
                    });
                } catch(e){}
            }
            if (rsiChart) {
                rsiChart.timeScale().fitContent();
            }
            if (macdChart) {
                macdChart.timeScale().fitContent();
            }
            requestAnimationFrame(() => redrawCanvasOverlay());
        }

        function resizeChartPanes() {
            requestAnimationFrame(() => {
                const mainContainer = document.getElementById('mainChartPane');
                const rsiContainer = document.getElementById('rsiChartPane');
                const macdContainer = document.getElementById('macdChartPane');

                if (mainChart && mainContainer && mainContainer.clientWidth > 0) {
                    mainChart.applyOptions({ width: mainContainer.clientWidth, height: mainContainer.clientHeight });
                }
                if (rsiChart && rsiContainer && rsiContainer.clientWidth > 0) {
                    rsiChart.applyOptions({ width: rsiContainer.clientWidth, height: rsiContainer.clientHeight });
                }
                if (macdChart && macdContainer && macdContainer.clientWidth > 0) {
                    macdChart.applyOptions({ width: macdContainer.clientWidth, height: macdContainer.clientHeight });
                }
                if (mainChart) {
                    const range = mainChart.timeScale().getVisibleLogicalRange();
                    if (range) {
                        if (rsiChart) try { rsiChart.timeScale().setVisibleLogicalRange(range); } catch(e){}
                        if (macdChart) try { macdChart.timeScale().setVisibleLogicalRange(range); } catch(e){}
                    }
                }
                resizeDrawingCanvas();
            });
        }

        function openInHouseChart(sym, targetInterval, patternMarkers, patternDrawings, patternIndicators) {
            if (!sym) return;
            clearTempMeasure();
            currentChartSymbol = sym;
            currentChartRange = '3y';
            if (targetInterval) {
                currentChartInterval = targetInterval;
            } else {
                try {
                    const saved = localStorage.getItem('capital_desk_chart_interval');
                    if (saved) {
                        currentChartInterval = saved;
                    }
                } catch(e) {}
            }
            if (!currentChartInterval) currentChartInterval = '1d';

            window.activePatternMarkers = (Array.isArray(patternMarkers) && patternMarkers.length > 0) ? patternMarkers : [];
            window.activePatternShapes = (Array.isArray(patternDrawings) && patternDrawings.length > 0) ? patternDrawings : [];
            window.activePatternIndicators = patternIndicators || null;
            
            const modal = document.getElementById('chartModal');
            if (modal) {
                modal.style.display = 'block';
                if (typeof window.bringModalToFront === 'function') {
                    window.bringModalToFront(modal);
                }
            }

            const info = (typeof stockPricesData !== 'undefined' && stockPricesData[sym]) ? stockPricesData[sym] : {};
            const symDisplay = document.getElementById('chartSymbolDisplay');
            const nameDisplay = document.getElementById('chartNameDisplay');
            const cleanSym = sym ? sym.replace('.NS', '').replace('.BO', '') : '';
            if (symDisplay) {
                symDisplay.innerText = cleanSym || sym;
                symDisplay.setAttribute('data-full-symbol', sym);
            }
            if (nameDisplay) nameDisplay.innerText = info.name || cleanSym || sym;

            // Remove any existing empty chart overlay when opening new symbol
            const existingEmptyOverlay = document.getElementById('chartEmptyStateOverlay');
            if (existingEmptyOverlay) existingEmptyOverlay.remove();

            const intervalLabel = document.getElementById('intervalBtnLabel');
            if (intervalLabel) intervalLabel.innerHTML = '<span class="btn-icon">⏱️</span><span class="btn-text"> ' + getIntervalDisplayLabel(currentChartInterval) + '</span>';

            document.querySelectorAll('#popover-interval .int-btn').forEach(btn => {
                btn.classList.toggle('active', btn.id === `int-${currentChartInterval}`);
            });

            const rangeLabel = document.getElementById('rangeBtnLabel');
            if (rangeLabel) rangeLabel.innerHTML = '<span class="btn-icon">📅</span><span class="btn-text"> 3Y</span>';

            document.querySelectorAll('#popover-range .tf-btn').forEach(btn => {
                btn.classList.toggle('active', btn.id === 'tf-3y');
            });

            renderFavoriteToolsShortcuts();
            initMobileFavBarDrag();

            loadChartData();
        }

        function openChart(sym, targetInterval, patternMarkers, patternDrawings, patternIndicators) {
            openInHouseChart(sym, targetInterval, patternMarkers, patternDrawings, patternIndicators);
        }

        function changeRange(rangeStr) {
            currentChartRange = rangeStr;
            const btnLabel = document.getElementById('rangeBtnLabel');
            if (btnLabel) btnLabel.innerHTML = '<span class="btn-icon">📅</span><span class="btn-text"> ' + rangeStr.toUpperCase() + '</span>';

            document.querySelectorAll('#popover-range .tf-btn').forEach(btn => {
                btn.classList.toggle('active', btn.id === `tf-${rangeStr}`);
            });
            loadChartData();
        }

        let pendingTimeframeSwitchRange = null;

        function changeInterval(intervalStr) {
            if (mainChart) {
                try {
                    const timeScale = mainChart.timeScale();
                    const visRange = timeScale.getVisibleRange();
                    if (visRange && visRange.from && visRange.to) {
                        pendingTimeframeSwitchRange = {
                            fromEpoch: timeToEpochSeconds(visRange.from),
                            toEpoch: timeToEpochSeconds(visRange.to)
                        };
                    }
                } catch(e) {}
            }

            currentChartInterval = intervalStr;
            try {
                localStorage.setItem('capital_desk_chart_interval', intervalStr);
            } catch(e) {}
            const btnLabel = document.getElementById('intervalBtnLabel');
            if (btnLabel) btnLabel.innerHTML = '<span class="btn-icon">⏱️</span><span class="btn-text"> ' + getIntervalDisplayLabel(intervalStr) + '</span>';

            document.querySelectorAll('#popover-interval .int-btn').forEach(btn => {
                btn.classList.toggle('active', btn.id === `int-${intervalStr}`);
            });
            loadChartData();
        }

        function setChartInterval(intervalStr) {
            changeInterval(intervalStr);
        }

        function setChartType(type) {
            chartType = type;
            const btnLabel = document.getElementById('typeBtnLabel');
            if (btnLabel) {
                if (type === 'candlestick') btnLabel.innerHTML = '<span class="btn-icon">🕯️</span><span class="btn-text"> Candles</span>';
                else if (type === 'line') btnLabel.innerHTML = '<span class="btn-icon">📈</span><span class="btn-text"> Line</span>';
                else if (type === 'area') btnLabel.innerHTML = '<span class="btn-icon">🌊</span><span class="btn-text"> Area</span>';
            }

            document.querySelectorAll('#popover-type .tf-btn').forEach(btn => {
                btn.classList.toggle('active', (
                    (type === 'candlestick' && btn.id === 'chart-type-candles') ||
                    (type === 'line' && btn.id === 'chart-type-line') ||
                    (type === 'area' && btn.id === 'chart-type-area')
                ));
            });

            if (cachedChartData) {
                renderInHouseCharts(cachedChartData);
            }
        }

        function showChartLoader(symbol, interval, range) {
            const overlay = document.getElementById('chartLoaderOverlay');
            if (overlay) {
                const symLabel = document.getElementById('chartLoaderSymbol');
                if (symLabel) {
                    const symTxt = symbol || currentChartSymbol || 'Stock';
                    const intTxt = (interval || currentChartInterval || '1d').toUpperCase();
                    const rngTxt = (range || currentChartRange || '3y').toUpperCase();
                    symLabel.innerText = `${symTxt} · ${intTxt} · ${rngTxt}`;
                }
                overlay.style.display = 'flex';
                overlay.style.opacity = '1';
            }
        }

        function hideChartLoader() {
            const overlay = document.getElementById('chartLoaderOverlay');
            if (overlay) {
                overlay.style.opacity = '0';
                setTimeout(() => {
                    if (overlay.style.opacity === '0') {
                        overlay.style.display = 'none';
                    }
                }, 200);
            }
        }

        async function loadChartData() {
            showChartLoader(currentChartSymbol, currentChartInterval, currentChartRange);
            try {
                const res = await fetch(`/api/chart_history?symbol=${encodeURIComponent(currentChartSymbol)}&range=${currentChartRange}&interval=${currentChartInterval}`);
                const data = await res.json();

                if (data.error) {
                    hideChartLoader();
                    showEmptyChartState(data.error);
                    return;
                }

                const cleanSym = data.symbol ? data.symbol.replace('.NS', '').replace('.BO', '') : '';
                const symDisplay = document.getElementById('chartSymbolDisplay');
                const nameDisplay = document.getElementById('chartNameDisplay');
                if (symDisplay) {
                    symDisplay.innerText = cleanSym || data.symbol;
                    symDisplay.setAttribute('data-full-symbol', data.symbol);
                }
                if (nameDisplay) nameDisplay.innerText = data.name || cleanSym || data.symbol;

                const emptyOverlay = document.getElementById('chartEmptyStateOverlay');
                if (emptyOverlay) emptyOverlay.remove();

                renderInHouseCharts(data);
            } catch (err) {
                console.error('Chart fetch error:', err);
                hideChartLoader();
                showEmptyChartState(err.message || 'Error loading chart data');
            } finally {
                hideChartLoader();
            }
        }

        function formatChartAxisDate(time) {
            if (time === null || time === undefined) return '';
            let d = null;
            if (typeof time === 'number') {
                d = new Date(time * 1000);
            } else if (typeof time === 'string') {
                d = new Date(time);
            } else if (typeof time === 'object' && time !== null && time.year && time.month && time.day) {
                d = new Date(Date.UTC(time.year, time.month - 1, time.day));
            }
            if (!d || isNaN(d.getTime())) return String(time);

            const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

            let weekday = '', day = '', month = '', year = '';
            try {
                const options = { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', year: '2-digit' };
                const formatter = new Intl.DateTimeFormat('en-IN', options);
                const parts = formatter.formatToParts(d);
                for (const p of parts) {
                    if (p.type === 'weekday') weekday = p.value;
                    else if (p.type === 'day') day = p.value;
                    else if (p.type === 'month') month = p.value;
                    else if (p.type === 'year') year = p.value;
                }
            } catch(e){}

            if (!weekday || !day || !month || !year) {
                weekday = weekdayNames[d.getUTCDay()];
                day = String(d.getUTCDate()).padStart(2, '0');
                month = monthNames[d.getUTCMonth()];
                year = String(d.getUTCFullYear()).slice(-2);
            }

            weekday = weekday.replace('.', '').trim();
            month = month.replace('.', '').trim();
            day = String(day).padStart(2, '0');

            return `${weekday} ${day} ${month} '${year}`;
        }

        const CHART_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        function parseTickTime(time) {
            if (typeof time === 'string') {
                const parts = time.split('-');
                if (parts.length >= 3) {
                    return {
                        year: parseInt(parts[0], 10),
                        month: parseInt(parts[1], 10),
                        day: parseInt(parts[2], 10),
                        hours: 0,
                        minutes: 0
                    };
                }
            } else if (typeof time === 'object' && time !== null) {
                if (time.year !== undefined) {
                    return {
                        year: time.year,
                        month: time.month,
                        day: time.day,
                        hours: 0,
                        minutes: 0
                    };
                }
            } else if (typeof time === 'number') {
                const d = new Date(time * 1000);
                return {
                    year: d.getFullYear(),
                    month: d.getMonth() + 1,
                    day: d.getDate(),
                    hours: d.getHours(),
                    minutes: d.getMinutes()
                };
            }
            const d = new Date(time);
            return {
                year: d.getFullYear(),
                month: d.getMonth() + 1,
                day: d.getDate(),
                hours: d.getHours(),
                minutes: d.getMinutes()
            };
        }

        function getVisibleBarsCount() {
            try {
                if (mainChart) {
                    const range = mainChart.timeScale().getVisibleLogicalRange();
                    if (range && typeof range.from === 'number' && typeof range.to === 'number') {
                        return Math.max(1, range.to - range.from);
                    }
                }
            } catch(e) {}
            if (cachedChartData && cachedChartData.candles) {
                return cachedChartData.candles.length;
            }
            return 100;
        }

        function formatCrosshairBadgeTime(time) {
            const pt = parseTickTime(time);
            if (!pt || isNaN(pt.year)) return String(time);
            const intv = (currentChartInterval || '1d').toLowerCase();
            if (['5m', '15m', '30m', '60m', '1h'].includes(intv)) {
                const hh = String(pt.hours).padStart(2, '0');
                const mm = String(pt.minutes).padStart(2, '0');
                return `${pt.day} ${CHART_MONTH_NAMES[pt.month - 1]} ${pt.year} ${hh}:${mm}`;
            }
            if (intv === '1mo' || intv === '1m') {
                return `${CHART_MONTH_NAMES[pt.month - 1]} ${pt.year}`;
            }
            return `${pt.day} ${CHART_MONTH_NAMES[pt.month - 1]} ${pt.year}`;
        }

        function formatChartTickMark(time, tickMarkType, locale) {
            const pt = parseTickTime(time);
            if (!pt || isNaN(pt.year)) return '';

            const interval = (currentChartInterval || '1d').toLowerCase();
            const visibleBars = getVisibleBarsCount();

            // 1. MONTHLY FREQUENCY ('1mo' or '1m')
            if (interval === '1mo' || interval === '1m') {
                // Too many candles (Image 1): Only show 4-digit years (e.g. 2019, 2020, 2021...)
                const isTooMany = visibleBars > 28;
                if (isTooMany) {
                    if (tickMarkType === 0 || pt.month === 1) {
                        return String(pt.year);
                    }
                    return '';
                }
                // Expanded (Image 2): Mar, May, Jul, Sep, Nov, 2026, Mar, May...
                if (tickMarkType === 0 || pt.month === 1) {
                    return String(pt.year);
                }
                return CHART_MONTH_NAMES[pt.month - 1];
            }

            // 2. WEEKLY FREQUENCY ('1wk' or '1w')
            if (interval === '1wk' || interval === '1w') {
                // Too many candles (Image 3): Nov, 2025, Mar, May, Jul, Sep, Nov, 2026... (no days)
                const isTooMany = visibleBars > 45;
                if (isTooMany) {
                    if (tickMarkType === 0 || pt.month === 1) {
                        return String(pt.year);
                    }
                    if (tickMarkType === 1 || pt.day <= 7) {
                        return CHART_MONTH_NAMES[pt.month - 1];
                    }
                    return '';
                }
                // Expanded (Image 4): May, 18, Jun, 15, Jul, 20, Aug, 17, Sep, 21, Oct, 19...
                if (tickMarkType === 0 || (pt.month === 1 && pt.day <= 7)) {
                    return String(pt.year);
                }
                if (tickMarkType === 1 || pt.day <= 7) {
                    return CHART_MONTH_NAMES[pt.month - 1];
                }
                return String(pt.day);
            }

            // 3. DAILY FREQUENCY ('1d')
            if (interval === '1d') {
                // Too many candles (Image 5): Apr, May, Jun, Jul, Aug, Sep, Oct... (no days)
                const isTooMany = visibleBars > 55;
                if (isTooMany) {
                    if (tickMarkType === 0 || pt.month === 1) {
                        return String(pt.year);
                    }
                    if (tickMarkType === 1 || pt.day <= 3) {
                        return CHART_MONTH_NAMES[pt.month - 1];
                    }
                    return '';
                }
                // Expanded: Show month at month start, and show day of month (e.g. 15, 18...)
                if (tickMarkType === 0 || (pt.month === 1 && pt.day <= 3)) {
                    return String(pt.year);
                }
                if (tickMarkType === 1 || pt.day === 1 || pt.day <= 2) {
                    return CHART_MONTH_NAMES[pt.month - 1];
                }
                return String(pt.day);
            }

            // 4. INTRADAY ('5m', '15m', '60m', '1h')
            if (tickMarkType === 3 || tickMarkType === 4) {
                const hh = String(pt.hours).padStart(2, '0');
                const mm = String(pt.minutes).padStart(2, '0');
                return `${hh}:${mm}`;
            }
            if (tickMarkType === 2) {
                return `${pt.day} ${CHART_MONTH_NAMES[pt.month - 1]}`;
            }
            if (tickMarkType === 1) {
                return CHART_MONTH_NAMES[pt.month - 1];
            }
            return String(pt.year);
        }

        function renderInHouseCharts(data) {
            cachedChartData = data;
            window.cachedChartData = data;
            buildIndicatorDataMap(data);

            const mainContainer = document.getElementById('mainChartPane');
            const rsiContainer = document.getElementById('rsiChartPane');
            const macdContainer = document.getElementById('macdChartPane');

            mainContainer.innerHTML = '';
            rsiContainer.innerHTML = '';
            macdContainer.innerHTML = '';
            activePriceLines = [];
            setupChartWatermark();

            if (data.candles && data.candles.length > 0) {
                latestCandlePrice = data.candles[data.candles.length - 1].close;
            }

            const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
            const themeColors = getChartThemeColors(currentTheme);

            const isIntradayInterval = ['5m', '15m', '1h', '60m'].includes(currentChartInterval);

            const baseChartConfig = {
                layout: {
                    background: { type: 'solid', color: themeColors.bgColor },
                    textColor: themeColors.textColor,
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    fontSize: 11
                },
                localization: {
                    locale: 'en-IN',
                    timeFormatter: timestamp => formatCrosshairBadgeTime(timestamp),
                    dateFormatter: timestamp => formatCrosshairBadgeTime(timestamp)
                },
                grid: {
                    vertLines: { color: themeColors.gridColor, style: LightweightCharts.LineStyle.Dotted },
                    horzLines: { color: themeColors.gridColor, style: LightweightCharts.LineStyle.Dotted }
                },
                crosshair: {
                    mode: LightweightCharts.CrosshairMode.Normal,
                    vertLine: { width: 1, color: themeColors.crosshairLineColor, style: LightweightCharts.LineStyle.LargeDashed, labelBackgroundColor: themeColors.crosshairLabelBg },
                    horzLine: { width: 1, color: themeColors.crosshairLineColor, style: LightweightCharts.LineStyle.LargeDashed, labelBackgroundColor: themeColors.crosshairLabelBg }
                },
                handleScroll: { mouseWheel: true, pressedMove: true, horzTouchDrag: true, vertTouchDrag: true },
                handleScale: { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true },
                kineticScroll: { touch: true, mouse: false }
            };

            mainChart = LightweightCharts.createChart(mainContainer, {
                ...baseChartConfig,
                width: mainContainer.clientWidth || 800,
                height: mainContainer.clientHeight || 400,
                rightPriceScale: {
                    borderColor: themeColors.borderColor,
                    autoScale: true,
                    alignLabels: true,
                    entireTextOnly: false,
                    minimumWidth: 75,
                    scaleMargins: {
                        top: 0.08,
                        bottom: 0.25
                    }
                },
                timeScale: {
                    borderColor: themeColors.borderColor,
                    timeVisible: isIntradayInterval,
                    secondsVisible: false,
                    rightOffset: 12,
                    barSpacing: 9,
                    minBarSpacing: 0.3,
                    fixLeftEdge: false,
                    fixRightEdge: false,
                    lockVisibleTimeRangeOnResize: true,
                    rightBarStaysOnScroll: true,
                    tickMarkFormatter: (time, tickMarkType, locale) => formatChartTickMark(time, tickMarkType, locale)
                }
            });
            window.mainChart = mainChart;

            // Safety sort and deduplicate candles and volume_data strictly ascending by time
            if (data.candles && Array.isArray(data.candles)) {
                const candleMap = new Map();
                data.candles.forEach(c => {
                    if (c && c.time !== undefined && c.time !== null) {
                        candleMap.set(c.time, c);
                    }
                });
                data.candles = Array.from(candleMap.values()).sort((a, b) => {
                    if (typeof a.time === 'number' && typeof b.time === 'number') return a.time - b.time;
                    return String(a.time).localeCompare(String(b.time));
                });
            }

            if (data.volume && Array.isArray(data.volume)) {
                const volMap = new Map();
                data.volume.forEach(v => {
                    if (v && v.time !== undefined && v.time !== null) {
                        volMap.set(v.time, v);
                    }
                });
                data.volume = Array.from(volMap.values()).sort((a, b) => {
                    if (typeof a.time === 'number' && typeof b.time === 'number') return a.time - b.time;
                    return String(a.time).localeCompare(String(b.time));
                });
            }

            yAxisScaleMultiplier = 1.0;
            yAxisPanOffset = 0.0;

            if (chartType === 'candlestick') {
                mainSeries = mainChart.addCandlestickSeries({
                    upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
                    autoscaleInfoProvider: customAutoscaleInfo
                });
                mainSeries.setData(data.candles);
            } else if (chartType === 'line') {
                mainSeries = mainChart.addLineSeries({
                    color: '#2563eb', lineWidth: 2,
                    autoscaleInfoProvider: customAutoscaleInfo
                });
                mainSeries.setData(data.candles.map(c => ({ time: c.time, value: c.close })));
            } else if (chartType === 'area') {
                mainSeries = mainChart.addAreaSeries({
                    topColor: 'rgba(37, 99, 235, 0.4)', bottomColor: 'rgba(37, 99, 235, 0.0)', lineColor: '#2563eb', lineWidth: 2,
                    autoscaleInfoProvider: customAutoscaleInfo
                });
                mainSeries.setData(data.candles.map(c => ({ time: c.time, value: c.close })));
            }

            attachDrawingSyncPrimitive(mainSeries);
            window.mainSeries = mainSeries;

            volumeSeries = mainChart.addHistogramSeries({
                color: '#26a69a',
                priceFormat: { type: 'volume' },
                priceScaleId: '',
                priceLineVisible: false,
                lastValueVisible: false,
            });
            if (data.volume) volumeSeries.setData(data.volume);

            // Strictly restrict volume overlay to the bottom 20% of the chart (TradingView standard)
            try {
                mainChart.priceScale('').applyOptions({
                    scaleMargins: {
                        top: 0.8,
                        bottom: 0,
                    },
                });
            } catch(e){}

            // Volume MA (20-period Moving Average)
            const volMaData = (data.volume_ma && data.volume_ma.length > 0)
                ? data.volume_ma
                : calculateVolumeMa(data.volume, 20);
            data.volume_ma = volMaData;

            volumeMaSeries = mainChart.addLineSeries({
                color: '#2962ff',
                lineWidth: 1.5,
                priceScaleId: '',
                priceFormat: { type: 'volume' },
                priceLineVisible: false,
                lastValueVisible: false,
                title: '',
            });
            if (volMaData && volMaData.length > 0) {
                volumeMaSeries.setData(volMaData);
            }

            // Indicators
            cdRiderSeries = mainChart.addLineSeries({ color: '#10b981', lineWidth: 2, title: 'CDRider', visible: false, autoscaleInfoProvider: indicatorAutoscaleInfo });
            if (data.cdrider) cdRiderSeries.setData(data.cdrider);

            const allMarkers = [];
            if (data.cdrider_buy) allMarkers.push(...data.cdrider_buy);
            if (data.cdrider_sell) allMarkers.push(...data.cdrider_sell);
            cachedCdRiderMarkers = allMarkers.sort((a, b) => (typeof a.time === 'number' && typeof b.time === 'number' ? a.time - b.time : 0));

            // BS Donchian Channel (Upper, Middle, Lower bands and B / SB / S signals)
            donchianUpperSeries = mainChart.addLineSeries({ color: '#22c55e', lineWidth: 1, title: 'Donchian Upper', visible: false, autoscaleInfoProvider: indicatorAutoscaleInfo });
            if (data.donchian_upper) donchianUpperSeries.setData(data.donchian_upper);

            donchianMiddleSeries = mainChart.addLineSeries({ color: '#f97316', lineWidth: 1, title: 'Donchian Middle', visible: false, autoscaleInfoProvider: indicatorAutoscaleInfo });
            if (data.donchian_middle) donchianMiddleSeries.setData(data.donchian_middle);

            donchianLowerSeries = mainChart.addLineSeries({ color: '#ef5350', lineWidth: 1, title: 'Donchian Lower', visible: false, autoscaleInfoProvider: indicatorAutoscaleInfo });
            if (data.donchian_lower) donchianLowerSeries.setData(data.donchian_lower);

            const donchianMarkers = [];
            if (data.donchian_buy) donchianMarkers.push(...data.donchian_buy);
            if (data.donchian_super_buy) donchianMarkers.push(...data.donchian_super_buy);
            if (data.donchian_sell) donchianMarkers.push(...data.donchian_sell);
            cachedBsDonchianMarkers = donchianMarkers.sort((a, b) => {
                const ta = typeof a.time === 'number' ? a.time : (new Date(a.time).getTime() || 0);
                const tb = typeof b.time === 'number' ? b.time : (new Date(b.time).getTime() || 0);
                return ta - tb;
            });

            // ST Trigger (Supertrend Trigger Levels 1, 2.5)
            stTriggerSeries = mainChart.addLineSeries({
                color: '#ec4899',
                lineWidth: 2,
                title: 'ST Trigger',
                visible: false,
                autoscaleInfoProvider: indicatorAutoscaleInfo
            });
            if (data.st_trigger_series) stTriggerSeries.setData(data.st_trigger_series);

            cachedStTriggerInfo = data.st_trigger_info || null;

            const stMarkers = [];
            if (data.st_trigger_buy) stMarkers.push(...data.st_trigger_buy);
            if (data.st_trigger_sell) stMarkers.push(...data.st_trigger_sell);
            cachedStTriggerMarkers = stMarkers.sort((a, b) => {
                const ta = typeof a.time === 'number' ? a.time : (new Date(a.time).getTime() || 0);
                const tb = typeof b.time === 'number' ? b.time : (new Date(b.time).getTime() || 0);
                return ta - tb;
            });

            sma50Series = mainChart.addLineSeries({ color: '#ff6d00', lineWidth: 2, title: '50 DMA', autoscaleInfoProvider: indicatorAutoscaleInfo });
            if (data.sma50) sma50Series.setData(data.sma50);

            sma200Series = mainChart.addLineSeries({ color: '#e11d48', lineWidth: 2, title: '200 DMA', autoscaleInfoProvider: indicatorAutoscaleInfo });
            if (data.sma200) sma200Series.setData(data.sma200);

            ema9Series = mainChart.addLineSeries({ color: '#06b6d4', lineWidth: 2, title: 'EMA 9', autoscaleInfoProvider: indicatorAutoscaleInfo });
            if (data.ema9) ema9Series.setData(data.ema9);

            ema21Series = mainChart.addLineSeries({ color: '#a855f7', lineWidth: 2, title: 'EMA 21', autoscaleInfoProvider: indicatorAutoscaleInfo });
            if (data.ema21) ema21Series.setData(data.ema21);

            gann2DaySeries = mainChart.addLineSeries({ color: themeColors.gannColor, lineWidth: 2, title: 'Gann 2-Day Low', autoscaleInfoProvider: indicatorAutoscaleInfo });
            if (data.gann_2day) gann2DaySeries.setData(data.gann_2day);

            const subPaneTimeScaleConfig = {
                visible: false,
                rightOffset: 12,
                barSpacing: 9,
                minBarSpacing: 0.3,
                fixLeftEdge: false,
                fixRightEdge: false,
                lockVisibleTimeRangeOnResize: true,
                rightBarStaysOnScroll: true
            };

            // RSI Sub-Pane Chart
            rsiChart = LightweightCharts.createChart(rsiContainer, {
                ...baseChartConfig,
                width: rsiContainer.clientWidth || 800,
                height: rsiContainer.clientHeight || 150,
                rightPriceScale: { borderColor: themeColors.borderColor, minimumWidth: 75, scaleMargins: { top: 0.1, bottom: 0.1 } },
                timeScale: subPaneTimeScaleConfig
            });

            // Helper to align indicator series 1:1 with candle timestamps using Lightweight Charts whitespace items
            function alignSeriesToCandles(indicatorList, candles) {
                if (!candles || candles.length === 0) return [];
                if (!indicatorList || indicatorList.length === 0) return candles.map(c => ({ time: c.time }));
                const valMap = new Map();
                indicatorList.forEach(item => {
                    if (item && item.time !== undefined) {
                        valMap.set(item.time, item);
                    }
                });
                return candles.map(c => {
                    const match = valMap.get(c.time);
                    if (match !== undefined) {
                        return match;
                    }
                    return { time: c.time };
                });
            }

            rsiSeries = rsiChart.addLineSeries({ color: '#e040fb', lineWidth: 2, title: 'RSI 14' });
            if (data.rsi && data.candles) {
                rsiSeries.setData(alignSeriesToCandles(data.rsi, data.candles));
            } else if (data.rsi) {
                rsiSeries.setData(data.rsi);
            }

            const rsi70 = rsiChart.addLineSeries({ color: '#ef5350', lineWidth: 1, lineStyle: 2 });
            const rsi30 = rsiChart.addLineSeries({ color: '#26a69a', lineWidth: 1, lineStyle: 2 });
            if (data.candles && data.candles.length > 0) {
                rsi70.setData(data.candles.map(item => ({ time: item.time, value: 70 })));
                rsi30.setData(data.candles.map(item => ({ time: item.time, value: 30 })));
            } else if (data.rsi && data.rsi.length > 0) {
                rsi70.setData(data.rsi.map(item => ({ time: item.time, value: 70 })));
                rsi30.setData(data.rsi.map(item => ({ time: item.time, value: 30 })));
            }

            // MACD Sub-Pane Chart
            macdChart = LightweightCharts.createChart(macdContainer, {
                ...baseChartConfig,
                width: macdContainer.clientWidth || 800,
                height: macdContainer.clientHeight || 150,
                rightPriceScale: { borderColor: themeColors.borderColor, minimumWidth: 75, scaleMargins: { top: 0.1, bottom: 0.1 } },
                timeScale: subPaneTimeScaleConfig
            });

            macdHistSeries = macdChart.addHistogramSeries({ title: 'Histogram' });
            if (data.macd_hist && data.candles) {
                macdHistSeries.setData(alignSeriesToCandles(data.macd_hist, data.candles));
            } else if (data.macd_hist) {
                macdHistSeries.setData(data.macd_hist);
            }

            macdLineSeries = macdChart.addLineSeries({ color: '#3b82f6', lineWidth: 2, title: 'MACD' });
            if (data.macd_line && data.candles) {
                macdLineSeries.setData(alignSeriesToCandles(data.macd_line, data.candles));
            } else if (data.macd_line) {
                macdLineSeries.setData(data.macd_line);
            }

            macdSignalSeries = macdChart.addLineSeries({ color: '#f97316', lineWidth: 2, title: 'Signal' });
            if (data.macd_signal && data.candles) {
                macdSignalSeries.setData(alignSeriesToCandles(data.macd_signal, data.candles));
            } else if (data.macd_signal) {
                macdSignalSeries.setData(data.macd_signal);
            }

            // Synchronize Visible Logical Range smoothly and bidirectionally across all panes
            function syncTimeScales(sourceChart, targetCharts) {
                if (!sourceChart) return;
                sourceChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
                    if (isSyncingTimeScale || !range) return;
                    isSyncingTimeScale = true;
                    try {
                        targetCharts.forEach(target => {
                            if (target && target.timeScale) {
                                target.timeScale().setVisibleLogicalRange(range);
                            }
                        });
                    } catch(e) {}
                    isSyncingTimeScale = false;
                });
            }

            syncTimeScales(mainChart, [rsiChart, macdChart]);
            syncTimeScales(rsiChart, [mainChart, macdChart]);
            syncTimeScales(macdChart, [mainChart, rsiChart]);

            // Set initial range on sub-panes to match mainChart
            const initialLogicalRange = mainChart.timeScale().getVisibleLogicalRange();
            if (initialLogicalRange) {
                if (rsiChart) try { rsiChart.timeScale().setVisibleLogicalRange(initialLogicalRange); } catch(e){}
                if (macdChart) try { macdChart.timeScale().setVisibleLogicalRange(initialLogicalRange); } catch(e){}
            }

            // Fast O(1) Crosshair & Legend Update
            mainChart.subscribeCrosshairMove(param => {
                if (!param || !param.time) {
                    if (data.candles && data.candles.length > 0) {
                        const last = data.candles[data.candles.length - 1];
                        const lastVol = data.volume && data.volume.length > 0 ? data.volume[data.volume.length - 1].value : 0;
                        const lastVolMa = data.volume_ma && data.volume_ma.length > 0 ? data.volume_ma[data.volume_ma.length - 1].value : null;
                        updateLegend(last.time, last.open, last.high, last.low, last.close, lastVol, data, null, lastVolMa);
                    }
                    updateRightAxisTimePriceBadge(null);
                    return;
                }

                let o = 0, h = 0, l = 0, c = 0;
                if (chartType === 'candlestick') {
                    const candleData = param.seriesData.get(mainSeries);
                    if (candleData) { o = candleData.open; h = candleData.high; l = candleData.low; c = candleData.close; }
                } else {
                    const lineData = param.seriesData.get(mainSeries);
                    if (lineData) { o = lineData.value; h = lineData.value; l = lineData.value; c = lineData.value; }
                }
                const volData = param.seriesData.get(volumeSeries);
                const volVal = volData ? volData.value : 0;
                const volMaData = volumeMaSeries ? param.seriesData.get(volumeMaSeries) : null;
                const volMaVal = volMaData ? volMaData.value : null;

                updateLegend(param.time, o, h, l, c, volVal, data, param.time, volMaVal);
                updateRightAxisTimePriceBadge(null);
            });

            if (data.candles && data.candles.length > 0) {
                const last = data.candles[data.candles.length - 1];
                const lastVol = data.volume && data.volume.length > 0 ? data.volume[data.volume.length - 1].value : 0;
                const lastVolMa = data.volume_ma && data.volume_ma.length > 0 ? data.volume_ma[data.volume_ma.length - 1].value : null;
                updateLegend(last.time, last.open, last.high, last.low, last.close, lastVol, data, null, lastVolMa);
            }

            setupRightPriceAxisHoverZone();

            // Setup automatic ResizeObserver for smooth resizing on window change or pane toggling
            if (chartResizeObserver) {
                chartResizeObserver.disconnect();
            }
            const bodyContainer = document.querySelector('.chart-body-container');
            if (bodyContainer && window.ResizeObserver) {
                chartResizeObserver = new ResizeObserver(() => {
                    resizeChartPanes();
                    renderFavoriteToolsShortcuts();
                });
                chartResizeObserver.observe(bodyContainer);
            } else {
                window.onresize = function() {
                    resizeChartPanes();
                    renderFavoriteToolsShortcuts();
                };
            }

            // Restore active drawing lines saved for this stock
            restoreSavedPriceLines(currentChartSymbol);
            fetchSymbolDrawingsFromServer(currentChartSymbol);

            setupCanvasOverlay();
            if (mainChart) {
                mainChart.timeScale().subscribeVisibleLogicalRangeChange(() => {
                    if (hasOpenChartPopover()) closeAllChartPopovers();
                    redrawCanvasOverlay();
                });
                mainChart.subscribeCrosshairMove(() => redrawCanvasOverlay());
            }

            toggleIndicators();
            resizeChartPanes();

            // Restore visible logical range if switching intervals
            if (pendingTimeframeSwitchRange && data.candles && data.candles.length > 0) {
                const { fromEpoch, toEpoch } = pendingTimeframeSwitchRange;
                pendingTimeframeSwitchRange = null;

                let fromIdx = -1;
                let toIdx = -1;
                for (let i = 0; i < data.candles.length; i++) {
                    const cEpoch = timeToEpochSeconds(data.candles[i].time);
                    if (fromIdx === -1 && cEpoch >= fromEpoch) {
                        fromIdx = i;
                    }
                    if (cEpoch <= toEpoch) {
                        toIdx = i;
                    }
                }
                if (fromIdx !== -1 && toIdx !== -1 && toIdx >= fromIdx) {
                    const paddedFrom = Math.max(-5, fromIdx - 2);
                    const paddedTo = toIdx + 8;
                    requestAnimationFrame(() => {
                        try {
                            if (mainChart) {
                                mainChart.timeScale().setVisibleLogicalRange({
                                    from: paddedFrom,
                                    to: paddedTo
                                });
                                redrawCanvasOverlay();
                            }
                        } catch(e) {}
                    });
                }
            }

            redrawCanvasOverlay();
            startCandleCountdownTimer();
        }

        let currentRightAxisPrice = null;
        let currentPlusActionPrice = null;
        let candleTimerIntervalId = null;
        let isRightAxisHovered = false;

        let yAxisScaleMultiplier = 1.0;
        let yAxisPanOffset = 0.0;
        let isDraggingPriceScale = false;
        let startDragPriceScaleY = 0;
        let hasDraggedPriceScale = false;

        function customAutoscaleInfo(original) {
            const res = original();
            if (!res || !res.priceRange) return res;
            if (yAxisScaleMultiplier === 1.0 && yAxisPanOffset === 0.0) return res;
            const min = res.priceRange.minValue;
            const max = res.priceRange.maxValue;
            if (min === null || max === null || isNaN(min) || isNaN(max)) return res;
            const span = max - min;
            const center = (min + max) / 2 + yAxisPanOffset;
            const halfSpan = (span / 2) * yAxisScaleMultiplier;
            return {
                priceRange: {
                    minValue: center - halfSpan,
                    maxValue: center + halfSpan
                },
                margins: res.margins
            };
        }

        function indicatorAutoscaleInfo(original) {
            if (yAxisScaleMultiplier !== 1.0 || yAxisPanOffset !== 0.0) {
                return null;
            }
            return original();
        }

        let isYScaleAuto = true;

        function toggleYScaleMode() {
            if (!mainChart) return;
            isYScaleAuto = !isYScaleAuto;
            if (isYScaleAuto) {
                yAxisScaleMultiplier = 1.0;
                yAxisPanOffset = 0.0;
                if (mainSeries) try { mainSeries.applyOptions({}); } catch(e){}
            }
            mainChart.priceScale('right').applyOptions({ autoScale: isYScaleAuto });
            const btn = document.getElementById('btnToggleYScale');
            if (btn) {
                btn.innerText = isYScaleAuto ? '🔓 Free Y-Scale' : '🔒 Auto Scale';
                btn.style.color = isYScaleAuto ? '#d1d4dc' : '#10b981';
            }
        }
        window.toggleYScaleMode = toggleYScaleMode;
        window.getYAxisScaleMultiplier = () => yAxisScaleMultiplier;
        window.isDraggingPriceScaleActive = () => isDraggingPriceScale;

        function setupRightPriceAxisHoverZone() {
            const mainContainer = document.getElementById('mainChartPane');
            if (!mainContainer) return;

            mainContainer.onmousemove = (e) => {
                if (window.innerWidth <= 768) {
                    handleRightAxisMouseLeave();
                    return;
                }
                if (!mainSeries || !mainChart) return;

                // While user is actively dragging the price scale, keep badge hidden so drag is completely free
                if (isDraggingPriceScale) {
                    const badge = document.getElementById('rightPriceAxisPlusBadge');
                    if (badge) badge.style.display = 'none';
                    return;
                }

                const rect = mainContainer.getBoundingClientRect();
                const y = e.clientY - rect.top;

                // Right price axis zone spans rightmost ~95px (including + button and price numbers)
                const isOverRightAxis = (e.clientX >= rect.right - 95);

                if (y < 0 || y > mainContainer.clientHeight || !isOverRightAxis) {
                    const badge = document.getElementById('rightPriceAxisPlusBadge');
                    const menu = document.getElementById('plusActionMenu');
                    const isBadgeHovered = badge && badge.matches(':hover');
                    const isMenuHovered = menu && menu.matches(':hover');
                    if (!isBadgeHovered && !isMenuHovered) {
                        mainContainer.style.cursor = 'default';
                        handleRightAxisMouseLeave();
                    }
                    return;
                }

                // Cursor on right price axis indicates expanding/resizing Y-axis
                mainContainer.style.cursor = 'ns-resize';

                const price = mainSeries.coordinateToPrice(y);
                if (price === null || price === undefined || isNaN(price)) return;

                currentRightAxisPrice = parseFloat(price.toFixed(2));
                renderRightAxisHoverBadge(y, currentRightAxisPrice);
            };

            mainContainer.onmousedown = (e) => {
                if (window.innerWidth <= 768) return;
                const menu = document.getElementById('plusActionMenu');
                if (menu && menu.style.display === 'block') {
                    if (e.target && e.target.closest && !e.target.closest('#plusActionMenu') && !e.target.closest('#axisPlusBtn')) {
                        hidePlusActionMenu();
                    }
                }
                const rect = mainContainer.getBoundingClientRect();
                if (e.clientX >= rect.right - 95) {
                    isDraggingPriceScale = true;
                    startDragPriceScaleY = e.clientY;
                    hasDraggedPriceScale = false;
                    const badge = document.getElementById('rightPriceAxisPlusBadge');
                    if (badge) badge.style.display = 'none';
                    if (mainChart && isYScaleAuto) {
                        mainChart.priceScale('right').applyOptions({ autoScale: false });
                        isYScaleAuto = false;
                        const btn = document.getElementById('btnToggleYScale');
                        if (btn) { btn.innerText = '🔒 Auto Scale'; btn.style.color = '#10b981'; }
                    }
                }
            };

            window.addEventListener('mousemove', (e) => {
                if (!isDraggingPriceScale || window.innerWidth <= 768) return;
                const dy = e.clientY - startDragPriceScaleY;
                if (Math.abs(dy) >= 2) {
                    hasDraggedPriceScale = true;
                    const badge = document.getElementById('rightPriceAxisPlusBadge');
                    if (badge) badge.style.display = 'none';
                    // Dragging UP (dy < 0) expands prices; Dragging DOWN (dy > 0) compresses prices
                    yAxisScaleMultiplier *= (dy < 0 ? 0.98 : 1.02);
                    yAxisScaleMultiplier = Math.max(0.001, Math.min(100.0, yAxisScaleMultiplier));
                    startDragPriceScaleY = e.clientY;
                    if (mainSeries) mainSeries.applyOptions({});
                    requestAnimationFrame(() => redrawCanvasOverlay());
                }
            });

            window.addEventListener('mouseup', () => {
                if (isDraggingPriceScale) {
                    isDraggingPriceScale = false;
                }
            });

            mainContainer.onclick = (e) => {
                if (window.innerWidth <= 768) return;
                if (hasDraggedPriceScale) {
                    hasDraggedPriceScale = false;
                    return;
                }
                const menu = document.getElementById('plusActionMenu');
                if (menu && menu.style.display === 'block') {
                    if (e.target && e.target.closest && !e.target.closest('#plusActionMenu') && !e.target.closest('#axisPlusBtn')) {
                        hidePlusActionMenu();
                    }
                }
            };

            mainContainer.onmouseleave = () => {
                if (window.innerWidth <= 768) return;
                mainContainer.style.cursor = 'default';
                handleRightAxisMouseLeave();
            };

            mainContainer.ondblclick = (e) => {
                if (window.innerWidth <= 768) return;
                const rect = mainContainer.getBoundingClientRect();
                if (e.clientX >= rect.right - 95) {
                    yAxisScaleMultiplier = 1.0;
                    yAxisPanOffset = 0.0;
                    isYScaleAuto = true;
                    if (mainChart) mainChart.priceScale('right').applyOptions({ autoScale: true });
                    if (mainSeries) mainSeries.applyOptions({});
                    const btn = document.getElementById('btnToggleYScale');
                    if (btn) { btn.innerText = '🔓 Free Y-Scale'; btn.style.color = '#d1d4dc'; }
                    requestAnimationFrame(() => redrawCanvasOverlay());
                }
            };
        }

        function renderRightAxisHoverBadge(y, price) {
            if (window.innerWidth <= 768) return;
            const mainContainer = document.getElementById('mainChartPane');
            if (!mainContainer) return;

            let badge = document.getElementById('rightPriceAxisPlusBadge');
            if (!badge) {
                badge = document.createElement('div');
                badge.id = 'rightPriceAxisPlusBadge';
                badge.style.cssText = `
                    position: absolute;
                    right: 2px;
                    z-index: 30;
                    display: none;
                    align-items: center;
                    pointer-events: none;
                `;
                badge.innerHTML = `
                    <button type="button" id="axisPlusBtn" style="background: #10b981; border: 1px solid #059669; color: #ffffff; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: bold; margin-right: 4px; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.5); transition: transform 0.12s, background 0.12s; pointer-events: auto;" title="Click + to draw Target, SL or set Price Alert">+</button>
                    <div id="axisPriceTextLabel" style="background: #1e222d; border: 1px solid #10b981; color: #f8fafc; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; font-family: monospace; box-shadow: 0 2px 8px rgba(0,0,0,0.5); pointer-events: none; user-select: none;"></div>
                `;
                mainContainer.appendChild(badge);

                badge.onmouseenter = () => { isRightAxisHovered = true; };
                badge.onmouseleave = () => { handleRightAxisMouseLeave(); };
            }

            const btn = badge.querySelector('#axisPlusBtn');
            if (btn && !btn._hasScaleHandlers) {
                btn._hasScaleHandlers = true;

                btn.onmousedown = (e) => {
                    isDraggingPriceScale = true;
                    startDragPriceScaleY = e.clientY;
                    hasDraggedPriceScale = false;
                    if (mainChart && isYScaleAuto) {
                        mainChart.priceScale('right').applyOptions({ autoScale: false });
                        isYScaleAuto = false;
                        const btnScale = document.getElementById('btnToggleYScale');
                        if (btnScale) { btnScale.innerText = '🔒 Auto Scale'; btnScale.style.color = '#10b981'; }
                    }
                };

                btn.onclick = (e) => {
                    if (hasDraggedPriceScale) {
                        hasDraggedPriceScale = false;
                        if (e) e.stopPropagation();
                        return;
                    }
                    toggleRightAxisPlusMenu(e);
                };
                btn.onmouseenter = () => { isRightAxisHovered = true; btn.style.transform = 'scale(1.2)'; btn.style.background = '#059669'; };
                btn.onmouseleave = () => { btn.style.transform = 'scale(1.0)'; btn.style.background = '#10b981'; };
            }

            const priceLabel = badge.querySelector('#axisPriceTextLabel');
            if (priceLabel && price !== null && price !== undefined) {
                priceLabel.innerText = '₹' + price.toFixed(2);
            }

            const topPos = Math.max(4, Math.min(y - 12, mainContainer.clientHeight - 30));
            badge.style.top = topPos + 'px';
            badge.style.display = 'flex';
        }

        function showRightAxisPlusBtn(y, price) {
            renderRightAxisHoverBadge(y, price);
        }

        function handlePriceLabelClick(e) {
            if (e) e.stopPropagation();
            toggleRightAxisPlusMenu(e);
        }
        window.handlePriceLabelClick = handlePriceLabelClick;

        function handleRightAxisMouseLeave() {
            isRightAxisHovered = false;
            setTimeout(() => {
                const menu = document.getElementById('plusActionMenu');
                const badge = document.getElementById('rightPriceAxisPlusBadge');
                if (!isRightAxisHovered && (!menu || menu.style.display !== 'block')) {
                    if (badge) {
                        badge.style.display = 'none';
                    }
                }
            }, 150);
        }

        function toggleRightAxisPlusMenu(e) {
            if (e) e.stopPropagation();
            if (currentRightAxisPrice === null || isNaN(currentRightAxisPrice)) return;

            currentPlusActionPrice = currentRightAxisPrice;
            const mainContainer = document.getElementById('mainChartPane');
            if (!mainContainer) return;

            // Make sure the plus icon is visible when the menu opens
            const badge = document.getElementById('rightPriceAxisPlusBadge');
            if (badge) {
                const plusBtn = badge.querySelector('#axisPlusBtn');
                if (plusBtn) plusBtn.style.display = 'flex';
            }

            let menu = document.getElementById('plusActionMenu');
            if (!menu) {
                menu = document.createElement('div');
                menu.id = 'plusActionMenu';
                menu.style.cssText = `
                    position: absolute;
                    z-index: 120;
                    background: #1e222d;
                    border: 1px solid #363a45;
                    border-radius: 8px;
                    padding: 6px;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.7);
                    display: none;
                    min-width: 235px;
                `;
                menu.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 6px 6px 6px; border-bottom: 1px solid #2a2e39; margin-bottom: 4px;">
                        <span style="font-size: 10px; font-weight: 700; color: #787b86; text-transform: uppercase; letter-spacing: 0.5px;">Quick Price Action</span>
                        <button type="button" id="btnClosePlusMenu" onclick="hidePlusActionMenu()" style="background: transparent; border: none; color: #94a3b8; font-size: 14px; font-weight: bold; cursor: pointer; padding: 0 4px; line-height: 1; border-radius: 4px; transition: color 0.15s;" onmouseover="this.style.color='#ef5350'" onmouseout="this.style.color='#94a3b8'" title="Close Menu">✕</button>
                    </div>
                    <button type="button" id="btnPlusActionTarget" onclick="executePlusAction('target')" style="background: transparent; border: none; color: #0b845c; padding: 8px 10px; font-size: 12px; font-weight: 600; text-align: left; width: 100%; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px; transition: background 0.15s;" onmouseover="this.style.background='#2a2e39'" onmouseout="this.style.background='transparent'">
                        🎯 Draw Target Line (₹<span id="plusActionTargetPrice">-</span>)
                    </button>
                    <button type="button" id="btnPlusActionStoploss" onclick="executePlusAction('stoploss')" style="background: transparent; border: none; color: #ef5350; padding: 8px 10px; font-size: 12px; font-weight: 600; text-align: left; width: 100%; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px; transition: background 0.15s;" onmouseover="this.style.background='#2a2e39'" onmouseout="this.style.background='transparent'">
                        🛑 Draw SL (Stop Loss) Line (₹<span id="plusActionStoplossPrice">-</span>)
                    </button>
                    <button type="button" id="btnPlusActionAlert" onclick="executePlusAction('alert')" style="background: transparent; border: none; color: #3b82f6; padding: 8px 10px; font-size: 12px; font-weight: 600; text-align: left; width: 100%; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px; transition: background 0.15s;" onmouseover="this.style.background='#2a2e39'" onmouseout="this.style.background='transparent'">
                        🔔 Create Price Alert (₹<span id="plusActionAlertPrice">-</span>)
                    </button>
                    <button type="button" id="btnPlusActionSupport" onclick="executePlusAction('support')" style="background: transparent; border: none; color: #731717; padding: 8px 10px; font-size: 12px; font-weight: 600; text-align: left; width: 100%; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px; transition: background 0.15s;" onmouseover="this.style.background='#2a2e39'" onmouseout="this.style.background='transparent'">
                        🟢 Draw Support Line (₹<span id="plusActionSupportPrice">-</span>)
                    </button>
                    <button type="button" id="btnPlusActionResistance" onclick="executePlusAction('resistance')" style="background: transparent; border: none; color: #788325; padding: 8px 10px; font-size: 12px; font-weight: 600; text-align: left; width: 100%; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px; transition: background 0.15s;" onmouseover="this.style.background='#2a2e39'" onmouseout="this.style.background='transparent'">
                        🔴 Draw Resistance Line (₹<span id="plusActionResistancePrice">-</span>)
                    </button>
                `;
                mainContainer.appendChild(menu);

                const btnClose = menu.querySelector('#btnClosePlusMenu');
                if (btnClose) btnClose.onclick = (ev) => { ev.stopPropagation(); hidePlusActionMenu(); };
                const btnTgt = menu.querySelector('#btnPlusActionTarget');
                if (btnTgt) btnTgt.onclick = () => executePlusAction('target');
                const btnSL = menu.querySelector('#btnPlusActionStoploss');
                if (btnSL) btnSL.onclick = () => executePlusAction('stoploss');
                const btnAlt = menu.querySelector('#btnPlusActionAlert');
                if (btnAlt) btnAlt.onclick = () => executePlusAction('alert');
                const btnSup = menu.querySelector('#btnPlusActionSupport');
                if (btnSup) btnSup.onclick = () => executePlusAction('support');
                const btnRes = menu.querySelector('#btnPlusActionResistance');
                if (btnRes) btnRes.onclick = () => executePlusAction('resistance');

                menu.onmouseleave = () => {
                    setTimeout(() => {
                        const badge = document.getElementById('rightPriceAxisPlusBadge');
                        const isBadgeHovered = badge && badge.matches(':hover');
                        const isMenuHovered = menu.matches(':hover');
                        if (!isMenuHovered && !isBadgeHovered) {
                            hidePlusActionMenu();
                        }
                    }, 200);
                };
            }

            const targetEl = document.getElementById('plusActionTargetPrice');
            if (targetEl) targetEl.innerText = currentPlusActionPrice.toFixed(2);
            const slEl = document.getElementById('plusActionStoplossPrice');
            if (slEl) slEl.innerText = currentPlusActionPrice.toFixed(2);
            const alertEl = document.getElementById('plusActionAlertPrice');
            if (alertEl) alertEl.innerText = currentPlusActionPrice.toFixed(2);
            const supEl = document.getElementById('plusActionSupportPrice');
            if (supEl) supEl.innerText = currentPlusActionPrice.toFixed(2);
            const resEl = document.getElementById('plusActionResistancePrice');
            if (resEl) resEl.innerText = currentPlusActionPrice.toFixed(2);

            const topPos = badge ? badge.offsetTop : 50;
            menu.style.top = Math.max(10, Math.min(topPos - 10, mainContainer.clientHeight - 130)) + 'px';
            menu.style.right = '70px';
            menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
        }

        function hidePlusActionMenu() {
            const menu = document.getElementById('plusActionMenu');
            if (menu) menu.style.display = 'none';
            const badge = document.getElementById('rightPriceAxisPlusBadge');
            if (badge && !isRightAxisHovered) {
                badge.style.display = 'none';
            }
        }

        function executePlusAction(actionType) {
            if (!currentPlusActionPrice) return;
            const price = currentPlusActionPrice;
            hidePlusActionMenu();

            if (actionType === 'target') {
                addHorizontalLineAtPrice('target', price, '#0b845c', 'Target');
                showSupportAddedToast(price, '🎯 Target Line');
            } else if (actionType === 'stoploss') {
                addHorizontalLineAtPrice('stoploss', price, '#ef5350', 'Stop Loss');
                showSupportAddedToast(price, '🛑 Stop Loss Line');
            } else if (actionType === 'support') {
                addHorizontalLineAtPrice('support', price, '#731717', 'Support');
                showSupportAddedToast(price, '🟢 Support Line');
            } else if (actionType === 'resistance') {
                addHorizontalLineAtPrice('resistance', price, '#788325', 'Resistance');
                showSupportAddedToast(price, '🔴 Resistance Line');
            } else if (actionType === 'alert') {
                openCreateAlertModal(currentChartSymbol, price);
            }
        }

        window.toggleRightAxisPlusMenu = toggleRightAxisPlusMenu;
        window.hidePlusActionMenu = hidePlusActionMenu;
        window.executePlusAction = executePlusAction;

        function showSupportAddedToast(price, labelStr = '🟢 Support Line') {
            let toast = document.getElementById('supportAddedToast');
            const mainContainer = document.getElementById('mainChartPane');
            if (!toast && mainContainer) {
                toast = document.createElement('div');
                toast.id = 'supportAddedToast';
                toast.style.cssText = `
                    position: absolute;
                    top: 15px;
                    left: 50%;
                    transform: translateX(-50%);
                    z-index: 35;
                    background: #10b981;
                    color: #ffffff;
                    padding: 6px 14px;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 600;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                    pointer-events: none;
                    transition: opacity 0.3s;
                `;
                mainContainer.appendChild(toast);
            }
            if (toast) {
                let toastBg = '#731717';
                if (labelStr.includes('Resistance') || labelStr.includes('🔴')) toastBg = '#788325';
                else if (labelStr.includes('Target') || labelStr.includes('🎯')) toastBg = '#0b845c';
                else if (labelStr.includes('Stop Loss') || labelStr.includes('🛑')) toastBg = '#ef5350';
                else if (labelStr.includes('Support') || labelStr.includes('🟢')) toastBg = '#731717';
                toast.style.background = toastBg;
                toast.innerText = `${labelStr} added at ₹${price}`;
                toast.style.opacity = '1';
                toast.style.display = 'block';
                setTimeout(() => {
                    if (toast) toast.style.opacity = '0';
                }, 2000);
            }
        }

        function updateRightAxisTimePriceBadge(param) {
            const mainContainer = document.getElementById('mainChartPane');
            if (!mainContainer) return;

            let badge = document.getElementById('rightAxisTimePriceBadge');
            if (!badge) {
                badge = document.createElement('div');
                badge.id = 'rightAxisTimePriceBadge';
                badge.style.cssText = `
                    position: absolute;
                    right: 65px;
                    z-index: 24;
                    background: rgba(19, 23, 34, 0.95);
                    border: 1px solid #3b82f6;
                    color: #f8fafc;
                    padding: 3px 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: 600;
                    font-family: monospace;
                    pointer-events: none;
                    display: none;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                    white-space: nowrap;
                    transition: top 0.05s ease-out;
                `;
                mainContainer.appendChild(badge);
            }

            if (!param || !param.point || param.point.x < 0 || param.point.y < 0) {
                badge.style.display = 'none';
                if (!isRightAxisHovered) {
                    handleRightAxisMouseLeave();
                }
                return;
            }

            let price = null;
            if (mainSeries) {
                price = mainSeries.coordinateToPrice(param.point.y);
            }

            if (price !== null && price !== undefined && !isNaN(price)) {
                currentRightAxisPrice = parseFloat(price.toFixed(2));
                renderRightAxisPlusBadge(param.point.y, currentRightAxisPrice);
            }

            let priceStr = (price !== null && price !== undefined && !isNaN(price)) ? '₹' + price.toFixed(2) : '';
            let timeStr = '';

            if (typeof param.time === 'number') {
                const d = new Date(param.time * 1000);
                const datePart = d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
                const timePart = d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
                timeStr = ['5m', '15m', '1h', '60m'].includes(currentChartInterval) ? `${datePart}, ${timePart}` : datePart;
            } else if (typeof param.time === 'object' && param.time !== null && param.time.year) {
                timeStr = `${param.time.day} ${param.time.month} ${param.time.year}`;
            } else if (param.time) {
                timeStr = String(param.time);
            }

            if (priceStr || timeStr) {
                badge.innerText = `${priceStr}${priceStr && timeStr ? ' | ' : ''}${timeStr}`;
                const topPos = Math.max(5, Math.min(param.point.y - 12, mainContainer.clientHeight - 30));
                badge.style.top = topPos + 'px';
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        }

        function startCandleCountdownTimer() {
            if (candleTimerIntervalId) clearInterval(candleTimerIntervalId);
            candleTimerIntervalId = setInterval(updateCandleTimerDisplay, 1000);
            updateCandleTimerDisplay();
        }

        function updateCandleTimerDisplay() {
            const mainContainer = document.getElementById('mainChartPane');
            if (!mainContainer) return;

            let badge = document.getElementById('candleCountdownTimerBadge');
            if (!badge) {
                badge = document.createElement('div');
                badge.id = 'candleCountdownTimerBadge';
                badge.style.cssText = `
                    position: absolute;
                    right: 0px;
                    z-index: 25;
                    background: #00b094;
                    color: #ffffff;
                    padding: 2px 6px;
                    border-radius: 4px 0 0 4px;
                    font-family: -apple-system, BlinkMacSystemFont, monospace;
                    font-size: 11px;
                    font-weight: bold;
                    pointer-events: none;
                    display: none;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.5);
                    min-width: 65px;
                `;
                badge.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 4px; line-height: 1.2;">
                        <span id="candleTimerIcon" style="background: rgba(255,255,255,0.25); color: #ffffff; border-radius: 50%; width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 900;">D</span>
                        <span id="candleTimerPriceText" style="font-weight: 700;">-</span>
                    </div>
                    <div id="candleTimerClockText" style="font-size: 10px; opacity: 0.95; font-weight: 600; letter-spacing: 0.3px; line-height: 1.1;">00:00:00</div>
                `;
                mainContainer.appendChild(badge);
            }

            if (!mainSeries || !cachedChartData || !cachedChartData.candles || cachedChartData.candles.length === 0) {
                badge.style.display = 'none';
                return;
            }

            const lastCandle = cachedChartData.candles[cachedChartData.candles.length - 1];
            const latestPrice = lastCandle.close;
            const yCoord = mainSeries.priceToCoordinate(latestPrice);

            if (yCoord === null || yCoord === undefined || yCoord < 0) {
                badge.style.display = 'none';
                return;
            }

            const now = new Date();
            let secondsLeft = 0;
            const interval = currentChartInterval || '1d';

            if (interval === '5m') {
                const secs = Math.floor(now.getTime() / 1000);
                secondsLeft = 300 - (secs % 300);
            } else if (interval === '15m') {
                const secs = Math.floor(now.getTime() / 1000);
                secondsLeft = 900 - (secs % 900);
            } else if (interval === '1h' || interval === '60m') {
                const secs = Math.floor(now.getTime() / 1000);
                secondsLeft = 3600 - (secs % 3600);
            } else {
                const marketClose = new Date(now);
                marketClose.setHours(15, 30, 0, 0);
                if (now > marketClose) {
                    marketClose.setDate(marketClose.getDate() + 1);
                }
                secondsLeft = Math.max(0, Math.floor((marketClose.getTime() - now.getTime()) / 1000));
            }

            const hrs = String(Math.floor(secondsLeft / 3600)).padStart(2, '0');
            const mins = String(Math.floor((secondsLeft % 3600) / 60)).padStart(2, '0');
            const secs = String(secondsLeft % 60).padStart(2, '0');

            let badgeIcon = 'D';
            if (interval === '5m') badgeIcon = '5m';
            else if (interval === '15m') badgeIcon = '15m';
            else if (interval === '1h' || interval === '60m') badgeIcon = '1H';
            else if (interval === '1w') badgeIcon = 'W';
            else if (interval === '1mo') badgeIcon = 'M';

            const priceTextEl = badge.querySelector('#candleTimerPriceText');
            const clockTextEl = badge.querySelector('#candleTimerClockText');
            const iconEl = badge.querySelector('#candleTimerIcon');

            if (priceTextEl) priceTextEl.innerText = latestPrice.toFixed(2);
            if (clockTextEl) clockTextEl.innerText = `${hrs}:${mins}:${secs}`;
            if (iconEl) iconEl.innerText = badgeIcon;

            const topPos = Math.max(4, Math.min(yCoord - 14, mainContainer.clientHeight - 36));
            badge.style.top = topPos + 'px';
            badge.style.display = 'flex';
        }

        function updateLegend(time, o, h, l, c, vol, fullData, curTime = null, volMaVal = null) {
            let timeStr = '-';
            if (time !== null && time !== undefined) {
                const dateFormatted = formatChartAxisDate(time);
                if (typeof time === 'number' && ['5m', '15m', '1h', '60m'].includes(currentChartInterval)) {
                    const d = new Date(time * 1000);
                    const timePart = d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
                    timeStr = `${dateFormatted} ${timePart} (IST)`;
                } else {
                    timeStr = `${dateFormatted} (IST)`;
                }
            }
            const elLegDate = document.getElementById('legDate');
            if (elLegDate) elLegDate.innerText = timeStr;
            document.getElementById('legOpen').innerText = '₹' + (o ? o.toFixed(2) : '-');
            document.getElementById('legHigh').innerText = '₹' + (h ? h.toFixed(2) : '-');
            document.getElementById('legLow').innerText = '₹' + (l ? l.toFixed(2) : '-');
            document.getElementById('legClose').innerText = '₹' + (c ? c.toFixed(2) : '-');
            document.getElementById('legVol').innerText = vol ? vol.toLocaleString('en-IN') : '-';

            const lookupTime = curTime || time;
            const rec = lookupTime !== null ? indicatorDataMap.get(lookupTime) : null;
            const finalVolMa = (volMaVal !== null && volMaVal !== undefined)
                ? volMaVal
                : ((rec && rec.vol_ma !== undefined) ? rec.vol_ma : null);

            const elVolMa = document.getElementById('legVolMa');
            if (elVolMa) {
                elVolMa.innerText = (finalVolMa !== null && finalVolMa !== undefined) ? finalVolMa.toLocaleString('en-IN') : '-';
            }

            const elChgPct = document.getElementById('legChgPct');
            if (elChgPct) {
                if (o && c && o > 0) {
                    const pct = ((c - o) / o) * 100;
                    const sign = pct >= 0 ? '+' : '';
                    const color = pct >= 0 ? '#10b981' : '#ef4444';
                    elChgPct.innerText = `(${sign}${pct.toFixed(2)}%)`;
                    elChgPct.style.color = color;
                } else {
                    elChgPct.innerText = '';
                }
            }

            const elCdRider = document.getElementById('legCdRider');
            if (elCdRider) elCdRider.innerText = (rec && rec.cdrider !== undefined) ? '₹' + rec.cdrider.toFixed(2) : '-';

            const elStTrig = document.getElementById('legStTrigger');
            if (elStTrig) {
                if (rec && rec.st_trigger !== undefined && rec.st_trigger !== null) {
                    const trigVal = rec.st_trigger.toFixed(2);
                    const isBuy = (rec.st_direction === 'BUY' || rec.st_direction === 1);
                    const dirStr = isBuy ? 'BUY' : 'SELL';
                    const dirColor = isBuy ? '#22c55e' : '#ef5350';
                    const distPct = (rec.st_dist_pct !== undefined && rec.st_dist_pct !== null) ? rec.st_dist_pct.toFixed(2) : '-';
                    const distSign = (rec.st_dist_pct !== undefined && rec.st_dist_pct > 0) ? '+' : '';
                    elStTrig.innerHTML = `<span style="color:#ec4899">₹${trigVal}</span> <span style="color:${dirColor}; font-weight:700;">(${dirStr} ${distSign}${distPct}%)</span>`;
                } else {
                    elStTrig.innerText = '-';
                }
            }

            const elDonchian = document.getElementById('legBsDonchian');
            if (elDonchian) {
                if (rec && rec.donchian_upper !== undefined) {
                    const u = rec.donchian_upper.toFixed(2);
                    const m = rec.donchian_middle !== undefined ? rec.donchian_middle.toFixed(2) : '-';
                    const l = rec.donchian_lower !== undefined ? rec.donchian_lower.toFixed(2) : '-';
                    elDonchian.innerHTML = `<span style="color:#22c55e">U: ₹${u}</span> <span style="color:#f97316">M: ₹${m}</span> <span style="color:#ef5350">L: ₹${l}</span>`;
                } else {
                    elDonchian.innerText = '-';
                }
            }

            const elSma50 = document.getElementById('legSma50');
            if (elSma50) elSma50.innerText = (rec && rec.sma50 !== undefined) ? '₹' + rec.sma50.toFixed(2) : '-';
            
            const elSma200 = document.getElementById('legSma200');
            if (elSma200) elSma200.innerText = (rec && rec.sma200 !== undefined) ? '₹' + rec.sma200.toFixed(2) : '-';

            const elEma9 = document.getElementById('legEma9');
            if (elEma9) elEma9.innerText = (rec && rec.ema9 !== undefined) ? '₹' + rec.ema9.toFixed(2) : '-';

            const elEma21 = document.getElementById('legEma21');
            if (elEma21) elEma21.innerText = (rec && rec.ema21 !== undefined) ? '₹' + rec.ema21.toFixed(2) : '-';

            const elGann = document.getElementById('legGann2Day');
            if (elGann) elGann.innerText = (rec && rec.gann_2day !== undefined) ? '₹' + rec.gann_2day.toFixed(2) : '-';

            document.getElementById('legRsi').innerText = (rec && rec.rsi !== undefined) ? rec.rsi.toFixed(2) : '-';
            document.getElementById('legMacd').innerText = (rec && rec.macd !== undefined) ? rec.macd.toFixed(2) : '-';
        }

        function toggleIndicators() {
            if (!volumeSeries) return;

            const showCdRider = document.getElementById('chkCdRider') ? document.getElementById('chkCdRider').checked : false;
            const showStTrigger = document.getElementById('chkStTrigger') ? document.getElementById('chkStTrigger').checked : false;
            const showBsDonchian = document.getElementById('chkBsDonchian') ? document.getElementById('chkBsDonchian').checked : false;
            const showVol = document.getElementById('chkVolume') ? document.getElementById('chkVolume').checked : true;
            const showVolMa = document.getElementById('chkVolumeMa') ? document.getElementById('chkVolumeMa').checked : true;
            const showSma50 = document.getElementById('chkSma50') ? document.getElementById('chkSma50').checked : false;
            const showSma200 = document.getElementById('chkSma200') ? document.getElementById('chkSma200').checked : false;
            const showEma9 = document.getElementById('chkEma9') ? document.getElementById('chkEma9').checked : false;
            const showGann2Day = document.getElementById('chkGann2Day') ? document.getElementById('chkGann2Day').checked : false;
            const showRsi = document.getElementById('chkRsi') ? document.getElementById('chkRsi').checked : true;
            const showMacd = document.getElementById('chkMacd') ? document.getElementById('chkMacd').checked : false;

            try {
                localStorage.setItem('capital_desk_chart_indicators', JSON.stringify({
                    chkCdRider: showCdRider,
                    chkStTrigger: showStTrigger,
                    chkBsDonchian: showBsDonchian,
                    chkVolume: showVol,
                    chkVolumeMa: showVolMa,
                    chkSma50: showSma50,
                    chkSma200: showSma200,
                    chkEma9: showEma9,
                    chkGann2Day: showGann2Day,
                    chkRsi: showRsi,
                    chkMacd: showMacd
                }));
            } catch(e){}

            if (cdRiderSeries) cdRiderSeries.applyOptions({ visible: showCdRider });
            if (stTriggerSeries) stTriggerSeries.applyOptions({ visible: showStTrigger });
            if (donchianUpperSeries) donchianUpperSeries.applyOptions({ visible: showBsDonchian });
            if (donchianMiddleSeries) donchianMiddleSeries.applyOptions({ visible: showBsDonchian });
            if (donchianLowerSeries) donchianLowerSeries.applyOptions({ visible: showBsDonchian });

            // Manage ST Trigger Horizontal Price Line
            if (mainSeries) {
                if (stTriggerPriceLine) {
                    try { mainSeries.removePriceLine(stTriggerPriceLine); } catch(e){}
                    stTriggerPriceLine = null;
                }
                if (showStTrigger && cachedStTriggerInfo && cachedStTriggerInfo.trigger) {
                    const isBuy = (cachedStTriggerInfo.direction === 'BUY' || cachedStTriggerInfo.direction === 1);
                    const trigVal = cachedStTriggerInfo.trigger;
                    const distPct = cachedStTriggerInfo.dist_pct || 0;
                    const sign = distPct >= 0 ? '+' : '';
                    const titleText = isBuy 
                        ? `SELL below ₹${trigVal.toFixed(2)} (${sign}${distPct.toFixed(2)}%)`
                        : `BUY above ₹${trigVal.toFixed(2)} (${sign}${distPct.toFixed(2)}%)`;
                    const lineColor = isBuy ? '#ef5350' : '#22c55e';
                    try {
                        stTriggerPriceLine = mainSeries.createPriceLine({
                            price: trigVal,
                            color: lineColor,
                            lineWidth: 2,
                            lineStyle: LightweightCharts.LineStyle.Dashed,
                            axisLabelVisible: true,
                            title: titleText,
                        });
                    } catch(e) {
                        console.error('Error creating ST Trigger price line:', e);
                    }
                }
            }

            // Manage ST Trigger Floating Info Table
            const infoBox = document.getElementById('stTriggerInfoBox');
            if (infoBox) {
                if (showStTrigger && cachedStTriggerInfo) {
                    const isBuy = (cachedStTriggerInfo.direction === 'BUY' || cachedStTriggerInfo.direction === 1);
                    const zoneEl = document.getElementById('stInfoZone');
                    const trigEl = document.getElementById('stInfoTrigger');
                    const distEl = document.getElementById('stInfoDist');
                    const limitEl = document.getElementById('stInfoLimit');

                    if (zoneEl) {
                        zoneEl.innerText = isBuy ? 'BUY ZONE 🟢' : 'SELL ZONE 🔴';
                        zoneEl.style.color = isBuy ? '#22c55e' : '#ef5350';
                    }
                    if (trigEl) {
                        trigEl.innerText = '₹' + (cachedStTriggerInfo.trigger ? cachedStTriggerInfo.trigger.toFixed(2) : '-');
                        trigEl.style.color = '#ec4899';
                    }
                    if (distEl) {
                        const distPct = cachedStTriggerInfo.dist_pct || 0;
                        const distPts = cachedStTriggerInfo.dist_pts || 0;
                        const sign = distPct >= 0 ? '+' : '';
                        distEl.innerText = `${sign}${distPct.toFixed(2)}% (${sign}${distPts.toFixed(2)} pts)`;
                        distEl.style.color = isBuy ? '#ef5350' : '#22c55e';
                    }
                    if (limitEl) {
                        limitEl.innerText = isBuy 
                            ? `Flip to SELL if close < ₹${cachedStTriggerInfo.trigger.toFixed(2)}`
                            : `Flip to BUY if close > ₹${cachedStTriggerInfo.trigger.toFixed(2)}`;
                    }
                    infoBox.style.display = 'block';
                } else {
                    infoBox.style.display = 'none';
                }
            }

            if (mainSeries) {
                const combinedMarkers = [];
                if (showCdRider && cachedCdRiderMarkers && cachedCdRiderMarkers.length > 0) {
                    combinedMarkers.push(...cachedCdRiderMarkers);
                }
                if (showBsDonchian && cachedBsDonchianMarkers && cachedBsDonchianMarkers.length > 0) {
                    combinedMarkers.push(...cachedBsDonchianMarkers);
                }
                if (showStTrigger && cachedStTriggerMarkers && cachedStTriggerMarkers.length > 0) {
                    combinedMarkers.push(...cachedStTriggerMarkers);
                }
                if (window.activePatternMarkers && window.activePatternMarkers.length > 0) {
                    combinedMarkers.push(...window.activePatternMarkers);
                }
                combinedMarkers.sort((a, b) => {
                    const ta = typeof a.time === 'number' ? a.time : (new Date(a.time).getTime() || 0);
                    const tb = typeof b.time === 'number' ? b.time : (new Date(b.time).getTime() || 0);
                    return ta - tb;
                });
                mainSeries.setMarkers(combinedMarkers);
            }
            let effectiveShowSma50 = showSma50;
            let effectiveShowSma200 = showSma200;
            let effectiveShowEma9 = showEma9;
            let effectiveShowEma21 = false;

            if (window.activePatternIndicators) {
                if (window.activePatternIndicators.showDmaCross) {
                    effectiveShowSma50 = true;
                    effectiveShowSma200 = true;
                }
                if (window.activePatternIndicators.showEmaCross) {
                    effectiveShowEma9 = true;
                    effectiveShowEma21 = true;
                }
                if (window.activePatternIndicators.showSma50) effectiveShowSma50 = true;
                if (window.activePatternIndicators.showSma200) effectiveShowSma200 = true;
                if (window.activePatternIndicators.showEma9) effectiveShowEma9 = true;
                if (window.activePatternIndicators.showEma21) effectiveShowEma21 = true;
            }

            volumeSeries.applyOptions({ visible: showVol });
            if (volumeMaSeries) volumeMaSeries.applyOptions({ visible: showVol && showVolMa });
            if (sma50Series) sma50Series.applyOptions({ visible: effectiveShowSma50 });
            if (sma200Series) sma200Series.applyOptions({ visible: effectiveShowSma200 });
            if (ema9Series) ema9Series.applyOptions({ visible: effectiveShowEma9 });
            if (ema21Series) ema21Series.applyOptions({ visible: effectiveShowEma21 });
            if (gann2DaySeries) gann2DaySeries.applyOptions({ visible: showGann2Day });

            if (document.getElementById('legCdRiderGroup')) {
                document.getElementById('legCdRiderGroup').style.display = showCdRider ? 'inline' : 'none';
            }
            if (document.getElementById('legStTriggerGroup')) {
                document.getElementById('legStTriggerGroup').style.display = showStTrigger ? 'inline' : 'none';
            }
            if (document.getElementById('legBsDonchianGroup')) {
                document.getElementById('legBsDonchianGroup').style.display = showBsDonchian ? 'inline' : 'none';
            }

            const legEma21Wrap = document.getElementById('legEma21Wrapper');
            if (legEma21Wrap) {
                legEma21Wrap.style.display = effectiveShowEma21 ? 'inline' : 'none';
            }

            if (document.getElementById('legVolGroup')) {
                document.getElementById('legVolGroup').style.display = showVol ? 'inline-block' : 'none';
            }
            if (document.getElementById('legVolMaGroup')) {
                document.getElementById('legVolMaGroup').style.display = 'none';
            }

            document.getElementById('rsiChartPane').style.display = showRsi ? 'block' : 'none';
            document.getElementById('legRsiGroup').style.display = showRsi ? 'inline-block' : 'none';

            document.getElementById('macdChartPane').style.display = showMacd ? 'block' : 'none';
            document.getElementById('legMacdGroup').style.display = showMacd ? 'inline-block' : 'none';

            document.getElementById('legSmaGroup').style.display = (showCdRider || showStTrigger || showBsDonchian || effectiveShowSma50 || effectiveShowSma200 || effectiveShowEma9 || effectiveShowEma21 || showGann2Day) ? 'inline-block' : 'none';

            resizeChartPanes();
        }

        function closeChartModal() {
            closeChartSymbolSearch();
            window.activePatternMarkers = [];
            window.activePatternShapes = [];
            window.activePatternIndicators = null;
            const modal = document.getElementById('chartModal');
            if (modal) {
                modal.style.display = 'none';
            }

            if (candleTimerIntervalId) {
                clearInterval(candleTimerIntervalId);
                candleTimerIntervalId = null;
            }

            if (chartResizeObserver) {
                try { chartResizeObserver.disconnect(); } catch(e){}
                chartResizeObserver = null;
            }

            if (mainChart) {
                try { mainChart.remove(); } catch(e){}
                mainChart = null;
            }
            if (rsiChart) {
                try { rsiChart.remove(); } catch(e){}
                rsiChart = null;
            }
            if (macdChart) {
                try { macdChart.remove(); } catch(e){}
                macdChart = null;
            }

            const mainContainer = document.getElementById('mainChartPane');
            const rsiContainer = document.getElementById('rsiChartPane');
            const macdContainer = document.getElementById('macdChartPane');
            if (mainContainer) mainContainer.innerHTML = '';
            if (rsiContainer) rsiContainer.innerHTML = '';
            if (macdContainer) macdContainer.innerHTML = '';

            if (stTriggerPriceLine && mainSeries) {
                try { mainSeries.removePriceLine(stTriggerPriceLine); } catch(e){}
            }
            stTriggerPriceLine = null;
            const infoBox = document.getElementById('stTriggerInfoBox');
            if (infoBox) infoBox.style.display = 'none';

            activePriceLines = [];
            drawingCanvas = null;
            currentDrawingTool = null;
            if (typeof hideCanvasObjectMenu === 'function') hideCanvasObjectMenu();
            if (typeof hideDrawingBanner === 'function') hideDrawingBanner();
        }

        window.closeStTriggerInfoBox = function() {
            const infoBox = document.getElementById('stTriggerInfoBox');
            if (infoBox) infoBox.style.display = 'none';
        };

        // =========================================================
        // IN-CHART ELEGANT SYMBOL SEARCH (TRADINGVIEW IN-SCREEN DESIGN)
        // =========================================================
        let chartSearchDebounceTimer = null;
        let chartSearchResults = [];
        let chartSearchActiveIndex = -1;

        function openChartSymbolSearch(initialChar = '') {
            setupChartSymbolSearchEvents();
            const dropdown = document.getElementById('chartSymbolSearchDropdown');
            const pillBox = document.getElementById('chartSymbolPillBox');
            const input = document.getElementById('chartSymbolSearchInput');
            if (!dropdown || !input) return;

            dropdown.style.display = 'flex';
            if (pillBox) pillBox.classList.add('active');
            const leadIcon = document.getElementById('chartSymbolSearchLeadIcon');
            if (leadIcon) leadIcon.classList.add('active');

            if (initialChar) {
                input.value = initialChar;
                triggerChartSymbolSearch(initialChar);
            } else {
                const cur = currentChartSymbol ? currentChartSymbol.replace('.NS', '').replace('.BO', '') : '';
                input.value = cur;
                input.focus();
                input.select();
                triggerChartSymbolSearch(cur);
            }

            setTimeout(() => {
                input.focus();
            }, 30);
        }

        function closeChartSymbolSearch() {
            const dropdown = document.getElementById('chartSymbolSearchDropdown');
            const pillBox = document.getElementById('chartSymbolPillBox');
            if (dropdown) dropdown.style.display = 'none';
            if (pillBox) pillBox.classList.remove('active');
            const leadIcon = document.getElementById('chartSymbolSearchLeadIcon');
            if (leadIcon) leadIcon.classList.remove('active');
            chartSearchActiveIndex = -1;
        }

        function toggleChartSymbolSearch(e) {
            if (e) e.stopPropagation();
            const dropdown = document.getElementById('chartSymbolSearchDropdown');
            if (dropdown && dropdown.style.display === 'flex') {
                closeChartSymbolSearch();
            } else {
                openChartSymbolSearch();
            }
        }

        function clearChartSymbolSearch(e) {
            if (e) e.stopPropagation();
            const input = document.getElementById('chartSymbolSearchInput');
            if (input) {
                input.value = '';
                input.focus();
                triggerChartSymbolSearch('');
            }
        }

        function triggerChartSymbolSearch(query) {
            clearTimeout(chartSearchDebounceTimer);
            const clearBtn = document.getElementById('chartSymbolSearchClear');
            if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';

            // Instant local render from known stocks
            renderChartSearchLocal(query);

            // Debounced API fetch for comprehensive universe
            chartSearchDebounceTimer = setTimeout(() => {
                fetchChartSearchResults(query);
            }, 120);
        }

        function renderChartSearchLocal(query) {
            const listEl = document.getElementById('chartSearchResultsList');
            if (!listEl) return;

            const cleanQ = (query || '').trim().toUpperCase();
            let matches = [];

            // 1. Gather all local candidate symbols from stockPricesData, watchlists, etc.
            const candidateMap = new Map();

            if (typeof stockPricesData !== 'undefined' && stockPricesData) {
                Object.entries(stockPricesData).forEach(([sym, info]) => {
                    if (!sym || sym.startsWith('^') || sym.includes('=F')) return;
                    const clean = sym.replace('.NS', '').replace('.BO', '');
                    const name = (info && info.name) ? info.name : clean;
                    candidateMap.set(sym, {
                        symbol: sym,
                        cleanSymbol: clean,
                        name: name,
                        exchange: sym.endsWith('.BO') ? 'BSE' : 'NSE'
                    });
                });
            }

            if (typeof watchlistsData !== 'undefined' && watchlistsData) {
                Object.values(watchlistsData).forEach(arr => {
                    (arr || []).forEach(s => {
                        if (!s || candidateMap.has(s)) return;
                        const clean = s.replace('.NS', '').replace('.BO', '');
                        candidateMap.set(s, {
                            symbol: s,
                            cleanSymbol: clean,
                            name: clean,
                            exchange: s.endsWith('.BO') ? 'BSE' : 'NSE'
                        });
                    });
                });
            }

            // Popular defaults if empty query
            if (!cleanQ) {
                const popularDefaults = ['POCL.NS', 'RELIANCE.NS', 'TCS.NS', 'INFY.NS', 'HDFCBANK.NS', 'ICICIBANK.NS', 'TATAMOTORS.NS', 'ZOMATO.NS', 'SUZLON.NS', 'BSE.NS'];
                popularDefaults.forEach(defSym => {
                    if (candidateMap.has(defSym)) {
                        matches.push(candidateMap.get(defSym));
                    } else {
                        const clean = defSym.replace('.NS', '');
                        matches.push({ symbol: defSym, cleanSymbol: clean, name: clean, exchange: 'NSE' });
                    }
                });
            } else {
                candidateMap.forEach(item => {
                    if (item.cleanSymbol.includes(cleanQ) || item.name.toUpperCase().includes(cleanQ)) {
                        matches.push(item);
                    }
                });
                // Sort by exact prefix match first
                matches.sort((a, b) => {
                    const aExact = a.cleanSymbol === cleanQ ? 2 : (a.cleanSymbol.startsWith(cleanQ) ? 1 : 0);
                    const bExact = b.cleanSymbol === cleanQ ? 2 : (b.cleanSymbol.startsWith(cleanQ) ? 1 : 0);
                    return bExact - aExact;
                });
            }

            chartSearchResults = matches.slice(0, 15);
            chartSearchActiveIndex = chartSearchResults.length > 0 ? 0 : -1;
            renderChartSearchResultsList(chartSearchResults, cleanQ);
        }

        async function fetchChartSearchResults(query) {
            const cleanQ = (query || '').trim();
            if (!cleanQ) return;

            try {
                const res = await fetch(`/api/search?q=${encodeURIComponent(cleanQ)}`);
                if (!res.ok) return;
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    const serverMatches = data.map(item => {
                        const sym = item.symbol || '';
                        const clean = sym.replace('.NS', '').replace('.BO', '');
                        return {
                            symbol: sym,
                            cleanSymbol: clean,
                            name: item.name || clean,
                            exchange: item.exchange || (sym.endsWith('.BO') ? 'BSE' : 'NSE')
                        };
                    });

                    // Merge server results with existing matching current query
                    const seen = new Set();
                    const merged = [];
                    serverMatches.forEach(item => {
                        if (!seen.has(item.symbol)) {
                            seen.add(item.symbol);
                            merged.push(item);
                        }
                    });
                    const qUpper = cleanQ.toUpperCase();
                    chartSearchResults.forEach(item => {
                        if (!item) return;
                        const sym = item.symbol || '';
                        const clean = (item.cleanSymbol || sym.replace('.NS', '').replace('.BO', '')).toUpperCase();
                        const name = (item.name || '').toUpperCase();
                        if (!seen.has(sym) && (clean.includes(qUpper) || name.includes(qUpper))) {
                            seen.add(sym);
                            merged.push(item);
                        }
                    });

                    // Sort results: Exact match first, then prefix, then substring
                    merged.sort((a, b) => {
                        const aClean = (a.cleanSymbol || a.symbol || '').replace('.NS', '').replace('.BO', '').toUpperCase();
                        const bClean = (b.cleanSymbol || b.symbol || '').replace('.NS', '').replace('.BO', '').toUpperCase();
                        const aExact = aClean === qUpper ? 3 : (aClean.startsWith(qUpper) ? 2 : (aClean.includes(qUpper) ? 1 : 0));
                        const bExact = bClean === qUpper ? 3 : (bClean.startsWith(qUpper) ? 2 : (bClean.includes(qUpper) ? 1 : 0));
                        return bExact - aExact;
                    });

                    chartSearchResults = merged.slice(0, 20);
                    chartSearchActiveIndex = chartSearchResults.length > 0 ? 0 : -1;
                    renderChartSearchResultsList(chartSearchResults, qUpper);
                }
            } catch (err) {
                console.warn('Symbol search fetch warning:', err);
            }
        }

        function renderChartSearchResultsList(results, query) {
            const listEl = document.getElementById('chartSearchResultsList');
            const statusEl = document.getElementById('chartSearchStatusBar');
            if (!listEl) return;

            if (!results || results.length === 0) {
                if (statusEl) {
                    statusEl.style.display = 'block';
                    statusEl.innerHTML = query ? `No stocks found matching "<strong>${escapeHtml(query)}</strong>"` : 'Type to search stocks...';
                }
                listEl.innerHTML = '';
                return;
            }

            if (statusEl) statusEl.style.display = 'none';

            let html = '';
            results.forEach((item, idx) => {
                const isActive = idx === chartSearchActiveIndex;
                const activeClass = isActive ? 'active' : '';
                const badgeClass = item.exchange.toUpperCase() === 'BSE' ? 'search-badge-bse' : 'search-badge-nse';

                html += `
                    <div class="chart-search-result-item ${activeClass}" data-index="${idx}" data-symbol="${escapeHtml(item.symbol)}" onclick="selectChartSymbol('${escapeHtml(item.symbol)}')">
                        <div class="search-item-left">
                            <div class="search-item-header">
                                <span class="search-item-symbol">${escapeHtml(item.cleanSymbol)}</span>
                                <span class="search-item-badge ${badgeClass}">${escapeHtml(item.exchange)}</span>
                            </div>
                            <div class="search-item-name">${escapeHtml(item.name)}</div>
                        </div>
                        <div class="search-item-right">
                            <span class="search-item-action">↵ View</span>
                        </div>
                    </div>
                `;
            });

            listEl.innerHTML = html;
        }

        function selectChartSymbol(symbol) {
            if (!symbol) return;
            let targetSym = String(symbol).trim().toUpperCase();
            if (!targetSym.includes('.') && !targetSym.startsWith('^') && !targetSym.includes('=F')) {
                targetSym += '.NS';
            }
            closeChartSymbolSearch();
            openInHouseChart(targetSym);
        }

        function showEmptyChartState(errorMsg = '') {
            const container = document.getElementById('mainChartPane');
            if (!container) return;
            setupChartWatermark();

            let overlay = document.getElementById('chartEmptyStateOverlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'chartEmptyStateOverlay';
                overlay.className = 'chart-empty-state-overlay';
                container.appendChild(overlay);
            }

            const cleanSym = currentChartSymbol ? currentChartSymbol.replace('.NS', '').replace('.BO', '') : 'Stock';
            overlay.innerHTML = `
                <div class="chart-empty-state-card">
                    <div style="font-size: 32px;">📊</div>
                    <div style="font-weight: 700; font-size: 15px; color: #ffffff;">No Chart Data for "${escapeHtml(cleanSym)}"</div>
                    <div style="font-size: 12.5px; color: #94a3b8; line-height: 1.4;">
                        ${escapeHtml(errorMsg || 'Type any stock name or symbol on your keyboard, or click below to search.')}
                    </div>
                    <button type="button" class="chart-empty-state-btn" onclick="openChartSymbolSearch()">🔍 Search Stock (POCL, TCS, RELIANCE...)</button>
                </div>
            `;
            overlay.style.display = 'flex';
        }

        function openEmptyChart() {
            currentChartSymbol = '';
            const modal = document.getElementById('chartModal');
            if (modal) modal.style.display = 'block';
            const symDisplay = document.getElementById('chartSymbolDisplay');
            const nameDisplay = document.getElementById('chartNameDisplay');
            if (symDisplay) symDisplay.innerText = 'SELECT';
            if (nameDisplay) nameDisplay.innerText = 'Click to search or type any letter';
            showEmptyChartState('Type any stock name or symbol to start charting.');
            setTimeout(() => {
                openChartSymbolSearch();
            }, 100);
        }

        function updateActiveSearchItem() {
            const items = document.querySelectorAll('.chart-search-result-item');
            items.forEach((item, idx) => {
                const isAct = idx === chartSearchActiveIndex;
                item.classList.toggle('active', isAct);
                if (isAct) {
                    item.scrollIntoView({ block: 'nearest' });
                }
            });
        }

        let chartSearchEventsInitialized = false;
        function setupChartSymbolSearchEvents() {
            const input = document.getElementById('chartSymbolSearchInput');
            if (input && !input._chartEventsBound) {
                input._chartEventsBound = true;

                input.addEventListener('input', (e) => {
                    triggerChartSymbolSearch(e.target.value);
                });

                input.addEventListener('keyup', (e) => {
                    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter' && e.key !== 'Escape') {
                        triggerChartSymbolSearch(e.target.value);
                    }
                });

                input.addEventListener('keydown', (e) => {
                    const dropdown = document.getElementById('chartSymbolSearchDropdown');
                    if (!dropdown || dropdown.style.display !== 'flex') return;

                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        if (chartSearchResults.length > 0) {
                            chartSearchActiveIndex = (chartSearchActiveIndex + 1) % chartSearchResults.length;
                            updateActiveSearchItem();
                        }
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        if (chartSearchResults.length > 0) {
                            chartSearchActiveIndex = (chartSearchActiveIndex - 1 + chartSearchResults.length) % chartSearchResults.length;
                            updateActiveSearchItem();
                        }
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        if (chartSearchActiveIndex >= 0 && chartSearchActiveIndex < chartSearchResults.length) {
                            selectChartSymbol(chartSearchResults[chartSearchActiveIndex].symbol);
                        } else if (chartSearchResults.length > 0) {
                            selectChartSymbol(chartSearchResults[0].symbol);
                        } else if (input.value.trim()) {
                            selectChartSymbol(input.value.trim());
                        }
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        closeChartSymbolSearch();
                    }
                });
            }

            if (!chartSearchEventsInitialized) {
                chartSearchEventsInitialized = true;

                // Global Keystroke search when on chart (TradingView desktop & web style)
                document.addEventListener('keydown', (e) => {
                    const modal = document.getElementById('chartModal');
                    if (!modal || (modal.style.display !== 'block' && !modal.classList.contains('show'))) return;

                    const dropdown = document.getElementById('chartSymbolSearchDropdown');
                    const isDropdownOpen = dropdown && dropdown.style.display === 'flex';

                    // If dropdown is open and Escape is pressed, close only dropdown
                    if (isDropdownOpen && e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        closeChartSymbolSearch();
                        return;
                    }

                    // If user is already focused on an input/textarea/select/editable, don't intercept
                    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
                    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable)) {
                        return;
                    }

                    // If modifier keys are held (Ctrl, Alt, Meta), don't intercept
                    if (e.ctrlKey || e.metaKey || e.altKey) return;

                    // Any printable alphanumeric key (a-z, A-Z, 0-9) immediately triggers symbol search!
                    if (e.key && e.key.length === 1 && /^[a-zA-Z0-9]$/.test(e.key)) {
                        e.preventDefault();
                        e.stopPropagation();
                        openChartSymbolSearch(e.key);
                    }
                }, true);

                // Close search when clicking outside
                document.addEventListener('click', (e) => {
                    const container = document.getElementById('chartSymbolSearchContainer');
                    if (container && !container.contains(e.target)) {
                        closeChartSymbolSearch();
                    }
                });
            }
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setupChartSymbolSearchEvents);
        } else {
            setupChartSymbolSearchEvents();
        }

        window.openChartSymbolSearch = openChartSymbolSearch;
        window.closeChartSymbolSearch = closeChartSymbolSearch;
        window.toggleChartSymbolSearch = toggleChartSymbolSearch;
        window.clearChartSymbolSearch = clearChartSymbolSearch;
        window.triggerChartSymbolSearch = triggerChartSymbolSearch;
        window.selectChartSymbol = selectChartSymbol;
        window.showEmptyChartState = showEmptyChartState;
        window.openEmptyChart = openEmptyChart;

        window.openInHouseChart = openInHouseChart;
        window.closeChartModal = closeChartModal;
        window.cancelDrawingTool = cancelDrawingTool;
        window.activateDrawingTool = activateDrawingTool;
        window.showDrawingBanner = showDrawingBanner;
        window.hideDrawingBanner = hideDrawingBanner;
        window.getCurrentDrawingTool = () => currentDrawingTool;
        window.redrawCanvasOverlay = redrawCanvasOverlay;
        window.applyChartTheme = applyChartTheme;
        window.toggleChartPopover = toggleChartPopover;
        window.closeAllChartPopovers = closeAllChartPopovers;
        window.setActiveToolColor = setActiveToolColor;
        window.setChartInterval = setChartInterval;
        window.setChartType = setChartType;
        window.setChartRange = changeRange;
        window.getCurrentChartRange = () => currentChartRange;
        window.toggleChartIndicator = toggleIndicators;
        window.setDrawingTool = activateDrawingTool;
        window.deleteSelectedDrawing = deleteCurrentEditDrawing;
        window.clearAllChartDrawings = clearDrawings;
        initServerDrawingsSync();
        window.resetChartZoom = () => zoomChart(1);
        window.renderFavoriteToolsShortcuts = renderFavoriteToolsShortcuts;
        window.toggleFavoriteTool = toggleFavoriteTool;
        window.executeToolById = executeToolById;
        window.showCanvasObjectMenu = showCanvasObjectMenu;
        window.hideCanvasObjectMenu = hideCanvasObjectMenu;

        // =========================================================
        // CAPITAL DESK CHART IMAGE GENERATION & EXPORT
        // =========================================================

        let cdBrandIconCache = null;
        function getCapitalDeskBrandIcon() {
            return new Promise((resolve) => {
                if (cdBrandIconCache && cdBrandIconCache.complete && (cdBrandIconCache.naturalWidth > 0 || cdBrandIconCache.width > 0)) {
                    return resolve(cdBrandIconCache);
                }
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    cdBrandIconCache = img;
                    resolve(img);
                };
                img.onerror = () => {
                    console.warn('Could not load /static/favicon-192.png, trying fallback');
                    const fb = new Image();
                    fb.crossOrigin = 'anonymous';
                    fb.onload = () => {
                        cdBrandIconCache = fb;
                        resolve(fb);
                    };
                    fb.onerror = () => {
                        const fb2 = new Image();
                        fb2.crossOrigin = 'anonymous';
                        fb2.onload = () => { cdBrandIconCache = fb2; resolve(fb2); };
                        fb2.onerror = () => resolve(null);
                        fb2.src = '/static/icon.png';
                    };
                    fb.src = '/static/capital_desk_icon.png';
                };
                img.src = '/static/favicon-192.png';
                if (img.complete && (img.naturalWidth > 0 || img.width > 0)) {
                    cdBrandIconCache = img;
                    resolve(img);
                }
            });
        }
        try {
            getCapitalDeskBrandIcon();
        } catch (e) {}

        async function generateTradingViewChartSnapshotCanvas() {
            const chartInstance = window.mainChart || mainChart;
            if (!chartInstance || typeof chartInstance.takeScreenshot !== 'function') {
                return null;
            }

            const mainCanvas = chartInstance.takeScreenshot();
            if (!mainCanvas) return null;

            const drawingCanvas = document.getElementById('chartDrawingCanvas');
            const rsiPane = document.getElementById('rsiChartPane');
            const rsiInstance = window.rsiChart || rsiChart;
            const isRsiVisible = rsiPane && rsiPane.style.display !== 'none' && rsiInstance && typeof rsiInstance.takeScreenshot === 'function';
            const rsiCanvas = isRsiVisible ? rsiInstance.takeScreenshot() : null;

            const macdPane = document.getElementById('macdChartPane');
            const macdInstance = window.macdChart || macdChart;
            const isMacdVisible = macdPane && macdPane.style.display !== 'none' && macdInstance && typeof macdInstance.takeScreenshot === 'function';
            const macdCanvas = isMacdVisible ? macdInstance.takeScreenshot() : null;

            const w = mainCanvas.width;
            const headerH = 64;
            const footerH = 38;
            const mainH = mainCanvas.height;
            const rsiH = rsiCanvas ? rsiCanvas.height : 0;
            const macdH = macdCanvas ? macdCanvas.height : 0;
            const totalH = headerH + mainH + rsiH + macdH + footerH;

            // Create composite canvas
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = totalH;
            const ctx = canvas.getContext('2d');

            // 1. Dark TradingView Background
            ctx.fillStyle = '#131722';
            ctx.fillRect(0, 0, w, totalH);

            // 2. Draw Main Chart
            ctx.drawImage(mainCanvas, 0, headerH);

            // 3. Draw Drawings Overlay
            if (drawingCanvas) {
                ctx.drawImage(drawingCanvas, 0, headerH);
            }

            // 4. Draw RSI Pane if visible
            let currentPaneY = headerH + mainH;
            if (rsiCanvas) {
                ctx.drawImage(rsiCanvas, 0, currentPaneY);
                ctx.strokeStyle = '#2a2e39';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, currentPaneY);
                ctx.lineTo(w, currentPaneY);
                ctx.stroke();
                currentPaneY += rsiH;
            }

            // 5. Draw MACD Pane if visible
            if (macdCanvas) {
                ctx.drawImage(macdCanvas, 0, currentPaneY);
                ctx.strokeStyle = '#2a2e39';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, currentPaneY);
                ctx.lineTo(w, currentPaneY);
                ctx.stroke();
                currentPaneY += macdH;
            }

            // 6. Draw Subtle Watermark in Center
            const sym = (window.currentChartSymbol || currentChartSymbol || 'STOCK').replace(/\.(NS|BO)$/i, '').toUpperCase();
            const interval = (window.currentChartInterval || currentChartInterval || savedChartInterval || '1D').toUpperCase();
            const prices = (typeof stockPricesData !== 'undefined' && stockPricesData) ? stockPricesData : {};
            const stockInfo = prices[sym] || prices[sym + '.NS'] || prices[sym + '.BO'] || {};
            const compName = document.getElementById('chartCompanyName')?.innerText?.trim() || stockInfo.name || sym;

            const rightAxisW = 75;
            const chartCenterX = (w - rightAxisW) / 2;
            const chartCenterY = headerH + (mainH - 30) / 2;

            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = 'bold 64px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
            ctx.fillText(`${sym}  ${interval}`, chartCenterX, chartCenterY - 14);

            ctx.font = '500 22px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.022)';
            ctx.fillText(compName, chartCenterX, chartCenterY + 32);
            ctx.restore();

            // 6b. Draw Left Bottom Watermark on Main Chart Pane (Same Capital Desk Logo)
            let brandIcon = null;
            try {
                brandIcon = await getCapitalDeskBrandIcon();
            } catch (e) {
                console.warn('Error loading Capital Desk icon for watermark:', e);
            }

            const wmIconSize = 22;
            const wmX = 16;
            const wmY = headerH + mainH - 34 - wmIconSize; // Positioned cleanly above bottom time axis

            ctx.save();
            ctx.globalAlpha = 0.55;
            if (brandIcon && brandIcon.complete && (brandIcon.naturalWidth > 0 || brandIcon.width > 0)) {
                try {
                    ctx.save();
                    if (typeof ctx.roundRect === 'function') {
                        ctx.beginPath();
                        ctx.roundRect(wmX, wmY, wmIconSize, wmIconSize, 4);
                        ctx.clip();
                    }
                    ctx.drawImage(brandIcon, wmX, wmY, wmIconSize, wmIconSize);
                    ctx.restore();
                } catch (e) {}
            } else {
                ctx.fillStyle = '#0b9a5e';
                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') {
                    ctx.roundRect(wmX, wmY, wmIconSize, wmIconSize, 4);
                } else {
                    ctx.rect(wmX, wmY, wmIconSize, wmIconSize);
                }
                ctx.fill();
            }

            ctx.font = "bold 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('Capital Desk', wmX + wmIconSize + 8, wmY + (wmIconSize / 2));
            ctx.restore();

            // 7. Draw Top Header: Attribution & Live Metrics
            let username = '';
            try {
                username = document.getElementById('header-username')?.innerText?.trim();
            } catch (e) {}
            if (!username || username.toLowerCase() === 'user' || username.toLowerCase() === 'admin') {
                username = 'SampathNallasamy';
            }

            const now = new Date();
            let timeFormatted = '';
            try {
                const parts = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'Asia/Kolkata',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                }).formatToParts(now);
                const pMap = {};
                parts.forEach(p => pMap[p.type] = p.value);
                timeFormatted = `${pMap.month} ${pMap.day}, ${pMap.year} ${pMap.hour}:${pMap.minute} IST`;
            } catch (e) {
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                timeFormatted = `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} IST`;
            }

            // Line 1: Attribution
            ctx.font = '12px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif';
            ctx.fillStyle = '#787b86';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(`${username} created with Capital Desk, ${timeFormatted}`, 16, 12);

            // Line 2: Company • Interval • Exch • OHLCV
            let legOpen = document.getElementById('legOpen')?.innerText?.trim() || '-';
            let legHigh = document.getElementById('legHigh')?.innerText?.trim() || '-';
            let legLow = document.getElementById('legLow')?.innerText?.trim() || '-';
            let legClose = document.getElementById('legClose')?.innerText?.trim() || '-';
            let legChgPct = document.getElementById('legChgPct')?.innerText?.trim() || '';
            let legVol = document.getElementById('legVol')?.innerText?.trim() || '-';
            const exch = (window.currentChartSymbol || currentChartSymbol || '').toUpperCase().endsWith('.BO') ? 'BSE' : 'NSE';

            if ((!legOpen || legOpen === '-') && window.cachedChartData && Array.isArray(window.cachedChartData.candles) && window.cachedChartData.candles.length > 0) {
                const candles = window.cachedChartData.candles;
                const last = candles[candles.length - 1];
                const prev = candles.length > 1 ? candles[candles.length - 2] : last;
                legOpen = last.open !== undefined ? last.open.toFixed(2) : '-';
                legHigh = last.high !== undefined ? last.high.toFixed(2) : '-';
                legLow = last.low !== undefined ? last.low.toFixed(2) : '-';
                legClose = last.close !== undefined ? last.close.toFixed(2) : '-';
                const diff = (last.close || 0) - (prev.close || 0);
                const diffPct = prev.close ? (diff / prev.close) * 100 : 0;
                const sign = diff >= 0 ? '+' : '';
                legChgPct = `${sign}${diff.toFixed(2)} (${sign}${diffPct.toFixed(2)}%)`;
                if (last.volume) {
                    legVol = last.volume >= 1e7 ? (last.volume / 1e7).toFixed(2) + ' Cr' :
                             last.volume >= 1e5 ? (last.volume / 1e5).toFixed(2) + ' L' :
                             last.volume >= 1e3 ? (last.volume / 1e3).toFixed(2) + ' K' : String(last.volume);
                }
            }

            let curX = 16;
            const line2Y = 36;
            ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif';
            ctx.fillStyle = '#d1d4dc';
            ctx.fillText(compName, curX, line2Y);
            curX += ctx.measureText(compName).width;

            ctx.font = '12px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif';
            ctx.fillStyle = '#787b86';
            const sep = ` • ${interval} • ${exch} `;
            ctx.fillText(sep, curX, line2Y);
            curX += ctx.measureText(sep).width;

            const isGreen = !legChgPct.startsWith('-');
            const chgColor = isGreen ? '#26a69a' : '#ef5350';

            function drawMetric(label, val, valColor) {
                ctx.fillStyle = '#787b86';
                ctx.fillText(label, curX, line2Y);
                curX += ctx.measureText(label).width;
                ctx.fillStyle = valColor;
                ctx.fillText(val + ' ', curX, line2Y);
                curX += ctx.measureText(val + ' ').width;
            }

            drawMetric('O', legOpen, chgColor);
            drawMetric('H', legHigh, chgColor);
            drawMetric('L', legLow, chgColor);
            drawMetric('C', legClose, chgColor);
            if (legChgPct) {
                ctx.fillStyle = chgColor;
                ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif';
                ctx.fillText(legChgPct + ' ', curX, line2Y);
                curX += ctx.measureText(legChgPct + ' ').width;
                ctx.font = '12px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif';
            }
            if (legVol && legVol !== '-') {
                drawMetric('Vol', legVol, chgColor);
            }

            // Top Right: Currency INR badge
            const badgeW = 42;
            const badgeH = 20;
            const badgeX = w - badgeW - 16;
            const badgeY = 32;
            ctx.fillStyle = '#1e222d';
            ctx.strokeStyle = '#2a2e39';
            ctx.lineWidth = 1;
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
                ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
            } else {
                ctx.rect(badgeX, badgeY, badgeW, badgeH);
            }
            ctx.fill();
            ctx.stroke();

            ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif';
            ctx.fillStyle = '#d1d4dc';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('INR', badgeX + badgeW / 2, badgeY + badgeH / 2);

            // 8. Draw Footer: Capital Desk Brand Logo & Typography
            const footerY = totalH - footerH;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';

            const iconSize = 22;
            const iconX = 16;
            const iconY = footerY + Math.round((footerH - iconSize) / 2);

            if (!brandIcon) {
                try {
                    brandIcon = await getCapitalDeskBrandIcon();
                } catch (e) {
                    console.warn('Error loading Capital Desk icon:', e);
                }
            }

            if (brandIcon && brandIcon.complete && (brandIcon.naturalWidth > 0 || brandIcon.width > 0)) {
                try {
                    ctx.save();
                    if (typeof ctx.roundRect === 'function') {
                        ctx.beginPath();
                        ctx.roundRect(iconX, iconY, iconSize, iconSize, 4);
                        ctx.clip();
                    }
                    ctx.drawImage(brandIcon, iconX, iconY, iconSize, iconSize);
                    ctx.restore();
                } catch (e) {
                    console.warn('Could not draw brand icon:', e);
                }
            } else {
                // Vector fallback if image asset is unavailable
                ctx.fillStyle = '#0b9a5e';
                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') {
                    ctx.roundRect(iconX, iconY, iconSize, iconSize, 4);
                } else {
                    ctx.rect(iconX, iconY, iconSize, iconSize);
                }
                ctx.fill();
                ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.fillText('CD', iconX + (iconSize / 2), iconY + (iconSize / 2));
            }

            // Wordmark: Capital Desk
            const textX = iconX + iconSize + 9;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.font = "bold 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
            ctx.fillStyle = '#ffffff';
            ctx.fillText('Capital Desk', textX, footerY + (footerH / 2) + 0.5);

            return canvas;
        }

        async function downloadChartImage() {
            try {
                const canvas = await generateTradingViewChartSnapshotCanvas();
                if (!canvas) {
                    if (typeof showToast === 'function') showToast('Chart is not ready to capture.', 'warning');
                    return;
                }

                const sym = (window.currentChartSymbol || currentChartSymbol || 'CHART').replace(/\.(NS|BO)$/i, '').toUpperCase();
                const interval = (window.currentChartInterval || currentChartInterval || savedChartInterval || '1D').toUpperCase();
                const now = new Date();
                const dateStr = now.toISOString().slice(0, 10);
                const fileName = `${sym}_${interval}_CapitalDesk_${dateStr}.png`;

                const link = document.createElement('a');
                link.download = fileName;
                link.href = canvas.toDataURL('image/png');
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                if (typeof showToast === 'function') {
                    showToast(`Chart image downloaded (${fileName})`, 'success');
                }
            } catch (err) {
                console.error('Failed to download chart image:', err);
                if (typeof showToast === 'function') showToast('Failed to download chart image.', 'error');
            }
        }

        async function copyChartImage() {
            try {
                const canvas = await generateTradingViewChartSnapshotCanvas();
                if (!canvas) {
                    if (typeof showToast === 'function') showToast('Chart is not ready to capture.', 'warning');
                    return;
                }

                if (canvas.toBlob && navigator.clipboard && typeof navigator.clipboard.write === 'function') {
                    canvas.toBlob(async (blob) => {
                        if (!blob) {
                            downloadChartImage();
                            return;
                        }
                        try {
                            await navigator.clipboard.write([
                                new ClipboardItem({ 'image/png': blob })
                            ]);
                            if (typeof showToast === 'function') {
                                showToast('Chart image copied to clipboard!', 'success');
                            }
                        } catch (clipErr) {
                            console.warn('Clipboard write error, falling back to download:', clipErr);
                            downloadChartImage();
                            if (typeof showToast === 'function') {
                                showToast('Clipboard access restricted. Downloaded image instead.', 'info');
                            }
                        }
                    }, 'image/png');
                } else {
                    downloadChartImage();
                    if (typeof showToast === 'function') {
                        showToast('Clipboard not supported. Downloaded image instead.', 'info');
                    }
                }
            } catch (err) {
                console.error('Failed to copy chart image:', err);
                if (typeof showToast === 'function') showToast('Failed to copy chart image.', 'error');
            }
        }

        window.generateTradingViewChartSnapshotCanvas = generateTradingViewChartSnapshotCanvas;
        window.generateCapitalDeskChartSnapshotCanvas = generateTradingViewChartSnapshotCanvas;
        window.downloadChartImage = downloadChartImage;
        window.copyChartImage = copyChartImage;


