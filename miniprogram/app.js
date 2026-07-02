// app.js
import { getGlobalProductWatcher } from './utils/globalProductWatcher';
import { getGlobalOrderWatcher } from './utils/globalOrderWatcher';
import errorLogger from './utils/errorLogger';

App({
  onLaunch() {
    console.log('[APP] ====== onLaunch 开始 ======');
    const startTime = Date.now();

    errorLogger.registerGlobalErrorHandler();

    // 全局云开发环境配置骨架
    this.globalData = {
      env: "cloud1-4gs2vu8c6544e586",
      openid: '',
      productsNeedRefresh: false,
      bannerNeedRefresh: false,
      categoryNeedRefresh: false,
      typesNeedRefresh: false,
      cartDirty: false
    };
    this._loginCallbacks = [];

    if (!wx.cloud) {
      console.error("[APP] 请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      console.log('[APP] 开始初始化 wx.cloud');
      try {
        wx.cloud.init({
          env: this.globalData.env,
          traceUser: true
        });
        console.log('[APP] wx.cloud.init 完成，耗时:', Date.now() - startTime, 'ms');
      } catch (e) {
        console.error('[APP] wx.cloud.init 异常:', e);
      }
    }

    // 获取用户openid
    console.log('[APP] 准备调用 getOpenid()');
    this.getOpenid();

    // 登录成功后启动全局商品监听器和订单监听器
    this.onLoginReady(() => {
      getGlobalProductWatcher().init();
      getGlobalOrderWatcher().init();
    });

    console.log('[APP] ====== onLaunch 完成 ======，总耗时:', Date.now() - startTime, 'ms');
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
    console.log('[APP:getOpenid] ====== getOpenid 开始 ======');
    const startTime = Date.now();
    try {
      console.log('[APP:getOpenid] 准备调用 wx.cloud.callFunction(name="login")');
      const callFunctionStart = Date.now();
      wx.cloud.callFunction({
        name: 'login',
        data: {},
        success: (res) => {
          console.log('[APP:getOpenid] 云函数login返回成功，耗时:', Date.now() - callFunctionStart, 'ms，结果:', res);
          this.globalData.openid = res.result.openid;
          wx.setStorageSync('openid', res.result.openid);
          console.log('[APP:getOpenid] 保存openid完成', res.result.openid);

          // 通知所有等待登录的页面
          if (this._loginCallbacks && this._loginCallbacks.length > 0) {
            const callbacks = this._loginCallbacks;
            this._loginCallbacks = [];
            callbacks.forEach(cb => {
              try {
                console.log('[APP:getOpenid] 执行登录回调');
                cb(res.result.openid);
              } catch (e) {
                console.error('[APP:getOpenid] 登录回调执行异常:', e);
              }
            });
          }

          // 检查是否有欢迎消息，如果没有则创建
          console.log('[APP:getOpenid] 准备调用 checkWelcomeMessage');
          this.checkWelcomeMessage(res.result.openid);
          
          console.log('[APP:getOpenid] ====== getOpenid 成功完成 ======，总耗时:', Date.now() - startTime, 'ms');
        },
        fail: (err) => {
          console.error('[APP:getOpenid] ====== 云函数login失败 ======，耗时:', Date.now() - callFunctionStart, 'ms，错误:', err);
          this.globalData.openid = '';
          wx.setStorageSync('openid', '');
        }
      });
    } catch (error) {
      console.error('[APP:getOpenid] ====== getOpenid 异常 ======，耗时:', Date.now() - startTime, 'ms，错误:', error);
      this.globalData.openid = '';
      wx.setStorageSync('openid', '');
    }
  },
  
  // 检查是否有欢迎消息，如果没有则创建
  checkWelcomeMessage(openid) {
    console.log('[APP:checkWelcomeMessage] ====== checkWelcomeMessage 开始 ======');
    const startTime = Date.now();
    try {
      const db = wx.cloud.database();
      console.log('[APP:checkWelcomeMessage] 准备查询 notifications，openid:', openid);
      const queryStart = Date.now();
      db.collection('notifications')
        .where({
          openid: openid,
          type: 'welcome'
        })
        .get({
          success: (res) => {
            console.log('[APP:checkWelcomeMessage] 查询通知完成，耗时:', Date.now() - queryStart, 'ms，结果:', res);
            if (res.data.length === 0) {
              console.log('[APP:checkWelcomeMessage] 没有欢迎消息，准备创建');
              const createStart = Date.now();
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
              
              console.log('[APP:checkWelcomeMessage] 准备 add 通知');
              db.collection('notifications').add({
                data: welcomeMessage,
                success: (addRes) => {
                  console.log('[APP:checkWelcomeMessage] 创建欢迎消息成功，耗时:', Date.now() - createStart, 'ms，结果:', addRes);
                },
                fail: (addErr) => {
                  console.error('[APP:checkWelcomeMessage] ====== 创建欢迎消息失败 ======，耗时:', Date.now() - createStart, 'ms，错误:', addErr);
                }
              });
            } else {
              console.log('[APP:checkWelcomeMessage] 已有欢迎消息');
            }
            console.log('[APP:checkWelcomeMessage] ====== checkWelcomeMessage 完成 ======，总耗时:', Date.now() - startTime, 'ms');
        },
        fail: (err) => {
          console.error('[APP:checkWelcomeMessage] ====== 查询通知失败 ======，耗时:', Date.now() - queryStart, 'ms，错误:', err);
        }
      });
    } catch (error) {
      console.error('[APP:checkWelcomeMessage] ====== checkWelcomeMessage 异常 ======，耗时:', Date.now() - startTime, 'ms，错误:', error);
    }
  },

  /**
   * 小程序显示（用户进入小程序）
   */
  onShow() {
    console.log('[APP] ====== onShow ======');
    
    // 获取上次离开时间（用于日志记录）
    const lastLeaveTime = wx.getStorageSync('lastLeaveTime');
    
    if (lastLeaveTime) {
      const now = Date.now();
      const timeDiff = now - lastLeaveTime;
      const minutesDiff = timeDiff / (1000 * 60);
      
      console.log(`[APP] 用户离开 ${minutesDiff.toFixed(1)} 分钟`);
    }
    
    // 清除离开时间记录（已处理完）
    wx.removeStorageSync('lastLeaveTime');
  },

  /**
   * 小程序隐藏（用户离开小程序）
   */
  onHide() {
    console.log('[APP] ====== onHide ======');
    
    // 记录离开时间
    wx.setStorageSync('lastLeaveTime', Date.now());
    console.log('[APP] 已记录离开时间');
  },


});
