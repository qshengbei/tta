# UI 重构参考

> 本文件基于「UI架构问题.txt」15 项扫描结果的修复历程整理，反映 **2026-09-24** 的代码现状，
> 供下一阶段 UI 重构作为基线参考。原文件保留不动，本文件聚焦「重构时需要知道什么、遵守什么」。

---

## 一、全局样式体系

### 1.1 设计 Token（styles/variables.wxss）

**定义位置**：`page` 选择器下（WXSS 不支持 `:root`，此前曾定义在 `:root` 导致全站 token 从未生效，已修正）。
**引入方式**：app.wxss 第 1 行 `@import "styles/variables.wxss"`，全站页面自动继承，无需页面级 @import。

| 分类 | Token | 值 | 用途 |
|------|-------|----|------|
| **Brand** | `--color-primary` | `#1a3d8f` | 品牌深蓝，按钮/链接/选中态 |
| | `--color-primary-dark` | `#0f2a6b` | 渐变深端、按压态 |
| | `--color-primary-soft` | `#e5ecfa` | 浅蓝底/标签底色 |
| **Neutrals** | `--color-bg` | `#f5f5f5` | 页面底色（灰） |
| | `--color-bg-muted` | `#f3f4f6` | 次级灰底 |
| | `--color-bg-elevated` | `#ffffff` | 卡片/弹层白底 |
| | `--color-bg-inverse` | `#000000` | 反色底 |
| | `--color-border-subtle` | `#eaeaea` | 细分割线 |
| | `--color-border` | `#e5e7eb` | 标准边框 |
| **Text** | `--color-text-main` | `#111111` | 正文主色 |
| | `--color-text-secondary` | `#666666` | 次要文字 |
| | `--color-text-muted` | `#999999` | 弱化文字 |
| | `--color-text-inverse` | `#ffffff` | 反色文字 |
| **Feedback** | `--color-success` | `#0ebc6c` | 成功态 |
| | `--color-success-dark` | `#0c9f5b` | 成功渐变深端 |
| | `--color-warning` | `#ff9f40` | 警告态 |
| | `--color-warning-dark` | `#db6d00` | 警告渐变深端 |
| | `--color-danger` | `#e34c4c` | 危险/错误态 |
| | `--color-danger-dark` | `#c31f1f` | 危险渐变深端 |
| **Font** | `--font-size-display` | `40rpx` | 大标题 |
| | `--font-size-h1` | `32rpx` | 一级标题 |
| | `--font-size-h2` | `28rpx` | 二级标题 |
| | `--font-size-body` | `26rpx` | 正文（全站主流行） |
| | `--font-size-body-sm` | `24rpx` | 小正文 |
| | `--font-size-caption` | `22rpx` | 说明/标签 |
| **Space** | `--space-xs` / `--sm` / `--md` / `--lg` / `--xl` | `8/16/24/32/40rpx` | 间距阶梯 |

**重构注意事项**：
- 渐变必须使用成对 token（如 `var(--color-primary) 0% → var(--color-primary-dark) 100%`），单 token 渐变会退化为纯色。
- app.wxss 的 `page` 未设 `font-size`（有意为之，避免全站字号跳变），各页面自行设定正文字号。
- `--color-bg` 为灰底 `#f5f5f5`；卡片/弹层/白底区域用 `--color-bg-elevated`。
- 导航栏色 `#FFFFFF`（app.json），与页面灰底有可见分界——这是为消除 tab 切换白闪而接受的设计取舍，不要改回灰色。

### 1.2 全局基础类（styles/mixins.wxss，44 行）

| 类名 | 用途 |
|------|------|
| `.page-root` | 页面根容器，`min-height:100vh` + 灰底 |
| `.btn` | 按钮基础（80rpx 高、胶囊圆角、flex 居中） |
| `.btn-primary` | 主色实心按钮 |
| `.btn-secondary` | 主色描边按钮 |
| `.bottom-bar` | 固定底栏（含 safe-area 避让） |

### 1.3 空态/错误态（styles/states.wxss，75 行）

**全局引入**：app.wxss `@import "styles/states.wxss"`，页面无需 @import。

| 类名 | 用途 |
|------|------|
| `.empty-view` / `.error-view` | 状态块基础（flex 列居中） |
| `--page` 修饰符 | 独占整页/整块时（`flex:1; min-height:60vh`） |
| `__text` | 主文案（空态用 muted、错误态用 secondary） |
| `__subtext` | 可选补充说明 |
| `__btn` | 64rpx 胶囊按钮（空态实心、错误态描边） |

**约定**：纯文字 + 可选按钮，不使用配图或 emoji。旧类名（.empty-state / .error-container 等）全站已清零。

### 1.4 app.wxss 结构

```
@import "styles/variables.wxss"
@import "styles/mixins.wxss"
@import "styles/states.wxss"

page { background-color, color, font-family, box-sizing, reset }
view/text/image/button { box-sizing: border-box }
```

---

## 二、组件体系

### 2.1 现有组件（8 个，均在 app.json 已注册页面中被引用，无孤儿）

