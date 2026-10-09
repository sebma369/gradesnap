const { DEFAULT_CLASS_SIZE, MAX_CLASS_SIZE, callGrade, errorMessage, getSelectedClassId, setSelectedClassId, resolveSelectedClass } = require('../../utils/grade');
const MAX_SUBJECTS = 50;

Page({
  data: { classSize: String(DEFAULT_CLASS_SIZE), classId: '', className: '', classManagementEnabled: false, classes: [], selectedClassIndex: -1, userId: '', subjects: [], subjectDraft: '', saving: false, loading: false, settingsReady: false },
  onShow() {
    this.setData({ classSize: String(DEFAULT_CLASS_SIZE), classId: '', className: '', classManagementEnabled: false, classes: [], selectedClassIndex: -1, userId: '', subjects: [], subjectDraft: '', settingsReady: false });
    return this.load();
  },
  async load() {
    const requestId = this.settingsRequestId = (this.settingsRequestId || 0) + 1;
    this.setData({ loading: true, settingsReady: false });
    try {
      const session = await callGrade('getSession');
      if (requestId !== this.settingsRequestId) return;
      if (!session.registered) return wx.reLaunch({ url: '/pages/entry/entry' });
      const classes = session.classes || [];
      const enabled = session.classManagementEnabled !== false;
      const current = enabled ? resolveSelectedClass(classes) : classes.find(item => item.classId === session.defaultClassId);
      if (!current) throw new Error('没有可用班级，请联系管理员');
      if (!enabled) setSelectedClassId(current.classId);
      this.setData({ classManagementEnabled: enabled, classes, selectedClassIndex: classes.findIndex(item => item.classId === current.classId), classId: current.classId, className: current.className });
      const data = await callGrade('getSettings');
      const subjects = Array.isArray(data.subjects) ? data.subjects : [];
      if (requestId !== this.settingsRequestId || current.classId !== getSelectedClassId()) return;
      this.setData({ classSize: String(data.classSize), className: data.className || '', userId: data.userId || '', subjects, loading: false, settingsReady: true });
    } catch (error) {
      if (requestId !== this.settingsRequestId) return;
      this.setData({ userId: '', loading: false, settingsReady: false });
      if (error.code !== 'CLASS_REQUIRED') wx.showToast({ title: '云端设置读取失败，请重试', icon: 'none' });
    }
  },
  onClassChange(event) {
    if (!this.data.classManagementEnabled || this.data.loading || this.data.saving) return;
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.classes.length) return;
    const selected = this.data.classes[index];
    if (selected.classId === this.data.classId) return;
    try { setSelectedClassId(selected.classId); }
    catch (error) { return wx.showToast({ title: '班级切换失败，请重试', icon: 'none' }); }
    this.setData({
      classId: selected.classId, className: selected.className, selectedClassIndex: index,
      classSize: String(DEFAULT_CLASS_SIZE), subjects: [], subjectDraft: '', settingsReady: false
    });
    return this.load();
  },
  copyUserId() {
    if (!this.data.userId) return;
    wx.setClipboardData({
      data: this.data.userId,
      success: () => wx.showToast({ title: '用户 ID 已复制', icon: 'success' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' })
    });
  },
  onSizeInput(event) {
    if (!this.data.settingsReady) return;
    this.setData({ classSize: event.detail.value });
  },
  onSubjectInput(event) {
    if (!this.data.settingsReady) return;
    this.setData({ subjectDraft: event.detail.value });
  },
  onAddSubject() {
    if (!this.data.settingsReady) return;
    const name = this.data.subjectDraft.trim();
    if (!name) return wx.showToast({ title: '请输入科目名称', icon: 'none' });
    if (this.data.subjects.includes(name)) return wx.showToast({ title: '该科目已存在', icon: 'none' });
    if (this.data.subjects.length >= MAX_SUBJECTS) return wx.showToast({ title: `最多设置 ${MAX_SUBJECTS} 个科目`, icon: 'none' });
    this.setData({ subjects: [...this.data.subjects, name], subjectDraft: '' });
  },
  onRemoveSubject(event) {
    if (!this.data.settingsReady) return;
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.subjects.length) return;
    this.setData({ subjects: this.data.subjects.filter((_, i) => i !== index) });
  },
  async save() {
    if (this.data.saving || !this.data.settingsReady || this.data.classId !== getSelectedClassId()) return;
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
      this.setData({ subjects, subjectDraft: '' });
      wx.showToast({ title: '设置已保存', icon: 'success' });
    } catch (error) {
      wx.showModal({ title: '保存失败', content: errorMessage(error), showCancel: false });
    } finally {
      this.setData({ saving: false });
    }
  }
});
