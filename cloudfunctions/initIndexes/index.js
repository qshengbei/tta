/**
 * 数据库索引初始化云函数
 * 
 * ⚠️ 注意：微信云数据库不支持通过云函数直接创建索引
 * 此云函数用于：
 * 1. 输出索引配置建议，方便用户在控制台创建
 * 2. 生成索引配置文档
 * 3. 诊断查询性能问题
 * 
 * 使用方式：
 * 1. 在云开发控制台调用此云函数
 * 2. 根据返回的索引建议在控制台创建索引
 * 
 * 在控制台创建索引步骤：
 * 1. 登录微信云开发控制台：https://cloud.weixin.qq.com/
 * 2. 进入 数据库 -> 选择集合 -> 索引管理
 * 3. 点击 "新建索引" 按钮
 * 4. 根据本云函数返回的建议添加索引
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/**
 * 索引配置定义
 * 所有需要创建的索引（按优先级分类）
 */
const INDEX_CONFIGS = {
  // ============ 🔴 P0 关键性能索引 ============
  
  // 订单集合 - 用户订单查询（最常用）
  orders_user_status_updated: {
    collection: 'orders',
    priority: 'P0',
    name: 'idx_orders_user_status_updated',
    description: '用户订单列表（按状态筛选+时间排序）',
    usage: '用户查看自己的订单列表，按状态分类',
    fields: [
      { fieldPath: '_openid', orderType: 'asc' },
      { fieldPath: 'isDeleted', orderType: 'asc' },
      { fieldPath: 'status', orderType: 'asc' },
      { fieldPath: 'updatedAt', orderType: 'desc' }
    ]
  },
  
  orders_user_updated: {
    collection: 'orders',
    priority: 'P0',
    name: 'idx_orders_user_updated',
    description: '用户全部订单（实时监听）',
    usage: '订单实时监听、全部订单查询',
    fields: [
      { fieldPath: '_openid', orderType: 'asc' },
      { fieldPath: 'isDeleted', orderType: 'asc' },
      { fieldPath: 'updatedAt', orderType: 'desc' }
    ]
  },
  
  // 商品集合 - 首页/分类商品查询
  products_deleted_status_time: {
    collection: 'products',
    priority: 'P0',
    name: 'idx_products_deleted_status_time',
    description: '首页/分类商品列表',
    usage: '首页新品推荐、分类页商品列表',
    fields: [
      { fieldPath: 'isDeleted', orderType: 'asc' },
      { fieldPath: 'status', orderType: 'asc' },
      { fieldPath: 'createTime', orderType: 'desc' }
    ]
  },
  
  products_deleted_typeid_time: {
    collection: 'products',
    priority: 'P0',
    name: 'idx_products_deleted_typeid_time',
    description: '分类商品查询',
    usage: '按分类筛选商品列表',
    fields: [
      { fieldPath: 'isDeleted', orderType: 'asc' },
      { fieldPath: 'typeId', orderType: 'asc' },
      { fieldPath: 'createTime', orderType: 'desc' }
    ]
  },
  
  // 会话集合 - 消息列表
  sessions_userid_time: {
    collection: 'sessions',
    priority: 'P0',
    name: 'idx_sessions_userid_time',
    description: '用户会话列表',
    usage: '消息页用户会话列表',
    fields: [
      { fieldPath: 'userId', orderType: 'asc' },
      { fieldPath: 'lastMessageTime', orderType: 'desc' }
    ]
  },
  
  sessions_cs_time: {
    collection: 'sessions',
    priority: 'P0',
    name: 'idx_sessions_cs_time',
    description: '客服会话列表',
    usage: '客服端会话列表查询',
    fields: [
      { fieldPath: 'customerServiceId', orderType: 'asc' },
      { fieldPath: 'lastMessageTime', orderType: 'desc' }
    ]
  },
  
  sessions_active: {
    collection: 'sessions',
    priority: 'P0',
    name: 'idx_sessions_active',
    description: '客服分配（最少会话优先）',
    usage: '自动分配客服时查询最少会话的客服',
    fields: [
      { fieldPath: 'activeSessions', orderType: 'asc' }
    ]
  },
  
  // 消息集合
  messages_session_time: {
    collection: 'messages',
    priority: 'P0',
    name: 'idx_messages_session_time',
    description: '会话消息列表',
    usage: '聊天页面消息列表查询',
    fields: [
      { fieldPath: 'sessionId', orderType: 'asc' },
      { fieldPath: 'createTime', orderType: 'desc' }
    ]
  },
  
  // 通知集合
  notifications_openid_time: {
    collection: 'notifications',
    priority: 'P0',
    name: 'idx_notifications_openid_time',
    description: '用户通知列表',
    usage: '消息页通知列表查询',
    fields: [
      { fieldPath: 'openid', orderType: 'asc' },
      { fieldPath: 'createdAt', orderType: 'desc' }
    ]
  },
  
  notifications_openid_status_time: {
    collection: 'notifications',
    priority: 'P0',
    name: 'idx_notifications_openid_status_time',
    description: '未读通知查询',
    usage: '查询用户未读通知',
    fields: [
      { fieldPath: 'openid', orderType: 'asc' },
      { fieldPath: 'status', orderType: 'asc' },
      { fieldPath: 'createdAt', orderType: 'desc' }
    ]
  },
  
  // 购物车集合
  cart_openid_deleted_time: {
    collection: 'cart',
    priority: 'P0',
    name: 'idx_cart_openid_deleted_time',
    description: '用户购物车列表',
    usage: '购物车页面商品列表',
    fields: [
      { fieldPath: '_openid', orderType: 'asc' },
      { fieldPath: 'isDelete', orderType: 'asc' },
      { fieldPath: 'updatedAt', orderType: 'desc' }
    ]
  },
  
  // 售后案例集合
  after_cases_openid_time: {
    collection: 'after_sales_cases',
    priority: 'P0',
    name: 'idx_after_cases_openid_time',
    description: '用户售后列表',
    usage: '售后页面列表查询',
    fields: [
      { fieldPath: '_openid', orderType: 'asc' },
      { fieldPath: 'createdAt', orderType: 'desc' }
    ]
  },
  
  after_cases_openid_status_time: {
    collection: 'after_sales_cases',
    priority: 'P0',
    name: 'idx_after_cases_openid_status_time',
    description: '用户售后列表（按状态）',
    usage: '售后页面按状态筛选',
    fields: [
      { fieldPath: '_openid', orderType: 'asc' },
      { fieldPath: 'status', orderType: 'asc' },
      { fieldPath: 'createdAt', orderType: 'desc' }
    ]
  },
  
  // 售后案例明细集合
  after_items_case_time: {
    collection: 'after_sales_case_items',
    priority: 'P0',
    name: 'idx_after_items_case_time',
    description: '售后明细列表',
    usage: '售后详情页商品明细',
    fields: [
      { fieldPath: 'caseId', orderType: 'asc' },
      { fieldPath: 'createdAt', orderType: 'asc' }
    ]
  },
  
  // ============ 🟡 P1 重要优化索引 ============
  
  orders_status_created: {
    collection: 'orders',
    priority: 'P1',
    name: 'idx_orders_status_created',
    description: '管理员订单列表（按状态+时间）',
    usage: '后台订单管理页面',
    fields: [
      { fieldPath: 'status', orderType: 'asc' },
      { fieldPath: 'createdAt', orderType: 'desc' }
    ]
  },
  
  orders_status_updated: {
    collection: 'orders',
    priority: 'P1',
    name: 'idx_orders_status_updated',
    description: '订单状态查询',
    usage: '按状态批量查询订单',
    fields: [
      { fieldPath: 'status', orderType: 'asc' },
      { fieldPath: 'updatedAt', orderType: 'desc' }
    ]
  },
  
  orders_delivery_type: {
    collection: 'orders',
    priority: 'P1',
    name: 'idx_orders_delivery_type',
    description: '按配送类型筛选',
    usage: '区分快递/自提/同城配送订单',
    fields: [
      { fieldPath: 'deliveryType', orderType: 'asc' }
    ]
  },
  
  products_deleted_typeid: {
    collection: 'products',
    priority: 'P1',
    name: 'idx_products_deleted_typeid',
    description: '分类商品统计',
    usage: '分类页商品数量统计',
    fields: [
      { fieldPath: 'isDeleted', orderType: 'asc' },
      { fieldPath: 'typeId', orderType: 'asc' }
    ]
  },
  
  products_status_time: {
    collection: 'products',
    priority: 'P1',
    name: 'idx_products_status_time',
    description: '商品列表（按状态+时间）',
    usage: '商品管理页面列表',
    fields: [
      { fieldPath: 'status', orderType: 'asc' },
      { fieldPath: 'createTime', orderType: 'desc' }
    ]
  },
  
  products_categoryid: {
    collection: 'products',
    priority: 'P1',
    name: 'idx_products_categoryid',
    description: '按大类查询商品',
    usage: '首页分类商品筛选',
    fields: [
      { fieldPath: 'categoryId', orderType: 'asc' }
    ]
  },
  
  sessions_last_time: {
    collection: 'sessions',
    priority: 'P1',
    name: 'idx_sessions_last_time',
    description: '全局按最后消息排序',
    usage: '全局会话排序',
    fields: [
      { fieldPath: 'lastMessageTime', orderType: 'desc' }
    ]
  },
  
  messages_sessionid: {
    collection: 'messages',
    priority: 'P1',
    name: 'idx_messages_sessionid',
    description: '按会话查询消息数',
    usage: '统计会话消息数量',
    fields: [
      { fieldPath: 'sessionId', orderType: 'asc' }
    ]
  },
  
  notifications_status_updated: {
    collection: 'notifications',
    priority: 'P1',
    name: 'idx_notifications_status_updated',
    description: '管理员通知管理',
    usage: '后台通知管理页面',
    fields: [
      { fieldPath: 'status', orderType: 'asc' },
      { fieldPath: 'updatedAt', orderType: 'desc' }
    ]
  },
  
  cart_openid_time: {
    collection: 'cart',
    priority: 'P1',
    name: 'idx_cart_openid_time',
    description: '购物车实时监听',
    usage: '购物车数据变化监听',
    fields: [
      { fieldPath: '_openid', orderType: 'asc' },
      { fieldPath: 'updatedAt', orderType: 'desc' }
    ]
  },
  
  after_cases_orderid: {
    collection: 'after_sales_cases',
    priority: 'P1',
    name: 'idx_after_cases_orderid',
    description: '按订单查询售后',
    usage: '订单详情页关联售后查询',
    fields: [
      { fieldPath: 'orderId', orderType: 'asc' }
    ]
  },
  
  after_cases_status_time: {
    collection: 'after_sales_cases',
    priority: 'P1',
    name: 'idx_after_cases_status_time',
    description: '管理员售后列表',
    usage: '后台售后管理页面',
    fields: [
      { fieldPath: 'status', orderType: 'asc' },
      { fieldPath: 'createdAt', orderType: 'desc' }
    ]
  },
  
  after_items_orderid: {
    collection: 'after_sales_case_items',
    priority: 'P1',
    name: 'idx_after_items_orderid',
    description: '按订单查询售后明细',
    usage: '订单关联售后商品明细',
    fields: [
      { fieldPath: 'orderId', orderType: 'asc' }
    ]
  },
  
  category_status_time: {
    collection: 'category',
    priority: 'P1',
    name: 'idx_category_status_time',
    description: '启用分类列表',
    usage: '分类管理页面',
    fields: [
      { fieldPath: 'status', orderType: 'asc' },
      { fieldPath: 'createTime', orderType: 'desc' }
    ]
  },
  
  types_level_parent_sort: {
    collection: 'product_types',
    priority: 'P1',
    name: 'idx_types_level_parent_sort',
    description: '商品类型层级查询',
    usage: '分类选择器层级展示',
    fields: [
      { fieldPath: 'level', orderType: 'asc' },
      { fieldPath: 'parentId', orderType: 'asc' },
      { fieldPath: 'sort', orderType: 'asc' }
    ]
  },
  
  types_parent_sort: {
    collection: 'product_types',
    priority: 'P1',
    name: 'idx_types_parent_sort',
    description: '子级类型排序',
    usage: '子分类排序展示',
    fields: [
      { fieldPath: 'parentId', orderType: 'asc' },
      { fieldPath: 'sort', orderType: 'asc' }
    ]
  },
  
  types_sort: {
    collection: 'product_types',
    priority: 'P1',
    name: 'idx_types_sort',
    description: '类型全局排序',
    usage: '类型管理排序',
    fields: [
      { fieldPath: 'sort', orderType: 'asc' }
    ]
  },
  
  // ============ 🟢 P2 可选优化索引 ============
  
  after_logs_case_time: {
    collection: 'after_sales_logs',
    priority: 'P2',
    name: 'idx_after_logs_case_time',
    description: '售后日志查询',
    usage: '售后详情页日志记录',
    fields: [
      { fieldPath: 'caseId', orderType: 'asc' },
      { fieldPath: 'createdAt', orderType: 'asc' }
    ]
  },
  
  reverse_orderid: {
    collection: 'reverse_logistics',
    priority: 'P2',
    name: 'idx_reverse_orderid',
    description: '按订单查询物流',
    usage: '逆向物流查询',
    fields: [
      { fieldPath: 'orderId', orderType: 'asc' }
    ]
  },
  
  templates_type: {
    collection: 'notification_templates',
    priority: 'P2',
    name: 'idx_templates_type',
    description: '按类型查询模板',
    usage: '通知模板管理',
    fields: [
      { fieldPath: 'type', orderType: 'asc' }
    ]
  }
};

