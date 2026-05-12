// pages/after-sales/list/index.js
const { getCollection } = require("../../../utils/cloud");

const db = wx.cloud.database();

const TYPE_TEXT_MAP = {
  refund: '退款',
  refund_received: '退款（已收到货）',
  refund_not_received: '退款（未收到货）',
  return_refund: '退货退款',
  exchange: '换货',
  mixed: '混合售后'
};

const STATUS_TEXT_MAP = {
  submitted: '待处理',
  reviewing: '审核中',
  waiting_buyer_return: '待买家寄回',
  waiting_seller_receive: '待商家收货',
  processing: '处理中',
  rejected: '已拒绝',
  completed: '已完成',
  cancelled: '已取消',
  pending: '待处理',
  approved: '已通过',
  seller_reviewing: '商家验货中',
  seller_returning: '商家寄回中',
  intercepting: '拦截中'
};

const STATUS_CLASS_MAP = {
  submitted: 'after-sales-item__status--pending',
  reviewing: 'after-sales-item__status--pending',
  waiting_buyer_return: 'after-sales-item__status--pending',
  waiting_seller_receive: 'after-sales-item__status--pending',
  processing: 'after-sales-item__status--approved',
  rejected: 'after-sales-item__status--rejected',
  completed: 'after-sales-item__status--completed',
  cancelled: 'after-sales-item__status--cancelled',
  pending: 'after-sales-item__status--pending',
  approved: 'after-sales-item__status--approved',
  seller_reviewing: 'after-sales-item__status--pending',
  seller_returning: 'after-sales-item__status--processing',
  intercepting: 'after-sales-item__status--pending'
};

const CAN_CANCEL_STATUSES = ['pending', 'submitted', 'reviewing', 'waiting_buyer_return', 'processing', 'approved'];

