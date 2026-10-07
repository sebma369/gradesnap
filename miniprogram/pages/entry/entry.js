const { callGrade, errorMessage, resolveSelectedClass, setSelectedClassId } = require('../../utils/grade');

Page({
  data: {
    loading: true, saving: false, classes: [], classListHeight: 0, selectedClassIds: [], loadError: ''
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
      if (session.registered) {
        resolveSelectedClass(session.classes);
        return this.goHome();
      }
      const classes = session.classes || [];
      this.setData({ classes, classListHeight: Math.min(classes.length * 100, 500), selectedClassIds: [], loading: false });
    } catch (error) {
      this.setData({
        classes: [], classListHeight: 0, selectedClassIds: [], loading: false, loadError: errorMessage(error)
      });
    }
  },

  onClassChange(event) {
    if (this.data.saving) return;
    this.setData({ selectedClassIds: event.detail.value });
  },

  async joinClass() {
    if (this.data.loading || this.data.saving) return;
    const selected = this.data.classes.filter(item => this.data.selectedClassIds.includes(item.classId));
    if (!selected.length) return wx.showToast({ title: '请先选择班级', icon: 'none' });
    const confirmed = await new Promise(resolve => wx.showModal({
      title: '确认所属班级',
      content: `确定加入${selected.map(item => `“${item.className}”`).join('、')}吗？后续仅可在已选班级之间切换。`,
      confirmText: '确认加入', cancelText: '返回',
      success: result => resolve(result.confirm), fail: () => resolve(false)
    }));
    if (!confirmed) return;
    this.setData({ saving: true });
    try {
      await callGrade('joinClasses', { classIds: selected.map(item => item.classId) });
      setSelectedClassId(selected[0].classId);
      this.goHome();
    } catch (error) {
      wx.showModal({ title: '加入班级失败', content: errorMessage(error), showCancel: false });
      this.setData({ saving: false });
    }
  }
});
