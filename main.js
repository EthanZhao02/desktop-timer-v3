// Desktop Timer + Pet (Electron)
// Main process: manages main window, pet window, tray, and alarms
// 屏蔽 EPIPE broken pipe 无害弹窗
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') return; });
process.stderr.on('error', (e) => { if (e.code === 'EPIPE') return; });

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, Notification, powerSaveBlocker, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { fileURLToPath } = require('url');
const {
  DEFAULT_DATA,
  clampWindowPosition,
  collectDueAlarms,
  normalizeImportedData,
  readJsonWithBackup,
  validateRingtone,
  writeJsonAtomic,
} = require('./timer-core');

// 安全日志：打包后无控制台，避免 EPIPE 崩溃
function safeLog(...args) {
  try {
    if (process.stdout && process.stdout.isTTY) {
      console.log(...args);
    }
  } catch (_) {}
}
function safeError(...args) {
  try {
    if (process.stderr && process.stderr.isTTY) {
      console.error(...args);
    }
  } catch (_) {}
}

// 单实例锁 - 避免多开时出现多个黑窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  safeLog('[main] Another instance is running, quitting...');
  app.quit();
  return;
}

app.on('second-instance', () => {
  if (app.isReady()) showMainWindow();
  else app.whenReady().then(showMainWindow);
});

app.setName('DesktopTimer');

const USER_DATA = app.getPath('userData');
const DATA_FILE = path.join(USER_DATA, 'timer-data.json');

const defaultData = DEFAULT_DATA;

let data = { ...defaultData };
let mainWindow = null;
let petWindow = null;
let tray = null;
let alarmCheckInterval = null;
let previousAlarmCheck = new Date();
let isQuitting = false;
let keepAliveId = null;
const startupNotices = [];

function addStartupNotice(type, message) {
  const notice = { type, message };
  startupNotices.push(notice);
  broadcast('app-warning', notice);
}

function loadData() {
  try {
    const result = readJsonWithBackup(DATA_FILE);
    if (result.value) {
      const saved = result.value;
      if (result.restoredFromBackup) {
        addStartupNotice('data-restored', '数据文件损坏，已从备份恢复。');
        safeError('Primary data file was invalid; restored the backup.');
      }
      data = {
        ...defaultData,
        ...saved,
        settings: {
          ...defaultData.settings,
          ...(saved.settings || {})
        },
        lastFired: saved.lastFired || {}
      };
      const originalRingtone = data.customRingtone;
      if (originalRingtone) {
        data.customRingtone = normalizeCustomRingtone(originalRingtone, data.customRingtoneName);
      }
      if (originalRingtone && originalRingtone !== data.customRingtone) {
        if (data.customRingtone) {
          addStartupNotice('ringtone-migrated', '自定义铃声已迁移为本地文件，数据文件更轻了。');
        } else {
          data.customRingtoneName = '';
          addStartupNotice('ringtone-removed', '自定义铃声路径无效，已恢复为默认铃声。');
        }
        saveData();
      }
    }
  } catch (e) {
    addStartupNotice('data-load-failed', '数据文件读取失败，已使用默认数据。');
    safeError('loadData error:', e);
  }
}

function saveData() {
  try {
    writeJsonAtomic(DATA_FILE, data);
  } catch (e) {
    safeError('saveData error:', e);
  }
}

loadData();

let autoStartEnabled = data.settings.autoStartEnabled !== false;
let keepAliveEnabled = data.settings.keepAliveEnabled !== false;
const PET_WINDOW_WIDTH = 280;
const PET_WINDOW_HEIGHT = 340;
function getDefaultRingtoneSrc() {
  return 'file:///' + path.join(__dirname, 'assets', 'default-ringtone.wav').replace(/\\/g, '/');
}

function fileUrlFromPath(filePath) {
  return 'file:///' + filePath.replace(/\\/g, '/');
}

function saveRingtoneDataUrl(src, name) {
  const safeSrc = validateRingtone(src);
  if (!safeSrc || !safeSrc.startsWith('data:')) return safeSrc;

  const mime = safeSrc.slice(5, safeSrc.indexOf(';')).toLowerCase();
  const extension = mime.includes('mpeg') || /\.mp3$/i.test(name || '') ? 'mp3' : 'wav';
  const directory = path.join(USER_DATA, 'ringtones');
  const filePath = path.join(directory, `custom-ringtone.${extension}`);
  const payload = safeSrc.slice(safeSrc.indexOf(',') + 1);

  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(payload, 'base64'));
  return fileUrlFromPath(filePath);
}

