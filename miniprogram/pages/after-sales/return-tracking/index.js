const { EXPRESS_COMPANIES, COMMON_EXPRESS_COMPANIES, getCompanyByCode } = require('../../../utils/expressCompanies');
const { confirm } = require('../../../utils/confirm');

Page({
  data: {
    orderId: '',
    caseId: '',
    afterSales: {},
    expressCompanies: EXPRESS_COMPANIES,
    commonExpressCompanies: COMMON_EXPRESS_COMPANIES,
    selectedCompany: null,
    trackingNumber: '',
    detectingCompany: false,
    showCompanyPicker: false,
    companyPickerValue: [0],
    submitting: false,
    isModify: false,
    detectStatus: '',
    detectMessage: ''
  },

  onLoad(options) {
    const { orderId, caseId, trackingNumber, companyCode, companyName } = options;
    this.setData({ 
      orderId: orderId || '',
      caseId: caseId || '',
      isModify: !!trackingNumber
    });
    
    if (trackingNumber) {
      const decodedTrackingNumber = decodeURIComponent(trackingNumber);
      this.setData({ trackingNumber: decodedTrackingNumber });
      if (companyCode && companyName) {
        this.setData({ 
          selectedCompany: { 
            code: decodeURIComponent(companyCode), 
            name: decodeURIComponent(companyName) 
          } 
        });
      }
    }
    
    wx.setNavigationBarTitle({
      title: trackingNumber ? '修改退货单号' : '填写退货单号'
    });
    
    this.loadAfterSalesInfo();
  },

  async loadAfterSalesInfo() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'afterSales',
        data: {
          action: 'getDetail',
          data: {
            caseId: this.data.caseId,
            orderId: this.data.orderId
          }
        }
      });

      if (res.result.success) {
        this.setData({ afterSales: res.result.data });
      }
    } catch (error) {
      console.error('[退货物流] 加载售后信息失败:', error);
    }
  },

  onTrackingNumberInput(e) {
    const value = e.detail.value;
    const oldValue = this.data.trackingNumber;
    this.setData({ trackingNumber: value });
    
    // 单号发生变化且长度达到6位时，触发智能识别
    // 修改场景下，单号变了也需要重新识别
    if (value.length >= 6 && value !== oldValue && !this.data.detectingCompany) {
      this.setData({ detectStatus: '', detectMessage: '' });
      this.detectExpressCompany(value);
    } else if (value !== oldValue) {
      this.setData({ detectStatus: '', detectMessage: '' });
    }
  },

  async detectExpressCompany(trackingNumber) {
    this.setData({ detectingCompany: true });
    
    try {
      const res = await wx.cloud.callFunction({
        name: 'express100',
        data: {
          action: 'smartCheck',
          expressNo: trackingNumber
        }
      });

      if (res.result && res.result.success && res.result.companies && res.result.companies.length > 0) {
        const companyCode = res.result.companies[0].code;
        const matchedCompany = EXPRESS_COMPANIES.find(c => c.code === companyCode);
        if (matchedCompany) {
          this.setData({ 
            selectedCompany: matchedCompany,
            detectStatus: 'success',
            detectMessage: `已识别为${matchedCompany.name}`
          });
        } else if (res.result.companies[0].name) {
          this.setData({ 
            selectedCompany: { code: companyCode, name: res.result.companies[0].name },
            detectStatus: 'success',
            detectMessage: `已识别为${res.result.companies[0].name}`
          });
        } else {
          // 识别到公司但没有名称，保留原选择
          this.setData({ 
            detectStatus: 'fail',
            detectMessage: '智能识别快递公司失败，辛苦您手动选择'
          });
        }
      } else {
        console.warn('[退货物流] 智能识别快递公司失败，未识别到快递公司:', trackingNumber, res.result);
        this.setData({ 
          detectStatus: 'fail',
          detectMessage: '智能识别快递公司失败，辛苦您手动选择'
        });
      }
    } catch (error) {
      console.error('[退货物流] 智能识别快递公司失败:', error);
      this.setData({ 
        detectStatus: 'fail',
        detectMessage: '智能识别快递公司失败，辛苦您手动选择'
      });
    } finally {
      this.setData({ detectingCompany: false });
    }
  },

  showCompanyPicker() {
    this.setData({ showCompanyPicker: true });
  },

  hideCompanyPicker() {
    this.setData({ showCompanyPicker: false });
  },

  companyPickerChange(e) {
    this.setData({ companyPickerValue: e.detail.value });
  },

  confirmCompany() {
    const index = this.data.companyPickerValue[0];
    const selectedCompany = this.data.expressCompanies[index];
    this.setData({ selectedCompany, showCompanyPicker: false });
  },

  selectExpressCompany(e) {
    const { code, name } = e.currentTarget.dataset;
    this.setData({ 
      selectedCompany: { code, name },
      showCompanyPicker: false 
    });
  },

  async submitReturnTracking() {
    const { trackingNumber, selectedCompany, isModify, orderId, caseId } = this.data;

    console.log('[退货物流] 提交退货单号开始');
    console.log('[退货物流] orderId:', orderId);
    console.log('[退货物流] caseId:', caseId);
    console.log('[退货物流] trackingNumber:', trackingNumber);
    console.log('[退货物流] selectedCompany:', selectedCompany);
    console.log('[退货物流] isModify:', isModify);

    if (!trackingNumber.trim()) {
      wx.showToast({ title: '请填写退货单号', icon: 'none' });
      return;
    }

    if (!selectedCompany) {
      wx.showToast({ title: '请选择快递公司', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });

    try {
      const operation = isModify ? 'modifyReturnTracking' : 'submitReturnTracking';
      
      const res = await wx.cloud.callFunction({
        name: 'updateOrderStatus',
        data: {
          orderId: orderId,
          operation,
          params: {
            caseId: caseId,
            trackingNumber: trackingNumber.trim(),
            companyCode: selectedCompany.code,
            companyName: selectedCompany.name
          }
        }
      });

      if (res.result.success) {
        const result = res.result || {};

        // 如果是修改退货单号，立即查询新单号的物流状态
        if (isModify) {
          try {
            console.log('[退货物流] 修改单号后，立即查询新单号物流状态');
            const queryRes = await wx.cloud.callFunction({
              name: 'express100',
              data: {
                action: 'queryReturnLogisticsAndUpdateCase',
                expressNo: trackingNumber.trim(),
                companyCode: selectedCompany.code,
                caseId: caseId,
                forceRefresh: true
              }
            });
            
            if (queryRes.result?.success) {
              console.log('[退货物流] 新单号物流状态查询完成');
            } else {
              console.warn('[退货物流] 新单号物流状态查询失败:', queryRes.result?.error);
              // 物流查询失败不影响修改结果，只是暂时不显示物流状态
              wx.showToast({
                title: '物流信息查询失败，稍后可手动查看',
                icon: 'none',
                duration: 2000
              });
            }
          } catch (queryError) {
            console.error('[退货物流] 修改单号后查询物流失败:', queryError);
            wx.showToast({
              title: '物流信息查询失败，稍后可手动查看',
              icon: 'none',
              duration: 2000
            });
          }
        }

        // 运单号与其他售后单重复：寄回运费补偿已自动取消，弹窗明确告知（同一运单号只补偿一次）
        if (result.compensationDuplicated) {
          setTimeout(() => {
            confirm({
              title: '寄回运费不重复补偿',
              content: `该运单号已用于售后单${result.duplicateCaseNo ? ' ' + result.duplicateCaseNo : ''}，同一运单号仅补偿一次，本单寄回运费补偿已取消。若本单确实是分开寄回的，请修改为实际运单号，补偿将自动恢复。`,
              showCancel: false,
              confirmText: '我知道了',
              maskClosable: false
            }).then(() => wx.navigateBack());
          }, 300);
        } else {
          const message = isModify
            ? (result.compensationRestored ? '修改成功，寄回运费补偿已恢复' : '修改退货单号成功')
            : '提交退货单号成功';
          wx.showToast({ title: message, icon: result.compensationRestored ? 'none' : 'success' });

          setTimeout(() => {
            wx.navigateBack();
          }, isModify ? 2500 : 1500);
        }
      } else {
        wx.showToast({ title: res.result.error || '操作失败', icon: 'none' });
      }
    } catch (error) {
      console.error('[退货物流] 提交失败:', error);
      wx.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

});