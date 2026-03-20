// pages/search-result/index.js
const db = wx.cloud.database()

Page({

  /**
   * 页面的初始数据
   */
  data: {
    keyword: '',
    products: []
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    if (options.keyword) {
      const keyword = decodeURIComponent(options.keyword)
      this.setData({ keyword })
      this.searchProducts(keyword)
    }
  },

  /**
   * 搜索商品
   */
  searchProducts(keyword) {
    wx.showLoading({ title: '搜索中...' })
    db.collection('products').where({
      isDeleted: false,
      name: db.RegExp({
        regexp: keyword,
        options: 'i'
      })
    }).get().then(res => {
      this.setData({ products: res.data })
      wx.hideLoading()
    }).catch(err => {
      console.error('搜索失败:', err)
      wx.hideLoading()
    })
  },

  /**
   * 搜索输入
   */
  handleSearchInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  /**
   * 执行搜索
   */
  handleSearch() {
    const keyword = this.data.keyword.trim()
    if (keyword) {
      this.searchProducts(keyword)
    }
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
  }
})