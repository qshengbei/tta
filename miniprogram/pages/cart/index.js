// pages/cart/index.js
Page({
  data: {
    cartItems: [
      {
        productId: '1',
        name: 'Aura 克莱因蓝发圈',
        price: 28,
        quantity: 2,
        stock: 100,
        coverImage: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=blue%20hair%20scrunchie%20accessory&image_size=square'
      },
      {
        productId: '2',
        name: 'Aura 玫粉发圈',
        price: 32,
        quantity: 1,
        stock: 50,
        coverImage: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=pink%20hair%20scrunchie%20accessory&image_size=square'
      }
    ],
    totalPrice: 88
  },
  onLoad(options) {
    this.calculateTotalPrice();
  },
  onQuantityChange(e) {
    const { productId, quantity } = e.detail;
    const cartItems = this.data.cartItems.map(item => {
      if (item.productId === productId) {
        return { ...item, quantity };
      }
      return item;
    });
    this.setData({ cartItems });
    this.calculateTotalPrice();
  },
  calculateTotalPrice() {
    const totalPrice = this.data.cartItems.reduce((total, item) => {
      return total + item.price * item.quantity;
    }, 0);
    this.setData({ totalPrice });
  }
})