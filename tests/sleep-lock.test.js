// ==================== 休眠与锁屏逻辑测试（node --test）====================
// 覆盖：锁屏/睡眠时长文案生成（formatSleepDuration）、
//      休眠期间闹钟补触发与跨天边界（collectDueAlarms）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { collectDueAlarms, formatSleepDuration } = require('../timer-core');

// ---------------- formatSleepDuration：睡眠/锁屏时长文案 ----------------
test('睡眠时长：非法时间不生成文案', () => {
  assert.deepEqual(formatSleepDuration(0, 0), { minutes: 0, text: '' });
  assert.deepEqual(formatSleepDuration(1000, 999), { minutes: 0, text: '' });
  assert.deepEqual(formatSleepDuration('abc', Date.now()), { minutes: 0, text: '' });
  assert.deepEqual(formatSleepDuration(Date.now(), 'abc'), { minutes: 0, text: '' });
});

test('睡眠时长：不足 1 分钟不提示', () => {
  const lock = Date.now() - 30 * 1000; // 锁屏 30 秒
  const result = formatSleepDuration(lock, Date.now());
  assert.equal(result.text, '');
  assert.equal(result.minutes, 0);
});

test('睡眠时长：1 分钟提示打盹', () => {
  const lock = Date.now() - 1 * 60 * 1000;
  const result = formatSleepDuration(lock, Date.now());
  assert.equal(result.text, '刚打了个盹~');
  assert.equal(result.minutes, 1);
});

test('睡眠时长：分钟级文案', () => {
  const lock = Date.now() - 30 * 60 * 1000;
  const result = formatSleepDuration(lock, Date.now());
  assert.equal(result.text, '我刚睡了 30 分钟~');
  assert.equal(result.minutes, 30);
});

test('睡眠时长：小时+分钟文案', () => {
  const lock = Date.now() - 90 * 60 * 1000;
  const result = formatSleepDuration(lock, Date.now());
  assert.equal(result.text, '我刚睡了 1 小时 30 分钟~');
  assert.equal(result.minutes, 90);
});

test('睡眠时长：整小时文案', () => {
  const lock = Date.now() - 120 * 60 * 1000;
  const result = formatSleepDuration(lock, Date.now());
  assert.equal(result.text, '我刚睡了 2 小时~');
  assert.equal(result.minutes, 120);
});

// ---------------- collectDueAlarms：休眠/锁屏补触发 ----------------
function alarm(overrides) {
  return Object.assign({ id: 1, time: '08:00', label: '闹钟', repeat: false, enabled: true, requirePhotoVerification: false, ringtone: '', musicMode: '' }, overrides);
}

function at(hour, minute) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

test('补触发：休眠期间到点的闹钟被触发一次', () => {
  const a = alarm({ id: 1, time: '08:00', repeat: false });
  const { due } = collectDueAlarms([a], {}, at(7, 50), at(8, 5));
  assert.equal(due.length, 1);
  assert.equal(due[0].id, 1);
});

test('补触发：锁屏时间极短（30 秒）且未到点不触发', () => {
  const a = alarm({ id: 1, time: '08:00' });
  // 上次检查 07:59:30（锁屏），当前 07:59:50：闹钟 08:00 尚未到点
  const { due } = collectDueAlarms([a], {}, new Date(at(7, 59).getTime() + 30 * 1000), new Date(at(7, 59).getTime() + 50 * 1000));
  assert.equal(due.length, 0);
});

test('补触发：跨天（23:30 闹钟在次日 00:10 补触发）', () => {
  const a = alarm({ id: 2, time: '23:30' });
  // 昨天 23:00 是最后检查点（锁屏前），今天 00:10 是唤醒时刻
  const prev = new Date();
  prev.setDate(prev.getDate() - 1);
  prev.setHours(23, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 10, 0, 0);
  const { due } = collectDueAlarms([a], {}, prev, now);
  assert.equal(due.length, 1);
});

test('补触发：已触发过的闹钟不重复触发', () => {
  const a = alarm({ id: 3, time: '08:00' });
  const first = collectDueAlarms([a], {}, at(7, 50), at(8, 5));
  assert.equal(first.due.length, 1);
  // 同一时间窗再次检查：lastFired 已标记，不重复
  const second = collectDueAlarms(first.alarms, first.lastFired, at(7, 50), at(8, 5));
  assert.equal(second.due.length, 0);
});

test('补触发：重复闹钟触发后保持启用', () => {
  const a = alarm({ id: 4, time: '08:00', repeat: true });
  const { due, alarms } = collectDueAlarms([a], {}, at(7, 50), at(8, 5));
  assert.equal(due.length, 1);
  assert.equal(alarms[0].enabled, true);
});

test('补触发：停用的闹钟不触发', () => {
  const a = alarm({ id: 5, time: '08:00', enabled: false });
  const { due } = collectDueAlarms([a], {}, at(7, 50), at(8, 5));
  assert.equal(due.length, 0);
});
