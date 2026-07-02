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
  return false;
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

function getAllowDaysForAfterSalesType(type, config) {
  // 未收到货退款没有时间限制
  if (type === 'refund_not_received') {
    return -1;
  }
  // 换货15天
  if (type === 'exchange') {
    return config.qualityAfterSalesDays || 15;
  }
  // 其他类型7天
  return config.normalAfterSalesDays || 7;
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

  const allClosed = statuses.every((status) => ['completed', 'rejected', 'cancelled'].includes(status));
  if (allClosed) {
    return 'completed';
  }

  if (statuses.some((status) => ['approved', 'processing', 'completed'].includes(status))) {
    return 'processing';
  }

  return 'reviewing';
}

function mapCaseStatusToOrderStatus(caseStatus, originalOrderStatus, caseItems, orderProducts) {
  if (caseStatus === 'completed') {
    // 检查是否所有商品都完成了售后
    const completedItemCount = caseItems.filter(item => String(item.itemStatus || '') === 'completed').length;
    const totalProductCount = orderProducts && orderProducts.length ? orderProducts.length : 1;
    
    // 如果所有商品都完成了售后（拦截成功的情况），订单状态变为退款完成
    if (completedItemCount >= totalProductCount) {
      return {
        status: 'refund_completed',
        afterSalesStatus: 'completed'
      };
    }
    
    // 如果只有部分商品完成售后（拦截失败但同意申请的情况）
    // 检查是否所有商品都有售后记录（不管是进行中还是已完成）
    const hasAfterSalesIndices = new Set(caseItems.map(item => String(item.orderItemIndex)));
    const allProductsHaveAfterSales = orderProducts && orderProducts.length 
      ? orderProducts.every((_, index) => hasAfterSalesIndices.has(String(index)))
      : true;
    
    // 如果所有商品都有售后记录，订单状态变为退款完成
    if (allProductsHaveAfterSales) {
      return {
        status: 'refund_completed',
        afterSalesStatus: 'completed'
      };
    }
    
    // 如果还有商品没有售后记录，恢复订单状态，允许其他商品继续申请售后
    if (originalOrderStatus === 'refund' || originalOrderStatus === 'afterSales') {
      return {
        status: 'shipping',
        afterSalesStatus: 'completed'
      };
    }
    
    // 其他部分完成的情况，订单状态保持不变
    return {
      status: originalOrderStatus,
      afterSalesStatus: 'completed'
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
    afterSalesStatus: caseStatus === 'processing' ? 'processing' : 'pending'
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
  } else {
    orderUpdateData.status = orderStatusInfo.status;
    // 如果有处理结果文本，设置售后结果
    if (resultText) {
      orderUpdateData.afterSalesResult = resultText;
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
  console.log('getActiveAfterSalesCaseByOrder 被调用');
  console.log('订单ID:', order._id);
  console.log('传入参数:', params);
  
  const preferredCaseId = String(params.caseId || '').trim();
  console.log('优先查找的售后单ID:', preferredCaseId);

  if (preferredCaseId) {
    const preferredRes = await db.collection('after_sales_cases').doc(preferredCaseId).get().catch(() => null);
    console.log('优先查找结果:', preferredRes ? preferredRes.data : '未找到');
    
    if (preferredRes && preferredRes.data && preferredRes.data.orderId === order._id) {
      console.log('找到匹配的优先售后单');
      return preferredRes.data;
    }
  }

  console.log('查找该订单的所有售后单...');
  const caseRes = await db.collection('after_sales_cases').where({
    orderId: order._id
  }).orderBy('createdAt', 'desc').limit(20).get();

  const activeStatuses = ['submitted', 'pending', 'reviewing', 'waiting_buyer_return', 'waiting_seller_receive', 'processing', 'intercepting'];
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
    console.log('附加参数:', params);

    // 验证参数
    if (!orderId || !operation) {
      console.error('参数验证失败');
      return {
        success: false,
        error: '订单ID和操作类型不能为空'
      };
    }

    // 获取订单信息
    const orderRes = await db.collection('orders').doc(orderId).get();
    if (!orderRes.data) {
      console.error('订单不存在');
      return {
        success: false,
        error: '订单不存在'
      };
    }

    const order = orderRes.data;
    console.log('当前订单状态:', order.status);
    console.log('配送方式:', order.deliveryType);

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
      case 'pay':
        updateResult = await handlePayOperation(order, params);
        notificationData = {
          status: 'paid',
          orderNumber: order.orderNumber,
          amount: order.totalAmount || order.totalPrice || 0,
          productName: order.products?.[0]?.productName || order.products?.[0]?.name || '商品',
          deliveryType: order.deliveryType
        };
        notificationTargets = Array.from(new Set([order._openid, ...adminOpenids]));
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
        notificationData = {
          status: 'refund',
          orderNumber: order.orderNumber,
          reason: params.reason || '',
          deliveryType: order.deliveryType
        };
        notificationTargets = Array.from(new Set([order._openid, ...adminOpenids]));
        break;

      case 'processAfterSales':
        updateResult = await handleProcessAfterSalesOperation(order, params);
        notificationData = {
          status: 'refund_completed',
          orderNumber: order.orderNumber,
          result: params.result || '',
          deliveryType: order.deliveryType
        };
        notificationTargets = [order._openid];
        break;

      case 'cancelAfterSales':
        updateResult = await handleCancelAfterSalesOperation(order, params);
        notificationData = {
          status: 'refund_completed',
          orderNumber: order.orderNumber,
          result: params.result || '售后申请已取消',
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
          console.log('通知发送成功');
        } catch (notificationError) {
          console.error('发送通知失败:', notificationError);
          // 通知发送失败不影响订单状态更新
        }
      });
    }

    console.log('=== 订单状态更新完成 ===');
    
    // 异步记录订单操作日志，不影响主流程
    if (updateResult && updateResult.newStatus) {
      setImmediate(async () => {
        try {
          const fromStatus = order.status;
          const toStatus = updateResult.newStatus;
          const { OPENID } = cloud.getWXContext();
          const operatorType = params?.operatorType || (await isAdmin(OPENID)) ? 'admin' : 'user';
          const operatorId = OPENID;
          const operatorName = operatorType === 'admin' ? await getAdminNickName(OPENID) : '';
          
          const actionMap = {
            'pay': 'pay',
            'ship': 'ship',
            'deliver': 'deliver',
            'confirm': 'confirm_receipt',
            'cancel': 'cancel',
            'applyAfterSales': 'apply_after_sales',
            'processAfterSales': 'process_after_sales',
            'cancelAfterSales': 'cancel_after_sales',
            'startIntercepting': 'start_intercepting',
            'completeIntercepting': 'complete_intercepting'
          };
          
          const action = actionMap[operation] || operation;
          
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
        orderId: orderId,
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
  const updateData = {
    status: 'shipping',
    shippingTime: now,
    updatedAt: now,
    updatedAtTs: now.getTime()
  };

  // 如果有物流单号，记录物流信息
  if (params.trackingNumber) {
    updateData.logisticsInfo = {
      trackingNumber: params.trackingNumber,
      companyCode: params.companyCode || '',
      companyName: params.companyName || '',
      updatedAt: now
    };
  }
  
  // 保存发货地址
  if (params.fromAddress) {
    updateData.fromAddress = params.fromAddress;
  }

  await db.collection('orders').doc(order._id).update({
    data: updateData
  });

  // 如果有物流单号，立即查询一次物流状态（同步执行）
  // 如果物流已签收，立即更新订单状态为 delivered
  if (params.trackingNumber) {
    try {
      const logisticsResult = await prefetchLogisticsAfterShip(order, params);
      
      // 如果查询成功且物流已签收，立即更新订单状态
      if (logisticsResult && logisticsResult.success) {
        const isDelivered = String(logisticsResult.isCheck) === '1';
        
        if (isDelivered) {
          const checkTime = normalizeCheckTimeValue(logisticsResult.arrivalTime);
          const logisticsStateUpdate = {
            state: logisticsResult.state || '',
            stateName: logisticsResult.stateName || '',
            isCheck: logisticsResult.isCheck || '',
            lastGetTime: new Date(),
            checkTime: checkTime || ''
          };

          const deliveryUpdateData = {
            status: 'delivered',
            deliveredAt: new Date(),
            logisticsState: logisticsStateUpdate,
            receiptConfirm: {
              type: 'pending',
              confirmedAt: null,
              confirmedBy: 'system',
              source: 'logistics_delivery'
            },
            updatedAt: new Date()
          };

          await db.collection('orders').doc(order._id).update({
            data: deliveryUpdateData
          });

          // 返回已签收状态
          return {
            newStatus: 'delivered',
            updatedAt: now
          };
        }
        
        // 如果物流未签收，保存物流状态但不更新订单状态
        const logisticsStateUpdate = {
          state: logisticsResult.state || '',
          stateName: logisticsResult.stateName || '',
          isCheck: logisticsResult.isCheck || '',
          lastGetTime: new Date()
        };
        
        await db.collection('orders').doc(order._id).update({
          data: {
            logisticsState: logisticsStateUpdate,
            updatedAt: new Date()
          }
        });
      }
    } catch (prefetchError) {
      // 物流查询失败不影响发货结果，记录日志即可
      console.error('发货后物流查询失败(不影响发货结果):', prefetchError);
    }
  }

  return {
    newStatus: 'shipping',
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
 * 处理取消订单操作
 */
async function handleCancelOperation(order, params) {
  if (order.status === 'completed' || order.status === 'cancelled') {
    throw new Error('当前订单状态不允许取消');
  }

  // 待支付和已支付订单在下单时已扣库存，取消时需要回补
  if (order.products && ['pending', 'paid'].includes(order.status)) {
    for (const product of order.products) {
      const productRes = await db.collection('products').doc(product.productId).get();
      if (productRes.data) {
        const currentStock = productRes.data.stock || 0;
        const newStock = currentStock + product.quantity;
        await db.collection('products').doc(product.productId).update({
          data: {
            stock: newStock,
            updatedAt: new Date(),
            updatedAtTs: Date.now()
          }
        });
      }
    }
  }

  const now = new Date();
  const updateData = {
    status: 'cancelled',
    cancelTime: now,
    cancelReason: params.cancelReason || '用户主动取消',
    updatedAt: now,
    updatedAtTs: now.getTime()
  };

  await db.collection('orders').doc(order._id).update({
    data: updateData
  });

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
  const [activeItemsRes, reservedQtyMap, globalConfig] = await Promise.all([
    // 只查询 after_sales_case_items 表，因为这里已经包含了所有进行中的售后明细
    db.collection('after_sales_case_items').where({
      orderId: order._id,
      itemStatus: _.in(['submitted', 'reviewing', 'waiting_buyer_return', 'waiting_seller_receive', 'processing', 'intercepting'])
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

  // 售后时效校验：按签收时间(checkTime)优先，缺失时回退 receiptTime
  const config = getOrderServicePolicy(order, globalConfig);
  const baseTime = parseFlexibleDate(order?.logisticsState?.checkTime) || parseFlexibleDate(order?.receiptTime);

  const now = new Date();
  console.log('售后时效校验:', {
    checkTime: order?.logisticsState?.checkTime,
    receiptTime: order?.receiptTime,
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

    const allowDays = getAllowDaysForAfterSalesType(afterSalesType, config);
    
    // allowDays = -1 表示无时间限制（如未收到货退款）
    if (allowDays >= 0 && baseTime) {
      // 从签收后的第二天开始计算（和前端保持一致）
      // baseTime是北京时间，从第二天0点开始计算
      const startDate = new Date(baseTime.getFullYear(), baseTime.getMonth(), baseTime.getDate() + 1, 0, 0, 0);
      
      const deadlineMs = startDate.getTime() + allowDays * 24 * 60 * 60 * 1000;
      const now = Date.now();
      
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

  const caseRes = await db.collection('after_sales_cases').add({
    data: caseDoc
  });

  const caseId = caseRes._id;
  await Promise.all(normalizedItems.map((item) => db.collection('after_sales_case_items').add({
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

  await createAfterSalesLog({
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
  });

  const updateData = {
    status: 'refund',
    // 记录订单原状态，以便售后取消或完成后恢复
    originalStatusBeforeRefund: order.status !== 'refund' ? order.status : (order.originalStatusBeforeRefund || ''),
    updatedAt: now,
    updatedAtTs: now.getTime()
  };

  await db.collection('orders').doc(order._id).update({
    data: updateData
  });

  console.log('=== 售后申请创建成功 ===');
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
      approvedRefundAmount = Number(caseItem.applyRefundAmount || 0) || 0;
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
    } else {
      throw new Error('不支持的明细处理动作');
    }

    // 保存原始状态，用于回滚
    const originalItemStatus = caseItem.itemStatus;
    const originalApprovedQty = caseItem.approvedQty;
    const originalRejectedQty = caseItem.rejectedQty;
    const originalApprovedRefundAmount = caseItem.approvedRefundAmount;

    try {
      console.log('准备更新售后明细:', itemId, '新状态:', itemStatus);
      await db.collection('after_sales_case_items').doc(itemId).update({
        data: {
          itemStatus,
          approvedQty,
          rejectedQty,
          approvedRefundAmount,
          processNote,
          updatedAt: now,
          completedAt: itemStatus === 'completed' ? now : caseItem.completedAt || null
        }
      });
      console.log('售后明细更新成功');

      const actionLabelMap = {
        approve: '同意售后明细',
        reject: '拒绝售后明细',
        complete: '完成售后明细'
      };

      await createAfterSalesLog({
        caseId: activeCase._id,
        caseItemId: itemId,
        orderId: order._id,
        operatorId: params?.operatorId || '',
        operatorType: params?.operatorType || 'admin',
        action: itemAction,
        beforeStatus: caseItem.itemStatus,
        afterStatus: itemStatus,
        note: processNote || actionLabelMap[itemAction],
        extra: {
          caseNo: activeCase.caseNo,
          orderItemId: caseItem.orderItemId
        },
        createdAt: now
      });

      console.log('开始聚合更新售后单状态');
      const aggregated = await refreshAfterSalesAggregation(order, activeCase, now, processNote || actionLabelMap[itemAction]);
      console.log('聚合更新完成:', aggregated);

      console.log('=== 售后处理完成 ===');
      return {
        newStatus: aggregated.orderStatusInfo.status,
        afterSalesStatus: aggregated.orderStatusInfo.afterSalesStatus,
        caseId: activeCase._id,
        caseStatus: aggregated.caseStatus,
        updatedAt: now
      };
    } catch (error) {
      console.error('处理售后失败，尝试回滚:', error);
      // 尝试回滚明细状态
      try {
        await db.collection('after_sales_case_items').doc(itemId).update({
          data: {
            itemStatus: originalItemStatus,
            approvedQty: originalApprovedQty,
            rejectedQty: originalRejectedQty,
            approvedRefundAmount: originalApprovedRefundAmount,
            updatedAt: now
          }
        });
        console.log('售后明细回滚成功');
      } catch (rollbackError) {
        console.error('售后明细回滚失败:', rollbackError);
      }
      throw error;
    }
  }

  const now = new Date();
  const completeUpdateData = {
    caseStatus: 'completed',
    updatedAt: now,
    completedAt: now
  };
  
  // 不管 processSummary 是否存在，都直接设置完整的对象
  completeUpdateData.processSummary = {
    result: params.result || '售后处理完成',
    processTime: now,
    operatorType: params?.operatorType || 'admin'
  };
  
  await db.collection('after_sales_cases').doc(activeCase._id).update({
    data: completeUpdateData
  });

  const caseItemsRes = await db.collection('after_sales_case_items').where({
    caseId: activeCase._id
  }).limit(100).get();

  await Promise.all((caseItemsRes.data || []).map((item) => db.collection('after_sales_case_items').doc(item._id).update({
    data: {
      itemStatus: 'completed',
      approvedQty: Number(item.applyQty || 0),
      approvedRefundAmount: Number(item.applyRefundAmount || 0),
      processNote: params.result || '售后处理完成',
      updatedAt: now,
      completedAt: now
    }
  })));

  await saveReverseLogistics(activeCase, params, now);
  await createAfterSalesLog({
    caseId: activeCase._id,
    orderId: order._id,
    operatorId: params?.operatorId || '',
    operatorType: params?.operatorType || 'admin',
    action: 'complete_case',
    beforeStatus: activeCase.caseStatus,
    afterStatus: 'completed',
    note: params.result || '售后处理完成',
    extra: {
      caseNo: activeCase.caseNo
    },
    createdAt: now
  });

  // 检查订单是否还有其他进行中的售后单
  const activeStatuses = ['submitted', 'reviewing', 'waiting_buyer_return', 'waiting_seller_receive', 'processing', 'pending', 'intercepting'];
  const otherActiveCases = await db.collection('after_sales_cases').where({
    orderId: order._id,
    caseStatus: _.in(activeStatuses),
    _id: _.neq(activeCase._id)  // 排除当前正在完成的售后单
  }).get();

  // 如果还有其他进行中的售后单，订单状态保持为 refund
  // 如果没有其他进行中的售后单，订单状态变为 refund_completed
  const targetStatus = (otherActiveCases.data && otherActiveCases.data.length > 0) ? 'refund' : 'refund_completed';

  const updateData = {
    status: targetStatus,
    afterSalesStatus: 'completed',
    afterSalesResult: params.result || '',
    afterSalesProcessTime: now,
    updatedAt: now,
    updatedAtTs: now.getTime()
  };

  await db.collection('orders').doc(order._id).update({
    data: updateData
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
  
  // 使用 update 操作，直接设置整个 processSummary 对象（避免点号路径问题）
  await db.collection('after_sales_cases').doc(activeCase._id).update({
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

  const caseItemsRes = await db.collection('after_sales_case_items').where({
    caseId: activeCase._id
  }).limit(100).get();

  await Promise.all((caseItemsRes.data || []).map((item) => db.collection('after_sales_case_items').doc(item._id).update({
    data: {
      itemStatus: 'cancelled',
      processNote: params.result || '售后申请已取消',
      updatedAt: now,
      completedAt: now
    }
  })));

  await createAfterSalesLog({
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
  });

  // 确定订单应该恢复到什么状态
  // 如果原来就是 refund 状态，说明是从其他状态进入售后的，需要恢复到之前的正常状态
  // 如果原来不是 refund 状态，保持原状态不变
  let targetStatus = order.status;
  
  if (order.status === 'refund') {
    // 检查订单是否还有其他进行中的售后单
    const activeStatuses = ['submitted', 'reviewing', 'waiting_buyer_return', 'waiting_seller_receive', 'processing', 'pending', 'intercepting'];
    const otherActiveCases = await db.collection('after_sales_cases').where({
      orderId: order._id,
      caseStatus: _.in(activeStatuses),
      _id: _.neq(activeCase._id)  // 排除当前正在取消的售后单
    }).get();
    
    // 如果还有其他进行中的售后单，订单状态保持为 refund
    if (otherActiveCases.data && otherActiveCases.data.length > 0) {
      targetStatus = 'refund';
    } else {
      // 如果没有其他进行中的售后单，恢复到之前的正常状态
      // 优先使用记录的原状态，否则根据配送类型决定
      if (order.originalStatusBeforeRefund) {
        targetStatus = order.originalStatusBeforeRefund;
      } else if ((order.deliveryType || 'express') === 'express') {
        targetStatus = 'delivered';  // 快递运输恢复到待确认收货
      } else if ((order.deliveryType || 'express') === 'pickup') {
        targetStatus = 'completed';  // 上门自提恢复到已完成
      } else if ((order.deliveryType || 'express') === 'local') {
        targetStatus = 'delivered';  // 同城配送恢复到待确认收货
      }
    }
  }

  const orderUpdateData = {
    status: targetStatus,
    afterSalesStatus: 'cancelled',
    afterSalesResult: params.result || '售后申请已取消',
    afterSalesProcessTime: now,
    updatedAt: now,
    updatedAtTs: now.getTime()
  };

  await db.collection('orders').doc(order._id).update({
    data: orderUpdateData
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
  if (itemId) {
    const caseItemRes = await db.collection('after_sales_case_items').doc(itemId).get();
    const caseItem = caseItemRes.data;
    
    if (!caseItem || caseItem.caseId !== activeCase._id) {
      console.error('售后明细验证失败');
      throw new Error('售后明细不存在或不属于该售后单');
    }
    
    await db.collection('after_sales_case_items').doc(itemId).update({
      data: {
        itemStatus: 'intercepting',
        updatedAt: now
      }
    });

    await createAfterSalesLog({
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
    });
  } else {
    // 如果没有指定itemId，更新所有明细
    const caseItemsRes = await db.collection('after_sales_case_items').where({
      caseId: activeCase._id
    }).limit(100).get();

    await Promise.all((caseItemsRes.data || []).map((item) => db.collection('after_sales_case_items').doc(item._id).update({
      data: {
        itemStatus: 'intercepting',
        updatedAt: now
      }
    })));

    await createAfterSalesLog({
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
    });
  }
  
  const aggregated = await refreshAfterSalesAggregation(order, activeCase, now, '正在拦截快递');
  
  console.log('=== 开始拦截完成 ===');
  return {
    newStatus: aggregated.orderStatusInfo.status,
    afterSalesStatus: aggregated.orderStatusInfo.afterSalesStatus,
    caseId: activeCase._id,
    caseStatus: aggregated.caseStatus,
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
  
  // 如果是拦截成功，修改resultText使其包含"退款"字样，确保用户侧显示"退款完成"
  let finalResultText = resultText;
  if (finalAction === 'approve' && isInterceptSuccess) {
    finalResultText = '拦截成功，订单退款完成';
  }
  
  // 获取所有售后明细
  const caseItemsRes = await db.collection('after_sales_case_items').where({
    caseId: activeCase._id
  }).limit(100).get();

  // 如果是拦截成功，需要处理订单中所有商品
  if (finalAction === 'approve' && isInterceptSuccess) {
      console.log('=== 拦截成功，处理订单所有商品 ===');
      
      // 获取订单中的所有商品索引（使用标准化函数确保字段正确）
      const orderProducts = normalizeOrderProducts(order);
      
      // 获取订单的所有售后明细（包括其他售后单的）
      const allCaseItemsRes = await db.collection('after_sales_case_items').where({
        orderId: order._id
      }).limit(100).get();
      
      // 先处理现有的售后明细
      await Promise.all((caseItemsRes.data || []).map((item) => {
        const approvedQty = Number(item.applyQty || 0);
        const approvedRefundAmount = Number(item.applyRefundAmount || 0);
        
        return db.collection('after_sales_case_items').doc(item._id).update({
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
      
      // 如果订单中有其他商品没有有效的售后记录，也需要创建售后完成记录
      // 排除已完成或进行中的售后记录对应的商品
      const validAllCaseItems = (allCaseItemsRes.data || []).filter(item => 
        !['cancelled', 'rejected'].includes(String(item.itemStatus || ''))
      );
      const existingItemIndices = new Set(validAllCaseItems.map(item => String(item.orderItemIndex)));
      console.log('现有售后商品索引:', existingItemIndices);
      console.log('订单商品数量:', orderProducts.length);
      
      for (let i = 0; i < orderProducts.length; i++) {
        const product = orderProducts[i];
        console.log('检查商品索引:', i, 'product.index:', product.index, 'existingItemIndices.has(String(i)):', existingItemIndices.has(String(i)));
        if (!existingItemIndices.has(String(i))) {
          console.log('为商品索引', i, '创建售后完成记录');
          
          const buyQty = product.buyQty || 1;
          const totalAmount = product.lineAmount || 0;
          
          // 创建售后明细记录
          const newCaseItem = await db.collection('after_sales_case_items').add({
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
          
          console.log('创建的售后明细:', newCaseItem._id);
        }
      }
    }
    
    // 定义售后明细状态
    const itemStatus = finalAction === 'approve' ? 'completed' : 'rejected';
    
    // 不是拦截成功，只处理现有的售后明细
    if (!(finalAction === 'approve' && isInterceptSuccess)) {
      await Promise.all((caseItemsRes.data || []).map((item) => {
        const approvedQty = finalAction === 'approve' ? Number(item.applyQty || 0) : 0;
        const rejectedQty = finalAction === 'reject' ? Number(item.applyQty || 0) : 0;
        const approvedRefundAmount = finalAction === 'approve' ? Number(item.applyRefundAmount || 0) : 0;
        
        return db.collection('after_sales_case_items').doc(item._id).update({
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
    
    await createAfterSalesLog({
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
    });
  
    const aggregated = await refreshAfterSalesAggregation(order, activeCase, now, finalResultText);
  
    console.log('=== 完成拦截 ===');
    return {
      newStatus: aggregated.orderStatusInfo.status,
      afterSalesStatus: aggregated.orderStatusInfo.afterSalesStatus,
      caseId: activeCase._id,
      caseStatus: aggregated.caseStatus,
      updatedAt: now
    };
}
