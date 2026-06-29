// pages/category-products/index.js
import productListBehavior from '../../utils/productListBehavior';

const db = wx.cloud.database();

Page({
  behaviors: [productListBehavior],

  data: {
    categoryName: '',
    categoryId: ''
  },

  // ========== Behavior 要求实现的方法 ==========

  _getCacheKey() {
    return `products_type_${this.data.categoryId || ''}`;
  },

  _buildDbQuery() {
    const { categoryId } = this.data;
    return {
      typeId: categoryId,
      isDeleted: false
    };
  },

  _shouldUseCache() {
    return true; // 分类视图稳定，使用缓存
  },

  _getPageSize() {
    return 18;
  },

  _productMatchesCurrentQuery(product, changeType) {
    if (changeType === 'remove') return true;
    if (changeType === 'modify' && product.status === 'off') return true;
    if (product.status !== 'on') return false;
    if (product.isDeleted === true) return false;
    return product.typeId === this.data.categoryId;
  },

  _findInsertIndex(product, list) {
    // 按 updatedAt desc
    const time = new Date(product.updatedAt || product.createdAt || 0).getTime();
    for (let i = 0; i < list.length; i++) {
      const t = new Date(list[i].updatedAt || list[i].createdAt || 0).getTime();
      if (time > t) return i;
    }
    return list.length;
  },

  // ========== 生命周期 ==========

  async onLoad(options) {
    if (!options.id) return;

    const categoryId = options.id;
    this.setData({ categoryId });

    // 加载分类名称
    this.loadCategoryData(categoryId);

    // 初始化 Behavior（缓存加载 + 全局监听订阅）
    await this._initProductPage();
  },

  onShow() {
    // 页面显示时刷新分类名称（可能有修改）
    if (this.data.categoryId && !this.data.categoryName) {
      this.loadCategoryData(this.data.categoryId);
    }
  },

  onPullDownRefresh() {
    if (this.data.categoryId) {
      this._loadProducts(true);
    }
    wx.stopPullDownRefresh();
  },

  // ========== 页面特有方法 ==========

  /**
   * 加载分类名称
   */
  loadCategoryData(categoryId) {
    db.collection('product_types').doc(categoryId).get()
      .then(res => {
        if (res.data) {
          this.setData({ categoryName: res.data.name });
        }
      })
      .catch(err => {
        console.error('[分类商品] 加载分类名称失败:', err);
      });
  },

  /**
   * 跳转到商品详情页
   */
  goToProductDetail(e) {
    const productId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/product-detail/index?id=${productId}`
    });
  },

  /**
   * 返回上一页
   */
  goBack() {
    wx.navigateBack();
  }
});
