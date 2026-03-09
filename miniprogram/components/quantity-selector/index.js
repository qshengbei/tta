Component({
  properties: {
    value: {
      type: Number,
      value: 1
    },
    min: {
      type: Number,
      value: 1
    },
    max: {
      type: Number,
      value: 999
    }
  },
  methods: {
    onIncrease() {
      const { value, max } = this.data;
      const next = value + 1 > max ? max : value + 1;
      if (next !== value) {
        this.setData({ value: next });
        this.triggerEvent("change", { value: next });
      }
    },
    onDecrease() {
      const { value, min } = this.data;
      const next = value - 1 < min ? min : value - 1;
      if (next !== value) {
        this.setData({ value: next });
        this.triggerEvent("change", { value: next });
      }
    }
  }
});