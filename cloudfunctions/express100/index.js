// 云函数入口文件
const cloud = require('wx-server-sdk')
const axios = require('axios')
const crypto = require('crypto')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 快递100 API地址
const API_BASE_URL = 'https://poll.kuaidi100.com'
// 缓存时间（毫秒）
const CACHE_DURATION = 30 * 60 * 1000 // 30分钟

// 物流状态数据
const logisticsStateData = [
  { state: '1', stateName: '揽收', advancedState: '1', advancedStateName: '揽收', meaning: '快件揽件' },
  { state: '1', stateName: '揽收', advancedState: '101', advancedStateName: '已下单', meaning: '已经下快件单' },
  { state: '1', stateName: '揽收', advancedState: '102', advancedStateName: '待揽收', meaning: '待快递公司揽收' },
  { state: '1', stateName: '揽收', advancedState: '103', advancedStateName: '已揽收', meaning: '快递公司已经揽收' },
  { state: '0', stateName: '在途', advancedState: '0', advancedStateName: '在途', meaning: '快件在途中' },
  { state: '0', stateName: '在途', advancedState: '1001', advancedStateName: '到达派件城市', meaning: '快件到达收件人城市' },
  { state: '0', stateName: '在途', advancedState: '1002', advancedStateName: '干线', meaning: '快件处于运输过程中' },
  { state: '0', stateName: '在途', advancedState: '1003', advancedStateName: '转递', meaning: '快件发往到新的收件地址' },
  { state: '5', stateName: '派件', advancedState: '5', advancedStateName: '派件', meaning: '快件正在派件' },
  { state: '5', stateName: '派件', advancedState: '501', advancedStateName: '投柜或驿站', meaning: '快件已经投递到快递柜或者快递驿站' },
  { state: '3', stateName: '签收', advancedState: '3', advancedStateName: '签收', meaning: '快件已签收' },
  { state: '3', stateName: '签收', advancedState: '301', advancedStateName: '本人签收', meaning: '收件人正常签收' },
  { state: '3', stateName: '签收', advancedState: '302', advancedStateName: '派件异常后签收', meaning: '快件显示派件异常，但后续正常签收' },
  { state: '3', stateName: '签收', advancedState: '303', advancedStateName: '代签', meaning: '快件已被代签' },
  { state: '3', stateName: '签收', advancedState: '304', advancedStateName: '投柜或站签收', meaning: '快件已从快递柜或者驿站取出签收' },
  { state: '6', stateName: '退回', advancedState: '6', advancedStateName: '退回', meaning: '快件正处于返回发货人的途中' },
  { state: '4', stateName: '退签', advancedState: '4', advancedStateName: '退签', meaning: '此快件单已退签' },
  { state: '4', stateName: '退签', advancedState: '401', advancedStateName: '已销单', meaning: '此快件单已撤销' },
  { state: '14', stateName: '拒签', advancedState: '14', advancedStateName: '拒签', meaning: '收件人拒绝签收，且寄件人签收了' },
  { state: '7', stateName: '转投', advancedState: '7', advancedStateName: '转投', meaning: '快件转给其他快递公司邮寄' },
  { state: '2', stateName: '疑难', advancedState: '2', advancedStateName: '疑难', meaning: '快件存在疑难' },
  { state: '2', stateName: '疑难', advancedState: '201', advancedStateName: '超时未签收', meaning: '快件长时间派件后未签收' },
  { state: '2', stateName: '疑难', advancedState: '202', advancedStateName: '超时未更新', meaning: '快件长时间没有派件或签收' },
  { state: '2', stateName: '疑难', advancedState: '203', advancedStateName: '拒收', meaning: '收件人发起拒收快递,待发货方确认' },
  { state: '2', stateName: '疑难', advancedState: '204', advancedStateName: '派件异常', meaning: '快件派件时遇到异常情况' },
  { state: '2', stateName: '疑难', advancedState: '205', advancedStateName: '柜或驿站超时未取', meaning: '快件在快递柜或者驿站长时间未取' },
  { state: '2', stateName: '疑难', advancedState: '206', advancedStateName: '无法联系', meaning: '无法联系到收件人' },
  { state: '2', stateName: '疑难', advancedState: '207', advancedStateName: '超区', meaning: '超出快递公司的服务区范围' },
  { state: '2', stateName: '疑难', advancedState: '208', advancedStateName: '滞留', meaning: '快件滞留在网点，没有派送' },
  { state: '2', stateName: '疑难', advancedState: '209', advancedStateName: '破损', meaning: '快件破损' },
  { state: '2', stateName: '疑难', advancedState: '210', advancedStateName: '销单', meaning: '寄件人申请撤销寄件' },
  { state: '8', stateName: '清关', advancedState: '8', advancedStateName: '清关', meaning: '快件清关' },
  { state: '10', stateName: '待清关', advancedState: '10', advancedStateName: '待清关', meaning: '快件等待清关' },
  { state: '11', stateName: '清关中', advancedState: '11', advancedStateName: '清关中', meaning: '快件正在清关流程中' },
  { state: '12', stateName: '已清关', advancedState: '12', advancedStateName: '已清关', meaning: '快件已完成清关流程' },
  { state: '13', stateName: '清关异常', advancedState: '13', advancedStateName: '清关异常', meaning: '货物在清关过程中出现异常' }
]

