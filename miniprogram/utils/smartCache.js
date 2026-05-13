/**
 * 智能缓存类
 * 支持内存缓存 + 本地存储缓存的二级缓存策略
 * 
 * 使用场景：
 * - 首页数据缓存
 * - 商品列表缓存
 * - 配置信息缓存
 */

class SmartCache {
  constructor(key, options = {}) {
    this.key = key;
    this.memoryCache = null;           // 内存缓存（会话级）
    this.memoryTime = 0;               // 内存缓存时间戳
    this.memoryCacheTTL = options.memoryCacheTTL || 5 * 60 * 1000;      // 内存缓存 5分钟
    this.storageCacheTTL = options.storageCacheTTL || 2 * 60 * 60 * 1000; // 本地缓存 2小时
    console.log(`[SmartCache] Initialized: ${key}`);
  }

  /**
   * 获取缓存数据
   * 策略: 内存 → 本地存储 → 返回 null
   * @returns {*} 缓存数据或 null
   */
  get() {
    // 1. 先查内存缓存（最快）
    if (this.memoryCache !== null && Date.now() - this.memoryTime < this.memoryCacheTTL) {
      console.log(`[SmartCache] Hit memory cache: ${this.key}`);
      return this.memoryCache;
    }

    // 2. 再查本地存储缓存
    try {
      const cached = wx.getStorageSync(this.key);
      if (cached) {
        const data = JSON.parse(cached);
        
        // 检查本地缓存是否过期
        if (Date.now() - data.timestamp < this.storageCacheTTL) {
          // 更新内存缓存以加速后续访问
          this.memoryCache = data.value;
          this.memoryTime = Date.now();
          console.log(`[SmartCache] Hit storage cache: ${this.key}`);
          return data.value;
        } else {
          // 本地缓存已过期，删除
          wx.removeStorageSync(this.key);
          console.log(`[SmartCache] Expired cache removed: ${this.key}`);
        }
      }
    } catch (e) {
      console.error(`[SmartCache] Failed to read cache: ${this.key}`, e);
    }

    console.log(`[SmartCache] Cache miss: ${this.key}`);
    return null;
  }

  /**
   * 设置缓存数据
   * 策略: 同时更新内存缓存和本地存储
   * @param {*} value - 缓存值
   */
  set(value) {
    // 更新内存缓存
    this.memoryCache = value;
    this.memoryTime = Date.now();

    // 更新本地存储缓存
    try {
      const data = {
        value,
        timestamp: Date.now()
      };
      wx.setStorageSync(this.key, JSON.stringify(data));
      console.log(`[SmartCache] Cache set: ${this.key}`);
    } catch (e) {
      console.error(`[SmartCache] Failed to write cache: ${this.key}`, e);
    }
  }

  /**
   * 清除缓存
   * 清空内存缓存和本地存储
   */
  clear() {
    this.memoryCache = null;
    this.memoryTime = 0;
    
    try {
      wx.removeStorageSync(this.key);
      console.log(`[SmartCache] Cache cleared: ${this.key}`);
    } catch (e) {
      console.error(`[SmartCache] Failed to clear cache: ${this.key}`, e);
    }
  }

  /**
   * 只清除内存缓存（保留本地存储）
   */
  clearMemory() {
    this.memoryCache = null;
    this.memoryTime = 0;
    console.log(`[SmartCache] Memory cache cleared: ${this.key}`);
  }

  /**
   * 检查缓存是否存在
   * @returns {boolean} true 表示缓存存在且未过期
   */
  has() {
    return this.get() !== null;
  }

  /**
   * 检查缓存是否过期
   * @returns {boolean} true 表示过期或不存在
   */
  isExpired() {
    return !this.has();
  }

  /**
   * 获取缓存信息
   */
  getInfo() {
    const memoryValid = this.memoryCache !== null && Date.now() - this.memoryTime < this.memoryCacheTTL;
    
    let storageValid = false;
    try {
      const cached = wx.getStorageSync(this.key);
      if (cached) {
        const data = JSON.parse(cached);
        storageValid = Date.now() - data.timestamp < this.storageCacheTTL;
      }
    } catch (e) {}

    return {
      key: this.key,
      memoryValid,
      storageValid,
      memoryCacheTTL: this.memoryCacheTTL,
      storageCacheTTL: this.storageCacheTTL
    };
  }
}

export default SmartCache;
