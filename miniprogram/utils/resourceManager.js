/**
 * 资源管理器 - 处理监听、定时器、缓存等生命周期
 */

class ResourceManager {
  constructor() {
    this.resources = new Map();
  }

  /**
   * 注册资源
   * @param {string} name - 资源名称
   * @param {*} resource - 资源对象
   * @param {Function} cleanup - 清理函数
   */
  register(name, resource, cleanup) {
    if (this.resources.has(name)) {
      console.warn(`[ResourceManager] 资源 ${name} 已存在，将被覆盖`);
      this.unload(name);
    }

    this.resources.set(name, {
      resource,
      cleanup,
      createdAt: Date.now()
    });

    console.log(`[ResourceManager] 资源已注册: ${name}`);
  }

  /**
   * 卸载单个资源
   */
  unload(name) {
    const item = this.resources.get(name);
    if (!item) {
      console.warn(`[ResourceManager] 资源 ${name} 不存在`);
      return;
    }

    try {
      if (typeof item.cleanup === 'function') {
        item.cleanup();
      }
      this.resources.delete(name);
      console.log(`[ResourceManager] 资源已卸载: ${name}`);
    } catch (error) {
      console.error(`[ResourceManager] 卸载 ${name} 失败:`, error);
    }
  }

  /**
   * 卸载所有资源
   */
  unloadAll() {
    const names = Array.from(this.resources.keys());
    
    for (const name of names) {
      this.unload(name);
    }

    console.log(`[ResourceManager] 已卸载所有 ${names.length} 个资源`);
  }

  /**
   * 获取资源
   */
  get(name) {
    const item = this.resources.get(name);
    return item ? item.resource : null;
  }

  /**
   * 检查资源是否存在
   */
  has(name) {
    return this.resources.has(name);
  }

  /**
   * 获取资源使用统计
   */
  getStats() {
    const stats = {
      totalResources: this.resources.size,
      details: []
    };

    for (const [name, item] of this.resources.entries()) {
      stats.details.push({
        name,
        age: Date.now() - item.createdAt,
        type: item.resource ? Object.prototype.toString.call(item.resource) : 'unknown'
      });
    }

    return stats;
  }

  /**
   * 打印资源统计信息
   */
  printStats() {
    const stats = this.getStats();
    console.log('[ResourceManager] 资源统计:', stats);
  }
}

export const resourceManager = new ResourceManager();
