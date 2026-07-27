const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event, context) => {
  console.log('=== 退款云函数被调用 ===')
  console.log('event:', JSON.stringify(event))
  
  const { action = '', orderId = '', caseId = '', amount = 0, transactionId = '', outTradeNo = '', reason = '', refundId = '' } = event
  
  try {
    switch (action) {
      case 'create':
        return await handleCreateRefund(event)
      case 'process':
        return await handleProcessRefund(event)
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

async function handleCreateRefund({ orderId, caseId, amount, transactionId, outTradeNo, reason }) {
  console.log('=== 创建待退款记录 ===')
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
  
  if (orderId) {
    try {
      const orderRes = await db.collection('orders').doc(orderId).get()
      order = orderRes.data
      bankType = order?.bankType
    } catch (err) {
      console.error('获取订单信息失败:', err)
    }
  }
  
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
  
  let refundMessage = '退款处理中，预计1-3个工作日到账'
  if (bankType === 'CFT') {
    refundMessage = '退款处理中，微信零钱预计实时到账'
  } else if (bankType) {
    refundMessage = '退款处理中，银行卡预计1-3个工作日到账'
  }
  
  const refundRecord = {
    _id: refundId,
    orderId: orderId || (order?._id || ''),
    caseId: caseId || '',
    amount: Number(amount),
    transactionId: transactionId || '',
    outTradeNo: outTradeNo || (order?.outTradeNo || order?.tradeNo || ''),
    reason: reason || '用户申请退款',
    status: 'pending',
    refundType: '原路退回',
    createTime: now,
    completeTime: null,
    refundNo: refundId,
    result: '',
    message: refundMessage,
    bankType: bankType || '',
    retryCount: 0,
    lastRetryTime: null
  }
  
  await db.collection('refund_records').add({
    data: refundRecord
  })
  
  console.log('=== 待退款记录创建成功 ===')
  console.log('refundId:', refundId)
  
  return {
    success: true,
    message: '待退款记录创建成功',
    data: {
      refundId,
      amount: Number(amount),
      status: 'pending',
      refundNo: refundId,
      message: refundMessage,
      createTime: now,
      bankType: bankType || ''
    }
  }
}

async function handleProcessRefund({ refundId }) {
  console.log('=== 处理退款 ===')
  console.log('refundId:', refundId)
  
  if (!refundId) {
    throw new Error('缺少必要参数：refundId')
  }
  
  const now = new Date()
  
  const refundRes = await db.collection('refund_records').doc(refundId).get()
  const refundRecord = refundRes.data
  
  if (!refundRecord) {
    throw new Error('退款记录不存在')
  }
  
  if (refundRecord.status !== 'pending') {
    console.log(`退款记录状态不是待退款，当前状态: ${refundRecord.status}`)
    return {
      success: true,
      message: '退款记录状态不是待退款，跳过处理',
      data: refundRecord
    }
  }
  
  let success = true
  let result = '退款成功'
  let message = '退款已原路退回，预计1-3个工作日到账'
  
  if (refundRecord.bankType === 'CFT') {
    message = '退款已原路退回微信零钱，实时到账'
  } else if (refundRecord.bankType) {
    message = '退款已原路退回银行卡，预计1-3个工作日到账'
  }
  
  await db.runTransaction(async (transaction) => {
    await transaction.collection('refund_records').doc(refundId).update({
      data: {
        status: success ? 'success' : 'failed',
        result: result,
        message: message,
        completeTime: now,
        retryCount: refundRecord.retryCount + 1,
        lastRetryTime: now
      }
    })
    
    if (success && refundRecord.orderId) {
      await transaction.collection('orders').doc(refundRecord.orderId).update({
        data: {
          refundStatus: 'refunded',
          updatedAt: now,
          updatedAtTs: now.getTime()
        }
      })
    }
  })
  
  console.log('=== 退款处理完成 ===')
  console.log('result:', result)
  
  return {
    success: success,
    message: message,
    data: {
      refundId,
      amount: refundRecord.amount,
      status: success ? 'success' : 'failed',
      refundNo: refundRecord.refundNo,
      message: message,
      completeTime: now
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
