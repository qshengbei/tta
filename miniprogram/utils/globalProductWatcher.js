/**
 * GlobalProductWatcher - 全局商品监听器
 *
 * 全局单例，维护唯一的 products 集合 watch 连接。
 * 所有商品列表页面通过 subscribe() 订阅变更事件，
 * 不再各自创建 watcherManager watcher。
 *
 * 变更分发策略 (G+方案):
 * - 有可见页面 → 更新缓存 + 通知页面更新UI
 * - 无可见页面 → 更新缓存 + 标记缓存已更新
 *
 * 使用方式:
 *   const watcher = getGlobalProductWatcher();
 *   const unsub = watcher.subscribe('page_xxx', 'cache_key', (change) => { ... });
 *   watcher.setPageVisible('page_xxx', true/false);
 *   unsub(); // 页面卸载时取消订阅
 */

import productCacheStore from './productCacheStore';

// 懒加载，避免 import 时 wx.cloud.init() 尚未调用
let _db = null;
let __ = null;
function getDb() {
  if (!_db) _db = wx.cloud.database();
  return _db;
}
function getCmd() {
  if (!__) __ = getDb().command;
  return __;
}

let instance = null;

class GlobalProductWatcher {
  constructor() {
    this._subscribers = new Map();    // pageId → { handler, cacheKey }
    this._pageVisible = new Map();    // pageId → boolean
    this._watchInstance = null;
    this._isActive = false;
    this._isInit = false;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 10;
    this._reconnectTimer = null;
    this._registeredCacheKeys = new Map(); // cacheKey → query
    this._cacheUpdated = new Map(); // cacheKey → { updated: boolean, timestamp: number }
    this._cacheCleanupTimers = {}; // cacheKey → timeoutId
    this._lastMessageTime = 0;      // 最后一次收到消息的时间戳
    this._lastHeartbeat = 0;        // 最后一次心跳时间
    this._healthCheckTimer = null; // 健康检查定时器（已禁用）
    // 注意：健康检查已禁用，因为没收到消息不等于连接不健康
    // 微信云数据库的 watch 是长连接，没有数据变化时长时间没消息是正常的
    // 真正的连接断开会被 _watchInstance.on 错误回调捕获并重连
    this._healthCheckInterval = 30000; // 保留但不使用
    this._healthyThreshold = 120000;   // 保留但不使用
    this._healthListeners = [];    // 健康状态变化监听器
  }

  /**
   * 获取监听器健康状态
   * @param {number} healthyThreshold - 健康阈值（毫秒），超过此时间未收到消息则认为不健康
   * @returns {Object} 健康状态信息
   */
  getHealthStatus(healthyThreshold = 30000) {
    const now = Date.now();
    const timeSinceLastMessage = now - this._lastMessageTime;
    const isHealthy = this._isActive && timeSinceLastMessage < healthyThreshold;
    
    return {
      isHealthy,
      isActive: this._isActive,
      subscriberCount: this._subscribers.size,
      registeredCacheKeyCount: this._registeredCacheKeys.size,
      lastMessageTime: this._lastMessageTime,
      timeSinceLastMessage,
      reconnectAttempts: this._reconnectAttempts,
      healthyThreshold
    };
  }

  /**
   * 添加健康状态变化监听器
   * @param {function} listener - 监听器回调 (isHealthy) => {}
   * @returns {function} 取消订阅函数
   */
  addHealthListener(listener) {
    this._healthListeners.push(listener);
    return () => {
      const index = this._healthListeners.indexOf(listener);
      if (index > -1) {
        this._healthListeners.splice(index, 1);
      }
    };
  }

  /**
   * 检查监听器健康状态（用于页面调用）
   * 如果监听器不健康，返回需要从数据库获取数据的建议
   * 
   * 注意：只检查监听器是否激活，不检查"长时间无消息"，
   * 因为页面离开时监听器断开是正常行为，不应该因此触发强制刷新
   * @returns {Object} { needsRefresh: boolean, reason: string }
   */
  checkNeedsRefresh() {
    // 只检查监听器是否激活
    if (!this._isActive) {
      return {
        needsRefresh: true,
        reason: '监听器未激活，可能已断开'
      };
    }
    
    // 检查是否正在重连
    if (this._reconnectAttempts > 0) {
      return {
        needsRefresh: true,
        reason: '监听器正在重连中'
      };
    }
    
    return {
      needsRefresh: false,
      reason: '监听器状态正常'
    };
  }

  /**
   * 初始化（app.js onLaunch 时调用）
   */
  init() {
    if (this._isActive || this._isInit) {
      console.warn('[GlobalProductWatcher] already initialized');
      return;
    }
    this._isInit = true;
    this._startWatch();
  }

