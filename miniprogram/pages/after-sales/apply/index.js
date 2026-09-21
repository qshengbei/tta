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
    { value: 'seven_day_no_reason', label: '7天无理由退货退款', requireProof: false },
    { value: 'not_wanted', label: '不想要了', requireProof: false },
    { value: 'agreement', label: '协商一致退款', requireProof: false },
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

const QUALITY_REASONS = [
  'empty_package', 'lost', 'no_tracking', 'damaged_rejected',
  'size_mismatch', 'color_mismatch', 'material_mismatch', 'fade',
  'quality', 'missing', 'damaged', 'wrong_item'
];

function isQualityReason(reasonValue) {
  return QUALITY_REASONS.includes(reasonValue);
}

function getShippingResponsibilityText(value) {
  return value === 'buyer' ? '买家承担' : '商家承担';
}

// 清洗金额输入：只保留数字和一个小数点，小数最多两位（允许输入过程中以小数点结尾）
function sanitizeAmountInput(raw) {
  let v = String(raw).replace(/[^\d.]/g, '');
  const dotIndex = v.indexOf('.');
  if (dotIndex !== -1) {
    v = v.slice(0, dotIndex + 1) + v.slice(dotIndex + 1).replace(/\./g, '');
  }
  return v.replace(/^(\d*\.\d{2})\d+$/, '$1');
}

