import { getCollection } from "../../utils/cloud";
import { generateMarkers, generateCircles, getAddressLocation } from "../../utils/map-utils";
import watcherManager from "../../utils/watcherManager";

const db = wx.cloud.database();
const _ = db.command;
const EXPIRED_CHECK_COOLDOWN_MS = 15000;

Page({
  data: {
    order: null,
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
    amountInputWidth: 0, // 退款金额输入框宽度
    contactName: '', // 联系人
    contactPhone: '', // 联系电话
    contactAddress: '', // 联系地址
    showUploadInfoModal: false, // 是否显示查看凭证弹窗
    shippingResponsibility: 'buyer', // 运费归属：buyer-买家承担，seller-卖家承担
    remainingAfterSalesDays: 7, // 剩余售后时限（天）
    remainingNormalAfterSalesDays: 7, // 剩余常规售后时限（7天）
    remainingQualityAfterSalesDays: 15, // 剩余质量售后时限（15天）
    maxRefundAmount: 0, // 最大退款金额
    needProof: false, // 是否需要上传凭证
    operationLogs: [], // 订单操作日志
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
            order.productTotalAmount = order.products.reduce((total, product) => {
              return total + (product.price || 0) * (product.quantity || 1);
            }, 0);
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

          // 判断是否在24小时内，用于显示取消订单按钮
          const canCancel = order.status === 'paid' && order.createdAt ? (new Date() - new Date(order.createdAt) < 24 * 60 * 60 * 1000) : false;

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
              const activeStatuses = ['submitted', 'reviewing', 'waiting_buyer_return', 'waiting_seller_receive', 'processing', 'intercepting'];
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
                    // 根据子状态显示更详细的状态
                    // 优先使用案件级别状态，然后是明细级别状态
                    const caseLevelStatus = caseInfo?.caseStatus || caseInfo?.status;
                    const itemLevelStatus = item.itemStatus || item.status;
                    
                    if (caseLevelStatus === 'processing' || itemLevelStatus === 'processing') {
                      statusText = '处理中';
                    } else if (caseLevelStatus === 'pending' || itemLevelStatus === 'pending') {
                      statusText = '待处理';
                    } else if (caseLevelStatus === 'waiting_buyer_return' || itemLevelStatus === 'waiting_buyer_return') {
                      statusText = '待买家寄回';
                    } else if (caseLevelStatus === 'waiting_seller_receive' || itemLevelStatus === 'waiting_seller_receive') {
                      statusText = '待商家收货';
                    } else if (caseLevelStatus === 'reviewing' || itemLevelStatus === 'reviewing') {
                      statusText = '审核中';
                    } else if (caseLevelStatus === 'seller_reviewing' || itemLevelStatus === 'seller_reviewing') {
                      statusText = '验货中';
                    } else if (caseLevelStatus === 'seller_returning' || itemLevelStatus === 'seller_returning') {
                      statusText = '寄回中';
                    } else if (caseLevelStatus === 'intercepting' || itemLevelStatus === 'intercepting') {
                      statusText = '拦截中';
                    } else if (caseLevelStatus === 'submitted' || itemLevelStatus === 'submitted') {
                      // 根据售后类型显示提交后的状态
                      if (item.afterSalesType === 'exchange' || item.afterSalesType === 'quality_exchange') {
                        statusText = '换货申请中';
                      } else if (item.afterSalesType === 'return_refund' || item.afterSalesType === 'quality_return_refund') {
                        statusText = '退货退款申请中';
                      } else if (item.afterSalesType === 'refund_received') {
                        statusText = '退款申请中(已收货)';
                      } else if (item.afterSalesType === 'refund_not_received') {
                        statusText = '退款申请中(未收货)';
                      } else if (item.afterSalesType === 'refund' || item.afterSalesType === 'quality_refund') {
                        statusText = '退款申请中';
                      } else {
                        statusText = '售后申请中';
                      }
                    } else if (item.afterSalesType === 'exchange' || item.afterSalesType === 'quality_exchange') {
                      statusText = '换货中';
                    } else if (item.afterSalesType === 'refund' || item.afterSalesType === 'quality_refund') {
                      statusText = '退款中';
                    } else if (caseLevelStatus === 'intercepting' || itemLevelStatus === 'intercepting') {
                      // 确保拦截中状态有正确的状态文本
                      statusText = '拦截中';
                    } else {
                      statusText = '售后中';
                    }
                  } else if (caseStatus === 'completed' || caseStatus === 'refund_completed' || caseStatus === 'exchange_completed') {
                    statusType = 'completed'; // 已完成
                    // 根据售后类型显示更详细的状态
                    const afterSalesType = item.afterSalesType;
                    if (afterSalesType === 'exchange' || afterSalesType === 'quality_exchange') {
                      statusText = '换货完成';
                    } else if (afterSalesType === 'quality_refund' || afterSalesType === 'refund') {
                      statusText = '退款成功';
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
          
          this.setData({
            order: {
              ...order,
              canCancel,
              canAfterSales,
              afterSalesCase,
              afterSalesItems,
              productHasAfterSales,
              hasActiveAfterSales,
              hasCompletedAfterSales,
              hasCancelledAfterSales,
              hasNonReceivedRefund,
              isLogisticsSigned,
              blockOtherAfterSales
            },
            loading: false
          });
          
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
      
      const logs = (logsRes.data || []).map(log => {
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
          'process_after_sales': '处理售后',
          'cancel_after_sales': '取消售后',
          'start_intercepting': '开始拦截快递',
          'complete_intercepting': '完成拦截快递',
          'auto_start_intercepting': '系统自动拦截快递',
          'auto_process_after_sales': '系统自动处理售后'
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
        
        return {
          ...log,
          actionText,
          operatorText,
          operatedAtText
        };
      });
      
      this.setData({ operationLogs: logs });
    } catch (error) {
      console.error('获取订单操作日志失败:', error);
      this.setData({ operationLogs: [] });
    }
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
    wx.showModal({
      title: '取消订单',
      content: '确定要取消这个订单吗？',
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
    if (this.expiredCheckCooldown) {
      this.expiredCheckCooldown.clear();
    }
    
    // 销毁监听
    const { orderId } = this.data;
    if (orderId) {
      watcherManager.destroy(`order_detail_${orderId}`);
      console.log('[订单详情页面] 关闭实时监听');
    }
    
    // 通知订单列表页需要刷新数据
    getApp().globalData.needRefreshOrderList = true;
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
    // 显示售后类型选择弹窗（整单申请时，根据订单中是否有支持7天无理由的商品来显示）
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
    
    // 获取商品是否支持7天无理由退换货
    const products = this.data.order?.products || [];
    const product = products[productIndex] || {};
    const supportNoReason = product.supportNoReasonReturn || false;
    
    // 显示售后类型选择弹窗
    // 使用物流状态名称
    const logisticsState = this.data.order?.logisticsState || {};
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
      goodsStatusText: goodsStatusText
    });
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
      contactName: '',
      contactPhone: '',
      contactAddress: '',
      shippingResponsibility: 'buyer',
      remainingAfterSalesDays: 7,
      remainingNormalAfterSalesDays: 7,
      remainingQualityAfterSalesDays: 15,
      maxRefundAmount: 0,
      needProof: false
    });
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

  // 计算剩余售后时限（和后端保持一致）
  calculateRemainingAfterSalesDays() {
    const { order } = this.data;
    
    let remainingNormalDays = 7;
    let remainingQualityDays = 15;
    
    // 优先使用checkTime，缺失时回退到receiptTime（和后端保持一致）
    const signTime = order?.logisticsState?.checkTime || order?.receiptTime;
    
    console.log('=== 售后时效计算调试 ===');
    console.log('order:', JSON.stringify(order, null, 2));
    console.log('checkTime:', order?.logisticsState?.checkTime);
    console.log('receiptTime:', order?.receiptTime);
    console.log('signTime:', signTime);
    
    if (signTime) {
      const [datePart, hourPart] = signTime.split(' ');
      const [year, month, day] = datePart.split('-').map(Number);
      const hour = parseInt(hourPart) || 0;
      
      // checkTime是北京时间，直接用本地时间创建
      // 格式：2026-05-04 23 → 2026-05-04 23:00:00
      const deliveryDate = new Date(year, month - 1, day, hour, 0, 0);
      
      // 从签收后的第二天0点开始计算
      const startDate = new Date(year, month - 1, day + 1, 0, 0, 0);
      
      const now = new Date();
      const diff = now.getTime() - startDate.getTime();
      const daysPassed = Math.floor(diff / (1000 * 60 * 60 * 24));
      
      console.log('deliveryDate:', deliveryDate.toISOString());
      console.log('startDate (签收后第二天):', startDate.toISOString());
      console.log('now:', now.toISOString());
      console.log('diff (ms):', diff);
      console.log('daysPassed:', daysPassed);
      
      remainingNormalDays = Math.max(0, 7 - daysPassed);
      remainingQualityDays = Math.max(0, 15 - daysPassed);
    }
    
    this.setData({
      remainingNormalAfterSalesDays: remainingNormalDays,
      remainingQualityAfterSalesDays: remainingQualityDays,
      remainingAfterSalesDays: remainingNormalDays
    });
  },

  // 初始化步骤3数据
  initStep3Data() {
    const { order, selectedProductIndex, selectedReason, selectedAfterSalesType } = this.data;
    
    // 获取商品价格作为最大退款金额
    let maxRefundAmount = 0;
    if (selectedProductIndex >= 0 && order.products[selectedProductIndex]) {
      const product = order.products[selectedProductIndex];
      maxRefundAmount = (product.price || 0) * (product.quantity || 1);
    } else if (order.totalAmount) {
      maxRefundAmount = order.totalAmount;
    }
    
    // 设置默认退款金额为最大金额
    const refundAmount = maxRefundAmount.toString();
    
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
      maxRefundAmount: maxRefundAmount,
      refundAmount: refundAmount,
      contactName: contactName,
      contactPhone: contactPhone,
      contactAddress: contactAddress,
      needProof: needProof,
      shippingResponsibility: shippingResponsibility,
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
    
    this.setData({ refundAmount: value }, () => {
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
      
      // 构造 orderItemId
      const orderItemId = `${pendingOrderId}_${selectedProductIndex}`;
      
      // 获取商品数量
      const product = order.products && order.products[selectedProductIndex];
      const applyQty = product ? (product.quantity || 1) : 1;
      
      // 构造售后参数
      const params = {
        items: [{
          orderItemId: orderItemId,
          orderItemIndex: selectedProductIndex,
          applyQty: applyQty,
          afterSalesType: afterSalesType,
          applyRefundAmount: parseFloat(refundAmount)
        }],
        proofImages: afterSalesImages.map(item => item.path) || [],
        proofVideos: afterSalesVideos.map(item => item.path) || [],
        proofVideoThumbs: afterSalesVideos.map(item => item.thumb) || [],
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
        wx.showToast({
          title: '提交成功',
          icon: 'success'
        });
        // 设置全局标志，通知订单列表页需要刷新
        getApp().globalData.needRefreshOrderList = true;
        // 关闭弹窗，监听会自动更新订单数据
        this.closeAfterSalesTypeModal();
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