function isStoredRingtoneFileUrl(src) {
  try {
    const filePath = fileURLToPath(src);
    const ringtoneDirectory = path.join(USER_DATA, 'ringtones');
    const relative = path.relative(ringtoneDirectory, filePath);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) && /\.(wav|mp3)$/i.test(filePath);
  } catch {
    return false;
  }
}

function normalizeCustomRingtone(src, name) {
  const safeSrc = validateRingtone(src);
  if (!safeSrc) return null;
  if (safeSrc.startsWith('data:')) return saveRingtoneDataUrl(safeSrc, name);
  return isStoredRingtoneFileUrl(safeSrc) ? safeSrc : null;
}

function getLoginItemPath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');
}

function persistSettings() {
  data.settings = {
    autoStartEnabled,
    keepAliveEnabled
  };
  saveData();
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send(channel, payload);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 800,
    minWidth: 380,
    minHeight: 600,
    title: '智域计时',
    x: Math.floor((screen.getPrimaryDisplay().workAreaSize.width - 440) / 2),
    y: 60,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#e0e5ec',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  mainWindow.loadFile('index.html');
  
  // 多重保险：ready-to-show + did-finish-load fallback
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      safeLog('[main] main window shown (ready-to-show)');
    }
  });
  
  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      safeLog('[main] main window shown (did-finish-load fallback)');
    }
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createPetWindow() {
  const display = screen.getPrimaryDisplay();
  const sw = display.workAreaSize.width;
  const sh = display.workAreaSize.height;
  safeLog('[main] createPetWindow called, screen=' + sw + 'x' + sh);

  petWindow = new BrowserWindow({
    width: PET_WINDOW_WIDTH,
    height: PET_WINDOW_HEIGHT,
    minWidth: PET_WINDOW_WIDTH,
    maxWidth: PET_WINDOW_WIDTH,
    minHeight: PET_WINDOW_HEIGHT,
    maxHeight: PET_WINDOW_HEIGHT,
    x: sw - PET_WINDOW_WIDTH - 20,
    y: sh - PET_WINDOW_HEIGHT - 20,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    title: 'Desktop Pet',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  petWindow.loadFile('pet.html');
  petWindow.on('will-resize', (event) => { event.preventDefault(); });
  petWindow.once('ready-to-show', () => {
    petWindow.show();
    petWindow.setSize(PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT, false);
    safeLog('[main] pet window shown');
  });
  petWindow.webContents.on('did-fail-load', (e, code, desc) => {
    safeError('[main] pet window load failed:', code, desc);
  });

  petWindow.on('maximize', () => petWindow.unmaximize());

  petWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      petWindow.hide();
    }
  });
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '打开计时器', click: () => showMainWindow() },
    { label: '新建闹钟', click: () => {
        showMainWindow();
        if (mainWindow) mainWindow.webContents.send('switch-tab', 'alarm');
      }
    },
    { label: '显示/隐藏宠物', click: () => togglePetWindow() },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: autoStartEnabled,
      click: () => {
        autoStartEnabled = !autoStartEnabled;
        persistSettings();
        applyAutoStart();
        if (tray) tray.setContextMenu(buildTrayMenu());
        broadcast('settings-updated', data.settings);
      }
    },
    {
      label: '熄屏保活',
      type: 'checkbox',
      checked: keepAliveEnabled,
      click: () => {
        keepAliveEnabled = !keepAliveEnabled;
        persistSettings();
        applyKeepAlive();
        if (tray) tray.setContextMenu(buildTrayMenu());
        broadcast('settings-updated', data.settings);
      }
    },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } }
  ]);
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let iconImage;
  try {
    iconImage = nativeImage.createFromPath(iconPath);
    if (iconImage.isEmpty()) {
      iconImage = nativeImage.createEmpty();
    }
  } catch {
    iconImage = nativeImage.createEmpty();
  }

  tray = new Tray(iconImage);
  tray.setToolTip('Desktop Timer + Pet');
  tray.setContextMenu(buildTrayMenu());

  tray.on('click', () => showMainWindow());
}

function showMainWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createMainWindow();
  }
}