// 严格校验金额格式：数字、最多两位小数、大于0（提交时使用）
function isValidAmountText(value) {
  return /^\d+(\.\d{1,2})?$/.test(String(value).trim());
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
    showRulesModal: false,
    
    requireProof: false,
    imageOptional: false,
    
    proofImages: [],
    proofVideos: [],
    proofVideoThumbs: [],
    description: '',
    
    refundAmount: '',
    amountInputWidth: 0,
    maxRefundAmount: 0,
    goodsMaxRefundAmount: 0, // 商品口径最大可退（发货运费永不倒扣，最多可退即此值）
    partialRefundTip: '', // 部分退款补差提示（该商品已退¥X，本次最多可退¥Y）

    shippingFeeAmount: 0, // 订单运费（显式字段或差额反推）
    originalShippingFeeAmount: 0, // 订单原运费（规则运费，包邮时仍>0，仅用于寄回补偿取价）
    committedShippingRefundAmount: 0, // 已在其他售后中承诺/到账的运费
    committedShippingDeductionAmount: 0, // 历史保留字段：新运费政策下不再产生扣减
    validAfterSalesCoveredQty: 0, // 历史有效售后明细件数
    hasExchangeAfterSalesHistory: false, // 历史有效明细是否含换货
    shippingRefundAmount: 0, // 本次预计退还的运费（仅展示）
    shippingDeductionAmount: 0, // 历史保留字段：新运费政策下恒为0（发货运费永不倒扣）
    shippingRefundTip: '', // 运费退款提示文案
    shippingRefundTipType: '', // include=实付运费随本次退款 / exclude=实付运费不在退款范围 / ''=无运费资金进出
    returnShippingCompensationConfig: 0, // 商家配置的寄回运费固定补偿额（settings，0=不补偿）
    shippingFeeRules: [], // 运费承担规则（4 个场景，来自 settings.afterSalesTimeConfig.shippingFeeRules；仅寄回补偿开关生效）
    returnShippingCompensationAmount: 0, // 本次申请预计的寄回运费补偿（仅展示，不占商品可退额）
    returnShippingCompensationTip: '', // 寄回运费补偿提示文案

    contactName: '',
    contactPhone: '',
    
    shippingResponsibility: 'buyer',
    remainingDays: 0,
    normalDeadline: 0, // 常规售后截止时间戳（0=无基准时间，按满额展示）
    qualityDeadline: 0, // 质量售后截止时间戳
    normalMaxDays: 7,
    qualityMaxDays: 15,
    normalText: '', // 常规售后剩余时间分级文案
    qualityText: '', // 质量售后剩余时间分级文案

    showConfirmPage: false,
    step: 1
  },

  // 取运费承担规则（与后端 getShippingFeeRule 同口径），当前仅 compensateReturn（寄回运费补偿）生效；
  // deductOutbound（扣除寄出运费）按新运费政策已停用——发货运费永不倒扣，字段保留仅为兼容历史配置
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

  // 寄回运费补偿补丁（判定口径与后端 resolveApplyReturnShippingCompensation 一致）
  // 金额优先取本单寄出规则运费（包邮单取规则运费），订单无运费时回退设置页兜底额
  // 是否补偿按"运费承担规则"中"对应责任 × 整单/部分"的 compensateReturn 决定
  buildReturnShippingCompPatch() {
    const {
      returnShippingCompensationConfig, refundType, reasonValue,
      shippingFeeAmount, originalShippingFeeAmount, currentProduct, orderProducts,
      validAfterSalesCoveredQty, hasExchangeAfterSalesHistory
    } = this.data;
    // 本页仅退货退款（refundType: refund_only=仅退款, return_refund=退货退款）
    // 仅退款无需寄回，不补偿
    if (refundType === 'refund_only') {
      return { returnShippingCompensationAmount: 0, returnShippingCompensationTip: '' };
    }
    const QUALITY_REASONS = ['size_mismatch', 'color_mismatch', 'material_mismatch', 'fade', 'quality', 'missing', 'damaged', 'wrong_item'];
    const isSeller = QUALITY_REASONS.includes(String(reasonValue || ''));
    const applyQty = Number(currentProduct?.quantity || currentProduct?.buyQty || 0) || 0;
    const totalOrderQty = (orderProducts || []).reduce(
      (sum, p) => sum + (Number(p.quantity || p.buyQty || 0) || 0), 0
    );
    const isWholeOrder = (Number(validAfterSalesCoveredQty) || 0) + applyQty >= totalOrderQty
      && !hasExchangeAfterSalesHistory;
    const rule = this.getShippingFeeRuleFront(isSeller, isWholeOrder);
    if (!rule.compensateReturn) {
      return { returnShippingCompensationAmount: 0, returnShippingCompensationTip: '' };
    }
    const originalFee = Math.round((Number(originalShippingFeeAmount) || 0) * 100) / 100;
    const paidFee = Math.round((Number(shippingFeeAmount) || 0) * 100) / 100;
    const configFallback = Math.round((Number(returnShippingCompensationConfig) || 0) * 100) / 100;
    const amount = Math.min(originalFee > 0 ? originalFee : (paidFee > 0 ? paidFee : configFallback), 1000);
    if (!(amount > 0)) {
      return { returnShippingCompensationAmount: 0, returnShippingCompensationTip: '' };
    }
    const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
    return {
      returnShippingCompensationAmount: amount,
      returnShippingCompensationTip: `寄回运费由商家承担，退款后预计补偿 ¥${fmt(amount)}（以实际寄回运单号为准，同一运单号仅补偿一次，与退款一并到账）`
    };
  },

  // 发货运费预览（判定口径与后端 resolveApplyShippingRefund 一致，仅展示，最终以后端为准）：
  // include=实付运费随本次退款；exclude=实付运费不在退款范围（买家自然承担）；''=无运费资金进出（不展示提示）
  // 运费政策：包邮/运费优惠是商家自愿促销承诺，发货运费永不从商品退款中倒扣（不存在 deduct 口径）
  updateShippingTip() {
    const {
      shippingFeeAmount, originalShippingFeeAmount, committedShippingRefundAmount,
      validAfterSalesCoveredQty,
      hasExchangeAfterSalesHistory, refundType, goodsStatus, reasonValue,
      currentProduct, orderProducts, goodsMaxRefundAmount
    } = this.data;
    // 寄回补偿独立于发货运费（包邮订单也可能有补偿），在所有展示分支统一注入
    const compPatch = this.buildReturnShippingCompPatch();
    const fee = Math.round((Number(shippingFeeAmount) || 0) * 100) / 100;
    const originalFee = Math.round((Number(originalShippingFeeAmount) || 0) * 100) / 100;
    const goodsBase = Math.round((Number(goodsMaxRefundAmount) || 0) * 100) / 100;
    const emptyPatch = {
      shippingRefundAmount: 0,
      shippingDeductionAmount: 0,
      shippingRefundTip: '',
      shippingRefundTipType: '',
      maxRefundAmount: goodsBase,
      refundAmount: goodsBase,
      ...compPatch
    };
    if (fee <= 0 && originalFee <= 0) {
      this.setData(emptyPatch);
      return;
    }
    const remaining = Math.round((fee - (Number(committedShippingRefundAmount) || 0)) * 100) / 100;
    const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
    // 最终售后类型映射（与提交参数一致）
    let finalType = 'return_refund';
    if (refundType === 'refund_only') {
      finalType = goodsStatus === 'not_received' ? 'refund_not_received' : 'refund_received';
    }
    // 仅退款（已收到货）：买家保留商品、无需寄回，配送已完成且交易留存，不涉及发货运费
    // （寄回补偿对仅退款同样为空），不展示任何发货运费提示；口径与后端 resolveApplyShippingRefund 一致
    if (finalType === 'refund_received') {
      this.setData(emptyPatch);
      return;
    }
    const REFUND_TYPES = ['refund', 'quality_refund', 'return_refund', 'quality_return_refund', 'refund_received', 'refund_not_received'];
    // 与后端 QUALITY_REASONS 严格对齐（本页 isQualityReason 列表更宽，不能直接复用）
    const QUALITY_REASONS = ['size_mismatch', 'color_mismatch', 'material_mismatch', 'fade', 'quality', 'missing', 'damaged', 'wrong_item'];
    const isSellerResponsible = ['quality_refund', 'quality_return_refund'].includes(finalType)
      || QUALITY_REASONS.includes(String(reasonValue || ''));
    const applyQty = Number(currentProduct?.quantity || currentProduct?.buyQty || 0) || 0;
    const totalOrderQty = (orderProducts || []).reduce(
      (sum, p) => sum + (Number(p.quantity || p.buyQty || 0) || 0), 0
    );
    const isWholeOrder = (Number(validAfterSalesCoveredQty) || 0) + applyQty >= totalOrderQty
      && !hasExchangeAfterSalesHistory;

    // 发货运费永不倒扣，"最多可退"与默认金额始终为商品口径全额
    const applyTipPatch = (tipType, tip) => {
      this.setData({
        shippingRefundTipType: tipType,
        shippingRefundTip: tip,
        shippingRefundAmount: tipType === 'include' ? remaining : 0,
        shippingDeductionAmount: 0,
        maxRefundAmount: goodsBase,
        refundAmount: goodsBase,
        ...compPatch
      }, () => {
        setTimeout(() => this.updateAmountInputWidth(), 0);
      });
    };

    // 未收到货：配送未完成；有实付运费随商品款退还，包邮单无运费资金进出则不展示提示
    if (finalType === 'refund_not_received') {
      if (remaining > 0.01) {
        applyTipPatch('include', `未收到货退款，本次退款含运费 ¥${fmt(remaining)}，预计共退 ¥${fmt(Math.round((goodsBase + remaining) * 100) / 100)}`);
        return;
      }
      this.setData(emptyPatch);
      return;
    }

    if (!REFUND_TYPES.includes(finalType)) {
      this.setData(emptyPatch);
      return;
    }

    // 卖家责任整单：有实付运费一并退还；包邮单无运费资金进出，不展示提示
    if (isSellerResponsible && isWholeOrder) {
      if (remaining > 0.01) {
        applyTipPatch('include', `卖家承担运费，本次退款含运费 ¥${fmt(remaining)}，预计共退 ¥${fmt(Math.round((goodsBase + remaining) * 100) / 100)}`);
        return;
      }
      this.setData(emptyPatch);
      return;
    }

    // 部分退款 / 买家责任（含整单）且实付了运费：商品款照退，实付运费不退（买家自然承担）；
    // 包邮单无运费资金进出：不展示提示（包邮为商家促销承诺，不存在倒扣）
    if (remaining > 0.01) {
      applyTipPatch(
        'exclude',
        isWholeOrder
          ? `实付运费 ¥${fmt(remaining)} 不在本次退款范围内`
          : `部分退款，运费 ¥${fmt(remaining)} 不在本次退款范围内`
      );
      return;
    }
    this.setData(emptyPatch);
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

      // 实际商品索引：指定下标优先；单商品订单回退到 0
      const targetProductIndex = (this.productIndex >= 0 && this.productIndex < products.length)
        ? this.productIndex
        : (products.length === 1 ? 0 : -1);

      if (targetProductIndex >= 0) {
        currentProduct = products[targetProductIndex];
        const price = Number(currentProduct.price || currentProduct.productPrice || 0);
        const quantity = Number(currentProduct.quantity || currentProduct.buyQty || 1);
        maxRefundAmount = price * quantity;
      }

      // 商品是否支持7天无理由（控制原因列表中 seven_day_no_reason 选项的可见性）
      const supportNoReason = !!currentProduct?.supportNoReasonReturn;

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

      // 若该商品存在"换货已完成并收到新货"的记录，售后期按确认收新货时间重新起算；
      // 同时统计已承诺/已到账退款金额，支持单件部分金额退款后的补差申请
      let restartBaseDate = null;
      let committedAmount = 0;
      let refundedAmount = 0;
      let forfeitedAmount = 0;
      // 仅退款（货留买家/未收到货）少退可补差；退货退款（货已寄回）少退差额不可再申请
      const refundOnlyTypes = ['refund', 'refund_received', 'refund_not_received', 'not_received_refund'];
      if (targetProductIndex >= 0) {
        try {
          const db = wx.cloud.database();
          const itemsRes = await db.collection('after_sales_case_items').where({
            orderId,
            orderItemIndex: targetProductIndex
          }).limit(50).get();
          const allItems = itemsRes.data || [];
          const releasedItems = allItems.filter(item =>
            ['exchange', 'quality_exchange'].includes(String(item.afterSalesType || ''))
            && String(item.itemStatus || '') === 'completed'
            && String(item.returnGoodsType || '') !== 'original'
            && (Number(item.afterSalesGeneration) || 1) < 2
            && item.completedAt);
          if (releasedItems.length > 0) {
            releasedItems.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
            restartBaseDate = parseFlexibleDate(releasedItems[0].completedAt);
          }
          // 金额累计：仅有效明细（排除取消/拒绝）；已核准取核准额，进行中取申请额
          allItems.forEach(item => {
            const status = String(item.itemStatus || '');
            if (status === 'cancelled' || status === 'rejected') {
              return;
            }
            const type = String(item.afterSalesType || '');
            const approved = Number(item.approvedRefundAmount || 0) || 0;
            const applied = Number(item.applyRefundAmount || 0) || 0;
            // 换货不发生商品退款，形式上的申请金额不占用退款金额池（与后端同口径）
            const isExchangeItem = ['exchange', 'quality_exchange'].includes(type);
            if (!isExchangeItem) {
              committedAmount += approved > 0 ? approved : applied;
              if (status === 'completed') {
                refundedAmount += approved;
              }
            }
            if (status === 'completed' && !isExchangeItem) {
              // 退货退款少退的差额：份额金额 − 核准额（货已寄回，不可再申请）
              if (!refundOnlyTypes.includes(type)) {
                const qty = Number(item.applyQty || 0) || 0;
                const unitPrice = Number(item.unitPriceSnapshot || 0) || 0;
                let share = 0;
                if (unitPrice > 0) {
                  share = unitPrice * qty;
                } else {
                  const lineAmount = Number(item.payableAmountSnapshot || 0) || 0;
                  const itemBuyQty = Number(item.buyQty || 0) || 0;
                  share = lineAmount > 0 && itemBuyQty > 0 ? (lineAmount / itemBuyQty) * qty : (Number(item.maxRefundAmount || 0) || 0);
                }
                if (share > 0 && approved < share - 0.01) {
                  forfeitedAmount += share - approved;
                }
              }
            }
          });
        } catch (err) {
          console.error('查询售后明细失败', err);
        }
      }

      // 订单级运费数据（仅用于运费退款提示，最终以后端判定为准）
      let shippingFeeAmount = Number(
        order.shippingFee ?? order.deliveryFee ?? order.expressFee ?? order.postFee ?? order.freight ?? 0
      ) || 0;
      let orderValidAfterSalesQty = 0;
      let orderHasExchangeHistory = false;
      let committedShippingRefund = 0;
      let committedShippingDeduction = 0;
      try {
        const db = wx.cloud.database();
        const orderItemsRes = await db.collection('after_sales_case_items').where({ orderId }).limit(100).get();
        (orderItemsRes.data || []).forEach(item => {
          const status = String(item.itemStatus || '');
          if (status === 'cancelled' || status === 'rejected') {
            return;
          }
          orderValidAfterSalesQty += Number(item.applyQty || 0) || 0;
          if (['exchange', 'quality_exchange'].includes(String(item.afterSalesType || ''))) {
            orderHasExchangeHistory = true;
          }
          const approvedShipping = Number(item.approvedShippingRefundAmount || 0) || 0;
          const applyShipping = Number(item.applyShippingRefundAmount || 0) || 0;
          committedShippingRefund += approvedShipping > 0 ? approvedShipping : applyShipping;
          const approvedShippingDeduction = Number(item.approvedShippingDeductionAmount || 0) || 0;
          const applyShippingDeduction = Number(item.applyShippingDeductionAmount || 0) || 0;
          committedShippingDeduction += approvedShippingDeduction > 0 ? approvedShippingDeduction : applyShippingDeduction;
        });
      } catch (err) {
        console.error('查询订单售后明细失败', err);
      }

      // 商家配置的寄回运费固定补偿额 + 运费承担规则（卖家责任退货退款时展示预计补偿）
      let returnShippingCompensationConfig = 0;
      let shippingFeeRules = [];
      try {
        const settingsRes = await wx.cloud.database().collection('settings').limit(1).get();
        const settingsDoc = (settingsRes.data && settingsRes.data[0]) || {};
        const timeConfig = settingsDoc.afterSalesTimeConfig || {};
        // 缺省回落与后端 getServiceTimeConfig 默认值保持一致（10元）
        const compRaw = Number(
          timeConfig.returnShippingCompensationAmount ?? settingsDoc.returnShippingCompensationAmount ?? 10
        );
        if (Number.isFinite(compRaw) && compRaw > 0) {
          returnShippingCompensationConfig = Math.round(compRaw * 100) / 100;
        }
        // 运费承担规则（4 个场景；缺省回落与后端 DEFAULT_SHIPPING_FEE_RULES 一致）
        const DEFAULT_RULES = [
          { key: 'buyer_partial', label: '买家原因·部分退货', deductOutbound: false, compensateReturn: false },
          { key: 'seller_partial', label: '卖家原因·部分退货', deductOutbound: false, compensateReturn: true },
          { key: 'buyer_whole', label: '买家原因·整单退货', deductOutbound: true, compensateReturn: false },
          { key: 'seller_whole', label: '卖家原因·整单退货', deductOutbound: false, compensateReturn: true }
        ];
        const rawRules = Array.isArray(timeConfig.shippingFeeRules) ? timeConfig.shippingFeeRules : settingsDoc.shippingFeeRules;
        const sourceRules = Array.isArray(rawRules) ? rawRules : [];
        shippingFeeRules = DEFAULT_RULES.map((def) => {
          const found = sourceRules.find((r) => r && r.key === def.key);
          return {
            key: def.key,
            label: def.label,
            deductOutbound: found && typeof found.deductOutbound === 'boolean' ? found.deductOutbound : def.deductOutbound,
            compensateReturn: found && typeof found.compensateReturn === 'boolean' ? found.compensateReturn : def.compensateReturn
          };
        });
      } catch (err) {
        console.error('查询寄回运费补偿配置失败', err);
      }
      if (shippingFeeAmount <= 0) {
        const shippingFeeInt = Number(order.shippingFeeInt ?? order.deliveryFeeInt ?? 0) || 0;
        if (shippingFeeInt > 0) {
          shippingFeeAmount = shippingFeeInt / 100;
        }
      }
      if (shippingFeeAmount <= 0) {
        // 无显式运费字段时用实付总额 − 商品行合计反推（与后端 getOrderShippingFee 同口径）
        const orderPaidTotal = Number(order.totalPrice ?? order.totalAmount ?? 0) || 0;
        const goodsTotal = products.reduce((sum, p) => {
          const line = Number(p.lineAmount ?? p.payableAmount ?? 0) || 0
            || Math.round((Number(p.price || p.productPrice || 0) * (Number(p.quantity || p.buyQty || 0) || 1)) * 100) / 100;
          return sum + line;
        }, 0);
        const inferred = Math.round((orderPaidTotal - goodsTotal) * 100) / 100;
        shippingFeeAmount = inferred > 0.01 ? inferred : 0;
      }
      shippingFeeAmount = Math.round(shippingFeeAmount * 100) / 100;
      committedShippingRefund = Math.round(committedShippingRefund * 100) / 100;
      committedShippingDeduction = Math.round(committedShippingDeduction * 100) / 100;

      // 订单原运费（规则运费，包邮时仍 > 0）：买家责任整单退款时按"原运费 − 实付运费"扣减
      let originalShippingFeeAmount = Number(
        order.originalDeliveryFee ?? order.originalShippingFee ?? order.originalFreight ?? 0
      ) || 0;
      if (originalShippingFeeAmount <= 0) {
        const originalShippingFeeInt = Number(order.originalDeliveryFeeInt ?? order.originalShippingFeeInt ?? 0) || 0;
        if (originalShippingFeeInt > 0) {
          originalShippingFeeAmount = originalShippingFeeInt / 100;
        }
      }
      // 历史订单无原运费字段：退化为实付运费（等价于不扣减）
      if (originalShippingFeeAmount <= 0) {
        originalShippingFeeAmount = shippingFeeAmount;
      }
      originalShippingFeeAmount = Math.round(originalShippingFeeAmount * 100) / 100;

      // 金额池封顶：可退金额 = 商品行金额 - 已承诺退款金额 - 退货退款少退的放弃差额
      committedAmount = Math.round(committedAmount * 100) / 100;
      refundedAmount = Math.round(refundedAmount * 100) / 100;
      forfeitedAmount = Math.round(forfeitedAmount * 100) / 100;
      const lineTotal = Math.round(maxRefundAmount * 100) / 100;
      const remainRefundAmount = Math.round(Math.max(0, lineTotal - committedAmount - forfeitedAmount) * 100) / 100;
      maxRefundAmount = remainRefundAmount;
      const partialRefundTip = refundedAmount > 0 && remainRefundAmount > 0
        ? `该商品已退款 ¥${refundedAmount}，本次最多可退 ¥${remainRefundAmount}`
        : '';

      const remainingDaysInfo = this.calculateRemainingDays(order, restartBaseDate);

      this.setData({
        order,
        orderProducts: products,
        displayOrderNo: order.orderNumber || order.orderNo || order._id || '',
        currentProduct,
        supportNoReason,
        goodsMaxRefundAmount: Math.round(maxRefundAmount * 100) / 100,
        maxRefundAmount: Math.round(maxRefundAmount * 100) / 100,
        refundAmount: Math.round(maxRefundAmount * 100) / 100,
        partialRefundTip,
        shippingFeeAmount,
        originalShippingFeeAmount,
        committedShippingRefundAmount: committedShippingRefund,
        committedShippingDeductionAmount: committedShippingDeduction,
        validAfterSalesCoveredQty: orderValidAfterSalesQty,
        hasExchangeAfterSalesHistory: orderHasExchangeHistory,
        shippingRefundAmount: 0,
        shippingDeductionAmount: 0,
        shippingRefundTip: '',
        shippingRefundTipType: '',
        returnShippingCompensationConfig,
        shippingFeeRules,
        returnShippingCompensationAmount: 0,
        returnShippingCompensationTip: '',
        contactName,
        contactPhone,
        normalDeadline: remainingDaysInfo.normalDeadline || 0,
        qualityDeadline: remainingDaysInfo.qualityDeadline || 0,
        normalMaxDays: remainingDaysInfo.normalDays,
        qualityMaxDays: remainingDaysInfo.qualityDays
      }, () => {
        this.updateCountdownTick();
        this.countdownTimer = setInterval(() => this.updateCountdownTick(), 1000);
        // 入口已带退款类型/货物状态/原因（从订单详情预选跳入）时，直接刷新运费说明与净额上限
        if (this.data.reasonValue) {
          this.updateShippingTip();
        }
      });

      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      console.error('获取订单详情失败', err);
      wx.showToast({ title: '获取订单详情失败', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1000);
    }
  },

  calculateRemainingDays(order, restartBaseDate) {
    // 判断是否已确认收货（交易成功）
    const isTransactionCompleted = ['completed', 'refund'].includes(order.status);

    let receiptTime;
    let normalDays;

    if (restartBaseDate) {
      // 换货新货：售后期自确认收到新货起重新起算（普通7天/质量15天）
      receiptTime = restartBaseDate;
      normalDays = 7;
    } else if (isTransactionCompleted) {
      // 交易成功后：优先使用签收时间，回退到确认收货时间（签收后7天/15天）
      receiptTime = parseFlexibleDate(order.logisticsState?.checkTime) || parseFlexibleDate(order.receiptTime);
      normalDays = 7;
    } else {
      // 交易成功前：使用发货时间（发货后10天/15天）
      receiptTime = parseFlexibleDate(order.shippingTime);
      normalDays = 10;
    }
    const qualityDays = 15;

    // 无基准时间：截止戳为 null，页面按满额天数展示
    if (!receiptTime) {
      return { normalDeadline: null, qualityDeadline: null, normalDays, qualityDays };
    }

    // 从基准日第二天0点开始计算（和后端保持一致）
    const startDate = new Date(receiptTime.getFullYear(), receiptTime.getMonth(), receiptTime.getDate() + 1, 0, 0, 0);
    return {
      normalDeadline: startDate.getTime() + normalDays * 24 * 60 * 60 * 1000,
      qualityDeadline: startDate.getTime() + qualityDays * 24 * 60 * 60 * 1000,
      normalDays,
      qualityDays
    };
  },

  // 售后剩余时间分级格式化：
  // ≥2天只显示天；1~2天显示天+小时；<1天显示时+分；<1小时显示分+秒；<1分钟显示秒；0显示已过期
  formatCountdown(remainMs) {
    if (!Number.isFinite(remainMs) || remainMs <= 0) {
      return '已过期';
    }
    const totalSec = Math.floor(remainMs / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (days >= 2) return `${days}天`;
    if (days >= 1) return `${days}天${hours}小时`;
    if (hours >= 1) return `${hours}时${mins}分`;
    if (mins >= 1) return `${mins}分${secs}秒`;
    return `${secs}秒`;
  },

  // 每秒刷新剩余时间文案与天数（天数仅用于过期判断）
  updateCountdownTick() {
    const nowMs = Date.now();
    const buildState = (deadline, maxDays) => {
      if (!deadline) {
        return { days: maxDays, text: `${maxDays}天` };
      }
      const remainMs = deadline - nowMs;
      if (remainMs <= 0) {
        return { days: 0, text: '已过期' };
      }
      return {
        days: Math.min(maxDays, Math.ceil(remainMs / (24 * 60 * 60 * 1000))),
        text: this.formatCountdown(remainMs)
      };
    };
    const normalState = buildState(this.data.normalDeadline || null, Number(this.data.normalMaxDays) || 7);
    const qualityState = buildState(this.data.qualityDeadline || null, Number(this.data.qualityMaxDays) || 15);
    this.setData({
      remainingNormalDays: normalState.days,
      remainingQualityDays: qualityState.days,
      remainingDays: normalState.days,
      normalText: normalState.text,
      qualityText: qualityState.text
    });
  },

  onUnload() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  },

  onHide() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  },

  onShow() {
    // 从售后详情页返回时重启倒计时
    if (!this.countdownTimer && (this.data.normalDeadline || this.data.qualityDeadline)) {
      this.updateCountdownTick();
      this.countdownTimer = setInterval(() => this.updateCountdownTick(), 1000);
    }
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
      // 退货退款：商品不支持7天无理由时，过滤掉 seven_day_no_reason 选项
      if (!this.data.supportNoReason) {
        reasons = reasons.filter(r => r.value !== 'seven_day_no_reason');
      }
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

  showAfterSalesRules() {
    this.setData({ showRulesModal: true });
  },

  closeRulesModal() {
    this.setData({ showRulesModal: false });
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
      isQualityReason: isQualityReason(parsedReason.value),
      proofImages: [],
      proofVideos: [],
      proofVideoThumbs: [],
      description: ''
    });

    if (parsedReason.requireProof) {
      this.setData({ step: 4 });
    } else {
      this.setData({ step: 5 });
    }
    // 类型/货物状态/原因已定，刷新运费退款提示
    this.updateShippingTip();
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

  previewImage(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    wx.previewImage({
      current: this.data.proofImages[index],
      urls: this.data.proofImages
    });
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
          const file = files[0];
          console.log('[申请售后视频] 选择视频:', {
            tempFilePath: file.tempFilePath,
            thumbTempFilePath: file.thumbTempFilePath,
            size: file.size,
            duration: file.duration
          });
          this.setData({
            proofVideos: [file.tempFilePath],
            proofVideoThumbs: [file.thumbTempFilePath || '']
          });
        }
      },
      fail: (err) => {
        console.error('[申请售后视频] 选择失败:', err);
      }
    });
  },

  deleteVideo(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const proofVideos = [...this.data.proofVideos];
    const proofVideoThumbs = [...this.data.proofVideoThumbs];
    proofVideos.splice(index, 1);
    proofVideoThumbs.splice(index, 1);
    this.setData({ proofVideos, proofVideoThumbs });
  },

  previewVideo() {
    const videoSrc = this.data.proofVideos[0];
    if (!videoSrc) {
      wx.showToast({ title: '视频不存在', icon: 'none' });
      return;
    }

    wx.previewMedia({
      sources: [{
        url: videoSrc,
        type: 'video'
      }],
      current: 0,
      showmenu: true,
      fail: (err) => {
        console.error('[申请售后视频] 全屏预览失败:', err);
        wx.showToast({ title: '视频预览失败，请稍后重试', icon: 'none' });
      }
    });
  },

  onDescriptionInput(e) {
    this.setData({ description: e.detail.value });
  },

  onRefundAmountInput(e) {
    // 仅允许数字和一个小数点、最多两位小数；parseFloat("84...")===84 会放过非法符号，必须先清洗
    const raw = String(e.detail.value || '');
    const sanitized = sanitizeAmountInput(raw);
    if (sanitized !== raw) {
      wx.showToast({ title: '仅支持输入数字金额，最多两位小数', icon: 'none' });
    }
    const value = parseFloat(sanitized) || 0;
    const max = this.data.maxRefundAmount;
    const finalValue = Math.min(max, Math.max(0.01, value));
    const patch = { refundAmount: Math.round(finalValue * 100) / 100 };
    // 含运费退款时（include）"预计共退"随输入联动；其他口径提示为静态文案
    if (this.data.shippingRefundTipType === 'include' && Number(this.data.shippingRefundAmount) > 0) {
      const shippingPart = Math.round((Number(this.data.shippingRefundAmount) || 0) * 100) / 100;
      const total = Math.round((finalValue + shippingPart) * 100) / 100;
      const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
      patch.shippingRefundTip = `本次退款含运费 ¥${fmt(shippingPart)}，预计共退 ¥${fmt(total)}`;
    }
    this.setData(patch);
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

    if (!isValidAmountText(refundAmount) || Number(refundAmount) <= 0) {
      wx.showToast({ title: '请填写正确的退款金额', icon: 'none' });
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

    console.log('=== 提交售后申请日志 ===');
    console.log('订单ID:', this.data.order._id);
    console.log('订单状态:', this.data.order.status);
    console.log('售后类型:', this.data.refundType);
    console.log('售后原因:', reason);
    console.log('售后原因代码:', reasonValue);
    console.log('剩余常规售后天数:', this.data.remainingNormalDays);
    console.log('剩余质量售后天数:', this.data.remainingQualityDays);
    console.log('签收时间(checkTime):', this.data.order?.logisticsState?.checkTime);
    console.log('确认收货时间(receiptTime):', this.data.order?.receiptTime);
    console.log('发货时间(shippingTime):', this.data.order?.shippingTime);
    console.log('交易是否完成:', ['completed', 'refund'].includes(this.data.order.status));
    console.log('========================');

    // 先处理视频，生成缩略图
    this.processVideosWithThumbs(proofVideos, this.data.proofVideoThumbs)
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
        
        getApp().globalData.needRefreshOrderDetail = true;
        
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

  async processVideosWithThumbs(videos, videoThumbs) {
    const uploadedVideos = [];
    const uploadedThumbs = [];
    const thumbs = Array.isArray(videoThumbs) ? videoThumbs : [];

    for (let i = 0; i < videos.length; i++) {
      const videoPath = videos[i];
      const localThumb = thumbs[i] || '';

      // 上传视频
      const videoRes = await wx.cloud.uploadFile({
        cloudPath: `after-sales/videos/${Date.now()}_${i}.mp4`,
        filePath: videoPath
      });
      uploadedVideos.push(videoRes.fileID);

      // 上传缩略图（来自 wx.chooseMedia 的 thumbTempFilePath）
      if (localThumb) {
        try {
          const thumbRes = await wx.cloud.uploadFile({
            cloudPath: `after-sales/thumbs/${Date.now()}_${i}.jpg`,
            filePath: localThumb
          });
          uploadedThumbs.push(thumbRes.fileID);
        } catch (e) {
          console.error('[申请售后视频] 缩略图上传失败:', e);
          uploadedThumbs.push('');
        }
      } else {
        uploadedThumbs.push('');
      }
    }

    return { uploadedVideos, uploadedThumbs };
  },

  goBack() {
    wx.navigateBack();
  }
});