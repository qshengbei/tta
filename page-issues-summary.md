# TTA 小程序页面问题汇总

## 概述

本文档汇总了 TTA 小程序中除首页外其他页面存在的问题，这些问题与首页已修复的问题类似，后续修改其他页面时需要重点关注。

---

## 问题分类

### 1. 动态页面ID导致重复订阅

**问题描述**：使用包含时间戳或随机数的动态页面ID，每次进入页面都会生成新ID，导致全局监听器中存在大量过期订阅者，造成内存泄漏和重复通知。

**影响页面**：
- `miniprogram/pages/product-detail/index.js`
- `miniprogram/pages/cart/index.js`

**具体代码**：

```javascript
// product-detail/index.js - 第167行
this.__pageId = `product_detail_${productId}_${Date.now()}`;

// cart/index.js - 第35行
this.__pageId = `cart_page_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
```

**修复建议**：使用固定页面ID，如 `product_detail_page`、`cart_page`

---

### 2. 页面隐藏时仍执行setData

**问题描述**：当页面不可见时（onHide之后），全局监听器回调仍会执行setData更新UI，造成不必要的性能消耗和潜在问题。

**影响页面**：
- `miniprogram/pages/category/index.js` - 完全没有检查页面可见性
- `miniprogram/pages/product-detail/index.js` - 虽然有检查但仍调用setData
- `miniprogram/pages/cart/index.js` - 虽然有检查但仍调用setData

**具体代码**：

```javascript
// category/index.js - _onSingleProductChanged 方法（第627行）
// 没有检查页面可见性，直接调用setData

// product-detail/index.js - 第206行
// 页面隐藏时仍调用setData设置pendingRefresh
this.setData({ 
  product: { ... },
  pendingRefresh: true 
});

// cart/index.js - 第205行
// 页面隐藏时仍调用setData
this.setData({ 
  cartItems: updatedItems,
  filteredCartItems: updatedItems,
  pendingRefresh: true
});
```

**修复建议**：使用实例属性（如 `this._isPageVisible`）检查页面可见性，页面隐藏时仅更新缓存，不调用setData

---

### 3. Boolean标志导致丢失更新

**问题描述**：使用Boolean类型的标志（如pendingRefresh）来标记是否有更新，当多个更新在页面隐藏期间发生时，只会记录一次更新状态，导致中间的更新丢失。

**影响页面**：
- `miniprogram/pages/product-detail/index.js` - 使用 pendingRefresh (Boolean)
- `miniprogram/pages/cart/index.js` - 使用 pendingRefresh (Boolean)

**具体代码**：

```javascript
// product-detail/index.js - 第248行
this.setData({ pendingRefresh: true });

// cart/index.js - 第208行
this.setData({ pendingRefresh: true });
```

**修复建议**：使用递增计数器（如 `updateVersion`）替代Boolean标志

---

### 4. 内存泄漏风险

**问题描述**：页面卸载时没有彻底清理所有资源（定时器、订阅、事件监听器等），导致内存泄漏。

**影响页面**：
- `miniprogram/pages/category/index.js` - onUnload中没有清理所有定时器
- `miniprogram/pages/product-detail/index.js` - 缺少定时器清理
- `miniprogram/pages/cart/index.js` - 缺少部分定时器清理

**具体代码**：

```javascript
// category/index.js - onUnload（第559行）
// 只清理了部分定时器，缺少其他定时器清理

// product-detail/index.js - onUnload（第149行）
// 只取消了订阅，没有清理定时器

// cart/index.js - onUnload（第117行）
// 只取消了订阅，缺少 scrollStopTimer 等清理
```

**修复建议**：在onUnload中清理所有定时器、取消订阅、释放引用

---

### 5. onLoad与onShow竞态条件

**问题描述**：onLoad中的异步数据加载可能尚未完成，但onShow已经开始执行更新逻辑，导致数据不一致或重复请求。

**影响页面**：
- `miniprogram/pages/category/index.js`
- `miniprogram/pages/cart/index.js`

**具体代码**：

```javascript
// category/index.js - onLoad中调用initData()（异步），onShow中又可能调用initData()

// cart/index.js - onLoad中调用fetchCartItems()（异步），onShow中又可能调用fetchCartItems()
```

**修复建议**：添加 `_isLoading` 标志，在onLoad期间阻止onShow执行重复操作

---

### 6. 监听器断线重连机制不完善

**问题描述**：微信云开发watch在弱网、后台停留较久等场景下可能断线，页面没有健康检查和自动重连机制。

**影响页面**：
- `miniprogram/pages/category/index.js` - onHide时关闭监听器，依赖onShow重新连接
- `miniprogram/pages/product-detail/index.js` - 同样依赖onShow重新连接

**具体代码**：

```javascript
// category/index.js - onHide（第544行）
this.stopWatchers(); // 关闭监听器

// category/index.js - onShow（第437行）
this.startWatchers(); // 重新连接
```

**修复建议**：依赖全局监听器的健康检查机制，页面层只需订阅/取消订阅，断线重连由全局监听器处理

---

### 7. 订单列表页使用独立监听器

**问题描述**：订单列表页使用独立的OrderListener，而不是与其他页面共享统一的监听机制，增加了维护复杂度。

**影响页面**：
- `miniprogram/pages/order-list/index.js`

**具体代码**：

```javascript
// order-list/index.js - 第65行
initOrderListener() {
  this.orderListener = new OrderListener(this);
}
```

**修复建议**：考虑将OrderListener重构为全局订单监听器，与GlobalProductWatcher保持一致的设计模式

---

## 页面问题对照表

| 问题类型 | category | product-detail | cart | order-list |
|---------|----------|---------------|------|------------|
| 动态页面ID | ✅ 使用固定ID | ❌ 动态ID | ❌ 动态ID | N/A |
| 页面隐藏时setData | ❌ 无检查 | ⚠️ 部分检查 | ⚠️ 部分检查 | N/A |
| Boolean标志丢失更新 | ✅ 无此问题 | ❌ 使用pendingRefresh | ❌ 使用pendingRefresh | N/A |
| 内存泄漏 | ⚠️ 部分清理 | ❌ 缺少定时器清理 | ⚠️ 部分清理 | ⚠️ 缺少定时器清理 |
| onLoad/onShow竞态 | ❌ 存在竞态 | ✅ 无明显问题 | ❌ 存在竞态 | ✅ 无明显问题 |
| 断线重连不完善 | ❌ 依赖手动重连 | ❌ 依赖手动重连 | ✅ 使用全局监听器 | ❌ 独立监听器 |
| 独立监听器设计 | N/A | N/A | N/A | ❌ 独立OrderListener |

---

## 修复优先级

**高优先级**（影响功能正确性）：
1. 动态页面ID → 导致重复订阅和内存泄漏
2. Boolean标志丢失更新 → 导致数据更新丢失
3. onLoad/onShow竞态 → 导致数据不一致

**中优先级**（影响性能和稳定性）：
1. 页面隐藏时setData → 不必要的性能消耗
2. 内存泄漏 → 长期运行导致性能下降

**低优先级**（架构优化）：
1. 监听器断线重连 → 已有全局监听器处理
2. 独立监听器设计 → 架构层面优化

---

## 修复参考

首页已修复的代码可作为参考：
- 文件：`miniprogram/pages/home/index.js`
- 关键点：
  - 使用固定页面ID：`this.__pageId = "home_page"`
  - 使用 `updateVersion` 计数器替代Boolean标志
  - 添加 `_isLoading`、`_isPageVisible`、`_isUnloaded` 标志
  - onUnload中完整清理所有资源
