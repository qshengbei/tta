// 云函数：获取商品数据版本号
// 版本号基于最后一次商品更新时间生成
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

exports.main = async (event, context) => {
  const db = cloud.database();
  
  try {
    // 查询最后更新的商品
    const result = await db.collection('products')
      .where({ isDeleted: false })
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();
    
    if (result.data.length > 0) {
      const lastUpdated = result.data[0].updatedAt;
      const version = Date.parse(lastUpdated).toString();
      
      return {
        success: true,
        version,
        lastUpdated: lastUpdated.toISOString(),
        message: '获取版本号成功'
      };
    } else {
      return {
        success: true,
        version: '0',
        lastUpdated: null,
        message: '暂无商品数据'
      };
    }
  } catch (error) {
    console.error('获取商品版本号失败:', error);
    return {
      success: false,
      version: '0',
      error: error.message
    };
  }
};