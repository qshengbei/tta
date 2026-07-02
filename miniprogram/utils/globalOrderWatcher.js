/**
 * GlobalOrderWatcher - 全局订单监听器
 *
 * 全局单例，维护唯一的 orders 集合 watch 连接。
 * 所有订单列表页面通过 subscribe() 订阅变更事件。
 *
 * 变更分发策略 (G+方案):
 * - 有可见页面 → 更新缓存 + 通知页面更新UI
 * - 无可见页面 → 更新缓存 + 标记缓存已更新
 *
 * 使用方式:
 *   const watcher = getGlobalOrderWatcher();
 *   const unsub = watcher.subscribe('page_xxx', 'cache_key', (change) => { ... });
 *   watcher.setPageVisible('page_xxx', true/false);
 *   unsub(); // 页面卸载时取消订阅
 */

import orderCacheStore from './orderCacheStore';

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

class GlobalOrderWatcher {
  constructor() {
    this._subscribers = new Map();
    this._pageVisible = new Map();
    this._watchInstance = null;
    this._isActive = false;
    this._isInit = false;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 10;
    this._reconnectTimer = null;
    this._registeredCacheKeys = new Map();
    this._cacheUpdated = new Map();
    this._cacheCleanupTimers = {};
    this._lastMessageTime = 0;
    this._lastHeartbeat = 0;
    this._healthCheckTimer = null;
    this._healthCheckInterval = 30000;
    this._healthyThreshold = 120000;
    this._healthListeners = [];
    this._recentChanges = new Map();
    this._recentChangesCleanupTimer = null;
  }

  getHealthStatus(healthyThreshold = 30000) {
    const now = Date.now();
    const timeSinceLastMessage = now - this._lastMessageTime;
    const isHealthy = this._isActive && timeSinceLastMessage < healthyThreshold;
    
    return {
      isHealthy,
      isActive: this._isActive,
      subscriberCount: this._subscribers ? this._subscribers.size : 0,
      visiblePages: this._pageVisible ? [...this._pageVisible.keys()] : [],
      registeredCacheKeys: this._registeredCacheKeys ? [...this._registeredCacheKeys.keys()] : [],
      lastMessageTime: this._lastMessageTime,
      timeSinceLastMessage,
      reconnectAttempts: this._reconnectAttempts,
      healthyThreshold
    };
  }

  addHealthListener(listener) {
    this._healthListeners.push(listener);
    return () => {
      const index = this._healthListeners.indexOf(listener);
      if (index > -1) {
        this._healthListeners.splice(index, 1);
      }
    };
  }

