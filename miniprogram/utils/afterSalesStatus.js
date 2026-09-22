/**
 * 售后状态 / 类型文案单一来源
 * 列表、用户详情、管理端详情共用显示文案，避免三处不一致
 */

export const TYPE_TEXT_MAP = {
  refund: '退款',
  refund_received: '退款（已收到货）',
  refund_not_received: '退款（未收到货）',
  return_refund: '退货退款',
  exchange: '换货',
  mixed: '混合售后',
  not_received_refund: '未收到货退款'
};

/** 默认状态文案（非换货） */
export const STATUS_TEXT_MAP = {
  submitted: '待处理',
  reviewing: '审核中',
  waiting_buyer_return: '待买家寄回',
  waiting_seller_receive: '待商家收货',
  processing: '处理中',
  pending_refund: '待退款',
  rejected: '已拒绝',
  completed: '已完成',
  cancelled: '已取消',
  pending: '待处理',
  approved: '已通过',
  seller_reviewing: '商家验货中',
  seller_received: '商家验货中',
  seller_returning: '商家寄回中',
  buyer_receiving: '待买家收货',
  intercepting: '正在拦截快递'
};

/** 用户端状态说明 */
export const STATUS_DESC_MAP = {
  submitted: '我们正在处理您的售后申请，请耐心等待',
  reviewing: '售后单正在审核中，请耐心等待',
  waiting_buyer_return: '审核已通过，请按指引寄回商品',
  waiting_seller_receive: '商品寄回中，等待商家签收',
  processing: '售后处理中，请留意后续进度',
  pending_refund: '退款处理中，请留意到账进度',
  rejected: '您的售后申请未通过，请查看处理意见',
  completed: '您的售后申请已完成，感谢您的支持',
  cancelled: '您的售后申请已取消',
  pending: '我们正在处理您的售后申请，请耐心等待',
  approved: '您的售后申请已通过，我们将尽快为您处理',
  seller_reviewing: '商家正在验货，请耐心等待',
  seller_returning: '商家正在将商品寄回，请留意物流信息',
  buyer_receiving: '商家已寄回商品，请注意查收并确认收货',
  intercepting: '客服正在拦截快递，请耐心等待后续处理'
};

/** 管理端状态说明（面向商家操作） */
export const STATUS_DESC_MAP_ADMIN = {
  submitted: '请及时处理该售后申请',
  reviewing: '售后单正在审核中，请继续关注',
  waiting_buyer_return: '已通过审核，等待买家寄回商品',
  waiting_seller_receive: '商品寄回中，请留意物流信息并及时确认收货',
  processing: '售后处理中，请继续跟进',
  pending_refund: '待退款，请留意退款进度',
  rejected: '售后申请已拒绝',
  completed: '售后申请已完成',
  cancelled: '售后申请已取消',
  pending: '请及时处理该售后申请',
  approved: '售后申请已通过，请继续处理后续流程',
  seller_reviewing: '正在验货，请及时完成验货',
  seller_returning: '正在将商品寄回，请留意物流信息',
  buyer_receiving: '商品已寄回，等待买家确认收货',
  intercepting: '正在拦截快递，请根据拦截结果进行后续处理'
};

export const EXCHANGE_TYPES = ['exchange', 'quality_exchange'];

/**
 * 换货流程中部分状态文案与退货寄回不同
 */
export function getExchangeStatusText(status, type, defaultText) {
  if (!EXCHANGE_TYPES.includes(type)) return defaultText;
  if (status === 'seller_returning') return '待商家发新货';
  if (status === 'buyer_receiving') return '待买家收新货';
  return defaultText;
}

export function getExchangeStatusDesc(status, type, defaultDesc) {
  if (!EXCHANGE_TYPES.includes(type)) return defaultDesc;
  if (status === 'seller_returning') return '商家即将寄出换新商品，请留意物流信息';
  if (status === 'buyer_receiving') return '商家已寄出换新商品，请注意查收并确认收货';
  return defaultDesc;
}

export function getAfterSalesStatusText(status, type) {
  const base = STATUS_TEXT_MAP[status] || status || '';
  return getExchangeStatusText(status, type, base);
}

export function getAfterSalesStatusDesc(status, type, forAdmin = false) {
  const map = forAdmin ? STATUS_DESC_MAP_ADMIN : STATUS_DESC_MAP;
  const base = map[status] || '';
  if (forAdmin) {
    if (!EXCHANGE_TYPES.includes(type)) return base;
    if (status === 'seller_returning') return '即将寄出换新商品，请填写寄回单号';
    if (status === 'buyer_receiving') return '换新商品已寄出，等待买家确认收货';
    return base;
  }
  return getExchangeStatusDesc(status, type, base);
}

export function getAfterSalesTypeText(type) {
  return TYPE_TEXT_MAP[type] || type || '';
}
