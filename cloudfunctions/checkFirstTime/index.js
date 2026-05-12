// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  try {
    console.log('检查用户是否第一次进入，OPENID:', OPENID)
    
    // 检查用户是否存在
    const userRes = await db.collection('users').where({ _openid: OPENID }).get()
    
    if (userRes.data.length === 0) {
      // 用户不存在，是第一次进入
      console.log('用户第一次进入，创建欢迎消息')
      
      // 创建欢迎消息
      const welcomeMessage = {
        _id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        openid: OPENID,
        title: '欢迎使用小程序',
        content: '欢迎来到我们的小程序！这里有丰富的商品和优质的服务，祝您购物愉快！',
        type: 'welcome',
        status: 'unread',
        isDelete: false,
        createdAt: new Date()
      }
      
      // 保存欢迎消息
      await db.collection('notifications').add({ data: welcomeMessage })
      
      return {
        success: true,
        isFirstTime: true,
        message: '用户第一次进入，已创建欢迎消息'
      }
    } else {
      // 用户已存在，不是第一次进入
      console.log('用户不是第一次进入')
      return {
        success: true,
        isFirstTime: false,
        message: '用户不是第一次进入'
      }
    }
  } catch (error) {
    console.error('检查第一次进入失败', error)
    return {
      success: false,
      error: error.message
    }
  }
}