// pages/home/index.js
import { getCollection } from '../../utils/cloud';
import watcherManager from '../../utils/watcherManager';

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
    this.loadProducts();
    // 等待登录完成后启动监听
    this.waitForLogin();
  },

  /**
   * 等待登录完成后启动监听（使用 app 回调机制，避免轮询）
   */
  waitForLogin() {
    const app = getApp();
    if (app.onLoginReady) {
      app.onLoginReady((openid) => {
        console.log('[首页] 登录就绪，延迟启动监听');
        // 延迟 500ms 确保 cloud WebSocket 认证就绪
        clearTimeout(this._loginReadyTimer);
        this._loginReadyTimer = setTimeout(() => {
          this.startWatchers();
        }, 500);
      });
    } else if (app.globalData.openid) {
      // 降级方案：openid 已存在，直接延迟启动
      this._loginReadyTimer = setTimeout(() => {
        this.startWatchers();
      }, 500);
    } else {
      // 降级方案：轮询等待
      console.log('[首页] 等待登录完成');
      this._loginPollTimer = setTimeout(() => {
        this.waitForLogin();
      }, 2000);
    }
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    const wasHidden = !this.data.pageVisible;
    this.setData({ pageVisible: true });
    console.log('[首页] 页面显示');
    
    // 1. 先读取并同步最新数据（全局监听器可能已经更新了缓存）
    this.loadProducts();
    
    // 2. 检查是否需要刷新轮播图或系列数据
    const app = getApp();
    if (app.globalData.bannerNeedRefresh === true) {
      console.log('[首页] 轮播图需要刷新');
      app.globalData.bannerNeedRefresh = false;  // 重置标记
      this.refreshBanner();
    }
    if (app.globalData.categoryNeedRefresh === true) {
      console.log('[首页] 系列数据需要刷新');
      app.globalData.categoryNeedRefresh = false;  // 重置标记
      this.refreshCategory();
    }
    
    // 3. 然后启动页面监听器，监听未来的变化
    if (wasHidden) {
      console.log('首页-实时监听重新连接');
      this.startWatchers();
    }
    
    if (this.data.seriesList.length === 0) {
      this.loadProducts();
    }
    this.startNewCarousel();
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {
    this.setData({ pageVisible: false });
    console.log('[首页] 页面隐藏，关闭监听器');
    console.log('首页-实时监听关闭');
    this.stopNewCarousel();
    // 页面隐藏时关闭监听器，节省资源
    this.stopWatchers();
  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
    console.log('[首页] 页面卸载，销毁监听');
    console.log('首页-实时监听关闭');
    this.stopNewCarousel();
    this.destroyWatchers();
    // 清理所有定时器
    clearTimeout(this._loginReadyTimer);
    clearTimeout(this._loginPollTimer);
    clearTimeout(this._staggerTimer2);
    clearTimeout(this._staggerTimer3);
  },

  /**
   * 启动实时监听（交错创建，避免同时发起多个 WebSocket 登录）
   */
  startWatchers() {
    console.log('[首页] 开始创建监听器');
    const db = wx.cloud.database();

    // 监听商品数据变化（第一个立即创建）
    const createProductsWatcher = () => {
      console.log('[首页] 创建 products 监听');
      return db.collection('products').watch({
        onChange: (snapshot) => {
          // 首次收到非 init 数据，报告监听器健康
          const hasRealChange = snapshot.docChanges && snapshot.docChanges.some(c => c.dataType !== 'init');
          if (hasRealChange) {
            const w = watcherManager.get('home_products');
            if (w) w.reportHealthy();
          }

          if (!this.data.pageVisible) {
            this.setData({ pendingRefresh: true });
            return;
          }
          this.handleProductIncrementalUpdate(snapshot);
        },
        onError: (error) => {
          console.error('[首页] 商品监听失败:', error);
          watcherManager.autoReconnect('home_products', 'products watch error');
        }
      });
    };

    // 只保留商品监听，轮播图和系列监听已去掉
    watcherManager.create('home_products', createProductsWatcher);
  },

  /**
   * 停止实时监听
   */
  stopWatchers() {
    watcherManager.destroy('home_products');
  },

  /**
   * 销毁实时监听
   */
  destroyWatchers() {
    this.stopWatchers();
  },

  /**
   * 处理数据变化（兜底全量刷新）
   */
  handleDataChange(type) {
    console.log(`[首页] ${type}数据变化，全量刷新页面`);
    this.refreshData();
  },

  /**
   * 商品增量更新
   */
  async handleProductIncrementalUpdate(snapshot) {
    console.log('[首页] handleProductIncrementalUpdate 被调用');
    console.log('[首页] snapshot.docChanges:', snapshot.docChanges);
    
    if (!snapshot || !snapshot.docChanges || snapshot.docChanges.length === 0) {
      console.log('[首页] docChanges为空或不存在，执行全量刷新');
      this.handleDataChange('products');
      return;
    }

    // 转换变更文档中的 cloud:// URL
    const changedDocs = snapshot.docChanges.map(c => c.doc).filter(Boolean);
    await batchConvertCloudUrls(changedDocs, IMAGE_KEYS);

    const { newProducts, seriesList } = this.data;
    console.log('[首页] 当前newProducts数量:', newProducts.length);
    console.log('[首页] 当前seriesList数量:', seriesList.length);

    let needFullReload = false;
    const updatedProducts = [...newProducts];
    const updatedSeriesList = [...seriesList];

    for (const change of snapshot.docChanges) {
      const { dataType, doc } = change;
      const docId = doc._id;
      console.log('[首页] 处理变化 - dataType:', dataType, 'docId:', docId, 'doc:', doc);

      if (dataType === 'init') {
        console.log('[首页] 跳过init类型变化');
        continue;
      }

      const productIndex = updatedProducts.findIndex(p => p._id === docId);
      console.log('[首页] 在newProducts中找到的位置:', productIndex);

      if (dataType === 'update') {
        // 更新商品
        // 注意：全局商品缓存由全局监听器更新，这里只负责UI更新
        if (productIndex !== -1) {
          if (doc.isNew === true) {
            updatedProducts[productIndex] = {
              ...doc,
              isOutOfStock: doc.stock <= 0 && doc.status === 'on',
              isOffline: doc.status !== 'on'
            };
          } else if (updatedProducts[productIndex].isNew === true) {
            // 原本是新品，现在不是了，需要移除
            updatedProducts.splice(productIndex, 1);
          } else {
            // 非新品更新（如价格、库存变化），直接更新
            updatedProducts[productIndex] = {
              ...doc,
              isOutOfStock: doc.stock <= 0 && doc.status === 'on',
              isOffline: doc.status !== 'on'
            };
          }
        } else {
          // 新增的新品
          if (doc.isNew === true) {
            updatedProducts.unshift({
              ...doc,
              isOutOfStock: doc.stock <= 0 && doc.status === 'on',
              isOffline: doc.status !== 'on'
            });
          }
        }
        
        // 更新系列中的商品 - 无论商品是否在新品列表中，都要更新系列列表
        let seriesUpdated = false;
        updatedSeriesList.forEach((series, seriesIndex) => {
          const idx = series.products.findIndex(p => p._id === docId);
          console.log(`[首页] 检查系列 ${seriesIndex} (${series.title}): 找到位置 ${idx}`);
          if (idx !== -1) {
            console.log(`[首页] 更新前价格: ${series.products[idx].price}, 更新后价格: ${doc.price}`);
            series.products[idx] = {
              ...doc,
              isOutOfStock: doc.stock <= 0 && doc.status === 'on',
              isOffline: doc.status !== 'on'
            };
            console.log(`[首页] 更新后系列商品价格: ${series.products[idx].price}`);
            seriesUpdated = true;
          }
        });
        
        if (seriesUpdated) {
          console.log('[首页] 系列列表中的商品已更新');
        } else {
          console.log('[首页] 商品不在任何系列列表中，触发全量刷新');
          this.handleDataChange('products');
          return;
        }
      } else if (dataType === 'add') {
        // 添加新品
        if (doc.isNew === true) {
          updatedProducts.unshift(doc);
        }
      } else if (dataType === 'remove') {
        // 删除商品
        if (productIndex !== -1) {
          updatedProducts.splice(productIndex, 1);
        }
        updatedSeriesList.forEach(series => {
          const idx = series.products.findIndex(p => p._id === docId);
          if (idx !== -1) {
            series.products.splice(idx, 1);
          }
        });
      }
    }

    // 限制新品数量
    const finalProducts = updatedProducts.slice(0, 20);
    
    // 扩展新品数据用于轮播
    let extendedNewProducts = [];
    if (finalProducts.length > 0) {
      extendedNewProducts.push(finalProducts[finalProducts.length - 1]);
      extendedNewProducts.push(...finalProducts);
      extendedNewProducts.push(finalProducts[0]);
    }

    const newCarouselIndex = 0;
    const newCarouselList = this.computeNewCarouselList(finalProducts, newCarouselIndex);

    console.log('[首页] 准备setData更新UI');
    console.log('[首页] finalProducts数量:', finalProducts.length);
    console.log('[首页] updatedSeriesList数量:', updatedSeriesList.length);
    
    await this.setData({
      newProducts: finalProducts,
      extendedNewProducts,
      newCarouselList,
      newCarouselIndex,
      seriesList: updatedSeriesList
    });
    
    console.log('[首页] setData完成');

    // 更新缓存
    const cachedData = wx.getStorageSync('homeData') || {};
    wx.setStorageSync('homeData', {
      ...cachedData,
      newProducts: finalProducts,
      extendedNewProducts,
      seriesList: updatedSeriesList,
      timestamp: Date.now()
    });

    if (newCarouselList.length >= 3) {
      this.startNewCarousel();
    }

    console.log('[首页] 商品增量更新完成');
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
        const seriesProducts = products.filter(product => product.categoryId === category._id);
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

      // 转换 cloud:// URL 为临时链接
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
  async loadProducts(callback) {
    // 先尝试从本地缓存获取数据（永久缓存，由实时监听更新）
    const rawCachedData = wx.getStorageSync('homeData');
    
    // 必须深拷贝，避免修改只读的存储对象
    let cachedData = rawCachedData ? JSON.parse(JSON.stringify(rawCachedData)) : {};
    
    if (cachedData && cachedData.seriesList && cachedData.seriesList.length > 0) {
      // 从全局商品缓存获取最新数据，同步更新到本地缓存
      const globalProductCache = this.getGlobalProductCache();
      
      // 转换 cloud:// URL（存量缓存可能包含cloud路径）
      await batchConvertCloudUrls(cachedData, IMAGE_KEYS);
      
      // 同步全局商品缓存数据到首页缓存
      if (globalProductCache && Object.keys(globalProductCache).length > 0) {
        cachedData = this.syncGlobalCacheToHomeCache(cachedData, globalProductCache);
      }
      
      const cachedNewProducts = cachedData.newProducts || [];
      const carouselList = this.computeNewCarouselList(cachedNewProducts, 0);
      this.setData({
        seriesList: cachedData.seriesList,
        newProducts: cachedNewProducts,
        extendedNewProducts: cachedData.extendedNewProducts,
        newCarouselList: carouselList,
        newCarouselIndex: 0,
        bannerList: cachedData.bannerList || [],
        loading: false,
        bannerLoading: false  // 轮播图加载完成
      });
      
      // 同时更新本地缓存
      wx.setStorageSync('homeData', cachedData);
      
      if (carouselList.length >= 3) {
        this.startNewCarousel();
      }
      if (callback) callback();
      return;
    }

    // ====== 方案1：优先加载轮播图 ======
    const bannerCollection = getCollection('banner');
    
    // 先单独加载轮播图，快速显示
    bannerCollection.where({ isBanner: true }).get().then(bannerRes => {
      const banners = bannerRes.data || [];
      console.log('[首页] 轮播图加载完成:', banners.length, '张');
      
      // 转换轮播图的 cloud:// URL
      batchConvertCloudUrls({ bannerList: banners }, IMAGE_KEYS).then(() => {
        // 立即显示轮播图
        this.setData({ 
          bannerList: banners,
          bannerLoading: false  // 轮播图加载完成
        });
      });
    }).catch(err => {
      console.error('[首页] 轮播图加载失败:', err);
      this.setData({ bannerLoading: false });
    });

    // ====== 并行加载其他数据 ======
    const productsCollection = getCollection('products');
    const categoryCollection = getCollection('category');
    this.setData({ loading: true });

    Promise.all([
      categoryCollection.where({ status: 'on' }).orderBy('createTime', 'desc').get(),
      productsCollection.get()
    ])
    .then(async ([categoryRes, productsRes]) => {
      const categories = categoryRes.data;
      const products = productsRes.data;

      const seriesList = categories.slice(0, 3).map(category => {
        const seriesProducts = products.filter(product => product.categoryId === category._id);
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

      const newProducts = products
        .filter(product => product.isNew === true)
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
        bannerLoading: false  // 轮播图加载完成
      });

      wx.setStorageSync('homeData', {
        seriesList,
        newProducts,
        extendedNewProducts,
        bannerList: banners,
        timestamp: Date.now()
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
        const seriesProducts = products.filter(product => product.categoryId === category._id);
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

      // 转换 cloud:// URL 为临时链接
      const dataToConvert = { seriesList };
      await batchConvertCloudUrls(dataToConvert, IMAGE_KEYS);

      // 更新 UI
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
        const seriesProducts = products.filter(product => product.categoryId === category._id);
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

      // 加载新品推荐数据，筛选isNew为true的商品并按创建时间倒序排序
      const newProducts = products
        .filter(product => product.isNew === true)
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
    seriesList.forEach(series => {
      series.products.forEach(product => {
        productIds.push(product._id);
      });
    });
    
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