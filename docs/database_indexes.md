# 数据库索引配置清单

> 生成时间：2026-05-27
>
> 使用说明：
> 1. 登录微信云开发控制台
> 2. 进入「数据库」-> 选择目标集合 ->「索引管理」
> 3. 点击「新建索引」，复制下方配置进行创建
> 4. 按优先级顺序创建，P0 为必须创建

---

## 📋 索引优先级说明

| 优先级 | 图标 | 说明 | 建议 |
|--------|------|------|------|
| P0 | 🔴 | 关键性能索引 | **必须创建**，影响核心功能 |
| P1 | 🟡 | 重要优化索引 | 建议创建，提升查询效率 |
| P2 | 🟢 | 可选优化索引 | 根据需要创建 |

---

---

## 🔴 P0 关键性能索引（13个）

### 📦 orders 订单集合

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 1 | idx_orders_user_status_updated | _openid (asc) → isDeleted (asc) → status (asc) → updatedAt (desc) | 用户订单列表（按状态筛选+时间排序） |
| 2 | idx_orders_user_updated | _openid (asc) → isDeleted (asc) → updatedAt (desc) | 用户全部订单（实时监听） |

---

### 🛍️ products 商品集合

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 3 | idx_products_deleted_status_time | isDeleted (asc) → status (asc) → createTime (desc) | 首页/分类商品列表 |
| 4 | idx_products_deleted_typeid_time | isDeleted (asc) → typeId (asc) → createTime (desc) | 分类商品查询 |

---

### 💬 sessions 会话集合

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 5 | idx_sessions_userid_time | userId (asc) → lastMessageTime (desc) | 用户会话列表 |
| 6 | idx_sessions_cs_time | customerServiceId (asc) → lastMessageTime (desc) | 客服会话列表 |
| 7 | idx_sessions_active | activeSessions (asc) | 客服分配（最少会话优先） |

---

### 📨 messages 消息集合

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 8 | idx_messages_session_time | sessionId (asc) → createTime (desc) | 会话消息列表 |

---

### 📢 notifications 通知集合

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 9 | idx_notifications_openid_isdelete_type_status | openid (asc) → isDelete (asc) → type (asc) → status (asc) → createdAt (desc) | 通知分类统计查询（高效查询） |
| 10 | idx_notifications_openid_isdelete_status_time | openid (asc) → isDelete (asc) → status (asc) → createdAt (desc) | 用户未读通知查询 |
| 11 | idx_notifications_openid_isdelete_time | openid (asc) → isDelete (asc) → createdAt (desc) | 用户全部通知查询/实时监听 |

---

### 🛒 cart 购物车集合

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 11 | idx_cart_openid_deleted_time | _openid (asc) → isDelete (asc) → updatedAt (desc) | 用户购物车列表 |

---

### 🎫 after_sales_cases 售后案例集合

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 12 | idx_after_cases_openid_time | _openid (asc) → createdAt (desc) | 用户售后列表 |
| 13 | idx_after_cases_openid_status_time | _openid (asc) → status (asc) → createdAt (desc) | 用户售后列表（按状态筛选） |

---

### 📋 after_sales_case_items 售后案例明细集合

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 14 | idx_after_items_case_time | caseId (asc) → createdAt (asc) | 售后明细列表 |

---

---

## 🟡 P1 重要优化索引（18个）

### 📦 orders 订单集合（继续）

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 15 | idx_orders_status_created | status (asc) → createdAt (desc) | 管理员订单列表（按状态+时间） |
| 16 | idx_orders_status_updated | status (asc) → updatedAt (desc) | 订单状态查询 |
| 17 | idx_orders_delivery_type | deliveryType (asc) | 按配送类型筛选 |

---

### 🛍️ products 商品集合（继续）

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 18 | idx_products_deleted_typeid | isDeleted (asc) → typeId (asc) | 分类商品统计 |
| 19 | idx_products_status_time | status (asc) → createTime (desc) | 商品列表（按状态+时间） |
| 20 | idx_products_categoryid | categoryId (asc) | 按大类查询商品 |

