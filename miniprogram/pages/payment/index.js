import { getCollection } from "../../utils/cloud";
const db = wx.cloud.database();

Page({
  data: {
    totalPrice: 0,
    orderId: '',
    createTime: '',
    orderData: null
  },

  onLoad(options) {
    // 从参数中获取总金额和订单数据
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
  handlePayment() {
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

    // 创建订单
    const orders = getCollection("orders");
    const orderData = {
      orderNumber: this.data.orderId,
      status: "pending",
      statusText: "待支付",
      totalPrice: this.data.totalPrice,
      deliveryType: this.data.orderData?.deliveryType,
      address: this.data.orderData?.address,
      pickupCode: this.data.orderData?.pickupCode,
      pickupTime: this.data.orderData?.pickupTime,
      products: this.data.orderData?.products,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    console.log('准备创建订单:', orderData);
    
    // 保存订单到数据库
    orders
      .add({
        data: orderData
      })
      .then((res) => {
        console.log("订单创建成功", res);
        console.log("订单ID:", res._id);
        const dbOrderId = res._id;
        console.log("数据库订单ID:", dbOrderId);
        
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
              console.log('支付成功时的数据库订单ID:', dbOrderId);
              console.log('支付成功时的订单编号:', this.data.orderId);
              if (dbOrderId) {
                // 更新订单状态为已支付
                this.updateOrderStatus(dbOrderId, 'paid');
                
                // 删除购物车中对应的商品（软删除）
                this.deleteCartItems();
              } else {
                console.error('订单ID为空，无法更新订单状态');
              }
              
              // 跳转到支付成功页面
              setTimeout(() => {
                wx.redirectTo({
                  url: '/pages/payment-success/index?orderId=' + dbOrderId + '&orderNumber=' + this.data.orderId
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
                    // 更新订单状态为待支付
                    console.log('放弃支付时的数据库订单ID:', dbOrderId);
                    console.log('放弃支付时的订单编号:', this.data.orderId);
                    if (dbOrderId) {
                      this.updateOrderStatus(dbOrderId, 'pending');
                    }
                    // 跳转到订单管理页面的待支付标签页
                    wx.redirectTo({
                      url: '/pages/order-list/index?status=pending'
                    });
                  }
                }
              });
            }
          }
        });
      })
      .catch((err) => {
        console.error("订单创建失败", err);
        wx.hideLoading();
        wx.showToast({
          title: "订单创建失败",
          icon: "none"
        });
      });
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
  updateOrderStatus(orderId, status) {
    console.log('调用updateOrderStatus，状态:', status, '订单ID:', orderId);
    console.log('订单ID类型:', typeof orderId);
    console.log('订单ID长度:', orderId ? orderId.length : 0);
    // 实际更新订单状态
    if (!orderId) {
      console.error('订单ID为空，无法更新订单状态');
      return;
    }
    const orders = getCollection("orders");
    console.log('准备更新订单状态，订单ID:', orderId);
    orders
      .doc(orderId)
      .update({
        data: {
          status: status,
          statusText: status === 'pending' ? '待支付' : status === 'paid' ? '已支付' : '',
          updatedAt: new Date()
        }
      })
      .then((res) => {
        console.log('订单状态更新成功', res);
      })
      .catch((err) => {
        console.error('订单状态更新失败', err);
      });
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