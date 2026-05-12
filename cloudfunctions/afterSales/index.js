const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

/**
 * 将前端传来的单商品售后数据转换为 updateOrderStatus 云函数期望的格式
 */
async function convertDataForUpdateOrderStatus(data) {
  const {
    orderId,
    type,
    productIndex,
    contactName,
    contactPhone,
    images,
    description,
    refundType,
    goodsStatus,
    reason,
    reasonLabel,
    amount,
    status
  } = data;

  // 获取订单详情，以获取正确的 orderItemId
  const orderRes = await db.collection('orders').doc(orderId).get();
  if (!orderRes.data) {
    throw new Error('订单不存在');
  }
  const order = orderRes.data;

  // 构造 orderItemId
  const orderItemId = `${orderId}_${productIndex}`;

  // 确定售后类型
  // 先定义质量原因列表
  const qualityReasons = [
    'empty_package', 'lost', 'no_tracking', 'damaged_rejected',
    'size_mismatch', 'color_mismatch', 'material_mismatch', 'fade',
    'quality', 'missing', 'damaged', 'wrong_item'
  ];
  
  let afterSalesType;
  if (refundType === 'not_received' || data.goodsStatus === 'not_received') {
    // 未收到货退款
    afterSalesType = 'refund_not_received';
  } else if (type === 'exchange') {
    afterSalesType = 'exchange';
  } else if (refundType === 'return_refund' || type === 'refund') {
    // 根据原因类型判断：质量原因使用 quality_refund（15天），其他使用 refund（7天）
    if (qualityReasons.includes(reason)) {
      afterSalesType = 'quality_refund'; // 质量问题售后，15天时效
    } else {
      afterSalesType = 'refund'; // 普通售后，7天时效
    }
  } else {
    afterSalesType = 'refund'; // 默认使用普通售后
  }

  // 获取该商品的数量
  const product = order.products && order.products[productIndex];
  const applyQty = product ? (product.quantity || 1) : 1;

  // 构造参数
  const params = {
    items: [{
      orderItemId: orderItemId,
      orderItemIndex: productIndex,
      applyQty: applyQty,
      afterSalesType: afterSalesType,
      applyRefundAmount: amount
    }],
    proofImages: images || [],
    proofVideos: [],
    reasonCode: reason || '',
    reason: reasonLabel || '',
    description: description || '',
    contactName: contactName,
    contactPhone: contactPhone
  };

  return params;
}

exports.main = async (event, context) => {
  const { action, data } = event;

  try {
    console.log('售后云函数被调用，action:', action, 'data:', data);

    if (action === 'create') {
      // 创建售后申请
      const params = await convertDataForUpdateOrderStatus(data);

      // 调用 updateOrderStatus 云函数
      const result = await cloud.callFunction({
        name: 'updateOrderStatus',
        data: {
          orderId: data.orderId,
          operation: 'applyAfterSales',
          params: params
        }
      });

      console.log('updateOrderStatus 云函数调用结果:', result);

      // 返回结果
      return result.result || result;
    }

    return {
      success: false,
      error: '不支持的操作类型'
    };
  } catch (error) {
    console.error('售后云函数执行失败:', error);
    return {
      success: false,
      error: error.message || '售后申请失败'
    };
  }
};
