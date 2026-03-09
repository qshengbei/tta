Component({
  properties: {
    product: {
      type: Object,
      value: {}
    },
    bordered: {
      type: Boolean,
      value: true
    }
  },
  methods: {
    onTap() {
      this.triggerEvent("tap", { product: this.data.product });
    }
  }
});