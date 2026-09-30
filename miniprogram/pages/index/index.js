const { DEFAULT_CLASS_SIZE, today, rowsForSize, errorMessage, callGrade } = require('../../utils/grade');

Page({
  data: {
    date: today(), subject: '', classSize: DEFAULT_CLASS_SIZE,
    scores: rowsForSize(DEFAULT_CLASS_SIZE), imageFileID: '', imagePath: '',
    busy: false, busyText: '', recognized: false
  },

  onShow() {
    const cached = Number(wx.getStorageSync('classSize')) || DEFAULT_CLASS_SIZE;
    this.applyClassSize(cached);
    this.loadSettings();
  },

  async loadSettings() {
    try {
      const settings = await callGrade('getSettings');
      const size = settings.classSize || DEFAULT_CLASS_SIZE;
      wx.setStorageSync('classSize', size);
      this.applyClassSize(size);
    } catch (error) {
      wx.showToast({ title: '云端设置读取失败，暂用本地缓存', icon: 'none' });
    }
  },

  applyClassSize(size) {
    if (size < 1 || size > 200 || size === this.data.classSize) return;
    this.setData({ classSize: size, scores: rowsForSize(size, this.data.scores) });
  },

  chooseImage() {
    if (this.data.busy) return;
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: result => this.pickImage(result.tapIndex === 0 ? 'camera' : 'album')
    });
  },

  async pickImage(sourceType) {
    try {
      const media = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: [sourceType], sizeType: ['compressed'] });
      const path = media.tempFiles[0].tempFilePath;
      const extension = (path.match(/\.(jpe?g|png|webp)$/i) || [,'jpg'])[1].toLowerCase();
      this.setData({ busy: true, busyText: '正在上传成绩表…', recognized: false, imageFileID: '', imagePath: path });
      const upload = await wx.cloud.uploadFile({ cloudPath: `score-sheets/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`, filePath: path });
      this.setData({ imageFileID: upload.fileID, imagePath: path, busyText: '正在识别成绩表…' });
      const result = await callGrade('recognize', { imageFileID: upload.fileID });
      const recognized = (result.scores || []).map(row => ({ studentNo: String(row.studentNo).padStart(2, '0'), score: row.score }));
      this.setData({
        date: result.date || this.data.date,
        subject: result.subject || this.data.subject,
        scores: rowsForSize(this.data.classSize, recognized), recognized: true
      });
      if (recognized.some(row => row.score !== null && row.score !== '')) {
        wx.showToast({ title: '识别完成，请核对', icon: 'success' });
      } else {
        wx.showModal({ title: '未识别到成绩', content: '请查看原图并手动填写成绩后保存。', showCancel: false });
      }
    } catch (error) {
      if (!String(error.errMsg || '').includes('cancel')) {
        const hint = this.data.imageFileID ? '图片已保留，您仍可手动填写。' : '图片尚未保存到云端，手动录入不会关联图片；也可重新选择图片。';
        wx.showModal({ title: '识别未完成', content: `${errorMessage(error)}。${hint}`, showCancel: false });
      }
    } finally {
      this.setData({ busy: false, busyText: '' });
    }
  },

  onDateChange(event) { this.setData({ date: event.detail.value }); },
  onSubjectInput(event) { this.setData({ subject: event.detail.value }); },
  onScoreInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ [`scores[${index}].score`]: event.detail.value });
  },
  previewImage() {
    if (this.data.imagePath) wx.previewImage({ urls: [this.data.imagePath] });
  },

  async save() {
    if (this.data.busy) return;
    const subject = this.data.subject.trim();
    if (!subject) return wx.showToast({ title: '请填写科目', icon: 'none' });
    const invalid = this.data.scores.find(row => row.score !== '' && !/^(?:\d+)(?:\.\d+)?$/.test(String(row.score)));
    if (invalid) return wx.showToast({ title: `请检查学号 ${invalid.studentNo} 的成绩`, icon: 'none' });
    const filled = this.data.scores.filter(row => row.score !== '').length;
    if (!filled) return wx.showToast({ title: '请至少填写一位学生的成绩', icon: 'none' });
    this.setData({ busy: true, busyText: '正在保存成绩…' });
    try {
      await callGrade('saveRecord', {
        date: this.data.date, subject,
        scores: this.data.scores.map(row => ({ studentNo: row.studentNo, score: row.score === '' ? null : Number(row.score) })),
        imageFileID: this.data.imageFileID
      });
      this.setData({ subject: '', scores: rowsForSize(this.data.classSize), imageFileID: '', imagePath: '', recognized: false });
      wx.showModal({ title: '保存成功', content: '本次成绩已保存到云端，可在“导出”页查询。', showCancel: false });
    } catch (error) {
      wx.showModal({ title: '保存失败', content: errorMessage(error), showCancel: false });
    } finally {
      this.setData({ busy: false, busyText: '' });
    }
  }
});
