// pages/admin/cloth-manage/edit/index.js
const { getCollection } = require("../../../../utils/cloud");

const db = wx.cloud.database();

Page({
  data: {
    cloth: {
      name: '',
      price: '',
      size: '',
      style: '',
      type: '',
      color: '',
      image: ''
    },
    isEditing: false
  },

  onLoad: function (options) {
    const id = options.id;
    if (id) {
      this.setData({ isEditing: true });
      this.fetchClothDetail(id);
    }
  },

  // 获取布料详情
  fetchClothDetail(id) {
    wx.showLoading({
      title: '加载中...',
    });
    const cloths = getCollection("material");
    cloths.doc(id).get()
      .then((res) => {
        wx.hideLoading();
        if (res.data) {
          this.setData({ cloth: res.data });
        } else {
          wx.showToast({
            title: '布料不存在',
            icon: 'none'
          });
          setTimeout(() => {
            wx.navigateBack();
          }, 1000);
        }
      })
      .catch((err) => {
        wx.hideLoading();
        console.error("获取布料详情失败", err);
        wx.showToast({
          title: '获取布料详情失败',
          icon: 'none'
        });
        setTimeout(() => {
          wx.navigateBack();
        }, 1000);
      });
  },

  // 选择图片
  chooseImage() {
    wx.chooseImage({
      count: 1,
      sizeType: ['original', 'compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePaths = res.tempFilePaths;
        this.uploadImage(tempFilePaths[0]);
      }
    });
  },

  // 上传图片
  uploadImage(filePath) {
    wx.showLoading({
      title: '上传中...',
    });
    wx.cloud.uploadFile({
      cloudPath: `cloths/${Date.now()}.png`,
      filePath: filePath,
      success: (res) => {
        wx.hideLoading();
        this.setData({
          'cloth.image': res.fileID
        });
      },
      fail: (err) => {
        wx.hideLoading();
        console.error("上传图片失败", err);
        wx.showToast({
          title: '上传图片失败',
          icon: 'none'
        });
      }
    });
  },

  // 删除图片
  removeImage() {
    this.setData({
      'cloth.image': ''
    });
  },

  // 布料名称变化
  onNameChange(e) {
    this.setData({
      'cloth.name': e.detail.value
    });
  },

  // 布料价格变化
  onPriceChange(e) {
    this.setData({
      'cloth.price': e.detail.value
    });
  },

  // 布料尺寸变化
  onSizeChange(e) {
    this.setData({
      'cloth.size': e.detail.value
    });
  },

  // 布料风格变化
  onStyleChange(e) {
    this.setData({
      'cloth.style': e.detail.value
    });
  },

  // 布料类型变化
  onTypeChange(e) {
    this.setData({
      'cloth.type': e.detail.value
    });
  },

  // 布料颜色变化
  onColorChange(e) {
    this.setData({
      'cloth.color': e.detail.value
    });
  },

  // 保存布料
  saveCloth() {
    const { name, price, size, style, type, color } = this.data.cloth;
    
    // 验证表单
    if (!name) {
      wx.showToast({
        title: '请输入布料名称',
        icon: 'none'
      });
      return;
    }
    
    if (!price) {
      wx.showToast({
        title: '请输入布料价格',
        icon: 'none'
      });
      return;
    }
    
    if (price < 0) {
      wx.showToast({
        title: '价格不能为负数',
        icon: 'none'
      });
      return;
    }
    
    if (!size) {
      wx.showToast({
        title: '请输入布料尺寸',
        icon: 'none'
      });
      return;
    }
    
    if (!style) {
      wx.showToast({
        title: '请输入布料风格',
        icon: 'none'
      });
      return;
    }
    
    if (!type) {
      wx.showToast({
        title: '请输入布料类型',
        icon: 'none'
      });
      return;
    }
    
    if (!color) {
      wx.showToast({
        title: '请输入布料颜色',
        icon: 'none'
      });
      return;
    }
    
    wx.showLoading({
      title: '保存中...',
    });
    
    if (this.data.isEditing) {
      // 编辑布料
      const { name, price, size, style, type, color, image } = this.data.cloth;
      const updateData = {
        name,
        price,
        size,
        style,
        type,
        color,
        image,
        createTime: new Date()
      };
      
      wx.cloud.callFunction({
        name: 'updateMaterial',
        data: {
          materialId: this.data.cloth._id,
          updateData: updateData
        }
      }).then((res) => {
        wx.hideLoading();
        if (res.result.success) {
          wx.showToast({
            title: '编辑成功',
            icon: 'success'
          });
          setTimeout(() => {
            wx.navigateBack();
          }, 1500);
        } else {
          wx.showToast({
            title: '编辑布料失败',
            icon: 'none'
          });
        }
      }).catch((err) => {
        wx.hideLoading();
        console.error("编辑布料失败", err);
        wx.showToast({
          title: '编辑布料失败',
          icon: 'none'
        });
      });
    } else {
      // 添加布料
      const cloths = getCollection("material");
      cloths.add({
        data: {
          ...this.data.cloth,
          createTime: new Date()
        }
      }).then(() => {
        wx.hideLoading();
        wx.showToast({
          title: '添加成功',
          icon: 'success'
        });
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      }).catch((err) => {
        wx.hideLoading();
        console.error("添加布料失败", err);
        wx.showToast({
          title: '添加布料失败',
          icon: 'none'
        });
      });
    }
  },

  // 返回
  goBack() {
    wx.navigateBack();
  }
});