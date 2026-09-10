/**
 * editor/core.js — 编辑器核心模块
 */

const ChartEditor = {
    _inited: false,
    container: null,
    audioContext: null,
    audioBuffer: null,
    sourceNode: null,
    audioStartTime: 0,
    audioOffset: 0,
    playTimer: null,

    state: {
        playing: false,
        currentTime: 0,
        duration: 0,
        bpm: null,       // 默认空，需用户设置或自动检测
        notes: [],
        selectedNotes: [],
        history: [],
        historyIndex: -1,
        zoom: 1.0,
        snap: 0,
        trackCount: 3,
        activeTrack: 0,
        noteType: 'tap',       // tap | hold | switch
        editorMode: 'place',   // place | select | delete
        songMeta: {},         // 歌曲元数据
        chartId: null,        // 谱面唯一标识（写入谱面JSON，撞名区分用）
        holdDrawing: null,     // 正在绘制 hold 的状态
        perfMode: localStorage.getItem('muse-editor-perf-mode') || 'smooth',
    },

    // ===== 动态轨道数查询 =====
    getTrackCountAtTime(time, excludeNoteId) {
        let count = this.state.trackCount || 3;
        let lastSwitchTime = -Infinity;
        for (const note of this.state.notes) {
            if (note.type === 'switch' && note.time <= time && note.time > lastSwitchTime) {
                // 渲染变轨音符自身时，排除它自己（它应该在变化前的轨道上）
                if (excludeNoteId && note.id === excludeNoteId) continue;
                count = note.targetTrackCount || 3;
                lastSwitchTime = note.time;
            }
        }
        return Math.max(1, Math.min(4, count));
    },

    adjustNotesAfterSwitch(switchNote) {
        const newCount = Math.max(1, Math.min(4, switchNote.targetTrackCount || 3));
        switchNote.targetTrackCount = newCount; // 确保自身值合法
        const switchTime = switchNote.time;
        let hasChange = false;
        // 调整该 switch 之后的所有音符（包括其他 switch 音符）
        // 注意：必须按“每个音符自身时刻的有效轨道数”来收敛，
        // 不能一律用 newCount —— 否则后续还有变轨恢复轨道数时，
        // 恢复段落的音符会被错误压到本条变轨的轨道上（数据被覆盖，无法恢复）。
        for (const note of this.state.notes) {
            if (note.id === switchNote.id) continue;
            if (note.time >= switchTime) {
                const countAtNote = this.getTrackCountAtTime(note.time);
                if (note.track >= countAtNote) {
                    note.track = countAtNote - 1;
                    hasChange = true;
                }
            }
        }
        // 总是保存历史并触发渲染（因为标签需要更新）
        this.pushHistory();
        if (window.EditorTimeline) window.EditorTimeline.render();
        if (hasChange && window.showToast) {
            window.showToast('已自动调整超出范围的音符', 'info');
        }
    },

    init() {
        if (this._inited) return;
        this._inited = true;

        this.resolveTrackCount().then(count => {
            this.state.trackCount = count;
            this.state.activeTrack = 0;
            this.createDOM();
            this.bindEvents();
            this.bindMinimapEvents();
            this.bindToolbar();
            EditorPanels.init();
            EditorPanels.refreshPropertyPanel();
            EditorTimeline.init();
            this.loadAudio();
            // 自动加载当前选中的谱面
            if (window.AppState && window.AppState.chart && window.AppState.chart.file) {
                this.loadChart(window.AppState.chart);
            }
            const chartLabel = document.getElementById('ed-chart-label');
            if (chartLabel && window.AppState && window.AppState.chart) {
                chartLabel.textContent = window.AppState.chart.name;
                chartLabel.title = window.AppState.chart.name;
            }
            const musicLabel = document.getElementById('ed-music-label');
            if (musicLabel && window.AppState && window.AppState.music) {
                musicLabel.textContent = window.AppState.music.name;
                musicLabel.title = window.AppState.music.name;
            }
            if (this._pendingShow) {
                this._pendingShow = false;
                this.show();
            }
            console.log('🎹 ChartEditor initialized, tracks:', count);
        });
    },

    async resolveTrackCount() {
        const chart = window.AppState && window.AppState.chart;

        // 1. 从谱面文件读取（最可靠，不受播放器实时状态污染）
        if (chart && chart.file) {
            try {
                const text = await chart.file.text();
                const data = JSON.parse(text);
                if (typeof data.trackCount === 'number' && data.trackCount >= 1 && data.trackCount <= 4) {
                    return data.trackCount;
                }
                if (typeof data.trackCount === 'string') {
                    const parsed = parseInt(data.trackCount, 10);
                    if (!isNaN(parsed) && parsed >= 1 && parsed <= 4) return parsed;
                }
                if (data.config && typeof data.config.initTrackCount === 'number'
                    && data.config.initTrackCount >= 1 && data.config.initTrackCount <= 4) {
                    return data.config.initTrackCount;
                }
                if (data.config && typeof data.config.initTrackCount === 'string') {
                    const parsed = parseInt(data.config.initTrackCount, 10);
                    if (!isNaN(parsed) && parsed >= 1 && parsed <= 4) return parsed;
                }
                // 从谱面音符推断（最后一个 switch 音符的目标轨道数）
                const notes = data.notes || data.timeline || [];
                for (let i = notes.length - 1; i >= 0; i--) {
                    const note = notes[i];
                    const type = Array.isArray(note) ? note[0] : note.type;
                    const extra = Array.isArray(note) ? note[3] : note.targetTrackCount;
                    if (type === 'switch' && extra) {
                        const count = typeof extra === 'number' ? extra : parseInt(extra, 10);
                        if (!isNaN(count) && count >= 1 && count <= 4) {
                            console.log('从谱面音符推断轨道数:', count);
                            return count;
                        }
                    }
                }
            } catch (e) { /* 解析失败走兜底 */ }
        }

        // 2. 从谱面包 meta.yaml 中获取轨道数
        if (chart && chart.zipId && window.zipPackages) {
            const pkg = window.zipPackages[chart.zipId];
            if (pkg && pkg.meta && pkg.meta.trackCount) {
                const parsed = parseInt(pkg.meta.trackCount, 10);
                if (!isNaN(parsed) && parsed >= 1 && parsed <= 4) {
                    console.log('从谱面包 meta 获取轨道数:', parsed);
                    return parsed;
                }
            }
        }

        // 3. 播放器快照兜底（从播放器切换回来且谱面无明确轨道数时）
        if (window.ChartPlayer && window.ChartPlayer.state && window.ChartPlayer.state.trackCount) {
            const count = window.ChartPlayer.state.trackCount;
            if (count >= 1 && count <= 4) {
                console.log('从播放器获取轨道数:', count);
                return count;
            }
        }

        // 4. 无任何依据 → 弹出轨道数选择器
        return EditorPanels.showTrackSelector();
    },

    createDOM() {
        const inner = document.querySelector('.workspace-inner');
        if (!inner) return;
        const existing = inner.querySelector('.editor-container');
        if (existing) existing.remove();

        const el = document.createElement('div');
        el.className = 'editor-container';
        el.id = 'editor-container';

        el.appendChild(EditorToolbar.create());
        el.appendChild(EditorPanels.create());
        el.appendChild(EditorFooter.create());

        inner.appendChild(el);
        this.container = el;

        EditorPanels.init();
    },

    bindEvents() {
        document.addEventListener('click', () => this.closeAllEditorDropdowns());

        document.addEventListener('keydown', (e) => {
            if (!this.container || !this.container.classList.contains('active')) return;

            if (e.key === 'Escape') {
                e.preventDefault();
                this.closeAllEditorDropdowns();
                this.stop();
                // 取消正在进行的 hold 绘制
                if (window.EditorTimeline && window.EditorTimeline._holdDrawing) {
                    window.EditorTimeline._holdDrawing = false;
                    window.EditorTimeline._holdDragging = false;
                    window.EditorTimeline._removeHoldPreview();
                    if (window.showToast) window.showToast('已取消长按绘制', 'info');
                }
                return;
            }

            if (e.key === ' ' && !e.repeat && e.target.tagName !== 'INPUT') {
                e.preventDefault();
                this.togglePlay();
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) this.redo();
                else this.undo();
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                this.redo();
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this.save();
                return;
            }
        });

        window.addEventListener('resize', () => {
            if (!this.container || !this.container.classList.contains('active')) return;
            if (window.EditorPanels) EditorPanels.updateCenterWidth();
            if (window.EditorTimeline) EditorTimeline.render();
        });
    },

    bindToolbar() {
        const playBtn = document.getElementById('ed-btn-play');
        const undoBtn = document.getElementById('ed-btn-undo');
        const redoBtn = document.getElementById('ed-btn-redo');
        const saveBtn = document.getElementById('ed-btn-save');

        if (playBtn) playBtn.addEventListener('click', () => this.togglePlay());
        if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
        if (redoBtn) redoBtn.addEventListener('click', () => this.redo());
        if (saveBtn) saveBtn.addEventListener('click', () => this.save());

        this.bindEditorDropdown('music');
        this.bindEditorDropdown('chart');
    },

    bindEditorDropdown(type) {
        const btn = document.getElementById('ed-select-' + type);
        const panel = document.getElementById('ed-' + type + '-panel');
        const list = document.getElementById('ed-' + type + '-list');
        const empty = document.getElementById('ed-' + type + '-empty');
        const label = document.getElementById('ed-' + type + '-label');
        if (!btn || !panel) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = panel.classList.contains('open');
            this.closeAllEditorDropdowns();
            if (!isOpen) {
                this.refreshEditorDropdown(type);
                panel.classList.add('open');
                btn.classList.add('open');
            }
        });

        if (list) {
            list.addEventListener('click', (e) => {
                const item = e.target.closest('.et-dp-item');
                if (!item) return;
                const fid = item.dataset.file;
                const fileLists = window.fileLists;
                if (!fileLists) return;
                const fd = fileLists[type].find(f => String(f.id) === fid);
                if (!fd) return;

                if (window.AppState) window.AppState[type] = fd;
                if (label) { label.textContent = fd.name; label.title = fd.name; }
                this.closeAllEditorDropdowns();

                if (type === 'music') {
                    this.loadAudio();
                    if (window.setStatus) window.setStatus('已切换音乐: ' + fd.name);
                } else if (type === 'chart') {
                    this.loadChart(fd);
                    if (window.setStatus) window.setStatus('已切换谱面: ' + fd.name);
                }
                // 同步首页标签
                const homeLabel = document.getElementById(type + '-label');
                if (homeLabel) { homeLabel.textContent = fd.name; homeLabel.title = fd.name; }
            });
        }
    },

    refreshEditorDropdown(type) {
        const list = document.getElementById('ed-' + type + '-list');
        const empty = document.getElementById('ed-' + type + '-empty');
        const fileLists = window.fileLists;
        if (!list || !fileLists) return;
        list.innerHTML = '';
        const items = fileLists[type] || [];
        if (items.length === 0) {
            if (empty) empty.style.display = 'block';
            return;
        }
        if (empty) empty.style.display = 'none';
        const icons = { music: '\uD83C\uDFB5', chart: '\uD83D\uDCDC' };
        items.forEach(item => {
            const d = document.createElement('div');
            d.className = 'et-dp-item';
            d.dataset.file = item.id;
            const isActive = window.AppState && window.AppState[type] && String(window.AppState[type].id) === String(item.id);
            if (isActive) d.classList.add('active');
            d.innerHTML = '<span>' + (icons[type] || '') + ' ' + item.name + '</span>';
            list.appendChild(d);
        });
    },

    closeAllEditorDropdowns() {
        document.querySelectorAll('.et-dropdown-panel').forEach(p => p.classList.remove('open'));
        document.querySelectorAll('.et-dropdown-btn').forEach(b => b.classList.remove('open'));
    },

    loadChart(fd) {
        if (!fd || !fd.file) return;
        fd.file.text().then(text => {
            try {
                const data = JSON.parse(text);
                const rawTimeline = data.timeline || [];

                // 兼容数组格式和旧对象格式
                // 加载时为每个音符分配唯一 id（选中/多选/拖拽依赖 id 去重，
                // 否则所有 id 都是 undefined，选中一个会变成“全部选中”）
                const loadIdBase = Date.now() * 1000;
                this.state.notes = rawTimeline.map((item, idx) => {
                    const nid = loadIdBase + idx;
                    if (Array.isArray(item)) {
                        // 数组格式: [type, time, track, extra]
                        const [type, time, track, extra] = item;
                        if (type === 'hold') {
                            return { id: nid, type: 'hold', time, track, endTime: extra };
                        } else if (type === 'switch') {
                            return { id: nid, type: 'switch', time, track, targetTrackCount: extra };
                        } else {
                            return { id: nid, type: 'tap', time, track };
                        }
                    } else {
                        // 旧对象格式: 兼容 targetTracks -> targetTrackCount
                        const note = { ...item };
                        if (note.id === undefined || note.id === null) note.id = nid;
                        if (note.type === 'switch' && note.targetTracks !== undefined && note.targetTrackCount === undefined) {
                            const val = parseInt(note.targetTracks, 10);
                            note.targetTrackCount = isNaN(val) ? 2 : val;
                            delete note.targetTracks;
                        }
                        return note;
                    }
                });

                // BPM：新格式直接读 bpm，旧格式兼容 config.globalBpm
                this.state.bpm = data.bpm || data.config?.globalBpm || null;

                // 谱面唯一标识（旧谱面没有则为 null，保存时生成）
                this.state.chartId = data.chartId || null;

                // 新格式直接读 trackCount
                if (typeof data.trackCount === 'number' && data.trackCount >= 1 && data.trackCount <= 4) {
                    this.state.trackCount = data.trackCount;
                }

                // 兼容旧格式 config.initTrackCount
                if (typeof data.config?.initTrackCount === 'number') {
                    this.state.trackCount = data.config.initTrackCount;
                }

                // 加载歌曲元数据：优先从谱面包 meta.yaml 读取
                this.state.songMeta = {};
                this.state.isFromZipPackage = !!(fd.zipId && window.zipPackages && window.zipPackages[fd.zipId]);
                if (this.state.isFromZipPackage) {
                    const pkgMeta = window.zipPackages[fd.zipId].meta || {};
                    this.state.songMeta = {
                        songName: pkgMeta.songName || '',
                        songArtist: pkgMeta.songArtist || '',
                        charter: pkgMeta.charter || '',
                        illustrator: pkgMeta.illustrator || '',
                        modifiers: Array.isArray(pkgMeta.modifiers) ? [...pkgMeta.modifiers] : [],
                    };
                } else if (fd.local && window.LocalChartStore) {
                    // 本地谱面：从本地存储恢复歌曲元数据
                    const stored = window.LocalChartStore.get(fd.name);
                    const sm = (stored && stored.songMeta) || {};
                    this.state.songMeta = {
                        songName: sm.songName || '',
                        songArtist: sm.songArtist || '',
                        charter: sm.charter || '',
                        illustrator: sm.illustrator || '',
                        modifiers: Array.isArray(sm.modifiers) ? [...sm.modifiers] : [],
                    };
                } else if (window.SongInfoPanel) {
                    // 降级兼容旧谱面格式（元数据在 JSON 中）
                    window.SongInfoPanel.loadFromChart(data);
                    this.state.songMeta.modifiers = this.state.songMeta.modifiers || [];
                }

                this.state.selectedNotes = [];
                this.state.history = [JSON.stringify(this.state.notes)];
                this.state.historyIndex = 0;

                // 校验并修复音符轨道合法性（根据各自时间的轨道数）
                for (const note of this.state.notes) {
                    if (note.type === 'switch') continue;
                    const maxTrack = this.getTrackCountAtTime(note.time) - 1;
                    if (note.track > maxTrack) {
                        note.track = maxTrack;
                    }
                }

                if (window.EditorTimeline) EditorTimeline.render();
                this.updateStatus();
                this.updateMinimapDensity();
                const container = document.getElementById('property-content');
                if (window.SongInfoPanel && container) window.SongInfoPanel.render(container);
                if (window.showToast) window.showToast('谱面加载成功', 'success');
            } catch (e) {
                if (window.showToast) window.showToast('谱面解析失败', 'error');
            }
        }).catch(() => {
            if (window.showToast) window.showToast('谱面读取失败', 'error');
        });
    },

    async loadAudio() {
        const music = window.AppState && window.AppState.music;
        if (!music || !music.file) return;

        // 释放旧资源
        if (this.sourceNode) {
            try { this.sourceNode.stop(); } catch(e) {}
            this.sourceNode = null;
        }
        if (this.audioContext) {
            await this.audioContext.close();
        }

        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await music.file.arrayBuffer();
        this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        this.state.duration = this.audioBuffer.duration;
        this.state.currentTime = 0;
        this.audioOffset = 0;
        this.updateStatus();

        // 更新工具栏标签
        const label = document.getElementById('ed-music-label');
        if (label) { label.textContent = music.name; label.title = music.name; }
        this.updateMinimapDensity();
        if (window.EditorTimeline) window.EditorTimeline.render();
    },

    togglePlay() {
        if (!this.audioBuffer) {
            if (window.showToast) window.showToast('未加载音乐文件', 'warning');
            return;
        }
        if (this.state.playing) {
            this.pause();
        } else {
            this.play();
        }
    },

    play() {
        if (!this.audioContext || !this.audioBuffer) return;
        // 如果 context 被关闭，自动重新加载音频
        if (this.audioContext.state === 'closed') {
            this.loadAudio().then(() => this.play());
            return;
        }
        // 如果已经播放到结尾，从头开始
        if (this.audioOffset >= this.state.duration) {
            this.audioOffset = 0;
        }

        // 音效预览开关：关闭时不输出声音，但时间轴仍然走动
        const soundPreview = localStorage.getItem('muse-editor-sound-preview') !== 'false';

        // 创建新的 AudioBufferSourceNode（每个 source 只能播放一次）
        this.sourceNode = this.audioContext.createBufferSource();
        this.sourceNode.buffer = this.audioBuffer;
        if (soundPreview) {
            this.sourceNode.connect(this.audioContext.destination);
        }
        this.sourceNode.start(0, this.audioOffset);
        this.audioStartTime = this.audioContext.currentTime;

        this.state.playing = true;
        this.updatePlayButton();
        this.clearPlayTimer();

        // 根据性能模式选择驱动方式
        if (this.state.perfMode === 'aggressive') {
            // 激进模式：setInterval(4ms) 高频驱动
            const tick = () => {
                if (!this.state.playing) return;
                if (this.audioContext) {
                    this.state.currentTime = this.audioOffset + (this.audioContext.currentTime - this.audioStartTime);
                    if (this.state.currentTime >= this.state.duration) {
                        this.stop(false);
                        return;
                    }
                    this.updateStatus();
                    this.updateMinimap();
                    if (window.EditorTimeline) {
                        EditorTimeline.updateScroll(this.state.currentTime);
                    }
                }
            };
            this.playTimer = setInterval(tick, 4);
        } else {
            // 流畅模式：requestAnimationFrame 驱动
            const tick = () => {
                if (!this.state.playing) return;
                if (this.audioContext) {
                    this.state.currentTime = this.audioOffset + (this.audioContext.currentTime - this.audioStartTime);
                    if (this.state.currentTime >= this.state.duration) {
                        this.stop(false);
                        return;
                    }
                    this.updateStatus();
                    if (window.EditorTimeline) {
                        EditorTimeline.updateScroll(this.state.currentTime);
                    }
                }
                this.playTimer = requestAnimationFrame(tick);
            };
            this.playTimer = requestAnimationFrame(tick);
        }
    },

    pause() {
        if (!this.audioContext) return;
        if (this.sourceNode) {
            try { this.sourceNode.stop(); } catch(e) {}
            this.sourceNode = null;
        }
        // 记录当前偏移量，下次 play 时从这里继续
        this.audioOffset = this.audioOffset + (this.audioContext.currentTime - this.audioStartTime);
        this.state.playing = false;
        this.updatePlayButton();
        this.clearPlayTimer();
    },

    stop(reset = true) {
        if (this.sourceNode) {
            try { this.sourceNode.stop(); } catch(e) {}
            this.sourceNode = null;
        }
        this.state.playing = false;
        if (reset) {
            this.state.currentTime = 0;
            this.audioOffset = 0;
            this.clearPlayTimer();
            this.updatePlayButton();
            this.updateStatus();
            if (window.EditorTimeline) {
                EditorTimeline.updateScroll(0);
            }
        } else {
            // 自然播放结束：停在结尾
            this.state.currentTime = this.state.duration;
            this.audioOffset = this.state.duration;
            this.clearPlayTimer();
            this.updatePlayButton();
            this.updateStatus();
            if (window.EditorTimeline) {
                EditorTimeline.updateScroll(this.state.duration);
            }
        }
    },

    clearPlayTimer() {
        if (this.playTimer) {
            if (typeof this.playTimer === 'number') {
                clearInterval(this.playTimer);
            } else {
                cancelAnimationFrame(this.playTimer);
            }
            this.playTimer = null;
        }
    },

    updatePlayButton() {
        const btn = document.getElementById('ed-btn-play');
        if (!btn) return;
        if (this.state.playing) {
            btn.classList.remove('et-btn-play');
            btn.classList.add('et-btn-pause');
            btn.textContent = '暂停';
        } else {
            btn.classList.remove('et-btn-pause');
            btn.classList.add('et-btn-play');
            btn.textContent = '播放';
        }
    },

    updateStatus() {
        const timeEl = document.getElementById('ed-status-time');
        const bpmEl = document.getElementById('ed-status-bpm');
        const notesEl = document.getElementById('ed-status-notes');
        const zoomEl = document.getElementById('ed-status-zoom');

        if (timeEl) {
            const fmt = (t) => {
                const m = Math.floor(t / 60);
                const s = Math.floor(t % 60);
                const ms = Math.floor((t % 1) * 100);
                return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(2,'0')}`;
            };
            timeEl.textContent = `${fmt(this.state.currentTime)} / ${fmt(this.state.duration)}`;
        }
        if (bpmEl) bpmEl.textContent = `BPM: ${this.state.bpm || '--'}`;
        if (notesEl) notesEl.textContent = `音符: ${this.state.notes.length}`;
        if (zoomEl) zoomEl.textContent = `缩放: ${Math.round(this.state.zoom * 100)}%`;
        this.updateMinimap();
    },

    pushHistory() {
        // 截断 redo 分支
        if (this.state.historyIndex < this.state.history.length - 1) {
            this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
        }
        this.state.history.push(JSON.stringify(this.state.notes));
        if (this.state.history.length > 50) {
            this.state.history.shift();
        } else {
            this.state.historyIndex++;
        }
        this.updateStatus();
        this.updateMinimapDensity();
    },

    undo() {
        if (this.state.historyIndex <= 0) {
            if (window.showToast) window.showToast('没有可撤销的操作', 'info');
            return;
        }
        this.state.historyIndex--;
        this.state.notes = JSON.parse(this.state.history[this.state.historyIndex]);
        this.updateStatus();
        if (window.EditorTimeline) EditorTimeline.render();
        this.updateMinimapDensity();
        if (window.showToast) window.showToast('已撤销', 'success');
    },

    redo() {
        if (this.state.historyIndex >= this.state.history.length - 1) {
            if (window.showToast) window.showToast('没有可重做的操作', 'info');
            return;
        }
        this.state.historyIndex++;
        this.state.notes = JSON.parse(this.state.history[this.state.historyIndex]);
        this.updateStatus();
        if (window.EditorTimeline) EditorTimeline.render();
        this.updateMinimapDensity();
        if (window.showToast) window.showToast('已重做', 'success');
    },

    save() {
        // 谱面唯一标识：首次保存时生成，之后永久跟随该谱面（含保存进谱面JSON）
        if (!this.state.chartId) {
            this.state.chartId = (window.crypto && window.crypto.randomUUID)
                ? window.crypto.randomUUID()
                : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        }
        const data = {
            chartId: this.state.chartId,
            bpm: this.state.bpm,
            trackCount: this.state.trackCount,
            // 紧凑数组格式：[type, time, track, extra?]
            // tap:   ["tap", time, track]
            // hold:  ["hold", time, track, endTime]
            // switch:["switch", time, track, targetTrackCount]
            timeline: this.state.notes.map(n => {
                if (n.type === 'hold') {
                    return ['hold', n.time, n.track, n.endTime];
                } else if (n.type === 'switch') {
                    return ['switch', n.time, n.track, n.targetTrackCount];
                } else {
                    return ['tap', n.time, n.track];
                }
            }),
        };

        const chartFile = window.AppState && window.AppState.chart;
        if (!chartFile || !chartFile.name) {
            if (window.showToast) window.showToast('未选择谱面，无法保存', 'warning');
            return;
        }
        const name = chartFile.name;

        // 1. 写入本地存储
        window.LocalChartStore.save(name, {
            chart: data,
            chartId: this.state.chartId,
            songMeta: this.state.songMeta || {},
            savedAt: Date.now(),
        });

        // 2. 同步内存中的 File 对象（编辑器/播放器后续加载直接用新内容）
        const file = window.LocalChartStore.toFile(name);
        if (chartFile) {
            chartFile.file = file;
            chartFile.local = true;
            delete chartFile.autoCreated;
        }

        // 3. 同步首页下拉列表
        if (window.registerLocalChart) window.registerLocalChart(name, file, chartFile);

        if (window.AppState) window.AppState.isDirty = false;
        if (window.showToast) window.showToast('谱面已保存到本地: ' + name, 'success');
        if (window.setStatus) window.setStatus('已保存谱面到本地: ' + name);
    },

    /**
     * 打包谱面包 (.pms) 并下载：
     * 谱面 json + 当前选中的音乐 + 当前选中的皮肤 + meta.yaml
     */
    async exportPackage() {
        const data = {
            bpm: this.state.bpm,
            trackCount: this.state.trackCount,
            timeline: this.state.notes.map(n => {
                if (n.type === 'hold') return ['hold', n.time, n.track, n.endTime];
                if (n.type === 'switch') return ['switch', n.time, n.track, n.targetTrackCount];
                return ['tap', n.time, n.track];
            }),
        };

        try {
            if (!window.JSZip) {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
                    s.onload = res;
                    s.onerror = rej;
                    document.head.appendChild(s);
                });
            }

            const appState = window.AppState || {};
            const songMeta = this.state.songMeta || {};

            if (!appState.music || !appState.music.file) {
                if (window.showToast) window.showToast('未选择音乐，谱面包将缺少音频', 'warning');
            }

            const zip = new window.JSZip();

            // 1. 谱面
            const chartName = (appState.chart && appState.chart.name) || 'chart.json';
            zip.file(chartName, JSON.stringify(data, null, 2));

            // 2. 音乐
            if (appState.music && appState.music.file) {
                zip.file(appState.music.name, appState.music.file);
            }

            // 3. 皮肤（.pms 皮肤包）
            if (appState.skin && appState.skin.file) {
                zip.file(appState.skin.name, appState.skin.file);
            }

            // 4. meta.yaml
            const chartFile = appState.chart;
            const pkg = chartFile && chartFile.zipId && window.zipPackages ? window.zipPackages[chartFile.zipId] : null;
            const meta = { ...((pkg && pkg.meta) || {}) };
            meta.songName = songMeta.songName || meta.songName || 'Untitled';
            meta.songArtist = songMeta.songArtist || meta.songArtist || '';
            meta.charter = songMeta.charter || meta.charter || '';
            meta.illustrator = songMeta.illustrator || meta.illustrator || '';
            meta.trackCount = this.state.trackCount || 3;
            zip.file('meta.yaml', Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n'));

            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = ((meta.songName && meta.songName !== 'Untitled') ? meta.songName : chartName.replace(/\.json$/i, '')) + '.pms';
            a.click();
            URL.revokeObjectURL(url);

            if (window.showToast) window.showToast('谱面包已导出: ' + a.download, 'success');
            if (window.setStatus) window.setStatus('已导出谱面包: ' + a.download);
        } catch (e) {
            console.error(e);
            if (window.showToast) window.showToast('谱面包导出失败', 'error');
        }
    },

    async exportZipPackage(pkg, data) {
        try {
            // 确保 JSZip 已加载
            if (!window.JSZip) {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
                    s.onload = res;
                    s.onerror = rej;
                    document.head.appendChild(s);
                });
            }

            const zip = new window.JSZip();

            // 1. 谱面文件（使用原文件名或默认名）
            const chartName = pkg.files.chart ? pkg.files.chart.name : 'chart.json';
            zip.file(chartName, JSON.stringify(data, null, 2));

            // 2. 音乐文件
            if (pkg.files.music && pkg.files.music.file) {
                const musicBlob = pkg.files.music.file;
                zip.file(pkg.files.music.name, musicBlob);
            }

            // 3. 皮肤文件
            if (pkg.files.skin && pkg.files.skin.file) {
                const skinBlob = pkg.files.skin.file;
                zip.file(pkg.files.skin.name, skinBlob);
            }

            // 4. meta.yaml（从编辑器 songMeta + 原 meta 合并）
            const meta = { ...(pkg.meta || {}) };
            const songMeta = this.state.songMeta || {};
            meta.songName = songMeta.songName || meta.songName || 'Untitled';
            meta.songArtist = songMeta.songArtist || meta.songArtist || '';
            meta.charter = songMeta.charter || meta.charter || '';
            meta.illustrator = songMeta.illustrator || meta.illustrator || '';
            meta.trackCount = this.state.trackCount || 3;
            const metaLines = Object.entries(meta).map(([k, v]) => `${k}: ${v}`);
            zip.file('meta.yaml', metaLines.join('\n'));

            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = pkg.name || 'package.zip';
            a.click();
            URL.revokeObjectURL(url);

            if (window.showToast) window.showToast('谱面包已导出', 'success');
            if (window.setStatus) window.setStatus('已导出谱面包: ' + (pkg.name || 'package.zip'));
        } catch (e) {
            console.error(e);
            if (window.showToast) window.showToast('谱面包导出失败', 'error');
            // 降级为 JSON 导出
            this.exportJson(data);
        }
    },

    exportJson(data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (window.AppState && window.AppState.chart ? window.AppState.chart.name : 'chart.json');
        a.click();
        URL.revokeObjectURL(url);

        if (window.showToast) window.showToast('谱面已保存', 'success');
        if (window.setStatus) window.setStatus('已保存谱面');
    },

    replay() {
        this.stop();
        if (window.EditorTimeline) EditorTimeline.render();
        this.play();
        if (window.showToast) window.showToast('重新播放', 'info');
    },

    show() {
        if (this.container) {
            this.container.classList.add('active');
            void this.container.offsetHeight;
            const redraw = () => {
                if (window.EditorPanels) EditorPanels.updateCenterWidth();
                if (window.EditorTimeline) EditorTimeline.render();
            };
            requestAnimationFrame(() => {
                redraw();
                requestAnimationFrame(redraw);
            });
        } else {
            this._pendingShow = true;
        }

        // 重新同步标签与音频（用户可能通过首页切换了文件）
        const chartLabel = document.getElementById('ed-chart-label');
        if (chartLabel && window.AppState && window.AppState.chart) {
            chartLabel.textContent = window.AppState.chart.name;
            chartLabel.title = window.AppState.chart.name;
        }
        const musicLabel = document.getElementById('ed-music-label');
        if (musicLabel && window.AppState && window.AppState.music) {
            musicLabel.textContent = window.AppState.music.name;
            musicLabel.title = window.AppState.music.name;
        }
        this.loadAudio();

        // 应用 minimap 可见性设置
        const minimap = document.getElementById('ed-minimap');
        if (minimap) {
            minimap.style.display = localStorage.getItem('muse-editor-minimap-visible') !== 'false' ? '' : 'none';
        }
    },

    hide() {
        if (this.container) this.container.classList.remove('active');
        this.pause();
    },

    updateMinimap() {
        const cursor = document.getElementById('ed-minimap-cursor');
        if (!cursor) return;
        const dur = this.state.duration || 1;
        const t = Math.max(0, Math.min(this.state.currentTime || 0, dur));
        const pct = (t / dur) * 100;
        cursor.style.left = pct + '%';
    },

    updateMinimapDensity() {
        const canvas = document.getElementById('ed-minimap-canvas');
        if (!canvas) return;
        canvas.innerHTML = '';

        const notes = this.state.notes || [];
        const dur = this.state.duration || 1;
        if (dur <= 0 || notes.length === 0) return;

        // 桶数量：根据宽度自适应，最少 40，最多 200
        const barCount = Math.max(40, Math.min(200, Math.floor(canvas.clientWidth / 3)));
        const buckets = new Array(barCount).fill(0);

        notes.forEach(n => {
            const t = n.time || 0;
            const idx = Math.min(barCount - 1, Math.floor((t / dur) * barCount));
            buckets[idx]++;
            // hold 的尾部也增加密度感
            if (n.type === 'hold' && n.endTime) {
                const endIdx = Math.min(barCount - 1, Math.floor((n.endTime / dur) * barCount));
                if (endIdx !== idx) buckets[endIdx] += 0.5;
            }
        });

        const maxCount = Math.max(1, ...buckets);
        buckets.forEach((count) => {
            const bar = document.createElement('div');
            bar.className = 'ed-minimap-bar';
            const h = Math.max(2, (count / maxCount) * 100);
            bar.style.height = h + '%';
            bar.style.opacity = Math.max(0.08, 0.12 + (count / maxCount) * 0.55);
            canvas.appendChild(bar);
        });
    },

    bindMinimapEvents() {
        const minimap = document.getElementById('ed-minimap');
        const cursor = document.getElementById('ed-minimap-cursor');
        if (!minimap || minimap.dataset.bound) return;
        minimap.dataset.bound = 'true';

        // 初始化默认值（从未打开过设置面板时使用）
        if (localStorage.getItem('muse-editor-minimap-visible') === null) {
            localStorage.setItem('muse-editor-minimap-visible', 'true');
        }
        if (localStorage.getItem('muse-editor-minimap-seek') === null) {
            localStorage.setItem('muse-editor-minimap-seek', 'true');
        }
        if (localStorage.getItem('muse-editor-minimap-seek-drag') === null) {
            localStorage.setItem('muse-editor-minimap-seek-drag', 'true');
        }
        if (localStorage.getItem('muse-editor-minimap-seek-click') === null) {
            localStorage.setItem('muse-editor-minimap-seek-click', 'false');
        }

        let dragging = false;
        let dragTimer = null;
        const DRAG_DELAY = 100; // ms，长按红色竖线100ms后才判定为拖动

        const isEnabled = () => {
            const rootOn = localStorage.getItem('muse-editor-minimap-visible') !== 'false';
            const midOn = localStorage.getItem('muse-editor-minimap-seek') !== 'false';
            return rootOn && midOn;
        };

        const canDrag = () => isEnabled() && localStorage.getItem('muse-editor-minimap-seek-drag') !== 'false';
        const canClick = () => isEnabled() && localStorage.getItem('muse-editor-minimap-seek-click') !== 'false';

        const seekTo = (clientX) => {
            const rect = minimap.getBoundingClientRect();
            const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
            const ratio = x / rect.width;
            const dur = this.state.duration || 1;
            const targetTime = ratio * dur;

            this.pause();
            this.state.currentTime = targetTime;
            this.audioOffset = targetTime;
            this.updateStatus();
            this.updateMinimap();
            if (window.EditorTimeline) {
                window.EditorTimeline.updateScroll(targetTime);
            }
        };

        // 判断是否点击在红色竖线上（光标宽度2px，容错±8px）
        const isOnCursor = (clientX) => {
            if (!cursor) return false;
            const cursorRect = cursor.getBoundingClientRect();
            return clientX >= cursorRect.left - 8 && clientX <= cursorRect.right + 8;
        };

        minimap.addEventListener('mousedown', (e) => {
            if (!canDrag() && !canClick()) return;

            if (canClick()) {
                seekTo(e.clientX);
            }

            // 只有点击在红色竖线上才启动拖动计时
            if (canDrag() && isOnCursor(e.clientX)) {
                dragTimer = setTimeout(() => {
                    dragging = true;
                    if (cursor) cursor.classList.add('dragging');
                }, DRAG_DELAY);
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            if (!canDrag()) { dragging = false; return; }
            e.preventDefault();
            seekTo(e.clientX);
        });

        window.addEventListener('mouseup', () => {
            if (dragTimer) {
                clearTimeout(dragTimer);
                dragTimer = null;
            }
            if (!dragging) return;
            dragging = false;
            if (cursor) cursor.classList.remove('dragging');
        });

        // 触摸支持
        minimap.addEventListener('touchstart', (e) => {
            if (!canDrag() && !canClick()) return;
            const touchX = e.touches[0].clientX;

            if (canClick()) {
                seekTo(touchX);
            }

            if (canDrag() && isOnCursor(touchX)) {
                dragTimer = setTimeout(() => {
                    dragging = true;
                    if (cursor) cursor.classList.add('dragging');
                }, DRAG_DELAY);
            }
        }, { passive: false });

        window.addEventListener('touchmove', (e) => {
            if (!dragging) return;
            if (!canDrag()) { dragging = false; return; }
            e.preventDefault();
            seekTo(e.touches[0].clientX);
        }, { passive: false });

        window.addEventListener('touchend', () => {
            if (dragTimer) {
                clearTimeout(dragTimer);
                dragTimer = null;
            }
            if (!dragging) return;
            dragging = false;
            if (cursor) cursor.classList.remove('dragging');
        });
    },

};

window.ChartEditor = ChartEditor;
