/**
 * 工作区全屏管理模块
 * 负责全屏进入/退出、横屏锁定、提示层控制
 */

const WorkspaceFullscreen = {
    isFullscreen: false,
    fsPrompt: null,
    fsTrigger: null,
    menuTrigger: null,
    menuPanel: null,
    workspaceInner: null,

    init() {
        this.fsPrompt = document.getElementById('workspace-fs-prompt');
        this.fsTrigger = document.getElementById('workspace-fs-trigger');
        this.menuTrigger = document.getElementById('workspace-menu-trigger');
        this.menuPanel = document.getElementById('player-menu-panel');
        this.replayTrigger = document.getElementById('workspace-replay-trigger');
        this.modeTrigger = document.getElementById('workspace-mode-trigger');
        this.workspaceInner = document.getElementById('workspace-inner');

        if (this.fsTrigger) {
            this.fsTrigger.addEventListener('dblclick', () => this.toggleFullscreen());
        }

        // 监听窗口大小变化（全屏/旋转时刷新播放器）
        window.addEventListener('resize', () => {
            if (window.ChartPlayer) {
                window.ChartPlayer.resize();
                window.ChartPlayer.render();
            }
        });

        if (this.menuTrigger) {
            this.menuTrigger.addEventListener('dblclick', () => this.togglePlayerMenu());
        }

        if (this.replayTrigger) {
            this.replayTrigger.addEventListener('dblclick', () => this.resetEditor());
        }

        if (this.modeTrigger) {
            this.modeTrigger.addEventListener('dblclick', () => this.toggleMode());
        }

        // 播放菜单按钮
        const pmResume = document.getElementById('pm-btn-resume');
        const pmRestart = document.getElementById('pm-btn-restart');
        if (pmResume) {
            pmResume.addEventListener('click', async () => {
                this.hidePlayerMenu();
                // 先倒计时 3-2-1，再恢复播放
                if (window.PlayerCountdown) {
                    await window.PlayerCountdown.start();
                }
                if (window.ChartPlayer) window.ChartPlayer._resumePlay();
            });
        }
        if (pmRestart) {
            pmRestart.addEventListener('click', () => {
                this.hidePlayerMenu();
                if (window.ChartPlayer) window.ChartPlayer.restart();
            });
        }
        // 点击遮罩关闭菜单
        const pmOverlay = document.querySelector('.player-menu-overlay');
        if (pmOverlay) {
            pmOverlay.addEventListener('click', () => this.hidePlayerMenu());
        }

        document.addEventListener('fullscreenchange', () => this.onFullscreenChange());
        document.addEventListener('webkitfullscreenchange', () => this.onFullscreenChange());
        document.addEventListener('mozfullscreenchange', () => this.onFullscreenChange());
        document.addEventListener('MSFullscreenChange', () => this.onFullscreenChange());
    },

    async toggleFullscreen() {
        if (!window.AppState || !window.AppState.mode) return;

        if (this.isFullscreen) {
            this.exitFullscreen();
        } else {
            await this.enterFullscreen();
        }
    },

    async enterFullscreen() {
        if (!this.workspaceInner) return;

        try {
            const req = this.workspaceInner.requestFullscreen ||
                       this.workspaceInner.webkitRequestFullscreen ||
                       this.workspaceInner.mozRequestFullScreen ||
                       this.workspaceInner.msRequestFullscreen;

            if (req) {
                await req.call(this.workspaceInner);
                // 全屏成功后再锁定方向，确保仍在用户手势上下文中
                if (window.AppState && window.AppState.mode === 'player') {
                    await this.lockPortrait();
                } else if (window.AppState && window.AppState.mode === 'editor') {
                    await this.lockLandscape();
                }
            } else {
                this.workspaceInner.classList.add('fullscreen');
                this.isFullscreen = true;
                if (window.AppState && window.AppState.mode === 'player') {
                    await this.lockPortrait();
                } else if (window.AppState && window.AppState.mode === 'editor') {
                    await this.lockLandscape();
                }
                await this.onEnter();
            }
        } catch (err) {
            console.warn('全屏请求失败，降级为 CSS 全屏:', err);
            this.workspaceInner.classList.add('fullscreen');
            this.isFullscreen = true;
            if (window.AppState && window.AppState.mode === 'player') {
                await this.lockPortrait();
            } else if (window.AppState && window.AppState.mode === 'editor') {
                await this.lockLandscape();
            }
            await this.onEnter();
        }
    },

    exitFullscreen() {
        const doc = document;
        if (doc.exitFullscreen) {
            doc.exitFullscreen().catch(() => {});
        } else if (doc.webkitExitFullscreen) {
            doc.webkitExitFullscreen();
        } else if (doc.mozCancelFullScreen) {
            doc.mozCancelFullScreen();
        } else if (doc.msExitFullscreen) {
            doc.msExitFullscreen();
        }

        if (this.workspaceInner) {
            this.workspaceInner.classList.remove('fullscreen');
        }
        this.isFullscreen = false;
        this.onExit();
    },

    async onFullscreenChange() {
        const fsElement = document.fullscreenElement ||
                          document.webkitFullscreenElement ||
                          document.mozFullScreenElement ||
                          document.msFullscreenElement;

        const wasFullscreen = this.isFullscreen;
        this.isFullscreen = !!fsElement;

        if (this.workspaceInner) {
            this.workspaceInner.classList.toggle('fullscreen', this.isFullscreen);
        }

        if (this.isFullscreen && !wasFullscreen) {
            // 全屏进入后再次锁定方向（保险，防止某些浏览器忽略之前的锁定）
            try {
                if (window.AppState && window.AppState.mode === 'player') {
                    await this.lockPortrait();
                } else if (window.AppState && window.AppState.mode === 'editor') {
                    await this.lockLandscape();
                }
            } catch (e) {
                console.warn('全屏变化时方向锁定失败:', e.message || e);
            }
            await this.onEnter();
        } else if (!this.isFullscreen && wasFullscreen) {
            this.onExit();
        }
    },

    async onEnter() {
        if (this.fsPrompt) this.fsPrompt.classList.remove('active');

        if (window.AppState && window.AppState.mode === 'editor' && window.ChartEditor) {
            window.ChartEditor.init();
            window.ChartEditor.show();
        }
    },

    onExit() {
        this.unlockOrientation();
        this.updatePromptVisibility();

        if (window.AppState && window.AppState.mode === 'editor' && window.ChartEditor) {
            window.ChartEditor.hide();
        }
    },

    async lockLandscape() {
        try {
            if (!screen.orientation || !screen.orientation.lock) {
                console.warn('当前浏览器不支持屏幕方向锁定');
                return;
            }
            const current = screen.orientation.type || '';
            if (current.includes('landscape')) {
                console.log('已经是横屏，跳过锁定');
                return;
            }
            await screen.orientation.lock('landscape');
            console.log('横屏锁定成功');
        } catch (e) {
            console.warn('横屏锁定失败:', e.message || e);
        }
    },

    async lockPortrait() {
        try {
            if (!screen.orientation || !screen.orientation.lock) {
                console.warn('当前浏览器不支持屏幕方向锁定');
                return;
            }
            const current = screen.orientation.type || '';
            if (current.includes('portrait')) {
                console.log('已经是竖屏，跳过锁定');
                return;
            }
            await screen.orientation.lock('portrait');
            console.log('竖屏锁定成功');
        } catch (e) {
            console.warn('竖屏锁定失败:', e.message || e);
        }
    },

    unlockOrientation() {
        try {
            if (screen.orientation && screen.orientation.unlock) {
                screen.orientation.unlock();
            }
        } catch (e) {
            console.warn('解除屏幕锁定失败:', e);
        }
    },

    togglePlayerMenu() {
        if (!window.AppState || window.AppState.mode !== 'player') return;
        if (!this.menuPanel) return;
        this.menuPanel.classList.toggle('active');
        if (window.ChartPlayer) {
            if (this.menuPanel.classList.contains('active')) {
                window.ChartPlayer.pause();
            }
        }
    },

    hidePlayerMenu() {
        if (this.menuPanel) this.menuPanel.classList.remove('active');
    },

    resetEditor() {
        if (!window.AppState || !window.AppState.mode) return;
        if (window.ChartEditor) {
            const ce = window.ChartEditor;
            if (ce.sourceNode) {
                try { ce.sourceNode.stop(); } catch(e) {}
                ce.sourceNode = null;
            }
            ce.state.playing = false;
            ce.state.currentTime = 0;
            ce.audioOffset = 0;
            ce.state.selectedNotes = [];
            if (ce.clearPlayTimer) ce.clearPlayTimer();
            if (ce.updatePlayButton) ce.updatePlayButton();
            if (ce.updateStatus) ce.updateStatus();
            if (window.EditorTimeline) EditorTimeline.render();
            if (window.setStatus) window.setStatus('已重置');
        }
        if (window.ChartPlayer) window.ChartPlayer.restart();
    },

    toggleMode() {
        if (!window.AppState || !window.AppState.mode) return;
        const nextMode = window.AppState.mode === 'editor' ? 'player' : 'editor';
        if (window.enterMode) {
            window.enterMode(nextMode);
        }
    },

    updatePromptVisibility() {
        if (!this.fsPrompt) return;
        // 仅制谱器模式下非全屏时显示提示
        if (window.AppState && window.AppState.mode === 'editor' && !this.isFullscreen) {
            this.fsPrompt.classList.add('active');
        } else {
            this.fsPrompt.classList.remove('active');
        }
    }
};

window.WorkspaceFullscreen = WorkspaceFullscreen;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => WorkspaceFullscreen.init());
} else {
    WorkspaceFullscreen.init();
}