/**
 * ProductListBehavior - 商品列表页面可复用 Behavior
 *
 * 封装分页加载、缓存读写、全局监听订阅的通用逻辑。
 * 页面通过 Behavior 引入后，只需实现以下方法即可:
 *
 *   _getCacheKey()      - 返回缓存 key 字符串
 *   _buildDbQuery()     - 返回 DB 查询参数对象
 *   _shouldUseCache()   - 返回 boolean（搜索/筛选时返回 false）
 *   _getPageSize()      - (可选) 返回 pageSize，默认 18
 *
 * Behavior 提供的 data:
 *   products: [], loading, loadingMore, hasMore, showSkeleton
 *
 * Behavior 提供的方法:
 *   _initProductPage()           - onLoad 中调用
 *   _loadProducts(reset)         - 加载/分页
 *   _loadMoreProducts()          - 加载更多（触底调用）
 *   _onProductChanged(change)    - 实时监听变化处理
 *   _handleSearch(keyword)       - 处理搜索
 *   _handleFilter(filters)       - 处理筛选
 *   _applySortToLocal(sortedProducts) - 对 products 应用排序
 */

import PagePaginator from './pagePaginator';
import productCacheStore from './productCacheStore';
import { getGlobalProductWatcher } from './globalProductWatcher';

const DEFAULT_PAGE_SIZE = 18;

