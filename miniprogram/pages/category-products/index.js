// pages/category-products/index.js
const db = wx.cloud.database()

Page({

  /**
   * 页面的初始数据
   */
  data: {
    products: [],
    categoryName: '',
    categoryId: ''
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