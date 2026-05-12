// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const { productId, updateData } = event
  
  try {
    console.log('更新商品，productId:', productId)
    console.log('更新数据:', updateData)
    
    // 执行更新操作
    const result = await db.collection('products').doc(productId).update({
      data: updateData
    })
    
    console.log('更新结果:', result)
    
    // 验证更新是否成功
    const updatedProduct = await db.collection('products').doc(productId).get()
    console.log('更新后商品数据:', updatedProduct.data)
    
    return {
      success: true,
      result: result,
      updatedProduct: updatedProduct.data
    }
  } catch (error) {
    console.error('更新商品失败:', error)
    return {
      success: false,
      error: error
    }
  }
}