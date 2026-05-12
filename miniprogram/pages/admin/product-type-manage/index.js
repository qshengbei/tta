// pages/admin/product-type-manage/index.js
const { getCollection } = require("../../../utils/cloud");
const { parseDbDate } = require("../../../utils/time-utils");

const db = wx.cloud.database();

Page({
  data: {
    productTypes: [],
    level1Types: [],
    loading: false
  },

  onLoad: function (options) {
    this.fetchProductTypes();
  },

  onShow: function () {
    this.fetchProductTypes();
  },

  // 获取商品类型列表
  fetchProductTypes() {
    this.setData({ loading: true });
    const productTypes = getCollection("product_types");
    productTypes.orderBy('sort', 'asc').get()
      .then((res) => {
        console.log('Fetched product types:', res.data);
        // 格式化时间
        const formattedTypes = res.data.map(type => ({
          ...type,
          createdAt: parseDbDate(type.createdAt)
        }));
        
        // 分离一级和二级类型
        const level1Types = formattedTypes.filter(type => type.level === 1);
        const level2Types = formattedTypes.filter(type => type.level === 2);
        console.log('Level1 types:', level1Types);
        console.log('Level2 types:', level2Types);
        console.log('All types:', formattedTypes);
        
        // 为一级类型添加二级类型和展开状态
        const level1WithChildren = level1Types.map(level1 => ({
          ...level1,
          children: level2Types.filter(level2 => level2.parentId === level1._id),
          expanded: false
        }));
        console.log('Level1 with children:', level1WithChildren);
        
        this.setData({
          productTypes: formattedTypes,
          level1Types: level1WithChildren,
          loading: false
        });
      })
      .catch((err) => {
        console.error("获取商品类型列表失败", err);
        this.setData({ loading: false });
        wx.showToast({
          title: '获取商品类型列表失败',
          icon: 'none'
        });
      });
  },

  // 获取二级类型
  getLevel2Types(parentId) {
    console.log('getLevel2Types called with parentId:', parentId);
    const level2Types = this.data.productTypes.filter(type => type.level === 2 && type.parentId === parentId);
    console.log('Level2 types found:', level2Types);
    return level2Types;
  },

  // 添加商品类型
  addProductType() {
    wx.navigateTo({
      url: '/pages/admin/product-type-manage/edit/index'
    });
  },

  // 查看商品类型详情
  viewProductTypeDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/admin/product-type-manage/edit/index?id=${id}`
    });
  },

  // 编辑商品类型
  editProductType(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/admin/product-type-manage/edit/index?id=${id}`
    });
  },

  // 切换展开/收起状态
  toggleExpand(e) {
    const id = e.currentTarget.dataset.id;
    const level1Types = [...this.data.level1Types];
    const index = level1Types.findIndex(type => type._id === id);
    if (index !== -1) {
      level1Types[index].expanded = !level1Types[index].expanded;
      this.setData({
        level1Types: level1Types
      });
    }
  },

  // 删除商品类型
  deleteProductType(e) {
    const id = e.currentTarget.dataset.id;
    
    // 检查是否有二级类型
    const hasLevel2Types = this.data.productTypes.some(type => type.level === 2 && type.parentId === id);
    if (hasLevel2Types) {
      wx.showToast({
        title: '该类型下有二级类型，无法删除',
        icon: 'none'
      });
      return;
    }
    
    wx.showModal({
      title: '删除商品类型',
      content: '确定要删除这个商品类型吗？',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({
            title: '删除中...',
          });
          const productTypes = getCollection("product_types");
          productTypes.doc(id).remove()
            .then(() => {
              wx.hideLoading();
              wx.showToast({
                title: '删除成功',
                icon: 'success'
              });
              this.fetchProductTypes();
            })
            .catch((err) => {
              wx.hideLoading();
              console.error("删除商品类型失败", err);
              wx.showToast({
                title: '删除商品类型失败',
                icon: 'none'
              });
            });
        }
      }
    });
  }
});