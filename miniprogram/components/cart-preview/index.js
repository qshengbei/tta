// components/cart-preview/index.js
import { getCollection } from "../../utils/cloud";

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    }
  },

  data: {
    cartItems: [],
    deleteWidth: 180,
    showHint: true,
    // 分页相关
    loadingMore: false,
    hasMore: true,
    page: 0,
    pageSize: 18
  },

  methods: {
    close() {
      this.hideDeleteButtons();
      this.triggerEvent('close');
    },

    goToCart() {
      wx.switchTab({
        url: '/pages/cart/index'
      });
    },

    // 获取购物车商品（分页加载）
    async fetchCartItems(reset = true) {
      if (reset) {
        console.log('[购物车预览] 重置购物车数据');
        this.setData({ cartItems: [], page: 0, hasMore: true, loadingMore: false });
      }

      if (this.data.loadingMore || !this.data.hasMore) {
        console.log('[购物车预览] 正在加载或没有更多数据，跳过');
        return;
      }

      this.setData({ loadingMore: true });
      console.log('[购物车预览] 开始从数据库获取购物车数据，page:', this.data.page);

      try {
        const cart = getCollection("cart");
        const openid = wx.getStorageSync('openid') || '';
        
        if (!openid) {
          console.log('[购物车预览] openid为空，无法获取购物车数据');
          this.setData({ cartItems: [], loadingMore: false, hasMore: false });
          return;
        }
        
        const page = reset ? 0 : this.data.page;
        const queryCondition = { _openid: openid, isDelete: false };
        console.log('[购物车预览] 查询条件:', queryCondition, ', page:', page, ', pageSize:', this.data.pageSize);
        const query = cart.where(queryCondition);
        const res = await query
          .orderBy('updatedAt', 'desc')
          .skip(page * this.data.pageSize)
          .limit(this.data.pageSize)
          .get();

        let rawItems = (res.data || []).filter(item => item.productSnapshot);
        console.log('[购物车预览] 数据库返回购物车数据，原始长度:', res.data ? res.data.length : 0, '过滤后长度:', rawItems.length);
        
        const hasMore = rawItems.length === this.data.pageSize;
        console.log('[购物车预览] 处理购物车数据，hasMore:', hasMore);
        const processedItems = await this._processCartItems(rawItems);

        console.log('[购物车预览] 购物车数据处理完成，处理后长度:', processedItems.length, '当前缓存长度:', this.data.cartItems.length);
        
        const newCartItems = reset ? processedItems : [...this.data.cartItems, ...processedItems];
        this.setData({
          cartItems: newCartItems,
          loadingMore: false,
          hasMore: hasMore,
          page: page + 1
        });
        console.log('[购物车预览] 购物车数据加载完成，总长度:', newCartItems.length);
      } catch (err) {
        console.error('[购物车预览] 获取购物车商品失败', err);
        this.setData({ loadingMore: false });
      }
    },

    // 加载更多
    loadMoreCartItems() {
      if (this.data.loadingMore || !this.data.hasMore) return;
      this.fetchCartItems(false);
    },

    // 处理购物车商品：批量获取商品最新数据并转换格式
    async _processCartItems(rawItems) {
      if (rawItems.length === 0) return [];

      const products = getCollection("products");
      const productIdSet = new Set(rawItems.map(item => item.productId));
      const productIdArray = Array.from(productIdSet);

      const productsData = await Promise.all(
        productIdArray.map(productId =>
          products.doc(productId).get()
            .then(productRes => productRes.data)
            .catch(() => null)
        )
      );

      const productMap = new Map();
      productIdArray.forEach((productId, index) => {
        if (productsData[index]) {
          productMap.set(productId, productsData[index]);
        }
      });

      return rawItems.map(item => {
        const product = productMap.get(item.productId);
        return {
          _id: item._id,
          productId: item.productId,
          name: product ? (product.name || item.productSnapshot.name || '') : (item.productSnapshot.name || ''),
          price: product && typeof product.price === "number" ? product.price : (item.productSnapshot.price || 0),
          coverImage: product ? (product.coverImage || item.productSnapshot.coverImage || '') : (item.productSnapshot.coverImage || ''),
          quantity: item.quantity || 1,
          translateX: 0
        };
      });
    },

    touchStart(e) {
      this._startX = e.touches[0].clientX;
      this._startY = e.touches[0].clientY;
      // 仅当有已展开的删除按钮时才收起
      if (this.data.cartItems.some(item => item.translateX < 0)) {
        this.hideDeleteButtons();
      }
    },

    touchMove(e) {
      if (this._startX == null) return;
      const startX = this._startX;
      const startY = this._startY;
      const moveX = e.touches[0].clientX;
      const moveY = e.touches[0].clientY;
      const deleteWidth = this.data.deleteWidth;

      const disX = startX - moveX;
      const disY = Math.abs(startY - moveY);

      if (disX > 0 && disY < 50) {
        let translateX = -disX;
        if (translateX < -deleteWidth) {
          translateX = -deleteWidth;
        }

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

    touchEnd(e) {
      const productId = e.currentTarget.dataset.productId;
      const item = this.data.cartItems.find(i => i.productId === productId);

      // 已经是初始状态，无需更新，避免真机滚动时无效setData导致重渲染
      if (!item || item.translateX === 0) return;

      const deleteWidth = this.data.deleteWidth;
      const cartItems = this.data.cartItems.map(item => {
        if (item.productId === productId) {
          return { ...item, translateX: item.translateX < -deleteWidth / 2 ? -deleteWidth : 0 };
        }
        return item;
      });

      this.setData({ cartItems });
    },

    hideDeleteButtons() {
      const hasOpen = this.data.cartItems.some(item => item.translateX < 0);
      if (!hasOpen) return;
      const cartItems = this.data.cartItems.map(item => ({
        ...item,
        translateX: 0
      }));
      this.setData({ cartItems });
    },

    deleteCartItem(e) {
      const productId = e.currentTarget.dataset.productId;
      const cart = getCollection("cart");

      const cartItem = this.data.cartItems.find(item => item.productId === productId);
      if (!cartItem || !cartItem._id) {
        console.error('找不到购物车商品或商品ID不存在');
        wx.showToast({
          title: '删除失败',
          icon: 'none'
        });
        return;
      }

      cart.doc(cartItem._id)
        .update({
          data: {
            isDelete: true,
            updatedAt: new Date()
          }
        })
        .then(() => {
          wx.showToast({
            title: '删除成功',
            icon: 'success',
            duration: 1500
          });
          // 标记购物车数据变更，返回购物车时刷新
          const app = getApp();
          app.globalData.cartDirty = true;
          // 直接从数组中移除该商品，而不是重新加载
          const cartItems = this.data.cartItems.filter(item => item.productId !== productId);
          this.setData({ cartItems });
        })
        .catch((err) => {
          console.error('删除购物车商品失败', err);
          wx.showToast({
            title: '删除失败',
            icon: 'none'
          });
        });
    }
  },

  observers: {
    'visible'(visible) {
      if (visible) {
        console.log('[购物车预览] 弹窗显示，开始加载购物车数据');
        this.fetchCartItems(true);
        this.setData({ showHint: true });
        setTimeout(() => {
          this.setData({ showHint: false });
        }, 5000);
      } else {
        console.log('[购物车预览] 弹窗关闭');
      }
    }
  }
});
