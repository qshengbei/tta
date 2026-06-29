const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  
  const errorLog = {
    type: event.type || 'unknown',
    source: event.source || 'unknown',
    location: event.location || '',
    message: event.message || '',
    stack: event.stack || '',
    code: event.code || '',
    httpStatus: event.httpStatus || '',
    
    functionName: event.functionName || '',
    inputParams: event.inputParams ? JSON.stringify(event.inputParams) : '',
    outputParams: event.outputParams ? JSON.stringify(event.outputParams) : '',
    functionDuration: event.functionDuration || '',
    
    pageName: event.pageName || '',
    componentName: event.componentName || '',
    methodName: event.methodName || '',
    
    userId: wxContext.OPENID || '',
    unionId: wxContext.UNIONID || '',
    appId: wxContext.APPID || '',
    
    deviceInfo: event.deviceInfo || '',
    networkType: event.networkType || '',
    osVersion: event.osVersion || '',
    sdkVersion: event.sdkVersion || '',
    
    timestamp: Date.now(),
    createdAt: db.serverDate()
  };
  
  try {
    const result = await db.collection('errorMessage').add({
      data: errorLog
    });
    
    return {
      success: true,
      errMsg: 'error logged successfully',
      recordId: result._id
    };
  } catch (error) {
    console.error('logError cloud function failed:', error);
    
    return {
      success: false,
      errMsg: error.message,
      error: error
    };
  }
};