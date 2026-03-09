Component({
  properties: {
    products: {
      type: Array,
      value: []
    },
    layout: {
      type: String,
      value: "grid" // grid | list
    }
  },
  methods: {
    onProductTap(e) {
      this.triggerEvent("producttap", e.detail);
    }
  }
});