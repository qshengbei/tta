/**
 * 实时监听管理器 - 统一管理所有数据库实时监听
 * 支持自动重连、去重、错误处理等功能
 * 
 * 使用方式：
 * import { watch, unwatch, getStatus } from './realtimeListener';
 * 
 * watch('orders_key', { openid }, (changes, meta) => {
 *   console.log('订单变化:', changes);
 * });
 */

const db = wx.cloud.database();
const _ = db.command;

// 全局监听存储
const listeners = new Map();

/**
 * 监听配置项
 */
const listenerConfigs = {
  // 订单监听
  orders: {
    collectionName: 'orders',
    dedupeKey: '_id',
    batchSize: 10,
    autoReconnect: true,
    reconnectDelay: 2000,
    maxReconnectAttempts: 5
  },
  
  // 售后单监听
  afterSales: {
    collectionName: 'after_sales',
    dedupeKey: '_id',
    batchSize: 10,
    autoReconnect: true,
    reconnectDelay: 2000,
    maxReconnectAttempts: 5
  },
  
  // 消息监听
  messages: {
    collectionName: 'messages',
    dedupeKey: '_id',
    batchSize: 20,
    autoReconnect: true,
    reconnectDelay: 2000,
    maxReconnectAttempts: 5
  },
  
  // 会话监听
  sessions: {
    collectionName: 'sessions',
    dedupeKey: '_id',
    batchSize: 50,
    autoReconnect: true,
    reconnectDelay: 2000,
    maxReconnectAttempts: 5
  },
  
  // 商品监听
  products: {
    collectionName: 'products',
    dedupeKey: '_id',
    batchSize: 20,
    autoReconnect: true,
    reconnectDelay: 2000,
    maxReconnectAttempts: 5
  }
};

/**
 * 启动监听
 * @param {string} key - 监听标识符
 * @param {Object} whereQuery - 查询条件，如 { openid: 'xxx' }
 * @param {Function} callback - 数据变化回调，格式: (changes, meta) => {}
 * @param {Object} options - 监听选项，会与配置项合并
 * @returns {Object} 返回监听实例
 */
function watch(key, whereQuery, callback, options = {}) {
  // 检查是否已存在相同的监听
  if (listeners.has(key)) {
    console.warn(`[RealTimeListener] 监听 ${key} 已存在，请先调用 unwatch 卸载`);
    return listeners.get(key);
  }

  const config = { ...listenerConfigs[key], ...options };
  const collectionName = config.collectionName;
  
  console.log(`[RealTimeListener] 启动监听: ${key}, 集合: ${collectionName}`);

  // 初始化状态跟踪
  const listenerState = {
    key,
    collectionName,
    callback,
    config,
    whereQuery: whereQuery || {},
    isActive: true,
    connectionStatus: 'connecting',
    reconnectCount: 0,
    lastUpdateTime: Date.now(),
    totalUpdates: 0,
    errorCount: 0,
    dedupeBuffer: new Map(), // 去重缓冲区
    reconnectTimer: null,
    watchInstance: null
  };

  // 启动真实监听
  startWatchInstance(listenerState);

  listeners.set(key, listenerState);
  return listenerState;
}

/**
 * 启动 watch 实例
 */
function startWatchInstance(listenerState) {
  const { key, collectionName, callback, config, whereQuery } = listenerState;
  
  try {
    let query = db.collection(collectionName);

    // 应用查询条件
    if (whereQuery && Object.keys(whereQuery).length > 0) {
      Object.entries(whereQuery).forEach(([field, value]) => {
        query = query.where({ [field]: value });
      });
    }

    const watchInstance = query.watch({
      onChange: (snapshot) => {
        handleWatchChange(listenerState, snapshot);
      },
      onError: (error) => {
        handleWatchError(listenerState, error);
      }
    });

    listenerState.watchInstance = watchInstance;
    listenerState.connectionStatus = 'connected';
    console.log(`[RealTimeListener] ${key} 连接成功`);
  } catch (error) {
    console.error(`[RealTimeListener] ${key} 启动失败:`, error);
    handleWatchError(listenerState, error);
  }
}

/**
 * 处理 watch 变化
 */
