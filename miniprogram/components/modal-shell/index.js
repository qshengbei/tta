// components/modal-shell/index.js
// 通用弹层基座：只负责遮罩、面板、标题栏、滚动穿透拦截与出现动画，业务内容由 slot 传入
Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    // bottom：底部上滑弹层；center：居中对话框
    position: {
      type: String,
      value: 'bottom'
    },
    title: {
      type: String,
      value: ''
    },
    // 标题对齐：left（左标题 + 右侧关闭）| center（居中标题，可配合 showClose=false）
    titleAlign: {
      type: String,
      value: 'left'
    },
    showClose: {
      type: Boolean,
      value: true
    },
    // 是否允许点击遮罩关闭
    maskClosable: {
      type: Boolean,
      value: true
    },
    // 面板高度，仅 position=bottom 生效（如 '70vh'；留空则由内容撑开）
    panelHeight: {
      type: String,
      value: ''
    },
    // 需高于页面级浮层（搜索栏等最高 10002），确保遮罩盖住整页
    zIndex: {
      type: Number,
      value: 10010
    }
  },

  methods: {
    onMaskTap() {
      if (!this.data.maskClosable) {
        return;
      }
      this.triggerEvent('close');
    },

    onClose() {
      this.triggerEvent('close');
    },

    // 空函数：用于 catchtouchmove 阻止遮罩后的页面滚动穿透
    preventTouchMove() {}
  }
});
