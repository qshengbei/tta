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
    // 未收到货退款（配送未完成，实付运费随退款退还）
    afterSalesType = 'refund_not_received';
  } else if (type === 'exchange') {
    afterSalesType = 'exchange';
  } else if (refundType === 'refund_only' || type === 'refund') {
    // 仅退款（已收到货）：买家保留商品、无需寄回，不涉及发货运费退/扣与寄回运费补偿
    // 与订单详情页售后表单提交口径保持一致（refund_received）
    afterSalesType = 'refund_received';
  } else if (refundType === 'return_refund' || type === 'return') {
    // 退货退款：根据原因类型判断，质量原因使用 quality_refund（15天时效，需寄回），其他使用 refund（7天）
    if (qualityReasons.includes(reason)) {
      afterSalesType = 'quality_refund';
    } else {
      afterSalesType = 'refund';
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

    if (action === 'getDetail') {
      // 查询售后详情
      const { caseId, orderId } = data;
      
      console.log('查询售后详情，caseId:', caseId, 'orderId:', orderId);
      
      if (!caseId && !orderId) {
        return {
          success: false,
          error: '缺少参数'
        };
      }
      
      let query = db.collection('after_sales_cases');
      
      if (caseId) {
        query = query.doc(caseId);
      } else if (orderId) {
        query = query.where({ orderId }).limit(1);
      }
      
      const res = await query.get();
      
      if (res.data) {
        const afterSales = caseId ? res.data : (res.data[0] || null);
        if (afterSales) {
          return {
            success: true,
            data: afterSales
          };
        }
      }
      
      return {
        success: false,
        error: '售后记录不存在'
      };
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
