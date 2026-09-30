const { DEFAULT_CLASS_SIZE, MAX_CLASS_SIZE, callGrade, errorMessage } = require('../../utils/grade');

Page({
  data: { classSize: String(DEFAULT_CLASS_SIZE), saving: false },
  onShow() {
    this.setData({ classSize: String(wx.getStorageSync('classSize') || DEFAULT_CLASS_SIZE) });
    this.load();
  },
  async load() {
    try {
      const data = await callGrade('getSettings');
      if (data.classSize) {
        wx.setStorageSync('classSize', data.classSize);
        this.setData({ classSize: String(data.classSize) });
      }
    } catch (error) {
      wx.showToast({ title: '云端设置读取失败，暂用本地缓存', icon: 'none' });
    }
  },
  onSizeInput(event) { this.setData({ classSize: event.detail.value }); },
  async save() {
    const size = Number(this.data.classSize);
    if (!Number.isInteger(size) || size < 1 || size > MAX_CLASS_SIZE) {
      return wx.showToast({ title: `请输入 1–${MAX_CLASS_SIZE} 的整数`, icon: 'none' });
    }
    this.setData({ saving: true });
    try {
      await callGrade('saveSettings', { classSize: size });
      wx.setStorageSync('classSize', size);
      wx.showToast({ title: '班级人数已保存', icon: 'success' });
    } catch (error) {
      wx.showModal({ title: '保存失败', content: errorMessage(error), showCancel: false });
    } finally {
      this.setData({ saving: false });
    }
  }
});
