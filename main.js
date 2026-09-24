// Desktop Timer + Pet (Electron)
// Main process: manages main window, pet window, tray, and alarms
// 屏蔽 EPIPE broken pipe 无害弹窗
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') return; });
process.stderr.on('error', (e) => { if (e.code === 'EPIPE') return; });

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, Notification, powerSaveBlocker, dialog, globalShortcut, shell, session, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { fileURLToPath, pathToFileURL } = require('url');

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
}]);

const {
  DEFAULT_DATA,
  MAX_RINGTONE_BYTES,
  clampWindowPosition,
  collectDueAlarms,
  formatSleepDuration,
  normalizeImportedData,
  readJsonWithBackup,
  validateRingtone,
  writeJsonAtomic,
} = require('./timer-core');

let logFilePath = null;
function appendLog(level, args) {
  if (!logFilePath) return;
  try {
    const line = `${new Date().toISOString()} [${level}] ${args.map((item) => {
      if (item instanceof Error) return item.stack || item.message;
      return typeof item === 'string' ? item : JSON.stringify(item);
    }).join(' ')}\n`;
    fs.appendFileSync(logFilePath, line, 'utf8');
  } catch (_) {}
}

// 安全日志：打包后无控制台，避免 EPIPE 崩溃
function safeLog(...args) {
  appendLog('INFO', args);
  try {
    if (process.stdout && process.stdout.isTTY) {
      console.log(...args);
    }
  } catch (_) {}
}
function safeError(...args) {
  appendLog('ERROR', args);
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

const APP_USER_MODEL_ID = 'cn.ethan.zhiyu-timer';
app.setName('智域计时');
app.setAppUserModelId(APP_USER_MODEL_ID);

const USER_DATA = app.getPath('userData');
const DATA_FILE = path.join(USER_DATA, 'timer-data.json');
logFilePath = path.join(USER_DATA, 'zhiyu-timer.log');
try {
  fs.mkdirSync(USER_DATA, { recursive: true });
  if (fs.existsSync(logFilePath) && fs.statSync(logFilePath).size > 1024 * 1024) {
    if (fs.existsSync(`${logFilePath}.old`)) fs.unlinkSync(`${logFilePath}.old`);
    fs.renameSync(logFilePath, `${logFilePath}.old`);
  }
} catch (_) {}

const defaultData = DEFAULT_DATA;

let data = { ...defaultData };
let mainWindow = null;
let petWindow = null;
let tray = null;
let alarmCheckInterval = null;
let previousAlarmCheck = new Date();
let isQuitting = false;
let keepAliveId = null;
let petActivity = { state: 'idle', source: 'system', restoreState: 'idle' };
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
let petAlwaysOnTop = data.settings.petAlwaysOnTop === true;
// 起床听歌模式：铃声播完后自动打开音乐应用
let musicOnAlarm = data.settings.musicOnAlarm === true;
let musicApp = data.settings.musicApp || 'netease';
let musicAppPath = data.settings.musicAppPath || '';
const PET_WINDOW_WIDTH = 220;
const PET_WINDOW_HEIGHT = 280;
const PET_PANEL_WIDTH = 440;
const PET_PANEL_HEIGHT = 600;
function getDefaultRingtoneSrc() {
  return 'app://local/assets/default-ringtone.wav';
}

function fileUrlFromPath(filePath) {
  return 'file:///' + filePath.replace(/\\/g, '/');
}

function ringtonePlaybackUrl(src) {
  if (!src || typeof src !== 'string') return src;
  if (!isStoredRingtoneFileUrl(src)) return src;
  try {
    return 'app://ringtone/' + encodeURIComponent(path.basename(fileURLToPath(src)));
  } catch {
    return src;
  }
}

function saveRingtoneDataUrl(src, name) {
  const safeSrc = validateRingtone(src);
  if (!safeSrc || !safeSrc.startsWith('data:')) return safeSrc;

  const mime = safeSrc.slice(5, safeSrc.indexOf(';')).toLowerCase();
  const extension = mime.includes('mpeg') || /\.mp3$/i.test(name || '') ? 'mp3' : 'wav';
  const directory = path.join(USER_DATA, 'ringtones');
  const safeName = (name || '铃声').replace(/[\/:*?"<>|]/g, '_').slice(0, 50);
  const filePath = path.join(directory, `${safeName}.${extension}`);
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

// ==================== 起床听歌模式：铃声播完后自动打开音乐应用 ====================
const MUSIC_APP_PRESETS = {
  netease: {
    label: '网易云音乐',
    keywords: ['netease', 'cloudmusic', '网易云'],
    exeNames: ['cloudmusic.exe'],
    paths: [
      'C:\\Program Files (x86)\\Netease\\CloudMusic\\cloudmusic.exe',
      'C:\\Program Files\\Netease\\CloudMusic\\cloudmusic.exe'
    ]
  },
  kugou: {
    label: '酷狗音乐',
    keywords: ['kugou', 'kugoo', '酷狗'],
    exeNames: ['kugou.exe'],
    paths: [
      'C:\\Program Files (x86)\\KuGou\\KGMusic\\KuGou.exe',
      'C:\\Program Files\\KuGou\\KGMusic\\KuGou.exe'
    ]
  },
  qq: {
    label: 'QQ音乐',
    keywords: ['qqmusic', 'qq音乐', 'tencent'],
    exeNames: ['qqmusic.exe'],
    paths: [
      'C:\\Program Files (x86)\\Tencent\\QQMusic\\QQMusic.exe',
      'C:\\Program Files\\Tencent\\QQMusic\\QQMusic.exe'
    ]
  },
  kuwo: {
    label: '酷我音乐',
    keywords: ['kuwo', 'kwmusic', '酷我'],
    exeNames: ['kwmusic.exe', 'kuwo.exe'],
    paths: [
      'C:\\Program Files (x86)\\Kuwo\\KuwoMusic\\KwMusic.exe',
      'C:\\Program Files\\Kuwo\\KuwoMusic\\KwMusic.exe'
    ]
  },
  migu: {
    label: '咪咕音乐',
    keywords: ['migu', '咪咕'],
    exeNames: ['migu.exe', '咪咕音乐.exe'],
    paths: [
      'C:\\Program Files (x86)\\Migu\\MiguMusic\\migu.exe',
      'C:\\Program Files\\Migu\\MiguMusic\\migu.exe'
    ]
  },
  spotify: {
    label: 'Spotify',
    keywords: ['spotify'],
    exeNames: ['spotify.exe'],
    paths: [
      path.join(process.env.APPDATA || '', 'Spotify', 'Spotify.exe')
    ]
  },
  foobar2000: {
    label: 'foobar2000',
    keywords: ['foobar2000', 'foobar'],
    exeNames: ['foobar2000.exe'],
    paths: [
      'C:\\Program Files (x86)\\foobar2000\\foobar2000.exe',
      'C:\\Program Files\\foobar2000\\foobar2000.exe'
    ]
  },
  qishui: {
    label: '汽水音乐',
    keywords: ['soda', 'qishui', '汽水', 'ssmusic', 'douyin_music'],
    exeNames: ['sodamusiclauncher.exe', 'sodamusic.exe', 'qishui.exe', '汽水音乐.exe', 'ssmusic.exe'],
    paths: [],
    macPaths: [
      '/Applications/汽水音乐.app',
      path.join(os.homedir(), 'Applications', '汽水音乐.app')
    ]
  }
};

function scanDirForExe(dir, exeNames, depth) {
  if (depth > 2) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  // 先检查本层文件（优先找到安装根目录下的启动器），再递归子目录
  for (const entry of entries) {
    try {
      if (entry.isFile() && exeNames.includes(entry.name.toLowerCase())) {
        return path.join(dir, entry.name);
      }
    } catch (_) {}
  }
  for (const entry of entries) {
    try {
      if (entry.isDirectory()) {
        const found = scanDirForExe(path.join(dir, entry.name), exeNames, depth + 1);
        if (found) return found;
      }
    } catch (_) {}
  }
  return null;
}

function findMusicAppPath() {
  if (musicApp === 'custom') {
    return musicAppPath && fs.existsSync(musicAppPath) ? musicAppPath : null;
  }
  const preset = MUSIC_APP_PRESETS[musicApp];
  if (!preset) return null;
  if (process.platform === 'darwin') {
    for (const appPath of preset.macPaths || []) {
      if (fs.existsSync(appPath)) return appPath;
    }
    return null;
  }
  if (process.platform !== 'win32') return null;
  for (const p of preset.paths) {
    if (fs.existsSync(p)) return p;
  }
  // 常见安装根目录下按关键词扫描，避免无谓深扫
  const roots = [
    process.env.LOCALAPPDATA,
    path.join(process.env.LOCALAPPDATA || '', 'Programs'),
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)']
  ].filter(Boolean);
  const exeNames = preset.exeNames.map((n) => n.toLowerCase());
  for (const root of roots) {
    let top;
    try {
      top = fs.readdirSync(root, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of top) {
      if (!entry.isDirectory()) continue;
      if (!preset.keywords.some((k) => entry.name.toLowerCase().includes(k))) continue;
      const found = scanDirForExe(path.join(root, entry.name), exeNames, 1);
      if (found) return found;
    }
  }
  return null;
}

function sendMediaPlayPause() {
  if (process.platform !== 'win32') return;
  const script =
    "$sig = '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);'; " +
    'Add-Type -MemberDefinition $sig -Name MediaKey -Namespace Win32 -ErrorAction SilentlyContinue; ' +
    '[Win32.MediaKey]::keybd_event(0xB3, 0, 0, [UIntPtr]::Zero); ' +
    '[Win32.MediaKey]::keybd_event(0xB3, 0, 2, [UIntPtr]::Zero)';
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, (err) => {
    if (err) safeError('[music] send media play/pause key failed:', err);
  });
}

function activateMusicAppWindow(exePath, playAfterActivate) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !exePath) return resolve(false);
    const processName = path.basename(exePath, path.extname(exePath));
    const script = `
$ProcessName = $env:ZHIYU_MUSIC_PROCESS
$Play = $env:ZHIYU_MUSIC_PLAY
$code = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class ZMusicWindow {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
$ids = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$best = [IntPtr]::Zero
$bestArea = 0
[ZMusicWindow]::EnumWindows({
  param($h, $l)
  [uint32]$windowPid = 0
  [ZMusicWindow]::GetWindowThreadProcessId($h, [ref]$windowPid) | Out-Null
  if ($ids -contains [int]$windowPid) {
    $r = New-Object ZMusicWindow+RECT
    [ZMusicWindow]::GetWindowRect($h, [ref]$r) | Out-Null
    $area = [math]::Max(0, $r.Right - $r.Left) * [math]::Max(0, $r.Bottom - $r.Top)
    if ($area -gt $script:bestArea) { $script:bestArea = $area; $script:best = $h }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
if ($best -eq [IntPtr]::Zero) { Write-Output 'NO_WINDOW'; exit 1 }
[ZMusicWindow]::ShowWindow($best, 9) | Out-Null
[ZMusicWindow]::SetWindowPos($best, [IntPtr](-1), 0, 0, 0, 0, 0x0043) | Out-Null
[ZMusicWindow]::SetForegroundWindow($best) | Out-Null
Start-Sleep -Milliseconds 300
[ZMusicWindow]::SetWindowPos($best, [IntPtr](-2), 0, 0, 0, 0, 0x0043) | Out-Null
if ($Play -eq 'true') {
  $w = New-Object -ComObject WScript.Shell
  $w.SendKeys(' ')
}
Write-Output 'OK'
`;
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
    ], {
      timeout: 10000,
      windowsHide: true,
      env: {
        ...process.env,
        ZHIYU_MUSIC_PROCESS: processName,
        ZHIYU_MUSIC_PLAY: playAfterActivate ? 'true' : 'false'
      }
    }, (err, stdout) => {
      const ok = !err && String(stdout || '').trim().endsWith('OK');
      if (!ok) safeError('[music] activate target window failed:', processName, err || stdout);
      resolve(ok);
    });
  });
}

