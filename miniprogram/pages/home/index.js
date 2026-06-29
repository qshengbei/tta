// pages/home/index.js
import { getCollection, getDB } from '../../utils/cloud';
import { getGlobalProductWatcher } from '../../utils/globalProductWatcher';
import errorLogger from '../../utils/errorLogger';

const db = getDB();

function isCloudUrl(src) {
  return src && typeof src === 'string' && src.startsWith('cloud://');
}

function collectCloudUrls(data, keys, set) {
  if (!data) return;
  if (Array.isArray(data)) {
    data.forEach(item => collectCloudUrls(item, keys, set));
    return;
  }
  if (typeof data === 'object') {
    keys.forEach(key => {
      if (data[key] && isCloudUrl(data[key])) set.add(data[key]);
    });
  }
}

async function batchConvertCloudUrls(data, imageKeys) {
  const cloudUrls = new Set();
  collectCloudUrls(data, imageKeys, cloudUrls);
  if (cloudUrls.size === 0) return data;

  try {
    const fileList = [...cloudUrls];
    const res = await wx.cloud.getTempFileURL({ fileList });
    const urlMap = {};
    (res.fileList || []).forEach(item => {
      if (item.tempFileURL) urlMap[item.fileID] = item.tempFileURL;
    });

    function replace(obj) {
      if (!obj) return;
      if (Array.isArray(obj)) {
        obj.forEach(replace);
        return;
      }
      if (typeof obj === 'object') {
        imageKeys.forEach(key => {
          if (obj[key] && urlMap[obj[key]]) obj[key] = urlMap[obj[key]];
        });
      }
    }
    replace(data);
  } catch (e) {
    console.error('[首页] 批量转换cloud文件URL失败:', e);
  }
  return data;
}

const IMAGE_KEYS = ['image', 'coverImage', 'mainImage'];

