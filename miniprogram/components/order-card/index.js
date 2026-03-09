const STATUS_MAP = {
  pending: "待支付",
  paid: "待发货",
  shipped: "待收货",
  completed: "已完成",
  canceled: "已取消"
};

Component({
  properties: {
    order: {
      type: Object,
      value: {}
    }
  },
  data: {
    statusText: ""
  },
  observers: {
    order(order) {
      const statusText = STATUS_MAP[order.status] || "";
      this.setData({
        statusText
      });
    }
  },
  methods: {
    onTap() {
      this.triggerEvent("tap", { order: this.data.order });
    }
  }
});