const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');

const tables = { classes: [], users: [], settings: [], scoreRecords: [] };
let openId = 'teacher-a';
let nextId = 1;
const uploads = [];

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function query(name, conditions = {}, options = {}) {
  return {
    where(next) { return query(name, { ...conditions, ...next }, options); },
    orderBy(field, direction) { return query(name, conditions, { ...options, order: [field, direction] }); },
    skip(offset) { return query(name, conditions, { ...options, offset }); },
    limit(max) { return query(name, conditions, { ...options, max }); },
    async get() {
      let rows = tables[name].filter(row => Object.entries(conditions).every(([key, expected]) => {
        const actual = row[key];
        if (expected && typeof expected === 'object' && '$gte' in expected) return actual >= expected.$gte && actual <= expected.$lte;
        return actual === expected;
      }));
      if (options.order) rows = rows.slice().sort((a, b) => {
        const [field, direction] = options.order;
        return String(a[field]).localeCompare(String(b[field])) * (direction === 'asc' ? 1 : -1);
      });
      return { data: clone(rows.slice(options.offset || 0, (options.offset || 0) + (options.max || 100))) };
    }
  };
}

const db = {
  command: { gte: lower => ({ and: upper => ({ $gte: lower, $lte: upper.value }) }), lte: value => ({ value }) },
  serverDate: () => new Date(),
  collection(name) {
    const base = query(name);
    return {
      ...base,
      doc(id) { return { async set({ data }) {
        const index = tables[name].findIndex(row => row._id === id);
        const row = { ...clone(data), _id: id };
        if (index < 0) tables[name].push(row);
        else tables[name][index] = row;
      } }; },
      async add({ data }) {
        const id = data._id || `record-${nextId++}`;
        if (tables[name].some(row => row._id === id)) throw new Error('duplicate document ID');
        tables[name].push({ ...clone(data), _id: id });
        return { _id: id };
      }
    };
  }
};

const cloud = {
  DYNAMIC_CURRENT_ENV: 'test', init() {}, database: () => db,
  getWXContext: () => ({ OPENID: openId }),
  uploadFile: async options => { uploads.push(options); return { fileID: `cloud://test/${options.cloudPath}` }; }
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'wx-server-sdk') return cloud;
  return originalLoad.call(this, request, parent, isMain);
};
const service = require('../cloudfunctions/gradeService');
Module._load = originalLoad;

function reset() {
  Object.keys(tables).forEach(name => { tables[name].length = 0; });
  tables.classes.push({ _id: 'class_a', name: '一班' }, { _id: 'class_b', name: '二班' }, { _id: 'closed', name: '停用班', active: false });
  uploads.length = 0;
  openId = 'teacher-a';
  nextId = 1;
}

async function call(action, data = {}) { return service.main({ action, ...data }); }

test('a new user sees selectable classes and cannot change class after joining', async () => {
  reset();
  const before = await call('getSession');
  assert.equal(before.data.registered, false);
  assert.deepEqual(before.data.classes.map(item => item.classId).sort(), ['class_a', 'class_b']);
  assert.equal((await call('joinClass', { classId: 'class_a' })).data.className, '一班');
  assert.equal((await call('getSession')).data.classId, 'class_a');
  const change = await call('joinClass', { classId: 'class_b' });
  assert.equal(change.ok, false);
  assert.match(change.message, /不能自行修改/);
  assert.equal(tables.users.length, 1);
  assert.equal(tables.users[0]._id, 'teacher-a');
});

test('new user can see classes beyond the first database page', async () => {
  reset();
  for (let index = 0; index < 120; index++) {
    tables.classes.push({ _id: `extra_${String(index).padStart(3, '0')}`, name: `班级 ${index}` });
  }
  const session = await call('getSession');
  assert.equal(session.data.classes.length, 122);
  assert.ok(session.data.classes.some(item => item.classId === 'extra_119'));
});

