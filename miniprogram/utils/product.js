// 商品工具模块

import { getCollection } from './cloud';
import { cacheProduct, getCachedProduct } from './cache';

/**
 * 获取商品详情
 * @param {string} productId - 商品ID
 * @returns {Promise<Object>} 商品详情
 */
export async function getProductDetail(productId) {
  // 先尝试从缓存获取
  const cachedProduct = getCachedProduct(productId);
  if (cachedProduct) {
    return cachedProduct;
  }
  
  // 从数据库获取
  const products = getCollection('products');
  try {
    const res = await products.doc(productId).get();
    if (res.data) {
      // 缓存商品信息
      cacheProduct(productId, res.data);
      return res.data;
    }
    return null;
  } catch (err) {
    console.error('获取商品详情失败:', err);
    return null;
  }
}

/**
 * 批量获取商品详情
 * @param {Array<string>} productIds - 商品ID数组
 * @returns {Promise<Map>} 商品详情Map，key为商品ID，value为商品详情
 */
export async function getProductsDetail(productIds) {
  const productMap = new Map();
  const uncachedIds = [];
  
  // 先从缓存获取
  productIds.forEach(productId => {
    const cachedProduct = getCachedProduct(productId);
    if (cachedProduct) {
      productMap.set(productId, cachedProduct);
    } else {
      uncachedIds.push(productId);
    }
  });
  
  // 从数据库获取未缓存的商品
  if (uncachedIds.length > 0) {
    const products = getCollection('products');
    try {
      const productPromises = uncachedIds.map(productId => 
        products.doc(productId).get()
          .then(res => {
            if (res.data) {
              cacheProduct(productId, res.data);
              productMap.set(productId, res.data);
            }
          })
          .catch(err => {
            console.error(`获取商品详情失败: ${productId}`, err);
          })
      );
      
      await Promise.all(productPromises);
    } catch (err) {
      console.error('批量获取商品详情失败:', err);
    }
  }
  
  return productMap;
}

/**
 * 检查商品是否已售罄
 * @param {Object} product - 商品信息
 * @returns {boolean} 是否已售罄
 */
export function isProductSoldOut(product) {
  return !product.stock || product.stock <= 0;
}

/**
 * 格式化商品价格
 * @param {number} price - 商品价格
 * @returns {string} 格式化后的价格
 */
export function formatPrice(price) {
  if (typeof price === 'number') {
    return price.toFixed(2);
  }
  return '0.00';
}

/**
 * 构建商品预览图片数组
 * @param {Object} product - 商品信息
 * @returns {Array<string>} 预览图片数组
 */
export function buildPreviewImages(product) {
  if (!product) return [];
  
  const previewImages = [product.coverImage];
  if (product.images && Array.isArray(product.images)) {
    previewImages.push(...product.images);
  }
  return previewImages;
}

/**
 * 计算商品总数量
 * @param {Array} cartItems - 购物车商品数组
 * @returns {number} 商品总数量
 */
export function calculateTotalQuantity(cartItems) {
  return cartItems.reduce((total, item) => {
    const quantity = typeof item.quantity === 'number' ? item.quantity : 0;
    return total + quantity;
  }, 0);
}

/**
 * 计算购物车总价
 * @param {Array} cartItems - 购物车商品数组
 * @returns {number} 购物车总价
 */
export function calculateCartTotalPrice(cartItems) {
  return cartItems.reduce((total, item) => {
    if (!item.isSoldOut && item.selected) {
      const quantity = typeof item.quantity === 'number' ? item.quantity : 0;
      return total + (item.price * quantity);
    }
    return total;
  }, 0);
}
