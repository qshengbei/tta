const EXPRESS_COMPANIES = [
  { name: '顺丰速运', code: 'sf' },
  { name: '圆通速递', code: 'yuantong' },
  { name: '中通快递', code: 'zhongtong' },
  { name: '韵达快递', code: 'yunda' },
  { name: '申通快递', code: 'shentong' },
  { name: 'EMS', code: 'ems' },
  { name: '京东物流', code: 'jd' },
  { name: '邮政包裹', code: 'youzhengguonei' },
  { name: '百世快递', code: 'huitongkuaidi' },
  { name: '德邦快递', code: 'debangwuliu' },
  { name: '天天快递', code: 'tiantian' },
  { name: '其他', code: 'OTHER' }
];

const COMMON_EXPRESS_COMPANIES = [
  { name: '顺丰速运', code: 'sf' },
  { name: '圆通速递', code: 'yuantong' },
  { name: '中通快递', code: 'zhongtong' },
  { name: '韵达快递', code: 'yunda' },
  { name: '申通快递', code: 'shentong' },
  { name: 'EMS', code: 'ems' },
  { name: '京东物流', code: 'jd' },
  { name: '德邦快递', code: 'debangwuliu' }
];

function getCompanyByCode(code) {
  if (!code) return null;
  const normalizedCode = code.toLowerCase();
  return EXPRESS_COMPANIES.find(c => c.code.toLowerCase() === normalizedCode);
}

function getCompanyByName(name) {
  if (!name) return null;
  return EXPRESS_COMPANIES.find(c => c.name === name);
}

module.exports = {
  EXPRESS_COMPANIES,
  COMMON_EXPRESS_COMPANIES,
  getCompanyByCode,
  getCompanyByName
};