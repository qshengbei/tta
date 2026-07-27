// pages/admin/after-sales/detail/index.js
import { getCollection } from "../../../../utils/cloud";

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
  seller_received: '商家验货中',
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
  submitted: '请及时处理该售后申请',
  reviewing: '售后单正在审核中，请继续关注',
  waiting_buyer_return: '已通过审核，等待买家寄回商品',
  waiting_seller_receive: '商品寄回中，请留意物流信息并及时确认收货',
  pending_refund: '待退款，请留意退款进度',
  rejected: '售后申请已拒绝',
  completed: '售后申请已完成',
  cancelled: '售后申请已取消',
  pending: '请及时处理该售后申请',
  approved: '售后申请已通过，请继续处理后续流程',
  seller_reviewing: '正在验货，请及时完成验货',
  seller_returning: '正在将商品寄回，请留意物流信息',
  buyer_receiving: '商品已寄回，等待买家确认收货',
  intercepting: '正在拦截快递，请根据拦截结果进行后续处理'
};

const STATUS_CLASS_MAP = {
  submitted: 'status-section__status--pending',
  reviewing: 'status-section__status--pending',
  waiting_buyer_return: 'status-section__status--pending',
  waiting_seller_receive: 'status-section__status--pending',
  pending_refund: 'status-section__status--approved',
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

const CAN_CANCEL_STATUSES = ['pending', 'submitted', 'reviewing', 'waiting_buyer_return', 'pending_refund', 'approved'];
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
    showInterceptOptions: false,
    showLogistics: false,
    logisticsData: null,
    logisticsMapData: null,
    logisticsModalTitle: '',
    showInspectFailModal: false,
    inspectFailReason: '',
    inspectImages: [],
    inspectVideos: [],
    inspectVideoThumbs: [],
    operationLogs: []
  },

  onLoad(options) {
    const id = options.id;
    const itemId = options.itemId;
    if (id) {
      this.caseId = id;
      this.itemId = itemId;
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

        console.log('[管理员售后详情] 数据库原始记录 proofImages:', res.data.proofImages);
        console.log('[管理员售后详情] 数据库原始记录 proofVideos:', res.data.proofVideos);
        console.log('[管理员售后详情] 数据库原始记录 proofVideoThumbs:', res.data.proofVideoThumbs);

        return getCollection('after_sales_case_items').where({ caseId: id }).orderBy('createdAt', 'asc').get()
          .then(async (itemsRes) => {
            wx.hideLoading();
            const items = (itemsRes.data || []).map((item) => this.normalizeCaseItem(item));
            
            console.log('[管理员售后详情] 所有明细:', items.map(item => ({ _id: item._id, itemStatus: item.itemStatus })));
            
            let selectedItems = items;
            if (this.itemId) {
              selectedItems = items.filter(item => item._id === this.itemId);
              console.log('[管理员售后详情] 筛选后明细:', selectedItems.map(item => ({ _id: item._id, itemStatus: item.itemStatus })));
            }
            
            console.log('[管理员售后详情] 案件状态:', this.normalizeCaseRecord(res.data).status);
            console.log('[管理员售后详情] itemId:', this.itemId);
            
            const afterSalesRecord = this.normalizeCaseRecord(res.data);
            console.log('[管理员售后详情] 完整案件数据:', afterSalesRecord);
            
            const totalItemAmount = selectedItems.reduce((sum, item) => sum + (item.unitPrice * item.applyQty), 0);
            const afterSales = {
              ...this.normalizeCaseRecord(res.data),
              items: selectedItems,
              totalItemAmount: totalItemAmount
            };

            console.log('[管理员售后详情] normalizeCaseRecord后 proofImages:', afterSales.proofImages);

            await this._convertCloudUrls(afterSales);

            console.log('[管理员售后详情] _convertCloudUrls后 proofImages:', afterSales.proofImages);

            const combinedMediaList = this.generateCombinedMediaList(afterSales.proofImages, afterSales.proofVideos, afterSales.proofVideoThumbs);
            console.log('[管理员售后详情] combinedMediaList:', combinedMediaList);

            this.setData({
              afterSales: afterSales,
              afterSalesItems: items,
              isLegacy: false,
              combinedMediaList: combinedMediaList
            });
            console.log('[管理员售后详情] setData完成，combinedMediaList长度:', combinedMediaList.length);
            this.startAutoProcessCountdown();
            this.fetchOperationLogs(id);
          });
      })
      .catch(() => this.fetchLegacyAfterSalesDetail(id));
  },

  async _convertCloudUrls(afterSales) {
    // 真机环境支持直接显示 cloud:// 格式图片，无需转换
    const systemInfo = wx.getSystemInfoSync();
    console.log('[管理员售后详情] 当前平台:', systemInfo.platform);
    if (systemInfo.platform !== 'devtools') {
      console.log('[管理员售后详情] 真机环境，跳过转换');
      return;
    }

    // 开发者工具中 cloud:// 格式图片无法直接显示，需要转换为临时 https URL
    const cloudUrls = [];

    if (Array.isArray(afterSales.proofImages)) {
      afterSales.proofImages.forEach(url => {
        if (url && url.startsWith('cloud://')) {
          cloudUrls.push(url);
        }
      });
    }

    if (Array.isArray(afterSales.proofVideos)) {
      afterSales.proofVideos.forEach(url => {
        if (url && url.startsWith('cloud://')) {
          cloudUrls.push(url);
        }
      });
    }

    if (Array.isArray(afterSales.proofVideoThumbs)) {
      afterSales.proofVideoThumbs.forEach(url => {
        if (url && url.startsWith('cloud://')) {
          cloudUrls.push(url);
        }
      });
    }

    // 验货凭证（验货不通过时上传的图片/视频）
    if (afterSales.inspectEvidence && typeof afterSales.inspectEvidence === 'object') {
      if (Array.isArray(afterSales.inspectEvidence.images)) {
        afterSales.inspectEvidence.images.forEach(url => {
          if (url && url.startsWith('cloud://')) {
            cloudUrls.push(url);
          }
        });
      }
      if (Array.isArray(afterSales.inspectEvidence.videos)) {
        afterSales.inspectEvidence.videos.forEach(url => {
          if (url && url.startsWith('cloud://')) {
            cloudUrls.push(url);
          }
        });
      }
      if (Array.isArray(afterSales.inspectEvidence.videoThumbs)) {
        afterSales.inspectEvidence.videoThumbs.forEach(url => {
          if (url && url.startsWith('cloud://')) {
            cloudUrls.push(url);
          }
        });
      }
    }

    console.log('[管理员售后详情] 需要转换的 cloud:// URL:', cloudUrls);

    if (cloudUrls.length === 0) {
      console.log('[管理员售后详情] 没有需要转换的 cloud:// URL，proofImages:', afterSales.proofImages);
      return;
    }

    console.log(`[管理员售后详情] 开发者工具环境，开始转换 ${cloudUrls.length} 个 cloud:// URL`);

    try {
      const res = await wx.cloud.getTempFileURL({ fileList: cloudUrls });
      console.log('[管理员售后详情] getTempFileURL 返回:', res);

      const urlMap = {};
      (res.fileList || []).forEach(item => {
        console.log('[管理员售后详情] fileList项:', item);
        if (item.tempFileURL) {
          urlMap[item.fileID] = item.tempFileURL;
          // 同时存储带 cloud:// 前缀和不带前缀的两种格式，兼容返回值差异
          const withPrefix = item.fileID.startsWith('cloud://') ? item.fileID : 'cloud://' + item.fileID;
          urlMap[withPrefix] = item.tempFileURL;
          console.log(`[管理员售后详情] 映射成功: ${item.fileID} -> ${item.tempFileURL}`);
        } else {
          console.warn(`[管理员售后详情] 映射失败，fileID: ${item.fileID}, errMsg: ${item.errMsg}, status: ${item.status}`);
        }
      });

      const getMappedUrl = (url) => {
        if (!url) return url;
        const mapped = urlMap[url];
        if (mapped) {
          console.log(`[管理员售后详情] URL转换成功: ${url} -> ${mapped}`);
          return mapped;
        }
        console.warn(`[管理员售后详情] URL转换失败，未找到映射: ${url}`);
        return url;
      };

      if (Array.isArray(afterSales.proofImages)) {
        afterSales.proofImages = afterSales.proofImages.map(getMappedUrl);
      }
      if (Array.isArray(afterSales.proofVideos)) {
        afterSales.proofVideos = afterSales.proofVideos.map(getMappedUrl);
      }
      if (Array.isArray(afterSales.proofVideoThumbs)) {
        afterSales.proofVideoThumbs = afterSales.proofVideoThumbs.map(getMappedUrl);
      }

      // 验货凭证 URL 转换
      if (afterSales.inspectEvidence && typeof afterSales.inspectEvidence === 'object') {
        if (Array.isArray(afterSales.inspectEvidence.images)) {
          afterSales.inspectEvidence.images = afterSales.inspectEvidence.images.map(getMappedUrl);
        }
        if (Array.isArray(afterSales.inspectEvidence.videos)) {
          afterSales.inspectEvidence.videos = afterSales.inspectEvidence.videos.map(getMappedUrl);
        }
        if (Array.isArray(afterSales.inspectEvidence.videoThumbs)) {
          afterSales.inspectEvidence.videoThumbs = afterSales.inspectEvidence.videoThumbs.map(getMappedUrl);
        }
      }

      console.log('[管理员售后详情] 转换完成，最终proofImages:', afterSales.proofImages);
    } catch (error) {
      console.error('[管理员售后详情] 转换 cloud:// URL 失败:', error);
    }
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
    const isNotReceivedRefund = type === 'refund_not_received' || type === 'not_received_refund' || record.goodsStatus === 'not_received';
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
      isNotReceivedRefund: isNotReceivedRefund,
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
      itemStatus: status,
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
        updatedAt: new Date(),
        updatedAtTs: Date.now()
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

  previewInspectEvidenceImage(e) {
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

  previewInspectEvidenceVideo() {
    const evidence = this.data.afterSales.inspectEvidence;
    const videos = evidence && Array.isArray(evidence.videos) ? evidence.videos : [];
    if (videos.length > 0) {
      wx.previewMedia({
        sources: videos.map(item => ({ url: item, type: 'video' })),
        current: 0,
        showmenu: true,
        fail: (err) => {
          console.error('[管理员售后详情] 验货视频预览失败:', err);
          wx.showToast({ title: '视频预览失败，请稍后重试', icon: 'none' });
        }
      });
    }
  },

  goBack() {
    wx.navigateBack();
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

        this.setData({
          logisticsData: logisticsData,
          logisticsMapData: {
            companyName: companyName,
            trackingNumber: trackingNumber
          },
          logisticsModalTitle: '退货物流信息',
          showLogistics: true
        });
      } else {
        wx.showToast({ title: '查询物流失败', icon: 'none' });
      }
    } catch (error) {
      wx.hideLoading();
      console.error('查询退货物流失败:', error);
      wx.showToast({ title: '查询物流失败', icon: 'none' });
    }
  },

  closeLogistics() {
    this.setData({ showLogistics: false });
  },

  // 查看商家寄回物流（管理员端）
  async showSellerReturnLogistics() {
    const sellerReturnLogistics = this.data.afterSales.sellerReturnLogistics || {};
    const { trackingNumber, companyCode, companyName } = sellerReturnLogistics;

    if (!trackingNumber || !companyCode) {
      wx.showToast({ title: '没有寄回物流信息', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '查询物流中...' });

    try {
      console.log('[寄回物流-管理员] 调用云函数参数:', {
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
      console.log('[寄回物流-管理员] 物流查询返回结果:', res);

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

        this.setData({
          logisticsData: logisticsData,
          logisticsMapData: {
            companyName: companyName,
            trackingNumber: trackingNumber
          },
          logisticsModalTitle: '商家寄回物流信息',
          showLogistics: true
        });
      } else {
        wx.showToast({ title: '查询物流失败', icon: 'none' });
      }
    } catch (error) {
      wx.hideLoading();
      console.error('查询寄回物流失败:', error);
      wx.showToast({ title: '查询物流失败', icon: 'none' });
    }
  },

  preventTouchMove() {
    // 阻止弹窗滚动穿透
  },

  handleConfirmReceipt(e) {
    const itemId = e.currentTarget.dataset.itemId;
    wx.showModal({
      title: '确认收货',
      content: '确认已收到买家退回的商品？确认后将进入验货环节。',
      confirmColor: '#1890ff',
      success: (res) => {
        if (res.confirm) {
          this.processAfterSales('confirm_receipt', '确认收货', {}, itemId);
        }
      }
    });
  },

  goToFillReturnTracking(e) {
    const itemId = e.currentTarget.dataset.itemId || '';
    wx.navigateTo({
      url: `/pages/admin/after-sales/return-tracking/index?caseId=${this.caseId}&itemId=${itemId}&orderId=${this.data.afterSales.orderId}`
    });
  },

  handleInspectPass() {
    wx.showModal({
      title: '验货通过',
      content: '确认商品完好，同意退款？',
      confirmColor: '#52c41a',
      success: (res) => {
        if (res.confirm) {
          this.processAfterSales('inspect_pass', '验货通过');
        }
      }
    });
  },

  handleInspectFail() {
    this.setData({
      showInspectFailModal: true,
      inspectFailReason: '',
      inspectImages: [],
      inspectVideos: [],
      inspectVideoThumbs: []
    });
  },

  hideInspectFailModal() {
    this.setData({ showInspectFailModal: false });
  },

  onInspectFailReasonInput(e) {
    this.setData({ inspectFailReason: e.detail.value });
  },

  chooseInspectImages() {
    const remaining = 9 - this.data.inspectImages.length;
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const files = Array.isArray(res.tempFiles) ? res.tempFiles : [];
        const newImages = files.map(file => file.tempFilePath);
        this.setData({
          inspectImages: [...this.data.inspectImages, ...newImages]
        });
      }
    });
  },

  deleteInspectImage(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const inspectImages = [...this.data.inspectImages];
    inspectImages.splice(index, 1);
    this.setData({ inspectImages });
  },

  previewInspectImage(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    wx.previewImage({
      current: this.data.inspectImages[index],
      urls: this.data.inspectImages
    });
  },

  chooseInspectVideo() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album', 'camera'],
      maxDuration: 60,
      success: (res) => {
        const files = Array.isArray(res.tempFiles) ? res.tempFiles : [];
        if (files.length) {
          const file = files[0];
          console.log('[验货视频] 选择视频:', {
            tempFilePath: file.tempFilePath,
            thumbTempFilePath: file.thumbTempFilePath,
            size: file.size,
            duration: file.duration
          });
          this.setData({
            inspectVideos: [file.tempFilePath],
            inspectVideoThumbs: [file.thumbTempFilePath || '']
          });
        }
      },
      fail: (err) => {
        console.error('[验货视频] 选择失败:', err);
      }
    });
  },

  deleteInspectVideo(e) {
    this.setData({
      inspectVideos: [],
      inspectVideoThumbs: []
    });
  },

  previewInspectVideo() {
    const videoSrc = this.data.inspectVideos[0];
    if (!videoSrc) {
      wx.showToast({ title: '视频不存在', icon: 'none' });
      return;
    }

    // 使用 wx.previewMedia 全屏预览视频
    wx.previewMedia({
      sources: [{
        url: videoSrc,
        type: 'video'
      }],
      current: 0,
      showmenu: true,
      fail: (err) => {
        console.error('[验货视频] 全屏预览失败:', err);
        // 降级方案：提示用户长按视频保存后查看
        wx.showToast({ title: '视频预览失败，请稍后重试', icon: 'none' });
      }
    });
  },

  async submitInspectFail() {
    const { inspectFailReason, inspectImages, inspectVideos } = this.data;
    
    if (!inspectFailReason.trim()) {
      wx.showToast({ title: '请输入验货不通过的原因', icon: 'none' });
      return;
    }
    
    if (inspectImages.length === 0 && inspectVideos.length === 0) {
      wx.showToast({ title: '请至少上传一张图片或一个视频作为凭证', icon: 'none' });
      return;
    }
    
    wx.showLoading({ title: '提交中...' });
    
    try {
      let uploadedImages = [];
      let uploadedVideos = [];
      let uploadedThumbs = [];
      
      if (inspectImages.length > 0) {
        const imageUploadPromises = inspectImages.map((image, index) => wx.cloud.uploadFile({
          cloudPath: `after-sales/inspect/images/${Date.now()}_${index}.png`,
          filePath: image
        }));
        const imageResults = await Promise.all(imageUploadPromises);
        uploadedImages = imageResults.map(res => res.fileID);
      }
      
      if (inspectVideos.length > 0) {
        const videoRes = await wx.cloud.uploadFile({
          cloudPath: `after-sales/inspect/videos/${Date.now()}.mp4`,
          filePath: inspectVideos[0]
        });
        uploadedVideos.push(videoRes.fileID);
        
        if (this.data.inspectVideoThumbs[0]) {
          const thumbRes = await wx.cloud.uploadFile({
            cloudPath: `after-sales/inspect/thumbs/${Date.now()}.png`,
            filePath: this.data.inspectVideoThumbs[0]
          });
          uploadedThumbs.push(thumbRes.fileID);
        } else {
          uploadedThumbs.push('');
        }
      }
      
      this.setData({
        inspectImages: uploadedImages,
        inspectVideos: uploadedVideos,
        inspectVideoThumbs: uploadedThumbs
      });
      
      this.processAfterSales('inspect_fail', inspectFailReason, {
        images: uploadedImages,
        videos: uploadedVideos,
        thumbs: uploadedThumbs
      });
      
      this.hideInspectFailModal();
      wx.hideLoading();
    } catch (error) {
      wx.hideLoading();
      console.error('提交验货不通过失败:', error);
      wx.showToast({ title: '提交失败，请重试', icon: 'none' });
    }
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

  processAfterSales(action, opinion, inspectEvidence = {}, itemId = null) {
    if (this.data.processing) return;

    const targetItemId = itemId || this.data.afterSalesItems[0]?._id;

    console.log('开始处理售后:', {
      caseId: this.caseId,
      orderId: this.data.afterSales.orderId,
      itemId: targetItemId,
      action: action,
      opinion: opinion,
      inspectEvidence: inspectEvidence
    });

    this.setData({ processing: true });
    wx.showLoading({ title: '处理中...' });

    // 构造云函数参数
    const params = {
      caseId: this.caseId,
      itemId: targetItemId,
      itemAction: action,
      result: opinion,
      operatorType: 'admin',
      inspectImages: inspectEvidence.images || [],
      inspectVideos: inspectEvidence.videos || [],
      inspectVideoThumbs: inspectEvidence.thumbs || []
    };

    // 寄回物流信息
    if (inspectEvidence.trackingNumber) {
      params.trackingNumber = inspectEvidence.trackingNumber;
      params.companyCode = inspectEvidence.companyCode || '';
      params.companyName = inspectEvidence.companyName || '';
    }

    wx.cloud.callFunction({
      name: 'updateOrderStatus',
      data: {
        operation: 'processAfterSales',
        orderId: this.data.afterSales.orderId,
        params: params
      }
    }).then((res) => {
      wx.hideLoading();
      this.setData({ processing: false });
      console.log('云函数返回结果:', res);

      if (res.result?.success) {
        const successMsg = action === 'approve' ? '同意成功'
          : action === 'reject' ? '拒绝成功'
          : '处理成功';
        wx.showToast({ title: successMsg, icon: 'success' });
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
        console.error('[管理员售后详情] 获取操作记录失败:', err);
        this.setData({ operationLogs: [] });
      });
  }
});
