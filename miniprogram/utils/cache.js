// 数据缓存工具模块

// 缓存键名前缀
const CACHE_PREFIX = 'tta_';

// 缓存过期时间（毫秒）
const CACHE_EXPIRY = {
  product: 5 * 60 * 1000, // 5分钟
  expressRules: 30 * 60 * 1000, // 30分钟
  address: 24 * 60 * 60 * 1000, // 24小时
};

/**
 * 设置缓存
 * @param {string} key - 缓存键名
 * @param {any} data - 缓存数据
 * @param {number} expiry - 过期时间（毫秒）
 */
export function setCache(key, data, expiry = 5 * 60 * 1000) {
  const cacheKey = `${CACHE_PREFIX}${key}`;
  const cacheData = {
    data,
    expiry: Date.now() + expiry
  };
  try {
    wx.setStorageSync(cacheKey, cacheData);
    console.log(`缓存设置成功: ${key}`);
  } catch (err) {
    console.error('缓存设置失败:', err);
  }
}

/**
 * 获取缓存
 * @param {string} key - 缓存键名
 * @returns {any} 缓存数据，如果缓存不存在或已过期则返回null
 */
export function getCache(key) {
  const cacheKey = `${CACHE_PREFIX}${key}`;
  try {
    const cacheData = wx.getStorageSync(cacheKey);
    if (cacheData) {
      if (Date.now() < cacheData.expiry) {
        console.log(`缓存获取成功: ${key}`);
        return cacheData.data;
      } else {
        console.log(`缓存已过期: ${key}`);
        // 移除过期缓存
        removeCache(key);
        return null;
      }
    }
    return null;
  } catch (err) {
    console.error('缓存获取失败:', err);
    return null;
  }
}

/**
 * 移除缓存
 * @param {string} key - 缓存键名
 */
export function removeCache(key) {
  const cacheKey = `${CACHE_PREFIX}${key}`;
  try {
    wx.removeStorageSync(cacheKey);
    console.log(`缓存移除成功: ${key}`);
  } catch (err) {
    console.error('缓存移除失败:', err);
  }
}

/**
 * 清空所有缓存
 */
export function clearAllCache() {
  try {
    const keys = wx.getStorageInfoSync().keys;
    keys.forEach(key => {
      if (key.startsWith(CACHE_PREFIX)) {
        wx.removeStorageSync(key);
      }
    });
    console.log('所有缓存已清空');
  } catch (err) {
    console.error('清空缓存失败:', err);
  }
}

/**
 * 缓存商品详情
 * @param {string} productId - 商品ID
 * @param {Object} product - 商品信息
 */
export function cacheProduct(productId, product) {
  setCache(`product_${productId}`, product, CACHE_EXPIRY.product);
}

/**
 * 获取缓存的商品详情
 * @param {string} productId - 商品ID
 * @returns {Object} 商品信息
 */
export function getCachedProduct(productId) {
  return getCache(`product_${productId}`);
}

/**
 * 缓存快递规则
 * @param {Array} expressRules - 快递规则数组
 */
export function cacheExpressRules(expressRules) {
  setCache('expressRules', expressRules, CACHE_EXPIRY.expressRules);
}

/**
 * 获取缓存的快递规则
 * @returns {Array} 快递规则数组
 */
export function getCachedExpressRules() {
  return getCache('expressRules');
}

/**
 * 缓存地址信息
 * @param {string} openid - 用户openid
 * @param {Object} address - 地址信息
 */
export function cacheAddress(openid, address) {
  setCache(`address_${openid}`, address, CACHE_EXPIRY.address);
}

/**
 * 获取缓存的地址信息
 * @param {string} openid - 用户openid
 * @returns {Object} 地址信息
 */
export function getCachedAddress(openid) {
  return getCache(`address_${openid}`);
}
