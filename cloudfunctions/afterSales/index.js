const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event, context) => {
  const { action, data } = event;

  try {
    console.log('售后云函数被调用，action:', action, 'data:', data);

    if (action === 'getDetail') {
      // 查询售后详情
      const { caseId, orderId } = data;

      console.log('查询售后详情，caseId:', caseId, 'orderId:', orderId);

      if (!caseId && !orderId) {
        return {
          success: false,
          error: '缺少参数'
        };
      }

      let query = db.collection('after_sales_cases');

      if (caseId) {
        query = query.doc(caseId);
      } else if (orderId) {
        query = query.where({ orderId }).limit(1);
      }

      const res = await query.get();

      if (res.data) {
        const afterSales = caseId ? res.data : (res.data[0] || null);
        if (afterSales) {
          return {
            success: true,
            data: afterSales
          };
        }
      }

      return {
        success: false,
        error: '售后记录不存在'
      };
    }

    return {
      success: false,
      error: '不支持的操作类型'
    };
  } catch (error) {
    console.error('售后云函数执行失败:', error);
    return {
      success: false,
      error: error.message || '售后操作失败'
    };
  }
};
