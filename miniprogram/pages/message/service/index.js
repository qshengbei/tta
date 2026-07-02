const db = wx.cloud.database();
const _ = db.command;
const DEBUG_LOG = false;
const debugLog = (...args) => {
  if (DEBUG_LOG) console.log(...args);
};

const needsTempUrl = (src) => {
  if (!src || typeof src !== 'string') return false;
  if (src.startsWith('http://') || src.startsWith('https://')) return false;
  return src.startsWith('cloud://') || src.startsWith('cloudid://') || !src.includes('://');
};

Page({
  data: {
    sessionId: '',
    messages: [],
    groupedMessages: [],
    inputValue: '',
    loading: false,
    userInfo: {},
    csInfo: {},
    openid: '',
    isCustomerService: false,
    scrollTop: 0,
    showEmojiPanel: false,
    showMorePanel: false,
    inputFocus: false,
    listBottomSpaceRpx: 100,
    selectedFile: null,
    selectedFileType: null,
    previewVisible: false,
    previewType: '',
    previewSrc: '',
    previewMediaList: [],
    previewMediaIndex: 0,
    recentEmojis: ['😂', '😍', '😎', '😢', '😡', '👍', '❤️', '🎉'],
    allEmojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '😘', '😗', '😙', '😚', '😋', '😜', '😝', '😛', '🤑', '🤗', '🤓', '😎', '🤡', '🤠', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '😤', '😠', '😡', '😶', '😐', '😑', '😯', '😦', '😧', '😮', '😲', '😵', '😳', '😱', '😨', '😰', '😢', '😥', '🤤', '😭', '😓', '😪', '😴', '🙄', '🤔', '🤥', '😬', '🤐', '🤢', '🤧', '😷', '🤒', '🤕', '👶', '👧', '👦', '👩', '👨', '👴', '👵', '👱', '👮', '👷', '👸', '🤴', '👼', '👻', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🐱', '🐶', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🐃', '🐂', '🐄', '🐎', '🐏', '🐑', '🐐', '🐪', '🐫', '🦙', '🐘', '🦏', '🦛', '🐭', '🐁', '🐀', '🐹', '🐰', '🐇', '🐿️', '🦫', '🦔', '🦇', '🐻', '🐨', '🐼', '🦥', '🦦', '🦨', '🦘', '🦡', '🐾', '🌱', '🌲', '🌳', '🌴', '🌵', '🌷', '🌸', '🌹', '🌺', '🌻', '🌼', '🌾', '🌿', '🍀', '🍁', '🍂', '🍃', '🍄', '🌰', '🍇', '🍈', '🍉', '🍊', '🍋', '🍌', '🍍', '🍎', '🍏', '🍐', '🍑', '🍒', '🍓', '🥝', '🍅', '🥥', '🥑', '🍆', '🥔', '🥕', '🌽', '🥦', '🥬', '🥒', '🍄', '🥜', '🌰', '🍞', '🥐', '🥖', '🥨', '🧀', '🍖', '🍗', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🥙', '🧆', '🥚', '🍳', '🥘', '🍲', '🥣', '🥗', '🍿', '🧈', '🧂', '🍴', '🍽️', '🥄', '🔪', '🍷', '🍸', '🍹', '🍺', '🍻', '🥂', '🍾', '🧉', '🍶', '🍵', '☕', '🍼', '🥛', '🍯', '🍰', '🎂', '🍧', '🍨', '🍦', '🍩', '🍪', '🎁', '🎈', '🎉', '🎊', '🎋', '🎍', '🎎', '🎏', '🎐', '🎑', '🎃', '🎄', '🎅', '🤶', '🎆', '🎇', '✨', '🌟', '⭐', '💫', '💥', '🌈', '🌤️', '🌥️', '🌦️', '🌧️', '🌨️', '🌩️', '🌪️', '🌫️', '🌬️', '🌂', '🌙', '🌛', '🌜', '🌝', '🌞', '🌟', '⭐', '🌠', '🌌', '🌍', '🌎', '🌏', '🌐', '🚀', '✈️', '🚁', '🚂', '🚊', '🚉', '🚞', '🚆', '🚄', '🚅', '🚈', '🚇', '🚝', '🚜', '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🚚', '🚛', '🏍️', '🛵', '🚲', '🚏', '🛣️', '🛤️', '⛽', '🚨', '🚥', '🚦', '🚧', '🛑', '🚸', '🛂', '🛃', '🚶', '👣', '🏃', '💃', '🕺', '🏊', '🚣', '🏄', '🚴', '🚵', '🎿', '⛷️', '🏂', '🎯', '🎳', '🎭', '🎨', '🎪', '🎧', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '📞', '📟', '📠', '📡', '📺', '📻', '📷', '📸', '📹', '📼', '📀', '💽', '💾', '💿', '📔', '📕', '📖', '📗', '📘', '📙', '📚', '📓', '📒', '📃', '📜', '📄', '📰', '📑', '🔖', '💰', '💴', '💵', '💶', '💷', '💸', '💳', '💎', '⚽', '🏀', '🏐', '🏈', '🏉', '🥎', '🏏', '🏑', '🏒', '🥍', '🏓', '🏸', '🥊', '🥋', '🥅', '⛳', '⛸️', '🎣', '🎽', '🎿', '⛷️', '🏂', '🏋️', '🚣', '🏊', '🏄', '🏆', '🎖️', '🏅', '🥇', '🥈', '🥉', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '💖', '💗', '💓', '💞', '💘', '💝', '💟', '💌', '💋', '💍', '💎', '🙏', '🤝', '👏', '🙌', '👐', '🤲', '👍', '👎', '👌', '✌️', '🤞', '✋', '🤚', '🖐️', '🖖', '🤙', '👋', '🤟', '🤘', '👈', '👉', '👆', '👇', '☝️', '💪', '✊', '👊', '🤛', '🤜'],

    messagesLoaded: false,
    targetUserOpenid: '',
    showCardPicker: false,
    cardPickerType: '',
    cardPickerTitle: '',
    cardPickerItems: [],
    cardPickerOrderSourceItems: [],
    cardPickerOrderDeliveryTabs: [],
    cardPickerOrderStatusTabs: [],
    cardPickerOrderActiveDeliveryType: 'express',
    cardPickerOrderActiveStatus: 'all',
    currentScrollTop: 0,
    scrollIntoView: '',
    initialScrollReady: false,
    keepBottomSyncing: false,
    usingPreloadedOnEnter: false,
    firstScreenVisible: false,
    newMessageCount: 0,
    lastNewMessageId: '',
    isScrolledToBottom: true,
    messageListScrollHeight: 0,
    pendingMessageRefresh: false,
    entryAnchorMessageId: '',
    entryBottomLocking: false,
    messageListReady: false,
    pageSize: 16,
    hasMoreHistory: true,
    loadingMoreHistory: false,
    oldestCreateTime: null,
    messageActionMenuVisible: false,
    messageActionMenuX: 0,
    messageActionMenuY: 0,
    messageActionMenuArrowX: 24,
    messageActionMenuArrowDirection: 'down',
    messageActionMenuActions: [],
    messageActionMenuMessage: null,
    messageScrollEnabled: true,
    pendingEntryProductCard: null,
    pendingEntryProductCardVisible: false,
    pendingEntryOrderCard: null,
    pendingEntryOrderCardVisible: false,
    cartPickerPage: 0,
    cartPickerPageSize: 18,
    cartPickerLoadingMore: false,
    cartPickerHasMore: true
  },
  getMessageContentHeight() {
    return new Promise((resolve) => {
      const query = wx.createSelectorQuery();
      query.select('#message-content').boundingClientRect((rect) => {
        resolve((rect && rect.height) || 0);
      }).exec();
    });
  },
  getCurrentPanelOffsetPx() {
    if (this.data.showEmojiPanel) return 540;
    if (this.data.showMorePanel) return 175;
    return 0;
  },
  updateListBottomSpace(shouldScrollToBottom = true) {
    const base = 100; // 与初始 listBottomSpaceRpx 保持一致，避免聚焦输入框后间隔变小
    const offset = this.getCurrentPanelOffsetPx();
    const patch = { listBottomSpaceRpx: base + offset };
    if (shouldScrollToBottom) {
      patch.scrollTop = 999999;
    }
    this.setData(patch);
  },
  handleOutsideTap() {
    const hasPopover = this.data.messageActionMenuVisible;
    if (!this.data.showEmojiPanel && !this.data.showMorePanel && !hasPopover) return;
    this._inputRefocusDeadline = 0;
    this.setData({
      showEmojiPanel: false,
      showMorePanel: false,
      messageActionMenuVisible: false,
      messageScrollEnabled: true,
      messageActionMenuArrowDirection: 'down',
      messageActionMenuMessage: null,
      messageActionMenuActions: [],
      listBottomSpaceRpx: 100,
      scrollTop: 999999
    });
  },
  closePanelsOnLongPress() {
    const needClose = this.data.showEmojiPanel
      || this.data.showMorePanel
      || this.data.inputFocus
      || this.data.previewVisible
      || this.data.showCardPicker
      || this.data.messageActionMenuVisible;
    if (!needClose) return false;
    this._inputRefocusDeadline = 0;

    this.setData({
      showEmojiPanel: false,
      showMorePanel: false,
      inputFocus: false,
      previewVisible: false,
      previewType: '',
      previewSrc: '',
      previewMediaList: [],
      previewMediaIndex: 0,
      showCardPicker: false,
      cardPickerType: '',
      cardPickerTitle: '',
      cardPickerItems: [],
      messageActionMenuVisible: false,
      messageScrollEnabled: true,
      messageActionMenuArrowDirection: 'down',
      messageActionMenuMessage: null,
      messageActionMenuActions: [],
      listBottomSpaceRpx: 100,
      scrollTop: 999999
    });

    try {
      wx.hideKeyboard && wx.hideKeyboard();
    } catch (err) {
      // ignore
    }
    return true;
  },
  parseCardData(item) {
    if (item.type !== 'product_card' && item.type !== 'order_card') return null;
    if (!item.content) return null;
    if (typeof item.content === 'object') return item.content;
    try {
      return JSON.parse(item.content);
    } catch (e) {
      return null;
    }
  },

  // 处理订单编号显示
  formatOrderNumber(orderNumber) {
    if (!orderNumber) return '';
    const str = String(orderNumber);
    if (str.length > 11) {
      return str.substring(0, 6) + '....' + str.substring(str.length - 5);
    }
    return str;
  },
  parseEntryProductCard(rawCard) {
    if (!rawCard || typeof rawCard !== 'string') return null;
    try {
      const decoded = decodeURIComponent(rawCard);
      const parsed = JSON.parse(decoded);
      if (!parsed || !parsed.productId) return null;
      return {
        productId: parsed.productId,
        name: parsed.name || '商品',
        price: parsed.price || 0,
        desc: parsed.desc || parsed.description || '',
        description: parsed.description || parsed.desc || '',
        coverImage: parsed.coverImage || ''
      };
    } catch (e) {
      return null;
    }
  },
  parseEntryOrderCard(rawCard) {
    if (!rawCard || typeof rawCard !== 'string') return null;
    try {
      const decoded = decodeURIComponent(rawCard);
      const parsed = JSON.parse(decoded);
      if (!parsed || !parsed.orderId) return null;
      return {
        orderId: parsed.orderId,
        orderNumber: parsed.orderNumber || parsed.orderId,
        coverImage: parsed.coverImage || '/images/icons/订单.png',
        productName: parsed.productName || parsed.name || '商品',
        quantity: parsed.quantity || 1,
        totalAmount: parsed.totalAmount || parsed.amount || 0,
        status: parsed.status || 'unknown',
        statusText: parsed.statusText || '未知状态',
        formattedOrderNumber: this.formatOrderNumber(parsed.orderNumber || parsed.orderId)
      };
    } catch (e) {
      return null;
    }
  },
  buildMediaBoxStyle(item) {
    if (item.type !== 'video' && item.type !== 'image') return '';
    const mediaMeta = item.mediaMeta || {};
    const width = Number(mediaMeta.width) || 0;
    const height = Number(mediaMeta.height) || 0;
    const maxSize = 240;
    const minSize = 120;
    if (!width || !height) {
      // 无尺寸元数据时统一给固定占位，避免图片加载后高度回流导致列表跳动。
      return 'width:220rpx;height:220rpx;';
    }
    const ratio = width / height;
    let displayWidth = maxSize;
    let displayHeight = maxSize;
    if (ratio >= 1) {
      displayWidth = maxSize;
      displayHeight = Math.max(minSize, Math.min(maxSize, Math.round(maxSize / ratio)));
    } else {
      displayHeight = maxSize;
      displayWidth = Math.max(minSize, Math.min(maxSize, Math.round(maxSize * ratio)));
    }
    return `width:${displayWidth}rpx;height:${displayHeight}rpx;`;
  },
  normalizeMessage(item) {
    const message = { ...item };
    if (message.content && typeof message.content === 'object' && message.type !== 'location') {
      message.content = JSON.stringify(message.content);
    }
    if (message.mediaMeta && typeof message.mediaMeta === 'string') {
      try {
        message.mediaMeta = JSON.parse(message.mediaMeta);
      } catch (e) {
        message.mediaMeta = null;
      }
    }
    message.isRevoked = message.status === 'revoked' || message.type === 'revoked';
    message.isSelfRevoked = message.isRevoked && this.isOwnMessage(message);
    message.cardData = this.parseCardData(message);
    // 为订单卡片添加格式化的订单编号
    if (message.type === 'order_card' && message.cardData) {
      const orderNumber = message.cardData.orderNumber || message.cardData.orderId;
      message.cardData.formattedOrderNumber = this.formatOrderNumber(orderNumber);
    }
    message.mediaBoxStyle = this.buildMediaBoxStyle(message);
    
    // 可靠地解析消息时间戳：优先使用 normalizeDateInput() 确保兼容各种格式
    const parsed = this.normalizeDateInput(message.createTime);
    message._createTimeTs = parsed ? parsed.getTime() : Date.now();
    
    // 标记需要处理的媒体URL（cloudFileID→临时URL转换）
    const mediaMeta = message.mediaMeta || {};
    message._needsUrlConversion = (message.type === 'video' || message.type === 'image')
      && (needsTempUrl(message.content) || needsTempUrl(mediaMeta.thumbnail) || needsTempUrl(mediaMeta.poster));
    
    return message;
  },
  
  // 将cloudFileID转换为临时访问URL
  async convertFileIDToUrl(fileID) {
    if (!fileID || fileID.startsWith('http')) {
      return fileID; // 已经是URL或无效，直接返回
    }
    try {
      const res = await wx.cloud.getTempFileURL({
        fileList: [fileID]
      });
      if (res.fileList && res.fileList[0]) {
        return res.fileList[0].tempFileURL;
      }
    } catch (e) {
      debugLog('转换fileID失败:', fileID, e);
    }
    return fileID; // 转换失败时返回原值
  },
  
  // 异步处理消息列表的媒体URL转换（后台处理，不阻塞UI）
  async ensureMediaUrlsAsync(messageList = []) {
    if (!messageList || messageList.length === 0) return;
    
    const needsConversion = messageList.filter(msg => msg && msg._needsUrlConversion);
    if (needsConversion.length === 0) return;
    
    // 收集所有需要转换的fileID（原图/缩略图/视频封面）
    const fileIDsToConvert = {};
    needsConversion.forEach(msg => {
      const mediaMeta = msg.mediaMeta || {};
      if (needsTempUrl(msg.content)) {
        fileIDsToConvert[msg.content] = true;
      }
      if (needsTempUrl(mediaMeta.thumbnail)) {
        fileIDsToConvert[mediaMeta.thumbnail] = true;
      }
      if (needsTempUrl(mediaMeta.poster)) {
        fileIDsToConvert[mediaMeta.poster] = true;
      }
    });
    
    const fileIDs = Object.keys(fileIDsToConvert);
    if (fileIDs.length === 0) return;
    
    try {
      const res = await wx.cloud.getTempFileURL({
        fileList: fileIDs
      });
      
      if (res.fileList && res.fileList.length > 0) {
        const urlMap = {};
        res.fileList.forEach(item => {
          urlMap[item.fileID] = item.tempFileURL;
        });
        
        // 更新消息的content/thumbnail/poster为临时URL
        const updated = messageList.map(msg => {
          if (!msg._needsUrlConversion) {
            return msg;
          }

          const next = { ...msg };
          const mediaMeta = { ...(msg.mediaMeta || {}) };
          let changed = false;

          if (urlMap[msg.content]) {
            next.content = urlMap[msg.content];
            changed = true;
          }
          if (mediaMeta.thumbnail && urlMap[mediaMeta.thumbnail]) {
            mediaMeta.thumbnail = urlMap[mediaMeta.thumbnail];
            changed = true;
          }
          if (mediaMeta.poster && urlMap[mediaMeta.poster]) {
            mediaMeta.poster = urlMap[mediaMeta.poster];
            changed = true;
          }

          if (changed) {
            next.mediaMeta = mediaMeta;
            next._needsUrlConversion = false;
            return next;
          }
          return msg;
        });
        
        // 更新状态（同步更新groupedMessages，模板渲染依赖它）
        this.setData({
          messages: updated,
          groupedMessages: this.groupMessages(updated)
        });
        return updated;
      }
    } catch (e) {
      debugLog('批量转换媒体URL失败:', e);
    }
  },
  processMessageList(rawList) {
    return (rawList || [])
      .map(item => this.normalizeMessage(item))
      .sort((a, b) => a._createTimeTs - b._createTimeTs);
  },
  buildPreviewMediaList(messageList = []) {
    return (messageList || [])
      .filter((msg) => msg && !msg.isRevoked && (msg.type === 'image' || msg.type === 'video') && msg.content)
      .sort((a, b) => (b._createTimeTs || 0) - (a._createTimeTs || 0))
      .map((msg) => ({
        _id: msg._id,
        type: msg.type,
        src: msg.content
      }));
  },
  appendMessageToList(message, selfSent = false) {
    if (!message || !message._id) return;
    const current = this.data.messages || [];
    if (current.some(item => item && item._id === message._id)) {
      return;
    }
    const normalized = this.normalizeMessage(message);
    const merged = [...current, normalized].sort((a, b) => a._createTimeTs - b._createTimeTs);
    
    // selfSent：自己发的消息始终滚到底部、不增计数
    // 对端消息：根据当前是否在底部决定是否滚动
    const isAtBottom = selfSent || this.data.isScrolledToBottom;
    const updateData = {
      messages: merged,
      groupedMessages: this.groupMessages(merged)
    };
    
    if (isAtBottom) {
      // 在底部时自动滚到最新消息
      updateData.scrollIntoView = `msg-${normalized._id}`;
      updateData.scrollTop = 999999;
      updateData.newMessageCount = 0;
      updateData.lastNewMessageId = '';
    } else {
      // 不在底部时，只增加新消息计数，不滚动
      updateData.newMessageCount = (this.data.newMessageCount || 0) + 1;
      // 记录最后一条新消息，用于 IntersectionObserver 检测可见性
      updateData.lastNewMessageId = normalized._id;
    }
    
    this.setData(updateData);
    
    // 对端新消息：用 IntersectionObserver 监听最后一条新消息进入视口时清零计数
    if (!isAtBottom) {
      this._observeLastNewMessage(normalized._id);
    }
    wx.nextTick(() => {
      this.ensureMediaUrlsAsync(merged);
      this.getMessageListHeight();
    });
    setTimeout(() => {
      this.setData({ scrollIntoView: '' });
    }, 20);
  },
  isSameMessageList(prevList = [], nextList = []) {
    if (prevList.length !== nextList.length) return false;
    if (!prevList.length && !nextList.length) return true;
    for (let i = 0; i < prevList.length; i += 1) {
      const prev = prevList[i] || {};
      const next = nextList[i] || {};
      if (prev._id !== next._id) return false;
      // 关键字段变化（如撤回 status）必须触发刷新
      if ((prev.status || '') !== (next.status || '')) return false;
      if (!!prev.isSelfRevoked !== !!next.isSelfRevoked) return false;
      if ((prev.type || '') !== (next.type || '')) return false;
      if ((prev.content || '') !== (next.content || '')) return false;
    }
    return true;
  },
  getPreferredAnchorId(messages = []) {
    const preferredId = this.data.entryAnchorMessageId;
    if (preferredId && messages.some((item) => item && item._id === preferredId)) {
      return `msg-${preferredId}`;
    }
    return 'bottom-anchor';
  },
  async onLoad(options) {
    const { sessionId, entryProductCard, entryOrderCard } = options;
    const pendingEntryProductCard = this.parseEntryProductCard(entryProductCard);
    const pendingEntryOrderCard = this.parseEntryOrderCard(entryOrderCard);
    this._historyPrefetchBuffer = [];
    this._historyPrefetching = false;
    this._historyPrefetchHasMore = true;
    this._hasUserScrolledList = false;
    this._historyLoadGateUntil = Date.now() + 1200;
    this._initialBottomSyncDone = false;
    this._initialBottomSyncRunning = false;
    this.setData({
      sessionId,
      scrollTop: 999999,
      scrollIntoView: '',
      firstScreenVisible: false,
      pendingMessageRefresh: false,
      entryAnchorMessageId: '',
      entryBottomLocking: true,
      messageListReady: false,
      pendingEntryProductCard,
      pendingEntryProductCardVisible: !!pendingEntryProductCard,
      pendingEntryOrderCard,
      pendingEntryOrderCardVisible: !!pendingEntryOrderCard
    });
    this.loadCSInfo();
    await this.getOpenId();
    await this.loadUserInfo();
    const usedPreload = this.applyPreloadedMessages(sessionId);
    this.setData({ usingPreloadedOnEnter: usedPreload });
    // 设置页面标题
    this.setPageTitle();
    this.initMessages({ silent: true });
    this.listenMessages();
    if (typeof this.initBottomAnchorObserver === 'function') {
      this.initBottomAnchorObserver();
    } else if (typeof this._initBottomAnchorObserver === 'function') {
      this._initBottomAnchorObserver();
    }
    // 清除未读计数
    this.clearUnreadCount(sessionId);
  },
  getHistoryOldestDate() {
    const { oldestCreateTime, messages } = this.data;
    let oldestDate = this.normalizeDateInput(oldestCreateTime);
    if (oldestDate && !Number.isNaN(oldestDate.getTime())) {
      return oldestDate;
    }
    const firstMessage = (messages && messages[0]) || null;
    const firstTs = firstMessage ? this.getMessageCreateTimeMs(firstMessage) : NaN;
    if (Number.isFinite(firstTs) && firstTs > 0) {
      oldestDate = new Date(firstTs);
    }
    return (oldestDate && !Number.isNaN(oldestDate.getTime())) ? oldestDate : null;
  },
  async prefetchOlderMessages() {
    const { sessionId, pageSize, hasMoreHistory } = this.data;
    if (!hasMoreHistory) return;
    if (this._historyPrefetching) return;
    if (this._historyPrefetchBuffer && this._historyPrefetchBuffer.length) return;

    const oldestDate = this.getHistoryOldestDate();
    if (!oldestDate) return;

    this._historyPrefetching = true;
    try {
      const res = await db.collection('messages')
        .where({
          sessionId,
          createTime: _.lt(oldestDate)
        })
        .orderBy('createTime', 'desc')
        .limit(pageSize)
        .get();
      const olderMessages = this.processMessageList(res.data);
      if (!olderMessages.length) {
        this._historyPrefetchBuffer = [];
        this._historyPrefetchHasMore = false;
        this.setData({ hasMoreHistory: false });
        return;
      }
      this._historyPrefetchBuffer = olderMessages;
      this._historyPrefetchHasMore = (res.data || []).length === pageSize;
    } catch (error) {
      console.error('预取历史消息失败', error);
    } finally {
      this._historyPrefetching = false;
    }
  },
  applyPreloadedMessages(sessionId) {
    const app = getApp();
    let preloadPayload = null;
    if (app.globalData && app.globalData.chatPreloadMap && app.globalData.chatPreloadMap[sessionId]) {
      preloadPayload = app.globalData.chatPreloadMap[sessionId];
    }
    if (!preloadPayload) {
      preloadPayload = wx.getStorageSync(`chat_preload_${sessionId}`);
    }
    if (!preloadPayload || !preloadPayload.messages || !preloadPayload.messages.length) {
      return false;
    }
    if (Date.now() - (preloadPayload.preloadAt || 0) > 30 * 1000) {
      return false;
    }
    const processed = this.processMessageList(preloadPayload.messages);
    const oldest = processed.length ? processed[0].createTime : null;
    this.setData({
      messages: processed,
      groupedMessages: this.groupMessages(processed),
      hasMoreHistory: !!preloadPayload.hasMoreHistory,
      oldestCreateTime: oldest,
      initialScrollReady: false,
      scrollIntoView: '',
      entryAnchorMessageId: ''
    });
    wx.nextTick(() => {
      this.startBottomSyncWindow();
    });
    this.prefetchOlderMessages();
    return true;
  },
  
  // 清除未读计数
  async clearUnreadCount(sessionId) {
    try {
      debugLog('开始清除未读计数，会话ID:', sessionId);
      if (!sessionId) {
        console.error('会话ID为空');
        return;
      }
      // 使用云函数清除未读计数
      const res = await wx.cloud.callFunction({
        name: 'clearUnreadCount',
        data: {
          sessionId
        }
      });
      debugLog('清除未读计数云函数返回结果:', res);
      if (res.result.success) {
        debugLog('清除未读计数成功');
      } else {
        console.error('清除未读计数失败:', res.result.error);
      }
    } catch (error) {
      console.error('清除未读计数失败', error);
    }
  },
  // 获取用户的openid
  async getOpenId() {
    try {
      // 先从缓存中获取openid
      const cachedOpenId = wx.getStorageSync('openid');
      if (cachedOpenId) {
        debugLog('从缓存获取到用户OPENID:', cachedOpenId);
        this.setData({ openid: cachedOpenId });
        // 检查用户是否是客服
        await this.checkIfCustomerService(cachedOpenId);
      } else {
        // 缓存中没有openid，调用云函数获取
        const res = await wx.cloud.callFunction({
          name: 'login'
        });
        if (res.result && res.result.openid) {
          debugLog('获取到用户OPENID:', res.result.openid);
          // 缓存openid
          wx.setStorageSync('openid', res.result.openid);
          this.setData({ openid: res.result.openid });
          // 检查用户是否是客服
          await this.checkIfCustomerService(res.result.openid);
        }
      }
    } catch (error) {
      console.error('获取openid失败', error);
    }
  },
  // 检查用户是否是客服
  async checkIfCustomerService(openid) {
    try {
      debugLog('检查用户是否是客服，openid:', openid);
      const db = wx.cloud.database();
      const res = await db.collection('customer_service_status')
        .where({ customerServiceId: openid })
        .get();
      debugLog('客服状态查询结果:', res.data);
      if (res.data.length > 0) {
        debugLog('用户是客服');
        this.setData({ isCustomerService: true });
      } else {
        debugLog('用户不是客服');
        this.setData({ isCustomerService: false });
      }
    } catch (error) {
      console.error('检查客服身份失败', error);
      this.setData({ isCustomerService: false });
    }
  },
  // 加载用户信息
  async loadUserInfo() {
    try {
      const { isCustomerService, sessionId } = this.data;
      
      if (isCustomerService) {
        // 客服身份：获取会话对应的用户信息
        const sessionRes = await db.collection('sessions').doc(sessionId).get();
        if (sessionRes.data && sessionRes.data.userId) {
          this.setData({ targetUserOpenid: sessionRes.data.userId });
          const userRes = await db.collection('users').where({ _openid: sessionRes.data.userId }).get();
          if (userRes.data.length > 0) {
            // 使用用户的真实信息
            this.setData({ userInfo: {
              nickName: userRes.data[0].nickName || '用户',
              avatarUrl: userRes.data[0].avatarImage || '/images/icons/默认头像.png'
            } });
            return;
          }
        }
      }
      
      // 普通用户身份或获取失败时：使用默认值
      this.setData({ userInfo: { nickName: '我', avatarUrl: '/images/icons/默认头像.png' }, targetUserOpenid: this.data.openid });
    } catch (error) {
      console.error('获取用户信息失败', error);
      // 如果获取失败，使用默认值
      this.setData({ userInfo: { nickName: '我', avatarUrl: '/images/icons/默认头像.png' }, targetUserOpenid: this.data.openid });
    }
  },
  
  // 设置页面标题
  setPageTitle() {
    const { isCustomerService, userInfo, csInfo } = this.data;
    const title = isCustomerService ? (userInfo.nickName || '用户') : (csInfo.name || '客服');
    wx.setNavigationBarTitle({ title });
  },
  // 加载客服信息
  async loadCSInfo() {
    try {
      const db = wx.cloud.database();
      // 获取会话信息
      const sessionRes = await db.collection('sessions').doc(this.data.sessionId).get();
      if (sessionRes.data) {
        const { customerServiceId, customerServiceName, customerServiceAvatar } = sessionRes.data;
        // 获取客服状态信息
        const csRes = await db.collection('customer_service_status')
          .where({ customerServiceId })
          .get();
        if (csRes.data.length > 0) {
          // 如果客服状态信息中有头像，使用客服状态中的头像，否则使用会话中的头像
          const avatarUrl = csRes.data[0].avatarUrl || customerServiceAvatar || '/images/icons/客服.png';
          this.setData({ csInfo: { ...csRes.data[0], avatarUrl } });
        } else {
          // 如果没有客服状态信息，使用会话中的客服名称和头像
          this.setData({ csInfo: { 
            name: customerServiceName, 
            avatarUrl: customerServiceAvatar || '/images/icons/客服.png' 
          } });
        }
      }
      // 设置页面标题
      this.setPageTitle();
    } catch (error) {
      console.error('获取客服信息失败', error);
      // 如果获取失败，使用默认值
      this.setData({ csInfo: { name: '客服', avatarUrl: '/images/icons/客服.png' } });
      // 设置页面标题
      this.setPageTitle();
    }
  },
  // 初始化消息列表
  async initMessages(options = {}) {
    const { silent = false } = options;
    const { sessionId, pageSize } = this.data;
    if (!silent) {
      wx.showLoading({ title: '加载中...' });
    }
    
    try {
      const shouldKeepInitialStable = silent && this.data.usingPreloadedOnEnter && (this.data.messages || []).length > 0;
      if (!shouldKeepInitialStable) {
        this.setData({ initialScrollReady: false });
      }
      const res = await db.collection('messages')
        .where({ sessionId })
        .orderBy('createTime', 'desc')
        .limit(pageSize)
        .get();
      const processedMessages = this.processMessageList(res.data);
      const isSameAsCurrent = this.isSameMessageList(this.data.messages || [], processedMessages);
      const needsFirstScreenBootstrap = !this.data.firstScreenVisible;
      const oldest = processedMessages.length ? processedMessages[0].createTime : null;
      const groupedMessages = this.groupMessages(processedMessages);
      const preferredAnchorId = this.getPreferredAnchorId(processedMessages);
      if (isSameAsCurrent) {
        this.setData({
          hasMoreHistory: (res.data || []).length === pageSize,
          oldestCreateTime: oldest
        });
      } else {
        const shouldKeepAtBottomOnFirstScreen = !this.data.firstScreenVisible;
        this.setData({ 
          messages: processedMessages,
          groupedMessages,
          hasMoreHistory: (res.data || []).length === pageSize,
          oldestCreateTime: oldest,
          scrollIntoView: shouldKeepAtBottomOnFirstScreen ? '' : preferredAnchorId,
          scrollTop: shouldKeepAtBottomOnFirstScreen ? 999999 : this.data.scrollTop
        });
      }
      const app = getApp();
      if (app.globalData) {
        if (!app.globalData.chatPreloadMap) app.globalData.chatPreloadMap = {};
        app.globalData.chatPreloadMap[sessionId] = {
          sessionId,
          messages: res.data || [],
          hasMoreHistory: (res.data || []).length === pageSize,
          preloadAt: Date.now()
        };
      }
      wx.setStorageSync(`chat_preload_${sessionId}`, {
        sessionId,
        messages: res.data || [],
        hasMoreHistory: (res.data || []).length === pageSize,
        preloadAt: Date.now()
      });
      // 首屏已使用预加载时，避免 initMessages 再触发一次首屏定位，防止进入页多次来回滚动。
      const shouldResyncBottom = (!this.data.usingPreloadedOnEnter) && (!isSameAsCurrent || (needsFirstScreenBootstrap && !shouldKeepInitialStable));
      if (shouldResyncBottom) {
        wx.nextTick(async () => {
          this.startBottomSyncWindow();
        });
      }
      // 首屏渲染后预取下一页历史，后续上滑可无感衔接。
      this.prefetchOlderMessages();
      
      // 异步处理媒体URL转换（cloudFileID→临时URL），不阻塞UI
      wx.nextTick(() => {
        this.ensureMediaUrlsAsync(this.data.messages);
        this.getMessageListHeight();
      });
    } catch (error) {
      console.error('加载消息失败', error);
      wx.showToast({ title: '加载消息失败', icon: 'none' });
    } finally {
      if (!silent) {
        wx.hideLoading();
      }
      if (this.data.usingPreloadedOnEnter) {
        this.setData({ usingPreloadedOnEnter: false });
      }
    }
  },
  async loadMoreMessages() {
    const { sessionId, pageSize, hasMoreHistory, loadingMoreHistory, oldestCreateTime, messages, initialScrollReady, firstScreenVisible } = this.data;
    // 首屏阶段禁止触发历史加载，避免进入页出现自动上滑/下滑抖动。
    const canLoadHistory = initialScrollReady || firstScreenVisible;
    if (!canLoadHistory) return;
    // 首屏短时间保护：1.2 秒内若没有用户滚动痕迹，则拦截历史加载；超时后允许正常触顶加载。
    if (Date.now() < (this._historyLoadGateUntil || 0) && !this._hasUserScrolledList) return;
    if (!hasMoreHistory || loadingMoreHistory) return;

    // 兼容预加载/序列化场景下 oldestCreateTime 可能不是标准 Date 的情况。
    let oldestDate = this.normalizeDateInput(oldestCreateTime);
    if (!oldestDate) {
      const firstMessage = (messages && messages[0]) || null;
      const firstTs = firstMessage ? this.getMessageCreateTimeMs(firstMessage) : NaN;
      if (Number.isFinite(firstTs) && firstTs > 0) {
        oldestDate = new Date(firstTs);
      }
    }
    if (!oldestDate || Number.isNaN(oldestDate.getTime())) {
      return;
    }

    if (this._loadMoreLock) return;
    this._loadMoreLock = true;
    const anchorMessage = messages[0] || null;
    const anchorId = anchorMessage && anchorMessage._id ? `msg-${anchorMessage._id}` : '';
    this.setData({ loadingMoreHistory: true });
    try {
      // 优先消费已预取历史页，避免触顶时才发请求造成可见等待。
      if (this._historyPrefetchBuffer && this._historyPrefetchBuffer.length) {
        const olderMessages = this._historyPrefetchBuffer;
        this._historyPrefetchBuffer = [];
        const merged = [...olderMessages, ...messages];
        const nextData = {
          messages: merged,
          groupedMessages: this.groupMessages(merged),
          oldestCreateTime: olderMessages[0].createTime,
          hasMoreHistory: !!this._historyPrefetchHasMore
        };
        if (anchorId) {
          nextData.scrollIntoView = anchorId;
        }
        this.setData(nextData);
        await new Promise((resolve) => wx.nextTick(resolve));
        this.setData({ loadingMoreHistory: false, scrollIntoView: '' });
        // 异步处理新加载消息的媒体URL转换
        this.ensureMediaUrlsAsync(merged);
        this.getMessageListHeight();
        this.prefetchOlderMessages();
        return;
      }

      const res = await db.collection('messages')
        .where({
          sessionId,
          createTime: _.lt(oldestDate)
        })
        .orderBy('createTime', 'desc')
        .limit(pageSize)
        .get();
      const olderMessages = this.processMessageList(res.data);
      if (!olderMessages.length) {
        this.setData({ hasMoreHistory: false, loadingMoreHistory: false });
        return;
      }
      const merged = [...olderMessages, ...messages];
      const nextData = {
        messages: merged,
        groupedMessages: this.groupMessages(merged),
        oldestCreateTime: olderMessages[0].createTime,
        hasMoreHistory: (res.data || []).length === pageSize
      };
      if (anchorId) {
        nextData.scrollIntoView = anchorId;
      }
      this.setData(nextData);
      await new Promise((resolve) => wx.nextTick(resolve));
      this.setData({ loadingMoreHistory: false, scrollIntoView: '' });
      // 异步处理新加载消息的媒体URL转换
      this.ensureMediaUrlsAsync(merged);
      this.getMessageListHeight();
      this._historyPrefetchBuffer = [];
      this._historyPrefetchHasMore = (res.data || []).length === pageSize;
      this.prefetchOlderMessages();
    } catch (error) {
      console.error('加载历史消息失败', error);
      this.setData({ loadingMoreHistory: false });
    } finally {
      setTimeout(() => {
        this._loadMoreLock = false;
      }, 220);
    }
  },
  // 监听消息变化
  listenMessages() {
    const { sessionId } = this.data;
    const db = wx.cloud.database();
    
    debugLog('开始监听消息变化，会话ID:', sessionId);
    
    // 监听消息集合变化
    this.messageWatch = db.collection('messages')
      .where({ sessionId })
      .watch({
        onChange: (snapshot) => {
          debugLog('收到消息变化:', snapshot);
          if (snapshot.docChanges.length > 0) {
            debugLog('消息变化数量:', snapshot.docChanges.length);
            const ownAddedOnly = snapshot.docChanges.every((change) => {
              const msg = change.doc || {};
              return change.dataType === 'add' && this.isOwnMessage(msg);
            });

            const hasOtherMessage = snapshot.docChanges.some(change => {
              const msg = change.doc || {};
              if (this.data.isCustomerService) return msg.role === 'user';
              return msg.role === 'customer_service';
            });
            if (hasOtherMessage) {
              this.clearUnreadCount(this.data.sessionId);
            }
            // 本人新发消息已在本地即时追加，跳过全量刷新，避免可见滚动抖动。
            if (ownAddedOnly) {
              return;
            }
            if (!this.data.firstScreenVisible) {
              this.setData({ pendingMessageRefresh: true });
              return;
            }
            
            // 对端新消息：增量追加而不是全量刷新
            const addedMessages = snapshot.docChanges
              .filter(change => change.dataType === 'add')
              .map(change => this.normalizeMessage(change.doc || {}));
            
            if (addedMessages.length > 0) {
              addedMessages.forEach(msg => this.appendMessageToList(msg));
            }
          }
        },
        onError: (error) => {
          console.error('监听消息失败', error);
        }
      });
  },
  // 发送消息
  async sendMessage(content, type = 'text', extra = null) {
    const { sessionId, inputValue } = this.data;
    
    // 如果是文本消息，使用inputValue
    const messageContent = type === 'text' ? inputValue.trim() : content;
    
    if (!messageContent) {
      wx.showToast({ title: '消息内容不能为空', icon: 'none' });
      return;
    }
    
    // 清空输入框（仅文本消息）
    if (type === 'text') {
      this.setData({ inputValue: '' });
    }
    
    this.setData({ loading: true });
    
    try {
      const res = await wx.cloud.callFunction({
        name: 'sendMessage',
        data: {
          sessionId,
          content: messageContent,
          type,
          extra
        }
      });
      
      if (!res.result.success) {
        wx.showToast({ title: res.result.error || '发送失败', icon: 'none' });
      } else {
        // 图片/视频消息：优先用已转换的临时URL做本地显示，避免 ensureMediaUrlsAsync 二次转换延迟
        let localContent = messageContent;
        let localMediaMeta = extra && typeof extra === 'object' ? { ...extra } : null;
        if (type === 'image' && extra && extra._tempUrl) {
          localContent = extra._tempUrl;
          if (localMediaMeta) localMediaMeta.thumbnail = extra._tempThumbnail || localMediaMeta.thumbnail;
        }
        const localMessage = {
          _id: res.result.messageId,
          sessionId,
          openid: this.data.openid,
          role: this.data.isCustomerService ? 'customer_service' : 'user',
          content: localContent,
          type,
          mediaMeta: localMediaMeta,
          createTime: new Date(),
          status: 'sent'
        };
        // selfSent=true：自己的消息始终滚到底部（面板开着时 listBottomSpaceRpx 已留出空间，消息会显示在面板上方）
        this.appendMessageToList(localMessage, true);
      }
    } catch (error) {
      console.error('发送消息失败', error);
      wx.showToast({ title: '发送失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },
  // 输入框内容变化
  onInputChange(e) {
    this.setData({ inputValue: e.detail.value });
  },
  onInputConfirm() {
    if (this.data.loading) return;
    this.sendMessage();
  },
  
  // 切换表情面板
  toggleEmojiPanel() {
    const next = !this.data.showEmojiPanel;
    this._inputRefocusDeadline = 0;
    this.setData({ 
      showEmojiPanel: next,
      showMorePanel: false,
      messageActionMenuVisible: false,
      listBottomSpaceRpx: 100 + (next ? 540 : 0),
      scrollTop: 999999
    });
  },
  toggleMorePanel() {
    const next = !this.data.showMorePanel;
    this._inputRefocusDeadline = 0;
    this.setData({
      showMorePanel: next,
      showEmojiPanel: false,
      messageActionMenuVisible: false,
      listBottomSpaceRpx: 100 + (next ? 175 : 0),
      scrollTop: 999999
    });
  },
  
  // 选择表情
  selectEmoji(e) {
    const emoji = e.currentTarget.dataset.emoji;
    this.setData({
      inputValue: this.data.inputValue + emoji
    });
  },
  
  // 删除表情
  deleteEmoji() {
    let inputValue = this.data.inputValue;
    if (inputValue.length > 0) {
      let i = inputValue.length - 1;
      
      // 检查最后一个字符是否是表情的一部分（低代理项）
      const lastCharCode = inputValue.charCodeAt(i);
      if (lastCharCode >= 0xDC00 && lastCharCode <= 0xDFFF) {
        // 如果是低代理项，说明是表情，删除2个字符
        inputValue = inputValue.slice(0, i - 1);
      } else {
        // 否则是普通字符，删除1个字符
        inputValue = inputValue.slice(0, i);
      }
      this.setData({ inputValue });
    }
  },
  
  // 选择图片和视频
  chooseImage() {
    this.setData({
      showMorePanel: false,
      showEmojiPanel: false,
      listBottomSpaceRpx: 100,
      scrollTop: 999999
    });
    const platform = (wx.getDeviceInfo && wx.getDeviceInfo().platform) || ((wx.getSystemInfoSync && wx.getSystemInfoSync().platform) || '');
    const isDesktopLike = platform === 'mac' || platform === 'windows' || platform === 'devtools';
    if (isDesktopLike && wx.chooseMessageFile) {
      wx.chooseMessageFile({
        count: 9,
        type: 'all',
        extension: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'mp4', 'mov', 'avi', 'wmv', 'flv', 'mkv'],
        success: (res) => {
          debugLog('桌面端选择文件成功:', res);
          const tempFiles = (res.tempFiles || []).map((file) => ({
            ...file,
            tempFilePath: file.path || file.tempFilePath || '',
            fileName: file.name || file.fileName || '',
            name: file.name || file.fileName || ''
          }));
          this.handleChosenMediaFiles(tempFiles);
        }
      });
      return;
    }
    wx.chooseMedia({
      count: 9, // 允许选择最多9个文件
      mediaType: ['image', 'video'],
      sizeType: ['original', 'compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        debugLog('选择媒体成功:', res);
        this.handleChosenMediaFiles(res.tempFiles || []);
      }
    });
  },

  handleChosenMediaFiles(tempFiles = []) {
    debugLog('选择的文件数量:', tempFiles.length);
    tempFiles.forEach((tempFile, index) => {
      debugLog(`处理文件 ${index + 1}:`, tempFile);
      const videoExtensions = ['.mp4', '.mov', '.avi', '.wmv', '.flv', '.mkv'];
      const filePath = (tempFile.tempFilePath || tempFile.path || '').toLowerCase();
      const isVideo = tempFile.type === 'video' || videoExtensions.some(ext => filePath.endsWith(ext));
      if (isVideo) {
        this.uploadVideo(tempFile.tempFilePath || tempFile.path, tempFile);
      } else {
        this.uploadImage(tempFile.tempFilePath || tempFile.path, tempFile);
      }
    });
  },

  async createImageThumbnail(tempFilePath) {
    if (!tempFilePath) return '';
    try {
      const compressed = await new Promise((resolve, reject) => {
        wx.compressImage({
          src: tempFilePath,
          quality: 60,
          success: resolve,
          fail: reject
        });
      });
      return compressed && compressed.tempFilePath ? compressed.tempFilePath : '';
    } catch (e) {
      debugLog('生成图片缩略图失败，回退原图:', e);
      return '';
    }
  },

  async uploadFileToCloud(cloudPath, filePath) {
    return wx.cloud.uploadFile({ cloudPath, filePath });
  },
  

  
  // 上传图片
  async uploadImage(tempFilePath, tempFile = {}) {
    this.setData({ loading: true });
    const fileName = tempFile.name || tempFile.fileName || tempFile.tempFilePath?.split('/').pop() || `image_${Date.now()}.jpg`;
    const timestamp = Date.now();
    const cloudPath = `chat_images/${timestamp}_${fileName}`;
    let imageInfo = {};
    try {
      imageInfo = await new Promise((resolve) => {
        wx.getImageInfo({
          src: tempFilePath,
          success: resolve,
          fail: () => resolve({})
        });
      });
    } catch (e) {}
    try {
      const thumbLocalPath = await this.createImageThumbnail(tempFilePath);
      const thumbExt = (thumbLocalPath.split('.').pop() || 'jpg').toLowerCase();
      const thumbNameBase = fileName.replace(/\.[^.]+$/, '');
      const thumbnailCloudPath = `chat_images_thumbnails/${timestamp}_${thumbNameBase}.${thumbExt}`;

      const [originRes, thumbRes] = await Promise.all([
        this.uploadFileToCloud(cloudPath, tempFilePath),
        this.uploadFileToCloud(thumbnailCloudPath, thumbLocalPath || tempFilePath)
      ]);

      const imageUrl = originRes.fileID;
      const thumbnail = (thumbRes && thumbRes.fileID) || '';

      // 上传完成后立即批量转换临时URL，供本地消息直接显示，避免 ensureMediaUrlsAsync 的二次延迟
      let tempDisplayUrl = imageUrl;
      let tempDisplayThumbnail = thumbnail;
      try {
        const fileIDsToConvert = [imageUrl, thumbnail].filter(Boolean);
        const tempRes = await wx.cloud.getTempFileURL({ fileList: fileIDsToConvert });
        const urlMap = {};
        (tempRes.fileList || []).forEach(item => { urlMap[item.fileID] = item.tempFileURL; });
        tempDisplayUrl = urlMap[imageUrl] || imageUrl;
        tempDisplayThumbnail = urlMap[thumbnail] || thumbnail;
      } catch (e) {
        // 转换失败时回退原 fileID，由 ensureMediaUrlsAsync 兜底
      }

      const extra = {
        fileName,
        width: Number(tempFile.width) || Number(imageInfo.width) || 0,
        height: Number(tempFile.height) || Number(imageInfo.height) || 0,
        fileSize: Number(tempFile.size) || 0,
        cloudPath,
        thumbnail,
        thumbnailCloudPath,
        _tempUrl: tempDisplayUrl,
        _tempThumbnail: tempDisplayThumbnail
      };
      this.sendMessage(imageUrl, 'image', extra);
    } catch (error) {
      console.error('上传图片失败', error);
      wx.showToast({ title: '上传图片失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },
  
  // 输入框聚焦
  onInputFocus(e) {
    const openedPanel = this.data.showEmojiPanel || this.data.showMorePanel;
    this._inputRefocusDeadline = openedPanel ? (Date.now() + 1000) : 0;
    this.setData({
      showEmojiPanel: false,
      showMorePanel: false,
      inputFocus: true,
      listBottomSpaceRpx: 100,
      scrollTop: 999999
    });
    // 确保输入框保持焦点
    setTimeout(() => {
      this.setData({ inputFocus: true });
    }, 100);
  },
  
  // 输入框失焦
  onInputBlur() {
    if (this._inputRefocusDeadline && Date.now() <= this._inputRefocusDeadline) {
      this.setData({
        inputFocus: true,
        listBottomSpaceRpx: 100,
        scrollTop: 999999
      });
      return;
    }
    this._inputRefocusDeadline = 0;
    this.setData({ inputFocus: false });
  },
  
  // 输入框点击
  onInputTap() {
    const openedPanel = this.data.showEmojiPanel || this.data.showMorePanel;
    this._inputRefocusDeadline = openedPanel ? (Date.now() + 1000) : 0;
    this.setData({ 
      showEmojiPanel: false,
      showMorePanel: false,
      inputFocus: true,
      listBottomSpaceRpx: 100,
      scrollTop: 999999
    });
    // 确保输入框获得焦点
    setTimeout(() => {
      this.setData({ inputFocus: true });
    }, 50);
  },
  
  // 聚焦输入框
  focusInput() {
    // 简单的方式，直接给输入框设置focus
    this.setData({});
  },
  
  // 判断字符是否是表情
  isEmoji(char) {
    // 简单的表情判断，实际应用中可能需要更复杂的正则
    const emojiRegex = /[\uD83C-\uDBFF\uDC00-\uDFFF]/;
    return emojiRegex.test(char) || char.length > 1;
  },
  

  
  // 拍摄照片
  takePhoto() {
    wx.chooseImage({
      count: 1,
      sizeType: ['original', 'compressed'],
      sourceType: ['camera'],
      success: (res) => {
        const tempFilePaths = res.tempFilePaths;
        this.uploadImage(tempFilePaths[0]);
      }
    });
  },
  
  // 选择视频
  chooseVideo() {
    wx.chooseVideo({
      sourceType: ['album', 'camera'],
      maxDuration: 60,
      camera: 'back',
      success: (res) => {
        const tempFilePath = res.tempFilePath;
        this.uploadVideo(tempFilePath);
      }
    });
  },
  
  // 上传视频
  async uploadVideo(tempFilePath, tempFile = {}) {
    this.setData({ loading: true });
    const normalizedTempFilePath = tempFilePath || tempFile.tempFilePath || tempFile.path || '';
    const fileName = tempFile.name || tempFile.fileName || normalizedTempFilePath.split('/').pop() || `video_${Date.now()}.mp4`;
    const cloudPath = `chat_videos/${Date.now()}_${fileName}`;
    let videoInfo = {};
    try {
      videoInfo = await new Promise((resolve) => {
        wx.getVideoInfo({
          src: normalizedTempFilePath,
          success: resolve,
          fail: () => resolve({})
        });
      });
    } catch (e) {}
    let poster = '';
    if (tempFile.thumbTempFilePath) {
      try {
        const posterRes = await wx.cloud.uploadFile({
          cloudPath: `chat_video_posters/${Date.now()}_${fileName.replace(/\.[^.]+$/, '')}.jpg`,
          filePath: tempFile.thumbTempFilePath
        });
        poster = posterRes.fileID || '';
      } catch (e) {}
    }
    wx.cloud.uploadFile({
      cloudPath,
      filePath: normalizedTempFilePath,
      success: (res) => {
        const videoUrl = res.fileID;
        const fallbackWidth = Number(tempFile.width) || Number(tempFile.videoWidth) || Number(videoInfo.width) || 0;
        const fallbackHeight = Number(tempFile.height) || Number(tempFile.videoHeight) || Number(videoInfo.height) || 0;
        const extra = {
          fileName,
          width: fallbackWidth,
          height: fallbackHeight,
          duration: Number(tempFile.duration) || Number(videoInfo.duration) || 0,
          fileSize: Number(tempFile.size) || Number(videoInfo.size) || 0,
          poster,
          thumbnail: poster,
          cloudPath
        };
        this.sendMessage(videoUrl, 'video', extra);
      },
      fail: (error) => {
        console.error('上传视频失败', error);
        wx.showToast({ title: '上传视频失败', icon: 'none' });
        this.setData({ loading: false });
      }
    });
  },
  
  // 发送位置
  sendLocation() {
    wx.chooseLocation({
      success: (res) => {
        const locationInfo = {
          name: res.name,
          address: res.address,
          latitude: res.latitude,
          longitude: res.longitude
        };
        this.sendMessage(JSON.stringify(locationInfo), 'location');
      }
    });
  },
  
  // 开始语音输入
  // 滚动到底部
  scrollToBottom() {
    setTimeout(() => {
      const query = wx.createSelectorQuery();
      query.select('#message-list').fields({
        scrollOffset: true,
        size: true
      });
      query.exec((res) => {
        if (res[0]) {
          // 使用scroll-view的scroll-top属性
          this.setData({
            scrollTop: res[0].scrollHeight
          });
        }
      });
    }, 200);
  },
  
  // 分组消息
  groupMessages(messages) {
    if (!messages || messages.length === 0) {
      return [];
    }

    const GAP_MS = 5 * 60 * 1000; // 5 分钟间隔

    return messages.map((message, index) => {
      if (index === 0) {
        return Object.assign({}, message, {
          showTimeStrip: true,
          timeStripText: this.formatMessageTime(message.createTime)
        });
      }
      const prev = messages[index - 1];
      const prevMs = prev.createTime instanceof Date
        ? prev.createTime.getTime()
        : new Date(prev.createTime).getTime();
      const curMs = message.createTime instanceof Date
        ? message.createTime.getTime()
        : new Date(message.createTime).getTime();
      const showStrip = (curMs - prevMs) >= GAP_MS;
      return Object.assign({}, message, {
        showTimeStrip: showStrip,
        timeStripText: showStrip ? this.formatMessageTime(message.createTime) : ''
      });
    });
  },

  // 微信风格时间格式化：间隔>=5分钟才显示，含具体时分
  formatMessageTime(time) {
    if (!time) return '';
    try {
      const date = (time instanceof Date) ? time : new Date(time);
      if (isNaN(date.getTime())) return '';

      const now = new Date();
      const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const nowOnly  = new Date(now.getFullYear(),  now.getMonth(),  now.getDate());
      const diffDays = Math.floor((nowOnly - dateOnly) / 86400000);

      const pad = n => n < 10 ? '0' + n : '' + n;
      const hm  = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
      const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

      if (diffDays === 0) {
        return hm;
      } else if (diffDays === 1) {
        return `昨天 ${hm}`;
      } else if (diffDays < 7) {
        return `星期${weekdays[date.getDay()]} ${hm}`;
      } else if (date.getFullYear() === now.getFullYear()) {
        return `${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
      } else {
        return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
      }
    } catch (e) {
      console.error('时间格式化失败:', e);
      return '';
    }
  },

  // 兼容保留（其他地方若有引用不报错）
  formatTimeByRule(time) {
    return this.formatMessageTime(time);
  },

  // 滑动到底部显示最新消息
  scrollToBottom() {
    this.setData({
      scrollTop: 999999,
      newMessageCount: 0,
      isScrolledToBottom: true
    });
  },

  // 处理点击新消息提示条
  onNewMessageTip() {
    this.scrollToBottom();
  },

  // 获取消息列表内容高度（用于检测是否在底部）
  getMessageListHeight() {
    return new Promise((resolve) => {
      const query = wx.createSelectorQuery();
      query.select('#message-content').boundingClientRect((rect) => {
        if (rect) {
          this.setData({ messageListScrollHeight: rect.height });
          resolve(rect.height);
        } else {
          resolve(0);
        }
      }).exec();
    });
  },

  // 返回上一页
  onBack() {
    wx.navigateBack();
  },

  
  // 页面卸载时取消监听
  onUnload() {
    if (this.messageWatch) {
      this.messageWatch.close();
    }
    this._historyPrefetchBuffer = [];
    this._historyPrefetching = false;
    this._historyPrefetchHasMore = true;
    if (this._newMsgObserver) {
      this._newMsgObserver.disconnect();
      this._newMsgObserver = null;
    }
    if (this._bottomAnchorObserver) {
      this._bottomAnchorObserver.disconnect();
      this._bottomAnchorObserver = null;
    }
    if (this._bottomSyncTimer) {
      clearTimeout(this._bottomSyncTimer);
      this._bottomSyncTimer = null;
    }
    if (this._bottomSyncInterval) {
      clearInterval(this._bottomSyncInterval);
      this._bottomSyncInterval = null;
    }
    if (this._userTouchListTimer) {
      clearTimeout(this._userTouchListTimer);
      this._userTouchListTimer = null;
    }
  },
  pinToEntryAnchor(anchorId) {
    const targetAnchorId = anchorId || this.getPreferredAnchorId(this.data.messages || []);
    this.setData({
      scrollIntoView: targetAnchorId
    });
  },
  scrollToBottomAnchor(anchorId) {
    if (this.data.entryBottomLocking) {
      this.pinToEntryAnchor(anchorId);
      return;
    }
    const targetAnchorId = anchorId || this.getPreferredAnchorId(this.data.messages || []);
    this.setData({ scrollIntoView: targetAnchorId });
    setTimeout(() => {
      this.setData({ scrollIntoView: '' });
    }, 40);
  },
  startBottomSyncWindow() {
    // 首屏只允许一次底部同步，避免任何重入导致多次来回滚动。
    if (this._initialBottomSyncDone || this._initialBottomSyncRunning) {
      return;
    }
    this._initialBottomSyncRunning = true;
    if (this._bottomSyncTimer) {
      clearTimeout(this._bottomSyncTimer);
      this._bottomSyncTimer = null;
    }
    if (this._bottomSyncInterval) {
      clearInterval(this._bottomSyncInterval);
      this._bottomSyncInterval = null;
    }
    this._userInterruptedBottomSync = false;
    this._bottomSyncSessionId = (this._bottomSyncSessionId || 0) + 1;
    // 首屏仅使用 scrollTop 一次到底，避免 scrollIntoView 在真机多次触发锚点重排。
    this.setData({ keepBottomSyncing: true, initialScrollReady: false });
    this.setData({ scrollTop: 999999, scrollIntoView: '' });
    wx.nextTick(() => {
      this.setData({ messageListReady: true });
      wx.nextTick(() => {
        const shouldRefresh = !!this.data.pendingMessageRefresh;
        this.setData({
          keepBottomSyncing: false,
          initialScrollReady: true,
          firstScreenVisible: true,
          pendingMessageRefresh: false,
          entryBottomLocking: false,
          scrollIntoView: ''
        });
        this._initialBottomSyncDone = true;
        this._initialBottomSyncRunning = false;
        if (shouldRefresh) {
          this.initMessages({ silent: true });
        }
      });
    });
  },
  stopBottomSyncWindowByUser() {
    this._userInterruptedBottomSync = true;
    this._bottomSyncSessionId = (this._bottomSyncSessionId || 0) + 1;
    if (!this.data.keepBottomSyncing) return;
    if (this._bottomSyncInterval) {
      clearInterval(this._bottomSyncInterval);
      this._bottomSyncInterval = null;
    }
    if (this._bottomSyncTimer) {
      clearTimeout(this._bottomSyncTimer);
      this._bottomSyncTimer = null;
    }
    this.setData({
      keepBottomSyncing: false,
      initialScrollReady: true,
      firstScreenVisible: true,
      entryBottomLocking: false,
      scrollIntoView: ''
    });
    this._initialBottomSyncDone = true;
    this._initialBottomSyncRunning = false;
  },
  onMessageListTouchStart() {
    // 用户一触摸列表就结束首屏钉底同步，避免第一下滑动被拉回底部。
    this._userInterruptedBottomSync = true;
    this._hasUserScrolledList = true;
    if (this.data.keepBottomSyncing) {
      this.stopBottomSyncWindowByUser();
    }
    this._userIsTouchingList = true;
    if (this._userTouchListTimer) {
      clearTimeout(this._userTouchListTimer);
    }
    this._userTouchListTimer = setTimeout(() => {
      this._userIsTouchingList = false;
      this._userTouchListTimer = null;
    }, 350);
  },
  handleMediaLoad() {
    // 首屏阶段不再根据媒体加载重复定位，避免真机上出现额外回拉。
    return;
  },
  
  // 时间格式化函数
  formatTime: function(time) {
    debugLog('格式化时间:', time);
    if (!time) return '';
    
    try {
      // 尝试将时间转换为日期对象
      let date;
      if (typeof time === 'string') {
        debugLog('时间是字符串:', time);
        date = new Date(time);
      } else if (time instanceof Date) {
        debugLog('时间是日期对象:', time);
        date = time;
      } else {
        debugLog('时间是其他类型:', typeof time, time);
        // 如果是对象，尝试转换为字符串再处理
        date = new Date(time.toString());
      }
      
      debugLog('转换后的日期:', date);
      
      // 检查日期是否有效
      if (!isNaN(date.getTime())) {
        debugLog('日期有效:', date.getTime());
        // 格式化日期为 "年月日时分" 格式
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const formattedTime = `${year}-${month}-${day} ${hours}:${minutes}`;
        debugLog('格式化后的时间:', formattedTime);
        return formattedTime;
      } else {
        debugLog('日期无效');
        // 如果日期无效，返回当前时间
        const now = new Date();
        const year = now.getFullYear();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const formattedTime = `${year}-${month}-${day} ${hours}:${minutes}`;
        debugLog('使用当前时间:', formattedTime);
        return formattedTime;
      }
    } catch (error) {
      console.error('时间格式化失败:', error);
      // 处理错误，返回当前时间
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');
      const day = now.getDate().toString().padStart(2, '0');
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      const formattedTime = `${year}-${month}-${day} ${hours}:${minutes}`;
      debugLog('使用当前时间 (错误):', formattedTime);
      return formattedTime;
    }
  },

  // 监听底部锚点是否进入可视区域，精准判定是否在底部
  initBottomAnchorObserver() {
    if (this._bottomAnchorObserver) {
      this._bottomAnchorObserver.disconnect();
      this._bottomAnchorObserver = null;
    }
    wx.nextTick(() => {
      const observer = wx.createIntersectionObserver(this, { thresholds: [0, 0.01] });
      observer.relativeTo('.message-list', { bottom: 50 }).observe('#bottom-anchor', (res) => {
        const isAtBottom = !!(res && res.intersectionRatio > 0);
        const patch = {};
        if (isAtBottom !== this.data.isScrolledToBottom) {
          patch.isScrolledToBottom = isAtBottom;
        }
        if (isAtBottom && this.data.newMessageCount > 0) {
          patch.newMessageCount = 0;
          patch.lastNewMessageId = '';
        }
        if (Object.keys(patch).length) {
          this.setData(patch);
        }
      });
      this._bottomAnchorObserver = observer;
    });
  },

  // 兼容旧调用名
  _initBottomAnchorObserver() {
    this.initBottomAnchorObserver();
  },

  // 监听最后一条新消息进入视口，进入后清零新消息计数
  _observeLastNewMessage(messageId) {
    // 断开旧的 observer
    if (this._newMsgObserver) {
      this._newMsgObserver.disconnect();
      this._newMsgObserver = null;
    }
    wx.nextTick(() => {
      const observer = wx.createIntersectionObserver(this, { thresholds: [0.5] });
      observer.relativeToViewport().observe(`#msg-${messageId}`, (res) => {
        if (res.intersectionRatio >= 0.5) {
          // 最后一条新消息已可见，清零计数
          this.setData({ newMessageCount: 0, lastNewMessageId: '' });
          observer.disconnect();
          this._newMsgObserver = null;
        }
      });
      this._newMsgObserver = observer;
    });
  },

  // 监听滚动事件
  onScroll(e) {
    const { scrollTop } = e.detail;
    const prevScrollTop = Number(this.data.currentScrollTop) || 0;
    if (this.data.messageActionMenuVisible) {
      this.setData({
        messageActionMenuVisible: false,
        messageActionMenuMessage: null,
        messageActionMenuActions: []
      });
    }
    this.setData({
      currentScrollTop: scrollTop
    });

    if (this._userIsTouchingList && Math.abs(scrollTop - prevScrollTop) > 2) {
      this._hasUserScrolledList = true;
    }
    // 兼容部分机型 touchstart 不稳定：只要首屏完成后出现明显上滑，也视为用户滚动。
    if (this.data.firstScreenVisible && (prevScrollTop - scrollTop) > 2) {
      this._hasUserScrolledList = true;
    }

    // 用户手势滚动时，立即结束首屏底部同步窗口，避免前几次上滑被钉回底部。
    if (this.data.keepBottomSyncing && this._userIsTouchingList && Math.abs(scrollTop - prevScrollTop) > 2) {
      this.stopBottomSyncWindowByUser();
    }

    // 接近顶部时提前预取，尽量保证真正触顶时历史页已经在本地缓存中。
    if (scrollTop <= 1400) {
      this.prefetchOlderMessages();
    }

    // 顶部兜底触发：仅在用户手势滚动中启用，避免程序滚动误触发历史加载造成来回抖动。
    if (this.data.firstScreenVisible && this._userIsTouchingList && scrollTop <= 800) {
      this.loadMoreMessages();
    }
    
    // 当滚动位置小于0时，强制设置为0，防止过度滚动
    if (scrollTop < 0) {
      // 使用 setTimeout 来确保滚动位置被正确设置
      setTimeout(() => {
        this.setData({ scrollTop: 0 });
      }, 0);
    }
  },

  handleImagePreview(e) {
    const { src, message } = e.currentTarget.dataset;
    if (!src && !(message && message.content)) return;
    this.openMediaPreview(message, 'image', src);
  },

  handleVideoPreview(e) {
    const { src, message } = e.currentTarget.dataset;
    if (!src && !(message && message.content)) return;
    this.openMediaPreview(message, 'video', src);
  },

  openMediaPreview(targetMessage, fallbackType, fallbackSrc) {
    // 先用当前列表快速展示，然后异步加载完整列表
    const quickMediaList = this.buildPreviewMediaList(this.data.messages || []);

    if (!quickMediaList.length) {
      const safeSrc = fallbackSrc || (targetMessage && targetMessage.content) || '';
      if (!safeSrc) return;
      const safeType = (targetMessage && targetMessage.type) || fallbackType || 'image';
      this.setData({
        previewVisible: true,
        previewMediaList: [{ _id: '', type: safeType, src: safeSrc }],
        previewMediaIndex: 0,
        previewType: safeType,
        previewSrc: safeSrc,
        messageActionMenuVisible: false,
        messageScrollEnabled: false
      });
      return;
    }

    const targetId = targetMessage && targetMessage._id;
    const targetSrc = fallbackSrc || (targetMessage && targetMessage.content) || '';
    const targetType = (targetMessage && targetMessage.type) || fallbackType || '';
    let index = 0;
    if (targetId) {
      const idxById = quickMediaList.findIndex((item) => item._id === targetId);
      if (idxById >= 0) index = idxById;
    } else {
      const idxBySrc = quickMediaList.findIndex((item) => item.src === targetSrc && item.type === targetType);
      if (idxBySrc >= 0) index = idxBySrc;
    }

    const current = quickMediaList[index] || quickMediaList[0];
    this.setData({
      previewVisible: true,
      previewMediaList: quickMediaList,
      previewMediaIndex: index,
      previewType: current.type,
      previewSrc: current.src,
      messageActionMenuVisible: false,
      messageScrollEnabled: false
    });

    // 异步补全会话内完整媒体列表
    this._targetPreviewId = targetId;
    this._targetPreviewSrc = targetSrc;
    this._targetPreviewType = targetType;
    this.loadSessionMediaForPreview();
  },

  async loadSessionMediaForPreview() {
    if (this._loadingPreviewMediaList) return;
    this._loadingPreviewMediaList = true;
    try {
      const { sessionId } = this.data;
      if (!sessionId) return;

      const res = await db.collection('messages')
        .where({
          sessionId,
          type: _.in(['image', 'video'])
        })
        .orderBy('createTime', 'desc')
        .limit(200)
        .get();

      const fullMediaList = this.buildPreviewMediaList(this.processMessageList(res.data));

      if (!fullMediaList.length) return;

      // 转换cloudFileID为临时URL
      const fileIDsToConvert = fullMediaList
        .filter(item => item.src && (item.src.startsWith('cloud://') || !item.src.startsWith('http')))
        .map(item => item.src);
      
      if (fileIDsToConvert.length > 0) {
        try {
          const urlRes = await wx.cloud.getTempFileURL({
            fileList: fileIDsToConvert
          });
          
          if (urlRes.fileList && urlRes.fileList.length > 0) {
            const urlMap = {};
            urlRes.fileList.forEach(item => {
              urlMap[item.fileID] = item.tempFileURL;
            });
            
            // 替换全部src
            fullMediaList.forEach(item => {
              if (urlMap[item.src]) {
                item.src = urlMap[item.src];
              }
            });
          }
        } catch (e) {
          debugLog('转换预览媒体URL失败:', e);
        }
      }

      if (!fullMediaList.length) return;

      // 重点：只更新当前显示的图片的URL（如果需要），不改变预览列表本身
      // 这样可以避免列表不一致导致的索引重置
      if (!this.data.previewVisible) return;
      
      const currentItem = this.data.previewMediaList && this.data.previewMediaList[this.data.previewMediaIndex];
      if (!currentItem) return;
      
      // 尝试在完整列表中找到对应的更新URL
      const fullItem = fullMediaList.find(item => item._id === currentItem._id);
      if (fullItem && fullItem.src && fullItem.src.startsWith('http')) {
        // 更新当前显示的URL
        this.setData({ previewSrc: fullItem.src });
      }
      
      // 不改变previewMediaList，保持原有结构
    } catch (error) {
      console.error('补全预览媒体URL失败', error);
    } finally {
      this._loadingPreviewMediaList = false;
    }
  },

  handlePreviewSwiperChange(e) {
    const index = Number(e && e.detail && e.detail.current);
    if (!Number.isFinite(index)) return;
    const current = this.data.previewMediaList && this.data.previewMediaList[index];
    if (!current) return;
    this.setData({
      previewMediaIndex: index,
      previewType: current.type,
      previewSrc: current.src
    });
  },

  closePreview() {
    this._targetPreviewId = null;
    this._targetPreviewSrc = null;
    this._targetPreviewType = null;
    this.setData({
      previewVisible: false,
      previewType: '',
      previewSrc: '',
      previewMediaList: [],
      previewMediaIndex: 0,
      messageScrollEnabled: true
    });
  },

  stopPreviewPropagation() {
    return;
  },
  async openMoreAction(e) {
    const { action } = e.currentTarget.dataset;
    if (action === 'photo') {
      this.chooseImage();
      return;
    }
    if (action === 'cart') {
      await this.openCartPicker();
      return;
    }
    if (action === 'order') {
      await this.openOrderPicker();
    }
  },
  getTargetOpenid() {
    if (this.data.isCustomerService) return this.data.targetUserOpenid;
    return this.data.openid;
  },
  getMessageSenderOpenid(message) {
    if (!message) return '';
    return message.openid || message._openid || message.senderOpenid || '';
  },
  normalizeDateInput(raw) {
    if (!raw) return null;
    if (raw instanceof Date) {
      return Number.isNaN(raw.getTime()) ? null : raw;
    }
    if (typeof raw === 'object') {
      // 云数据库/序列化常见日期对象兼容
      
      // 处理云端返回的 { _type: 'Date', _value: timestamp } 格式
      if (raw._type === 'Date' && typeof raw._value !== 'undefined') {
        const date = new Date(raw._value);
        return Number.isNaN(date.getTime()) ? null : date;
      }
      
      if (typeof raw.getTime === 'function') {
        const date = new Date(raw.getTime());
        return Number.isNaN(date.getTime()) ? null : date;
      }
      if (typeof raw.toDate === 'function') {
        const date = raw.toDate();
        return (date instanceof Date && !Number.isNaN(date.getTime())) ? date : null;
      }
      if (raw.$date) {
        return this.normalizeDateInput(raw.$date);
      }
      if (raw.date) {
        return this.normalizeDateInput(raw.date);
      }
      if (raw.value) {
        return this.normalizeDateInput(raw.value);
      }
      return null;
    }
    if (typeof raw === 'number') {
      const date = new Date(raw);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return null;

      // 先尝试原始解析
      let date = new Date(trimmed);
      if (!Number.isNaN(date.getTime())) return date;

      // 兼容 "Wed Apr 15 2026 18:11:49 GMT+0800 (中国标准时间)" 等格式
      const cleaned = trimmed
        .replace(/\s*\([^)]*\)\s*$/, '')
        .replace(/GMT([+-]\d{2})(\d{2})/, 'GMT$1:$2');
      date = new Date(cleaned);
      if (!Number.isNaN(date.getTime())) return date;

      // 兼容 yyyy-mm-dd HH:mm:ss
      const normalized = cleaned.replace(/-/g, '/');
      date = new Date(normalized);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
  },
  formatDateTimeYMDHMS(raw) {
    const date = this.normalizeDateInput(raw);
    if (!date) return '';
    const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  },
  isWithinTwoMinutes(rawCreateTime) {
    const date = this.normalizeDateInput(rawCreateTime);
    if (!date) {
      console.warn('时间解析失败，rawCreateTime类型:', typeof rawCreateTime, '值:', JSON.stringify(rawCreateTime));
      return false;
    }
    const diff = Date.now() - date.getTime();
    const withinWindow = diff >= 0 && diff <= 2 * 60 * 1000;
    if (!withinWindow) {
      console.warn('消息超出2分钟撤回窗口: diff=', diff, 'ms, 解析的createTime:', date.toISOString(), '当前时间:', new Date().toISOString());
    }
    return withinWindow;
  },
  getMessageCreateTimeMs(message) {
    if (!message) return NaN;
    const ts = Number(message._createTimeTs);
    if (Number.isFinite(ts) && ts > 0) return ts;
    const parsed = this.normalizeDateInput(message.createTime);
    if (parsed) return parsed.getTime();
    return NaN;
  },
  isOwnMessage(message) {
    if (!message) return false;
    const senderOpenid = this.getMessageSenderOpenid(message);
    if (senderOpenid && this.data.openid) {
      return senderOpenid === this.data.openid;
    }
    // openid 不可用时用角色兜底，避免新发消息长按缺少“撤回”
    if (this.data.isCustomerService) {
      return message.role === 'customer_service';
    }
    return message.role === 'user';
  },
  async openCartPicker() {
    const targetOpenid = this.getTargetOpenid();
    if (!targetOpenid) return;
    this.setData({
      cartPickerPage: 0,
      cartPickerLoadingMore: false,
      cartPickerHasMore: true
    });
    await this.fetchCartPickerItems(true);
    this.setData({
      showCardPicker: true,
      cardPickerType: 'product_card',
      cardPickerTitle: '选择购物车商品',
      cardPickerOrderSourceItems: [],
      cardPickerOrderDeliveryTabs: [],
      cardPickerOrderStatusTabs: [],
      cardPickerOrderActiveDeliveryType: 'express',
      cardPickerOrderActiveStatus: 'all'
    });
  },

  async fetchCartPickerItems(reset = true) {
    const targetOpenid = this.getTargetOpenid();
    if (!targetOpenid) return;

    const { cartPickerLoadingMore, cartPickerHasMore, cartPickerPage, cartPickerPageSize } = this.data;
    if (cartPickerLoadingMore || !cartPickerHasMore) return;

    this.setData({ cartPickerLoadingMore: true });

    try {
      const page = reset ? 0 : cartPickerPage;
      const res = await db.collection('cart')
        .where({ _openid: targetOpenid, isDelete: _.neq(true) })
        .orderBy('updatedAt', 'desc')
        .skip(page * cartPickerPageSize)
        .limit(cartPickerPageSize)
        .get();

      const items = (res.data || []).map((item) => {
        const snapshot = item.productSnapshot || {};
        return {
          _id: item._id,
          productId: item.productId,
          coverImage: snapshot.coverImage || '',
          title: snapshot.name || '购物车商品',
          desc: `￥${snapshot.price || 0} · x${item.quantity || 1}`,
          price: snapshot.price || 0,
          quantity: item.quantity || 1,
          payload: {
            productId: item.productId,
            name: snapshot.name || '商品',
            desc: `x${item.quantity || 1}`,
            price: snapshot.price || 0,
            coverImage: snapshot.coverImage || ''
          }
        };
      });

      const hasMore = items.length === cartPickerPageSize;
      const newPage = reset ? 1 : page + 1;
      const newItems = reset ? items : [...this.data.cardPickerItems, ...items];

      this.setData({
        cardPickerItems: newItems,
        cartPickerPage: newPage,
        cartPickerLoadingMore: false,
        cartPickerHasMore: hasMore
      });
    } catch (err) {
      console.error('加载购物车商品失败', err);
      this.setData({ cartPickerLoadingMore: false });
    }
  },

  loadMoreCartPickerItems() {
    if (this.data.cardPickerType !== 'product_card') return;
    this.fetchCartPickerItems(false);
  },
  normalizeOrderToken(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim().toLowerCase();
  },
  getOrderPickerDeliveryTabs(items = []) {
    const expressItems = items.filter((item) => item._deliveryType === 'express');
    const pickupItems = items.filter((item) => item._deliveryType === 'pickup');
    const localItems = items.filter((item) => item._deliveryType === 'local');
    const firstLabel = this.data.isCustomerService ? '用户订单' : '我的订单';
    const tabs = [{
      key: 'express',
      label: firstLabel,
      count: expressItems.length
    }];
    if (pickupItems.length > 0) {
      tabs.push({
        key: 'pickup',
        label: '上门自提',
        count: pickupItems.length
      });
    }
    if (localItems.length > 0) {
      tabs.push({
        key: 'local',
        label: '同城配送',
        count: localItems.length
      });
    }
    return tabs;
  },
  getOrderPickerStatusTabs(deliveryType = 'express') {
    if (deliveryType === 'pickup') {
      return [
        { key: 'all', label: '全部' },
        { key: 'pending', label: '待支付' },
        { key: 'paid', label: '待自提' },
        { key: 'completed', label: '已完成' },
        { key: 'cancelled', label: '已取消' }
      ];
    }
    if (deliveryType === 'local') {
      return [
        { key: 'all', label: '全部' },
        { key: 'pending', label: '待支付' },
        { key: 'paid', label: '待配送' },
        { key: 'shipping', label: '配送中' },
        { key: 'completed', label: '已完成' },
        { key: 'cancelled', label: '已取消' }
      ];
    }
    return [
      { key: 'all', label: '全部' },
      { key: 'pending', label: '待支付' },
      { key: 'paid', label: '待发货' },
      { key: 'shipping', label: '待收货' },
      { key: 'completed', label: '已完成' },
      { key: 'refund', label: '售后' },
      { key: 'cancelled', label: '已取消' }
    ];
  },
  formatOrderStatusText(order = {}) {
    const deliveryType = this.normalizeOrderToken(order.deliveryType) || 'express';
    const status = this.normalizeOrderToken(order.status) || 'pending';
    const statusMap = {
      express: {
        pending: '待支付',
        paid: '待发货',
        shipping: '待收货',
        completed: '已完成',
        refund: '售后中',
        refund_completed: '售后完成',
        cancelled: '已取消'
      },
      pickup: {
        pending: '待支付',
        paid: '待自提',
        completed: '已完成',
        cancelled: '已取消'
      },
      local: {
        pending: '待支付',
        paid: '待配送',
        shipping: '配送中',
        completed: '已完成',
        cancelled: '已取消'
      }
    };
    return (statusMap[deliveryType] && statusMap[deliveryType][status]) || order.statusText || order.status || '订单';
  },
  buildOrderPickerItem(order = {}) {
    const firstProduct = (order.products && order.products[0]) || {};
    const deliveryType = this.normalizeOrderToken(order.deliveryType) || 'express';
    const status = this.normalizeOrderToken(order.status) || 'pending';
    const statusText = this.formatOrderStatusText(order);
    const productName = firstProduct.name || firstProduct.productName || '商品';
    const productPrice = Number(firstProduct.price || 0);
    const productQuantity = Number(firstProduct.quantity || 1);
    const totalAmount = Number(order.totalAmount || order.totalPrice || 0);
    const orderNumber = order.orderNumber || order._id;
    return {
      _id: order._id,
      orderId: order._id,
      orderNumber,
      coverImage: firstProduct.coverImage || '',
      title: `订单号：${orderNumber}`,
      desc: `￥${totalAmount}`,
      statusText,
      productName,
      productPrice,
      productQuantity,
      totalAmount,
      _deliveryType: deliveryType,
      _status: status,
      payload: {
        orderId: order._id,
        orderNumber,
        statusText,
        totalAmount,
        coverImage: firstProduct.coverImage || '',
        productName: productName,
        quantity: productQuantity
      }
    };
  },
  filterOrderPickerItems(items = [], deliveryType = 'express', status = 'all') {
    const normalizedDelivery = this.normalizeOrderToken(deliveryType) || 'express';
    const normalizedStatus = this.normalizeOrderToken(status) || 'all';
    return items.filter((item) => {
      if ((item._deliveryType || 'express') !== normalizedDelivery) return false;
      if (normalizedStatus === 'all') return true;
      if (normalizedStatus === 'refund') {
        return item._status === 'refund' || item._status === 'refund_completed';
      }
      return item._status === normalizedStatus;
    });
  },
  refreshOrderPickerItems() {
    const sourceItems = this.data.cardPickerOrderSourceItems || [];
    const deliveryTabs = this.data.cardPickerOrderDeliveryTabs || [];
    const fallbackDeliveryType = deliveryTabs[0] ? deliveryTabs[0].key : 'express';
    const activeDeliveryType = this.normalizeOrderToken(this.data.cardPickerOrderActiveDeliveryType) || fallbackDeliveryType;
    const statusTabs = this.getOrderPickerStatusTabs(activeDeliveryType);
    const activeStatusInTabs = statusTabs.some((tab) => tab.key === this.data.cardPickerOrderActiveStatus);
    const activeStatus = activeStatusInTabs ? this.data.cardPickerOrderActiveStatus : 'all';
    const filteredItems = this.filterOrderPickerItems(sourceItems, activeDeliveryType, activeStatus);
    this.setData({
      cardPickerItems: filteredItems,
      cardPickerOrderStatusTabs: statusTabs,
      cardPickerOrderActiveStatus: activeStatus,
      cardPickerOrderActiveDeliveryType: activeDeliveryType
    });
  },
  switchOrderPickerDeliveryTab(e) {
    const deliveryType = this.normalizeOrderToken(e.currentTarget.dataset.deliveryType) || 'express';
    this.setData({
      cardPickerOrderActiveDeliveryType: deliveryType,
      cardPickerOrderActiveStatus: 'all'
    });
    this.refreshOrderPickerItems();
  },
  switchOrderPickerStatusTab(e) {
    const status = this.normalizeOrderToken(e.currentTarget.dataset.status) || 'all';
    this.setData({ cardPickerOrderActiveStatus: status });
    this.refreshOrderPickerItems();
  },
  async openOrderPicker() {
    const targetOpenid = this.getTargetOpenid();
    if (!targetOpenid) return;
    const res = await db.collection('orders').where({ _openid: targetOpenid, isDeleted: _.neq(true) }).orderBy('updatedAt', 'desc').limit(30).get();
    const sourceItems = (res.data || []).map((order) => this.buildOrderPickerItem(order));
    const deliveryTabs = this.getOrderPickerDeliveryTabs(sourceItems);
    const activeDeliveryType = deliveryTabs[0] ? deliveryTabs[0].key : 'express';
    const statusTabs = this.getOrderPickerStatusTabs(activeDeliveryType);
    const items = this.filterOrderPickerItems(sourceItems, activeDeliveryType, 'all');
    this.setData({
      showCardPicker: true,
      cardPickerType: 'order_card',
      cardPickerTitle: this.data.isCustomerService ? '选择用户订单' : '选择我的订单',
      cardPickerItems: items,
      cardPickerOrderSourceItems: sourceItems,
      cardPickerOrderDeliveryTabs: deliveryTabs,
      cardPickerOrderStatusTabs: statusTabs,
      cardPickerOrderActiveDeliveryType: activeDeliveryType,
      cardPickerOrderActiveStatus: 'all'
    });
  },
  closeCardPicker() {
    this.setData({
      showCardPicker: false,
      cardPickerType: '',
      cardPickerTitle: '',
      cardPickerItems: [],
      cardPickerOrderSourceItems: [],
      cardPickerOrderDeliveryTabs: [],
      cardPickerOrderStatusTabs: [],
      cardPickerOrderActiveDeliveryType: 'express',
      cardPickerOrderActiveStatus: 'all'
    });
  },
  sendCardFromPicker(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = (Number.isFinite(index) && this.data.cardPickerItems[index]) ? this.data.cardPickerItems[index] : {};
    const cardType = this.data.cardPickerType;
    if (!cardType || !item.payload) return;
    this.sendMessage(JSON.stringify(item.payload), cardType);
    this.closeCardPicker();
  },
  handleCardTap(e) {
    const message = e.currentTarget.dataset.message || {};
    const cardData = message.cardData || this.parseCardData(message);
    if (!cardData) return;
    if (message.type === 'product_card' && cardData.productId) {
      wx.navigateTo({ url: `/pages/product-detail/index?id=${cardData.productId}` });
      return;
    }
    if (message.type === 'order_card' && cardData.orderId) {
      wx.navigateTo({ url: `/pages/order-detail/index?id=${cardData.orderId}` });
    }
  },
  canRevokeMessage(message) {
    if (!message || message.isRevoked) return false;
    const own = this.isOwnMessage(message);
    if (!own) {
      debugLog('撤回判定: 非本人消息', {
        messageId: message && message._id,
        senderOpenid: this.getMessageSenderOpenid(message),
        selfOpenid: this.data.openid,
        role: message && message.role,
        isCustomerService: this.data.isCustomerService
      });
      return false;
    }
    const messageTimeMs = this.getMessageCreateTimeMs(message);
    if (!Number.isFinite(messageTimeMs)) {
      debugLog('撤回判定: 时间解析失败', {
        messageId: message && message._id,
        createTime: message && message.createTime,
        _createTimeTs: message && message._createTimeTs
      });
      return false;
    }
    const diff = Date.now() - messageTimeMs;
    debugLog('撤回判定: 时间差(毫秒)', {
      messageId: message && message._id,
      diff,
      createTime: this.formatDateTimeYMDHMS(message && message.createTime)
    });
    return diff >= 0 && diff <= 2 * 60 * 1000;
  },
  buildMessageActionList(message) {
    const type = message && message.type ? message.type : 'text';
    const actions = [];
    if (type === 'text') {
      actions.push('copy');
    } else if (type === 'image' || type === 'video') {
      actions.push('save');
    }
    // 商品卡片/订单卡片默认不加复制/保存，只在可撤回时展示撤回
    if (this.canRevokeMessage(message)) {
      actions.push('revoke');
    }
    return actions;
  },
  handleMessageLongPress(e) {
    // 面板/键盘开启时，长按只负责关闭，不弹出操作菜单
    if (this.closePanelsOnLongPress()) return;

    const message = e.currentTarget.dataset.message;
    if (!message || message.isRevoked) return;
    const actions = this.buildMessageActionList(message);
    if (!actions.length) return;

    const touch = (e.changedTouches && e.changedTouches[0]) || {};
    const fallback = (e.detail && typeof e.detail.x === 'number') ? e.detail : { x: 200, y: 300 };
    const rawX = typeof touch.clientX === 'number' ? touch.clientX : fallback.x;
    const rawY = typeof touch.clientY === 'number' ? touch.clientY : fallback.y;

    this.getMessageBubbleRect(message._id).then((rect) => {
      const anchorX = rect ? (rect.left + rect.width / 2) : rawX;
      const anchorTopY = rect ? rect.top : rawY;
      this.openMessageActionMenu({ message, actions, anchorX, anchorTopY });
    });
  },
  getMessageBubbleRect(messageId) {
    return new Promise((resolve) => {
      if (!messageId) {
        resolve(null);
        return;
      }
      const query = wx.createSelectorQuery();
      query.select(`#msg-content-${messageId}`).boundingClientRect((rect) => {
        resolve(rect || null);
      }).exec();
    });
  },
  openMessageActionMenu({ message, actions, anchorX, anchorTopY }) {
    const menuWidth = 112;
    const itemHeight = 36;
    const padding = 8;
    const menuHeight = actions.length * itemHeight + padding;

    let windowWidth = 375;
    let windowHeight = 667;
    try {
      const info = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync();
      windowWidth = info.windowWidth || windowWidth;
      windowHeight = info.windowHeight || windowHeight;
    } catch (err) {
      // ignore
    }

    const clampedX = Math.max(8, Math.min(anchorX - menuWidth / 2, windowWidth - menuWidth - 8));
    const relativeArrowX = Math.max(14, Math.min(anchorX - clampedX, menuWidth - 14));
    const preferTop = anchorTopY - menuHeight - 14;
    const isMenuAboveBubble = preferTop >= 8;
    const clampedY = isMenuAboveBubble ? preferTop : Math.min(anchorTopY + 14, windowHeight - menuHeight - 8);

    this.setData({
      messageActionMenuVisible: true,
      messageScrollEnabled: false,
      messageActionMenuX: clampedX,
      messageActionMenuY: clampedY,
      messageActionMenuArrowX: relativeArrowX,
      messageActionMenuArrowDirection: isMenuAboveBubble ? 'down' : 'up',
      messageActionMenuActions: actions,
      messageActionMenuMessage: message,
      showEmojiPanel: false,
      showMorePanel: false
    }, () => {
      // 长按菜单弹出时如关闭了表情/更多面板，需要同步恢复底部间距，避免出现大块空白。
      this.updateListBottomSpace();
    });
  },
  closeMessageActionMenu() {
    if (!this.data.messageActionMenuVisible) return;
    this.setData({
      messageActionMenuVisible: false,
      messageScrollEnabled: true,
      messageActionMenuArrowDirection: 'down',
      messageActionMenuMessage: null,
      messageActionMenuActions: []
    });
  },
  handleMessageActionTap(e) {
    const { action } = e.currentTarget.dataset;
    const message = this.data.messageActionMenuMessage;
    this.closeMessageActionMenu();
    if (!action || !message) return;
    if (action === 'copy') this.copyMessage(message);
    if (action === 'save') this.saveMessageMedia(message);
    if (action === 'revoke') this.revokeMessage(message);
  },
  copyMessage(message) {
    wx.setClipboardData({
      data: message.content || '',
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  },
  async ensureAlbumPermission() {
    try {
      const settingRes = await new Promise((resolve, reject) => {
        wx.getSetting({ success: resolve, fail: reject });
      });

      const authSetting = (settingRes && settingRes.authSetting) || {};
      if (authSetting['scope.writePhotosAlbum'] === true) {
        return true;
      }

      if (authSetting['scope.writePhotosAlbum'] === false) {
        await new Promise((resolve, reject) => {
          wx.openSetting({
            success: (res) => {
              if (res.authSetting && res.authSetting['scope.writePhotosAlbum']) {
                resolve();
              } else {
                reject(new Error('未授予相册权限'));
              }
            },
            fail: reject
          });
        });
        return true;
      }

      await new Promise((resolve, reject) => {
        wx.authorize({
          scope: 'scope.writePhotosAlbum',
          success: resolve,
          fail: reject
        });
      });
      return true;
    } catch (error) {
      wx.showToast({ title: '请先开启相册权限', icon: 'none' });
      return false;
    }
  },
  async getMediaTempFilePath(src) {
    if (!src) {
      throw new Error('媒体地址为空');
    }

    if (src.startsWith('cloud://')) {
      const downRes = await wx.cloud.downloadFile({ fileID: src });
      return downRes.tempFilePath;
    }

    if (src.startsWith('http://') || src.startsWith('https://')) {
      const downRes = await new Promise((resolve, reject) => {
        wx.downloadFile({
          url: src,
          success: resolve,
          fail: reject
        });
      });

      if (!downRes || downRes.statusCode !== 200 || !downRes.tempFilePath) {
        throw new Error('下载媒体文件失败');
      }
      return downRes.tempFilePath;
    }

    return src;
  },
  async saveMessageMedia(message) {
    try {
      const hasPermission = await this.ensureAlbumPermission();
      if (!hasPermission) {
        return;
      }

      const tempFilePath = await this.getMediaTempFilePath(message.content || '');
      if (message.type === 'image') {
        await new Promise((resolve, reject) => {
          wx.saveImageToPhotosAlbum({
            filePath: tempFilePath,
            success: resolve,
            fail: reject
          });
        });
      } else {
        await new Promise((resolve, reject) => {
          wx.saveVideoToPhotosAlbum({
            filePath: tempFilePath,
            success: resolve,
            fail: reject
          });
        });
      }
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (err) {
      console.error('保存媒体失败:', err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },
  async revokeMessage(message) {
    try {
      // 前置检查：基础信息
      if (!message || !message._id) {
        throw new Error('消息ID缺失，无法撤回');
      }

      // 从消息列表中获取完整消息对象（确保 createTime 等字段正确，避免事件序列化丢失）
      const fullMessage = (this.data.messages || []).find(m => m._id === message._id);
      if (!fullMessage) {
        throw new Error('消息不存在或已删除，无法在本地消息列表找到 _id: ' + message._id);
      }

      // 使用完整消息对象进行验证
      if (!this.isOwnMessage(fullMessage)) {
        throw new Error('不是本人消息，无法撤回');
      }
      if (!this.isWithinTwoMinutes(fullMessage.createTime)) {
        throw new Error('消息超过2分钟，无法撤回');
      }

      // 服务端执行撤回，规避小程序端 update 返回 0 的不稳定问题
      const callRes = await wx.cloud.callFunction({
        name: 'revokeMessage',
        data: {
          messageId: fullMessage._id
        }
      });
      const result = callRes && callRes.result;
      if (!result || !result.success) {
        throw new Error((result && result.error) || '撤回失败，请稍后重试');
      }

      wx.showToast({ title: '已撤回', icon: 'success' });
      this.initMessages({ silent: true });
    } catch (err) {
      console.error('撤回消息失败:', err && err.message, '消息ID:', message && message._id, '消息openid:', message && message.openid);
      wx.showToast({ title: '撤回失败', icon: 'none' });
    }
  },
  handleRevokedReedit(e) {
    const message = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.message;
    if (!message || message.type !== 'text') return;
    const content = typeof message.content === 'string' ? message.content : '';
    this.setData({
      inputValue: content,
      inputFocus: true,
      showEmojiPanel: false,
      showMorePanel: false,
      messageActionMenuVisible: false,
      messageActionMenuArrowDirection: 'down',
      messageActionMenuMessage: null,
      messageActionMenuActions: []
    });
    this.updateListBottomSpace();
  },
  handlePreviewLongPress(e) {
    const { type, src } = e.currentTarget.dataset;
    if (!src) return;
    wx.showActionSheet({
      itemList: ['保存'],
      success: () => this.saveMessageMedia({ type, content: src })
    });
  },
  goBrowseFromPicker() {
    this.closeCardPicker();
    wx.switchTab({
      url: '/pages/category/index'
    });
  },
  closePendingEntryProductCard() {
    this.setData({
      pendingEntryProductCardVisible: false,
      pendingEntryProductCard: null
    });
  },
  sendPendingEntryProductCard() {
    const payload = this.data.pendingEntryProductCard;
    if (!payload || !payload.productId) {
      this.closePendingEntryProductCard();
      return;
    }
    this.sendMessage(JSON.stringify(payload), 'product_card');
    this.closePendingEntryProductCard();
  },
  handlePendingEntryProductCardTap() {
    const payload = this.data.pendingEntryProductCard || {};
    if (!payload.productId) return;
    wx.navigateTo({
      url: `/pages/product-detail/index?id=${payload.productId}`
    });
  },
  closePendingEntryOrderCard() {
    this.setData({
      pendingEntryOrderCardVisible: false,
      pendingEntryOrderCard: null
    });
  },
  sendPendingEntryOrderCard() {
    const payload = this.data.pendingEntryOrderCard;
    if (!payload || !payload.orderId) {
      this.closePendingEntryOrderCard();
      return;
    }
    this.sendMessage(JSON.stringify(payload), 'order_card');
    this.closePendingEntryOrderCard();
  },
  handlePendingEntryOrderCardTap() {
    const payload = this.data.pendingEntryOrderCard || {};
    if (!payload.orderId) return;
    wx.navigateTo({
      url: `/pages/order-detail/index?id=${payload.orderId}`
    });
  }
});