// pages/profile-edit/index.js
const db = wx.cloud.database();

Page({
  data: {
    userInfo: {},
    openid: ''
  },

  onLoad(options) {
    const that = this;
    const openid = wx.getStorageSync('openid');
    // 使用统一缓存键
    const userInfo = openid ? wx.getStorageSync(`user_${openid}`) || {} : {};
    
    this.setData({
      openid,
      userInfo
    });

    // 如果没有openid，尝试获取
    if (!openid) {
      wx.cloud.callFunction({
        name: 'login',
        success: (res) => {
          const newOpenid = res.result.openid;
          that.setData({ openid: newOpenid });
          wx.setStorageSync('openid', newOpenid);
        }
      });
    }
  },

  // 返回上一页
  goBack() {
    wx.navigateBack();
  },

  // 头像选择回调
  onChooseAvatar(e) {
    console.log('选择头像:', e);
    const avatarImage = e.detail.avatarUrl;
    this.setData({
      userInfo: {
        ...this.data.userInfo,
        avatarImage: avatarImage
      }
    });
  },

  // 昵称输入
  onNicknameInput(e) {
    console.log('昵称输入:', e);
    const nickName = e.detail.value;
    this.setData({
      userInfo: {
        ...this.data.userInfo,
        nickName: nickName
      }
    });
  },

  // 保存用户信息
  saveUserInfo() {
    const { userInfo, openid } = this.data;
    const { nickName, avatarImage } = userInfo;

    if (!nickName || nickName.trim() === '') {
      wx.showToast({
        title: '请输入昵称',
        icon: 'none'
      });
      return;
    }

    wx.showLoading({ title: '保存中...' });

    const saveUserInfo = (finalAvatarImage) => {
      // 更新本地存储（使用统一缓存键和字段名）
      const finalUserInfo = {
        nickName,
        avatarImage: finalAvatarImage
      };
      wx.setStorageSync(`user_${openid}`, finalUserInfo);

      // 更新数据库
      db.collection('users').where({ _openid: openid }).get({
        success: (res) => {
          if (res.data && res.data.length > 0) {
            db.collection('users').doc(res.data[0]._id).update({
              data: {
                nickName,
                avatarImage: finalAvatarImage,
                updatedAt: new Date()
              },
              success: () => {
                wx.hideLoading();
                wx.showToast({
                  title: '保存成功',
                  icon: 'success'
                });
                setTimeout(() => {
                  wx.navigateBack();
                }, 1000);
              },
              fail: (err) => {
                wx.hideLoading();
                console.error('更新用户信息失败:', err);
                wx.showToast({
                  title: '保存失败',
                  icon: 'none'
                });
              }
            });
          } else {
            db.collection('users').add({
              data: {
                _openid: openid,
                nickName,
                avatarImage: finalAvatarImage,
                createdAt: new Date(),
                updatedAt: new Date()
              },
              success: () => {
                wx.hideLoading();
                wx.showToast({
                  title: '保存成功',
                  icon: 'success'
                });
                setTimeout(() => {
                  wx.navigateBack();
                }, 1000);
              },
              fail: (err) => {
                wx.hideLoading();
                console.error('创建用户信息失败:', err);
                wx.showToast({
                  title: '保存失败',
                  icon: 'none'
                });
              }
            });
          }
        },
        fail: (err) => {
          wx.hideLoading();
          console.error('查询用户信息失败:', err);
          wx.showToast({
            title: '保存失败',
            icon: 'none'
          });
        }
      });
    };

    // 如果有新头像且不是云存储路径，先上传
    if (avatarImage && !avatarImage.startsWith('cloud://')) {
      wx.cloud.uploadFile({
        cloudPath: `avatars/${openid}_${Date.now()}.jpg`,
        filePath: avatarImage,
        success: (res) => {
          saveUserInfo(res.fileID);
        },
        fail: (err) => {
          wx.hideLoading();
          console.error('上传头像失败:', err);
          wx.showToast({
            title: '头像上传失败',
            icon: 'none'
          });
        }
      });
    } else {
      saveUserInfo(avatarImage);
    }
  }
});