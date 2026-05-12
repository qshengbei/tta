// pages/category/index.js
const db = wx.cloud.database()

Page({

  /**
   * 页面的初始数据
   */
  data: {
    activeTab: 'products',
    sortType: 'default',
    priceSortOrder: 'asc', // asc: 升序, desc: 降序
    products: [],
    originalProducts: [],
    seriesList: [],
    level1Categories: [],
    level2Categories: [],
    selectedSeries: null,
    selectedSeriesData: {},
    selectedCategory: null,
    selectedCategoryData: {},
    seriesProducts: [],
    // 搜索和筛选条件
    searchKeyword: '',
    categories: [],
    inStock: null,
    // 用于双击检测
    lastTapTime: 0,
    // 滚动相关
    lastScrollTop: 0,
    isTopBarVisible: true,
    scrollDirection: 'up',
    // 标记是否离开过页面（去商品详情等）
    hasNavigatedAway: false,
    // 是否显示骨架屏
    showSkeleton: true
  },

  // 生成缓存key
  getCacheKey() {
    const { searchKeyword, categories, inStock } = this.data;
    return `category_products_${searchKeyword || ''}_${(categories || []).join('_')}_${inStock}`;
  },

  // 从缓存获取数据
  getCachedProducts() {
    try {
      const cacheKey = this.getCacheKey();
      const cached = wx.getStorageSync(cacheKey);
      if (cached && cached.data && cached.timestamp) {
        // 检查缓存是否过期（10分钟 - 延长缓存时间）
        const now = Date.now();
        if (now - cached.timestamp < 10 * 60 * 1000) {
          return cached.data;
        }
      }
    } catch (e) {
      console.log('读取缓存失败', e);
    }
    return null;
  },

  // 保存到缓存
  setCachedProducts(products) {
    try {
      const cacheKey = this.getCacheKey();
      wx.setStorageSync(cacheKey, {
        data: products,
        timestamp: Date.now()
      });
    } catch (e) {
      console.log('保存缓存失败', e);
    }
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.setData({ showSkeleton: true });
    
    // 优先显示缓存数据
    const cachedProducts = this.getCachedProducts();
    if (cachedProducts && cachedProducts.length > 0) {
      console.log('使用缓存数据');
      this.setData({
        products: cachedProducts,
        originalProducts: [...cachedProducts],
        showSkeleton: false
      });
      this.sortProducts(this.data.sortType);
      // 异步加载最新数据但不显示loading
      this.loadProductsSilently();
      return;
    }
    
    // 没有缓存，正常加载
    this.initData();
  },

  /**
   * 静默加载最新数据（不显示loading，用于缓存更新）
   */
  loadProductsSilently() {
    const { searchKeyword, categories, inStock } = this.data;
    
    let query = db.collection('products').where({ isDeleted: false });
    
    if (searchKeyword && searchKeyword.trim() !== '') {
      query = query.where({ name: db.RegExp({ regexp: searchKeyword, options: 'i' }) });
    }
    
    if (categories && categories.length > 0) {
      query = query.where({ typeId: db.command.in(categories) });
    }
    
    if (inStock !== null) {
      if (inStock) {
        query = query.where({ stock: db.command.gt(0) });
      } else {
        query = query.where({ stock: db.command.lte(0) });
      }
    }
    
    query.get().then(res => {
      const newProducts = res.data;
      // 如果数据有变化，才更新
      if (JSON.stringify(newProducts) !== JSON.stringify(this.data.products)) {
        this.setData({
          products: newProducts,
          originalProducts: newProducts
        });
        this.setCachedProducts(newProducts);
        this.sortProducts(this.data.sortType);
      }
    }).catch(err => {
      console.error('静默加载失败:', err);
    });
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    const { products } = this.data;
    const app = getApp();
    
    console.log('category onShow - products.length:', products.length);
    console.log('category onShow - productsNeedRefresh:', app.globalData.productsNeedRefresh);
    
    // 检查是否需要强制刷新（从后台管理页面返回）
    if (app.globalData.productsNeedRefresh === true) {
      console.log('检测到商品数据变更，强制刷新');
      app.globalData.productsNeedRefresh = false;
      wx.showToast({ title: '刷新中...', icon: 'loading', duration: 800 });
      this.initData();
      return;
    }
    
    // 如果已有数据，保持现状，不做任何操作
    // 微信小程序会自动保存TabBar页面的滚动位置
    if (products.length > 0) {
      console.log('已有数据，保持滚动位置');
      return;
    }
    
    // 双击刷新检测（只有在没有数据时才检查，避免干扰正常切换）
    const now = Date.now();
    const lastTapTime = this.data.lastTapTime || 0;
    
    if (now - lastTapTime < 300) {
      console.log('双击刷新宝贝页面');
      wx.showToast({ title: '刷新中...', icon: 'loading', duration: 800 });
      this.initData();
      this.setData({ lastTapTime: 0 });
      return;
    }
    
    this.setData({ lastTapTime: now });
    
    // 没有数据，初始化
    console.log('没有数据，初始化');
    this.initData();
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    this.setData({ lastScrollTop: 0, isTopBarVisible: true });
  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
    // 移除滚动监听
  },

  /**
   * 初始化数据
   */
  initData() {
    this.loadProducts()
    this.loadSeries()
    this.loadCategories()
  },

  /**
   * 加载商品列表
   */
  loadProducts() {
    const { searchKeyword, categories, inStock, products } = this.data;
    
    // 如果已有数据，不显示 loading，避免空白
    if (products.length === 0) {
      wx.showLoading({ title: '加载中...' })
    }
    
    // 构建查询条件
    let query = db.collection('products').where({ isDeleted: false });
    
    // 应用搜索条件
    if (searchKeyword && searchKeyword.trim() !== '') {
      query = query.where({ name: db.RegExp({ regexp: searchKeyword, options: 'i' }) });
    }
    
    // 应用分类筛选
    if (categories && categories.length > 0) {
      query = query.where({ typeId: db.command.in(categories) });
    }
    
    // 应用库存筛选
    if (inStock !== null) {
      if (inStock) {
        query = query.where({ stock: db.command.gt(0) });
      } else {
        query = query.where({ stock: db.command.lte(0) });
      }
    }
    
    query.get().then(res => {
      this.setData({ 
        products: res.data,
        originalProducts: res.data,
        showSkeleton: false
      })
      // 保存到缓存
      this.setCachedProducts(res.data);
      // 应用排序
      this.sortProducts(this.data.sortType);
      wx.hideLoading()
    }).catch(err => {
      console.error('加载商品失败:', err)
      wx.hideLoading()
      this.setData({ showSkeleton: false });
    })
  },

  /**
   * 加载系列列表
   */
  loadSeries() {
    db.collection('category').where({ status: 'on' }).get().then(res => {
      this.setData({ seriesList: res.data })
    }).catch(err => {
      console.error('加载系列失败:', err)
    })
  },

  /**
   * 加载分类列表
   */
  loadCategories() {
    db.collection('product_types').where({ level: 1 }).get().then(res => {
      this.setData({ level1Categories: res.data })
    }).catch(err => {
      console.error('加载一级分类失败:', err)
    })
  },

  /**
   * 切换标签
   */
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ activeTab: tab })
    
    // 重置相关数据
    if (tab === 'series') {
      this.setData({
        selectedSeries: null,
        selectedSeriesData: {},
        seriesProducts: []
      })
      // 默认选择第一个系列
      if (this.data.seriesList.length > 0) {
        this.selectSeries({ currentTarget: { dataset: { id: this.data.seriesList[0]._id } } })
      }
    } else if (tab === 'categories') {
      this.setData({
        selectedCategory: null,
        selectedCategoryData: {},
        level2Categories: []
      })
      // 默认选择第一个分类
      if (this.data.level1Categories.length > 0) {
        this.selectCategory({ currentTarget: { dataset: { id: this.data.level1Categories[0]._id } } })
      }
    }
  },

  /**
   * 设置排序方式
   */
  setSortType(e) {
    const type = e.currentTarget.dataset.type
    // 如果从其他排序方式切换到价格排序，默认设置为升序
    if (type === 'price' && this.data.sortType !== 'price') {
      this.setData({ 
        sortType: type,
        priceSortOrder: 'asc'
      })
    } else {
      this.setData({ sortType: type })
    }
    // 根据排序类型重新加载商品
    this.sortProducts(type)
  },

  /**
   * 商品排序
   */
  sortProducts(type) {
    let sortedProducts = [...this.data.products]
    switch (type) {
      case 'new':
        sortedProducts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        break
      case 'price':
        if (this.data.priceSortOrder === 'asc') {
          sortedProducts.sort((a, b) => a.price - b.price)
          this.setData({ priceSortOrder: 'desc' })
        } else {
          sortedProducts.sort((a, b) => b.price - a.price)
          this.setData({ priceSortOrder: 'asc' })
        }
        break
      default:
        // 综合排序，恢复原始顺序
        sortedProducts = [...this.data.originalProducts]
        break
    }
    this.setData({ products: sortedProducts })
  },

  /**
   * 处理搜索
   */
  handleSearch(e) {
    // 搜索逻辑已在 search-filter-panel 组件内部处理
  },

  /**
   * 处理筛选
   */
  handleFilter(e) {
    // 筛选逻辑已在 search-filter-panel 组件内部处理
  },


  /**
   * 选择系列
   */
  selectSeries(e) {
    const seriesId = e.currentTarget.dataset.id
    this.setData({
      selectedSeries: seriesId,
      selectedCategory: null,
      level2Categories: []
    })
    
    // 获取系列数据
    const seriesData = this.data.seriesList.find(item => item._id === seriesId)
    this.setData({ selectedSeriesData: seriesData || {} })
    
    // 获取系列下的商品
    db.collection('products').where({ categoryId: seriesId, isDeleted: false }).get().then(res => {
      this.setData({ seriesProducts: res.data })
    }).catch(err => {
      console.error('加载系列商品失败:', err)
    })
  },

  /**
   * 选择分类
   */
  selectCategory(e) {
    const categoryId = e.currentTarget.dataset.id
    this.setData({
      selectedCategory: categoryId,
      selectedSeries: null,
      seriesProducts: []
    })
    
    // 获取分类数据
    const categoryData = this.data.level1Categories.find(item => item._id === categoryId)
    this.setData({ selectedCategoryData: categoryData || {} })
    
    // 获取二级分类
    db.collection('product_types').where({ parentId: categoryId }).get().then(res => {
      this.setData({ level2Categories: res.data })
    }).catch(err => {
      console.error('加载二级分类失败:', err)
    })
  },

  /**
   * 跳转到商品详情页
   */
  goToProductDetail(e) {
    const productId = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/product-detail/index?id=${productId}`
    })
  },

  /**
   * 跳转到分类商品列表页
   */
  goToCategoryProducts(e) {
    const categoryId = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/product-list/index?type=type&typeId=${categoryId}`
    })
  },

  /**
   * 跳转到系列商品列表页
   */
  goToSeriesProducts(e) {
    const seriesId = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/product-list/index?type=series&categoryId=${seriesId}`
    })
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    this.initData()
    wx.stopPullDownRefresh()
  },

  /**
   * 处理搜索事件
   */
  handleSearch(e) {
    const { keyword } = e.detail;
    // 如果当前不是宝贝标签，切换到宝贝标签
    if (this.data.activeTab !== 'products') {
      this.setData({ activeTab: 'products' });
    }
    // 更新搜索条件
    this.setData({ searchKeyword: keyword });
    // 重新加载商品
    this.loadProducts();
  },

  /**
   * 处理筛选事件
   */
  handleFilter(e) {
    const { category, inStock } = e.detail;
    // 如果当前不是宝贝标签，切换到宝贝标签
    if (this.data.activeTab !== 'products') {
      this.setData({ activeTab: 'products' });
    }
    // 更新筛选条件
    this.setData({ 
      categories: category || [], 
      inStock: inStock 
    });
    // 重新加载商品
    this.loadProducts();
  },

  /**
   * 双击tabbar刷新页面
   */
  onTabItemTap(item) {
    // 记录点击时间
    const now = Date.now();
    const lastTapTime = this.data.lastTapTime || 0;
    
    // 如果两次点击时间间隔小于300ms，视为双击
    if (now - lastTapTime < 300) {
      // 刷新宝贝页面
      this.initData();
    }
    
    // 更新最后点击时间
    this.setData({ lastTapTime: now });
  },

  /**
   * 页面相关事件处理函数--监听用户滚动
   */
  onPageScroll(e) {
    const currentScrollTop = e.scrollTop;
    const lastScrollTop = this.data.lastScrollTop;
    const scrollDirection = currentScrollTop > lastScrollTop ? 'up' : 'down';
    
    // 滚动到顶部时，强制显示顶部栏
    if (currentScrollTop <= 10) {
      if (!this.data.isTopBarVisible) {
        this.setData({ 
          isTopBarVisible: true,
          scrollDirection: 'down'
        });
      }
      this.setData({ lastScrollTop: currentScrollTop });
      return;
    }
    
    // 只有在滚动超过一定阈值时才触发显示/隐藏
    if (Math.abs(currentScrollTop - lastScrollTop) > 30) {
      if (scrollDirection === 'up' && this.data.isTopBarVisible && currentScrollTop > 100) {
        // 上滑，隐藏顶部栏（标签和排序选项）
        this.setData({ 
          isTopBarVisible: false,
          scrollDirection: 'up'
        });
      } else if (scrollDirection === 'down' && !this.data.isTopBarVisible) {
        // 下滑，显示顶部栏（标签和排序选项）
        this.setData({ 
          isTopBarVisible: true,
          scrollDirection: 'down'
        });
      }
    }
    
    // 更新上次滚动位置
    this.setData({ lastScrollTop: currentScrollTop });
  }
})