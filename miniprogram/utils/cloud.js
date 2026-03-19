// utils/cloud.js

const db = wx.cloud.database();

export function getDB() {
  return db;
}

export function getCollection(collectionName) {
  return db.collection(collectionName);
}

export async function callFunction(name, data = {}) {
  try {
    const result = await wx.cloud.callFunction({
      name,
      data
    });
    return result;
  } catch (error) {
    console.error(`调用云函数 ${name} 失败:`, error);
    throw error;
  }
}

export async function uploadFile(cloudPath, filePath) {
  try {
    const result = await wx.cloud.uploadFile({
      cloudPath,
      filePath
    });
    return result;
  } catch (error) {
    console.error('上传文件失败:', error);
    throw error;
  }
}

/**
 * 批量获取文档
 * @param {string} collectionName - 集合名称
 * @param {Array<string>} ids - 文档ID数组
 * @returns {Promise<Array>} 文档数组
 */
export async function getDocsByIds(collectionName, ids) {
  try {
    const collection = getCollection(collectionName);
    const promises = ids.map(id => collection.doc(id).get());
    const results = await Promise.all(promises);
    return results.map(res => res.data).filter(Boolean);
  } catch (error) {
    console.error('批量获取文档失败:', error);
    return [];
  }
}

/**
 * 安全的云函数调用，带重试机制
 * @param {string} name - 云函数名称
 * @param {Object} data - 云函数参数
 * @param {number} maxRetries - 最大重试次数
 * @returns {Promise<any>} 云函数返回结果
 */
export async function safeCallFunction(name, data = {}, maxRetries = 2) {
  let retries = 0;
  let lastError;
  
  while (retries <= maxRetries) {
    try {
      const result = await callFunction(name, data);
      return result;
    } catch (error) {
      lastError = error;
      retries++;
      if (retries <= maxRetries) {
        console.log(`云函数调用失败，正在重试 (${retries}/${maxRetries})...`);
        // 等待一段时间后重试
        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
      }
    }
  }
  
  throw lastError;
}