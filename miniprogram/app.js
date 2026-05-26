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
      productsNeedRefresh: false,
      // 轮播图数据是否需要刷新标记
      bannerNeedRefresh: false,
      // 系列数据是否需要刷新标记
      categoryNeedRefresh: false,
      // 分类数据是否需要刷新标记
      typesNeedRefresh: false,
      // 购物车数据是否需要刷新标记
      cartDirty: false
    };
    this._loginCallbacks = [];

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
    
    // 登录成功后启动全局商品监听器
    this.onLoginReady(() => {
      this.startGlobalProductWatcher();
    });
  },
  
  // 全局商品缓存监听器
  _globalProductWatcher: null,
  
  // 启动全局商品监听器
  startGlobalProductWatcher() {
    if (this._globalProductWatcher) {
      console.log('[全局监听器] 监听器已存在，不再重复创建');
      return;
    }
    
    const db = wx.cloud.database();
    
    console.log('[全局监听器] 启动商品监听器');
    
    this._globalProductWatcher = db.collection('products')
      .where({ isDeleted: false })
      .watch({
        onChange: (snapshot) => {
          console.log('[全局监听器] 商品数据变化:', snapshot.type);
          
          // 引入缓存工具
          const cache = require('./utils/cache');
          
          if (snapshot.type === 'init') {
            // 初始化快照，更新全部缓存
            console.log('[全局监听器] 收到初始化快照，更新全部缓存');
            if (snapshot.docs && snapshot.docs.length > 0) {
              snapshot.docs.forEach(doc => {
                cache.cacheProduct(doc._id, doc);
              });
              console.log('[全局监听器] 已更新', snapshot.docs.length, '个商品缓存');
            }
          } else {
            // 数据变化，增量更新缓存
            if (snapshot.docChanges && snapshot.docChanges.length > 0) {
              snapshot.docChanges.forEach(change => {
                if (change.dataType === 'update' || change.dataType === 'add') {
                  if (change.doc) {
                    cache.cacheProduct(change.doc._id, change.doc);
                    console.log('[全局监听器] 更新商品缓存:', change.doc._id);
                  }
                } else if (change.dataType === 'remove') {
                  // 商品删除，移除缓存
                  console.log('[全局监听器] 移除商品缓存:', change.docId);
                }
              });
            }
          }
        },
        onError: (error) => {
          console.error('[全局监听器] 监听出错:', error);
          // 监听出错，清理引用
          this._globalProductWatcher = null;
          
          // 延迟重连
          setTimeout(() => {
            console.log('[全局监听器] 尝试重新连接...');
            this.startGlobalProductWatcher();
          }, 3000);
        }
      });
  },
  
  // 停止全局商品监听器
  stopGlobalProductWatcher() {
    if (this._globalProductWatcher) {
      console.log('[全局监听器] 停止商品监听器');
      this._globalProductWatcher.close();
      this._globalProductWatcher = null;
    }
  },

  // 注册登录就绪回调（页面在 onLoad 中调用，避免轮询 openid）
  onLoginReady(callback) {
    if (this.globalData.openid) {
      callback(this.globalData.openid);
    } else {
      if (!this._loginCallbacks) this._loginCallbacks = [];
      this._loginCallbacks.push(callback);
    }
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

          // 通知所有等待登录的页面
          if (this._loginCallbacks && this._loginCallbacks.length > 0) {
            const callbacks = this._loginCallbacks;
            this._loginCallbacks = [];
            callbacks.forEach(cb => {
              try { cb(res.result.openid); } catch (e) { console.error('login callback error:', e); }
            });
          }
          
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
                isDelete: false,
                createdAt: new Date()
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
