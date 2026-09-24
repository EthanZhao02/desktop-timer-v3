const fs = require('fs');
const path = require('path');

const DEFAULT_DATA = Object.freeze({
  alarms: [],
  customRingtone: null,
  customRingtoneName: '',
  laps: [],
  lastFired: {},
  countdown: null,
  stopwatch: null,
  focusSessions: [],
  settings: {
    autoStartEnabled: false,
    keepAliveEnabled: false,
  },
});

// 自定义铃声上传大小上限：100 MB
const MAX_RINGTONE_BYTES = 100 * 1024 * 1024;
const MUSIC_MODES = new Set(['熟悉模式', '新鲜模式', '起床', '洗澡', '图书馆', '动感健身', '深夜EMO', 'DJ模式', '助眠模式']);
const MUSIC_APPS = new Set(['netease', 'kugou', 'qishui', 'qq', 'kuwo', 'migu', 'spotify', 'foobar2000', 'custom']);

function normalizeRingtoneKey(value) {
  if (typeof value !== 'string' || !value) return '';
  return /^[a-zA-Z0-9_\-.\u4e00-\u9fa5]+\.(?:mp3|wav)$/i.test(value) ? value : '';
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseAlarmTime(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return { hour, minute };
}

function validateRingtone(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error('Ringtone must be a WAV or MP3 audio file');
  }
  if (/^file:\/\/\/.+\.(?:wav|mp3)$/i.test(value)) return value;
  if (!/^data:audio\/(?:wav|x-wav|mpeg);base64,/i.test(value)) {
    throw new Error('Ringtone must be a WAV or MP3 audio file');
  }
  const payload = value.slice(value.indexOf(',') + 1);
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  const byteLength = Math.floor(payload.length * 3 / 4) - padding;
  if (byteLength > MAX_RINGTONE_BYTES) throw new Error('Ringtone must not exceed 100 MB');
  return value;
}

function collectDueAlarms(alarms, lastFired, previousCheck, now) {
  const safeAlarms = Array.isArray(alarms) ? alarms.map((alarm) => ({ ...alarm })) : [];
  const fired = lastFired && typeof lastFired === 'object' ? { ...lastFired } : {};
  const end = now instanceof Date ? now : new Date(now);
  let start = previousCheck instanceof Date ? previousCheck : new Date(previousCheck);
  if (!Number.isFinite(start.getTime()) || start >= end) {
    start = new Date(end.getTime() - 60 * 1000);
  }
  // Do not replay days of stale reminders after an application restart.
  if (end.getTime() - start.getTime() > 24 * 60 * 60 * 1000) {
    start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  }

  const due = [];
  for (const alarm of safeAlarms) {
    const parsed = alarm && alarm.enabled ? parseAlarmTime(alarm.time) : null;
    if (!parsed) continue;

    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const finalDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    while (cursor <= finalDay) {
      const scheduled = new Date(
        cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), parsed.hour, parsed.minute, 0, 0,
      );
      const key = `${alarm.id || alarm.time}_${alarm.time}_${localDateKey(scheduled)}`;
      if (scheduled > start && scheduled <= end && fired[key] !== true) {
        due.push(alarm);
        fired[key] = true;
        if (!alarm.repeat) alarm.enabled = false;
        break;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return { due, alarms: safeAlarms, lastFired: fired };
}

function normalizeImportedData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Import data must be a JSON object');
  }
  if (value.alarms !== undefined && !Array.isArray(value.alarms)) {
    throw new Error('alarms must be an array');
  }
  const alarms = (value.alarms || []).map((alarm, index) => {
    if (!alarm || typeof alarm !== 'object' || !parseAlarmTime(alarm.time)) {
      throw new Error(`alarm ${index + 1} has an invalid time`);
    }
    return {
      id: Number.isFinite(Number(alarm.id)) ? Number(alarm.id) : Date.now() + index,
      time: alarm.time,
      label: typeof alarm.label === 'string' ? alarm.label.slice(0, 200) : '闹钟',
      repeat: alarm.repeat === true,
      enabled: alarm.enabled !== false,
      requirePhotoVerification: alarm.requirePhotoVerification === true,
      ringtone: normalizeRingtoneKey(alarm.ringtone),
      musicMode: alarm.musicMode === '图书馆'
        ? '动感健身'
        : (MUSIC_MODES.has(alarm.musicMode) ? alarm.musicMode : ''),
    };
  });
  if (value.laps !== undefined && !Array.isArray(value.laps)) {
    throw new Error('laps must be an array');
  }

  const settings = value.settings && typeof value.settings === 'object' ? value.settings : {};
  return {
    alarms,
    laps: Array.isArray(value.laps) ? value.laps.slice(0, 99) : [],
    focusSessions: Array.isArray(value.focusSessions)
      ? value.focusSessions.filter((session) => session && Number.isFinite(Number(session.duration)) && Number.isFinite(Number(session.completedAt))).slice(-500)
      : [],
    countdown: value.countdown && typeof value.countdown === 'object' ? value.countdown : null,
    stopwatch: value.stopwatch && typeof value.stopwatch === 'object' ? value.stopwatch : null,
    customRingtone: validateRingtone(value.customRingtone),
    customRingtoneName: typeof value.customRingtoneName === 'string' ? value.customRingtoneName : '',
    lastFired: value.lastFired && typeof value.lastFired === 'object' && !Array.isArray(value.lastFired)
      ? value.lastFired
      : {},
    settings: {
      autoStartEnabled: settings.autoStartEnabled === true,
      keepAliveEnabled: settings.keepAliveEnabled === true,
      petAlwaysOnTop: settings.petAlwaysOnTop === true,
      musicOnAlarm: settings.musicOnAlarm === true,
      musicApp: MUSIC_APPS.has(settings.musicApp) ? settings.musicApp : 'netease',
      musicAppPath: typeof settings.musicAppPath === 'string' ? settings.musicAppPath : '',
    },
  };
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const temporary = `${filePath}.tmp`;
  const backup = `${filePath}.bak`;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, backup);
  fs.renameSync(temporary, filePath);
}