  checkNeedsRefresh() {
    if (!this._isActive) {
      return {
        needsRefresh: true,
        reason: '监听器未激活，可能已断开'
      };
    }
    
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

  init() {
    if (this._isActive || this._isInit) {
      return;
    }
    this._isInit = true;
    this._startWatch();
  }

  subscribe(pageId, cacheKey, handler) {
    if (cacheKey) {
      if (!this._registeredCacheKeys.has(cacheKey)) {
        this._registeredCacheKeys.set(cacheKey, null);
      }
    }

    this._subscribers.set(pageId, { handler, cacheKey: cacheKey || '' });
    this._pageVisible.set(pageId, true);

    if (!this._isActive || !this._watchInstance) {
      if (this._watchInstance) {
        this._closeWatch();
      }
      this._startWatch();
    }

    return () => {
      const removedSubscriber = this._subscribers.get(pageId);
      this._subscribers.delete(pageId);
      this._pageVisible.delete(pageId);
      
      if (removedSubscriber?.cacheKey) {
        const stillUsed = [...this._subscribers.values()].some(
          s => s.cacheKey === removedSubscriber.cacheKey
        );
        if (!stillUsed) {
          this._scheduleCacheCleanup(removedSubscriber.cacheKey);
        }
      }
      
      console.log('[GlobalOrderWatcher] Page unsubscribed:', pageId);
    };
  }

  _scheduleCacheCleanup(cacheKey) {
    if (this._cacheCleanupTimers?.[cacheKey]) {
      clearTimeout(this._cacheCleanupTimers[cacheKey]);
    }
    
    this._cacheCleanupTimers = this._cacheCleanupTimers || {};
    this._cacheCleanupTimers[cacheKey] = setTimeout(() => {
      const stillUsed = [...this._subscribers.values()].some(
        s => s.cacheKey === cacheKey
      );
      
      if (!stillUsed) {
        this._registeredCacheKeys.delete(cacheKey);
        this._cacheUpdated.delete(cacheKey);
        console.log('[GlobalOrderWatcher] Cleanup unused cache:', cacheKey);
      }
      
      delete this._cacheCleanupTimers[cacheKey];
    }, 30000);
  }

  registerCacheKeyWithQuery(cacheKey, query) {
    if (cacheKey) {
      this._registeredCacheKeys.set(cacheKey, query);
      console.log('[GlobalOrderWatcher] Register cache:', cacheKey, query);
    }
  }

  getAndClearUpdateMark(cacheKey) {
    const mark = this._cacheUpdated.get(cacheKey);
    if (mark) {
      this._cacheUpdated.delete(cacheKey);
    }
    return mark;
  }

  setPageVisible(pageId, visible) {
    this._pageVisible.set(pageId, visible);
    console.log('[GlobalOrderWatcher] Page visibility:', pageId, visible);

    if (!visible) {
      this._checkAllHidden();
    }
  }

  _checkAllHidden() {
    const hasVisiblePage = [...this._pageVisible.values()].some(v => v === true);
    if (!hasVisiblePage && this._registeredCacheKeys.size > 0) {
      console.log('[GlobalOrderWatcher] 所有页面隐藏，后续变更只更新缓存');
    }
  }

  registerCacheKey(cacheKey) {
    if (cacheKey) {
      if (!this._registeredCacheKeys.has(cacheKey)) {
        this._registeredCacheKeys.set(cacheKey, null);
      }
    }
  }

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

  getStatus() {
    const subscribers = this._subscribers || new Map();
    const pageVisible = this._pageVisible || new Map();
    const registeredCacheKeys = this._registeredCacheKeys || new Map();
    const cacheUpdated = this._cacheUpdated || new Map();
    
    return {
      isActive: this._isActive,
      subscriberCount: subscribers.size,
      visiblePages: [...pageVisible.entries()].filter(([, v]) => v).map(([k]) => k),
      registeredCacheKeys: [...registeredCacheKeys.keys()],
      cacheUpdatedKeys: [...cacheUpdated.keys()],
      reconnectAttempts: this._reconnectAttempts,
      isWatchInstance: !!this._watchInstance,
      lastMessageTime: this._lastMessageTime
    };
  }

  _startWatch() {
    if (this._watchInstance) {
      return;
    }

    if (this._healthCheckTimer) {
      clearInterval(this._healthCheckTimer);
    }

    try {
      this._watchInstance = getDb().collection('orders')
        .watch({
          onChange: (snapshot) => {
            this._handleChange(snapshot);
          },
          onError: (error) => {
            console.error('[GlobalOrderWatcher] watch error:', error);
            this._handleError(error);
          }
        });

      this._isActive = true;
      this._reconnectAttempts = 0;
      this._lastMessageTime = Date.now();
      console.log('[GlobalOrderWatcher] Watch started successfully, _isActive:', this._isActive);

      this._startHealthCheck();
    } catch (error) {
      console.error('[GlobalOrderWatcher] Failed to start watch:', error);
      this._scheduleReconnect();
    }
  }

  _startHealthCheck() {
    if (this._healthCheckTimer) {
      clearInterval(this._healthCheckTimer);
    }
  }

  _handleChange(snapshot) {
    this._lastMessageTime = Date.now();
    
    if (snapshot.type === 'init') {
      return;
    }

    if (!snapshot.docChanges || snapshot.docChanges.length === 0) {
      return;
    }

    const hasVisible = [...this._pageVisible.values()].some(v => v === true);

    snapshot.docChanges.forEach((change) => {
      const order = change.doc || {};
      const changeType = change.dataType;

      if (this._isDuplicateChange(order._id, changeType, order.updatedAtTs)) {
        return;
      }
      this._recordChange(order._id, changeType, order.updatedAtTs);

      if (order.isDeleted === true) {
        this._removeOrderFromAllCaches(order);
        
        if (hasVisible) {
          this._notifySubscribers({
            changeType: 'remove',
            order,
            docId: order._id
          });
        } else {
          this._registeredCacheKeys.forEach((_, cacheKey) => {
            this._markCacheUpdated(cacheKey);
          });
        }
        return;
      }

      this._updateAllCaches(order, changeType);

      if (hasVisible) {
        this._notifySubscribers({
          changeType: changeType,
          order,
          docId: order._id
        });
      } else {
        this._registeredCacheKeys.forEach((_, cacheKey) => {
          this._markCacheUpdated(cacheKey);
        });
      }
    });
  }

  _isDuplicateChange(orderId, changeType, updatedAtTs) {
    if (!orderId) return false;
    const key = `${orderId}_${changeType}`;
    const lastChange = this._recentChanges.get(key);
    if (lastChange) {
      const timeDiff = Date.now() - lastChange.timestamp;
      if (timeDiff < 3000) {
        if (updatedAtTs && lastChange.updatedAtTs === updatedAtTs) {
          return true;
        }
        if (timeDiff < 500) {
          return true;
        }
      }
    }
    return false;
  }

  _recordChange(orderId, changeType, updatedAtTs) {
    if (!orderId) return;
    const key = `${orderId}_${changeType}`;
    this._recentChanges.set(key, {
      timestamp: Date.now(),
      updatedAtTs: updatedAtTs || 0
    });
    
    if (!this._recentChangesCleanupTimer) {
      this._recentChangesCleanupTimer = setTimeout(() => {
        const now = Date.now();
        this._recentChanges.forEach((value, key) => {
          if (now - value.timestamp > 5000) {
            this._recentChanges.delete(key);
          }
        });
        this._recentChangesCleanupTimer = null;
      }, 5000);
    }
  }

  _updateAllCaches(order, changeType) {
    const openid = order._openid;
    if (!openid) {
      console.warn('[GlobalOrderWatcher] _updateAllCaches: order._openid is empty');
      return;
    }

    const relevantTags = this._getRelevantStatusTags(order, changeType);
    const cacheKeys = relevantTags.map(tag => `order_cache_${openid}_${tag}`);

    console.log(`[GlobalOrderWatcher] _updateAllCaches - openid: ${openid}, changeType: ${changeType}, relevantTags:`, relevantTags);

    if (changeType === 'add') {
      cacheKeys.forEach(cacheKey => {
        try {
          const statusTag = this._getStatusTagFromCacheKey(cacheKey);
          const existingEntry = orderCacheStore.get(cacheKey);
          
          console.log(`[GlobalOrderWatcher] 检查缓存: ${cacheKey}, 存在: ${!!existingEntry}`);
          
          if (!existingEntry) {
            return;
          }
          
          if (this._orderMatchesStatusTag(order, statusTag)) {
            orderCacheStore.insertOrder(cacheKey, order);
            console.log('[GlobalOrderWatcher] 缓存新增订单:', cacheKey, order._id);
          }
          orderCacheStore.markStale(cacheKey);
        } catch (e) {
          console.warn('[GlobalOrderWatcher] 更新缓存失败:', cacheKey, e);
        }
      });
    } else if (changeType === 'modify' || changeType === 'update') {
      cacheKeys.forEach(cacheKey => {
        try {
          const statusTag = this._getStatusTagFromCacheKey(cacheKey);
          const matchesNow = this._orderMatchesStatusTag(order, statusTag);
          
          const existingEntry = orderCacheStore.get(cacheKey);
          
          console.log(`[GlobalOrderWatcher] 检查缓存: ${cacheKey}, 存在: ${!!existingEntry}, matchesNow: ${matchesNow}`);
          
          if (!existingEntry) {
            return;
          }
          
          const existedBefore = existingEntry.data.some(o => o._id === order._id);
          
          console.log(`[GlobalOrderWatcher] existedBefore: ${existedBefore}, matchesNow: ${matchesNow}`);
          
          if (matchesNow && existedBefore) {
            orderCacheStore.updateOrder(cacheKey, order);
            console.log('[GlobalOrderWatcher] 缓存更新订单:', cacheKey, order._id);
          } else if (matchesNow && !existedBefore) {
            orderCacheStore.insertOrder(cacheKey, order);
            console.log('[GlobalOrderWatcher] 缓存插入订单（状态变更进入）:', cacheKey, order._id);
          } else if (!matchesNow && existedBefore) {
            orderCacheStore.removeOrder(cacheKey, order._id);
            console.log('[GlobalOrderWatcher] 缓存移除订单（状态变更离开）:', cacheKey, order._id);
          }
          
          orderCacheStore.markStale(cacheKey);
        } catch (e) {
          console.warn('[GlobalOrderWatcher] 更新缓存失败:', cacheKey, e);
        }
      });
    } else if (changeType === 'remove') {
      cacheKeys.forEach(cacheKey => {
        try {
          const existingEntry = orderCacheStore.get(cacheKey);
          console.log(`[GlobalOrderWatcher] 检查缓存: ${cacheKey}, 存在: ${!!existingEntry}`);
          
          if (!existingEntry) {
            return;
          }
          
          orderCacheStore.removeOrder(cacheKey, order._id);
          console.log('[GlobalOrderWatcher] 缓存删除订单:', cacheKey, order._id);
          orderCacheStore.markStale(cacheKey);
        } catch (e) {
          console.warn('[GlobalOrderWatcher] 更新缓存失败:', cacheKey, e);
        }
      });
    }
  }

  _removeOrderFromAllCaches(order) {
    const orderId = order._id;
    const openid = order._openid;

    this._registeredCacheKeys.forEach((_, cacheKey) => {
      try {
        if (cacheKey.includes(openid)) {
          const existingEntry = orderCacheStore.get(cacheKey);
          if (existingEntry && existingEntry.data.some(o => o._id === orderId)) {
            orderCacheStore.removeOrder(cacheKey, orderId);
            orderCacheStore.markStale(cacheKey);
          }
        }
      } catch (e) {
        console.warn('[GlobalOrderWatcher] 移除订单失败:', cacheKey, e);
      }
    });
  }

  _getRelevantStatusTags(order, changeType) {
    const tags = ['all'];
    
    if (changeType === 'add') {
      const currentTag = this._getStatusTagForOrder(order);
      if (currentTag) tags.push(currentTag);
    } else if (changeType === 'modify' || changeType === 'update') {
      const currentTag = this._getStatusTagForOrder(order);
      if (currentTag) tags.push(currentTag);
      
      const registeredTags = [...this._registeredCacheKeys.keys()]
        .map(key => this._getStatusTagFromCacheKey(key))
        .filter(tag => tag !== 'all' && tag !== currentTag);
      tags.push(...registeredTags);
    } else if (changeType === 'remove') {
      const currentTag = this._getStatusTagForOrder(order);
      if (currentTag) tags.push(currentTag);
    }
    
    return [...new Set(tags)];
  }

  _getStatusTagForOrder(order) {
    if (!order || !order.status) return null;
    
    const status = order.status;
    
    if (status === 'pending') return 'pending';
    if (status === 'paid') return 'paid';
    if (['shipping', 'delivered'].includes(status)) return 'shipping';
    if (['refund', 'refund_completed'].includes(status)) return 'refund';
    if (['completed', 'refund_completed'].includes(status)) return 'completed';
    if (status === 'cancelled') return 'cancelled';
    
    return null;
  }

  _getStatusTagFromCacheKey(cacheKey) {
    const parts = cacheKey.split('_');
    if (parts.length >= 4) {
      return parts[parts.length - 1];
    }
    return 'all';
  }

  _orderMatchesStatusTag(order, statusTag) {
    if (!order || !order.status) return false;
    
    const status = order.status;
    
    if (statusTag === 'all') return true;
    if (statusTag === 'pending' && status === 'pending') return true;
    if (statusTag === 'paid' && status === 'paid') return true;
    if (statusTag === 'shipping' && ['shipping', 'delivered'].includes(status)) return true;
    if (statusTag === 'refund' && ['refund', 'refund_completed'].includes(status)) return true;
    if (statusTag === 'completed' && ['completed', 'refund_completed'].includes(status)) return true;
    if (statusTag === 'cancelled' && status === 'cancelled') return true;
    
    return false;
  }

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
    console.log('[GlobalOrderWatcher] _notifySubscribers - 订阅者数量:', this._subscribers.size);
    
    this._subscribers.forEach(({ handler, cacheKey }, pageId) => {
      const isVisible = this._pageVisible.get(pageId) !== false;
      console.log('[GlobalOrderWatcher] 检查订阅者:', pageId, 'isVisible:', isVisible, 'cacheKey:', cacheKey);
      
      if (!isVisible) {
        console.log('[GlobalOrderWatcher] 跳过不可见页面:', pageId);
        return;
      }

      try {
        console.log('[GlobalOrderWatcher] 调用订阅者 handler:', pageId);
        handler({
          ...change,
          type: change.changeType,
          cacheKey
        });
      } catch (error) {
        console.error('[GlobalOrderWatcher] Handler error for', pageId, error);
      }
    });
  }

