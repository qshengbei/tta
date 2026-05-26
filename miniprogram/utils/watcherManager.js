/**
 * 统一监听管理类
 * 提供页面级和全局级监听的统一管理
 * 增强功能：
 * - 页面可见性控制
 * - 并发创建保护
 * - 重连调度保护
 */

class WatcherManager {
  constructor() {
    this.watchers = {};        // 页面级监听
    this.globalWatchers = [];  // 全局级监听
    this.retryTimers = {};     // 重连定时器存储
    this.pageVisibility = {};    // 页面可见性状态
    this.creatingWatchers = new Set(); // 正在创建的监听器（防止并发创建）
    this.maxRetries = 5;       // 最大重试次数
    console.log('[WatcherManager] Initialized (enhanced)');
  }

  /**
   * 创建页面级监听
   * @param {string} key - 监听唯一标识
   * @param {Function} creator - 监听创建函数
   * @param {Object} options - 配置选项 { maxRetries: 3 }
   * @returns {Object} 返回监听包装对象
   */
  create(key, creator, options = {}) {
    // 防止并发创建
    if (this.creatingWatchers.has(key)) {
      console.warn('[WatcherManager] Watcher "' + key + '" is being created, skipping');
      return this.watchers[key];
    }

    // 避免重复创建
    if (this.watchers[key]) {
      console.warn('[WatcherManager] Watcher "' + key + '" already exists');
      return this.watchers[key];
    }

    // 检查页面可见性（如果已设置）
    if (this.pageVisibility[key] === false) {
      console.warn('[WatcherManager] Page for "' + key + '" is hidden, skipping create');
      return null;
    }

    if (typeof creator !== 'function') {
      console.error('[WatcherManager] creator must be a function');
      return null;
    }

    try {
      this.creatingWatchers.add(key);

      const watcher = creator();
      const wrapper = {
        watcher,
        key,
        active: true,
        creator,
        options: options || {},
        retryCount: 0,
        healthTimer: null,
        close: () => {
          if (wrapper.active && wrapper.watcher) {
            if (typeof wrapper.watcher.close === 'function') {
              wrapper.watcher.close();
            }
            wrapper.active = false;
            delete this.watchers[key];
            this.creatingWatchers.delete(key);

            // 清理重连定时器
            if (this.retryTimers[key]) {
              clearTimeout(this.retryTimers[key]);
              delete this.retryTimers[key];
            }

            // 清理健康衰减定时器
            if (wrapper.healthTimer) {
              clearTimeout(wrapper.healthTimer);
              wrapper.healthTimer = null;
            }

            console.log('[WatcherManager] Closed watcher: ' + key);
          }
        },
        // 页面调用此方法报告监听器健康（如 onChange 首次收到数据）
        reportHealthy: () => {
          if (wrapper.retryCount > 0) {
            console.log('[WatcherManager] Watcher "' + key + '" recovered, reset retryCount (' + wrapper.retryCount + ' → 0)');
            wrapper.retryCount = 0;
          }
          if (wrapper.healthTimer) {
            clearTimeout(wrapper.healthTimer);
            wrapper.healthTimer = null;
          }
        }
      };

      this.watchers[key] = wrapper;
      console.log('[WatcherManager] Created watcher: ' + key);
      return wrapper;
    } catch (error) {
      console.error('[WatcherManager] Failed to create watcher: ' + key, error);
      return null;
    } finally {
      this.creatingWatchers.delete(key);
    }
  }

  /**
   * 设置监听器页面可见性
   * @param {string} key - 监听唯一标识
   * @param {boolean} visible - 是否可见
   */
  setPageVisible(key, visible) {
    const wasVisible = this.pageVisibility[key];
    this.pageVisibility[key] = visible;

    console.log('[WatcherManager] Watcher "' + key + '" page visibility: ' + (wasVisible ? 'visible' : 'hidden'));

    // 页面隐藏时，取消重连定时器
    if (!visible && this.retryTimers[key]) {
      console.log('[WatcherManager] Cancelling reconnect timer for "' + key + '" due to page hidden');
      clearTimeout(this.retryTimers[key]);
      delete this.retryTimers[key];
    }

    // 页面显示时，如果监听器存在，不做额外操作
    // 页面需要自己调用 create
  }

  /**
   * 自动重连（在 watch 的 onError 回调中调用）
   * @param {string} key - 监听唯一标识
   * @param {string} reason - 错误原因
   */
  autoReconnect(key, reason = '') {
    const wrapper = this.watchers[key];

    if (!wrapper) {
      console.warn('[WatcherManager] Watcher "' + key + '" not found, cannot reconnect');
      return;
    }

    // 检查页面可见性
    if (this.pageVisibility[key] === false) {
      console.log('[WatcherManager] Page for "' + key + '" is hidden, skipping reconnect');
      return;
    }

    // 检查是否已有重连定时器
    if (this.retryTimers[key]) {
      console.warn('[WatcherManager] Reconnect already scheduled for "' + key + '", skipping');
      return;
    }

    const maxRetries = wrapper.options.maxRetries || this.maxRetries;

    if (wrapper.retryCount >= maxRetries) {
      console.error('[WatcherManager] Max retries reached for watcher "' + key + '" (' + maxRetries + '), stop reconnecting. Use reportHealthy() to recover');
      return;
    }

    // 清理健康衰减定时器（有新错误发生）
    if (wrapper.healthTimer) {
      clearTimeout(wrapper.healthTimer);
      wrapper.healthTimer = null;
    }

    // 指数退避 + 抖动：1s, 2s, 4s, 8s, 16s (±25% 随机偏移避免同时重试)
    const baseDelay = Math.pow(2, wrapper.retryCount) * 1000;
    const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1); // ±25%
    const delay = Math.min(baseDelay + jitter, 30000); // 最长 30s