function isExeRunning(exeName) {
  return new Promise((resolve) => {
    execFile('tasklist.exe', ['/FI', 'IMAGENAME eq ' + exeName, '/NH'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(stdout.toLowerCase().includes(exeName.toLowerCase()));
    });
  });
}

function isAnyExeRunning(exeNames) {
  return Promise.all(exeNames.map((n) => isExeRunning(n))).then((results) => results.some(Boolean));
}

function killExe(exeName) {
  return new Promise((resolve) => {
    execFile('taskkill.exe', ['/IM', exeName, '/F'], { windowsHide: true }, () => resolve());
  });
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function launchExeDetached(exePath) {
  const child = execFile(exePath, [], {
    cwd: path.dirname(exePath),
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  if (child) child.on('error', (err) => safeError('[music] launch failed:', err));
  if (child && child.unref) child.unref();
}

// 汽水音乐：进入"听歌模式"页并点击指定场景模式（如"起床"）。
// 汽水音乐是 Lynx 渲染应用，自动化树为空，只能按窗口相对坐标点击。
// 坐标在 1100x720 窗口下校准，因此脚本会先把窗口还原为 1100x720。
const QISHUI_MODE_SCRIPT = `
param([string]$WindowTitle, [string]$ModeName)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing
$code = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class ZUI {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint flags);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public static IntPtr bestVisible;
  public static long bestVisibleArea;
  public static IntPtr bestAny;
  public static long bestAnyArea;
  public static IntPtr FindMainWindow(string needle) {
    bestVisible = IntPtr.Zero; bestVisibleArea = 0;
    bestAny = IntPtr.Zero; bestAnyArea = 0;
    EnumWindows((h, l) => {
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      string t = sb.ToString();
      if (t.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) {
        RECT r; GetWindowRect(h, out r);
        long w = (long)r.Right - r.Left;
        long ht = (long)r.Bottom - r.Top;
        long area = w * ht;
        if (area > bestAnyArea) { bestAnyArea = area; bestAny = h; }
        if (IsWindowVisible(h) && area > bestVisibleArea) { bestVisibleArea = area; bestVisible = h; }
      }
      return true;
    }, IntPtr.Zero);
    // 优先返回可见窗口；主窗口被隐藏（应用后台运行）时退回隐藏窗口，由脚本负责显示
    return bestVisible != IntPtr.Zero ? bestVisible : bestAny;
  }
}
"@
Add-Type -TypeDefinition $code

$h = [IntPtr]::Zero
for ($i = 0; $i -lt 25 -and $h -eq [IntPtr]::Zero; $i++) {
  $h = [ZUI]::FindMainWindow($WindowTitle)
  if ($h -eq [IntPtr]::Zero) { Start-Sleep -Seconds 1 }
}
if ($h -eq [IntPtr]::Zero) { Write-Output 'NO_WINDOW'; exit 1 }

# 窗口隐藏/最小化时（从隐藏恢复的窗口不响应点击），报告重启，由主程序杀掉后重新启动
$r = New-Object ZUI+RECT
[ZUI]::GetWindowRect($h, [ref]$r) | Out-Null
if ((-not [ZUI]::IsWindowVisible($h)) -or ($r.Right - $r.Left) -lt 300 -or ($r.Bottom - $r.Top) -lt 300) {
  Write-Output 'NEED_RESTART'
  exit 1
}

function Bring-Front($hwnd) {
  # Electron/Lynx 窗口可能拒绝普通 SetForegroundWindow；临时置顶后立即取消置顶更可靠。
  [ZUI]::ShowWindow($hwnd, 9) | Out-Null
  [ZUI]::SetWindowPos($hwnd, [IntPtr](-1), 0, 0, 0, 0, 0x0043) | Out-Null
  $fg = [ZUI]::GetForegroundWindow()
  if ($fg -ne $hwnd) {
    $fgThread = [ZUI]::GetWindowThreadProcessId($fg, [ref]([uint32]0))
    $myThread = [ZUI]::GetWindowThreadProcessId($hwnd, [ref]$null)
    [ZUI]::AttachThreadInput($myThread, $fgThread, $true) | Out-Null
    [ZUI]::SetForegroundWindow($hwnd) | Out-Null
    [ZUI]::BringWindowToTop($hwnd) | Out-Null
    [ZUI]::AttachThreadInput($myThread, $fgThread, $false) | Out-Null
  }
  Start-Sleep -Milliseconds 250
  [ZUI]::SetWindowPos($hwnd, [IntPtr](-2), 0, 0, 0, 0, 0x0043) | Out-Null
}
function Click-Rel($rx, $ry) {
  $r = New-Object ZUI+RECT
  [ZUI]::GetWindowRect($h, [ref]$r) | Out-Null
  $x = $r.Left + [int](($r.Right - $r.Left) * $rx)
  $y = $r.Top + [int](($r.Bottom - $r.Top) * $ry)
  [ZUI]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 80
  [ZUI]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [ZUI]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 200
}

# 若窗口处于最大化状态，先还原
if ([ZUI]::IsZoomed($h)) { [ZUI]::ShowWindow($h, 9) | Out-Null; Start-Sleep -Milliseconds 800 }
[ZUI]::MoveWindow($h, 300, 120, 1100, 720, $true) | Out-Null
Start-Sleep -Seconds 1
Bring-Front $h
Start-Sleep -Milliseconds 500

# 0) 先按空格播放当前歌曲（保证有声音，即使场景切换失败也有歌放）
Start-Sleep -Milliseconds 500
$wshell = New-Object -ComObject wscript.shell
$wshell.AppActivate($h) | Out-Null
Start-Sleep -Milliseconds 300
$wshell.SendKeys(' ')
Start-Sleep -Milliseconds 1000

# 1) 左侧导航第二项（听歌模式 / 当前场景模式）
Click-Rel 0.07 0.25
Start-Sleep -Milliseconds 1500

# 2) 根据模式名计算点击坐标（8 个场景卡片，2 行 4 列，实测校准）
$modeX = 0.687
$modeY = 0.236
switch ($ModeName) {
  '熟悉模式' { $modeX = 0.300; $modeY = 0.236; break }
  '新鲜模式' { $modeX = 0.495; $modeY = 0.236; break }
  '起床'     { $modeX = 0.687; $modeY = 0.236; break }
  '洗澡'     { $modeX = 0.881; $modeY = 0.236; break }
  '深夜EMO'  { $modeX = 0.300; $modeY = 0.325; break }
  'DJ模式'   { $modeX = 0.495; $modeY = 0.325; break }
  '助眠模式' { $modeX = 0.687; $modeY = 0.325; break }
  '动感健身' { $modeX = 0.881; $modeY = 0.325; break }
  '图书馆'   { $modeX = 0.881; $modeY = 0.325; break }
  default    { $modeX = 0.687; $modeY = 0.236; break }
}
# 汽水音乐 3.7.0 单击卡片即切换场景并开始播放。
Click-Rel $modeX $modeY
Start-Sleep -Seconds 2

Write-Output 'OK'
`;

let qishuiModeScriptPath = null;

function runQishuiWakeMode(modeName) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ ok: false, code: 'NOT_WINDOWS' });
    try {
      if (!qishuiModeScriptPath) {
        qishuiModeScriptPath = path.join(os.tmpdir(), 'zhiyu-qishui-mode.ps1');
        fs.writeFileSync(qishuiModeScriptPath, '\uFEFF' + QISHUI_MODE_SCRIPT, 'utf-8');
      }
      execFile('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', qishuiModeScriptPath,
        '-WindowTitle', '汽水音乐',
        '-ModeName', modeName || '起床'
      ], { timeout: 80000, windowsHide: true }, (err, stdout) => {
        const text = (stdout || '').trim();
        const code = text.split('\n').pop();
        if (err) {
          // 脚本用非零退出码报告"可恢复"状态（窗口未就绪/需重启），
          // 这些不是真正的失败，必须把信号透传出去，主流程才能重试
          if (code === 'NEED_RESTART' || code === 'NO_WINDOW') {
            return resolve({ ok: false, code });
          }
          safeError('[music] qishui mode script error:', err);
          return resolve({ ok: false, code: 'PS_ERROR' });
        }
        resolve({ ok: code === 'OK', code });
      });
    } catch (e) {
      safeError('[music] runQishuiWakeMode error:', e);
      resolve({ ok: false, code: 'SCRIPT_ERROR' });
    }
  });
}