test('new user sees classes in order field order', async () => {
  reset();
  tables.classes[0].order = 20;
  tables.classes[1].order = 10;
  tables.classes.push(
    { _id: 'class_c', name: '三班', order: 10 },
    { _id: 'class_d', name: '四班' }
  );
  const session = await call('getSession');
  assert.deepEqual(session.data.classes.map(item => item.classId),
    ['class_b', 'class_c', 'class_a', 'class_d']);
});

test('settings, scores and exports stay inside the current user class', async () => {
  reset();
  await call('joinClass', { classId: 'class_a' });
  await call('saveSettings', { classSize: 2, subjects: ['数学'] });
  const saved = await call('saveRecord', {
    classId: 'class_b', date: '2026-10-07', subject: '数学', content: '练习',
    scores: [{ studentNo: '01', score: 95 }], imageFileID: ''
  });
  assert.equal(saved.ok, true);
  assert.equal(tables.scoreRecords[0].classId, 'class_a');
  assert.equal(tables.scoreRecords[0].createdByOpenId, 'teacher-a');
  openId = 'teacher-b';
  await call('joinClass', { classId: 'class_b' });
  const otherSettings = await call('getSettings', { classId: 'class_a' });
  assert.equal(otherSettings.data.classId, 'class_b');
  assert.equal(otherSettings.data.classSize, 30);
  assert.deepEqual(otherSettings.data.subjects, []);
  const otherRecords = await call('listRecords', { classId: 'class_a', startDate: '2026-10-01', endDate: '2026-10-31' });
  assert.deepEqual(otherRecords.data.records, []);
  await call('saveSettings', { classSize: 3, subjects: ['语文'] });
  openId = 'teacher-a';
  assert.equal((await call('getSettings')).data.classSize, 2);
  assert.equal((await call('listRecords', { startDate: '2026-10-01', endDate: '2026-10-31' })).data.records.length, 1);
  const exported = await call('exportRecords', { startDate: '2026-10-01', endDate: '2026-10-31' });
  assert.equal(exported.ok, true);
  assert.match(uploads[0].cloudPath, /^成绩导出\/class_a\//);
});

test('users in the same class share settings and records', async () => {
  reset();
  await call('joinClass', { classId: 'class_a' });
  await call('saveSettings', { classSize: 4, subjects: ['英语'] });
  await call('saveRecord', {
    date: '2026-10-07', subject: '英语', content: '听写',
    scores: [{ studentNo: '01', score: 8 }], imageFileID: ''
  });
  openId = 'teacher-c';
  await call('joinClass', { classId: 'class_a' });
  const settings = await call('getSettings');
  const records = await call('listRecords', { startDate: '2026-10-01', endDate: '2026-10-31' });
  assert.equal(settings.data.classSize, 4);
  assert.deepEqual(settings.data.subjects, ['英语']);
  assert.equal(records.data.records.length, 1);
});

test('image references from another class cannot be saved or recognized', async () => {
  reset();
  await call('joinClass', { classId: 'class_a' });
  const fileID = 'cloud://test/score-sheets/class_b/photo.jpg';
  const saved = await call('saveRecord', {
    date: '2026-10-07', subject: '数学', content: '练习',
    scores: [{ studentNo: '01', score: 9 }], imageFileID: fileID
  });
  const recognized = await call('recognize', { imageFileID: fileID });
  assert.equal(saved.ok, false);
  assert.equal(recognized.ok, false);
  assert.equal(tables.scoreRecords.length, 0);
});

test('unassigned users cannot read grades or save settings', async () => {
  reset();
  const records = await call('listRecords', { startDate: '2026-10-01', endDate: '2026-10-31' });
  assert.equal(records.code, 'CLASS_REQUIRED');
  const settings = await call('saveSettings', { classSize: 30, subjects: [] });
  assert.equal(settings.code, 'CLASS_REQUIRED');
});
