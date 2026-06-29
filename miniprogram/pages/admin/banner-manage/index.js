// pages/admin/banner-manage/index.js
const db = wx.cloud.database()

Page({

  data: {
    bannerList: [],
    loading: false
  },

  onLoad() {
    this.loadBannerList()
  },

  onShow() {
    this.loadBannerList()
  },

  async loadBannerList() {
    this.setData({ loading: true })
    try {
      const res = await db.collection('banner').where({ isDeleted: false }).orderBy('sortOrder', 'asc').get()
      this.setData({
        bannerList: res.data,
        loading: false
      })
    } catch (err) {
      console.error('加载轮播图失败:', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  goToAddPage() {
    wx.navigateTo({
      url: '/pages/admin/banner-manage/edit/index'
    })
  },

  goToEditPage(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/admin/banner-manage/edit/index?id=${id}`
    })
  },

  async deleteBanner(e) {
    const banner = e.currentTarget.dataset.banner
    
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这张轮播图吗？',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' })
          try {
            await db.collection('banner').doc(banner._id).update({
              data: {
                isDeleted: true,
                updatedAt: db.serverDate()
              }
            })
            wx.showToast({ title: '删除成功', icon: 'success' })
            this.loadBannerList()
            
            const app = getApp()
            app.globalData.bannerNeedRefresh = true
          } catch (err) {
            console.error('删除失败:', err)
            wx.showToast({ title: '删除失败', icon: 'none' })
          } finally {
            wx.hideLoading()
          }
        }
      }
    })
  },

  previewImage(e) {
    const banner = e.currentTarget.dataset.banner
    wx.previewImage({
      urls: [banner.image]
    })
  }
})