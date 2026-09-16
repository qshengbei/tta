// pages/my/index.js
const db = wx.cloud.database();

function _getByteSize(str) {
  if (!str) return 0;
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    if (charCode <= 0x007f) bytes += 1;
    else if (charCode <= 0x07ff) bytes += 2;
    else if (charCode <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function _logPerformance(label, startTime) {
  const endTime = Date.now();
  console.log(`[性能分析][我的页] ${label}: ${endTime - startTime}ms`);
  return endTime;
}

function _analyzeData(data, label) {
  if (!data || data.length === 0) {
    console.log(`[性能分析][我的页] ${label} - 数据为空`);
    return;
  }
  const jsonString = JSON.stringify(data);
  const byteSize = _getByteSize(jsonString);
  const kbSize = (byteSize / 1024).toFixed(2);
  console.log(`[性能分析][我的页] ${label}: ${data.length} 条, ${byteSize} bytes = ${kbSize} KB`);
}

function _logSetDataTime(label, fn) {
  const start = Date.now();
  fn();
  const end = Date.now();
  console.log(`[性能分析][我的页] setData ${label} 耗时: ${end - start}ms`);
}

Page({

  /**
   * 页面的初始数据
   */
  data: {
    userInfo: {}, // 用户信息
    openid: '', // 用户openid
    showWechatQRCodeModal: false, // 微信二维码弹窗显示状态
    wechatQRCodeUrl: '', // 微信二维码图片URL
    orderCounts: {}, // 订单状态数量
    pickupCounts: {}, // 上门自提订单状态数量
    localCounts: {}, // 同城配送订单状态数量
    showAdminSection: false // 管理员后台管理区域显示状态
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    const start = Date.now();
    console.log('[性能分析][我的页] ====== onLoad 开始 ======');
    const that = this;
    // 从本地存储获取openid
    const cacheStart = Date.now();
    const cachedOpenid = wx.getStorageSync('openid');
    _logPerformance('获取openid缓存', cacheStart);
    
    if (cachedOpenid) {
      console.log('从本地存储获取openid成功:', cachedOpenid);
      _logSetDataTime('openid', () => {
        that.setData({ openid: cachedOpenid });
      });
      // 优先从数据库获取用户信息，确保使用最新数据
      that.getUserInfoFromDb(cachedOpenid);
      // 获取订单数量
      that.getOrderCounts();
      // 检查管理员权限
      that.checkAdminPermission(cachedOpenid);
    } else {
      // 获取用户openid
      wx.cloud.callFunction({
        name: 'login',
        success: (res) => {
          console.log('获取openid成功:', res);
          const openid = res.result.openid;
          that.setData({ openid });
          // 缓存openid到本地存储
          wx.setStorageSync('openid', openid);
          // 优先从数据库获取用户信息
          that.getUserInfoFromDb(openid);
          // 获取订单数量
          that.getOrderCounts();
          // 检查管理员权限
          that.checkAdminPermission(openid);
        },
        fail: (err) => {
          console.error('获取openid失败:', err);
        }
      });
    }
    _logPerformance('onLoad', start);
  },

  /**
   * 从数据库获取用户信息
   */
  getUserInfoFromDb(openid) {
    const start = Date.now();
    const that = this;
    db.collection('users').where({
      _openid: openid
    }).get({
      success: (res) => {
        _logPerformance('getUserInfoFromDb', start);
        console.log('从数据库获取用户信息成功:', res);
        if (res.data && res.data.length > 0) {
          const userInfo = {
            nickName: res.data[0].nickName,
            avatarImage: res.data[0].avatarImage
          };
          // 保存用户信息到本地存储（使用统一缓存键）
          wx.setStorageSync(`user_${openid}`, userInfo);
          // 更新页面数据
          _logSetDataTime('userInfo', () => {
            that.setData({ userInfo });
          });
        }
      },
      fail: (err) => {
        console.error('从数据库获取用户信息失败:', err);
      }
    });
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 从本地存储获取openid
    const cachedOpenid = wx.getStorageSync('openid');
    if (cachedOpenid) {
      this.setData({ openid: cachedOpenid });
      // 优先从数据库获取用户信息，确保使用最新数据
      this.getUserInfoFromDb(cachedOpenid);
      // 总是从数据库获取最新的订单数量，确保显示正确的订单数量
      this.getOrderCounts();
      // 检查管理员权限
      this.checkAdminPermission(cachedOpenid);
    } else {
      // 如果本地存储没有openid，重新获取
      const that = this;
      wx.cloud.callFunction({
        name: 'login',
        success: (res) => {
          console.log('获取openid成功:', res);
          const openid = res.result.openid;
          that.setData({ openid });
          // 缓存openid到本地存储
          wx.setStorageSync('openid', openid);
          // 优先从数据库获取用户信息
          that.getUserInfoFromDb(openid);
          // 获取订单数量
          that.getOrderCounts();
          // 检查管理员权限
          that.checkAdminPermission(openid);
        },
        fail: (err) => {
          console.error('获取openid失败:', err);
        }
      });
    }
  },
  
  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    console.log('用户下拉刷新');
    // 从本地存储获取openid
    const cachedOpenid = wx.getStorageSync('openid');
    if (cachedOpenid) {
      this.setData({ openid: cachedOpenid });
      // 获取订单数量
      this.getOrderCounts();
    } else {
      // 如果本地存储没有openid，重新获取
      const that = this;
      wx.cloud.callFunction({
        name: 'login',
        success: (res) => {
          console.log('获取openid成功:', res);
          const openid = res.result.openid;
          that.setData({ openid });
          // 缓存openid到本地存储
          wx.setStorageSync('openid', openid);
          // 获取订单数量
          that.getOrderCounts();
        },
        fail: (err) => {
          console.error('获取openid失败:', err);
        }
      });
    }
    // 停止下拉刷新
    setTimeout(() => {
      wx.stopPullDownRefresh();
    }, 1000);
  },
  
  /**
   * 监听TabBar点击
   */
  onTabItemTap(item) {
    // 双击TabBar刷新
    if (this.lastTapTime) {
      const now = new Date().getTime();
      if (now - this.lastTapTime < 300) {
        console.log('双击TabBar刷新');
        // 从本地存储获取openid
        const cachedOpenid = wx.getStorageSync('openid');
        if (cachedOpenid) {
          this.setData({ openid: cachedOpenid });
          // 获取订单数量
          this.getOrderCounts();
        }
      }
    }
    this.lastTapTime = new Date().getTime();
  },
  
  /**
   * 获取当前用户的订单数量（调用云函数批量统计）
   */
  async getOrderCounts() {
    const start = Date.now();
    const openid = this.data.openid;
    
    if (!openid) {
      console.error('用户openid不存在');
      return;
    }
    
    try {
      console.log('[性能分析][我的页] 调用云函数 getOrderCounts');
      const res = await wx.cloud.callFunction({
        name: 'getOrderCounts'
      });
      
      _logPerformance('getOrderCounts', start);
      
      if (res.result && res.result.success) {
        const { orderCounts, pickupCounts, localCounts, hasPickupOrders, hasLocalOrders } = res.result;
        
        console.log('[性能分析][我的页] 最终快递运输订单数量:', orderCounts);
        console.log('[性能分析][我的页] 最终上门自提订单数量:', pickupCounts);
        console.log('[性能分析][我的页] 最终同城配送订单数量:', localCounts);
        
        _logSetDataTime('订单数量', () => {
          this.setData({
            orderCounts,
            pickupCounts,
            localCounts,
            hasPickupOrders,
            hasLocalOrders
          });
        });
        
        const orderCountsCache = {
          orderCounts,
          pickupCounts,
          localCounts,
          timestamp: Date.now()
        };
        wx.setStorageSync('orderCounts', orderCountsCache);
        console.log('[性能分析][我的页] 缓存订单数量到本地存储成功');
      } else {
        console.error('[性能分析][我的页] 获取订单数量失败:', res.result && res.result.error);
      }
    } catch (err) {
      console.error('[性能分析][我的页] 获取订单数量失败:', err);
    }
  },
  
  /**
   * 更新订单数量缓存
   * @param {string} deliveryType 订单类型：express（快递运输）、pickup（上门自提）、local（同城配送）
   * @param {string} oldStatus 旧状态
   * @param {string} newStatus 新状态
   */
  updateOrderCountCache(deliveryType, oldStatus, newStatus) {
    console.log('更新订单数量缓存:', { deliveryType, oldStatus, newStatus });
    
    // 从本地存储获取缓存
    let cachedCounts = wx.getStorageSync('orderCounts');
    if (!cachedCounts) {
      // 如果本地存储没有缓存，初始化缓存
      cachedCounts = {
        orderCounts: {
          pending: 0, // 待支付
          shipping: 0, // 待发货
          delivered: 0, // 待收货
          completed: 0, // 已完成
          refund: 0 // 退款/售后
        },
        pickupCounts: {
          pending: 0, // 待支付
          paid: 0, // 待自提
          completed: 0 // 已完成
        },
        localCounts: {
          pending: 0, // 待支付
          paid: 0, // 待配送
          shipping: 0, // 配送中
          completed: 0 // 已完成
        },
        timestamp: Date.now()
      };
    }
    
    // 处理旧状态的减1操作
    if (oldStatus) {
      if (deliveryType === 'express') {
        if (oldStatus === 'paid') {
          // 快递运输：paid 对应 shipping（待发货）
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
    
    // 处理新状态的加1操作
    if (newStatus) {
      if (deliveryType === 'express') {
        if (newStatus === 'paid') {
          // 快递运输：paid 对应 shipping（待发货）
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
    
    // 更新时间戳
    cachedCounts.timestamp = Date.now();
    
    // 保存到本地存储
    wx.setStorageSync('orderCounts', cachedCounts);
    console.log('更新订单数量缓存成功:', cachedCounts);
    
    // 计算订单总数
    const hasPickupOrders = Object.values(cachedCounts.pickupCounts).reduce((sum, count) => sum + count, 0) > 0;
    const hasLocalOrders = Object.values(cachedCounts.localCounts).reduce((sum, count) => sum + count, 0) > 0;
    
    // 更新页面数据
    this.setData({
      orderCounts: cachedCounts.orderCounts,
      pickupCounts: cachedCounts.pickupCounts,
      localCounts: cachedCounts.localCounts,
      hasPickupOrders,
      hasLocalOrders
    });
  },

  /**
   * 获取用户信息
   */
  getUserInfo(e) {
    console.log('点击了获取用户信息:', e);
    const _this = this;
    // 清除本地存储中的用户信息，确保每次点击都会弹出授权弹窗
    wx.removeStorageSync('userInfo');
    
    // 尝试使用 wx.getUserProfile
    console.log('尝试使用 wx.getUserProfile');
    wx.getUserProfile({
      desc: '用于完善用户资料',
      success: function(res) {
        console.log('获取用户信息成功:', res);
        const userInfo = res.userInfo;
        // 保存用户信息到本地存储
        wx.setStorageSync('userInfo', userInfo);
        // 更新页面数据
        _this.setData({ userInfo });
        // 上传头像到云存储
        _this.uploadAvatar(userInfo);
      },
      fail: function(err) {
        console.error('获取用户信息失败:', err);
        // 尝试使用 wx.getUserInfo 作为兜底方案
        console.log('尝试使用 wx.getUserInfo 作为兜底方案');
        wx.getUserInfo({
          withCredentials: true,
          success: function(res) {
            console.log('使用 wx.getUserInfo 获取用户信息成功:', res);
            const userInfo = res.userInfo;
            // 保存用户信息到本地存储
            wx.setStorageSync('userInfo', userInfo);
            // 更新页面数据
            _this.setData({ userInfo });
            // 上传头像到云存储
            _this.uploadAvatar(userInfo);
          },
          fail: function(err) {
            console.error('使用 wx.getUserInfo 获取用户信息失败:', err);
            wx.showToast({
              title: '获取用户信息失败',
              icon: 'none'
            });
          }
        });
      }
    });
  },

  /**
   * 上传头像到云存储
   */
  uploadAvatar(userInfo) {
    const that = this;
    const openid = that.data.openid;
    // 下载头像到本地
    wx.downloadFile({
      url: userInfo.avatarUrl,
      success: (res) => {
        console.log('下载头像成功:', res);
        // 上传头像到云存储
        wx.cloud.uploadFile({
          cloudPath: `avatars/${openid}.jpg`,
          filePath: res.tempFilePath,
          success: (res) => {
            console.log('上传头像成功:', res);
            const avatarImage = res.fileID;
            // 更新数据库中的用户信息
            that.updateUserInfo(userInfo.nickName, avatarImage);
          },
          fail: (err) => {
            console.error('上传头像失败:', err);
            // 即使上传头像失败，也更新用户昵称
            that.updateUserInfo(userInfo.nickName, userInfo.avatarUrl);
          }
        });
      },
      fail: (err) => {
        console.error('下载头像失败:', err);
        // 即使下载头像失败，也更新用户昵称
        that.updateUserInfo(userInfo.nickName, userInfo.avatarUrl);
      }
    });
  },

  /**
   * 更新数据库中的用户信息
   */
  updateUserInfo(nickName, avatarImage) {
    const openid = this.data.openid;
    db.collection('users').where({
      _openid: openid
    }).get({
      success: (res) => {
        if (res.data && res.data.length > 0) {
          // 更新现有用户信息
          db.collection('users').doc(res.data[0]._id).update({
            data: {
              nickName: nickName,
              avatarImage: avatarImage,
              updatedAt: new Date()
            },
            success: (res) => {
              console.log('更新用户信息成功:', res);
            },
            fail: (err) => {
              console.error('更新用户信息失败:', err);
            }
          });
        } else {
          // 创建新用户信息
          db.collection('users').add({
            data: {
              nickName: nickName,
              avatarImage: avatarImage,
              createdAt: new Date(),
              updatedAt: new Date()
            },
            success: (res) => {
              console.log('创建用户信息成功:', res);
            },
            fail: (err) => {
              console.error('创建用户信息失败:', err);
            }
          });
        }
      },
      fail: (err) => {
        console.error('查询用户信息失败:', err);
      }
    });
  },

  /**
   * 查看全部订单
   */
  viewAllOrders() {
    wx.navigateTo({
      url: '/pages/order-list/index?deliveryType=express'
    });
  },

  goToProfileEdit() {
    wx.navigateTo({
      url: '/pages/profile-edit/index'
    });
  },

  /**
   * 跳转到订单列表
   */// 跳转到订单列表页面
  goToOrderList(e) {
    const status = e.currentTarget.dataset.status;
    wx.navigateTo({
      url: `/pages/order-list/index?status=${status}&deliveryType=express`
    });
  },

  // 跳转到上门自提订单页面
  goToPickupOrders(e) {
    const status = e.currentTarget.dataset.status || 'all';
    wx.navigateTo({
      url: `/pages/order-list/index?status=${status}&deliveryType=pickup`
    });
  },

  // 跳转到同城配送订单页面
  goToLocalOrders(e) {
    const status = e.currentTarget.dataset.status || 'all';
    wx.navigateTo({
      url: `/pages/order-list/index?status=${status}&deliveryType=local`
    });
  },

  /**
   * 使用微信地址管理
   */
  chooseAddress() {
    wx.chooseAddress({
      success: (res) => {
        console.log('选择地址成功:', res);
        // 可以在这里处理选择的地址信息
      },
      fail: (err) => {
        console.error('选择地址失败:', err);
        // 不显示错误提示，因为用户点击返回是正常操作
      }
    });
  },

  /**
   * 跳转到购物车
   */
  goToCart() {
    wx.switchTab({
      url: '/pages/cart/index'
    });
  },

  /**
   * 联系客服
   */
  contactService() {
    const that = this;
    db.collection('settings').get({
      success: (res) => {
        console.log('获取设置成功:', res);
        if (res.data && res.data.length > 0) {
          const wechatId = res.data[0].wechatId;
          if (wechatId) {
            // 跳转至微信添加好友界面
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



  /**
   * 处理客服消息回调
   */
  handleContact(e) {
    console.log('客服消息回调:', e);
    // 可以在这里处理客服消息的回调
  },

  /**
   * 显示微信二维码
   */
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

  /**
   * 隐藏微信二维码
   */
  hideWechatQRCode() {
    this.setData({
      showWechatQRCodeModal: false
    });
  },

  /**
   * 阻止事件冒泡
   */
  stopPropagation() {
    // 阻止事件冒泡，防止点击弹窗内容时关闭弹窗
  },

  /**
   * 检查管理员权限
   */
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

  /**
   * 跳转到管理员仪表盘
   */
  goToAdminDashboard() {
    wx.navigateTo({
      url: '/pages/admin/dashboard/index'
    });
  },

  /**
   * 跳转到订单管理
   */
  goToOrderManagement() {
    wx.navigateTo({
      url: '/pages/admin/order-manage/index'
    });
  },

  /**
   * 跳转到商品管理
   */
  goToProductManagement() {
    wx.navigateTo({
      url: '/pages/admin/product-manage/index'
    });
  },

  /**
   * 跳转到用户管理
   */
  goToUserManagement() {
    wx.navigateTo({
      url: '/pages/admin/user-manage/index'
    });
  },

  // 跳转到系统设置
  goToSystemSettings() {
    wx.navigateTo({
      url: '/pages/admin/update-settings/index'
    });
  },

  // 跳转到布料管理
  goToClothManagement() {
    wx.navigateTo({
      url: '/pages/admin/cloth-manage/index'
    });
  },

  // 跳转到系列管理
  goToSeriesManagement() {
    wx.navigateTo({
      url: '/pages/admin/series-manage/index'
    });
  },

  // 跳转到商品类型管理
  goToProductTypeManagement() {
    wx.navigateTo({
      url: '/pages/admin/product-type-manage/index'
    });
  },

  // 跳转到通知管理
  goToNotificationManagement() {
    wx.navigateTo({
      url: '/pages/admin/notification-manage/index'
    });
  },

  // 跳转到Banner管理
  goToBannerManagement() {
    wx.navigateTo({
      url: '/pages/admin/banner-manage/index'
    });
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    // 刷新页面数据
    const openid = this.data.openid;
    if (openid) {
      // 从数据库获取用户信息
      this.getUserInfoFromDb(openid);
    } else {
      // 从本地存储获取用户信息
      const userInfo = wx.getStorageSync('userInfo');
      if (userInfo) {
        this.setData({ userInfo });
      }
    }
    wx.stopPullDownRefresh();
  }
})