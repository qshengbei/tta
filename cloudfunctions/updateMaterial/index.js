// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const { materialId, updateData } = event
  
  try {
    console.log('更新布料，materialId:', materialId)
    console.log('更新数据:', updateData)
    
    // 执行更新操作
    const result = await db.collection('material').doc(materialId).update({
      data: updateData
    })
    
    console.log('更新结果:', result)
    
    // 验证更新是否成功
    const updatedMaterial = await db.collection('material').doc(materialId).get()
    console.log('更新后布料数据:', updatedMaterial.data)
    
    return {
      success: true,
      result: result,
      updatedMaterial: updatedMaterial.data
    }
  } catch (error) {
    console.error('更新布料失败:', error)
    return {
      success: false,
      error: error
    }
  }
}