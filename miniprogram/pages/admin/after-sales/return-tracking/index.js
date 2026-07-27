const { EXPRESS_COMPANIES } = require('../../../../utils/expressCompanies');

Page({
  data: {
    caseId: '',
    itemId: '',
    orderId: '',
    orderInfo: {},
    caseInfo: {},
    expressCompanies: EXPRESS_COMPANIES,
    selectedCompany: null,
    trackingNumber: '',
    showCompanyPicker: false,
    companyPickerValue: [0],
    submitting: false
  },

  onLoad: function (options) {
    const { caseId, itemId, orderId } = options;
    this.setData({
      caseId: caseId || '',
      itemId: itemId || '',
      orderId: orderId || ''
    });
    this.loadOrderInfo();
    this.loadCaseInfo();
  },

  loadOrderInfo: async function () {
    if (!this.data.orderId) return;
    try {
      const orderRes = await wx.cloud.callFunction({
        name: 'getOrderDetail',
        data: { orderId: this.data.orderId }
      });
      if (orderRes.result && orderRes.result.success) {
        this.setData({ orderInfo: orderRes.result.order });
      }
    } catch (err) {
      console.error('加载订单信息失败:', err);
    }
  },

  loadCaseInfo: async function () {
    if (!this.data.caseId) return;
    try {
      const db = wx.cloud.database();
      const res = await db.collection('after_sales_cases').doc(this.data.caseId).get();
      if (res.data) {
        this.setData({
          caseInfo: {
            caseNo: res.data.orderNumber || res.data._id,
            ...res.data
          }
        });
      }
    } catch (err) {
      console.error('加载售后单信息失败:', err);
    }
  },

  showCompanyPicker: function () {
    this.setData({ showCompanyPicker: true });
  },

  hideCompanyPicker: function () {
    this.setData({ showCompanyPicker: false });
  },

  companyPickerChange: function (e) {
    this.setData({ companyPickerValue: e.detail.value });
  },

  confirmCompany: function () {
    const index = this.data.companyPickerValue[0];
    const selectedCompany = this.data.expressCompanies[index];
    this.setData({ selectedCompany, showCompanyPicker: false });
  },

  inputTrackingNumber: function (e) {
    this.setData({ trackingNumber: e.detail.value });
  },

  submitReturnTracking: async function () {
    const { caseId, itemId, orderId, selectedCompany, trackingNumber } = this.data;

    if (!selectedCompany) {
      wx.showToast({
        title: '请选择快递公司',
        icon: 'none'
      });
      return;
    }

    if (!trackingNumber || !trackingNumber.trim()) {
      wx.showToast({
        title: '请输入快递单号',
        icon: 'none'
      });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中...' });

    try {
      const res = await wx.cloud.callFunction({
        name: 'updateOrderStatus',
        data: {
          orderId: orderId,
          operation: 'processAfterSales',
          params: {
            caseId: caseId,
            itemId: itemId,
            itemAction: 'fill_return_tracking',
            result: '填写寄回单号',
            operatorType: 'admin',
            trackingNumber: trackingNumber.trim(),
            companyCode: selectedCompany.code,
            companyName: selectedCompany.name
          }
        }
      });

      wx.hideLoading();

      if (res.result && res.result.success) {
        wx.showToast({
          title: '提交成功',
          icon: 'success'
        });

        const pages = getCurrentPages();
        const prevPage = pages.length >= 2 ? pages[pages.length - 2] : null;
        if (prevPage && typeof prevPage.fetchAfterSalesDetail === 'function') {
          prevPage.fetchAfterSalesDetail(prevPage.caseId || this.data.caseId);
        }

        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      } else {
        const errorMsg = (res.result && (res.result.error || res.result.message)) || '提交失败';
        wx.showToast({
          title: errorMsg,
          icon: 'none',
          duration: 3000
        });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('提交寄回单号失败:', err);
      wx.showToast({
        title: '提交失败',
        icon: 'none'
      });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