---

### 💬 sessions 会话集合（继续）

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 21 | idx_sessions_last_time | lastMessageTime (desc) | 全局按最后消息排序 |

---

### 📨 messages 消息集合（继续）

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 22 | idx_messages_sessionid | sessionId (asc) | 按会话查询消息数 |

---

### 📢 notifications 通知集合（继续）

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 23 | idx_notifications_status_updated | status (asc) → updatedAt (desc) | 管理员通知管理 |

---

### 🛒 cart 购物车集合（继续）

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 24 | idx_cart_openid_time | _openid (asc) → updatedAt (desc) | 购物车实时监听 |

---

### 🎫 after_sales_cases 售后案例集合（继续）

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 25 | idx_after_cases_orderid | orderId (asc) | 按订单查询售后 |
| 26 | idx_after_cases_status_time | status (asc) → createdAt (desc) | 管理员售后列表 |

---

### 📋 after_sales_case_items 售后案例明细集合（继续）

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 27 | idx_after_items_orderid | orderId (asc) | 按订单查询售后明细 |

---

### 🏷️ category 分类集合

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 28 | idx_category_status_time | status (asc) → createTime (desc) | 启用分类列表 |

---

### 📁 product_types 商品类型集合

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 29 | idx_types_level_parent_sort | level (asc) → parentId (asc) → sort (asc) | 商品类型层级查询 |
| 30 | idx_types_parent_sort | parentId (asc) → sort (asc) | 子级类型排序 |
| 31 | idx_types_sort | sort (asc) | 类型全局排序 |

---

---

## 🟢 P2 可选优化索引（3个）

### 📝 after_sales_logs 售后日志集合

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 32 | idx_after_logs_case_time | caseId (asc) → createdAt (asc) | 售后日志查询 |

---

### 🚛 reverse_logistics 逆向物流集合

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 33 | idx_reverse_orderid | orderId (asc) | 按订单查询物流 |

---

### 📄 notification_templates 通知模板集合

| 序号 | 索引名称 | 字段配置 | 说明 |
|------|---------|---------|------|
| 34 | idx_templates_type | type (asc) | 按类型查询模板 |

---

---

## 📊 索引配置统计

| 优先级 | 数量 | 占比 |
|--------|------|------|
| 🔴 P0 | 13 | 38.2% |
| 🟡 P1 | 18 | 52.9% |
| 🟢 P2 | 3 | 8.8% |
| **总计** | **34** | **100%** |

| 集合 | 索引数量 |
|------|---------|
| orders | 5 |
| products | 5 |
| sessions | 4 |
| messages | 2 |
| notifications | 3 |
| cart | 2 |
| after_sales_cases | 4 |
| after_sales_case_items | 2 |
| category | 1 |
| product_types | 3 |
| after_sales_logs | 1 |
| reverse_logistics | 1 |
| notification_templates | 1 |

---

---

## 🛠️ 创建索引步骤说明

### 方法一：单个索引创建

1. 登录微信云开发控制台
2. 进入「数据库」→ 选择目标集合
3. 点击「索引管理」标签
4. 点击「新建索引」按钮
5. 复制下方配置：
   - 索引名称：如 `idx_orders_user_status_updated`
   - 索引字段：点击「添加字段」，依次添加
     - 字段名：如 `_openid`，排序：升序（asc）
     - 字段名：如 `isDeleted`，排序：升序（asc）
     - 字段名：如 `status`，排序：升序（asc）
     - 字段名：如 `updatedAt`，排序：降序（desc）
6. 点击「确定」完成创建

### 方法二：批量创建（推荐先创建 P0）

建议先创建所有 P0 索引，再创建 P1，最后创建 P2：

1. **第一阶段**（必须）：创建所有 P0 索引（1-14）
2. **第二阶段**（建议）：创建所有 P1 索引（15-31）
3. **第三阶段**（可选）：创建所有 P2 索引（32-34）

---

---

