/**
 * 实时监听集成模块
 * 统一管理 realtimeListener 和 watcherManager
 * 提供便捷的 API 供页面使用
 */

import { watch, unwatch, pause, resume, printStats } from './realtimeListener';
import watcherManager from './watcherManager';

/**
 * 页面级监听包装器
 * 自动处理页面生命周期
 */
class PageListener {
  constructor(pageId) {
    this.pageId = pageId;
    this.listeners = new Map();
    this.isPageActive = true;
  }

  /**
   * 创建监听
   * @param {string} key - 监听唯一标识
   * @param {Object} options - 监听配置
   * @param {Function} callback - 数据变化回调
   * @param {Object} [watcherOptions] - watcher 选项
   */
  create(key, options, callback, watcherOptions = {}) {
    if (this.listeners.has(key)) {
      console.warn(`[PageListener] Listener "${key}" already exists for page "${this.pageId}"`);
      return this.listeners.get(key);
    }

    const { collection, where, ...config } = options;

    // 创建监听器
    const listenerKey = `${this.pageId}_${key}`;
    const listener = watch(
      listenerKey,
      where,
      callback,
      {
        collectionName: collection,
        ...config,
        ...watcherOptions
      }
    );

    // 注册到 watcherManager
    const wrapper = watcherManager.create(
      listenerKey,
      () => listener,
      this.pageId
    );

    this.listeners.set(key, { listener, wrapper, listenerKey });
    return listener;
  }

  /**
   * 暂停单个监听
   */
  pause(key) {
    const item = this.listeners.get(key);
    if (item) {
      pause(item.listenerKey);
    }
  }

  /**
   * 恢复单个监听
   */
  resume(key) {
    const item = this.listeners.get(key);
    if (item) {
      resume(item.listenerKey);
    }
  }

  /**
   * 销毁单个监听
   */
  destroy(key) {
    const item = this.listeners.get(key);
    if (item) {
      unwatch(item.listenerKey);
      watcherManager.destroy(item.listenerKey);
      this.listeners.delete(key);
    }
  }

  /**
   * 页面显示时调用
   */
  onShow() {
    if (!this.isPageActive) {
      this.isPageActive = true;
      // 恢复该页面的所有监听
      watcherManager.resumeByPage(this.pageId);
      console.log(`[PageListener] Page "${this.pageId}" shown, resumed listeners`);
    }
  }

  /**
   * 页面隐藏时调用
   */
  onHide() {
    this.isPageActive = false;
    // 暂停该页面的所有监听
    watcherManager.pauseByPage(this.pageId);
    console.log(`[PageListener] Page "${this.pageId}" hidden, paused listeners`);
  }

  /**
   * 页面卸载时调用
   */
  onUnload() {
    // 销毁该页面的所有监听
    this.listeners.forEach((_, key) => this.destroy(key));
    watcherManager.destroyByPage(this.pageId);
    console.log(`[PageListener] Page "${this.pageId}" unloaded, destroyed all listeners`);
  }

  /**
   * 获取该页面的监听数量
   */
  getCount() {
    return this.listeners.size;
  }
}

/**
 * 全局监听管理器
 * 管理应用级别的监听
 */
class GlobalListenerManager {
  constructor() {
    this.listeners = new Map();
  }

  /**
   * 创建全局监听
   */
  create(key, options, callback) {
    if (this.listeners.has(key)) {
      console.warn(`[GlobalListenerManager] Listener "${key}" already exists`);
      return this.listeners.get(key);
    }

    const { collection, where, ...config } = options;

    const listener = watch(
      key,
      where,
      callback,
      {
        collectionName: collection,
        ...config
      }
    );

    watcherManager.createGlobal(() => listener, key);
    this.listeners.set(key, listener);
    return listener;
  }

  /**
   * 销毁全局监听
   */
  destroy(key) {
    if (this.listeners.has(key)) {
      unwatch(key);
      this.listeners.delete(key);
    }
  }

  /**
   * 销毁所有全局监听
   */
  destroyAll() {
    this.listeners.forEach((_, key) => this.destroy(key));
    watcherManager.destroyGlobals();
  }
}

// 创建全局实例
const globalListenerManager = new GlobalListenerManager();

/**
 * 创建页面监听器
 * @param {string} pageId - 页面唯一标识（建议使用页面路径）
 */
function createPageListener(pageId) {
  return new PageListener(pageId);
}

/**
 * 打印系统统计信息
 */
function printSystemStats() {
  console.group('[ListenerIntegration] System Stats');
  printStats();
  watcherManager.printStats();
  console.groupEnd();
}

/**
 * 清理所有监听（退出登录时调用）
 */
function cleanupAll() {
  console.log('[ListenerIntegration] Cleaning up all listeners');
  watcherManager.destroyAll();
  watcherManager.destroyGlobals();
}

export {
  PageListener,
  GlobalListenerManager,
  globalListenerManager,
  createPageListener,
  printSystemStats,
  cleanupAll
};
