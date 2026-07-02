async function logOrderOperation(db, {
  orderId,
  orderNumber,
  openid,
  action,
  fromStatus,
  toStatus,
  operatorType,
  operatorId,
  operatorName,
  reason,
  remark,
  detail
}) {
  try {
    const now = new Date();
    const record = {
      orderId,
      orderNumber,
      _openid: openid,
      action,
      fromStatus,
      toStatus,
      operatorType,
      operatorId: operatorId || '',
      operatorName: operatorName || '',
      reason: reason || '',
      remark: remark || '',
      detail: detail || {},
      operatedAt: now,
      operatedAtTs: now.getTime(),
      createdAt: now
    };

    await db.collection('order_operation_logs').add({
      data: record
    });

    console.log('[OrderLogHelper] 记录订单操作日志:', action, orderNumber);
    return true;
  } catch (error) {
    console.error('[OrderLogHelper] 记录订单操作日志失败:', action, orderNumber, error);
    
    try {
      await db.collection('errorMessage').add({
        data: {
          type: 'order_operation_log_error',
          source: 'OrderLogHelper',
          location: `orderId=${orderId},action=${action}`,
          message: error.message || '记录订单操作日志失败',
          stack: error.stack || '',
          code: error.code || '',
          functionName: 'logOrderOperation',
          inputParams: JSON.stringify({
            orderId,
            orderNumber,
            action,
            fromStatus,
            toStatus,
            operatorType
          }),
          userId: openid || '',
          timestamp: Date.now(),
          createdAt: new Date()
        }
      });
      console.log('[OrderLogHelper] 错误已记录到 errorMessage 集合');
    } catch (logErr) {
      console.error('[OrderLogHelper] 写入 errorMessage 失败:', logErr);
    }
    
    return false;
  }
}

module.exports = { logOrderOperation };