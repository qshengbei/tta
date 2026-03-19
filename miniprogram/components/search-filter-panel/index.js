// components/search-filter-panel/index.js
import { getCollection } from "../../utils/cloud";

Component({
  options: {
    multipleSlots: true
  },
  
  properties: {
    cartItems: {
      type: Array,
      value: [],
      observer: function(newVal) {
        if (newVal && newVal.length > 0) {
          this.setData({
            cartItems: newVal
          });
        }
      }
    },
    loading: {
      type: Boolean,
      value: false
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
      category: [],
      inStock: null
    },
    selectedCategories: {},
    categoryGroups: []
  },
  
  lifetimes: {
    attached: function() {
      // 加载搜索历史
      this.loadSearchHistory();
      // 加载商品类别
      this.loadProductCategories();
    }
  },
  
  methods: {
    // 加载搜索历史
    loadSearchHistory() {
      const searchHistory = wx.getStorageSync('cartSearchHistory') || [];
      this.setData({ searchHistory });
    },

    // 保存搜索历史
    saveSearchHistory(keyword) {
      if (!keyword.trim()) return;
      
      let searchHistory = wx.getStorageSync('cartSearchHistory') || [];
      // 移除重复的关键词
      searchHistory = searchHistory.filter(item => item !== keyword);
      // 添加到开头
      searchHistory.unshift(keyword);
      // 限制历史记录数量
      if (searchHistory.length > 10) {
        searchHistory = searchHistory.slice(0, 10);
      }
      // 保存到本地存储
      wx.setStorageSync('cartSearchHistory', searchHistory);
      this.setData({ searchHistory });
    },

    // 清除搜索历史
    clearSearchHistory() {
      wx.removeStorageSync('cartSearchHistory');
      this.setData({ searchHistory: [] });
    },

    // 处理搜索输入
    handleSearchInput(e) {
      const keyword = e.detail.value;
      this.setData({ searchKeyword: keyword });
      
      // 防抖处理
      this.debounce(() => {
        this.performSearch(keyword);
      }, 300)();
    },

    // 执行搜索
    performSearch(keyword) {
      if (!keyword) {
        this.setData({ 
          searchSuggestions: []
        });
        // 触发搜索事件，传递空关键词
        this.triggerEvent('search', { keyword: '', filteredItems: this.data.cartItems });
        return;
      }
      
      // 生成搜索建议
      this.generateSearchSuggestions(keyword);
      
      // 过滤商品
      const filteredItems = this.data.cartItems.filter(item => {
        const name = item.name || '';
        const description = item.description || '';
        const category = item.category || '';
        return name.includes(keyword) || description.includes(keyword) || category.includes(keyword);
      });
      
      // 触发搜索事件
      this.triggerEvent('search', { keyword, filteredItems });
    },

    // 处理搜索确认
    handleSearchConfirm(e) {
      const keyword = e.detail.value;
      if (keyword) {
        // 保存搜索历史
        this.saveSearchHistory(keyword);
        // 执行搜索
        this.performSearch(keyword);
        // 隐藏搜索面板
        this.setData({ showSearchPanel: false });
      }
    },

    // 生成搜索建议
    generateSearchSuggestions(keyword) {
      const allKeywords = [];
      this.data.cartItems.forEach(item => {
        if (item.name) allKeywords.push(item.name);
        if (item.description) allKeywords.push(item.description);
        if (item.category) allKeywords.push(item.category);
      });
      
      const uniqueKeywords = [...new Set(allKeywords)];
      const suggestions = uniqueKeywords.filter(item => 
        item.includes(keyword) && item !== keyword
      ).slice(0, 5);
      
      this.setData({ searchSuggestions: suggestions });
    },

    // 清除搜索
    clearSearch() {
      this.setData({ 
        searchKeyword: '',
        searchSuggestions: []
      });
      // 触发搜索事件，传递空关键词
      this.triggerEvent('search', { keyword: '', filteredItems: this.data.cartItems });
    },

    // 显示搜索面板
  showSearchPanel() {
    this.setData({ showSearchPanel: true });
  },

  // 隐藏搜索面板
  hideSearchPanel() {
    this.setData({ showSearchPanel: false });
  },

  // 使用搜索历史
    useSearchHistory(e) {
      const keyword = e.currentTarget.dataset.keyword;
      this.setData({ 
        searchKeyword: keyword
      });
      // 保存搜索历史
      this.saveSearchHistory(keyword);
      // 执行搜索
      this.performSearch(keyword);
      // 隐藏搜索面板
      this.setData({ showSearchPanel: false });
    },

    // 使用搜索建议
    useSearchSuggestion(e) {
      const keyword = e.currentTarget.dataset.keyword;
      this.setData({ 
        searchKeyword: keyword
      });
      // 保存搜索历史
      this.saveSearchHistory(keyword);
      // 执行搜索
      this.performSearch(keyword);
      // 隐藏搜索面板
      this.setData({ showSearchPanel: false });
    },

  // 显示筛选面板
  showFilterPanel() {
    this.setData({ showFilterPanel: true });
  },

  // 隐藏筛选面板
  hideFilterPanel() {
    this.setData({ showFilterPanel: false });
  },

    // 阻止事件冒泡
    stopPropagation() {
      // 空方法，用于阻止事件冒泡
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
      
      // 直接更新所有相关数据
      this.setData({ 
        selectedCategories: selectedCategories,
        filterOptions: newFilterOptions
      });
    },

    // 选择库存状态
    selectStockStatus(e) {
      let status = e.currentTarget.dataset.status;
      // 转换status为正确的类型
      if (status === 'null') {
        status = null;
      } else if (status === 'true') {
        status = true;
      } else if (status === 'false') {
        status = false;
      }
      const filterOptions = { ...this.data.filterOptions };
      // 库存状态只能单选，直接设置为选中的状态
      filterOptions.inStock = status;
      
      // 直接更新所有相关数据
      this.setData({ 
        filterOptions: filterOptions
      });
    },

    // 重置筛选条件
    resetFilter() {
      const filterOptions = {
        category: [],
        inStock: null
      };
      
      // 直接更新所有相关数据
      this.setData({ 
        filterOptions: filterOptions,
        selectedCategories: {}
      });
    },

    // 应用筛选
    applyFilter() {
      const { filterOptions, cartItems } = this.data;
      
      let filteredItems = [...cartItems];
      
      // 按类别筛选
      if (filterOptions.category && filterOptions.category.length > 0) {
        // 筛选商品类别在选择的分类数组中的商品
        filteredItems = filteredItems.filter(item => {
          // 检查商品是否有typeId
          if (item.typeId) {
            // 直接检查商品的typeId是否在选择的分类数组中
            for (let i = 0; i < filterOptions.category.length; i++) {
              if (item.typeId === filterOptions.category[i]) {
                return true;
              }
            }
          }
          
          return false;
        });
      }
      
      // 按库存状态筛选
      if (filterOptions.inStock !== null) {
        filteredItems = filteredItems.filter(item => {
          if (filterOptions.inStock) {
            return item.stock > 0;
          } else {
            return item.stock <= 0;
          }
        });
      }
      
      this.setData({ 
        showFilterPanel: false
      });
      
      // 保存筛选状态到本地存储
      wx.setStorageSync('cartFilterOptions', filterOptions);
      
      // 触发筛选事件
      this.triggerEvent('filter', { filterOptions, filteredItems });
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

    // 防抖函数
    debounce(func, delay) {
      let timer = null;
      return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          func.apply(this, args);
        }, delay);
      };
    }
  }
});