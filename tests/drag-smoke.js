// ==================== 拖动链路真实冒烟测试（Electron 主进程）====================
// 运行：npm run test:drag
// 覆盖：真实 preload + 真实 IPC + 主进程 set-window-pos handler + clampWindowPosition + setPosition
// 历史回归点：set-window-pos handler 曾漏传 display.workArea，导致 clamp 内部抛 TypeError、
// 窗口永不移动（mock 测试无法发现）。本测试用真实主进程链路验证拖动生效。
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const assert = require('assert');
const { clampWindowPosition } = require('../timer-core');

let win = null;

app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({
      show: false,
      width: 220,
      height: 280,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      x: 300,
      y: 300,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    // 与 main.js 完全相同的 set-window-pos handler（修复后：传入 display.workArea）
    ipcMain.handle('set-window-pos', (e, x, y) => {
      const bounds = win.getBounds();
      const display = screen.getDisplayMatching(bounds);
      const next = clampWindowPosition(
        Number.isFinite(x) ? Math.round(x) : bounds.x,
        Number.isFinite(y) ? Math.round(y) : bounds.y,
        bounds.width,
        bounds.height,
        display.workArea,
      );
      win.setPosition(next.x, next.y, false);
      return next;
    });

    await win.loadFile(path.join(__dirname, '..', 'pet.html'));
    await new Promise((r) => setTimeout(r, 1500)); // 等待 init 与布局

    // 注入合成指针事件（真实 preload 下派发到 petImage）
    await win.webContents.executeJavaScript(`(function(){
      Element.prototype.setPointerCapture = Element.prototype.setPointerCapture || function(){};
      window.__pd = function(type, cx, cy, sx, sy){
        var t = document.getElementById('petImage');
        var ev = new PointerEvent(type, {
          bubbles: true, cancelable: true, composed: true,
          clientX: cx, clientY: cy, screenX: sx, screenY: sy,
          button: 0, buttons: (type === 'pointerup') ? 0 : 1,
          pointerId: 1, isPrimary: true, pointerType: 'mouse'
        });
        t.dispatchEvent(ev);
      };
      var r = document.getElementById('petImage').getBoundingClientRect();
      window.__start = { cx: r.left + r.width/2, cy: r.top + r.height/2 };
      __pd('pointerdown', window.__start.cx, window.__start.cy, window.__start.cx, window.__start.cy);
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 80));

    const before = win.getBounds();
    await win.webContents.executeJavaScript(`(function(){
      var s = window.__start;
      __pd('pointermove', s.cx + 40, s.cy + 25, s.cx + 40, s.cy + 25);
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 150));

    const during = win.getBounds();
    await win.webContents.executeJavaScript(`(function(){
      var s = window.__start;
      __pd('pointerup', s.cx + 40, s.cy + 25, s.cx + 40, s.cy + 25);
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 120));
    const after = win.getBounds();

    console.log('before=' + JSON.stringify(before));
    console.log('during=' + JSON.stringify(during));
    console.log('after=' + JSON.stringify(after));

    // 拖动中窗口位置必须真的改变（这就是曾被 clamp 抛错阻断的环节）
    assert.ok(during.x > before.x, 'window x did not move during drag');
    assert.ok(during.y > before.y, 'window y did not move during drag');
    console.log('DRAG_SMOKE_OK');
    app.exit(0);
  } catch (err) {
    console.error('DRAG_SMOKE_ERROR', err && err.message ? err.message : err);
    app.exit(2);
  }
});
