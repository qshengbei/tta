---
name: "page-lifecycle-cache"
description: "页面生命周期与数据缓存策略，通过区分首次进入和返回场景，实现'先显示缓存→后台异步校验→静默更新'的完整流程，优化页面返回时的用户体验。Invoke when implementing page lifecycle management with cache strategy for miniprogram pages."
---

# 页面生命周期与数据缓存策略

## 核心问题

小程序页面在 `onShow` 时，如果直接进行服务器版本对比或数据库查询，会导致：
- **白屏体验**：用户从其他页面返回时，页面先白屏再显示数据
- **等待时间长**：服务器请求耗时不确定，用户被迫等待

## 解决方案

通过 `_isFirstEntry` 标记区分首次进入和返回场景，实现不同的数据加载策略：

```
┌─────────────────────────────────────────────────────────────────────┐
│                        用户进入页面                                  │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                    ┌───────────────────────┐
                    │  判断 _isFirstEntry   │
                    └───────────┬───────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
   首次进入              从其他页面返回            页面无数据
   (onLoad后)           (多次onShow)              (缓存为空)
         │                      │                      │
         ▼                      ▼                      ▼
   执行版本对比           直接显示缓存            快速加载缓存
   确保数据最新           立即显示                同步全局缓存
         │                      │                      │
         ▼                      ▼                      ▼
   后台异步刷新           后台异步检测            后台异步刷新
         │                      │                      │
         └──────────────────────┴──────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │  数据有变化？           │
                    └───────────┬───────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
                 有变化                    无变化
                    │                       │
                    ▼                       ▼
              静默更新UI              保持现有数据
                    │                       │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │  用户无感知的流畅体验   │
                    └───────────────────────┘
```

## 关键实现

### 1. 标记首次进入

```javascript
// pages/home/index.js
Page({
  data: {
    seriesList: [],
    // ... 其他数据
  },
  
  _isFirstEntry: true,
  _lastUpdateVersion: 0,

  onLoad(options) {
    this._isFirstEntry = true;
    this._lastUpdateVersion = wx.getStorageSync('homeData')?.updateVersion || 0;
    
    // 订阅全局监听器
    const watcher = getGlobalProductWatcher();
    this._unsubscribe = watcher.subscribe(this.__pageId, 'home_products',
      (change) => this._onProductChanged(change));
    
    this.loadProducts();
  },

  onShow() {
    const isFirstEntry = this._isFirstEntry;
    if (this._isFirstEntry) {
      this._isFirstEntry = false;
    }
    
    // 页面已有数据，直接显示
    if (this.data.seriesList && this.data.seriesList.length > 0) {
      console.log('[首页] --- 页面已有数据，直接显示 ---');
    } else {
      // 页面无数据，从缓存快速加载
      this._quickShowFromCache();
    }
    
    // 异步检测更新，不阻塞页面显示
    this._asyncCheckAndUpdate(isFirstEntry);
  }
});
```

### 2. 快速显示缓存

```javascript
_quickShowFromCache() {
  const homeData = wx.getStorageSync('homeData');
  if (homeData && homeData.seriesList && homeData.seriesList.length > 0) {
    this.setData({
      seriesList: homeData.seriesList,
      newProducts: homeData.newProducts || [],
      bannerList: homeData.bannerList || [],
      loading: false
    });
  }
}
```

### 3. 异步检测更新

```javascript
async _asyncCheckAndUpdate(isFirstEntry = false) {
  try {
    // 步骤1: 监听器健康检查
    const healthCheck = watcher.checkNeedsRefresh();
    
    // 步骤2: 检查更新标记
    const updateMark = watcher.getAndClearUpdateMark('home_products');
    
    if (updateMark || healthCheck.needsRefresh) {
      this.loadProducts();
      return;
    }
    
    // 步骤3: 检查轮播图和系列刷新标记
    if (app.globalData.bannerNeedRefresh === true) {
      app.globalData.bannerNeedRefresh = false;
      this.refreshBanner();
    }
    
    // 步骤3.5: 后台异步刷新系列数据
    this._asyncRefreshCategory();
    
    // 步骤4: 检查缓存状态
    const homeData = wx.getStorageSync('homeData');
    if (homeData.cacheStatus === 'corrupted') {
      this.loadProducts();
      return;
    }
    
    // 步骤5: 检查全局监听器是否更新了缓存
    const currentVersion = this._lastUpdateVersion || 0;
    const cacheVersion = homeData?.updateVersion || 0;
    
    if (cacheVersion > currentVersion) {
      this._lastUpdateVersion = cacheVersion;
      // 只有当页面数据为空时才更新UI
      if (!this.data.seriesList || this.data.seriesList.length === 0) {
        this.setData({
          seriesList: homeData.seriesList,
          newProducts: homeData.newProducts || [],
          bannerList: homeData.bannerList || []
        });
      }
      return;
    }
    
    // 步骤6: 智能刷新（版本对比）
    // 只有首次进入或页面数据为空时才执行
    if (isFirstEntry || this.data.seriesList.length === 0) {
      await this.checkAndRefreshIfNeeded();
    } else {
      console.log('[首页] --- 从其他页面返回，跳过服务器版本对比 ---');
    }
  } catch (error) {
    console.error('[首页] 异步检测更新失败:', error);
    errorLogger.logCatchError(error, {
      pageName: 'home',
      methodName: '_asyncCheckAndUpdate'
    });
  }
}
```

