---
name: "data-comparison"
description: "数据对比与增量更新策略，通过对比新旧数据的关键字段，避免无效的 setData 操作导致 UI 闪烁，实现静默更新用户体验。Invoke when implementing data comparison and incremental update for miniprogram applications."
---

# 数据对比与增量更新策略

## 核心问题

小程序中频繁调用 `setData` 会导致：
- **UI 闪烁**：不必要的数据更新导致页面重新渲染
- **性能下降**：频繁的 `setData` 会阻塞主线程
- **用户体验差**：数据无变化时用户仍能感知到页面跳动

## 解决方案

通过精细的数据对比，只在数据真正变化时才更新 UI：

```
┌─────────────────────────────────────────────────────────────────────┐
│                        后台刷新数据                                 │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                    ┌───────────────────────┐
                    │  从数据库获取最新数据   │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │  对比新旧数据关键字段   │
                    │  (_compareSeriesList) │
                    └───────────┬───────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
                 有变化                    无变化
                    │                       │
                    ▼                       ▼
              更新缓存 + 更新UI          跳过更新
                    │                       │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │  用户无感知的流畅体验   │
                    └───────────────────────┘
```

## 关键实现

### 1. 关键字段对比

```javascript
_compareSeriesList(oldList, newList) {
  if (!oldList || !newList) return true;
  if (oldList.length !== newList.length) return true;
  
  for (let i = 0; i < oldList.length; i++) {
    const oldSeries = oldList[i];
    const newSeries = newList[i];
    
    // 对比系列基本信息
    if (oldSeries.id !== newSeries.id) return true;
    if (oldSeries.title !== newSeries.title) return true;
    if (oldSeries.subtitle !== newSeries.subtitle) return true;
    if (oldSeries.mainImage !== newSeries.mainImage) return true;
    if (oldSeries.status !== newSeries.status) return true;
    
    // 对比系列中的商品
    if (!oldSeries.products || !newSeries.products) {
      if (oldSeries.products !== newSeries.products) return true;
    } else {
      if (oldSeries.products.length !== newSeries.products.length) return true;
      
      for (let j = 0; j < oldSeries.products.length; j++) {
        const oldProduct = oldSeries.products[j];
        const newProduct = newSeries.products[j];
        
        if (!oldProduct || !newProduct) {
          if (oldProduct !== newProduct) return true;
        } else {
          // 对比商品关键字段
          if (oldProduct._id !== newProduct._id) return true;
          if (oldProduct.name !== newProduct.name) return true;
          if (oldProduct.price !== newProduct.price) return true;
          if (oldProduct.stock !== newProduct.stock) return true;
          if (oldProduct.status !== newProduct.status) return true;
          if (oldProduct.isOutOfStock !== newProduct.isOutOfStock) return true;
          if (oldProduct.isOffline !== newProduct.isOffline) return true;
        }
      }
    }
  }
  
  return false;
}
```

### 2. 后台静默刷新（带数据对比）

```javascript
async refreshDataSilently() {
  try {
    const categoryCollection = getCollection('category');
    const productsCollection = getCollection('products');
    
    const [categoryRes, productsRes] = await Promise.all([
      categoryCollection.where({ status: 'on' }).orderBy('createTime', 'desc').get(),
      productsCollection.get()
    ]);
    
    const categories = categoryRes.data;
    const products = productsRes.data;
    
    // 构建最新的系列数据
    const freshSeriesList = categories.slice(0, 3).map(category => {
      const seriesProducts = products.filter(
        product => product.categoryId === category._id && product.status === 'on'
      );
      return {
        id: category._id,
        title: category.name,
        subtitle: category.subtitle,
        mainImage: category.image,
        products: seriesProducts.slice(0, 3).map(product => ({
          ...product,
          isOutOfStock: product.stock <= 0 && product.status === 'on',
          isOffline: product.status !== 'on'
        }))
      };
    });
    
    // 对比缓存数据
    const cachedSeriesList = this.data.seriesList;
    const hasChanges = this._compareSeriesList(cachedSeriesList, freshSeriesList);
    
    if (hasChanges) {
      console.log('[首页] 检测到数据变化，静默更新');
      
      // 转换 cloud:// URL
      await batchConvertCloudUrls(freshSeriesList, IMAGE_KEYS);
      
      // 静默更新 UI
      this.setData({ seriesList: freshSeriesList });
      
      // 更新缓存
      const rawCachedData = wx.getStorageSync('homeData') || {};
      const cachedData = JSON.parse(JSON.stringify(rawCachedData));
      wx.setStorageSync('homeData', {
        ...cachedData,
        seriesList: freshSeriesList,
        timestamp: Date.now()
      });
      
      // 预加载商品详情数据
      const allProductIds = freshSeriesList.flatMap(series => 
        series.products.map(p => p._id)
      );
      this.preloadProductData(allProductIds);
    } else {
      console.log('[首页] 数据无变化，无需更新');
    }
  } catch (err) {
    console.error('[首页] 静默刷新失败:', err);
    errorLogger.logDatabaseError({
      pageName: 'home',
      methodName: 'refreshDataSilently',
      message: err.message || String(err)
    });
  }
}
```

