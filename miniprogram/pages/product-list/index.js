Page({
  data: {
    products: [
      {
        _id: '1',
        name: 'Aura 克莱因蓝发圈',
        price: 28,
        stock: 100,
        coverImage: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=blue%20hair%20scrunchie%20accessory&image_size=square'
      },
      {
        _id: '2',
        name: 'Aura 玫粉发圈',
        price: 32,
        stock: 50,
        coverImage: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=pink%20hair%20scrunchie%20accessory&image_size=square'
      },
      {
        _id: '3',
        name: 'Aura 蒂芙尼蓝发圈',
        price: 30,
        stock: 0,
        coverImage: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=tiffany%20blue%20hair%20scrunchie%20accessory&image_size=square'
      }
    ]
  },
  onLoad() {
    // 页面加载时的逻辑
  }
});