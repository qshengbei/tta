// 云函数：migrateProductTs
// 给 products 集合的每条记录补充 createdAtTs / updatedAtTs 字段（Number 毫秒时间戳）
// 部署后在小程序开发工具中右键云函数 → 云端安装依赖 → 上传并部署 → 手动触发一次

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const BATCH_SIZE = 100;

exports.main = async (event, context) => {
  const action = event.action || 'migrate';

  if (action === 'count') {
    // 统计：查总数 vs 已有 Ts 的数量
    const [totalRes, hasTsRes] = await Promise.all([
      db.collection('products').count(),
      db.collection('products').where({
        createdAtTs: _.exists(true)
      }).count()
    ]);
    return {
      total: totalRes.total,
      hasTs: hasTsRes.total,
      needMigrate: totalRes.total - hasTsRes.total
    };
  }

  if (action === 'migrate') {
    let migrated = 0;
    let errors = 0;

    // 分批处理，每次 100 条
    while (true) {
      const res = await db.collection('products')
        .where({
          createdAtTs: _.exists(false)  // 还没迁移的
        })
        .limit(BATCH_SIZE)
        .get();

      const products = res.data || [];
      if (products.length === 0) break;

      // 并行更新，每批内最多 BATCH_SIZE 个
      const tasks = products.map(p => {
        const now = Date.now();
        const createdAtTs = p.createdAt ? new Date(p.createdAt).getTime() : now;
        const updatedAtTs = p.updatedAt ? new Date(p.updatedAt).getTime() : now;
        return db.collection('products').doc(p._id).update({
          data: { createdAtTs, updatedAtTs }
        }).then(() => 1).catch(err => {
          console.error('更新失败:', p._id, err);
          return 0; // 失败不计入 migrated
        });
      });

      const results = await Promise.all(tasks);
      const successCount = results.reduce((a, b) => a + b, 0);
      migrated += successCount;
      errors += (products.length - successCount);

      console.log(`已迁移 ${migrated} 条，失败 ${errors} 条`);
    }

    return { migrated, errors };
  }

  // 单条修复：补充单个 product
  if (action === 'fixOne') {
    const { productId } = event;
    if (!productId) return { error: '缺少 productId' };

    const res = await db.collection('products').doc(productId).get();
    const p = res.data;
    if (!p) return { error: '商品不存在' };

    const now = Date.now();
    await db.collection('products').doc(productId).update({
      data: {
        createdAtTs: p.createdAt ? new Date(p.createdAt).getTime() : now,
        updatedAtTs: p.updatedAt ? new Date(p.updatedAt).getTime() : now
      }
    });
    return { ok: true };
  }

  return { error: '未知 action，支持: count, migrate, fixOne' };
};
