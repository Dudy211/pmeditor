/**
 * local-charts.js — 本地谱面存储（localStorage）
 * 索引: muse-local-chart-index   -> [{ name, savedAt }]
 * 数据: muse-local-chart::<name>  -> { chart, songMeta, savedAt }
 */
const LocalChartStore = {
    INDEX_KEY: 'muse-local-chart-index',
    _dataKey(name) { return 'muse-local-chart::' + name; },

    list() {
        try { return JSON.parse(localStorage.getItem(this.INDEX_KEY)) || []; }
        catch (e) { return []; }
    },

    _saveIndex(list) { localStorage.setItem(this.INDEX_KEY, JSON.stringify(list)); },

    get(name) {
        try {
            const raw = localStorage.getItem(this._dataKey(name));
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    },

    save(name, payload) {
        localStorage.setItem(this._dataKey(name), JSON.stringify(payload));
        const list = this.list();
        const item = list.find(i => i.name === name);
        if (item) item.savedAt = Date.now();
        else list.push({ name, savedAt: Date.now() });
        this._saveIndex(list);
    },

    remove(name) {
        localStorage.removeItem(this._dataKey(name));
        this._saveIndex(this.list().filter(i => i.name !== name));
    },

    /** 将本地谱面转为 File 对象，供编辑器/播放器原有加载逻辑直接使用 */
    toFile(name) {
        const d = this.get(name);
        if (!d) return null;
        return new File([JSON.stringify(d.chart, null, 2)], name, { type: 'application/json' });
    },
};

window.LocalChartStore = LocalChartStore;
