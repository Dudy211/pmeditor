/**
 * editor.js — 编辑器入口模块
 * 加载并整合各子模块
 */

// ===== 控制台日志捕获 =====
const ConsoleLogger = {
    logs: [],
    maxLines: 1000,
    listeners: [],
    startTime: performance.now(),

    init() {
        const methods = ['log', 'warn', 'error', 'info', 'debug'];
        methods.forEach(method => {
            const orig = console[method];
            console[method] = (...args) => {
                orig.apply(console, args);
                this.push({
                    type: method,
                    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
                    timestamp: performance.now() - this.startTime,
                    message: args.map(a => this.stringify(a)).join(' '),
                    stack: this.getCallerInfo()
                });
            };
        });

        // 捕获未处理异常
        window.addEventListener('error', (e) => {
            this.push({
                type: 'error',
                time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
                timestamp: performance.now() - this.startTime,
                message: `[Uncaught Error] ${e.message}\n  at ${e.filename}:${e.lineno}:${e.colno}`,
                stack: `${e.filename}:${e.lineno}`
            });
        });

        window.addEventListener('unhandledrejection', (e) => {
            this.push({
                type: 'error',
                time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
                timestamp: performance.now() - this.startTime,
                message: `[Unhandled Promise] ${this.stringify(e.reason)}`,
                stack: this.getCallerInfo()
            });
        });

        // 捕获资源加载错误
        window.addEventListener('error', (e) => {
            if (e.target && (e.target.tagName === 'IMG' || e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK')) {
                this.push({
                    type: 'error',
                    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
                    timestamp: performance.now() - this.startTime,
                    message: `[Resource Error] Failed to load ${e.target.tagName}: ${e.target.src || e.target.href}`,
                    stack: '-'
                });
            }
        }, true);

        // 记录页面生命周期
        document.addEventListener('DOMContentLoaded', () => {
            this.push({
                type: 'info',
                time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
                timestamp: performance.now() - this.startTime,
                message: `[Lifecycle] DOMContentLoaded`,
                stack: '-'
            });
        });

        window.addEventListener('load', () => {
            this.push({
                type: 'info',
                time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
                timestamp: performance.now() - this.startTime,
                message: `[Lifecycle] Window loaded`,
                stack: '-'
            });
        });

        // 记录全屏变化
        document.addEventListener('fullscreenchange', () => {
            this.push({
                type: 'info',
                time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
                timestamp: performance.now() - this.startTime,
                message: `[Fullscreen] ${document.fullscreenElement ? 'entered' : 'exited'}`,
                stack: '-'
            });
        });

        // 记录网络请求（fetch）
        const origFetch = window.fetch;
        window.fetch = async (...args) => {
            const start = performance.now();
            const url = args[0];
            this.push({
                type: 'debug',
                time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
                timestamp: performance.now() - this.startTime,
                message: `[Network] Fetch start: ${url}`,
                stack: this.getCallerInfo()
            });
            try {
                const res = await origFetch.apply(window, args);
                const elapsed = (performance.now() - start).toFixed(1);
                this.push({
                    type: res.ok ? 'debug' : 'warn',
                    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
                    timestamp: performance.now() - this.startTime,
                    message: `[Network] Fetch ${res.ok ? 'OK' : 'FAIL'} ${res.status} (${elapsed}ms): ${url}`,
                    stack: '-'
                });
                return res;
            } catch (err) {
                const elapsed = (performance.now() - start).toFixed(1);
                this.push({
                    type: 'error',
                    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
                    timestamp: performance.now() - this.startTime,
                    message: `[Network] Fetch ERROR (${elapsed}ms): ${url} — ${err.message}`,
                    stack: this.getCallerInfo()
                });
                throw err;
            }
        };

        // 记录 XMLHttpRequest
        const origXHROpen = XMLHttpRequest.prototype.open;
        const origXHRSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this._museUrl = url;
            this._museMethod = method;
            return origXHROpen.call(this, method, url, ...rest);
        };
        XMLHttpRequest.prototype.send = function(...args) {
            const start = performance.now();
            const url = this._museUrl;
            const method = this._museMethod;
            ConsoleLogger.push({
                type: 'debug',
                time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
                timestamp: performance.now() - ConsoleLogger.startTime,
                message: `[Network] XHR ${method} start: ${url}`,
                stack: ConsoleLogger.getCallerInfo()
            });
            this.addEventListener('loadend', () => {
                const elapsed = (performance.now() - start).toFixed(1);
                const ok = this.status >= 200 && this.status < 300;
                ConsoleLogger.push({
                    type: ok ? 'debug' : 'warn',
                    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
                    timestamp: performance.now() - ConsoleLogger.startTime,
                    message: `[Network] XHR ${method} ${this.status} (${elapsed}ms): ${url}`,
                    stack: '-'
                });
            });
            return origXHRSend.apply(this, args);
        };
    },

    getCallerInfo() {
        try {
            const err = new Error();
            const lines = err.stack.split('\n');
            // 跳过前3行（Error, getCallerInfo, console[method]）
            for (let i = 3; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line && !line.includes('ConsoleLogger') && !line.includes('editor.js')) {
                    const match = line.match(/at\s+(.*?)(?:\s+\((.+?)\))?$/);
                    if (match) {
                        const func = match[1] || 'anonymous';
                        const loc = match[2] || '-';
                        return `${func} @ ${loc}`;
                    }
                }
            }
        } catch (e) {}
        return '-';
    },

    stringify(arg) {
        if (arg === null) return 'null';
        if (arg === undefined) return 'undefined';
        if (typeof arg === 'string') return arg;
        if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
        if (arg instanceof Error) return arg.stack || arg.message;
        if (arg instanceof Date) return arg.toISOString();
        if (arg instanceof HTMLElement) return `<${arg.tagName.toLowerCase()}>`;
        if (Array.isArray(arg)) {
            const items = arg.map(a => this.stringify(a)).join(', ');
            return `[${items.length > 200 ? items.slice(0, 200) + '...' : items}]`;
        }
        if (typeof arg === 'object') {
            try {
                const str = JSON.stringify(arg);
                return str.length > 300 ? str.slice(0, 300) + '...' : str;
            } catch {
                return `[Object ${arg.constructor?.name || 'Object'}]`;
            }
        }
        return String(arg);
    },

    push(entry) {
        this.logs.push(entry);
        if (this.logs.length > this.maxLines) this.logs.shift();
        this.listeners.forEach(fn => fn(entry));
    },

    onLog(fn) {
        this.listeners.push(fn);
        return () => {
            const i = this.listeners.indexOf(fn);
            if (i !== -1) this.listeners.splice(i, 1);
        };
    },

    clear() {
        this.logs = [];
    },

    export() {
        return this.logs.map(e => {
            try {
                const time = (e && e.time) || '--:--:--';
                const ts = (e && typeof e.timestamp === 'number') ? e.timestamp : 0;
                const type = String((e && e.type) || 'log').toUpperCase();
                const msg = (e && e.message) || '';
                const stack = (e && e.stack && e.stack !== '-') ? '\n  → ' + e.stack : '';
                return `[${time} +${ts.toFixed(0)}ms] [${type}] ${msg}${stack}`;
            } catch (err) {
                return '[格式化失败的日志条目]';
            }
        }).join('\n');
    }
};
ConsoleLogger.init();
window.ConsoleLogger = ConsoleLogger;

// 各子模块通过 <script> 标签在 index.html 中预先加载
// 本文件作为入口，在 DOM 就绪后初始化

document.addEventListener('DOMContentLoaded', () => {
    console.log('🎹 Editor modules loaded');
});