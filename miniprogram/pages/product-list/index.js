// pages/product-list/index.js
import watcherManager from '../../utils/watcherManager';

const db = wx.cloud.database();
const _ = db.command;

Page({
  data: {
    pageTitle: '商品列表',
    products: [],
    originalProducts: [],
    loading: false,
    showSkeleton: true,
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
    // 标记是否需要刷新
    needsRefresh: false,
    // 标记是否离开过页面（去商品详情等）
    hasNavigatedAway: false,
    // 页面可见性
    pageVisible: false,
    // 是否有待刷新
    pendingRefresh: false
  },

  // 生成缓存key
  getCacheKey() {
    const { pageType, keyword, categoryId, typeId, categories, inStock } = this.data;
    return `products_${pageType}_${keyword || ''}_${categoryId || ''}_${typeId || ''}_${(categories || []).join('_')}_${inStock}`;
  },

  // 从缓存获取数据（永久缓存，由实时监听更新）
  getCachedProducts() {
    try {
      const cacheKey = this.getCacheKey();
      const cached = wx.getStorageSync(cacheKey);
      if (cached && cached.data) {
        return cached.data;
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
      inStock: inStock !== undefined ? inStock === 'true' : null,
      showSkeleton: true
    });

    // 设置页面标题
    await this.setPageTitle();
    
    // 优先显示缓存数据
    const cachedProducts = this.getCachedProducts();
    if (cachedProducts && cachedProducts.length > 0) {
      this.setData({
        products: cachedProducts,
        originalProducts: [...cachedProducts],
        showSkeleton: false
      });
      this.applySort();
    }
    
    // 异步加载最新数据
    this.loadProducts();
    
    // 启动商品列表监听
    console.log('[商品列表页面] 在onLoad中启动监听');
    this.startProductWatch();
  },

  onShow() {
    const wasHidden = !this.data.pageVisible;
    this.setData({ pageVisible: true });
    console.log('[商品列表页面] 页面显示');
    
    if (wasHidden) {
      console.log('商品列表页面-实时监听恢复连接');
    }
    
    // 如果只是从商品详情页返回（hasNavigatedAway 为 true），不刷新数据，保持滚动位置
    // 这个检查放在最前面，确保优先保持滚动位置
    if (this.data.hasNavigatedAway) {
      console.log('从商品详情页返回，保持滚动位置');
      this.setData({ hasNavigatedAway: false });
    }
    
    // 检查页面隐藏期间是否有数据变更
    if (this.data.pendingRefresh) {
      console.log('[商品列表页面] 页面隐藏期间有数据变更，执行刷新');
      this.setData({ pendingRefresh: false });
      this.loadProducts();
    }
    
    // 检查是否需要强制刷新（例如从后台管理页面返回）
    if (this.data.needsRefresh || (getApp().globalData.productsNeedRefresh === true)) {
      console.log('检测到商品数据变更，强制刷新');
      this.setData({ needsRefresh: false });
      getApp().globalData.productsNeedRefresh = false;
      // 显示骨架屏并重新加载
      if (this.data.products.length > 0) {
        // 已有数据，静默更新不显示骨架屏
        this.loadProducts();
      } else {
        this.setData({ showSkeleton: true });
        this.loadProducts();
      }
    }
    
    // 正常页面显示，保持滚动位置
    if (this.data.products.length === 0) {
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
      this.setData({ isTopBarVisible: true });
    }
  },

  onHide() {
    // 标记页面已离开（去商品详情等页面）
    this.setData({ 
      hasNavigatedAway: true,
      pageVisible: false 
    });
    console.log('[商品列表页面] 页面隐藏，暂停监听处理');
    console.log('商品列表页面-实时监听暂停连接');
    // 不销毁监听，保持监听运行，只暂停UI更新
  },

  onUnload() {
    console.log('[商品列表页面] 关闭实时监听');
    console.log('商品列表页面-实时监听关闭');
    watcherManager.destroy('product_list');
  },

  // 启动商品列表监听
  startProductWatch() {
    console.log('商品列表页面-实时监听开启');
    console.log('[商品列表页面] 开始创建商品监听器');
    // 使用watcherManager创建监听
    watcherManager.create('product_list', () => {
      try {
        const db = wx.cloud.database();
        console.log('[商品列表页面] 正在创建products collection监听');
        const watcher = db.collection('products')
          .where({ isDeleted: false })
          .orderBy('createdAt', 'desc')
          .watch({
            onChange: (snapshot) => {
              console.log('[商品列表页面] ==== products collection onChange回调触发! ====');
              console.log('[商品列表页面] snapshot:', snapshot);
              console.log('[商品列表页面] pageVisible:', this.data.pageVisible);
              
              if (!this.data.pageVisible) {
                console.log('[商品列表页面] 页面隐藏，设置pendingRefresh=true');
                this.setData({ pendingRefresh: true });
                return;
              }
              
              console.log('[商品列表页面] 开始处理商品变化');
              // 处理商品变化
              this.handleProductChanges(snapshot);
            },
            onError: (error) => {
              console.error('[商品列表页面] ==== 商品监听失败 ====', error);
              // 自动重连
              watcherManager.autoReconnect('product_list', 'product list watch error');
            }
          });
        console.log('[商品列表页面] products collection监听创建成功:', watcher);
        return watcher;
      } catch (error) {
        console.error('[商品列表页面] 初始化商品监听失败:', error);
        throw error;
      }
    });
  },

  // 处理商品数据变化
  handleProductChanges(snapshot) {
    console.log('[商品列表页面] handleProductChanges被调用');
    
    if (!snapshot.docChanges || snapshot.docChanges.length === 0) {
      console.log('[商品列表页面] docChanges为空或不存在');
      return;
    }
    
    console.log('[商品列表页面] docChanges:', snapshot.docChanges);
    
    // 重新获取商品列表
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
    const { pageType, keyword, categoryId, typeId, categories, inStock, products } = this.data;
    console.log('loadProducts called with:', {
      pageType,
      keyword,
      categoryId,
      typeId,
      categories,
      inStock
    });
    
    // 如果已有数据，不显示 loading，避免空白
    if (products.length === 0) {
      this.setData({ loading: true });
    }
    
    // 处理分类查询，获取一级分类及其所有二级分类的ID
    if (pageType === 'type' && typeId) {
      // 查询该一级分类下的所有二级分类
      db.collection('product_types').where({ parentId: typeId }).get().then(res => {
        const subCategoryIds = res.data.map(item => item._id);
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
      
      // 查看每个商品的status和stock字段
      products.forEach((product, index) => {
        console.log(`Product ${index} status:`, product.status);
        console.log(`Product ${index} stock:`, product.stock);
      });
      
      // 更新页面数据
      this.setData({
        products,
        originalProducts: [...products],
        loading: false,
        showSkeleton: false
      });
      
      // 保存到缓存
      this.setCachedProducts(products);
      
      // 应用排序
      this.applySort();
    }).catch(err => {
      console.error('加载商品失败:', err);
      this.setData({ loading: false, showSkeleton: false });
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
  },

  // 跳转到添加商品页面
  goToAddProduct() {
    const { typeId } = this.data;
    wx.navigateTo({
      url: `/pages/admin/product-publish/index?typeId=${typeId}`
    });
  },

  // 下架商品
  下架商品(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认下架',
      content: '确定要下架这个商品吗？',
      success: (res) => {
        if (res.confirm) {
          // 使用云函数下架商品
          wx.cloud.callFunction({
            name: 'updateProduct',
            data: {
              productId: id,
              updateData: {
                status: 'off',
                updatedAt: new Date()
              }
            }
          }).then(res => {
            console.log('云函数下架结果:', res);
            
            if (res.result && res.result.success) {
              console.log('云函数下架成功');
              wx.showToast({
                title: '商品下架成功',
                icon: 'success'
              });
              
              // 刷新商品列表
              this.loadProducts();
            } else {
              console.error('云函数下架失败:', res.result.error);
              wx.showToast({
                title: '下架商品失败',
                icon: 'none'
              });
            }
          }).catch(err => {
            console.error('调用云函数失败:', err);
            wx.showToast({
              title: '下架商品失败',
              icon: 'none'
            });
          });
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
      success: (res) => {
        if (res.confirm) {
          // 使用云函数上架商品
          wx.cloud.callFunction({
            name: 'updateProduct',
            data: {
              productId: id,
              updateData: {
                status: 'on',
                updatedAt: new Date()
              }
            }
          }).then(res => {
            console.log('云函数上架结果:', res);
            
            if (res.result && res.result.success) {
              console.log('云函数上架成功');
              wx.showToast({
                title: '商品上架成功',
                icon: 'success'
              });
              
              // 刷新商品列表
              this.loadProducts();
            } else {
              console.error('云函数上架失败:', res.result.error);
              wx.showToast({
                title: '上架商品失败',
                icon: 'none'
              });
            }
          }).catch(err => {
            console.error('调用云函数失败:', err);
            wx.showToast({
              title: '上架商品失败',
              icon: 'none'
            });
          });
        }
      }
    });
  },

  // 编辑商品
  编辑商品(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/admin/product-publish/index?id=${id}`
    });
  },

  /**
   * 页面相关事件处理函数--监听用户滚动
   */
  onPageScroll(e) {
    const currentScrollTop = e.scrollTop;
    const lastScrollTop = this._lastScrollTop || 0;
    const scrollDirection = currentScrollTop > lastScrollTop ? 'up' : 'down';
    
    // 滚动到顶部时，强制显示顶部栏
    if (currentScrollTop <= 10) {
      if (!this.data.isTopBarVisible) {
        this.setData({ 
          isTopBarVisible: true,
          scrollDirection: 'down'
        });
      }
      this._lastScrollTop = currentScrollTop;
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
    
    // 更新上次滚动位置（使用实例变量，避免频繁setData）
    this._lastScrollTop = currentScrollTop;
  }
});