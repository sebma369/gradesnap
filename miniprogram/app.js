App({
  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({ title: '版本过低', content: '请更新微信后使用云开发功能。', showCancel: false });
      return;
    }
    // 多环境项目可在这里填入固定云环境 ID。
    this.globalData = { env: '' };
    const options = { traceUser: true };
    if (this.globalData.env) options.env = this.globalData.env;
    wx.cloud.init(options);
  },
  globalData: { env: '' }
});
