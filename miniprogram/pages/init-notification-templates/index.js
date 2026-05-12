// 临时页面，用于初始化通知模板数据
Page({
  data: {
    loading: false,
    result: null
  },

  onLoad() {
    this.initNotificationTemplates();
  },

  initNotificationTemplates() {
    this.setData({ loading: true, result: null });

    wx.cloud.callFunction({
      name: 'initNotificationTemplates',
      data: {},
      success: res => {
        console.log('初始化通知模板成功:', res.result);
        this.setData({
          loading: false,
          result: res.result
        });
      },
      fail: err => {
        console.error('初始化通知模板失败:', err);
        this.setData({
          loading: false,
          result: {
            success: false,
            error: err.message
          }
        });
      }
    });
  },

  onUnload() {
    // 页面卸载时清理
  }
});