    console.log('[WatcherManager] Watcher "' + key + '" will reconnect in ' + Math.round(delay) + 'ms (attempt ' + (wrapper.retryCount + 1) + '/' + maxRetries + ') - ' + reason);

    // 设置新的重连定时器
    this.retryTimers[key] = setTimeout(() => {
      try {
        delete this.retryTimers[key];

        // 关闭旧连接
        if (wrapper.watcher && typeof wrapper.watcher.close === 'function') {
          try {
            wrapper.watcher.close();
          } catch (e) {}
        }

        // 重新创建
        const newWatcher = wrapper.creator();
        wrapper.watcher = newWatcher;
        wrapper.retryCount++;
        wrapper.active = true;

        console.log('[WatcherManager] Watcher "' + key + '" reconnected successfully (retry ' + wrapper.retryCount + '/' + maxRetries + ')');

        // 健康衰减：重连成功后 30s 内无新错误，逐步降低 retryCount
        wrapper.healthTimer = setTimeout(() => {
          if (wrapper.retryCount > 0 && this.watchers[key]) {
            const decayed = Math.max(0, wrapper.retryCount - 1);
            console.log('[WatcherManager] Watcher "' + key + '" health decay: retryCount ' + wrapper.retryCount + ' → ' + decayed);
            wrapper.retryCount = decayed;
            // 如果还有计数，继续衰减
            if (decayed > 0) {
              wrapper.healthTimer = setTimeout(() => {
                if (wrapper.retryCount > 0 && this.watchers[key]) {
                  wrapper.retryCount = Math.max(0, wrapper.retryCount - 1);
                  console.log('[WatcherManager] Watcher "' + key + '" health decay: retryCount → ' + wrapper.retryCount);
                }
              }, 30000);
            }
          }
        }, 30000);
      } catch (error) {
        console.error('[WatcherManager] Failed to reconnect watcher "' + key + '":', error);
        // 继续尝试重连
        this.autoReconnect(key, 'reconnect attempt failed, retrying');
      }
    }, delay);
  }

  /**
   * 获取监听
   * @param {string} key - 监听标识
   */
  get(key) {
    return this.watchers[key];
  }

  /**
   * 销毁监听
   * @param {string} key - 监听标识
   */
  destroy(key) {
    const wrapper = this.watchers[key];
    if (wrapper) {
      wrapper.close();
    }
  }

  /**
   * 销毁所有页面级监听
   */
  destroyAll() {
    const keys = Object.keys(this.watchers);
    keys.forEach(key => {
      this.destroy(key);
    });
    console.log('[WatcherManager] Destroyed all ' + keys.length + ' watchers');
  }

  /**
   * 创建全局监听（登录后启动，退出登录停止）
   * @param {Function} creator - 监听创建函数
   */
  createGlobal(creator) {
    if (typeof creator !== 'function') {
      console.error('[WatcherManager] creator must be a function');
      return null;
    }

    try {
      const watcher = creator();
      this.globalWatchers.push({
        watcher,
        close: () => {
          if (watcher && typeof watcher.close === 'function') {
            watcher.close();
          }
        }
      });
      console.log('[WatcherManager] Created global watcher');
      return watcher;
    } catch (error) {
      console.error('[WatcherManager] Failed to create global watcher:', error);
      return null;
    }
  }

  /**
   * 销毁所有全局监听
   */
  destroyGlobals() {
    this.globalWatchers.forEach(item => {
      if (item && typeof item.close === 'function') {
        try {
          item.close();
        } catch (error) {
          console.error('[WatcherManager] Failed to close global watcher:', error);
        }
      }
    });
    this.globalWatchers = [];
    console.log('[WatcherManager] Destroyed all global watchers');
  }

  /**
   * 获取监听统计信息
   */
  getStats() {
    return {
      pageWatchers: Object.keys(this.watchers).length,
      globalWatchers: this.globalWatchers.length,
      totalWatchers: Object.keys(this.watchers).length + this.globalWatchers.length,
      reconnectingWatchers: Object.keys(this.retryTimers).length,
      creatingWatchers: this.creatingWatchers.size
    };
  }

  /**
   * 打印统计信息
   */
  printStats() {
    const stats = this.getStats();
    console.log('[WatcherManager] Stats:', stats);
  }
}

// 单例模式
const watcherManager = new WatcherManager();

export default watcherManager;
