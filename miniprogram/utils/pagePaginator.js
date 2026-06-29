const CursorPagination = require('./cursorPagination');

class PagePaginator {
  constructor(pageContext, options = {}) {
    this.page = pageContext;
    this.collectionName = options.collectionName || '';
    this.dataKey = options.dataKey || 'list';
    this.pageSize = options.pageSize || 20;
    this.cursorField = options.cursorField || 'createdAt';
    this.sortOrder = options.sortOrder || 'desc';
    this.secondarySortField = options.secondarySortField || '_id';
    this.secondarySortOrder = options.secondarySortOrder || this.sortOrder;
    this.extraQuery = options.extraQuery || {};
    
    this.pagination = null;
    this.hasMoreKey = options.hasMoreKey || 'hasMore';

    this.loading = false;
    this.loadingMore = false;

    this.init();
  }

  init() {
    this.pagination = new CursorPagination({
      pageSize: this.pageSize,
      cursorField: this.cursorField,
      sortOrder: this.sortOrder,
      secondarySortField: this.secondarySortField,
      secondarySortOrder: this.secondarySortOrder
    });
  }

  async loadFirstPage(baseQuery = {}, options = {}) {
    if (this.loading) return;

    this.loading = true;
    if (!options.skipSetData) {
      this.page.setData({ loading: true });
    }

    try {
      const query = { ...baseQuery, ...this.extraQuery };
      this.pagination.init(this.collectionName, query).reset();

      const { data, hasNext } = await this.pagination.fetchPage();

      if (!options.skipSetData) {
        this.page.setData({
          [this.dataKey]: data,
          loading: false,
          loadingMore: false,
          [this.hasMoreKey]: hasNext
        });
      }

      return data;
    } catch (error) {
      console.error('PagePaginator loadFirstPage error:', error);
      if (!options.skipSetData) {
        this.page.setData({ loading: false, loadingMore: false });
      }
      throw error;
    } finally {
      this.loading = false;
    }
  }

  async loadNextPage(options = {}) {
    if (this.loading || this.loadingMore || !this.pagination.getHasNext()) return;

    this.loadingMore = true;
    if (!options.skipSetData) {
      this.page.setData({ loadingMore: true });
    }

    try {
      const { data, hasNext } = await this.pagination.fetchPage();

      if (!options.skipSetData) {
        if (data.length > 0) {
          // 去重：过滤掉已经存在的商品（同时检查 dataKey 和 products）
          // 这是因为 setData 是异步的，dataKey 可能还没更新到最新
          const currentData = this.page.data[this.dataKey] || [];
          const productsData = this.page.data.products || [];
          
          console.log('[PagePaginator] loadNextPage - currentData长度:', currentData.length, 
            ', productsData长度:', productsData.length, 
            ', 数据库返回长度:', data.length);
          console.log('[PagePaginator] loadNextPage - currentData前3个ID:', currentData.slice(0, 3).map(item => item._id).join(', '));
          console.log('[PagePaginator] loadNextPage - 数据库返回前3个ID:', data.slice(0, 3).map(item => item._id).join(', '));
          
          // 合并所有已存在的商品 _id
          const existingIds = new Set([
            ...currentData.map(item => item._id),
            ...productsData.map(item => item._id)
          ]);
          const newData = data.filter(item => !existingIds.has(item._id));
          
          console.log('[PagePaginator] loadNextPage - 去重后新数据长度:', newData.length, 
            ', 新数据ID:', newData.map(item => item._id).join(', '));
          
          if (newData.length > 0) {
            // 修正 totalLoaded 和 skipCount（防止 cursor 查询返回重复数据导致虚高）
            const actualNewCount = newData.length;
            const fetchedCount = data.length;
            if (fetchedCount > actualNewCount && this.pagination) {
              const diff = fetchedCount - actualNewCount;
              this.pagination.totalLoaded = Math.max(0, (this.pagination.totalLoaded || 0) - diff);
              this.pagination.skipCount = Math.max(0, (this.pagination.skipCount || 0) - diff);
              console.log('[PagePaginator] 修正 totalLoaded:', this.pagination.totalLoaded, ', skipCount:', this.pagination.skipCount);
            }
            
            await this.page.setData({
              [this.dataKey]: [...currentData, ...newData],
              loadingMore: false,
              [this.hasMoreKey]: hasNext
            });
            return newData;
          } else {
            // 全部是重复数据，回退 totalLoaded 和 skipCount
            if (this.pagination) {
              const fetchedCount = Math.min(data.length, this.pagination.pageSize);
              this.pagination.totalLoaded = Math.max(0, (this.pagination.totalLoaded || 0) - fetchedCount);
              this.pagination.skipCount = Math.max(0, (this.pagination.skipCount || 0) - fetchedCount);
              console.log('[PagePaginator] 全部重复，回退 totalLoaded:', this.pagination.totalLoaded, ', skipCount:', this.pagination.skipCount);
            }
            
            await this.page.setData({
              loadingMore: false,
              [this.hasMoreKey]: hasNext
            });
            return [];
          }
        } else {
          await this.page.setData({
            loadingMore: false,
            [this.hasMoreKey]: false
          });
        }
      }

      return data;
    } catch (error) {
      console.error('PagePaginator loadNextPage error:', error);
      if (!options.skipSetData) {
        await this.page.setData({ loadingMore: false });
      }
      throw error;
    } finally {
      this.loadingMore = false;
    }
  }

  reset() {
    this.pagination.reset();
    this.loading = false;
    this.loadingMore = false;
  }

  updateExtraQuery(extraQuery) {
    this.extraQuery = extraQuery;
    this.reset();
  }

  hasNext() {
    return this.pagination.getHasNext();
  }
}

module.exports = PagePaginator;