/**
 * 生成控制台创建索引的指南
 */
function generateConsoleGuide() {
  return `
╔══════════════════════════════════════════════════════════════════════════════╗
║                         微信云开发控制台创建索引指南                          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  1. 登录微信云开发控制台                                                      ║
║     https://cloud.weixin.qq.com/                                            ║
║                                                                              ║
║  2. 进入数据库                                                                ║
║     左侧菜单 -> 数据库 -> 选择环境                                            ║
║                                                                              ║
║  3. 选择集合并创建索引                                                        ║
║     - 选择目标集合                                                            ║
║     - 点击「索引管理」标签                                                    ║
║     - 点击「新建索引」按钮                                                    ║
║     - 根据下方建议添加索引字段                                                ║
║                                                                              ║
║  4. 索引类型说明                                                              ║
║     - asc: 升序索引，适用于等值查询和范围查询                                 ║
║     - desc: 降序索引，适用于倒序排序                                         ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`;
}

/**
 * 按集合分组索引配置
 */
function groupIndexesByCollection() {
  const grouped = {};
  
  Object.values(INDEX_CONFIGS).forEach(config => {
    const collection = config.collection;
    if (!grouped[collection]) {
      grouped[collection] = {
        collection,
        priority: config.priority,
        indexes: []
      };
    }
    grouped[collection].indexes.push({
      name: config.name,
      description: config.description,
      usage: config.usage,
      fields: config.fields
    });
  });
  
  return grouped;
}

