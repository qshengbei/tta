const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event, context) => {
  const { userId } = event;

  try {
    console.log('分配客服开始，用户ID:', userId);
    
    // 先查询在线客服
    let csList = await db.collection('customer_service_status')
      .where({ status: 'online' })
      .orderBy('activeSessions', 'asc')
      .get();

    console.log('在线客服查询结果:', csList.data.length);
    
    // 如果没有在线客服，查询所有客服
    if (csList.data.length === 0) {
      console.log('无在线客服，查询所有客服');
      csList = await db.collection('customer_service_status')
        .orderBy('activeSessions', 'asc')
        .get();
      console.log('所有客服查询结果:', csList.data.length);
    }

    if (csList.data.length === 0) {
      console.error('暂无客服数据');
      return { success: false, error: "暂无客服" };
    }

    // 选择活跃会话数最少的客服
    const assignedCS = csList.data[0];
    console.log('分配的客服:', assignedCS.name, assignedCS.customerServiceId);

    // 更新客服活跃会话数
    await db.collection('customer_service_status').doc(assignedCS._id).update({
      data: {
        activeSessions: db.command.inc(1)
      }
    });
    console.log('客服活跃会话数更新成功');

    return { 
      success: true, 
      customerServiceId: assignedCS.customerServiceId,
      customerServiceName: assignedCS.name
    };
  } catch (error) {
    console.error('分配客服失败', error);
    return { success: false, error: error.message };
  }
};