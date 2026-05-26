const cloud = require('wx-server-sdk');

cloud.init();
const db = cloud.database();
const _ = db.command;

function mapCategoryToRawTypes(type) {
  const typeMap = {
    '订单状态变更': ['orderStatusChange'],
    '商品补货': ['restock'],
    '活动通知': ['activity'],
    '系统通知': ['system'],
    '欢迎通知': ['welcome'],
    '其他通知': ['general']
  };

  return typeMap[type] || [];
}

async function updateSingleNotification(id, status, openid) {
  if (!id) {
    throw new Error('通知ID不能为空');
  }

  const whereData = {
    _id: id,
    openid
  };

  const result = await db.collection('notifications').where(whereData).update({
    data: {
      status,
      updatedAt: new Date()
    }
  });

  return result.stats.updated || 0;
}

async function deleteSingleNotification(id, openid) {
  if (!id) {
    throw new Error('通知ID不能为空');
  }

  const result = await db.collection('notifications').where({
    _id: id,
    openid
  }).update({
    data: {
      isDelete: true,
      updatedAt: new Date()
    }
  });

  return result.stats.updated || 0;
}

async function updateAllNotifications(openid, type, status) {
  const query = {
    openid,
    status: 'unread'
  };

  const rawTypes = mapCategoryToRawTypes(type);
  if (rawTypes.length > 0) {
    query.type = rawTypes.length === 1 ? rawTypes[0] : _.in(rawTypes);
  }

  // 直接批量更新，不先查询，减少数据库操作和触发的watch回调
  let updatedCount = 0;
  let hasMore = true;
  let lastId = null;

  while (hasMore) {
    const currentQuery = { ...query };
    if (lastId) {
      // 使用_id作为分页游标，避免使用orderBy造成性能问题
      currentQuery._id = _.gt(lastId);
    }

    // 先查询一批ID（每次最多100条）
    const listResult = await db.collection('notifications')
      .where(currentQuery)
      .limit(100)
      .orderBy('_id', 'asc')
      .get();

    const matchedIds = (listResult.data || []).map(item => item._id).filter(Boolean);
    if (matchedIds.length === 0) {
      hasMore = false;
      break;
    }

    // 批量更新
    const result = await db.collection('notifications').where({
      _id: _.in(matchedIds),
      openid
    }).update({
      data: {
        status,
        updatedAt: new Date()
      }
    });

    updatedCount += result.stats.updated || 0;
    lastId = matchedIds[matchedIds.length - 1];
    hasMore = matchedIds.length === 100;

    // 短暂延迟，避免触发过多watch回调
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  return updatedCount;
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const {
    action,
    id,
    type,
    status = 'read'
  } = event;

  const openid = event.openid || wxContext.OPENID;

  try {
    if (!openid) {
      throw new Error('用户OPENID不能为空');
    }

    if (action === 'single') {
      const updatedCount = await updateSingleNotification(id, status, openid);
      return {
        success: true,
        updatedCount
      };
    }

    if (action === 'all') {
      const updatedCount = await updateAllNotifications(openid, type, status);
      return {
        success: true,
        updatedCount
      };
    }

    if (action === 'delete') {
      const updatedCount = await deleteSingleNotification(id, openid);
      return {
        success: true,
        updatedCount
      };
    }

    throw new Error('不支持的操作类型');
  } catch (error) {
    console.error('更新通知状态失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
};