/**
 * Project Muse 首页交互
 */

document.addEventListener('DOMContentLoaded', () => {
    window.AppState = { music: null, chart: null, skin: null, mode: null, isDirty: false };
    const state = window.AppState;
    const fileLists = { music: [], chart: [], skin: [] };
    window.zipPackages = {};
    const zipPackages = window.zipPackages;

    const uploadMap = [
        { btnId: 'upload-zip', inputId: 'input-zip', label: '谱面包', ext: ['.pms'], type: 'zip' },
        { btnId: 'upload-pms', inputId: 'input-pms', label: '皮肤包', ext: ['.zip'], type: 'skin' },
        { btnId: 'upload-music', inputId: 'input-music', label: '音乐', ext: ['.mp3','.wav','.ogg','.flac','.m4a','.aac'], type: 'music' },
        { btnId: 'upload-chart', inputId: 'input-chart', label: '谱面', ext: ['.json'], type: 'chart' }
    ];

    uploadMap.forEach(({ btnId, inputId, label, ext, type }) => {
        const btn = document.getElementById(btnId);
        const input = document.getElementById(inputId);
        if (!btn || !input) return;
        btn.addEventListener('click', () => input.click());
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const fileExt = '.' + file.name.split('.').pop().toLowerCase();
            const isValid = ext.some(a => fileExt === a.toLowerCase());
            if (!isValid) {
                showToast('格式错误，请上传 ' + ext.join('/') + ' 格式', 'error');
                input.value = '';
                return;
            }
            if (type === 'zip') {
                parseZip(file);
            } else {
                const fd = { name: file.name, file, id: Date.now() + Math.random() };
                fileLists[type].push(fd);
                refreshDropdown(type);
                // 首次上传时自动选中，之后不再自动选最新
                if (!state[type]) {
                    state[type] = fd;
                    updateLabel(type);
                    highlightSelected(type);
                }
                setStatus('已导入 ' + label + ': ' + file.name);
            }
        });
    });

    // 导出按钮
    const exportBtn = document.getElementById('export-chart');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (state.mode !== 'editor') {
                showToast('请先进入制谱器模式', 'warning');
                return;
            }
            if (window.ChartEditor && window.ChartEditor.exportPackage) {
                window.ChartEditor.exportPackage();
            } else {
                showToast('编辑器未初始化', 'error');
            }
        });
    }

    async function parseZip(file) {
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
            const zip = await JSZip.loadAsync(file);
            const hasMeta = zip.file('meta.yaml') || zip.file('meta.yml');
            let hasChart = false, hasMusic = false;
            zip.forEach((rp, ze) => {
                if (ze.dir) return;
                const ext = '.' + rp.split('.').pop().toLowerCase();
                if (ext === '.json') hasChart = true;
                if (['.mp3','.wav','.ogg','.flac','.m4a','.aac'].includes(ext)) hasMusic = true;
            });
            if (!hasMeta) { showToast('谱面包缺少 meta.yaml', 'error'); return; }
            if (!hasChart) { showToast('谱面包缺少谱面文件 (.json)', 'error'); return; }
            if (!hasMusic) { showToast('谱面包缺少音乐文件', 'error'); return; }

            const zid = Date.now() + Math.random();
            const pkg = { name: file.name, file, id: zid, files: {}, meta: {} };
            const mf = zip.file('meta.yaml') || zip.file('meta.yml');
            if (mf) {
                const c = await mf.async('string');
                c.split('\n').forEach(l => {
                    const m = l.match(/^\s*(\w+)\s*:\s*(.*)$/);
                    if (m) pkg.meta[m[1].trim()] = m[2].trim();
                });
                // 解析 modifier 为数组（逗号分隔）
                if (pkg.meta.modifier) {
                    pkg.meta.modifiers = pkg.meta.modifier.split(',').map(s => s.trim()).filter(Boolean);
                    delete pkg.meta.modifier;
                }
            }
            const ps = [];
            zip.forEach((rp, ze) => {
                if (ze.dir) return;
                const ext = '.' + rp.split('.').pop().toLowerCase();
                const nm = rp.split('/').pop();
                if (ext === '.json') {
                    ps.push(ze.async('blob').then(b => {
                        pkg.files.chart = { name: nm, file: new File([b], nm, {type:'application/json'}), id: zid+'_c', zipId: zid };
                    }));
                } else if (['.mp3','.wav','.ogg','.flac','.m4a','.aac'].includes(ext)) {
                    ps.push(ze.async('blob').then(b => {
                        pkg.files.music = { name: nm, file: new File([b], nm, {type:'audio/'+ext.slice(1)}), id: zid+'_m', zipId: zid };
                    }));
                } else if (ext === '.pms') {
                    ps.push(ze.async('blob').then(b => {
                        pkg.files.skin = { name: nm, file: new File([b], nm, {type:'application/octet-stream'}), id: zid+'_s', zipId: zid };
                    }));
                }
            });
            await Promise.all(ps);
            zipPackages[zid] = pkg;
            // 同名文件去重：已存在同名条目时覆盖更新，避免下拉列表出现重复项
            const upsert = (list, entry) => {
                const idx = list.findIndex(f => f.name === entry.name);
                if (idx >= 0) list[idx] = entry;
                else list.push(entry);
            };
            if (pkg.files.chart) { await upsertChartEntry(pkg.files.chart); refreshDropdown('chart'); }
            if (pkg.files.music) { upsert(fileLists.music, pkg.files.music); refreshDropdown('music'); }
            if (pkg.files.skin) { upsert(fileLists.skin, pkg.files.skin); refreshDropdown('skin'); }
            // 非编辑器模式下自动选择谱面包内的文件
            if (state.mode !== 'editor') {
                if (pkg.files.chart && !state.chart) {
                    state.chart = pkg.files.chart;
                    updateLabel('chart');
                    highlightSelected('chart');
                }
                if (pkg.files.music && !state.music) {
                    state.music = pkg.files.music;
                    updateLabel('music');
                    highlightSelected('music');
                }
                if (pkg.files.skin && !state.skin) {
                    state.skin = pkg.files.skin;
                    updateLabel('skin');
                    highlightSelected('skin');
                }
            }
            setStatus('已导入谱面包: ' + file.name);
            showToast('谱面包导入成功', 'success');
        } catch (e) {
            showToast('谱面包解析失败', 'error');
        }
    }

    function refreshDropdown(type) {
        const lm = { music: 'music-list', chart: 'chart-list', skin: 'skin-list' };
        const em = { music: 'music-empty', chart: 'chart-empty', skin: 'skin-empty' };
        const list = document.getElementById(lm[type]);
        const empty = document.getElementById(em[type]);
        if (!list) return;
        list.innerHTML = '';
        const items = fileLists[type];
        if (type === 'chart') {
            const nb = document.createElement('div');
            nb.className = 'dp-item dp-new';
            nb.textContent = '\u2795 新建谱面 (default.json)';
            nb.style.cssText = 'color:var(--accent-primary);font-weight:600;border-bottom:1px solid var(--border-color);margin-bottom:4px;padding-bottom:8px;';
            nb.addEventListener('click', function(e) {
                e.stopPropagation();
                let maxIdx = -1;
                fileLists.chart.forEach(f => {
                    const m = f.name.match(/^default(\d+)\.json$/);
                    if (m) maxIdx = Math.max(maxIdx, parseInt(m[1]));
                });
                const nextIdx = maxIdx + 1;
                const newName = 'default' + nextIdx + '.json';
                const newFile = { name: newName, file: null, autoCreated: true, id: 'new_' + nextIdx + '_' + Date.now() };
                fileLists.chart.push(newFile);
                refreshDropdown('chart');
                if (!state.chart) {
                    state.chart = newFile;
                    updateLabel('chart');
                    highlightSelected('chart');
                }
                closeAllDropdowns();
                setStatus('已新建谱面: ' + newName);
            });
            list.appendChild(nb);
        }
        if (items.length === 0) {
            if (empty) empty.style.display = type === 'chart' ? 'none' : 'block';
            highlightSelected(type);
            return;
        }
        if (empty) empty.style.display = 'none';
        const icons = { music: '\uD83C\uDFB5', chart: '\uD83D\uDCDC', skin: '\uD83C\uDFA8' };
        items.forEach(item => {
            const d = document.createElement('div');
            d.className = 'dp-item';
            d.dataset.file = item.id;
            const iconSpan = document.createElement('span');
            iconSpan.textContent = icons[type] + ' ';
            iconSpan.style.flexShrink = '0';
            d.appendChild(iconSpan);
            const nameSpan = document.createElement('span');
            nameSpan.className = 'dp-item-name';
            nameSpan.textContent = item.name;
            nameSpan.style.flex = '1';
            nameSpan.style.overflow = 'hidden';
            nameSpan.style.textOverflow = 'ellipsis';
            d.appendChild(nameSpan);
            if (type === 'chart' && /^default.*\.json$/i.test(item.name) && state.mode === 'editor') {
                const renameBtn = document.createElement('span');
                renameBtn.className = 'dp-rename-btn';
                renameBtn.textContent = '\u270F\uFE0F';
                renameBtn.title = '重命名';
                renameBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    startRename(item, d, nameSpan);
                });
                d.appendChild(renameBtn);
            }
            list.appendChild(d);
        });
        highlightSelected(type);
    }

    function highlightSelected(type) {
        const lm = { music: 'music-list', chart: 'chart-list', skin: 'skin-list' };
        const list = document.getElementById(lm[type]);
        if (!list) return;
        list.querySelectorAll('.dp-item').forEach(el => {
            el.classList.remove('active');
            if (!state[type]) return;
            if (el.dataset.file && String(state[type].id) === el.dataset.file) el.classList.add('active');
            if (type === 'chart' && state[type].autoCreated && el.classList.contains('dp-new')) el.classList.add('active');
        });
    }

    const dropdowns = [
        { btnId: 'select-music-btn', panelId: 'music-panel', labelId: 'music-label', searchId: 'music-search', listId: 'music-list', emptyId: 'music-empty', type: 'music' },
        { btnId: 'select-chart-btn', panelId: 'chart-panel', labelId: 'chart-label', searchId: 'chart-search', listId: 'chart-list', emptyId: 'chart-empty', type: 'chart' },
        { btnId: 'select-skin-btn', panelId: 'skin-panel', labelId: 'skin-label', searchId: 'skin-search', listId: 'skin-list', emptyId: 'skin-empty', type: 'skin' }
    ];

    dropdowns.forEach(({ btnId, panelId, labelId, searchId, listId, emptyId, type }) => {
        const btn = document.getElementById(btnId);
        const panel = document.getElementById(panelId);
        const label = document.getElementById(labelId);
        const search = document.getElementById(searchId);
        const list = document.getElementById(listId);
        const empty = document.getElementById(emptyId);
        if (!btn || !panel) return;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = panel.classList.contains('open');
            closeAllDropdowns();
            if (!isOpen) {
                panel.classList.add('open');
                btn.classList.add('open');
                if (search) search.focus();
            }
        });
        if (list) {
            list.addEventListener('click', (e) => {
                const item = e.target.closest('.dp-item');
                if (!item) return;
                if (item.classList.contains('dp-new')) return;
                list.querySelectorAll('.dp-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                const text = item.textContent.trim();
                const fid = item.dataset.file;
                const fd = fileLists[type].find(f => String(f.id) === fid);
                // 选择音乐时自动联动同一谱面包的谱面和皮肤
                if (fd && fd.zipId && zipPackages[fd.zipId]) {
                    const pkg = zipPackages[fd.zipId];
                    if (type === 'music' && pkg.files.chart) {
                        state.chart = pkg.files.chart;
                        updateLabel('chart');
                        highlightSelected('chart');
                    }
                    if (type === 'music' && pkg.files.skin) {
                        state.skin = pkg.files.skin;
                        updateLabel('skin');
                        highlightSelected('skin');
                    }
                }
                state[type] = fd || { name: text, file: null };
                label.textContent = text.replace(/^[^\s]+\s/, '');
                label.title = text.replace(/^[^\s]+\s/, '');
                closeAllDropdowns();
                setStatus('已选择: ' + text);
            });
        }
        if (search && list) {
            search.addEventListener('input', () => {
                const q = search.value.toLowerCase();
                let v = 0;
                list.querySelectorAll('.dp-item').forEach(el => {
                    const m = el.textContent.toLowerCase().includes(q);
                    el.style.display = m ? '' : 'none';
                    if (m) v++;
                });
                if (empty) empty.style.display = v === 0 ? 'block' : 'none';
            });
        }
    });

    document.addEventListener('click', () => closeAllDropdowns());
    document.querySelectorAll('.dropdown-panel').forEach(p => p.addEventListener('click', e => e.stopPropagation()));

    function closeAllDropdowns() {
        document.querySelectorAll('.dropdown-panel').forEach(p => p.classList.remove('open'));
        document.querySelectorAll('.dropdown-btn').forEach(b => b.classList.remove('open'));
    }

    function updateLabel(type) {
        const map = { music: 'music-label', chart: 'chart-label', skin: 'skin-label' };
        const el = document.getElementById(map[type]);
        if (el && state[type]) { el.textContent = state[type].name; el.title = state[type].name; }
    }

    const modeSelector = document.getElementById('mode-selector');
    const modeFloat = document.getElementById('mode-float');
    const mfIcon = document.getElementById('mf-icon');
    const mfName = document.getElementById('mf-name');
    const cfgMap = { editor: { icon: '\uD83C\uDFB9', name: '制谱器', label: '制谱器模式' }, player: { icon: '\u25B6', name: '播放器', label: '播放器模式' } };

    document.querySelectorAll('.mode-btn').forEach(b => b.addEventListener('click', () => enterMode(b.dataset.mode)));

    let lastClick = 0;
    modeFloat.addEventListener('click', () => {
        const now = Date.now();
        if (now - lastClick < 300) switchModeWithSaveCheck();
        lastClick = now;
    });

    function switchModeWithSaveCheck() {
        if (!state.mode) return;
        const nextMode = state.mode === 'editor' ? 'player' : 'editor';
        enterMode(nextMode);
    }

    function enterMode(mode) {
        const cfg = cfgMap[mode];
        // 编辑器 -> 播放器：询问保存
        if (state.mode === 'editor' && mode === 'player') {
            showSaveConfirm((action) => {
                if (action === 'cancel') return;
                if (action === 'save') {
                    doSaveChart(() => performEnterMode(mode));
                } else {
                    performEnterMode(mode);
                }
            });
            return;
        }
        performEnterMode(mode);
    }

    
    /* ===== 保存确认弹窗 ===== */
    function showSaveConfirm(callback) {
        const existing = document.getElementById('save-confirm-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'save-confirm-modal';
        overlay.id = 'save-confirm-modal';
        overlay.innerHTML = `
            <div class="scm-overlay"></div>
            <div class="scm-dialog">
                <div class="scm-title">保存谱面</div>
                <div class="scm-desc">切换至播放器模式前，是否保存当前谱面？</div>
                <div class="scm-btns">
                    <button class="scm-btn scm-save">💾 保存</button>
                    <button class="scm-btn scm-discard">🗑 不保存</button>
                    <button class="scm-btn scm-cancel">↩ 取消</button>
                </div>
            </div>
        `;
        // 全屏时弹窗必须挂在全屏根元素内部，否则会被浏览器隐藏
        const fsRoot = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
        if (fsRoot) {
            fsRoot.appendChild(overlay);
        } else {
            document.body.appendChild(overlay);
        }

        const close = (action) => {
            overlay.classList.add('fade-out');
            setTimeout(() => overlay.remove(), 250);
            callback(action);
        };

        overlay.querySelector('.scm-save').addEventListener('click', () => close('save'));
        overlay.querySelector('.scm-discard').addEventListener('click', () => close('discard'));
        overlay.querySelector('.scm-cancel').addEventListener('click', () => close('cancel'));
        overlay.querySelector('.scm-overlay').addEventListener('click', () => close('cancel'));
    }

    function doSaveChart(callback) {
        if (window.ChartEditor && window.ChartEditor.save) {
            window.ChartEditor.save();
            if (callback) callback();
        } else {
            setTimeout(() => {
                state.isDirty = false;
                showToast('谱面已保存', 'success');
                if (callback) callback();
            }, 300);
        }
    }

    // ===== 本地谱面：恢复 & 注册 =====
    window.registerLocalChart = function(name, file, refEntry) {
        // 优先按引用匹配（防止列表里有两个同名条目时更新错对象），其次按名字
        const existing = (refEntry && fileLists.chart.find(f => f === refEntry))
            || fileLists.chart.find(f => f.name === name);
        if (existing) {
            existing.file = file;
            existing.local = true;
            delete existing.autoCreated;
        } else {
            fileLists.chart.push({ name, file, local: true, id: 'local_' + name });
        }
        refreshDropdown('chart');
    };

    // 谱面身份识别：读 chartId（新增字段），旧谱面无 chartId 时返回 null
    function parseChartId(text) {
        try { const d = JSON.parse(text); return (d && d.chartId) ? d.chartId : null; }
        catch (e) { return null; }
    }

    // 撞名自动改名：chart.json → chart (2).json → chart (3).json ...
    function uniqueChartName(name) {
        const m = name.match(/^(.*)\.json$/i);
        const base = m ? m[1] : name;
        let i = 2;
        while (fileLists.chart.some(f => f.name === base + ' (' + i + ').json')) i++;
        return base + ' (' + i + ').json';
    }

    // 谱面导入去重升级：chartId 相同或内容相同 → 覆盖更新（同一谱面的新版本）；
    // chartId 不同且内容不同 → 不同谱面撞名，自动改名后并存
    async function upsertChartEntry(entry) {
        const idx = fileLists.chart.findIndex(f => f.name === entry.name);
        if (idx < 0) { fileLists.chart.push(entry); return; }
        const existing = fileLists.chart[idx];
        try {
            const newText = await entry.file.text();
            const oldText = existing.file ? await existing.file.text() : '';
            const newId = parseChartId(newText);
            const oldId = parseChartId(oldText);
            const sameChart = (newId && oldId && newId === oldId) || (newText === oldText);
            if (sameChart) {
                fileLists.chart[idx] = entry; // 同一谱面：覆盖更新
            } else {
                entry.name = uniqueChartName(entry.name); // 撞名：自动改名并存
                fileLists.chart.push(entry);
            }
        } catch (e) {
            fileLists.chart[idx] = entry;
        }
    }

    try {
        if (window.LocalChartStore) {
            window.LocalChartStore.list().forEach(item => {
                if (fileLists.chart.some(f => f.name === item.name)) return;
                const file = window.LocalChartStore.toFile(item.name);
                if (file) fileLists.chart.push({ name: item.name, file, local: true, id: 'local_' + item.name });
            });
            refreshDropdown('chart');
        }
    } catch (e) { console.warn('本地谱面恢复失败', e); }

async function performEnterMode(mode) {
        const cfg = cfgMap[mode];
        if (mode === 'editor') {
            if (!state.music) { showToast('请先选择音乐文件', 'warning'); return; }
            if (!state.chart) {
                state.chart = { name: 'default0.json', file: null, autoCreated: true, id: 'new_0_' + Date.now() };
                fileLists.chart.push(state.chart);
                refreshDropdown('chart');
                updateLabel('chart');
            }
            // 隐藏播放器，避免遮挡编辑器
            if (window.ChartPlayer) window.ChartPlayer.hide();
            if (window.WorkspaceFullscreen && !window.WorkspaceFullscreen.isFullscreen) {
                if (window.WorkspaceFullscreen.fsPrompt) {
                    window.WorkspaceFullscreen.fsPrompt.classList.add('active');
                }
            } else {
                if (window.ChartEditor) {
                    window.ChartEditor.init();
                    window.ChartEditor.show();
                }
            }
        } else if (mode === 'player') {
            if (!state.music) { showToast('请先选择音乐文件', 'warning'); return; }
            if (!state.chart) { showToast('请先选择谱面文件', 'warning'); return; }
            if (window.ChartEditor) window.ChartEditor.hide();
            if (window.ChartPlayer) {
                window.ChartPlayer.init();
                // 进入播放器时显示加载过场
                if (window.PlayerIntro) {
                    await window.PlayerIntro.show();
                }
                window.ChartPlayer.show();
                // 过场完成后自动开始播放
                window.ChartPlayer.play();
            }
        }
        state.mode = mode;
        state.isDirty = false;
        modeSelector.style.display = 'none';
        modeFloat.style.display = 'none';
        mfIcon.textContent = cfg.icon;
        mfName.textContent = cfg.name;
        setStatus('已进入' + cfg.label);
        refreshDropdown('chart');

        // 更新导出按钮可用状态
        const exportBtn = document.getElementById('export-chart');
        if (exportBtn) {
            if (mode === 'editor') {
                exportBtn.disabled = false;
                exportBtn.title = '导出当前谱面 .json';
            } else {
                exportBtn.disabled = true;
                exportBtn.title = '仅在制谱器模式下可用';
            }
        }

        // 恢复主页控制按钮（切换模式时）
        const importRow = document.querySelector('.import-row');
        const selectRow = document.querySelector('.select-row');
        if (importRow) importRow.classList.remove('controls-disabled');
        if (selectRow) selectRow.classList.remove('controls-disabled');

        // 更新 workspace 模式类
        const workspaceInner = document.getElementById('workspace-inner');
        if (workspaceInner) {
            workspaceInner.classList.remove('editor-mode', 'player-mode');
            workspaceInner.classList.add(mode + '-mode');
        }

        // 更新右下角触发区图标样式
        const mt = document.getElementById('workspace-mode-trigger');
        if (mt) {
            mt.classList.remove('editor', 'player');
            mt.classList.add(mode);
        }

        if (window.WorkspaceFullscreen) {
            window.WorkspaceFullscreen.updatePromptVisibility();
        }
    }

    const tc = document.getElementById('toast-container');
    function showToast(msg, type, dur) {
        dur = dur || 2000;
        const t = document.createElement('div');
        t.className = 'toast ' + type;
        const icons = { warning: '\u26A0\uFE0F', error: '\u274C', success: '\u2705', info: '\u2139\uFE0F' };
        t.innerHTML = '<span class="toast-icon">' + (icons[type] || '\u2139\uFE0F') + '</span><span class="toast-msg">' + msg + '</span><button class="toast-close">\u2715</button><div class="toast-bar"><div class="toast-bar-fill"></div></div>';
        tc.appendChild(t);
        const bf = t.querySelector('.toast-bar-fill');
        const cb = t.querySelector('.toast-close');
        bf.style.width = '100%';
        bf.style.transition = 'none';
        requestAnimationFrame(() => requestAnimationFrame(() => { bf.style.transition = 'width ' + dur + 'ms linear'; bf.style.width = '0%'; }));
        cb.addEventListener('click', () => rm(t));
        const timer = setTimeout(() => rm(t), dur);
        function rm(el) { clearTimeout(timer); el.classList.add('fade-out'); setTimeout(() => el.remove(), 300); }
    }

    
    window.showToast = showToast;function setStatus(t) { const el = document.getElementById('status-text'); if (el) el.textContent = t; }

    refreshDropdown('music');
    refreshDropdown('chart');
    refreshDropdown('skin');

    function startRename(item, rowEl, nameSpan) {
        if (rowEl.querySelector('.dp-rename-input')) return;
        const baseName = item.name.replace(/\.json$/i, '');
        nameSpan.style.display = 'none';
        const renameWrap = document.createElement('span');
        renameWrap.className = 'dp-rename-wrap';
        renameWrap.style.cssText = 'display:flex;align-items:center;flex:1;gap:2px;min-width:0;';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'dp-rename-input';
        input.value = baseName;
        input.style.cssText = 'flex:1;min-width:0;';
        const extLabel = document.createElement('span');
        extLabel.className = 'dp-rename-ext';
        extLabel.textContent = '.json';
        extLabel.style.cssText = 'color:var(--text-tertiary);font-size:12px;flex-shrink:0;user-select:none;';
        renameWrap.appendChild(input);
        renameWrap.appendChild(extLabel);
        rowEl.insertBefore(renameWrap, nameSpan.nextSibling);
        input.focus();
        input.select();
        const confirmRename = () => {
            const newBase = input.value.trim();
            if (!newBase || newBase === baseName) { cancelRename(); return; }
            const newName = newBase + '.json';
            const exists = fileLists.chart.some(f => f !== item && f.name === newName);
            if (exists) { showToast('文件名已存在', 'warning'); input.focus(); return; }
            item.name = newName;
            nameSpan.textContent = newName;
            cancelRename();
            refreshDropdown('chart');
            if (state.chart && state.chart.id === item.id) updateLabel('chart');
            setStatus('已重命名为: ' + newName);
            showToast('重命名成功', 'success');
        };
        const cancelRename = () => {
            if (renameWrap.parentNode) renameWrap.remove();
            nameSpan.style.display = '';
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); confirmRename(); }
            if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
        });
        input.addEventListener('blur', () => { setTimeout(cancelRename, 150); });
    }

    window.fileLists = fileLists;
    window.showToast = showToast;
    window.setStatus = setStatus;
    window.enterMode = enterMode;

    // ===== 左上角彩蛋：连续点击5次弹出清除数据 =====
    (function initEasterEgg() {
        const logo = document.querySelector('.home-logo');
        if (!logo) return;
        let clickCount = 0;
        let lastClickTime = 0;
        const RESET_DELAY = 2000; // 2秒内连续点击才算

        logo.addEventListener('click', () => {
            const now = Date.now();
            if (now - lastClickTime > RESET_DELAY) {
                clickCount = 0;
            }
            lastClickTime = now;
            clickCount++;

            if (clickCount >= 5) {
                clickCount = 0;
                showEasterEggModal();
            }
        });

        function showEasterEggModal() {
            const existing = document.getElementById('easter-egg-modal');
            if (existing) existing.remove();

            const modal = document.createElement('div');
            modal.className = 'easter-egg-modal';
            modal.id = 'easter-egg-modal';
            modal.innerHTML = `
                <div class="easter-egg-overlay"></div>
                <div class="easter-egg-dialog">
                    <div class="easter-egg-title">⚙️ 开发者选项</div>
                    <div class="easter-egg-body">
                        <p style="color:var(--text-secondary);font-size:13px;margin:0 0 12px 0;">连续点击 5 次触发的隐藏菜单</p>
                        <button class="easter-egg-danger-btn" id="egg-clear-data">🗑️ 清除所有数据</button>
                    </div>
                    <button class="easter-egg-close" id="egg-close">✕</button>
                </div>
            `;
            document.body.appendChild(modal);

            const close = () => modal.remove();
            modal.querySelector('#egg-close').addEventListener('click', close);
            modal.querySelector('.easter-egg-overlay').addEventListener('click', close);

            modal.querySelector('#egg-clear-data').addEventListener('click', () => {
                if (confirm('⚠️ 确定要清除所有本地数据吗？\n这将删除所有保存的设置、快捷项和文件列表。\n此操作不可恢复！')) {
                    localStorage.clear();
                    window.location.reload();
                }
            });
        }
    })();

    console.log('\uD83C\uDFB5 Project Muse Editor loaded');
});