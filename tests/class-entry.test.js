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

test('new user chooses a server class and confirms the one-time binding', async () => {
  const calls = [];
  global.wx = {
    cloud: { callFunction: async options => {
      calls.push(options.data);
      return { result: { ok: true, data: options.data.action === 'getSession'
        ? { registered: false, classes: [{ classId: 'class_a', className: '一班' }] }
        : { registered: true, classId: 'class_a', className: '一班' } } };
    } },
    showModal: options => options.success({ confirm: true }),
    switchTab: options => calls.push(options),
    showToast() {}
  };
  const instance = page();
  await instance.loadSession();
  assert.equal(instance.data.classes[0].className, '一班');
  instance.onClassChange({ detail: { value: '0' } });
  assert.equal(instance.data.selectedClassName, '一班');
  assert.equal(instance.data.selectedClassIndex, 0);
  await instance.joinClass();
  assert.equal(calls[1].action, 'joinClass');
  assert.equal(calls[1].classId, 'class_a');
  assert.equal(calls[2].url, '/pages/index/index');
});

test('class picker ignores invalid indexes', () => {
  const instance = page();
  instance.setData({ classes: [{ classId: 'class_a', className: '一班' }] });
  instance.onClassChange({ detail: { value: '1' } });
  assert.equal(instance.data.selectedClassId, '');
  instance.onClassChange({ detail: { value: '0' } });
  assert.equal(instance.data.selectedClassId, 'class_a');
});

test('returning user enters without choosing again', async () => {
  const calls = [];
  global.wx = {
    cloud: { callFunction: async () => ({ result: { ok: true, data: { registered: true, classId: 'class_a', className: '一班' } } }) },
    switchTab: options => calls.push(options)
  };
  await page().loadSession();
  assert.deepEqual(calls.map(item => item.url), ['/pages/index/index']);
});
