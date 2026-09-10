/**
 * editor/toolbar.js — 工具栏模块
 */

const EditorToolbar = {
    create() {
        const el = document.createElement('div');
        el.className = 'editor-toolbar';
        el.id = 'editor-toolbar';
        el.innerHTML = `
            <button class="et-btn et-btn-play" id="ed-btn-play" title="播放/暂停 (Space)">播放</button>
            <div class="et-sep"></div>
            <button class="et-btn" id="ed-btn-undo" title="撤销 (Ctrl+Z)">↩ 撤销</button>
            <button class="et-btn" id="ed-btn-redo" title="重做 (Ctrl+Y)">↪ 重做</button>
            <div class="et-sep"></div>
            <button class="et-btn" id="ed-btn-save" title="保存 (Ctrl+S)">💾 保存</button>
            <div class="et-sep"></div>
            <div class="et-dropdown-wrap">
                <button class="et-btn et-dropdown-btn" id="ed-select-music" title="选择音乐">
                    <span>🎵</span>
                    <span id="ed-music-label" class="et-dropdown-label">选择音乐</span>
                    <span>▼</span>
                </button>
                <div class="et-dropdown-panel" id="ed-music-panel">
                    <div class="et-dp-list" id="ed-music-list"></div>
                    <div class="et-dp-empty" id="ed-music-empty">暂无音乐</div>
                </div>
            </div>
            <div class="et-dropdown-wrap">
                <button class="et-btn et-dropdown-btn" id="ed-select-chart" title="选择谱面">
                    <span>📜</span>
                    <span id="ed-chart-label" class="et-dropdown-label">选择谱面</span>
                    <span>▼</span>
                </button>
                <div class="et-dropdown-panel" id="ed-chart-panel">
                    <div class="et-dp-list" id="ed-chart-list"></div>
                    <div class="et-dp-empty" id="ed-chart-empty">暂无谱面</div>
                </div>
            </div>
            <div class="et-sep"></div>
            <span style="font-size:11px;color:var(--text-tertiary);margin-left:auto;user-select:none;">Project Muse Editor</span>
        `;
        return el;
    }
};

window.EditorToolbar = EditorToolbar;
