Page({
  data: {
    orderId: '',
    orderNumber: ''
  },

  onLoad(options) {
    // 从参数中获取订单ID和订单编号
    const { orderId, orderNumber } = options;
    this.setData({
      orderId: orderId || '',
      orderNumber: orderNumber || ''
    });
  },

  // 查看订单
  viewOrder() {
    if (this.data.orderId) {
      // 跳转到订单详情页面
      wx.navigateTo({
        url: `/pages/order-detail/index?id=${this.data.orderId}`
      });
    } else {
      // 跳转到订单列表页面
      wx.redirectTo({
        url: '/pages/order-list/index'
      });
    }
  },

  // 再去逛逛
  goShopping() {
    // 跳转到首页
    wx.switchTab({
      url: '/pages/home/index'
    });
  }
});