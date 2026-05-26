const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

const ADMIN_TEMPLATES = [
  {
    _id: 'template_admin_order_create',
    type: 'orderStatusChange',
    templateType: 'orderStatusChange',
    scenario: 'pending',
    targetRole: 'admin',
    title: '新订单通知',
    templateName: '管理员-新订单通知',
    content: '有新订单 #{{orderNumber}} 等待处理',
    variables: ['orderNumber'],
    isTemplateMessage: false,
    status: 'active',
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
    templateName: '管理员-订单支付成功通知',
    content: '订单 #{{orderNumber}} 已支付，金额 {{amount}} 元',
    variables: ['orderNumber', 'amount'],
    isTemplateMessage: false,
    status: 'active',
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
    templateName: '管理员-订单发货通知',
    content: '订单 #{{orderNumber}} 已发货',
    variables: ['orderNumber'],
    isTemplateMessage: false,
    status: 'active',
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
    templateName: '管理员-订单送达通知',
    content: '订单 #{{orderNumber}} 已送达',
    variables: ['orderNumber'],
    isTemplateMessage: false,
    status: 'active',
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
    templateName: '管理员-售后申请通知',
    content: '订单 #{{orderNumber}} 有售后申请待处理',
    variables: ['orderNumber'],
    isTemplateMessage: false,
    status: 'active',
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
    templateName: '管理员-订单完成通知',
    content: '订单 #{{orderNumber}} 已完成',
    variables: ['orderNumber'],
    isTemplateMessage: false,
    status: 'active',
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
    templateName: '管理员-订单取消通知',
    content: '订单 #{{orderNumber}} 已取消',
    variables: ['orderNumber'],
    isTemplateMessage: false,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    _id: 'template_admin_order_expired_cancelled',
    type: 'orderStatusChange',
    templateType: 'orderStatusChange',
    scenario: 'expired_cancelled',
    targetRole: 'admin',
    title: '订单已过期',
    templateName: '管理员-订单过期通知',
    content: '订单 #{{orderNumber}} 因超时未支付已自动取消',
    variables: ['orderNumber'],
    isTemplateMessage: false,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    _id: 'template_admin_order_refund_completed',
    type: 'orderStatusChange',
    templateType: 'orderStatusChange',
    scenario: 'refund_completed',
    targetRole: 'admin',
    title: '售后处理完成',
    templateName: '管理员-售后处理完成通知',
    content: '订单 #{{orderNumber}} 售后处理已完成',
    variables: ['orderNumber'],
    isTemplateMessage: false,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

async function initAdminTemplates() {
  console.log('初始化管理员通知模板...');
  const results = [];
  for (const template of ADMIN_TEMPLATES) {
    try {
      const existResult = await db.collection('notification_templates').where({ _id: template._id }).get();
      if (existResult.data && existResult.data.length > 0) {
        await db.collection('notification_templates').doc(template._id).set({
          ...template,
          updatedAt: new Date()
        });
        results.push({ templateId: template._id, action: 'updated', success: true });
      } else {
        await db.collection('notification_templates').add({ data: template });
        results.push({ templateId: template._id, action: 'added', success: true });
      }
    } catch (error) {
      results.push({ templateId: template._id, action: 'error', success: false, error: error.message });
    }
  }
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  return { success: failCount === 0, successCount, failCount, results };
}

let cachedAdminOpenids = null;

async function getAdminOpenids(forceRefresh = false) {
  // 如果有缓存且不需要强制刷新，直接返回缓存
  if (!forceRefresh && cachedAdminOpenids !== null) {
    console.log('使用缓存的管理员openid列表:', cachedAdminOpenids);
    return cachedAdminOpenids;
  }
  
  console.log('=== getAdminOpenids() 开始 ===');
  try {
    const settingsRes = await db.collection('settings').limit(1).get();
    console.log('settings查询结果:', JSON.stringify(settingsRes));
    
    const settings = (settingsRes.data && settingsRes.data[0]) || {};
    console.log('settings数据:', JSON.stringify(settings));
    
    if (Array.isArray(settings.adminOpenId)) {
      console.log('使用 adminOpenId 字段，值为:', settings.adminOpenId);
      cachedAdminOpenids = settings.adminOpenId.filter(Boolean);
      console.log('过滤后的管理员openid列表:', cachedAdminOpenids);
      return cachedAdminOpenids;
    }
    if (Array.isArray(settings.adminOpenids)) {
      console.log('使用 adminOpenids 字段，值为:', settings.adminOpenids);
      cachedAdminOpenids = settings.adminOpenids.filter(Boolean);
      console.log('过滤后的管理员openid列表:', cachedAdminOpenids);
      return cachedAdminOpenids;
    }
    
    console.log('未找到管理员openid字段，返回空数组');
    cachedAdminOpenids = [];
  } catch (error) {
    console.error('获取管理员openid失败:', error);
    cachedAdminOpenids = [];
  }
  return cachedAdminOpenids;
}

async function sendOrderNotificationToUser(openid, data, extras) {
  console.log(`给用户 ${openid} 发送订单通知`);
  await handleOrderStatusChangeNotification(openid, data, extras, 'user');
}

async function sendOrderNotificationToAdmins(data, extras) {
  console.log('=== sendOrderNotificationToAdmins() 开始 ===');
  console.log('通知数据:', JSON.stringify(data));
  console.log('额外参数:', JSON.stringify(extras));
  
  const adminOpenids = await getAdminOpenids();
  console.log('获取到的管理员openid列表:', adminOpenids);
  
  if (adminOpenids.length === 0) {
    console.log('未配置管理员，跳过管理员通知');
    return false;
  }
  
  console.log(`准备给 ${adminOpenids.length} 个管理员发送订单通知`);
  
  for (const adminOpenid of adminOpenids) {
    try {
      console.log(`正在给管理员 ${adminOpenid} 发送通知`);
      await handleOrderStatusChangeNotification(adminOpenid, data, extras, 'admin');
      console.log(`给管理员 ${adminOpenid} 发送通知成功`);
    } catch (error) {
      console.error(`给管理员 ${adminOpenid} 发送通知失败:`, error);
    }
  }
  
  console.log('=== sendOrderNotificationToAdmins() 结束 ===');
  return true;
}

function needAdminNotification(notificationType, scenario) {
  if (notificationType === 'orderStatusChange') {
    const adminScenarios = ['pending', 'paid', 'shipping', 'delivered', 'completed', 'cancelled', 'refund', 'refund_completed'];
    return adminScenarios.includes(scenario);
  }
  if (notificationType === 'system') {
    return true;
  }
  return false;
}

async function getNotificationTemplate(templateId, notificationType, scenario, deliveryType, targetRole = 'user') {
  try {
    let template;
    if (templateId) {
      const result = await db.collection('notification_templates').where({ _id: templateId }).get();
      if (result.data && result.data.length > 0) {
        template = result.data[0];
      }
    } else if (notificationType && scenario) {
      if (notificationType === 'orderStatusChange') {
        // 根据角色和场景选择模板
        const userScenarioTemplateMap = {
          pending: 'template_order_create_success',
          paid: 'template_order_pay_success',
          completed: 'template_order_confirm',
          cancelled: 'template_order_cancel',
          expired_cancelled: 'template_order_expire',
          refund: 'template_order_apply_after_sales',
          refund_completed: 'template_order_process_after_sales'
        };
        
        const adminScenarioTemplateMap = {
          pending: 'template_admin_order_create',
          paid: 'template_admin_order_paid',
          shipping: 'template_admin_order_shipping',
          delivered: 'template_admin_order_delivered',
          completed: 'template_admin_order_completed',
          cancelled: 'template_admin_order_cancelled',
          expired_cancelled: 'template_admin_order_expired_cancelled',
          refund: 'template_admin_order_refund',
          refund_completed: 'template_admin_order_refund_completed'
        };

        let mappedTemplateId;
        
        // 根据目标角色选择对应的模板映射
        if (targetRole === 'admin') {
          mappedTemplateId = adminScenarioTemplateMap[scenario];
          console.log(`管理员场景 ${scenario} 对应的模板ID: ${mappedTemplateId}`);
        } else {
          mappedTemplateId = userScenarioTemplateMap[scenario];
          console.log(`用户场景 ${scenario} 对应的模板ID: ${mappedTemplateId}`);
        }

        // 处理发货场景，根据配送方式选择模板
        if (scenario === 'shipping') {
          if (deliveryType === 'express') {
            mappedTemplateId = targetRole === 'admin' ? 'template_admin_order_shipping' : 'template_order_express_ship';
          } else if (deliveryType === 'local') {
            mappedTemplateId = targetRole === 'admin' ? 'template_admin_order_shipping' : 'template_order_local_ship';
          }
        } else if (scenario === 'delivered') {
          if (deliveryType === 'express') {
            mappedTemplateId = targetRole === 'admin' ? 'template_admin_order_delivered' : 'template_order_express_ship';
          } else if (deliveryType === 'local') {
            mappedTemplateId = targetRole === 'admin' ? 'template_admin_order_delivered' : 'template_order_local_ship';
          }
        }

        if (mappedTemplateId) {
          const result = await db.collection('notification_templates').where({ _id: mappedTemplateId }).get();
          if (result.data && result.data.length > 0) {
            template = result.data[0];
          }
        }
      }

      if (!template) {
        let query = db.collection('notification_templates');
        
        if (targetRole) {
          const roleResult = await query.where({
            templateType: notificationType,
            scenario: scenario,
            targetRole: targetRole
          }).get();
          
          if (roleResult.data && roleResult.data.length > 0) {
            template = roleResult.data[0];
          }
        }
        
        if (!template) {
          const result = await query.where({
            templateType: notificationType,
            scenario: scenario
          }).get();
          
          if (result.data && result.data.length > 0) {
            template = result.data.find(t => !t.targetRole || t.targetRole === 'all') || result.data[0];
          }
        }
      }

      if (notificationType === 'orderStatusChange' && scenario === 'shipping' && deliveryType && !template) {
        let templateIdPrefix;
        if (deliveryType === 'express') {
          templateIdPrefix = targetRole === 'admin' ? 'template_admin_order_express_ship' : 'template_order_express_ship';
        } else if (deliveryType === 'local') {
          templateIdPrefix = targetRole === 'admin' ? 'template_admin_order_local_ship' : 'template_order_local_ship';
        }
        
        if (templateIdPrefix) {
          const result = await db.collection('notification_templates').where({ _id: templateIdPrefix }).get();
          if (result.data && result.data.length > 0) {
            template = result.data[0];
          }
        }
      }
      
      if (notificationType === 'orderStatusChange' && !template) {
        return null;
      }

      if (!template) {
        let result;
        try {
          result = await db.collection('notification_templates').where({
            templateType: notificationType
          }).get();
          
          if (!result.data || result.data.length === 0) {
            result = await db.collection('notification_templates').where({
              type: notificationType
            }).get();
          }
          
          if (result.data && result.data.length > 0) {
            template = result.data.find(t => {
              const roleMatch = !t.targetRole || t.targetRole === 'all' || t.targetRole === targetRole;
              const scenarioMatch = t._id.includes(scenario) || (t.templateName && t.templateName.includes(scenario)) || (t.name && t.name.includes(scenario));
              return roleMatch && scenarioMatch;
            }) || result.data.find(t => !t.targetRole || t.targetRole === 'all') || result.data[0];
          }
        } catch (error) {
          console.error('查询通知模板失败:', error);
        }
      }
    }
    return template;
  } catch (error) {
    console.error('获取消息模板失败:', error);
    return null;
  }
}

function replaceTemplateVariables(content, data) {
  if (!content) return content;
  let result = content;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value);
  }
  return result;
}

