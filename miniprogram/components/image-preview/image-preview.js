Component({
  properties: {
    imageUrls: {
      type: Array,
      value: []
    },
    current: {
      type: Number,
      value: 0
    },
    show: {
      type: Boolean,
      value: false,
      observer: function(newVal) {
        if (newVal) {
          this.resetImageState();
        }
      }
    }
  },

  data: {
    currentIndex: 0,
    lastTapTime: 0, // 用于检测双击
    isImageScaled: false // 标记图片是否被放大
  },

  methods: {
    // 重置图片状态
    resetImageState() {
      this.setData({
        currentIndex: this.properties.current
      });
    },

    // 处理滑动切换
    handleSwiperChange(e) {
      const current = e.detail.current;
      this.setData({
        currentIndex: current,
        isImageScaled: false
      });
    },

    // 处理movable-view位置变化
    handleMovableChange(e) {
      // 空方法，不需要处理位置变化
    },

    // 处理缩放
    handleScale(e) {
      const { scale } = e.detail;
      // 当图片缩放比例大于1时，标记为已放大
      this.setData({
        isImageScaled: scale > 1
      });
    },

    // 处理单击和双击
    handleDoubleTap(e) {
      const now = Date.now();
      const lastTapTime = this.data.lastTapTime;
      
      if (now - lastTapTime < 300) {
        // 双击，重置图片状态
        // 通过重新设置currentIndex来重置movable-view的状态
        const currentIndex = this.data.currentIndex;
        this.setData({
          currentIndex: -1,
          isImageScaled: false
        });
        setTimeout(() => {
          this.setData({
            currentIndex: currentIndex
          });
        }, 0);
      } else {
        // 单击，关闭预览
        setTimeout(() => {
          const latestTapTime = this.data.lastTapTime;
          if (latestTapTime === now) {
            // 确认是单击（没有后续的双击）
            this.handleClose();
          }
        }, 300);
      }
      
      this.setData({
        lastTapTime: now
      });
    },

    // 处理图片加载
    handleImageLoad(e) {
      // 可以在这里添加图片加载的处理逻辑
    },

    // 关闭预览
    handleClose() {
      this.triggerEvent('close');
    },

    // 处理swiper的触摸移动事件
    handleSwiperTouchMove(e) {
      // 当图片被放大时，阻止swiper的滑动事件
      if (this.data.isImageScaled) {
        // 直接返回false，阻止事件传播和默认行为
        return false;
      }
    },

    // 处理容器的触摸移动事件
    handleContainerTouchMove(e) {
      // 当图片被放大时，阻止容器的触摸移动事件
      if (this.data.isImageScaled) {
        // 直接返回false，阻止事件传播和默认行为
        return false;
      }
    }
  }
});