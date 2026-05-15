// pages/my/index.js
const db = wx.cloud.database();
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

  onLoad(options) {
    const that = this;
    const cachedOpenid = wx.getStorageSync('openid');
    if (cachedOpenid) {
      console.log('从本地存储获取openid成功:', cachedOpenid);
      that.setData({ openid: cachedOpenid });
      that.getUserInfoFromDb(cachedOpenid);
      that.getOrderCounts();
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
          that.getOrderCounts();
          that.checkAdminPermission(openid);
        },
        fail: (err) => {
          console.error('获取openid失败:', err);
        }
      });
    }
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
            avatarUrl: res.data[0].avatarImage
          };
          wx.setStorageSync('userInfo', userInfo);
          that.setData({ userInfo });
        } else {
          const defaultNickname = 'Aura-' + this.generateRandomString(6);
          const userInfo = {
            nickName: defaultNickname,
            avatarUrl: ''
          };
          wx.setStorageSync('userInfo', userInfo);
          that.setData({ userInfo });
        }
      },
      fail: (err) => {
        console.error('从数据库获取用户信息失败:', err);
        const defaultNickname = 'Aura-' + this.generateRandomString(6);
        const userInfo = {
          nickName: defaultNickname,
          avatarUrl: ''
        };
        wx.setStorageSync('userInfo', userInfo);
        that.setData({ userInfo });
      }
    });
  },

  generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },

  onShow() {
    const cachedOpenid = wx.getStorageSync('openid');
    if (cachedOpenid) {
      this.setData({ openid: cachedOpenid });
      this.getUserInfoFromDb(cachedOpenid);
      this.getOrderCounts();
      this.checkAdminPermission(cachedOpenid);
    } else {
      const that = this;
      wx.cloud.callFunction({
        name: 'login',
        success: (res) => {
          console.log('获取openid成功:', res);
          const openid = res.result.openid;
          that.setData({ openid });
          wx.setStorageSync('openid', openid);
          that.getUserInfoFromDb(openid);
          that.getOrderCounts();
          that.checkAdminPermission(openid);
        },
        fail: (err) => {
          console.error('获取openid失败:', err);
        }
      });
    }
  },

  onPullDownRefresh() {
    console.log('用户下拉刷新');
    const cachedOpenid = wx.getStorageSync('openid');
    if (cachedOpenid) {
      this.setData({ openid: cachedOpenid });
      this.getOrderCounts();
    } else {
      const that = this;
      wx.cloud.callFunction({
        name: 'login',
        success: (res) => {
          console.log('获取openid成功:', res);
          const openid = res.result.openid;
          that.setData({ openid });
          wx.setStorageSync('openid', openid);
          that.getOrderCounts();
        },
        fail: (err) => {
          console.error('获取openid失败:', err);
        }
      });
    }
    setTimeout(() => {
      wx.stopPullDownRefresh();
    }, 1000);
  },

  onTabItemTap(item) {
    if (this.lastTapTime) {
      const now = new Date().getTime();
      if (now - this.lastTapTime < 300) {
        console.log('双击TabBar刷新');
        const cachedOpenid = wx.getStorageSync('openid');
        if (cachedOpenid) {
          this.setData({ openid: cachedOpenid });
          this.getOrderCounts();
        }
      }
    }
    this.lastTapTime = new Date().getTime();
  },

  async getOrderCounts() {
    const db = wx.cloud.database();
    const openid = this.data.openid;

    if (!openid) {
      console.error('用户openid不存在');
      return;
    }

    const queryCondition = { _openid: openid };
    console.log('查询条件:', queryCondition);

    let allOrders = [];
    let hasMore = true;
    let offset = 0;
    const limit = 20;

    try {
      console.log('开始查询订单，初始offset:', offset, 'limit:', limit);
      while (hasMore) {
        console.log('查询订单，当前offset:', offset, 'limit:', limit);
        const res = await db.collection('orders').where(queryCondition).skip(offset).limit(limit).get();

        console.log('查询结果数据长度:', res.data.length);

        if (res.data.length > 0) {
          console.log('添加订单数据，当前总数:', allOrders.length, '添加数量:', res.data.length);
          allOrders = allOrders.concat(res.data);
          console.log('添加后总数:', allOrders.length);
          offset += limit;
          console.log('更新offset:', offset);
          if (res.data.length < limit) {
            console.log('返回数据少于limit，结束查询');
            hasMore = false;
          } else {
            console.log('返回数据等于limit，继续查询');
          }
        } else {
          console.log('没有更多数据，结束查询');
          hasMore = false;
        }
      }

      console.log('获取当前用户的订单数据总数:', allOrders.length);
      console.log('获取当前用户的订单数据:', allOrders);

      const orderCounts = {
        pending: 0,
        paid: 0,
        shipping: 0,
        delivered: 0,
        completed: 0,
        refund: 0
      };

      const pickupCounts = {
        pending: 0,
        paid: 0,
        completed: 0
      };

      const localCounts = {
        pending: 0,
        paid: 0,
        shipping: 0,
        completed: 0
      };

      const normalizeToken = (value) => String(value || '')
        .replace(/[\s\u200B-\u200D\uFEFF]/g, '')
        .toLowerCase();

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

      console.log('最终快递运输订单数量:', orderCounts);
      console.log('最终上门自提订单数量:', pickupCounts);
      console.log('最终同城配送订单数量:', localCounts);

      const hasPickupOrders = Object.values(pickupCounts).reduce((sum, count) => sum + count, 0) > 0;
      const hasLocalOrders = Object.values(localCounts).reduce((sum, count) => sum + count, 0) > 0;

      this.setData({
        orderCounts,
        pickupCounts,
        localCounts,
        hasPickupOrders,
        hasLocalOrders
      });

      const orderCountsCache = {
        orderCounts,
        pickupCounts,
        localCounts,
        timestamp: Date.now()
      };
      wx.setStorageSync('orderCounts', orderCountsCache);
      console.log('缓存订单数量到本地存储成功:', orderCountsCache);
    } catch (err) {
      console.error('获取订单数量失败:', err);
    }
  },

  updateOrderCountCache(deliveryType, oldStatus, newStatus) {
    console.log('更新订单数量缓存:', { deliveryType, oldStatus, newStatus });

    let cachedCounts = wx.getStorageSync('orderCounts');
    if (!cachedCounts) {
      cachedCounts = {
        orderCounts: {
          pending: 0,
          shipping: 0,
          delivered: 0,
          completed: 0,
          refund: 0
        },
        pickupCounts: {
          pending: 0,
          paid: 0,
          completed: 0
        },
        localCounts: {
          pending: 0,
          paid: 0,
          shipping: 0,
          completed: 0
        },
        timestamp: Date.now()
      };
    }

    if (oldStatus) {
      if (deliveryType === 'express') {
        if (oldStatus === 'paid') {
          if (cachedCounts.orderCounts.shipping > 0) {
            cachedCounts.orderCounts.shipping--;
          }
        } else {
          if (cachedCounts.orderCounts[oldStatus] > 0) {
            cachedCounts.orderCounts[oldStatus]--;
          }
        }
      } else if (deliveryType === 'pickup') {
        if (cachedCounts.pickupCounts[oldStatus] > 0) {
          cachedCounts.pickupCounts[oldStatus]--;
        }
      } else if (deliveryType === 'local') {
        if (cachedCounts.localCounts[oldStatus] > 0) {
          cachedCounts.localCounts[oldStatus]--;
        }
      }
    }

    if (newStatus) {
      if (deliveryType === 'express') {
        if (newStatus === 'paid') {
          cachedCounts.orderCounts.shipping++;
        } else {
          cachedCounts.orderCounts[newStatus]++;
        }
      } else if (deliveryType === 'pickup') {
        cachedCounts.pickupCounts[newStatus]++;
      } else if (deliveryType === 'local') {
        cachedCounts.localCounts[newStatus]++;
      }
    }

    cachedCounts.timestamp = Date.now();
    wx.setStorageSync('orderCounts', cachedCounts);
    console.log('更新订单数量缓存成功:', cachedCounts);

    const hasPickupOrders = Object.values(cachedCounts.pickupCounts).reduce((sum, count) => sum + count, 0) > 0;
    const hasLocalOrders = Object.values(cachedCounts.localCounts).reduce((sum, count) => sum + count, 0) > 0;

    this.setData({
      orderCounts: cachedCounts.orderCounts,
      pickupCounts: cachedCounts.pickupCounts,
      localCounts: cachedCounts.localCounts,
      hasPickupOrders,
      hasLocalOrders
    });
  },

  viewAllOrders() {
    wx.navigateTo({
      url: '/pages/order-list/index?deliveryType=express'
    });
  },

  goToOrderList(e) {
    const status = e.currentTarget.dataset.status;
    wx.navigateTo({
      url: `/pages/order-list/index?status=${status}&deliveryType=express`
    });
  },

  goToPickupOrders(e) {
    const status = e.currentTarget.dataset.status || 'all';
    wx.navigateTo({
      url: `/pages/order-list/index?status=${status}&deliveryType=pickup`
    });
  },

  goToLocalOrders(e) {
    const status = e.currentTarget.dataset.status || 'all';
    wx.navigateTo({
      url: `/pages/order-list/index?status=${status}&deliveryType=local`
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

  goToCart() {
    wx.switchTab({
      url: '/pages/cart/index'
    });
  },

  contactService() {
    const that = this;
    db.collection('settings').get({
      success: (res) => {
        console.log('获取设置成功:', res);
        if (res.data && res.data.length > 0) {
          const wechatId = res.data[0].wechatId;
          if (wechatId) {
            wx.setClipboardData({
              data: wechatId,
              success: (res) => {
                wx.showToast({
                  title: '微信号已复制，请打开微信添加好友',
                  icon: 'success'
                });
              },
              fail: (err) => {
                console.error('复制微信号失败:', err);
                wx.showToast({
                  title: '获取微信号失败',
                  icon: 'none'
                });
              }
            });
          } else {
            wx.showToast({
              title: '微信号未设置',
              icon: 'none'
            });
          }
        } else {
          wx.showToast({
            title: '获取设置失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('获取设置失败:', err);
        wx.showToast({
          title: '获取设置失败',
          icon: 'none'
        });
      }
    });
  },

  handleContact(e) {
    console.log('客服消息回调:', e);
  },

  showWechatQRCode() {
    const that = this;
    db.collection('settings').get({
      success: (res) => {
        console.log('获取设置成功:', res);
        if (res.data && res.data.length > 0) {
          const wechatPicture = res.data[0].wechatPicture;
          if (wechatPicture) {
            that.setData({
              wechatQRCodeUrl: wechatPicture,
              showWechatQRCodeModal: true
            });
          } else {
            wx.showToast({
              title: '微信二维码未设置',
              icon: 'none'
            });
          }
        } else {
          wx.showToast({
            title: '获取设置失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('获取设置失败:', err);
        wx.showToast({
          title: '获取设置失败',
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
  },

  async checkAdminPermission(openid) {
    try {
      console.log('检查管理员权限，openid:', openid);
      const settings = db.collection('settings');
      const res = await settings.get();
      if (res.data && res.data.length > 0) {
        const adminOpenId = res.data[0].adminOpenId || [];
        console.log('管理员openid列表:', adminOpenId);
        const isAdmin = adminOpenId.includes(openid);
        console.log('是否是管理员:', isAdmin);
        this.setData({ showAdminSection: isAdmin });
      } else {
        console.log('未找到设置数据');
        this.setData({ showAdminSection: false });
      }
    } catch (err) {
      console.error('检查管理员权限失败:', err);
      this.setData({ showAdminSection: false });
    }
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

  goToProductTypeManagement() {
    wx.navigateTo({
      url: '/pages/admin/product-type-manage/index'
    });
  },

  goToNotificationManagement() {
    wx.navigateTo({
      url: '/pages/admin/notification-manage/index'
    });
  },

  goToProfileEdit() {
    wx.navigateTo({
      url: '/pages/profile-edit/index'
    });
  },

  onPullDownRefresh() {
    const openid = this.data.openid;
    if (openid) {
      this.getUserInfoFromDb(openid);
    } else {
      const userInfo = wx.getStorageSync('userInfo');
      if (userInfo) {
        this.setData({ userInfo });
      }
    }
    wx.stopPullDownRefresh();
  }
});
