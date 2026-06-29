---
name: "page-visibility"
description: "页面可见性管理策略，通过 _isPageVisible 标记和全局监听器配合，控制后台页面不接收更新通知，优化性能和用户体验。Invoke when implementing page visibility management for miniprogram applications."
---

# 页面可见性管理策略

## 核心问题

小程序中，当用户切换页面时，原页面并不会销毁，而是进入隐藏状态。如果全局监听器持续向隐藏页面发送更新通知，会导致：
- **性能浪费**：后台页面执行不必要的 UI 更新
- **内存泄漏**：隐藏页面继续持有资源
- **状态不一致**：页面显示时数据已被修改但 UI 未更新

## 解决方案

通过 `_isPageVisible` 标记管理页面可见性，配合全局监听器实现智能更新控制：

```
┌─────────────────────────────────────────────────────────────────────┐
│                        用户操作                                     │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
              页面显示 (onShow)              页面隐藏 (onHide)
                    │                             │
                    ▼                             ▼
        ┌───────────────────┐         ┌───────────────────┐
        │ 1. 设置 _isPageVisible      │ 1. 设置 _isPageVisible │
        │    = true                  │    = false         │
        │ 2. 通知全局监听器          │ 2. 通知全局监听器    │
        │    pageVisible = true      │    pageVisible = false│
        │ 3. 允许接收更新通知        │ 3. 拒绝接收更新通知    │
        └───────────────────┘         └───────────────────┘
                    │                             │
                    └──────────────┬──────────────┘
                                   │
                                   ▼
                    ┌───────────────────────────┐
                    │   全局监听器收到数据变化    │
                    └───────────────┬───────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
               页面可见                          页面不可见
                    │                               │
                    ▼                               ▼
          更新缓存 + 更新UI                   只更新缓存
                    │                               │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────┐
                    │   页面重新显示时            │
                    │   从缓存读取最新数据         │
                    └───────────────────────────┘
```

## 关键实现

### 1. 页面可见性标记

```javascript
Page({
  data: {
    pageVisible: false,
    // ... 其他数据
  },
  
  _isPageVisible: false,

  onShow() {
    this._isPageVisible = true;
    this.setData({ pageVisible: true });
    
    // 通知全局监听器页面可见
    const watcher = getGlobalProductWatcher();
    watcher.setPageVisible(this.__pageId, true);
  },

  onHide() {
    this._isPageVisible = false;
    this.setData({ pageVisible: false });
    
    // 通知全局监听器页面不可见
    getGlobalProductWatcher().setPageVisible(this.__pageId, false);
  }
});
```

### 2. 监听器回调中的可见性检查

```javascript
async _onProductChanged(change) {
  // 检查页面是否已卸载
  if (this._isUnloaded) {
    console.log('[首页] 页面已卸载，跳过更新');
    return;
  }
  
  // 检查页面是否可见
  if (!this._isPageVisible) {
    console.log('[首页] 页面不可见，跳过更新');
    return;
  }
  
  // 更新 UI...
  const homeData = wx.getStorageSync('homeData');
  if (homeData && homeData.seriesList) {
    this.setData({
      seriesList: homeData.seriesList,
      newProducts: homeData.newProducts || []
    });
  }
}
```

### 3. 全局监听器中的页面可见性管理

```javascript
// globalProductWatcher.js
class GlobalProductWatcher {
  constructor() {
    this._subscribers = {};
    this._pageVisibility = {};
  }

  subscribe(pageId, channel, callback) {
    if (!this._subscribers[channel]) {
      this._subscribers[channel] = [];
    }
    
    this._subscribers[channel].push({ pageId, callback });
    
    return () => {
      this._subscribers[channel] = this._subscribers[channel].filter(
        sub => sub.pageId !== pageId
      );
    };
  }

  setPageVisible(pageId, visible) {
    this._pageVisibility[pageId] = visible;
  }

  notify(channel, change) {
    const subscribers = this._subscribers[channel] || [];
    
    subscribers.forEach(sub => {
      // 检查页面是否可见
      if (!this._pageVisibility[sub.pageId]) {
        console.log(`[Watcher] 页面 ${sub.pageId} 不可见，跳过通知`);
        return;
      }
      
      try {
        sub.callback(change);
      } catch (error) {
        console.error(`[Watcher] 通知页面 ${sub.pageId} 失败`, error);
      }
    });
  }
}
```

