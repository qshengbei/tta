---
name: "error-logging-system"
description: "异常日志系统，用于记录小程序运行时的各类异常，支持页面错误、云函数错误、数据库错误、网络错误等，便于上线后监控和排查问题。Invoke when implementing error logging for miniprogram applications."
---

# 异常日志系统

## 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端 (Miniprogram)                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ 全局异常捕获  │  │ 页面级异常   │  │  工具类封装          │  │
│  │ wx.onError   │  │ try-catch    │  │ getStorage/setStorage│  │
│  │ Promise      │  │              │  │ parseJson            │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
│         └─────────────────┼──────────────────────┘              │
│                           ▼                                    │
│                 ┌─────────────────┐                            │
│                 │  ErrorLogger    │                            │
│                 │  (统一入口)     │                            │
│                 └────────┬────────┘                            │
└─────────────────────────┼───────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      云函数 (logError)                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  接收参数 → 构建错误日志对象 → 写入 errorMessage 集合    │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    数据库 (errorMessage)                        │
├─────────────────────────────────────────────────────────────────┤
│  存储所有异常信息，支持按类型、来源、时间等维度查询              │
└─────────────────────────────────────────────────────────────────┘
```

## 异常类型分类

| 类型 | 子类型 | 说明 | 示例 |
|------|--------|------|------|
| **catch** | - | try-catch 捕获的异常 | 数据库查询失败 |
| **global_sync** | - | 全局同步错误 | wx API 调用失败 |
| **global_promise** | - | 未捕获的 Promise 异常 | async 函数未处理 |
| **storage** | - | 本地存储错误 | 存储满、数据损坏 |
| **json** | - | JSON 解析错误 | 数据格式错误 |
| **cloudfunction** | - | 云函数调用错误 | 网络错误、函数异常 |
| **network** | - | 网络请求错误 | 请求超时、HTTP 错误 |
| **database** | - | 数据库操作错误 | 查询失败、权限错误 |

## 错误日志数据结构

```javascript
{
  // 基础信息
  type: 'catch',           // 异常类型
  source: 'page',          // 来源：page/cloudfunction/miniprogram
  location: 'home/index.js:_asyncCheckAndUpdate',  // 具体位置
  message: '数据库查询失败', // 错误消息
  stack: 'Error: xxx\nat ...', // 调用栈
  code: 'ERR_INVALID_ARG_TYPE', // 错误码
  httpStatus: '',          // HTTP 状态码（网络错误时）
  
  // 云函数信息
  functionName: 'getProductVersion', // 云函数名称
  inputParams: '{}',       // 入参（JSON 字符串）
  outputParams: '',        // 出参（JSON 字符串）
  functionDuration: '',    // 执行时长
  
  // 页面信息
  pageName: 'home',        // 页面名称
  componentName: '',       // 组件名称
  methodName: '_asyncCheckAndUpdate', // 方法名称
  
  // 用户信息
  userId: 'openid_xxx',    // 用户 openid
  unionId: '',             // 用户 unionid
  appId: 'wx_xxx',         // 小程序 appid
  
  // 设备信息
  deviceInfo: '{"brand":"iPhone","model":"iPhone 14"}', // 设备信息
  networkType: 'wifi',     // 网络类型
  osVersion: '16.0',       // 操作系统版本
  sdkVersion: '3.3.0',     // 小程序基础库版本
  
  // 时间信息
  timestamp: 1699999999999, // 时间戳
  createdAt: db.serverDate() // 创建时间
}
```

## 云函数实现

### logError 云函数

```javascript
// cloudfunctions/logError/index.js
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
```

## 前端工具类

### ErrorLogger 类

```javascript
// miniprogram/utils/errorLogger.js
class ErrorLogger {
  constructor() {
    this._deviceInfo = null;
    this._networkType = null;
    this._initialized = false;
    this._registered = false;
  }
  
  // 初始化设备信息
  async init() { /* ... */ }
  
  // 注册全局异常处理器
  registerGlobalErrorHandler() { /* ... */ }
  
  // 通用日志记录
  async log(options) { /* ... */ }
  
