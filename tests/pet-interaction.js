// ==================== 宠物交互自动化测试（Electron 集成）====================
// 运行：npm run test:pet
// 覆盖：交互区域椭圆判定 / 状态切换去重 / 气泡去重 / 单击打开主窗口 /
//      拖动移动窗口 / 双击打开聊天 / 锁屏·解锁事件 / 窗口状态检测。
// 任一断言失败：打印差异并最终以非零码退出。
const { app, BrowserWindow } = require('electron');
const path = require('path');
const assert = require('assert');

let win = null;
let passed = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failures.push(name + (detail ? ' :: ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' :: ' + detail : '')); }
}

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

async function evalJs(code) {
  return win.webContents.executeJavaScript(code, true);
}

// 页面上下文注入：合成指针事件 + 指针捕获 no-op（合成事件没有活动指针）
async function injectPageHelpers() {
  await evalJs(`
    Element.prototype.setPointerCapture = function(){};
    Element.prototype.hasPointerCapture = function(){ return false; };
    Element.prototype.releasePointerCapture = function(){};
    window.__firePointer = function(type, x, y, sx, sy, targetId) {
      var t = targetId ? document.getElementById(targetId) : document.getElementById('petImage');
      var ev = new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        clientX: x, clientY: y,
        screenX: (sx === undefined ? x : sx), screenY: (sy === undefined ? y : sy),
        button: 0, buttons: (type === 'pointerup' || type === 'pointercancel') ? 0 : 1,
        pointerId: 1, isPrimary: true, pointerType: 'mouse'
      });
      t.dispatchEvent(ev);
    };
    true;
  `);
}

async function petCenter() {
  return evalJs(`(function(){
    var r = document.getElementById('petImage').getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
  })()`);
}

async function singleClick() {
  var c = await petCenter();
  await evalJs('window.__firePointer("pointerdown", ' + c.x + ', ' + c.y + '); window.__firePointer("pointerup", ' + c.x + ', ' + c.y + '); true;');
}

async function doubleClick() {
  var c = await petCenter();
  await evalJs('window.__firePointer("pointerdown", ' + c.x + ', ' + c.y + '); window.__firePointer("pointerup", ' + c.x + ', ' + c.y + '); true;');
  await sleep(80);
  await evalJs('window.__firePointer("pointerdown", ' + c.x + ', ' + c.y + '); window.__firePointer("pointerup", ' + c.x + ', ' + c.y + '); true;');
}

async function dragBy(dx, dy) {
  var c = await petCenter();
  await evalJs('window.__firePointer("pointerdown", ' + c.x + ', ' + c.y + '); true;');
  await sleep(30);
  for (var i = 1; i <= 4; i++) {
    var nx = c.x + Math.round(dx * i / 4);
    var ny = c.y + Math.round(dy * i / 4);
    await evalJs('window.__firePointer("pointermove", ' + nx + ', ' + ny + ', ' + (c.x + dx) + ', ' + (c.y + dy) + '); true;');
    await sleep(20);
  }
  await evalJs('window.__firePointer("pointerup", ' + (c.x + dx) + ', ' + (c.y + dy) + '); true;');
}

async function run() {
  console.log('\n== 宠物交互自动测试 ==\n');

  win = new BrowserWindow({
    show: false,
    width: 360, height: 480,
    webPreferences: {
      preload: path.join(__dirname, 'mock-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  await win.loadFile(path.join(__dirname, '..', 'pet.html'));
  await sleep(1600); // 等待 init 与欢迎气泡
  await injectPageHelpers();

  // ---- 1. 交互区域：椭圆判定（透明四角排除）----
  var rectTest = await evalJs(`(function(){
    var r = document.getElementById('petImage').getBoundingClientRect();
    var cx = r.left + r.width/2, cy = r.top + r.height/2;
    var w = r.width, h = r.height;
    return {
      center: window.__petTest.isInsidePetInteractionArea(cx, cy),
      corner: window.__petTest.isInsidePetInteractionArea(r.left, r.top),
      nearCorner: window.__petTest.isInsidePetInteractionArea(r.left + w*0.10, r.top + h*0.10),
      inner: window.__petTest.isInsidePetInteractionArea(r.left + w*0.30, r.top + h*0.30)
    };
  })()`);
  ok('交互区域：中心点可交互', rectTest.center === true, JSON.stringify(rectTest));
  ok('交互区域：透明四角不误触', rectTest.corner === false, JSON.stringify(rectTest));
  ok('交互区域：近角透明区不误触', rectTest.nearCorner === false, JSON.stringify(rectTest));
  ok('交互区域：主体内部可交互', rectTest.inner === true, JSON.stringify(rectTest));

  // ---- 2. 状态切换去重 ----
  await evalJs('window.__petTest.setPetState("work"); true;');
  await sleep(120);
  var s1 = await evalJs('({ state: window.__petTest.state, pose: window.__petTest.pose })');
  await evalJs('window.__petTest.setPetState("work"); true;');
  await sleep(120);
  var s2 = await evalJs('({ state: window.__petTest.state, pose: window.__petTest.pose })');
  ok('状态去重：切换到 work', s1.state === 'work');
  ok('状态去重：连续同状态不重选姿态', s1.pose === s2.pose, JSON.stringify(s1) + ' -> ' + JSON.stringify(s2));

  // ---- 3. 气泡去重（等待上一个姿态切换的 280ms 过渡完成，避免残留覆盖）----
  await sleep(450);
  await evalJs('window.__petTest.showPoseBubble("测试气泡"); true;');
  await sleep(100);
  var b1 = await evalJs('({ text: window.__petTest.bubbleText, shown: window.__petTest.bubbleShown })');
  await evalJs('window.__petTest.showPoseBubble("测试气泡"); true;');
  await sleep(100);
  var b2 = await evalJs('({ text: window.__petTest.bubbleText, shown: window.__petTest.bubbleShown })');
  ok('气泡去重：同文本保持显示', b1.shown === true && b2.shown === true && b1.text === '测试气泡' && b2.text === '测试气泡', JSON.stringify(b1) + ' / ' + JSON.stringify(b2));
  await evalJs('window.__petTest.showPoseBubble(""); true;');
  await sleep(300);

  // ---- 4. 单击：250ms 后打开主窗口 ----
  var showMainBefore = (await evalJs('window.api.__test.getCalls()')).showMain || 0;
  await singleClick();
  await sleep(500);
  var afterClick = await evalJs('window.api.__test.getCalls()');
  ok('单击打开主窗口', afterClick.showMain === showMainBefore + 1, 'showMain=' + afterClick.showMain);

  // ---- 5. 双击：打开聊天面板 ----
  await doubleClick();
  await sleep(150);
  var chatState = await evalJs('(function(){ var p = document.getElementById("petChatPanel"); return { shown: p ? p.classList.contains("show") : false }; })()');
  ok('双击打开聊天面板', chatState.shown === true, JSON.stringify(chatState));
  // 关闭聊天面板并复位外部活动状态
  await evalJs('window.api.__test.emit("petActivity", { state: "idle", source: "test" }); true;');
  await sleep(150);

  // ---- 6. 拖动：移动窗口（setWindowPos 被调用，且不触发单击）----
  var posBefore = (await evalJs('window.api.__test.getCalls()')).setWindowPos.length || 0;
  var showMainBeforeDrag = (await evalJs('window.api.__test.getCalls()')).showMain || 0;
  await dragBy(40, 25);
  await sleep(150);
  var afterDrag = await evalJs('window.api.__test.getCalls()');
  ok('拖动调用 setWindowPos', afterDrag.setWindowPos.length > posBefore, 'moves=' + afterDrag.setWindowPos.length);
  ok('拖动不触发单击', afterDrag.showMain === showMainBeforeDrag, 'showMain=' + afterDrag.showMain);
  ok('拖动结束恢复 idle', (await evalJs('window.__petTest.state')) === 'idle');

  // ---- 7. 锁屏 / 解锁（外部活动为 work 时解锁稳定恢复 work）----
  await evalJs('window.api.__test.emit("petActivity", { state: "work", source: "test" }); true;');
  await sleep(150);
  await evalJs('window.api.__test.emit("lockEvent", { type: "locked" }); true;');
  await sleep(300);
  ok('锁屏：宠物进入睡眠', (await evalJs('window.__petTest.state')) === 'sleep');
  await evalJs('window.api.__test.emit("lockEvent", { type: "unlocked", time: ' + (Date.now() - 5 * 60000) + ' }); true;');
  await sleep(120);
  var unlockBubble = await evalJs('window.__petTest.bubbleText');
  ok('解锁：气泡提示主人回来', unlockBubble.indexOf('主人回来啦') !== -1, JSON.stringify(unlockBubble));
  await sleep(350);
  ok('解锁：按外部活动状态恢复', (await evalJs('window.__petTest.state')) === 'work', 'state=' + (await evalJs('window.__petTest.state')));

  // ---- 8. 窗口状态检测（匹配进程 → 对应姿态）----
  // 先复位外部活动状态，否则 handleWindowState 会被 work/music 外部活动拦截
  await evalJs('window.api.__test.emit("petActivity", { state: "idle", source: "test" }); true;');
  await sleep(200);
  await evalJs('window.api.__test.emit("windowState", { process: "lockscreen.exe", idleMs: 0, locked: true }); true;');
  await sleep(300);
  ok('窗口状态：锁屏进程 → 睡眠', (await evalJs('window.__petTest.state')) === 'sleep');
  await evalJs('window.api.__test.emit("windowState", { process: "chrome.exe", idleMs: 0, locked: false }); true;');
  await sleep(650);
  var chromeState = await evalJs('({ state: window.__petTest.state, bubble: window.__petTest.bubbleText })');
  ok('窗口状态：Chrome → 待机+浏览气泡', chromeState.state === 'idle' && chromeState.bubble.indexOf('浏览网页中') !== -1, JSON.stringify(chromeState));
  await evalJs('window.api.__test.emit("windowState", { process: "spotify.exe", idleMs: 0, locked: false }); true;');
  await sleep(650);
  var spotifyState = await evalJs('({ state: window.__petTest.state, bubble: window.__petTest.bubbleText })');
  ok('窗口状态：Spotify → 听歌气泡', spotifyState.state === 'music' && spotifyState.bubble.indexOf('♪') !== -1, JSON.stringify(spotifyState));

  // ---- 汇总 ----
  console.log('\n通过 ' + passed + ' 项，失败 ' + failures.length + ' 项');
  if (failures.length) {
    console.log('失败项：');
    failures.forEach(function (f) { console.log('  - ' + f); });
    app.exit(1);
  } else {
    app.exit(0);
  }
}

app.whenReady().then(run).catch(function (e) {
  console.error('测试执行异常：', e);
  app.exit(2);
});
