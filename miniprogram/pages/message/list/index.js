Page({
  data: {
    type: '',
    notifications: [],
    loading: false,
    loadingMore: false,
    hasMore: true,
    pageNum: 0,
    pageSize: 20,
    openNotificationActionId: '',
    openid: '',
    hasNavigatedToDetail: false
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
      // 获取并保存 openid，确保分页时使用相同的用户标识
      const openid = wx.getStorageSync('openid');
      this.setData({ openid });
      // 加载该类型的通知（首次加载）
      this.loadNotifications(true);
    }
  },

  onShow() {
    // 从通知详情返回时保持列表数据与滚动位置，不重新请求
    if (this.data.hasNavigatedToDetail) {
      this.setData({ hasNavigatedToDetail: false });
      return;
    }
  },

  onPageTap() {
    this.closeNotificationActions();
  },

  // 加载通知消息
  async loadNotifications(reset = false) {
    // 如果是重置，清空现有数据，重置分页
    if (reset) {
      this.setData({ 
        notifications: [], 
        pageNum: 0, 
        hasMore: true,
        loading: true 
      });
    }
    
    try {
      // 使用页面初始化时保存的 openid，确保分页时使用相同的用户标识
      const openid = this.data.openid;
      if (!openid) {
        console.error('[通知列表] openid 为空，无法查询通知');
        return;
      }
      const notifications = await this.fetchNotificationsByType(openid);
      
      if (notifications.length > 0) {
        // 为每个通知添加格式化后的时间
        const notificationsWithTime = notifications.map(notification => {
          notification.formattedTime = this.formatTimeSimple(notification.createdAt);
          return notification;
        });
        
        // 如果是重置，直接替换数据；否则追加数据
        if (reset) {
          this.setData({ notifications: notificationsWithTime });
        } else {
          this.setData({ 
            notifications: [...this.data.notifications, ...notificationsWithTime] 
          });
        }
        
        // 检查是否还有更多数据
        this.setData({ hasMore: notifications.length === this.data.pageSize });
      } else {
        this.setData({ hasMore: false });
      }
    } catch (error) {
      console.error('加载通知消息失败', error);
      wx.showToast({ title: '加载消息失败', icon: 'none' });
    } finally {
      this.setData({ loading: false, loadingMore: false });
    }
  },

  // 加载更多通知
  async loadMoreNotifications() {
    console.log('[通知列表] loadMoreNotifications 被调用', {
      loadingMore: this.data.loadingMore,
      hasMore: this.data.hasMore,
      currentPage: this.data.pageNum,
      currentCount: this.data.notifications.length
    });
    
    // 如果正在加载或没有更多数据，不执行
    if (this.data.loadingMore || !this.data.hasMore) {
      console.log('[通知列表] 不执行加载：loadingMore=', this.data.loadingMore, 'hasMore=', this.data.hasMore);
      return;
    }
    
    this.setData({ loadingMore: true });
    this.setData({ pageNum: this.data.pageNum + 1 });
    console.log('[通知列表] 开始加载第', this.data.pageNum, '页');
    await this.loadNotifications(false);
  },

  async fetchNotificationsByType(openid) {
    const db = wx.cloud.database();
    const _ = db.command;
    
    // 获取该类型对应的所有原始类型值
    const typeMap = {
      '订单状态变更': ['orderStatusChange'],
      '商品补货': ['restock'],
      '活动通知': ['activity'],
      '系统通知': ['system'],
      '欢迎通知': ['welcome']
    };
    
    const rawTypes = typeMap[this.data.type] || [];
    
    const skip = this.data.pageNum * this.data.pageSize;
    
    console.log('[通知列表] 查询条件:', {
      openid: openid ? '有值' : '为空',
      type: this.data.type,
      rawTypes,
      skip,
      pageSize: this.data.pageSize
    });
    
    // 直接查询指定类型的通知，避免先全量查询再过滤
    const result = await db.collection('notifications')
      .where({
        openid,
        isDelete: _.eq(false),
        type: _.in(rawTypes.length > 0 ? rawTypes : ['orderStatusChange', 'restock', 'activity', 'system', 'welcome'])
      })
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(this.data.pageSize)
      .get();

    console.log('[通知列表] 查询结果:', {
      total: result.data.length,
      firstItemOpenid: result.data.length > 0 ? result.data[0].openid : 'N/A',
      lastItemOpenid: result.data.length > 0 ? result.data[result.data.length - 1].openid : 'N/A'
    });
    
    return result.data || [];
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
    } else if (rawType === 'welcome' || title.includes('欢迎')) {
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
    // 标记消息为已读（仅更新本地，不刷新列表）
    this.markNotificationAsRead(id, { skipReload: true });
    this.setData({ hasNavigatedToDetail: true });
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

  updateNotificationLocalStatus(id, status) {
    const notifications = this.data.notifications.map((item) =>
      item._id === id ? { ...item, status } : item
    );
    this.setData({ notifications });
  },

  // 标记通知消息为已读
  async markNotificationAsRead(id, options = {}) {
    const { skipReload = false } = options;
    try {
      const result = await wx.cloud.callFunction({
        name: 'updateNotificationStatus',
        data: {
          action: 'single',
          id: id,
          status: 'read'
        }
      });

      if (!(result && result.result && result.result.success)) {
        throw new Error((result && result.result && result.result.error) || '更新失败');
      }

      this.updateNotificationLocalStatus(id, 'read');

      if (!skipReload) {
        await this.loadNotifications(true);
      }
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
      this.updateNotificationLocalStatus(id, status);
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
      const notifications = this.data.notifications.filter((item) => item._id !== id);
      this.setData({ notifications });
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

  // 优化的时间格式化函数 - 简单高效
  formatTimeSimple(time) {
    if (!time) return '';
    
    const date = typeof time === 'string' ? new Date(time) : (time instanceof Date ? time : new Date(time));
    
    if (isNaN(date.getTime())) {
      return '';
    }
    
    const now = new Date();
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.floor((nowOnly - dateOnly) / (1000 * 60 * 60 * 24));
    
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const year = date.getFullYear();
    const currentYear = now.getFullYear();
    
    if (diffDays === 0) {
      return `${hours}:${minutes}`;
    } else if (diffDays === 1) {
      return `昨天 ${hours}:${minutes}`;
    } else if (diffDays === 2) {
      return `前天 ${hours}:${minutes}`;
    } else if (year === currentYear) {
      return `${month}-${day} ${hours}:${minutes}`;
    } else {
      return `${year}-${month}-${day} ${hours}:${minutes}`;
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
      
      const notifications = this.data.notifications.map((item) => ({
        ...item,
        status: 'read'
      }));
      this.setData({ notifications });

      wx.showToast({ title: '已全部标记为已读', icon: 'success' });
    } catch (error) {
      console.error('标记所有消息已读失败', error);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  }
});