| 组件 | 路径 | 基座 | 职责 |
|------|------|------|------|
| **modal-shell** | components/modal-shell/ | 自身 | 弹层基座：遮罩、圆角、标题栏、出现动画、safe-area、滚动穿透拦截 |
| **confirm-dialog** | components/confirm-dialog/ | modal-shell | 确认对话框：API 对齐 wx.showModal，经 utils/confirm.js 调用，支持 danger/单按钮/editable |
| **logistics-modal** | components/logistics-modal/ | modal-shell | 物流轨迹弹层：用户端与管理端共用 |
| **express-rules-modal** | components/express-rules-modal/ | modal-shell | 运费规则弹层：商品详情与确认订单共用 |
| **cart-preview** | components/cart-preview/ | modal-shell | 购物车预览弹层 |
| **search-filter-panel** | components/search-filter-panel/ | — | 搜索筛选面板（用户端） |
| **order-search-filter-panel** | components/order-search-filter-panel/ | — | 订单搜索筛选面板（管理端） |
| **quantity-selector** | components/quantity-selector/ | — | 数量选择器 |

### 2.2 弹层架构

```
modal-shell（基座）
  ├── confirm-dialog（确认对话框）
  ├── logistics-modal（物流轨迹）
  ├── express-rules-modal（运费规则）
  └── cart-preview（购物车预览）
```

**调用方式**：
- 弹层组件：在页面 json 注册 + wxml 挂载，通过 `visible` 属性控制显示。
- 确认对话框：`const { confirm } = require('utils/confirm.js')` → `confirm({ content, ... })`。

**已统一的行为**：
- 遮罩点击 = 取消（`maskClosable: true`），仅微信支付模拟弹窗为 `false`。
- 管理端删除类操作用 `danger` 样式标红；确认收货/验货通过用蓝色 `--color-primary`；验货通过用绿色 `--color-success`。
- 管理端「同意售后/拒绝售后」需输入金额/理由，保留原生 `wx.showModal`（editable 场景）。

### 2.3 页面内手写卡片（未抽组件，重构时需评估）

以下卡片目前在各页面内联手写，是否抽成共享组件由重构阶段决定：

| 卡片类型 | 出现页面 |
|----------|----------|
| 首页商品卡 | home/index.wxml |
| 购物车行 | cart/index.wxml |
| 订单卡 | order-list、order-detail、admin/order-manage |
| 售后商品卡 | after-sales/list、after-sales/detail、admin/after-sales/detail |
| 商品选择弹层内卡片 | product-detail/index.wxml（立即购买弹窗） |

---

## 三、单一真源映射

### 3.1 订单状态

| 真源 | 路径 | 消费方 |
|------|------|--------|
| 状态色 | `utils/orderStatus.wxs` → `getOrderStatusColor` | order-list、order-detail、admin/order-manage、admin/dashboard、message/service |
| 状态文案 | `utils/orderStatusText.js` → `getOrderStatusText(status, deliveryType, options)` | 同上 + message/service |

**参数说明**：
- `useLogisticsStateForShipping: true` → 列表展示物流节点名；不传 → 详情显示主状态。
- `afterSalesStatus: 'after_sales_text'` → 管理端「已完成但售后中」显示售后中文。
- 自提订单只有 `pending/paid/completed/cancelled`，无 `shipping/delivered`。

### 3.2 售后状态

| 真源 | 路径 | 内容 |
|------|------|------|
| 售后文案 | `utils/afterSalesStatus.js` | `TYPE_TEXT_MAP` / `STATUS_TEXT_MAP` / `STATUS_DESC_MAP` / `STATUS_DESC_MAP_ADMIN` + 换货覆盖函数 |

用户端（after-sales/list、detail）与管理端（admin/after-sales/detail、admin/order-manage）均已接入。

### 3.3 配送分区色

| 真源 | 路径 | 消费方 |
|------|------|--------|
| 色彩常量 + 图例生成 | `utils/map-utils.js` → `DELIVERY_ZONE_COLORS` / `buildDeliveryLegend()` | order-confirm、order-detail |

### 3.4 退换政策

| 真源 | 字段 | 链路 |
|------|------|------|
| 单商品开关 | `product.supportNoReasonReturn`（布尔，默认 false） | 发布页写入 → 下单快照进 order item → 详情页政策行/标签 → 售后原因过滤 |

- 天数 N 取 `settings.afterSalesTimeConfig.noReasonReturnDays ?? settings.noReasonReturnDays ?? 7`。
- 全局 `settings.buyTips` 仅承载与退换政策无关的全店通用须知，**不得**包含退换政策断言。

---

## 四、已清理的问题（重构时无需再处理）

以下问题已在扫描修复阶段全部处理完毕，列出供确认：