### 3. 系列数据异步刷新（带对比）

```javascript
async _asyncRefreshCategory() {
  const TIMEOUT = 8000;
  
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Timeout')), TIMEOUT);
  });
  
  const refreshPromise = this._doRefreshCategory();
  
  try {
    const result = await Promise.race([refreshPromise, timeoutPromise]);
    
    if (result && result.changed) {
      console.log('[首页] 系列数据刷新成功，已静默更新UI');
    } else if (result && !result.changed) {
      console.log('[首页] 系列数据无变化，跳过更新');
    }
  } catch (error) {
    if (error.message === 'Timeout') {
      console.warn('[首页] 系列数据刷新超时，保持旧数据');
    } else {
      console.error('[首页] 系列数据刷新失败，保持旧数据', error);
    }
  }
}

async _doRefreshCategory() {
  try {
    const categoryCollection = getCollection('category');
    const productsCollection = getCollection('products');
    
    const [categoryRes, productsRes] = await Promise.all([
      categoryCollection.where({ status: 'on' }).orderBy('createTime', 'desc').get(),
      productsCollection.get()
    ]);
    
    const categories = categoryRes.data;
    const products = productsRes.data;
    
    // 构建新的系列数据
    const newSeriesList = categories.slice(0, 3).map(category => {
      const seriesProducts = products.filter(
        p => p.categoryId === category._id && p.status === 'on'
      );
      return {
        id: category._id,
        title: category.name,
        subtitle: category.subtitle,
        mainImage: category.image,
        status: category.status,
        products: seriesProducts.slice(0, 3).map(product => ({
          ...product,
          isOutOfStock: product.stock <= 0 && product.status === 'on',
          isOffline: product.status !== 'on'
        }))
      };
    });
    
    // 对比是否有变化
    const hasChanged = this._compareSeriesList(this.data.seriesList, newSeriesList);
    
    if (hasChanged) {
      await batchConvertCloudUrls({ seriesList: newSeriesList }, IMAGE_KEYS);
      
      this.setData({ seriesList: newSeriesList });
      
      const cachedData = wx.getStorageSync('homeData');
      if (cachedData) {
        const clonedData = JSON.parse(JSON.stringify(cachedData));
        clonedData.seriesList = newSeriesList;
        wx.setStorageSync('homeData', clonedData);
      }
      
      return { changed: true };
    } else {
      return { changed: false };
    }
  } catch (error) {
    throw error;
  }
}
```

### 4. 版本号对比

```javascript
async _asyncCheckAndUpdate(isFirstEntry = false) {
  try {
    // ... 其他检查步骤
    
    // 步骤5: 检查全局监听器是否更新了缓存
    const homeData = wx.getStorageSync('homeData');
    const currentVersion = this._lastUpdateVersion || 0;
    const cacheVersion = homeData?.updateVersion || 0;
    
    if (cacheVersion > currentVersion) {
      this._lastUpdateVersion = cacheVersion;
      
      // 只有当页面数据为空时才更新 UI
      const needsUpdate = !this.data.seriesList || this.data.seriesList.length === 0;
      
      if (needsUpdate && homeData.seriesList && homeData.seriesList.length > 0) {
        this.setData({
          seriesList: homeData.seriesList,
          newProducts: homeData.newProducts || [],
          bannerList: homeData.bannerList || []
        });
      } else if (!needsUpdate) {
        console.log('[首页] 页面已有数据，跳过 UI 更新（后台静默更新）');
      }
      
      return;
    }
    
    // ... 其他检查步骤
  } catch (error) {
    console.error('[首页] 异步检测更新失败:', error);
  }
}
```

## 对比策略

### 1. 深度对比 vs 浅度对比

| 对比方式 | 优点 | 缺点 | 适用场景 |
|----------|------|------|----------|
| **关键字段对比** | 精确控制，性能好 | 需要维护对比字段 | 数据结构复杂 |
| **JSON.stringify** | 实现简单 | 性能差，对时间戳敏感 | 数据结构简单 |
| **版本号对比** | 性能最好 | 需要额外维护版本号 | 数据更新频繁 |

