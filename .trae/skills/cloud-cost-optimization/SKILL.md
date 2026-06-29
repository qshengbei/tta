---
name: "cloud-cost-optimization"
description: "云开发成本优化策略，减少数据库请求、网络请求和云函数调用，降低云开发环境费用。Invoke when optimizing cloud development costs or reviewing code for cost efficiency."
---

# 云开发成本优化策略

## 云开发费用构成

| 资源类型 | 计费方式 | 优化方向 |
|----------|---------|---------|
| **数据库** | 读取/写入次数 | 增加缓存、减少查询 |
| **云函数** | 调用次数 + 执行时间 | 减少调用、优化逻辑 |
| **云存储** | 存储容量 + 下载流量 | 压缩图片、缓存策略 |
| **云调用** | 调用次数 | 减少调用、批量操作 |
| **CDN流量** | 出站流量 | 本地缓存、懒加载 |

## 核心优化原则

### 1. 缓存优先，数据库次之

**不要**：
```javascript
// ❌ 每次都查询数据库
const res = await collection.where({ status: 'on' }).get();
```

**应该**：
```javascript
// ✅ 先读缓存，缓存无效才查数据库
const cachedData = wx.getStorageSync('homeData');
if (cachedData && cachedData.seriesList && cachedData.seriesList.length > 0) {
  this.setData({ seriesList: cachedData.seriesList });
} else {
  const res = await collection.where({ status: 'on' }).get();
}
```

### 2. 只在必要时更新

**不要**：
```javascript
// ❌ 每次 onShow 都刷新
onShow() {
  this.loadProducts();
}
```

**应该**：
```javascript
// ✅ 根据条件决定是否刷新
onShow() {
  if (this.data.seriesList.length === 0) {
    this.loadProducts();
  } else {
    this._asyncCheckAndUpdate(); // 只做轻量级检查
  }
}
```

### 3. 版本对比替代全量查询

**不要**：
```javascript
// ❌ 每次都全量查询对比
const res = await collection.get();
const hasChanged = compare(res.data, currentData);
```

**应该**：
```javascript
// ✅ 先对比版本号，版本变化才查询
const serverVersion = await getServerVersion();
if (serverVersion !== localVersion) {
  const res = await collection.get();
}
```

### 4. 后台异步刷新，避免阻塞

**不要**：
```javascript
// ❌ 同步等待刷新完成
await this.refreshData();
this.setData({ data });
```

**应该**：
```javascript
// ✅ 先显示旧数据，后台刷新
this.setData({ data: cachedData });
this._asyncRefreshData(); // 不 await
```

## 数据库优化策略

### 查询优化

```javascript
// ✅ 使用索引字段查询
collection.where({ categoryId: 'xxx', status: 'on' }).get();

// ✅ 限制返回字段
collection.field({ name: true, price: true, stock: true }).get();

// ✅ 限制返回数量
collection.limit(3).get();

// ✅ 避免全表扫描
collection.where({ status: 'on' }).get(); // ✅
collection.get().then(data => data.filter(item => item.status === 'on')); // ❌
```

### 批量操作

```javascript
// ✅ 批量写入
const batch = db.batch();
items.forEach(item => {
  batch.update({ _id: item._id }, { stock: item.stock });
});
await batch.commit();

// ✅ 单次查询获取多表数据
const [productsRes, categoriesRes] = await Promise.all([
  productsCollection.get(),
  categoriesCollection.get()
]);
```

## 云函数优化策略

### 减少调用次数

```javascript
// ❌ 多次调用
const version = await callCloudFunction('getVersion');
const data = await callCloudFunction('getData');

// ✅ 合并调用
const result = await callCloudFunction('getAllData');
// 云函数内部一次查询返回所有数据
```

### 优化执行时间

```javascript
// ❌ 云函数中做耗时操作
exports.main = async (event) => {
  // 复杂计算、图片处理等
};

// ✅ 前端处理轻量逻辑，云函数只做数据库操作
exports.main = async (event) => {
  const res = await db.collection('products').get();
  return res.data;
};
```

### 缓存云函数结果

```javascript
// ✅ 缓存云函数返回值
const cachedResult = wx.getStorageSync('cachedResult');
if (cachedResult && Date.now() - cachedResult.timestamp < 300000) {
  return cachedResult.data;
}
const result = await callCloudFunction('getData');
wx.setStorageSync('cachedResult', {
  data: result,
  timestamp: Date.now()
});
```

## 网络请求优化

### 请求合并

```javascript
// ❌ 多次网络请求
const bannerRes = await wx.request({ url: '/api/banner' });
const categoryRes = await wx.request({ url: '/api/category' });
const productRes = await wx.request({ url: '/api/product' });

// ✅ 合并为一次请求
const res = await wx.request({ url: '/api/home' });
// 返回 { banner, category, product }
```

### 超时控制

```javascript
// ✅ 设置合理的超时时间
const TIMEOUT = 8000;
const result = await Promise.race([
  fetchData(),
  new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), TIMEOUT))
]);
```

