// pages/after-sales/apply/index.js
import { getCollection } from "../../../utils/cloud";

const REFUND_TYPES = [
  { value: 'refund_only', label: '退款', desc: '不需要退货，仅退款' },
  { value: 'return_refund', label: '退货退款', desc: '需要退货并退款' }
];

const GOODS_STATUSES = [
  { value: 'not_received', label: '未收到货' },
  { value: 'received', label: '已收到货' }
];

const REFUND_REASONS = {
  not_received: [
    { value: 'wrong_order', label: '拍错/多拍/不喜欢', requireProof: false },
    { value: 'empty_package', label: '空包裹', requireProof: true },
    { value: 'late_delivery', label: '未按约定时间发货', requireProof: false },
    { value: 'lost', label: '快递/物流一直未送到', requireProof: false },
    { value: 'no_tracking', label: '快递/物流无跟踪记录', requireProof: false },
    { value: 'damaged_rejected', label: '商品破损已拒签', requireProof: true }
  ],
  received_refund: [
    { value: 'agreement', label: '协商一致退款', requireProof: false },
    { value: 'size_mismatch', label: '大小/尺寸与商品描述不符', requireProof: true },
    { value: 'color_mismatch', label: '颜色/图案/款式与商品描述不符', requireProof: true },
    { value: 'material_mismatch', label: '材质与商品描述不符', requireProof: true },
    { value: 'fade', label: '商品褪色/掉色/发黑等', requireProof: true },
    { value: 'quality', label: '质量问题(掉钻，掉胶，配件掉落等)', requireProof: true },
    { value: 'missing', label: '少件/漏发', requireProof: true },
    { value: 'damaged', label: '包装/商品破损/污渍', requireProof: true },
    { value: 'late_delivery', label: '未按约定时间发货', requireProof: false },
    { value: 'wrong_item', label: '卖家发错货', requireProof: true }
  ],
  received_return: [
    { value: 'agreement', label: '协商一致退款', requireProof: false },
    { value: 'not_wanted', label: '不想要了', requireProof: false },
    { value: 'fake_brand', label: '假冒品牌', requireProof: false },
    { value: 'invoice_issue', label: '发票问题', requireProof: false },
    { value: 'size_mismatch', label: '大小/尺寸与商品描述不符', requireProof: true },
    { value: 'color_mismatch', label: '颜色/图案/款式与商品描述不符', requireProof: true },
    { value: 'material_mismatch', label: '材质与商品描述不符', requireProof: true },
    { value: 'fade', label: '商品褪色/掉色/发黑等', requireProof: true },
    { value: 'quality', label: '质量问题(掉钻，掉胶，配件掉落等)', requireProof: true },
    { value: 'missing', label: '少件/漏发', requireProof: true },
    { value: 'damaged', label: '包装/商品破损/污渍', requireProof: true },
    { value: 'late_delivery', label: '未按约定时间发货', requireProof: false },
    { value: 'wrong_item', label: '卖家发错货', requireProof: true },
    { value: 'allergic', label: '商品使用后出现过敏/发炎等情况', requireProof: true, imageOptional: true }
  ]
};

function parseFlexibleDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value.replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
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
  return null;
}

function getShippingResponsibility(reasonValue) {
  const sellerReasons = ['size_mismatch', 'color_mismatch', 'material_mismatch', 'fade', 'quality', 'missing', 'damaged', 'wrong_item', 'empty_package', 'damaged_rejected'];
  return sellerReasons.includes(reasonValue) ? 'seller' : 'buyer';
}

function getShippingResponsibilityText(value) {
  return value === 'buyer' ? '买家承担' : '商家承担';
}

