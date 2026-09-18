const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const DEFAULT_AUTO_CONFIRM_DAYS = 3;
const DEFAULT_AUTO_CONFIRM_RETURN_DAYS = 3;
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const BATCH_SIZE = 100;

const { logOrderOperation } = require('./common/orderLogHelper');

async function getTimePolicyConfig() {
  try {
    const res = await db.collection('settings').limit(1).get();
    const settings = (res.data && res.data[0]) || {};
    const cfg = settings.afterSalesTimeConfig && typeof settings.afterSalesTimeConfig === 'object'
      ? settings.afterSalesTimeConfig
      : {};
    const autoConfirmReceiptDays = Number(
      cfg.autoConfirmReceiptDays ?? settings.autoConfirmReceiptDays ?? DEFAULT_AUTO_CONFIRM_DAYS
    );
    const autoConfirmReturnReceivedDays = Number(
      cfg.autoConfirmReturnReceivedDays ?? settings.autoConfirmReturnReceivedDays ?? DEFAULT_AUTO_CONFIRM_RETURN_DAYS
    );
    return {
      autoConfirmReceiptDays: autoConfirmReceiptDays > 0 ? autoConfirmReceiptDays : DEFAULT_AUTO_CONFIRM_DAYS,
      autoConfirmReturnReceivedDays: autoConfirmReturnReceivedDays > 0 ? autoConfirmReturnReceivedDays : DEFAULT_AUTO_CONFIRM_RETURN_DAYS
    };
  } catch (error) {
    console.error('读取系统时效配置失败，使用默认值:', error);
    return {
      autoConfirmReceiptDays: DEFAULT_AUTO_CONFIRM_DAYS,
      autoConfirmReturnReceivedDays: DEFAULT_AUTO_CONFIRM_RETURN_DAYS
    };
  }
}

function normalizeDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === 'string') {
    return parseCheckTime(value);
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

    if (typeof value.toISOString === 'function') {
      const parsed = new Date(value.toISOString());
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (value.$date) {
      const parsed = new Date(value.$date);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (value.seconds) {
      const parsed = new Date(value.seconds * 1000);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  return null;
}

function parseCheckTime(raw) {
  if (!raw || typeof raw !== 'string') {
    return null;
  }

  const value = raw.trim();
  if (!value) {
    return null;
  }

  // 支持格式：YYYY-MM-DD HH
  let m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2})$/);
  if (m) {
    const [, y, mo, d, h] = m;
    const parsed = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), 0, 0);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // 支持格式：YYYY-MM-DD HH:mm
  m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})$/);
  if (m) {
    const [, y, mo, d, h, mi] = m;
    const parsed = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), 0);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // 支持格式：YYYY-MM-DD HH:mm:ss
  m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    const parsed = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // 兜底：尝试标准 Date 解析
  const fallback = new Date(value.replace(' ', 'T'));
  if (!Number.isNaN(fallback.getTime())) {
    return fallback;
  }

  return null;
}

function hasActiveLock(order, now) {
  if (!order || order.autoConfirmProcessing !== true) {
    return false;
  }

  const lockTime = normalizeDate(order.autoConfirmLockAt || order.updatedAt);
  if (!lockTime) {
    return false;
  }

  return now.getTime() - lockTime.getTime() < LOCK_TIMEOUT_MS;
}

function getAutoConfirmBaseTime(order) {
  const checkTime = normalizeDate(order?.logisticsState?.checkTime);
  if (checkTime) {
    return { time: checkTime, source: 'checkTime' };
  }

  const lastGetTime = normalizeDate(order?.logisticsState?.lastGetTime);
  if (lastGetTime) {
    return { time: lastGetTime, source: 'lastGetTime' };
  }

  return { time: null, source: '' };
}

function isEligibleForAutoConfirm(order, now, autoConfirmMs, skipLockCheck = false) {
  if (!order) {
    return false;
  }

  if (order.status !== 'delivered') {
    return false;
  }

  if ((order.deliveryType || 'express') !== 'express') {
    return false;
  }

  if (!skipLockCheck && hasActiveLock(order, now)) {
    return false;
  }

  // 优先使用签收时间(checkTime)，缺失时回退到deliveredAt
  const rawCheckTime = order?.logisticsState?.checkTime;
  const { time: checkTime, source } = getAutoConfirmBaseTime(order);
  const deliveryTime = checkTime || normalizeDate(order.deliveredAt);
  
  console.log(`订单 ${order._id} 时间检查：原始checkTime="${rawCheckTime}", 解析后=${checkTime?.toISOString()}, 来源=${source}`);
  
  if (!deliveryTime) {
    console.log(`订单 ${order._id} 缺少签收时间和发货时间，跳过`);
    return false;
  }

  const elapsed = now.getTime() - deliveryTime.getTime();
  const elapsedDays = Math.floor(elapsed / (1000 * 60 * 60 * 24));
  const isEligible = elapsed >= autoConfirmMs;
  console.log(`订单 ${order._id} 检查：计算时间=${deliveryTime.toISOString()}, 已过${elapsedDays}天(需${autoConfirmMs / (1000 * 60 * 60 * 24)}天), 是否符合=${isEligible}`);
  
  return isEligible;
}

