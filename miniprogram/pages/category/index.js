// pages/category/index.js
const db = wx.cloud.database()
import watcherManager from '../../utils/watcherManager';

Page({

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
    // 滚动相关
    isTopBarVisible: true,
    scrollDirection: 'up',
    // 标记是否离开过页面（去商品详情等）
    hasNavigatedAway: false,
    // 是否显示骨架屏
    showSkeleton: true,
    // 页面可见性状态
    pageVisible: false,
    // 页面隐藏期间是否有数据变更
    pendingRefresh: false
  },

  // 从缓存获取商品数据（永久缓存，由实时监听更新）
  getCachedProducts() {
    try {
      const cached = wx.getStorageSync('category_products');
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
      wx.setStorageSync('category_products', {
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
      this.loadProductsSilently();
      if (!cachedCategories) this.loadCategories();
      if (!cachedSeries) this.loadSeries();
      return;
    }
    
    this.initData();
  },

  /**
   * 静默加载最新数据（不显示loading，用于缓存更新）
   */
  loadProductsSilently() {
    console.log('[宝贝页面] 静默加载完整商品列表');
    
    // 静默加载时获取完整的商品列表，不应用筛选条件
    db.collection('products').where({ isDeleted: false }).get().then(res => {
      const newProducts = res.data;
      console.log('[宝贝页面] 从数据库获取到商品数量:', newProducts.length);
      
      // 更新缓存和原始数据
      this.setData({ originalProducts: newProducts });
      this.setCachedProducts(newProducts);
      
      // 重新应用搜索和筛选条件到当前显示的产品
      this.applySearchAndFilter();
      this.sortProducts(this.data.sortType);
    }).catch(err => {
      console.error('静默加载失败:', err);
    });
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    const wasHidden = !this.data.pageVisible;
    this.setData({ pageVisible: true });
    console.log('[宝贝页面] onShow 被调用, activeTab:', this.data.activeTab, 'products.length:', this.data.products.length);
    
    // 1. 先读取并同步最新数据（全局监听器可能已经更新了缓存）
    this.initData();
    
    // 2. 检查是否需要刷新分类或系列数据
    const app = getApp();
    if (app.globalData.typesNeedRefresh === true) {
      console.log('[宝贝页面] 分类数据需要刷新');
      app.globalData.typesNeedRefresh = false;  // 重置标记
      this.refreshCategories();
    }
    if (app.globalData.categoryNeedRefresh === true) {
      console.log('[宝贝页面] 系列数据需要刷新');
      app.globalData.categoryNeedRefresh = false;  // 重置标记
      this.refreshSeries();
    }
    
    // 3. 然后启动页面监听器，监听未来的变化
    if (wasHidden) {
      console.log('宝贝页面-实时监听重新连接');
      this.startWatchers();
    }
    
    const { products, seriesList, level1Categories } = this.data;
    
    console.log('category onShow - products.length:', products.length);
    console.log('category onShow - productsNeedRefresh:', app.globalData.productsNeedRefresh);
    
    if (app.globalData.productsNeedRefresh === true) {
      console.log('检测到商品数据变更，强制刷新');
      app.globalData.productsNeedRefresh = false;
      wx.showToast({ title: '刷新中...', icon: 'loading', duration: 800 });
      this.initData();
      return;
    }
    
    if (products.length > 0) {
      console.log('已有商品数据');
      if (seriesList.length === 0) {
        console.log('补全系列数据');
        this.loadSeries();
      }
      if (level1Categories.length === 0) {
        console.log('补全分类数据');
        this.loadCategories();
      }
      return;
    }
    
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
    
    console.log('没有数据，初始化');
    this.initData();
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    this.setData({ lastScrollTop: 0, isTopBarVisible: true });
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {
    this.setData({ pageVisible: false });
    console.log('[宝贝页面] 页面隐藏，关闭监听器');
    console.log('宝贝页面-实时监听关闭');
    // 页面隐藏时关闭监听器，节省资源
    this.stopWatchers();
  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
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
   * 启动实时监听（交错创建，避免同时发起多个 WebSocket 登录）
   */
  startWatchers() {
    console.log('[宝贝页面] 开始创建监听器');

    const createProductsWatcher = () => {
      console.log('[宝贝页面] 创建 products 监听');
      const watcher = db.collection('products').where({ isDeleted: false }).watch({
        onChange: (snapshot) => {
          const hasRealChange = snapshot.docChanges && snapshot.docChanges.some(c => c.dataType !== 'init');
          if (hasRealChange) {
            const w = watcherManager.get('category_products');
            if (w) w.reportHealthy();
          }

          if (!this.data.pageVisible) {
            this.setData({ pendingRefresh: true });
            return;
          }
          this.handleProductChanges(snapshot);
        },
        onError: (error) => {
          console.error('[宝贝页面] 商品监听失败:', error);
          watcherManager.autoReconnect('category_products', 'products watch error');
        }
      });
      return watcher;
    };

    // 只保留商品监听，分类和系列监听已去掉
    watcherManager.create('category_products', createProductsWatcher);
  },

  /**
   * 停止实时监听
   */
  stopWatchers() {
    watcherManager.destroy('category_products');
  },

  /**
   * 销毁实时监听
   */
  destroyWatchers() {
    this.stopWatchers();
  },

  /**
   * 处理商品数据变化
   */
  handleProductChanges(snapshot) {
    console.log('[宝贝页面] handleProductChanges被调用');
    console.log('[宝贝页面] snapshot:', snapshot);
    
    if (!snapshot || !snapshot.docChanges || snapshot.docChanges.length === 0) {
      console.log('[宝贝页面] docChanges为空或不存在');
      return;
    }
    
    console.log('[宝贝页面] docChanges:', snapshot.docChanges);
    
    const { products, originalProducts, seriesList, level1Categories } = this.data;
    console.log('[宝贝页面] 当前products数量:', products.length);
    
    let updatedProducts = [...products];
    let updatedOriginal = [...originalProducts];
    let updatedSeriesList = [...seriesList];
    let updatedCategories = [...level1Categories];
    let updatedSeriesProducts = [...this.data.seriesProducts];
    
    snapshot.docChanges.forEach(change => {
      const { doc, dataType } = change;
      const docId = doc._id;
      console.log('[宝贝页面] 处理变化 - dataType:', dataType, 'docId:', docId);
      console.log('[宝贝页面] 变化的文档:', doc);
      
      if (dataType === 'init') {
        console.log('[宝贝页面] 跳过init类型变化');
        return;
      }
      
      const index = updatedProducts.findIndex(p => p._id === docId);
      console.log('[宝贝页面] 在products中找到的位置:', index);
      
      if (dataType === 'add') {
        if (index === -1) {
          console.log('[宝贝页面] 添加新商品');
          // 注意：全局商品缓存由全局监听器更新，这里只负责UI更新
          updatedProducts.push(doc);
          updatedOriginal.push(doc);
        }
      } else if (dataType === 'update') {
        // 注意：全局商品缓存由全局监听器更新，这里只负责UI更新
        if (index !== -1) {
          console.log('[宝贝页面] 更新商品在products中');
          updatedProducts[index] = doc;
          updatedOriginal[index] = doc;
        }
        
        // 更新系列中的商品
        updatedSeriesList.forEach((series, seriesIndex) => {
          console.log('[宝贝页面] 检查系列:', seriesIndex, series.name);
          
          // 如果系列有products数组，更新它
          if (series.products) {
            const idx = series.products.findIndex(p => p._id === docId);
            console.log('[宝贝页面] 在系列', series.name, '中找到的位置:', idx);
            if (idx !== -1) {
              console.log('[宝贝页面] 更新系列中的商品:', series.name);
              series.products[idx] = {
                ...doc,
                isOutOfStock: doc.stock <= 0 && doc.status === 'on',
                isOffline: doc.status !== 'on'
              };
            }
          }
          
          // 无论系列是否有products数组，都检查并更新seriesProducts数组（系列标签页使用）
          if (this.data.selectedSeries === series._id) {
            const spIdx = updatedSeriesProducts.findIndex(p => p._id === docId);
            if (spIdx !== -1) {
              console.log('[宝贝页面] 更新seriesProducts数组');
              updatedSeriesProducts[spIdx] = {
                ...doc,
                isOutOfStock: doc.stock <= 0 && doc.status === 'on',
                isOffline: doc.status !== 'on'
              };
            }
          }
        });
        
        // 更新分类中的商品
        updatedCategories.forEach((cat, catIndex) => {
          console.log('[宝贝页面] 检查分类:', catIndex, cat.name);
          if (!cat.products) {
            console.log('[宝贝页面] 分类', cat.name, '没有products数组，跳过');
            return;
          }
          const idx = cat.products.findIndex(p => p._id === docId);
          console.log('[宝贝页面] 在分类', cat.name, '中找到的位置:', idx);
          if (idx !== -1) {
            console.log('[宝贝页面] 更新分类中的商品:', cat.name);
            cat.products[idx] = {
              ...doc,
              isOutOfStock: doc.stock <= 0 && doc.status === 'on',
              isOffline: doc.status !== 'on'
            };
          }
        });
      } else if (dataType === 'remove') {
        if (index !== -1) {
          console.log('[宝贝页面] 删除商品');
          updatedProducts.splice(index, 1);
          updatedOriginal.splice(index, 1);
        }
        
        // 从系列中删除商品
        updatedSeriesList.forEach((series, seriesIndex) => {
          console.log('[宝贝页面] 从系列中删除商品，检查系列:', seriesIndex, series.name);
          if (!series.products) {
            console.log('[宝贝页面] 系列', series.name, '没有products数组，跳过');
            return;
          }
          const idx = series.products.findIndex(p => p._id === docId);
          if (idx !== -1) {
            console.log('[宝贝页面] 从系列', series.name, '中删除商品');
            series.products.splice(idx, 1);
          }
        });
        
        // 从分类中删除商品
        updatedCategories.forEach((cat, catIndex) => {
          console.log('[宝贝页面] 从分类中删除商品，检查分类:', catIndex, cat.name);
          if (!cat.products) {
            console.log('[宝贝页面] 分类', cat.name, '没有products数组，跳过');
            return;
          }
          const idx = cat.products.findIndex(p => p._id === docId);
          if (idx !== -1) {
            console.log('[宝贝页面] 从分类', cat.name, '中删除商品');
            cat.products.splice(idx, 1);
          }
        });
      }
    });
    
    console.log('[宝贝页面] 准备setData更新UI');
    this.setData({
      products: updatedProducts,
      originalProducts: updatedOriginal,
      seriesList: updatedSeriesList,
      level1Categories: updatedCategories,
      seriesProducts: updatedSeriesProducts
    });
    console.log('[宝贝页面] setData完成');
    
    this.setCachedProducts(updatedProducts);
    this.applySearchAndFilter();
    console.log('[宝贝页面] 商品数据更新完成');
  },
  
  /**
   * 应用搜索和筛选条件
   */
  applySearchAndFilter() {
    const { searchKeyword, categories, inStock, originalProducts } = this.data;
    
    let filteredProducts = [...originalProducts];
    
    // 应用搜索条件
    if (searchKeyword && searchKeyword.trim() !== '') {
      filteredProducts = filteredProducts.filter(item => {
        const name = item.name || '';
        return name.toLowerCase().includes(searchKeyword.toLowerCase());
      });
    }
    
    // 应用分类筛选
    if (categories && categories.length > 0) {
      filteredProducts = filteredProducts.filter(item => 
        categories.includes(item.typeId)
      );
    }
    
    // 应用库存筛选
    if (inStock !== null) {
      if (inStock) {
        filteredProducts = filteredProducts.filter(item => item.stock > 0);
      } else {
        filteredProducts = filteredProducts.filter(item => item.stock <= 0);
      }
    }
    
    // 应用排序
    this.setData({ products: filteredProducts });
    this.sortProducts(this.data.sortType);
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
      })
      this.setCachedProducts(syncedProducts);
      
      // 应用搜索、筛选和排序
      this.applySearchAndFilter();
      this.sortProducts(this.data.sortType);
      
      this._tabsLoaded.products = true;
      wx.hideLoading();
      
      // 后台从数据库同步最新数据
      this.fetchProductsFromDatabase();
      return;
    }
    
    // 如果没有缓存，直接从数据库获取
    this.fetchProductsFromDatabase();
  },

  /**
   * 从数据库获取商品数据
   */
  fetchProductsFromDatabase() {
    db.collection('products').where({ isDeleted: false }).get().then(res => {
      const newProducts = res.data;
      console.log('[宝贝页面] 从数据库获取到商品数量:', newProducts.length);
      
      // 保存到原始数据和缓存
      this.setData({ 
        originalProducts: newProducts,
        showSkeleton: false
      })
      this.setCachedProducts(newProducts);
      
      // 应用搜索、筛选和排序
      this.applySearchAndFilter();
      this.sortProducts(this.data.sortType);
      
      this._tabsLoaded.products = true;
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
      // 检查数据是否有变化
      const newSeries = res.data;
      const currentSeries = this.data.seriesList;
      if (JSON.stringify(newSeries) === JSON.stringify(currentSeries)) {
        console.log('[宝贝页面] 系列数据没有变化，跳过更新');
        this._tabsLoaded.series = true;
        return;
      }
      this.setData({ seriesList: newSeries })
      this.setCachedSeries(newSeries)
      this._tabsLoaded.series = true;
    }).catch(err => {
      console.error('加载系列失败:', err)
    })
  },

  /**
   * 加载分类列表（包含二级分类）
   */
  loadCategories() {
    // 同时获取一级和二级分类
    Promise.all([
      db.collection('product_types').where({ level: 1 }).get(),
      db.collection('product_types').where({ level: 2 }).get()
    ]).then(([level1Res, level2Res]) => {
      const level1Categories = level1Res.data.map(cat => ({
        ...cat,
        children: level2Res.data.filter(sub => sub.parentId === cat._id)
      }))
      
      // 检查数据是否有变化
      const currentCategories = this.data.level1Categories;
      if (JSON.stringify(level1Categories) === JSON.stringify(currentCategories)) {
        console.log('[宝贝页面] 分类数据没有变化，跳过更新');
        this._tabsLoaded.categories = true;
        return;
      }
      
      this.setData({ level1Categories })
      this.setCachedCategories(level1Categories)
      this._tabsLoaded.categories = true;
    }).catch(err => {
      console.error('加载分类失败:', err)
    })
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
    db.collection('category').where({ status: 'on' }).get().then(res => {
      const newSeries = res.data;

      // 更新 UI
      this.setData({ seriesList: newSeries });

      // 更新缓存
      this.setCachedSeries(newSeries);

      console.log('[宝贝页面] 系列数据刷新完成');
    }).catch(err => {
      console.error('[宝贝页面] 刷新系列失败:', err);
    });
  },

  /**
   * 宝贝标签商品列表滚动事件
   */
  onProductsScroll(e) {
    if (this.data.activeTab !== 'products') {
      return;
    }
    
    const currentScrollTop = e.detail.scrollTop;
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
      return;
    }

    // 切换到分类或系列标签，需要设置相应的数据
    const newData = { activeTab: tab };

    if (tab === 'series') {
      const seriesId = this.data.seriesList.length > 0 ? this.data.seriesList[0]._id : null;
      const seriesData = seriesId ? this.data.seriesList.find(item => item._id === seriesId) : null;
      const seriesProducts = seriesId ? this.data.products.filter(p => p.categoryId === seriesId) : [];

      Object.assign(newData, {
        selectedSeries: seriesId,
        selectedSeriesData: seriesData || {},
        seriesProducts: seriesProducts,
        selectedCategory: null,
        level2Categories: []
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
        seriesProducts: []
      });
    }

    this.setData(newData);
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
    console.log('[宝贝页面] 选择系列:', seriesId);
    
    // 获取系列数据
    const seriesData = this.data.seriesList.find(item => item._id === seriesId)
    
    // 从缓存的商品列表中过滤该系列的商品
    const seriesProducts = this.data.products.filter(p => p.categoryId === seriesId)
    
    this.setData({
      selectedSeries: seriesId,
      selectedCategory: null,
      level2Categories: [],
      selectedSeriesData: seriesData || {},
      seriesProducts: seriesProducts
    })
    console.log('[宝贝页面] 系列商品加载完成，数量:', seriesProducts.length);
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