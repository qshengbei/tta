/**
 * 订单列表实时监听适配层
 * 
 * 使用方式：
 * import { OrderListener } from '../../utils/orderListener';
 * 
 * // 在 page 中
 * this.orderListener = new OrderListener(this);
 * this.orderListener.start();
 */

import { watch, unwatch } from './realtimeListener';

const LISTENER_KEY = 'orders_watch';

class OrderListener {
  constructor(page) {
    this.page = page;
    this.listenerKey = LISTENER_KEY;
    this.isActive = false;
    this.isCreatingWatch = false;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.reconnectDelay = 2000;
    this.pageVisible = false;
    this.listenOptions = null;
  }

  /**
   * 启动订单监听
   * @param {Object} options - 监听选项
   */
  start(options = {}) {
    if (this.isActive) {
      console.warn('[OrderListener] 订单监听已启动');
      return;
    }

    if (this.isCreatingWatch) {
      console.warn('[OrderListener] 正在创建监听器，跳过');
      return;
    }

    const openid = wx.getStorageSync('openid');
    if (!openid) {
      console.error('[OrderListener] 获取 openid 失败');
      return;
    }

    this.listenOptions = options;
    const whereQuery = this.buildWhereQuery(openid, options);
    
    const callback = (changes, meta) => {
      this.handleOrderChanges(changes, meta);
    };

    try {
      this.isCreatingWatch = true;

      const listenerState = watch(this.listenerKey, whereQuery, callback, {
        collectionName: 'orders',
        dedupeKey: '_id',
        maxReconnectAttempts: this.maxReconnectAttempts,
        reconnectDelay: this.reconnectDelay
      });

      this.isActive = true;
      this.isCreatingWatch = false;
      this.reconnectAttempts = 0;
      console.log('[OrderListener] 订单监听已启动');
    } catch (error) {
      this.isCreatingWatch = false;
      console.error('[OrderListener] 启动失败:', error);
    }
  }

  /**
   * 构建查询条件
   */
  buildWhereQuery(openid, options = {}) {
    const query = { openid };

    if (options.status && options.status !== 'all') {
      query.status = options.status;
    }

    return query;
  }

  /**
   * 处理订单变化
   */
  handleOrderChanges(changes, meta) {
    if (!this.pageVisible) {
      console.log('[OrderListener] 页面已隐藏，跳过更新');
      return;
    }

    const { added, modified, removed } = changes;

    let { orders, originalOrders } = this.page.data;
    orders = orders || [];
    originalOrders = originalOrders || [];

    let hasChanges = false;

    if (added && added.length > 0) {
      added.forEach((order) => {
        const existIndex = originalOrders.findIndex(o => o._id === order._id);
        if (existIndex === -1) {
          originalOrders.unshift(order);
          hasChanges = true;
          console.log('[OrderListener] 新增订单:', order.orderNumber);
        }
      });
    }

    if (modified && modified.length > 0) {
      modified.forEach((order) => {
        const existIndex = originalOrders.findIndex(o => o._id === order._id);
        if (existIndex !== -1) {
          const oldOrder = originalOrders[existIndex];
          
          if (oldOrder.status !== order.status) {
            console.log(`[OrderListener] 订单状态变更: ${order.orderNumber} ${oldOrder.status} -> ${order.status}`);
          }

          originalOrders[existIndex] = {
            ...oldOrder,
            ...order,
            localFlag: oldOrder.localFlag
          };
          hasChanges = true;
        }
      });
    }

    if (removed && removed.length > 0) {
      removed.forEach((order) => {
        const existIndex = originalOrders.findIndex(o => o._id === order._id);
        if (existIndex !== -1) {
          console.log('[OrderListener] 订单删除:', order.orderNumber);
          originalOrders.splice(existIndex, 1);
          hasChanges = true;
        }
      });
    }

    if (hasChanges) {
      this.page.setData({
        originalOrders,
        orders: this.applyFilterAndSort(originalOrders)
      });

      console.log('[OrderListener] 订单列表已更新，共', originalOrders.length, '条');
    }
  }

  /**
   * 应用筛选和排序
   */
  applyFilterAndSort(orders) {
    const { selectedStatus = 'all' } = this.page.data;
    
    let filtered = orders;

    if (selectedStatus !== 'all') {
      filtered = orders.filter(o => o.status === selectedStatus);
    }

    filtered.sort((a, b) => {
      const timeA = new Date(a.createdAt || a.createTime).getTime();
      const timeB = new Date(b.createdAt || b.createTime).getTime();
      return timeB - timeA;
    });

    return filtered;
  }

  /**
   * 停止监听
   */
  stop() {
    if (!this.isActive && !this.isCreatingWatch) {
      console.warn('[OrderListener] 订单监听未启动');
      return;
    }

    if (this.reconnectTimer) {
      console.log('[OrderListener] 取消待执行的重连任务');
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    unwatch(this.listenerKey);
    this.isActive = false;
    this.isCreatingWatch = false;
    console.log('[OrderListener] 订单监听已停止');
  }

  /**
   * 安排重连任务
   */
  scheduleReconnect(options = {}) {
    if (!this.pageVisible) {
      console.log('[OrderListener] 页面已隐藏，跳过重连');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[OrderListener] 已达到最大重连次数，不再重连');
      return;
    }

    if (this.reconnectTimer) {
      console.log('[OrderListener] 已有待执行的重连任务，跳过');
      return;
    }

    const delay = this.reconnectDelay * (this.reconnectAttempts + 1);
    console.log(`[OrderListener] ${delay}ms 后尝试第 ${this.reconnectAttempts + 1} 次重连`);

    this.reconnectTimer = setTimeout(() => {
      console.log(`[OrderListener] 执行第 ${this.reconnectAttempts + 1} 次重连`);
      this.reconnectAttempts++;
      this.reconnectTimer = null;
      this.start(options || this.listenOptions);
    }, delay);
  }

  /**
   * 设置页面可见性
   */
  setPageVisible(visible) {
    this.pageVisible = visible;
    if (!visible) {
      this.stop();
    }
  }

  /**
   * 获取监听状态
   */
  getStatus() {
    return {
      isActive: this.isActive,
      isCreatingWatch: this.isCreatingWatch,
      listenerKey: this.listenerKey,
      reconnectAttempts: this.reconnectAttempts,
      pageVisible: this.pageVisible
    };
  }
}

export { OrderListener };
