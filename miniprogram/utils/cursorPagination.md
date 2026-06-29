# 游标分页工具使用指南

## 概述

本工具提供基于时间戳的游标分页实现，替代传统的 skip/limit 分页，适用于数据频繁变化的场景。

## 核心优势

| 特性 | skip/limit 分页 | 游标分页 |
|------|---------------|---------|
| 数据顺序变化 | 可能导致数据重复或遗漏 | 不受影响 |
| 性能 | 大数据量时 skip 效率低 | 始终高效 |
| 一致性 | 分页边界不稳定 | 边界稳定 |

## 使用方式

### 方式一：使用 PagePaginator（推荐）

适用于大多数列表页面，提供封装好的页面级分页管理：

```javascript
// 导入
import PagePaginator from '../../utils/pagePaginator';

Page({
  data: {
    products: [],
    loading: false,
    loadingMore: false,
    hasMore: true
  },
  
  onLoad() {
    // 初始化分页器
    this.productPaginator = new PagePaginator(this, {
      collectionName: 'products',
      dataKey: 'products',
      pageSize: 20,
      cursorField: 'createdAt',
      sortOrder: 'desc',
      extraQuery: { isDeleted: false }
    });
    
    // 加载第一页
    this.loadFirstPage();
  },
  
  async loadFirstPage() {
    await this.productPaginator.loadFirstPage();
    // 加载完成后的其他逻辑
  },
  
  async loadMoreProducts() {
    await this.productPaginator.loadNextPage();
  },
  
  onSearch(keyword) {
    // 更新查询条件并重新加载
    this.productPaginator.updateExtraQuery({
      isDeleted: false,
      name: db.RegExp({ regexp: keyword, options: 'i' })
    });
    await this.productPaginator.loadFirstPage();
  }
});
```

### 方式二：使用 CursorPagination（底层）

适用于需要更精细控制的场景：

```javascript
import CursorPagination from '../../utils/cursorPagination';

const paginator = new CursorPagination({
  pageSize: 20,
  cursorField: 'createdAt',
  sortOrder: 'desc'
});

// 初始化查询
paginator.init('products', { isDeleted: false });

// 加载第一页
const { data: firstPage, hasNext } = await paginator.fetchPage();

// 加载下一页
if (hasNext) {
  const { data: secondPage } = await paginator.fetchPage();
}

// 重置分页（重新开始）
paginator.reset();
```

## 与实时监听的配合

游标分页与实时监听可以很好地配合工作：

```javascript
// 实时监听回调中更新当前列表
handleProductChanges(snapshot) {
  let { products } = this.data;
  
  snapshot.docChanges.forEach(change => {
    const index = products.findIndex(p => p._id === change.doc._id);
    
    if (change.type === 'update' && index !== -1) {
      // 更新当前页内的商品
      products[index] = change.doc;
    } else if (change.type === 'remove' && index !== -1) {
      // 从当前页移除
      products.splice(index, 1);
    }
  });
  
  this.setData({ products });
}
```

## 迁移步骤

### 1. 移除旧的分页状态

```javascript
// 移除这些旧的状态变量
pageNum: 0,
pageSize: 20,
```

### 2. 添加必要的数据字段

```javascript
// 保留这些状态用于 UI 显示
loading: false,
loadingMore: false,
hasMore: true
```

### 3. 替换分页逻辑

```javascript
// 旧代码（skip/limit）
db.collection('products')
  .where({ isDeleted: false })
  .orderBy('createdAt', 'desc')
  .skip(pageNum * pageSize)
  .limit(pageSize)
  .get()

// 新代码（游标分页）
const paginator = new CursorPagination();
paginator.init('products', { isDeleted: false });
const { data, hasNext } = await paginator.fetchPage();
```

## 页面适配清单

| 页面 | 状态 | 建议 |
|------|------|------|
| pages/category/index.js | 需要适配 | 商品列表、分类列表、系列列表 |
| pages/product-list/index.js | 需要适配 | 商品列表 |
| pages/cart/index.js | 需要适配 | 购物车列表 |
| pages/order-list/index.js | 需要适配 | 订单列表 |
| pages/message/list/index.js | 需要适配 | 通知列表 |
| pages/message/index.js | 需要适配 | 客服会话列表 |
| pages/after-sales/list/index.js | 需要适配 | 售后列表 |

## 最佳实践

1. **选择合适的游标字段**：使用单调递增/递减的字段（如 createdAt、updatedAt）
2. **保持排序一致性**：查询和监听使用相同的排序规则
3. **合理设置 pageSize**：根据数据量和页面布局选择合适的值
4. **配合缓存使用**：首次加载可先显示缓存，后台用游标分页更新

## API 参考

### CursorPagination

| 方法 | 说明 | 参数 | 返回值 |
|------|------|------|--------|
| init | 初始化分页器 | collectionName, baseQuery | this |
| setPageSize | 设置每页大小 | pageSize | this |
| setCursorField | 设置游标字段 | field | this |
| setSortOrder | 设置排序方向 | order | this |
| fetchPage | 获取下一页数据 | 无 | { data, hasNext } |
| fetchAll | 获取所有数据 | 无 | array |
| reset | 重置分页状态 | 无 | this |
| getHasNext | 是否有下一页 | 无 | boolean |
| getLastCursor | 获取最后游标值 | 无 | any |

### PagePaginator

| 方法 | 说明 | 参数 | 返回值 |
|------|------|------|--------|
| loadFirstPage | 加载第一页 | baseQuery | data |
| loadNextPage | 加载下一页 | 无 | data |
| reset | 重置分页 | 无 | void |
| updateExtraQuery | 更新额外查询条件 | extraQuery | void |
| hasNext | 是否有下一页 | 无 | boolean |
