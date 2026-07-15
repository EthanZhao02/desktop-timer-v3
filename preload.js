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
  setPetMouseEvents: (enabled) => ipcRenderer.send('set-pet-mouse-events', !!enabled),
  movePetTo: (x, y) => ipcRenderer.send('move-pet-to', x, y),
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
});
