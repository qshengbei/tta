// pages/after-sales/exchange/index.js
import { getCollection } from "../../../utils/cloud";

const EXCHANGE_REASONS = [
  { value: 'wrong_order', label: '拍错/不喜欢/不合适' },
  { value: 'quality', label: '质量问题（掉钻，掉胶，配件掉落等）' },
  { value: 'wrong_item', label: '卖家发错货' },
  { value: 'no_reason', label: '7天无理由换货' }
];

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

Page({
  data: {
    order: {},
    displayOrderNo: '',
    productIndex: -1,
    currentProduct: null,
    
    exchangeReason: '',
    exchangeReasonValue: '',
    showReasonModal: false,
    
    newProductSpec: '',
    showProductSelectModal: false,
    
    contactName: '',
    contactPhone: '',
    address: '',
    
    description: '',
    proofImages: [],
    
    remainingDays: 0
  },

  onLoad(options) {
    const orderId = options.orderId;
    this.productIndex = Number(options.productIndex) || -1;

    // 如果有传入参数，直接使用这些参数
    if (options.reason) {
      this.setData({ reasonValue: options.reason });
    }
    if (options.reasonLabel) {
      const reasonLabel = decodeURIComponent(options.reasonLabel);
      this.setData({ reason: reasonLabel });
    }

    if (orderId) {
      this.fetchOrderDetail(orderId);
    }
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
      
      const products = Array.isArray(order.productsList) && order.productsList.length > 0
        ? order.productsList
        : Array.isArray(order.products)
          ? order.products
          : [];

      if (this.productIndex >= 0 && this.productIndex < products.length) {
        currentProduct = products[this.productIndex];
      } else if (products.length === 1) {
        currentProduct = products[0];
      }

      let contactName = '';
      let contactPhone = '';
      let address = '';
      
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

      if (order.address) {
        const addr = order.address;
        address = [addr.provinceName, addr.cityName, addr.countyName, addr.detailInfo].filter(Boolean).join('');
      }

      const remainingDays = this.calculateRemainingDays(order);

      this.setData({
        order,
        displayOrderNo: order.orderNumber || order.orderNo || order._id || '',
        currentProduct,
        contactName,
        contactPhone,
        address,
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

  showReasonModal() {
    this.setData({ showReasonModal: true });
  },

  closeReasonModal() {
    this.setData({ showReasonModal: false });
  },

  selectReason(e) {
    const reasonItem = e.currentTarget.dataset.reason;
    const parsedReason = JSON.parse(reasonItem);
    
    this.setData({
      exchangeReason: parsedReason.label,
      exchangeReasonValue: parsedReason.value,
      showReasonModal: false
    });
  },

  showProductSelectModal() {
    if (!this.data.exchangeReason) {
      wx.showToast({ title: '请先选择换货原因', icon: 'none' });
      return;
    }
    this.setData({ showProductSelectModal: true });
  },

  closeProductSelectModal() {
    this.setData({ showProductSelectModal: false });
  },

  selectProductSpec(e) {
    const spec = e.currentTarget.dataset.spec;
    this.setData({
      newProductSpec: spec,
      showProductSelectModal: false
    });
  },

  onDescriptionInput(e) {
    this.setData({ description: e.detail.value });
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

  onContactNameChange(e) {
    this.setData({ contactName: e.detail.value });
  },

  onContactPhoneChange(e) {
    this.setData({ contactPhone: e.detail.value });
  },

  copyAddress() {
    wx.setClipboardData({
      data: this.data.address,
      success: () => {
        wx.showToast({ title: '复制成功', icon: 'success' });
      }
    });
  },

  submitExchange() {
    const { exchangeReason, newProductSpec, contactName, contactPhone } = this.data;

    if (!exchangeReason) {
      wx.showToast({ title: '请选择换货原因', icon: 'none' });
      return;
    }

    if (!newProductSpec) {
      wx.showToast({ title: '请选择换新商品规格', icon: 'none' });
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

    wx.showLoading({ title: '提交中...' });

    const imageUploadPromises = this.data.proofImages.map((image, index) => wx.cloud.uploadFile({
      cloudPath: `after-sales/${Date.now()}_${index}.png`,
      filePath: image
    }));

    Promise.all(imageUploadPromises)
      .then((uploadRes) => {
        const imageUrls = uploadRes.map((res) => res.fileID);
        return wx.cloud.callFunction({
          name: 'updateOrderStatus',
          data: {
            orderId: this.data.order._id,
            operation: 'applyAfterSales',
            params: {
              type: 'exchange',
              reason: exchangeReason,
              reasonValue: this.data.exchangeReasonValue,
              newProductSpec,
              proofImages: imageUrls,
              description: this.data.description,
              contactName,
              contactPhone,
              productIndex: this.productIndex
            }
          }
        });
      })
      .then((updateRes) => {
        if (!updateRes.result || !updateRes.result.success) {
          throw new Error(updateRes.result?.error || '提交换货申请失败');
        }

        const caseId = updateRes.result?.data?.caseId || updateRes.result?.caseId;
        wx.hideLoading();
        wx.showToast({ title: '换货申请提交成功', icon: 'success' });
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
        console.error('提交换货申请失败', err);
        wx.showToast({ title: err.message || '提交换货申请失败', icon: 'none' });
      });
  },

  goBack() {
    wx.navigateBack();
  }
});