Page({
  data: {
    order: {},
    displayOrderNo: '',
    productIndex: -1,
    currentProduct: null,
    
    refundType: '',
    goodsStatus: '',
    reason: '',
    reasonValue: '',
    
    currentReasons: [],
    
    showRefundTypeModal: false,
    showGoodsStatusModal: false,
    showReasonModal: false,
    
    requireProof: false,
    imageOptional: false,
    
    proofImages: [],
    proofVideos: [],
    description: '',
    
    refundAmount: '',
    amountInputWidth: 0,
    maxRefundAmount: 0,
    
    contactName: '',
    contactPhone: '',
    
    shippingResponsibility: 'buyer',
    remainingDays: 0,
    
    showConfirmPage: false,
    step: 1
  },

  onRefundAmountInput(e) {
    const value = e.detail.value;
    this.setData({ refundAmount: value }, () => {
      setTimeout(() => this.updateAmountInputWidth(), 0);
    });
  },

  updateAmountInputWidth() {
    // 动态计算输入框宽度
    const query = wx.createSelectorQuery().in(this);
    query.select('.amount-input__mirror').boundingClientRect(rect => {
      if (rect && rect.width) {
        this.setData({ amountInputWidth: rect.width + 2 }); // 2px buffer
      }
    }).exec();
  },

  onLoad(options) {
    const orderId = options.orderId;
    this.productIndex = Number(options.productIndex) || -1;

    // 如果有传入参数，直接使用这些参数
    if (options.refundType) {
      this.setData({ refundType: options.refundType });
    }
    if (options.goodsStatus) {
      this.setData({ goodsStatus: options.goodsStatus });
    }
    if (options.reason) {
      this.setData({ reasonValue: options.reason });
    }
    if (options.reasonLabel) {
      const reasonLabel = decodeURIComponent(options.reasonLabel);
      this.setData({ reason: reasonLabel });
      
      // 计算运费责任
      const shippingResponsibility = getShippingResponsibility(options.reason);
      this.setData({ shippingResponsibility });
    }
    // 处理needProof参数
    if (options.needProof !== undefined) {
      const needProof = options.needProof === 'true' || options.needProof === true;
      this.setData({ 
        needProof: needProof,
        requireProof: needProof, // 如果需要强制上传凭证，则设为必填
        step: 1 // 从步骤1开始
      });
    }

    if (orderId) {
      this.fetchOrderDetail(orderId);
    }
    // 初始化输入框宽度
    this.setData({ refundAmount: '', }, () => {
      setTimeout(() => this.updateAmountInputWidth(), 0);
    });
  },

  async fetchOrderDetail(orderId) {
    wx.showLoading({ title: '加载中...' });
    try {
      const res = await getCollection('orders').doc(orderId).get();
      if (!res.data) {
        wx.hideLoading();
        wx.showToast({ title: '订单不存在', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1000);
        return;
      }

      const order = res.data;
      let currentProduct = null;
      let maxRefundAmount = 0;
      
      const products = Array.isArray(order.productsList) && order.productsList.length > 0
        ? order.productsList
        : Array.isArray(order.products)
          ? order.products
          : [];

      if (this.productIndex >= 0 && this.productIndex < products.length) {
        currentProduct = products[this.productIndex];
        const price = Number(currentProduct.price || currentProduct.productPrice || 0);
        const quantity = Number(currentProduct.quantity || currentProduct.buyQty || 1);
        maxRefundAmount = price * quantity;
      } else if (products.length === 1) {
        currentProduct = products[0];
        const price = Number(currentProduct.price || currentProduct.productPrice || 0);
        const quantity = Number(currentProduct.quantity || currentProduct.buyQty || 1);
        maxRefundAmount = price * quantity;
      }

      let contactName = '';
      let contactPhone = '';
      
      if (order.contactName) {
        contactName = order.contactName;
      } else if (order.address && order.address.userName) {
        contactName = order.address.userName;
      } else if (order.address && order.address.name) {
        contactName = order.address.name;
      }
      
      if (order.contactPhone) {
        contactPhone = order.contactPhone;
      } else if (order.address && order.address.telNumber) {
        contactPhone = order.address.telNumber;
      } else if (order.address && order.address.phone) {
        contactPhone = order.address.phone;
      }

      const remainingDays = this.calculateRemainingDays(order);

      this.setData({
        order,
        orderProducts: products,
        displayOrderNo: order.orderNumber || order.orderNo || order._id || '',
        currentProduct,
        maxRefundAmount: Math.round(maxRefundAmount * 100) / 100,
        refundAmount: Math.round(maxRefundAmount * 100) / 100,
        contactName,
        contactPhone,
        remainingDays
      });

      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      console.error('获取订单详情失败', err);
      wx.showToast({ title: '获取订单详情失败', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1000);
    }
  },

  calculateRemainingDays(order) {
    const receiptTime = parseFlexibleDate(order.logisticsState?.checkTime) || parseFlexibleDate(order.receiptTime);
    if (!receiptTime) return 7;
    
    const now = new Date();
    const diff = receiptTime.getTime() + 7 * 24 * 60 * 60 * 1000 - now.getTime();
    if (diff <= 0) return 0;
    return Math.floor(diff / (24 * 60 * 60 * 1000));
  },

  showRefundTypeModal() {
    this.setData({ showRefundTypeModal: true });
  },

  closeRefundTypeModal() {
    this.setData({ showRefundTypeModal: false });
  },

  selectRefundType(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({
      refundType: type,
      showRefundTypeModal: false,
      goodsStatus: '',
      reason: '',
      reasonValue: '',
      currentReasons: [],
      step: 2
    });
  },

  showGoodsStatusModal() {
    if (!this.data.refundType) {
      wx.showToast({ title: '请先选择退款类型', icon: 'none' });
      return;
    }
    this.setData({ showGoodsStatusModal: true });
  },

  closeGoodsStatusModal() {
    this.setData({ showGoodsStatusModal: false });
  },

  selectGoodsStatus(e) {
    const status = e.currentTarget.dataset.status;
    let reasons = [];
    
    if (status === 'not_received') {
      reasons = REFUND_REASONS.not_received;
    } else if (this.data.refundType === 'refund_only') {
      reasons = REFUND_REASONS.received_refund;
    } else {
      reasons = REFUND_REASONS.received_return;
    }

    this.setData({
      goodsStatus: status,
      showGoodsStatusModal: false,
      reason: '',
      reasonValue: '',
      currentReasons: reasons,
      step: 3
    });
  },

  showReasonModal() {
    if (!this.data.goodsStatus) {
      wx.showToast({ title: '请先选择货物状态', icon: 'none' });
      return;
    }
    this.setData({ showReasonModal: true });
  },

  closeReasonModal() {
    this.setData({ showReasonModal: false });
  },

  selectReason(e) {
    const reasonItem = e.currentTarget.dataset.reason;
    const parsedReason = JSON.parse(reasonItem);
    
    const shippingResponsibility = getShippingResponsibility(parsedReason.value);

    this.setData({
      reason: parsedReason.label,
      reasonValue: parsedReason.value,
      showReasonModal: false,
      requireProof: parsedReason.requireProof && !parsedReason.imageOptional,
      imageOptional: !!parsedReason.imageOptional,
      shippingResponsibility,
      proofImages: [],
      proofVideos: [],
      description: ''
    });

    if (parsedReason.requireProof) {
      this.setData({ step: 4 });
    } else {
      this.setData({ step: 5 });
    }
  },

  chooseImage() {
    wx.chooseImage({
      count: 9 - this.data.proofImages.length,
      sizeType: ['original', 'compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({
          proofImages: [...this.data.proofImages, ...res.tempFilePaths]
        });
      }
    });
  },

  deleteImage(e) {
    const index = e.currentTarget.dataset.index;
    const proofImages = [...this.data.proofImages];
    proofImages.splice(index, 1);
    this.setData({ proofImages });
  },

  chooseVideo() {
    if (this.data.proofVideos.length >= 1) {
      wx.showToast({ title: '最多上传1个视频', icon: 'none' });
      return;
    }

    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album', 'camera'],
      maxDuration: 60,
      success: (res) => {
        const files = Array.isArray(res.tempFiles) ? res.tempFiles : [];
        if (files.length) {
          this.setData({
            proofVideos: [files[0].tempFilePath]
          });
        }
      }
    });
  },

  deleteVideo(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const proofVideos = [...this.data.proofVideos];
    proofVideos.splice(index, 1);
    this.setData({ proofVideos });
  },

  onDescriptionInput(e) {
    this.setData({ description: e.detail.value });
  },

  onRefundAmountInput(e) {
    const value = parseFloat(e.detail.value) || 0;
    const max = this.data.maxRefundAmount;
    const finalValue = Math.min(max, Math.max(0.01, value));
    this.setData({ refundAmount: Math.round(finalValue * 100) / 100 });
  },

  onContactNameChange(e) {
    this.setData({ contactName: e.detail.value });
  },

  onContactPhoneChange(e) {
    this.setData({ contactPhone: e.detail.value });
  },

  nextStep() {
    if (this.data.step === 4) {
      if (this.data.requireProof && this.data.proofImages.length === 0) {
        wx.showToast({ title: '请上传图片凭证', icon: 'none' });
        return;
      }
      if (this.data.requireProof && !this.data.description) {
        wx.showToast({ title: '请填写描述说明', icon: 'none' });
        return;
      }
      this.setData({ step: 5 });
    }
  },

  prevStep() {
    if (this.data.step === 2) {
      this.setData({ step: 1 });
    } else if (this.data.step === 3) {
      this.setData({ step: 2 });
    } else if (this.data.step === 4) {
      this.setData({ step: 3 });
    } else if (this.data.step === 5) {
      if (this.data.requireProof) {
        this.setData({ step: 4 });
      } else {
        this.setData({ step: 3 });
      }
    }
  },

  submitAfterSales() {
    const { reason, reasonValue, refundAmount, contactName, contactPhone, requireProof, proofImages, proofVideos, description } = this.data;

    if (!reason) {
      wx.showToast({ title: '请选择售后原因', icon: 'none' });
      return;
    }

    if (refundAmount <= 0) {
      wx.showToast({ title: '请填写退款金额', icon: 'none' });
      return;
    }

    if (!contactName) {
      wx.showToast({ title: '请输入联系人', icon: 'none' });
      return;
    }

    if (!contactPhone) {
      wx.showToast({ title: '请输入联系电话', icon: 'none' });
      return;
    }

    if (requireProof && proofImages.length === 0) {
      wx.showToast({ title: '请上传图片凭证', icon: 'none' });
      return;
    }

    if (requireProof && !description) {
      wx.showToast({ title: '请填写描述说明', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '提交中...' });

    // 先处理视频，生成缩略图
    this.processVideosWithThumbs(proofVideos)
      .then(({ uploadedVideos, uploadedThumbs }) => {
        // 上传图片
        const imageUploadPromises = proofImages.map((image, index) => wx.cloud.uploadFile({
          cloudPath: `after-sales/images/${Date.now()}_${index}.png`,
          filePath: image
        }));
        
        return Promise.all(imageUploadPromises).then((imageResults) => {
          const imageUrls = imageResults.map((res) => res.fileID);
          return { imageUrls, uploadedVideos, uploadedThumbs };
        });
      })
      .then(({ imageUrls, uploadedVideos, uploadedThumbs }) => {
        return wx.cloud.callFunction({
          name: 'afterSales',
          data: {
            action: 'create',
            data: {
              orderId: this.data.order._id,
              type: this.data.refundType === 'return_refund' ? 'return' : 'refund',
              refundType: this.data.refundType,
              goodsStatus: this.data.goodsStatus,
              reason: reasonValue,
              reasonLabel: reason,
              amount: refundAmount,
              proofImages: imageUrls,
              proofVideos: uploadedVideos,
              proofVideoThumbs: uploadedThumbs,
              description,
              contactName,
              contactPhone,
              productIndex: this.productIndex
            }
          }
        });
      })
      .then((updateRes) => {
        console.log('=== 提交售后申请响应 ===');
        console.log('updateRes:', JSON.stringify(updateRes));
        
        if (!updateRes.result) {
          console.error('云函数返回结果为空');
          throw new Error('服务器无响应，请稍后重试');
        }
        
        console.log('success:', updateRes.result.success);
        console.log('error:', updateRes.result.error);
        
        if (!updateRes.result.success) {
          throw new Error(updateRes.result.error || '提交售后申请失败');
        }

        const caseId = updateRes.result.data?.caseId || updateRes.result.caseId;
        console.log('caseId:', caseId);
        
        wx.hideLoading();
        wx.showToast({ title: '售后申请提交成功', icon: 'success' });
        setTimeout(() => {
          if (caseId) {
            wx.navigateTo({ url: `/pages/after-sales/detail/index?id=${caseId}` });
          } else {
            wx.navigateTo({ url: '/pages/after-sales/list/index' });
          }
        }, 1500);
      })
      .catch((err) => {
        wx.hideLoading();
        console.error('=== 提交售后申请失败 ===');
        console.error('err:', err);
        console.error('err.message:', err.message);
        console.error('err.stack:', err.stack);
        wx.showToast({ title: err.message || '提交售后申请失败', icon: 'none' });
      });
  },

  async processVideosWithThumbs(videos) {
    const uploadedVideos = [];
    const uploadedThumbs = [];
    
    for (let i = 0; i < videos.length; i++) {
      const videoPath = videos[i];
      
      // 上传视频
      const videoRes = await wx.cloud.uploadFile({
        cloudPath: `after-sales/videos/${Date.now()}_${i}.mp4`,
        filePath: videoPath
      });
      uploadedVideos.push(videoRes.fileID);
      
      // 生成并上传缩略图
      const thumbPath = await this.generateVideoThumbnail(videoPath, i);
      if (thumbPath) {
        const thumbRes = await wx.cloud.uploadFile({
          cloudPath: `after-sales/thumbs/${Date.now()}_${i}.png`,
          filePath: thumbPath
        });
        uploadedThumbs.push(thumbRes.fileID);
      } else {
        uploadedThumbs.push('');
      }
    }
    
    return { uploadedVideos, uploadedThumbs };
  },

  generateVideoThumbnail(videoPath, index) {
    return new Promise((resolve) => {
      wx.compressVideo({
        src: videoPath,
        quality: 'low',
        success: (res) => {
          // 使用压缩后的视频第一帧作为缩略图
          // 通过拼接URL参数获取第一帧
          const thumbUrl = `${res.tempFilePath}?vframe/jpg/offset/0/w/400/h/400`;
          resolve(res.tempFilePath);
        },
        fail: () => {
          // 如果压缩失败，尝试使用原视频的第一帧
          const thumbUrl = `${videoPath}?vframe/jpg/offset/0/w/400/h/400`;
          resolve(videoPath);
        }
      });
    });
  },

  goBack() {
    wx.navigateBack();
  }
});