import { getCollection } from "../../utils/cloud";
import { getProductsDetail, isProductSoldOut, calculateCartTotalPrice } from "../../utils/product";
import { getCachedProducts } from "../../utils/cache";
import { getGlobalProductWatcher } from '../../utils/globalProductWatcher';

const db = wx.cloud.database();

Page({
  data: {
    cartItems: [],
    filteredCartItems: [],
    totalPrice: 0,
    loading: true,
    loadingMore: false,
    hasMore: true,
    lastId: null, // 游标分页的最后一个 _id
    lastUpdatedAtTs: null, // 游标分页的最后一个 updatedAt 时间戳
    pageSize: 18,
    deleteWidth: 90, // 删除按钮宽度 (px)
    selectAll: false, // 是否全选
    selectedCount: 0, // 选中商品数量
    lastTapTime: 0, // 上次点击时间（用于双击tabbar）
    filterOptions: {
      category: [],
      inStock: null
    },
    searchKeyword: '',
    expandedQuantityId: null, // 当前展开数量选择器的商品ID
    pageVisible: false, // 页面可见性
    pendingRefresh: false, // 页面隐藏期间数据是否有变化，用于返回时自动刷新
    fromDetail: false, // 是否从商品详情页返回
    cartInitialized: false, // 购物车数据是否已经初始化过
    isScrolling: false, // 是否正在滚动（用于优化渲染性能）
    refreshing: false // scroll-view 下拉刷新状态
  },
  
  _loadingMoreSync: false, // 同步变量，防止scrolltolower重复触发
  
  onLoad(options) {
    // 生成页面唯一 ID
    this.__pageId = `cart_page_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    // 订阅全局商品监听
    const watcher = getGlobalProductWatcher();
    this._unsubscribe = watcher.subscribe(
      this.__pageId, 'cart_products',
      (change) => this._onProductChanged(change)
    );
    
    const hasCache = this.loadCachedCartItems();

    this._cartInitialized = true;

    if (!hasCache) {
      this.fetchCartItems({ showLoading: true });
    } else {
      this.fetchCartItems({ showLoading: false });
    }
  },

  onShow() {
    const app = getApp();
    const wasHidden = !this._pageVisible;
    
    this._pageVisible = true;
    console.log('[购物车页面] 页面显示');
    
    // 设置页面可见性
    const watcher = getGlobalProductWatcher();
    watcher.setPageVisible(this.__pageId, true);
    
    // 监听器健康检查
    const healthCheck = watcher.checkNeedsRefresh();
    if (healthCheck.needsRefresh) {
      console.log('[购物车页面] 监听器健康检查不通过:', healthCheck.reason);
    }
    
    // 检查是否从商品详情页返回
    if (this._fromDetail) {
      this._fromDetail = false;
      console.log('[购物车页面] 从商品详情页返回，保持列表不变');
      return;
    }
    
    // 如果购物车数据已经初始化过，且没有检测到数据变更，则保持列表不变
    // 除非监听器不健康需要刷新
    if (this._cartInitialized && !app.globalData.cartDirty && !healthCheck.needsRefresh) {
      console.log('[购物车页面] 数据已初始化且无变更，保持列表不变');
      return;
    }
    
    // 检查是否有缓存更新标记
    const updateMark = watcher.getAndClearUpdateMark('cart_products');
    if (updateMark || healthCheck.needsRefresh) {
      console.log('[购物车页面] 检测到缓存更新标记或监听器不健康');
    }
    
    const isDirty = app.globalData.cartDirty;
    if (isDirty || healthCheck.needsRefresh) {
      console.log('[购物车页面] 检测到购物车数据变更或监听器不健康，刷新数据');
      app.globalData.cartDirty = false;
      this.fetchCartItems({ showLoading: false });
    }
  },

  onHide() {
    this._pageVisible = false;
    
    this.setData({
      expandedQuantityId: null
    });

    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    console.log('[购物车页面] 页面隐藏');
    // 设置页面不可见
    getGlobalProductWatcher().setPageVisible(this.__pageId, false);
  },

  onUnload() {
    console.log('[购物车页面] 页面卸载');
    
    // 取消订阅
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  },

  /**
   * 全局监听器回调处理
   * @param {Object} change { type: 'add'|'modify'|'remove', product, docId, cacheKey }
   */
  _onProductChanged(change) {
    // 滚动时跳过更新，避免渲染冲突
    if (this._isScrolling) {
      return;
    }
    
    console.log('[购物车页面] _onProductChanged:', change);
    
    const { type, product } = change;
    const { cartItems } = this.data;
    
    if (!cartItems || cartItems.length === 0) {
      console.log('[购物车页面] 购物车为空，跳过增量更新');
      return;
    }
    
    let needUpdate = false;
    const updatedItems = [...cartItems];
    
    const productId = product._id;
    
    // 兼容 'update' 和 'modify' 两种类型
    const isModify = type === 'modify' || type === 'update';
    
    if (isModify) {
      // 判断是否应该移除（下架或删除）
      const shouldRemove = product.status !== 'on' || product.isDeleted === true;
      
      if (shouldRemove) {
        // 从购物车移除该商品
        const idx = updatedItems.findIndex(item => item.productId === productId);
        if (idx !== -1) {
          updatedItems.splice(idx, 1);
          needUpdate = true;
        }
      } else {
        // 更新商品信息
        const idx = updatedItems.findIndex(item => item.productId === productId);
        if (idx !== -1) {
          const item = updatedItems[idx];
          updatedItems[idx] = {
            ...item,
            name: product.name || item.name,
            price: typeof product.price === 'number' ? product.price : item.price,
            stock: typeof product.stock === 'number' ? product.stock : item.stock,
            coverImage: product.coverImage || item.coverImage,
            category: product.category || item.category,
            typeId: product.typeId || item.typeId,
            isSoldOut: isProductSoldOut(product)
          };
          needUpdate = true;
        }
      }
    } else if (type === 'remove') {
      // 从购物车移除该商品
      const idx = updatedItems.findIndex(item => item.productId === productId);
      if (idx !== -1) {
        updatedItems.splice(idx, 1);
        needUpdate = true;
      }
    } else if (type === 'add') {
      // 新增商品一般不需要更新购物车（购物车已有商品引用）
    }
    
    if (needUpdate) {
      if (this._pageVisible) {
        console.log('[购物车页面] 执行增量更新');
        this.setData({ 
          cartItems: updatedItems,
          filteredCartItems: updatedItems
        });
        this.calculateTotalPrice();
      } else {
        console.log('[购物车页面] 页面隐藏，更新缓存');
        this.setData({ 
          cartItems: updatedItems,
          filteredCartItems: updatedItems,
          pendingRefresh: true
        });
      }
      this.setCartCache(updatedItems);
    }
  },
  
  // 页面重新显示时主动检查商品变化
  async checkProductChangesOnShow() {
    const { cartItems } = this.data;
    if (!cartItems || cartItems.length === 0) {
      return;
    }
    
    try {
      // 获取购物车中所有商品ID
      const productIdSet = new Set(cartItems.map(item => item.productId));
      const productIdArray = Array.from(productIdSet);
      
      // 强制从数据库获取最新商品信息
      const productMap = await getProductsDetail(productIdArray, true);
      
      let needUpdate = false;
      const updatedItems = [...cartItems];
      
      // 对比商品信息是否有变化
      for (const item of updatedItems) {
        const product = productMap.get(item.productId);
        if (product) {
          // 检查是否有变化
          const hasChange = 
            (product.name && product.name !== item.name) ||
            (typeof product.price === 'number' && product.price !== item.price) ||
            (typeof product.stock === 'number' && product.stock !== item.stock) ||
            (product.coverImage && product.coverImage !== item.coverImage) ||
            (product.category && product.category !== item.category);
          
          if (hasChange) {
            console.log('[购物车页面] 检测到商品变化:', item.productId);
            
            // 更新商品信息
            item.name = product.name || item.name;
            item.price = typeof product.price === 'number' ? product.price : item.price;
            item.stock = typeof product.stock === 'number' ? product.stock : item.stock;
            item.coverImage = product.coverImage || item.coverImage;
            item.category = product.category || item.category;
            item.typeId = product.typeId || item.typeId;
            item.isSoldOut = isProductSoldOut(product);
            
            // 不需要更新商品缓存！缓存由管理员负责更新
            needUpdate = true;
          }
        }
      }
      
      if (needUpdate) {
        console.log('[购物车页面] 页面返回时检测到商品变化，更新UI');
        this.setData({ 
          cartItems: updatedItems,
          filteredCartItems: updatedItems
        });
        this.calculateTotalPrice();
        this.setCartCache(updatedItems);
      } else {
        console.log('[购物车页面] 页面返回时商品无变化');
      }
    } catch (error) {
      console.error('[购物车页面] 检查商品变化失败:', error);
    }
  },

  loadCachedCartItems() {
    const openid = wx.getStorageSync('openid') || '';
    const cachedCartItems = wx.getStorageSync(`cart_${openid}`) || [];

    if (cachedCartItems && cachedCartItems.length > 0) {
      console.log('[购物车页面] 从缓存加载购物车数据');
      
      // 只取第一页数据
      const firstPageItems = cachedCartItems.slice(0, this.data.pageSize);
      const hasMore = cachedCartItems.length > this.data.pageSize;
      
      // 获取购物车中所有商品ID
      const productIds = firstPageItems.map(item => item.productId);
      
      // 从全局商品缓存中获取商品信息
      const productMap = getCachedProducts(productIds);
      
      // 合并购物车数据和商品信息
      const cartItems = firstPageItems.map(item => {
        const product = productMap.get(item.productId);
        if (product) {
          return {
            ...item,
            name: product.name || item.name,
            price: typeof product.price === 'number' ? product.price : item.price,
            stock: typeof product.stock === 'number' ? product.stock : item.stock,
            coverImage: product.coverImage || item.coverImage,
            category: product.category || item.category,
            typeId: product.typeId || item.typeId,
            isSoldOut: isProductSoldOut(product)
          };
        }
        return item;
      });
      
      this.setData({
        cartItems,
        filteredCartItems: cartItems,
        hasMore: hasMore,
        lastId: cartItems.length > 0 ? cartItems[cartItems.length - 1]._id : null,
        lastUpdatedAtTs: cartItems.length > 0 ? (cartItems[cartItems.length - 1].updatedAtTs || null) : null
      }, () => {
        console.log('[购物车] 从缓存加载数据完成，当前 hasMore:', this.data.hasMore, 'cartItems数量:', this.data.cartItems.length);
      });
      this.updateSelectionStatus();
      this.calculateTotalPrice();

      const cachedFilterOptions = wx.getStorageSync('cartFilterOptions');
      if (cachedFilterOptions) {
        this.setData({ filterOptions: cachedFilterOptions });
      }

      return true;
    }

    this.setData({ cartItems: [], filteredCartItems: [] });
    return false;
  },

  setCartCache(cartItems) {
    const openid = wx.getStorageSync('openid') || '';
    if (!openid) return;
    
    // 只保存购物车的业务数据，不保存商品详细信息（商品信息从全局缓存获取）
    const cartDataToCache = cartItems.map(item => ({
      _id: item._id,
      productId: item.productId,
      quantity: item.quantity,
      selected: item.selected,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      isDelete: item.isDelete,
      // 保存商品快照作为兜底
      productSnapshot: item.productSnapshot
    }));
    
    wx.setStorageSync(`cart_${openid}`, cartDataToCache);
  },

  // 下拉刷新
  onPullDownRefresh() {
    // 强制从数据库获取最新数据，不使用缓存
    this.fetchCartItems({ showLoading: false, forceRefresh: true }).finally(() => {
      wx.stopPullDownRefresh();
    });
  },
  
  onPageScroll(e) {
    this.onScroll(e);
  },
  
  onScroll(e) {
    this._isScrolling = true;
    this.setData({ isScrolling: true });
    
    if (this.scrollStopTimer) {
      clearTimeout(this.scrollStopTimer);
    }
    
    this.scrollStopTimer = setTimeout(() => {
      this._isScrolling = false;
      this.setData({ isScrolling: false });
    }, 300);
  },
  
  onScrollRefresh() {
    this.setData({ refreshing: true });
    this.fetchCartItems({ showLoading: false, forceRefresh: true }).finally(() => {
      this.setData({ refreshing: false });
    });
  },

  // 处理购物车数据（获取商品详情等）
  async processCartItems(rawItems, currentCartItems = [], cachedCartItems = []) {
    const cartItems = rawItems.filter(item => item.productSnapshot);
    const productIdSet = new Set(cartItems.map(item => item.productId));
    const productIdArray = Array.from(productIdSet);

    const productMap = await getProductsDetail(productIdArray, false);

    return cartItems.map(item => {
      const product = productMap.get(item.productId);
      let stock = 99;
      let name = item.productSnapshot.name || '';
      let price = item.productSnapshot.price || 0;
      let coverImage = item.productSnapshot.coverImage || '';
      let category = item.productSnapshot.category || '';
      let typeId = item.productSnapshot.typeId || '';

      if (product) {
        name = product.name || name;
        price = typeof product.price === "number" ? product.price : price;
        coverImage = product.coverImage || coverImage;
        category = product.category || category;
        typeId = product.typeId || typeId;

        if (typeof product.stock === "number") {
          stock = product.stock;
        }
      }

      const isSoldOut = isProductSoldOut(product);
      
      // 保留之前的选择状态
      let isSelected = false;
      const existingItem = currentCartItems.find(i => i._id === item._id);
      if (existingItem !== undefined) {
        isSelected = existingItem.selected;
      } else {
        const cachedItem = cachedCartItems.find(c => c._id === item._id);
        if (cachedItem !== undefined) {
          isSelected = cachedItem.selected || false;
        }
      }

      return {
        _id: item._id,
        productId: item.productId,
        name: name,
        price: price,
        quantity: item.quantity || 1,
        stock: stock,
        isSoldOut: isSoldOut,
        coverImage: coverImage,
        category: category,
        typeId: typeId,
        selected: isSelected,
        translateX: 0,
        updatedAt: item.updatedAt,
        updatedAtTs: item.updatedAtTs
      };
    });
  },

  // 从cart collection获取购物车数据（分页加载）
  async fetchCartItems({ showLoading = false, forceRefresh = false } = {}) {
    console.log(`[购物车] fetchCartItems 调用 - showLoading: ${showLoading}, forceRefresh: ${forceRefresh}`);

    const openid = wx.getStorageSync('openid') || '';
    const cachedCartItems = wx.getStorageSync(`cart_${openid}`) || [];
    const currentCartItems = this.data.cartItems || [];

    console.log(`[购物车] 当前状态 - cachedCartItems数量: ${cachedCartItems.length}, currentCartItems数量: ${currentCartItems.length}`);

    // 重置分页状态
    this.setData({ lastId: null, lastUpdatedAtTs: null, hasMore: true });

    if (showLoading || (cachedCartItems.length === 0 && currentCartItems.length === 0)) {
      this.setData({ loading: true });
    }

    // 非强制刷新时才使用缓存展示
    if (cachedCartItems.length > 0 && !forceRefresh && currentCartItems.length === 0) {
      console.log('[购物车页面] 使用缓存展示购物车数据');
      console.log(`[购物车] 缓存数据前2条:`, cachedCartItems.slice(0, 2));
      
      // 只取第一页数据
      const firstPageItems = cachedCartItems.slice(0, this.data.pageSize);
      const hasMore = cachedCartItems.length > this.data.pageSize;
      
      this.setData({ 
        cartItems: firstPageItems, 
        filteredCartItems: firstPageItems,
        hasMore: hasMore,
        lastId: firstPageItems.length > 0 ? firstPageItems[firstPageItems.length - 1]._id : null,
        lastUpdatedAtTs: firstPageItems.length > 0 ? (firstPageItems[firstPageItems.length - 1].updatedAtTs || null) : null
      });
      this.updateSelectionStatus();
      this.calculateTotalPrice();
      const cachedFilterOptions = wx.getStorageSync('cartFilterOptions');
      if (cachedFilterOptions) {
        this.setData({ filterOptions: cachedFilterOptions });
      }
    }

    // 获取第一页数据
    await this._fetchCartPage(true);

    // 后台自动加载剩余全部数据
    this._loadRemainingCartItems();
  },

  async _loadRemainingCartItems() {
    console.log('[购物车] 开始后台自动加载剩余购物车商品');
    console.log(`[购物车] 当前状态 - hasMore: ${this.data.hasMore}, loading: ${this.data.loading}, loadingMore: ${this.data.loadingMore}, 当前数量: ${this.data.cartItems ? this.data.cartItems.length : 0}`);
    
    let pageCount = 0;
    while (this.data.hasMore && !this.data.loading && !this.data.loadingMore) {
      console.log(`[购物车] 后台加载第 ${pageCount + 1} 页，当前已加载: ${this.data.cartItems ? this.data.cartItems.length : 0}`);
      await this._fetchCartPage(false);
      pageCount++;
    }
    
    console.log(`[购物车] 后台自动加载完成，共加载 ${pageCount} 页，总数量: ${this.data.cartItems ? this.data.cartItems.length : 0}`);
  },

  // 获取购物车数据（游标分页）
  async _fetchCartPage(isFirstPage = false) {
    const openid = wx.getStorageSync('openid') || '';
    const queryCondition = {
      _openid: openid,
      isDelete: false
    };
    
    let query = getCollection('cart').where(queryCondition)
      .orderBy('updatedAtTs', 'desc')
      .orderBy('_id', 'desc')
      .limit(this.data.pageSize);
    
    // 如果不是第一页，使用游标查询
    // 排序: updatedAtTs desc, _id desc
    // 游标条件: (updatedAtTs < lastUpdatedAtTs) OR (updatedAtTs == lastUpdatedAtTs AND _id < lastId)
    if (!isFirstPage && this.data.lastId && this.data.lastUpdatedAtTs) {
      query = getCollection('cart').where(db.command.and([
        { _openid: openid, isDelete: false },
        db.command.or([
          { updatedAtTs: db.command.lt(this.data.lastUpdatedAtTs) },
          { updatedAtTs: this.data.lastUpdatedAtTs, _id: db.command.lt(this.data.lastId) }
        ])
      ])).orderBy('updatedAtTs', 'desc')
        .orderBy('_id', 'desc')
        .limit(this.data.pageSize);
    }
      
    console.log(`[购物车] 查询条件:`, queryCondition, ', lastId:', this.data.lastId, ', pageSize:', this.data.pageSize);
      
    try {
      const result = await query.get();
      const rawData = result.data || [];
      
      console.log(`[购物车] 分页获取数据 - isFirstPage: ${isFirstPage}, 本页数量: ${rawData.length}`);
      
      if (rawData.length > 0) {
        const currentCartItems = this.data.cartItems || [];
        const cachedCartItems = wx.getStorageSync(`cart_${openid}`) || [];
        
        console.log(`[购物车] 原始数据前2条:`, rawData.slice(0, 2));
        
        const processedItems = await this.processCartItems(rawData, currentCartItems, cachedCartItems);
        console.log(`[购物车] 处理后数据数量: ${processedItems.length}`);
        if (processedItems.length > 0) {
          console.log(`[购物车] 处理后第1条数据:`, processedItems[0]);
        }
        
        const existingIds = new Set(currentCartItems.map(item => item._id));
        const newItems = processedItems.filter(item => !existingIds.has(item._id));
        console.log(`[购物车] 去重后新数据数量: ${newItems.length}`);
        
        const cartItems = isFirstPage ? processedItems : [...currentCartItems, ...newItems];
        const hasMore = rawData.length === this.data.pageSize;
        const lastId = cartItems.length > 0 ? cartItems[cartItems.length - 1]._id : null;
        const lastUpdatedAtTs = cartItems.length > 0 ? (cartItems[cartItems.length - 1].updatedAtTs || null) : null;
        
        console.log(`[购物车] 总数量: ${cartItems.length}, hasMore: ${hasMore}, lastId: ${lastId}, lastUpdatedAtTs: ${lastUpdatedAtTs}`);

        const cacheInfo = wx.getStorageSync('cartFilterOptions') || null;
        
        const setDataObj = {
          cartItems,
          filteredCartItems: cartItems,
          loading: false,
          loadingMore: false,
          hasMore: hasMore,
          lastId: lastId,
          lastUpdatedAtTs: lastUpdatedAtTs
        };
        if (cacheInfo) {
          setDataObj.filterOptions = cacheInfo;
        }
        
        console.log('[购物车] 准备调用 setData 更新UI');
        this.setData(setDataObj);
        
        this.updateSelectionStatus();
        this.calculateTotalPrice();

        if (openid) {
          const oldCachedItems = wx.getStorageSync(`cart_${openid}`) || [];
          const oldJson = JSON.stringify(oldCachedItems);
          const newJson = JSON.stringify(cartItems);
          if (oldJson !== newJson) {
            this.setCartCache(cartItems);
            console.log('[购物车页面] 购物车缓存已更新');
          }
        }

        if (hasMore && !isFirstPage) {
          await this._fetchCartPage(false);
        }
      } else {
        console.log('[购物车] 没有从数据库获取到数据');
        this.setData({ loading: false, loadingMore: false, hasMore: false });
      }
    } catch (err) {
      console.error("[购物车] 获取购物车数据失败", err);
      this.setData({ loading: false, loadingMore: false });
    }
  },

  // 加载更多购物车数据
  async loadMoreCartItems() {
    if (this._loadingMoreSync || !this.data.hasMore || this.data.loading) {
      console.log('[购物车] 正在加载或没有更多数据，跳过');
      return;
    }
    
    this._loadingMoreSync = true;
    console.log('[购物车] 开始加载更多购物车数据');
    this.setData({ loadingMore: true });
    
    try {
      await this._fetchCartPage(false);
    } finally {
      this._loadingMoreSync = false;
      this.setData({ loadingMore: false });
    }
  },
  
  // 加载搜索历史
  loadSearchHistory() {
    const searchHistory = wx.getStorageSync('cartSearchHistory') || [];
    this.setData({ searchHistory });
  },

  // 保存搜索历史
  saveSearchHistory(keyword) {
    if (!keyword.trim()) return;
    
    let searchHistory = wx.getStorageSync('cartSearchHistory') || [];
    // 移除重复的关键词
    searchHistory = searchHistory.filter(item => item !== keyword);
    // 添加到开头
    searchHistory.unshift(keyword);
    // 限制历史记录数量
    if (searchHistory.length > 10) {
      searchHistory = searchHistory.slice(0, 10);
    }
    // 保存到本地存储
    wx.setStorageSync('cartSearchHistory', searchHistory);
    this.setData({ searchHistory });
  },

  // 清除搜索历史
  clearSearchHistory() {
    wx.removeStorageSync('cartSearchHistory');
    this.setData({ searchHistory: [] });
  },



  // 处理搜索输入
  handleSearchInput(e) {
    const keyword = e.detail.value;
    this.setData({ searchKeyword: keyword });
    
    // 防抖处理
    this.debounce(() => {
      this.performSearch(keyword);
    }, 300)();
  },

  // 执行搜索
  performSearch(keyword) {
    if (!keyword) {
      this.setData({ 
        filteredCartItems: this.data.cartItems,
        searchSuggestions: []
      });
      return;
    }
    
    // 生成搜索建议
    this.generateSearchSuggestions(keyword);
    
    // 过滤商品，基于当前的购物车数据（如果有筛选条件，基于筛选后的结果）
    const baseItems = this.data.filteredCartItems.length > 0 && this.data.searchKeyword ? this.data.filteredCartItems : this.data.cartItems;
    const filteredItems = baseItems.filter(item => {
      const name = item.name || '';
      return name.includes(keyword);
    });
    
    this.setData({ 
      filteredCartItems: filteredItems,
      searchFocused: true, // 保持搜索焦点状态，显示搜索建议
      searchKeyword: keyword
    });
  },

  // 生成搜索建议
  generateSearchSuggestions(keyword) {
    const allKeywords = [];
    this.data.cartItems.forEach(item => {
      if (item.name) allKeywords.push(item.name);
      if (item.description) allKeywords.push(item.description);
      if (item.category) allKeywords.push(item.category);
    });
    
    const uniqueKeywords = [...new Set(allKeywords)];
    const suggestions = uniqueKeywords.filter(item => 
      item.includes(keyword) && item !== keyword
    ).slice(0, 5);
    
    this.setData({ searchSuggestions: suggestions });
  },

  // 清除搜索
  clearSearch() {
    const { filterOptions } = this.data;
    let filteredItems = [...this.data.cartItems];
    
    // 如果有筛选条件，应用筛选
    if (filterOptions) {
      // 按类别筛选
      if (filterOptions.category && filterOptions.category.length > 0) {
        filteredItems = filteredItems.filter(item => {
          if (item.typeId) {
            for (let i = 0; i < filterOptions.category.length; i++) {
              if (item.typeId === filterOptions.category[i]) {
                return true;
              }
            }
          }
          return false;
        });
      }
      
      // 按库存状态筛选
      if (filterOptions.inStock !== null) {
        filteredItems = filteredItems.filter(item => {
          if (filterOptions.inStock) {
            return item.stock > 0;
          } else {
            return item.stock <= 0;
          }
        });
      }
    }
    
    this.setData({ 
      searchKeyword: '',
      filteredCartItems: filteredItems,
      searchSuggestions: []
    });
  },

  // 切换搜索历史显示状态
  toggleSearchHistory() {
    // 只有当搜索框为空时才切换搜索历史的显示状态
    if (!this.data.searchKeyword) {
      this.setData({ searchFocused: !this.data.searchFocused });
    }
  },

  // 搜索框获得焦点
  onSearchFocus(e) {
    // 不做任何操作，保持默认行为
  },

  // 使用搜索历史
  useSearchHistory(e) {
    const keyword = e.currentTarget.dataset.keyword;
    this.setData({ 
      searchKeyword: keyword,
      searchSuggestions: [],
      searchFocused: false
    });
    // 直接过滤商品，不生成搜索建议
    const filteredItems = this.data.cartItems.filter(item => {
      const name = item.name || '';
      const description = item.description || '';
      const category = item.category || '';
      return name.includes(keyword) || description.includes(keyword) || category.includes(keyword);
    });
    this.setData({ filteredCartItems: filteredItems });
    this.saveSearchHistory(keyword);
  },

  // 使用搜索建议
  useSearchSuggestion(e) {
    const keyword = e.currentTarget.dataset.keyword;
    this.setData({ 
      searchKeyword: keyword,
      searchSuggestions: [],
      searchFocused: true // 保持搜索焦点状态，以便用户可以编辑搜索内容
    });
    // 直接过滤商品，不生成搜索建议
    const filteredItems = this.data.cartItems.filter(item => {
      const name = item.name || '';
      const description = item.description || '';
      const category = item.category || '';
      return name.includes(keyword) || description.includes(keyword) || category.includes(keyword);
    });
    this.setData({ filteredCartItems: filteredItems });
    this.saveSearchHistory(keyword);
  },

  // 显示筛选面板
  showFilterPanel() {
    this.setData({ showFilterPanel: true });
  },

  // 隐藏筛选面板
  hideFilterPanel() {
    this.setData({ showFilterPanel: false });
  },

  // 判断分类是否被选中
  isCategorySelected(categoryId) {
    // 直接从data中获取filterOptions，确保使用最新的数据
    const filterOptions = this.data.filterOptions;
    console.log('isCategorySelected called with categoryId:', categoryId);
    console.log('Current filterOptions in isCategorySelected:', filterOptions);
    if (!filterOptions || !filterOptions.category || !Array.isArray(filterOptions.category)) {
      console.log('filterOptions is not valid');
      return false;
    }
    console.log('filterOptions.category:', filterOptions.category);
    // 使用传统的for循环来检查数组中是否包含某个元素，确保在所有微信小程序环境中都能正常工作
    let isSelected = false;
    for (let i = 0; i < filterOptions.category.length; i++) {
      if (filterOptions.category[i] === categoryId) {
        isSelected = true;
        break;
      }
    }
    console.log('Category', categoryId, 'is selected:', isSelected);
    return isSelected;
  },
  


  // 选择商品类别
  selectCategory(e) {
    console.log('selectCategory called:', e);
    const categoryId = e.currentTarget.dataset.categoryId;
    const categoryName = e.currentTarget.dataset.categoryName;
    const level = e.currentTarget.dataset.level;
    const parentId = e.currentTarget.dataset.parentId;
    console.log('Selected categoryId:', categoryId);
    console.log('Selected categoryName:', categoryName);
    console.log('Selected level:', level);
    console.log('Selected parentId:', parentId);
    console.log('Current categoryGroups:', this.data.categoryGroups);
    console.log('Current selectedCategories:', this.data.selectedCategories);
    
    // 直接修改data中的selectedCategories，确保使用最新的数据
    const selectedCategories = { ...this.data.selectedCategories };
    
    if (level == 1) { // 使用==而不是===，因为level是字符串
      // 如果是一级分类，切换选择状态
      const isSelected = selectedCategories[categoryId] || false;
      console.log('Is already selected:', isSelected);
      
      // 查找该一级分类下的所有二级分类
      const level1Group = this.data.categoryGroups.find(group => group._id === categoryId);
      let level2CategoryIds = [];
      if (level1Group && level1Group.subCategories) {
        level2CategoryIds = level1Group.subCategories.map(item => item._id);
        console.log('Level 2 categoryIds:', level2CategoryIds);
      }
      
      if (isSelected) {
        // 如果已选择，取消选择一级分类和所有二级分类
        delete selectedCategories[categoryId];
        level2CategoryIds.forEach(subId => {
          delete selectedCategories[subId];
        });
        console.log('After deselection:', selectedCategories);
      } else {
        // 如果未选择，选择一级分类和所有二级分类
        selectedCategories[categoryId] = true;
        level2CategoryIds.forEach(subId => {
          selectedCategories[subId] = true;
        });
        console.log('After selection:', selectedCategories);
      }
    } else {
      // 如果是二级分类，切换选择状态
      const isSelected = selectedCategories[categoryId] || false;
      if (isSelected) {
        // 如果已选择，取消选择
        delete selectedCategories[categoryId];
        console.log('After deselection:', selectedCategories);
      } else {
        // 如果未选择，添加选择
        selectedCategories[categoryId] = true;
        console.log('After selection:', selectedCategories);
      }
    }
    
    // 更新filterOptions.category数组
    const categoryArray = Object.keys(selectedCategories);
    const newFilterOptions = { ...this.data.filterOptions, category: categoryArray };
    
    // 计算活跃筛选条件数量
    let count = 0;
    if (newFilterOptions.category && newFilterOptions.category.length > 0) count++;
    if (newFilterOptions.inStock !== null) count++;
    
    // 直接更新所有相关数据
    this.setData({ 
      selectedCategories: selectedCategories,
      filterOptions: newFilterOptions,
      activeFilterCount: count
    });
  },

  // 选择库存状态
  selectStockStatus(e) {
    let status = e.currentTarget.dataset.status;
    // 转换status为正确的类型
    if (status === 'null') {
      status = null;
    } else if (status === 'true') {
      status = true;
    } else if (status === 'false') {
      status = false;
    }
    const filterOptions = { ...this.data.filterOptions };
    // 库存状态只能单选，直接设置为选中的状态
    filterOptions.inStock = status;
    
    // 计算活跃筛选条件数量
    let count = 0;
    if (filterOptions.category && filterOptions.category.length > 0) count++;
    if (filterOptions.inStock !== null) count++;
    
    // 直接更新所有相关数据
    this.setData({ 
      filterOptions: filterOptions,
      activeFilterCount: count
    });
  },

  // 重置筛选条件
  resetFilter() {
    const filterOptions = {
      category: [],
      inStock: null
    };
    
    // 计算活跃筛选条件数量
    let count = 0;
    if (filterOptions.category && filterOptions.category.length > 0) count++;
    if (filterOptions.inStock !== null) count++;
    
    // 直接更新所有相关数据
    this.setData({ 
      filterOptions: filterOptions,
      selectedCategories: {},
      activeFilterCount: count
    });
  },

  // 更新活跃筛选条件数量
  updateActiveFilterCount() {
    const { filterOptions } = this.data;
    let count = 0;
    if (filterOptions.category && filterOptions.category.length > 0) count++;
    if (filterOptions.inStock !== null) count++;
    this.setData({ activeFilterCount: count });
  },

  // 应用筛选
  applyFilter() {
    const { filterOptions, cartItems, categoryOptions } = this.data;
    
    let filteredItems = [...cartItems];
    
    // 按类别筛选
    if (filterOptions.category && filterOptions.category.length > 0) {
      // 筛选商品类别在选择的分类数组中的商品
      filteredItems = filteredItems.filter(item => {
        // 检查商品是否有typeId
        if (item.typeId) {
          // 直接检查商品的typeId是否在选择的分类数组中
          for (let i = 0; i < filterOptions.category.length; i++) {
            if (item.typeId === filterOptions.category[i]) {
              return true;
            }
          }
        }
        
        return false;
      });
    }
    
    // 按库存状态筛选
    if (filterOptions.inStock !== null) {
      filteredItems = filteredItems.filter(item => {
        if (filterOptions.inStock) {
          return item.stock > 0;
        } else {
          return item.stock <= 0;
        }
      });
    }
    
    this.setData({ 
      filteredCartItems: filteredItems,
      showFilterPanel: false
    });
    
    // 保存筛选状态到本地存储
    wx.setStorageSync('cartFilterOptions', filterOptions);
  },

  // 防抖函数
  debounce(func, delay) {
    let timer = null;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        func.apply(this, args);
      }, delay);
    };
  },

  // 加载商品类别
  loadProductCategories() {
    const productTypes = getCollection('product_types');
    productTypes.get()
      .then(res => {
        let categories = [];
        let categoryGroups = [];
        if (res.data && res.data.length > 0) {
          // 分离一级分类和二级分类
          const level1Types = res.data.filter(type => type.level === 1);
          const level2Types = res.data.filter(type => type.level === 2);
          
          // 处理一级分类，添加对应的二级分类
          level1Types.forEach(type => {
            // 创建分类组
            const categoryGroup = {
              _id: type._id,
              name: type.name,
              level: 1,
              subCategories: []
            };
            // 查找该一级分类下的所有二级分类
            const subTypes = level2Types.filter(subType => subType.parentId === type._id);
            if (subTypes.length > 0) {
              subTypes.forEach(subType => {
                categoryGroup.subCategories.push({
                  _id: subType._id,
                  name: subType.name,
                  level: 2,
                  parent: type.name,
                  parentId: type._id
                });
              });
            }
            categoryGroups.push(categoryGroup);
            // 添加到categories数组（保持原有结构兼容）
            categories.push({
              _id: type._id,
              name: type.name,
              level: 1
            });
            if (subTypes.length > 0) {
              subTypes.forEach(subType => {
                categories.push({
                  _id: subType._id,
                  name: subType.name,
                  level: 2,
                  parent: type.name,
                  parentId: type._id
                });
              });
            }
          });
        } else {
          // 添加默认分类数据，用于测试
          categoryGroups = [
            {
              _id: 'type_001',
              name: '发圈',
              level: 1,
              subCategories: [
                { _id: 'type_004', name: '小号单层发圈', level: 2, parent: '发圈', parentId: 'type_001' },
                { _id: 'type_005', name: '单层发圈', level: 2, parent: '发圈', parentId: 'type_001' },
                { _id: 'type_006', name: '双层发圈', level: 2, parent: '发圈', parentId: 'type_001' },
                { _id: 'type_007', name: '方巾', level: 2, parent: '发圈', parentId: 'type_001' }
              ]
            },
            {
              _id: 'type_002',
              name: '发夹',
              level: 1,
              subCategories: [
                { _id: 'type_008', name: '蝴蝶结发夹', level: 2, parent: '发夹', parentId: 'type_002' },
                { _id: 'type_009', name: '堆堆夹', level: 2, parent: '发夹', parentId: 'type_002' }
              ]
            },
            {
              _id: 'type_003',
              name: '布包',
              level: 1,
              subCategories: [
                { _id: 'type_010', name: '挂件耳机包', level: 2, parent: '布包', parentId: 'type_003' },
                { _id: 'type_011', name: '纽扣耳机包', level: 2, parent: '布包', parentId: 'type_003' },
                { _id: 'type_012', name: '卡包', level: 2, parent: '布包', parentId: 'type_003' },
                { _id: 'type_013', name: '福袋包', level: 2, parent: '布包', parentId: 'type_003' },
                { _id: 'type_014', name: '手机挎包', level: 2, parent: '布包', parentId: 'type_003' },
                { _id: 'type_015', name: '单肩包', level: 2, parent: '布包', parentId: 'type_003' }
              ]
            }
          ];
          // 同时填充categories数组
          categoryGroups.forEach(group => {
            categories.push({ _id: group._id, name: group.name, level: 1 });
            group.subCategories.forEach(subCategory => {
              categories.push(subCategory);
            });
          });
        }
        this.setData({ 
          categoryOptions: categories,
          categoryGroups: categoryGroups
        });
      })
      .catch(err => {
        console.error('获取商品类别失败:', err);
        // 加载失败时使用默认分类数据
        const categoryGroups = [
          {
            _id: 'type_001',
            name: '发圈',
            level: 1,
            subCategories: [
              { _id: 'type_004', name: '小号单层发圈', level: 2, parent: '发圈', parentId: 'type_001' },
              { _id: 'type_005', name: '单层发圈', level: 2, parent: '发圈', parentId: 'type_001' },
              { _id: 'type_006', name: '双层发圈', level: 2, parent: '发圈', parentId: 'type_001' },
              { _id: 'type_007', name: '方巾', level: 2, parent: '发圈', parentId: 'type_001' }
            ]
          },
          {
            _id: 'type_002',
            name: '发夹',
            level: 1,
            subCategories: [
              { _id: 'type_008', name: '蝴蝶结发夹', level: 2, parent: '发夹', parentId: 'type_002' },
              { _id: 'type_009', name: '堆堆夹', level: 2, parent: '发夹', parentId: 'type_002' }
            ]
          },
          {
            _id: 'type_003',
            name: '布包',
            level: 1,
            subCategories: [
              { _id: 'type_010', name: '挂件耳机包', level: 2, parent: '布包', parentId: 'type_003' },
              { _id: 'type_011', name: '纽扣耳机包', level: 2, parent: '布包', parentId: 'type_003' },
              { _id: 'type_012', name: '卡包', level: 2, parent: '布包', parentId: 'type_003' },
              { _id: 'type_013', name: '福袋包', level: 2, parent: '布包', parentId: 'type_003' },
              { _id: 'type_014', name: '手机挎包', level: 2, parent: '布包', parentId: 'type_003' },
              { _id: 'type_015', name: '单肩包', level: 2, parent: '布包', parentId: 'type_003' }
            ]
          }
        ];
        // 填充categories数组
        const categories = [];
        categoryGroups.forEach(group => {
          categories.push({ _id: group._id, name: group.name, level: 1 });
          group.subCategories.forEach(subCategory => {
            categories.push(subCategory);
          });
        });
        this.setData({ 
          categoryOptions: categories,
          categoryGroups: categoryGroups
        });
      });
  },
  
  // 减少数量
  decreaseQuantity(e) {
    try {
      const productId = e.currentTarget.dataset.productId;
      if (!productId) {
        console.error('商品ID为空');
        return;
      }
      
      const cartItems = this.data.cartItems.map(item => {
        if (item.productId === productId) {
          // 确保quantity是数字
          const currentQuantity = typeof item.quantity === 'number' ? item.quantity : 1;
          if (currentQuantity > 1) {
            return { ...item, quantity: currentQuantity - 1 };
          }
        }
        return item;
      });
      this.setData({ cartItems });
      // 更新filteredCartItems
      const filteredCartItems = this.data.filteredCartItems.map(item => {
        if (item.productId === productId) {
          const updatedItem = cartItems.find(i => i.productId === productId);
          return updatedItem || item;
        }
        return item;
      });
      this.setData({ filteredCartItems });
      this.calculateTotalPrice();
      const updatedItem = cartItems.find(item => item.productId === productId);
      if (updatedItem) {
        this.updateCartQuantity(productId, updatedItem.quantity);
      }
    } catch (err) {
      console.error('减少数量失败:', err);
      wx.showToast({
        title: '操作失败，请稍后重试',
        icon: 'none'
      });
    }
  },
  
  // 增加数量
  increaseQuantity(e) {
    try {
      const productId = e.currentTarget.dataset.productId;
      if (!productId) {
        console.error('商品ID为空');
        return;
      }
      
      let newQuantity;
      
      const cartItems = this.data.cartItems.map(item => {
        if (item.productId === productId) {
          // 确保quantity是数字
          const currentQuantity = typeof item.quantity === 'number' ? item.quantity : 1;
          // 检查库存限制
          if (currentQuantity < item.stock) {
            newQuantity = currentQuantity + 1;
            return { ...item, quantity: newQuantity };
          } else {
            // 已达库存上限，只有当库存不是默认值99时才显示提示
            if (item.stock !== 99) {
              wx.showToast({
                title: '已达库存上限',
                icon: 'none'
              });
            }
            return item;
          }
        }
        return item;
      });
      
      this.setData({ cartItems });
      // 更新filteredCartItems
      const filteredCartItems = this.data.filteredCartItems.map(item => {
        if (item.productId === productId) {
          const updatedItem = cartItems.find(i => i.productId === productId);
          return updatedItem || item;
        }
        return item;
      });
      this.setData({ filteredCartItems });
      this.calculateTotalPrice();
      
      // 只有当数量实际变化时才更新数据库
      if (newQuantity) {
        this.updateCartQuantity(productId, newQuantity);
      }
    } catch (err) {
      console.error('增加数量失败:', err);
      wx.showToast({
        title: '操作失败，请稍后重试',
        icon: 'none'
      });
    }
  },
  
  // 处理数量变化（实时更新，不验证库存）
  onQuantityChange(e) {
    try {
      const productId = e.currentTarget.dataset.productId;
      if (!productId) {
        console.error('商品ID为空');
        return;
      }
      
      const inputValue = e.detail.value;
      
      // 直接使用输入值，不进行验证，支持删除所有数字
      let quantity = inputValue === '' ? '' : parseInt(inputValue) || '';
      
      const cartItems = this.data.cartItems.map(item => {
        if (item.productId === productId) {
          return { ...item, quantity };
        }
        return item;
      });
      this.setData({ cartItems });
      // 更新filteredCartItems
      const filteredCartItems = this.data.filteredCartItems.map(item => {
        if (item.productId === productId) {
          const updatedItem = cartItems.find(i => i.productId === productId);
          return updatedItem || item;
        }
        return item;
      });
      this.setData({ filteredCartItems });
      // 不立即计算总价和更新数据库，等待blur事件
    } catch (err) {
      console.error('数量变化处理失败:', err);
    }
  },
  
  // 输入完成后验证库存限制
  onQuantityBlur(e) {
    try {
      const productId = e.currentTarget.dataset.productId;
      if (!productId) {
        console.error('商品ID为空');
        return;
      }
      
      const inputValue = e.detail.value;
      let quantity = parseInt(inputValue) || 1;
      
      // 查找当前商品
      const currentItem = this.data.cartItems.find(item => item.productId === productId);
      if (currentItem) {
        // 检查库存限制
        if (quantity < 1) {
          quantity = 1;
        } else if (quantity > currentItem.stock) {
          quantity = currentItem.stock;
          // 只有当库存不是默认值99时才显示库存上限提示
          if (currentItem.stock !== 99) {
            wx.showToast({
              title: '已达库存上限',
              icon: 'none'
            });
          }
        }
      }
      
      const cartItems = this.data.cartItems.map(item => {
        if (item.productId === productId) {
          return { ...item, quantity };
        }
        return item;
      });
      this.setData({ cartItems });
      // 更新filteredCartItems
      const filteredCartItems = this.data.filteredCartItems.map(item => {
        if (item.productId === productId) {
          const updatedItem = cartItems.find(i => i.productId === productId);
          return updatedItem || item;
        }
        return item;
      });
      this.setData({ filteredCartItems });
      this.calculateTotalPrice();
      this.updateCartQuantity(productId, quantity);
    } catch (err) {
      console.error('数量验证失败:', err);
      wx.showToast({
        title: '操作失败，请稍后重试',
        icon: 'none'
      });
    }
  },
  
  // 更新购物车数量
  updateCartQuantity(productId, quantity) {
    try {
      if (!productId) {
        console.error('商品ID为空');
        return;
      }
      
      if (typeof quantity !== 'number' || quantity < 1) {
        console.error('数量无效:', quantity);
        return;
      }
      
      const cart = getCollection("cart");
      const itemToUpdate = this.data.cartItems.find(item => item.productId === productId);
      if (itemToUpdate && itemToUpdate._id) {
        cart
          .doc(itemToUpdate._id)
          .update({
            data: {
              quantity,
              updatedAt: new Date(),
              updatedAtTs: Date.now()
            }
          })
          .catch(err => {
            console.error("更新购物车数量失败", err);
          });
      } else {
        console.error('未找到要更新的购物车商品');
      }
    } catch (err) {
      console.error('更新购物车数量失败:', err);
    }
  },
  
  touchStart(e) {
    if (this._isScrolling) return;
    
    this._startX = e.touches[0].clientX;
    this._startY = e.touches[0].clientY;
    this._touchStartTime = Date.now();
  },

  touchMove(e) {
    if (this._isScrolling) return;
    
    const index = e.currentTarget.dataset.index;
    const startX = this._startX;
    const startY = this._startY;
    if (startX == null) return;
    
    const touchX = e.touches[0].clientX;
    const touchY = e.touches[0].clientY;
    
    const dx = touchX - startX;
    const dy = touchY - startY;
    
    if (Math.abs(dx) > Math.abs(dy) * 2) {
      // 直接使用 px 单位，不做转换
      let translateX = 0;
      if (dx < 0) {
        translateX = Math.max(-this.data.deleteWidth, dx);
      } else {
        translateX = Math.min(0, dx);
      }
      
      const items = this.data.filteredCartItems;
      if (items[index] && items[index].translateX !== translateX) {
        this.setData({
          [`filteredCartItems[${index}].translateX`]: translateX
        });
      }
    }
  },
  
  touchEnd(e) {
    if (this._isScrolling) return;
    
    const index = e.currentTarget.dataset.index;
    const items = this.data.filteredCartItems;
    const currentX = items[index]?.translateX || 0;

    if (currentX === 0) return;

    const targetX = currentX < -this.data.deleteWidth / 2 ? -this.data.deleteWidth : 0;

    const filteredCartItems = items.map((item, i) => {
      if (i === index) {
        return { ...item, translateX: targetX };
      } else if (item.translateX !== 0) {
        return { ...item, translateX: 0 };
      }
      return item;
    });

    this.setData({ filteredCartItems });
  },
  
  // 删除商品（软删除）
  deleteCartItem(e) {
    try {
      console.log('删除按钮被点击', e);
      const productId = e.currentTarget.dataset.productId;
      console.log('商品ID:', productId);
      
      if (!productId) {
        console.error('商品ID为空');
        wx.showToast({
          title: "操作失败，请稍后重试",
          icon: "none"
        });
        return;
      }
      
      const itemToDelete = this.data.cartItems.find(item => item.productId === productId);
      console.log('找到的商品:', itemToDelete);
      
      if (!itemToDelete || !itemToDelete._id) {
        console.log('未找到商品或商品ID');
        wx.showToast({
          title: "商品不存在",
          icon: "none"
        });
        return;
      }
      
      // 软删除，更新isDelete字段为true
      const cart = getCollection("cart");
      console.log('开始删除商品:', itemToDelete._id);
      cart
        .doc(itemToDelete._id)
        .update({
          data: {
            isDelete: true,
            updatedAt: new Date()
          }
        })
        .then(() => {
          console.log('删除成功');
          wx.showToast({
            title: "删除成功",
            icon: "success",
            duration: 1500
          });
          // 直接从数组中移除该项
          const cartItems = this.data.cartItems.filter(item => item.productId !== productId);
          const filteredCartItems = this.data.filteredCartItems.filter(item => item.productId !== productId);
          
          // 更新游标：设置为当前最后一条数据的 _id 和 updatedAtTs
          const lastId = cartItems.length > 0 ? cartItems[cartItems.length - 1]._id : null;
          const lastUpdatedAtTs = cartItems.length > 0 ? (cartItems[cartItems.length - 1].updatedAtTs || null) : null;
          const hasMore = cartItems.length > 0 && this.data.hasMore;
          
          console.log(`[购物车] 删除商品后更新游标: lastId从${this.data.lastId}更新为${lastId}, lastUpdatedAtTs从${this.data.lastUpdatedAtTs}更新为${lastUpdatedAtTs}`);
          
          this.setData({
            cartItems,
            filteredCartItems,
            lastId: lastId,
            lastUpdatedAtTs: lastUpdatedAtTs,
            hasMore: hasMore
          });
          // 更新购物车缓存
          this.setCartCache(cartItems);
          this.calculateTotalPrice();
        })
        .catch(err => {
          console.error("删除购物车商品失败", err);
          wx.showToast({
            title: "删除失败",
            icon: "none"
          });
        });
    } catch (err) {
      console.error('删除商品失败:', err);
      wx.showToast({
        title: "操作失败，请稍后重试",
        icon: "none"
      });
    }
  },
  
  // 跳转到商品详情页
  goToProductDetail(e) {
    try {
      console.log('goToProductDetail被调用', e);
      const productId = e.currentTarget.dataset.productId;
      console.log('商品ID:', productId);
      
      if (productId) {
        console.log('准备跳转到商品详情页', productId);
        // 使用对象属性设置从详情页返回的标志，避免 setData 触发渲染
        this._fromDetail = true;
        wx.navigateTo({
          url: `/pages/product-detail/index?id=${productId}`,
        });
      }
    } catch (err) {
      console.error('跳转商品详情页失败:', err);
    }
  },

  // 跳转首页
  goToHome() {
    wx.switchTab({
      url: '/pages/category/index'
    });
  },

  // 跳转到结算页面
  goToCheckout() {
    const selectedItems = this.data.cartItems.filter(item => item.selected);
    
    if (selectedItems.length === 0) {
      wx.showToast({
        title: '请选择商品',
        icon: 'none'
      });
      return;
    }
    
    const checkoutData = {
      items: selectedItems.map(item => ({
        productId: item.productId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        coverImage: item.coverImage,
        stock: item.stock,
        typeId: item.typeId,
        cartId: item._id
      })),
      totalPrice: this.data.totalPrice,
      fromCart: true
    };
    
    wx.navigateTo({
      url: `/pages/checkout/index?data=${encodeURIComponent(JSON.stringify(checkoutData))}`
    });
  },

  // 切换商品选中状态
  toggleSelect(e) {
    const productId = e.currentTarget.dataset.productId;
    
    const cartItems = this.data.cartItems.map(item => {
      if (item.productId === productId) {
        return { ...item, selected: !item.selected };
      }
      return item;
    });
    
    this.setData({ cartItems });
    
    // 同时更新filteredCartItems
    const filteredCartItems = this.data.filteredCartItems.map(item => {
      if (item.productId === productId) {
        const updatedItem = cartItems.find(i => i.productId === productId);
        return updatedItem || item;
      }
      return item;
    });
    this.setData({ filteredCartItems });
    
    this.updateSelectionStatus();
    this.calculateTotalPrice();
    
    // 更新数据库中的选中状态
    this.updateCartSelection(productId, cartItems.find(item => item.productId === productId).selected);
  },

  // 更新数据库中的选中状态
  updateCartSelection(productId, selected) {
    try {
      const cart = getCollection("cart");
      const itemToUpdate = this.data.cartItems.find(item => item.productId === productId);
      if (itemToUpdate && itemToUpdate._id) {
        cart
          .doc(itemToUpdate._id)
          .update({
            data: {
              selected
            }
          })
          .catch(err => {
            console.error("更新购物车选中状态失败", err);
          });
      }
    } catch (err) {
      console.error('更新选中状态失败:', err);
    }
  },

  // 切换全选状态
  toggleSelectAll() {
    const selectAll = !this.data.selectAll;
    
    const cartItems = this.data.cartItems.map(item => {
      // 售罄商品不能选中
      if (item.isSoldOut) {
        return { ...item, selected: false };
      }
      return { ...item, selected: selectAll };
    });
    
    this.setData({ cartItems });
    
    // 同时更新filteredCartItems
    const filteredCartItems = this.data.filteredCartItems.map(item => {
      if (item.isSoldOut) {
        return { ...item, selected: false };
      }
      const updatedItem = cartItems.find(i => i.productId === item.productId);
      return updatedItem || item;
    });
    this.setData({ filteredCartItems });
    
    this.updateSelectionStatus();
    this.calculateTotalPrice();
    
    // 批量更新数据库中的选中状态
    this.batchUpdateCartSelection(selectAll);
  },

  // 批量更新数据库中的选中状态
  batchUpdateCartSelection(selected) {
    try {
      const cart = getCollection("cart");
      
      // 获取所有未售罄的商品
      const itemsToUpdate = this.data.cartItems.filter(item => !item.isSoldOut);
      
      // 批量更新
      const promises = itemsToUpdate.map(item => {
        if (item._id) {
          return cart
            .doc(item._id)
            .update({
              data: {
                selected
              }
            })
            .catch(err => {
              console.error("批量更新购物车选中状态失败", err);
            });
        }
      });
      
      Promise.all(promises).catch(err => {
        console.error('批量更新选中状态失败:', err);
      });
    } catch (err) {
      console.error('批量更新选中状态失败:', err);
    }
  },

  // 更新选中状态统计
  updateSelectionStatus() {
    const { cartItems } = this.data;
    
    // 过滤掉售罄商品后计算
    const availableItems = cartItems.filter(item => !item.isSoldOut);
    const selectedItems = availableItems.filter(item => item.selected);
    const selectAll = availableItems.length > 0 && selectedItems.length === availableItems.length;
    
    this.setData({
      selectAll,
      selectedCount: selectedItems.length
    });
  },

  // 计算总价
  calculateTotalPrice() {
    const { cartItems } = this.data;
    const totalPrice = cartItems
      .filter(item => item.selected && !item.isSoldOut)
      .reduce((sum, item) => {
        const price = typeof item.price === 'number' ? item.price : 0;
        const quantity = typeof item.quantity === 'number' ? item.quantity : 1;
        return sum + price * quantity;
      }, 0);
    
    this.setData({ totalPrice: Math.round(totalPrice * 100) / 100 });
  },

  // 处理搜索事件
  handleSearch(e) {
    const { keyword } = e.detail;
    this.setData({ searchKeyword: keyword });
    this.performSearch(keyword);
  },

  // 处理筛选事件
  handleFilter(e) {
    const { filterOptions } = e.detail;
    this.setData({ filterOptions });
    this.applyFilter();
  },

  // 阻止事件冒泡
  stopPropagation() {
    // 空函数，用于阻止事件冒泡
  },

  // 处理分类点击
  onCategoryTap(e) {
    // 获取点击的分类信息
    const categoryId = e.currentTarget.dataset.categoryId;
    const categoryName = e.currentTarget.dataset.categoryName;
    
    // 更新筛选条件
    const filterOptions = { ...this.data.filterOptions };
    if (!filterOptions.category) {
      filterOptions.category = [];
    }
    
    // 切换选中状态
    const categoryIndex = filterOptions.category.indexOf(categoryId);
    if (categoryIndex > -1) {
      filterOptions.category.splice(categoryIndex, 1);
    } else {
      filterOptions.category.push(categoryId);
    }
    
    this.setData({ filterOptions });
    this.applyFilter();
  },

  // 显示数量选择器
  showQuantitySelector(e) {
    const productId = e.currentTarget.dataset.productId;
    this.setData({ expandedQuantityId: productId });
  },

  // 隐藏数量选择器
  hideQuantitySelector() {
    this.setData({ expandedQuantityId: null });
  },

  // 批量删除选中的商品
  batchDelete() {
    const selectedItems = this.data.cartItems.filter(item => item.selected);
    
    if (selectedItems.length === 0) {
      wx.showToast({
        title: '请选择要删除的商品',
        icon: 'none'
      });
      return;
    }
    
    wx.showModal({
      title: '确认删除',
      content: `确定要删除选中的 ${selectedItems.length} 件商品吗？`,
      success: (res) => {
        if (res.confirm) {
          this.performBatchDelete(selectedItems);
        }
      }
    });
  },

  // 执行批量删除
  async performBatchDelete(items) {
    const cart = getCollection("cart");
    
    try {
      for (const item of items) {
        if (item._id) {
          await cart.doc(item._id).update({
            data: {
              isDelete: true,
              updatedAt: new Date()
            }
          });
        }
      }
      
      wx.showToast({
        title: '删除成功',
        icon: 'success'
      });
      
      // 从列表中移除已删除的商品
      const deletedProductIds = items.map(item => item.productId);
      const cartItems = this.data.cartItems.filter(item => !deletedProductIds.includes(item.productId));
      const filteredCartItems = this.data.filteredCartItems.filter(item => !deletedProductIds.includes(item.productId));
      
      this.setData({ cartItems, filteredCartItems });
      this.setCartCache(cartItems);
      this.updateSelectionStatus();
      this.calculateTotalPrice();
    } catch (err) {
      console.error('批量删除失败:', err);
      wx.showToast({
        title: '删除失败，请重试',
        icon: 'none'
      });
    }
  },

  // 商品项点击处理
  onItemTap(e) {
    // 处理商品项的点击事件
    const productId = e.currentTarget.dataset.productId;
    if (productId) {
      this.goToProductDetail(e);
    }
  },

  // 图片点击处理
  onImageTap(e) {
    // 处理图片点击事件
    const productId = e.currentTarget.dataset.productId;
    if (productId) {
      this.goToProductDetail(e);
    }
  }
});
