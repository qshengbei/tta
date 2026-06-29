class ErrorLogger {
  constructor() {
    this._deviceInfo = null;
    this._networkType = null;
    this._initialized = false;
    this._registered = false;
  }

  async init() {
    if (this._initialized) return;
    
    try {
      const deviceRes = await wx.getSystemInfo();
      this._deviceInfo = JSON.stringify({
        brand: deviceRes.brand,
        model: deviceRes.model,
        system: deviceRes.system,
        platform: deviceRes.platform,
        version: deviceRes.version,
        SDKVersion: deviceRes.SDKVersion
      });
      this._osVersion = deviceRes.version;
      this._sdkVersion = deviceRes.SDKVersion;
    } catch (error) {
      console.error('ErrorLogger: 获取设备信息失败', error);
    }
    
    try {
      const networkRes = await wx.getNetworkType();
      this._networkType = networkRes.networkType;
    } catch (error) {
      console.error('ErrorLogger: 获取网络类型失败', error);
    }
    
    this._initialized = true;
  }

  registerGlobalErrorHandler() {
    if (this._registered) return;
    
    const self = this;
    
    // 同步异常捕获：wx.onError 能捕获所有未处理的同步错误
    wx.onError(function(msg) {
      self.log({
        type: 'global_sync',
        source: 'miniprogram',
        message: msg,
        location: 'global error handler'
      }).catch(() => {});
    });
    
    this._registered = true;
    console.log('[ErrorLogger] 全局异常处理器已注册');
  }

  async log(options) {
    await this.init();
    
    const params = {
      type: options.type || 'unknown',
      source: options.source || 'miniprogram',
      location: options.location || '',
      message: options.message || '',
      stack: options.stack || '',
      code: options.code || '',
      httpStatus: options.httpStatus || '',
      
      functionName: options.functionName || '',
      inputParams: options.inputParams,
      outputParams: options.outputParams,
      functionDuration: options.functionDuration || '',
      
      pageName: options.pageName || '',
      componentName: options.componentName || '',
      methodName: options.methodName || '',
      
      deviceInfo: this._deviceInfo,
      networkType: this._networkType,
      osVersion: this._osVersion,
      sdkVersion: this._sdkVersion
    };
    
    try {
      const result = await wx.cloud.callFunction({
        name: 'logError',
        data: params
      });
      
      if (result.result && result.result.success) {
        console.log('[ErrorLogger] 错误日志记录成功:', result.result.recordId);
      } else {
        console.error('[ErrorLogger] 错误日志记录失败:', result.result?.errMsg);
      }
    } catch (error) {
      console.error('[ErrorLogger] 调用云函数失败:', error);
    }
  }

  async logPageError(options) {
    await this.log({
      ...options,
      source: 'page'
    });
  }

  async logCloudFunctionError(options) {
    await this.log({
      ...options,
      source: 'cloudfunction'
    });
  }

  async logNetworkError(options) {
    await this.log({
      ...options,
      source: 'network'
    });
  }

  async logDatabaseError(options) {
    await this.log({
      ...options,
      source: 'database'
    });
  }

  async logCatchError(error, options = {}) {
    await this.log({
      type: 'catch',
      message: error.message || String(error),
      stack: error.stack || '',
      code: error.code || '',
      ...options
    });
  }

  async logStorageError(error, options = {}) {
    await this.log({
      type: 'storage',
      source: 'miniprogram',
      message: error.message || String(error),
      stack: error.stack || '',
      ...options
    });
  }

  async logJsonError(error, options = {}) {
    await this.log({
      type: 'json',
      source: 'miniprogram',
      message: error.message || String(error),
      stack: error.stack || '',
      ...options
    });
  }

  getStorage(key, defaultValue = null) {
    try {
      const value = wx.getStorageSync(key);
      return value;
    } catch (error) {
      this.logStorageError(error, {
        message: `读取存储失败: ${key}`,
        location: `getStorage(${key})`
      }).catch(() => {});
      return defaultValue;
    }
  }

  setStorage(key, value) {
    try {
      wx.setStorageSync(key, value);
      return true;
    } catch (error) {
      this.logStorageError(error, {
        message: `写入存储失败: ${key}`,
        location: `setStorage(${key})`
      }).catch(() => {});
      return false;
    }
  }

  parseJson(str, defaultValue = null) {
    try {
      if (!str) return defaultValue;
      return JSON.parse(str);
    } catch (error) {
      this.logJsonError(error, {
        message: 'JSON解析失败',
        location: 'parseJson'
      }).catch(() => {});
      return defaultValue;
    }
  }
}

const errorLogger = new ErrorLogger();

module.exports = errorLogger;