async function fetchOrdersByStatus(status) {
  let skip = 0;
  let all = [];

  while (true) {
    const res = await db.collection('orders')
      .where({
        status,
        deliveryType: 'express'
      })
      .orderBy('updatedAt', 'desc')
      .skip(skip)
      .limit(BATCH_SIZE)
      .get();

    const list = res.data || [];
    all = all.concat(list);

    if (list.length < BATCH_SIZE) {
      break;
    }

    skip += BATCH_SIZE;
  }

  return all;
}

async function releaseLock(orderId, now) {
  try {
    await db.collection('orders').doc(orderId).update({
      data: {
        autoConfirmProcessing: false,
        autoConfirmLockAt: now,
        updatedAt: now,
        updatedAtTs: now.getTime()
      }
    });
  } catch (e) {
    console.error('释放自动确认锁失败:', orderId, e);
  }
}

async function sendAutoConfirmNotification(order) {
  try {
    await cloud.callFunction({
      name: 'sendNotification',
      data: {
        notificationType: 'orderStatusChange',
        targetUsers: [order._openid],
        data: {
          status: 'completed',
          orderNumber: order.orderNumber,
          productName: order.products?.[0]?.productName || order.products?.[0]?.name || '商品',
          deliveryType: order.deliveryType,
          confirmType: 'auto'
        },
        extras: {
          orderId: order._id,
          source: 'autoConfirmReceipt'
        }
      }
    });
  } catch (error) {
    console.error('自动确认收货通知发送失败:', order._id, error);
  }
}

async function writeErrorLog(type, order, error, now, instanceId) {
  try {
    await db.collection('errorMessage').add({
      data: {
        type,
        orderId: order?._id || '',
        orderNumber: order?.orderNumber || '',
        error: error?.message || String(error),
        stack: error?.stack || '',
        instanceId,
        timestamp: now.getTime(),
        createdAt: now
      }
    });
  } catch (logErr) {
    console.error('写入 errorMessage 失败:', logErr);
  }
}

// ========== 寄回商品自动确认收货 ==========

function hasReturnActiveLock(caseItem, now) {
  if (!caseItem || caseItem.autoConfirmReturnProcessing !== true) {
    return false;
  }
  const lockTime = normalizeDate(caseItem.autoConfirmReturnLockAt || caseItem.updatedAt);
  if (!lockTime) {
    return false;
  }
  return now.getTime() - lockTime.getTime() < LOCK_TIMEOUT_MS;
}

function getReturnConfirmBaseTime(caseItem) {
  const sellerReturnLogistics = caseItem?.sellerReturnLogistics || {};
  const checkTime = normalizeDate(sellerReturnLogistics.checkTime);
  if (checkTime) {
    return { time: checkTime, source: 'checkTime' };
  }
  const lastGetTime = normalizeDate(sellerReturnLogistics.lastGetTime);
  if (lastGetTime) {
    return { time: lastGetTime, source: 'lastGetTime' };
  }
  return { time: null, source: '' };
}

function isEligibleForReturnAutoConfirm(caseItem, now, autoConfirmMs, skipLockCheck = false) {
  if (!caseItem) {
    return false;
  }
  if (caseItem.itemStatus !== 'buyer_receiving') {
    return false;
  }
  if (!skipLockCheck && hasReturnActiveLock(caseItem, now)) {
    return false;
  }
  const sellerReturnLogistics = caseItem.sellerReturnLogistics;
  if (!sellerReturnLogistics) {
    console.log(`明细 ${caseItem._id} 没有寄回物流信息，跳过`);
    return false;
  }
  const isDelivered = String(sellerReturnLogistics.isCheck) === '1' || String(sellerReturnLogistics.state) === '3';
  if (!isDelivered) {
    console.log(`明细 ${caseItem._id} 寄回物流未签收，跳过`);
    return false;
  }
  const { time: baseTime, source } = getReturnConfirmBaseTime(caseItem);
  if (!baseTime) {
    console.log(`明细 ${caseItem._id} 缺少签收时间，跳过`);
    return false;
  }
  const elapsed = now.getTime() - baseTime.getTime();
  const elapsedDays = Math.floor(elapsed / (1000 * 60 * 60 * 24));
  const isEligible = elapsed >= autoConfirmMs;
  console.log(`明细 ${caseItem._id} 检查：计算时间=${baseTime.toISOString()}(${source}), 已过${elapsedDays}天(需${autoConfirmMs / (1000 * 60 * 60 * 24)}天), 是否符合=${isEligible}`);
  return isEligible;
}

async function fetchBuyerReceivingCases() {
  let skip = 0;
  let all = [];
  while (true) {
    const res = await db.collection('after_sales_cases')
      .where({ caseStatus: 'buyer_receiving' })
      .orderBy('updatedAt', 'desc')
      .skip(skip)
      .limit(BATCH_SIZE)
      .get();
    const list = res.data || [];
    all = all.concat(list);
    if (list.length < BATCH_SIZE) {
      break;
    }
    skip += BATCH_SIZE;
  }
  return all;
}

