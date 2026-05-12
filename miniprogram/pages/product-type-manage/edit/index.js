// pages/admin/product-type-manage/edit/index.js
const { getCollection } = require("../../../../utils/cloud");

const db = wx.cloud.database();

Page({
  data: {
    productType: {
      name: '',
      level: 1,
      sort: 0,
      image: '',
      parentId: null
    },
    isEditing: false,
    level1Types: [],
    parentIdIndex: 0,
    levelOptions: ['一级', '二级'],
    levelIndex: 0,
    showParentSelector: false,
    selectedParentName: ''
  },

  onLoad: function (options) {
    const id = options.id;
    if (id) {
      this.setData({ isEditing: true });
      this.fetchProductTypeDetail(id);
    } else {
      // 页面加载时就获取一级类型列表
      this.fetchLevel1Types();
    }
  },

  // 获取商品类型详情
  fetchProductTypeDetail(id) {
    wx.showLoading({
      title: '加载中...',
    });
    const productTypes = getCollection("product_types");
    productTypes.doc(id).get()
      .then((res) => {
        wx.hideLoading();
        if (res.data) {
          const levelIndex = res.data.level - 1;
          const showParentSelector = res.data.level === 2;
          this.setData({ 
            productType: res.data,
            levelIndex: levelIndex,
            showParentSelector: showParentSelector
          });
          this.fetchLevel1Types();
        } else {
          wx.showToast({
            title: '商品类型不存在',
            icon: 'none'
          });
          setTimeout(() => {
            wx.navigateBack();
          }, 1000);
        }
      })
      .catch((err) => {
        wx.hideLoading();
        console.error("获取商品类型详情失败", err);
        wx.showToast({
          title: '获取商品类型详情失败',
          icon: 'none'
        });
        setTimeout(() => {
          wx.navigateBack();
        }, 1000);
      });
  },

  // 获取一级类型
  fetchLevel1Types() {
    console.log('fetchLevel1Types called');
    const productTypes = getCollection("product_types");
    productTypes.where({ level: 1 }).get()
      .then((res) => {
        console.log('Fetched level1 types:', res.data);
        const level1Types = res.data;
        
        // 计算父级类型索引
        let parentIdIndex = 0;
        if (this.data.productType.level === 2 && this.data.productType.parentId) {
          const index = level1Types.findIndex(type => type._id === this.data.productType.parentId);
          parentIdIndex = index >= 0 ? index : 0;
        }
        
        // 如果有数据，设置默认父级类型
        if (level1Types.length > 0 && this.data.productType.level === 2) {
          this.setData({ 
            level1Types: level1Types,
            parentIdIndex: parentIdIndex,
            'productType.parentId': level1Types[parentIdIndex]._id,
            showParentSelector: true,
            selectedParentName: level1Types[parentIdIndex].name
          });
          console.log('Set default parent:', level1Types[parentIdIndex].name);
        } else {
          this.setData({ level1Types: level1Types });
        }
      })
      .catch((err) => {
        console.error("获取一级类型失败", err);
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
      cloudPath: `product_types/${Date.now()}.png`,
      filePath: filePath,
      success: (res) => {
        wx.hideLoading();
        this.setData({
          'productType.image': res.fileID
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
      'productType.image': ''
    });
  },

  // 类型名称变化
  onNameChange(e) {
    this.setData({
      'productType.name': e.detail.value
    });
  },

  // 类型级别变化
  onLevelChange(e) {
    console.log('onLevelChange called');
    const levelIndex = parseInt(e.detail.value);
    const level = levelIndex + 1;
    const showParentSelector = level === 2;
    console.log('Level:', level, 'showParentSelector:', showParentSelector);
    
    // 更新数据
    this.setData({
      levelIndex: levelIndex,
      'productType.level': level,
      'productType.parentId': level === 1 ? null : this.data.productType.parentId,
      parentIdIndex: 0,
      showParentSelector: showParentSelector
    }, () => {
      console.log('After setData, showParentSelector:', this.data.showParentSelector);
    });
    
    // 如果切换到二级，获取一级类型列表
    if (showParentSelector) {
      console.log('Fetching level1 types...');
      this.fetchLevel1Types();
    }
  },

  // 父级类型变化
  onParentIdChange(e) {
    const index = parseInt(e.detail.value);
    const parentId = this.data.level1Types[index]?._id || null;
    const selectedParentName = this.data.level1Types[index]?.name || '';
    console.log('Parent selected, index:', index, 'parentId:', parentId, 'name:', selectedParentName);
    this.setData({
      parentIdIndex: index,
      'productType.parentId': parentId,
      selectedParentName: selectedParentName
    }, () => {
      console.log('After parent selection, parentIdIndex:', this.data.parentIdIndex, 'selectedParentName:', this.data.selectedParentName);
    });
  },



  // 获取选中的父级类型名称
  getSelectedParentName() {
    if (this.data.parentIdIndex >= 0 && this.data.level1Types[this.data.parentIdIndex]) {
      return this.data.level1Types[this.data.parentIdIndex].name;
    }
    return '请选择父级类型';
  },

  // 保存商品类型
  saveProductType() {
    const { name, level, parentId } = this.data.productType;
    
    // 验证表单
    if (!name) {
      wx.showToast({
        title: '请输入类型名称',
        icon: 'none'
      });
      return;
    }
    
    if (level === 2 && !parentId) {
      wx.showToast({
        title: '请选择父级类型',
        icon: 'none'
      });
      return;
    }
    
    wx.showLoading({
      title: '保存中...',
    });
    
    if (this.data.isEditing) {
      // 编辑商品类型
      const { name, level, parentId, image, sort } = this.data.productType;
      const updateData = {
        name,
        level,
        parentId,
        image,
        sort,
        updatedAt: new Date()
      };
      
      wx.cloud.callFunction({
        name: 'updateProductType',
        data: {
          productTypeId: this.data.productType._id,
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
            title: '编辑商品类型失败',
            icon: 'none'
          });
        }
      }).catch((err) => {
        wx.hideLoading();
        console.error("编辑商品类型失败", err);
        wx.showToast({
          title: '编辑商品类型失败',
          icon: 'none'
        });
      });
    } else {
      // 获取当前最大排序值
      const productTypes = getCollection("product_types");
      productTypes.orderBy('sort', 'desc').limit(1).get()
        .then((res) => {
          let maxSort = 0;
          if (res.data && res.data.length > 0) {
            maxSort = res.data[0].sort || 0;
          }
          
          // 新排序值为最大排序值加10
          const newSort = maxSort + 10;
          
          // 添加商品类型
          productTypes.add({
            data: {
              ...this.data.productType,
              sort: newSort,
              createdAt: new Date(),
              updatedAt: new Date()
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
            console.error("添加商品类型失败", err);
            wx.showToast({
              title: '添加商品类型失败',
              icon: 'none'
            });
          });
        })
        .catch((err) => {
          wx.hideLoading();
          console.error("获取排序失败", err);
          wx.showToast({
            title: '保存失败',
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