function formatTime(value) {
  if (!value) {
    return '';
  }

  let date = value;
  if (!(date instanceof Date)) {
    if (value.$date) {
      date = new Date(value.$date);
    } else if (value._seconds) {
      date = new Date(value._seconds * 1000);
    } else {
      date = new Date(value);
    }
  }

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

Page({
  data: {
    afterSalesList: [],
    currentOrderId: '',
    currentProductIndex: null,
    loading: true
  },

  onLoad(options) {
    console.log('=== 售后列表页 onLoad ===');
    console.log('options:', options);
    const productIndex = options?.productIndex !== undefined ? parseInt(options.productIndex) : null;
    console.log('currentProductIndex:', productIndex);
    this.setData({
      currentOrderId: options?.orderId || '',
      currentProductIndex: productIndex
    });
    this.fetchAfterSalesList();
  },

  onShow() {
    this.fetchAfterSalesList();
  },

  fetchAfterSalesList() {
    this.setData({ loading: true });
    wx.showLoading({ title: '加载中...' });

    const app = getApp();
    const openid = app.globalData.openid;
    const { currentOrderId } = this.data;

    if (!openid) {
      wx.hideLoading();
      this.setData({ loading: false });
      wx.showToast({
        title: '获取用户信息失败',
        icon: 'none'
      });
      return;
    }

    // 如果指定了订单ID，直接查询该订单的售后记录
    if (currentOrderId) {
      this.fetchAfterSalesByOrderId(currentOrderId);
      return;
    }

    const orders = getCollection("orders");
    orders.where({ _openid: openid }).get()
      .then((res) => {
        const orderIds = res.data.map((order) => order._id);

        if (orderIds.length === 0) {
          wx.hideLoading();
          this.setData({ afterSalesList: [], loading: false });
          return null;
        }

        return getCollection("after_sales_cases").where({
          orderId: db.command.in(orderIds)
        }).orderBy('createdAt', 'desc').get().then((caseRes) => {
          if (caseRes.data && caseRes.data.length > 0) {
            this.setData({
              afterSalesList: caseRes.data.map((item) => this.normalizeCaseRecord(item, false)),
              loading: false
            });
            return true;
          }

          return getCollection('afterSales').where({
            orderId: db.command.in(orderIds)
          }).orderBy('createdAt', 'desc').get().then((legacyRes) => {
            this.setData({
              afterSalesList: (legacyRes.data || []).map((item) => this.normalizeCaseRecord(item, true)),
              loading: false
            });
            return true;
          });
        });
      })
      .then(() => {
        wx.hideLoading();
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({ loading: false });
        console.error("获取售后记录失败", err);
        wx.showToast({
          title: '获取售后记录失败',
          icon: 'none'
        });
      });
  },

  normalizeCaseRecord(item, isLegacy) {
    const type = item.primaryAfterSalesType || item.type || 'refund';
    const status = item.caseStatus || item.status || 'submitted';
    return {
      _id: item._id,
      orderId: item.orderId,
      orderNo: item.orderNumber || item.orderNo || item.orderId,
      type,
      typeText: TYPE_TEXT_MAP[type] || type,
      status,
      statusText: STATUS_TEXT_MAP[status] || status,
      statusClass: STATUS_CLASS_MAP[status] || '',
      reason: item.applyReasonText || item.reason || '',
      refundAmount: Number(item.totalApplyAmount ?? item.refundAmount ?? 0) || 0,
      createdAtText: formatTime(item.createdAt),
      itemCount: Number(item.itemCount || 1) || 1,
      totalApplyQty: Number(item.totalApplyQty || 1) || 1,
      isLegacy,
      canCancel: CAN_CANCEL_STATUSES.includes(status),
      // 保留 items 字段用于商品级别筛选
      items: item.items || item.itemsDetail || undefined,
      // 保留旧版的 itemIndex 字段
      itemIndex: item.itemIndex
    };
  },

  fetchAfterSalesByOrderId(orderId) {
    const { currentProductIndex } = this.data;
    console.log('=== fetchAfterSalesByOrderId ===');
    console.log('orderId:', orderId);
    console.log('currentProductIndex:', currentProductIndex);
    
    // 先查询售后案件
    getCollection("after_sales_cases").where({
      orderId: orderId
    }).orderBy('createdAt', 'desc').get().then((caseRes) => {
      wx.hideLoading();
      console.log('查询结果:', caseRes.data);
      
      if (caseRes.data && caseRes.data.length > 0) {
        const caseIds = caseRes.data.map(item => item._id);
        
        // 再查询商品级别售后明细
        return getCollection("after_sales_case_items").where({
          caseId: db.command.in(caseIds)
        }).get().then((itemRes) => {
          const itemsMap = {};
          if (itemRes.data && itemRes.data.length > 0) {
            itemRes.data.forEach(item => {
              if (!itemsMap[item.caseId]) {
                itemsMap[item.caseId] = [];
              }
              itemsMap[item.caseId].push(item);
            });
          }
          
          // 将商品信息关联到售后案件
          let list = caseRes.data.map((caseItem) => {
            const normalized = this.normalizeCaseRecord(caseItem, false);
            normalized.items = itemsMap[caseItem._id] || [];
            return normalized;
          });
          
          console.log('标准化后列表:', list);
          
          // 如果指定了商品索引，筛选出该商品的售后记录
          if (currentProductIndex !== null) {
            console.log('开始筛选，currentProductIndex:', currentProductIndex);
            list = list.filter(item => {
              console.log('item.items:', item.items);
              if (item.items && Array.isArray(item.items)) {
                const match = item.items.some(i => {
                  console.log('i.orderItemIndex:', i.orderItemIndex, 'type:', typeof i.orderItemIndex);
                  return Number(i.orderItemIndex) === currentProductIndex;
                });
                console.log('是否匹配:', match);
                return match;
              }
              return false;
            });
            console.log('筛选后列表:', list);
          }
          
          this.setData({ afterSalesList: list, loading: false });
        });
      } else {
        // 查询旧版本售后记录
        getCollection('afterSales').where({
          orderId: orderId
        }).orderBy('createdAt', 'desc').get().then((legacyRes) => {
          let list = (legacyRes.data || []).map((item) => this.normalizeCaseRecord(item, true));
          
          // 如果指定了商品索引，筛选出该商品的售后记录
          if (currentProductIndex !== null) {
            list = list.filter(item => {
              // 旧版售后记录的 itemIndex 字段
              return Number(item.itemIndex) === currentProductIndex;
            });
          }
          
          this.setData({ afterSalesList: list, loading: false });
        }).catch(() => {
          this.setData({ afterSalesList: [], loading: false });
        });
      }
    }).catch(() => {
      wx.hideLoading();
      this.setData({ afterSalesList: [], loading: false });
    });
  },

  viewAfterSalesDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/after-sales/detail/index?id=${id}`
    });
  },

  cancelAfterSales(e) {
    const id = e.currentTarget.dataset.id;
    const orderId = e.currentTarget.dataset.orderId;
    const isLegacy = !!e.currentTarget.dataset.legacy;
    const canCancel = e.currentTarget.dataset.canCancel === 'true';

    if (!canCancel) {
      wx.showToast({
        title: '当前状态无法取消售后',
        icon: 'none'
      });
      return;
    }

    wx.showModal({
      title: '取消售后',
      content: '确定要取消售后申请吗？',
      success: (res) => {
        if (res.confirm) {
          this.performCancelAfterSales({ id, orderId, isLegacy });
        }
      }
    });
  },

  performCancelAfterSales({ id, orderId, isLegacy }) {
    wx.showLoading({ title: '取消中...' });

    const request = isLegacy
      ? this.cancelLegacyAfterSales(id)
      : wx.cloud.callFunction({
          name: 'updateOrderStatus',
          data: {
            orderId,
            operation: 'cancelAfterSales',
            params: {
              caseId: id,
              result: '用户取消售后申请',
              operatorType: 'user'
            }
          }
        });

    request.then((res) => {
      if (!isLegacy && (!res.result || !res.result.success)) {
        throw new Error(res.result?.error || '取消售后失败');
      }
      wx.hideLoading();
      wx.showToast({ title: '取消成功', icon: 'success' });
      this.fetchAfterSalesList();
    }).catch((err) => {
      wx.hideLoading();
      console.error('取消售后失败', err);
      wx.showToast({ title: err.message || '取消售后失败', icon: 'none' });
    });
  },

  cancelLegacyAfterSales(id) {
    const afterSales = getCollection('afterSales');
    return afterSales.doc(id).update({
      data: {
        status: 'cancelled',
        updatedAt: new Date()
      }
    }).then(() => afterSales.doc(id).get())
      .then((res) => getCollection('orders').doc(res.data.orderId).update({
        data: {
          status: 'completed',
          afterSalesStatus: 'cancelled',
          updatedAt: new Date()
        }
      }));
  },

  goBack() {
    wx.navigateBack();
  },

  goToOrderList() {
    wx.switchTab({
      url: '/pages/order-list/index'
    });
  }
});
