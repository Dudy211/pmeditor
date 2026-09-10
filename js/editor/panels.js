/**
 * editor/panels.js — 三栏面板模块
 */

const EditorPanels = {
    targetRatio: 9 / 16,

    create() {
        const el = document.createElement('div');
        el.className = 'editor-main';
        el.id = 'editor-main';
        el.innerHTML = `
            <div class="editor-left" id="editor-left">
                <div class="panel-body" id="left-panel-body">
                    <div class="ratio-control">
                        <label>竖屏比例</label>
                        <div class="ratio-presets">
                            <button data-ratio="0.6667">2:3</button>
                            <button data-ratio="0.5625" class="active">9:16</button>
                            <button data-ratio="0.5">9:18</button>
                            <button data-ratio="0.4615">9:19.5</button>
                            <button data-ratio="0.45">9:20</button>
                        </div>
                    </div>
                    <div class="rhythm-control" id="rhythm-control">
                        <label>节奏</label>
                        <div class="rhythm-presets">
                            <button data-snap="0" class="active">全拍</button>
                            <button data-snap="2">1/2</button>
                            <button data-snap="3">1/3</button>
                            <button data-snap="4">1/4</button>
                            <button data-snap="8">1/8</button>
                            <button data-snap="16">1/16</button>
                        </div>
                    </div>
                    <div class="note-type-control" id="note-type-control">
                        <label>音符类型</label>
                        <div class="note-type-presets">
                            <button class="nt-btn active" data-type="tap" title="单点 (Tap)">●</button>
                            <button class="nt-btn" data-type="hold" title="长按 (Hold)">▬</button>
                            <button class="nt-btn" data-type="switch" title="轨道切换 (Switch)">⇄</button>
                        </div>
                    </div>
                    <div class="editor-mode-control" id="editor-mode-control" style="margin-top:16px;">
                        <label>编辑模式</label>
                        <div class="editor-mode-presets" style="display:flex;gap:8px;margin-top:8px;">
                            <button class="em-btn" data-mode="select" title="选择模式">🖱️</button>
                            <button class="em-btn" data-mode="delete" title="删除模式">🗑️</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="editor-center" id="editor-center">
                <div class="editor-timeline" id="editor-timeline"></div>
            </div>
            <div class="editor-right" id="editor-right">
                <div class="panel-header">
                    <span>属性</span>
                    <button class="track-reselect-btn" id="track-reselect-btn" title="重新设置轨道数">⚙️</button>
                </div>
                <div class="panel-body" id="right-panel-body">
                    <div id="property-content">
                        <div style="font-weight:600;color:var(--text-primary);margin-bottom:8px;">属性面板</div>
                        选择音符以编辑属性<br>
                        <span style="color:var(--text-tertiary);">暂无选中项</span>
                    </div>
                </div>
            </div>
        `;
        return el;
    },

    init() {
        this.bindRatioControl();
        this.bindRhythmControl();
        this.bindNoteTypeControl();
        this.bindEditorModeControl();
        this.bindSettingsBtn();
        this.updateCenterWidth();
        // 同步节奏按钮禁用状态（网格默认开启，不禁用）
        const showGrid = localStorage.getItem('muse-editor-show-grid') !== 'false';
        this._updateRhythmButtonsDisabled(!showGrid);
        window.addEventListener('resize', () => this.updateCenterWidth());
    },

    bindNoteTypeControl() {
        const container = document.getElementById('note-type-control');
        if (!container || container.dataset.bound) return;
        container.dataset.bound = 'true';
        const btns = container.querySelectorAll('.nt-btn');
        btns.forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type;
                const ce = window.ChartEditor;
                if (ce) {
                    ce.state.noteType = type;
                    ce.state.editorMode = 'place';
                }
                btns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                // 取消编辑模式按钮的 active
                const emBtns = document.querySelectorAll('.em-btn');
                emBtns.forEach(b => b.classList.remove('active'));
                if (window.showToast) {
                    const name = type === 'tap' ? '单点' : type === 'hold' ? '长按' : '轨道切换';
                    window.showToast('音符类型: ' + name, 'info');
                }
            });
        });
    },

    bindEditorModeControl() {
        const container = document.getElementById('editor-mode-control');
        if (!container || container.dataset.bound) return;
        container.dataset.bound = 'true';
        const btns = container.querySelectorAll('.em-btn');
        btns.forEach(btn => {
            btn.addEventListener('click', () => {
                const wasActive = btn.classList.contains('active');
                const mode = btn.dataset.mode;
                const ce = window.ChartEditor;
                btns.forEach(b => b.classList.remove('active'));
                if (wasActive) {
                    // 取消编辑模式，恢复到放置模式
                    if (ce) ce.state.editorMode = 'place';
                    // 恢复音符类型按钮的 active
                    const ntBtns = document.querySelectorAll('.nt-btn');
                    ntBtns.forEach(b => b.classList.remove('active'));
                    const activeType = ce ? ce.state.noteType : 'tap';
                    ntBtns.forEach(b => {
                        if (b.dataset.type === activeType) b.classList.add('active');
                    });
                    if (window.showToast) window.showToast('已恢复放置模式', 'info');
                } else {
                    btn.classList.add('active');
                    if (ce) ce.state.editorMode = mode;
                    // 取消音符类型按钮的 active
                    const ntBtns = document.querySelectorAll('.nt-btn');
                    ntBtns.forEach(b => b.classList.remove('active'));
                    const labels = { select: '选择模式', delete: '删除模式' };
                    if (window.showToast) window.showToast('已切换到：' + labels[mode], 'info');
                }
            });
        });
    },

    bindSettingsBtn() {
        const btn = document.getElementById('track-reselect-btn');
        if (!btn) return;
        btn.addEventListener('click', () => this.openSettingsPanel());
    },

    showTrackSelector() {
        return new Promise((resolve) => {
            const existing = document.getElementById('track-selector-modal');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.className = 'track-selector-modal';
            overlay.id = 'track-selector-modal';
            overlay.innerHTML = `
                <div class="ts-overlay"></div>
                <div class="ts-dialog">
                    <div class="ts-title">选择轨道数</div>
                    <div class="ts-options">
                        <button class="ts-btn" data-count="1">
                            <div class="ts-preview ts-1"></div>
                            <span class="ts-name">1 轨</span>
                        </button>
                        <button class="ts-btn" data-count="2">
                            <div class="ts-preview ts-2"></div>
                            <span class="ts-name">2 轨</span>
                        </button>
                        <button class="ts-btn" data-count="3">
                            <div class="ts-preview ts-3"></div>
                            <span class="ts-name">3 轨</span>
                        </button>
                        <button class="ts-btn" data-count="4">
                            <div class="ts-preview ts-4"></div>
                            <span class="ts-name">4 轨</span>
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            overlay.querySelectorAll('.ts-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const count = parseInt(btn.dataset.count);
                    overlay.remove();
                    resolve(count);
                });
            });

            overlay.querySelector('.ts-overlay').addEventListener('click', () => {
                overlay.remove();
                resolve(3);
            });
        });
    },

    async reselectTrackCount() {
        const ce = window.ChartEditor;
        if (!ce) return;
        const newCount = await this.showTrackSelector();
        if (newCount && newCount !== ce.state.trackCount) {
            ce.state.trackCount = newCount;
            ce.state.activeTrack = 0;
            this.refreshTrackInfo();
            if (window.EditorTimeline) EditorTimeline.render();
            if (window.showToast) window.showToast('已设置为 ' + newCount + ' 轨', 'success');
        }
    },

    refreshPropertyPanel() {
        const container = document.getElementById('property-content');
        if (!container) return;
        const ce = window.ChartEditor;
        if (!ce || !ce.state.selectedNotes.length) {
            if (window.SongInfoPanel) {
                window.SongInfoPanel.render(container);
            } else {
                container.innerHTML = `
                    <div style="font-weight:600;color:var(--text-primary);margin-bottom:8px;">属性面板</div>
                    选择音符以编辑属性<br>
                    <span style="color:var(--text-tertiary);">暂无选中项</span>
                `;
            }
            return;
        }

        const selected = ce.state.selectedNotes;
        const isMulti = selected.length > 1;

        if (isMulti) {
            let html = `
                <div style="font-weight:600;color:var(--text-primary);margin-bottom:8px;">多选 (${selected.length} 个音符)</div>
                <div style="margin-bottom:10px;color:var(--text-tertiary);font-size:12px;">
                    点击音符添加/移除，框选批量添加，拖动移动
                </div>
            `;
            const preview = selected.slice(0, 5).map((n, i) => {
                const typeName = n.type === 'tap' ? '单点' : n.type === 'hold' ? '长按' : '切换';
                return `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:2px;">#${i+1} ${typeName} | 轨${n.track+1} | ${n.time.toFixed(2)}s</div>`;
            }).join('');
            html += `<div style="margin-bottom:10px;max-height:80px;overflow-y:auto;">${preview}${selected.length > 5 ? `<div style="font-size:11px;color:var(--text-tertiary);">...还有 ${selected.length - 5} 个</div>` : ''}</div>`;

            html += `
                <div style="display:flex;gap:6px;margin-bottom:8px;">
                    <button id="prop-copy" style="flex:1;padding:6px 0;border-radius:6px;border:none;background:var(--accent-primary);color:#fff;cursor:pointer;font-size:13px;">📋 复制</button>
                    <button id="prop-delete-multi" style="flex:1;padding:6px 0;border-radius:6px;border:none;background:#ff3b30;color:#fff;cursor:pointer;font-size:13px;">🗑 删除</button>
                </div>
                <div style="font-size:11px;color:var(--text-tertiary);margin-top:6px;">
                    💡 提示：选中模式下拖动任意组内音符可整体移动
                </div>
            `;
            container.innerHTML = html;

            container.querySelector('#prop-copy').addEventListener('click', () => {
                if (window.EditorTimeline) window.EditorTimeline.copySelected();
            });
            container.querySelector('#prop-delete-multi').addEventListener('click', () => {
                if (window.EditorTimeline) window.EditorTimeline.deleteSelected();
            });
            return;
        }

        const note = selected[0];
        let html = `
            <div style="font-weight:600;color:var(--text-primary);margin-bottom:8px;">编辑音符</div>
            <div style="margin-bottom:6px;"><span style="color:var(--text-tertiary);">类型:</span> ${note.type === 'tap' ? '单点' : note.type === 'hold' ? '长按' : '轨道切换'}</div>
            <div style="margin-bottom:6px;"><span style="color:var(--text-tertiary);">轨道:</span> ${note.track + 1}</div>
            <div style="margin-bottom:6px;"><span style="color:var(--text-tertiary);">时间:</span> ${note.time.toFixed(3)}s</div>
        `;
        if (note.type === 'hold') {
            html += `<div style="margin-bottom:6px;"><span style="color:var(--text-tertiary);">长度:</span> ${(note.endTime - note.time).toFixed(3)}s</div>`;
        }
        if (note.type === 'switch') {
            const currentTarget = note.targetTrackCount || 2;
            html += `
                <div style="margin-bottom:6px;">
                    <span style="color:var(--text-tertiary);">目标轨道数:</span>
                    <div style="display:flex;gap:4px;margin-top:6px;">
                        ${[1,2,3,4].map(n => `
                            <button class="prop-track-btn ${n === currentTarget ? 'active' : ''}" data-track="${n}"
                                style="flex:1;height:28px;border-radius:4px;border:1px solid var(--border-color);background:${n === currentTarget ? 'var(--accent-primary)' : 'var(--bg-tertiary)'};color:${n === currentTarget ? '#fff' : 'var(--text-secondary)'};cursor:pointer;font-size:13px;font-weight:600;font-family:inherit;transition:all 0.15s;">
                                ${n}
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        html += `<button id="prop-delete" style="margin-top:8px;padding:4px 12px;border-radius:4px;border:none;background:#ff3b30;color:#fff;cursor:pointer;width:100%;">删除音符</button>`;
        container.innerHTML = html;

        container.querySelectorAll('.prop-track-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const val = parseInt(btn.dataset.track, 10);
                note.targetTrackCount = val;
                if (window.AppState) window.AppState.isDirty = true;
                container.querySelectorAll('.prop-track-btn').forEach(b => {
                    const n = parseInt(b.dataset.track, 10);
                    b.style.background = n === val ? 'var(--accent-primary)' : 'var(--bg-tertiary)';
                    b.style.color = n === val ? '#fff' : 'var(--text-secondary)';
                    b.classList.toggle('active', n === val);
                });
                ce.adjustNotesAfterSwitch(note);
                if (window.showToast) window.showToast('目标轨道: ' + val, 'success');
            });
        });
        const delBtn = container.querySelector('#prop-delete');
        if (delBtn) {
            delBtn.addEventListener('click', () => {
                if (window.EditorTimeline) window.EditorTimeline.deleteSelected();
            });
        }
    },

    // ===== 快捷设置数据管理 =====
    _initDualRange(container, options) {
        if (!container) return;
        const { min, max, step, defaultMin, defaultMax, onChange } = options;
        let currentMin = parseFloat(localStorage.getItem('muse-editor-breathe-min')) || defaultMin;
        let currentMax = parseFloat(localStorage.getItem('muse-editor-breathe-max')) || defaultMax;

        const track = container.querySelector('.dual-range-track');
        const fill = container.querySelector('.dual-range-fill');
        const thumbMin = container.querySelector('.dual-range-thumb.min');
        const thumbMax = container.querySelector('.dual-range-thumb.max');
        const labelMin = container.querySelector('.dr-label-min');
        const labelMax = container.querySelector('.dr-label-max');

        const updateUI = () => {
            const range = max - min;
            const leftMin = ((currentMin - min) / range) * 100;
            const leftMax = ((currentMax - min) / range) * 100;
            thumbMin.style.left = `calc(${leftMin}% - 8px)`;
            thumbMax.style.left = `calc(${leftMax}% - 8px)`;
            fill.style.left = leftMin + '%';
            fill.style.width = (leftMax - leftMin) + '%';
            if (labelMin) labelMin.textContent = Math.round(currentMin * 100) + '%';
            if (labelMax) labelMax.textContent = Math.round(currentMax * 100) + '%';
        };

        const setupThumb = (thumb, isMin) => {
            let dragging = false;
            thumb.addEventListener('mousedown', (e) => {
                dragging = true;
                thumb.classList.add('active');
                e.preventDefault();
            });
            const onMove = (e) => {
                if (!dragging) return;
                const rect = container.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const val = Math.round((min + pct * (max - min)) / step) * step;
                if (isMin) {
                    currentMin = Math.min(val, currentMax - step);
                } else {
                    currentMax = Math.max(val, currentMin + step);
                }
                updateUI();
                onChange(currentMin, currentMax);
            };
            const onUp = () => {
                dragging = false;
                thumb.classList.remove('active');
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        };

        setupThumb(thumbMin, true);
        setupThumb(thumbMax, false);
        updateUI();
        onChange(currentMin, currentMax);
    },

    getAllShortcutDefs() {
        return [
            { id: 'perf', name: '性能模式', type: 'select' },
            { id: 'showTouch', name: '显示触摸点', type: 'toggle' },
            { id: 'showGrid', name: '显示网格线', type: 'toggle' },
            { id: 'soundPreview', name: '音效预览', type: 'toggle' },
            { id: 'autoSave', name: '自动保存', type: 'toggle' },
            { id: 'breatheAnim', name: '呼吸动画', type: 'toggle' },
            { id: 'minimap', name: '密度条', type: 'toggle' }
        ];
    },

    getShortcuts() {
        try {
            const saved = localStorage.getItem('muse-editor-shortcuts');
            if (saved) {
                const list = JSON.parse(saved);
                if (Array.isArray(list) && list.length > 0) return list;
            }
        } catch(e) {}
        return ['perf', 'showGrid', 'showTouch'];
    },

    saveShortcuts(list) {
        localStorage.setItem('muse-editor-shortcuts', JSON.stringify(list));
    },

    getShortcutValueText(id) {
        if (id === 'perf') {
            const ce = window.ChartEditor;
            const mode = (ce && ce.state.perfMode) || 'smooth';
            return mode === 'smooth' ? '流畅' : '激进';
        }
        if (id === 'showTouch') {
            return localStorage.getItem('muse-editor-show-touch') === 'true' ? '开启' : '关闭';
        }
        return '';
    },

    _refreshPerfUI(overlay, mode) {
        overlay.querySelectorAll('#sp-adv-perf-options .sp-perf-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    },

    _refreshShowTouchUI(overlay, checked) {
        const cb = overlay.querySelector('#sp-adv-show-touch');
        if (cb) cb.checked = checked;
    },

    _refreshShortcutValues(overlay) {
        const list = overlay.querySelector('#sp-shortcut-list');
        if (!list) return;
        list.querySelectorAll('.sp-shortcut-item').forEach(item => {
            const id = item.dataset.id;
            // 性能模式：刷新按钮状态
            if (id === 'perf') {
                const ce = window.ChartEditor;
                const mode = (ce && ce.state.perfMode) || 'smooth';
                item.querySelectorAll('.sp-sc-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.val === mode);
                });
            }
            // toggle 类型：刷新 checkbox
            else if (['showTouch', 'showGrid', 'soundPreview', 'autoSave', 'breatheAnim', 'minimap'].includes(id)) {
                const keyMap = {
                    showTouch: 'muse-editor-show-touch',
                    showGrid: 'muse-editor-show-grid',
                    soundPreview: 'muse-editor-sound-preview',
                    autoSave: 'muse-editor-auto-save',
                    breatheAnim: 'muse-editor-breathe-anim',
                    minimap: 'muse-editor-minimap'
                };
                const key = keyMap[id];
                let checked;
                if (id === 'soundPreview') {
                    checked = localStorage.getItem(key) !== 'false';
                } else if (id === 'showGrid') {
                    checked = localStorage.getItem(key) !== 'false';
                } else if (id === 'breatheAnim') {
                    checked = localStorage.getItem(key) !== 'false';
                } else if (id === 'minimap') {
                    checked = localStorage.getItem(key) !== 'false';
                } else {
                    checked = localStorage.getItem(key) === 'true';
                }
                const cb = item.querySelector('input[type="checkbox"]');
                if (cb) cb.checked = checked;
            }
        });
    },

    _refreshAdvancedValues(overlay) {
        if (!overlay) return;
        // 性能模式
        const ce = window.ChartEditor;
        const mode = (ce && ce.state.perfMode) || 'smooth';
        overlay.querySelectorAll('#sp-adv-perf-options .sp-perf-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        // 显示触摸点
        const showTouchCb = overlay.querySelector('#sp-adv-show-touch');
        if (showTouchCb) showTouchCb.checked = localStorage.getItem('muse-editor-show-touch') === 'true';
        // 显示网格线
        const showGridCb = overlay.querySelector('#sp-adv-show-grid');
        if (showGridCb) showGridCb.checked = localStorage.getItem('muse-editor-show-grid') !== 'false';
        // 音效预览
        const soundCb = overlay.querySelector('#sp-adv-sound-preview');
        if (soundCb) soundCb.checked = localStorage.getItem('muse-editor-sound-preview') !== 'false';
        // 自动保存
        const autoCb = overlay.querySelector('#sp-adv-auto-save');
        if (autoCb) autoCb.checked = localStorage.getItem('muse-editor-auto-save') === 'true';
        // 呼吸动画
        const breatheCb = overlay.querySelector('#sp-adv-breathe-anim');
        if (breatheCb) breatheCb.checked = localStorage.getItem('muse-editor-breathe-anim') !== 'false';
        // 密度条
        const minimapCb = overlay.querySelector('#sp-adv-minimap');
        if (minimapCb) minimapCb.checked = localStorage.getItem('muse-editor-minimap') !== 'false';
    },

    _getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.sp-shortcut-item:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    },

    _showAddShortcutModal(overlay, onChange) {
        const existing = document.getElementById('add-shortcut-modal');
        if (existing) existing.remove();

        const shortcuts = this.getShortcuts();
        const defs = this.getAllShortcutDefs();
        const available = defs.filter(d => !shortcuts.includes(d.id));

        if (available.length === 0) {
            if (window.showToast) window.showToast('没有可添加的快捷项', 'warning');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'settings-panel-modal';
        modal.id = 'add-shortcut-modal';
        modal.style.zIndex = '200';
        modal.innerHTML = `
            <div class="sp-overlay"></div>
            <div class="sp-dialog" style="width:280px;">
                <div class="sp-title">
                    <span>添加快捷项</span>
                    <button class="sp-close-btn" id="asc-close">✕</button>
                </div>
                <div class="sp-body">
                    <div class="sp-add-list">
                        ${available.map(d => `
                            <button class="sp-add-item" data-id="${d.id}">
                                <span class="sp-add-name">${d.name}</span>
                                <span class="sp-add-desc">${d.type === 'select' ? '选择型' : '开关型'}</span>
                            </button>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        const inner = document.querySelector('.workspace-inner') || document.body;
        inner.appendChild(modal);

        modal.querySelectorAll('.sp-add-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const list = this.getShortcuts();
                list.push(id);
                this.saveShortcuts(list);
                modal.remove();
                onChange();
                if (window.showToast) window.showToast('已添加', 'success');
            });
        });

        const close = () => modal.remove();
        modal.querySelector('#asc-close').addEventListener('click', close);
        modal.querySelector('.sp-overlay').addEventListener('click', close);
    },

    // ===== 各设置页初始化 =====
    _initShortcutPage(overlay) {
        const list = overlay.querySelector('#sp-shortcut-list');
        const editBtn = overlay.querySelector('#sp-shortcut-edit');
        const addWrap = overlay.querySelector('#sp-shortcut-add-wrap');
        let isEditing = false;

        // 拖动状态
        let dragItem = null;
        let dragStartY = 0;
        let dragStartX = 0;
        let hasMoved = false;
        let longPressTimer = null;
        let isLongPress = false;
        let lastInsertBefore = null; // 防止来回跳
        const LONG_PRESS_DELAY = 300; // ms

        const getPerfMode = () => {
            const ce = window.ChartEditor;
            return (ce && ce.state.perfMode) || 'smooth';
        };

        const getShowTouch = () => {
            return localStorage.getItem('muse-editor-show-touch') === 'true';
        };

        const setPerfMode = (mode) => {
            const ce = window.ChartEditor;
            if (ce) {
                ce.state.perfMode = mode;
                localStorage.setItem('muse-editor-perf-mode', mode);
            }
            this._refreshPerfUI(overlay, mode);
            this._refreshAdvancedValues(overlay);
            if (window.showToast) window.showToast(mode === 'smooth' ? '已切换至流畅模式' : '已切换至激进模式', 'info');
        };

        const setShowTouch = (val) => {
            localStorage.setItem('muse-editor-show-touch', val);
            this._refreshShowTouchUI(overlay, val);
            this._refreshAdvancedValues(overlay);
            if (window.showToast) window.showToast(val ? '已开启触摸点显示' : '已关闭触摸点显示', 'info');
        };

        const doReorder = (fromEl, toEl) => {
            if (!fromEl || !toEl || fromEl === toEl) return;
            const children = Array.from(list.children);
            const fromIdx = children.indexOf(fromEl);
            const toIdx = children.indexOf(toEl);

            // FLIP 动画：记录旧位置
            const oldRects = new Map();
            children.forEach(child => {
                oldRects.set(child, child.getBoundingClientRect());
            });

            // 执行 DOM 交换
            if (fromIdx < toIdx) {
                list.insertBefore(fromEl, toEl.nextSibling);
            } else {
                list.insertBefore(fromEl, toEl);
            }

            // FLIP 动画：计算新位置并补偿
            const newChildren = Array.from(list.children);
            newChildren.forEach(child => {
                const oldRect = oldRects.get(child);
                const newRect = child.getBoundingClientRect();
                const dy = oldRect.top - newRect.top;
                if (dy !== 0) {
                    child.style.transition = 'none';
                    child.style.transform = `translateY(${dy}px)`;
                }
            });

            // 下一帧移除补偿，触发平滑过渡
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    newChildren.forEach(child => {
                        child.style.transition = '';
                        child.style.transform = '';
                    });
                });
            });
        };

        const getItemFromPoint = (clientY) => {
            const items = [...list.querySelectorAll('.sp-shortcut-item')];
            for (const item of items) {
                const rect = item.getBoundingClientRect();
                if (clientY >= rect.top && clientY <= rect.bottom) {
                    return item;
                }
            }
            return null;
        };

        const clearDragState = () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
            if (dragItem) {
                dragItem.classList.remove('dragging');
                const handle = dragItem.querySelector('.sp-sc-drag');
                if (handle) handle.classList.remove('active');
            }
            dragItem = null;
            hasMoved = false;
            isLongPress = false;
            lastInsertBefore = null;
            document.body.style.userSelect = '';
            document.body.style.webkitUserSelect = '';
            document.body.style.touchAction = '';
        };

        const renderList = () => {
            const shortcuts = this.getShortcuts();
            const defs = this.getAllShortcutDefs();
            list.innerHTML = '';

            shortcuts.forEach((id, index) => {
                const def = defs.find(d => d.id === id);
                if (!def) return;

                const item = document.createElement('div');
                item.className = 'sp-shortcut-item';
                item.dataset.id = id;
                item.dataset.index = index;

                if (isEditing) {
                    // 编辑模式：只显示名称 + 拖动/删除
                    item.innerHTML = `
                        <div class="sp-sc-compact">${def.name}</div>
                        <div class="sp-sc-actions">
                            <div class="sp-sc-drag" title="按住拖动排序"></div>
                            <button class="sp-sc-delete" title="删除" data-id="${id}">⊖</button>
                        </div>
                    `;
                } else {
                    // 非编辑模式：显示完整控制UI
                    if (id === 'perf') {
                        const mode = getPerfMode();
                        item.innerHTML = `
                            <div class="sp-sc-full">
                                <div class="sp-sc-name">${def.name}</div>
                                <div class="sp-sc-controls">
                                    <button class="sp-sc-btn ${mode === 'smooth' ? 'active' : ''}" data-val="smooth">流畅</button>
                                    <button class="sp-sc-btn ${mode === 'aggressive' ? 'active' : ''}" data-val="aggressive">激进</button>
                                </div>
                            </div>
                        `;
                    } else if (id === 'showTouch') {
                        const checked = getShowTouch();
                        item.innerHTML = `
                            <div class="sp-sc-full">
                                <div class="sp-sc-name">${def.name}</div>
                                <label class="sp-sc-toggle">
                                    <input type="checkbox" ${checked ? 'checked' : ''}>
                                    <span class="sp-sc-toggle-track">
                                        <span class="sp-sc-toggle-thumb"></span>
                                    </span>
                                </label>
                            </div>
                        `;
                    } else if (id === 'showGrid') {
                        const checked = localStorage.getItem('muse-editor-show-grid') !== 'false';
                        item.innerHTML = `
                            <div class="sp-sc-full">
                                <div class="sp-sc-name">${def.name}</div>
                                <label class="sp-sc-toggle">
                                    <input type="checkbox" ${checked ? 'checked' : ''}>
                                    <span class="sp-sc-toggle-track">
                                        <span class="sp-sc-toggle-thumb"></span>
                                    </span>
                                </label>
                            </div>
                        `;
                    } else if (id === 'soundPreview') {
                        const checked = localStorage.getItem('muse-editor-sound-preview') !== 'false';
                        item.innerHTML = `
                            <div class="sp-sc-full">
                                <div class="sp-sc-name">${def.name}</div>
                                <label class="sp-sc-toggle">
                                    <input type="checkbox" ${checked ? 'checked' : ''}>
                                    <span class="sp-sc-toggle-track">
                                        <span class="sp-sc-toggle-thumb"></span>
                                    </span>
                                </label>
                            </div>
                        `;
                    } else if (id === 'autoSave') {
                        const checked = localStorage.getItem('muse-editor-auto-save') === 'true';
                        item.innerHTML = `
                            <div class="sp-sc-full">
                                <div class="sp-sc-name">${def.name}</div>
                                <label class="sp-sc-toggle">
                                    <input type="checkbox" ${checked ? 'checked' : ''}>
                                    <span class="sp-sc-toggle-track">
                                        <span class="sp-sc-toggle-thumb"></span>
                                    </span>
                                </label>
                            </div>
                        `;
                    } else if (id === 'breatheAnim') {
                        const checked = localStorage.getItem('muse-editor-breathe-anim') !== 'false';
                        item.innerHTML = `
                            <div class="sp-sc-full">
                                <div class="sp-sc-name">${def.name}</div>
                                <label class="sp-sc-toggle">
                                    <input type="checkbox" ${checked ? 'checked' : ''}>
                                    <span class="sp-sc-toggle-track">
                                        <span class="sp-sc-toggle-thumb"></span>
                                    </span>
                                </label>
                            </div>
                        `;
                    } else if (id === 'minimap') {
                        const checked = localStorage.getItem('muse-editor-minimap') !== 'false';
                        item.innerHTML = `
                            <div class="sp-sc-full">
                                <div class="sp-sc-name">${def.name}</div>
                                <label class="sp-sc-toggle">
                                    <input type="checkbox" ${checked ? 'checked' : ''}>
                                    <span class="sp-sc-toggle-track">
                                        <span class="sp-sc-toggle-thumb"></span>
                                    </span>
                                </label>
                            </div>
                        `;
                    }
                }

                // 非编辑模式：绑定控制事件
                if (!isEditing) {
                    if (id === 'perf') {
                        item.querySelectorAll('.sp-sc-btn').forEach(btn => {
                            btn.addEventListener('click', () => {
                                const val = btn.dataset.val;
                                setPerfMode(val);
                                item.querySelectorAll('.sp-sc-btn').forEach(b => {
                                    b.classList.toggle('active', b.dataset.val === val);
                                });
                            });
                        });
                    } else if (id === 'showTouch') {
                        const cb = item.querySelector('input[type="checkbox"]');
                        if (cb) {
                            cb.addEventListener('change', () => {
                                setShowTouch(cb.checked);
                            });
                        }
                    } else if (id === 'showGrid') {
                        const cb = item.querySelector('input[type="checkbox"]');
                        if (cb) {
                            const key = 'muse-editor-show-grid';
                            cb.checked = localStorage.getItem(key) !== 'false';
                            cb.addEventListener('change', () => {
                                localStorage.setItem(key, cb.checked);
                                this._refreshAdvancedValues(overlay);
                                // 立即刷新网格
                                if (window.EditorTimeline) EditorTimeline.render();
                                // 同步节奏按钮禁用状态
                                this._updateRhythmButtonsDisabled(!cb.checked);
                                if (window.showToast) window.showToast(cb.checked ? '已显示网格线' : '已隐藏网格线', 'info');
                            });
                        }
                    } else if (id === 'soundPreview') {
                        const cb = item.querySelector('input[type="checkbox"]');
                        if (cb) {
                            const key = 'muse-editor-sound-preview';
                            cb.checked = localStorage.getItem(key) !== 'false';
                            cb.addEventListener('change', () => {
                                localStorage.setItem(key, cb.checked);
                                this._refreshAdvancedValues(overlay);
                                if (window.showToast) window.showToast(cb.checked ? '已开启音效预览' : '已关闭音效预览', 'info');
                            });
                        }
                    } else if (id === 'autoSave') {
                        const cb = item.querySelector('input[type="checkbox"]');
                        if (cb) {
                            const key = 'muse-editor-auto-save';
                            cb.checked = localStorage.getItem(key) === 'true';
                            cb.addEventListener('change', () => {
                                localStorage.setItem(key, cb.checked);
                                this._refreshAdvancedValues(overlay);
                                if (window.showToast) window.showToast(cb.checked ? '已开启自动保存' : '已关闭自动保存', 'info');
                            });
                        }
                    } else if (id === 'breatheAnim') {
                        const cb = item.querySelector('input[type="checkbox"]');
                        if (cb) {
                            const key = 'muse-editor-breathe-anim';
                            cb.checked = localStorage.getItem(key) !== 'false';
                            cb.addEventListener('change', () => {
                                localStorage.setItem(key, cb.checked);
                                this._refreshAdvancedValues(overlay);
                                const advBreathe = overlay.querySelector('#sp-adv-breathe');
                                if (advBreathe) advBreathe.checked = cb.checked;
                                if (window.showToast) window.showToast(cb.checked ? '已开启呼吸动画' : '已关闭呼吸动画', 'info');
                            });
                        }
                    } else if (id === 'minimap') {
                        const cb = item.querySelector('input[type="checkbox"]');
                        if (cb) {
                            const key = 'muse-editor-minimap';
                            cb.checked = localStorage.getItem(key) !== 'false';
                            cb.addEventListener('change', () => {
                                localStorage.setItem(key, cb.checked);
                                this._refreshAdvancedValues(overlay);
                                if (window.EditorMinimap) window.EditorMinimap.updateVisibility();
                                if (this._accState) {
                                    this._accState.root = cb.checked;
                                    if (this._accUpdateUI) this._accUpdateUI();
                                    if (this._accSave) this._accSave();
                                }
                                if (window.showToast) window.showToast(cb.checked ? '已显示密度条' : '已隐藏密度条', 'info');
                            });
                        }
                    }
                }

                // 编辑模式：删除按钮 + 拖动
                if (isEditing) {
                    const delBtn = item.querySelector('.sp-sc-delete');
                    delBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const newList = this.getShortcuts().filter(sid => sid !== id);
                        this.saveShortcuts(newList);
                        renderList();
                        if (window.showToast) window.showToast('已删除', 'success');
                    });

                    const handle = item.querySelector('.sp-sc-drag');

                    // 触摸拖动
                    handle.addEventListener('touchstart', (e) => {
                        e.preventDefault();
                        const touch = e.touches[0];
                        dragStartY = touch.clientY;
                        dragStartX = touch.clientX;
                        hasMoved = false;
                        isLongPress = false;

                        // 长按视觉反馈
                        longPressTimer = setTimeout(() => {
                            isLongPress = true;
                            handle.classList.add('active');
                            item.classList.add('dragging');
                            dragItem = item;
                            // 防止页面滚动和文本选择
                            document.body.style.userSelect = 'none';
                            document.body.style.webkitUserSelect = 'none';
                            document.body.style.touchAction = 'none';
                            if (navigator.vibrate) navigator.vibrate(20);
                        }, LONG_PRESS_DELAY);
                    }, { passive: false });

                    handle.addEventListener('touchmove', (e) => {
                        if (!dragItem) {
                            // 还没触发长按，检查是否移动了
                            const touch = e.touches[0];
                            const dy = Math.abs(touch.clientY - dragStartY);
                            const dx = Math.abs(touch.clientX - dragStartX);
                            if (dy > 10 || dx > 10) {
                                // 移动了，取消长按
                                if (longPressTimer) {
                                    clearTimeout(longPressTimer);
                                    longPressTimer = null;
                                }
                            }
                            return;
                        }
                        e.preventDefault();
                        hasMoved = true;
                        const touch = e.touches[0];
                        const targetItem = getItemFromPoint(touch.clientY);
                        // 只有当目标真正改变时才交换，防止来回跳
                        if (targetItem && targetItem !== dragItem && targetItem !== lastInsertBefore) {
                            lastInsertBefore = targetItem;
                            doReorder(dragItem, targetItem);
                        }
                    }, { passive: false });

                    handle.addEventListener('touchend', (e) => {
                        if (longPressTimer) {
                            clearTimeout(longPressTimer);
                            longPressTimer = null;
                        }
                        if (dragItem && hasMoved) {
                            const newOrder = Array.from(list.children).map(el => el.dataset.id).filter(Boolean);
                            this.saveShortcuts(newOrder);
                        }
                        lastInsertBefore = null;
                        clearDragState();
                    });

                    handle.addEventListener('touchcancel', () => {
                        clearDragState();
                    });

                    // 鼠标拖动（桌面端 fallback）
                    handle.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        dragItem = item;
                        dragStartY = e.clientY;
                        dragStartX = e.clientX;
                        hasMoved = false;
                        handle.classList.add('active');
                        item.classList.add('dragging');
                        document.body.style.userSelect = 'none';
                        document.body.style.webkitUserSelect = 'none';
                    });
                }

                list.appendChild(item);
            });
        };

        // 全局鼠标移动/释放（桌面端）
        document.addEventListener('mousemove', (e) => {
            if (!dragItem) return;
            hasMoved = true;
            const targetItem = getItemFromPoint(e.clientY);
            if (targetItem && targetItem !== dragItem && targetItem !== lastInsertBefore) {
                lastInsertBefore = targetItem;
                doReorder(dragItem, targetItem);
            }
        });

        document.addEventListener('mouseup', () => {
            if (!dragItem) return;
            if (hasMoved) {
                const newOrder = Array.from(list.children).map(el => el.dataset.id).filter(Boolean);
                this.saveShortcuts(newOrder);
            }
            lastInsertBefore = null;
            clearDragState();
        });

        // 编辑按钮
        editBtn.addEventListener('click', () => {
            isEditing = !isEditing;
            editBtn.textContent = isEditing ? '完成' : '编辑';
            editBtn.classList.toggle('active', isEditing);
            addWrap.style.display = isEditing ? 'block' : 'none';
            clearDragState();
            renderList();
        });

        // 添加按钮
        const addBtn = overlay.querySelector('#sp-shortcut-add');
        addBtn.addEventListener('click', () => {
            this._showAddShortcutModal(overlay, renderList);
        });

        renderList();
    },
    _initTrackPage(overlay, isEditor) {
        if (!isEditor) return;
        const ce = window.ChartEditor;
        const currentCount = ce ? ce.state.trackCount : 3;
        overlay.querySelectorAll('.sp-track-btn').forEach(btn => {
            if (parseInt(btn.dataset.count) === currentCount) {
                btn.classList.add('active');
            }
            btn.addEventListener('click', () => {
                const count = parseInt(btn.dataset.count);
                if (ce && count !== ce.state.trackCount) {
                    ce.state.trackCount = count;
                    ce.state.activeTrack = 0;
                    this.refreshTrackInfo();
                    if (window.EditorTimeline) EditorTimeline.render();
                    if (window.showToast) window.showToast('已设置为 ' + count + ' 轨', 'success');
                }
                overlay.querySelectorAll('.sp-track-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    },

    _initAdvancedPage(overlay) {
        const ce = window.ChartEditor;

        // 性能模式
        overlay.querySelectorAll('#sp-adv-perf-options .sp-perf-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                if (ce) {
                    ce.state.perfMode = mode;
                    localStorage.setItem('muse-editor-perf-mode', mode);
                }
                overlay.querySelectorAll('#sp-adv-perf-options .sp-perf-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._refreshShortcutValues(overlay);
                if (window.showToast) window.showToast(mode === 'smooth' ? '已切换至流畅模式' : '已切换至激进模式', 'info');
            });
        });

        // 显示触摸点
        const showTouchCheckbox = overlay.querySelector('#sp-adv-show-touch');
        if (showTouchCheckbox) {
            showTouchCheckbox.addEventListener('change', () => {
                localStorage.setItem('muse-editor-show-touch', showTouchCheckbox.checked);
                this._refreshShortcutValues(overlay);
                if (window.showToast) window.showToast(showTouchCheckbox.checked ? '已开启触摸点显示' : '已关闭触摸点显示', 'info');
            });
        }

        // 显示网格线
        const showGridCheckbox = overlay.querySelector('#sp-adv-show-grid');
        if (showGridCheckbox) {
            showGridCheckbox.addEventListener('change', () => {
                localStorage.setItem('muse-editor-show-grid', showGridCheckbox.checked);
                this._refreshShortcutValues(overlay);
                // 立即刷新网格
                if (window.EditorTimeline) EditorTimeline.render();
                // 同步节奏按钮禁用状态
                this._updateRhythmButtonsDisabled(!showGridCheckbox.checked);
                if (window.showToast) window.showToast(showGridCheckbox.checked ? '已显示网格线' : '已隐藏网格线', 'info');
            });
        }

        // 音效预览
        const soundCheckbox = overlay.querySelector('#sp-adv-sound-preview');
        if (soundCheckbox) {
            soundCheckbox.addEventListener('change', () => {
                localStorage.setItem('muse-editor-sound-preview', soundCheckbox.checked);
                this._refreshShortcutValues(overlay);
                if (window.showToast) window.showToast(soundCheckbox.checked ? '已开启音效预览' : '已关闭音效预览', 'info');
            });
        }

        // 自动保存
        const autoCheckbox = overlay.querySelector('#sp-adv-auto-save');
        if (autoCheckbox) {
            autoCheckbox.addEventListener('change', () => {
                localStorage.setItem('muse-editor-auto-save', autoCheckbox.checked);
                this._refreshShortcutValues(overlay);
                if (window.showToast) window.showToast(autoCheckbox.checked ? '已开启自动保存' : '已关闭自动保存', 'info');
            });
        }

        // 呼吸动画开关
        const breatheCheckbox = overlay.querySelector('#sp-adv-breathe');
        if (breatheCheckbox) {
            breatheCheckbox.addEventListener('change', () => {
                localStorage.setItem('muse-editor-breathe-anim', breatheCheckbox.checked);
                this._refreshShortcutValues(overlay);
                if (window.EditorTimeline) EditorTimeline.render();
                if (window.showToast) window.showToast(breatheCheckbox.checked ? '已开启呼吸动画' : '已关闭呼吸动画', 'info');
            });
        }

        // 呼吸频率
        const breatheSpeed = overlay.querySelector('#sp-adv-breathe-speed');
        if (breatheSpeed) {
            breatheSpeed.addEventListener('input', () => {
                const val = parseFloat(breatheSpeed.value);
                localStorage.setItem('muse-editor-breathe-speed', val);
                document.documentElement.style.setProperty('--breathe-duration', (3.5 - val) + 's');
            });
        }

        // 双拉条：最小/最大不透明度
        this._initDualRange(overlay.querySelector('#sp-adv-breathe-opacity'), {
            min: 0.1, max: 1.0, step: 0.05,
            defaultMin: 0.4, defaultMax: 1.0,
            onChange: (min, max) => {
                localStorage.setItem('muse-editor-breathe-min', min);
                localStorage.setItem('muse-editor-breathe-max', max);
                document.documentElement.style.setProperty('--breathe-min', min);
                document.documentElement.style.setProperty('--breathe-max', max);
            }
        });
    },


    _initAccessibilityPage(overlay) {
        const rootNode = overlay.querySelector('#tree-node-root');
        const midNode = overlay.querySelector('#tree-node-mid');
        const dragNode = overlay.querySelector('#tree-node-drag');
        const clickNode = overlay.querySelector('#tree-node-click');
        const rootLine = overlay.querySelector('#tree-line-root');
        const midUpLine = overlay.querySelector('#tree-line-mid-up');
        const midDownLine = overlay.querySelector('#tree-line-mid-down');
        const hint = overlay.querySelector('#sp-tree-hint');

        const get = (k, d) => localStorage.getItem(k) !== null ? localStorage.getItem(k) === 'true' : d;
        let state = {
            root: get('muse-editor-minimap', true),
            mid: get('muse-editor-minimap-seek', true),
            drag: get('muse-editor-minimap-seek-drag', true),
            click: get('muse-editor-minimap-seek-click', false),
        };

        // on/off 控制颜色，hidden 控制父级关闭时消失
        const setOn = (el, on) => {
            if (on) { el.classList.add('on'); el.classList.remove('off'); }
            else    { el.classList.remove('on'); el.classList.add('off'); }
        };
        const setHidden = (el, hidden) => {
            if (hidden) el.classList.add('hidden');
            else        el.classList.remove('hidden');
        };

        const updateUI = () => {
            // 根节点 — 始终可见
            setOn(rootNode, state.root);

            // root→mid 连线
            setOn(rootLine, state.root);
            setHidden(rootLine, !state.root);

            // 中节点 — 依赖根
            setOn(midNode, state.mid);
            setHidden(midNode, !state.root);

            // mid→drag/click 连线 — 依赖 mid 可用（root 且 mid）
            const midAvailable = state.root && state.mid;
            setOn(midUpLine, midAvailable);
            setOn(midDownLine, midAvailable);
            setHidden(midUpLine, !midAvailable);
            setHidden(midDownLine, !midAvailable);

            // 叶子节点 — 依赖 mid 可用，自身 on/off 控制颜色
            setOn(dragNode, state.drag);
            setOn(clickNode, state.click);
            setHidden(dragNode, !midAvailable);
            setHidden(clickNode, !midAvailable);

            // 提示文字
            if (!state.root) {
                hint.textContent = '显示横条已关闭，下方功能不可用';
            } else if (!state.mid) {
                hint.textContent = '快速跳转已关闭，拖动和点击不可用';
            } else if (!state.drag && !state.click) {
                hint.textContent = '请至少选择一种跳转方式（拖动或点击）';
            } else {
                hint.textContent = '点击节点切换状态';
            }
        };

        const save = () => {
            localStorage.setItem('muse-editor-minimap', state.root);
            localStorage.setItem('muse-editor-minimap-seek', state.mid);
            localStorage.setItem('muse-editor-minimap-seek-drag', state.drag);
            localStorage.setItem('muse-editor-minimap-seek-click', state.click);
            const minimap = document.getElementById('ed-minimap');
            if (minimap) {
                minimap.style.display = state.root ? '' : 'none';
            }
            this._refreshShortcutValues(overlay);
        };

        const toggle = (key) => {
            if (key === 'mid' && !state.root) return;
            if ((key === 'drag' || key === 'click') && !(state.root && state.mid)) return;

            if (key === 'root') {
                state.root = !state.root;
            } else if (key === 'mid') {
                state.mid = !state.mid;
            } else if (key === 'drag') {
                if (state.drag && !state.click) return;
                state.drag = !state.drag;
            } else if (key === 'click') {
                if (state.click && !state.drag) return;
                state.click = !state.click;
            }
            updateUI();
            save();
        };

        rootNode.addEventListener('click', () => toggle('root'));
        midNode.addEventListener('click', () => toggle('mid'));
        dragNode.addEventListener('click', () => toggle('drag'));
        clickNode.addEventListener('click', () => toggle('click'));

        updateUI();
        save();
        this._accState = state;
        this._accUpdateUI = updateUI;
        this._accSave = save;
    },

    _initConsolePage(overlay) {
        const consoleBody = overlay.querySelector('#sp-console-body');
        if (!consoleBody) {
            console.warn('控制台页面缺少 #sp-console-body');
            return;
        }
        if (!window.ConsoleLogger) {
            console.warn('ConsoleLogger 未初始化');
            return;
        }

        // ===== 先绑定所有事件监听器（不受日志渲染影响）=====

        const clearBtn = overlay.querySelector('.sp-console-clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                try {
                    window.ConsoleLogger.clear();
                    consoleBody.innerHTML = '';
                } catch (e) {
                    console.error('清空日志失败:', e);
                }
            });
        }

        const exportBtn = overlay.querySelector('.sp-console-export');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                try {
                    if (!window.ConsoleLogger) {
                        this._showMiniTip('日志模块未初始化', 'error');
                        return;
                    }
                    const text = window.ConsoleLogger.export();
                    if (!text || !text.trim()) {
                        this._showMiniTip('日志为空', 'warning');
                        return;
                    }
                    const filename = 'muse-editor-log-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.txt';
                    // 尝试下载
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
                    a.download = filename;
                    a.click();
                    // 弹出提示弹窗
                    this._showDownloadTip(text, filename);
                } catch (err) {
                    console.error('导出日志失败:', err);
                    this._showMiniTip('导出失败', 'error');
                }
            });
        }

        const copyBtn = overlay.querySelector('.sp-console-copy');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                try {
                    if (!window.ConsoleLogger) {
                        this._showMiniTip('日志模块未初始化', 'error');
                        return;
                    }
                    const text = window.ConsoleLogger.export();
                    if (!text) {
                        this._showMiniTip('日志为空', 'warning');
                        return;
                    }

                    // 直接在控制台弹窗(overlay)内创建临时textarea，不新建窗口
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0.01;z-index:1;border:0;padding:0;margin:0;overflow:hidden;pointer-events:none;';
                    overlay.appendChild(ta);
                    ta.focus();
                    ta.select();
                    ta.setSelectionRange(0, text.length);

                    let ok = false;
                    try {
                        ok = document.execCommand('copy');
                    } catch (err2) {
                        console.warn('execCommand copy 失败:', err2);
                    }

                    overlay.removeChild(ta);

                    if (ok) {
                        this._showMiniTip('已复制', 'success');
                    } else {
                        this._showMiniTip('复制失败，请手动复制', 'error');
                    }
                } catch (err) {
                    console.error('复制日志失败:', err);
                    this._showMiniTip('复制失败', 'error');
                }
            });
        }

        let unsub = null;
        const origClose = () => {
            try { if (unsub) unsub(); } catch (e) {}
            overlay.remove();
        };
        overlay.querySelector('#sp-close-btn').addEventListener('click', origClose);
        overlay.querySelector('.sp-overlay').addEventListener('click', origClose);

        // ===== 再渲染日志（即使出错也不影响事件绑定）=====
        try {
            const renderLog = (entry) => {
                try {
                    const line = document.createElement('div');
                    const type = (entry && entry.type) || 'log';
                    line.className = 'sp-console-line sp-console-' + type;
                    const timeStr = (entry && entry.time) || '--:--:--';
                    const ts = (entry && typeof entry.timestamp === 'number') ? entry.timestamp : 0;
                    const msStr = '+' + ts.toFixed(0) + 'ms';
                    const typeStr = String(type).toUpperCase().padEnd(5);
                    const msg = (entry && entry.message) || '';
                    const stack = (entry && entry.stack) || '-';

                    let html = '<span class="sp-console-time">' + escapeHtml(timeStr) + ' ' + msStr + '</span> ';
                    html += '<span class="sp-console-tag sp-tag-' + escapeHtml(type) + '">' + escapeHtml(typeStr) + '</span> ';
                    html += '<span class="sp-console-msg">' + escapeHtml(msg) + '</span>';
                    if (stack && stack !== '-') {
                        html += '<div class="sp-console-stack">→ ' + escapeHtml(stack) + '</div>';
                    }
                    line.innerHTML = html;
                    consoleBody.appendChild(line);
                    consoleBody.scrollTop = consoleBody.scrollHeight;
                } catch (e) {
                    console.warn('渲染单条日志失败:', e);
                }
            };

            if (Array.isArray(window.ConsoleLogger.logs)) {
                window.ConsoleLogger.logs.forEach(renderLog);
            }
            if (typeof window.ConsoleLogger.onLog === 'function') {
                unsub = window.ConsoleLogger.onLog(renderLog);
            }
        } catch (e) {
            console.error('初始化日志渲染失败:', e);
        }
    },    _fallbackCopy(text) {
        // Via 等浏览器要求复制必须在用户可见的交互元素上执行
        // 直接弹出弹窗，让用户在可见的 textarea 上操作
        this._showLogModal(text, 'copy');
    },

    _showLogModal(text, mode, filename) {
        const existing = document.getElementById('log-modal');
        if (existing) existing.remove();
        const isDownload = mode === 'download';
        const title = isDownload ? '📥 保存日志' : '📋 复制日志';
        const hint = isDownload
            ? '点击"保存"按钮下载，或全选下方文本手动保存' + (filename ? '为 <code style="background:var(--bg-primary);padding:2px 6px;border-radius:4px;font-size:11px;">' + escapeHtml(filename) + '</code>' : '')
            : '点击"复制"按钮复制到剪贴板，或全选下方文本手动复制';
        const modal = document.createElement('div');
        modal.className = 'settings-panel-modal';
        modal.id = 'log-modal';
        modal.style.zIndex = '9999';
        modal.innerHTML = `
            <div class="sp-overlay"></div>
            <div class="sp-dialog" style="width:480px;max-width:95%;">
                <div class="sp-title">
                    <span>${title}</span>
                    <button class="sp-close-btn" id="lm-close">✕</button>
                </div>
                <div class="sp-body">
                    <p style="font-size:12px;color:var(--text-secondary);margin:0 0 8px 0;">${hint}</p>
                    <textarea id="lm-textarea" style="width:100%;height:280px;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:6px;padding:8px;font-family:monospace;font-size:11px;resize:vertical;" readonly>${escapeHtml(text)}</textarea>
                    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
                        ${isDownload ? '<button class="scm-btn scm-save" id="lm-save">💾 保存</button>' : ''}
                        <button class="scm-btn" id="lm-copy">📋 复制</button>
                        <button class="scm-btn scm-save" id="lm-close2">关闭</button>
                    </div>
                </div>
            </div>
        `;
        const container = document.querySelector('.workspace-inner') || document.body;
        container.appendChild(modal);
        const textarea = modal.querySelector('#lm-textarea');
        modal.querySelector('#lm-close').addEventListener('click', () => modal.remove());
        modal.querySelector('#lm-close2').addEventListener('click', () => modal.remove());
        modal.querySelector('.sp-overlay').addEventListener('click', () => modal.remove());

        const copyBtn = modal.querySelector('#lm-copy');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                textarea.select();
                try {
                    document.execCommand('copy');
                    if (window.showToast) window.showToast('已复制到剪贴板', 'success');
                } catch (e) {
                    if (window.showToast) window.showToast('复制失败，请手动全选复制', 'warning');
                }
            });
        }

        const saveBtn = modal.querySelector('#lm-save');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const fn = filename || 'muse-editor-log.txt';
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
                a.download = fn;
                a.click();
                this._showDownloadTip(text, fn);
            });
        }
    },

    // 兼容旧调用
    _showExportFallbackModal(text, filename) {
        this._showLogModal(text, 'download', filename);
    },

    _showDownloadTip(text, filename) {
        const existing = document.getElementById('download-tip-modal');
        if (existing) existing.remove();
        const modal = document.createElement('div');
        modal.className = 'settings-panel-modal';
        modal.id = 'download-tip-modal';
        modal.style.zIndex = '9999';
        modal.innerHTML = `
            <div class="sp-overlay"></div>
            <div class="sp-dialog" style="width:360px;max-width:90%;">
                <div class="sp-title">
                    <span>💾 下载提示</span>
                    <button class="sp-close-btn" id="dt-close">✕</button>
                </div>
                <div class="sp-body">
                    <p style="font-size:13px;color:var(--text-primary);margin:0 0 12px 0;line-height:1.5;">已尝试下载 <code style="background:var(--bg-primary);padding:2px 6px;border-radius:4px;font-size:11px;">${escapeHtml(filename)}</code><br>如果浏览器未开始下载，请使用下方复制按钮手动保存。</p>
                    <div style="display:flex;gap:8px;justify-content:flex-end;">
                        <button class="scm-btn" id="dt-copy">📋 复制</button>
                        <button class="scm-btn scm-save" id="dt-close2">关闭</button>
                    </div>
                </div>
            </div>
        `;
        const container = document.querySelector('.workspace-inner') || document.body;
        container.appendChild(modal);
        modal.querySelector('#dt-close').addEventListener('click', () => modal.remove());
        modal.querySelector('#dt-close2').addEventListener('click', () => modal.remove());
        modal.querySelector('.sp-overlay').addEventListener('click', () => modal.remove());
        modal.querySelector('#dt-copy').addEventListener('click', () => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;z-index:99999;border:0;padding:0;margin:0;overflow:hidden;';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
            if (ok) {
                this._showMiniTip('已复制', 'success');
            } else {
                this._showMiniTip('复制失败', 'error');
            }
        });
    },

    _showMiniTip(msg, type) {
        type = type || 'info';
        const container = document.querySelector('.workspace-inner') || document.body;
        const tip = document.createElement('div');
        tip.className = 'mini-tip mini-tip-' + type;
        tip.textContent = msg;
        tip.style.cssText = 'position:fixed;bottom:20%;left:50%;transform:translateX(-50%) translateY(10px);background:rgba(0,0,0,0.75);color:#fff;padding:6px 16px;border-radius:20px;font-size:12px;z-index:99999;opacity:0;transition:opacity 0.3s ease,transform 0.3s ease;pointer-events:none;white-space:nowrap;backdrop-filter:blur(4px);';
        container.appendChild(tip);
        requestAnimationFrame(() => {
            tip.style.opacity = '1';
            tip.style.transform = 'translateX(-50%) translateY(0)';
        });
        setTimeout(() => {
            tip.style.opacity = '0';
            tip.style.transform = 'translateX(-50%) translateY(10px)';
            setTimeout(() => { if (tip.parentNode) tip.parentNode.removeChild(tip); }, 300);
        }, 1500);
    },

    openSettingsPanel() {
        const existing = document.getElementById('settings-panel-modal');
        if (existing) existing.remove();

        const isEditor = window.AppState && window.AppState.mode === 'editor';
        const ce = window.ChartEditor;
        const perfMode = (ce && ce.state.perfMode) || 'smooth';
        const showTouch = localStorage.getItem('muse-editor-show-touch') === 'true';

        const overlay = document.createElement('div');
        overlay.className = 'settings-panel-modal';
        overlay.id = 'settings-panel-modal';
        overlay.innerHTML = `
            <div class="sp-overlay"></div>
            <div class="sp-dialog">
                <div class="sp-title">
                    <span>⚙️ 设置</span>
                    <button class="sp-close-btn" id="sp-close-btn">✕</button>
                </div>
                <div class="sp-tabs">
                    <button class="sp-tab active" data-tab="shortcut">快捷</button>
                    <button class="sp-tab" data-tab="accessibility">辅助</button>
                    <button class="sp-tab" data-tab="track">轨道</button>
                    <button class="sp-tab" data-tab="advanced">高级</button>
                    <button class="sp-tab" data-tab="console">控制台</button>
                </div>
                <div class="sp-body">
                    <!-- 快捷页 -->
                    <div class="sp-page active" data-page="shortcut">
                        <div class="sp-shortcut-header">
                            <span class="sp-section-title">快捷设置</span>
                            <button class="sp-edit-btn" id="sp-shortcut-edit">编辑</button>
                        </div>
                        <div class="sp-shortcut-list" id="sp-shortcut-list"></div>
                        <div class="sp-shortcut-add-wrap" id="sp-shortcut-add-wrap" style="display:none;">
                            <button class="sp-shortcut-add-btn" id="sp-shortcut-add">+ 添加快捷项</button>
                        </div>
                    </div>
                    <!-- 辅助功能页 -->
                    <div class="sp-page" data-page="accessibility">
                        <div class="sp-section">
                            <div class="sp-section-title">谱面导航条</div>
                            <div class="sp-tree-wrap">
                                <svg class="sp-tree-svg" id="sp-tree-svg" viewBox="0 0 340 140" preserveAspectRatio="xMidYMid meet">
                                    <!-- 连线 -->
                                    <path class="sp-tree-line" id="tree-line-root" d="M 50 70 L 140 70" />
                                    <path class="sp-tree-line" id="tree-line-mid-up" d="M 140 70 Q 190 40 240 30" />
                                    <path class="sp-tree-line" id="tree-line-mid-down" d="M 140 70 Q 190 100 240 110" />

                                    <!-- 根节点 -->
                                    <g class="sp-tree-node" id="tree-node-root" data-node="root">
                                        <circle cx="50" cy="70" r="14" />
                                        <text x="50" y="42" text-anchor="middle" class="sp-tree-text">显示横条</text>
                                    </g>
                                    <!-- 中节点 -->
                                    <g class="sp-tree-node" id="tree-node-mid" data-node="mid">
                                        <circle cx="140" cy="70" r="12" />
                                        <text x="140" y="42" text-anchor="middle" class="sp-tree-text">快速跳转</text>
                                    </g>
                                    <!-- 拖动节点 -->
                                    <g class="sp-tree-node" id="tree-node-drag" data-node="drag">
                                        <circle cx="240" cy="30" r="11" />
                                        <text x="240" y="8" text-anchor="middle" class="sp-tree-text">拖动</text>
                                    </g>
                                    <!-- 点击节点 -->
                                    <g class="sp-tree-node" id="tree-node-click" data-node="click">
                                        <circle cx="240" cy="110" r="11" />
                                        <text x="240" y="138" text-anchor="middle" class="sp-tree-text">点击</text>
                                    </g>
                                </svg>
                            </div>
                            <div class="sp-tree-hint" id="sp-tree-hint">点击节点切换状态</div>
                        </div>
                    </div>
                    <!-- 轨道页 -->
                    <div class="sp-page" data-page="track">
                        ${isEditor ? `
                        <div class="sp-section">
                            <div class="sp-section-title">初始轨道数</div>
                            <div class="sp-track-presets">
                                <button class="sp-track-btn" data-count="1">
                                    <div class="sp-preview"><div class="sp-line" style="left:50%"></div></div>
                                    <span>1 轨</span>
                                </button>
                                <button class="sp-track-btn" data-count="2">
                                    <div class="sp-preview"><div class="sp-line" style="left:33%"></div><div class="sp-line" style="left:66%"></div></div>
                                    <span>2 轨</span>
                                </button>
                                <button class="sp-track-btn" data-count="3">
                                    <div class="sp-preview"><div class="sp-line" style="left:25%"></div><div class="sp-line" style="left:50%"></div><div class="sp-line" style="left:75%"></div></div>
                                    <span>3 轨</span>
                                </button>
                                <button class="sp-track-btn" data-count="4">
                                    <div class="sp-preview"><div class="sp-line" style="left:20%"></div><div class="sp-line" style="left:40%"></div><div class="sp-line" style="left:60%"></div><div class="sp-line" style="left:80%"></div></div>
                                    <span>4 轨</span>
                                </button>
                            </div>
                        </div>
                        ` : '<div class="sp-section"><div class="sp-section-title">轨道设置</div><p style="color:var(--text-tertiary);font-size:13px;">请在编辑器中设置轨道数</p></div>'}
                    </div>
                    <!-- 高级页 -->
                    <div class="sp-page" data-page="advanced">
                        <div class="sp-section">
                            <div class="sp-section-title">性能模式</div>
                            <div class="sp-perf-options" id="sp-adv-perf-options">
                                <button class="sp-perf-btn ${perfMode === 'smooth' ? 'active' : ''}" data-mode="smooth">
                                    <div class="sp-perf-name">流畅</div>
                                    <div class="sp-perf-desc">平衡性能与精度</div>
                                </button>
                                <button class="sp-perf-btn ${perfMode === 'aggressive' ? 'active' : ''}" data-mode="aggressive">
                                    <div class="sp-perf-name">激进</div>
                                    <div class="sp-perf-desc">更高渲染精度，音频与谱面更紧密同步</div>
                                </button>
                            </div>
                        </div>
                        <div class="sp-section">
                            <div class="sp-section-title">显示</div>
                            <div class="sp-adv-toggle-row">
                                <label class="sp-sc-toggle">
                                    <input type="checkbox" id="sp-adv-show-touch" ${showTouch ? 'checked' : ''}>
                                    <span class="sp-sc-toggle-track"><span class="sp-sc-toggle-thumb"></span></span>
                                </label>
                                <span class="sp-adv-toggle-label">显示触摸点</span>
                            </div>
                            <div class="sp-adv-toggle-row">
                                <label class="sp-sc-toggle">
                                    <input type="checkbox" id="sp-adv-show-grid" ${localStorage.getItem('muse-editor-show-grid') !== 'false' ? 'checked' : ''}>
                                    <span class="sp-sc-toggle-track"><span class="sp-sc-toggle-thumb"></span></span>
                                </label>
                                <span class="sp-adv-toggle-label">显示网格线</span>
                            </div>
                        </div>
                        <div class="sp-section">
                            <div class="sp-section-title">音频</div>
                            <div class="sp-adv-toggle-row">
                                <label class="sp-sc-toggle">
                                    <input type="checkbox" id="sp-adv-sound-preview" ${localStorage.getItem('muse-editor-sound-preview') !== 'false' ? 'checked' : ''}>
                                    <span class="sp-sc-toggle-track"><span class="sp-sc-toggle-thumb"></span></span>
                                </label>
                                <span class="sp-adv-toggle-label">音效预览</span>
                            </div>
                        </div>
                        <div class="sp-section">
                            <div class="sp-section-title">数据</div>
                            <div class="sp-adv-toggle-row">
                                <label class="sp-sc-toggle">
                                    <input type="checkbox" id="sp-adv-auto-save" ${localStorage.getItem('muse-editor-auto-save') === 'true' ? 'checked' : ''}>
                                    <span class="sp-sc-toggle-track"><span class="sp-sc-toggle-thumb"></span></span>
                                </label>
                                <span class="sp-adv-toggle-label">自动保存</span>
                            </div>
                        </div>
                        <div class="sp-section">
                            <div class="sp-section-title">呼吸动画</div>
                            <div class="sp-adv-toggle-row">
                                <label class="sp-sc-toggle">
                                    <input type="checkbox" id="sp-adv-breathe" ${localStorage.getItem('muse-editor-breathe-anim') !== 'false' ? 'checked' : ''}>
                                    <span class="sp-sc-toggle-track"><span class="sp-sc-toggle-thumb"></span></span>
                                </label>
                                <span class="sp-adv-toggle-label">启用呼吸动画</span>
                            </div>
                            <div class="sp-row" style="margin-top:8px;">
                                <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px;">闪烁频率</label>
                                <input type="range" id="sp-adv-breathe-speed" min="0.5" max="3" step="0.1" value="${localStorage.getItem('muse-editor-breathe-speed') || '1.5'}" style="width:100%;">
                            </div>
                            <div class="sp-row" style="margin-top:8px;">
                                <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px;">不透明度范围</label>
                                <div class="dual-range" id="sp-adv-breathe-opacity">
                                    <div class="dual-range-track"></div>
                                    <div class="dual-range-fill"></div>
                                    <div class="dual-range-thumb min"></div>
                                    <div class="dual-range-thumb max"></div>
                                    <div class="dual-range-labels">
                                        <span class="dr-label-min">40%</span>
                                        <span class="dr-label-max">100%</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <!-- 控制台页 -->
                    <div class="sp-page" data-page="console">
                        <div class="sp-console-header">
                            <span class="sp-console-title">📋 实时日志</span>
                            <div class="sp-console-actions">
                                <button class="sp-console-export" title="导出日志">📥</button>
                                <button class="sp-console-copy" title="复制全部日志">📋</button>
                                <button class="sp-console-clear">清空</button>
                            </div>
                        </div>
                        <div class="sp-console-body" id="sp-console-body"></div>
                    </div>
                </div>
            </div>
        `;

        const inner = document.querySelector('.workspace-inner') || document.body;
        inner.appendChild(overlay);

        // ===== 页签切换 =====
        const tabs = overlay.querySelectorAll('.sp-tab');
        const pages = overlay.querySelectorAll('.sp-page');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tab;
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                pages.forEach(p => {
                    p.classList.toggle('active', p.dataset.page === target);
                });
            });
        });

        // ===== 初始化各页 =====
        this._initShortcutPage(overlay);
        this._initAccessibilityPage(overlay);
        this._initTrackPage(overlay, isEditor);
        this._initAdvancedPage(overlay);
        this._initConsolePage(overlay);
    },

    updateCenterWidth() {
        const center = document.getElementById('editor-center');
        if (!center) return;
        const height = center.clientHeight;
        const width = height * this.targetRatio;
        center.style.width = width + 'px';
        center.style.flex = 'none';
    },

    bindRatioControl() {
        const presets = document.querySelectorAll('.ratio-presets button');
        presets.forEach(btn => {
            btn.addEventListener('click', () => {
                presets.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.targetRatio = parseFloat(btn.dataset.ratio);
                this.updateCenterWidth();
                if (window.EditorTimeline) EditorTimeline.render();
            });
        });
    },

    _updateRhythmButtonsDisabled(disabled) {
        const presets = document.querySelectorAll('.rhythm-presets button');
        presets.forEach(btn => {
            const snap = parseInt(btn.dataset.snap, 10);
            if (disabled && snap !== 0) {
                btn.classList.add('disabled');
            } else {
                btn.classList.remove('disabled');
            }
        });
    },

    bindRhythmControl() {
        const presets = document.querySelectorAll('.rhythm-presets button');
        presets.forEach(btn => {
            btn.addEventListener('click', () => {
                const showGrid = localStorage.getItem('muse-editor-show-grid') !== 'false';
                const snap = parseInt(btn.dataset.snap, 10);
                // 网格关闭时只能选全拍
                if (!showGrid && snap !== 0) {
                    if (window.showToast) window.showToast('请先开启显示网格线', 'warning');
                    return;
                }
                presets.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (window.ChartEditor) window.ChartEditor.state.snap = snap;
                if (window.EditorTimeline) EditorTimeline.render();
            });
        });
    },

    refreshTrackInfo() {
        // 轨道列表已移至时间轴交互，此处不再维护左侧面板轨道列表
    },

    
    showTrackSelector() {
        return new Promise((resolve) => {
            const inner = document.querySelector('.workspace-inner');
            if (!inner) { resolve(3); return; }

            const existing = document.getElementById('track-selector-modal');
            if (existing) existing.remove();

            const modal = document.createElement('div');
            modal.className = 'track-selector-modal';
            modal.id = 'track-selector-modal';
            modal.innerHTML = `
                <div class="ts-overlay"></div>
                <div class="ts-dialog">
                    <div class="ts-title">选择初始轨道数</div>
                    <div class="ts-options"></div>
                </div>
            `;

            const options = modal.querySelector('.ts-options');
            const configs = [
                { count: 1, name: '1 轨', lines: [50] },
                { count: 2, name: '2 轨', lines: [33.33, 66.67] },
                { count: 3, name: '3 轨', lines: [25, 50, 75] },
                { count: 4, name: '4 轨', lines: [20, 40, 60, 80] },
            ];

            configs.forEach(cfg => {
                const btn = document.createElement('button');
                btn.className = 'ts-btn';
                btn.innerHTML = `
                    <div class="ts-preview"></div>
                    <span class="ts-name">${cfg.name}</span>
                `;
                const preview = btn.querySelector('.ts-preview');
                cfg.lines.forEach(pct => {
                    const line = document.createElement('div');
                    line.className = 'ts-line';
                    line.style.cssText = `position:absolute;top:0;left:${pct}%;width:1px;height:100%;background:var(--accent-primary);`;
                    preview.appendChild(line);
                });

                btn.addEventListener('click', () => {
                    modal.remove();
                    resolve(cfg.count);
                });
                options.appendChild(btn);
            });

            inner.appendChild(modal);
        });
    }
};

window.EditorPanels = EditorPanels;

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
