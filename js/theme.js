/**
 * 主题切换模块
 * 默认夜间模式
 */

const ThemeManager = {
    STORAGE_KEY: 'muse-editor-theme',

    init() {
        // 读取保存的主题，无保存则默认夜间模式
        const saved = localStorage.getItem(this.STORAGE_KEY);
        const theme = saved || 'dark';

        this.setTheme(theme);

        // 绑定按钮
        const btn = document.getElementById('btn-theme');
        if (btn) {
            btn.addEventListener('click', () => this.toggle());
        }
    },

    getTheme() {
        return document.documentElement.getAttribute('data-theme') || 'dark';
    },

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(this.STORAGE_KEY, theme);
        this.updateIcon(theme);
        window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
    },

    toggle() {
        const current = this.getTheme();
        const next = current === 'dark' ? 'light' : 'dark';
        this.setTheme(next);
    },

    updateIcon(theme) {
        const btn = document.getElementById('btn-theme');
        if (btn) {
            btn.textContent = theme === 'dark' ? '☀️' : '🌙';
            btn.title = theme === 'dark' ? '切换到白天模式' : '切换到黑夜模式';
        }
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ThemeManager.init());
} else {
    ThemeManager.init();
}