// 默认物流状态映射
const defaultStateMap = {
  basic: {},
  advanced: {}
};

// 初始化默认状态映射
logisticsStateData.forEach(item => {
  const basicCode = item.state || '';
  const advancedCode = item.advancedState || item.state || '';

  if (basicCode && !defaultStateMap.basic[basicCode]) {
    defaultStateMap.basic[basicCode] = {
      name: item.stateName,
      meaning: item.meaning
    };
  }

  if (advancedCode) {
    defaultStateMap.advanced[advancedCode] = {
      name: item.stateName || item.advancedStateName,
      meaning: item.meaning
    };
  }
});

/**
 * 获取快递100配置
 */
async function getExpress100Config() {
  try {
    const res = await db.collection('settings').get()
    if (res.data && res.data.length > 0) {
      const settings = res.data[0]
      let express100Api = settings.express100Api || []

      // 解析 express100Api 字段
      if (typeof express100Api === 'string') {
        try {
          express100Api = JSON.parse(express100Api)
        } catch (e) {
          console.error('解析 express100Api 失败:', e)
          express100Api = []
        }
      }

      // 解析数组中的每个元素
      if (Array.isArray(express100Api)) {
        express100Api = express100Api.map(item => {
          if (typeof item === 'string') {
            try {
              // 处理字符串形式的JSON
              return JSON.parse(item)
            } catch (e) {
              console.error('解析 express100Api 元素失败:', e)
              return null
            }
          } else if (typeof item === 'object' && item !== null) {
            // 处理已经是对象的元素
            return item
          }
          return null
        }).filter(item => item !== null)
      } else {
        express100Api = []
      }

      return {
        ...(settings.express100Parameters || {}),
        express100Api: express100Api
      }
    }
    return { express100Api: [] }
  } catch (error) {
    console.error('获取快递100配置失败:', error)
    return { express100Api: [] }
  }
}

/**
 * 检查接口是否启用
 */
function isApiEnabled(config, api) {
  if (config.express100Api && Array.isArray(config.express100Api)) {
    const apiItem = config.express100Api.find(item => item.api === api)
    return apiItem ? apiItem.isEnable : false
  }
  return false
}

/**
 * 生成签名
 */
function generateSign(params, key, customer) {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&')
  const signStr = `${sortedParams}&key=${key}&customer=${customer}`
  return crypto.createHash('md5').update(signStr).digest('hex').toUpperCase()
}

function isLogisticsFinished(logisticsData) {
  if (!logisticsData || typeof logisticsData !== 'object') {
    return false
  }
  const flag = logisticsData.ischeck ?? logisticsData.isCheck
  return String(flag) === '1'
}

/**
 * 检查缓存
 */
async function checkCache(key) {
  try {
    const res = await db.collection('logisticsInfo').where({ key: key }).get()
    if (res.data && res.data.length > 0) {
      const cache = res.data[0]
      const now = Date.now()
      // 已签收订单视为物流完成，缓存永久有效
      if (isLogisticsFinished(cache.data)) {
        return { hit: true, data: cache.data, cacheId: cache._id, finished: true }
      }
      if (now - cache.timestamp < CACHE_DURATION) {
        // 缓存未过期
        return { hit: true, data: cache.data, cacheId: cache._id }
      } else {
        // 缓存已过期
        return { hit: false, cacheId: cache._id }
      }
    }
    return { hit: false }
  } catch (error) {
    console.error('检查缓存失败:', error)
    return { hit: false }
  }
}

