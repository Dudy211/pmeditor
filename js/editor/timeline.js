/**
 * editor/timeline.js — 时间轴核心模块
 * 容器管理、渲染调度、滚动控制、拖拽浏览
 */

const EditorTimeline = {
    container: null,
    worldLayer: null,
    trackOverlay: null,
    judgeLine: null,

    // 渲染参数
    pps: 200,           // pixels per second（基础值，实际 = pps * zoom）
    judgeOffset: 0,     // 判定线距顶部距离（容器高度的 3/4）

    // 拖拽状态
    _dragging: false,
    _dragStartY: 0,
    _dragStartTime: 0,
    _lastDragTime: 0,

    init() {
        const timeline = document.getElementById('editor-timeline');
        if (!timeline) return;
        this.container = timeline;

        // 世界层：包含拍子线和音符，transform 驱动滚动
        this.worldLayer = document.createElement('div');
        this.worldLayer.className = 'timeline-world';
        this.worldLayer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:3;overflow:visible;';
        timeline.appendChild(this.worldLayer);

        // 变轨分隔线层（随 worldLayer 滚动）
        this.switchLineLayer = document.createElement('div');
        this.switchLineLayer.className = 'switch-line-layer';
        this.switchLineLayer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:2;pointer-events:none;overflow:visible;';
        this.worldLayer.appendChild(this.switchLineLayer);

        // 轨道覆盖层：竖线、时区背景固定不动
        this.trackOverlay = document.createElement('div');
        this.trackOverlay.className = 'track-overlay';
        this.trackOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2;';
        timeline.appendChild(this.trackOverlay);

        // 判定线：固定横线
        this.judgeLine = document.createElement('div');
        this.judgeLine.className = 'judge-line';
        this.judgeLine.style.cssText = 'position:absolute;left:0;width:100%;height:1px;background:rgba(255,59,48,0.5);z-index:4;pointer-events:none;';
        timeline.appendChild(this.judgeLine);

        // 触摸点指示器
        this.touchIndicator = document.createElement('div');
        this.touchIndicator.className = 'touch-indicator';
        this.touchIndicator.style.cssText = 'position:absolute;width:20px;height:20px;border-radius:50%;border:2px solid rgba(10,132,255,0.6);background:rgba(10,132,255,0.15);pointer-events:none;z-index:6;display:none;transform:translate(-50%,-50%);';
        timeline.appendChild(this.touchIndicator);

        // 预览层：放置中的 hold 实时预览
        this.previewLayer = document.createElement('div');
        this.previewLayer.className = 'timeline-preview';
        this.previewLayer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:5;overflow:visible;pointer-events:none;';
        timeline.appendChild(this.previewLayer);

        // 框选层
        this.marqueeLayer = document.createElement('div');
        this.marqueeLayer.className = 'marquee-layer';
        this.marqueeLayer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:7;pointer-events:none;overflow:hidden;';
        timeline.appendChild(this.marqueeLayer);

        // 拖动预览层
        this.dragPreviewLayer = document.createElement('div');
        this.dragPreviewLayer.className = 'drag-preview-layer';
        this.dragPreviewLayer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:8;pointer-events:none;overflow:visible;';
        timeline.appendChild(this.dragPreviewLayer);

        // 多选提示
        this._multiSelectToast = null;

        // 初始化呼吸动画 CSS 变量（默认开启）
        const breatheEnabled = localStorage.getItem('muse-editor-breathe') !== 'false';
        const breatheSpeed = parseFloat(localStorage.getItem('muse-editor-breathe-speed')) || 1.5;
        const breatheMin = parseFloat(localStorage.getItem('muse-editor-breathe-min')) || 0.4;
        const breatheMax = parseFloat(localStorage.getItem('muse-editor-breathe-max')) || 1.0;
        document.documentElement.style.setProperty('--breathe-duration', (3.5 - breatheSpeed) + 's');
        document.documentElement.style.setProperty('--breathe-min', breatheMin);
        document.documentElement.style.setProperty('--breathe-max', breatheMax);
        // 如果 localStorage 没有设置过，默认设为开启
        if (localStorage.getItem('muse-editor-breathe') === null) {
            localStorage.setItem('muse-editor-breathe', 'true');
        }

        // 绑定拖拽事件
        this.bindDragEvents();

        // 监听主题切换，自动重绘网格线
        window.addEventListener('themechange', () => this.render());

        this.render();
    },

    bindDragEvents() {
        const el = this.container;
        if (!el) return;

        // 鼠标拖拽 & 放置
        el.addEventListener('mousedown', (e) => this._onPointerDown(e));
        window.addEventListener('mousemove', (e) => this._onPointerMove(e));
        window.addEventListener('mouseup', (e) => this._onPointerUp(e));

        // 触摸拖拽 & 放置
        el.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                e.preventDefault(); // 阻止 mouse 事件，避免重复触发
                this._onPointerDown(e.touches[0]);
            }
        }, { passive: false });
        window.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1) {
                this._onPointerMove(e.touches[0]);
            }
        }, { passive: false });
        window.addEventListener('touchend', (e) => {
            this._onPointerUp(e.changedTouches[0]);
        });

        // 滚轮滚动
        el.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    },

    // ===== 统一指针事件处理 =====
    // 区分"点击放置"和"拖拽浏览"：
    // - 移动距离 < 10px 且时间 < 300ms → 点击
    // - 否则 → 拖拽
    _onPointerDown(e) {
        const ce = window.ChartEditor;
        if (!ce) return;

        // 如果正在等待第二次点击（hold 点击模式）
        if (this._holdDrawing && !this._holdDragging) {
            const x = this._downX;
            const y = this._downY;
            const trackIdx = this._getTrackFromX(x);

            if (trackIdx !== -1 && trackIdx === this._holdHead.track) {
                const time = this._yToTime(y);
                const snappedTime = this._snapTime(time);
                const endTime = Math.max(snappedTime, this._holdHead.time + 0.05);
                const note = this._addNote({
                    type: 'hold',
                    time: this._holdHead.time,
                    endTime: endTime,
                    track: this._holdHead.track,
                });
                this.selectNote(note);
                this._holdDrawing = false;
                this._holdDragging = false;
                this._removeHoldPreview();
            } else {
                this._holdDrawing = false;
                this._holdDragging = false;
                this._removeHoldPreview();
            }
            this._pointerDown = false;
            this._hasMoved = false;
            this._clearLongPressTimer();
            return;
        }

        this._pointerDown = true;
        this._pointerStartX = e.clientX;
        this._pointerStartY = e.clientY;
        this._pointerStartTime = Date.now();
        this._hasMoved = false;
        this._longPressTriggered = false;
        this._isMarqueeSelecting = false;
        this._isNoteDragging = false;

        const rect = this.container.getBoundingClientRect();
        this._downX = e.clientX - rect.left;
        this._downY = e.clientY - rect.top;

        // 检测是否点击在音符上
        const hitNote = this._hitNoteAt(this._pointerStartX, this._pointerStartY);
        const mode = ce.state.editorMode || 'place';
        this._downHitNote = hitNote;

        // Ctrl + 点击音符 → 进入多选模式并 toggle 该音符
        if ((e.ctrlKey || e.metaKey) && hitNote && mode === 'select') {
            this._enterMultiSelectMode();
            this.toggleNoteSelection(hitNote);
            this._pointerDown = false;
            return;
        }

        // 显示触摸点
        const showTouch = localStorage.getItem('muse-editor-show-touch') === 'true';
        if (showTouch && this.touchIndicator) {
            this.touchIndicator.style.left = this._downX + 'px';
            this.touchIndicator.style.top = this._downY + 'px';
            this.touchIndicator.style.display = 'block';
        }

        // 启动长按定时器（300ms）
        this._clearLongPressTimer();
        this._longPressTimer = setTimeout(() => {
            if (!this._pointerDown || this._hasMoved) return;
            const ce = window.ChartEditor;
            if (ce && ce.state.editorMode !== 'place' && ce.state.editorMode !== 'select') return;
            this._longPressTriggered = true;

            const mode = ce.state.editorMode || 'place';
            const hitNote = this._downHitNote;

            // 选中模式下长按已选中音符 → 启动拖动
            if (mode === 'select' && hitNote && ce.state.selectedNotes.includes(hitNote)) {
                this._startNoteDrag(hitNote, this._downX, this._downY);
                return;
            }
            // 如果 _hitNoteAt 没返回选中音符（比如复制后重叠），检查选中音符中是否有在点击位置的
            if (mode === 'select' && ce.state.selectedNotes.length > 0) {
                for (const sn of ce.state.selectedNotes) {
                    if (this._isPointOnNote(sn, this._downX, this._downY)) {
                        this._startNoteDrag(sn, this._downX, this._downY);
                        return;
                    }
                }
            }
            // 选中模式下长按空白处 → 启动框选
            if (mode === 'select' && !hitNote) {
                this._startMarquee(this._downX, this._downY);
                return;
            }
            // 放置模式下长按 → hold 绘制
            this._onLongPress();
        }, 300);
    },

    _onPointerMove(e) {
        if (!this._pointerDown) return;
        const ce = window.ChartEditor;
        if (!ce) return;

        const dx = e.clientX - this._pointerStartX;
        const dy = e.clientY - this._pointerStartY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // 音符拖动优先处理（不受 dist 阈值限制）
        if (this._isNoteDragging) {
            const rect = this.container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this._updateNoteDrag(x, y);
            if (!this._hasMoved && dist > 5) {
                this._hasMoved = true;
                this._clearLongPressTimer();
            }
            return;
        }

        // 移动超过阈值
        if (dist > 10 && !this._hasMoved) {
            this._hasMoved = true;
            this._clearLongPressTimer();

            if (this._isMarqueeSelecting) {
                const rect = this.container.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                this._updateMarquee(x, y);
                return;
            }

            if (this._holdDrawing && this._longPressTriggered) {
                this._holdDragging = true;
            } else if (!this._holdDrawing) {
                // 普通时间轴拖拽
                this._startDrag(this._pointerStartY);
            }
        }

        if (this._isMarqueeSelecting) {
            const rect = this.container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this._lastMoveX = x;
            this._lastMoveY = y;
            this._updateMarquee(x, y);
            return;
        }

        if (this._dragging) {
            const deltaY = e.clientY - this._dragStartY;
            const deltaTime = deltaY / this.pps;
            let newTime = this._dragStartTime + deltaTime;
            newTime = Math.max(0, Math.min(newTime, ce.state.duration || Infinity));
            this._lastDragTime = newTime;
            ce.state.currentTime = newTime;
            this.updateScroll(newTime);
            ce.updateStatus();
        }

        // 更新触摸点位置
        const showTouchMove = localStorage.getItem('muse-editor-show-touch') === 'true';
        if (showTouchMove && this.touchIndicator) {
            const rect = this.container.getBoundingClientRect();
            this.touchIndicator.style.left = (e.clientX - rect.left) + 'px';
            this.touchIndicator.style.top = (e.clientY - rect.top) + 'px';
        }

        // hold 拖动模式下更新尾部预览
        if (this._holdDrawing && this._holdDragging) {
            const deltaY = e.clientY - this._pointerStartY;
            const y = this._downY + deltaY;
            const time = this._yToTime(y);
            const snappedTime = this._snapTime(time);
            this._holdTailTime = Math.max(snappedTime, this._holdHead.time + 0.05);
            this._updateHoldPreview();
        }
    },

    _onPointerUp(e) {
        const ce = window.ChartEditor;
        if (!ce) return;
        if (!this._pointerDown) return;

        this._clearLongPressTimer();

        const dx = (e.clientX || this._pointerStartX) - this._pointerStartX;
        const dy = (e.clientY || this._pointerStartY) - this._pointerStartY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // 如果正在拖动音符，结束拖动
        if (this._isNoteDragging) {
            this._endNoteDrag();
            this._pointerDown = false;
            this._hasMoved = false;
            this._longPressTriggered = false;
            if (this.touchIndicator) this.touchIndicator.style.display = 'none';
            return;
        }

        // 如果正在框选，结束框选
        if (this._isMarqueeSelecting) {
            this._endMarquee();
            this._pointerDown = false;
            this._hasMoved = false;
            this._longPressTriggered = false;
            if (this.touchIndicator) this.touchIndicator.style.display = 'none';
            return;
        }

        // 如果正在拖拽，结束拖拽
        if (this._dragging) {
            this._dragging = false;
            this.container.style.cursor = '';
            ce.state.currentTime = this._lastDragTime;
            ce.audioOffset = this._lastDragTime;
            ce.updateStatus();
        }

        // 如果正在绘制 hold
        if (this._holdDrawing) {
            if (this._holdDragging) {
                this._holdDrawing = false;
                this._holdDragging = false;
                const endTime = this._holdTailTime;
                const note = this._addNote({
                    type: 'hold',
                    time: this._holdHead.time,
                    endTime: endTime,
                    track: this._holdHead.track,
                });
                this.selectNote(note);
                this._removeHoldPreview();
            } else if (this._longPressTriggered) {
                const x = this._downX;
                const trackIdx = this._getTrackFromX(x);
                if (trackIdx === -1 || trackIdx !== this._holdHead.track) {
                    // 不在轨道上或不在同轨道，取消
                    this._holdDrawing = false;
                    this._removeHoldPreview();
                    if (window.showToast) window.showToast('已取消长按绘制', 'info');
                } else {
                    // 在同轨道上抬起（未拖动），确认放置最小长度 hold
                    this._holdDrawing = false;
                    this._holdDragging = false;
                    const note = this._addNote({
                        type: 'hold',
                        time: this._holdHead.time,
                        endTime: this._holdHead.time + 0.05,
                        track: this._holdHead.track,
                    });
                    this.selectNote(note);
                    this._removeHoldPreview();
                }
            } else {
                this._holdDrawing = false;
                this._removeHoldPreview();
            }
            this._pointerDown = false;
            this._hasMoved = false;
            if (this.touchIndicator) this.touchIndicator.style.display = 'none';
            return;
        }

        // 判定为短按点击（移动小、时间短、未触发长按）
        if (!this._hasMoved && dist < 10 && !this._longPressTriggered) {
            const x = this._downX;
            const y = this._downY;
            const mode = ce.state.editorMode || 'place';
            const hitNote = this._hitNoteAt(this._pointerStartX, this._pointerStartY);

            if (mode === 'select') {
                if (hitNote) {
                    if (ce.state.selectedNotes.length > 1) {
                        // 多选模式：toggle 选中状态
                        this.toggleNoteSelection(hitNote);
                    } else {
                        // 单选模式：单选该音符
                        this.selectNote(hitNote);
                    }
                } else {
                    // 点击空白处：退出多选模式
                    if (ce.state.selectedNotes.length > 1) {
                        this._exitMultiSelectMode();
                    } else {
                        this.deselectAll();
                    }
                }
            } else if (mode === 'delete') {
                if (hitNote) {
                    this._deleteNote(hitNote);
                    if (window.showToast) window.showToast('已删除音符', 'info');
                }
            } else {
                // 放置模式
                if (!hitNote) {
                    const trackIdx = this._getTrackFromX(x);
                    const snap = ce.state.snap;
                    if (trackIdx !== -1) {
                        if (snap === 0) {
                            this._placeNoteAt(y, trackIdx, ce);
                        } else {
                            const hit = this._hitSnapPoint(x, y);
                            if (hit) {
                                this._placeNoteAt(hit.y, trackIdx, ce);
                            }
                        }
                    }
                }
            }
        }

        this._pointerDown = false;
        this._hasMoved = false;
        this._longPressTriggered = false;

        if (this.touchIndicator) {
            this.touchIndicator.style.display = 'none';
        }
    },

    _startDrag(startClientY) {
        const ce = window.ChartEditor;
        if (!ce) return;
        this._dragging = true;
        this._dragStartY = startClientY;
        this._dragStartTime = ce.state.currentTime;
        this._lastDragTime = ce.state.currentTime;
        this.container.style.cursor = 'grabbing';
        if (ce.state.playing) {
            ce.pause();
            this._wasPlaying = true;
        } else {
            this._wasPlaying = false;
        }
    },

    _onLongPress() {
        const ce = window.ChartEditor;
        if (!ce || !this._pointerDown) return;

        // 只在放置模式下触发 hold 绘制
        if (ce.state.editorMode !== 'place') return;

        if (ce.state.noteType === 'hold') {
            // 使用 _downX/Y（按下时计算的容器坐标），避免移动端地址栏变化导致 rect 漂移
            const x = this._downX;
            const y = this._downY;
            const trackIdx = this._getTrackFromX(x);

            if (trackIdx !== -1) {
                const time = this._yToTime(y);
                const snappedTime = this._snapTime(time);
                this._holdDrawing = true;
                this._holdDragging = false;
                this._holdHead = { time: snappedTime, track: trackIdx };
                this._holdTailTime = snappedTime + 0.05;
                this._createHoldPreview();
                this._updateHoldPreview();
                if (window.showToast) window.showToast('长按放置头部，拖动确定终点', 'info');
            }
        }
    },

    _clearLongPressTimer() {
        if (this._longPressTimer) {
            clearTimeout(this._longPressTimer);
            this._longPressTimer = null;
        }
    },

    _hitNoteAt(clientX, clientY) {
        const rect = this.container.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const ce = window.ChartEditor;
        if (!ce) return null;

        const currentTime = ce.state.currentTime || 0;
        const hitTrackCount = ce.getTrackCountAtTime(currentTime);
        const colCount = hitTrackCount + 1;
        const colWidth = this.container.clientWidth / colCount;

        // 优先返回选中音符（解决复制后重叠音符命中问题）
        const selectedIds = new Set((ce.state.selectedNotes || []).map(n => n.id));
        for (const note of ce.state.notes) {
            if (!selectedIds.has(note.id)) continue;
            const noteX = (note.track + 1) * colWidth;
            if (note.type === 'hold') {
                const headY = this.judgeOffset - (note.time - currentTime) * this.pps;
                const tailY = this.judgeOffset - (note.endTime - currentTime) * this.pps;
                const holdHeight = Math.max(headY - tailY, 4);
                const left = noteX - 6, right = noteX + 6;
                const top = headY - holdHeight, bottom = headY;
                if (x >= left && x <= right && y >= top && y <= bottom) return note;
            } else if (note.type === 'tap') {
                const headY = this.judgeOffset - (note.time - currentTime) * this.pps;
                if (Math.abs(x - noteX) <= 8 && Math.abs(y - headY) <= 8) return note;
            } else if (note.type === 'switch') {
                const headY = this.judgeOffset - (note.time - currentTime) * this.pps;
                if (Math.abs(x - noteX) <= 12 && Math.abs(y - headY) <= 12) return note;
            }
        }

        // 再遍历所有音符
        for (const note of ce.state.notes) {
            const noteX = (note.track + 1) * colWidth;
            if (note.type === 'hold') {
                const headY = this.judgeOffset - (note.time - currentTime) * this.pps;
                const tailY = this.judgeOffset - (note.endTime - currentTime) * this.pps;
                const holdHeight = Math.max(headY - tailY, 4);
                const left = noteX - 6, right = noteX + 6;
                const top = headY - holdHeight, bottom = headY;
                if (x >= left && x <= right && y >= top && y <= bottom) return note;
            } else if (note.type === 'tap') {
                const headY = this.judgeOffset - (note.time - currentTime) * this.pps;
                if (Math.abs(x - noteX) <= 8 && Math.abs(y - headY) <= 8) return note;
            } else if (note.type === 'switch') {
                const headY = this.judgeOffset - (note.time - currentTime) * this.pps;
                if (Math.abs(x - noteX) <= 12 && Math.abs(y - headY) <= 12) return note;
            }
        }
        return null;
    },

    _isPointOnNote(note, x, y) {
        const ce = window.ChartEditor;
        if (!ce) return false;
        const noteTrackCount = ce.getTrackCountAtTime(note.time);
        const colCount = noteTrackCount + 1;
        const colWidth = this.container.clientWidth / colCount;
        const currentTime = ce.state.currentTime || 0;
        const noteX = (note.track + 1) * colWidth;

        if (note.type === 'hold') {
            const headY = this.judgeOffset - (note.time - currentTime) * this.pps;
            const tailY = this.judgeOffset - (note.endTime - currentTime) * this.pps;
            const holdHeight = Math.max(headY - tailY, 4);
            return x >= noteX - 6 && x <= noteX + 6 && y >= headY - holdHeight && y <= headY;
        } else if (note.type === 'tap') {
            const headY = this.judgeOffset - (note.time - currentTime) * this.pps;
            return Math.abs(x - noteX) <= 8 && Math.abs(y - headY) <= 8;
        } else if (note.type === 'switch') {
            const headY = this.judgeOffset - (note.time - currentTime) * this.pps;
            return Math.abs(x - noteX) <= 12 && Math.abs(y - headY) <= 12;
        }
        return false;
    },

    _placeNoteAt(y, trackIdx, ce) {
        const time = this._yToTime(y);
        const snappedTime = this._snapTime(time);

        // 同步活跃轨道
        ce.state.activeTrack = trackIdx;

        if (ce.state.noteType === 'tap') {
            const note = this._addNote({
                type: 'tap',
                time: snappedTime,
                track: trackIdx,
            });
            this.selectNote(note);
        } else if (ce.state.noteType === 'hold') {
            // hold 模式下短按不直接放置，由长按定时器触发
            // 这里不做任何事，等待长按或第二次点击
        } else if (ce.state.noteType === 'switch') {
            const currentCount = ce.getTrackCountAtTime(snappedTime);
            const defaultTarget = currentCount === 3 ? 4 : 3;
            const note = this._addNote({
                type: 'switch',
                time: snappedTime,
                track: trackIdx,
                targetTrackCount: defaultTarget,
            });
            ce.adjustNotesAfterSwitch(note);
            this.selectNote(note);
        }
    },

    // ===== 辅助方法 =====
    _getTrackFromX(x, time) {
        const ce = window.ChartEditor;
        if (!ce) return -1;
        const trackCount = time !== undefined
            ? ce.getTrackCountAtTime(time)
            : ce.getTrackCountAtTime(ce.state.currentTime || 0);
        const colCount = trackCount + 1;
        const colWidth = this.container.clientWidth / colCount;

        // 每条轨道线周围 ±15px 的命中区域
        for (let i = 0; i < trackCount; i++) {
            const lineX = (i + 1) * colWidth;
            if (Math.abs(x - lineX) <= 20) {
                return i;
            }
        }
        return -1;
    },

    _hitSnapPoint(x, y) {
        // 判断点击位置是否命中吸附点（轨道线与拍子线的交点）
        const state = window.ChartEditor ? window.ChartEditor.state : null;
        if (!state) return null;
        const snap = state.snap;
        if (snap === 0) return null;

        const trackCount = window.ChartEditor
            ? window.ChartEditor.getTrackCountAtTime(state.currentTime || 0)
            : 3;
        const colCount = trackCount + 1;
        const colWidth = this.container.clientWidth / colCount;
        const bpm = state.bpm || 120;
        const beatDuration = 60 / bpm;
        const snapInterval = beatDuration / snap;
        const currentTime = state.currentTime || 0;

        // 计算最近的吸附点时间
        const timeAtY = this._yToTime(y);
        const snappedTime = Math.round(timeAtY / snapInterval) * snapInterval;
        const snappedY = this.judgeOffset - (snappedTime - currentTime) * this.pps;

        // 检查是否命中任意轨道的吸附点（±15px）
        for (let i = 0; i < trackCount; i++) {
            const lineX = (i + 1) * colWidth;
            const dx = Math.abs(x - lineX);
            const dy = Math.abs(y - snappedY);
            if (dx <= 20 && dy <= 15) {
                return { track: i, time: snappedTime, y: snappedY };
            }
        }
        return null;
    },

    _yToTime(y) {
        // y 是容器内的像素坐标
        // 判定线在 judgeOffset，对应 currentTime
        // 上方（y 小）= 未来时间，下方（y 大）= 过去时间
        const ce = window.ChartEditor;
        const currentTime = ce ? ce.state.currentTime : 0;
        const deltaY = this.judgeOffset - y;
        return currentTime + deltaY / this.pps;
    },

    _snapTime(time) {
        const ce = window.ChartEditor;
        if (!ce) return time;
        const snap = ce.state.snap;
        if (snap === 0) return Math.max(0, time);
        const bpm = ce.state.bpm || 120;
        const beatDuration = 60 / bpm;
        const snapInterval = beatDuration / snap;
        const snapped = Math.round(time / snapInterval) * snapInterval;
        return Math.max(0, snapped);
    },

    _addNote(noteData) {
        const ce = window.ChartEditor;
        if (!ce) return null;
        const note = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            ...noteData,
        };
        ce.state.notes.push(note);
        ce.state.notes.sort((a, b) => a.time - b.time);
        ce.pushHistory();
        this.render();
        ce.updateStatus();
        if (window.showToast) {
            const typeName = note.type === 'tap' ? '单点' : note.type === 'hold' ? '长按' : '变轨(' + (note.targetTrackCount || '?') + ')';
            window.showToast('已放置 ' + typeName, 'success');
        }
        return note;
    },

    selectNote(note) {
        const ce = window.ChartEditor;
        if (!ce) return;
        ce.state.selectedNotes = [note];
        ce.state.activeTrack = note.track;
        if (window.EditorPanels) {
            window.EditorPanels.refreshPropertyPanel();
            window.EditorPanels.refreshTrackInfo();
        }
        this.render();
    },

    toggleNoteSelection(note) {
        const ce = window.ChartEditor;
        if (!ce) return;
        const idx = ce.state.selectedNotes.indexOf(note);
        if (idx >= 0) {
            ce.state.selectedNotes.splice(idx, 1);
            if (ce.state.selectedNotes.length === 0) {
                this._exitMultiSelectMode();
            }
        } else {
            ce.state.selectedNotes.push(note);
            this._enterMultiSelectMode();
        }
        ce.state.activeTrack = note.track;
        if (window.EditorPanels) {
            window.EditorPanels.refreshPropertyPanel();
            window.EditorPanels.refreshTrackInfo();
        }
        this.render();
    },

    _enterMultiSelectMode() {
        const ce = window.ChartEditor;
        if (!ce) return;
        if (ce.state.selectedNotes.length < 2) return;
        this._showMultiSelectToast();
    },

    _exitMultiSelectMode() {
        const ce = window.ChartEditor;
        if (!ce) return;
        ce.state.selectedNotes = [];
        if (this._multiSelectToast) {
            this._multiSelectToast.remove();
            this._multiSelectToast = null;
        }
        if (window.EditorPanels) window.EditorPanels.refreshPropertyPanel();
        this.render();
    },

    _showMultiSelectToast() {
        if (this._multiSelectToast) return;
        const toast = document.createElement('div');
        toast.className = 'multi-select-toast';
        toast.innerHTML = `
            <div class="mst-content">
                <span class="mst-icon">✓</span>
                <span class="mst-text">多选模式：点击音符添加/移除，框选批量添加，拖动移动</span>
                <button class="mst-close">✕</button>
            </div>
        `;
        document.body.appendChild(toast);
        this._multiSelectToast = toast;

        toast.querySelector('.mst-close').addEventListener('click', () => {
            toast.remove();
            this._multiSelectToast = null;
        });

        // 5秒后自动消失
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.opacity = '0';
                setTimeout(() => {
                    if (toast.parentNode) toast.remove();
                    if (this._multiSelectToast === toast) this._multiSelectToast = null;
                }, 300);
            }
        }, 5000);
    },

    deselectAll() {
        const ce = window.ChartEditor;
        if (!ce) return;
        ce.state.selectedNotes = [];
        if (this._multiSelectToast) {
            this._multiSelectToast.remove();
            this._multiSelectToast = null;
        }
        if (window.EditorPanels) window.EditorPanels.refreshPropertyPanel();
        this.render();
    },

    _deleteNote(note) {
        const ce = window.ChartEditor;
        if (!ce) return;
        const idx = ce.state.notes.indexOf(note);
        if (idx === -1) return;
        ce.state.notes.splice(idx, 1);
        if (ce.state.selectedNotes && ce.state.selectedNotes.includes(note)) {
            const sidx = ce.state.selectedNotes.indexOf(note);
            if (sidx >= 0) ce.state.selectedNotes.splice(sidx, 1);
            if (ce.state.selectedNotes.length === 0) {
                if (this._multiSelectToast) {
                    this._multiSelectToast.remove();
                    this._multiSelectToast = null;
                }
            }
        }
        ce.state.activeTrack = note.track;
        this.render();
        ce.updateStatus();
        ce.pushHistory();
        if (window.EditorPanels) {
            window.EditorPanels.refreshPropertyPanel();
            window.EditorPanels.refreshTrackInfo();
        }
    },

    deleteSelected() {
        const ce = window.ChartEditor;
        if (!ce || !ce.state.selectedNotes.length) return;
        const ids = new Set(ce.state.selectedNotes.map(n => n.id));
        ce.state.notes = ce.state.notes.filter(n => !ids.has(n.id));
        ce.state.selectedNotes = [];
        if (this._multiSelectToast) {
            this._multiSelectToast.remove();
            this._multiSelectToast = null;
        }
        ce.pushHistory();
        this.render();
        ce.updateStatus();
        if (window.EditorPanels) window.EditorPanels.refreshPropertyPanel();
        if (window.showToast) window.showToast('已删除选中音符', 'success');
    },

    copySelected() {
        const ce = window.ChartEditor;
        if (!ce || !ce.state.selectedNotes.length) return;
        const newNotes = ce.state.selectedNotes.map(note => ({
            id: Date.now() + Math.floor(Math.random() * 1000),
            type: note.type,
            time: note.time,
            track: note.track,
            _breathing: localStorage.getItem('muse-editor-breathe-anim') !== 'false',
            ...(note.endTime !== undefined ? { endTime: note.endTime } : {}),
            ...(note.targetTrackCount !== undefined ? { targetTrackCount: note.targetTrackCount } : {}),
        }));
        ce.state.notes.push(...newNotes);
        ce.state.notes.sort((a, b) => a.time - b.time);
        ce.state.selectedNotes = newNotes;
        this._enterMultiSelectMode();
        ce.pushHistory();
        this.render();
        ce.updateStatus();
        if (window.EditorPanels) window.EditorPanels.refreshPropertyPanel();
        if (window.showToast) window.showToast('已复制 ' + newNotes.length + ' 个音符', 'success');
    },

    moveSelected(deltaTime, deltaTrack) {
        const ce = window.ChartEditor;
        if (!ce || !ce.state.selectedNotes.length) return;
        let hasChange = false;
        for (const note of ce.state.selectedNotes) {
            const noteTrackCount = ce.getTrackCountAtTime(note.time);
            const newTime = Math.max(0, note.time + deltaTime);
            const newTrack = Math.max(0, Math.min(noteTrackCount - 1, note.track + deltaTrack));
            if (newTime !== note.time || newTrack !== note.track) {
                note.time = newTime;
                note.track = newTrack;
                if (note.endTime !== undefined) {
                    note.endTime = Math.max(newTime + 0.05, note.endTime + deltaTime);
                }
                hasChange = true;
            }
        }
        if (hasChange) {
            ce.state.notes.sort((a, b) => a.time - b.time);
            ce.pushHistory();
            this.render();
            ce.updateStatus();
            if (window.EditorPanels) window.EditorPanels.refreshPropertyPanel();
        }
    },



    render() {
        if (!this.container) return;

        const state = window.ChartEditor ? window.ChartEditor.state : null;
        if (!state) return;

        const height = this.container.clientHeight;
        const width = this.container.clientWidth;
        if (width === 0 || height === 0) return;

        // 判定线位置：距底部 1/4 处（偏下，给上方更多视野）
        this.judgeOffset = Math.floor(height * 0.75);
        if (this.judgeLine) {
            this.judgeLine.style.top = this.judgeOffset + 'px';
        }

        // 计算实际像素速度
        const zoom = state.zoom || 1.0;
        this.pps = 200 * zoom;

        // 清空并重绘
        this.worldLayer.innerHTML = '';
        this.trackOverlay.innerHTML = '';

        // 重新创建 trackLinesLayer（worldLayer 的子层，放分段轨道竖线+时区背景，随滚动移动）
        this.trackLinesLayer = document.createElement('div');
        this.trackLinesLayer.className = 'track-lines-layer';
        this.trackLinesLayer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none;overflow:visible;';
        this.worldLayer.appendChild(this.trackLinesLayer);

        // 重新创建 switchLineLayer（worldLayer 的子层，放变轨分隔线，随滚动移动）
        this.switchLineLayer = document.createElement('div');
        this.switchLineLayer.className = 'switch-line-layer';
        this.switchLineLayer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:2;pointer-events:none;overflow:visible;';
        this.worldLayer.appendChild(this.switchLineLayer);

        this.renderBeatGrid(state, width, height);
        this.renderTracks(state, width, height);
        this.renderNotes(state, width, height);
        this.updateScroll(state.currentTime || 0);
    },

    updateScroll(currentTime) {
        if (!this.worldLayer) return;
        const offset = currentTime * this.pps;
        this.worldLayer.style.transform = `translateY(${offset}px)`;
        if (this.previewLayer) {
            this.previewLayer.style.transform = `translateY(${offset}px)`;
        }
    },

    tick(currentTime) {
        // 只更新 transform，不触发重绘，避免播放卡顿
        this.updateScroll(currentTime);
    },

    // ===== Hold 实时预览 =====
    _createHoldPreview() {
        if (this._holdPreviewEl) this._removeHoldPreview();
        this._holdPreviewEl = document.createElement('div');
        this._holdPreviewEl.className = 'timeline-note hold-preview';
        this._holdPreviewEl.style.cssText = `
            position: absolute;
            left: 0;
            width: 12px;
            border-radius: 6px;
            background: rgba(48, 209, 88, 0.4);
            outline: 2px dashed rgba(48, 209, 88, 0.8);
            pointer-events: none;
            z-index: 15;
        `;
        // 头部圆点（在条底部，即按压位置）
        const head = document.createElement('div');
        head.style.cssText = `
            position: absolute;
            bottom: -7px;
            left: -2px;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: rgba(48, 209, 88, 0.6);
            border: 2px solid rgba(48, 209, 88, 0.9);
            pointer-events: none;
        `;
        this._holdPreviewEl.appendChild(head);
        // 尾部圆点（在条顶部，即松开位置）
        const tail = document.createElement('div');
        tail.style.cssText = `
            position: absolute;
            top: -7px;
            left: -2px;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: rgba(48, 209, 88, 0.6);
            border: 2px solid rgba(48, 209, 88, 0.9);
            pointer-events: none;
        `;
        this._holdPreviewEl.appendChild(tail);
        if (this.previewLayer) {
            this.previewLayer.appendChild(this._holdPreviewEl);
        }
    },

    _updateHoldPreview() {
        if (!this._holdPreviewEl || !this._holdHead) return;
        const ce = window.ChartEditor;
        if (!ce) return;
        // 使用绝对时间坐标（配合 previewLayer 的 transform 滚动）
        const y = this.judgeOffset - this._holdHead.time * this.pps;
        const tailY = this.judgeOffset - this._holdTailTime * this.pps;
        const holdHeight = Math.max(y - tailY, 4);

        const holdTrackCount = ce.getTrackCountAtTime(this._holdHead.time);
        const colCount = holdTrackCount + 1;
        const colWidth = this.container.clientWidth / colCount;
        const x = (this._holdHead.track + 1) * colWidth;

        this._holdPreviewEl.style.top = tailY + 'px';
        this._holdPreviewEl.style.left = (x - 6) + 'px';
        this._holdPreviewEl.style.height = holdHeight + 'px';
    },

    _removeHoldPreview() {
        if (this._holdPreviewEl) {
            this._holdPreviewEl.remove();
            this._holdPreviewEl = null;
        }
    },

    // ===== 音符拖动 =====
    _startNoteDrag(hitNote, x, y) {
        const ce = window.ChartEditor;
        if (!ce) return;
        this._isNoteDragging = true;
        this._dragNoteHit = hitNote;
        this._dragNoteStartX = x;
        this._dragNoteStartY = y;
        this._dragDeltaTime = 0;
        this._dragDeltaTrack = 0;
        this._dragOriginalNotes = ce.state.selectedNotes.map(n => ({
            id: n.id,
            time: n.time,
            track: n.track,
            endTime: n.endTime,
        }));
        this._createDragPreview();
    },

    _updateNoteDrag(x, y) {
        if (!this._isNoteDragging) return;
        const ce = window.ChartEditor;
        if (!ce) return;
        const currentTime = ce.state.currentTime || 0;
        const trackCount = ce.getTrackCountAtTime(currentTime);
        const colCount = trackCount + 1;
        const colWidth = this.container.clientWidth / colCount;

        const startTrack = Math.round((this._dragNoteStartX / colWidth) - 1);
        const currentTrack = Math.round((x / colWidth) - 1);
        let deltaTrack = currentTrack - startTrack;
        deltaTrack = Math.max(-trackCount + 1, Math.min(trackCount - 1, deltaTrack));

        const deltaY = y - this._dragNoteStartY;
        const deltaTime = -deltaY / this.pps;

        this._dragDeltaTime = deltaTime;
        this._dragDeltaTrack = deltaTrack;

        this._updateDragPreview();
    },

    _endNoteDrag() {
        if (!this._isNoteDragging) return;
        const ce = window.ChartEditor;
        if (!ce) return;

        this._isNoteDragging = false;
        this._clearDragPreview();

        let hasChange = false;
        let isOverlap = false;

        const newPositions = this._dragOriginalNotes.map(orig => {
            const newTime = Math.max(0, this._snapTime(orig.time + this._dragDeltaTime));
            const noteTrackCount = ce.getTrackCountAtTime(newTime);
            const newTrack = Math.max(0, Math.min(noteTrackCount - 1, orig.track + this._dragDeltaTrack));
            return {
                id: orig.id,
                time: newTime,
                track: newTrack,
                endTime: orig.endTime ? Math.max(newTime + 0.05, orig.endTime + this._dragDeltaTime) : undefined
            };
        });

        const selectedIds = new Set(ce.state.selectedNotes.map(n => n.id));
        for (const pos of newPositions) {
            for (const note of ce.state.notes) {
                if (selectedIds.has(note.id)) continue;
                if (note.track === pos.track && Math.abs(note.time - pos.time) < 0.001) {
                    isOverlap = true;
                    break;
                }
            }
            if (isOverlap) break;
        }

        if (isOverlap) {
            if (window.showToast) window.showToast('放置位置与其他音符重叠', 'warning');
            this.render();
            return;
        }

        for (let i = 0; i < ce.state.selectedNotes.length; i++) {
            const note = ce.state.selectedNotes[i];
            const orig = this._dragOriginalNotes[i];
            const newTime = Math.max(0, this._snapTime(orig.time + this._dragDeltaTime));
            const noteTrackCount = ce.getTrackCountAtTime(newTime);
            const newTrack = Math.max(0, Math.min(noteTrackCount - 1, orig.track + this._dragDeltaTrack));
            if (note.time !== newTime || note.track !== newTrack) {
                note.time = newTime;
                note.track = newTrack;
                if (note.endTime !== undefined) {
                    note.endTime = Math.max(newTime + 0.05, orig.endTime + this._dragDeltaTime);
                }
                hasChange = true;
            }
        }

        if (hasChange) {
            // 清除呼吸动画标记
            for (const note of ce.state.selectedNotes) {
                delete note._breathing;
            }
            ce.state.notes.sort((a, b) => a.time - b.time);
            ce.pushHistory();
            this.render();
            ce.updateStatus();
            if (window.EditorPanels) window.EditorPanels.refreshPropertyPanel();
            if (window.showToast) window.showToast('已移动音符', 'success');
        }

        this._dragOriginalNotes = null;
    },

    _createDragPreview() {
        if (!this.dragPreviewLayer) return;
        this.dragPreviewLayer.innerHTML = '';
        // 同步 worldLayer 的 transform，确保预览与音符对齐
        this.dragPreviewLayer.style.transform = this.worldLayer.style.transform || '';
        const ce = window.ChartEditor;
        if (!ce) return;
        const currentTime = ce.state.currentTime || 0;
        const trackCount = ce.getTrackCountAtTime(currentTime);
        const colCount = trackCount + 1;
        const colWidth = this.container.clientWidth / colCount;

        ce.state.selectedNotes.forEach(note => {
            const y = this.judgeOffset - note.time * this.pps;
            const x = (note.track + 1) * colWidth;
            const el = document.createElement('div');
            el.className = 'drag-preview-note';
            el.dataset.noteId = note.id;

            if (note.type === 'tap') {
                el.style.cssText = `
                    position: absolute;
                    top: ${y - 8}px;
                    left: ${x - 8}px;
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    background: rgba(48, 209, 88, 0.5);
                    border: 2px dashed rgba(48, 209, 88, 0.8);
                    pointer-events: none;
                    z-index: 15;
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
                    background: rgba(48, 209, 88, 0.3);
                    border: 2px dashed rgba(48, 209, 88, 0.7);
                    pointer-events: none;
                    z-index: 15;
                `;
            } else if (note.type === 'switch') {
                el.style.cssText = `
                    position: absolute;
                    top: ${y - 12}px;
                    left: ${x - 12}px;
                    width: 24px;
                    height: 24px;
                    border-radius: 6px;
                    background: rgba(255, 149, 0, 0.4);
                    border: 2px dashed rgba(255, 149, 0, 0.8);
                    pointer-events: none;
                    z-index: 15;
                `;
            }
            this.dragPreviewLayer.appendChild(el);
        });
    },

    _updateDragPreview() {
        if (!this.dragPreviewLayer) return;
        // 同步 worldLayer 的 transform
        this.dragPreviewLayer.style.transform = this.worldLayer.style.transform || '';
        const ce = window.ChartEditor;
        if (!ce || !this._dragOriginalNotes) return;
        const currentTime = ce.state.currentTime || 0;
        const trackCount = ce.getTrackCountAtTime(currentTime);
        const colCount = trackCount + 1;
        const colWidth = this.container.clientWidth / colCount;

        const els = this.dragPreviewLayer.children;
        for (let i = 0; i < els.length && i < this._dragOriginalNotes.length; i++) {
            const el = els[i];
            const orig = this._dragOriginalNotes[i];
            const newTrack = Math.max(0, Math.min(trackCount - 1, orig.track + this._dragDeltaTrack));
            const newTime = Math.max(0, orig.time + this._dragDeltaTime);
            const x = (newTrack + 1) * colWidth;
            const y = this.judgeOffset - newTime * this.pps;

            if (orig.endTime !== undefined) {
                // hold长度不变，只整体偏移
                const holdHeight = Math.max((orig.endTime - orig.time) * this.pps, 4);
                el.style.left = (x - 6) + 'px';
                el.style.top = (y - holdHeight) + 'px';
            } else {
                el.style.left = (x - 8) + 'px';
                el.style.top = (y - 8) + 'px';
            }
        }
    },

    _clearDragPreview() {
        if (this.dragPreviewLayer) this.dragPreviewLayer.innerHTML = '';
    },

    // ===== 框选功能 =====
    _startMarquee(x, y) {
        this._isMarqueeSelecting = true;
        this._marqueeStartX = x;
        this._marqueeStartY = y;
        if (!this._marqueeEl) {
            this._marqueeEl = document.createElement('div');
            this._marqueeEl.className = 'marquee-rect';
        }
        this._marqueeEl.style.cssText = `
            position:absolute;
            left:${x}px;top:${y}px;width:0;height:0;
            border:1px dashed var(--accent-primary);
            background:rgba(10,132,255,0.1);
            z-index:8;pointer-events:none;
        `;
        if (this.marqueeLayer) {
            this.marqueeLayer.innerHTML = '';
            this.marqueeLayer.appendChild(this._marqueeEl);
        }
    },

    _updateMarquee(x, y) {
        if (!this._marqueeEl) return;
        const left = Math.min(this._marqueeStartX, x);
        const top = Math.min(this._marqueeStartY, y);
        const width = Math.abs(x - this._marqueeStartX);
        const height = Math.abs(y - this._marqueeStartY);
        this._marqueeEl.style.left = left + 'px';
        this._marqueeEl.style.top = top + 'px';
        this._marqueeEl.style.width = width + 'px';
        this._marqueeEl.style.height = height + 'px';
    },

    _endMarquee() {
        this._isMarqueeSelecting = false;
        if (this._marqueeEl) {
            this._marqueeEl.style.width = '0';
            this._marqueeEl.style.height = '0';
        }
        if (this.marqueeLayer) this.marqueeLayer.innerHTML = '';

        const ce = window.ChartEditor;
        if (!ce) return;

        // 计算框选矩形（容器坐标）
        const rect = this.container.getBoundingClientRect();
        const mx = Math.min(this._marqueeStartX, this._lastMoveX || this._marqueeStartX);
        const my = Math.min(this._marqueeStartY, this._lastMoveY || this._marqueeStartY);
        const mw = Math.abs((this._lastMoveX || this._marqueeStartX) - this._marqueeStartX);
        const mh = Math.abs((this._lastMoveY || this._marqueeStartY) - this._marqueeStartY);

        if (mw < 5 || mh < 5) return; // 框选区域太小，忽略

        const currentTime = ce.state.currentTime || 0;
        const trackCount = ce.getTrackCountAtTime(currentTime);
        const colCount = trackCount + 1;
        const colWidth = this.container.clientWidth / colCount;
        const selected = new Set(ce.state.selectedNotes.map(n => n.id));
        let addedCount = 0;

        for (const note of ce.state.notes) {
            const noteX = (note.track + 1) * colWidth;
            let noteY;
            if (note.type === 'hold') {
                const headY = this.judgeOffset - (note.time - currentTime) * this.pps;
                const tailY = this.judgeOffset - (note.endTime - currentTime) * this.pps;
                noteY = (headY + tailY) / 2; // 用中心点判断
            } else {
                noteY = this.judgeOffset - (note.time - currentTime) * this.pps;
            }

            // 检查音符中心是否在框选矩形内
            if (noteX >= mx && noteX <= mx + mw && noteY >= my && noteY <= my + mh) {
                if (!selected.has(note.id)) {
                    ce.state.selectedNotes.push(note);
                    addedCount++;
                }
            }
        }

        if (addedCount > 0) {
            this._enterMultiSelectMode();
            if (window.EditorPanels) {
                window.EditorPanels.refreshPropertyPanel();
                window.EditorPanels.refreshTrackInfo();
            }
            this.render();
            if (window.showToast) window.showToast('框选添加了 ' + addedCount + ' 个音符', 'success');
        }
    }
};

window.EditorTimeline = EditorTimeline;