/**
 * 生成 Markdown 格式的索引文档
 */
function generateMarkdownDoc() {
  const grouped = groupIndexesByCollection();
  let md = '# 数据库索引配置文档\n\n';
  md += '> 生成时间：' + new Date().toLocaleString('zh-CN') + '\n\n';
  
  md += '## 索引优先级说明\n\n';
  md += '- 🔴 **P0 (关键性能)**: 必须创建，影响核心功能性能\n';
  md += '- 🟡 **P1 (重要优化)**: 建议创建，提升查询效率\n';
  md += '- 🟢 **P2 (可选优化)**: 根据需要创建\n\n';
  
  md += '---\n\n';
  
  // 按优先级排序输出
  const priorityOrder = ['P0', 'P1', 'P2'];
  
  priorityOrder.forEach(priority => {
    md += `## 🔴 ${priority} 关键索引\n\n`;
    
    Object.values(grouped)
      .filter(g => g.priority === priority)
      .sort((a, b) => a.collection.localeCompare(b.collection))
      .forEach(group => {
        md += `### ${group.collection}\n\n`;
        md += `| 索引名称 | 描述 | 字段 |\n`;
        md += `|---------|------|------|\n`;
        
        group.indexes.forEach(idx => {
          const fields = idx.fields.map(f => `${f.fieldPath}(${f.orderType === 'asc' ? '↑' : '↓'})`).join(' + ');
          md += `| ${idx.name} | ${idx.description} | ${fields} |\n`;
        });
        
        md += '\n';
      });
  });
  
  return md;
}

