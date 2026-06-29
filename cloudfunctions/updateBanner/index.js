// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const { bannerId, image, link, sortOrder, isActive } = event
  
  console.log('updateBanner - bannerId:', bannerId)
  console.log('updateBanner - sortOrder:', sortOrder)
  
  try {
    const result = await db.collection('banner').doc(bannerId).update({
      data: {
        image: image,
        link: link,
        sortOrder: sortOrder,
        isActive: isActive,
        updatedAt: db.serverDate()
      }
    })
    
    console.log('updateBanner - result:', result)
    
    if (result.stats && result.stats.updated === 0) {
      // update 失败，尝试 set（可能文档不存在）
      console.log('updateBanner - trying set')
      const setResult = await db.collection('banner').doc(bannerId).set({
        data: {
          image: image,
          link: link,
          sortOrder: sortOrder,
          isActive: isActive,
          isBanner: true,
          isDeleted: false,
          updatedAt: db.serverDate()
        }
      })
      console.log('updateBanner - set result:', setResult)
      return setResult
    }
    
    return result
  } catch (err) {
    console.error('updateBanner - error:', err)
    throw err
  }
}