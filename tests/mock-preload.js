// ==================== 测试专用 Preload（仅供 tests/pet-interaction.js 使用）====================
// 通过 contextBridge 暴露与真实 preload.js 同构的 window.api，
// 并记录所有调用、暂存事件回调，供集成测试断言宠物交互行为。
const { contextBridge } = require('electron');

const calls = {
  showMain: 0,
  hidePet: 0,
  minimizeToPet: 0,
  setWindowPos: [],
  movePetBy: [],
  setPetMouseEvents: [],
  setPanelVisible: [],
  setPetActivity: []
};

const handlers = {};

contextBridge.exposeInMainWorld('api', {
  // ---- 数据类接口：返回安全的默认值，避免宠物窗口初始化报错 ----
  getAlarms: () => [],
  setAlarms: () => {},
  getLaps: () => [],
  setLaps: () => {},
  getFocusSessions: () => [],
  addFocusSession: () => [],
  getCountdown: () => null,
  setCountdown: () => {},
  getStopwatch: () => null,
  setStopwatch: () => {},
  getRingtone: () => null,
  setRingtone: () => {},
  getRingtoneLibrary: () => [],
  getDefaultRingtonePath: () => null,
  getStartupNotices: () => [],
  getSettings: () => ({}),
  setSettings: () => {},
  getMusicSettings: () => ({ on: false, app: 'netease', customPath: '', platformSupported: true }),
  setMusicSettings: () => ({}),
  pickMusicApp: () => ({ canceled: true }),
  openMusicApp: () => ({ success: false, reason: 'not-found' }),
  showNotification: () => {},
  getApiKeys: () => ({}),
  saveApiKeys: () => {},
  getModelConfigs: () => ({ models: [] }),
  sendChatMessage: () => ({ ok: false, reply: '' }),
  getFocusSessions: () => [],

  // ---- 宠物窗口交互接口：记录调用 ----
  showMain: () => { calls.showMain++; },
  hidePet: () => { calls.hidePet++; },
  minimizeToPet: () => { calls.minimizeToPet++; },
  setWindowPos: (x, y) => { calls.setWindowPos.push([x, y]); },
  movePetBy: (dx, dy) => { calls.movePetBy.push([dx, dy]); },
  setPetMouseEvents: (enabled) => { calls.setPetMouseEvents.push(enabled); },
  setPanelVisible: (visible) => { calls.setPanelVisible.push(visible); },
  setPetActivity: (activity) => { calls.setPetActivity.push(activity); },
  setTheme: () => {},

  // ---- 事件监听：暂存回调，测试通过 __test.emit 触发 ----
  onThemeChanged: (cb) => { handlers.themeChanged = cb; },
  onAlarmsUpdated: (cb) => { handlers.alarmsUpdated = cb; },
  onAlarmTriggered: (cb) => { handlers.alarmTriggered = cb; },
  onPetActivity: (cb) => { handlers.petActivity = cb; },
  onWindowState: (cb) => { handlers.windowState = cb; },
  onLockEvent: (cb) => { handlers.lockEvent = cb; },

  // ---- 测试控制面 ----
  __test: {
    getCalls: () => calls,
    emit: (event, payload) => {
      if (handlers[event]) handlers[event](payload);
    }
  }
});
