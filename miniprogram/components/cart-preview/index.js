// components/cart-preview/index.js
import { getCollection } from "../../utils/cloud";

Component({
  /**
   * 组件的属性列表
   */
  properties: {
    visible: {
      type: Boolean,
      value: false
    }
  },

  /**
   * 组件的初始数据
   */
  data: {
    cartItems: [],
    startX: 0, // 触摸开始位置
    startY: 0, // 触摸开始位置
    deleteWidth: 180, // 删除按钮宽度
    showHint: true // 显示提示文字
  },

  /**
   * 组件的方法列表
   */
  methods: {
    // 关闭弹出层
    close() {
      // 隐藏所有删除按钮
      this.hideDeleteButtons();
      this.triggerEvent('close');
    },

    // 跳转到购物车页面
    goToCart() {
      wx.switchTab({
        url: '/pages/cart/index'
      });
    },

    // 获取购物车商品
    fetchCartItems() {
      const cart = getCollection("cart");
      const products = getCollection("products");
      const openid = wx.getStorageSync('openid') || '';
      
      const query = openid ? cart.where({ _openid: openid, isDelete: false }) : cart.where({ isDelete: false });
      
      query
        .orderBy('updatedAt', 'desc')
        .get()
        .then((res) => {
          let cartItems = res.data || [];
          
          // 过滤掉无效的商品（没有productSnapshot的）
          cartItems = cartItems.filter(item => item.productSnapshot);
          
          // 转换数据格式，使用productSnapshot中的数据
          const productIdSet = new Set(cartItems.map(item => item.productId));
          const productIdArray = Array.from(productIdSet);
          
          // 批量获取商品详情以检查库存
          const productPromises = productIdArray.map(productId => {
            return products.doc(productId).get()
              .then(productRes => productRes.data)
              .catch(() => null);
          });
          
          return Promise.all(productPromises).then(productsData => {
            const productMap = new Map();
            productIdArray.forEach((productId, index) => {
              if (productsData[index]) {
                productMap.set(productId, productsData[index]);
              }
            });
            
            // 转换购物车数据
            cartItems = cartItems.map(item => {
              const product = productMap.get(item.productId);
              let name = item.productSnapshot.name || '';
              let price = item.productSnapshot.price || 0;
              let coverImage = item.productSnapshot.coverImage || '';
              
              if (product) {
                // 从商品集合获取最新数据
                name = product.name || name;
                price = typeof product.price === "number" ? product.price : price;
                coverImage = product.coverImage || coverImage;
              }
              
              return {
                _id: item._id,
                productId: item.productId,
                name: name,
                price: price,
                quantity: item.quantity || 1,
                coverImage: coverImage,
                translateX: 0 // 初始化滑动距离
              };
            });
            
            return cartItems;
          });
        })
        .then((cartItems) => {
          this.setData({
            cartItems
          });
        })
        .catch((err) => {
          console.error('获取购物车商品失败', err);
          this.setData({ cartItems: [] });
        });
    },

    // 触摸开始
    touchStart(e) {
      // 记录触摸开始位置
      this.setData({
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY
      });
      
      // 隐藏其他删除按钮
      this.hideDeleteButtons();
    },

    // 触摸移动
    touchMove(e) {
      const startX = this.data.startX;
      const startY = this.data.startY;
      const moveX = e.touches[0].clientX;
      const moveY = e.touches[0].clientY;
      const deleteWidth = this.data.deleteWidth;
      
      // 计算滑动距离
      const disX = startX - moveX;
      const disY = Math.abs(startY - moveY);
      
      // 只有当水平滑动距离大于垂直滑动距离时，才认为是左滑
      if (disX > 0 && disY < 50) {
        // 左滑
        let translateX = -disX;
        // 限制滑动距离
        if (translateX < -deleteWidth) {
          translateX = -deleteWidth;
        }
        
        // 更新当前商品的滑动距离
        const productId = e.currentTarget.dataset.productId;
        const cartItems = this.data.cartItems.map(item => {
          if (item.productId === productId) {
            return { ...item, translateX };
          }
          return item;
        });
        
        this.setData({ cartItems });
      }
    },

    // 触摸结束
    touchEnd(e) {
      const deleteWidth = this.data.deleteWidth;
      const productId = e.currentTarget.dataset.productId;
      
      // 计算最终滑动距离
      const cartItems = this.data.cartItems.map(item => {
        if (item.productId === productId) {
          let translateX = item.translateX;
          // 如果滑动距离超过删除按钮宽度的一半，则显示删除按钮
          if (translateX < -deleteWidth / 2) {
            translateX = -deleteWidth;
          } else {
            // 否则，恢复原位
            translateX = 0;
          }
          return { ...item, translateX };
        }
        return item;
      });
      
      this.setData({ cartItems });
    },

    // 隐藏所有删除按钮
    hideDeleteButtons() {
      const cartItems = this.data.cartItems.map(item => ({
        ...item,
        translateX: 0
      }));
      this.setData({ cartItems });
    },

    // 删除购物车商品
    deleteCartItem(e) {
      const productId = e.currentTarget.dataset.productId;
      const cart = getCollection("cart");
      
      // 查找对应的购物车商品
      const cartItem = this.data.cartItems.find(item => item.productId === productId);
      if (!cartItem || !cartItem._id) {
        console.error('找不到购物车商品或商品ID不存在');
        return;
      }
      
      console.log('删除购物车商品，ID:', cartItem._id);
      
      // 更新商品的isDelete字段为true（软删除）
      cart.doc(cartItem._id)
        .update({
          data: {
            isDelete: true,
            updatedAt: new Date()
          }
        })
        .then((res) => {
          console.log('删除购物车商品成功', res);
          // 重新获取购物车商品
          this.fetchCartItems();
        })
        .catch((err) => {
          console.error('删除购物车商品失败', err);
        });
    }
  },

  /**
   * 组件生命周期
   */
  lifetimes: {
    // 组件显示时获取购物车商品
    show() {
      if (this.properties.visible) {
        this.fetchCartItems();
        // 5秒后隐藏提示文字
        this.setData({ showHint: true });
        setTimeout(() => {
          this.setData({ showHint: false });
        }, 5000);
      }
    }
  },

  // 监听属性变化
  observers: {
    'visible'(visible) {
      if (visible) {
        this.fetchCartItems();
        // 5秒后隐藏提示文字
        this.setData({ showHint: true });
        setTimeout(() => {
          this.setData({ showHint: false });
        }, 5000);
      }
    }
  }
});
