// pages/products-list/index.js
const db = wx.cloud.database();
const _ = db.command;

Page({
  data: {
    pageTitle: '商品列表',
    products: [],
    originalProducts: [],
    loading: false,
    sortType: 'default',
    priceSortOrder: 'asc',
    emptyText: '暂无商品',
    // 页面参数
    pageType: 'all', // all, search, category, series
    keyword: '',
    categoryId: '',
    typeId: ''
  },

  onLoad(options) {
    // 解析页面参数
    const { type, keyword, categoryId, typeId, categories, inStock } = options;
    
    this.setData({
      pageType: type || 'all',
      keyword: keyword || '',
      categoryId: categoryId || '',
      typeId: typeId || '',
      categories: categories ? categories.split(',') : [],
      inStock: inStock !== undefined ? inStock === 'true' : null
    });

    // 设置页面标题
    this.setPageTitle();
    
    // 加载商品数据
    this.loadProducts();
  },

  setPageTitle() {
    const { pageType, keyword, categoryId, typeId } = this.data;
    let title = '商品列表';
    
    switch (pageType) {
      case 'search':
        title = `搜索: ${keyword}`;
        break;
      case 'category':
      case 'series':
        title = '系列商品';
        // 可以根据categoryId获取系列名称
        break;
      case 'type':
        title = '分类商品';
        // 可以根据typeId获取分类名称
        break;
      case 'filter':
        title = '筛选结果';
        break;
      default:
        title = '全部商品';
    }
    
    this.setData({ pageTitle: title });
    wx.setNavigationBarTitle({ title });
  },

  loadProducts() {
    const { pageType, keyword, categoryId, typeId, categories, inStock } = this.data;
    this.setData({ loading: true });
    
    let query = db.collection('products');
    
    // 根据页面类型构建查询
    switch (pageType) {
      case 'search':
        query = query.where({
          name: _.regex({ regex: keyword, options: 'i' })
        });
        break;
      case 'category':
      case 'series':
        // categoryId 是系列id
        query = query.where({
          categoryId: categoryId
        });
        break;
      case 'type':
        // typeId 是分类id
        query = query.where({
          typeId: typeId
        });
        break;
      case 'filter':
        // 处理筛选条件
        if (categories && categories.length > 0) {
          query = query.where({
            typeId: _.in(categories)
          });
        }
        if (inStock !== null) {
          query = query.where({
            stock: inStock ? _.gt(0) : _.lte(0)
          });
        }
        break;
    }
    
    query.get().then(res => {
      const products = res.data || [];
      this.setData({
        products,
        originalProducts: [...products],
        loading: false
      });
      
      // 应用排序
      this.applySort();
    }).catch(err => {
      console.error('加载商品失败:', err);
      this.setData({ loading: false });
    });
  },

  setSortType(e) {
    const { type } = e.currentTarget.dataset;
    let { sortType, priceSortOrder } = this.data;
    
    if (type === 'price') {
      // 切换价格排序方向
      if (sortType === 'price') {
        priceSortOrder = priceSortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        priceSortOrder = 'asc';
      }
    }
    
    this.setData({ sortType: type, priceSortOrder });
    this.applySort();
  },

  applySort() {
    const { sortType, priceSortOrder, originalProducts } = this.data;
    let sortedProducts = [...originalProducts];
    
    switch (sortType) {
      case 'new':
        // 按创建时间排序，最新的在前
        sortedProducts.sort((a, b) => {
          const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return timeB - timeA;
        });
        break;
      case 'price':
        // 按价格排序
        sortedProducts.sort((a, b) => {
          const priceA = a.price || 0;
          const priceB = b.price || 0;
          return priceSortOrder === 'asc' ? priceA - priceB : priceB - priceA;
        });
        break;
      default:
        // 综合排序（默认顺序）
        break;
    }
    
    this.setData({ products: sortedProducts });
  },

  handleSearch(e) {
    const { keyword } = e.detail;
    wx.navigateTo({
      url: `/pages/products-list/index?type=search&keyword=${encodeURIComponent(keyword)}`
    });
  },

  handleFilter(e) {
    const { category, inStock } = e.detail;
    // 这里可以根据筛选条件重新加载商品
    // 目前简化处理，实际项目中可能需要更复杂的筛选逻辑
    this.loadProducts();
  },

  goToProductDetail(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/product-detail/index?id=${id}`
    });
  },

  goBack() {
    wx.navigateBack();
  }
});