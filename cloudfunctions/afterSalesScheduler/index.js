const cloud = require('wx-server-sdk');

cloud.init();
const db = cloud.database();
const _ = db.command;

const LOCK_TIMEOUT_MS = 2 * 60 * 1000;

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
  }

  return null;
}

function hasActiveLock(record, now) {
  if (!record || record.processing !== true) {
    return false;
  }

  const lockTime = normalizeDate(record.updatedAt);
  if (!lockTime) {
    return false;
  }

  return now.getTime() - lockTime.getTime() < LOCK_TIMEOUT_MS;
}

async function sendNotification(targetOpenid, type, data) {
  try {
    await cloud.callFunction({
      name: 'sendNotification',
      data: {
        notificationType: type,
        targetUsers: [targetOpenid],
        data: data
      }
    });
  } catch (error) {
    console.error('发送通知失败:', type, error);
  }
}

async function sendReturnReminder(caseRecord) {
  await sendNotification(caseRecord._openid, 'afterSalesReminder', {
    caseId: caseRecord._id,
    orderNumber: caseRecord.orderNumber,
    message: '请尽快寄回商品，否则售后申请将自动取消'
  });
}

async function sendReviewReminder(caseRecord) {
  await sendNotification(caseRecord._openid, 'reviewReminder', {
    caseId: caseRecord._id,
    orderNumber: caseRecord.orderNumber,
    message: '感谢您的信任，期待您的评价'
  });
}

async function autoApproveReceipt(caseRecord, now) {
  await db.collection('after_sales_cases').doc(caseRecord._id).update({
    data: {
      caseStatus: 'approved',
      autoProcessed: true,
      autoProcessedAt: now,
      processing: false,
      updatedAt: now,
      autoProcessAction: 'auto_approve_receipt'
    }
  });

  await sendNotification(caseRecord._openid, 'afterSalesStatusChange', {
    caseId: caseRecord._id,
    orderNumber: caseRecord.orderNumber,
    action: 'approve',
    message: '您的售后申请已自动验收通过'
  });
}

const SCENARIOS = [
  {
    name: 'buyer_return_timeout',
    description: '用户寄回超时提醒',
    timeoutDays: 7,
    collection: 'after_sales_cases',
    getQuery: (now) => ({
      caseStatus: 'waiting_buyer_return',
      approvedAt: _.lt(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
      processing: _.neq(true)
    }),
    handler: async (caseRecord, now) => {
      await sendReturnReminder(caseRecord);
    },
    markProcessed: false
  },
  {
    name: 'seller_receive_timeout',
    description: '商家验收超时自动通过',
    timeoutDays: 3,
    collection: 'after_sales_cases',
    getQuery: (now) => ({
      caseStatus: 'waiting_seller_receive',
      logisticsSignedAt: _.lt(new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)),
      autoProcessed: _.eq(null),
      processing: _.neq(true)
    }),
    handler: async (caseRecord, now) => {
      await autoApproveReceipt(caseRecord, now);
    },
    markProcessed: true
  },
  {
    name: 'review_reminder',
    description: '评价提醒',
    timeoutDays: 3,
    collection: 'after_sales_cases',
    getQuery: (now) => ({
      caseStatus: 'completed',
      completedAt: _.lt(new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)),
      reviewReminded: _.eq(null),
      processing: _.neq(true)
    }),
    handler: async (caseRecord, now) => {
      await sendReviewReminder(caseRecord);
      
      await db.collection('after_sales_cases').doc(caseRecord._id).update({
        data: {
          reviewReminded: true,
          updatedAt: now
        }
      });
    },
    markProcessed: false
  }
];

exports.main = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  const instanceId = `scheduler_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  try {
    console.log('=== 开始执行售后调度器 ===');
    console.log('实例ID:', instanceId);
    console.log('调用时间:', new Date().toISOString());

    const now = new Date();
    const results = [];

    for (const scenario of SCENARIOS) {
      console.log(`处理场景: ${scenario.name} - ${scenario.description}`);
      
      try {
        const query = scenario.getQuery(now);
        const recordsRes = await db.collection(scenario.collection)
          .where(query)
          .get();

        const records = recordsRes.data || [];
        console.log(`  命中记录数: ${records.length}`);

        if (records.length === 0) {
          results.push({
            scenario: scenario.name,
            description: scenario.description,
            processed: 0,
            success: true
          });
          continue;
        }

        let processedCount = 0;
        let failedCount = 0;

        for (const record of records) {
          try {
            if (hasActiveLock(record, now)) {
              console.log(`    记录 ${record._id} 有活跃锁，跳过`);
              continue;
            }

            await db.collection(scenario.collection).doc(record._id).update({
              data: {
                processing: true,
                updatedAt: now
              }
            });

            const latestRes = await db.collection(scenario.collection).doc(record._id).get();
            const latestRecord = latestRes.data;

            if (scenario.markProcessed && latestRecord.autoProcessed) {
              await db.collection(scenario.collection).doc(record._id).update({
                data: { processing: false }
              });
              console.log(`    记录 ${record._id} 已处理过，跳过`);
              continue;
            }

            await scenario.handler(latestRecord, now);

            if (scenario.markProcessed) {
              await db.collection(scenario.collection).doc(record._id).update({
                data: {
                  autoProcessed: true,
                  autoProcessedAt: now
                }
              });
            } else {
              await db.collection(scenario.collection).doc(record._id).update({
                data: { processing: false }
              });
            }

            processedCount++;
            console.log(`    记录 ${record._id} 处理成功`);

          } catch (error) {
            failedCount++;
            console.error(`    记录 ${record._id} 处理失败:`, error);
            try {
              await db.collection(scenario.collection).doc(record._id).update({
                data: { processing: false, updatedAt: now }
              });
            } catch (clearError) {
              console.error(`    清除处理状态失败:`, clearError);
            }
          }
        }

        results.push({
          scenario: scenario.name,
          description: scenario.description,
          processed: processedCount,
          failed: failedCount,
          success: failedCount === 0
        });

      } catch (error) {
        console.error(`场景 ${scenario.name} 执行失败:`, error);
        results.push({
          scenario: scenario.name,
          description: scenario.description,
          processed: 0,
          failed: 0,
          success: false,
          error: error.message
        });
      }
    }

    const totalProcessed = results.reduce((sum, r) => sum + r.processed, 0);
    const totalFailed = results.reduce((sum, r) => (r.failed || 0), 0);

    console.log('=== 售后调度器执行完成 ===');
    console.log(`总处理: ${totalProcessed}, 失败: ${totalFailed}`);

    return {
      success: true,
      message: `处理完成，共处理 ${totalProcessed} 条记录，失败 ${totalFailed} 条`,
      data: {
        instanceId,
        results,
        totalProcessed,
        totalFailed
      }
    };

  } catch (error) {
    console.error('售后调度器执行失败:', instanceId, error);
    return {
      success: false,
      error: error.message,
      instanceId
    };
  }
};