// 运费计算工具模块

// 默认快递规则
export const DEFAULT_EXPRESS_RULES = [
  {
    provinces: ["福建省"],
    fee: 4,
    freeshipping: 40,
    sort: 1
  },
  {
    province: "默认",
    fee: 10,
    freeshipping: 100,
    sort: 99
  }
];

/**
 * 计算运费
 * @param {Array} expressRules - 快递规则数组
 * @param {string} currentProvince - 当前省份
 * @param {Object} product - 商品信息
 * @param {number} quantity - 商品数量
 * @returns {Object} 运费和包邮条件
 */
export function calculateShippingFee(expressRules, currentProvince, product, quantity) {
  if (!expressRules || expressRules.length === 0 || !product.price) {
    return { shippingFee: 0, freeShippingThreshold: 0 };
  }

  // 查找对应省份的运费规则，处理省份名称的匹配
  let provinceRule = null;
  
  // 遍历 expressRules 数组，查找对应省份的规则
  for (let i = 0; i < expressRules.length; i++) {
    const rule = expressRules[i];
    // 检查 rule.provinces 字段（复数形式）
    if (rule.provinces && Array.isArray(rule.provinces)) {
      // 遍历 provinces 数组，查找匹配的省份
      for (let j = 0; j < rule.provinces.length; j++) {
        const ruleProvince = rule.provinces[j];
        // 灵活匹配省份名称
        if (currentProvince.includes(ruleProvince) || ruleProvince.includes(currentProvince)) {
          provinceRule = rule;
          break;
        }
      }
    } else if (rule.province) {
      // 检查 rule.province 字段（单数形式）
      const ruleProvince = rule.province;
      // 灵活匹配省份名称
      if (ruleProvince === "默认" || currentProvince.includes(ruleProvince) || ruleProvince.includes(currentProvince)) {
        provinceRule = rule;
        break;
      }
    }
    if (provinceRule) break;
  }
  
  // 如果没有找到对应省份的规则，使用默认规则
  if (!provinceRule) {
    provinceRule = expressRules.find(rule => rule.province === "默认" || rule.provinces && rule.provinces.includes("默认")) || expressRules[0];
  }

  if (provinceRule) {
    // 计算商品总价格
    const totalPrice = product.price * quantity;
    const freeShippingThreshold = provinceRule.freeShipping || provinceRule.freeShippingThreshold || provinceRule.freeshipping || 0;
    const fee = provinceRule.fee || 0;
    
    console.log('运费规则:', provinceRule);
    console.log('商品总价:', totalPrice);
    console.log('包邮条件:', freeShippingThreshold);
    console.log('运费:', fee);
    
    // 检查是否满足包邮条件
    if (totalPrice >= freeShippingThreshold) {
      return { shippingFee: 0, freeShippingThreshold };
    } else {
      return { shippingFee: fee, freeShippingThreshold };
    }
  }
  
  return { shippingFee: 0, freeShippingThreshold: 0 };
}

/**
 * 排序快递规则，当前地址规则优先显示
 * @param {Array} expressRules - 快递规则数组
 * @param {string} currentProvince - 当前省份
 * @returns {Array} 排序后的规则数组
 */
export function sortExpressRules(expressRules, currentProvince) {
  // 分离当前地址规则和其他规则
  const currentRule = expressRules.find(rule => {
    return (rule.provinces && Array.isArray(rule.provinces) && rule.provinces.some(province => currentProvince.includes(province) || province.includes(currentProvince))) || 
           (rule.province && (currentProvince.includes(rule.province) || rule.province.includes(currentProvince)));
  });
  
  // 其他规则按sort升序排序
  const otherRules = expressRules.filter(rule => {
    return !((rule.provinces && Array.isArray(rule.provinces) && rule.provinces.some(province => currentProvince.includes(province) || province.includes(currentProvince))) || 
             (rule.province && (currentProvince.includes(rule.province) || rule.province.includes(currentProvince))));
  }).sort((a, b) => (a.sort || 0) - (b.sort || 0));
  
  // 合并规则，当前规则在前
  const sortedRules = currentRule ? [currentRule, ...otherRules] : otherRules;
  
  // 为每个规则添加isCurrentRegion属性
  const rulesWithCurrentFlag = sortedRules.map(rule => {
    const isCurrentRegion = (rule.provinces && Array.isArray(rule.provinces) && rule.provinces.some(province => currentProvince.includes(province) || province.includes(currentProvince))) || 
                           (rule.province && (currentProvince.includes(rule.province) || rule.province.includes(currentProvince)));
    return {
      ...rule,
      isCurrentRegion
    };
  });
  
  return rulesWithCurrentFlag;
}
