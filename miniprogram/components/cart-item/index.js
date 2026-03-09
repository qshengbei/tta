Component({
  properties: {
    item: {
      type: Object,
      value: {}
    },
    checked: {
      type: Boolean,
      value: true
    }
  },
  methods: {
    onCheckChange(e) {
      this.triggerEvent("checkchange", {
        checked: e.detail.value.length > 0,
        item: this.data.item
      });
    },
    onQuantityChange(e) {
      this.triggerEvent("quantitychange", {
        value: e.detail.value,
        item: this.data.item
      });
    }
  }
});