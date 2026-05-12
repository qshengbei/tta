const cloud = require('wx-server-sdk');
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    console.log('初始化客服状态开始');
    
    // 直接创建客服数据
    const customerServices = [
      {
        _id: "cs_001",
        customerServiceId: "o1R-w7S-1p19alqjb6dVUyYdunSs",
        name: "触摸光环",
        avatarUrl: "/images/icons/客服头像.png",
        status: "offline",
        activeSessions: 0,
        lastLoginTime: null,
        lastLogoutTime: null
      }
    ];

    // 直接添加客服数据
    for (const cs of customerServices) {
      console.log('添加客服:', cs.name);
      try {
        await db.collection('customer_service_status').add({ data: cs });
        console.log('客服添加成功:', cs.name);
      } catch (error) {
        console.error('添加客服失败:', cs.name, error);
      }
    }

    // 验证客服数据是否正确初始化
    const csList = await db.collection('customer_service_status').get();
    console.log('初始化后客服数据:', csList.data);

    return { success: true, message: "客服状态初始化成功", customerServices: csList.data };
  } catch (error) {
    console.error('初始化客服状态失败', error);
    return { success: false, error: error.message };
  }
};