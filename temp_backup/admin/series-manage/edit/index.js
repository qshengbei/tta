// pages/admin/series-manage/edit/index.js
const { getCollection } = require("../../../../utils/cloud");

const db = wx.cloud.database();

Page({
  data: {
    series: {
      name: '',
      subtitle: '',
      image: '',
      status: 'on'
    },
    isEditing: false,
    statusOptions: [
      { label: '上架', value: 'on' },
      { label: '下架', value: 'off' }
    ],
    statusIndex: 0
  },

  onLoad: function (options) {
    const id = options.id;
    if (id) {
      this.setData({ isEditing: true });
      this.fetchSeriesDetail(id);
    }
  },

  // 获取系列详情
  fetchSeriesDetail(id) {
    wx.showLoading({
      title: '加载中...',
    });
    const series = getCollection("category");
    series.doc(id).get()
      .then((res) => {
        wx.hideLoading();
        if (res.data) {
          // 设置statusIndex
          const statusIndex = res.data.status === 'off' ? 1 : 0;
          this.setData({ 
            series: res.data,
            statusIndex: statusIndex
          });
        } else {
          wx.showToast({
            title: '系列不存在',
            icon: 'none'
          });
          setTimeout(() => {
            wx.navigateBack();
          }, 1000);
        }
      })
      .catch((err) => {
        wx.hideLoading();
        console.error("获取系列详情失败", err);
        wx.showToast({
          title: '获取系列详情失败',
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
      cloudPath: `series/${Date.now()}.png`,
      filePath: filePath,
      success: (res) => {
        wx.hideLoading();
        this.setData({
          'series.image': res.fileID
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
      'series.image': ''
    });
  },

  // 系列名称变化
  onNameChange(e) {
    this.setData({
      'series.name': e.detail.value
    });
  },

  // 系列副名称变化
  onSubtitleChange(e) {
    this.setData({
      'series.subtitle': e.detail.value
    });
  },

  // 上架状态变化
  onStatusChange(e) {
    const index = parseInt(e.detail.value);
    const status = this.data.statusOptions[index].value;
    this.setData({
      statusIndex: index,
      'series.status': status
    });
  },

  // 保存系列
  saveSeries() {
    const { name, subtitle } = this.data.series;
    
    // 验证表单
    if (!name) {
      wx.showToast({
        title: '请输入系列名称',
        icon: 'none'
      });
      return;
    }
    
    if (!subtitle) {
      wx.showToast({
        title: '请输入系列副名称',
        icon: 'none'
      });
      return;
    }
    
    wx.showLoading({
      title: '保存中...',
    });
    
    if (this.data.isEditing) {
      // 编辑系列
      const { name, subtitle, image, status } = this.data.series;
      const updateData = {
        name,
        subtitle,
        image,
        status,
        createTime: new Date()
      };
      
      wx.cloud.callFunction({
        name: 'updateCategory',
        data: {
          categoryId: this.data.series._id,
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
            title: '编辑系列失败',
            icon: 'none'
          });
        }
      }).catch((err) => {
        wx.hideLoading();
        console.error("编辑系列失败", err);
        wx.showToast({
          title: '编辑系列失败',
          icon: 'none'
        });
      });
    } else {
      // 添加系列
      const series = getCollection("category");
      const { name, subtitle, image, status } = this.data.series;
      series.add({
        data: {
          name,
          subtitle,
          image,
          status: status || 'on',
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
        console.error("添加系列失败", err);
        wx.showToast({
          title: '添加系列失败',
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