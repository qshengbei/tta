// 地图处理工具函数
import QQMapWX from "./qqmap-wx-jssdk1.2/qqmap-wx-jssdk.js";
import { getCollection } from "./cloud";

/**
 * 计算两点之间的距离
 * @param {Object} point1 - 第一个点的坐标 {latitude, longitude}
 * @param {Object} point2 - 第二个点的坐标 {latitude, longitude}
 * @returns {number} 距离，单位为公里
 */
export function calculateDistance(point1, point2) {
  return Math.sqrt(
    Math.pow(point1.latitude - point2.latitude, 2) +
    Math.pow(point1.longitude - point2.longitude, 2)
  ) * 111;
}

/**
 * 根据配送规则计算配送费
 * @param {number} distance - 距离，单位为公里
 * @param {Array} deliveryRules - 配送规则数组
 * @returns {Object} 包含配送费和是否超出范围的对象
 */
export function calculateDeliveryFee(distance, deliveryRules) {
  let deliveryFee = 0;
  let isOutOfRange = false;
  
  // 排序配送规则，按距离从小到大
  const sortedRules = [...deliveryRules].sort((a, b) => a.maxDistance - b.maxDistance);
  
  // 查找适用的配送规则
  let foundRule = false;
  for (let i = 0; i < sortedRules.length; i++) {
    if (distance <= sortedRules[i].maxDistance) {
      deliveryFee = sortedRules[i].fee;
      foundRule = true;
      break;
    }
  }
  
  // 检查是否超出最大配送范围
  if (sortedRules.length > 0) {
    const maxRange = sortedRules[sortedRules.length - 1].maxDistance;
    if (distance > maxRange) {
      isOutOfRange = true;
      deliveryFee = 0;
    } else {
      isOutOfRange = false;
    }
  } else {
    isOutOfRange = false;
  }
  
  return { deliveryFee, isOutOfRange };
}

/**
 * 生成地图圆形覆盖物
 * @param {Object} center - 圆心坐标 {latitude, longitude}
 * @param {Array} deliveryRules - 配送规则数组
 * @returns {Array} 圆形覆盖物数组
 */
export function generateCircles(center, deliveryRules) {
  const circles = [];
  // 使用标准十六进制颜色格式设置描边颜色
  const colors = ['#00ff99', '#ffff99', '#ff9999']; // 淡绿色、淡黄色、淡红色
  const fillColors = ['#00ff9922', '#ffff9922', '#ff999922']; // 带透明度的填充色
  
  // 从deliveryRules生成圆形覆盖物
  deliveryRules.forEach((rule, index) => {
    circles.push({
      latitude: center.latitude,
      longitude: center.longitude,
      radius: rule.maxDistance * 1000, // 转换为米
      strokeWidth: 2,
      color: colors[index % colors.length], // 描边颜色，使用正确的属性名
      fillColor: fillColors[index % fillColors.length]
    });
  });
  
  return circles;
}

/**
 * 生成地图标记
 * @param {Object} selfPickupLocation - 自提点坐标 {latitude, longitude}
 * @param {Object} userLocation - 用户地址坐标 {latitude, longitude}
 * @param {string} userLocationTitle - 用户地址标记的标题
 * @returns {Array} 标记数组
 */
export function generateMarkers(selfPickupLocation, userLocation, userLocationTitle = '您的地址') {
  return [
    {
      id: 1,
      latitude: selfPickupLocation.latitude,
      longitude: selfPickupLocation.longitude,
      title: '自提点',
      width: 30,
      height: 30
    },
    {
      id: 2,
      latitude: userLocation.latitude,
      longitude: userLocation.longitude,
      title: userLocationTitle,
      width: 30,
      height: 30
    }
  ];
}

/**
 * 调整地图视野，确保两个标记点都在画面内
 * @param {Array} markers - 标记数组
 */
export function adjustMapView(markers) {
  if (markers.length >= 2) {
    const mapContext = wx.createMapContext('map');
    mapContext.includePoints({
      points: markers.map(marker => ({ latitude: marker.latitude, longitude: marker.longitude })),
      padding: [50, 50, 50, 50] // 地图边缘的padding
    });
  }
}

/**
 * 地址解析（地址转坐标）
 * @param {string} address - 地址字符串
 * @param {string} key - 腾讯地图API密钥
 * @param {string} secretKey - 腾讯地图API密钥的secretKey
 * @returns {Promise} 解析结果的Promise
 */
export function geocodeAddress(address, key, secretKey) {
  return new Promise((resolve, reject) => {
    if (!key) {
      reject(new Error("缺少腾讯地图API密钥"));
      return;
    }
    
    // 初始化SDK
    const qqmapsdk = new QQMapWX({ key: key });
    
    // 调用SDK的geocoder方法
    qqmapsdk.geocoder({
      address: address, // 地址参数，包含城市名称
      sig: secretKey, // 在调用方法时传入sig参数
      success: (res) => {
        if (res.status === 0 && res.result && res.result.location) {
          resolve(res.result.location);
        } else {
          reject(new Error(res.message || "地址解析失败"));
        }
      },
      fail: (err) => {
        reject(err);
      }
    });
  });
}

/**
 * 从缓存或API获取地址坐标
 * @param {string} addressStr - 地址字符串
 * @param {string} key - 腾讯地图API密钥
 * @param {string} secretKey - 腾讯地图API密钥的secretKey
 * @returns {Promise} 地址坐标的Promise
 */
export async function getAddressLocation(addressStr, key, secretKey) {
  // 检查addressInfo集合中是否已有该地址的坐标
  const addressInfo = getCollection("adressInfo");
  
  try {
    const res = await addressInfo.where({ address: addressStr }).get();
    if (res.data && res.data.length > 0) {
      // 集合中已有该地址的坐标
      return res.data[0].location;
    } else {
      // 集合中没有，调用API解析地址
      const location = await geocodeAddress(addressStr, key, secretKey);
      
      // 保存到addressInfo集合
      await addressInfo.add({
        data: {
          address: addressStr,
          location: {
            latitude: location.lat,
            longitude: location.lng
          },
          createdAt: new Date()
        }
      });
      
      return location;
    }
  } catch (err) {
    // 集合查询失败，直接调用API解析地址
    const location = await geocodeAddress(addressStr, key, secretKey);
    
    // 保存到addressInfo集合
    try {
      await addressInfo.add({
        data: {
          address: addressStr,
          location: {
            latitude: location.lat,
            longitude: location.lng
          },
          createdAt: new Date()
        }
      });
    } catch (saveErr) {
      console.error("保存地址解析结果失败", saveErr);
    }
    
    return location;
  }
}
