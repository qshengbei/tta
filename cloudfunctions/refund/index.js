const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event, context) => {
  console.log('=== 退款云函数被调用 ===')
  console.log('event:', JSON.stringify(event))
  
  const { action = '', orderId = '', caseId = '', amount = 0, transactionId = '', outTradeNo = '', reason = '' } = event
  
  try {
    switch (action) {
      case 'refund':
        return await handleRefund(event)
      case 'query':
        return await queryRefund(event)
      default:
        return {
          success: false,
          error: '无效的操作类型',
          data: null
        }
    }
  } catch (err) {
    console.error('退款处理失败:', err)
    return {
      success: false,
      error: err.message || '退款处理失败',
      data: null
    }
  }
}

async function handleRefund({ orderId, caseId, amount, transactionId, outTradeNo, reason }) {
  console.log('=== 开始处理退款 ===')
  console.log('orderId:', orderId)
  console.log('caseId:', caseId)
  console.log('amount:', amount)
  
  if (!orderId && !caseId) {
    throw new Error('缺少必要参数：orderId 或 caseId')
  }
  
  if (amount <= 0) {
    throw new Error('退款金额必须大于0')
  }
  
  const refundId = `RF${Date.now()}${Math.random().toString(36).substr(2, 8).toUpperCase()}`
  const now = new Date()
  
  let order = null
  let bankType = null
  
  // 先尝试从订单表获取支付方式
  if (orderId) {
    try {
      const orderRes = await db.collection('orders').doc(orderId).get()
      order = orderRes.data
      bankType = order?.bankType
    } catch (err) {
      console.error('获取订单信息失败:', err)
    }
  }
  
  // 如果订单中没有支付方式，尝试从支付记录表获取
  if (!bankType && orderId) {
    try {
      const paymentRes = await db.collection('payment_records')
        .where({ orderId: orderId, status: 'success' })
        .orderBy('createTime', 'desc')
        .limit(1)
        .get()
      if (paymentRes.data && paymentRes.data.length > 0) {
        bankType = paymentRes.data[0].bankType
      }
    } catch (err) {
      console.error('获取支付记录失败:', err)
    }
  }
  
  // 根据支付方式确定退款说明
  let refundMessage = '退款已原路退回'
  if (bankType === 'CFT') {
    // 微信零钱，实时到账
    refundMessage = '退款已原路退回微信零钱，实时到账'
  } else if (bankType) {
    // 银行卡，1-3个工作日到账
    refundMessage = '退款已原路退回银行卡，预计1-3个工作日到账'
  }
  
  const refundRecord = {
    _id: refundId,
    orderId: orderId || (order?._id || ''),
    caseId: caseId || '',
    amount: Number(amount),
    transactionId: transactionId || '',
    outTradeNo: outTradeNo || (order?.outTradeNo || order?.tradeNo || ''),
    reason: reason || '用户申请退款',
    status: 'success',
    refundType: '原路退回',
    createTime: now,
    completeTime: now,
    refundNo: refundId,
    result: '退款成功',
    message: refundMessage,
    bankType: bankType || ''
  }
  
  await db.collection('refund_records').add({
    data: refundRecord
  })
  
  console.log('=== 退款记录创建成功 ===')
  console.log('refundId:', refundId)
  
  return {
    success: true,
    message: '退款成功',
    data: {
      refundId,
      amount: Number(amount),
      status: 'success',
      refundNo: refundId,
      message: refundMessage,
      createTime: now,
      completeTime: now,
      bankType: bankType || ''
    }
  }
}

async function queryRefund({ refundId, orderId, caseId }) {
  console.log('=== 查询退款记录 ===')
  
  let query = db.collection('refund_records')
  
  if (refundId) {
    query = query.doc(refundId)
  } else if (orderId) {
    query = query.where({ orderId })
  } else if (caseId) {
    query = query.where({ caseId })
  } else {
    throw new Error('缺少查询参数：refundId、orderId 或 caseId')
  }
  
  const result = await query.get()
  
  return {
    success: true,
    message: '查询成功',
    data: refundId ? result.data : result.data
  }
}