/**
 * editor/timeline-track.js — 轨道渲染
 * 时区背景、轨道竖线、轨道编号
 * 每个 segment 渲染完整高度（按实际时间范围），避免 Infinity 导致的性能问题
 * 同时添加负时间缓冲，让开头处下方也有轨道
 */

EditorTimeline.renderTracks = function(state, width, height) {
    const ce = window.ChartEditor;
    const currentTime = state.currentTime || 0;
    const activeTrack = state.activeTrack || 0;
    const initTrackCount = state.trackCount || 3;
    const pps = this.pps || 200;
    const jOff = this.judgeOffset || Math.floor(height * 0.75);

    // 收集变轨音符并排序
    const switchNotes = (state.notes || [])
        .filter(n => n.type === 'switch')
        .sort((a, b) => a.time - b.time);

    // 确定时间轴最大范围（不再用 Infinity）
    const lastNoteTime = state.notes && state.notes.length > 0
        ? state.notes[state.notes.length - 1].time
        : 0;
    const maxTime = Math.max(state.duration || 0, lastNoteTime + 5, 5);

    // 负时间缓冲：渲染一小段负时间轨道，让最开头时下面也有轨道
    const screenTime = height / pps;
    const negBuffer = Math.max(1, screenTime * 0.5);

    // 构建时间段列表
    const segments = [];
    let segTrackCount = initTrackCount;
    let lastTime = 0;

    // 负时间 segment（只在最开头，无变轨）
    segments.push({
        startTime: -negBuffer,
        endTime: 0,
        trackCount: initTrackCount
    });

    for (const sw of switchNotes) {
        segments.push({
            startTime: lastTime,
            endTime: sw.time,
            trackCount: segTrackCount
        });
        segTrackCount = Math.max(1, Math.min(4, sw.targetTrackCount || 3));
        lastTime = sw.time;
    }
    segments.push({
        startTime: lastTime,
        endTime: maxTime,
        trackCount: segTrackCount
    });

    // ===== 1. 分段轨道竖线 + 时区背景（完整高度，随 worldLayer 滚动） =====
    const linesLayer = this.trackLinesLayer;
    if (linesLayer) {
        for (const seg of segments) {
            const tCount = seg.trackCount;
            const colCount = tCount + 1;
            const colWidth = width / colCount;

            // 计算该段在 worldLayer 坐标系中的像素范围
            const segTopY = jOff - seg.endTime * pps;
            const segBottomY = jOff - seg.startTime * pps;
            const visibleHeight = segBottomY - segTopY;

            if (visibleHeight <= 0) continue;

            // 时区背景
            for (let i = 0; i < tCount; i++) {
                const centerX = (i + 1) * colWidth;
                const zone = document.createElement('div');
                zone.className = 'track-zone' + (i === activeTrack ? ' active' : '');
                zone.style.cssText = `
                    position: absolute;
                    top: ${segTopY}px;
                    left: ${Math.round(centerX - colWidth / 2)}px;
                    width: ${Math.round(colWidth)}px;
                    height: ${visibleHeight}px;
                    pointer-events: none;
                    z-index: 1;
                `;
                linesLayer.appendChild(zone);
            }

            // 轨道竖线
            for (let i = 0; i < tCount; i++) {
                const isActive = i === activeTrack;
                const line = document.createElement('div');
                line.className = 'track-divider' + (isActive ? ' active' : '');
                const centerX = (i + 1) * colWidth;
                const lw = isActive ? 4 : 3; // 轨道线加粗 2px（原 1/2px）
                line.style.cssText = `
                    position: absolute;
                    top: ${segTopY}px;
                    left: ${centerX}px;
                    width: ${lw}px;
                    height: ${visibleHeight}px;
                    background: ${isActive ? 'var(--accent-primary)' : '#7a7050'};
                    pointer-events: auto;
                    cursor: pointer;
                    transition: all 0.15s ease;
                    z-index: 5;
                    transform: translateX(-50%);
                `;
                line.addEventListener('click', () => {
                    if (window.ChartEditor) {
                        window.ChartEditor.state.activeTrack = i;
                        this.render();
                        EditorPanels.refreshTrackInfo();
                    }
                });
                linesLayer.appendChild(line);

                // iOS 兼容：容器 touchstart 会 preventDefault 吞掉 click，
                // 用 44px 透明命中条 + touchend 选中，touchstart 阻断冒泡避免容器处理
                const hit = document.createElement('div');
                hit.style.cssText = `
                    position: absolute;
                    top: ${segTopY}px;
                    left: ${centerX}px;
                    width: 44px;
                    height: ${visibleHeight}px;
                    transform: translateX(-50%);
                    background: transparent;
                    pointer-events: auto;
                    cursor: pointer;
                    z-index: 6;
                    -webkit-tap-highlight-color: transparent;
                `;
                const selectTrack = () => {
                    if (window.ChartEditor) {
                        window.ChartEditor.state.activeTrack = i;
                        this.render();
                        EditorPanels.refreshTrackInfo();
                    }
                };
                // 触摸：点按(≤10px) = 选中轨道；滑动 = 转发给容器做拖拽滚动
                let _downX = 0, _downY = 0, _forwarding = false;
                hit.addEventListener('touchstart', (ev) => {
                    ev.stopPropagation(); // 阻止容器放置音符
                    const t = ev.touches[0];
                    _downX = t.clientX; _downY = t.clientY; _forwarding = false;
                }, { passive: true });
                hit.addEventListener('touchmove', (ev) => {
                    const t = ev.touches[0];
                    if (!_forwarding) {
                        if (Math.hypot(t.clientX - _downX, t.clientY - _downY) <= 10) return;
                        _forwarding = true;
                        EditorTimeline._onPointerDown(t); // 补发按下，启动拖拽
                    }
                    EditorTimeline._onPointerMove(t);
                }, { passive: true });
                hit.addEventListener('touchend', (ev) => {
                    if (_forwarding) {
                        _forwarding = false;
                        EditorTimeline._onPointerUp(ev.changedTouches[0]);
                    } else {
                        ev.preventDefault();
                        ev.stopPropagation();
                        selectTrack();
                    }
                }, { passive: false });
                hit.addEventListener('click', selectTrack);
                linesLayer.appendChild(hit);
            }
        }
    }

    // ===== 2. 变轨分隔线（视口裁剪，避免过多 DOM） =====
    const swLayer = this.switchLineLayer;
    if (swLayer) {
        // 计算可见时间范围（用于裁剪变轨线）
        const viewStart = Math.max(-negBuffer, currentTime - screenTime * 2);
        const viewEnd = currentTime + screenTime * 2;

        for (const sw of switchNotes) {
            if (sw.time < viewStart || sw.time > viewEnd) continue;

            const y = jOff - sw.time * pps;
            const line = document.createElement('div');
            line.className = 'track-switch-line';
            line.style.cssText = `
                position: absolute;
                top: ${y}px;
                left: 0;
                width: 100%;
                height: 2px;
                background: rgba(48, 209, 88, 0.6);
                box-shadow: 0 0 6px rgba(48, 209, 88, 0.3);
                pointer-events: none;
                z-index: 2;
            `;
            swLayer.appendChild(line);

            // 轨道数变化提示
            const prevCount = ce ? ce.getTrackCountAtTime(sw.time - 0.001) : initTrackCount;
            const nextCount = Math.max(1, Math.min(4, sw.targetTrackCount || 3));
            const label = document.createElement('div');
            label.textContent = prevCount + '→' + nextCount;
            label.style.cssText = `
                position: absolute;
                top: ${y - 16}px;
                right: 8px;
                font-size: 10px;
                color: rgba(48, 209, 88, 0.8);
                font-weight: 600;
                pointer-events: none;
                z-index: 2;
            `;
            swLayer.appendChild(label);
        }
    }

    // ===== 3. 轨道编号（固定在底部，不随滚动） =====
    const curTrackCount = ce ? ce.getTrackCountAtTime(currentTime) : initTrackCount;
    const curColCount = curTrackCount + 1;
    const curColWidth = width / curColCount;
    for (let i = 0; i < curTrackCount; i++) {
        const label = document.createElement('div');
        label.className = 'track-label';
        label.textContent = (i + 1).toString();
        const left = Math.round((i + 1) * curColWidth);
        label.style.cssText = `
            position: absolute;
            bottom: 4px;
            left: ${left}px;
            transform: translateX(-50%);
            text-align: center;
            font-size: 10px;
            color: var(--text-tertiary);
            font-weight: 400;
            pointer-events: auto;
            cursor: pointer;
            z-index: 10;
            text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6);
        `;
        const selectTrackByLabel = () => {
            if (window.ChartEditor) {
                window.ChartEditor.state.activeTrack = i;
                this.render();
                EditorPanels.refreshTrackInfo();
            }
        };
        label.addEventListener('click', selectTrackByLabel);
        // 触摸：点按 = 选中轨道；滑动 = 转发给容器做拖拽滚动
        let _lDownX = 0, _lDownY = 0, _lForwarding = false;
        label.addEventListener('touchstart', (ev) => {
            ev.stopPropagation();
            const t = ev.touches[0];
            _lDownX = t.clientX; _lDownY = t.clientY; _lForwarding = false;
        }, { passive: true });
        label.addEventListener('touchmove', (ev) => {
            const t = ev.touches[0];
            if (!_lForwarding) {
                if (Math.hypot(t.clientX - _lDownX, t.clientY - _lDownY) <= 10) return;
                _lForwarding = true;
                EditorTimeline._onPointerDown(t);
            }
            EditorTimeline._onPointerMove(t);
        }, { passive: true });
        label.addEventListener('touchend', (ev) => {
            if (_lForwarding) {
                _lForwarding = false;
                EditorTimeline._onPointerUp(ev.changedTouches[0]);
            } else {
                ev.preventDefault();
                ev.stopPropagation();
                selectTrackByLabel();
            }
        }, { passive: false });
        this.trackOverlay.appendChild(label);
    }
};