function readJsonWithBackup(filePath) {
  if (!fs.existsSync(filePath)) return { value: null, restoredFromBackup: false };
  try {
    return {
      value: JSON.parse(fs.readFileSync(filePath, 'utf8')),
      restoredFromBackup: false,
    };
  } catch (primaryError) {
    const backup = `${filePath}.bak`;
    if (!fs.existsSync(backup)) throw primaryError;
    return {
      value: JSON.parse(fs.readFileSync(backup, 'utf8')),
      restoredFromBackup: true,
    };
  }
}

function clampWindowPosition(x, y, width, height, workArea) {
  return {
    x: Math.max(workArea.x, Math.min(Math.round(x), workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(Math.round(y), workArea.y + workArea.height - height)),
  };
}

// 根据锁屏/解锁时间生成睡眠时长文案（供主进程通知与自动化测试使用）
// 返回 { minutes, text }；时长不足 1 分钟或时间非法时 text 为空字符串。
function formatSleepDuration(lockTime, unlockTime) {
  const locked = Number(lockTime);
  const unlocked = Number(unlockTime);
  if (!Number.isFinite(locked) || !Number.isFinite(unlocked) || unlocked <= locked) {
    return { minutes: 0, text: '' };
  }
  const minutes = Math.floor((unlocked - locked) / 60000);
  if (minutes < 1) return { minutes: 0, text: '' };
  if (minutes < 2) return { minutes, text: '刚打了个盹~' };
  if (minutes < 60) return { minutes, text: `我刚睡了 ${minutes} 分钟~` };
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return { minutes, text: `我刚睡了 ${h} 小时${m > 0 ? ` ${m} 分钟` : ''}~` };
}

module.exports = {
  DEFAULT_DATA,
  MAX_RINGTONE_BYTES,
  clampWindowPosition,
  collectDueAlarms,
  formatSleepDuration,
  normalizeImportedData,
  readJsonWithBackup,
  validateRingtone,
  writeJsonAtomic,
};
