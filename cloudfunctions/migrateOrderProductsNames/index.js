const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const BATCH_SIZE = 100;

exports.main = async (event, context) => {
  const action = event.action || 'migrate';

  if (action === 'count') {
    const [totalRes, hasNamesRes] = await Promise.all([
      db.collection('orders').count(),
      db.collection('orders').where({
        productsNames: _.exists(true)
      }).count()
    ]);
    return {
      total: totalRes.total,
      hasNames: hasNamesRes.total,
      needMigrate: totalRes.total - hasNamesRes.total
    };
  }

  if (action === 'dryRun') {
    let totalRecords = 0;
    let successCount = 0;
    let failCount = 0;

    while (true) {
      const res = await db.collection('orders')
        .where({
          productsNames: _.exists(false)
        })
        .limit(BATCH_SIZE)
        .get();

      const orders = res.data || [];
      if (orders.length === 0) break;

      for (const order of orders) {
        totalRecords++;
        const names = [];
        if (order.products) {
          order.products.forEach(p => {
            if (p.name) names.push(p.name);
          });
        }
        if (order.productsList) {
          order.productsList.forEach(p => {
            if (p.name) names.push(p.name);
          });
        }
        if (names.length > 0) {
          successCount++;
        } else {
          failCount++;
        }
      }
    }

    return {
      totalRecords,
      successCount,
      failCount,
      summary: `总计 ${totalRecords} 条待迁移记录，其中 ${successCount} 条可提取商品名称，${failCount} 条无商品信息`
    };
  }

  if (action === 'migrate') {
    let migrated = 0;
    let errors = 0;

    while (true) {
      const res = await db.collection('orders')
        .where({
          productsNames: _.exists(false)
        })
        .limit(BATCH_SIZE)
        .get();

      const orders = res.data || [];
      if (orders.length === 0) break;

      const tasks = orders.map(order => {
        const names = [];
        if (order.products) {
          order.products.forEach(p => {
            if (p.name) names.push(p.name);
          });
        }
        if (order.productsList) {
          order.productsList.forEach(p => {
            if (p.name) names.push(p.name);
          });
        }
        const productsNames = names.join(', ');
        return db.collection('orders').doc(order._id).update({
          data: { productsNames }
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

    const names = [];
    if (order.products) {
      order.products.forEach(p => {
        if (p.name) names.push(p.name);
      });
    }
    if (order.productsList) {
      order.productsList.forEach(p => {
        if (p.name) names.push(p.name);
      });
    }
    await db.collection('orders').doc(orderId).update({
      data: { productsNames: names.join(', ') }
    });
    return { ok: true };
  }

  return { error: '未知 action，支持: count, dryRun, migrate, fixOne' };
};