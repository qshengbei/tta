Page({
  data: {
    type: '',
    notifications: [],
    loading: false,
    openNotificationActionId: ''
  },

  onLoad(options) {
    this.notificationTouchStartX = 0;
    this.notificationTouchStartY = 0;
    console.log('通知列表页面加载，参数:', options);
    if (options.type) {
      // 对URL编码的类型参数进行解码
      const decodedType = decodeURIComponent(options.type);
      this.setData({ type: decodedType });
      // 设置页面标题
      wx.setNavigationBarTitle({
        title: `${decodedType}通知`
      });
      // 加载该类型的通知
      this.loadNotifications();
    }
  },

  onShow() {
    // 每次页面显示时重新加载通知，确保数据最新
    if (this.data.type) {
      this.loadNotifications();
    }
  },

  onPageTap() {
    this.closeNotificationActions();
  },

  // 加载通知消息
  async loadNotifications() {
    this.setData({ loading: true });
    try {
      // 从缓存中获取openid
      const openid = wx.getStorageSync('openid');
      
      console.log('当前用户OPENID:', openid);
      console.log('加载的通知类型:', this.data.type);
      
      const notifications = await this.fetchNotificationsInBatches(openid);
      
      console.log('加载通知消息结果，分批总数:', notifications.length);
      
      // 过滤该类型的通知，并且isDelete为false或不存在
      const filteredNotifications = notifications.filter(notification => {
        const notificationType = this.getNotificationType(notification);
        return notificationType === this.data.type && (notification.isDelete === false || notification.isDelete === undefined);
      });
      
      console.log('过滤后的通知消息:', filteredNotifications);
      
      // 为每个通知添加格式化后的时间
      const notificationsWithTime = filteredNotifications.map(notification => {
        console.log('处理通知:', notification.title, 'ID:', notification._id);
        // 尝试使用createdAt字段
        const timeField = notification.createdAt;
        if (timeField) {
          console.log('通知的时间字段:', timeField);
          try {
            let date;
            if (typeof timeField === 'string') {
              // 直接使用字符串创建日期对象
              date = new Date(timeField);
              console.log('字符串转换为日期:', date);
            } else if (timeField instanceof Date) {
              date = timeField;
              console.log('通知的时间字段是Date对象:', date);
            } else {
              date = new Date(timeField);
              console.log('其他类型转换为日期:', date);
            }
            
            // 检查日期是否有效
            if (!isNaN(date.getTime())) {
              // 使用通用时间格式化函数
              notification.formattedTime = this.formatTimeByRule(date);
              console.log('通知ID:', notification._id, '标题:', notification.title, '格式化后的时间:', notification.formattedTime);
            } else {
              console.error('日期无效:', timeField);
              notification.formattedTime = '';
            }
          } catch (error) {
            console.error('时间格式化失败:', error);
            notification.formattedTime = '';
          }
        } else {
          console.log('通知没有时间字段:', notification._id, '标题:', notification.title);
          notification.formattedTime = '';
        }
        return notification;
      });
      
      this.setData({ notifications: notificationsWithTime });
      console.log('通知数据已更新到本地');
    } catch (error) {
      console.error('加载通知消息失败', error);
      wx.showToast({ title: '加载消息失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async fetchNotificationsInBatches(openid) {
    const db = wx.cloud.database();
    const batchSize = 20;
    const maxBatches = 30;
    const allNotifications = [];

    for (let batchIndex = 0; batchIndex < maxBatches; batchIndex++) {
      const skip = batchIndex * batchSize;
      const batchRes = await db.collection('notifications')
        .where({
          openid
        })
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(batchSize)
        .get();

      const batchData = batchRes.data || [];
      allNotifications.push(...batchData);

      if (batchData.length < batchSize) {
        break;
      }
    }

    return allNotifications;
  },

  // 获取通知类型
  getNotificationType(notification) {
    const rawType = notification && notification.type;
    const title = (notification && notification.title) || '';

    if (rawType === 'orderStatusChange') {
      return '订单状态变更';
    } else if (rawType === 'restock' || title.includes('补货')) {
      return '商品补货';
    } else if (rawType === 'activity' || title.includes('活动')) {
      return '活动通知';
    } else if (rawType === 'system' || title.includes('系统')) {
      return '系统通知';
    } else if (rawType === 'general' || title.includes('欢迎')) {
      return '欢迎通知';
    } else {
      return '其他通知';
    }
  },

  // 点击通知消息
  onNotificationTap(e) {
    const { id } = e.currentTarget.dataset;
    if (this.data.openNotificationActionId) {
      this.closeNotificationActions();
      return;
    }
    // 标记消息为已读
    this.markNotificationAsRead(id);
    // 跳转到消息详情页
    wx.navigateTo({
      url: `/pages/message/detail/index?id=${id}`
    });
  },

  onNotificationTouchStart(e) {
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) {
      return;
    }
    this.notificationTouchStartX = touch.clientX;
    this.notificationTouchStartY = touch.clientY;
  },

  onNotificationTouchEnd(e) {
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) {
      return;
    }

    const actionId = e.currentTarget.dataset.id || '';
    const deltaX = touch.clientX - this.notificationTouchStartX;
    const deltaY = touch.clientY - this.notificationTouchStartY;

    if (Math.abs(deltaY) > 40) {
      return;
    }

    if (deltaX < -60) {
      this.setData({ openNotificationActionId: actionId });
      return;
    }

    if (deltaX > 40 && this.data.openNotificationActionId === actionId) {
      this.closeNotificationActions();
    }
  },

  closeNotificationActions() {
    if (!this.data.openNotificationActionId) {
      return;
    }
    this.setData({ openNotificationActionId: '' });
  },

  // 标记通知消息为已读
  async markNotificationAsRead(id) {
    try {
      console.log('开始标记通知为已读，ID:', id);
      
      // 调用云函数更新通知状态
      const result = await wx.cloud.callFunction({
        name: 'updateNotificationStatus',
        data: {
          action: 'single',
          id: id,
          status: 'read'
        }
      });
      
      console.log('标记通知为已读结果:', result);
      
      // 重新加载通知列表
      await this.loadNotifications();
      console.log('重新加载通知列表成功');
    } catch (error) {
      console.error('标记消息已读失败', error);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  async updateNotificationStatus(id, status, successMessage) {
    try {
      const result = await wx.cloud.callFunction({
        name: 'updateNotificationStatus',
        data: {
          action: 'single',
          id,
          status
        }
      });

      if (!(result && result.result && result.result.success)) {
        throw new Error((result && result.result && result.result.error) || '更新失败');
      }

      this.closeNotificationActions();
      await this.loadNotifications();
      if (successMessage) {
        wx.showToast({ title: successMessage, icon: 'success' });
      }
    } catch (error) {
      console.error('更新通知状态失败', error);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  onNotificationMarkRead(e) {
    const { id } = e.currentTarget.dataset;
    this.updateNotificationStatus(id, 'read', '已标记为已读');
  },

  onNotificationMarkUnread(e) {
    const { id } = e.currentTarget.dataset;
    this.updateNotificationStatus(id, 'unread', '已标记为未读');
  },

  async onNotificationDelete(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) {
      return;
    }

    try {
      const result = await wx.cloud.callFunction({
        name: 'updateNotificationStatus',
        data: {
          action: 'delete',
          id
        }
      });

      if (!(result && result.result && result.result.success)) {
        throw new Error((result && result.result && result.result.error) || '删除失败');
      }

      this.closeNotificationActions();
      await this.loadNotifications();
      wx.showToast({ title: '已删除', icon: 'success' });
    } catch (error) {
      console.error('删除通知失败', error);
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  // 返回上一页
  onBack() {
    wx.navigateBack({ delta: 1 });
  },

  // 格式化时间
  formatTime(time) {
    if (!time) return '';
    const date = new Date(time);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      // 当天显示时分秒
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const seconds = date.getSeconds().toString().padStart(2, '0');
      return `${hours}:${minutes}:${seconds}`;
    } else if (days === 1) {
      // 昨天显示"昨天"
      return '昨天';
    } else if (days === 2) {
      // 前天显示"前天"
      return '前天';
    } else if (days < 365) {
      // 当年显示月日
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      return `${month}-${day}`;
    } else {
      // 往年显示年月日
      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  },

  // 通用时间格式化函数，根据时间规则显示不同格式
  formatTimeByRule: function(time) {
    if (!time) return '';
    
    try {
      let date;
      if (typeof time === 'string') {
        date = new Date(time);
      } else if (time instanceof Date) {
        date = time;
      } else {
        date = new Date(time);
      }
      
      // 检查日期是否有效
      if (isNaN(date.getTime())) {
        console.error('日期无效:', time);
        return '';
      }
      
      const now = new Date();
      
      // 重置时间部分为0，只比较日期
      const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      const diffTime = nowOnly - dateOnly;
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      
      // 补零函数
      function padZero(num) {
        return num < 10 ? '0' + num : num.toString();
      }
      
      const year = date.getFullYear();
      const month = padZero(date.getMonth() + 1);
      const day = padZero(date.getDate());
      const hours = padZero(date.getHours());
      const minutes = padZero(date.getMinutes());
      const seconds = padZero(date.getSeconds());
      const currentYear = now.getFullYear();
      
      if (diffDays === 0) {
        // 当天，显示时分
        return `${hours}:${minutes}`;
      } else if (diffDays === 1) {
        // 昨天，显示昨天 时分
        return `昨天 ${hours}:${minutes}`;
      } else if (diffDays === 2) {
        // 前天，显示前天 时分
        return `前天 ${hours}:${minutes}`;
      } else {
        // 更久的时间
        if (year === currentYear) {
          // 当年，显示月-日 时分
          return `${month}-${day} ${hours}:${minutes}`;
        } else {
          // 往年，显示年月日 时分
          return `${year}-${month}-${day} ${hours}:${minutes}`;
        }
      }
    } catch (error) {
      console.error('时间格式化失败:', error);
      return '';
    }
  },

  // 标记所有通知为已读
  async markAllAsRead() {
    try {
      console.log('开始标记所有通知为已读，类型:', this.data.type);
      
      // 检查是否所有通知都是已读状态
      const allRead = this.data.notifications.every(notification => notification.status === 'read');
      if (allRead) {
        console.log('所有通知都是已读状态，无需操作');
        wx.showToast({ title: '已全部标记为已读', icon: 'success' });
        return;
      }
      
      // 调用云函数更新所有通知状态
      const result = await wx.cloud.callFunction({
        name: 'updateNotificationStatus',
        data: {
          action: 'all',
          type: this.data.type,
          status: 'read'
        }
      });
      
      console.log('标记所有通知为已读结果:', result);

      if (!(result && result.result && result.result.success)) {
        throw new Error((result && result.result && result.result.error) || '更新失败');
      }

      // 幂等处理：updatedCount=0 可能是刚被其他页面标记过已读，仍视为成功并刷新
      console.log('批量已读更新数量:', result.result.updatedCount || 0);
      
      // 重新加载通知列表
      await this.loadNotifications();
      console.log('重新加载通知列表成功');
      
      wx.showToast({ title: '已全部标记为已读', icon: 'success' });
    } catch (error) {
      console.error('标记所有消息已读失败', error);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  }
});
