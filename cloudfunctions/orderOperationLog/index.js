/**
 * orderOperationLog 云函数
 * 
 * 用于记录订单操作日志，支持小程序端和云函数端调用。
 */

const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

const { logOrderOperation } = require('./common/orderLogHelper');

exports.main = async (event, context) => {
  try {
    const result = await logOrderOperation(db, event);
    return {
      success: result,
      message: result ? '日志记录成功' : '日志记录失败'
    };
  } catch (error) {
    console.error('orderOperationLog 云函数执行失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
};
