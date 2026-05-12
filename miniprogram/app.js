// app.js
App({
  onLaunch() {
    // 全局云开发环境配置骨架
    this.globalData = {
      // env 参数说明：
      // env 决定 wx.cloud.xxx 调用会请求到哪个云环境
      // TODO: 将此处替换为实际云开发环境 ID，例如 "prod-xxxx"
      env: "cloud1-4gs2vu8c6544e586",
      openid: '',
      // 商品数据是否需要刷新标记
      productsNeedRefresh: false
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
          
          // 检查是否有欢迎消息，如果没有则创建
          this.checkWelcomeMessage(res.result.openid);
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
  },
  
  // 检查是否有欢迎消息，如果没有则创建
  checkWelcomeMessage(openid) {
    try {
      const db = wx.cloud.database();
      db.collection('notifications')
        .where({
          openid: openid,
          type: 'welcome'
        })
        .get({
          success: res => {
            console.log('查询欢迎消息结果:', res.data);
            if (res.data.length === 0) {
              // 没有欢迎消息，创建一条
              console.log('创建欢迎消息');
              const welcomeMessage = {
                _id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                openid: openid,
                title: '欢迎使用小程序',
                content: '欢迎来到我们的小程序！这里有丰富的商品和优质的服务，祝您购物愉快！',
                type: 'welcome',
                status: 'unread',
                createTime: new Date()
              };
              
              db.collection('notifications').add({
                data: welcomeMessage,
                success: addRes => {
                  console.log('创建欢迎消息成功:', addRes);
                },
                fail: addErr => {
                  console.error('创建欢迎消息失败:', addErr);
                }
              });
            }
          },
          fail: err => {
            console.error('查询欢迎消息失败:', err);
          }
        });
    } catch (error) {
      console.error('检查欢迎消息时发生错误:', error);
    }
  }
});
