const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  collectDueAlarms,
  normalizeImportedData,
  readJsonWithBackup,
  writeJsonAtomic,
  clampWindowPosition,
} = require('../timer-core');

test('an alarm crossed while the computer was asleep fires once after resume', () => {
  const alarms = [{ id: 1, time: '09:00', label: 'stand up', repeat: true, enabled: true }];
  const previous = new Date(2026, 6, 15, 8, 59, 30);
  const resumed = new Date(2026, 6, 15, 9, 5, 0);

  const first = collectDueAlarms(alarms, {}, previous, resumed);
  assert.deepEqual(first.due.map((alarm) => alarm.id), [1]);

  const second = collectDueAlarms(alarms, first.lastFired, previous, resumed);
  assert.deepEqual(second.due, []);
});

test('one-time alarm crossed during sleep is disabled after it fires', () => {
  const alarms = [{ id: 2, time: '23:59', label: 'once', repeat: false, enabled: true }];
  const result = collectDueAlarms(
    alarms,
    {},
    new Date(2026, 6, 15, 23, 58, 0),
    new Date(2026, 6, 16, 0, 3, 0),
  );

  assert.equal(result.due.length, 1);
  assert.equal(result.alarms[0].enabled, false);
});

test('import restores every exported user field including empty arrays', () => {
  const imported = normalizeImportedData({
    alarms: [],
    laps: [],
    countdown: { targetDate: '2026-07-16T01:00:00.000Z', label: 'launch' },
    stopwatch: { elapsed: 1200, running: false },
    customRingtone: null,
    customRingtoneName: '',
    settings: { autoStartEnabled: false, keepAliveEnabled: false },
    lastFired: { old: true },
  });

  assert.deepEqual(imported.alarms, []);
  assert.deepEqual(imported.laps, []);
  assert.equal(imported.countdown.label, 'launch');
  assert.equal(imported.stopwatch.elapsed, 1200);
  assert.deepEqual(imported.lastFired, { old: true });
});

test('import rejects malformed alarm data', () => {
  assert.throws(
    () => normalizeImportedData({ alarms: { time: '09:00' } }),
    /alarms/i,
  );
  assert.throws(
    () => normalizeImportedData({ alarms: [{ time: '25:99', enabled: true }] }),
    /alarm/i,
  );
});

test('import rejects a ringtone larger than 5 MB', () => {
  const oversized = `data:audio/wav;base64,${'A'.repeat(7 * 1024 * 1024)}`;
  assert.throws(
    () => normalizeImportedData({ customRingtone: oversized }),
    /5 MB/i,
  );
});

test('import accepts stored file-url ringtones', () => {
  const imported = normalizeImportedData({
    customRingtone: 'file:///C:/Users/example/AppData/Roaming/DesktopTimer/ringtones/custom-ringtone.mp3',
    customRingtoneName: 'focus.mp3',
  });
  assert.equal(imported.customRingtoneName, 'focus.mp3');
  assert.match(imported.customRingtone, /^file:\/\/\//);
});

test('atomic JSON writes keep a readable backup of the previous data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyu-timer-'));
  const file = path.join(dir, 'timer-data.json');
  writeJsonAtomic(file, { version: 1 });
  writeJsonAtomic(file, { version: 2 });

  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')), { version: 1 });
});

test('pet window position is clamped to the display work area', () => {
  const bounds = { x: -1920, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(
    clampWindowPosition(-2500, 1200, 180, 260, bounds),
    { x: -1920, y: 780 },
  );
});

test('pet window position is clamped at every edge of the work area', () => {
  const bounds = { x: 0, y: 0, width: 1440, height: 900 };
  const size = { width: 280, height: 340 };
  assert.deepEqual(clampWindowPosition(-100, -100, size.width, size.height, bounds), { x: 0, y: 0 });
  assert.deepEqual(clampWindowPosition(2000, -100, size.width, size.height, bounds), { x: 1160, y: 0 });
  assert.deepEqual(clampWindowPosition(-100, 2000, size.width, size.height, bounds), { x: 0, y: 560 });
  assert.deepEqual(clampWindowPosition(2000, 2000, size.width, size.height, bounds), { x: 1160, y: 560 });
});

test('pet window position supports displays placed left or above the primary display', () => {
  const leftDisplay = { x: -1920, y: 0, width: 1920, height: 1040 };
  const upperDisplay = { x: 0, y: -1080, width: 1920, height: 1040 };
  assert.deepEqual(clampWindowPosition(-2500, 1200, 280, 340, leftDisplay), { x: -1920, y: 700 });
  assert.deepEqual(clampWindowPosition(2200, -1500, 280, 340, upperDisplay), { x: 1640, y: -1080 });
});

test('corrupt JSON data can be restored from its backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-data-'));
  const file = path.join(dir, 'timer-data.json');
  fs.writeFileSync(file, '{ broken json', 'utf8');
  fs.writeFileSync(`${file}.bak`, JSON.stringify({ alarms: [{ id: 7, time: '07:30' }] }), 'utf8');

  const result = readJsonWithBackup(file);
  assert.equal(result.restoredFromBackup, true);
  assert.equal(result.value.alarms[0].time, '07:30');
});
