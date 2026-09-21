const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 售后明细的"进行中"状态（含换货发新货/寄回原货环节），任一明细处于这些状态时订单保持售后中
const ACTIVE_AFTER_SALES_ITEM_STATUSES = [
  'submitted', 'pending', 'approved', 'reviewing',
  'waiting_buyer_return', 'waiting_seller_receive',
  'seller_received', 'seller_reviewing',
  'seller_returning', 'buyer_receiving',
  'pending_refund', 'intercepting'
]
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

exports.main = async (event, context) => {
  console.log('=== 定时任务：处理待退款记录 ===')
  
  try {
    // 步骤0：退款链路对账自愈。
    // 正常链路是"审核事务提交 → 事务外创建 refund_records → 本任务扫描打款"。
    // 若事务提交成功但退款记录创建缺失（如云函数调用失败、历史代码用事务前快照
    // 计算金额导致应退为 0），案件会停在 pending_refund 而本任务只扫 refund_records，
    // 形成永久卡死的孤儿案件。这里按案件兜底补建，使其重新进入打款队列。
    const reconcile = await reconcilePendingRefundCases()

    const pendingRefunds = await db.collection('refund_records')
      .where({
        status: 'pending'
      })
      .orderBy('createTime', 'asc')
      .limit(100)
      .get()
    
    const records = pendingRefunds.data || []
    console.log(`找到 ${records.length} 条待退款记录`)
    
    if (records.length === 0) {
      console.log('没有待退款记录，任务结束')
      return {
        success: true,
        message: '没有待退款记录',
        processedCount: 0
      }
    }
    
    let successCount = 0
    let failCount = 0
    const processedRecords = [] // 本次成功受理（pending→processing）的退款记录

    for (const record of records) {
      console.log(`处理退款记录: ${record._id}, 金额: ${record.amount}`)

      try {
        const result = await cloud.callFunction({
          name: 'refund',
          data: {
            action: 'process',
            refundId: record._id
          }
        })

        if (result.result?.success) {
          successCount++
          processedRecords.push(record)
          console.log(`退款受理成功: ${record._id}，状态已更新为 processing，等待回调`)
        } else {
          failCount++
          console.error(`退款处理失败: ${record._id}, 错误: ${result.result?.error}`)
        }
      } catch (error) {
        failCount++
        console.error(`处理退款记录异常: ${record._id}, 错误: ${error.message}`)
      }
    }

    // 链式触发回调：处理完成后直接调用 schedule_refund_callback，
    // 不再等待下一个5分钟定时周期（原最坏要等10分钟）
    if (processedRecords.length > 0) {
      // 银行卡退款模拟30秒到账延迟，等待31秒让回调的到账时间判断通过
      const hasBankCardRefund = processedRecords.some(r => r.bankType && r.bankType !== 'CFT')
      if (hasBankCardRefund) {
        console.log('存在银行卡退款，等待31秒模拟到账延迟后再触发回调')
        await new Promise(resolve => setTimeout(resolve, 31 * 1000))
      }
      try {
        console.log('链式触发 schedule_refund_callback')
        await cloud.callFunction({
          name: 'schedule_refund_callback',
          data: { trigger: 'chained_by_schedule_refund' }
        })
        console.log('链式回调触发完成')
      } catch (callbackError) {
        // 链式触发失败不影响主流程，下个定时周期（≤5分钟）仍会兜底处理
        console.error('链式触发回调失败，将由定时任务兜底:', callbackError.message)
      }
    }

    console.log(`=== 定时任务完成 ===`)
    console.log(`对账补建: ${reconcile.rebuilt}/${reconcile.scanned}，成功: ${successCount}, 失败: ${failCount}`)
    
    return {
      success: true,
      message: `定时任务完成，对账补建 ${reconcile.rebuilt} 条，成功 ${successCount} 条，失败 ${failCount} 条`,
      processedCount: records.length,
      reconciledCount: reconcile.rebuilt,
      successCount,
      failCount
    }
  } catch (error) {
    console.error('定时任务执行异常:', error)
    return {
      success: false,
      error: error.message,
      processedCount: 0
    }
  }
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

        await transaction.collection('orders').doc(refundRecord.orderId).update({
          data: orderUpdateData
        })

        console.log(`订单状态更新为: ${orderUpdateData.status} (${orderUpdateData.afterSalesStatus}/${orderUpdateData.afterSalesResult || ''})`)
      }
    })
    
    console.log('售后单和订单状态更新成功')
  } catch (error) {
    console.error('更新售后单和订单状态失败:', error)
  }
}

