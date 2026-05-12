// pages/logistics/index.js
Page({
  data: {
    loading: true,
    error: false,
    errorMessage: '',
    logisticsInfo: {
      trackingNumber: '',
      companyName: '',
      statusText: '',
      statusColor: '',
      timeline: []
    },
    showMap: false
  },

  onLoad(options) {
    const { orderId, trackingNumber, companyCode } = options;
    
    if (orderId) {
      this.getOrderLogistics(orderId);
    } else if (trackingNumber && companyCode) {
      this.fetchLogistics(trackingNumber, companyCode);
    } else {
      this.setData({
        loading: false,
        error: true,
        errorMessage: '缺少物流查询参数'
      });
    }
  },

  // 根据订单ID获取物流信息
  async getOrderLogistics(orderId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getOrderDetail',
        data: {
          orderId: orderId
        }
      });

      if (res.result && res.result.success && res.result.order) {
        const order = res.result.order;
        
        if (order.logisticsInfo && order.logisticsInfo.trackingNumber) {
          const { trackingNumber, companyCode, companyName } = order.logisticsInfo;
          this.setData({
            'logisticsInfo.trackingNumber': trackingNumber,
            'logisticsInfo.companyName': companyName || ''
          });
          this.fetchLogistics(trackingNumber, companyCode);
        } else {
          this.setData({
            loading: false,
            error: true,
            errorMessage: '订单暂无物流信息'
          });
        }
      } else {
        this.setData({
          loading: false,
          error: true,
          errorMessage: '获取订单信息失败'
        });
      }
    } catch (error) {
      console.error('获取订单物流信息失败:', error);
      this.setData({
        loading: false,
        error: true,
        errorMessage: '获取订单物流信息失败'
      });
    }
  },

  // 获取物流信息
  async fetchLogistics(trackingNumber, companyCode) {
    this.setData({ loading: true, error: false });
    
    try {
      // 先调用智能判断接口获取快递公司信息
      let companyInfo = { code: companyCode, name: '' };
      
      if (!companyCode) {
        const smartCheckRes = await wx.cloud.callFunction({
          name: 'express100',
          data: {
            action: 'smartCheck',
            expressNo: trackingNumber
          }
        });
        
        if (smartCheckRes.result && smartCheckRes.result.success && smartCheckRes.result.data && smartCheckRes.result.data.comCode) {
          companyInfo = {
            code: smartCheckRes.result.data.comCode,
            name: smartCheckRes.result.data.comName || ''
          };
          this.setData({ 'logisticsInfo.companyName': companyInfo.name });
        } else {
          this.setData({
            loading: false,
            error: true,
            errorMessage: '无法识别快递公司，请手动选择'
          });
          return;
        }
      }
      
      // 调用实时查询接口获取物流信息
      const realTimeRes = await wx.cloud.callFunction({
        name: 'express100',
        data: {
          action: 'queryLogisticsAndUpdateOrder',
          expressNo: trackingNumber,
          companyCode: companyInfo.code,
          fromAddress: '',
          toAddress: ''
        }
      });

      if (realTimeRes.result && realTimeRes.result.success && realTimeRes.result.data) {
        const data = realTimeRes.result.data;
        this.processLogisticsData(data, trackingNumber, companyInfo.name);

        if (realTimeRes.result.orderUpdated) {
          wx.showToast({
            title: '订单已更新为待确认收货',
            icon: 'success',
            duration: 2000
          });
        }
      } else {
        this.setData({
          loading: false,
          error: true,
          errorMessage: realTimeRes.result && realTimeRes.result.error || '获取物流信息失败'
        });
      }
    } catch (error) {
      console.error('获取物流信息失败:', error);
      this.setData({
        loading: false,
        error: true,
        errorMessage: '获取物流信息失败'
      });
    }
  },

  // 处理物流数据
  processLogisticsData(data, trackingNumber, companyName) {
    let statusText = '';
    let statusColor = '#666';
    
    // 处理物流状态
    switch (data.state) {
      case '0':
        statusText = '暂无物流信息';
        break;
      case '1':
        statusText = '已揽收';
        statusColor = '#1989fa';
        break;
      case '2':
        statusText = '运输中';
        statusColor = '#1989fa';
        break;
      case '3':
        statusText = '已签收';
        statusColor = '#07c160';
        break;
      case '4':
        statusText = '派送中';
        statusColor = '#1989fa';
        break;
      case '5':
        statusText = '异常';
        statusColor = '#ff4d4f';
        break;
      default:
        statusText = '未知状态';
    }
    
    // 处理物流轨迹
    const timeline = data.data ? data.data.map(item => ({
      context: item.context,
      time: item.time
    })) : [];
    
    this.setData({
      loading: false,
      logisticsInfo: {
        trackingNumber: trackingNumber,
        companyName: companyName,
        statusText: statusText,
        statusColor: statusColor,
        timeline: timeline
      },
      showMap: true // 暂时总是显示地图区域
    });
  },

  // 返回上一页
  goBack() {
    wx.navigateBack();
  }
});