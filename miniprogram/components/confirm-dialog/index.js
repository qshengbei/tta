// components/confirm-dialog/index.js
// 统一确认弹窗：基于 modal-shell，替代业务确认类的 wx.showModal
// 通过 open(options) 打开并返回 Promise，resolve 出 { confirm, cancel }
Component({
  data: {
    visible: false,
    title: '',
    content: '',
    confirmText: '确定',
    cancelText: '取消',
    showCancel: true,
    // 确认按钮语义色：default(黑) | info(蓝) | success(绿) | danger(红)
    tone: 'default',
    maskClosable: true
  },

  methods: {
    open(options = {}) {
      // 连续调用时，先让上一次的 Promise 以"取消"结束，避免调用方一直挂起
      if (this._resolve) {
        this._resolve({ confirm: false, cancel: true });
        this._resolve = null;
      }

      return new Promise((resolve) => {
        this._resolve = resolve;
        this.setData({
          visible: true,
          title: options.title || '',
          content: options.content || '',
          confirmText: options.confirmText || '确定',
          cancelText: options.cancelText || '取消',
          showCancel: options.showCancel !== false,
          tone: options.tone || 'default',
          // 遮罩点击等同取消
          maskClosable: options.maskClosable !== false
        });
      });
    },

    onConfirm() {
      this.settle({ confirm: true, cancel: false });
    },

    onCancel() {
      this.settle({ confirm: false, cancel: true });
    },

    settle(result) {
      const resolve = this._resolve;
      this._resolve = null;
      this.setData({ visible: false });
      if (resolve) {
        resolve(result);
      }
    }
  }
});
