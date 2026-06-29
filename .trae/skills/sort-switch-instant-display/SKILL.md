# 排序切换瞬时显示策略

## 问题背景

在商品列表页面中，用户频繁切换排序（综合排序、新品排序、价格升序/降序）时，如果每次切换都重新从数据库加载或重新渲染列表，会导致明显的卡顿和白屏，影响用户体验。

## 核心思想

**"预渲染 + 内存缓存 + hidden 切换"** 三位一体的方案，实现排序切换的毫秒级响应。

## 实现方式

### 1. WXML 多列表并行渲染

为每个排序创建独立的 `scroll-view`，所有列表同时存在于 DOM 中，通过 `hidden` 属性控制显示：

```xml
<!-- 综合排序列表 -->
<scroll-view hidden="{{!(sortType === 'default')}}" ...>
  <view wx:for="{{sortDataCache['default'].products}}" ... />
</scroll-view>

<!-- 新品排序列表 -->
<scroll-view hidden="{{!(sortType === 'new')}}" ...>
  <view wx:for="{{sortDataCache['new'].products}}" ... />
</scroll-view>

<!-- 价格升序列表 -->
<scroll-view hidden="{{!(sortType === 'price' && priceSortOrder === 'asc')}}" ...>
  <view wx:for="{{sortDataCache['price_asc'].products}}" ... />
</scroll-view>
```

**要点**：
- 每个列表绑定独立的数据源（`sortDataCache[key].products`）
- `hidden` 属性由 `sortType` 和 `priceSortOrder` 共同决定
- 列表同时存在于 DOM 中，切换时只是显示/隐藏，无需重新渲染

### 2. 内存缓存 sortDataCache

在页面 data 中维护一个对象，存储每个排序的数据：

```javascript
Page({
  data: {
    sortDataCache: {
      'default': null,
      'new': null,
      'price_asc': null,
      'price_desc': null
    },
    sortType: 'default',
    priceSortOrder: 'asc'
  }
})
```

**数据结构**：
```javascript
{
  'default': {
    products: [...],        // 当前显示的商品列表
    originalProducts: [...] // 原始数据（用于分页和筛选）
  }
}
```

### 3. 数据加载时同步写入 sortDataCache

从数据库或本地缓存加载数据时，同时更新 `sortDataCache`：

```javascript
// 从数据库加载
async fetchProductsFromDatabase() {
  const data = await this.paginator.loadFirstPage();
  
  this.setData({
    products: data,
    originalProducts: data,
    [`sortDataCache.${cacheKey}`]: {
      products: data,
      originalProducts: [...data]
    }
  });
}
```

**关键**：确保数据加载后，`sortDataCache` 和 `products` 同时更新。

### 4. 切换排序时只更新状态变量

从内存缓存切换排序时，**只更新 `sortType` 和 `scrollTop`**，不更新 `products`：

```javascript
setSortType(type) {
  const cacheKey = this._getCacheKey(type);
  const memoryCache = this.data.sortDataCache[cacheKey];
  
  if (memoryCache && memoryCache.products.length > 0) {
    // 内存缓存命中：只更新状态，不重新渲染列表
    this.setData({ 
      sortType: type,
      scrollTop: 0
    });
    return;
  }
  
  // 无缓存：从数据库加载
  this.fetchProductsFromDatabase();
}
```

**要点**：
- 不更新 `products` 和 `originalProducts`
- 不触发 WXML 重新渲染
- 列表通过 `hidden` 属性自动切换

### 5. 商品变更时同步更新 sortDataCache

全局监听器触发商品变更时，同步更新 `sortDataCache`：

```javascript
_onSingleProductChanged(change) {
  const { product, type } = change;
  const cacheKey = this._getCacheKey();
  
  // 更新当前排序的数据
  const cache = this.data.sortDataCache[cacheKey];
  const updatedProducts = this._updateProductList(cache.products, product, type);
  
  this.setData({
    [`sortDataCache.${cacheKey}.products`]: updatedProducts
  });
}
```

### 6. 避免不必要的 setData

**不要**在切换排序后执行以下操作：
- ❌ `setData({ products: [...] })` - 会触发重新渲染
- ❌ `setData({ scrollTop: Math.random() })` - 会导致列表跳动
- ❌ 清空 products 再重新赋值 - 会导致白屏

**应该**做的：
- ✅ 只更新 `sortType` 和 `scrollTop`
- ✅ 保持 `products` 不变（搜索筛选模式除外）
- ✅ 让 WXML 的 `hidden` 属性自动处理显示切换

## 数据流图

```
首次加载：
数据库 → products/originalProducts → sortDataCache → WXML显示

切换排序（有缓存）：
用户点击 → setData({sortType}) → WXML hidden切换 → 瞬时显示

切换排序（无缓存）：
用户点击 → 显示loading → 数据库加载 → sortDataCache → WXML显示

商品变更：
监听器触发 → 更新sortDataCache → WXML自动更新
```

## 适用场景

- 商品列表的多排序切换（综合、新品、价格等）
- Tab 切换（如宝贝/分类/系列）
- 任何需要频繁切换且数据可缓存的列表场景

## 注意事项

1. **内存占用**：同时渲染多个列表会增加内存占用，建议最多缓存 4-5 个排序
2. **数据同步**：商品变更时需要同步更新所有相关的 sortDataCache
3. **搜索筛选模式**：有筛选条件时，仍然使用传统的 `products` 数据，不走 sortDataCache
4. **下拉加载**：加载更多数据时，需要更新对应的 sortDataCache

## 性能对比

| 方案 | 切换耗时 | 用户体验 |
|------|---------|---------|
| 传统方案（每次重新加载） | 500-2000ms | 明显白屏和loading |
| 缓存方案（从storage读取） | 100-300ms | 轻微卡顿 |
| **本方案（内存缓存+hidden切换）** | **0-16ms** | **丝滑无感知** |
