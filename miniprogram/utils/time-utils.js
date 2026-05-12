// 时间处理工具函数

/**
 * 格式化日期为YYYY-MM-DD
 * @param {Date} date - 日期对象
 * @returns {string} 格式化后的日期字符串
 */
export function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 格式化日期标签为MM月DD日
 * @param {Date} date - 日期对象
 * @returns {string} 格式化后的日期标签
 */
export function formatDateLabel(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  
  if (date.toDateString() === today.toDateString()) {
    return '今天';
  } else if (date.toDateString() === tomorrow.toDateString()) {
    return '明天';
  } else {
    return `${month}月${day}日`;
  }
}

/**
 * 生成未来几天的日期数组
 * @param {number} days - 生成的天数
 * @returns {Array} 日期数组
 */
export function generatePickupDates(days = 4) {
  const pickupDates = [];
  const now = new Date();
  
  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(now.getDate() + i);
    pickupDates.push({
      value: formatDate(date),
      label: formatDateLabel(date)
    });
  }
  
  return pickupDates;
}

/**
 * 计算时间区间（加30分钟）
 * @param {string} time - 时间字符串，格式为HH:MM
 * @returns {string} 时间区间的结束时间
 */
export function calculateTimeRange(time) {
  if (!time) return '';
  
  const [hourStr, minuteStr] = time.split(':');
  let hour = parseInt(hourStr);
  let minute = parseInt(minuteStr) + 30;
  
  if (minute >= 60) {
    minute -= 60;
    hour += 1;
  }
  
  const endHour = String(hour).padStart(2, '0');
  const endMinute = String(minute).padStart(2, '0');
  return `${endHour}:${endMinute}`;
}

/**
 * 计算最小小时和分钟
 * @param {Date} now - 当前时间
 * @param {number} beginTime - 开始时间
 * @returns {Object} 最小小时和分钟
 */
export function calculateMinTime(now, beginTime) {
  // 计算当前时间加2小时
  const minDateTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  let minHour = minDateTime.getHours();
  let minMinute = minDateTime.getMinutes();
  
  // 确保不早于beginTime
  if (minHour < beginTime) {
    minHour = beginTime;
    minMinute = 0;
  }
  
  // 分钟向上取整到最近的30分钟或00
  if (minMinute > 0 && minMinute < 30) {
    minMinute = 30;
  } else if (minMinute >= 30) {
    minMinute = 0;
    minHour += 1;
  }
  
  return { minHour, minMinute };
}

/**
 * 解析数据库中的date类型时间为可读格式
 * @param {Date|string} date - 日期对象或日期字符串
 * @returns {string} 格式化后的日期时间字符串，格式为YYYY-MM-DD HH:MM:SS
 */
export function parseDbDate(date) {
  if (!date) return '';
  
  let dateObj;
  if (typeof date === 'string') {
    // 尝试解析字符串为日期对象
    dateObj = new Date(date);
  } else if (date instanceof Date) {
    dateObj = date;
  } else {
    // 处理其他类型，比如对象
    try {
      dateObj = new Date(JSON.stringify(date));
    } catch (e) {
      return '';
    }
  }
  
  // 检查是否为有效日期
  if (isNaN(dateObj.getTime())) {
    return '';
  }
  
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const hour = String(dateObj.getHours()).padStart(2, '0');
  const minute = String(dateObj.getMinutes()).padStart(2, '0');
  const second = String(dateObj.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}