async function fetchCaseItems(caseId) {
  const res = await db.collection('after_sales_case_items')
    .where({ caseId })
    .limit(100)
    .get();
  return res.data || [];
}

async function releaseReturnLock(itemId, now) {
  try {
    await db.collection('after_sales_case_items').doc(itemId).update({
      data: {
        autoConfirmReturnProcessing: false,
        autoConfirmReturnLockAt: now,
        updatedAt: now
      }
    });
  } catch (e) {
    console.error('释放寄回自动确认锁失败:', itemId, e);
  }
}

async function sendReturnAutoConfirmNotification(caseItem, afterSalesCase) {
  try {
    // 查询订单编号用于通知
    let orderNumber = '';
    try {
      const orderRes = await db.collection('orders').doc(afterSalesCase.orderId).get();
      if (orderRes.data) {
        orderNumber = orderRes.data.orderNumber || orderRes.data.orderNo || '';
      }
    } catch (e) {
      console.warn('查询订单信息失败:', e);
    }

    // 换货验货通过的寄回为发新货，使用新文案；其余（验货不通过寄回原货）使用原文案
    const isNewGoods = String(caseItem.returnGoodsType || '') === 'new';
    const scenario = isNewGoods
      ? 'after_sales_auto_confirm_return_received_new'
      : 'after_sales_auto_confirm_return_received';

    await cloud.callFunction({
      name: 'sendNotification',
      data: {
        notificationType: 'orderStatusChange',
        targetUsers: [afterSalesCase._openid],
        data: {
          status: scenario,
          orderNumber: orderNumber,
          caseNo: afterSalesCase.caseNo || afterSalesCase._id,
          productName: caseItem.productNameSnapshot || '商品',
          confirmType: 'auto',
          deliveryType: ''
        },
        extras: {
          orderId: afterSalesCase.orderId,
          caseId: afterSalesCase._id,
          caseItemId: caseItem._id,
          source: 'autoConfirmReturnReceived'
        }
      }
    });
  } catch (error) {
    console.error('寄回自动确认通知发送失败:', caseItem._id, error);
  }
}

function calcCaseStatusFromItems(items) {
  const statuses = (items || []).map(item => item.itemStatus);
  if (statuses.length === 0) {
    return 'submitted';
  }
  if (statuses.some(s => s === 'intercepting')) {
    return 'intercepting';
  }
  if (statuses.some(s => s === 'submitted' || s === 'pending')) {
    return 'submitted';
  }
  if (statuses.some(s => s === 'reviewing')) {
    return 'reviewing';
  }
  if (statuses.some(s => s === 'waiting_buyer_return')) {
    return 'waiting_buyer_return';
  }
  if (statuses.some(s => s === 'waiting_seller_receive')) {
    return 'waiting_seller_receive';
  }
  if (statuses.some(s => s === 'seller_received' || s === 'seller_reviewing')) {
    return 'seller_reviewing';
  }
  if (statuses.some(s => s === 'seller_returning')) {
    return 'seller_returning';
  }
  const hasBuyerReceiving = statuses.some(s => s === 'buyer_receiving');
  if (hasBuyerReceiving) {
    const allBuyerReceivingOrCompleted = statuses.every(s => ['buyer_receiving', 'completed', 'cancelled', 'rejected'].includes(s));
    if (allBuyerReceivingOrCompleted) {
      return 'buyer_receiving';
    }
    return 'seller_returning';
  }
  if (statuses.some(s => s === 'pending_refund')) {
    return 'pending_refund';
  }
  if (statuses.every(s => s === 'cancelled')) {
    return 'cancelled';
  }
  if (statuses.every(s => s === 'rejected')) {
    return 'rejected';
  }
  if (statuses.every(s => s === 'completed')) {
    return 'completed';
  }
  return 'submitted';
}

// 售后明细的"进行中"状态（含换货发新货/寄回原货环节），任一明细处于这些状态时订单保持售后中
const ACTIVE_AFTER_SALES_ITEM_STATUSES = [
  'submitted', 'pending', 'approved', 'reviewing',
  'waiting_buyer_return', 'waiting_seller_receive',
  'seller_received', 'seller_reviewing',
  'seller_returning', 'buyer_receiving',
  'pending_refund', 'intercepting'
];
const EXCHANGE_TYPES = ['exchange', 'quality_exchange'];
const REFUND_TYPES = ['refund', 'quality_refund', 'return_refund', 'quality_return_refund', 'refund_received', 'refund_not_received'];

