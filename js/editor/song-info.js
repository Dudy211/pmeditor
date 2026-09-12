/**
 * editor/song-info.js — 歌曲信息面板
 * 管理谱面元数据，渲染右侧面板中的歌曲信息区域
 */

const SongInfoPanel = {
    fields: [
        { key: 'songName', label: '歌曲名称', placeholder: '未命名' },
        { key: 'songArtist', label: '歌曲作者', placeholder: '未知' },
        { key: 'charter', label: '谱面作者', placeholder: '未知' },
        { key: 'illustrator', label: '曲绘作者', placeholder: '未知' },
    ],

    init() {},

    getMeta() {
        const ce = window.ChartEditor;
        if (!ce || !ce.state.songMeta) {
            return this._defaultMeta();
        }
        return { ...this._defaultMeta(), ...ce.state.songMeta };
    },

    setMeta(key, value) {
        const ce = window.ChartEditor;
        if (!ce) return;
        if (!ce.state.songMeta) {
            ce.state.songMeta = this._defaultMeta();
        }
        ce.state.songMeta[key] = value;
        if (window.AppState) window.AppState.isDirty = true;
    },

    _defaultMeta() {
        const meta = {};
        for (const f of this.fields) meta[f.key] = '';
        meta.modifiers = [];
        return meta;
    },

    loadFromChart(data) {
        // 降级兼容：旧谱面格式中元数据直接存在 JSON 里
        const ce = window.ChartEditor;
        if (!ce) return;
        if (!data || (!data.meta && !data.songName)) return;
        ce.state.songMeta = ce.state.songMeta || {};
        for (const f of this.fields) {
            if (data[f.key]) ce.state.songMeta[f.key] = data[f.key];
        }
        if (data.songName && !ce.state.songMeta.songName) {
            ce.state.songMeta.songName = data.songName;
        }
        if (data.meta && data.meta.songName && !ce.state.songMeta.songName) {
            ce.state.songMeta.songName = data.meta.songName;
        }
        if (data.meta && data.meta.author && !ce.state.songMeta.charter) {
            ce.state.songMeta.charter = data.meta.author;
        }
    },

    saveToChart(data) {
        // 元数据不再写入谱面 JSON，仅保存在内存和 meta.yaml 中
    },

    render(container) {
        if (!container) return;
        const meta = this.getMeta();
        const ce = window.ChartEditor;
        const isFromZip = ce ? ce.state.isFromZipPackage : false;
        const modifiers = meta.modifiers || [];

        let html = `<div class="si-section"><div class="si-section-title">📋 歌曲信息</div>`;

        for (const f of this.fields) {
            const value = meta[f.key] || '';
            const isCharter = f.key === 'charter';
            const disabledAttr = (isCharter && isFromZip) ? 'disabled readonly' : '';
            const titleAttr = (isCharter && isFromZip) ? 'title="谱面包来源，不可修改"' : '';
            const readonlyClass = (isCharter && isFromZip) ? 'si-field-input-readonly' : '';
            html += `
                <div class="si-field-row">
                    <label class="si-field-label">${f.label}</label>
                    <input type="text" class="si-field-input ${readonlyClass}" data-key="${f.key}"
                        value="${this._escapeHtml(value)}" placeholder="${f.placeholder}"
                        ${disabledAttr} ${titleAttr}>
                </div>
            `;
            // 在谱面作者下方插入修改者列表
            if (isCharter && isFromZip) {
                html += `<div class="si-modifier-list" id="si-modifier-list">`;
                modifiers.forEach((mod, idx) => {
                    html += `
                        <div class="si-field-row si-modifier-row">
                            <label class="si-field-label">修改者</label>
                            <input type="text" class="si-field-input si-modifier-input" data-modifier-idx="${idx}"
                                value="${this._escapeHtml(mod)}" placeholder="修改者名称">
                        </div>
                    `;
                });
                html += `</div>`;
                html += `
                    <div class="si-field-row si-modifier-btns">
                        <label class="si-field-label"></label>
                        <button class="si-modifier-btn si-modifier-add" id="si-modifier-add" title="添加修改者">+</button>
                        <button class="si-modifier-btn si-modifier-del" id="si-modifier-del" title="删除最后一个修改者">−</button>
                    </div>
                `;
            }
        }

        const bpm = ce ? ce.state.bpm : null;
        html += `
            <div class="si-section" style="margin-top:12px;">
                <div class="si-section-title">🎵 BPM</div>
                <div class="si-field-row">
                    <label class="si-field-label">BPM</label>
                    <input type="number" class="si-field-input" id="si-bpm-input"
                        value="${bpm || ''}" min="30" max="114514" step="1" placeholder="未设置">
                    <button class="si-bpm-btn-inline" id="si-btn-search-bpm" title="在 songbpm.com 搜索">🔍</button>
                    <button class="si-bpm-btn-inline si-bpm-btn-accent" id="si-btn-analyze-bpm" title="自动分析 BPM">⚡</button>
                </div>
                <div class="si-progress-wrap" id="si-progress-wrap" style="display:none;">
                    <div class="si-progress-bar">
                        <div class="si-progress-fill" id="si-progress-fill" style="width:0%"></div>
                    </div>
                    <div class="si-progress-text" id="si-progress-text"></div>
                </div>
                <div class="si-bpm-hint" id="si-bpm-hint">按空格播放音频以辅助判断</div>
            </div>
        `;
        html += `</div>`;
        container.innerHTML = html;

        // 绑定普通字段
        container.querySelectorAll('.si-field-input[data-key]').forEach(input => {
            if (input.disabled) return;
            input.addEventListener('change', () => this.setMeta(input.dataset.key, input.value.trim()));
            input.addEventListener('blur', () => this.setMeta(input.dataset.key, input.value.trim()));
        });

        // 绑定修改者字段
        container.querySelectorAll('.si-modifier-input').forEach(input => {
            input.addEventListener('change', () => this._setModifier(input.dataset.modifierIdx, input.value.trim()));
            input.addEventListener('blur', () => this._setModifier(input.dataset.modifierIdx, input.value.trim()));
        });

        // 绑定 + / - 按钮
        const addBtn = container.querySelector('#si-modifier-add');
        const delBtn = container.querySelector('#si-modifier-del');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                this._addModifier();
                this.render(container);
            });
        }
        if (delBtn) {
            delBtn.addEventListener('click', () => {
                this._removeLastModifier();
                this.render(container);
            });
        }

        const bpmInput = container.querySelector('#si-bpm-input');
        if (bpmInput) {
            bpmInput.addEventListener('change', () => {
                const raw = bpmInput.value.trim();
                if (!raw) {
                    if (ce) {
                        ce.state.bpm = null;
                        bpmInput.value = '';
                        const toolbarInput = document.getElementById('ed-bpm-input');
                        if (toolbarInput) toolbarInput.value = '';
                        if (window.showToast) window.showToast('BPM 已清空', 'info');
                        ce.updateStatus();
                        if (window.EditorTimeline) EditorTimeline.render();
                    }
                    return;
                }
                let val = parseInt(raw, 10);
                if (isNaN(val) || val < 30) val = 30;
                if (val > 114514) val = 114514;
                if (ce) {
                    ce.state.bpm = val;
                    bpmInput.value = val;
                    const toolbarInput = document.getElementById('ed-bpm-input');
                    if (toolbarInput) toolbarInput.value = val;
                    if (window.showToast) window.showToast('BPM 已设置为 ' + val, 'info');
                    ce.updateStatus();
                    if (window.EditorTimeline) EditorTimeline.render();
                }
            });
        }

        const searchBtn = container.querySelector('#si-btn-search-bpm');
        const analyzeBtn = container.querySelector('#si-btn-analyze-bpm');
        const progressWrap = container.querySelector('#si-progress-wrap');
        const progressFill = container.querySelector('#si-progress-fill');
        const progressText = container.querySelector('#si-progress-text');

        if (searchBtn) {
            searchBtn.addEventListener('click', () => {
                const meta = this.getMeta();
                const songName = meta.songName;
                const hintEl = container.querySelector('#si-bpm-hint');

                if (!songName) {
                    if (hintEl) {
                        hintEl.innerHTML = '⚠️ 请先填写上方的"歌曲名称"';
                        hintEl.style.color = '#ff6b6b';
                        setTimeout(() => {
                            hintEl.innerHTML = '按空格播放音频以辅助判断';
                            hintEl.style.color = '';
                        }, 3000);
                    }
                    return;
                }

                this._copyToClipboard(songName);
                this._showSearchPrompt('https://songbpm.com/', songName);
            });
        }

        if (analyzeBtn) {
            analyzeBtn.addEventListener('click', async () => {
                if (!ce || !ce.audioBuffer) {
                    if (window.showToast) window.showToast('请先加载音频', 'warning');
                    return;
                }
                analyzeBtn.disabled = true;
                analyzeBtn.textContent = '⏳';
                if (progressWrap) progressWrap.style.display = 'block';

                try {
                    const bpm = await BPMAnalyzer.analyze(ce.audioBuffer, (pct, msg) => {
                        if (progressFill) progressFill.style.width = pct + '%';
                        if (progressText) progressText.textContent = msg || (pct + '%');
                    });
                    if (ce) {
                        ce.state.bpm = bpm;
                        const siInput = document.getElementById('si-bpm-input');
                        if (siInput) siInput.value = bpm;
                        if (window.showToast) window.showToast('分析完成: ' + bpm + ' BPM', 'success');
                        ce.updateStatus();
                        if (window.EditorTimeline) EditorTimeline.render();
                    }
                } catch (err) {
                    if (window.showToast) window.showToast('BPM 分析失败: ' + err.message, 'error');
                } finally {
                    analyzeBtn.disabled = false;
                    analyzeBtn.textContent = '⚡';
                    if (progressWrap) {
                        progressWrap.style.display = 'none';
                        if (progressFill) progressFill.style.width = '0%';
                        if (progressText) progressText.textContent = '';
                    }
                }
            });
        }
    },

    // ===== 修改者管理 =====
    _setModifier(idx, value) {
        const ce = window.ChartEditor;
        if (!ce || !ce.state.songMeta) return;
        const modifiers = ce.state.songMeta.modifiers || [];
        const i = parseInt(idx, 10);
        if (i >= 0 && i < modifiers.length) {
            modifiers[i] = value;
            if (window.AppState) window.AppState.isDirty = true;
        }
    },

    _addModifier() {
        const ce = window.ChartEditor;
        if (!ce) return;
        if (!ce.state.songMeta) ce.state.songMeta = this._defaultMeta();
        if (!ce.state.songMeta.modifiers) ce.state.songMeta.modifiers = [];
        ce.state.songMeta.modifiers.push('');
        if (window.AppState) window.AppState.isDirty = true;
    },

    _removeLastModifier() {
        const ce = window.ChartEditor;
        if (!ce || !ce.state.songMeta || !ce.state.songMeta.modifiers) return;
        if (ce.state.songMeta.modifiers.length > 0) {
            ce.state.songMeta.modifiers.pop();
            if (window.AppState) window.AppState.isDirty = true;
        }
    },

    /**
     * 显示搜索倒计时弹窗
     */
    _showSearchPrompt(url, songName) {
        let modal = document.getElementById('si-search-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'si-search-modal';
            modal.className = 'si-search-modal';
            modal.innerHTML = `
                <div class="si-search-overlay"></div>
                <div class="si-search-box" style="max-width:400px;height:auto;">
                    <div class="si-search-header">
                        <span class="si-search-title">🔍 即将跳转 songbpm.com</span>
                        <button class="si-search-close" id="si-search-close" title="关闭">✕</button>
                    </div>
                    <div class="si-search-body" style="padding:24px 16px;">
                        <div class="si-search-fallback" style="display:flex;position:static;background:transparent;gap:10px;">
                            <div class="si-search-fallback-icon">📋</div>
                            <div class="si-search-fallback-text" style="text-align:center;max-width:100%;word-break:break-all;">
                                歌曲名称「<strong id="si-search-song-name"></strong>」<br>已复制到剪贴板
                            </div>
                            <div class="si-search-fallback-text" id="si-search-countdown" style="font-size:18px;font-weight:600;color:var(--accent-primary);">3</div>
                            <div style="display:flex;gap:10px;width:100%;justify-content:center;">
                                <button class="si-search-fallback-link" id="si-search-open-btn" style="border:none;cursor:pointer;flex:1;max-width:140px;">立即跳转</button>
                                <button class="si-search-fallback-link" id="si-search-cancel-btn" style="border:none;cursor:pointer;background:var(--bg-secondary);color:var(--text-secondary);flex:1;max-width:140px;">取消</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            const mountEl = document.getElementById('workspace-inner') || document.body;
            mountEl.appendChild(modal);
        }

        // 更新歌曲名
        const nameEl = document.getElementById('si-search-song-name');
        if (nameEl) nameEl.textContent = songName || '';

        // 清除之前的倒计时
        if (this._searchTimer) {
            clearInterval(this._searchTimer);
            this._searchTimer = null;
        }

        const countdownEl = document.getElementById('si-search-countdown');
        const openBtn = document.getElementById('si-search-open-btn');
        const cancelBtn = document.getElementById('si-search-cancel-btn');
        const closeBtn = document.getElementById('si-search-close');

        let seconds = 3;
        if (countdownEl) countdownEl.textContent = seconds;

        const doJump = () => {
            if (this._searchTimer) {
                clearInterval(this._searchTimer);
                this._searchTimer = null;
            }
            modal.style.display = 'none';
            window.open(url, '_blank');
        };

        const doCancel = () => {
            if (this._searchTimer) {
                clearInterval(this._searchTimer);
                this._searchTimer = null;
            }
            modal.style.display = 'none';
            if (window.showToast) window.showToast('已取消跳转', 'info');
        };

        // 绑定按钮
        if (openBtn) {
            const newOpen = openBtn.cloneNode(true);
            openBtn.parentNode.replaceChild(newOpen, openBtn);
            newOpen.addEventListener('click', doJump);
        }
        if (cancelBtn) {
            const newCancel = cancelBtn.cloneNode(true);
            cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
            newCancel.addEventListener('click', doCancel);
        }
        if (closeBtn) {
            const newClose = closeBtn.cloneNode(true);
            closeBtn.parentNode.replaceChild(newClose, closeBtn);
            newClose.addEventListener('click', doCancel);
        }
        modal.querySelector('.si-search-overlay').onclick = doCancel;

        // 倒计时
        this._searchTimer = setInterval(() => {
            seconds--;
            if (countdownEl) countdownEl.textContent = seconds;
            if (seconds <= 0) {
                doJump();
            }
        }, 1000);

        modal.style.display = 'flex';
    },

    _copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => this._fallbackCopy(text));
        } else {
            this._fallbackCopy(text);
        }
    },

    _fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        ta.setAttribute('readonly', '');
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
    },

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    updateBPM(bpm) {
        const input = document.getElementById('si-bpm-input');
        if (input) input.value = bpm || '';
    }
};

window.SongInfoPanel = SongInfoPanel;
