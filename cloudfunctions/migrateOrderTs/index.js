// 云函数：migrateOrderTs
// 给 orders 集合的每条记录补充 updatedAtTs 字段（Number 毫秒时间戳）
// 部署后在小程序开发工具中右键云函数 → 云端安装依赖 → 上传并部署 → 手动触发一次

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const BATCH_SIZE = 100;

exports.main = async (event, context) => {
  const action = event.action || 'migrate';

  if (action === 'count') {
    const [totalRes, hasTsRes] = await Promise.all([
      db.collection('orders').count(),
      db.collection('orders').where({
        updatedAtTs: _.exists(true)
      }).count()
    ]);
    return {
      total: totalRes.total,
      hasTs: hasTsRes.total,
      needMigrate: totalRes.total - hasTsRes.total
    };
  }

  if (action === 'dryRun') {
    let totalRecords = 0;
    let validTimestampCount = 0;
    let invalidTimestampCount = 0;
    let missingUpdatedAtCount = 0;

    while (true) {
      const res = await db.collection('orders')
        .where({
          updatedAtTs: _.exists(false)
        })
        .limit(BATCH_SIZE)
        .get();

      const orders = res.data || [];
      if (orders.length === 0) break;

      for (const order of orders) {
        totalRecords++;
        if (!order.updatedAt) {
          missingUpdatedAtCount++;
        } else {
          const ts = new Date(order.updatedAt).getTime();
          if (isNaN(ts)) {
            invalidTimestampCount++;
          } else {
            validTimestampCount++;
          }
        }
      }

      console.log(`dryRun - 已扫描 ${totalRecords} 条`);
    }

    return {
      totalRecords,
      validTimestampCount,
      invalidTimestampCount,
      missingUpdatedAtCount,
      summary: `总计 ${totalRecords} 条待迁移记录，其中 ${validTimestampCount} 条有有效时间戳，${invalidTimestampCount} 条时间戳无效将使用当前时间，${missingUpdatedAtCount} 条缺少 updatedAt 字段将使用当前时间`
    };
  }

  if (action === 'migrate') {
    let migrated = 0;
    let errors = 0;

    while (true) {
      const res = await db.collection('orders')
        .where({
          updatedAtTs: _.exists(false)
        })
        .limit(BATCH_SIZE)
        .get();

      const orders = res.data || [];
      if (orders.length === 0) break;

      const tasks = orders.map(order => {
        const now = Date.now();
        const ts = order.updatedAt ? new Date(order.updatedAt).getTime() : now;
        const updatedAtTs = isNaN(ts) ? now : ts;
        return db.collection('orders').doc(order._id).update({
          data: { updatedAtTs }
        }).then(() => 1).catch(err => {
          console.error('更新失败:', order._id, err);
          return 0;
        });
      });

      const results = await Promise.all(tasks);
      const successCount = results.reduce((a, b) => a + b, 0);
      migrated += successCount;
      errors += (orders.length - successCount);

      console.log(`已迁移 ${migrated} 条，失败 ${errors} 条`);
    }

    return { migrated, errors };
  }

  if (action === 'fixOne') {
    const { orderId } = event;
    if (!orderId) return { error: '缺少 orderId' };

    const res = await db.collection('orders').doc(orderId).get();
    const order = res.data;
    if (!order) return { error: '订单不存在' };

    const now = Date.now();
    const ts = order.updatedAt ? new Date(order.updatedAt).getTime() : now;
    const updatedAtTs = isNaN(ts) ? now : ts;
    await db.collection('orders').doc(orderId).update({
      data: { updatedAtTs }
    });
    return { ok: true };
  }

  return { error: '未知 action，支持: count, dryRun, migrate, fixOne' };
};