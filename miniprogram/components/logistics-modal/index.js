// components/logistics-modal/index.js
// 物流信息弹层：纯展示组件。物流轨迹与地图数据由父页面查询后传入，
// 组件不发起任何网络请求；仅"重置地图"因需要组件内的 map 上下文而在此实现
Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    // 标题：售后场景用于区分"退货物流信息"/"商家寄回物流信息"
    title: {
      type: String,
      value: '物流信息'
    },
    // 是否展示地图轨迹区块（部分场景只需要轨迹文字）
    showMap: {
      type: Boolean,
      value: false
    },
    // 轨迹与状态数据：{ com, nu, state, stateName, displayStateText, data: [] }
    // 页面在数据到达前会置为 null，故不做严格类型校验，避免属性类型告警
    logisticsData: {
      type: null,
      value: {}
    },
    // 地图补充数据：{ companyName, trackingNumber }
    mapData: {
      type: null,
      value: {}
    },
    // 地图中心点：{ longitude, latitude }
    mapCenter: {
      type: null,
      value: {}
    },
    mapScale: {
      type: Number,
      value: 10
    },
    // 地图标记点
    trackPoints: {
      type: Array,
      value: []
    }
  },

  data: {
    // 由 logisticsData.data 归一化而来：轨迹项只有 time/context，可能重复，
    // 统一补一个“时间#序号”的稳定 key 供 wx:for 使用
    traceList: []
  },

  observers: {
    logisticsData(logisticsData) {
      const traces = logisticsData && Array.isArray(logisticsData.data)
        ? logisticsData.data
        : [];
      this.setData({
        traceList: traces.map((item, index) => Object.assign({}, item, {
          _traceKey: (item && item.time ? item.time : 'trace') + '#' + index
        }))
      });
    }
  },

  methods: {
    onClose() {
      this.triggerEvent('close');
    },

    // 重置地图：map 位于本组件内，创建上下文必须传入组件实例
    onResetMap() {
      const mapContext = wx.createMapContext('logisticsMap', this);
      mapContext.moveToLocation({
        longitude: this.data.mapCenter.longitude,
        latitude: this.data.mapCenter.latitude,
        scale: this.data.mapScale
      });
    },

    // 全屏涉及页面级布局状态，交给父页面处理
    onFullScreenMap() {
      this.triggerEvent('fullscreenmap');
    }
  }
});
