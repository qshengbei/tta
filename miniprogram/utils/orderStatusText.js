/**
 * 订单状态文案唯一真源
 *
 * 订单列表、订单详情等页面统一调用，避免各处各写一份 status → 文案 的 switch。
 */

/**
 * 获取订单状态文案
 *
 * @param {string} status - 订单主状态（pending/paid/shipping/delivered/completed/refund/refund_completed/cancelled）
 * @param {string} [deliveryType] - 配送方式：express（快递）/ pickup（自提）/ local（同城），默认 express。
 *        注意：自提只有 pending/paid/completed/cancelled 四个状态，不会出现 shipping/delivered
 *        （updateOrderStatus 禁止自提订单发货，确认收货时自提直接置为 completed），见根目录「订单状态.md」。
 * @param {Object} [options]
 * @param {boolean} [options.useLogisticsStateForShipping] - express 运输中时用物流节点名替代「待收货」。
 *        订单列表传 true（无节点名时回落「已发货」）；订单详情不传，固定显示「待收货」，保持与详情页主状态一致。
 * @param {string} [options.logisticsStateName] - 物流节点名，仅当 useLogisticsStateForShipping 为 true 时使用
 * @param {string} [options.afterSalesResult] - 售后结果，用于 refund_completed 细分及「（部分退款）/（整单退款）」后缀
 * @param {string} [options.afterSalesStatus] - 售后进行中状态；仅管理端传，为 pending/processing 时 completed 显示「售后中」
 * @returns {string} 状态文案
 */
export function getOrderStatusText(status, deliveryType, options) {
  const type = deliveryType || 'express';
  const opts = options || {};
  const result = opts.afterSalesResult || '';
  let text = '';

  switch (status) {
    case 'pending':
      text = '待支付';
      break;
    case 'paid':
      if (type === 'express') {
        text = '待发货';
      } else if (type === 'pickup') {
        text = '待自提';
      } else if (type === 'local') {
        text = '待配送';
      } else {
        text = '已支付';
      }
      break;
    case 'shipping':
      if (type === 'express') {
        text = opts.useLogisticsStateForShipping
          ? (opts.logisticsStateName || '已发货')
          : '待收货';
      } else if (type === 'local') {
        text = '配送中';
      } else {
        // 自提不会进入 shipping，此处仅为兜底
        text = '已发货';
      }
      break;
    case 'delivered':
      if (type === 'express') {
        text = '已签收，待确认收货';
      } else if (type === 'local') {
        text = '已送达，待确认收货';
      } else {
        // 自提不会进入 delivered，此处仅为兜底
        text = '已送达';
      }
      break;
    case 'completed':
      // 订单状态显示"已完成"，售后结果不覆盖主状态（淘宝做法）
      // 例外：管理端在售后进行中时显示「售后中」（需显式传 afterSalesStatus）
      if (opts.afterSalesStatus === 'pending' || opts.afterSalesStatus === 'processing') {
        text = '售后中';
      } else {
        text = '已完成';
      }
      break;
    case 'refund':
      text = '售后处理中';
      break;
    case 'refund_completed':
      // 根据售后结果显示更详细的状态
      if (result.includes('部分')) {
        text = '部分退款';
      } else if (result.includes('换货')) {
        text = '换货完成';
      } else if (result.includes('退款')) {
        text = '退款完成';
      } else {
        text = '售后完成';
      }
      break;
    case 'cancelled':
      text = '已取消';
      break;
    default:
      text = '未知状态';
  }

  // 部分退款时在主状态后追加提示（订单可能恢复为 delivered/completed/shipping）
  if (result.includes('部分') && status !== 'refund_completed') {
    text = `${text}（部分退款）`;
  } else if (result === '整单退款' && status === 'refund') {
    // 拦截成功等整单退款场景：退款到账前显示"售后处理中（整单退款）"
    text = `${text}（整单退款）`;
  }

  return text;
}
