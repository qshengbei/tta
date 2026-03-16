import { getCollection } from "../../utils/cloud";

Page({
  data: {
    orders: [],
    loading: true,
    error: false,
    errorMessage: ""
  },

  onLoad() {
    this.fetchOrders();
  },

  onShow() {
    // 页面显示时重新加载订单列表
    this.fetchOrders();
  },

  fetchOrders() {
    this.setData({ loading: true, error: false, errorMessage: "" });
    
    // 模拟订单数据
    // 实际项目中，这里应该从数据库中获取订单列表
    const mockOrders = [
      {
        _id: "1",
        orderNumber: "20260312001",
        status: "pending",
        statusText: "待支付",
        product: {
          coverImage: "https://example.com/image1.jpg",
          name: "Aura 克莱因蓝发圈",
          price: 28
        },
        quantity: 1,
        totalPrice: 28,
        createdAt: new Date().toISOString()
      },
      {
        _id: "2",
        orderNumber: "20260312002",
        status: "paid",
        statusText: "已支付",
        product: {
          coverImage: "https://example.com/image2.jpg",
          name: "Aura 蒂芙尼蓝发夹",
          price: 32
        },
        quantity: 2,
        totalPrice: 64,
        createdAt: new Date().toISOString()
      }
    ];
    
    // 模拟网络请求延迟
    setTimeout(() => {
      this.setData({
        orders: mockOrders,
        loading: false
      });
    }, 1000);
  },

  reload() {
    this.fetchOrders();
  },

  goToHome() {
    wx.switchTab({
      url: "/pages/home/index"
    });
  },

  viewOrderDetail(e) {
    const orderId = e.currentTarget.dataset.orderId;
    // 跳转到订单详情页面
    wx.navigateTo({
      url: `/pages/order-detail/index?id=${orderId}`
    });
  }
});