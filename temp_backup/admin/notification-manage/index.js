Page({
  data: {
    activeTab: 'system', // 当前激活的标签：system, activity, restock
    userOptions: ['所有用户', '指定用户'], // 目标用户选项
    systemForm: {
      title: '',
      content: '',
      userType: 0 // 0: 所有用户, 1: 指定用户
    },
    activityForm: {
      title: '',
      description: '',
      userType: 0 // 0: 所有用户, 1: 指定用户
    },
    restockList: [], // 补货提醒列表
    showUserList: false, // 是否显示用户列表
    currentRestockId: '', // 当前查看的补货记录ID
    loading: false // 加载状态
  },

  onLoad() {
    // 页面加载时获取补货提醒列表
    this.fetchRestockList();
  },

  // 切换标签
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
    
    // 如果切换到补货通知标签，重新获取补货提醒列表
    if (tab === 'restock') {
      this.fetchRestockList();
    }
  },

  // 系统通知表单变化
  onSystemFormChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [`systemForm.${field}`]: e.detail.value
    });
  },

  // 活动通知表单变化
  onActivityFormChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [`activityForm.${field}`]: e.detail.value
    });
  },

  // 用户类型变化
  onUserTypeChange(e) {
    const form = e.currentTarget.dataset.form;
    const value = e.detail.value;
    this.setData({
      [`${form}Form.userType`]: value
    });
  },

  // 发送系统通知
  sendSystemNotification() {
    const { title, content, userType } = this.data.systemForm;
    
    if (!title || !content) {
      wx.showToast({
        title: '请填写完整的通知信息',
        icon: 'none'
      });
      return;
    }

    this.setData({ loading: true });

    // 调用sendNotification云函数发送通知
    wx.cloud.callFunction({
      name: 'sendNotification',
      data: {
        notificationType: 'system',
        targetUsers: ['all'], // 暂时发送给所有用户
        data: {
          title: title,
          content: content
        },
        extras: {
          scenario: 'announcement'
        }
      },
      success: (res) => {
        console.log('发送系统通知成功:', res);
        wx.showToast({
          title: '通知发送成功',
          icon: 'success'
        });
        // 清空表单
        this.setData({
          systemForm: {
            title: '',
            content: '',
            userType: 0
          }
        });
      },
      fail: (err) => {
        console.error('发送系统通知失败:', err);
        wx.showToast({
          title: '通知发送失败，请稍后重试',
          icon: 'none'
        });
      },
      complete: () => {
        this.setData({ loading: false });
      }
    });
  },

  // 发送活动通知
  sendActivityNotification() {
    const { title, description, userType } = this.data.activityForm;
    
    if (!title || !description) {
      wx.showToast({
        title: '请填写完整的活动信息',
        icon: 'none'
      });
      return;
    }

    this.setData({ loading: true });

    // 调用sendNotification云函数发送通知
    wx.cloud.callFunction({
      name: 'sendNotification',
      data: {
        notificationType: 'activity',
        targetUsers: ['all'], // 暂时发送给所有用户
        data: {
          activityName: title,
          activityDesc: description
        },
        extras: {
          scenario: 'newProduct'
        }
      },
      success: (res) => {
        console.log('发送活动通知成功:', res);
        wx.showToast({
          title: '通知发送成功',
          icon: 'success'
        });
        // 清空表单
        this.setData({
          activityForm: {
            title: '',
            description: '',
            userType: 0
          }
        });
      },
      fail: (err) => {
        console.error('发送活动通知失败:', err);
        wx.showToast({
          title: '通知发送失败，请稍后重试',
          icon: 'none'
        });
      },
      complete: () => {
        this.setData({ loading: false });
      }
    });
  },

  // 获取补货提醒列表
  fetchRestockList() {
    this.setData({ loading: true });

    const db = wx.cloud.database();
    const replenishment = db.collection('replenishment');

    replenishment
      .where({ status: 'pending' })
      .orderBy('updatedAt', 'desc')
      .get()
      .then((res) => {
        console.log('获取补货提醒列表成功:', res.data);
        this.setData({ restockList: res.data });
      })
      .catch((err) => {
        console.error('获取补货提醒列表失败:', err);
        wx.showToast({
          title: '获取补货提醒列表失败，请稍后重试',
          icon: 'none'
        });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  // 显示用户列表
  showUserList(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      showUserList: true,
      currentRestockId: id
    });
  },

  // 隐藏用户列表
  hideUserList() {
    this.setData({
      showUserList: false,
      currentRestockId: ''
    });
  },

  // 处理补货
  processReplenishment(e) {
    const id = e.currentTarget.dataset.id;
    const restockItem = this.data.restockList.find(item => item._id === id);

    if (!restockItem) {
      wx.showToast({
        title: '未找到补货记录',
        icon: 'none'
      });
      return;
    }

    wx.showModal({
      title: '确认补货',
      content: `确定 ${restockItem.productData.name} 已补货并通知用户吗？`,
      success: (res) => {
        if (res.confirm) {
          this.setData({ loading: true });

          // 先查询商品的库存状态
          const db = wx.cloud.database();
          const products = db.collection('products');

          products
            .doc(restockItem.productData.productId)
            .get()
            .then((productRes) => {
              if (!productRes.data) {
                wx.showToast({
                  title: '未找到商品信息',
                  icon: 'none'
                });
                this.setData({ loading: false });
                return;
              }

              const product = productRes.data;
              if (!product.stock || product.stock <= 0) {
                wx.showToast({
                  title: '商品库存仍为0，无法通知用户',
                  icon: 'none'
                });
                this.setData({ loading: false });
                return;
              }

              // 提取所有用户的openid
              const userOpenids = restockItem.users.map(user => user.openid);

              // 调用sendNotification云函数发送补货通知
              wx.cloud.callFunction({
                name: 'sendNotification',
                data: {
                  notificationType: 'restock',
                  targetUsers: userOpenids,
                  data: {
                    productName: restockItem.productData.name
                  },
                  extras: {
                    productId: restockItem.productData.productId
                  }
                },
                success: (notificationRes) => {
                  console.log('发送补货通知成功:', notificationRes);
                  
                  // 更新补货记录状态
                  const replenishment = db.collection('replenishment');

                  replenishment
                    .doc(id)
                    .update({
                      data: {
                        status: 'processed',
                        updatedAt: new Date()
                      }
                    })
                    .then(() => {
                      console.log('更新补货记录状态成功');
                      wx.showToast({
                        title: '补货处理成功，已通知用户',
                        icon: 'success'
                      });
                      // 重新获取补货提醒列表
                      this.fetchRestockList();
                    })
                    .catch((err) => {
                      console.error('更新补货记录状态失败:', err);
                      wx.showToast({
                        title: '更新补货记录状态失败，请稍后重试',
                        icon: 'none'
                      });
                    })
                    .finally(() => {
                      this.setData({ loading: false });
                    });
                },
                fail: (err) => {
                  console.error('发送补货通知失败:', err);
                  wx.showToast({
                    title: '发送补货通知失败，请稍后重试',
                    icon: 'none'
                  });
                  this.setData({ loading: false });
                }
              });
            })
            .catch((err) => {
              console.error('查询商品库存失败:', err);
              wx.showToast({
                title: '查询商品库存失败，请稍后重试',
                icon: 'none'
              });
              this.setData({ loading: false });
            });
        }
      }
    });
  }
});
