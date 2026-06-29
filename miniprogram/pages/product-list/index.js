// pages/product-list/index.js
import productListBehavior from '../../utils/productListBehavior';

const db = wx.cloud.database();
const _ = db.command;

Page({
  behaviors: [productListBehavior],

  data: {
    pageTitle: '商品列表',
    originalProducts: [],
    sortType: 'default',
    priceSortOrder: 'asc',
    emptyText: '暂无商品',
    // 页面参数
    pageType: 'all', // all, search, category, series, type, filter
    keyword: '',
    categoryId: '',
    typeId: '',
    categories: [],
    inStock: null,
    // 滚动相关
    isTopBarVisible: true,
    scrollDirection: 'up',
    // 标记
    needsRefresh: false,
    hasNavigatedAway: false,
    pageVisible: false,
    pendingRefresh: false,
    // 搜索模式
    isSearchMode: false,
    scrollTop: 0
  },

  // ========== Behavior 要求实现的方法 ==========

  _getCacheKey() {
    const { pageType, categoryId, typeId, sortType } = this.data;
    const suffix = sortType !== 'default' ? `_${sortType}` : '';
    switch (pageType) {
      case 'category':
      case 'series':
        return `products_series_${categoryId || ''}${suffix}`;
      case 'type':
        return `products_type_${typeId || ''}${suffix}`;
      default:
        return `products_all${suffix}`;
    }
  },

  _getCursorField() {
    if (this.data.sortType === 'price') return 'price';
    return this.data.sortType === 'new' ? 'createdAtTs' : '_id';
  },

  _getSortOrder() {
    if (this.data.sortType === 'price') return this.data.priceSortOrder;
    return 'desc';
  },

  _buildDbQuery() {
    return this.buildQueryParams(this._catIds || []);
  },

  _shouldUseCache() {
    const { keyword, categories, inStock, sortType } = this.data;
    // 价格排序总是直接从数据库加载
    if (sortType === 'price') return false;
    if (keyword && keyword.trim() !== '') return false;
    if (categories && categories.length > 0) return false;
    if (inStock !== null) return false;
    return true;
  },

  _getPageSize() {
    return 18;
  },

  _productMatchesCurrentQuery(product, changeType) {
    if (changeType === 'remove') return true;
    if (changeType === 'modify' && product.status === 'off') return true;
    if (product.status !== 'on') return false;
    if (product.isDeleted === true) return false;

    const { pageType, keyword, categoryId, typeId, categories, inStock } = this.data;

    if (categories && categories.length > 0) {
      if (!product.typeId || !categories.includes(product.typeId)) return false;
    }
    if (inStock !== null) {
      const check = inStock ? (product.stock > 0) : (product.stock <= 0);
      if (!check) return false;
    }
    if ((pageType === 'category' || pageType === 'series') && categoryId) {
      if (product.categoryId !== categoryId) return false;
    }
    if (pageType === 'type' && typeId) {
      const ids = this._catIds || [];
      if (ids.length > 0 && product.typeId && !ids.includes(product.typeId)) return false;
    }
    if (keyword && keyword.trim() !== '') {
      const kw = keyword.trim().toLowerCase();
      return (product.name || '').toLowerCase().includes(kw);
    }
    return true;
  },

  // 根据排序类型找到商品应该插入的位置（与 Behavior 逻辑一致）
  _findInsertIndex(product, list) {
    const { sortType, priceSortOrder } = this.data;
    
    if (sortType === 'price') {
      // 价格排序：根据价格方向插入
      for (let i = 0; i < list.length; i++) {
        const diff = priceSortOrder === 'asc' 
          ? (product.price || 0) - (list[i].price || 0)
          : (list[i].price || 0) - (product.price || 0);
        if (diff < 0) return i;
      }
      return list.length;
    }
    
    if (sortType === 'new') {
      // 新品排序：按创建时间降序
      const ts = product.createdAtTs || (product.createdAt ? new Date(product.createdAt).getTime() : 0);
      for (let i = 0; i < list.length; i++) {
        const t = list[i].createdAtTs || (list[i].createdAt ? new Date(list[i].createdAt).getTime() : 0);
        if (ts > t) return i;
      }
      return list.length;
    }
    
    // 综合排序：按 _id 降序（最新的在前）
    for (let i = 0; i < list.length; i++) {
      if (product._id > list[i]._id) return i;
    }
    return list.length;
  },

  // ========== 生命周期 ==========

  async onLoad(options) {
    const { type, keyword, categoryId, typeId, categories, inStock } = options;

    const decodedKeyword = keyword ? decodeURIComponent(keyword) : '';
    const cats = categories ? categories.split(',') : [];
    const stock = inStock !== undefined ? inStock === 'true' : null;

    const hasSearchOrFilter = (decodedKeyword && decodedKeyword.trim() !== '') ||
                              (cats.length > 0) || (stock !== null);

    // type 页面预取子分类 ID（_buildDbQuery 中需要同步获取）
    if (type === 'type' && typeId) {
      try {
        const res = await db.collection('product_types').where({ parentId: typeId }).get();
        this._catIds = [typeId, ...res.data.map(item => item._id)];
      } catch (e) {
        this._catIds = [typeId];
      }
    } else {
      this._catIds = [];
    }

    this.setData({
      pageType: type || 'all',
      keyword: decodedKeyword,
      categoryId: categoryId || '',
      typeId: typeId || '',
      categories: cats,
      inStock: stock,
      isSearchMode: hasSearchOrFilter
    });

    await this.setPageTitle();
    await this._initProductPage();
  },

  onShow() {
    console.log('[商品列表页面] onShow 被调用, __pageId:', this.__pageId);
    const wasHidden = !this.data.pageVisible;
    this.setData({ pageVisible: true });

    // 设置页面可见性（必须调用，否则全局监听器不会通知页面更新）
    if (this.__pageId) {
      console.log('[商品列表页面] 设置页面可见性:', this.__pageId);
      const watcher = require('../../utils/globalProductWatcher').getGlobalProductWatcher();
      watcher.setPageVisible(this.__pageId, true);
    } else {
      console.log('[商品列表页面] __pageId 不存在');
    }

    // 从其他页面返回时，保持滚动位置和数据，不做任何处理
    if (this.data.hasNavigatedAway) {
      console.log('[商品列表页面] 从其他页面返回，保持滚动位置和数据');
      this.setData({ hasNavigatedAway: false });
      return;
    }

    if (this.data.needsRefresh) {
      console.log('[商品列表页面] 强制刷新');
      this.setData({ needsRefresh: false });
      this._loadProducts(true);
      return;
    }

    if (this.data.pendingRefresh) {
      console.log('[商品列表页面] 有挂起的变更');
      this.setData({ pendingRefresh: false });
      this._loadProducts(true);
    }

    if (this.data.products.length === 0) {
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
      this.setData({ isTopBarVisible: true });
    }
  },

  onHide() {
    this.setData({
      hasNavigatedAway: true,
      pageVisible: false
    });
    
    // 设置页面不可见性（必须调用，否则全局监听器会继续通知页面更新）
    if (this.__pageId) {
      const watcher = require('../../utils/globalProductWatcher').getGlobalProductWatcher();
      watcher.setPageVisible(this.__pageId, false);
    }
  },

  // ========== 搜索/筛选 ==========

  handleSearch(e) {
    const { keyword } = e.detail;
    if (!keyword || !keyword.trim()) {
      this.setData({ keyword: '', isSearchMode: false });
      this.setPageTitle();
      this._loadProducts(true);
    } else {
      this.setData({ keyword, isSearchMode: true });
      this.setPageTitle();
      this._loadProducts(true);
    }
  },

  handleFilter(e) {
    const { category, inStock } = e.detail;
    const hasFilter = (category && category.length > 0) || inStock !== null;

    if (!hasFilter) {
      this.setData({ categories: [], inStock: null, isSearchMode: false });
      this.setPageTitle();
      this._loadProducts(true);
    } else {
      this.setData({
        categories: category || [],
        inStock: inStock !== undefined ? inStock : null,
        isSearchMode: true
      });
      this.setPageTitle();
      this._loadProducts(true);
    }
  },

  // ========== 排序 ==========

  setSortType(e) {
    const { type } = e.currentTarget.dataset;
    let { sortType, priceSortOrder } = this.data;

    if (type === 'price') {
      const newOrder = sortType === 'price' ? (priceSortOrder === 'asc' ? 'desc' : 'asc') : 'asc';
      
      // 先检查是否有搜索/筛选条件（筛选条件下直接查询数据库）
      const { keyword, categories, inStock } = this.data;
      const hasFilters = (keyword && keyword.trim() !== '') || 
                         (categories && categories.length > 0) || 
                         inStock !== null;
      
      if (hasFilters) {
        // 有筛选条件，从数据库重新加载
        console.log('[商品列表页面] 价格排序 + 筛选条件，直接查询数据库');
        this.setData({ sortType: type, priceSortOrder: newOrder, scrollTop: 0, products: [], showSkeleton: true });
        this._loadProducts(true);
        setTimeout(() => this.setData({ scrollTop: Math.random() * 0.01 }), 100);
        return;
      }
      
      // 无筛选条件，使用缓存数据排序
      this.setData({ priceSortOrder: newOrder });
      const sorted = this._getSortedArray(this.data.products, 'price');
      this.setData({ sortType: type, scrollTop: 0, products: sorted });
      setTimeout(() => this.setData({ scrollTop: Math.random() * 0.01 }), 100);
      return;
    }

    // 综合 ←→ 新品：DB 端重查，各自独立缓存
    if (type !== sortType) {
      this.setData({ sortType: type, scrollTop: 0, products: [], showSkeleton: true });
      this._loadProducts(true);
    }

    // scroll-view 相同值不触发，用随机数重置
    setTimeout(() => this.setData({ scrollTop: Math.random() * 0.01 }), 100);
  },

  // 覆写 behavior 的 _loadMoreProducts：非价格排序走 behavior 默认逻辑，价格排序加 re-sort
  _loadMoreProducts() {
    if (this.data.loadingMore || !this.data.hasMore || this.data.loading) return;
    if (this.data.sortType !== 'price') {
      // 综合/新品：behavior 默认，DB 加载后 products 正确追加即可
      this._loadProducts(false);
      return;
    }
    // 价格排序：加载更多后重排
    this._loadProducts(false).then(() => {
      this.applySort();
    });
  },

  applySort() {
    const { sortType } = this.data;
    // 使用 Behavior 提供的排序方法，确保与实时更新逻辑一致
    const sorted = this._getSortedArray(this.data.products, sortType);
    this.setData({ products: sorted });
  },

  // ========== 查询构建 ==========

  buildQueryParams(categoryIds = []) {
    const { pageType, keyword, categoryId, categories, inStock } = this.data;
    const params = { isDeleted: false, status: 'on' };

    if (pageType === 'category' || pageType === 'series') {
      if (categoryId) params.categoryId = categoryId;
      if (categories && categories.length > 0) params.typeId = _.in(categories);
    } else if (pageType === 'type' && categoryIds.length > 0) {
      if (categories && categories.length > 0) {
        const intersected = categoryIds.filter(id => categories.includes(id));
        params.typeId = intersected.length > 0 ? _.in(intersected) : null;
        if (!params.typeId) params._id = '___NO_RESULTS___';
      } else {
        params.typeId = _.in(categoryIds);
      }
    } else if (categories && categories.length > 0) {
      params.typeId = _.in(categories);
    }

    if (keyword && keyword.trim() !== '') {
      params.name = db.RegExp({
        regexp: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        options: 'i'
      });
    }

    if (inStock !== null) {
      params.stock = inStock ? _.gt(0) : _.lte(0);
    }

    return params;
  },

  // ========== 页面辅助 ==========

  getCategoryName(categoryId) {
    return db.collection('category').doc(categoryId).get()
      .then(res => res.data ? res.data.name : '系列商品')
      .catch(() => '系列商品');
  },

  getTypeName(typeId) {
    return db.collection('product_types').doc(typeId).get()
      .then(res => res.data ? res.data.name : '分类商品')
      .catch(() => '分类商品');
  },

  async setPageTitle() {
    const { pageType, keyword, categoryId, typeId, categories, inStock } = this.data;
    let title = '商品列表';

    const hasSearch = keyword && keyword.trim() !== '';
    const hasFilter = (categories && categories.length > 0) || (inStock !== null);

    if (hasSearch && hasFilter) {
      title = '搜索和筛选结果';
    } else if (hasSearch) {
      title = '搜索结果';
    } else if (hasFilter) {
      title = '筛选结果';
    } else {
      switch (pageType) {
        case 'category':
        case 'series':
          title = categoryId ? await this.getCategoryName(categoryId) : '系列商品';
          break;
        case 'type':
          title = typeId ? await this.getTypeName(typeId) : '分类商品';
          break;
        default:
          title = '全部商品';
      }
    }

    this.setData({ pageTitle: title });
    wx.setNavigationBarTitle({ title });
  },

  goToProductDetail(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/product-detail/index?id=${id}` });
  },

  goBack() {
    wx.navigateBack();
  },

  goToAddProduct() {
    const { typeId } = this.data;
    wx.navigateTo({ url: `/pages/admin/product-publish/index?typeId=${typeId}` });
  },

  // 下架商品
  下架商品(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认下架',
      content: '确定要下架这个商品吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            const result = await wx.cloud.callFunction({
              name: 'updateProduct',
              data: { productId: id, updateData: { status: 'off', updatedAt: new Date() } }
            });
            if (result.result?.success) {
              wx.showToast({ title: '商品下架成功', icon: 'success' });
              this._loadProducts(true);
            } else {
              wx.showToast({ title: '下架商品失败', icon: 'none' });
            }
          } catch (err) {
            wx.showToast({ title: '下架商品失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 上架商品
  上架商品(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认上架',
      content: '确定要上架这个商品吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            const result = await wx.cloud.callFunction({
              name: 'updateProduct',
              data: { productId: id, updateData: { status: 'on', updatedAt: new Date() } }
            });
            if (result.result?.success) {
              wx.showToast({ title: '商品上架成功', icon: 'success' });
              this._loadProducts(true);
            } else {
              wx.showToast({ title: '上架商品失败', icon: 'none' });
            }
          } catch (err) {
            wx.showToast({ title: '上架商品失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 编辑商品
  编辑商品(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/admin/product-publish/index?id=${id}` });
  },

  // ========== 滚动手势 ==========

  onPageScroll(e) {
    const current = e.scrollTop;
    const last = this._lastScrollTop || 0;
    const dir = current > last ? 'up' : 'down';

    if (current <= 10) {
      if (!this.data.isTopBarVisible) {
        this.setData({ isTopBarVisible: true, scrollDirection: 'down' });
      }
      this._lastScrollTop = current;
      return;
    }

    if (Math.abs(current - last) > 30) {
      if (dir === 'up' && this.data.isTopBarVisible && current > 100) {
        this.setData({ isTopBarVisible: false, scrollDirection: 'up' });
      } else if (dir === 'down' && !this.data.isTopBarVisible) {
        this.setData({ isTopBarVisible: true, scrollDirection: 'down' });
      }
    }

    this._lastScrollTop = current;
  }
});
