const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fitImage, initialCrop, adjustCrop, sourceRect } = require('../miniprogram/utils/image-crop');

let pageDefinition;
global.Page = definition => { pageDefinition = definition; };
require('../miniprogram/pages/index/index');
const indexDefinition = pageDefinition;
require('../miniprogram/pages/crop/crop');
const cropDefinition = pageDefinition;

function makePage(definition) {
  return {
    ...definition,
    data: { ...definition.data, settingsReady: true, subjects: ['数学'], classId: 'class_a' },
    setData(changes, callback) {
      Object.assign(this.data, changes);
      if (callback) callback();
    }
  };
}

function mockIndexWx(resultPath) {
  const calls = { upload: [], navigation: [], media: [], modal: [] };
  global.wx = {
    getStorageSync: () => 'class_a',
    chooseMedia: async options => {
      calls.media.push(options);
      return { tempFiles: [{ tempFilePath: '/tmp/photo.jpg' }] };
    },
    navigateTo: options => {
      calls.navigation.push(options.url);
      if (resultPath) options.events.cropDone({ tempFilePath: resultPath });
      else options.events.cropCancel();
    },
    cloud: {
      uploadFile: async options => {
        calls.upload.push(options);
        return { fileID: 'cloud://cropped' };
      },
      callFunction: async () => ({ result: { ok: true, data: {
        date: '2026-10-07', subject: '数学', content: '作业',
        scores: [{ studentNo: '01', score: 95, rawText: '95' }]
      } } })
    },
    showModal: options => calls.modal.push(options),
    showToast() {}
  };
  return calls;
}

test('camera selection uploads the freely cropped image', async () => {
  const calls = mockIndexWx('/tmp/cropped.jpg');
  const page = makePage(indexDefinition);
  await page.pickImage('camera');
  assert.deepEqual(calls.media[0].sourceType, ['camera']);
  assert.deepEqual(calls.media[0].sizeType, ['original']);
  assert.match(calls.navigation[0], /pages\/crop\/crop\?src=/);
  assert.equal(calls.upload[0].filePath, '/tmp/cropped.jpg');
  assert.match(calls.upload[0].cloudPath, /^score-sheets\/class_a\//);
  assert.equal(page.data.imagePath, '/tmp/cropped.jpg');
  assert.equal(page.data.scores[0].score, '95');
  assert.equal(page.data.selectingImage, false);
});

test('album selection can keep the original image', async () => {
  const calls = mockIndexWx('/tmp/photo.jpg');
  const page = makePage(indexDefinition);
  await page.pickImage('album');
  assert.deepEqual(calls.media[0].sourceType, ['album']);
  assert.equal(calls.upload[0].filePath, '/tmp/photo.jpg');
});

test('canceling the crop preserves the previous image and form', async () => {
  const calls = mockIndexWx('');
  const page = makePage(indexDefinition);
  Object.assign(page.data, { imagePath: '/tmp/previous.jpg', imageFileID: 'cloud://previous', subject: '数学', subjectIndex: 0 });
  await page.pickImage('camera');
  assert.equal(calls.upload.length, 0);
  assert.equal(calls.modal.length, 0);
  assert.equal(page.data.imagePath, '/tmp/previous.jpg');
  assert.equal(page.data.subject, '数学');
  assert.equal(page.data.selectingImage, false);
});

test('crop handles change width and height independently within the image', () => {
  const bounds = fitImage(400, 600, 2000, 3000);
  const start = initialCrop(bounds);
  const changed = adjustCrop(bounds, start, 'se', -70, -20);
  assert.notEqual(changed.width / changed.height, start.width / start.height);
  assert.ok(changed.left + changed.width <= bounds.left + bounds.width);
  assert.ok(changed.top + changed.height <= bounds.top + bounds.height);
  const moved = adjustCrop(bounds, changed, 'move', 1000, 1000);
  assert.ok(moved.left + moved.width <= bounds.left + bounds.width);
  assert.ok(moved.top + moved.height <= bounds.top + bounds.height);
  const pixels = sourceRect(bounds, moved, 2000, 3000);
  assert.ok(pixels.x + pixels.width <= 2000);
  assert.ok(pixels.y + pixels.height <= 3000);
});

test('dragging a corner updates the crop box on the page', () => {
  const page = makePage(cropDefinition);
  page.data.ready = true;
  page.imageBounds = { left: 0, top: 0, width: 200, height: 300 };
  page.cropRect = { left: 20, top: 30, width: 100, height: 120 };
  page.onTouchStart({ currentTarget: { dataset: { handle: 'se' } }, touches: [{ clientX: 120, clientY: 150 }] });
  page.onTouchMove({ touches: [{ clientX: 150, clientY: 160 }] });
  page.onTouchEnd();
  assert.equal(page.cropRect.width, 130);
  assert.equal(page.cropRect.height, 130);
  assert.match(page.data.cropStyle, /width:130px;height:130px/);
});

test('crop page draws the selected source pixels and returns a file', () => {
  const page = makePage(cropDefinition);
  const calls = { draw: [], exported: [], emitted: [] };
  page.source = '/tmp/photo.jpg';
  page.imageInfo = { width: 2000, height: 3000 };
  page.imageBounds = { left: 0, top: 0, width: 200, height: 300 };
  page.cropRect = { left: 20, top: 30, width: 100, height: 120 };
  page.data.ready = true;
  page.getOpenerEventChannel = () => ({ emit: (...args) => calls.emitted.push(args) });
  global.wx = {
    createCanvasContext: () => ({
      drawImage: (...args) => calls.draw.push(args),
      draw: (_, callback) => callback()
    }),
    canvasToTempFilePath: options => {
      calls.exported.push(options);
      options.success({ tempFilePath: '/tmp/result.jpg' });
    },
    navigateBack() {}
  };
  page.confirmCrop();
  assert.deepEqual(calls.draw[0], ['/tmp/photo.jpg', 200, 300, 1000, 1200, 0, 0, 1000, 1200]);
  assert.equal(calls.exported[0].fileType, 'jpg');
  assert.deepEqual(calls.emitted[0], ['cropDone', { tempFilePath: '/tmp/result.jpg' }]);
});
