// pages/admin/after-sales/detail/index.js
const { getCollection } = require("../../../../utils/cloud");

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
  processing: '处理中',
  rejected: '已拒绝',
  completed: '已完成',
  cancelled: '已取消',
  pending: '待处理',
  approved: '已通过',
  seller_reviewing: '商家验货中',
  seller_returning: '商家寄回中',
  intercepting: '正在拦截快递'
};

const STATUS_DESC_MAP = {
  submitted: '请及时处理该售后申请',
  reviewing: '售后单正在审核中，请继续关注',
  waiting_buyer_return: '已通过审核，等待买家寄回商品',
  waiting_seller_receive: '商品寄回中，请留意物流信息并及时确认收货',
  processing: '售后处理中，请留意后续进度',
  rejected: '售后申请已拒绝',
  completed: '售后申请已完成',
  cancelled: '售后申请已取消',
  pending: '请及时处理该售后申请',
  approved: '售后申请已通过，请继续处理后续流程',
  seller_reviewing: '正在验货，请及时完成验货',
  seller_returning: '正在将商品寄回，请留意物流信息',
  intercepting: '正在拦截快递，请根据拦截结果进行后续处理'
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
  seller_returning: 'status-section__status--processing'
};

const CAN_CANCEL_STATUSES = ['pending', 'submitted', 'reviewing', 'waiting_buyer_return', 'processing', 'approved'];
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
    combinedMediaList: [],
    processing: false,
    showInterceptOptions: false
  },

  onLoad(options) {
    const id = options.id;
    if (id) {
      this.caseId = id;
      this.cancelAttempted = new Set();
      this.fetchAfterSalesDetail(id);
    }
  },

  onUnload() {
    this.clearCountdown();
  },

  fetchAfterSalesDetail(id) {
    wx.showLoading({ title: '加载中...' });

    getCollection('after_sales_cases').doc(id).get()
      .then((res) => {
        if (!res.data) {
          return this.fetchLegacyAfterSalesDetail(id);
        }

        return getCollection('after_sales_case_items').where({ caseId: id }).orderBy('createdAt', 'asc').get()
          .then((itemsRes) => {
            wx.hideLoading();
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
          });
      })
      .catch(() => this.fetchLegacyAfterSalesDetail(id));
  },

  fetchLegacyAfterSalesDetail(id) {
    return getCollection('afterSales').doc(id).get()
      .then((res) => {
        wx.hideLoading();
        if (res.data) {
          this.setData({
            afterSales: this.normalizeLegacyCaseRecord(res.data),
            afterSalesItems: [],
            isLegacy: true,
            combinedMediaList: []
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
      refundAmount: Number(record.totalApplyAmount || 0) || 0,
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
      processInfo: record.processSummary
        ? {
            opinion: record.processSummary.result || '',
            processTimeText: formatTime(record.processSummary.processTime || null)
          }
        : null,
      itemCount: Number(record.itemCount || 0) || 0,
      totalApplyQty: Number(record.totalApplyQty || 0) || 0,
      reasonCode: record.applyReasonCode || record.reasonCode || '',
      shippingResponsibilityText: getShippingResponsibilityText(record.shippingResponsibility || record.shippingResponsibilitySummary || getShippingResponsibilityByReason(record.applyReasonCode || record.reasonCode))
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
      statusText: STATUS_TEXT_MAP[status] || status,
      shippingResponsibilityText: getShippingResponsibilityText(item.shippingResponsibility),
      productSupports7DayReturn: item.productSupports7DayReturn || false,
      canApprove: !['approved', 'completed', 'rejected', 'cancelled'].includes(status),
      canReject: !['rejected', 'completed', 'cancelled'].includes(status)
    };
  },

  canCancelAfterSales() {
    const status = this.data.afterSales.status || this.data.afterSales.caseStatus;
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
        updatedAt: new Date()
      }
    }));
  },

  previewImage(e) {
    const index = e.currentTarget.dataset.index;
    const images = this.data.afterSales.proofImages;
    wx.previewImage({
      current: images[index],
      urls: images
    });
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

    if (afterSales.status !== 'submitted' && afterSales.status !== 'pending') {
      return;
    }

    if (afterSales.autoProcessed) {
      return;
    }

    if (this.shouldAutoApproveImmediately()) {
      this.handleImmediateApproval();
      return;
    }

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

  handleApprove() {
    wx.showModal({
      title: '同意售后申请',
      editable: true,
      placeholderText: '请输入处理意见（选填）',
      success: (res) => {
        if (res.confirm) {
          const opinion = res.content || '';
          this.processAfterSales('approve', opinion);
        }
      }
    });
  },

  handleReject() {
    wx.showModal({
      title: '拒绝售后申请',
      editable: true,
      placeholderText: '请输入拒绝原因（必填）',
      success: (res) => {
        if (res.confirm) {
          const opinion = res.content || '';
          if (!opinion.trim()) {
            wx.showToast({ title: '请输入拒绝原因', icon: 'none' });
            return;
          }
          this.processAfterSales('reject', opinion);
        }
      }
    });
  },

  processAfterSales(action, opinion) {
    if (this.data.processing) return;

    console.log('开始处理售后:', {
      caseId: this.caseId,
      orderId: this.data.afterSales.orderId,
      itemId: this.data.afterSalesItems[0]?._id,
      action: action,
      opinion: opinion
    });

    this.setData({ processing: true });
    wx.showLoading({ title: '处理中...' });

    wx.cloud.callFunction({
      name: 'updateOrderStatus',
      data: {
        operation: 'processAfterSales',  // 修复：用 operation，不是 action
        orderId: this.data.afterSales.orderId,
        params: {  // 修复：所有参数放在 params 对象里
          caseId: this.caseId,
          itemId: this.data.afterSalesItems[0]?._id,
          itemAction: action,
          result: opinion,
          operatorType: 'admin'
        }
      }
    }).then((res) => {
      wx.hideLoading();
      this.setData({ processing: false });
      console.log('云函数返回结果:', res);

      if (res.result?.success) {
        wx.showToast({ title: action === 'approve' ? '同意成功' : '拒绝成功', icon: 'success' });
        setTimeout(() => this.fetchAfterSalesDetail(this.caseId), 1000);
      } else {
        const errorMsg = res.result?.error || res.result?.message || '处理失败';
        console.error('处理失败，错误信息:', errorMsg);
        wx.showToast({ 
          title: errorMsg, 
          icon: 'none',
          duration: 3000
        });
      }
    }).catch((err) => {
      wx.hideLoading();
      this.setData({ processing: false });
      console.error('处理售后异常:', err);
      
      let errorMsg = '处理失败';
      if (err.errMsg) {
        errorMsg = err.errMsg;
      } else if (err.message) {
        errorMsg = err.message;
      }
      
      wx.showToast({ 
        title: errorMsg, 
        icon: 'none',
        duration: 3000
      });
    });
  },

  showInterceptOptions() {
    this.setData({ showInterceptOptions: true });
  },

  hideInterceptOptions() {
    this.setData({ showInterceptOptions: false });
  },

  preventModalClose() {
    // 阻止点击内容区域不关闭
  },

  handleStartIntercepting() {
    if (this.data.processing) return;
    
    const that = this;
    this.setData({ processing: true });
    wx.showLoading({ title: '处理中...' });
    
    wx.cloud.callFunction({
      name: 'updateOrderStatus',
      data: {
        operation: 'startIntercepting',
        orderId: that.data.afterSales.orderId,
        params: {
          caseId: that.caseId,
          itemId: that.data.afterSalesItems[0]?._id,
          operatorType: 'admin'
        }
      }
    }).then((res) => {
      wx.hideLoading();
      that.setData({ processing: false });
      
      if (res.result?.success) {
        wx.showToast({ 
          title: '已开始拦截快递', 
          icon: 'success',
          duration: 2000 
        });
        // 等待提示显示完毕后再刷新页面
        setTimeout(() => {
          that.fetchAfterSalesDetail(that.caseId);
        }, 1500);
      } else {
        const errorMsg = res.result?.error || res.result?.message || '处理失败';
        wx.showToast({ title: errorMsg, icon: 'none', duration: 3000 });
      }
    }).catch((err) => {
      wx.hideLoading();
      that.setData({ processing: false });
      console.error('处理拦截失败:', err);
      let errorMsg = '处理失败';
      if (err.errMsg) {
        errorMsg = err.errMsg;
      } else if (err.message) {
        errorMsg = err.message;
      }
      wx.showToast({ title: errorMsg, icon: 'none', duration: 3000 });
    });
  },

  handleCompleteIntercepting(e) {
    const action = e.currentTarget.dataset.action;
    const reason = e.currentTarget.dataset.reason;
    const that = this;

    const actionText = action === 'approve' ? '同意申请' : '拒绝申请';
    
    wx.showModal({
      title: '确认操作',
      content: `确定要${actionText}吗？\n\n处理原因：${reason}`,
      confirmColor: '#1890ff',
      success: (res) => {
        if (res.confirm) {
          that.hideInterceptOptions();
          wx.showLoading({ title: '处理中...' });
          wx.cloud.callFunction({
            name: 'updateOrderStatus',
            data: {
              operation: 'completeIntercepting',
              orderId: that.data.afterSales.orderId,
              params: {
                caseId: that.caseId,
                itemId: that.data.afterSalesItems[0]?._id,
                finalAction: action,
                result: reason,
                operatorType: 'admin'
              }
            }
          }).then((res) => {
            wx.hideLoading();
            if (res.result?.success) {
              wx.showToast({ title: '处理成功', icon: 'success' });
              that.fetchAfterSalesDetail(that.caseId);
            } else {
              const errorMsg = res.result?.error || res.result?.message || '处理失败';
              wx.showToast({ title: errorMsg, icon: 'none', duration: 3000 });
            }
          }).catch((err) => {
            wx.hideLoading();
            console.error('处理拦截完成失败:', err);
            let errorMsg = '处理失败';
            if (err.errMsg) {
              errorMsg = err.errMsg;
            } else if (err.message) {
              errorMsg = err.message;
            }
            wx.showToast({ title: errorMsg, icon: 'none', duration: 3000 });
          });
        }
      }
    });
  }
});