function roundAmount(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// 退款金额判定容差（金额按分四舍五入）
const REFUND_AMOUNT_TOLERANCE = 0.01;

// 订单全部商品行的可退总额（商品金额，不含配送费）
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

// 单条明细当前承诺的退款金额：已核准取核准额，进行中尚无核准额时取申请额
function getItemCommittedRefundAmount(item) {
  const approved = Number(item?.approvedRefundAmount || 0) || 0;
  if (approved > 0) {
    return roundAmount(approved);
  }
  return roundAmount(Number(item?.applyRefundAmount || 0) || 0);
}

// 明细集合承诺退款金额合计（跨代累计：部分退款+补差应累加）
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

// 有效售后明细中已承诺/已生效的运费扣减（买家责任整单退的包邮差额；运费整单只扣一次）
// 该扣减已内扣在商品退款额中（净额口径），属于买家已承担、已结算的金额
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

// 已完成明细中已 settled 的运费扣减（仅 completed 明细计入已到账口径）
function calcCompletedShippingDeduction(items) {
  return roundAmount((Array.isArray(items) ? items : [])
    .filter((item) => !['cancelled', 'rejected'].includes(String(item?.itemStatus || ''))
      && String(item?.itemStatus || '') === 'completed')
    .reduce((sum, item) => sum + (Number(item?.approvedShippingDeductionAmount || 0) || 0), 0));
}

function calcOrderTotalQty(orderProducts) {
  return (orderProducts && orderProducts.length ? orderProducts : []).reduce(
    (sum, p) => sum + (Number(p.quantity || p.buyQty || p.count || 0) || 0), 0);
}

// 聚合订单"已完成件数"时的跨代去重（换货新货二次售后场景）：
// 同一 orderItemId 存在更高代数有效明细时，旧代数已完成换货明细不再计数
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

// 同一 orderItemId 仅保留最高代数的有效明细（二次售后取代第1代换货）
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
 * 标准化 afterSalesResult 文案（与 updateOrderStatus.buildAfterSalesResult 保持一致）
 */
function buildAfterSalesResult(caseItems, orderProducts) {
  if (!caseItems || caseItems.length === 0) return '';

  const validItems = caseItems.filter(item => !['cancelled', 'rejected'].includes(String(item.itemStatus || '')));
  if (validItems.length === 0) return '';

  const exchangeCount = validItems.filter(item => EXCHANGE_TYPES.includes(String(item.afterSalesType || ''))).length;
  const refundCount = validItems.filter(item => REFUND_TYPES.includes(String(item.afterSalesType || ''))).length;
  const totalApprovedRefundAmount = validItems.reduce((sum, item) => sum + (Number(item.approvedRefundAmount || 0) || 0), 0);

  const totalOrderQty = calcOrderTotalQty(orderProducts);
  // 已纳入退款范围的件数（待退款/退款中/已完成都算，拦截成功自动补退的明细此时是 pending_refund）
  const coveredRefundQty = validItems
    .filter(item => REFUND_TYPES.includes(String(item.afterSalesType || '')))
    .reduce((sum, item) => sum + (Number(item.applyQty || 0) || 0), 0);
  const completedRefundQty = validItems
    .filter(item => REFUND_TYPES.includes(String(item.afterSalesType || '')) && String(item.itemStatus || '') === 'completed')
    .reduce((sum, item) => sum + (Number(item.applyQty || 0) || 0), 0);

  // 金额口径：可退总额、承诺/到账金额（跨代累计，支持部分退款后补差）
  // 买家责任整单退款承担的原运费扣减（包邮差额）也属于已结算金额，计入覆盖判定，
  // 否则净额（可退已内扣运费）会比商品总额少一个运费，被误判为"部分退款"
  const totalPayableAmount = calcOrderProductsPayable(orderProducts);
  const committedRefundAmount = calcCommittedRefundAmount(validItems);
  const completedRefundAmount = calcCompletedRefundAmount(validItems);
  const settledCommittedDeduction = calcCommittedShippingDeduction(validItems);
  const settledCompletedDeduction = calcCompletedShippingDeduction(validItems);
  const isRefundAmountFullyCovered = totalPayableAmount > 0
    && committedRefundAmount + settledCommittedDeduction >= totalPayableAmount - REFUND_AMOUNT_TOLERANCE;
  const isRefundAmountFullyCompleted = totalPayableAmount > 0
    && completedRefundAmount + settledCompletedDeduction >= totalPayableAmount - REFUND_AMOUNT_TOLERANCE;

  if (exchangeCount > 0 && refundCount === 0) {
    return '换货完成';
  }
  if (refundCount > 0 && exchangeCount === 0) {
    if (totalApprovedRefundAmount > 0 || committedRefundAmount > 0) {
      // 件数全覆盖且金额退满：全部到账 → 退款完成；仍有在途明细 → 整单退款；
      // 件数未全覆盖或金额未退满（单件部分金额退款）→ 部分退款
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
  if (exchangeCount > 0 && refundCount > 0) {
    return totalApprovedRefundAmount > 0 ? '部分退款' : '售后完成';
  }

  const totalProductCount = orderProducts && orderProducts.length ? orderProducts.length : 1;
  const validIndices = new Set(validItems.map(item => String(item.orderItemIndex)));
  const allProductsHaveAfterSales = orderProducts && orderProducts.length
    ? orderProducts.every((_, index) => validIndices.has(String(index)))
    : true;
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

/**
 * 跨订单全部售后明细聚合订单状态（与 updateOrderStatus.buildOrderUpdateForAfterSales 规则一致）：
 * 1. 任一明细进行中 → refund；2. 全部取消/拒绝 → 恢复原状态；
 * 3. 仅部分件数完成 → 恢复原状态；4. 全部件数完成 → 换货/零退款 completed，纯退款 refund_completed
 */
function buildOrderUpdateForAfterSales(order, allOrderCaseItems, now) {
  const updateData = {
    updatedAt: now,
    updatedAtTs: now instanceof Date ? now.getTime() : Date.now()
  };

  const items = Array.isArray(allOrderCaseItems) ? allOrderCaseItems : [];
  const activeItems = items.filter(item =>
    ACTIVE_AFTER_SALES_ITEM_STATUSES.includes(String(item.itemStatus || '')));

  if (activeItems.length > 0) {
    const hasIntercepting = activeItems.some(item => String(item.itemStatus) === 'intercepting');
    updateData.status = 'refund';
    updateData.afterSalesStatus = hasIntercepting ? 'intercepting' : 'processing';
    const aggregatedResult = buildAfterSalesResult(items, order.products);
    if (aggregatedResult) {
      updateData.afterSalesResult = aggregatedResult;
      updateData.afterSalesProcessTime = now;
    }
    return updateData;
  }

  const validItems = items.filter(item =>
    !['cancelled', 'rejected'].includes(String(item.itemStatus || '')));
  const totalOrderQty = calcOrderTotalQty(order.products);
  // 跨代去重：第2代售后存在时，第1代已完成换货件不重复计数
  const completedQty = calcEffectiveCompletedQty(items);

  if (validItems.length === 0) {
    updateData.status = order.originalStatusBeforeRefund || 'completed';
    updateData.afterSalesStatus = 'cancelled';
    updateData.afterSalesResult = '';
    updateData.afterSalesProcessTime = now;
    return updateData;
  }

  // 终结状态以每个商品的最高代数明细为准（二次售后取代第1代换货）
  const effectiveItems = pickEffectiveAfterSalesItems(validItems);

  if (totalOrderQty > 0 && completedQty < totalOrderQty) {
    updateData.status = order.originalStatusBeforeRefund || 'completed';
    updateData.afterSalesStatus = 'completed';
  } else {
    const hasExchangeAfterSales = effectiveItems.some(item =>
      EXCHANGE_TYPES.includes(String(item.afterSalesType || '')));
    // 退款金额跨代累计（第1代部分退款+第2代补差），不能只算最高代明细
    const totalApprovedAmount = calcCompletedRefundAmount(validItems);
    // 买家责任整单退款承担的原运费已内扣在商品退款额中，属于已结算金额，需计入退满判定
    const totalPayableAmount = calcOrderProductsPayable(order.products);
    const settledDeduction = calcCompletedShippingDeduction(validItems);
    const isFullyRefunded = totalApprovedAmount > 0
      && totalPayableAmount > 0
      && totalApprovedAmount + settledDeduction >= totalPayableAmount - REFUND_AMOUNT_TOLERANCE;
    // 换货/零退款 → completed；纯退款且金额退满 → refund_completed；
    // 纯退款但金额未退满（单件部分金额退款）→ 恢复原状态，剩余金额仍可补差
    if (hasExchangeAfterSales || totalApprovedAmount <= 0) {
      updateData.status = 'completed';
    } else if (isFullyRefunded) {
      updateData.status = 'refund_completed';
    } else {
      updateData.status = order.originalStatusBeforeRefund || 'completed';
    }
    updateData.afterSalesStatus = 'completed';
  }

  // 文案聚合传全量有效明细：金额需跨代累计
  const resultText = buildAfterSalesResult(validItems, order.products);
  if (resultText) {
    updateData.afterSalesResult = resultText;
    updateData.afterSalesProcessTime = now;
  }
  return updateData;
}

async function processAutoConfirmReturnReceived(buyerReceivingCases, now, autoConfirmMs, instanceId) {
  let processedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const logPromises = [];

  for (const afterSalesCase of buyerReceivingCases) {
    try {
      const caseItems = await fetchCaseItems(afterSalesCase._id);
      console.log(`案件 ${afterSalesCase._id} 明细数量:`, caseItems.length);

      for (const caseItem of caseItems) {
        try {
          if (!isEligibleForReturnAutoConfirm(caseItem, now, autoConfirmMs)) {
            continue;
          }

          // 双重检查：获取最新明细数据
          const currentRes = await db.collection('after_sales_case_items').doc(caseItem._id).get();
          const currentItem = currentRes.data;
          if (!currentItem || !isEligibleForReturnAutoConfirm(currentItem, now, autoConfirmMs)) {
            console.log(`明细 ${caseItem._id} 数据已过期，跳过`);
            skippedCount += 1;
            continue;
          }

          // 设置锁
          await db.collection('after_sales_case_items').doc(caseItem._id).update({
            data: {
              autoConfirmReturnProcessing: true,
              autoConfirmReturnLockAt: now,
              updatedAt: now
            }
          });

          const latestRes = await db.collection('after_sales_case_items').doc(caseItem._id).get();
          const latestItem = latestRes.data;

          // 双重检查锁
          if (!latestItem.autoConfirmReturnProcessing ||
              !latestItem.autoConfirmReturnLockAt ||
              Math.abs(latestItem.autoConfirmReturnLockAt.getTime() - now.getTime()) > 10000) {
            console.log(`明细 ${caseItem._id} 锁可能被覆盖，跳过`);
            skippedCount += 1;
            continue;
          }

          if (!isEligibleForReturnAutoConfirm(latestItem, now, autoConfirmMs, true)) {
            skippedCount += 1;
            await releaseReturnLock(caseItem._id, now);
            continue;
          }

          // 使用事务更新明细状态并重新计算案件状态
          await db.runTransaction(async (transaction) => {
            // 更新明细
            await transaction.collection('after_sales_case_items').doc(caseItem._id).update({
              data: {
                itemStatus: 'completed',
                sellerReturnReceivedAt: now,
                // 完成时间：换货新货场景下作为二次售后期的起算时间
                completedAt: now,
                autoConfirmReturnProcessing: false,
                autoConfirmReturnLockAt: now,
                updatedAt: now
              }
            });

            // 创建售后日志
            const actionType = (caseItem.afterSalesType === 'exchange') ? 'exchange' : 'refund';
            await transaction.collection('after_sales_logs').add({
              data: {
                caseId: afterSalesCase._id,
                caseItemId: caseItem._id,
                orderId: afterSalesCase.orderId,
                operatorId: '',
                operatorType: 'system',
                action: `auto_confirm_return_received_${actionType}`,
                beforeStatus: 'buyer_receiving',
                afterStatus: 'completed',
                note: '系统自动确认收到寄回商品',
                extra: {
                  caseNo: afterSalesCase.caseNo,
                  orderItemId: caseItem.orderItemId,
                  afterSalesType: caseItem.afterSalesType,
                  jobId: instanceId
                },
                createdAt: now
              }
            });

            // 重新获取所有明细并计算案件状态
            const allItemsRes = await transaction.collection('after_sales_case_items')
              .where({ caseId: afterSalesCase._id })
              .limit(100)
              .get();
            const allItems = allItemsRes.data || [];
            const newCaseStatus = calcCaseStatusFromItems(allItems);

            console.log(`案件 ${afterSalesCase._id} 新状态:`, newCaseStatus);

            // 更新案件状态
            await transaction.collection('after_sales_cases').doc(afterSalesCase._id).update({
              data: {
                caseStatus: newCaseStatus,
                updatedAt: now
              }
            });

            // 案件完成时按订单全部售后明细聚合订单状态：
            // 其他售后单/明细仍在进行（如另一件换货中）→ 保持售后中；
            // 部分件数完成 → 恢复售后前状态；全部完成 → 已完成/退款完成（换货不是退款完成）
            if (newCaseStatus === 'completed') {
              const orderRes = await transaction.collection('orders').doc(afterSalesCase.orderId).get();
              const order = orderRes.data;
              if (order) {
                const allOrderItemsRes = await transaction.collection('after_sales_case_items')
                  .where({ orderId: afterSalesCase.orderId })
                  .limit(100)
                  .get();
                const orderUpdateData = buildOrderUpdateForAfterSales(order, allOrderItemsRes.data || [], now);
                await transaction.collection('orders').doc(afterSalesCase.orderId).update({
                  data: orderUpdateData
                });
              }
            }
          });

          processedCount += 1;
          console.log(`明细 ${caseItem._id} 自动确认寄回收货成功`);

          // 发送通知
          await sendReturnAutoConfirmNotification(caseItem, afterSalesCase);

          // 异步记录订单操作日志
          const logPromise = logOrderOperation(db, {
            orderId: afterSalesCase.orderId,
            orderNumber: afterSalesCase.orderNumber || afterSalesCase.orderId,
            openid: afterSalesCase._openid,
            action: 'auto_confirm_return_received',
            fromStatus: 'buyer_receiving',
            toStatus: 'completed',
            operatorType: 'system',
            operatorId: '',
            operatorName: '',
            reason: '系统自动确认收到寄回商品',
            remark: '',
            detail: {
              caseId: afterSalesCase._id,
              caseItemId: caseItem._id,
              jobId: instanceId
            }
          }).catch(logError => {
            console.error('记录寄回自动确认日志失败:', caseItem._id, logError);
          });
          logPromises.push(logPromise);

          // 换货新货自动确认收货：卖家承担的寄回运费补偿随换货完成打款（与手动确认同口径，幂等防重）
          if (String(latestItem.returnGoodsType || caseItem.returnGoodsType || '') === 'new'
            && !latestItem.returnCompensationRefundCreated) {
            const rawComp = latestItem.approvedReturnShippingCompensationAmount;
            const compensationAmount = Math.round(((
              rawComp === undefined || rawComp === null || rawComp === ''
                ? (Number(latestItem.applyReturnShippingCompensationAmount || caseItem.applyReturnShippingCompensationAmount) || 0)
                : (Number(rawComp) || 0)
            ) * 100) / 100);
            if (compensationAmount > 0) {
              try {
                const existedRes = await db.collection('refund_records')
                  .where({ caseId: afterSalesCase._id })
                  .limit(50)
                  .get();
                const duplicated = (existedRes.data || []).some((r) =>
                  Number(r.amount) === compensationAmount
                  && String(r.reason || '').includes('寄回运费补偿'));
                if (!duplicated) {
                  // 与 updateOrderStatus 手动确认同口径：补传 outTradeNo，缺失时 refund 云函数自行回查订单
                  let outTradeNo = '';
                  try {
                    const orderRes = await db.collection('orders').doc(afterSalesCase.orderId).get();
                    outTradeNo = orderRes.data?.outTradeNo || orderRes.data?.tradeNo || '';
                  } catch (orderErr) {
                    console.error('查询订单 outTradeNo 失败（交由 refund 云函数兜底）:', orderErr);
                  }
                  const refundRes = await cloud.callFunction({
                    name: 'refund',
                    data: {
                      action: 'create',
                      orderId: afterSalesCase.orderId,
                      caseId: afterSalesCase._id,
                      amount: compensationAmount,
                      outTradeNo,
                      reason: '寄回运费补偿（换货自动确认，运费补偿）'
                    }
                  });
                  if (refundRes.result?.success) {
                    await db.collection('after_sales_case_items').doc(caseItem._id).update({
                      data: {
                        returnCompensationRefundCreated: true,
                        returnCompensationRefundCreatedAt: now
                      }
                    });
                    console.log(`换货自动确认寄回运费补偿打款已创建: ${caseItem._id}，金额 ${compensationAmount}`);
                  }
                }
              } catch (compErr) {
                // 不阻断自动确认主流程；本周期未打款成功时，下周期由 refund_records 幂等查重兜底
                console.error('换货自动确认寄回运费补偿打款失败:', caseItem._id, compErr);
              }
            }
          }

        } catch (itemError) {
          failedCount += 1;
          console.error('寄回自动确认失败（明细）:', caseItem._id, itemError);
          await writeErrorLog('auto_confirm_return_received_failed', { _id: afterSalesCase.orderId }, itemError, now, instanceId);
          await releaseReturnLock(caseItem._id, now);
        }
      }
    } catch (caseError) {
      console.error('寄回自动确认失败（案件）:', afterSalesCase._id, caseError);
    }
  }

  if (logPromises.length > 0) {
    await Promise.allSettled(logPromises);
  }

  return { processedCount, skippedCount, failedCount };
}

async function processAutoConfirmReceipt(deliveredOrders, now, autoConfirmMs, instanceId) {
  let processedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const logPromises = [];

  for (const order of deliveredOrders) {
    try {
      if (!isEligibleForAutoConfirm(order, now, autoConfirmMs)) {
        continue;
      }

      // 先获取最新订单数据
      const currentRes = await db.collection('orders').doc(order._id).get();
      const currentOrder = currentRes.data;
      
      // 再次检查，防止数据过期
      if (!isEligibleForAutoConfirm(currentOrder, now, autoConfirmMs)) {
        console.log(`订单 ${order._id} 数据已过期，跳过`);
        skippedCount += 1;
        continue;
      }

      // 设置锁
      await db.collection('orders').doc(order._id).update({
        data: {
          autoConfirmProcessing: true,
          autoConfirmLockAt: now,
          updatedAt: now,
          updatedAtTs: now.getTime()
        }
      });

      const latestRes = await db.collection('orders').doc(order._id).get();
      const latestOrder = latestRes.data;
      
      // 双重检查：检查锁是否是我们设置的
      if (!latestOrder.autoConfirmProcessing || 
          !latestOrder.autoConfirmLockAt || 
          Math.abs(latestOrder.autoConfirmLockAt.getTime() - now.getTime()) > 10000) {
        console.log(`订单 ${order._id} 锁可能被覆盖，跳过`);
        skippedCount += 1;
        continue;
      }

      if (!isEligibleForAutoConfirm(latestOrder, now, autoConfirmMs, true)) {
        skippedCount += 1;
        await releaseLock(order._id, now);
        continue;
      }

      // 确认收货
      await db.collection('orders').doc(order._id).update({
        data: {
          status: 'completed',
          receiptTime: now,
          receiptConfirm: {
            type: 'auto',
            confirmedAt: now,
            confirmedBy: 'system',
            source: 'timer_job',
            jobId: instanceId
          },
          autoConfirmProcessing: false,
          autoConfirmLockAt: now,
          updatedAt: now,
          updatedAtTs: now.getTime()
        }
      });

      processedCount += 1;
      await sendAutoConfirmNotification(latestOrder);
      
      // 异步记录订单操作日志，不阻塞主流程
      const logPromise = logOrderOperation(db, {
        orderId: order._id,
        orderNumber: order.orderNumber,
        openid: order._openid,
        action: 'auto_confirm_receipt',
        fromStatus: 'delivered',
        toStatus: 'completed',
        operatorType: 'system',
        operatorId: '',
        operatorName: '',
        reason: '自动确认收货',
        remark: '',
        detail: { jobId: instanceId }
      }).catch(logError => {
        console.error('记录自动确认收货日志失败:', order._id, logError);
      });
      logPromises.push(logPromise);
    } catch (error) {
      failedCount += 1;
      console.error('自动确认收货失败:', order._id, error);
      await writeErrorLog('auto_confirm_receipt_failed', order, error, now, instanceId);
      await releaseLock(order._id, now);
    }
  }

  // 等待所有日志记录完成后再返回
  if (logPromises.length > 0) {
    await Promise.allSettled(logPromises);
  }

  return { processedCount, skippedCount, failedCount };
}

exports.main = async (event, context) => {
  const now = new Date();
  const instanceId = `auto_confirm_${now.getTime()}_${Math.floor(Math.random() * 10000)}`;

  try {
    console.log('=== 开始自动确认收货任务 ===');
    console.log('实例ID:', instanceId);
    console.log('当前时间:', now.toISOString());

    const timePolicy = await getTimePolicyConfig();
    const autoConfirmMs = timePolicy.autoConfirmReceiptDays * 24 * 60 * 60 * 1000;
    console.log('自动确认配置(天):', timePolicy.autoConfirmReceiptDays);

    const deliveredOrders = await fetchOrdersByStatus('delivered');
    console.log('delivered待确认订单总数:', deliveredOrders.length);

    // 【新增】自动清理历史脏锁
    let unlockedStaleLocks = 0;
    const normalizedOrders = [];
    for (const order of deliveredOrders) {
      if (order.autoConfirmProcessing === true && !hasActiveLock(order, now)) {
        console.log('检测到过期/异常锁，自动解锁:', order._id, order.autoConfirmLockAt || order.updatedAt);
        try {
          await db.collection('orders').doc(order._id).update({
            data: {
              autoConfirmProcessing: false,
              updatedAt: now,
              updatedAtTs: now.getTime()
            }
          });
          unlockedStaleLocks += 1;
          normalizedOrders.push({ ...order, autoConfirmProcessing: false, updatedAt: now });
        } catch (unlockError) {
          console.error('自动解锁失败，保留原状态:', order._id, unlockError);
          normalizedOrders.push(order);
        }
      } else {
        normalizedOrders.push(order);
      }
    }

    const confirmResult = await processAutoConfirmReceipt(normalizedOrders, now, autoConfirmMs, instanceId);
    console.log(`自动确认收货完成 - 成功 ${confirmResult.processedCount}，跳过 ${confirmResult.skippedCount}，失败 ${confirmResult.failedCount}`);

    // ========== 寄回商品自动确认收货 ==========
    const autoConfirmReturnMs = timePolicy.autoConfirmReturnReceivedDays * 24 * 60 * 60 * 1000;
    console.log('寄回自动确认配置(天):', timePolicy.autoConfirmReturnReceivedDays);

    const buyerReceivingCases = await fetchBuyerReceivingCases();
    console.log('buyer_receiving售后案件总数:', buyerReceivingCases.length);

    // 清理寄回自动确认的历史脏锁
    let unlockedReturnStaleLocks = 0;
    for (const caseInfo of buyerReceivingCases) {
      try {
        const items = await fetchCaseItems(caseInfo._id);
        for (const item of items) {
          if (item.autoConfirmReturnProcessing === true && !hasReturnActiveLock(item, now)) {
            console.log('检测到寄回自动确认过期锁，自动解锁:', item._id, item.autoConfirmReturnLockAt || item.updatedAt);
            try {
              await db.collection('after_sales_case_items').doc(item._id).update({
                data: {
                  autoConfirmReturnProcessing: false,
                  updatedAt: now
                }
              });
              unlockedReturnStaleLocks += 1;
            } catch (unlockErr) {
              console.error('寄回自动解锁失败:', item._id, unlockErr);
            }
          }
        }
      } catch (e) {
        console.error('清理寄回锁时获取明细失败:', caseInfo._id, e);
      }
    }

    const returnConfirmResult = await processAutoConfirmReturnReceived(buyerReceivingCases, now, autoConfirmReturnMs, instanceId);
    console.log(`寄回自动确认收货完成 - 成功 ${returnConfirmResult.processedCount}，跳过 ${returnConfirmResult.skippedCount}，失败 ${returnConfirmResult.failedCount}`);

    return {
      success: true,
      message: `自动确认收货完成：成功 ${confirmResult.processedCount}，跳过 ${confirmResult.skippedCount}，失败 ${confirmResult.failedCount}；寄回自动确认：成功 ${returnConfirmResult.processedCount}，跳过 ${returnConfirmResult.skippedCount}，失败 ${returnConfirmResult.failedCount}`,
      data: {
        instanceId,
        totalDeliveredOrders: deliveredOrders.length,
        autoConfirmReceiptDays: timePolicy.autoConfirmReceiptDays,
        processedCount: confirmResult.processedCount,
        skippedCount: confirmResult.skippedCount,
        failedCount: confirmResult.failedCount,
        unlockedStaleLocks,
        returnAutoConfirm: {
          totalCases: buyerReceivingCases.length,
          autoConfirmReturnReceivedDays: timePolicy.autoConfirmReturnReceivedDays,
          processedCount: returnConfirmResult.processedCount,
          skippedCount: returnConfirmResult.skippedCount,
          failedCount: returnConfirmResult.failedCount,
          unlockedStaleLocks: unlockedReturnStaleLocks
        },
        executedAt: now
      }
    };
  } catch (error) {
    console.error('自动确认收货任务执行失败:', error);
    await writeErrorLog('auto_confirm_receipt_task_error', null, error, now, instanceId);
    return {
      success: false,
      error: error.message || '自动确认收货任务执行失败',
      data: {
        instanceId
      }
    };
  }
};