/**
 * 退款链路对账自愈：
 * 找出 caseStatus=pending_refund 但 refund_records 中无活跃记录（pending/processing/success）
 * 的孤儿案件，按明细核准口径重算应退金额并补建退款记录。
 * 幂等：存在任一活跃记录即跳过；failed 记录不阻塞补建。
 */
async function reconcilePendingRefundCases() {
  const caseRes = await db.collection('after_sales_cases')
    .where({ caseStatus: 'pending_refund' })
    .limit(20)
    .get()
  const cases = caseRes.data || []
  console.log(`[对账] 待退款案件 ${cases.length} 个，开始核对退款记录`)

  let rebuilt = 0
  for (const caseDoc of cases) {
    try {
      const [itemsRes, recordsRes, orderRes] = await Promise.all([
        db.collection('after_sales_case_items').where({ caseId: caseDoc._id }).limit(100).get(),
        db.collection('refund_records').where({
          caseId: caseDoc._id,
          status: db.command.in(['pending', 'processing', 'success'])
        }).limit(1).get(),
        db.collection('orders').doc(caseDoc.orderId).get().catch(() => ({ data: null }))
      ])

      // 已有活跃退款记录：正在排队/打款/已到账，无需补建
      if ((recordsRes.data || []).length > 0) {
        continue
      }

      // 应退金额口径与 updateOrderStatus 审核通过时一致：
      // 商品退款 + 应退发货运费 − 应扣发货运费（净额口径免扣）+ 寄回运费补偿
      const validItems = (itemsRes.data || []).filter(item =>
        !['cancelled', 'rejected'].includes(String(item.itemStatus || '')))
      const amount = roundAmount(validItems.reduce((sum, item) => {
        const deductionNetted = !!item.shippingDeductionNetted
        return sum
          + (Number(item.approvedRefundAmount || 0) || 0)
          + (Number(item.approvedShippingRefundAmount || 0) || 0)
          - (deductionNetted ? 0 : (Number(item.approvedShippingDeductionAmount || 0) || 0))
          + (Number(item.approvedReturnShippingCompensationAmount || 0) || 0)
      }, 0))

      if (!(amount > 0)) {
        console.warn(`[对账] 案件 ${caseDoc._id} 应退金额为 0，跳过（明细数 ${validItems.length}）`)
        continue
      }

      // 统一走 refund 云函数补建，保证落库结构与正常审核入口一致，下一轮即可被扫描打款
      const order = orderRes.data
      const createRes = await cloud.callFunction({
        name: 'refund',
        data: {
          action: 'create',
          orderId: caseDoc.orderId,
          caseId: caseDoc._id,
          amount,
          outTradeNo: order?.outTradeNo || order?.tradeNo || '',
          reason: '系统对账补建：售后审核通过待退款'
        }
      })

      if (!createRes.result?.success) {
        console.error(`[对账] 补建失败 案件 ${caseDoc._id}:`, createRes.result?.error)
        continue
      }

      rebuilt++
      console.log(`[对账] 已补建退款记录：案件 ${caseDoc._id}，金额 ${amount}`)
    } catch (err) {
      console.error(`[对账] 处理异常 案件 ${caseDoc._id}:`, err)
    }
  }

  console.log(`[对账] 完成，补建 ${rebuilt}/${cases.length}`)
  return { scanned: cases.length, rebuilt }
}