Page({

  /**
   * 页面的初始数据
   */
  data: {
    recommendedProducts: [],
    newProducts: [],
    newCarouselList: [],
    newCarouselIndex: 0,
    seriesList: [],
    bannerList: [],
    loading: false,
    bannerLoading: true,  // 轮播图加载状态
    error: false,
    errorMessage: '',
    pageVisible: false,
    pendingRefresh: false
  },

  // 双击检测相关
  lastTapTime: 0,
  lastTapIndex: -1,

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
      console.log('[首页] 获取全局商品缓存:', Object.keys(cache).length, '个商品');
    } catch (e) {
      console.error('[首页] 获取全局商品缓存失败:', e);
    }
    return cache;
  },

  /**
   * 从全局缓存获取商品详情
   */
  getProductFromGlobalCache(productId) {
    try {
      const key = `tta_product_${productId}`;
      const product = wx.getStorageSync(key);
      if (product && product.data) {
        return product.data;
      }
    } catch (e) {
      console.error('[首页] 获取商品缓存失败:', productId, e);
    }
    return null;
  },

  /**
   * 同步全局商品缓存到首页缓存
   * 注意：需要深拷贝以避免修改只读的存储对象
   */
  syncGlobalCacheToHomeCache(homeData, globalProductCache) {
    if (!homeData || !globalProductCache || Object.keys(globalProductCache).length === 0) {
      return homeData;
    }
    
    console.log('[首页] 开始同步全局商品缓存到首页缓存');
    
    // 深拷贝，避免修改只读的存储对象
    const clonedData = JSON.parse(JSON.stringify(homeData));
    
    // 辅助函数：更新商品数据
    const updateProduct = (product) => {
      const updated = globalProductCache[product._id];
      if (updated) {
        return {
          ...updated,
          isOutOfStock: updated.stock <= 0 && updated.status === 'on',
          isOffline: updated.status !== 'on'
        };
      }
      return product;
    };
    
    // 更新 newProducts
    if (clonedData.newProducts) {
      clonedData.newProducts = clonedData.newProducts.map(updateProduct);
    }
    
    // 更新 extendedNewProducts
    if (clonedData.extendedNewProducts) {
      clonedData.extendedNewProducts = clonedData.extendedNewProducts.map(updateProduct);
    }
    
    // 更新 seriesList 中的商品
    if (clonedData.seriesList) {
      clonedData.seriesList = clonedData.seriesList.map(series => {
        if (series.products) {
          return {
            ...series,
            products: series.products.map(updateProduct)
          };
        }
        return series;
      });
    }
    
    console.log('[首页] 同步完成');
    return clonedData;
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 记录页面加载开始时间
    this._pageLoadStartTime = Date.now();
    this._isLoading = true;
    // 标记是否首次进入（用于区分首次进入和从其他页面返回）
    this._isFirstEntry = true;
    console.log('[首页] ========== onLoad 开始 ==========');
    console.log('[首页] 页面加载开始时间:', new Date(this._pageLoadStartTime).toLocaleTimeString());
    
    // 使用固定页面ID，避免重复订阅
    this.__pageId = "home_page";
    
    // 初始化更新版本号
    const homeData = wx.getStorageSync('homeData');
    this._lastUpdateVersion = homeData?.updateVersion || 0;
    
    // 订阅全局商品监听
    const watcher = getGlobalProductWatcher();
    this._unsubscribe = watcher.subscribe(
      this.__pageId, 'home_products',
      (change) => this._onProductChanged(change)
    );
    
    this.loadProducts().then(() => {
      this._isLoading = false;
    }).catch(() => {
      this._isLoading = false;
    });
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    this._isPageVisible = true;
    const wasHidden = !this.data.pageVisible;
    this.setData({ pageVisible: true });
    console.log('[首页] ========== onShow 开始 ==========');
    
    // 计算从 onLoad 到 onShow 的耗时
    if (this._pageLoadStartTime) {
      const onShowTime = Date.now();
      const onLoadToOnShow = onShowTime - this._pageLoadStartTime;
      console.log('[首页] ⏱️ onLoad → onShow 耗时:', onLoadToOnShow, 'ms');
    }
    
    // 设置页面可见性
    const watcher = getGlobalProductWatcher();
    watcher.setPageVisible(this.__pageId, true);
    
    // 立即设置 loading 为 false，确保页面不白屏
    if (this.data.loading) {
      this.setData({ loading: false });
    }
    
    // 如果正在加载，等待加载完成后再检查更新
    if (this._isLoading) {
      console.log('[首页] 正在加载中，等待完成后再检查更新');
      this.startNewCarousel();
      return;
    }
    
    // 判断是否是首次进入（onLoad后的第一次onShow）
    const isFirstEntry = this._isFirstEntry;
    // 首次进入后，后续的onShow都是从其他页面返回
    if (this._isFirstEntry) {
      this._isFirstEntry = false;
    }
    
    console.log('[首页] 页面进入方式:', isFirstEntry ? '首次进入' : '从其他页面返回');
    
    // 如果页面已有数据，直接显示，不做任何操作
    // 这样用户会立即看到离开前的页面
    if (this.data.seriesList && this.data.seriesList.length > 0) {
      console.log('[首页] --- 页面已有数据，直接显示 ---');
      
      // 计算页面显示总耗时
      if (this._pageLoadStartTime) {
        const displayTime = Date.now();
        const totalTime = displayTime - this._pageLoadStartTime;
        console.log('[首页] ⏱️ 页面显示总耗时:', totalTime, 'ms');
        console.log('[首页] ========== 页面已显示 ==========');
      }
    } else {
      // 如果页面没有数据，从缓存快速加载
      this._quickShowFromCache();
    }
    
    // 异步检测更新，不阻塞页面显示，有更新时静默更新UI
    this._asyncCheckAndUpdate(isFirstEntry);
    
    this.startNewCarousel();
  },

  /**
   * 快速显示缓存数据（仅在页面无数据时调用）
   */
  _quickShowFromCache() {
    const cacheStartTime = Date.now();
    console.log('[首页] --- 快速显示缓存数据 ---');
    
    const homeData = wx.getStorageSync('homeData');
    if (homeData && homeData.seriesList && homeData.seriesList.length > 0) {
      console.log('[首页] 系列列表长度:', homeData.seriesList.length);
      this.setData({
        seriesList: homeData.seriesList,
        newProducts: homeData.newProducts || [],
        extendedNewProducts: homeData.extendedNewProducts || [],
        bannerList: homeData.bannerList || [],
        loading: false
      });
      
      // 计算缓存加载耗时
      const cacheEndTime = Date.now();
      const cacheLoadTime = cacheEndTime - cacheStartTime;
      console.log('[首页] ⏱️ 缓存加载耗时:', cacheLoadTime, 'ms');
      
      // 计算页面显示总耗时
      if (this._pageLoadStartTime) {
        const totalTime = cacheEndTime - this._pageLoadStartTime;
        console.log('[首页] ⏱️ 页面显示总耗时:', totalTime, 'ms');
        console.log('[首页] ========== 页面已显示（从缓存）==========');
      }
    } else if (homeData && homeData.seriesList) {
      // 缓存存在但系列列表为空，设置空数据
      this.setData({
        seriesList: [],
        loading: false
      });
      
      console.log('[首页] ⏱️ 缓存加载耗时:', Date.now() - cacheStartTime, 'ms');
    }
  },

  /**
   * 异步检测并更新数据
   * @param {boolean} isFirstEntry - 是否是首次进入（用于区分首次进入和从其他页面返回）
   */
  async _asyncCheckAndUpdate(isFirstEntry = false) {
    console.log('[首页] --- 异步检测更新开始 ---');
    console.log('[首页] 进入方式:', isFirstEntry ? '首次进入' : '从其他页面返回');
    
    const watcher = getGlobalProductWatcher();
    const app = getApp();
    
    try {
      // 1. 监听器健康检查
      console.log('[首页] --- 步骤1: 监听器健康检查 ---');
      const healthCheck = watcher.checkNeedsRefresh();
      console.log('[首页] 监听器健康状态:', healthCheck);
      
      // 2. 检查更新标记
      console.log('[首页] --- 步骤2: 检查更新标记 ---');
      const updateMark = watcher.getAndClearUpdateMark('home_products');
      console.log('[首页] 更新标记:', updateMark);
      
      if (updateMark || healthCheck.needsRefresh) {
        console.log('[首页] 检测到缓存更新标记或监听器不健康');
        console.log('[首页] 原因:', healthCheck.needsRefresh ? healthCheck.reason : '更新标记存在');
        this.loadProducts();
        console.log('[首页] --- 异步检测结束（重新加载）---');
        return;
      }
      
      // 3. 检查轮播图和系列刷新标记
      console.log('[首页] --- 步骤3: 检查轮播图和系列刷新标记 ---');
      if (app.globalData.bannerNeedRefresh === true) {
        console.log('[首页] 轮播图需要刷新');
        app.globalData.bannerNeedRefresh = false;
        this.refreshBanner();
      }
      if (app.globalData.categoryNeedRefresh === true) {
        console.log('[首页] 系列数据需要刷新');
        app.globalData.categoryNeedRefresh = false;
        this.refreshCategory();
      }
      
      // 3.5. 后台异步刷新系列数据（不 await，不阻塞页面加载）
      console.log('[首页] --- 步骤3.5: 后台异步刷新系列数据 ---');
      this._asyncRefreshCategory();
      
      // 4. 检查缓存状态
      console.log('[首页] --- 步骤4: 检查缓存状态 ---');
      let homeData = wx.getStorageSync('homeData');
      console.log('[首页] 缓存存在:', !!homeData);
      console.log('[首页] 缓存状态:', homeData?.cacheStatus || '未设置');
      
      if (homeData.cacheStatus === 'corrupted') {
        console.log('[首页] 缓存状态为 corrupted，执行重新加载');
        this.loadProducts();
        console.log('[首页] --- 异步检测结束（缓存损坏）---');
        return;
      }
      
      if (homeData.cacheStatus === 'warning') {
        console.log('[首页] 缓存状态为 warning，执行版本对比');
        await this.checkAndRefreshIfNeeded();
        homeData = wx.getStorageSync('homeData'); // 重新读取缓存
        if (homeData) {
          homeData.cacheStatus = 'healthy';
          wx.setStorageSync('homeData', homeData);
          console.log('[首页] 缓存状态已恢复为 healthy');
        }
        console.log('[首页] --- 异步检测结束（警告处理）---');
        return;
      }
      
      // 5. 检查全局监听器是否更新了缓存（在其他页面时的更新）
      console.log('[首页] --- 步骤5: 检查监听器更新标记 ---');
      homeData = wx.getStorageSync('homeData'); // 重新读取最新缓存
      const currentVersion = this._lastUpdateVersion || 0;
      const cacheVersion = homeData?.updateVersion || 0;
      console.log('[首页] updateVersion - 当前:', currentVersion, ', 缓存:', cacheVersion);
      
      if (cacheVersion > currentVersion) {
        console.log('[首页] 检测到监听器更新的缓存');
        this._lastUpdateVersion = cacheVersion;
        
        // 只有当页面数据为空或缓存数据有变化时才更新UI
        // 避免不必要的 setData 导致 UI 闪烁
        const needsUpdate = !this.data.seriesList || this.data.seriesList.length === 0;
        
        if (needsUpdate && homeData.seriesList && homeData.seriesList.length > 0) {
          console.log('[首页] 页面数据为空，从缓存读取更新后的数据');
          this.setData({
            seriesList: homeData.seriesList,
            newProducts: homeData.newProducts || [],
            extendedNewProducts: homeData.extendedNewProducts || [],
            bannerList: homeData.bannerList || []
          });
        } else if (!needsUpdate) {
          console.log('[首页] 页面已有数据，跳过 UI 更新（后台静默更新）');
        }
        
        console.log('[首页] 更新版本已更新:', currentVersion, '→', cacheVersion);
        
        if (this.data.seriesList.length === 0) {
          console.log('[首页] 页面数据仍为空，执行重新加载');
          this.loadProducts();
        }
        
        console.log('[首页] --- 异步检测结束（缓存更新）---');
        return;
      }
      
      // 6. 智能刷新：对比服务器版本号，只有数据更新了才刷新
      // 只有在以下情况才执行步骤6：
      // - 首次进入：确保缓存是最新的（用户可能长时间未打开小程序）
      // - 页面数据为空：需要从服务器获取数据
      // 从其他页面返回时不需要执行，因为全局监听器已经处理了更新
      if (isFirstEntry || this.data.seriesList.length === 0) {
        console.log('[首页] --- 步骤6: 智能刷新（版本对比）---');
        console.log('[首页] 触发原因:', isFirstEntry ? '首次进入' : '页面数据为空');
        
        // 注意：checkAndRefreshIfNeeded() 内部如果版本不同会调用 loadProducts()
        // loadProducts() 会先显示缓存数据再后台刷新，不会导致白屏
        await this.checkAndRefreshIfNeeded();
        
        // 如果页面数据仍然为空，执行重新加载
        if (this.data.seriesList.length === 0) {
          console.log('[首页] 页面数据为空，执行重新加载');
          this.loadProducts();
        }
      } else {
        console.log('[首页] --- 从其他页面返回，页面已有数据，跳过服务器版本对比 ---');
      }
      
      console.log('[首页] --- 异步检测结束 ---');
    } catch (error) {
      console.error('[首页] 异步检测更新失败:', error);
      errorLogger.logCatchError(error, {
        pageName: 'home',
        methodName: '_asyncCheckAndUpdate',
        location: 'home/index.js:_asyncCheckAndUpdate'
      });
    }
  },

  /**
   * 智能刷新：对比服务器版本号，只有数据更新了才刷新
   */
  async checkAndRefreshIfNeeded() {
    console.log('[首页] ========== 开始智能刷新 ==========');
    
    try {
      // 获取本地缓存的版本号
      const cachedData = wx.getStorageSync('homeData');
      const localVersion = cachedData?.version || '0';
      
      console.log('[首页] 本地缓存版本:', localVersion);
      console.log('[首页] 当前云环境:', getApp().globalData.env);
      
      // 调用云函数获取服务器版本号
      console.log('[首页] 准备调用云函数: getProductVersion');
      
      const startTime = Date.now();
      const res = await wx.cloud.callFunction({
        name: 'getProductVersion',
        data: {}
      });
      const endTime = Date.now();
      
      console.log('[首页] 云函数调用耗时:', endTime - startTime, 'ms');
      console.log('[首页] 云函数返回结果:', JSON.stringify(res, null, 2));
      
      if (res.result && res.result.success) {
        const serverVersion = res.result.version;
        
        console.log(`[首页] 版本对比 - 本地: ${localVersion}, 服务器: ${serverVersion}`);
        
        // 如果服务器版本更新，执行刷新（传递服务器版本号，避免重复调用）
        if (serverVersion !== localVersion && serverVersion !== '0') {
          console.log('[首页] 服务器数据已更新，执行刷新');
          this.loadProducts(serverVersion);
        } else {
          console.log('[首页] 数据未更新，使用缓存');
        }
      } else {
        console.warn('[首页] 云函数返回格式异常:', res);
      }
    } catch (error) {
      console.error('[首页] ========== 云函数调用错误详情 ==========');
      console.error('[首页] 错误对象:', error);
      console.error('[首页] 错误码:', error.errCode);
      console.error('[首页] 错误信息:', error.errMsg);
      
      errorLogger.logCloudFunctionError({
        pageName: 'home',
        methodName: 'checkAndRefreshIfNeeded',
        functionName: 'getProductVersion',
        inputParams: {},
        message: error.message || String(error),
        stack: error.stack || '',
        code: error.errCode || '',
        location: 'home/index.js:checkAndRefreshIfNeeded'
      });
      
      console.log('[首页] --- 执行降级处理 ---');
      const fallbackVersion = Date.now().toString();
      console.log('[首页] 降级版本号:', fallbackVersion);
      
      console.log('[首页] ========== 智能刷新结束（降级）==========');
    }
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {
    this._isPageVisible = false;
    this.setData({ pageVisible: false });
    console.log('[首页] 页面隐藏');
    this.stopNewCarousel();
    
    // 设置页面不可见
    getGlobalProductWatcher().setPageVisible(this.__pageId, false);
  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
    console.log('[首页] 页面卸载');
    
    // 设置卸载标记，防止异步操作继续执行
    this._isUnloaded = true;
    
    this.stopNewCarousel();
    
    // 取消订阅
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    
    // 清理所有定时器
    clearTimeout(this._staggerTimer2);
    clearTimeout(this._staggerTimer3);
  },

  /**
   * 全局监听器回调处理
   * @param {Object} change { type: 'add'|'modify'|'remove'|'update', product, docId, cacheKey }
   */
  async _onProductChanged(change) {
    console.log('[首页] _onProductChanged:', change);
    
    // 检查页面是否已卸载
    if (this._isUnloaded) {
      console.log('[首页] 页面已卸载，跳过更新');
      return;
    }
    
    if (!this._isPageVisible) {
      console.log('[首页] 页面不可见，跳过更新');
      return;
    }

    // 简化处理：直接从缓存读取最新数据更新UI
    // 补位逻辑已由全局监听器统一处理
    const homeData = wx.getStorageSync('homeData');
    if (homeData && homeData.seriesList && homeData.seriesList.length > 0) {
      console.log('[首页] 从缓存读取更新后的数据');
      this.setData({
        seriesList: homeData.seriesList,
        newProducts: homeData.newProducts || [],
        extendedNewProducts: homeData.extendedNewProducts || [],
        bannerList: homeData.bannerList || []
      });
      
      // 更新轮播图
      const finalProducts = this.data.newProducts.slice(0, 20);
      let extendedNewProducts = [];
      if (finalProducts.length > 0) {
        extendedNewProducts.push(finalProducts[finalProducts.length - 1]);
        extendedNewProducts.push(...finalProducts);
        extendedNewProducts.push(finalProducts[0]);
      }
      
      const newCarouselIndex = 0;
      const newCarouselList = this.computeNewCarouselList(finalProducts, newCarouselIndex);
      
      this.setData({
        extendedNewProducts,
        newCarouselList,
        newCarouselIndex
      });
    } else {
      console.warn('[首页] 缓存数据为空，执行重新加载');
      this.loadProducts();
    }
    
    console.log('[首页] 商品增量更新完成');
  },

  /**
   * 补齐指定系列商品至3个
   * @param {Array} seriesList - 系列列表
   * @param {string} categoryId - 需要补齐的分类ID
   */
  async _fillSeriesProducts(seriesList, categoryId) {
    const series = seriesList.find(s => s.id === categoryId);
    if (!series || series.products.length >= 3) {
      return;
    }
    
    const productsCollection = getCollection('products');
    const existingIds = series.products.map(p => p._id);
    
    const res = await productsCollection
      .where({
        categoryId: categoryId,
        status: 'on',
        _id: db.command.not(db.command.in(existingIds))
      })
      .orderBy('createTime', 'desc')
      .limit(3 - series.products.length)
      .get();
    
    const newProducts = res.data || [];
    if (newProducts.length > 0) {
      await batchConvertCloudUrls(newProducts, IMAGE_KEYS);
      newProducts.forEach(product => {
        series.products.push({
          ...product,
          isOutOfStock: product.stock <= 0 && product.status === 'on',
          isOffline: product.status !== 'on'
        });
      });
      console.log(`[首页] 系列 ${categoryId} 补齐了 ${newProducts.length} 个商品`);
    }
  },

  /**
   * 刷新指定系列的商品列表（从数据库获取最新的3个上架商品）
   * @param {Array} seriesList - 系列列表
   * @param {string} categoryId - 需要刷新的分类ID
   */
  async _refreshSingleSeries(seriesList, categoryId) {
    const seriesIndex = seriesList.findIndex(s => s.id === categoryId);
    if (seriesIndex === -1) {
      return;
    }
    
    const productsCollection = getCollection('products');
    const res = await productsCollection
      .where({
        categoryId: categoryId,
        status: 'on'
      })
      .orderBy('createTime', 'desc')
      .limit(3)
      .get();
    
    const newProducts = res.data || [];
    if (newProducts.length > 0) {
      await batchConvertCloudUrls(newProducts, IMAGE_KEYS);
      seriesList[seriesIndex] = {
        ...seriesList[seriesIndex],
        products: newProducts.map(product => ({
          ...product,
          isOutOfStock: product.stock <= 0 && product.status === 'on',
          isOffline: product.status !== 'on'
        }))
      };
      console.log(`[首页] 系列 ${categoryId} 刷新完成，共 ${newProducts.length} 个商品`);
    }
  },

  /**
   * 修剪指定系列商品，保持最多3个
   * @param {Array} seriesList - 系列列表
   * @param {string} categoryId - 需要修剪的分类ID
   */
  _trimSeriesProducts(seriesList, categoryId) {
    const series = seriesList.find(s => s.id === categoryId);
    if (!series || series.products.length <= 3) {
      return;
    }
    
    series.products = series.products.slice(0, 3);
    console.log(`[首页] 系列 ${categoryId} 修剪至3个商品`);
  },

  /**
   * 系列增量更新
   */
  async handleCategoryIncrementalUpdate(snapshot) {
    if (!snapshot || !snapshot.docChanges || snapshot.docChanges.length === 0) {
      this.handleDataChange('category');
      return;
    }

    const productsCollection = getCollection('products');
    let needFullReload = false;

    for (const change of snapshot.docChanges) {
      const { dataType, doc, id } = change;

      if (dataType === 'init') continue;

      if (dataType === 'update' || dataType === 'add') {
        if (doc.status === 'on') {
          // 系列启用或更新，需要全量重新构建系列数据
          needFullReload = true;
          break;
        }
      } else if (dataType === 'remove') {
        // 系列删除，需要全量刷新
        needFullReload = true;
        break;
      }
    }

    if (needFullReload) {
      // 系列数据变化影响较大，重新构建系列结构
      const [categoryRes, productsRes] = await Promise.all([
        productsCollection.where({ status: 'on' }).orderBy('createTime', 'desc').get(),
        getCollection('products').get()
      ]);

      const categories = categoryRes.data;
      const products = productsRes.data;

      const seriesList = categories.slice(0, 3).map(category => {
        const seriesProducts = products.filter(product => product.categoryId === category._id && product.status === 'on');
        return {
          id: category._id,
          title: category.name,
          subtitle: category.subtitle,
          mainImage: category.image,
          status: category.status,
          products: seriesProducts.slice(0, 3).map(product => ({
            ...product,
            isOutOfStock: product.stock <= 0 && product.status === 'on',
            isOffline: product.status !== 'on'
          }))
        };
      });

      await batchConvertCloudUrls(seriesList, IMAGE_KEYS);

      await this.setData({ seriesList });

      // 更新缓存
      const rawCachedData = wx.getStorageSync('homeData') || {};
      const cachedData = JSON.parse(JSON.stringify(rawCachedData));
      wx.setStorageSync('homeData', {
        ...cachedData,
        seriesList,
        timestamp: Date.now()
      });

      // 预加载商品详情数据
      this.preloadProductData(seriesList);

      console.log('[首页] 系列增量更新完成');
    }
  },

  /**
   * 轮播图增量更新
   */
  async handleBannerIncrementalUpdate(snapshot) {
    if (!snapshot || !snapshot.docChanges || snapshot.docChanges.length === 0) {
      this.handleDataChange('banner');
      return;
    }

    // 转换变更文档中的 cloud:// URL
    const changedDocs = snapshot.docChanges.map(c => c.doc).filter(Boolean);
    await batchConvertCloudUrls(changedDocs, IMAGE_KEYS);

    const { bannerList } = this.data;
    const updatedBanners = [...bannerList];

    for (const change of snapshot.docChanges) {
      const { dataType, doc, id } = change;

      if (dataType === 'init') continue;

      const bannerIndex = updatedBanners.findIndex(b => b._id === id);

      if (dataType === 'update') {
        if (bannerIndex !== -1) {
          updatedBanners[bannerIndex] = doc;
        } else if (doc.isBanner === true) {
          updatedBanners.push(doc);
        }
      } else if (dataType === 'add') {
        if (doc.isBanner === true) {
          updatedBanners.push(doc);
        }
      } else if (dataType === 'remove') {
        if (bannerIndex !== -1) {
          updatedBanners.splice(bannerIndex, 1);
        }
      }
    }

    await this.setData({ bannerList: updatedBanners });

    // 更新缓存
    const rawCachedData = wx.getStorageSync('homeData') || {};
    const cachedData = JSON.parse(JSON.stringify(rawCachedData));
    wx.setStorageSync('homeData', {
      ...cachedData,
      bannerList: updatedBanners,
      timestamp: Date.now()
    });

    console.log('[首页] 轮播图增量更新完成');
  },

  /**
   * 监听tabBar点击事件
   */
  onTabItemTap(item) {
    const currentTime = Date.now();
    const tapIndex = item.index;
    
    // 判断是否为双击（300ms内点击同一tab）
    if (tapIndex === this.lastTapIndex && currentTime - this.lastTapTime < 300) {
      // 双击触发刷新
      console.log('双击首页tab，刷新页面');
      this.refreshPage();
    }
    
    this.lastTapTime = currentTime;
    this.lastTapIndex = tapIndex;
  },

  /**
   * 刷新页面数据
   */
  refreshPage() {
    // 清除缓存，强制重新加载
    wx.removeStorageSync('homeData');
    
    // 重置轮播
    this.stopNewCarousel();
    
    // 重新加载数据
    this.setData({
      loading: true,
      error: false,
      errorMessage: ''
    });
    
    // 滚动到顶部
    wx.pageScrollTo({
      scrollTop: 0,
      duration: 300
    });
    
    // 重新加载数据
    this.loadProducts(() => {
      wx.showToast({
        title: '刷新成功',
        icon: 'success',
        duration: 1000
      });
    });
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    this.loadProducts(() => {
      wx.stopPullDownRefresh();
    });
  },

  /**
   * 加载商品数据
   */
  async loadProducts(serverVersion, callback) {
    const loadStartTime = Date.now();
    console.log('[首页] ========== loadProducts 开始 ==========');
    
    // 先尝试从本地缓存获取数据（永久缓存，由实时监听更新）
    const rawCachedData = wx.getStorageSync('homeData');
    
    // 必须深拷贝，避免修改只读的存储对象
    let cachedData = rawCachedData ? JSON.parse(JSON.stringify(rawCachedData)) : {};
    
    if (cachedData && cachedData.seriesList && cachedData.seriesList.length > 0) {
      // 有缓存：先从缓存加载显示
      console.log('[首页] 从缓存加载数据');
      
      const globalProductCache = this.getGlobalProductCache();
      
      // 同步全局商品缓存数据到首页缓存
      if (globalProductCache && Object.keys(globalProductCache).length > 0) {
        cachedData = this.syncGlobalCacheToHomeCache(cachedData, globalProductCache);
      }
      
      const cachedNewProducts = cachedData.newProducts || [];
      const carouselList = this.computeNewCarouselList(cachedNewProducts, 0);
      
      // 立即显示缓存数据，不等待 URL 转换完成
      this.setData({
        seriesList: cachedData.seriesList,
        newProducts: cachedNewProducts,
        extendedNewProducts: cachedData.extendedNewProducts,
        newCarouselList: carouselList,
        newCarouselIndex: 0,
        bannerList: cachedData.bannerList || [],
        loading: false,
        bannerLoading: false
      });
      
      // 计算缓存加载耗时
      const cacheLoadTime = Date.now() - loadStartTime;
      console.log('[首页] ⏱️ 缓存加载耗时:', cacheLoadTime, 'ms');
      
      // 计算页面显示总耗时
      if (this._pageLoadStartTime) {
        const displayTime = Date.now();
        const totalTime = displayTime - this._pageLoadStartTime;
        console.log('[首页] ⏱️ 页面显示总耗时（从缓存）:', totalTime, 'ms');
        console.log('[首页] ========== 页面已显示 ==========');
      }
      
      if (carouselList.length >= 3) {
        this.startNewCarousel();
      }
      if (callback) callback();
      
      // 后台异步转换 cloud:// URL，不阻塞页面显示
      // 转换完成后静默更新缓存和UI
      this._convertCloudUrlsAndUpdate(cachedData);
      
      // 有缓存时，后台拉取数据库与缓存对比，有差异则静默更新
      this.refreshDataSilently();
      return;
    }

    // 无缓存：从数据库获取并更新永久缓存（传递版本号避免重复调用）
    this.loadProductsFromDatabase(callback, serverVersion);
  },
  
  /**
   * 后台异步转换 cloud:// URL，不阻塞页面显示
   * 转换完成后静默更新缓存和UI
   */
  async _convertCloudUrlsAndUpdate(cachedData) {
    try {
      // 检查是否有需要转换的 cloud:// URL
      const cloudUrls = new Set();
      collectCloudUrls(cachedData, IMAGE_KEYS, cloudUrls);
      if (cloudUrls.size === 0) {
        // 没有需要转换的 URL，直接更新缓存
        wx.setStorageSync('homeData', cachedData);
        return;
      }
      
      console.log('[首页] 后台转换 cloud:// URL，数量:', cloudUrls.size);
      
      // 执行 URL 转换
      await batchConvertCloudUrls(cachedData, IMAGE_KEYS);
      
      // 更新缓存
      wx.setStorageSync('homeData', cachedData);
      
      console.log('[首页] cloud:// URL 转换完成，缓存已更新');
    } catch (error) {
      console.error('[首页] 后台转换 cloud:// URL 失败:', error);
      errorLogger.logNetworkError({
        pageName: 'home',
        methodName: '_convertCloudUrlsAndUpdate',
        message: error.message || String(error),
        stack: error.stack || '',
        location: 'home/index.js:_convertCloudUrlsAndUpdate'
      });
    }
  },
  
  /**
   * 从数据库加载商品数据并更新缓存
   * @param {string} serverVersion - 可选的服务器版本号，如果已获取过可以传入避免重复调用
   */
  async loadProductsFromDatabase(callback, serverVersion) {
    const dbLoadStartTime = Date.now();
    console.log('[首页] ========== loadProductsFromDatabase 开始 ==========');
    console.log('[首页] 从数据库加载数据');
    
    const categoryCollection = getCollection('category');
    const productsCollection = getCollection('products');
    const bannerCollection = getCollection('banner');
    this.setData({ loading: true });

    // 优先加载轮播图
    bannerCollection.where({ isBanner: true }).get().then(bannerRes => {
      const banners = bannerRes.data || [];
      console.log('[首页] 轮播图加载完成:', banners.length, '张');
      
      // 转换轮播图的 cloud:// URL
      batchConvertCloudUrls({ bannerList: banners }, IMAGE_KEYS).then(() => {
        // 立即显示轮播图
        this.setData({ 
          bannerList: banners,
          bannerLoading: false
        });
      });
    }).catch(err => {
      console.error('[首页] 轮播图加载失败:', err);
      this.setData({ bannerLoading: false });
    });

    // 并行加载其他数据
    Promise.all([
      categoryCollection.where({ status: 'on' }).orderBy('createTime', 'desc').get(),
      productsCollection.get()
    ])
    .then(async ([categoryRes, productsRes]) => {
      const categories = categoryRes.data;
      const products = productsRes.data;

      const seriesList = categories.slice(0, 3).map(category => {
        const seriesProducts = products.filter(product => product.categoryId === category._id && product.status === 'on');
        return {
          id: category._id,
          title: category.name,
          subtitle: category.subtitle,
          mainImage: category.image,
          status: category.status,
          products: seriesProducts.slice(0, 3).map(product => ({
            ...product,
            isOutOfStock: product.stock <= 0 && product.status === 'on',
            isOffline: product.status !== 'on'
          }))
        };
      });

      const newProducts = products
        .filter(product => product.isNew === true && product.status === 'on')
        .map(product => ({
          ...product,
          isOutOfStock: product.stock <= 0 && product.status === 'on',
          isOffline: product.status !== 'on'
        }))
        .sort((a, b) => new Date(b.createTime) - new Date(a.createTime))
        .slice(0, 20);

      const extendedNewProducts = [];
      if (newProducts.length > 0) {
        extendedNewProducts.push(newProducts[newProducts.length - 1]);
        extendedNewProducts.push(...newProducts);
        extendedNewProducts.push(newProducts[0]);
      }

      const dataToConvert = { seriesList, newProducts, extendedNewProducts };
      await batchConvertCloudUrls(dataToConvert, IMAGE_KEYS);

      // 获取轮播图数据（可能已经加载完成）
      let banners = this.data.bannerList;
      if (!banners || banners.length === 0) {
        const bannerRes = await bannerCollection.where({ isBanner: true }).get();
        banners = bannerRes.data || [];
        await batchConvertCloudUrls({ bannerList: banners }, IMAGE_KEYS);
      }

      const newCarouselIndex = 0;
      const newCarouselList = this.computeNewCarouselList(newProducts, newCarouselIndex);

      this.setData({
        seriesList,
        newProducts,
        extendedNewProducts,
        newCarouselList,
        newCarouselIndex,
        bannerList: banners,
        loading: false,
        bannerLoading: false
      });
      
      // 计算数据库加载耗时
      const dbLoadEndTime = Date.now();
      const dbLoadTime = dbLoadEndTime - dbLoadStartTime;
      console.log('[首页] ⏱️ 数据库加载耗时:', dbLoadTime, 'ms');
      
      // 计算页面显示总耗时
      if (this._pageLoadStartTime) {
        const totalTime = dbLoadEndTime - this._pageLoadStartTime;
        console.log('[首页] ⏱️ 页面显示总耗时（从数据库）:', totalTime, 'ms');
        console.log('[首页] ========== 页面已显示 ==========');
      }

      // 获取当前服务器版本号（优先使用传入的版本号，避免重复调用云函数）
      let currentVersion = serverVersion || '0';
      
      if (!serverVersion) {
        // 如果没有传入版本号，才调用云函数获取
        try {
          console.log('[首页] --- 获取服务器版本号 ---');
          console.log('[首页] 当前云环境:', getApp().globalData.env);
          console.log('[首页] 调用云函数名: getProductVersion');
          console.log('[首页] 调用参数:', JSON.stringify({}));
          
          const startTime = Date.now();
          const versionRes = await wx.cloud.callFunction({
            name: 'getProductVersion',
            data: {}
          });
          const endTime = Date.now();
          
          console.log('[首页] 云函数调用耗时:', endTime - startTime, 'ms');
          console.log('[首页] versionRes:', JSON.stringify(versionRes, null, 2));
          console.log('[首页] versionRes.result:', versionRes.result ? JSON.stringify(versionRes.result, null, 2) : 'undefined');
          console.log('[首页] versionRes.result.success:', versionRes.result?.success);
          
          if (versionRes.result && versionRes.result.success) {
            currentVersion = versionRes.result.version;
            console.log('[首页] 成功获取版本号:', currentVersion);
          } else {
            console.warn('[首页] 服务器返回格式异常');
            console.log('[首页] result.success:', versionRes.result?.success);
            console.log('[首页] result.version:', versionRes.result?.version);
          }
        } catch (e) {
          console.error('[首页] 获取版本号失败:', e);
          console.error('[首页] 错误码:', e.errCode);
          console.error('[首页] 错误信息:', e.errMsg);
        }
      } else {
        console.log('[首页] --- 使用传入的版本号 ---');
        console.log('[首页] 版本号:', currentVersion);
      }
      console.log('[首页] 当前版本号最终值:', currentVersion);

      // 保留现有的 hasUpdates 标记（可能由全局监听器设置）
      const existingHomeData = wx.getStorageSync('homeData') || {};
      
      wx.setStorageSync('homeData', {
        ...existingHomeData,  // 保留原有字段
        seriesList,
        newProducts,
        extendedNewProducts,
        bannerList: banners,
        timestamp: Date.now(),
        version: currentVersion,
        watcherVersion: currentVersion,  // 同步版本号
        updateVersion: (existingHomeData.updateVersion || 0) + 1,
        cacheStatus: 'healthy'  // 标记缓存状态为健康
      });

      this.preloadProductData(seriesList);

      if (newCarouselList.length >= 3) {
        this.startNewCarousel();
      }

      if (callback) callback();
    })
    .catch(err => {
      console.error('加载数据失败', err);
      this.setData({
        loading: false,
        bannerLoading: false,
        error: true,
        errorMessage: '加载数据失败，请稍后重试'
      });
      if (callback) callback();
    });
  },
  
  /**
   * 后台静默刷新数据，与缓存对比有差异则更新UI
   */
  async refreshDataSilently() {
    try {
      const categoryCollection = getCollection('category');
      const productsCollection = getCollection('products');
      
      const [categoryRes, productsRes] = await Promise.all([
        categoryCollection.where({ status: 'on' }).orderBy('createTime', 'desc').get(),
        productsCollection.get()
      ]);
      
      const categories = categoryRes.data;
      const products = productsRes.data;
      
      // 构建最新的系列数据
      const freshSeriesList = categories.slice(0, 3).map(category => {
        const seriesProducts = products.filter(product => product.categoryId === category._id && product.status === 'on');
        return {
          id: category._id,
          title: category.name,
          subtitle: category.subtitle,
          mainImage: category.image,
          products: seriesProducts.slice(0, 3).map(product => ({
            ...product,
            isOutOfStock: product.stock <= 0 && product.status === 'on',
            isOffline: product.status !== 'on'
          }))
        };
      });
      
      // 对比缓存数据
      const cachedSeriesList = this.data.seriesList;
      const hasChanges = JSON.stringify(freshSeriesList) !== JSON.stringify(cachedSeriesList);
      
      if (hasChanges) {
        console.log('[首页] 检测到数据变化，静默更新');
        // 转换 cloud:// URL
        await batchConvertCloudUrls(freshSeriesList, IMAGE_KEYS);
        
        this.setData({ seriesList: freshSeriesList });
        
        // 更新缓存
        const rawCachedData = wx.getStorageSync('homeData') || {};
        const cachedData = JSON.parse(JSON.stringify(rawCachedData));
        wx.setStorageSync('homeData', {
          ...cachedData,
          seriesList: freshSeriesList,
          timestamp: Date.now()
        });
        
        // 预加载商品详情数据
        const allProductIds = freshSeriesList.flatMap(series => series.products.map(p => p._id));
        this.preloadProductData(allProductIds);
      } else {
        console.log('[首页] 数据无变化，无需更新');
      }
    } catch (err) {
      console.error('[首页] 静默刷新失败:', err);
      errorLogger.logDatabaseError({
        pageName: 'home',
        methodName: 'refreshDataSilently',
        message: err.message || String(err),
        stack: err.stack || '',
        location: 'home/index.js:refreshDataSilently'
      });
    }
  },

  /**
   * 刷新轮播图数据
   */
  refreshBanner() {
    console.log('[首页] 刷新轮播图数据');
    const bannerCollection = getCollection('banner');

    bannerCollection.where({ isBanner: true }).get()
    .then(async (bannerRes) => {
      const banners = bannerRes.data;
      
      // 转换 cloud:// URL 为临时链接
      const dataToConvert = { bannerList: banners };
      await batchConvertCloudUrls(dataToConvert, IMAGE_KEYS);

      // 更新 UI
      this.setData({
        bannerList: banners
      });

      // 更新缓存
      const cachedData = wx.getStorageSync('homeData');
      if (cachedData) {
        // 深拷贝，避免修改只读对象
        const clonedData = JSON.parse(JSON.stringify(cachedData));
        clonedData.bannerList = banners;
        wx.setStorageSync('homeData', clonedData);
      }

      console.log('[首页] 轮播图数据刷新完成');
    })
    .catch(err => {
      console.error('[首页] 刷新轮播图失败', err);
    });
  },

  /**
   * 刷新系列数据
   */
  refreshCategory() {
    console.log('[首页] 刷新系列数据');
    const categoryCollection = getCollection('category');
    const productsCollection = getCollection('products');

    Promise.all([
      categoryCollection.where({ status: 'on' }).orderBy('createTime', 'desc').get(),
      productsCollection.get()
    ])
    .then(async ([categoryRes, productsRes]) => {
      const categories = categoryRes.data;
      const products = productsRes.data;

      // 构建系列数据
      const seriesList = categories.slice(0, 3).map(category => {
        const seriesProducts = products.filter(product => product.categoryId === category._id && product.status === 'on');
        return {
          id: category._id,
          title: category.name,
          subtitle: category.subtitle,
          mainImage: category.image,
          status: category.status,
          products: seriesProducts.slice(0, 3).map(product => ({
            ...product,
            isOutOfStock: product.stock <= 0 && product.status === 'on',
            isOffline: product.status !== 'on'
          }))
        };
      });

      const dataToConvert = { seriesList };
      await batchConvertCloudUrls(dataToConvert, IMAGE_KEYS);

      this.setData({
        seriesList
      });

      // 更新缓存
      const cachedData = wx.getStorageSync('homeData');
      if (cachedData) {
        // 深拷贝，避免修改只读对象
        const clonedData = JSON.parse(JSON.stringify(cachedData));
        clonedData.seriesList = seriesList;
        wx.setStorageSync('homeData', clonedData);
      }

      console.log('[首页] 系列数据刷新完成');
    })
    .catch(err => {
      console.error('[首页] 刷新系列数据失败', err);
    });
  },

  /**
   * 后台异步刷新系列数据（带超时控制和降级方案）
   * 不阻塞页面加载，只在数据有变化时才更新UI
   */
  async _asyncRefreshCategory() {
    const TIMEOUT = 8000;
    const startTime = Date.now();
    
    console.log('[首页] --- 后台异步刷新系列数据开始 ---');
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), TIMEOUT);
    });
    
    const refreshPromise = this._doRefreshCategory();
    
    try {
      const result = await Promise.race([refreshPromise, timeoutPromise]);
      
      if (result && result.changed) {
        const duration = Date.now() - startTime;
        console.log(`[首页] 系列数据刷新成功，耗时 ${duration}ms，已静默更新UI`);
      } else if (result && !result.changed) {
        const duration = Date.now() - startTime;
        console.log(`[首页] 系列数据无变化，耗时 ${duration}ms，跳过更新`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (error.message === 'Timeout') {
        console.warn(`[首页] 系列数据刷新超时（${TIMEOUT}ms），保持旧数据`);
      } else {
        console.error(`[首页] 系列数据刷新失败，耗时 ${duration}ms，保持旧数据`, error);
      }
      
      // 降级方案：保持旧数据，不更新UI
      // 用户仍然看到当前页面的数据，不会出现白屏或错误
    }
  },

  /**
   * 实际执行系列数据刷新
   * 返回 { changed: boolean }
   */
  async _doRefreshCategory() {
    try {
      const categoryCollection = getCollection('category');
      const productsCollection = getCollection('products');
      
      const [categoryRes, productsRes] = await Promise.all([
        categoryCollection.where({ status: 'on' }).orderBy('createTime', 'desc').get(),
        productsCollection.get()
      ]);
      
      const categories = categoryRes.data;
      const products = productsRes.data;
      
      // 构建新的系列数据
      const newSeriesList = categories.slice(0, 3).map(category => {
        const seriesProducts = products.filter(
          p => p.categoryId === category._id && p.status === 'on'
        );
        return {
          id: category._id,
          title: category.name,
          subtitle: category.subtitle,
          mainImage: category.image,
          status: category.status,
          products: seriesProducts.slice(0, 3).map(product => ({
            ...product,
            isOutOfStock: product.stock <= 0 && product.status === 'on',
            isOffline: product.status !== 'on'
          }))
        };
      });
      
      // 对比是否有变化（只对比关键字段）
      const hasChanged = this._compareSeriesList(this.data.seriesList, newSeriesList);
      
      if (hasChanged) {
        // 异步转换 URL（不阻塞）
        const dataToConvert = { seriesList: newSeriesList };
        await batchConvertCloudUrls(dataToConvert, IMAGE_KEYS);
        
        // 静默更新UI
        this.setData({
          seriesList: newSeriesList
        });
        
        // 更新缓存
        const cachedData = wx.getStorageSync('homeData');
        if (cachedData) {
          const clonedData = JSON.parse(JSON.stringify(cachedData));
          clonedData.seriesList = newSeriesList;
          wx.setStorageSync('homeData', clonedData);
        }
        
        return { changed: true };
      } else {
        return { changed: false };
      }
    } catch (error) {
      throw error;
    }
  },

  /**
   * 对比两个系列列表是否有变化
   * 只对比关键字段，避免因时间戳等无关字段导致误判
   */
  _compareSeriesList(oldList, newList) {
    if (!oldList || !newList) return true;
    if (oldList.length !== newList.length) return true;
    
    for (let i = 0; i < oldList.length; i++) {
      const oldSeries = oldList[i];
      const newSeries = newList[i];
      
      if (oldSeries.id !== newSeries.id) return true;
      if (oldSeries.title !== newSeries.title) return true;
      if (oldSeries.subtitle !== newSeries.subtitle) return true;
      if (oldSeries.mainImage !== newSeries.mainImage) return true;
      if (oldSeries.status !== newSeries.status) return true;
      
      if (!oldSeries.products || !newSeries.products) {
        if (oldSeries.products !== newSeries.products) return true;
      } else {
        if (oldSeries.products.length !== newSeries.products.length) return true;
        
        for (let j = 0; j < oldSeries.products.length; j++) {
          const oldProduct = oldSeries.products[j];
          const newProduct = newSeries.products[j];
          
          if (!oldProduct || !newProduct) {
            if (oldProduct !== newProduct) return true;
          } else {
            if (oldProduct._id !== newProduct._id) return true;
            if (oldProduct.name !== newProduct.name) return true;
            if (oldProduct.price !== newProduct.price) return true;
            if (oldProduct.stock !== newProduct.stock) return true;
            if (oldProduct.status !== newProduct.status) return true;
            if (oldProduct.isOutOfStock !== newProduct.isOutOfStock) return true;
            if (oldProduct.isOffline !== newProduct.isOffline) return true;
          }
        }
      }
    }
    
    return false;
  },

  /**
   * 后台刷新数据
   */
  refreshData() {
    console.log('[首页] refreshData被调用');
    const productsCollection = getCollection('products');
    const categoryCollection = getCollection('category');
    const bannerCollection = getCollection('banner');

    Promise.all([
      // 加载系列数据，筛选status为on的记录，按创建时间倒序排序
      categoryCollection.where({ status: 'on' }).orderBy('createTime', 'desc').get(),
      productsCollection.get(),
      // 加载轮播图数据，筛选isBanner为true的记录
      bannerCollection.where({ isBanner: true }).get()
    ])
    .then(async ([categoryRes, productsRes, bannerRes]) => {
      console.log('[首页] refreshData数据加载完成');
      const categories = categoryRes.data;
      const products = productsRes.data;
      const banners = bannerRes.data;

      const seriesList = categories.slice(0, 3).map(category => {
        const seriesProducts = products.filter(product => product.categoryId === category._id && product.status === 'on');
        return {
          id: category._id,
          title: category.name,
          subtitle: category.subtitle,
          mainImage: category.image,
          status: category.status,
          products: seriesProducts.slice(0, 3).map(product => ({
            ...product,
            isOutOfStock: product.stock <= 0 && product.status === 'on',
            isOffline: product.status !== 'on'
          }))
        };
      });

      const newProducts = products
        .filter(product => product.isNew === true && product.status === 'on')
        .map(product => ({
          ...product,
          isOutOfStock: product.stock <= 0 && product.status === 'on',
          isOffline: product.status !== 'on'
        }))
        .sort((a, b) => new Date(b.createTime) - new Date(a.createTime))
        .slice(0, 20);

      // 扩展新品推荐数据，添加前后各一个商品以确保轮播效果正常
      const extendedNewProducts = [];
      if (newProducts.length > 0) {
        // 添加最后一个商品到开头
        extendedNewProducts.push(newProducts[newProducts.length - 1]);
        // 添加所有商品
        extendedNewProducts.push(...newProducts);
        // 添加第一个商品到结尾
        extendedNewProducts.push(newProducts[0]);
      }

      // 转换 cloud:// URL 为临时链接
      const dataToConvert = { seriesList, newProducts, extendedNewProducts, bannerList: banners };
      await batchConvertCloudUrls(dataToConvert, IMAGE_KEYS);

      // 更新缓存
      wx.setStorageSync('homeData', {
        seriesList,
        newProducts,
        extendedNewProducts,
        bannerList: banners,
        timestamp: Date.now()
      });
      
      // 如果页面仍然显示，更新数据
      if (this.data.loading === false) {
        const newCarouselIndex = 0;
        this.setData({
          seriesList,
          newProducts,
          extendedNewProducts,
          newCarouselList: this.computeNewCarouselList(newProducts, newCarouselIndex),
          newCarouselIndex,
          bannerList: banners
        });
        if (newProducts.length >= 3) {
          this.startNewCarousel();
        }
      }
    })
    .catch(err => {
      console.error('后台刷新数据失败', err);
    });
  },

  /**
   * 预加载商品详情数据
   */
  preloadProductData(seriesList) {
    // 提取所有商品ID
    const productIds = [];
    
    // 支持两种参数类型：series数组或商品ID数组
    if (Array.isArray(seriesList) && seriesList.length > 0) {
      // 判断第一个元素的类型
      if (seriesList[0]._id && seriesList[0].products) {
        // series数组
        seriesList.forEach(series => {
          if (series.products && Array.isArray(series.products)) {
            series.products.forEach(product => {
              productIds.push(product._id);
            });
          }
        });
      } else if (typeof seriesList[0] === 'string') {
        // 商品ID数组
        productIds.push(...seriesList);
      }
    }
    
    // 预加载商品详情数据
    const productsCollection = getCollection('products');
    productIds.forEach(id => {
      // 这里可以预加载商品详情数据，实际项目中可以根据需要调整
      productsCollection.doc(id).get().then(res => {
        // 缓存商品详情数据
        wx.setStorageSync(`product_${id}`, {
          data: res.data,
          timestamp: Date.now()
        });
      }).catch(err => {
        console.error('预加载商品数据失败', err);
      });
    });
  },

  /**
   * 重新加载数据
   */
  reloadData() {
    this.setData({
      error: false,
      errorMessage: ''
    });
    this.loadProducts();
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
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {
    // 这里可以实现加载更多系列的逻辑
    // 由于当前数据结构是一次性加载所有系列，实际项目中可以实现分页加载
    console.log('上拉加载更多');
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    return {
      title: 'Touch the Aura',
      path: '/pages/home/index'
    };
  },

  /**
   * 新品推荐轮播：启动
   */
  startNewCarousel() {
    if (this._newCarouselTimer) return;
    if (!this.data.newProducts || this.data.newProducts.length < 3) return;
    this._newCarouselTimer = setInterval(() => {
      this.nextNewCarousel();
    }, 3000);
  },

  /**
   * 新品推荐轮播：停止
   */
  stopNewCarousel() {
    if (this._newCarouselTimer) {
      clearInterval(this._newCarouselTimer);
      this._newCarouselTimer = null;
    }
  },

  /**
   * 新品推荐轮播：下一帧
   */
  nextNewCarousel() {
    const products = this.data.newProducts || [];
    if (products.length < 3) return;
    let index = (this.data.newCarouselIndex || 0) + 1;
    if (index >= products.length) {
      index = 0;
    }
    const newCarouselList = this.computeNewCarouselList(products, index);
    this.setData({
      newCarouselIndex: index,
      newCarouselList
    });
  },

  /**
   * 计算轮播展示的 3 个新品
   */
  computeNewCarouselList(list, startIndex) {
    const result = [];
    if (!list || list.length < 3) return result;
    const len = list.length;
    for (let i = 0; i < 3; i++) {
      const idx = (startIndex + i) % len;
      result.push(list[idx]);
    }
    return result;
  }
})