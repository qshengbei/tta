/**
 * 统一监听管理类
 * 提供页面级和全局级监听的统一管理
 */

class WatcherManager {
  constructor() {
    this.watchers = {};        // 页面级监听
    this.globalWatchers = [];  // 全局级监听
    console.log('[WatcherManager] Initialized');
  }

  /**
   * 创建页面级监听
   * @param {string} key - 监听唯一标识
   * @param {Function} creator - 监听创建函数
   * @returns {Object} 返回监听包装对象
   */
  create(key, creator) {
    // 避免重复创建
    if (this.watchers[key]) {
      console.warn(`[WatcherManager] Watcher "${key}" already exists`);
      return this.watchers[key];
    }

    if (typeof creator !== 'function') {
      console.error('[WatcherManager] creator must be a function');
      return null;
    }

    try {
      const watcher = creator();
      const wrapper = {
        watcher,
        key,
        active: true,
        close: () => {
          if (wrapper.active && wrapper.watcher) {
            if (typeof wrapper.watcher.close === 'function') {
              wrapper.watcher.close();
            }
            wrapper.active = false;
            delete this.watchers[key];
            console.log(`[WatcherManager] Closed watcher: ${key}`);
          }
        }
      };

      this.watchers[key] = wrapper;
      console.log(`[WatcherManager] Created watcher: ${key}`);
      return wrapper;
    } catch (error) {
      console.error(`[WatcherManager] Failed to create watcher: ${key}`, error);
      return null;
    }
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
    console.log(`[WatcherManager] Destroyed all ${keys.length} watchers`);
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
      totalWatchers: Object.keys(this.watchers).length + this.globalWatchers.length
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
