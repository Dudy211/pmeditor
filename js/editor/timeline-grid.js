/**
 * editor/timeline-grid.js — 拍子网格线渲染
 * 大拍线 2px、小拍线 1px；渲染范围覆盖整个音乐时长 + 缓冲
 * 配色跟随主题 CSS 变量，中性灰色，不用白/蓝/红
 */

EditorTimeline.renderBeatGrid = function(state, width, height) {
    // 显示网格线开关（默认开启）
    const showGrid = localStorage.getItem('muse-editor-show-grid') !== 'false';
    if (!showGrid) return;

    const snap = state.snap || 0;
    const bpm = state.bpm || 120;
    const beatDuration = 60 / bpm;
    const currentTime = state.currentTime || 0;
    const duration = state.duration || 0;
    const pps = this.pps;
    const jOff = this.judgeOffset;

    // 一屏对应的时间跨度
    const screenTime = height / pps;
    // 渲染范围：覆盖整个音乐时长 + 上下各 5 屏缓冲
    const bufferTime = screenTime * 5;
    const renderStart = Math.max(0, -bufferTime);
    const renderEnd = Math.max(duration + bufferTime, screenTime * 10);

    // 全拍模式：只画整拍线（大拍线），无吸附点
    if (snap === 0) {
        const startBeat = Math.floor(renderStart / beatDuration) - 1;
        const endBeat = Math.ceil(renderEnd / beatDuration) + 1;

        for (let b = startBeat; b <= endBeat; b++) {
            const time = b * beatDuration;
            if (time < 0) continue;

            // worldLayer 内部坐标（配合 translateY 使用）
            const y = jOff - time * pps;
            // 容器中的实际显示位置（用于判断标签是否该显示）
            const displayY = y + currentTime * pps;

            // 大拍线 — 1px 细线
            const line = document.createElement('div');
            line.style.cssText = `
                position:absolute;top:${y}px;left:0;width:100%;height:1px;
                background:var(--grid-major);pointer-events:none;z-index:1;
            `;
            this.worldLayer.appendChild(line);

            // 拍子编号（始终创建，随 worldLayer 滚动自然进出视野）
            const label = document.createElement('div');
            label.className = 'beat-label';
            label.textContent = (b + 1).toString();
            label.style.top = (y - 14) + 'px';
            this.worldLayer.appendChild(label);
        }
        return;
    }

    // 细分模式
    const snapInterval = beatDuration / snap;
    const startIdx = Math.floor(renderStart / snapInterval) - 1;
    const endIdx = Math.ceil(renderEnd / snapInterval) + 1;

    const trackCount = state.trackCount || 3;
    const colCount = trackCount + 1;
    const colWidth = width / colCount;

    for (let i = startIdx; i <= endIdx; i++) {
        const time = i * snapInterval;
        if (time < 0) continue;

        // worldLayer 内部坐标
        const y = jOff - time * pps;
        // 容器中的实际显示位置
        const displayY = y + currentTime * pps;

        const beatIndex = Math.round(time / beatDuration);
        const isWholeBeat = Math.abs(time - beatIndex * beatDuration) < 0.0001;

        // 水平网格线：大拍 1px，小拍 0.5px（用 scaleY 实现半像素）
        const line = document.createElement('div');
        const h = isWholeBeat ? 1 : 0.5;
        const bgVar = isWholeBeat ? 'var(--grid-major)' : 'var(--grid-minor)';
        if (isWholeBeat) {
            line.style.cssText = `
                position:absolute;top:${y}px;left:0;width:100%;height:1px;
                background:${bgVar};pointer-events:none;z-index:1;
            `;
        } else {
            // 半像素线：用 transform scaleY 实现更细的线
            line.style.cssText = `
                position:absolute;top:${y}px;left:0;width:100%;height:1px;
                background:${bgVar};pointer-events:none;z-index:1;
                transform:scaleY(0.5);transform-origin:center;
            `;
        }
        this.worldLayer.appendChild(line);

        // 大拍编号（始终创建，随 worldLayer 滚动自然进出视野）
        if (isWholeBeat && beatIndex >= 0) {
            const label = document.createElement('div');
            label.className = 'beat-label';
            label.textContent = (beatIndex + 1).toString();
            label.style.top = (y - 14) + 'px';
            this.worldLayer.appendChild(label);
        }

        // 吸附点圆球标记已移除（保持界面简洁）
    }
};
