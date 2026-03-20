// pages/product-list/index.js
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
    pageType: 'all', // all, search, category, series, type, filter
    keyword: '',
    categoryId: '',
    typeId: '',
    categories: [],
    inStock: null
  },

  async onLoad(options) {
    // 解析页面参数
    const { type, keyword, categoryId, typeId, categories, inStock } = options;
    
    // 对关键词进行 URL 解码
    const decodedKeyword = keyword ? decodeURIComponent(keyword) : '';
    
    this.setData({
      pageType: type || 'all',
      keyword: decodedKeyword,
      categoryId: categoryId || '',
      typeId: typeId || '',
      categories: categories ? categories.split(',') : [],
      inStock: inStock !== undefined ? inStock === 'true' : null
    });

    // 设置页面标题
    await this.setPageTitle();
    
    // 加载商品数据
    this.loadProducts();
  },

  // 获取系列名称
  getCategoryName(categoryId) {
    return new Promise((resolve, reject) => {
      db.collection('category').doc(categoryId).get().then(res => {
        if (res.data) {
          resolve(res.data.name);
        } else {
          resolve('系列商品');
        }
      }).catch(err => {
        console.error('获取系列名称失败:', err);
        resolve('系列商品');
      });
    });
  },

  // 获取分类名称
  getTypeName(typeId) {
    return new Promise((resolve, reject) => {
      db.collection('product_types').doc(typeId).get().then(res => {
        if (res.data) {
          resolve(res.data.name);
        } else {
          resolve('分类商品');
        }
      }).catch(err => {
        console.error('获取分类名称失败:', err);
        resolve('分类商品');
      });
    });
  },

  // 设置页面标题
  async setPageTitle() {
    const { pageType, keyword, categoryId, typeId, categories, inStock } = this.data;
    let title = '商品列表';
    
    // 检查是否有搜索条件
    const hasSearch = keyword && keyword.trim() !== '';
    // 检查是否有筛选条件
    const hasFilter = (categories && categories.length > 0) || (inStock !== null);
    
    if (hasSearch && hasFilter) {
      // 既有搜索条件也有筛选条件
      title = '搜索和筛选结果';
    } else if (hasSearch) {
      // 只有搜索条件
      title = '搜索结果';
    } else if (hasFilter) {
      // 只有筛选条件
      title = '筛选结果';
    } else {
      // 没有搜索和筛选条件
      switch (pageType) {
        case 'category':
        case 'series':
          // 根据categoryId获取系列名称
          if (categoryId) {
            title = await this.getCategoryName(categoryId);
          } else {
            title = '系列商品';
          }
          break;
        case 'type':
          // 根据typeId获取分类名称
          if (typeId) {
            title = await this.getTypeName(typeId);
          } else {
            title = '分类商品';
          }
          break;
        default:
          title = '全部商品';
      }
    }
    
    this.setData({ pageTitle: title });
    wx.setNavigationBarTitle({ title });
  },

  loadProducts() {
    const { pageType, keyword, categoryId, typeId, categories, inStock } = this.data;
    console.log('loadProducts called with:', {
      pageType,
      keyword,
      categoryId,
      typeId,
      categories,
      inStock
    });
    this.setData({ loading: true });
    
    // 处理分类查询，获取一级分类及其所有二级分类的ID
    if (pageType === 'type' && typeId) {
      // 查询该一级分类下的所有二级分类
      db.collection('product_types').where({ parentId: typeId }).get().then(res => {
        const subCategoryIds = res.data.map(item => item._id);
        // 合并一级分类ID和所有二级分类ID
        const allCategoryIds = [typeId, ...subCategoryIds];
        console.log('All category IDs:', allCategoryIds);
        
        // 构建查询
        this.buildQuery(allCategoryIds, pageType, keyword, categoryId, categories, inStock);
      }).catch(err => {
        console.error('获取二级分类失败:', err);
        // 失败时只查询一级分类
        this.buildQuery([typeId], pageType, keyword, categoryId, categories, inStock);
      });
    } else {
      // 其他页面类型直接构建查询
      this.buildQuery([], pageType, keyword, categoryId, categories, inStock);
    }
  },

  // 构建查询并加载商品
  buildQuery(categoryIds, pageType, keyword, categoryId, categories, inStock) {
    let query = db.collection('products');
    
    // 首先根据页面类型和相应的 ID 设置基础查询条件
    if (pageType === 'category' || pageType === 'series') {
      // categoryId 是系列id
      if (categoryId) {
        query = query.where({
          categoryId: categoryId
        });
      }
    } else if (pageType === 'type' && categoryIds.length > 0) {
      // typeId 是分类id，查询一级分类及其所有二级分类的商品
      query = query.where({
        typeId: _.in(categoryIds)
      });
    }
    
    // 然后叠加搜索条件（适用于所有页面类型）
    if (keyword && keyword.trim() !== '') {
      query = query.where({
        name: db.RegExp({ regexp: keyword, options: 'i' })
      });
    }
    
    // 最后叠加筛选条件（适用于所有页面类型）
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
    
    query.get().then(res => {
      console.log('Query result:', res);
      const products = res.data || [];
      console.log('Found products:', products);
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
        // 综合排序，恢复原始顺序
        sortedProducts = [...originalProducts];
        break;
    }
    
    this.setData({ products: sortedProducts });
  },

  handleSearch(e) {
    const { keyword } = e.detail;
    // 在当前页面刷新搜索结果，而不是跳转新页面
    this.setData({
      keyword: keyword
    });
    this.setPageTitle();
    this.loadProducts();
  },

  handleFilter(e) {
    const { category, inStock } = e.detail;
    // 在当前页面刷新筛选结果，而不是跳转新页面
    this.setData({
      categories: category || [],
      inStock: inStock
    });
    this.setPageTitle();
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