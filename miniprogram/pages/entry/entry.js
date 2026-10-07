const { callGrade, errorMessage } = require('../../utils/grade');

Page({
  data: {
    loading: true, saving: false, classes: [], selectedClassId: '',
    selectedClassIndex: -1, selectedClassName: '', loadError: ''
  },

  onLoad() { this.loadSession(); },

  goHome() {
    wx.switchTab({
      url: '/pages/index/index',
      fail: error => this.setData({ loading: false, saving: false, loadError: errorMessage(error) })
    });
  },

  async loadSession() {
    if (this.data.saving) return;
    this.setData({ loading: true, loadError: '' });
    try {
      const session = await callGrade('getSession');
      if (session.registered) return this.goHome();
      this.setData({
        classes: session.classes || [], selectedClassId: '', selectedClassIndex: -1,
        selectedClassName: '', loading: false
      });
    } catch (error) {
      this.setData({
        classes: [], selectedClassId: '', selectedClassIndex: -1,
        selectedClassName: '', loading: false, loadError: errorMessage(error)
      });
    }
  },

  onClassChange(event) {
    if (this.data.saving) return;
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.classes.length) return;
    const selected = this.data.classes[index];
    this.setData({
      selectedClassIndex: index, selectedClassId: selected.classId,
      selectedClassName: selected.className
    });
  },

  async joinClass() {
    if (this.data.loading || this.data.saving) return;
    const selected = this.data.classes.find(item => item.classId === this.data.selectedClassId);
    if (!selected) return wx.showToast({ title: '请先选择班级', icon: 'none' });
    const confirmed = await new Promise(resolve => wx.showModal({
      title: '确认所属班级',
      content: `确定加入“${selected.className}”吗？后续将不再提供班级修改选项。`,
      confirmText: '确认加入', cancelText: '返回',
      success: result => resolve(result.confirm), fail: () => resolve(false)
    }));
    if (!confirmed) return;
    this.setData({ saving: true });
    try {
      await callGrade('joinClass', { classId: selected.classId });
      this.goHome();
    } catch (error) {
      wx.showModal({ title: '加入班级失败', content: errorMessage(error), showCancel: false });
      this.setData({ saving: false });
    }
  }
});
