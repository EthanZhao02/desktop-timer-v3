// Desktop Timer + Pet (Electron)
// Main process: manages main window, pet window, tray, and alarms
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, Notification, powerSaveBlocker, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
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
let petMouseEventsEnabled = true;

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
  petMouseEventsEnabled = true;

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
  petWindow.once('ready-to-show', () => {
    petWindow.show();
    setPetMouseEventsEnabled(false);
    safeLog('[main] pet window shown');
  });
  petWindow.webContents.on('did-fail-load', (e, code, desc) => {
    safeError('[main] pet window load failed:', code, desc);
  });

  // Transparent windows must never be enlarged by OS snap/maximize gestures.
  // The fixed canvas includes room for bubbles and effects, so clamping stays
  // predictable while dragging near screen edges.
  petWindow.on('maximize', () => petWindow.unmaximize());
  petWindow.on('resize', () => {
    const bounds = petWindow.getBounds();
    if (bounds.width !== PET_WINDOW_WIDTH || bounds.height !== PET_WINDOW_HEIGHT) {
      petWindow.setSize(PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT, false);
    }
  });

  petWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      petWindow.hide();
    }
  });
}

function setPetMouseEventsEnabled(enabled) {
  if (!petWindow || petWindow.isDestroyed()) return;
  const next = enabled === true;
  if (petMouseEventsEnabled === next) return;
  petMouseEventsEnabled = next;
  petWindow.setIgnoreMouseEvents(!next, { forward: true });
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
ipcMain.on('set-pet-mouse-events', (event, enabled) => {
  if (!petWindow || petWindow.isDestroyed() || event.sender !== petWindow.webContents) return;
  setPetMouseEventsEnabled(enabled === true);
});
ipcMain.on('move-pet-to', (event, x, y) => {
  if (!petWindow || petWindow.isDestroyed()) return;
  const targetX = Number(x);
  const targetY = Number(y);
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return;
  const bounds = petWindow.getBounds();
  const target = { x: targetX, y: targetY };
  const display = screen.getDisplayNearestPoint(target);
  const next = clampWindowPosition(target.x, target.y, bounds.width, bounds.height, display.workArea);
  petWindow.setPosition(next.x, next.y, false);
});

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

app.whenReady().then(() => {
  applyAutoStart();
  applyKeepAlive();
  createMainWindow();
  createPetWindow();
  createTray();
  startAlarmChecker();

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