/**
 * 更新缓存
 */
async function updateCache(key, data, cacheId = null, meta = {}) {
  try {
    const cacheData = {
      key: key,
      data: data,
      timestamp: Date.now(),
      createdAt: new Date(),
      updatedAt: new Date(),
      expressNo: meta.expressNo || '',
      companyCode: meta.companyCode || '',
      apiType: meta.apiType || ''
    }

    if (cacheId) {
      // 更新现有缓存
      await db.collection('logisticsInfo').doc(cacheId).update({
        data: {
          data: data,
          timestamp: Date.now(),
          updatedAt: new Date(),
          expressNo: meta.expressNo || '',
          companyCode: meta.companyCode || '',
          apiType: meta.apiType || ''
        }
      })
    } else {
      // 创建新缓存
      await db.collection('logisticsInfo').add(cacheData)
    }
  } catch (error) {
    console.error('更新缓存失败:', error)
  }
}

/**
 * 通过快递单号和公司代码获取最新缓存
 */
async function getLatestLogisticsCache(expressNo, companyCode) {
  try {
    const now = Date.now()
    let latest = null

    if (expressNo && companyCode) {
      const byFields = await db.collection('logisticsInfo')
        .where({ expressNo, companyCode })
        .orderBy('updatedAt', 'desc')
        .limit(1)
        .get()

      if (byFields.data && byFields.data.length > 0) {
        latest = byFields.data[0]
      }
    }

    if (!latest && expressNo) {
      const legacy = await db.collection('logisticsInfo')
        .where({
          key: db.RegExp({
            regexp: companyCode ? `_${companyCode}_${expressNo}` : `_${expressNo}`,
            options: 'i'
          })
        })
        .orderBy('updatedAt', 'desc')
        .limit(1)
        .get()

      if (legacy.data && legacy.data.length > 0) {
        latest = legacy.data[0]
      }
    }

    if (!latest) {
      return { hit: false }
    }

    const updatedTs = latest.timestamp || (latest.updatedAt ? new Date(latest.updatedAt).getTime() : 0)
    const age = updatedTs ? (now - updatedTs) : Number.MAX_SAFE_INTEGER

    // 已签收订单视为物流完成，直接返回，不再受30分钟限制
    if (isLogisticsFinished(latest.data)) {
      return { hit: true, data: latest.data, cacheId: latest._id, ageMs: age, finished: true }
    }

    if (age < CACHE_DURATION) {
      return { hit: true, data: latest.data, cacheId: latest._id, ageMs: age }
    }

    return { hit: false, cacheId: latest._id, ageMs: age }
  } catch (error) {
    console.error('按快递单号查询缓存失败:', error)
    return { hit: false }
  }
}

/**
 * 初始化物流状态数据
 */