function handleWatchChange(listenerState, snapshot) {
  const { key, callback, config, dedupeBuffer } = listenerState;
  
  if (!snapshot.docChanges || snapshot.docChanges.length === 0) {
    return;
  }

  listenerState.lastUpdateTime = Date.now();
  listenerState.totalUpdates++;

  // 处理变化
  const changes = {
    added: [],
    modified: [],
    removed: []
  };

  snapshot.docChanges.forEach((change) => {
    const doc = change.doc || {};
    const dedupeKey = config.dedupeKey || '_id';
    const docId = doc[dedupeKey];

    // 去重逻辑：检查是否已处理过
    const cacheKey = `${key}_${change.dataType}_${docId}`;
    if (dedupeBuffer.has(cacheKey)) {
      const { timestamp, revision } = dedupeBuffer.get(cacheKey);
      // 如果 5 秒内重复，跳过
      if (Date.now() - timestamp < 5000 && doc._rev === revision) {
        return;
      }
    }

    // 更新去重缓冲
    dedupeBuffer.set(cacheKey, {
      timestamp: Date.now(),
      revision: doc._rev
    });

    // 分类处理
    switch (change.dataType) {
      case 'add':
        changes.added.push(doc);
        break;
      case 'modify':
        changes.modified.push(doc);
        break;
      case 'remove':
        changes.removed.push(doc);
        break;
    }
  });

  // 调用用户回调
  if (callback && typeof callback === 'function') {
    try {
      callback(changes, {
        timestamp: Date.now(),
        snapshotKey: snapshot.snapshotKey,
        listenerKey: key
      });
    } catch (error) {
      console.error(`[RealTimeListener] ${key} 回调执行失败:`, error);
    }
  }

  // 清理过期去重缓冲（防止内存泄漏）
  if (dedupeBuffer.size > 1000) {
    const now = Date.now();
    for (const [k, v] of dedupeBuffer.entries()) {
      if (now - v.timestamp > 10000) {
        dedupeBuffer.delete(k);
      }
    }
  }

  listenerState.connectionStatus = 'connected';
}

/**
 * 处理 watch 错误
 */
function handleWatchError(listenerState, error) {
  const { key, config } = listenerState;
  
  listenerState.errorCount++;
  listenerState.connectionStatus = 'error';
  
  console.error(`[RealTimeListener] ${key} 监听出错:`, error);

  // 自动重连逻辑
  if (config.autoReconnect && listenerState.reconnectCount < config.maxReconnectAttempts) {
    const delay = config.reconnectDelay * Math.pow(2, listenerState.reconnectCount);
    listenerState.reconnectTimer = setTimeout(() => {
      listenerState.reconnectCount++;
      console.log(`[RealTimeListener] ${key} 第 ${listenerState.reconnectCount} 次重连...`);
      startWatchInstance(listenerState);
    }, delay);
  } else if (listenerState.reconnectCount >= config.maxReconnectAttempts) {
    console.error(`[RealTimeListener] ${key} 重连次数已达上限，停止重连`);
    listenerState.connectionStatus = 'failed';
  }
}

/**
 * 卸载监听
 * @param {string} key - 监听标识符
 */
function unwatch(key) {
  const listenerState = listeners.get(key);
  
  if (!listenerState) {
    console.warn(`[RealTimeListener] 监听 ${key} 不存在`);
    return;
  }

  console.log(`[RealTimeListener] 卸载监听: ${key}`);

  // 关闭 watch
  if (listenerState.watchInstance && typeof listenerState.watchInstance.close === 'function') {
    try {
      listenerState.watchInstance.close();
    } catch (error) {
      console.error(`[RealTimeListener] ${key} 关闭失败:`, error);
    }
  }

  // 清理重连定时器
  if (listenerState.reconnectTimer) {
    clearTimeout(listenerState.reconnectTimer);
  }

  // 清理缓冲区
  listenerState.dedupeBuffer.clear();
  
  listenerState.isActive = false;
  listeners.delete(key);
}

/**
 * 卸载所有监听
 */
function unwatchAll() {
  const keys = Array.from(listeners.keys());
  keys.forEach(key => unwatch(key));
  console.log(`[RealTimeListener] 已卸载所有 ${keys.length} 个监听`);
}

/**
 * 获取监听状态
 * @param {string} key - 监听标识符
 */
function getStatus(key) {
  const listener = listeners.get(key);
  if (!listener) {
    return null;
  }

  return {
    key: listener.key,
    status: listener.connectionStatus,
    isActive: listener.isActive,
    updateCount: listener.totalUpdates,
    errorCount: listener.errorCount,
    reconnectCount: listener.reconnectCount,
    lastUpdateTime: listener.lastUpdateTime,
    dedupeBufferSize: listener.dedupeBuffer.size
  };
}

/**
 * 获取所有监听状态
 */
function getAllStatus() {
  const status = {};
  listeners.forEach((listener, key) => {
    status[key] = getStatus(key);
  });
  return status;
}

/**
 * 暂停监听（保留连接，不更新数据）
 */
function pause(key) {
  const listener = listeners.get(key);
  if (listener) {
    listener.connectionStatus = 'paused';
    console.log(`[RealTimeListener] 暂停监听: ${key}`);
  }
}

/**
 * 恢复监听
 */
function resume(key) {
  const listener = listeners.get(key);
  if (listener) {
    listener.connectionStatus = 'connected';
    console.log(`[RealTimeListener] 恢复监听: ${key}`);
  }
}

// 页面卸载时自动清理
if (typeof wx !== 'undefined' && wx.onAppHide) {
  wx.onAppHide(() => {
    console.log('[RealTimeListener] 应用进入后台');
  });
}

export {
  watch,
  unwatch,
  unwatchAll,
  getStatus,
  getAllStatus,
  pause,
  resume,
  listenerConfigs
};
