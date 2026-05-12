// pages/admin/cloth-manage/index.js
const { getCollection } = require("../../../utils/cloud");
const { parseDbDate } = require("../../../utils/time-utils");

const db = wx.cloud.database();

Page({
  data: {
    cloths: [],
    loading: false
  },

  onLoad: function (options) {
    this.fetchCloths();
  },

  onShow: function () {
    this.fetchCloths();
  },

  // 获取布料列表
  fetchCloths() {
    this.setData({ loading: true });
    const cloths = getCollection("material");
    cloths.orderBy('createTime', 'desc').get()
      .then((res) => {
        // 格式化时间
        const formattedCloths = res.data.map(cloth => ({
          ...cloth,
          createTime: parseDbDate(cloth.createTime)
        }));
        this.setData({
          cloths: formattedCloths,
          loading: false
        });
      })
      .catch((err) => {
        console.error("获取布料列表失败", err);
        this.setData({ loading: false });
        wx.showToast({
          title: '获取布料列表失败',
          icon: 'none'
        });
      });
  },

  // 添加布料
  addCloth() {
    wx.navigateTo({
      url: '/pages/admin/cloth-manage/edit/index'
    });
  },

  // 查看布料详情
  viewClothDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/admin/cloth-manage/edit/index?id=${id}`
    });
  },

  // 编辑布料
  editCloth(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/admin/cloth-manage/edit/index?id=${id}`
    });
  },

  // 删除布料
  deleteCloth(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除布料',
      content: '确定要删除这个布料吗？',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({
            title: '删除中...',
          });
          const cloths = getCollection("material");
          cloths.doc(id).remove()
            .then(() => {
              wx.hideLoading();
              wx.showToast({
                title: '删除成功',
                icon: 'success'
              });
              this.fetchCloths();
            })
            .catch((err) => {
              wx.hideLoading();
              console.error("删除布料失败", err);
              wx.showToast({
                title: '删除布料失败',
                icon: 'none'
              });
            });
        }
      }
    });
  }
});