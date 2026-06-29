// pages/category/index.js
const db = wx.cloud.database()
const _ = db.command
import PagePaginator from '../../utils/pagePaginator';
import productCacheStore from '../../utils/productCacheStore';
import { getGlobalProductWatcher } from '../../utils/globalProductWatcher';

Page({

  _isFirstEntry: true,
  _isUnloaded: false,
  _sortRequestId: 0,

  /**
   * 获取全局商品缓存
   */
  getGlobalProductCache() {
    const cache = {};
    try {
      const keys = wx.getStorageInfoSync().keys || [];
      keys.forEach(key => {
        if (key.startsWith('tta_product_')) {
          const product = wx.getStorageSync(key);
          if (product && product.data) {
            cache[product.data._id] = product.data;
          }
        }
      });
    } catch (e) {
      console.error('[宝贝页面] 获取全局商品缓存失败:', e);
    }
    return cache;
  },

  /**
   * 同步全局商品缓存到本地缓存
   * 注意：需要深拷贝以避免修改只读的存储对象
   */
  syncGlobalCacheToLocalCache(localProducts) {
    if (!localProducts || localProducts.length === 0) return localProducts;
    
    // 深拷贝，避免修改只读的存储对象
    const clonedProducts = JSON.parse(JSON.stringify(localProducts));
    
    const globalCache = this.getGlobalProductCache();
    if (!globalCache || Object.keys(globalCache).length === 0) return clonedProducts;
    
    return clonedProducts.map(product => {
      const updated = globalCache[product._id];
      if (updated) {
        return {
          ...product,
          ...updated,
          isOutOfStock: updated.stock <= 0 && updated.status === 'on',
          isOffline: updated.status !== 'on'
        };
      }
      return product;
    });
  },

  _compareProductList(oldList, newList) {
    if (!oldList || !newList) return true;
    if (oldList.length !== newList.length) return true;
    
    for (let i = 0; i < oldList.length; i++) {
      const oldProduct = oldList[i];
      const newProduct = newList[i];
      
      if (!oldProduct || !newProduct) {
        if (oldProduct !== newProduct) return true;
      } else {
        if (oldProduct._id !== newProduct._id) return true;
        if (oldProduct.name !== newProduct.name) return true;
        if (oldProduct.price !== newProduct.price) return true;
        if (oldProduct.stock !== newProduct.stock) return true;
        if (oldProduct.status !== newProduct.status) return true;
        if (oldProduct.mainImage !== newProduct.mainImage) return true;
      }
    }
    
    return false;
  },

  _quickShowFromCache() {
    const cachedProducts = this.getCachedProducts();
    if (cachedProducts && cachedProducts.length > 0) {
      const syncedProducts = this.syncGlobalCacheToLocalCache(cachedProducts);
      this.setData({
        products: syncedProducts,
        originalProducts: [...syncedProducts],
        showSkeleton: false
      });
      this.sortProducts(this.data.sortType);
    }
  },

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
    categoryFilters: [],
    inStock: null,
    // 用于双击检测
    lastTapTime: 0,
    // 是否开启滑动隐藏顶部栏功能
    enableScrollHideTopBar: false, // true: 开启滑动隐藏; false: 固定显示
    // 隐藏模式（仅在 enableScrollHideTopBar=true 时生效）
    // 'both': 隐藏标签栏和排序栏
    // 'tabs': 只隐藏标签栏（保留排序栏）- 当前默认
    // 'sort': 只隐藏排序栏（保留标签栏）
    scrollHideMode: 'tabs',
    // 滚动相关
    isTopBarVisible: true,
    // 计算后的样式值（用于 WXML 绑定）
    pagePaddingTop: '254rpx',
    tabsTop: '94rpx',
    sortBarTop: '182rpx',
    scrollViewHeight: 'calc(100vh - 254rpx)',
    scrollDirection: 'up',
    // 标记是否离开过页面（去商品详情等）
    hasNavigatedAway: false,
    // 是否显示骨架屏
    showSkeleton: true,
    // 页面可见性状态
    pageVisible: false,
    // 页面隐藏期间是否有数据变更
    pendingRefresh: false,
    // 排序数据缓存（用于快速切换排序）
    sortDataCache: {
      'category_products': null,
      'category_products_price_asc': null,
      'category_products_price_desc': null,
      'category_products_new': null
    },
    // 每个排序类型的独立分页器状态
    paginatorStates: {
      'category_products': { lastCursor: null, lastId: null, totalLoaded: 0, hasNext: true },
      'category_products_price_asc': { lastCursor: null, lastId: null, totalLoaded: 0, hasNext: true },
      'category_products_price_desc': { lastCursor: null, lastId: null, totalLoaded: 0, hasNext: true },
      'category_products_new': { lastCursor: null, lastId: null, totalLoaded: 0, hasNext: true }
    },
    // 分页相关（游标分页）
    loadingMore: false,
    hasMore: true,
    // 系列商品分页相关（游标分页）
    seriesLoadingMore: false,
    seriesHasMore: true,
    seriesPageNum: 0,
    seriesPageSize: 20,
    // 分类导航分页相关（游标分页）
    categoryLoadingMore: false,
    categoryHasMore: true,
    // 系列列表分页相关（游标分页）
    seriesListLoadingMore: false,
    seriesListHasMore: true,
    scrollTop: 0
  },

  // 从缓存获取商品数据（永久缓存，由实时监听更新）
  getCachedProducts() {
    try {
      // 使用 productCacheStore 的存储前缀
      const cached = wx.getStorageSync('product_cache_category_products');
      if (cached && cached.data) {
        return cached.data;
      }
    } catch (e) {
      console.log('读取商品缓存失败', e);
    }
    return null;
  },

  // 保存商品到缓存（永久缓存，由实时监听更新）
  setCachedProducts(products) {
    try {
      // 使用 productCacheStore 的存储前缀
      wx.setStorageSync('product_cache_category_products', {
        data: products,
        timestamp: Date.now()
      });
    } catch (e) {
      console.log('保存商品缓存失败', e);
    }
  },

  // 获取分类缓存（永久缓存，由实时监听更新）
  getCachedCategories() {
    try {
      const cached = wx.getStorageSync('category_categories');
      if (cached && cached.data) {
        return cached.data;
      }
    } catch (e) {
      console.log('读取分类缓存失败', e);
    }
    return null;
  },

  // 保存分类缓存（永久缓存，由实时监听更新）
  setCachedCategories(categories) {
    try {
      wx.setStorageSync('category_categories', {
        data: categories,
        timestamp: Date.now()
      });
    } catch (e) {
      console.log('保存分类缓存失败', e);
    }
  },

  // 获取系列缓存（永久缓存，由实时监听更新）
  getCachedSeries() {
    try {
      const cached = wx.getStorageSync('category_series');
      if (cached && cached.data) {
        return cached.data;
      }
    } catch (e) {
      console.log('读取系列缓存失败', e);
    }
    return null;
  },

  // 保存系列缓存（永久缓存，由实时监听更新）
  setCachedSeries(series) {
    try {
      wx.setStorageSync('category_series', {
        data: series,
        timestamp: Date.now()
      });
    } catch (e) {
      console.log('保存系列缓存失败', e);
    }
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.setData({ showSkeleton: true });
    
    // 初始化标签页加载状态
    this._tabsLoaded = {
      products: false,
      categories: false,
      series: false
    };
    
    // 初始化标签页状态保存
    this._tabsState = {
      products: null,
      categories: null,
      series: null
    };
    
    // 初始化标签页滚动位置
    this._tabsScrollTop = {
      products: 0,
      categories: 0,
      series: 0
    };
    
    // 等待登录完成后启动监听
    this.waitForLogin();

    // 优先显示缓存数据
    const cachedProducts = this.getCachedProducts();
    const cachedCategories = this.getCachedCategories();
    const cachedSeries = this.getCachedSeries();
    
    let hasCachedData = false;
    
    if (cachedProducts && cachedProducts.length > 0) {
      console.log('使用商品缓存数据');
      this.setData({
        products: cachedProducts,
        originalProducts: [...cachedProducts],
        showSkeleton: false
      });
      this.sortProducts(this.data.sortType);
      this._tabsLoaded.products = true;
      hasCachedData = true;
    }
    
    if (cachedCategories) {
      console.log('使用分类缓存数据');
      this.setData({ level1Categories: cachedCategories });
      this._tabsLoaded.categories = true;
      hasCachedData = true;
    }
    
    if (cachedSeries) {
      console.log('使用系列缓存数据');
      this.setData({ seriesList: cachedSeries });
      this._tabsLoaded.series = true;
      hasCachedData = true;
    }
    
    if (hasCachedData) {
      // 用游标分页器后台同步最新数据
      this.fetchProductsFromDatabase(true);
      if (!cachedCategories) this.loadCategories();
      if (!cachedSeries) this.loadSeries();
      this.calculateTopBarStyles();
      return;
    }
    
    this.initData();
    
    // 初始化顶部栏样式
    this.calculateTopBarStyles();
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    const startTime = Date.now();
    const isFirstEntry = this._isFirstEntry;
    if (this._isFirstEntry) {
      this._isFirstEntry = false;
    }
    
    const wasHidden = !this.data.pageVisible;
    
    console.log(`[宝贝页面] ====== onShow 开始 ====== 时间戳: ${startTime}`);
    console.log(`[宝贝页面] 当前页面可见状态: pageVisible=${this.data.pageVisible}, wasHidden=${wasHidden}`);
    console.log(`[宝贝页面] 当前 activeTab: ${this.data.activeTab}`);
    console.log(`[宝贝页面] 当前商品数量: products.length=${this.data.products.length}, originalProducts.length=${this.data.originalProducts ? this.data.originalProducts.length : 0}`);
    console.log(`[宝贝页面] 当前排序类型: sortType=${this.data.sortType}, priceSortOrder=${this.data.priceSortOrder}`);
    console.log(`[宝贝页面] isFirstEntry: ${isFirstEntry}`);

    this.setData({ pageVisible: true });
    
    // 通知全局监听器页面可见
    getGlobalProductWatcher().setPageVisible('category_page', true);

    // 检查是否有搜索或筛选条件
    const hasSearch = this.data.searchKeyword && this.data.searchKeyword.trim() !== '';
    const hasCategories = this.data.categories && this.data.categories.length > 0;
    const hasStockFilter = this.data.inStock !== null;
    const hasFilters = hasSearch || hasCategories || hasStockFilter;

    console.log(`[宝贝页面] 筛选条件检查: hasSearch=${hasSearch}, hasCategories=${hasCategories}, hasStockFilter=${hasStockFilter}, hasFilters=${hasFilters}`);
    console.log(`[宝贝页面] 导航状态: hasNavigatedAway=${this.data.hasNavigatedAway}, pendingRefresh=${this.data.pendingRefresh}`);

    // 如果是从商品详情回来，或者有搜索/筛选条件，完全保持当前状态，不做任何刷新操作
    if (this.data.hasNavigatedAway || hasFilters) {
      console.log('[宝贝页面] → 分支1: 从商品详情返回或有筛选条件，完全保持当前状态，不刷新');
      this.setData({ hasNavigatedAway: false });
      console.log(`[宝贝页面] ====== onShow 结束 ====== 耗时: ${Date.now() - startTime}ms`);
      return;
    }

    // 页面已有数据，直接显示
    if (this.data.products && this.data.products.length > 0) {
      console.log('[宝贝页面] → 分支2: 页面已有数据，直接显示');
    } else {
      console.log('[宝贝页面] → 分支2: 页面无数据，快速显示缓存');
      this._quickShowFromCache();
    }
    
    // 异步检测更新，不阻塞页面显示
    this._asyncCheckAndUpdate(isFirstEntry);

    // 重新连接监听器
    if (wasHidden) {
      console.log('[宝贝页面] → 页面之前隐藏，重新连接监听器');
      this.startWatchers();
    } else {
      console.log('[宝贝页面] → 页面未隐藏，检查监听器状态');
      if (!this._unsubWatcher) {
        console.log('[宝贝页面] →→ 监听器未启动，启动监听器');
        this.startWatchers();
      } else {
        console.log('[宝贝页面] →→ 监听器已启动，无需重复启动');
      }
    }
    
    console.log(`[宝贝页面] ====== onShow 结束 ====== 耗时: ${Date.now() - startTime}ms`);
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {
    this.setData({ pageVisible: false });
    
    // 通知全局监听器页面不可见
    getGlobalProductWatcher().setPageVisible('category_page', false);
    
    console.log('[宝贝页面] 页面隐藏，关闭监听器');
    console.log('宝贝页面-实时监听关闭');
    // 页面隐藏时关闭监听器，节省资源
    this.stopWatchers();
  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
    this._isUnloaded = true;
    console.log('[宝贝页面] 关闭实时监听');
    console.log('宝贝页面-实时监听关闭');
    this.destroyWatchers();
    clearTimeout(this._loginReadyTimer);
    clearTimeout(this._loginPollTimer);
    clearTimeout(this._staggerTimer2);
    clearTimeout(this._staggerTimer3);
  },

  /**
   * 等待登录完成后启动监听（使用 app 回调机制，避免轮询）
   */
  waitForLogin() {
    const app = getApp();
    if (app.onLoginReady) {
      app.onLoginReady((openid) => {
        console.log('[宝贝页面] 登录就绪，延迟启动监听');
        clearTimeout(this._loginReadyTimer);
        this._loginReadyTimer = setTimeout(() => {
          this.startWatchers();
        }, 500);
      });
    } else if (app.globalData.openid) {
      this._loginReadyTimer = setTimeout(() => {
        this.startWatchers();
      }, 500);
    } else {
      console.log('[宝贝页面] 等待登录完成');
      this._loginPollTimer = setTimeout(() => {
        this.waitForLogin();
      }, 2000);
    }
  },

  /**
   * 通过全局监听器订阅商品变化
   */
  startWatchers(cacheKey) {
    console.log('[宝贝页面] 订阅全局商品监听，cacheKey:', cacheKey);
    if (this._unsubWatcher) {
      this._unsubWatcher();
      this._unsubWatcher = null;
    }
    const key = cacheKey || this._sortCacheKey || 'category_products';
    this._unsubWatcher = getGlobalProductWatcher().subscribe(
      'category_page', key,
      (change) => this._onSingleProductChanged(change)
    );
  },

  /**
   * 取消全局监听订阅
   */
  stopWatchers() {
    if (this._unsubWatcher) {
      this._unsubWatcher();
      this._unsubWatcher = null;
    }
  },

  /**
   * 销毁实时监听
   */
  destroyWatchers() {
    this.stopWatchers();
  },

  async _asyncCheckAndUpdate(isFirstEntry = false) {
    try {
      if (this._isUnloaded) return;
      
      console.log('[宝贝页面] _asyncCheckAndUpdate 开始, isFirstEntry:', isFirstEntry);
      console.log('[宝贝页面] 当前排序:', this._sortCacheKey || 'category_products');
      
      const watcher = getGlobalProductWatcher();
      
      // 检查所有排序类型的更新标记
      const allCacheKeys = ['category_products', 'category_products_new', 'category_products_price_asc', 'category_products_price_desc'];
      let anyUpdated = false;
      const updatedKeys = [];
      
      allCacheKeys.forEach(key => {
        const updateMark = watcher.getAndClearUpdateMark(key);
        if (updateMark) {
          anyUpdated = true;
          updatedKeys.push(key);
          console.log('[宝贝页面] 检测到更新 -', key, ', updateMark:', updateMark);
        }
      });
      
      console.log('[宝贝页面] 有更新的排序:', updatedKeys.length > 0 ? updatedKeys.join(', ') : '无');
      
      // 任意排序有更新，都同步所有排序的缓存
      if (anyUpdated) {
        console.log('[宝贝页面] 监听器检测到排序缓存更新，开始同步所有排序缓存');
        this._syncAllSortDataFromCache();
        console.log('[宝贝页面] 所有排序缓存同步完成');
      }
      
      // 监听器健康检查
      const healthCheck = watcher.checkNeedsRefresh();
      console.log('[宝贝页面] 监听器健康检查:', healthCheck);
      if (healthCheck.needsRefresh) {
        console.log('[宝贝页面] 监听器不健康，刷新数据');
        this.fetchProductsFromDatabase(true);
        return;
      }
      
      // 首次进入：跳过时间戳对比（onLoad 已从数据库加载最新数据）
      if (isFirstEntry) {
        console.log('[宝贝页面] 首次进入，跳过时间戳对比');
        return;
      }
      
      // 返回页面（有数据）：执行时间戳对比（只检查当前排序）
      if (this.data.products.length > 0) {
        console.log('[宝贝页面] 返回页面，执行时间戳对比');
        await this._validateCategoryProductsCacheAsync();
      } else {
        console.log('[宝贝页面] 返回页面但无数据，跳过时间戳对比');
      }
      
      console.log('[宝贝页面] _asyncCheckAndUpdate 结束');
    } catch (error) {
      console.error('[宝贝页面] _asyncCheckAndUpdate 失败:', error);
    }
  },

  _reloadFromCache() {
    const cacheKey = this._sortCacheKey || 'category_products';
    const cache = productCacheStore.get(cacheKey);
    
    if (!cache || !cache.data) return;
    
    const currentLoaded = this.data.products.length;
    
    if (currentLoaded > cache.data.length) {
      console.log(`[宝贝页面] 当前已加载 ${currentLoaded} 条 > 缓存 ${cache.data.length} 条，保持原数据`);
      return;
    }
    
    const page = cache.data.slice(0, currentLoaded);
    const hasMore = cache.data.length > currentLoaded && cache.hasMore;
    
    // 更新所有排序的 sortDataCache
    const newSortDataCache = { ...this.data.sortDataCache };
    const allCacheKeys = ['category_products', 'category_products_new', 'category_products_price_asc', 'category_products_price_desc'];
    
    allCacheKeys.forEach(key => {
      const itemCache = productCacheStore.get(key);
      if (itemCache && itemCache.data && itemCache.data.length > 0) {
        newSortDataCache[key] = { 
          products: itemCache.data, 
          originalProducts: [...itemCache.data] 
        };
      }
    });
    
    // 更新所有排序的 paginatorStates
    const newPaginatorStates = { ...this.data.paginatorStates };
    
    allCacheKeys.forEach(key => {
      const itemCache = productCacheStore.get(key);
      if (itemCache && itemCache.data && itemCache.data.length > 0) {
        const lastItem = itemCache.data[itemCache.data.length - 1];
        // 根据排序类型确定 cursor 字段
        newPaginatorStates[key] = this.getPaginatorStateForCacheKey(key, itemCache.data, itemCache.hasMore);
      }
    });
    
    this.setData({
      products: page,
      originalProducts: [...page],
      hasMore: hasMore,
      sortDataCache: newSortDataCache,
      paginatorStates: newPaginatorStates,
      currentDisplaySort: cacheKey
    });
    
    this.__cacheIndex = page.length;
  },

  /**
   * 从 productCacheStore 同步所有排序的 sortDataCache 和 paginatorStates
   * 用于页面重新显示时，同步所有排序的最新缓存
   */
  _syncAllSortDataFromCache() {
    console.log('[宝贝页面] ====== _syncAllSortDataFromCache 开始 ======');
    
    const allCacheKeys = ['category_products', 'category_products_new', 'category_products_price_asc', 'category_products_price_desc'];
    
    const newSortDataCache = { ...this.data.sortDataCache };
    const newPaginatorStates = { ...this.data.paginatorStates };
    
    allCacheKeys.forEach(key => {
      const itemCache = productCacheStore.get(key);
      const beforeLength = this.data.sortDataCache[key]?.products?.length || 0;
      
      if (itemCache && itemCache.data && itemCache.data.length > 0) {
        newSortDataCache[key] = { 
          products: itemCache.data, 
          originalProducts: [...itemCache.data] 
        };
        
        const lastItem = itemCache.data[itemCache.data.length - 1];
        // 根据排序类型确定 cursor 字段
        newPaginatorStates[key] = this.getPaginatorStateForCacheKey(key, itemCache.data, itemCache.hasMore);
        
        console.log('[宝贝页面] 同步排序缓存 -', key, 
          ': 之前', beforeLength, '条 → 现在', itemCache.data.length, '条,',
          'hasNext:', itemCache.hasMore);
      } else {
        console.log('[宝贝页面] 同步排序缓存 -', key, ': 无缓存数据，跳过');
      }
    });
    
    // 如果当前排序的数据有更新，同步更新 products 和 originalProducts
    const currentCacheKey = this._sortCacheKey || 'category_products';
    const currentCache = productCacheStore.get(currentCacheKey);
    
    console.log('[宝贝页面] 当前排序:', currentCacheKey, 
      ', 当前 products.length:', this.data.products.length,
      ', 缓存长度:', currentCache?.data?.length || 0);
    
    if (currentCache && currentCache.data && currentCache.data.length > 0) {
      const currentLoaded = this.data.products.length;
      const targetLength = Math.min(currentLoaded, currentCache.data.length);
      const page = currentCache.data.slice(0, targetLength);
      const hasMore = targetLength < currentCache.data.length || currentCache.hasMore;
      
      console.log('[宝贝页面] 更新当前排序数据 - products:', targetLength, '条, hasMore:', hasMore);
      
      this.setData({
        products: page,
        originalProducts: [...page],
        hasMore: hasMore,
        sortDataCache: newSortDataCache,
        paginatorStates: newPaginatorStates
      });
      
      this.__cacheIndex = targetLength;
    } else {
      console.log('[宝贝页面] 当前排序无缓存，只更新 sortDataCache 和 paginatorStates');
      this.setData({
        sortDataCache: newSortDataCache,
        paginatorStates: newPaginatorStates
      });
    }
    
    console.log('[宝贝页面] ====== _syncAllSortDataFromCache 结束 ======');
  },

  async _asyncRefreshCategory() {
    const TIMEOUT = 8000;
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), TIMEOUT);
    });
    
    const refreshPromise = this._doRefreshCategory();
    
    try {
      const result = await Promise.race([refreshPromise, timeoutPromise]);
      
      if (result && result.changed) {
        console.log('[宝贝页面] 系列数据刷新成功');
      }
    } catch (error) {
      if (error.message === 'Timeout') {
        console.warn('[宝贝页面] 系列数据刷新超时，保持旧数据');
      } else {
        console.error('[宝贝页面] 系列数据刷新失败', error);
      }
    }
  },

  async _doRefreshCategory() {
    try {
      const [categoryRes, productsRes] = await Promise.all([
        db.collection('category').where({ status: 'on' }).orderBy('sortOrder', 'asc').get(),
        db.collection('products').where({ status: 'on', isDeleted: false }).get()
      ]);
      
      const categories = categoryRes.data;
      const products = productsRes.data;
      
      const newSeriesList = categories.map(category => {
        const seriesProducts = products.filter(
          p => p.categoryId === category._id && p.status === 'on'
        );
        return {
          ...category,
          products: seriesProducts.slice(0, 3).map(product => ({
            ...product,
            isOutOfStock: product.stock <= 0 && product.status === 'on',
            isOffline: product.status !== 'on'
          }))
        };
      });
      
      const hasChanged = this._compareSeriesList(this.data.seriesList, newSeriesList);
      
      if (hasChanged) {
        this.setData({ seriesList: newSeriesList });
        const cachedData = wx.getStorageSync('categoryData');
        if (cachedData) {
          const clonedData = JSON.parse(JSON.stringify(cachedData));
          clonedData.seriesList = newSeriesList;
          wx.setStorageSync('categoryData', clonedData);
        }
        return { changed: true };
      }
      return { changed: false };
    } catch (error) {
      throw error;
    }
  },

  _compareSeriesList(oldList, newList) {
    if (!oldList || !newList) return true;
    if (oldList.length !== newList.length) return true;
    
    for (let i = 0; i < oldList.length; i++) {
      const oldSeries = oldList[i];
      const newSeries = newList[i];
      
      if (!oldSeries || !newSeries) {
        if (oldSeries !== newSeries) return true;
      } else {
        if (oldSeries._id !== newSeries._id) return true;
        if (oldSeries.name !== newSeries.name) return true;
        if (oldSeries.image !== newSeries.image) return true;
        if (oldSeries.status !== newSeries.status) return true;
        
        if (!oldSeries.products || !newSeries.products) {
          if (oldSeries.products !== newSeries.products) return true;
        } else {
          if (oldSeries.products.length !== newSeries.products.length) return true;
          
          for (let j = 0; j < oldSeries.products.length; j++) {
            const oldP = oldSeries.products[j];
            const newP = newSeries.products[j];
            
            if (!oldP || !newP) {
              if (oldP !== newP) return true;
            } else {
              if (oldP._id !== newP._id) return true;
              if (oldP.price !== newP.price) return true;
              if (oldP.stock !== newP.stock) return true;
              if (oldP.status !== newP.status) return true;
            }
          }
        }
      }
    }
    
    return false;
  },

  async _validateCategoryProductsCacheAsync(cacheParam) {
    try {
      const cache = cacheParam || productCacheStore.get(this._sortCacheKey || 'category_products');
      if (!cache || !cache.data || cache.data.length === 0) {
        return;
      }
      
      await this._validateCategoryProductsCache(cache);
    } catch (error) {
      console.error('[宝贝页面] _validateCategoryProductsCacheAsync 失败:', error);
    }
  },

  /**
   * 处理单个商品数据变化（全局监听器回调）
   * @param {Object} change { type: 'add'|'modify'|'remove', product }
   */
  _onSingleProductChanged({ type, product }) {
    if (!product || !product._id) return;

    const docId = product._id;
    console.log('[宝贝页面] _onSingleProductChanged - type:', type, 'docId:', docId);

    const { originalProducts, seriesList, level1Categories } = this.data;

    let updatedProducts = [...this.data.products];
    let updatedOriginal = [...originalProducts];
    let updatedSeriesList = [...seriesList];
    let updatedCategories = [...level1Categories];
    let updatedSeriesProducts = [...this.data.seriesProducts];

    console.log('[宝贝页面] _onSingleProductChanged - 原始products长度:', this.data.products.length);
    console.log('[宝贝页面] _onSingleProductChanged - 原始products前3个ID:', 
      this.data.products.slice(0, 3).map(p => p._id).join(', '));

    const index = updatedProducts.findIndex(p => p._id === docId);
    const originalIndex = updatedOriginal.findIndex(p => p._id === docId);

    // 兼容 'update' 和 'modify' 两种类型
    const isModify = type === 'modify' || type === 'update';

    // 检查是否有筛选条件
    const { searchKeyword, categories, inStock } = this.data;
    const hasFilters = searchKeyword || (categories && categories.length > 0) || inStock !== null;

    // --- 处理 add ---
    if (type === 'add') {
      // 如果有筛选条件，不在这处理，交给后面的筛选逻辑处理
      if (hasFilters) {
        console.log('[宝贝页面] _onSingleProductChanged - add类型但有筛选条件，交给筛选逻辑处理');
      } else {
        if (index === -1 && product.status === 'on') {
          updatedProducts.push(product);
          // 只在 originalProducts 中不存在时才添加
          if (originalIndex === -1) {
            updatedOriginal.push(product);
          }
        }
      }
    }

    // --- 处理 modify/update ---
    else if (isModify) {
      // 更新显示的 products 数组（无论是否在搜索筛选模式）
      if (index !== -1) {
        updatedProducts[index] = { ...updatedProducts[index], ...product };
      }
      
      // 更新 originalProducts（如果存在）
      if (originalIndex !== -1) {
        updatedOriginal[originalIndex] = { ...updatedOriginal[originalIndex], ...product };
      } else if (product.status === 'on') {
        // 上架：不在列表中但变为 on → 添加到 originalProducts
        // 先检查是否已经在 updatedOriginal 中（避免重复添加）
        const alreadyInUpdated = updatedOriginal.some(p => p._id === docId);
        if (!alreadyInUpdated) {
          console.log('[宝贝页面] _onSingleProductChanged - modify分支添加商品到updatedOriginal');
          updatedOriginal.push(product);
        }
        
        // 更新分页器游标：新商品加入后需更新最后一条数据的位置
        if (this.productPaginator && this.productPaginator.pagination && updatedOriginal.length > 0) {
          const lastItem = updatedOriginal[updatedOriginal.length - 1];
          if (lastItem) {
            // 根据当前排序类型使用正确的游标字段
            const cursorField = this.productPaginator.cursorField || '_id';
            this.productPaginator.pagination.lastCursor = lastItem[cursorField] || lastItem._id;
            this.productPaginator.pagination.lastId = lastItem._id;
            this.productPaginator.pagination.totalLoaded = updatedOriginal.length;
            // hasNext 保持不变，根据当前列表长度判断是否还有更多
            this.productPaginator.pagination.hasNext = true;
            console.log('[宝贝页面] 新商品上架，更新分页器游标到最后一条数据，游标字段:', cursorField);
          }
        }
      }

      // 更新系列中的商品
      updatedSeriesList.forEach((series) => {
        if (series.products) {
          const sIdx = series.products.findIndex(p => p._id === docId);
          if (sIdx !== -1) {
            series.products[sIdx] = { ...series.products[sIdx], ...product,
              isOutOfStock: product.stock <= 0 && product.status === 'on',
              isOffline: product.status !== 'on'
            };
          }
        }
        // 更新 seriesProducts
        if (this.data.selectedSeries === series._id) {
          const spIdx = updatedSeriesProducts.findIndex(p => p._id === docId);
          if (spIdx !== -1) {
            updatedSeriesProducts[spIdx] = { ...updatedSeriesProducts[spIdx], ...product,
              isOutOfStock: product.stock <= 0 && product.status === 'on',
              isOffline: product.status !== 'on'
            };
          }
        }
      });

      // 更新分类中的商品
      updatedCategories.forEach((cat) => {
        if (cat.products) {
          const cIdx = cat.products.findIndex(p => p._id === docId);
          if (cIdx !== -1) {
            cat.products[cIdx] = { ...cat.products[cIdx], ...product,
              isOutOfStock: product.stock <= 0 && product.status === 'on',
              isOffline: product.status !== 'on'
            };
          }
        }
      });

      // 下架 → 移除
      if (product.status === 'off') {
        // 从显示的 products 中移除
        if (index !== -1) {
          updatedProducts.splice(index, 1);
          console.log('[宝贝页面] 下架：从显示列表移除商品:', docId);
        }
        // 从 originalProducts 中移除（使用 originalIndex）
        if (originalIndex !== -1) {
          updatedOriginal.splice(originalIndex, 1);
          
          // 更新分页器游标：商品移除后需更新最后一条数据的位置
          // 优先使用 filterPaginator（搜索/筛选模式），否则使用 productPaginator
          const paginator = this.filterPaginator || this.productPaginator;
          if (paginator && paginator.pagination && updatedOriginal.length > 0) {
            const lastItem = updatedOriginal[updatedOriginal.length - 1];
            if (lastItem) {
              const cursorField = paginator.cursorField || '_id';
              paginator.pagination.lastCursor = lastItem[cursorField] || lastItem._id;
              paginator.pagination.lastId = lastItem._id;
              paginator.pagination.totalLoaded = updatedOriginal.length;
              console.log('[宝贝页面] 商品下架，更新分页器游标到最后一条数据:', lastItem._id);
            }
          }
        }
      }
    }

    // --- 处理 remove ---
    else if (type === 'remove') {
      // 从显示的 products 中移除
      if (index !== -1) {
        updatedProducts.splice(index, 1);
      }
      // 从 originalProducts 中移除（使用 originalIndex）
      if (originalIndex !== -1) {
        updatedOriginal.splice(originalIndex, 1);
        
        // 更新分页器游标：商品删除后需更新最后一条数据的位置
        const paginator = this.filterPaginator || this.productPaginator;
        if (paginator && paginator.pagination && updatedOriginal.length > 0) {
          const lastItem = updatedOriginal[updatedOriginal.length - 1];
          if (lastItem) {
            const cursorField = paginator.cursorField || '_id';
            paginator.pagination.lastCursor = lastItem[cursorField] || lastItem._id;
            paginator.pagination.lastId = lastItem._id;
            paginator.pagination.totalLoaded = updatedOriginal.length;
            console.log('[宝贝页面] 商品删除，更新分页器游标到最后一条数据:', lastItem._id);
          }
        }
      }
      // 从系列中删除
      updatedSeriesList.forEach((series) => {
        if (series.products) {
          const sIdx = series.products.findIndex(p => p._id === docId);
          if (sIdx !== -1) series.products.splice(sIdx, 1);
        }
      });
      // 从分类中删除
      updatedCategories.forEach((cat) => {
        if (cat.products) {
          const cIdx = cat.products.findIndex(p => p._id === docId);
          if (cIdx !== -1) cat.products.splice(cIdx, 1);
        }
      });
    }

    // --- 更新 UI ---
    this.setData({
      originalProducts: updatedOriginal,
      seriesList: updatedSeriesList,
      level1Categories: updatedCategories,
      seriesProducts: updatedSeriesProducts
    });

    this.setCachedProducts(updatedOriginal);

    // 搜索/筛选模式下的更新策略
    if (hasFilters) {
      // 检查商品是否符合当前筛选条件
      const isProductMatchFilter = (item) => {
        if (!item) return false;
        // 检查搜索关键词
        if (searchKeyword && searchKeyword.trim() !== '') {
          const name = item.name || '';
          if (!name.toLowerCase().includes(searchKeyword.toLowerCase())) {
            return false;
          }
        }
        // 检查分类
        if (categories && categories.length > 0) {
          const typeId = item.typeId || '';
          if (!categories.includes(typeId)) {
            return false;
          }
        }
        // 检查库存
        if (inStock !== null) {
          if (inStock && item.stock <= 0) {
            return false;
          }
          if (!inStock && item.stock > 0) {
            return false;
          }
        }
        return true;
      };

      // 搜索/筛选模式
      // 下架逻辑已经在前面的 modify/update 分支中处理过了
      // 如果商品被下架移除，需要更新UI
      if (product.status === 'off') {
        console.log('[宝贝页面] 下架后更新UI，products长度:', updatedProducts.length, ', originalProducts长度:', updatedOriginal.length);
        this.setData({ 
          products: updatedProducts,
          originalProducts: updatedOriginal  // ← 新增：同步更新 originalProducts
        });
      }
      // 修改操作：检查商品是否仍然符合筛选条件
      else if (isModify && index !== -1) {
        const currentIndex = updatedProducts.findIndex(p => p._id === docId);
        if (currentIndex !== -1) {
          // 更新商品数据
          updatedProducts[currentIndex] = { ...updatedProducts[currentIndex], ...product };
          
          // 检查更新后的商品是否仍然符合筛选条件
          if (isProductMatchFilter(product)) {
            console.log('[宝贝页面] 修改：商品仍符合筛选条件，更新显示并重新排序');
            const sorted = this.getSortedArray(updatedProducts, this.data.sortType);
            this.setData({ products: sorted });
          } else {
            // 商品不再符合筛选条件，从两个数组中都移除
            updatedProducts.splice(currentIndex, 1);
            // 从 originalProducts 中也移除
            const originalIdx = updatedOriginal.findIndex(p => p._id === docId);
            if (originalIdx !== -1) {
              updatedOriginal.splice(originalIdx, 1);
            }
            console.log('[宝贝页面] 修改：商品不再符合筛选条件，已移除');
            this.setData({ 
              products: updatedProducts,
              originalProducts: updatedOriginal
            });
          }
        } else {
          console.log('[宝贝页面] 商品已被移除，跳过更新');
        }
      } else if (isModify && index === -1) {
        // 修改操作：商品不在列表中，但可能变为符合筛选条件
        if (isProductMatchFilter(product)) {
          console.log('[宝贝页面] 修改：商品变为符合筛选条件，添加到列表');
          updatedProducts.push(product);
          updatedOriginal.push(product);
          const sorted = this.getSortedArray(updatedProducts, this.data.sortType);
          this.setData({ 
            products: sorted,
            originalProducts: updatedOriginal
          });
        } else {
          console.log('[宝贝页面] 修改：商品仍不符合筛选条件，跳过');
        }
      } else if (type === 'add' || (product.status === 'on' && index === -1)) {
        // 判断商品是否应该在当前列表范围内（综合排序、新品排序、价格排序）
        const { sortType } = this.data;
        const shouldBeInList = () => {
          if (!updatedOriginal || updatedOriginal.length === 0) {
            return true;
          }
          const lastItem = updatedOriginal[updatedOriginal.length - 1];
          if (sortType === 'default') {
            return product._id >= lastItem._id;
          }
          if (sortType === 'new') {
            const ts = product.createdAtTs || (product.createdAt ? new Date(product.createdAt).getTime() : 0);
            const lastTs = lastItem.createdAtTs || (lastItem.createdAt ? new Date(lastItem.createdAt).getTime() : 0);
            return ts >= lastTs;
          }
          if (sortType === 'price') {
            const { priceSortOrder } = this.data;
            if (priceSortOrder === 'desc') {
              return product.price >= lastItem.price;
            } else {
              return product.price <= lastItem.price;
            }
          }
          return false;
        };
        
        if (shouldBeInList()) {
          console.log('[宝贝页面] 商品上架，加入当前列表');
          updatedProducts.push(product);
          updatedOriginal.push(product);
          const sorted = this.getSortedArray(updatedProducts, sortType);
          // originalProducts 也需要排序，确保分页器读取的数据顺序正确
          const sortedOriginal = this.getSortedArray(updatedOriginal, sortType);
          
          // 更新分页器cursor为排序前originalProducts的最后一个不在展示范围内的商品
          // 这是因为排序后商品的顺序可能变化，但分页器的cursor应该指向"已加载范围的边界"
          // 例如：排序前 [A,B,...,R,S]，排序后 [S,A,B,...,R]
          // 分页器cursor应该是 R（最后一个不在最前面的商品）
          const paginator = this.filterPaginator || this.productPaginator;
          if (paginator && paginator.pagination && sortedOriginal.length > 1) {
            // 使用排序后sortedOriginal的最后一个元素作为分页器cursor
            // 这样可以确保下次加载从正确的位置开始
            const lastItem = sortedOriginal[sortedOriginal.length - 1];
            const cursorField = paginator.cursorField || '_id';
            paginator.pagination.lastCursor = lastItem[cursorField] || lastItem._id;
            paginator.pagination.lastId = lastItem._id;
            paginator.pagination.totalLoaded = sorted.length;
            console.log('[宝贝页面] 更新分页器cursor:', lastItem._id);
          }
          
          this.setData({ 
            products: sorted,
            originalProducts: sortedOriginal
          }, () => {
            console.log('[宝贝页面] 上架数据已更新到 setData，originalProducts长度:', this.data.originalProducts.length);
          });
        } else {
          console.log('[宝贝页面] 商品上架，但不在当前列表范围内');
        }
      }
    } else {
      // 普通列表模式：更新所有排序类型的 sortDataCache
      const sortCacheKey = this._sortCacheKey || 'category_products';
      const allCacheKeys = ['category_products', 'category_products_new', 'category_products_price_asc', 'category_products_price_desc'];
      
      const newSortDataCache = { ...this.data.sortDataCache };
      const newPaginatorStates = { ...this.data.paginatorStates };
      
      // 判断商品是否应该在某个排序缓存的已加载范围内
      const shouldBeInCache = (cacheData, sortType, order) => {
        // 如果缓存为空，但商品状态为上架，则应该加入（可能是下架后重新上架）
        if (!cacheData || !cacheData.originalProducts || cacheData.originalProducts.length === 0) {
          // 如果 hasMore 为 true，说明可能还有更多数据，上架的商品应该加入缓存
          return product.status === 'on' && this.data.hasMore;
        }
        
        // 如果商品已经在缓存中，直接返回 true
        const existingIndex = cacheData.originalProducts.findIndex(p => p._id === docId);
        if (existingIndex !== -1) {
          return true;
        }
        
        // 下架或删除的商品，不在缓存范围内（已经在前面的判断中处理了移除逻辑）
        if (product.status === 'off' || type === 'remove') {
          return false;
        }
        
        // 判断新商品是否应该在当前已加载的范围内
        const sortedData = this.getSortedArray(cacheData.originalProducts, sortType, order);
        const lastItem = sortedData[sortedData.length - 1];
        if (!lastItem) return false;
        
        if (sortType === 'default') {
          // 综合排序：按 _id 降序
          return product._id >= lastItem._id;
        }
        if (sortType === 'new') {
          // 新品排序：按 createdAtTs 降序，第二排序 _id 降序
          const ts = product.createdAtTs || (product.createdAt ? new Date(product.createdAt).getTime() : 0);
          const lastTs = lastItem.createdAtTs || (lastItem.createdAt ? new Date(lastItem.createdAt).getTime() : 0);
          if (ts > lastTs) return true;
          if (ts === lastTs) return product._id >= lastItem._id;
          return false;
        }
        if (sortType === 'price') {
          // 价格排序：价格为主排序，_id 为第二排序
          if (order === 'desc') {
            // 价格降序：价格高的在前，价格相同则 _id 大的在前
            if (product.price > lastItem.price) return true;
            if (product.price === lastItem.price) return product._id >= lastItem._id;
            return false;
          } else {
            // 价格升序：价格低的在前，价格相同则 _id 小的在前
            if (product.price < lastItem.price) return true;
            if (product.price === lastItem.price) return product._id <= lastItem._id;
            return false;
          }
        }
        return false;
      };
      
      // 更新分页器的方法（更新独立的分页器状态）
      const updatePaginatorState = (cacheKey, sortType, order) => {
        const cacheData = newSortDataCache[cacheKey];
        if (!cacheData || !cacheData.originalProducts || cacheData.originalProducts.length === 0) {
          return;
        }
        
        const sortedOriginal = this.getSortedArray(cacheData.originalProducts, sortType, order);
        const lastItem = sortedOriginal[sortedOriginal.length - 1];
        if (!lastItem) return;
        
        // 更新独立分页器状态
        newPaginatorStates[cacheKey] = this.getPaginatorStateForCacheKey(cacheKey, sortedOriginal, true);
        
        // 如果是当前显示的排序，更新 hasMore 状态
        if (cacheKey === sortCacheKey) {
          this.setData({ hasMore: true });
        }
      };
      
      allCacheKeys.forEach(key => {
        if (!newSortDataCache[key]) return;
        
        let sortTypeForCache = 'default';
        let orderForCache = 'asc';
        if (key === 'category_products_new') sortTypeForCache = 'new';
        else if (key === 'category_products_price_asc') {
          sortTypeForCache = 'price';
          orderForCache = 'asc';
        } else if (key === 'category_products_price_desc') {
          sortTypeForCache = 'price';
          orderForCache = 'desc';
        }
        
        // 判断商品是否应该在当前缓存范围内
        const inRange = shouldBeInCache(newSortDataCache[key], sortTypeForCache, orderForCache);
        
        // 如果是下架/删除，并且商品在缓存中 → 移除
        if ((product.status === 'off' || type === 'remove') && inRange) {
          let cacheOriginal = [...(newSortDataCache[key].originalProducts || [])];
          let cacheProducts = [...(newSortDataCache[key].products || [])];
          
          const idx = cacheProducts.findIndex(p => p._id === docId);
          if (idx !== -1) cacheProducts.splice(idx, 1);
          
          const origIdx = cacheOriginal.findIndex(p => p._id === docId);
          if (origIdx !== -1) cacheOriginal.splice(origIdx, 1);
          
          newSortDataCache[key] = { 
            products: this.getSortedArray(cacheProducts, sortTypeForCache, orderForCache), 
            originalProducts: cacheOriginal 
          };
          
          // 如果移除的是当前排序的最后一个商品，更新分页器
          updatePaginatorState(key, sortTypeForCache, orderForCache);
        }
        // 如果是上架/新发布/修改，并且商品在缓存范围内 → 更新或添加
        else if (inRange && product.status === 'on') {
          let cacheOriginal = [...(newSortDataCache[key].originalProducts || [])];
          let cacheProducts = [...(newSortDataCache[key].products || [])];
          
          // 记录商品是否原本就在缓存中
          const wasAlreadyInCache = cacheOriginal.findIndex(p => p._id === docId) !== -1;
          
          const idx = cacheProducts.findIndex(p => p._id === docId);
          if (idx !== -1) {
            cacheProducts[idx] = { ...cacheProducts[idx], ...product };
          } else {
            cacheProducts.push(product);
          }
          
          const origIdx = cacheOriginal.findIndex(p => p._id === docId);
          if (origIdx !== -1) {
            cacheOriginal[origIdx] = { ...cacheOriginal[origIdx], ...product };
          } else {
            cacheOriginal.push(product);
          }
          
          newSortDataCache[key] = { 
            products: this.getSortedArray(cacheProducts, sortTypeForCache, orderForCache), 
            originalProducts: cacheOriginal 
          };
          
          // 如果是新商品加入（原本不在缓存中），更新分页器
          if (!wasAlreadyInCache) {
            updatePaginatorState(key, sortTypeForCache, orderForCache);
          }
        }
      });
      
      // 当前排序的显示数据
      const currentSorted = newSortDataCache[sortCacheKey] ? newSortDataCache[sortCacheKey].products : [];
      const currentOriginal = newSortDataCache[sortCacheKey] ? newSortDataCache[sortCacheKey].originalProducts : [];
      
      this.setData({ 
        products: currentSorted,
        originalProducts: currentOriginal,
        sortDataCache: newSortDataCache,
        paginatorStates: newPaginatorStates
      });
    }
    console.log('[宝贝页面] 商品数据更新完成');
  },
  
  /**
   * 应用搜索和筛选条件
   */
  applySearchAndFilter(sourceProducts) {
    const { searchKeyword, categories, inStock, products } = this.data;
    // 使用传入的数据源，如果没有传入则使用当前 data 中的数据
    const originalProducts = sourceProducts || this.data.originalProducts;
    
    console.log('========================================');
    console.log('[宝贝页面] applySearchAndFilter 被调用');
    console.log('[宝贝页面] searchKeyword:', JSON.stringify(searchKeyword));
    console.log('[宝贝页面] categories:', JSON.stringify(categories));
    console.log('[宝贝页面] inStock:', inStock);
    console.log('[宝贝页面] 输入数据 originalProducts 数量:', originalProducts ? originalProducts.length : 0);
    
    let filteredProducts = [...originalProducts];
    console.log('[宝贝页面] [步骤1] 初始 filteredProducts 数量:', filteredProducts.length);
    
    // 应用搜索条件
    if (searchKeyword && searchKeyword.trim() !== '') {
      console.log('----------------------------------------');
      console.log('[宝贝页面] [步骤2] 开始应用搜索关键词过滤');
      console.log('[宝贝页面] 搜索关键词:', searchKeyword);
      const keywordLower = searchKeyword.toLowerCase();
      console.log('[宝贝页面] 搜索关键词(小写):', keywordLower);
      
      const beforeCount = filteredProducts.length;
      filteredProducts = filteredProducts.filter(item => {
        const name = item.name || '';
        const nameLower = name.toLowerCase();
        const isMatch = nameLower.includes(keywordLower);
        if (isMatch) {
          console.log('[宝贝页面] ✓ 商品匹配:', item._id, '-', item.name);
        }
        return isMatch;
      });
      console.log('[宝贝页面] 搜索前:', beforeCount, '条');
      console.log('[宝贝页面] 搜索后:', filteredProducts.length, '条');
      console.log('[宝贝页面] 过滤掉:', beforeCount - filteredProducts.length, '条');
    } else {
      console.log('[宝贝页面] [步骤2] 无搜索关键词，跳过搜索过滤');
    }
    
    // 应用分类筛选
    if (categories && categories.length > 0) {
      console.log('----------------------------------------');
      console.log('[宝贝页面] [步骤3] 开始应用分类筛选');
      console.log('[宝贝页面] 分类列表:', JSON.stringify(categories));
      
      const beforeCount = filteredProducts.length;
      filteredProducts = filteredProducts.filter(item => {
        const typeId = item.typeId || '';
        const isMatch = categories.includes(typeId);
        if (isMatch) {
          console.log('[宝贝页面] ✓ 商品分类匹配:', item._id, '- typeId:', typeId);
        }
        return isMatch;
      });
      console.log('[宝贝页面] 分类筛选前:', beforeCount, '条');
      console.log('[宝贝页面] 分类筛选后:', filteredProducts.length, '条');
      console.log('[宝贝页面] 过滤掉:', beforeCount - filteredProducts.length, '条');
    } else {
      console.log('[宝贝页面] [步骤3] 无分类筛选条件，跳过分类筛选');
    }
    
    // 应用库存筛选
    if (inStock !== null) {
      console.log('----------------------------------------');
      console.log('[宝贝页面] [步骤4] 开始应用库存筛选');
      console.log('[宝贝页面] 库存筛选条件:', inStock ? '有库存' : '无库存');
      
      const beforeCount = filteredProducts.length;
      filteredProducts = filteredProducts.filter(item => {
        const stock = typeof item.stock === 'number' ? item.stock : 0;
        const isMatch = inStock ? stock > 0 : stock <= 0;
        if (isMatch) {
          console.log('[宝贝页面] ✓ 商品库存匹配:', item._id, '- stock:', stock);
        }
        return isMatch;
      });
      console.log('[宝贝页面] 库存筛选前:', beforeCount, '条');
      console.log('[宝贝页面] 库存筛选后:', filteredProducts.length, '条');
      console.log('[宝贝页面] 过滤掉:', beforeCount - filteredProducts.length, '条');
    } else {
      console.log('[宝贝页面] [步骤4] 无库存筛选条件，跳过库存筛选');
    }
    
    // 应用排序
    console.log('----------------------------------------');
    console.log('[宝贝页面] [步骤5] 开始应用排序');
    console.log('[宝贝页面] 当前排序类型:', this.data.sortType);
    console.log('[宝贝页面] 当前价格排序方向:', this.data.priceSortOrder);
    
    const sorted = this.getSortedArray(filteredProducts, this.data.sortType);
    console.log('[宝贝页面] 排序后商品ID顺序:', sorted.map(p => p._id).join(', '));
    
    // 检查是否需要更新
    let needsUpdate = false;
    if (filteredProducts.length !== products.length) {
      needsUpdate = true;
    } else {
      for (let i = 0; i < filteredProducts.length; i++) {
        const oldProduct = products[i];
        const newProduct = filteredProducts[i];
        
        // 先比较 _id
        if (oldProduct._id !== newProduct._id) {
          needsUpdate = true;
          break;
        }
        
        // 再比较关键字段（名称、价格、库存、状态、图片）
        if (oldProduct.name !== newProduct.name ||
            oldProduct.price !== newProduct.price ||
            oldProduct.stock !== newProduct.stock ||
            oldProduct.status !== newProduct.status ||
            oldProduct.mainImage !== newProduct.mainImage) {
          needsUpdate = true;
          console.log('[宝贝页面] 检测到商品内容变化:', oldProduct._id, 
            'name:', oldProduct.name, '->', newProduct.name,
            'price:', oldProduct.price, '->', newProduct.price);
          break;
        }
      }
    }
    
    console.log('----------------------------------------');
    console.log('[宝贝页面] [步骤6] 更新决策');
    console.log('[宝贝页面] 当前显示 products 数量:', products.length);
    console.log('[宝贝页面] 筛选后 filteredProducts 数量:', filteredProducts.length);
    console.log('[宝贝页面] needsUpdate:', needsUpdate);
    
    if (needsUpdate) {
      console.log('[宝贝页面] ✓ 检测到变化，更新 products');
      console.log('[宝贝页面] 更新前 products 商品ID:', products.map(p => p._id).join(', '));
      console.log('[宝贝页面] 更新后 products 商品ID:', sorted.map(p => p._id).join(', '));
      // 同步更新 originalProducts，确保分页器读取的数据是最新的
      if (sourceProducts) {
        this.setData({ 
          products: sorted,
          originalProducts: sourceProducts
        });
      } else {
        this.setData({ products: sorted });
      }
    } else {
      console.log('[宝贝页面] ✗ 没有变化，不更新 products');
    }
    
    console.log('========================================');
    console.log('[宝贝页面] applySearchAndFilter 执行完成');
  },

  /**
   * 初始化数据
   */
  initData() {
    this.loadProducts()
    this.loadSeries(true)
    this.loadCategories(true)
  },

  /**
   * 加载商品列表
   */
    loadProducts() {
    // 防止重复加载
    if (this._isLoadingProducts) {
      console.log('[宝贝页面] 已在加载中，跳过重复调用');
      return;
    }
    this._isLoadingProducts = true;
    
    const { products } = this.data;

    // 如果已有数据，不显示 loading，避免空白
    if (products.length === 0) {
      wx.showLoading({ title: '加载中...' })
    }

    console.log('[宝贝页面] 加载完整商品列表');

    // 先尝试从本地缓存获取数据
    const cachedProducts = this.getCachedProducts();
    if (cachedProducts && cachedProducts.length > 0) {
      console.log('[宝贝页面] 从本地缓存获取商品数据:', cachedProducts.length);

      // 从全局商品缓存同步最新数据
      const syncedProducts = this.syncGlobalCacheToLocalCache(cachedProducts);

      // 保存到原始数据和缓存
      this.setData({
        originalProducts: syncedProducts,
        showSkeleton: false
      }, () => {
        // setData 完成后再继续
        this.setCachedProducts(syncedProducts);

        // 应用搜索、筛选和排序
        this.applySearchAndFilter();
        this.sortProducts(this.data.sortType);

        this._tabsLoaded.products = true;
        wx.hideLoading();

        // 后台从数据库同步最新数据（reset=true 确保初始化分页器）
        this.fetchProductsFromDatabase(true);
      });
      return;
    }

    // 如果没有缓存，直接从数据库获取（reset=true 确保初始化分页器）
    this.fetchProductsFromDatabase(true);
  },

  /**
   * 初始化普通商品分页器（无筛选条件）
   */
  initProductPaginator(extraQuery = {}, cursorField = '_id', sortOrder = 'desc') {
    // 合并基础查询条件和额外查询条件
    const query = {
      isDeleted: false,
      status: 'on',
      ...extraQuery
    };

    this.productPaginator = new PagePaginator(this, {
      collectionName: 'products',
      dataKey: 'originalProducts',
      pageSize: 18,
      cursorField: cursorField,
      sortOrder: sortOrder,
      extraQuery: query
    });
    
    // 初始化 CursorPagination 的 collectionName 和 baseQuery
    if (this.productPaginator.pagination) {
      this.productPaginator.pagination.collectionName = 'products';
      this.productPaginator.pagination.baseQuery = query;
    }
    
    // 从 paginatorStates 恢复状态（如果存在）
    const cacheKey = cursorField === 'createdAtTs' ? 'category_products_new' : 'category_products';
    const state = this.data.paginatorStates && this.data.paginatorStates[cacheKey];
    if (state && this.productPaginator.pagination) {
      // 根据缓存键确定正确的 cursor 字段
      let stateCursorField = '_id';
      if (cacheKey === 'category_products_new') {
        stateCursorField = 'createdAtTs';
      } else if (cacheKey === 'category_products_price_asc' || cacheKey === 'category_products_price_desc') {
        stateCursorField = 'price';
      }
      
      // 验证状态是否有效：totalLoaded 必须 >= 0，且 lastCursor 的类型必须匹配 cursorField
      const isValidState = state.totalLoaded >= 0 && 
        (state.lastCursor === null || 
         (stateCursorField === '_id' ? typeof state.lastCursor === 'string' : typeof state.lastCursor === 'number'));
      
      if (isValidState) {
        this.productPaginator.pagination.lastCursor = state.lastCursor !== undefined ? state.lastCursor : null;
        this.productPaginator.pagination.lastId = state.lastId !== undefined ? state.lastId : null;
        this.productPaginator.pagination.totalLoaded = state.totalLoaded || 0;
        this.productPaginator.pagination.hasNext = state.hasNext !== undefined ? state.hasNext : true;
        console.log('[宝贝页面] 从 paginatorStates 恢复综合/新品排序分页器状态:', cacheKey, state);
      } else {
        console.warn('[宝贝页面] paginatorStates 状态无效，使用默认值:', cacheKey, state);
        this.productPaginator.pagination.lastCursor = null;
        this.productPaginator.pagination.lastId = null;
        this.productPaginator.pagination.totalLoaded = 0;
        this.productPaginator.pagination.hasNext = true;
      }
    }
  },

  /**
   * 初始化搜索/筛选分页器（独立分页器，避免与普通列表混在一起）
   */
  initFilterPaginator(query = {}) {
    // 合并基础查询条件和筛选条件
    const filterQuery = {
      isDeleted: false,
      status: 'on',
      ...query
    };

    // 根据当前的 sortType 确定正确的排序字段
    let cursorField = '_id';
    let sortOrder = 'desc';
    let secondarySortField = '_id';
    let secondarySortOrder = 'asc';
    
    switch (this.data.sortType) {
      case 'price':
        cursorField = 'price';
        sortOrder = this.data.priceSortOrder;
        secondarySortField = '_id';
        secondarySortOrder = 'asc';
        break;
      case 'new':
        cursorField = 'createdAtTs';
        sortOrder = 'desc';
        secondarySortField = '_id';
        secondarySortOrder = 'desc';
        break;
      default:
        cursorField = '_id';
        sortOrder = 'desc';
        secondarySortField = '_id';
        secondarySortOrder = 'desc';
    }

    this.filterPaginator = new PagePaginator(this, {
      collectionName: 'products',
      dataKey: 'originalProducts',
      pageSize: 18,
      cursorField: cursorField,
      sortOrder: sortOrder,
      extraQuery: filterQuery,
      secondarySortField: secondarySortField,
      secondarySortOrder: secondarySortOrder
    });
    
    console.log('[宝贝页面] 初始化筛选分页器：sortType=', this.data.sortType, ', cursorField=', cursorField, ', sortOrder=', sortOrder);
  },

  /**
   * 初始化价格排序分页器（使用数据库排序：ORDER BY price, _id）
   */
  initPriceSortPaginator(order = 'asc') {
    const query = {
      isDeleted: false,
      status: 'on'
    };

    this.priceSortPaginator = new PagePaginator(this, {
      collectionName: 'products',
      dataKey: 'originalProducts',
      pageSize: 18,
      cursorField: 'price',
      sortOrder: order,
      extraQuery: query,
      secondarySortField: '_id',
      secondarySortOrder: order  // 二次排序跟随主排序顺序
    });
    
    // 初始化 CursorPagination 的 collectionName 和 baseQuery
    if (this.priceSortPaginator.pagination) {
      this.priceSortPaginator.pagination.collectionName = 'products';
      this.priceSortPaginator.pagination.baseQuery = query;
    }
    
    // 从 paginatorStates 恢复状态（如果存在）
    const cacheKey = `category_products_price_${order}`;
    const state = this.data.paginatorStates && this.data.paginatorStates[cacheKey];
    if (state && this.priceSortPaginator.pagination) {
      this.priceSortPaginator.pagination.lastCursor = state.lastCursor !== undefined ? state.lastCursor : null;
      this.priceSortPaginator.pagination.lastId = state.lastId !== undefined ? state.lastId : null;
      this.priceSortPaginator.pagination.totalLoaded = state.totalLoaded || 0;
      this.priceSortPaginator.pagination.hasNext = state.hasNext !== undefined ? state.hasNext : true;
      console.log('[宝贝页面] 从 paginatorStates 恢复价格排序分页器状态:', cacheKey, state);
    }
    
    console.log('[宝贝页面] 初始化价格排序分页器:', order);
  },

  /**
   * 从数据库获取商品数据（使用游标分页）
   */
  async fetchProductsFromDatabase(reset = false) {
    // 确保 _sortCacheKey 与当前排序方式一致
    let cacheKey;
    let cursorField = '_id';  // 默认使用 _id
    let sortOrder = 'desc';   // 默认降序
    
    switch (this.data.sortType) {
      case 'price':
        cacheKey = `category_products_price_${this.data.priceSortOrder}`;
        cursorField = 'price';  // 价格排序使用 price 作为游标
        sortOrder = this.data.priceSortOrder;
        break;
      case 'new':
        cacheKey = 'category_products_new';
        cursorField = 'createdAtTs';
        sortOrder = 'desc';
        break;
      default:
        cacheKey = 'category_products';
        cursorField = '_id';
        sortOrder = 'desc';
    }
    this._sortCacheKey = cacheKey;
    
    // 根据排序方式选择正确的分页器
    if (this.data.sortType === 'price') {
      // 价格排序：使用价格排序分页器
      if (reset || !this.priceSortPaginator) {
        this.initPriceSortPaginator(this.data.priceSortOrder);
        console.log('[宝贝页面] 初始化价格排序分页器：order=', this.data.priceSortOrder);
      }
    } else {
      // 其他排序：使用普通分页器
      if (reset || !this.productPaginator) {
        this.initProductPaginator({}, cursorField, sortOrder);
        console.log('[宝贝页面] 初始化分页器：cursorField=', cursorField, ', sortOrder=', sortOrder);
      }
    }

    if (reset && this.data.products.length === 0) {
      this.setData({ showSkeleton: true });
    }

    try {
      if (reset) {
        // 缓存优先：从 productCacheStore 读取数据
        const cache = productCacheStore.get(this._sortCacheKey || 'category_products');
        console.log('[宝贝页面] fetchProductsFromDatabase - reset=true, 缓存:', cache ? `有，长度=${cache.data?.length || 0}, stale=${cache.stale}` : '无');
        
        if (cache && cache.data && cache.data.length > 0 && !cache.stale) {
          // 如果缓存数据超过18条且没有更多数据，使用完整缓存；否则只取第一页
          // 这样可以避免因为异步问题导致的判断错误
          const useFullCache = cache.data.length > 18 && cache.hasMore === false;
          const dataToUse = useFullCache ? cache.data : cache.data.slice(0, 18);
          
          const cacheKey = this._sortCacheKey || 'category_products';
          console.log('[宝贝页面] 使用缓存数据，', useFullCache ? '保留完整缓存' : '截取前18条', '，缓存总长度:', cache.data.length, ', hasMore:', cache.hasMore);
          this.setData({ 
            products: dataToUse, 
            originalProducts: [...dataToUse], 
            showSkeleton: false,
            sortDataCache: {
              ...this.data.sortDataCache,
              [cacheKey]: { products: dataToUse, originalProducts: [...dataToUse] }
            },
            currentDisplaySort: cacheKey
          });
          this.__cacheIndex = useFullCache ? cache.data.length : 18;
          this._tabsLoaded.products = true;
          wx.hideLoading();
          console.log('[宝贝页面] 内存数据更新：products.length=', this.data.products.length, ', originalProducts.length=', this.data.originalProducts.length, ', __cacheIndex=', this.__cacheIndex);
          
          // 重要：同步更新分页器状态！
          // 如果缓存表示没有更多数据了，需要重置分页器的 hasNext 为 false
          this.setData({ hasMore: cache.hasMore });
          
          if (cache.hasMore === false) {
            console.log('[宝贝页面] 缓存显示无更多数据，重置 hasMore=false');
            // 重置对应的分页器
            if (this.data.sortType === 'price' && this.priceSortPaginator) {
              this.priceSortPaginator.reset();
            } else if (this.productPaginator) {
              this.productPaginator.reset();
            }
          } else {
            // 如果缓存有更多数据，初始化分页器以便继续加载
            // 并且设置游标指向缓存的最后一条数据
            const lastItem = cache.data[cache.data.length - 1];
            
            if (this.data.sortType === 'price') {
              // 价格排序：使用价格排序分页器
              if (!this.priceSortPaginator) {
                this.initPriceSortPaginator(this.data.priceSortOrder);
              }
              if (this.priceSortPaginator && this.priceSortPaginator.pagination) {
                this.priceSortPaginator.pagination.lastCursor = lastItem.price;
                this.priceSortPaginator.pagination.lastId = lastItem._id;
                this.priceSortPaginator.pagination.hasNext = true;
                console.log('[宝贝页面] 设置价格排序分页器游标:', lastItem.price, lastItem._id);
              }
            } else {
              // 其他排序：使用普通分页器
              let cursorField = this.data.sortType === 'new' ? 'createdAtTs' : '_id';
              if (!this.productPaginator) {
                this.initProductPaginator({}, cursorField, 'desc');
              }
              if (this.productPaginator && this.productPaginator.pagination) {
                this.productPaginator.pagination.lastCursor = lastItem[cursorField];
                this.productPaginator.pagination.lastId = lastItem._id;
                this.productPaginator.pagination.hasNext = true;
                console.log('[宝贝页面] 设置分页器游标:', lastItem._id);
              }
            }
          }
          
          // 后台从 DB 校验
          this._validateCategoryProductsCache(cache);
          return;
        }

        console.log('[宝贝页面] 无有效缓存，从数据库加载第一页');
        
        // 记录当前请求ID，用于防止竞态条件
        const requestId = this._sortRequestId;
        
        // 根据排序方式选择正确的分页器
        let data;
        let currentPaginator;
        if (this.data.sortType === 'price') {
          data = await this.priceSortPaginator.loadFirstPage();
          currentPaginator = this.priceSortPaginator;
        } else {
          data = await this.productPaginator.loadFirstPage();
          currentPaginator = this.productPaginator;
        }
        
        // 竞态条件检查：如果请求ID已过期，跳过本次结果
        if (requestId !== this._sortRequestId) {
          console.log('[宝贝页面] 请求已过期，跳过本次数据库结果');
          return;
        }
        
        console.log('[宝贝页面] 数据库返回:', data ? data.length : 0, '条');

        if (data && data.length > 0) {
          // 先更新 originalProducts 和 products
          this.setData({
            originalProducts: data,
            products: data
          });
          
          // 查询最新的 updatedAtTs 时间戳
          const timeRes = await db.collection('products')
            .where({ status: 'on', isDeleted: false })
            .orderBy('updatedAtTs', 'desc')
            .limit(1)
            .get();
          const serverMaxUpdateTime = timeRes.data?.[0]?.updatedAtTs || 0;
          
          this.setCachedProducts(this.data.originalProducts);
          // 写入 productCacheStore
          const cacheKey = this._sortCacheKey || 'category_products';
          const storageKey = 'product_cache_' + cacheKey;
          console.log('[宝贝页面] 写入缓存：key=', cacheKey, ', storageKey=', storageKey, ', 长度=', this.data.originalProducts.length);
          productCacheStore.set(this._sortCacheKey || 'category_products', {
            data: this.data.originalProducts,
            cacheIndex: this.data.originalProducts.length,
            cursor: this.data.originalProducts[this.data.originalProducts.length - 1]?._id || null,
            hasMore: currentPaginator.hasNext(),
            stale: false,
            serverMaxUpdateTime: serverMaxUpdateTime
          });
          this.__cacheIndex = this.data.originalProducts.length;
          console.log('[宝贝页面] 缓存写入完成，__cacheIndex=', this.__cacheIndex);
          
          // 同时写入 sortDataCache（内存缓存），用于快速切换排序
          const lastItem = this.data.originalProducts[this.data.originalProducts.length - 1];
          // 根据排序类型确定 cursor 字段
          let cursorField = '_id';
          if (cacheKey === 'category_products_new') {
            cursorField = 'createdAtTs';
          } else if (cacheKey === 'category_products_price_asc' || cacheKey === 'category_products_price_desc') {
            cursorField = 'price';
          }
          const lastCursor = lastItem ? (lastItem[cursorField] || lastItem._id) : null;
          
          this.setData({
            sortDataCache: {
              ...this.data.sortDataCache,
              [cacheKey]: { products: this.data.products, originalProducts: [...this.data.originalProducts] }
            },
            currentDisplaySort: cacheKey,
            // 更新当前排序的分页器状态
            paginatorStates: {
              ...this.data.paginatorStates,
              [cacheKey]: this.getPaginatorStateForCacheKey(cacheKey, this.data.originalProducts, currentPaginator.hasNext())
            }
          });
          console.log('[宝贝页面] sortDataCache 写入完成:', cacheKey);
        }

        this.setData({ showSkeleton: false });
        this.applySearchAndFilter();
        console.log('[宝贝页面] 第一页加载完成，内存数据：products.length=', this.data.products.length, ', originalProducts.length=', this.data.originalProducts.length);
      } else {
        // 加载更多：优先从缓存取
        console.log('[宝贝页面] loadMore - 开始，__cacheIndex=', this.__cacheIndex, ', searchKeyword=', !!this.data.searchKeyword);
        
        if (!this.data.searchKeyword && !(this.data.categories && this.data.categories.length > 0) && this.data.inStock === null) {
          const cache = productCacheStore.get(this._sortCacheKey || 'category_products');
          console.log('[宝贝页面] loadMore - 缓存:', cache ? `有，长度=${cache.data?.length || 0}` : '无');
          
          if (cache && cache.data && this.__cacheIndex != null && this.__cacheIndex < cache.data.length) {
            const page = cache.data.slice(this.__cacheIndex, this.__cacheIndex + 18);
            console.log('[宝贝页面] loadMore - 从缓存加载:', page.length, '条');
            this.__cacheIndex += page.length;
            const hasMore = this.__cacheIndex < cache.data.length || cache.hasMore;
            const cacheKey = this._sortCacheKey || 'category_products';
            const currentProducts = [...this.data.products, ...page];
            this.setData({
              products: currentProducts,
              originalProducts: [...this.data.originalProducts, ...page],
              showSkeleton: false,
              hasMore,
              loadingMore: false,
              sortDataCache: {
                ...this.data.sortDataCache,
                [cacheKey]: { 
                  products: currentProducts, 
                  originalProducts: [...this.data.originalProducts, ...page] 
                }
              }
            });
            console.log('[宝贝页面] loadMore - 内存数据更新：products.length=', this.data.products.length, ', originalProducts.length=', this.data.originalProducts.length, ', __cacheIndex=', this.__cacheIndex, ', hasMore=', hasMore);
            return;
          }
        }

        // 根据排序方式选择正确的分页器
        // 搜索/筛选模式下使用 filterPaginator，否则使用普通分页器
        let currentPaginator;
        if (hasFilters) {
          currentPaginator = this.filterPaginator;
        } else if (this.data.sortType === 'price') {
          currentPaginator = this.priceSortPaginator;
        } else {
          currentPaginator = this.productPaginator;
        }
        
        console.log('[宝贝页面] loadMore - 从数据库加载, hasNext:', currentPaginator.hasNext(), 'loading:', currentPaginator.loading, 'loadingMore:', currentPaginator.loadingMore);
        
        // 设置 loadingMore 防止重复触发
        this.setData({ loadingMore: true });
        
        const newData = await currentPaginator.loadNextPage();
        console.log('[宝贝页面] loadMore - loadNextPage 返回:', newData ? newData.length : 'undefined');
        const newProducts = newData || [];

        // 追加到 productCacheStore
        if (newProducts.length > 0) {
          const cursor = newProducts[newProducts.length - 1]?._id || null;
          console.log('[宝贝页面] loadMore - 追加到缓存：', newProducts.length, '条，cursor=', cursor);
          productCacheStore.append(this._sortCacheKey || 'category_products', newProducts, cursor, newProducts.length === 18);
          this.__cacheIndex += newProducts.length;
        }

        const hasFilters = (this.data.searchKeyword && this.data.searchKeyword.trim()) ||
                           (this.data.categories && this.data.categories.length > 0) ||
                           this.data.inStock !== null;

        // 更新 hasMore 状态
        const hasMore = currentPaginator.hasNext();
        
        const cacheKey = this._sortCacheKey || 'category_products';
        const currentProducts = [...this.data.products, ...newProducts];
        
        if (this.data.sortType === 'price' || hasFilters) {
          // 搜索/筛选模式下，加载更多后 loadNextPage 已经更新了 originalProducts
          // 只需要更新 products（保持筛选和排序）
          // 不再调用 applySearchAndFilter，避免重新过滤导致上架的商品丢失
          const updatedProducts = this.getSortedArray(this.data.originalProducts, this.data.sortType);
          
          // 价格排序时也需要更新 sortDataCache
          if (this.data.sortType === 'price' && !hasFilters) {
            const lastItem = newProducts[newProducts.length - 1];
            // 价格排序的 cursor 是 price
            const lastCursor = lastItem ? (lastItem.price !== undefined ? lastItem.price : lastItem._id) : null;
            this.setData({ 
              products: updatedProducts, 
              showSkeleton: false, 
              hasMore, 
              loadingMore: false,
              sortDataCache: {
                ...this.data.sortDataCache,
                [cacheKey]: { 
                  products: updatedProducts, 
                  originalProducts: [...this.data.originalProducts] 
                }
              },
              // 更新当前排序的分页器状态
              paginatorStates: {
                ...this.data.paginatorStates,
                [cacheKey]: this.getPaginatorStateForCacheKey(cacheKey, this.data.originalProducts, hasMore)
              }
            });
          } else {
            const lastItem = newProducts[newProducts.length - 1];
            const sortedProducts = this.getSortedArray(this.data.originalProducts, this.data.sortType);
            // 根据排序类型确定 cursor 字段
            let cursorField = '_id';
            if (cacheKey === 'category_products_new') {
              cursorField = 'createdAtTs';
            }
            const lastCursor = lastItem ? (lastItem[cursorField] || lastItem._id) : null;
            this.setData({ 
              products: sortedProducts, 
              showSkeleton: false, 
              hasMore, 
              loadingMore: false,
              sortDataCache: {
                ...this.data.sortDataCache,
                [cacheKey]: { 
                  products: sortedProducts, 
                  originalProducts: [...this.data.originalProducts] 
                }
              },
              // 更新当前排序的分页器状态
              paginatorStates: {
                ...this.data.paginatorStates,
                [cacheKey]: this.getPaginatorStateForCacheKey(cacheKey, this.data.originalProducts, hasMore)
              }
            });
          }
        } else if (newProducts.length > 0) {
          const lastItem = newProducts[newProducts.length - 1];
          this.setData({
            products: currentProducts,
            originalProducts: [...this.data.originalProducts, ...newProducts],
            showSkeleton: false,
            hasMore,
            loadingMore: false,
            sortDataCache: {
              ...this.data.sortDataCache,
              [cacheKey]: { 
                products: currentProducts, 
                originalProducts: [...this.data.originalProducts, ...newProducts] 
              }
            },
            // 更新当前排序的分页器状态
            paginatorStates: {
              ...this.data.paginatorStates,
              [cacheKey]: this.getPaginatorStateForCacheKey(cacheKey, [...this.data.originalProducts, ...newProducts], hasMore)
            }
          });
        } else {
          this.setData({ showSkeleton: false, hasMore, loadingMore: false });
        }
      }

      this._tabsLoaded.products = true;
      wx.hideLoading();
      this._isLoadingProducts = false; // 加载完成，重置标志
    } catch (err) {
      console.error('加载商品失败:', err);
      wx.hideLoading();
      this.setData({ showSkeleton: false, loadingMore: false });
      this._isLoadingProducts = false; // 加载失败，重置标志
    }
  },

  /**
   * 后台校验缓存数据（使用 updatedAtTs 时间戳对比）
   */
  async _validateCategoryProductsCache(cache) {
    try {
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // 竞态条件检查：如果当前排序类型对应的缓存Key与传入的缓存不匹配，跳过
      // 记录当前请求ID
      const requestId = this._sortRequestId;
      
      // 查询数据库最新的 updatedAtTs
      const timeRes = await db.collection('products')
        .where({ status: 'on', isDeleted: false })
        .orderBy('updatedAtTs', 'desc')
        .limit(1)
        .get();
      
      const serverMaxTime = timeRes.data?.[0]?.updatedAtTs || 0;
      const cachedMaxTime = cache.serverMaxUpdateTime || 0;
      
      console.log('[宝贝页面] 时间戳对比: 缓存=', cachedMaxTime, ', 数据库=', serverMaxTime);
      
      // 如果数据库的 updatedAtTs 大于缓存的，说明有商品被修改过
      if (serverMaxTime > cachedMaxTime) {
        console.log('[宝贝页面] 时间戳对比发现差异，需要更新');
        
        // 竞态条件检查：如果请求ID已过期，跳过本次更新
        if (requestId !== this._sortRequestId) {
          console.log('[宝贝页面] 请求已过期，跳过时间戳校验更新');
          return;
        }
        
        // 重新从数据库加载第一页数据
        const dbData = await this.productPaginator.loadFirstPage({}, { skipSetData: true });
        const newData = dbData || [];
        
        // 获取新的 updatedAtTs
        const newTimeRes = await db.collection('products')
          .where({ status: 'on', isDeleted: false })
          .orderBy('updatedAtTs', 'desc')
          .limit(1)
          .get();
        const newServerMaxTime = newTimeRes.data?.[0]?.updatedAtTs || 0;
        
        // 保留已加载的后续页面数据，只替换第一页
        let mergedData = newData;
        if (cache.data && cache.data.length > newData.length) {
          // 缓存有更多数据，保留后续页
          const remainingData = cache.data.slice(newData.length);
          mergedData = [...newData, ...remainingData];
          console.log('[宝贝页面] 时间戳校验：保留后续页面数据，原缓存', cache.data.length, '条，合并后', mergedData.length, '条');
        }
        
        this.setData({ originalProducts: mergedData });
        this.setCachedProducts(mergedData);
        productCacheStore.set(this._sortCacheKey || 'category_products', {
          data: mergedData,
          cacheIndex: mergedData.length,
          cursor: mergedData[mergedData.length - 1]?._id || null,
          hasMore: this.productPaginator.hasNext(),
          stale: false,
          serverMaxUpdateTime: newServerMaxTime
        });
        this.__cacheIndex = mergedData.length;
        this.applySearchAndFilter();
      } else {
        console.log('[宝贝页面] 时间戳对比无差异，缓存有效');
      }
    } catch (err) {
      console.error('[宝贝页面] 后台校验失败:', err);
    }
  },
  
  /**
   * 加载更多商品（使用游标分页）
   */
  loadMoreProducts() {
    console.log('[宝贝页面] loadMoreProducts called');
    if (this.data.loadingMore || !this.data.hasMore || this.data.showSkeleton) {
      console.log('[宝贝页面] 不需要加载更多');
      return;
    }

    console.log('[宝贝页面] 开始加载更多商品');
    
    // 判断是否有搜索/筛选条件
    const { searchKeyword, categories, inStock } = this.data;
    const hasFilters = (searchKeyword && searchKeyword.trim()) ||
                       (categories && categories.length > 0) ||
                       inStock !== null;
    
    if (hasFilters) {
      // 有搜索/筛选条件时，使用新的分页器加载更多
      this.fetchProductsWithFilters(false);
    } else {
      // 没有搜索/筛选条件时，使用原来的方式
      this.fetchProductsFromDatabase();
    }
  },

  /**
   * 初始化系列列表分页器
   */
  initSeriesPaginator() {
    if (!this.seriesPaginator) {
      this.seriesPaginator = new PagePaginator(this, {
        collectionName: 'category',
        dataKey: 'seriesList',
        pageSize: 18,
        cursorField: 'sortOrder',
        sortOrder: 'asc',
        extraQuery: { status: 'on' },
        hasMoreKey: 'seriesListHasMore'
      });
    }
  },

  /**
   * 加载系列列表（使用游标分页）
   */
  async loadSeries(reset = false) {
    this.initSeriesPaginator();
    
    try {
      const data = reset ? await this.seriesPaginator.loadFirstPage() : await this.seriesPaginator.loadNextPage();
      
      if (data && data.length > 0 && reset) {
        this.setCachedSeries(this.data.seriesList);
      }
      this._tabsLoaded.series = true;
    } catch (err) {
      console.error('加载系列失败:', err);
      this.setData({ seriesListLoadingMore: false });
    }
  },

  loadMoreSeriesList() {
    if (this.data.seriesListLoadingMore || !this.data.seriesListHasMore) {
      return;
    }
    this.loadSeries();
  },

  resetSeriesListPage() {
    if (this.seriesPaginator) {
      this.seriesPaginator.reset();
    }
    this.setData({ seriesList: [] });
  },

  initCategoryPaginator() {
    if (!this.categoryPaginator) {
      this.categoryPaginator = new PagePaginator(this, {
        collectionName: 'product_types',
        dataKey: 'level1Categories',
        pageSize: 18,
        cursorField: 'sortOrder',
        sortOrder: 'asc',
        extraQuery: { level: 1 },
        hasMoreKey: 'categoryHasMore'
      });
    }
  },

  /**
   * 加载分类列表（包含二级分类，使用游标分页）
   */
  async loadCategories(reset = false) {
    this.initCategoryPaginator();
    
    if (reset) {
      this.setData({ categoryLoadingMore: true, categoryHasMore: true });
    } else {
      this.setData({ categoryLoadingMore: true });
    }
    
    try {
      const data = reset ? await this.categoryPaginator.loadFirstPage() : await this.categoryPaginator.loadNextPage();
      
      if (data && data.length > 0) {
        const level2Res = await db.collection('product_types').where({ level: 2 }).orderBy('sortOrder', 'asc').limit(100).get();
        const level2Categories = level2Res.data;
        
        const level1Categories = this.data.level1Categories.map(cat => ({
          ...cat,
          children: level2Categories.filter(sub => sub.parentId === cat._id)
        }));
        
        this.setData({ level1Categories });
        
        if (reset) {
          this.setCachedCategories(level1Categories);
        }
      }
      
      this.setData({ categoryLoadingMore: false });
      this._tabsLoaded.categories = true;
    } catch (err) {
      console.error('加载分类失败:', err);
      this.setData({ categoryLoadingMore: false });
    }
  },

  loadMoreCategories() {
    if (this.data.categoryLoadingMore || !this.data.categoryHasMore) {
      return;
    }
    this.loadCategories();
  },

  resetCategoryPage() {
    if (this.categoryPaginator) {
      this.categoryPaginator.reset();
    }
    this.setData({ level1Categories: [] });
  },

  /**
   * 刷新分类数据
   */
  refreshCategories() {
    console.log('[宝贝页面] 刷新分类数据');
    // 同时获取一级和二级分类
    Promise.all([
      db.collection('product_types').where({ level: 1 }).get(),
      db.collection('product_types').where({ level: 2 }).get()
    ]).then(([level1Res, level2Res]) => {
      const level1Categories = level1Res.data.map(cat => ({
        ...cat,
        children: level2Res.data.filter(sub => sub.parentId === cat._id)
      }))

      // 更新 UI
      this.setData({ level1Categories });

      // 更新缓存
      this.setCachedCategories(level1Categories);

      console.log('[宝贝页面] 分类数据刷新完成');
    }).catch(err => {
      console.error('[宝贝页面] 刷新分类失败:', err);
    });
  },

  /**
   * 刷新系列数据
   */
  refreshSeries() {
    console.log('[宝贝页面] 刷新系列数据');
    this.resetSeriesListPage();
    this.loadSeries(true);
  },

  /**
   * 计算顶部栏样式
   */
  calculateTopBarStyles() {
    const { activeTab, enableScrollHideTopBar, isTopBarVisible, scrollHideMode } = this.data;
    
    let pagePaddingTop = '254rpx';
    let tabsTop = '94rpx';
    let sortBarTop = '182rpx';
    let scrollViewHeight = 'calc(100vh - 254rpx)';
    
    if (activeTab === 'products') {
      if (enableScrollHideTopBar && !isTopBarVisible) {
        switch (scrollHideMode) {
          case 'both':
            // 隐藏标签栏和排序栏
            pagePaddingTop = '94rpx';
            tabsTop = '0rpx';
            sortBarTop = '0rpx';
            scrollViewHeight = 'calc(100vh - 94rpx)';
            break;
          case 'tabs':
            // 只隐藏标签栏（保留排序栏）
            pagePaddingTop = '166rpx';
            tabsTop = '0rpx';
            sortBarTop = '94rpx';
            scrollViewHeight = 'calc(100vh - 166rpx)';
            break;
          case 'sort':
            // 只隐藏排序栏（保留标签栏）
            pagePaddingTop = '166rpx';
            tabsTop = '94rpx';
            sortBarTop = '0rpx';
            scrollViewHeight = 'calc(100vh - 166rpx)';
            break;
          default:
            break;
        }
      }
    } else {
      pagePaddingTop = '166rpx';
      scrollViewHeight = 'calc(100vh - 166rpx)';
    }
    
    this.setData({
      pagePaddingTop,
      tabsTop,
      sortBarTop,
      scrollViewHeight
    });
  },

  /**
   * 宝贝标签商品列表滚动事件
   */
  onProductsScroll(e) {
    // 如果不在宝贝标签，直接返回
    if (this.data.activeTab !== 'products') {
      return;
    }
    
    // 如果未开启滑动隐藏顶部栏功能，完全跳过滚动事件处理
    if (!this.data.enableScrollHideTopBar) {
      return;
    }
    
    const currentScrollTop = e.detail.scrollTop;
    const lastScrollTop = this._lastScrollTop || 0;
    
    // 开启了滑动隐藏顶部栏功能
    const scrollDirection = currentScrollTop > lastScrollTop ? 'up' : 'down';
    let needUpdate = false;
    
    // 滚动到顶部时，强制显示顶部栏
    if (currentScrollTop <= 10) {
      if (!this.data.isTopBarVisible) {
        this.setData({ 
          isTopBarVisible: true,
          scrollDirection: 'down'
        });
        needUpdate = true;
      }
      this._lastScrollTop = currentScrollTop;
      if (needUpdate) {
        this.calculateTopBarStyles();
      }
      return;
    }
    
    // 只有在滚动超过一定阈值时才触发显示/隐藏
    if (Math.abs(currentScrollTop - lastScrollTop) > 30) {
      if (scrollDirection === 'up' && this.data.isTopBarVisible && currentScrollTop > 100) {
        // 上滑，隐藏顶部栏（根据 scrollHideMode 决定隐藏哪些）
        this.setData({ 
          isTopBarVisible: false,
          scrollDirection: 'up'
        });
        needUpdate = true;
      } else if (scrollDirection === 'down' && !this.data.isTopBarVisible) {
        // 下滑，显示顶部栏
        this.setData({ 
          isTopBarVisible: true,
          scrollDirection: 'down'
        });
        needUpdate = true;
      }
    }
    
    // 更新样式
    if (needUpdate) {
      this.calculateTopBarStyles();
    }
    
    // 更新上次滚动位置
    this._lastScrollTop = currentScrollTop;
  },

  /**
   * 切换标签
   */
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    console.log('[宝贝页面] 切换标签，从', this.data.activeTab, '切换到', tab);

    // 如果切换到相同的标签，不做任何操作
    if (tab === this.data.activeTab) {
      return;
    }

    // 切换到宝贝标签
    if (tab === 'products') {
      // 如果 isTopBarVisible 是 false，先把它设为 true，确保排序栏显示
      const shouldShowTopBar = !this.data.isTopBarVisible;
      if (shouldShowTopBar) {
        this.setData({ 
          activeTab: tab,
          isTopBarVisible: true 
        });
      } else {
        this.setData({ activeTab: tab });
      }
      this.calculateTopBarStyles();
      return;
    }

    // 切换到分类或系列标签，需要设置相应的数据
    const newData = { activeTab: tab };

    if (tab === 'series') {
      const seriesId = this.data.seriesList.length > 0 ? this.data.seriesList[0]._id : null;
      const seriesData = seriesId ? this.data.seriesList.find(item => item._id === seriesId) : null;

      Object.assign(newData, {
        selectedSeries: seriesId,
        selectedSeriesData: seriesData || {},
        seriesProducts: [],
        seriesPageNum: 0,
        seriesHasMore: true,
        selectedCategory: null,
        level2Categories: [],
        seriesListLoadingMore: false
      });
    } else if (tab === 'categories') {
      const categoryId = this.data.level1Categories.length > 0 ? this.data.level1Categories[0]._id : null;
      const categoryData = categoryId ? this.data.level1Categories.find(item => item._id === categoryId) : null;
      const level2Categories = categoryData && categoryData.children ? categoryData.children : [];

      Object.assign(newData, {
        selectedCategory: categoryId,
        selectedCategoryData: categoryData || {},
        level2Categories: level2Categories,
        selectedSeries: null,
        seriesProducts: [],
        categoryLoadingMore: false
      });
    }

    this.setData(newData);

    // 切换到系列标签后，通过分页加载系列商品
    if (tab === 'series' && newData.selectedSeries) {
      this.loadSeriesProducts(newData.selectedSeries, true);
    }
    
    // 更新顶部栏样式
    this.calculateTopBarStyles();
  },

  /**
   * 设置排序方式
   * 新品走 DB 端排序 + 独立缓存，避免客户端部分数据排序结果不一致
   */
  setSortType(e) {
    const type = e.currentTarget.dataset.type;
    const prevType = this.data.sortType;
    
    // 递增请求ID，用于防止竞态条件
    this._sortRequestId++;
    const currentRequestId = this._sortRequestId;

    if (type === 'price') {
      // 价格排序
      const newOrder = prevType !== 'price' ? 'asc' : (this.data.priceSortOrder === 'asc' ? 'desc' : 'asc');
      
      // 先检查是否有搜索/筛选条件（筛选条件下不使用缓存）
      const { searchKeyword, categories, inStock } = this.data;
      const hasSearch = searchKeyword && searchKeyword.trim() !== '';
      const hasCategories = categories && categories.length > 0;
      const hasStockFilter = inStock !== null;
      
      // 如果有筛选条件，继续使用筛选分页器（不读取缓存）
      if (hasSearch || hasCategories || hasStockFilter) {
        console.log('[宝贝页面] 筛选模式下切换价格排序，继续使用筛选分页器');
        const priceCacheKey = `category_products_price_${newOrder}`;
        this._sortCacheKey = priceCacheKey;
        this.setData({ sortType: type, priceSortOrder: newOrder, scrollTop: 0, products: [], originalProducts: [], hasMore: true });
        this.__cacheIndex = 0;
        this.fetchProductsWithFilters(true);
        this.startWatchers(priceCacheKey);
        return;
      }
      
      // 无筛选条件，尝试从缓存读取
      const priceCacheKey = `category_products_price_${newOrder}`;
      const priceCache = productCacheStore.get(priceCacheKey);
      
      // 优先检查 sortDataCache 中是否已有目标方向的数据
      const currentSortCache = this.data.sortDataCache[priceCacheKey];
      if (currentSortCache && currentSortCache.products && currentSortCache.products.length > 0) {
        console.log('[宝贝页面] 价格排序 - 使用内存缓存:', priceCacheKey, '长度:', currentSortCache.products.length);
        this._sortCacheKey = priceCacheKey;
        
        // 重新计算 paginatorStates（使用实际内存缓存数据）
        const newPaginatorState = this.getPaginatorStateForCacheKey(priceCacheKey, currentSortCache.originalProducts, true);
        
        // 确保分页器实例存在（如果没有则创建）
        if (!this.pricePaginator) {
          this.initPriceSortPaginator(newOrder);
        }
        
        // 更新分页器实例配置和状态（不创建新实例，避免从 paginatorStates 恢复错误状态）
        if (this.pricePaginator && this.pricePaginator.pagination) {
          this.pricePaginator.pagination.collectionName = 'products';
          this.pricePaginator.pagination.baseQuery = { isDeleted: false, status: 'on' };
          this.pricePaginator.pagination.cursorField = 'price';
          this.pricePaginator.pagination.sortOrder = newOrder;
          this.pricePaginator.pagination.lastCursor = newPaginatorState.lastCursor;
          this.pricePaginator.pagination.lastId = newPaginatorState.lastId;
          this.pricePaginator.pagination.totalLoaded = newPaginatorState.totalLoaded;
          this.pricePaginator.pagination.hasNext = newPaginatorState.hasNext;
          this.pricePaginator.pagination.skipCount = newPaginatorState.totalLoaded || 0;
        }
        
        this.setData({ 
          sortType: type, 
          priceSortOrder: newOrder, 
          scrollTop: 0,
          hasMore: newPaginatorState.hasNext,
          currentDisplaySort: priceCacheKey,
          // 同时更新 products 和 originalProducts，用于加载更多
          products: currentSortCache.products,
          originalProducts: [...currentSortCache.originalProducts],
          // 更新 paginatorStates
          paginatorStates: {
            ...this.data.paginatorStates,
            [priceCacheKey]: newPaginatorState
          }
        });
        
        this.__cacheIndex = currentSortCache.products.length;
        this.startWatchers(priceCacheKey);
        return;
      }
      
      if (priceCache && priceCache.data && priceCache.data.length > 0 && !priceCache.stale) {
        // 有缓存，直接使用并填充 sortDataCache
        console.log('[宝贝页面] 价格排序 - 使用缓存:', priceCacheKey, '长度:', priceCache.data.length);
        this._sortCacheKey = priceCacheKey;
        this.setData({ 
          sortType: type, 
          priceSortOrder: newOrder, 
          scrollTop: 0, 
          products: priceCache.data,
          originalProducts: [...priceCache.data],
          currentDisplaySort: priceCacheKey,
          sortDataCache: {
            ...this.data.sortDataCache,
            [priceCacheKey]: { products: priceCache.data, originalProducts: [...priceCache.data] }
          }
        });
        this.__cacheIndex = priceCache.data.length;
        
        // 后台异步时间戳对比
        this._validateCategoryProductsCacheAsync(priceCache);
        this.startWatchers(priceCacheKey);
        return;
      }
      
      // 没有缓存，从数据库加载显示并更新缓存
      console.log('[宝贝页面] 价格排序 - 无缓存，从数据库加载:', priceCacheKey);
      
      this._sortCacheKey = priceCacheKey;
      this.setData({ sortType: type, priceSortOrder: newOrder, scrollTop: 0, products: [], originalProducts: [], hasMore: true });
      this.__cacheIndex = 0;
      
      this.initPriceSortPaginator(newOrder);
      this.fetchProductsFromDatabase(true);
      this.startWatchers(priceCacheKey);
      return;
    }

    // 其他排序方式（综合、新品）
    this.setData({ sortType: type, scrollTop: 0 });

    // 检查是否有搜索/筛选条件
    const { searchKeyword, categories, inStock } = this.data;
    const hasSearch = searchKeyword && searchKeyword.trim() !== '';
    const hasCategories = categories && categories.length > 0;
    const hasStockFilter = inStock !== null;
    
    // 如果有筛选条件，继续使用筛选分页器
    if (hasSearch || hasCategories || hasStockFilter) {
      console.log('[宝贝页面] 筛选模式下切换排序，继续使用筛选分页器');
      this.setData({ products: [], originalProducts: [], hasMore: true });
      this.__cacheIndex = 0;
      this.fetchProductsWithFilters(true);
      const cacheKey = type === 'new' ? 'category_products_new' : 'category_products';
      this._sortCacheKey = cacheKey;
      this.startWatchers(cacheKey);
      return;
    }

    if (type === 'new') {
      // 新品排序：优先检查内存缓存 sortDataCache
      const newCacheKey = `category_products_${type}`;
      const memoryCache = this.data.sortDataCache[newCacheKey];
      if (memoryCache && memoryCache.products && memoryCache.products.length > 0) {
        console.log('[宝贝页面] 新品排序 - 使用内存缓存:', newCacheKey, '长度:', memoryCache.products.length);
        this._sortCacheKey = newCacheKey;
        
        // 重新计算 paginatorStates（使用实际内存缓存数据）
        const newPaginatorState = this.getPaginatorStateForCacheKey(newCacheKey, memoryCache.originalProducts, true);
        
        // 确保分页器实例存在（如果没有则创建）
        if (!this.productPaginator) {
          this.initProductPaginator({}, 'createdAtTs', 'desc');
        }
        
        // 更新分页器实例配置和状态（不创建新实例，避免从 paginatorStates 恢复错误状态）
        if (this.productPaginator && this.productPaginator.pagination) {
          this.productPaginator.pagination.collectionName = 'products';
          this.productPaginator.pagination.baseQuery = { isDeleted: false, status: 'on' };
          this.productPaginator.pagination.cursorField = 'createdAtTs';
          this.productPaginator.pagination.sortOrder = 'desc';
          this.productPaginator.pagination.lastCursor = newPaginatorState.lastCursor;
          this.productPaginator.pagination.lastId = newPaginatorState.lastId;
          this.productPaginator.pagination.totalLoaded = newPaginatorState.totalLoaded;
          this.productPaginator.pagination.hasNext = newPaginatorState.hasNext;
          this.productPaginator.pagination.skipCount = newPaginatorState.totalLoaded || 0;
        }
        
        this.setData({ 
          sortType: type,
          scrollTop: 0,
          hasMore: newPaginatorState.hasNext,
          currentDisplaySort: newCacheKey,
          // 同时更新 products 和 originalProducts，用于加载更多
          products: memoryCache.products,
          originalProducts: [...memoryCache.originalProducts],
          // 更新 paginatorStates
          paginatorStates: {
            ...this.data.paginatorStates,
            [newCacheKey]: newPaginatorState
          }
        });
        
        this.__cacheIndex = memoryCache.products.length;
        this.startWatchers(newCacheKey);
        return;
      }
      
      // 检查本地存储缓存
      const newCache = productCacheStore.get(newCacheKey);
      if (newCache && newCache.data && newCache.data.length > 0 && !newCache.stale) {
        console.log('[宝贝页面] 新品排序 - 使用存储缓存:', newCacheKey, '长度:', newCache.data.length);
        this._sortCacheKey = newCacheKey;
        this.setData({ 
          sortType: type,
          products: newCache.data, 
          originalProducts: [...newCache.data], 
          scrollTop: 0,
          currentDisplaySort: newCacheKey,
          sortDataCache: {
            ...this.data.sortDataCache,
            [newCacheKey]: { products: newCache.data, originalProducts: [...newCache.data] }
          }
        });
        this.__cacheIndex = newCache.data.length;
        this._validateCategoryProductsCacheAsync(newCache);
        this.startWatchers(newCacheKey);
        return;
      }
      
      // 没有缓存，从数据库加载显示并更新缓存
      console.log('[宝贝页面] 新品排序 - 无缓存，从数据库加载:', newCacheKey);
      this.initProductPaginator({}, 'createdAtTs', 'desc');
      this._sortCacheKey = newCacheKey;
      this.setData({ sortType: type, products: [], originalProducts: [], hasMore: true, scrollTop: 0 });
      this.__cacheIndex = 0;
      this.fetchProductsFromDatabase(true);
      this.startWatchers(newCacheKey);
    } else {
      // 综合排序：优先检查内存缓存 sortDataCache
      const defaultCacheKey = 'category_products';
      const memoryCache = this.data.sortDataCache[defaultCacheKey];
      if (memoryCache && memoryCache.products && memoryCache.products.length > 0) {
        console.log('[宝贝页面] 综合排序 - 使用内存缓存:', defaultCacheKey, '长度:', memoryCache.products.length);
        this._sortCacheKey = defaultCacheKey;
        
        // 重新计算 paginatorStates（使用实际内存缓存数据）
        const newPaginatorState = this.getPaginatorStateForCacheKey(defaultCacheKey, memoryCache.originalProducts, true);
        
        // 确保分页器实例存在（如果没有则创建）
        if (!this.productPaginator) {
          this.initProductPaginator({}, '_id', 'desc');
        }
        
        // 更新分页器实例配置和状态（不创建新实例，避免从 paginatorStates 恢复错误状态）
        if (this.productPaginator && this.productPaginator.pagination) {
          this.productPaginator.pagination.collectionName = 'products';
          this.productPaginator.pagination.baseQuery = { isDeleted: false, status: 'on' };
          this.productPaginator.pagination.cursorField = '_id';
          this.productPaginator.pagination.sortOrder = 'desc';
          this.productPaginator.pagination.lastCursor = newPaginatorState.lastCursor;
          this.productPaginator.pagination.lastId = newPaginatorState.lastId;
          this.productPaginator.pagination.totalLoaded = newPaginatorState.totalLoaded;
          this.productPaginator.pagination.hasNext = newPaginatorState.hasNext;
          this.productPaginator.pagination.skipCount = newPaginatorState.totalLoaded || 0;
        }
        
        this.setData({ 
          sortType: type,
          scrollTop: 0,
          hasMore: newPaginatorState.hasNext,
          currentDisplaySort: defaultCacheKey,
          // 同时更新 products 和 originalProducts，用于加载更多
          products: memoryCache.products,
          originalProducts: [...memoryCache.originalProducts],
          // 更新 paginatorStates
          paginatorStates: {
            ...this.data.paginatorStates,
            [defaultCacheKey]: newPaginatorState
          }
        });
        
        this.__cacheIndex = memoryCache.products.length;
        this.startWatchers(defaultCacheKey);
        return;
      }
      
      // 检查本地存储缓存
      const defaultCache = productCacheStore.get(defaultCacheKey);
      if (defaultCache && defaultCache.data && defaultCache.data.length > 0 && !defaultCache.stale) {
        console.log('[宝贝页面] 综合排序 - 使用存储缓存:', defaultCacheKey, '长度:', defaultCache.data.length);
        this._sortCacheKey = defaultCacheKey;
        this.setData({ 
          sortType: type,
          products: defaultCache.data, 
          originalProducts: [...defaultCache.data], 
          scrollTop: 0,
          currentDisplaySort: defaultCacheKey,
          sortDataCache: {
            ...this.data.sortDataCache,
            [defaultCacheKey]: { products: defaultCache.data, originalProducts: [...defaultCache.data] }
          }
        });
        this.__cacheIndex = defaultCache.data.length;
        this._validateCategoryProductsCacheAsync(defaultCache);
        this.startWatchers(defaultCacheKey);
        return;
      }
      
      // 没有缓存，从数据库加载显示并更新缓存
      console.log('[宝贝页面] 综合排序 - 无缓存，从数据库加载:', defaultCacheKey);
      this.initProductPaginator({}, '_id', 'desc');
      this._sortCacheKey = defaultCacheKey;
      this.setData({ sortType: type, products: [], originalProducts: [], hasMore: true, scrollTop: 0 });
      this.__cacheIndex = 0;
      this.fetchProductsFromDatabase(true);
      this.startWatchers(defaultCacheKey);
    }
  },

  /**
   * 从综合排序缓存加载并进行价格排序
   */
  async _loadPriceSortFromDefaultCache(order, priceCacheKey) {
    const defaultCache = productCacheStore.get('category_products');
    if (!defaultCache || !defaultCache.data || defaultCache.data.length === 0) {
      this._loadPriceSortFromDatabase(order, priceCacheKey);
      return;
    }

    // 检查综合排序缓存是否完整（hasMore 为 false 表示已加载全部）
    if (defaultCache.hasMore === true) {
      // 综合排序缓存不完整，需要从数据库加载全部数据
      console.log('[宝贝页面] 综合缓存不完整(hasMore=true)，从数据库加载:', priceCacheKey);
      this._loadPriceSortFromDatabase(order, priceCacheKey);
      return;
    }

    // 综合排序缓存完整，可以安全复用
    console.log('[宝贝页面] 从综合缓存加载价格排序:', priceCacheKey, '数据量:', defaultCache.data.length);
    const sorted = this.getSortedArray(defaultCache.data, 'price');
    await this._setPriceCacheAndData(order, priceCacheKey, sorted);
  },

  /**
   * 从数据库加载并进行价格排序
   */
  async _loadPriceSortFromDatabase(order, priceCacheKey) {
    console.log('[宝贝页面] 从数据库加载价格排序:', priceCacheKey);
    this.setData({ showSkeleton: true });
    
    try {
      // 使用综合排序的分页器加载所有数据
      this.initProductPaginator({}, '_id', 'desc');
      
      // 加载第一页
      const firstPage = await this.productPaginator.loadFirstPage({}, { skipSetData: true });
      if (!firstPage || firstPage.length === 0) {
        this.setData({ showSkeleton: false, products: [], originalProducts: [] });
        return;
      }
      
      // 加载剩余页面
      const allData = [...firstPage];
      while (this.productPaginator.hasNext()) {
        const nextPage = await this.productPaginator.loadNextPage({ skipSetData: true });
        if (nextPage && nextPage.length > 0) {
          allData.push(...nextPage);
        } else {
          break;
        }
      }
      
      // 进行价格排序
      const sorted = this.getSortedArray(allData, 'price');
      await this._setPriceCacheAndData(order, priceCacheKey, sorted);
    } catch (error) {
      console.error('[宝贝页面] 加载价格排序数据失败:', error);
      this.setData({ showSkeleton: false });
    }
  },

  /**
   * 设置价格缓存和页面数据
   */
  async _setPriceCacheAndData(order, priceCacheKey, sorted) {
    // 查询最新的 updatedAtTs 时间戳
    let serverMaxUpdateTime = 0;
    try {
      const timeRes = await db.collection('products')
        .where({ status: 'on', isDeleted: false })
        .orderBy('updatedAtTs', 'desc')
        .limit(1)
        .get();
      serverMaxUpdateTime = timeRes.data?.[0]?.updatedAtTs || 0;
    } catch (err) {
      console.error('[宝贝页面] 获取时间戳失败:', err);
    }
    
    // 保存到缓存
    productCacheStore.set(priceCacheKey, {
      data: sorted,
      cacheIndex: sorted.length,
      hasMore: false,
      timestamp: Date.now(),
      stale: false,
      serverMaxUpdateTime: serverMaxUpdateTime
    });
    
    // 更新页面数据
    this.setData({ 
      products: sorted, 
      originalProducts: [...sorted],
      showSkeleton: false,
      priceSortOrder: order
    });
    this.__cacheIndex = sorted.length;
    console.log('[宝贝页面] 价格排序完成:', priceCacheKey, '长度:', sorted.length);
  },

  /**
   * 获取排序后的数组（纯函数，不触发 setData）
   */
  getSortedArray(products, type, customOrder) {
    const sorted = [...products];
    const order = customOrder || this.data.priceSortOrder;
    switch (type) {
      case 'price':
        sorted.sort((a, b) => {
          const diff = order === 'asc' ? a.price - b.price : b.price - a.price;
          if (diff !== 0) return diff;
          // 二次排序：与分页器一致，跟随主排序顺序
          return order === 'asc' ? a._id.localeCompare(b._id) : b._id.localeCompare(a._id);
        });
        break;
      case 'new':
        sorted.sort((a, b) => {
          // 使用 createdAtTs（数字时间戳）排序，与分页器一致
          const tsA = a.createdAtTs || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
          const tsB = b.createdAtTs || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
          const diff = tsB - tsA; // 降序
          // 二次排序使用 _id desc，与分页器一致
          return diff !== 0 ? diff : b._id.localeCompare(a._id);
        });
        break;
      default:
        // 综合排序：按 _id 降序（最新的在前）
        sorted.sort((a, b) => {
          // _id 是字符串，使用 localeCompare 比较
          return b._id.localeCompare(a._id);
        });
        break;
    }
    return sorted;
  },

  /**
   * 统一生成 paginatorStates 条目
   * 根据 cacheKey 自动选择正确的 cursorField
   * @param {string} cacheKey - 缓存键
   * @param {Array} data - 数据数组
   * @param {boolean} hasMore - 是否还有更多数据
   * @returns {Object} paginatorStates 条目
   */
  getPaginatorStateForCacheKey(cacheKey, data, hasMore) {
    if (!data || data.length === 0) {
      return {
        lastCursor: null,
        lastId: null,
        totalLoaded: 0,
        hasNext: hasMore
      };
    }
    
    const lastItem = data[data.length - 1];
    
    // 根据缓存键确定 cursor 字段
    let cursorField = '_id';
    if (cacheKey === 'category_products_new') {
      cursorField = 'createdAtTs';
    } else if (cacheKey === 'category_products_price_asc' || cacheKey === 'category_products_price_desc') {
      cursorField = 'price';
    }
    
    const lastCursor = lastItem[cursorField] !== undefined ? lastItem[cursorField] : lastItem._id;
    
    return {
      lastCursor: lastCursor,
      lastId: lastItem._id,
      totalLoaded: data.length,
      hasNext: hasMore
    };
  },

  /**
   * 商品排序
   */
  sortProducts(type) {
    // 始终从原始数据排序，保证多次切换结果一致
    const sourceProducts = this.data.originalProducts.length > 0 ? this.data.originalProducts : this.data.products;
    const sorted = this.getSortedArray(sourceProducts, type);
    // 只排序，不切换顺序。顺序切换由点击排序按钮时处理
    this.setData({ products: sorted });
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
    console.log('[宝贝页面] 选择系列:', seriesId);
    
    const seriesData = this.data.seriesList.find(item => item._id === seriesId)
    
    this.setData({
      selectedSeries: seriesId,
      selectedCategory: null,
      level2Categories: [],
      selectedSeriesData: seriesData || {},
      seriesProducts: [],
      seriesPageNum: 0,
      seriesHasMore: true
    })
    
    this.loadSeriesProducts(seriesId, true);
  },

  async loadSeriesProducts(seriesId, reset = false) {
    if (!seriesId) return;
    
    const { seriesPageNum, seriesPageSize } = this.data;
    const pageNum = reset ? 0 : seriesPageNum;
    const skipNum = pageNum * seriesPageSize;
    
    this.setData({ seriesLoadingMore: true });
    
    try {
      const db = wx.cloud.database();
      const res = await db.collection('products')
        .where({ 
          isDeleted: false,
          categoryId: seriesId 
        })
        .orderBy('createdAt', 'desc')
        .skip(skipNum)
        .limit(seriesPageSize)
        .get();
      
      const newProducts = res.data || [];
      const hasMore = newProducts.length === seriesPageSize;
      const seriesProducts = reset ? newProducts : [...this.data.seriesProducts, ...newProducts];
      
      this.setData({
        seriesProducts,
        seriesHasMore: hasMore,
        seriesPageNum: reset ? 1 : pageNum + 1,
        seriesLoadingMore: false
      });
      
      console.log('[宝贝页面] 系列商品加载完成，数量:', seriesProducts.length);
    } catch (error) {
      console.error('[宝贝页面] 加载系列商品失败:', error);
      this.setData({ seriesLoadingMore: false });
    }
  },

  loadMoreSeriesProducts() {
    if (this.data.seriesLoadingMore || !this.data.seriesHasMore || !this.data.selectedSeries) {
      return;
    }
    this.loadSeriesProducts(this.data.selectedSeries);
  },

  /**
   * 选择分类
   */
  selectCategory(e) {
    const categoryId = e.currentTarget.dataset.id
    console.log('[宝贝页面] 选择分类:', categoryId);
    
    // 获取分类数据（包含二级分类）
    const categoryData = this.data.level1Categories.find(item => item._id === categoryId)
    
    // 从分类数据中获取二级分类（如果已缓存）
    const level2Categories = categoryData && categoryData.children ? categoryData.children : []
    
    this.setData({
      selectedCategory: categoryId,
      selectedSeries: null,
      seriesProducts: [],
      selectedCategoryData: categoryData || {},
      level2Categories: level2Categories
    })
    console.log('[宝贝页面] 分类数据加载完成，二级分类数量:', level2Categories.length);
  },

  /**
   * 跳转到商品详情页
   */
  goToProductDetail(e) {
    this.setData({ hasNavigatedAway: true });
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
    console.log('[宝贝页面] 收到搜索事件，keyword:', keyword);
    // 如果当前不是宝贝标签，切换到宝贝标签
    if (this.data.activeTab !== 'products') {
      this.setData({ activeTab: 'products' });
    }
    // 更新搜索条件
    this.setData({ searchKeyword: keyword });
    console.log('[宝贝页面] 设置searchKeyword后，data.searchKeyword:', this.data.searchKeyword);
    // 重新从数据库获取数据（带上搜索条件）
    this.fetchProductsWithFilters(true);
  },

  /**
   * 处理筛选事件
   */
  handleFilter(e) {
    const { category, inStock } = e.detail;
    console.log('[宝贝页面] 收到筛选事件，category:', category, ', inStock:', inStock);
    // 如果当前不是宝贝标签，切换到宝贝标签
    if (this.data.activeTab !== 'products') {
      this.setData({ activeTab: 'products' });
    }
    // 更新筛选条件
    this.setData({ 
      categories: category || [], 
      inStock: inStock 
    });
    console.log('[宝贝页面] 设置筛选条件后，data.categories:', this.data.categories, ', data.inStock:', this.data.inStock);
    // 重新从数据库获取数据（带上筛选条件）
    this.fetchProductsWithFilters(true);
  },

  /**
   * 带上搜索/筛选条件从数据库获取商品（使用独立的筛选分页器）
   */
  async fetchProductsWithFilters(reset = false) {
    const { searchKeyword, categories, inStock } = this.data;
    
    console.log('[宝贝页面] fetchProductsWithFilters called:', { searchKeyword, categories, inStock, reset });
    
    // 检查是否有任何筛选条件
    const hasSearch = searchKeyword && searchKeyword.trim() !== '';
    const hasCategories = categories && categories.length > 0;
    const hasStockFilter = inStock !== null;
    
    // 如果没有任何筛选条件，切换回普通列表
    if (!hasSearch && !hasCategories && !hasStockFilter) {
      console.log('[宝贝页面] 没有筛选条件，切换回普通列表');
      // 清空数据，强制从第一页开始
      this.setData({ 
        products: [], 
        originalProducts: [], 
        hasMore: true,
        scrollTop: 0 
      });
      this.__cacheIndex = 0;
      // 重置筛选分页器（如果存在）
      if (this.filterPaginator) {
        this.filterPaginator = null;
      }
      this.fetchProductsFromDatabase(true);
      return;
    }
    
    // 有筛选条件，从普通列表切换到搜索筛选列表，清空数据从第一页开始
    if (reset) {
      this.setData({ 
        products: [], 
        originalProducts: [], 
        hasMore: true,
        scrollTop: 0 
      });
      this.__cacheIndex = 0;
    }
    
    // 构建查询条件
    const query = {};
    
    // 添加搜索条件
    if (searchKeyword && searchKeyword.trim() !== '') {
      query.name = db.RegExp({ regexp: searchKeyword, options: 'i' });
    }
    
    // 添加分类筛选条件
    if (categories && categories.length > 0) {
      query.typeId = _.in(categories);
    }
    
    // 添加库存筛选条件
    if (inStock !== null) {
      if (inStock) {
        query.stock = _.gt(0);
      } else {
        query.stock = _.lte(0);
      }
    }
    
    // 只在 reset=true 时才重新初始化筛选分页器
    // 这样可以保持分页状态，支持加载更多
    if (reset || !this.filterPaginator) {
      this.initFilterPaginator(query);
    }
    
    if (reset) {
      wx.showLoading({ title: '搜索中...' });
    }
    
    try {
      let data;
      if (reset) {
        data = await this.filterPaginator.loadFirstPage();
        
        if (data && data.length > 0) {
          this.setCachedProducts(this.data.originalProducts);
        }
        
        // 应用搜索筛选和排序
        this.applySearchAndFilter();
        this.sortProducts(this.data.sortType);
        
        console.log('[宝贝页面] 筛选列表加载第一页完成，hasMore:', this.data.hasMore, ', 数据条数:', this.data.originalProducts.length);
      } else {
        data = await this.filterPaginator.loadNextPage();
        
        console.log('[宝贝页面] 筛选列表加载更多，返回数据条数:', data ? data.length : 0, ', hasMore:', this.filterPaginator.hasNext());
        
        if (data && data.length > 0) {
          // 加载更多后，需要对 originalProducts 重新排序并去重
          // 因为 loadNextPage 只是简单追加数据，可能有重复
          const sorted = this.getSortedArray(this.data.originalProducts, this.data.sortType);
          // 去重：按 _id 去除重复项
          const uniqueSorted = sorted.filter((item, index, arr) => 
            index === arr.findIndex(t => t._id === item._id)
          );
          this.setData({
            products: uniqueSorted
          });
        }
      }
      
      this.setData({ showSkeleton: false });
    } catch (err) {
      console.error('[宝贝页面] fetchProductsWithFilters 失败:', err);
    } finally {
      wx.hideLoading();
    }
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
    // 保存滚动位置用于标签切换时恢复
    this.scrollTop = currentScrollTop;
    console.log('[宝贝页面] onPageScroll, scrollTop:', currentScrollTop);
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
})