function togglePetWindow() {
  if (petWindow) {
    if (petWindow.isVisible()) petWindow.hide();
    else petWindow.show();
  } else {
    createPetWindow();
  }
}

function startAlarmChecker() {
  if (alarmCheckInterval) clearInterval(alarmCheckInterval);

  const checkOnce = () => {
    try {
      const now = new Date();
      const result = collectDueAlarms(data.alarms, data.lastFired, previousAlarmCheck, now);
      previousAlarmCheck = now;
      data.alarms = result.alarms;
      data.lastFired = result.lastFired;
      for (const alarm of result.due) triggerAlarm(alarm);
      if (result.due.length > 0) {
        saveData();
        broadcast('alarms-updated', data.alarms);
      }
    } catch (e) {
      safeError('Alarm check error:', e);
    }
  };

  checkOnce();
  alarmCheckInterval = setInterval(checkOnce, 1000 * 5);
}

function triggerAlarm(alarm) {
  if (Notification.isSupported()) {
    new Notification({
      title: '闹钟提醒',
      body: alarm.label || alarm.time,
      urgency: 'critical',
    }).show();
  }

  const src = data.customRingtone || getDefaultRingtoneSrc();

  broadcast('play-ringtone', src);
  broadcast('alarm-triggered', alarm);

  showMainWindow();
}

ipcMain.handle('get-alarms', () => data.alarms || []);
ipcMain.handle('set-alarms', (e, alarms) => {
  data.alarms = Array.isArray(alarms) ? alarms : [];
  saveData();
  broadcast('alarms-updated', data.alarms);
  return true;
});
ipcMain.handle('get-laps', () => data.laps || []);
ipcMain.handle('set-laps', (e, laps) => {
  data.laps = Array.isArray(laps) ? laps : [];
  saveData();
  return true;
});
ipcMain.handle('get-countdown', () => data.countdown || null);
ipcMain.handle('set-countdown', (e, countdown) => {
  data.countdown = countdown || null;
  saveData();
  return true;
});
ipcMain.handle('get-stopwatch', () => data.stopwatch || null);
ipcMain.handle('set-stopwatch', (e, stopwatch) => {
  data.stopwatch = stopwatch || null;
  saveData();
  return true;
});
ipcMain.handle('get-ringtone', () => ({
  src: data.customRingtone || null,
  name: data.customRingtoneName || ''
}));
ipcMain.handle('set-ringtone', (e, ringtoneData) => {
  if (ringtoneData && typeof ringtoneData === 'object') {
    const normalized = normalizeCustomRingtone(ringtoneData.src, ringtoneData.name);
    data.customRingtone = normalized;
    data.customRingtoneName = normalized ? (ringtoneData.name || '') : '';
  } else {
    data.customRingtone = normalizeCustomRingtone(ringtoneData);
    data.customRingtoneName = '';
  }
  saveData();
  return true;
});
ipcMain.handle('get-default-ringtone-path', () => getDefaultRingtoneSrc());
ipcMain.handle('get-startup-notices', () => startupNotices.slice());
ipcMain.handle('get-settings', () => ({
  autoStartEnabled,
  keepAliveEnabled,
  userDataPath: USER_DATA,
  dataFile: DATA_FILE
}));
ipcMain.handle('set-settings', (e, settings) => {
  if (settings && Object.prototype.hasOwnProperty.call(settings, 'autoStartEnabled')) {
    autoStartEnabled = !!settings.autoStartEnabled;
    applyAutoStart();
  }
  if (settings && Object.prototype.hasOwnProperty.call(settings, 'keepAliveEnabled')) {
    keepAliveEnabled = !!settings.keepAliveEnabled;
    applyKeepAlive();
  }
  persistSettings();
  if (tray) tray.setContextMenu(buildTrayMenu());
  broadcast('settings-updated', data.settings);
  return data.settings;
});
ipcMain.handle('show-notification', (e, payload) => {
  if (Notification.isSupported()) {
    new Notification({
      title: payload && payload.title ? payload.title : '智域计时',
      body: payload && payload.body ? payload.body : ''
    }).show();
  }
  return true;
});
ipcMain.handle('hide-pet', () => { if (petWindow) petWindow.hide(); });
ipcMain.handle('show-main', () => showMainWindow());
ipcMain.handle('set-window-pos', (e, x, y) => { if (petWindow) petWindow.setPosition(x, y); return true; });
ipcMain.handle('minimize-to-pet', () => {
  // 收纳到宠物：隐藏主窗口 + 确保宠物窗口可见
  if (mainWindow) mainWindow.hide();
  if (petWindow) {
    if (!petWindow.isVisible()) petWindow.show();
  } else {
    createPetWindow();
  }
  return true;
});
ipcMain.handle('quit-app', () => { isQuitting = true; app.quit(); });
// ==================== 主题同步 ====================
ipcMain.handle('set-theme', (e, theme) => {
  broadcast('theme-changed', theme);
  return true;
});

