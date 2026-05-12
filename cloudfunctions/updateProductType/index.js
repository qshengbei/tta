// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const { productTypeId, updateData } = event
  
  try {
    console.log('更新商品类型，productTypeId:', productTypeId)
    console.log('更新数据:', updateData)
    
    // 执行更新操作
    const result = await db.collection('product_types').doc(productTypeId).update({
      data: updateData
    })
    
    console.log('更新结果:', result)
    
    // 验证更新是否成功
    const updatedProductType = await db.collection('product_types').doc(productTypeId).get()
    console.log('更新后商品类型数据:', updatedProductType.data)
    
    return {
      success: true,
      result: result,
      updatedProductType: updatedProductType.data
    }
  } catch (error) {
    console.error('更新商品类型失败:', error)
    return {
      success: false,
      error: error
    }
  }
}