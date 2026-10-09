const assert = require('node:assert/strict');
const { test } = require('node:test');

let definition;
global.Page = page => { definition = page; };
require('../miniprogram/pages/settings/settings');
const settingsPage = definition;
require('../miniprogram/pages/index/index');
const indexPage = definition;
require('../miniprogram/pages/export/export');
const exportPage = definition;

function page(source) {
  return {
    ...source,
    data: { ...source.data },
    setData(changes) { Object.assign(this.data, changes); }
  };
}

test('switching an authorized class persists locally and reloads only that class data', async () => {
  const storage = { selectedClassId: 'class_a' };
  const calls = [];
  global.wx = {
    getStorageSync: key => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; },
    cloud: { callFunction: async ({ data }) => {
      calls.push(data);
      const result = data.action === 'getSession'
        ? { registered: true, classes: [{ classId: 'class_a', className: '一班' }, { classId: 'class_b', className: '二班' }] }
        : data.action === 'getSettings'
          ? { classId: data.classId, className: data.classId === 'class_a' ? '一班' : '二班', classSize: data.classId === 'class_a' ? 2 : 3, subjects: [data.classId === 'class_a' ? '数学' : '语文'], userId: 'teacher-a' }
          : data.action === 'listRecords' ? { records: [] } : {};
      return { result: { ok: true, data: result } };
    } },
    showToast() {}
  };

  const settings = page(settingsPage);
  await settings.onShow();
  assert.equal(settings.data.className, '一班');
  assert.equal(settings.data.classSize, '2');
  await settings.onClassChange({ detail: { value: '1' } });
  assert.equal(storage.selectedClassId, 'class_b');
  assert.equal(settings.data.className, '二班');
  assert.equal(settings.data.classSize, '3');
  assert.deepEqual(settings.data.subjects, ['语文']);

  const entry = page(indexPage);
  Object.assign(entry.data, {
    classId: 'class_a', className: '一班', content: '旧班内容',
    imageFileID: 'cloud://old', imagePath: '/tmp/old.jpg', scores: [{ studentNo: '01', score: '99', rawText: '99' }]
  });
  await entry.onShow();
  assert.equal(entry.data.className, '二班');
  assert.equal(entry.data.content, '');
  assert.equal(entry.data.imageFileID, '');
  assert.equal(entry.data.scores.length, 3);
  assert.ok(entry.data.scores.every(row => row.score === ''));

  const exports = page(exportPage);
  Object.assign(exports.data, { classId: 'class_a', className: '一班', records: [{ _id: 'old' }], recordCount: 1, queried: true, filePath: '/tmp/old.xlsx' });
  await exports.onShow();
  assert.equal(exports.data.className, '二班');
  assert.deepEqual(exports.data.records, []);
  assert.equal(exports.data.filePath, '');
  await exports.query();
  assert.equal(calls.findLast(call => call.action === 'listRecords').classId, 'class_b');
});

test('a confirmed delete removes only the chosen preview card', async () => {
  const storage = { selectedClassId: 'class_a' };
  const calls = [];
  const confirmations = [];
  let confirm = false;
  global.wx = {
    getStorageSync: key => storage[key],
    cloud: { callFunction: async ({ data }) => {
      calls.push(data);
      return { result: { ok: true, data: { id: data.recordId } } };
    } },
    showModal: options => { confirmations.push(options.content); options.success({ confirm }); },
    showLoading() {}, hideLoading() {}, showToast() {}
  };
  const exports = page(exportPage);
  Object.assign(exports.data, {
    classId: 'class_a', className: '一班', classReady: true, queried: true,
    records: [
      { _id: 'one', date: '2026-10-07', subject: '数学', content: '练习', scores: [{ studentNo: '01', score: 95 }] },
      { _id: 'two', date: '2026-10-07', subject: '语文', content: '', scores: [{ studentNo: '01', score: 88 }] }
    ],
    recordCount: 2, scoreCount: 2, filePath: '/tmp/old.xlsx'
  });
  await exports.deleteRecord({ currentTarget: { dataset: { id: 'one' } } });
  assert.equal(calls.length, 0);
  assert.match(confirmations[0], /一班.*2026-10-07.*数学/);
  confirm = true;
  await exports.deleteRecord({ currentTarget: { dataset: { id: 'one' } } });
  assert.deepEqual(calls[0], { action: 'deleteRecord', recordId: 'one', classId: 'class_a' });
  assert.deepEqual(exports.data.records.map(item => item._id), ['two']);
  assert.equal(exports.data.recordCount, 1);
  assert.equal(exports.data.scoreCount, 1);
  assert.equal(exports.data.filePath, '');
});

test('hidden class management restores 一班 from stale local selection on each page', async () => {
  const storage = { selectedClassId: 'class_b' };
  global.wx = {
    getStorageSync: key => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; },
    cloud: { callFunction: async ({ data }) => ({ result: { ok: true, data:
      data.action === 'getSession'
        ? { registered: true, classManagementEnabled: false, defaultClassId: 'class_a', classes: [{ classId: 'class_a', className: '一班' }] }
        : { classId: 'class_a', className: '一班', classManagementEnabled: false, classSize: 2, subjects: ['数学'], userId: 'teacher-a' }
    } }) },
    showToast() {}
  };
  const settings = page(settingsPage);
  await settings.onShow();
  assert.equal(storage.selectedClassId, 'class_a');
  assert.equal(settings.data.classManagementEnabled, false);
  assert.equal(settings.data.classId, 'class_a');
  storage.selectedClassId = 'class_b';

  const entry = page(indexPage);
  Object.assign(entry.data, { classId: 'class_b', className: '二班', content: '旧班内容', imageFileID: 'cloud://old' });
  await entry.onShow();
  assert.equal(storage.selectedClassId, 'class_a');
  assert.equal(entry.data.classId, 'class_a');
  assert.equal(entry.data.content, '');
  assert.equal(entry.data.imageFileID, '');
  assert.equal(entry.data.classManagementEnabled, false);
  storage.selectedClassId = 'class_b';

  const exports = page(exportPage);
  Object.assign(exports.data, { classId: 'class_b', records: [{ _id: 'old' }], recordCount: 1, queried: true });
  await exports.onShow();
  assert.equal(storage.selectedClassId, 'class_a');
  assert.equal(exports.data.classId, 'class_a');
  assert.deepEqual(exports.data.records, []);
  assert.equal(exports.data.classManagementEnabled, false);
});
