const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

exports.main = async (event, context) => {
  try {
    const openid = cloud.getWXContext().OPENID;
    if (!openid) {
      return { success: false, error: '获取用户信息失败' };
    }

    const orderCounts = {
      pending: 0,
      paid: 0,
      shipping: 0,
      delivered: 0,
      completed: 0,
      refund: 0
    };

    const pickupCounts = {
      pending: 0,
      paid: 0,
      completed: 0
    };

    const localCounts = {
      pending: 0,
      paid: 0,
      shipping: 0,
      completed: 0
    };

    const res = await db.collection('orders')
      .aggregate()
      .match({
        _openid: openid,
        isDeleted: _.neq(true)
      })
      .group({
        _id: {
          deliveryType: '$deliveryType',
          status: '$status'
        },
        count: $.sum(1)
      })
      .end();

    const groups = res.list || [];

    groups.forEach(group => {
      const deliveryType = group._id.deliveryType || '';
      const status = group._id.status || '';
      const count = group.count || 0;

      if (deliveryType === 'pickup') {
        if (pickupCounts[status] !== undefined) {
          pickupCounts[status] += count;
        }
      } else if (deliveryType === 'local') {
        if (localCounts[status] !== undefined) {
          localCounts[status] += count;
        }
      } else {
        if (status === 'completed' || status === 'refund_completed') {
          orderCounts.completed += count;
        } else if (status === 'refund') {
          orderCounts.refund += count;
        } else if (orderCounts[status] !== undefined) {
          orderCounts[status] += count;
        }
      }
    });

    const hasPickupOrders = Object.values(pickupCounts).reduce((sum, count) => sum + count, 0) > 0;
    const hasLocalOrders = Object.values(localCounts).reduce((sum, count) => sum + count, 0) > 0;

    return {
      success: true,
      orderCounts,
      pickupCounts,
      localCounts,
      hasPickupOrders,
      hasLocalOrders
    };
  } catch (error) {
    console.error('获取订单数量失败:', error);
    return { success: false, error: error.message || '获取订单数量失败' };
  }
};