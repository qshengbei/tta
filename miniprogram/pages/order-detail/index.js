import { getCollection } from "../../utils/cloud";

Page({
  data: {
    order: null,
    loading: true,
    error: false,
    errorMessage: ""
  },

  onLoad(options) {
    const { id } = options;
    if (id) {
      this.fetchOrderDetail(id);
    } else {
      this.setData({
        loading: false,
        error: true,
        errorMessage: "订单ID不存在"
      });
    }
  },

  fetchOrderDetail(orderId) {
    this.setData({ loading: true, error: false, errorMessage: "" });
    
    const orders = getCollection("orders");
    orders
      .doc(orderId)
      .get()
      .then((res) => {
        const order = res.data;
        if (order) {
          this.setData({
            order,
            loading: false
          });
        } else {
          this.setData({
            loading: false,
            error: true,
            errorMessage: "订单不存在"
          });
        }
      })
      .catch((err) => {
        console.error("获取订单详情失败", err);
        this.setData({
          loading: false,
          error: true,
          errorMessage: "获取订单详情失败"
        });
      });
  },

  goBack() {
    wx.navigateBack();
  }
});
