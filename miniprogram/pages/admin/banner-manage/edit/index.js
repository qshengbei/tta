// pages/admin/banner-manage/edit/index.js
const db = wx.cloud.database()

Page({

  data: {
    bannerId: '',
    formData: {
      image: '',
      link: '',
      sortOrder: 0,
      isActive: true
    },
    isEdit: false
  },

  onLoad(options) {
    if (options && options.id) {
      this.setData({
        bannerId: options.id,
        isEdit: true
      })
      wx.setNavigationBarTitle({
        title: '编辑轮播图'
      })
      this.loadBannerData(options.id)
    } else {
      wx.setNavigationBarTitle({
        title: '添加轮播图'
      })
    }
  },

  async loadBannerData(id) {
    try {
      const res = await db.collection('banner').doc(id).get()
      const banner = res.data
      this.setData({
        formData: {
          image: banner.image || '',
          link: banner.link || '',
          sortOrder: banner.sortOrder || 0,
          isActive: banner.isActive !== undefined ? banner.isActive : true
        }
      })
    } catch (err) {
      console.error('加载 banner 数据失败:', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  async chooseImage() {
    try {
      const res = await wx.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera']
      })
      
      if (res.tempFilePaths && res.tempFilePaths.length > 0) {
        const tempFilePath = res.tempFilePaths[0]
        this.uploadImage(tempFilePath)
      }
    } catch (err) {
      console.error('选择图片失败:', err)
    }
  },

  async uploadImage(filePath) {
    wx.showLoading({ title: '上传中...' })
    try {
      const fileName = `banner/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: fileName,
        filePath: filePath
      })
      
      this.setData({
        'formData.image': uploadRes.fileID
      })
      wx.hideLoading()
    } catch (err) {
      console.error('上传图片失败:', err)
      wx.hideLoading()
      wx.showToast({ title: '上传失败', icon: 'none' })
    }
  },

  onInputChange(e) {
    const { field } = e.currentTarget.dataset
    this.setData({
      [`formData.${field}`]: e.detail.value
    })
  },

  onSwitchChange(e) {
    const { field } = e.currentTarget.dataset
    this.setData({
      [`formData.${field}`]: e.detail.value
    })
  },

  async submitForm() {
    const { formData, isEdit, bannerId } = this.data
    
    console.log('submitForm - formData:', formData)
    console.log('submitForm - sortOrder:', formData.sortOrder, 'type:', typeof formData.sortOrder)
    
    if (!formData.image) {
      wx.showToast({ title: '请上传图片', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中...' })
    
    try {
      const sortOrder = parseInt(formData.sortOrder)
      console.log('submitForm - sortOrder after parseInt:', sortOrder)
      
      if (isEdit) {
        console.log('submitForm - updating banner:', bannerId)
        // 使用 update 操作更新文档
        const updateResult = await db.collection('banner').doc(bannerId).update({
          data: {
            image: formData.image,
            link: formData.link,
            sortOrder: sortOrder,
            isActive: formData.isActive,
            updatedAt: db.serverDate()
          }
        })
        console.log('submitForm - update result:', updateResult)
        
        // 检查是否真正更新了文档
        if (updateResult.stats && updateResult.stats.updated === 0) {
          // update 失败，尝试使用云函数更新
          console.log('submitForm - update failed, trying cloud function')
          await this.updateBannerWithCloudFunction(bannerId, formData, sortOrder)
        }
        
        wx.showToast({ title: '修改成功', icon: 'success' })
      } else {
        console.log('submitForm - adding new banner')
        const addResult = await db.collection('banner').add({
          data: {
            image: formData.image,
            link: formData.link,
            sortOrder: sortOrder,
            isActive: formData.isActive,
            isBanner: true,
            isDeleted: false,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        })
        console.log('submitForm - add result:', addResult)
        wx.showToast({ title: '添加成功', icon: 'success' })
      }
      
      const app = getApp()
      app.globalData.bannerNeedRefresh = true
      
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)
    } catch (err) {
      console.error('保存失败:', err)
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async updateBannerWithCloudFunction(bannerId, formData, sortOrder) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'updateBanner',
        data: {
          bannerId: bannerId,
          image: formData.image,
          link: formData.link,
          sortOrder: sortOrder,
          isActive: formData.isActive
        }
      })
      console.log('Cloud function update result:', res)
    } catch (err) {
      console.error('Cloud function update failed:', err)
      throw err
    }
  },

  previewImage() {
    if (this.data.formData.image) {
      wx.previewImage({
        urls: [this.data.formData.image]
      })
    }
  },

  goBack() {
    wx.navigateBack()
  },

  stopPropagation() {
    // 阻止事件冒泡
  }
})