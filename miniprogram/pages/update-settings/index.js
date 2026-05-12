// pages/admin/update-settings/index.js
const db = wx.cloud.database();

const SHIPPING_RESPONSIBILITY_OPTIONS = [
  { label: '商家承担', value: 'seller' },
  { label: '买家承担', value: 'buyer' }
];

function createDefaultAfterSalesTypeConfigs() {
  return {
    refund: {
      shippingResponsibility: 'buyer',
      requireImage: false,
      requireVideo: false
    },
    quality_refund: {
      shippingResponsibility: 'seller',
      requireImage: true,
      requireVideo: true
    },
    exchange: {
      shippingResponsibility: 'seller',
      requireImage: true,
      requireVideo: true
    },
    resend: {
      shippingResponsibility: 'seller',
      requireImage: true,
      requireVideo: true
    },
    logistics_issue: {
      shippingResponsibility: 'seller',
      requireImage: true,
      requireVideo: true
    }
  };
}

function normalizeTypeConfig(typeConfig, defaultConfig) {
  const config = typeConfig && typeof typeConfig === 'object' ? typeConfig : {};
  const shippingResponsibility = config.shippingResponsibility === 'buyer' ? 'buyer' : 'seller';
  return {
    shippingResponsibility: config.shippingResponsibility ? shippingResponsibility : defaultConfig.shippingResponsibility,
    requireImage: config.requireImage !== undefined ? config.requireImage === true : defaultConfig.requireImage,
    requireVideo: config.requireVideo !== undefined ? config.requireVideo === true : defaultConfig.requireVideo
  };
}

function buildAfterSalesTypeConfigs(rawConfig) {
  const defaultConfigs = createDefaultAfterSalesTypeConfigs();
  const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  return {
    refund: normalizeTypeConfig(source.refund, defaultConfigs.refund),
    quality_refund: normalizeTypeConfig(source.quality_refund, defaultConfigs.quality_refund),
    exchange: normalizeTypeConfig(source.exchange, defaultConfigs.exchange),
    resend: normalizeTypeConfig(source.resend, defaultConfigs.resend),
    logistics_issue: normalizeTypeConfig(source.logistics_issue, defaultConfigs.logistics_issue)
  };
}

