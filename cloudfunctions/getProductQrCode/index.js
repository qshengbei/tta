const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { productId } = event;
  if (!productId) {
    return { error: 'productId is required' };
  }

  const pagePath = `pages/product-detail/index?id=${productId}`;

  try {
    const resp = await cloud.openapi.wxacode.get({
      path: pagePath,
      width: 280,
      isHyaline: false,
    });

    const cloudPath = `qrcodes/product_${productId}_${Date.now()}.png`;
    const upload = await cloud.uploadFile({
      cloudPath,
      fileContent: resp.buffer,
    });

    return { fileID: upload.fileID };
  } catch (err) {
    console.error('getProductQrCode error:', err);
    return { error: err.message };
  }
};
