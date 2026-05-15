/**
 * 实时监听使用示例
 * 展示如何在小程序页面中使用优化后的监听系统
 */

/* =============================================
   方式一：使用 PageListener（推荐）
   ============================================= */

import { createPageListener } from './listenerIntegration';

Page({
  data: {
    orders: [],
    messages: []
  },

  onLoad(options) {
    // 创建页面监听器（使用页面路径作为 pageId）
    this.pageListener = createPageListener('pages/order-list/index');
    
    // 初始化监听
    this.initListeners();
  },

  initListeners() {
    const openid = wx.getStorageSync('openid');
    
    // 监听订单数据变化
    this.pageListener.create(
      'orders',
      {
        collection: 'orders',
        where: { _openid: openid },
        bufferTime: 150, // 150ms 缓冲，合并快速变化
        maxBufferSize: 20
      },
      (changes, meta) => {
        console.log('订单数据变化:', changes);
        this.handleOrderChanges(changes);
      }
    );

    // 监听消息数据变化（更快的响应）
    this.pageListener.create(
      'messages',
      {
        collection: 'messages',
        where: { userId: openid },
        bufferTime: 50, // 消息需要更快响应
        maxBufferSize: 10
      },
      (changes, meta) => {
        console.log('消息数据变化:', changes);
        this.handleMessageChanges(changes);
      }
    );
  },

  handleOrderChanges(changes) {
    const { added, modified, removed } = changes;
    let { orders } = this.data;
    
    // 处理新增订单
    if (added && added.length > 0) {
      orders = [...added, ...orders];
    }
    
    // 处理修改订单
    if (modified && modified.length > 0) {
      const modifiedMap = new Map(modified.map(o => [o._id, o]));
      orders = orders.map(o => modifiedMap.has(o._id) ? { ...o, ...modifiedMap.get(o._id) } : o);
    }
    
    // 处理删除订单
    if (removed && removed.length > 0) {
      const removedIds = new Set(removed.map(o => o._id));
      orders = orders.filter(o => !removedIds.has(o._id));
    }
    
    this.setData({ orders });
  },

  handleMessageChanges(changes) {
    // 处理消息变化
    const { added } = changes;
    if (added && added.length > 0) {
      wx.showToast({
        title: `收到 ${added.length} 条新消息`,
        icon: 'none'
      });
      
      this.setData({
        messages: [...this.data.messages, ...added]
      });
    }
  },

  onShow() {
    // 页面显示时恢复监听
    this.pageListener.onShow();
  },

  onHide() {
    // 页面隐藏时暂停监听
    this.pageListener.onHide();
  },

  onUnload() {
    // 页面卸载时销毁所有监听
    this.pageListener.onUnload();
  }
});

/* =============================================
   方式二：直接使用 realtimeListener
   ============================================= */

import { watch, unwatch, pause, resume, printStats } from './realtimeListener';

Page({
  onLoad() {
    const openid = wx.getStorageSync('openid');
    
    // 启动监听
    this.orderListener = watch(
      'my_orders',
      { _openid: openid },
      (changes, meta) => {
        console.log('订单变化:', changes);
        if (meta.isBatch) {
          console.log('这是批量更新，合并了', meta.batchSize, '个事件');
        }
      },
      {
        collectionName: 'orders',
        bufferTime: 200,
        maxBufferSize: 30
      }
    );
  },

  onShow() {
    resume('my_orders');
  },

  onHide() {
    pause('my_orders');
  },

  onUnload() {
    unwatch('my_orders');
  },

  // 调试时打印统计
  onDebugStats() {
    printStats();
  }
});

/* =============================================
   方式三：使用全局监听
   ============================================= */

import { globalListenerManager } from './listenerIntegration';

// 在 app.js 中初始化全局监听
App({
  onLaunch() {
    const openid = wx.getStorageSync('openid');
    
    // 监听全局通知（用户登录后）
    if (openid) {
      globalListenerManager.create(
        'global_notifications',
        {
          collection: 'notifications',
          where: { userId: openid },
          bufferTime: 100
        },
        (changes) => {
          // 更新全局通知数量
          this.updateNotificationBadge(changes);
        }
      );
    }
  },

  updateNotificationBadge(changes) {
    // 更新 TabBar 角标等
  },

  onLogout() {
    // 退出登录时清理所有全局监听
    globalListenerManager.destroyAll();
  }
});