### 请求防抖

```javascript
// ✅ 防止重复请求
let isFetching = false;
async fetchData() {
  if (isFetching) return;
  isFetching = true;
  try {
    const res = await collection.get();
    return res.data;
  } finally {
    isFetching = false;
  }
}
```

## 存储优化策略

### 图片压缩

```javascript
// ✅ 上传前压缩图片
wx.compressImage({
  src: tempFilePath,
  quality: 80,
  success: (res) => {
    wx.cloud.uploadFile({
      cloudPath: `images/${Date.now()}.jpg`,
      filePath: res.tempFilePath
    });
  }
});
```

### 图片懒加载

```xml
<!-- ✅ 使用懒加载 -->
<image mode="aspectFill" lazy-load src="{{imageUrl}}" />
```

### 缓存静态资源

```javascript
// ✅ 缓存图片URL
const cachedUrls = wx.getStorageSync('imageUrls') || {};
if (cachedUrls[imageId]) {
  return cachedUrls[imageId];
}
const url = await wx.cloud.getTempFileURL({ fileList: [cloudPath] });
cachedUrls[imageId] = url.fileList[0].tempFileURL;
wx.setStorageSync('imageUrls', cachedUrls);
```

## 首页成本优化实践

### 1. 缓存机制

```javascript
// 首次进入：读取缓存或数据库
loadProducts() {
  const cachedData = wx.getStorageSync('homeData');
  if (cachedData && cachedData.seriesList && cachedData.seriesList.length > 0) {
    this.setData({ seriesList: cachedData.seriesList });
    this._asyncRefreshData(); // 后台刷新
    return;
  }
  // 无缓存时才查询数据库
}
```

### 2. 智能刷新

```javascript
_asyncCheckAndUpdate() {
  // 步骤1：检查监听器状态
  // 步骤2：检查更新标记
  // 步骤3：检查全局刷新标记
  // 步骤4：检查缓存状态
  // 步骤5：检查 updateVersion（版本对比）
  // 步骤6：仅首次进入或数据为空时才做服务器版本对比
}
```

### 3. 后台异步刷新

```javascript
_asyncRefreshCategory() {
  // 不阻塞页面加载
  // 带超时控制
  // 只在数据有变化时才更新UI
}
```

### 4. 精确数据对比

```javascript
_compareSeriesList(oldList, newList) {
  // 只对比关键字段
  // 避免因无关字段导致不必要的更新
}
```

## 成本监控

### 日志记录

```javascript
// ✅ 记录关键操作的耗时和次数
const startTime = Date.now();
await collection.get();
const duration = Date.now() - startTime;
console.log(`[成本监控] 数据库查询耗时: ${duration}ms`);
```

### 统计分析

| 指标 | 监控方式 | 优化目标 |
|------|---------|---------|
| 数据库读取次数 | 云开发控制台 | < 1000次/天/用户 |
| 云函数调用次数 | 云开发控制台 | < 500次/天/用户 |
| 存储使用量 | 云开发控制台 | < 1GB |
| 网络请求次数 | 日志统计 | 最小化 |

## 常见陷阱

1. ❌ 每次 `onShow` 都全量刷新 → 大量数据库查询
2. ❌ 不使用缓存，每次都查数据库 → 浪费资源
3. ❌ 云函数中做耗时操作 → 增加执行时间费用
4. ❌ 图片不压缩直接上传 → 增加存储和流量费用
5. ❌ 不限制查询结果数量 → 浪费带宽
6. ❌ 频繁调用云函数获取相同数据 → 浪费调用次数

## 最佳实践清单

- [ ] 页面数据优先从缓存读取
- [ ] 只在必要时查询数据库
- [ ] 使用版本对比替代全量查询
- [ ] 后台异步刷新，不阻塞UI
- [ ] 云函数只做数据库操作，前端处理逻辑
- [ ] 图片上传前压缩，使用懒加载
- [ ] 合并网络请求，减少调用次数
- [ ] 设置请求超时，避免无限等待
- [ ] 添加请求防抖，防止重复请求
- [ ] 监控关键指标，及时发现问题

## 代码参考

本项目中已实现的成本优化示例：

- 首页缓存机制：[home/index.js:878-927](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js#L878-L927)
- 智能刷新逻辑：[home/index.js:339-438](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js#L339-L438)
- 后台异步刷新：[home/index.js:1317-1466](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js#L1317-L1466)
- 精确数据对比：[home/index.js:1427-1466](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js#L1427-L1466)
- 全局监听器：[globalProductWatcher.js](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/utils/globalProductWatcher.js)

## 扩展应用

本策略可应用于：

- 商品列表页：缓存分类数据，后台刷新
- 详情页：缓存商品详情，版本对比更新
- 用户中心：缓存用户信息，定期刷新
- 订单列表：分页加载，懒加载图片
- 任何涉及数据库查询和网络请求的页面