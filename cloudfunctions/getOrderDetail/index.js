// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const { orderId } = event
  
  try {
    console.log('获取订单详情，订单ID:', orderId)
    
    if (!orderId) {
      return {
        success: false,
        error: '缺少订单ID'
      }
    }
    
    // 查询订单详情
    const res = await db.collection('orders').doc(orderId).get()
    
    if (res.data) {
      console.log('订单详情:', res.data)
      return {
        success: true,
        order: res.data
      }
    } else {
      return {
        success: false,
        error: '订单不存在'
      }
    }
  } catch (error) {
    console.error('获取订单详情失败:', error)
    return {
      success: false,
      error: error.message || '获取订单详情失败'
    }
  }
}