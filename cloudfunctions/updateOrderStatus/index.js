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
    qualityAfterSalesDays: 15
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

    return {
      autoConfirmReceiptDays: autoConfirmReceiptDays > 0 ? autoConfirmReceiptDays : defaults.autoConfirmReceiptDays,
      supportNoReasonReturn: supportNoReasonReturnRefund,
      supportNoReasonReturnRefund,
      supportQualityRefund,
      supportQualityExchange,
      noReasonReturnDays: noReasonReturnDays > 0 ? noReasonReturnDays : defaults.noReasonReturnDays,
      normalAfterSalesDays: normalAfterSalesDays > 0 ? normalAfterSalesDays : defaults.normalAfterSalesDays,
      qualityAfterSalesDays: qualityAfterSalesDays > 0 ? qualityAfterSalesDays : defaults.qualityAfterSalesDays
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

// 根据原因判断运费承担
function getShippingResponsibilityByReason(reasonCode, type) {
  // 7天无理由换货由买家承担运费
  if (reasonCode === 'seven_day_no_reason') {
    return 'buyer';
  }
  // 质量原因由卖家承担
  if (QUALITY_REASONS.includes(reasonCode)) {
    return 'seller';
  }
  // 其他原因（换货默认）由卖家承担
  return 'seller';
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

async function getReservedAfterSalesQtyMap(orderId) {
  const result = await db.collection('after_sales_case_items').where({
    orderId
  }).limit(100).get();

  const qtyMap = {};
  const items = Array.isArray(result.data) ? result.data : [];
  items.forEach((item) => {
    const status = String(item.itemStatus || '').trim();
    if (status === 'cancelled' || status === 'rejected') {
      return;
    }
    const orderItemId = String(item.orderItemId || '');
    if (!orderItemId) {
      return;
    }
    qtyMap[orderItemId] = (qtyMap[orderItemId] || 0) + (Number(item.applyQty || 0) || 0);
  });

  return qtyMap;
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

// 售后类型常量
const EXCHANGE_TYPES = ['exchange', 'quality_exchange'];
const REFUND_TYPES = ['refund', 'quality_refund', 'return_refund', 'quality_return_refund', 'refund_received', 'refund_not_received'];

/**
 * 根据售后明细的 afterSalesType 生成标准化的 afterSalesResult 文案
 * 规则参考淘宝：
 * - 全部换货 → "换货完成"
 * - 全部退款（各种退款类型） → "退款完成"
 * - 混合类型（部分退款+部分换货） → "部分退款"
 */
function buildAfterSalesResult(caseItems, orderProducts) {
  if (!caseItems || caseItems.length === 0) return '';

  // 只看有效的售后明细（排除已取消/已拒绝）
  const validItems = caseItems.filter(item => !['cancelled', 'rejected'].includes(String(item.itemStatus || '')));
  if (validItems.length === 0) return '';

  const exchangeCount = validItems.filter(item => EXCHANGE_TYPES.includes(String(item.afterSalesType || ''))).length;
  const refundCount = validItems.filter(item => REFUND_TYPES.includes(String(item.afterSalesType || ''))).length;

  const totalApprovedRefundAmount = validItems.reduce((sum, item) => sum + (Number(item.approvedRefundAmount || 0) || 0), 0);

  // 全部换货
  if (exchangeCount > 0 && refundCount === 0) {
    return '换货完成';
  }
  // 全部退款
  if (refundCount > 0 && exchangeCount === 0) {
    if (totalApprovedRefundAmount > 0) {
      return '退款完成';
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
    return '退款完成';
  }
  return '售后完成';
}

function mapCaseStatusToOrderStatus(caseStatus, originalOrderStatus, caseItems, orderProducts) {
  if (caseStatus === 'completed') {
    // 检查是否所有商品都完成了售后
    const completedItemCount = caseItems.filter(item => String(item.itemStatus || '') === 'completed').length;
    const totalProductCount = orderProducts && orderProducts.length ? orderProducts.length : 1;

    // 检查是否有换货类型的售后
    const hasExchangeAfterSales = caseItems.some(item => EXCHANGE_TYPES.includes(String(item.afterSalesType || '')));

    // 计算实际退款金额：验货不通过导致商家寄回商品的情况，退款金额为0，不应标记为退款完成
    const totalApprovedRefundAmount = caseItems.reduce((sum, item) => sum + (Number(item.approvedRefundAmount || 0) || 0), 0);
    // 无退款金额时（验货不通过），订单状态恢复为已完成，而非退款完成
    const hasActualRefund = totalApprovedRefundAmount > 0;

    // 生成标准化的售后结果文案（用于订单详情/列表右上角显示）
    const afterSalesResult = buildAfterSalesResult(caseItems, orderProducts);

    // 如果所有商品都完成了售后（拦截成功的情况）
    if (completedItemCount >= totalProductCount) {
      // 换货完成或无退款金额的售后完成 → 订单状态恢复为已完成；有退款金额 → 退款完成
      return {
        status: (hasExchangeAfterSales || !hasActualRefund) ? 'completed' : 'refund_completed',
        afterSalesStatus: 'completed',
        afterSalesResult
      };
    }

    // 如果只有部分商品完成售后（拦截失败但同意申请的情况）
    // 检查是否所有商品都有售后记录（不管是进行中还是已完成）
    const hasAfterSalesIndices = new Set(caseItems.map(item => String(item.orderItemIndex)));
    const allProductsHaveAfterSales = orderProducts && orderProducts.length
      ? orderProducts.every((_, index) => hasAfterSalesIndices.has(String(index)))
      : true;

    // 如果所有商品都有售后记录
    if (allProductsHaveAfterSales) {
      // 换货完成或无退款金额的售后完成 → 订单状态恢复为已完成；有退款金额 → 退款完成
      return {
        status: (hasExchangeAfterSales || !hasActualRefund) ? 'completed' : 'refund_completed',
        afterSalesStatus: 'completed',
        afterSalesResult
      };
    }

    // 如果还有商品没有售后记录，恢复订单状态，允许其他商品继续申请售后
    if (originalOrderStatus === 'refund' || originalOrderStatus === 'afterSales') {
      return {
        status: 'shipping',
        afterSalesStatus: 'completed',
        afterSalesResult
      };
    }

    // 其他部分完成的情况，订单状态保持不变
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
  const approvedAmount = roundAmount(caseItems.reduce((sum, item) => sum + (Number(item.approvedRefundAmount || 0) || 0), 0));
  console.log('计算出的approvedAmount:', approvedAmount);
  const refundedAmount = roundAmount(caseItems
    .filter((item) => String(item.itemStatus || '') === 'completed')
    .reduce((sum, item) => sum + (Number(item.approvedRefundAmount || 0) || 0), 0));

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
  const orderUpdateData = {
    updatedAt: now
  };
  
  // 如果售后被拒绝或取消，且订单有 originalStatusBeforeRefund，恢复原状态
  if ((caseStatus === 'cancelled' || caseStatus === 'rejected') && order.originalStatusBeforeRefund) {
    orderUpdateData.status = order.originalStatusBeforeRefund;
    orderUpdateData.afterSalesStatus = 'cancelled';
    console.log('售后被拒绝/取消，恢复订单原状态:', order.originalStatusBeforeRefund);
  } else if (caseStatus === 'completed' && order.originalStatusBeforeRefund) {
    // 如果售后完成，检查是否需要恢复原状态
    // 需要检查订单的所有售后明细，而不是当前售后单的售后明细
    
    // 获取订单的所有售后明细
    const allOrderCaseItemsRes = await db.collection('after_sales_case_items').where({
      orderId: order._id
    }).limit(100).get();
    const allOrderCaseItems = allOrderCaseItemsRes.data || [];
    
    const completedItemCount = allOrderCaseItems.filter(item => String(item.itemStatus || '') === 'completed').length;
    const totalProductCount = order.products && order.products.length ? order.products.length : 1;
    
    // 检查是否所有商品都有有效的售后记录（排除已取消的记录）
    // 已取消的售后记录不算，因为用户放弃了售后，商品应该还能继续申请售后
    const validCaseItems = allOrderCaseItems.filter(item => !['cancelled', 'rejected'].includes(String(item.itemStatus || '')));
    const hasValidAfterSalesIndices = new Set(validCaseItems.map(item => String(item.orderItemIndex)));
    const allProductsHaveValidAfterSales = order.products && order.products.length 
      ? order.products.every((_, index) => hasValidAfterSalesIndices.has(String(index)))
      : true;
    
    console.log('=== 订单状态更新检查 ===');
    console.log('completedItemCount:', completedItemCount);
    console.log('totalProductCount:', totalProductCount);
    console.log('allProductsHaveValidAfterSales:', allProductsHaveValidAfterSales);
    
    // 如果不是所有商品都完成售后，且不是所有商品都有有效的售后记录，恢复原状态
    if (completedItemCount < totalProductCount && !allProductsHaveValidAfterSales) {
      orderUpdateData.status = order.originalStatusBeforeRefund;
      orderUpdateData.afterSalesStatus = 'completed';
      console.log('售后完成但还有商品未完成售后，恢复订单原状态:', order.originalStatusBeforeRefund);
    } else {
      orderUpdateData.status = orderStatusInfo.status;
      console.log('所有商品都已完成售后或都有有效售后记录，订单状态更新为:', orderStatusInfo.status);
    }

    // 售后完成时，使用标准化的 afterSalesResult（基于售后明细类型生成）
    if (orderStatusInfo.afterSalesResult) {
      orderUpdateData.afterSalesResult = orderStatusInfo.afterSalesResult;
      orderUpdateData.afterSalesProcessTime = now;
      orderUpdateData.afterSalesStatus = orderStatusInfo.afterSalesStatus;
      console.log('设置标准化售后结果文案:', orderStatusInfo.afterSalesResult);
    }
  } else {
    orderUpdateData.status = orderStatusInfo.status;
    // 售后完成时优先使用标准化文案，否则使用操作员输入的文本
    const finalResultText = orderStatusInfo.afterSalesResult || resultText;
    if (finalResultText) {
      orderUpdateData.afterSalesResult = finalResultText;
      orderUpdateData.afterSalesProcessTime = now;
      orderUpdateData.afterSalesStatus = orderStatusInfo.afterSalesStatus;
    }
  }
  
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

  const activeStatuses = ['submitted', 'pending', 'reviewing', 'waiting_buyer_return', 'waiting_seller_receive', 'pending_refund', 'intercepting'];
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
              processScenario = 'after_sales_auto_confirm_return_received';
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
            // 管理员验货不通过 → 通知用户
            processScenario = 'after_sales_inspect_fail';
          } else if (processItemAction === 'fill_return_tracking') {
            // 管理员填写寄回单号 → 通知用户
            processScenario = 'after_sales_fill_return_tracking';
            processData.trackingNumber = params.trackingNumber || '';
          } else if (processItemAction === 'confirm_return_received') {
            // 用户确认收到寄回商品 → 通知用户（确认）+ 通知管理员
            processScenario = 'after_sales_confirm_return_received';
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
          status: 'refund',
          orderNumber: order.orderNumber,
          result: '正在拦截快递',
          deliveryType: order.deliveryType
        };
        notificationTargets = [order._openid];
        break;

      case 'completeIntercepting':
        updateResult = await handleCompleteInterceptingOperation(order, params);
        notificationData = {
          status: 'refund_completed',
          orderNumber: order.orderNumber,
          result: params.result || '',
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
          } else {
            const actionMap = {
              'pay': 'pay',
              'ship': 'ship',
              'deliver': 'deliver',
              'confirm': 'confirm_receipt',
              'cancel': 'cancel',
              'applyAfterSales': 'apply_after_sales'
            };
            // cancelAfterSales、startIntercepting、completeIntercepting 等售后详细操作不写入订单操作日志
            if (!actionMap[operation]) {
              console.log('售后相关操作不写入订单操作日志:', operation);
              return;
            }
            action = actionMap[operation];
          }
          
          const detail = {
            ...params,
            jobId: updateResult.jobId || ''
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
            reason: params?.reason || params?.cancelReason || '',
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
  let allowedStatuses = [];
  
  switch (order.deliveryType) {
    case 'express':
    case 'local':
      allowedStatuses = ['shipping'];
      break;
    case 'pickup':
      allowedStatuses = ['paid'];
      break;
    default:
      throw new Error('未知的配送方式');
  }

  if (!allowedStatuses.includes(order.status)) {
    throw new Error('当前订单状态不允许确认收货');
  }

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
  if (order.status === 'completed' || order.status === 'cancelled') {
    throw new Error('当前订单状态不允许取消');
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

  return {
    newStatus: 'cancelled',
    updatedAt: now
  };
}

/**
 * 处理申请售后操作
 */
async function handleApplyAfterSalesOperation(order, params) {
  // 允许的订单状态：已完成、售后中、已签收、配送中
  const allowedStatuses = ['completed', 'refund', 'delivered', 'shipping'];
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
  const [activeItemsRes, reservedQtyMap, config] = await Promise.all([
    // 只查询 after_sales_case_items 表，因为这里已经包含了所有进行中的售后明细
    db.collection('after_sales_case_items').where({
      orderId: order._id,
      itemStatus: _.in(['submitted', 'reviewing', 'waiting_buyer_return', 'waiting_seller_receive', 'pending_refund', 'intercepting'])
    }).get(),
    getReservedAfterSalesQtyMap(order._id),
    getServiceTimeConfig()
  ]);
  
  // 从查询结果中提取进行中的商品索引
  const activeItemIndices = new Set();
  activeItemsRes.data.forEach(item => {
    if (item.orderItemIndex !== undefined) {
      activeItemIndices.add(item.orderItemIndex);
    }
  });

  // 判断是否已确认收货（交易成功）
  // 已确认收货状态：completed（已完成）、refund（售后中）
  // 未确认收货状态：shipping（配送中）、delivered（已签收）
  const isTransactionCompleted = ['completed', 'refund'].includes(order.status);
  
  let baseTime;
  let defaultAllowDays;
  
  if (isTransactionCompleted) {
    // 交易成功后：优先使用签收时间，回退到确认收货时间（签收后7天/15天）
    baseTime = parseFlexibleDate(order?.logisticsState?.checkTime) || parseFlexibleDate(order?.receiptTime);
    defaultAllowDays = { normal: 7, quality: 15 };
  } else {
    // 交易成功前：使用发货时间（发货后10天）
    baseTime = parseFlexibleDate(order?.shippingTime);
    defaultAllowDays = { normal: 10, quality: 15 };
  }

  const now = new Date();
  console.log('售后时效校验:', {
    checkTime: order?.logisticsState?.checkTime,
    receiptTime: order?.receiptTime,
    shippingTime: order?.shippingTime,
    baseTime: baseTime?.toISOString(),
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

    // 检查该商品是否已有进行中的售后
    const orderItemIndex = Number(selectedItem.orderItemIndex) || index;
    if (activeItemIndices.has(orderItemIndex)) {
      throw new Error(`商品 ${matchedOrderItem.productName} 已有进行中的售后申请`);
    }

    const applyQty = Number(selectedItem.applyQty || 0);
    if (!applyQty || applyQty < 1) {
      throw new Error(`商品 ${matchedOrderItem.productName} 的售后数量不合法`);
    }

    const reservedQty = Number(reservedQtyMap[orderItemId] || 0);
    const availableQty = matchedOrderItem.buyQty - reservedQty;
    if (applyQty > availableQty) {
      throw new Error(`商品 ${matchedOrderItem.productName} 最多还可申请 ${availableQty} 件售后`);
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
    
    console.log('=== 售后时效判断日志 ===');
    console.log('订单ID:', order._id);
    console.log('订单状态:', order.status);
    console.log('交易是否完成:', isTransactionCompleted);
    console.log('售后类型:', afterSalesType);
    console.log('允许天数:', allowDays);
    console.log('基准时间(baseTime):', baseTime ? baseTime.toISOString() : 'null');
    console.log('签收时间(checkTime):', order?.logisticsState?.checkTime);
    console.log('确认收货时间(receiptTime):', order?.receiptTime);
    console.log('发货时间(shippingTime):', order?.shippingTime);
    
    // allowDays = -1 表示无时间限制（如未收到货退款）
    if (allowDays >= 0 && baseTime) {
      // 从签收后的第二天开始计算（和前端保持一致）
      // baseTime是北京时间，从第二天0点开始计算
      const startDate = new Date(baseTime.getFullYear(), baseTime.getMonth(), baseTime.getDate() + 1, 0, 0, 0);
      
      const deadlineMs = startDate.getTime() + allowDays * 24 * 60 * 60 * 1000;
      const now = Date.now();
      
      console.log('计算起始时间(startDate):', startDate.toISOString());
      console.log('截止时间(deadlineMs):', new Date(deadlineMs).toISOString());
      console.log('当前时间(now):', new Date(now).toISOString());
      console.log('是否超时:', now > deadlineMs);
      console.log('========================');
      
      if (now > deadlineMs) {
        const remainingDays = Math.max(0, Math.ceil((deadlineMs - now) / (24 * 60 * 60 * 1000)));
        throw new Error(`商品 ${matchedOrderItem.productName} 已超过售后时效（${remainingDays > 0 ? '剩余' + remainingDays + '天' : '已过期'}）`);
      }
    }

    const applyRefundAmount = roundAmount(selectedItem.applyRefundAmount ?? calculateItemRefundAmount(matchedOrderItem, applyQty));
    return {
      ...matchedOrderItem,
      // 确保使用从参数传过来的正确索引
      index: orderItemIndex,
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
      allowDays
    };
  });

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
      itemCount: normalizedItems.length,
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
        afterSalesType: item.afterSalesType,
        shippingResponsibility: item.shippingResponsibility,
        reasonCode: item.reasonCode || '',
        reasonText: item.reasonText || params?.reason || '',
        itemStatus: item.itemStatus,
        needReturnGoods: item.needReturnGoods,
        needBuyerShip: item.needBuyerShip,
        evidenceRequired: item.evidenceRequired,
        allowDaysSnapshot: item.allowDays,
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
          totalApplyAmount
        },
        createdAt: now
      }
    });

    // 步骤4：更新订单状态
    const updateData = {
      status: 'refund',
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
  
  return {
    newStatus: 'refund',
    caseId,
    updatedAt: now
  };
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
    const processNote = params.result || '';

    if (itemAction === 'approve') {
      itemStatus = 'approved';
      approvedQty = Number(caseItem.applyQty || 0) || 0;
      rejectedQty = 0;
      approvedRefundAmount = Number(caseItem.approvedRefundAmount || 0) || 0;
    } else if (itemAction === 'reject') {
      itemStatus = 'rejected';
      approvedQty = 0;
      rejectedQty = Number(caseItem.applyQty || 0) || 0;
      approvedRefundAmount = 0;
    } else if (itemAction === 'complete') {
      itemStatus = 'completed';
      approvedQty = approvedQty > 0 ? approvedQty : (Number(caseItem.applyQty || 0) || 0);
      rejectedQty = 0;
      approvedRefundAmount = approvedRefundAmount > 0
        ? approvedRefundAmount
        : (Number(caseItem.applyRefundAmount || 0) || 0);
    } else if (itemAction === 'confirm_receipt') {
      itemStatus = 'seller_received';
      approvedQty = approvedQty > 0 ? approvedQty : (Number(caseItem.applyQty || 0) || 0);
      rejectedQty = 0;
      approvedRefundAmount = approvedRefundAmount > 0
        ? approvedRefundAmount
        : (Number(caseItem.applyRefundAmount || 0) || 0);
    } else if (itemAction === 'inspect_pass') {
      itemStatus = 'pending_refund';
      approvedQty = approvedQty > 0 ? approvedQty : (Number(caseItem.applyQty || 0) || 0);
      rejectedQty = 0;
      approvedRefundAmount = approvedRefundAmount > 0
        ? approvedRefundAmount
        : (Number(caseItem.applyRefundAmount || 0) || 0);
    } else if (itemAction === 'inspect_fail') {
      itemStatus = 'seller_returning';
      approvedQty = 0;
      rejectedQty = Number(caseItem.applyQty || 0) || 0;
      approvedRefundAmount = 0;
    } else if (itemAction === 'fill_return_tracking') {
      // 商家填写寄回物流单号
      itemStatus = 'buyer_receiving';
      approvedQty = 0;
      rejectedQty = Number(caseItem.applyQty || 0) || 0;
      approvedRefundAmount = 0;
    } else if (itemAction === 'confirm_return_received') {
      // 买家确认收到商家寄回的商品
      itemStatus = 'completed';
      approvedQty = 0;
      rejectedQty = Number(caseItem.applyQty || 0) || 0;
      approvedRefundAmount = 0;
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
      const approvedAmount = roundAmount(caseItems.reduce((sum, item) => sum + (Number(item.approvedRefundAmount || 0) || 0), 0));
      const refundedAmount = roundAmount(caseItems
        .filter((item) => String(item.itemStatus || '') === 'completed')
        .reduce((sum, item) => sum + (Number(item.approvedRefundAmount || 0) || 0), 0));

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
            refundedAmount
          },
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
      const orderUpdateData = {
        updatedAt: now,
        updatedAtTs: now.getTime()
      };

      if ((caseStatus === 'cancelled' || caseStatus === 'rejected') && order.originalStatusBeforeRefund) {
        orderUpdateData.status = order.originalStatusBeforeRefund;
        orderUpdateData.afterSalesStatus = 'cancelled';
      } else if (caseStatus === 'completed' && order.originalStatusBeforeRefund) {
        const completedItemCount = allOrderCaseItems.filter(item => String(item.itemStatus || '') === 'completed').length;
        const totalProductCount = order.products && order.products.length ? order.products.length : 1;
        const validCaseItems = allOrderCaseItems.filter(item => !['cancelled', 'rejected'].includes(String(item.itemStatus || '')));
        const hasValidAfterSalesIndices = new Set(validCaseItems.map(item => String(item.orderItemIndex)));
        const allProductsHaveValidAfterSales = order.products && order.products.length
          ? order.products.every((_, index) => hasValidAfterSalesIndices.has(String(index)))
          : true;

        if (completedItemCount < totalProductCount && !allProductsHaveValidAfterSales) {
          orderUpdateData.status = order.originalStatusBeforeRefund;
          orderUpdateData.afterSalesStatus = 'completed';
        } else {
          orderUpdateData.status = orderStatusInfo.status;
        }

        // 售后完成时，使用标准化的 afterSalesResult（基于售后明细类型生成）
        if (orderStatusInfo.afterSalesResult) {
          orderUpdateData.afterSalesResult = orderStatusInfo.afterSalesResult;
          orderUpdateData.afterSalesProcessTime = now;
          orderUpdateData.afterSalesStatus = orderStatusInfo.afterSalesStatus;
        }
      } else {
        orderUpdateData.status = orderStatusInfo.status;
        // 售后完成时优先使用标准化文案，否则使用操作员输入的文本
        const finalResultText = orderStatusInfo.afterSalesResult || processNote || actionLabelMap[itemAction];
        if (finalResultText) {
          orderUpdateData.afterSalesStatus = orderStatusInfo.afterSalesStatus || '';
          orderUpdateData.afterSalesResult = finalResultText;
          orderUpdateData.afterSalesProcessTime = now;
        }
      }

      await transaction.collection('orders').doc(order._id).update({
        data: orderUpdateData
      });

      return { caseStatus, orderStatusInfo, approvedRefundAmount };
    });

    console.log('=== 售后处理完成（事务已提交）===');

    // 如果案件状态为pending_refund（待退款）且有退款金额，创建待退款记录
    if (transactionRes.caseStatus === 'pending_refund') {
      const approvedAmount = roundAmount(caseItem.approvedRefundAmount || 0);
      if (approvedAmount > 0) {
        console.log('=== 创建待退款记录 ===');
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
              reason: processNote || '售后审核通过，待退款'
            }
          });
          console.log('待退款记录创建结果:', JSON.stringify(refundRes));
          if (!refundRes.result?.success) {
            console.error('待退款记录创建失败:', refundRes.result?.error || '未知错误');
          }
        } catch (refundErr) {
          console.error('调用退款云函数异常:', refundErr);
        }
      }
    }

    return {
      newStatus: transactionRes.orderStatusInfo.status,
      afterSalesStatus: transactionRes.orderStatusInfo.afterSalesStatus,
      caseId: activeCase._id,
      caseStatus: transactionRes.caseStatus,
      approvedAmount: transactionRes.approvedRefundAmount,
      itemAction: itemAction,
      afterSalesType: caseItem.afterSalesType || '',
      needReturnGoods: caseItem.needReturnGoods || false,
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
  
  // 在事务外查询其他进行中的售后单（因为需要读取其他文档）
  const activeStatuses = ['submitted', 'reviewing', 'waiting_buyer_return', 'waiting_seller_receive', 'pending_refund', 'pending', 'intercepting'];
  const otherActiveCases = await db.collection('after_sales_cases').where({
    orderId: order._id,
    caseStatus: _.in(activeStatuses),
    _id: _.neq(activeCase._id)
  }).get();
  const targetStatus = (otherActiveCases.data && otherActiveCases.data.length > 0) ? 'refund' : 'refund_completed';

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
        processNote: params.result || '售后处理完成',
        updatedAt: now,
        completedAt: now
      }
    })));

    // 查询订单的所有售后明细（更新后），用于生成标准化的售后结果文案
    const allOrderCaseItemsRes = await transaction.collection('after_sales_case_items').where({
      orderId: order._id
    }).limit(100).get();
    const allOrderCaseItems = allOrderCaseItemsRes.data || [];

    // 生成标准化的售后结果文案（基于售后明细类型）
    const standardResultText = buildAfterSalesResult(allOrderCaseItems, order.products);

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
    const updateData = {
      status: targetStatus,
      afterSalesStatus: 'completed',
      // 优先使用标准化文案，否则使用操作员输入的文本
      afterSalesResult: standardResultText || params.result || '',
      afterSalesProcessTime: now,
      updatedAt: now,
      updatedAtTs: now.getTime()
    };
    await transaction.collection('orders').doc(order._id).update({
      data: updateData
    });
  });

  return {
    newStatus: targetStatus,
    afterSalesStatus: 'completed',
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

  const now = new Date();
  
  // 确定订单应该恢复到什么状态（在事务外查询，因为需要读取其他文档）
  let targetStatus = order.status;
  if (order.status === 'refund') {
    const activeStatuses = ['submitted', 'reviewing', 'waiting_buyer_return', 'waiting_seller_receive', 'pending_refund', 'pending', 'intercepting'];
    const otherActiveCases = await db.collection('after_sales_cases').where({
      orderId: order._id,
      caseStatus: _.in(activeStatuses),
      _id: _.neq(activeCase._id)
    }).get();
    
    if (otherActiveCases.data && otherActiveCases.data.length > 0) {
      targetStatus = 'refund';
    } else {
      if (order.originalStatusBeforeRefund) {
        targetStatus = order.originalStatusBeforeRefund;
      } else if ((order.deliveryType || 'express') === 'express') {
        targetStatus = 'delivered';
      } else if ((order.deliveryType || 'express') === 'pickup') {
        targetStatus = 'completed';
      } else if ((order.deliveryType || 'express') === 'local') {
        targetStatus = 'delivered';
      }
    }
  }

  // 使用事务确保数据一致性
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
    const orderUpdateData = {
      status: targetStatus,
      afterSalesStatus: 'cancelled',
      afterSalesResult: params.result || '售后申请已取消',
      afterSalesProcessTime: now,
      updatedAt: now,
      updatedAtTs: now.getTime()
    };
    await transaction.collection('orders').doc(order._id).update({
      data: orderUpdateData
    });
  });

  return {
    newStatus: targetStatus,
    afterSalesStatus: 'cancelled',
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
 * 处理开始拦截操作
 */
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

  const itemId = String(params?.itemId || '').trim();
  const now = new Date();
  
  // 如果提供了itemId，更新单个明细
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
    const approvedAmount = roundAmount(caseItems.reduce((sum, item) => sum + (Number(item.approvedRefundAmount || 0) || 0), 0));
    const refundedAmount = roundAmount(caseItems
      .filter((item) => String(item.itemStatus || '') === 'completed')
      .reduce((sum, item) => sum + (Number(item.approvedRefundAmount || 0) || 0), 0));

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

    const orderUpdateData = {
      status: orderStatusInfo.status,
      afterSalesStatus: orderStatusInfo.afterSalesStatus || '',
      updatedAt: now,
      updatedAtTs: now.getTime()
    };
    await transaction.collection('orders').doc(order._id).update({
      data: orderUpdateData
    });

    return { caseStatus, orderStatusInfo };
  });

  console.log('=== 开始拦截完成（事务已提交）===');
  return {
    newStatus: transactionRes.orderStatusInfo.status,
    afterSalesStatus: transactionRes.orderStatusInfo.afterSalesStatus,
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
  
  let finalResultText = resultText;
  if (finalAction === 'approve' && isInterceptSuccess) {
    finalResultText = '拦截成功，订单退款完成';
  }

  const orderProducts = isInterceptSuccess ? normalizeOrderProducts(order) : [];

  const transactionRes = await db.runTransaction(async (transaction) => {
    const caseItemsRes = await transaction.collection('after_sales_case_items').where({
      caseId: activeCase._id
    }).limit(100).get();

    if (finalAction === 'approve' && isInterceptSuccess) {
      console.log('=== 拦截成功，处理订单所有商品 ===');
      
      const allCaseItemsRes = await transaction.collection('after_sales_case_items').where({
        orderId: order._id
      }).limit(100).get();
      
      await Promise.all((caseItemsRes.data || []).map((item) => {
        const approvedQty = Number(item.applyQty || 0);
        const approvedRefundAmount = Number(item.applyRefundAmount || 0);
        
        return transaction.collection('after_sales_case_items').doc(item._id).update({
          data: {
            itemStatus: 'completed',
            approvedQty,
            rejectedQty: 0,
            approvedRefundAmount,
            processNote: finalResultText,
            updatedAt: now,
            completedAt: now
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
          console.log('为商品索引', i, '创建售后完成记录');
          
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
              itemStatus: 'completed',
              approvedQty: buyQty,
              approvedRefundAmount: totalAmount,
              unitPriceSnapshot: product.unitPrice || 0,
              payableAmountSnapshot: totalAmount,
              processNote: '拦截成功，订单全部商品退款',
              createdAt: now,
              updatedAt: now,
              completedAt: now
            }
          });
        }
      }
    }
    
    const itemStatus = finalAction === 'approve' ? 'completed' : 'rejected';
    
    if (!(finalAction === 'approve' && isInterceptSuccess)) {
      await Promise.all((caseItemsRes.data || []).map((item) => {
        const approvedQty = finalAction === 'approve' ? Number(item.applyQty || 0) : 0;
        const rejectedQty = finalAction === 'reject' ? Number(item.applyQty || 0) : 0;
        const approvedRefundAmount = finalAction === 'approve' ? Number(item.applyRefundAmount || 0) : 0;
        
        return transaction.collection('after_sales_case_items').doc(item._id).update({
          data: {
            itemStatus,
            approvedQty,
            rejectedQty,
            approvedRefundAmount,
            processNote: finalResultText,
            updatedAt: now,
            completedAt: finalAction === 'approve' ? now : item.completedAt || null
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
    const approvedAmount = roundAmount(caseItems.reduce((sum, item) => sum + (Number(item.approvedRefundAmount || 0) || 0), 0));
    const refundedAmount = roundAmount(caseItems
      .filter((item) => String(item.itemStatus || '') === 'completed')
      .reduce((sum, item) => sum + (Number(item.approvedRefundAmount || 0) || 0), 0));

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
          result: finalResultText,
          processTime: now,
          operatorType: 'admin'
        },
        updatedAt: now,
        completedAt: caseStatus === 'completed' ? now : activeCase.completedAt || null
      }
    });

    const orderUpdateData = {
      updatedAt: now,
      updatedAtTs: now.getTime()
    };

    if ((caseStatus === 'cancelled' || caseStatus === 'rejected') && order.originalStatusBeforeRefund) {
      orderUpdateData.status = order.originalStatusBeforeRefund;
      orderUpdateData.afterSalesStatus = 'cancelled';
    } else if (caseStatus === 'completed' && order.originalStatusBeforeRefund) {
      const completedItemCount = allOrderCaseItems.filter(item => String(item.itemStatus || '') === 'completed').length;
      const totalProductCount = order.products && order.products.length ? order.products.length : 1;
      const validCaseItems = allOrderCaseItems.filter(item => !['cancelled', 'rejected'].includes(String(item.itemStatus || '')));
      const hasValidAfterSalesIndices = new Set(validCaseItems.map(item => String(item.orderItemIndex)));
      const allProductsHaveValidAfterSales = order.products && order.products.length
        ? order.products.every((_, index) => hasValidAfterSalesIndices.has(String(index)))
        : true;

      if (completedItemCount < totalProductCount && !allProductsHaveValidAfterSales) {
        orderUpdateData.status = order.originalStatusBeforeRefund;
        orderUpdateData.afterSalesStatus = 'completed';
      } else {
        orderUpdateData.status = orderStatusInfo.status;
      }

      // 售后完成时，使用标准化的 afterSalesResult（基于售后明细类型生成）
      if (orderStatusInfo.afterSalesResult) {
        orderUpdateData.afterSalesResult = orderStatusInfo.afterSalesResult;
        orderUpdateData.afterSalesProcessTime = now;
        orderUpdateData.afterSalesStatus = orderStatusInfo.afterSalesStatus;
      }
    } else {
      orderUpdateData.status = orderStatusInfo.status;
      orderUpdateData.afterSalesStatus = orderStatusInfo.afterSalesStatus || '';
      // 售后完成时优先使用标准化文案，否则使用操作员输入的文本
      orderUpdateData.afterSalesResult = orderStatusInfo.afterSalesResult || finalResultText;
      orderUpdateData.afterSalesProcessTime = now;
    }

    await transaction.collection('orders').doc(order._id).update({
      data: orderUpdateData
    });

    return { caseStatus, orderStatusInfo };
  });

  console.log('=== 完成拦截（事务已提交）===');
  return {
    newStatus: transactionRes.orderStatusInfo.status,
    afterSalesStatus: transactionRes.orderStatusInfo.afterSalesStatus,
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

  const transactionRes = await db.runTransaction(async (transaction) => {
    const caseItemsRes = await transaction.collection('after_sales_case_items').where({
      caseId: activeCase._id
    }).limit(100).get();
    const caseItems = caseItemsRes.data || [];

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

    return { caseStatus: 'waiting_seller_receive' };
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

  const transactionRes = await db.runTransaction(async (transaction) => {
    const caseItemsRes = await transaction.collection('after_sales_case_items').where({
      caseId: activeCase._id
    }).limit(100).get();
    const caseItems = caseItemsRes.data || [];

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

    return { caseStatus: 'waiting_seller_receive' };
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
    updatedAt: now
  };
}
