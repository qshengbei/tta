// pages/admin/ship-order/index.js
Page({
  data: {
    orderId: '',
    orderInfo: {},
    expressCompanies: [
      { name: '顺丰速运', code: 'sf' },
      { name: '圆通速递', code: 'yuantong' },
      { name: '中通快递', code: 'zhongtong' },
      { name: '韵达快递', code: 'yunda' },
      { name: '申通快递', code: 'shentong' },
      { name: 'EMS', code: 'ems' },
      { name: '京东物流', code: 'jd' },
      { name: '邮政包裹', code: 'youzhengguonei' },
      { name: '百世快递', code: 'huitongkuaidi' },
      { name: '德邦快递', code: 'debangwuliu' },
      { name: '天天快递', code: 'tiantian' },
      { name: '其他', code: 'OTHER' }
    ],
    selectedCompany: null,
    trackingNumber: '',
    showCompanyPicker: false,
    companyPickerValue: [0],
    deliveryAddresses: [],
    selectedAddress: null,
    showAddressPicker: false,
    addressPickerValue: [0],
    submitting: false
  },

  onLoad: function(options) {
    const { orderId } = options;
    this.setData({ orderId });
    this.loadOrderInfo();
  },

  loadOrderInfo: async function() {
    try {
      // 加载订单信息
      const orderRes = await wx.cloud.callFunction({
        name: 'getOrderDetail',
        data: {
          orderId: this.data.orderId
        }
      });

      if (orderRes.result.success) {
        this.setData({ orderInfo: orderRes.result.order });
      } else {
        wx.showToast({
          title: '加载订单信息失败',
          icon: 'none'
        });
      }

      // 加载发货地址列表
      const settingsRes = await wx.cloud.callFunction({
        name: 'getSystemSettings'
      });

      if (settingsRes.result && settingsRes.result.data && settingsRes.result.data.deliveryAddress) {
        // 处理发货地址数据，将字符串类型转换为对象格式
        const deliveryAddresses = settingsRes.result.data.deliveryAddress.map((address, index) => {
          if (typeof address === 'string') {
            return {
              name: `发货地址 ${index + 1}`,
              address: address
            };
          }
          return address;
        });
        this.setData({ deliveryAddresses });
      }
    } catch (err) {
      console.error('加载订单信息失败:', err);
      wx.showToast({
        title: '加载订单信息失败',
        icon: 'none'
      });
    }
  },



  showCompanyPicker: function() {
    this.setData({ showCompanyPicker: true });
  },

  hideCompanyPicker: function() {
    this.setData({ showCompanyPicker: false });
  },

  companyPickerChange: function(e) {
    this.setData({ companyPickerValue: e.detail.value });
  },

  confirmCompany: function() {
    const index = this.data.companyPickerValue[0];
    const selectedCompany = this.data.expressCompanies[index];
    this.setData({ selectedCompany, showCompanyPicker: false });
  },

  showAddressPicker: function() {
    this.setData({ showAddressPicker: true });
  },

  hideAddressPicker: function() {
    this.setData({ showAddressPicker: false });
  },

  addressPickerChange: function(e) {
    this.setData({ addressPickerValue: e.detail.value });
  },

  confirmAddress: function() {
    const index = this.data.addressPickerValue[0];
    const selectedAddress = this.data.deliveryAddresses[index];
    this.setData({ selectedAddress, showAddressPicker: false });
  },

  inputTrackingNumber: function(e) {
    this.setData({ trackingNumber: e.detail.value });
  },

  submitShip: async function() {
    const { orderId, selectedCompany, trackingNumber, selectedAddress } = this.data;

    if (!selectedCompany) {
      wx.showToast({
        title: '请选择快递公司',
        icon: 'none'
      });
      return;
    }

    if (!trackingNumber) {
      wx.showToast({
        title: '请输入快递单号',
        icon: 'none'
      });
      return;
    }

    if (!selectedAddress) {
      wx.showToast({
        title: '请选择发货地址',
        icon: 'none'
      });
      return;
    }

    this.setData({ submitting: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'updateOrderStatus',
        data: {
          orderId,
          operation: 'ship',
          params: {
            trackingNumber,
            companyCode: selectedCompany.code,
            companyName: selectedCompany.name,
            fromAddress: selectedAddress.address
          }
        }
      });

      if (res.result.success) {
        wx.showToast({
          title: '发货成功',
          icon: 'success'
        });

        // 延迟返回，让用户看到成功提示
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      } else {
        wx.showToast({
          title: res.result.error || '发货失败',
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('发货失败:', err);
      wx.showToast({
        title: '发货失败',
        icon: 'none'
      });
    } finally {
      this.setData({ submitting: false });
    }
  }
});