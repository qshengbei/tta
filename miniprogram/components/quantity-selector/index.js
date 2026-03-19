Component({
  properties: {
    quantity: {
      type: [Number, String],
      value: 1
    },
    maxQuantity: {
      type: Number,
      value: 99
    },
    productId: {
      type: String,
      value: ''
    }
  },
  data: {},
  methods: {
    decreaseQuantity(e) {
      const currentQuantity = typeof this.data.quantity === 'number' ? this.data.quantity : parseInt(this.data.quantity) || 1;
      if (currentQuantity > 1) {
        const newQuantity = currentQuantity - 1;
        this.setData({ quantity: newQuantity });
        this.triggerEvent('quantityChange', { quantity: newQuantity, productId: this.data.productId });
      }
    },
    increaseQuantity(e) {
      const currentQuantity = typeof this.data.quantity === 'number' ? this.data.quantity : parseInt(this.data.quantity) || 1;
      if (currentQuantity < this.data.maxQuantity) {
        const newQuantity = currentQuantity + 1;
        this.setData({ quantity: newQuantity });
        this.triggerEvent('quantityChange', { quantity: newQuantity, productId: this.data.productId });
      } else {
        // 只有当库存不是默认值99时才显示提示
        if (this.data.maxQuantity !== 99) {
          wx.showToast({
            title: '已达库存上限',
            icon: 'none'
          });
        }
      }
    },
    // 处理数量变化（实时更新，不验证库存）
    onQuantityChange(e) {
      const inputValue = e.detail.value;
      // 直接使用输入值，不进行验证，支持删除所有数字
      let quantity = inputValue === '' ? '' : parseInt(inputValue) || '';
      this.setData({ quantity });
      // 不立即触发事件，等待blur事件
    },
    // 输入完成后验证库存限制
    onQuantityBlur(e) {
      const inputValue = e.detail.value;
      let quantity = parseInt(inputValue) || 1;
      
      // 检查库存限制
      if (quantity < 1) {
        quantity = 1;
      } else if (quantity > this.data.maxQuantity) {
        quantity = this.data.maxQuantity;
        // 只有当库存不是默认值99时才显示库存上限提示
        if (this.data.maxQuantity !== 99) {
          wx.showToast({
            title: '已达库存上限',
            icon: 'none'
          });
        }
      }
      
      this.setData({ quantity });
      this.triggerEvent('quantityChange', { quantity: quantity, productId: this.data.productId });
    }
  }
});