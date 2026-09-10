/**
 * editor/minimap.js — 谱面密度横条（Minimap）
 * 显示整个谱面音符密集程度，支持拖动/点击跳转
 */

const EditorMinimap = {
    container: null,
    canvas: null,
    ctx: null,
    cursor: null,

    // 配置（从 localStorage 读取）
    get enabled() { return localStorage.getItem('muse-editor-minimap') !== 'false'; },
    get seekEnabled() { return localStorage.getItem('muse-editor-minimap-seek') !== 'false'; },
    get seekDrag() { return localStorage.getItem('muse-editor-minimap-seek-drag') !== 'false'; },
    get seekClick() { return localStorage.getItem('muse-editor-minimap-seek-click') !== 'false'; },

    _dragging: false,
    _segments: 200,       // 密度分段数
    _densityData: [],     // 缓存的密度数据
    _lastNotesHash: '',   // 用于判断是否需要重新计算
    _needsRedraw: true,

    init() {
        const footer = document.getElementById('editor-footer');
        if (!footer) return;

        // 创建 minimap 容器
        const wrap = document.createElement('div');
        wrap.className = 'editor-minimap-wrap';
        wrap.id = 'editor-minimap-wrap';

        // Canvas 绘制密度图
        const canvas = document.createElement('canvas');
        canvas.className = 'editor-minimap-canvas';
        canvas.id = 'editor-minimap-canvas';
        wrap.appendChild(canvas);

        // 红色竖线光标
        const cursor = document.createElement('div');
        cursor.className = 'editor-minimap-cursor';
        cursor.id = 'editor-minimap-cursor';
        wrap.appendChild(cursor);

        // 插入到 footer 中（在 zoom 和 切换按钮之间）
        const zoomEl = document.getElementById('ed-status-zoom');
        if (zoomEl && zoomEl.nextSibling) {
            footer.insertBefore(wrap, zoomEl.nextSibling);
        } else {
            footer.appendChild(wrap);
        }

        this.container = wrap;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.cursor = cursor;

        this.bindEvents();
        this.updateVisibility();

        // 初始绘制
        this._resizeCanvas();
        this.updateDensity();
        this.updateCursor();
    },

    bindEvents() {
        if (!this.container) return;

        // 点击跳转
        this.container.addEventListener('click', (e) => {
            if (!this.enabled || !this.seekEnabled || !this.seekClick) return;
            if (this._dragging) return; // 拖动结束时也会触发 click，跳过
            this._seekToEvent(e);
        });

        // 拖动跳转
        this.container.addEventListener('mousedown', (e) => {
            if (!this.enabled || !this.seekEnabled || !this.seekDrag) return;
            if (e.button !== 0) return;
            this._dragging = true;
            this._seekToEvent(e);
            this.container.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!this._dragging) return;
            if (!this.enabled || !this.seekEnabled || !this.seekDrag) return;
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            this._seekToX(x);
        });

        document.addEventListener('mouseup', () => {
            if (this._dragging) {
                this._dragging = false;
                if (this.container) this.container.style.cursor = '';
            }
        });

        // 触摸支持
        this.container.addEventListener('touchstart', (e) => {
            if (!this.enabled || !this.seekEnabled || !this.seekDrag) return;
            this._dragging = true;
            const touch = e.touches[0];
            const rect = this.canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            this._seekToX(x);
        }, { passive: true });

        this.container.addEventListener('touchmove', (e) => {
            if (!this._dragging) return;
            if (!this.enabled || !this.seekEnabled || !this.seekDrag) return;
            const touch = e.touches[0];
            const rect = this.canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            this._seekToX(x);
        }, { passive: true });

        this.container.addEventListener('touchend', () => {
            this._dragging = false;
        });

        // 窗口大小变化时重绘
        window.addEventListener('resize', () => {
            this._resizeCanvas();
            this._needsRedraw = true;
            this.updateDensity();
            this.updateCursor();
        });
    },

    _seekToEvent(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        this._seekToX(x);
    },

    _seekToX(x) {
        const ce = window.ChartEditor;
        if (!ce) return;
        const width = this.canvas.width;
        if (width <= 0) return;

        const ratio = Math.max(0, Math.min(1, x / width));
        const duration = ce.state.duration || 1;
        const targetTime = ratio * duration;

        // 更新编辑器状态
        ce.state.currentTime = targetTime;
        ce.audioOffset = targetTime;

        // 如果正在播放，从新的位置继续
        if (ce.state.playing && ce.sourceNode) {
            try { ce.sourceNode.stop(); } catch(e) {}
            ce.sourceNode = null;
            ce.audioOffset = targetTime;
            ce.play();
        }

        ce.updateStatus();
        if (window.EditorTimeline) {
            window.EditorTimeline.updateScroll(targetTime);
        }
        this.updateCursor();
    },

    _resizeCanvas() {
        if (!this.canvas || !this.container) return;
        const rect = this.container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
    },

    updateVisibility() {
        if (!this.container) return;
        this.container.style.display = this.enabled ? '' : 'none';
    },

    // 计算密度数据
    updateDensity() {
        if (!this.enabled || !this.canvas) return;

        const ce = window.ChartEditor;
        if (!ce) return;

        const notes = ce.state.notes || [];
        const duration = ce.state.duration || 0;

        // 生成 notes 的 hash 来判断是否需要重新计算
        const hash = notes.length + '_' + (notes[0]?.time || 0) + '_' + (notes[notes.length-1]?.time || 0);
        if (hash === this._lastNotesHash && !this._needsRedraw) {
            this.updateCursor();
            return;
        }
        this._lastNotesHash = hash;
        this._needsRedraw = false;

        const segs = this._segments;
        const density = new Array(segs).fill(0);

        if (duration > 0 && notes.length > 0) {
            notes.forEach(note => {
                const t = note.time || 0;
                const idx = Math.min(segs - 1, Math.floor((t / duration) * segs));
                density[idx]++;

                // hold 音符覆盖的区间也增加密度
                if (note.type === 'hold' && note.endTime) {
                    const startIdx = idx;
                    const endIdx = Math.min(segs - 1, Math.floor((note.endTime / duration) * segs));
                    for (let i = startIdx; i <= endIdx; i++) {
                        density[i] += 0.5;
                    }
                }
            });
        }

        this._densityData = density;
        this._drawDensity();
        this.updateCursor();
    },

    _drawDensity() {
        if (!this.ctx || !this.canvas) return;
        const width = this.canvas.width / (window.devicePixelRatio || 1);
        const height = this.canvas.height / (window.devicePixelRatio || 1);

        this.ctx.clearRect(0, 0, width, height);

        const density = this._densityData;
        if (!density || density.length === 0) return;

        const maxDensity = Math.max(1, ...density);
        const segWidth = width / density.length;

        // 获取主题色
        const isDark = document.body.dataset.theme === 'dark';
        const baseColor = isDark ? [100, 150, 255] : [59, 130, 246]; // 蓝色系

        density.forEach((count, i) => {
            const intensity = Math.min(1, count / Math.max(1, maxDensity * 0.7));
            if (intensity < 0.02) return; // 太淡不画

            const r = Math.round(baseColor[0] * (0.3 + 0.7 * intensity));
            const g = Math.round(baseColor[1] * (0.3 + 0.7 * intensity));
            const b = Math.round(baseColor[2] * (0.3 + 0.7 * intensity));
            const a = 0.3 + 0.7 * intensity;

            this.ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
            const barHeight = height * (0.15 + 0.85 * intensity);
            const x = i * segWidth;
            const y = (height - barHeight) / 2;

            // 圆角矩形
            this._roundRect(x + 0.5, y, segWidth - 1, barHeight, 1);
            this.ctx.fill();
        });

        // 绘制边框
        this.ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(0, 0, width, height);
    },

    _roundRect(x, y, w, h, r) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    },

    updateCursor() {
        if (!this.cursor || !this.enabled) return;
        const ce = window.ChartEditor;
        if (!ce) return;

        const duration = ce.state.duration || 1;
        const currentTime = ce.state.currentTime || 0;
        const ratio = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;

        const width = this.canvas ? (this.canvas.width / (window.devicePixelRatio || 1)) : 0;
        const x = ratio * width;

        this.cursor.style.left = x + 'px';
    },

    // 播放时持续更新光标位置
    tick() {
        if (this.enabled && window.ChartEditor && window.ChartEditor.state.playing) {
            this.updateCursor();
        }
    },

    destroy() {
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
        this.canvas = null;
        this.ctx = null;
        this.cursor = null;
    }
};

window.EditorMinimap = EditorMinimap;
