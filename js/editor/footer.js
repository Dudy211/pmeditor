/**
 * editor/footer.js — 底部状态栏模块
 */

const EditorFooter = {
    create() {
        const el = document.createElement('div');
        el.className = 'editor-footer';
        el.id = 'editor-footer';
        el.innerHTML = `
            <span id="ed-status-time">00:00 / 00:00</span>
            <span id="ed-status-bpm">BPM: --</span>
            <span id="ed-status-notes">音符: 0</span>
            <span id="ed-status-zoom">缩放: 100%</span>
            <div class="ed-minimap" id="ed-minimap">
                <div class="ed-minimap-canvas" id="ed-minimap-canvas"></div>
                <div class="ed-minimap-cursor" id="ed-minimap-cursor"></div>
            </div>
        `;
        return el;
    }
};

window.EditorFooter = EditorFooter;
