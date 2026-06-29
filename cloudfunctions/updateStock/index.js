const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    const { productId, stock, operation, quantity } = event;
    
    if (!productId) {
      return {
        success: false,
        error: '商品ID不能为空'
      };
    }
    
    let newStock;
    
    // 获取商品当前信息
    const productRes = await db.collection('products').doc(productId).get();
    if (!productRes.data) {
      return {
        success: false,
        error: '商品不存在'
      };
    }
    
    const currentProduct = productRes.data;
    const currentStock = currentProduct.stock || 0;
    
    // 根据操作类型计算新库存
    if (operation && quantity) {
      switch (operation) {
        case 'deduct': // 扣减库存
          newStock = currentStock - quantity;
          if (newStock < 0) {
            return {
              success: false,
              error: '库存不足'
            };
          }
          break;
        case 'add': // 增加库存
          newStock = currentStock + quantity;
          break;
        default:
          if (stock === undefined) {
            return {
              success: false,
              error: '库存值不能为空'
            };
          }
          newStock = stock;
      }
    } else if (stock !== undefined) {
      newStock = stock;
    } else {
      return {
        success: false,
        error: '库存值不能为空'
      };
    }
    
    console.log('更新商品库存，商品ID:', productId, '当前库存:', currentStock, '新库存:', newStock);
    
    // 更新商品库存
    const updateResult = await db.collection('products')
      .doc(productId)
      .update({
        data: {
          stock: newStock,
          updatedAt: new Date(),
          updatedAtTs: Date.now()
        }
      });
    
    console.log('更新库存成功:', updateResult);
    
    // 获取更新后的商品信息
    const updatedProductRes = await db.collection('products').doc(productId).get();
    const updatedProduct = updatedProductRes.data;
    
    return {
      success: true,
      data: {
        updateResult,
        product: updatedProduct
      }
    };
  } catch (error) {
    console.error('更新库存失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
};