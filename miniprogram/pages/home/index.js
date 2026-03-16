// pages/home/index.js
import { getCollection } from '../../utils/cloud';

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
    error: false,
    errorMessage: ''
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.loadProducts();
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    if (this.data.recommendedProducts.length === 0) {
      this.loadProducts();
    }
    this.startNewCarousel();
  },

  onHide() {
    this.stopNewCarousel();
  },

  onUnload() {
    this.stopNewCarousel();
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
  loadProducts(callback) {
    // 先尝试从本地缓存获取数据
    const cachedData = wx.getStorageSync('homeData');
    if (cachedData && Date.now() - cachedData.timestamp < 300000) { // 5分钟缓存
      const cachedNewProducts = cachedData.newProducts || [];
      const carouselList = this.computeNewCarouselList(cachedNewProducts, 0);
      this.setData({
        seriesList: cachedData.seriesList,
        newProducts: cachedNewProducts,
        extendedNewProducts: cachedData.extendedNewProducts,
        newCarouselList: carouselList,
        newCarouselIndex: 0,
        bannerList: cachedData.bannerList || [],
        loading: false
      });
      if (carouselList.length >= 3) {
        this.startNewCarousel();
      }
      if (callback) callback();
      // 后台刷新数据
      this.refreshData();
      return;
    }

    const productsCollection = getCollection('products');
    const categoryCollection = getCollection('category');
    const bannerCollection = getCollection('banner');
    this.setData({ loading: true });

    // 并行加载数据
    Promise.all([
      // 加载系列数据，按创建时间倒序排序
      categoryCollection.orderBy('createTime', 'desc').get(),
      // 加载商品数据
      productsCollection.get(),
      // 加载轮播图数据，筛选isBanner为true的记录
      bannerCollection.where({ isBanner: true }).get()
    ])
    .then(([categoryRes, productsRes, bannerRes]) => {
      const categories = categoryRes.data;
      const products = productsRes.data;
      const banners = bannerRes.data;
      
      // 构建系列数据，将商品按照系列分组，只取最新的三个系列
      const seriesList = categories.slice(0, 3).map(category => {
        // 找到属于当前系列的商品
        const seriesProducts = products.filter(product => product.categoryId === category._id);
        
        return {
          id: category._id,
          title: category.name,
          subtitle: category.subtitle,
          mainImage: category.image,
          products: seriesProducts.slice(0, 3) // 每个系列显示3个商品
        };
      });
      
      // 加载新品推荐数据，筛选isNew为true的商品并按创建时间倒序排序
      const newProducts = products
        .filter(product => product.isNew === true)
        .sort((a, b) => new Date(b.createTime) - new Date(a.createTime))
        .slice(0, 20); // 最多取 20 个新品
      
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
      
      const newCarouselIndex = 0;
      const newCarouselList = this.computeNewCarouselList(newProducts, newCarouselIndex);

      this.setData({
        seriesList,
        newProducts,
        extendedNewProducts,
        newCarouselList,
        newCarouselIndex,
        bannerList: banners,
        loading: false
      });
      
      // 缓存数据
      wx.setStorageSync('homeData', {
        seriesList,
        newProducts,
        extendedNewProducts,
        bannerList: banners,
        timestamp: Date.now()
      });
      
      // 预加载商品详情数据
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
        error: true,
        errorMessage: '加载数据失败，请稍后重试'
      });
      if (callback) callback();
    });
  },

  /**
   * 后台刷新数据
   */
  refreshData() {
    const productsCollection = getCollection('products');
    const categoryCollection = getCollection('category');
    const bannerCollection = getCollection('banner');

    Promise.all([
      categoryCollection.orderBy('createTime', 'desc').get(),
      productsCollection.get(),
      // 加载轮播图数据，筛选isBanner为true的记录
      bannerCollection.where({ isBanner: true }).get()
    ])
    .then(([categoryRes, productsRes, bannerRes]) => {
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
          products: seriesProducts.slice(0, 3)
        };
      });
      
      // 加载新品推荐数据，筛选isNew为true的商品并按创建时间倒序排序
      const newProducts = products
        .filter(product => product.isNew === true)
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