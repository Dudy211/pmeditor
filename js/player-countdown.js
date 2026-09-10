/**
 * player-countdown.js — 播放器倒计时系统
 * 暂停后继续时显示 3-2-1 倒计时
 */

const PlayerCountdown = {
    panel: null,
    numberEl: null,
    isRunning: false,
    resolveCallback: null,

    init() {
        this.panel = document.getElementById('player-countdown-panel');
        this.numberEl = document.getElementById('player-countdown-number');
    },

    async start() {
        if (this.isRunning) return;
        if (!this.panel) this.init();
        if (!this.panel) return;

        this.isRunning = true;

        return new Promise(resolve => {
            this.resolveCallback = resolve;
            this._showNumber(3);
        });
    },

    _showNumber(n) {
        if (!this.panel || !this.numberEl) {
            this._finish();
            return;
        }

        this.panel.classList.add('active');
        this.numberEl.textContent = n;
        this.numberEl.classList.remove('pop');
        // 强制重绘以触发动画
        void this.numberEl.offsetWidth;
        this.numberEl.classList.add('pop');

        if (n > 1) {
            setTimeout(() => this._showNumber(n - 1), 800);
        } else {
            setTimeout(() => this._finish(), 800);
        }
    },

    _finish() {
        if (this.panel) this.panel.classList.remove('active');
        this.isRunning = false;
        if (this.resolveCallback) {
            this.resolveCallback();
            this.resolveCallback = null;
        }
    }
};

window.PlayerCountdown = PlayerCountdown;