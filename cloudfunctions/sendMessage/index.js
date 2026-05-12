const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event, context) => {
  const { sessionId, content, type = 'text', extra = null } = event;
  const { OPENID } = cloud.getWXContext();
  
  console.log('发送消息事件:', event);
  console.log('发送者OPENID:', OPENID);
  
  try {
    // 检查内容是否为空
    if (!content || (type === 'text' && typeof content === 'string' && content.trim() === '')) {
      console.error('消息内容为空');
      return {
        success: false,
        error: '消息内容不能为空'
      };
    }
    
    // 先获取会话信息，用会话参与方判定发送者角色，避免客服状态表与会话归属不一致。
    let session;
    try {
      const sessionRes = await db.collection('sessions').doc(sessionId).get();
      session = sessionRes.data;
      console.log('获取会话信息成功:', session);
    } catch (error) {
      console.error('获取会话信息失败:', error);
      return {
        success: false,
        error: '获取会话信息失败'
      };
    }

    let role = 'user';
    if (session && session.customerServiceId && session.customerServiceId === OPENID) {
      role = 'customer_service';
    } else if (session && session.userId && session.userId === OPENID) {
      role = 'user';
    } else {
      // 历史数据兜底：若会话字段不完整，再尝试客服状态表。
      try {
        const csRes = await db.collection('customer_service_status')
          .where({ customerServiceId: OPENID })
          .limit(1)
          .get();
        if ((csRes.data || []).length > 0) {
          role = 'customer_service';
        }
      } catch (error) {
        console.error('检查客服身份失败(兜底)', error);
      }
    }
    
    // 创建消息
    const normalizedExtra = extra && typeof extra === 'object' ? extra : null;
    const message = {
      _id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sessionId,
      openid: OPENID,
      role,
      content: typeof content === 'string' ? content.trim() : content,
      type,
      mediaMeta: normalizedExtra,
      createTime: new Date(),
      status: 'sent'
    };

    if (normalizedExtra) {
      message.fileName = normalizedExtra.fileName || '';
      message.width = Number(normalizedExtra.width) || 0;
      message.height = Number(normalizedExtra.height) || 0;
      message.duration = Number(normalizedExtra.duration) || 0;
      message.fileSize = Number(normalizedExtra.fileSize) || 0;
      message.poster = normalizedExtra.poster || '';
      message.cloudPath = normalizedExtra.cloudPath || '';
    }
    
    // 保存消息
    await db.collection('messages').add({ data: message });
    
    // 更新会话摘要：只保存消息列表真正需要的轻量字段，避免历史结构中 mediaMeta=null 引发嵌套更新冲突。
    const lastMessagePreview = {
      _id: message._id,
      content: message.content,
      type: message.type,
      role: message.role,
      openid: message.openid,
      status: message.status,
      createTime: message.createTime
    };
    
    const updateData = {
      lastMessage: lastMessagePreview,
      lastMessageTime: new Date(),
      lastActiveTime: new Date()
    };

    const unreadCountUser = Number(session.unreadCountUser);
    const unreadCountCustomerService = Number(session.unreadCountCustomerService);
    const safeUnreadCountUser = Number.isFinite(unreadCountUser) ? unreadCountUser : 0;
    const safeUnreadCountCustomerService = Number.isFinite(unreadCountCustomerService) ? unreadCountCustomerService : 0;
    
    // 初始化未读数量字段（如果不存在）
    if (!Number.isFinite(unreadCountUser)) {
      updateData.unreadCountUser = 0;
      session.unreadCountUser = 0;
      console.log('初始化unreadCountUser字段为0');
    }
    if (!Number.isFinite(unreadCountCustomerService)) {
      updateData.unreadCountCustomerService = 0;
      session.unreadCountCustomerService = 0;
      console.log('初始化unreadCountCustomerService字段为0');
    }
    if (!session.unreadCount) {
      updateData.unreadCount = 0;
      console.log('初始化unreadCount字段为0');
    }
    
    // 根据发送者身份增加接收方的未读数
    console.log('发送者角色:', role);
    console.log('会话当前未读数量:', {
      unreadCountUser: session.unreadCountUser,
      unreadCountCustomerService: session.unreadCountCustomerService,
      unreadCount: session.unreadCount
    });
    
    if (role === 'customer_service') {
      // 客服发送消息，增加用户的未读计数
      updateData.unreadCountUser = safeUnreadCountUser + 1;
      // 同时更新unreadCount字段，确保兼容性
      updateData.unreadCount = updateData.unreadCountUser;
      console.log('客服发送消息，更新用户未读计数为:', updateData.unreadCountUser);
    } else if (role === 'user') {
      // 用户发送消息，增加客服的未读计数
      updateData.unreadCountCustomerService = safeUnreadCountCustomerService + 1;
      // 同时更新unreadCount字段，确保兼容性
      updateData.unreadCount = updateData.unreadCountCustomerService;
      console.log('用户发送消息，更新客服未读计数为:', updateData.unreadCountCustomerService);
    } else {
      console.log('未知角色:', role);
    }
    
    console.log('最终更新数据:', updateData);
    
    // 更新会话
    try {
      await db.collection('sessions').doc(sessionId).update({
        data: updateData
      });
      console.log('会话更新成功');
    } catch (error) {
      console.error('会话更新失败:', error);
      return {
        success: false,
        error: '会话更新失败'
      };
    }
    
    return {
      success: true,
      messageId: message._id
    };
  } catch (error) {
    console.error('发送消息失败', error);
    return {
      success: false,
      error: error.message
    };
  }
};