## 💡 快速索引创建清单（复制使用）

### 🔴 P0 索引快速创建表

| 集合 | 索引名称 | 字段列表 |
|------|---------|---------|
| orders | idx_orders_user_status_updated | _openid(asc), isDeleted(asc), status(asc), updatedAt(desc) |
| orders | idx_orders_user_updated | _openid(asc), isDeleted(asc), updatedAt(desc) |
| products | idx_products_deleted_status_time | isDeleted(asc), status(asc), createTime(desc) |
| products | idx_products_deleted_typeid_time | isDeleted(asc), typeId(asc), createTime(desc) |
| sessions | idx_sessions_userid_time | userId(asc), lastMessageTime(desc) |
| sessions | idx_sessions_cs_time | customerServiceId(asc), lastMessageTime(desc) |
| sessions | idx_sessions_active | activeSessions(asc) |
| messages | idx_messages_session_time | sessionId(asc), createTime(desc) |
| notifications | idx_notifications_openid_isdelete_type_status | openid(asc), isDelete(asc), type(asc), status(asc), createdAt(desc) |
| notifications | idx_notifications_openid_isdelete_status_time | openid(asc), isDelete(asc), status(asc), createdAt(desc) |
| notifications | idx_notifications_openid_isdelete_time | openid(asc), isDelete(asc), createdAt(desc) |
| cart | idx_cart_openid_deleted_time | _openid(asc), isDelete(asc), updatedAt(desc) |
| after_sales_cases | idx_after_cases_openid_time | _openid(asc), createdAt(desc) |
| after_sales_cases | idx_after_cases_openid_status_time | _openid(asc), status(asc), createdAt(desc) |
| after_sales_case_items | idx_after_items_case_time | caseId(asc), createdAt(asc) |

### 🟡 P1 索引快速创建表

| 集合 | 索引名称 | 字段列表 |
|------|---------|---------|
| orders | idx_orders_status_created | status(asc), createdAt(desc) |
| orders | idx_orders_status_updated | status(asc), updatedAt(desc) |
| orders | idx_orders_delivery_type | deliveryType(asc) |
| products | idx_products_deleted_typeid | isDeleted(asc), typeId(asc) |
| products | idx_products_status_time | status(asc), createTime(desc) |
| products | idx_products_categoryid | categoryId(asc) |
| sessions | idx_sessions_last_time | lastMessageTime(desc) |
| messages | idx_messages_sessionid | sessionId(asc) |
| notifications | idx_notifications_status_updated | status(asc), updatedAt(desc) |
| cart | idx_cart_openid_time | _openid(asc), updatedAt(desc) |
| after_sales_cases | idx_after_cases_orderid | orderId(asc) |
| after_sales_cases | idx_after_cases_status_time | status(asc), createdAt(desc) |
| after_sales_case_items | idx_after_items_orderid | orderId(asc) |
| category | idx_category_status_time | status(asc), createTime(desc) |
| product_types | idx_types_level_parent_sort | level(asc), parentId(asc), sort(asc) |
| product_types | idx_types_parent_sort | parentId(asc), sort(asc) |
| product_types | idx_types_sort | sort(asc) |

### 🟢 P2 索引快速创建表

| 集合 | 索引名称 | 字段列表 |
|------|---------|---------|
| after_sales_logs | idx_after_logs_case_time | caseId(asc), createdAt(asc) |
| reverse_logistics | idx_reverse_orderid | orderId(asc) |
| notification_templates | idx_templates_type | type(asc) |

---

---

## 📝 注意事项

1. **创建顺序**：建议先创建 P0，再创建 P1，最后创建 P2
2. **字段名大小写**：注意字段名的大小写与数据库保持一致
3. **排序方式**：asc=升序，desc=降序，不要搞错
4. **已有索引**：如果索引已存在会提示错误，跳过即可
5. **性能影响**：创建索引期间会有短暂的性能影响，建议低峰期创建

---

**文档生成时间**：2026-05-27
**索引总数**：34个
**覆盖集合数**：13个
