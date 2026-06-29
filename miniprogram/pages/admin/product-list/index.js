// pages/admin/product-list/index.js
import PagePaginator from '../../../utils/pagePaginator';
import productCacheStore from '../../../utils/productCacheStore';

const db = wx.cloud.database();
const _ = db.command;

Page({
  data: {
    pageTitle: '商品列表',
    products: [],
    originalProducts: [],
    loading: false,
    sortType: 'default',
    priceSortOrder: 'asc',
    emptyText: '暂无商品',
    // 页面参数
    pageType: 'all', // all, search, category, series, type, filter
    keyword: '',
    categoryId: '',
    typeId: '',
    categories: [],
    inStock: null,
    // 分页相关
    loadingMore: false,
    hasMore: true,
    showSkeleton: true
  },

  async onLoad(options) {
    const { type, keyword, categoryId, typeId, categories, inStock } = options;
    const decodedKeyword = keyword ? decodeURIComponent(keyword) : '';

    this.setData({
      pageType: type || 'all',
      keyword: decodedKeyword,
      categoryId: categoryId || '',
      typeId: typeId || '',
      categories: categories ? categories.split(',') : [],
      inStock: inStock !== undefined ? inStock === 'true' : null
    });

    await this.setPageTitle();

    // 缓存优先加载
    const cacheKey = this._getCacheKey();
    const cache = productCacheStore.get(cacheKey);

    if (cache && cache.data && cache.data.length > 0 && !cache.stale) {
      console.log('[Admin商品列表] 从缓存加载第一页, total:', cache.data.length);
      this.setData({
        products: cache.data.slice(0, 18),
        hasMore: cache.data.length >= 18 || cache.hasMore,
        showSkeleton: false
      });
      this.__cacheIndex = Math.min(18, cache.data.length);
    }

    this.loadProducts(true);
  },

  onShow() {
    if (this._initialized) {
      console.log('[Admin商品列表] 页面显示，刷新数据');
      this.loadProducts(true);
    }
    this._initialized = true;
  },

  _getCacheKey() {
    const { pageType, categoryId, typeId } = this.data;
    if (pageType === 'category' || pageType === 'series') return `admin_products_series_${categoryId || ''}`;
    if (pageType === 'type') return `admin_products_type_${typeId || ''}`;
    return 'admin_products_all';
  },

  // 获取系列名称
  getCategoryName(categoryId) {
    return new Promise((resolve, reject) => {
      db.collection('category').doc(categoryId).get().then(res => {
        if (res.data) {
          resolve(res.data.name);
        } else {
          resolve('系列商品');
        }
      }).catch(err => {
        console.error('获取系列名称失败:', err);
        resolve('系列商品');
      });
    });
  },

  // 获取分类名称
  getTypeName(typeId) {
    return new Promise((resolve, reject) => {
      db.collection('product_types').doc(typeId).get().then(res => {
        if (res.data) {
          resolve(res.data.name);
        } else {
          resolve('分类商品');
        }
      }).catch(err => {
        console.error('获取分类名称失败:', err);
        resolve('分类商品');
      });
    });
  },

  // 设置页面标题
  async setPageTitle() {
    const { pageType, keyword, categoryId, typeId, categories, inStock } = this.data;
    let title = '商品列表';

    // 检查是否有搜索条件
    const hasSearch = keyword && keyword.trim() !== '';
    // 检查是否有筛选条件
    const hasFilter = (categories && categories.length > 0) || (inStock !== null);

    if (hasSearch && hasFilter) {
      title = '搜索和筛选结果';
    } else if (hasSearch) {
      title = '搜索结果';
    } else if (hasFilter) {
      title = '筛选结果';
    } else {
      switch (pageType) {
        case 'category':
        case 'series':
          if (categoryId) {
            title = await this.getCategoryName(categoryId);
          } else {
            title = '系列商品';
          }
          break;
        case 'type':
          if (typeId) {
            title = await this.getTypeName(typeId);
          } else {
            title = '分类商品';
          }
          break;
        default:
          title = '全部商品';
      }
    }

    this.setData({ pageTitle: title });
    wx.setNavigationBarTitle({ title });
  },

  buildQueryParams(categoryIds = []) {
    const { pageType, keyword, categoryId, categories, inStock } = this.data;
    const params = {};

    if (pageType === 'category' || pageType === 'series') {
      if (categoryId) {
        params.categoryId = categoryId;
      }
      if (categories && categories.length > 0) {
        params.typeId = _.in(categories);
      }
    } else if (pageType === 'type' && categoryIds.length > 0) {
      if (categories && categories.length > 0) {
        const intersectedIds = categoryIds.filter(id => categories.includes(id));
        if (intersectedIds.length > 0) {
          params.typeId = _.in(intersectedIds);
        } else {
          params._id = '___NO_RESULTS___';
        }
      } else {
        params.typeId = _.in(categoryIds);
      }
    } else if (categories && categories.length > 0) {
      params.typeId = _.in(categories);
    }

    if (keyword && keyword.trim() !== '') {
      params.name = db.RegExp({ regexp: keyword, options: 'i' });
    }

    if (inStock !== null) {
      params.stock = inStock ? _.gt(0) : _.lte(0);
    }

    return params;
  },

  initProductListPaginator(params) {
    this.productListPaginator = new PagePaginator(this, {
      collectionName: 'products',
      dataKey: 'products',
      pageSize: 18,
      cursorField: '_id',
      sortOrder: 'desc',
      extraQuery: params
    });
  },

  async loadProducts(reset = false) {
    const { pageType, typeId } = this.data;
    const PAGE_SIZE = 18;
    const cacheKey = this._getCacheKey();

    if (reset) {
      if (this.__cacheIndex == null || this.data.products.length === 0) {
        this.setData({ loading: true, hasMore: true });
      }
    } else {
      // 加载更多：优先从缓存取
      if (this.data.loadingMore || !this.data.hasMore) return;
      this.setData({ loadingMore: true });

      const cache = productCacheStore.get(cacheKey);
      if (cache && cache.data && this.__cacheIndex != null && this.__cacheIndex < cache.data.length) {
        const page = cache.data.slice(this.__cacheIndex, this.__cacheIndex + PAGE_SIZE);
        this.setData({
          products: [...this.data.products, ...page],
          loadingMore: false,
          hasMore: page.length === PAGE_SIZE || cache.hasMore
        });
        this.__cacheIndex += page.length;
        return;
      }
      this.setData({ loadingMore: true });
    }

    try {
      let categoryIds = [];

      if (pageType === 'type' && typeId) {
        const res = await db.collection('product_types').where({ parentId: typeId }).get();
        categoryIds = [typeId, ...res.data.map(item => item._id)];
      }

      const params = this.buildQueryParams(categoryIds);

      if (reset || !this.productListPaginator) {
        this.initProductListPaginator(params);
      }

      let data;
      if (reset) {
        data = await this.productListPaginator.loadFirstPage({}, { skipSetData: true });
      } else {
        data = await this.productListPaginator.loadNextPage();
      }

      if (reset) {
        const newProducts = data || [];
        const { sortType, priceSortOrder } = this.data;
        let sortedProducts = [...newProducts];
        switch (sortType) {
          case 'new':
            sortedProducts.sort((a, b) => {
              const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
              return timeB - timeA;
            });
            break;
          case 'price':
            sortedProducts.sort((a, b) => {
              const priceA = a.price || 0;
              const priceB = b.price || 0;
              return priceSortOrder === 'asc' ? priceA - priceB : priceB - priceA;
            });
            break;
          default:
            sortedProducts.sort((a, b) => {
              const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
              const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
              return timeB - timeA;
            });
            break;
        }
        this.setData({
          originalProducts: [...newProducts],
          products: sortedProducts,
          loading: false,
          loadingMore: false,
          hasMore: this.productListPaginator.hasNext(),
          showSkeleton: false
        });

        // 写入缓存
        const cacheKey = this._getCacheKey();
        if (newProducts.length > 0) {
          productCacheStore.set(cacheKey, {
            data: newProducts,
            cacheIndex: newProducts.length,
            cursor: newProducts[newProducts.length - 1]?._id || null,
            hasMore: this.productListPaginator.hasNext(),
            stale: false
          });
          this.__cacheIndex = newProducts.length;
        }
      } else {
        // 加载更多：追加到缓存
        const newData = data || [];
        if (newData.length > 0) {
          this.setData({
            products: [...this.data.products, ...newData],
            loadingMore: false,
            hasMore: newData.length === 18
          });

          const cacheKey = this._getCacheKey();
          const cursor = newData[newData.length - 1]?._id || null;
          productCacheStore.append(cacheKey, newData, cursor, newData.length === 18);
          this.__cacheIndex += newData.length;
        } else {
          this.setData({ loadingMore: false, hasMore: false });
        }
      }
    } catch (err) {
      console.error('加载商品失败:', err);
      this.setData({ loading: false, loadingMore: false });
    }
  },

  loadMoreProducts() {
    if (this.data.loadingMore || !this.data.hasMore || this.data.loading) {
      return;
    }
    this.loadProducts();
  },

  setSortType(e) {
    const { type } = e.currentTarget.dataset;
    let { sortType, priceSortOrder } = this.data;

    if (type === 'price') {
      if (sortType === 'price') {
        priceSortOrder = priceSortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        priceSortOrder = 'asc';
      }
    }

    this.setData({ sortType: type, priceSortOrder });
    this.applySort();
  },

  applySort() {
    const { sortType, priceSortOrder, originalProducts } = this.data;
    let sortedProducts = [...originalProducts];

    switch (sortType) {
      case 'new':
        sortedProducts.sort((a, b) => {
          const diff = (b.createdAt ? new Date(b.createdAt).getTime() : 0) - (a.createdAt ? new Date(a.createdAt).getTime() : 0);
          return diff !== 0 ? diff : (a._id > b._id ? 1 : -1);
        });
        break;
      case 'price':
        sortedProducts.sort((a, b) => {
          const diff = priceSortOrder === 'asc' ? (a.price || 0) - (b.price || 0) : (b.price || 0) - (a.price || 0);
          return diff !== 0 ? diff : (a._id > b._id ? 1 : -1);
        });
        break;
      default:
        sortedProducts = [...originalProducts];
        break;
    }

    this.setData({ products: sortedProducts });
  },

  handleSearch(e) {
    const { keyword } = e.detail;
    this.setData({ keyword: keyword });
    this.setPageTitle();
    this.loadProducts(true);
  },

  handleFilter(e) {
    const { category, inStock } = e.detail;
    this.setData({
      categories: category || [],
      inStock: inStock
    });
    this.setPageTitle();
    this.loadProducts(true);
  },

  goToProductDetail(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/product-detail/index?id=${id}`
    });
  },

  goBack() {
    wx.navigateBack();
  },

  // 跳转到添加商品页面
  goToAddProduct() {
    const { typeId } = this.data;
    wx.navigateTo({
      url: `/pages/admin/product-publish/index?typeId=${typeId}`
    });
  },

  // 下架商品
  下架商品(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认下架',
      content: '确定要下架这个商品吗？',
      success: (res) => {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'updateProduct',
            data: {
              productId: id,
              updateData: {
                status: 'off',
                updatedAt: new Date()
              }
            }
          }).then(res => {
            console.log('云函数下架结果:', res);

            if (res.result && res.result.success) {
              console.log('云函数下架成功');
              wx.showToast({
                title: '商品下架成功',
                icon: 'success'
              });

              getApp().globalData.productsNeedRefresh = true;
              this.loadProducts(true);
            } else {
              console.error('云函数下架失败:', res.result.error);
              wx.showToast({
                title: '下架商品失败',
                icon: 'none'
              });
            }
          }).catch(err => {
            console.error('调用云函数失败:', err);
            wx.showToast({
              title: '下架商品失败',
              icon: 'none'
            });
          });
        }
      }
    });
  },

  // 上架商品
  上架商品(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认上架',
      content: '确定要上架这个商品吗？',
      success: (res) => {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'updateProduct',
            data: {
              productId: id,
              updateData: {
                status: 'on',
                updatedAt: new Date()
              }
            }
          }).then(res => {
            console.log('云函数上架结果:', res);

            if (res.result && res.result.success) {
              console.log('云函数上架成功');
              wx.showToast({
                title: '商品上架成功',
                icon: 'success'
              });

              getApp().globalData.productsNeedRefresh = true;
              this.loadProducts(true);
            } else {
              console.error('云函数上架失败:', res.result.error);
              wx.showToast({
                title: '上架商品失败',
                icon: 'none'
              });
            }
          }).catch(err => {
            console.error('调用云函数失败:', err);
            wx.showToast({
              title: '上架商品失败',
              icon: 'none'
            });
          });
        }
      }
    });
  },

  // 编辑商品
  编辑商品(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/admin/product-publish/index?id=${id}`
    });
  }
});
