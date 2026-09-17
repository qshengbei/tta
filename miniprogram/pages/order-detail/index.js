import { getCollection } from "../../utils/cloud";
import { generateMarkers, generateCircles, getAddressLocation } from "../../utils/map-utils";
import watcherManager from "../../utils/watcherManager";

const db = wx.cloud.database();
const _ = db.command;
const EXPIRED_CHECK_COOLDOWN_MS = 15000;

Page({
  data: {
    order: null,
    originalOrderStatus: '',
    loading: true,
    error: false,
    errorMessage: "",
    pageVisible: false,
    markers: [], // 地图标记
    circles: [], // 地图圆形覆盖物
    mapHeight: 300, // 地图高度，默认300rpx
    isMapFullScreen: false, // 地图是否全屏
    pickupLocation: { // 自提点默认坐标（厦门园林博览苑附近）
      latitude: 24.528333,
      longitude: 118.0875
    },
    remainingTime: 1800, // 剩余支付时间（秒），默认30分钟
    countdownText: "", // 倒计时文本
    processingExpired: false, // 是否正在处理过期订单
    // 物流地图相关数据
    showLogistics: false, // 是否显示物流信息弹窗
    showLogisticsMap: false, // 是否显示物流地图
    logisticsMapData: null, // 物流地图数据
    logisticsMapCenter: { latitude: 39.908823, longitude: 116.397470 }, // 地图中心点，默认北京
    logisticsMapScale: 10, // 地图缩放级别
    logisticsTrackPoints: [], // 物流轨迹点
    // 售后类型选择弹窗
    showAfterSalesTypeModal: false, // 是否显示售后类型选择弹窗
    showAfterSalesRulesModal: false, // 是否显示售后时限规则弹窗
    scrollTop: 0, // 记录弹窗打开前的滚动位置
    selectedProductIndex: -1, // 当前选择的商品索引
    selectedAfterSalesType: '', // 当前选择的售后类型
    afterSalesStep: 1, // 售后步骤：1-选择类型，2-选择原因，3-上传凭证，4-填写信息
    selectedRefundType: 'return_refund', // 退款类型：refund_only-仅退款，return_refund-退货退款
    selectedGoodsStatus: 'received', // 货物状态：not_received-未收到货，received-已收到货
    selectedReason: '', // 选中的退款原因
    selectedReasonLabel: '', // 选中的退款原因文本
    selectedExchangeReason: '', // 选中的换货原因
    selectedExchangeReasonLabel: '', // 选中的换货原因文本
    displayReasonList: [], // 显示的原因列表
    canSubmitAfterSales: false, // 是否可以提交售后
    // 步骤3/4相关字段
    afterSalesImages: [], // 售后凭证图片
    afterSalesVideos: [], // 售后凭证视频
    afterSalesDescription: '', // 售后描述
    refundAmount: '', // 退款金额
    applyQty: 1, // 申请售后数量
    applyQtyHint: '', // 售后数量提示文案（动态生成，体现已售后/剩余可申请）
    amountInputWidth: 0, // 退款金额输入框宽度
    contactName: '', // 联系人
    contactPhone: '', // 联系电话
    contactAddress: '', // 联系地址
    showUploadInfoModal: false, // 是否显示查看凭证弹窗
    shippingResponsibility: 'buyer', // 运费归属：buyer-买家承担，seller-卖家承担
    remainingAfterSalesDays: 7, // 剩余售后时限（天）
    remainingNormalAfterSalesDays: 7, // 剩余常规售后时限（7天）
    remainingQualityAfterSalesDays: 15, // 剩余质量售后时限（15天）
    afterSalesWindowRestart: false, // 当前选中商品是否按换货新货收货时间重新起算售后期
    afterSalesNormalDeadline: 0, // 常规售后截止时间戳（0=无基准时间，按满额展示）
    afterSalesQualityDeadline: 0, // 质量售后截止时间戳
    afterSalesNormalMaxDays: 7, // 常规售后满额天数（无基准时间时展示用）
    afterSalesQualityMaxDays: 15, // 质量售后满额天数
    afterSalesNormalText: '', // 常规售后剩余时间分级文案（如"7天"/"1天5小时"/"20分45秒"/"已过期"）
    afterSalesQualityText: '', // 质量售后剩余时间分级文案
    partialRefundTip: '', // 部分退款补差提示（该商品已退¥X，本次最多可退¥Y）
    shippingRefundAmount: 0, // 本次售后预计退还的运费（仅展示，后端自动判定）
    shippingDeductionAmount: 0, // 本次售后预计扣减的运费（买家责任整单退包邮差额，仅展示）
    shippingRefundTip: '', // 运费退款提示文案
    shippingRefundTipType: '', // 提示类型：include=随本次退款 / exclude=不退 / deduct=扣除原运费（内扣到最多可退）/ none=不涉及运费
    returnShippingCompensationConfig: 0, // 商家配置的寄回运费固定补偿额（来自 settings，0=不补偿）
    shippingFeeRules: [], // 运费承担规则（4 个场景，来自 settings.afterSalesTimeConfig.shippingFeeRules）
    returnShippingCompensationAmount: 0, // 本次售后申请预计的寄回运费补偿（仅展示，不占商品可退额）
    returnShippingCompensationTip: '', // 寄回运费补偿提示文案
    maxRefundAmount: 0, // 最大退款金额（内扣运费后的净额）
    goodsMaxRefundAmount: 0, // 商品口径最大可退（未扣运费，用于数量联动重算）
    needProof: false, // 是否需要上传凭证
    operationLogs: [], // 订单操作日志
    expandedCases: {}, // 已展开的售后单日志分组（caseId -> bool）
    goodsStatusOptions: [ // 货物状态选项
      { value: 'not_received', label: '未收到货' },
      { value: 'received', label: '已收到货' }
    ],
    // 未收到货退款原因列表（物流状态为派件中/运输中时使用）
    notReceivedRefundReasons: [
      { value: 'late_delivery', label: '未按约定时间发货', type: 'normal' },
      { value: 'fake_shipping', label: '商家虚假发货', type: 'quality' },
      { value: 'logistics_exception', label: '物流异常', type: 'quality' },
      { value: 'empty_package', label: '空包裹', type: 'quality' },
      { value: 'other', label: '其他', type: 'normal' }
    ],
    // 退款原因列表
    refundReasons: {
      not_received: [
        { value: 'wrong_order', label: '拍错/多拍/不喜欢', type: 'normal' },
        { value: 'empty_package', label: '空包裹', type: 'quality' },
        { value: 'late_delivery', label: '未按约定时间发货', type: 'normal' },
        { value: 'lost', label: '快递/物流一直未送到', type: 'quality' },
        { value: 'no_tracking', label: '快递/物流无跟踪记录', type: 'quality' },
        { value: 'damaged_rejected', label: '商品破损已拒签', type: 'quality' }
      ],
      received: [
        { value: 'agreement', label: '协商一致退款', type: 'normal' },
        { value: 'size_mismatch', label: '大小/尺寸与商品描述不符', type: 'quality' },
        { value: 'color_mismatch', label: '颜色/图案/款式与商品描述不符', type: 'quality' },
        { value: 'material_mismatch', label: '材质与商品描述不符', type: 'quality' },
        { value: 'fade', label: '商品褪色/掉色/发黑等', type: 'quality' },
        { value: 'quality', label: '质量问题(掉钻，掉胶，配件掉落等)', type: 'quality' },
        { value: 'missing', label: '少件/漏发', type: 'quality' },
        { value: 'damaged', label: '包装/商品破损/污渍', type: 'quality' },
        { value: 'late_delivery', label: '未按约定时间发货', type: 'normal' },
        { value: 'wrong_item', label: '卖家发错货', type: 'quality' }
      ],
      return_refund: [
        { value: 'agreement', label: '协商一致退款', type: 'normal' },
        { value: 'not_wanted', label: '不想要了', type: 'normal' },
        { value: 'seven_day_no_reason', label: '7天无理由退货退款', type: 'normal' },
        { value: 'size_mismatch', label: '大小/尺寸与商品描述不符', type: 'quality' },
        { value: 'color_mismatch', label: '颜色/图案/款式与商品描述不符', type: 'quality' },
        { value: 'material_mismatch', label: '材质与商品描述不符', type: 'quality' },
        { value: 'fade', label: '商品褪色/掉色/发黑等', type: 'quality' },
        { value: 'quality', label: '质量问题(掉钻，掉胶，配件掉落等)', type: 'quality' },
        { value: 'missing', label: '少件/漏发', type: 'quality' },
        { value: 'damaged', label: '包装/商品破损/污渍', type: 'quality' },
        { value: 'late_delivery', label: '未按约定时间发货', type: 'normal' },
        { value: 'wrong_item', label: '卖家发错货', type: 'quality' }
      ]
    },
    // 换货原因列表
    exchangeReasonList: [
      { value: 'wrong_order', label: '拍错/不喜欢/不合适', type: 'normal' },
      { value: 'seven_day_no_reason', label: '7天无理由换货', type: 'normal' },
      { value: 'quality', label: '质量问题（掉钻，掉胶，配件掉落等）', type: 'quality' },
      { value: 'wrong_item', label: '卖家发错货', type: 'quality' }
    ],
    // 同城配送售后原因列表
    localRefundReasons: {
      not_received: [
        { value: 'wrong_order', label: '拍错/多拍/不喜欢', type: 'normal' },
        { value: 'empty_package', label: '商品空包/少件', type: 'quality' },
        { value: 'late_delivery', label: '商家发货慢/超时', type: 'normal' },
        { value: 'lost', label: '配送超时/未送达', type: 'quality' },
        { value: 'no_tracking', label: '无配送轨迹', type: 'quality' },
        { value: 'damaged_rejected', label: '商品配送中破损', type: 'quality' }
      ],
      received: [
        { value: 'agreement', label: '协商一致退款', type: 'normal' },
        { value: 'size_mismatch', label: '大小/尺寸与商品描述不符', type: 'quality' },
        { value: 'color_mismatch', label: '颜色/图案/款式与商品描述不符', type: 'quality' },
        { value: 'material_mismatch', label: '材质与商品描述不符', type: 'quality' },
        { value: 'fade', label: '商品褪色/掉色/发黑等', type: 'quality' },
        { value: 'quality', label: '质量问题(掉钻，掉胶，配件掉落等)', type: 'quality' },
        { value: 'missing', label: '少件/漏发', type: 'quality' },
        { value: 'damaged', label: '包装/商品破损/污渍', type: 'quality' },
        { value: 'late_delivery', label: '商家发货慢/超时', type: 'normal' },
        { value: 'wrong_item', label: '卖家发错货', type: 'quality' }
      ],
      return_refund: [
        { value: 'agreement', label: '协商一致退款', type: 'normal' },
        { value: 'not_wanted', label: '不想要了', type: 'normal' },
        { value: 'seven_day_no_reason', label: '7天无理由退货退款', type: 'normal' },
        { value: 'size_mismatch', label: '大小/尺寸与商品描述不符', type: 'quality' },
        { value: 'color_mismatch', label: '颜色/图案/款式与商品描述不符', type: 'quality' },
        { value: 'material_mismatch', label: '材质与商品描述不符', type: 'quality' },
        { value: 'fade', label: '商品褪色/掉色/发黑等', type: 'quality' },
        { value: 'quality', label: '质量问题(掉钻，掉胶，配件掉落等)', type: 'quality' },
        { value: 'missing', label: '少件/漏发', type: 'quality' },
        { value: 'damaged', label: '包装/商品破损/污渍', type: 'quality' },
        { value: 'late_delivery', label: '商家发货慢/超时', type: 'normal' },
        { value: 'wrong_item', label: '卖家发错货', type: 'quality' }
      ]
    },
    // 同城配送换货原因列表
    localExchangeReasonList: [
      { value: 'wrong_order', label: '拍错/不喜欢/不合适', type: 'normal' },
      { value: 'seven_day_no_reason', label: '7天无理由换货', type: 'normal' },
      { value: 'quality', label: '质量问题（掉钻，掉胶，配件掉落等）', type: 'quality' },
      { value: 'wrong_item', label: '卖家发错货', type: 'quality' }
    ],
    logisticsStateMap: null // 物流状态映射
  },

  onLoad(options) {
    this.expiredCheckCooldown = new Map();
    const { id, orderId } = options;
    const orderIdValue = id || orderId;
    if (orderIdValue) {
      this.setData({ orderId: orderIdValue });
      // 初始化输入框宽度
      this.setData({ refundAmount: '' }, () => {
        setTimeout(() => this.updateAmountInputWidth(), 50);
      });
      // 初始化物流状态数据
      this.initLogisticsStateData();
      this.fetchOrderDetail(orderIdValue);
      // 读取商家配置的寄回运费补偿额（用于售后申请页预计补偿提示）
      this.loadReturnShippingCompensationConfig();
      
      wx.onWindowResize(() => {
        if (this.data.isScrollLocked) {
          wx.pageScrollTo({
            scrollTop: this.data.scrollTop,
            duration: 0
          });
        }
      });
    } else {
      this.setData({
        loading: false,
        error: true,
        errorMessage: "订单ID不存在"
      });
    }
  },

  // 启动订单监听
  startOrderWatch() {
    const { orderId } = this.data;
    if (!orderId) {
      console.warn('[OrderDetail] 没有订单ID，无法启动监听');
      return;
    }

    console.log('[订单详情页面] 启动订单监听');
    
    // 使用watcherManager创建监听
    watcherManager.create(`order_detail_${orderId}`, () => {
      try {
        const db = wx.cloud.database();
        return db.collection('orders').doc(orderId).watch({
          onChange: (snapshot) => {
            if (!this.data.pageVisible) return;
            console.log('[OrderDetail] 订单数据变化:', snapshot);
            // 处理订单变化
            this.handleOrderChanges(snapshot);
          },
          onError: (error) => {
            console.error('[OrderDetail] 订单监听失败:', error);
            // 自动重连
            watcherManager.autoReconnect(`order_detail_${orderId}`, 'order watch error');
          }
        });
      } catch (error) {
        console.error('[OrderDetail] 初始化订单监听失败:', error);
        throw error;
      }
    });
  },

  // 处理订单变化
  handleOrderChanges(snapshot) {
    if (!snapshot.docChanges || snapshot.docChanges.length === 0) {
      return;
    }
    
    // 遍历变化，更新订单数据
    snapshot.docChanges.forEach(change => {
      if (change.dataType === 'update' || change.dataType === 'add') {
        // 订单更新或新增，重新获取详情
        this.fetchOrderDetail(this.data.orderId);
      }
    });
  },

  // 初始化物流状态数据
  async initLogisticsStateData() {
    console.log('开始初始化物流状态数据');
    try {
      console.log('调用express100云函数的initLogisticsStateData方法');
      const result = await wx.cloud.callFunction({
        name: 'express100',
        data: {
          action: 'initLogisticsStateData'
        }
      });
      console.log('初始化物流状态数据结果:', result);
      if (result.result) {
        console.log('云函数返回结果:', result.result);
        if (result.result.success) {
          console.log('初始化物流状态数据成功:', result.result.message);
        } else {
          console.error('初始化物流状态数据失败:', result.result.error);
        }
      }
    } catch (error) {
      console.error('初始化物流状态数据失败:', error);
    }
  },

  shouldTriggerExpiredCheck(orderId) {
    if (!orderId) {
      return false;
    }

    if (this.data.processingExpired) {
      console.log('过期订单处理中，跳过重复调用:', orderId);
      return false;
    }

    if (!this.expiredCheckCooldown) {
      this.expiredCheckCooldown = new Map();
    }

    const nowTs = Date.now();
    const lastTs = this.expiredCheckCooldown.get(orderId) || 0;
    if (nowTs - lastTs < EXPIRED_CHECK_COOLDOWN_MS) {
      console.log('过期检查冷却中，跳过重复调用:', orderId, '间隔(ms):', nowTs - lastTs);
      return false;
    }

    this.expiredCheckCooldown.set(orderId, nowTs);
    return true;
  },

  triggerExpiredOrderCheck(orderId, source = 'unknown') {
    if (!this.shouldTriggerExpiredCheck(orderId)) {
      return;
    }

    this.setData({ processingExpired: true, remainingTime: 0, countdownText: ' 00:00' });
    this.clearCountdown();
    console.log('开始调用checkExpiredOrders云函数，来源:', source, '订单ID:', orderId);

    wx.cloud.callFunction({
      name: 'checkExpiredOrders'
    }).then((res) => {
      console.log('checkExpiredOrders云函数调用成功:', res);
      setTimeout(() => {
        this.fetchOrderDetail(orderId);
      }, 500);
    }).catch((err) => {
      console.error('checkExpiredOrders 调用失败:', err);
      // 失败也拉一次最新状态，避免页面长时间停留在旧状态
      this.fetchOrderDetail(orderId);
    }).finally(() => {
      this.setData({ processingExpired: false });
      console.log('重置处理状态为false');
    });
  },

  async fetchOrderDetail(orderId) {
    this.setData({ loading: true, error: false, errorMessage: "" });

    try {
      // 先获取订单详情
      const orders = getCollection("orders");
      const res = await orders.doc(orderId).get();
      let order = res.data;
      if (!order) {
        this.setData({
          loading: false,
          error: true,
          errorMessage: "订单不存在"
        });
        return;
      }

        // 处理订单时间
        if (order.createdAt) {
          const date = new Date(order.createdAt);
          const year = date.getFullYear();
          const month = (date.getMonth() + 1).toString().padStart(2, '0');
          const day = date.getDate().toString().padStart(2, '0');
          const hours = date.getHours().toString().padStart(2, '0');
          const minutes = date.getMinutes().toString().padStart(2, '0');
          const seconds = date.getSeconds().toString().padStart(2, '0');
          order.createTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        }

          // 处理支付时间
          if (order.payTime) {
            const date = new Date(order.payTime);
            // 催发货按钮：支付满12小时后才显示（不限次数，覆盖前先取时间戳）
            if (!isNaN(date.getTime()) && order.status === 'paid') {
              order.canUrge = (Date.now() - date.getTime()) >= 12 * 60 * 60 * 1000;
            }
            const year = date.getFullYear();
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const seconds = date.getSeconds().toString().padStart(2, '0');
            order.payTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
          }

          // 处理发货时间
          if (order.shippingTime) {
            const date = new Date(order.shippingTime);
            const year = date.getFullYear();
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const seconds = date.getSeconds().toString().padStart(2, '0');
            order.shippingTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
          }

          // 处理送达时间
          if (order.deliveryTime) {
            const date = new Date(order.deliveryTime);
            const year = date.getFullYear();
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const seconds = date.getSeconds().toString().padStart(2, '0');
            order.deliveryTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
          }

          // 处理签收时间
          if (order.logisticsState && order.logisticsState.checkTime) {
            order.signTime = order.logisticsState.checkTime;
          }
          
          // 计算商品总金额
          if (order.products && order.products.length > 0) {
            order.productTotalAmount = Math.round(order.products.reduce((total, product) => {
              return total + (product.price || 0) * (product.quantity || 1);
            }, 0) * 100) / 100;
          } else {
            order.productTotalAmount = 0;
          }
          
          // 处理收货时间
          if (order.receiptTime) {
            const date = new Date(order.receiptTime);
            const year = date.getFullYear();
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const seconds = date.getSeconds().toString().padStart(2, '0');
            order.receiptTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
          }

          // 处理取消时间
          if (order.cancelTime) {
            const date = new Date(order.cancelTime);
            const year = date.getFullYear();
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const seconds = date.getSeconds().toString().padStart(2, '0');
            order.cancelTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
          }

          // 处理订单状态文本
          const deliveryType = order.deliveryType || 'express'; // 默认快递运输
          let statusText = "";
          switch (order.status) {
            case "pending":
              statusText = "待支付";
              break;
            case "paid":
              if (deliveryType === 'express') {
                statusText = "待发货";
              } else if (deliveryType === 'pickup') {
                statusText = "待自提";
              } else if (deliveryType === 'local') {
                statusText = "待配送";
              } else {
                statusText = "已支付";
              }
              break;
            case "shipping":
              if (deliveryType === 'express') {
                statusText = "待收货";
              } else if (deliveryType === 'pickup') {
                statusText = "待自提";
              } else if (deliveryType === 'local') {
                statusText = "配送中";
              } else {
                statusText = "已发货";
              }
              break;
            case "delivered":
              if (deliveryType === 'express') {
                statusText = "已签收，待确认收货";
              } else if (deliveryType === 'pickup') {
                statusText = "待自提";
              } else if (deliveryType === 'local') {
                statusText = "已送达，待确认收货";
              } else {
                statusText = "已送达";
              }
              break;
            case "completed":
              // 订单状态显示"已完成"，售后结果不覆盖主状态（淘宝做法）
              statusText = "已完成";
              break;
            case "refund":
              statusText = "售后中";
              break;
            case "refund_completed":
              // 根据售后结果显示更详细的状态
              if (order.afterSalesResult && order.afterSalesResult.includes('部分')) {
                statusText = "部分退款";
              } else if (order.afterSalesResult && order.afterSalesResult.includes('换货')) {
                statusText = "换货完成";
              } else if (order.afterSalesResult && order.afterSalesResult.includes('退款')) {
                statusText = "退款完成";
              } else {
                statusText = "售后完成";
              }
              break;
            case "cancelled":
              statusText = "已取消";
              break;
            default:
              statusText = "未知状态";
          }

          // 部分退款时在主状态后追加提示（订单可能恢复为 delivered/completed/shipping）
          if (order.afterSalesResult && order.afterSalesResult.includes('部分') && order.status !== 'refund_completed') {
            statusText = `${statusText}（部分退款）`;
          } else if (order.afterSalesResult === '整单退款' && order.status === 'refund') {
            // 拦截成功等整单退款场景：退款到账前显示"售后中（整单退款）"
            statusText = `${statusText}（整单退款）`;
          }

          order.statusText = statusText;

          // 打印订单距离信息
          console.log('订单距离信息:', {
            distance: order.distance,
            deliveryDistance: order.deliveryDistance
          });

          // 计算自提时间和配送时间的结束时间
          if (order.pickupTime) {
            const time = order.pickupTime.split(':');
            if (time.length === 2) {
              const hour = parseInt(time[0]);
              const minute = parseInt(time[1]) + 30;
              const newHour = hour + Math.floor(minute / 60);
              const newMinute = minute % 60;
              order.pickupTimeEnd = newHour.toString().padStart(2, '0') + ':' + newMinute.toString().padStart(2, '0');
            }

            // 添加完整的自提时间（包含年月日）
            if (order.pickupDate) {
              // 使用用户选择的自提日期
              order.fullPickupTime = `${order.pickupDate} ${order.pickupTime} - ${order.pickupTimeEnd}`;
            } else if (order.createdAt) {
              // 后备方案：使用订单创建时间
              const date = new Date(order.createdAt);
              const year = date.getFullYear();
              const month = (date.getMonth() + 1).toString().padStart(2, '0');
              const day = date.getDate().toString().padStart(2, '0');
              order.fullPickupTime = `${year}-${month}-${day} ${order.pickupTime} - ${order.pickupTimeEnd}`;
            }
          }

          // 生成地图标记和圆圈（同城配送）
          if (order.deliveryType === 'local') {
            // 默认配送规则
            const deliveryRules = [
              { maxDistance: 2, fee: 0 },
              { maxDistance: 5, fee: 5 },
              { maxDistance: 10, fee: 10 }
            ];

            // 使用订单中保存的自提点坐标，如果没有则使用默认坐标
            const pickupLocation = {
              latitude: order.pickupLatitude || this.data.pickupLocation.latitude,
              longitude: order.pickupLongitude || this.data.pickupLocation.longitude
            };

            // 从订单中获取用户地址坐标
            const userLocation = {
              latitude: order.userLatitude || 24.538333, // 优先使用订单中保存的用户地址纬度
              longitude: order.userLongitude || 118.1075 // 优先使用订单中保存的用户地址经度
            };

            // 生成地图标记 - 与确认订单页面一致
            const markers = [
              {
                id: 1,
                latitude: pickupLocation.latitude,
                longitude: pickupLocation.longitude,
                title: '自提点',
                width: 30,
                height: 30
              },
              {
                id: 2,
                latitude: userLocation.latitude,
                longitude: userLocation.longitude,
                title: '您的地址',
                width: 30,
                height: 30
              }
            ];

            // 生成地图圆形覆盖物
            const circles = generateCircles(pickupLocation, deliveryRules);

            this.setData({
              pickupLocation,
              markers,
              circles
            });
          }

          // 待发货状态始终允许取消订单（已发货状态按钮隐藏，走售后流程）
          const canCancel = order.status === 'paid';

          // 判断是否可以发起售后（待收货或已完成订单）
          const canAfterSales = (order.status === 'completed' || order.status === 'delivered' || order.status === 'shipping');

          // 查询该订单是否有进行中的售后案件
          let afterSalesCase = null;
          let afterSalesItems = [];
          const productHasAfterSales = {}; // 标记哪些商品有售后
          
          try {
            const db = wx.cloud.database();
            const _ = db.command;
            
            // 查询所有售后案件（包括进行中、已完成、已取消、已拒绝）
            const allCaseRes = await db.collection('after_sales_cases').where({
              orderId: orderId
            }).orderBy('createdAt', 'desc').get();
            
            if (allCaseRes.data && allCaseRes.data.length > 0) {
              // 查找进行中的售后案件
              const activeStatuses = ['submitted', 'reviewing', 'waiting_buyer_return', 'waiting_seller_receive', 'seller_reviewing', 'seller_returning', 'buyer_receiving', 'pending_refund', 'intercepting'];
              afterSalesCase = allCaseRes.data.find(c => activeStatuses.includes(c.caseStatus));
              
              // 查询所有售后案件明细
              const caseIds = allCaseRes.data.map(c => c._id);
              const itemsRes = await db.collection('after_sales_case_items').where({
                caseId: _.in(caseIds)
              }).orderBy('createdAt', 'asc').get();
              
              afterSalesItems = itemsRes.data || [];
              
              // 标记每个商品的售后状态
              afterSalesItems.forEach(item => {
                const index = item.orderItemIndex;
                if (typeof index === 'number') {
                  // 获取对应的售后案件状态
                  const caseInfo = allCaseRes.data.find(c => c._id === item.caseId);
                  const caseStatus = caseInfo ? caseInfo.caseStatus : 'unknown';
                  
                  // 调试日志
                  console.log('=== 售后状态调试 ===');
                  console.log('商品索引:', index);
                  console.log('案件状态(caseStatus):', caseStatus);
                  console.log('案件信息(caseInfo):', caseInfo);
                  console.log('明细状态(itemStatus):', item.itemStatus);
                  console.log('售后类型(afterSalesType):', item.afterSalesType);
                  console.log('activeStatuses:', activeStatuses);
                  console.log('caseStatus 是否在 activeStatuses 中:', activeStatuses.includes(caseStatus));
                  
                  // 判断售后状态类型
                  let statusType = 'none';
                  let statusText = '';
                  if (activeStatuses.includes(caseStatus)) {
                    statusType = 'active'; // 售后中
                    // 对齐淘宝：按售后类型显示概括状态，不显示具体环节
                    // 退款类：退款中 / 退货退款中；换货类：换货中
                    const afterSalesTypeForText = item.afterSalesType || caseInfo?.primaryAfterSalesType || '';
                    if (afterSalesTypeForText === 'exchange' || afterSalesTypeForText === 'quality_exchange') {
                      statusText = '换货中';
                    } else if (afterSalesTypeForText === 'return_refund' || afterSalesTypeForText === 'quality_return_refund') {
                      statusText = '退货退款中';
                    } else {
                      // refund、quality_refund、refund_received、refund_not_received 等
                      statusText = '退款中';
                    }
                  } else if (caseStatus === 'completed' || caseStatus === 'refund_completed' || caseStatus === 'exchange_completed') {
                    statusType = 'completed'; // 已完成
                    // 根据售后类型显示更详细的状态
                    const afterSalesType = item.afterSalesType;
                    if (afterSalesType === 'exchange' || afterSalesType === 'quality_exchange') {
                      statusText = '换货完成';
                    } else if (afterSalesType === 'quality_refund' || afterSalesType === 'refund' || afterSalesType === 'return_refund' || afterSalesType === 'quality_return_refund') {
                      // 验货不通过导致商家寄回商品：无退款金额，显示"售后完成"
                      const approvedAmount = Number(item.approvedRefundAmount || 0) || 0;
                      statusText = approvedAmount > 0 ? '退款成功' : '售后完成';
                    } else {
                      statusText = '售后完成';
                    }
                  } else if (caseStatus === 'cancelled') {
                    statusType = 'cancelled'; // 已取消
                    statusText = '已取消';
                    console.log('=== 已取消状态处理 ===');
                    console.log('statusType:', statusType);
                    console.log('statusText:', statusText);
                  } else if (caseStatus === 'rejected') {
                    statusType = 'rejected'; // 已拒绝
                    statusText = '已拒绝';
                    console.log('=== 已拒绝状态处理 ===');
                    console.log('statusType:', statusType);
                    console.log('statusText:', statusText);
                  }
                  
                  // 检查变量是否正确设置
                  console.log('=== 设置前检查 ===');
                  console.log('statusType:', statusType);
                  console.log('statusText:', statusText);
                  
                  // 检查索引值
                  console.log('=== 索引检查 ===');
                  console.log('item.orderItemIndex:', item.orderItemIndex);
                  console.log('index:', index);
                  console.log('typeof index:', typeof index);
                  console.log('productHasAfterSales 初始化:', productHasAfterSales);
                  
                  // 更新商品的售后状态记录
          // 同时设置字符串键和数字键，确保WXML中能正确访问
          // 支持同一商品多个售后记录
          const keyStr = String(index);
          const keyNum = Number(index);
          if (!productHasAfterSales[keyStr]) {
            productHasAfterSales[keyStr] = [];
          }
          if (!productHasAfterSales[keyNum]) {
            productHasAfterSales[keyNum] = productHasAfterSales[keyStr];
          }
          const record = {
            hasAfterSales: true,
            caseId: caseInfo ? caseInfo._id : '',
            itemStatus: item.itemStatus,
            caseItemId: item._id,
            caseStatus: caseStatus,
            statusType: statusType,
            statusText: statusText,
            // 售后代数/类型/新货标记/完成时间：用于换货新货二次售后的件数释放与售后期重算
            afterSalesType: item.afterSalesType || '',
            afterSalesGeneration: Number(item.afterSalesGeneration) || 1,
            returnGoodsType: item.returnGoodsType || '',
            completedAt: item.completedAt || null,
            createdAt: item.createdAt || caseInfo.createdAt || new Date() // 保存创建时间用于排序
          };
          productHasAfterSales[keyStr].push(record);
          // 确保数字索引也指向同一个数组
          productHasAfterSales[keyNum] = productHasAfterSales[keyStr];
                  
                  // 调试日志
                  console.log('=== productHasAfterSales 更新 ===');
                  console.log('索引:', index);
                  console.log('更新后的值:', productHasAfterSales[index]);
                  console.log('整个 productHasAfterSales:', JSON.stringify(productHasAfterSales));
                }
              });
            }
          } catch (err) {
            console.error('查询售后案件失败', err);
          }

          // 对每个商品的售后记录进行排序，活跃状态优先，然后按时间倒序
          for (const key in productHasAfterSales) {
            const records = productHasAfterSales[key];
            if (Array.isArray(records) && records.length > 0) {
              records.sort((a, b) => {
                // 活跃状态优先
                const aIsActive = a.statusType === 'active';
                const bIsActive = b.statusType === 'active';
                if (aIsActive !== bIsActive) {
                  return aIsActive ? -1 : 1;
                }
                // 然后按时间倒序（最新的在前）
                const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return bTime - aTime;
              });
            }
          }
          
          // 设置数据前检查
          console.log('=== 设置 order 数据前 ===');
          console.log('productHasAfterSales:', JSON.stringify(productHasAfterSales));
          
          // 检查第一个商品的售后状态（如果有）
          if (productHasAfterSales && productHasAfterSales[0]) {
            console.log('=== 第一个商品的售后状态检查 ===');
            console.log('productHasAfterSales[0]:', JSON.stringify(productHasAfterSales[0]));
            if (productHasAfterSales[0][0]) {
              console.log('statusType:', productHasAfterSales[0][0].statusType);
              console.log('statusText:', productHasAfterSales[0][0].statusText);
              console.log('caseStatus:', productHasAfterSales[0][0].caseStatus);
              console.log('isActive:', productHasAfterSales[0][0].statusType === 'active');
            }
          }
          
          // 判断是否有未收到货退款的售后（物流未签收时，其他商品不能申请售后）
          let hasNonReceivedRefund = false;
          let isLogisticsSigned = false;
          
          // 检查物流状态是否已签收
          if (order.logisticsState && order.logisticsState.stateName) {
            isLogisticsSigned = order.logisticsState.stateName.includes('签收');
          }
          
          // 检查是否有活跃的未收到货退款售后（已取消/已拒绝/已完成的不算）
          for (const caseItem of afterSalesItems) {
            if (caseItem.afterSalesType === 'refund_not_received' && 
                caseItem.itemStatus !== 'cancelled' && 
                caseItem.itemStatus !== 'rejected' && 
                caseItem.itemStatus !== 'completed') {
              hasNonReceivedRefund = true;
              break;
            }
          }
          
          // 如果有未收到货退款且物流未签收，其他商品不能申请售后
          const blockOtherAfterSales = hasNonReceivedRefund && !isLogisticsSigned;
          
          // 计算辅助状态字段
          const hasActiveAfterSales = {};
          const hasCompletedAfterSales = {};
          const hasCancelledAfterSales = {};
          // 每商品剩余可售后数量（buyQty - 已完成/进行中 approvedQty），用于判断是否还能继续申请售后
          const remainingAfterSalesQtyMap = {};
          // 每商品最后一次已完成售后的类型描述（如"退款成功"），用于点击按钮时的 toast 文案
          const lastCompletedAfterSalesTextMap = {};
          const products = order.products || [];
          
          for (const key in productHasAfterSales) {
            const records = productHasAfterSales[key];
            if (Array.isArray(records)) {
              const isActive = records.some(item => item.statusType === 'active');
              const isCompleted = records.some(item => item.statusType === 'completed');
              const isCancelled = records.some(item => item.statusType === 'cancelled' || item.statusType === 'rejected');
              
              // 同时设置字符串键和数字键
              hasActiveAfterSales[key] = isActive;
              hasCompletedAfterSales[key] = isCompleted;
              hasCancelledAfterSales[key] = isCancelled;
              
              const numKey = Number(key);
              if (!isNaN(numKey)) {
                hasActiveAfterSales[numKey] = isActive;
                hasCompletedAfterSales[numKey] = isCompleted;
                hasCancelledAfterSales[numKey] = isCancelled;
              }
            }
          }

          // 汇总每商品已售后消耗数量（active + completed 的 approvedQty 累计）
          // 仅退款（货留买家/未收到货）少退可补差；退货退款（货已寄回）少退不释放件数、差额不可再申请
          const REFUND_ONLY_TYPES = ['refund', 'refund_received', 'refund_not_received', 'not_received_refund'];
          // 单条退款明细的份额金额（判定是否部分金额退款，与后端 calcItemShareAmount 同口径）
          const calcCaseItemShareAmount = (caseItem) => {
            const qty = Number(caseItem?.applyQty || 0) || 0;
            const unitPrice = Number(caseItem?.unitPriceSnapshot || 0) || 0;
            if (unitPrice > 0) {
              return Math.round(unitPrice * qty * 100) / 100;
            }
            const lineAmount = Number(caseItem?.payableAmountSnapshot || 0) || 0;
            const itemBuyQty = Number(caseItem?.buyQty || 0) || 0;
            if (lineAmount > 0 && itemBuyQty > 0) {
              return Math.round((lineAmount / itemBuyQty) * qty * 100) / 100;
            }
            return Math.round((Number(caseItem?.maxRefundAmount || 0) || 0) * 100) / 100;
          };
          // 每商品行已承诺退款金额（进行中按申请额、完成按核准额）与已到账金额，支持部分退款补差
          const committedRefundAmountMap = {};
          const refundedAmountMap = {};
          const refundableRemainAmountMap = {};
          // 退货退款少退的"放弃差额"（货已寄回，不可再申请）
          const forfeitedAmountMap = {};
          // 订单级运费数据（与后端 resolveApplyShippingRefund 同口径，仅用于申请页展示）
          let orderValidAfterSalesQty = 0;   // 有效历史明细件数（cancelled/rejected 除外）
          let orderHasExchangeHistory = false; // 有效历史明细中是否含换货
          let orderCommittedShippingRefund = 0; // 已承诺/已到账的运费退款
          let orderCommittedShippingDeduction = 0; // 已承诺/已生效的运费扣减
          for (const key in productHasAfterSales) {
            const records = productHasAfterSales[key] || [];
            const productIdx = Number(key);
            const buyQty = products[productIdx] ? (products[productIdx].quantity || 1) : 0;
            let consumedQty = 0;
            let lastCompletedText = '';
            let lastCompletedTime = 0;
            let committedAmount = 0;
            let refundedAmount = 0;
            let forfeitedAmount = 0;
            records.forEach(r => {
              // 进行中/已完成的售后会计入占用（cancelled/rejected 不算，用户可重新申请）
              if (r.statusType === 'active' || r.statusType === 'completed') {
                // record 里没存 approvedQty，从 afterSalesItems 按 caseItemId 精确取
                const caseItem = afterSalesItems.find(i => i._id === r.caseItemId);
                const consumed = Number(caseItem?.approvedQty || caseItem?.applyQty || 0) || 0;
                const isExchange = ['exchange', 'quality_exchange'].includes(String(caseItem?.afterSalesType || r.afterSalesType || ''));
                const generation = Number(caseItem?.afterSalesGeneration || r.afterSalesGeneration) || 1;
                // 第1代换货已完成且交付的是新货（验货不通过寄回原货除外）：
                // 件数释放占用，允许对新货二次售后；第2代完成后继续占用，防止无限换货
                const isReleasedExchange = r.statusType === 'completed'
                  && isExchange
                  && generation < 2
                  && String(caseItem?.returnGoodsType || r.returnGoodsType || '') !== 'original';
                // 已完成退款但金额未退满：
                // - 仅退款（货留买家）：件数释放，允许在原售后期内补差
                // - 退货退款（货已寄回商家）：件数照常锁定，少退差额视为放弃，不可再申请
                const approvedAmount = Number(caseItem?.approvedRefundAmount || 0) || 0;
                const applyAmount = Number(caseItem?.applyRefundAmount || 0) || 0;
                const caseType = String(caseItem?.afterSalesType || r.afterSalesType || '');
                const isRefundOnlyCase = REFUND_ONLY_TYPES.includes(caseType);
                const shareAmount = calcCaseItemShareAmount(caseItem);
                const isAmountShortfall = shareAmount > 0 && approvedAmount < shareAmount - 0.01;
                const isPartialRefundReleased = r.statusType === 'completed'
                  && !isExchange
                  && isRefundOnlyCase
                  && isAmountShortfall;
                if (!isReleasedExchange && !isPartialRefundReleased) {
                  consumedQty += consumed;
                }
                // 退货退款少退的差额计入"放弃差额"
                if (r.statusType === 'completed' && !isExchange && !isRefundOnlyCase && isAmountShortfall) {
                  forfeitedAmount += Math.round((shareAmount - approvedAmount) * 100) / 100;
                }
                // 退款金额池：已核准取核准额，进行中尚无核准额取申请额
                committedAmount += approvedAmount > 0 ? approvedAmount : applyAmount;
                if (r.statusType === 'completed') {
                  refundedAmount += approvedAmount;
                }
                // 订单级运费聚合：有效历史件数 / 是否含换货明细 / 已承诺运费退款
                orderValidAfterSalesQty += consumed;
                if (isExchange) {
                  orderHasExchangeHistory = true;
                }
                const approvedShipping = Number(caseItem?.approvedShippingRefundAmount || 0) || 0;
                const applyShipping = Number(caseItem?.applyShippingRefundAmount || 0) || 0;
                orderCommittedShippingRefund += approvedShipping > 0 ? approvedShipping : applyShipping;
                const approvedShippingDeduction = Number(caseItem?.approvedShippingDeductionAmount || 0) || 0;
                const applyShippingDeduction = Number(caseItem?.applyShippingDeductionAmount || 0) || 0;
                orderCommittedShippingDeduction += approvedShippingDeduction > 0 ? approvedShippingDeduction : applyShippingDeduction;
              }
              if (r.statusType === 'completed' && r.statusText) {
                const t = r.createdAt ? new Date(r.createdAt).getTime() : 0;
                if (t >= lastCompletedTime) {
                  lastCompletedTime = t;
                  lastCompletedText = r.statusText;
                }
              }
            });
            const remaining = Math.max(0, (buyQty || 0) - consumedQty);
            remainingAfterSalesQtyMap[key] = remaining;
            lastCompletedAfterSalesTextMap[key] = lastCompletedText;
            // 商品行可退总额与剩余可退金额（补差申请的金额上限）
            const lineProduct = products[productIdx];
            const lineTotal = lineProduct
              ? Math.round((Number(lineProduct.lineAmount || lineProduct.payableAmount || 0) || Number(lineProduct.price || 0) * (lineProduct.quantity || 1)) * 100) / 100
              : 0;
            committedAmount = Math.round(committedAmount * 100) / 100;
            refundedAmount = Math.round(refundedAmount * 100) / 100;
            forfeitedAmount = Math.round(forfeitedAmount * 100) / 100;
            if (lineTotal > 0) {
              // 剩余可申请金额 = 行总额 − 已承诺退款 − 退货退款少退的放弃差额
              const remainAmount = Math.round(Math.max(0, lineTotal - committedAmount - forfeitedAmount) * 100) / 100;
              committedRefundAmountMap[key] = committedAmount;
              refundedAmountMap[key] = refundedAmount;
              refundableRemainAmountMap[key] = remainAmount;
              if (forfeitedAmount > 0) {
                forfeitedAmountMap[key] = forfeitedAmount;
              }
              if (!isNaN(productIdx)) {
                committedRefundAmountMap[productIdx] = committedAmount;
                refundedAmountMap[productIdx] = refundedAmount;
                refundableRemainAmountMap[productIdx] = remainAmount;
                if (forfeitedAmount > 0) {
                  forfeitedAmountMap[productIdx] = forfeitedAmount;
                }
              }
            }
            if (!isNaN(productIdx)) {
              remainingAfterSalesQtyMap[productIdx] = remaining;
              lastCompletedAfterSalesTextMap[productIdx] = lastCompletedText;
            }
          }
          
          // 每商品最近一次"已完成换货并收到新货"的时间：新货二次售后期从该时间重新起算（7天/15天）
          const releasedExchangeBaseTimeMap = {};
          const setReleasedBaseTime = (productIndex, completedAt) => {
            if (typeof productIndex !== 'number' || !completedAt) {
              return;
            }
            const parsed = this.parseAfterSalesDate(completedAt);
            if (!parsed) {
              return;
            }
            const ts = parsed.getTime();
            const curRaw = releasedExchangeBaseTimeMap[productIndex]
              ?? releasedExchangeBaseTimeMap[String(productIndex)];
            const curTs = curRaw ? (this.parseAfterSalesDate(curRaw)?.getTime() || 0) : 0;
            if (ts >= curTs) {
              releasedExchangeBaseTimeMap[productIndex] = completedAt;
              releasedExchangeBaseTimeMap[String(productIndex)] = completedAt;
            }
          };
          afterSalesItems.forEach(item => {
            const isExchange = ['exchange', 'quality_exchange'].includes(String(item.afterSalesType || ''));
            const generation = Number(item.afterSalesGeneration) || 1;
            const isReleasedExchange = isExchange
              && String(item.itemStatus || '') === 'completed'
              && String(item.returnGoodsType || '') !== 'original'
              && generation < 2;
            if (isReleasedExchange) {
              setReleasedBaseTime(item.orderItemIndex, item.completedAt);
            }
          });

          const currentStatus = order.status;
          const originalStatus = this.data.originalOrderStatus;

          // 订单运费：显式字段优先，缺失时用实付总额 − 商品行合计反推（与后端 getOrderShippingFee 同口径）
          let orderShippingFee = Number(
            order.shippingFee ?? order.deliveryFee ?? order.expressFee ?? order.postFee ?? order.freight ?? 0
          ) || 0;
          if (orderShippingFee <= 0) {
            const shippingFeeInt = Number(order.shippingFeeInt ?? order.deliveryFeeInt ?? 0) || 0;
            if (shippingFeeInt > 0) {
              orderShippingFee = shippingFeeInt / 100;
            }
          }
          if (orderShippingFee <= 0) {
            const orderPaidTotal = Number(order.totalPrice ?? order.totalAmount ?? 0) || 0;
            const goodsTotal = (products || []).reduce((sum, p) => {
              const line = Number(p.lineAmount ?? p.payableAmount ?? 0) || 0
                || Math.round((Number(p.price ?? p.unitPrice ?? 0) * (Number(p.quantity ?? p.buyQty ?? 0) || 1)) * 100) / 100;
              return sum + line;
            }, 0);
            const inferred = Math.round((orderPaidTotal - goodsTotal) * 100) / 100;
            orderShippingFee = inferred > 0.01 ? inferred : 0;
          }
          orderShippingFee = Math.round(orderShippingFee * 100) / 100;
          orderCommittedShippingRefund = Math.round(orderCommittedShippingRefund * 100) / 100;
          orderCommittedShippingDeduction = Math.round(orderCommittedShippingDeduction * 100) / 100;

          // 订单原运费（规则运费，包邮时仍 > 0）：买家责任整单退款时按"原运费 − 实付运费"扣减
          let orderOriginalShippingFee = Number(
            order.originalDeliveryFee ?? order.originalShippingFee ?? order.originalFreight ?? 0
          ) || 0;
          if (orderOriginalShippingFee <= 0) {
            const originalShippingFeeInt = Number(order.originalDeliveryFeeInt ?? order.originalShippingFeeInt ?? 0) || 0;
            if (originalShippingFeeInt > 0) {
              orderOriginalShippingFee = originalShippingFeeInt / 100;
            }
          }
          // 历史订单无原运费字段：退化为实付运费（等价于不扣减）
          if (orderOriginalShippingFee <= 0) {
            orderOriginalShippingFee = orderShippingFee;
          }
          orderOriginalShippingFee = Math.round(orderOriginalShippingFee * 100) / 100;

          this.setData({
            order: {
              ...order,
              canCancel,
              canUrge: !!order.canUrge,
              canAfterSales,
              afterSalesCase,
              afterSalesItems,
              productHasAfterSales,
              hasActiveAfterSales,
              hasCompletedAfterSales,
              hasCancelledAfterSales,
              remainingAfterSalesQtyMap,
              lastCompletedAfterSalesTextMap,
              releasedExchangeBaseTimeMap,
              committedRefundAmountMap,
              refundedAmountMap,
              refundableRemainAmountMap,
              forfeitedAmountMap,
              hasNonReceivedRefund,
              isLogisticsSigned,
              blockOtherAfterSales,
              shippingFeeAmount: orderShippingFee,
              originalShippingFeeAmount: orderOriginalShippingFee,
              committedShippingRefundAmount: orderCommittedShippingRefund,
              committedShippingDeductionAmount: orderCommittedShippingDeduction,
              validAfterSalesCoveredQty: orderValidAfterSalesQty,
              hasExchangeAfterSalesHistory: orderHasExchangeHistory
            },
            originalOrderStatus: originalStatus || currentStatus,
            loading: false
          });
          
          if (originalStatus && originalStatus !== currentStatus) {
            console.log(`[订单详情] 订单状态变化: ${originalStatus} -> ${currentStatus}`);
            getApp().globalData.needRefreshOrderList = true;
          }
          
          // 获取订单操作日志
          await this.fetchOperationLogs(orderId);
          
          // 设置后检查
          console.log('=== 设置 order 数据后 ===');
          console.log('this.data.order.productHasAfterSales:', JSON.stringify(this.data.order.productHasAfterSales));

        // 只有待支付订单才处理倒计时
        if (order.status === 'pending') {
          console.log('订单加载完成，检查状态:', { status: order.status, statusText: order.statusText, deliveryType: order.deliveryType, expireTime: order.expireTime });
          
          // 先获取设置信息，包括倒计时时间
          const settings = getCollection("settings");
          const settingsRes = await settings.get();
          let countDownMinutes = 30; // 默认30分钟
          if (settingsRes.data && settingsRes.data.length > 0) {
            const setting = settingsRes.data[0];
            if (setting.countDown && typeof setting.countDown === 'number') {
              countDownMinutes = setting.countDown;
              console.log('从settings获取倒计时时间:', countDownMinutes, '分钟');
            }
          }

          // 保存倒计时时间到页面数据
          this.setData({ countDownMinutes });

          // 检查订单是否已经过期
          const now = new Date();
          let expireTime;
          if (order.expireTime) {
            if (typeof order.expireTime === 'string') {
              expireTime = new Date(order.expireTime);
            } else if (order.expireTime instanceof Date) {
              expireTime = order.expireTime;
            } else if (typeof order.expireTime === 'object' && order.expireTime.$date) {
              expireTime = new Date(order.expireTime.$date);
            } else {
              expireTime = new Date(order.expireTime);
            }
          }

          // 如果订单已经过期，调用云函数实际取消，再刷新详情
          if (expireTime && now > expireTime) {
            console.log('订单已过期，触发云函数检查');
            this.triggerExpiredOrderCheck(order._id, 'fetchOrderDetail');
            return;
          }

          console.log('启动倒计时');
          this.startCountdown();
        } else {
          // 非待支付订单，确保倒计时被清除
          console.log('非待支付订单，清除倒计时');
          this.setData({ remainingTime: undefined, countdownText: '' });
          this.clearCountdown();
        }
    } catch (err) {
      console.error("获取订单详情失败", err);
      this.setData({
        loading: false,
        error: true,
        errorMessage: "获取订单详情失败"
      });
    }
  },

  async fetchOperationLogs(orderId) {
    try {
      const logsRes = await db.collection('order_operation_logs')
        .where({ orderId })
        .orderBy('operatedAtTs', 'desc')
        .get();
      
      const filteredLogs = (logsRes.data || [])
        // 售后过程性操作只显示在售后详情页（拦截、自动同意等），历史遗留记录也一并过滤；
        // 退款到账后由 schedule_refund_callback 写订单级 complete_refund 日志
        .filter(log => !['start_intercepting', 'auto_start_intercepting', 'after_sales_pending_refund', 'auto_process_after_sales'].includes(log.action));

      // 按 caseId 分组售后操作日志，每个 caseId 对应一次独立的售后申请；
      // 同一 caseId 下的申请/取消/完成等操作共享同一序号，便于追踪某次售后的完整生命周期
      const afterSalesActions = ['apply_after_sales', 'cancel_after_sales', 'complete_refund', 'complete_exchange', 'complete_after_sales'];
      const getProductKey = log => {
        const items = (log.detail && log.detail.items) || [];
        return items.length > 0
          ? `${items[0].orderItemIndex ?? ''}_${items[0].productName || ''}`
          : (log.detail && log.detail.orderItemId) || log._id;
      };

      // 兜底回填：旧版 apply_after_sales 日志 detail 无 caseId（caseId 由后端生成，
      // 历史未写入 detail），按商品 LIFO 匹配同商品后续 cancel/complete 的 caseId，
      // 让旧日志也能按 case 折叠。匹配不100%精确，但覆盖绝大多数场景
      const productApplyStacks = {};
      const sortedForBackfill = [...filteredLogs].sort((a, b) => {
        const ta = a.operatedAtTs || (a.operatedAt ? new Date(a.operatedAt).getTime() : 0);
        const tb = b.operatedAtTs || (b.operatedAt ? new Date(b.operatedAt).getTime() : 0);
        return ta - tb; // 正序
      });
      sortedForBackfill.forEach(log => {
        if (!afterSalesActions.includes(log.action)) return;
        const productKey = getProductKey(log);
        if (!productApplyStacks[productKey]) productApplyStacks[productKey] = [];
        const hasCaseId = !!(log.detail && log.detail.caseId);
        if (log.action === 'apply_after_sales' && !hasCaseId) {
          productApplyStacks[productKey].push(log);
        } else if (['cancel_after_sales', 'complete_refund', 'complete_exchange', 'complete_after_sales'].includes(log.action) && hasCaseId) {
          // 最近的 apply 对应最近的 cancel/complete（LIFO）
          if (productApplyStacks[productKey].length > 0) {
            const applyLog = productApplyStacks[productKey].pop();
            if (!applyLog.detail) applyLog.detail = {};
            applyLog.detail.caseId = log.detail.caseId;
          }
        }
      });
      // caseMap: caseKey -> { earliestTs, productKey, caseId }
      const caseMap = {};
      // productCaseKeys: productKey -> [caseKey]（去重）
      const productCaseKeys = {};
      filteredLogs.forEach(log => {
        if (!afterSalesActions.includes(log.action)) return;
        const productKey = getProductKey(log);
        const caseId = (log.detail && log.detail.caseId) || null;
        // caseKey 优先用 caseId；无 caseId 时用 productKey + 时间兜底，避免不同 case 被合并
        const caseKey = caseId ? 'case_' + caseId : 'nocase_' + productKey + '_' + (log.operatedAtTs || '');
        const ts = log.operatedAtTs || (log.operatedAt ? new Date(log.operatedAt).getTime() : 0);
        if (!caseMap[caseKey]) caseMap[caseKey] = { earliestTs: ts, productKey, caseId };
        if (ts < caseMap[caseKey].earliestTs) caseMap[caseKey].earliestTs = ts;
        if (!productCaseKeys[productKey]) productCaseKeys[productKey] = [];
        if (!productCaseKeys[productKey].includes(caseKey)) productCaseKeys[productKey].push(caseKey);
      });
      // 给每个 case 按商品内最早操作时间正序分配序号（第1次、第2次...）
      const productCaseSeq = {}; // caseKey -> seq
      Object.keys(productCaseKeys).forEach(productKey => {
        const caseKeys = productCaseKeys[productKey];
        caseKeys.sort((a, b) => caseMap[a].earliestTs - caseMap[b].earliestTs);
        caseKeys.forEach((caseKey, idx) => { productCaseSeq[caseKey] = idx + 1; });
      });
      // 给每条售后日志打上序号（同 caseId 共享）
      filteredLogs.forEach(log => {
        if (!afterSalesActions.includes(log.action)) return;
        const productKey = getProductKey(log);
        const caseId = (log.detail && log.detail.caseId) || null;
        const caseKey = caseId ? 'case_' + caseId : 'nocase_' + productKey + '_' + (log.operatedAtTs || '');
        log._afterSalesSeq = productCaseSeq[caseKey] || 0;
        log._afterSalesProductKey = productKey;
      });

      const logs = filteredLogs.map(log => {
        let actionText = '';
        let operatorText = '';
        
        const actionMap = {
          'create_order': '创建订单',
          'pay': '支付订单',
          'ship': '发货',
          'deliver': '送达',
          'confirm_receipt': '确认收货',
          'cancel': '取消订单',
          'auto_cancel': '系统自动取消',
          'auto_confirm_receipt': '系统自动确认收货',
          'apply_after_sales': '申请售后',
          'complete_refund': '完成退款',
          'complete_exchange': '完成换货',
          'complete_after_sales': '售后完成',
          'start_intercepting': '开始拦截快递',
          'after_sales_rejected': '售后已关闭',
          'after_sales_pending_refund': '售后进入待退款',
          'cancel_after_sales': '取消售后申请'
        };
        
        actionText = actionMap[log.action] || log.action;
        
        if (log.operatorType === 'admin') {
          operatorText = log.operatorName ? `管理员(${log.operatorName})` : '管理员';
        } else if (log.operatorType === 'system') {
          operatorText = '系统';
        } else {
          operatorText = '用户';
        }
        
        let operatedAtText = '';
        if (log.operatedAt) {
          const date = new Date(log.operatedAt);
          if (!isNaN(date.getTime())) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            operatedAtText = `${year}-${month}-${day} ${hours}:${minutes}`;
          }
        }

        // 为售后相关日志提取商品缩略信息（申请售后/完成退款/完成换货/售后完成）
        let itemSummaries = [];
        if (['apply_after_sales', 'cancel_after_sales', 'complete_refund', 'complete_exchange', 'complete_after_sales'].includes(log.action) && log.detail && log.detail.items) {
          itemSummaries = log.detail.items.map(item => ({
            productName: item.productName || '',
            skuName: item.skuName || '',
            applyQty: item.applyQty || 0,
            afterSalesTypeName: item.afterSalesTypeName || ''
          }));
        }

        // 清洗历史申请售后日志的 reason：去掉 "申请售后：商品名 x1，原因：" 前缀，只保留原因本身
        let cleanReason = log.reason || '';
        if (log.action === 'apply_after_sales') {
          const match = cleanReason.match(/^申请售后：.+，原因：(.+)$/);
          if (match) {
            cleanReason = match[1];
          } else if (cleanReason.startsWith('申请售后：')) {
            // 无原因只有商品描述的历史记录，清空避免重复
            cleanReason = '';
          }
        }

        // 售后序号：同一商品存在多次售后申请时区分第几次（仅多条时才显示）
        // 同一 caseId 下的所有操作（申请/取消/完成）共享同一序号
        const afterSalesSeq = log._afterSalesSeq || 0;
        const productKeyForCount = log._afterSalesProductKey || '';
        const totalCasesForProduct = (productKeyForCount && productCaseKeys[productKeyForCount]) ? productCaseKeys[productKeyForCount].length : 0;
        const showAfterSalesSeq = afterSalesSeq > 0 && totalCasesForProduct > 1;

        return {
          ...log,
          actionText,
          operatorText,
          operatedAtText,
          itemSummaries,
          reason: cleanReason,
          afterSalesSeqLabel: showAfterSalesSeq ? `第${afterSalesSeq}次` : ''
        };
      });

      // 同一售后单的操作记录超过1条就折叠，默认仅显示最新1条，点击可展开更早记录
      const caseLogGroups = {};
      logs.forEach(log => {
        const caseId = log.detail && log.detail.caseId;
        if (!caseId) return;
        if (!caseLogGroups[caseId]) caseLogGroups[caseId] = [];
        caseLogGroups[caseId].push(log);
      });
      Object.values(caseLogGroups).forEach(group => {
        if (group.length <= 1) return;
        group.forEach((log, idx) => {
          log._caseId = group[0].detail.caseId;
          log._hidden = idx >= 1; // 仅保留最新一条（idx=0）
        });
        group[0]._showToggle = true;
        group[0]._hiddenCount = group.length - 1;
      });

      this.setData({ operationLogs: logs });
    } catch (error) {
      console.error('获取订单操作日志失败:', error);
      this.setData({ operationLogs: [] });
    }
  },

  toggleCaseLogExpand(e) {
    const caseId = e.currentTarget.dataset.caseId;
    if (!caseId) return;
    this.setData({
      [`expandedCases.${caseId}`]: !this.data.expandedCases[caseId]
    });
  },

  goBack() {
    wx.navigateBack();
  },

  goToPayment(e) {
    const orderId = e.currentTarget.dataset.orderId;
    // 清除倒计时，避免在支付页面时仍然执行倒计时
    this.clearCountdown();
    console.log('点击去支付，清除倒计时');
    // 使用 redirectTo 替换当前详情页，支付完成后返回栈更干净
    wx.redirectTo({
      url: `/pages/payment/index?orderId=${orderId}`
    });
  },

  async callUpdateOrderStatus(orderId, operation, params = {}) {
    const res = await wx.cloud.callFunction({
      name: 'updateOrderStatus',
      data: {
        orderId,
        operation,
        params
      }
    });

    if (!res.result || !res.result.success) {
      throw new Error(res.result?.error || '状态更新失败');
    }

    return res.result;
  },

  // 页面显示时检查订单状态并重新启动倒计时
  onShow() {
    const { orderId, order } = this.data;
    const globalData = getApp().globalData;
    
    this.setData({ pageVisible: true });
    
    // 检查是否需要刷新订单详情（如取消售后后）
    if (globalData.needRefreshOrderDetail && orderId) {
      console.log('收到刷新通知，重新拉取订单详情');
      globalData.needRefreshOrderDetail = false;
      this.fetchOrderDetail(orderId);
    } else if (orderId && order && order.status === 'pending') {
      // 只对待支付订单重新拉取，因为只有待支付订单有倒计时，需要检查状态
      console.log('待支付订单，重新拉取订单详情');
      this.fetchOrderDetail(orderId);
    } else {
      console.log('非待支付订单或订单数据不存在，不刷新页面');
    }
    
    // 启动订单监听
    console.log('[订单详情页面] 开始实时监听');
    this.startOrderWatch();

    // 售后弹窗仍开着时（如从后台切回），重启售后剩余时间倒计时
    if (this.data.showAfterSalesTypeModal && !this.afterSalesCountdownTimer
      && (this.data.afterSalesNormalDeadline || this.data.afterSalesQualityDeadline)) {
      this.updateAfterSalesCountdownTick();
      this.afterSalesCountdownTimer = setInterval(() => {
        this.updateAfterSalesCountdownTick();
      }, 1000);
    }
  },

  confirmReceipt(e) {
    const orderId = e.currentTarget.dataset.orderId;
    wx.showModal({
      title: '确认收货',
      content: '确认已收到商品吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await this.callUpdateOrderStatus(orderId, 'confirm');
            wx.showToast({
              title: '确认收货成功',
              icon: 'success'
            });
            // 监听会自动更新，不手动刷新
          } catch (err) {
            console.error("确认收货失败", err);
            wx.showToast({
              title: '确认收货失败',
              icon: 'none'
            });
          }
        }
      }
    });
  },

  cancelOrder(e) {
    const orderId = e.currentTarget.dataset.orderId;
    // 已付款待发货取消：全额原路退款（含运费）；待支付订单仅关闭订单
    const cancelContent = this.data.order && this.data.order.status === 'paid'
      ? '订单尚未发货，取消后将全额原路退款（含运费），确定要取消吗？'
      : '确定要取消这个订单吗？';
    wx.showModal({
      title: '取消订单',
      content: cancelContent,
      success: async (res) => {
        if (res.confirm) {
          try {
            await this.callUpdateOrderStatus(orderId, 'cancel', {
              cancelReason: '用户主动取消'
            });
            wx.showToast({
              title: '订单取消成功',
              icon: 'success'
            });
            // 监听会自动更新，不手动刷新
          } catch (err) {
            console.error("取消订单失败", err);
            wx.showToast({
              title: '取消订单失败',
              icon: 'none'
            });
          }
        }
      }
    });
  },

  // 催发货
  urgeShipping(e) {
    const orderId = e.currentTarget.dataset.orderId;
    wx.showModal({
      title: '催发货',
      content: '已提醒商家尽快发货，您可以在订单详情页查看发货进度',
      showCancel: false,
      confirmText: '知道了',
      success: async () => {
        try {
          await wx.cloud.callFunction({
            name: 'sendNotification',
            data: {
              notificationType: 'urgeShipping',
              orderId: orderId
            }
          });
          wx.showToast({
            title: '已提醒商家',
            icon: 'success'
          });
        } catch (err) {
          console.error('催发货通知发送失败', err);
          wx.showToast({
            title: '提醒失败，请稍后重试',
            icon: 'none'
          });
        }
      }
    });
  },

  viewOrderDetail(e) {
    const orderId = e.currentTarget.dataset.orderId;
    // 跳转到订单详情页面
    wx.navigateTo({
      url: `/pages/order-detail/index?id=${orderId}`
    });
  },

  goToProductDetail(e) {
    const productId = e.currentTarget.dataset.productId;
    // 跳转到商品详情页面
    wx.navigateTo({
      url: `/pages/product-detail/index?id=${productId}`
    });
  },

  // 复制地址
  copyAddress(e) {
    const address = e.currentTarget.dataset.address;
    if (address) {
      wx.setClipboardData({
        data: address,
        success: function() {
          wx.showToast({
            title: '复制成功',
            icon: 'success'
          });
        },
        fail: function() {
          wx.showToast({
            title: '复制失败',
            icon: 'none'
          });
        }
      });
    }
  },

  // 导航到地址
  async navigateToAddress(e) {
    const address = e.currentTarget.dataset.address;
    if (!address) {
      wx.showToast({
        title: "自提地址未设置",
        icon: "none"
      });
      return;
    }

    console.log("导航到自提地址:", address);

    // 获取自提地址的坐标
    let latitude = 24.538333; // 默认坐标
    let longitude = 118.1075; // 默认坐标

    try {
      // 尝试从缓存获取自提地址信息
      const cachedLocation = wx.getStorageSync('pickupLocation');
      if (cachedLocation && cachedLocation.data) {
        const pickupLocationInfo = cachedLocation.data;
        if (pickupLocationInfo.pickupLatitude && pickupLocationInfo.pickupLongitude) {
          latitude = pickupLocationInfo.pickupLatitude;
          longitude = pickupLocationInfo.pickupLongitude;
          console.log("从缓存获取坐标:", latitude, longitude);
        }
      }
    } catch (error) {
      console.error("获取缓存失败:", error);
    }

    console.log("使用的坐标:", latitude, longitude);

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
              this.openMap(latitude, longitude, address);
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
          this.openMap(latitude, longitude, address);
        }
      },
      fail: (err) => {
        console.error("获取权限设置失败:", err);
        this.openMap(latitude, longitude, address);
      }
    });
  },

  // 打开地图
  openMap(latitude, longitude, address) {
    console.log("打开地图");
    wx.openLocation({
      latitude,
      longitude,
      name: address,
      address: address,
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

  // 重置地图
  resetMap() {
    console.log("重置地图");
    const mapContext = wx.createMapContext('logisticsMap');
    mapContext.moveToLocation({
      longitude: this.data.logisticsMapCenter.longitude,
      latitude: this.data.logisticsMapCenter.latitude,
      scale: this.data.logisticsMapScale
    });
  },

  // 全屏地图
  fullScreenMap() {
    console.log("全屏地图");
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

  // 关闭物流地图
  closeLogisticsMap() {
    this.setData({
      showLogisticsMap: false,
      logisticsMapData: null,
      logisticsTrackPoints: []
    });
  },

  // 启动倒计时
  startCountdown() {
    // 清除之前的定时器
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
    }

    // 每秒钟更新一次倒计时
    this.countdownTimer = setInterval(() => {
      const { order } = this.data;
      console.log('倒计时检查:', { status: order?.status, deliveryType: order?.deliveryType, expireTime: order?.expireTime });
      // 只有待支付（pending）状态的订单才显示倒计时
      if (order && order.status === 'pending') {
        try {
          const now = new Date();
          let expireTime;

          // 检查expireTime是否存在
          if (!order.expireTime) {
            // expireTime不存在，不参与倒计时，停止计时器
            console.log('expireTime不存在，停止倒计时');
            this.setData({ remainingTime: undefined, countdownText: '' });
            this.clearCountdown();
            return;
          }

          // 尝试解析expireTime
          if (typeof order.expireTime === 'string') {
            expireTime = new Date(order.expireTime);
          } else if (order.expireTime instanceof Date) {
            expireTime = order.expireTime;
          } else if (typeof order.expireTime === 'object' && order.expireTime.$date) {
            // 处理MongoDB日期格式
            expireTime = new Date(order.expireTime.$date);
          } else {
            expireTime = new Date(order.expireTime);
          }
          console.log('使用订单中的expireTime:', expireTime, '类型:', typeof order.expireTime);

          if (!isNaN(expireTime.getTime())) {
            const remainingTime = Math.max(0, Math.floor((expireTime - now) / 1000));
            console.log('计算倒计时:', { remainingTime, now, expireTime });
            // 计算倒计时文本
            const countdownText = remainingTime > 0 ? ` ${Math.floor(remainingTime / 60)}:${(remainingTime % 60 < 10 ? '0' + (remainingTime % 60) : remainingTime % 60)}` : ' 00:00';
            console.log('倒计时文本:', countdownText);
            this.setData({ remainingTime, countdownText });

            // 检查是否过期
            if (remainingTime === 0) {
              console.log('=== 订单倒计时结束，开始处理过期订单 ===');
              console.log('订单ID:', order._id);
              console.log('当前时间:', now.toISOString());
              console.log('过期时间:', expireTime.toISOString());

              this.triggerExpiredOrderCheck(order._id, 'startCountdown');
            }
          } else {
            // expireTime格式无效，停止倒计时，不触发云函数
            console.log('过期时间无效，停止倒计时:', order.expireTime);
            this.setData({ remainingTime: undefined, countdownText: '' });
            this.clearCountdown();
          }
        } catch (error) {
          console.error('计算倒计时失败，停止倒计时', error);
          this.setData({ remainingTime: undefined, countdownText: '' });
          this.clearCountdown();
        }
      } else {
        // 非待支付订单，清除倒计时
        console.log('非待支付订单，清除倒计时');
        this.setData({ remainingTime: undefined, countdownText: '' });
        this.clearCountdown();
      }
    }, 1000);
  },

  // 清除倒计时
  clearCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  },

  // 页面隐藏时清除倒计时
  onHide() {
    this.setData({ pageVisible: false });
    this.clearCountdown();
    this.clearAfterSalesCountdown();
    console.log('订单详情页面隐藏，清除倒计时');
    
    // 销毁监听
    const { orderId } = this.data;
    if (orderId) {
      watcherManager.destroy(`order_detail_${orderId}`);
      console.log('[订单详情页面] 关闭实时监听');
    }
  },

  // 页面卸载时清除倒计时
  onUnload() {
    this.clearCountdown();
    this.clearAfterSalesCountdown();
    if (this.expiredCheckCooldown) {
      this.expiredCheckCooldown.clear();
    }
    
    // 销毁监听
    const { orderId } = this.data;
    if (orderId) {
      watcherManager.destroy(`order_detail_${orderId}`);
      console.log('[订单详情页面] 关闭实时监听');
    }
  },

  // 删除订单
  deleteOrder(e) {
    const orderId = e.currentTarget.dataset.orderId;
    wx.showModal({
      title: '删除订单',
      content: '确定要删除这个订单吗？',
      success: (res) => {
        if (res.confirm) {
          // 调用删除订单接口
          const orders = getCollection("orders");
          orders.doc(orderId).remove()
            .then(() => {
              wx.showToast({
                title: '订单删除成功',
                icon: 'success'
              });
              // 返回订单列表页面
              wx.navigateBack();
            })
            .catch((err) => {
              console.error("删除订单失败", err);
              wx.showToast({
                title: '删除订单失败',
                icon: 'none'
              });
            });
        }
      }
    });
  },

  // 联系客服
  contactService(e) {
    wx.showModal({
      title: '联系客服',
      content: '请联系客服处理您的订单问题',
      confirmText: '拨打电话',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          // 这里可以添加客服电话，或者跳转到客服页面
          wx.makePhoneCall({
            phoneNumber: '400-123-4567', // 示例客服电话
            fail: (err) => {
              console.error("拨打电话失败", err);
              wx.showToast({
                title: '拨打电话失败',
                icon: 'none'
              });
            }
          });
        }
      }
    });
  },

  // 查看物流
  async viewLogistics(e) {
    console.log('viewLogistics函数被调用');
    console.log('事件对象:', e);
    const orderId = e.currentTarget.dataset.orderId;
    console.log('订单ID:', orderId);
    const order = this.data.order;
    console.log('订单信息:', order);

    if (!order || !order.logisticsInfo || !order.logisticsInfo.trackingNumber) {
      console.log('暂无物流信息');
      wx.showToast({
        title: '暂无物流信息',
        icon: 'none'
      });
      return;
    }

    const trackingNumber = order.logisticsInfo.trackingNumber;
    console.log('物流单号:', trackingNumber);
    wx.showLoading({ title: '加载物流信息...' });

    try {
      // 1. 获取物流状态映射
      if (!this.data.logisticsStateMap) {
        await this.getStateMap();
      }

      let companyCode = order.logisticsInfo.companyCode || '';
      let companyName = order.logisticsInfo.companyName || '';
      console.log('订单中的快递公司代码:', companyCode);
      console.log('订单中的快递公司名称:', companyName);
      let logisticsData = null;
      let isMapTrackEnabled = false;

      // 2. 统一物流查询：先查logisticsInfo半小时缓存，缓存失效再调用启用接口并回写缓存
      const fromAddress = (order.fromAddress || order.pickupAddress || '').trim();
      const addressObj = order.address && typeof order.address === 'object' ? order.address : null;
      const toAddressParts = [
        addressObj?.provinceName,
        addressObj?.cityName,
        addressObj?.countyName,
        addressObj?.detailInfo
      ].filter(Boolean);
      const toAddress = (
        toAddressParts.join('') ||
        (typeof order.address === 'string' ? order.address : '') ||
        order.receiverAddress ||
        order.consigneeAddress ||
        order.shippingAddress ||
        ''
      ).trim();

      const logisticsResult = await wx.cloud.callFunction({
        name: 'express100',
        data: {
          action: 'queryLogisticsAndUpdateOrder',
          expressNo: trackingNumber,
          companyCode,
          fromAddress,
          toAddress
        }
      });
      console.log('统一物流查询返回结果:', logisticsResult);

      if (logisticsResult.result && logisticsResult.result.success) {
        logisticsData = logisticsResult.result.data;
        companyCode = logisticsResult.result.companyCode || companyCode;
        isMapTrackEnabled = Array.isArray(logisticsData?.data)
          && logisticsData.data.some(item => item.latitude && item.longitude);

        if (logisticsResult.result.orderUpdated) {
          console.log('订单已自动更新为待确认收货状态:', logisticsResult.result.orderNumber);
          wx.showToast({
            title: '物流已签收',
            icon: 'success',
            duration: 2000
          });
          setTimeout(() => {
            this.onLoad({ orderId: this.data.orderId });
          }, 1500);
        }
      }

      // 7. 显示物流信息
      if (logisticsData) {
        // 处理物流状态名称
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
        
        // 添加状态名称到物流数据
        logisticsData.stateName = stateName;
        logisticsData.stateMeaning = stateMeaning;
        logisticsData.displayStateText = displayStateText;

        // 处理地图轨迹数据
        const trackPoints = [];
        let centerLatitude = 39.908823;
        let centerLongitude = 116.397470;
        let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;

        if (isMapTrackEnabled && logisticsData.data && logisticsData.data.length > 0) {
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

              // 计算边界
              minLat = Math.min(minLat, item.latitude);
              maxLat = Math.max(maxLat, item.latitude);
              minLng = Math.min(minLng, item.longitude);
              maxLng = Math.max(maxLng, item.longitude);
            }
          });

          // 如果有轨迹点，计算中心点
          if (trackPoints.length > 0) {
            centerLatitude = (minLat + maxLat) / 2;
            centerLongitude = (minLng + maxLng) / 2;
          }
        }

        // 显示美观的物流信息弹窗
        this.setData({ 
          showLogistics: true,
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
        wx.showToast({
          title: '获取物流信息失败',
          icon: 'none'
        });
      }
    } catch (error) {
      console.error('查看物流信息失败:', error);
      wx.showToast({
        title: '查看物流信息失败',
        icon: 'none'
      });
    } finally {
      wx.hideLoading();
    }
  },

  // 更新显示的原因列表
  updateDisplayReasonList() {
    const { order, refundReasons, exchangeReasonList, localRefundReasons, localExchangeReasonList, selectedGoodsStatus, selectedRefundType, afterSalesStep, selectedAfterSalesType, supportNoReason, remainingNormalAfterSalesDays, remainingQualityAfterSalesDays } = this.data;
    
    // 根据配送类型选择对应的原因列表
    const isLocal = order?.deliveryType === 'local';
    const currentRefundReasons = isLocal ? localRefundReasons : refundReasons;
    const currentExchangeReasonList = isLocal ? localExchangeReasonList : exchangeReasonList;
    
    if (selectedAfterSalesType === 'not_received_refund') {
      // 未收到货退款：不需要原因列表
      this.setData({
        displayReasonList: []
      });
    } else if (afterSalesStep === 2 && selectedAfterSalesType === 'refund') {
      if (selectedRefundType === 'return_refund') {
        // 退货退款：使用退货退款专用原因列表
        let reasons = currentRefundReasons.return_refund || [];
        // 如果不支持7天无理由，则过滤掉7天无理由选项
        if (!supportNoReason) {
          reasons = reasons.filter(r => r.value !== 'seven_day_no_reason');
        }
        // 根据剩余售后时限过滤原因
        reasons = this.filterReasonsByTime(reasons, remainingNormalAfterSalesDays, remainingQualityAfterSalesDays);
        this.setData({
          displayReasonList: reasons
        });
      } else {
        // 退款：根据货物状态显示原因（退款不支持7天无理由）
        let reasons = currentRefundReasons[selectedGoodsStatus] || [];
        // 根据剩余售后时限过滤原因
        reasons = this.filterReasonsByTime(reasons, remainingNormalAfterSalesDays, remainingQualityAfterSalesDays);
        this.setData({
          displayReasonList: reasons
        });
      }
    } else if (afterSalesStep === 2 && selectedAfterSalesType === 'exchange') {
      // 换货
      let reasons = currentExchangeReasonList || [];
      // 如果不支持7天无理由，则过滤掉7天无理由选项
      if (!supportNoReason) {
        reasons = reasons.filter(r => r.value !== 'seven_day_no_reason');
      }
      // 根据剩余售后时限过滤原因
      reasons = this.filterReasonsByTime(reasons, remainingNormalAfterSalesDays, remainingQualityAfterSalesDays);
      this.setData({
        displayReasonList: reasons
      });
    }
  },

  // 根据剩余售后时限过滤原因
  filterReasonsByTime(reasons, remainingNormalDays, remainingQualityDays) {
    if (!reasons || reasons.length === 0) {
      return [];
    }
    
    return reasons.filter(reason => {
      if (reason.type === 'quality') {
        // 质量原因：只要质量时限没过就显示
        return remainingQualityDays > 0;
      } else {
        // 常规原因：常规时限没过就显示
        return remainingNormalDays > 0;
      }
    });
  },

  // 更新是否可以提交
  updateCanSubmit() {
    const { 
      afterSalesStep, 
      selectedAfterSalesType, 
      selectedReason, 
      selectedExchangeReason,
      refundAmount,
      contactName,
      contactPhone,
      needProof,
      afterSalesImages,
      afterSalesDescription,
      displayReasonList
    } = this.data;
    
    let canSubmit = false;
    
    if (afterSalesStep === 1) {
      // 步骤1：只要选择了售后类型就可以进入下一步
      canSubmit = !!selectedAfterSalesType;
    } else if (afterSalesStep === 2) {
      // 步骤2：需要选择原因，且有可选原因
      if (selectedAfterSalesType === 'not_received_refund') {
        // 未收到货退款：原因是选填的，可以直接进入下一步
        canSubmit = true;
      } else if (displayReasonList.length === 0) {
        // 没有可选原因，不能进入下一步
        canSubmit = false;
      } else if (selectedAfterSalesType === 'refund') {
        canSubmit = !!selectedReason;
      } else if (selectedAfterSalesType === 'exchange') {
        canSubmit = !!selectedExchangeReason;
      }
    } else if (afterSalesStep === 3) {
      // 步骤3（上传凭证）：检查凭证和描述
      if (needProof) {
        canSubmit = true;
        if (afterSalesImages.length === 0) {
          canSubmit = false;
        }
        if (!afterSalesDescription || afterSalesDescription.trim() === '') {
          canSubmit = false;
        }
      } else {
        // 不需要上传凭证时，步骤3不存在，直接可以提交
        canSubmit = true;
      }
    } else if (afterSalesStep === 4) {
      // 步骤4（填写信息）：检查所有必填字段
      canSubmit = true;
      
      // 检查退款金额（仅退款或未收到货退款时）
      if (selectedAfterSalesType === 'refund' || selectedAfterSalesType === 'not_received_refund') {
        if (!refundAmount || parseFloat(refundAmount) <= 0) {
          canSubmit = false;
        }
        // 检查退款金额不超过最大可退金额
        if (parseFloat(refundAmount) > parseFloat(this.data.maxRefundAmount)) {
          canSubmit = false;
        }
      }
      
      // 检查联系人
      if (!contactName || contactName.trim() === '') {
        canSubmit = false;
      }
      
      // 检查联系电话
      if (!contactPhone || contactPhone.trim() === '') {
        canSubmit = false;
      }
    }
    
    this.setData({
      canSubmitAfterSales: canSubmit
    });
  },

  // 申请售后
  afterSales(e) {
    const orderId = e.currentTarget.dataset.orderId;
    const products = this.data.order?.products || [];
    const supportNoReason = products.some(p => p.supportNoReasonReturn);
    
    this.setData({
      showAfterSalesTypeModal: true,
      selectedProductIndex: -1,
      selectedAfterSalesType: '',
      afterSalesStep: 1,
      selectedRefundType: 'return_refund',
      selectedGoodsStatus: 'received',
      selectedReason: '',
      selectedReasonLabel: '',
      selectedExchangeReason: '',
      selectedExchangeReasonLabel: '',
      displayReasonList: [],
      canSubmitAfterSales: false,
      supportNoReason: supportNoReason,
      pendingOrderId: orderId
    });
  },

  // 按商品申请售后
  afterSalesByProduct(e) {
    const orderId = e.currentTarget.dataset.orderId;
    const productIndex = e.currentTarget.dataset.productIndex;
    const order = this.data.order || {};
    const products = order.products || [];
    const product = products[productIndex] || {};
    
    // ========== 方案 B：入口前置校验，避免弹出"没有可选类型"的空弹窗 ==========
    const remainingQty = order.remainingAfterSalesQtyMap
      ? (order.remainingAfterSalesQtyMap[productIndex] ?? order.remainingAfterSalesQtyMap[String(productIndex)] ?? (product.quantity || 1))
      : (product.quantity || 1);
    if (remainingQty <= 0) {
      const lastText = order.lastCompletedAfterSalesTextMap
        ? (order.lastCompletedAfterSalesTextMap[productIndex] || order.lastCompletedAfterSalesTextMap[String(productIndex)] || '售后已完成')
        : '售后已完成';
      wx.showToast({
        title: `该商品已${lastText}，无法再次申请售后`,
        icon: 'none',
        duration: 2000
      });
      return;
    }

    // 当前订单状态下，弹窗 step1 是否会显示任何售后类型（与 WXML step1 判定完全对齐）
    const status = order.status || '';
    const hasAnyType = (status === 'shipping')
      || (status === 'delivered' || status === 'completed' || status === 'refund' || status === 'refund_completed');
    if (!hasAnyType) {
      wx.showToast({
        title: '当前订单状态暂不支持申请售后',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    // 常规售后 + 质量售后都过期，不建议进入空弹窗（用户进入后下一步会发现无原因可选）
    // 按当前商品的售后窗口判断：换货收到新货的件按确认收新货时间重新起算
    const productWindow = this.getProductAfterSalesWindow(productIndex);
    // 未收到货退款无时间限制，所以 shipping 状态下即使天数 <=0 仍允许进入
    if (status !== 'shipping' && productWindow.normal <= 0 && productWindow.quality <= 0) {
      wx.showToast({
        title: '已过售后期限，暂不支持申请售后',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    // 有未收到货退款且物流未签收，其他商品不能申请
    if (order.blockOtherAfterSales) {
      wx.showToast({
        title: '存在未收到货退款申请中，暂不支持其他商品单独申请售后',
        icon: 'none',
        duration: 2500
      });
      return;
    }
    
    const supportNoReason = product.supportNoReasonReturn || false;
    // 默认申请数量 = 剩余可售后数量（上面已计算），不超过商品原始数量
    const defaultApplyQty = Math.max(1, Math.min(remainingQty, product.quantity || 1));
    // 数量提示：体现已售后/剩余可申请，让用户理解为何数量受限
    const buyQtyForHint = product.quantity || 1;
    const consumedQtyForHint = Math.max(0, buyQtyForHint - remainingQty);
    const applyQtyHint = consumedQtyForHint > 0
      ? `共${buyQtyForHint}件，已售后${consumedQtyForHint}件，本次最多可申请${remainingQty}件`
      : `共${buyQtyForHint}件，可选择部分申请`;

    // 显示售后类型选择弹窗
    // 使用物流状态名称
    const logisticsState = order.logisticsState || {};
    const goodsStatusText = logisticsState.stateName || '';

    this.setData({
      showAfterSalesTypeModal: true,
      selectedProductIndex: productIndex,
      selectedAfterSalesType: '',
      afterSalesStep: 1,
      selectedRefundType: 'return_refund',
      selectedGoodsStatus: 'received',
      selectedReason: '',
      selectedReasonLabel: '',
      selectedExchangeReason: '',
      selectedExchangeReasonLabel: '',
      displayReasonList: [],
      canSubmitAfterSales: false,
      supportNoReason: supportNoReason,
      pendingOrderId: orderId,
      goodsStatusText: goodsStatusText,
      applyQty: defaultApplyQty,
      applyQtyHint: applyQtyHint
    });
  },

  preventTouchMove(e) {
    e.stopPropagation();
    return false;
  },

  onModalScroll(e) {
    const { scrollTop, scrollHeight, windowHeight } = e.detail;
    const isAtTop = scrollTop <= 0;
    const isAtBottom = scrollTop + windowHeight >= scrollHeight;
    this.setData({
      modalScrollAtTop: isAtTop,
      modalScrollAtBottom: isAtBottom
    });
  },

  onModalTouchMove(e) {
    const { deltaY } = e.touches[0];
    const { modalScrollAtTop, modalScrollAtBottom } = this.data;
    
    if (modalScrollAtTop && deltaY > 0) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    
    if (modalScrollAtBottom && deltaY < 0) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  },

  onPageScroll(e) {
  },

  // 关闭售后类型选择弹窗
  closeAfterSalesTypeModal() {
    this.setData({
      showAfterSalesTypeModal: false,
      selectedProductIndex: -1,
      selectedAfterSalesType: '',
      afterSalesStep: 1,
      selectedRefundType: 'return_refund',
      selectedGoodsStatus: 'received',
      selectedReason: '',
      selectedReasonLabel: '',
      selectedExchangeReason: '',
      selectedExchangeReasonLabel: '',
      displayReasonList: [],
      canSubmitAfterSales: false,
      supportNoReason: false,
      pendingOrderId: null,
      // 步骤3相关字段重置
      afterSalesImages: [],
      afterSalesVideos: [],
      afterSalesDescription: '',
      refundAmount: '',
      applyQty: 1,
      contactName: '',
      contactPhone: '',
      contactAddress: '',
      shippingResponsibility: 'buyer',
      remainingAfterSalesDays: 7,
      remainingNormalAfterSalesDays: 7,
      remainingQualityAfterSalesDays: 15,
      afterSalesWindowRestart: false,
      afterSalesNormalDeadline: 0,
      afterSalesQualityDeadline: 0,
      afterSalesNormalText: '',
      afterSalesQualityText: '',
      partialRefundTip: '',
      shippingRefundAmount: 0,
      shippingDeductionAmount: 0,
      shippingRefundTip: '',
      shippingRefundTipType: '',
      returnShippingCompensationAmount: 0,
      returnShippingCompensationTip: '',
      maxRefundAmount: 0,
      goodsMaxRefundAmount: 0,
      needProof: false,
      showAfterSalesRulesModal: false
    });
    this.clearAfterSalesCountdown();
  },

  showAfterSalesRules() {
    this.setData({ showAfterSalesRulesModal: true });
  },

  closeAfterSalesRulesModal() {
    this.setData({ showAfterSalesRulesModal: false });
  },

  // 设置售后类型
  setAfterSalesType(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({
      selectedAfterSalesType: type,
      afterSalesImages: [],
      afterSalesVideos: [],
      afterSalesDescription: ''
    });
    this.updateCanSubmit();
  },

  // 下一步
  nextAfterSalesStep() {
    const { afterSalesStep, selectedAfterSalesType, selectedReason, selectedExchangeReason, needProof } = this.data;
    
    if (afterSalesStep === 1) {
      // 从步骤1进入下一步
      if (!selectedAfterSalesType) {
        wx.showToast({
          title: '请选择售后类型',
          icon: 'none'
        });
        return;
      }
      
      // 未收到货退款：进入步骤2选择原因（选填）
      if (selectedAfterSalesType === 'not_received_refund') {
        this.setData({
          afterSalesStep: 2
        });
        this.updateCanSubmit();
        return;
      }
      
      // 普通售后：进入步骤2
      this.setData({
        afterSalesStep: 2
      });
      // 计算剩余售后时限
      this.calculateRemainingAfterSalesDays();
      // 更新原因列表
      this.updateDisplayReasonList();
    } else if (afterSalesStep === 2) {
      // 从步骤2进入步骤3或步骤4
      let hasReason = true;
      let currentReason = '';
      if (selectedAfterSalesType === 'refund') {
        hasReason = !!selectedReason;
        currentReason = selectedReason;
      } else if (selectedAfterSalesType === 'exchange') {
        hasReason = !!selectedExchangeReason;
        currentReason = selectedExchangeReason;
      } else if (selectedAfterSalesType === 'not_received_refund') {
        // 未收到货退款：原因是选填的，使用用户选择的原因或默认值
        hasReason = true;
        currentReason = selectedReason || 'other';
      }
      
      if (!hasReason) {
        wx.showToast({
          title: '请选择售后原因',
          icon: 'none'
        });
        return;
      }
      
      // 判断是否需要上传凭证
      const needUploadProof = this.needUploadProof(selectedAfterSalesType, '', currentReason);
      
      if (needUploadProof) {
        // 需要上传凭证，先初始化数据，然后进入步骤3
        this.initStep3Data();
        setTimeout(() => {
          this.setData({
            afterSalesStep: 3,
            needProof: true
          }, () => {
            setTimeout(() => this.updateAmountInputWidth(), 50);
          });
          this.updateCanSubmit();
        }, 50);
      } else {
        // 不需要上传凭证，先初始化数据，然后进入步骤4
        this.initStep3Data();
        setTimeout(() => {
          this.setData({
            afterSalesStep: 4,
            needProof: false
          });
          this.updateCanSubmit();
        }, 50);
      }
    } else if (afterSalesStep === 3) {
      // 从步骤3（上传凭证）进入步骤4（填写信息）
      // 只切换步骤，不重置数据，保持用户之前的修改
      this.setData({
        afterSalesStep: 4
      }, () => {
        setTimeout(() => this.updateAmountInputWidth(), 50);
      });
      this.updateCanSubmit();
    }
  },

  // 上一步
  backAfterSalesStep() {
    const { afterSalesStep } = this.data;
    
    if (afterSalesStep === 4) {
      // 从步骤4返回步骤3（如果需要上传凭证）或步骤2（如果不需要）
      const { needProof } = this.data;
      if (needProof) {
        this.setData({
          afterSalesStep: 3
        });
      } else {
        this.setData({
          afterSalesStep: 2
        });
      }
    } else if (afterSalesStep === 3) {
      // 从步骤3返回步骤2
      this.setData({
        afterSalesStep: 2
      });
    } else if (afterSalesStep === 2) {
      // 从步骤2返回步骤1
      this.setData({
        afterSalesStep: 1,
        selectedReason: '',
        selectedReasonLabel: '',
        selectedExchangeReason: '',
        selectedExchangeReasonLabel: '',
        canSubmitAfterSales: false
      });
    }
  },

  viewUploadInfo() {
    // 查看上传的凭证信息，显示弹窗
    // 生成合并的媒体列表（按上传顺序）
    const combinedMediaList = [];
    let imageIndex = 0;
    let videoIndex = 0;
    
    // 假设图片和视频是交替上传的，按顺序合并
    while (imageIndex < this.data.afterSalesImages.length || videoIndex < this.data.afterSalesVideos.length) {
      if (imageIndex < this.data.afterSalesImages.length) {
        combinedMediaList.push({
          ...this.data.afterSalesImages[imageIndex],
          type: 'image',
          originalIndex: imageIndex
        });
        imageIndex++;
      }
      if (videoIndex < this.data.afterSalesVideos.length) {
        combinedMediaList.push({
          ...this.data.afterSalesVideos[videoIndex],
          type: 'video',
          originalIndex: videoIndex
        });
        videoIndex++;
      }
    }
    
    this.setData({ 
      showUploadInfoModal: true,
      combinedMediaList: combinedMediaList
    });
  },
  
  // 从合并列表预览图片
  previewAfterSalesImageFromCombined(e) {
    const index = e.currentTarget.dataset.index;
    this.previewAfterSalesImage({ currentTarget: { dataset: { index: index } } });
  },
  
  // 从合并列表播放视频
  playAfterSalesVideoFromCombined(e) {
    const index = e.currentTarget.dataset.index;
    this.playAfterSalesVideo({ currentTarget: { dataset: { index: index } } });
  },
  
  // 关闭查看凭证弹窗
  closeUploadInfoModal() {
    this.setData({
      showUploadInfoModal: false
    });
  },

  // 设置退款类型
  setRefundType(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({
      selectedRefundType: type,
      selectedReason: '',
      selectedReasonLabel: ''
    });
    this.updateDisplayReasonList();
    this.updateCanSubmit();
  },

  // 设置货物状态
  setGoodsStatus(e) {
    const status = e.currentTarget.dataset.status;
    this.setData({
      selectedGoodsStatus: status,
      selectedReason: '',
      selectedReasonLabel: ''
    });
    this.updateDisplayReasonList();
    this.updateCanSubmit();
  },

  // 设置退款原因
  setReason(e) {
    const value = e.currentTarget.dataset.value;
    const label = e.currentTarget.dataset.label;
    this.setData({
      selectedReason: value,
      selectedReasonLabel: label
    });
    this.updateCanSubmit();
  },

  // 兼容多种时间格式：Date 对象、'YYYY-MM-DD HH[:mm:ss]' 字符串、云数据库 {_seconds} 结构
  parseAfterSalesDate(value) {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'number') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (typeof value === 'string') {
      const parsed = new Date(value.replace(' ', 'T'));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (typeof value === 'object') {
      if (value._seconds) {
        return new Date(value._seconds * 1000);
      }
      if (typeof value.toDate === 'function') {
        const parsed = value.toDate();
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      }
    }
    return null;
  },

  // 售后剩余时间分级格式化：
  // ≥2天只显示天；1~2天显示天+小时；<1天显示时+分；<1小时显示分+秒；<1分钟显示秒；0显示已过期
  formatAfterSalesCountdown(remainMs) {
    if (!Number.isFinite(remainMs) || remainMs <= 0) {
      return '已过期';
    }
    const totalSec = Math.floor(remainMs / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (days >= 2) {
      return `${days}天`;
    }
    if (days >= 1) {
      return `${days}天${hours}小时`;
    }
    if (hours >= 1) {
      return `${hours}时${mins}分`;
    }
    if (mins >= 1) {
      return `${mins}分${secs}秒`;
    }
    return `${secs}秒`;
  },

  // 计算指定商品当前可享受的售后窗口（和后端双池口径保持一致）：
  // 换货收到新货后，以确认收新货时间重新起算（普通7天/质量15天）；
  // 否则按订单签收时间（7天/15天）或发货时间（10天/15天）起算。
  // 返回常规/质量两条线的截止时间戳（null=缺少基准时间，按满额天数展示）
  getProductAfterSalesWindow(productIndex) {
    const order = this.data.order || {};
    const restartMap = order.releasedExchangeBaseTimeMap || {};
    let restartRaw = null;
    if (productIndex !== undefined && productIndex !== null && productIndex >= 0) {
      restartRaw = restartMap[productIndex] ?? restartMap[String(productIndex)] ?? null;
    }
    const restartDate = this.parseAfterSalesDate(restartRaw);

    // 判断是否已确认收货（交易成功）
    // 用 receiptTime（确认收货时间）判断而非订单状态：
    // 申请售后会把 delivered 变成 refund，但不代表用户确认了收货
    const isTransactionCompleted = !!order.receiptTime || ['completed', 'refund_completed'].includes(order.status);

    let baseDate = null;
    let normalDays;
    let windowRestarted = false;
    if (restartDate) {
      // 换货新货：收新货后重新起算售后期
      baseDate = restartDate;
      normalDays = 7;
      windowRestarted = true;
    } else if (isTransactionCompleted) {
      // 交易成功后：优先使用签收时间，回退到确认收货时间
      baseDate = this.parseAfterSalesDate(order?.logisticsState?.checkTime)
        || this.parseAfterSalesDate(order?.receiptTime);
      normalDays = 7;
    } else {
      // 交易成功前：使用发货时间（发货后10天）
      baseDate = this.parseAfterSalesDate(order?.shippingTime);
      normalDays = 10;
    }
    const qualityDays = 15;

    const calcDeadline = (days) => {
      if (!baseDate) {
        return null;
      }
      // 从基准日第二天0点开始计算（和后端保持一致）
      const startDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + 1, 0, 0, 0);
      return startDate.getTime() + days * 24 * 60 * 60 * 1000;
    };

    return {
      normalDeadline: calcDeadline(normalDays),
      qualityDeadline: calcDeadline(qualityDays),
      normalDays,
      qualityDays,
      windowRestarted
    };
  },

  // 每秒刷新售后剩余时间的文本与天数（天数用于售后原因过滤）
  updateAfterSalesCountdownTick() {
    const { afterSalesNormalDeadline, afterSalesQualityDeadline } = this.data;
    const nowMs = Date.now();
    const buildState = (deadline, maxDays) => {
      if (!deadline) {
        // 缺少基准时间：保持满额展示（与历史行为一致）
        return { days: maxDays, text: `${maxDays}天` };
      }
      const remainMs = deadline - nowMs;
      if (remainMs <= 0) {
        return { days: 0, text: '已过期' };
      }
      return {
        days: Math.min(maxDays, Math.ceil(remainMs / (24 * 60 * 60 * 1000))),
        text: this.formatAfterSalesCountdown(remainMs)
      };
    };
    const normalState = buildState(afterSalesNormalDeadline || null, Number(this.data.afterSalesNormalMaxDays) || 7);
    const qualityState = buildState(afterSalesQualityDeadline || null, Number(this.data.afterSalesQualityMaxDays) || 15);
    this.setData({
      remainingNormalAfterSalesDays: normalState.days,
      remainingQualityAfterSalesDays: qualityState.days,
      remainingAfterSalesDays: normalState.days,
      afterSalesNormalText: normalState.text,
      afterSalesQualityText: qualityState.text
    });
  },

  clearAfterSalesCountdown() {
    if (this.afterSalesCountdownTimer) {
      clearInterval(this.afterSalesCountdownTimer);
      this.afterSalesCountdownTimer = null;
    }
  },

  // 计算剩余售后时限（和后端保持一致），优先按当前弹窗选中商品的新货窗口计算；
  // 保存截止时间戳并启动每秒倒计时（精确到秒，结束显示"已过期"）
  calculateRemainingAfterSalesDays() {
    const productIndex = Number(this.data.selectedProductIndex);
    const windowInfo = this.getProductAfterSalesWindow(productIndex >= 0 ? productIndex : undefined);

    console.log('=== 售后时效计算调试 ===');
    console.log('selectedProductIndex:', productIndex);
    console.log('窗口是否按换货新货重新起算:', windowInfo.windowRestarted);
    console.log('常规截止:', windowInfo.normalDeadline, '质量截止:', windowInfo.qualityDeadline);

    this.clearAfterSalesCountdown();
    this.setData({
      afterSalesNormalDeadline: windowInfo.normalDeadline || 0,
      afterSalesQualityDeadline: windowInfo.qualityDeadline || 0,
      afterSalesNormalMaxDays: windowInfo.normalDays,
      afterSalesQualityMaxDays: windowInfo.qualityDays,
      afterSalesWindowRestart: windowInfo.windowRestarted
    }, () => {
      this.updateAfterSalesCountdownTick();
      this.afterSalesCountdownTimer = setInterval(() => {
        this.updateAfterSalesCountdownTick();
      }, 1000);
    });
  },

  // 初始化步骤3数据
  initStep3Data() {
    const { order, selectedProductIndex, selectedReason, selectedAfterSalesType, applyQty } = this.data;

    // 剩余可售后数量（已扣除进行中/已完成的占用）
    const remainingQtyMap = order.remainingAfterSalesQtyMap || {};
    const remainingQty = remainingQtyMap[selectedProductIndex] ?? remainingQtyMap[String(selectedProductIndex)] ?? 0;

    // 该商品行剩余可退金额（单件部分金额退款后补差场景，金额可能小于按件数算出的金额）
    const remainAmountMap = order.refundableRemainAmountMap || {};
    const remainAmount = Number(remainAmountMap[selectedProductIndex] ?? remainAmountMap[String(selectedProductIndex)] ?? 0) || 0;
    const refundedMap = order.refundedAmountMap || {};
    const refundedAmount = Number(refundedMap[selectedProductIndex] ?? refundedMap[String(selectedProductIndex)] ?? 0) || 0;

    // 最大退款金额（商品口径，未扣运费）= 单价 × 剩余可售后数量
    let goodsMaxRefundAmount = 0;
    if (selectedProductIndex >= 0 && order.products[selectedProductIndex]) {
      const product = order.products[selectedProductIndex];
      const unitPrice = Number(product.price || 0) || 0;
      goodsMaxRefundAmount = unitPrice * (remainingQty || product.quantity || 1);
    } else if (order.totalAmount) {
      goodsMaxRefundAmount = order.totalAmount;
    }
    // 金额池封顶：已部分退款时不能超过剩余可退金额
    if (remainAmount > 0) {
      goodsMaxRefundAmount = Math.min(goodsMaxRefundAmount, remainAmount);
    }
    goodsMaxRefundAmount = Math.round(goodsMaxRefundAmount * 100) / 100;

    // 当前选择数量对应的商品金额（同时被补差金额池封顶）：
    // "最多可退"必须随数量选择器联动（选2件时=单价×2，而不是全部可申请数量的金额池）
    const step3UnitPrice = (selectedProductIndex >= 0 && order.products[selectedProductIndex])
      ? (Number(order.products[selectedProductIndex].price) || 0)
      : 0;
    const qtyGoodsAmount = Math.round(
      Math.min(Number((step3UnitPrice * (applyQty || 1)).toFixed(2)) || 0, goodsMaxRefundAmount) * 100
    ) / 100;

    // 运费退款预览：最终售后类型映射与提交逻辑保持一致（用当前选择数量的商品金额估算含运费共退）
    let previewFinalType = 'return_refund';
    if (selectedAfterSalesType === 'exchange') {
      previewFinalType = 'exchange';
    } else if (selectedAfterSalesType === 'not_received_refund') {
      previewFinalType = 'refund_not_received';
    } else if (this.data.selectedRefundType === 'return_refund') {
      previewFinalType = 'return_refund';
    } else {
      previewFinalType = this.data.selectedGoodsStatus === 'received' ? 'refund_received' : 'refund_not_received';
    }
    const shippingPreview = this.resolveShippingRefundPreview(
      order,
      previewFinalType,
      selectedAfterSalesType === 'exchange' ? this.data.selectedExchangeReason : selectedReason,
      applyQty,
      qtyGoodsAmount
    );

    // 买家责任整单退款：需承担的原运费（包邮差额）直接内扣，"最多可退"展示净额（与后端净额封顶一致）
    const shippingDeduction = shippingPreview.shippingRefundTipType === 'deduct'
      ? (Math.round((Number(shippingPreview.shippingDeductionAmount) || 0) * 100) / 100)
      : 0;
    const maxRefundAmount = Math.round(Math.max(0, qtyGoodsAmount - shippingDeduction) * 100) / 100;

    // 默认退款金额：补差场景默认剩余可退全额；否则按当前 applyQty 计算（与数量选择器一致）；
    // 两者均已被当前选择数量封顶；买家责任整单时金额已是扣除运费后的净额
    let refundAmount;
    if (remainAmount > 0 && refundedAmount > 0) {
      refundAmount = Number.isInteger(maxRefundAmount) ? maxRefundAmount.toString() : maxRefundAmount.toFixed(2);
    } else {
      const rawRefund = Math.round(Math.max(0, qtyGoodsAmount - shippingDeduction) * 100) / 100;
      refundAmount = Number.isInteger(rawRefund) ? rawRefund.toString() : rawRefund.toFixed(2);
    }
    // 部分退款补差提示（最多可退为内扣运费后的净额）
    const partialRefundTip = refundedAmount > 0 && (remainAmount > 0 || maxRefundAmount > 0)
      ? `该商品已退款 ¥${refundedAmount}，本次最多可退 ¥${maxRefundAmount}`
      : '';
    
    // 获取联系人信息（从订单地址中获取）
    let contactName = '';
    let contactPhone = '';
    let contactAddress = '';
    if (order.address) {
      contactName = order.address.userName || '';
      contactPhone = order.address.telNumber || '';
      // 拼接地址信息
      const province = order.address.provinceName || '';
      const city = order.address.cityName || '';
      const district = order.address.districtName || '';
      const detail = order.address.detailInfo || '';
      contactAddress = [province, city, district, detail].filter(Boolean).join(' ');
    }
    
    // 判断是否需要上传凭证
    const needProof = this.needUploadProof(selectedAfterSalesType, '', selectedReason);

    // 计算运费归属
    const shippingResponsibility = this.getShippingResponsibility(selectedReason);

    // 计算剩余售后时限
    this.calculateRemainingAfterSalesDays();

    this.setData({
      goodsMaxRefundAmount,
      maxRefundAmount: maxRefundAmount,
      refundAmount: refundAmount,
      partialRefundTip,
      contactName: contactName,
      contactPhone: contactPhone,
      contactAddress: contactAddress,
      needProof: needProof,
      shippingResponsibility: shippingResponsibility,
      shippingRefundAmount: shippingPreview.shippingRefundAmount,
      shippingDeductionAmount: shippingPreview.shippingDeductionAmount,
      shippingRefundTip: shippingPreview.shippingRefundTip,
      shippingRefundTipType: shippingPreview.shippingRefundTipType,
      returnShippingCompensationAmount: shippingPreview.returnShippingCompensationAmount,
      returnShippingCompensationTip: shippingPreview.returnShippingCompensationTip,
      afterSalesImages: [],
      afterSalesDescription: ''
    }, () => {
      setTimeout(() => this.updateAmountInputWidth(), 50);
    });
  },
  
  // 判断是否需要上传凭证
  needUploadProof(refundType, goodsStatus, reasonValue) {
    // 需要强制上传凭证的原因列表
    const needProofReasons = [
      'size_mismatch', 'color_mismatch', 'material_mismatch', 'fade', 'quality', 
      'missing', 'damaged', 'wrong_item', 'empty_package', 'damaged_rejected'
    ];
    return needProofReasons.includes(reasonValue);
  },
  
  // 获取运费归属
  getShippingResponsibility(reasonValue) {
    // 卖家责任的原因
    const sellerReasons = [
      'size_mismatch', 'color_mismatch', 'material_mismatch', 'fade', 'quality',
      'missing', 'damaged', 'wrong_item', 'empty_package', 'damaged_rejected',
      'late_delivery'
    ];
    return sellerReasons.includes(reasonValue) ? 'seller' : 'buyer';
  },

  // 售后运费退款/扣减预览（仅展示用，判定口径与后端 resolveApplyShippingRefund 一致；最终以后端为准）
  // 返回 { shippingRefundAmount, shippingDeductionAmount, shippingRefundTip, shippingRefundTipType: 'include'|'exclude'|'deduct'|'none',
  //        returnShippingCompensationAmount, returnShippingCompensationTip }
  // include=运费随本次退款；exclude=运费不在退款范围；deduct=买家承担原运费，已内扣到"最多可退"；none=不涉及运费（说明性文案）
  // returnShippingCompensation*=卖家责任时买家寄回旧品的固定运费补偿（与发货运费相互独立）
  resolveShippingRefundPreview(order, finalType, reasonCode, applyQty, goodsRefundAmount) {
    const fee = Math.round((Number(order?.shippingFeeAmount) || 0) * 100) / 100;
    const originalFee = Math.round((Number(order?.originalShippingFeeAmount) || 0) * 100) / 100;
    const empty = { shippingRefundAmount: 0, shippingDeductionAmount: 0, shippingRefundTip: '', shippingRefundTipType: '' };
    const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
    const REFUND_TYPES = ['refund', 'quality_refund', 'return_refund', 'quality_return_refund', 'refund_received', 'refund_not_received'];
    // 与后端 QUALITY_REASONS 严格对齐（getShippingResponsibility 的列表更宽，不能直接复用）
    const QUALITY_REASONS = ['size_mismatch', 'color_mismatch', 'material_mismatch', 'fade', 'quality', 'missing', 'damaged', 'wrong_item'];
    const isSellerResponsible = ['quality_refund', 'quality_return_refund'].includes(finalType)
      || QUALITY_REASONS.includes(String(reasonCode || ''));

    // 整单判定：历史有效明细 + 本次申请覆盖全部件数，且历史不含换货明细
    const totalOrderQty = (order.products || []).reduce(
      (sum, p) => sum + (Number(p.quantity || 0) || 0), 0
    );
    const coveredQty = (Number(order.validAfterSalesCoveredQty) || 0) + (Number(applyQty) || 0);
    const isWholeOrder = coveredQty >= totalOrderQty && !order.hasExchangeAfterSalesHistory;

    // 寄回运费补偿：优先按本单寄出规则运费（包邮单取规则运费，与卖家寄出成本对称），
    // 订单无运费时回退商家配置兜底额；独立于发货运费逻辑先行计算
    const comp = this.buildReturnShippingCompensationPreview(order, finalType, reasonCode, isWholeOrder);
    const withComp = (r) => ({
      ...r,
      returnShippingCompensationAmount: comp.amount,
      returnShippingCompensationTip: comp.tip
    });

    // 无运费（含原运费）/ 换货：不展示发货运费提示（寄回补偿不受影响）
    if ((fee <= 0 && originalFee <= 0) || finalType === 'exchange' || finalType === 'quality_exchange') {
      return withComp(empty);
    }
    const committed = Math.round((Number(order?.committedShippingRefundAmount) || 0) * 100) / 100;
    const remaining = Math.round((fee - committed) * 100) / 100;
    const committedDeduction = Math.round((Number(order?.committedShippingDeductionAmount) || 0) * 100) / 100;
    // 扣减额 = 原运费 − 实付运费（包邮差额），运费整单只扣一次
    const deductionRemaining = Math.round((Math.max(0, originalFee - fee) - committedDeduction) * 100) / 100;
    const goodsAmount = Math.round((Number(goodsRefundAmount) || 0) * 100) / 100;
    const noneTip = (text) => ({
      shippingRefundAmount: 0,
      shippingDeductionAmount: 0,
      shippingRefundTipType: 'none',
      shippingRefundTip: text
    });

    // 未收到货：配送服务未完成，不扣运费；有实付运费则随商品款一并退还
    if (finalType === 'refund_not_received') {
      if (remaining > 0.01) {
        return withComp({
          shippingRefundAmount: remaining,
          shippingDeductionAmount: 0,
          shippingRefundTipType: 'include',
          shippingRefundTip: `未收到货退款，本次退款含运费 ¥${fmt(remaining)}，预计共退 ¥${fmt(Math.round((goodsAmount + remaining) * 100) / 100)}`
        });
      }
      return withComp(noneTip('未收到货退款，配送未完成，不扣除运费'));
    }

    if (!REFUND_TYPES.includes(finalType)) {
      return withComp(empty);
    }

    // 运费承担规则：按"责任 × 整单/部分"取本单配置（缺省回落与后端一致）
    const rule = this.getShippingFeeRuleFront(isSellerResponsible, isWholeOrder);

    // 规则开启扣减：买家承担下单时已免的原运费，内扣到最多可退金额（后端不再二次扣减）
    if (rule.deductOutbound && deductionRemaining > 0.01) {
      return withComp({
        shippingRefundAmount: 0,
        shippingDeductionAmount: deductionRemaining,
        shippingRefundTipType: 'deduct',
        shippingRefundTip: isWholeOrder
          ? `按当前运费承担规则，需承担下单时已免的原运费 ¥${fmt(deductionRemaining)}，该费用已从最多可退金额中扣除`
          : `部分退货按当前规则需承担原运费差额 ¥${fmt(deductionRemaining)}，已从最多可退金额中扣除`
      });
    }

    // 卖家责任整单：运费由卖家承担，不扣除；有实付运费则一并退还
    if (isSellerResponsible && isWholeOrder && remaining > 0.01) {
      return withComp({
        shippingRefundAmount: remaining,
        shippingDeductionAmount: 0,
        shippingRefundTipType: 'include',
        shippingRefundTip: `卖家承担运费，本次退款含运费 ¥${fmt(remaining)}，预计共退 ¥${fmt(Math.round((goodsAmount + remaining) * 100) / 100)}`
      });
    }

    // 卖家责任整单但无实付运费可退：明确不扣除
    if (isSellerResponsible && isWholeOrder) {
      return withComp(noneTip('卖家承担运费，本次退款不扣除运费'));
    }

    // 其余：部分退款 / 买家责任整单但实付了运费（商品款照退，运费不退）
    if (remaining > 0.01) {
      return withComp({
        shippingRefundAmount: 0,
        shippingDeductionAmount: 0,
        shippingRefundTipType: 'exclude',
        shippingRefundTip: isWholeOrder
          ? `运费 ¥${fmt(remaining)} 由买家承担，不在本次退款范围内`
          : `部分退款，运费 ¥${fmt(remaining)} 不在本次退款范围内`
      });
    }
    // 包邮订单且无运费资金进出：也要明确说明当前操作不扣除运费
    return withComp(noneTip(isWholeOrder ? '本次退款不扣除运费' : '部分退款，不扣除运费'));
  },

  // 读取商家配置的寄回运费固定补偿额 + 运费承担规则（settings.afterSalesTimeConfig，兼容平铺字段）
  async loadReturnShippingCompensationConfig() {
    try {
      const res = await wx.cloud.database().collection('settings').limit(1).get();
      const settingsDoc = (res.data && res.data[0]) || {};
      const cfg = settingsDoc.afterSalesTimeConfig || {};
      // 缺省回落与后端 getServiceTimeConfig 默认值保持一致（10元），避免"实际补偿但买家端无提示"
      const raw = Number(
        cfg.returnShippingCompensationAmount ?? settingsDoc.returnShippingCompensationAmount ?? 10
      );
      const amount = Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : 0;
      // 运费承担规则（4 个场景；缺省回落与后端 DEFAULT_SHIPPING_FEE_RULES 一致）
      const DEFAULT_RULES = [
        { key: 'buyer_partial', label: '买家原因·部分退货', deductOutbound: false, compensateReturn: false },
        { key: 'seller_partial', label: '卖家原因·部分退货', deductOutbound: false, compensateReturn: true },
        { key: 'buyer_whole', label: '买家原因·整单退货', deductOutbound: true, compensateReturn: false },
        { key: 'seller_whole', label: '卖家原因·整单退货', deductOutbound: false, compensateReturn: true }
      ];
      const rawRules = Array.isArray(cfg.shippingFeeRules) ? cfg.shippingFeeRules : settingsDoc.shippingFeeRules;
      const sourceRules = Array.isArray(rawRules) ? rawRules : [];
      const rules = DEFAULT_RULES.map((def) => {
        const found = sourceRules.find((r) => r && r.key === def.key);
        return {
          key: def.key,
          label: def.label,
          deductOutbound: found && typeof found.deductOutbound === 'boolean' ? found.deductOutbound : def.deductOutbound,
          compensateReturn: found && typeof found.compensateReturn === 'boolean' ? found.compensateReturn : def.compensateReturn
        };
      });
      this.setData({ returnShippingCompensationConfig: amount, shippingFeeRules: rules });
      // 配置异步就绪时售后表单可能已打开，按当前选择重算一次运费/补偿提示
      if (this.data.afterSalesStep >= 3 && this.data.selectedProductIndex >= 0) {
        this.updateRefundAmount();
      }
    } catch (err) {
      console.warn('读取寄回运费补偿配置失败:', err);
    }
  },

  // 取运费承担规则（与后端 getShippingFeeRule 同口径）
  // 返回 { deductOutbound, compensateReturn }
  getShippingFeeRuleFront(isSeller, isWholeOrder) {
    const rules = Array.isArray(this.data.shippingFeeRules) ? this.data.shippingFeeRules : [];
    const key = isSeller
      ? (isWholeOrder ? 'seller_whole' : 'seller_partial')
      : (isWholeOrder ? 'buyer_whole' : 'buyer_partial');
    const found = rules.find((r) => r && r.key === key);
    const DEFAULTS = {
      buyer_partial: { deductOutbound: false, compensateReturn: false },
      seller_partial: { deductOutbound: false, compensateReturn: true },
      buyer_whole: { deductOutbound: true, compensateReturn: false },
      seller_whole: { deductOutbound: false, compensateReturn: true }
    };
    const def = DEFAULTS[key] || { deductOutbound: false, compensateReturn: false };
    return {
      deductOutbound: found && typeof found.deductOutbound === 'boolean' ? found.deductOutbound : def.deductOutbound,
      compensateReturn: found && typeof found.compensateReturn === 'boolean' ? found.compensateReturn : def.compensateReturn
    };
  },

  // 寄回运费补偿预览（判定口径与后端 resolveApplyReturnShippingCompensation 一致）
  // 金额优先取本单寄出规则运费（包邮订单取规则运费而非实付0）；订单无任何运费时回退设置页兜底额
  // 是否补偿按"运费承担规则"中"对应责任 × 整单/部分"的 compensateReturn 决定
  buildReturnShippingCompensationPreview(order, finalType, reasonCode, isWholeOrder) {
    const RETURNABLE_TYPES = ['return_refund', 'quality_return_refund', 'exchange', 'quality_exchange'];
    if (!RETURNABLE_TYPES.includes(finalType)) {
      return { amount: 0, tip: '' };
    }
    const QUALITY_REASONS = ['size_mismatch', 'color_mismatch', 'material_mismatch', 'fade', 'quality', 'missing', 'damaged', 'wrong_item'];
    const isSeller = ['quality_return_refund', 'quality_exchange'].includes(finalType)
      || QUALITY_REASONS.includes(String(reasonCode || ''));
    // 运费承担规则决定是否补偿（缺省：卖家责任补偿，买家责任不补偿）
    const rule = this.getShippingFeeRuleFront(isSeller, isWholeOrder);
    if (!rule.compensateReturn) {
      return { amount: 0, tip: '' };
    }
    // 与后端 getOrderOriginalShippingFee 同口径：规则运费优先，缺失退化为实付运费，再缺失用配置兜底
    const originalFee = Math.round((Number(order?.originalShippingFeeAmount) || 0) * 100) / 100;
    const paidFee = Math.round((Number(order?.shippingFeeAmount) || 0) * 100) / 100;
    const configFallback = Math.round((Number(this.data.returnShippingCompensationConfig) || 0) * 100) / 100;
    const baseAmount = originalFee > 0 ? originalFee : (paidFee > 0 ? paidFee : configFallback);
    const amount = Math.min(baseAmount, 1000);
    if (!(amount > 0)) {
      return { amount: 0, tip: '' };
    }
    const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
    const isExchange = finalType === 'exchange' || finalType === 'quality_exchange';
    return {
      amount,
      tip: isExchange
        ? `寄回运费由商家承担，收到新货后预计补偿 ¥${fmt(amount)}（换货完成后到账）`
        : `寄回运费由商家承担，退款后预计补偿 ¥${fmt(amount)}（与退款一并到账）`
    };
  },

  // 获取视频缩略图（当thumbTempFilePath为空时使用）
  getVideoThumbnail(item) {
    // 优先使用微信返回的封面图
    if (item.thumbTempFilePath) {
      return item.thumbTempFilePath;
    }
    // 如果没有封面图，尝试从视频信息中获取
    if (item.thumb) {
      return item.thumb;
    }
    // 返回空字符串，在WXML中通过样式显示默认图标
    return '';
  },

  // 显示视频录制建议
  showVideoTips() {
    this.setData({ showVideoTipsModal: true });
  },

  // 关闭视频录制建议
  closeVideoTipsModal() {
    this.setData({ showVideoTipsModal: false });
  },

  // 选择售后凭证（支持图片和视频）
  chooseAfterSalesMedia() {
    const that = this;
    const currentCount = that.data.afterSalesImages.length + that.data.afterSalesVideos.length;
    
    wx.chooseMedia({
      count: 9 - currentCount,
      mediaType: ['image', 'video'],
      sourceType: ['album', 'camera'],
      maxDuration: 30, // 视频最大时长30秒（考虑开箱视频需求）
      camera: 'back',
      success: (res) => {
        if (!res || !res.tempFiles || res.tempFiles.length === 0) {
          wx.showToast({
            title: '视频大于30秒或文件过大，请重新选择',
            icon: 'none'
          });
          return;
        }
        
        // 先检查是否有视频超过30秒
        const longVideos = res.tempFiles.filter(item => item.fileType === 'video' && item.duration && item.duration > 30);
        if (longVideos.length > 0) {
          wx.showToast({
            title: '视频大于30秒，请重新选择',
            icon: 'none',
            duration: 2000
          });
          return;
        }
        
        const newImages = [...that.data.afterSalesImages];
        const newVideos = [...that.data.afterSalesVideos];
        
        res.tempFiles.forEach(item => {
          if (item.fileType === 'image') {
            newImages.push({
              path: item.tempFilePath,
              type: 'image',
              thumb: item.tempFilePath
            });
          } else if (item.fileType === 'video') {
            // 处理视频封面图 - 优先使用微信返回的封面
            let thumbPath = '';
            if (item.thumbTempFilePath) {
              thumbPath = item.thumbTempFilePath;
            } else if (item.thumb) {
              thumbPath = item.thumb;
            }
            newVideos.push({
              path: item.tempFilePath,
              type: 'video',
              thumb: thumbPath,
              duration: item.duration || 0
            });
          }
        });
        
        // 检查是否有视频刚好等于30秒（被微信截取过）
        const clippedVideos = res.tempFiles.filter(item => item.fileType === 'video' && item.duration === 30);
        if (clippedVideos.length > 0) {
          wx.showToast({
            title: '视频已截取为30秒',
            icon: 'none',
            duration: 2000
          });
        }
        
        that.setData({
          afterSalesImages: newImages,
          afterSalesVideos: newVideos
        });
        that.updateCanSubmit();
      },
      fail: (err) => {
        console.error('选择媒体失败:', err);
        if (err.errMsg && err.errMsg.includes('cancel')) {
          // 用户取消选择，不提示
        } else if (err.errMsg && (err.errMsg.includes('video') || err.errMsg.includes('duration') || err.errMsg.includes('size') || err.errMsg.includes('fail'))) {
          // 视频相关错误，可能是时长超过限制或文件过大
          wx.showToast({
            title: '视频大于30秒或文件过大，请重新选择',
            icon: 'none',
            duration: 2000
          });
        } else {
          wx.showToast({
            title: '选择媒体失败',
            icon: 'none'
          });
        }
      }
    });
  },
  
  // 删除售后凭证图片
  deleteAfterSalesImage(e) {
    const index = e.currentTarget.dataset.index;
    const images = [...this.data.afterSalesImages];
    images.splice(index, 1);
    this.setData({
      afterSalesImages: images
    });
    this.updateCanSubmit();
  },
  
  // 删除售后凭证视频
  deleteAfterSalesVideo(e) {
    const index = e.currentTarget.dataset.index;
    const videos = [...this.data.afterSalesVideos];
    videos.splice(index, 1);
    this.setData({
      afterSalesVideos: videos
    });
    this.updateCanSubmit();
  },
  
  // 预览售后凭证图片
  previewAfterSalesImage(e) {
    const index = e.currentTarget.dataset.index;
    const images = this.data.afterSalesImages.map(item => item.path);
    wx.previewImage({
      current: images[index],
      urls: images
    });
  },
  
  // 播放售后凭证视频
  playAfterSalesVideo(e) {
    const index = e.currentTarget.dataset.index;
    const videos = this.data.afterSalesVideos;
    if (videos.length > 0) {
      const sources = videos.map(item => ({
        url: item.path,
        type: 'video'
      }));
      wx.previewMedia({
        sources: sources,
        current: index
      });
    }
  },
  
  // 售后描述输入
  onAfterSalesDescriptionInput(e) {
    this.setData({
      afterSalesDescription: e.detail.value
    });
    this.updateCanSubmit();
  },
  
  // 退款金额输入
  onRefundAmountInput(e) {
    let value = e.detail.value;
    const maxAmount = this.data.maxRefundAmount;
    
    // 验证输入的金额不超过最大可退金额
    if (value && parseFloat(value) > parseFloat(maxAmount)) {
      value = maxAmount.toString();
      wx.showToast({
        title: '退款金额不能超过' + maxAmount,
        icon: 'none',
        duration: 2000
      });
    }
    
    // 验证输入的金额不能小于0
    if (value && parseFloat(value) < 0) {
      value = '0';
      wx.showToast({
        title: '退款金额不能小于0',
        icon: 'none',
        duration: 2000
      });
    }
    
    // 含运费退款时，"预计共退"金额随用户编辑的商品退款额联动；
    // 内扣运费（deduct）口径下输入金额已是净额（最多可退已扣除运费），提示文案为静态说明，无需联动
    const patchData = { refundAmount: value };
    const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
    if (this.data.shippingRefundTipType === 'include' && Number(this.data.shippingRefundAmount) > 0) {
      const shippingPart = Math.round((Number(this.data.shippingRefundAmount) || 0) * 100) / 100;
      const total = Math.round((Number(value || 0) + shippingPart) * 100) / 100;
      patchData.shippingRefundTip = `本次退款含运费 ¥${fmt(shippingPart)}，预计共退 ¥${fmt(total)}`;
    }
    this.setData(patchData, () => {
      setTimeout(() => this.updateAmountInputWidth(), 0);
    });
    this.updateCanSubmit();
  },

  // 更新输入框宽度
  updateAmountInputWidth() {
    const query = wx.createSelectorQuery().in(this);
    query.select('.after-sales-form__amount-mirror').boundingClientRect(rect => {
      if (rect && rect.width) {
        this.setData({ amountInputWidth: rect.width + 4 });
      }
    }).exec();
  },
  
  // 联系人输入
  onContactNameInput(e) {
    this.setData({
      contactName: e.detail.value
    });
    this.updateCanSubmit();
  },
  
  // 联系电话输入
  onContactPhoneInput(e) {
    this.setData({
      contactPhone: e.detail.value
    });
    this.updateCanSubmit();
  },
  
  // 联系地址输入
  onContactAddressInput(e) {
    this.setData({
      contactAddress: e.detail.value
    });
    this.updateCanSubmit();
  },
  
  // 编辑地址（点击编辑图标）
  editAddress() {
    // 使用微信小程序地址选择API
    wx.chooseAddress({
      success: (res) => {
        console.log('选择地址成功:', res);
        // 将地址保存到本地存储
        wx.setStorageSync('userAddress', res);
        
        // 更新页面数据
        const province = res.provinceName || '';
        const city = res.cityName || '';
        const district = res.countyName || '';
        const detail = res.detailInfo || '';
        const contactAddress = [province, city, district, detail].filter(Boolean).join(' ');
        
        this.setData({
          contactName: res.userName || '',
          contactPhone: res.telNumber || '',
          contactAddress: contactAddress
        });
      },
      fail: (err) => {
        console.error('选择地址失败:', err);
        if (err.errType === "permission_denied") {
          // 引导用户授权地址权限
          wx.showModal({
            title: "需要地址权限",
            content: "请授权地址权限以选择收货地址",
            success: (modalRes) => {
              if (modalRes.confirm) {
                wx.openSetting({
                  success: (settingRes) => {
                    if (settingRes.authSetting['scope.address']) {
                      // 用户授权后，重新选择地址
                      this.editAddress();
                    } else {
                      wx.showToast({
                        title: '用户拒绝授权地址权限',
                        icon: 'none'
                      });
                    }
                  }
                });
              }
            }
          });
        } else {
          wx.showToast({
            title: '选择地址失败',
            icon: 'none'
          });
        }
      }
    });
  },
  
  // 减少售后数量
  decreaseApplyQty() {
    const { applyQty } = this.data;
    if (applyQty > 1) {
      this.setData({
        applyQty: applyQty - 1
      });
      this.updateRefundAmount();
    }
  },

  // 增加售后数量
  increaseApplyQty() {
    const { applyQty, selectedProductIndex, order } = this.data;
    // 上限为剩余可售后数量（已扣除进行中/已完成的占用）
    const remainingQtyMap = order.remainingAfterSalesQtyMap || {};
    const maxQty = remainingQtyMap[selectedProductIndex] ?? remainingQtyMap[String(selectedProductIndex)] ?? (order.products && order.products[selectedProductIndex] ? (order.products[selectedProductIndex].quantity || 1) : 1);
    if (applyQty < maxQty) {
      this.setData({
        applyQty: applyQty + 1
      });
      this.updateRefundAmount();
    }
  },

  // 根据售后数量更新退款金额
  updateRefundAmount() {
    const { applyQty, selectedProductIndex, order, goodsMaxRefundAmount, selectedAfterSalesType,
      selectedRefundType, selectedGoodsStatus, selectedReason, selectedExchangeReason } = this.data;
    if (selectedProductIndex >= 0 && order.products[selectedProductIndex]) {
      const product = order.products[selectedProductIndex];
      const unitPrice = Number(product.price || 0) || 0;
      // 商品口径金额（未扣运费）：封顶为商品可退上限（补差场景金额池更小）
      const goodsBase = Number(goodsMaxRefundAmount) > 0
        ? Number(goodsMaxRefundAmount)
        : Infinity;
      const goodsAmount = Math.round(
        Math.min(Number((unitPrice * applyQty).toFixed(2)) || 0, goodsBase) * 100
      ) / 100;

      // 数量变化影响"整单退款"判定，重算运费提示与净额上限
      let finalType = 'return_refund';
      if (selectedAfterSalesType === 'exchange') {
        finalType = 'exchange';
      } else if (selectedAfterSalesType === 'not_received_refund') {
        finalType = 'refund_not_received';
      } else if (selectedRefundType === 'return_refund') {
        finalType = 'return_refund';
      } else {
        finalType = selectedGoodsStatus === 'received' ? 'refund_received' : 'refund_not_received';
      }
      const preview = this.resolveShippingRefundPreview(
        order,
        finalType,
        selectedAfterSalesType === 'exchange' ? selectedExchangeReason : selectedReason,
        applyQty,
        goodsAmount
      );
      // 买家责任整单：原运费内扣，最多可退与默认金额均为净额
      const deduction = preview.shippingRefundTipType === 'deduct'
        ? Math.round((Number(preview.shippingDeductionAmount) || 0) * 100) / 100
        : 0;
      // 最多可退按"当前选择数量"封顶（goodsAmount 已取 单价×applyQty 与补差金额池的较小值），
      // 不能直接用 goodsMaxRefundAmount（那是全部可申请数量的金额池，部分件数申请时会虚高）
      const effectiveMax = Math.round(Math.max(0, goodsAmount - deduction) * 100) / 100;
      const netAmount = Math.round(Math.max(0, goodsAmount - deduction) * 100) / 100;
      // 与 initStep3Data 保持一致：整数不补小数位，非整数保留两位，避免 28 / 28.00 混用
      const amountText = Number.isInteger(netAmount) ? netAmount.toString() : netAmount.toFixed(2);

      // 补差提示随净额上限联动
      const refundedMap = order.refundedAmountMap || {};
      const refundedAmount = Number(
        refundedMap[selectedProductIndex] ?? refundedMap[String(selectedProductIndex)] ?? 0
      ) || 0;
      const partialRefundTip = refundedAmount > 0
        ? `该商品已退款 ¥${refundedAmount}，本次最多可退 ¥${effectiveMax}`
        : '';

      this.setData({
        maxRefundAmount: effectiveMax,
        refundAmount: amountText,
        partialRefundTip,
        shippingRefundAmount: preview.shippingRefundAmount,
        shippingDeductionAmount: preview.shippingDeductionAmount,
        shippingRefundTip: preview.shippingRefundTip,
        shippingRefundTipType: preview.shippingRefundTipType,
        returnShippingCompensationAmount: preview.returnShippingCompensationAmount,
        returnShippingCompensationTip: preview.returnShippingCompensationTip
      });
    }
  },

  // 设置换货原因
  setExchangeReason(e) {
    const value = e.currentTarget.dataset.value;
    const label = e.currentTarget.dataset.label;
    this.setData({
      selectedExchangeReason: value,
      selectedExchangeReasonLabel: label
    });
    this.updateCanSubmit();
  },

  // 判断是否需要强制上传凭证
  needUploadProof(refundType, goodsStatus, reasonValue) {
    // 需要强制上传凭证的原因列表
    const needProofReasons = [
      'size_mismatch', 'color_mismatch', 'material_mismatch', 'fade', 'quality', 
      'missing', 'damaged', 'wrong_item', 'empty_package', 'damaged_rejected'
    ];
    return needProofReasons.includes(reasonValue);
  },

  // 提交售后（步骤2点击下一步时使用，跳转到步骤3）
  submitAfterSales() {
    this.nextAfterSalesStep();
  },
  
  // 提交售后申请（步骤3点击提交申请时使用）
  async submitAfterSalesApply() {
    const { 
      selectedAfterSalesType, 
      pendingOrderId, 
      selectedProductIndex, 
      selectedRefundType, 
      selectedGoodsStatus, 
      selectedReason, 
      selectedReasonLabel, 
      selectedExchangeReason, 
      selectedExchangeReasonLabel,
      refundAmount,
      contactName,
      contactPhone,
      contactAddress,
      afterSalesImages,
      afterSalesVideos,
      afterSalesDescription,
      order
    } = this.data;

    // 未收到货退款的规则（整单退款金额、拦截/拒签处理）已在申请表单页面内统一提示，
    // 此处不再二次弹窗，直接提交
    // 显示加载提示
    wx.showLoading({
      title: '提交中...'
    });
    
    try {
      // 确定售后类型
      let afterSalesType = 'refund';
      if (selectedAfterSalesType === 'exchange') {
        afterSalesType = 'exchange';
      } else if (selectedAfterSalesType === 'refund') {
        // 退款类型下，根据用户选择的退款方式确定最终类型
        if (selectedRefundType === 'return_refund') {
          // 用户选择退货退款
          afterSalesType = 'return_refund';
        } else {
          // 用户选择仅退款
          if (selectedGoodsStatus === 'received') {
            afterSalesType = 'refund_received';
          } else {
            afterSalesType = 'refund_not_received';
          }
        }
      } else if (selectedAfterSalesType === 'not_received_refund') {
        afterSalesType = 'refund_not_received';
      }
      
      console.log('=== 提交售后申请日志 ===');
      console.log('订单ID:', pendingOrderId);
      console.log('订单状态:', order.status);
      console.log('售后类型:', afterSalesType);
      console.log('售后原因:', selectedAfterSalesType === 'exchange' ? selectedExchangeReasonLabel : selectedReasonLabel);
      console.log('售后原因代码:', selectedAfterSalesType === 'exchange' ? selectedExchangeReason : selectedReason);
      console.log('剩余常规售后天数:', this.data.remainingNormalAfterSalesDays);
      console.log('剩余质量售后天数:', this.data.remainingQualityAfterSalesDays);
      console.log('签收时间(checkTime):', order?.logisticsState?.checkTime);
      console.log('确认收货时间(receiptTime):', order?.receiptTime);
      console.log('发货时间(shippingTime):', order?.shippingTime);
      console.log('交易是否完成:', ['completed', 'refund'].includes(order.status));
      console.log('========================');
      
      // 构造 orderItemId
      const orderItemId = `${pendingOrderId}_${selectedProductIndex}`;
      
      // 提交售后申请：使用用户在数量选择器上选择的 applyQty，而非商品原始数量
      const applyQty = Number(this.data.applyQty) || 1;

      // 上传文件到云存储，获取 cloud:// fileID
      const uploadCloudFile = async (filePath, cloudFolder, ext = 'jpg') => {
        if (!filePath || filePath.startsWith('cloud://')) return filePath;
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(2, 10);
        const cloudPath = `after-sales/${cloudFolder}/${timestamp}_${randomStr}.${ext}`;
        const res = await wx.cloud.uploadFile({ cloudPath, filePath });
        return res.fileID;
      };

      // 并行上传所有图片
      const uploadedImages = await Promise.all(
        afterSalesImages.map(item => uploadCloudFile(item.path, 'images', 'jpg'))
      );

      // 并行上传所有视频及其封面图
      const uploadedVideoResults = await Promise.all(
        afterSalesVideos.map(async (item) => {
          const videoFileID = await uploadCloudFile(item.path, 'videos', 'mp4');
          const thumbFileID = await uploadCloudFile(item.thumb, 'thumbs', 'jpg');
          return { path: videoFileID, thumb: thumbFileID };
        })
      );

      // 构造售后参数（使用上传后的 cloud:// fileID）
      const params = {
        items: [{
          orderItemId: orderItemId,
          orderItemIndex: selectedProductIndex,
          applyQty: applyQty,
          afterSalesType: afterSalesType,
          applyRefundAmount: parseFloat(refundAmount)
        }],
        proofImages: uploadedImages,
        proofVideos: uploadedVideoResults.map(item => item.path),
        proofVideoThumbs: uploadedVideoResults.map(item => item.thumb),
        reasonCode: selectedAfterSalesType === 'exchange' ? selectedExchangeReason : selectedReason,
        reason: selectedAfterSalesType === 'exchange' ? selectedExchangeReasonLabel : selectedReasonLabel,
        description: afterSalesDescription,
        contactName: contactName,
        contactPhone: contactPhone,
        contactAddress: contactAddress
      };
      
      // 直接调用 updateOrderStatus 云函数
      const result = await wx.cloud.callFunction({
        name: 'updateOrderStatus',
        data: {
          orderId: pendingOrderId,
          operation: 'applyAfterSales',
          params: params
        }
      });
      
      if (result.result && result.result.success) {
        const caseId = result.result.data?.caseId;
        wx.showToast({
          title: '提交成功',
          icon: 'success'
        });
        // 设置全局标志，通知订单列表页和订单详情页需要刷新
        getApp().globalData.needRefreshOrderList = true;
        getApp().globalData.needRefreshOrderDetail = true;
        // 关闭弹窗
        this.closeAfterSalesTypeModal();
        // 跳转到售后详情页，对齐淘宝交互
        if (caseId) {
          setTimeout(() => {
            wx.navigateTo({
              url: `/pages/after-sales/detail/index?id=${caseId}`
            });
          }, 1500);
        }
      } else {
        wx.showToast({
          title: result.result?.error || '提交失败',
          icon: 'none'
        });
      }
    } catch (error) {
      console.error('提交售后申请失败:', error);
      wx.showToast({
        title: '提交失败',
        icon: 'none'
      });
    } finally {
      wx.hideLoading();
    }
  },

  // 查看售后
  viewAfterSales(e) {
    const orderId = e.currentTarget.dataset.orderId;
    // 跳转到售后列表页，显示该订单的所有售后记录
    wx.navigateTo({
      url: `/pages/after-sales/list/index?orderId=${orderId}`
    });
  },

  // 查看商品级别的售后
  viewAfterSalesByProduct(e) {
    const caseId = e.currentTarget.dataset.caseId;
    const productIndex = e.currentTarget.dataset.productIndex;
    const orderId = e.currentTarget.dataset.orderId;
    
    // 获取该商品的所有售后记录
    const productAfterSales = this.data.order.productHasAfterSales[productIndex];
    
    if (!productAfterSales || productAfterSales.length === 0) {
      wx.showToast({ title: '暂无售后记录', icon: 'none' });
      return;
    }
    
    if (productAfterSales.length === 1) {
      // 只有一个售后记录，直接跳转到详情页
      wx.navigateTo({
        url: `/pages/after-sales/detail/index?id=${productAfterSales[0].caseId}`
      });
    } else {
      // 有多个售后记录，跳转到售后历史列表页（传入productIndex筛选）
      wx.navigateTo({
        url: `/pages/after-sales/list/index?orderId=${orderId}&productIndex=${productIndex}`
      });
    }
  },

  // 获取物流状态映射
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
      console.error('获取物流状态映射失败:', error);
    }
  },

  // 关闭物流信息弹窗
  closeLogistics() {
    this.setData({
      showLogistics: false
    });
  },

  // 获取商品售后状态（用于WXML）
  getProductAfterSalesStatus(productIndex) {
    const productAfterSales = this.data.order?.productHasAfterSales?.[productIndex];
    if (!productAfterSales || productAfterSales.length === 0) {
      return null;
    }
    // 返回最新的售后记录
    return productAfterSales[productAfterSales.length - 1];
  },

  // 判断商品是否有进行中的售后（用于WXML）
  hasActiveAfterSales(productIndex) {
    const productAfterSales = this.data.order?.productHasAfterSales?.[productIndex];
    if (!productAfterSales || productAfterSales.length === 0) {
      return false;
    }
    return productAfterSales.some(item => item.statusType === 'active');
  },

  // 判断商品是否有已完成的售后（用于WXML）
  hasCompletedAfterSales(productIndex) {
    const productAfterSales = this.data.order?.productHasAfterSales?.[productIndex];
    if (!productAfterSales || productAfterSales.length === 0) {
      return false;
    }
    return productAfterSales.some(item => item.statusType === 'completed');
  },

  // 判断商品是否有已取消/已拒绝的售后（用于WXML）
  hasCancelledAfterSales(productIndex) {
    const productAfterSales = this.data.order?.productHasAfterSales?.[productIndex];
    if (!productAfterSales || productAfterSales.length === 0) {
      return false;
    }
    return productAfterSales.some(item => item.statusType === 'cancelled' || item.statusType === 'rejected');
  },

  // 加入购物车
  addToCart(e) {
    const productId = e.currentTarget.dataset.productId;
    if (!productId) {
      wx.showToast({
        title: '商品ID为空',
        icon: 'none'
      });
      return;
    }

    const { order } = this.data;
    if (!order || !order.products) {
      wx.showToast({
        title: '订单数据异常',
        icon: 'none'
      });
      return;
    }

    const product = order.products.find(item => item.productId === productId);
    if (!product) {
      wx.showToast({
        title: '商品不存在',
        icon: 'none'
      });
      return;
    }

    const db = wx.cloud.database();
    const openid = wx.getStorageSync('openid') || '';

    wx.showLoading({ title: '处理中...' });

    db.collection('products').doc(productId).get()
      .then((productRes) => {
        if (!productRes.data || productRes.data.isDeleted) {
          wx.hideLoading();
          wx.showToast({
            title: '商品已下架',
            icon: 'none'
          });
          return;
        }

        const currentProduct = productRes.data;
        if (currentProduct.status === 'off') {
          wx.hideLoading();
          wx.showToast({
            title: '商品已下架',
            icon: 'none'
          });
          return;
        }

        if (!currentProduct.stock || currentProduct.stock <= 0) {
          wx.hideLoading();
          wx.showToast({
            title: '商品库存不足',
            icon: 'none'
          });
          return;
        }

        const cart = db.collection("cart");
        const productSnapshot = {
          productId: product.productId,
          name: product.name,
          coverImage: product.coverImage,
          price: product.price,
          category: product.category
        };

        return cart
          .where({
            _openid: openid,
            productId: productId,
            isDelete: false
          })
          .get()
          .then((res) => {
            if (res.data && res.data.length > 0) {
              const docId = res.data[0]._id;
              const currentCartStock = res.data[0].quantity || 0;
              if (currentCartStock >= currentProduct.stock) {
                wx.hideLoading();
                wx.showToast({
                  title: '购物车已有足够库存',
                  icon: 'none'
                });
                return;
              }
              return cart.doc(docId).update({
                data: {
                  quantity: currentCartStock + 1,
                  message: '',
                  updatedAt: new Date(),
                  updatedAtTs: Date.now()
                }
              });
            } else {
              return cart.where({ _openid: openid, isDelete: false }).orderBy('sort', 'desc').limit(1).get().then(sortRes => {
                let sort = 1;
                if (sortRes.data && sortRes.data.length > 0) {
                  sort = sortRes.data[0].sort + 1;
                }
                return cart.add({
                  data: {
                    productId: productId,
                    quantity: 1,
                    message: '',
                    checked: true,
                    productSnapshot,
                    isDelete: false,
                    sort: sort,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    updatedAtTs: Date.now()
                  }
                });
              });
            }
          })
          .then((addRes) => {
            if (!addRes) return;
            console.log('加入购物车成功:', addRes);
            wx.hideLoading();
            wx.showToast({
              title: "已加入购物车",
              icon: "success"
            });
            const app = getApp();
            app.globalData.cartDirty = true;
          });
      })
      .catch((err) => {
        console.error("加入购物车失败", err);
        wx.hideLoading();
        wx.showToast({
          title: "加入购物车失败",
          icon: "none"
        });
      });
  }
});