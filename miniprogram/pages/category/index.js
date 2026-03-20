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
    lastTapTime: 0
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.initData()
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    if (!this.data.products.length) {
      this.initData()
    }
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
    wx.showLoading({ title: '加载中...' })
    const { searchKeyword, categories, inStock } = this.data;
    
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
        originalProducts: res.data
      })
      // 应用排序
      this.sortProducts(this.data.sortType);
      wx.hideLoading()
    }).catch(err => {
      console.error('加载商品失败:', err)
      wx.hideLoading()
    })
  },

  /**
   * 加载系列列表
   */
  loadSeries() {
    db.collection('category').get().then(res => {
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
  }
})