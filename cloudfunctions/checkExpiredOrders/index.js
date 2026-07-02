const cloud = require('wx-server-sdk');

cloud.init();
const db = cloud.database();
const _ = db.command;
const LOCK_TIMEOUT_MS = 2 * 60 * 1000;
const EXPIRE_GRACE_MS = 1000;

const { logOrderOperation } = require('./common/orderLogHelper');

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function hasActiveLock(order, now) {
  if (!order || order.processing !== true) {
    return false;
  }

  const lockTime = normalizeDate(order.updatedAt);
  if (!lockTime) {
    return false;
  }

  return now.getTime() - lockTime.getTime() < LOCK_TIMEOUT_MS;
}

function isExpiredAtSecondLevel(expireTime, now) {
  if (!expireTime) {
    return false;
  }

  // 前端倒计时使用 Math.floor 秒级判断，云函数这里加 1 秒容差以保持一致
  return expireTime.getTime() <= now.getTime() + EXPIRE_GRACE_MS;
}

// 判断订单是否可取消（用于初次筛选，会跳过 processing=true 的订单）
function isCancelablePendingOrder(order, now) {
  if (!order || order.status !== 'pending') {
    return false;
  }

  if (order.cancelTime) {
    return false;
  }

  if (hasActiveLock(order, now)) {
    return false;
  }

  const expireTime = normalizeDate(order.expireTime);
  if (!expireTime) {
    return false;
  }

  return isExpiredAtSecondLevel(expireTime, now);
}

// 加锁后的二次验证：只检查状态和过期时间，不检查 processing（因为我们自己刚设的）
function isStillExpiredPending(order, now) {
  if (!order || order.status !== 'pending') {
    return false;
  }

  if (order.cancelTime) {
    return false;
  }

  const expireTime = normalizeDate(order.expireTime);
  if (!expireTime) {
    return false;
  }

  return isExpiredAtSecondLevel(expireTime, now);
}

async function sendExpiredNotification(order) {
  try {
    await cloud.callFunction({
      name: 'sendNotification',
      data: {
        notificationType: 'orderStatusChange',
        targetUsers: [order._openid],
        data: {
          status: 'cancelled',
          orderNumber: order.orderNumber,
          cancelReason: '支付超时自动取消',
          deliveryType: order.deliveryType
        },
        extras: {
          orderId: order._id
        }
      }
    });
  } catch (error) {
    console.error('过期取消通知发送失败:', order._id, error);
  }
}

async function restoreStock(order, now) {
  if (!Array.isArray(order.products) || order.products.length === 0) {
    return;
  }

  for (const product of order.products) {
    if (!product.productId || !product.quantity) {
      continue;
    }

    const productRes = await db.collection('products').doc(product.productId).get();
    if (!productRes.data) {
      console.warn('商品不存在，跳过库存恢复:', product.productId);
      continue;
    }

    const currentStock = productRes.data.stock || 0;
    await db.collection('products').doc(product.productId).update({
      data: {
        stock: currentStock + product.quantity,
        updatedAt: now,
          updatedAtTs: now.getTime()
      }
    });
  }
}

