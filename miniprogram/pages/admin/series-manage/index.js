// pages/admin/series-manage/index.js
const { getCollection } = require("../../../utils/cloud");
const { parseDbDate } = require("../../../utils/time-utils");

const db = wx.cloud.database();
const PAGE_SIZE = 20;

Page({
  data: {
    series: [],
    loading: false,
    loadingMore: false,
    hasMore: true,
    page: 1
  },

  onLoad: function (options) {
    this.loadSeries(true);
  },

  onShow: function () {
    this.loadSeries(true);
  },

  // 获取系列列表（skip 分页）
  loadSeries(reset = false) {
    if (this.data.loading || this.data.loadingMore) return;

    const { page, hasMore } = this.data;
    if (!reset && !hasMore) return;

    this.setData({ loading: reset, loadingMore: !reset });

    const offset = reset ? 0 : (page - 1) * PAGE_SIZE;

    getCollection("category")
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
          series: reset ? formatted : [...this.data.series, ...formatted],
          loading: false,
          loadingMore: false,
          hasMore: hasMoreData,
          page: reset ? 2 : page + 1
        });
      })
      .catch((err) => {
        console.error("获取系列列表失败", err);
        this.setData({ loading: false, loadingMore: false });
        wx.showToast({ title: '获取系列列表失败', icon: 'none' });
      });
  },

  onReachBottom() {
    this.loadSeries(false);
  },

  // 添加系列
  addSeries() {
    wx.navigateTo({
      url: '/pages/admin/series-manage/edit/index'
    });
  },

  // 查看系列详情
  viewSeriesDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/admin/series-manage/edit/index?id=${id}`
    });
  },

  // 编辑系列
  editSeries(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/admin/series-manage/edit/index?id=${id}`
    });
  },

  // 删除系列
  deleteSeries(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除系列',
      content: '确定要删除这个系列吗？',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({
            title: '删除中...',
          });
          const series = getCollection("category");
          series.doc(id).remove()
            .then(() => {
              wx.hideLoading();
              wx.showToast({
                title: '删除成功',
                icon: 'success'
              });
              this.loadSeries(true);
            })
            .catch((err) => {
              wx.hideLoading();
              console.error("删除系列失败", err);
              wx.showToast({
                title: '删除系列失败',
                icon: 'none'
              });
            });
        }
      }
    });
  },

  // 切换上架下架状态
  toggleStatus(e) {
    const id = e.currentTarget.dataset.id;
    const currentStatus = e.currentTarget.dataset.status;
    const newStatus = currentStatus === 'on' ? 'off' : 'on';
    const actionText = newStatus === 'on' ? '上架' : '下架';
    
    wx.showModal({
      title: `${actionText}系列`,
      content: `确定要${actionText}这个系列吗？`,
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({
            title: `${actionText}中...`,
          });
          
          wx.cloud.callFunction({
            name: 'updateCategory',
            data: {
              categoryId: id,
              updateData: {
                status: newStatus,
                createTime: new Date()
              }
            }
          }).then((res) => {
            wx.hideLoading();
            if (res.result.success) {
              wx.showToast({
                title: `${actionText}成功`,
                icon: 'success'
              });
              this.loadSeries(true);
            } else {
              wx.showToast({
                title: `${actionText}失败`,
                icon: 'none'
              });
            }
          }).catch((err) => {
            wx.hideLoading();
            console.error(`${actionText}系列失败`, err);
            wx.showToast({
              title: `${actionText}失败`,
              icon: 'none'
            });
          });
        }
      }
    });
  }
});