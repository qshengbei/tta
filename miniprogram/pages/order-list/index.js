import { getCollection } from "../../utils/cloud";

Page({
  data: {
    orders: [],
    loading: true,
    error: false,
    errorMessage: "",
    selectedStatus: "all" // 默认显示所有订单
  },

  onLoad(options) {
    // 获取URL参数中的status
    if (options && options.status) {
      this.setData({ selectedStatus: options.status });
    }
    this.fetchOrders();
  },

  onShow() {
    // 页面显示时重新加载订单列表
    this.fetchOrders();
  },

  fetchOrders() {
    this.setData({ loading: true, error: false, errorMessage: "" });
    
    const orders = getCollection("orders");
    let query = orders.orderBy('createdAt', 'desc');
    
    // 根据selectedStatus过滤订单
    if (this.data.selectedStatus !== "all") {
      query = query.where('status', '==', this.data.selectedStatus);
    }
    
    query.get()
      .then((res) => {
        const ordersList = res.data;
        this.setData({
          orders: ordersList,
          loading: false
        });
      })
      .catch((err) => {
        console.error("获取订单列表失败", err);
        this.setData({
          loading: false,
          error: true,
          errorMessage: "获取订单列表失败"
        });
      });
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