exports.main = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  const instanceId = `instance_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  try {
    console.log('=== 开始检查过期订单 ===');
    console.log('实例ID:', instanceId);
    console.log('调用时间:', new Date().toISOString());
    console.log('事件参数:', event);

    const now = new Date();
    console.log('当前时间:', now.toISOString());

    const pendingOrdersRes = await db.collection('orders').where({ status: 'pending' }).get();
    const pendingOrders = pendingOrdersRes.data || [];

    // 修复历史脏锁：processing=true 且锁时间已过期（或无效）时，先自动解锁
    let unlockedStaleLocks = 0;
    const normalizedPendingOrders = [];
    for (const order of pendingOrders) {
      if (order.processing === true && !hasActiveLock(order, now)) {
        console.log('检测到过期/异常锁，自动解锁:', order._id, order.updatedAt);
        try {
          await db.collection('orders').doc(order._id).update({
            data: {
              processing: false,
              updatedAt: now,
              updatedAtTs: now.getTime()
            }
          });
          unlockedStaleLocks += 1;
          normalizedPendingOrders.push({ ...order, processing: false, updatedAt: now });
        } catch (unlockError) {
          console.error('自动解锁失败，保留原状态:', order._id, unlockError);
          normalizedPendingOrders.push(order);
        }
      } else {
        normalizedPendingOrders.push(order);
      }
    }

    const expiredOrders = normalizedPendingOrders.filter(order => isCancelablePendingOrder(order, now));

    console.log('待支付订单总数:', pendingOrders.length);
    console.log('自动解锁数量:', unlockedStaleLocks);
    console.log('命中过期订单数量:', expiredOrders.length);
    console.log('命中过期订单ID:', expiredOrders.map(order => order._id));

    if (expiredOrders.length === 0) {
      return {
        success: true,
        message: '处理了 0 个过期订单，失败 0 个',
        data: {
          totalOrders: pendingOrders.length,
          processedCount: 0,
          failedCount: 0,
          instanceId
        }
      };
    }

    let processedCount = 0;
    let failedCount = 0;

    for (const order of expiredOrders) {
      try {
        // 加锁：直接用 doc(id).update()，WeChat 云数据库 where({_id}).update() 不可靠
        await db.collection('orders').doc(order._id).update({
          data: {
            processing: true,
            updatedAt: now,
            updatedAtTs: now.getTime()
          }
        });

        // 二次确认：重新读取最新数据，不检查 processing（我们自己刚设的），只验证状态和过期时间
        const latestOrderRes = await db.collection('orders').doc(order._id).get();
        const latestOrder = latestOrderRes.data;
        if (!isStillExpiredPending(latestOrder, now)) {
          console.log('二次确认未通过，释放锁并跳过:', order._id);
          await db.collection('orders').doc(order._id).update({
            data: {
              processing: false,
              updatedAt: now,
              updatedAtTs: now.getTime()
            }
          });
          continue;
        }

        await restoreStock(latestOrder, now);

        // 取消订单：同样用 doc(id).update()
        await db.collection('orders').doc(order._id).update({
          data: {
            status: 'cancelled',
            statusText: '已取消',
            cancelTime: now,
            cancelReason: '支付超时自动取消',
            processing: false,
            updatedAt: now,
            updatedAtTs: now.getTime()
          }
        });

        await sendExpiredNotification(latestOrder);
        processedCount += 1;
        
        // 异步记录订单操作日志，不影响主流程
        setImmediate(async () => {
          try {
            await logOrderOperation(db, {
              orderId: order._id,
              orderNumber: order.orderNumber,
              openid: order._openid,
              action: 'auto_cancel',
              fromStatus: 'pending',
              toStatus: 'cancelled',
              operatorType: 'system',
              operatorId: '',
              operatorName: '',
              reason: '支付超时自动取消',
              remark: '',
              detail: {}
            });
          } catch (logError) {
            console.error('记录过期订单日志失败:', order._id, logError);
          }
        });
      } catch (error) {
        failedCount += 1;
        console.error('处理过期订单失败:', order._id, error);
        try {
          await db.collection('orders').doc(order._id).update({
            data: {
              processing: false,
              updatedAt: now,
              updatedAtTs: now.getTime()
            }
          });
        } catch (clearError) {
          console.error('清除processing失败:', order._id, clearError);
        }
      }
    }

    return {
      success: true,
      message: `处理了 ${processedCount} 个过期订单，失败 ${failedCount} 个`,
      data: {
        totalOrders: pendingOrders.length,
        processedCount,
        failedCount,
        instanceId
      }
    };
  } catch (error) {
    console.error('检查过期订单失败:', instanceId, error);
    return {
      success: false,
      error: error.message,
      instanceId
    };
  }
};