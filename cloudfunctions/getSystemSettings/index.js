// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  try {
    const res = await db.collection('settings').get()
    if (res.data && res.data.length > 0) {
      const settings = res.data[0]
      return {
        success: true,
        data: settings,
        express100Api: settings.express100Api || []
      }
    }
    return {
      success: false,
      error: '设置不存在',
      express100Api: []
    }
  } catch (error) {
    console.error('获取设置失败:', error)
    return {
      success: false,
      error: '获取设置失败',
      express100Api: []
    }
  }
}