  // 页面错误
  async logPageError(options) { /* ... */ }
  
  // 云函数错误
  async logCloudFunctionError(options) { /* ... */ }
  
  // 网络错误
  async logNetworkError(options) { /* ... */ }
  
  // 数据库错误
  async logDatabaseError(options) { /* ... */ }
  
  // catch 块错误
  async logCatchError(error, options = {}) { /* ... */ }
  
  // 存储错误
  async logStorageError(error, options = {}) { /* ... */ }
  
  // JSON 解析错误
  async logJsonError(error, options = {}) { /* ... */ }
  
  // 安全的存储读取
  getStorage(key, defaultValue = null) { /* ... */ }
  
  // 安全的存储写入
  setStorage(key, value) { /* ... */ }
  
  // 安全的 JSON 解析
  parseJson(str, defaultValue = null) { /* ... */ }
}

const errorLogger = new ErrorLogger();
module.exports = errorLogger;
```

## 集成方式

### 1. 全局注册（app.js）

```javascript
// app.js
import errorLogger from './utils/errorLogger';

App({
  onLaunch() {
    // 注册全局异常处理器
    errorLogger.registerGlobalErrorHandler();
    
    // ... 其他初始化代码
  }
});
```

### 2. 页面级集成

```javascript
// pages/home/index.js
import errorLogger from '../../utils/errorLogger';

Page({
  async someMethod() {
    try {
      // 业务逻辑
      const result = await wx.cloud.callFunction({
        name: 'someFunction',
        data: { param1: 'value1' }
      });
    } catch (error) {
      console.error('业务逻辑失败:', error);
      
      // 记录错误日志
      errorLogger.logCatchError(error, {
        pageName: 'home',
        methodName: 'someMethod',
        location: 'home/index.js:someMethod'
      });
    }
  }
});
```

### 3. 使用安全的工具方法

```javascript
// 替代 wx.getStorageSync
const data = errorLogger.getStorage('key', defaultValue);

// 替代 wx.setStorageSync
const success = errorLogger.setStorage('key', value);

// 替代 JSON.parse
const obj = errorLogger.parseJson(jsonString, defaultValue);
```

## 全局异常捕获

### 设计原则

异常记录必须**不影响主功能**。我们采用双层防护策略：
- **全局兜底**：`wx.onError` 捕获所有未处理的同步异常
- **手动记录**：在关键 catch 块主动记录，提供更丰富的上下文

### 同步错误捕获

```javascript
wx.onError(function(msg) {
  errorLogger.log({
    type: 'global_sync',
    source: 'miniprogram',
    message: msg,
    location: 'global error handler'
  }).catch(() => {});
});
```

`wx.onError` 能捕获：
- `throw new Error(...)` 抛出的同步异常
- 空值访问：`null.length`、`undefined.property`
- 类型错误：`'string' + null`
- 数组越界等运行时异常

### ⚠️ 不要重写 Promise.prototype.then

**反例（已废弃）**：
```javascript
// ❌ 强烈不推荐！会带来严重的性能问题
const originalPromiseReject = Promise.prototype.then;
Promise.prototype.then = function(onFulfilled, onRejected) {
  return originalPromiseReject.call(this, onFulfilled, function(reason) {
    errorLogger.log({...}).catch(() => {});
    if (typeof onRejected === 'function') {
      return onRejected(reason);
    }
    throw reason;
  });
};
```

**风险**：
1. **性能开销巨大**：首页有大量 `Promise.all`、`await` 等异步操作，每次调用都会经过重写的 `then`，增加额外开销
2. **可能影响异步流程**：重写 `then` 可能干扰正常的 Promise 链式调用
3. **可读性差**：其他开发者看到重写的 `then` 会困惑

**正确做法**：
- 在关键的 `catch` 块中手动调用 `errorLogger.logCatchError()`
- 依赖 `wx.onError` 作为全局兜底（虽然对未处理的 Promise rejection 捕获有限，但能覆盖大部分场景）
- 业务代码中始终为 Promise 添加 `.catch()` 或使用 `try-catch`

## 首页集成示例

```javascript
// pages/home/index.js
import errorLogger from '../../utils/errorLogger';

