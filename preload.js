const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getAlarms: () => ipcRenderer.invoke('get-alarms'),
  setAlarms: (alarms) => ipcRenderer.invoke('set-alarms', alarms),
  getLaps: () => ipcRenderer.invoke('get-laps'),
  setLaps: (laps) => ipcRenderer.invoke('set-laps', laps),
  getFocusSessions: () => ipcRenderer.invoke('get-focus-sessions'),
  addFocusSession: (session) => ipcRenderer.invoke('add-focus-session', session),
  getCountdown: () => ipcRenderer.invoke('get-countdown'),
  setCountdown: (countdown) => ipcRenderer.invoke('set-countdown', countdown),
  getStopwatch: () => ipcRenderer.invoke('get-stopwatch'),
  setStopwatch: (stopwatch) => ipcRenderer.invoke('set-stopwatch', stopwatch),
  setPetActivity: (activity) => ipcRenderer.invoke('set-pet-activity', activity),
  getRingtone: () => ipcRenderer.invoke('get-ringtone'),
  setRingtone: (data) => ipcRenderer.invoke('set-ringtone', data),
  setRingtoneFile: (payload) => ipcRenderer.invoke('set-ringtone-file', payload),
  pickRingtoneFile: () => ipcRenderer.invoke('pick-ringtone-file'),
  getRingtoneLibrary: () => ipcRenderer.invoke('get-ringtone-library'),
  addRingtoneToLibrary: () => ipcRenderer.invoke('add-ringtone-to-library'),
  removeRingtoneFromLibrary: (key) => ipcRenderer.invoke('remove-ringtone-from-library', key),
  getDefaultRingtonePath: () => ipcRenderer.invoke('get-default-ringtone-path'),
  getStartupNotices: () => ipcRenderer.invoke('get-startup-notices'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),
  // 起床听歌模式
  getMusicSettings: () => ipcRenderer.invoke('get-music-settings'),
  setMusicSettings: (s) => ipcRenderer.invoke('set-music-settings', s),
  pickMusicApp: () => ipcRenderer.invoke('pick-music-app'),
  openMusicApp: (opts) => ipcRenderer.invoke('open-music-app', opts),
  showNotification: (payload) => ipcRenderer.invoke('show-notification', payload),
  hidePet: () => ipcRenderer.invoke('hide-pet'),
  showMain: () => ipcRenderer.invoke('show-main'),
  setWindowPos: (x, y) => ipcRenderer.invoke('set-window-pos', x, y),
  movePetBy: (dx, dy) => ipcRenderer.invoke('move-pet-by', dx, dy),
  setPetMouseEvents: (enabled) => ipcRenderer.invoke('set-pet-mouse-events', enabled),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  minimizeToPet: () => ipcRenderer.invoke('minimize-to-pet'),
  // 主题同步
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  onThemeChanged: (cb) => ipcRenderer.on('theme-changed', (e, theme) => cb(theme)),
  // 数据导入导出
  exportData: () => ipcRenderer.invoke('export-data'),
  importData: () => ipcRenderer.invoke('import-data'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  // 事件监听
  onSwitchTab: (cb) => ipcRenderer.on('switch-tab', (e, tab) => cb(tab)),
  onPlayRingtone: (cb) => ipcRenderer.on('play-ringtone', (e, src) => cb(src)),
  onAlarmTriggered: (cb) => ipcRenderer.on('alarm-triggered', (e, alarm) => cb(alarm)),
  onAlarmsUpdated: (cb) => ipcRenderer.on('alarms-updated', (e, alarms) => cb(alarms)),
  onSettingsUpdated: (cb) => ipcRenderer.on('settings-updated', (e, settings) => cb(settings)),
  onAppWarning: (cb) => ipcRenderer.on('app-warning', (e, warning) => cb(warning)),
  onPetActivity: (cb) => ipcRenderer.on('pet-activity-changed', (e, activity) => cb(activity)),
  // 活动窗口状态检测
  onWindowState: (cb) => ipcRenderer.on('window-state', (e, state) => cb(state)),
  // 锁屏/解锁事件（带睡眠时长）
  onLockEvent: (cb) => ipcRenderer.on('lock-event', (e, data) => cb(data)),
  // AI 对话（多模型）
  sendChatMessage: (msg, modelId) => ipcRenderer.invoke('send-chat-message', msg, modelId),
  getModelConfigs: () => ipcRenderer.invoke('get-model-configs'),
  // API Key 管理
  getApiKeys: () => ipcRenderer.invoke('get-api-keys'),
  saveApiKeys: (keys) => ipcRenderer.invoke('save-api-keys', keys),
  // 面板置顶控制
  setPanelVisible: (visible) => ipcRenderer.send('pet-panel-visible', visible),
});
