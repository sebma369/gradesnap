const assert = require('node:assert/strict');
const { test } = require('node:test');

let definition;
global.Page = page => { definition = page; };
require('../miniprogram/pages/entry/entry');

function page() {
  return {
    ...definition,
    data: { ...definition.data },
    setData(changes) { Object.assign(this.data, changes); }
  };
}

test('new user chooses multiple server classes and saves the first current class locally', async () => {
  const calls = [];
  const storage = {};
  global.wx = {
    cloud: { callFunction: async options => {
      calls.push(options.data);
      return { result: { ok: true, data: options.data.action === 'getSession'
        ? { registered: false, classes: [{ classId: 'class_a', className: '一班' }, { classId: 'class_b', className: '二班' }] }
        : { registered: true, classes: [{ classId: 'class_a', className: '一班' }, { classId: 'class_b', className: '二班' }] } } };
    } },
    getStorageSync: key => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; },
    showModal: options => options.success({ confirm: true }),
    switchTab: options => calls.push(options),
    showToast() {}
  };
  const instance = page();
  await instance.loadSession();
  assert.equal(instance.data.classes[0].className, '一班');
  instance.onClassChange({ detail: { value: ['class_a', 'class_b'] } });
  assert.deepEqual(instance.data.selectedClassIds, ['class_a', 'class_b']);
  await instance.joinClass();
  assert.equal(calls[1].action, 'joinClasses');
  assert.deepEqual(calls[1].classIds, ['class_a', 'class_b']);
  assert.equal(storage.selectedClassId, 'class_a');
  assert.equal(calls[2].url, '/pages/index/index');
});

test('returning user keeps an authorized local class or falls back to the first', async () => {
  const calls = [];
  const storage = { selectedClassId: 'removed_class' };
  global.wx = {
    cloud: { callFunction: async () => ({ result: { ok: true, data: { registered: true, classes: [{ classId: 'class_a', className: '一班' }, { classId: 'class_b', className: '二班' }] } } }) },
    getStorageSync: key => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; },
    switchTab: options => calls.push(options)
  };
  await page().loadSession();
  assert.equal(storage.selectedClassId, 'class_a');
  storage.selectedClassId = 'class_b';
  await page().loadSession();
  assert.equal(storage.selectedClassId, 'class_b');
  assert.deepEqual(calls.map(item => item.url), ['/pages/index/index', '/pages/index/index']);
});
