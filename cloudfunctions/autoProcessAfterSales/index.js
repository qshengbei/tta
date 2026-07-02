const cloud = require('wx-server-sdk');

cloud.init();
const db = cloud.database();
const _ = db.command;

const LOCK_TIMEOUT_MS = 2 * 60 * 1000;
const EXPIRE_GRACE_MS = 1000;
const AUTO_PROCESS_TIMEOUT_HOURS = 48;

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
    if (value._seconds != null) {
      const parsed = new Date(value._seconds * 1000);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (typeof value.toDate === 'function') {
      try {
        const parsed = value.toDate();
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      } catch (e) {
        console.error('toDate 调用失败:', e);
      }
    }

    if (typeof value.toISOString === 'function') {
      try {
        const parsed = new Date(value.toISOString());
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      } catch (e) {
        console.error('toISOString 调用失败:', e);
      }
    }

    if (value.$date) {
      const parsed = new Date(value.$date);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    
    // 最后尝试：将对象转换为 JSON 字符串后解析
    try {
      const str = JSON.stringify(value);
      if (str) {
        const parsed = new Date(str.replace(/"/g, ''));
        if (!Number.isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    } catch (e) {
      console.error('JSON 解析日期失败:', e);
    }
  }

  return null;
}

function hasActiveLock(caseRecord, now) {
  if (!caseRecord || caseRecord.processing !== true) {
    return false;
  }

  const lockTime = normalizeDate(caseRecord.updatedAt);
  if (!lockTime) {
    return false;
  }

  return now.getTime() - lockTime.getTime() < LOCK_TIMEOUT_MS;
}

function isExpiredAtSecondLevel(createdAt, now) {
  if (!createdAt) {
    return false;
  }

  const deadline = new Date(createdAt.getTime() + AUTO_PROCESS_TIMEOUT_HOURS * 60 * 60 * 1000);
  return deadline.getTime() <= now.getTime() + EXPIRE_GRACE_MS;
}

function isCancelableCase(caseRecord, now) {
  console.log('isCancelableCase 检查开始:', {
    caseId: caseRecord._id,
    caseStatus: caseRecord.caseStatus,
    autoProcessed: caseRecord.autoProcessed,
    processing: caseRecord.processing
  });
  
  if (!caseRecord || caseRecord.caseStatus !== 'submitted') {
    console.log('  跳过: 状态不是 submitted');
    return false;
  }

  if (caseRecord.autoProcessed) {
    console.log('  跳过: 已经自动处理过');
    return false;
  }

  if (hasActiveLock(caseRecord, now)) {
    console.log('  跳过: 有活动锁');
    return false;
  }

  const createdAt = normalizeDate(caseRecord.createdAt);
  console.log('  解析 created_at:', {
    raw: caseRecord.createdAt,
    parsed: createdAt,
    now: now
  });
  
  if (!createdAt) {
    console.log('  跳过: 无法解析 created_at');
    return false;
  }

  const isExpired = isExpiredAtSecondLevel(createdAt, now);
  const deadline = new Date(createdAt.getTime() + AUTO_PROCESS_TIMEOUT_HOURS * 60 * 60 * 1000);
  console.log('  过期检查结果:', {
    isExpired,
    createdAt: createdAt.toISOString(),
    deadline: deadline.toISOString(),
    now: now.toISOString(),
    hoursDiff: (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60)
  });
  
  return isExpired;
}

function isStillExpiredPending(caseRecord, now) {
  if (!caseRecord || caseRecord.caseStatus !== 'submitted') {
    return false;
  }

  if (caseRecord.autoProcessed) {
    return false;
  }

  const createdAt = normalizeDate(caseRecord.createdAt);
  if (!createdAt) {
    return false;
  }

  return isExpiredAtSecondLevel(createdAt, now);
}

async function sendNotification(caseRecord, action) {
  try {
    await cloud.callFunction({
      name: 'sendNotification',
      data: {
        notificationType: 'afterSalesStatusChange',
        targetUsers: [caseRecord._openid],
        data: {
          caseId: caseRecord._id,
          orderNumber: caseRecord.orderNumber,
          action,
          message: action === 'approve' ? '您的售后申请已自动同意' : '您的售后申请已进入审核'
        }
      }
    });
  } catch (error) {
    console.error('发送通知失败:', caseRecord._id, error);
  }
}

const QUALITY_REASONS = [
  'size_mismatch',
  'color_mismatch',
  'material_mismatch',
  'fade',
  'quality',
  'missing',
  'damaged',
  'wrong_item'
];

// 未收到货退款的售后类型
const NOT_RECEIVED_TYPES = ['refund_not_received', 'not_received_refund'];

function getAutoProcessAction(caseRecord) {
  const { reasonCode, reasonText, items = [], primaryAfterSalesType } = caseRecord;

  if (reasonCode && QUALITY_REASONS.includes(reasonCode)) {
    return { action: 'review', immediate: false };
  }

  if (reasonText?.includes('7天无理由')) {
    return { action: 'approve', immediate: true };
  }

  const has7DayReturnSupport = items.some(item => item.productSupports7DayReturn);
  if (has7DayReturnSupport) {
    return { action: 'approve', immediate: true };
  }

  // 未收到货退款类型，尝试自动处理为拦截状态
  if (NOT_RECEIVED_TYPES.includes(primaryAfterSalesType)) {
    return { action: 'intercept', immediate: false };
  }

  return { action: 'review', immediate: false };
}

async function processImmediateApproval(caseRecord, now) {
  await db.collection('after_sales_cases').doc(caseRecord._id).update({
    data: {
      caseStatus: 'approved',
      autoProcessed: true,
      autoProcessedAt: now,
      updatedAt: now,
      autoProcessAction: 'immediate_approve'
    }
  });

  await sendNotification(caseRecord, 'approve');
  console.log(`售后申请 ${caseRecord._id} 已即时自动同意`);
}

exports.main = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  const instanceId = `autoProcess_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  try {
    console.log('=== 开始处理售后超时自动处理 ===');
    console.log('实例ID:', instanceId);
    console.log('调用时间:', new Date().toISOString());

    const now = new Date();

    const pendingCasesRes = await db.collection('after_sales_cases')
      .where({ caseStatus: 'submitted' })
      .get();

    const pendingCases = pendingCasesRes.data || [];
    
    console.log('找到的待处理售后单数量:', pendingCases.length);
    pendingCases.forEach((c, i) => {
      console.log(`售后单 ${i}:`, {
        id: c._id,
        caseNo: c.caseNo,
        caseStatus: c.caseStatus,
        primaryAfterSalesType: c.primaryAfterSalesType,
        createdAt: c.createdAt,
        autoProcessed: c.autoProcessed
      });
    });

    let unlockedStaleLocks = 0;
    const normalizedCases = [];
    for (const caseRecord of pendingCases) {
      if (caseRecord.processing === true && !hasActiveLock(caseRecord, now)) {
        console.log('检测到过期/异常锁，自动解锁:', caseRecord._id);
        try {
          await db.collection('after_sales_cases').doc(caseRecord._id).update({
            data: {
              processing: false,
              updatedAt: now
            }
          });
          unlockedStaleLocks++;
          normalizedCases.push({ ...caseRecord, processing: false, updatedAt: now });
        } catch (unlockError) {
          console.error('自动解锁失败:', caseRecord._id, unlockError);
          normalizedCases.push(caseRecord);
        }
      } else {
        normalizedCases.push(caseRecord);
      }
    }

    const expiredCases = normalizedCases.filter(caseRecord => {
      const isExpired = isCancelableCase(caseRecord, now);
      console.log(`检查售后单 ${caseRecord._id} 是否过期:`, {
        isExpired,
        caseStatus: caseRecord.caseStatus,
        autoProcessed: caseRecord.autoProcessed,
        createdAt: normalizeDate(caseRecord.createdAt),
        now: now,
        hasActiveLock: hasActiveLock(caseRecord, now)
      });
      return isExpired;
    });

    console.log('待处理售后总数:', pendingCases.length);
    console.log('自动解锁数量:', unlockedStaleLocks);
    console.log('命中过期售后数量:', expiredCases.length);
    console.log('命中过期售后ID:', expiredCases.map(c => c._id));

    let processedCount = 0;
    let failedCount = 0;
    let immediateCount = 0;

    for (const caseRecord of normalizedCases) {
      if (caseRecord.autoProcessed) {
        continue;
      }

      const actionResult = getAutoProcessAction(caseRecord);

      if (actionResult.immediate && !caseRecord.processing) {
        try {
          await processImmediateApproval(caseRecord, now);
          immediateCount++;
          processedCount++;
        } catch (error) {
          failedCount++;
          console.error('即时处理失败:', caseRecord._id, error);
        }
      }
    }

    console.log('即时处理数量:', immediateCount);

    if (expiredCases.length === 0 && immediateCount === 0) {
      return {
        success: true,
        message: '处理了 0 个过期售后，失败 0 个',
        data: {
          totalCases: pendingCases.length,
          processedCount: 0,
          failedCount: 0,
          immediateCount: 0,
          instanceId
        }
      };
    }

    for (const caseRecord of expiredCases) {
      try {
        await db.collection('after_sales_cases').doc(caseRecord._id).update({
          data: {
            processing: true,
            updatedAt: now
          }
        });

        const latestCaseRes = await db.collection('after_sales_cases').doc(caseRecord._id).get();
        const latestCase = latestCaseRes.data;

        if (!isStillExpiredPending(latestCase, now)) {
          console.log('二次确认未通过，释放锁并跳过:', caseRecord._id);
          await db.collection('after_sales_cases').doc(caseRecord._id).update({
            data: {
              processing: false,
              updatedAt: now
            }
          });
          continue;
        }

        const actionResult = getAutoProcessAction(latestCase);
        
        // 根据动作类型确定新状态
        let newStatus;
        let notificationAction;
        switch (actionResult.action) {
          case 'approve':
            newStatus = 'approved';
            notificationAction = 'approve';
            break;
          case 'intercept':
            newStatus = 'intercepting';
            notificationAction = 'review';
            break;
          default:
            newStatus = 'reviewing';
            notificationAction = 'review';
        }

        await db.collection('after_sales_cases').doc(caseRecord._id).update({
          data: {
            caseStatus: newStatus,
            autoProcessed: true,
            autoProcessedAt: now,
            processing: false,
            updatedAt: now,
            autoProcessAction: actionResult.action
          }
        });

        // 更新售后明细状态为intercepting
        let caseItems = [];
        if (actionResult.action === 'intercept') {
          const caseItemsRes = await db.collection('after_sales_case_items').where({
            caseId: caseRecord._id
          }).get();
          
          caseItems = caseItemsRes.data || [];
          
          await Promise.all(caseItems.map(item => {
            return db.collection('after_sales_case_items').doc(item._id).update({
              data: {
                itemStatus: 'intercepting',
                updatedAt: now
              }
            });
          }));
        }

        // 获取订单并更新订单状态
        const orderRes = await db.collection('orders').doc(caseRecord.orderId).get();
        if (orderRes.data) {
          const order = orderRes.data;
          
          // 更新售后单状态和订单状态
          await db.collection('after_sales_cases').doc(caseRecord._id).update({
            data: {
              updatedAt: now
            }
          });
          
          // 更新订单的售后状态
          const orderUpdateData = {
            status: 'refund',
            updatedAt: now,
            afterSalesStatus: 'intercepting'
          };
          
          if (actionResult.action === 'intercept') {
            orderUpdateData.afterSalesResult = '正在拦截快递';
            orderUpdateData.afterSalesProcessTime = now;
          }
          
          await db.collection('orders').doc(order._id).update({
            data: orderUpdateData
          });
          
          // 异步记录订单操作日志，不影响主流程
          setImmediate(async () => {
            try {
              const action = actionResult.action === 'intercept' ? 'auto_start_intercepting' : 'auto_process_after_sales';
              await logOrderOperation(db, {
                orderId: order._id,
                orderNumber: order.orderNumber,
                openid: order._openid,
                action,
                fromStatus: order.status,
                toStatus: 'refund',
                operatorType: 'system',
                operatorId: '',
                operatorName: '',
                reason: '系统自动处理售后',
                remark: '',
                detail: { caseId: caseRecord._id, jobId: instanceId }
              });
            } catch (logError) {
              console.error('记录自动处理售后日志失败:', order._id, logError);
            }
          });
        }

        await sendNotification(latestCase, notificationAction);
        processedCount++;

      } catch (error) {
        failedCount++;
        console.error('处理过期售后失败:', caseRecord._id, error);
        try {
          await db.collection('after_sales_cases').doc(caseRecord._id).update({
            data: {
              processing: false,
              updatedAt: now
            }
          });
        } catch (clearError) {
          console.error('清除processing失败:', caseRecord._id, clearError);
        }
      }
    }

    return {
      success: true,
      message: `处理了 ${processedCount} 个售后（即时处理 ${immediateCount} 个，超时处理 ${processedCount - immediateCount} 个），失败 ${failedCount} 个`,
      data: {
        totalCases: pendingCases.length,
        processedCount,
        failedCount,
        immediateCount,
        instanceId
      }
    };

  } catch (error) {
    console.error('处理售后超时失败:', instanceId, error);
    return {
      success: false,
      error: error.message,
      instanceId
    };
  }
};