// app.js
App({
  onLaunch() {
    // 全局云开发环境配置骨架
    this.globalData = {
      // env 参数说明：
      // env 决定 wx.cloud.xxx 调用会请求到哪个云环境
      // TODO: 将此处替换为实际云开发环境 ID，例如 "prod-xxxx"
      env: ""
    };

    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true
      });
    }
  }
});