### 4. 版本对比刷新

```javascript
async checkAndRefreshIfNeeded() {
  try {
    const cachedData = wx.getStorageSync('homeData');
    const localVersion = cachedData?.version || '0';
    
    const res = await wx.cloud.callFunction({
      name: 'getProductVersion',
      data: {}
    });
    
    if (res.result && res.result.success) {
      const serverVersion = res.result.version;
      
      if (serverVersion !== localVersion && serverVersion !== '0') {
        this.loadProducts(serverVersion);
      }
    }
  } catch (error) {
    console.error('[首页] 版本对比失败:', error);
    // 降级：保持缓存数据，不影响用户体验
  }
}
```

## 缓存状态管理

| 状态 | 说明 | 处理方式 |
|------|------|----------|
| `healthy` | 缓存正常 | 直接使用 |
| `warning` | 缓存可能过期 | 执行版本对比后恢复为 healthy |
| `corrupted` | 缓存损坏 | 强制重新加载 |

```javascript
// 缓存写入时设置状态
wx.setStorageSync('homeData', {
  ...data,
  cacheStatus: 'healthy',
  updateVersion: (existingHomeData.updateVersion || 0) + 1
});

// 缓存读取时检查状态
const homeData = wx.getStorageSync('homeData');
if (homeData.cacheStatus === 'corrupted') {
  this.loadProducts();
  return;
}
```

## 全局缓存同步

当全局监听器更新了商品数据时，需要同步到首页缓存：

```javascript
syncGlobalCacheToHomeCache(homeData, globalProductCache) {
  if (!homeData || !globalProductCache) return homeData;
  
  const clonedData = JSON.parse(JSON.stringify(homeData));
  
  const updateProduct = (product) => {
    const updated = globalProductCache[product._id];
    if (updated) {
      return {
        ...updated,
        isOutOfStock: updated.stock <= 0 && updated.status === 'on',
        isOffline: updated.status !== 'on'
      };
    }
    return product;
  };
  
  if (clonedData.newProducts) {
    clonedData.newProducts = clonedData.newProducts.map(updateProduct);
  }
  
  if (clonedData.seriesList) {
    clonedData.seriesList = clonedData.seriesList.map(series => ({
      ...series,
      products: series.products.map(updateProduct)
    }));
  }
  
  return clonedData;
}
```

## 页面卸载清理

```javascript
onUnload() {
  this._isUnloaded = true;
  
  // 取消订阅
  if (this._unsubscribe) {
    this._unsubscribe();
    this._unsubscribe = null;
  }
  
  // 清理定时器
  clearTimeout(this._timer);
}

// 监听器回调中检查页面状态
async _onProductChanged(change) {
  if (this._isUnloaded) return;
  if (!this._isPageVisible) return;
  
  // 更新 UI...
}
```

## 最佳实践

1. **先显示再校验**：页面显示优先级最高，任何网络请求都不应阻塞页面显示
2. **区分场景**：首次进入需要完整校验，返回时直接使用缓存
3. **状态标记**：使用 `_isFirstEntry`、`_isPageVisible`、`_isUnloaded` 等标记管理页面状态
4. **后台更新**：所有数据更新都在后台进行，有变化时静默更新 UI
5. **降级处理**：网络请求失败时保持缓存数据，不影响用户体验
6. **清理资源**：`onUnload` 时取消订阅、清理定时器，避免内存泄漏

## 常见陷阱

1. ❌ 在 `onShow` 中同步等待网络请求（导致白屏）
2. ❌ 每次 `onShow` 都执行服务器版本对比（浪费资源）
3. ❌ 没有区分首次进入和返回场景（重复加载）
4. ❌ 页面卸载后仍执行异步操作（导致错误）
5. ❌ 直接修改缓存对象（导致只读错误）

## 代码参考

本项目中的实现：

- 首页生命周期管理：[home/index.js](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js)
- `_isFirstEntry` 标记：[onLoad](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js#L183)
- `_quickShowFromCache`：[快速显示缓存](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js#L275)
- `_asyncCheckAndUpdate`：[异步检测更新](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js#L316)
- `checkAndRefreshIfNeeded`：[版本对比](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js#L459)

## 适用场景

- **首页**：用户最常访问，对加载速度要求最高
- **Tab 页面**：用户频繁切换，需要快速显示
- **列表页面**：数据量大，缓存策略能显著提升体验
- **任何需要离线缓存的页面**