// pages/category-products/index.js
import watcherManager from '../../utils/watcherManager';

const db = wx.cloud.database()

Page({

  /**
   * 页面的初始数据
   */
  data: {
    products: [],
    categoryName: '',
    categoryId: '',
    pageVisible: false
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    if (options.id) {
      this.setData({ categoryId: options.id })
      this.loadCategoryData(options.id)
      this.loadProducts(options.id)
    }
  },

  /**
   * 加载分类数据
   */
  loadCategoryData(categoryId) {
    db.collection('product_types').doc(categoryId).get().then(res => {
      if (res.data) {
        this.setData({ categoryName: res.data.name })
      }
    }).catch(err => {
      console.error('加载分类数据失败:', err)
    })
  },

  /**
   * 加载分类下的商品
   */
  loadProducts(categoryId) {
    wx.showLoading({ title: '加载中...' })
    db.collection('products').where({ typeId: categoryId, isDeleted: false }).get().then(res => {
      this.setData({ products: res.data })
      wx.hideLoading()
    }).catch(err => {
      console.error('加载商品失败:', err)
      wx.hideLoading()
    })
  },

  onShow() {
    this.setData({ pageVisible: true });
    if (this.data.categoryId) {
      console.log('[分类商品页面] 开始实时监听');
      this.startCategoryProductWatch();
    }
  },

  onHide() {
    this.setData({ pageVisible: false });
    console.log('[分类商品页面] 关闭实时监听');
    watcherManager.destroy('category_products');
  },

  onUnload() {
    console.log('[分类商品页面] 关闭实时监听');
    watcherManager.destroy('category_products');
  },

  // 启动分类商品监听
  startCategoryProductWatch() {
    const { categoryId } = this.data;
    if (!categoryId) {
      console.warn('[分类商品页面] 没有分类ID，无法启动监听');
      return;
    }

    // 使用watcherManager创建监听
    watcherManager.create('category_products', () => {
      try {
        const db = wx.cloud.database();
        return db.collection('products')
          .where({ typeId: categoryId, isDeleted: false })
          .watch({
            onChange: (snapshot) => {
              if (!this.data.pageVisible) return;
              console.log('[分类商品页面] 商品数据变化:', snapshot);
              this.handleProductChanges(snapshot);
            },
            onError: (error) => {
              console.error('[分类商品页面] 商品监听失败:', error);
              watcherManager.autoReconnect('category_products', 'category product watch error');
            }
          });
      } catch (error) {
        console.error('[分类商品页面] 初始化商品监听失败:', error);
        throw error;
      }
    });
  },

  // 处理商品数据变化
  handleProductChanges(snapshot) {
    if (!snapshot.docChanges || snapshot.docChanges.length === 0) {
      return;
    }
    
    // 重新获取分类商品
    this.loadProducts(this.data.categoryId);
  },

  /**
   * 返回上一页
   */
  goBack() {
    wx.navigateBack()
  },

  /**
   * 跳转到商品详情页
   */
  goToProductDetail(e) {
    const productId = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/product-detail/index?id=${productId}`
    })
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    if (this.data.categoryId) {
      this.loadProducts(this.data.categoryId)
    }
    wx.stopPullDownRefresh()
  }
})