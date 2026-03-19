import { getCollection } from "../../utils/cloud";
import { getProductsDetail, isProductSoldOut, calculateCartTotalPrice } from "../../utils/product";

Page({
  data: {
    cartItems: [],
    filteredCartItems: [],
    totalPrice: 0,
    loading: true,
    startX: 0, // 触摸开始位置
    startY: 0, // 触摸开始位置
    deleteWidth: 180, // 删除按钮宽度
    selectAll: false, // 是否全选
    selectedCount: 0, // 选中商品数量
    lastTapTime: 0 // 上次点击时间（用于双击tabbar）
  },
  
  onLoad(options) {
    this.fetchCartItems();
  },
  
  onShow() {
    // 每次页面显示时重新获取购物车数据
    this.fetchCartItems();
  },
  
  // 下拉刷新
  onPullDownRefresh() {
    this.fetchCartItems().finally(() => {
      wx.stopPullDownRefresh();
    });
  },
  
  // 从cart collection获取购物车数据
  fetchCartItems() {
    this.setData({ loading: true });
    const cart = getCollection("cart");
    const products = getCollection("products");
    const openid = wx.getStorageSync('openid') || '';
    
    console.log('当前用户openid:', openid);
    
    // 先尝试从本地缓存获取购物车数据
    const cachedCartItems = wx.getStorageSync(`cart_${openid}`);
    if (cachedCartItems) {
      console.log('从缓存获取购物车数据');
      this.setData({ cartItems: cachedCartItems });
      this.updateSelectionStatus();
      this.calculateTotalPrice();
      this.setData({ loading: false });
    }
    
    const query = openid ? cart.where({ _openid: openid, isDelete: false }) : cart.where({ isDelete: false });
    
    return query
      .orderBy('updatedAt', 'desc')
      .get()
      .then((res) => {
        let cartItems = res.data || [];
        console.log('获取到的购物车数据:', cartItems);
        
        // 过滤掉无效的商品（没有productSnapshot的）
        cartItems = cartItems.filter(item => item.productSnapshot);
        
        // 转换数据格式，使用productSnapshot中的数据
        const productIdSet = new Set(cartItems.map(item => item.productId));
        const productIdArray = Array.from(productIdSet);
        
        // 批量获取商品详情以检查库存
        return getProductsDetail(productIdArray).then(productMap => {
          
          // 转换购物车数据
          cartItems = cartItems.map(item => {
            const product = productMap.get(item.productId);
            let stock = 99; // 默认库存
            let name = item.productSnapshot.name || '';
            let price = item.productSnapshot.price || 0;
            let coverImage = item.productSnapshot.coverImage || '';
            let category = item.productSnapshot.category || '';
            let typeId = item.productSnapshot.typeId || '';
            
            if (product) {
              // 从商品集合获取最新数据
              name = product.name || name;
              price = typeof product.price === "number" ? product.price : price;
              coverImage = product.coverImage || coverImage;
              category = product.category || category;
              typeId = product.typeId || typeId;
              
              if (typeof product.stock === "number") {
                stock = product.stock;
                console.log('商品库存:', item.productId, stock);
              } else {
                console.log('商品库存类型错误:', item.productId, typeof product.stock, product.stock);
              }
            } else {
              console.log('商品不存在，使用默认数据:', item.productId);
            }
            
            const isSoldOut = isProductSoldOut(product);
            
            return {
              _id: item._id,
              productId: item.productId,
              name: name,
              price: price,
              quantity: item.quantity || 1,
              stock: stock,
              isSoldOut: isSoldOut,
              coverImage: coverImage,
              category: category,
              typeId: typeId,
              selected: false, // 初始未选中
              translateX: 0 // 初始化滑动距离
            };
          });
          
          return cartItems;
        });
      })
      .then((cartItems) => {
        this.setData({ cartItems });
        this.updateSelectionStatus();
        this.calculateTotalPrice();
        
        // 缓存购物车数据到本地，有效期1小时
        if (openid) {
          wx.setStorageSync(`cart_${openid}`, cartItems);
        }
      })
      .catch((err) => {
        console.error("获取购物车数据失败", err);
        // 如果缓存中有数据，就使用缓存数据，否则显示空购物车
        if (!cachedCartItems) {
          this.setData({ cartItems: [] });
        }
      })
      .finally(() => {
        this.setData({ loading: false });
        // 初始化筛选后的商品列表
        this.setData({ filteredCartItems: this.data.cartItems });
      });
  },

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
        filteredCartItems: this.data.cartItems,
        searchSuggestions: []
      });
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
    
    this.setData({ 
      filteredCartItems: filteredItems,
      searchFocused: true // 保持搜索焦点状态，显示搜索建议
    });
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
      filteredCartItems: this.data.cartItems,
      searchSuggestions: []
    });
  },

  // 切换搜索历史显示状态
  toggleSearchHistory() {
    // 只有当搜索框为空时才切换搜索历史的显示状态
    if (!this.data.searchKeyword) {
      this.setData({ searchFocused: !this.data.searchFocused });
    }
  },

  // 搜索框获得焦点
  onSearchFocus(e) {
    // 不做任何操作，保持默认行为
  },

  // 使用搜索历史
  useSearchHistory(e) {
    const keyword = e.currentTarget.dataset.keyword;
    this.setData({ 
      searchKeyword: keyword,
      searchSuggestions: [],
      searchFocused: false
    });
    // 直接过滤商品，不生成搜索建议
    const filteredItems = this.data.cartItems.filter(item => {
      const name = item.name || '';
      const description = item.description || '';
      const category = item.category || '';
      return name.includes(keyword) || description.includes(keyword) || category.includes(keyword);
    });
    this.setData({ filteredCartItems: filteredItems });
    this.saveSearchHistory(keyword);
  },

  // 使用搜索建议
  useSearchSuggestion(e) {
    const keyword = e.currentTarget.dataset.keyword;
    this.setData({ 
      searchKeyword: keyword,
      searchSuggestions: [],
      searchFocused: true // 保持搜索焦点状态，以便用户可以编辑搜索内容
    });
    // 直接过滤商品，不生成搜索建议
    const filteredItems = this.data.cartItems.filter(item => {
      const name = item.name || '';
      const description = item.description || '';
      const category = item.category || '';
      return name.includes(keyword) || description.includes(keyword) || category.includes(keyword);
    });
    this.setData({ filteredCartItems: filteredItems });
    this.saveSearchHistory(keyword);
  },

  // 显示筛选面板
  showFilterPanel() {
    this.setData({ showFilterPanel: true });
  },

  // 隐藏筛选面板
  hideFilterPanel() {
    this.setData({ showFilterPanel: false });
  },

  // 判断分类是否被选中
  isCategorySelected(categoryId) {
    // 直接从data中获取filterOptions，确保使用最新的数据
    const filterOptions = this.data.filterOptions;
    console.log('isCategorySelected called with categoryId:', categoryId);
    console.log('Current filterOptions in isCategorySelected:', filterOptions);
    if (!filterOptions || !filterOptions.category || !Array.isArray(filterOptions.category)) {
      console.log('filterOptions is not valid');
      return false;
    }
    console.log('filterOptions.category:', filterOptions.category);
    // 使用传统的for循环来检查数组中是否包含某个元素，确保在所有微信小程序环境中都能正常工作
    let isSelected = false;
    for (let i = 0; i < filterOptions.category.length; i++) {
      if (filterOptions.category[i] === categoryId) {
        isSelected = true;
        break;
      }
    }
    console.log('Category', categoryId, 'is selected:', isSelected);
    return isSelected;
  },
  


  // 选择商品类别
  selectCategory(e) {
    console.log('selectCategory called:', e);
    const categoryId = e.currentTarget.dataset.categoryId;
    const categoryName = e.currentTarget.dataset.categoryName;
    const level = e.currentTarget.dataset.level;
    const parentId = e.currentTarget.dataset.parentId;
    console.log('Selected categoryId:', categoryId);
    console.log('Selected categoryName:', categoryName);
    console.log('Selected level:', level);
    console.log('Selected parentId:', parentId);
    console.log('Current categoryGroups:', this.data.categoryGroups);
    console.log('Current selectedCategories:', this.data.selectedCategories);
    
    // 直接修改data中的selectedCategories，确保使用最新的数据
    const selectedCategories = { ...this.data.selectedCategories };
    
    if (level == 1) { // 使用==而不是===，因为level是字符串
      // 如果是一级分类，切换选择状态
      const isSelected = selectedCategories[categoryId] || false;
      console.log('Is already selected:', isSelected);
      
      // 查找该一级分类下的所有二级分类
      const level1Group = this.data.categoryGroups.find(group => group._id === categoryId);
      let level2CategoryIds = [];
      if (level1Group && level1Group.subCategories) {
        level2CategoryIds = level1Group.subCategories.map(item => item._id);
        console.log('Level 2 categoryIds:', level2CategoryIds);
      }
      
      if (isSelected) {
        // 如果已选择，取消选择一级分类和所有二级分类
        delete selectedCategories[categoryId];
        level2CategoryIds.forEach(subId => {
          delete selectedCategories[subId];
        });
        console.log('After deselection:', selectedCategories);
      } else {
        // 如果未选择，选择一级分类和所有二级分类
        selectedCategories[categoryId] = true;
        level2CategoryIds.forEach(subId => {
          selectedCategories[subId] = true;
        });
        console.log('After selection:', selectedCategories);
      }
    } else {
      // 如果是二级分类，切换选择状态
      const isSelected = selectedCategories[categoryId] || false;
      if (isSelected) {
        // 如果已选择，取消选择
        delete selectedCategories[categoryId];
        console.log('After deselection:', selectedCategories);
      } else {
        // 如果未选择，添加选择
        selectedCategories[categoryId] = true;
        console.log('After selection:', selectedCategories);
      }
    }
    
    // 更新filterOptions.category数组
    const categoryArray = Object.keys(selectedCategories);
    const newFilterOptions = { ...this.data.filterOptions, category: categoryArray };
    
    // 计算活跃筛选条件数量
    let count = 0;
    if (newFilterOptions.category && newFilterOptions.category.length > 0) count++;
    if (newFilterOptions.inStock !== null) count++;
    
    // 直接更新所有相关数据
    this.setData({ 
      selectedCategories: selectedCategories,
      filterOptions: newFilterOptions,
      activeFilterCount: count
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
    
    // 计算活跃筛选条件数量
    let count = 0;
    if (filterOptions.category && filterOptions.category.length > 0) count++;
    if (filterOptions.inStock !== null) count++;
    
    // 直接更新所有相关数据
    this.setData({ 
      filterOptions: filterOptions,
      activeFilterCount: count
    });
  },

  // 重置筛选条件
  resetFilter() {
    const filterOptions = {
      category: [],
      inStock: null
    };
    
    // 计算活跃筛选条件数量
    let count = 0;
    if (filterOptions.category && filterOptions.category.length > 0) count++;
    if (filterOptions.inStock !== null) count++;
    
    // 直接更新所有相关数据
    this.setData({ 
      filterOptions: filterOptions,
      selectedCategories: {},
      activeFilterCount: count
    });
  },

  // 更新活跃筛选条件数量
  updateActiveFilterCount() {
    const { filterOptions } = this.data;
    let count = 0;
    if (filterOptions.category && filterOptions.category.length > 0) count++;
    if (filterOptions.inStock !== null) count++;
    this.setData({ activeFilterCount: count });
  },

  // 应用筛选
  applyFilter() {
    const { filterOptions, cartItems, categoryOptions } = this.data;
    
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
      filteredCartItems: filteredItems,
      showFilterPanel: false
    });
    
    // 保存筛选状态到本地存储
    wx.setStorageSync('cartFilterOptions', filterOptions);
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
            // 添加到categories数组（保持原有结构兼容）
            categories.push({
              _id: type._id,
              name: type.name,
              level: 1
            });
            if (subTypes.length > 0) {
              subTypes.forEach(subType => {
                categories.push({
                  _id: subType._id,
                  name: subType.name,
                  level: 2,
                  parent: type.name,
                  parentId: type._id
                });
              });
            }
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
          // 同时填充categories数组
          categoryGroups.forEach(group => {
            categories.push({ _id: group._id, name: group.name, level: 1 });
            group.subCategories.forEach(subCategory => {
              categories.push(subCategory);
            });
          });
        }
        this.setData({ 
          categoryOptions: categories,
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
        // 填充categories数组
        const categories = [];
        categoryGroups.forEach(group => {
          categories.push({ _id: group._id, name: group.name, level: 1 });
          group.subCategories.forEach(subCategory => {
            categories.push(subCategory);
          });
        });
        this.setData({ 
          categoryOptions: categories,
          categoryGroups: categoryGroups
        });
      });
  },
  
  // 减少数量
  decreaseQuantity(e) {
    try {
      const productId = e.currentTarget.dataset.productId;
      if (!productId) {
        console.error('商品ID为空');
        return;
      }
      
      const cartItems = this.data.cartItems.map(item => {
        if (item.productId === productId) {
          // 确保quantity是数字
          const currentQuantity = typeof item.quantity === 'number' ? item.quantity : 1;
          if (currentQuantity > 1) {
            return { ...item, quantity: currentQuantity - 1 };
          }
        }
        return item;
      });
      this.setData({ cartItems });
      // 更新filteredCartItems
      const filteredCartItems = this.data.filteredCartItems.map(item => {
        if (item.productId === productId) {
          const updatedItem = cartItems.find(i => i.productId === productId);
          return updatedItem || item;
        }
        return item;
      });
      this.setData({ filteredCartItems });
      this.calculateTotalPrice();
      const updatedItem = cartItems.find(item => item.productId === productId);
      if (updatedItem) {
        this.updateCartQuantity(productId, updatedItem.quantity);
      }
    } catch (err) {
      console.error('减少数量失败:', err);
      wx.showToast({
        title: '操作失败，请稍后重试',
        icon: 'none'
      });
    }
  },
  
  // 增加数量
  increaseQuantity(e) {
    try {
      const productId = e.currentTarget.dataset.productId;
      if (!productId) {
        console.error('商品ID为空');
        return;
      }
      
      let newQuantity;
      
      const cartItems = this.data.cartItems.map(item => {
        if (item.productId === productId) {
          // 确保quantity是数字
          const currentQuantity = typeof item.quantity === 'number' ? item.quantity : 1;
          // 检查库存限制
          if (currentQuantity < item.stock) {
            newQuantity = currentQuantity + 1;
            return { ...item, quantity: newQuantity };
          } else {
            // 已达库存上限，只有当库存不是默认值99时才显示提示
            if (item.stock !== 99) {
              wx.showToast({
                title: '已达库存上限',
                icon: 'none'
              });
            }
            return item;
          }
        }
        return item;
      });
      
      this.setData({ cartItems });
      // 更新filteredCartItems
      const filteredCartItems = this.data.filteredCartItems.map(item => {
        if (item.productId === productId) {
          const updatedItem = cartItems.find(i => i.productId === productId);
          return updatedItem || item;
        }
        return item;
      });
      this.setData({ filteredCartItems });
      this.calculateTotalPrice();
      
      // 只有当数量实际变化时才更新数据库
      if (newQuantity) {
        this.updateCartQuantity(productId, newQuantity);
      }
    } catch (err) {
      console.error('增加数量失败:', err);
      wx.showToast({
        title: '操作失败，请稍后重试',
        icon: 'none'
      });
    }
  },
  
  // 处理数量变化（实时更新，不验证库存）
  onQuantityChange(e) {
    try {
      const productId = e.currentTarget.dataset.productId;
      if (!productId) {
        console.error('商品ID为空');
        return;
      }
      
      const inputValue = e.detail.value;
      
      // 直接使用输入值，不进行验证，支持删除所有数字
      let quantity = inputValue === '' ? '' : parseInt(inputValue) || '';
      
      const cartItems = this.data.cartItems.map(item => {
        if (item.productId === productId) {
          return { ...item, quantity };
        }
        return item;
      });
      this.setData({ cartItems });
      // 更新filteredCartItems
      const filteredCartItems = this.data.filteredCartItems.map(item => {
        if (item.productId === productId) {
          const updatedItem = cartItems.find(i => i.productId === productId);
          return updatedItem || item;
        }
        return item;
      });
      this.setData({ filteredCartItems });
      // 不立即计算总价和更新数据库，等待blur事件
    } catch (err) {
      console.error('数量变化处理失败:', err);
    }
  },
  
  // 输入完成后验证库存限制
  onQuantityBlur(e) {
    try {
      const productId = e.currentTarget.dataset.productId;
      if (!productId) {
        console.error('商品ID为空');
        return;
      }
      
      const inputValue = e.detail.value;
      let quantity = parseInt(inputValue) || 1;
      
      // 查找当前商品
      const currentItem = this.data.cartItems.find(item => item.productId === productId);
      if (currentItem) {
        // 检查库存限制
        if (quantity < 1) {
          quantity = 1;
        } else if (quantity > currentItem.stock) {
          quantity = currentItem.stock;
          // 只有当库存不是默认值99时才显示库存上限提示
          if (currentItem.stock !== 99) {
            wx.showToast({
              title: '已达库存上限',
              icon: 'none'
            });
          }
        }
      }
      
      const cartItems = this.data.cartItems.map(item => {
        if (item.productId === productId) {
          return { ...item, quantity };
        }
        return item;
      });
      this.setData({ cartItems });
      // 更新filteredCartItems
      const filteredCartItems = this.data.filteredCartItems.map(item => {
        if (item.productId === productId) {
          const updatedItem = cartItems.find(i => i.productId === productId);
          return updatedItem || item;
        }
        return item;
      });
      this.setData({ filteredCartItems });
      this.calculateTotalPrice();
      this.updateCartQuantity(productId, quantity);
    } catch (err) {
      console.error('数量验证失败:', err);
      wx.showToast({
        title: '操作失败，请稍后重试',
        icon: 'none'
      });
    }
  },
  
  // 更新购物车数量
  updateCartQuantity(productId, quantity) {
    try {
      if (!productId) {
        console.error('商品ID为空');
        return;
      }
      
      if (typeof quantity !== 'number' || quantity < 1) {
        console.error('数量无效:', quantity);
        return;
      }
      
      const cart = getCollection("cart");
      const itemToUpdate = this.data.cartItems.find(item => item.productId === productId);
      if (itemToUpdate && itemToUpdate._id) {
        cart
          .doc(itemToUpdate._id)
          .update({
            data: {
              quantity
            }
          })
          .catch(err => {
            console.error("更新购物车数量失败", err);
          });
      } else {
        console.error('未找到要更新的购物车商品');
      }
    } catch (err) {
      console.error('更新购物车数量失败:', err);
    }
  },
  
  // 触摸开始事件
  touchStart(e) {
    // 记录触摸开始位置
    this.setData({
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY
    });
  },
  
  // 触摸移动事件
  touchMove(e) {
    const index = e.currentTarget.dataset.index;
    const startX = this.data.startX;
    const startY = this.data.startY;
    const touchX = e.touches[0].clientX;
    const touchY = e.touches[0].clientY;
    
    // 计算滑动距离
    const dx = touchX - startX;
    const dy = touchY - startY;
    
    // 只有在水平方向滑动时才处理（水平滑动距离大于垂直滑动距离的2倍）
    if (Math.abs(dx) > Math.abs(dy) * 2) {
      let translateX = 0;
      if (dx < 0) {
        // 向左滑动，显示删除按钮
        translateX = Math.max(-this.data.deleteWidth, dx);
      } else {
        // 向右滑动，隐藏删除按钮
        translateX = Math.min(0, dx);
      }
      
      // 更新商品的translateX，同时重置其他商品的translateX
      const filteredCartItems = [...this.data.filteredCartItems];
      filteredCartItems.forEach((item, i) => {
        if (i === index) {
          item.translateX = translateX;
        } else {
          item.translateX = 0;
        }
      });
      this.setData({ filteredCartItems });
    }
  },
  
  // 触摸结束事件
  touchEnd(e) {
    const index = e.currentTarget.dataset.index;
    const filteredCartItems = [...this.data.filteredCartItems];
    const translateX = filteredCartItems[index].translateX;
    
    // 重置所有商品的translateX
    filteredCartItems.forEach((item, i) => {
      if (i === index) {
        // 根据滑动距离判断是否显示删除按钮
        if (translateX < -this.data.deleteWidth / 2) {
          // 显示删除按钮
          item.translateX = -this.data.deleteWidth;
        } else {
          // 隐藏删除按钮
          item.translateX = 0;
        }
      } else {
        // 隐藏其他商品的删除按钮
        item.translateX = 0;
      }
    });
    
    this.setData({ filteredCartItems });
  },
  
  // 删除商品（软删除）
  deleteCartItem(e) {
    try {
      console.log('删除按钮被点击', e);
      const productId = e.currentTarget.dataset.productId;
      console.log('商品ID:', productId);
      
      if (!productId) {
        console.error('商品ID为空');
        wx.showToast({
          title: "操作失败，请稍后重试",
          icon: "none"
        });
        return;
      }
      
      const itemToDelete = this.data.cartItems.find(item => item.productId === productId);
      console.log('找到的商品:', itemToDelete);
      
      if (!itemToDelete || !itemToDelete._id) {
        console.log('未找到商品或商品ID');
        wx.showToast({
          title: "商品不存在",
          icon: "none"
        });
        return;
      }
      
      // 软删除，更新isDelete字段为true
      const cart = getCollection("cart");
      console.log('开始删除商品:', itemToDelete._id);
      cart
        .doc(itemToDelete._id)
        .update({
          data: {
            isDelete: true,
            updatedAt: new Date()
          }
        })
        .then(() => {
          console.log('删除成功');
          // 重新获取购物车数据
          this.fetchCartItems();
        })
        .catch(err => {
          console.error("删除购物车商品失败", err);
          wx.showToast({
            title: "删除失败",
            icon: "none"
          });
        });
    } catch (err) {
      console.error('删除商品失败:', err);
      wx.showToast({
        title: "操作失败，请稍后重试",
        icon: "none"
      });
    }
  },
  
  // 跳转到商品详情页
  goToProductDetail(e) {
    try {
      console.log('goToProductDetail被调用', e);
      const productId = e.currentTarget.dataset.productId;
      console.log('商品ID:', productId);
      
      if (productId) {
        console.log('准备跳转到商品详情页', productId);
        wx.navigateTo({
          url: `/pages/product-detail/index?id=${productId}`,
          success: function(res) {
            console.log('跳转成功', res);
          },
          fail: function(res) {
            console.log('跳转失败', res);
            wx.showToast({
              title: "跳转失败，请稍后重试",
              icon: "none"
            });
          }
        });
      } else {
        console.log('不跳转的原因: 没有productId');
        wx.showToast({
          title: "商品信息错误",
          icon: "none"
        });
      }
    } catch (err) {
      console.error('跳转到商品详情页失败:', err);
      wx.showToast({
        title: "操作失败，请稍后重试",
        icon: "none"
      });
    }
  },
  
  // 计算总价
  calculateTotalPrice() {
    const totalPrice = calculateCartTotalPrice(this.data.cartItems);
    this.setData({ totalPrice });
  },
  
  // 跳转到结算页面
  goToCheckout() {
    // 过滤出未售罄且选中的商品
    const selectedItems = this.data.cartItems.filter(item => !item.isSoldOut && item.selected);
    
    if (selectedItems.length === 0) {
      wx.showToast({
        title: "请选择要结算的商品",
        icon: "none"
      });
      return;
    }
    
    // 构建结算参数
    const cartItems = selectedItems.map(item => ({
      productId: item.productId,
      quantity: item.quantity,
      message: ""
    }));
    
    wx.navigateTo({
      url: `/pages/order-confirm/index?cartItems=${encodeURIComponent(JSON.stringify(cartItems))}`
    });
  },
  
  // 跳转到首页
  goToHome() {
    wx.switchTab({
      url: '/pages/home/index'
    });
  },
  
  // 隐藏所有删除按钮
  hideDeleteButtons() {
    const filteredCartItems = [...this.data.filteredCartItems];
    filteredCartItems.forEach(item => {
      item.translateX = 0;
    });
    this.setData({ filteredCartItems });
  },
  
  // 阻止事件冒泡
  stopPropagation() {
    // 空方法，用于阻止事件冒泡
  },
  
  // 更新选择状态
  updateSelectionStatus() {
    const cartItems = this.data.cartItems;
    // 只考虑未售罄的商品
    const availableItems = cartItems.filter(item => !item.isSoldOut);
    const selectedCount = cartItems.filter(item => !item.isSoldOut && item.selected).length;
    const selectAll = availableItems.length > 0 && selectedCount === availableItems.length;
    
    this.setData({
      selectedCount,
      selectAll
    });
  },
  
  // 切换单个商品选择状态
  toggleSelect(e) {
    const productId = e.currentTarget.dataset.productId;
    const cartItems = this.data.cartItems.map(item => {
      if (item.productId === productId && !item.isSoldOut) {
        return { ...item, selected: !item.selected };
      }
      return item;
    });
    
    this.setData({ cartItems });
    // 更新filteredCartItems
    const filteredCartItems = this.data.filteredCartItems.map(item => {
      if (item.productId === productId) {
        const updatedItem = cartItems.find(i => i.productId === productId);
        return updatedItem || item;
      }
      return item;
    });
    this.setData({ filteredCartItems });
    this.updateSelectionStatus();
    this.calculateTotalPrice();
  },
  
  // 切换全选状态
  toggleSelectAll() {
    const selectAll = !this.data.selectAll;
    const cartItems = this.data.cartItems.map(item => {
      // 已售罄商品不参与全选
      if (!item.isSoldOut) {
        return { ...item, selected: selectAll };
      }
      return item;
    });
    
    this.setData({ cartItems });
    // 更新filteredCartItems
    const filteredCartItems = this.data.filteredCartItems.map(item => {
      const updatedItem = cartItems.find(i => i.productId === item.productId);
      return updatedItem || item;
    });
    this.setData({ filteredCartItems });
    this.updateSelectionStatus();
    this.calculateTotalPrice();
  },
  
  // 批量删除选中商品
  batchDelete() {
    const selectedItems = this.data.cartItems.filter(item => item.selected);
    if (selectedItems.length === 0) {
      wx.showToast({
        title: '请选择要删除的商品',
        icon: 'none'
      });
      return;
    }
    
    wx.showModal({
      title: '确认删除',
      content: `确定要删除选中的 ${selectedItems.length} 件商品吗？`,
      success: (res) => {
        if (res.confirm) {
          // 批量软删除
          const cart = getCollection("cart");
          const deletePromises = selectedItems.map(item => {
            return cart.doc(item._id).update({
              data: {
                isDelete: true,
                updatedAt: new Date()
              }
            });
          });
          
          Promise.all(deletePromises)
            .then(() => {
              wx.showToast({
                title: '删除成功',
                icon: 'success'
              });
              // 重新获取购物车数据
              this.fetchCartItems();
            })
            .catch(err => {
              console.error("批量删除失败", err);
              wx.showToast({
                title: '删除失败',
                icon: 'none'
              });
            });
        }
      }
    });
  },
  
  // 双击tabbar刷新页面
  onTabItemTap(item) {
    // 记录点击时间
    const now = Date.now();
    const lastTapTime = this.data.lastTapTime || 0;
    
    // 如果两次点击时间间隔小于300ms，视为双击
    if (now - lastTapTime < 300) {
      // 刷新购物车页面
      this.fetchCartItems();
    }
    
    // 更新最后点击时间
    this.setData({ lastTapTime: now });
  },
  
  // 处理搜索事件
  handleSearch(e) {
    const { keyword, filteredItems } = e.detail;
    this.setData({
      filteredCartItems: filteredItems
    });
  },
  
  // 处理筛选事件
  handleFilter(e) {
    const { filterOptions, filteredItems } = e.detail;
    this.setData({
      filteredCartItems: filteredItems
    });
  }
})