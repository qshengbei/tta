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
    wx.redirectTo({
      url: '/pages/order-list/index?status=paid'
    });
  },

  // 再去逛逛
  goShopping() {
    wx.switchTab({
      url: '/pages/home/index'
    });
  }
});