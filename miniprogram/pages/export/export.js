const { today, callGrade, errorMessage, getSelectedClassId, setSelectedClassId } = require('../../utils/grade');

function monthStart() { return today().slice(0, 7) + '-01'; }

Page({
  data: { startDate: monthStart(), endDate: today(), classId: '', className: '', classManagementEnabled: false, classReady: false, records: [], recordCount: 0, scoreCount: 0, queried: false, loading: false, exporting: false, deletingId: '', filePath: '', fileName: '' },
  onShow() {
    const classId = getSelectedClassId();
    if (this.data.classId !== classId) this.setData({
      classId, className: '', classReady: false, records: [], recordCount: 0,
      scoreCount: 0, queried: false, loading: false, deletingId: '', filePath: '', fileName: ''
    });
    return this.loadClass();
  },
  async loadClass() {
    const requestId = this.classRequestId = (this.classRequestId || 0) + 1;
    const classId = getSelectedClassId();
    this.setData({ classReady: false, classManagementEnabled: false });
    try {
      const settings = await callGrade('getSettings');
      if (requestId !== this.classRequestId) return;
      const enabled = settings.classManagementEnabled !== false;
      if (!enabled) setSelectedClassId(settings.classId);
      else if (classId !== getSelectedClassId()) return;
      if (this.data.classId && this.data.classId !== settings.classId) this.setData({
        records: [], recordCount: 0, scoreCount: 0, queried: false,
        filePath: '', fileName: '', deletingId: ''
      });
      this.setData({ classId: settings.classId, className: settings.className, classManagementEnabled: enabled, classReady: true });
    } catch (error) {
      if (requestId !== this.classRequestId || classId !== getSelectedClassId()) return;
      this.setData({ className: '', classReady: false });
      if (error.code !== 'CLASS_REQUIRED') wx.showToast({ title: '班级读取失败，请重试', icon: 'none' });
    }
  },
  onStartChange(event) { this.setData({ startDate: event.detail.value, queried: false, records: [], recordCount: 0, scoreCount: 0, filePath: '', fileName: '' }); },
  onEndChange(event) { this.setData({ endDate: event.detail.value, queried: false, records: [], recordCount: 0, scoreCount: 0, filePath: '', fileName: '' }); },
  async query() {
    if (!this.data.classReady || this.data.deletingId || this.data.classId !== getSelectedClassId()) return;
    if (this.data.startDate > this.data.endDate) return wx.showToast({ title: '起始日期不能晚于截止日期', icon: 'none' });
    this.setData({ loading: true, queried: false, records: [], filePath: '', fileName: '' });
    const classId = this.data.classId;
    try {
      const data = await callGrade('listRecords', { startDate: this.data.startDate, endDate: this.data.endDate });
      if (classId !== getSelectedClassId()) return;
      const records = (data.records || []).map(record => ({
        _id: record._id, date: record.date, subject: record.subject, content: record.content || '', expanded: false, detailHeight: 0,
        scores: record.scores.filter(row => row.score !== null && row.score !== '').map(row => ({ studentNo: row.studentNo, score: row.score }))
      }));
      this.setData({ records, recordCount: records.length, scoreCount: records.reduce((sum, record) => sum + record.scores.length, 0), queried: true });
    } catch (error) {
      if (classId !== getSelectedClassId()) return;
      if (error.code !== 'CLASS_REQUIRED') wx.showModal({ title: '查询失败', content: errorMessage(error), showCancel: false });
    } finally {
      this.setData({ loading: false });
    }
  },
  toggleRecord(event) {
    const index = Number(event.currentTarget.dataset.index);
    const record = this.data.records[index];
    if (!Number.isInteger(index) || !record) return;
    if (record.expanded) {
      this.setData({ [`records[${index}].expanded`]: false, [`records[${index}].detailHeight`]: 0 });
      return;
    }
    this.setData({ [`records[${index}].expanded`]: true });
    wx.createSelectorQuery().select(`#score-detail-${index}`).boundingClientRect(rect => {
      const current = this.data.records[index];
      if (!rect || !current || current._id !== record._id || !current.expanded) return;
      this.setData({ [`records[${index}].detailHeight`]: rect.height });
    }).exec();
  },
  async deleteRecord(event) {
    if (this.data.loading || this.data.exporting || this.data.deletingId || !this.data.classReady || this.data.classId !== getSelectedClassId()) return;
    const recordId = event.currentTarget.dataset.id;
    const record = this.data.records.find(item => item._id === recordId);
    if (!record) return;
    const confirmed = await new Promise(resolve => wx.showModal({
      title: '删除成绩记录',
      content: `确定删除“${this.data.className || this.data.classId}”的 ${record.date} ${record.subject}${record.content ? `（${record.content}）` : ''} 成绩记录吗？删除后无法恢复。`,
      confirmText: '删除', confirmColor: '#d45b5b', cancelText: '返回',
      success: result => resolve(result.confirm), fail: () => resolve(false)
    }));
    const classId = this.data.classId;
    if (!confirmed || classId !== getSelectedClassId() || !this.data.records.some(item => item._id === recordId)) return;
    this.setData({ deletingId: recordId });
    wx.showLoading({ title: '正在删除…', mask: true });
    try {
      await callGrade('deleteRecord', { recordId });
      if (classId !== getSelectedClassId()) return;
      const records = this.data.records.filter(item => item._id !== recordId);
      this.setData({
        records, recordCount: records.length,
        scoreCount: records.reduce((sum, item) => sum + item.scores.length, 0),
        filePath: '', fileName: ''
      });
      wx.showToast({ title: '记录已删除', icon: 'success' });
    } catch (error) {
      if (classId !== getSelectedClassId()) return;
      wx.showModal({ title: '删除失败', content: errorMessage(error), showCancel: false });
    } finally {
      wx.hideLoading();
      this.setData({ deletingId: '' });
    }
  },
  async exportFile() {
    if (this.data.exporting || this.data.deletingId || !this.data.classReady || this.data.classId !== getSelectedClassId() || !this.data.records.length) return;
    const classId = this.data.classId;
    this.setData({ exporting: true });
    wx.showLoading({ title: '正在生成 Excel…', mask: true });
    try {
      const result = await callGrade('exportRecords', { startDate: this.data.startDate, endDate: this.data.endDate });
      if (classId !== getSelectedClassId()) return;
      const downloaded = await wx.cloud.downloadFile({ fileID: result.fileID });
      if (classId !== getSelectedClassId()) return;
      const fileName = result.fileName || `成绩表_${this.data.startDate}_至_${this.data.endDate}.xlsx`;
      this.setData({ filePath: downloaded.tempFilePath, fileName });
      wx.hideLoading();
      wx.showActionSheet({ itemList: ['预览 Excel', '保存到小程序', '分享文件'], success: choice => {
        if (choice.tapIndex === 0) this.preview();
        else if (choice.tapIndex === 1) this.saveLocal();
        else this.share();
      }});
    } catch (error) {
      if (classId !== getSelectedClassId()) return;
      if (error.code !== 'CLASS_REQUIRED') wx.showModal({ title: '导出失败', content: errorMessage(error), showCancel: false });
    } finally {
      wx.hideLoading();
      this.setData({ exporting: false });
    }
  },
  preview() {
    wx.openDocument({ filePath: this.data.filePath, fileType: 'xlsx', showMenu: true,
      fail: error => wx.showModal({ title: '预览失败', content: errorMessage(error), showCancel: false }) });
  },
  saveLocal() {
    wx.saveFile({ tempFilePath: this.data.filePath, filePath: `${wx.env.USER_DATA_PATH}/${this.data.fileName}`,
      success: result => {
        this.setData({ filePath: result.savedFilePath });
        wx.showModal({ title: '已保存到小程序', content: '文件已保存。打开预览后，可通过右上角菜单转存或发送到微信聊天。', showCancel: false,
          success: () => this.preview() });
      },
      fail: error => wx.showModal({ title: '保存失败', content: errorMessage(error), showCancel: false })
    });
  },
  share() {
    if (typeof wx.shareFileMessage !== 'function') return this.preview();
    wx.shareFileMessage({ filePath: this.data.filePath, fileName: this.data.fileName,
      fail: error => { if (!String(error.errMsg || '').includes('cancel')) wx.showModal({ title: '分享失败', content: errorMessage(error), showCancel: false }); } });
  }
});
