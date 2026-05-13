/**
 * 监听生命周期 Mixin
 * 在 Page 中混入此 mixin，自动管理监听的启停
 * 
 * 使用方式：
 * import WatcherMixin from './watcher-mixin';
 * 
 * Page({
 *   ...WatcherMixin,
 *   onLoad() {
 *     this.addWatcher(() => db.collection('...').watch(...));
 *   }
 * })
 */

export const WatcherMixin = {
  onShow() {
    // 页面显示时启动所有监听
    if (typeof this.startWatchers === 'function') {
      this.startWatchers();
    }
  },

  onHide() {
    // 页面隐藏时停止所有监听
    if (typeof this.stopWatchers === 'function') {
      this.stopWatchers();
    }
  },

  onUnload() {
    // 页面卸载时销毁所有监听
    if (typeof this.destroyWatchers === 'function') {
      this.destroyWatchers();
    }
  },

  /**
   * 启动所有监听
   */
  startWatchers() {
    const watchers = this.data.watchers || [];
    
    watchers.forEach((wrapper, index) => {
      if (!wrapper.active && wrapper.creator) {
        wrapper.watcher = wrapper.creator();
        wrapper.active = true;
      }
    });

    if (watchers.length > 0) {
      console.log(`[WatcherMixin] Started ${watchers.length} watchers`);
    }
  },

  /**
   * 停止所有监听（保持监听对象，下次启动时重用）
   */
  stopWatchers() {
    const watchers = this.data.watchers || [];
    
    watchers.forEach((wrapper) => {
      if (wrapper.active && wrapper.watcher && typeof wrapper.watcher.close === 'function') {
        try {
          wrapper.watcher.close();
          wrapper.active = false;
        } catch (error) {
          console.error('[WatcherMixin] Failed to stop watcher:', error);
        }
      }
    });

    if (watchers.length > 0) {
      console.log(`[WatcherMixin] Stopped ${watchers.length} watchers`);
    }
  },

  /**
   * 销毁所有监听（清空监听对象）
   */
  destroyWatchers() {
    this.stopWatchers();
    this.setData({ watchers: [] });
    console.log('[WatcherMixin] Destroyed all watchers');
  },

  /**
   * 添加监听
   * @param {Function} creator - 监听创建函数，应返回 watch 实例
   */
  addWatcher(creator) {
    if (typeof creator !== 'function') {
      console.error('[WatcherMixin] creator must be a function');
      return;
    }

    const watchers = this.data.watchers || [];
    watchers.push({
      creator,
      watcher: null,
      active: false
    });

    this.setData({ watchers });
    console.log(`[WatcherMixin] Added watcher, total: ${watchers.length}`);
  }
};

export default WatcherMixin;
