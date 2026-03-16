// app.js
App({
  onLaunch() {
    // 全局云开发环境配置骨架
    this.globalData = {
      // env 参数说明：
      // env 决定 wx.cloud.xxx 调用会请求到哪个云环境
      // TODO: 将此处替换为实际云开发环境 ID，例如 "prod-xxxx"
      env: "cloud1-4gs2vu8c6544e586",
      openid: ''
    };

    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true
      });
    }

    // 获取用户openid
    this.getOpenid();
  },

  // 获取用户openid
  getOpenid() {
    try {
      wx.cloud.callFunction({
        name: 'login',
        data: {},
        success: res => {
          console.log('获取openid成功:', res.result.openid);
          this.globalData.openid = res.result.openid;
          wx.setStorageSync('openid', res.result.openid);
        },
        fail: err => {
          console.error('获取openid失败:', err);
          // 云函数调用失败，不设置默认值
          this.globalData.openid = '';
          wx.setStorageSync('openid', '');
        }
      });
    } catch (error) {
      console.error('调用云函数时发生错误:', error);
      // 发生错误时，不设置默认值
      this.globalData.openid = '';
      wx.setStorageSync('openid', '');
    }
  }
});
