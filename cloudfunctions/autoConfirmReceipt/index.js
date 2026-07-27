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

    await cloud.callFunction({
      name: 'sendNotification',
      data: {
        notificationType: 'orderStatusChange',
        targetUsers: [afterSalesCase._openid],
        data: {
          status: 'after_sales_auto_confirm_return_received',
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

            // 如果案件状态变为 completed 或 rejected，需要同步更新订单状态
            if (newCaseStatus === 'completed') {
              const orderRes = await transaction.collection('orders').doc(afterSalesCase.orderId).get();
              const order = orderRes.data;
              if (order) {
                const allOrderCasesRes = await transaction.collection('after_sales_cases')
                  .where({ orderId: afterSalesCase.orderId })
                  .limit(100)
                  .get();
                const allOrderCases = allOrderCasesRes.data || [];
                const hasActiveCase = allOrderCases.some(c =>
                  ['submitted', 'reviewing', 'waiting_buyer_return', 'waiting_seller_receive',
                   'seller_reviewing', 'seller_returning', 'buyer_receiving', 'pending_refund', 'intercepting', 'pending']
                    .includes(c.caseStatus)
                );
                if (!hasActiveCase && order.status === 'refund') {
                  await transaction.collection('orders').doc(afterSalesCase.orderId).update({
                    data: {
                      status: 'refund_completed',
                      afterSalesStatus: 'completed',
                      updatedAt: now,
                      updatedAtTs: now.getTime()
                    }
                  });
                } else if (!hasActiveCase && order.status === 'completed') {
                  await transaction.collection('orders').doc(afterSalesCase.orderId).update({
                    data: {
                      afterSalesStatus: 'completed',
                      updatedAt: now,
                      updatedAtTs: now.getTime()
                    }
                  });
                }
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
