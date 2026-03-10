# 云开发 quickstart

这是云开发的快速启动指引，其中演示了如何上手使用云开发的三大基础能力：

- 数据库：一个既可在小程序前端操作，也能在云函数中读写的 JSON 文档型数据库
- 文件存储：在小程序前端直接上传/下载云端文件，在云开发控制台可视化管理
- 云函数：在云端运行的代码，微信私有协议天然鉴权，开发者只需编写业务逻辑代码

## 项目 TODO

- [ ] 为 Touch the Aura 品牌设计并添加 tabbar 图标资源（`images/tabbar/*.png`），并在 `miniprogram/app.json` 中配置 `iconPath` / `selectedIconPath`
- [ ] banner图点击跳转内容待定，应该跳转显示什么？并且当前banner图不确定是不是从本地读取的，后续要改成从数据库读取，管理员可配置的。
- [ ] 系列主图上的"探索全部"按钮点击后跳转至该系列的商品列表
- [ ] 搜索按钮要开发和野兽派的搜索按钮一致

## 参考文档

- [云开发文档](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)

## 开发日志
第 1 步：技术栈与项目基础（必须先做）
目标：
让 Cursor 确定项目架构。
你要告诉 Cursor：
- 微信原生小程序
- 使用云开发
- 语言
- 项目目录
Cursor Prompt
我们要开发一个微信小程序品牌商城，品牌名 Touch the Aura。
请先帮我建立完整的技术架构，不要写业务代码。
我已经先通过微信开发者工具新建了基础项目，目录就是当前的目录tta。
技术要求：
开发框架
- 微信原生小程序（不是 Taro / uniapp）
- 使用 WXML + WXSS + JavaScript
云开发
- 使用微信云开发（CloudBase）
- 使用 云数据库
- 使用 云存储
- 使用 云函数
小程序结构
- tabbar 4 个页面首页 home分类 category购物车 cart我的 my
订单在 my 页面内部
请生成：
1 项目目录结构
2 app.json 配置
3 tabbar 配置
4 云开发初始化代码
5 全局样式文件
只搭建项目骨架，不写业务逻辑。

第 2 步：UI 设计系统（非常重要）
目标：
统一整个小程序视觉。
Cursor Prompt
为 Touch the Aura 小程序设计一套完整 UI Design System。

品牌信息：

品牌名
Touch the Aura

品牌风格
INS风、轻品牌、极简、质感、艺术感

主色
克莱因蓝 #1A3D8F

辅助色
米白色 #F5F5F5
浅灰 #EAEAEA

商品类型
发圈（主打）
发夹
布料包（耳机包、卡包、手机包、福袋包、挂件包）

设计要求

1 设计小程序配色系统
2 设计字体层级
3 设计按钮风格
4 设计卡片组件
5 设计商品卡片
6 设计商品详情页风格
7 设计购物车UI
8 设计我的页面UI

风格参考
INS风 / Aesop / 极简品牌

输出

1 设计规范
2 全局 WXSS
3 可复用 UI class
这一步完成后：
整个小程序 视觉统一。

第 3 步：页面结构设计
目标：
明确 有哪些页面。
Cursor Prompt
根据以下需求设计微信小程序页面结构。

tabbar：

首页
分类
购物车
我的

品牌类型
轻品牌电商

商品

发圈（主）
发夹
布料包

订单在我的页面

需要的页面：

首页
分类
商品列表
商品详情
购物车
下单
订单列表
订单详情
我的

管理员后台

商品管理
订单管理
发布商品

请输出：

1 pages 目录结构
2 每个页面职责
3 页面跳转关系
4 页面路由

第 4 步：数据库设计（非常关键）
目标：
设计云数据库。
Cursor Prompt
为 Touch the Aura 小程序设计云数据库结构。

使用微信云开发数据库。

需要的数据表：

users
products
orders
cart

要求：

users
用户信息
openid
头像
昵称

products
商品
名称
价格
图片
库存
分类
描述

orders
订单
订单号
商品
金额
订单状态

cart
购物车
用户
商品
数量

请输出：

1 每个 collection 结构
2 字段说明
3 示例数据

第 5 步：通用组件开发
目标：
先做组件。
Cursor Prompt
为小程序开发可复用组件。

组件包括：

商品卡片 product-card
商品列表 product-list
数量选择 quantity-selector
购物车商品 cart-item
订单卡片 order-card

要求：

使用组件模式
component
wxml
wxss
js

UI符合 INS风轻品牌。

第 6 步：首页开发
Cursor Prompt
开发首页 home 页面。

功能：

品牌banner
商品推荐
新品展示

页面结构：

顶部品牌标题
品牌视觉图片
推荐商品列表
新品商品列表

使用 product-card 组件。

数据来自云数据库 products。
