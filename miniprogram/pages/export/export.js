const { today, callGrade, errorMessage } = require('../../utils/grade');

function monthStart() { return today().slice(0, 7) + '-01'; }

Page({
  data: { startDate: monthStart(), endDate: today(), records: [], recordCount: 0, scoreCount: 0, queried: false, loading: false, exporting: false, filePath: '', fileName: '' },
  onStartChange(event) { this.setData({ startDate: event.detail.value, queried: false, records: [], recordCount: 0, scoreCount: 0, filePath: '', fileName: '' }); },
  onEndChange(event) { this.setData({ endDate: event.detail.value, queried: false, records: [], recordCount: 0, scoreCount: 0, filePath: '', fileName: '' }); },
  async query() {
    if (this.data.startDate > this.data.endDate) return wx.showToast({ title: '起始日期不能晚于截止日期', icon: 'none' });
    this.setData({ loading: true, queried: false, records: [], filePath: '', fileName: '' });
    try {
      const data = await callGrade('listRecords', { startDate: this.data.startDate, endDate: this.data.endDate });
      const records = (data.records || []).map(record => ({
        _id: record._id, date: record.date, subject: record.subject, content: record.content || '', expanded: false, detailHeight: 0,
        scores: record.scores.filter(row => row.score !== null && row.score !== '').map(row => ({ studentNo: row.studentNo, score: row.score }))
      }));
      this.setData({ records, recordCount: records.length, scoreCount: records.reduce((sum, record) => sum + record.scores.length, 0), queried: true });
    } catch (error) {
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
  async exportFile() {
    if (this.data.exporting || !this.data.records.length) return;
    this.setData({ exporting: true });
    wx.showLoading({ title: '正在生成 Excel…', mask: true });
    try {
      const result = await callGrade('exportRecords', { startDate: this.data.startDate, endDate: this.data.endDate });
      const downloaded = await wx.cloud.downloadFile({ fileID: result.fileID });
      const fileName = result.fileName || `成绩表_${this.data.startDate}_至_${this.data.endDate}.xlsx`;
      this.setData({ filePath: downloaded.tempFilePath, fileName });
      wx.hideLoading();
      wx.showActionSheet({ itemList: ['预览 Excel', '保存到小程序', '分享文件'], success: choice => {
        if (choice.tapIndex === 0) this.preview();
        else if (choice.tapIndex === 1) this.saveLocal();
        else this.share();
      }});
    } catch (error) {
      wx.hideLoading();
      if (error.code !== 'CLASS_REQUIRED') wx.showModal({ title: '导出失败', content: errorMessage(error), showCancel: false });
    } finally {
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
