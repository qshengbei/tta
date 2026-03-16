Component({
  properties: {
    quantity: {
      type: Number,
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
      if (this.data.quantity > 1) {
        const newQuantity = this.data.quantity - 1;
        this.setData({ quantity: newQuantity });
        this.triggerEvent('quantityChange', { quantity: newQuantity, productId: this.data.productId });
      }
    },
    increaseQuantity(e) {
      if (this.data.quantity < this.data.maxQuantity) {
        const newQuantity = this.data.quantity + 1;
        this.setData({ quantity: newQuantity });
        this.triggerEvent('quantityChange', { quantity: newQuantity, productId: this.data.productId });
      } else {
        wx.showToast({
          title: '已达库存上限',
          icon: 'none'
        });
      }
    },
    onQuantityChange(e) {
      let newQuantity = parseInt(e.detail.value);
      if (isNaN(newQuantity)) newQuantity = 1;
      if (newQuantity < 1) newQuantity = 1;
      if (newQuantity > this.data.maxQuantity) newQuantity = this.data.maxQuantity;
      this.setData({ quantity: newQuantity });
      this.triggerEvent('quantityChange', { quantity: newQuantity, productId: this.data.productId });
    }
  }
});