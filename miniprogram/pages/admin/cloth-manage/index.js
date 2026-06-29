// pages/admin/cloth-manage/index.js
const { getCollection } = require("../../../utils/cloud");
const { parseDbDate } = require("../../../utils/time-utils");

const db = wx.cloud.database();
const PAGE_SIZE = 20;

Page({
  data: {
    cloths: [],
    loading: false,
    loadingMore: false,
    hasMore: true,
    page: 1
  },

  onLoad: function (options) {
    this.loadCloths(true);
  },

  onShow: function () {
    this.loadCloths(true);
  },

  // 获取布料列表（skip 分页）
  loadCloths(reset = false) {
    if (this.data.loading || this.data.loadingMore) return;

    const { page, hasMore } = this.data;
    if (!reset && !hasMore) return;

    this.setData({ loading: reset, loadingMore: !reset });

    const offset = reset ? 0 : (page - 1) * PAGE_SIZE;

    getCollection("material")
      .orderBy('createTime', 'desc')
      .skip(offset)
      .limit(PAGE_SIZE)
      .get()
      .then((res) => {
        const formatted = (res.data || []).map(item => ({
          ...item,
          createTime: parseDbDate(item.createTime)
        }));
        const hasMoreData = res.data.length === PAGE_SIZE;
        this.setData({
          cloths: reset ? formatted : [...this.data.cloths, ...formatted],
          loading: false,
          loadingMore: false,
          hasMore: hasMoreData,
          page: reset ? 2 : page + 1
        });
      })
      .catch((err) => {
        console.error("获取布料列表失败", err);
        this.setData({ loading: false, loadingMore: false });
        wx.showToast({ title: '获取布料列表失败', icon: 'none' });
      });
  },

  onReachBottom() {
    this.loadCloths(false);
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
              this.loadCloths(true);
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