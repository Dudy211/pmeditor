/**
 * player-intro.js — 播放器过场系统
 * 播放前显示谱面信息 + 加载进度条（最少1秒）
 */

const PlayerIntro = {
    panel: null,
    progressBar: null,
    progressInner: null,
    infoTitle: null,
    infoMeta: null,
    minDuration: 1000, // 最少1秒
    startTime: 0,
    resolveCallback: null,

    init() {
        this.panel = document.getElementById('player-intro-panel');
        this.progressBar = document.getElementById('player-intro-progress');
        this.progressInner = document.getElementById('player-intro-progress-inner');
        this.infoTitle = document.getElementById('player-intro-title');
        this.infoMeta = document.getElementById('player-intro-meta');
    },

    async show() {
        if (!this.panel) this.init();
        if (!this.panel) return;

        // 填充谱面信息
        const meta = (window.ChartPlayer && window.ChartPlayer.state && window.ChartPlayer.state.songMeta) || {};
        const pkg = this._getCurrentPackage();
        const pkgMeta = pkg && pkg.meta ? pkg.meta : {};

        const songName = meta.songName || pkgMeta.songName || '未知曲目';
        const songArtist = meta.songArtist || pkgMeta.songArtist || '';
        const charter = meta.charter || pkgMeta.charter || '';
        const illustrator = meta.illustrator || pkgMeta.illustrator || '';

        if (this.infoTitle) this.infoTitle.textContent = songName;
        if (this.infoMeta) {
            const parts = [];
            if (songArtist) parts.push('曲: ' + songArtist);
            if (charter) parts.push('谱: ' + charter);
            if (illustrator) parts.push('绘: ' + illustrator);
            this.infoMeta.innerHTML = parts.map(p => `<span class="intro-meta-item">${p}</span>`).join('');
        }

        // 重置进度条
        if (this.progressInner) this.progressInner.style.width = '0%';
        this.panel.classList.add('active');

        // 过场期间禁用主页控制按钮
        const importRow = document.querySelector('.import-row');
        const selectRow = document.querySelector('.select-row');
        if (importRow) importRow.classList.add('controls-disabled');
        if (selectRow) selectRow.classList.add('controls-disabled');

        this.startTime = performance.now();

        return new Promise(resolve => {
            this.resolveCallback = resolve;
            this._animateProgress();
        });
    },

    _getCurrentPackage() {
        const chart = window.AppState && window.AppState.chart;
        if (!chart || !chart.zipId) return null;
        return window.zipPackages && window.zipPackages[chart.zipId];
    },

    _animateProgress() {
        const elapsed = performance.now() - this.startTime;
        const progress = Math.min(elapsed / this.minDuration, 1);

        if (this.progressInner) {
            this.progressInner.style.width = (progress * 100) + '%';
        }

        if (progress < 1) {
            requestAnimationFrame(() => this._animateProgress());
        } else {
            // 达到最少时间，检查是否还需要等待音频加载
            this._checkReady();
        }
    },

    _checkReady() {
        const player = window.ChartPlayer;
        const audioReady = player && player.audioBuffer && player.audioContext;
        const chartReady = player && player.state && player.state.notes && player.state.notes.length > 0;

        if (audioReady && chartReady) {
            // 全部就绪，隐藏过场
            setTimeout(() => this.hide(), 100);
        } else {
            // 还没加载完，继续等待并显示 "加载中..."
            if (this.progressInner) {
                this.progressInner.style.width = '100%';
                this.progressInner.classList.add('waiting');
            }
            setTimeout(() => this._checkReady(), 100);
        }
    },

    hide() {
        if (!this.panel) return;
        this.panel.classList.remove('active');
        // 过场结束后恢复主页控制按钮
        const importRow = document.querySelector('.import-row');
        const selectRow = document.querySelector('.select-row');
        if (importRow) importRow.classList.remove('controls-disabled');
        if (selectRow) selectRow.classList.remove('controls-disabled');
        if (this.progressInner) this.progressInner.classList.remove('waiting');
        if (this.resolveCallback) {
            this.resolveCallback();
            this.resolveCallback = null;
        }
    }
};

window.PlayerIntro = PlayerIntro;