/**
 * 主函数：获取索引配置
 */
async function getIndexConfig(options = {}) {
  const { format = 'json', priority } = options;
  
  console.log('getIndexConfig called with options:', options);
  
  // 按优先级筛选
  let configs = Object.values(INDEX_CONFIGS);
  if (priority) {
    configs = configs.filter(c => c.priority === priority);
  }
  
  // 按集合分组
  const grouped = groupIndexesByCollection();
  
  // 按优先级排序
  const priorityOrder = ['P0', 'P1', 'P2'];
  const sortedGrouped = {};
  priorityOrder.forEach(p => {
    Object.values(grouped)
      .filter(g => g.priority === p)
      .sort((a, b) => a.collection.localeCompare(b.collection))
      .forEach(g => {
        sortedGrouped[g.collection] = g;
      });
  });
  
  const result = {
    success: true,
    totalIndexes: configs.length,
    grouped: sortedGrouped,
    consoleGuide: generateConsoleGuide(),
    markdownDoc: generateMarkdownDoc(),
    priority
  };
  
  // 如果指定了集合，添加详细信息
  if (options.collection) {
    result.collectionIndexes = sortedGrouped[options.collection] || null;
  }
  
  return result;
}

/**
 * 诊断查询性能问题
 */
async function diagnoseQuery(collectionName, query) {
  console.log('Diagnosing query for collection:', collectionName);
  
  const suggestions = [];
  
  // 检查是否有对应的索引
  Object.values(INDEX_CONFIGS)
    .filter(c => c.collection === collectionName)
    .forEach(config => {
      // 检查查询字段是否在索引中
      const queryFields = Object.keys(query);
      const indexFields = config.fields.map(f => f.fieldPath);
      
      const hasMatch = queryFields.some(qf => 
        indexFields.includes(qf) || 
        indexFields.some(if_ => if_.startsWith(qf))
      );
      
      if (hasMatch) {
        suggestions.push({
          indexName: config.name,
          description: config.description,
          matchFields: queryFields.filter(qf => 
            indexFields.includes(qf)
          )
        });
      }
    });
  
  return {
    collection: collectionName,
    query,
    suggestions,
    message: suggestions.length > 0 
      ? '找到匹配的索引配置' 
      : '未找到匹配的索引，请参考控制台创建'
  };
}

/**
 * 云函数入口
 */
exports.main = async (event, context) => {
  console.log('initIndexes function called with event:', event);
  console.log('action:', event.action);
  
  try {
    switch (event.action) {
      case 'getConfig':
        // 获取索引配置
        return await getIndexConfig({
          format: event.format,
          priority: event.priority,
          collection: event.collection
        });
      
      case 'diagnose':
        // 诊断查询性能
        return await diagnoseQuery(event.collection, event.query || {});
      
      case 'getMarkdown':
        // 获取 Markdown 格式文档
        return {
          success: true,
          markdown: generateMarkdownDoc()
        };
      
      case 'getConsoleGuide':
        // 获取控制台指南
        return {
          success: true,
          guide: generateConsoleGuide()
        };
      
      default:
        // 默认返回完整配置
        return await getIndexConfig({
          format: event.format,
          priority: event.priority
        });
    }
  } catch (error) {
    console.error('initIndexes function error:', error);
    
    return {
      success: false,
      message: '索引配置获取失败',
      error: error.message || error.errMsg,
      stack: error.stack
    };
  }
};

/**
 * 导出索引配置（供其他模块使用）
 */
exports.INDEX_CONFIGS = INDEX_CONFIGS;
