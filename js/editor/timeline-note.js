/**
 * editor/timeline-note.js — 音符渲染
 */

EditorTimeline.renderNotes = function(state, width, height) {
    const notes = state.notes || [];
    const currentTime = state.currentTime || 0;
    const selectedIds = new Set((state.selectedNotes || []).map(n => n.id));
    const isMultiSelect = state.selectedNotes && state.selectedNotes.length > 1;

    notes.forEach(note => {
        const noteTrackCount = window.ChartEditor
            ? window.ChartEditor.getTrackCountAtTime(note.time, note.id)
            : 3;
        const colCount = noteTrackCount + 1;
        const colWidth = width / colCount;

        const y = this.judgeOffset - note.time * this.pps;
        const x = (note.track + 1) * colWidth;
        const isSelected = selectedIds.has(note.id);
        const isBreathing = note._breathing;

        const el = document.createElement('div');
        el.className = 'timeline-note' + (isSelected ? ' selected' : '') + (isMultiSelect && isSelected ? ' multi-selected' : '') + (isBreathing ? ' breathing' : '');
        el.dataset.noteId = note.id;

        // 描边：单选白色实线，多选白色虚线
        const selectOutline = isSelected
            ? (isMultiSelect
                ? 'outline: 2px dashed rgba(255,255,255,0.9); outline-offset: 2px;'
                : 'outline: 2px solid rgba(255,255,255,0.9); outline-offset: 2px;')
            : '';

        if (note.type === 'tap') {
            el.style.cssText = `
                position: absolute;
                top: ${y - 8}px;
                left: ${x - 8}px;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: var(--accent-primary);
                ${selectOutline}
                pointer-events: auto;
                cursor: pointer;
                z-index: 10;
            `;
        } else if (note.type === 'hold') {
            const holdHeight = Math.max((note.endTime - note.time) * this.pps, 4);
            el.style.cssText = `
                position: absolute;
                top: ${y - holdHeight}px;
                left: ${x - 6}px;
                width: 12px;
                height: ${holdHeight}px;
                border-radius: 6px;
                background: var(--accent-secondary);
                ${selectOutline}
                pointer-events: auto;
                cursor: pointer;
                z-index: 10;
            `;
            const head = document.createElement('div');
            head.style.cssText = `
                position: absolute;
                bottom: -7px;
                left: -2px;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: var(--accent-secondary);
                border: 2px solid var(--accent-secondary);
                box-shadow: 0 0 6px var(--accent-secondary);
            `;
            el.appendChild(head);
            const tailDot = document.createElement('div');
            tailDot.style.cssText = `
                position: absolute;
                top: -7px;
                left: -2px;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: var(--accent-secondary);
                border: 2px solid var(--accent-secondary);
                box-shadow: 0 0 6px var(--accent-secondary);
            `;
            el.appendChild(tailDot);
        } else if (note.type === 'switch') {
            el.style.cssText = `
                position: absolute;
                top: ${y - 12}px;
                left: ${x - 12}px;
                width: 24px;
                height: 24px;
                border-radius: 6px;
                background: #ff9500;
                ${selectOutline}
                pointer-events: auto;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                font-weight: 700;
                color: #fff;
                z-index: 10;
            `;
            el.textContent = note.targetTrackCount || '?';
        }

        // 点击事件由 timeline.js 的统一 pointer 事件处理
        // 不阻止冒泡，让容器的 pointer 事件正常接收

        this.worldLayer.appendChild(el);
    });
};