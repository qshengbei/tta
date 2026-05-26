const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

const adminTemplates = [
  {
    _id: 'template_admin_order_create',
    type: 'orderStatusChange',
    templateType: 'orderStatusChange',
    scenario: 'pending',
    targetRole: 'admin',
    title: '新订单通知',
    content: '有新订单 #{{orderNumber}} 等待处理',
    dataKeys: ['orderNumber'],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    _id: 'template_admin_order_paid',
    type: 'orderStatusChange',
    templateType: 'orderStatusChange',
    scenario: 'paid',
    targetRole: 'admin',
    title: '订单支付成功',
    content: '订单 #{{orderNumber}} 已支付，金额 {{amount}} 元',
    dataKeys: ['orderNumber', 'amount'],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    _id: 'template_admin_order_shipping',
    type: 'orderStatusChange',
    templateType: 'orderStatusChange',
    scenario: 'shipping',
    targetRole: 'admin',
    title: '订单发货提醒',
    content: '订单 #{{orderNumber}} 已发货',
    dataKeys: ['orderNumber'],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    _id: 'template_admin_order_delivered',
    type: 'orderStatusChange',
    templateType: 'orderStatusChange',
    scenario: 'delivered',
    targetRole: 'admin',
    title: '订单已送达',
    content: '订单 #{{orderNumber}} 已送达',
    dataKeys: ['orderNumber'],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    _id: 'template_admin_order_refund',
    type: 'orderStatusChange',
    templateType: 'orderStatusChange',
    scenario: 'refund',
    targetRole: 'admin',
    title: '售后申请通知',
    content: '订单 #{{orderNumber}} 有售后申请待处理',
    dataKeys: ['orderNumber'],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    _id: 'template_admin_order_completed',
    type: 'orderStatusChange',
    templateType: 'orderStatusChange',
    scenario: 'completed',
    targetRole: 'admin',
    title: '订单已完成',
    content: '订单 #{{orderNumber}} 已完成',
    dataKeys: ['orderNumber'],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    _id: 'template_admin_order_cancelled',
    type: 'orderStatusChange',
    templateType: 'orderStatusChange',
    scenario: 'cancelled',
    targetRole: 'admin',
    title: '订单已取消',
    content: '订单 #{{orderNumber}} 已取消',
    dataKeys: ['orderNumber'],
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

exports.main = async (event, context) => {
  console.log('开始初始化管理员通知模板...');
  
  const results = [];
  
  for (const template of adminTemplates) {
    try {
      // 先检查模板是否已存在
      const existResult = await db.collection('notification_templates').where({ _id: template._id }).get();
      
      if (existResult.data && existResult.data.length > 0) {
        // 如果已存在，更新模板
        const updateResult = await db.collection('notification_templates').doc(template._id).set({
          ...template,
          updatedAt: new Date()
        });
        results.push({
          templateId: template._id,
          action: 'updated',
          success: true
        });
        console.log(`模板 ${template._id} 已存在，已更新`);
      } else {
        // 如果不存在，添加新模板
        const addResult = await db.collection('notification_templates').add({
          data: template
        });
        results.push({
          templateId: template._id,
          action: 'added',
          success: true
        });
        console.log(`模板 ${template._id} 已添加`);
      }
    } catch (error) {
      console.error(`处理模板 ${template._id} 失败:`, error);
      results.push({
        templateId: template._id,
        action: 'error',
        success: false,
        error: error.message
      });
    }
  }
  
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  
  console.log(`初始化完成：成功 ${successCount} 个，失败 ${failCount} 个`);
  
  return {
    success: failCount === 0,
    successCount,
    failCount,
    results
  };
};