Page({

  /**
   * 页面的初始数据
   */
  data: {
    settings: {
      countDown: 30, // 倒计时时间（分钟）
      autoConfirmReceiptDays: 3, // 自动确认收货天数
      supportNoReasonReturnRefund: true, // 是否支持7天无理由退货退款
      supportQualityRefund: true, // 是否支持质量问题退货退款
      supportQualityExchange: true, // 是否支持质量问题换货
      supportResend: true, // 是否支持补发
      supportLogisticsIssue: true, // 是否支持物流异常
      afterSalesTypeConfigs: createDefaultAfterSalesTypeConfigs(),
      noReasonReturnDays: 7, // 无理由售后天数
      normalAfterSalesDays: 7, // 常规售后天数
      qualityAfterSalesDays: 15, // 质量售后天数
      customerServiceMethod: 'official', // 客服方法：official=官方客服，custom=自定义客服
      wechatId: '', // 微信号
      wechatPicture: '', // 微信二维码图片
      adminOpenId: [], // 管理员openid列表
      pickupLocation: '', // 自提地址
      beginTime: '09:00', // 开始时间
      endTime: '18:00', // 结束时间
      expressRules: [
        {
          region: '全国',
          provinces: ['北京', '上海', '广东', '浙江', '江苏'],
          sort: 1,
          fee: 10,
          freeShipping: 99
        },
        {
          region: '其他地区',
          provinces: ['其他'],
          sort: 2,
          fee: 15,
          freeShipping: 129
        }
      ], // 快递运费规则
      deliveryRules: [
        {
          maxDistance: 5,
          fee: 5
        },
        {
          maxDistance: 10,
          fee: 8
        },
        {
          maxDistance: 20,
          fee: 12
        }
      ], // 同城配送规则
      express100Parameters: { // 快递100配置
        key: '',
        customer: '',
        apiEnabled: {
          smartCheck: false,
          realTimeQuery: false,
          subscribe: false,
          mapTrack: false,
          mapTrackPush: false
        }
      }
    },
    shippingResponsibilityOptions: SHIPPING_RESPONSIBILITY_OPTIONS,
    customerServiceMethodOptions: ['官方客服', '自定义客服'], // 客服方法选项
    customerServiceMethodIndex: 0, // 客服方法索引
    saving: {
      buyTips: false,
      customerServiceMethod: false,
      countdownTime: false,
      serviceTimeConfig: false,
      wechatId: false,
      wechatPicture: false,
      adminOpenId: false,
      pickupLocation: false,
      timeRange: false,
      expressRules: false,
      deliveryRules: false,
      express100Parameters: false
    },
    tempAdminOpenId: '', // 临时存储输入的管理员openid
    tempDeliveryAddress: '', // 临时存储发货地址
    editingDeliveryAddressIndex: -1, // 正在编辑的发货地址索引
    showDeliveryAddressForm: false, // 是否显示发货地址编辑表单
    showShippingResponsibilitySelector: false,
    currentShippingResponsibilityType: '',
    currentShippingResponsibilityTitle: '',
    currentShippingResponsibilityValue: 'seller'
    
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.loadSettings();
  },

  /**
   * 加载系统设置
   */
  async loadSettings() {
    wx.showLoading({ title: '加载中...' });
    
    try {
      const res = await db.collection('settings').get();
      if (res.data && res.data.length > 0) {
        let settings = res.data[0];
        
        // 确保 expressRules 中的每个规则都有 freeShipping 字段
        if (settings.expressRules && Array.isArray(settings.expressRules)) {
          settings.expressRules = settings.expressRules.map(rule => ({
            ...rule,
            freeShipping: rule.freeShipping !== undefined ? rule.freeShipping : 0
          }));
        }
        
        // 确保 countDown 字段存在
        if (settings.countDown === undefined) {
          settings.countDown = 30;
        }

        // 确保售后时效配置字段存在（统一读写 settings.afterSalesTimeConfig，对旧平铺字段做兼容兜底）
        const afterSalesTimeConfig = settings.afterSalesTimeConfig && typeof settings.afterSalesTimeConfig === 'object'
          ? settings.afterSalesTimeConfig
          : {};

        settings.autoConfirmReceiptDays = Number(
          afterSalesTimeConfig.autoConfirmReceiptDays ?? settings.autoConfirmReceiptDays ?? 3
        ) || 3;
        settings.normalAfterSalesDays = Number(
          afterSalesTimeConfig.normalAfterSalesDays ?? settings.normalAfterSalesDays ?? 7
        ) || 7;
        settings.qualityAfterSalesDays = Number(
          afterSalesTimeConfig.qualityAfterSalesDays ?? settings.qualityAfterSalesDays ?? 15
        ) || 15;
        
        // 确保 customerServiceMethod 字段存在，默认值为 'official'
        if (settings.customerServiceMethod === undefined) {
          settings.customerServiceMethod = 'official';
        }
        
        // 确保 express100Api 字段存在且是数组
        if (settings.express100Api) {
          // 尝试解析 express100Api 字段
          if (typeof settings.express100Api === 'string') {
            try {
              settings.express100Api = JSON.parse(settings.express100Api);
            } catch (e) {
              console.error('解析 express100Api 失败:', e);
              settings.express100Api = [];
            }
          } else if (!Array.isArray(settings.express100Api)) {
            settings.express100Api = [];
          } else {
            // 解析数组中的每个元素
            settings.express100Api = settings.express100Api.map(item => {
              if (typeof item === 'string') {
                try {
                  // 处理字符串形式的JSON
                  return JSON.parse(item);
                } catch (e) {
                  console.error('解析 express100Api 元素失败:', e);
                  return null;
                }
              } else if (typeof item === 'object' && item !== null) {
                // 处理已经是对象的元素
                return item;
              }
              return null;
            }).filter(item => item !== null);
          }
        } else {
          settings.express100Api = [];
        }
        
        // 确保 deliveryAddress 字段存在且是数组
        console.log('原始 deliveryAddress:', settings.deliveryAddress);
        if (!settings.deliveryAddress || !Array.isArray(settings.deliveryAddress)) {
          settings.deliveryAddress = [];
          console.log('设置为空数组');
        } else {
          console.log('deliveryAddress 长度:', settings.deliveryAddress.length);
          console.log('第一个元素:', settings.deliveryAddress[0]);
        }
        
        // 初始化快递100接口启用状态
        const apiEnabled = {};
        const apiList = ['smartCheck', 'realTimeQuery', 'subscribe', 'mapTrack', 'mapTrackPush'];
        
        apiList.forEach(api => {
          if (Array.isArray(settings.express100Api)) {
            const apiItem = settings.express100Api.find(item => item.api === api);
            apiEnabled[api] = apiItem ? apiItem.isEnable : false;
          } else {
            apiEnabled[api] = false;
          }
        });
        
        // 确保 express100Parameters 字段存在
        if (!settings.express100Parameters) {
          settings.express100Parameters = {};
        }
        
        // 设置 apiEnabled 对象
        settings.express100Parameters.apiEnabled = apiEnabled;
        
        // 根据 customerServiceMethod 更新 picker 的索引
        const customerServiceMethodIndex = settings.customerServiceMethod === 'official' ? 0 : 1;
        
        this.setData({ 
          settings: settings,
          customerServiceMethodIndex: customerServiceMethodIndex
        });
      }
    } catch (err) {
      console.error('加载设置失败:', err);
      wx.showToast({
        title: '加载设置失败',
        icon: 'none'
      });
    } finally {
      wx.hideLoading();
    }
  },

  /**
   * 初始化快递100接口启用状态
   */
  initExpress100ApiEnabled(express100Api) {
    const apiEnabled = {};
    const apiList = ['smartCheck', 'realTimeQuery', 'subscribe', 'mapTrack', 'mapTrackPush'];
    
    console.log('express100Api:', express100Api);
    
    apiList.forEach(api => {
      if (Array.isArray(express100Api)) {
        const apiItem = express100Api.find(item => item.api === api);
        console.log('api:', api, 'apiItem:', apiItem);
        apiEnabled[api] = apiItem ? apiItem.isEnable : false;
      } else {
        apiEnabled[api] = false;
      }
    });
    
    console.log('apiEnabled:', apiEnabled);
    this.setData({ 'settings.express100Parameters.apiEnabled': apiEnabled });
  },

  /**
   * 获取设置文档ID
   */
  async getSettingsDocId() {
    try {
      const res = await db.collection('settings').get();
      if (res.data && res.data.length > 0) {
        return res.data[0]._id;
      }
      return null;
    } catch (err) {
      console.error('获取设置文档ID失败:', err);
      return null;
    }
  },

  /**
   * 保存倒计时时间
   */
  async saveCountdownTime() {
    const countDown = this.data.settings.countDown;
    
    if (!countDown || countDown <= 0) {
      wx.showToast({
        title: '请输入有效的倒计时时间',
        icon: 'none'
      });
      return;
    }
    
    this.setData({ 'saving.countdownTime': true });
    
    try {
      const result = await wx.cloud.callFunction({
        name: 'updateSettings',
        data: {
          updateData: {
            countDown: Number(countDown)
          }
        }
      });
      
      console.log('云函数返回结果:', result);
      
      if (result.result && result.result.success) {
        wx.showToast({
          title: '倒计时时间保存成功',
          icon: 'success'
        });
      } else {
        console.error('保存失败:', result.result);
        wx.showToast({
          title: '保存失败: ' + (result.result.error || '未知错误'),
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('保存倒计时时间失败:', err);
      wx.showToast({
        title: '保存失败: ' + (err.message || '未知错误'),
        icon: 'none'
      });
    } finally {
      this.setData({ 'saving.countdownTime': false });
    }
  },

  /**
   * 保存微信号
   */
  async saveWechatId() {
    const wechatId = this.data.settings.wechatId;
    
    this.setData({ 'saving.wechatId': true });
    
    try {
      const result = await wx.cloud.callFunction({
        name: 'updateSettings',
        data: {
          updateData: {
            wechatId: String(wechatId || '')
          }
        }
      });
      
      console.log('云函数返回结果:', result);
      
      if (result.result && result.result.success) {
        wx.showToast({
          title: '微信号保存成功',
          icon: 'success'
        });
      } else {
        console.error('保存失败:', result.result);
        wx.showToast({
          title: '保存失败: ' + (result.result.error || '未知错误'),
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('保存微信号失败:', err);
      wx.showToast({
        title: '保存失败: ' + (err.message || '未知错误'),
        icon: 'none'
      });
    } finally {
      this.setData({ 'saving.wechatId': false });
    }
  },

  /**
   * 保存微信二维码
   */
  async saveWechatPicture() {
    const wechatPicture = this.data.settings.wechatPicture;
    
    this.setData({ 'saving.wechatPicture': true });
    
    try {
      const result = await wx.cloud.callFunction({
        name: 'updateSettings',
        data: {
          updateData: {
            wechatPicture: String(wechatPicture || '')
          }
        }
      });
      
      console.log('云函数返回结果:', result);
      
      if (result.result && result.result.success) {
        wx.showToast({
          title: '微信二维码保存成功',
          icon: 'success'
        });
      } else {
        console.error('保存失败:', result.result);
        wx.showToast({
          title: '保存失败: ' + (result.result.error || '未知错误'),
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('保存微信二维码失败:', err);
      wx.showToast({
        title: '保存失败: ' + (err.message || '未知错误'),
        icon: 'none'
      });
    } finally {
      this.setData({ 'saving.wechatPicture': false });
    }
  },

  /**
   * 保存管理员列表
   */
  async saveAdminOpenId() {
    const adminOpenId = this.data.settings.adminOpenId;
    
    this.setData({ 'saving.adminOpenId': true });
    
    try {
      const result = await wx.cloud.callFunction({
        name: 'updateSettings',
        data: {
          updateData: {
            adminOpenId: Array.isArray(adminOpenId) ? adminOpenId : []
          }
        }
      });
      
      console.log('云函数返回结果:', result);
      
      if (result.result && result.result.success) {
        wx.showToast({
          title: '管理员列表保存成功',
          icon: 'success'
        });
      } else {
        console.error('保存失败:', result.result);
        wx.showToast({
          title: '保存失败: ' + (result.result.error || '未知错误'),
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('保存管理员列表失败:', err);
      wx.showToast({
        title: '保存失败: ' + (err.message || '未知错误'),
        icon: 'none'
      });
    } finally {
      this.setData({ 'saving.adminOpenId': false });
    }
  },

  /**
   * 保存自提地址
   */
  async savePickupLocation() {
    const pickupLocation = this.data.settings.pickupLocation;
    
    this.setData({ 'saving.pickupLocation': true });
    
    try {
      const result = await wx.cloud.callFunction({
        name: 'updateSettings',
        data: {
          updateData: {
            pickupLocation: String(pickupLocation || '')
          }
        }
      });
      
      console.log('云函数返回结果:', result);
      
      if (result.result && result.result.success) {
        wx.showToast({
          title: '自提地址保存成功',
          icon: 'success'
        });
      } else {
        console.error('保存失败:', result.result);
        wx.showToast({
          title: '保存失败: ' + (result.result.error || '未知错误'),
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('保存自提地址失败:', err);
      wx.showToast({
        title: '保存失败: ' + (err.message || '未知错误'),
        icon: 'none'
      });
    } finally {
      this.setData({ 'saving.pickupLocation': false });
    }
  },

  /**
   * 保存时间区间
   */
  async saveTimeRange() {
    const beginTime = this.data.settings.beginTime;
    const endTime = this.data.settings.endTime;
    
    this.setData({ 'saving.timeRange': true });
    
    try {
      const result = await wx.cloud.callFunction({
        name: 'updateSettings',
        data: {
          updateData: {
            beginTime: String(beginTime || '09:00'),
            endTime: String(endTime || '18:00')
          }
        }
      });
      
      console.log('云函数返回结果:', result);
      
      if (result.result && result.result.success) {
        wx.showToast({
          title: '时间区间保存成功',
          icon: 'success'
        });
      } else {
        console.error('保存失败:', result.result);
        wx.showToast({
          title: '保存失败: ' + (result.result.error || '未知错误'),
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('保存时间区间失败:', err);
      wx.showToast({
        title: '保存失败: ' + (err.message || '未知错误'),
        icon: 'none'
      });
    } finally {
      this.setData({ 'saving.timeRange': false });
    }
  },

  /**
   * 保存快递运费配置
   */
  async saveExpressRules() {
    const expressRules = this.data.settings.expressRules;
    
    this.setData({ 'saving.expressRules': true });
    
    try {
      const result = await wx.cloud.callFunction({
        name: 'updateSettings',
        data: {
          updateData: {
            expressRules: Array.isArray(expressRules) ? expressRules : []
          }
        }
      });
      
      console.log('云函数返回结果:', result);
      
      if (result.result && result.result.success) {
        wx.showToast({
          title: '快递运费配置保存成功',
          icon: 'success'
        });
      } else {
        console.error('保存失败:', result.result);
        wx.showToast({
          title: '保存失败: ' + (result.result.error || '未知错误'),
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('保存快递运费配置失败:', err);
      wx.showToast({
        title: '保存失败: ' + (err.message || '未知错误'),
        icon: 'none'
      });
    } finally {
      this.setData({ 'saving.expressRules': false });
    }
  },

  /**
   * 保存同城配送配置
   */
  async saveDeliveryRules() {
    const deliveryRules = this.data.settings.deliveryRules;
    
    this.setData({ 'saving.deliveryRules': true });
    
    try {
      const result = await wx.cloud.callFunction({
        name: 'updateSettings',
        data: {
          updateData: {
            deliveryRules: Array.isArray(deliveryRules) ? deliveryRules : []
          }
        }
      });
      
      console.log('云函数返回结果:', result);
      
      if (result.result && result.result.success) {
        wx.showToast({
          title: '同城配送配置保存成功',
          icon: 'success'
        });
      } else {
        console.error('保存失败:', result.result);
        wx.showToast({
          title: '保存失败: ' + (result.result.error || '未知错误'),
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('保存同城配送配置失败:', err);
      wx.showToast({
        title: '保存失败: ' + (err.message || '未知错误'),
        icon: 'none'
      });
    } finally {
      this.setData({ 'saving.deliveryRules': false });
    }
  },

  /**
   * 选择微信二维码图片
   */
  chooseWechatPicture() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePaths = res.tempFilePaths;
        this.uploadWechatPicture(tempFilePaths[0]);
      }
    });
  },

  /**
   * 上传微信二维码图片
   */
  async uploadWechatPicture(tempFilePath) {
    wx.showLoading({ title: '上传中...' });
    
    try {
      const cloudPath = `wechat/qrcode_${Date.now()}.jpg`;
      const res = await wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: tempFilePath
      });
      
      this.setData({
        'settings.wechatPicture': res.fileID
      });
      
      wx.showToast({
        title: '图片上传成功',
        icon: 'success'
      });
    } catch (err) {
      console.error('上传图片失败:', err);
      wx.showToast({
        title: '上传图片失败',
        icon: 'none'
      });
    } finally {
      wx.hideLoading();
    }
  },

  /**
   * 输入倒计时时间
   */
  inputCountdownTime(e) {
    this.setData({ 'settings.countDown': parseInt(e.detail.value) || 0 });
  },

  /**
   * 输入自动确认收货天数
   */
  inputAutoConfirmReceiptDays(e) {
    this.setData({ 'settings.autoConfirmReceiptDays': parseInt(e.detail.value) || 0 });
  },

  /**
   * 切换是否支持无理由退货退款
   */
  inputSupportNoReasonReturnRefund(e) {
    this.setData({ 'settings.supportNoReasonReturnRefund': !!e.detail.value });
  },

  inputSupportQualityRefund(e) {
    this.setData({ 'settings.supportQualityRefund': !!e.detail.value });
  },

  inputSupportQualityExchange(e) {
    this.setData({ 'settings.supportQualityExchange': !!e.detail.value });
  },

  inputSupportResend(e) {
    this.setData({ 'settings.supportResend': !!e.detail.value });
  },

  inputSupportLogisticsIssue(e) {
    this.setData({ 'settings.supportLogisticsIssue': !!e.detail.value });
  },

  updateAfterSalesTypeConfig(type, patch) {
    const currentConfigs = buildAfterSalesTypeConfigs(this.data.settings.afterSalesTypeConfigs);
    const current = currentConfigs[type] || {};
    this.setData({
      [`settings.afterSalesTypeConfigs.${type}`]: {
        ...current,
        ...patch
      }
    });
  },

  inputTypeShippingResponsibility(e) {
    const type = String(e.currentTarget.dataset.type || '');
    const title = String(e.currentTarget.dataset.title || '');
    const currentConfigs = buildAfterSalesTypeConfigs(this.data.settings.afterSalesTypeConfigs);
    this.setData({
      showShippingResponsibilitySelector: true,
      currentShippingResponsibilityType: type,
      currentShippingResponsibilityTitle: title,
      currentShippingResponsibilityValue: currentConfigs[type]?.shippingResponsibility || 'seller'
    });
  },

  closeShippingResponsibilitySelector() {
    this.setData({
      showShippingResponsibilitySelector: false,
      currentShippingResponsibilityType: '',
      currentShippingResponsibilityTitle: '',
      currentShippingResponsibilityValue: 'seller'
    });
  },

  noop() {
    return;
  },

  selectShippingResponsibilityOption(e) {
    const type = this.data.currentShippingResponsibilityType;
    const responsibility = String(e.currentTarget.dataset.value || 'seller');
    if (!type) {
      this.closeShippingResponsibilitySelector();
      return;
    }
    this.updateAfterSalesTypeConfig(type, {
      shippingResponsibility: responsibility
    });
    this.setData({
      currentShippingResponsibilityValue: responsibility
    });
    this.closeShippingResponsibilitySelector();
  },

  inputTypeRequireImage(e) {
    const type = String(e.currentTarget.dataset.type || '');
    this.updateAfterSalesTypeConfig(type, {
      requireImage: !!e.detail.value
    });
  },

  inputTypeRequireVideo(e) {
    const type = String(e.currentTarget.dataset.type || '');
    this.updateAfterSalesTypeConfig(type, {
      requireVideo: !!e.detail.value
    });
  },

  /**
   * 输入无理由售后天数
   */
  inputNoReasonReturnDays(e) {
    this.setData({ 'settings.noReasonReturnDays': parseInt(e.detail.value) || 0 });
  },

  /**
   * 输入常规售后天数
   */
  inputNormalAfterSalesDays(e) {
    this.setData({ 'settings.normalAfterSalesDays': parseInt(e.detail.value) || 0 });
  },

  /**
   * 输入质量售后天数
   */
  inputQualityAfterSalesDays(e) {
    this.setData({ 'settings.qualityAfterSalesDays': parseInt(e.detail.value) || 0 });
  },

  /**
   * 保存售后时效配置
   */
  async saveServiceTimeConfig() {
    const autoConfirmReceiptDays = Number(this.data.settings.autoConfirmReceiptDays || 0);
    const normalAfterSalesDays = Number(this.data.settings.normalAfterSalesDays || 0);
    const qualityAfterSalesDays = Number(this.data.settings.qualityAfterSalesDays || 0);

    if (!autoConfirmReceiptDays || autoConfirmReceiptDays < 1 || autoConfirmReceiptDays > 15) {
      wx.showToast({
        title: '自动确认收货天数需在1-15天',
        icon: 'none'
      });
      return;
    }

    if (!normalAfterSalesDays || normalAfterSalesDays < 1 || normalAfterSalesDays > 30) {
      wx.showToast({
        title: '常规售后天数需在1-30天',
        icon: 'none'
      });
      return;
    }

    if (!qualityAfterSalesDays || qualityAfterSalesDays < 1 || qualityAfterSalesDays > 60) {
      wx.showToast({
        title: '质量售后天数需在1-60天',
        icon: 'none'
      });
      return;
    }

    if (qualityAfterSalesDays < normalAfterSalesDays) {
      wx.showToast({
        title: '质量售后天数不能小于常规售后天数',
        icon: 'none'
      });
      return;
    }

    this.setData({ 'saving.serviceTimeConfig': true });

    try {
      const result = await wx.cloud.callFunction({
        name: 'updateSettings',
        data: {
          updateData: {
            afterSalesTimeConfig: {
              autoConfirmReceiptDays,
              normalAfterSalesDays,
              qualityAfterSalesDays
            }
          }
        }
      });

      if (result.result && result.result.success) {
        wx.showToast({
          title: '售后时效配置保存成功',
          icon: 'success'
        });
      } else {
        wx.showToast({
          title: '保存失败: ' + (result.result.error || '未知错误'),
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('保存售后时效配置失败:', err);
      wx.showToast({
        title: '保存失败: ' + (err.message || '未知错误'),
        icon: 'none'
      });
    } finally {
      this.setData({ 'saving.serviceTimeConfig': false });
    }
  },

  /**
   * 选择客服方法
   */
  inputCustomerServiceMethod(e) {
    const index = parseInt(e.detail.value);
    const method = index === 0 ? 'official' : 'custom';
    this.setData({
      customerServiceMethodIndex: index,
      'settings.customerServiceMethod': method
    });
  },

  /**
   * 保存客服方法
   */
  async saveCustomerServiceMethod() {
    const customerServiceMethod = this.data.settings.customerServiceMethod;
    
    if (!customerServiceMethod) {
      wx.showToast({
        title: '请选择客服方法',
        icon: 'none'
      });
      return;
    }
    
    this.setData({ 'saving.customerServiceMethod': true });
    
    try {
      const result = await wx.cloud.callFunction({
        name: 'updateSettings',
        data: {
          updateData: {
            customerServiceMethod: String(customerServiceMethod)
          }
        }
      });
      
      console.log('云函数返回结果:', result);
      
      if (result.result && result.result.success) {
        wx.showToast({
          title: '客服方法保存成功',
          icon: 'success'
        });
      } else {
        console.error('保存失败:', result.result);
        wx.showToast({
          title: '保存失败: ' + (result.result.error || '未知错误'),
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('保存客服方法失败:', err);
      wx.showToast({
        title: '保存失败: ' + (err.message || '未知错误'),
        icon: 'none'
      });
    } finally {
      this.setData({ 'saving.customerServiceMethod': false });
    }
  },

  /**
   * 输入微信号
   */
  inputWechatId(e) {
    this.setData({ 'settings.wechatId': e.detail.value });
  },

  /**
   * 输入管理员openid
   */
  inputAdminOpenId(e) {
    this.setData({ tempAdminOpenId: e.detail.value });
  },

  /**
   * 添加管理员openid
   */
  addAdminOpenId() {
    const openid = this.data.tempAdminOpenId.trim();
    if (!openid) {
      wx.showToast({
        title: '请输入管理员OpenID',
        icon: 'none'
      });
      return;
    }
    
    const adminOpenId = this.data.settings.adminOpenId || [];
    if (adminOpenId.includes(openid)) {
      wx.showToast({
        title: '该OpenID已存在',
        icon: 'none'
      });
      return;
    }
    
    adminOpenId.push(openid);
    this.setData({ 
      'settings.adminOpenId': adminOpenId,
      tempAdminOpenId: ''
    });
    
    wx.showToast({
      title: '添加成功，请保存',
      icon: 'success'
    });
  },

  /**
   * 删除管理员openid
   */
  removeAdminOpenId(e) {
    const index = e.currentTarget.dataset.index;
    const adminOpenId = [...this.data.settings.adminOpenId];
    adminOpenId.splice(index, 1);
    this.setData({ 'settings.adminOpenId': adminOpenId });
  },

  /**
   * 输入自提地址
   */
  inputPickupLocation(e) {
    this.setData({ 'settings.pickupLocation': e.detail.value });
  },

  /**
   * 输入开始时间
   */
  inputBeginTime(e) {
    this.setData({ 'settings.beginTime': e.detail.value });
  },

  /**
   * 输入结束时间
   */
  inputEndTime(e) {
    this.setData({ 'settings.endTime': e.detail.value });
  },

  /**
   * 输入快递运费
   */
  inputExpressFee(e) {
    const index = e.currentTarget.dataset.index;
    const expressRules = [...this.data.settings.expressRules];
    expressRules[index].fee = parseFloat(e.detail.value) || 0;
    this.setData({ 'settings.expressRules': expressRules });
  },

  /**
   * 输入快递包邮条件
   */
  inputExpressFreeshipping(e) {
    const index = e.currentTarget.dataset.index;
    const expressRules = [...this.data.settings.expressRules];
    expressRules[index].freeShipping = parseFloat(e.detail.value) || 0;
    this.setData({ 'settings.expressRules': expressRules });
  },

  /**
   * 输入同城配送最大距离
   */
  inputDeliveryMaxDistance(e) {
    const index = e.currentTarget.dataset.index;
    const deliveryRules = [...this.data.settings.deliveryRules];
    deliveryRules[index].maxDistance = parseFloat(e.detail.value) || 0;
    this.setData({ 'settings.deliveryRules': deliveryRules });
  },

  /**
   * 输入同城配送费
   */
  inputDeliveryFee(e) {
    const index = e.currentTarget.dataset.index;
    const deliveryRules = [...this.data.settings.deliveryRules];
    deliveryRules[index].fee = parseFloat(e.detail.value) || 0;
    this.setData({ 'settings.deliveryRules': deliveryRules });
  },

  /**
   * 输入购买须知
   */
  inputBuyTips(e) {
    this.setData({ 'settings.buyTips': e.detail.value });
  },

  /**
   * 保存购买须知
   */
  async saveBuyTips() {
    const buyTips = this.data.settings.buyTips;
    console.log('开始保存购买须知:', buyTips);

    this.setData({ 'saving.buyTips': true });

    try {
      // 调用云函数更新设置
      const result = await wx.cloud.callFunction({
        name: 'updateSettings',
        data: {
          updateData: {
            buyTips: buyTips
          }
        }
      });

      console.log('云函数返回结果:', result);

      if (result.result && result.result.success) {
        wx.showToast({
          title: '购买须知保存成功',
          icon: 'success'
        });
      } else {
        console.error('保存失败:', result.result);
        wx.showToast({
          title: '保存失败: ' + (result.result.error || '未知错误'),
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('保存购买须知失败:', err);
      wx.showToast({
        title: '保存失败: ' + (err.message || '未知错误'),
        icon: 'none'
      });
    } finally {
      this.setData({ 'saving.buyTips': false });
    }
  },

  /**
   * 输入快递100 Key
   */
  inputExpress100Key(e) {
    this.setData({ 'settings.express100Parameters.key': e.detail.value });
  },

  /**
   * 输入快递100 Customer
   */
  inputExpress100Customer(e) {
    this.setData({ 'settings.express100Parameters.customer': e.detail.value });
  },

  /**
   * 获取接口启用状态
   */
  getApiEnabled(api) {
    const { express100Api } = this.data.settings;
    if (Array.isArray(express100Api)) {
      const apiItem = express100Api.find(item => item.api === api);
      return apiItem ? apiItem.isEnable : false;
    }
    return false;
  },

  /**
   * 切换快递100接口启用状态
   */
  toggleExpress100Api(e) {
    const api = e.currentTarget.dataset.api;
    const checked = e.detail.value;
    
    // 确保express100Api数组存在
    let express100Api = this.data.settings.express100Api || [];
    
    // 查找接口是否存在
    const apiIndex = express100Api.findIndex(item => item.api === api);
    
    if (apiIndex !== -1) {
      // 更新现有接口
      express100Api[apiIndex].isEnable = checked;
    } else {
      // 添加新接口
      express100Api.push({
        api: api,
        apiName: this.getApiName(api),
        isEnable: checked
      });
    }
    
    // 同时更新apiEnabled对象，用于WXML显示
    let apiEnabled = this.data.settings.express100Parameters.apiEnabled || {};
    apiEnabled[api] = checked;
    
    // 更新数据
    this.setData({
      'settings.express100Api': express100Api,
      'settings.express100Parameters.apiEnabled': apiEnabled
    });
  },

  /**
   * 获取接口名称
   */
  getApiName(api) {
    const apiNames = {
      smartCheck: '智能判断接口',
      realTimeQuery: '快递信息实时查询接口',
      subscribe: '快递信息订阅接口',
      mapTrack: '快递查询地图轨迹接口',
      mapTrackPush: '地图轨迹推送接口'
    };
    return apiNames[api] || api;
  },

  /**
   * 保存快递100配置
   */
  async saveExpress100Parameters() {
    const express100Parameters = this.data.settings.express100Parameters;
    const express100Api = this.data.settings.express100Api;
    
    this.setData({ 'saving.express100Parameters': true });
    
    try {
      const result = await wx.cloud.callFunction({
        name: 'updateSettings',
        data: {
          updateData: {
            express100Parameters: {
              key: String(express100Parameters.key || ''),
              customer: String(express100Parameters.customer || '')
            },
            express100Api: express100Api || []
          }
        }
      });
      
      console.log('云函数返回结果:', result);
      
      if (result.result && result.result.success) {
        wx.showToast({
          title: '快递100配置保存成功',
          icon: 'success'
        });
      } else {
        console.error('保存失败:', result.result);
        wx.showToast({
          title: '保存失败: ' + (result.result.error || '未知错误'),
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('保存快递100配置失败:', err);
      wx.showToast({
        title: '保存失败: ' + (err.message || '未知错误'),
        icon: 'none'
      });
    } finally {
      this.setData({ 'saving.express100Parameters': false });
    }
  },

  /**
   * 添加发货地址 - 显示编辑表单
   */
  addDeliveryAddress() {
    this.setData({
      showDeliveryAddressForm: true,
      editingDeliveryAddressIndex: -1,
      tempDeliveryAddress: ''
    });
  },

  /**
   * 编辑发货地址 - 显示编辑表单
   */
  editDeliveryAddress(e) {
    const index = e.currentTarget.dataset.index;
    const deliveryAddress = this.data.settings.deliveryAddress[index];
    
    let currentAddress = '';
    if (typeof deliveryAddress === 'string') {
      currentAddress = deliveryAddress;
    } else if (deliveryAddress && typeof deliveryAddress === 'object') {
      currentAddress = deliveryAddress.address || '';
    }
    
    this.setData({
      showDeliveryAddressForm: true,
      editingDeliveryAddressIndex: index,
      tempDeliveryAddress: currentAddress
    });
  },

  /**
   * 删除发货地址
   */
  removeDeliveryAddress(e) {
    const index = e.currentTarget.dataset.index;
    wx.showModal({
      title: '删除发货地址',
      content: '确定要删除这个发货地址吗？',
      success: (res) => {
        if (res.confirm) {
          const deliveryAddress = [...this.data.settings.deliveryAddress];
          deliveryAddress.splice(index, 1);
          this.setData({ 'settings.deliveryAddress': deliveryAddress });
          wx.showToast({
            title: '删除成功，请保存',
            icon: 'success'
          });
        }
      }
    });
  },

  /**
   * 保存发货地址
   */
  async saveDeliveryAddress() {
    const deliveryAddress = this.data.settings.deliveryAddress;
    
    this.setData({ 'saving.deliveryAddress': true });
    
    try {
      const result = await wx.cloud.callFunction({
        name: 'updateSettings',
        data: {
          updateData: {
            deliveryAddress: Array.isArray(deliveryAddress) ? deliveryAddress : []
          }
        }
      });
      
      console.log('云函数返回结果:', result);
      
      if (result.result && result.result.success) {
        wx.showToast({
          title: '发货地址保存成功',
          icon: 'success'
        });
      } else {
        console.error('保存失败:', result.result);
        wx.showToast({
          title: '保存失败: ' + (result.result.error || '未知错误'),
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('保存发货地址失败:', err);
      wx.showToast({
        title: '保存失败: ' + (err.message || '未知错误'),
        icon: 'none'
      });
    } finally {
      this.setData({ 'saving.deliveryAddress': false });
    }
  },

  /**
   * 输入发货地址
   */
  inputDeliveryAddress(e) {
    this.setData({
      tempDeliveryAddress: e.detail.value
    });
  },

  /**
   * 确认发货地址编辑/新增
   */
  confirmDeliveryAddress() {
    const address = this.data.tempDeliveryAddress;
    const { editingDeliveryAddressIndex } = this.data;
    
    if (!address.trim()) {
      wx.showToast({
        title: '请输入发货地址',
        icon: 'none'
      });
      return;
    }
    
    const deliveryAddressList = [...this.data.settings.deliveryAddress];
    
    if (editingDeliveryAddressIndex >= 0) {
      // 编辑现有地址
      deliveryAddressList[editingDeliveryAddressIndex] = address.trim();
      wx.showToast({
        title: '编辑成功，请保存',
        icon: 'success'
      });
    } else {
      // 添加新地址
      deliveryAddressList.push(address.trim());
      wx.showToast({
        title: '添加成功，请保存',
        icon: 'success'
      });
    }
    
    this.setData({
      'settings.deliveryAddress': deliveryAddressList,
      showDeliveryAddressForm: false,
      tempDeliveryAddress: '',
      editingDeliveryAddressIndex: -1
    });
  },

  /**
   * 关闭发货地址编辑表单
   */
  closeDeliveryAddressForm() {
    this.setData({
      showDeliveryAddressForm: false,
      tempDeliveryAddress: '',
      editingDeliveryAddressIndex: -1
    });
  }
})