function isQishuiPath(exePath) {
  if (!exePath) return false;
  const p = exePath.toLowerCase();
  return p.includes('soda') || p.includes('汽水') || p.includes('ssmusic');
}

const QISHUI_CHECK_NAMES = ['sodamusic.exe', 'sodamusiclauncher.exe', 'qishui.exe', 'ssmusic.exe'];

// 汽水音乐：进入"起床"模式。窗口不可用（隐藏/最小化/不存在）时，先结束进程重新启动再试。
async function openQishuiWakeMode(exePath, modeName) {
  // 最多尝试 3 轮：初始 1 次 + 2 次彻底重启（汽水冷启动慢，首轮常因窗口未就绪失败）
  const wakeMode = modeName || '起床';
  let r = await runQishuiWakeMode(wakeMode);
  if (r.ok) return { ok: true, restarted: 0 };
  let restarts = 0;
  while ((r.code === 'NEED_RESTART' || r.code === 'NO_WINDOW') && restarts < 2) {
    restarts += 1;
    safeLog('[music] qishui wake failed (' + r.code + '), restarting round ' + restarts);
    // 关闭现有实例后重新启动，避免"幽灵窗口"（隐藏恢复后不响应点击）
    await Promise.all(QISHUI_CHECK_NAMES.map((n) => killExe(n)));
    await sleepMs(4000);
    launchExeDetached(exePath);
    await sleepMs(15000);
    r = await runQishuiWakeMode(wakeMode);
    if (r.ok) return { ok: true, restarted: restarts };
  }
  return { ok: false, code: r.code };
}

