
const db = wx.cloud.database();
const _ = db.command;

class CursorPagination {
  constructor(options = {}) {
    this.pageSize = options.pageSize || 20;
    this.cursorField = options.cursorField || 'createdAt';
    this.sortOrder = options.sortOrder || 'desc';
    this.secondarySortField = options.secondarySortField || '_id';  // 二次排序字段
    this.secondarySortOrder = options.secondarySortOrder || options.sortOrder;  // 二次排序顺序
    this.hasNext = true;
    this.lastCursor = null;
    this.lastId = null;
    this.skipCount = 0;
    this.totalLoaded = 0;     // 已加载总数（游标+skip 统一追踪）
    this.baseQuery = null;
    this.collectionName = '';
  }

  init(collectionName, baseQuery = {}) {
    this.collectionName = collectionName;
    this.baseQuery = baseQuery;
    this.hasNext = true;
    this.lastCursor = null;
    this.lastId = null;
    this.skipCount = 0;
    this.totalLoaded = 0;
    return this;
  }

  setPageSize(pageSize) {
    this.pageSize = pageSize;
    return this;
  }

  setCursorField(field) {
    this.cursorField = field;
    return this;
  }

  setSortOrder(order) {
    this.sortOrder = order;
    return this;
  }

  async fetchPage() {
    if (!this.hasNext || !this.collectionName) {
      return { data: [], hasNext: false };
    }

    let data = [];
    const fetchLimit = Math.min(this.pageSize + 1, 20);

    try {
      if (this.cursorField === '_id') {
        // === _id 游标（唯一，字符串比较可靠）===
        let query = db.collection(this.collectionName).where(this.baseQuery);
        if (this.lastCursor !== null) {
          const cond = this.sortOrder === 'desc'
            ? { _id: _.lt(this.lastId || this.lastCursor) }
            : { _id: _.gt(this.lastId || this.lastCursor) };
          query = db.collection(this.collectionName).where({ ...this.baseQuery, ...cond });
        }
        const result = await query
          .orderBy('_id', this.sortOrder)
          .limit(fetchLimit).get();
        data = result.data || [];
      } else {
        // === 非 _id 游标（如 createdAt/price）：先用游标，比较失败则回退 skip/limit ===
        let result;
        let usedSkip = false;

        if (this.lastCursor !== null && this.lastId !== null) {
          // 尝试游标：考虑二次排序字段
          const rawVal = this.lastCursor;
          const cursorVal = rawVal instanceof Date ? new Date(rawVal.getTime()) :
                            (rawVal && typeof rawVal.getTime === 'function') ? new Date(rawVal.getTime()) : rawVal;
          
          // 使用复合条件：主字段比较 + 次字段比较（处理主字段相同的情况）
          // 主字段降序：(cursorField < cursorVal) OR (cursorField == cursorVal AND secondaryField 根据 secondarySortOrder 比较)
          // 主字段升序：(cursorField > cursorVal) OR (cursorField == cursorVal AND secondaryField 根据 secondarySortOrder 比较)
          const cond1 = this.sortOrder === 'desc' 
            ? { [this.cursorField]: _.lt(cursorVal) }
            : { [this.cursorField]: _.gt(cursorVal) };
            
          // 次字段的比较方向只取决于 secondarySortOrder，与主排序方向无关
          // 次字段降序：下一页的次字段值 < 当前最后一条 → _.lt
          // 次字段升序：下一页的次字段值 > 当前最后一条 → _.gt
          const secondaryCompare = this.secondarySortOrder === 'desc' 
            ? _.lt(this.lastId) 
            : _.gt(this.lastId);
          const cond2 = { [this.cursorField]: _.eq(cursorVal), [this.secondarySortField]: secondaryCompare };
          
          console.log('[CursorPagination] cursor try, cursorVal:', cursorVal, ', lastId:', this.lastId);
          // 使用 _.and() 组合 baseQuery 和 or 条件
          const query = _.and([
            this.baseQuery,
            _.or([cond1, cond2])
          ]);
          const cursorResult = await db.collection(this.collectionName)
            .where(query)
            .orderBy(this.cursorField, this.sortOrder)
            .orderBy(this.secondarySortField, this.secondarySortOrder)
            .limit(fetchLimit).get();

          if (cursorResult.data && cursorResult.data.length > 0) {
            // 游标生效
            result = cursorResult;
          } else {
            // 游标失败，用已加载总数做 skip 偏移回退
            this.skipCount = this.totalLoaded || 0;
            console.log('[CursorPagination] cursor返回0条，回退 skip/limit, skipCount重置为 totalLoaded:', this.skipCount);
            usedSkip = true;
          }
        }

        if (!result) {
          // 第一页 或 游标回退：skip/limit
          const skipNum = this.skipCount || 0;
          console.log('[CursorPagination] skip/limit, skip:', skipNum);
          result = await db.collection(this.collectionName)
            .where(this.baseQuery)
            .orderBy(this.cursorField, this.sortOrder)
            .orderBy(this.secondarySortField, this.secondarySortOrder)
            .skip(skipNum)
            .limit(fetchLimit).get();
          usedSkip = true;
        }

        data = result.data || [];

        // 无论游标还是 skip，追踪已加载总数
        this.totalLoaded = (this.totalLoaded || 0) + Math.min(data.length, this.pageSize);
        if (usedSkip) {
          this.skipCount = (this.skipCount || 0) + Math.min(data.length, this.pageSize);
        }
      }

      if (data.length > this.pageSize) {
        const lastItem = data[this.pageSize - 1];
        this.lastCursor = lastItem[this.cursorField];
        this.lastId = lastItem._id;
        this.hasNext = true;
        return { data: data.slice(0, this.pageSize), hasNext: true };
      } else {
        this.hasNext = false;
        return { data, hasNext: false };
      }
    } catch (error) {
      console.error('[CursorPagination] fetchPage error:', error);
      return { data: [], hasNext: false };
    }
  }

  async fetchAll() {
    const allData = [];
    while (this.hasNext) {
      const { data } = await this.fetchPage();
      allData.push(...data);
    }
    return allData;
  }

  reset() {
    this.hasNext = true;
    this.lastCursor = null;
    this.lastId = null;
    this.skipCount = 0;
    this.totalLoaded = 0;
    return this;
  }

  getHasNext() {
    return this.hasNext;
  }

  getLastCursor() {
    return this.lastCursor;
  }
}

module.exports = CursorPagination;
