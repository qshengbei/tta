const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event, context) => {
  const { sessionId, content, type = 'text', customerServiceId } = event;
  
  try {
    // 创建消息
    const message = {
      _id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sessionId,
      openid: customerServiceId,
      role: 'customer_service',
      content,
      type,
      createTime: new Date(),
      status: 'sent'
    };
    
    const lastMessagePreview = {
      _id: message._id,
      content: message.content,
      type: message.type,
      role: message.role,
      openid: message.openid,
      status: message.status,
      createTime: message.createTime
    };
    
    await db.runTransaction(async (transaction) => {
      await transaction.collection('messages').add({ data: message });
      await transaction.collection('sessions').doc(sessionId).update({
        data: {
          lastMessage: lastMessagePreview,
          lastMessageTime: new Date(),
          lastActiveTime: new Date()
        }
      });
    });
    
    console.log('回复消息完成（事务已提交）');
    
    return {
      success: true,
      messageId: message._id
    };
  } catch (error) {
    console.error('回复消息失败', error);
    return {
      success: false,
      error: error.message
    };
  }
};