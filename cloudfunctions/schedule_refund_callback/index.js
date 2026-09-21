const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

const { logOrderOperation } = require('./common/orderLogHelper')

// 售后明细的"进行中"状态（含换货发新货/寄回原货环节），任一明细处于这些状态时订单保持售后中
const ACTIVE_AFTER_SALES_ITEM_STATUSES = [
  'submitted', 'pending', 'approved', 'reviewing',
  'waiting_buyer_return', 'waiting_seller_receive',
  'seller_received', 'seller_reviewing',
  'seller_returning', 'buyer_receiving',
  'pending_refund', 'intercepting'
];
const EXCHANGE_TYPES = ['exchange', 'quality_exchange'];
const REFUND_TYPES = ['refund', 'quality_refund', 'return_refund', 'quality_return_refund', 'refund_received', 'refund_not_received'];

function roundAmount(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// 退款金额判定容差（金额按分四舍五入）
const REFUND_AMOUNT_TOLERANCE = 0.01;

// 订单全部商品行的可退总额（商品金额，不含配送费）
function calcOrderProductsPayable(orderProducts) {
  return roundAmount((Array.isArray(orderProducts) ? orderProducts : []).reduce((sum, p) => {
    const qty = Number(p.quantity || p.buyQty || p.count || 0) || 0;
    const line = Number(p.lineAmount ?? p.payableAmount ?? 0) || 0;
    if (line > 0) {
      return sum + line;
    }
    const price = Number(p.price ?? p.productPrice ?? p.unitPrice ?? 0) || 0;
    return sum + price * qty;
  }, 0));
}

// 单条明细当前承诺的退款金额：已核准取核准额，进行中尚无核准额时取申请额
function getItemCommittedRefundAmount(item) {
  const approved = Number(item?.approvedRefundAmount || 0) || 0;
  if (approved > 0) {
    return roundAmount(approved);
  }
  return roundAmount(Number(item?.applyRefundAmount || 0) || 0);
}

// 明细集合承诺退款金额合计（跨代累计：部分退款+补差应累加）
function calcCommittedRefundAmount(items) {
  return roundAmount((Array.isArray(items) ? items : [])
    .filter((item) => !['cancelled', 'rejected'].includes(String(item?.itemStatus || '')))
    .reduce((sum, item) => sum + getItemCommittedRefundAmount(item), 0));
}

// 已完成明细实际到账退款金额合计（跨代累计）
function calcCompletedRefundAmount(items) {
  return roundAmount((Array.isArray(items) ? items : [])
    .filter((item) => !['cancelled', 'rejected'].includes(String(item?.itemStatus || ''))
      && String(item.itemStatus || '') === 'completed')
    .reduce((sum, item) => sum + (Number(item.approvedRefundAmount || 0) || 0), 0));
}

// 有效售后明细中已承诺/已生效的运费扣减（买家责任整单退的包邮差额；运费整单只扣一次）
// 该扣减已内扣在商品退款额中（净额口径），属于买家已承担、已结算的金额
function calcCommittedShippingDeduction(items) {
  return roundAmount((Array.isArray(items) ? items : []).reduce((sum, item) => {
    const status = String(item?.itemStatus || '');
    if (status === 'cancelled' || status === 'rejected') {
      return sum;
    }
    const approved = Number(item?.approvedShippingDeductionAmount || 0) || 0;
    const applied = Number(item?.applyShippingDeductionAmount || 0) || 0;
    return sum + (approved > 0 ? approved : applied);
  }, 0));
}

// 已完成明细中已 settled 的运费扣减（仅 completed 明细计入已到账口径）
function calcCompletedShippingDeduction(items) {
  return roundAmount((Array.isArray(items) ? items : [])
    .filter((item) => !['cancelled', 'rejected'].includes(String(item?.itemStatus || ''))
      && String(item?.itemStatus || '') === 'completed')
    .reduce((sum, item) => sum + (Number(item?.approvedShippingDeductionAmount || 0) || 0), 0));
}

function calcOrderTotalQty(orderProducts) {
  return (orderProducts && orderProducts.length ? orderProducts : []).reduce(
    (sum, p) => sum + (Number(p.quantity || p.buyQty || p.count || 0) || 0), 0);
}

// 聚合订单"已完成件数"时的跨代去重（换货新货二次售后场景）：
// 同一 orderItemId 存在更高代数有效明细时，旧代数已完成换货明细不再计数
function calcEffectiveCompletedQty(items) {
  const maxGenerationMap = {};
  (Array.isArray(items) ? items : []).forEach((item) => {
    const status = String(item.itemStatus || '');
    if (status === 'cancelled' || status === 'rejected') {
      return;
    }
    const key = String(item.orderItemId || '');
    if (!key) {
      return;
    }
    const gen = Number(item.afterSalesGeneration || 0) || 1;
    if (gen > (maxGenerationMap[key] || 1)) {
      maxGenerationMap[key] = gen;
    }
  });
  return (Array.isArray(items) ? items : [])
    .filter((item) => String(item.itemStatus || '') === 'completed')
    .reduce((sum, item) => {
      const key = String(item.orderItemId || '');
      const gen = Number(item.afterSalesGeneration || 0) || 1;
      if (key && (maxGenerationMap[key] || 1) > gen) {
        return sum;
      }
      return sum + (Number(item.applyQty || 0) || 0);
    }, 0);
}

// 同一 orderItemId 仅保留最高代数的有效明细（二次售后取代第1代换货）
function pickEffectiveAfterSalesItems(validItems) {
  const maxGenerationMap = {};
  (Array.isArray(validItems) ? validItems : []).forEach((item) => {
    const key = String(item.orderItemId || '');
    if (!key) {
      return;
    }
    const gen = Number(item.afterSalesGeneration || 0) || 1;
    if (gen > (maxGenerationMap[key] || 1)) {
      maxGenerationMap[key] = gen;
    }
  });
  return (Array.isArray(validItems) ? validItems : []).filter((item) => {
    const key = String(item.orderItemId || '');
    if (!key) {
      return true;
    }
    return (Number(item.afterSalesGeneration || 0) || 1) >= (maxGenerationMap[key] || 1);
  });
}

/**
 * 标准化 afterSalesResult 文案（与 updateOrderStatus.buildAfterSalesResult 保持一致，
 * 云函数独立部署无法跨目录 require，只能保持同一份规则）
 */
function buildAfterSalesResult(caseItems, orderProducts) {
  if (!caseItems || caseItems.length === 0) return '';

  const validItems = caseItems.filter(item => !['cancelled', 'rejected'].includes(String(item.itemStatus || '')));
  if (validItems.length === 0) return '';

  const exchangeCount = validItems.filter(item => EXCHANGE_TYPES.includes(String(item.afterSalesType || ''))).length;
  const refundCount = validItems.filter(item => REFUND_TYPES.includes(String(item.afterSalesType || ''))).length;
  const totalApprovedRefundAmount = validItems.reduce((sum, item) => sum + (Number(item.approvedRefundAmount || 0) || 0), 0);

  const totalOrderQty = calcOrderTotalQty(orderProducts);
  // 已纳入退款范围的件数（待退款/退款中/已完成都算，拦截成功自动补退的明细此时是 pending_refund）
  const coveredRefundQty = validItems
    .filter(item => REFUND_TYPES.includes(String(item.afterSalesType || '')))
    .reduce((sum, item) => sum + (Number(item.applyQty || 0) || 0), 0);
  const completedRefundQty = validItems
    .filter(item => REFUND_TYPES.includes(String(item.afterSalesType || '')) && String(item.itemStatus || '') === 'completed')
    .reduce((sum, item) => sum + (Number(item.applyQty || 0) || 0), 0);

  // 金额口径：可退总额、承诺/到账金额（跨代累计，支持部分退款后补差）
  // 买家责任整单退款承担的原运费扣减（包邮差额）也属于已结算金额，计入覆盖判定，
  // 否则净额（可退已内扣运费）会比商品总额少一个运费，被误判为"部分退款"
  const totalPayableAmount = calcOrderProductsPayable(orderProducts);
  const committedRefundAmount = calcCommittedRefundAmount(validItems);
  const completedRefundAmount = calcCompletedRefundAmount(validItems);
  const settledCommittedDeduction = calcCommittedShippingDeduction(validItems);
  const settledCompletedDeduction = calcCompletedShippingDeduction(validItems);
  const isRefundAmountFullyCovered = totalPayableAmount > 0
    && committedRefundAmount + settledCommittedDeduction >= totalPayableAmount - REFUND_AMOUNT_TOLERANCE;
  const isRefundAmountFullyCompleted = totalPayableAmount > 0
    && completedRefundAmount + settledCompletedDeduction >= totalPayableAmount - REFUND_AMOUNT_TOLERANCE;

  if (exchangeCount > 0 && refundCount === 0) {
    return '换货完成';
  }
  if (refundCount > 0 && exchangeCount === 0) {
    if (totalApprovedRefundAmount > 0 || committedRefundAmount > 0) {
      // 件数全覆盖且金额退满：全部到账 → 退款完成；仍有在途明细 → 整单退款；
      // 件数未全覆盖或金额未退满（单件部分金额退款）→ 部分退款
      if (totalOrderQty > 0 && coveredRefundQty >= totalOrderQty) {
        if (completedRefundQty >= totalOrderQty && isRefundAmountFullyCompleted) {
          return '退款完成';
        }
        if (isRefundAmountFullyCovered) {
          return '整单退款';
        }
      }
      return '部分退款';
    }
    return '售后完成';
  }
  if (exchangeCount > 0 && refundCount > 0) {
    return totalApprovedRefundAmount > 0 ? '部分退款' : '售后完成';
  }

  const totalProductCount = orderProducts && orderProducts.length ? orderProducts.length : 1;
  const validIndices = new Set(validItems.map(item => String(item.orderItemIndex)));
  const allProductsHaveAfterSales = orderProducts && orderProducts.length
    ? orderProducts.every((_, index) => validIndices.has(String(index)))
    : true;
  if (!allProductsHaveAfterSales) {
    return '部分退款';
  }
  if (totalApprovedRefundAmount > 0) {
    const coveredQty = validItems.reduce((sum, item) => sum + (Number(item.applyQty || 0) || 0), 0);
    const completedQty = validItems
      .filter(item => String(item.itemStatus || '') === 'completed')
      .reduce((sum, item) => sum + (Number(item.applyQty || 0) || 0), 0);
    if (totalOrderQty > 0 && coveredQty >= totalOrderQty) {
      if (completedQty >= totalOrderQty && isRefundAmountFullyCompleted) {
        return '退款完成';
      }
      if (isRefundAmountFullyCovered) {
        return '整单退款';
      }
    }
    return '部分退款';
  }
  return '售后完成';
}

/**
 * 跨订单全部售后明细聚合订单状态（与 updateOrderStatus.buildOrderUpdateForAfterSales 规则一致）：
 * 1. 任一明细进行中 → refund；2. 全部取消/拒绝 → 恢复原状态；
 * 3. 仅部分件数完成 → 恢复原状态；4. 全部件数完成 → 换货/零退款 completed，纯退款 refund_completed
 */
function buildOrderUpdateForAfterSales(order, allOrderCaseItems, now) {
  const updateData = {
    updatedAt: now,
    updatedAtTs: now instanceof Date ? now.getTime() : Date.now()
  };

  const items = Array.isArray(allOrderCaseItems) ? allOrderCaseItems : [];
  const activeItems = items.filter(item =>
    ACTIVE_AFTER_SALES_ITEM_STATUSES.includes(String(item.itemStatus || '')));

  if (activeItems.length > 0) {
    const hasIntercepting = activeItems.some(item => String(item.itemStatus) === 'intercepting');
    updateData.status = 'refund';
    updateData.afterSalesStatus = hasIntercepting ? 'intercepting' : 'processing';
    const aggregatedResult = buildAfterSalesResult(items, order.products);
    if (aggregatedResult) {
      updateData.afterSalesResult = aggregatedResult;
      updateData.afterSalesProcessTime = now;
    }
    return updateData;
  }

  const validItems = items.filter(item =>
    !['cancelled', 'rejected'].includes(String(item.itemStatus || '')));
  const totalOrderQty = calcOrderTotalQty(order.products);
  // 跨代去重：第2代售后存在时，第1代已完成换货件不重复计数
  const completedQty = calcEffectiveCompletedQty(items);

  if (validItems.length === 0) {
    updateData.status = order.originalStatusBeforeRefund || 'completed';
    updateData.afterSalesStatus = 'cancelled';
    updateData.afterSalesResult = '';
    updateData.afterSalesProcessTime = now;
    return updateData;
  }

  // 终结状态以每个商品的最高代数明细为准（二次售后取代第1代换货）
  const effectiveItems = pickEffectiveAfterSalesItems(validItems);

  if (totalOrderQty > 0 && completedQty < totalOrderQty) {
    updateData.status = order.originalStatusBeforeRefund || 'completed';
    updateData.afterSalesStatus = 'completed';
  } else {
    const hasExchangeAfterSales = effectiveItems.some(item =>
      EXCHANGE_TYPES.includes(String(item.afterSalesType || '')));
    // 退款金额跨代累计（第1代部分退款+第2代补差），不能只算最高代明细
    const totalApprovedAmount = calcCompletedRefundAmount(validItems);
    // 买家责任整单退款承担的原运费已内扣在商品退款额中，属于已结算金额，需计入退满判定
    const totalPayableAmount = calcOrderProductsPayable(order.products);
    const settledDeduction = calcCompletedShippingDeduction(validItems);
    const isFullyRefunded = totalApprovedAmount > 0
      && totalPayableAmount > 0
      && totalApprovedAmount + settledDeduction >= totalPayableAmount - REFUND_AMOUNT_TOLERANCE;
    // 换货/零退款 → completed；纯退款且金额退满 → refund_completed；
    // 纯退款但金额未退满（单件部分金额退款）→ 恢复原状态，剩余金额仍可补差
    if (hasExchangeAfterSales || totalApprovedAmount <= 0) {
      updateData.status = 'completed';
    } else if (isFullyRefunded) {
      updateData.status = 'refund_completed';
    } else {
      updateData.status = order.originalStatusBeforeRefund || 'completed';
    }
    updateData.afterSalesStatus = 'completed';
  }

  // 文案聚合传全量有效明细：金额需跨代累计
  const resultText = buildAfterSalesResult(validItems, order.products);
  if (resultText) {
    updateData.afterSalesResult = resultText;
    updateData.afterSalesProcessTime = now;
  }
  return updateData;
}

const BANK_CARD_DELAY_MS = 30 * 1000 // 模拟银行卡到账延迟：30秒

exports.main = async (event, context) => {
  console.log('=== 定时任务：模拟微信退款回调 ===')
  
  try {
    const processingRefunds = await db.collection('refund_records')
      .where({
        status: 'processing'
      })
      .orderBy('processingTime', 'asc')
      .limit(100)
      .get()
    
    const records = processingRefunds.data || []
    console.log(`找到 ${records.length} 条处理中退款记录`)
    
    if (records.length === 0) {
      console.log('没有处理中的退款记录，任务结束')
      return {
        success: true,
        message: '没有处理中的退款记录',
        processedCount: 0
      }
    }
    
    let successCount = 0
    let failCount = 0
    const now = new Date()
    
    for (const record of records) {
      console.log(`处理退款记录: ${record._id}, 银行类型: ${record.bankType}`)
      
      try {
        const shouldCallback = shouldTriggerCallback(record, now)
        
        if (!shouldCallback) {
          console.log(`退款记录 ${record._id} 尚未到回调时间，跳过`)
          continue
        }
        
        let message = '退款已原路退回，预计1-3个工作日到账'
        if (record.bankType === 'CFT') {
          message = '退款已原路退回微信零钱，实时到账'
        } else if (record.bankType) {
          message = '退款已原路退回银行卡，预计1-3个工作日到账'
        }
        
        await db.runTransaction(async (transaction) => {
          await transaction.collection('refund_records').doc(record._id).update({
            data: {
              status: 'success',
              result: '退款成功',
              message: message,
              completeTime: now,
              callbackTime: now,
              lastRetryTime: now
            }
          })
        })
        
        console.log(`退款回调成功: ${record._id}, 状态更新为 success`)
        
        await updateAfterSalesAndOrderStatus(record)
        
        successCount++
      } catch (error) {
        failCount++
        console.error(`退款回调处理失败: ${record._id}, 错误: ${error.message}`)
      }
    }
    
    console.log(`=== 模拟回调任务完成 ===`)
    console.log(`成功: ${successCount}, 失败: ${failCount}`)
    
    return {
      success: true,
      message: `回调处理完成，成功 ${successCount} 条，失败 ${failCount} 条`,
      processedCount: records.length,
      successCount,
      failCount
    }
  } catch (error) {
    console.error('回调任务执行异常:', error)
    return {
      success: false,
      error: error.message,
      processedCount: 0
    }
  }
}

function shouldTriggerCallback(record, now) {
  if (record.bankType === 'CFT') {
    return true
  }
  
  if (record.processingTime) {
    const processingTs = new Date(record.processingTime).getTime()
    const elapsed = now.getTime() - processingTs
    return elapsed >= BANK_CARD_DELAY_MS
  }
  
  return true
}

async function updateAfterSalesAndOrderStatus(refundRecord) {
  console.log(`更新售后单和订单状态: caseId=${refundRecord.caseId}, orderId=${refundRecord.orderId}`)
  
  if (!refundRecord.caseId) {
    console.log('没有 caseId，跳过更新')
    return
  }
  
  try {
    const caseRes = await db.collection('after_sales_cases').doc(refundRecord.caseId).get()
    const afterSalesCase = caseRes.data
    
    if (!afterSalesCase) {
      console.log('售后单不存在')
      return
    }
    
    const now = new Date()

    // 事务前读取订单原状态，用于记录订单操作日志
    let orderBefore = null
    if (refundRecord.orderId) {
      try {
        const orderRes = await db.collection('orders').doc(refundRecord.orderId).get()
        orderBefore = orderRes.data
      } catch (e) {
        console.warn('读取订单原状态失败:', e)
      }
    }

    let finalStatus = orderBefore?.status || ''

    await db.runTransaction(async (transaction) => {
      const caseItemsRes = await transaction.collection('after_sales_case_items')
        .where({ caseId: refundRecord.caseId })
        .limit(100)
        .get()
      const caseItems = caseItemsRes.data || []
      
      await Promise.all(caseItems.map(item => 
        transaction.collection('after_sales_case_items').doc(item._id).update({
          data: {
            itemStatus: 'completed',
            updatedAt: now
          }
        })
      ))
      
      const orderCaseItemsRes = await transaction.collection('after_sales_case_items')
        .where({ orderId: refundRecord.orderId })
        .limit(100)
        .get()
      const allOrderCaseItems = orderCaseItemsRes.data || []

      // 查询订单完整文档（件数对比、恢复售后前状态、结果文案聚合都依赖它）
      let orderDoc = null
      try {
        const orderRes = await transaction.collection('orders').doc(refundRecord.orderId).get()
        orderDoc = orderRes.data
      } catch (e) {
        console.warn('查询订单失败，跳过订单状态聚合:', e)
      }

      if (orderDoc) {
        const hasOtherActiveCases = allOrderCaseItems.some(item =>
          String(item.caseId || '') !== String(refundRecord.caseId) &&
          ACTIVE_AFTER_SALES_ITEM_STATUSES.includes(String(item.itemStatus || '')))
        console.log(`是否有其他进行中的售后明细: ${hasOtherActiveCases}`)
        console.log('退款件数对比:', JSON.stringify({
          totalOrderQty: calcOrderTotalQty(orderDoc.products),
          completedQty: allOrderCaseItems.filter(i => String(i.itemStatus) === 'completed').reduce((s, i) => s + (Number(i.applyQty || 0) || 0), 0),
          originalStatusBeforeRefund: orderDoc.originalStatusBeforeRefund || ''
        }))
      }

      await transaction.collection('after_sales_cases').doc(refundRecord.caseId).update({
        data: {
          caseStatus: 'completed',
          updatedAt: now,
          completedAt: now
        }
      })

      if (orderDoc) {
        // 与 updateOrderStatus 共用同一套聚合规则：换货明细仍在进行时订单保持售后中，
        // 退款+换货混合时结果文案稳定为"部分退款"，避免各云函数各算各的导致文案闪烁
        const orderUpdateData = buildOrderUpdateForAfterSales(orderDoc, allOrderCaseItems, now)
        finalStatus = orderUpdateData.status

        await transaction.collection('orders').doc(refundRecord.orderId).update({
          data: orderUpdateData
        })

        console.log(`订单状态更新为: ${finalStatus}`)
      }
    })

    console.log('售后单和订单状态更新成功')

    // 退款到账同步写售后级日志，售后详情页操作记录从"进入待退款"推进到"完成退款"
    await db.collection('after_sales_logs').add({
      data: {
        caseId: refundRecord.caseId,
        orderId: refundRecord.orderId || '',
        operatorId: '',
        operatorType: 'system',
        action: 'complete_refund',
        beforeStatus: afterSalesCase.caseStatus,
        afterStatus: 'completed',
        note: refundRecord.message || `退款 ${refundRecord.amount || 0} 元已原路退回`,
        extra: {
          caseNo: afterSalesCase.caseNo,
          refundId: refundRecord._id,
          amount: refundRecord.amount || 0
        },
        createdAt: now
      }
    })

    // 退款到账是订单级里程碑事件，写入订单操作日志
    if (refundRecord.orderId) {
      // 附带售后商品明细，便于多商品订单区分不同商品的退款记录
      let refundItems = []
      if (refundRecord.caseId) {
        try {
          const caseItemsRes = await db.collection('after_sales_case_items')
            .where({ caseId: refundRecord.caseId })
            .limit(100)
            .get()
          refundItems = (caseItemsRes.data || []).map(item => ({
            // after_sales_case_items 表的商品名/sku 存放在 Snapshot 后缀字段中
            orderItemIndex: item.orderItemIndex,
            productName: item.productName || item.productNameSnapshot || '',
            skuName: item.skuName || item.skuNameSnapshot || '',
            applyQty: item.applyQty || 0
          }))
        } catch (e) {
          console.warn('获取售后明细用于操作日志失败:', e)
        }
      }

      await logOrderOperation(db, {
        orderId: refundRecord.orderId,
        orderNumber: orderBefore?.orderNumber || '',
        openid: orderBefore?._openid || '',
        action: 'complete_refund',
        fromStatus: orderBefore?.status || '',
        toStatus: finalStatus,
        operatorType: 'system',
        operatorId: '',
        operatorName: '系统',
        reason: refundRecord.message || `退款 ${refundRecord.amount || 0} 元已原路退回`,
        remark: '',
        detail: {
          caseId: refundRecord.caseId,
          refundId: refundRecord._id,
          amount: refundRecord.amount || 0,
          items: refundItems
        }
      })
    }
  } catch (error) {
    console.error('更新售后单和订单状态失败:', error)
  }
}