1. **多套实现合并**：搜索筛选（2 套→1 套）、物流弹层（3 处→1 组件）、运费规则弹层（2 处→1 组件）、售后申请（删废弃页）。
2. **弹层统一**：全部自绘遮罩弹层迁移到 modal-shell 基座；wx.showModal 统一到 confirm-dialog。
3. **空态/错误态统一**：全站（用户端 + 管理端）统一为 `.empty-view` / `.error-view` 纯文字样式，旧 5 套类名归零。
4. **僵尸页面清理**：删除 11 个根目录僵尸目录 + 3 个孤儿页，app.json 注册 38 页，零残留引用。
5. **Token 激活**：`:root` → `page` 修正；admin 端 312 处硬编码色迁移到 token；5 处渐变补全深色 token。
6. **wx:key 修正**：全站 20 处无效 `wx:key="{{...}}"` 统一为正确写法（属性名或 `*this`）。
7. **死代码清理**：mixins.wxss 从 387 行到 107 行；售后详情从 645 行到 396 行；购物车从 937 行到 767 行；购物车 170 行死样式删除等。
8. **导航栏白闪**：app.json `navigationBarBackgroundColor` 改为 `#FFFFFF`（与系统默认色一致）。

---

## 五、重构建议与注意事项

### 5.1 组件抽取优先级

如重构涉及卡片组件化，建议按以下优先级：

1. **订单卡** → 出现频率最高（3+ 页面），样式差异需做 props 适配。
2. **商品卡** → 首页与详情弹窗均有，但两处布局差异较大。
3. **售后商品卡** → 用户端与管理端共用，已有文案真源支撑。

### 5.2 仍用原生能力的部分（不要强行迁移）

| 功能 | 原生方案 | 不迁移原因 |
|------|----------|------------|
| 时间/分类选择 | 原生 `picker` | 系统组件，体验最优 |
| 图片预览 | `wx.previewImage` | 系统级全屏浏览，基座不支持全屏 |
| 聊天全屏媒体预览 | 自绘 `media-preview-mask` | 基座不支持全屏沉浸式 |
| 同意/拒绝售后（需输入） | 原生 `wx.showModal` editable | 需要输入框，confirm-dialog 的 editable 未覆盖 |

### 5.3 页面路由现状

- **已注册**：38 页（app.json `pages` 数组）。
- **tabBar**：5 个 tab（首页/分类/消息/购物车/我的）。
- **已清理**：根目录 11 个僵尸目录已删除，不存在未注册但磁盘残留的页面。
- **动态跳转**：全项目不从 `banner.link` 读链接做跳转（已核实），不存在隐式路由依赖。

### 5.4 已知的接受性取舍

| 取舍 | 原因 | 约束 |
|------|------|------|
| 导航栏纯白，与页面灰底有分界 | 消除 tab 切换白闪 | 不要改回 `#F5F5F5` |
| page 不设全局 font-size | 避免 token 首次生效全站跳变 | 改用 `--font-size-body` 需单独评估 |
| admin 端 274 处近似灰阶未 token 化 | 不属于「品牌色 + 精确同值灰阶」口径 | `#333`/`#e0e0e0`/`#f0f0f0` 等，重构时可统一收口 |
| 消息列表预览 24rpx 字号 | 22rpx 在 iOS 下连续 emoji 字形重叠 | 不要降回 22rpx |
| buyTips 缓存 30 分钟 TTL | 用户选择 TTL 方案而非管理端刷新标记 | 管理端改文案后最长 30 分钟生效 |

### 5.5 重构前建议先做的事

1. **admin 端剩余灰阶收口**：274 处 `#333`/`#e0e0e0` 等可统一映射到 `--color-text-main`（比 `#666` 深）、`--color-border` 等。
2. **message/service 页 99 处硬编码色**：用户端已迁移，但聊天页本身硬编码色最多，重构时优先处理。
3. **页面内手写卡片样式核对**：若要抽组件，需先 diff 各页卡片的 class 级差异（此前 order-manage 僵尸页对比已有方法可复用）。
4. **utils/confirm.js 回归**：确认 confirm-dialog 在所有调用点的 cancel/danger/单按钮行为符合预期。

---

## 六、文件索引

| 文件 | 作用 |
|------|------|
| `miniprogram/styles/variables.wxss` | 设计 Token 定义（16 色 + 6 字号 + 5 间距） |
| `miniprogram/styles/mixins.wxss` | 全局基础布局类（5 个） |
| `miniprogram/styles/states.wxss` | 空态/错误态全局样式 |
| `miniprogram/app.wxss` | 全局入口（3 个 @import + page reset） |
| `miniprogram/app.json` | 页面注册（38 页）+ window/tabBar 配置 |
| `miniprogram/utils/orderStatus.wxs` | 订单状态色（WXS，模板内可用） |
| `miniprogram/utils/orderStatusText.js` | 订单状态文案（ESM） |
| `miniprogram/utils/afterSalesStatus.js` | 售后状态文案（4 张映射表 + 换货覆盖） |
| `miniprogram/utils/map-utils.js` | 配送分区色 + 图例生成 |
| `miniprogram/utils/confirm.js` | confirm-dialog 调用入口 |
| `miniprogram/components/modal-shell/` | 弹层基座组件 |
| `miniprogram/components/confirm-dialog/` | 确认对话框组件 |
| `UI架构问题.txt` | 原始扫描记录（15 项，含修复过程） |
