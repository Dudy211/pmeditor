/**
 * player.js — 播放器核心模块
 * 复用编辑器音频系统，提供下落式游玩体验
 */

const ChartPlayer = {
    container: null,
    canvas: null,
    ctx: null,
    state: {
        playing: false,
        currentTime: 0,
        currentTimeMs: 0,
        duration: 0,
        durationMs: 0,
        bpm: 120,
        notes: [],
        trackCount: 3,
        hitEffects: [],
        combo: 0, maxCombo: 0,
        perfectCount: 0, goodCount: 0, badCount: 0, missCount: 0,
    },

    JUDGE_PERFECT_MS: 50, JUDGE_GOOD_MS: 150,
    SCORE_MAX: 1145140, SCORE_JUDGE_MAX: 1045140, SCORE_COMBO_MAX: 100000,
    ACC_PERFECT_PCT: 100, ACC_GOOD_PCT: 65,

    _judgeDeltaMs(deltaMs) {
        if (deltaMs < -this.JUDGE_GOOD_MS) return 'bad';
        if (deltaMs < -this.JUDGE_PERFECT_MS) return 'good_early';
        if (deltaMs <= this.JUDGE_PERFECT_MS) return 'perfect';
        if (deltaMs <= this.JUDGE_GOOD_MS) return 'good_late';
        return 'miss';
    },
    _getAccPct(type) {
        if (type === 'perfect') return this.ACC_PERFECT_PCT;
        if (type === 'good_early' || type === 'good_late') return this.ACC_GOOD_PCT;
        return 0;
    },
    _updateScore(jt) {
        const s = this.state;
        if (jt === 'perfect') s.perfectCount++;
        else if (jt === 'good_early' || jt === 'good_late') s.goodCount++;
        else if (jt === 'bad') s.badCount++;
        else if (jt === 'miss') s.missCount++;
        const acc = this._getAccPct(jt);
        if (acc > 0) { s.combo++; if (s.combo > s.maxCombo) s.maxCombo = s.combo; }
        else s.combo = 0;
    },
    _getTotalJudges() {
        return this.state.notes.reduce((sum, n) => sum + (n.type === 'hold' ? 2 : 1), 0);
    },

    _getTotalScore() {
        const s = this.state, total = this._getTotalJudges();
        if (!total) return 0;
        const judgeScore = Math.floor(
            this.SCORE_JUDGE_MAX * (s.perfectCount * 100 + s.goodCount * 65) / (total * 100)
        );
        const comboScore = Math.floor(this.SCORE_COMBO_MAX * s.maxCombo / total);
        return Math.min(judgeScore + comboScore, this.SCORE_MAX);
    },

    _getAccPercent() {
        // 准确度 = 已判定音符的加权命中比例（Perfect=100, Good=65, Bad/Miss=0）
        const s = this.state;
        const judged = s.perfectCount + s.goodCount + s.badCount + s.missCount;
        if (!judged) return '100.00';
        const acc = (s.perfectCount * this.ACC_PERFECT_PCT + s.goodCount * this.ACC_GOOD_PCT) / judged;
        return Math.min(acc, 100).toFixed(2);
    },
    audioContext: null,
    audioBuffer: null,
    sourceNode: null,
    audioStartTime: 0,
    audioOffset: 0,
    playTimer: null,
    pps: 400,
    judgeOffset: 0,
    _lastTime: 0,

    // 输入跟踪: { track: number, startTime: number, noteId: string|null }
    activeInputs: new Map(),
    nextInputId: 0,

    init() {
        if (this.container) {
            this.loadChart();
            this.loadAudio();
            return;
        }
        const workspace = document.getElementById('workspace-inner');
        if (!workspace) return;

        this.container = document.createElement('div');
        this.container.className = 'chart-player';
        this.container.id = 'chart-player';
        this.container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:10;display:none;background:var(--bg-primary);overflow:hidden;';

        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
        this.container.appendChild(this.canvas);
        workspace.appendChild(this.container);

        this.ctx = this.canvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());

        // 鼠标输入
        this.canvas.addEventListener('mousedown', (e) => this._onPress(e));
        this.canvas.addEventListener('mouseup', (e) => this._onRelease(e));
        this.canvas.addEventListener('mouseleave', (e) => this._onRelease(e));

        // 触摸输入
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            for (const t of e.changedTouches) this._onPress(t);
        }, { passive: false });
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            for (const t of e.changedTouches) this._onRelease(t);
        }, { passive: false });
        this.canvas.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            for (const t of e.changedTouches) this._onRelease(t);
        }, { passive: false });

        this.loadChart();
        this.loadAudio();
        // 结算界面按钮
        const rsReplay = document.getElementById('rs-btn-replay');
        const rsBack = document.getElementById('rs-btn-back');
        if (rsReplay) rsReplay.addEventListener('click', () => { this._hideResult(); this.restart(); });
        if (rsBack) rsBack.addEventListener('click', () => { this._hideResult(); this.stop(); if (window.enterMode) window.enterMode('home'); });
    },

    resize() {
        if (!this.container || !this.canvas) return;
        const rect = this.container.getBoundingClientRect();
        this.canvas.width = rect.width * window.devicePixelRatio;
        this.canvas.height = rect.height * window.devicePixelRatio;
        this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        this.judgeOffset = rect.height * 0.85;
    },

    loadChart() {
        const chart = window.AppState && window.AppState.chart;
        if (!chart || !chart.file) return;

        chart.file.text().then(text => {
            try {
                const data = JSON.parse(text);
                this.state.bpm = data.bpm || 120;
                const rawTimeline = data.timeline || [];
                this.state.notes = rawTimeline.map((item, idx) => {
                    if (Array.isArray(item)) {
                        const [type, time0, track, extra] = item;
                        const time = time0 + this.LEAD_IN;   // 整体后移前导空白：音符时间0 = 音乐开始后0.6s
                        const base = { id: 'n' + idx, time, timeMs: Math.round(time * 1000), track };
                        if (type === 'hold') {
                            const endTime = extra + this.LEAD_IN;
                            return { ...base, type: 'hold', endTime, endTimeMs: Math.round(endTime * 1000), headHit: false, tailHit: false, holding: false, headJudge: null, tailJudge: null };
                        }
                        if (type === 'switch') return { ...base, type: 'switch', targetTrackCount: extra, hit: false, missed: false, judgeResult: null };
                        return { ...base, type: 'tap', hit: false, judgeResult: null };
                    }
                    const old = { ...item, id: item.id || 'n' + idx };
                    if (typeof old.time === 'number') { old.time += this.LEAD_IN; old.timeMs = Math.round(old.time * 1000); }
                    if (typeof old.endTime === 'number') { old.endTime += this.LEAD_IN; old.endTimeMs = Math.round(old.endTime * 1000); }
                    return old;
                }).sort((a, b) => a.time - b.time);
                // 基准轨道数：优先取谱面配置（避免重开后残留上次变轨结果）
                let initCount = 3;
                if (data.config && typeof data.config.initTrackCount === 'number') initCount = data.config.initTrackCount;
                else if (typeof data.trackCount === 'number') initCount = data.trackCount;
                this.state.trackCount = Math.max(1, Math.min(4, initCount));
            } catch (e) {
                console.error('谱面加载失败', e);
            }
        });
    },

    async loadAudio() {
        const music = window.AppState && window.AppState.music;
        if (!music || !music.file) return;

        if (this.audioContext) {
            try { await this.audioContext.close(); } catch(e) {}
        }
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await music.file.arrayBuffer();
        this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

        // 头尾各垫 LEAD_IN 秒静音：开头给玩家预览下落的缓冲，结尾留尾奏余韵
        // 采用缓冲区垫音方案：游戏时钟=音频时钟，暂停/恢复/偏移全部天然一致
        {
            const padSec = this.LEAD_IN;
            const sr = this.audioBuffer.sampleRate;
            const chs = this.audioBuffer.numberOfChannels;
            const padFrames = Math.round(padSec * sr);
            const padded = this.audioContext.createBuffer(chs, this.audioBuffer.length + padFrames * 2, sr);
            for (let c = 0; c < chs; c++) {
                padded.getChannelData(c).set(this.audioBuffer.getChannelData(c), padFrames);
            }
            this.audioBuffer = padded;
        }

        this.state.duration = this.audioBuffer.duration;
        this.state.durationMs = Math.round(this.audioBuffer.duration * 1000);
    },

    getTrackCountAtTime(time) {
        let count = this.state.trackCount || 3;
        let lastSwitchTime = -Infinity;
        for (const note of this.state.notes) {
            if (note.type === 'switch' && note.time <= time && note.time > lastSwitchTime) {
                count = note.targetTrackCount || 3;
                lastSwitchTime = note.time;
            }
        }
        return Math.max(1, Math.min(4, count));
    },

    SWITCH_ANIM_DURATION: 0.45,
    LEAD_IN: 0.6,   // 音乐前后各留 0.6s 空白缓冲（谱面时间整体后移，缓冲区前后垫静音）

    _easeInOutCubic(p) {
        return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    },

    // count 条轨道线的归一化位置（0~1）
    _getLinesForCount(count) {
        const lines = [];
        for (let i = 1; i <= count; i++) lines.push(i / (count + 1));
        return lines;
    },

    // 当前生效的变轨音符（最后一个 time <= time 的 switch）
    _switchBefore(time) {
        let sw = null;
        for (const n of this.state.notes) {
            if (n.type === 'switch' && n.time <= time && (!sw || n.time > sw.time)) sw = n;
        }
        return sw;
    },

    // time 时刻的轨道布局：变轨触发后 SWITCH_ANIM_DURATION 秒内做合并/分裂动画
    // 返回 { count, lines: [常驻线], extra: [{x, alpha}] 淡入淡出中的线 }
    _getLayoutAt(time) {
        const count = this.getTrackCountAtTime(time);
        const staticLines = this._getLinesForCount(count);
        const sw = this._switchBefore(time);
        if (!sw) return { count, lines: staticLines, extra: [] };
        const toCount = Math.max(1, Math.min(4, sw.targetTrackCount || 3));
        const fromCount = this.getTrackCountAtTime(sw.time - 0.001);
        if (fromCount === toCount) return { count, lines: staticLines, extra: [] };
        let p = (time - sw.time) / this.SWITCH_ANIM_DURATION;
        if (p >= 1) return { count, lines: staticLines, extra: [] };
        if (p < 0) p = 0;
        const e = this._easeInOutCubic(p);
        const fromLines = this._getLinesForCount(fromCount);
        const toLines = this._getLinesForCount(toCount);
        const anchor = Math.max(0, Math.min(fromCount - 1, sw.track || 0));
        const lines = [];
        if (window.TrackSystem) {
            // 与编辑器 track-system.js 同一套映射语义：
            // 每条轨道线从自己的来源旧位置滑向目标位置，分裂新轨全部从 trigger 旧位置分出
            if (toCount > fromCount) {
                // 分裂：newId -> sourceOldId
                const splitMap = TrackSystem.computeSplitMap(fromCount, toCount, anchor);
                for (let T = 0; T < toCount; T++) {
                    const src = splitMap.get(T);
                    lines.push(fromLines[src] + (toLines[T] - fromLines[src]) * e);
                }
            } else {
                // 合并：oldId -> newId，被合并的旧线滑向目标锚点线
                const { map } = TrackSystem.computeMergeMap(fromCount, toCount, anchor);
                for (let oldId = 0; oldId < fromCount; oldId++) {
                    const nx = map.get(oldId);
                    lines.push(fromLines[oldId] + (toLines[nx] - fromLines[oldId]) * e);
                }
            }
            lines.sort((a, b) => a - b);
            return { count, lines, extra: [], anim: { p, e } };
        }
        // 兜底：TrackSystem 未加载时的简化动画
        const diff = Math.abs(toCount - fromCount);
        if (toCount > fromCount) {
            for (let i = 1; i <= fromCount; i++) lines.push(fromLines[i - 1]);
            for (let j = fromCount + 1; j <= toCount; j++) lines.push(toLines[j - 1]);
        } else {
            for (let i = 1; i <= toCount; i++) lines.push(fromLines[i - 1] + (toLines[i - 1] - fromLines[i - 1]) * e);
            for (let i = toCount + 1; i <= fromCount; i++) lines.push(fromLines[i - 1] + (toLines[toCount - 1] - fromLines[i - 1]) * e);
        }
        lines.sort((a, b) => a - b);
        return { count, lines, extra: [], anim: { p, e } };
    },

    // 音符的轨道线归一化 x；time 为求值时刻（默认 note.time）。
    // 变轨动画期间按“当前帧时间”插值：音符与轨道线刚性一起移动
    _noteXFrac(note, time) {
        const t = (time !== undefined) ? time : note.time;
        // 管辖变轨：决定该音符“属于哪一段布局”的最后一个变轨（按音符自身时刻）
        const sw = this._switchBefore(note.time);
        if (!sw) {
            const c = this.getTrackCountAtTime(note.time);
            return (Math.max(0, Math.min(c - 1, note.track)) + 1) / (c + 1);
        }
        const fromCount = this.getTrackCountAtTime(sw.time - 0.001);
        const toCount = Math.max(1, Math.min(4, sw.targetTrackCount || 3));
        const k = Math.max(0, Math.min(fromCount - 1, note.track));
        if (fromCount === toCount) return (Math.min(k, toCount - 1) + 1) / (toCount + 1);
        // 动画进度按当前帧时间：过渡期内音符与轨道线刚性一起移动
        const p = Math.max(0, Math.min(1, (t - sw.time) / this.SWITCH_ANIM_DURATION));
        const e = this._easeInOutCubic(p);
        const anchor = Math.max(0, Math.min(fromCount - 1, sw.track || 0));
        // 关键：sw 是音符自身时刻之前的变轨，只管辖变轨之后的音符，
        // 其逻辑轨道号 T 就是变轨后布局中的索引，目标位置恒为 (T+1)/(toCount+1)。
        // fromX 取该轨道在旧布局中的来源位置，动画期间音符与轨道线刚性一起移动：
        // 分裂时新轨道全部从 trigger 旧位置重合点滑出，合并时锚点轨道近乎不动。
        const T = Math.max(0, Math.min(toCount - 1, note.track));
        let fromX;
        if (window.TrackSystem) {
            if (toCount > fromCount) {
                const src = TrackSystem.computeSplitMap(fromCount, toCount, anchor).get(T);
                fromX = (src + 1) / (fromCount + 1);
            } else {
                const { anchors } = TrackSystem.computeMergeMap(fromCount, toCount, anchor);
                fromX = (anchors[T] + 1) / (fromCount + 1);
            }
        } else {
            fromX = (Math.min(note.track, fromCount - 1) + 1) / (fromCount + 1);
        }
        return fromX + ((T + 1) / (toCount + 1) - fromX) * e;
    },

    // time 时刻第 track 条轨道线的归一化 x
    _trackXFrac(track, time) {
        return this._noteXFrac({ track, time }, time);
    },

    togglePlay() {
        if (!this.audioBuffer) {
            if (window.showToast) window.showToast('未加载音乐文件', 'warning');
            return;
        }
        if (this.state.playing) {
            this.pause();
        } else {
            // 暂停后继续播放，不需要过场
            this._resumePlay();
        }
    },

    _setHomeControlsDisabled(disabled) {
        const importRow = document.querySelector('.import-row');
        const selectRow = document.querySelector('.select-row');
        if (importRow) importRow.classList.toggle('controls-disabled', disabled);
        if (selectRow) selectRow.classList.toggle('controls-disabled', disabled);
    },

    async _resumePlay() {
        if (!this.audioContext || !this.audioBuffer) return;

        this.sourceNode = this.audioContext.createBufferSource();
        this.sourceNode.buffer = this.audioBuffer;
        this.sourceNode.connect(this.audioContext.destination);
        this.sourceNode.start(0, this.audioOffset);
        this.audioStartTime = this.audioContext.currentTime;

        this.state.playing = true;
        this.clearPlayTimer();
        this._lastTime = performance.now();

        // 播放时隐藏主页控制按钮
        this._setHomeControlsDisabled(true);

        const tick = () => {
            if (!this.state.playing) return;
            if (this.audioContext) {
                const t = this.audioOffset + (this.audioContext.currentTime - this.audioStartTime);
                this.state.currentTime = t;
                this.state.currentTimeMs = Math.round(t * 1000);
                if (this.state.currentTime >= this.state.duration) {
                    this._showResult();
                    return;
                }
            }
            const nowMs = this.state.currentTimeMs;
            for (const note of this.state.notes) {
                if (note.type === 'tap') {
                    if (!note.hit && nowMs > note.timeMs + this.JUDGE_GOOD_MS) {
                        note.hit = true; note.judgeResult = 'miss';
                        this._updateScore('miss'); this._addHitEffect(note.time, note.track, 'miss');
                    }
                } else if (note.type === 'hold') {
                    if (!note.headHit && nowMs > note.timeMs + this.JUDGE_GOOD_MS) {
                        note.headHit = true; note.headJudge = 'miss';
                        this._updateScore('miss'); this._addHitEffect(note.time, note.track, 'miss');
                    }
                } else if (note.type === 'switch') {
                    if (!note.hit && !note.missed && nowMs > note.timeMs + this.JUDGE_GOOD_MS) {
                        note.hit = true; note.missed = true; note.judgeResult = 'good_late';
                        this._updateScore('good_late'); this._addHitEffect(note.time, note.track, 'good_late');
                    }
                }
            }
            this.render();
            this.playTimer = requestAnimationFrame(tick);
        };
        this.playTimer = requestAnimationFrame(tick);
    },

    async play() {
        // 音频未加载时先加载
        if (!this.audioContext || !this.audioBuffer) {
            await this.loadAudio();
            if (!this.audioBuffer) return;
        }
        if (this.audioContext.state === 'closed') {
            this.loadAudio().then(() => this.play());
            return;
        }
        if (this.audioOffset >= this.state.duration) {
            this.audioOffset = 0;
        }

        this.sourceNode = this.audioContext.createBufferSource();
        this.sourceNode.buffer = this.audioBuffer;
        this.sourceNode.connect(this.audioContext.destination);
        this.sourceNode.start(0, this.audioOffset);
        this.audioStartTime = this.audioContext.currentTime;

        this.state.playing = true;
        this.clearPlayTimer();
        this._lastTime = performance.now();

        // 播放时隐藏主页控制按钮
        this._setHomeControlsDisabled(true);

        const tick = () => {
            if (!this.state.playing) return;
            if (this.audioContext) {
                const t = this.audioOffset + (this.audioContext.currentTime - this.audioStartTime);
                this.state.currentTime = t;
                this.state.currentTimeMs = Math.round(t * 1000);
                if (this.state.currentTime >= this.state.duration) {
                    this._showResult();
                    return;
                }
            }
            const nowMs = this.state.currentTimeMs;
            for (const note of this.state.notes) {
                if (note.type === 'tap') {
                    if (!note.hit && nowMs > note.timeMs + this.JUDGE_GOOD_MS) {
                        note.hit = true; note.judgeResult = 'miss';
                        this._updateScore('miss'); this._addHitEffect(note.time, note.track, 'miss');
                    }
                } else if (note.type === 'hold') {
                    if (!note.headHit && nowMs > note.timeMs + this.JUDGE_GOOD_MS) {
                        note.headHit = true; note.headJudge = 'miss';
                        this._updateScore('miss'); this._addHitEffect(note.time, note.track, 'miss');
                    }
                } else if (note.type === 'switch') {
                    if (!note.hit && !note.missed && nowMs > note.timeMs + this.JUDGE_GOOD_MS) {
                        note.hit = true; note.missed = true; note.judgeResult = 'good_late';
                        this._updateScore('good_late'); this._addHitEffect(note.time, note.track, 'good_late');
                    }
                }
            }
            this.render();
            this.playTimer = requestAnimationFrame(tick);
        };
        this.playTimer = requestAnimationFrame(tick);
    },

    pause() {
        if (!this.audioContext) return;
        if (this.sourceNode) {
            try { this.sourceNode.stop(); } catch(e) {}
            this.sourceNode = null;
        }
        this.audioOffset = this.audioOffset + (this.audioContext.currentTime - this.audioStartTime);
        this.state.playing = false;
        this.clearPlayTimer();
        // 释放所有活跃输入
        this.activeInputs.clear();
        this.render();
    },

    stop() {
        this._hideResult();
        if (this.sourceNode) {
            try { this.sourceNode.stop(); } catch(e) {}
            this.sourceNode = null;
        }
        this.audioOffset = 0;
        this.state.currentTime = 0;
        this.state.playing = false;
        this.clearPlayTimer();
        this.activeInputs.clear();
        this.state.score = 0; this.state.combo = 0; this.state.maxCombo = 0;
        this.state.perfectCount = 0; this.state.goodCount = 0; this.state.badCount = 0; this.state.missCount = 0;

        // 停止时恢复主页控制按钮
        this._setHomeControlsDisabled(false);
        this.state.combo = 0; this.state.maxCombo = 0;
        this.state.perfectCount = 0; this.state.goodCount = 0; this.state.badCount = 0; this.state.missCount = 0;
        for (const n of this.state.notes) {
            if (n.type === 'tap') { n.hit = false; n.judgeResult = null; }
            if (n.type === 'hold') { n.headHit = false; n.tailHit = false; n.holding = false; n.headJudge = null; n.tailJudge = null; }
            if (n.type === 'switch') { n.hit = false; n.missed = false; n.judgeResult = null; }
        }
        this.state.hitEffects = [];
        this.render();
    },

    async restart() {
        this.stop();
        // 重新播放也走过场动画
        if (window.PlayerIntro) {
            await window.PlayerIntro.show();
        }
        this.play();
    },

    clearPlayTimer() {
        if (this.playTimer) {
            cancelAnimationFrame(this.playTimer);
            this.playTimer = null;
        }
    },

    _getTrackFromEvent(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (e.clientX || e.pageX) - rect.left;
        const time = this.state.currentTime;
        const trackCount = this.getTrackCountAtTime(time);
        const colWidth = rect.width / (trackCount + 1);

        // 按动画插值后的轨道线位置找最近轨道
        let best = -1, bestD = Infinity;
        for (let t = 0; t < trackCount; t++) {
            const d = Math.abs(x - this._trackXFrac(t, time) * rect.width);
            if (d < bestD) { bestD = d; best = t; }
        }
        return bestD < colWidth * 0.4 ? best : -1;
    },

    _onPress(e) {
        if (!this.state.playing) return;
        const track = this._getTrackFromEvent(e);
        if (track === -1) return;
        const nowMs = this.state.currentTimeMs, inputId = this.nextInputId++;
        let best = null, bestD = Infinity, bestT = null;
        for (const note of this.state.notes) {
            if (note.track !== track) continue;
            const d = nowMs - note.timeMs;
            if (note.type === 'tap' && !note.hit && Math.abs(d) <= this.JUDGE_GOOD_MS && Math.abs(d) < Math.abs(bestD))
                { best = note; bestD = d; bestT = 'tap'; }
            else if (note.type === 'hold' && !note.headHit && Math.abs(d) <= this.JUDGE_GOOD_MS && Math.abs(d) < Math.abs(bestD))
                { best = note; bestD = d; bestT = 'hold'; }
            else if (note.type === 'switch' && !note.hit && !note.missed && Math.abs(d) <= this.JUDGE_GOOD_MS && Math.abs(d) < Math.abs(bestD))
                { best = note; bestD = d; bestT = 'switch'; }
        }
        if (best) {
            const r = this._judgeDeltaMs(bestD);
            if (bestT === 'tap') { best.hit = true; best.judgeResult = r; this._updateScore(r); this._addHitEffect(best.time, track, r); }
            else if (bestT === 'hold') {
                best.headHit = true; best.headJudge = r; this._updateScore(r);
                if (r !== 'bad' && r !== 'miss') { best.holding = true; this.activeInputs.set(inputId, { track, noteId: best.id, startTime: nowMs }); }
                this._addHitEffect(best.time, track, r);
            } else if (bestT === 'switch') {
                best.hit = true; best.judgeResult = r; this._updateScore(r);
                this._addHitEffect(best.time, track, r);
            }
        }
        if (!this.activeInputs.has(inputId)) this.activeInputs.set(inputId, { track, noteId: null, startTime: nowMs });
        e._inputId = inputId;
    },

    _onRelease(e) {
        if (!this.state.playing) return;
        let inputId = e._inputId;
        if (inputId === undefined) {
            const track = this._getTrackFromEvent(e);
            if (track !== -1) for (const [id, d] of this.activeInputs) if (d.track === track) { inputId = id; break; }
        }
        if (inputId === undefined || !this.activeInputs.has(inputId)) return;
        const input = this.activeInputs.get(inputId), nowMs = this.state.currentTimeMs;
        if (input.noteId) {
            const note = this.state.notes.find(n => n.id === input.noteId);
            if (note && note.type === 'hold' && note.headHit && !note.tailHit) {
                const r = this._judgeDeltaMs(nowMs - note.endTimeMs);
                note.tailHit = true; note.tailJudge = r; note.holding = false;
                this._updateScore(r); this._addHitEffect(note.endTime, input.track, r);
            }
        }
        this.activeInputs.delete(inputId);
    },

    _addHitEffect(time, track, type) {
        this.state.hitEffects.push({ time: performance.now(), track, type });
    },

    render() {
        if (!this.ctx || !this.canvas) return;
        const w = this.canvas.width / window.devicePixelRatio;
        const h = this.canvas.height / window.devicePixelRatio;
        const ctx = this.ctx;

        ctx.clearRect(0, 0, w, h);

        const currentTime = this.state.currentTime || 0;
        const trackCount = this.getTrackCountAtTime(currentTime);
        const colCount = trackCount + 1;
        const colWidth = w / colCount;

        // 轨道线（含变轨合并/分裂动画插值）
        const layout = this._getLayoutAt(currentTime);
        // 变轨动画期间：轨道线发白光（正弦包络，中段最亮）
        if (layout.anim) {
            const glow = Math.sin(layout.anim.p * Math.PI);
            const gx = layout.anim.e;
            ctx.save();
            ctx.lineCap = 'round';
            ctx.strokeStyle = `rgba(255,255,255,${0.55 * glow})`;
            ctx.lineWidth = 3 + 9 * glow;
            for (const fx of layout.lines) {
                const x = fx * w;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, h);
                ctx.stroke();
            }
            for (const ex of layout.extra) {
                if (ex.alpha <= 0.01) continue;
                ctx.strokeStyle = `rgba(255,255,255,${0.55 * glow * ex.alpha * gx})`;
                const x = ex.x * w;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, h);
                ctx.stroke();
            }
            ctx.restore();
        }
        ctx.strokeStyle = 'rgba(128,128,128,0.2)';
        ctx.lineWidth = 3; // 轨道线加粗 2px（原 1px）
        for (const fx of layout.lines) {
            const x = fx * w;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        // 变轨动画中正在合并（淡出）/分裂（淡入）的轨道线
        for (const ex of layout.extra) {
            if (ex.alpha <= 0.01) continue;
            ctx.strokeStyle = `rgba(128,128,128,${0.2 * ex.alpha})`;
            const x = ex.x * w;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }

        // 判定线
        ctx.strokeStyle = 'rgba(255,59,48,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, this.judgeOffset);
        ctx.lineTo(w, this.judgeOffset);
        ctx.stroke();

        // 活跃输入的轨道高亮
        const activeTracks = new Set();
        for (const input of this.activeInputs.values()) {
            activeTracks.add(input.track);
        }
        for (const t of activeTracks) {
            const x = this._trackXFrac(t, currentTime) * w;
            ctx.fillStyle = 'rgba(10,132,255,0.15)';
            ctx.fillRect(x - colWidth * 0.4, 0, colWidth * 0.8, h);
        }

        // 音符
        for (const note of this.state.notes) {
            const y = this.judgeOffset - (note.time - currentTime) * this.pps;
            if (y < -100 || y > h + 300) continue;

            const x = this._noteXFrac(note, currentTime) * w;

            if (note.type === 'switch') {
                const size = 16;
                let color;
                if (!note.hit) {
                    color = '#ffcc00';
                } else if (note.judgeResult === 'perfect') {
                    color = 'rgba(48,209,88,0.4)';
                } else if (note.judgeResult === 'good_early' || note.judgeResult === 'good_late') {
                    color = 'rgba(255,204,0,0.4)';
                } else {
                    color = 'rgba(255,59,48,0.4)';
                }
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.moveTo(x, y - size);
                ctx.lineTo(x + size, y);
                ctx.lineTo(x, y + size);
                ctx.lineTo(x - size, y);
                ctx.closePath();
                ctx.fill();
                const targetCount = note.targetTrackCount || 3;
                ctx.fillStyle = note.hit ? 'rgba(255,255,255,0.4)' : '#fff';
                ctx.font = 'bold 10px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(targetCount), x, y);
                continue;
            }

            if (note.type === 'tap') {
                let color;
                if (!note.hit) {
                    color = '#0a84ff';
                } else if (note.judgeResult === 'perfect') {
                    color = 'rgba(48,209,88,0.3)';
                } else if (note.judgeResult === 'good_early' || note.judgeResult === 'good_late') {
                    color = 'rgba(255,204,0,0.3)';
                } else {
                    color = 'rgba(255,59,48,0.3)';
                }
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(x, y, 12, 0, Math.PI * 2);
                ctx.fill();
            } else if (note.type === 'hold') {
                const endY = this.judgeOffset - (note.endTime - currentTime) * this.pps;
                const height = Math.max(y - endY, 4);

                let color;
                if (!note.headHit) {
                    color = '#30d158';
                } else if (note.holding) {
                    color = '#ffcc00';
                } else {
                    const results = [note.headJudge, note.tailJudge].filter(Boolean);
                    if (results.includes('miss') || results.includes('bad')) {
                        color = 'rgba(255,59,48,0.3)';
                    } else if (results.includes('good_early') || results.includes('good_late')) {
                        color = 'rgba(255,204,0,0.3)';
                    } else {
                        color = 'rgba(48,209,88,0.3)';
                    }
                }

                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.roundRect(x - 8, endY, 16, height, 8);
                ctx.fill();

                // 头部圆点
                let headColor;
                if (!note.headHit) headColor = '#fff';
                else if (note.headJudge === 'perfect') headColor = 'rgba(48,209,88,0.8)';
                else if (note.headJudge === 'good_early' || note.headJudge === 'good_late') headColor = 'rgba(255,204,0,0.8)';
                else headColor = 'rgba(255,59,48,0.8)';
                ctx.fillStyle = headColor;
                ctx.beginPath();
                ctx.arc(x, y, 6, 0, Math.PI * 2);
                ctx.fill();

                // 尾部圆点
                let tailColor;
                if (!note.tailHit) tailColor = '#fff';
                else if (note.tailJudge === 'perfect') tailColor = 'rgba(48,209,88,0.8)';
                else if (note.tailJudge === 'good_early' || note.tailJudge === 'good_late') tailColor = 'rgba(255,204,0,0.8)';
                else tailColor = 'rgba(255,59,48,0.8)';
                ctx.fillStyle = tailColor;
                ctx.beginPath();
                ctx.arc(x, endY, 6, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // 命中特效
        const now = performance.now();
        this.state.hitEffects = this.state.hitEffects.filter(e => now - e.time < 300);
        for (const eff of this.state.hitEffects) {
            const progress = (now - eff.time) / 300;
            const alpha = 1 - progress;
            const x = this._trackXFrac(eff.track, currentTime) * w;
            const y = this.judgeOffset;
            const r = 12 + progress * 20;

            let strokeColor;
            if (eff.type === 'miss') strokeColor = `rgba(255,59,48,${alpha})`;
            else if (eff.type === 'bad') strokeColor = `rgba(0,0,0,${alpha})`;
            else if (eff.type === 'good_early' || eff.type === 'good_late') strokeColor = `rgba(255,204,0,${alpha})`;
            else strokeColor = `rgba(48,209,88,${alpha})`;
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.stroke();
        }

        // 分数显示（右上角）
        const totalScore = this._getTotalScore();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(String(totalScore).padStart(7, '0'), w - 10, 24);
        // ACC 显示（分数下方小字）
        ctx.fillStyle = '#888';
        ctx.font = '11px sans-serif';
        ctx.fillText(this._getAccPercent() + '%', w - 10, 38);
        // 连击显示（中央最上方）
        if (this.state.combo > 0) {
            ctx.fillStyle = '#ffcc00';
            ctx.font = 'bold 32px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(String(this.state.combo), w / 2, 36);
            ctx.font = 'bold 11px sans-serif';
            ctx.fillStyle = 'rgba(255,204,0,0.6)';
            ctx.fillText('COMBO', w / 2, 52);
        }
        // 时间显示
        ctx.textAlign = 'left';
        ctx.fillStyle = '#888';
        ctx.font = '12px sans-serif';
        const ct = Math.max(0, this.state.currentTimeMs / 1000 - this.LEAD_IN); // 扣除前导空白，显示音乐时间
        const m = Math.floor(ct / 60);
        const s = Math.floor(ct % 60);
        const ms = Math.floor((ct % 1) * 100);
        ctx.fillText(`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(2,'0')}`, 10, 20);
    },

    show() {
        if (this.container) this.container.style.display = 'block';
        this.resize();
        this.render();
    },

    _showResult() {
        this.pause();
        const s = this.state;
        const totalJudges = this._getTotalJudges();
        const overlay = document.getElementById('result-overlay');
        if (!overlay) return;
        const scoreRatio = this._getTotalScore() / this.SCORE_MAX;
        let rank = 'F', rankClass = 'rank-f';
        if (scoreRatio >= 1.0) { rank = 'Ψ'; rankClass = 'rank-psi'; }
        else if (scoreRatio >= 0.95) { rank = 'S'; rankClass = 'rank-s'; }
        else if (scoreRatio >= 0.90) { rank = 'A'; rankClass = 'rank-a'; }
        else if (scoreRatio >= 0.80) { rank = 'B'; rankClass = 'rank-b'; }
        else if (scoreRatio >= 0.70) { rank = 'C'; rankClass = 'rank-c'; }
        document.getElementById('result-score').textContent = String(this._getTotalScore()).padStart(7, '0');
        const rankEl = document.getElementById('result-rank');
        rankEl.textContent = rank;
        rankEl.className = 'result-rank ' + rankClass;
        document.querySelector('#rs-perfect .rs-count').textContent = s.perfectCount;
        document.querySelector('#rs-good .rs-count').textContent = s.goodCount;
        document.querySelector('#rs-bad .rs-count').textContent = s.badCount;
        document.querySelector('#rs-miss .rs-count').textContent = s.missCount;
        if (totalJudges > 0) {
            document.querySelector('#rs-perfect .rs-bar-inner').style.width = (s.perfectCount / totalJudges * 100) + '%';
            document.querySelector('#rs-good .rs-bar-inner').style.width = (s.goodCount / totalJudges * 100) + '%';
            document.querySelector('#rs-bad .rs-bar-inner').style.width = (s.badCount / totalJudges * 100) + '%';
            document.querySelector('#rs-miss .rs-bar-inner').style.width = (s.missCount / totalJudges * 100) + '%';
        }
        document.getElementById('rs-maxcombo').textContent = s.maxCombo;
        document.getElementById('rs-acc').textContent = this._getAccPercent() + '%';
        overlay.classList.add('active');
    },

    _hideResult() {
        const overlay = document.getElementById('result-overlay');
        if (overlay) overlay.classList.remove('active');
    },

    hide() {
        this.pause();
        // 切换模式/隐藏播放器时同时关闭结算界面
        this._hideResult();
        if (this.container) this.container.style.display = 'none';
    }
};

window.ChartPlayer = ChartPlayer;
