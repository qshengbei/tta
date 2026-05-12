// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const { categoryId, updateData } = event
  
  try {
    console.log('更新系列，categoryId:', categoryId)
    console.log('更新数据:', updateData)
    
    // 执行更新操作
    const result = await db.collection('category').doc(categoryId).update({
      data: updateData
    })
    
    console.log('更新结果:', result)
    
    // 验证更新是否成功
    const updatedCategory = await db.collection('category').doc(categoryId).get()
    console.log('更新后系列数据:', updatedCategory.data)
    
    return {
      success: true,
      result: result,
      updatedCategory: updatedCategory.data
    }
  } catch (error) {
    console.error('更新系列失败:', error)
    return {
      success: false,
      error: error
    }
  }
}