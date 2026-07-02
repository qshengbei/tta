import { getCollection } from "../../utils/cloud";
import { getGlobalOrderWatcher } from "../../utils/globalOrderWatcher";
import orderCacheStore from "../../utils/orderCacheStore";
const db = wx.cloud.database();
const _ = db.command;

Page({
  _isFirstEntry: true,
  _isUnloaded: false,

  data: {
    orders: [],
    originalOrders: [],
    loading: true,
    error: false,
    errorMessage: "",
    selectedStatus: "all",
    deliveryType: null,
    scrollTop: 0,
    isFirstLoad: true,
    processingExpired: false,
    fromDetail: false,
    isSwitchingStatus: false,
    
    // 游标分页相关字段
    pageSize: 18,
    lastUpdatedAtTs: null,
    lastId: null,
    hasMore: true,
    loadingMore: false,
    
    // 搜索筛选列表专用字段
    isSearchFilterMode: false,
    searchFilterLastUpdatedAtTs: null,
    searchFilterLastId: null,
    searchFilterHasMore: true,
    searchFilterLoadingMore: false,
    searchFilterCacheIndex: 0,
    
    // 搜索和筛选相关
    searchKeyword: '',
    filterOptions: {
      status: null,
      deliveryType: null,
      timeRange: null,
      category: []
    },
    showLogistics: false,
    logisticsData: null,
    logisticsMapData: null,
    logisticsMapCenter: { latitude: 39.908823, longitude: 116.397470 },
    logisticsMapScale: 10,
    logisticsTrackPoints: [],
    logisticsStateMap: null,
    isMapFullScreen: false,
    mapHeight: 300,

    // 页面可见性与缓存相关
    pageVisible: false,
    pendingRefresh: false,
    cacheVersion: 0,
    hasNavigatedAway: false,

  },

  onLoad(options) {
    // 获取URL参数中的status和deliveryType
    if (options && options.status) {
      this.setData({ selectedStatus: options.status });
    }
    if (options && options.deliveryType) {
      this.setData({ deliveryType: options.deliveryType });
    }

    this.__pageId = "order_list_page";
    
    this.initLogisticsStateData();
  },

  getCacheKey(status) {
    const app = getApp();
    const openid = app.globalData.openid;
    return `order_cache_${openid}_${status}`;
  },

  getCachedOrders(status) {
    try {
      const cacheKey = this.getCacheKey(status);
      const cached = wx.getStorageSync(cacheKey);
      if (cached && cached.data && cached.timestamp) {
        const now = Date.now();
        const cacheAge = now - cached.timestamp;
        const cacheValidity = 5 * 60 * 1000;
        if (cacheAge < cacheValidity) {
          console.log(`[订单列表] 缓存命中，状态: ${status}, 缓存年龄: ${Math.round(cacheAge/1000)}秒, 有效期: 5分钟`);
          return {
            data: cached.data,
            lastUpdatedAtTs: cached.lastUpdatedAtTs,
            lastId: cached.lastId,
            hasMore: cached.hasMore
          };
        } else {
          console.log(`[订单列表] 缓存过期，状态: ${status}, 缓存年龄: ${Math.round(cacheAge/1000)}秒`);
        }
      }
    } catch (e) {
      console.error('[订单列表] 读取订单缓存失败:', e);
    }
    return null;
  },

  setCachedOrders(status, orders, lastUpdatedAtTs = null, lastId = null, hasMore = false) {
    try {
      const cacheKey = this.getCacheKey(status);
      wx.setStorageSync(cacheKey, {
        data: orders,
        timestamp: Date.now(),
        version: this.data.cacheVersion + 1,
        lastUpdatedAtTs,
        lastId,
        hasMore
      });
    } catch (e) {
      console.error('[订单列表] 保存订单缓存失败:', e);
    }
  },

  clearCachedOrders(status) {
    try {
      const cacheKey = this.getCacheKey(status);
      wx.removeStorageSync(cacheKey);
    } catch (e) {
      console.error('[订单列表] 清除订单缓存失败:', e);
    }
  },

  async initLogisticsStateData() {
    try {
      await wx.cloud.callFunction({
        name: 'express100',
        data: {
          action: 'initLogisticsStateData'
        }
      });
    } catch (error) {
      // 静默处理初始化错误
    }
  },

  async getStateMap() {
    try {
      const result = await wx.cloud.callFunction({
        name: 'express100',
        data: {
          action: 'getStateMap'
        }
      });

      if (result.result && result.result.success) {
        this.setData({
          logisticsStateMap: result.result.data
        });
      }
    } catch (error) {
      // 静默处理
    }
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
    
    this.setData({ pageVisible: true });

    const watcher = getGlobalOrderWatcher();
    watcher.setPageVisible(this.__pageId, true);

    const hasSearch = this.data.searchKeyword && this.data.searchKeyword.trim() !== '';
    const hasTimeRange = this.data.filterOptions.timeRange !== null;
    const hasFilters = hasSearch || hasTimeRange;

    if (this.data.hasNavigatedAway) {
      this.setData({ hasNavigatedAway: false });
      console.log(`[订单列表] onShow 耗时: ${Date.now() - startTime}ms`);
      return;
    }

    if (this.data.isSwitchingStatus) {
      this.setData({ isSwitchingStatus: false });
      return;
    }

    if (getApp().globalData.needRefreshOrderList) {
      getApp().globalData.needRefreshOrderList = false;
      console.log('[订单列表] 强制刷新，从数据库加载');
      this.fetchOrders();
      this.checkAndRefreshExpiredLogistics();
      return;
    }

    if (hasFilters) {
      if (this.data.orders.length > 0) {
        console.log('[订单列表] 搜索筛选模式已有数据，保持不变');
      } else {
        console.log('[订单列表] 搜索筛选模式无数据，查询数据库');
        this.fetchSearchFilterOrders();
      }
    } else if (this.data.orders.length > 0) {
      console.log('[订单列表] 普通列表已有数据，直接显示');
    } else {
      console.log('[订单列表] 页面无数据，快速显示缓存');
      this._quickShowFromCache();
    }
    
    this._asyncCheckAndUpdate(isFirstEntry);

    if (wasHidden) {
      console.log('[订单列表] 页面之前隐藏，重新连接监听器');
      this.startOrderWatch();
    } else {
      console.log('[订单列表] 页面未隐藏，检查监听器状态');
      if (!this._unsubOrderWatcher) {
        console.log('[订单列表] 监听器未启动，启动监听器');
        this.startOrderWatch();
      } else {
        console.log('[订单列表] 监听器已启动，无需重复启动');
      }
    }

    this.checkAndRefreshExpiredLogistics();

    console.log(`[订单列表] onShow 耗时: ${Date.now() - startTime}ms`);
  },

  _quickShowFromCache() {
    const cacheKey = this.getCacheKey(this.data.selectedStatus);
    const cached = orderCacheStore.get(cacheKey);
    
    if (cached && cached.data && cached.data.length > 0) {
      console.log('[订单列表] 快速显示缓存数据:', cacheKey, '数量:', cached.data.length);
      
      const cursor = cached.cursor || {};
      this.setData({
        lastUpdatedAtTs: cursor.updatedAtTs || null,
        lastId: cursor._id || null,
        hasMore: cached.hasMore !== false,
        originalOrders: cached.data
      });
      
      this.processOrders(cached.data);
    } else {
      console.log('[订单列表] 无缓存数据，从数据库加载');
      this.fetchOrders();
    }
  },

  async _asyncCheckAndUpdate(isFirstEntry = false) {
    try {
      if (this._isUnloaded) return;

      const watcher = getGlobalOrderWatcher();

      const cacheKey = this.getCacheKey(this.data.selectedStatus);
      const updateMark = watcher.getAndClearUpdateMark(cacheKey);
      if (updateMark) {
        console.log('[订单列表] 监听器检测到缓存更新:', cacheKey);
        this._syncDataFromCache();
      }

      const healthCheck = watcher.checkNeedsRefresh();
      if (healthCheck.needsRefresh) {
        console.log('[订单列表] 监听器不健康，刷新数据:', healthCheck.reason);
        this.fetchOrders();
        return;
      }

      if (isFirstEntry) {
        console.log('[订单列表] 首次进入，跳过时间戳对比');
        return;
      }

      if (this.data.orders.length > 0) {
        console.log('[订单列表] 返回页面，执行时间戳对比');
        await this._validateOrderCacheAsync();
      } else {
        console.log('[订单列表] 返回页面但无数据，跳过时间戳对比');
      }
    } catch (error) {
      console.error('[订单列表] _asyncCheckAndUpdate 失败:', error);
    }
  },

  _syncDataFromCache() {
    const cacheKey = this.getCacheKey(this.data.selectedStatus);
    const cached = orderCacheStore.get(cacheKey);
    
    if (!cached || !cached.data || cached.data.length === 0) return;
    
    const currentLoaded = this.data.orders.length;
    if (currentLoaded > cached.data.length) {
      console.log(`[订单列表] 当前已加载 ${currentLoaded} 条 > 缓存 ${cached.data.length} 条，保持原数据`);
      return;
    }
    
    const cursor = cached.cursor || {};
    this.setData({
      originalOrders: cached.data,
      lastUpdatedAtTs: cursor.updatedAtTs || null,
      lastId: cursor._id || null,
      hasMore: cached.hasMore !== false
    });
    
    this.processOrders(cached.data);
  },

  async _validateOrderCacheAsync() {
    try {
      const app = getApp();
      const openid = app.globalData.openid;
      if (!openid) return;

      const cacheKey = this.getCacheKey(this.data.selectedStatus);
      const cache = orderCacheStore.get(cacheKey);
      if (!cache || !cache.data || cache.data.length === 0) return;

      const selectedStatus = this.data.selectedStatus;
      const orders = getCollection("orders");

      let baseQuery = { _openid: openid, isDeleted: db.command.neq(true) };
      if (this.data.deliveryType) {
        baseQuery.deliveryType = this.data.deliveryType;
      }

      let query;
      if (selectedStatus === "all") {
        query = orders.where(baseQuery);
      } else if (selectedStatus === "shipping") {
        query = orders.where({ ...baseQuery, status: _.in(['shipping', 'delivered']) });
      } else if (selectedStatus === "refund") {
        query = orders.where({ ...baseQuery, status: _.in(['refund', 'refund_completed']) });
      } else if (selectedStatus === "completed") {
        query = orders.where({ ...baseQuery, status: _.in(['completed', 'refund_completed']) });
      } else {
        query = orders.where({ ...baseQuery, status: selectedStatus });
      }

      const timeRes = await query.orderBy('updatedAtTs', 'desc').limit(1).get();
      const serverMaxTime = timeRes.data?.[0]?.updatedAtTs || 0;
      const cachedMaxTime = cache.serverMaxUpdateTime || 0;

      console.log(`[订单列表] 时间戳对比: 缓存=${cachedMaxTime}, 数据库=${serverMaxTime}, 状态=${selectedStatus}`);

      if (serverMaxTime !== cachedMaxTime) {
        console.log(`[订单列表] 时间戳对比发现差异，更新第一页数据 (缓存=${cachedMaxTime}, 数据库=${serverMaxTime})`);

        const pageSize = this.data.pageSize;
        const fetchLimit = Math.min(pageSize + 1, 20);

        let firstPageQuery;
        if (selectedStatus === "all") {
          firstPageQuery = orders.where(baseQuery);
        } else if (selectedStatus === "shipping") {
          firstPageQuery = orders.where({ ...baseQuery, status: _.in(['shipping', 'delivered']) });
        } else if (selectedStatus === "refund") {
          firstPageQuery = orders.where({ ...baseQuery, status: _.in(['refund', 'refund_completed']) });
        } else if (selectedStatus === "completed") {
          firstPageQuery = orders.where({ ...baseQuery, status: _.in(['completed', 'refund_completed']) });
        } else {
          firstPageQuery = orders.where({ ...baseQuery, status: selectedStatus });
        }

        const firstPageRes = await firstPageQuery.orderBy('updatedAtTs', 'desc').orderBy('_id', 'desc').limit(fetchLimit).get();
        const rawOrders = firstPageRes.data || [];
        const hasMore = rawOrders.length > pageSize;
        const newOrders = hasMore ? rawOrders.slice(0, pageSize) : rawOrders;

        let newLastUpdatedAtTs = null;
        let newLastId = null;
        if (newOrders.length > 0) {
          const lastItem = newOrders[newOrders.length - 1];
          newLastUpdatedAtTs = lastItem.updatedAtTs;
          newLastId = lastItem._id;
        }

        const newServerMaxTime = newOrders[0]?.updatedAtTs || serverMaxTime;
        const newCursor = newLastId ? { updatedAtTs: newLastUpdatedAtTs, _id: newLastId } : null;

        console.log(`[订单列表] 时间戳校验：只保留第一页${newOrders.length}条，丢弃旧后续页${cache.data.length - newOrders.length}条`);

        this.setData({
          originalOrders: newOrders,
          lastUpdatedAtTs: newLastUpdatedAtTs,
          lastId: newLastId,
          hasMore: hasMore,
          loadingMore: false
        });

        this.processOrders(newOrders);

        console.log(`[订单列表] 写入缓存(校验更新) - key: ${cacheKey}, 数据条数: ${newOrders.length}, serverMaxUpdateTime: ${newServerMaxTime}, hasMore: ${hasMore}`);
        orderCacheStore.set(cacheKey, {
          data: newOrders,
          cacheIndex: newOrders.length,
          cursor: newCursor,
          hasMore: hasMore,
          stale: false,
          serverMaxUpdateTime: newServerMaxTime
        });
      } else {
        console.log(`[订单列表] 时间戳对比无差异，缓存有效 (缓存时间戳=${cachedMaxTime}, 数据库时间戳=${serverMaxTime})`);
      }
    } catch (error) {
      console.error('[订单列表] _validateOrderCacheAsync 失败:', error);
    }
  },

  /**
   * 检查并后台刷新超过30分钟的物流状态
   */
  async checkAndRefreshExpiredLogistics() {
    if (!this.data.pageVisible) {
      return;
    }

    try {
      const orders = this.data.originalOrders || [];
      const now = Date.now();
      const CACHE_DURATION = 30 * 60 * 1000; // 30分钟

      for (const order of orders) {
        // 仅处理非终态订单（isCheck !== '1'）
        if (order.logisticsState && order.logisticsState.isCheck !== '1') {
          const rawLastGetTime = order.logisticsState.lastGetTime;
          const lastGetTimeMs = rawLastGetTime instanceof Date
            ? rawLastGetTime.getTime()
            : (typeof rawLastGetTime === 'number'
              ? rawLastGetTime
              : (rawLastGetTime ? new Date(rawLastGetTime).getTime() : 0));
          const age = now - (Number.isFinite(lastGetTimeMs) ? lastGetTimeMs : 0);

          if (age > CACHE_DURATION) {
            // 异步后台刷新，不阻塞UI
            this.refreshLogisticsInBackground(order);
          }
        }
      }
    } catch (error) {
      // 静默处理物流检查错误
    }
  },

  /**
   * 后台刷新物流状态（不阻塞UI）
   */
  async refreshLogisticsInBackground(order) {
    try {
      if (!order.logisticsInfo || !order.logisticsInfo.trackingNumber) {
        return;
      }

      const result = await wx.cloud.callFunction({
        name: 'express100',
        data: {
          action: 'queryLogisticsAndUpdateOrder',
          expressNo: order.logisticsInfo.trackingNumber,
          companyCode: order.logisticsInfo.companyCode || '',
          fromAddress: order.fromAddress || '',
          toAddress: this.buildToAddress(order),
          forceRefresh: true
        }
      });

      if (result.result && result.result.success) {
        const logisticsResult = result.result;
        const nextLogisticsState = {
          state: logisticsResult.state || '',
          stateName: logisticsResult.stateName || '',
          isCheck: logisticsResult.isCheck || '',
          lastGetTime: new Date()
        };

        if (String(logisticsResult.isCheck) === '1' && logisticsResult.arrivalTime) {
          nextLogisticsState.checkTime = String(logisticsResult.arrivalTime).trim();
        }

        // 更新本地订单数据中的 logisticsState
        const updatedOrders = this.data.originalOrders.map(o => {
          if (o._id === order._id) {
            return {
              ...o,
              logisticsState: nextLogisticsState,
              // 如果订单已被更新为delivered，同步更新本地状态
              ...(logisticsResult.orderUpdated ? { status: 'delivered' } : {})
            };
          }
          return o;
        });

        this.setData({
          originalOrders: updatedOrders
        });

        // 刷新当前显示的订单列表
        this.processOrders(updatedOrders);
      }
    } catch (error) {
      // 静默处理物流刷新错误
    }
  },

  /**
   * 构建收货地址（辅助方法）
   */
  buildToAddress(order) {
    const addressObj = order.address && typeof order.address === 'object' ? order.address : null;
    const toAddressParts = [
      addressObj?.provinceName,
      addressObj?.cityName,
      addressObj?.countyName,
      addressObj?.detailInfo
    ].filter(Boolean);

    return (
      toAddressParts.join('') ||
      (typeof order.address === 'string' ? order.address : '') ||
      order.receiverAddress ||
      order.consigneeAddress ||
      order.shippingAddress ||
      ''
    ).trim();
  },

  onPageScroll(e) {
    // 保存滚动位置
    this.setData({ scrollTop: e.scrollTop });
  },

  fetchOrdersWithCallback(callback) {
    // 设置回调函数
    this._fetchCallback = callback;
    // 调用原有的 fetchOrders 方法
    this.fetchOrders();
  },

  fetchOrders() {
    // 重置游标分页状态
    this.setData({
      loading: true,
      error: false,
      errorMessage: "",
      lastUpdatedAtTs: null,
      lastId: null,
      hasMore: true,
      loadingMore: false,
      orders: [],
      originalOrders: [],
      isSearchFilterMode: false,
      searchFilterLastUpdatedAtTs: null,
      searchFilterLastId: null,
      searchFilterHasMore: true,
      searchFilterLoadingMore: false
    });
    this.fetchOrdersPage(true);
  },

  async fetchOrdersPage(isFirstPage = true) {
    const app = getApp();
    const openid = app.globalData.openid;
    
    if (!openid) {
      wx.showToast({
        title: '获取用户信息失败',
        icon: 'none'
      });
      this.setData({ loading: false, error: true, errorMessage: '获取用户信息失败' });
      return;
    }
    
    if (this.data.loadingMore || !this.data.hasMore) return;
    
    this.setData({ loadingMore: true });
    
    const orders = getCollection("orders");
    const { pageSize, lastUpdatedAtTs, lastId } = this.data;
    const fetchLimit = Math.min(pageSize + 1, 20);
    
    // 游标分页日志：查询参数
    console.log(`[订单列表] 游标分页查询 - isFirstPage: ${isFirstPage}, pageSize: ${pageSize}, fetchLimit: ${fetchLimit}, lastUpdatedAtTs: ${lastUpdatedAtTs}, lastId: ${lastId}`);
    
    let baseQuery = { _openid: openid, isDeleted: db.command.neq(true) };
    
    if (this.data.deliveryType) {
      baseQuery.deliveryType = this.data.deliveryType;
    }
    
    const status = this.data.selectedStatus;
    
    let cursorCondition = null;
    if (!isFirstPage && lastUpdatedAtTs && lastId) {
      cursorCondition = _.or([
        { updatedAtTs: _.lt(lastUpdatedAtTs) },
        { updatedAtTs: _.eq(lastUpdatedAtTs), _id: _.lt(lastId) }
      ]);
    }
    
    let queryPromise;
    
    if (status === "all") {
      let query = baseQuery;
      if (cursorCondition) {
        query = _.and([baseQuery, cursorCondition]);
      }
      queryPromise = orders.where(query).orderBy('updatedAtTs', 'desc').orderBy('_id', 'desc').limit(fetchLimit).get();
    } else if (status === "paid") {
      let query = { ...baseQuery, status: 'paid' };
      if (cursorCondition) {
        query = _.and([query, cursorCondition]);
      }
      queryPromise = orders.where(query).orderBy('updatedAtTs', 'desc').orderBy('_id', 'desc').limit(fetchLimit).get();
    } else if (status === "shipping") {
      let query = { ...baseQuery, status: _.in(['shipping', 'delivered']) };
      if (cursorCondition) {
        query = _.and([query, cursorCondition]);
      }
      queryPromise = orders.where(query).orderBy('updatedAtTs', 'desc').orderBy('_id', 'desc').limit(fetchLimit).get();
    } else if (status === "refund") {
      let query = { ...baseQuery, status: _.in(['refund', 'refund_completed']) };
      if (cursorCondition) {
        query = _.and([query, cursorCondition]);
      }
      queryPromise = orders.where(query).orderBy('updatedAtTs', 'desc').orderBy('_id', 'desc').limit(fetchLimit).get();
    } else if (status === "completed") {
      let query = { ...baseQuery, status: _.in(['completed', 'refund_completed']) };
      if (cursorCondition) {
        query = _.and([query, cursorCondition]);
      }
      queryPromise = orders.where(query).orderBy('updatedAtTs', 'desc').orderBy('_id', 'desc').limit(fetchLimit).get();
    } else {
      let query = { ...baseQuery, status: status };
      if (cursorCondition) {
        query = _.and([query, cursorCondition]);
      }
      queryPromise = orders.where(query).orderBy('updatedAtTs', 'desc').orderBy('_id', 'desc').limit(fetchLimit).get();
    }
    
    try {
      const res = await queryPromise;
      const rawOrders = res.data || [];
      const hasMore = rawOrders.length > pageSize;
      const newOrders = hasMore ? rawOrders.slice(0, pageSize) : rawOrders;
      
      let newLastUpdatedAtTs = null;
      let newLastId = null;
      if (newOrders.length > 0) {
        const lastItem = newOrders[newOrders.length - 1];
        newLastUpdatedAtTs = lastItem.updatedAtTs;
        newLastId = lastItem._id;
      }
      
      // 游标分页日志：查询结果
      console.log(`[订单列表] 游标分页结果 - 查询返回: ${rawOrders.length}条, 实际返回: ${newOrders.length}条, hasMore: ${hasMore}, 新游标: updatedAtTs=${newLastUpdatedAtTs}, _id=${newLastId}`);
      
      let allOrders;
      if (isFirstPage) {
        allOrders = newOrders;
      } else {
        allOrders = [...this.data.originalOrders, ...newOrders];
      }
      
      this.setData({
        originalOrders: allOrders,
        lastUpdatedAtTs: newLastUpdatedAtTs,
        lastId: newLastId,
        hasMore: hasMore,
        loadingMore: false,
        loading: isFirstPage ? false : this.data.loading
      });
      
      this.processOrders(allOrders);
      
      const cacheKey = this.getCacheKey(this.data.selectedStatus);
      const newCursor = newLastId ? { updatedAtTs: newLastUpdatedAtTs, _id: newLastId } : null;
      
      let serverMaxUpdateTime = newOrders[0]?.updatedAtTs || 0;
      if (newOrders.length === 0) {
        try {
          let latestQuery;
          if (status === "all") {
            latestQuery = orders.where(baseQuery);
          } else if (status === "shipping") {
            latestQuery = orders.where({ ...baseQuery, status: _.in(['shipping', 'delivered']) });
          } else if (status === "refund") {
            latestQuery = orders.where({ ...baseQuery, status: _.in(['refund', 'refund_completed']) });
          } else if (status === "completed") {
            latestQuery = orders.where({ ...baseQuery, status: _.in(['completed', 'refund_completed']) });
          } else {
            latestQuery = orders.where({ ...baseQuery, status: status });
          }
          const latestRes = await latestQuery.orderBy('updatedAtTs', 'desc').limit(1).get();
          serverMaxUpdateTime = latestRes.data?.[0]?.updatedAtTs || 0;
          console.log(`[订单列表] 写入时间戳 - 0条数据，查询数据库最新时间戳: ${serverMaxUpdateTime}, 状态: ${status}`);
        } catch (e) {
          console.log(`[订单列表] 写入时间戳 - 0条数据，查询最新时间戳失败: ${e.message || e}, 状态: ${status}`);
        }
      } else {
        console.log(`[订单列表] 写入时间戳 - 取首条数据时间戳: ${serverMaxUpdateTime}, 订单数: ${newOrders.length}, 状态: ${status}`);
      }

      if (isFirstPage) {
        console.log(`[订单列表] 写入缓存(set) - key: ${cacheKey}, 数据条数: ${allOrders.length}, serverMaxUpdateTime: ${serverMaxUpdateTime}, hasMore: ${hasMore}`);
        orderCacheStore.set(cacheKey, {
          data: allOrders,
          cacheIndex: allOrders.length,
          cursor: newCursor,
          hasMore,
          stale: false,
          serverMaxUpdateTime
        });
      } else {
        orderCacheStore.append(cacheKey, newOrders, newCursor, hasMore);
      }
      
      if (isFirstPage && this._fetchCallback) {
        this._fetchCallback();
        this._fetchCallback = null;
      }
    } catch (err) {
      console.error("获取订单列表失败", err);
      this.setData({ 
        loading: false, 
        loadingMore: false,
        error: true, 
        errorMessage: '获取订单列表失败' 
      });
      throw err;
    }
  },

  // 加载更多订单
  loadMoreOrders() {
    if (this.data.loadingMore || !this.data.hasMore || this.data.loading) return;
    
    if (this.data.isSearchFilterMode) {
      const cacheKey = this.getCacheKey(this.data.selectedStatus);
      const cached = orderCacheStore.get(cacheKey);
      const cacheIndex = this.data.searchFilterCacheIndex || 0;
      
      if (cached && cached.data && cached.data.length > cacheIndex && cached.hasMore === false) {
        const pageSize = this.data.pageSize;
        const pageData = cached.data.slice(cacheIndex, cacheIndex + pageSize);
        
        if (pageData.length > 0) {
          console.log(`[订单列表] 搜索筛选模式从缓存加载更多，索引: ${cacheIndex}, 数量: ${pageData.length}`);
          
          this.setData({
            originalOrders: [...this.data.originalOrders, ...pageData],
            searchFilterCacheIndex: cacheIndex + pageSize,
            hasMore: cached.data.length > cacheIndex + pageSize,
            loadingMore: false
          });
          
          this.filterOrdersLocally();
          return;
        }
      }
      
      this.fetchSearchFilterOrdersPage(false);
    } else {
      this.fetchOrdersPage(false);
    }
  },

  // 搜索筛选列表：获取第一页
  fetchSearchFilterOrders() {
    this.setData({
      loading: true,
      isSearchFilterMode: true,
      searchFilterLastUpdatedAtTs: null,
      searchFilterLastId: null,
      searchFilterHasMore: true,
      searchFilterLoadingMore: false,
      orders: [],
      originalOrders: []
    });
    this.fetchSearchFilterOrdersPage(true);
  },

  // 搜索筛选列表：获取分页数据
  async fetchSearchFilterOrdersPage(isFirstPage = true) {
    const app = getApp();
    const openid = app.globalData.openid;

    if (!openid) {
      wx.showToast({ title: '获取用户信息失败', icon: 'none' });
      this.setData({ loading: false, error: true, errorMessage: '获取用户信息失败' });
      return;
    }

    const { pageSize, searchFilterLastUpdatedAtTs, searchFilterLastId, searchFilterHasMore, searchFilterLoadingMore } = this.data;

    if (searchFilterLoadingMore || !searchFilterHasMore) return;

    this.setData({ searchFilterLoadingMore: true });

    const { searchKeyword, filterOptions, selectedStatus } = this.data;

    console.log(`[订单列表] 搜索筛选查询 - isFirstPage: ${isFirstPage}, keyword: "${searchKeyword}", filterOptions:`, filterOptions);

    try {
      const res = await wx.cloud.callFunction({
        name: 'queryOrders',
        data: {
          status: selectedStatus,
          searchKeyword,
          timeRange: filterOptions.timeRange,
          category: filterOptions.category.length > 0 ? filterOptions.category : undefined,
          pageSize,
          lastUpdatedAtTs: isFirstPage ? null : searchFilterLastUpdatedAtTs,
          lastId: isFirstPage ? null : searchFilterLastId,
          isFirstPage
        }
      });

      if (!res.result || !res.result.success) {
        throw new Error(res.result?.error || '查询失败');
      }

      const { data: newOrders, hasMore, lastUpdatedAtTs, lastId } = res.result;

      console.log(`[订单列表] 搜索筛选结果 - 本次获取: ${newOrders.length}条, hasMore: ${hasMore}`);

      let allOrders;
      if (isFirstPage) {
        allOrders = newOrders;
      } else {
        allOrders = [...this.data.originalOrders, ...newOrders];
      }

      this.setData({
        originalOrders: allOrders,
        searchFilterLastUpdatedAtTs: lastUpdatedAtTs,
        searchFilterLastId: lastId,
        searchFilterHasMore: hasMore,
        searchFilterLoadingMore: false,
        loading: isFirstPage ? false : this.data.loading,
        hasMore: hasMore,
        loadingMore: false
      });

      this.processOrders(allOrders);
    } catch (err) {
      console.error('[订单列表] 搜索筛选查询失败:', err);
      this.setData({
        loading: false,
        searchFilterLoadingMore: false,
        loadingMore: false,
        error: true,
        errorMessage: '查询订单失败'
      });
    }
  },

  // 处理订单数据
  processOrders(ordersList) {
    // 处理订单状态文本
    let processedOrders = ordersList.map(order => {
      // 处理订单状态文本
      const deliveryType = order.deliveryType || 'express'; // 默认快递运输
      let statusText = "";
      switch (order.status) {
        case "pending":
          statusText = "待支付";
          break;
        case "paid":
          if (deliveryType === 'express') {
            statusText = "待发货";
          } else if (deliveryType === 'pickup') {
            statusText = "待自提";
          } else if (deliveryType === 'local') {
            statusText = "待配送";
          } else {
            statusText = "已支付";
          }
          break;
        case "shipping":
          if (deliveryType === 'express') {
            // 待收货卡片主状态优先展示 logisticsState.stateName，避免与“已发货”重复显示
            statusText = order.logisticsState?.stateName || "已发货";
          } else if (deliveryType === 'pickup') {
            statusText = "待自提";
          } else if (deliveryType === 'local') {
            statusText = "配送中";
          } else {
            statusText = "已发货";
          }
          break;
        case "delivered":
          if (deliveryType === 'express') {
            statusText = "已签收，待确认收货";
          } else if (deliveryType === 'pickup') {
            statusText = "待自提";
          } else if (deliveryType === 'local') {
            statusText = "已送达，待确认收货";
          } else {
            statusText = "已送达";
          }
          break;

        case "completed":
          statusText = "已完成";
          break;
        case "refund":
          // 根据售后状态显示更详细的状态
          if (order.afterSalesStatus === 'processing') {
            statusText = "处理中";
          } else if (order.afterSalesStatus === 'pending') {
            statusText = "待处理";
          } else {
            statusText = "售后中";
          }
          break;
        case "refund_completed":
          // 根据售后结果显示更详细的状态
          if (order.afterSalesResult && order.afterSalesResult.includes('部分')) {
            statusText = "部分退款";
          } else if (order.afterSalesResult && order.afterSalesResult.includes('换货')) {
            statusText = "换货完成";
          } else if (order.afterSalesResult && order.afterSalesResult.includes('退款')) {
            statusText = "退款完成";
          } else {
            statusText = "售后完成";
          }
          break;
        case "cancelled":
          statusText = "已取消";
          break;
        default:
          statusText = "未知状态";
      }
      
      // 确保时间字段被正确处理
      const processedOrder = {
        ...order,
        statusText, // 强制覆盖数据库中的statusText
        // 判断是否在24小时内，用于显示取消订单按钮
        canCancel: order.status === 'paid' && order.createdAt ? (new Date() - new Date(order.createdAt) < 24 * 60 * 60 * 1000) : false
      };
      
      // 处理时间字段，确保它们不是空对象
      // 检查createdAt是否为空对象
      if (typeof processedOrder.createdAt === 'object' && processedOrder.createdAt !== null && !processedOrder.createdAt.toISOString) {
        // 是普通对象（非Date对象），尝试获取其中的时间值
        if (processedOrder.createdAt.$date) {
          // 是MongoDB的日期格式
          processedOrder.createdAt = new Date(processedOrder.createdAt.$date).toISOString();
        } else {
          // 其他类型的对象，使用当前时间
          processedOrder.createdAt = new Date().toISOString();
        }
      } else if (processedOrder.createdAt) {
        // 确保createdAt是字符串
        if (typeof processedOrder.createdAt === 'object' && processedOrder.createdAt.toISOString) {
          processedOrder.createdAt = processedOrder.createdAt.toISOString();
        }
      } else {
        // createdAt为空，使用当前时间
        processedOrder.createdAt = new Date().toISOString();
      }
      
      // 检查updatedAt是否为空对象
      if (typeof processedOrder.updatedAt === 'object' && processedOrder.updatedAt !== null && !processedOrder.updatedAt.toISOString) {
        // 是普通对象，尝试获取其中的时间值
        if (processedOrder.updatedAt.$date) {
          // 是MongoDB的日期格式
          processedOrder.updatedAt = new Date(processedOrder.updatedAt.$date).toISOString();
        } else {
          // 其他类型的对象，使用当前时间
          processedOrder.updatedAt = new Date().toISOString();
        }
      } else if (processedOrder.updatedAt) {
        // 确保updatedAt是字符串
        if (typeof processedOrder.updatedAt === 'object' && processedOrder.updatedAt.toISOString) {
          processedOrder.updatedAt = processedOrder.updatedAt.toISOString();
        }
      } else {
        // updatedAt为空，使用当前时间
        processedOrder.updatedAt = new Date().toISOString();
      }
      
      // 检查expireTime是否为空对象
      if (typeof processedOrder.expireTime === 'object' && processedOrder.expireTime !== null && !processedOrder.expireTime.toISOString) {
        // 是普通对象，尝试获取其中的时间值
        if (processedOrder.expireTime.$date) {
          // 是MongoDB的日期格式
          processedOrder.expireTime = new Date(processedOrder.expireTime.$date).toISOString();
        } else {
          // 其他类型的对象，视为无效过期时间
          processedOrder.expireTime = null;
        }
      } else if (processedOrder.expireTime) {
        // 确保expireTime是字符串
        if (typeof processedOrder.expireTime === 'object' && processedOrder.expireTime.toISOString) {
          processedOrder.expireTime = processedOrder.expireTime.toISOString();
        }
      } else {
        // expireTime为空，不参与倒计时
        processedOrder.expireTime = null;
      }
      
      return processedOrder;
    });
    
    // 保存原始订单数据
    this.setData({ originalOrders: processedOrders });
    
    const searchKeyword = this.data.searchKeyword;
    const updatedFilterOptions = { ...this.data.filterOptions };
    
    // 如果是搜索筛选模式，数据已经在云端过滤过，不需要再进行前端过滤
    if (this.data.isSearchFilterMode) {
      processedOrders = processedOrders;
    } else {
      // 将selectedStatus设置到filterOptions中，确保搜索和筛选考虑当前标签状态
      if (this.data.selectedStatus !== "all") {
        updatedFilterOptions.status = this.data.selectedStatus;
      } else {
        updatedFilterOptions.status = null;
      }
      this.setData({ filterOptions: updatedFilterOptions });

      // 应用搜索和筛选，直接使用更新后的filterOptions
      let filteredOrders = [...processedOrders];
      
      // 应用搜索
      if (searchKeyword) {
        filteredOrders = filteredOrders.filter(order => {
          if (order.orderNumber && order.orderNumber.includes(searchKeyword)) {
            return true;
          }
          if (order.productsNames && order.productsNames.includes(searchKeyword)) {
            return true;
          }
          return false;
        });
      }
      
      // 应用筛选
      
      // 订单状态筛选 - 只有在selectedStatus为"all"时才进行状态筛选
      if (updatedFilterOptions.status !== null && this.data.selectedStatus === "all") {
        const statusFilter = updatedFilterOptions.status;
        if (statusFilter === 'shipping') {
          filteredOrders = filteredOrders.filter(order => ['shipping', 'delivered'].includes(order.status));
        } else {
          filteredOrders = filteredOrders.filter(order => order.status === statusFilter);
        }
      }
      
      // 时间范围筛选
      if (updatedFilterOptions.timeRange !== null) {
        const now = new Date();
        let startTime;
        
        switch (updatedFilterOptions.timeRange) {
          case '7days':
            startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case '30days':
            startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
          case '90days':
            startTime = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            break;
          default:
            startTime = null;
        }
        
        if (startTime) {
          filteredOrders = filteredOrders.filter(order => {
            let orderTime;
            try {
              let timeValue = order.createdAt || order.updatedAt;
              
              if (typeof timeValue === 'object' && timeValue !== null) {
                if (timeValue.toISOString) {
                  orderTime = timeValue;
                } else {
                  if (timeValue.$date) {
                    orderTime = new Date(timeValue.$date);
                  } else {
                    orderTime = new Date(startTime.getTime() - 1);
                  }
                }
              } else if (timeValue) {
                orderTime = new Date(timeValue);
              } else {
                orderTime = new Date(startTime.getTime() - 1);
              }
              
              if (isNaN(orderTime.getTime())) {
                orderTime = new Date(startTime.getTime() - 1);
              }
            } catch (error) {
              orderTime = new Date(startTime.getTime() - 1);
            }
            return orderTime > startTime;
          });
        }
      }
      
      // 商品类别筛选
      if (updatedFilterOptions.category && updatedFilterOptions.category.length > 0) {
        filteredOrders = filteredOrders.filter(order => {
          if (order.products) {
            for (let i = 0; i < order.products.length; i++) {
              const product = order.products[i];
              if (product.typeId && updatedFilterOptions.category.includes(product.typeId)) {
                return true;
              }
            }
          }
          if (order.productsList) {
            for (let i = 0; i < order.productsList.length; i++) {
              const product = order.productsList[i];
              if (product.typeId && updatedFilterOptions.category.includes(product.typeId)) {
                return true;
              }
            }
          }
          return false;
        });
      }
      
      processedOrders = filteredOrders;
    }
    
    const hasSearch = searchKeyword && searchKeyword.trim();
    const hasTimeRange = updatedFilterOptions.timeRange !== null;
    const hasCategory = updatedFilterOptions.category && updatedFilterOptions.category.length > 0;
    const isSearchFilterList = hasSearch || hasTimeRange || hasCategory;
    
    const statusLabels = {
      all: '全部',
      pending: '待支付',
      paid: '待发货',
      shipping: '待收货',
      completed: '已完成',
      refund: '售后'
    };
    const statusLabel = statusLabels[this.data.selectedStatus] || this.data.selectedStatus;
    
    if (isSearchFilterList) {
      console.log(`搜索筛选列表 - ${statusLabel}: ${processedOrders.length}条`);
    } else {
      console.log(`普通列表 - ${statusLabel}: ${processedOrders.length}条`);
      const cacheKey = this.getCacheKey(this.data.selectedStatus);
      const cursor = this.data.lastId 
        ? { updatedAtTs: this.data.lastUpdatedAtTs, _id: this.data.lastId } 
        : null;
      const existingCache = orderCacheStore.get(cacheKey);
      orderCacheStore.set(cacheKey, {
        data: this.data.originalOrders,
        cursor,
        hasMore: this.data.hasMore,
        serverMaxUpdateTime: existingCache?.serverMaxUpdateTime || 0
      });
    }
    
    this.setData({
      orders: processedOrders,
      loading: false,
      processingExpired: false
    });
    
    // 启动倒计时
    this.startCountdown();
    
    // 执行回调函数
    if (typeof this._fetchCallback === 'function') {
      this._fetchCallback();
      // 执行完后清空回调函数
      this._fetchCallback = null;
    }
  },
  
  // 启动倒计时
  startCountdown() {
    // 初始化已尝试取消的订单 ID 集合
    if (!this.cancelAttempted) {
      this.cancelAttempted = new Set();
    }
    // 清除之前的定时器
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    
    // 只有在待支付标签页时才启动倒计时
    if (this.data.selectedStatus !== 'pending' && this.data.selectedStatus !== 'all') {
      return;
    }
    
    // 每秒钟更新一次倒计时
    this.countdownTimer = setInterval(() => {
      if (!this.data.pageVisible) {
        return;
      }

      const orders = this.data.orders.map(order => {
        if (order.status === 'pending') {
          try {
            const now = new Date();
            if (!order.expireTime) {
              return {
                ...order,
                remainingTime: undefined,
                isExpired: false
              };
            }
            const expireTime = new Date(order.expireTime);
            if (!isNaN(expireTime.getTime())) {
              const remainingTime = Math.max(0, Math.floor((expireTime - now) / 1000));
              return {
                ...order,
                remainingTime,
                isExpired: remainingTime === 0
              };
            }
          } catch (error) {
            // 静默处理
          }
        }
        // 非待支付订单或计算失败时，确保remainingTime为undefined
        return {
          ...order,
          remainingTime: undefined,
          isExpired: false
        };
      });
      
      // 检查是否有过期订单（排除已经尝试取消过的）
      const expiredOrders = orders.filter(order => order.isExpired && !this.cancelAttempted.has(order._id));
      const hasExpired = expiredOrders.length > 0;
      
      if (hasExpired) {
        // 检查是否正在处理，避免重复调用
        if (this.data.processingExpired) {
          return;
        }
        
        // 检查是否刚刚从详情页返回，避免重复处理
        if (this.data.fromDetail) {
          this.setData({ fromDetail: false });
          return;
        }

        // 记录将要处理的订单 ID，防止云函数返回 0 时死循环
        expiredOrders.forEach(order => this.cancelAttempted.add(order._id));

        // 设置处理状态
        this.setData({ processingExpired: true });
        
        // 清除倒计时，避免重复调用
        this.clearCountdown();
        
        // 调用云函数检查过期订单
        wx.cloud.callFunction({
          name: 'checkExpiredOrders'
        }).then(res => {
          // 刷新订单列表，processingExpired 将在 fetchOrders 数据加载完后、startCountdown 之前重置
          this.fetchOrders();
        }).catch(err => {
          this.setData({ processingExpired: false });
          // 重新启动倒计时
          this.startCountdown();
        });
      } else {
        // 只有在有倒计时变化时才更新订单数据
        const hasCountdownOrders = orders.some(order => order.remainingTime !== undefined);
        if (hasCountdownOrders) {
          this.setData({ orders });
        }
      }
    }, 1000);
  },
  
  // 应用搜索和筛选
  applySearchAndFilter(orders) {
    let filteredOrders = [...orders];
    
    // 应用搜索
    const searchKeyword = this.data.searchKeyword;
    if (searchKeyword) {
      filteredOrders = filteredOrders.filter(order => {
        // 搜索订单编号
        if (order.orderNumber && order.orderNumber.includes(searchKeyword)) {
          return true;
        }
        // 搜索商品名称
        if (order.products) {
          return order.products.some(product => 
            product.name && product.name.includes(searchKeyword)
          );
        }
        if (order.productsList) {
          return order.productsList.some(product => 
            product.name && product.name.includes(searchKeyword)
          );
        }
        return false;
      });
    }
    
    // 应用筛选
    const { filterOptions } = this.data;
    
    // 订单状态筛选
    if (filterOptions.status !== null) {
      filteredOrders = filteredOrders.filter(order => order.status === filterOptions.status);
    }
    
    // 时间范围筛选
    if (filterOptions.timeRange !== null) {
      const now = new Date();
      let startTime;
      
      switch (filterOptions.timeRange) {
        case '7days':
          startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30days':
          startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case '90days':
          startTime = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        default:
          startTime = null;
      }
      
      if (startTime) {
        filteredOrders = filteredOrders.filter(order => {
          let orderTime;
          try {
            // 尝试转换createdAt或updatedAt
            let timeValue = order.createdAt || order.updatedAt;
            
            // 检查timeValue的类型
            if (typeof timeValue === 'object' && timeValue !== null) {
              // 如果是对象，尝试转换为字符串
              if (timeValue.toISOString) {
                // 是Date对象
                orderTime = timeValue;
              } else {
                // 是普通对象，尝试获取其中的时间值
                if (timeValue.$date) {
                  // 是MongoDB的日期格式
                  orderTime = new Date(timeValue.$date);
                } else {
                  // 其他类型的对象，使用7天前的时间
                  orderTime = new Date(startTime.getTime() - 1);
                }
              }
            } else if (timeValue) {
              // 是字符串或其他类型
              orderTime = new Date(timeValue);
            } else {
              // 时间值为空，使用7天前的时间
              orderTime = new Date(startTime.getTime() - 1);
            }
            
            // 如果转换结果是Invalid Date，使用7天前的时间
            if (isNaN(orderTime.getTime())) {
              orderTime = new Date(startTime.getTime() - 1);
            }
          } catch (error) {
            // 如果转换出错，使用7天前的时间
            orderTime = new Date(startTime.getTime() - 1);
          }
          return orderTime > startTime;
        });
      }
    }
    
    // 商品类别筛选
    if (filterOptions.category && filterOptions.category.length > 0) {
      filteredOrders = filteredOrders.filter(order => {
        // 检查products字段
        if (order.products) {
          for (let i = 0; i < order.products.length; i++) {
            const product = order.products[i];
            if (product.typeId && filterOptions.category.includes(product.typeId)) {
              return true;
            }
          }
        }
        // 检查productsList字段
        if (order.productsList) {
          for (let i = 0; i < order.productsList.length; i++) {
            const product = order.productsList[i];
            if (product.typeId && filterOptions.category.includes(product.typeId)) {
              return true;
            }
          }
        }
        return false;
      });
    }
    
    return filteredOrders;
  },

  reload() {
    this.fetchOrders();
  },

  goToHome() {
    wx.switchTab({
      url: "/pages/home/index"
    });
  },

  viewOrderDetail(e) {
    const orderId = e.currentTarget.dataset.orderId;
    
    this.setData({ hasNavigatedAway: true });
    
    wx.navigateTo({
      url: `/pages/order-detail/index?id=${orderId}`
    });
  },

  switchStatus(e) {
    const status = e.currentTarget.dataset.status;
    const deliveryType = e.currentTarget.dataset.deliveryType;
    this.setData({ selectedStatus: status, deliveryType, isSwitchingStatus: true });
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    const cacheKey = this.getCacheKey(status);
    const cached = orderCacheStore.get(cacheKey);
    const { isSearchFilterMode, searchKeyword, filterOptions, loading } = this.data;
    
    if (isSearchFilterMode || searchKeyword.trim() || (filterOptions && filterOptions.timeRange)) {
      if (cached && cached.data && cached.data.length > 0 && cached.hasMore === false) {
        console.log(`[订单列表] 搜索筛选模式切换标签，缓存hasMore=false，前端过滤，状态: ${status}`);
        
        const pageSize = this.data.pageSize;
        const pageData = cached.data.slice(0, pageSize);
        const hasMore = cached.data.length > pageSize;
        
        this.setData({ 
          isSearchFilterMode: true,
          originalOrders: pageData,
          searchFilterCacheIndex: pageSize,
          hasMore
        });
        this.filterOrdersLocally();
      } else {
        console.log(`[订单列表] 搜索筛选模式切换标签，缓存无效/hasMore=true/正在加载，查询数据库，状态: ${status}`);
        this.fetchSearchFilterOrders();
      }
    } else {
      if (cached && cached.data && cached.data.length > 0 && !loading) {
        console.log(`[订单列表] 切换标签使用缓存，状态: ${status}, 订单数: ${cached.data.length}`);
        const cursor = cached.cursor || {};
        this.setData({
          loading: false,
          orders: [],
          originalOrders: cached.data,
          lastUpdatedAtTs: cursor.updatedAtTs || null,
          lastId: cursor._id || null,
          hasMore: cached.hasMore,
          loadingMore: false,
          isSearchFilterMode: false
        });
        this.processOrders(cached.data);

        this._validateOrderCacheAsync();
      } else {
        this.fetchOrders();
      }
    }
  },

  goToPayment(e) {
    const orderId = e.currentTarget.dataset.orderId;
    // 跳转到支付页面
    wx.navigateTo({
      url: `/pages/payment/index?orderId=${orderId}`
    });
  },

  async callUpdateOrderStatus(orderId, operation, params = {}) {
    const res = await wx.cloud.callFunction({
      name: 'updateOrderStatus',
      data: {
        orderId,
        operation,
        params
      }
    });

    if (!res.result || !res.result.success) {
      throw new Error(res.result?.error || '状态更新失败');
    }

    return res.result;
  },

  confirmReceipt(e) {
    const orderId = e.currentTarget.dataset.orderId;
    wx.showModal({
      title: '确认收货',
      content: '确认已收到商品吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await this.callUpdateOrderStatus(orderId, 'confirm');
            wx.showToast({
              title: '确认收货成功',
              icon: 'success'
            });
            // 重新加载订单列表
            this.fetchOrders();
          } catch (err) {
            wx.showToast({
              title: '确认收货失败',
              icon: 'none'
            });
          }
        }
      }
    });
  },

  cancelOrder(e) {
    const orderId = e.currentTarget.dataset.orderId;
    wx.showModal({
      title: '取消订单',
      content: '确定要取消这个订单吗？',
      success: (res) => {
        if (res.confirm) {
          this.callUpdateOrderStatus(orderId, 'cancel', {
            cancelReason: '用户主动取消'
          }).then(() => {
            wx.showToast({
              title: '订单取消成功',
              icon: 'success'
            });
            this.fetchOrders();
          }).catch((err) => {
            wx.showToast({
              title: '取消订单失败',
              icon: 'none'
            });
          });
        }
      }
    });
  },

  // 再次购买
  buyAgain(e) {
    const orderId = e.currentTarget.dataset.orderId;
    // 获取订单详情
    getCollection("orders").doc(orderId).get()
      .then(res => {
        const order = res.data;
        if (order && order.products && order.products.length > 0) {
          // 将商品信息编码后传递给订单确认页面
          const productsData = encodeURIComponent(JSON.stringify(order.products));
          wx.navigateTo({
            url: `/pages/order-confirm/index?products=${productsData}`
          });
        } else {
          wx.showToast({
            title: '订单商品信息异常',
            icon: 'none'
          });
        }
      })
      .catch(err => {
        wx.showToast({
          title: '获取订单信息失败',
          icon: 'none'
        });
      });
  },

  // 删除订单（软删除）
  deleteOrder(e) {
    const orderId = e.currentTarget.dataset.orderId;
    wx.showModal({
      title: '删除订单',
      content: '确定要删除这个订单吗？',
      success: (res) => {
        if (res.confirm) {
          const orders = getCollection("orders");
          orders.doc(orderId).update({
            data: {
              isDeleted: true,
              updatedAt: new Date(),
              updatedAtTs: Date.now()
            }
          })
            .then(() => {
              wx.showToast({
                title: '删除成功',
                icon: 'success'
              });
              // 删除订单后，更新游标状态
              this._adjustCursorAfterDelete(orderId);
            })
            .catch((err) => {
              wx.showToast({
                title: '删除失败',
                icon: 'none'
              });
            });
        }
      }
    });
  },

  // 删除订单后调整游标
  _adjustCursorAfterDelete(deletedOrderId) {
    const { originalOrders, lastId, lastUpdatedAtTs } = this.data;
    
    // 如果被删除的订单是当前游标指向的订单（最后一条），则前移游标
    if (lastId === deletedOrderId) {
      // 找到被删除订单的前一条订单
      const deletedIndex = originalOrders.findIndex(order => order._id === deletedOrderId);
      if (deletedIndex >= 0 && deletedIndex > 0) {
        // 存在前一条订单，更新游标
        const prevOrder = originalOrders[deletedIndex - 1];
        this.setData({
          lastId: prevOrder._id,
          lastUpdatedAtTs: prevOrder.updatedAtTs
        });
      } else if (deletedIndex === 0 && originalOrders.length > 1) {
        // 删除的是第一条，但还有其他订单，游标更新为最后一条
        const lastOrder = originalOrders[originalOrders.length - 1];
        if (lastOrder._id !== deletedOrderId) {
          this.setData({
            lastId: lastOrder._id,
            lastUpdatedAtTs: lastOrder.updatedAtTs
          });
        }
      } else {
        // 删除的是唯一的订单，重置游标
        this.setData({
          lastId: null,
          lastUpdatedAtTs: null,
          hasMore: false
        });
      }
    }
    
    // 从本地数据中移除被删除的订单
    const updatedOrders = originalOrders.filter(order => order._id !== deletedOrderId);
    this.setData({
      originalOrders: updatedOrders
    });
    this.processOrders(updatedOrders);
  },

  // 申请售后
  afterSales(e) {
    const orderId = e.currentTarget.dataset.orderId;
    wx.navigateTo({
      url: `/pages/after-sales/apply/index?orderId=${orderId}`
    });
  },

  // 查看物流
  async viewLogistics(e) {
    const orderId = e.currentTarget.dataset.orderId;
    const order = this.data.orders.find(item => item._id === orderId)
      || this.data.originalOrders.find(item => item._id === orderId);

    if (!order || !order.logisticsInfo || !order.logisticsInfo.trackingNumber) {
      wx.showToast({
        title: '暂无物流信息',
        icon: 'none'
      });
      return;
    }

    wx.showLoading({ title: '加载物流信息...' });

    try {
      if (!this.data.logisticsStateMap) {
        await this.getStateMap();
      }

      const trackingNumber = order.logisticsInfo.trackingNumber;
      let companyCode = order.logisticsInfo.companyCode || '';
      let companyName = order.logisticsInfo.companyName || '';
      let logisticsData = null;
      let isMapTrackEnabled = false;

      const fromAddress = (order.fromAddress || order.pickupAddress || '').trim();
      const addressObj = order.address && typeof order.address === 'object' ? order.address : null;
      const toAddressParts = [
        addressObj?.provinceName,
        addressObj?.cityName,
        addressObj?.countyName,
        addressObj?.detailInfo
      ].filter(Boolean);
      const toAddress = (
        toAddressParts.join('') ||
        (typeof order.address === 'string' ? order.address : '') ||
        order.receiverAddress ||
        order.consigneeAddress ||
        order.shippingAddress ||
        ''
      ).trim();

      const logisticsResult = await wx.cloud.callFunction({
        name: 'express100',
        data: {
          action: 'queryLogisticsAndUpdateOrder',
          expressNo: trackingNumber,
          companyCode,
          fromAddress,
          toAddress
        }
      });

      if (logisticsResult.result && logisticsResult.result.success) {
        logisticsData = logisticsResult.result.data;
        companyCode = logisticsResult.result.companyCode || companyCode;
        isMapTrackEnabled = Array.isArray(logisticsData?.data)
          && logisticsData.data.some(item => item.latitude && item.longitude);

        if (logisticsResult.result.orderUpdated) {
          wx.showToast({
            title: '物流已签收，订单已更新',
            icon: 'success',
            duration: 2000
          });
          setTimeout(() => {
            this.onShow();
          }, 1500);
        }
      }

      if (!logisticsData) {
        wx.showToast({
          title: '获取物流信息失败',
          icon: 'none'
        });
        return;
      }

      const state = logisticsData.state || '';
      const latestTrack = Array.isArray(logisticsData.data) && logisticsData.data.length > 0 ? logisticsData.data[0] : null;
      const fallbackState = (
        logisticsData.stateEx ||
        logisticsData.advancedState ||
        (latestTrack && (latestTrack.statusCode || latestTrack.stateEx)) ||
        ''
      );
      const stateMap = this.data.logisticsStateMap;

      let stateName = '未知状态';
      let stateMeaning = '';
      let displayStateText = '未知状态';

      if (stateMap) {
        const matchedState = stateMap.advanced[state] || stateMap.basic[state] || stateMap.advanced[fallbackState] || stateMap.basic[fallbackState] || null;
        if (matchedState) {
          stateName = matchedState.name || stateName;
          stateMeaning = matchedState.meaning || stateMeaning;
          displayStateText = matchedState.meaning
            ? `【${matchedState.name}】${matchedState.meaning}`
            : matchedState.name;
        }
      }

      if (displayStateText === '未知状态') {
        displayStateText = (latestTrack && latestTrack.status) || (stateMeaning ? `【${stateName}】${stateMeaning}` : stateName);
      }

      logisticsData.stateName = stateName;
      logisticsData.stateMeaning = stateMeaning;
      logisticsData.displayStateText = displayStateText;

      const trackPoints = [];
      let centerLatitude = 39.908823;
      let centerLongitude = 116.397470;
      let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;

      if (isMapTrackEnabled && logisticsData.data && logisticsData.data.length > 0) {
        logisticsData.data.forEach((item, index) => {
          if (item.latitude && item.longitude) {
            trackPoints.push({
              id: index,
              latitude: item.latitude,
              longitude: item.longitude,
              width: 8,
              height: 8,
              iconPath: '/miniprogram/images/icons/快递轨迹点.png'
            });

            minLat = Math.min(minLat, item.latitude);
            maxLat = Math.max(maxLat, item.latitude);
            minLng = Math.min(minLng, item.longitude);
            maxLng = Math.max(maxLng, item.longitude);
          }
        });

        if (trackPoints.length > 0) {
          centerLatitude = (minLat + maxLat) / 2;
          centerLongitude = (minLng + maxLng) / 2;
        }
      }

      this.setData({
        showLogistics: true,
        logisticsData,
        logisticsMapData: {
          trackingNumber,
          companyName: companyName || logisticsData.com || companyCode,
          status: logisticsData.status
        },
        logisticsMapCenter: {
          latitude: centerLatitude,
          longitude: centerLongitude
        },
        logisticsMapScale: 10,
        logisticsTrackPoints: trackPoints
      });
    } catch (error) {
      wx.showToast({
        title: '查看物流信息失败',
        icon: 'none'
      });
    } finally {
      wx.hideLoading();
    }
  },

  resetMap() {
    const mapContext = wx.createMapContext('logisticsMap');
    mapContext.moveToLocation({
      longitude: this.data.logisticsMapCenter.longitude,
      latitude: this.data.logisticsMapCenter.latitude,
      scale: this.data.logisticsMapScale
    });
  },

  fullScreenMap() {
    const { windowHeight } = wx.getSystemInfoSync();
    this.setData({
      isMapFullScreen: true,
      mapHeight: windowHeight - 200
    });
  },

  closeLogistics() {
    this.setData({
      showLogistics: false
    });
  },

  // 前端过滤已加载的订单
  filterOrdersLocally() {
    const { originalOrders, searchKeyword, filterOptions } = this.data;
    let filteredOrders = [...originalOrders];

    const keyword = searchKeyword.trim().toLowerCase();
    if (keyword) {
      filteredOrders = filteredOrders.filter(order => {
        if (order.orderNumber && order.orderNumber.toLowerCase().includes(keyword)) {
          return true;
        }
        if (order.productsNames && order.productsNames.toLowerCase().includes(keyword)) {
          return true;
        }
        return false;
      });
    }

    if (filterOptions.timeRange) {
      const now = Date.now();
      let startTime;
      switch (filterOptions.timeRange) {
        case '7days':
          startTime = now - 7 * 24 * 60 * 60 * 1000;
          break;
        case '30days':
          startTime = now - 30 * 24 * 60 * 60 * 1000;
          break;
        case '90days':
          startTime = now - 90 * 24 * 60 * 60 * 1000;
          break;
      }
      if (startTime) {
        filteredOrders = filteredOrders.filter(order => 
          (order.updatedAtTs || 0) > startTime
        );
      }
    }

    if (filterOptions.category && filterOptions.category.length > 0) {
      filteredOrders = filteredOrders.filter(order => {
        if (order.products) {
          return order.products.some(product => 
            product.typeId && filterOptions.category.includes(product.typeId)
          );
        }
        return false;
      });
    }

    this.setData({
      isSearchFilterMode: true,
      orders: filteredOrders,
      originalOrders: filteredOrders,
      hasMore: false,
      searchFilterHasMore: false,
      loading: false
    });

    this.processOrders(filteredOrders);
  },

  // 处理搜索
  handleSearch(e) {
    const { keyword, filterOptions } = e.detail;
    this.setData({
      searchKeyword: keyword,
      filterOptions: filterOptions || {}
    });

    const { hasMore, originalOrders } = this.data;
    if (hasMore === false && originalOrders.length > 0) {
      this.filterOrdersLocally();
    } else {
      this.fetchSearchFilterOrders();
    }
  },
  
  // 处理清除搜索
  handleClearSearch() {
    this.setData({ searchKeyword: '', isSearchFilterMode: false });
    this.fetchOrders();
  },
  
  // 处理筛选
  handleFilter(e) {
    const { filterOptions } = e.detail;
    this.setData({ filterOptions });

    const { hasMore, originalOrders } = this.data;
    if (hasMore === false && originalOrders.length > 0) {
      this.filterOrdersLocally();
    } else {
      this.fetchSearchFilterOrders();
    }
  },

  // 清除倒计时
  clearCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  },

  startOrderWatch() {
    if (this._unsubOrderWatcher) {
      return;
    }
    const watcher = getGlobalOrderWatcher();
    const cacheKey = this.getCacheKey(this.data.selectedStatus);
    this._unsubOrderWatcher = watcher.subscribe(
      this.__pageId, cacheKey,
      (change) => this._onOrderChanged(change)
    );
  },

  stopOrderWatch() {
    if (this._unsubOrderWatcher) {
      this._unsubOrderWatcher();
      this._unsubOrderWatcher = null;
    }
  },

  _onOrderChanged(change) {
    try {
      if (this._isUnloaded) {
        console.log('[订单列表] 页面已卸载，跳过更新');
        return;
      }
      if (!this.data.pageVisible) {
        console.log('[订单列表] 页面不可见，跳过更新');
        return;
      }

      const { type, order, docId } = change;
      console.log('[订单列表] 监听器收到订单变化:', type, docId, order.orderNumber);
      console.log('[订单列表] 订单状态:', order.status, '当前选中标签:', this.data.selectedStatus);

      const app = getApp();
      const openid = app.globalData.openid;
      if (!openid || order._openid !== openid) {
        console.log('[订单列表] 订单不属于当前用户，跳过更新');
        return;
      }

      const hasSearch = this.data.searchKeyword && this.data.searchKeyword.trim() !== '';
      const hasTimeRange = this.data.filterOptions.timeRange !== null;
      const hasFilters = hasSearch || hasTimeRange;

      if (type === 'modify' || type === 'update') {
        this._handleOrderUpdate(order);
      } else if (type === 'remove') {
        this._handleOrderRemove(docId);
      } else if (type === 'add') {
        if (!hasFilters) {
          this._handleOrderAdd(order);
        }
      }
    } catch (error) {
      console.error('[订单列表] 处理订单变化失败:', error);
    }
  },

  _handleOrderUpdate(order) {
    const currentOrders = this.data.originalOrders || [];
    const index = currentOrders.findIndex(o => o._id === order._id);

    console.log('[订单列表] _handleOrderUpdate - index:', index, 'originalOrders长度:', currentOrders.length);
    console.log('[订单列表] 订单状态变化 - 新状态:', order.status, '当前标签:', this.data.selectedStatus);

    if (index >= 0) {
      const hasSearch = this.data.searchKeyword && this.data.searchKeyword.trim() !== '';
      const hasTimeRange = this.data.filterOptions.timeRange !== null;

      if (hasSearch || hasTimeRange) {
        const updatedOrders = [...currentOrders];
        updatedOrders[index] = { ...updatedOrders[index], ...order };
        this.setData({ originalOrders: updatedOrders });
        this.filterOrdersLocally();
      } else {
        const updatedOrders = [...currentOrders];
        updatedOrders[index] = { ...updatedOrders[index], ...order };

        const stillMatches = this._orderMatchesCurrentFilter(order);
        console.log('[订单列表] stillMatches:', stillMatches);

        if (stillMatches) {
          this.setData({ originalOrders: updatedOrders });
          this.processOrders(updatedOrders);
        } else {
          const filteredOrders = updatedOrders.filter(o => o._id !== order._id);
          console.log('[订单列表] 订单不再匹配，从列表移除，新长度:', filteredOrders.length);
          this.setData({ originalOrders: filteredOrders });
          this.processOrders(filteredOrders);
        }
      }
    } else {
      console.log('[订单列表] 订单不在originalOrders中，从缓存获取最新数据');
      const cacheKey = this.getCacheKey(this.data.selectedStatus);
      const cached = orderCacheStore.get(cacheKey);
      if (cached && cached.data) {
        console.log('[订单列表] 从缓存获取数据，长度:', cached.data.length);
        this.setData({ originalOrders: cached.data });
        this.processOrders(cached.data);
      }
    }
  },

  _getStatusTagForOrder(order) {
    const status = order.status;

    if (status === 'pending') return 'pending';
    if (status === 'paid') return 'paid';
    if (['shipping', 'delivered'].includes(status)) return 'shipping';
    if (['refund', 'refund_completed'].includes(status)) return 'refund';
    if (['completed', 'refund_completed'].includes(status)) return 'completed';
    if (status === 'cancelled') return 'cancelled';
    
    return 'all';
  },

  clearCache(status) {
    try {
      const cacheKey = this.getCacheKey(status);
      orderCacheStore.clearKey(cacheKey);
      console.log('[订单列表] 清除缓存:', cacheKey);
    } catch (e) {
      console.error('[订单列表] 清除缓存失败:', e);
    }
  },

  _orderMatchesCurrentFilter(order) {
    const selectedStatus = this.data.selectedStatus;
    const deliveryType = order.deliveryType || 'express';

    if (selectedStatus === 'all') {
      return true;
    }

    if (selectedStatus === 'pending') {
      return order.status === 'pending';
    }

    if (selectedStatus === 'paid') {
      return order.status === 'paid';
    }

    if (selectedStatus === 'shipping') {
      return ['shipping', 'delivered'].includes(order.status);
    }

    if (selectedStatus === 'refund') {
      return ['refund', 'refund_completed'].includes(order.status);
    }

    if (selectedStatus === 'completed') {
      return ['completed', 'refund_completed'].includes(order.status);
    }

    if (selectedStatus === 'cancelled') {
      return order.status === 'cancelled';
    }

    return true;
  },

  _handleOrderRemove(orderId) {
    const currentOrders = this.data.originalOrders || [];
    const updatedOrders = currentOrders.filter(o => o._id !== orderId);

    const hasSearch = this.data.searchKeyword && this.data.searchKeyword.trim() !== '';
    const hasTimeRange = this.data.filterOptions.timeRange !== null;

    if (hasSearch || hasTimeRange) {
      this.setData({ originalOrders: updatedOrders });
      this.filterOrdersLocally();
    } else {
      this.setData({ originalOrders: updatedOrders });
      this.processOrders(updatedOrders);
    }
  },

  _handleOrderAdd(order) {
    const currentOrders = this.data.originalOrders || [];
    const updatedOrders = [order, ...currentOrders];

    this.setData({ originalOrders: updatedOrders });
    this.processOrders(updatedOrders);
  },

  // 页面隐藏时清除倒计时
  onHide() {
    this.setData({ pageVisible: false });
    this.clearCountdown();

    const watcher = getGlobalOrderWatcher();
    watcher.setPageVisible(this.__pageId, false);

    if (this.data.originalOrders && this.data.originalOrders.length > 0 && !this.data.isSearchFilterMode) {
      const cacheKey = this.getCacheKey(this.data.selectedStatus);
      const cursor = this.data.lastId 
        ? { updatedAtTs: this.data.lastUpdatedAtTs, _id: this.data.lastId } 
        : null;
      const existingCache = orderCacheStore.get(cacheKey);
      orderCacheStore.set(cacheKey, {
        data: this.data.originalOrders,
        cursor,
        hasMore: this.data.hasMore,
        serverMaxUpdateTime: existingCache?.serverMaxUpdateTime || 0
      });
    }
  },

  onUnload() {
    this._isUnloaded = true;
    this.clearCountdown();
    this.stopOrderWatch();

    if (this.data.originalOrders && this.data.originalOrders.length > 0 && !this.data.isSearchFilterMode) {
      const cacheKey = this.getCacheKey(this.data.selectedStatus);
      const cursor = this.data.lastId 
        ? { updatedAtTs: this.data.lastUpdatedAtTs, _id: this.data.lastId } 
        : null;
      const existingCache = orderCacheStore.get(cacheKey);
      orderCacheStore.set(cacheKey, {
        data: this.data.originalOrders,
        cursor,
        hasMore: this.data.hasMore,
        serverMaxUpdateTime: existingCache?.serverMaxUpdateTime || 0
      });
    }
  },

  // 联系客服
  async contactService(e) {
    const orderId = e.currentTarget.dataset.orderId;
    if (!orderId) {
      wx.showToast({
        title: '订单ID不存在',
        icon: 'none'
      });
      return;
    }

    // 从订单列表中找到该订单
    const order = this.data.orders.find(item => item._id === orderId);
    if (!order) {
      wx.showToast({
        title: '订单不存在',
        icon: 'none'
      });
      return;
    }

    wx.showLoading({ title: '加载中...' });

    try {
      // 获取用户openid
      const loginRes = await wx.cloud.callFunction({ name: 'login' });
      if (!loginRes.result || !loginRes.result.openid) {
        wx.hideLoading();
        wx.showToast({ title: '获取用户信息失败', icon: 'none' });
        return;
      }
      const OPENID = loginRes.result.openid;

      // 检查是否已有客服会话
      const db = wx.cloud.database();
      const sessionRes = await db.collection('sessions')
        .where({ userId: OPENID, status: 'active' })
        .get();

      let sessionId;
      if (sessionRes.data.length > 0) {
        sessionId = sessionRes.data[0]._id;
      } else {
        // 创建新会话
        const createRes = await wx.cloud.callFunction({
          name: 'createSession',
          data: { userId: OPENID }
        });
        if (!createRes.result.success) {
          wx.hideLoading();
          wx.showToast({ title: '创建会话失败', icon: 'none' });
          return;
        }
        sessionId = createRes.result.sessionId;
      }

      // 构建订单卡片信息
      const orderCard = {
        orderId: order._id,
        orderNumber: order.orderNumber,
        coverImage: order.products && order.products[0] ? order.products[0].coverImage : '/images/icons/订单.png',
        productName: order.products && order.products[0] ? order.products[0].name : '商品',
        quantity: order.products ? order.products.reduce((sum, p) => sum + (p.quantity || 1), 0) : 1,
        totalAmount: order.totalPrice || 0,
        status: order.status,
        statusText: order.statusText
      };

      wx.hideLoading();

      // 跳转到客服聊天页面，传递订单卡片信息
      const entryOrderCard = encodeURIComponent(JSON.stringify(orderCard));
      wx.navigateTo({
        url: `/pages/message/service/index?sessionId=${sessionId}&entryOrderCard=${entryOrderCard}`
      });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: '操作失败，请重试', icon: 'none' });
    }
  }
});