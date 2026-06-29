/**
 * ProductCacheStore - 商品列表缓存存储层
 *
 * 单例，管理所有商品列表缓存的读写和增量更新。
 * 内存缓存 + localStorage 持久化双重存储。
 *
 * 缓存结构 (每个 key 一份):
 * {
 *   key: string,              // 缓存标识
 *   data: [...],              // 扁平数组，已加载的全部商品
 *   cacheIndex: number,       // 下次从缓存取的起始位置
 *   cursor: string|null,      // DB 分页游标 (_id)
 *   hasMore: boolean,
 *   stale: boolean,           // 脏标记（页面隐藏期间有变更）
 *   updateVersion: number[],  // 更新版本数组（防止并发更新丢失）
 *   serverMaxUpdateTime: number, // 数据库中商品的最大 updatedAtTs 时间戳
 *   timestamp: number
 * }
 */

const STORAGE_PREFIX = 'product_cache_';
const DEFAULT_PAGE_SIZE = 18;

class ProductCacheStore {
  constructor() {
    // 内存缓存 Map<key, cacheEntry>
    this._caches = new Map();
    // 已注册的缓存 key 集合
    this._registeredKeys = new Set();
  }

  /**
   * 读缓存
   * @param {string} key
   * @returns {object|null}
   */
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
          serverMaxUpdateTime: raw.serverMaxUpdateTime || 0,  // 数据库最大更新时间戳
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