### 2. 多层次对比

```javascript
_compareSeriesList(oldList, newList) {
  // 第一层：数组长度对比
  if (oldList.length !== newList.length) return true;
  
  // 第二层：系列基本信息对比
  for (let i = 0; i < oldList.length; i++) {
    if (oldList[i].id !== newList[i].id) return true;
    if (oldList[i].title !== newList[i].title) return true;
    
    // 第三层：商品列表对比
    if (oldList[i].products.length !== newList[i].products.length) return true;
    
    // 第四层：商品基本信息对比
    for (let j = 0; j < oldList[i].products.length; j++) {
      if (oldList[i].products[j]._id !== newList[i].products[j]._id) return true;
      if (oldList[i].products[j].price !== newList[i].products[j].price) return true;
    }
  }
  
  return false;
}
```

## 性能优化

### 1. 提前返回

在对比过程中，一旦发现差异立即返回：

```javascript
if (oldSeries.id !== newSeries.id) return true;
```

### 2. 缓存对比结果

对于复杂数据结构，缓存对比结果避免重复计算：

```javascript
async refreshDataSilently() {
  const freshSeriesList = await this._fetchLatestData();
  
  // 对比缓存
  const hasChanges = this._compareSeriesList(this.data.seriesList, freshSeriesList);
  
  if (hasChanges) {
    // 更新 UI 和缓存
  }
}
```

### 3. 避免不必要的 setData

```javascript
// 错误：每次都调用 setData
this.setData({ seriesList: freshSeriesList });

// 正确：只在有变化时调用
if (hasChanges) {
  this.setData({ seriesList: freshSeriesList });
}
```

### 4. 批量更新

将多个 `setData` 合并为一个：

```javascript
// 错误：多次 setData
this.setData({ seriesList: freshSeriesList });
this.setData({ newProducts: freshNewProducts });
this.setData({ bannerList: freshBanners });

// 正确：合并为一次
this.setData({
  seriesList: freshSeriesList,
  newProducts: freshNewProducts,
  bannerList: freshBanners
});
```

## 最佳实践

1. **精细对比**：只对比关键字段，避免因时间戳等无关字段导致误判
2. **提前返回**：一旦发现差异立即返回，避免不必要的对比
3. **条件更新**：只在数据真正变化时才调用 `setData`
4. **批量操作**：合并多个 `setData` 为一次调用
5. **缓存策略**：更新完成后同步更新缓存，避免下次重复对比
6. **静默更新**：后台刷新时不显示加载状态，用户无感知

## 常见陷阱

1. ❌ 使用 `JSON.stringify` 对比复杂数据（性能差，对时间戳敏感）
2. ❌ 每次刷新都调用 `setData`（导致 UI 闪烁）
3. ❌ 对比字段不完整（遗漏关键变化）
4. ❌ 没有更新缓存（下次刷新重复对比）
5. ❌ 深度对比时没有提前返回（性能浪费）

## 代码参考

本项目中的实现：

- 数据对比方法：[_compareSeriesList](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js#L1458)
- 后台静默刷新：[refreshDataSilently](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js#L1189)
- 系列异步刷新：[_asyncRefreshCategory](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js#L1352)
- 版本号对比：[_asyncCheckAndUpdate](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js#L316)

## 适用场景

- **首页**：需要频繁刷新但不应影响用户体验
- **列表页面**：数据量大，对比能减少不必要的更新
- **实时更新**：全局监听器推送更新时需要判断是否真的有变化
- **后台刷新**：静默刷新场景，用户无感知

## 扩展应用

### 通用对比工具函数

```javascript
function compareObjects(oldObj, newObj, keys) {
  for (const key of keys) {
    if (oldObj[key] !== newObj[key]) return true;
  }
  return false;
}

function compareArrays(oldArr, newArr, compareFn) {
  if (oldArr.length !== newArr.length) return true;
  for (let i = 0; i < oldArr.length; i++) {
    if (compareFn(oldArr[i], newArr[i])) return true;
  }
  return false;
}
```

### 多层级数据对比

```javascript
const compareProduct = (oldP, newP) => {
  const keys = ['_id', 'name', 'price', 'stock', 'status'];
  return compareObjects(oldP, newP, keys);
};

const compareSeries = (oldS, newS) => {
  const keys = ['id', 'title', 'subtitle', 'mainImage'];
  if (compareObjects(oldS, newS, keys)) return true;
  return compareArrays(oldS.products, newS.products, compareProduct);
};

const hasChanges = compareArrays(oldSeriesList, newSeriesList, compareSeries);
```