const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getAlarms: () => ipcRenderer.invoke('get-alarms'),
  setAlarms: (alarms) => ipcRenderer.invoke('set-alarms', alarms),
  getLaps: () => ipcRenderer.invoke('get-laps'),
  setLaps: (laps) => ipcRenderer.invoke('set-laps', laps),
  getCountdown: () => ipcRenderer.invoke('get-countdown'),
  setCountdown: (countdown) => ipcRenderer.invoke('set-countdown', countdown),
  getStopwatch: () => ipcRenderer.invoke('get-stopwatch'),
  setStopwatch: (stopwatch) => ipcRenderer.invoke('set-stopwatch', stopwatch),
  getRingtone: () => ipcRenderer.invoke('get-ringtone'),
  setRingtone: (data) => ipcRenderer.invoke('set-ringtone', data),
  getDefaultRingtonePath: () => ipcRenderer.invoke('get-default-ringtone-path'),
  getStartupNotices: () => ipcRenderer.invoke('get-startup-notices'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),
  showNotification: (payload) => ipcRenderer.invoke('show-notification', payload),
  hidePet: () => ipcRenderer.invoke('hide-pet'),
  showMain: () => ipcRenderer.invoke('show-main'),
  setWindowPos: (x, y) => ipcRenderer.invoke('set-window-pos', x, y),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  minimizeToPet: () => ipcRenderer.invoke('minimize-to-pet'),
  // 主题同步
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  onThemeChanged: (cb) => ipcRenderer.on('theme-changed', (e, theme) => cb(theme)),
  // 数据导入导出
  exportData: () => ipcRenderer.invoke('export-data'),
  importData: () => ipcRenderer.invoke('import-data'),
  // 事件监听
  onSwitchTab: (cb) => ipcRenderer.on('switch-tab', (e, tab) => cb(tab)),
  onPlayRingtone: (cb) => ipcRenderer.on('play-ringtone', (e, src) => cb(src)),
  onAlarmTriggered: (cb) => ipcRenderer.on('alarm-triggered', (e, alarm) => cb(alarm)),
  onAlarmsUpdated: (cb) => ipcRenderer.on('alarms-updated', (e, alarms) => cb(alarms)),
  onSettingsUpdated: (cb) => ipcRenderer.on('settings-updated', (e, settings) => cb(settings)),
  onAppWarning: (cb) => ipcRenderer.on('app-warning', (e, warning) => cb(warning)),
  // 活动窗口状态检测
  onWindowState: (cb) => ipcRenderer.on('window-state', (e, state) => cb(state)),
  // 锁屏/解锁事件（带睡眠时长）
  onLockEvent: (cb) => ipcRenderer.on('lock-event', (e, data) => cb(data)),
  // QClaw 星野对话
  sendChatMessage: (msg) => ipcRenderer.invoke('send-chat-message', msg),
});
