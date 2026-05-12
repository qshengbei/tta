// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const { sessionId } = event
  const { OPENID } = cloud.getWXContext()

  try {
    console.log('开始清除未读计数，会话ID:', sessionId, '用户OPENID:', OPENID)
    
    if (!sessionId) {
      console.error('会话ID为空')
      return {
        success: false,
        error: '会话ID为空'
      }
    }
    
    // 先查询会话是否存在
    const sessionRes = await db.collection('sessions').doc(sessionId).get()
    console.log('查询会话结果:', sessionRes)
    
    if (!sessionRes.data) {
      console.error('会话不存在')
      return {
        success: false,
        error: '会话不存在'
      }
    }
    
    const session = sessionRes.data
    const isCustomerService = session.customerServiceId === OPENID
    const clearData = {
      unreadCount: 0
    }

    if (isCustomerService) {
      clearData.unreadCountCustomerService = 0
    } else {
      clearData.unreadCountUser = 0
    }
    
    console.log('清除未读数量，会话ID:', sessionId, '用户OPENID:', OPENID, '是否客服:', isCustomerService);
    console.log('清除数据:', clearData);

    // 清除当前查看方未读计数
    const res = await db.collection('sessions').doc(sessionId).update({
      data: clearData
    })
    
    console.log('清除未读计数成功，更新结果:', res)
    
    return {
      success: true,
      result: res
    }
  } catch (error) {
    console.error('清除未读计数失败', error)
    return {
      success: false,
      error: error.message
    }
  }
}