// ==================== 数据导出 ====================
ipcMain.handle('export-data', async () => {
  try {
    const result = await dialog.showSaveDialog({
      title: '导出智域计时数据',
      defaultPath: '智域计时数据.json',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { success: false };
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true, path: result.filePath };
  } catch (e) {
    safeError('export-data error:', e);
    return { success: false, error: e.message };
  }
});

// ==================== 数据导入 ====================
ipcMain.handle('import-data', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: '导入智域计时数据',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { success: false };
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    const imported = normalizeImportedData(JSON.parse(raw));
    if (imported.customRingtone) {
      imported.customRingtone = normalizeCustomRingtone(imported.customRingtone, imported.customRingtoneName);
      if (!imported.customRingtone) imported.customRingtoneName = '';
    }
    data = imported;
    autoStartEnabled = imported.settings.autoStartEnabled;
    keepAliveEnabled = imported.settings.keepAliveEnabled;
    applyAutoStart();
    applyKeepAlive();
    saveData();
    broadcast('alarms-updated', data.alarms);
    broadcast('settings-updated', data.settings);
    if (tray) tray.setContextMenu(buildTrayMenu());
    return { success: true };
  } catch (e) {
    safeError('import-data error:', e);
    return { success: false, error: e.message };
  }
});

// ==================== AI 对话（多模型支持）====================
// 模型配置 - 可从配置文件加载
const MODEL_CONFIGS = {
  qclaw: {
    name: '星野',
    url: 'http://localhost:53717/v1/chat/completions',
    token: '9c19b79f500b5bce8054199a05bb2b7b9dc8b37193e1b751',
    model: 'openclaw/main',
    maxTokens: 300
  },
  deepseek: {
    name: 'DeepSeek',
    url: 'https://api.deepseek.com/v1/chat/completions',
    token: process.env.DEEPSEEK_API_KEY || '',
    model: 'deepseek-chat',
    maxTokens: 500
  },
  volcano: {
    name: '火山引擎',
    url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    token: process.env.VOLCANO_API_KEY || '',
    model: 'doubao-pro-32k',
    maxTokens: 500
  }
};

// 从配置文件加载模型配置（如果存在）
const MODEL_CONFIG_PATH = path.join(USER_DATA, 'model-config.json');
try {
  if (fs.existsSync(MODEL_CONFIG_PATH)) {
    const customConfig = JSON.parse(fs.readFileSync(MODEL_CONFIG_PATH, 'utf-8'));
    Object.assign(MODEL_CONFIGS, customConfig);
    safeLog('[main] 已加载自定义模型配置');
  }
} catch (e) {
  safeError('[main] 加载模型配置失败:', e.message);
}

// 暴露模型配置给前端（隐藏敏感 token）
ipcMain.handle('get-model-configs', () => {
  return Object.fromEntries(
    Object.entries(MODEL_CONFIGS).map(([k, v]) => [k, { name: v.name, model: v.model }])
  );
});

// 发送消息
ipcMain.handle('send-chat-message', async (e, message, modelId = 'qclaw') => {
  const config = MODEL_CONFIGS[modelId] || MODEL_CONFIGS.qclaw;

  // 检查 API Key
  if (!config.token && modelId !== 'qclaw') {
    return { success: false, error: `${config.name} 需要配置 API Key` };
  }

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: String(message) }],
        max_tokens: config.maxTokens
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'unknown');
      safeError(`[main] ${config.name} API error:`, response.status, errText);
      if (response.status === 401) {
        return { success: false, error: `${config.name} API Key 无效` };
      }
      return { success: false, error: `请求失败 (${response.status})` };
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '(无回复)';
    safeLog(`[main] ${config.name} 回复:`, reply.substring(0, 50));
    return { success: true, reply };
  } catch (err) {
    safeError(`[main] ${config.name} 连接失败:`, err.message);
    if (modelId === 'qclaw') {
      return { success: false, error: 'QClaw 未运行，请先启动星野助手' };
    }
    return { success: false, error: `${config.name} 连接失败，请检查网络` };
  }
});

