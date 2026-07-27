const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event, context) => {
  console.log('=== 定时任务：处理待退款记录 ===')
  
  try {
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
          console.log(`退款处理成功: ${record._id}`)
          
          await updateAfterSalesAndOrderStatus(record)
        } else {
          failCount++
          console.error(`退款处理失败: ${record._id}, 错误: ${result.result?.error}`)
        }
      } catch (error) {
        failCount++
        console.error(`处理退款记录异常: ${record._id}, 错误: ${error.message}`)
      }
    }
    
    console.log(`=== 定时任务完成 ===`)
    console.log(`成功: ${successCount}, 失败: ${failCount}`)
    
    return {
      success: true,
      message: `定时任务完成，成功 ${successCount} 条，失败 ${failCount} 条`,
      processedCount: records.length,
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
    
    const activeStatuses = ['submitted', 'reviewing', 'waiting_buyer_return', 'waiting_seller_receive', 'pending_refund', 'pending', 'intercepting']
    const otherActiveCases = await db.collection('after_sales_cases').where({
      orderId: refundRecord.orderId,
      caseStatus: db.command.in(activeStatuses),
      _id: db.command.neq(refundRecord.caseId)
    }).get()
    
    const hasOtherActiveCases = otherActiveCases.data && otherActiveCases.data.length > 0
    console.log(`是否有其他进行中的售后单: ${hasOtherActiveCases}`)
    
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
      
      const caseStatus = 'completed'
      const orderStatusInfo = mapCaseStatusToOrderStatus(caseStatus, afterSalesCase.orderStatus || '', allOrderCaseItems, [])
      
      await transaction.collection('after_sales_cases').doc(refundRecord.caseId).update({
        data: {
          caseStatus: 'completed',
          updatedAt: now,
          completedAt: now
        }
      })
      
      if (refundRecord.orderId) {
        const finalStatus = hasOtherActiveCases ? 'refund' : orderStatusInfo.status
        
        await transaction.collection('orders').doc(refundRecord.orderId).update({
          data: {
            status: finalStatus,
            afterSalesStatus: orderStatusInfo.afterSalesStatus || '',
            afterSalesResult: orderStatusInfo.afterSalesResult || '',
            updatedAt: now,
            updatedAtTs: now.getTime()
          }
        })
        
        console.log(`订单状态更新为: ${finalStatus} (有其他售后单: ${hasOtherActiveCases})`)
      }
    })
    
    console.log('售后单和订单状态更新成功')
  } catch (error) {
    console.error('更新售后单和订单状态失败:', error)
  }
}

function mapCaseStatusToOrderStatus(caseStatus, originalOrderStatus, caseItems, orderProducts) {
  if (caseStatus === 'completed') {
    const hasExchangeAfterSales = caseItems.some(item => 
      ['exchange', 'quality_exchange'].includes(String(item.afterSalesType || ''))
    )
    
    return {
      status: hasExchangeAfterSales ? 'completed' : 'refund_completed',
      afterSalesStatus: 'completed',
      afterSalesResult: hasExchangeAfterSales ? '换货完成' : '退款完成'
    }
  }
  
  return {
    status: 'refund',
    afterSalesStatus: 'processing'
  }
}