  /**
   * 页面订阅
   * @param {string} pageId - 页面唯一标识
   * @param {string} cacheKey - 该页面使用的缓存 key
   * @param {function} handler - 变更回调 ({ type, product, oldProduct? })
   * @returns {function} unsubscribe 函数
   */
  subscribe(pageId, cacheKey, handler) {
    if (cacheKey) {
      // 注册缓存 key（不带查询条件，后续通过 registerCacheKeyWithQuery 设置）
      if (!this._registeredCacheKeys.has(cacheKey)) {
        this._registeredCacheKeys.set(cacheKey, null);
      }
    }

    this._subscribers.set(pageId, { handler, cacheKey: cacheKey || '' });

    console.log('[GlobalProductWatcher] Page subscribed:', pageId, 'cacheKey:', cacheKey);

    // 自动设置页面可见性（订阅时默认页面是可见的）
    this._pageVisible.set(pageId, true);
    console.log('[GlobalProductWatcher] Page visibility:', pageId, true);

    // 尝试启动 watch（如果尚未启动）
    if (this._isInit && !this._isActive && !this._watchInstance) {
      this._startWatch();
    }

    return () => {
      const removedSubscriber = this._subscribers.get(pageId);
      this._subscribers.delete(pageId);
      this._pageVisible.delete(pageId);
      
      // 检查该缓存 key 是否还有其他订阅者使用
      // 如果没有，延迟清理（给其他页面机会复用该缓存）
      if (removedSubscriber?.cacheKey) {
        const stillUsed = [...this._subscribers.values()].some(
          s => s.cacheKey === removedSubscriber.cacheKey
        );
        if (!stillUsed) {
          // 延迟 30 秒清理缓存 key，避免频繁切换页面时重复注册
          this._scheduleCacheCleanup(removedSubscriber.cacheKey);
        }
      }
      
      console.log('[GlobalProductWatcher] Page unsubscribed:', pageId);
    };
  }

  /**
   * 延迟清理缓存 key
   * @param {string} cacheKey - 缓存 key
   */
  _scheduleCacheCleanup(cacheKey) {
    // 如果已存在清理定时器，先清除
    if (this._cacheCleanupTimers?.[cacheKey]) {
      clearTimeout(this._cacheCleanupTimers[cacheKey]);
    }
    
    // 延迟 30 秒后清理
    this._cacheCleanupTimers = this._cacheCleanupTimers || {};
    this._cacheCleanupTimers[cacheKey] = setTimeout(() => {
      // 再次检查是否有订阅者使用该缓存 key
      const stillUsed = [...this._subscribers.values()].some(
        s => s.cacheKey === cacheKey
      );
      
      if (!stillUsed) {
        this._registeredCacheKeys.delete(cacheKey);
        this._cacheUpdated.delete(cacheKey);
        console.log('[GlobalProductWatcher] Cleanup unused cache:', cacheKey);
        
        // 监听器保持开启，用于持续更新缓存（即使没有注册的缓存 key）
        // 只有小程序销毁时才关闭连接（通过 destroy 方法）
        // 这样可以确保：
        // 1. 商品变化时始终能更新缓存
        // 2. 用户回到页面时缓存已经是最新的
        // 3. 配合版本号机制判断是否需要刷新
      }
      
      delete this._cacheCleanupTimers[cacheKey];
    }, 30000); // 30秒延迟
  }

  /**
   * 注册缓存 key 及其查询条件
   * @param {string} cacheKey - 缓存 key
   * @param {object} query - 查询条件
   */
  registerCacheKeyWithQuery(cacheKey, query) {
    if (cacheKey) {
      this._registeredCacheKeys.set(cacheKey, query);
      console.log('[GlobalProductWatcher] Register cache:', cacheKey, query);
    }
  }

  /**
   * 获取并清除缓存更新标记
   * @param {string} cacheKey - 缓存 key
   * @returns {object|null} 更新标记
   */
  getAndClearUpdateMark(cacheKey) {
    const mark = this._cacheUpdated.get(cacheKey);
    if (mark) {
      this._cacheUpdated.delete(cacheKey);
    }
    return mark;
  }

  /**
   * 设置页面可见性
   * @param {string} pageId
   * @param {boolean} visible
   */
  setPageVisible(pageId, visible) {
    this._pageVisible.set(pageId, visible);
    console.log('[GlobalProductWatcher] Page visibility:', pageId, visible);

    if (!visible) {
      // 检查是否没有任何可见页面
      this._checkAllHidden();
    }
  }

  /**
   * 检查是否所有页面都不可见
   */
  _checkAllHidden() {
    const hasVisiblePage = [...this._pageVisible.values()].some(v => v === true);
    if (!hasVisiblePage && this._registeredCacheKeys.size > 0) {
      console.log('[GlobalProductWatcher] 所有页面隐藏，后续变更只更新缓存');
    }
  }

  /**
   * 注册缓存 key（兼容旧接口，不带查询条件）
   */
  registerCacheKey(cacheKey) {
    if (cacheKey) {
      if (!this._registeredCacheKeys.has(cacheKey)) {
        this._registeredCacheKeys.set(cacheKey, null);
      }
    }
  }

