const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

/**
 * 发送通知消息
 * @param {Object} event - 事件参数
 * @param {string} event.notificationType - 通知类型：orderStatusChange, activity, system, restock
 * @param {Array} event.targetUsers - 目标用户openid数组
 * @param {string} event.templateId - 模板消息ID（可选）
 * @param {Object} event.data - 通知数据
 * @param {Object} event.extras - 额外参数
 * @param {Object} context - 上下文
 */
exports.main = async (event, context) => {
  const {
    notificationType,
    targetUsers,
    templateId,
    data,
    extras
  } = event;

  try {
    console.log('=== 开始发送通知 ===');
    console.log('通知类型:', notificationType);
    console.log('目标用户:', targetUsers);
    console.log('通知数据:', data);
    console.log('额外参数:', extras);

    // 验证参数
    if (!notificationType || !targetUsers || !Array.isArray(targetUsers) || targetUsers.length === 0) {
      console.error('参数验证失败');
      return {
        success: false,
        error: '通知类型和目标用户不能为空'
      };
    }

    // 处理不同类型的通知
    let notificationResults = [];

    // 处理目标用户
    let usersToNotify = [];
    if (targetUsers.includes('all')) {
      // 如果包含'all'，查询所有用户的openid
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
        return {
          success: false,
          error: '查询用户失败'
        };
      }
    } else {
      // 否则使用指定的用户openid
      usersToNotify = targetUsers;
    }

    // 处理系统公告类型的通知，确保模板变量正确
    if (notificationType === 'system' && extras?.scenario === 'announcement') {
      // 确保data中包含announcementContent字段
      if (!data.announcementContent && data.content) {
        data.announcementContent = data.content;
      }
    }

    for (const targetUser of usersToNotify) {
      try {
        // 根据通知类型处理
        switch (notificationType) {
          case 'orderStatusChange':
            await handleOrderStatusChangeNotification(targetUser, data, extras);
            break;
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
            await handleGeneralNotification(targetUser, data, extras);
        }

        notificationResults.push({
          openid: targetUser,
          success: true
        });
      } catch (error) {
        console.error(`发送通知给用户 ${targetUser} 失败:`, error);
        notificationResults.push({
          openid: targetUser,
          success: false,
          error: error.message
        });
      }
    }

    console.log('=== 通知发送完成 ===');
    return {
      success: true,
      message: `通知发送完成，成功 ${notificationResults.filter(r => r.success).length} 个，失败 ${notificationResults.filter(r => !r.success).length} 个`,
      data: notificationResults
    };
  } catch (error) {
    console.error('发送通知失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * 根据模板ID或通知类型获取消息模板
 */
async function getNotificationTemplate(templateId, notificationType, scenario, deliveryType) {
  try {
    let template;
    if (templateId) {
      // 根据模板ID查询
      const result = await db.collection('notification_templates').where({ _id: templateId }).get();
      if (result.data && result.data.length > 0) {
        template = result.data[0];
      }
    } else if (notificationType && scenario) {
      // 订单状态通知优先按固定模板ID映射，避免模糊匹配拿错模板
      if (notificationType === 'orderStatusChange') {
        const scenarioTemplateMap = {
          pending: 'template_order_create_success',
          paid: 'template_order_pay_success',
          completed: 'template_order_confirm',
          cancelled: 'template_order_cancel',
          expired_cancelled: 'template_order_expire',
          refund: 'template_order_apply_after_sales',
          refund_completed: 'template_order_process_after_sales'
        };

        let mappedTemplateId = scenarioTemplateMap[scenario];
        if (scenario === 'shipping') {
          if (deliveryType === 'express') {
            mappedTemplateId = 'template_order_express_ship';
          } else if (deliveryType === 'local') {
            mappedTemplateId = 'template_order_local_ship';
          }
        } else if (scenario === 'delivered') {
          if (deliveryType === 'express') {
            mappedTemplateId = 'template_order_express_ship';
          } else if (deliveryType === 'local') {
            mappedTemplateId = 'template_order_local_ship';
          }
        }

        if (mappedTemplateId) {
          const result = await db.collection('notification_templates').where({ _id: mappedTemplateId }).get();
          if (result.data && result.data.length > 0) {
            template = result.data[0];
          }
        }
      }

      // 根据通知类型和场景查询
      // 处理订单发货场景，根据配送方式选择不同模板
      if (notificationType === 'orderStatusChange' && scenario === 'shipping' && deliveryType) {
        let templateIdPrefix;
        if (deliveryType === 'express') {
          templateIdPrefix = 'template_order_express_ship';
        } else if (deliveryType === 'local') {
          templateIdPrefix = 'template_order_local_ship';
        }
        
        if (templateIdPrefix) {
          const result = await db.collection('notification_templates').where({ _id: templateIdPrefix }).get();
          if (result.data && result.data.length > 0) {
            template = result.data[0];
          }
        }
      }
      
      // 订单状态通知不做模糊模板回退，避免拿错模板（例如paid误匹配到pending模板）
      if (notificationType === 'orderStatusChange' && !template) {
        return null;
      }

      // 如果没有找到特定模板，使用通用查询
      if (!template) {
        // 兼容集合中的字段名称（templateType 对应 type）
        let result;
        try {
          // 先尝试使用 templateType 字段
          result = await db.collection('notification_templates').where({
            templateType: notificationType
          }).get();
          
          // 如果没有找到，尝试使用 type 字段
          if (!result.data || result.data.length === 0) {
            result = await db.collection('notification_templates').where({
              type: notificationType
            }).get();
          }
          
          if (result.data && result.data.length > 0) {
            // 从结果中找到最匹配的模板
            template = result.data.find(t => {
              // 简单的场景匹配逻辑
              return t._id.includes(scenario) || (t.templateName && t.templateName.includes(scenario)) || (t.name && t.name.includes(scenario));
            }) || result.data[0];
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

/**
 * 替换模板变量
 */
function replaceTemplateVariables(content, data) {
  if (!content) return content;
  
  let result = content;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\{\{${key}\}\}`, 'g');
    result = result.replace(regex, value);
  }
  return result;
}

/**
 * 保存通知记录到数据库
 */
async function saveNotificationRecord(openid, notificationType, data, extras, template) {
  try {
    console.log('=== 开始保存通知记录 ===');
    console.log('用户:', openid);
    console.log('通知类型:', notificationType);
    console.log('通知数据:', data);
    console.log('额外参数:', extras);
    console.log('模板:', template);
    
    // 替换模板变量
    const title = replaceTemplateVariables(template.title, data);
    const content = replaceTemplateVariables(template.content, data);
    
    console.log('替换后的标题:', title);
    console.log('替换后的内容:', content);
    
    // 检查用户是否是管理员
    let isAdmin = false;
    try {
      const adminRes = await db.collection('admin_users').where({ openid: openid }).get();
      if (adminRes.data && adminRes.data.length > 0) {
        isAdmin = true;
      }
    } catch (error) {
      console.error('检查管理员身份失败:', error);
    }
    
    // 保存通知记录到notifications集合
    const result = await db.collection('notifications').add({
      data: {
        openid: openid,
        type: notificationType,
        title: title,
        content: content,
        data: data,
        extras: extras,
        status: 'unread',
        isAdmin: isAdmin,
        isDelete: false,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });
    
    console.log(`保存通知记录成功，用户: ${openid}, 记录ID: ${result._id}`);
    return true;
  } catch (error) {
    console.error('保存通知记录失败:', error);
    // 记录错误日志
    try {
      await logNotificationError('saveNotificationRecord', error, {
        openid: openid,
        notificationType: notificationType,
        templateId: extras?.templateId
      });
    } catch (logError) {
      console.error('记录错误日志失败:', logError);
    }
    return false;
  }
}

/**
 * 记录通知错误日志到数据库
 */
async function logNotificationError(errorType, error, context) {
  try {
    await db.collection('errorMessage').add({
      data: {
        type: 'notification',
        errorType: errorType,
        errorMessage: error.message || error.toString(),
        context: context,
        stack: error.stack,
        createdAt: new Date()
      }
    });
    console.log('错误日志记录成功');
  } catch (logError) {
    console.error('记录错误日志失败:', logError);
  }
}

/**
 * 发送小程序通知
 */
async function sendMiniProgramNotification(openid, template, data) {
  try {
    // 替换模板变量
    const title = replaceTemplateVariables(template.title, data);
    const content = replaceTemplateVariables(template.content, data);
    
    // 这里实现小程序通知的发送逻辑
    // 暂时使用console.log模拟
    console.log(`发送小程序通知给 ${openid}:`);
    console.log('标题:', title);
    console.log('内容:', content);
    
    // TODO: 实现实际的小程序通知发送
    // 例如：使用云开发的消息推送能力
    
    return true;
  } catch (error) {
    console.error('发送小程序通知失败:', error);
    return false;
  }
}

/**
 * 发送微信模板消息
 */
async function sendWechatTemplateMessage(openid, template, data, page) {
  try {
    // 构建模板消息数据
    const templateData = {};
    if (template.variables && Array.isArray(template.variables)) { // 兼容集合中的字段名称（variables 对应 dataKeys）
      template.variables.forEach(key => {
        if (data[key]) {
          templateData[key] = {
            value: data[key]
          };
        }
      });
    }
    
    // 这里实现微信模板消息的发送逻辑
    // 暂时使用console.log模拟
    const templateId = template.templateId || template.wechatTemplateId; // 兼容集合中的字段名称
    console.log(`发送微信模板消息给 ${openid}:`);
    console.log('模板ID:', templateId);
    console.log('模板数据:', templateData);
    console.log('跳转页面:', page);
    
    // TODO: 实现实际的微信模板消息发送
    // 例如：使用 wx.cloud.callFunction 调用相关接口
    
    return true;
  } catch (error) {
    console.error('发送微信模板消息失败:', error);
    return false;
  }
}

/**
 * 处理订单状态变化通知
 */
async function handleOrderStatusChangeNotification(openid, data, extras) {
  console.log(`处理订单状态变化通知，用户: ${openid}, 订单: ${extras?.orderId}`);
  
  // 根据订单状态获取对应的模板
  let scenario = data.status || 'pending';
  if (scenario === 'cancelled' && /超时|自动取消/.test(data.cancelReason || '')) {
    scenario = 'expired_cancelled';
  }
  const deliveryType = data.deliveryType;
  let template = await getNotificationTemplate(extras?.templateId, 'orderStatusChange', scenario, deliveryType);
  
  // 如果没有找到模板，使用默认模板并记录错误
  if (!template) {
    console.warn('未找到订单状态变化通知模板，使用默认模板');
    // 记录错误日志
    await logNotificationError('templateNotFound', new Error('未找到订单状态变化通知模板'), {
      notificationType: 'orderStatusChange',
      scenario: scenario,
      deliveryType: deliveryType,
      templateId: extras?.templateId
    });
    const defaultTemplateByScenario = {
      pending: {
        title: '订单创建成功',
        content: '您的订单 #{{orderNumber}} 已创建成功，请在{{countDown}}分钟内完成支付'
      },
      paid: {
        title: '订单支付成功',
        content: '您的订单 #{{orderNumber}} 已支付成功，我们将尽快为您处理'
      },
      shipping: {
        title: '订单已发货',
        content: '您的订单 #{{orderNumber}} 已发货，请注意查收'
      },
      delivered: {
        title: '订单配送中',
        content: '您的订单 #{{orderNumber}} 正在配送中，请留意收货'
      },
      completed: {
        title: '订单已完成',
        content: '您的订单 #{{orderNumber}} 已完成，感谢您的支持'
      },
      cancelled: {
        title: '订单已取消',
        content: '您的订单 #{{orderNumber}} 已取消'
      },
      expired_cancelled: {
        title: '订单已过期',
        content: '您的订单 #{{orderNumber}} 因超时未支付已自动取消'
      },
      refund: {
        title: '售后申请已提交',
        content: '您的订单 #{{orderNumber}} 售后申请已提交，我们将尽快处理'
      },
      refund_completed: {
        title: '售后处理完成',
        content: '您的订单 #{{orderNumber}} 售后处理已完成，请查看处理结果'
      }
    };

    const fallback = defaultTemplateByScenario[scenario] || {
      title: '订单状态更新通知',
      content: '您的订单 #{{orderNumber}} 状态已更新为 {{status}}'
    };

    template = {
      title: fallback.title,
      content: fallback.content,
      templateType: 'orderStatusChange',
      type: 'orderStatusChange'
    };
  }
  
  console.log('使用模板:', template.title);
  
    // 对于pending状态，从settings读取countDown并处理时间占位符
    if (scenario === 'pending') {
      try {
        const settingsRes = await db.collection('settings').get();
        if (settingsRes.data && settingsRes.data.length > 0) {
          const setting = settingsRes.data[0];
          if (setting.countDown && typeof setting.countDown === 'number') {
            // 统一使用countDown变量，并兼容旧变量countDownMinutes
            data.countDown = setting.countDown;
            data.countDownMinutes = setting.countDown;
            console.log('从settings获取倒计时时间:', setting.countDown, '分钟');
          }
        }
      } catch (error) {
        console.error('读取settings中的countDown字段失败:', error);
      }

      // 兼容历史模板中硬编码“30分钟”的情况，替换为配置值
      if (data.countDown && template && typeof template.content === 'string') {
        template.content = template.content.replace(/请在\d+分钟内完成支付/g, `请在${data.countDown}分钟内完成支付`);
      }
    }
  
  // 保存通知记录到数据库
  await saveNotificationRecord(openid, 'orderStatusChange', data, extras, template);
  
    // 发送小程序通知
    await sendMiniProgramNotification(openid, template, data);
  
    // 发送微信模板消息（如果配置了）
    if (template.templateId) { // 兼容集合中的字段名称（templateId 对应 wechatTemplateId）
      const page = `/pages/order-detail/index?id=${extras?.orderId}`;
      await sendWechatTemplateMessage(openid, template, data, page);
    }
}

/**
 * 处理活动通知
 */
async function handleActivityNotification(openid, data, extras) {
  console.log(`处理活动通知，用户: ${openid}, 活动: ${extras?.activityId}`);
  
  // 处理数据字段，确保与模板变量匹配
  const processedData = {
    ...data,
    title: data.activityName || data.title,
    description: data.activityDesc || data.description
  };
  
  let template = await getNotificationTemplate(extras?.templateId, 'activity', extras?.scenario || 'general');
  
  // 如果没有找到模板，使用默认模板并记录错误
  if (!template) {
    console.warn('未找到活动通知模板，使用默认模板');
    // 记录错误日志
    await logNotificationError('templateNotFound', new Error('未找到活动通知模板'), {
      notificationType: 'activity',
      scenario: extras?.scenario || 'general',
      templateId: extras?.templateId
    });
    // 使用默认模板
    template = {
      title: '活动通知',
      content: '{{title}}，{{description}}',
      templateType: 'activity',
      type: 'activity'
    };
  }
  
  console.log('使用模板:', template.title);
  
  // 保存通知记录到数据库
  await saveNotificationRecord(openid, 'activity', processedData, extras, template);
  
  // 发送小程序通知
  await sendMiniProgramNotification(openid, template, processedData);
  
  // 发送微信模板消息（如果配置了）
  if (template.wechatTemplateId) {
    const page = extras?.page || '/pages/activity/index';
    await sendWechatTemplateMessage(openid, template, processedData, page);
  }
}

/**
 * 处理系统通知
 */
async function handleSystemNotification(openid, data, extras) {
  console.log(`处理系统通知，用户: ${openid}`);
  
  // 处理数据字段，确保与模板变量匹配
  const processedData = {
    ...data,
    content: data.content || data.announcementContent
  };
  
  let template = await getNotificationTemplate(extras?.templateId, 'system', extras?.scenario || 'general');
  
  // 如果没有找到模板，使用默认模板并记录错误
  if (!template) {
    console.warn('未找到系统通知模板，使用默认模板');
    // 记录错误日志
    await logNotificationError('templateNotFound', new Error('未找到系统通知模板'), {
      notificationType: 'system',
      scenario: extras?.scenario || 'general',
      templateId: extras?.templateId
    });
    // 使用默认模板
    template = {
      title: '系统通知',
      content: '{{content}}',
      templateType: 'system',
      type: 'system'
    };
  }
  
  console.log('使用模板:', template.title);
  
  // 保存通知记录到数据库
  await saveNotificationRecord(openid, 'system', processedData, extras, template);
  
  // 发送小程序通知
  await sendMiniProgramNotification(openid, template, processedData);
  
  // 发送微信模板消息（如果配置了）
  if (template.wechatTemplateId) {
    const page = extras?.page || '/pages/index/index';
    await sendWechatTemplateMessage(openid, template, processedData, page);
  }
}

/**
 * 处理补货通知
 */
async function handleRestockNotification(openid, data, extras) {
  console.log(`处理补货通知，用户: ${openid}, 商品: ${extras?.productId}`);
  
  let template = await getNotificationTemplate(extras?.templateId, 'restock', 'general');
  
  // 如果没有找到模板，使用默认模板并记录错误
  if (!template) {
    console.warn('未找到补货通知模板，使用默认模板');
    // 记录错误日志
    await logNotificationError('templateNotFound', new Error('未找到补货通知模板'), {
      notificationType: 'restock',
      scenario: 'general',
      templateId: extras?.templateId
    });
    // 使用默认模板
    template = {
      title: '商品补货通知',
      content: '{{productName}} 已补货，快来购买吧！',
      templateType: 'restock',
      type: 'restock'
    };
  }
  
  console.log('使用模板:', template.title);
  
  // 保存通知记录到数据库
  await saveNotificationRecord(openid, 'restock', data, extras, template);
  console.log('保存补货通知记录成功');
  
  // 发送小程序通知
  await sendMiniProgramNotification(openid, template, data);
  
  // 发送微信模板消息（如果配置了）
  if (template.wechatTemplateId) {
    const page = `/pages/product-detail/index?id=${extras?.productId}`;
    await sendWechatTemplateMessage(openid, template, data, page);
  }
}

/**
 * 处理通用通知
 */
async function handleGeneralNotification(openid, data, extras) {
  console.log(`处理通用通知，用户: ${openid}`);
  
  let template = await getNotificationTemplate(extras?.templateId, 'general', 'general');
  
  // 如果没有找到模板，使用默认模板并记录错误
  if (!template) {
    console.warn('未找到通用通知模板，使用默认模板');
    // 记录错误日志
    await logNotificationError('templateNotFound', new Error('未找到通用通知模板'), {
      notificationType: 'general',
      scenario: 'general',
      templateId: extras?.templateId
    });
    // 使用默认模板
    template = {
      title: '通知',
      content: '{{content}}',
      templateType: 'general',
      type: 'general'
    };
  }
  
  console.log('使用模板:', template.title);
  
  // 保存通知记录到数据库
  await saveNotificationRecord(openid, 'general', data, extras, template);
  
  // 发送小程序通知
  await sendMiniProgramNotification(openid, template, data);
  
  // 发送微信模板消息（如果配置了）
  if (template.wechatTemplateId) {
    const page = extras?.page || '/pages/index/index';
    await sendWechatTemplateMessage(openid, template, data, page);
  }
}