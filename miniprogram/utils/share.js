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
  
  const { product, productId } = page.data;
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
  
  hideShareOptions(page);
  
  try {
    // 获取屏幕信息
    const systemInfo = wx.getSystemInfoSync();
    const screenWidth = systemInfo.windowWidth;
    const scale = screenWidth / 750; // rpx 转 px 的比例：1rpx = scale px
    
    // 定义所有尺寸（使用 rpx 单位，750rpx = 屏幕宽度）
    const canvasWidthRpx = 750;
    const imageWidthRpx = 600; // 80%屏幕宽度
    const paddingTopRpx = 50;
    const gapBetweenImageRpx = 40;
    const nameHeightRpx = 60;
    const gapAfterNameRpx = 30;
    const priceHeightRpx = 70;
    const gapAfterPriceRpx = 50;
    const gapBetweenDetailImagesRpx = 20;
    const qrCodeSizeRpx = 200;
    const gapAfterQrCodeRpx = 40;
    const textHeightRpx = 40;
    const paddingBottomRpx = 40;
    
    // 准备所有需要绘制的图片
    const allImages = [product.coverImage, ...(product.images || [])];
    
    // 先获取所有图片的信息
    loadAllImages(allImages, (imagePaths) => {
      if (!imagePaths || imagePaths.length === 0) {
        wx.hideLoading();
        wx.showToast({ title: '获取图片失败', icon: 'none' });
        return;
      }
      
      // 计算画布高度（rpx单位）
      let canvasHeightRpx = paddingTopRpx;
      canvasHeightRpx += imageWidthRpx; // 主图
      canvasHeightRpx += gapBetweenImageRpx;
      canvasHeightRpx += nameHeightRpx;
      canvasHeightRpx += gapAfterNameRpx;
      canvasHeightRpx += priceHeightRpx;
      canvasHeightRpx += gapAfterPriceRpx;
      
      // 详情图高度
      if (imagePaths.length > 1) {
        const detailImageCount = imagePaths.length - 1;
        canvasHeightRpx += detailImageCount * imageWidthRpx;
        canvasHeightRpx += detailImageCount * gapBetweenDetailImagesRpx;
      }
      
      canvasHeightRpx += qrCodeSizeRpx;
      canvasHeightRpx += gapAfterQrCodeRpx;
      canvasHeightRpx += textHeightRpx * 2;
      canvasHeightRpx += paddingBottomRpx;
      
      // 更新画布大小（rpx单位用于样式，px单位用于实际绘制）
      page.setData({ 
        posterCanvasWidth: canvasWidthRpx,
        posterCanvasHeight: canvasHeightRpx,
        posterCanvasWidthPx: screenWidth, // 实际像素宽度 = 屏幕宽度
        posterCanvasHeightPx: canvasHeightRpx * scale // 实际像素高度
      });
      
      setTimeout(() => {
        // 转换为 px 单位用于 canvas 绘制
        const canvasWidthPx = canvasWidthRpx * scale;
        const imageWidthPx = imageWidthRpx * scale;
        const paddingTopPx = paddingTopRpx * scale;
        const gapBetweenImagePx = gapBetweenImageRpx * scale;
        const nameHeightPx = nameHeightRpx * scale;
        const gapAfterNamePx = gapAfterNameRpx * scale;
        const priceHeightPx = priceHeightRpx * scale;
        const gapAfterPricePx = gapAfterPriceRpx * scale;
        const gapBetweenDetailImagesPx = gapBetweenDetailImagesRpx * scale;
        const qrCodeSizePx = qrCodeSizeRpx * scale;
        const gapAfterQrCodePx = gapAfterQrCodeRpx * scale;
        
        const ctx = wx.createCanvasContext('posterCanvas');
        
        // 绘制背景
        ctx.setFillStyle('#ffffff');
        ctx.fillRect(0, 0, canvasWidthPx, canvasHeightRpx * scale);
        
        let currentYPx = paddingTopPx;
        
        // 绘制主图
        const mainImageXPx = (canvasWidthPx - imageWidthPx) / 2;
        ctx.drawImage(imagePaths[0], mainImageXPx, currentYPx, imageWidthPx, imageWidthPx);
        currentYPx += imageWidthPx + gapBetweenImagePx;
        
        // 绘制商品名称
        ctx.setFontSize(32 * scale);
        ctx.setFillStyle('#333333');
        ctx.setTextAlign('center');
        drawText(ctx, product.name || 'Touch the Aura 商品', canvasWidthPx / 2, currentYPx, imageWidthPx, 32 * scale);
        currentYPx += nameHeightPx + gapAfterNamePx;
        
        // 绘制价格
        ctx.setFontSize(44 * scale);
        ctx.setFillStyle('#ff4444');
        ctx.fillText(`¥${product.price || 0}`, canvasWidthPx / 2, currentYPx);
        currentYPx += priceHeightPx + gapAfterPricePx;
        
        // 绘制详情图片
        for (let i = 1; i < imagePaths.length; i++) {
          const detailImageXPx = (canvasWidthPx - imageWidthPx) / 2;
          ctx.drawImage(imagePaths[i], detailImageXPx, currentYPx, imageWidthPx, imageWidthPx);
          currentYPx += imageWidthPx + gapBetweenDetailImagesPx;
        }
        
        // 获取小程序码并绘制
        getProductQrCodePath(productId, (qrPath) => {
          if (!qrPath) {
            console.error('获取小程序码失败');
          } else {
            try {
              const qrCodeXPx = (canvasWidthPx - qrCodeSizePx) / 2;
              ctx.drawImage(qrPath, qrCodeXPx, currentYPx, qrCodeSizePx, qrCodeSizePx);
              currentYPx += qrCodeSizePx + gapAfterQrCodePx;
              
              // 绘制底部文字
              ctx.setFontSize(24 * scale);
              ctx.setFillStyle('#999999');
              ctx.fillText('扫码查看商品详情', canvasWidthPx / 2, currentYPx);
              currentYPx += textHeightRpx * scale;
              ctx.fillText('Touch the Aura', canvasWidthPx / 2, currentYPx);
            } catch (err) {
              console.error('绘制二维码失败', err);
            }
          }
          
          // 绘制完成
          ctx.draw(false, () => {
            // 导出图片
            wx.canvasToTempFilePath({
              canvasId: 'posterCanvas',
              success: (canvasRes) => {
                wx.hideLoading();
                
                // 显示预览弹窗
                page.setData({
                  showPosterPreview: true,
                  posterImagePath: canvasRes.tempFilePath
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
        });
      }, 200);
    });
  } catch (err) {
    console.error('生成海报失败', err);
    wx.hideLoading();
    wx.showToast({
      title: '生成海报失败',
      icon: 'none'
    });
  }
}

/**
 * 保存海报到相册
 * @param {Object} page - 页面实例
 */
export function savePosterToAlbum(page) {
  const { posterImagePath } = page.data;
  
  wx.saveImageToPhotosAlbum({
    filePath: posterImagePath,
    success: () => {
      wx.showToast({
        title: '海报已保存到相册',
        icon: 'success'
      });
      // 保存成功后关闭预览
      page.setData({ showPosterPreview: false });
    },
    fail: (err) => {
      console.error('保存图片失败', err);
      wx.showToast({
        title: '保存图片失败，请授权相册权限',
        icon: 'none'
      });
    }
  });
}

/**
 * 关闭海报预览
 * @param {Object} page - 页面实例
 */
export function closePosterPreview(page) {
  page.setData({ showPosterPreview: false });
}

/**
 * 绘制多行文本
 */
function drawText(ctx, text, x, y, maxWidth, lineHeight) {
  if (!text) return;
  
  let line = '';
  let currentY = y;
  
  for (let i = 0; i < text.length; i++) {
    line += text[i];
    const metrics = ctx.measureText ? ctx.measureText(line) : { width: line.length * lineHeight * 0.6 };
    if (metrics.width > maxWidth && i > 0) {
      ctx.fillText(line, x, currentY);
      line = text[i];
      currentY += lineHeight;
    }
  }
  
  if (line) {
    ctx.fillText(line, x, currentY);
  }
}

/**
 * 加载所有图片
 */
function loadAllImages(imageUrls, callback) {
  const result = [];
  let loadedCount = 0;
  let failedCount = 0;
  
  imageUrls.forEach((url, index) => {
    if (!url) {
      loadedCount++;
      checkComplete();
      return;
    }
    
    wx.getImageInfo({
      src: url,
      success: (res) => {
        result[index] = res.path;
        loadedCount++;
        checkComplete();
      },
      fail: (err) => {
        console.error('加载图片失败:', url, err);
        failedCount++;
        loadedCount++;
        checkComplete();
      }
    });
  });
  
  function checkComplete() {
    if (loadedCount === imageUrls.length) {
      // 过滤掉失败的图片
      const validPaths = result.filter(path => path);
      callback(validPaths.length > 0 ? validPaths : null);
    }
  }
}

/**
 * 获取商品小程序码图片本地路径（带缓存）
 */
function getProductQrCodePath(productId, callback) {
  const cacheKey = `qr_${productId}`;
  const cached = wx.getStorageSync(cacheKey);
  if (cached) {
    wx.getImageInfo({
      src: cached,
      success: res => callback(res.path),
      fail: () => {
        wx.removeStorageSync(cacheKey);
        callback(null);
      }
    });
    return;
  }

  wx.cloud.callFunction({
    name: 'getProductQrCode',
    data: { productId }
  }).then(res => {
    if (!res.result || !res.result.fileID) {
      callback(null);
      return;
    }
    return wx.cloud.getTempFileURL({ fileList: [res.result.fileID] });
  }).then(urlRes => {
    if (!urlRes || !urlRes.fileList || !urlRes.fileList[0] || !urlRes.fileList[0].tempFileURL) {
      callback(null);
      return;
    }
    const tempUrl = urlRes.fileList[0].tempFileURL;
    wx.setStorageSync(cacheKey, tempUrl);
    wx.getImageInfo({
      src: tempUrl,
      success: res => callback(res.path),
      fail: () => callback(null)
    });
  }).catch(() => callback(null));
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
