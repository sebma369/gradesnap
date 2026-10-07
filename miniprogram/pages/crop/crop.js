const { fitImage, initialCrop, adjustCrop, sourceRect } = require('../../utils/image-crop');

function boxStyle(rect) {
  return `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
}

Page({
  data: {
    source: '', ready: false, exporting: false,
    imageStyle: '', cropStyle: '', canvasWidth: 1, canvasHeight: 1
  },

  onLoad(options) {
    this.source = decodeURIComponent(options.src || '');
    if (!this.source) return this.failAndLeave('没有找到待裁剪的图片');
    this.setData({ source: this.source });
    wx.getImageInfo({
      src: this.source,
      success: info => {
        if (!info.width || !info.height) return this.failAndLeave('无法读取图片尺寸');
        this.imageInfo = info;
        this.prepareCrop();
      },
      fail: () => this.failAndLeave('图片读取失败，请重新选择')
    });
  },

  onReady() {
    this.pageReady = true;
    this.prepareCrop();
  },

  onUnload() {
    if (!this.finished) this.getOpenerEventChannel().emit('cropCancel');
  },

  failAndLeave(message) {
    wx.showModal({ title: '无法裁剪图片', content: message, showCancel: false, success: () => wx.navigateBack() });
  },

  prepareCrop() {
    if (!this.pageReady || !this.imageInfo) return;
    wx.createSelectorQuery().select('.crop-stage').boundingClientRect(rect => {
      if (!rect || !rect.width || !rect.height) return this.failAndLeave('裁剪区域加载失败');
      this.imageBounds = fitImage(rect.width, rect.height, this.imageInfo.width, this.imageInfo.height);
      this.cropRect = initialCrop(this.imageBounds);
      this.setData({ ready: true, imageStyle: boxStyle(this.imageBounds), cropStyle: boxStyle(this.cropRect) });
    }).exec();
  },

  onTouchStart(event) {
    if (!this.data.ready || this.data.exporting || !event.touches.length) return;
    const touch = event.touches[0];
    this.gesture = {
      handle: event.currentTarget.dataset.handle || 'move',
      x: touch.clientX, y: touch.clientY,
      rect: { ...this.cropRect }
    };
  },

  onTouchMove(event) {
    if (!this.gesture || !event.touches.length) return;
    const touch = event.touches[0];
    this.cropRect = adjustCrop(
      this.imageBounds, this.gesture.rect, this.gesture.handle,
      touch.clientX - this.gesture.x, touch.clientY - this.gesture.y
    );
    this.setData({ cropStyle: boxStyle(this.cropRect) });
  },

  onTouchEnd() { this.gesture = null; },

  resetCrop() {
    if (!this.data.ready || this.data.exporting) return;
    this.cropRect = initialCrop(this.imageBounds);
    this.setData({ cropStyle: boxStyle(this.cropRect) });
  },

  cancelCrop() {
    if (!this.data.exporting) wx.navigateBack();
  },

  useOriginal() {
    if (!this.data.exporting) this.finish(this.source);
  },

  finish(path) {
    this.finished = true;
    this.getOpenerEventChannel().emit('cropDone', { tempFilePath: path });
    wx.navigateBack();
  },

  confirmCrop() {
    if (!this.data.ready || this.data.exporting) return;
    const source = sourceRect(this.imageBounds, this.cropRect, this.imageInfo.width, this.imageInfo.height);
    const shrink = Math.min(1, 3000 / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * shrink));
    const height = Math.max(1, Math.round(source.height * shrink));
    this.setData({ exporting: true, canvasWidth: width, canvasHeight: height }, () => {
      const context = wx.createCanvasContext('cropCanvas', this);
      context.drawImage(this.source, source.x, source.y, source.width, source.height, 0, 0, width, height);
      context.draw(false, () => wx.canvasToTempFilePath({
        canvasId: 'cropCanvas', x: 0, y: 0, width, height,
        destWidth: width, destHeight: height, fileType: 'jpg', quality: 0.95,
        success: result => this.finish(result.tempFilePath),
        fail: error => {
          this.setData({ exporting: false });
          wx.showModal({ title: '裁剪失败', content: error.errMsg || '请调整选区后重试', showCancel: false });
        }
      }, this));
    });
  }
});
