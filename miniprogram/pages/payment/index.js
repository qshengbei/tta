import { getCollection } from "../../utils/cloud";
import { getPickupLocation } from "../../utils/order-utils";
import { calculateDistance, getAddressLocation } from "../../utils/map-utils";
const db = wx.cloud.database();
const _ = db.command;

Page({
  data: {
    totalPrice: 0,
    orderId: '',
    createTime: '',
    orderData: null,
    checkStatusTimer: null // 用于定时检查订单状态的定时器
  },

  onLoad(options) {
    // 从参数中获取订单ID
    const { orderId } = options;
    
    if (orderId) {
      // 保存订单ID到页面数据
      this.setData({ orderId });
      
      // 根据订单ID从数据库中获取订单信息
      const orders = getCollection("orders");
      orders.doc(orderId).get()
        .then((res) => {
          const order = res.data;
          if (order) {
            // 检查订单状态，如果已取消，跳转到已取消标签列表
            if (order.status === 'cancelled') {
              wx.showToast({
                title: '订单已过期',
                icon: 'none'
              });
              setTimeout(() => {
                this.navigateToCancelledOrderList(order.deliveryType);
              }, 1000);
              return;
            }
            
            this.setData({
              totalPrice: order.totalPrice || 0,
              orderId: order.orderNumber || this.generateOrderId(),
              createTime: this.formatDateTime(new Date()),
              orderData: {
                products: order.products,
                deliveryType: order.deliveryType,
                address: order.address,
                pickupCode: order.pickupCode,
                pickupTime: order.pickupTime
              }
            });
            
            // 启动定时检查订单状态
            this.startCheckOrderStatus(orderId, order.deliveryType);
          } else {
            this.setData({
              totalPrice: 0,
              orderId: this.generateOrderId(),
              createTime: this.formatDateTime(new Date()),
              orderData: null
            });
          }
        })
        .catch((err) => {
          console.error('获取订单信息失败', err);
          this.setData({
            totalPrice: 0,
            orderId: this.generateOrderId(),
            createTime: this.formatDateTime(new Date()),
            orderData: null
          });
        });
    } else {
      // 从参数中获取总金额和订单数据（兼容旧的跳转方式）
      const { totalPrice, orderData } = options;
      let parsedOrderData = null;
      if (orderData) {
        try {
          parsedOrderData = JSON.parse(decodeURIComponent(orderData));
        } catch (err) {
          console.error('解析订单数据失败', err);
        }
      }
      this.setData({
        totalPrice: parseFloat(totalPrice) || 0,
        orderId: this.generateOrderId(),
        createTime: this.formatDateTime(new Date()),
        orderData: parsedOrderData
      });
    }
  },

  // 启动定时检查订单状态
  startCheckOrderStatus(orderId, deliveryType) {
    // 每2秒检查一次订单状态
    this.data.checkStatusTimer = setInterval(() => {
      const orders = getCollection("orders");
      orders.doc(orderId).get()
        .then((res) => {
          const order = res.data;
          if (order && order.status === 'cancelled') {
            // 订单已取消，清除定时器并跳转
            this.clearCheckStatusTimer();
            wx.showToast({
              title: '订单已过期',
              icon: 'none'
            });
            setTimeout(() => {
              this.navigateToCancelledOrderList(deliveryType);
            }, 1000);
          }
        })
        .catch((err) => {
          console.error('检查订单状态失败', err);
        });
    }, 2000);
  },

  navigateToCancelledOrderList(deliveryType) {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.needRefreshOrderList = true;
    }

    const safeDeliveryType = deliveryType || '';
    wx.reLaunch({
      url: `/pages/order-list/index?status=cancelled&deliveryType=${safeDeliveryType}`
    });
  },

  // 清除订单状态检查定时器
  clearCheckStatusTimer() {
    if (this.data.checkStatusTimer) {
      clearInterval(this.data.checkStatusTimer);
      this.setData({ checkStatusTimer: null });
    }
  },

  // 页面卸载时清除定时器
  onUnload() {
    // 当用户点击默认返回按钮时，这里会被触发
    // 但需要注意，这里无法阻止页面卸载，只能执行一些清理操作
    console.log('支付页面卸载');
    this.clearCheckStatusTimer();
  },

  // 生成订单编号
  generateOrderId() {
    const date = new Date();
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `${year}${month}${day}${hours}${minutes}${seconds}${random}`;
  },

  // 格式化日期时间
  formatDateTime(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  },



  // 处理支付按钮点击
  async handlePayment() {
    console.log('点击了立即支付按钮');
    // 模拟微信支付
    wx.showLoading({
      title: '正在支付...'
    });

    // 检查订单数据是否存在
    if (!this.data.orderData) {
      console.error('订单数据不存在');
      wx.hideLoading();
      wx.showToast({
        title: '订单数据错误',
        icon: 'none'
      });
      return;
    }

    // 获取orders集合
    const orders = getCollection("orders");

    // 从参数中获取订单ID，判断是否是已存在的订单
    const { orderId } = this.options || {};
    console.log('支付页面的orderId参数:', orderId);
    
    if (orderId) {
      // 如果是已存在的订单，直接处理支付
      console.log('处理已存在订单的支付:', orderId);
      
      // 获取订单信息
      try {
        const orderRes = await orders.doc(orderId).get();
        const order = orderRes.data;
        
        if (!order) {
          console.error('订单不存在:', orderId);
          wx.hideLoading();
          wx.showToast({
            title: '订单不存在',
            icon: 'none'
          });
          return;
        }
        
        // 移除延迟，直接显示微信支付模态框
        wx.hideLoading();
        console.log('显示微信支付模态框');
        
        // 模拟微信支付弹窗，这里用confirm代替
        wx.showModal({
          title: '微信支付',
          content: '请完成微信支付',
          confirmText: '支付成功',
          cancelText: '关闭支付',
          success: (res) => {
            console.log('微信支付模态框操作:', res);
            if (res.confirm) {
              // 模拟支付成功
              wx.showToast({
                title: '支付成功',
                icon: 'success'
              });
              
              // 确保订单ID存在
              console.log('支付成功时的订单ID:', orderId);
              if (orderId) {
                // 模拟支付方式：随机选择零钱或银行卡
                const bankTypes = ['CFT', 'ICBC', 'ABC', 'BOC', 'CCB'];
                const bankType = bankTypes[Math.floor(Math.random() * bankTypes.length)];
                const tradeNo = `TN${Date.now()}${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
                
                // 先更新订单的支付方式和交易号
                const orders = getCollection("orders");
                orders.doc(orderId).update({
                  data: {
                    bankType: bankType,
                    tradeNo: tradeNo,
                    payTime: new Date(),
                    updatedAt: new Date(),
                    updatedAtTs: Date.now()
                  }
                }).then(() => {
                  console.log('订单支付方式更新成功');
                  // 更新订单状态为已支付（统一走云函数，自动发送通知）
                  this.updateOrderStatus(orderId, 'paid', new Date());
                  
                  // 更新订单数量缓存，状态从pending（待支付）更新为paid（已支付）
                  this.updateOrderCountCache(order.deliveryType, 'pending', 'paid');
                  
                  // 删除购物车中对应的商品（软删除）
                  this.deleteCartItems();
                }).catch(err => {
                  console.error('更新订单支付方式失败:', err);
                  // 即使更新支付方式失败，也继续处理支付
                  this.updateOrderStatus(orderId, 'paid', new Date());
                  this.updateOrderCountCache(order.deliveryType, 'pending', 'paid');
                  this.deleteCartItems();
                });
              } else {
                console.error('订单ID为空，无法更新订单状态');
              }
              
              // 跳转到支付成功页面
              setTimeout(() => {
                wx.redirectTo({
                  url: '/pages/payment-success/index?orderId=' + orderId + '&orderNumber=' + order.orderNumber
                });
              }, 1500);
            } else if (res.cancel) {
              // 模拟关闭支付弹窗
              // 显示确认弹窗
              wx.showModal({
                title: '是否放弃支付',
                content: '确定要放弃支付吗？订单将变为待支付状态。',
                success: (res) => {
                  console.log('放弃支付确认:', res);
                  if (res.confirm) {
                    // 检查订单状态，只有当订单状态为已支付时才更新为待支付
                    console.log('放弃支付时的订单ID:', orderId);
                    if (orderId) {
                      // 先获取订单当前状态
                      orders.doc(orderId).get()
                        .then(orderRes => {
                          const currentOrder = orderRes.data;
                          if (currentOrder) {
                            // 只有当订单状态为已支付或待支付时，才更新为待支付
                            if (currentOrder.status === 'paid' || currentOrder.status === 'pending') {
                              this.updateOrderStatus(orderId, 'pending');
                            } else {
                              console.log('订单状态已更新，无需操作:', currentOrder.status);
                            }
                          }
                          // 跳转到对应配送方式的待支付标签列表
                          // 使用 redirectTo 跳转到订单列表页面，这样当用户点击返回时，会回到商品详情页
                          wx.redirectTo({
                            url: `/pages/order-list/index?status=pending&deliveryType=${order.deliveryType}`
                          });
                        })
                        .catch(err => {
                          console.error('获取订单状态失败:', err);
                          // 即使获取订单状态失败，也跳转到订单列表页面
                          wx.redirectTo({
                            url: `/pages/order-list/index?status=pending&deliveryType=${order.deliveryType}`
                          });
                        });
                    } else {
                      // 跳转到对应配送方式的待支付标签列表
                      wx.redirectTo({
                        url: `/pages/order-list/index?status=pending&deliveryType=${order.deliveryType}`
                      });
                    }
                  }
                }
              });
            }
          }
        });
      } catch (err) {
        console.error('获取订单信息失败:', err);
        wx.hideLoading();
        wx.showToast({
          title: '获取订单信息失败',
          icon: 'none'
        });
      }
    } else {
      // 如果是新订单，先显示支付模态框，在用户确认后再创建订单
      console.log('处理新订单的支付');
      
      // 打印确认订单页面传递的订单数据
      console.log('确认订单页面传递的订单数据:', this.data.orderData);
      
      // 移除延迟，直接显示微信支付模态框
      wx.hideLoading();
      console.log('显示微信支付模态框');
      
      // 模拟微信支付弹窗，这里用confirm代替
      wx.showModal({
        title: '微信支付',
        content: '请完成微信支付',
        confirmText: '支付成功',
        cancelText: '关闭支付',
        success: (res) => {
          console.log('微信支付模态框操作:', res);
          if (res.confirm) {
              // 显示加载提示
              wx.showLoading({
                title: '订单生成中...',
                mask: true
              });
              
              // 支付成功后创建订单
              this.createOrder('paid');
            } else if (res.cancel) {
                // 模拟关闭支付弹窗
                // 显示确认弹窗
                wx.showModal({
                  title: '是否放弃支付',
                  content: '确定要放弃支付吗？订单将变为待支付状态。',
                  success: (res) => {
                    console.log('放弃支付确认:', res);
                    if (res.confirm) {
                      // 显示加载提示
                      wx.showLoading({
                        title: '订单生成中...',
                        mask: true
                      });
                      // 放弃支付时创建订单
                      this.createOrder('pending');
                    }
                  }
                });
              }
        }
      });
    }
  },

  // 创建订单
  async createOrder(status) {
    console.log('创建订单，状态:', status);
    
    // 检查订单数据是否存在
    if (!this.data.orderData) {
      console.error('订单数据不存在');
      wx.showToast({
        title: '订单数据错误',
        icon: 'none'
      });
      return;
    }
    
    // 先获取设置信息，包括倒计时时间
    const settings = getCollection("settings");
    try {
      const settingsRes = await settings.get();
      let countDownMinutes = 30; // 默认30分钟
      let currentSettings = {};
      if (settingsRes.data && settingsRes.data.length > 0) {
        const setting = settingsRes.data[0];
        currentSettings = setting || {};
        if (setting.countDown && typeof setting.countDown === 'number') {
          countDownMinutes = setting.countDown;
          console.log('从settings获取倒计时时间:', countDownMinutes, '分钟');
        }
      }
      
      // 准备订单数据
      // 计算过期时间（countDownMinutes分钟后）
      const createTime = new Date();
      const expireTime = new Date(createTime.getTime() + countDownMinutes * 60 * 1000);
      
      let orderData = {
        orderNumber: this.data.orderId,
        status: status,
        statusText: status === 'pending' ? '待支付' : '已支付',
        totalPrice: this.data.totalPrice,
        deliveryType: this.data.orderData?.deliveryType || "express",
        address: this.data.orderData?.address,
        pickupCode: this.data.orderData?.pickupCode,
        pickupTime: this.data.orderData?.pickupTime,
        pickupDate: this.data.orderData?.pickupDate,
        message: this.data.orderData?.message,
        products: this.data.orderData?.products,
        productsNames: (this.data.orderData?.products || []).map(p => p.name).join(', '),
        distance: this.data.orderData?.distance, // 直接保存确认订单页面传递的距离
        deliveryDistance: this.data.orderData?.distance, // 直接保存确认订单页面传递的距离
        pickupLatitude: this.data.orderData?.pickupLatitude, // 保存自提点纬度
        pickupLongitude: this.data.orderData?.pickupLongitude, // 保存自提点经度
        userLatitude: this.data.orderData?.userLatitude, // 保存用户地址纬度
        userLongitude: this.data.orderData?.userLongitude, // 保存用户地址经度
        policySnapshot: {
          supportNoReasonReturn: ((currentSettings.afterSalesTimeConfig && currentSettings.afterSalesTimeConfig.supportNoReasonReturnRefund) ?? currentSettings.supportNoReasonReturnRefund) !== false,
          supportNoReasonReturnRefund: ((currentSettings.afterSalesTimeConfig && currentSettings.afterSalesTimeConfig.supportNoReasonReturnRefund) ?? currentSettings.supportNoReasonReturnRefund) !== false,
          supportNoReasonExchange: false,
          supportNoReasonOnlyRefund: false,
          supportQualityRefund: ((currentSettings.afterSalesTimeConfig && currentSettings.afterSalesTimeConfig.supportQualityRefund) ?? currentSettings.supportQualityRefund) !== false,
          supportQualityResend: ((currentSettings.afterSalesTimeConfig && currentSettings.afterSalesTimeConfig.supportQualityResend) ?? currentSettings.supportQualityResend) !== false,
          supportQualityExchange: ((currentSettings.afterSalesTimeConfig && currentSettings.afterSalesTimeConfig.supportQualityExchange) ?? currentSettings.supportQualityExchange) !== false,
          supportWrongItemOrMissing: ((currentSettings.afterSalesTimeConfig && currentSettings.afterSalesTimeConfig.supportWrongItemOrMissing) ?? currentSettings.supportWrongItemOrMissing) !== false,
          supportLogisticsIssue: ((currentSettings.afterSalesTimeConfig && currentSettings.afterSalesTimeConfig.supportLogisticsIssue) ?? currentSettings.supportLogisticsIssue) !== false,
          afterSalesTypeConfigs: ((currentSettings.afterSalesTimeConfig && currentSettings.afterSalesTimeConfig.afterSalesTypeConfigs) ?? currentSettings.afterSalesTypeConfigs) || {},
          noReasonReturnDays: Number((currentSettings.afterSalesTimeConfig && currentSettings.afterSalesTimeConfig.noReasonReturnDays) ?? currentSettings.noReasonReturnDays ?? 7),
          autoConfirmReceiptDays: Number((currentSettings.afterSalesTimeConfig && currentSettings.afterSalesTimeConfig.autoConfirmReceiptDays) ?? currentSettings.autoConfirmReceiptDays ?? 3),
          normalAfterSalesDays: Number((currentSettings.afterSalesTimeConfig && currentSettings.afterSalesTimeConfig.normalAfterSalesDays) ?? currentSettings.normalAfterSalesDays ?? 7),
          qualityAfterSalesDays: Number((currentSettings.afterSalesTimeConfig && currentSettings.afterSalesTimeConfig.qualityAfterSalesDays) ?? currentSettings.qualityAfterSalesDays ?? 15),
          policyVersion: currentSettings.policyVersion || `v_${Date.now()}`,
          policyEffectiveAt: currentSettings.updatedAt || createTime
        },
        createdAt: createTime,
        expireTime: expireTime,
        updatedAt: createTime,
        updatedAtTs: Date.now()
      };
      
      // 如果是已支付状态，添加支付时间和支付方式
      if (status === 'paid') {
        orderData.payTime = createTime;
        // 模拟支付方式：随机选择零钱或银行卡
        const bankTypes = ['CFT', 'ICBC', 'ABC', 'BOC', 'CCB'];
        orderData.bankType = bankTypes[Math.floor(Math.random() * bankTypes.length)];
        orderData.tradeNo = `TN${Date.now()}${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
      }
      
      // 打印准备创建的订单数据
      console.log('准备创建的订单数据:', orderData);
      
      // 如果是上门自提订单，添加自提地址信息
      if (orderData.deliveryType === 'pickup') {
        try {
          const pickupLocationInfo = await getPickupLocation();
          if (pickupLocationInfo && pickupLocationInfo.pickupLocation) {
            orderData.pickupAddress = pickupLocationInfo.pickupLocation;
          }
        } catch (error) {
          console.error('获取自提地址失败:', error);
        }
      }
      
      // 如果是同城配送订单，添加自提地址和坐标信息
      if (orderData.deliveryType === 'local') {
        try {
          const pickupLocationInfo = await getPickupLocation();
          if (pickupLocationInfo) {
            orderData.pickupAddress = pickupLocationInfo.pickupLocation;
            orderData.pickupLatitude = pickupLocationInfo.pickupLatitude;
            orderData.pickupLongitude = pickupLocationInfo.pickupLongitude;
            
            // 确保使用确认订单页面传递的distance字段
            if (this.data.orderData?.distance) {
              orderData.distance = this.data.orderData.distance;
              orderData.deliveryDistance = this.data.orderData.distance;
              console.log('使用确认订单页面计算的距离:', orderData.distance);
            }
          }
        } catch (error) {
          console.error('获取自提地址失败:', error);
        }
      }
      
      console.log('准备创建订单:', orderData);
      
      // 直接操作，先扣减库存，再创建订单
      // 检查订单数据和商品信息
      if (!orderData || !orderData.products || orderData.products.length === 0) {
        throw new Error('订单数据或商品信息为空');
      }
      
      console.log('开始扣减库存，商品数量:', orderData.products.length);
      
      // 并行扣减库存
      const stockPromises = orderData.products.map(product => {
        if (!product.productId) {
          return Promise.reject(new Error('商品ID为空'));
        }
        if (!product.quantity) {
          return Promise.reject(new Error('商品数量为空'));
        }
        
        return db.collection('products').doc(product.productId).get()
          .then(productRes => {
            if (!productRes.data) {
              throw new Error('商品不存在');
            }
            
            const currentStock = productRes.data.stock || 0;
            if (currentStock < product.quantity) {
              throw new Error('商品库存不足');
            }
            
            const newStock = currentStock - product.quantity;
            console.log('准备更新商品库存，商品ID:', product.productId, '当前库存:', currentStock, '扣减数量:', product.quantity, '新库存:', newStock);
            
            return wx.cloud.callFunction({
              name: 'updateStock',
              data: {
                productId: product.productId,
                stock: newStock
              }
            }).catch(error => {
              console.error('云函数更新库存失败，尝试直接更新:', error);
              return db.collection('products').doc(product.productId).update({
                data: { stock: newStock }
              });
            });
          });
      });
      
      await Promise.all(stockPromises);
      
      console.log('库存扣减成功');
      
      // 保存订单到数据库
      const orderRes = await db.collection('orders').add({
        data: orderData
      });
      
      console.log("订单创建成功", orderRes);
      console.log("订单ID:", orderRes._id);
      const dbOrderId = orderRes._id;
      console.log("数据库订单ID:", dbOrderId);
      
      // 异步记录订单创建日志，不影响主流程
      const errorLogger = require('../../utils/errorLogger');
      wx.cloud.callFunction({
        name: 'orderOperationLog',
        data: {
          orderId: dbOrderId,
          orderNumber: orderData.orderNumber,
          openid: orderData._openid,
          action: 'create_order',
          fromStatus: '',
          toStatus: status,
          operatorType: 'user',
          operatorId: orderData._openid,
          operatorName: '',
          reason: '',
          remark: '',
          detail: {
            deliveryType: orderData.deliveryType,
            totalAmount: orderData.totalAmount,
            productCount: orderData.products?.length || 0
          }
        }
      }).catch(logError => {
        console.error('记录订单创建日志失败:', logError);
        errorLogger.log({
          type: 'order_operation_log_error',
          source: 'payment_page',
          location: `orderId=${dbOrderId},action=create_order`,
          message: logError.message || '记录订单创建日志失败',
          stack: logError.stack || '',
          code: logError.code || '',
          functionName: 'createOrder',
          inputParams: JSON.stringify({
            orderId: dbOrderId,
            orderNumber: orderData.orderNumber,
            action: 'create_order',
            toStatus: status
          }),
          pageName: 'payment'
        }).catch(() => {});
      });
      
      // 隐藏加载提示
      wx.hideLoading();
      
      // 异步执行后续操作，不阻塞主流程
      this._executePostOrderOperations(dbOrderId, orderData, status);
      
      // 如果是已支付状态，立即跳转到支付成功页面
      if (status === 'paid') {
        wx.showToast({
          title: '支付成功',
          icon: 'success',
          duration: 1000
        });
        
        setTimeout(() => {
          wx.redirectTo({
            url: '/pages/payment-success/index?orderId=' + dbOrderId + '&orderNumber=' + this.data.orderId
          });
        }, 1000);
      } else if (status === 'pending') {
        wx.showToast({
          title: '订单生成成功',
          icon: 'success',
          duration: 1000
        });
        
        setTimeout(() => {
          wx.redirectTo({
            url: `/pages/order-list/index?status=pending&deliveryType=${orderData.deliveryType}`
          });
        }, 1000);
      }
    } catch (err) {
      console.error("订单创建失败", err);
      // 隐藏加载提示
      wx.hideLoading();
      wx.showToast({
        title: "订单创建失败",
        icon: "none"
      });
    }
  },

  // 选择支付方式
  selectPaymentMethod() {
    // 这里可以添加支付方式选择逻辑
    wx.showToast({
      title: '暂仅支持微信支付',
      icon: 'none'
    });
  },

  // 更新订单状态
  updateOrderStatus(orderId, status, payTime = null) {
    console.log('调用updateOrderStatus，状态:', status, '订单ID:', orderId);
    console.log('订单ID类型:', typeof orderId);
    console.log('订单ID长度:', orderId ? orderId.length : 0);
    // 实际更新订单状态
    if (!orderId) {
      console.error('订单ID为空，无法更新订单状态');
      return;
    }
    console.log('准备更新订单状态，订单ID:', orderId);
    
    if (status === 'paid') {
      wx.cloud.callFunction({
        name: 'updateOrderStatus',
        data: {
          orderId,
          operation: 'pay',
          params: {
            payTime
          }
        }
      }).then((res) => {
        console.log('订单状态更新成功(云函数)', res);
      }).catch((err) => {
        console.error('订单状态更新失败(云函数)', err);
      });
      return;
    }

    const orders = getCollection("orders");
    const updateData = {
      status: status,
      statusText: status === 'pending' ? '待支付' : '',
      updatedAt: new Date(),
      updatedAtTs: Date.now()
    };

    orders.doc(orderId).update({ data: updateData })
      .then((res) => {
        console.log('订单状态更新成功', res);
      })
      .catch((err) => {
        console.error('订单状态更新失败', err);
      });
  },

  sendOrderStatusNotification({ status, orderId, orderNumber, deliveryType, amount = 0, cancelReason = '' }) {
    const openid = wx.getStorageSync('openid');
    if (!openid || !status || !orderId) return;
     console.log('调用sendOrderStatusNotification，状态:', status, '订单ID:', orderId);
    wx.cloud.callFunction({
      name: 'sendNotification',
      data: {
        notificationType: 'orderStatusChange',
        targetUsers: [openid],
        data: {
          status,
          orderNumber,
          deliveryType,
          amount,
          cancelReason
        },
        extras: {
          orderId
        }
      }
    }).then((res) => {
      console.log('订单状态通知发送成功:', res);
    }).catch((err) => {
      console.error('订单状态通知发送失败:', err);
    });
  },

  // 异步执行订单创建后的操作
  _executePostOrderOperations(dbOrderId, orderData, status) {
    // 更新订单数量缓存
    this.updateOrderCountCache(orderData.deliveryType, null, status);

    // 发送订单状态通知
    this.sendOrderStatusNotification({
      status,
      orderId: dbOrderId,
      orderNumber: orderData.orderNumber,
      deliveryType: orderData.deliveryType,
      amount: orderData.totalPrice || 0,
      cancelReason: status === 'pending' ? '' : undefined
    });

    // 如果是已支付状态，删除购物车中对应的商品
    if (status === 'paid') {
      this.deleteCartItems();
    }
  },
  
  /**
   * 更新订单数量缓存
   * @param {string} deliveryType 订单类型：express（快递运输）、pickup（上门自提）、local（同城配送）
   * @param {string} oldStatus 旧状态
   * @param {string} newStatus 新状态
   */
  updateOrderCountCache(deliveryType, oldStatus, newStatus) {
    console.log('更新订单数量缓存:', { deliveryType, oldStatus, newStatus });
    
    // 从本地存储获取缓存
    let cachedCounts = wx.getStorageSync('orderCounts');
    if (!cachedCounts) {
      // 如果本地存储没有缓存，初始化缓存
      cachedCounts = {
        orderCounts: {
          pending: 0, // 待支付
          paid: 0, // 待发货
          shipping: 0, // 待收货
          completed: 0, // 已完成
          refund: 0 // 退款/售后
        },
        pickupCounts: {
          pending: 0, // 待支付
          paid: 0, // 待自提
          completed: 0 // 已完成
        },
        localCounts: {
          pending: 0, // 待支付
          paid: 0, // 待配送
          shipping: 0, // 配送中
          completed: 0 // 已完成
        },
        timestamp: Date.now()
      };
    }
    
    // 处理旧状态的减1操作
    if (oldStatus) {
      if (deliveryType === 'express') {
        if (cachedCounts.orderCounts[oldStatus] > 0) {
          cachedCounts.orderCounts[oldStatus]--;
        }
      } else if (deliveryType === 'pickup') {
        if (cachedCounts.pickupCounts[oldStatus] > 0) {
          cachedCounts.pickupCounts[oldStatus]--;
        }
      } else if (deliveryType === 'local') {
        if (cachedCounts.localCounts[oldStatus] > 0) {
          cachedCounts.localCounts[oldStatus]--;
        }
      }
    }
    
    // 处理新状态的加1操作
    if (newStatus) {
      if (deliveryType === 'express') {
        cachedCounts.orderCounts[newStatus] = (cachedCounts.orderCounts[newStatus] || 0) + 1;
      } else if (deliveryType === 'pickup') {
        cachedCounts.pickupCounts[newStatus]++;
      } else if (deliveryType === 'local') {
        cachedCounts.localCounts[newStatus]++;
      }
    }
    
    // 更新时间戳
    cachedCounts.timestamp = Date.now();
    
    // 保存到本地存储
    wx.setStorageSync('orderCounts', cachedCounts);
    console.log('更新订单数量缓存成功:', cachedCounts);
  },

  // 监听页面卸载
  onUnload() {
    // 当用户点击默认返回按钮时，这里会被触发
    // 但需要注意，这里无法阻止页面卸载，只能执行一些清理操作
    console.log('支付页面卸载');
  },

  // 监听页面返回
  onBackPress() {
    // 显示确认弹窗
    wx.showModal({
      title: '是否放弃支付',
      content: '确定要放弃支付吗？订单将变为待支付状态。',
      success: (res) => {
        if (res.confirm) {
          // 跳转到订单管理页面的待支付标签页
          wx.redirectTo({
            url: '/pages/order-list/index?status=pending'
          });
        }
      }
    });
    // 返回true表示阻止默认返回行为
    return true;
  },

  // 监听页面导航栏返回按钮点击
  onNavigationBarButtonTap() {
    // 这里无法直接监听导航栏返回按钮点击
    // 需要使用其他方法
  },

  // 监听页面显示时设置导航栏返回按钮的行为
  onShow() {
    // 移除页面卸载前的确认提示，让默认返回按钮直接返回上一页
  },

  // 监听页面隐藏时关闭确认提示
  onHide() {
    // 移除页面卸载前的确认提示
  },

  // 删除购物车中对应的商品（软删除）
  deleteCartItems() {
    const { orderData } = this.data;
    if (!orderData || !orderData.products) return;

    const cart = getCollection("cart");
    const openid = wx.getStorageSync('openid') || '';
    const productIds = orderData.products.map(product => product.productId);

    // 设置购物车脏标记，让购物车页面知道需要刷新
    const app = getApp();
    app.globalData.cartDirty = true;

    // 查找购物车中对应的商品并软删除
    if (openid) {
      cart
        .where({
          _openid: openid,
          productId: db.command.in(productIds),
          isDelete: false
        })
        .get()
        .then(res => {
          if (res.data && res.data.length > 0) {
            // 批量软删除购物车商品
            const deletePromises = res.data.map(item => {
              return cart.doc(item._id).update({
                data: {
                  isDelete: true,
                  updatedAt: new Date()
                }
              });
            });

            Promise.all(deletePromises)
              .then(() => {
                console.log('购物车商品删除成功');
              })
              .catch(err => {
                console.error('购物车商品删除失败', err);
              });
          }
        })
        .catch(err => {
          console.error('查找购物车商品失败', err);
        });
    }
  }
});
