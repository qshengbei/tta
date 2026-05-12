Page({
  data: {
    message: null,
    loading: true
  },

  onLoad(options) {
    const { id } = options;
    this.loadMessageDetail(id);
  },

  // 加载消息详情
  async loadMessageDetail(id) {
    this.setData({ loading: true });
    try {
      const db = wx.cloud.database();
      const res = await db.collection('notifications').doc(id).get();
      
      if (res.data) {
        // 检查通知是否已被删除
        if (res.data.isDelete === true) {
          wx.showToast({ title: '通知已被删除', icon: 'none' });
          wx.navigateBack();
          return;
        }
        
        // 为消息添加格式化后的时间
        const message = res.data;
        // 尝试使用createdAt字段，如果没有则使用createTime字段
        const timeField = message.createdAt || message.createTime;
        if (timeField) {
          let date;
          if (typeof timeField === 'string') {
            // 直接使用字符串创建日期对象
            date = new Date(timeField);
          } else if (timeField instanceof Date) {
            date = timeField;
          } else {
            date = new Date(timeField);
          }
          
          // 检查日期是否有效
          if (!isNaN(date.getTime())) {
            // 使用通用时间格式化函数
            message.formattedTime = this.formatTimeByRule(date);
          } else {
            message.formattedTime = '';
          }
        } else {
          message.formattedTime = '';
        }
        
        this.setData({ message });
        // 标记消息为已读
        this.markAsRead(id);
      } else {
        wx.showToast({ title: '消息不存在', icon: 'none' });
        wx.navigateBack();
      }
    } catch (error) {
      console.error('加载消息详情失败', error);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 通用时间格式化函数
  formatTimeByRule(date) {
    if (!date) return '';
    
    try {
      let dateObj;
      if (typeof date === 'string') {
        dateObj = new Date(date);
      } else if (date instanceof Date) {
        dateObj = date;
      } else {
        dateObj = new Date(date);
      }
      
      // 检查日期是否有效
      if (isNaN(dateObj.getTime())) {
        console.error('日期无效:', date);
        return '';
      }
      
      const now = new Date();
      
      // 重置时间部分为0，只比较日期
      const dateOnly = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
      const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      const diffTime = nowOnly - dateOnly;
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      
      // 补零函数
      function padZero(num) {
        return num < 10 ? '0' + num : num.toString();
      }
      
      const year = dateObj.getFullYear();
      const month = padZero(dateObj.getMonth() + 1);
      const day = padZero(dateObj.getDate());
      const hours = padZero(dateObj.getHours());
      const minutes = padZero(dateObj.getMinutes());
      const currentYear = now.getFullYear();
      
      if (diffDays === 0) {
        // 当天，显示时分
        return `${hours}:${minutes}`;
      } else if (diffDays === 1) {
        // 昨天，显示昨天 时分
        return `昨天 ${hours}:${minutes}`;
      } else if (diffDays === 2) {
        // 前天，显示前天 时分
        return `前天 ${hours}:${minutes}`;
      } else {
        // 更久的时间
        if (year === currentYear) {
          // 当年，显示月-日 时分
          return `${month}-${day} ${hours}:${minutes}`;
        } else {
          // 往年，显示年月日 时分
          return `${year}-${month}-${day} ${hours}:${minutes}`;
        }
      }
    } catch (error) {
      console.error('时间格式化失败:', error);
      return '';
    }
  },

  // 标记消息为已读
  async markAsRead(id) {
    try {
      const db = wx.cloud.database();
      await db.collection('notifications').doc(id).update({
        data: { status: 'read' }
      });
      // 更新本地数据
      this.setData({
        message: {
          ...this.data.message,
          status: 'read'
        }
      });
    } catch (error) {
      console.error('标记消息已读失败', error);
    }
  },

  // 返回上一页
  onBack() {
    wx.navigateBack();
  },

  // 处理消息相关操作
  handleRelatedAction() {
    const { message } = this.data;
    if (message.relatedType === 'order') {
      // 跳转到订单详情页
      wx.navigateTo({
        url: `/pages/order/detail/index?id=${message.relatedId}`
      });
    } else if (message.relatedType === 'product') {
      // 跳转到商品详情页
      wx.navigateTo({
        url: `/pages/product-detail/index?id=${message.relatedId}`
      });
    } else if (message.relatedType === 'activity') {
      // 跳转到活动详情页
      wx.navigateTo({
        url: `/pages/activity/detail/index?id=${message.relatedId}`
      });
    }
  }
});