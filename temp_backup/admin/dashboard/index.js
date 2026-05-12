// pages/admin/dashboard/index.js
const db = wx.cloud.database();
Page({

  /**
   * 页面的初始数据
   */
  data: {
    orderCount: 0, // 总订单数
    productCount: 0, // 商品总数
    userCount: 0, // 用户总数
    totalSales: 0, // 总销售额
    recentOrders: [] // 最近订单
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.loadDashboardData();
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    this.loadDashboardData();
  },

  /**
   * 加载仪表盘数据
   */
  async loadDashboardData() {
    try {
      // 获取订单统计
      await this.getOrderStats();
      // 获取商品统计
      await this.getProductStats();
      // 获取用户统计
      await this.getUserStats();
      // 获取最近订单
      await this.getRecentOrders();
    } catch (err) {
      console.error('加载仪表盘数据失败:', err);
      wx.showToast({
        title: '加载数据失败',
        icon: 'none'
      });
    }
  },

  /**
   * 获取订单统计
   */
  async getOrderStats() {
    try {
      // 获取订单总数
      const orderRes = await db.collection('orders').count();
      this.setData({ orderCount: orderRes.total });
      
      // 计算总销售额
      const salesRes = await db.collection('orders').where({
        status: {
          $in: ['paid', 'shipping', 'delivered', 'completed']
        }
      }).get();
      
      let totalSales = 0;
      salesRes.data.forEach(order => {
        totalSales += order.totalPrice || 0;
      });
      this.setData({ totalSales: totalSales.toFixed(2) });
    } catch (err) {
      console.error('获取订单统计失败:', err);
    }
  },

  /**
   * 获取商品统计
   */
  async getProductStats() {
    try {
      const res = await db.collection('products').count();
      this.setData({ productCount: res.total });
    } catch (err) {
      console.error('获取商品统计失败:', err);
    }
  },

  /**
   * 获取用户统计
   */
  async getUserStats() {
    try {
      const res = await db.collection('users').count();
      this.setData({ userCount: res.total });
    } catch (err) {
      console.error('获取用户统计失败:', err);
    }
  },

  /**
   * 获取最近订单
   */
  async getRecentOrders() {
    try {
      const res = await db.collection('orders')
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get();
      
      const recentOrders = res.data.map(order => {
        // 格式化日期
        const createdAt = new Date(order.createdAt);
        const formattedDate = `${createdAt.getFullYear()}-${(createdAt.getMonth() + 1).toString().padStart(2, '0')}-${createdAt.getDate().toString().padStart(2, '0')} ${createdAt.getHours().toString().padStart(2, '0')}:${createdAt.getMinutes().toString().padStart(2, '0')}`;
        
        // 订单状态文本
        let statusText = '';
        switch (order.status) {
          case 'pending':
            statusText = '待支付';
            break;
          case 'paid':
            statusText = '已支付';
            break;
          case 'shipping':
            statusText = '配送中';
            break;
          case 'delivered':
            statusText = '待收货';
            break;
          case 'completed':
            statusText = '已完成';
            break;
          case 'cancelled':
            statusText = '已取消';
            break;
          case 'refund':
            statusText = '退款/售后';
            break;
          default:
            statusText = '未知状态';
        }
        
        return {
          ...order,
          createdAt: formattedDate,
          statusText
        };
      });
      
      this.setData({ recentOrders });
    } catch (err) {
      console.error('获取最近订单失败:', err);
    }
  },

  /**
   * 跳转到订单管理
   */
  goToOrderManagement() {
    wx.navigateTo({
      url: '/pages/admin/order-manage/index'
    });
  },

  /**
   * 跳转到商品管理
   */
  goToProductManagement() {
    wx.navigateTo({
      url: '/pages/admin/product-manage/index'
    });
  },

  /**
   * 跳转到用户管理
   */
  goToUserManagement() {
    wx.navigateTo({
      url: '/pages/admin/user-manage/index'
    });
  },

  /**
   * 跳转到系统设置
   */ 
  goToSystemSettings() {
    wx.navigateTo({
      url: '/pages/admin/update-settings/index'
    });
  },

  // 跳转到布料管理
  goToClothManagement() {
    wx.navigateTo({
      url: '/pages/admin/cloth-manage/index'
    });
  },

  // 跳转到系列管理
  goToSeriesManagement() {
    wx.navigateTo({
      url: '/pages/admin/series-manage/index'
    });
  },

  // 跳转到商品类型管理
  goToProductTypeManagement() {
    wx.navigateTo({
      url: '/pages/admin/product-type-manage/index'
    });
  },

  // 跳转到通知管理
  goToNotificationManagement() {
    wx.navigateTo({
      url: '/pages/admin/notification-manage/index'
    });
  }
})
