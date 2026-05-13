/**
 * 网络连接管理器
 * 
 * 功能：
 * - 监听网络状态变化
 * - 自动处理离线/在线转换
 * - 管理重连队列
 */

class NetworkManager {
  constructor() {
    this.isOnline = true;
    this.reconnectQueue = [];
    this.callbacks = [];
    this.init();
  }

  init() {
    // 监听网络状态变化
    wx.onNetworkStatusChange((res) => {
      console.log(`[NetworkManager] 网络状态: ${res.isConnected ? '在线' : '离线'}`);
      
      const wasOnline = this.isOnline;
      this.isOnline = res.isConnected;

      // 通知所有监听者
      this.callbacks.forEach(cb => {
        try {
          cb(res.isConnected, wasOnline);
        } catch (error) {
          console.error('[NetworkManager] 回调执行失败:', error);
        }
      });

      // 从离线恢复到在线
      if (!wasOnline && this.isOnline) {
        console.log('[NetworkManager] 网络恢复，处理重连队列');
        this.processReconnectQueue();
      }
    });

    // 初始化网络状态
    wx.getNetworkType({
      success: (res) => {
        this.isOnline = res.networkType !== 'none';
        console.log(`[NetworkManager] 初始网络类型: ${res.networkType}`);
      }
    });
  }

  /**
   * 检查是否在线
   */
  isConnected() {
    return this.isOnline;
  }

  /**
   * 获取当前网络类型
   */
  getNetworkType(callback) {
    wx.getNetworkType({
      success: (res) => {
        callback(null, res.networkType);
      },
      fail: (error) => {
        callback(error);
      }
    });
  }

  /**
   * 监听网络状态变化
   */
  onChange(callback) {
    this.callbacks.push(callback);
    
    // 返回移除函数
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index !== -1) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  /**
   * 添加重连任务
   */
  addReconnectTask(task) {
    this.reconnectQueue.push(task);
    console.log(`[NetworkManager] 添加重连任务，队列长度: ${this.reconnectQueue.length}`);
  }

  /**
   * 处理重连队列
   */
  async processReconnectQueue() {
    console.log(`[NetworkManager] 处理重连队列，任务数: ${this.reconnectQueue.length}`);
    
    while (this.reconnectQueue.length > 0) {
      const task = this.reconnectQueue.shift();
      try {
        if (typeof task === 'function') {
          await task();
        }
      } catch (error) {
        console.error('[NetworkManager] 重连任务失败:', error);
      }
    }
  }
}

export const networkManager = new NetworkManager();
