        // =========================================================
        // TECHNICAL CHARTS (PRO CANVAS ENGINE)
        // =========================================================
        var currentChartSymbol = window.currentChartSymbol || '';
        var savedChartInterval = '1d';
        try {
            savedChartInterval = localStorage.getItem('capital_desk_chart_interval') || window.currentChartInterval || '1d';
        } catch(e) {}
        var currentChartInterval = savedChartInterval;
        var currentChartRange = window.currentChartRange || '1y';
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
        var sma50Series = null;
        var sma200Series = null;
        var ema9Series = null;
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

        document.addEventListener('click', function(e) {
            if (!e.target.closest('.chart-popover-wrapper')) {
                closeAllChartPopovers();
            }
        });

        function loadSavedChartIndicators() {
            try {
                const saved = localStorage.getItem('capital_desk_chart_indicators');
                if (saved) {
                    const prefs = JSON.parse(saved);
                    const keys = ['chkCdRider', 'chkVolume', 'chkVolumeMa', 'chkSma50', 'chkSma200', 'chkEma9', 'chkGann2Day', 'chkRsi', 'chkMacd'];
                    keys.forEach(k => {
                        const el = document.getElementById(k);
                        if (el && prefs[k] !== undefined) {
                            el.checked = prefs[k];
                        }
                    });
                }
            } catch(e){}
        }

        var activeToolColor = '#10b981'; // Active drawing color

        function setActiveToolColor(colorHex, el) {
            activeToolColor = colorHex;
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
        // DRAWINGS STORAGE & INDIVIDUAL MANAGEMENT
        // =========================================================
        function getSavedPriceLines(sym) {
            try {
                const data = localStorage.getItem('capital_desk_chart_lines_' + sym);
                return data ? JSON.parse(data) : [];
            } catch(e) { return []; }
        }

        function savePriceLineForSymbol(sym, lineData) {
            try {
                if (!lineData.id) {
                    lineData.id = 'pl_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
                }
                const existing = getSavedPriceLines(sym);
                existing.push(lineData);
                localStorage.setItem('capital_desk_chart_lines_' + sym, JSON.stringify(existing));
                renderActiveDrawingsList();
            } catch(e){}
        }

        function clearSavedPriceLines(sym) {
            try {
                localStorage.removeItem('capital_desk_chart_lines_' + sym);
                renderActiveDrawingsList();
            } catch(e){}
        }

        let isAllDrawingsHidden = false;

        function togglePriceLineVisibility(id) {
            const lines = getSavedPriceLines(currentChartSymbol);
            const item = lines.find(x => x.id === id);
            if (item) {
                item.hidden = !item.hidden;
                localStorage.setItem('capital_desk_chart_lines_' + currentChartSymbol, JSON.stringify(lines));
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
                localStorage.setItem('capital_desk_chart_shapes_' + currentChartSymbol, JSON.stringify(shapes));
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
                        const priceLine = mainSeries.createPriceLine({
                            price: item.price,
                            color: item.color || '#10b981',
                            lineWidth: 2,
                            lineStyle: LightweightCharts.LineStyle.Dashed,
                            axisLabelVisible: true,
                            title: `${item.label || 'Line'}: ₹${item.price}`
                        });
                        activePriceLines.push({ id: item.id, lineObj: priceLine, data: item });
                    } catch(e){}
                }
            });
            renderActiveDrawingsList();
        }

        function deletePriceLineById(id) {
            const idx = activePriceLines.findIndex(pl => pl.id === id);
            if (idx !== -1) {
                try { mainSeries.removePriceLine(activePriceLines[idx].lineObj); } catch(e){}
                activePriceLines.splice(idx, 1);
            }
            const lines = getSavedPriceLines(currentChartSymbol);
            const updated = lines.filter(item => item.id !== id);
            localStorage.setItem('capital_desk_chart_lines_' + currentChartSymbol, JSON.stringify(updated));
            redrawCanvasOverlay();
            renderActiveDrawingsList();
        }

        function updatePriceLineColorById(id, newColor) {
            const lines = getSavedPriceLines(currentChartSymbol);
            const item = lines.find(x => x.id === id);
            if (item) {
                item.color = newColor;
                localStorage.setItem('capital_desk_chart_lines_' + currentChartSymbol, JSON.stringify(lines));
                restoreSavedPriceLines(currentChartSymbol);
                redrawCanvasOverlay();
            }
        }

        function getSavedChartShapes(sym) {
            try {
                const data = localStorage.getItem('capital_desk_chart_shapes_' + sym);
                return data ? JSON.parse(data) : [];
            } catch(e) { return []; }
        }

        function saveChartShapeForSymbol(sym, shapeData) {
            try {
                if (!shapeData.id) {
                    shapeData.id = 'sh_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
                }
                const existing = getSavedChartShapes(sym);
                existing.push(shapeData);
                localStorage.setItem('capital_desk_chart_shapes_' + sym, JSON.stringify(existing));
                renderActiveDrawingsList();
            } catch(e){}
        }

        function clearSavedChartShapes(sym) {
            try {
                localStorage.removeItem('capital_desk_chart_shapes_' + sym);
                renderActiveDrawingsList();
            } catch(e){}
        }

        function deleteShapeById(id) {
            const shapes = getSavedChartShapes(currentChartSymbol);
            const updated = shapes.filter(s => s.id !== id);
            localStorage.setItem('capital_desk_chart_shapes_' + currentChartSymbol, JSON.stringify(updated));
            redrawCanvasOverlay();
            renderActiveDrawingsList();
        }

        function updateShapeColorById(id, newColor) {
            const shapes = getSavedChartShapes(currentChartSymbol);
            const shape = shapes.find(s => s.id === id);
            if (shape) {
                shape.color = newColor;
                if (shape.type === 'rectangle') {
                    shape.fillColor = hexToRgba(newColor, 0.18);
                }
                localStorage.setItem('capital_desk_chart_shapes_' + currentChartSymbol, JSON.stringify(shapes));
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

            if (!mount) return;

            if (totalCount === 0) {
                mount.innerHTML = `<div style="text-align: center; color: #787b86; padding: 18px 0; font-size: 12px; font-weight: 500;">No active drawings on chart.</div>`;
                return;
            }

            let html = '';

            lines.forEach(l => {
                const labelName = l.label || 'Support';
                const itemColor = l.color || '#10b981';
                const isHidden = !!l.hidden;
                html += `
                    <div class="active-drawing-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: #1a1e29; border: 1px solid #2a2e39; border-radius: 6px; font-size: 12px; color: #d1d4dc; opacity: ${isHidden ? '0.6' : '1'};">
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
                            <div style="position: relative; display: flex; align-items: center; flex-shrink: 0;">
                                <span style="display: inline-block; width: 12px; height: 12px; border-radius: 3px; background: ${itemColor}; cursor: pointer;" title="Change line color"></span>
                                <input type="color" value="${itemColor}" onchange="updatePriceLineColorById('${l.id}', this.value)" style="position: absolute; top: 0; left: 0; width: 12px; height: 12px; opacity: 0; cursor: pointer;">
                            </div>
                            <span style="font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; color: ${isHidden ? '#787b86' : '#e1e3e6'}; text-decoration: ${isHidden ? 'line-through' : 'none'};">${escapeHtml(labelName)}: ₹${l.price}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
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
                else if (s.type === 'vertical') { name = 'Time Line'; icon = '🕒'; }
                else if (s.type === 'note') { name = `Note: ${s.text || ''}`; icon = '📍'; }

                const itemColor = s.color || '#3b82f6';
                const isHidden = !!s.hidden;
                html += `
                    <div class="active-drawing-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: #1a1e29; border: 1px solid #2a2e39; border-radius: 6px; font-size: 12px; color: #d1d4dc; opacity: ${isHidden ? '0.6' : '1'};">
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
                            <div style="position: relative; display: flex; align-items: center; flex-shrink: 0;">
                                <span style="display: inline-block; width: 12px; height: 12px; border-radius: 3px; background: ${itemColor}; cursor: pointer;" title="Change shape color"></span>
                                <input type="color" value="${itemColor}" onchange="updateShapeColorById('${s.id}', this.value)" style="position: absolute; top: 0; left: 0; width: 12px; height: 12px; opacity: 0; cursor: pointer;">
                            </div>
                            <span style="font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; color: ${isHidden ? '#787b86' : '#e1e3e6'}; text-decoration: ${isHidden ? 'line-through' : 'none'};">${icon} ${escapeHtml(name)}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                            <button onclick="toggleShapeVisibility('${s.id}')" style="background: none; border: none; cursor: pointer; font-size: 13px; color: ${isHidden ? '#787b86' : '#10b981'}; padding: 2px 4px;" title="${isHidden ? 'Show this shape' : 'Hide this shape'}">${isHidden ? '🙈' : '👁️'}</button>
                            <button class="active-drawing-delete-btn" onclick="deleteShapeById('${s.id}')" title="Delete this shape">🗑️</button>
                        </div>
                    </div>
                `;
            });

            mount.innerHTML = html;
        }

        async function addHorizontalLinePrompt(type) {
            if (!mainSeries || !latestCandlePrice) {
                showToast('Please wait for chart data to load.', 'warning');
                return;
            }

            let defaultPrice = latestCandlePrice;
            let label = 'Support';
            let color = activeToolColor || '#10b981';

            if (type === 'target') {
                defaultPrice = parseFloat((latestCandlePrice * 1.05).toFixed(2));
                label = 'Target';
                color = activeToolColor || '#10b981';
            } else if (type === 'stoploss') {
                defaultPrice = parseFloat((latestCandlePrice * 0.95).toFixed(2));
                label = 'Stop Loss';
                color = activeToolColor || '#ef5350';
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
            const label = customLabel || (type === 'target' ? 'Target' : type === 'stoploss' ? 'Stop Loss' : 'Support');
            const lineId = 'pl_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
            const lineData = { id: lineId, type: type, price: price, color: color || activeToolColor, label: label };

            const priceLine = mainSeries.createPriceLine({
                price: price,
                color: color || activeToolColor,
                lineWidth: 2,
                lineStyle: LightweightCharts.LineStyle.Dashed,
                axisLabelVisible: true,
                title: `${label}: ₹${price}`
            });

            activePriceLines.push({ id: lineId, lineObj: priceLine, data: lineData });
            savePriceLineForSymbol(currentChartSymbol, lineData);
        }

        function clearDrawings() {
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
        }

        // =========================================================
        // FAVORITE DRAWING TOOLS SHORTCUTS (Mobile & Web)
        // =========================================================
        const CHART_TOOL_META = {
            'support_click': { id: 'support_click', icon: '📍', title: 'Support Line (Click)', action: () => activateDrawingTool('support_click') },
            'support': { id: 'support', icon: '🟢', title: 'Support Line (Price)', action: () => addHorizontalLinePrompt('support') },
            'target': { id: 'target', icon: '🎯', title: 'Target Price Line', action: () => addHorizontalLinePrompt('target') },
            'stoploss': { id: 'stoploss', icon: '🛑', title: 'StopLoss Line', action: () => addHorizontalLinePrompt('stoploss') },
            'trendline': { id: 'trendline', icon: '📈', title: 'Diagonal Trendline', action: () => activateDrawingTool('trendline') },
            'rectangle': { id: 'rectangle', icon: '⬛', title: 'Rectangle Zone', action: () => activateDrawingTool('rectangle') },
            'pricerange': { id: 'pricerange', icon: '📏', title: 'Price Range %', action: () => activateDrawingTool('pricerange') },
            'vertical': { id: 'vertical', icon: '🕒', title: 'Time Line Marker', action: () => activateDrawingTool('vertical') },
            'note': { id: 'note', icon: '📝', title: 'Text Note / Callout', action: () => activateDrawingTool('note') }
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

            // Render Web Toolbar (Image 2 - at end of legend row)
            if (webBar) {
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

            // Render Mobile Floating Toolbar (Image 1)
            if (mobileBar && mobileIcons) {
                mobileIcons.innerHTML = '';
                if (favs.length === 0) {
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
                }
            }

            updatePopoverToolStars();
        }

        let isMobileFavBarDragInitialized = false;
        function initMobileFavBarDrag() {
            if (isMobileFavBarDragInitialized) return;
            const bar = document.getElementById('chartMobileFavBar');
            if (!bar) return;
            isMobileFavBarDragInitialized = true;
            const handle = bar.querySelector('.fav-bar-handle') || bar;
            let isDragging = false;
            let startX = 0, startY = 0;
            let initialLeft = 0, initialTop = 0;

            const onPointerDown = (e) => {
                isDragging = true;
                const rect = bar.getBoundingClientRect();
                const parentRect = (bar.parentElement || document.body).getBoundingClientRect();
                initialLeft = rect.left - parentRect.left;
                initialTop = rect.top - parentRect.top;
                const pt = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
                startX = pt.clientX;
                startY = pt.clientY;
                bar.style.right = 'auto';
                bar.style.left = initialLeft + 'px';
                bar.style.top = initialTop + 'px';
                window.addEventListener('pointermove', onPointerMove, { passive: false });
                window.addEventListener('pointerup', onPointerUp);
                window.addEventListener('touchmove', onPointerMove, { passive: false });
                window.addEventListener('touchend', onPointerUp);
            };

            const onPointerMove = (e) => {
                if (!isDragging) return;
                e.preventDefault();
                const pt = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
                const dx = pt.clientX - startX;
                const dy = pt.clientY - startY;
                const parentRect = (bar.parentElement || document.body).getBoundingClientRect();
                const maxLeft = parentRect.width - bar.offsetWidth - 4;
                const maxTop = parentRect.height - bar.offsetHeight - 4;
                const newLeft = Math.max(4, Math.min(maxLeft, initialLeft + dx));
                const newTop = Math.max(4, Math.min(maxTop, initialTop + dy));
                bar.style.left = newLeft + 'px';
                bar.style.top = newTop + 'px';
            };

            const onPointerUp = () => {
                isDragging = false;
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('touchmove', onPointerMove);
                window.removeEventListener('touchend', onPointerUp);
            };

            handle.addEventListener('pointerdown', onPointerDown);
            handle.addEventListener('touchstart', onPointerDown, { passive: false });
        }

        // =========================================================
        // ADVANCED CHART DRAWING TOOLS (Trendline, Rectangle, Time Line, Note, Support Click)
        // =========================================================
        let currentDrawingTool = null; // 'support_click' | 'trendline' | 'rectangle' | 'vertical' | 'note'
        let drawingPoints = [];
        let tempMousePos = null;
        let drawingCanvas = null;

        function activateDrawingTool(toolType) {
            if (!mainSeries || !mainChart) {
                alert('Please wait for chart data to load.');
                return;
            }

            hideCanvasObjectMenu();
            currentDrawingTool = toolType;
            drawingPoints = [];
            tempMousePos = null;

            updateDrawingToolButtonsUI();
            showDrawingBanner(toolType);
            enableCanvasInteractions(true);
        }

        function updateDrawingToolButtonsUI() {
            const tools = ['support_click', 'support', 'target', 'stoploss', 'trendline', 'rectangle', 'pricerange', 'vertical', 'note'];
            tools.forEach(t => {
                const btn = document.getElementById(`tool-btn-${t}`);
                if (btn) {
                    if (t === currentDrawingTool) {
                        btn.classList.add('active');
                        btn.style.background = '#10b981';
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
            let banner = document.getElementById('drawingToolBanner');
            const mainContainer = document.getElementById('mainChartPane');
            if (!banner && mainContainer) {
                banner = document.createElement('div');
                banner.id = 'drawingToolBanner';
                banner.style.cssText = `
                    position: absolute;
                    top: 10px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(16, 185, 129, 0.95);
                    color: #ffffff;
                    padding: 6px 16px;
                    border-radius: 20px;
                    font-size: 12px;
                    font-weight: 700;
                    z-index: 100;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    backdrop-filter: blur(4px);
                    pointer-events: auto;
                `;
                mainContainer.appendChild(banner);
            }

            let msg = 'Click on chart to draw';
            if (toolType === 'support_click') msg = '🟢 Support Line: Click anywhere on chart or Right Y-Axis to place line at price level.';
            else if (toolType === 'pricerange') msg = '📏 Price Range % Calculator: Click 1st point (Start Price), then 2nd point (End Price). Press Esc to cancel.';
            else if (toolType === 'trendline') msg = '📐 Trendline: Click 1st point (Start), then 2nd point (End). Press Esc to cancel.';
            else if (toolType === 'rectangle') msg = '⬜ Rectangle Zone: Click 1st corner, then opposite corner. Press Esc to cancel.';
            else if (toolType === 'vertical') msg = '⏱️ Time Line: Click on chart to place vertical marker. Press Esc to cancel.';
            else if (toolType === 'note') msg = '📍 Text Note: Click on chart to place text note. Press Esc to cancel.';

            if (banner) {
                banner.innerHTML = `<span>${msg}</span> <button onclick="cancelDrawingTool()" style="background: rgba(0,0,0,0.25); border: none; color: #fff; padding: 2px 8px; border-radius: 10px; cursor: pointer; font-size: 11px;">Cancel (Esc)</button>`;
                banner.style.display = 'flex';
            }
        }

        function hideDrawingBanner() {
            const banner = document.getElementById('drawingToolBanner');
            if (banner) banner.style.display = 'none';
        }

        function cancelDrawingTool() {
            currentDrawingTool = null;
            drawingPoints = [];
            tempMousePos = null;
            updateDrawingToolButtonsUI();
            hideDrawingBanner();
            enableCanvasInteractions(false);
            redrawCanvasOverlay();
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                cancelDrawingTool();
                hideCanvasObjectMenu();
            }
        });

        function setupCanvasOverlay() {
            const mainContainer = document.getElementById('mainChartPane');
            if (!mainContainer) return;

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
            mainContainer.removeEventListener('click', handleChartPaneClick);
            mainContainer.removeEventListener('touchend', handleChartPaneTouchEnd);

            mainContainer.addEventListener('mousemove', handleChartPaneMouseMove);
            mainContainer.addEventListener('mousedown', handleChartPaneMouseDown);
            mainContainer.addEventListener('click', handleChartPaneClick);
            mainContainer.addEventListener('touchend', handleChartPaneTouchEnd);

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
                if (currentDrawingTool) return;
                if (e.target && e.target.closest && e.target.closest('#canvasObjectPopup')) return;
                isUserDraggingChart = true;
                window.addEventListener('pointermove', onWindowPointerMove);
                window.addEventListener('pointerup', onWindowPointerUp);
                window.addEventListener('touchmove', onWindowPointerMove, { passive: true });
                window.addEventListener('touchend', onWindowPointerUp);
            });

            mainContainer.addEventListener('wheel', () => {
                requestAnimationFrame(() => redrawCanvasOverlay());
            }, { passive: true });

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
                drawingCanvas.style.pointerEvents = enable ? 'auto' : 'none';
                drawingCanvas.style.cursor = enable ? 'crosshair' : 'default';
            }
        }

        function normalizeTime(t) {
            if (!t) return null;
            if (typeof t === 'string') return t;
            if (typeof t === 'number') {
                const d = new Date(t * 1000);
                const yyyy = d.getUTCFullYear();
                const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
                const dd = String(d.getUTCDate()).padStart(2, '0');
                return `${yyyy}-${mm}-${dd}`;
            }
            if (typeof t === 'object' && t.year && t.month && t.day) {
                const yyyy = t.year;
                const mm = String(t.month).padStart(2, '0');
                const dd = String(t.day).padStart(2, '0');
                return `${yyyy}-${mm}-${dd}`;
            }
            return t;
        }

        function findClosestCandleByTime(candles, targetTime) {
            if (!candles || candles.length === 0) return null;
            const normTarget = normalizeTime(targetTime);
            if (!normTarget) return candles[0];

            const directMatch = candles.find(c => normalizeTime(c.time) === normTarget);
            if (directMatch) return directMatch;

            let targetTs = 0;
            if (typeof normTarget === 'string') {
                targetTs = new Date(normTarget).getTime() / 1000;
            } else if (typeof normTarget === 'number') {
                targetTs = normTarget;
            }
            if (isNaN(targetTs) || targetTs === 0) return candles[0];

            let closest = candles[0];
            let minDiff = Infinity;

            for (let i = 0; i < candles.length; i++) {
                const c = candles[i];
                let cTs = 0;
                const normC = normalizeTime(c.time);
                if (typeof normC === 'string') cTs = new Date(normC).getTime() / 1000;
                else if (typeof normC === 'number') cTs = normC;

                const diff = Math.abs(cTs - targetTs);
                if (diff < minDiff) {
                    minDiff = diff;
                    closest = c;
                }
            }
            return closest;
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

            const candleCount = (cachedChartData && cachedChartData.candles) ? cachedChartData.candles.length : 0;
            const lastCandleIndex = candleCount > 0 ? candleCount - 1 : 0;

            if (logical !== null && logical !== undefined && candleCount > 0) {
                if (logical > lastCandleIndex) {
                    futureOffset = Math.round(logical - lastCandleIndex);
                    const lastCandleTime = cachedChartData.candles[lastCandleIndex].time;
                    time = normalizeTime(lastCandleTime);
                } else if (!time && logical < 0) {
                    futureOffset = Math.round(logical);
                    time = normalizeTime(cachedChartData.candles[0].time);
                }
            }

            return { x, y, price, time, logical, futureOffset };
        }

        function getShapeX(timeScale, time, logical, futureOffset = 0) {
            if (!timeScale) return null;

            const candleCount = (cachedChartData && cachedChartData.candles) ? cachedChartData.candles.length : 0;
            const lastCandleIndex = candleCount > 0 ? candleCount - 1 : 0;

            // 1. If point extends into future right offset beyond the last candle
            if (futureOffset && futureOffset > 0 && candleCount > 0) {
                const targetLogical = lastCandleIndex + futureOffset;
                const x = timeScale.logicalToCoordinate(targetLogical);
                if (x !== null && x !== undefined) return x;
            }

            // 2. Normal date matching for points within chart history
            const normTime = normalizeTime(time);
            if (normTime !== null && normTime !== undefined) {
                let x = timeScale.timeToCoordinate(normTime);
                if (x !== null && x !== undefined) return x;

                if (cachedChartData && cachedChartData.candles && cachedChartData.candles.length > 0) {
                    const closest = findClosestCandleByTime(cachedChartData.candles, normTime);
                    if (closest && closest.time) {
                        const normClosest = normalizeTime(closest.time);
                        x = timeScale.timeToCoordinate(normClosest);
                        if (x !== null && x !== undefined) return x;
                    }
                }
            }

            // 3. Fallback to logical coordinate if available
            if (logical !== null && logical !== undefined) {
                const x = timeScale.logicalToCoordinate(logical);
                if (x !== null && x !== undefined) return x;
            }
            return null;
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

            const clickedObj = findShapeOrLineAtPoint(pt.x, pt.y);
            if (drawingCanvas) {
                if (clickedObj) {
                    drawingCanvas.style.pointerEvents = 'auto';
                    drawingCanvas.style.cursor = 'pointer';
                } else {
                    drawingCanvas.style.pointerEvents = 'none';
                    drawingCanvas.style.cursor = 'default';
                }
            }
        }

        function handleChartPaneMouseDown(e) {
            if (e.target && e.target.closest && e.target.closest('#canvasObjectPopup')) {
                return;
            }
            if (currentDrawingTool) return;
            const pt = getChartPointFromEvent(e);
            if (!pt) return;

            const clickedObj = findShapeOrLineAtPoint(pt.x, pt.y);
            if (clickedObj) {
                showCanvasObjectMenu(clickedObj, pt.x, pt.y);
                e.preventDefault();
                e.stopPropagation();
            } else {
                hideCanvasObjectMenu();
            }
        }

        function handleChartPaneClick(e) {
            if (!currentDrawingTool) return;
            handleCanvasClick(e);
        }

        function handleChartPaneTouchEnd(e) {
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
                    addHorizontalLineAtPrice('support', parseFloat(pt.price.toFixed(2)), activeToolColor || '#10b981', 'Support');
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
                        color: activeToolColor || '#f59e0b'
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
                } else if (currentDrawingTool === 'trendline' || currentDrawingTool === 'rectangle' || currentDrawingTool === 'pricerange') {
                    if (pt.logical === null || pt.logical === undefined) return;
                    if (drawingPoints.length === 0) {
                        drawingPoints.push(pt);
                        const banner = document.getElementById('drawingToolBanner');
                        if (banner) {
                            const actionName = currentDrawingTool === 'trendline' ? 'Trendline' : currentDrawingTool === 'rectangle' ? 'Rectangle Zone' : 'Price Range % Calculator';
                            const span = banner.querySelector('span');
                            if (span) span.innerText = `Click 2nd point to complete ${actionName}`;
                        }
                    } else {
                        const pt1 = drawingPoints[0];
                        const pt2 = pt;

                        const shape = {
                            id: 'sh_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
                            type: currentDrawingTool,
                            time1: pt1.time,
                            logical1: pt1.logical,
                            futureOffset1: pt1.futureOffset || 0,
                            price1: pt1.price,
                            time2: pt2.time,
                            logical2: pt2.logical,
                            futureOffset2: pt2.futureOffset || 0,
                            price2: pt2.price,
                            color: activeToolColor || (currentDrawingTool === 'trendline' ? '#3b82f6' : currentDrawingTool === 'rectangle' ? '#a855f7' : '#10b981'),
                            fillColor: currentDrawingTool === 'rectangle' ? hexToRgba(activeToolColor || '#a855f7', 0.18) : null
                        };

                        saveChartShapeForSymbol(currentChartSymbol, shape);
                        cancelDrawingTool();
                    }
                    return;
                }
            }

            // Normal Mode: Check if user clicked on an existing shape/line to inspect or delete
            const clickedObj = findShapeOrLineAtPoint(pt.x, pt.y);
            if (clickedObj) {
                showCanvasObjectMenu(clickedObj, pt.x, pt.y);
            } else {
                hideCanvasObjectMenu();
            }
        }

        function findShapeOrLineAtPoint(x, y) {
            if (!mainChart || !mainSeries) return null;
            const timeScale = mainChart.timeScale();

            // Check price lines first
            const lines = getSavedPriceLines(currentChartSymbol);
            for (let l of lines) {
                const lineY = mainSeries.priceToCoordinate(l.price);
                if (lineY !== null && Math.abs(y - lineY) < 8) {
                    return { kind: 'line', id: l.id, name: `${l.label || 'Line'}: ₹${l.price}`, color: l.color };
                }
            }

            // Check shapes
            const shapes = getSavedChartShapes(currentChartSymbol);
            for (let s of shapes) {
                if (s.type === 'vertical') {
                    const shapeX = getShapeX(timeScale, s.time, s.logical, s.futureOffset);
                    if (shapeX !== null && Math.abs(x - shapeX) < 8) {
                        return { kind: 'shape', id: s.id, name: 'Time Line', color: s.color };
                    }
                } else if (s.type === 'note') {
                    const shapeX = getShapeX(timeScale, s.time, s.logical, s.futureOffset);
                    const shapeY = mainSeries.priceToCoordinate(s.price);
                    if (shapeX !== null && shapeY !== null && Math.abs(x - shapeX) < 30 && Math.abs(y - shapeY) < 20) {
                        return { kind: 'shape', id: s.id, name: `Note: ${s.text}`, color: s.color };
                    }
                } else if (s.type === 'trendline') {
                    const x1 = getShapeX(timeScale, s.time1, s.logical1, s.futureOffset1);
                    const y1 = mainSeries.priceToCoordinate(s.price1);
                    const x2 = getShapeX(timeScale, s.time2, s.logical2, s.futureOffset2);
                    const y2 = mainSeries.priceToCoordinate(s.price2);
                    if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
                        const dist = distanceToSegment(x, y, x1, y1, x2, y2);
                        if (dist < 9) {
                            return { kind: 'shape', id: s.id, name: 'Trendline', color: s.color };
                        }
                    }
                } else if (s.type === 'rectangle' || s.type === 'pricerange') {
                    const x1 = getShapeX(timeScale, s.time1, s.logical1, s.futureOffset1);
                    const y1 = mainSeries.priceToCoordinate(s.price1);
                    const x2 = getShapeX(timeScale, s.time2 || s.time1, s.logical2 !== undefined ? s.logical2 : s.logical1, s.futureOffset2 || 0);
                    const y2 = mainSeries.priceToCoordinate(s.price2);
                    if (x1 !== null && y1 !== null && y2 !== null) {
                        const startX = x1, endX = (x2 !== null) ? x2 : x1;
                        const minX = Math.min(startX, endX) - 20, maxX = Math.max(startX, endX) + 20;
                        const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
                        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
                            if (s.type === 'pricerange') {
                                const diff = s.price2 - s.price1;
                                const pct = (s.price1 !== 0) ? (diff / Math.abs(s.price1)) * 100 : 0;
                                const label = `Price Range: ${diff >= 0 ? '+' : ''}₹${diff.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
                                return { kind: 'shape', id: s.id, name: label, color: s.color };
                            }
                            return { kind: 'shape', id: s.id, name: 'Rectangle Zone', color: s.color };
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

        function showCanvasObjectMenu(obj, x, y) {
            let popup = document.getElementById('canvasObjectPopup');
            const mainContainer = document.getElementById('mainChartPane');
            if (!popup && mainContainer) {
                popup = document.createElement('div');
                popup.id = 'canvasObjectPopup';
                popup.style.cssText = `
                    position: absolute;
                    background: #1e222d;
                    border: 1px solid #363a45;
                    border-radius: 8px;
                    padding: 6px 10px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    z-index: 500;
                    box-shadow: 0 6px 18px rgba(0,0,0,0.6);
                    font-size: 11px;
                    color: #d1d4dc;
                    pointer-events: auto;
                `;
                popup.addEventListener('mousedown', function(evt) { evt.stopPropagation(); });
                popup.addEventListener('click', function(evt) { evt.stopPropagation(); });
                mainContainer.appendChild(popup);
            }

            if (popup && mainContainer) {
                popup.style.left = Math.min(x, mainContainer.clientWidth - 180) + 'px';
                popup.style.top = Math.max(10, y - 40) + 'px';

                const deleteFn = obj.kind === 'line' ? `deletePriceLineById('${obj.id}'); hideCanvasObjectMenu();` : `deleteShapeById('${obj.id}'); hideCanvasObjectMenu();`;
                const colorFn = obj.kind === 'line' ? `updatePriceLineColorById('${obj.id}', this.value)` : `updateShapeColorById('${obj.id}', this.value)`;
                const toggleVisFn = obj.kind === 'line' ? `togglePriceLineVisibility('${obj.id}'); hideCanvasObjectMenu();` : `toggleShapeVisibility('${obj.id}'); hideCanvasObjectMenu();`;
                const visIcon = obj.hidden ? '🙈' : '👁️';

                popup.innerHTML = `
                    <span style="font-weight: 700; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(obj.name)}</span>
                    <input type="color" value="${obj.color || '#10b981'}" onchange="${colorFn}" style="width: 18px; height: 18px; border: none; padding: 0; background: transparent; cursor: pointer;" title="Change color">
                    <button onclick="${toggleVisFn}" style="background: rgba(255, 255, 255, 0.08); border: 1px solid #363a45; color: #d1d4dc; padding: 2px 6px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 700;" title="Toggle visibility">${visIcon}</button>
                    <button onclick="${deleteFn}" style="background: rgba(239, 83, 80, 0.2); border: 1px solid #ef5350; color: #ef5350; padding: 2px 6px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 700;" title="Delete Item">🗑️ Delete</button>
                `;
                popup.style.display = 'flex';
                if (drawingCanvas) {
                    drawingCanvas.style.pointerEvents = 'auto';
                }
            }
        }

        function hideCanvasObjectMenu() {
            const popup = document.getElementById('canvasObjectPopup');
            if (popup) popup.style.display = 'none';
        }

        function redrawCanvasOverlay() {
            if (!drawingCanvas) return;
            const ctx = drawingCanvas.getContext('2d');
            ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

            if (!mainChart || !mainSeries || !currentChartSymbol) return;

            const shapes = getSavedChartShapes(currentChartSymbol);

            // Draw all saved shapes if not globally hidden
            if (!isAllDrawingsHidden) {
                shapes.forEach(s => {
                    if (!s.hidden) {
                        drawSingleShape(ctx, s);
                    }
                });
            }

            // Draw active live preview shape if in drawing mode
            if (currentDrawingTool && tempMousePos) {
                if ((currentDrawingTool === 'trendline' || currentDrawingTool === 'rectangle' || currentDrawingTool === 'pricerange') && drawingPoints.length === 1) {
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
                        color: activeToolColor || (currentDrawingTool === 'trendline' ? '#60a5fa' : currentDrawingTool === 'rectangle' ? '#c084fc' : '#10b981'),
                        fillColor: currentDrawingTool === 'rectangle' ? 'rgba(192, 132, 252, 0.25)' : null,
                        isPreview: true
                    };
                    drawSingleShape(ctx, previewShape);
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
        }

        function drawSingleShape(ctx, s) {
            const timeScale = mainChart.timeScale();
            const isDark = (document.documentElement.getAttribute('data-theme') || 'light') === 'dark';

            if (s.type === 'pricerange') {
                const x1 = getShapeX(timeScale, s.time1, s.logical1, s.futureOffset1);
                const y1 = mainSeries.priceToCoordinate(s.price1);
                const x2 = getShapeX(timeScale, s.time2 || s.time1, s.logical2 !== undefined ? s.logical2 : s.logical1, s.futureOffset2 || 0);
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
                    ctx.lineWidth = 1.5;
                    if (s.isPreview) ctx.setLineDash([4, 4]);
                    ctx.strokeRect(leftX, topY, boxWidth, boxHeight);

                    // 2. Center Stem & Handles
                    const centerX = leftX + boxWidth / 2;
                    ctx.beginPath();
                    ctx.setLineDash([]);
                    ctx.moveTo(centerX, y1);
                    ctx.lineTo(centerX, y2);
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = color;
                    ctx.stroke();

                    // Handles (TradingView End Circles)
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;

                    ctx.beginPath(); ctx.arc(centerX, y1, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                    ctx.beginPath(); ctx.arc(centerX, y2, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();

                    // 3. Floating Price & Percentage Badge
                    const diff = s.price2 - s.price1;
                    const pct = (s.price1 !== 0) ? (diff / Math.abs(s.price1)) * 100 : 0;
                    const diffSign = diff >= 0 ? '+' : '';
                    const pctSign = pct >= 0 ? '+' : '';

                    const badgeText = `${diffSign}₹${diff.toFixed(2)} (${pctSign}${pct.toFixed(2)}%)`;

                    ctx.font = 'bold 11px monospace';
                    const textMetrics = ctx.measureText(badgeText);
                    const badgeW = textMetrics.width + 16;
                    const badgeH = 22;
                    const badgeX = Math.max(10, centerX - badgeW / 2);
                    const badgeY = Math.max(5, topY - badgeH - 6);

                    // Badge Background Pill
                    ctx.fillStyle = isDark ? '#1e222d' : '#ffffff';
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.5;

                    ctx.beginPath();
                    if (ctx.roundRect) {
                        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 5);
                    } else {
                        ctx.rect(badgeX, badgeY, badgeW, badgeH);
                    }
                    ctx.fill();
                    ctx.stroke();

                    // Badge Text
                    ctx.fillStyle = isDark ? '#ffffff' : '#0f172a';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2 + 1);

                    ctx.restore();
                }
            } else if (s.type === 'trendline') {
                const x1 = getShapeX(timeScale, s.time1, s.logical1, s.futureOffset1);
                const y1 = mainSeries.priceToCoordinate(s.price1);
                const x2 = getShapeX(timeScale, s.time2, s.logical2, s.futureOffset2);
                const y2 = mainSeries.priceToCoordinate(s.price2);

                if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.strokeStyle = s.color || '#3b82f6';
                    ctx.lineWidth = s.isPreview ? 2 : 2.5;
                    if (s.isPreview) ctx.setLineDash([4, 4]);
                    ctx.stroke();

                    // Draw end handle dots
                    ctx.fillStyle = s.color || '#3b82f6';
                    ctx.beginPath(); ctx.arc(x1, y1, 4, 0, 2 * Math.PI); ctx.fill();
                    ctx.beginPath(); ctx.arc(x2, y2, 4, 0, 2 * Math.PI); ctx.fill();
                    ctx.restore();
                }
            } else if (s.type === 'rectangle') {
                const x1 = getShapeX(timeScale, s.time1, s.logical1, s.futureOffset1);
                const y1 = mainSeries.priceToCoordinate(s.price1);
                const x2 = getShapeX(timeScale, s.time2, s.logical2, s.futureOffset2);
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
                    ctx.lineWidth = 1.5;
                    if (s.isPreview) ctx.setLineDash([4, 4]);
                    ctx.strokeRect(rectX, rectY, w, h);
                    ctx.restore();
                }
            } else if (s.type === 'vertical') {
                const x = getShapeX(timeScale, s.time, s.logical, s.futureOffset);
                if (x !== null) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, drawingCanvas.height);
                    ctx.strokeStyle = s.color || '#f59e0b';
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([5, 5]);
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
                const x = getShapeX(timeScale, s.time, s.logical, s.futureOffset);
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
                resizeDrawingCanvas();
            });
        }

        function openInHouseChart(sym) {
            if (!sym) return;
            currentChartSymbol = sym;
            currentChartRange = '1y';
            try {
                const saved = localStorage.getItem('capital_desk_chart_interval');
                if (saved) {
                    currentChartInterval = saved;
                }
            } catch(e) {}
            if (!currentChartInterval) currentChartInterval = '1d';
            
            const modal = document.getElementById('chartModal');
            if (modal) {
                modal.style.display = 'block';
            }

            const info = (typeof stockPricesData !== 'undefined' && stockPricesData[sym]) ? stockPricesData[sym] : {};
            const symDisplay = document.getElementById('chartSymbolDisplay');
            const nameDisplay = document.getElementById('chartNameDisplay');
            if (symDisplay) symDisplay.innerText = sym;
            if (nameDisplay) nameDisplay.innerText = info.name || sym;

            const intervalLabel = document.getElementById('intervalBtnLabel');
            if (intervalLabel) intervalLabel.innerHTML = '<span class="btn-icon">⏱️</span><span class="btn-text"> ' + getIntervalDisplayLabel(currentChartInterval) + '</span>';

            document.querySelectorAll('#popover-interval .int-btn').forEach(btn => {
                btn.classList.toggle('active', btn.id === `int-${currentChartInterval}`);
            });

            const rangeLabel = document.getElementById('rangeBtnLabel');
            if (rangeLabel) rangeLabel.innerHTML = '<span class="btn-icon">📅</span><span class="btn-text"> 1Y</span>';

            renderFavoriteToolsShortcuts();
            initMobileFavBarDrag();

            loadChartData();
        }

        function openChart(sym) {
            openInHouseChart(sym);
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

        function changeInterval(intervalStr) {
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
                    const rngTxt = (range || currentChartRange || '1y').toUpperCase();
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
                    alert('Could not load chart data: ' + data.error);
                    return;
                }

                document.getElementById('chartSymbolDisplay').innerText = data.symbol;
                document.getElementById('chartNameDisplay').innerText = data.name;

                renderInHouseCharts(data);
            } catch (err) {
                console.error('Chart fetch error:', err);
                hideChartLoader();
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

        function renderInHouseCharts(data) {
            cachedChartData = data;
            buildIndicatorDataMap(data);

            const mainContainer = document.getElementById('mainChartPane');
            const rsiContainer = document.getElementById('rsiChartPane');
            const macdContainer = document.getElementById('macdChartPane');

            mainContainer.innerHTML = '';
            rsiContainer.innerHTML = '';
            macdContainer.innerHTML = '';
            activePriceLines = [];

            if (data.candles && data.candles.length > 0) {
                latestCandlePrice = data.candles[data.candles.length - 1].close;
            }

            const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
            const themeColors = getChartThemeColors(currentTheme);

            const baseChartConfig = {
                layout: {
                    background: { type: 'solid', color: themeColors.bgColor },
                    textColor: themeColors.textColor,
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    fontSize: 11
                },
                localization: {
                    locale: 'en-IN',
                    timeFormatter: timestamp => formatChartAxisDate(timestamp),
                    dateFormatter: timestamp => formatChartAxisDate(timestamp)
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
                    scaleMargins: {
                        top: 0.08,
                        bottom: 0.25
                    }
                },
                timeScale: {
                    borderColor: themeColors.borderColor,
                    timeVisible: true,
                    secondsVisible: false,
                    rightOffset: 12,
                    barSpacing: 9,
                    minBarSpacing: 0.3,
                    fixLeftEdge: false,
                    fixRightEdge: false,
                    lockVisibleTimeRangeOnResize: true,
                    rightBarStaysOnScroll: true,
                    tickMarkFormatter: (time, tickMarkType, locale) => {
                        if (typeof time === 'number') {
                            const date = new Date(time * 1000);
                            if (['5m', '15m', '1h', '60m'].includes(currentChartInterval)) {
                                return date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
                            }
                        }
                        return formatChartAxisDate(time);
                    }
                }
            });

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

            if (chartType === 'candlestick') {
                mainSeries = mainChart.addCandlestickSeries({
                    upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350'
                });
                mainSeries.setData(data.candles);
            } else if (chartType === 'line') {
                mainSeries = mainChart.addLineSeries({ color: '#2563eb', lineWidth: 2 });
                mainSeries.setData(data.candles.map(c => ({ time: c.time, value: c.close })));
            } else if (chartType === 'area') {
                mainSeries = mainChart.addAreaSeries({
                    topColor: 'rgba(37, 99, 235, 0.4)', bottomColor: 'rgba(37, 99, 235, 0.0)', lineColor: '#2563eb', lineWidth: 2
                });
                mainSeries.setData(data.candles.map(c => ({ time: c.time, value: c.close })));
            }

            attachDrawingSyncPrimitive(mainSeries);

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
            cdRiderSeries = mainChart.addLineSeries({ color: '#10b981', lineWidth: 2, title: 'CDRider', visible: false });
            if (data.cdrider) cdRiderSeries.setData(data.cdrider);

            const allMarkers = [];
            if (data.cdrider_buy) allMarkers.push(...data.cdrider_buy);
            if (data.cdrider_sell) allMarkers.push(...data.cdrider_sell);
            cachedCdRiderMarkers = allMarkers.sort((a, b) => (typeof a.time === 'number' && typeof b.time === 'number' ? a.time - b.time : 0));

            sma50Series = mainChart.addLineSeries({ color: '#ff6d00', lineWidth: 2, title: '50 DMA' });
            if (data.sma50) sma50Series.setData(data.sma50);

            sma200Series = mainChart.addLineSeries({ color: '#e11d48', lineWidth: 2, title: '200 DMA' });
            if (data.sma200) sma200Series.setData(data.sma200);

            ema9Series = mainChart.addLineSeries({ color: '#06b6d4', lineWidth: 2, title: 'EMA 9' });
            if (data.ema9) ema9Series.setData(data.ema9);

            gann2DaySeries = mainChart.addLineSeries({ color: themeColors.gannColor, lineWidth: 2, title: 'Gann 2-Day Low' });
            if (data.gann_2day) gann2DaySeries.setData(data.gann_2day);

            // RSI Sub-Pane Chart
            rsiChart = LightweightCharts.createChart(rsiContainer, {
                ...baseChartConfig,
                width: rsiContainer.clientWidth || 800,
                height: rsiContainer.clientHeight || 150,
                rightPriceScale: { borderColor: themeColors.borderColor, scaleMargins: { top: 0.1, bottom: 0.1 } },
                timeScale: { visible: false }
            });

            rsiSeries = rsiChart.addLineSeries({ color: '#e040fb', lineWidth: 2, title: 'RSI 14' });
            if (data.rsi) rsiSeries.setData(data.rsi);

            const rsi70 = rsiChart.addLineSeries({ color: '#ef5350', lineWidth: 1, lineStyle: 2 });
            const rsi30 = rsiChart.addLineSeries({ color: '#26a69a', lineWidth: 1, lineStyle: 2 });
            if (data.rsi && data.rsi.length > 0) {
                rsi70.setData(data.rsi.map(item => ({ time: item.time, value: 70 })));
                rsi30.setData(data.rsi.map(item => ({ time: item.time, value: 30 })));
            }

            // MACD Sub-Pane Chart
            macdChart = LightweightCharts.createChart(macdContainer, {
                ...baseChartConfig,
                width: macdContainer.clientWidth || 800,
                height: macdContainer.clientHeight || 150,
                rightPriceScale: { borderColor: themeColors.borderColor, scaleMargins: { top: 0.1, bottom: 0.1 } },
                timeScale: { visible: false }
            });

            macdHistSeries = macdChart.addHistogramSeries({ title: 'Histogram' });
            if (data.macd_hist) macdHistSeries.setData(data.macd_hist);

            macdLineSeries = macdChart.addLineSeries({ color: '#3b82f6', lineWidth: 2, title: 'MACD' });
            if (data.macd_line) macdLineSeries.setData(data.macd_line);

            macdSignalSeries = macdChart.addLineSeries({ color: '#f97316', lineWidth: 2, title: 'Signal' });
            if (data.macd_signal) macdSignalSeries.setData(data.macd_signal);

            // Synchronize Time Scale across panes smoothly without infinite loops
            mainChart.timeScale().subscribeVisibleTimeRangeChange(timeRange => {
                if (isSyncingTimeScale || !timeRange) return;
                isSyncingTimeScale = true;
                try {
                    if (rsiChart) rsiChart.timeScale().setVisibleTimeRange(timeRange);
                    if (macdChart) macdChart.timeScale().setVisibleTimeRange(timeRange);
                } catch(e){}
                isSyncingTimeScale = false;
            });

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
                });
                chartResizeObserver.observe(bodyContainer);
            } else {
                window.onresize = function() {
                    resizeChartPanes();
                };
            }

            // Restore active drawing lines saved for this stock
            restoreSavedPriceLines(currentChartSymbol);

            setupCanvasOverlay();
            if (mainChart) {
                mainChart.timeScale().subscribeVisibleLogicalRangeChange(() => redrawCanvasOverlay());
                mainChart.subscribeCrosshairMove(() => redrawCanvasOverlay());
            }

            toggleIndicators();
            resizeChartPanes();
            redrawCanvasOverlay();
            startCandleCountdownTimer();
        }

        let currentRightAxisPrice = null;
        let currentPlusActionPrice = null;
        let candleTimerIntervalId = null;
        let isRightAxisHovered = false;

        let isYScaleAuto = true;

        function toggleYScaleMode() {
            if (!mainChart) return;
            isYScaleAuto = !isYScaleAuto;
            mainChart.priceScale('right').applyOptions({ autoScale: isYScaleAuto });
            const btn = document.getElementById('btnToggleYScale');
            if (btn) {
                btn.innerText = isYScaleAuto ? '🔓 Free Y-Scale' : '🔒 Auto Scale';
                btn.style.color = isYScaleAuto ? '#d1d4dc' : '#10b981';
            }
        }
        window.toggleYScaleMode = toggleYScaleMode;

        function setupRightPriceAxisHoverZone() {
            const mainContainer = document.getElementById('mainChartPane');
            if (!mainContainer) return;

            mainContainer.onmousemove = (e) => {
                if (!mainSeries || !mainChart) return;
                const rect = mainContainer.getBoundingClientRect();
                const y = e.clientY - rect.top;

                if (y < 0 || y > mainContainer.clientHeight) {
                    handleRightAxisMouseLeave();
                    return;
                }

                const price = mainSeries.coordinateToPrice(y);
                if (price === null || price === undefined || isNaN(price)) return;

                currentRightAxisPrice = parseFloat(price.toFixed(2));
                renderRightAxisPlusBadge(y, currentRightAxisPrice);
            };

            mainContainer.onmousedown = (e) => {
                const rect = mainContainer.getBoundingClientRect();
                if (e.clientX >= rect.right - 70) {
                    if (mainChart && isYScaleAuto) {
                        mainChart.priceScale('right').applyOptions({ autoScale: false });
                        isYScaleAuto = false;
                        const btn = document.getElementById('btnToggleYScale');
                        if (btn) { btn.innerText = '🔒 Auto Scale'; btn.style.color = '#10b981'; }
                    }
                }
            };

            mainContainer.onmouseleave = () => {
                handleRightAxisMouseLeave();
            };

            mainContainer.ondblclick = (e) => {
                const rect = mainContainer.getBoundingClientRect();
                if (e.clientX >= rect.right - 70) {
                    if (mainChart) {
                        isYScaleAuto = true;
                        mainChart.priceScale('right').applyOptions({ autoScale: true });
                        const btn = document.getElementById('btnToggleYScale');
                        if (btn) { btn.innerText = '🔓 Free Y-Scale'; btn.style.color = '#d1d4dc'; }
                    }
                }
            };
        }

        function renderRightAxisPlusBadge(y, price) {
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
                    pointer-events: auto;
                `;
                badge.innerHTML = `
                    <button type="button" id="axisPlusBtn" onclick="toggleRightAxisPlusMenu(event)" style="background: #10b981; border: 1px solid #059669; color: #ffffff; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: bold; margin-right: 4px; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.5); transition: transform 0.12s, background 0.12s;" title="Click + for Target, Support Line or Price Alert">+</button>
                    <div id="axisPriceTextLabel" style="background: #1e222d; border: 1px solid #10b981; color: #f8fafc; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; font-family: monospace; box-shadow: 0 2px 8px rgba(0,0,0,0.5); pointer-events: none;"></div>
                `;
                mainContainer.appendChild(badge);

                badge.onmouseenter = () => { isRightAxisHovered = true; };
                badge.onmouseleave = () => { handleRightAxisMouseLeave(); };
            }

            const btn = badge.querySelector('#axisPlusBtn');
            if (btn) {
                btn.onclick = (e) => { toggleRightAxisPlusMenu(e); };
                btn.onmouseenter = () => { isRightAxisHovered = true; btn.style.transform = 'scale(1.25)'; btn.style.background = '#059669'; };
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

        function handleRightAxisMouseLeave() {
            isRightAxisHovered = false;
            setTimeout(() => {
                const menu = document.getElementById('plusActionMenu');
                const badge = document.getElementById('rightPriceAxisPlusBadge');
                if (!isRightAxisHovered && (!menu || menu.style.display !== 'block')) {
                    if (badge) badge.style.display = 'none';
                }
            }, 150);
        }

        function toggleRightAxisPlusMenu(e) {
            if (e) e.stopPropagation();
            if (currentRightAxisPrice === null || isNaN(currentRightAxisPrice)) return;

            currentPlusActionPrice = currentRightAxisPrice;
            const mainContainer = document.getElementById('mainChartPane');
            if (!mainContainer) return;

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
                    min-width: 230px;
                `;
                menu.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 6px 6px 6px; border-bottom: 1px solid #2a2e39; margin-bottom: 4px;">
                        <span style="font-size: 10px; font-weight: 700; color: #787b86; text-transform: uppercase; letter-spacing: 0.5px;">Quick Price Action</span>
                        <button type="button" id="btnClosePlusMenu" onclick="hidePlusActionMenu()" style="background: transparent; border: none; color: #94a3b8; font-size: 14px; font-weight: bold; cursor: pointer; padding: 0 4px; line-height: 1; border-radius: 4px; transition: color 0.15s;" onmouseover="this.style.color='#ef5350'" onmouseout="this.style.color='#94a3b8'" title="Close Menu">✕</button>
                    </div>
                    <button type="button" id="btnPlusActionTarget" onclick="executePlusAction('target')" style="background: transparent; border: none; color: #f59e0b; padding: 8px 10px; font-size: 12px; font-weight: 600; text-align: left; width: 100%; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px; transition: background 0.15s;" onmouseover="this.style.background='#2a2e39'" onmouseout="this.style.background='transparent'">
                        🎯 Add Target Line (₹<span id="plusActionTargetPrice">-</span>)
                    </button>
                    <button type="button" id="btnPlusActionSupport" onclick="executePlusAction('support')" style="background: transparent; border: none; color: #10b981; padding: 8px 10px; font-size: 12px; font-weight: 600; text-align: left; width: 100%; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px; transition: background 0.15s;" onmouseover="this.style.background='#2a2e39'" onmouseout="this.style.background='transparent'">
                        🟢 Add Support Line (₹<span id="plusActionSupportPrice">-</span>)
                    </button>
                    <button type="button" id="btnPlusActionAlert" onclick="executePlusAction('alert')" style="background: transparent; border: none; color: #3b82f6; padding: 8px 10px; font-size: 12px; font-weight: 600; text-align: left; width: 100%; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px; transition: background 0.15s;" onmouseover="this.style.background='#2a2e39'" onmouseout="this.style.background='transparent'">
                        🔔 Create Price Alert (₹<span id="plusActionAlertPrice">-</span>)
                    </button>
                `;
                mainContainer.appendChild(menu);

                const btnClose = menu.querySelector('#btnClosePlusMenu');
                if (btnClose) btnClose.onclick = (ev) => { ev.stopPropagation(); hidePlusActionMenu(); };
                const btnTgt = menu.querySelector('#btnPlusActionTarget');
                if (btnTgt) btnTgt.onclick = () => executePlusAction('target');
                const btnSup = menu.querySelector('#btnPlusActionSupport');
                if (btnSup) btnSup.onclick = () => executePlusAction('support');
                const btnAlt = menu.querySelector('#btnPlusActionAlert');
                if (btnAlt) btnAlt.onclick = () => executePlusAction('alert');

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
            document.getElementById('plusActionSupportPrice').innerText = currentPlusActionPrice.toFixed(2);
            document.getElementById('plusActionAlertPrice').innerText = currentPlusActionPrice.toFixed(2);

            const badge = document.getElementById('rightPriceAxisPlusBadge');
            const topPos = badge ? badge.offsetTop : 50;
            menu.style.top = Math.max(10, Math.min(topPos - 10, mainContainer.clientHeight - 90)) + 'px';
            menu.style.right = '70px';
            menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
        }

        function hidePlusActionMenu() {
            const menu = document.getElementById('plusActionMenu');
            if (menu) menu.style.display = 'none';
        }

        function executePlusAction(actionType) {
            if (!currentPlusActionPrice) return;
            const price = currentPlusActionPrice;
            hidePlusActionMenu();

            if (actionType === 'target') {
                addHorizontalLineAtPrice('target', price, '#f59e0b', 'Target');
                showSupportAddedToast(price, '🎯 Target Line');
            } else if (actionType === 'support') {
                addHorizontalLineAtPrice('support', price, activeToolColor || '#10b981', 'Support');
                showSupportAddedToast(price, '🟢 Support Line');
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
            document.getElementById('legDate').innerText = timeStr;
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

            const elSma50 = document.getElementById('legSma50');
            if (elSma50) elSma50.innerText = (rec && rec.sma50 !== undefined) ? '₹' + rec.sma50.toFixed(2) : '-';
            
            const elSma200 = document.getElementById('legSma200');
            if (elSma200) elSma200.innerText = (rec && rec.sma200 !== undefined) ? '₹' + rec.sma200.toFixed(2) : '-';

            const elEma9 = document.getElementById('legEma9');
            if (elEma9) elEma9.innerText = (rec && rec.ema9 !== undefined) ? '₹' + rec.ema9.toFixed(2) : '-';

            const elGann = document.getElementById('legGann2Day');
            if (elGann) elGann.innerText = (rec && rec.gann_2day !== undefined) ? '₹' + rec.gann_2day.toFixed(2) : '-';

            document.getElementById('legRsi').innerText = (rec && rec.rsi !== undefined) ? rec.rsi.toFixed(2) : '-';
            document.getElementById('legMacd').innerText = (rec && rec.macd !== undefined) ? rec.macd.toFixed(2) : '-';
        }

        function toggleIndicators() {
            if (!volumeSeries) return;

            const showCdRider = document.getElementById('chkCdRider') ? document.getElementById('chkCdRider').checked : false;
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
            if (mainSeries) {
                mainSeries.setMarkers(showCdRider ? cachedCdRiderMarkers : []);
            }
            volumeSeries.applyOptions({ visible: showVol });
            if (volumeMaSeries) volumeMaSeries.applyOptions({ visible: showVol && showVolMa });
            if (sma50Series) sma50Series.applyOptions({ visible: showSma50 });
            if (sma200Series) sma200Series.applyOptions({ visible: showSma200 });
            if (ema9Series) ema9Series.applyOptions({ visible: showEma9 });
            if (gann2DaySeries) gann2DaySeries.applyOptions({ visible: showGann2Day });

            if (document.getElementById('legCdRiderGroup')) {
                document.getElementById('legCdRiderGroup').style.display = showCdRider ? 'inline' : 'none';
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

            document.getElementById('legSmaGroup').style.display = (showCdRider || showSma50 || showSma200 || showEma9 || showGann2Day) ? 'inline-block' : 'none';

            resizeChartPanes();
        }

        function closeChartModal() {
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

            activePriceLines = [];
            drawingCanvas = null;
            currentDrawingTool = null;
            if (typeof hideCanvasObjectMenu === 'function') hideCanvasObjectMenu();
            if (typeof hideDrawingBanner === 'function') hideDrawingBanner();
        }

        window.openInHouseChart = openInHouseChart;
        window.closeChartModal = closeChartModal;
        window.redrawCanvasOverlay = redrawCanvasOverlay;
        window.applyChartTheme = applyChartTheme;
        window.toggleChartPopover = toggleChartPopover;
        window.closeAllChartPopovers = closeAllChartPopovers;
        window.setActiveToolColor = setActiveToolColor;
        window.setChartInterval = setChartInterval;
        window.setChartType = setChartType;
        window.setChartRange = setChartRange;
        window.toggleChartIndicator = toggleChartIndicator;
        window.setDrawingTool = setDrawingTool;
        window.deleteSelectedDrawing = deleteSelectedDrawing;
        window.clearAllChartDrawings = clearAllChartDrawings;
        window.resetChartZoom = resetChartZoom;
        window.renderFavoriteToolsShortcuts = renderFavoriteToolsShortcuts;
        window.toggleFavoriteTool = toggleFavoriteTool;
        window.executeToolById = executeToolById;