async function openMusicApp(opts) {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return { success: false, reason: 'unsupported-platform' };
  }
  if (!musicOnAlarm) return { success: false, reason: 'disabled' };
  const exePath = findMusicAppPath();
  if (!exePath) return { success: false, reason: 'not-found' };
  if (process.platform === 'darwin') {
    const error = await shell.openPath(exePath);
    if (error) return { success: false, reason: 'launch-failed', error };
    return { success: true, path: exePath, sceneSupported: false, platform: 'darwin' };
  }
  // 汽水音乐（含自定义路径选中的汽水音乐）走"进入起床模式"链路；其他应用走"打开+媒体键"
  const isQishui = musicApp === 'qishui' || (musicApp === 'custom' && isQishuiPath(exePath));
  const preset = MUSIC_APP_PRESETS[musicApp];
  const checkNames = isQishui
    ? QISHUI_CHECK_NAMES
    : (preset && preset.exeNames.length
        ? preset.exeNames.map((n) => n.toLowerCase())
        : [path.basename(exePath).toLowerCase()]);
  try {
    safeLog('[music] opening selected app:', musicApp, exePath);
    if (isQishui) {
      const alreadyRunning = await isAnyExeRunning(checkNames);
      if (!alreadyRunning) launchExeDetached(exePath);
      const wakeMode = (opts && opts.musicMode) ? opts.musicMode : '起床';
      const r = await openQishuiWakeMode(exePath, wakeMode);
      if (r.ok) {
        safeLog('[music] qishui scene selected: ' + wakeMode);
        return { success: true, path: exePath, alreadyRunning, modeSelected: true, sceneSupported: true, restarted: r.restarted };
      }
      // 实在进不了起床模式：退回发送媒体键触发播放
      safeError('[music] qishui scene selection failed:', wakeMode, r.code);
      sendMediaPlayPause();
      return { success: true, path: exePath, alreadyRunning, modeSelected: false, sceneSupported: true, sceneError: r.code };
    }
    const alreadyRunning = await isAnyExeRunning(checkNames);
    if (alreadyRunning) {
      const activated = await activateMusicAppWindow(exePath, !!(opts && opts.forcePlay));
      if (!activated) launchExeDetached(exePath);
      return { success: true, path: exePath, alreadyRunning: true, activated, sceneSupported: false };
    }
    launchExeDetached(exePath);
    // 其他应用：等待窗口创建，恢复可能默认隐藏的主窗口，再向目标窗口发送空格尝试播放。
    setTimeout(() => activateMusicAppWindow(exePath, true), 2500);
    return { success: true, path: exePath, alreadyRunning: false, sceneSupported: false };
  } catch (e) {
    safeError('[music] openMusicApp error:', e);
    return { success: false, reason: 'launch-failed', error: e && e.message };
  }
}

