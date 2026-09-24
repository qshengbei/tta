// components/express-rules-modal/index.js
// 快递计算规则弹层：纯展示组件，只接收已排好序的规则数组，取数与状态由父页面负责
Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    // 规则数组，当前收货地址所属规则由父页面排在第一位并标记 isCurrentRegion
    rules: {
      type: Array,
      value: []
    }
  },

  methods: {
    // 遮罩与"关闭"按钮统一走 close 事件，由父页面关闭
    onClose() {
      this.triggerEvent('close');
    }
  }
});
