import SmartCache from './smartCache';

// ---- 商品相关 ----
export const productListCache = new SmartCache('cache_products_list', {
  memoryCacheTTL: 30 * 60 * 1000,       // 30 分钟
  storageCacheTTL: 24 * 60 * 60 * 1000  // 24 小时
});

// 商品详情缓存工厂（按 id 区分）
export function getProductDetailCache(productId) {
  return new SmartCache(`cache_product_detail_${productId}`, {
    memoryCacheTTL: 30 * 60 * 1000,
    storageCacheTTL: 24 * 60 * 60 * 1000
  });
}

// ---- 商品分类 ----
export const categoryCache = new SmartCache('cache_categories', {
  memoryCacheTTL: 60 * 60 * 1000,       // 1 小时
  storageCacheTTL: 72 * 60 * 60 * 1000  // 72 小时
});

// ---- 订单相关 ----
// 按状态分开缓存，key 如：cache_orders_list_all / cache_orders_list_pending
export function getOrderListCache(status = 'all') {
  return new SmartCache(`cache_orders_list_${status}`, {
    memoryCacheTTL: 30 * 60 * 1000,
    storageCacheTTL: 8 * 60 * 60 * 1000  // 8 小时
  });
}

export function getOrderDetailCache(orderId) {
  return new SmartCache(`cache_order_detail_${orderId}`, {
    memoryCacheTTL: 30 * 60 * 1000,
    storageCacheTTL: 8 * 60 * 60 * 1000
  });
}

// ---- 会话/消息相关 ----
export const sessionListCache = new SmartCache('cache_sessions_list', {
  memoryCacheTTL: 30 * 60 * 1000,
  storageCacheTTL: 4 * 60 * 60 * 1000   // 4 小时（消息类数据保留时间短一些）
});

// ---- 售后相关 ----
export const afterSalesListCache = new SmartCache('cache_after_sales_list', {
  memoryCacheTTL: 30 * 60 * 1000,
  storageCacheTTL: 8 * 60 * 60 * 1000
});

export function getAfterSalesDetailCache(id) {
  return new SmartCache(`cache_after_sales_detail_${id}`, {
    memoryCacheTTL: 30 * 60 * 1000,
    storageCacheTTL: 8 * 60 * 60 * 1000
  });
}

// ---- 系统配置 ----
export const settingsCache = new SmartCache('cache_settings', {
  memoryCacheTTL: 60 * 60 * 1000,
  storageCacheTTL: 72 * 60 * 60 * 1000
});

/**
 * 退出登录时清除所有用户相关缓存
 * 在 app.js 登出逻辑中调用
 */
export function clearAllUserCache() {
  productListCache.clear();
  categoryCache.clear();
  sessionListCache.clear();
  afterSalesListCache.clear();
  // 按 id 的详情缓存通过遍历 key 前缀清除
  try {
    const keys = wx.getStorageInfoSync().keys;
    keys.forEach(key => {
      if (key.startsWith('cache_')) {
        wx.removeStorageSync(key);
      }
    });
  } catch (e) {
    console.error('[cacheInstances] clearAllUserCache 失败:', e);
  }
}
