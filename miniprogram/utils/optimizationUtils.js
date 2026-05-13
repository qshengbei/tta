/**
 * 防抖与节流工具
 */

class ThrottleDebounce {
  /**
   * 防抖：合并多个快速触发的事件为一个
   * 
   * 使用场景：输入框实时搜索、窗口 resize 等
   */
  static debounce(fn, delay = 300) {
    let timer = null;

    return function(...args) {
      if (timer) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        fn.apply(this, args);
        timer = null;
      }, delay);
    };
  }

  /**
   * 节流：限制函数执行频率
   * 
   * 使用场景：列表滚动加载、鼠标移动等
   */
  static throttle(fn, interval = 300) {
    let lastTime = 0;

    return function(...args) {
      const now = Date.now();

      if (now - lastTime >= interval) {
        fn.apply(this, args);
        lastTime = now;
      }
    };
  }

  /**
   * 请求节流：同时只允许一个请求进行
   * 
   * 使用场景：避免重复提交、并发控制等
   */
  static requestThrottle(fn) {
    let pending = false;
    let queuedArgs = null;

    return async function(...args) {
      if (pending) {
        queuedArgs = args;
        return;
      }

      pending = true;
      try {
        const result = await fn.apply(this, args);
        
        // 如果执行期间有新的请求，继续处理
        if (queuedArgs) {
          const nextArgs = queuedArgs;
          queuedArgs = null;
          return this(...nextArgs);
        }

        return result;
      } finally {
        pending = false;
      }
    };
  }

  /**
   * 超时控制
   * 
   * 使用场景：限制函数执行时间
   */
  static withTimeout(fn, timeout = 3000) {
    return async function(...args) {
      return Promise.race([
        fn.apply(this, args),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Operation timeout')), timeout)
        )
      ]);
    };
  }

  /**
   * 重试机制
   * 
   * 使用场景：失败重试
   */
  static withRetry(fn, retries = 3, delay = 1000) {
    return async function(...args) {
      for (let i = 0; i < retries; i++) {
        try {
          return await fn.apply(this, args);
        } catch (error) {
          console.warn(`[Retry] 第 ${i + 1} 次失败，${i < retries - 1 ? `${delay}ms 后重试` : '放弃重试'}`);
          
          if (i < retries - 1) {
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            throw error;
          }
        }
      }
    };
  }
}

/**
 * 智能缓存管理
 */
class SmartCache {
  constructor(maxSize = 100, ttl = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.cache = new Map();
  }

  set(key, value) {
    // 超过最大容量，删除最旧的条目
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  get(key) {
    const item = this.cache.get(key);
    
    if (!item) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    // 更新时间戳（LRU）
    this.cache.delete(key);
    this.cache.set(key, item);

    return item.value;
  }

  has(key) {
    const value = this.get(key);
    return value !== null;
  }

  clear() {
    this.cache.clear();
  }

  delete(key) {
    this.cache.delete(key);
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl
    };
  }
}

/**
 * 冲突解决器
 */
class ConflictResolver {
  /**
   * 解决本地修改 vs 远端更新的冲突
   * 策略: 时间戳 + 操作优先级
   */
  static resolveOrderConflict(localOrder, remoteOrder) {
    // 如果本地有未上传的修改，优先保留本地
    if (localOrder._localModified && !localOrder._uploaded) {
      return localOrder;
    }

    // 否则使用更新时间最新的版本
    const localTime = new Date(localOrder.updatedAt).getTime();
    const remoteTime = new Date(remoteOrder.updatedAt).getTime();

    return remoteTime > localTime ? remoteOrder : localOrder;
  }

  /**
   * 解决消息顺序冲突
   * 策略: createTime + messageId
   */
  static resolveMessageOrder(msg1, msg2) {
    const time1 = msg1.createTime instanceof Date 
      ? msg1.createTime.getTime() 
      : new Date(msg1.createTime).getTime();
    
    const time2 = msg2.createTime instanceof Date 
      ? msg2.createTime.getTime() 
      : new Date(msg2.createTime).getTime();

    if (time1 === time2) {
      // 时间相同，按 ID 字典序排序
      return msg1._id.localeCompare(msg2._id);
    }

    return time1 - time2;
  }

  /**
   * 解决数组合并冲突
   * 去重并保留最新数据
   */
  static mergeArrays(arr1, arr2, dedupeKey = '_id') {
    const merged = new Map();

    // 先添加第一个数组
    arr1.forEach(item => {
      merged.set(item[dedupeKey], item);
    });

    // 再添加第二个数组，覆盖相同的项
    arr2.forEach(item => {
      const key = item[dedupeKey];
      if (merged.has(key)) {
        // 对比时间戳，保留较新的
        const existing = merged.get(key);
        const existingTime = new Date(existing.updatedAt || existing.createTime).getTime();
        const newTime = new Date(item.updatedAt || item.createTime).getTime();
        if (newTime > existingTime) {
          merged.set(key, item);
        }
      } else {
        merged.set(key, item);
      }
    });

    return Array.from(merged.values());
  }
}

export {
  ThrottleDebounce,
  SmartCache,
  ConflictResolver
};