  _handleError(error) {
    const errMsg = (error && (error.message || error.errMsg || '')) || '';
    const isTimeout = errMsg.includes('timedout');
    const isLoginFail = errMsg.includes('login fail') || errMsg.includes('invalid state');

    this._isActive = false;
    this._closeWatch();

    if (isTimeout && this._reconnectAttempts >= this._maxReconnectAttempts) {
      console.log('[GlobalOrderWatcher] 超时错误，重置重试计数');
      this._reconnectAttempts = 0;
    }

    if (isLoginFail) {
      console.log('[GlobalOrderWatcher] 登录失败，尝试重新登录');
      this._retryWithLogin();
    } else {
      this._scheduleReconnect();
    }
  }

  _retryWithLogin() {
    wx.cloud.callFunction({
      name: 'login',
      success: () => {
        console.log('[GlobalOrderWatcher] 重新登录成功');
        this._reconnectAttempts = 0;
        this._startWatch();
      },
      fail: (err) => {
        console.error('[GlobalOrderWatcher] 重新登录失败:', err);
        this._scheduleReconnect();
      }
    });
  }

  _scheduleReconnect() {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      console.error('[GlobalOrderWatcher] Max reconnect attempts reached');
      return;
    }

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
    }

    const delay = Math.min(
      Math.max(3000, Math.pow(2, this._reconnectAttempts) * 1000) + Math.random() * 2000,
      60000
    );

    console.log(`[GlobalOrderWatcher] Reconnecting in ${Math.round(delay)}ms (attempt ${this._reconnectAttempts + 1}/${this._maxReconnectAttempts})`);

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

    Object.values(this._cacheCleanupTimers || {}).forEach(timer => {
      clearTimeout(timer);
    });
    this._cacheCleanupTimers = {};
  }
}

function getGlobalOrderWatcher() {
  if (!instance) {
    instance = new GlobalOrderWatcher();
  }
  return instance;
}

export { GlobalOrderWatcher, getGlobalOrderWatcher };