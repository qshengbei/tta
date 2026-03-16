// 客服功能工具模块
import { getCollection } from "./cloud";

/**
 * 显示客服二维码
 * @param {Function} success - 成功回调
 * @param {Function} fail - 失败回调
 */
export function showCustomerQrCode(success, fail) {
  console.log('开始获取客服二维码');
  const settings = getCollection("settings");
  settings
    .get()
    .then((res) => {
      console.log('获取settings集合结果:', res);
      if (res.data && res.data.length > 0) {
        const firstSetting = res.data[0];
        const wechatPicture = firstSetting.wechatPicture || firstSetting.WechatPicture || firstSetting.WECHATPICTURE;
        
        if (wechatPicture) {
          console.log('有wechatPicture，显示二维码');
          wx.cloud.getTempFileURL({
            fileList: [wechatPicture],
            success: (res) => {
              if (res.fileList && res.fileList.length > 0) {
                const qrcodeUrl = res.fileList[0].tempFileURL;
                console.log('二维码临时链接:', qrcodeUrl);
                
                // 使用wx.previewImage显示二维码
                wx.previewImage({
                  current: qrcodeUrl,
                  urls: [qrcodeUrl],
                  showmenu: true,
                  success: function(res) {
                    console.log('预览二维码成功');
                    if (success) success(res);
                  },
                  fail: function(res) {
                    console.error('预览二维码失败', res);
                    // 失败时显示文字联系方式
                    showContactInfo();
                    if (fail) fail(res);
                  }
                });
              } else {
                console.error('获取二维码临时链接失败');
                showContactInfo();
                if (fail) fail(new Error('获取二维码临时链接失败'));
              }
            },
            fail: (err) => {
              console.error('获取二维码临时链接失败', err);
              showContactInfo();
              if (fail) fail(err);
            }
          });
        } else {
          console.log('没有wechatPicture字段，显示文字联系方式');
          showContactInfo();
          if (fail) fail(new Error('没有wechatPicture字段'));
        }
      } else {
        console.log('settings集合为空，显示文字联系方式');
        showContactInfo();
        if (fail) fail(new Error('settings集合为空'));
      }
    })
    .catch((err) => {
      console.error('获取客服二维码失败', err);
      showContactInfo();
      if (fail) fail(err);
    });
}

/**
 * 显示联系方式
 */
export function showContactInfo() {
  wx.showModal({
    title: '联系客服',
    content: '请通过以下方式联系客服：\n微信：customer_service_wechat\n电话：400-123-4567',
    showCancel: false,
    confirmText: '确定'
  });
}

/**
 * 联系客服
 */
export function contactService() {
  // 直接显示客服二维码，避免使用wx.openCustomerServiceConversation
  showCustomerQrCode();
}

/**
 * 长按扫码
 */
export function scanQRCode() {
  wx.scanCode({
    success: (res) => {
      console.log('扫码成功', res);
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
