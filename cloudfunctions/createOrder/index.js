const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event, context) => {
  console.log('=== 创建订单云函数被调用 ===')
  console.log('event:', JSON.stringify(event))
  
  const { orderData } = event
  
  if (!orderData || !orderData.products || orderData.products.length === 0) {
    return {
      success: false,
      error: '订单数据或商品信息为空'
    }
  }
  
  try {
    const transactionRes = await db.runTransaction(async (transaction) => {
      const stockUpdates = []
      
      for (const product of orderData.products) {
        if (!product.productId) {
          throw new Error('商品ID为空')
        }
        if (!product.quantity) {
          throw new Error('商品数量为空')
        }
        
        const productRes = await transaction.collection('products').doc(product.productId).get()
        if (!productRes.data) {
          throw new Error(`商品不存在: ${product.productId}`)
        }
        
        const currentStock = productRes.data.stock || 0
        if (currentStock < product.quantity) {
          throw new Error(`商品库存不足: ${product.productId}, 当前库存: ${currentStock}, 需要: ${product.quantity}`)
        }
        
        const newStock = currentStock - product.quantity
        stockUpdates.push({
          productId: product.productId,
          newStock
        })
        
        await transaction.collection('products').doc(product.productId).update({
          data: {
            stock: newStock,
            updatedAt: new Date(),
            updatedAtTs: Date.now()
          }
        })
        
        console.log('扣减库存成功，商品ID:', product.productId, '当前库存:', currentStock, '新库存:', newStock)
      }
      
      const orderRes = await transaction.collection('orders').add({
        data: orderData
      })
      
      console.log('订单创建成功，订单ID:', orderRes._id)
      
      return {
        orderId: orderRes._id,
        stockUpdates
      }
    })
    
    return {
      success: true,
      data: {
        orderId: transactionRes.orderId,
        stockUpdates: transactionRes.stockUpdates
      }
    }
  } catch (error) {
    console.error('创建订单失败:', error)
    return {
      success: false,
      error: error.message || '创建订单失败'
    }
  }
}