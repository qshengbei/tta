const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const DEFAULT_AUTO_CONFIRM_DAYS = 3;
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const BATCH_SIZE = 100;

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
    return {
      autoConfirmReceiptDays: autoConfirmReceiptDays > 0 ? autoConfirmReceiptDays : DEFAULT_AUTO_CONFIRM_DAYS
    };
  } catch (error) {
    console.error('读取系统时效配置失败，使用默认值:', error);
    return {
      autoConfirmReceiptDays: DEFAULT_AUTO_CONFIRM_DAYS
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
        updatedAt: now
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

async function processAutoConfirmReceipt(deliveredOrders, now, autoConfirmMs, instanceId) {
  let processedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

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
          updatedAt: now
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
          updatedAt: now
        }
      });

      processedCount += 1;
      await sendAutoConfirmNotification(latestOrder);
    } catch (error) {
      failedCount += 1;
      console.error('自动确认收货失败:', order._id, error);
      await writeErrorLog('auto_confirm_receipt_failed', order, error, now, instanceId);
      await releaseLock(order._id, now);
    }
  }

  return { processedCount, skippedCount, failedCount };
}

exports.main = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
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
              updatedAt: now
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

    return {
      success: true,
      message: `自动确认收货完成：成功 ${confirmResult.processedCount}，跳过 ${confirmResult.skippedCount}，失败 ${confirmResult.failedCount}`,
      data: {
        instanceId,
        totalDeliveredOrders: deliveredOrders.length,
        autoConfirmReceiptDays: timePolicy.autoConfirmReceiptDays,
        processedCount: confirmResult.processedCount,
        skippedCount: confirmResult.skippedCount,
        failedCount: confirmResult.failedCount,
        unlockedStaleLocks,
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