async function initLogisticsStateData() {
  try {
    console.log('开始初始化物流状态数据');
    // 检查集合是否已有数据
    const res = await db.collection('logisticsState').get()
    console.log('检查logisticsState集合结果:', res);
    if (res.data && res.data.length > 0) {
      console.log('物流状态数据已存在，跳过初始化')
      return { success: true, message: '物流状态数据已存在' }
    }

    // 批量添加数据
    console.log('开始批量添加物流状态数据');
    const tasks = []
    for (let i = 0; i < logisticsStateData.length; i++) {
      const item = logisticsStateData[i]
      console.log(`添加第${i + 1}条数据:`, item);
      tasks.push(db.collection('logisticsState').add({ data: item }))
    }

    const result = await Promise.all(tasks)
    console.log('批量添加结果:', result);
    console.log('物流状态数据初始化成功')
    return { success: true, message: '物流状态数据初始化成功' }
  } catch (error) {
    console.error('初始化物流状态数据失败:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 获取物流状态映射
 */
async function getStateMap() {
  try {
    console.log('开始获取物流状态映射');
    const res = await db.collection('logisticsState').get()
    console.log('查询logisticsState集合结果:', res);
    if (res.data && res.data.length > 0) {
      // 从数据库构建映射
      console.log('从数据库构建状态映射');
      const stateMap = { basic: {}, advanced: {} }
      res.data.forEach(item => {
        const basicCode = item.advancedState ? item.state : (item.baseState || '');
        const advancedCode = item.advancedState || item.state || '';

        if (basicCode && !stateMap.basic[basicCode]) {
          stateMap.basic[basicCode] = {
            name: item.stateName,
            meaning: item.meaning
          }
        }

        if (advancedCode) {
          stateMap.advanced[advancedCode] = {
            name: item.stateName || item.advancedStateName,
            meaning: item.meaning
          }
        }
      })
      console.log('从数据库构建的状态映射:', stateMap);
      return stateMap
    }
    // 数据库无数据，使用默认映射
    console.log('数据库无数据，使用默认映射');
    return defaultStateMap
  } catch (error) {
    console.error('获取状态映射失败:', error)
    // 出错时使用默认映射
    return defaultStateMap
  }
}

/**
 * 从物流数据中提取状态信息（state、stateName、isCheck、arrivalTime）
 */
async function extractStateInfo(logisticsData) {
  if (!logisticsData || typeof logisticsData !== 'object') {
    return { state: '', stateName: '', isCheck: '', arrivalTime: '' }
  }

  const state = logisticsData.state || logisticsData.advancedState || '';
  const isCheck = logisticsData.ischeck ?? logisticsData.isCheck ?? '';

  // 获取状态映射
  const stateMap = await getStateMap();
  
  // 优先查找 advancedState 对应的状态名
  let stateName = '';
  if (logisticsData.advancedState && stateMap.advanced && stateMap.advanced[logisticsData.advancedState]) {
    stateName = stateMap.advanced[logisticsData.advancedState].name || '';
  }
  
  // 如果没有找到，查找 state 对应的状态名
  if (!stateName && state) {
    if (stateMap.basic && stateMap.basic[state]) {
      stateName = stateMap.basic[state].name || '';
    } else if (stateMap.advanced && stateMap.advanced[state]) {
      stateName = stateMap.advanced[state].name || '';
    }
  }

  return {
    state,
    stateName: stateName || logisticsData.stateName || '',
    isCheck: String(isCheck),
    arrivalTime: String(
      logisticsData.arrivalTime ||
      logisticsData.arriveTime ||
      logisticsData.arrival_time ||
      ''
    ).trim()
  }
}

/**
 * 智能判断接口
 * 每次都调用接口获取结果，不使用缓存（因为快递单号与快递公司的对应关系是固定的）
 */
async function smartCheck(expressNo) {
  const config = await getExpress100Config()

  // 检查配置和接口启用状态
  if (!config.key || !config.customer || !isApiEnabled(config, 'smartCheck')) {
    return { success: false, error: '快递100配置未设置或智能判断接口未启用' }
  }

  try {
    // 去除key值中的所有空白字符
    const cleanKey = config.key.replace(/\s/g, '');
    console.log('传递给快递100的key:', cleanKey);
    console.log('key长度:', cleanKey.length);
    console.log('key字符码:', cleanKey.split('').map(c => c.charCodeAt(0)));
    
    // 智能判断接口使用不同的URL和参数格式
    const response = await axios.get('https://www.kuaidi100.com/autonumber/auto', {
      params: {
        num: expressNo,
        key: cleanKey
      }
    })

    return { success: true, data: response.data }
  } catch (error) {
    console.error('智能判断接口调用失败:', error)
    return { success: false, error: error.message || '智能判断接口调用失败' }
  }
}

/**
 * 快递信息实时查询接口
 */
async function realTimeQuery(expressNo, companyCode, fromAddress, toAddress, options = {}) {
  const { skipCache = false } = options
  const config = await getExpress100Config()

  // 检查配置和接口启用状态
  if (!config.key || !config.customer || !isApiEnabled(config, 'realTimeQuery')) {
    return { success: false, error: '快递100配置未设置或实时查询接口未启用' }
  }

  // 规范化地址，并将地址维度纳入缓存键，避免旧错误缓存污染
  const normalizedFromAddress = (fromAddress || '').trim()
  const normalizedToAddress = (toAddress || '').trim()
  const resultv2 = '8'
  const cacheSalt = crypto
    .createHash('md5')
    .update(JSON.stringify({ from: normalizedFromAddress, to: normalizedToAddress, resultv2 }))
    .digest('hex')
    .slice(0, 16)

  // 生成缓存键（包含地址与resultv2维度）
  const cacheKey = `realTimeQuery_${companyCode}_${expressNo}_${cacheSalt}`

  // 检查缓存
  let cacheResult = { hit: false }
  if (!skipCache) {
    cacheResult = await checkCache(cacheKey)
    if (cacheResult.hit) {
      console.log('[RTQ诊断] 命中缓存，直接返回。cacheKey=', cacheKey)
      return { success: true, data: cacheResult.data }
    }
  } else {
    cacheResult = await checkCache(cacheKey)
  }

  try {
    // 打印授权码信息
    console.log('传递给快递100的key:', config.key)
    console.log('key长度:', config.key.length)
    console.log('key字符码:', config.key.split('').map(c => c.charCodeAt(0)))
    console.log('传递给快递100的customer:', config.customer)
    console.log('customer长度:', config.customer.length)
    
    // 构建请求参数
    const requestData = {
      com: companyCode,
      num: expressNo,
      resultv2
    }
    
    // 添加出发地和目的地（resultv2=8时必填）
    if (normalizedFromAddress) {
      requestData.from = normalizedFromAddress
    }
    if (normalizedToAddress) {
      requestData.to = normalizedToAddress
    }
    
    const requestStr = JSON.stringify(requestData)
    console.log('实时查询请求参数:', requestData)
    console.log('[RTQ诊断] 地址字段明细:', {
      fromAddressRaw: fromAddress || '',
      toAddressRaw: toAddress || '',
      fromAddressNormalized: normalizedFromAddress,
      toAddressNormalized: normalizedToAddress,
      fromLength: normalizedFromAddress.length,
      toLength: normalizedToAddress.length,
      hasFromField: Object.prototype.hasOwnProperty.call(requestData, 'from'),
      hasToField: Object.prototype.hasOwnProperty.call(requestData, 'to')
    })
    console.log('[RTQ诊断] requestStr原文:', requestStr)
    const sign = crypto.createHash('md5').update(requestStr + config.key + config.customer).digest('hex').toUpperCase()

    // 文档要求使用 application/x-www-form-urlencoded + POST
    const formData = new URLSearchParams({
      customer: config.customer,
      sign,
      param: requestStr
    })
    console.log('[RTQ诊断] 表单串(form-urlencoded):', formData.toString())

    const response = await axios.post(`${API_BASE_URL}/poll/query.do`, formData.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
    console.log('[RTQ诊断] 快递100返回摘要:', {
      status: response?.status,
      statusText: response?.statusText,
      result: response?.data?.result,
      returnCode: response?.data?.returnCode,
      message: response?.data?.message
    })

    // 仅缓存成功结果，避免缓存“收件地址不能为空”等错误响应
    if (!(response.data && response.data.result === false)) {
      await updateCache(cacheKey, response.data, cacheResult.cacheId, {
        expressNo,
        companyCode,
        apiType: 'realTimeQuery'
      })
      console.log('[RTQ诊断] 已写入缓存。cacheKey=', cacheKey)
    } else {
      console.log('[RTQ诊断] 本次为错误响应，不写缓存。cacheKey=', cacheKey)
    }

    return { success: true, data: response.data }
  } catch (error) {
    console.error('实时查询接口调用失败:', error)
    return { success: false, error: error.message || '实时查询接口调用失败' }
  }
}

/**
 * 快递信息订阅接口
 */
async function subscribe(expressNo, companyCode, callbackUrl, phone) {
  const config = await getExpress100Config()

  // 检查配置和接口启用状态
  if (!config.key || !config.customer || !isApiEnabled(config, 'subscribe')) {
    return { success: false, error: '快递100配置未设置或订阅接口未启用' }
  }

  try {
    const params = {
      com: companyCode,
      num: expressNo,
      callbackurl: callbackUrl,
      resultv2: '8'
    }

    if (phone) {
      params.phone = phone
    }

    const sign = generateSign(params, config.key, config.customer)

    const response = await axios.post(`${API_BASE_URL}/subscribe`, {
      ...params,
      customer: config.customer,
      sign: sign
    })

    return { success: true, data: response.data }
  } catch (error) {
    console.error('订阅接口调用失败:', error)
    return { success: false, error: error.message || '订阅接口调用失败' }
  }
}

/**
 * 快递查询地图轨迹接口
 */
async function mapTrack(expressNo, companyCode, phone, options = {}) {
  const { skipCache = false } = options
  const config = await getExpress100Config()

  // 检查配置和接口启用状态
  if (!config.key || !config.customer || !isApiEnabled(config, 'mapTrack')) {
    return { success: false, error: '快递100配置未设置或地图轨迹接口未启用' }
  }

  // 生成缓存键
  const cacheKey = `mapTrack_${companyCode}_${expressNo}`

  // 检查缓存
  let cacheResult = { hit: false }
  if (!skipCache) {
    cacheResult = await checkCache(cacheKey)
    if (cacheResult.hit) {
      return { success: true, data: cacheResult.data }
    }
  } else {
    cacheResult = await checkCache(cacheKey)
  }

  try {
    // 构建请求参数
    const requestData = {
      com: companyCode,
      num: expressNo,
      resultv2: '5'
    }

    if (phone) {
      requestData.phone = phone
    }
    
    const requestStr = JSON.stringify(requestData)
    const sign = crypto.createHash('md5').update(requestStr + config.key + config.customer).digest('hex').toUpperCase()

    const response = await axios.get(`${API_BASE_URL}/poll/query.do`, {
      params: {
        customer: config.customer,
        sign: sign,
        param: requestStr
      }
    })

    // 更新缓存
    await updateCache(cacheKey, response.data, cacheResult.cacheId, {
      expressNo,
      companyCode,
      apiType: 'mapTrack'
    })

    return { success: true, data: response.data }
  } catch (error) {
    console.error('地图轨迹接口调用失败:', error)
    return { success: false, error: error.message || '地图轨迹接口调用失败' }
  }
}

/**
 * 统一物流查询：先查logisticsInfo半小时缓存，缓存无效再调用启用接口并更新缓存
 */
async function queryLogistics(expressNo, companyCode, fromAddress, toAddress, forceRefresh = false) {
  const config = await getExpress100Config()
  let resolvedCompanyCode = companyCode || ''

  if (!resolvedCompanyCode && isApiEnabled(config, 'smartCheck')) {
    const smartRes = await smartCheck(expressNo)
    if (smartRes.success && smartRes.data && smartRes.data.auto && smartRes.data.auto.length > 0) {
      resolvedCompanyCode = smartRes.data.auto[0].comCode || ''
    }
  }

  if (!resolvedCompanyCode) {
    return { success: false, error: '缺少快递公司编码，且智能识别失败' }
  }

  if (!forceRefresh) {
    const latestCache = await getLatestLogisticsCache(expressNo, resolvedCompanyCode)
    if (latestCache.hit) {
      const logisticsData = latestCache.data
      const stateInfo = await extractStateInfo(logisticsData)
      return {
        success: true,
        data: logisticsData,
        state: stateInfo.state,
        stateName: stateInfo.stateName,
        isCheck: stateInfo.isCheck,
        arrivalTime: stateInfo.arrivalTime,
        lastGetTime: new Date(),
        fromCache: true,
        companyCode: resolvedCompanyCode
      }
    }
  }

  if (isApiEnabled(config, 'realTimeQuery')) {
    const rtqRes = await realTimeQuery(expressNo, resolvedCompanyCode, fromAddress, toAddress, { skipCache: !!forceRefresh })
    if (rtqRes.success && rtqRes.data) {
      const stateInfo = await extractStateInfo(rtqRes.data)
      return {
        ...rtqRes,
        state: stateInfo.state,
        stateName: stateInfo.stateName,
        isCheck: stateInfo.isCheck,
        arrivalTime: stateInfo.arrivalTime,
        lastGetTime: new Date(),
        companyCode: resolvedCompanyCode
      }
    }
    return {
      ...rtqRes,
      companyCode: resolvedCompanyCode
    }
  }

  if (isApiEnabled(config, 'mapTrack')) {
    const mapRes = await mapTrack(expressNo, resolvedCompanyCode, '', { skipCache: !!forceRefresh })
    if (mapRes.success && mapRes.data) {
      const stateInfo = await extractStateInfo(mapRes.data)
      return {
        ...mapRes,
        state: stateInfo.state,
        stateName: stateInfo.stateName,
        isCheck: stateInfo.isCheck,
        arrivalTime: stateInfo.arrivalTime,
        lastGetTime: new Date(),
        companyCode: resolvedCompanyCode
      }
    }
    return {
      ...mapRes,
      companyCode: resolvedCompanyCode
    }
  }

  return { success: false, error: '未启用可用的物流查询接口' }
}

/**
 * 查询物流信息并自动更新对应订单状态（如果物流已签收）
 */
async function queryLogisticsAndUpdateOrder(expressNo, companyCode, fromAddress, toAddress, forceRefresh = false) {
  const logisticsResult = await queryLogistics(expressNo, companyCode, fromAddress, toAddress, forceRefresh);

  if (!logisticsResult.success) {
    return {
      ...logisticsResult,
      orderUpdated: false
    };
  }

  const isDelivered = String(logisticsResult.isCheck) === '1';

  try {
    const orderRes = await db.collection('orders')
      .where({
        'logisticsInfo.trackingNumber': expressNo,
        status: 'shipping'
      })
      .limit(1)
      .get();

    if (!orderRes.data || orderRes.data.length === 0) {
      return {
        ...logisticsResult,
        orderUpdated: false,
        orderUpdateMessage: '没有找到待收货的订单'
      };
    }

    const order = orderRes.data[0];
    const now = new Date();
    const updateData = {
      logisticsState: {
        state: logisticsResult.state || '',
        stateName: logisticsResult.stateName || '',
        isCheck: logisticsResult.isCheck || '',
        lastGetTime: now,
        checkTime: logisticsResult.arrivalTime || ''
      },
      updatedAt: now
    };

    if (isDelivered) {
      updateData.status = 'delivered';
      updateData.deliveredAt = now;
      updateData.receiptConfirm = {
        type: 'pending',
        confirmedAt: null,
        confirmedBy: 'system',
        source: 'logistics_query'
      };
    }

    await db.collection('orders').doc(order._id).update({
      data: updateData
    });

    return {
      ...logisticsResult,
      orderUpdated: isDelivered,
      orderId: order._id,
      orderNumber: order.orderNumber
    };
  } catch (error) {
    console.error('自动更新订单状态失败:', error);
    return {
      ...logisticsResult,
      orderUpdated: false,
      orderUpdateError: error.message
    };
  }
}

/**
 * 地图轨迹推送接口
 */
async function mapTrackPush(expressNo, companyCode, callbackUrl, phone) {
  const config = await getExpress100Config()

  // 检查配置和接口启用状态
  if (!config.key || !config.customer || !isApiEnabled(config, 'mapTrackPush')) {
    return { success: false, error: '快递100配置未设置或地图轨迹推送接口未启用' }
  }

  try {
    const params = {
      com: companyCode,
      num: expressNo,
      callbackurl: callbackUrl,
      resultv2: '5'
    }

    if (phone) {
      params.phone = phone
    }

    const sign = generateSign(params, config.key, config.customer)

    const response = await axios.post(`${API_BASE_URL}/map/subscribe`, {
      ...params,
      customer: config.customer,
      sign: sign
    })

    return { success: true, data: response.data }
  } catch (error) {
    console.error('地图轨迹推送接口调用失败:', error)
    return { success: false, error: error.message || '地图轨迹推送接口调用失败' }
  }
}

// 云函数入口函数
exports.main = async (event, context) => {
  const { action, ...params } = event

  try {
    switch (action) {
      case 'smartCheck':
        return await smartCheck(params.expressNo)
      case 'realTimeQuery':
        return await realTimeQuery(params.expressNo, params.companyCode, params.fromAddress, params.toAddress)
      case 'subscribe':
        return await subscribe(params.expressNo, params.companyCode, params.callbackUrl, params.phone)
      case 'mapTrack':
        return await mapTrack(params.expressNo, params.companyCode, params.phone)
      case 'mapTrackPush':
        return await mapTrackPush(params.expressNo, params.companyCode, params.callbackUrl, params.phone)
      case 'queryLogistics':
        return await queryLogistics(
          params.expressNo,
          params.companyCode,
          params.fromAddress,
          params.toAddress,
          params.forceRefresh
        )
      case 'queryLogisticsAndUpdateOrder':
        return await queryLogisticsAndUpdateOrder(
          params.expressNo,
          params.companyCode,
          params.fromAddress,
          params.toAddress,
          params.forceRefresh
        )
      case 'initLogisticsStateData':
        return await initLogisticsStateData()
      case 'getStateMap':
        return { success: true, data: await getStateMap() }
      default:
        return { success: false, error: '无效的操作' }
    }
  } catch (error) {
    console.error('快递100接口调用失败:', error)
    return { success: false, error: error.message || '接口调用失败' }
  }
}