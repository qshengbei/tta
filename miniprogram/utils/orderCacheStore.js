/**
 * OrderCacheStore - 订单列表缓存存储层
 *
 * 单例，管理所有订单列表缓存的读写和增量更新。
 * 内存缓存 + localStorage 持久化双重存储。
 *
 * 缓存结构 (每个 key 一份):
 * {
 *   key: string,              // 缓存标识
 *   data: [...],              // 扁平数组，已加载的全部订单
 *   cacheIndex: number,       // 下次从缓存取的起始位置
 *   cursor: object|null,      // DB 分页游标 { updatedAtTs, _id }
 *   hasMore: boolean,
 *   stale: boolean,           // 脏标记（页面隐藏期间有变更）
 *   updateVersion: number[],  // 更新版本数组（防止并发更新丢失）
 *   serverMaxUpdateTime: number, // 数据库中订单的最大 updatedAtTs 时间戳
 *   timestamp: number
 * }
 */

const STORAGE_PREFIX = 'order_cache_';
const DEFAULT_PAGE_SIZE = 18;

class OrderCacheStore {
  constructor() {
    this._caches = new Map();
    this._registeredKeys = new Set();
  }

  get(key) {
    if (this._caches.has(key)) {
      return this._caches.get(key);
    }
    try {
      const raw = wx.getStorageSync(STORAGE_PREFIX + key);
      if (raw && raw.data && Array.isArray(raw.data)) {
        const entry = {
          key,
          data: raw.data,
          cacheIndex: raw.cacheIndex || 0,
          cursor: raw.cursor || null,
          hasMore: raw.hasMore !== false,
          stale: raw.stale === true,
          updateVersion: Array.isArray(raw.updateVersion) ? raw.updateVersion : [],
          serverMaxUpdateTime: raw.serverMaxUpdateTime || 0,
          timestamp: raw.timestamp || 0
        };
        this._caches.set(key, entry);
        return entry;
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  set(key, entry) {
    const now = Date.now();
    const cacheEntry = {
      key,
      data: entry.data || [],
      cacheIndex: entry.cacheIndex || 0,
      cursor: entry.cursor || null,
      hasMore: entry.hasMore !== false,
      stale: entry.stale === true,
      updateVersion: Array.isArray(entry.updateVersion) ? entry.updateVersion : [],
      serverMaxUpdateTime: entry.serverMaxUpdateTime || 0,
      timestamp: now
    };

    this._caches.set(key, cacheEntry);
    this._registeredKeys.add(key);
    this._persist(key, cacheEntry);
  }

  append(key, newData, newCursor, hasMore) {
    if (!newData || newData.length === 0) return;

    let entry = this.get(key);
    if (!entry) {
      this.set(key, {
        data: [...newData],
        cacheIndex: 0,
        cursor: newCursor || null,
        hasMore
      });
      return;
    }

    entry.data = [...entry.data, ...newData];
    entry.cursor = newCursor || entry.cursor;
    entry.hasMore = hasMore;
    entry.timestamp = Date.now();
    
    const newMaxTime = newData[0]?.updatedAtTs || 0;
    if (newMaxTime > (entry.serverMaxUpdateTime || 0)) {
      entry.serverMaxUpdateTime = newMaxTime;
    }

    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  insertAt(key, order, index) {
    const entry = this.get(key);
    if (!entry) return;

    entry.data.splice(index, 0, order);

    if (index <= entry.cacheIndex) {
      entry.cacheIndex++;
    }

    entry.timestamp = Date.now();
    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  removeAt(key, orderId, index) {
    const entry = this.get(key);
    if (!entry) return;

    const isLast = index === entry.data.length - 1;

    entry.data.splice(index, 1);

    if (index < entry.cacheIndex) {
      entry.cacheIndex--;
    }

    if (isLast && entry.data.length > 0) {
      const newLast = entry.data[entry.data.length - 1];
      entry.cursor = newLast._id ? { updatedAtTs: newLast.updatedAtTs, _id: newLast._id } : null;
      if (entry.cacheIndex > entry.data.length) {
        entry.cacheIndex = entry.data.length;
      }
    } else if (entry.data.length === 0) {
      entry.cursor = null;
      entry.cacheIndex = 0;
      entry.hasMore = false;
    }

    entry.timestamp = Date.now();
    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  updateAt(key, orderId, fields) {
    const entry = this.get(key);
    if (!entry) return;

    const idx = entry.data.findIndex(o => o._id === orderId);
    if (idx === -1) return;

    entry.data[idx] = { ...entry.data[idx], ...fields };
    entry.timestamp = Date.now();

    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  markStale(key) {
    const entry = this.get(key);
    if (!entry) return;

    entry.stale = true;
    entry.timestamp = Date.now();

    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  clearKey(key) {
    this._caches.delete(key);
    this._registeredKeys.delete(key);
    try {
      wx.removeStorageSync(STORAGE_PREFIX + key);
    } catch (e) {
      // ignore
    }
  }

  getAllKeys() {
    const keys = [];
    try {
      const info = wx.getStorageInfoSync();
      info.keys.forEach(key => {
        if (key.startsWith(STORAGE_PREFIX)) {
          const cacheKey = key.substring(STORAGE_PREFIX.length);
          if (!keys.includes(cacheKey)) {
            keys.push(cacheKey);
          }
        }
      });
    } catch (e) {
      // ignore
    }
    this._caches.forEach((_, key) => {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    });
    return keys;
  }

  updateCursor(key, cursor, hasMore) {
    const entry = this.get(key);
    if (!entry) return;

    entry.cursor = cursor;
    if (hasMore !== undefined) entry.hasMore = hasMore;
    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  clearAll() {
    this._caches.clear();
    try {
      const keys = wx.getStorageInfoSync().keys || [];
      keys.forEach(k => {
        if (k.startsWith(STORAGE_PREFIX)) {
          wx.removeStorageSync(k);
        }
      });
    } catch (e) {
      // ignore
    }
    this._registeredKeys.clear();
  }

  _persist(key, entry) {
    try {
      wx.setStorageSync(STORAGE_PREFIX + key, {
        data: entry.data,
        cacheIndex: entry.cacheIndex,
        cursor: entry.cursor,
        hasMore: entry.hasMore,
        stale: entry.stale,
        updateVersion: entry.updateVersion || [],
        serverMaxUpdateTime: entry.serverMaxUpdateTime || 0,
        timestamp: entry.timestamp
      });
    } catch (e) {
      console.warn('[OrderCacheStore] 持久化失败:', key, e);
    }
  }

  insertOrder(key, order) {
    const entry = this.get(key);
    if (!entry) return;

    const existingIndex = entry.data.findIndex(o => o._id === order._id);
    if (existingIndex !== -1) {
      entry.data[existingIndex] = { ...entry.data[existingIndex], ...order };
      entry.timestamp = Date.now();
      
      const orderUpdateTime = order.updatedAtTs || 0;
      if (orderUpdateTime > (entry.serverMaxUpdateTime || 0)) {
        entry.serverMaxUpdateTime = orderUpdateTime;
      }

      if (entry.cursor && entry.cursor._id === order._id) {
        entry.cursor = { updatedAtTs: order.updatedAtTs || entry.data[existingIndex].updatedAtTs, _id: order._id };
      }
      
      this._caches.set(key, entry);
      this._persist(key, entry);
      return;
    }

    const beforeCursor = entry.cursor ? `{updatedAtTs=${entry.cursor.updatedAtTs}, _id=${entry.cursor._id}}` : 'null';
    const beforeMaxTime = entry.serverMaxUpdateTime || 0;

    const insertIdx = this._findInsertIndex(order, entry.data);
    entry.data.splice(insertIdx, 0, order);

    if (insertIdx <= entry.cacheIndex) {
      entry.cacheIndex++;
    }

    if (entry.data.length <= entry.cacheIndex) {
      entry.hasMore = false;
    }

    entry.timestamp = Date.now();
    
    const orderUpdateTime = order.updatedAtTs || 0;
    if (orderUpdateTime > (entry.serverMaxUpdateTime || 0)) {
      entry.serverMaxUpdateTime = orderUpdateTime;
    }
    
    const afterCursor = entry.cursor ? `{updatedAtTs=${entry.cursor.updatedAtTs}, _id=${entry.cursor._id}}` : 'null';
    const afterMaxTime = entry.serverMaxUpdateTime || 0;

    console.log(`[OrderCacheStore] insertOrder - key: ${key}, orderId: ${order._id}, insertIdx: ${insertIdx}`);
    console.log(`  插入前 - cursor: ${beforeCursor}, serverMaxUpdateTime: ${beforeMaxTime}`);
    console.log(`  插入后 - cursor: ${afterCursor}, serverMaxUpdateTime: ${afterMaxTime}`);
    console.log(`  当前数据量: ${entry.data.length}, cacheIndex: ${entry.cacheIndex}, hasMore: ${entry.hasMore}`);

    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  updateOrder(key, order) {
    const entry = this.get(key);
    if (!entry) return;

    const idx = entry.data.findIndex(o => o._id === order._id);
    if (idx === -1) return;

    entry.data[idx] = { ...entry.data[idx], ...order };
    entry.timestamp = Date.now();
    
    const orderUpdateTime = order.updatedAtTs || 0;
    if (orderUpdateTime > (entry.serverMaxUpdateTime || 0)) {
      entry.serverMaxUpdateTime = orderUpdateTime;
    }

    if (entry.cursor && entry.cursor._id === order._id) {
      entry.cursor = { updatedAtTs: order.updatedAtTs || entry.data[idx].updatedAtTs, _id: order._id };
    }

    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  removeOrder(key, orderId) {
    const entry = this.get(key);
    if (!entry) return;

    const idx = entry.data.findIndex(o => o._id === orderId);
    if (idx === -1) return;

    const removedOrder = entry.data[idx];
    const isLast = idx === entry.data.length - 1;

    const beforeCursor = entry.cursor ? `{updatedAtTs=${entry.cursor.updatedAtTs}, _id=${entry.cursor._id}}` : 'null';
    const beforeMaxTime = entry.serverMaxUpdateTime || 0;
    const beforeDataLength = entry.data.length;

    entry.data.splice(idx, 1);

    if (idx < entry.cacheIndex) {
      entry.cacheIndex--;
    }

    if (isLast && entry.data.length > 0) {
      const newLast = entry.data[entry.data.length - 1];
      entry.cursor = newLast._id ? { updatedAtTs: newLast.updatedAtTs, _id: newLast._id } : null;
      if (entry.cacheIndex > entry.data.length) {
        entry.cacheIndex = entry.data.length;
      }
    } else if (entry.data.length === 0) {
      entry.cursor = null;
      entry.cacheIndex = 0;
      entry.hasMore = false;
      entry.serverMaxUpdateTime = 0;
    }

    if (entry.data.length <= entry.cacheIndex) {
      entry.hasMore = false;
    }

    if (entry.data.length > 0) {
      const removedTime = removedOrder.updatedAtTs || 0;
      const currentMaxTime = entry.serverMaxUpdateTime || 0;
      if (removedTime >= currentMaxTime) {
        entry.serverMaxUpdateTime = entry.data.reduce((max, o) => Math.max(max, o.updatedAtTs || 0), 0);
      }
    }

    entry.timestamp = Date.now();

    const afterCursor = entry.cursor ? `{updatedAtTs=${entry.cursor.updatedAtTs}, _id=${entry.cursor._id}}` : 'null';
    const afterMaxTime = entry.serverMaxUpdateTime || 0;
    const afterDataLength = entry.data.length;

    console.log(`[OrderCacheStore] removeOrder - key: ${key}, orderId: ${orderId}, idx: ${idx}, isLast: ${isLast}`);
    console.log(`  移除前 - cursor: ${beforeCursor}, serverMaxUpdateTime: ${beforeMaxTime}, dataLength: ${beforeDataLength}`);
    console.log(`  移除后 - cursor: ${afterCursor}, serverMaxUpdateTime: ${afterMaxTime}, dataLength: ${afterDataLength}`);
    console.log(`  当前状态 - cacheIndex: ${entry.cacheIndex}, hasMore: ${entry.hasMore}`);

    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  markNeedVerify(key) {
    const entry = this.get(key);
    if (!entry) return;

    entry.stale = true;
    entry.timestamp = Date.now();

    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  _findInsertIndex(order, list) {
    const targetId = order._id;
    if (!list || list.length === 0) return 0;

    let left = 0;
    let right = list.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (list[mid]._id > targetId) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    return left;
  }

  getStats() {
    const stats = {};
    this._caches.forEach((entry, key) => {
      stats[key] = {
        dataCount: entry.data.length,
        cacheIndex: entry.cacheIndex,
        hasMore: entry.hasMore,
        stale: entry.stale
      };
    });
    return stats;
  }
}

const orderCacheStore = new OrderCacheStore();

export { OrderCacheStore };
export default orderCacheStore;