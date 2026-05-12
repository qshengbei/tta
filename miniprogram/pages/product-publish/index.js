// pages/admin/product-publish/index.js
const db = wx.cloud.database();

Page({
  data: {
    isEditing: false,
    productId: '',
    product: {
      name: '',
      price: '',
      stock: '',
      typeId: '', // 类别ID
      categoryId: '', // 系列ID
      materialId: '', // 布料ID
      coverImage: '',
      images: [],
      description: '',
      status: 'on', // 上架状态
      isNew: false, // 是否新品
      supportNoReasonReturn: false, // 是否支持七天无理由退换货
      tags: [] // 商品标签
    },
    originalProduct: {}, // 保存原始商品数据，用于比较变化
    typeOptions: [],
    categoryOptions: [],
    materialOptions: [],
    statusOptions: [
      { _id: 'on', name: '上架' },
      { _id: 'off', name: '下架' }
    ],
    typeIndex: 0,
    categoryIndex: 0,
    materialIndex: 0,
    statusIndex: 0,
    tagsText: '', // 标签文本，用于输入框显示
    submitting: false
  },

  onLoad(options) {
    const { id, typeId } = options;
    if (id) {
      this.setData({ isEditing: true, productId: id });
      this.loadProduct(id);
    } else if (typeId) {
      // 从分类页面进入，自动设置分类
      this.setData({ 'product.typeId': typeId });
    }
    this.loadTypeOptions();
    this.loadCategoryOptions();
    this.loadMaterialOptions();
  },

  // 加载商品数据
  loadProduct(productId) {
    db.collection('products').doc(productId).get().then(res => {
      if (res.data) {
        const productData = res.data;
        // 确保新字段有默认值
        const product = {
          ...productData,
          materialId: productData.materialId || '',
          status: productData.status || 'on',
          isNew: productData.isNew || false,
          supportNoReasonReturn: productData.supportNoReasonReturn || false,
          tags: productData.tags || []
        };
        
        this.setData({ 
          product: product,
          originalProduct: { ...product } // 保存原始商品数据
        });
        
        console.log('加载商品数据完成，product:', product);
        
        // 手动设置分类和系列的索引
        if (product.typeId) {
          this.setTypeIndex(product.typeId);
        }
        if (product.categoryId) {
          this.setCategoryIndex(product.categoryId);
        }
        if (product.materialId) {
          this.setMaterialIndex(product.materialId);
        }
        if (product.status) {
          this.setStatusIndex(product.status);
        }
        
        // 设置标签文本
        if (product.tags && product.tags.length > 0) {
          this.setData({ tagsText: product.tags.join(',') });
        }
      }
    }).catch(err => {
      console.error('加载商品失败:', err);
      wx.showToast({ title: '加载商品失败', icon: 'none' });
    });
  },

  // 加载分类选项
  loadTypeOptions() {
    db.collection('product_types').get().then(res => {
      const typeOptions = res.data;
      this.setData({ typeOptions: typeOptions });
      
      console.log('加载的分类选项:', typeOptions);
      
      // 加载完成后，设置分类索引
      const { product } = this.data;
      if (product.typeId) {
        console.log('商品的typeId:', product.typeId);
        this.setTypeIndex(product.typeId);
      }
    }).catch(err => {
      console.error('加载分类失败:', err);
    });
  },

  // 加载系列选项
  loadCategoryOptions() {
    db.collection('category').get().then(res => {
      // 添加"无"选项
      const categoryOptions = [{ _id: '', name: '无' }, ...res.data];
      this.setData({ categoryOptions: categoryOptions });
      
      // 加载完成后，设置系列索引
      const { product } = this.data;
      if (product.categoryId) {
        this.setCategoryIndex(product.categoryId);
      }
    }).catch(err => {
      console.error('加载系列失败:', err);
    });
  },

  // 加载布料选项
  loadMaterialOptions() {
    db.collection('material').get().then(res => {
      // 添加"无"选项
      const materialOptions = [{ _id: '', name: '无' }, ...res.data];
      this.setData({ materialOptions: materialOptions });
      
      // 加载完成后，设置布料索引
      const { product } = this.data;
      if (product.materialId) {
        this.setMaterialIndex(product.materialId);
      }
    }).catch(err => {
      console.error('加载布料失败:', err);
    });
  },

  // 设置布料索引
  setMaterialIndex(materialId) {
    const { materialOptions } = this.data;
    const index = materialOptions.findIndex(item => item._id === materialId);
    if (index >= 0) {
      this.setData({ materialIndex: index });
    }
  },

  // 设置状态索引
  setStatusIndex(status) {
    const { statusOptions } = this.data;
    const index = statusOptions.findIndex(item => item._id === status);
    if (index >= 0) {
      this.setData({ statusIndex: index });
    }
  },

  // 设置分类索引
  setTypeIndex(typeId) {
    const { typeOptions } = this.data;
    console.log('设置分类索引，typeId:', typeId);
    console.log('当前typeOptions:', typeOptions);
    const index = typeOptions.findIndex(item => item._id === typeId);
    console.log('找到的索引:', index);
    if (index >= 0) {
      this.setData({ typeIndex: index });
      console.log('设置typeIndex为:', index);
    }
  },

  // 设置系列索引
  setCategoryIndex(categoryId) {
    const { categoryOptions } = this.data;
    console.log('设置系列索引，categoryId:', categoryId);
    console.log('当前categoryOptions:', categoryOptions);
    const index = categoryOptions.findIndex(item => item._id === categoryId);
    console.log('找到的索引:', index);
    if (index >= 0) {
      this.setData({ categoryIndex: index });
      console.log('设置categoryIndex为:', index);
    }
  },

  // 输入商品名称
  inputName(e) {
    this.setData({ 'product.name': e.detail.value });
  },

  // 输入商品价格
  inputPrice(e) {
    this.setData({ 'product.price': e.detail.value });
  },

  // 输入商品库存
  inputStock(e) {
    this.setData({ 'product.stock': e.detail.value });
  },

  // 输入商品描述
  inputDescription(e) {
    this.setData({ 'product.description': e.detail.value });
  },

  // 选择分类
  onTypeChange(e) {
    const index = e.detail.value;
    const { typeOptions } = this.data;
    this.setData({
      typeIndex: index,
      'product.typeId': typeOptions[index]._id
    });
  },

  // 选择系列
  onCategoryChange(e) {
    const index = e.detail.value;
    const { categoryOptions } = this.data;
    this.setData({
      categoryIndex: index,
      'product.categoryId': categoryOptions[index]._id
    });
  },

  // 选择布料
  onMaterialChange(e) {
    const index = e.detail.value;
    const { materialOptions } = this.data;
    this.setData({
      materialIndex: index,
      'product.materialId': materialOptions[index]._id
    });
  },

  // 选择状态
  onStatusChange(e) {
    const index = e.detail.value;
    const { statusOptions } = this.data;
    this.setData({
      statusIndex: index,
      'product.status': statusOptions[index]._id
    });
  },

  // 切换是否新品
  onIsNewChange(e) {
    this.setData({ 'product.isNew': e.detail.value });
  },

  // 切换是否支持七天无理由退换货
  onSupportNoReasonReturnChange(e) {
    this.setData({ 'product.supportNoReasonReturn': e.detail.value });
  },

  // 输入标签
  inputTags(e) {
    const tagsText = e.detail.value;
    this.setData({ tagsText: tagsText });
    // 转换为标签数组
    const tags = tagsText.split(',').map(tag => tag.trim()).filter(tag => tag);
    this.setData({ 'product.tags': tags });
  },

  // 选择图片
  chooseImage() {
    wx.chooseImage({
      count: 9 - this.data.product.images.length,
      sizeType: ['original', 'compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePaths = res.tempFilePaths;
        this.uploadImages(tempFilePaths);
      }
    });
  },

  // 选择主图
  chooseCoverImage() {
    wx.chooseImage({
      count: 1,
      sizeType: ['original', 'compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePaths = res.tempFilePaths;
        this.uploadCoverImage(tempFilePaths[0]);
      }
    });
  },

  // 上传图片
  uploadImages(tempFilePaths) {
    const { product } = this.data;
    const newImages = [...product.images];
    
    tempFilePaths.forEach((tempFilePath, index) => {
      const cloudPath = `products/${Date.now()}-${index}.png`;
      wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: tempFilePath,
        success: (res) => {
          newImages.push(res.fileID);
          this.setData({ 'product.images': newImages });
        },
        fail: (err) => {
          console.error('上传图片失败:', err);
          wx.showToast({ title: '上传图片失败', icon: 'none' });
        }
      });
    });
  },

  // 上传主图
  uploadCoverImage(tempFilePath) {
    const cloudPath = `products/cover-${Date.now()}.png`;
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: tempFilePath,
      success: (res) => {
        this.setData({ 'product.coverImage': res.fileID });
      },
      fail: (err) => {
        console.error('上传主图失败:', err);
        wx.showToast({ title: '上传主图失败', icon: 'none' });
      }
    });
  },

  // 删除图片
  deleteImage(e) {
    const index = e.currentTarget.dataset.index;
    const { product } = this.data;
    const newImages = [...product.images];
    newImages.splice(index, 1);
    this.setData({ 'product.images': newImages });
  },

  // 提交表单
  submitForm(e) {
    const { product, isEditing, productId } = this.data;
    
    // 验证表单
    if (!product.name) {
      wx.showToast({ title: '请输入商品名称', icon: 'none' });
      return;
    }
    if (!product.price) {
      wx.showToast({ title: '请输入商品价格', icon: 'none' });
      return;
    }
    if (!product.stock) {
      wx.showToast({ title: '请输入商品库存', icon: 'none' });
      return;
    }
    if (!product.typeId) {
      wx.showToast({ title: '请选择商品分类', icon: 'none' });
      return;
    }
    // 系列可以选择"无"，所以不需要验证
    if (!product.coverImage) {
      wx.showToast({ title: '请上传商品主图', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });

    if (isEditing) {
      // 编辑模式：只更新有变化的字段
      const { originalProduct } = this.data;
      const updatedData = {};
      
      console.log('原始商品数据:', originalProduct);
      console.log('当前商品数据:', product);
      
      // 比较所有字段，只更新有变化的
      const fields = ['name', 'price', 'stock', 'typeId', 'categoryId', 'materialId', 'coverImage', 'images', 'description', 'status', 'isNew', 'tags', 'supportNoReasonReturn'];
      
      fields.forEach(field => {
        // 特殊处理数组类型的字段（如images, tags）
        if (Array.isArray(product[field]) && Array.isArray(originalProduct[field])) {
          if (JSON.stringify(product[field]) !== JSON.stringify(originalProduct[field])) {
            updatedData[field] = product[field];
            console.log(`字段 ${field} 发生变化: ${JSON.stringify(originalProduct[field])} -> ${JSON.stringify(product[field])}`);
          }
        } else if (product[field] !== originalProduct[field]) {
          // 处理价格和库存，确保转换为数字
          if (field === 'price' || field === 'stock') {
            updatedData[field] = Number(product[field]);
            console.log(`字段 ${field} 发生变化: ${originalProduct[field]} -> ${product[field]} (转换为数字: ${Number(product[field])})`);
          } else {
            updatedData[field] = product[field];
            console.log(`字段 ${field} 发生变化: ${originalProduct[field]} -> ${product[field]}`);
          }
        }
      });
      
      // 总是更新updatedAt字段
      updatedData.updatedAt = new Date();
      
      console.log('要更新的数据:', updatedData);
      
      // 如果没有字段变化，直接返回成功
      if (Object.keys(updatedData).length === 1 && 'updatedAt' in updatedData) {
        console.log('没有字段变化，直接返回成功');
        wx.showToast({ title: '保存成功' });
        wx.navigateBack();
        this.setData({ submitting: false });
        return;
      }
      
      // 更新商品
      console.log('开始更新商品，productId:', productId);
      console.log('要更新的数据:', updatedData);
      
      // 先检查文档是否存在
      db.collection('products').doc(productId).get().then(existRes => {
        console.log('检查文档是否存在:', existRes.data ? '存在' : '不存在');
        console.log('文档当前数据:', existRes.data);
        
        if (existRes.data) {
          // 文档存在，使用update操作更新数据
          console.log('文档当前stock值:', existRes.data.stock, '类型:', typeof existRes.data.stock);
          console.log('要更新的stock值:', updatedData.stock, '类型:', typeof updatedData.stock);
          
          // 使用云函数更新商品数据，传递所有有变化的字段
          console.log('使用云函数更新商品，productId:', productId);
          console.log('更新数据:', updatedData);
          
          wx.cloud.callFunction({
            name: 'updateProduct',
            data: {
              productId: productId,
              updateData: updatedData
            }
          }).then(res => {
            console.log('云函数更新结果:', res);
            
            if (res.result && res.result.success) {
              console.log('云函数更新成功');
              console.log('更新后商品数据:', res.result.updatedProduct);
              
              // 检查是否有至少一个字段被更新
              let hasUpdated = false;
              Object.keys(updatedData).forEach(key => {
                if (key !== 'updatedAt') {
                  // 对于数组类型的字段，使用JSON.stringify进行比较
                  if (Array.isArray(updatedData[key]) && Array.isArray(res.result.updatedProduct[key])) {
                    if (JSON.stringify(updatedData[key]) === JSON.stringify(res.result.updatedProduct[key])) {
                      hasUpdated = true;
                    }
                  } else if (res.result.updatedProduct[key] === updatedData[key]) {
                    hasUpdated = true;
                  }
                }
              });
              
              if (hasUpdated) {
                wx.showToast({ title: '保存成功' });
                // 标记商品数据需要刷新
                getApp().globalData.productsNeedRefresh = true;
                wx.navigateBack();
              } else {
                console.error('更新失败：数据没有变化');
                wx.showToast({ title: '保存失败：数据没有变化', icon: 'none' });
              }
            } else {
              console.error('云函数更新失败:', res.result.error);
              wx.showToast({ title: '保存失败', icon: 'none' });
            }
          }).catch(err => {
            console.error('调用云函数失败:', err);
            wx.showToast({ title: '保存失败', icon: 'none' });
          }).finally(() => {
            this.setData({ submitting: false });
          });
        } else {
          console.error('更新失败：文档不存在');
          wx.showToast({ title: '保存失败：文档不存在', icon: 'none' });
          this.setData({ submitting: false });
        }
      }).catch(err => {
        console.error('检查文档失败:', err);
        wx.showToast({ title: '保存失败', icon: 'none' });
        this.setData({ submitting: false });
      });
    } else {
      // 新增商品
      const productData = {
        ...product,
        price: Number(product.price),
        stock: Number(product.stock),
        createdAt: new Date(),
        updatedAt: new Date(),
        isDeleted: false
      };
      
      db.collection('products').add({
        data: productData
      }).then(() => {
        wx.showToast({ title: '发布成功' });
        // 标记商品数据需要刷新
        getApp().globalData.productsNeedRefresh = true;
        wx.navigateBack();
      }).catch(err => {
        console.error('发布商品失败:', err);
        wx.showToast({ title: '发布失败', icon: 'none' });
      }).finally(() => {
        this.setData({ submitting: false });
      });
    }
  }
});