async _asyncCheckAndUpdate() {
  try {
    // 业务逻辑
  } catch (error) {
    console.error('[首页] 异步检测更新失败:', error);
    errorLogger.logCatchError(error, {
      pageName: 'home',
      methodName: '_asyncCheckAndUpdate',
      location: 'home/index.js:_asyncCheckAndUpdate'
    });
  }
}

async checkAndRefreshIfNeeded() {
  try {
    const res = await wx.cloud.callFunction({
      name: 'getProductVersion',
      data: {}
    });
  } catch (error) {
    errorLogger.logCloudFunctionError({
      pageName: 'home',
      methodName: 'checkAndRefreshIfNeeded',
      functionName: 'getProductVersion',
      inputParams: {},
      message: error.message || String(error),
      stack: error.stack || '',
      code: error.errCode || '',
      location: 'home/index.js:checkAndRefreshIfNeeded'
    });
  }
}

async refreshDataSilently() {
  try {
    const [categoryRes, productsRes] = await Promise.all([
      categoryCollection.get(),
      productsCollection.get()
    ]);
  } catch (err) {
    errorLogger.logDatabaseError({
      pageName: 'home',
      methodName: 'refreshDataSilently',
      message: err.message || String(err),
      stack: err.stack || '',
      location: 'home/index.js:refreshDataSilently'
    });
  }
}
```

## 错误日志查询

### 查询最近的错误

```javascript
// 云函数或小程序端
const db = wx.cloud.database();
const res = await db.collection('errorMessage')
  .orderBy('createdAt', 'desc')
  .limit(50)
  .get();
```

### 按类型查询

```javascript
const res = await db.collection('errorMessage')
  .where({ type: 'cloudfunction' })
  .orderBy('createdAt', 'desc')
  .get();
```

### 按页面查询

```javascript
const res = await db.collection('errorMessage')
  .where({ pageName: 'home' })
  .orderBy('createdAt', 'desc')
  .get();
```

## 最佳实践

1. **不要影响主功能**：异常记录必须异步、非阻塞，不能影响业务主流程
2. **不要忽略异常**：所有 catch 块都应该记录错误日志
3. **提供完整上下文**：记录 pageName、methodName、location 等信息
4. **区分异常类型**：使用对应的 log 方法（logCloudFunctionError、logDatabaseError 等）
5. **保护用户隐私**：不要记录敏感信息（密码、手机号等）
6. **使用安全方法**：对于 wx.getStorageSync、JSON.parse 等可能抛出异常的操作，使用 errorLogger 提供的安全方法
7. **全局捕获兜底**：注册全局异常处理器，捕获未处理的异常
8. **避免循环调用**：错误日志记录失败时，不要再次调用错误日志
9. **不要重写原生 API**：不要重写 `Promise.prototype.then` 等原生方法，会带来性能问题

## 常见陷阱

1. ❌ 在 catch 块中只打印日志，不记录到数据库
2. ❌ 记录的信息不够详细，无法定位问题
3. ❌ 记录敏感信息（密码、手机号等）
4. ❌ 在错误日志记录失败时，抛出新的异常导致循环
5. ❌ 没有注册全局异常处理器，导致未处理的 Promise 异常丢失
6. ❌ **重写 `Promise.prototype.then` 等原生方法**（会带来性能开销，影响主功能）
7. ❌ **在同步流程中同步等待错误日志记录完成**（会阻塞主流程）

## 代码参考

本项目中已实现的异常日志系统：

- 云函数：[logError/index.js](file:///Users/xiexiaoqiong/WeChatProjects/tta/cloudfunctions/logError/index.js)
- 前端工具类：[errorLogger.js](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/utils/errorLogger.js)
- 全局注册：[app.js](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/app.js)
- 首页集成：[home/index.js](file:///Users/xiexiaoqiong/WeChatProjects/tta/miniprogram/pages/home/index.js)

## 扩展应用

本系统可扩展应用于：

- 所有页面的异常记录
- 云函数内部的异常记录
- 组件的异常记录
- 工具类的异常记录

只需在对应的 catch 块中调用 errorLogger 的方法即可。