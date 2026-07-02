const { getCollection } = require("../../utils/cloud");

Component({
  properties: {
      orders: {
        type: Array,
        value: []
      },
    loading: {
      type: Boolean,
      value: false
    },
    filterOptions: {
      type: Object,
      value: {
        timeRange: null,
        category: []
      },
      observer(newVal) {
        if (newVal) {
          this.setData({ filterOptions: newVal });
        }
      }
    },
    pageType: {
      type: String,
      value: 'adminOrder'
    }
  },
  
  data: {
    // 搜索相关
    searchKeyword: '',
    searchHistory: [],
    searchSuggestions: [],
    showSearchPanel: false,
    
    // 筛选相关
    showFilterPanel: false,
    filterOptions: {
      timeRange: null,     // 时间范围
      category: []         // 商品分类
    },
    selectedCategories: {},
    categoryGroups: [],
    activeFilterCount: 0,
    // 用于保存打开筛选面板前的筛选条件
    previousFilterOptions: {},
    previousSelectedCategories: {},
    previousActiveFilterCount: 0,
    // 标记是否点击了应用按钮
    applied: false
  },
  
  lifetimes: {
    attached() {
      // 加载搜索历史
      this.loadSearchHistory();
      // 加载商品类别
      this.loadProductCategories();
    }
  },
  
  methods: {
    // 加载搜索历史
    loadSearchHistory() {
      const storageKey = this.getStorageKey();
      const searchHistory = wx.getStorageSync(storageKey) || [];
      this.setData({ searchHistory });
    },
    
    // 保存搜索历史
    saveSearchHistory(keyword) {
      if (!keyword) return;
      
      const storageKey = this.getStorageKey();
      let searchHistory = wx.getStorageSync(storageKey) || [];
      // 移除重复项
      searchHistory = searchHistory.filter(item => item !== keyword);
      // 添加到开头
      searchHistory.unshift(keyword);
      // 限制数量
      if (searchHistory.length > 10) {
        searchHistory = searchHistory.slice(0, 10);
      }
      wx.setStorageSync(storageKey, searchHistory);
      this.setData({ searchHistory });
    },
    
    // 获取存储键名
    getStorageKey() {
      return `${this.properties.pageType}SearchHistory`;
    },
    
    // 处理搜索输入
    handleSearchInput(e) {
      const keyword = e.detail.value;
      this.setData({ searchKeyword: keyword });
      
      // 生成搜索建议
      this.generateSearchSuggestions(keyword);
    },
    
    // 生成搜索建议
    generateSearchSuggestions(keyword) {
      if (!keyword) {
        this.setData({ searchSuggestions: [] });
        return;
      }
      
      const suggestions = [];
      const orders = this.properties.orders;
      
      // 从订单中提取关键词
      orders.forEach(order => {
        // 订单编号
        if (order.orderNumber && order.orderNumber.includes(keyword)) {
          suggestions.push(order.orderNumber);
        }
        
        // 商品名称
        if (order.products) {
          order.products.forEach(product => {
            if (product.name && product.name.includes(keyword)) {
              suggestions.push(product.name);
            }
          });
        }
      });
      
      // 去重
      const uniqueSuggestions = [...new Set(suggestions)].slice(0, 5);
      this.setData({ searchSuggestions: uniqueSuggestions });
    },
    
    // 处理搜索确认
    handleSearchConfirm() {
      const keyword = this.data.searchKeyword.trim();
      if (keyword) {
        this.saveSearchHistory(keyword);
        
        const orders = this.properties.orders;
        
        // 根据搜索关键词过滤订单
        const filteredOrders = orders.filter(order => {
          // 订单编号
          if (order.orderNumber && order.orderNumber.includes(keyword)) {
            return true;
          }
          
          // 商品名称
          if (order.products) {
            for (let i = 0; i < order.products.length; i++) {
              const product = order.products[i];
              if (product.name && product.name.includes(keyword)) {
                return true;
              }
            }
          }
          
          return false;
        });
        
        // 触发搜索事件
        this.triggerEvent('search', { keyword, filteredOrders });
        this.hideSearchPanel();
      }
    },
    
    // 清除搜索
    clearSearch() {
      this.setData({ searchKeyword: '', searchSuggestions: [] });
      // 触发清除搜索事件，通知父页面
      this.triggerEvent('clearSearch');
    },
    
    // 显示搜索面板
    showSearchPanel() {
      this.setData({ showSearchPanel: true });
    },
    
    // 隐藏搜索面板
    hideSearchPanel() {
      this.setData({ showSearchPanel: false });
    },
    
    // 显示筛选面板
    showFilterPanel() {
      // 保存当前的筛选条件
      const { filterOptions, selectedCategories, activeFilterCount } = this.data;
      this.setData({
        previousFilterOptions: JSON.parse(JSON.stringify(filterOptions)),
        previousSelectedCategories: JSON.parse(JSON.stringify(selectedCategories)),
        previousActiveFilterCount: activeFilterCount,
        applied: false
      });
      
      // 根据 filterOptions.category 数组更新 selectedCategories 对象
      const newSelectedCategories = {};
      if (filterOptions.category && filterOptions.category.length > 0) {
        filterOptions.category.forEach(categoryId => {
          newSelectedCategories[categoryId] = true;
        });
      }
      this.setData({ 
        selectedCategories: newSelectedCategories,
        showFilterPanel: true 
      });
    },
    
    // 隐藏筛选面板
    hideFilterPanel() {
      // 如果没有点击应用按钮，恢复之前的筛选条件
      if (!this.data.applied) {
        this.setData({
          filterOptions: JSON.parse(JSON.stringify(this.data.previousFilterOptions)),
          selectedCategories: JSON.parse(JSON.stringify(this.data.previousSelectedCategories)),
          activeFilterCount: this.data.previousActiveFilterCount
        });
      }
      this.setData({ showFilterPanel: false });
    },
    
    // 停止事件冒泡
    stopPropagation() {
      // catchtap已自动阻止事件冒泡
    },
    
    // 使用搜索建议
    useSearchSuggestion(e) {
      const keyword = e.currentTarget.dataset.keyword;
      this.setData({ searchKeyword: keyword });
      this.handleSearchConfirm();
    },
    
    // 使用搜索历史
    useSearchHistory(e) {
      const keyword = e.currentTarget.dataset.keyword;
      this.setData({ searchKeyword: keyword });
      this.handleSearchConfirm();
    },
    
    // 清除搜索历史
    clearSearchHistory() {
      const storageKey = this.getStorageKey();
      wx.removeStorageSync(storageKey);
      this.setData({ searchHistory: [] });
    },
    
    // 选择时间范围
    selectTimeRange(e) {
      const range = e.currentTarget.dataset.range;
      let newRange = range;
      
      // 如果点击的是全部选项，设置为null
      if (range === 'all') {
        newRange = null;
      }
      // 如果点击的是当前已选中的非全部选项，则取消选中
      else if (this.data.filterOptions.timeRange === range) {
        newRange = null;
      }
      
      const filterOptions = { ...this.data.filterOptions, timeRange: newRange };
      this.setData({ filterOptions });
      this.updateActiveFilterCount();
    },
    
    // 更新激活的筛选数量
    updateActiveFilterCount() {
      const { filterOptions } = this.data;
      let count = 0;
      
      if (filterOptions.timeRange !== null) count++;
      if (filterOptions.category && filterOptions.category.length > 0) count += filterOptions.category.length;
      
      this.setData({ activeFilterCount: count });
    },
    
    // 选择商品类别
    selectCategory(e) {
      const categoryId = e.currentTarget.dataset.categoryId;
      const categoryName = e.currentTarget.dataset.categoryName;
      const level = e.currentTarget.dataset.level;
      const parentId = e.currentTarget.dataset.parentId;
      
      // 直接修改data中的selectedCategories
      const selectedCategories = { ...this.data.selectedCategories };
      
      if (level == 1) { // 使用==而不是===，因为level是字符串
        // 如果是一级分类，切换选择状态
        const isSelected = selectedCategories[categoryId] || false;
        
        // 查找该一级分类下的所有二级分类
        const level1Group = this.data.categoryGroups.find(group => group._id === categoryId);
        let level2CategoryIds = [];
        if (level1Group && level1Group.subCategories) {
          level2CategoryIds = level1Group.subCategories.map(item => item._id);
        }
        
        if (isSelected) {
          // 如果已选择，取消选择一级分类和所有二级分类
          delete selectedCategories[categoryId];
          level2CategoryIds.forEach(subId => {
            delete selectedCategories[subId];
          });
        } else {
          // 如果未选择，选择一级分类和所有二级分类
          selectedCategories[categoryId] = true;
          level2CategoryIds.forEach(subId => {
            selectedCategories[subId] = true;
          });
        }
      } else {
        // 如果是二级分类，切换选择状态
        const isSelected = selectedCategories[categoryId] || false;
        if (isSelected) {
          // 如果已选择，取消选择
          delete selectedCategories[categoryId];
        } else {
          // 如果未选择，添加选择
          selectedCategories[categoryId] = true;
        }
      }
      
      // 更新filterOptions.category数组
      const categoryArray = Object.keys(selectedCategories);
      const newFilterOptions = { ...this.data.filterOptions, category: categoryArray };
      
      // 计算活跃筛选条件数量
      let activeFilterCount = categoryArray.length;
      if (newFilterOptions.timeRange !== null) activeFilterCount++;
      
      // 直接更新所有相关数据
      this.setData({ 
        selectedCategories: selectedCategories,
        filterOptions: newFilterOptions,
        activeFilterCount: activeFilterCount
      });
    },
    
    // 重置筛选
    resetFilters() {
      const filterOptions = {
        timeRange: null,
        category: []
      };
      this.setData({ 
        filterOptions: filterOptions,
        selectedCategories: {},
        activeFilterCount: 0
      });
    },
    
    // 加载商品类别
    loadProductCategories() {
      const productTypes = getCollection('product_types');
      productTypes.get()
        .then(res => {
          let categories = [];
          let categoryGroups = [];
          if (res.data && res.data.length > 0) {
            // 分离一级分类和二级分类
            const level1Types = res.data.filter(type => type.level === 1);
            const level2Types = res.data.filter(type => type.level === 2);
            
            // 处理一级分类，添加对应的二级分类
            level1Types.forEach(type => {
              // 创建分类组
              const categoryGroup = {
                _id: type._id,
                name: type.name,
                level: 1,
                subCategories: []
              };
              // 查找该一级分类下的所有二级分类
              const subTypes = level2Types.filter(subType => subType.parentId === type._id);
              if (subTypes.length > 0) {
                subTypes.forEach(subType => {
                  categoryGroup.subCategories.push({
                    _id: subType._id,
                    name: subType.name,
                    level: 2,
                    parent: type.name,
                    parentId: type._id
                  });
                });
              }
              categoryGroups.push(categoryGroup);
            });
          } else {
            // 添加默认分类数据，用于测试
            categoryGroups = [
              {
                _id: 'type_001',
                name: '发圈',
                level: 1,
                subCategories: [
                  { _id: 'type_004', name: '小号单层发圈', level: 2, parent: '发圈', parentId: 'type_001' },
                  { _id: 'type_005', name: '单层发圈', level: 2, parent: '发圈', parentId: 'type_001' },
                  { _id: 'type_006', name: '双层发圈', level: 2, parent: '发圈', parentId: 'type_001' },
                  { _id: 'type_007', name: '方巾', level: 2, parent: '发圈', parentId: 'type_001' }
                ]
              },
              {
                _id: 'type_002',
                name: '发夹',
                level: 1,
                subCategories: [
                  { _id: 'type_008', name: '蝴蝶结发夹', level: 2, parent: '发夹', parentId: 'type_002' },
                  { _id: 'type_009', name: '堆堆夹', level: 2, parent: '发夹', parentId: 'type_002' }
                ]
              },
              {
                _id: 'type_003',
                name: '布包',
                level: 1,
                subCategories: [
                  { _id: 'type_010', name: '挂件耳机包', level: 2, parent: '布包', parentId: 'type_003' },
                  { _id: 'type_011', name: '纽扣耳机包', level: 2, parent: '布包', parentId: 'type_003' },
                  { _id: 'type_012', name: '卡包', level: 2, parent: '布包', parentId: 'type_003' },
                  { _id: 'type_013', name: '福袋包', level: 2, parent: '布包', parentId: 'type_003' },
                  { _id: 'type_014', name: '手机挎包', level: 2, parent: '布包', parentId: 'type_003' },
                  { _id: 'type_015', name: '单肩包', level: 2, parent: '布包', parentId: 'type_003' }
                ]
              }
            ];
          }
          this.setData({ 
            categoryGroups: categoryGroups
          });
        })
        .catch(err => {
          console.error('获取商品类别失败:', err);
          // 加载失败时使用默认分类数据
          const categoryGroups = [
            {
              _id: 'type_001',
              name: '发圈',
              level: 1,
              subCategories: [
                { _id: 'type_004', name: '小号单层发圈', level: 2, parent: '发圈', parentId: 'type_001' },
                { _id: 'type_005', name: '单层发圈', level: 2, parent: '发圈', parentId: 'type_001' },
                { _id: 'type_006', name: '双层发圈', level: 2, parent: '发圈', parentId: 'type_001' },
                { _id: 'type_007', name: '方巾', level: 2, parent: '发圈', parentId: 'type_001' }
              ]
            },
            {
              _id: 'type_002',
              name: '发夹',
              level: 1,
              subCategories: [
                { _id: 'type_008', name: '蝴蝶结发夹', level: 2, parent: '发夹', parentId: 'type_002' },
                { _id: 'type_009', name: '堆堆夹', level: 2, parent: '发夹', parentId: 'type_002' }
              ]
            },
            {
              _id: 'type_003',
              name: '布包',
              level: 1,
              subCategories: [
                { _id: 'type_010', name: '挂件耳机包', level: 2, parent: '布包', parentId: 'type_003' },
                { _id: 'type_011', name: '纽扣耳机包', level: 2, parent: '布包', parentId: 'type_003' },
                { _id: 'type_012', name: '卡包', level: 2, parent: '布包', parentId: 'type_003' },
                { _id: 'type_013', name: '福袋包', level: 2, parent: '布包', parentId: 'type_003' },
                { _id: 'type_014', name: '手机挎包', level: 2, parent: '布包', parentId: 'type_003' },
                { _id: 'type_015', name: '单肩包', level: 2, parent: '布包', parentId: 'type_003' }
              ]
            }
          ];
          this.setData({ 
            categoryGroups: categoryGroups
          });
        });
    },
    
    // 确认筛选
    confirmFilters() {
      // 标记为已应用
      this.setData({ applied: true });
      
      const { filterOptions } = this.data;
      const keyword = this.data.searchKeyword.trim();
      const orders = this.properties.orders;
      
      console.log('=== 开始筛选 ===');
      console.log('原始订单数量:', orders.length);
      console.log('筛选条件:', filterOptions);
      console.log('订单数据:', orders);
      
      // 基于当前搜索后的结果进行筛选（如果有搜索关键词）
      let baseOrders = [...orders];
      if (keyword) {
        baseOrders = baseOrders.filter(order => {
          // 订单编号
          if (order.orderNumber && order.orderNumber.includes(keyword)) {
            return true;
          }
          
          // 商品名称
          if (order.products) {
            for (let i = 0; i < order.products.length; i++) {
              const product = order.products[i];
              if (product.name && product.name.includes(keyword)) {
                return true;
              }
            }
          }
          
          return false;
        });
        console.log('搜索后订单数量:', baseOrders.length);
      }
      
      // 应用筛选条件
      let filteredOrders = [...baseOrders];
      
      // 按时间范围筛选
      if (filterOptions.timeRange !== null) {
        const now = new Date();
        let startTime;
        switch (filterOptions.timeRange) {
          case '7days':
            startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case '30days':
            startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
          case '90days':
            startTime = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            break;
          default:
            startTime = null;
        }
        if (startTime) {
          console.log('开始时间:', startTime);
          
          filteredOrders = filteredOrders.filter(order => {
            let orderTime;
            try {
              // 尝试转换createdAt或updatedAt
              let timeValue = order.createdAt || order.updatedAt;
              
              // 检查timeValue的类型
              if (typeof timeValue === 'object' && timeValue !== null) {
                // 如果是对象，尝试转换为字符串
                if (timeValue.toISOString) {
                  // 是Date对象
                  orderTime = timeValue;
                } else {
                  // 是普通对象，尝试获取其中的时间值
                  if (timeValue.$date) {
                    // 是MongoDB的日期格式
                    orderTime = new Date(timeValue.$date);
                  } else {
                    // 其他类型的对象，使用7天前的时间
                    orderTime = new Date(startTime.getTime() - 1);
                  }
                }
              } else if (timeValue) {
                // 是字符串或其他类型
                orderTime = new Date(timeValue);
              } else {
                // 时间值为空，使用7天前的时间
                orderTime = new Date(startTime.getTime() - 1);
              }
              
              // 如果转换结果是Invalid Date，使用7天前的时间
              if (isNaN(orderTime.getTime())) {
                orderTime = new Date(startTime.getTime() - 1);
              }
            } catch (error) {
              // 如果转换出错，使用7天前的时间
              orderTime = new Date(startTime.getTime() - 1);
            }
            console.log('订单时间:', order.createdAt, '转换后:', orderTime);
            return orderTime > startTime;
          });
          console.log('时间筛选后订单数量:', filteredOrders.length);
        }
      }
      
      // 按商品类别筛选
      if (filterOptions.category && filterOptions.category.length > 0) {
        console.log('筛选的类别ID:', filterOptions.category);
        
        // 检查每个订单的商品信息
        orders.forEach((order, index) => {
          console.log(`订单 ${index + 1} 商品信息:`);
          if (order.products) {
            order.products.forEach((product, pIndex) => {
              console.log(`  商品 ${pIndex + 1}: name=${product.name}, typeId=${product.typeId}`);
            });
          }
          if (order.productsList) {
            order.productsList.forEach((product, pIndex) => {
              console.log(`  商品 ${pIndex + 1}: name=${product.name}, typeId=${product.typeId}`);
            });
          }
        });
        
        filteredOrders = filteredOrders.filter(order => {
          // 检查products字段
          if (order.products) {
            for (let i = 0; i < order.products.length; i++) {
              const product = order.products[i];
              if (product.typeId && filterOptions.category.includes(product.typeId)) {
                console.log('匹配到商品（products）:', product.name, product.typeId);
                return true;
              }
            }
          }
          // 检查productsList字段
          if (order.productsList) {
            for (let i = 0; i < order.productsList.length; i++) {
              const product = order.productsList[i];
              if (product.typeId && filterOptions.category.includes(product.typeId)) {
                console.log('匹配到商品（productsList）:', product.name, product.typeId);
                return true;
              }
            }
          }
          return false;
        });
        console.log('类别筛选后订单数量:', filteredOrders.length);
      }
      
      console.log('=== 筛选结束 ===');
      
      // 触发筛选事件
      this.triggerEvent('filter', { filterOptions, filteredOrders });
      this.hideFilterPanel();
    }
  }
});