import { getCollection } from "../../utils/cloud";
import { formatDate, formatDateLabel, generatePickupDates, calculateTimeRange, calculateMinTime } from "../../utils/time-utils";
import { calculateDistance, calculateDeliveryFee, generateCircles, generateMarkers, adjustMapView, getAddressLocation } from "../../utils/map-utils";
import { generatePickupCode, getPickupLocation as fetchPickupLocation, getAddress as fetchAddress, chooseAddress as selectAddress, saveCoordinates, calculateTotalPrice, submitOrder as placeOrder } from "../../utils/order-utils";
import { calculateShippingFee, sortExpressRules, DEFAULT_EXPRESS_RULES } from "../../utils/shipping";
import { getCachedExpressRules, cacheExpressRules } from "../../utils/cache";

Page({
  data: {
    productId: "",
    product: {},
    quantity: 1,
    message: "",
    address: null,
    totalPrice: 0,
    loading: true,
    error: false,
    errorMessage: "",
    deliveryType: "express", // express: 快递, self: 自提, local: 同城配送
    tempDeliveryType: "express", // 临时存储弹窗中的选择
    pickupCode: "",
    pickupTime: "10:00",
    distance: null,
    deliveryFee: null,
    freeShippingThreshold: 40, // 包邮门槛
    isOutOfRange: false, // 是否超出配送范围
    showDeliverySelectorModal: false,
    showExpressRulesModal: false, // 显示快递计算规则弹窗
    pickupLocation: "", // 自提地址
    pickupLatitude: null, // 自提地址纬度
    pickupLongitude: null, // 自提地址经度
    tencentMapKey: "", // 腾讯地图API密钥
    secretKey: "", // 腾讯地图API密钥的secretKey
    beginTime: 9, // 默认起始时间为9点
    endTime: 20, // 默认结束时间为20点
    pickupDate: "", // 当前选择的日期
    pickupDates: [], // 可选的日期
    pickupHours: [], // 可选的小时
    pickupMinutes: [], // 可选的分钟
    selectedHour: "", // 当前选择的小时
    selectedMinute: "", // 当前选择的分钟
    pickupTimeRange: "", // 时间区间
    pickupDateTime: "", // 日期时间组合
    multiSelectorRange: [], // 多列选择器范围
    multiSelectorValue: [0, 0, 0], // 多列选择器默认值
    markers: [], // 地图标记
    circles: [], // 地图圆形覆盖物
    isMapFullScreen: false, // 地图是否全屏
    userLocation: null, // 用户当前位置
    mapHeight: 300, // 地图高度，默认300rpx
    addressCache: {}, // 地址解析缓存，键为地址字符串，值为坐标对象
    expressRules: [] // 快递运费规则
  },

  onLoad(options) {
    const { productId, quantity, message, cartItems } = options;
    
    let cartItemsArray = [];
    if (cartItems) {
      try {
        cartItemsArray = JSON.parse(decodeURIComponent(cartItems));
      } catch (err) {
        console.error("解析购物车数据失败", err);
      }
    }
    
    this.setData({
      productId: productId || "",
      quantity: parseInt(quantity) || 1,
      message: message ? decodeURIComponent(message) : "",
      cartItems: cartItemsArray
    });
    
    // 生成取件号码
    this.refreshPickupCode();
    
    // 尝试获取用户的默认地址
    this.getAddress();
    
    // 获取自提地址
    this.getPickupLocation();
    
    // 获取快递运费规则
    this.fetchExpressRules();
    
    if (productId) {
      this.fetchProduct();
    } else if (cartItemsArray.length > 0) {
      this.fetchCartProducts();
    } else {
      this.setData({
        loading: false,
        error: true,
        errorMessage: "未获取到商品信息"
      });
    }
  },
  
  // 获取购物车商品信息
  fetchCartProducts() {
    this.setData({ loading: true, error: false, errorMessage: "" });
    const products = getCollection("products");
    const cartItems = this.data.cartItems;
    const productIds = cartItems.map(item => item.productId);
    
    // 批量获取商品信息
    const productPromises = productIds.map(productId => {
      return products.doc(productId).get();
    });
    
    Promise.all(productPromises)
      .then((results) => {
        const productsData = results.map(result => result.data || {}).filter(Boolean);
        
        if (productsData.length === 0) {
          this.setData({
            loading: false,
            error: true,
            errorMessage: "商品信息不存在"
          });
          return;
        }
        
        // 计算总价格
        let totalPrice = 0;
        const cartProducts = cartItems.map(cartItem => {
          const product = productsData.find(p => p._id === cartItem.productId);
          if (product) {
            const itemTotal = product.price * cartItem.quantity;
            totalPrice += itemTotal;
            return {
              ...product,
              quantity: cartItem.quantity,
              message: cartItem.message
            };
          }
          return null;
        }).filter(Boolean);
        
        this.setData({
          products: cartProducts,
          totalPrice,
          loading: false
        });
        
        // 计算运费
        if (this.data.deliveryType === 'express' && this.data.address) {
          this.calculateShippingFee();
        }
      })
      .catch((err) => {
        console.error("加载商品信息失败", err);
        this.setData({
          loading: false,
          error: true,
          errorMessage: "加载商品信息失败，请稍后重试"
        });
      });
  },

  // 获取快递运费规则
  fetchExpressRules() {
    // 先尝试从缓存获取
    const cachedRules = getCachedExpressRules();
    if (cachedRules) {
      console.log('从缓存获取快递规则');
      this.setData({ expressRules: cachedRules });
      // 如果当前配送方式是快递，重新计算运费
      if (this.data.deliveryType === 'express' && this.data.address) {
        this.calculateShippingFee();
      }
      return;
    }

    const settings = getCollection("settings");
    settings
      .get()
      .then((res) => {
        let expressRules = [];
        if (res.data && res.data.length > 0) {
          // 获取第一条数据的 expressRules
          const firstSetting = res.data[0];
          if (firstSetting.expressRules) {
            // 按照 sort 字段升序排序
            expressRules = [...firstSetting.expressRules].sort((a, b) => {
              return (a.sort || 0) - (b.sort || 0);
            });
          } else {
            // 如果没有 expressRules 字段，使用默认规则
            expressRules = DEFAULT_EXPRESS_RULES;
          }
        } else {
          // 如果集合为空，使用默认规则
          expressRules = DEFAULT_EXPRESS_RULES;
        }
        
        // 缓存快递规则
        cacheExpressRules(expressRules);
        this.setData({ expressRules });
        
        // 如果当前配送方式是快递，重新计算运费
        if (this.data.deliveryType === 'express' && this.data.address) {
          this.calculateShippingFee();
        }
      })
      .catch((err) => {
        console.error("获取快递运费规则失败", err);
        // 出错时使用默认规则
        const expressRules = DEFAULT_EXPRESS_RULES;
        this.setData({ expressRules });
        
        // 如果当前配送方式是快递，重新计算运费
        if (this.data.deliveryType === 'express' && this.data.address) {
          this.calculateShippingFee();
        }
      });
  },

  // 获取自提地址
  async getPickupLocation() {
    try {
      const pickupLocationInfo = await fetchPickupLocation();
      if (pickupLocationInfo) {
        this.setData({
          pickupLocation: pickupLocationInfo.pickupLocation,
          pickupLatitude: pickupLocationInfo.pickupLatitude,
          pickupLongitude: pickupLocationInfo.pickupLongitude,
          tencentMapKey: pickupLocationInfo.tencentMapKey,
          secretKey: pickupLocationInfo.secretKey,
          beginTime: pickupLocationInfo.beginTime,
          endTime: pickupLocationInfo.endTime,
          deliveryRules: pickupLocationInfo.deliveryRules
        });
        
        // 只有当配送方式为自提，或同城配送且未超过配送范围时，才初始化自提时间
        if (this.data.deliveryType === 'self' || (this.data.deliveryType === 'local' && !this.data.isOutOfRange)) {
          this.initPickupTime();
        }
        
        // 如果没有坐标，使用地址解析获取
        if (!pickupLocationInfo.pickupLatitude || !pickupLocationInfo.pickupLongitude) {
          this.geocodeAddress(pickupLocationInfo.pickupLocation, pickupLocationInfo.tencentMapKey, pickupLocationInfo.secretKey);
        }
      }
    } catch (err) {
      console.error("获取自提地址失败", err);
    }
  },

  // 初始化自提时间
  initPickupTime() {
    // 对于同城配送且超过配送范围的情况，不初始化时间
    if (this.data.deliveryType === 'local' && this.data.isOutOfRange) {
      return;
    }
    
    // 生成今天到未来三天的日期
    const pickupDates = generatePickupDates(4);
    
    // 设置默认日期为今天
    const pickupDate = pickupDates[0].value;
    
    this.setData({
      pickupDates,
      pickupDate
    });
    
    // 初始化默认时间
    this.updatePickupTimeRange();
  },



  // 更新自提时间范围
  updatePickupTimeRange() {
    // 对于同城配送且超过配送范围的情况，不更新时间
    if (this.data.deliveryType === 'local' && this.data.isOutOfRange) {
      return;
    }
    
    const now = new Date();
    // 确保日期解析正确，避免时区问题
    const pickupDateStr = this.data.pickupDate || this.formatDate(now);
    const [year, month, day] = pickupDateStr.split('-').map(Number);
    const selectedDate = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    selectedDate.setHours(0, 0, 0, 0);
    const isToday = selectedDate.getTime() === today.getTime();
    
    // 计算最小小时和分钟
    let minHour = this.data.beginTime;
    let minMinute = 0;
    
    if (isToday) {
      // 如果是今天，计算当前时间加2小时
      const { minHour: calculatedMinHour, minMinute: calculatedMinMinute } = calculateMinTime(now, this.data.beginTime);
      minHour = calculatedMinHour;
      minMinute = calculatedMinMinute;
    }
    
    // 计算最大小时
    const maxHour = this.data.endTime;
    
    // 检查是否超过endTime
    if (isToday && minHour > maxHour) {
      // 根据配送方式显示不同的提示信息
      let toastTitle = '当天已无可用自提时间';
      
      // 对于同城配送，只有在没超过配送距离时才提示
      if (this.data.deliveryType === 'local' && !this.data.isOutOfRange) {
        toastTitle = '当天已无可用配送时间';
      }
      
      // 如果是自提，或者是同城配送且没超过配送距离，才显示提示
      if (this.data.deliveryType === 'self' || (this.data.deliveryType === 'local' && !this.data.isOutOfRange)) {
        // 如果当天没有可用时间，提示用户选择第二天
        wx.showToast({
          title: toastTitle,
          icon: 'none'
        });
        
        // 自动选择第二天
        const tomorrowIndex = 1;
        if (this.data.pickupDates[tomorrowIndex]) {
          const pickupDate = this.data.pickupDates[tomorrowIndex].value;
          this.setData({ pickupDate });
          // 递归调用更新时间范围
          this.updatePickupTimeRange();
          return;
        }
      }
    }
    
    // 生成可选的小时
    const pickupHours = [];
    for (let i = minHour; i <= maxHour; i++) {
      pickupHours.push(String(i).padStart(2, '0'));
    }
    
    // 生成可选的分钟（只显示00和30）
    const pickupMinutes = ['00', '30'];
    
    // 如果是当天且是最小小时，需要过滤分钟
    let filteredMinutes = [...pickupMinutes];
    if (isToday && pickupHours.length > 0 && pickupHours[0] === String(minHour)) {
      filteredMinutes = pickupMinutes.filter(minute => {
        return parseInt(minute) >= minMinute;
      });
    }
    
    // 准备多列选择器数据
    const dateLabels = this.data.pickupDates.map(date => date.label);
    const multiSelectorRange = [
      dateLabels,
      pickupHours,
      filteredMinutes
    ];
    
    // 找到当前选择的日期在数组中的索引
    let selectedDateIndex = 0;
    for (let i = 0; i < this.data.pickupDates.length; i++) {
      if (this.data.pickupDates[i].value === pickupDateStr) {
        selectedDateIndex = i;
        break;
      }
    }
    
    // 设置默认值
    let selectedHour = pickupHours[0] || "";
    let selectedMinute = filteredMinutes[0] || "";
    let pickupTime = "";
    let pickupTimeRange = "";
    let pickupDateTime = "";
    
    if (selectedHour && selectedMinute && this.data.pickupDates[selectedDateIndex]) {
      pickupTime = `${selectedHour}:${selectedMinute}`;
      pickupDateTime = `${this.data.pickupDates[selectedDateIndex].label} ${pickupTime}`;
      
      // 计算时间区间（加30分钟）
      pickupTimeRange = calculateTimeRange(pickupTime);
    }
    
    // 设置多列选择器值
    const newMultiSelectorValue = [selectedDateIndex, 0, 0];
    
    this.setData({
      pickupHours,
      pickupMinutes: filteredMinutes,
      selectedHour,
      selectedMinute,
      pickupTime,
      pickupTimeRange,
      pickupDateTime,
      multiSelectorRange,
      multiSelectorValue: newMultiSelectorValue
    });
  },

  // 多列选择器值改变
  onMultiSelectorChange(e) {
    const values = e.detail.value;
    const { pickupDates, pickupHours, pickupMinutes } = this.data;
    
    // 获取用户选择的值
    const selectedDate = pickupDates[values[0]];
    const selectedHour = pickupHours[values[1]];
    const selectedMinute = pickupMinutes[values[2]];
    
    // 计算时间区间（加30分钟）
    const pickupTime = `${selectedHour}:${selectedMinute}`;
    const pickupTimeRange = calculateTimeRange(pickupTime);
    
    // 更新数据
    this.setData({
      pickupDate: selectedDate.value,
      selectedHour,
      selectedMinute,
      pickupTime: `${selectedHour}:${selectedMinute}`,
      pickupDateTime: `${selectedDate.label} ${selectedHour}:${selectedMinute}`,
      pickupTimeRange,
      multiSelectorValue: values
    });
  },

  // 多列选择器列改变
  onMultiSelectorColumnChange(e) {
    const { column, value } = e.detail;
    const { pickupDates, multiSelectorRange } = this.data;
    
    // 当选择日期列时，需要重新计算时间范围
    if (column === 0) {
      const selectedDate = pickupDates[value];
      this.setData({ pickupDate: selectedDate.value });
      
      // 重新计算时间范围，更新小时和分钟选项
      this.updatePickupTimeRange();
    }
  },



  // 地址解析（地址转坐标）
  geocodeAddress(address, key, secretKey) {
    console.log("开始地址解析:", address);
    console.log("使用的key:", key);
    console.log("使用的secretKey:", secretKey);
    
    if (!key) {
      console.error("缺少腾讯地图API密钥");
      return;
    }
    
    // 初始化SDK
    const qqmapsdk = new QQMapWX({
      key: key
    });
    
    // 调用SDK的geocoder方法
    qqmapsdk.geocoder({
      address: address, // 地址参数，包含城市名称
      sig: secretKey, // 在调用方法时传入sig参数
      success: (res) => {
        console.log("地址解析成功:", res);
        if (res.status === 0 && res.result && res.result.location) {
          const location = res.result.location;
          console.log("解析得到的坐标:", location);
          
          // 更新坐标信息
          this.setData({
            pickupLatitude: location.lat,
            pickupLongitude: location.lng
          });
          
          // 可以选择将坐标保存回settings集合
          // this.saveCoordinates(location.lat, location.lng);
        } else {
          console.error("地址解析失败:", res);
          if (res.message) {
            wx.showToast({
              title: res.message,
              icon: "none"
            });
          }
        }
      },
      fail: (err) => {
        console.error("地址解析请求失败:", err);
        wx.showToast({
          title: "地址解析失败",
          icon: "none"
        });
      },
      complete: (res) => {
        console.log("地址解析完成:", res);
      }
    });
  },

  // 保存坐标到settings集合
  saveCoordinates(latitude, longitude) {
    const settings = getCollection("settings");
    settings
      .doc("settings") // 假设settings集合只有一个文档，ID为settings
      .update({
        data: {
          latitude,
          longitude
        }
      })
      .then((res) => {
        console.log("坐标保存成功:", res);
      })
      .catch((err) => {
        console.error("坐标保存失败:", err);
      });
  },

  // 获取用户的默认地址
  async getAddress() {
    try {
      const address = await fetchAddress();
      if (address) {
        this.setData({ address });
        // 如果是同城配送，计算距离和配送费
        if (this.data.deliveryType === 'local') {
          this.calculateDistance();
        }
      }
    } catch (err) {
      console.log("获取地址失败", err);
      // 失败时不做处理，保持address为null
    }
  },

  fetchProduct() {
    this.setData({ loading: true, error: false, errorMessage: "" });
    const products = getCollection("products");
    products
      .doc(this.data.productId)
      .get()
      .then((res) => {
        const product = res.data || {};
        if (!product._id) {
          this.setData({
            loading: false,
            error: true,
            errorMessage: "商品信息不存在"
          });
          return;
        }
        
        // 计算总价格
        const totalPrice = product.price * this.data.quantity;
        
        this.setData({
          product,
          totalPrice,
          loading: false
        });
        
        // 计算运费
        if (this.data.deliveryType === 'express' && this.data.address) {
          this.calculateShippingFee();
        }
      })
      .catch((err) => {
        console.error("加载商品信息失败", err);
        this.setData({
          loading: false,
          error: true,
          errorMessage: "加载商品信息失败，请稍后重试"
        });
      });
  },

  reload() {
    this.fetchProduct();
  },

  // 计算快递运费
  calculateShippingFee() {
    const { address, product, quantity, expressRules, products } = this.data;
    
    if (!address) {
      return;
    }
    
    const province = address.provinceName;
    let totalPrice = 0;
    let shippingFee = 0;
    let freeShippingThreshold = 0;
    
    if (products && products.length > 0) {
      // 多商品情况
      let subtotal = 0;
      products.forEach(item => {
        subtotal += item.price * item.quantity;
      });
      
      // 使用第一个商品来获取运费规则，但使用所有商品的总价格来计算是否包邮
      if (products.length > 0) {
        // 查找对应省份的运费规则
        let provinceRule = null;
        for (let i = 0; i < expressRules.length; i++) {
          const rule = expressRules[i];
          if (rule.provinces && Array.isArray(rule.provinces)) {
            // 检查省份是否在规则的provinces数组中
            if (rule.provinces.some(ruleProvince => province.includes(ruleProvince) || ruleProvince.includes(province))) {
              provinceRule = rule;
              break;
            }
          } else if (rule.province) {
            // 检查省份是否匹配
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
          // 获取包邮门槛和运费
          freeShippingThreshold = provinceRule.freeShipping || provinceRule.freeShippingThreshold || provinceRule.freeshipping || 0;
          const fee = provinceRule.fee || 0;
          
          console.log('多商品运费计算:', {
            subtotal: subtotal,
            freeShippingThreshold: freeShippingThreshold,
            fee: fee,
            isFreeShipping: subtotal >= freeShippingThreshold
          });
          
          // 检查是否满足包邮条件
          if (subtotal >= freeShippingThreshold) {
            shippingFee = 0;
          } else {
            shippingFee = fee;
          }
        }
      }
      
      totalPrice = subtotal + shippingFee;
    } else if (product) {
      // 单个商品情况
      const { shippingFee: itemShippingFee, freeShippingThreshold: itemThreshold } = calculateShippingFee(expressRules, province, product, quantity);
      shippingFee = itemShippingFee;
      freeShippingThreshold = itemThreshold;
      totalPrice = product.price * quantity + shippingFee;
      console.log('单个商品运费计算:', {
        productPrice: product.price,
        quantity: quantity,
        subtotal: product.price * quantity,
        freeShippingThreshold: itemThreshold,
        shippingFee: itemShippingFee,
        totalPrice: totalPrice
      });
    }
    
    this.setData({
      deliveryFee: shippingFee,
      freeShippingThreshold,
      totalPrice
    });
  },

  // 选择收货地址
  async chooseAddress() {
    try {
      const address = await selectAddress();
      console.log("获取到的地址数据:", address);
      this.setData({
        address
      });
      
      // 如果是同城配送，计算距离和配送费
      if (this.data.deliveryType === 'local') {
        this.calculateDistance();
      } else if (this.data.deliveryType === 'express') {
        // 如果是快递配送，计算运费
        this.calculateShippingFee();
      }
    } catch (err) {
      console.error("选择地址失败", err);
      if (err.message === "用户取消选择地址") {
        console.log("用户取消选择地址");
      }
    }
  },

  // 显示配送方式选择弹窗
  showDeliverySelector() {
    // 初始化临时配送方式为当前选择的配送方式
    this.setData({
      tempDeliveryType: this.data.deliveryType,
      showDeliverySelectorModal: true
    });
  },

  // 隐藏配送方式选择弹窗
  hideDeliverySelector() {
    this.setData({ showDeliverySelectorModal: false });
  },

  // 选择配送方式
  selectDeliveryType(e) {
    const tempDeliveryType = e.currentTarget.dataset.type;
    this.setData({ tempDeliveryType });
  },

  // 确认配送方式选择
  confirmDeliveryType() {
    const { tempDeliveryType } = this.data;
    
    // 重置距离和配送费
    this.setData({
      deliveryType: tempDeliveryType,
      distance: null,
      deliveryFee: 0,
      isOutOfRange: false
    });
    
    // 重新生成取件号码
    this.refreshPickupCode();
    
    // 如果是同城配送且有地址，先计算距离和配送费
    if (tempDeliveryType === 'local' && this.data.address) {
      // 先计算距离和配送范围，在回调中决定是否初始化自提时间
      this.calculateDistance(true);
    } else if (tempDeliveryType === 'self') {
      // 如果是自提，直接初始化自提时间
      this.initPickupTime();
      
      // 重新计算总价格（不包含配送费）
        const totalPrice = this.calculateProductTotal();
        this.setData({ totalPrice });
    } else if (tempDeliveryType === 'express' && this.data.address) {
      // 如果是快递配送且有地址，计算运费
      this.calculateShippingFee();
    } else {
      // 其他情况，重新计算总价格（不包含配送费）
        const totalPrice = this.calculateProductTotal();
        this.setData({ totalPrice });
    }
    
    // 隐藏弹窗
    this.hideDeliverySelector();
  },

  // 阻止事件冒泡
  noop() {
    // 空方法，用于阻止事件冒泡
  },

  // 刷新取件号码
  refreshPickupCode() {
    // 生成4位随机数字，不含4
    const pickupCode = generatePickupCode();
    this.setData({ pickupCode });
  },

  // 取件号码输入变化
  onPickupCodeChange(e) {
    const pickupCode = e.detail.value;
    this.setData({ pickupCode });
  },

  // 自提时间选择变化
  onPickupTimeChange(e) {
    const pickupTime = e.detail.value;
    this.setData({ pickupTime });
  },

  // 计算距离和配送费
  async calculateDistance(initTime = false) {
    // 获取自提点坐标
    const selfPickupLocation = { 
      latitude: this.data.pickupLatitude || 39.9365, 
      longitude: this.data.pickupLongitude || 116.4565 
    };
    
    let userLocation;
    
    // 解析用户地址坐标
    if (this.data.tencentMapKey && this.data.address) {
      const addressStr = this.data.address.provinceName + this.data.address.cityName + this.data.address.countyName + this.data.address.detailInfo;
      
      try {
        // 从缓存或API获取地址坐标
        userLocation = await getAddressLocation(addressStr, this.data.tencentMapKey, this.data.secretKey);
      } catch (err) {
        console.error("地址解析失败", err);
        wx.showToast({
          title: "地址解析失败",
          icon: "none"
        });
        return;
      }
    } else {
      // 如果没有腾讯地图API密钥或地址，使用默认值
      userLocation = { latitude: 39.9265, longitude: 116.4465 };
    }
    
    // 计算距离
    const distance = calculateDistance(selfPickupLocation, userLocation);
    
    // 根据配送规则计算配送费
    const { deliveryFee, isOutOfRange } = calculateDeliveryFee(distance, this.data.deliveryRules);
    
    // 如果超出配送范围，提示用户
    if (isOutOfRange) {
      wx.showToast({
        title: '超出配送范围，请选择其他配送方式',
        icon: 'none'
      });
    }
    
    // 计算总价格（包含配送费）
    const productTotal = this.calculateProductTotal();
    const totalPrice = productTotal + Number(deliveryFee);
    
    // 生成地图标记
    const markers = generateMarkers(selfPickupLocation, userLocation, '您的地址');
    
    // 生成地图圆形覆盖物
    const circles = generateCircles(selfPickupLocation, this.data.deliveryRules);
    
    this.setData({ 
      distance: distance.toFixed(1), 
      deliveryFee, 
      isOutOfRange,
      totalPrice,
      markers,
      circles
    }, () => {
      // 计算完成后，如果需要初始化自提时间且未超出配送范围
      if (initTime && !this.data.isOutOfRange) {
        this.initPickupTime();
      }
      
      // 调整地图视野，确保两个标记点都在画面内
      adjustMapView(markers);
    });
  },

  // 复制自提地址
  copyPickupLocation() {
    if (!this.data.pickupLocation) {
      wx.showToast({
        title: "自提地址未设置",
        icon: "none"
      });
      return;
    }
    
    wx.setClipboardData({
      data: this.data.pickupLocation,
      success: () => {
        wx.showToast({
          title: "复制成功",
          icon: "success"
        });
      },
      fail: () => {
        wx.showToast({
          title: "复制失败",
          icon: "none"
        });
      }
    });
  },

  // 导航到自提地址
  navigateToPickupLocation() {
    console.log("导航按钮被点击");
    
    if (!this.data.pickupLocation) {
      wx.showToast({
        title: "自提地址未设置",
        icon: "none"
      });
      console.log("自提地址未设置");
      return;
    }
    
    console.log("导航到自提地址:", this.data.pickupLocation);
    console.log("自提地址坐标:", this.data.pickupLatitude, this.data.pickupLongitude);
    
    // 使用从settings集合获取的坐标
    let latitude = this.data.pickupLatitude;
    let longitude = this.data.pickupLongitude;
    
    // 如果没有坐标，使用默认坐标
    if (!latitude || !longitude) {
      console.log("使用默认坐标");
      latitude = 24.538333; // 厦门市集美区的大致纬度
      longitude = 118.1075; // 厦门市集美区的大致经度
    }
    
    console.log("最终使用的坐标:", latitude, longitude);
    
    // 检查是否有权限
    wx.getSetting({
      success: (res) => {
        console.log("获取权限设置:", res);
        if (!res.authSetting['scope.userLocation']) {
          console.log("需要位置权限");
          wx.authorize({
            scope: 'scope.userLocation',
            success: () => {
              console.log("授权成功");
              this.openMap(latitude, longitude);
            },
            fail: () => {
              console.log("授权失败");
              wx.showToast({
                title: "需要位置权限才能导航",
                icon: "none"
              });
            }
          });
        } else {
          console.log("已有位置权限");
          this.openMap(latitude, longitude);
        }
      },
      fail: (err) => {
        console.error("获取权限设置失败:", err);
        this.openMap(latitude, longitude);
      }
    });
  },

  // 打开地图
  openMap(latitude, longitude) {
    console.log("打开地图");
    wx.openLocation({
      latitude,
      longitude,
      name: this.data.pickupLocation,
      address: this.data.pickupLocation,
      scale: 18,
      success: () => {
        console.log("地图打开成功");
      },
      fail: (err) => {
        console.error("地图打开失败:", err);
        wx.showToast({
          title: "地图打开失败",
          icon: "none"
        });
      }
    });
  },

  // 提交订单
  submitOrder() {
    // 检查配送方式
    const { deliveryType, address, pickupCode, isOutOfRange, product, products } = this.data;
    
    // 检查是否超出配送范围
    if (isOutOfRange) {
      wx.showToast({
        title: "超出配送范围，无法提交订单",
        icon: "none"
      });
      return;
    }
    
    // 检查地址
    if ((deliveryType === 'express' || deliveryType === 'local') && !address) {
      wx.showToast({
        title: deliveryType === 'express' ? "请选择收货地址" : "请添加配送地址",
        icon: "none"
      });
      return;
    }
    
    // 检查取件号码
    if ((deliveryType === 'self' || deliveryType === 'local') && !pickupCode) {
      wx.showToast({
        title: "请输入取件号码",
        icon: "none"
      });
      return;
    }
    
    // 检查商品信息
    if (!product._id && (!products || products.length === 0)) {
      wx.showToast({
        title: "商品信息错误",
        icon: "none"
      });
      return;
    }
    
    // 模拟提交订单
    wx.showLoading({
      title: "提交订单中..."
    });
    
    // 直接跳转到支付页面，传递订单相关信息
    setTimeout(() => {
      wx.hideLoading();
      wx.showToast({
        title: "订单提交成功",
        icon: "success"
      });
      
      // 准备订单数据
      const orderData = {
        totalPrice: this.data.totalPrice,
        deliveryType: this.data.deliveryType,
        address: this.data.address,
        pickupCode: this.data.pickupCode,
        pickupTime: this.data.pickupTime
      };
      
      // 添加商品信息
      if (this.data.product._id) {
        // 单个商品
        orderData.products = [{
          productId: this.data.product._id,
          name: this.data.product.name,
          price: this.data.product.price,
          quantity: this.data.quantity,
          coverImage: this.data.product.coverImage
        }];
      } else if (this.data.products && this.data.products.length > 0) {
        // 多个商品
        orderData.products = this.data.products.map(item => ({
          productId: item._id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          coverImage: item.coverImage
        }));
      }
      
      // 跳转到支付页面，传递订单数据
      setTimeout(() => {
        wx.navigateTo({
          url: "/pages/payment/index?totalPrice=" + this.data.totalPrice + "&orderData=" + encodeURIComponent(JSON.stringify(orderData))
        });
      }, 1500);
    }, 1500);
  },

  // 重置地图
  resetMap() {
    // 聚焦到自提点位置并重置缩放比例
    const mapContext = wx.createMapContext('map');
    mapContext.moveToLocation({
      latitude: this.data.pickupLatitude || 39.9365,
      longitude: this.data.pickupLongitude || 116.4565,
      scale: 15
    });
  },

  // 显示配送地址
  async showDeliveryAddress() {
    if (!this.data.address) {
      wx.showToast({
        title: "请先选择配送地址",
        icon: "none"
      });
      return;
    }
    
    // 解析配送地址坐标
    if (this.data.tencentMapKey) {
      const addressStr = this.data.address.provinceName + this.data.address.cityName + this.data.address.countyName + this.data.address.detailInfo;
      
      try {
        // 从缓存或API获取地址坐标
        const deliveryLocation = await getAddressLocation(addressStr, this.data.tencentMapKey, this.data.secretKey);
        
        // 获取自提点坐标
        const selfPickupLocation = { 
          latitude: this.data.pickupLatitude || 39.9365, 
          longitude: this.data.pickupLongitude || 116.4565 
        };
        
        // 计算距离
        const distance = calculateDistance(selfPickupLocation, deliveryLocation);
        
        // 根据配送规则计算配送费
        const { deliveryFee, isOutOfRange } = calculateDeliveryFee(distance, this.data.deliveryRules);
        
        // 计算总价格（包含配送费）
        const productTotal = this.calculateProductTotal();
        const totalPrice = productTotal + Number(deliveryFee);
        
        // 生成地图标记
        const markers = generateMarkers(selfPickupLocation, deliveryLocation, '配送地址');
        
        // 生成地图圆形覆盖物
        const circles = generateCircles(selfPickupLocation, this.data.deliveryRules);
        
        // 更新数据
        this.setData({
          markers,
          circles,
          distance: distance.toFixed(1),
          deliveryFee,
          isOutOfRange,
          totalPrice
        });
        
        // 聚焦到配送地址并重置缩放比例
        const mapContext = wx.createMapContext('map');
        mapContext.moveToLocation({
          latitude: deliveryLocation.lat || deliveryLocation.latitude,
          longitude: deliveryLocation.lng || deliveryLocation.longitude,
          scale: 15
        });
      } catch (err) {
        console.error("地址解析失败", err);
        wx.showToast({
          title: "地址解析失败",
          icon: "none"
        });
      }
    }
  },

  // 显示当前位置
  showCurrentLocation() {
    wx.getLocation({
      type: 'wgs84',
      success: (res) => {
        const currentLocation = {
          latitude: res.latitude,
          longitude: res.longitude
        };
        
        // 获取自提点坐标
        const selfPickupLocation = { 
          latitude: this.data.pickupLatitude || 39.9365, 
          longitude: this.data.pickupLongitude || 116.4565 
        };
        
        // 计算距离
        const distance = calculateDistance(selfPickupLocation, currentLocation);
        
        // 根据配送规则计算配送费
        const { deliveryFee, isOutOfRange } = calculateDeliveryFee(distance, this.data.deliveryRules);
        
        // 计算总价格（包含配送费）
        const productTotal = this.calculateProductTotal();
        const totalPrice = productTotal + Number(deliveryFee);
        
        // 生成地图标记
        const markers = generateMarkers(selfPickupLocation, currentLocation, '当前位置');
        
        // 生成地图圆形覆盖物
        const circles = generateCircles(selfPickupLocation, this.data.deliveryRules);
        
        // 更新数据
        this.setData({
          userLocation: currentLocation,
          markers,
          circles,
          distance: distance.toFixed(1),
          deliveryFee,
          isOutOfRange,
          totalPrice
        });
        
        // 聚焦到当前位置并重置缩放比例
        const mapContext = wx.createMapContext('map');
        mapContext.moveToLocation({
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          scale: 15
        });
      },
      fail: (err) => {
        console.error("获取位置失败", err);
        wx.showToast({
          title: "获取位置失败，请授权位置权限",
          icon: "none"
        });
      }
    });
  },

  // 全屏地图
  fullScreenMap() {
    // 获取屏幕高度
    const { windowHeight } = wx.getSystemInfoSync();
    
    // 设置地图全屏状态
    this.setData({ 
      isMapFullScreen: true,
      mapHeight: windowHeight - 200 // 减去顶部和底部的高度
    });
  },

  // 退出全屏
  exitFullScreenMap() {
    // 恢复地图原始高度
    this.setData({ 
      isMapFullScreen: false,
      mapHeight: 300 // 恢复为原始高度
    });
  },

  // 显示快递计算规则弹窗
  showExpressRules() {
    const { expressRules, address } = this.data;
    
    if (!address) {
      this.setData({ showExpressRulesModal: true });
      return;
    }
    
    const currentProvince = address.provinceName;
    
    // 分离当前地址规则和其他规则
    const currentRule = expressRules.find(rule => {
      return (rule.provinces && Array.isArray(rule.provinces) && rule.provinces.some(province => currentProvince.includes(province) || province.includes(currentProvince))) || 
             (rule.province && (currentProvince.includes(rule.province) || rule.province.includes(currentProvince)));
    });
    
    // 其他规则按sort升序排序
    const otherRules = expressRules.filter(rule => {
      return !((rule.provinces && Array.isArray(rule.provinces) && rule.provinces.some(province => currentProvince.includes(province) || province.includes(currentProvince))) || 
               (rule.province && (currentProvince.includes(rule.province) || rule.province.includes(currentProvince))));
    }).sort((a, b) => (a.sort || 0) - (b.sort || 0));
    
    // 合并规则，当前规则在前
    const sortedRules = currentRule ? [currentRule, ...otherRules] : otherRules;
    
    // 为每个规则添加isCurrentRegion属性
    const rulesWithCurrentFlag = sortedRules.map(rule => {
      const isCurrentRegion = (rule.provinces && Array.isArray(rule.provinces) && rule.provinces.some(province => currentProvince.includes(province) || province.includes(currentProvince))) || 
                             (rule.province && (currentProvince.includes(rule.province) || rule.province.includes(currentProvince)));
      return {
        ...rule,
        isCurrentRegion
      };
    });
    
    this.setData({ 
      showExpressRulesModal: true,
      sortedExpressRules: rulesWithCurrentFlag
    });
  },

  // 隐藏快递计算规则弹窗
  hideExpressRulesModal() {
    this.setData({ showExpressRulesModal: false });
  },

  // 计算商品总价
  calculateProductTotal() {
    let productTotal = 0;
    if (this.data.products && this.data.products.length > 0) {
      // 多个商品情况
      productTotal = this.data.products.reduce((sum, item) => {
        return sum + (item.price * item.quantity);
      }, 0);
    } else if (this.data.product._id) {
      // 单个商品情况
      productTotal = Number(this.data.product.price) * Number(this.data.quantity);
    }
    return productTotal;
  }
});