async function saveNotificationRecord(openid, notificationType, data, extras, template) {
  try {
    const title = replaceTemplateVariables(template.title, data);
    const content = replaceTemplateVariables(template.content, data);
    
    const isAdminNotification = template.targetRole === 'admin';
    
    const result = await db.collection('notifications').add({
      data: {
        openid: openid,
        notificationType: notificationType,
        type: notificationType,           // 添加 type 字段
        title: title,
        content: content,
        status: 'unread',                // 使用 status 字段表示未读状态
        isRead: false,                   // 兼容旧字段
        isAdminNotification: isAdminNotification,
        isDelete: false,                 // 添加 isDelete 字段
        data: data,
        extras: extras,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });
    
    console.log('通知记录保存成功:', result);
    return result;
  } catch (error) {
    console.error('保存通知记录失败:', error);
    return null;
  }
}

async function sendMiniProgramNotification(openid, template, data) {
  try {
    const title = replaceTemplateVariables(template.title, data);
    const content = replaceTemplateVariables(template.content, data);
    
    console.log(`发送小程序通知给 ${openid}:`);
    console.log('标题:', title);
    console.log('内容:', content);
    
    return true;
  } catch (error) {
    console.error('发送小程序通知失败:', error);
    return false;
  }
}

async function sendWechatTemplateMessage(openid, template, data, page) {
  try {
    const templateData = {};
    if (template.variables && Array.isArray(template.variables)) {
      template.variables.forEach(key => {
        if (data[key]) {
          templateData[key] = {
            value: data[key]
          };
        }
      });
    }
    
    const templateId = template.templateId || template.wechatTemplateId;
    console.log(`发送微信模板消息给 ${openid}:`);
    console.log('模板ID:', templateId);
    console.log('模板数据:', templateData);
    console.log('跳转页面:', page);
    
    return true;
  } catch (error) {
    console.error('发送微信模板消息失败:', error);
    return false;
  }
}

async function handleOrderStatusChangeNotification(openid, data, extras, targetRole = null) {
  console.log(`处理订单状态变化通知，用户: ${openid}, 订单: ${extras?.orderId}, 传入的targetRole: ${targetRole}`);
  
  if (targetRole === null) {
    targetRole = 'user';
    try {
      const adminOpenids = await getAdminOpenids();
      console.log(`检查管理员身份，当前用户openid: ${openid}, 管理员列表: ${JSON.stringify(adminOpenids)}`);
      if (adminOpenids.includes(openid)) {
        targetRole = 'admin';
        console.log(`用户 ${openid} 是管理员，使用管理员模板`);
      } else {
        console.log(`用户 ${openid} 不是管理员，使用用户模板`);
      }
    } catch (error) {
      console.error('检查管理员身份失败:', error);
    }
  } else {
    console.log(`强制指定目标角色: ${targetRole}`);
  }
  
  let scenario = data.status || 'pending';
  if (scenario === 'cancelled' && /超时|自动取消/.test(data.cancelReason || '')) {
    scenario = 'expired_cancelled';
  }
  const deliveryType = data.deliveryType;
  
  let template = await getNotificationTemplate(extras?.templateId, 'orderStatusChange', scenario, deliveryType, targetRole);
  
  if (!template) {
    console.warn('未找到订单状态变化通知模板，使用默认模板');
    
    const defaultTemplateByScenario = {
      pending: { title: '订单创建成功', content: '您的订单 #{{orderNumber}} 已创建成功，请在{{countDown}}分钟内完成支付' },
      paid: { title: '订单支付成功', content: '您的订单 #{{orderNumber}} 已支付成功，我们将尽快为您处理' },
      shipping: { title: '订单已发货', content: '您的订单 #{{orderNumber}} 已发货，请注意查收' },
      delivered: { title: '订单配送中', content: '您的订单 #{{orderNumber}} 正在配送中，请留意收货' },
      completed: { title: '订单已完成', content: '您的订单 #{{orderNumber}} 已完成，感谢您的支持' },
      cancelled: { title: '订单已取消', content: '您的订单 #{{orderNumber}} 已取消' },
      expired_cancelled: { title: '订单已过期', content: '您的订单 #{{orderNumber}} 因超时未支付已自动取消' },
      refund: { title: '售后申请已提交', content: '您的订单 #{{orderNumber}} 售后申请已提交，我们将尽快处理' },
      refund_completed: { title: '售后处理完成', content: '您的订单 #{{orderNumber}} 售后处理已完成，请查看处理结果' },
      admin_pending: { title: '新订单通知', content: '有新订单 #{{orderNumber}} 等待处理' },
      admin_paid: { title: '订单支付成功', content: '订单 #{{orderNumber}} 已支付，金额 {{amount}} 元' },
      admin_shipping: { title: '订单发货提醒', content: '订单 #{{orderNumber}} 已发货' },
      admin_delivered: { title: '订单已送达', content: '订单 #{{orderNumber}} 已送达' },
      admin_completed: { title: '订单已完成', content: '订单 #{{orderNumber}} 已完成' },
      admin_cancelled: { title: '订单已取消', content: '订单 #{{orderNumber}} 已取消' },
      admin_expired_cancelled: { title: '订单已过期', content: '订单 #{{orderNumber}} 因超时未支付已自动取消' },
      admin_refund: { title: '售后申请通知', content: '订单 #{{orderNumber}} 有售后申请待处理' },
      admin_refund_completed: { title: '售后处理完成', content: '订单 #{{orderNumber}} 售后处理已完成' }
    };

    const scenarioKey = targetRole === 'admin' ? `admin_${scenario}` : scenario;
    const fallback = defaultTemplateByScenario[scenarioKey] || defaultTemplateByScenario[scenario] || {
      title: targetRole === 'admin' ? '订单通知' : '订单状态更新通知',
      content: targetRole === 'admin' 
        ? '订单 #{{orderNumber}} 状态更新为 {{status}}' 
        : '您的订单 #{{orderNumber}} 状态已更新为 {{status}}'
    };

    template = {
      title: fallback.title,
      content: fallback.content,
      templateType: 'orderStatusChange',
      type: 'orderStatusChange',
      targetRole: targetRole
    };
  }
  
  await saveNotificationRecord(openid, 'orderStatusChange', data, extras, template);
  
  await sendMiniProgramNotification(openid, template, data);
  
  if (template.isTemplateMessage) {
    await sendWechatTemplateMessage(openid, template, data, `/pages/order-detail/index?id=${extras?.orderId}`);
  }
}

async function handleActivityNotification(openid, data, extras) {
  console.log(`处理活动通知，用户: ${openid}`);
}

async function handleSystemNotification(openid, data, extras) {
  console.log(`处理系统通知，用户: ${openid}`);
}

async function handleRestockNotification(openid, data, extras) {
  console.log(`处理补货通知，用户: ${openid}`);
}

async function logNotificationError(errorType, error, context) {
  try {
    await db.collection('notification_errors').add({
      data: {
        errorType: errorType,
        errorMessage: error.message,
        stack: error.stack,
        context: context,
        createdAt: new Date()
      }
    });
  } catch (e) {
    console.error('记录通知错误日志失败:', e);
  }
}

exports.main = async (event, context) => {
  // ============ 启动日志 ============
  console.log('========================================');
  console.log('======== sendNotification 云函数启动 ========');
  console.log('========================================');
  // ========================================
  
  const { notificationType, targetUsers, templateId, data, extras } = event;

  console.log('【输入参数】');
  console.log('notificationType:', notificationType);
  console.log('targetUsers:', targetUsers);
  console.log('templateId:', templateId);
  console.log('data:', JSON.stringify(data));
  console.log('extras:', JSON.stringify(extras));

  if (notificationType === 'initAdminTemplates') {
    return await initAdminTemplates();
  }

  try {
    console.log('=== 开始发送通知 ===');
    console.log('通知类型:', notificationType);
    console.log('目标用户:', targetUsers);
    console.log('通知数据:', data);
    console.log('额外参数:', extras);

    if (!notificationType || !targetUsers || !Array.isArray(targetUsers) || targetUsers.length === 0) {
      console.error('参数验证失败');
      return { success: false, error: '通知类型和目标用户不能为空' };
    }

    let notificationResults = [];
    let usersToNotify = [];

    if (targetUsers.includes('all')) {
      console.log('查询所有用户的openid');
      try {
        const usersResult = await db.collection('users').get();
        if (usersResult.data && usersResult.data.length > 0) {
          usersToNotify = usersResult.data.map(user => user._openid);
          console.log('获取到的用户openid数量:', usersToNotify.length);
        } else {
          console.warn('未找到用户记录');
        }
      } catch (error) {
        console.error('查询用户失败:', error);
        return { success: false, error: '查询用户失败' };
      }
    } else {
      usersToNotify = targetUsers;
    }

    if (notificationType === 'system' && extras?.scenario === 'announcement') {
      if (!data.announcementContent && data.content) {
        data.announcementContent = data.content;
      }
    }

    if (notificationType === 'orderStatusChange') {
      const scenario = data.status || 'pending';
      console.log('=== 订单状态变更通知处理 ===');
      console.log('场景:', scenario);
      
      for (const targetUser of usersToNotify) {
        try {
          console.log(`给用户 ${targetUser} 发送通知`);
          await sendOrderNotificationToUser(targetUser, data, extras);
          notificationResults.push({ openid: targetUser, success: true });
        } catch (error) {
          console.error(`给用户 ${targetUser} 发送通知失败:`, error);
          notificationResults.push({ openid: targetUser, success: false, error: error.message });
        }
      }
      
      // 判断是否需要通知管理员
      console.log('判断是否需要通知管理员...');
      const needAdmin = needAdminNotification(notificationType, scenario);
      console.log(`场景 ${scenario} 是否需要通知管理员: ${needAdmin}`);
      
      if (needAdmin) {
        console.log(`场景 ${scenario} 需要通知管理员，调用 sendOrderNotificationToAdmins()`);
        await sendOrderNotificationToAdmins(data, extras);
      } else {
        console.log(`场景 ${scenario} 不需要通知管理员`);
      }
      
      return { success: true, message: '订单通知处理完成', results: notificationResults };
    }

    for (const targetUser of usersToNotify) {
      try {
        switch (notificationType) {
          case 'activity':
            await handleActivityNotification(targetUser, data, extras);
            break;
          case 'system':
            await handleSystemNotification(targetUser, data, extras);
            break;
          case 'restock':
            await handleRestockNotification(targetUser, data, extras);
            break;
          default:
            console.warn('未知的通知类型:', notificationType);
        }
        notificationResults.push({ openid: targetUser, success: true });
      } catch (error) {
        console.error(`给用户 ${targetUser} 发送通知失败:`, error);
        notificationResults.push({ openid: targetUser, success: false, error: error.message });
      }
    }

    return {
      success: true,
      message: '通知发送完成',
      results: notificationResults
    };
  } catch (error) {
    console.error('发送通知失败:', error);
    return { success: false, error: error.message };
  }
};