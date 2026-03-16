Page({
  data: {
    qrcodeUrl: ''
  },

  onLoad(options) {
    const { wechatPicture } = options;
    if (wechatPicture) {
      // 转换fileid为临时链接
      this.getQrcodeUrl(wechatPicture);
    }
  },

  // 获取二维码临时链接
  getQrcodeUrl(fileid) {
    wx.cloud.getTempFileURL({
      fileList: [fileid],
      success: (res) => {
        if (res.fileList && res.fileList.length > 0) {
          this.setData({
            qrcodeUrl: res.fileList[0].tempFileURL
          });
        }
      },
      fail: (err) => {
        console.error('获取二维码链接失败', err);
        wx.showToast({
          title: '获取二维码失败',
          icon: 'none'
        });
      }
    });
  },

  // 长按扫码
  scanQRCode() {
    const { qrcodeUrl } = this.data;
    if (qrcodeUrl) {
      wx.scanCode({
        success: (res) => {
          console.log('扫码成功', res);
          // 可以根据扫码结果做相应处理
        },
        fail: (err) => {
          console.error('扫码失败', err);
          wx.showToast({
            title: '扫码失败',
            icon: 'none'
          });
        }
      });
    }
  },

  // 返回上一页
  goBack() {
    wx.navigateBack();
  }
});