function applyAutoStart() {
  try {
    const loginArgs = app.isPackaged ? [] : [__dirname];
    app.setLoginItemSettings({
      openAtLogin: autoStartEnabled,
      path: getLoginItemPath(),
      args: loginArgs
    });
    safeLog('[main] auto-start set to ' + autoStartEnabled);
  } catch (e) {
    addStartupNotice('auto-start-failed', '开机自启设置失败：' + e.message);
    safeError('[main] setLoginItemSettings failed:', e);
  }
}

function applyKeepAlive() {
  try {
    if (keepAliveEnabled) {
      if (keepAliveId === null || !powerSaveBlocker.isStarted(keepAliveId)) {
        if (keepAliveId !== null) {
          try { powerSaveBlocker.stop(keepAliveId); } catch (_) {}
        }
        keepAliveId = powerSaveBlocker.start('prevent-app-suspension');
        safeLog('[main] powerSaveBlocker started id=' + keepAliveId);
      }
    } else {
      if (keepAliveId !== null) {
        try { powerSaveBlocker.stop(keepAliveId); } catch (_) {}
        keepAliveId = null;
        safeLog('[main] powerSaveBlocker stopped');
      }
    }
  } catch (e) {
    safeError('[main] powerSaveBlocker failed:', e);
  }
}

// ==================== 活动窗口 & 空闲检测 ====================
let windowStateScriptPath = null;
let lastWindowState = '';
let windowStateInterval = null;
let isScreenLocked = false;