function getLoginItemPath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');
}

function persistSettings() {
  data.settings = {
    autoStartEnabled,
    keepAliveEnabled,
    petAlwaysOnTop,
    musicOnAlarm,
    musicApp,
    musicAppPath
  };
  saveData();
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send(channel, payload);
}

function getBundledAssetPath(fileName) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', fileName);
  }
  return path.join(__dirname, 'assets', fileName);
}

function getWindowIconPath() {
  return getBundledAssetPath(process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}

function setupAppProtocol() {
  protocol.handle('app', (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.hostname === 'ringtone') {
      const fileName = path.basename(decodeURIComponent(requestUrl.pathname).replace(/^[/\\]+/, ''));
      if (!/\.(?:wav|mp3)$/i.test(fileName)) return new Response('Forbidden', { status: 403 });
      const ringtoneRoot = path.resolve(USER_DATA, 'ringtones');
      const ringtonePath = path.resolve(ringtoneRoot, fileName);
      if (!ringtonePath.toLowerCase().startsWith(ringtoneRoot.toLowerCase() + path.sep)) {
        return new Response('Forbidden', { status: 403 });
      }
      return net.fetch(pathToFileURL(ringtonePath).toString());
    }
    if (requestUrl.hostname !== 'local') return new Response('Not found', { status: 404 });
    const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^[/\\]+/, '');
    // 打包后优先从 app.asar.unpacked 读取（mediapipe 等大文件 unpack 后直读更快），
    // 不存在时回退到 asar 内路径。
    if (app.isPackaged) {
      const unpackedPath = path.resolve(process.resourcesPath, 'app.asar.unpacked', relativePath || 'index.html');
      const unpackedRoot = path.resolve(process.resourcesPath, 'app.asar.unpacked');
      const unpackedPrefix = unpackedRoot.toLowerCase() + path.sep;
      if (unpackedPath.toLowerCase().startsWith(unpackedPrefix) && fs.existsSync(unpackedPath)) {
        return net.fetch(pathToFileURL(unpackedPath).toString());
      }
    }
    const appRoot = path.resolve(__dirname);
    const filePath = path.resolve(appRoot, relativePath || 'index.html');
    const rootPrefix = appRoot.toLowerCase() + path.sep;
    if (filePath.toLowerCase() !== appRoot.toLowerCase() && !filePath.toLowerCase().startsWith(rootPrefix)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 800,
    minWidth: 380,
    minHeight: 600,
    title: '智域计时',
    icon: getWindowIconPath(),
    x: Math.floor((screen.getPrimaryDisplay().workAreaSize.width - 440) / 2),
    y: 60,
    backgroundColor: '#e0e5ec',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  mainWindow.loadURL('app://local/index.html');
  
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
    maxWidth: PET_PANEL_WIDTH,
    minHeight: PET_WINDOW_HEIGHT,
    maxHeight: PET_PANEL_HEIGHT,
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
    icon: getWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  petWindow.loadURL('app://local/pet.html');
  petWindow.webContents.on('did-finish-load', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet-activity-changed', petActivity);
    }
  });
  petWindow.once('ready-to-show', () => {
    normalizePetWindowBounds(false);
    petWindow.show();
    petWindow.setSize(PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT, false);
    applyPetAlwaysOnTop();
  });
  petWindow.webContents.on('did-fail-load', (e, code, desc) => {
    safeError('[main] pet window load failed:', code, desc);
  });

  let correctingPetBounds = false;
  const enforcePetWindowBounds = () => {
    if (!petWindow || petWindow.isDestroyed() || correctingPetBounds) return;
    const bounds = petWindow.getBounds();
    const validCompact = bounds.width === PET_WINDOW_WIDTH && bounds.height === PET_WINDOW_HEIGHT;
    const validPanel = bounds.width === PET_PANEL_WIDTH && bounds.height === PET_PANEL_HEIGHT;
    if (validCompact || validPanel) return;

    correctingPetBounds = true;
    safeError(`[main] corrected abnormal pet window bounds: ${bounds.width}x${bounds.height}`);
    normalizePetWindowBounds(false);
    correctingPetBounds = false;
  };

  petWindow.on('resize', enforcePetWindowBounds);
  petWindow.on('maximize', () => {
    petWindow.unmaximize();
    normalizePetWindowBounds(false);
  });
  petWindow.on('enter-full-screen', () => {
    petWindow.setFullScreen(false);
    normalizePetWindowBounds(false);
  });

  petWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      petWindow.hide();
    }
  });
}

function resizePetWindow(panelVisible) {
  if (!petWindow || petWindow.isDestroyed()) return;

  const bounds = petWindow.getBounds();
  const targetWidth = panelVisible ? PET_PANEL_WIDTH : PET_WINDOW_WIDTH;
  const targetHeight = panelVisible ? PET_PANEL_HEIGHT : PET_WINDOW_HEIGHT;
  const display = screen.getDisplayMatching(bounds);
  const workArea = display.workArea;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const x = Math.max(workArea.x, Math.min(right - targetWidth, workArea.x + workArea.width - targetWidth));
  const y = Math.max(workArea.y, Math.min(bottom - targetHeight, workArea.y + workArea.height - targetHeight));

  petWindow.setBounds({ x, y, width: targetWidth, height: targetHeight }, false);
}

// 防止旧版本留下的异常窗口尺寸在升级后继续污染桌面宠物。
// 宠物窗口只允许使用普通尺寸或面板尺寸，其他尺寸一律按当前面板状态复位。
function normalizePetWindowBounds(panelVisible = false) {
  if (!petWindow || petWindow.isDestroyed()) return;

  const bounds = petWindow.getBounds();
  const targetWidth = panelVisible ? PET_PANEL_WIDTH : PET_WINDOW_WIDTH;
  const targetHeight = panelVisible ? PET_PANEL_HEIGHT : PET_WINDOW_HEIGHT;
  const display = screen.getDisplayMatching(bounds);
  const workArea = display.workArea;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const x = Math.max(workArea.x, Math.min(right - targetWidth, workArea.x + workArea.width - targetWidth));
  const y = Math.max(workArea.y, Math.min(bottom - targetHeight, workArea.y + workArea.height - targetHeight));

  if (bounds.width !== targetWidth || bounds.height !== targetHeight || bounds.x !== x || bounds.y !== y) {
    petWindow.setBounds({ x, y, width: targetWidth, height: targetHeight }, false);
  }
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
    {
      label: '宠物窗口置顶',
      type: 'checkbox',
      checked: petAlwaysOnTop,
      click: () => {
        petAlwaysOnTop = !petAlwaysOnTop;
        persistSettings();
        applyPetAlwaysOnTop();
        if (tray) tray.setContextMenu(buildTrayMenu());
        broadcast('settings-updated', data.settings);
      }
    },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } }
  ]);
}