const productListBehavior = Behavior({
  data: {
    products: [],
    originalProducts: [],
    loading: false,
    loadingMore: false,
    hasMore: true,
    showSkeleton: true
  },

  // ========== 生命周期 ==========

  // Page-level lifecycle hooks (called before page's own hooks)
  onShow() {
    console.log('[ProductListBehavior] onShow 被调用, __pageId:', this.__pageId);
    if (this.__pageId) {
      console.log('[ProductListBehavior] 设置页面可见性:', this.__pageId);
      getGlobalProductWatcher().setPageVisible(this.__pageId, true);
    } else {
      console.log('[ProductListBehavior] __pageId 不存在，无法设置页面可见性');
    }

    // 监听器健康检查
    const watcher = getGlobalProductWatcher();
    const healthCheck = watcher.checkNeedsRefresh();
    
    if (healthCheck.needsRefresh) {
      console.log('[ProductListBehavior] 监听器健康检查不通过:', healthCheck.reason);
    }

    const cacheKey = this._getCacheKey();
    const updateMark = watcher.getAndClearUpdateMark(cacheKey);
    const hasUpdates = updateMark && updateMark.updateVersion && updateMark.updateVersion.length > 0;
    if (hasUpdates || healthCheck.needsRefresh) {
      console.log('[ProductListBehavior] 检测到缓存更新标记或监听器不健康，重新加载');
      console.log('[ProductListBehavior] updateVersion 长度:', hasUpdates ? updateMark.updateVersion.length : 0);
      this._reloadFromCache();
    }
  },

  onHide() {
    if (this.__pageId) {
      getGlobalProductWatcher().setPageVisible(this.__pageId, false);
    }
  },

  onUnload() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    console.log('[ProductListBehavior] page unloaded:', this.__pageId);
  },

  onReachBottom() {
    this._loadMoreProducts();
  },

  // ========== 公共方法 ==========

  methods: {
    /**
     * 初始化商品页面（页面在 onLoad 中调用）
     * 订阅全局监听 + 首次加载数据
     */
    async _initProductPage(options = {}) {
      console.log('[ProductListBehavior] _initProductPage 开始调用');
      
      // 生成页面唯一 ID
      this.__pageId = `product_page_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      this.__pageSize = this._getPageSize ? this._getPageSize() : DEFAULT_PAGE_SIZE;

      // 获取缓存 key
      const cacheKey = this._getCacheKey();
      console.log('[ProductListBehavior] _initProductPage - cacheKey:', cacheKey);

      // 订阅全局监听
      const watcher = getGlobalProductWatcher();
      
      // 注册缓存 key 和查询条件
      const dbQuery = this._buildDbQuery();
      watcher.registerCacheKeyWithQuery(cacheKey, dbQuery);
      
      this._unsubscribe = watcher.subscribe(
        this.__pageId, cacheKey,
        (change) => this._onProductChanged(change)
      );

      // 立即设置页面可见性（在初始化时就设置，不依赖 onShow）
      console.log('[ProductListBehavior] _initProductPage - 设置页面可见性:', this.__pageId);
      watcher.setPageVisible(this.__pageId, true);

      console.log('[ProductListBehavior] initialized:', this.__pageId, 'cacheKey:', cacheKey);

      // 首次加载
      await this._loadProducts(true);
    },

    /**
     * 加载商品数据
     * @param {boolean} reset - 是否重置
     */
    async _loadProducts(reset = false) {
      const cacheKey = this._getCacheKey();
      const useCache = this._shouldUseCache ? this._shouldUseCache() : true;

      if (reset) {
        // 搜索/筛选模式：不走缓存，直接查 DB
        if (!useCache) {
          this.setData({ loading: true, hasMore: true });
          await this._loadFromDB(true);
          return;
        }

        // 缓存模式
        const cache = productCacheStore.get(cacheKey);

        if (cache && cache.data && cache.data.length > 0 && !cache.stale) {
          // 有新鲜缓存 → 分页还原第一页
          console.log('[ProductListBehavior] 从缓存加载第一页, total:', cache.data.length);
          const page = cache.data.slice(0, this.__pageSize);
          const hasMore = cache.hasMore || page.length === this.__pageSize;

          this.setData({
            products: page,
            originalProducts: [...page],
            hasMore: hasMore,
            loading: false,
            showSkeleton: false
          });

          this.__cacheIndex = page.length;
          this.__cacheCursor = cache.cursor;

          // 后台校验第一页
          this._validateFirstPageInBackground(cache);
        } else if (cache && cache.data && cache.data.length > 0 && cache.stale) {
          // 缓存脏 → 先显示旧数据，后台校验
          console.log('[ProductListBehavior] 缓存 stale，先显示旧数据');
          const page = cache.data.slice(0, this.__pageSize);
          this.setData({ products: page, originalProducts: [...page], loading: false, showSkeleton: false });
          this.__cacheIndex = page.length;
          this.__cacheCursor = cache.cursor;
          this._validateAndReplace(cache);
        } else {
          // 无缓存 → 走 DB
          console.log('[ProductListBehavior] 无缓存，从 DB 加载');
          this.setData({ loading: true, showSkeleton: true });
          await this._loadFromDB(true);
        }
        return;
      }

      // 加载更多
      if (this.data.loadingMore || !this.data.hasMore || this.data.loading) {
        return;
      }

      this.setData({ loadingMore: true });

      const cache = useCache ? productCacheStore.get(cacheKey) : null;

      // 1. 优先从缓存取
      if (cache && cache.data && this.__cacheIndex != null && this.__cacheIndex < cache.data.length) {
        console.log('[ProductListBehavior] 从缓存加载更多, cacheIndex:', this.__cacheIndex);
        const page = cache.data.slice(this.__cacheIndex, this.__cacheIndex + this.__pageSize);
        const hasMore = page.length === this.__pageSize || cache.hasMore;

        // _id 去重，防止 paginator 状态被后台校验重置后返回重复数据
        const existingIds = new Set(this.data.products.map(p => p._id));
        const deduped = page.filter(p => !existingIds.has(p._id));

        this.setData({
          products: [...this.data.products, ...deduped],
          originalProducts: [...this.data.originalProducts, ...deduped],
          loadingMore: false,
          hasMore: hasMore
        });

        this.__cacheIndex += deduped.length;  // 使用去重后的长度
        return;
      }

      // 2. 缓存耗尽 → 走 DB
      console.log('[ProductListBehavior] 缓存耗尽，从 DB 加载更多');
      const data = await this._loadNextFromDB();

      if (data && data.length > 0) {
        // _id 去重
        const existingIds = new Set(this.data.products.map(p => p._id));
        const deduped = data.filter(p => !existingIds.has(p._id));

        this.setData({
          products: [...this.data.products, ...deduped],
          originalProducts: [...this.data.originalProducts, ...deduped],
          loadingMore: false,
          hasMore: data.length === this.__pageSize
        });

        // 同步追加到缓存
        if (useCache) {
          const newCursor = data[data.length - 1]?._id || null;
          productCacheStore.append(cacheKey, deduped, newCursor, data.length === this.__pageSize);
          this.__cacheIndex += deduped.length;
        }
      } else {
        this.setData({ loadingMore: false, hasMore: false });
      }
    },

    /**
     * 加载更多（触底时页面调用）
     */
    _loadMoreProducts() {
      if (this.data.loadingMore || !this.data.hasMore || this.data.loading) {
        return;
      }
      this._loadProducts(false);
    },

    /**
     * 二分查找商品在列表中的位置（按 _id 降序排列）
     * @param {Array} list - 商品列表（必须按 _id 降序排列）
     * @param {string} targetId - 目标商品 ID
     * @returns {number} - 找到返回索引，未找到返回 -1
     */
    _binarySearchById(list, targetId) {
      if (!list || list.length === 0) return -1;

      let left = 0;
      let right = list.length - 1;

      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const midId = list[mid]._id;

        if (midId === targetId) {
          return mid;  // 找到了
        } else if (midId > targetId) {
          left = mid + 1;  // 降序排列，目标在右边
        } else {
          right = mid - 1;  // 降序排列，目标在左边
        }
      }

      return -1;  // 未找到
    },

    /**
     * 在列表中查找商品位置（根据排序方式选择最优查找方法）
     * @param {Array} list - 商品列表
     * @param {string} targetId - 目标商品 ID
     * @param {boolean} useBinarySearch - 是否尝试使用二分查找
     * @returns {number} - 找到返回索引，未找到返回 -1
     */
    _findProductIndex(list, targetId, useBinarySearch = true) {
      if (!list || list.length === 0) return -1;

      // 尝试二分查找（假设列表按 _id 降序排列）
      if (useBinarySearch) {
        const idx = this._binarySearchById(list, targetId);
        if (idx !== -1) return idx;

        // 二分查找失败，可能列表不是按 _id 排序，回退到线性查找
        console.log('[ProductListBehavior] 二分查找失败，回退到线性查找');
      }

      // 线性查找（兜底）
      return list.findIndex(p => p._id === targetId);
    },

    /**
     * 从缓存重新加载数据
     */
    _reloadFromCache() {
      const cacheKey = this._getCacheKey();
      const cache = productCacheStore.get(cacheKey);
      
      if (!cache || !cache.data) return;

      const currentLoaded = this.data.products.length;
      
      // 如果当前已加载的数据比缓存还多，说明用户已经加载了多页
      // 此时不应该用缓存覆盖，保持当前数据不变
      if (currentLoaded > cache.data.length) {
        console.log(`[ProductListBehavior] 当前已加载 ${currentLoaded} 条 > 缓存 ${cache.data.length} 条，保持原数据`);
        return;
      }
      
      const page = cache.data.slice(0, currentLoaded);
      
      // 判断是否有更多数据：缓存中总数 > 已加载数
      const hasMore = cache.data.length > currentLoaded && cache.hasMore;
      
      this.setData({
        products: page,
        originalProducts: [...page],
        hasMore: hasMore
      });

      this.__cacheIndex = page.length;
      this.__cacheCursor = cache.cursor;
    },

    /**
     * 实时监听变化处理（与宝贝页面逻辑一致）
     * @param {Object} change { type: 'add'|'modify'|'remove', product, docId, cacheKey }
     */
    _onProductChanged(change) {
      const { type, product } = change;
      if (!product || !product._id) return;

      const docId = product._id;
      console.log('[ProductListBehavior] _onProductChanged - type:', type, 'docId:', docId);

      const { originalProducts, sortType, priceSortOrder } = this.data;

      let updatedProducts = [...this.data.products];
      let updatedOriginal = [...originalProducts];

      console.log('[ProductListBehavior] _onProductChanged - 原始products长度:', this.data.products.length);

      const index = updatedProducts.findIndex(p => p._id === docId);
      const originalIndex = updatedOriginal.findIndex(p => p._id === docId);

      // 兼容 'update' 和 'modify' 两种类型
      const isModify = type === 'modify' || type === 'update';

      // 检查是否有筛选条件（页面需要提供 _hasFilters 方法或 data 中的筛选字段）
      const hasFilters = this._checkHasFilters();

      // --- 处理 add ---
      if (type === 'add') {
        // 如果有筛选条件，不在这处理，交给后面的筛选逻辑处理
        if (hasFilters) {
          console.log('[ProductListBehavior] _onProductChanged - add类型但有筛选条件，交给筛选逻辑处理');
        } else {
          if (index === -1 && product.status === 'on' && !product.isDeleted) {
            updatedProducts.push(product);
            // 只在 originalProducts 中不存在时才添加
            if (originalIndex === -1) {
              updatedOriginal.push(product);
            }
          }
        }
      }

      // --- 处理 modify/update ---
      else if (isModify) {
        // 更新显示的 products 数组（无论是否在搜索筛选模式）
        if (index !== -1) {
          updatedProducts[index] = { ...updatedProducts[index], ...product };
        }
        
        // 更新 originalProducts（如果存在）
        if (originalIndex !== -1) {
          updatedOriginal[originalIndex] = { ...updatedOriginal[originalIndex], ...product };
        } else if (product.status === 'on' && !product.isDeleted) {
          // 上架：不在列表中但变为 on → 添加到 originalProducts
          const alreadyInUpdated = updatedOriginal.some(p => p._id === docId);
          if (!alreadyInUpdated) {
            console.log('[ProductListBehavior] _onProductChanged - modify分支添加商品到updatedOriginal');
            updatedOriginal.push(product);
          }
          
          // 更新分页器游标
          this._updatePaginatorCursor(updatedOriginal);
        }

        // 下架 → 移除
        if (product.status === 'off' || product.isDeleted === true) {
          if (index !== -1) {
            updatedProducts.splice(index, 1);
            console.log('[ProductListBehavior] 下架：从显示列表移除商品:', docId);
          }
          if (originalIndex !== -1) {
            updatedOriginal.splice(originalIndex, 1);
            this._updatePaginatorCursor(updatedOriginal);
          }
        }
      }

      // --- 处理 remove ---
      else if (type === 'remove') {
        if (index !== -1) {
          updatedProducts.splice(index, 1);
        }
        if (originalIndex !== -1) {
          updatedOriginal.splice(originalIndex, 1);
          this._updatePaginatorCursor(updatedOriginal);
        }
      }

      // --- 更新 UI ---
      this.setData({ originalProducts: updatedOriginal });

      // 搜索/筛选模式下的更新策略
      if (hasFilters) {
        this._handleFilterModeUpdate(type, product, updatedProducts, updatedOriginal, index, isModify, docId);
      } else {
        // 普通列表模式：保持当前排序
        const sorted = this._getSortedArray(updatedOriginal, sortType);
        this.setData({ products: sorted });
      }
      console.log('[ProductListBehavior] 商品数据更新完成');
    },

    /**
     * 检查是否有筛选条件
     */
    _checkHasFilters() {
      // 页面可以通过 _hasFilters 方法自定义筛选条件检查
      if (this._hasFilters) {
        return this._hasFilters();
      }
      // 默认检查 data 中的筛选字段
      const { keyword, categories, inStock } = this.data;
      return (keyword && keyword.trim() !== '') ||
             (categories && categories.length > 0) ||
             (inStock !== null);
    },

    /**
     * 检查商品是否符合当前筛选条件
     */
    _isProductMatchFilter(item) {
      if (!item) return false;
      const { keyword, categories, inStock, pageType, categoryId, typeId } = this.data;
      
      // 检查搜索关键词
      if (keyword && keyword.trim() !== '') {
        const name = item.name || '';
        if (!name.toLowerCase().includes(keyword.toLowerCase())) {
          return false;
        }
      }
      // 检查分类筛选
      if (categories && categories.length > 0) {
        const itemTypeId = item.typeId || '';
        if (!categories.includes(itemTypeId)) {
          return false;
        }
      }
      // 检查库存筛选
      if (inStock !== null) {
        if (inStock && item.stock <= 0) {
          return false;
        }
        if (!inStock && item.stock > 0) {
          return false;
        }
      }
      // 检查页面类型筛选（category/series/type）
      if ((pageType === 'category' || pageType === 'series') && categoryId) {
        if (item.categoryId !== categoryId) {
          return false;
        }
      }
      if (pageType === 'type' && typeId) {
        const ids = this._catIds || [];
        if (ids.length > 0 && item.typeId && !ids.includes(item.typeId)) {
          return false;
        }
      }
      return true;
    },

    /**
     * 处理筛选模式下的更新
     */
    _handleFilterModeUpdate(type, product, updatedProducts, updatedOriginal, index, isModify, docId) {
      const { sortType } = this.data;

      // 下架逻辑已经在前面的 modify/update 分支中处理过了
      if (product.status === 'off' || product.isDeleted === true) {
        console.log('[ProductListBehavior] 下架后更新UI，products长度:', updatedProducts.length);
        this.setData({ 
          products: updatedProducts,
          originalProducts: updatedOriginal
        });
        return;
      }

      // 修改操作：检查商品是否仍然符合筛选条件
      if (isModify && index !== -1) {
        const currentIndex = updatedProducts.findIndex(p => p._id === docId);
        if (currentIndex !== -1) {
          updatedProducts[currentIndex] = { ...updatedProducts[currentIndex], ...product };
          
          if (this._isProductMatchFilter(product)) {
            console.log('[ProductListBehavior] 修改：商品仍符合筛选条件，更新显示并重新排序');
            const sorted = this._getSortedArray(updatedProducts, sortType);
            this.setData({ products: sorted });
          } else {
            updatedProducts.splice(currentIndex, 1);
            const originalIdx = updatedOriginal.findIndex(p => p._id === docId);
            if (originalIdx !== -1) {
              updatedOriginal.splice(originalIdx, 1);
            }
            console.log('[ProductListBehavior] 修改：商品不再符合筛选条件，已移除');
            this.setData({ 
              products: updatedProducts,
              originalProducts: updatedOriginal
            });
          }
        }
        return;
      }

      // 修改操作：商品不在列表中，但可能变为符合筛选条件
      if (isModify && index === -1) {
        if (this._isProductMatchFilter(product)) {
          console.log('[ProductListBehavior] 修改：商品变为符合筛选条件，添加到列表');
          updatedProducts.push(product);
          updatedOriginal.push(product);
          const sorted = this._getSortedArray(updatedProducts, sortType);
          const sortedOriginal = this._getSortedArray(updatedOriginal, sortType);
          this.setData({ 
            products: sorted,
            originalProducts: sortedOriginal
          });
          this._updatePaginatorCursor(sortedOriginal);
        }
        return;
      }

      // 新增商品（add 或上架）
      if (type === 'add' || (product.status === 'on' && index === -1)) {
        // 判断商品是否应该在当前列表范围内
        const shouldBeInList = this._shouldProductBeInList(product, updatedOriginal, sortType);
        
        if (shouldBeInList && this._isProductMatchFilter(product)) {
          console.log('[ProductListBehavior] 商品上架/新增，加入当前列表');
          updatedProducts.push(product);
          updatedOriginal.push(product);
          const sorted = this._getSortedArray(updatedProducts, sortType);
          const sortedOriginal = this._getSortedArray(updatedOriginal, sortType);
          this._updatePaginatorCursor(sortedOriginal);
          this.setData({ 
            products: sorted,
            originalProducts: sortedOriginal
          });
        } else {
          console.log('[ProductListBehavior] 商品上架/新增，但不在当前列表范围内或不符合筛选条件');
        }
      }
    },

    /**
     * 判断商品是否应该在当前列表范围内
     */
    _shouldProductBeInList(product, updatedOriginal, sortType) {
      if (!updatedOriginal || updatedOriginal.length === 0) {
        return true;
      }
      const lastItem = updatedOriginal[updatedOriginal.length - 1];
      const { priceSortOrder } = this.data;

      if (sortType === 'default') {
        // 综合排序：按 _id 降序，新商品 _id 较大
        return product._id >= lastItem._id;
      }
      if (sortType === 'new') {
        // 新品排序：按创建时间降序
        const ts = product.createdAtTs || (product.createdAt ? new Date(product.createdAt).getTime() : 0);
        const lastTs = lastItem.createdAtTs || (lastItem.createdAt ? new Date(lastItem.createdAt).getTime() : 0);
        return ts >= lastTs;
      }
      if (sortType === 'price') {
        // 价格排序：根据排序方向判断
        if (priceSortOrder === 'desc') {
          return product.price >= lastItem.price;
        } else {
          return product.price <= lastItem.price;
        }
      }
      return false;
    },

    /**
     * 更新分页器游标
     */
    _updatePaginatorCursor(updatedOriginal) {
      if (this.__paginator && this.__paginator.pagination && updatedOriginal.length > 0) {
        const lastItem = updatedOriginal[updatedOriginal.length - 1];
        if (lastItem) {
          const cursorField = this.__paginator.cursorField || '_id';
          this.__paginator.pagination._lastCursor = lastItem[cursorField] || lastItem._id;
          this.__paginator.pagination._hasNext = true;
          console.log('[ProductListBehavior] 更新分页器游标到最后一条数据:', lastItem._id);
        }
      }
    },

    /**
     * 根据排序类型对商品数组排序（与宝贝页面一致）
     */
    _getSortedArray(products, type) {
      const sorted = [...products];
      const { priceSortOrder } = this.data;
      switch (type) {
        case 'price':
          sorted.sort((a, b) => {
            const diff = priceSortOrder === 'asc' ? a.price - b.price : b.price - a.price;
            return diff !== 0 ? diff : (a._id > b._id ? 1 : -1);
          });
          break;
        case 'new':
          sorted.sort((a, b) => {
            const tsA = a.createdAtTs || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
            const tsB = b.createdAtTs || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
            const diff = tsB - tsA; // 降序
            return diff !== 0 ? diff : b._id.localeCompare(a._id);
          });
          break;
        default:
          // 综合排序：按 _id 降序（最新的在前）
          sorted.sort((a, b) => b._id.localeCompare(a._id));
          break;
      }
      return sorted;
    },

    /**
     * 从 DB 加载第一页
     */
    async _loadFromDB(reset) {
      try {
        const params = this._buildDbQuery();
        this._initPaginator(params);
        
        const db = wx.cloud.database();

        // 并行查询数据和最新 updatedAtTs
        const [dataResult, timeResult] = await Promise.all([
          this.__paginator.loadFirstPage({}, { skipSetData: true }),
          db.collection('products')
            .where({ status: 'on', isDeleted: false })
            .orderBy('updatedAtTs', 'desc')
            .limit(1)
            .get()
        ]);
        
        const newProducts = dataResult || [];
        const serverMaxUpdateTime = timeResult.data?.[0]?.updatedAtTs || 0;
        
        console.log('[ProductListBehavior] _loadFromDB - 数据:', newProducts.length, '条，updatedAtTs:', serverMaxUpdateTime);

        this.setData({
          products: newProducts,
          originalProducts: [...newProducts],
          loading: false,
          loadingMore: false,
          hasMore: this.__paginator.hasNext(),
          showSkeleton: false
        });

        // 写入缓存
        const cacheKey = this._getCacheKey();
        const useCache = this._shouldUseCache ? this._shouldUseCache() : true;
        if (useCache && newProducts.length > 0) {
          productCacheStore.set(cacheKey, {
            data: newProducts,
            cacheIndex: newProducts.length,
            cursor: newProducts[newProducts.length - 1]?._id || null,
            hasMore: this.__paginator.hasNext(),
            stale: false,
            serverMaxUpdateTime: serverMaxUpdateTime
          });
          this.__cacheIndex = newProducts.length;
          this.__cacheCursor = newProducts[newProducts.length - 1]?._id || null;
        }
      } catch (err) {
        console.error('[ProductListBehavior] 加载失败:', err);
        this.setData({ loading: false, loadingMore: false, showSkeleton: false });
      }
    },

    /**
     * 从 DB 加载下一页
     */
    async _loadNextFromDB() {
      try {
        if (!this.__paginator) {
          this._initPaginator(this._buildDbQuery());
        }
        console.log('[Behavior] _loadNextFromDB, hasNext:', this.__paginator.hasNext(), 'loading:', this.__paginator.loading, 'loadingMore:', this.__paginator.loadingMore);
        const result = await this.__paginator.loadNextPage();
        console.log('[Behavior] _loadNextFromDB 返回:', result ? result.length : 'undefined');
        return result;
      } catch (err) {
        console.error('[ProductListBehavior] 加载更多失败:', err);
        this.setData({ loadingMore: false });
        return [];
      }
    },

    /**
     * 初始化分页器
     */
    _initPaginator(params) {
      const cursorField = (this._getCursorField && this._getCursorField()) || '_id';
      const sortOrder = (this._getSortOrder && this._getSortOrder()) || 'desc';
      this.__paginator = new PagePaginator(this, {
        collectionName: 'products',
        dataKey: 'products',
        pageSize: this.__pageSize,
        cursorField: cursorField,
        sortOrder: sortOrder,
        extraQuery: params
      });
    },

    // ========== 后台校验 ==========

    /**
     * 后台校验（页面可见时调用，不传 cache 参数）
     */
    async _validateCacheInBackground() {
      const cacheKey = this._getCacheKey();
      const cache = productCacheStore.get(cacheKey);
      if (cache && cache.data && cache.data.length > 0) {
        await this._validateFirstPageInBackground(cache);
      }
    },

    /**
     * 后台校验第一页数据（检查前N条，发现差异则替换）
     */
    async _validateFirstPageInBackground(cache) {
      try {
        await new Promise(resolve => setTimeout(resolve, 300));

        // 检查前N条数据（与缓存第一页数量相同，最多18条）
        const params = this._buildDbQuery();
        const db = wx.cloud.database();
        const cursorField = (this._getCursorField && this._getCursorField()) || '_id';
        const sortOrder = (this._getSortOrder && this._getSortOrder()) || 'desc';
        const checkCount = Math.min(cache.data.length, this.__pageSize || 18);

        const result = await db.collection('products')
          .where(params)
          .orderBy(cursorField, sortOrder)
          .orderBy('_id', sortOrder)
          .limit(checkCount)
          .get();

        const dbData = result.data || [];

        if (dbData.length === 0 && cache.data.length > 0) {
          // 数据库无数据但缓存有数据 → 清空
          console.log('[ProductListBehavior] 后台校验: 数据库无数据，清空缓存');
          this.setData({ products: [], originalProducts: [], hasMore: false });
          const cacheKey = this._getCacheKey();
          productCacheStore.set(cacheKey, {
            data: [],
            cacheIndex: 0,
            cursor: null,
            hasMore: false,
            stale: false
          });
          return;
        }

        // 对比前N条数据的ID
        const cacheIds = cache.data.slice(0, checkCount).map(p => p._id);
        const dbIds = dbData.map(p => p._id);

        const hasDiff = cacheIds.length !== dbIds.length ||
          cacheIds.some((id, idx) => id !== dbIds[idx]);

        if (hasDiff) {
          console.log('[ProductListBehavior] 后台校验: 发现差异，替换数据',
            'cacheIds:', cacheIds.slice(0, 3), '...',
            'dbIds:', dbIds.slice(0, 3), '...');
          await this._validateAndReplace(cache);
        } else {
          console.log('[ProductListBehavior] 后台校验: 缓存有效');
          const cacheKey = this._getCacheKey();
          const cur = productCacheStore.get(cacheKey);
          if (cur) {
            cur.stale = false;
            productCacheStore.set(cacheKey, { ...cur, stale: false });
          }
        }
      } catch (err) {
        console.error('[ProductListBehavior] 后台校验失败:', err);
      }
    },

    /**
     * 校验并替换为 DB 数据（使用 updatedAtTs 时间戳对比）
     */
    async _validateAndReplace(cache) {
      try {
        const db = wx.cloud.database();
        
        // 查询数据库最新的 updatedAtTs
        const timeRes = await db.collection('products')
          .where({ status: 'on', isDeleted: false })
          .orderBy('updatedAtTs', 'desc')
          .limit(1)
          .get();
        
        const serverMaxTime = timeRes.data?.[0]?.updatedAtTs || 0;
        const cachedMaxTime = cache.serverMaxUpdateTime || 0;
        
        console.log('[ProductListBehavior] 时间戳对比: 缓存=', cachedMaxTime, ', 数据库=', serverMaxTime);
        
        // 如果数据库的 updatedAtTs 不大于缓存的，说明没有商品被修改过，不需要替换
        if (serverMaxTime <= cachedMaxTime) {
          console.log('[ProductListBehavior] 时间戳对比无差异，缓存有效');
          
          // 更新缓存的 stale 标记
          const cacheKey = this._getCacheKey();
          const cur = productCacheStore.get(cacheKey);
          if (cur) {
            cur.stale = false;
            productCacheStore.set(cacheKey, { ...cur, stale: false });
          }
          return;
        }
        
        console.log('[ProductListBehavior] 时间戳对比发现差异，需要替换数据');
        
        // 继续执行数据替换逻辑
        const params = this._buildDbQuery();
        const cursorField = (this._getCursorField && this._getCursorField()) || '_id';
        const sortOrder = (this._getSortOrder && this._getSortOrder()) || 'desc';

        // 计算需要加载的数据量（用户已加载的数据量）
        const loadedCount = this.data.products.length;
        const loadCount = Math.max(loadedCount, this.__pageSize || 18);

        console.log('[ProductListBehavior] 校验替换: 加载', loadCount, '条数据');

        // 直接查询数据库，不经过分页器
        const result = await db.collection('products')
          .where(params)
          .orderBy(cursorField, sortOrder)
          .orderBy('_id', sortOrder)
          .limit(loadCount)
          .get();

        const dbData = result.data || [];

        if (dbData.length > 0) {
          // 获取新的 updatedAtTs
          const newTimeRes = await db.collection('products')
            .where({ status: 'on', isDeleted: false })
            .orderBy('updatedAtTs', 'desc')
            .limit(1)
            .get();
          const newServerMaxTime = newTimeRes.data?.[0]?.updatedAtTs || 0;
          
          // 静默更新UI
          this.setData({
            products: dbData,
            originalProducts: [...dbData],
            hasMore: dbData.length === loadCount
          });

          // 更新缓存
          const cacheKey = this._getCacheKey();
          productCacheStore.set(cacheKey, {
            data: dbData,
            cacheIndex: dbData.length,
            cursor: dbData[dbData.length - 1]?._id || null,
            hasMore: dbData.length === loadCount,
            stale: false,
            serverMaxUpdateTime: newServerMaxTime
          });
          this.__cacheIndex = dbData.length;
          this.__cacheCursor = dbData[dbData.length - 1]?._id || null;

          // 更新分页器状态（不重新初始化，只更新游标）
          if (this.__paginator && dbData.length > 0) {
            // 重置分页器，设置新的游标
            this.__paginator.reset();
            // 手动设置分页器的游标状态
            if (this.__paginator.pagination) {
              this.__paginator.pagination._lastCursor = dbData[dbData.length - 1]?._id || null;
              this.__paginator.pagination._hasNext = dbData.length === loadCount;
            }
          }

          console.log('[ProductListBehavior] 校验替换完成: 更新了', dbData.length, '条数据');
        } else {
          // 数据库无数据
          this.setData({
            products: [],
            originalProducts: [],
            hasMore: false
          });
          const cacheKey = this._getCacheKey();
          productCacheStore.set(cacheKey, {
            data: [],
            cacheIndex: 0,
            cursor: null,
            hasMore: false,
            stale: false,
            serverMaxUpdateTime: 0
          });
        }
      } catch (err) {
        console.error('[ProductListBehavior] 校验替换失败:', err);
      }
    },

    /**
     * 强制从远端刷新（搜索/筛选清除后调用）
     */
    async _refreshFromRemote() {
      this.setData({ loading: true });
      await this._loadFromDB(true);
    }
  }
});

export default productListBehavior;
