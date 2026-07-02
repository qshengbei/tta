// pages/admin/order-manage/index.js
const db = wx.cloud.database();

// 默认快递规则
const DEFAULT_EXPRESS_RULES = [
  {
    provinces: ["福建省"],
    fee: 4,
    freeshipping: 40,
    sort: 1
  },
  {
    province: "默认",
    fee: 10,
    freeshipping: 100,
    sort: 99
  }
];

Page({

  /**
   * 页面的初始数据
   */
  data: {
    orders: [], // 订单列表
    originalOrders: [], // 原始订单数据（用于搜索筛选）
    status: 'pending', // 订单状态筛选，默认待支付
    deliveryType: 'express', // 配送类型筛选，默认快递运输
    loading: false, // 加载状态
    page: 1, // 当前页码
    hasMore: true, // 是否有更多数据
    filterOptions: {
      status: ['pending', 'paid', 'shipping', 'delivered', 'completed', 'refund_completed', 'cancelled', 'refund', 'afterSales'],
      deliveryType: ['express', 'pickup', 'local']
    },
    searchKeyword: '', // 搜索关键词
    afterSalesPanelVisible: false,
    selectedAfterSalesCase: null,
    selectedAfterSalesItems: [],
    selectedAfterSalesOrderId: '',
    processingItemId: '',
    // 编辑订单相关
    editOrderPanelVisible: false,
    editingOrder: null,
    editingAddress: {
      name: '',
      phone: '',
      address: ''
    },
    addressEditVisible: false,
    expressRules: [] // 快递运费规则
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    console.log('订单管理页面加载');
    this.fetchExpressRules();
    this.loadOrders();
  },
  
  // 获取快递运费规则
  fetchExpressRules() {
    const settings = db.collection("settings");
    settings
      .get()
      .then((res) => {
        let expressRules = [];
        if (res.data && res.data.length > 0) {
          const firstSetting = res.data[0];
          if (firstSetting.expressRules) {
            expressRules = [...firstSetting.expressRules].sort((a, b) => {
              return (a.sort || 0) - (b.sort || 0);
            });
          } else {
            expressRules = DEFAULT_EXPRESS_RULES;
          }
        } else {
          expressRules = DEFAULT_EXPRESS_RULES;
        }
        this.setData({ expressRules });
      })
      .catch((err) => {
        console.error("获取快递运费规则失败", err);
        this.setData({ expressRules: DEFAULT_EXPRESS_RULES });
      });
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    console.log('订单管理页面显示');
    this.setData({ page: 1, hasMore: true, orders: [] });
    this.loadOrders();
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

  async getActiveAfterSalesCases(orderId) {
    const activeStatuses = ['submitted', 'reviewing', 'waiting_buyer_return', 'waiting_seller_receive', 'processing', 'intercepting'];
    const caseRes = await db.collection('after_sales_cases').where({
      orderId,
      caseStatus: db.command.in(activeStatuses)
    }).orderBy('createdAt', 'desc').get();

    return caseRes.data || [];
  },

  async getCaseItems(caseId) {
    const itemsRes = await db.collection('after_sales_case_items').where({
      caseId
    }).orderBy('createdAt', 'asc').get();

    return itemsRes.data || [];
  },

  buildItemActionLabel(item) {
    const name = item.productNameSnapshot || '商品';
    const qty = Number(item.applyQty || 0) || 0;
    const typeMap = {
      refund: '退款',
      refund_received: '退款（已收到货）',
      refund_not_received: '退款（未收到货）',
      return_refund: '退货退款',
      exchange: '换货'
    };
    const typeText = typeMap[item.afterSalesType] || item.afterSalesType || '售后';
    return `${name} x${qty} (${typeText})`;
  },

  getItemTypeText(type) {
    const typeMap = {
      refund: '退款',
      refund_received: '退款（已收到货）',
      refund_not_received: '退款（未收到货）',
      return_refund: '退货退款',
      exchange: '换货'
    };
    return typeMap[type] || type || '售后';
  },

  formatDate(dateValue) {
    if (!dateValue) return '';
    let date;
    if (dateValue instanceof Date) {
      date = dateValue;
    } else if (typeof dateValue === 'object' && dateValue._seconds) {
      date = new Date(dateValue._seconds * 1000);
    } else if (typeof dateValue === 'object' && dateValue.$date) {
      date = new Date(dateValue.$date);
    } else {
      date = new Date(dateValue);
    }
    
    if (isNaN(date.getTime())) return '';
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  },

  getItemStatusText(status) {
    const statusMap = {
      submitted: '待审核',
      reviewing: '审核中',
      approved: '已同意',
      rejected: '已拒绝',
      processing: '处理中',
      completed: '已完成',
      cancelled: '已取消',
      waiting_buyer_return: '待买家寄回',
      waiting_seller_receive: '待商家收货',
      seller_reviewing: '商家验货中',
      seller_returning: '商家寄回中',
      intercepting: '拦截中'
    };
    return statusMap[status] || status || '待处理';
  },

  normalizeCaseItem(item) {
    const status = String(item.itemStatus || '');
    return {
      ...item,
      typeText: this.getItemTypeText(item.afterSalesType),
      statusText: this.getItemStatusText(item.itemStatus),
      applyQtyText: Number(item.applyQty || 0) || 0,
      applyRefundAmountText: Number(item.applyRefundAmount || 0) || 0,
      canApprove: !['approved', 'completed', 'rejected', 'cancelled'].includes(status),
      canReject: !['rejected', 'completed', 'cancelled'].includes(status),
      canComplete: ['approved', 'processing', 'waiting_seller_receive'].includes(status),
      canInspect: ['waiting_seller_receive'].includes(status),
      canReturn: ['seller_reviewing'].includes(status),
      canConfirmReturn: ['seller_returning'].includes(status)
    };
  },

  closeAfterSalesPanel() {
    this.setData({
      afterSalesPanelVisible: false,
      selectedAfterSalesCase: null,
      selectedAfterSalesItems: [],
      selectedAfterSalesOrderId: '',
      processingItemId: ''
    });
  },

  viewAfterSalesDetail(e) {
    const caseId = e.currentTarget.dataset.caseId;
    this.closeAfterSalesPanel();
    wx.navigateTo({
      url: `/pages/admin/after-sales/detail/index?id=${caseId}`
    });
  },

  preventPanelClose() {},

  refreshAfterSalesPanel(caseId, orderId) {
    return Promise.all([
      db.collection('after_sales_cases').doc(caseId).get(),
      this.getCaseItems(caseId)
    ]).then(([caseRes, items]) => {
      const normalizedItems = items.map((item) => this.normalizeCaseItem(item));
      this.setData({
        selectedAfterSalesCase: caseRes.data || this.data.selectedAfterSalesCase,
        selectedAfterSalesItems: normalizedItems,
        selectedAfterSalesOrderId: orderId
      });
      return normalizedItems;
    });
  },

  async handleAfterSalesItemAction(e) {
    const itemId = e.currentTarget.dataset.itemId;
    const action = e.currentTarget.dataset.action;
    const caseId = this.data.selectedAfterSalesCase?._id;
    const orderId = this.data.selectedAfterSalesOrderId;

    if (!itemId || !action || !caseId || !orderId) {
      wx.showToast({
        title: '售后参数缺失',
        icon: 'none'
      });
      return;
    }

    const actionMap = {
      approve: { result: '管理员同意售后明细', successText: '已同意' },
      reject: { result: '管理员拒绝售后明细', successText: '已拒绝' },
      complete: { result: '管理员完成售后明细', successText: '已完成' },
      inspect_pass: { result: '管理员验货通过', successText: '验货通过' },
      inspect_fail: { result: '管理员验货不通过', successText: '验货不通过' },
      return_goods: { result: '管理员寄回商品给买家', successText: '已提交寄回信息' },
      confirm_return: { result: '管理员确认寄回完成', successText: '已确认寄回完成' }
    };

    const current = actionMap[action];
    if (!current) {
      return;
    }

    this.setData({ processingItemId: itemId });

    try {
      await this.callUpdateOrderStatus(orderId, 'processAfterSales', {
        caseId,
        itemId,
        itemAction: action,
        result: current.result,
        operatorType: 'admin'
      });

      await this.refreshAfterSalesPanel(caseId, orderId);

      wx.showToast({
        title: current.successText,
        icon: 'success'
      });

      const allClosed = this.data.selectedAfterSalesItems.every((item) => ['completed', 'rejected', 'cancelled'].includes(String(item.itemStatus || '')));
      if (allClosed) {
        this.closeAfterSalesPanel();
      }

      this.setData({ page: 1, hasMore: true, orders: [] });
      this.loadOrders();
    } catch (err) {
      console.error('处理售后明细失败:', err);
      wx.showToast({
        title: err.message || '处理售后失败',
        icon: 'none'
      });
    } finally {
      this.setData({ processingItemId: '' });
    }
  },

  getItemActionOptions() {
    return [
      { key: 'approve', label: '同意该商品售后', result: '管理员同意售后明细' },
      { key: 'reject', label: '拒绝该商品售后', result: '管理员拒绝售后明细' },
      { key: 'complete', label: '完成该商品售后', result: '管理员完成售后明细' },
      { key: 'inspect_pass', label: '验货通过', result: '管理员验货通过' },
      { key: 'inspect_fail', label: '验货不通过', result: '管理员验货不通过' },
      { key: 'return_goods', label: '寄回商品', result: '管理员寄回商品给买家' },
      { key: 'confirm_return', label: '确认寄回完成', result: '管理员确认寄回完成' }
    ];
  },

  /**
   * 加载订单数据
   */
  async loadOrders() {
    if (this.data.loading || !this.data.hasMore) return;
    
    this.setData({ loading: true });
    
    try {
      let query = db.collection('orders');
      
      // 状态筛选
      if (this.data.status === 'afterSales') {
        // 售后状态筛选，查询订单状态为refund或有进行中售后的订单
        const whereCondition = {
          status: db.command.in(['refund'])
        };
        // 配送类型筛选
        if (this.data.deliveryType) {
          whereCondition.deliveryType = this.data.deliveryType;
        }
        query = query.where(whereCondition);
      } else if (this.data.status === 'completed') {
        // 已完成状态筛选，同时包含普通已完成和退款完成
        const whereCondition = {
          status: db.command.in(['completed', 'refund_completed'])
        };
        // 配送类型筛选
        if (this.data.deliveryType) {
          whereCondition.deliveryType = this.data.deliveryType;
        }
        query = query.where(whereCondition);
      } else {
        // 普通状态筛选
        const whereCondition = { status: this.data.status };
        // 配送类型筛选
        if (this.data.deliveryType) {
          whereCondition.deliveryType = this.data.deliveryType;
        }
        query = query.where(whereCondition);
      }
      
      // 分页查询
      const limit = 20;
      const offset = (this.data.page - 1) * limit;
      
      const res = await query
        .orderBy('createdAt', 'desc')
        .skip(offset)
        .limit(limit)
        .get();
      
      const orders = res.data.map(order => {
        // 格式化日期
        const createdAt = new Date(order.createdAt);
        const formattedDate = `${createdAt.getFullYear()}-${(createdAt.getMonth() + 1).toString().padStart(2, '0')}-${createdAt.getDate().toString().padStart(2, '0')} ${createdAt.getHours().toString().padStart(2, '0')}:${createdAt.getMinutes().toString().padStart(2, '0')}`;
        
        // 订单状态文本
        let statusText = '';
        const deliveryType = order.deliveryType || 'express'; // 默认快递运输
        switch (order.status) {
          case 'pending':
            statusText = '待支付';
            break;
          case 'paid':
            if (deliveryType === 'express') {
              statusText = '待发货';
            } else if (deliveryType === 'pickup') {
              statusText = '待自提';
            } else if (deliveryType === 'local') {
              statusText = '待配送';
            } else {
              statusText = '已支付';
            }
            break;
          case 'shipping':
            if (deliveryType === 'express') {
              statusText = order.logisticsState?.stateName || '已发货';
            } else if (deliveryType === 'pickup') {
              statusText = '待自提';
            } else if (deliveryType === 'local') {
              statusText = '配送中';
            } else {
              statusText = '已发货';
            }
            break;
          case 'delivered':
            if (deliveryType === 'express') {
              statusText = '待确认收货';
            } else if (deliveryType === 'pickup') {
              statusText = '待自提';
            } else if (deliveryType === 'local') {
              statusText = '待确认收货';
            } else {
              statusText = '已送达';
            }
            break;
          case 'completed':
            // 检查是否有售后状态
            if (order.afterSalesStatus === 'pending' || order.afterSalesStatus === 'processing') {
              statusText = '售后中';
            } else {
              statusText = '已完成';
            }
            break;
          case 'cancelled':
            statusText = '已取消';
            break;
          case 'refund':
            statusText = '售后中';
            break;
          case 'refund_completed':
            statusText = '退款完成';
            break;
          default:
            statusText = '未知状态';
        }
        
        // 配送类型文本
        let deliveryTypeText = '';
        switch (order.deliveryType) {
          case 'express':
            deliveryTypeText = '快递运输';
            break;
          case 'pickup':
            deliveryTypeText = '上门自提';
            break;
          case 'local':
            deliveryTypeText = '同城配送';
            break;
          default:
            deliveryTypeText = '未知类型';
        }
        
        return {
          ...order,
          createdAt: formattedDate,
          statusText,
          deliveryTypeText
        };
      });
      
      // 合并数据
      const newOrders = this.data.page === 1 ? orders : [...this.data.orders, ...orders];
      
      this.setData({
        orders: newOrders,
        originalOrders: newOrders, // 保存当前筛选条件下的订单数据用于搜索筛选
        hasMore: orders.length === limit,
        page: this.data.page + 1,
        loading: false
      });
    } catch (err) {
      console.error('加载订单失败:', err);
      wx.showToast({
        title: '加载订单失败',
        icon: 'none'
      });
      this.setData({ loading: false });
    }
  },

  /**
   * 下拉刷新
   */
  onPullDownRefresh() {
    this.setData({ page: 1, hasMore: true, orders: [] });
    this.loadOrders();
    wx.stopPullDownRefresh();
  },

  /**
   * 上拉加载
   */
  onReachBottom() {
    this.loadOrders();
  },

  /**
   * 筛选状态
   */
  filterStatus(e) {
    const status = e.currentTarget.dataset.status;
    this.setData({ status, page: 1, hasMore: true, orders: [] });
    this.loadOrders();
  },

  /**
   * 筛选配送类型
   */
  filterDeliveryType(e) {
    const deliveryType = e.currentTarget.dataset.type;
    this.setData({ deliveryType, status: 'pending', page: 1, hasMore: true, orders: [] });
    this.loadOrders();
  },

  /**
   * 查看订单详情
   */
  viewOrderDetail(e) {
    const orderId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/order-detail/index?id=${orderId}`
    });
  },

  /**
   * 编辑订单状态
   */
  editOrderStatus(e) {
    const orderId = e.currentTarget.dataset.id;
    const order = this.data.orders.find(item => item._id === orderId);
    
    wx.showActionSheet({
      itemList: ['待支付', '已支付', '配送中', '待收货', '已完成', '已取消', '退款/售后'],
      success: async (res) => {
        const statusMap = ['pending', 'paid', 'shipping', 'delivered', 'completed', 'cancelled', 'refund'];
        const newStatus = statusMap[res.tapIndex];
        
        try {
          if (newStatus === 'paid') {
            await this.callUpdateOrderStatus(orderId, 'pay');
          } else if (newStatus === 'shipping') {
            await this.callUpdateOrderStatus(orderId, 'ship', {
              trackingNumber: order?.logisticsInfo?.trackingNumber || ''
            });
          } else if (newStatus === 'delivered') {
            await this.callUpdateOrderStatus(orderId, 'deliver');
          } else if (newStatus === 'completed') {
            await this.callUpdateOrderStatus(orderId, 'confirm');
          } else if (newStatus === 'cancelled') {
            await this.callUpdateOrderStatus(orderId, 'cancel', {
              cancelReason: '管理员手动取消'
            });
          } else if (newStatus === 'refund') {
            await this.callUpdateOrderStatus(orderId, 'applyAfterSales', {
              reason: '管理员手动发起售后'
            });
          } else {
            throw new Error('该状态不支持手动直改，请使用对应业务流程');
          }
          
          wx.showToast({
            title: '订单状态更新成功',
            icon: 'success'
          });
          
          // 刷新订单列表
          this.setData({ page: 1, hasMore: true, orders: [] });
          this.loadOrders();
        } catch (err) {
          console.error('更新订单状态失败:', err);
          wx.showToast({
            title: '更新订单状态失败',
            icon: 'none'
          });
        }
      }
    });
  },

  /**
   * 处理搜索
   */
  handleSearch(e) {
    const { keyword, filteredOrders } = e.detail;
    this.setData({ searchKeyword: keyword, orders: filteredOrders });
  },

  /**
   * 处理筛选
   */
  handleFilter(e) {
    const { filterOptions, filteredOrders } = e.detail;
    this.setData({ orders: filteredOrders });
  },

  /**
   * 处理清除搜索
   */
  handleClearSearch() {
    this.setData({ searchKeyword: '', orders: this.data.originalOrders });
  },

  /**
   * 筛选订单
   */
  filterOrders() {
    const { originalOrders, searchKeyword, status, deliveryType } = this.data;
    
    let filteredOrders = [...originalOrders];
    
    // 搜索筛选
    if (searchKeyword) {
      const keyword = searchKeyword.toLowerCase();
      filteredOrders = filteredOrders.filter(order => {
        // 检查订单号、地址姓名、地址电话
        const basicMatch = (
          (order.orderNumber && order.orderNumber.toLowerCase().includes(keyword)) ||
          (order.address && order.address.name && order.address.name.toLowerCase().includes(keyword)) ||
          (order.address && order.address.phone && order.address.phone.includes(keyword))
        );
        
        // 检查商品名称
        const productMatch = order.products && order.products.some(product => {
          return product.name && product.name.toLowerCase().includes(keyword);
        });
        
        return basicMatch || productMatch;
      });
    }
    
    this.setData({ orders: filteredOrders });
  },

  /**
   * 编辑订单
   */
  editOrder(e) {
    const orderId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '编辑订单',
      content: '此功能暂未实现，敬请期待',
      showCancel: false
    });
  },

  /**
   * 发货
   */
  shipOrder(e) {
    console.log('shipOrder函数被调用');
    console.log('事件对象:', e);
    const orderId = e.currentTarget.dataset.id;
    console.log('订单ID:', orderId);
    
    // 跳转到发货页面
    wx.navigateTo({
      url: `/pages/admin/ship-order/index?orderId=${orderId}`,
      success: function(res) {
        console.log('跳转成功:', res);
      },
      fail: function(res) {
        console.log('跳转失败:', res);
      }
    });
  },

  /**
   * 取消订单
   */
  cancelOrder(e) {
    const orderId = e.currentTarget.dataset.id;
    
    wx.showModal({
      title: '取消订单',
      content: '确定要取消这个订单吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await this.callUpdateOrderStatus(orderId, 'cancel', {
              cancelReason: '管理员主动取消'
            });
            
            wx.showToast({
              title: '订单取消成功',
              icon: 'success'
            });
            
            // 刷新订单列表
            this.setData({ page: 1, hasMore: true, orders: [] });
            this.loadOrders();
          } catch (err) {
            console.error('取消订单失败:', err);
            wx.showToast({
              title: '取消订单失败',
              icon: 'none'
            });
          }
        }
      }
    });
  },

  /**
   * 查看物流
   */
  viewLogistics(e) {
    const orderId = e.currentTarget.dataset.id;
    const order = this.data.orders.find(item => item._id === orderId);
    
    if (order.logisticsInfo && order.logisticsInfo.trackingNumber) {
      wx.showModal({
        title: '物流信息',
        content: `物流单号: ${order.logisticsInfo.trackingNumber}`,
        showCancel: false
      });
    } else {
      wx.showToast({
        title: '暂无物流信息',
        icon: 'none'
      });
    }
  },

  /**
   * 确认收货
   */
  confirmReceipt(e) {
    const orderId = e.currentTarget.dataset.id;
    
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
            
            // 刷新订单列表
            this.setData({ page: 1, hasMore: true, orders: [] });
            this.loadOrders();
          } catch (err) {
            console.error('确认收货失败:', err);
            wx.showToast({
              title: '确认收货失败',
              icon: 'none'
            });
          }
        }
      }
    });
  },

  /**
   * 处理退款/售后
   */
  handleAfterSales(e) {
    wx.showModal({
      title: '提示',
      content: '请让用户在订单端发起售后申请，管理员在本页按商品明细处理。',
      showCancel: false
    });
  },

  /**
   * 处理售后请求
   */
  processAfterSales(e) {
    const orderId = e.currentTarget.dataset.id;

    wx.showLoading({ title: '加载售后明细...' });

    this.getActiveAfterSalesCases(orderId)
      .then((cases) => {
        if (!cases || cases.length === 0) {
          throw new Error('未找到进行中的售后单');
        }
        
        if (cases.length === 1) {
          // 只有一个售后案件，直接显示明细
          return this.getCaseItems(cases[0]._id).then((items) => ({ caseDoc: cases[0], items }));
        } else {
          // 多个售后案件，显示案件选择列表
          wx.hideLoading();
          const formattedCases = cases.map(caseItem => ({
            ...caseItem,
            createdAtText: caseItem.createdAt ? this.formatDate(caseItem.createdAt) : ''
          }));
          this.setData({
            afterSalesCaseListVisible: true,
            afterSalesCases: formattedCases,
            selectedAfterSalesOrderId: orderId
          });
          return null;
        }
      })
      .then((result) => {
        if (!result) return;
        
        const { caseDoc, items } = result;
        wx.hideLoading();
        const normalizedItems = items.map((item) => this.normalizeCaseItem(item));
        if (normalizedItems.length === 0) {
          wx.showToast({
            title: '该售后单无可处理明细',
            icon: 'none'
          });
          return;
        }

        this.setData({
          afterSalesPanelVisible: true,
          selectedAfterSalesCase: caseDoc,
          selectedAfterSalesItems: normalizedItems,
          selectedAfterSalesOrderId: orderId,
          processingItemId: ''
        });
      })
      .catch((err) => {
        wx.hideLoading();
        console.error('加载售后明细失败:', err);
        wx.showToast({
          title: err.message || '加载售后明细失败',
          icon: 'none'
        });
      });
  },

  /**
   * 选择售后案件
   */
  selectAfterSalesCase(e) {
    const caseDoc = e.currentTarget.dataset.caseDoc;
    
    wx.showLoading({ title: '加载售后明细...' });
    
    this.getCaseItems(caseDoc._id)
      .then((items) => {
        wx.hideLoading();
        const normalizedItems = items.map((item) => this.normalizeCaseItem(item));
        
        this.setData({
          afterSalesCaseListVisible: false,
          afterSalesPanelVisible: true,
          selectedAfterSalesCase: caseDoc,
          selectedAfterSalesItems: normalizedItems,
          processingItemId: ''
        });
      })
      .catch((err) => {
        wx.hideLoading();
        console.error('加载售后明细失败:', err);
        wx.showToast({
          title: err.message || '加载售后明细失败',
          icon: 'none'
        });
      });
  },

  /**
   * 关闭售后案件列表弹窗
   */
  closeAfterSalesCaseList() {
    this.setData({
      afterSalesCaseListVisible: false,
      afterSalesCases: []
    });
  },

  /**
   * 编辑订单
   */
  async editOrder(e) {
    const orderId = e.currentTarget.dataset.id;
    console.log('编辑订单:', orderId);
    
    try {
      // 获取订单详情
      const orderRes = await db.collection('orders').doc(orderId).get();
      const order = orderRes.data;
      console.log('从数据库读取的订单原始数据:', order);
      
      // 转换 address 字段名格式
      let normalizedAddress = { name: '', phone: '', address: '' };
      if (order.address) {
        if (order.address.userName && order.address.telNumber && order.address.detailInfo) {
          // 处理微信 chooseAddress 格式
          normalizedAddress = {
            name: order.address.userName,
            phone: order.address.telNumber,
            address: `${order.address.provinceName || ''}${order.address.cityName || ''}${order.address.countyName || ''}${order.address.detailInfo || ''}`
          };
        } else {
          // 处理标准格式
          normalizedAddress = {
            name: order.address.name || order.address.userName || '',
            phone: order.address.phone || order.address.telNumber || '',
            address: order.address.address || order.address.detailInfo || ''
          };
        }
      }
      
      // 计算商品金额和运费（如果原数据没有）
      let productAmount = '0.00';
      let shippingFee = '0.00';
      if (order.products && order.products.length > 0) {
        productAmount = order.products.reduce((sum, item) => {
          const price = Number(item.price || 0);
          const quantity = Number(item.quantity || 0);
          return sum + price * quantity;
        }, 0).toFixed(2);
      }
      
      const totalPrice = Number(order.totalPrice || 0);
      if (totalPrice > 0 && productAmount) {
        shippingFee = (totalPrice - Number(productAmount)).toFixed(2);
        if (Number(shippingFee) < 0) {
          shippingFee = '0.00';
        }
      }
      
      // 初始化数据，确保所有字段存在
      // 保存原始地址信息，用于运费计算时提取省份
      const editingOrder = {
        ...order,
        orderNumber: order.orderNumber || '',
        address: {
          ...normalizedAddress,
          // 保存原始地址信息用于运费计算
          provinceName: order.address?.provinceName || '',
          cityName: order.address?.cityName || ''
        },
        originalAddress: order.address, // 保存完整原始地址
        remark: order.remark || order.note || order.message || '',
        products: order.products || order.items || order.productList || [],
        productAmount: productAmount,
        shippingFee: shippingFee,
        totalPrice: totalPrice.toFixed(2),
        // 整数格式（不显示小数点）
        productAmountInt: Math.round(productAmount),
        shippingFeeInt: Math.round(shippingFee),
        totalPriceInt: Math.round(totalPrice)
      };
      
      console.log('处理后的 editingOrder:', editingOrder);
      
      this.setData({
        editingOrder,
        editOrderPanelVisible: true
      });
      
      // 只有待支付订单才允许重新计算运费
      // 待发货、待收货等已付款订单，金额已锁定
      if (editingOrder.status === 'pending') {
        this.updateOrderAmount(editingOrder.products);
      }
    } catch (err) {
      console.error('获取订单详情失败:', err);
      wx.showToast({
        title: '获取订单详情失败',
        icon: 'none'
      });
    }
  },

  /**
   * 关闭编辑订单弹窗
   */
  closeEditOrderPanel() {
    this.setData({
      editOrderPanelVisible: false,
      editingOrder: null
    });
  },

  /**
   * 打开地址编辑
   */
  editAddress() {
    const order = this.data.editingOrder;
    if (order && order.address) {
      this.setData({
        editingAddress: {
          name: order.address.name || '',
          phone: order.address.phone || '',
          address: order.address.address || ''
        },
        addressEditVisible: true
      });
    }
  },

  /**
   * 关闭地址编辑
   */
  closeAddressEdit() {
    this.setData({
      addressEditVisible: false,
      editingAddress: {
        name: '',
        phone: '',
        address: ''
      }
    });
  },

  /**
   * 地址姓名输入
   */
  onAddressNameInput(e) {
    this.setData({
      'editingAddress.name': e.detail.value
    });
  },

  /**
   * 地址电话输入
   */
  onAddressPhoneInput(e) {
    this.setData({
      'editingAddress.phone': e.detail.value
    });
  },

  /**
   * 地址详情输入
   */
  onAddressDetailInput(e) {
    this.setData({
      'editingAddress.address': e.detail.value
    });
  },

  /**
   * 保存地址编辑
   */
  confirmAddressEdit() {
    const { editingAddress, editingOrder } = this.data;
    
    if (!editingAddress.name.trim()) {
      wx.showToast({
        title: '请输入收货人',
        icon: 'none'
      });
      return;
    }
    
    if (!editingAddress.phone.trim()) {
      wx.showToast({
        title: '请输入联系电话',
        icon: 'none'
      });
      return;
    }
    
    if (!editingAddress.address.trim()) {
      wx.showToast({
        title: '请输入详细地址',
        icon: 'none'
      });
      return;
    }
    
    // 更新订单中的地址
    const updatedOrder = {
      ...editingOrder,
      address: {
        name: editingAddress.name,
        phone: editingAddress.phone,
        address: editingAddress.address
      }
    };
    
    this.setData({
      editingOrder: updatedOrder,
      addressEditVisible: false,
      editingAddress: {
        name: '',
        phone: '',
        address: ''
      }
    });
    
    wx.showToast({
      title: '地址已保存',
      icon: 'success'
    });
  },

  /**
   * 备注输入
   */
  onRemarkInput(e) {
    this.setData({
      'editingOrder.remark': e.detail.value
    });
  },

  /**
   * 减少商品数量
   */
  decreaseQty(e) {
    const index = e.currentTarget.dataset.index;
    const orders = [...this.data.editingOrder.products];
    
    if (orders[index] && orders[index].quantity > 1) {
      orders[index].quantity--;
      this.updateOrderAmount(orders);
    }
  },

  /**
   * 增加商品数量
   */
  increaseQty(e) {
    const index = e.currentTarget.dataset.index;
    const orders = [...this.data.editingOrder.products];
    
    if (orders[index] && orders[index].quantity < 99) {
      orders[index].quantity++;
      this.updateOrderAmount(orders);
    }
  },

  /**
   * 更新订单金额
   */
  updateOrderAmount(products) {
    let productAmount = 0;
    products.forEach(item => {
      const price = Number(item.price) || 0;
      const quantity = Number(item.quantity) || 0;
      productAmount += price * quantity;
    });
    
    // 计算运费
    let shippingFee = 0;
    const { expressRules, editingOrder } = this.data;
    
    if (expressRules && expressRules.length > 0 && editingOrder) {
      // 获取省份信息 - 优先从 originalAddress 中获取
      let province = '';
      if (editingOrder.originalAddress && editingOrder.originalAddress.provinceName) {
        province = editingOrder.originalAddress.provinceName;
      } else if (editingOrder.address && editingOrder.address.provinceName) {
        province = editingOrder.address.provinceName;
      } else if (editingOrder.address && editingOrder.address.address) {
        // 尝试从地址文本中提取省份
        const addressText = editingOrder.address.address;
        const provinceMatch = addressText.match(/(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)/);
        if (provinceMatch) {
          province = provinceMatch[0];
        }
      }
      
      if (province) {
        // 查找对应省份的运费规则
        let provinceRule = null;
        for (let i = 0; i < expressRules.length; i++) {
          const rule = expressRules[i];
          if (rule.provinces && Array.isArray(rule.provinces)) {
            if (rule.provinces.some(ruleProvince => province.includes(ruleProvince) || ruleProvince.includes(province))) {
              provinceRule = rule;
              break;
            }
          } else if (rule.province) {
            if (rule.province === "默认" || province.includes(rule.province) || rule.province.includes(province)) {
              provinceRule = rule;
              break;
            }
          }
        }
        
        // 如果没有找到对应省份的规则，使用默认规则
        if (!provinceRule) {
          provinceRule = expressRules.find(rule => rule.province === "默认") || expressRules[0];
        }
        
        if (provinceRule) {
          const freeShippingThreshold = provinceRule.freeShipping || provinceRule.freeShippingThreshold || provinceRule.freeshipping || 0;
          const fee = provinceRule.fee || 0;
          
          console.log('编辑订单运费计算:', {
            productAmount: productAmount,
            freeShippingThreshold: freeShippingThreshold,
            fee: fee,
            isFreeShipping: productAmount >= freeShippingThreshold
          });
          
          // 检查是否满足包邮条件
          if (productAmount >= freeShippingThreshold) {
            shippingFee = 0;
          } else {
            shippingFee = fee;
          }
        }
      }
    }
    
    const totalPrice = productAmount + shippingFee;
    
    this.setData({
      'editingOrder.products': products,
      'editingOrder.productAmount': productAmount.toFixed(2),
      'editingOrder.shippingFee': shippingFee.toFixed(2),
      'editingOrder.totalPrice': totalPrice.toFixed(2),
      'editingOrder.productAmountInt': Math.round(productAmount),
      'editingOrder.shippingFeeInt': Math.round(shippingFee),
      'editingOrder.totalPriceInt': Math.round(totalPrice)
    });
  },

  /**
   * 确认编辑订单
   */
  async confirmEditOrder() {
    const { editingOrder } = this.data;
    
    if (!editingOrder) {
      wx.showToast({
        title: '订单数据异常',
        icon: 'none'
      });
      return;
    }
    
    wx.showLoading({ title: '保存中...' });
    
    try {
      // 读取原始订单数据，保留原始地址格式
      const originalOrderRes = await db.collection('orders').doc(editingOrder._id).get();
      const originalOrder = originalOrderRes.data;
      
      // 转换地址回原始格式
      let saveAddress = originalOrder.address || {};
      if (editingOrder.address) {
        if (originalOrder.address && originalOrder.address.userName) {
          // 如果原始是微信 chooseAddress 格式，从地址文本中提取省市区的关键词
          const addressText = editingOrder.address.address || '';
          let provinceName = originalOrder.address.provinceName || '';
          let cityName = originalOrder.address.cityName || '';
          let countyName = originalOrder.address.countyName || '';
          
          // 尝试从地址文本中提取省市区
          const provinceMatch = addressText.match(/(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)/);
          if (provinceMatch) {
            provinceName = provinceMatch[0];
          }
          
          // 更新地址字段
          saveAddress = {
            ...originalOrder.address,
            userName: editingOrder.address.name,
            telNumber: editingOrder.address.phone,
            detailInfo: addressText,
            provinceName: provinceName,
            cityName: cityName,
            countyName: countyName
          };
        } else {
          // 普通格式
          saveAddress = {
            name: editingOrder.address.name,
            phone: editingOrder.address.phone,
            address: editingOrder.address.address
          };
        }
      }
      
      // 确定要保存的字段
      const isPendingOrder = editingOrder.status === 'pending';
      
      // 待发货及以后状态的订单，只允许修改地址和备注
      const updateData = {
        address: saveAddress,
        remark: editingOrder.remark || '',
        updatedAt: new Date(),
        updatedAtTs: Date.now()
      };
      
      // 待支付订单允许修改商品和金额
      if (isPendingOrder) {
        updateData.products = editingOrder.products;
        updateData.productAmount = editingOrder.productAmount;
        updateData.totalPrice = editingOrder.totalPrice;
      }
      
      // 更新订单
      await db.collection('orders').doc(editingOrder._id).update({
        data: updateData
      });
      
      wx.hideLoading();
      wx.showToast({
        title: '编辑成功',
        icon: 'success'
      });
      
      // 关闭弹窗
      this.closeEditOrderPanel();
      
      // 刷新订单列表
      this.setData({ page: 1, hasMore: true, orders: [] });
      this.loadOrders();
    } catch (err) {
      wx.hideLoading();
      console.error('编辑订单失败:', err);
      wx.showToast({
        title: '编辑订单失败',
        icon: 'none'
      });
    }
  }
})
