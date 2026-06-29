---
name: "async-cache-refresh"
description: "后台异步版本对比的设计模式，适用于对实时更新要求不高的功能场景。Invoke when implementing background refresh for low-frequency update data like categories, banners, or configuration settings."
---

# 后台异步版本对比设计模式

## 适用场景判断

| 场景特征 | 适用本模式 | 需要实时监听 |
|----------|-----------|-------------|
| **更新频率** | 低（每天/每周几次） | 高（每分钟多次） |
| **用户感知** | 弱（延迟几秒可接受） | 强（需要立即看到） |
| **数据重要性** | 中（展示信息） | 高（交易/库存） |
| **典型数据** | 系列、轮播图、配置 | 商品库存、订单状态 |

## 设计原则

### 1. 先显示后更新

```
用户进入页面 → 立即显示缓存数据 → 后台异步检查 → 有变化才更新
```

**不要**：
```javascript
// ❌ 错误：阻塞页面加载
await this.refreshCategory();
this.setData({ seriesList });
```

**应该**：
```javascript
// ✅ 正确：先显示缓存，后台更新
this.setData({ seriesList: cachedData.seriesList });
this._asyncRefreshCategory(); // 不 await
```

### 2. 超时控制

所有后台异步操作必须有超时控制，避免无限等待：

```javascript
const TIMEOUT = 8000; // 8秒超时

const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => reject(new Error('Timeout')), TIMEOUT);
});

const result = await Promise.race([refreshPromise, timeoutPromise]);
```

### 3. 降级方案

失败时保持旧数据，不影响用户体验：

```javascript
try {
  const result = await Promise.race([refreshPromise, timeoutPromise]);
  if (result.changed) {
    this.setData({ seriesList: result.data });
  }
} catch (error) {
  // 降级方案：保持旧数据，不更新UI
  console.warn('刷新失败，保持旧数据');
}
```

### 4. 精确对比

只对比关键字段，避免因无关字段导致误判：

```javascript
_compareData(oldData, newData) {
  // 只对比业务关键字段
  if (oldData.id !== newData.id) return true;
  if (oldData.name !== newData.name) return true;
  if (oldData.status !== newData.status) return true;
  // 不对比时间戳、版本号等无关字段
  return false;
}
```

## 完整实现模板

```javascript
/**
 * 后台异步刷新数据（带超时控制和降级方案）
 */
async _asyncRefreshData() {
  const TIMEOUT = 8000;
  const startTime = Date.now();
  
  console.log('[页面] --- 后台异步刷新数据开始 ---');
  
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Timeout')), TIMEOUT);
  });
  
  const refreshPromise = this._doRefreshData();
  
  try {
    const result = await Promise.race([refreshPromise, timeoutPromise]);
    
    if (result && result.changed) {
      console.log(`[页面] 数据刷新成功，耗时 ${Date.now() - startTime}ms`);
      this.setData({ dataList: result.data });
      this._updateCache(result.data);
    } else {
      console.log(`[页面] 数据无变化，跳过更新`);
    }
  } catch (error) {
    if (error.message === 'Timeout') {
      console.warn(`[页面] 数据刷新超时，保持旧数据`);
    } else {
      console.error(`[页面] 数据刷新失败，保持旧数据`, error);
    }
    // 降级方案：保持旧数据
  }
}

/**
 * 实际执行数据刷新
 */
async _doRefreshData() {
  try {
    const collection = getCollection('targetCollection');
    const res = await collection.where({ status: 'on' }).get();
    
    const newData = this._processData(res.data);
    const hasChanged = this._compareData(this.data.dataList, newData);
    
    if (hasChanged) {
      return { changed: true, data: newData };
    }
    return { changed: false };
  } catch (error) {
    throw error;
  }
}

/**
 * 对比数据是否有变化（只对比关键字段）
 */
_compareData(oldList, newList) {
  if (!oldList || !newList) return true;
  if (oldList.length !== newList.length) return true;
  
  for (let i = 0; i < oldList.length; i++) {
    const oldItem = oldList[i];
    const newItem = newList[i];
    
    // 只对比关键字段
    if (oldItem.id !== newItem.id) return true;
    if (oldItem.name !== newItem.name) return true;
    if (oldItem.status !== newItem.status) return true;
  }
  
  return false;
}

/**
 * 更新缓存
 */
_updateCache(data) {
  const cachedData = wx.getStorageSync('cacheKey');
  if (cachedData) {
    const clonedData = JSON.parse(JSON.stringify(cachedData));
    clonedData.dataList = data;
    wx.setStorageSync('cacheKey', clonedData);
  }
}
```

## 调用时机

在页面 `onShow` 或 `_asyncCheckAndUpdate` 中调用：

```javascript
onShow() {
  // 1. 立即显示缓存数据
  this._quickShowFromCache();
  
  // 2. 后台异步检查更新（不阻塞）
  this._asyncRefreshData();
  
  // 3. 其他检查逻辑...
}
```

## 异常处理清单

| 异常场景 | 处理方式 | 用户影响 |
|----------|---------|---------|
| 网络超时 | 自动取消，保持旧数据 | 无影响 |
| 网络错误 | 捕获异常，保持旧数据 | 无影响 |
| 数据库查询失败 | 捕获异常，保持旧数据 | 无影响 |
| 数据对比失败 | 跳过更新，保持旧数据 | 无影响 |
| 数据无变化 | 跳过更新 | 无影响 |

## 与实时监听的对比

| 维度 | 后台异步版本对比 | 实时监听（watch） |
|------|-----------------|------------------|
| **实时性** | 中（每次 onShow 检查） | 高（实时推送） |
| **复杂度** | 低 | 高 |
| **资源消耗** | 低（按需请求） | 中（持续连接） |
| **适用场景** | 低频更新数据 | 高频更新数据 |
| **实现成本** | 小 | 大 |

## 最佳实践

1. **不要阻塞页面加载**：所有后台刷新都不应该 await
2. **必须有超时控制**：避免用户等待过久
3. **必须有降级方案**：失败时保持旧数据
4. **精确对比数据**：只对比关键字段，避免误判
5. **同步更新缓存**：UI更新成功后同步更新本地缓存

## 常见陷阱

1. ❌ 在 `onLoad` 中 await 刷新数据 → 页面白屏
2. ❌ 没有超时控制 → 用户等待无限久
3. ❌ 失败时清空数据 → 用户看到空白页
4. ❌ 对比所有字段 → 因时间戳变化频繁刷新
5. ❌ 刷新成功后不更新缓存 → 下次进入仍是旧数据

## 代码参考

本项目中已实现的示例：

- 系列（categories）：[home/index.js:1317-1466](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js#L1317-L1466)
  - `_asyncRefreshCategory()`：后台异步刷新入口
  - `_doRefreshCategory()`：实际执行刷新
  - `_compareSeriesList()`：精确对比数据

## 扩展场景

本模式可扩展应用于：

- 轮播图（banner）刷新
- 配置信息（config）刷新
- 公告信息（announcement）刷新
- 分类列表（category list）刷新
- 任何低频更新的展示数据