### 4. 页面卸载清理

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
```

### 5. 异步操作中的可见性检查

```javascript
async _asyncRefreshCategory() {
  try {
    const result = await this._doRefreshCategory();
    
    // 检查页面是否仍然可见
    if (!this._isPageVisible) {
      console.log('[首页] 页面已不可见，跳过 UI 更新');
      return;
    }
    
    if (result && result.changed) {
      this.setData({ seriesList: result.seriesList });
    }
  } catch (error) {
    console.error('[首页] 系列数据刷新失败', error);
  }
}
```

## 状态管理

| 状态标记 | 类型 | 说明 |
|----------|------|------|
| `_isPageVisible` | Boolean | 当前页面是否可见（内存标记） |
| `pageVisible` | Boolean | 当前页面是否可见（data 数据，用于 WXML 绑定） |
| `_isUnloaded` | Boolean | 页面是否已卸载 |
| `_isLoading` | Boolean | 页面是否正在加载 |

## 配合其他策略

### 与生命周期缓存策略配合

```javascript
onShow() {
  this._isPageVisible = true;
  this.setData({ pageVisible: true });
  
  // 页面已有数据，直接显示
  if (this.data.seriesList && this.data.seriesList.length > 0) {
    console.log('[首页] --- 页面已有数据，直接显示 ---');
  } else {
    this._quickShowFromCache();
  }
  
  // 异步检测更新
  this._asyncCheckAndUpdate(isFirstEntry);
}
```

### 与异步刷新策略配合

```javascript
async _asyncCheckAndUpdate(isFirstEntry = false) {
  try {
    // ... 检查逻辑
    
    // 后台异步刷新系列数据（无 await）
    this._asyncRefreshCategory();
    
    // ... 其他逻辑
  } catch (error) {
    console.error('[首页] 异步检测更新失败:', error);
  }
}

async _asyncRefreshCategory() {
  // 带超时控制的后台刷新
  const TIMEOUT = 8000;
  
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Timeout')), TIMEOUT);
  });
  
  const refreshPromise = this._doRefreshCategory();
  
  try {
    const result = await Promise.race([refreshPromise, timeoutPromise]);
    
    // 检查页面可见性
    if (!this._isPageVisible) return;
    
    if (result && result.changed) {
      this.setData({ seriesList: result.seriesList });
    }
  } catch (error) {
    // 超时或失败，保持旧数据
  }
}
```

## 最佳实践

1. **标记可见性**：在 `onShow` 和 `onHide` 中更新 `_isPageVisible` 标记
2. **通知监听器**：调用 `watcher.setPageVisible()` 通知全局监听器
3. **检查状态**：在所有异步回调和监听器回调中检查页面状态
4. **清理资源**：在 `onUnload` 中取消订阅、清理定时器
5. **只更新缓存**：页面不可见时只更新缓存，不更新 UI
6. **快速恢复**：页面重新显示时从缓存读取最新数据

## 常见陷阱

1. ❌ 监听器回调中没有检查页面可见性（后台页面仍更新 UI）
2. ❌ 异步操作完成后没有检查页面状态（卸载后仍执行操作）
3. ❌ 没有通知全局监听器页面状态变化（监听器继续发送通知）
4. ❌ `onUnload` 时没有取消订阅（内存泄漏）
5. ❌ 使用 `data.pageVisible` 作为唯一判断依据（WXML 更新可能延迟）

## 代码参考

本项目中的实现：

- 页面可见性标记：[home/index.js](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js#L211)
- `onShow` 中的可见性设置：[onShow](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js#L211)
- `onHide` 中的可见性设置：[onHide](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js#L526)
- 监听器回调中的可见性检查：[_onProductChanged](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js#L562)
- 全局监听器的可见性管理：[globalProductWatcher.js](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/utils/globalProductWatcher.js)

## 适用场景

- **首页**：需要实时更新但不应在后台消耗资源
- **全局监听器**：多个页面共享的监听器需要知道哪些页面在前台
- **异步任务**：长时间运行的异步任务需要检查页面状态
- **定时器管理**：轮播图、倒计时等需要在后台暂停

## 扩展应用

### WXML 中的可见性绑定

```xml
<view wx:if="{{pageVisible}}">
  <!-- 仅在页面可见时渲染 -->
</view>
```

### 条件性更新

```javascript
async refreshData() {
  if (!this._isPageVisible) {
    // 页面不可见，只更新缓存
    await this._updateCacheOnly();
    return;
  }
  
  // 页面可见，更新缓存和 UI
  await this._updateCacheAndUI();
}
```