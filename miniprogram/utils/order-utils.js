// 订单处理工具函数
import { getCollection } from "./cloud";

/**
 * 生成取件号码
 * @returns {string} 4位随机数字，不含4
 */
export function generatePickupCode() {
  let pickupCode = '';
  while (pickupCode.length < 4) {
    const digit = Math.floor(Math.random() * 10).toString();
    if (digit !== '4') {
      pickupCode += digit;
    }
  }
  return pickupCode;
}

/**
 * 获取自提地址
 * @returns {Promise} 自提地址信息的Promise
 */
export async function getPickupLocation() {
  const settings = getCollection("settings");
  const res = await settings.get();
  
  if (res.data && res.data.length > 0) {
    const setting = res.data[0];
    if (setting.pickupLocation) {
      return {
        pickupLocation: setting.pickupLocation,
        pickupLatitude: setting.latitude ? Number(setting.latitude) : null,
        pickupLongitude: setting.longitude ? Number(setting.longitude) : null,
        tencentMapKey: setting.tencentMapKey || "",
        secretKey: setting.secretKey || "",
        beginTime: setting.beginTime ? Number(setting.beginTime) : 9, // 默认起始时间为9点
        endTime: setting.endTime ? Number(setting.endTime) : 20, // 默认结束时间为20点
        deliveryRules: setting.deliveryRules || [ // 默认配送费规则
          { maxDistance: 2, fee: 0 },
          { maxDistance: 5, fee: 5 },
          { maxDistance: 10, fee: 10 }
        ]
      };
    }
  }
  
  return null;
}

/**
 * 获取用户的默认地址
 * @returns {Promise} 用户地址的Promise
 */
export function getAddress() {
  return new Promise((resolve) => {
    // 先从本地存储中获取地址
    const storedAddress = wx.getStorageSync('userAddress');
    if (storedAddress) {
      resolve(storedAddress);
      return;
    }
    
    // 本地存储中没有地址，检查用户是否已经授权地址权限
    wx.getSetting({
      success: (res) => {
        if (res.authSetting['scope.address']) {
          // 已经授权，尝试获取地址
          wx.chooseAddress({
            success: (res) => {
              // 将地址保存到本地存储
              wx.setStorageSync('userAddress', res);
              resolve(res);
            },
            fail: (err) => {
              console.log("获取地址失败", err);
              // 失败时返回null
              resolve(null);
            }
          });
        } else {
          // 未授权，返回null
          resolve(null);
        }
      },
      fail: (err) => {
        console.log("获取设置失败", err);
        // 失败时返回null
        resolve(null);
      }
    });
  });
}

/**
 * 选择收货地址
 * @returns {Promise} 选择的地址的Promise
 */
export function chooseAddress() {
  return new Promise((resolve, reject) => {
    wx.chooseAddress({
      success: (res) => {
        // 将地址保存到本地存储
        wx.setStorageSync('userAddress', res);
        resolve(res);
      },
      fail: (err) => {
        if (err.errType === "permission_denied") {
          // 引导用户授权地址权限
          wx.showModal({
            title: "需要地址权限",
            content: "请授权地址权限以选择收货地址",
            success: (res) => {
              if (res.confirm) {
                wx.openSetting({
                  success: (res) => {
                    if (res.authSetting['scope.address']) {
                      // 用户授权后，重新获取地址
                      chooseAddress().then(resolve).catch(reject);
                    } else {
                      reject(new Error("用户拒绝授权地址权限"));
                    }
                  },
                  fail: (err) => {
                    reject(err);
                  }
                });
              } else {
                reject(new Error("用户取消授权地址权限"));
              }
            },
            fail: (err) => {
              reject(err);
            }
          });
        } else if (err.errCode === 1) {
          // 用户取消选择地址
          reject(new Error("用户取消选择地址"));
        } else {
          reject(err);
        }
      }
    });
  });
}

/**
 * 保存坐标到settings集合
 * @param {number} latitude - 纬度
 * @param {number} longitude - 经度
 * @returns {Promise} 保存结果的Promise
 */
export async function saveCoordinates(latitude, longitude) {
  const settings = getCollection("settings");
  return await settings
    .doc("settings") // 假设settings集合只有一个文档，ID为settings
    .update({
      data: {
        latitude,
        longitude
      }
    });
}

/**
 * 计算总价格
 * @param {number} productPrice - 商品价格
 * @param {number} quantity - 数量
 * @param {number} deliveryFee - 配送费
 * @returns {number} 总价格
 */
export function calculateTotalPrice(productPrice, quantity, deliveryFee = 0) {
  return Number(productPrice) * Number(quantity) + Number(deliveryFee);
}

/**
 * 提交订单
 * @param {Object} orderData - 订单数据
 * @returns {Promise} 提交结果的Promise
 */
export function submitOrder(orderData) {
  return new Promise((resolve) => {
    // 模拟提交订单
    wx.showLoading({
      title: "提交订单中..."
    });
    
    // 这里可以添加实际的订单提交逻辑，比如调用云函数创建订单
    setTimeout(() => {
      wx.hideLoading();
      wx.showToast({
        title: "订单提交成功",
        icon: "success"
      });
      
      // 跳转到订单列表页面
      setTimeout(() => {
        wx.navigateTo({
          url: "/pages/order-list/index"
        });
        resolve({ success: true });
      }, 1500);
    }, 1500);
  });
}
