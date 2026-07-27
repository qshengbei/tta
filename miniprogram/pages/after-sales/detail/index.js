// pages/after-sales/detail/index.js
import { getCollection } from "../../../utils/cloud";
import watcherManager from '../../../utils/watcherManager';

const TYPE_TEXT_MAP = {
  refund: '退款',
  refund_received: '退款（已收到货）',
  refund_not_received: '退款（未收到货）',
  return_refund: '退货退款',
  exchange: '换货',
  mixed: '混合售后',
  not_received_refund: '未收到货退款'
};

const QUALITY_REASONS = [
  'size_mismatch',
  'color_mismatch',
  'material_mismatch',
  'fade',
  'quality',
  'missing',
  'damaged',
  'wrong_item'
];

function getShippingResponsibilityByReason(reasonCode) {
  if (reasonCode && QUALITY_REASONS.includes(reasonCode)) {
    return 'seller';
  }
  return 'buyer';
}

const STATUS_TEXT_MAP = {
  submitted: '待处理',
  reviewing: '审核中',
  waiting_buyer_return: '待买家寄回',
  waiting_seller_receive: '待商家收货',
  pending_refund: '待退款',
  rejected: '已拒绝',
  completed: '已完成',
  cancelled: '已取消',
  pending: '待处理',
  approved: '已通过',
  seller_reviewing: '商家验货中',
  seller_returning: '商家寄回中',
  buyer_receiving: '待买家收货',
  intercepting: '正在拦截快递'
};

const STATUS_DESC_MAP = {
  submitted: '我们正在处理您的售后申请，请耐心等待',
  reviewing: '售后单正在审核中，请耐心等待',
  waiting_buyer_return: '审核已通过，请按指引寄回商品',
  waiting_seller_receive: '商品寄回中，等待商家签收',
  processing: '售后处理中，请留意后续进度',
  rejected: '您的售后申请未通过，请查看处理意见',
  completed: '您的售后申请已完成，感谢您的支持',
  cancelled: '您的售后申请已取消',
  pending: '我们正在处理您的售后申请，请耐心等待',
  approved: '您的售后申请已通过，我们将尽快为您处理',
  seller_reviewing: '商家正在验货，请耐心等待',
  seller_returning: '商家正在将商品寄回，请留意物流信息',
  buyer_receiving: '商家已寄回商品，请注意查收并确认收货',
  intercepting: '客服正在拦截快递，请耐心等待后续处理'
};

const STATUS_CLASS_MAP = {
  submitted: 'status-section__status--pending',
  reviewing: 'status-section__status--pending',
  waiting_buyer_return: 'status-section__status--pending',
  waiting_seller_receive: 'status-section__status--pending',
  processing: 'status-section__status--approved',
  rejected: 'status-section__status--rejected',
  completed: 'status-section__status--completed',
  cancelled: 'status-section__status--cancelled',
  pending: 'status-section__status--pending',
  approved: 'status-section__status--approved',
  seller_reviewing: 'status-section__status--pending',
  seller_returning: 'status-section__status--processing',
  buyer_receiving: 'status-section__status--processing',
  intercepting: 'status-section__status--pending'
};

const CAN_CANCEL_STATUSES = ['pending', 'submitted', 'reviewing', 'waiting_buyer_return', 'waiting_seller_receive', 'processing', 'approved'];
const AUTO_PROCESS_TIMEOUT_HOURS = 48;

function parseDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'object') {
    if (value.$date) {
      const parsed = new Date(value.$date);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (value._seconds) {
      const parsed = new Date(value._seconds * 1000);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (typeof value.toDate === 'function') {
      const parsed = value.toDate();
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTime(value) {
  const date = parseDate(value);
  if (!date) {
    return '';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function getShippingResponsibilityText(value) {
  if (value === 'buyer') {
    return '买家承担';
  }
  if (value === 'seller') {
    return '卖家承担';
  }
  return value === 'mixed' ? '按商品项判定' : '';
}

Page({
  data: {
    afterSales: {},
    afterSalesItems: [],
    isLegacy: false,
    remainingTime: 0,
    isExpired: false,
    processingExpired: false,
    autoProcessCountdown: '',
    pageVisible: false,
    showLogistics: false,
    logisticsData: null,
    logisticsMapData: null,
    logisticsModalTitle: '',
    logisticsMapCenter: {
      latitude: 39.908823,
      longitude: 116.397470
    },
    logisticsMapScale: 10,
    logisticsTrackPoints: [],
    logisticsStateMap: null,
    operationLogs: [] // 操作记录
  },

  detectTimer: null,

  onLoad(options) {
    const id = options.id;
    if (id) {
      this.caseId = id;
      this.cancelAttempted = new Set();
      this.fetchAfterSalesDetail(id);
    }
  },

  onShow() {
    this.setData({ pageVisible: true });
    // 页面显示时刷新数据，确保显示最新的售后状态和退款信息
    if (this.caseId) {
      this.fetchAfterSalesDetail(this.caseId);
      console.log('[售后详情页面] 开始实时监听');
      this.startAfterSalesWatch();
    }
    
    // 加载物流状态映射
    if (!this.data.logisticsStateMap) {
      this.getStateMap();
    }
  },

  onPullDownRefresh() {
    // 下拉刷新
    if (this.caseId) {
      this.fetchAfterSalesDetail(this.caseId).then(() => {
        wx.stopPullDownRefresh();
      }).catch(() => {
        wx.stopPullDownRefresh();
      });
    } else {
      wx.stopPullDownRefresh();
    }
  },

  onUnload() {
    this.clearCountdown();
    if (this.caseId) {
      console.log('[售后详情页面] 关闭实时监听');
      watcherManager.destroy(`after_sales_detail_${this.caseId}`);
    }
  },

  fetchAfterSalesDetail(id) {
    wx.showLoading({ title: '加载中...' });

    return getCollection('after_sales_cases').doc(id).get()
      .then((res) => {
        if (!res.data) {
          return this.fetchLegacyAfterSalesDetail(id);
        }

        return getCollection('after_sales_case_items').where({ caseId: id }).orderBy('createdAt', 'asc').get()
          .then((itemsRes) => {
            const items = (itemsRes.data || []).map((item) => this.normalizeCaseItem(item));
            const totalItemAmount = items.reduce((sum, item) => sum + (item.unitPrice * item.applyQty), 0);
            const afterSales = {
              ...this.normalizeCaseRecord(res.data),
              items: items,
              totalItemAmount: totalItemAmount
            };
            this.setData({
              afterSales: afterSales,
              afterSalesItems: items,
              isLegacy: false,
              combinedMediaList: this.generateCombinedMediaList(afterSales.proofImages, afterSales.proofVideos, afterSales.proofVideoThumbs)
            });
            this.startAutoProcessCountdown();
            // 获取退款记录
            this.fetchRefundRecord(id);
            // 获取操作记录
            this.fetchOperationLogs(id);
            wx.hideLoading();
          });
      })
      .catch(() => this.fetchLegacyAfterSalesDetail(id));
  },

  // 启动售后单监听
  startAfterSalesWatch() {
    const { caseId } = this;
    if (!caseId) {
      console.warn('[售后详情页面] 没有售后单ID，无法启动监听');
      return;
    }

    const listenerKey = `after_sales_detail_${caseId}`;
    
    // 使用watcherManager创建监听
    watcherManager.create(listenerKey, () => {
      try {
        const db = wx.cloud.database();
        return db.collection('after_sales_cases').doc(caseId).watch({
          onChange: (snapshot) => {
            if (!this.data.pageVisible) return;
            console.log('[售后详情页面] 售后单数据变化:', snapshot);
            // 处理售后单变化
            this.handleAfterSalesChanges(snapshot);
          },
          onError: (error) => {
            console.error('[售后详情页面] 售后单监听失败:', error);
            // 自动重连
            watcherManager.autoReconnect(listenerKey, 'after sales watch error');
          }
        });
      } catch (error) {
        console.error('[售后详情页面] 初始化售后单监听失败:', error);
        throw error;
      }
    });
  },

  // 处理售后单数据变化
  handleAfterSalesChanges(snapshot) {
    if (!snapshot.docChanges || snapshot.docChanges.length === 0) {
      return;
    }
    
    // 遍历变化，更新售后单数据
    snapshot.docChanges.forEach(change => {
      if (change.dataType === 'update' || change.dataType === 'add') {
        // 售后单更新或新增，重新获取详情
        this.fetchAfterSalesDetail(this.caseId);
      }
    });
  },

  fetchLegacyAfterSalesDetail(id) {
    return getCollection('afterSales').doc(id).get()
      .then((res) => {
        wx.hideLoading();
        if (res.data) {
          this.setData({
            afterSales: this.normalizeLegacyCaseRecord(res.data),
            afterSalesItems: [],
            isLegacy: true
          });
          return;
        }

        wx.showToast({ title: '售后记录不存在', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1000);
      })
      .catch((err) => {
        wx.hideLoading();
        console.error('获取售后详情失败', err);
        wx.showToast({ title: '获取售后详情失败', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1000);
      });
  },

  normalizeCaseRecord(record) {
    const status = record.caseStatus || 'submitted';
    const type = record.primaryAfterSalesType || 'refund';
    return {
      _id: record._id,
      orderId: record.orderId,
      orderNo: record.orderNumber || record.orderId,
      type,
      typeText: TYPE_TEXT_MAP[type] || type,
      status,
      caseStatus: status,
      statusText: STATUS_TEXT_MAP[status] || status,
      statusDesc: STATUS_DESC_MAP[status] || '',
      statusClass: STATUS_CLASS_MAP[status] || '',
      refundAmount: Number(record.refundSummary?.approvedAmount || record.totalApplyAmount || 0) || 0,
      reason: record.applyReasonText || '',
      autoProcessed: record.autoProcessed || false,
      createdAt: record.createdAt,
      description: record.applyDescription || record.description || '',
      proofImages: Array.isArray(record.proofImages) ? record.proofImages : [],
      proofVideos: Array.isArray(record.proofVideos) ? record.proofVideos : [],
      proofVideoThumbs: Array.isArray(record.proofVideoThumbs) ? record.proofVideoThumbs : [],
      contactName: record.contactName || '',
      contactPhone: record.contactPhone || '',
      createdAtText: formatTime(record.createdAt),
      updatedAtText: formatTime(record.updatedAt),
      processInfo: record.processSummary && record.processSummary.result
        ? {
            opinion: record.processSummary.result || '',
            processTimeText: formatTime(record.processSummary.processTime || null)
          }
        : null,
      itemCount: Number(record.itemCount || 0) || 0,
      totalApplyQty: Number(record.totalApplyQty || 0) || 0,
      reasonCode: record.applyReasonCode || record.reasonCode || '',
      shippingResponsibilityText: getShippingResponsibilityText(record.shippingResponsibility || record.shippingResponsibilitySummary || getShippingResponsibilityByReason(record.applyReasonCode || record.reasonCode)),
      returnTrackingNumber: record.returnLogisticsInfo?.trackingNumber || '',
      returnCompanyCode: record.returnLogisticsInfo?.companyCode || '',
      returnCompanyName: record.returnLogisticsInfo?.companyName || '',
      returnLogisticsInfo: record.returnLogisticsInfo || null,
      sellerReturnLogistics: record.sellerReturnLogistics || null,
      inspectEvidence: record.inspectEvidence || null
    };
  },

  normalizeLegacyCaseRecord(record) {
    const status = record.status || 'pending';
    const type = record.type || 'refund';
    return {
      ...record,
      orderNo: record.orderNo || record.orderId,
      type,
      typeText: TYPE_TEXT_MAP[type] || type,
      status,
      statusText: STATUS_TEXT_MAP[status] || status,
      statusDesc: STATUS_DESC_MAP[status] || '',
      statusClass: STATUS_CLASS_MAP[status] || '',
      refundAmount: Number(record.refundAmount || 0) || 0,
      reason: record.reason || '',
      proofImages: Array.isArray(record.proofImages) ? record.proofImages : [],
      proofVideos: Array.isArray(record.proofVideos) ? record.proofVideos : [],
      proofVideoThumbs: Array.isArray(record.proofVideoThumbs) ? record.proofVideoThumbs : [],
      processInfo: record.processInfo
        ? {
            opinion: record.processInfo.opinion || '',
            processTimeText: formatTime(record.processInfo.processTime)
          }
        : null,
      createdAtText: formatTime(record.createdAt),
      updatedAtText: formatTime(record.updatedAt),
      itemCount: 1,
      totalApplyQty: 1,
      shippingResponsibilityText: ''
    };
  },

  normalizeCaseItem(item) {
    const type = item.afterSalesType || 'refund';
    const status = item.itemStatus || 'submitted';
    return {
      _id: item._id,
      name: item.productNameSnapshot || '商品',
      skuName: item.skuNameSnapshot || '',
      image: item.coverImageSnapshot || '',
      typeText: TYPE_TEXT_MAP[type] || type,
      applyQty: Number(item.applyQty || 0) || 0,
      refundAmount: Number(item.applyRefundAmount || 0) || 0,
      unitPrice: Number(item.unitPriceSnapshot || 0) || 0,
      itemStatus: status,
      statusText: STATUS_TEXT_MAP[status] || status,
      shippingResponsibilityText: getShippingResponsibilityText(item.shippingResponsibility),
      productSupports7DayReturn: item.productSupports7DayReturn || false
    };
  },

  canCancelAfterSales() {
    const status = this.data.afterSales.status || this.data.afterSales.caseStatus;
    // 拦截状态下不可取消
    if (status === 'intercepting') {
      return false;
    }
    return CAN_CANCEL_STATUSES.includes(status);
  },

  cancelAfterSales() {
    if (!this.canCancelAfterSales()) {
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
          this.performCancelAfterSales();
        }
      }
    });
  },

  performCancelAfterSales() {
    wx.showLoading({ title: '取消中...' });

    const request = this.data.isLegacy
      ? this.cancelLegacyAfterSales()
      : wx.cloud.callFunction({
          name: 'updateOrderStatus',
          data: {
            orderId: this.data.afterSales.orderId,
            operation: 'cancelAfterSales',
            params: {
              caseId: this.data.afterSales._id,
              result: '用户取消售后申请',
              operatorType: 'user'
            }
          }
        });

    request.then((res) => {
      if (!this.data.isLegacy && (!res.result || !res.result.success)) {
        throw new Error(res.result?.error || '取消售后失败');
      }
      wx.hideLoading();
      wx.showToast({ title: '取消成功', icon: 'success' });
      // 设置全局标志，通知订单详情页和订单列表页需要刷新
      getApp().globalData.needRefreshOrderDetail = true;
      getApp().globalData.needRefreshOrderList = true;
      setTimeout(() => wx.navigateBack(), 1200);
    }).catch((err) => {
      wx.hideLoading();
      console.error('取消售后失败', err);
      wx.showToast({ title: err.message || '取消售后失败', icon: 'none' });
    });
  },

  cancelLegacyAfterSales() {
    const afterSales = getCollection('afterSales');
    return afterSales.doc(this.data.afterSales._id).update({
      data: {
        status: 'cancelled',
        updatedAt: new Date()
      }
    }).then(() => getCollection('orders').doc(this.data.afterSales.orderId).update({
      data: {
        status: 'completed',
        afterSalesStatus: 'cancelled',
        updatedAt: new Date(),
        updatedAtTs: Date.now()
      }
    }));
  },

  // 找到第一个待买家收货的明细
  getFirstBuyerReceivingItem() {
    const items = this.data.afterSalesItems || [];
    return items.find(item => item.itemStatus === 'buyer_receiving');
  },

  // 买家确认收到商家寄回的商品
  handleConfirmReturnReceived() {
    const targetItem = this.getFirstBuyerReceivingItem();
    if (!targetItem) {
      wx.showToast({ title: '没有待确认的寄回商品', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认收货',
      content: '确认已收到商家寄回的商品吗？',
      success: (res) => {
        if (res.confirm) {
          this.performConfirmReturnReceived(targetItem._id);
        }
      }
    });
  },

  performConfirmReturnReceived(itemId) {
    wx.showLoading({ title: '确认中...' });
    wx.cloud.callFunction({
      name: 'updateOrderStatus',
      data: {
        orderId: this.data.afterSales.orderId,
        operation: 'processAfterSales',
        params: {
          caseId: this.data.afterSales._id,
          itemId: itemId,
          itemAction: 'confirm_return_received',
          operatorType: 'user',
          result: '买家确认收到寄回商品'
        }
      }
    }).then(res => {
      wx.hideLoading();
      if (!res.result || !res.result.success) {
        throw new Error(res.result?.error || '确认收货失败');
      }
      wx.showToast({ title: '确认成功', icon: 'success' });
      getApp().globalData.needRefreshOrderDetail = true;
      getApp().globalData.needRefreshOrderList = true;
      setTimeout(() => {
        this.fetchAfterSalesDetail(this.caseId);
      }, 800);
    }).catch(err => {
      wx.hideLoading();
      console.error('确认收到寄回商品失败:', err);
      wx.showToast({ title: err.message || '确认收货失败', icon: 'none' });
    });
  },

  // 查看商家寄回物流
  async showSellerReturnLogistics() {
    const sellerReturnLogistics = this.data.afterSales.sellerReturnLogistics || {};
    const { trackingNumber, companyCode, companyName } = sellerReturnLogistics;
    if (!trackingNumber || !companyCode) {
      wx.showToast({ title: '没有寄回物流信息', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '查询物流中...' });

    try {
      console.log('[寄回物流] 调用云函数参数:', {
        action: 'queryReturnLogisticsAndUpdateCase',
        expressNo: trackingNumber,
        companyCode: companyCode,
        caseId: this.data.afterSales._id
      });

      const res = await wx.cloud.callFunction({
        name: 'express100',
        data: {
          action: 'queryReturnLogisticsAndUpdateCase',
          expressNo: trackingNumber,
          companyCode: companyCode,
          caseId: this.data.afterSales._id,
          logisticsType: 'seller_return'
        }
      });
      wx.hideLoading();
      console.log('[寄回物流] 物流查询返回结果:', res);

      if (res.result?.success && res.result.data) {
        const rawLogisticsData = res.result.data;
        const logisticsData = {
          ...res.result,
          data: rawLogisticsData.data || [],
          nu: rawLogisticsData.nu || trackingNumber,
          com: rawLogisticsData.com || companyCode,
          status: rawLogisticsData.status || '',
          state: rawLogisticsData.state || ''
        };

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

        if (logisticsData.data && logisticsData.data.length > 0) {
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
          logisticsModalTitle: '商家寄回物流信息',
          logisticsData: logisticsData,
          logisticsMapData: {
            trackingNumber: trackingNumber,
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
      } else {
        wx.showToast({ title: '查询物流失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('查询寄回物流失败:', err);
      wx.showToast({ title: '查询物流失败', icon: 'none' });
    }
  },

  previewImage(e) {
    const index = e.currentTarget.dataset.index;
    const images = this.data.afterSales.proofImages;
    wx.previewImage({
      current: images[index],
      urls: images
    });
  },

  previewInspectImage(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const evidence = this.data.afterSales.inspectEvidence;
    const images = evidence && Array.isArray(evidence.images) ? evidence.images : [];
    if (images.length > 0) {
      wx.previewImage({
        current: images[index],
        urls: images
      });
    }
  },

  previewInspectVideo() {
    const evidence = this.data.afterSales.inspectEvidence;
    const videos = evidence && Array.isArray(evidence.videos) ? evidence.videos : [];
    if (videos.length > 0) {
      const sources = videos.map(item => ({
        url: item,
        type: 'video'
      }));
      wx.previewMedia({
        sources: sources,
        current: 0,
        showmenu: true,
        fail: (err) => {
          console.error('[售后详情] 验货视频预览失败:', err);
          wx.showToast({ title: '视频预览失败，请稍后重试', icon: 'none' });
        }
      });
    }
  },

  playVideo(e) {
    const index = e.currentTarget.dataset.index;
    const videos = this.data.afterSales.proofVideos;
    if (videos.length > 0) {
      const sources = videos.map(item => ({
        url: item,
        type: 'video'
      }));
      wx.previewMedia({
        sources: sources,
        current: index
      });
    }
  },

  // 生成合并的媒体列表（按上传顺序）
  generateCombinedMediaList(images, videos, thumbs) {
    const combined = [];
    let imageIndex = 0;
    let videoIndex = 0;
    
    while (imageIndex < (images?.length || 0) || videoIndex < (videos?.length || 0)) {
      if (imageIndex < (images?.length || 0)) {
        combined.push({
          path: images[imageIndex],
          type: 'image',
          originalIndex: imageIndex
        });
        imageIndex++;
      }
      if (videoIndex < (videos?.length || 0)) {
        combined.push({
          path: videos[videoIndex],
          type: 'video',
          thumb: thumbs?.[videoIndex] || '',
          originalIndex: videoIndex
        });
        videoIndex++;
      }
    }
    
    return combined;
  },

  // 从合并列表预览图片
  previewImageFromCombined(e) {
    const combinedIndex = e.currentTarget.dataset.index;
    const item = this.data.combinedMediaList[combinedIndex];
    if (item.type === 'image') {
      const images = this.data.combinedMediaList
        .filter(m => m.type === 'image')
        .map(m => m.path);
      const imageIndex = images.indexOf(item.path);
      wx.previewImage({
        current: item.path,
        urls: images
      });
    } else if (item.type === 'video') {
      this.playVideoFromCombined(e);
    }
  },

  // 从合并列表播放视频
  playVideoFromCombined(e) {
    const combinedIndex = e.currentTarget.dataset.index;
    const item = this.data.combinedMediaList[combinedIndex];
    if (item.type === 'video') {
      const videos = this.data.combinedMediaList
        .filter(m => m.type === 'video')
        .map(m => ({ url: m.path, type: 'video' }));
      const videoIndex = this.data.combinedMediaList
        .slice(0, combinedIndex)
        .filter(m => m.type === 'video').length;
      wx.previewMedia({
        sources: videos,
        current: videoIndex
      });
    }
  },

  goBack() {
    wx.navigateBack();
  },

  goToReturnTracking() {
    const afterSales = this.data.afterSales;
    const orderId = afterSales.orderId || this.data.orderId || '';
    const caseId = afterSales._id || '';
    
    let url = `/pages/after-sales/return-tracking/index?orderId=${orderId}&caseId=${caseId}`;
    
    if (afterSales.status === 'waiting_seller_receive' && afterSales.returnLogisticsInfo?.trackingNumber) {
      url += `&trackingNumber=${encodeURIComponent(afterSales.returnLogisticsInfo.trackingNumber)}`;
      url += `&companyCode=${encodeURIComponent(afterSales.returnLogisticsInfo.companyCode)}`;
      url += `&companyName=${encodeURIComponent(afterSales.returnLogisticsInfo.companyName)}`;
    }
    
    wx.navigateTo({ url });
  },

  async getStateMap() {
    try {
      const result = await wx.cloud.callFunction({
        name: 'express100',
        data: {
          action: 'getStateMap'
        }
      });
      if (result.result.success) {
        this.setData({
          logisticsStateMap: result.result.data
        });
      }
    } catch (error) {
      console.error('[售后详情] 获取物流状态映射失败:', error);
    }
  },

  async showReturnLogistics() {
    const returnLogisticsInfo = this.data.afterSales.returnLogisticsInfo || {};
    const { trackingNumber, companyCode, companyName } = returnLogisticsInfo;
    if (!trackingNumber || !companyCode) {
      wx.showToast({ title: '没有退货物流信息', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '查询物流中...' });

    try {
      console.log('[退货物流] 调用云函数参数:', {
        action: 'queryReturnLogisticsAndUpdateCase',
        expressNo: trackingNumber,
        companyCode: companyCode,
        caseId: this.data.afterSales._id
      });
      
      const res = await wx.cloud.callFunction({
        name: 'express100',
        data: {
          action: 'queryReturnLogisticsAndUpdateCase',
          expressNo: trackingNumber,
          companyCode: companyCode,
          caseId: this.data.afterSales._id
        }
      });
      wx.hideLoading();
      console.log('[退货物流] 物流查询返回结果:', res);
      console.log('[退货物流] result完整对象:', JSON.stringify(res.result));
      console.log('[退货物流] 是否命中缓存:', res.result?.fromCache ? '是' : '否');
      
      if (res.result?.success && res.result.data) {
        const rawLogisticsData = res.result.data;
        console.log('[退货物流] 原始物流数据:', rawLogisticsData);
        
        const logisticsData = {
          ...res.result,
          data: rawLogisticsData.data || [],
          nu: rawLogisticsData.nu || trackingNumber,
          com: rawLogisticsData.com || companyCode,
          status: rawLogisticsData.status || '',
          state: rawLogisticsData.state || ''
        };
        
        const state = logisticsData.state || '';
        console.log('[退货物流] state:', state);
        
        const latestTrack = Array.isArray(logisticsData.data) && logisticsData.data.length > 0 ? logisticsData.data[0] : null;
        console.log('[退货物流] latestTrack:', latestTrack);
        
        const fallbackState = (
          logisticsData.stateEx ||
          logisticsData.advancedState ||
          (latestTrack && (latestTrack.statusCode || latestTrack.stateEx)) ||
          ''
        );
        console.log('[退货物流] fallbackState:', fallbackState);
        
        const stateMap = this.data.logisticsStateMap;
        console.log('[退货物流] stateMap:', stateMap);
        
        let stateName = '未知状态';
        let stateMeaning = '';
        let displayStateText = '未知状态';
        
        if (stateMap) {
          console.log('[退货物流] stateMap.advanced:', stateMap.advanced);
          console.log('[退货物流] stateMap.basic:', stateMap.basic);
          
          const matchedState = stateMap.advanced[state] || stateMap.basic[state] || stateMap.advanced[fallbackState] || stateMap.basic[fallbackState] || null;
          console.log('[退货物流] matchedState:', matchedState);
          
          if (matchedState) {
            stateName = matchedState.name || stateName;
            stateMeaning = matchedState.meaning || stateMeaning;
            displayStateText = matchedState.meaning
              ? `【${matchedState.name}】${matchedState.meaning}`
              : matchedState.name;
          }
        }
        
        console.log('[退货物流] stateName:', stateName, 'stateMeaning:', stateMeaning, 'displayStateText:', displayStateText);

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

        if (logisticsData.data && logisticsData.data.length > 0) {
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
          logisticsModalTitle: '退货物流信息',
          logisticsData: logisticsData,
          logisticsMapData: {
            trackingNumber: trackingNumber,
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
      } else {
        wx.showToast({ title: '查询物流失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('查询退货物流失败:', err);
      wx.showToast({ title: '查询物流失败', icon: 'none' });
    }
  },

  closeLogistics() {
    this.setData({ showLogistics: false });
  },

  resetMap() {
    const trackPoints = this.data.logisticsTrackPoints;
    if (trackPoints.length > 0) {
      let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
      trackPoints.forEach(item => {
        minLat = Math.min(minLat, item.latitude);
        maxLat = Math.max(maxLat, item.latitude);
        minLng = Math.min(minLng, item.longitude);
        maxLng = Math.max(maxLng, item.longitude);
      });
      this.setData({
        logisticsMapCenter: {
          latitude: (minLat + maxLat) / 2,
          longitude: (minLng + maxLng) / 2
        },
        logisticsMapScale: 10
      });
    }
  },

  fullScreenMap() {
    wx.showToast({ title: '全屏地图暂未实现', icon: 'none' });
  },

  preventTouchMove() {},

  formatLogisticsInfo(logisticsData) {
    if (!logisticsData || !logisticsData.data) {
      return '暂无物流信息';
    }

    const { data, stateName, companyName, trackingNumber } = logisticsData;
    let info = `快递公司：${companyName || '未知'}\n运单号：${trackingNumber || '未知'}\n当前状态：${stateName || '未知'}\n\n物流轨迹：\n`;

    const tracks = Array.isArray(data) ? data : [];
    tracks.forEach((track, index) => {
      const time = track.time || '';
      const context = track.context || track.status || '';
      info += `${index + 1}. ${time} ${context}\n`;
    });

    return info;
  },

  shouldAutoApproveImmediately() {
    const afterSales = this.data.afterSales;
    const reasonCode = afterSales.reasonCode || '';
    const reasonText = afterSales.reasonText || afterSales.applyReasonText || '';

    if (reasonCode && QUALITY_REASONS.includes(reasonCode)) {
      return false;
    }

    if (reasonText.includes('7天无理由')) {
      return true;
    }

    const items = afterSales.items || [];
    const has7DayReturnSupport = items.some(item => item.productSupports7DayReturn);
    if (has7DayReturnSupport) {
      return true;
    }

    return false;
  },

  startAutoProcessCountdown() {
    this.clearCountdown();

    const afterSales = this.data.afterSales;
    console.log('=== 倒计时调试信息 ===');
    console.log('status:', afterSales.status);
    console.log('autoProcessed:', afterSales.autoProcessed);
    console.log('reasonCode:', afterSales.reasonCode);
    console.log('shouldAutoApproveImmediately:', this.shouldAutoApproveImmediately());
    console.log('createdAt:', afterSales.createdAt);

    if (afterSales.status !== 'submitted' && afterSales.status !== 'pending') {
      console.log('状态不是 submitted 或 pending，不显示倒计时');
      return;
    }

    if (afterSales.autoProcessed) {
      console.log('已自动处理过，不显示倒计时');
      return;
    }

    if (this.shouldAutoApproveImmediately()) {
      console.log('应即时同意，调用即时处理');
      this.handleImmediateApproval();
      return;
    }

    console.log('开始显示倒计时');

    const createdAt = parseDate(afterSales.createdAt);
    if (!createdAt) {
      return;
    }

    const deadline = new Date(createdAt.getTime() + AUTO_PROCESS_TIMEOUT_HOURS * 60 * 60 * 1000);
    
    this.countdownTimer = setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, deadline.getTime() - now);
      const isExpired = remaining <= 0;

      this.setData({
        remainingTime: remaining,
        isExpired: isExpired,
        autoProcessCountdown: this.formatCountdown(remaining)
      });

      if (isExpired && !this.cancelAttempted.has(this.caseId)) {
        this.cancelAttempted.add(this.caseId);
        this.handleAutoProcessTimeout();
      }
    }, 1000);
  },

  handleImmediateApproval() {
    if (this.data.processingExpired) {
      return;
    }

    this.setData({ processingExpired: true });

    wx.showLoading({ title: '处理中...' });

    wx.cloud.callFunction({
      name: 'autoProcessAfterSales',
      data: { caseId: this.caseId }
    }).then(res => {
      wx.hideLoading();
      if (res.result?.success) {
        wx.showToast({ title: '售后申请已自动同意', icon: 'success' });
        setTimeout(() => {
          this.fetchAfterSalesDetail(this.caseId);
        }, 1500);
      }
    }).catch(err => {
      wx.hideLoading();
      console.error('即时处理失败:', err);
      this.setData({ processingExpired: false });
    });
  },

  clearCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  },

  formatCountdown(milliseconds) {
    if (milliseconds <= 0) {
      return '即将自动处理';
    }

    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((milliseconds % (1000 * 60)) / 1000);

    if (hours > 0) {
      return `${hours}小时${minutes}分${seconds}秒后自动处理`;
    } else if (minutes > 0) {
      return `${minutes}分${seconds}秒后自动处理`;
    } else {
      return `${seconds}秒后自动处理`;
    }
  },

  handleAutoProcessTimeout() {
    if (this.data.processingExpired) {
      return;
    }

    this.setData({ processingExpired: true });

    wx.showLoading({ title: '处理中...' });

    wx.cloud.callFunction({
      name: 'autoProcessAfterSales',
      data: { caseId: this.caseId }
    }).then(res => {
      wx.hideLoading();
      if (res.result?.success) {
        wx.showToast({ title: '系统已自动处理', icon: 'success' });
        setTimeout(() => {
          this.fetchAfterSalesDetail(this.caseId);
        }, 1500);
      }
    }).catch(err => {
      wx.hideLoading();
      console.error('自动处理失败:', err);
      this.setData({ processingExpired: false });
    });
  },

  fetchRefundRecord(caseId) {
    if (!caseId) return;

    wx.cloud.callFunction({
      name: 'refund',
      data: {
        action: 'query',
        caseId: caseId
      }
    }).then(res => {
      if (res.result.success && res.result.data && res.result.data.length > 0) {
        const refundRecord = res.result.data[0];
        this.setData({
          'afterSales.refundInfo': {
            ...refundRecord,
            completeTimeText: formatTime(refundRecord.completeTime)
          }
        });
      }
    }).catch(err => {
      console.error('获取退款记录失败:', err);
    });
  },

  fetchOperationLogs(caseId) {
    if (!caseId) return;

    const db = wx.cloud.database();
    db.collection('after_sales_logs')
      .where({ caseId })
      .orderBy('createdAt', 'desc')
      .get()
      .then(res => {
        const actionMap = {
          'create_case': '提交售后申请',
          'approve_refund': '同意退款申请',
          'approve_exchange': '同意换货申请',
          'reject_refund': '拒绝退款申请',
          'reject_exchange': '拒绝换货申请',
          'complete_refund': '完成退款',
          'complete_exchange': '完成换货',
          'complete_case_refund': '完成退款',
          'complete_case_exchange': '完成换货',
          'complete_case_after_sales': '售后完成',
          'cancel_case': '取消申请',
          'start_intercepting': '开始拦截快递',
          'approve_intercepting': '拦截成功',
          'reject_intercepting': '拦截失败',
          'submit_return_tracking': '填写退货单号',
          'modify_return_tracking': '修改退货单号',
          'confirm_receipt_refund': '确认收货',
          'confirm_receipt_exchange': '确认收货',
          'inspect_pass_refund': '验货通过',
          'inspect_pass_exchange': '验货通过',
          'inspect_fail_refund': '验货不通过',
          'inspect_fail_exchange': '验货不通过',
          'fill_return_tracking_refund': '填写寄回单号',
          'fill_return_tracking_exchange': '填写寄回单号',
          'confirm_return_received_refund': '确认收到寄回商品',
          'confirm_return_received_exchange': '确认收到寄回商品',
          'auto_confirm_return_received_refund': '系统自动确认寄回收货',
          'auto_confirm_return_received_exchange': '系统自动确认寄回收货'
        };

        const logs = (res.data || []).map(log => {
          let actionText = '';
          let operatorText = '';

          actionText = actionMap[log.action] || log.action;

          if (log.operatorType === 'admin') {
            operatorText = '管理员';
          } else if (log.operatorType === 'system') {
            operatorText = '系统';
          } else {
            operatorText = '用户';
          }

          let createdAtText = '';
          if (log.createdAt) {
            const date = new Date(log.createdAt);
            if (!isNaN(date.getTime())) {
              const year = date.getFullYear();
              const month = String(date.getMonth() + 1).padStart(2, '0');
              const day = String(date.getDate()).padStart(2, '0');
              const hours = String(date.getHours()).padStart(2, '0');
              const minutes = String(date.getMinutes()).padStart(2, '0');
              createdAtText = `${year}-${month}-${day} ${hours}:${minutes}`;
            }
          }

          return {
            ...log,
            actionText,
            operatorText,
            createdAtText
          };
        });

        this.setData({ operationLogs: logs });
      })
      .catch(err => {
        console.error('获取操作记录失败:', err);
        this.setData({ operationLogs: [] });
      });
  }
});
