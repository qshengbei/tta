import { getCollection } from "../../utils/cloud";
const db = wx.cloud.database();
const _ = db.command;

Page({
  data: {
    orders: [],
    originalOrders: [], // 存储原始订单数据
    loading: true,
    error: false,
    errorMessage: "",
    selectedStatus: "all", // 默认显示所有订单
    deliveryType: null, // 配送方式，null表示所有配送方式
    scrollTop: 0, // 滚动位置
    isFirstLoad: true, // 是否首次加载
    processingExpired: false, // 是否正在处理过期订单
    fromDetail: false, // 是否从详情页返回
    isSwitchingStatus: false, // 是否正在切换标签
    
    // 搜索和筛选相关
    searchKeyword: '',
    filterOptions: {
      status: null,
      deliveryType: null,
      timeRange: null
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

  },

  onLoad(options) {
    // 获取URL参数中的status和deliveryType
    if (options && options.status) {
      this.setData({ selectedStatus: options.status });
    }
    if (options && options.deliveryType) {
      this.setData({ deliveryType: options.deliveryType });
    }
    // 首次加载时获取数据
    if (this.data.isFirstLoad) {
      this.fetchOrders();
      this.setData({ isFirstLoad: false });
    }

    this.initLogisticsStateData();
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
      console.error('初始化物流状态数据失败:', error);
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
      console.error('获取物流状态映射失败:', error);
    }
  },
  
  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    console.log('=== onShow 被调用 ===');
    console.log('fromDetail:', this.data.fromDetail);
    console.log('selectedStatus:', this.data.selectedStatus);
    console.log('deliveryType:', this.data.deliveryType);
    console.log('savedScrollTop:', this.data.savedScrollTop);
    
    // 检查全局变量，恢复可能丢失的状态
    const globalData = getApp().globalData;
    if (globalData.fromOrderDetail) {
      // 从全局变量恢复状态
      console.log('从全局变量恢复状态:', globalData.savedOrderListStatus);
      this.setData({
        selectedStatus: globalData.savedOrderListStatus,
        deliveryType: globalData.savedOrderListDeliveryType,
        savedScrollTop: globalData.savedOrderListScrollTop,
        fromDetail: true
      });
      // 重置全局标志
      globalData.fromOrderDetail = false;
    }
    
    // 当页面显示时，检查是否从详情页返回
    if (this.data.fromDetail) {
      this.setData({ fromDetail: false });
      const savedScrollPosition = this.data.savedScrollTop;
      const savedStatus = this.data.selectedStatus;
      
      // 检查是否需要刷新订单列表（如取消售后后）
      if (getApp().globalData.needRefreshOrderList) {
        console.log('从详情页返回，需要刷新订单列表');
        getApp().globalData.needRefreshOrderList = false;
        
        // 刷新订单列表
        this.fetchOrdersWithCallback(() => {
          // 刷新完成后恢复滚动位置
          if (savedScrollPosition && this.data.selectedStatus === savedStatus) {
            wx.pageScrollTo({
              scrollTop: savedScrollPosition,
              duration: 0
            });
          }
        });
      } else {
        console.log('从详情页返回，保持滚动位置，不刷新');
        // 恢复滚动位置
        if (savedScrollPosition) {
          wx.pageScrollTo({
            scrollTop: savedScrollPosition,
            duration: 0
          });
        }
      }
      return;
    }
    // 检查是否正在切换标签，如果是则不重复调用fetchOrders()
    if (this.data.isSwitchingStatus) {
      console.log('正在切换标签，跳过onShow的fetchOrders()');
      this.setData({ isSwitchingStatus: false });
      return;
    }
    // 检查是否需要刷新订单列表（例如订单过期后返回列表）
    if (getApp().globalData.needRefreshOrderList) {
      console.log('需要刷新订单列表');
      getApp().globalData.needRefreshOrderList = false;
      this.fetchOrders();
    }
    // 只有首次加载时才自动获取订单数据
    // 标签切换时已经在switchStatus方法中调用了fetchOrders()
    if (this.data.isFirstLoad) {
      this.fetchOrders();
      this.setData({ isFirstLoad: false });
    }

    // 检查并后台刷新过期物流状态
    this.checkAndRefreshExpiredLogistics();
  },

  /**
   * 检查并后台刷新超过30分钟的物流状态
   */
  async checkAndRefreshExpiredLogistics() {
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
            console.log(`订单 ${order.orderNumber} 物流状态超期，准备后台刷新`);
            // 异步后台刷新，不阻塞UI
            this.refreshLogisticsInBackground(order);
          }
        }
      }
    } catch (error) {
      console.error('检查物流状态失败:', error);
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

        console.log(`订单 ${order.orderNumber} 物流状态已后台刷新`);
      }
    } catch (error) {
      console.error(`后台刷新订单 ${order.orderNumber} 物流状态失败:`, error);
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
    // 只重置搜索关键词，保留筛选条件
    this.setData({ 
      loading: true, 
      error: false, 
      errorMessage: ""
    });
    // 获取当前用户的openid
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
    
    const orders = getCollection("orders");
    
    // 构建基础查询条件
    let baseQuery = { _openid: openid, isDeleted: db.command.neq(true) };
    
    // 调试日志
    console.log('fetchOrders - 当前状态:', this.data.selectedStatus, '配送方式:', this.data.deliveryType);
    
    // 添加配送方式筛选
    if (this.data.deliveryType) {
      baseQuery.deliveryType = this.data.deliveryType;
    }
    
    // 添加搜索关键词筛选
    const searchKeyword = this.data.searchKeyword;
    if (searchKeyword) {
      // 由于云数据库不支持复杂的模糊查询，我们先获取所有符合条件的订单，然后在前端进行搜索
    }
    
    // 根据selectedStatus执行不同的查询
    if (this.data.selectedStatus === "all") {
      // 查询所有订单（排除已删除的订单）
      orders.where(baseQuery).orderBy('updatedAt', 'desc').get()
        .then((res) => {
          console.log('云数据库查询返回的订单数据:', res.data);
          this.processOrders(res.data);
        })
        .catch((err) => {
          console.error("获取订单列表失败", err);
          this.setData({ loading: false, error: true, errorMessage: "获取订单列表失败" });
        });
    } else if (this.data.selectedStatus === "paid") {
      // 待发货/待自提/待配送：查询 status 为 paid 的订单
      let paidQuery = { _openid: openid, isDeleted: db.command.neq(true), status: 'paid' };
      // 如果有配送方式筛选，添加到查询条件中
      if (this.data.deliveryType) {
        paidQuery.deliveryType = this.data.deliveryType;
      }
      orders.where(paidQuery).orderBy('updatedAt', 'desc').get()
        .then((res) => {
          console.log('云数据库查询返回的订单数据 (paid):', res.data);
          this.processOrders(res.data);
        })
        .catch((err) => {
          console.error("获取订单列表失败", err);
          this.setData({ loading: false, error: true, errorMessage: "获取订单列表失败" });
        });
    } else if (this.data.selectedStatus === "shipping") {
      // 待收货：查询 status 为 shipping 或 delivered 的订单
      let shippingQuery = { 
        _openid: openid, 
        isDeleted: db.command.neq(true), 
        status: db.command.in(['shipping', 'delivered']) 
      };
      // 如果有配送方式筛选，添加到查询条件中
      if (this.data.deliveryType) {
        shippingQuery.deliveryType = this.data.deliveryType;
      }
      orders.where(shippingQuery).orderBy('updatedAt', 'desc').get()
        .then((res) => {
          console.log('云数据库查询返回的订单数据 (shipping):', res.data);
          this.processOrders(res.data);
        })
        .catch((err) => {
          console.error("获取订单列表失败", err);
          this.setData({ loading: false, error: true, errorMessage: "获取订单列表失败" });
        });

    } else if (this.data.selectedStatus === "refund") {
      // 售后：查询 status 为 refund 和 refund_completed 的订单
      Promise.all([
        orders.where({ ...baseQuery, status: 'refund' }).orderBy('updatedAt', 'desc').get(),
        orders.where({ ...baseQuery, status: 'refund_completed' }).orderBy('updatedAt', 'desc').get()
      ]).then(([refundRes, refundCompletedRes]) => {
        let allOrders = [...refundRes.data, ...refundCompletedRes.data];
        console.log('云数据库查询返回的订单数据 (refund):', allOrders);
        // 按更新时间排序
        allOrders.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        this.processOrders(allOrders);
      }).catch((err) => {
        console.error("获取订单列表失败", err);
        this.setData({ loading: false, error: true, errorMessage: "获取订单列表失败" });
      });
    } else if (this.data.selectedStatus === "completed") {
      // 已完成：同时查询 completed 和 refund_completed 的订单（与淘宝逻辑一致）
      Promise.all([
        orders.where({ ...baseQuery, status: 'completed' }).orderBy('updatedAt', 'desc').get(),
        orders.where({ ...baseQuery, status: 'refund_completed' }).orderBy('updatedAt', 'desc').get()
      ]).then(([completedRes, refundCompletedRes]) => {
        let allOrders = [...completedRes.data, ...refundCompletedRes.data];
        console.log('云数据库查询返回的订单数据 (completed):', allOrders);
        // 按更新时间排序
        allOrders.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        this.processOrders(allOrders);
      }).catch((err) => {
        console.error("获取订单列表失败", err);
        this.setData({ loading: false, error: true, errorMessage: "获取订单列表失败" });
      });
    } else {
      // 其他状态：只查询对应状态的订单（排除已删除的订单）
      let query = { ...baseQuery, status: this.data.selectedStatus };
      orders.where(query).orderBy('updatedAt', 'desc').get()
        .then((res) => {
          console.log('云数据库查询返回的订单数据 (other):', res.data);
          this.processOrders(res.data);
        })
        .catch((err) => {
          console.error("获取订单列表失败", err);
          this.setData({ loading: false, error: true, errorMessage: "获取订单列表失败" });
        });
    }
  },

  // 处理订单数据
  processOrders(ordersList) {
    console.log('=== 开始处理订单数据 ===');
    console.log('原始订单数据:', ordersList);
    // 处理订单状态文本
    let processedOrders = ordersList.map(order => {
      console.log('订单处理前:', order);
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
      
      console.log('计算的statusText:', statusText);
      console.log('订单status:', order.status);
      console.log('订单deliveryType:', deliveryType);
      
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
        // 是普通对象，尝试获取其中的时间值
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
      
      console.log('订单处理后:', processedOrder);
      return processedOrder;
    });
    
    console.log('处理后的订单数据:', processedOrders);
    // 保存原始订单数据
    this.setData({ originalOrders: processedOrders });
    
    // 将selectedStatus设置到filterOptions中，确保搜索和筛选考虑当前标签状态
    const updatedFilterOptions = { ...this.data.filterOptions };
    if (this.data.selectedStatus !== "all") {
      // 直接使用selectedStatus作为filterOptions.status
      updatedFilterOptions.status = this.data.selectedStatus;
    } else {
      updatedFilterOptions.status = null;
    }
    this.setData({ filterOptions: updatedFilterOptions });
    
    // 应用搜索和筛选，直接使用更新后的filterOptions
    let filteredOrders = [...processedOrders];
    
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
    
    // 订单状态筛选 - 只有在selectedStatus为"all"时才进行状态筛选
    // 因为其他状态已经在fetchOrders方法中进行了查询
    if (updatedFilterOptions.status !== null && this.data.selectedStatus === "all") {
      const statusFilter = updatedFilterOptions.status;
      // 如果筛选的是待收货，需要同时匹配 shipping 和 delivered 状态
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
    if (updatedFilterOptions.category && updatedFilterOptions.category.length > 0) {
      filteredOrders = filteredOrders.filter(order => {
        // 检查products字段
        if (order.products) {
          for (let i = 0; i < order.products.length; i++) {
            const product = order.products[i];
            if (product.typeId && updatedFilterOptions.category.includes(product.typeId)) {
              return true;
            }
          }
        }
        // 检查productsList字段
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
    
    this.setData({
      orders: processedOrders,
      loading: false,
      processingExpired: false  // 数据加载完成后重置，确保在 startCountdown 之前已清除
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
            console.error('计算倒计时失败', error);
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
          console.log('正在处理过期订单，跳过重复调用');
          return;
        }
        
        // 检查是否刚刚从详情页返回，避免重复处理
        if (this.data.fromDetail) {
          console.log('从详情页返回，跳过过期订单处理');
          this.setData({ fromDetail: false });
          return;
        }
        
        console.log('=== 发现过期订单，开始处理 ===');
        console.log('过期订单数量:', expiredOrders.length);
        console.log('过期订单ID:', expiredOrders.map(order => order._id));

        // 记录将要处理的订单 ID，防止云函数返回 0 时死循环
        expiredOrders.forEach(order => this.cancelAttempted.add(order._id));

        // 设置处理状态
        this.setData({ processingExpired: true });
        console.log('设置处理状态为true');
        
        // 清除倒计时，避免重复调用
        this.clearCountdown();
        console.log('倒计时已清除');
        
        // 调用云函数检查过期订单
        console.log('开始调用checkExpiredOrders云函数...');
        wx.cloud.callFunction({
          name: 'checkExpiredOrders'
        }).then(res => {
          console.log('checkExpiredOrders云函数调用成功:', res);
          // 刷新订单列表，processingExpired 将在 fetchOrders 数据加载完后、startCountdown 之前重置
          console.log('刷新订单列表');
          this.fetchOrders();
        }).catch(err => {
          console.error('检查过期订单失败', err);
          this.setData({ processingExpired: false });
          console.log('重置处理状态为false');
          // 重新启动倒计时
          console.log('重新启动倒计时');
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
    // 设置从详情页返回的标志（使用全局变量保存，防止页面重新加载丢失）
    getApp().globalData.fromOrderDetail = true;
    getApp().globalData.savedOrderListStatus = this.data.selectedStatus;
    getApp().globalData.savedOrderListDeliveryType = this.data.deliveryType;
    getApp().globalData.savedOrderListScrollTop = this.data.scrollTop;
    
    this.setData({ 
      fromDetail: true,
      savedScrollTop: this.data.scrollTop // 保存当前滚动位置
    });
    console.log('=== viewOrderDetail ===');
    console.log('保存的滚动位置:', this.data.scrollTop);
    console.log('即将跳转，保存的状态:', this.data.selectedStatus, '配送方式:', this.data.deliveryType);
    // 跳转到订单详情页面
    wx.navigateTo({
      url: `/pages/order-detail/index?id=${orderId}`
    });
  },

  switchStatus(e) {
    const status = e.currentTarget.dataset.status;
    const deliveryType = e.currentTarget.dataset.deliveryType;
    this.setData({ selectedStatus: status, deliveryType, isSwitchingStatus: true });
    // 清除之前的倒计时定时器
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.fetchOrders();
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
            console.error("确认收货失败", err);
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
            console.error("取消订单失败", err);
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
        console.error('获取订单信息失败:', err);
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
              updatedAt: new Date()
            }
          })
            .then(() => {
              wx.showToast({
                title: '删除成功',
                icon: 'success'
              });
              this.fetchOrders();
            })
            .catch((err) => {
              console.error("删除订单失败", err);
              wx.showToast({
                title: '删除失败',
                icon: 'none'
              });
            });
        }
      }
    });
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
      console.error('查看物流信息失败:', error);
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

  // 处理搜索
  handleSearch(e) {
    const { keyword, filterOptions, filteredOrders } = e.detail;
    this.setData({ 
      searchKeyword: keyword,
      filterOptions: filterOptions || {},
      orders: filteredOrders,
      loading: false
    });
  },
  
  // 处理清除搜索
  handleClearSearch() {
    this.setData({ searchKeyword: '' });
    // 重新获取当前标签的订单数据
    this.fetchOrders();
  },
  
  // 处理筛选
  handleFilter(e) {
    const { filterOptions, filteredOrders } = e.detail;
    this.setData({ 
      filterOptions,
      orders: filteredOrders,
      loading: false
    });
  },

  // 清除倒计时
  clearCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  },

  // 页面隐藏时清除倒计时
  onHide() {
    this.clearCountdown();
    console.log('订单列表页面隐藏，清除倒计时');
  },

  // 页面卸载时清除倒计时
  onUnload() {
    this.clearCountdown();
  }
});