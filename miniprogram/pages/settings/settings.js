const { DEFAULT_CLASS_SIZE, MAX_CLASS_SIZE, callGrade, errorMessage } = require('../../utils/grade');
const MAX_SUBJECTS = 50;

Page({
  data: { classSize: String(DEFAULT_CLASS_SIZE), subjects: [], subjectDraft: '', saving: false },
  onShow() {
    const cachedSubjects = wx.getStorageSync('subjects');
    this.setData({
      classSize: String(wx.getStorageSync('classSize') || DEFAULT_CLASS_SIZE),
      subjects: Array.isArray(cachedSubjects) ? cachedSubjects : [],
      subjectDraft: ''
    });
    this.load();
  },
  async load() {
    const editVersion = this.editVersion || 0;
    try {
      const data = await callGrade('getSettings');
      const subjects = Array.isArray(data.subjects) ? data.subjects : [];
      if ((this.editVersion || 0) !== editVersion || this.data.saving) return;
      wx.setStorageSync('classSize', data.classSize);
      wx.setStorageSync('subjects', subjects);
      this.setData({ classSize: String(data.classSize), subjects });
    } catch (error) {
      wx.showToast({ title: '云端设置读取失败，暂用本地缓存', icon: 'none' });
    }
  },
  onSizeInput(event) {
    this.editVersion = (this.editVersion || 0) + 1;
    this.setData({ classSize: event.detail.value });
  },
  onSubjectInput(event) {
    this.editVersion = (this.editVersion || 0) + 1;
    this.setData({ subjectDraft: event.detail.value });
  },
  onAddSubject() {
    const name = this.data.subjectDraft.trim();
    if (!name) return wx.showToast({ title: '请输入科目名称', icon: 'none' });
    if (this.data.subjects.includes(name)) return wx.showToast({ title: '该科目已存在', icon: 'none' });
    if (this.data.subjects.length >= MAX_SUBJECTS) return wx.showToast({ title: `最多设置 ${MAX_SUBJECTS} 个科目`, icon: 'none' });
    this.editVersion = (this.editVersion || 0) + 1;
    this.setData({ subjects: [...this.data.subjects, name], subjectDraft: '' });
  },
  onRemoveSubject(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.subjects.length) return;
    this.editVersion = (this.editVersion || 0) + 1;
    this.setData({ subjects: this.data.subjects.filter((_, i) => i !== index) });
  },
  async save() {
    if (this.data.saving) return;
    const size = Number(this.data.classSize);
    if (!Number.isInteger(size) || size < 1 || size > MAX_CLASS_SIZE) {
      return wx.showToast({ title: `请输入 1–${MAX_CLASS_SIZE} 的整数`, icon: 'none' });
    }
    const subjects = [...this.data.subjects];
    const draft = this.data.subjectDraft.trim();
    if (draft) {
      if (subjects.includes(draft)) return wx.showToast({ title: '该科目已存在', icon: 'none' });
      subjects.push(draft);
    }
    if (subjects.length > MAX_SUBJECTS) return wx.showToast({ title: `最多设置 ${MAX_SUBJECTS} 个科目`, icon: 'none' });
    this.setData({ saving: true });
    try {
      await callGrade('saveSettings', { classSize: size, subjects });
      wx.setStorageSync('classSize', size);
      wx.setStorageSync('subjects', subjects);
      this.editVersion = (this.editVersion || 0) + 1;
      this.setData({ subjects, subjectDraft: '' });
      wx.showToast({ title: '设置已保存', icon: 'success' });
    } catch (error) {
      wx.showModal({ title: '保存失败', content: errorMessage(error), showCancel: false });
    } finally {
      this.setData({ saving: false });
    }
  }
});
