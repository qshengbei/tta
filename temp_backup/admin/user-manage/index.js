// pages/admin/user-manage/index.js
const db = wx.cloud.database();
Page({

  /**
   * 页面的初始数据
   */
  data: {
    users: [], // 用户列表
    loading: false, // 加载状态
    page: 1, // 当前页码
    hasMore: true // 是否有更多数据
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.loadUsers();
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    this.setData({ page: 1, hasMore: true, users: [] });
    this.loadUsers();
  },

  /**
   * 加载用户数据
   */
  async loadUsers() {
    if (this.data.loading || !this.data.hasMore) return;
    
    this.setData({ loading: true });
    
    try {
      // 分页查询
      const limit = 20;
      const offset = (this.data.page - 1) * limit;
      
      const res = await db.collection('users')
        .orderBy('createdAt', 'desc')
        .skip(offset)
        .limit(limit)
        .get();
      
      const users = res.data.map(user => {
        // 格式化日期
        const createdAt = new Date(user.createdAt);
        const formattedDate = `${createdAt.getFullYear()}-${(createdAt.getMonth() + 1).toString().padStart(2, '0')}-${createdAt.getDate().toString().padStart(2, '0')} ${createdAt.getHours().toString().padStart(2, '0')}:${createdAt.getMinutes().toString().padStart(2, '0')}`;
        
        return {
          ...user,
          createdAt: formattedDate
        };
      });
      
      // 合并数据
      const newUsers = this.data.page === 1 ? users : [...this.data.users, ...users];
      
      this.setData({
        users: newUsers,
        hasMore: users.length === limit,
        page: this.data.page + 1,
        loading: false
      });
    } catch (err) {
      console.error('加载用户失败:', err);
      wx.showToast({
        title: '加载用户失败',
        icon: 'none'
      });
      this.setData({ loading: false });
    }
  },

  /**
   * 下拉刷新
   */
  onPullDownRefresh() {
    this.setData({ page: 1, hasMore: true, users: [] });
    this.loadUsers();
    wx.stopPullDownRefresh();
  },

  /**
   * 上拉加载
   */
  onReachBottom() {
    this.loadUsers();
  },

  /**
   * 查看用户详情
   */
  viewUserDetail(e) {
    const userId = e.currentTarget.dataset.id;
    const user = this.data.users.find(item => item._id === userId);
    
    wx.showModal({
      title: '用户详情',
      content: `昵称: ${user.nickName || '未知'}\n创建时间: ${user.createdAt}`,
      showCancel: false
    });
  }
})