  /**
   * 写缓存（全量覆盖/新建）
   * @param {string} key
   * @param {object} entry  { data, cacheIndex, cursor, hasMore, stale }
   */
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
      serverMaxUpdateTime: entry.serverMaxUpdateTime || 0,  // 数据库最大更新时间戳
      timestamp: now
    };

    this._caches.set(key, cacheEntry);
    this._registeredKeys.add(key);
    this._persist(key, cacheEntry);
  }

  /**
   * 追加数据到缓存末尾（分页加载更多时）
   * @param {string} key
   * @param {Array} newData - 新加载的数据
   * @param {string|null} newCursor
   * @param {boolean} hasMore
   */
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

    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  /**
   * 在指定 index 处插入一条记录，cacheIndex 同步偏移
   * @param {string} key
   * @param {object} product
   * @param {number} index - 插入位置（在 data 中的索引）
   */
  insertAt(key, product, index) {
    const entry = this.get(key);
    if (!entry) return;

    entry.data.splice(index, 0, product);

    // cacheIndex 偏移: 插入在已读区域内 → 边界后移
    if (index <= entry.cacheIndex) {
      entry.cacheIndex++;
    }

    entry.timestamp = Date.now();
    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  /**
   * 在指定 index 处移除一条记录，cacheIndex 同步偏移
   * @param {string} key
   * @param {string} productId
   * @param {number} index - 移除位置（在 data 中的索引）
   */
  removeAt(key, productId, index) {
    const entry = this.get(key);
    if (!entry) return;

    const isLast = index === entry.data.length - 1;

    entry.data.splice(index, 1);

    // cacheIndex 偏移: 删除在已读区域内 → 边界前移
    if (index < entry.cacheIndex) {
      entry.cacheIndex--;
    }

    // 删除最后一条 → 更新 cursor
    if (isLast && entry.data.length > 0) {
      const newLast = entry.data[entry.data.length - 1];
      entry.cursor = newLast._id || null;
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

  /**
   * 原地更新一条记录
   * @param {string} key
   * @param {string} productId
   * @param {object} fields - 要更新的字段
   */
  updateAt(key, productId, fields) {
    const entry = this.get(key);
    if (!entry) return;

    const idx = entry.data.findIndex(p => p._id === productId);
    if (idx === -1) return;

    entry.data[idx] = { ...entry.data[idx], ...fields };
    entry.timestamp = Date.now();

    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  /**
   * 标记缓存为脏（页面隐藏期间有变更）
   * @param {string} key
   */
  markStale(key) {
    const entry = this.get(key);
    if (!entry) return;

    entry.stale = true;
    entry.timestamp = Date.now();

    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  /**
   * 清除指定 key 的缓存
   */
  clearKey(key) {
    this._caches.delete(key);
    this._registeredKeys.delete(key);
    try {
      wx.removeStorageSync(STORAGE_PREFIX + key);
    } catch (e) {
      // ignore
    }
  }

  /**
   * 获取所有缓存 key
   * @returns {string[]} 所有缓存 key 数组
   */
  getAllKeys() {
    const keys = [];
    // 从 localStorage 中读取所有以 STORAGE_PREFIX 开头的 key
    // 不依赖 _registeredKeys，因为页面离开后会被清理
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
    // 也包含内存中的缓存 key（防止 localStorage 读取失败）
    this._caches.forEach((_, key) => {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    });
    return keys;
  }

  /**
   * 更新游标
   */
  updateCursor(key, cursor, hasMore) {
    const entry = this.get(key);
    if (!entry) return;

    entry.cursor = cursor;
    if (hasMore !== undefined) entry.hasMore = hasMore;
    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  /**
   * 清空所有缓存
   */
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

  /**
   * 持久化到 localStorage
   */
  _persist(key, entry) {
    try {
      wx.setStorageSync(STORAGE_PREFIX + key, {
        data: entry.data,
        cacheIndex: entry.cacheIndex,
        cursor: entry.cursor,
        hasMore: entry.hasMore,
        stale: entry.stale,
        updateVersion: entry.updateVersion || [],
        serverMaxUpdateTime: entry.serverMaxUpdateTime || 0,  // 数据库最大更新时间戳
        timestamp: entry.timestamp
      });
    } catch (e) {
      console.warn('[ProductCacheStore] 持久化失败:', key, e);
    }
  }

  /**
   * 插入商品到缓存（智能位置）
   * @param {string} key
   * @param {object} product
   */
  insertProduct(key, product) {
    const entry = this.get(key);
    console.log('[ProductCacheStore] insertProduct - key:', key, ', entry exists:', !!entry, ', product:', product._id);
    if (!entry) {
      console.log('[ProductCacheStore] insertProduct - 缓存不存在，跳过:', key);
      return;
    }

    // 检查商品是否已存在（去重）
    const existingIndex = entry.data.findIndex(p => p._id === product._id);
    if (existingIndex !== -1) {
      console.log('[ProductCacheStore] insertProduct - 商品已存在，更新而非插入:', product._id);
      // 更新现有商品
      entry.data[existingIndex] = product;
      entry.timestamp = Date.now();
      
      // 更新 serverMaxUpdateTime（如果商品的 updatedAtTs 更新）
      const productUpdateTime = product.updatedAtTs || 0;
      if (productUpdateTime > (entry.serverMaxUpdateTime || 0)) {
        entry.serverMaxUpdateTime = productUpdateTime;
        console.log('[ProductCacheStore] insertProduct - 更新 serverMaxUpdateTime:', productUpdateTime);
      }
      
      this._caches.set(key, entry);
      this._persist(key, entry);
      return;
    }

    // 找到合适的插入位置（按 _id 降序）
    const insertIdx = this._findInsertIndex(product, entry.data);
    console.log('[ProductCacheStore] insertProduct - 插入位置:', insertIdx, ', 当前数据长度:', entry.data.length);
    entry.data.splice(insertIdx, 0, product);

    // cacheIndex 偏移: 插入在已读区域内 → 边界后移
    if (insertIdx <= entry.cacheIndex) {
      entry.cacheIndex++;
    }

    entry.timestamp = Date.now();
    
    // 更新 serverMaxUpdateTime（如果商品的 updatedAtTs 更新）
    const productUpdateTime = product.updatedAtTs || 0;
    if (productUpdateTime > (entry.serverMaxUpdateTime || 0)) {
      entry.serverMaxUpdateTime = productUpdateTime;
      console.log('[ProductCacheStore] insertProduct - 更新 serverMaxUpdateTime:', productUpdateTime);
    }
    
    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  /**
   * 更新缓存中的商品
   */
  updateProduct(key, product) {
    const entry = this.get(key);
    if (!entry) return;

    const idx = entry.data.findIndex(p => p._id === product._id);
    if (idx === -1) return;

    entry.data[idx] = { ...entry.data[idx], ...product };
    entry.timestamp = Date.now();
    
    // 更新 serverMaxUpdateTime（如果商品的 updatedAtTs 更新）
    const productUpdateTime = product.updatedAtTs || 0;
    if (productUpdateTime > (entry.serverMaxUpdateTime || 0)) {
      entry.serverMaxUpdateTime = productUpdateTime;
      console.log('[ProductCacheStore] updateProduct - 更新 serverMaxUpdateTime:', productUpdateTime);
    }

    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  /**
   * 从缓存中移除商品
   * @param {string} key
   * @param {string} productId
   */
  removeProduct(key, productId) {
    const entry = this.get(key);
    if (!entry) return;

    const idx = entry.data.findIndex(p => p._id === productId);
    if (idx === -1) return;

    const isLast = idx === entry.data.length - 1;
    entry.data.splice(idx, 1);

    // cacheIndex 偏移: 删除在已读区域内 → 边界前移
    if (idx < entry.cacheIndex) {
      entry.cacheIndex--;
    }

    // 删除最后一条 → 更新 cursor
    if (isLast && entry.data.length > 0) {
      const newLast = entry.data[entry.data.length - 1];
      entry.cursor = newLast._id || null;
      if (entry.cacheIndex > entry.data.length) {
        entry.cacheIndex = entry.data.length;
      }
    } else if (entry.data.length === 0) {
      entry.cursor = null;
      entry.cacheIndex = 0;
      entry.hasMore = false;
    }

    // 如果缓存中剩余的商品数 <= cacheIndex（已加载的数量），说明没有更多数据了
    if (entry.data.length <= entry.cacheIndex) {
      entry.hasMore = false;
    }

    entry.timestamp = Date.now();
    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  /**
   * 标记缓存需要验证（监听断开时使用）
   * @param {string} key
   */
  markNeedVerify(key) {
    const entry = this.get(key);
    if (!entry) return;

    entry.stale = true;
    entry.timestamp = Date.now();

    this._caches.set(key, entry);
    this._persist(key, entry);
  }

  /**
   * 找到合适的插入位置（按 _id 降序）
   * @param {object} product
   * @param {Array} list
   * @returns {number}
   */
  _findInsertIndex(product, list) {
    const targetId = product._id;
    if (!list || list.length === 0) return 0;

    // 二分查找插入位置（降序）
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

  /**
   * 获取统计信息
   */
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

// 单例
const productCacheStore = new ProductCacheStore();

export { ProductCacheStore };
export default productCacheStore;