function setupWindowStateMonitor() {
  // PowerShell 脚本：获取前台窗口标题、进程名、空闲时间
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Monitor {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
}
"@
$hwnd = [Win32Monitor]::GetForegroundWindow()
$pid1 = [uint32]0
[Win32Monitor]::GetWindowThreadProcessId($hwnd, [ref]$pid1) | Out-Null
$p = Get-Process -Id $pid1 -ErrorAction SilentlyContinue
$title = if ($p -and $p.MainWindowTitle) { $p.MainWindowTitle } else { '' }
$pname = if ($p) { $p.ProcessName } else { 'unknown' }
$lii = New-Object Win32Monitor+LASTINPUTINFO
$lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
[Win32Monitor]::GetLastInputInfo([ref]$lii) | Out-Null
$idleMs = [Environment]::TickCount - [int]$lii.dwTime
if ($idleMs -lt 0) { $idleMs = 0 }
Write-Output "$pname|$title|$idleMs"
`.trim();

  try {
    windowStateScriptPath = path.join(os.tmpdir(), 'zhiyu-window-state.ps1');
    fs.writeFileSync(windowStateScriptPath, psScript, 'utf-8');
    safeLog('[main] Window state script written to ' + windowStateScriptPath);
  } catch (e) {
    safeError('[main] Failed to write window state script:', e);
    return;
  }

  function pollWindowState() {
    if (!windowStateScriptPath) return;
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', windowStateScriptPath
    ], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return;
      const line = stdout.trim();
      if (line === lastWindowState) return; // 无变化，跳过
      lastWindowState = line;

      const parts = line.split('|');
      const state = {
        process: (parts[0] || 'unknown').toLowerCase(),
        title: parts[1] || '',
        idleMs: parseInt(parts[2]) || 0,
        locked: isScreenLocked
      };

      // 推送到宠物窗口
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('window-state', state);
      }
    });
  }

  // 每5秒检测一次
  windowStateInterval = setInterval(pollWindowState, 5000);
  // 立即执行一次
  setTimeout(pollWindowState, 2000);
  safeLog('[main] Window state monitor started (5s interval)');
}

// 锁屏检测（Windows session lock/unlock）
function setupLockDetection() {
  try {
    const { powerMonitor, Notification } = require('electron');
    let lockTime = null; // 记录锁屏时间（算睡眠时长）

    powerMonitor.on('lock-screen', () => {
      isScreenLocked = true;
      lockTime = Date.now();
      safeLog('[main] Screen locked');

      // 系统 Toast 通知
      try {
        new Notification({
          title: '🌙 主人晚安~',
          body: 'Zzz... 我先睡一会儿',
          silent: true,
          timeoutType: 'default'
        }).show();
      } catch (e) { safeError('[main] Lock notification error:', e); }

      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('window-state', {
          process: 'lockscreen', title: '', idleMs: 0, locked: true
        });
        petWindow.webContents.send('lock-event', { type: 'locked', time: lockTime });
      }
    });

    powerMonitor.on('unlock-screen', () => {
      isScreenLocked = false;
      safeLog('[main] Screen unlocked');
      lastWindowState = ''; // 强制下次轮询更新

      // 计算睡眠时长，弹解锁通知
      try {
        let sleepStr = '';
        if (lockTime) {
          const sleepMs = Date.now() - lockTime;
          const sleepMin = Math.round(sleepMs / 60000);
          if (sleepMin >= 60) {
            const h = Math.floor(sleepMin / 60);
            const m = sleepMin % 60;
            sleepStr = `我刚睡了 ${h} 小时${m > 0 ? m + ' 分钟' : ''}~`;
          } else if (sleepMin >= 2) {
            sleepStr = `我刚睡了 ${sleepMin} 分钟~`;
          } else if (sleepMin >= 1) {
            sleepStr = '刚打了个盹~';
          }
        }
        new Notification({
          title: '☀️ 主人回来啦',
          body: sleepStr || '欢迎回来~',
          silent: true,
          timeoutType: 'default'
        }).show();
      } catch (e) { safeError('[main] Unlock notification error:', e); }

      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('window-state', { process: '', title: '', idleMs: 0, locked: false });
        petWindow.webContents.send('lock-event', { type: 'unlocked', time: lockTime });
      }
      lockTime = null;
    });
    safeLog('[main] Lock screen detection registered');
  } catch (e) {
    safeError('[main] powerMonitor lock detection failed:', e);
  }
}

app.whenReady().then(() => {
  applyAutoStart();
  applyKeepAlive();
  createMainWindow();
  createPetWindow();
  createTray();
  startAlarmChecker();
  setupWindowStateMonitor();
  setupLockDetection();

  // 全局快捷键 Ctrl+Shift+T 呼出主窗口
  try {
    globalShortcut.register('CommandOrControl+Shift+T', () => {
      showMainWindow();
    });
    safeLog('[main] Global shortcut Ctrl+Shift+T registered');
  } catch (e) {
    safeError('[main] Global shortcut registration failed:', e);
  }
});

app.on('window-all-closed', (e) => {
  if (!isQuitting) e.preventDefault();
});

app.on('before-quit', () => { isQuitting = true; });

// ==================== API Key 管理 ====================
const apiKeysPath = path.join(app.getPath('userData'), 'api-keys.json');

// 加载 API Keys
function loadApiKeys() {
  try {
    if (fs.existsSync(apiKeysPath)) {
      const data = fs.readFileSync(apiKeysPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    safeError('[main] 加载 API Keys 失败:', e);
  }
  return {};
}

// 保存 API Keys
function saveApiKeys(keys) {
  try {
    fs.writeFileSync(apiKeysPath, JSON.stringify(keys, null, 2), 'utf-8');
    safeLog('[main] API Keys 已保存');
    return true;
  } catch (e) {
    safeError('[main] 保存 API Keys 失败:', e);
    return false;
  }
}

// IPC 处理
ipcMain.handle('get-api-keys', () => {
  return loadApiKeys();
});

ipcMain.handle('save-api-keys', (event, keys) => {
  return saveApiKeys(keys);
});

// 获取模型配置（前端用于检查 API Key 是否存在）
ipcMain.handle('get-model-configs', () => {
  const keys = loadApiKeys();
  return {
    deepseek: keys.deepseek ? { apiKey: keys.deepseek } : null,
    volcano: keys.volcano ? { apiKey: keys.volcano } : null,
    qclaw: { apiKey: null } // 星野本地模型，不需要配置
  };
});


// �����ʾ/����ʱͻ�����ﴰ�ڣ�ȷ���ɿ���
ipcMain.on('pet-panel-visible', (event, visible) => {
  if (petWindow && !petWindow.isDestroyed()) {
    if (visible) {
      petWindow.setAlwaysOnTop(true, 'screen-saver');
      petWindow.focus();
    } else {
      petWindow.setAlwaysOnTop(true, 'normal');
    }
  }
});

