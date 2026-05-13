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

    const openid = wx.getStorageSync('openid');
    if (!openid) {
      console.error('[OrderListener] 获取 openid 失败');
      return;
    }

    const whereQuery = this.buildWhereQuery(openid, options);
    
    const callback = (changes, meta) => {
      this.handleOrderChanges(changes, meta);
    };

    try {
      watch(this.listenerKey, whereQuery, callback, {
        collectionName: 'orders',
        dedupeKey: '_id',
        maxReconnectAttempts: 5
      });

      this.isActive = true;
      console.log('[OrderListener] 订单监听已启动');
    } catch (error) {
      console.error('[OrderListener] 启动失败:', error);
    }
  }

  /**
   * 构建查询条件
   */
  buildWhereQuery(openid, options = {}) {
    const query = { openid };

    // 按状态筛选
    if (options.status && options.status !== 'all') {
      query.status = options.status;
    }

    return query;
  }

  /**
   * 处理订单变化
   */
  handleOrderChanges(changes, meta) {
    const { added, modified, removed } = changes;

    // 获取当前页面数据
    let { orders, originalOrders } = this.page.data;
    orders = orders || [];
    originalOrders = originalOrders || [];

    let hasChanges = false;

    // 处理新增订单
    if (added && added.length > 0) {
      added.forEach((order) => {
        // 检查是否已存在
        const existIndex = originalOrders.findIndex(o => o._id === order._id);
        if (existIndex === -1) {
          originalOrders.unshift(order);
          hasChanges = true;
          console.log('[OrderListener] 新增订单:', order.orderNumber);
        }
      });
    }

    // 处理修改订单
    if (modified && modified.length > 0) {
      modified.forEach((order) => {
        const existIndex = originalOrders.findIndex(o => o._id === order._id);
        if (existIndex !== -1) {
          const oldOrder = originalOrders[existIndex];
          
          // 检查状态是否变化
          if (oldOrder.status !== order.status) {
            console.log(`[OrderListener] 订单状态变更: ${order.orderNumber} ${oldOrder.status} -> ${order.status}`);
          }

          // 合并数据（保留本地字段优先级）
          originalOrders[existIndex] = {
            ...oldOrder,
            ...order,
            // 保留本地字段
            localFlag: oldOrder.localFlag
          };
          hasChanges = true;
        }
      });
    }

    // 处理删除订单
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

    // 如果有变化，更新页面数据
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

    // 按状态筛选
    if (selectedStatus !== 'all') {
      filtered = orders.filter(o => o.status === selectedStatus);
    }

    // 按时间排序（最新的在前）
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
    if (!this.isActive) {
      console.warn('[OrderListener] 订单监听未启动');
      return;
    }

    unwatch(this.listenerKey);
    this.isActive = false;
    console.log('[OrderListener] 订单监听已停止');
  }

  /**
   * 获取监听状态
   */
  getStatus() {
    return {
      isActive: this.isActive,
      listenerKey: this.listenerKey
    };
  }
}

export { OrderListener };
