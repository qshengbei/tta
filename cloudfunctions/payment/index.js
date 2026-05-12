const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event, context) => {
  console.log('=== 支付云函数被调用 ===')
  console.log('event:', JSON.stringify(event))
  
  const { action = '', orderId = '', amount = 0, body = '', openid = '' } = event
  
  try {
    switch (action) {
      case 'unifiedOrder':
        return await handleUnifiedOrder(event)
      case 'query':
        return await queryOrder(event)
      case 'notify':
        return await handleNotify(event)
      case 'refund':
        return await handleRefund(event)
      default:
        return {
          success: false,
          error: '无效的操作类型',
          data: null
        }
    }
  } catch (err) {
    console.error('支付处理失败:', err)
    return {
      success: false,
      error: err.message || '支付处理失败',
      data: null
    }
  }
}

async function handleUnifiedOrder({ orderId, amount, body, openid }) {
  console.log('=== 统一下单 ===')
  console.log('orderId:', orderId)
  console.log('amount:', amount)
  console.log('body:', body)
  
  if (!orderId) {
    throw new Error('缺少订单ID')
  }
  
  if (amount <= 0) {
    throw new Error('支付金额必须大于0')
  }
  
  const tradeNo = `TN${Date.now()}${Math.random().toString(36).substr(2, 8).toUpperCase()}`
  const now = new Date()
  
  const paymentResult = {
    success: true,
    message: '统一下单成功',
    data: {
      tradeNo,
      orderId,
      amount: Number(amount),
      body: body || '商品订单',
      status: 'SUCCESS',
      createTime: now,
      payment: {
        timeStamp: String(Math.floor(Date.now() / 1000)),
        nonceStr: Math.random().toString(36).substr(2, 15),
        package: `prepay_id=prepay_${Date.now()}`,
        signType: 'MD5',
        paySign: '模拟签名_' + Date.now()
      },
      message: '支付成功'
    }
  }
  
  await db.collection('payment_records').add({
    data: {
      _id: tradeNo,
      orderId,
      amount: Number(amount),
      body: body || '商品订单',
      status: 'success',
      tradeNo,
      transactionId: `TRANS${Date.now()}`,
      createTime: now,
      payTime: now,
      openid: openid || ''
    }
  })
  
  console.log('=== 支付记录创建成功 ===')
  console.log('tradeNo:', tradeNo)
  
  return paymentResult
}

async function queryOrder({ orderId, tradeNo, transactionId }) {
  console.log('=== 查询订单 ===')
  
  let query = db.collection('payment_records')
  
  if (tradeNo) {
    query = query.doc(tradeNo)
  } else if (orderId) {
    query = query.where({ orderId })
  } else if (transactionId) {
    query = query.where({ transactionId })
  } else {
    throw new Error('缺少查询参数：tradeNo、orderId 或 transactionId')
  }
  
  const result = await query.get()
  
  return {
    success: true,
    message: '查询成功',
    data: tradeNo ? result.data : result.data
  }
}

async function handleNotify(event) {
  console.log('=== 支付回调处理 ===')
  console.log('event:', JSON.stringify(event))
  
  return {
    success: true,
    message: '支付回调处理成功',
    data: {
      return_code: 'SUCCESS',
      return_msg: 'OK'
    }
  }
}

async function handleRefund({ orderId, tradeNo, amount, reason }) {
  console.log('=== 支付退款 ===')
  console.log('orderId:', orderId)
  console.log('amount:', amount)
  
  if (!orderId && !tradeNo) {
    throw new Error('缺少必要参数：orderId 或 tradeNo')
  }
  
  const refundId = `RF${Date.now()}${Math.random().toString(36).substr(2, 8).toUpperCase()}`
  const now = new Date()
  
  await db.collection('payment_records').add({
    data: {
      _id: refundId,
      orderId: orderId || '',
      tradeNo: tradeNo || '',
      amount: -Math.abs(Number(amount)),
      body: '退款',
      status: 'refunded',
      refundId,
      reason: reason || '用户申请退款',
      createTime: now,
      refundTime: now
    }
  })
  
  return {
    success: true,
    message: '退款成功',
    data: {
      refundId,
      amount: Number(amount),
      status: 'SUCCESS',
      message: '退款已原路退回，预计1-3个工作日到账',
      createTime: now
    }
  }
}