const DEBUG_LOG = false;
const debugLog = (...args) => {
  if (DEBUG_LOG) console.log(...args);
};
const NOTIFICATION_CATEGORY_CONFIGS = [
  { label: '订单状态变更', rawTypes: ['orderStatusChange'], priority: 1 },
  { label: '商品补货', rawTypes: ['restock'], priority: 2 },
  { label: '活动通知', rawTypes: ['activity'], priority: 3 },
  { label: '系统通知', rawTypes: ['system'], priority: 4 },
  { label: '欢迎通知', titleKeyword: '欢迎', priority: 5 }
];

Page({
  data: {
    notifications: [],
    sessions: [],
    loading: false,
    refreshing: false,
    openid: '',
    isCustomerService: false,
    pageVisible: false,
    openNotificationActionKey: ''
  },

  onLoad() {
    this.notificationTouchStartX = 0;
    this.notificationTouchStartY = 0;
    this.getOpenId();
  },

  onPageTap() {
    this.closeNotificationActions();
  },

  // 获取用户的openid并检查是否是客服
  async getOpenId() {
    try {
      // 先从缓存中获取openid
      const cachedOpenId = wx.getStorageSync('openid');
      if (cachedOpenId) {
        console.log('从缓存获取到用户OPENID:', cachedOpenId);
        this.setData({ openid: cachedOpenId });
        // 检查用户是否是客服
        await this.checkIfCustomerService(cachedOpenId);
        // 根据用户身份加载消息数据
        await this.loadMessages();
        // 开始监听会话变化
        this.listenSessions();
      } else {
        // 缓存中没有openid，调用云函数获取
        const res = await wx.cloud.callFunction({
          name: 'login'
        });
        if (res.result && res.result.openid) {
          console.log('获取到用户OPENID:', res.result.openid);
          // 缓存openid
          wx.setStorageSync('openid', res.result.openid);
          this.setData({ openid: res.result.openid });
          // 检查用户是否是客服
          await this.checkIfCustomerService(res.result.openid);
          // 根据用户身份加载消息数据
          await this.loadMessages();
          // 开始监听会话变化
          this.listenSessions();
        }
      }
    } catch (error) {
      console.error('获取openid失败', error);
      // 加载默认数据
      // this.loadMessages(); // 注释掉，避免重复加载
    }
  },

  // 检查用户是否是客服
  async checkIfCustomerService(openid) {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('customer_service_status')
        .where({ customerServiceId: openid })
        .get();
      if (res.data.length > 0) {
        console.log('用户是客服');
        this.setData({ isCustomerService: true });
      } else {
        console.log('用户不是客服');
        this.setData({ isCustomerService: false });
      }
    } catch (error) {
      console.error('检查客服身份失败', error);
      this.setData({ isCustomerService: false });
    }
  },

  // 根据用户身份加载消息数据
  async loadMessages() {
    const { isCustomerService } = this.data;
    if (isCustomerService) {
      // 先保证会话列表可用，再延后通知统计，避免阻塞首屏和会话交互。
      await this.loadAllSessions();
    } else {
      // 先保证会话列表可用，再延后通知统计，避免阻塞首屏和会话交互。
      await this.loadSessions();
    }
    setTimeout(() => {
      if (this.data.pageVisible) {
        this.loadNotifications();
      }
    }, 300);
  },

  async reloadSessionsOnly() {
    const { isCustomerService } = this.data;
    if (isCustomerService) {
      await this.loadAllSessions();
    } else {
      await this.loadSessions();
    }
  },

  onShow() {
    this.setData({ pageVisible: true });
    // 页面可见后先恢复会话数据，再异步补通知统计。
    this.loadMessages();
    // 重新初始化会话监听
    if (this.sessionListener) {
      this.sessionListener.close();
      console.log('关闭旧的会话监听');
    }
    console.log('重新初始化会话监听');
    this.listenSessions();
  },

  onHide() {
    this.setData({ pageVisible: false });
    if (this._sessionReloadTimer) {
      clearTimeout(this._sessionReloadTimer);
      this._sessionReloadTimer = null;
    }
    // 进入聊天页后暂停消息页监听，避免每条会话变更都触发通知统计。
    if (this.sessionListener) {
      this.sessionListener.close();
      this.sessionListener = null;
      console.log('消息页隐藏，暂停会话监听');
    }
  },

  // 监听会话变化
  listenSessions() {
    const { isCustomerService } = this.data;
    try {
      const db = wx.cloud.database();
      let query;
      
      if (isCustomerService) {
        // 客服身份：监听所有会话
        query = db.collection('sessions');
        console.log('客服身份，监听所有会话');
      } else {
        // 普通用户身份：监听自己的会话
        const cachedOpenId = wx.getStorageSync('openid');
        if (cachedOpenId) {
          query = db.collection('sessions').where({ userId: cachedOpenId });
          console.log('普通用户身份，监听自己的会话，openid:', cachedOpenId);
        } else {
          console.error('没有openid，无法监听会话');
          return;
        }
      }
      
      // 监听会话变化
      this.sessionListener = query.watch({
        onChange: (snapshot) => {
          if (!this.data.pageVisible) return;
          console.log('会话变化:', snapshot);
          // 会话与通知是两套系统：这里只做会话刷新，不做通知统计。
          this.scheduleSessionReload();
        },
        onError: (error) => {
          console.error('监听会话失败:', error);
        }
      });
      
      console.log('开始监听会话变化');
    } catch (error) {
      console.error('初始化会话监听失败:', error);
    }
  },

  scheduleSessionReload() {
    if (this._sessionReloadTimer) return;
    this._sessionReloadTimer = setTimeout(async () => {
      this._sessionReloadTimer = null;
      if (!this.data.pageVisible) return;
      await this.reloadSessionsOnly();
    }, 200);
  },

  onUnload() {
    this.setData({ pageVisible: false });
    if (this._sessionReloadTimer) {
      clearTimeout(this._sessionReloadTimer);
      this._sessionReloadTimer = null;
    }
    // 页面卸载时取消监听
    if (this.sessionListener) {
      this.sessionListener.close();
      this.sessionListener = null;
      console.log('取消监听会话变化');
    }
  },

  // 加载所有用户的客服会话（客服身份）
  getSessionPreviewText(lastMessage = {}) {
    if (!lastMessage || typeof lastMessage !== 'object') return '[暂无消息]';

    const type = lastMessage.type || 'text';
    const status = lastMessage.status || '';
    const senderOpenid = lastMessage.openid || lastMessage._openid || '';

    if (status === 'revoked' || type === 'revoked') {
      return senderOpenid && this.data.openid && senderOpenid === this.data.openid
        ? '您撤回了一条消息'
        : '对方撤回了一条消息';
    }

    if (type === 'image') return '[图片]';
    if (type === 'video') return '[视频]';
    if (type === 'product_card') return '[商品卡片]';
    if (type === 'order_card') return '[订单卡片]';
    if (type === 'location') {
      const raw = lastMessage.content;
      if (raw && typeof raw === 'object') {
        return raw.name ? `[位置] ${raw.name}` : '[位置]';
      }
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          return parsed && parsed.name ? `[位置] ${parsed.name}` : '[位置]';
        } catch (e) {
          return '[位置]';
        }
      }
      return '[位置]';
    }

    const content = lastMessage.content;
    if (typeof content === 'string') {
      const trimmed = content.trim();
      return trimmed || '[暂无消息]';
    }
    if (content === null || typeof content === 'undefined') {
      return '[暂无消息]';
    }
    return '[消息]';
  },

  async loadAllSessions() {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('sessions')
        .orderBy('lastMessageTime', 'desc')
        .get();
      
      console.log('原始会话数据:', res.data);
      
      // 处理会话数据，使用 formatTimeByRule 函数格式化时间
      const sessions = await Promise.all(res.data.map(async session => {
        if (session.lastMessageTime) {
          try {
            // 使用 formatTimeByRule 函数格式化时间
            session.lastMessageTime = this.formatTimeByRule(session.lastMessageTime);
          } catch (error) {
            // 处理错误，使用当前时间
            session.lastMessageTime = this.formatTimeByRule(new Date());
          }
        } else {
          // 如果没有时间，使用当前时间
          session.lastMessageTime = this.formatTimeByRule(new Date());
        }
        
        // 根据身份获取正确的未读数量
        const isCustomerService = this.data.isCustomerService;
        if (isCustomerService) {
          // 客服身份：检查unreadCountCustomerService字段
          if (session.unreadCountCustomerService !== undefined) {
            session.unreadCount = session.unreadCountCustomerService;
          } else {
            // 如果unreadCountCustomerService字段不存在，尝试从其他字段获取
            session.unreadCount = session.unreadCount || 0;
            console.warn('会话缺少unreadCountCustomerService字段:', session._id);
          }
        } else {
          // 普通用户身份：使用unreadCountUser字段
          session.unreadCount = session.unreadCountUser || 0;
        }
        console.log('会话未读数量:', {
          sessionId: session._id,
          isCustomerService,
          unreadCount: session.unreadCount,
          unreadCountCustomerService: session.unreadCountCustomerService,
          unreadCountUser: session.unreadCountUser
        });

        const lm = session.lastMessage || {};
        console.log('客服消息卡片(lastMessage)状态:', {
          sessionId: session._id,
          type: lm.type,
          status: lm.status,
          content: lm.content
        });

        session.lastMessagePreview = this.getSessionPreviewText(session.lastMessage);
        
        // 获取用户信息
        if (session.userId) {
          try {
            const userRes = await db.collection('users').where({ _openid: session.userId }).get();
            if (userRes.data.length > 0) {
              session.userInfo = userRes.data[0];
            }
          } catch (error) {
            console.error('获取用户信息失败', error);
          }
        }
        
        return session;
      }));
      
      console.log('处理后的所有会话数据:', sessions);
      console.warn('客服消息卡片状态汇总(loadAllSessions):', sessions.map((s) => ({
        sessionId: s && s._id,
        type: s && s.lastMessage && s.lastMessage.type,
        status: s && s.lastMessage && s.lastMessage.status
      })));
      console.error('客服消息卡片状态汇总(loadAllSessions-json):', JSON.stringify(
        sessions.map((s) => ({
          sessionId: s && s._id,
          type: s && s.lastMessage && s.lastMessage.type,
          status: s && s.lastMessage && s.lastMessage.status
        }))
      ));
      this.setData({ sessions });
      this.preloadSessionBatch(sessions);
    } catch (error) {
      console.error('加载所有会话失败', error);
    }
  },

  // 加载通知消息
  async loadNotifications() {
    this.setData({ loading: true });
    try {
      const openid = wx.getStorageSync('openid');

      console.log('当前用户OPENID:', openid);

      if (!openid) {
        this.setData({ notifications: [] });
        return;
      }

      const notificationSummaries = await this.loadNotificationSummaries(openid);
      this.setData({ notifications: notificationSummaries });
      console.log('通知数据已更新到本地');
      console.log('通知数据长度:', notificationSummaries.length);
    } catch (error) {
      console.error('加载通知消息失败', error);
      wx.showToast({ title: '加载消息失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadNotificationSummaries(openid) {
    const summaryResults = await Promise.all(
      NOTIFICATION_CATEGORY_CONFIGS.map(config => this.fetchNotificationCategorySummary(openid, config))
    );

    return summaryResults
      .filter(Boolean)
      .sort((a, b) => (a.priority || 999) - (b.priority || 999));
  },

  buildNotificationQuery(openid, rawTypes, extraQuery = {}, titleKeyword = '') {
    const db = wx.cloud.database();
    const query = {
      openid,
      isDelete: db.command.neq(true),
      ...extraQuery
    };

    if (rawTypes && rawTypes.length > 0) {
      query.type = rawTypes.length === 1 ? rawTypes[0] : db.command.in(rawTypes);
    }

    if (titleKeyword) {
      query.title = db.RegExp({
        regexp: titleKeyword,
        options: 'i'
      });
    }

    return query;
  },

  async fetchNotificationCategorySummary(openid, config) {
    const db = wx.cloud.database();
    const baseQuery = this.buildNotificationQuery(openid, config.rawTypes, {}, config.titleKeyword || '');
    const unreadQuery = this.buildNotificationQuery(openid, config.rawTypes, { status: 'unread' }, config.titleKeyword || '');

    const [latestRes, unreadCountRes, totalCountRes] = await Promise.all([
      db.collection('notifications')
        .where(baseQuery)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get(),
      db.collection('notifications')
        .where(unreadQuery)
        .count(),
      db.collection('notifications')
        .where(baseQuery)
        .count()
    ]);

    const latestNotification = latestRes.data && latestRes.data[0];
    if (!latestNotification) {
      return null;
    }

    const timeField = latestNotification.createdAt || latestNotification.createTime;
    let formattedTime = '';
    if (timeField) {
      const parsedDate = typeof timeField === 'string' || timeField instanceof Date
        ? new Date(timeField)
        : new Date(timeField);
      if (!isNaN(parsedDate.getTime())) {
        formattedTime = this.formatTimeByRule(parsedDate);
      }
    }

    return {
      ...latestNotification,
      type: config.label,
      categoryTitle: config.label,
      unreadCount: (unreadCountRes && unreadCountRes.total) || 0,
      totalCount: (totalCountRes && totalCountRes.total) || 0,
      formattedTime,
      priority: config.priority
    };
  },

  // 通知分类和优先级排序
  categorizeAndPrioritizeNotifications(notifications) {
    // 通知类型优先级映射
    const priorityMap = {
      '订单状态变更': 1,
      '商品补货': 2,
      '活动通知': 3,
      '系统通知': 4,
      '欢迎通知': 5,
      '其他通知': 6
    };
    
    // 按类型分组
    const groupedNotifications = {};
    notifications.forEach(notification => {
      const type = this.getNotificationType(notification);
      if (!groupedNotifications[type]) {
        groupedNotifications[type] = [];
      }
      groupedNotifications[type].push(notification);
    });
    
    // 按优先级排序类型
    const sortedTypes = Object.keys(groupedNotifications).sort((a, b) => {
      return (priorityMap[a] || 999) - (priorityMap[b] || 999);
    });
    
    // 构建最终的通知列表，每个类型只显示最新一条
    const result = [];
    sortedTypes.forEach(type => {
      const typeNotifications = groupedNotifications[type];
      if (typeNotifications.length > 0) {
        // 按时间倒序排序，取最新的一条
        typeNotifications.sort((a, b) => {
          return new Date(b.createdAt) - new Date(a.createdAt);
        });
        const latestNotification = {
          ...typeNotifications[0]
        };
        // 添加类型信息
        latestNotification.type = type;
        latestNotification.categoryTitle = type;
        // 计算未读消息数量
        latestNotification.unreadCount = typeNotifications.filter(notification => notification.status === 'unread').length;
        // 存储该类型的总通知数量
        latestNotification.totalCount = typeNotifications.length;
        result.push(latestNotification);
      }
    });
    
    return result;
  },

  // 获取通知类型
  getNotificationType(notification) {
    const rawType = notification && notification.type;
    const title = (notification && notification.title) || '';

    if (rawType === 'orderStatusChange' || title.includes('订单')) {
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

  // 加载客服会话
  async loadSessions() {
    try {
      const db = wx.cloud.database();
      // 从缓存中获取openid
      const openid = wx.getStorageSync('openid');
      
      const res = await db.collection('sessions')
        .where({ userId: openid })
        .orderBy('lastMessageTime', 'desc')
        .get();
      
      console.log('原始会话数据:', res.data);
      
      // 处理会话数据，将 lastMessageTime 格式化为 "年月日时分" 格式
      const sessions = res.data.map(session => {
        if (session.lastMessageTime) {
          try {
            // 尝试将 lastMessageTime 转换为日期对象
            let date;
            if (typeof session.lastMessageTime === 'string') {
              date = new Date(session.lastMessageTime);
            } else if (session.lastMessageTime instanceof Date) {
              date = session.lastMessageTime;
            } else {
              // 如果是对象，尝试直接转换为日期
              date = new Date(session.lastMessageTime);
            }
            
            // 检查日期是否有效
            if (!isNaN(date.getTime())) {
              // 格式化日期为 "年月日时分" 格式
              const year = date.getFullYear();
              const month = (date.getMonth() + 1).toString().padStart(2, '0');
              const day = date.getDate().toString().padStart(2, '0');
              const hours = date.getHours().toString().padStart(2, '0');
              const minutes = date.getMinutes().toString().padStart(2, '0');
              session.lastMessageTime = `${year}-${month}-${day} ${hours}:${minutes}`;
            } else {
              // 如果日期无效，使用当前时间
              const now = new Date();
              const year = now.getFullYear();
              const month = (now.getMonth() + 1).toString().padStart(2, '0');
              const day = now.getDate().toString().padStart(2, '0');
              const hours = now.getHours().toString().padStart(2, '0');
              const minutes = now.getMinutes().toString().padStart(2, '0');
              session.lastMessageTime = `${year}-${month}-${day} ${hours}:${minutes}`;
            }
          } catch (error) {
            // 处理错误，使用当前时间
            const now = new Date();
            const year = now.getFullYear();
            const month = (now.getMonth() + 1).toString().padStart(2, '0');
            const day = now.getDate().toString().padStart(2, '0');
            const hours = now.getHours().toString().padStart(2, '0');
            const minutes = now.getMinutes().toString().padStart(2, '0');
            session.lastMessageTime = `${year}-${month}-${day} ${hours}:${minutes}`;
          }
        } else {
          // 如果没有时间，使用当前时间
          const now = new Date();
          const year = now.getFullYear();
          const month = (now.getMonth() + 1).toString().padStart(2, '0');
          const day = now.getDate().toString().padStart(2, '0');
          const hours = now.getHours().toString().padStart(2, '0');
          const minutes = now.getMinutes().toString().padStart(2, '0');
          session.lastMessageTime = `${year}-${month}-${day} ${hours}:${minutes}`;
        }
        
        // 根据身份获取正确的未读数量
        const isCustomerService = this.data.isCustomerService;
        if (isCustomerService) {
          // 客服身份：检查unreadCountCustomerService字段
          if (session.unreadCountCustomerService !== undefined) {
            session.unreadCount = session.unreadCountCustomerService;
          } else {
            // 如果unreadCountCustomerService字段不存在，尝试从其他字段获取
            session.unreadCount = session.unreadCount || 0;
            console.warn('会话缺少unreadCountCustomerService字段:', session._id);
          }
        } else {
          // 普通用户身份：使用unreadCountUser字段
          session.unreadCount = session.unreadCountUser || 0;
        }
        console.log('会话未读数量:', {
          sessionId: session._id,
          isCustomerService,
          unreadCount: session.unreadCount,
          unreadCountCustomerService: session.unreadCountCustomerService,
          unreadCountUser: session.unreadCountUser
        });

        const lm = session.lastMessage || {};
        console.log('客服消息卡片(lastMessage)状态:', {
          sessionId: session._id,
          type: lm.type,
          status: lm.status,
          content: lm.content
        });

        session.lastMessagePreview = this.getSessionPreviewText(session.lastMessage);
        
        return session;
      });
      
      console.log('处理后的会话数据:', sessions);
      console.warn('客服消息卡片状态汇总(loadSessions):', sessions.map((s) => ({
        sessionId: s && s._id,
        type: s && s.lastMessage && s.lastMessage.type,
        status: s && s.lastMessage && s.lastMessage.status
      })));
      console.error('客服消息卡片状态汇总(loadSessions-json):', JSON.stringify(
        sessions.map((s) => ({
          sessionId: s && s._id,
          type: s && s.lastMessage && s.lastMessage.type,
          status: s && s.lastMessage && s.lastMessage.status
        }))
      ));
      this.setData({ sessions });
      this.preloadSessionBatch(sessions);
    } catch (error) {
      console.error('加载会话失败', error);
    }
  },
  async preloadSessionBatch(sessions = []) {
    if (!sessions.length) return;
    // 消息页加载后即预热会话，点击卡片时可秒开
    const preloadTasks = sessions.map((session) => this.preloadSessionMessages(session._id));
    try {
      await Promise.all(preloadTasks);
    } catch (error) {
      console.error('批量预加载会话失败', error);
    }
  },

  // 点击通知消息
  async onNotificationTap(e) {
    const { id, type, totalCount } = e.currentTarget.dataset;
    if (this.data.openNotificationActionKey) {
      this.closeNotificationActions();
      return;
    }

    try {
      // 转换totalCount为数字类型
      const count = Number(totalCount);
      console.log('通知类型:', type, '总数量:', count);
      
      // 如果该类型的通知总数为1，直接跳转到通知详情页，并标记为已读
      // 如果该类型的通知总数大于1，跳转到通知列表页面，不标记为已读
      if (count === 1) {
        // 标记通知为已读
        await this.markNotificationAsRead(id);
        wx.navigateTo({
          url: `/pages/message/detail/index?id=${id}`
        });
      } else {
        wx.navigateTo({
          url: `/pages/message/list/index?type=${encodeURIComponent(type)}`
        });
      }
    } catch (error) {
      console.error('跳转失败', error);
      wx.showToast({ title: '跳转失败', icon: 'none' });
    }
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

    const actionKey = e.currentTarget.dataset.actionKey || '';
    const deltaX = touch.clientX - this.notificationTouchStartX;
    const deltaY = touch.clientY - this.notificationTouchStartY;

    if (Math.abs(deltaY) > 40) {
      return;
    }

    if (deltaX < -60) {
      this.setData({ openNotificationActionKey: actionKey });
      return;
    }

    if (deltaX > 40 && this.data.openNotificationActionKey === actionKey) {
      this.closeNotificationActions();
    }
  },

  closeNotificationActions() {
    if (!this.data.openNotificationActionKey) {
      return;
    }
    this.setData({ openNotificationActionKey: '' });
  },

  async onNotificationCardMarkRead(e) {
    const { type, unreadCount } = e.currentTarget.dataset;
    this.closeNotificationActions();

    if (!type) {
      return;
    }

    if (!Number(unreadCount)) {
      wx.showToast({ title: '当前卡片已全部已读', icon: 'none' });
      return;
    }

    try {
      const result = await wx.cloud.callFunction({
        name: 'updateNotificationStatus',
        data: {
          action: 'all',
          type,
          status: 'read'
        }
      });

      if (!(result && result.result && result.result.success)) {
        throw new Error((result && result.result && result.result.error) || '更新失败');
      }

      await this.loadNotifications();
      wx.showToast({ title: '已标记为已读', icon: 'success' });
    } catch (error) {
      console.error('标记卡片已读失败', error);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 点击客服会话
  async onSessionTap(e) {
    const { sessionId } = e.currentTarget.dataset;
    // 先启动预加载，页面状态切换与监听清理异步执行，避免阻塞预加载启动。
    const preloadTask = this.preloadSessionMessages(sessionId);
    Promise.resolve().then(() => {
      this.setData({ pageVisible: false });
      if (this._sessionReloadTimer) {
        clearTimeout(this._sessionReloadTimer);
        this._sessionReloadTimer = null;
      }
      if (this.sessionListener) {
        this.sessionListener.close();
        this.sessionListener = null;
      }
    });
    await preloadTask;
    const app = getApp();
    const preloadPayload = (app.globalData && app.globalData.chatPreloadMap && app.globalData.chatPreloadMap[sessionId]) || wx.getStorageSync(`chat_preload_${sessionId}`) || {};
    const anchorMessageId = preloadPayload.latestMessageId || '';
    const anchorParam = anchorMessageId ? `&anchorMessageId=${encodeURIComponent(anchorMessageId)}` : '';
    wx.navigateTo({
      url: `/pages/message/service/index?sessionId=${sessionId}${anchorParam}`
    });
  },
  async preloadSessionMessages(sessionId, force = false) {
    try {
      const app = getApp();
      if (!app.globalData.chatPreloadMap) {
        app.globalData.chatPreloadMap = {};
      }
      const localCache = app.globalData.chatPreloadMap[sessionId] || wx.getStorageSync(`chat_preload_${sessionId}`);
      // 30秒内缓存有效，避免重复请求
      if (!force && localCache && (Date.now() - (localCache.preloadAt || 0) < 30 * 1000)) {
        return;
      }
      const db = wx.cloud.database();
      const pageSize = 20;
      const res = await db.collection('messages')
        .where({ sessionId })
        .orderBy('createTime', 'desc')
        .limit(pageSize)
        .get();
      const preloadPayload = {
        sessionId,
        messages: res.data || [],
        latestMessageId: (res.data && res.data[0] && res.data[0]._id) || '',
        hasMoreHistory: (res.data || []).length === pageSize,
        preloadAt: Date.now()
      };
      app.globalData.chatPreloadMap[sessionId] = preloadPayload;
      wx.setStorageSync(`chat_preload_${sessionId}`, preloadPayload);
    } catch (error) {
      console.error('预加载会话消息失败', error);
    }
  },

  // 标记通知消息为已读
  async markNotificationAsRead(id) {
    try {
      console.log('开始标记通知为已读，ID:', id);
      
      // 调用云函数更新通知状态
      const res = await wx.cloud.callFunction({
        name: 'updateNotificationStatus',
        data: {
          action: 'single',
          id: id,
          status: 'read'
        }
      });
      
      console.log('云函数返回结果:', res.result);
      
      if (res.result.success) {
        console.log('通知状态更新成功');
      } else {
        console.error('通知状态更新失败:', res.result.error);
        wx.showToast({ title: '操作失败', icon: 'none' });
      }
      
      // 强制重新加载通知列表
      await this.loadNotifications();
      console.log('重新加载通知列表成功');
    } catch (error) {
      console.error('标记消息已读失败', error);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 标记所有通知消息为已读
  async markAllAsRead() {
    try {
      // 先重新加载通知数据，确保使用最新的通知状态
      await this.loadNotifications();
      
      // 检查是否所有通知都是已读状态
      let allRead = true;
      for (const notification of this.data.notifications) {
        if (notification.unreadCount > 0) {
          allRead = false;
          break;
        }
      }
      
      if (allRead) {
        console.log('所有通知都是已读状态，无需操作');
        wx.showToast({ title: '已全部标记为已读', icon: 'success' });
        return;
      }
      
      // 从缓存中获取openid
      let openid = wx.getStorageSync('openid');
      console.log('当前用户OPENID:', openid);
      
      if (!openid) {
        const loginRes = await wx.cloud.callFunction({
          name: 'login'
        });
        if (loginRes.result && loginRes.result.openid) {
          openid = loginRes.result.openid;
          console.log('从login云函数获取到OPENID:', openid);
        } else {
          throw new Error('获取OPENID失败');
        }
      }
      
      console.log('开始标记所有通知为已读');
      
      // 调用云函数更新所有通知状态
      const res = await wx.cloud.callFunction({
        name: 'updateNotificationStatus',
        data: {
          action: 'all',
          openid: openid,
          status: 'read'
        }
      });
      
      console.log('云函数返回结果:', res.result);
      
      if (res.result.success) {
        console.log('已更新通知数量:', res.result.updatedCount);
        // 幂等处理：updatedCount=0 可能是并发页面已完成更新，仍视为成功
      } else {
        console.error('标记所有通知失败:', res.result.error);
        wx.showToast({ title: '操作失败', icon: 'none' });
        return;
      }
      
      // 强制重新加载通知列表
      await this.loadNotifications();
      console.log('重新加载通知列表成功');
      
      wx.showToast({
        title: '已全部标记为已读',
        icon: 'success'
      });
    } catch (error) {
      console.error('标记所有消息已读失败', error);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 刷新消息列表
  async refreshMessages() {
    this.setData({ refreshing: true });
    await this.loadMessages();
    this.setData({ refreshing: false });
    wx.showToast({
      title: '消息已刷新',
      icon: 'success'
    });
  },

  // 时间格式化函数
  formatTime: function(time) {
    if (!time) {
      console.log('时间为空');
      return '';
    }
    
    try {
      console.log('格式化时间输入:', time);
      console.log('时间类型:', typeof time);
      
      // 直接返回时间字符串的一部分，确保显示
      if (typeof time === 'string') {
        console.log('时间是字符串，长度:', time.length);
        // 提取时间部分
        const timeMatch = time.match(/(\d{2}):(\d{2}):(\d{2})/);
        if (timeMatch) {
          const [, hours, minutes, seconds] = timeMatch;
          console.log('提取的时间:', hours, minutes, seconds);
          const result = `${hours}:${minutes}:${seconds}`;
          console.log('时间格式化结果:', result);
          return result;
        } else {
          console.log('时间字符串匹配失败');
        }
      }
      
      // 如果不是字符串，尝试转换为日期对象
      let date;
      if (time instanceof Date) {
        console.log('时间是Date对象');
        date = time;
      } else {
        console.log('尝试将时间转换为Date对象');
        date = new Date(time);
      }
      
      // 检查日期是否有效
      if (isNaN(date.getTime())) {
        console.error('日期无效:', time);
        return '';
      }
      
      console.log('格式化后的日期:', date);
      console.log('日期的小时:', date.getHours());
      console.log('日期的分钟:', date.getMinutes());
      console.log('日期的秒:', date.getSeconds());
      
      // 补零函数
      function padZero(num) {
        return num < 10 ? '0' + num : num.toString();
      }
      
      const hours = padZero(date.getHours());
      const minutes = padZero(date.getMinutes());
      const seconds = padZero(date.getSeconds());
      
      const result = `${hours}:${minutes}:${seconds}`;
      console.log('时间格式化结果:', result);
      return result;
    } catch (error) {
      console.error('时间格式化失败:', error);
      return '';
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

  // 进入客服聊天
  async enterCustomerService() {
    try {
      console.log('进入客服聊天开始');
      const loginRes = await wx.cloud.callFunction({
        name: 'login'
      });
      
      console.log('login云函数返回结果:', loginRes);
      
      if (!loginRes.result || !loginRes.result.openid) {
        console.error('获取OPENID失败');
        wx.showToast({ title: '获取用户信息失败，请重试', icon: 'none' });
        return;
      }
      
      const OPENID = loginRes.result.openid;
      console.log('获取到用户OPENID:', OPENID);
      
      // 检查是否已有会话
      const db = wx.cloud.database();
      const sessionRes = await db.collection('sessions')
        .where({ 
          userId: OPENID,
          status: 'active'
        })
        .get();
      
      console.log('查询会话结果:', sessionRes.data.length);
      
      if (sessionRes.data.length > 0) {
        // 已有活跃会话，进入最近的会话
        const session = sessionRes.data[0];
        console.log('已有活跃会话，进入会话ID:', session._id);
        wx.navigateTo({
          url: `/pages/message/service/index?sessionId=${session._id}`,
          success: function(res) {
            console.log('跳转成功');
          },
          fail: function(err) {
            console.error('跳转失败:', err);
            wx.showToast({ title: '跳转失败，请重试', icon: 'none' });
          }
        });
      } else {
        // 创建新会话
        console.log('创建新会话');
        const createRes = await wx.cloud.callFunction({
          name: 'createSession',
          data: {
            userId: OPENID
          }
        });
        
        console.log('创建会话结果:', createRes.result);
        
        if (createRes.result.success) {
          console.log('会话创建成功，会话ID:', createRes.result.sessionId);
          wx.navigateTo({
            url: `/pages/message/service/index?sessionId=${createRes.result.sessionId}`,
            success: function(res) {
              console.log('跳转成功');
            },
            fail: function(err) {
              console.error('跳转失败:', err);
              wx.showToast({ title: '跳转失败，请重试', icon: 'none' });
            }
          });
        } else {
          console.error('创建会话失败:', createRes.result.error);
          wx.showToast({ title: `创建会话失败: ${createRes.result.error}`, icon: 'none' });
        }
      }
    } catch (error) {
      console.error('进入客服聊天失败', error);
      wx.showToast({ title: `操作失败: ${error.message}`, icon: 'none' });
    }
  }
});