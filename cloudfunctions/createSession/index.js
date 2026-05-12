const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event, context) => {
  const { userId, initialMessage } = event;

  try {
    console.log('创建会话开始，用户ID:', userId);
    
    // 分配客服
    console.log('调用assignCustomerService云函数');
    const assignResult = await cloud.callFunction({
      name: 'assignCustomerService',
      data: { userId }
    });

    console.log('分配客服结果:', assignResult.result);
    
    if (!assignResult.result.success) {
      console.error('分配客服失败:', assignResult.result.error);
      return { success: false, error: assignResult.result.error };
    }

    const { customerServiceId, customerServiceName } = assignResult.result;
    console.log('分配的客服信息:', customerServiceName, customerServiceId);
    
    // 获取客服头像信息
    let customerServiceAvatar = "/images/icons/客服头像.png";
    try {
      const csRes = await db.collection('customer_service_status')
        .where({ customerServiceId })
        .get();
      if (csRes.data.length > 0 && csRes.data[0].avatarUrl) {
        customerServiceAvatar = csRes.data[0].avatarUrl;
      }
    } catch (error) {
      console.error('获取客服头像失败', error);
    }

    // 创建会话
    const session = {
      _id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      customerServiceId,
      customerServiceName,
      customerServiceAvatar,
      assignedTo: customerServiceId,
      assignedTime: new Date(),
      lastMessage: {
        content: '您好，请问有什么可以帮助您的？',
        type: 'text',
        status: 'sent',
        createTime: new Date()
      },
      lastMessageTime: new Date(),
      lastActiveTime: new Date(),
      unreadCount: 0,
      unreadCountUser: 1,
      unreadCountCustomerService: 0,
      status: 'active'
    };

    console.log('创建会话数据:', session);
    await db.collection('sessions').add({ data: session });
    console.log('会话创建成功，会话ID:', session._id);

    // 创建客服欢迎消息
    const welcomeMessage = {
      _id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sessionId: session._id,
      openid: customerServiceId,
      role: 'customer_service',
      content: '您好，请问有什么可以帮助您的？',
      type: 'text',
      createTime: new Date(),
      status: 'sent'
    };

    console.log('创建客服欢迎消息数据:', welcomeMessage);
    await db.collection('messages').add({ data: welcomeMessage });
    console.log('客服欢迎消息创建成功');

    try {
      await cloud.callFunction({
        name: 'getSessionCache',
        data: {
          sessionId: session._id,
          forceRefresh: true
        }
      });
    } catch (cacheError) {
      console.error('初始化会话共享缓存失败', cacheError);
    }

    return { success: true, sessionId: session._id };
  } catch (error) {
    console.error('创建会话失败', error);
    return { success: false, error: error.message };
  }
};