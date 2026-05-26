// pages/my/index.js
const db = wx.cloud.database();
const app = getApp();
Page({

  data: {
    userInfo: {},
    openid: '',
    showWechatQRCodeModal: false,
    wechatQRCodeUrl: '',
    orderCounts: {},
    pickupCounts: {},
    localCounts: {},
    showAdminSection: false
  },

  orderWatch: null,
  watchInitialized: false,
  lastOrderCounts: null,
  reconnectTimer: null,
  reconnectAttempts: 0,
  maxReconnectAttempts: 3,
  reconnectDelay: 2000,
  pageVisible: false,
  isCreatingWatch: false, // 防止并发创建监听器

  onLoad(options) {
    const that = this;
    const cachedOpenid = wx.getStorageSync('openid');
    if (cachedOpenid) {
      console.log('从本地存储获取openid成功:', cachedOpenid);
      that.setData({ openid: cachedOpenid });

      const cachedUser = wx.getStorageSync(`user_${cachedOpenid}`);
      if (cachedUser && cachedUser.nickName) {
        console.log('[我的页面] 从缓存读取用户信息:', cachedUser);
        that.setData({ userInfo: cachedUser });
      } else {
        that.getUserInfoFromDb(cachedOpenid);
      }

      that.initOrderCounts();
      that.checkAdminPermission(cachedOpenid);
    } else {
      wx.cloud.callFunction({
        name: 'login',
        success: (res) => {
          console.log('获取openid成功:', res);
          const openid = res.result.openid;
          that.setData({ openid });
          wx.setStorageSync('openid', openid);
          that.getUserInfoFromDb(openid);
          that.initOrderCounts();
          that.checkAdminPermission(openid);
        },
        fail: (err) => {
          console.error('获取openid失败:', err);
        }
      });
    }
  },

  onShow() {
    this.pageVisible = true;
    const cachedOpenid = wx.getStorageSync('openid');
    if (cachedOpenid) {
      this.setData({ openid: cachedOpenid });

      const cachedUser = wx.getStorageSync(`user_${cachedOpenid}`);
      if (cachedUser && cachedUser.nickName) {
        this.setData({ userInfo: cachedUser });
      }

      const cachedCounts = wx.getStorageSync('orderCounts');
      if (cachedCounts) {
        this.setData({
          orderCounts: cachedCounts.orderCounts || {},
          pickupCounts: cachedCounts.pickupCounts || {},
          localCounts: cachedCounts.localCounts || {}
        });
      }

      this.silentRefreshOrderCounts();

      if (this.watchInitialized && this.orderWatch) {
        console.log('[我的页面] 复用已存在的监听器');
      } else if (!this.isCreatingWatch) {
        // 如果正在创建监听器或正在重连，等待完成
        if (this.reconnectTimer) {
          console.log('[我的页面] 正在重连中，取消原有重连任务，立即重试');
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
          this.reconnectAttempts = 0;
        }
        this.startOrderWatch();
      }
    }
  },

  onHide() {
    this.pageVisible = false;
    this.stopOrderWatch();
  },

  async initOrderCounts() {
    const openid = this.data.openid;
    if (!openid) return;

    const cachedCounts = wx.getStorageSync('orderCounts');
    if (cachedCounts && cachedCounts.orderCounts) {
      console.log('[我的页面] 从缓存读取订单数量:', cachedCounts);
      this.setData({
        orderCounts: cachedCounts.orderCounts,
        pickupCounts: cachedCounts.pickupCounts || {},
        localCounts: cachedCounts.localCounts || {}
      });
    }

    await this.silentRefreshOrderCounts();
    this.startOrderWatch();
  },

  async silentRefreshOrderCounts() {
    const openid = this.data.openid;
    if (!openid) return;

    try {
      const freshCounts = await this.calculateOrderCounts();
      const hasDiff = this.hasCountsDiff(freshCounts);

      if (hasDiff) {
        console.log('[我的页面] 数据有差异，静默刷新:', freshCounts);
        this.setData({
          orderCounts: freshCounts.orderCounts,
          pickupCounts: freshCounts.pickupCounts,
          localCounts: freshCounts.localCounts
        });
        this.updateOrderCountsCache(freshCounts);
      } else {
        console.log('[我的页面] 数据无差异，不更新UI');
      }

      this.lastOrderCounts = freshCounts;
    } catch (err) {
      console.error('[我的页面] 静默刷新订单数量失败:', err);
    }
  },

  hasCountsDiff(newCounts) {
    if (!this.lastOrderCounts) return true;

    const compare = (oldObj, newObj) => {
      if (!oldObj || !newObj) return true;
      const oldKeys = Object.keys(oldObj);
      const newKeys = Object.keys(newObj);
      if (oldKeys.length !== newKeys.length) return true;
      for (const key of oldKeys) {
        if (oldObj[key] !== newObj[key]) return true;
      }
      return false;
    };

    return compare(this.lastOrderCounts.orderCounts, newCounts.orderCounts) ||
           compare(this.lastOrderCounts.pickupCounts, newCounts.pickupCounts) ||
           compare(this.lastOrderCounts.localCounts, newCounts.localCounts);
  },

  async calculateOrderCounts() {
    const db = wx.cloud.database();
    const openid = this.data.openid;
    if (!openid) {
      return {
        orderCounts: { pending: 0, paid: 0, shipping: 0, delivered: 0, completed: 0, refund: 0 },
        pickupCounts: { pending: 0, paid: 0, completed: 0 },
        localCounts: { pending: 0, paid: 0, shipping: 0, completed: 0 }
      };
    }

    const queryCondition = { _openid: openid };
    let allOrders = [];
    let hasMore = true;
    let offset = 0;
    const limit = 20;

    try {
      while (hasMore) {
        const res = await db.collection('orders').where(queryCondition).skip(offset).limit(limit).get();
        if (res.data.length > 0) {
          allOrders = allOrders.concat(res.data);
          offset += limit;
          if (res.data.length < limit) {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }

      const orderCounts = { pending: 0, paid: 0, shipping: 0, delivered: 0, completed: 0, refund: 0 };
      const pickupCounts = { pending: 0, paid: 0, completed: 0 };
      const localCounts = { pending: 0, paid: 0, shipping: 0, completed: 0 };

      const normalizeToken = (value) => String(value || '').replace(/[\s\u200B-\u200D\uFEFF]/g, '').toLowerCase();

      allOrders.forEach((order) => {
        const deliveryType = normalizeToken(order.deliveryType);
        const status = normalizeToken(order.status);
        if (!status) return;

        if (deliveryType === 'pickup') {
          pickupCounts[status] = (pickupCounts[status] || 0) + 1;
        } else if (deliveryType === 'local') {
          localCounts[status] = (localCounts[status] || 0) + 1;
        }
      });

      const expressOrders = allOrders.filter((order) => normalizeToken(order.deliveryType) === 'express');
      orderCounts.pending = expressOrders.filter((order) => normalizeToken(order.status) === 'pending').length;
      orderCounts.paid = expressOrders.filter((order) => normalizeToken(order.status) === 'paid').length;
      orderCounts.shipping = expressOrders.filter((order) => normalizeToken(order.status) === 'shipping').length;
      orderCounts.delivered = expressOrders.filter((order) => normalizeToken(order.status) === 'delivered').length;
      orderCounts.completed = expressOrders.filter((order) => {
        const status = normalizeToken(order.status);
        return status === 'completed' || status === 'refund_completed';
      }).length;
      orderCounts.refund = expressOrders.filter((order) => normalizeToken(order.status) === 'refund').length;

      return { orderCounts, pickupCounts, localCounts };
    } catch (err) {
      console.error('计算订单数量失败:', err);
      return {
        orderCounts: { pending: 0, paid: 0, shipping: 0, delivered: 0, completed: 0, refund: 0 },
        pickupCounts: { pending: 0, paid: 0, completed: 0 },
        localCounts: { pending: 0, paid: 0, shipping: 0, completed: 0 }
      };
    }
  },

  startOrderWatch() {
    const openid = this.data.openid;
    if (!openid || this.orderWatch) {
      console.log('[我的页面] 跳过监听初始化:', { hasOpenid: !!openid, hasWatch: !!this.orderWatch });
      this.isCreatingWatch = false;
      return;
    }

    if (this.isCreatingWatch) {
      console.log('[我的页面] 正在创建监听器，跳过');
      return;
    }

    console.log('[我的页面] 开启订单实时监听');
    this.isCreatingWatch = true;

    this.orderWatch = db.collection('orders')
      .where({ _openid: openid })
      .watch({
        onChange: (snapshot) => {
          console.log('[我的页面] 订单数据变化:', snapshot);
          this.reconnectAttempts = 0;
          this.silentRefreshOrderCounts();
        },
        onError: (error) => {
          console.error('[我的页面] 订单监听错误:', error);
          this.orderWatch = null;
          this.watchInitialized = false;
          this.isCreatingWatch = false;
          this.scheduleReconnect();
        }
      });

    this.watchInitialized = true;
    this.isCreatingWatch = false;
    this.reconnectAttempts = 0;
    console.log('[我的页面] 监听器创建成功');
  },

  stopOrderWatch() {
    if (this.reconnectTimer) {
      console.log('[我的页面] 取消待执行的重连任务');
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.orderWatch) {
      console.log('[我的页面] 暂停订单实时监听');
      this.orderWatch.close();
      this.orderWatch = null;
    }

    this.watchInitialized = false;
    this.isCreatingWatch = false;
  },

  scheduleReconnect() {
    if (!this.pageVisible) {
      console.log('[我的页面] 页面已隐藏，跳过重连');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[我的页面] 已达到最大重连次数，不再重连');
      return;
    }

    if (this.reconnectTimer) {
      console.log('[我的页面] 已有待执行的重连任务，跳过');
      return;
    }

    const delay = this.reconnectDelay * (this.reconnectAttempts + 1);
    console.log(`[我的页面] ${delay}ms 后尝试第 ${this.reconnectAttempts + 1} 次重连`);

    this.reconnectTimer = setTimeout(() => {
      console.log(`[我的页面] 执行第 ${this.reconnectAttempts + 1} 次重连`);
      this.reconnectAttempts++;
      this.reconnectTimer = null;
      this.startOrderWatch();
    }, delay);
  },

  updateOrderCountsCache(counts) {
    const cache = {
      orderCounts: counts.orderCounts,
      pickupCounts: counts.pickupCounts,
      localCounts: counts.localCounts,
      timestamp: Date.now()
    };
    wx.setStorageSync('orderCounts', cache);
    console.log('[我的页面] 更新订单数量缓存成功');
  },

  async refreshOrderCounts() {
    wx.showLoading({ title: '刷新中...' });
    await this.silentRefreshOrderCounts();
    wx.hideLoading();
  },

  getUserInfoFromDb(openid) {
    const that = this;
    db.collection('users').where({
      _openid: openid
    }).get({
      success: (res) => {
        console.log('从数据库获取用户信息成功:', res);
        if (res.data && res.data.length > 0) {
          const userInfo = {
            nickName: res.data[0].nickName,
            avatarImage: res.data[0].avatarImage
          };
          wx.setStorageSync(`user_${openid}`, userInfo);
          that.setData({ userInfo });
        } else {
          const defaultNickname = 'Aura-' + this.generateRandomString(6);
          const userInfo = {
            nickName: defaultNickname,
            avatarImage: ''
          };
          wx.setStorageSync(`user_${openid}`, userInfo);
          that.setData({ userInfo });
        }
      },
      fail: (err) => {
        console.error('从数据库获取用户信息失败:', err);
        const defaultNickname = 'Aura-' + this.generateRandomString(6);
        const userInfo = {
          nickName: defaultNickname,
          avatarImage: ''
        };
        wx.setStorageSync(`user_${openid}`, userInfo);
        that.setData({ userInfo });
      }
    });
  },

  checkAdminPermission(openid) {
    wx.cloud.database().collection('settings').limit(1).get({
      success: (res) => {
        if (res.data && res.data[0]) {
          const adminOpenId = res.data[0].adminOpenId || [];
          const isAdmin = adminOpenId.includes(openid);
          this.setData({ showAdminSection: isAdmin });
        }
      }
    });
  },

  onPullDownRefresh() {
    console.log('用户下拉刷新');
    this.refreshOrderCounts().then(() => {
      setTimeout(() => {
        wx.stopPullDownRefresh();
      }, 500);
    });
  },

  onTabItemTap(item) {
    if (this.lastTapTime) {
      const now = new Date().getTime();
      if (now - this.lastTapTime < 300) {
        console.log('双击TabBar刷新');
        this.refreshOrderCounts();
      }
    }
    this.lastTapTime = new Date().getTime();
  },

  generateRandomString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  },

  viewAllOrders() {
    wx.navigateTo({
      url: '/pages/order-list/index'
    });
  },

  goToOrderList(e) {
    const status = e.currentTarget.dataset.status;
    wx.navigateTo({
      url: `/pages/order-list/index?status=${status}`
    });
  },

  goToPickupOrders(e) {
    const status = e.currentTarget.dataset.status;
    const url = status 
      ? `/pages/order-list/index?status=${status}&deliveryType=pickup`
      : '/pages/order-list/index?deliveryType=pickup';
    wx.navigateTo({ url });
  },

  goToLocalOrders(e) {
    const status = e.currentTarget.dataset.status;
    const url = status
      ? `/pages/order-list/index?status=${status}&deliveryType=local`
      : '/pages/order-list/index?deliveryType=local';
    wx.navigateTo({ url });
  },

  goToProfileEdit() {
    wx.navigateTo({
      url: '/pages/profile-edit/index'
    });
  },

  chooseAddress() {
    wx.chooseAddress({
      success: (res) => {
        console.log('选择地址成功:', res);
      },
      fail: (err) => {
        console.error('选择地址失败:', err);
      }
    });
  },

  showWechatQRCode() {
    wx.cloud.database().collection('settings').limit(1).get({
      success: (res) => {
        const wechatPicture = res.data[0]?.wechatPicture;
        this.setData({
          showWechatQRCodeModal: true,
          wechatQRCodeUrl: wechatPicture || ''
        });
      },
      fail: (err) => {
        console.error('获取微信二维码失败:', err);
        wx.showToast({
          title: '获取失败',
          icon: 'none'
        });
      }
    });
  },

  hideWechatQRCode() {
    this.setData({
      showWechatQRCodeModal: false
    });
  },

  stopPropagation() {
    // 阻止事件冒泡
  },

  goToAdminDashboard() {
    wx.navigateTo({
      url: '/pages/admin/index/index'
    });
  },

  goToOrderManagement() {
    wx.navigateTo({
      url: '/pages/admin/order-manage/index'
    });
  },

  goToProductManagement() {
    wx.navigateTo({
      url: '/pages/admin/product-manage/index'
    });
  },

  goToProductTypeManagement() {
    wx.navigateTo({
      url: '/pages/admin/product-type-manage/index'
    });
  },

  goToClothManagement() {
    wx.navigateTo({
      url: '/pages/admin/cloth-manage/index'
    });
  },

  goToSeriesManagement() {
    wx.navigateTo({
      url: '/pages/admin/series-manage/index'
    });
  },

  goToUserManagement() {
    wx.navigateTo({
      url: '/pages/admin/user-manage/index'
    });
  },

  goToSystemSettings() {
    wx.navigateTo({
      url: '/pages/admin/update-settings/index'
    });
  },

  goToNotificationManagement() {
    wx.navigateTo({
      url: '/pages/admin/notification-manage/index'
    });
  }
});
