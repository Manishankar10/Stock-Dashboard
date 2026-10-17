// =========================================================
// CAPITAL DESK - SECTOR ROTATION & RELATIVE ROTATION GRAPH (RRG)
// Location: modules/sector_rotation/sector_rotation.js
// Handles SPA rendering, interactive SVG RRG quadrant map,
// multi-frequency momentum filtering, leaderboard, matrix,
// economic cycle clock, and constituent stock drilldowns.
// =========================================================

(function () {
    const state = {
        frequency: '1M',          // '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'YTD'
        view: 'rrg',              // 'rrg' | 'leaderboard' | 'matrix' | 'cycle'
        quadrantFilter: 'all',    // 'all' | 'leading' | 'weakening' | 'lagging' | 'improving'
        searchQuery: '',
        showTails: true,
        sectors: [],
        filteredSectors: [],
        benchmark: {},
        benchmarkReturn: 0.0,
        economicCycle: {},
        kpis: {},
        quadrantCounts: {},
        lastUpdatedText: 'Just now',
        isLoading: false,
        selectedSectorId: null,
        matrixSortField: '1M',    // 'name' | 'quadrant' | '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'YTD' | 'breadth' | 'pe'
        matrixSortDir: 'desc'     // 'asc' | 'desc'
    };

    window.srState = state;

    // --- 1. Main Data Fetcher ---
    async function fetchSectorRotation(forceRefresh = false) {
        state.isLoading = true;
        showLoading(true);

        const refreshBtn = document.getElementById('sr-btn-refresh');
        if (refreshBtn) refreshBtn.querySelector('.sr-refresh-svg')?.classList.add('spinning');

        try {
            const params = new URLSearchParams({
                frequency: state.frequency,
                refresh: forceRefresh ? '1' : '0'
            });

            const res = await fetch(`/api/sector-rotation?${params.toString()}`);
            if (!res.ok) throw new Error(`HTTP error ${res.status}`);

            const data = await res.json();
            if (data.success) {
                state.sectors = data.sectors || [];
                state.benchmark = data.benchmark || {};
                state.benchmarkReturn = data.benchmark_return || 0.0;
                state.economicCycle = data.economic_cycle || {};
                state.kpis = data.kpis || {};
                state.quadrantCounts = data.quadrant_counts || {};
                state.lastUpdatedText = data.last_updated || 'Just now';

                renderAllViews();
            } else {
                console.error('[SectorRotation] Failed to load data:', data.error);
            }
        } catch (err) {
            console.error('[SectorRotation] Network error:', err);
        } finally {
            state.isLoading = false;
            showLoading(false);
            if (refreshBtn) refreshBtn.querySelector('.sr-refresh-svg')?.classList.remove('spinning');
        }
    }

    // --- 2. Master View Renderer ---
    function renderAllViews() {
        applyFilters();
        renderHeaderAndBenchmark();
        renderKPIs();
        renderQuadrantFilterBadges();

        if (state.view === 'rrg') {
            renderRRG();
        } else if (state.view === 'leaderboard') {
            renderLeaderboard();
        } else if (state.view === 'matrix') {
            renderMatrix();
        } else if (state.view === 'cycle') {
            renderEconomicCycle();
        }
    }

    function applyFilters() {
        let list = [...state.sectors];

        // 1. Quadrant filter
        if (state.quadrantFilter !== 'all') {
            list = list.filter(s => s.quadrant === state.quadrantFilter);
        }

        // 2. Search query filter
        if (state.searchQuery) {
            const q = state.searchQuery.toLowerCase().trim();
            list = list.filter(s =>
                s.name.toLowerCase().includes(q) ||
                s.category.toLowerCase().includes(q) ||
                (s.constituents && s.constituents.some(c => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)))
            );
        }

        state.filteredSectors = list;
    }

    function renderHeaderAndBenchmark() {
        const updatedTag = document.getElementById('sr-last-updated-tag');
        if (updatedTag) updatedTag.innerText = `🕒 Updated ${state.lastUpdatedText}`;

        const bmReturnEl = document.getElementById('sr-bm-return');
        if (bmReturnEl) {
            const ret = state.benchmarkReturn;
            const sign = ret >= 0 ? '+' : '';
            bmReturnEl.innerText = `${sign}${ret.toFixed(2)}% (${state.frequency})`;
            bmReturnEl.className = 'sr-bm-return ' + (ret >= 0 ? 'text-buy' : 'text-sell');
        }

        // Sync active frequency pill
        document.querySelectorAll('.sr-freq-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-freq') === state.frequency);
        });
    }

    function renderKPIs() {
        const kpis = state.kpis || {};

        // 1. Leading Sectors Count & Names
        const leadingCountEl = document.getElementById('sr-kpi-leading-count');
        const leadingListEl = document.getElementById('sr-kpi-leading-list');
        if (leadingCountEl) leadingCountEl.innerText = kpis.leading_count || 0;
        if (leadingListEl) {
            const names = kpis.leading_list || [];
            leadingListEl.innerText = names.length > 0 ? names.join(', ') : 'None in current timeframe';
        }

        // 2. Top Outperformer
        const top = kpis.top_performer || {};
        const topNameEl = document.getElementById('sr-kpi-top-name');
        const topStatsEl = document.getElementById('sr-kpi-top-stats');
        if (topNameEl) topNameEl.innerText = top.name || '-';
        if (topStatsEl) {
            const retSign = (top.return || 0) >= 0 ? '+' : '';
            const alphaSign = (top.alpha || 0) >= 0 ? '+' : '';
            topStatsEl.innerText = `${retSign}${(top.return || 0).toFixed(2)}% (Alpha: ${alphaSign}${(top.alpha || 0).toFixed(2)}%)`;
        }

        // 3. Weakest Sector
        const worst = kpis.worst_performer || {};
        const worstNameEl = document.getElementById('sr-kpi-worst-name');
        const worstStatsEl = document.getElementById('sr-kpi-worst-stats');
        if (worstNameEl) worstNameEl.innerText = worst.name || '-';
        if (worstStatsEl) {
            const retSign = (worst.return || 0) >= 0 ? '+' : '';
            const alphaSign = (worst.alpha || 0) >= 0 ? '+' : '';
            worstStatsEl.innerText = `${retSign}${(worst.return || 0).toFixed(2)}% (Alpha: ${alphaSign}${(worst.alpha || 0).toFixed(2)}%)`;
        }

        // 4. Regime
        const regime = state.economicCycle || {};
        const regimePhaseEl = document.getElementById('sr-kpi-regime-phase');
        const regimeDescEl = document.getElementById('sr-kpi-regime-desc');
        if (regimePhaseEl) {
            regimePhaseEl.innerText = regime.phase || 'Broad Expansion';
            if (regime.color) regimePhaseEl.style.color = regime.color;
        }
        if (regimeDescEl) {
            regimeDescEl.innerText = regime.tag || 'Balanced Market Regime';
        }
    }

    function renderQuadrantFilterBadges() {
        const counts = state.quadrantCounts || {};
        const total = state.sectors.length;

        const allEl = document.getElementById('sr-count-all');
        const leadEl = document.getElementById('sr-count-leading');
        const weakEl = document.getElementById('sr-count-weakening');
        const lagEl = document.getElementById('sr-count-lagging');
        const impEl = document.getElementById('sr-count-improving');

        if (allEl) allEl.innerText = total;
        if (leadEl) leadEl.innerText = counts.leading || 0;
        if (weakEl) weakEl.innerText = counts.weakening || 0;
        if (lagEl) lagEl.innerText = counts.lagging || 0;
        if (impEl) impEl.innerText = counts.improving || 0;

        document.querySelectorAll('.sr-quad-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-quad') === state.quadrantFilter);
        });
    }

    // --- 3. VIEW 1: Interactive SVG Relative Rotation Graph (RRG) ---
    function renderRRG() {
        const svg = document.getElementById('sr-rrg-svg');
        if (!svg) return;

        const W = 1000;
        const H = 640;
        const cx = W / 2;
        const cy = H / 2;

        // Domain bounds for RS-Ratio (X) and RS-Momentum (Y)
        // Center is (100, 100).
        let minX = 94, maxX = 106, minY = 94, maxY = 106;
        state.sectors.forEach(s => {
            if (s.rs_ratio < minX) minX = s.rs_ratio - 1;
            if (s.rs_ratio > maxX) maxX = s.rs_ratio + 1;
            if (s.rs_momentum < minY) minY = s.rs_momentum - 1;
            if (s.rs_momentum > maxY) maxY = s.rs_momentum + 1;
        });

        // Ensure symmetric spread around 100
        const spanX = Math.max(Math.abs(100 - minX), Math.abs(maxX - 100), 4.5);
        const spanY = Math.max(Math.abs(100 - minY), Math.abs(maxY - 100), 4.5);

        const xMin = 100 - spanX;
        const xMax = 100 + spanX;
        const yMin = 100 - spanY;
        const yMax = 100 + spanY;

        function mapX(val) {
            return 60 + ((val - xMin) / (xMax - xMin)) * (W - 120);
        }

        function mapY(val) {
            // In SVG, higher Y is downwards. Higher RS-Momentum should be UPWARDS.
            return (H - 60) - ((val - yMin) / (yMax - yMin)) * (H - 120);
        }

        const centerSvgX = mapX(100);
        const centerSvgY = mapY(100);

        let svgHtml = '';

        // 1. Quadrant Background Tints
        // Top-Left: Improving (X < 100, Y >= 100)
        svgHtml += `<rect x="0" y="0" width="${centerSvgX}" height="${centerSvgY}" fill="rgba(6, 182, 212, 0.05)" />`;
        // Top-Right: Leading (X >= 100, Y >= 100)
        svgHtml += `<rect x="${centerSvgX}" y="0" width="${W - centerSvgX}" height="${centerSvgY}" fill="rgba(16, 185, 129, 0.06)" />`;
        // Bottom-Left: Lagging (X < 100, Y < 100)
        svgHtml += `<rect x="0" y="${centerSvgY}" width="${centerSvgX}" height="${H - centerSvgY}" fill="rgba(239, 68, 68, 0.05)" />`;
        // Bottom-Right: Weakening (X >= 100, Y < 100)
        svgHtml += `<rect x="${centerSvgX}" y="${centerSvgY}" width="${W - centerSvgX}" height="${H - centerSvgY}" fill="rgba(245, 158, 11, 0.05)" />`;

        // 2. Grid lines
        for (let xVal = Math.ceil(xMin); xVal <= Math.floor(xMax); xVal += 2) {
            if (xVal === 100) continue;
            const gx = mapX(xVal);
            svgHtml += `<line x1="${gx}" y1="30" x2="${gx}" y2="${H - 30}" stroke="currentColor" stroke-opacity="0.08" stroke-dasharray="3,3" />`;
            svgHtml += `<text x="${gx}" y="${H - 14}" font-size="10" fill="currentColor" opacity="0.4" text-anchor="middle" font-family="'Plus Jakarta Sans', sans-serif">${xVal}</text>`;
        }
        for (let yVal = Math.ceil(yMin); yVal <= Math.floor(yMax); yVal += 2) {
            if (yVal === 100) continue;
            const gy = mapY(yVal);
            svgHtml += `<line x1="40" y1="${gy}" x2="${W - 40}" y2="${gy}" stroke="currentColor" stroke-opacity="0.08" stroke-dasharray="3,3" />`;
            svgHtml += `<text x="26" y="${gy + 4}" font-size="10" fill="currentColor" opacity="0.4" text-anchor="end" font-family="'Plus Jakarta Sans', sans-serif">${yVal}</text>`;
        }

        // 3. Central Axis Crosshairs (at 100, 100)
        svgHtml += `<line x1="${centerSvgX}" y1="15" x2="${centerSvgX}" y2="${H - 15}" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.8" />`;
        svgHtml += `<line x1="15" y1="${centerSvgY}" x2="${W - 15}" y2="${centerSvgY}" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.8" />`;

        // Benchmark Center Badge
        svgHtml += `<circle cx="${centerSvgX}" cy="${centerSvgY}" r="6" fill="#10b981" opacity="0.9" />`;
        svgHtml += `<text x="${centerSvgX + 10}" y="${centerSvgY + 4}" font-size="10" font-weight="800" fill="#10b981" font-family="'Plus Jakarta Sans', sans-serif">BENCHMARK (NIFTY 50)</text>`;

        // 4. Quadrant Watermark Titles
        svgHtml += `<text x="70" y="55" font-size="16" font-weight="900" fill="#06b6d4" opacity="0.4" letter-spacing="1">IMPROVING</text>`;
        svgHtml += `<text x="${W - 70}" y="55" font-size="16" font-weight="900" fill="#10b981" opacity="0.4" letter-spacing="1" text-anchor="end">LEADING</text>`;
        svgHtml += `<text x="70" y="${H - 45}" font-size="16" font-weight="900" fill="#ef4444" opacity="0.4" letter-spacing="1">LAGGING</text>`;
        svgHtml += `<text x="${W - 70}" y="${H - 45}" font-size="16" font-weight="900" fill="#f59e0b" opacity="0.4" letter-spacing="1" text-anchor="end">WEAKENING</text>`;

        // Axis Titles
        svgHtml += `<text x="${W - 40}" y="${centerSvgY - 8}" font-size="11" font-weight="800" fill="currentColor" opacity="0.5" text-anchor="end">RELATIVE STRENGTH (RS-RATIO) ➔</text>`;
        svgHtml += `<text x="${centerSvgX + 8}" y="35" font-size="11" font-weight="800" fill="currentColor" opacity="0.5">▲ MOMENTUM (RS-MOMENTUM)</text>`;

        // 5. Trajectory Tails (Tails behind sector bubbles)
        if (state.showTails) {
            state.filteredSectors.forEach(sec => {
                const tail = sec.tail || [];
                if (tail.length >= 2) {
                    let pathD = '';
                    tail.forEach((pt, idx) => {
                        const px = mapX(pt.x);
                        const py = mapY(pt.y);
                        if (idx === 0) pathD += `M ${px} ${py} `;
                        else pathD += `L ${px} ${py} `;
                    });

                    svgHtml += `<path d="${pathD}" fill="none" stroke="${sec.quadrant_color}" stroke-width="1.8" stroke-opacity="0.45" stroke-dasharray="2,2" />`;
                    tail.slice(0, -1).forEach((pt, idx) => {
                        const px = mapX(pt.x);
                        const py = mapY(pt.y);
                        const r = 2.5 + (idx * 0.8);
                        svgHtml += `<circle cx="${px}" cy="${py}" r="${r}" fill="${sec.quadrant_color}" opacity="${0.3 + idx * 0.2}" />`;
                    });
                }
            });
        }

        // 6. Sector Bubbles
        state.filteredSectors.forEach((sec, idx) => {
            const bx = mapX(sec.rs_ratio);
            const by = mapY(sec.rs_momentum);
            const radius = 18;

            svgHtml += `
            <g class="sr-bubble-group" data-sector-id="${sec.id}" cursor="pointer"
               onmouseenter="window.showSectorTooltip(event, '${sec.id}')"
               onmouseleave="window.hideSectorTooltip()"
               onclick="window.openSectorConstituents('${sec.id}')">
                <circle cx="${bx}" cy="${by}" r="${radius + 5}" fill="${sec.quadrant_color}" opacity="0.18" class="sr-bubble-halo" />
                <circle cx="${bx}" cy="${by}" r="${radius}" fill="${sec.color || sec.quadrant_color}" stroke="#ffffff" stroke-width="2" class="sr-bubble-main" filter="drop-shadow(0 4px 8px rgba(0,0,0,0.18))" />
                <text x="${bx}" y="${by + 4}" font-size="14" text-anchor="middle" dominant-baseline="middle" pointer-events="none">${sec.icon}</text>
                <text x="${bx}" y="${by + radius + 14}" font-size="11" font-weight="800" fill="currentColor" text-anchor="middle" font-family="'Plus Jakarta Sans', sans-serif">${sec.name.replace('Nifty ', '')}</text>
            </g>`;
        });

        svg.innerHTML = svgHtml;
    }

    // Tooltip Engine
    window.showSectorTooltip = function (e, sectorId) {
        const sec = state.sectors.find(s => s.id === sectorId);
        if (!sec) return;

        const tooltip = document.getElementById('sr-rrg-tooltip');
        const wrapper = document.getElementById('sr-rrg-canvas-wrapper');
        if (!tooltip || !wrapper) return;

        const retSign = sec.selected_return >= 0 ? '+' : '';
        const alphaSign = sec.selected_alpha >= 0 ? '+' : '';

        tooltip.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
                <span style="font-weight: 800; font-size: 13px; font-family: 'Plus Jakarta Sans';">${sec.icon} ${sec.name}</span>
                <span style="font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: ${sec.quadrant_color}; color: #fff;">${sec.quadrant_label.toUpperCase()}</span>
            </div>
            <div style="font-size: 11px; color: #94a3b8; margin-bottom: 8px;">${sec.category} • Phase: ${sec.cycle_phase}</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 11px; background: rgba(255,255,255,0.06); padding: 8px; border-radius: 6px; margin-bottom: 8px;">
                <div><strong>Return (${state.frequency}):</strong> <span style="color: ${sec.selected_return >= 0 ? '#10b981' : '#ef4444'}">${retSign}${sec.selected_return.toFixed(2)}%</span></div>
                <div><strong>Alpha:</strong> <span style="color: ${sec.selected_alpha >= 0 ? '#10b981' : '#ef4444'}">${alphaSign}${sec.selected_alpha.toFixed(2)}%</span></div>
                <div><strong>RS-Ratio:</strong> ${sec.rs_ratio}</div>
                <div><strong>RS-Momentum:</strong> ${sec.rs_momentum}</div>
                <div><strong>P/E Ratio:</strong> ${sec.valuation.pe}</div>
                <div><strong>Breadth:</strong> ${sec.breadth.ratio_display}</div>
            </div>
            <div style="font-size: 10px; color: #38bdf8; text-align: center; font-weight: 700;">Click bubble to view constituents ➔</div>
        `;

        const rect = wrapper.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        tooltip.style.left = `${mouseX}px`;
        tooltip.style.top = `${mouseY}px`;
        tooltip.style.display = 'block';
    };

    window.hideSectorTooltip = function () {
        const tooltip = document.getElementById('sr-rrg-tooltip');
        if (tooltip) tooltip.style.display = 'none';
    };

    // --- 4. VIEW 2: Performance Leaderboard ---
    function renderLeaderboard() {
        const grid = document.getElementById('sr-leaderboard-grid');
        if (!grid) return;

        if (state.filteredSectors.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--sr-text-secondary);">No sectors found matching criteria.</div>';
            return;
        }

        const maxAbsReturn = Math.max(...state.sectors.map(s => Math.abs(s.selected_return)), 1);

        let html = '';
        state.filteredSectors.forEach((sec, idx) => {
            const isPos = sec.selected_return >= 0;
            const sign = isPos ? '+' : '';
            const pillClass = isPos ? 'sr-return-pos' : 'sr-return-neg';
            const barWidth = Math.min(100, Math.max(5, (Math.abs(sec.selected_return) / maxAbsReturn) * 100));
            const barColor = isPos ? '#10b981' : '#ef4444';

            const alphaSign = sec.selected_alpha >= 0 ? '+' : '';
            const alphaColor = sec.selected_alpha >= 0 ? 'text-buy' : 'text-sell';

            html += `
            <div class="sr-sector-card" onclick="openSectorConstituents('${sec.id}')">
                <div class="sr-sector-card-top">
                    <div class="sr-card-sector-meta">
                        <span class="sr-card-icon">${sec.icon}</span>
                        <div>
                            <div class="sr-card-name">${escapeHtml(sec.name)}</div>
                            <div class="sr-card-category">${escapeHtml(sec.category)}</div>
                        </div>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                        <span class="sr-card-rank-badge">#${idx + 1}</span>
                        <span class="sr-card-return-pill ${pillClass}">${sign}${sec.selected_return.toFixed(2)}%</span>
                    </div>
                </div>

                <div class="sr-card-bar-wrapper">
                    <div class="sr-card-bar-fill" style="width: ${barWidth}%; background: ${barColor};"></div>
                </div>

                <div class="sr-card-stats-grid">
                    <div class="sr-card-stat">
                        <span class="sr-card-stat-label">ALPHA VS NIFTY</span>
                        <span class="sr-card-stat-val ${alphaColor}">${alphaSign}${sec.selected_alpha.toFixed(2)}%</span>
                    </div>
                    <div class="sr-card-stat">
                        <span class="sr-card-stat-label">BREADTH</span>
                        <span class="sr-card-stat-val">${sec.breadth.ratio_display}</span>
                    </div>
                    <div class="sr-card-stat">
                        <span class="sr-card-stat-label">P/E RATIO</span>
                        <span class="sr-card-stat-val">${sec.valuation.pe}</span>
                    </div>
                </div>

                <div class="sr-card-bottom">
                    <span class="sr-card-quadrant-badge" style="background: rgba(16, 185, 129, 0.1); color: ${sec.quadrant_color}; border: 1px solid ${sec.quadrant_color}40;">
                        ${sec.quadrant_label}
                    </span>
                    <button type="button" class="sr-card-btn-constituents" onclick="event.stopPropagation(); openSectorConstituents('${sec.id}')">
                        Top Stocks (${(sec.constituents || []).length}) ➔
                    </button>
                </div>
            </div>`;
        });

        grid.innerHTML = html;
    }

    // --- 5. VIEW 3: Multi-Frequency Heatmap Matrix ---
    function renderMatrix() {
        const tbody = document.getElementById('sr-matrix-tbody');
        if (!tbody) return;

        // 1. Update Benchmark Timeframe Badge in Card Header
        const badgeEl = document.getElementById('sr-matrix-active-freq-badge');
        if (badgeEl) {
            badgeEl.innerHTML = `<span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#10b981; box-shadow:0 0 6px #10b981;"></span> Active Benchmark: <strong>${state.frequency}</strong>`;
        }

        // 2. Update Column Sort Icons & Highlight Active Benchmark Column Header
        const allFields = ['name', 'quadrant', '1D', '1W', '1M', '3M', '6M', '1Y', 'YTD', 'breadth', 'pe'];
        const freqs = ['1D', '1W', '1M', '3M', '6M', '1Y', 'YTD'];

        allFields.forEach(f => {
            const iconEl = document.getElementById(`sr-sort-icon-${f}`);
            const thEl = document.getElementById(`sr-th-${f}`) || iconEl?.closest('th');
            if (iconEl) {
                if (state.matrixSortField === f) {
                    iconEl.innerText = state.matrixSortDir === 'desc' ? ' ▼' : ' ▲';
                    iconEl.classList.add('active');
                    if (thEl) thEl.classList.add('sr-th-sorted');
                } else {
                    iconEl.innerText = ' ⇅';
                    iconEl.classList.remove('active');
                    if (thEl) thEl.classList.remove('sr-th-sorted');
                }
            }
        });

        freqs.forEach(f => {
            const th = document.getElementById(`sr-th-${f}`);
            if (th) {
                th.classList.toggle('sr-th-active-freq', f === state.frequency);
            }
        });

        // 3. Check for empty state
        if (!state.filteredSectors || state.filteredSectors.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="12" class="text-center" style="padding: 48px 16px; color: var(--sr-text-secondary);">
                        <div style="font-size: 28px; margin-bottom: 8px;">🔍</div>
                        <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px;">No Sectors Match Current Criteria</div>
                        <div style="font-size: 12px; opacity: 0.8;">Try clearing the search query or selecting a different quadrant.</div>
                    </td>
                </tr>`;
            return;
        }

        // 4. Sort Sectors
        const sortField = state.matrixSortField || '1M';
        const sortDir = state.matrixSortDir || 'desc';
        const multiplier = sortDir === 'asc' ? 1 : -1;

        const list = [...state.filteredSectors];
        list.sort((a, b) => {
            if (sortField === 'name') {
                return multiplier * (a.name || '').localeCompare(b.name || '');
            } else if (sortField === 'quadrant') {
                const quadOrder = { leading: 4, improving: 3, weakening: 2, lagging: 1 };
                const rA = quadOrder[a.quadrant] || 0;
                const rB = quadOrder[b.quadrant] || 0;
                return multiplier * (rA - rB);
            } else if (sortField === 'breadth') {
                const bA = (a.breadth && typeof a.breadth.advance_pct === 'number') ? a.breadth.advance_pct : 0;
                const bB = (b.breadth && typeof b.breadth.advance_pct === 'number') ? b.breadth.advance_pct : 0;
                return multiplier * (bA - bB);
            } else if (sortField === 'pe') {
                const peA = parseFloat(a.valuation?.pe) || 0;
                const peB = parseFloat(b.valuation?.pe) || 0;
                return multiplier * (peA - peB);
            } else if (freqs.includes(sortField)) {
                const retA = (a.returns && typeof a.returns[sortField] === 'number') ? a.returns[sortField] : -9999;
                const retB = (b.returns && typeof b.returns[sortField] === 'number') ? b.returns[sortField] : -9999;
                return multiplier * (retA - retB);
            }
            return 0;
        });

        // 5. Heatmap Class Helper
        function getHeatClass(val) {
            if (val >= 5.0) return 'heat-strong-pos';
            if (val > 0.0) return 'heat-pos';
            if (val === 0.0) return 'heat-zero';
            if (val > -5.0) return 'heat-neg';
            return 'heat-strong-neg';
        }

        // 6. Build Rows
        let html = '';
        list.forEach((sec) => {
            const rets = sec.returns || {};
            let freqCells = '';

            freqs.forEach(f => {
                const val = (typeof rets[f] === 'number') ? rets[f] : 0.0;
                const sign = val > 0 ? '+' : '';
                const hClass = getHeatClass(val);
                const isActiveFreq = (f === state.frequency);
                freqCells += `
                <td class="text-center sr-matrix-cell ${isActiveFreq ? 'sr-cell-active-freq' : ''}">
                    <span class="sr-matrix-pill ${hClass}" title="${escapeHtml(sec.name)} ${f} Return: ${sign}${val.toFixed(2)}%">
                        ${sign}${val.toFixed(2)}%
                    </span>
                </td>`;
            });

            // Quadrant badge
            const qKey = (sec.quadrant || 'leading').toLowerCase();
            const qLabel = sec.quadrant_label || (sec.quadrant ? sec.quadrant.toUpperCase() : 'LEADING');

            // Breadth data
            const adv = sec.breadth?.advances ?? 0;
            const dec = sec.breadth?.declines ?? 0;
            const advPct = sec.breadth?.advance_pct ?? (adv + dec > 0 ? (adv / (adv + dec)) * 100 : 50);

            // PE data
            const peVal = sec.valuation?.pe ? `${sec.valuation.pe}x` : '—';

            // Constituents count
            const stockCount = (sec.constituents || []).length;

            html += `
            <tr class="sr-matrix-row" onclick="openSectorConstituents('${sec.id}')" title="Click to view holdings of ${escapeHtml(sec.name)}">
                <td class="sr-sector-cell">
                    <div class="sr-sector-identity">
                        <div class="sr-sector-icon-box">
                            <span>${sec.icon || '📈'}</span>
                        </div>
                        <div class="sr-sector-names-group">
                            <div class="sr-sector-name" title="${escapeHtml(sec.name)}">${escapeHtml(sec.name)}</div>
                            <div class="sr-sector-meta-row">
                                <span class="sr-sector-category">${escapeHtml(sec.category || 'Index')}</span>
                                <span class="sr-sector-meta-sep">•</span>
                                <span class="sr-sector-constituents-count">${stockCount} Stocks</span>
                            </div>
                        </div>
                    </div>
                </td>
                <td class="text-center sr-matrix-cell">
                    <span class="sr-quadrant-badge sr-quad-${qKey}">
                        <span class="sr-quadrant-dot"></span>
                        ${qLabel}
                    </span>
                </td>
                ${freqCells}
                <td class="text-center sr-matrix-cell">
                    <div class="sr-breadth-cell">
                        <div class="sr-breadth-pills-row">
                            <span class="sr-breadth-chip sr-breadth-adv" title="${adv} Advancing Stocks">
                                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="18 15 12 9 6 15"/></svg>
                                ${adv}
                            </span>
                            <span class="sr-breadth-chip sr-breadth-dec" title="${dec} Declining Stocks">
                                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
                                ${dec}
                            </span>
                        </div>
                        <div class="sr-breadth-bar" title="Breadth: ${advPct.toFixed(0)}% Advances">
                            <div class="sr-breadth-bar-fill" style="width: ${advPct}%;"></div>
                        </div>
                    </div>
                </td>
                <td class="text-center sr-matrix-cell">
                    <span class="sr-pe-badge" title="P/E Ratio: ${peVal}">
                        ${peVal}
                    </span>
                </td>
                <td class="text-center sr-matrix-cell sr-action-cell">
                    <button type="button" class="sr-btn-constituents-pill" onclick="event.stopPropagation(); openSectorConstituents('${sec.id}')" title="Inspect constituent holdings">
                        <span>Holdings</span>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                </td>
            </tr>`;
        });

        tbody.innerHTML = html;
    }

    // --- 6. VIEW 4: Economic Cycle Clock ---
    function renderEconomicCycle() {
        const regime = state.economicCycle || {};
        const titleEl = document.getElementById('sr-cycle-phase-name');
        const descEl = document.getElementById('sr-cycle-phase-desc');
        const pillEl = document.getElementById('sr-cycle-regime-pill');

        if (titleEl) titleEl.innerText = regime.phase || 'Broad Economic Expansion';
        if (descEl) descEl.innerText = regime.description || '';
        if (pillEl) {
            pillEl.innerText = regime.tag || 'ACTIVE REGIME';
            if (regime.color) pillEl.style.background = regime.color;
        }

        // Highlight the matching phase card
        const phaseCards = {
            'phase-card-early': 'early',
            'phase-card-mid': 'mid',
            'phase-card-late': 'late',
            'phase-card-recession': 'recession'
        };

        const phaseLower = (regime.phase || '').toLowerCase();
        let activeKey = 'phase-card-mid';
        if (phaseLower.includes('early') || phaseLower.includes('recovery')) activeKey = 'phase-card-early';
        else if (phaseLower.includes('late') || phaseLower.includes('peak')) activeKey = 'phase-card-late';
        else if (phaseLower.includes('contraction') || phaseLower.includes('recession')) activeKey = 'phase-card-recession';

        Object.keys(phaseCards).forEach(cid => {
            const el = document.getElementById(cid);
            if (el) el.classList.toggle('phase-active', cid === activeKey);
        });
    }

    // --- 7. Constituents Slide-Out Modal ---
    window.openSectorConstituents = function (sectorId) {
        state.selectedSectorId = sectorId;
        const sec = state.sectors.find(s => s.id === sectorId);
        if (!sec) return;

        const modal = document.getElementById('sr-constituents-modal');
        const titleEl = document.getElementById('sr-modal-title');
        const subEl = document.getElementById('sr-modal-sub');
        const iconEl = document.getElementById('sr-modal-icon');
        const statsBar = document.getElementById('sr-modal-stats-bar');
        const tbody = document.getElementById('sr-constituents-tbody');

        if (titleEl) titleEl.innerText = sec.name;
        if (subEl) subEl.innerText = `${sec.category} • Index: ${sec.last_price.toLocaleString()}`;
        if (iconEl) iconEl.innerText = sec.icon;

        if (statsBar) {
            const retSign = sec.selected_return >= 0 ? '+' : '';
            const alphaSign = sec.selected_alpha >= 0 ? '+' : '';
            statsBar.innerHTML = `
                <div class="sr-modal-stat-box">
                    <span class="sr-modal-stat-label">${state.frequency} RETURN</span>
                    <span class="sr-modal-stat-val ${sec.selected_return >= 0 ? 'text-buy' : 'text-sell'}">${retSign}${sec.selected_return.toFixed(2)}%</span>
                </div>
                <div class="sr-modal-stat-box">
                    <span class="sr-modal-stat-label">ALPHA VS NIFTY</span>
                    <span class="sr-modal-stat-val ${sec.selected_alpha >= 0 ? 'text-buy' : 'text-sell'}">${alphaSign}${sec.selected_alpha.toFixed(2)}%</span>
                </div>
                <div class="sr-modal-stat-box">
                    <span class="sr-modal-stat-label">P/E RATIO</span>
                    <span class="sr-modal-stat-val">${sec.valuation.pe}</span>
                </div>
            `;
        }

        if (tbody) {
            const list = sec.constituents || [];
            let html = '';
            list.forEach(c => {
                html += `
                <tr>
                    <td>
                        <span style="font-weight: 800; font-family: 'Plus Jakarta Sans'; color: #10b981; cursor: pointer;" onclick="openSectorStockChart('${c.symbol}')">
                            ${escapeHtml(c.symbol)}
                        </span>
                    </td>
                    <td>
                        <span style="font-weight: 600;">${escapeHtml(c.name)}</span>
                    </td>
                    <td class="text-center">
                        <span style="font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: var(--sr-bg-body); border: 1px solid var(--sr-border);">
                            ${escapeHtml(c.cap || 'LargeCap')}
                        </span>
                    </td>
                    <td class="text-right" style="font-weight: 700;">
                        ${c.weight ? c.weight.toFixed(1) + '%' : '-'}
                    </td>
                    <td class="text-center">
                        <button type="button" class="sr-btn-chart-sm" onclick="openSectorStockChart('${c.symbol}')">
                            Chart ↗
                        </button>
                    </td>
                </tr>`;
            });
            tbody.innerHTML = html;
        }

        if (modal) modal.style.display = 'flex';
    };

    window.closeSectorConstituentsModal = function (e) {
        if (e && e.target && e.target !== e.currentTarget && !e.target.classList.contains('sr-modal-close')) return;
        const modal = document.getElementById('sr-constituents-modal');
        if (modal) modal.style.display = 'none';
    };

    window.openSectorStockChart = function (symbol) {
        if (!symbol) return;
        const clean = symbol.replace(/\.(?:NS|BO)$/i, '').trim();
        if (typeof window.openChart === 'function') {
            window.openChart(clean);
        } else if (typeof window.openInHouseChart === 'function') {
            window.openInHouseChart(clean);
        } else {
            console.log('Open chart for symbol:', clean);
        }
    };

    // --- 8. Global Interaction Methods ---
    window.setSectorFrequency = function (freq) {
        if (state.frequency === freq) return;
        state.frequency = freq;
        fetchSectorRotation(false);
    };

    window.switchSectorView = function (view) {
        state.view = view;
        document.querySelectorAll('.sr-view-tab').forEach(tab => {
            tab.classList.toggle('active', tab.getAttribute('data-view') === view);
        });

        ['rrg', 'leaderboard', 'matrix', 'cycle'].forEach(v => {
            const el = document.getElementById(`sr-view-${v}`);
            if (el) el.style.display = (v === view) ? 'block' : 'none';
        });

        renderAllViews();
    };

    window.handleMatrixSort = function (field) {
        if (!field) return;
        if (state.matrixSortField === field) {
            state.matrixSortDir = state.matrixSortDir === 'desc' ? 'asc' : 'desc';
        } else {
            state.matrixSortField = field;
            state.matrixSortDir = (field === 'name' || field === 'quadrant') ? 'asc' : 'desc';
        }
        renderMatrix();
    };

    window.filterSectorQuadrant = function (quad) {
        state.quadrantFilter = quad;
        applyFilters();
        renderAllViews();
    };

    window.toggleSectorTails = function () {
        state.showTails = !state.showTails;
        const btn = document.getElementById('sr-btn-tails-toggle');
        if (btn) btn.classList.toggle('active', state.showTails);
        if (state.view === 'rrg') renderRRG();
    };

    let searchTimer = null;
    window.handleSectorSearch = function (q) {
        const clearBtn = document.getElementById('sr-search-clear');
        if (clearBtn) clearBtn.style.display = q ? 'inline-block' : 'none';

        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            state.searchQuery = q;
            applyFilters();
            renderAllViews();
        }, 200);
    };

    window.clearSectorSearch = function () {
        const input = document.getElementById('sr-search-input');
        if (input) input.value = '';
        handleSectorSearch('');
    };

    window.loadSectorRotationModule = function (forceRefresh = false) {
        fetchSectorRotation(forceRefresh);
    };

    window.refreshSectorRotationData = function (forceRefresh = true) {
        fetchSectorRotation(forceRefresh);
    };

    function showLoading(show) {
        const loader = document.getElementById('sr-loader-container');
        if (loader) {
            if (show) {
                loader.style.display = 'flex';
                if (typeof window.createBrandLoaderHTML === 'function') {
                    loader.innerHTML = window.createBrandLoaderHTML({
                        title: 'Computing Official Sector Rotation & RRG Momentum...',
                        subtitle: 'Querying NSE India Sectoral Indices and Multi-Frequency Returns'
                    });
                }
            } else {
                loader.style.display = 'none';
            }
        }
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Auto-init on DOMContentLoaded if starting on sector-rotation tab or route
    document.addEventListener('DOMContentLoaded', () => {
        if (window.INITIAL_TAB === 'sector-rotation' || window.currentTab === 'sector-rotation' || window.location.pathname === '/sector-rotation') {
            if (typeof window.switchTab === 'function') {
                window.switchTab('sector-rotation', false);
            }
            loadSectorRotationModule();
        }
    });
})();