  /**
   * 销毁（一般不需要，用于测试或特殊场景）
   */
  destroy() {
    this._closeWatch();
    this._subscribers.clear();
    this._pageVisible.clear();
    this._registeredCacheKeys.clear();
    this._cacheUpdated.clear();
    this._cacheCleanupTimers = {};
    this._isInit = false;
    instance = null;
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      isActive: this._isActive,
      subscriberCount: this._subscribers.size,
      visiblePages: [...this._pageVisible.entries()].filter(([, v]) => v).map(([k]) => k),
      registeredCacheKeys: [...this._registeredCacheKeys.keys()],
      cacheUpdatedKeys: [...this._cacheUpdated.keys()],
      reconnectAttempts: this._reconnectAttempts
    };
  }

  // ========== 内部方法 ==========

  _startWatch() {
    if (this._watchInstance) {
      console.warn('[GlobalProductWatcher] watch already started');
      return;
    }

    console.log('[GlobalProductWatcher] Starting products watch...');

    // 清除之前的健康检查定时器
    if (this._healthCheckTimer) {
      clearInterval(this._healthCheckTimer);
    }

    try {
      this._watchInstance = getDb().collection('products')
        .where({ isDeleted: false })
        .watch({
          onChange: (snapshot) => {
            this._handleChange(snapshot);
          },
          onError: (error) => {
            console.error('[GlobalProductWatcher] watch error:', error);
            this._handleError(error);
          }
        });

      this._isActive = true;
      this._reconnectAttempts = 0;
      this._lastMessageTime = Date.now();
      console.log('[GlobalProductWatcher] Watch started successfully');

      // 启动健康检查
      this._startHealthCheck();
    } catch (error) {
      console.error('[GlobalProductWatcher] Failed to start watch:', error);
      this._scheduleReconnect();
    }
  }

  _startHealthCheck() {
    // 健康检查已禁用
    // 原因：微信云数据库的 watch 是长连接，没有数据变化时长时间没消息是正常的
    // 真正的连接断开会被 _watchInstance.on 错误回调捕获并重连
    // 如果需要调试，可以临时注释掉下面的 return
    return;
  }

  _handleTimeout() {
    this._isActive = false;
    this._closeWatch();
    this._scheduleReconnect();
  }

  _handleChange(snapshot) {
    // 更新最后收到消息的时间（用于健康检查）
    this._lastMessageTime = Date.now();
    
    // 跳过初始化 init 事件 —— 此时所有 docChanges 都是 'add'，会干扰已有数据
    if (snapshot.type === 'init') {
      console.log('[GlobalProductWatcher] init event, skipping');
      return;
    }

    if (!snapshot.docChanges || snapshot.docChanges.length === 0) {
      return;
    }

    console.log('[GlobalProductWatcher] onChange:',
      snapshot.type,
      'docChanges:', snapshot.docChanges.length);

    const hasVisible = [...this._pageVisible.values()].some(v => v === true);
    console.log('[GlobalProductWatcher] hasVisible:', hasVisible);
    console.log('[GlobalProductWatcher] _pageVisible entries:', JSON.stringify([...this._pageVisible.entries()]));

    snapshot.docChanges.forEach(async (change) => {
      const product = change.doc || {};
      const changeType = change.dataType; // 'add' | 'modify' | 'remove'

      console.log('[GlobalProductWatcher] Change:', changeType, product._id);

      // 更新所有匹配的缓存
      this._updateRelevantCaches(product, changeType);

      // 更新首页缓存（包括补位逻辑）
      console.log('[GlobalProductWatcher] 更新首页缓存');
      await this._updateHomeCache({
        changeType: changeType,
        product,
        docId: product._id
      });

      if (hasVisible) {
        // 有可见页面，通知所有可见的订阅者更新UI
        console.log('[GlobalProductWatcher] 通知订阅者更新UI');
        this._notifySubscribers({
          changeType: changeType,
          product,
          docId: product._id
        });
      } else {
        console.log('[GlobalProductWatcher] 没有可见页面，跳过通知');
      }
    });
  }

  /**
   * 更新所有匹配的缓存
   * @param {object} product - 变更的商品
   * @param {string} changeType - 变更类型
   */
  _updateRelevantCaches(product, changeType) {
    // 获取所有已存在的缓存 key（包括未注册但存在的缓存）
    const allCacheKeys = productCacheStore.getAllKeys();
    console.log('[GlobalProductWatcher] _updateRelevantCaches - 找到', allCacheKeys.length, '个缓存 key:', allCacheKeys);
    
    allCacheKeys.forEach((cacheKey) => {
      const query = this._registeredCacheKeys.get(cacheKey); // 查询条件可能为 null
      const cache = productCacheStore.get(cacheKey);
      if (!cache) {
        console.log('[GlobalProductWatcher] 缓存不存在，跳过:', cacheKey);
        return; // 缓存不存在，跳过
      }

      // 判断商品是否匹配缓存的查询条件
      const matches = this._matchesQuery(product, query);
      const isInCache = cache.data.some(p => p._id === product._id);
      
      console.log('[GlobalProductWatcher] 处理缓存:', cacheKey, 
        '| matches:', matches, 
        '| isInCache:', isInCache, 
        '| changeType:', changeType,
        '| product.status:', product.status);

      // 兼容 'update' 和 'modify' 两种类型
      const isModify = changeType === 'modify' || changeType === 'update';
      
      if (changeType === 'remove') {
        // 删除操作
        if (isInCache) {
          console.log('[GlobalProductWatcher] Remove from cache:', cacheKey, product._id);
          productCacheStore.removeProduct(cacheKey, product._id);
          this._markCacheUpdated(cacheKey);
          // 价格排序缓存需要重新排序
          this._reorderPriceCacheIfNeeded(cacheKey);
        }
      } else if (isModify) {
        // 修改操作
        if (matches && isInCache) {
          // 商品匹配且在缓存中 → 更新
          console.log('[GlobalProductWatcher] Update in cache:', cacheKey, product._id);
          productCacheStore.updateProduct(cacheKey, product);
          this._markCacheUpdated(cacheKey);
          // 价格排序缓存需要重新排序
          this._reorderPriceCacheIfNeeded(cacheKey);
        } else if (matches && !isInCache) {
          // 商品匹配但不在缓存中（可能是被修改后符合条件）→ 插入
          console.log('[GlobalProductWatcher] Insert to cache:', cacheKey, product._id);
          productCacheStore.insertProduct(cacheKey, product);
          this._markCacheUpdated(cacheKey);
          // 价格排序缓存需要重新排序
          this._reorderPriceCacheIfNeeded(cacheKey);
        } else if (!matches && isInCache) {
          // 商品不匹配但在缓存中（可能是被修改后不符合条件）→ 删除
          console.log('[GlobalProductWatcher] Remove from cache:', cacheKey, product._id);
          productCacheStore.removeProduct(cacheKey, product._id);
          this._markCacheUpdated(cacheKey);
          // 价格排序缓存需要重新排序
          this._reorderPriceCacheIfNeeded(cacheKey);
        }
      } else if (changeType === 'add') {
        // 新增操作
        if (matches && !isInCache) {
          console.log('[GlobalProductWatcher] Insert to cache:', cacheKey, product._id);
          productCacheStore.insertProduct(cacheKey, product);
          this._markCacheUpdated(cacheKey);
          // 价格排序缓存需要重新排序
          this._reorderPriceCacheIfNeeded(cacheKey);
        }
      }
      
      // 调试：打印综合排序缓存的排序状态
      if (cacheKey === 'category_products') {
        const first5 = cache.data.slice(0, 5).map(p => ({ id: p._id, price: p.price }));
        console.log('[GlobalProductWatcher] 综合排序缓存当前数据（前5个）:', first5);
        // 检查是否按 _id 降序（综合排序的正确顺序）
        let isIdDesc = true;
        for (let i = 0; i < cache.data.length - 1; i++) {
          if (cache.data[i]._id < cache.data[i + 1]._id) {
            isIdDesc = false;
            break;
          }
        }
        console.log('[GlobalProductWatcher] 综合排序缓存是否按_id降序:', isIdDesc);
      }
    });
  }

  /**
   * 如果是价格排序缓存，则重新排序
   * @param {string} cacheKey - 缓存 key
   */
  _reorderPriceCacheIfNeeded(cacheKey) {
    if (!cacheKey.startsWith('category_products_price_')) {
      return; // 不是价格排序缓存，跳过
    }
    
    const order = cacheKey === 'category_products_price_asc' ? 'asc' : 'desc';
    const cache = productCacheStore.get(cacheKey);
    if (!cache || !cache.data) {
      return;
    }
    
    console.log('[GlobalProductWatcher] 重新排序价格缓存:', cacheKey, 'order:', order);
    const sorted = [...cache.data];
    sorted.sort((a, b) => {
      const diff = order === 'asc' ? a.price - b.price : b.price - a.price;
      return diff !== 0 ? diff : (a._id > b._id ? 1 : -1);
    });
    
    productCacheStore.set(cacheKey, {
      ...cache,
      data: sorted,
      timestamp: Date.now()
    });
  }

  /**
   * 判断商品是否匹配查询条件
   * @param {object} product - 商品
   * @param {object} query - 查询条件
   * @returns {boolean} 是否匹配
   */
  _matchesQuery(product, query) {
    if (!query) {
      // 没有查询条件，默认匹配（用于全部商品）
      return product.isDeleted !== true && product.status === 'on';
    }

    // 基础条件：未删除且上架
    if (product.isDeleted === true) {
      return false;
    }
    if (product.status !== 'on') {
      return false;
    }

    // 检查分类
    if (query.categoryId !== undefined) {
      if (product.categoryId !== query.categoryId) {
        return false;
      }
    }

    // 检查类型
    if (query.typeId !== undefined) {
      const typeIdQuery = query.typeId;
      const productTypeId = product.typeId;
      
      // 支持 _.in([...]) 形式
      if (typeIdQuery && typeIdQuery.$in) {
        if (!typeIdQuery.$in.includes(productTypeId)) {
          return false;
        }
      } else if (typeIdQuery !== productTypeId) {
        return false;
      }
    }

    // 检查库存筛选
    if (query.stock !== undefined) {
      const stockQuery = query.stock;
      if (stockQuery && stockQuery.$gt) {
        if (!(product.stock > stockQuery.$gt)) {
          return false;
        }
      } else if (stockQuery && stockQuery.$lte) {
        if (!(product.stock <= stockQuery.$lte)) {
          return false;
        }
      }
    }

    // 检查关键字（一般搜索时不使用缓存，这里作为防御性检查）
    if (query.name) {
      const nameQuery = query.name;
      if (nameQuery && nameQuery.$regex) {
        const keyword = nameQuery.$regex;
        if (!(product.name || '').toLowerCase().includes(keyword.toLowerCase())) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * 标记缓存已更新
   * @param {string} cacheKey - 缓存 key
   */
  _markCacheUpdated(cacheKey) {
    let mark = this._cacheUpdated.get(cacheKey);
    if (!mark) {
      mark = {
        updateVersion: [],
        timestamp: Date.now()
      };
    }
    mark.updateVersion.push(Date.now());
    mark.timestamp = Date.now();
    this._cacheUpdated.set(cacheKey, mark);
  }

  _notifySubscribers(change) {
    console.log('[GlobalProductWatcher] _notifySubscribers - 订阅者数量:', this._subscribers.size);
    console.log('[GlobalProductWatcher] _notifySubscribers - 订阅者列表:', JSON.stringify([...this._subscribers.entries()]));
    
    // 通知可见页面
    this._subscribers.forEach(({ handler, cacheKey }, pageId) => {
      const isVisible = this._pageVisible.get(pageId) !== false;
      console.log('[GlobalProductWatcher] 检查订阅者:', pageId, 'isVisible:', isVisible, 'cacheKey:', cacheKey);
      
      if (!isVisible) {
        console.log('[GlobalProductWatcher] 跳过不可见页面:', pageId);
        return; // 跳过不可见的页面
      }

      try {
        console.log('[GlobalProductWatcher] 调用订阅者 handler:', pageId);
        // 统一参数格式：同时传递 type 和 changeType 保持向后兼容
        handler({
          ...change,
          type: change.changeType,  // 统一使用 type 作为主要字段
          cacheKey
        });
      } catch (error) {
        console.error('[GlobalProductWatcher] Handler error for', pageId, error);
      }
    });
  }

  /**
   * 更新首页缓存（带异常处理和回滚机制）
   */
  async _updateHomeCache(change, retryCount = 0) {
    const maxRetries = 2;
    
    console.log('[GlobalProductWatcher] ========== 开始更新首页缓存 ==========');
    console.log('[GlobalProductWatcher] 变化类型:', change.changeType);
    console.log('[GlobalProductWatcher] 商品ID:', change.docId);
    console.log('[GlobalProductWatcher] 重试次数:', retryCount);
    
    try {
      // 获取当前服务器版本号
      console.log('[GlobalProductWatcher] --- 步骤1: 获取服务器版本号 ---');
      let serverVersion = '0';
      try {
        console.log('[GlobalProductWatcher] 准备调用云函数: getProductVersion');
        console.log('[GlobalProductWatcher] 当前云环境:', getApp().globalData.env);
        
        const startTime = Date.now();
        const versionRes = await wx.cloud.callFunction({
          name: 'getProductVersion',
          data: {}
        });
        const endTime = Date.now();
        
        console.log('[GlobalProductWatcher] 云函数调用耗时:', endTime - startTime, 'ms');
        console.log('[GlobalProductWatcher] 云函数返回结果:', JSON.stringify(versionRes, null, 2));
        
        if (versionRes.result && versionRes.result.success) {
          serverVersion = versionRes.result.version;
          console.log('[GlobalProductWatcher] 成功获取服务器版本号:', serverVersion);
        } else {
          console.warn('[GlobalProductWatcher] 服务器返回格式异常:', versionRes);
        }
      } catch (e) {
        console.error('[GlobalProductWatcher] ========== 云函数调用错误详情 ==========');
        console.error('[GlobalProductWatcher] 错误对象:', e);
        console.error('[GlobalProductWatcher] 错误码:', e.errCode);
        console.error('[GlobalProductWatcher] 错误信息:', e.errMsg);
        
        // 版本号获取失败，使用缓存中的版本号或时间戳
        const homeData = wx.getStorageSync('homeData') || {};
        serverVersion = homeData.watcherVersion || Date.now().toString();
        console.log('[GlobalProductWatcher] 使用降级版本号:', serverVersion);
        
        console.log('[GlobalProductWatcher] ========== 云函数调用错误结束 ==========');
      }

      // 获取当前首页缓存
      console.log('[GlobalProductWatcher] --- 步骤2: 获取当前缓存 ---');
      const homeData = wx.getStorageSync('homeData') || {};
      console.log('[GlobalProductWatcher] 缓存存在:', !!homeData);
      console.log('[GlobalProductWatcher] 缓存系列列表长度:', homeData.seriesList ? homeData.seriesList.length : 0);
      
      // 检查是否需要更新首页缓存（必须有有效的系列列表）
      if (!homeData.seriesList || homeData.seriesList.length === 0) {
        console.log('[GlobalProductWatcher] 首页缓存为空，跳过更新');
        console.log('[GlobalProductWatcher] ========== 更新结束（跳过）==========');
        return;
      }

      // 保存备份（用于回滚）
      console.log('[GlobalProductWatcher] --- 步骤3: 创建备份 ---');
      const backupData = JSON.parse(JSON.stringify(homeData));
      console.log('[GlobalProductWatcher] 备份创建成功，系列列表长度:', backupData.seriesList.length);
      
      // 根据变化类型更新缓存
      console.log('[GlobalProductWatcher] --- 步骤4: 计算更新数据 ---');
      const { docId, product, changeType } = change;
      let updatedSeriesList = [...homeData.seriesList];
      let updatedNewProducts = homeData.newProducts ? [...homeData.newProducts] : [];

      // 兼容 'update' 和 'modify' 两种类型
      const isModify = changeType === 'modify' || changeType === 'update';

      if (changeType === 'remove') {
        console.log('[GlobalProductWatcher] 处理删除操作');
        updatedNewProducts = updatedNewProducts.filter(p => p._id !== docId);
        
        // 移除商品后，需要补位
        const removedSeriesIds = [];
        updatedSeriesList = updatedSeriesList.map(series => {
          const newProducts = series.products.filter(p => p._id !== docId);
          if (newProducts.length !== series.products.length && series.products.length > 0) {
            removedSeriesIds.push(series.id);
          }
          return {
            ...series,
            products: newProducts
          };
        });
        
        // 对受影响的系列进行补位
        if (removedSeriesIds.length > 0) {
          console.log('[GlobalProductWatcher] 需要补位的系列:', removedSeriesIds);
          for (const seriesId of removedSeriesIds) {
            await this._fillSeriesProducts(updatedSeriesList, seriesId);
          }
        }
      } else if (isModify) {
        console.log('[GlobalProductWatcher] 处理修改操作');
        const shouldRemove = product.status !== 'on' || product.isDeleted === true;
        
        if (shouldRemove) {
          console.log('[GlobalProductWatcher] 商品下架或删除，从列表中移除');
          updatedNewProducts = updatedNewProducts.filter(p => p._id !== docId);
          
          // 移除商品后，需要补位
          const removedSeriesIds = [];
          updatedSeriesList = updatedSeriesList.map(series => {
            const newProducts = series.products.filter(p => p._id !== docId);
            if (newProducts.length !== series.products.length && series.products.length > 0) {
              removedSeriesIds.push(series.id);
            }
            return {
              ...series,
              products: newProducts
            };
          });
          
          // 对受影响的系列进行补位
          if (removedSeriesIds.length > 0) {
            console.log('[GlobalProductWatcher] 需要补位的系列:', removedSeriesIds);
            for (const seriesId of removedSeriesIds) {
              await this._fillSeriesProducts(updatedSeriesList, seriesId);
            }
          }
        } else {
          console.log('[GlobalProductWatcher] 更新商品信息');
          
          // 查找商品在系列中的旧分类ID
          let oldCategoryId = null;
          for (const series of updatedSeriesList) {
            const existingProduct = series.products.find(p => p._id === docId);
            if (existingProduct) {
              oldCategoryId = series.id;
              break;
            }
          }
          
          // 检查是否是从下架变为上架（需要添加到列表）
          const wasOffline = updatedNewProducts.find(p => p._id === docId)?.isOffline !== false ||
                            !updatedNewProducts.some(p => p._id === docId);
          const isNowOnline = product.status === 'on';
          
          // 检查分类是否变化
          const categoryChanged = oldCategoryId !== null && oldCategoryId !== product.categoryId;
          
          if (categoryChanged) {
            console.log('[GlobalProductWatcher] 商品分类变化，从', oldCategoryId, '变为', product.categoryId);
            
            // 从旧系列中移除
            updatedSeriesList = updatedSeriesList.map(series => {
              if (series.id === oldCategoryId) {
                return {
                  ...series,
                  products: series.products.filter(p => p._id !== docId)
                };
              }
              return series;
            });
            
            // 记录需要补位的系列
            removedSeriesIds.add(oldCategoryId);
            
            // 如果新分类上架，添加到新系列
            if (product.status === 'on') {
              updatedSeriesList = updatedSeriesList.map(series => {
                if (series.id === product.categoryId) {
                  const exists = series.products.some(p => p._id === docId);
                  if (!exists) {
                    return {
                      ...series,
                      products: [
                        {
                          ...product,
                          isOutOfStock: product.stock <= 0 && product.status === 'on',
                          isOffline: product.status !== 'on'
                        },
                        ...series.products
                      ].slice(0, 3)
                    };
                  }
                }
                return series;
              });
            }
          } else if (wasOffline && isNowOnline) {
            console.log('[GlobalProductWatcher] 商品上架，添加到列表');
            if (product.isNew === true) {
              updatedNewProducts.unshift({
                ...product,
                isOutOfStock: product.stock <= 0 && product.status === 'on',
                isOffline: product.status !== 'on'
              });
            }
            
            updatedSeriesList = updatedSeriesList.map(series => {
              if (product.categoryId === series.id && product.status === 'on') {
                const exists = series.products.some(p => p._id === docId);
                if (!exists) {
                  return {
                    ...series,
                    products: [
                      {
                        ...product,
                        isOutOfStock: product.stock <= 0 && product.status === 'on',
                        isOffline: product.status !== 'on'
                      },
                      ...series.products
                    ].slice(0, 3)
                  };
                }
              }
              return series;
            });
          } else {
            // 检查 isNew 字段变化
            const wasNew = updatedNewProducts.some(p => p._id === docId);
            const isNowNew = product.isNew === true;
            
            if (isNowNew && !wasNew) {
              console.log('[GlobalProductWatcher] isNew 变为 true，添加到新品推荐');
              updatedNewProducts.unshift({
                ...product,
                isOutOfStock: product.stock <= 0 && product.status === 'on',
                isOffline: product.status !== 'on'
              });
            } else if (!isNowNew && wasNew) {
              console.log('[GlobalProductWatcher] isNew 变为 false，从新品推荐移除');
              updatedNewProducts = updatedNewProducts.filter(p => p._id !== docId);
            } else if (wasNew) {
              const productIndex = updatedNewProducts.findIndex(p => p._id === docId);
              if (productIndex !== -1) {
                updatedNewProducts[productIndex] = {
                  ...product,
                  isOutOfStock: product.stock <= 0 && product.status === 'on',
                  isOffline: product.status !== 'on'
                };
              }
            }
            
            updatedSeriesList = updatedSeriesList.map(series => ({
              ...series,
              products: series.products.map(p => 
                p._id === docId ? {
                  ...product,
                  isOutOfStock: product.stock <= 0 && product.status === 'on',
                  isOffline: product.status !== 'on'
                } : p
              )
            }));
          }
          
          // 无论哪种修改情况，都需要更新系列中已存在商品的状态
          // 确保库存变化、isOutOfStock 等字段正确更新
          updatedSeriesList = updatedSeriesList.map(series => ({
            ...series,
            products: series.products.map(p => 
              p._id === docId ? {
                ...product,
                isOutOfStock: product.stock <= 0 && product.status === 'on',
                isOffline: product.status !== 'on'
              } : p
            )
          }));
        }
      } else if (changeType === 'add') {
        console.log('[GlobalProductWatcher] 处理添加操作');
        if (product.isNew === true && product.status === 'on') {
          updatedNewProducts.unshift({
            ...product,
            isOutOfStock: product.stock <= 0 && product.status === 'on',
            isOffline: product.status !== 'on'
          });
        }
        
        // 如果商品属于某个系列，添加到对应系列
        updatedSeriesList = updatedSeriesList.map(series => {
          if (product.categoryId === series.id && product.status === 'on') {
            const exists = series.products.some(p => p._id === docId);
            if (!exists) {
              return {
                ...series,
                products: [
                  {
                    ...product,
                    isOutOfStock: product.stock <= 0 && product.status === 'on',
                    isOffline: product.status !== 'on'
                  },
                  ...series.products
                ].slice(0, 3)
              };
            }
          }
          return series;
        });
      }

      console.log('[GlobalProductWatcher] 更新后系列列表长度:', updatedSeriesList.length);
      console.log('[GlobalProductWatcher] 更新后新品列表长度:', updatedNewProducts.length);

      // 尝试写入缓存
      console.log('[GlobalProductWatcher] --- 步骤5: 写入缓存 ---');
      try {
        const currentUpdateVersion = homeData.updateVersion || 0;
        wx.setStorageSync('homeData', {
          ...homeData,
          seriesList: updatedSeriesList,
          newProducts: updatedNewProducts,
          updateVersion: currentUpdateVersion + 1,
          watcherVersion: serverVersion,
          lastWatcherUpdate: Date.now(),
          cacheStatus: 'healthy'
        });
        
        console.log('[GlobalProductWatcher] 缓存写入成功');
        console.log('[GlobalProductWatcher] 缓存版本:', serverVersion);
        console.log('[GlobalProductWatcher] 缓存状态: healthy');
        console.log('[GlobalProductWatcher] ========== 更新成功 ==========');
      } catch (writeError) {
        console.error('[GlobalProductWatcher] 写入缓存失败:', writeError);
        
        // 重试机制
        if (retryCount < maxRetries) {
          console.log(`[GlobalProductWatcher] --- 步骤6: 第 ${retryCount + 1} 次重试 ---`);
          console.log('[GlobalProductWatcher] 等待', 100 * (retryCount + 1), 'ms后重试');
          await new Promise(resolve => setTimeout(resolve, 100 * (retryCount + 1)));
          console.log('[GlobalProductWatcher] 开始重试...');
          return this._updateHomeCache(change, retryCount + 1);
        }
        
        // 重试失败，回滚到备份
        console.log('[GlobalProductWatcher] --- 步骤7: 重试失败，执行回滚 ---');
        try {
          wx.setStorageSync('homeData', {
            ...backupData,
            cacheStatus: 'corrupted'
          });
          console.log('[GlobalProductWatcher] 回滚成功');
          console.log('[GlobalProductWatcher] 缓存状态: corrupted');
          console.log('[GlobalProductWatcher] ========== 更新失败（已回滚）==========');
        } catch (rollbackError) {
          console.error('[GlobalProductWatcher] 回滚失败:', rollbackError);
          console.log('[GlobalProductWatcher] ========== 更新失败（回滚也失败）==========');
        }
      }
    } catch (error) {
      console.error('[GlobalProductWatcher] 更新首页缓存失败:', error);
      
      // 标记缓存状态为警告
      console.log('[GlobalProductWatcher] --- 标记缓存状态为警告 ---');
      const homeData = wx.getStorageSync('homeData') || {};
      if (homeData.seriesList && homeData.seriesList.length > 0) {
        try {
          wx.setStorageSync('homeData', {
            ...homeData,
            cacheStatus: 'warning'
          });
          console.log('[GlobalProductWatcher] 缓存状态已标记为: warning');
        } catch (e) {
          console.error('[GlobalProductWatcher] 更新缓存状态失败:', e);
        }
      }
      
      console.log('[GlobalProductWatcher] ========== 更新失败（异常）==========');
    }
  }

  _handleError(error) {
    const errMsg = (error && (error.message || error.errMsg || '')) || '';
    const isTimeout = errMsg.includes('timedout');
    const isLoginFail = errMsg.includes('login fail') || errMsg.includes('invalid state');

    this._isActive = false;
    this._closeWatch();

    // 标记所有缓存需要校验
    this._registeredCacheKeys.forEach((_, key) => {
      productCacheStore.markNeedVerify(key);
    });

    // wsclient 超时是临时网络问题，额外容忍
    if (isTimeout && this._reconnectAttempts >= this._maxReconnectAttempts) {
      console.log('[GlobalProductWatcher] 超时错误，重置重试计数');
      this._reconnectAttempts = 0;
    }

    // 登录失败时，先尝试重新登录
    if (isLoginFail) {
      console.log('[GlobalProductWatcher] 登录失败，尝试重新登录');
      this._retryWithLogin();
    } else {
      this._scheduleReconnect();
    }
  }

  /**
   * 尝试重新登录后再连接
   */
  _retryWithLogin() {
    wx.cloud.callFunction({
      name: 'login',
      success: () => {
        console.log('[GlobalProductWatcher] 重新登录成功');
        // 登录成功后重新连接
        this._reconnectAttempts = 0; // 重置重试计数
        this._startWatch();
      },
      fail: (err) => {
        console.error('[GlobalProductWatcher] 重新登录失败:', err);
        // 登录失败，延迟后重试
        this._scheduleReconnect();
      }
    });
  }

  _scheduleReconnect() {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      console.error('[GlobalProductWatcher] Max reconnect attempts reached');
      return;
    }

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
    }

    // 指数退避 + 抖动，至少 3s 起步
    const delay = Math.min(
      Math.max(3000, Math.pow(2, this._reconnectAttempts) * 1000) + Math.random() * 2000,
      60000
    );

    console.log(`[GlobalProductWatcher] Reconnecting in ${Math.round(delay)}ms (attempt ${this._reconnectAttempts + 1}/${this._maxReconnectAttempts})`);

    this._reconnectTimer = setTimeout(() => {
      this._reconnectAttempts++;
      this._reconnectTimer = null;
      this._startWatch();
    }, delay);
  }

  _closeWatch() {
    if (this._watchInstance) {
      try {
        this._watchInstance.close();
      } catch (e) {
        // ignore
      }
      this._watchInstance = null;
    }

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    // 清理所有缓存清理定时器
    Object.values(this._cacheCleanupTimers || {}).forEach(timer => {
      clearTimeout(timer);
    });
    this._cacheCleanupTimers = {};
  }

  _hasVisiblePage() {
    return [...this._pageVisible.values()].some(v => v === true);
  }

  /**
   * 补齐系列商品到3个
   * @param {Array} seriesList - 系列列表
   * @param {string} categoryId - 需要补齐的分类ID
   */
  async _fillSeriesProducts(seriesList, categoryId) {
    console.log('[GlobalProductWatcher] _fillSeriesProducts - 开始补位');
    console.log('[GlobalProductWatcher] categoryId:', categoryId);
    
    // 使用 series.id 与首页保持一致
    const series = seriesList.find(s => s.id === categoryId);
    if (!series || series.products.length >= 3) {
      console.log('[GlobalProductWatcher] _fillSeriesProducts - 无需补位');
      return;
    }
    
    try {
      const db = getDb();
      const cmd = getCmd();
      const existingIds = series.products.map(p => p._id);
      
      const res = await db.collection('products')
        .where({
          categoryId: categoryId,
          status: 'on',
          _id: cmd.not(cmd.in(existingIds))
        })
        .orderBy('createTime', 'desc')
        .limit(3 - series.products.length)
        .get();
      
      const newProducts = res.data || [];
      console.log('[GlobalProductWatcher] _fillSeriesProducts - 获取到', newProducts.length, '个商品');
      
      if (newProducts.length > 0) {
        newProducts.forEach(product => {
          series.products.push({
            ...product,
            isOutOfStock: product.stock <= 0 && product.status === 'on',
            isOffline: product.status !== 'on'
          });
        });
        console.log('[GlobalProductWatcher] _fillSeriesProducts - 补位完成，当前商品数:', series.products.length);
      }
    } catch (error) {
      console.error('[GlobalProductWatcher] _fillSeriesProducts - 补位失败:', error);
    }
  }
}

/**
 * 获取全局单例
 * @returns {GlobalProductWatcher}
 */
function getGlobalProductWatcher() {
  if (!instance) {
    instance = new GlobalProductWatcher();
  }
  return instance;
}

export { GlobalProductWatcher, getGlobalProductWatcher };
