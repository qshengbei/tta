const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const _ = db.command;

const { logOrderOperation } = require('./common/orderLogHelper');

function formatDateTimeString(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function normalizeCheckTimeValue(arrivalTime) {
  if (arrivalTime === undefined || arrivalTime === null) {
    return '';
  }
  if (typeof arrivalTime === 'string') {
    return arrivalTime.trim();
  }
  if (arrivalTime instanceof Date || typeof arrivalTime === 'number') {
    return formatDateTimeString(arrivalTime);
  }
  return '';
}

function parseFlexibleDate(value) {
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
    const text = value.trim();
    if (!text) return null;

    let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2})$/);
    if (m) {
      const [, y, mo, d, h] = m;
      const parsed = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), 0, 0);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})$/);
    if (m) {
      const [, y, mo, d, h, mi] = m;
      const parsed = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), 0);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
    if (m) {
      const [, y, mo, d, h, mi, s] = m;
      const parsed = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const fallback = new Date(text.replace(' ', 'T'));
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  if (typeof value === 'object') {
    if (value._seconds) {
      const parsed = new Date(value._seconds * 1000);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (typeof value.toDate === 'function') {
      const parsed = value.toDate();
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (value.$date) {
      const parsed = new Date(value.$date);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  return null;
}

async function getServiceTimeConfig() {
  const defaults = {
    autoConfirmReceiptDays: 3,
    supportNoReasonReturnRefund: true,
    supportNoReasonReturn: true,
    supportQualityRefund: true,
    supportQualityExchange: true,
    noReasonReturnDays: 7,
    normalAfterSalesDays: 7,
    qualityAfterSalesDays: 15,
    // 寄回运费补偿兜底额：订单无寄出运费信息（历史订单/运费为0）时使用的固定补偿；0=无运费订单不补偿。
    // 正常订单优先按该单寄出规则运费补偿，不取此值
    returnShippingCompensationAmount: 10,
    // 运费承担规则（4 个场景：买家/卖家原因 × 部分/整单退货）
    // 注意：deductOutbound（扣除寄出运费）已停用——发货运费永不倒扣；仅 compensateReturn（寄回运费补偿）生效
    shippingFeeRules: DEFAULT_SHIPPING_FEE_RULES.map((r) => ({ ...r }))
  };

  try {
    const settingsRes = await db.collection('settings').limit(1).get();
    const settings = (settingsRes.data && settingsRes.data[0]) || {};
    const cfg = settings.afterSalesTimeConfig && typeof settings.afterSalesTimeConfig === 'object'
      ? settings.afterSalesTimeConfig
      : {};

    const autoConfirmReceiptDays = Number(cfg.autoConfirmReceiptDays ?? settings.autoConfirmReceiptDays ?? defaults.autoConfirmReceiptDays);
    const supportNoReasonReturnRefund = (cfg.supportNoReasonReturnRefund ?? settings.supportNoReasonReturnRefund) !== false;
    const supportQualityRefund = (cfg.supportQualityRefund ?? settings.supportQualityRefund) !== false;
    const supportQualityExchange = (cfg.supportQualityExchange ?? settings.supportQualityExchange) !== false;
    const noReasonReturnDays = Number(cfg.noReasonReturnDays ?? settings.noReasonReturnDays ?? defaults.noReasonReturnDays);
    const normalAfterSalesDays = Number(cfg.normalAfterSalesDays ?? settings.normalAfterSalesDays ?? defaults.normalAfterSalesDays);
    const qualityAfterSalesDays = Number(cfg.qualityAfterSalesDays ?? settings.qualityAfterSalesDays ?? defaults.qualityAfterSalesDays);
    const rawCompensation = Number(
      cfg.returnShippingCompensationAmount ?? settings.returnShippingCompensationAmount ?? defaults.returnShippingCompensationAmount
    );
    const returnShippingCompensationAmount = Number.isFinite(rawCompensation) && rawCompensation >= 0
      ? roundAmount(rawCompensation)
      : defaults.returnShippingCompensationAmount;
    const shippingFeeRules = normalizeShippingFeeRules(
      Array.isArray(cfg.shippingFeeRules) ? cfg.shippingFeeRules : settings.shippingFeeRules
    );

    return {
      autoConfirmReceiptDays: autoConfirmReceiptDays > 0 ? autoConfirmReceiptDays : defaults.autoConfirmReceiptDays,
      supportNoReasonReturn: supportNoReasonReturnRefund,
      supportNoReasonReturnRefund,
      supportQualityRefund,
      supportQualityExchange,
      noReasonReturnDays: noReasonReturnDays > 0 ? noReasonReturnDays : defaults.noReasonReturnDays,
      normalAfterSalesDays: normalAfterSalesDays > 0 ? normalAfterSalesDays : defaults.normalAfterSalesDays,
      qualityAfterSalesDays: qualityAfterSalesDays > 0 ? qualityAfterSalesDays : defaults.qualityAfterSalesDays,
      returnShippingCompensationAmount,
      shippingFeeRules
    };
  } catch (error) {
    console.error('读取售后时效配置失败，使用默认值:', error);
    return defaults;
  }
}

function getOrderServicePolicy(order, fallbackConfig) {
  const snapshot = order && order.policySnapshot && typeof order.policySnapshot === 'object'
    ? order.policySnapshot
    : null;

  if (!snapshot) {
    return fallbackConfig;
  }

  return {
    autoConfirmReceiptDays: Number(snapshot.autoConfirmReceiptDays ?? fallbackConfig.autoConfirmReceiptDays),
    supportNoReasonReturnRefund: (snapshot.supportNoReasonReturnRefund ?? fallbackConfig.supportNoReasonReturnRefund) !== false,
    supportNoReasonReturn: (snapshot.supportNoReasonReturnRefund ?? fallbackConfig.supportNoReasonReturnRefund) !== false,
    supportQualityRefund: (snapshot.supportQualityRefund ?? fallbackConfig.supportQualityRefund) !== false,
    supportQualityExchange: (snapshot.supportQualityExchange ?? fallbackConfig.supportQualityExchange) !== false,
    noReasonReturnDays: Number(snapshot.noReasonReturnDays ?? fallbackConfig.noReasonReturnDays),
    normalAfterSalesDays: Number(snapshot.normalAfterSalesDays ?? fallbackConfig.normalAfterSalesDays),
    qualityAfterSalesDays: Number(snapshot.qualityAfterSalesDays ?? fallbackConfig.qualityAfterSalesDays)
  };
}

function roundAmount(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeSingleAfterSalesTypeConfig(typeConfig, defaultConfig) {
  const source = typeConfig && typeof typeConfig === 'object' ? typeConfig : {};
  return {
    shippingResponsibility: source.shippingResponsibility === 'buyer' ? 'buyer' : defaultConfig.shippingResponsibility,
    requireImage: source.requireImage !== undefined ? source.requireImage === true : defaultConfig.requireImage,
    requireVideo: source.requireVideo !== undefined ? source.requireVideo === true : defaultConfig.requireVideo
  };
}

function normalizeAfterSalesTypeConfigs(rawConfig) {
  const defaults = {
    refund: { shippingResponsibility: 'buyer', requireImage: false, requireVideo: false },
    return_refund: { shippingResponsibility: 'buyer', requireImage: false, requireVideo: false },
    refund_received: { shippingResponsibility: 'buyer', requireImage: false, requireVideo: false },
    refund_not_received: { shippingResponsibility: 'buyer', requireImage: false, requireVideo: false },
    exchange: { shippingResponsibility: 'seller', requireImage: false, requireVideo: false }
  };
  const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  return {
    refund: normalizeSingleAfterSalesTypeConfig(source.refund, defaults.refund),
    return_refund: normalizeSingleAfterSalesTypeConfig(source.return_refund, defaults.return_refund),
    refund_received: normalizeSingleAfterSalesTypeConfig(source.refund_received, defaults.refund_received),
    refund_not_received: normalizeSingleAfterSalesTypeConfig(source.refund_not_received, defaults.refund_not_received),
    exchange: normalizeSingleAfterSalesTypeConfig(source.exchange, defaults.exchange)
  };
}

function normalizeAfterSalesType(value) {
  const type = String(value || '').trim();
  if (!type) {
    return 'refund';
  }
  return type;
}

// 售后类型 → 中文展示名（用于订单操作日志）
const AFTER_SALES_TYPE_LABELS = {
  'refund': '退款',
  'refund_received': '退款（已收到货）',
  'refund_not_received': '退款（未收到货）',
  'not_received_refund': '退款（未收到货）',
  'return_refund': '退货退款',
  'quality_refund': '质量问题退款',
  'quality_return_refund': '质量问题退货退款',
  'exchange': '换货',
  'quality_exchange': '质量问题换货'
};
function getAfterSalesTypeLabel(type) {
  const t = String(type || '').trim();
  return AFTER_SALES_TYPE_LABELS[t] || (t ? t : '售后');
}

function isNoReasonAfterSalesType(type, config) {
  return type === 'refund' && !!config?.supportNoReasonReturnRefund;
}

function isQualityAfterSalesType(type) {
  return type === 'exchange';
}

function isRefundOnlyType(type) {
  // 仅退款类型不需要退货：退款（已收到货）、退款（未收到货）、未收到货退款
  const refundOnlyTypes = ['refund', 'refund_received', 'refund_not_received', 'not_received_refund'];
  return refundOnlyTypes.includes(type);
}

function requiresEvidence(type, config) {
  return false;
}

function getShippingResponsibility(type, config) {
  // 换货由卖家承担运费
  if (type === 'exchange') {
    return 'seller';
  }
  // 其他类型由买家承担运费（后续可根据原因调整）
  return 'buyer';
}

// 质量原因列表
const QUALITY_REASONS = [
  'size_mismatch',      // 尺寸不符
  'color_mismatch',      // 颜色/图案/款式不符
  'material_mismatch',  // 材质与描述不符
  'fade',               // 褪色
  'quality',            // 质量问题
  'missing',            // 漏发
  'damaged',            // 破损/损坏
  'wrong_item'          // 发错货
];

// 根据原因判断运费承担（与前端详情页同口径）
function getShippingResponsibilityByReason(reasonCode, type) {
  // 质量原因由卖家承担运费
  if (reasonCode && QUALITY_REASONS.includes(reasonCode)) {
    return 'seller';
  }
  // 其他原因（不想要了、七天无理由等）由买家承担运费
  return 'buyer';
}

function getAllowDaysForAfterSalesType(type, config, isTransactionCompleted = true, reasonCode = '') {
  // 未收到货退款没有时间限制
  if (type === 'refund_not_received') {
    return -1;
  }
  // 换货和质量问题售后15天
  if (type === 'exchange' || type === 'quality_refund') {
    return config.qualityAfterSalesDays || 15;
  }
  // 如果是质量原因，返回质量售后时效（15天）
  if (QUALITY_REASONS.includes(reasonCode)) {
    return config.qualityAfterSalesDays || 15;
  }
  // 普通售后：交易成功后7天，交易成功前10天（发货后10天）
  if (isTransactionCompleted) {
    return config.normalAfterSalesDays || 7;
  } else {
    return 10;
  }
}

function isAllowedAfterSalesType(type) {
  return type === 'refund'
    || type === 'refund_received'
    || type === 'refund_not_received'
    || type === 'return_refund'
    || type === 'exchange';
}

function generateAfterSalesCaseNo() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AS${yyyy}${mm}${dd}${hh}${mi}${ss}${suffix}`;
}

function getOrderProducts(order) {
  return Array.isArray(order?.productsList) && order.productsList.length > 0
    ? order.productsList
    : Array.isArray(order?.products)
      ? order.products
      : [];
}

function normalizeOrderProducts(order) {
  return getOrderProducts(order).map((product, index) => {
    const buyQty = Number(product.quantity || product.buyQty || product.count || 1) || 1;
    const unitPrice = roundAmount(product.price ?? product.productPrice ?? product.unitPrice ?? 0);
    const lineAmount = roundAmount(product.totalPrice ?? product.totalAmount ?? product.amount ?? (unitPrice * buyQty));
    return {
      raw: product,
      index,
      orderItemId: String(product.orderItemId || `${order._id}_${index}`),
      productId: product.productId || product._id || '',
      skuId: product.skuId || product.specId || product.variantId || '',
      productName: product.productName || product.name || '商品',
      skuName: product.specs || product.spec || product.skuName || '',
      coverImage: product.productImage || product.imageUrl || product.productImg || product.coverImage || '',
      buyQty,
      unitPrice,
      lineAmount
    };
  });
}

function calculateItemRefundAmount(orderItem, applyQty) {
  const qty = Number(applyQty || 0);
  if (qty <= 0) {
    return 0;
  }
  if (orderItem.lineAmount > 0 && orderItem.buyQty > 0) {
    return roundAmount((orderItem.lineAmount / orderItem.buyQty) * qty);
  }
  return roundAmount(orderItem.unitPrice * qty);
}

// 换货收到新货后允许对新货二次售后（仿淘宝）：
// 第1代换货（原始商品的换货）完成并交付新货后，件数释放占用、售后期从确认收新货重新起算；
// 第2代售后（新货再次售后）完成后继续占用，防止无限换货/退款。
const RE_AFTER_SALES_MAX_GENERATION = 2;

function getItemAfterSalesGeneration(item) {
  const gen = Number(item?.afterSalesGeneration || 0) || 0;
  return gen >= 1 ? gen : 1;
}

// 已完成换货明细是否属于"新货已交付买家"且可释放占用：
// returnGoodsType='new'（或老数据无标记）= 验货通过后商家发出新货；
// returnGoodsType='original' = 验货不通过寄回原货，不释放（不重新起算售后期）
function isReleasedExchangeItem(item) {
  if (String(item?.itemStatus || '').trim() !== 'completed') {
    return false;
  }
  if (!EXCHANGE_TYPES.includes(String(item?.afterSalesType || ''))) {
    return false;
  }
  if (String(item.returnGoodsType || '') === 'original') {
    return false;
  }
  return getItemAfterSalesGeneration(item) < RE_AFTER_SALES_MAX_GENERATION;
}

// 一条已完成退款明细对应的"份额金额"（该件数按单价应退的金额）
function calcItemShareAmount(item) {
  const applyQty = Number(item?.applyQty || 0) || 0;
  const unitPrice = Number(item?.unitPriceSnapshot || 0) || 0;
  if (unitPrice > 0) {
    return roundAmount(unitPrice * applyQty);
  }
  const buyQty = Number(item?.buyQty || 0) || 0;
  const lineAmount = Number(item?.payableAmountSnapshot || 0) || 0;
  if (lineAmount > 0 && buyQty > 0) {
    return roundAmount((lineAmount / buyQty) * applyQty);
  }
  return roundAmount((Number(item?.maxRefundAmount || 0) || 0));
}

// ============ 运费（配送费）退款口径 ============
// 订单运费：优先取显式字段（管理端订单可能写入 shippingFee/deliveryFee），
// 历史订单未单独存运费时，用实付总额 − 商品行金额反推
function getOrderShippingFee(order, orderItems) {
  // 显式字段：元单位优先；Int 后缀为分单位（管理端历史数据兼容）
  const explicitFields = [
    ['shippingFee', false],
    ['deliveryFee', false],
    ['expressFee', false],
    ['postFee', false],
    ['freight', false],
    ['shippingFeeInt', true],
    ['deliveryFeeInt', true]
  ];
  for (const [field, isCent] of explicitFields) {
    const num = Number(order?.[field]);
    if (Number.isFinite(num) && num > 0) {
      return roundAmount(isCent ? num / 100 : num);
    }
  }
  const items = Array.isArray(orderItems) && orderItems.length > 0
    ? orderItems
    : normalizeOrderProducts(order || {});
  const goodsAmount = items.reduce((sum, item) => {
    const line = Number(item.lineAmount);
    if (line > 0) {
      return sum + line;
    }
    return sum + (Number(item.unitPrice || 0) * Number(item.buyQty || 0));
  }, 0);
  const paidAmount = Number(order?.totalPrice ?? order?.totalAmount ?? 0) || 0;
  return roundAmount(Math.max(0, paidAmount - goodsAmount));
}

// 订单原运费（规则运费，包邮时仍 > 0）：买家责任整单退款时需从退款中扣减，
// 避免包邮订单被无理由退货后仍由商家承担运费成本。历史订单无该字段时退化为实付运费（等价于不扣减）
function getOrderOriginalShippingFee(order, orderItems) {
  const explicitFields = [
    ['originalDeliveryFee', false],
    ['originalShippingFee', false],
    ['originalFreight', false],
    ['originalDeliveryFeeInt', true],
    ['originalShippingFeeInt', true]
  ];
  for (const [field, isCent] of explicitFields) {
    const raw = order?.[field];
    const num = Number(raw);
    if (raw !== undefined && raw !== null && raw !== '' && Number.isFinite(num) && num > 0) {
      return roundAmount(isCent ? num / 100 : num);
    }
  }
  return getOrderShippingFee(order, orderItems);
}

// 有效售后明细中已承诺/已到账的运费退款（运费整单只退一次；已核准取核准额，否则取申请额）
function calcCommittedShippingRefund(items) {
  return roundAmount((Array.isArray(items) ? items : []).reduce((sum, item) => {
    const status = String(item?.itemStatus || '');
    if (status === 'cancelled' || status === 'rejected') {
      return sum;
    }
    const approved = Number(item?.approvedShippingRefundAmount || 0) || 0;
    const applied = Number(item?.applyShippingRefundAmount || 0) || 0;
    return sum + (approved > 0 ? approved : applied);
  }, 0));
}

// 有效售后明细中已承诺/已生效的运费扣减（运费整单只扣一次；已核准取核准额，否则取申请额）
function calcCommittedShippingDeduction(items) {
  return roundAmount((Array.isArray(items) ? items : []).reduce((sum, item) => {
    const status = String(item?.itemStatus || '');
    if (status === 'cancelled' || status === 'rejected') {
      return sum;
    }
    const approved = Number(item?.approvedShippingDeductionAmount || 0) || 0;
    const applied = Number(item?.applyShippingDeductionAmount || 0) || 0;
    return sum + (approved > 0 ? approved : applied);
  }, 0));
}

// 卖家责任退款类型（质量类退货/退款，发货运费由卖家承担）
const SHIPPING_REFUND_SELLER_TYPES = ['quality_refund', 'quality_return_refund'];
function isSellerResponsibleRefundType(type, reasonCode) {
  if (SHIPPING_REFUND_SELLER_TYPES.includes(String(type || ''))) {
    return true;
  }
  return QUALITY_REASONS.includes(String(reasonCode || ''));
}

// 整单判定：历史有效明细 + 本次申请覆盖订单全部件数，且历史不含换货（换货说明交易部分留存）
function isWholeOrderShippingCase(orderItems, applyList, existingValidItems) {
  const validExisting = (Array.isArray(existingValidItems) ? existingValidItems : [])
    .filter((item) => !['cancelled', 'rejected'].includes(String(item?.itemStatus || '')));
  if (validExisting.some((item) => EXCHANGE_TYPES.includes(String(item?.afterSalesType || '')))) {
    return false;
  }
  const totalOrderQty = (Array.isArray(orderItems) ? orderItems : [])
    .reduce((sum, item) => sum + (Number(item.buyQty) || 0), 0);
  const coveredQty = validExisting.reduce((sum, item) => sum + (Number(item.applyQty) || 0), 0)
    + (Array.isArray(applyList) ? applyList : []).reduce((sum, item) => sum + (Number(item.applyQty) || 0), 0);
  return coveredQty >= totalOrderQty;
}

// ============ 运费承担规则（可在商家设置页配置） ============
// 4 个场景：买家原因/卖家原因 × 部分退货/整单退货
// deductOutbound：已停用（保留字段仅兼容历史配置）。新运费政策下发货运费永不做反向扣减——
// 包邮/运费优惠是商家自愿促销承诺，买家责任退货通过"实付运费不退"自然承担，包邮差额不补收（对齐主流电商口径）
// compensateReturn=true：补偿买家寄回运费（按本单寄出规则运费，封顶 1000 元）
const DEFAULT_SHIPPING_FEE_RULES = [
  { key: 'buyer_partial', label: '买家原因·部分退货', deductOutbound: false, compensateReturn: false },
  { key: 'seller_partial', label: '卖家原因·部分退货', deductOutbound: false, compensateReturn: true },
  { key: 'buyer_whole', label: '买家原因·整单退货', deductOutbound: false, compensateReturn: false },
  { key: 'seller_whole', label: '卖家原因·整单退货', deductOutbound: false, compensateReturn: true }
];

function normalizeShippingFeeRules(rawRules) {
  const source = Array.isArray(rawRules) ? rawRules : [];
  return DEFAULT_SHIPPING_FEE_RULES.map((def) => {
    const found = source.find((r) => r && r.key === def.key);
    return {
      key: def.key,
      label: def.label,
      deductOutbound: found && typeof found.deductOutbound === 'boolean' ? found.deductOutbound : def.deductOutbound,
      compensateReturn: found && typeof found.compensateReturn === 'boolean' ? found.compensateReturn : def.compensateReturn
    };
  });
}

function getShippingFeeRule(config, isSeller, isWholeOrder) {
  const rules = Array.isArray(config?.shippingFeeRules) ? config.shippingFeeRules : DEFAULT_SHIPPING_FEE_RULES;
  const key = isSeller
    ? (isWholeOrder ? 'seller_whole' : 'seller_partial')
    : (isWholeOrder ? 'buyer_whole' : 'buyer_partial');
  const found = rules.find((r) => r && r.key === key);
  const def = DEFAULT_SHIPPING_FEE_RULES.find((r) => r.key === key) || {};
  return {
    deductOutbound: found && typeof found.deductOutbound === 'boolean' ? found.deductOutbound : def.deductOutbound,
    compensateReturn: found && typeof found.compensateReturn === 'boolean' ? found.compensateReturn : def.compensateReturn
  };
}

/**
 * 计算本次售后申请的发货运费口径（系统自动判定，不接受前端传值）：
 * refundAmount（退还运费）= 实付运费 − 已承诺运费退款
 * 1. 未收到货退款（配送服务未完成）→ 退实付运费
 * 2. 换货、混合责任 → 不退
 * 3. 部分退款 / 买家责任（含整单）→ 不退实付运费（买家通过"实付运费不退"自然承担）
 * 4. 卖家责任整单退款 → 退还实付运费给买家
 * 运费整单只退一次（历史有效明细已承诺过则不再重复）。
 *
 * 重要政策（对齐淘宝主流口径）：发货运费永不做反向扣减——包邮/运费优惠是商家自愿的促销承诺，
 * 买家退货退款时不得从商品退款中倒扣"下单时已免的原运费"（包邮差额）。
 * 商家配置 shippingFeeRules 中的 deductOutbound 开关因此不再生效（字段保留仅为兼容历史配置与历史明细结算）。
 */
function resolveApplyShippingRefund(order, orderItems, normalizedItems, existingValidItems, config) {
  const paidFee = getOrderShippingFee(order, orderItems);
  const originalFee = getOrderOriginalShippingFee(order, orderItems);
  if (!(paidFee > 0) && !(originalFee > 0)) {
    return { refundAmount: 0, deductionAmount: 0 };
  }

  const existing = Array.isArray(existingValidItems) ? existingValidItems : [];
  const remainRefund = roundAmount(paidFee - calcCommittedShippingRefund(existing));

  const applyList = Array.isArray(normalizedItems) ? normalizedItems : [];
  if (applyList.length === 0) {
    return { refundAmount: 0, deductionAmount: 0 };
  }
  const types = applyList.map((item) => String(item.afterSalesType || ''));

  // 未收到货/物流拦截：配送未完成，运费全额退
  if (types.includes('refund_not_received') || types.includes('not_received_refund')) {
    return {
      refundAmount: remainRefund > REFUND_AMOUNT_TOLERANCE ? remainRefund : 0,
      deductionAmount: 0
    };
  }

  // 仅退款类才可能涉及发货运费（换货不涉及运费退款）
  if (!types.every((type) => REFUND_TYPES.includes(type))) {
    return { refundAmount: 0, deductionAmount: 0 };
  }

  // 仅退款（已收到货）：买家保留商品、无需寄回，配送服务已完成且交易留存，不涉及发货运费退还
  // （寄回运费补偿在 resolveApplyReturnShippingCompensation 中另行排除）。
  // 混合批次（同时含退货退款明细）走下方整单/部分规则。
  if (types.every((type) => type === 'refund_received')) {
    return { refundAmount: 0, deductionAmount: 0 };
  }

  // 整体责任判定（混合责任从严不退）
  const allSeller = applyList.every((item) => isSellerResponsibleRefundType(item.afterSalesType, item.reasonCode));
  const allBuyer = applyList.every((item) => !isSellerResponsibleRefundType(item.afterSalesType, item.reasonCode));
  if (!allSeller && !allBuyer) {
    return { refundAmount: 0, deductionAmount: 0 };
  }

  const isWholeOrder = isWholeOrderShippingCase(orderItems, applyList, existing);
  // 卖家责任整单：退还实付运费给买家；其余场景（含买家责任整单/部分退款）实付运费不退。
  // deductionAmount 恒为 0：包邮差额永不倒扣（见函数头政策说明），与申请顺序/责任混合方式无关。
  const refundAmount = (allSeller && isWholeOrder && remainRefund > REFUND_AMOUNT_TOLERANCE)
    ? remainRefund
    : 0;
  return { refundAmount, deductionAmount: 0 };
}

// 运费扣减口径：
// 新口径（shippingDeductionNetted=true）：买家承担的原运费已直接内扣在商品退款额中（最多可退已是净额），
// 汇总实际退款时不得再次扣减；
// 历史明细（无标记）：扣减额独立于商品退款，实际退款 = 商品退款 + 运费退款 − 运费扣减，仍按原口径计算。
function getItemEffectiveShippingDeduction(item) {
  if (item?.shippingDeductionNetted) {
    return 0;
  }
  return Number(item?.approvedShippingDeductionAmount || 0) || 0;
}

// 换货售后类型常量（注意：必须在顶层 RETURN_SHIPPING_COMPENSATION_TYPES 展开使用之前定义，
// const 存在暂时性死区，前向引用会导致模块加载即抛 ReferenceError，云函数整体崩溃 -504002）
const EXCHANGE_TYPES = ['exchange', 'quality_exchange'];

// 商家审核时可调整的单笔寄回运费补偿上限（防误操作/篡改；按订单运费自动计算时也以此封顶）
const RETURN_SHIPPING_COMPENSATION_MAX = 1000;

// 寄回运费补偿（逆向运费）：卖家责任且需要买家寄回的售后（退货退款/换货）。
// 补偿额优先取该笔订单的寄出规则运费（包邮订单取规则运费而非实付0，与卖家实际寄出成本对称）；
// 订单无任何运费字段（历史订单/运费为0）时回退到商家配置的固定补偿额；
// 每个售后单只补偿一次（不按件叠加），挂在第一条符合条件的明细上。
// 与发货运费（applyShippingRefundAmount/applyShippingDeductionAmount）相互独立：
// 前者处理下单时那笔配送费的退/扣，本补偿处理售后寄回产生的逆向快递费。
// 返回 { amount, carrierIndex }：carrierIndex 为承载补偿的明细下标，-1 表示本次不补偿
// quality_refund 来自 after-sales/apply 独立页：质量原因的退货退款经 afterSales 转换后使用该类型，仍需买家寄回，纳入补偿
const RETURN_SHIPPING_COMPENSATION_TYPES = ['return_refund', 'quality_return_refund', 'quality_refund', ...EXCHANGE_TYPES];
function resolveApplyReturnShippingCompensation(applyList, order, orderItems, config, existingValidItems) {
  const noCompensation = { amount: 0, carrierIndex: -1 };
  if (!Array.isArray(applyList) || applyList.length === 0) {
    return noCompensation;
  }
  // 找到第一条需寄回的明细作为候选承载者（仅退款/未收到货退款无需寄回，不补偿）
  const carrierIndex = applyList.findIndex((item) => {
    const type = String(item?.afterSalesType || '');
    if (isRefundOnlyType(type)) {
      return false;
    }
    return RETURN_SHIPPING_COMPENSATION_TYPES.includes(type);
  });
  if (carrierIndex < 0) {
    return noCompensation;
  }
  // 整体责任判定（混合责任不补偿，与发货运费口径一致）
  const allSeller = applyList.every((item) => isSellerResponsibleRefundType(item.afterSalesType, item.reasonCode));
  const allBuyer = applyList.every((item) => !isSellerResponsibleRefundType(item.afterSalesType, item.reasonCode));
  if (!allSeller && !allBuyer) {
    return noCompensation;
  }
  const isWholeOrder = isWholeOrderShippingCase(orderItems, applyList, existingValidItems || []);
  const rule = getShippingFeeRule(config, allSeller, isWholeOrder);
  if (!rule.compensateReturn) {
    return noCompensation;
  }
  // 优先按订单寄出规则运费（含包邮订单的规则运费）；无运费信息时回退配置固定额；统一封顶
  const orderFreight = getOrderOriginalShippingFee(order, orderItems);
  const configFallback = roundAmount(Number(config?.returnShippingCompensationAmount) || 0);
  const baseAmount = orderFreight > 0 ? orderFreight : configFallback;
  const amount = Math.min(roundAmount(baseAmount), RETURN_SHIPPING_COMPENSATION_MAX);
  return amount > 0 ? { amount, carrierIndex } : noCompensation;
}

// ============ 寄回运费补偿按退货运单号去重 ============
// 政策：寄回运费补偿与买家实际寄回的退货物流运单绑定——同一订单内同一运单号只补偿一次。
// 买家在申请时看到的 ¥x 是"预估补偿"；真正生效以提交退货单号时的去重结果为准：
// 一个包裹拆成多笔售后单填同一运单号 → 只有第一笔补偿，其余自动取消；改填不重复的新单号可自动恢复。
// 运单号规范化：去除全部空白并转大写（运单号常含字母，大小写/空格差异不应绕过去重）
function normalizeReturnTrackingNo(raw) {
  return String(raw == null ? '' : raw).replace(/\s+/g, '').toUpperCase();
}

// 占用运单号的售后单需仍有效（取消/拒绝的售后单不占用，其单号可被其他售后单使用）
const DEDUP_EXCLUDED_CASE_STATUSES = ['cancelled', 'rejected'];

// 在事务内查询同订单是否已有"其他有效售后单"使用同一运单号；返回冲突案件，无冲突返回 null
async function findDuplicateReturnTrackingCase(transaction, orderId, trackingNumber, excludeCaseId) {
  const target = normalizeReturnTrackingNo(trackingNumber);
  if (!orderId || !target) {
    return null;
  }
  const casesRes = await transaction.collection('after_sales_cases').where({ orderId }).limit(100).get();
  const duplicate = (casesRes.data || []).find((caseDoc) => String(caseDoc._id) !== String(excludeCaseId)
    && !DEDUP_EXCLUDED_CASE_STATUSES.includes(String(caseDoc.caseStatus || ''))
    && normalizeReturnTrackingNo(caseDoc?.returnLogisticsInfo?.trackingNumber) === target);
  return duplicate || null;
}

// 运单号重复：挂起本售后单的寄回运费补偿（申请建议额/核准额清零，原核准（或建议）额存挂起字段，改单号后可恢复）
async function suspendCaseReturnShippingCompensation(transaction, caseItems, now) {
  const targets = (Array.isArray(caseItems) ? caseItems : []).filter((item) =>
    (Number(item.applyReturnShippingCompensationAmount || 0) > 0
      || Number(item.approvedReturnShippingCompensationAmount || 0) > 0
      || Number(item.returnShippingCompensationSuspendedAmount || 0) > 0));
  await Promise.all(targets.map((item) => {
    // 已挂起过（如再次改成另一个重复单号）保留最早的挂起额，不被清零后的 0 覆盖
    const suspended = roundAmount(Number(item.returnShippingCompensationSuspendedAmount || 0)
      || getItemApprovedReturnShippingCompensation(item));
    return transaction.collection('after_sales_case_items').doc(item._id).update({
      data: {
        applyReturnShippingCompensationAmount: 0,
        approvedReturnShippingCompensationAmount: 0,
        returnShippingCompensationSuspendedAmount: suspended,
        updatedAt: now
      }
    });
  }));
  return targets.length;
}

// 运单号改填为不重复的新号后：恢复此前因重复被挂起的寄回运费补偿（恢复到挂起前的核准/建议额）
async function restoreCaseReturnShippingCompensation(transaction, caseItems, now) {
  const targets = (Array.isArray(caseItems) ? caseItems : []).filter((item) =>
    Number(item.returnShippingCompensationSuspendedAmount || 0) > 0);
  await Promise.all(targets.map((item) => {
    const amount = roundAmount(Number(item.returnShippingCompensationSuspendedAmount || 0) || 0);
    return transaction.collection('after_sales_case_items').doc(item._id).update({
      data: {
        applyReturnShippingCompensationAmount: amount,
        approvedReturnShippingCompensationAmount: amount,
        returnShippingCompensationSuspendedAmount: 0,
        updatedAt: now
      }
    });
  }));
  return targets.length;
}

// 明细已核准的寄回运费补偿：审核时总会写入核准值（包括商家调整为0）；
// 历史/未核准明细（无该字段）回退到申请建议额
function getItemApprovedReturnShippingCompensation(item) {
  const raw = item?.approvedReturnShippingCompensationAmount;
  if (raw === undefined || raw === null || raw === '') {
    return Number(item?.applyReturnShippingCompensationAmount || 0) || 0;
  }
  return Number(raw) || 0;
}

// 售后单寄回运费补偿合计（已核准口径，通常一笔，兼容多条明细）
function calcCaseReturnShippingCompensation(caseItems) {
  return roundAmount((Array.isArray(caseItems) ? caseItems : [])
    .reduce((sum, item) => sum + getItemApprovedReturnShippingCompensation(item), 0));
}

// 已完成明细中已 settled 的运费扣减（买家已实际承担，用于整单退款金额覆盖判定；新旧口径都计入）
function calcCompletedShippingDeduction(items) {
  return roundAmount((Array.isArray(items) ? items : [])
    .filter((item) => !['cancelled', 'rejected'].includes(String(item?.itemStatus || ''))
      && String(item?.itemStatus || '') === 'completed')
    .reduce((sum, item) => sum + (Number(item?.approvedShippingDeductionAmount || 0) || 0), 0));
}

// 售后单实际退款金额汇总（商品退款 + 发货运费退款 − 发货运费扣减 + 寄回运费补偿）；completed 件才计入已到账
// 仅用于实际打款总额计算；展示用的"退款金额"请用 calcCaseApprovedRefundAmount（不含寄回补偿，避免与补偿行重复）
function calcCaseApprovedTotalAmount(caseItems) {
  return roundAmount((Array.isArray(caseItems) ? caseItems : []).reduce((sum, item) =>
    sum + (Number(item?.approvedRefundAmount || 0) || 0)
    + (Number(item?.approvedShippingRefundAmount || 0) || 0)
    - getItemEffectiveShippingDeduction(item)
    + getItemApprovedReturnShippingCompensation(item), 0));
}
function calcCaseRefundedTotalAmount(caseItems) {
  return roundAmount((Array.isArray(caseItems) ? caseItems : [])
    .filter((item) => String(item?.itemStatus || '') === 'completed')
    .reduce((sum, item) =>
      sum + (Number(item?.approvedRefundAmount || 0) || 0)
      + (Number(item?.approvedShippingRefundAmount || 0) || 0)
      - getItemEffectiveShippingDeduction(item)
      + getItemApprovedReturnShippingCompensation(item), 0));
}

// 售后单"退款金额"展示口径：商品退款 + 发货运费退款 − 发货运费扣减（不含寄回运费补偿）。
// 寄回补偿在详情页独立成行（案件字段 approvedReturnShippingCompensationAmount），不能计入本行，否则视觉重复。
function calcCaseApprovedRefundAmount(caseItems) {
  return roundAmount((Array.isArray(caseItems) ? caseItems : []).reduce((sum, item) =>
    sum + (Number(item?.approvedRefundAmount || 0) || 0)
    + (Number(item?.approvedShippingRefundAmount || 0) || 0)
    - getItemEffectiveShippingDeduction(item), 0));
}
function calcCaseRefundedRefundAmount(caseItems) {
  return roundAmount((Array.isArray(caseItems) ? caseItems : [])
    .filter((item) => String(item?.itemStatus || '') === 'completed')
    .reduce((sum, item) =>
      sum + (Number(item?.approvedRefundAmount || 0) || 0)
      + (Number(item?.approvedShippingRefundAmount || 0) || 0)
      - getItemEffectiveShippingDeduction(item), 0));
}

// 返回订单维度的售后占用信息（按 orderItemId 分商品行聚合）：
// qtyMap：仍锁定件数（进行中售后、金额已退满的完成退款件、被承接/第2代换货件、寄回原货件等）
// releasedExchangeMap：第1代换货完成且尚未被第2代承接的"新货池"件，可二次售后，含确认收新货时间
// partialRefundMap：已完成退款但金额未退满的明细件，件数释放允许在原售后期内申请补差，不重启售后期
// committedAmountMap：商品行已承诺退款金额（进行中按申请额、完成按核准额，跨代累计）
// 代数核销规则：每件第2代售后按 1:1 承接一件第1代换货件（同一件实物不重复计数）；
// 第2代被取消/拒绝后不再承接，第1代换货件自动回到新货池。
async function getAfterSalesReservedInfo(orderId, orderItems) {
  const result = await db.collection('after_sales_case_items').where({
    orderId
  }).limit(100).get();

  const qtyMap = {};
  const releasedExchangeMap = {};
  const partialRefundMap = {};
  const committedAmountMap = {};
  const remainAmountMap = {};
  // 退货退款少退的"放弃差额"（货已寄回，该差额不可再申请）
  const forfeitedAmountMap = {};
  const items = Array.isArray(result.data) ? result.data : [];
  const orderItemMap = Array.isArray(orderItems)
    ? new Map(orderItems.map((item) => [item.orderItemId, item]))
    : new Map();

  // 按商品行分组有效明细（排除取消/拒绝）
  const grouped = {};
  items.forEach((item) => {
    const status = String(item.itemStatus || '').trim();
    if (status === 'cancelled' || status === 'rejected') {
      return;
    }
    const orderItemId = String(item.orderItemId || '');
    if (!orderItemId) {
      return;
    }
    if (!Array.isArray(grouped[orderItemId])) {
      grouped[orderItemId] = [];
    }
    grouped[orderItemId].push(item);
  });

  Object.keys(grouped).forEach((orderItemId) => {
    const groupItems = grouped[orderItemId];
    const gen1Qty = groupItems
      .filter((item) => getItemAfterSalesGeneration(item) <= 1)
      .reduce((sum, item) => sum + (Number(item.applyQty) || 0), 0);
    const gen2Qty = groupItems
      .filter((item) => getItemAfterSalesGeneration(item) >= 2)
      .reduce((sum, item) => sum + (Number(item.applyQty) || 0), 0);

    // 第1代换货已完成（新货）候选，按收新货时间从早到晚排列；
    // 第2代件优先承接最早的新货池件，剩余较新的新货件保留可申请资格
    const releasedCandidates = groupItems
      .filter((item) => isReleasedExchangeItem(item))
      .sort((a, b) => new Date(a.completedAt || 0).getTime() - new Date(b.completedAt || 0).getTime());

    let coverage = gen2Qty;
    const releasedEntries = [];
    releasedCandidates.forEach((item) => {
      const candidateQty = Number(item.applyQty || 0) || 0;
      const consumedQty = Math.min(coverage, candidateQty);
      coverage -= consumedQty;
      const residualQty = candidateQty - consumedQty;
      if (residualQty > 0) {
        releasedEntries.push({
          itemId: item._id,
          caseId: item.caseId,
          applyQty: residualQty,
          generation: 1,
          completedAt: item.completedAt || null
        });
      }
    });
    const releasedTotalQty = releasedEntries.reduce((sum, entry) => sum + entry.applyQty, 0);

    // 部分金额退款池：仅"仅退款"（货留在买家/未收到货）已完成且未退满的件才释放件数，
    // 允许在原售后期内就剩余金额再次申请（补差），售后期不重新起算。
    // "退货退款"货已寄回商家，少退的差额视为折价/扣费，件数照常锁定、差额不可再申请。
    const partialEntries = [];
    // 退货退款已完成但被少退的差额合计（该差额永久不可再申请）
    let forfeitedAmount = 0;
    groupItems
      .filter((item) => String(item.itemStatus || '') === 'completed'
        && REFUND_TYPES.includes(String(item.afterSalesType || '')))
      .forEach((item) => {
        const approved = Number(item.approvedRefundAmount || 0) || 0;
        const shareAmount = calcItemShareAmount(item);
        if (!(shareAmount > 0 && approved < shareAmount - REFUND_AMOUNT_TOLERANCE)) {
          return;
        }
        if (isRefundOnlyType(String(item.afterSalesType || ''))) {
          partialEntries.push({
            itemId: item._id,
            caseId: item.caseId,
            applyQty: Number(item.applyQty || 0) || 0,
            generation: getItemAfterSalesGeneration(item),
            completedAt: item.completedAt || null
          });
        } else {
          forfeitedAmount = roundAmount(forfeitedAmount + roundAmount(shareAmount - approved));
        }
      });
    const partialReleasedQty = partialEntries.reduce((sum, entry) => sum + entry.applyQty, 0);

    // 商品行已承诺退款金额（跨代累计）：完成按核准额，进行中尚无核准额按申请额
    const committedAmount = roundAmount(groupItems.reduce(
      (sum, item) => sum + getItemCommittedRefundAmount(item), 0));
    committedAmountMap[orderItemId] = committedAmount;

    // 当前实际被售后覆盖的实物件数 = 两代件数的较大值（第2代承接第1代，不重复计数）
    const coveredUnits = Math.max(gen1Qty, gen2Qty);
    const lockedQty = Math.max(0, coveredUnits - releasedTotalQty - partialReleasedQty);
    if (lockedQty > 0) {
      qtyMap[orderItemId] = lockedQty;
    }
    if (releasedEntries.length > 0) {
      releasedExchangeMap[orderItemId] = releasedEntries;
    }
    if (partialEntries.length > 0) {
      // 按完成时间从新到旧排列，补差申请关联最近一次部分退款案件
      partialEntries.sort((a, b) =>
        new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime());
      partialRefundMap[orderItemId] = partialEntries;
    }

    if (forfeitedAmount > 0) {
      forfeitedAmountMap[orderItemId] = forfeitedAmount;
    }

    const orderItem = orderItemMap.get(orderItemId);
    if (orderItem) {
      const lineTotal = Number(orderItem.lineAmount) > 0
        ? roundAmount(orderItem.lineAmount)
        : roundAmount(Number(orderItem.unitPrice || 0) * Number(orderItem.buyQty || 0));
      // 可申请余额 = 商品行总额 − 已承诺退款 − 退货退款少退的放弃差额
      const claimableRemain = roundAmount(lineTotal - committedAmount - forfeitedAmount);
      if (lineTotal > 0 && claimableRemain > REFUND_AMOUNT_TOLERANCE) {
        // 仅在确有剩余金额时保留金额池，便于申请校验与前端展示
        remainAmountMap[orderItemId] = claimableRemain;
      }
    }
  });

  // 全量有效明细（排除取消/拒绝），供订单级运费退款资格判定使用
  const validItems = Object.keys(grouped).reduce((all, key) => all.concat(grouped[key]), []);

  return {
    qtyMap,
    releasedExchangeMap,
    partialRefundMap,
    committedAmountMap,
    remainAmountMap,
    forfeitedAmountMap,
    validItems,
    committedShippingAmount: calcCommittedShippingRefund(validItems),
    committedShippingDeductionAmount: calcCommittedShippingDeduction(validItems)
  };
}

async function createAfterSalesLog(data) {
  await db.collection('after_sales_logs').add({
    data: {
      ...data,
      createdAt: data.createdAt || new Date()
    }
  });
}

function calcCaseStatusFromItems(items) {
  if (!items.length) {
    return 'submitted';
  }

  const statuses = items.map((item) => String(item.itemStatus || 'submitted'));
  const allCancelled = statuses.every((status) => status === 'cancelled');
  if (allCancelled) {
    return 'cancelled';
  }

  const allRejected = statuses.every((status) => status === 'rejected');
  if (allRejected) {
    return 'rejected';
  }

  // 如果有任一明细是intercepting状态，整个单就是intercepting
  if (statuses.some((status) => status === 'intercepting')) {
    return 'intercepting';
  }

  // 如果有任一明细是seller_received状态，需要判断是否全部已收货
  const hasSellerReceived = statuses.some((status) => status === 'seller_received');
  if (hasSellerReceived) {
    const allSellerReceived = statuses.every((status) => ['seller_received', 'completed'].includes(status));
    if (allSellerReceived) {
      return 'seller_reviewing';
    }
    return 'waiting_seller_receive';
  }

  // 如果有任一明细是seller_returning状态，整个单就是商家寄回中
  if (statuses.some((status) => status === 'seller_returning')) {
    return 'seller_returning';
  }

  // 如果有任一明细是buyer_receiving状态，需要判断是否全部买家待收货
  const hasBuyerReceiving = statuses.some((status) => status === 'buyer_receiving');
  if (hasBuyerReceiving) {
    const allBuyerReceiving = statuses.every((status) => ['buyer_receiving', 'completed'].includes(status));
    if (allBuyerReceiving) {
      return 'buyer_receiving';
    }
    return 'seller_returning';
  }

  // 如果有任一明细是pending_refund状态，需要判断是否全部待退款
  const hasPendingRefund = statuses.some((status) => status === 'pending_refund');
  if (hasPendingRefund) {
    const allPendingRefund = statuses.every((status) => ['pending_refund', 'completed'].includes(status));
    if (allPendingRefund) {
      return 'pending_refund';
    }
    return 'seller_reviewing';
  }

  const allClosed = statuses.every((status) => ['completed', 'rejected', 'cancelled'].includes(status));
  if (allClosed) {
    const totalApprovedAmount = items.reduce((sum, item) => sum + (Number(item.approvedRefundAmount || 0) || 0), 0);
    if (totalApprovedAmount > 0) {
      return 'pending_refund';
    }
    return 'completed';
  }

  // 审核通过：需要判断是否需要退货
  if (statuses.some((status) => ['approved', 'pending_refund', 'completed'].includes(status))) {
    // 如果有需要退货的明细（approved状态且needReturnGoods为true），状态为待买家寄回
    const hasReturnGoods = items.some((item) =>
      item.itemStatus === 'approved' && item.needReturnGoods
    );
    if (hasReturnGoods) {
      return 'waiting_buyer_return';
    }
    return 'pending_refund';
  }

  return 'reviewing';
}

// 售后类型常量（EXCHANGE_TYPES 已在文件前部补偿类型处定义）
const REFUND_TYPES = ['refund', 'quality_refund', 'return_refund', 'quality_return_refund', 'refund_received', 'refund_not_received'];

/**
 * 根据售后明细的 afterSalesType 生成标准化的 afterSalesResult 文案
 * 规则参考淘宝：
 * - 全部换货 → "换货完成"
 * - 全部退款（各种退款类型） → "退款完成"
 * - 混合类型（部分退款+部分换货） → "部分退款"
 */
// 退款金额判定容差（金额按分四舍五入）
const REFUND_AMOUNT_TOLERANCE = 0.01;

// 订单全部商品行的可退总额（商品金额，不含配送费；与售后明细 maxRefundAmount 口径一致）
function calcOrderProductsPayable(orderProducts) {
  return roundAmount((Array.isArray(orderProducts) ? orderProducts : []).reduce((sum, p) => {
    const qty = Number(p.quantity || p.buyQty || p.count || 0) || 0;
    const line = Number(p.lineAmount ?? p.payableAmount ?? 0) || 0;
    if (line > 0) {
      return sum + line;
    }
    const price = Number(p.price ?? p.productPrice ?? p.unitPrice ?? 0) || 0;
    return sum + price * qty;
  }, 0));
}

// 单条明细当前承诺的退款金额：已核准取核准额，进行中尚无核准额时取申请额（防止两笔在途申请超额）
function getItemCommittedRefundAmount(item) {
  // 换货不产生商品退款（买家退回旧货、收到等值新货），其申请时形式上写入的
  // applyRefundAmount 不得占用商品行退款金额池，否则换货新货二次退货时可退额会被算成 0
  if (EXCHANGE_TYPES.includes(String(item?.afterSalesType || ''))) {
    return 0;
  }
  const approved = Number(item?.approvedRefundAmount || 0) || 0;
  if (approved > 0) {
    return roundAmount(approved);
  }
  return roundAmount(Number(item?.applyRefundAmount || 0) || 0);
}

// 明细集合承诺退款金额合计（跨代累计：同一实物第1代部分退款+第2代补差应累加）
function calcCommittedRefundAmount(items) {
  return roundAmount((Array.isArray(items) ? items : [])
    .filter((item) => !['cancelled', 'rejected'].includes(String(item?.itemStatus || '')))
    .reduce((sum, item) => sum + getItemCommittedRefundAmount(item), 0));
}

// 已完成明细实际到账退款金额合计（跨代累计）
function calcCompletedRefundAmount(items) {
  return roundAmount((Array.isArray(items) ? items : [])
    .filter((item) => !['cancelled', 'rejected'].includes(String(item?.itemStatus || ''))
      && String(item.itemStatus || '') === 'completed')
    .reduce((sum, item) => sum + (Number(item.approvedRefundAmount || 0) || 0), 0));
}

function buildAfterSalesResult(caseItems, orderProducts) {
  if (!caseItems || caseItems.length === 0) return '';

  // 只看有效的售后明细（排除已取消/已拒绝）
  const validItems = caseItems.filter(item => !['cancelled', 'rejected'].includes(String(item.itemStatus || '')));
  if (validItems.length === 0) return '';

  const exchangeCount = validItems.filter(item => EXCHANGE_TYPES.includes(String(item.afterSalesType || ''))).length;
  const refundCount = validItems.filter(item => REFUND_TYPES.includes(String(item.afterSalesType || ''))).length;

  const totalApprovedRefundAmount = validItems.reduce((sum, item) => sum + (Number(item.approvedRefundAmount || 0) || 0), 0);

  // 订单总件数（跨商品行累加）
  const totalOrderQty = (orderProducts && orderProducts.length ? orderProducts : []).reduce(
    (sum, p) => sum + (Number(p.quantity || p.buyQty || p.count || 0) || 0), 0);
  // 已纳入退款范围的件数（待退款/退款中/已完成都算，拦截成功自动补退的明细此时是 pending_refund）
  const coveredRefundQty = validItems
    .filter(item => REFUND_TYPES.includes(String(item.afterSalesType || '')))
    .reduce((sum, item) => sum + (Number(item.applyQty || 0) || 0), 0);
  // 已完成退款的件数（仅退款类型、已完成状态）
  const completedRefundQty = validItems
    .filter(item => REFUND_TYPES.includes(String(item.afterSalesType || '')) && String(item.itemStatus || '') === 'completed')
    .reduce((sum, item) => sum + (Number(item.applyQty || 0) || 0), 0);

  // 金额口径：订单商品可退总额、当前承诺/已到账退款金额（跨代累计，支持部分退款后补差）
  // 买家责任整单退款时承担的原运费扣减（包邮差额）也属于已结算金额，计入覆盖判定，
  // 否则新口径（最多可退已内扣运费）下净额会比商品总额少一个运费，被误判为"部分退款"
  const totalPayableAmount = calcOrderProductsPayable(orderProducts);
  const committedRefundAmount = calcCommittedRefundAmount(validItems);
  const completedRefundAmount = calcCompletedRefundAmount(validItems);
  const settledCommittedDeduction = calcCommittedShippingDeduction(validItems);
  const settledCompletedDeduction = calcCompletedShippingDeduction(validItems);
  const isRefundAmountFullyCovered = totalPayableAmount > 0
    && committedRefundAmount + settledCommittedDeduction >= totalPayableAmount - REFUND_AMOUNT_TOLERANCE;
  const isRefundAmountFullyCompleted = totalPayableAmount > 0
    && completedRefundAmount + settledCompletedDeduction >= totalPayableAmount - REFUND_AMOUNT_TOLERANCE;

  // 全部换货
  if (exchangeCount > 0 && refundCount === 0) {
    return '换货完成';
  }
  // 全部退款
  if (refundCount > 0 && exchangeCount === 0) {
    if (totalApprovedRefundAmount > 0 || committedRefundAmount > 0) {
      // 整单件数都已纳入退款（如拦截成功自动整单退款）：
      // 件数全覆盖且金额退满：全部到账 → "退款完成"，仍有待退款/退款中明细 → "整单退款"；
      // 件数未全覆盖或金额未退满（单件部分金额退款）→ "部分退款"，剩余金额仍可申请
      if (totalOrderQty > 0 && coveredRefundQty >= totalOrderQty) {
        if (completedRefundQty >= totalOrderQty && isRefundAmountFullyCompleted) {
          return '退款完成';
        }
        if (isRefundAmountFullyCovered) {
          return '整单退款';
        }
      }
      return '部分退款';
    }
    return '售后完成';
  }
  // 混合类型（部分退款+部分换货）
  if (exchangeCount > 0 && refundCount > 0) {
    if (totalApprovedRefundAmount > 0) {
      return '部分退款';
    }
    return '售后完成';
  }

  // 兜底：检查是否所有商品都参与了售后
  const totalProductCount = orderProducts && orderProducts.length ? orderProducts.length : 1;
  const validIndices = new Set(validItems.map(item => String(item.orderItemIndex)));
  const allProductsHaveAfterSales = orderProducts && orderProducts.length
    ? orderProducts.every((_, index) => validIndices.has(String(index)))
    : true;

  // 部分商品有售后，其他商品没有 → 部分退款
  if (!allProductsHaveAfterSales) {
    return '部分退款';
  }

  if (totalApprovedRefundAmount > 0) {
    const coveredQty = validItems.reduce((sum, item) => sum + (Number(item.applyQty || 0) || 0), 0);
    const completedQty = validItems
      .filter(item => String(item.itemStatus || '') === 'completed')
      .reduce((sum, item) => sum + (Number(item.applyQty || 0) || 0), 0);
    if (totalOrderQty > 0 && coveredQty >= totalOrderQty) {
      if (completedQty >= totalOrderQty && isRefundAmountFullyCompleted) {
        return '退款完成';
      }
      if (isRefundAmountFullyCovered) {
        return '整单退款';
      }
    }
    return '部分退款';
  }
  return '售后完成';
}

function mapCaseStatusToOrderStatus(caseStatus, originalOrderStatus, caseItems, orderProducts) {
  if (caseStatus === 'completed') {
    // 用"件数"而非"商品行数"对比：订单1行2件，只退1件不算全部完成
    const totalOrderQty = (orderProducts && orderProducts.length ? orderProducts : []).reduce(
      (sum, p) => sum + (Number(p.quantity || p.buyQty || p.count || 0) || 0), 0);
    // 已完成售后的件数（明细的 applyQty 累加）
    const completedItemCount = caseItems
      .filter(item => String(item.itemStatus || '') === 'completed')
      .reduce((sum, item) => sum + (Number(item.applyQty || 0) || 0), 0);
    const totalProductCount = totalOrderQty || (orderProducts && orderProducts.length ? orderProducts.length : 1);

    // 检查是否有换货类型的售后
    const hasExchangeAfterSales = caseItems.some(item => EXCHANGE_TYPES.includes(String(item.afterSalesType || '')));

    // 计算实际退款金额：验货不通过导致商家寄回商品的情况，退款金额为0，不应标记为退款完成
    const totalApprovedRefundAmount = caseItems.reduce((sum, item) => sum + (Number(item.approvedRefundAmount || 0) || 0), 0);
    // 无退款金额时（验货不通过），订单状态恢复为已完成，而非退款完成
    const hasActualRefund = totalApprovedRefundAmount > 0;

    // 生成标准化的售后结果文案（用于订单详情/列表右上角显示）
    const afterSalesResult = buildAfterSalesResult(caseItems, orderProducts);

    // 如果所有商品都完成了售后（拦截成功的情况）
    // 金额口径：纯退款但商品金额未退满（单件部分金额退款）时不算整单终结，
    // 订单恢复原状态，剩余金额仍可申请补差。买家承担的运费扣减视为已结算金额，一并计入
    const totalPayableAmount = calcOrderProductsPayable(orderProducts);
    const completedRefundAmount = calcCompletedRefundAmount(caseItems);
    const settledCompletedDeduction = calcCompletedShippingDeduction(caseItems);
    const isFullyRefunded = hasActualRefund && totalPayableAmount > 0
      && completedRefundAmount + settledCompletedDeduction >= totalPayableAmount - REFUND_AMOUNT_TOLERANCE;
    if (completedItemCount >= totalProductCount
      && (hasExchangeAfterSales || !hasActualRefund || isFullyRefunded)) {
      // 换货完成或无退款金额的售后完成 → 订单状态恢复为已完成；纯退款且金额退满 → 退款完成
      return {
        status: (hasExchangeAfterSales || !hasActualRefund) ? 'completed' : 'refund_completed',
        afterSalesStatus: 'completed',
        afterSalesResult
      };
    }

    // 还有件数未完成售后 → 恢复订单状态，剩余件数继续交易、可继续申请售后
    // 注意：不能用"商品行级"判断（1行N件只售后1件时行级判断恒为true，会误判为全部完成）
    if (originalOrderStatus === 'refund' || originalOrderStatus === 'afterSales') {
      return {
        status: 'shipping',
        afterSalesStatus: 'completed',
        afterSalesResult
      };
    }

    // 历史已完成订单（completed/refund_completed）部分退款 → 保持已完成
    if (!originalOrderStatus || ['completed', 'refund_completed'].includes(originalOrderStatus)) {
      return {
        status: 'completed',
        afterSalesStatus: 'completed',
        afterSalesResult
      };
    }

    // 其他状态（delivered/shipping 等）→ 恢复原状态
    return {
      status: originalOrderStatus,
      afterSalesStatus: 'completed',
      afterSalesResult
    };
  }

  if (caseStatus === 'intercepting') {
    // 拦截中状态，订单状态保持为refund
    return {
      status: 'refund',
      afterSalesStatus: 'intercepting'
    };
  }

  if (caseStatus === 'cancelled' || caseStatus === 'rejected') {
    // 如果原来的订单状态是配送中（shipping）或待确认收货（delivered），恢复为原来的状态
    if (originalOrderStatus === 'shipping' || originalOrderStatus === 'delivered') {
      return {
        status: originalOrderStatus,
        afterSalesStatus: 'cancelled'
      };
    }
    // 如果原来的订单状态是售后中（refund），需要恢复原状态
    // 但由于 mapCaseStatusToOrderStatus 函数无法直接访问订单的 originalStatusBeforeRefund 字段
    // 这里只能保守地返回 completed 状态
    // 实际恢复逻辑应该在 refreshAfterSalesAggregation 中通过查询订单的 originalStatusBeforeRefund 来实现
    if (originalOrderStatus === 'refund' || originalOrderStatus === 'afterSales') {
      return {
        status: 'completed',
        afterSalesStatus: 'cancelled'
      };
    }
    // 如果原来的订单状态是其他非完成状态，也恢复为原来的状态
    if (originalOrderStatus && originalOrderStatus !== 'completed' && originalOrderStatus !== 'refund_completed') {
      return {
        status: originalOrderStatus,
        afterSalesStatus: 'cancelled'
      };
    }
    return {
      status: 'completed',
      afterSalesStatus: 'cancelled'
    };
  }

  return {
    status: 'refund',
    afterSalesStatus: caseStatus === 'pending_refund' ? 'processing' : 'pending'
  };
}

// 售后明细的"进行中"状态：订单任一明细处于这些状态时，订单必须保持售后中（refund）
// 注意：seller_reviewing/seller_returning/buyer_receiving 是换货/验货不通过寄回环节，同样属于进行中
const ACTIVE_AFTER_SALES_ITEM_STATUSES = [
  'submitted',
  'pending',
  'approved',
  'reviewing',
  'waiting_buyer_return',
  'waiting_seller_receive',
  'seller_received',
  'seller_reviewing',
  'seller_returning',
  'buyer_receiving',
  'pending_refund',
  'intercepting'
];

// 售后案件级别的"进行中"状态（与明细状态对应，seller_returning=换货发新货/验货不通过寄回原货）
const ACTIVE_AFTER_SALES_CASE_STATUSES = [
  'submitted',
  'pending',
  'reviewing',
  'waiting_buyer_return',
  'waiting_seller_receive',
  'seller_reviewing',
  'seller_returning',
  'buyer_receiving',
  'pending_refund',
  'intercepting'
];

function calcOrderTotalQty(orderProducts) {
  return (orderProducts && orderProducts.length ? orderProducts : []).reduce(
    (sum, p) => sum + (Number(p.quantity || p.buyQty || p.count || 0) || 0), 0);
}

// 聚合订单"已完成件数"时的跨代去重：
// 同一 orderItemId 若已存在更高代数的售后明细（换货新货的二次售后），
// 旧代数的已完成换货明细不再计数，避免同一件商品被计两次。
function calcEffectiveCompletedQty(items) {
  const maxGenerationMap = {};
  (Array.isArray(items) ? items : []).forEach((item) => {
    const status = String(item.itemStatus || '');
    if (status === 'cancelled' || status === 'rejected') {
      return;
    }
    const key = String(item.orderItemId || '');
    if (!key) {
      return;
    }
    const gen = Number(item.afterSalesGeneration || 0) || 1;
    if (gen > (maxGenerationMap[key] || 1)) {
      maxGenerationMap[key] = gen;
    }
  });
  return (Array.isArray(items) ? items : [])
    .filter((item) => String(item.itemStatus || '') === 'completed')
    .reduce((sum, item) => {
      const key = String(item.orderItemId || '');
      const gen = Number(item.afterSalesGeneration || 0) || 1;
      if (key && (maxGenerationMap[key] || 1) > gen) {
        return sum;
      }
      return sum + (Number(item.applyQty || 0) || 0);
    }, 0);
}

// 同一 orderItemId 仅保留最高代数的有效（非取消/拒绝）明细：
// 换货新货的二次售后存在时，第1代换货明细被取代，最终状态以新货售后为准
function pickEffectiveAfterSalesItems(validItems) {
  const maxGenerationMap = {};
  (Array.isArray(validItems) ? validItems : []).forEach((item) => {
    const key = String(item.orderItemId || '');
    if (!key) {
      return;
    }
    const gen = Number(item.afterSalesGeneration || 0) || 1;
    if (gen > (maxGenerationMap[key] || 1)) {
      maxGenerationMap[key] = gen;
    }
  });
  return (Array.isArray(validItems) ? validItems : []).filter((item) => {
    const key = String(item.orderItemId || '');
    if (!key) {
      return true;
    }
    return (Number(item.afterSalesGeneration || 0) || 1) >= (maxGenerationMap[key] || 1);
  });
}

/**
 * 跨订单"全部售后明细"聚合订单状态（唯一真相，件数口径，兼容一单多件/多售后单）
 * 规则：
 * 1. 存在任一进行中的明细（含其他售后单、换货寄回/待收新货环节）→ 订单保持 refund（售后中）
 * 2. 全部终结且无有效明细（全取消/拒绝）→ 恢复售后前状态
 * 3. 完成件数 < 订单总件数（其余件数从未售后）→ 恢复售后前状态（部分退款/部分换货）
 * 4. 全部件数完成：换货或无退款金额 → completed；纯退款 → refund_completed
 */
function buildOrderUpdateForAfterSales(order, allOrderCaseItems, now) {
  const updateData = {
    updatedAt: now,
    updatedAtTs: now instanceof Date ? now.getTime() : Date.now()
  };

  const items = Array.isArray(allOrderCaseItems) ? allOrderCaseItems : [];
  const activeItems = items.filter((item) =>
    ACTIVE_AFTER_SALES_ITEM_STATUSES.includes(String(item.itemStatus || '')));

  // 规则1：还有进行中的售后（任意一单、任意一件）→ 订单保持售后中
  if (activeItems.length > 0) {
    const hasIntercepting = activeItems.some((item) => String(item.itemStatus) === 'intercepting');
    updateData.status = 'refund';
    updateData.afterSalesStatus = hasIntercepting ? 'intercepting' : 'processing';
    const aggregatedResult = buildAfterSalesResult(items, order.products);
    if (aggregatedResult) {
      updateData.afterSalesResult = aggregatedResult;
      updateData.afterSalesProcessTime = now;
    }
    return updateData;
  }

  const validItems = items.filter((item) =>
    !['cancelled', 'rejected'].includes(String(item.itemStatus || '')));
  const totalOrderQty = calcOrderTotalQty(order.products);
  // 跨代去重：第2代售后存在时，第1代已完成换货件不重复计数
  const completedQty = calcEffectiveCompletedQty(items);

  // 规则2：全部售后均被取消/拒绝 → 恢复售后前状态
  if (validItems.length === 0) {
    updateData.status = order.originalStatusBeforeRefund || 'completed';
    updateData.afterSalesStatus = 'cancelled';
    updateData.afterSalesResult = '';
    updateData.afterSalesProcessTime = now;
    return updateData;
  }

  // 终结状态判断以每个商品的最高代数明细为准（二次售后取代第1代换货）
  const effectiveItems = pickEffectiveAfterSalesItems(validItems);

  // 规则3：仅部分件数完成售后，其余件数继续交易、可继续申请售后
  if (totalOrderQty > 0 && completedQty < totalOrderQty) {
    updateData.status = order.originalStatusBeforeRefund || 'completed';
    updateData.afterSalesStatus = 'completed';
  } else {
    // 规则4：全部件数售后完成
    const hasExchangeAfterSales = effectiveItems.some((item) =>
      EXCHANGE_TYPES.includes(String(item.afterSalesType || '')));
    // 退款金额跨代累计（第1代部分退款+第2代补差），不能只算最高代明细
    const totalApprovedAmount = calcCompletedRefundAmount(validItems);
    // 纯退款且商品金额已全部退满 → 退款完成；
    // 换货/无退款金额（验货不通过寄回原货）→ 已完成；
    // 纯退款但金额未退满（单件部分金额退款）→ 恢复原状态，剩余金额仍可申请补差
    // 买家责任整单退款承担的原运费（包邮差额）已在商品退款额中内扣，属于已结算金额，
    // 不计入则 84(退款) < 90(商品额) 会被误判为"金额未退满"，整单退款完成后退回原订单状态
    const totalPayableAmount = calcOrderProductsPayable(order.products);
    const settledDeduction = calcCompletedShippingDeduction(validItems);
    const isFullyRefunded = totalApprovedAmount > 0
      && totalPayableAmount > 0
      && totalApprovedAmount + settledDeduction >= totalPayableAmount - REFUND_AMOUNT_TOLERANCE;
    if (hasExchangeAfterSales || totalApprovedAmount <= 0) {
      updateData.status = 'completed';
    } else if (isFullyRefunded) {
      updateData.status = 'refund_completed';
    } else {
      updateData.status = order.originalStatusBeforeRefund || 'completed';
    }
    updateData.afterSalesStatus = 'completed';
  }

  // 文案聚合传全量有效明细：金额需跨代累计（第1代部分退款+第2代补差），件数在函数内自行统计
  const resultText = buildAfterSalesResult(validItems, order.products);
  if (resultText) {
    updateData.afterSalesResult = resultText;
    updateData.afterSalesProcessTime = now;
  }
  return updateData;
}

async function refreshAfterSalesAggregation(order, caseDoc, now, resultText) {
  console.log('refreshAfterSalesAggregation 被调用');
  console.log('caseId:', caseDoc._id);
  console.log('resultText:', resultText);
  
  const caseItemsRes = await db.collection('after_sales_case_items').where({
    caseId: caseDoc._id
  }).limit(100).get();

  const caseItems = caseItemsRes.data || [];
  console.log('找到的售后明细:', caseItems.map(i => ({ id: i._id, status: i.itemStatus })));
  
  // 获取订单的所有售后明细（用于计算订单状态）
  const allOrderCaseItemsRes = await db.collection('after_sales_case_items').where({
    orderId: order._id
  }).limit(100).get();
  const allOrderCaseItems = allOrderCaseItemsRes.data || [];
  console.log('找到的订单所有售后明细:', allOrderCaseItems.map(i => ({ id: i._id, status: i.itemStatus })));
  
  const caseStatus = calcCaseStatusFromItems(caseItems);
  console.log('计算出的售后单状态:', caseStatus);
  console.log('售后明细数量:', caseItems.length);
  console.log('售后明细详情:', caseItems.map(i => ({ id: i._id, orderItemIndex: i.orderItemIndex, approvedRefundAmount: i.approvedRefundAmount, itemStatus: i.itemStatus })));
  // 展示口径：退款金额不含寄回运费补偿（补偿在详情页独立成行；打款总额另由明细级公式计算）
  const approvedAmount = calcCaseApprovedRefundAmount(caseItems);
  console.log('计算出的approvedAmount:', approvedAmount);
  const refundedAmount = calcCaseRefundedRefundAmount(caseItems);

  // 计算订单状态信息（使用订单的所有售后明细）
  const orderStatusInfo = mapCaseStatusToOrderStatus(caseStatus, order.status, allOrderCaseItems, order.products);
  console.log('计算出的订单状态信息:', orderStatusInfo);

  console.log('准备更新售后单:', caseDoc._id);
  console.log('更新数据:', {
    caseStatus,
    processSummary: resultText ? { result: resultText, processTime: now, operatorType: 'admin' } : caseDoc.processSummary || null
  });
  
  // 计算所有售后明细的总数量和总金额
  const totalApplyQty = caseItems.reduce((sum, item) => sum + (Number(item.applyQty || 0) || 0), 0);
  const totalApplyAmount = roundAmount(caseItems.reduce((sum, item) => sum + (Number(item.applyRefundAmount || 0) || 0), 0));
  const itemCount = caseItems.length;
  
  const updateRes = await db.collection('after_sales_cases').doc(caseDoc._id).update({
    data: {
      caseStatus,
      refundSummary: {
        requestedAmount: Number(caseDoc?.refundSummary?.requestedAmount || caseDoc.totalApplyAmount || 0) || 0,
        approvedAmount,
        refundedAmount
      },
      totalApplyQty,
      totalApplyAmount,
      itemCount,
      processSummary: resultText
        ? {
            result: resultText,
            processTime: now,
            operatorType: 'admin'
          }
        : caseDoc.processSummary ? caseDoc.processSummary : null,
      updatedAt: now,
      completedAt: caseStatus === 'completed' ? now : caseDoc.completedAt || null,
      cancelledAt: caseStatus === 'cancelled' ? now : caseDoc.cancelledAt || null
    }
  });
  
  console.log('售后单更新结果:', updateRes);
  console.log('更新的文档数量:', updateRes.stats?.updated || '未知');

  // 更新订单状态和售后结果
  // 跨订单全部售后明细统一聚合（与售后处理事务同一套规则，避免一处修复多处遗漏）
  const latestAllOrderItemsRes = await db.collection('after_sales_case_items').where({
    orderId: order._id
  }).limit(100).get();
  const orderUpdateData = buildOrderUpdateForAfterSales(order, latestAllOrderItemsRes.data || [], now);
  console.log('聚合后的订单状态:', JSON.stringify({
    status: orderUpdateData.status,
    afterSalesStatus: orderUpdateData.afterSalesStatus,
    afterSalesResult: orderUpdateData.afterSalesResult || ''
  }));

  await db.collection('orders').doc(order._id).update({
    data: orderUpdateData
  });

  // 如果售后完成且有退款金额，调用退款云函数
  if (caseStatus === 'completed' && approvedAmount > 0) {
    console.log('=== 调用退款云函数 ===');
    console.log('退款金额:', approvedAmount);
    
    try {
      const refundRes = await cloud.callFunction({
        name: 'refund',
        data: {
          action: 'refund',
          orderId: order._id,
          caseId: caseDoc._id,
          amount: approvedAmount,
          outTradeNo: order.outTradeNo || order.tradeNo || '',
          reason: resultText || '售后完成退款'
        }
      });
      
      console.log('=== 退款云函数调用结果 ===');
      console.log('refundRes:', JSON.stringify(refundRes));
      
      if (refundRes.result && refundRes.result.success) {
        console.log('退款成功:', refundRes.result.data);
      } else {
        console.error('退款失败:', refundRes.result?.error || '未知错误');
      }
    } catch (refundErr) {
      console.error('调用退款云函数异常:', refundErr);
    }
  }

  return {
    caseStatus,
    orderStatusInfo
  };
}

async function getActiveAfterSalesCaseByOrder(order, params = {}) {
  console.log('=== getActiveAfterSalesCaseByOrder 被调用 ===');
  console.log('订单ID:', order._id);
  console.log('传入参数:', JSON.stringify(params, null, 2));
  
  const preferredCaseId = String(params.caseId || '').trim();
  console.log('优先查找的售后单ID:', preferredCaseId);
  console.log('preferredCaseId类型:', typeof preferredCaseId);
  console.log('preferredCaseId长度:', preferredCaseId.length);

  if (preferredCaseId) {
    console.log(`正在查询 after_sales_cases 集合，_id = "${preferredCaseId}"`);
    const preferredRes = await db.collection('after_sales_cases').doc(preferredCaseId).get().catch((err) => {
      console.error('优先查找查询失败:', err);
      return null;
    });
    console.log('优先查找结果:', preferredRes ? JSON.stringify(preferredRes.data, null, 2) : '未找到');
    
    if (preferredRes && preferredRes.data && preferredRes.data.orderId === order._id) {
      console.log('找到匹配的优先售后单');
      return preferredRes.data;
    } else if (preferredRes && preferredRes.data) {
      console.log('找到售后单但orderId不匹配:', preferredRes.data.orderId, 'vs', order._id);
    }
  }

  console.log('查找该订单的所有售后单...');
  const caseRes = await db.collection('after_sales_cases').where({
    orderId: order._id
  }).orderBy('createdAt', 'desc').limit(20).get();

  // 进行中状态包含换货发新货/寄回原货环节（seller_reviewing/seller_returning/buyer_receiving），
  // 否则换货寄回中的售后单会被误判为非活跃，导致操作错单、订单状态提前退出售后中
  const activeStatuses = ACTIVE_AFTER_SALES_CASE_STATUSES;
  const cases = Array.isArray(caseRes.data) ? caseRes.data : [];
  console.log('找到的售后单数量:', cases.length);
  console.log('所有售后单数据:', cases.map(c => ({ id: c._id, status: c.caseStatus || c.status })));
  
  const activeCase = cases.find((item) => {
    const status = item.caseStatus || item.status;
    const isActive = activeStatuses.includes(status);
    console.log('检查售后单:', item._id, '状态:', status, '是否活跃:', isActive);
    return isActive;
  }) || cases[0] || null;
  
  console.log('返回的活跃售后单:', activeCase ? activeCase._id : 'null');
  return activeCase;
}

async function saveReverseLogistics(caseDoc, params, now) {
  const reverseLogistics = params && params.reverseLogistics && typeof params.reverseLogistics === 'object'
    ? params.reverseLogistics
    : null;

  if (!reverseLogistics) {
    return null;
  }

  const data = {
    caseId: caseDoc._id,
    orderId: caseDoc.orderId,
    orderNumber: caseDoc.orderNumber,
    logisticsCompany: reverseLogistics.logisticsCompany || '',
    trackingNumber: reverseLogistics.trackingNumber || '',
    senderType: reverseLogistics.senderType || 'buyer',
    receiverAddressSnapshot: reverseLogistics.receiverAddressSnapshot || caseDoc.returnAddressSnapshot || null,
    status: reverseLogistics.status || 'created',
    shippedAt: reverseLogistics.shippedAt || null,
    signedAt: reverseLogistics.signedAt || null,
    caseItemIds: Array.isArray(reverseLogistics.caseItemIds) ? reverseLogistics.caseItemIds : [],
    updatedAt: now,
    createdAt: now
  };

  await db.collection('reverse_logistics').add({ data });
  return data;
}

/**
 * 更新订单状态
 * @param {Object} event - 事件参数
 * @param {string} event.orderId - 订单ID
 * @param {string} event.operation - 操作类型：pay, ship, deliver, confirm, cancel, applyAfterSales, processAfterSales, cancelAfterSales
 * @param {Object} event.params - 附加参数
 * @param {Object} context - 上下文
 */
exports.main = async (event, context) => {
  const {
    orderId,
    operation,
    params
  } = event;

  try {
    console.log('=== 开始更新订单状态 ===');
    console.log('订单ID:', orderId);
    console.log('操作类型:', operation);
    console.log('附加参数:', JSON.stringify(params, null, 2));
    console.log('完整event:', JSON.stringify(event, null, 2));

    if (!operation) {
      console.error('操作类型不能为空');
      return {
        success: false,
        error: '操作类型不能为空'
      };
    }

    let order = null;
    if (operation !== 'createOrder') {
      if (!orderId) {
        console.error('订单ID不能为空');
        return {
          success: false,
          error: '订单ID不能为空'
        };
      }

      const orderRes = await db.collection('orders').doc(orderId).get();
      if (!orderRes.data) {
        console.error('订单不存在');
        return {
          success: false,
          error: '订单不存在'
        };
      }

      order = orderRes.data;
      console.log('当前订单状态:', order.status);
      console.log('配送方式:', order.deliveryType);
    }

    // 执行状态更新
    let updateResult;
    let notificationData = {};
    let notificationTargets = [];
    let adminOpenids = [];
    
    // 如果是发货操作，先不获取管理员openids，避免超时
    if (operation !== 'ship') {
      adminOpenids = await getAdminOpenids();
    }

    switch (operation) {
      case 'getOrderInfo':
        updateResult = { data: order };
        break;

      case 'createOrder':
        updateResult = await handleCreateOrderOperation(params);
        notificationData = {
          status: 'pending',
          orderNumber: updateResult.orderNumber,
          amount: updateResult.totalPrice || 0,
          productName: updateResult.productName || '商品',
          deliveryType: updateResult.deliveryType,
          countDown: updateResult.countDown || 30
        };
        notificationTargets = [updateResult.openid];
        break;

      case 'pay':
        updateResult = await handlePayOperation(order, params);
        notificationData = {
          status: 'paid',
          orderNumber: order.orderNumber,
          amount: order.totalAmount || order.totalPrice || 0,
          productName: order.products?.[0]?.productName || order.products?.[0]?.name || '商品',
          deliveryType: order.deliveryType
        };
        notificationTargets = [order._openid];
        break;

      case 'ship':
        // 发货操作：先执行核心更新，立即返回，后台处理物流和通知
        updateResult = await handleShipOperation(order, params);
        
        // 后台异步处理通知，不等待结果
        setImmediate(async () => {
          try {
            notificationData = {
              status: 'shipping',
              orderNumber: order.orderNumber,
              trackingNumber: params.trackingNumber,
              deliveryType: order.deliveryType
            };
            // 获取管理员openids
            const adminOpenidsShip = await getAdminOpenids();
            notificationTargets = Array.from(new Set([order._openid, ...adminOpenidsShip]));
            
            await cloud.callFunction({
              name: 'sendNotification',
              data: {
                notificationType: 'orderStatusChange',
                targetUsers: notificationTargets,
                data: notificationData,
                extras: {
                  orderId: orderId
                }
              }
            });
            console.log('发货通知发送成功');
          } catch (err) {
            console.error('发送发货通知失败:', err);
          }
        });
        break;

      case 'deliver':
        updateResult = await handleDeliverOperation(order, params);
        notificationData = {
          status: 'delivered',
          orderNumber: order.orderNumber,
          deliveryType: order.deliveryType
        };
        notificationTargets = Array.from(new Set([order._openid, ...adminOpenids]));
        break;

      case 'confirm':
        updateResult = await handleConfirmOperation(order, params);
        notificationData = {
          status: 'completed',
          orderNumber: order.orderNumber,
          productName: order.products?.[0]?.productName || order.products?.[0]?.name || '商品',
          deliveryType: order.deliveryType
        };
        notificationTargets = Array.from(new Set([order._openid, ...adminOpenids]));
        break;

      case 'cancel':
        updateResult = await handleCancelOperation(order, params);
        notificationData = {
          status: 'cancelled',
          orderNumber: order.orderNumber,
          cancelReason: params.cancelReason || '用户主动取消',
          deliveryType: order.deliveryType
        };
        notificationTargets = Array.from(new Set([order._openid, ...adminOpenids]));
        break;

      case 'applyAfterSales':
        updateResult = await handleApplyAfterSalesOperation(order, params);
        // 用户提交售后申请：通知用户（确认已提交）+ 通知管理员（有新申请待处理，通过needAdminNotification触发）
        notificationData = {
          status: 'refund',
          orderNumber: order.orderNumber,
          reason: params.reason || '',
          afterSalesType: params.afterSalesType || '退款',
          deliveryType: order.deliveryType
        };
        notificationTargets = [order._openid];
        break;

      case 'processAfterSales':
        updateResult = await handleProcessAfterSalesOperation(order, params);
        // 根据itemAction设置细化通知场景
        {
          const processItemAction = updateResult.itemAction || params?.itemAction || '';
          const processAfterSalesType = updateResult.afterSalesType || '';
          const processApprovedAmount = Number(updateResult.approvedAmount || 0) || 0;
          const processIsExchange = EXCHANGE_TYPES.includes(String(processAfterSalesType));
          const processReturnGoodsType = updateResult.returnGoodsType || '';
          const processIsAuto = String(params?.itemAction || '').includes('auto_');

          let processScenario = '';
          const processData = {
            orderNumber: order.orderNumber,
            deliveryType: order.deliveryType
          };

          if (processIsAuto) {
            // 系统自动操作 → 通知用户
            if (processItemAction === 'auto_confirm_receipt') {
              processScenario = 'after_sales_auto_confirm_receipt';
            } else if (processItemAction === 'auto_confirm_return_received') {
              processScenario = processReturnGoodsType === 'new'
                ? 'after_sales_auto_confirm_return_received_new'
                : 'after_sales_auto_confirm_return_received';
            } else if (processItemAction === 'auto_approve_refund' || processItemAction === 'auto_approve_exchange') {
              processScenario = 'after_sales_auto_approve';
            }
          } else if (processItemAction === 'approve') {
            // 管理员同意申请 → 通知用户
            processScenario = processIsExchange ? 'after_sales_approve_exchange' : 'after_sales_approve_refund';
          } else if (processItemAction === 'reject') {
            // 管理员拒绝 → 通知用户
            processScenario = 'after_sales_reject';
            processData.reason = params.result || '';
          } else if (processItemAction === 'confirm_receipt') {
            // 管理员确认收货 → 通知用户
            processScenario = 'after_sales_confirm_receipt';
          } else if (processItemAction === 'inspect_pass') {
            // 管理员验货通过 → 通知用户
            processScenario = processIsExchange ? 'after_sales_inspect_pass_exchange' : 'after_sales_inspect_pass_refund';
          } else if (processItemAction === 'inspect_fail') {
            // 管理员验货不通过 → 通知用户（换货/退货均为寄回原货，文案一致）
            processScenario = 'after_sales_inspect_fail';
          } else if (processItemAction === 'fill_return_tracking') {
            // 管理员填写寄回单号 → 通知用户；换货验货通过=发新货，其余=寄回原货
            processScenario = processReturnGoodsType === 'new'
              ? 'after_sales_fill_return_tracking_new'
              : 'after_sales_fill_return_tracking';
            processData.trackingNumber = params.trackingNumber || '';
          } else if (processItemAction === 'confirm_return_received') {
            // 用户确认收到商家寄回商品 → 通知用户（确认）+ 通知管理员
            processScenario = processReturnGoodsType === 'new'
              ? 'after_sales_confirm_return_received_new'
              : 'after_sales_confirm_return_received';
          } else if (processItemAction === 'complete') {
            // 完成售后 → 通知用户
            if (processApprovedAmount > 0) {
              processScenario = 'after_sales_complete_refund';
              processData.amount = processApprovedAmount;
            } else if (processIsExchange) {
              processScenario = 'after_sales_complete_exchange';
            }
          }

          if (processScenario) {
            notificationData = {
              status: processScenario,
              ...processData
            };
            notificationTargets = [order._openid];
          } else {
            // 未匹配到细化场景，不发送通知
            notificationData = {};
            notificationTargets = [];
          }
        }
        break;

      case 'cancelAfterSales':
        updateResult = await handleCancelAfterSalesOperation(order, params);
        notificationData = {
          status: 'after_sales_cancel',
          orderNumber: order.orderNumber,
          deliveryType: order.deliveryType
        };
        notificationTargets = [order._openid];
        break;

      case 'startIntercepting':
        updateResult = await handleStartInterceptingOperation(order, params);
        notificationData = {
          status: 'after_sales_intercepting',
          orderNumber: order.orderNumber,
          deliveryType: order.deliveryType
        };
        notificationTargets = [order._openid];
        break;

      case 'completeIntercepting':
        updateResult = await handleCompleteInterceptingOperation(order, params);
        if (params.finalAction === 'reject') {
          // 拦截失败 → 通知用户售后已取消
          notificationData = {
            status: 'after_sales_intercept_failed',
            orderNumber: order.orderNumber,
            result: params.result || '物流拦截失败',
            deliveryType: order.deliveryType
          };
        } else {
          // 拦截成功 → 通知用户正在退款中（还未到账）
          notificationData = {
            status: 'after_sales_intercept_success',
            orderNumber: order.orderNumber,
            result: '拦截成功，正在退款中',
            deliveryType: order.deliveryType
          };
        }
        notificationTargets = [order._openid];
        break;

      case 'approveRefusedDelivery':
        updateResult = await handleApproveRefusedDeliveryOperation(order, params);
        // 买家已拒签、物流确认退回后直接同意，通知用户整单进入退款
        notificationData = {
          status: 'after_sales_refused_delivery_approved',
          orderNumber: order.orderNumber,
          result: '物流确认已拒收退回',
          deliveryType: order.deliveryType
        };
        notificationTargets = [order._openid];
        break;

      case 'submitReturnTracking':
        updateResult = await handleSubmitReturnTrackingOperation(order, params);
        notificationData = {
          status: 'after_sales_submit_return_tracking',
          orderNumber: order.orderNumber,
          trackingNumber: params.trackingNumber || '',
          deliveryType: order.deliveryType
        };
        notificationTargets = [order._openid];
        break;

      case 'modifyReturnTracking':
        updateResult = await handleModifyReturnTrackingOperation(order, params);
        notificationData = {
          status: 'after_sales_modify_return_tracking',
          orderNumber: order.orderNumber,
          trackingNumber: params.trackingNumber || '',
          deliveryType: order.deliveryType
        };
        notificationTargets = [order._openid];
        break;

      default:
        console.error('未知的操作类型:', operation);
        return {
          success: false,
          error: '未知的操作类型'
        };
    }

    // 除了发货操作外，其他操作发送通知
    if (operation !== 'ship' && notificationTargets.length > 0) {
      // 后台异步处理通知，不等待结果（避免超时）
      setImmediate(async () => {
        try {
          const userOpenid = operation === 'createOrder' ? updateResult.openid : (order?._openid || '');
          
          await cloud.callFunction({
            name: 'sendNotification',
            data: {
              notificationType: 'orderStatusChange',
              targetUsers: notificationTargets,
              data: notificationData,
              extras: {
                orderId: orderId,
                openid: userOpenid
              }
            }
          });
          console.log('通知发送成功');
        } catch (notificationError) {
          console.error('发送通知失败:', notificationError);
          // 通知发送失败不影响订单状态更新
        }
      });
    }

    console.log('=== 订单状态更新完成 ===');
    
    // 异步记录订单操作日志，不影响主流程
    // 只记录订单级操作，售后详细操作只写入 after_sales_logs
    if (updateResult && updateResult.newStatus) {
      setImmediate(async () => {
        try {
          const fromStatus = order.status;
          const toStatus = updateResult.newStatus;
          const { OPENID } = cloud.getWXContext();
          
          let operatorType = params?.operatorType || 'user';
          if (!operatorType || operatorType === 'user') {
            operatorType = (await isAdmin(OPENID)) ? 'admin' : 'user';
          }
          if (operation === 'processAfterSales') {
            const itemAction = params?.itemAction;
            if (itemAction && itemAction.includes('auto_')) {
              operatorType = 'system';
            }
          }
          
          const operatorId = OPENID;
          const operatorName = operatorType === 'admin' 
            ? await getAdminNickName(OPENID) 
            : operatorType === 'system' ? '系统' : await getUserNickName(OPENID);
          
          let action = '';
          if (operation === 'processAfterSales') {
            const itemAction = params?.itemAction;
            let afterSalesType = 'refund';
            
            if (params?.caseId) {
              try {
                const caseRes = await db.collection('after_sales_cases').doc(params.caseId).get();
                if (caseRes.data && caseRes.data.primaryAfterSalesType) {
                  afterSalesType = EXCHANGE_TYPES.includes(String(caseRes.data.primaryAfterSalesType)) ? 'exchange' : 'refund';
                }
              } catch (e) {
                console.warn('获取售后案件类型失败:', e);
              }
            }
            
            if (itemAction === 'complete' || updateResult.caseStatus === 'completed') {
              const approvedAmount = Number(updateResult.approvedAmount || 0) || 0;
              if (approvedAmount > 0) {
                action = `complete_${afterSalesType}`;
              } else {
                action = 'complete_after_sales';
              }
            } else {
              console.log('售后详细操作不写入订单操作日志:', itemAction);
              return;
            }
          } else if (operation === 'completeIntercepting') {
            // 完成拦截 → 根据最终售后状态记录对应日志
            // 待退款是售后过程状态，只记 after_sales_logs；退款到账后由 schedule_refund_callback 写订单级 complete_refund 日志
            const finalCaseStatus = updateResult.caseStatus;
            if (finalCaseStatus === 'rejected' || finalCaseStatus === 'cancelled') {
              action = 'after_sales_rejected';
            } else if (finalCaseStatus === 'completed') {
              action = 'complete_after_sales';
            } else {
              console.log('完成拦截但售后状态无需记录订单日志:', finalCaseStatus);
              return;
            }
          } else if (operation === 'cancelAfterSales') {
            // 取消售后 → 记录订单操作日志
            action = 'cancel_after_sales';
          } else {
            const actionMap = {
              'pay': 'pay',
              'ship': 'ship',
              'deliver': 'deliver',
              'confirm': 'confirm_receipt',
              'cancel': 'cancel',
              'applyAfterSales': 'apply_after_sales'
            };
            // 其他售后详细操作不写入订单操作日志
            if (!actionMap[operation]) {
              console.log('售后相关操作不写入订单操作日志:', operation);
              return;
            }
            action = actionMap[operation];
          }
          
          // 售后完成类/取消类日志补充商品明细，便于多商品订单区分不同商品的售后记录
          if ((action.startsWith('complete_') || action === 'cancel_after_sales') && (!updateResult.items || updateResult.items.length === 0)) {
            const completeCaseId = params?.caseId || updateResult.caseId || '';
            if (completeCaseId) {
              try {
                const caseItemsRes = await db.collection('after_sales_case_items')
                  .where({ caseId: completeCaseId })
                  .limit(100)
                  .get();
                // after_sales_case_items 表的商品名/sku 存放在 Snapshot 后缀字段中
                updateResult.items = (caseItemsRes.data || []).map(item => ({
                  orderItemIndex: item.orderItemIndex,
                  productName: item.productName || item.productNameSnapshot || '',
                  skuName: item.skuName || item.skuNameSnapshot || '',
                  applyQty: item.applyQty || 0,
                  afterSalesType: item.afterSalesType || ''
                }));
              } catch (e) {
                console.warn('获取售后明细用于操作日志失败:', e);
              }
            }
          }

          // 为申请售后操作构建包含商品信息的 reason
          let logReason = params?.reason || params?.cancelReason || params?.result || '';
          // 申请售后的商品名和数量已通过 itemSummaries 单独展示，reason 只保留原因本身，避免重复
          if (operation === 'cancelAfterSales') {
            // 取消售后时，如果没有指定原因，使用默认文案
            logReason = logReason || '用户取消售后申请';
          }

          const detail = {
            ...params,
            // caseId 由后端在 handleApplyAfterSalesOperation 等处理函数中生成，
            // 前端传入的 params 不一定含 caseId，统一从 updateResult 取，保证日志可按 caseId 关联折叠
            caseId: updateResult.caseId || params?.caseId || '',
            jobId: updateResult.jobId || '',
            items: (updateResult.items || []).map(it => ({
              ...it,
              afterSalesTypeName: getAfterSalesTypeLabel(it.afterSalesType)
            }))
          };

          await logOrderOperation(db, {
            orderId: order._id,
            orderNumber: order.orderNumber,
            openid: order._openid,
            action,
            fromStatus,
            toStatus,
            operatorType,
            operatorId,
            operatorName,
            reason: logReason,
            remark: params?.remark || '',
            detail
          });
        } catch (logError) {
          console.error('记录订单操作日志失败:', logError);
        }
      });
    }
    
    return {
      success: true,
      message: '订单状态更新成功',
      data: {
        orderId: operation === 'createOrder' ? updateResult.orderId : orderId,
        newStatus: updateResult.newStatus,
        caseId: updateResult.caseId || '',
        updatedAt: updateResult.updatedAt
      }
    };
  } catch (error) {
    console.error('更新订单状态失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * 处理支付操作
 */
async function handlePayOperation(order, params) {
  if (order.status !== 'pending') {
    throw new Error('当前订单状态不允许支付');
  }

  const now = new Date();
  const updateData = {
    status: 'paid',
    payTime: now,
    updatedAt: now,
    updatedAtTs: now.getTime()
  };

  await db.collection('orders').doc(order._id).update({
    data: updateData
  });

  return {
    newStatus: 'paid',
    updatedAt: now
  };
}

/**
 * 处理发货操作
 */
async function handleShipOperation(order, params) {
  if (order.status !== 'paid') {
    throw new Error('当前订单状态不允许发货');
  }

  if (order.deliveryType === 'pickup') {
    throw new Error('上门自提订单不需要发货');
  }

  const now = new Date();
  let logisticsResult = null;
  
  if (params.trackingNumber) {
    try {
      logisticsResult = await prefetchLogisticsAfterShip(order, params);
    } catch (prefetchError) {
      console.error('发货前物流查询失败:', prefetchError);
    }
  }

  const isDelivered = logisticsResult && logisticsResult.success && String(logisticsResult.isCheck) === '1';

  await db.runTransaction(async (transaction) => {
    if (isDelivered) {
      const checkTime = normalizeCheckTimeValue(logisticsResult.arrivalTime);
      const logisticsStateUpdate = {
        state: logisticsResult.state || '',
        stateName: logisticsResult.stateName || '',
        isCheck: logisticsResult.isCheck || '',
        lastGetTime: now,
        checkTime: checkTime || ''
      };

      const deliveryUpdateData = {
        status: 'delivered',
        shippingTime: now,
        deliveredAt: now,
        logisticsInfo: params.trackingNumber ? {
          trackingNumber: params.trackingNumber,
          companyCode: params.companyCode || '',
          companyName: params.companyName || '',
          updatedAt: now
        } : undefined,
        logisticsState: logisticsStateUpdate,
        receiptConfirm: {
          type: 'pending',
          confirmedAt: null,
          confirmedBy: 'system',
          source: 'logistics_delivery'
        },
        fromAddress: params.fromAddress || undefined,
        updatedAt: now,
        updatedAtTs: now.getTime()
      };

      await transaction.collection('orders').doc(order._id).update({
        data: deliveryUpdateData
      });
    } else {
      const updateData = {
        status: 'shipping',
        shippingTime: now,
        updatedAt: now,
        updatedAtTs: now.getTime()
      };

      if (params.trackingNumber) {
        updateData.logisticsInfo = {
          trackingNumber: params.trackingNumber,
          companyCode: params.companyCode || '',
          companyName: params.companyName || '',
          updatedAt: now
        };
      }
      
      if (params.fromAddress) {
        updateData.fromAddress = params.fromAddress;
      }

      await transaction.collection('orders').doc(order._id).update({
        data: updateData
      });
    }
  });

  if (params.trackingNumber && logisticsResult && logisticsResult.success && !isDelivered) {
    try {
      const logisticsStateUpdate = {
        state: logisticsResult.state || '',
        stateName: logisticsResult.stateName || '',
        isCheck: logisticsResult.isCheck || '',
        lastGetTime: now
      };
      
      await db.collection('orders').doc(order._id).update({
        data: {
          logisticsState: logisticsStateUpdate,
          updatedAt: now,
          updatedAtTs: now.getTime()
        }
      });
    } catch (error) {
      console.error('保存物流状态失败(不影响发货结果):', error);
    }
  }

  console.log('=== 发货完成（事务已提交）===');

  return {
    newStatus: isDelivered ? 'delivered' : 'shipping',
    updatedAt: now
  };
}

async function prefetchLogisticsAfterShip(order, params) {
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

  const fromAddress = (params.fromAddress || order.fromAddress || order.pickupAddress || '').trim();

  const result = await cloud.callFunction({
    name: 'express100',
    data: {
      action: 'queryLogistics',
      expressNo: params.trackingNumber,
      companyCode: params.companyCode,
      fromAddress,
      toAddress,
      forceRefresh: true
    }
  });

  return result.result || result;
}

/**
 * 处理送达操作
 */
async function handleDeliverOperation(order, params) {
  if (order.status !== 'shipping') {
    throw new Error('当前订单状态不允许标记送达');
  }

  if (order.deliveryType !== 'express' && order.deliveryType !== 'local') {
    throw new Error('当前配送方式不支持标记送达');
  }

  const now = new Date();
  const updateData = {
    status: 'delivered',
    deliveryTime: now,
    updatedAt: now,
    updatedAtTs: now.getTime()
  };

  await db.collection('orders').doc(order._id).update({
    data: updateData
  });

  return {
    newStatus: 'delivered',
    updatedAt: now
  };
}

/**
 * 处理确认收货操作
 */
async function handleConfirmOperation(order, params) {
  console.log('=== handleConfirmOperation 开始 ===');
  console.log('订单ID:', order._id);
  console.log('当前订单状态:', order.status);
  console.log('配送方式:', order.deliveryType);
  console.log('参数:', JSON.stringify(params));
  
  let allowedStatuses = [];
  
  switch (order.deliveryType) {
    case 'express':
    case 'local':
      allowedStatuses = ['shipping', 'delivered'];
      break;
    case 'pickup':
      allowedStatuses = ['paid'];
      break;
    default:
      console.error('未知的配送方式:', order.deliveryType);
      throw new Error('未知的配送方式');
  }

  console.log('允许的状态:', allowedStatuses);
  
  if (!allowedStatuses.includes(order.status)) {
    console.error('当前订单状态不允许确认收货，订单状态:', order.status, '允许的状态:', allowedStatuses);
    throw new Error(`当前订单状态(${order.status})不允许确认收货，允许的状态: ${allowedStatuses.join(', ')}`);
  }
  
  console.log('状态校验通过，准备更新订单状态为 completed');

  const now = new Date();
  const confirmType = params?.confirmType === 'auto' ? 'auto' : 'manual';
  const receiptConfirm = {
    type: confirmType,
    confirmedAt: now,
    confirmedBy: params?.confirmedBy || (confirmType === 'auto' ? 'system' : (params?.operatorOpenid || order._openid || 'unknown')),
    source: params?.source || (confirmType === 'auto' ? 'timer_job' : 'user_action')
  };

  if (params?.jobId) {
    receiptConfirm.jobId = params.jobId;
  }

  const updateData = {
    status: 'completed',
    receiptTime: now,
    receiptConfirm,
    updatedAt: now,
    updatedAtTs: now.getTime()
  };

  await db.collection('orders').doc(order._id).update({
    data: updateData
  });

  return {
    newStatus: 'completed',
    updatedAt: now
  };
}

/**
 * 处理创建订单操作（事务）
 */
async function handleCreateOrderOperation(params) {
  const { orderData, countDown } = params;
  
  if (!orderData || !orderData.products || orderData.products.length === 0) {
    throw new Error('订单数据或商品信息为空');
  }
  
  console.log('=== 创建订单开始（事务处理）===');
  console.log('商品数量:', orderData.products.length);
  
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  console.log('当前用户openid:', openid);
  
  orderData._openid = openid;
  
  const transactionRes = await db.runTransaction(async (transaction) => {
    const stockUpdates = [];
    
    for (const product of orderData.products) {
      if (!product.productId) {
        throw new Error('商品ID为空');
      }
      if (!product.quantity) {
        throw new Error('商品数量为空');
      }
      
      const productRes = await transaction.collection('products').doc(product.productId).get();
      if (!productRes.data) {
        throw new Error(`商品不存在: ${product.productId}`);
      }
      
      const currentStock = productRes.data.stock || 0;
      if (currentStock < product.quantity) {
        throw new Error(`商品库存不足: ${product.productId}, 当前库存: ${currentStock}, 需要: ${product.quantity}`);
      }
      
      const newStock = currentStock - product.quantity;
      stockUpdates.push({
        productId: product.productId,
        newStock
      });
      
      await transaction.collection('products').doc(product.productId).update({
        data: {
          stock: newStock,
          updatedAt: new Date(),
          updatedAtTs: Date.now()
        }
      });
      
      console.log('扣减库存成功，商品ID:', product.productId, '当前库存:', currentStock, '新库存:', newStock);
    }
    
    const orderRes = await transaction.collection('orders').add({
      data: orderData
    });
    
    console.log('订单创建成功，订单ID:', orderRes._id);
    
    return {
      orderId: orderRes._id,
      stockUpdates
    };
  });
  
  console.log('=== 创建订单完成（事务已提交）===');
  
  return {
    orderId: transactionRes.orderId,
    newStatus: orderData.status || 'pending',
    updatedAt: new Date(),
    orderNumber: orderData.orderNumber,
    totalPrice: orderData.totalPrice || 0,
    deliveryType: orderData.deliveryType,
    productName: orderData.products?.[0]?.productName || '商品',
    openid: orderData._openid || orderData.userId || '',
    countDown: countDown || 30
  };
}

/**
 * 处理取消订单操作
 */
async function handleCancelOperation(order, params) {
  if (order.status === 'completed' || order.status === 'cancelled' || order.status === 'shipping' || order.status === 'delivered') {
    throw new Error('当前订单状态不允许取消，请通过售后流程处理');
  }

  const now = new Date();

  await db.runTransaction(async (transaction) => {
    if (order.products && ['pending', 'paid'].includes(order.status)) {
      for (const product of order.products) {
        const productRes = await transaction.collection('products').doc(product.productId).get();
        if (productRes.data) {
          const currentStock = productRes.data.stock || 0;
          const newStock = currentStock + product.quantity;
          await transaction.collection('products').doc(product.productId).update({
            data: {
              stock: newStock,
              updatedAt: now,
              updatedAtTs: now.getTime()
            }
          });
        }
      }
    }

    const updateData = {
      status: 'cancelled',
      cancelTime: now,
      cancelReason: params.cancelReason || '用户主动取消',
      updatedAt: now,
      updatedAtTs: now.getTime()
    };

    await transaction.collection('orders').doc(order._id).update({
      data: updateData
    });
  });

  console.log('=== 取消订单完成（事务已提交）===');

  // 已支付订单发货前取消：原路全额退款（商品金额 + 运费，订单未发货配送服务未发生）
  // 待支付订单无实付金额，不触发退款
  if (order.status === 'paid') {
    const cancelRefundAmount = roundAmount(
      Number(order.totalPrice ?? order.totalAmount ?? 0) || 0
    );
    if (cancelRefundAmount > 0) {
      console.log('=== 发货前取消，创建全额退款记录 ===', cancelRefundAmount);
      try {
        const refundRes = await cloud.callFunction({
          name: 'refund',
          data: {
            action: 'create',
            orderId: order._id,
            amount: cancelRefundAmount,
            outTradeNo: order.outTradeNo || order.tradeNo || '',
            reason: params.cancelReason
              ? `发货前取消订单（${params.cancelReason}），全额退款（含运费）`
              : '发货前取消订单，全额退款（含运费）'
          }
        });
        if (!refundRes.result?.success) {
          console.error('取消订单退款记录创建失败:', refundRes.result?.error || '未知错误');
        }
      } catch (refundErr) {
        // 退款创建失败不回滚取消状态（订单已取消），由管理员根据日志人工处理，避免钱货两空状态不明
        console.error('取消订单调用退款云函数异常:', refundErr);
      }
    }
  }

  return {
    newStatus: 'cancelled',
    updatedAt: now
  };
}

/**
 * 处理申请售后操作
 */
async function handleApplyAfterSalesOperation(order, params) {
  // 允许的订单状态：已完成、退款完成、售后中、已签收、配送中
  // refund_completed 也允许申请：订单部分商品退款完成后，剩余商品仍可申请售后
  const allowedStatuses = ['completed', 'refund_completed', 'refund', 'delivered', 'shipping'];
  if (!allowedStatuses.includes(order.status)) {
    throw new Error('当前订单状态无法申请售后');
  }

  // 不再限制同一订单只能有一个售后申请，允许多个商品分别申请售后
  // 检查申请的商品是否已经有进行中的售后
  const requestedItems = Array.isArray(params?.items) ? params.items : [];
  if (requestedItems.length === 0) {
    throw new Error('请至少选择一个商品进行售后');
  }

  const orderItems = normalizeOrderProducts(order);
  if (orderItems.length === 0) {
    throw new Error('订单商品信息不存在，无法申请售后');
  }

  const orderItemMap = new Map(orderItems.map((item) => [item.orderItemId, item]));
  
  // 并行执行多个查询，提高性能
  const [reservedInfo, config] = await Promise.all([
    getAfterSalesReservedInfo(order._id, orderItems),
    getServiceTimeConfig()
  ]);
  const reservedQtyMap = reservedInfo.qtyMap;
  const releasedExchangeMap = reservedInfo.releasedExchangeMap;
  const partialRefundMap = reservedInfo.partialRefundMap;
  const committedAmountMap = reservedInfo.committedAmountMap;
  const remainAmountMap = reservedInfo.remainAmountMap;
  const forfeitedAmountMap = reservedInfo.forfeitedAmountMap || {};

  // 判断是否已确认收货（交易成功）
  // 用 receiptTime（确认收货时间）判断而非订单状态：
  // 申请售后会把 delivered 变成 refund，但不代表用户确认了收货
  const isTransactionCompleted = !!order.receiptTime || ['completed', 'refund_completed'].includes(order.status);

  // 原始订单商品（未换货件）的售后期基准时间
  let originalBaseTime;
  if (isTransactionCompleted) {
    // 交易成功后：以签收时间为准（签收后7天/15天）；
    // 签收时间缺失或早于发货时间（物流返回的脏数据）时回退确认收货时间
    const checkTime = parseFlexibleDate(order?.logisticsState?.checkTime);
    const shippingTime = parseFlexibleDate(order?.shippingTime);
    originalBaseTime = (checkTime && (!shippingTime || checkTime >= shippingTime))
      ? checkTime
      : parseFlexibleDate(order?.receiptTime);
  } else {
    // 交易成功前：使用发货时间（发货后10天）
    originalBaseTime = parseFlexibleDate(order?.shippingTime);
  }

  // 售后期截止时间计算：从基准日次日0点起算，与前端保持一致
  const calcAfterSalesDeadline = (baseDate, days) => {
    const startDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + 1, 0, 0, 0);
    return startDate.getTime() + days * 24 * 60 * 60 * 1000;
  };
  // allowDays=-1 无时间限制；缺少基准时间时保持旧行为不拦截
  const isWithinAfterSalesDeadline = (baseDate, days) => {
    if (days < 0) {
      return true;
    }
    if (!baseDate) {
      return true;
    }
    return Date.now() <= calcAfterSalesDeadline(baseDate, days);
  };

  const now = new Date();
  console.log('售后时效校验:', {
    checkTime: order?.logisticsState?.checkTime,
    receiptTime: order?.receiptTime,
    shippingTime: order?.shippingTime,
    originalBaseTime: originalBaseTime?.toISOString(),
    now: now.toISOString()
  });
  const proofImages = Array.isArray(params?.proofImages) ? params.proofImages : [];
  const proofVideos = Array.isArray(params?.proofVideos) ? params.proofVideos : [];
  const normalizedItems = requestedItems.map((selectedItem, index) => {
    const orderItemId = String(selectedItem.orderItemId || '').trim();
    const matchedOrderItem = orderItemMap.get(orderItemId);
    if (!matchedOrderItem) {
      throw new Error(`商品项不存在：${orderItemId || index + 1}`);
    }

    // 数量校验：reservedQty 已包含进行中/已完成的占用（cancelled/rejected 不算），
    // 同一商品部分件数在售后中时，剩余件数仍可申请
    const applyQty = Number(selectedItem.applyQty || 0);
    if (!applyQty || applyQty < 1) {
      throw new Error(`商品 ${matchedOrderItem.productName} 的售后数量不合法`);
    }

    const reservedQty = Number(reservedQtyMap[orderItemId] || 0);
    const availableQty = matchedOrderItem.buyQty - reservedQty;
    if (applyQty > availableQty) {
      // 已全部占用时给更友好的提示
      const errMsg = availableQty <= 0
        ? `商品 ${matchedOrderItem.productName} 已有进行中的售后申请`
        : `商品 ${matchedOrderItem.productName} 最多还可申请 ${availableQty} 件售后`;
      throw new Error(errMsg);
    }

    const afterSalesType = normalizeAfterSalesType(selectedItem.afterSalesType || params?.afterSalesType);
    if (!isAllowedAfterSalesType(afterSalesType)) {
      throw new Error(`商品 ${matchedOrderItem.productName} 的售后类型已下线，请选择其他类型`);
    }

    const reasonCode = params?.reasonCode || '';
    const reasonText = params?.reason || '';

    if (afterSalesType === 'refund' && !config.supportNoReasonReturnRefund) {
      throw new Error(`商品 ${matchedOrderItem.productName} 当前不支持7天无理由退货退款`);
    }

    if (afterSalesType === 'exchange' && !config.supportQualityExchange) {
      throw new Error(`商品 ${matchedOrderItem.productName} 当前不支持换货`);
    }

    const allowDays = getAllowDaysForAfterSalesType(afterSalesType, config, isTransactionCompleted, reasonCode);

    // 售后期分两个件池校验：
    // 1) 原始件池：从未换货/未售后占用的件，按订单签收/发货时间起算
    // 2) 新货池：第1代换货已完成（买家已收新货）释放出的件，按确认收新货时间重新起算（7天/15天）
    const releasedEntries = Array.isArray(releasedExchangeMap[orderItemId]) ? releasedExchangeMap[orderItemId] : [];
    const releasedTotalQty = releasedEntries.reduce((sum, entry) => sum + (Number(entry.applyQty) || 0), 0);
    const untouchedQty = Math.max(0, matchedOrderItem.buyQty - reservedQty - releasedTotalQty);
    const untouchedEligibleQty = isWithinAfterSalesDeadline(originalBaseTime, allowDays) ? untouchedQty : 0;

    let releasedEligibleQty = 0;
    let latestReleasedEntry = null;
    releasedEntries.forEach((entry) => {
      const entryBaseTime = parseFlexibleDate(entry.completedAt);
      // 新货视为交易完成后收到：普通原因7天、质量原因15天（未收到货退款仍无限制）
      const entryAllowDays = getAllowDaysForAfterSalesType(afterSalesType, config, true, reasonCode);
      if (isWithinAfterSalesDeadline(entryBaseTime, entryAllowDays)) {
        releasedEligibleQty += Number(entry.applyQty) || 0;
        if (!latestReleasedEntry
          || entry.generation > latestReleasedEntry.generation
          || (entry.generation === latestReleasedEntry.generation
            && new Date(entry.completedAt || 0).getTime() > new Date(latestReleasedEntry.completedAt || 0).getTime())) {
          latestReleasedEntry = entry;
        }
      }
    });

    console.log('=== 售后时效判断日志 ===');
    console.log('订单ID:', order._id);
    console.log('订单状态:', order.status);
    console.log('交易是否完成:', isTransactionCompleted);
    console.log('售后类型:', afterSalesType);
    console.log('允许天数(原始件/新货):', allowDays);
    console.log('申请件数:', applyQty, '原始件池:', untouchedQty, '其中有效期内:', untouchedEligibleQty,
      '新货池:', releasedTotalQty, '其中有效期内:', releasedEligibleQty);

    if (applyQty > untouchedEligibleQty + releasedEligibleQty) {
      throw new Error(`商品 ${matchedOrderItem.productName} 已超过售后时效，无法申请该售后类型`);
    }

    // 优先消耗原始件池；超出部分（即消耗到新货池）标记为二次售后：
    // 代数+1、关联原换货案件，用于防无限换货与售后链路追溯
    let afterSalesGeneration = 1;
    let relatedCaseId = '';
    let relatedItemId = '';
    const consumedFromReleasedQty = Math.max(0, applyQty - untouchedEligibleQty);
    if (consumedFromReleasedQty > 0 && latestReleasedEntry) {
      afterSalesGeneration = latestReleasedEntry.generation + 1;
      relatedCaseId = latestReleasedEntry.caseId || '';
      relatedItemId = latestReleasedEntry.itemId || '';
      console.log('二次售后（换货新货）:', {
        relatedCaseId,
        relatedItemId,
        generation: afterSalesGeneration,
        newGoodsBaseTime: latestReleasedEntry.completedAt
      });
    }

    // 换货不发生商品退款，申请金额固定为 0（寄回运费补偿等独立计算挂在单独字段）；
    // 退款类按前端传值或单价×数量计算
    let applyRefundAmount = roundAmount(selectedItem.applyRefundAmount ?? calculateItemRefundAmount(matchedOrderItem, applyQty));
    if (EXCHANGE_TYPES.includes(afterSalesType)) {
      applyRefundAmount = 0;
    }

    return {
      ...matchedOrderItem,
      // 确保使用从参数传过来的正确索引
      index: Number(selectedItem.orderItemIndex) || index,
      applyQty,
      afterSalesType,
      applyRefundAmount,
      reasonCode,
      reasonText,
      itemStatus: 'submitted',
      needReturnGoods: !isRefundOnlyType(afterSalesType),
      needBuyerShip: !isRefundOnlyType(afterSalesType),
      shippingResponsibility: getShippingResponsibilityByReason(reasonCode, afterSalesType),
      evidenceRequired: requiresEvidence(afterSalesType, config),
      allowDays,
      // 二次售后（换货收到的新货再次售后）：代数与原换货案件关联
      afterSalesGeneration,
      relatedCaseId,
      relatedItemId,
      // 补差代数判定需要：本次是否消耗了新货池件
      consumedFromReleasedQty
    };
  });

  // 发货运费由系统按"售后类型+责任+是否整单"自动判定（前端不可传值，杜绝篡改），整单只退一次；
  // 金额挂在本次申请的第一条明细上随退款链路执行。
  // 注意：包邮差额（原运费）永不倒扣，applyShippingDeductionAmount 新申请恒为 0；下方内扣分支仅为兼容历史在途明细保留
  const shippingResolve = resolveApplyShippingRefund(
    order, orderItems, normalizedItems, reservedInfo.validItems || [], config
  );
  const applyShippingRefundAmount = Number(shippingResolve.refundAmount || 0) || 0;
  const applyShippingDeductionAmount = Number(shippingResolve.deductionAmount || 0) || 0;
  if (applyShippingRefundAmount > 0) {
    normalizedItems[0].applyShippingRefundAmount = applyShippingRefundAmount;
  }
  if (applyShippingDeductionAmount > 0) {
    // 历史口径保留：新政策下新申请不会再进入此分支（resolveApplyShippingRefund 恒返回扣减 0）
    normalizedItems[0].applyShippingDeductionAmount = applyShippingDeductionAmount;
    normalizedItems[0].shippingDeductionNetted = true;
  }
  console.log('=== 运费退款判定 ===', JSON.stringify({
    orderShippingFee: getOrderShippingFee(order, orderItems),
    orderOriginalShippingFee: getOrderOriginalShippingFee(order, orderItems),
    committedShipping: reservedInfo.committedShippingAmount || 0,
    committedShippingDeduction: reservedInfo.committedShippingDeductionAmount || 0,
    applyShippingRefundAmount,
    applyShippingDeductionAmount,
    shippingDeductionNetted: applyShippingDeductionAmount > 0
  }));

  // 寄回运费补偿（逆向快递费）：卖家责任且需买家寄回的退货退款/换货。
  // 优先按本单寄出规则运费补偿（包邮单也取规则运费），订单无运费时回退配置固定额；
  // 与发货运费相互独立，不影响商品退款"最多可退"与整单覆盖判定，仅在实际打款时作为加项
  const returnCompensationResolve = resolveApplyReturnShippingCompensation(normalizedItems, order, orderItems, config, reservedInfo.validItems || []);
  const applyReturnShippingCompensationAmount = returnCompensationResolve.amount;
  if (applyReturnShippingCompensationAmount > 0 && returnCompensationResolve.carrierIndex >= 0) {
    normalizedItems[returnCompensationResolve.carrierIndex].applyReturnShippingCompensationAmount =
      applyReturnShippingCompensationAmount;
  }
  console.log('=== 寄回运费补偿判定 ===', JSON.stringify({
    orderOriginalShippingFee: getOrderOriginalShippingFee(order, orderItems),
    configFallbackAmount: Number(config?.returnShippingCompensationAmount) || 0,
    applyReturnShippingCompensationAmount,
    carrierIndex: returnCompensationResolve.carrierIndex
  }));

  // 退款类售后的金额口径校验（须在运费判定之后）：
  // 该商品行累计已承诺退款（含在途）+ 本次申请 ≤ 商品行可退总额；
  // 退货退款少退的差额（货已寄回）视为放弃，不可再申请；
  // 仅退款支持部分金额退款后就差额再次申请（补差），杜绝超退。
  // 说明：shippingDeduction 新政策下恒为 0（包邮差额不倒扣），净额封顶保留仅兼容历史在途明细
  normalizedItems.forEach((item, idx) => {
    if (!REFUND_TYPES.includes(item.afterSalesType)) {
      return;
    }
    const orderItemId = String(item.orderItemId || '');
    const lineTotal = Number(item.lineAmount) > 0
      ? roundAmount(item.lineAmount)
      : roundAmount(Number(item.unitPrice || 0) * Number(item.buyQty || 0));
    const committed = Number(committedAmountMap[orderItemId] || 0);
    const forfeited = Number(forfeitedAmountMap[orderItemId] || 0);
    const remain = roundAmount(Math.max(0, lineTotal - committed - forfeited));
    // 仅第一条明细承载运费扣减（与上方挂载口径一致）
    const shippingDeduction = idx === 0 ? applyShippingDeductionAmount : 0;
    const netCap = roundAmount(Math.max(0, remain - shippingDeduction));
    if (!(Number(item.applyRefundAmount) > 0)) {
      throw new Error(`商品 ${item.productName} 的退款金额需大于0`);
    }
    if (Number(item.applyRefundAmount) > netCap + REFUND_AMOUNT_TOLERANCE) {
      // shippingDeduction 新政策恒为 0（包邮差额不倒扣）；历史在途明细异常超退时仍给出净额提示
      const suffix = shippingDeduction > 0
        ? `（含历史在途售后需承担的原运费 ¥${shippingDeduction}）`
        : '';
      throw new Error(`商品 ${item.productName} 本次最多可退 ¥${netCap}${suffix}，退款金额不能超过该金额`);
    }

    // 未消耗新货池、但该商品行存在"已完成且金额未退满"的退款明细时，
    // 本次申请属于补差链路：代数在最近一次部分退款基础上+1并关联原案件（售后期不重启）
    if (Number(item.consumedFromReleasedQty || 0) <= 0) {
      const partialEntries = Array.isArray(partialRefundMap[orderItemId]) ? partialRefundMap[orderItemId] : [];
      const latestPartialEntry = partialEntries[0] || null;
      if (latestPartialEntry) {
        item.afterSalesGeneration = latestPartialEntry.generation + 1;
        item.relatedCaseId = latestPartialEntry.caseId || '';
        item.relatedItemId = latestPartialEntry.itemId || '';
        console.log('二次售后（部分退款补差）:', {
          relatedCaseId: item.relatedCaseId,
          relatedItemId: item.relatedItemId,
          generation: item.afterSalesGeneration,
          remain,
          netCap
        });
      }
    }
  });

  // 本次申请关联的原换货案件ID（二次售后链路追溯）
  const relatedCaseIds = Array.from(new Set(normalizedItems
    .map((item) => item.relatedCaseId)
    .filter(Boolean)));

  const totalApplyQty = normalizedItems.reduce((sum, item) => sum + item.applyQty, 0);
  const totalApplyAmount = roundAmount(normalizedItems.reduce((sum, item) => sum + item.applyRefundAmount, 0));
  const uniqueTypes = Array.from(new Set(normalizedItems.map((item) => item.afterSalesType)));
  const caseNo = generateAfterSalesCaseNo();

  const proofVideoThumbs = Array.isArray(params?.proofVideoThumbs) ? params.proofVideoThumbs : [];
    
    const caseDoc = {
      caseNo,
      orderId: order._id,
      orderNumber: order.orderNumber || order.orderNo || order._id,
      userId: order.userId || '',
      userOpenid: order._openid || '',
      caseStatus: 'submitted',
      source: params?.source || 'user',
      applyReasonCode: params?.reasonCode || '',
      applyReasonText: params?.reason || '',
      applyDescription: params?.description || '',
      proofImages,
      proofVideos,
      proofVideoThumbs,
      contactName: params?.contactName || order?.address?.name || '',
      contactPhone: params?.contactPhone || order?.address?.phone || '',
      contactAddress: params?.contactAddress || '',
      totalApplyQty,
      totalApplyAmount,
      // 本次申请系统判定的应退运费（独立于商品金额，仅一条明细承载）
      applyShippingRefundAmount,
      // 本次申请系统判定的应扣运费（买家责任整单退包邮差额，仅一条明细承载）
      applyShippingDeductionAmount,
      // 运费扣减是否已内扣在商品退款额中（新口径净额封顶，退款时不再二次扣减）
      shippingDeductionNetted: applyShippingDeductionAmount > 0,
      // 本次申请建议的寄回运费补偿（卖家责任退货/换货，商家审核时可调整）
      applyReturnShippingCompensationAmount,
      // 已核准寄回运费补偿：未审核时为 null（详情页据此回退显示申请建议额"预计补偿"）；
      // 审核通过后写入核准值（商家调整为 0 也落 0），不能用 0 作为初始值，否则待处理阶段补偿行被误判为已核准0而隐藏
      approvedReturnShippingCompensationAmount: null,
      itemCount: normalizedItems.length,
      // 二次售后时关联的原换货案件ID列表
      relatedCaseIds,
      hasMixedType: uniqueTypes.length > 1,
      primaryAfterSalesType: uniqueTypes.length === 1 ? uniqueTypes[0] : 'mixed',
      policySnapshot: order.policySnapshot || config,
      refundSummary: {
        requestedAmount: totalApplyAmount,
        approvedAmount: 0,
        refundedAmount: 0
      },
      processSummary: {
        result: '',
        processTime: null,
        operatorType: ''
      },
      shippingResponsibilitySummary: uniqueTypes.length === 1
        ? getShippingResponsibilityByReason(normalizedItems[0]?.reasonCode || '', uniqueTypes[0])
        : 'mixed',
      createdAt: now,
      updatedAt: now
    };

  // 使用事务确保数据一致性
  const transactionRes = await db.runTransaction(async (transaction) => {
    // 步骤1：插入售后案件
    const caseRes = await transaction.collection('after_sales_cases').add({
      data: caseDoc
    });
    const caseId = caseRes._id;

    // 步骤2：插入售后案件明细
    await Promise.all(normalizedItems.map((item) => transaction.collection('after_sales_case_items').add({
      data: {
        caseId,
        caseNo,
        orderId: order._id,
        orderNumber: order.orderNumber || order.orderNo || order._id,
        orderItemId: item.orderItemId,
        orderItemIndex: item.index,
        skuId: item.skuId,
        productId: item.productId,
        productNameSnapshot: item.productName,
        skuNameSnapshot: item.skuName,
        coverImageSnapshot: item.coverImage,
        buyQty: item.buyQty,
        applyQty: item.applyQty,
        approvedQty: 0,
        rejectedQty: 0,
        unitPriceSnapshot: item.unitPrice,
        payableAmountSnapshot: item.lineAmount,
        maxRefundAmount: calculateItemRefundAmount(item, item.buyQty),
        applyRefundAmount: item.applyRefundAmount,
        approvedRefundAmount: 0,
        // 运费退款（仅承载运费的那条明细非0）：申请额系统判定，核准额随审核写入
        applyShippingRefundAmount: Number(item.applyShippingRefundAmount || 0) || 0,
        approvedShippingRefundAmount: 0,
        // 运费扣减（买家责任整单退的包邮差额同上，仅一条明细承载）
        applyShippingDeductionAmount: Number(item.applyShippingDeductionAmount || 0) || 0,
        approvedShippingDeductionAmount: 0,
        // 标记扣减已内扣在商品退款额中（退款执行与汇总时不再二次扣减；无标记为历史明细走旧口径）
        shippingDeductionNetted: !!item.shippingDeductionNetted,
        // 寄回运费补偿（卖家责任退货/换货的逆向快递费，仅一条承载明细非0）
        applyReturnShippingCompensationAmount: Number(item.applyReturnShippingCompensationAmount || 0) || 0,
        approvedReturnShippingCompensationAmount: 0,
        afterSalesType: item.afterSalesType,
        shippingResponsibility: item.shippingResponsibility,
        reasonCode: item.reasonCode || '',
        reasonText: item.reasonText || params?.reason || '',
        itemStatus: item.itemStatus,
        needReturnGoods: item.needReturnGoods,
        needBuyerShip: item.needBuyerShip,
        evidenceRequired: item.evidenceRequired,
        allowDaysSnapshot: item.allowDays,
        // 二次售后（换货新货再次售后）：售后代数（1=原始商品，2=换货新货）及原换货案件关联
        afterSalesGeneration: item.afterSalesGeneration || 1,
        relatedCaseId: item.relatedCaseId || '',
        relatedItemId: item.relatedItemId || '',
        buyerReturnTracking: null,
        sellerReshipTracking: null,
        inspectionResult: '',
        processNote: '',
        createdAt: now,
        updatedAt: now
      }
    })));

    // 步骤3：创建售后日志
    await transaction.collection('after_sales_logs').add({
      data: {
        caseId,
        orderId: order._id,
        operatorId: order._openid || order.userId || '',
        operatorType: params?.source === 'admin' ? 'admin' : 'user',
        action: 'create_case',
        beforeStatus: '',
        afterStatus: 'submitted',
        note: params?.reason || '用户提交售后申请',
        extra: {
          itemCount: normalizedItems.length,
          totalApplyQty,
          totalApplyAmount,
          relatedCaseIds
        },
        createdAt: now
      }
    });

    // 步骤4：更新订单状态
    // 申请售后时：状态变为 refund，afterSalesStatus 置为 pending（有进行中的申请），
    // afterSalesResult 跨订单全部售后明细重新聚合，确保已完成的退款（如"部分退款"）不被丢失，
    // 而不是仅依赖不覆盖该字段（历史脏数据可能导致文案缺失）。
    const allOrderItemsForApplyRes = await transaction.collection('after_sales_case_items').where({
      orderId: order._id
    }).limit(100).get();
    const allOrderItemsForApply = allOrderItemsForApplyRes.data || [];
    const applyResultText = buildAfterSalesResult(allOrderItemsForApply, order.products);

    const updateData = {
      status: 'refund',
      afterSalesStatus: 'pending',
      afterSalesResult: applyResultText || '',
      originalStatusBeforeRefund: order.status !== 'refund' ? order.status : (order.originalStatusBeforeRefund || ''),
      updatedAt: now,
      updatedAtTs: now.getTime()
    };
    await transaction.collection('orders').doc(order._id).update({
      data: updateData
    });

    return { caseId };
  });

  const caseId = transactionRes.caseId;

  console.log('=== 售后申请创建成功（事务已提交）===');
  console.log('caseId:', caseId);
  console.log('newStatus: refund');

  // 构建商品信息摘要，用于日志记录
  const itemSummaries = normalizedItems.map(item => ({
    orderItemIndex: item.index,
    productName: item.productName,
    skuName: item.skuName || '',
    applyQty: item.applyQty,
    applyRefundAmount: item.applyRefundAmount,
    afterSalesType: item.afterSalesType || ''
  }));
  
  return {
    newStatus: 'refund',
    caseId,
    updatedAt: now,
    items: itemSummaries,
    totalApplyQty,
    totalApplyAmount
  };
}

// 寄回运费补偿退款记录的原因标记（用于换货补偿打款的幂等查重）
const RETURN_COMPENSATION_REASON_TAG = '寄回运费补偿';

// 创建售后退款记录（商品退款/发货运费/寄回运费补偿合并原路退回；refund 云函数落 refund_records 由定时任务打款）
async function createAfterSalesRefundRecord({ order, caseId, amount, reason }) {
  const refundAmount = roundAmount(amount);
  if (!(refundAmount > 0)) {
    return false;
  }
  try {
    const refundRes = await cloud.callFunction({
      name: 'refund',
      data: {
        action: 'create',
        orderId: order._id,
        caseId,
        amount: refundAmount,
        outTradeNo: order.outTradeNo || order.tradeNo || '',
        reason: reason || '售后退款'
      }
    });
    console.log('待退款记录创建结果:', JSON.stringify(refundRes));
    if (!refundRes.result?.success) {
      console.error('待退款记录创建失败:', refundRes.result?.error || '未知错误');
      return false;
    }
    return true;
  } catch (refundErr) {
    console.error('调用退款云函数异常:', refundErr);
    return false;
  }
}

/**
 * 处理售后处理操作
 */
async function handleProcessAfterSalesOperation(order, params) {
  console.log('=== 开始处理售后 ===');
  console.log('订单ID:', order._id);
  console.log('处理参数:', params);
  
  const activeCase = await getActiveAfterSalesCaseByOrder(order, params);
  if (!activeCase) {
    console.error('未找到有效的售后单');
    throw new Error('当前订单没有售后申请或售后申请已经处理完成');
  }
  console.log('找到售后单:', activeCase._id, '状态:', activeCase.caseStatus);

  const itemId = String(params?.itemId || '').trim();
  const itemAction = String(params?.itemAction || '').trim();
  console.log('处理的明细ID:', itemId, '处理动作:', itemAction);

  if (itemId && itemAction) {
    const caseItemRes = await db.collection('after_sales_case_items').doc(itemId).get();
    const caseItem = caseItemRes.data;
    console.log('售后明细数据:', caseItem);
    
    if (!caseItem || caseItem.caseId !== activeCase._id) {
      console.error('售后明细验证失败');
      throw new Error('售后明细不存在或不属于该售后单');
    }

    const now = new Date();
    let itemStatus = caseItem.itemStatus || 'submitted';
    let approvedQty = Number(caseItem.approvedQty || 0) || 0;
    let rejectedQty = Number(caseItem.rejectedQty || 0) || 0;
    let approvedRefundAmount = Number(caseItem.approvedRefundAmount || 0) || 0;
    // 运费核准额与商品退款金额同生共退
    let approvedShippingRefundAmount = Number(caseItem.approvedShippingRefundAmount || 0) || 0;
    const applyShippingRefundAmountOfItem = Number(caseItem.applyShippingRefundAmount || 0) || 0;
    // 运费扣减额（买家责任整单退的包邮差额）与商品退款金额同生共退
    let approvedShippingDeductionAmount = Number(caseItem.approvedShippingDeductionAmount || 0) || 0;
    const applyShippingDeductionAmountOfItem = Number(caseItem.applyShippingDeductionAmount || 0) || 0;
    // 寄回运费补偿核准额（卖家责任退货/换货的逆向快递费）：approve 时商家可调整，其余环节沿用已落库值
    let approvedReturnShippingCompensationAmount = getItemApprovedReturnShippingCompensation(caseItem);
    const applyReturnShippingCompensationAmountOfItem = Number(caseItem.applyReturnShippingCompensationAmount || 0) || 0;
    const processNote = params.result || '';

    if (itemAction === 'approve') {
      itemStatus = 'approved';
      approvedQty = Number(caseItem.applyQty || 0) || 0;
      rejectedQty = 0;
      // 同意即锁定应退金额：历史已核准沿用，否则回退申请额（与验货/完成环节同口径）。
      // 否则同意后商品退款核准额仍为0，案件聚合只剩寄回补偿，详情页"退款金额"会错误地只显示补偿额。
      approvedRefundAmount = Number(caseItem.approvedRefundAmount || 0) || (Number(caseItem.applyRefundAmount || 0) || 0);
      approvedShippingRefundAmount = approvedShippingRefundAmount > 0
        ? approvedShippingRefundAmount
        : applyShippingRefundAmountOfItem;
      approvedShippingDeductionAmount = approvedShippingDeductionAmount > 0
        ? approvedShippingDeductionAmount
        : applyShippingDeductionAmountOfItem;
      // 寄回运费补偿：仅申请建议额>0（卖家责任退货/换货）时可核准，商家可调整，默认=建议额，可调低至0
      if (applyReturnShippingCompensationAmountOfItem > 0) {
        const rawCompParam = params?.approvedReturnShippingCompensationAmount;
        if (rawCompParam === undefined || rawCompParam === null || rawCompParam === '') {
          approvedReturnShippingCompensationAmount = applyReturnShippingCompensationAmountOfItem;
        } else {
          const customComp = roundAmount(Number(rawCompParam));
          if (!Number.isFinite(customComp) || customComp < 0) {
            throw new Error('寄回运费补偿金额需为不小于0的数字');
          }
          if (customComp > RETURN_SHIPPING_COMPENSATION_MAX) {
            throw new Error(`寄回运费补偿金额不能超过 ¥${RETURN_SHIPPING_COMPENSATION_MAX}`);
          }
          approvedReturnShippingCompensationAmount = customComp;
        }
      } else {
        approvedReturnShippingCompensationAmount = 0;
      }
    } else if (itemAction === 'reject') {
      itemStatus = 'rejected';
      approvedQty = 0;
      rejectedQty = Number(caseItem.applyQty || 0) || 0;
      approvedRefundAmount = 0;
      approvedShippingRefundAmount = 0;
      approvedShippingDeductionAmount = 0;
      approvedReturnShippingCompensationAmount = 0;
    } else if (itemAction === 'complete') {
      itemStatus = 'completed';
      approvedQty = approvedQty > 0 ? approvedQty : (Number(caseItem.applyQty || 0) || 0);
      rejectedQty = 0;
      approvedRefundAmount = approvedRefundAmount > 0
        ? approvedRefundAmount
        : (Number(caseItem.applyRefundAmount || 0) || 0);
      approvedShippingRefundAmount = approvedShippingRefundAmount > 0
        ? approvedShippingRefundAmount
        : applyShippingRefundAmountOfItem;
      approvedShippingDeductionAmount = approvedShippingDeductionAmount > 0
        ? approvedShippingDeductionAmount
        : applyShippingDeductionAmountOfItem;
    } else if (itemAction === 'confirm_receipt') {
      itemStatus = 'seller_received';
      approvedQty = approvedQty > 0 ? approvedQty : (Number(caseItem.applyQty || 0) || 0);
      rejectedQty = 0;
      approvedRefundAmount = approvedRefundAmount > 0
        ? approvedRefundAmount
        : (Number(caseItem.applyRefundAmount || 0) || 0);
      approvedShippingRefundAmount = approvedShippingRefundAmount > 0
        ? approvedShippingRefundAmount
        : applyShippingRefundAmountOfItem;
      approvedShippingDeductionAmount = approvedShippingDeductionAmount > 0
        ? approvedShippingDeductionAmount
        : applyShippingDeductionAmountOfItem;
    } else if (itemAction === 'inspect_pass') {
      // 验货通过：换货 → 商家寄出新货（seller_returning）；退款 → 待退款（pending_refund）
      const isExchangeItem = EXCHANGE_TYPES.includes(String(caseItem.afterSalesType || ''));
      if (isExchangeItem) {
        itemStatus = 'seller_returning';
        approvedQty = 0;
        rejectedQty = 0;
        approvedRefundAmount = 0; // 换货不退款
        approvedShippingRefundAmount = 0;
        approvedShippingDeductionAmount = 0;
      } else {
        itemStatus = 'pending_refund';
        approvedQty = approvedQty > 0 ? approvedQty : (Number(caseItem.applyQty || 0) || 0);
        rejectedQty = 0;
        approvedRefundAmount = approvedRefundAmount > 0
          ? approvedRefundAmount
          : (Number(caseItem.applyRefundAmount || 0) || 0);
        approvedShippingRefundAmount = approvedShippingRefundAmount > 0
          ? approvedShippingRefundAmount
          : applyShippingRefundAmountOfItem;
        approvedShippingDeductionAmount = approvedShippingDeductionAmount > 0
          ? approvedShippingDeductionAmount
          : applyShippingDeductionAmountOfItem;
      }
    } else if (itemAction === 'inspect_fail') {
      itemStatus = 'seller_returning';
      approvedQty = 0;
      rejectedQty = Number(caseItem.applyQty || 0) || 0;
      approvedRefundAmount = 0;
      approvedShippingRefundAmount = 0;
      approvedShippingDeductionAmount = 0;
      // 验货不通过=售后不成立（寄回原货），寄回运费补偿取消
      approvedReturnShippingCompensationAmount = 0;
    } else if (itemAction === 'fill_return_tracking') {
      // 商家填写寄回物流单号
      itemStatus = 'buyer_receiving';
      approvedQty = 0;
      rejectedQty = Number(caseItem.applyQty || 0) || 0;
      approvedRefundAmount = 0;
      approvedShippingRefundAmount = 0;
      approvedShippingDeductionAmount = 0;
    } else if (itemAction === 'confirm_return_received') {
      // 买家确认收到商家寄回的商品
      itemStatus = 'completed';
      approvedQty = 0;
      rejectedQty = Number(caseItem.applyQty || 0) || 0;
      approvedRefundAmount = 0;
      approvedShippingRefundAmount = 0;
      approvedShippingDeductionAmount = 0;
    } else {
      throw new Error('不支持的明细处理动作');
    }

    const afterSalesTypeName = EXCHANGE_TYPES.includes(String(caseItem.afterSalesType || '')) ? '换货' : '退款';
    const actionType = EXCHANGE_TYPES.includes(String(caseItem.afterSalesType || '')) ? 'exchange' : 'refund';
    const actionLabelMap = {
        approve: caseItem.needReturnGoods ? `同意${afterSalesTypeName}申请，请尽快寄回商品` : `同意${afterSalesTypeName}申请，待退款`,
        reject: '拒绝售后申请',
        complete: `完成${afterSalesTypeName}`,
        confirm_receipt: '确认收货',
        inspect_pass: '验货通过',
        inspect_fail: '验货不通过',
        fill_return_tracking: '填写寄回单号',
        confirm_return_received: '确认收到寄回商品'
      };

    console.log('准备更新售后明细:', itemId, '新状态:', itemStatus);
    
    const transactionRes = await db.runTransaction(async (transaction) => {
      // 步骤1：更新售后明细状态
      const itemUpdateData = {
        itemStatus,
        approvedQty,
        rejectedQty,
        approvedRefundAmount,
        approvedShippingRefundAmount,
        approvedShippingDeductionAmount,
        approvedReturnShippingCompensationAmount,
        processNote,
        updatedAt: now,
        completedAt: itemStatus === 'completed' ? now : caseItem.completedAt || null
      };
      
      // 商家填写寄回单号时，保存寄回物流信息
      if (itemAction === 'fill_return_tracking') {
        itemUpdateData.sellerReturnLogistics = {
          trackingNumber: params?.trackingNumber || '',
          companyCode: params?.companyCode || '',
          companyName: params?.companyName || '',
          createdAt: now
        };
      }
      
      // 买家确认收到寄回商品时，记录收货时间
      if (itemAction === 'confirm_return_received') {
        itemUpdateData.sellerReturnReceivedAt = now;
      }

      // 标记商家寄回的商品类型：换货验货通过=发新货；验货不通过=寄回原货
      // 供后续 fill_return_tracking / confirm_return_received 区分通知文案使用
      if (itemAction === 'inspect_pass' && EXCHANGE_TYPES.includes(String(caseItem.afterSalesType || ''))) {
        itemUpdateData.returnGoodsType = 'new';
      } else if (itemAction === 'inspect_fail') {
        itemUpdateData.returnGoodsType = 'original';
      }
      
      await transaction.collection('after_sales_case_items').doc(itemId).update({
        data: itemUpdateData
      });
      console.log('售后明细更新成功');

      // 步骤2：创建售后日志
      await transaction.collection('after_sales_logs').add({
        data: {
          caseId: activeCase._id,
          caseItemId: itemId,
          orderId: order._id,
          operatorId: params?.operatorId || '',
          operatorType: params?.operatorType || 'admin',
          action: `${itemAction}_${actionType}`,
          beforeStatus: caseItem.itemStatus,
          afterStatus: itemStatus,
          note: processNote || actionLabelMap[itemAction],
          extra: {
            caseNo: activeCase.caseNo,
            orderItemId: caseItem.orderItemId,
            afterSalesType: caseItem.afterSalesType,
            needReturnGoods: caseItem.needReturnGoods
          },
          createdAt: now
        }
      });

      // 步骤3：获取所有售后明细用于聚合计算
      const caseItemsRes = await transaction.collection('after_sales_case_items').where({
        caseId: activeCase._id
      }).limit(100).get();
      const caseItems = caseItemsRes.data || [];

      // 获取订单的所有售后明细（用于计算订单状态）
      const allOrderCaseItemsRes = await transaction.collection('after_sales_case_items').where({
        orderId: order._id
      }).limit(100).get();
      const allOrderCaseItems = allOrderCaseItemsRes.data || [];

      // 计算售后案件状态和金额
      const caseStatus = calcCaseStatusFromItems(caseItems);
      // 展示口径"退款金额"=商品退款+发货运费退款−扣减，不含寄回运费补偿（补偿在详情页独立成行）
      const approvedAmount = calcCaseApprovedRefundAmount(caseItems);
      const refundedAmount = calcCaseRefundedRefundAmount(caseItems);
      // 寄回运费补偿（案件级，独立字段供详情页展示构成；与 approvedAmount 相互独立）
      const caseReturnCompensationAmount = calcCaseReturnShippingCompensation(caseItems);

      // 计算订单状态信息
      const orderStatusInfo = mapCaseStatusToOrderStatus(caseStatus, order.status, allOrderCaseItems, order.products);

      // 步骤4：更新售后案件状态
      const totalApplyQty = caseItems.reduce((sum, item) => sum + (Number(item.applyQty || 0) || 0), 0);
      const totalApplyAmount = roundAmount(caseItems.reduce((sum, item) => sum + (Number(item.applyRefundAmount || 0) || 0), 0));
      const itemCount = caseItems.length;

      await transaction.collection('after_sales_cases').doc(activeCase._id).update({
        data: {
          caseStatus,
          refundSummary: {
            requestedAmount: Number(activeCase?.refundSummary?.requestedAmount || activeCase.totalApplyAmount || 0) || 0,
            approvedAmount,
            refundedAmount,
            returnShippingCompensationAmount: caseReturnCompensationAmount
          },
          approvedReturnShippingCompensationAmount: caseReturnCompensationAmount,
          totalApplyQty,
          totalApplyAmount,
          itemCount,
          processSummary: (processNote || actionLabelMap[itemAction])
            ? {
                result: processNote || actionLabelMap[itemAction],
                processTime: now,
                operatorType: 'admin'
              }
            : activeCase.processSummary ? activeCase.processSummary : null,
          ...(itemAction === 'inspect_fail' ? {
            inspectEvidence: {
              images: Array.isArray(params?.inspectImages) ? params.inspectImages : [],
              videos: Array.isArray(params?.inspectVideos) ? params.inspectVideos : [],
              videoThumbs: Array.isArray(params?.inspectVideoThumbs) ? params.inspectVideoThumbs : [],
              createdAt: now
            }
          } : {}),
          ...(itemAction === 'fill_return_tracking' ? {
            sellerReturnLogistics: {
              trackingNumber: params?.trackingNumber || '',
              companyCode: params?.companyCode || '',
              companyName: params?.companyName || '',
              createdAt: now
            }
          } : {}),
          updatedAt: now,
          completedAt: caseStatus === 'completed' ? now : activeCase.completedAt || null,
          cancelledAt: caseStatus === 'cancelled' ? now : activeCase.cancelledAt || null
        }
      });

      // 步骤4.1：案件完成时记录案件级完成日志
      if (caseStatus === 'completed' && String(activeCase.caseStatus || '') !== 'completed') {
        const isExchangeCompleted = EXCHANGE_TYPES.includes(String(caseItem.afterSalesType || ''));
        // 验货不通过导致商家寄回商品、买家确认收货：无退款金额，应记录为"售后完成"而非"退款完成"
        const completedAction = isExchangeCompleted
          ? 'complete_case_exchange'
          : (approvedAmount > 0 ? 'complete_case_refund' : 'complete_case_after_sales');
        const completedNote = isExchangeCompleted
          ? '换货完成'
          : (approvedAmount > 0 ? '退款完成' : '售后完成');
        await transaction.collection('after_sales_logs').add({
          data: {
            caseId: activeCase._id,
            orderId: order._id,
            operatorId: params?.operatorId || '',
            operatorType: params?.operatorType || 'admin',
            action: completedAction,
            beforeStatus: activeCase.caseStatus || '',
            afterStatus: 'completed',
            note: completedNote,
            extra: {
              caseNo: activeCase.caseNo,
              approvedAmount: approvedAmount,
              refundedAmount: refundedAmount
            },
            createdAt: now
          }
        });
      }

      // 步骤5：更新订单状态
      // 跨订单全部售后明细统一聚合：只要还有任一进行中的明细（含其他售后单、
      // 换货寄回/待收新货环节），订单保持售后中；全部终结后再按件数决定恢复/完成
      const orderUpdateData = buildOrderUpdateForAfterSales(order, allOrderCaseItems, now);

      await transaction.collection('orders').doc(order._id).update({
        data: orderUpdateData
      });

      return { caseStatus, orderStatusInfo, approvedRefundAmount, orderUpdateData };
    });

    console.log('=== 售后处理完成（事务已提交）===');

    // 如果案件状态为pending_refund（待退款）且有退款金额，创建待退款记录
    if (transactionRes.caseStatus === 'pending_refund') {
      // 实际退款 = 商品退款 + 应退发货运费 − 应扣发货运费 + 寄回运费补偿（卖家责任退货）
      // 新口径（shippingDeductionNetted）：应扣运费已内扣在商品退款额（最多可退为净额），不再重复扣减；
      // 历史明细（无标记）：按原口径再扣一次
      const deductionNetted = !!caseItem.shippingDeductionNetted;
      // 注意：商品退款必须用事务内核验后的局部变量 approvedRefundAmount，
      // 不能用 caseItem.approvedRefundAmount（那是事务前快照，申请时初始为 0，会导致退款记录被静默跳过）
      const approvedAmount = roundAmount(
        (Number(approvedRefundAmount) || 0)
        + (Number(approvedShippingRefundAmount) || 0)
        - (deductionNetted ? 0 : (Number(approvedShippingDeductionAmount) || 0))
        + (Number(approvedReturnShippingCompensationAmount) || 0)
      );
      if (approvedAmount > 0) {
        console.log('=== 创建待退款记录（含寄回运费补偿）===');
        console.log('退款金额:', approvedAmount, '寄回运费补偿:', approvedReturnShippingCompensationAmount);
        await createAfterSalesRefundRecord({
          order,
          caseId: activeCase._id,
          amount: approvedAmount,
          reason: processNote || '售后审核通过，待退款'
        });
      }
    }

    // 换货流程无商品退款：验货通过后商家寄出新货，买家确认收到新货（completed）后，
    // 将卖家承担的寄回运费补偿单独打款到账（验货不通过寄回原货不补偿）
    if (itemAction === 'confirm_return_received'
      && String(caseItem.returnGoodsType || '') === 'new'
      && Number(approvedReturnShippingCompensationAmount) > 0
      && !caseItem.returnCompensationRefundCreated) {
      const compensationAmount = roundAmount(approvedReturnShippingCompensationAmount);
      // 幂等防护：同一售后单已存在同额"寄回运费补偿"退款记录时跳过，避免重复打款
      let duplicated = false;
      try {
        const existedRes = await db.collection('refund_records')
          .where({ caseId: activeCase._id })
          .limit(50)
          .get();
        duplicated = (existedRes.data || []).some((r) =>
          Number(r.amount) === compensationAmount
          && String(r.reason || '').includes(RETURN_COMPENSATION_REASON_TAG));
      } catch (queryErr) {
        console.error('查询寄回运费补偿退款记录失败，按未创建处理:', queryErr);
      }
      if (!duplicated) {
        console.log('=== 换货完成：创建寄回运费补偿打款记录 ===', compensationAmount);
        const created = await createAfterSalesRefundRecord({
          order,
          caseId: activeCase._id,
          amount: compensationAmount,
          reason: `${RETURN_COMPENSATION_REASON_TAG}（换货运费补偿）`
        });
        if (created) {
          try {
            await db.collection('after_sales_case_items').doc(itemId).update({
              data: {
                returnCompensationRefundCreated: true,
                returnCompensationRefundCreatedAt: now
              }
            });
          } catch (markErr) {
            console.error('回写寄回运费补偿打款标记失败（不影响打款，靠退款记录幂等兜底）:', markErr);
          }
        }
      }
    }

    return {
      newStatus: transactionRes.orderUpdateData?.status || transactionRes.orderStatusInfo.status,
      afterSalesStatus: transactionRes.orderUpdateData?.afterSalesStatus || transactionRes.orderStatusInfo.afterSalesStatus,
      caseId: activeCase._id,
      caseStatus: transactionRes.caseStatus,
      approvedAmount: transactionRes.approvedRefundAmount,
      itemAction: itemAction,
      afterSalesType: caseItem.afterSalesType || '',
      needReturnGoods: caseItem.needReturnGoods || false,
      returnGoodsType: caseItem.returnGoodsType || '',
      updatedAt: now
    };
  }

  const now = new Date();

  // 获取售后类型信息
  const caseItemsResBefore = await db.collection('after_sales_case_items').where({
    caseId: activeCase._id
  }).limit(100).get();
  const caseItems = caseItemsResBefore.data || [];
  const isExchange = caseItems.some(item => EXCHANGE_TYPES.includes(String(item.afterSalesType || '')));
  const afterSalesTypeName = isExchange ? '换货' : '退款';
  const defaultResultText = `完成${afterSalesTypeName}`;

  // 最终订单状态由事务内跨全部售后明细统一聚合（含其他进行中的售后单）
  let finalOrderStatus = order.status;
  let finalAfterSalesStatus = 'completed';

  // 使用事务确保数据一致性
  await db.runTransaction(async (transaction) => {
    // 步骤1：更新售后案件状态
    await transaction.collection('after_sales_cases').doc(activeCase._id).update({
      data: {
        caseStatus: 'completed',
        updatedAt: now,
        completedAt: now,
        processSummary: {
          result: params.result || defaultResultText,
          processTime: now,
          operatorType: params?.operatorType || 'admin'
        }
      }
    });

    // 步骤2：更新售后案件明细状态
    const caseItemsRes = await transaction.collection('after_sales_case_items').where({
      caseId: activeCase._id
    }).limit(100).get();

    await Promise.all((caseItemsRes.data || []).map((item) => transaction.collection('after_sales_case_items').doc(item._id).update({
      data: {
        itemStatus: 'completed',
        approvedQty: Number(item.applyQty || 0),
        approvedRefundAmount: Number(item.applyRefundAmount || 0),
        approvedShippingRefundAmount: Number(item.applyShippingRefundAmount || 0) || 0,
        approvedShippingDeductionAmount: Number(item.applyShippingDeductionAmount || 0) || 0,
        approvedReturnShippingCompensationAmount: getItemApprovedReturnShippingCompensation(item),
        processNote: params.result || '售后处理完成',
        updatedAt: now,
        completedAt: now
      }
    })));

    // 查询订单的所有售后明细（更新后），用于聚合订单状态与售后结果文案
    const allOrderCaseItemsRes = await transaction.collection('after_sales_case_items').where({
      orderId: order._id
    }).limit(100).get();
    const allOrderCaseItems = allOrderCaseItemsRes.data || [];

    // 步骤3：保存逆向物流信息（如果有）
    const reverseLogistics = params && params.reverseLogistics && typeof params.reverseLogistics === 'object'
      ? params.reverseLogistics
      : null;
    if (reverseLogistics) {
      await transaction.collection('reverse_logistics').add({
        data: {
          caseId: activeCase._id,
          orderId: activeCase.orderId,
          orderNumber: activeCase.orderNumber,
          logisticsCompany: reverseLogistics.logisticsCompany || '',
          trackingNumber: reverseLogistics.trackingNumber || '',
          senderType: reverseLogistics.senderType || 'buyer',
          receiverAddressSnapshot: reverseLogistics.receiverAddressSnapshot || activeCase.returnAddressSnapshot || null,
          status: reverseLogistics.status || 'created',
          shippedAt: reverseLogistics.shippedAt || null,
          signedAt: reverseLogistics.signedAt || null,
          caseItemIds: Array.isArray(reverseLogistics.caseItemIds) ? reverseLogistics.caseItemIds : [],
          updatedAt: now,
          createdAt: now
        }
      });
    }

    // 步骤4：创建售后日志
    await transaction.collection('after_sales_logs').add({
      data: {
        caseId: activeCase._id,
        orderId: order._id,
        operatorId: params?.operatorId || '',
        operatorType: params?.operatorType || 'admin',
        action: `complete_case_${isExchange ? 'exchange' : 'refund'}`,
        beforeStatus: activeCase.caseStatus,
        afterStatus: 'completed',
        note: params.result || defaultResultText,
        extra: {
          caseNo: activeCase.caseNo,
          afterSalesType: isExchange ? 'exchange' : 'refund'
        },
        createdAt: now
      }
    });

    // 步骤5：更新订单状态
    // 跨订单全部售后明细统一聚合：其他售后单仍在进行（含换货寄回环节）时保持售后中；
    // 仅部分件数售后时恢复售后前状态；全部完成才标记完成/退款完成
    const updateData = buildOrderUpdateForAfterSales(order, allOrderCaseItems, now);
    if (!updateData.afterSalesResult && params.result) {
      updateData.afterSalesResult = params.result;
    }
    finalOrderStatus = updateData.status;
    finalAfterSalesStatus = updateData.afterSalesStatus || 'completed';
    await transaction.collection('orders').doc(order._id).update({
      data: updateData
    });
  });

  return {
    newStatus: finalOrderStatus,
    afterSalesStatus: finalAfterSalesStatus,
    caseId: activeCase._id,
    updatedAt: now
  };
}

/**
 * 处理取消售后操作
 */
async function handleCancelAfterSalesOperation(order, params) {
  const activeCase = await getActiveAfterSalesCaseByOrder(order, params);
  if (!activeCase) {
    throw new Error('当前订单没有可取消的售后申请');
  }

  // 后端防护：拦截快递中不可取消（与前端 canCancelAfterSales 保持一致），
  // 防止绕过前端直接调用云函数，避免拦截流程与取消并发执行产生状态错乱
  const activeCaseStatus = activeCase.caseStatus || activeCase.status;
  if (activeCaseStatus === 'intercepting') {
    throw new Error('快递拦截中，无法取消售后，请联系客服');
  }

  const now = new Date();

  // 使用事务确保数据一致性
  let finalOrderStatus = order.status;
  let finalAfterSalesStatus = 'cancelled';
  let finalAfterSalesResult = '';
  await db.runTransaction(async (transaction) => {
    // 步骤1：更新售后案件状态
    await transaction.collection('after_sales_cases').doc(activeCase._id).update({
      data: {
        caseStatus: 'cancelled',
        updatedAt: now,
        cancelledAt: now,
        processSummary: {
          result: params.result || '售后申请已取消',
          processTime: now,
          operatorType: params?.operatorType || 'user'
        }
      }
    });

    // 步骤2：更新售后案件明细状态
    const caseItemsRes = await transaction.collection('after_sales_case_items').where({
      caseId: activeCase._id
    }).limit(100).get();

    await Promise.all((caseItemsRes.data || []).map((item) => transaction.collection('after_sales_case_items').doc(item._id).update({
      data: {
        itemStatus: 'cancelled',
        processNote: params.result || '售后申请已取消',
        updatedAt: now,
        completedAt: now
      }
    })));

    // 步骤3：创建售后日志
    await transaction.collection('after_sales_logs').add({
      data: {
        caseId: activeCase._id,
        orderId: order._id,
        operatorId: params?.operatorId || '',
        operatorType: params?.operatorType || 'user',
        action: 'cancel_case',
        beforeStatus: activeCase.caseStatus,
        afterStatus: 'cancelled',
        note: params.result || '售后申请已取消',
        extra: {
          caseNo: activeCase.caseNo
        },
        createdAt: now
      }
    });

    // 步骤4：更新订单状态
    // 跨订单全部售后明细统一聚合：其他售后单仍在进行（含换货寄回环节）时订单保持售后中，
    // 不能因取消当前单就恢复订单状态；也不能冲掉其他单已完成的"部分退款"等结果文案
    const allOrderItemsRes = await transaction.collection('after_sales_case_items').where({
      orderId: order._id
    }).limit(100).get();
    const orderUpdateData = buildOrderUpdateForAfterSales(order, allOrderItemsRes.data || [], now);

    // 历史脏数据兜底：缺少 originalStatusBeforeRefund 时按配送方式决定恢复状态
    if (!order.originalStatusBeforeRefund && order.status === 'refund'
      && ['completed', 'cancelled'].includes(String(orderUpdateData.afterSalesStatus))) {
      const deliveryType = order.deliveryType || 'express';
      orderUpdateData.status = deliveryType === 'pickup' ? 'completed' : 'delivered';
    }

    finalOrderStatus = orderUpdateData.status;
    finalAfterSalesStatus = orderUpdateData.afterSalesStatus;
    finalAfterSalesResult = orderUpdateData.afterSalesResult || '';

    await transaction.collection('orders').doc(order._id).update({
      data: orderUpdateData
    });
  });

  return {
    newStatus: finalOrderStatus,
    afterSalesStatus: finalAfterSalesStatus,
    afterSalesResult: finalAfterSalesResult,
    caseId: activeCase._id,
    updatedAt: now
  };
}

async function getAdminOpenids() {
  try {
    const settingsRes = await db.collection('settings').limit(1).get();
    const settings = (settingsRes.data && settingsRes.data[0]) || {};
    
    // 兼容两种字段名：adminOpenId（小程序端使用）和 adminOpenids（旧版）
    if (Array.isArray(settings.adminOpenId)) {
      console.log('使用 adminOpenId 字段');
      return settings.adminOpenId.filter(Boolean);
    }
    if (Array.isArray(settings.adminOpenids)) {
      console.log('使用 adminOpenids 字段');
      return settings.adminOpenids.filter(Boolean);
    }
  } catch (error) {
    console.error('获取管理员openid失败:', error);
  }
  return [];
}

async function isAdmin(openid) {
  if (!openid) return false;
  const adminOpenids = await getAdminOpenids();
  return adminOpenids.includes(openid);
}

async function getAdminNickName(openid) {
  try {
    const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get();
    if (userRes.data && userRes.data[0]) {
      return userRes.data[0].nickName || userRes.data[0].nickname || '';
    }
  } catch (error) {
    console.error('获取管理员昵称失败:', error);
  }
  return '';
}

async function getUserNickName(openid) {
  try {
    const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get();
    if (userRes.data && userRes.data[0]) {
      return userRes.data[0].nickName || userRes.data[0].nickname || userRes.data[0].name || '';
    }
  } catch (error) {
    console.error('获取用户昵称失败:', error);
  }
  return '';
}

/**
 * 订单物流是否已签收（售后拦截/拒签操作的前置判定，与前端管理端同口径）：
 * 轨迹 isCheck='1' 或 stateName 含"签收"；订单已完成；原因为"空包裹"（签收拆包后才能发现）
 */
function isOrderSignedForAfterSales(order, reasonCode) {
  const state = order?.logisticsState || {};
  if (String(state.isCheck) === '1') return true;
  if (String(state.stateName || '').includes('签收')) return true;
  if (String(order?.status || '') === 'completed') return true;
  if (String(reasonCode || '') === 'empty_package') return true;
  return false;
}

async function handleStartInterceptingOperation(order, params) {
  console.log('=== 开始拦截快递 ===');
  console.log('订单ID:', order._id);
  console.log('处理参数:', params);
  
  const activeCase = await getActiveAfterSalesCaseByOrder(order, params);
  if (!activeCase) {
    console.error('未找到有效的售后单');
    throw new Error('当前订单没有售后申请或售后申请已经处理完成');
  }
  console.log('找到售后单:', activeCase._id, '状态:', activeCase.caseStatus);

  // 拦截仅适用于"物流在途未签收的未收到货退款"：已签收（空包裹等）或其他售后类型不能拦截
  const isNotReceivedCaseForIntercept = activeCase.primaryAfterSalesType === 'refund_not_received'
    || activeCase.primaryAfterSalesType === 'not_received_refund'
    || activeCase.goodsStatus === 'not_received';
  if (!isNotReceivedCaseForIntercept) {
    throw new Error('仅物流在途的未收到货退款支持拦截快递');
  }
  if (isOrderSignedForAfterSales(order, activeCase.applyReasonCode || activeCase.reasonCode)) {
    throw new Error('物流已签收，无法拦截，请直接"同意"或"拒绝"该售后申请');
  }

  const itemId = String(params?.itemId || '').trim();
  const now = new Date();
  const transactionRes = await db.runTransaction(async (transaction) => {
    if (itemId) {
      const caseItemRes = await transaction.collection('after_sales_case_items').doc(itemId).get();
      const caseItem = caseItemRes.data;
      
      if (!caseItem || caseItem.caseId !== activeCase._id) {
        console.error('售后明细验证失败');
        throw new Error('售后明细不存在或不属于该售后单');
      }
      
      await transaction.collection('after_sales_case_items').doc(itemId).update({
        data: {
          itemStatus: 'intercepting',
          updatedAt: now
        }
      });

      await transaction.collection('after_sales_logs').add({
        data: {
          caseId: activeCase._id,
          caseItemId: itemId,
          orderId: order._id,
          operatorId: params?.operatorId || '',
          operatorType: params?.operatorType || 'admin',
          action: 'start_intercepting',
          beforeStatus: caseItem.itemStatus,
          afterStatus: 'intercepting',
          note: '开始拦截快递',
          extra: {
            caseNo: activeCase.caseNo,
            orderItemId: caseItem.orderItemId
          },
          createdAt: now
        }
      });
    } else {
      const caseItemsRes = await transaction.collection('after_sales_case_items').where({
        caseId: activeCase._id
      }).limit(100).get();

      await Promise.all((caseItemsRes.data || []).map((item) => transaction.collection('after_sales_case_items').doc(item._id).update({
        data: {
          itemStatus: 'intercepting',
          updatedAt: now
        }
      })));

      await transaction.collection('after_sales_logs').add({
        data: {
          caseId: activeCase._id,
          orderId: order._id,
          operatorId: params?.operatorId || '',
          operatorType: params?.operatorType || 'admin',
          action: 'start_intercepting',
          beforeStatus: activeCase.caseStatus,
          afterStatus: 'intercepting',
          note: '开始拦截快递',
          extra: {
            caseNo: activeCase.caseNo
          },
          createdAt: now
        }
      });
    }

    const caseItemsRes = await transaction.collection('after_sales_case_items').where({
      caseId: activeCase._id
    }).limit(100).get();
    const caseItems = caseItemsRes.data || [];

    const allOrderCaseItemsRes = await transaction.collection('after_sales_case_items').where({
      orderId: order._id
    }).limit(100).get();
    const allOrderCaseItems = allOrderCaseItemsRes.data || [];

    const caseStatus = calcCaseStatusFromItems(caseItems);
    // 展示口径：退款金额不含寄回运费补偿（拦截场景本身也无寄回补偿）
    const approvedAmount = calcCaseApprovedRefundAmount(caseItems);
    const refundedAmount = calcCaseRefundedRefundAmount(caseItems);

    const orderStatusInfo = mapCaseStatusToOrderStatus(caseStatus, order.status, allOrderCaseItems, order.products);

    const totalApplyQty = caseItems.reduce((sum, item) => sum + (Number(item.applyQty || 0) || 0), 0);
    const totalApplyAmount = roundAmount(caseItems.reduce((sum, item) => sum + (Number(item.applyRefundAmount || 0) || 0), 0));
    const caseItemCount = caseItems.length;

    await transaction.collection('after_sales_cases').doc(activeCase._id).update({
      data: {
        caseStatus,
        refundSummary: {
          requestedAmount: Number(activeCase?.refundSummary?.requestedAmount || activeCase.totalApplyAmount || 0) || 0,
          approvedAmount,
          refundedAmount
        },
        totalApplyQty,
        totalApplyAmount,
        itemCount: caseItemCount,
        processSummary: {
          result: '正在拦截快递',
          processTime: now,
          operatorType: 'admin'
        },
        updatedAt: now
      }
    });

    // 统一聚合：本案进入拦截中时订单保持售后中（intercepting），同时兼容其他售后单的进行中状态
    const orderUpdateData = buildOrderUpdateForAfterSales(order, allOrderCaseItems, now);
    await transaction.collection('orders').doc(order._id).update({
      data: orderUpdateData
    });

    return { caseStatus, orderStatusInfo, orderUpdateData };
  });

  console.log('=== 开始拦截完成（事务已提交）===');
  return {
    newStatus: transactionRes.orderUpdateData?.status || transactionRes.orderStatusInfo.status,
    afterSalesStatus: transactionRes.orderUpdateData?.afterSalesStatus || transactionRes.orderStatusInfo.afterSalesStatus,
    caseId: activeCase._id,
    caseStatus: transactionRes.caseStatus,
    updatedAt: now
  };
}

/**
 * 处理完成拦截操作
 */
async function handleCompleteInterceptingOperation(order, params) {
  console.log('=== 完成拦截 ===');
  console.log('订单ID:', order._id);
  console.log('处理参数:', params);
  
  const activeCase = await getActiveAfterSalesCaseByOrder(order, params);
  if (!activeCase) {
    console.error('未找到有效的售后单');
    throw new Error('当前订单没有售后申请或售后申请已经处理完成');
  }
  console.log('找到售后单:', activeCase._id, '状态:', activeCase.caseStatus);

  const itemId = String(params?.itemId || '').trim();
  const finalAction = String(params?.finalAction || '').trim(); // approve or reject
  const resultText = String(params?.result || '');
  const now = new Date();
  
  if (!['approve', 'reject'].includes(finalAction)) {
    throw new Error('无效的最终操作，必须是approve或reject');
  }

  // 判断是否为拦截成功
  const isInterceptSuccess = resultText.includes('拦截物流成功');

  // 拦截失败/已送达时禁止直接同意退款：货没拦回来就退款会钱货两空。
  // 正确路径：拒绝申请 → 买家拒签，包裹退回商家后由买家重新发起未收到货退款，
  // 届时商家可直接同意，售后进入待退款
  if (finalAction === 'approve' && !isInterceptSuccess) {
    throw new Error('物流未拦截成功时不能直接同意退款，请拒绝申请并请买家拒签，待包裹退回后重新申请售后');
  }
  
  let finalResultText = resultText;
  if (finalAction === 'approve' && isInterceptSuccess) {
    finalResultText = '拦截成功，正在退款中';
  }

  const orderProducts = isInterceptSuccess ? normalizeOrderProducts(order) : [];

  const transactionRes = await db.runTransaction(async (transaction) => {
    const caseItemsRes = await transaction.collection('after_sales_case_items').where({
      caseId: activeCase._id
    }).limit(100).get();

    if (finalAction === 'approve' && isInterceptSuccess) {
      console.log('=== 拦截成功，处理订单所有商品（等待退款）===');
      
      const allCaseItemsRes = await transaction.collection('after_sales_case_items').where({
        orderId: order._id
      }).limit(100).get();
      
      await Promise.all((caseItemsRes.data || []).map((item) => {
        const approvedQty = Number(item.applyQty || 0);
        const approvedRefundAmount = Number(item.applyRefundAmount || 0);

        return transaction.collection('after_sales_case_items').doc(item._id).update({
          data: {
            itemStatus: 'pending_refund',
            approvedQty,
            rejectedQty: 0,
            approvedRefundAmount,
            approvedShippingRefundAmount: Number(item.applyShippingRefundAmount || 0) || 0,
            // 拦截成功=未收到货整单退款，不涉及买家责任扣减
            approvedShippingDeductionAmount: 0,
            processNote: finalResultText,
            updatedAt: now
          }
        });
      }));
      
      const validAllCaseItems = (allCaseItemsRes.data || []).filter(item => 
        !['cancelled', 'rejected'].includes(String(item.itemStatus || ''))
      );
      const existingItemIndices = new Set(validAllCaseItems.map(item => String(item.orderItemIndex)));
      console.log('现有售后商品索引:', existingItemIndices);
      console.log('订单商品数量:', orderProducts.length);
      
      for (let i = 0; i < orderProducts.length; i++) {
        const product = orderProducts[i];
        if (!existingItemIndices.has(String(i))) {
          console.log('为商品索引', i, '创建待退款记录');
          
          const buyQty = product.buyQty || 1;
          const totalAmount = product.lineAmount || 0;
          
          await transaction.collection('after_sales_case_items').add({
            data: {
              caseId: activeCase._id,
              orderId: order._id,
              orderItemId: product.orderItemId,
              orderItemIndex: product.index,
              productId: product.productId,
              productNameSnapshot: product.productName,
              coverImageSnapshot: product.coverImage || '',
              afterSalesType: activeCase.primaryAfterSalesType || activeCase.type || 'refund',
              applyQty: buyQty,
              applyRefundAmount: totalAmount,
              itemStatus: 'pending_refund',
              approvedQty: buyQty,
              approvedRefundAmount: totalAmount,
              unitPriceSnapshot: product.unitPrice || 0,
              payableAmountSnapshot: totalAmount,
              processNote: '拦截成功，订单全部商品待退款',
              createdAt: now,
              updatedAt: now
            }
          });
        }
      }

      // 兜底：拦截成功=物流未完成的整单退款，若申请明细未承载运费（历史数据/异常入口），
      // 在本案第一条明细上补挂应退运费（运费整单只退一次）
      const postInterceptCaseItemsRes = await transaction.collection('after_sales_case_items').where({
        caseId: activeCase._id
      }).limit(100).get();
      const postInterceptCaseItems = postInterceptCaseItemsRes.data || [];
      const postInterceptAllItemsRes = await transaction.collection('after_sales_case_items').where({
        orderId: order._id
      }).limit(100).get();
      const shippingFee = getOrderShippingFee(order, orderProducts);
      const committedShipping = calcCommittedShippingRefund(postInterceptAllItemsRes.data || []);
      const shippingToRefund = roundAmount(shippingFee - committedShipping);
      if (postInterceptCaseItems.length > 0 && shippingToRefund > REFUND_AMOUNT_TOLERANCE) {
        const carrier = postInterceptCaseItems[0];
        await transaction.collection('after_sales_case_items').doc(carrier._id).update({
          data: {
            applyShippingRefundAmount: Math.max(Number(carrier.applyShippingRefundAmount || 0) || 0, shippingToRefund),
            approvedShippingRefundAmount: shippingToRefund,
            // 未收到货整单退款不扣减运费
            approvedShippingDeductionAmount: 0,
            updatedAt: now
          }
        });
      }
    }

    // 拦截结果（approve 在事务前已强制要求必须拦截成功）：
    //   1. 拦截成功 + approve → pending_refund（整单全部商品待退款，走自动退款流程）
    //   2. 拦截失败/已送达 + reject → rejected（售后关闭，买家拒签后重新申请）
    const itemStatus = finalAction === 'approve' ? 'pending_refund' : 'rejected';

    // 拦截成功且通过的情况，上面已将所有商品设置为 pending_refund；
    // 其他情况需要逐项更新明细状态
    if (!(finalAction === 'approve' && isInterceptSuccess)) {
      await Promise.all((caseItemsRes.data || []).map((item) => {
        const approvedQty = finalAction === 'approve' ? Number(item.applyQty || 0) : 0;
        const rejectedQty = finalAction === 'reject' ? Number(item.applyQty || 0) : 0;
        const approvedRefundAmount = finalAction === 'approve' ? Number(item.applyRefundAmount || 0) : 0;
        const approvedShippingRefundAmount = finalAction === 'approve'
          ? (Number(item.applyShippingRefundAmount || 0) || 0)
          : 0;
        const approvedShippingDeductionAmount = finalAction === 'approve'
          ? (Number(item.applyShippingDeductionAmount || 0) || 0)
          : 0;

        return transaction.collection('after_sales_case_items').doc(item._id).update({
          data: {
            itemStatus,
            approvedQty,
            rejectedQty,
            approvedRefundAmount,
            approvedShippingRefundAmount,
            approvedShippingDeductionAmount,
            processNote: finalResultText,
            updatedAt: now
          }
        });
      }));
    }

    await transaction.collection('after_sales_logs').add({
      data: {
        caseId: activeCase._id,
        orderId: order._id,
        operatorId: params?.operatorId || '',
        operatorType: params?.operatorType || 'admin',
        action: finalAction === 'approve' ? 'approve_intercepting' : 'reject_intercepting',
        beforeStatus: 'intercepting',
        afterStatus: itemStatus,
        note: finalResultText,
        extra: {
          caseNo: activeCase.caseNo
        },
        createdAt: now
      }
    });

    const allCaseItemsRes = await transaction.collection('after_sales_case_items').where({
      caseId: activeCase._id
    }).limit(100).get();
    const caseItems = allCaseItemsRes.data || [];

    const allOrderCaseItemsRes = await transaction.collection('after_sales_case_items').where({
      orderId: order._id
    }).limit(100).get();
    const allOrderCaseItems = allOrderCaseItemsRes.data || [];

    const caseStatus = calcCaseStatusFromItems(caseItems);
    // 打款总额（含寄回补偿，用于创建退款记录）；展示口径 approvedDisplayAmount 不含补偿
    const approvedAmount = calcCaseApprovedTotalAmount(caseItems);
    const approvedDisplayAmount = calcCaseApprovedRefundAmount(caseItems);
    const refundedAmount = calcCaseRefundedRefundAmount(caseItems);

    const orderStatusInfo = mapCaseStatusToOrderStatus(caseStatus, order.status, allOrderCaseItems, order.products);

    const totalApplyQty = caseItems.reduce((sum, item) => sum + (Number(item.applyQty || 0) || 0), 0);
    const totalApplyAmount = roundAmount(caseItems.reduce((sum, item) => sum + (Number(item.applyRefundAmount || 0) || 0), 0));
    const caseItemCount = caseItems.length;

    // 记录售后状态变更日志（拦截完成后的售后结束/进入待退款）
    let endAction = '';
    let endNote = '';
    if (caseStatus === 'rejected') {
      endAction = 'after_sales_rejected';
      endNote = finalAction === 'reject'
        ? (isInterceptSuccess ? '拦截成功，管理员拒绝退款，售后已关闭' : '拦截失败，管理员拒绝售后，售后已关闭')
        : '售后已拒绝';
    } else if (caseStatus === 'cancelled') {
      endAction = 'after_sales_cancelled';
      endNote = '拦截失败，售后已取消';
    } else if (caseStatus === 'pending_refund') {
      endAction = 'after_sales_pending_refund';
      endNote = '拦截成功，售后进入待退款流程';
    } else if (caseStatus === 'completed') {
      endAction = 'after_sales_completed';
      endNote = '售后已完成';
    }

    if (endAction) {
      await transaction.collection('after_sales_logs').add({
        data: {
          caseId: activeCase._id,
          orderId: order._id,
          operatorId: params?.operatorId || '',
          operatorType: params?.operatorType || 'admin',
          action: endAction,
          beforeStatus: 'intercepting',
          afterStatus: caseStatus,
          note: endNote,
          extra: {
            caseNo: activeCase.caseNo,
            finalAction,
            isInterceptSuccess,
            interceptResult: finalResultText
          },
          createdAt: now
        }
      });
    }

    await transaction.collection('after_sales_cases').doc(activeCase._id).update({
      data: {
        caseStatus,
        refundSummary: {
          requestedAmount: Number(activeCase?.refundSummary?.requestedAmount || activeCase.totalApplyAmount || 0) || 0,
          approvedAmount: approvedDisplayAmount,
          refundedAmount
        },
        totalApplyQty,
        totalApplyAmount,
        itemCount: caseItemCount,
        processSummary: {
          result: finalResultText,
          processTime: now,
          operatorType: 'admin'
        },
        updatedAt: now,
        completedAt: caseStatus === 'completed' ? now : activeCase.completedAt || null
      }
    });

    // 跨订单全部售后明细统一聚合：其他售后单仍在进行时保持售后中，
    // 部分件数完成恢复售后前状态，全部完成才标记完成/退款完成
    const orderUpdateData = buildOrderUpdateForAfterSales(order, allOrderCaseItems, now);

    await transaction.collection('orders').doc(order._id).update({
      data: orderUpdateData
    });

    return { caseStatus, orderStatusInfo, approvedAmount, orderUpdateData };
  });

  console.log('=== 完成拦截（事务已提交）===');

  // 拦截完成且案件进入待退款时，创建待退款记录（与常规审核通过路径保持一致）
  if (transactionRes.caseStatus === 'pending_refund') {
    const approvedAmount = roundAmount(transactionRes.approvedAmount || 0);
    if (approvedAmount > 0) {
      console.log('=== 拦截路径：创建待退款记录 ===');
      console.log('退款金额:', approvedAmount);
      try {
        const refundRes = await cloud.callFunction({
          name: 'refund',
          data: {
            action: 'create',
            orderId: order._id,
            caseId: activeCase._id,
            amount: approvedAmount,
            outTradeNo: order.outTradeNo || order.tradeNo || '',
            reason: finalResultText || '拦截完成，售后进入待退款'
          }
        });
        console.log('拦截路径待退款记录创建结果:', JSON.stringify(refundRes));
        if (!refundRes.result?.success) {
          console.error('拦截路径待退款记录创建失败:', refundRes.result?.error || '未知错误');
        }
      } catch (refundErr) {
        console.error('调用退款云函数异常:', refundErr);
      }
    }
  }

  return {
    newStatus: transactionRes.orderUpdateData?.status || transactionRes.orderStatusInfo.status,
    afterSalesStatus: transactionRes.orderUpdateData?.afterSalesStatus || transactionRes.orderStatusInfo.afterSalesStatus,
    caseId: activeCase._id,
    caseStatus: transactionRes.caseStatus,
    updatedAt: now
  };
}

/**
 * 买家拒签后直接同意退款（无需等待包裹退回商家入库）
 * 适用场景：物流轨迹已显示"拒收/退回"（两种来源）：
 *   1. 管理员拦截失败/已送达后拒绝，买家拒签并重新发起申请；
 *   2. 买家在快递送达时直接拒签，之后首次发起未收到货退款。
 * 前提由管理员在操作时核实物流轨迹（前端二次确认），系统只校验售后类型与状态。
 * 效果与"拦截成功 + 同意"完全一致：整单全部商品进入待退款并自动创建退款记录。
 */
async function handleApproveRefusedDeliveryOperation(order, params) {
  console.log('=== 买家拒签，同意退款 ===');
  console.log('订单ID:', order._id);
  console.log('处理参数:', params);

  const caseId = String(params?.caseId || '').trim();
  if (!caseId) {
    throw new Error('缺少售后单ID');
  }

  const activeCase = await getActiveAfterSalesCaseByOrder(order, { caseId });
  if (!activeCase) {
    throw new Error('当前订单没有售后申请或售后申请已经处理完成');
  }
  console.log('找到售后单:', activeCase._id, '状态:', activeCase.caseStatus);

  const beforeStatus = activeCase.caseStatus || activeCase.status || 'submitted';
  if (!['submitted', 'reviewing', 'pending'].includes(beforeStatus)) {
    throw new Error('当前售后单状态不允许该操作');
  }

  // 必须是未收到货退款类型
  const preItemsRes = await db.collection('after_sales_case_items').where({
    caseId: activeCase._id
  }).limit(100).get();
  const preItems = preItemsRes.data || [];
  const isNotReceivedCase = activeCase.primaryAfterSalesType === 'refund_not_received'
    || activeCase.goodsStatus === 'not_received'
    || preItems.some((item) => String(item.afterSalesType) === 'refund_not_received');
  if (!isNotReceivedCase) {
    throw new Error('仅未收到货退款支持拒签后直接同意');
  }

  // 拒签=送达时拒收、物流未完成；已签收（含签收后发现空包裹）不适用本操作，应走普通"同意"直接退款
  const reasonItem = preItems.find((item) => item?.reasonCode || item?.applyReasonCode) || {};
  const refusedReasonCode = String(
    activeCase.applyReasonCode || activeCase.reasonCode
    || reasonItem.reasonCode || reasonItem.applyReasonCode || ''
  );
  if (isOrderSignedForAfterSales(order, refusedReasonCode)) {
    throw new Error('物流已签收，不适用拒签退款，请直接"同意"该售后申请');
  }

  // 若存在上一笔被拒绝的未收到货售后（拦截失败后重新申请的路径），记录到日志便于追溯；
  // 买家直接拒签后首次申请时没有该记录，同样允许操作——以管理员核实的物流拒收轨迹为准
  let refusedCaseId = '';
  const historyRes = await db.collection('after_sales_cases').where({
    orderId: order._id,
    caseStatus: 'rejected'
  }).limit(20).get();
  const priorRejectedNotReceivedCase = (historyRes.data || []).find((item) =>
    String(item._id) !== String(activeCase._id)
    && (item.primaryAfterSalesType === 'refund_not_received' || item.goodsStatus === 'not_received'));
  refusedCaseId = priorRejectedNotReceivedCase ? priorRejectedNotReceivedCase._id : '';

  const now = new Date();
  const finalResultText = '买家已拒签，物流确认退回，正在退款中';
  const orderProducts = normalizeOrderProducts(order);

  const transactionRes = await db.runTransaction(async (transaction) => {
    const caseItemsRes = await transaction.collection('after_sales_case_items').where({
      caseId: activeCase._id
    }).limit(100).get();

    // 本案申请明细全部进入待退款
    await Promise.all((caseItemsRes.data || []).map((item) =>
      transaction.collection('after_sales_case_items').doc(item._id).update({
        data: {
          itemStatus: 'pending_refund',
          approvedQty: Number(item.applyQty || 0),
          rejectedQty: 0,
          approvedRefundAmount: Number(item.applyRefundAmount || 0),
          approvedShippingRefundAmount: Number(item.applyShippingRefundAmount || 0) || 0,
          // 买家拒签=物流未完成的整单退款，不涉及买家责任扣减
          approvedShippingDeductionAmount: 0,
          processNote: finalResultText,
          updatedAt: now
        }
      })
    ));

    // 整单退款：为订单中其他没有有效售后明细的商品自动补待退款明细
    const allCaseItemsRes = await transaction.collection('after_sales_case_items').where({
      orderId: order._id
    }).limit(100).get();
    const validAllCaseItems = (allCaseItemsRes.data || []).filter((item) =>
      !['cancelled', 'rejected'].includes(String(item.itemStatus || ''))
    );
    const existingItemIndices = new Set(validAllCaseItems.map((item) => String(item.orderItemIndex)));
    console.log('现有售后商品索引:', existingItemIndices);
    console.log('订单商品数量:', orderProducts.length);

    for (let i = 0; i < orderProducts.length; i++) {
      const product = orderProducts[i];
      if (!existingItemIndices.has(String(i))) {
        const buyQty = product.buyQty || 1;
        const totalAmount = product.lineAmount || 0;
        await transaction.collection('after_sales_case_items').add({
          data: {
            caseId: activeCase._id,
            orderId: order._id,
            orderItemId: product.orderItemId,
            orderItemIndex: product.index,
            productId: product.productId,
            productNameSnapshot: product.productName,
            coverImageSnapshot: product.coverImage || '',
            afterSalesType: 'refund_not_received',
            applyQty: buyQty,
            applyRefundAmount: totalAmount,
            itemStatus: 'pending_refund',
            approvedQty: buyQty,
            approvedRefundAmount: totalAmount,
            unitPriceSnapshot: product.unitPrice || 0,
            payableAmountSnapshot: totalAmount,
            processNote: '买家已拒签，订单全部商品待退款',
            createdAt: now,
            updatedAt: now
          }
        });
      }
    }

    // 兜底：买家拒签=物流未完成的整单退款，若申请明细未承载运费（历史数据/异常入口），
    // 在本案第一条明细上补挂应退运费（运费整单只退一次）
    const postRefusedCaseItemsRes = await transaction.collection('after_sales_case_items').where({
      caseId: activeCase._id
    }).limit(100).get();
    const postRefusedCaseItems = postRefusedCaseItemsRes.data || [];
    const postRefusedAllItemsRes = await transaction.collection('after_sales_case_items').where({
      orderId: order._id
    }).limit(100).get();
    const refusedShippingFee = getOrderShippingFee(order, orderProducts);
    const refusedCommittedShipping = calcCommittedShippingRefund(postRefusedAllItemsRes.data || []);
    const refusedShippingToRefund = roundAmount(refusedShippingFee - refusedCommittedShipping);
    if (postRefusedCaseItems.length > 0 && refusedShippingToRefund > REFUND_AMOUNT_TOLERANCE) {
      const carrier = postRefusedCaseItems[0];
      await transaction.collection('after_sales_case_items').doc(carrier._id).update({
        data: {
          applyShippingRefundAmount: Math.max(Number(carrier.applyShippingRefundAmount || 0) || 0, refusedShippingToRefund),
          approvedShippingRefundAmount: refusedShippingToRefund,
          // 买家拒签整单退款不扣减运费
          approvedShippingDeductionAmount: 0,
          updatedAt: now
        }
      });
    }

    // 操作日志
    await transaction.collection('after_sales_logs').add({
      data: {
        caseId: activeCase._id,
        orderId: order._id,
        operatorId: params?.operatorId || '',
        operatorType: params?.operatorType || 'admin',
        action: 'refused_delivery_approved',
        beforeStatus,
        afterStatus: 'pending_refund',
        note: finalResultText,
        extra: {
          caseNo: activeCase.caseNo,
          refusedCaseId: refusedCaseId || ''
        },
        createdAt: now
      }
    });

    const latestCaseItemsRes = await transaction.collection('after_sales_case_items').where({
      caseId: activeCase._id
    }).limit(100).get();
    const caseItems = latestCaseItemsRes.data || [];

    const allOrderCaseItemsRes = await transaction.collection('after_sales_case_items').where({
      orderId: order._id
    }).limit(100).get();
    const allOrderCaseItems = allOrderCaseItemsRes.data || [];

    const caseStatus = calcCaseStatusFromItems(caseItems);
    // 打款总额（含寄回补偿，用于创建退款记录）；展示口径 approvedDisplayAmount 不含补偿
    const approvedAmount = calcCaseApprovedTotalAmount(caseItems);
    const approvedDisplayAmount = calcCaseApprovedRefundAmount(caseItems);
    const refundedAmount = calcCaseRefundedRefundAmount(caseItems);

    const orderStatusInfo = mapCaseStatusToOrderStatus(caseStatus, order.status, allOrderCaseItems, order.products);

    const totalApplyQty = caseItems.reduce((sum, item) => sum + (Number(item.applyQty || 0) || 0), 0);
    const totalApplyAmount = roundAmount(caseItems.reduce((sum, item) => sum + (Number(item.applyRefundAmount || 0) || 0), 0));
    const caseItemCount = caseItems.length;

    if (caseStatus === 'pending_refund') {
      await transaction.collection('after_sales_logs').add({
        data: {
          caseId: activeCase._id,
          orderId: order._id,
          operatorId: params?.operatorId || '',
          operatorType: params?.operatorType || 'admin',
          action: 'after_sales_pending_refund',
          beforeStatus,
          afterStatus: caseStatus,
          note: '买家拒签退回，售后进入待退款流程',
          extra: {
            caseNo: activeCase.caseNo
          },
          createdAt: now
        }
      });
    }

    await transaction.collection('after_sales_cases').doc(activeCase._id).update({
      data: {
        caseStatus,
        refundSummary: {
          requestedAmount: Number(activeCase?.refundSummary?.requestedAmount || activeCase.totalApplyAmount || 0) || 0,
          approvedAmount: approvedDisplayAmount,
          refundedAmount
        },
        totalApplyQty,
        totalApplyAmount,
        itemCount: caseItemCount,
        processSummary: {
          result: finalResultText,
          processTime: now,
          operatorType: 'admin'
        },
        updatedAt: now
      }
    });

    const orderUpdateData = buildOrderUpdateForAfterSales(order, allOrderCaseItems, now);
    await transaction.collection('orders').doc(order._id).update({
      data: orderUpdateData
    });

    return { caseStatus, orderStatusInfo, approvedAmount, orderUpdateData };
  });

  console.log('=== 买家拒签同意退款（事务已提交）===');

  if (transactionRes.caseStatus === 'pending_refund') {
    const approvedAmount = roundAmount(transactionRes.approvedAmount || 0);
    if (approvedAmount > 0) {
      try {
        const refundRes = await cloud.callFunction({
          name: 'refund',
          data: {
            action: 'create',
            orderId: order._id,
            caseId: activeCase._id,
            amount: approvedAmount,
            outTradeNo: order.outTradeNo || order.tradeNo || '',
            reason: finalResultText
          }
        });
        if (!refundRes.result?.success) {
          console.error('拒签路径待退款记录创建失败:', refundRes.result?.error || '未知错误');
        }
      } catch (refundErr) {
        console.error('调用退款云函数异常:', refundErr);
      }
    }
  }

  return {
    newStatus: transactionRes.orderUpdateData?.status || transactionRes.orderStatusInfo.status,
    afterSalesStatus: transactionRes.orderUpdateData?.afterSalesStatus || transactionRes.orderStatusInfo.afterSalesStatus,
    caseId: activeCase._id,
    caseStatus: transactionRes.caseStatus,
    updatedAt: now
  };
}

/**
 * 处理提交退货单号操作
 */
async function handleSubmitReturnTrackingOperation(order, params) {
  console.log('=== 提交退货单号 ===');
  console.log('订单ID:', order._id);
  console.log('处理参数:', params);
  
  const activeCase = await getActiveAfterSalesCaseByOrder(order, params);
  if (!activeCase) {
    console.error('未找到有效的售后单');
    throw new Error('当前订单没有售后申请或售后申请已经处理完成');
  }
  console.log('找到售后单:', activeCase._id, '状态:', activeCase.caseStatus);

  if (activeCase.caseStatus !== 'waiting_buyer_return') {
    throw new Error('当前状态不允许提交退货单号，只有待买家寄回状态才能提交');
  }

  const trackingNumber = String(params?.trackingNumber || '').trim();
  const companyCode = String(params?.companyCode || '').trim();
  const companyName = String(params?.companyName || '').trim();
  
  if (!trackingNumber) {
    throw new Error('请填写退货单号');
  }
  
  if (!companyCode) {
    throw new Error('请选择快递公司');
  }

  const now = new Date();
  // 运单号去重结果需透传到事务外（用于响应提示），在事务外先声明
  let dedupResult = { duplicated: false, duplicateCaseNo: '', suspendedCount: 0 };

  const transactionRes = await db.runTransaction(async (transaction) => {
    const caseItemsRes = await transaction.collection('after_sales_case_items').where({
      caseId: activeCase._id
    }).limit(100).get();
    const caseItems = caseItemsRes.data || [];

    // 寄回运费补偿与运单绑定：同订单内同一运单号只补偿一次，重复单号自动挂起本单补偿
    const duplicateCase = await findDuplicateReturnTrackingCase(
      transaction, order._id, trackingNumber, activeCase._id
    );
    let suspendedCount = 0;
    if (duplicateCase) {
      suspendedCount = await suspendCaseReturnShippingCompensation(transaction, caseItems, now);
      if (suspendedCount > 0) {
        await transaction.collection('after_sales_logs').add({
          data: {
            caseId: activeCase._id,
            orderId: order._id,
            operatorId: params?.operatorId || '',
            operatorType: params?.operatorType || 'user',
            action: 'return_compensation_dedup',
            beforeStatus: 'waiting_seller_receive',
            afterStatus: 'waiting_seller_receive',
            note: `运单号 ${trackingNumber} 已用于售后单 ${duplicateCase.caseNo || ''}，寄回运费不重复补偿，本单补偿已取消`,
            extra: {
              caseNo: activeCase.caseNo,
              trackingNumber,
              duplicateCaseId: duplicateCase._id,
              duplicateCaseNo: duplicateCase.caseNo || ''
            },
            createdAt: now
          }
        });
      }
    }
    dedupResult = {
      duplicated: !!duplicateCase,
      duplicateCaseNo: duplicateCase?.caseNo || '',
      suspendedCount
    };

    await Promise.all(caseItems.map((item) => {
      return transaction.collection('after_sales_case_items').doc(item._id).update({
        data: {
          itemStatus: 'waiting_seller_receive',
          updatedAt: now
        }
      });
    }));

    await transaction.collection('after_sales_logs').add({
      data: {
        caseId: activeCase._id,
        orderId: order._id,
        operatorId: params?.operatorId || '',
        operatorType: params?.operatorType || 'user',
        action: 'submit_return_tracking',
        beforeStatus: 'waiting_buyer_return',
        afterStatus: 'waiting_seller_receive',
        note: `已提交退货单号: ${trackingNumber}`,
        extra: {
          caseNo: activeCase.caseNo,
          trackingNumber,
          companyCode,
          companyName
        },
        createdAt: now
      }
    });

    const totalApplyQty = caseItems.reduce((sum, item) => sum + (Number(item.applyQty || 0) || 0), 0);
    const totalApplyAmount = roundAmount(caseItems.reduce((sum, item) => sum + (Number(item.applyRefundAmount || 0) || 0), 0));
    const caseItemCount = caseItems.length;

    await transaction.collection('after_sales_cases').doc(activeCase._id).update({
      data: {
        caseStatus: 'waiting_seller_receive',
        returnLogisticsInfo: {
          trackingNumber: trackingNumber,
          companyCode: companyCode,
          companyName: companyName
        },
        // 运单号重复标记（详情页展示"为何本单没有寄回补偿"）；无重复或本单本就无补偿时清空历史标记
        returnCompensationDedup: (duplicateCase && suspendedCount > 0) ? {
          trackingNumber,
          normalizedTrackingNumber: normalizeReturnTrackingNo(trackingNumber),
          duplicateCaseId: duplicateCase._id,
          duplicateCaseNo: duplicateCase.caseNo || '',
          suspended: true,
          updatedAt: now
        } : null,
        totalApplyQty,
        totalApplyAmount,
        itemCount: caseItemCount,
        updatedAt: now
      }
    });

    await transaction.collection('orders').doc(order._id).update({
      data: {
        updatedAt: now,
        updatedAtTs: now.getTime()
      }
    });

    return { caseStatus: 'waiting_seller_receive', dedup: dedupResult };
  });

  console.log('=== 提交退货单号（事务已提交）===');

  try {
    const logisticsRes = await cloud.callFunction({
      name: 'express100',
      data: {
        action: 'queryReturnLogisticsAndUpdateCase',
        expressNo: trackingNumber,
        companyCode: companyCode,
        caseId: activeCase._id,
        forceRefresh: true
      }
    });
    console.log('退货物流查询结果:', logisticsRes.result);
  } catch (error) {
    console.error('自动查询退货物流失败:', error);
  }

  return {
    caseId: activeCase._id,
    caseStatus: transactionRes.caseStatus,
    trackingNumber,
    companyCode,
    companyName,
    compensationDuplicated: dedupResult.duplicated,
    duplicateCaseNo: dedupResult.duplicateCaseNo,
    compensationSuspendedCount: dedupResult.suspendedCount,
    updatedAt: now
  };
}

async function handleModifyReturnTrackingOperation(order, params) {
  console.log('=== 修改退货单号 ===');
  console.log('订单ID:', order._id);
  console.log('处理参数:', params);
  
  const activeCase = await getActiveAfterSalesCaseByOrder(order, params);
  if (!activeCase) {
    console.error('未找到有效的售后单');
    throw new Error('当前订单没有售后申请或售后申请已经处理完成');
  }
  console.log('找到售后单:', activeCase._id, '状态:', activeCase.caseStatus);

  if (activeCase.caseStatus !== 'waiting_seller_receive') {
    throw new Error('当前状态不允许修改退货单号，只有待商家收货状态才能修改');
  }

  const trackingNumber = String(params?.trackingNumber || '').trim();
  const companyCode = String(params?.companyCode || '').trim();
  const companyName = String(params?.companyName || '').trim();
  
  if (!trackingNumber) {
    throw new Error('请填写退货单号');
  }
  
  if (!companyCode) {
    throw new Error('请选择快递公司');
  }

  const now = new Date();
  // 运单号去重结果需透传到事务外（用于响应提示），在事务外先声明
  let dedupResult = { duplicated: false, restored: false, duplicateCaseNo: '', changedCount: 0 };

  const transactionRes = await db.runTransaction(async (transaction) => {
    const caseItemsRes = await transaction.collection('after_sales_case_items').where({
      caseId: activeCase._id
    }).limit(100).get();
    const caseItems = caseItemsRes.data || [];

    // 寄回运费补偿随新单号重新判定：重复→挂起；不重复且此前被挂起→自动恢复
    const duplicateCase = await findDuplicateReturnTrackingCase(
      transaction, order._id, trackingNumber, activeCase._id
    );
    let changedCount = 0;
    if (duplicateCase) {
      changedCount = await suspendCaseReturnShippingCompensation(transaction, caseItems, now);
      if (changedCount > 0) {
        await transaction.collection('after_sales_logs').add({
          data: {
            caseId: activeCase._id,
            orderId: order._id,
            operatorId: params?.operatorId || '',
            operatorType: params?.operatorType || 'user',
            action: 'return_compensation_dedup',
            beforeStatus: 'waiting_seller_receive',
            afterStatus: 'waiting_seller_receive',
            note: `修改后的运单号 ${trackingNumber} 已用于售后单 ${duplicateCase.caseNo || ''}，寄回运费不重复补偿，本单补偿已取消`,
            extra: {
              caseNo: activeCase.caseNo,
              trackingNumber,
              duplicateCaseId: duplicateCase._id,
              duplicateCaseNo: duplicateCase.caseNo || ''
            },
            createdAt: now
          }
        });
      }
    } else {
      changedCount = await restoreCaseReturnShippingCompensation(transaction, caseItems, now);
      if (changedCount > 0) {
        await transaction.collection('after_sales_logs').add({
          data: {
            caseId: activeCase._id,
            orderId: order._id,
            operatorId: params?.operatorId || '',
            operatorType: params?.operatorType || 'user',
            action: 'return_compensation_restore',
            beforeStatus: 'waiting_seller_receive',
            afterStatus: 'waiting_seller_receive',
            note: `修改后的运单号 ${trackingNumber} 无重复，此前取消的寄回运费补偿已恢复`,
            extra: { caseNo: activeCase.caseNo, trackingNumber },
            createdAt: now
          }
        });
      }
    }
    dedupResult = {
      duplicated: !!duplicateCase,
      restored: !duplicateCase && changedCount > 0,
      duplicateCaseNo: duplicateCase?.caseNo || '',
      changedCount
    };

    await transaction.collection('after_sales_logs').add({
      data: {
        caseId: activeCase._id,
        orderId: order._id,
        operatorId: params?.operatorId || '',
        operatorType: params?.operatorType || 'user',
        action: 'modify_return_tracking',
        beforeStatus: 'waiting_seller_receive',
        afterStatus: 'waiting_seller_receive',
        note: `已修改退货单号: ${trackingNumber}`,
        extra: {
          caseNo: activeCase.caseNo,
          previousTrackingNumber: activeCase.returnTrackingNumber,
          trackingNumber,
          companyCode,
          companyName
        },
        createdAt: now
      }
    });

    const totalApplyQty = caseItems.reduce((sum, item) => sum + (Number(item.applyQty || 0) || 0), 0);
    const totalApplyAmount = roundAmount(caseItems.reduce((sum, item) => sum + (Number(item.applyRefundAmount || 0) || 0), 0));
    const caseItemCount = caseItems.length;

    await transaction.collection('after_sales_cases').doc(activeCase._id).update({
      data: {
        returnLogisticsInfo: {
          trackingNumber: trackingNumber,
          companyCode: companyCode,
          companyName: companyName,
          // 清空旧单号的物流状态，等下次查看物流时重新查询填充
          state: '',
          stateName: '',
          isCheck: '',
          lastGetTime: null,
          checkTime: ''
        },
        // 重复且实际挂起了补偿→标记；不重复（含恢复）或本单无补偿→清除标记
        returnCompensationDedup: (duplicateCase && changedCount > 0) ? {
          trackingNumber,
          normalizedTrackingNumber: normalizeReturnTrackingNo(trackingNumber),
          duplicateCaseId: duplicateCase._id,
          duplicateCaseNo: duplicateCase.caseNo || '',
          suspended: true,
          updatedAt: now
        } : null,
        totalApplyQty,
        totalApplyAmount,
        itemCount: caseItemCount,
        updatedAt: now
      }
    });

    await transaction.collection('orders').doc(order._id).update({
      data: {
        updatedAt: now,
        updatedAtTs: now.getTime()
      }
    });

    return { caseStatus: 'waiting_seller_receive', dedup: dedupResult };
  });

  console.log('=== 修改退货单号（事务已提交）===');

  try {
    const logisticsRes = await cloud.callFunction({
      name: 'express100',
      data: {
        action: 'queryReturnLogisticsAndUpdateCase',
        expressNo: trackingNumber,
        companyCode: companyCode,
        caseId: activeCase._id,
        forceRefresh: true
      }
    });
    console.log('修改退货单号后物流查询结果:', logisticsRes.result);
  } catch (error) {
    console.error('修改退货单号后自动查询物流失败:', error);
  }

  return {
    caseId: activeCase._id,
    caseStatus: transactionRes.caseStatus,
    trackingNumber,
    companyCode,
    companyName,
    compensationDuplicated: dedupResult.duplicated && dedupResult.changedCount > 0,
    compensationRestored: dedupResult.restored,
    duplicateCaseNo: dedupResult.duplicateCaseNo,
    compensationChangedCount: dedupResult.changedCount,
    updatedAt: now
  };
}