function applyPetAlwaysOnTop() {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.setAlwaysOnTop(petAlwaysOnTop, petAlwaysOnTop ? 'screen-saver' : 'normal');
}

function createTray() {
  const iconPath = getBundledAssetPath('tray-icon.png');
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
    else {
      petWindow.show();
      applyPetAlwaysOnTop();
      petWindow.moveTop();
    }
  } else {
    createPetWindow();
  }
}

function checkDueAlarmsNow() {
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
}

function startAlarmChecker() {
  if (alarmCheckInterval) clearInterval(alarmCheckInterval);
  checkDueAlarmsNow();
  alarmCheckInterval = setInterval(checkDueAlarmsNow, 1000 * 5);
}

function triggerAlarm(alarm) {
  if (Notification.isSupported()) {
    new Notification({
      title: '闹钟提醒',
      body: alarm.label || alarm.time,
      urgency: 'critical',
    }).show();
  }

  let src = ringtonePlaybackUrl(data.customRingtone) || getDefaultRingtoneSrc();
  if (alarm && typeof alarm.ringtone === 'string' && alarm.ringtone) {
    const ringtoneDir = getRingtoneDir();
    const candidate = path.join(ringtoneDir, alarm.ringtone);
    const relative = path.relative(ringtoneDir, candidate);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(candidate)) {
      src = ringtonePlaybackUrl(fileUrlFromPath(candidate));
    }
  }

  broadcast('play-ringtone', {
    src,
    source: 'alarm',
    musicMode: alarm && typeof alarm.musicMode === 'string' ? alarm.musicMode : '',
    alarm: alarm ? {
      id: alarm.id,
      time: alarm.time,
      label: alarm.label,
      requirePhotoVerification: alarm.requirePhotoVerification === true
    } : null
  });
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
ipcMain.handle('get-focus-sessions', () => data.focusSessions || []);
ipcMain.handle('add-focus-session', (e, session) => {
  const duration = Number(session && session.duration);
  const completedAt = Number(session && session.completedAt);
  if (!Number.isFinite(duration) || duration < 60000 || !Number.isFinite(completedAt)) return data.focusSessions || [];
  const sessions = Array.isArray(data.focusSessions) ? data.focusSessions : [];
  sessions.push({ duration: Math.round(duration), completedAt: Math.round(completedAt) });
  data.focusSessions = sessions.slice(-500);
  saveData();
  return data.focusSessions;
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
ipcMain.handle('set-pet-activity', (e, payload) => {
  const allowedStates = new Set(['idle', 'work', 'music', 'celebrate']);
  const requestedState = payload && typeof payload.state === 'string' ? payload.state : 'idle';
  const requestedRestore = payload && typeof payload.restoreState === 'string' ? payload.restoreState : 'idle';
  petActivity = {
    state: allowedStates.has(requestedState) ? requestedState : 'idle',
    source: payload && typeof payload.source === 'string' ? payload.source.slice(0, 32) : 'system',
    restoreState: allowedStates.has(requestedRestore) && requestedRestore !== 'celebrate' ? requestedRestore : 'idle',
    duration: payload && Number.isFinite(Number(payload.duration))
      ? Math.max(1000, Math.min(15000, Number(payload.duration)))
      : undefined,
  };
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet-activity-changed', petActivity);
  }
  return petActivity;
});
ipcMain.handle('get-ringtone', () => ({
  src: ringtonePlaybackUrl(data.customRingtone) || null,
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
// 直接复制本地铃声文件（不走 base64/IPC 大字符串，支持最大 100MB）
ipcMain.handle('set-ringtone-file', (e, payload) => {
  if (!payload || typeof payload.path !== 'string' || !payload.path) {
    return { ok: false, error: 'no-path' };
  }
  const srcPath = payload.path;
  const name = typeof payload.name === 'string' ? payload.name : '';
  try {
    const stat = fs.statSync(srcPath);
    if (!stat.isFile()) return { ok: false, error: 'not-file' };
    if (stat.size > MAX_RINGTONE_BYTES) return { ok: false, error: 'too-large' };
    if (!/\.(wav|mp3)$/i.test(srcPath) && !/\.(wav|mp3)$/i.test(name)) {
      return { ok: false, error: 'bad-format' };
    }
    const extension = /\.mp3$/i.test(srcPath) || /\.mp3$/i.test(name) ? 'mp3' : 'wav';
    const directory = path.join(USER_DATA, 'ringtones');
    fs.mkdirSync(directory, { recursive: true });
    const safeName = (name || '铃声').replace(/[\/:*?"<>|]/g, '_').slice(0, 50);
    const filePath = path.join(directory, `${safeName}.${extension}`);
    fs.copyFileSync(srcPath, filePath);
    data.customRingtone = fileUrlFromPath(filePath);
    data.customRingtoneName = name;
    saveData();
    return { ok: true, src: ringtonePlaybackUrl(data.customRingtone), name: data.customRingtoneName };
  } catch (e2) {
    safeError('set-ringtone-file error:', e2);
    return { ok: false, error: 'copy-failed' };
  }
});
// 主进程选铃声文件（Electron 32+ 移除了 renderer 的 File.path，必须用 dialog）
ipcMain.handle('pick-ringtone-file', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: '选择铃声文件（WAV/MP3，最大 100MB）',
      properties: ['openFile'],
      filters: [
        { name: '音频文件', extensions: ['mp3', 'wav'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths || !result.filePaths.length) {
      return { canceled: true };
    }
    const srcPath = result.filePaths[0];
    const name = path.basename(srcPath);
    const stat = fs.statSync(srcPath);
    if (!stat.isFile()) return { ok: false, error: 'not-file' };
    if (stat.size > MAX_RINGTONE_BYTES) return { ok: false, error: 'too-large' };
    if (!/\.(wav|mp3)$/i.test(srcPath)) return { ok: false, error: 'bad-format' };
    const extension = /\.mp3$/i.test(srcPath) ? 'mp3' : 'wav';
    const directory = path.join(USER_DATA, 'ringtones');
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, `custom-ringtone.${extension}`);
    fs.copyFileSync(srcPath, filePath);
    data.customRingtone = fileUrlFromPath(filePath);
    data.customRingtoneName = name;
    saveData();
    return { ok: true, src: ringtonePlaybackUrl(data.customRingtone), name: data.customRingtoneName };
  } catch (e) {
    safeError('pick-ringtone-file error:', e);
    return { ok: false, error: 'pick-failed' };
  }
});
// ==================== 铃声库（每个闹钟可配不同铃声）====================
function getRingtoneDir() {
  const dir = path.join(USER_DATA, 'ringtones');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
ipcMain.handle('get-ringtone-library', () => {
  try {
    const dir = getRingtoneDir();
    const files = fs.readdirSync(dir).filter(f => /\.(mp3|wav)$/i.test(f));
    const list = files.map(f => ({
      key: f,
      name: path.basename(f, path.extname(f)),
      src: ringtonePlaybackUrl(fileUrlFromPath(path.join(dir, f)))
    }));
    return list;
  } catch (e) {
    safeError('get-ringtone-library error:', e);
    return [];
  }
});
ipcMain.handle('add-ringtone-to-library', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: '添加铃声到铃声库（WAV/MP3，最大 100MB）',
      properties: ['openFile'],
      filters: [{ name: '音频文件', extensions: ['mp3', 'wav'] }]
    });
    if (result.canceled || !result.filePaths || !result.filePaths.length) {
      return { canceled: true };
    }
    const srcPath = result.filePaths[0];
    const stat = fs.statSync(srcPath);
    if (!stat.isFile()) return { ok: false, error: 'not-file' };
    if (stat.size > MAX_RINGTONE_BYTES) return { ok: false, error: 'too-large' };
    if (!/\.(wav|mp3)$/i.test(srcPath)) return { ok: false, error: 'bad-format' };
    const ext = /\.mp3$/i.test(srcPath) ? 'mp3' : 'wav';
    const baseName = path.basename(srcPath, path.extname(srcPath)).replace(/[\/:*?"<>|]/g, '_').slice(0, 50) || '铃声';
    const dir = getRingtoneDir();
    // 避免重名
    let fileName = baseName + '.' + ext;
    let idx = 2;
    while (fs.existsSync(path.join(dir, fileName))) {
      fileName = baseName + '_' + idx + '.' + ext;
      idx++;
    }
    fs.copyFileSync(srcPath, path.join(dir, fileName));
    return {
      ok: true,
      ringtone: {
        key: fileName,
        name: path.basename(fileName, path.extname(fileName)),
        src: ringtonePlaybackUrl(fileUrlFromPath(path.join(dir, fileName)))
      }
    };
  } catch (e) {
    safeError('add-ringtone-to-library error:', e);
    return { ok: false, error: 'add-failed' };
  }
});
ipcMain.handle('remove-ringtone-from-library', (e, key) => {
  try {
    if (!key || typeof key !== 'string' || !/^[a-zA-Z0-9_\-.\u4e00-\u9fa5]+\.(mp3|wav)$/i.test(key)) {
      return { ok: false, error: 'bad-key' };
    }
    const fp = path.join(getRingtoneDir(), key);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    return { ok: true };
  } catch (e) {
    safeError('remove-ringtone-from-library error:', e);
    return { ok: false, error: 'remove-failed' };
  }
});
// ==================== 起床听歌模式 IPC ====================
ipcMain.handle('get-music-settings', () => ({
  on: musicOnAlarm,
  app: musicApp,
  customPath: musicAppPath,
  foundPath: findMusicAppPath(),
  platformSupported: process.platform === 'win32' || process.platform === 'darwin'
}));
ipcMain.handle('set-music-settings', (e, s) => {
  if (s && typeof s === 'object') {
    if (Object.prototype.hasOwnProperty.call(s, 'on')) musicOnAlarm = !!s.on;
    if (Object.prototype.hasOwnProperty.call(s, 'app') && (s.app === 'custom' || MUSIC_APP_PRESETS[s.app])) {
      musicApp = s.app;
    }
    if (Object.prototype.hasOwnProperty.call(s, 'customPath')) {
      musicAppPath = typeof s.customPath === 'string' ? s.customPath : '';
    }
  }
  persistSettings();
  broadcast('settings-updated', data.settings);
  return {
    on: musicOnAlarm,
    app: musicApp,
    customPath: musicAppPath,
    foundPath: findMusicAppPath(),
    platformSupported: process.platform === 'win32' || process.platform === 'darwin'
  };
});
ipcMain.handle('pick-music-app', async () => {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return { success: false, reason: 'unsupported-platform' };
  }
  try {
    const result = await dialog.showOpenDialog({
      title: '选择音乐应用',
      properties: ['openFile'],
      filters: process.platform === 'win32'
        ? [{ name: '应用程序', extensions: ['exe'] }]
        : undefined
    });
    if (result.canceled || !result.filePaths || !result.filePaths.length) return { canceled: true };
    return { canceled: false, path: result.filePaths[0] };
  } catch (e) {
    safeError('pick-music-app error:', e);
    return { canceled: true, error: e.message };
  }
});
ipcMain.handle('open-music-app', (e, opts) => openMusicApp(opts));
ipcMain.handle('get-startup-notices', () => startupNotices.slice());
ipcMain.handle('get-settings', () => ({
  autoStartEnabled,
  keepAliveEnabled,
  petAlwaysOnTop,
  version: app.getVersion(),
  logFile: logFilePath,
  userDataPath: USER_DATA,
  dataFile: DATA_FILE
}));
ipcMain.handle('open-data-folder', async () => {
  try {
    const error = await shell.openPath(USER_DATA);
    return { success: !error, error: error || '' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('set-settings', (e, settings) => {
  if (settings && Object.prototype.hasOwnProperty.call(settings, 'autoStartEnabled')) {
    autoStartEnabled = !!settings.autoStartEnabled;
    applyAutoStart();
  }
  if (settings && Object.prototype.hasOwnProperty.call(settings, 'keepAliveEnabled')) {
    keepAliveEnabled = !!settings.keepAliveEnabled;
    applyKeepAlive();
  }
  if (settings && Object.prototype.hasOwnProperty.call(settings, 'petAlwaysOnTop')) {
    petAlwaysOnTop = !!settings.petAlwaysOnTop;
    applyPetAlwaysOnTop();
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
ipcMain.handle('set-window-pos', (e, x, y) => {
  if (!petWindow || petWindow.isDestroyed()) return false;
  const bounds = petWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const next = clampWindowPosition(
    Number.isFinite(x) ? Math.round(x) : bounds.x,
    Number.isFinite(y) ? Math.round(y) : bounds.y,
    bounds.width,
    bounds.height,
    display.workArea,
  );
  petWindow.setPosition(next.x, next.y, false);
  return next;
});
ipcMain.handle('move-pet-by', (e, dx, dy) => {
  if (!petWindow || petWindow.isDestroyed()) return null;
  const bounds = petWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const next = clampWindowPosition(
    bounds.x + Math.max(-20, Math.min(20, Number(dx) || 0)),
    bounds.y + Math.max(-20, Math.min(20, Number(dy) || 0)),
    bounds.width,
    bounds.height,
    display.workArea,
  );
  petWindow.setPosition(next.x, next.y, false);
  return {
    x: next.x,
    y: next.y,
    hitLeft: next.x <= display.workArea.x,
    hitRight: next.x >= display.workArea.x + display.workArea.width - bounds.width,
  };
});
ipcMain.handle('set-pet-mouse-events', (e, enabled) => {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setIgnoreMouseEvents(!enabled, { forward: true });
  }
  return true;
});
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
    petAlwaysOnTop = imported.settings.petAlwaysOnTop;
    musicOnAlarm = imported.settings.musicOnAlarm;
    musicApp = imported.settings.musicApp;
    musicAppPath = imported.settings.musicAppPath;
    applyAutoStart();
    applyKeepAlive();
    applyPetAlwaysOnTop();
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

// 发送消息 - 合并已保存的 API Key
ipcMain.handle('send-chat-message', async (e, message, modelId = 'qclaw') => {
  const config = MODEL_CONFIGS[modelId] || MODEL_CONFIGS.qclaw;

  // 非 qclaw 模型：从已保存的 API Keys 文件中读取 token（优先于环境变量）
  let token = config.token;
  if (modelId !== 'qclaw') {
    const savedKeys = loadApiKeys();
    if (savedKeys[modelId]) {
      token = savedKeys[modelId];
    }
    if (!token) {
      return { success: false, error: `${config.name} 需要配置 API Key，请在设置面板中配置` };
    }
  }

  // 30秒超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: String(message) }],
        max_tokens: config.maxTokens
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'unknown');
      safeError(`[main] ${config.name} API error:`, response.status, errText);
      if (response.status === 401) {
        return { success: false, error: `${config.name} API Key 无效，请检查 Key 是否正确` };
      }
      return { success: false, error: `${config.name} 请求失败 (${response.status})` };
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '(无回复)';
    safeLog(`[main] ${config.name} 回复:`, reply.substring(0, 50));
    return { success: true, reply };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      safeError(`[main] ${config.name} 请求超时(30s)`);
      return { success: false, error: `${config.name} 请求超时，请稍后重试` };
    }
    safeError(`[main] ${config.name} 连接失败:`, err.message);
    if (modelId === 'qclaw') {
      return { success: false, error: 'QClaw 未运行，请先启动星野助手' };
    }
    return { success: false, error: `${config.name} 连接失败，请检查网络` };
  } finally {
    clearTimeout(timeoutId);
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
  if (process.platform !== 'win32') {
    safeLog('[main] Active-window pose detection is only available on Windows');
    return;
  }

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
      checkDueAlarmsNow();

      // 计算睡眠时长，弹解锁通知
      try {
        const sleepText = lockTime ? formatSleepDuration(lockTime, Date.now()).text : '';
        new Notification({
          title: '☀️ 主人回来啦',
          body: sleepText || '欢迎回来~',
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
    powerMonitor.on('resume', () => {
      safeLog('[main] System resumed');
      lastWindowState = '';
      checkDueAlarmsNow();
    });
    safeLog('[main] Lock screen detection registered');
  } catch (e) {
    safeError('[main] powerMonitor lock detection failed:', e);
  }
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const ownPage = webContents && typeof webContents.getURL === 'function' && /^(?:file:\/\/|app:\/\/local\/)/.test(webContents.getURL());
    return permission === 'media' && ownPage;
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const ownPage = webContents && typeof webContents.getURL === 'function' && /^(?:file:\/\/|app:\/\/local\/)/.test(webContents.getURL());
    callback(permission === 'media' && ownPage);
  });
  setupAppProtocol();
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

// 获取模型配置（名称 + API Key 状态），合并两种数据源
ipcMain.handle('get-model-configs', () => {
  const keys = loadApiKeys();
  var result = {};
  Object.keys(MODEL_CONFIGS).forEach(function(k) {
    var cfg = MODEL_CONFIGS[k];
    var hasKey = (k === 'qclaw') ? true : !!keys[k];
    result[k] = hasKey ? {
      name: cfg.name,
      model: cfg.model,
      apiKey: k === 'qclaw' ? null : (keys[k] || '')
    } : null;
  });
  return result;
});


// �����ʾ/����ʱͻ�����ﴰ�ڣ�ȷ���ɿ���
ipcMain.on('pet-panel-visible', (event, visible) => {
  if (petWindow && !petWindow.isDestroyed()) {
    resizePetWindow(Boolean(visible));
    if (!visible) normalizePetWindowBounds(false);
    if (visible) {
      applyPetAlwaysOnTop();
      petWindow.moveTop();
      petWindow.focus();
    }
    else applyPetAlwaysOnTop();
  }
});
