// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const { updateData } = event
  
  try {
    console.log('更新系统设置，数据:', updateData)
    
    // 先查询是否存在settings记录
    const settingsRes = await db.collection('settings').get()
    
    if (settingsRes.data && settingsRes.data.length > 0) {
      // 存在记录，执行更新
      const docId = settingsRes.data[0]._id
      console.log('找到settings记录，docId:', docId)
      
      // 添加更新时间
      const dataToUpdate = {
        ...updateData,
        updatedAt: new Date()
      }
      
      const result = await db.collection('settings').doc(docId).update({
        data: dataToUpdate
      })
      
      console.log('更新结果:', result)
      
      // 验证更新是否成功
      const updatedSettings = await db.collection('settings').doc(docId).get()
      console.log('更新后settings数据:', updatedSettings.data)
      
      return {
        success: true,
        result: result,
        updatedSettings: updatedSettings.data
      }
    } else {
      // 不存在记录，执行添加
      console.log('未找到settings记录，执行添加操作')
      
      const dataToAdd = {
        ...updateData,
        createdAt: new Date(),
        updatedAt: new Date()
      }
      
      const result = await db.collection('settings').add({
        data: dataToAdd
      })
      
      console.log('添加结果:', result)
      
      return {
        success: true,
        result: result,
        isNew: true
      }
    }
  } catch (error) {
    console.error('更新系统设置失败:', error)
    return {
      success: false,
      error: error.message || error
    }
  }
}
