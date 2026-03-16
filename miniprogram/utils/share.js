// 分享和海报生成功能工具模块

/**
 * 显示分享选项
 * @param {Object} page - 页面实例
 */
export function showShareOptions(page) {
  page.setData({ showShareModal: true });
}

/**
 * 隐藏分享选项
 * @param {Object} page - 页面实例
 */
export function hideShareOptions(page) {
  page.setData({ showShareModal: false });
}

/**
 * 分享给微信好友
 * @param {Object} page - 页面实例
 */
export function shareToFriend(page) {
  // 检查是否在真实的微信环境中
  if (wx.getSystemInfoSync().platform === 'devtools') {
    wx.showToast({
      title: '分享功能仅在真实微信环境中可用',
      icon: 'none'
    });
    hideShareOptions(page);
    return;
  }
  
  wx.showShareMenu({
    withShareTicket: true,
    menus: ['shareAppMessage'],
    success: () => {
      console.log('显示分享菜单成功');
      hideShareOptions(page);
    },
    fail: (err) => {
      console.error('显示分享菜单失败', err);
      wx.showToast({
        title: '分享功能暂不可用',
        icon: 'none'
      });
      hideShareOptions(page);
    }
  });
}

/**
 * 分享到朋友圈
 * @param {Object} page - 页面实例
 */
export function shareToTimeline(page) {
  // 检查是否在真实的微信环境中
  if (wx.getSystemInfoSync().platform === 'devtools') {
    wx.showToast({
      title: '分享功能仅在真实微信环境中可用',
      icon: 'none'
    });
    hideShareOptions(page);
    return;
  }
  
  wx.showShareMenu({
    withShareTicket: true,
    menus: ['shareTimeline'],
    success: () => {
      console.log('显示分享到朋友圈菜单成功');
      hideShareOptions(page);
    },
    fail: (err) => {
      console.error('显示分享到朋友圈菜单失败', err);
      wx.showToast({
        title: '分享功能暂不可用',
        icon: 'none'
      });
      hideShareOptions(page);
    }
  });
}

/**
 * 生成海报
 * @param {Object} page - 页面实例
 */
export function generatePoster(page) {
  // 检查是否在真实的微信环境中
  if (wx.getSystemInfoSync().platform === 'devtools') {
    wx.showToast({
      title: '海报功能仅在真实微信环境中可用',
      icon: 'none'
    });
    hideShareOptions(page);
    return;
  }
  
  const { product } = page.data;
  if (!product || !product.coverImage) {
    wx.showToast({
      title: '商品信息不完整，无法生成海报',
      icon: 'none'
    });
    hideShareOptions(page);
    return;
  }
  
  wx.showLoading({
    title: '生成海报中...',
    mask: true
  });
  
  try {
    // 创建画布
    const canvasWidth = 750;
    const canvasHeight = 1334;
    const ctx = wx.createCanvasContext('posterCanvas');
    
    // 绘制背景
    ctx.setFillStyle('#ffffff');
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    // 绘制商品图片
    const imageWidth = 600;
    const imageHeight = 600;
    const imageX = (canvasWidth - imageWidth) / 2;
    const imageY = 100;
    
    wx.getImageInfo({
      src: product.coverImage,
      success: (res) => {
        try {
          ctx.drawImage(res.path, imageX, imageY, imageWidth, imageHeight);
          
          // 绘制商品名称
          ctx.setFontSize(36);
          ctx.setFillStyle('#333333');
          ctx.setTextAlign('center');
          ctx.fillText(product.name || 'Touch the Aura 商品', canvasWidth / 2, imageY + imageHeight + 60);
          
          // 绘制价格
          ctx.setFontSize(48);
          ctx.setFillStyle('#ff4444');
          ctx.fillText(`¥${product.price || 0}`, canvasWidth / 2, imageY + imageHeight + 140);
          
          // 绘制二维码
          const qrCodeSize = 200;
          const qrCodeX = (canvasWidth - qrCodeSize) / 2;
          const qrCodeY = imageY + imageHeight + 200;
          
          // 生成二维码（这里使用模拟数据，实际需要调用二维码生成API）
          const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`https://your-miniprogram-url/pages/product-detail/index?id=${page.data.productId}`)}`;
          
          wx.getImageInfo({
            src: qrCodeUrl,
            success: (qrRes) => {
              try {
                ctx.drawImage(qrRes.path, qrCodeX, qrCodeY, qrCodeSize, qrCodeSize);
                
                // 绘制底部文字
                ctx.setFontSize(24);
                ctx.setFillStyle('#999999');
                ctx.fillText('扫码查看商品详情', canvasWidth / 2, qrCodeY + qrCodeSize + 50);
                ctx.fillText('Touch the Aura', canvasWidth / 2, qrCodeY + qrCodeSize + 90);
                
                // 绘制完成
                ctx.draw(false, () => {
                  // 导出图片
                  wx.canvasToTempFilePath({
                    canvasId: 'posterCanvas',
                    success: (canvasRes) => {
                      wx.hideLoading();
                      
                      // 保存到相册
                      wx.saveImageToPhotosAlbum({
                        filePath: canvasRes.tempFilePath,
                        success: () => {
                          wx.showToast({
                            title: '海报已保存到相册',
                            icon: 'success'
                          });
                        },
                        fail: (err) => {
                          console.error('保存图片失败', err);
                          wx.showToast({
                            title: '保存图片失败，请授权相册权限',
                            icon: 'none'
                          });
                        }
                      });
                    },
                    fail: (err) => {
                      console.error('导出图片失败', err);
                      wx.hideLoading();
                      wx.showToast({
                        title: '生成海报失败',
                        icon: 'none'
                      });
                    }
                  });
                });
              } catch (err) {
                console.error('绘制二维码失败', err);
                wx.hideLoading();
                wx.showToast({
                  title: '生成海报失败',
                  icon: 'none'
                });
              }
            },
            fail: (err) => {
              console.error('获取二维码失败', err);
              wx.hideLoading();
              wx.showToast({
                title: '生成海报失败',
                icon: 'none'
              });
            }
          });
        } catch (err) {
          console.error('绘制商品图片失败', err);
          wx.hideLoading();
          wx.showToast({
            title: '生成海报失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('获取商品图片失败', err);
        wx.hideLoading();
        wx.showToast({
          title: '生成海报失败',
          icon: 'none'
        });
      }
    });
  } catch (err) {
    console.error('生成海报失败', err);
    wx.hideLoading();
    wx.showToast({
      title: '生成海报失败',
      icon: 'none'
    });
  }
  
  hideShareOptions(page);
}

/**
 * 分享给微信好友的配置
 * @param {Object} product - 商品信息
 * @param {string} productId - 商品ID
 * @returns {Object} 分享配置
 */
export function getShareAppMessageConfig(product, productId) {
  return {
    title: product.name || 'Touch the Aura 商品',
    path: `/pages/product-detail/index?id=${productId}`,
    imageUrl: product.coverImage || ''
  };
}

/**
 * 分享到朋友圈的配置
 * @param {Object} product - 商品信息
 * @param {string} productId - 商品ID
 * @returns {Object} 分享配置
 */
export function getShareTimelineConfig(product, productId) {
  return {
    title: product.name || 'Touch the Aura 商品',
    imageUrl: product.coverImage || '',
    path: `/pages/product-detail/index?id=${productId}`
  };
}
