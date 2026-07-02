const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const {
    status,
    deliveryType,
    searchKeyword,
    timeRange,
    category,
    pageSize = 18,
    lastUpdatedAtTs,
    lastId,
    isFirstPage = true
  } = event;

  try {
    const openid = cloud.getWXContext().OPENID;
    if (!openid) {
      return { success: false, error: '获取用户信息失败' };
    }

    const conditions = [{
      _openid: openid,
      isDeleted: _.neq(true)
    }];

    if (deliveryType) {
      conditions.push({ deliveryType });
    }

    if (status === 'all') {
    } else if (status === 'shipping') {
      conditions.push({ status: _.in(['shipping', 'delivered']) });
    } else if (status === 'refund') {
      conditions.push({ status: _.in(['refund', 'refund_completed']) });
    } else if (status === 'completed') {
      conditions.push({ status: _.in(['completed', 'refund_completed']) });
    } else if (status) {
      conditions.push({ status });
    }

    // 搜索关键词：使用 db.RegExp 在数据库层面查询订单编号或商品名称
    if (searchKeyword && searchKeyword.trim()) {
      const keyword = searchKeyword.trim();
      conditions.push(_.or([
        {
          orderNumber: db.RegExp({
            regexp: keyword,
            options: 'i'
          })
        },
        {
          productsNames: db.RegExp({
            regexp: keyword,
            options: 'i'
          })
        }
      ]));
    }

    if (!isFirstPage && lastUpdatedAtTs && lastId) {
      const cursorCondition = _.or([
        { updatedAtTs: _.lt(lastUpdatedAtTs) },
        { updatedAtTs: _.eq(lastUpdatedAtTs), _id: _.lt(lastId) }
      ]);
      conditions.push(cursorCondition);
    }

    if (timeRange) {
      const now = Date.now();
      let startTime;
      switch (timeRange) {
        case '7days':
          startTime = now - 7 * 24 * 60 * 60 * 1000;
          break;
        case '30days':
          startTime = now - 30 * 24 * 60 * 60 * 1000;
          break;
        case '90days':
          startTime = now - 90 * 24 * 60 * 60 * 1000;
          break;
        default:
          startTime = null;
      }
      if (startTime) {
        conditions.push({ updatedAtTs: _.gt(startTime) });
      }
    }

    if (category && category.length > 0) {
      conditions.push({
        'products.typeId': _.in(category)
      });
    }

    let query = db.collection('orders').where(_.and(conditions));

    const fetchLimit = Math.min(pageSize + 1, 20);
    query = query.orderBy('updatedAtTs', 'desc').orderBy('_id', 'desc').limit(fetchLimit);

    const res = await query.get();
    const allOrders = res.data || [];

    const hasMore = allOrders.length > pageSize;
    const returnOrders = hasMore ? allOrders.slice(0, pageSize) : allOrders;

    let newLastUpdatedAtTs = null;
    let newLastId = null;
    if (returnOrders.length > 0) {
      const lastItem = returnOrders[returnOrders.length - 1];
      newLastUpdatedAtTs = lastItem.updatedAtTs;
      newLastId = lastItem._id;
    }

    return {
      success: true,
      data: returnOrders,
      hasMore,
      lastUpdatedAtTs: newLastUpdatedAtTs,
      lastId: newLastId
    };
  } catch (error) {
    console.error('查询订单失败:', error);
    return { success: false, error: error.message || '查询订单失败' };
  }
};