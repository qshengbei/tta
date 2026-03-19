import { getCollection } from "../../utils/cloud";
import QQMapWX from "../../utils/qqmap-wx-jssdk1.2/qqmap-wx-jssdk";
import { calculateShippingFee, sortExpressRules, DEFAULT_EXPRESS_RULES } from "../../utils/shipping";
import { scanQRCode } from "../../utils/customer-service";
import { showShareOptions, hideShareOptions, shareToFriend, shareToTimeline, generatePoster, getShareAppMessageConfig, getShareTimelineConfig } from "../../utils/share";
import { cacheProduct, getCachedProduct, cacheExpressRules, getCachedExpressRules, cacheAddress, getCachedAddress } from "../../utils/cache";
import { getProductDetail, isProductSoldOut, formatPrice, buildPreviewImages } from "../../utils/product";

Page({
  data: {
    productId: "",
    product: {},
    quantity: 1,
    maxQuantity: 99,
    displayPrice: "0.00",
    message: "",
    loading: true,
    error: false,
    errorMessage: "",
    currentIndex: 0,
    totalImages: 1,
    showShareModal: false,
    isTitleExpanded: false,
    isDescExpanded: false,
    showProductSelectorModal: false,
    groupedProducts: [],
    selectorMode: "", // 'addCart' or 'buyNow'
    touchStartTime: 0,
    touchEndTime: 0,
    expressRules: [], // 快递运费规则
    currentProvince: "福建省", // 默认省份
    shippingFee: 0, // 运费
    freeShippingThreshold: 0, // 包邮条件
    showLocationModal: false, // 显示位置选择弹窗
    showExpressRulesModal: false, // 显示快递计算规则弹窗
    sortedExpressRules: [], // 排序后的快递规则
    coverImageUrl: "", // 商品封面图的临时URL
    showCartPreview: false // 购物车预览弹出层显示状态
  },

  onLoad(options) {
    const id = options.id || "";
    this.setData({ productId: id });
    
    // 获取用户 openid
    this.getOpenid();
    
    // 获取快递运费规则
    this.fetchExpressRules();
    
    if (id) {
      this.fetchProduct();
    } else {
      this.setData({
        loading: false,
        error: true,
        errorMessage: "未获取到商品信息"
      });
    }
  },

  // 获取openid
  getOpenid() {
    // 先从本地存储获取
    let openid = wx.getStorageSync('openid');
    
    // 如果本地存储没有，从app.globalData获取
    if (!openid) {
      const app = getApp();
      openid = app.globalData.openid || 'unknown';
    }
    
    this.setData({ openid });
    console.log('当前openid:', openid);
    
    // 查询历史地址信息
    this.queryLatestAddress();
  },

  // 查询最新的地址信息
  queryLatestAddress() {
    const openid = this.data.openid || '';
    const addressInfo = getCollection("adressInfo");
    
    console.log("查询历史地址开始");
    console.log("查询条件 openid:", openid);
    
    if (openid) {
      // 按openid查询最新的地址信息
      addressInfo
        .where({ _openid: openid })
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get()
        .then((res) => {
          console.log("查询结果:", res.data);
          
          if (res.data && res.data.length > 0) {
            const latestAddress = res.data[0];
            console.log("最新的地址信息:", latestAddress);
            console.log("省份信息:", latestAddress.provence);
            
            this.setData({ 
              currentProvince: latestAddress.provence 
            });
            console.log("设置当前省份为:", latestAddress.provence);
            // 计算运费
            this.calculateShippingFee();
          } else {
            console.log("没有找到地址信息");
          }
        })
        .catch((err) => {
          console.error("查询历史地址失败", err);
        });
    } else {
      console.log("openid为空，跳过地址查询");
    }
  },

  // 获取快递运费规则
  fetchExpressRules() {
    // 先尝试从缓存获取
    const cachedRules = getCachedExpressRules();
    if (cachedRules) {
      console.log('从缓存获取快递规则');
      this.setData({ expressRules: cachedRules });
      this.calculateShippingFee();
      return;
    }

    const settings = getCollection("settings");
    settings
      .get()
      .then((res) => {
        let expressRules = [];
        if (res.data && res.data.length > 0) {
          // 获取第一条数据的 expressRules
          const firstSetting = res.data[0];
          if (firstSetting.expressRules) {
            // 按照 sort 字段升序排序
            expressRules = [...firstSetting.expressRules].sort((a, b) => {
              return (a.sort || 0) - (b.sort || 0);
            });
          } else {
            // 如果没有 expressRules 字段，使用默认规则
            expressRules = DEFAULT_EXPRESS_RULES;
          }
        } else {
          // 如果集合为空，使用默认规则
          expressRules = DEFAULT_EXPRESS_RULES;
        }
        
        // 缓存快递规则
        cacheExpressRules(expressRules);
        this.setData({ expressRules });
        // 计算运费
        this.calculateShippingFee();
      })
      .catch((err) => {
        console.error("获取快递运费规则失败", err);
        // 出错时使用默认规则
        const expressRules = DEFAULT_EXPRESS_RULES;
        this.setData({ expressRules });
        // 计算运费
        this.calculateShippingFee();
      });
  },

  // 计算运费
  calculateShippingFee() {
    const { expressRules, currentProvince, product, quantity } = this.data;
    const { shippingFee, freeShippingThreshold } = calculateShippingFee(expressRules, currentProvince, product, quantity);
    this.setData({ shippingFee, freeShippingThreshold });
  },

  // 获取用户当前位置
  getCurrentLocation() {
    wx.getLocation({
      type: 'wgs84',
      success: async (res) => {
        const { latitude, longitude } = res;
        
        try {
          // 调用腾讯地图API逆地址解析获取省份
          const qqmapsdk = new QQMapWX({ key: 'OB4BZ-D4W3U-B7VVO-4PJWW-6TKDJ-WPB77' });
          qqmapsdk.reverseGeocoder({
            location: {
              latitude: latitude,
              longitude: longitude
            },
            success: async (result) => {
              if (result.status === 0 && result.result && result.result.address_component) {
                const province = result.result.address_component.province;
                // 保存完整的省份名称，如"香港特别行政区"
                const provinceName = province;
                
                // 保存到 addressInfo 集合
                try {
                  const addressInfo = getCollection("adressInfo");
                  const openid = this.data.openid || '';
                  
                  // 查询当前用户最新的地址信息
                  const latestResult = await addressInfo
                    .where({ _openid: openid })
                    .orderBy('createdAt', 'desc')
                    .limit(1)
                    .get();
                  
                  if (latestResult.data && latestResult.data.length > 0) {
                    const latestAddress = latestResult.data[0];
                    // 如果省份信息一致，更新时间
                    if (latestAddress.provence === provinceName) {
                      await addressInfo.doc(latestAddress._id).update({
                        data: {
                          location: {
                            latitude: latitude,
                            longitude: longitude
                          },
                          address: result.result.address,
                          createdAt: new Date()
                        }
                      });
                    } else {
                      // 如果省份信息不一致，新增记录
                      await addressInfo.add({
                        data: {
                          location: {
                            latitude: latitude,
                            longitude: longitude
                          },
                          provence: provinceName,
                          address: result.result.address,
                          createdAt: new Date()
                        }
                      });
                    }
                  } else {
                    // 如果没有记录，新增记录
                    await addressInfo.add({
                      data: {
                        location: {
                          latitude: latitude,
                          longitude: longitude
                        },
                        provence: provinceName,
                        address: result.result.address,
                        createdAt: new Date()
                      }
                    });
                  }
                } catch (saveErr) {
                  console.error("保存地址解析结果失败", saveErr);
                }
                
                this.setData({ currentProvince: provinceName });
                this.calculateShippingFee();
                this.setData({ showLocationModal: false });
                wx.showToast({
                  title: "获取位置成功",
                  icon: "success"
                });
              }
            },
            fail: (err) => {
              console.error("地址解析失败", err);
              wx.showToast({
                title: "获取位置失败",
                icon: "none"
              });
            }
          });
        } catch (err) {
          console.error("查询地址信息失败", err);
          wx.showToast({
            title: "获取位置失败",
            icon: "none"
          });
        }
      },
      fail: (err) => {
        console.error("获取位置失败", err);
        wx.showToast({
          title: "获取位置失败，请授权位置权限",
          icon: "none"
        });
      }
    });
  },

  // 显示位置选择弹窗
  showLocationModal() {
    this.setData({ showLocationModal: true });
  },

  // 隐藏位置选择弹窗
  hideLocationModal() {
    this.setData({ showLocationModal: false });
  },

  // 显示快递计算规则弹窗
  showExpressRules() {
    const { expressRules, currentProvince } = this.data;
    const rulesWithCurrentFlag = sortExpressRules(expressRules, currentProvince);
    this.setData({ 
      showExpressRulesModal: true,
      sortedExpressRules: rulesWithCurrentFlag
    });
  },

  // 隐藏快递计算规则弹窗
  hideExpressRulesModal() {
    this.setData({ showExpressRulesModal: false });
  },

  fetchProduct() {
    // 先尝试从缓存获取
    const cachedProduct = getCachedProduct(this.data.productId);
    if (cachedProduct) {
      console.log('从缓存获取商品详情');
      const product = cachedProduct;
      const stock = typeof product.stock === "number" ? product.stock : 99;
      let displayPrice = formatPrice(product.price);
      
      // 确保images字段是一个数组
      if (!product.images || !Array.isArray(product.images)) {
        product.images = [];
      }
      
      // 计算总图片数量
      let totalImages = 1 + product.images.length; // 默认至少有一张封面图
      
      // 构建预览图片数组
      let previewImageUrls = buildPreviewImages(product);
      
      // 获取同布料的商品
      if (product.materialId) {
        this.fetchSameMaterialProducts(product.materialId);
      } else {
        // 只显示当前商品
        this.setData({
          groupedProducts: [{
            type: '当前商品',
            products: [product]
          }]
        });
      }
      
      this.setData({
        product,
        maxQuantity: stock > 0 ? stock : 1,
        displayPrice,
        totalImages,
        previewImageUrls,
        loading: false
      });
      
      // 获取商品封面图的临时URL
      this.getCoverImageUrl(product.coverImage);
      
      // 计算运费
      this.calculateShippingFee();
      return;
    }

    this.setData({ loading: true, error: false, errorMessage: "" });
    const products = getCollection("products");
    products
      .doc(this.data.productId)
      .get()
      .then((res) => {
        const product = res.data || {};
        const stock = typeof product.stock === "number" ? product.stock : 99;
        let displayPrice = formatPrice(product.price);
        
        // 确保images字段是一个数组
        if (!product.images || !Array.isArray(product.images)) {
          product.images = [];
        }
        
        // 计算总图片数量
        let totalImages = 1 + product.images.length; // 默认至少有一张封面图
        
        // 构建预览图片数组
        let previewImageUrls = buildPreviewImages(product);
        
        // 缓存商品详情
        cacheProduct(this.data.productId, product);
        
        // 获取同布料的商品
        if (product.materialId) {
          this.fetchSameMaterialProducts(product.materialId);
        } else {
          // 只显示当前商品
          this.setData({
            groupedProducts: [{
              type: '当前商品',
              products: [product]
            }]
          });
        }
        
        this.setData({
          product,
          maxQuantity: stock > 0 ? stock : 1,
          displayPrice,
          totalImages,
          previewImageUrls,
          loading: false
        });
        
        // 获取商品封面图的临时URL
        this.getCoverImageUrl(product.coverImage);
        
        // 计算运费
        this.calculateShippingFee();
      })
      .catch((err) => {
        console.error("加载商品详情失败", err);
        this.setData({
          loading: false,
          error: true,
          errorMessage: "加载商品详情失败，请稍后重试"
        });
      });
  },

  reload() {
    this.fetchProduct();
  },

  onQuantityChange(e) {
    const { quantity, productId } = e.detail;
    const maxQuantity = this.data.maxQuantity;
    
    let newQuantity = quantity;
    if (newQuantity < 1) {
      newQuantity = 1;
    } else if (newQuantity > maxQuantity) {
      newQuantity = maxQuantity;
      wx.showToast({
        title: '已达库存上限',
        icon: 'none'
      });
    }
    
    this.setData({
      quantity: newQuantity
    });
    
    // 重新计算运费
    this.calculateShippingFee();
  },

  // 处理留言输入
  onMessageChange(e) {
    this.setData({
      message: e.detail.value
    });
  },

  handleAddToCart() {
    // 检查是否已选择商品
    if (!this.data.productId || !this.data.product.name) {
      wx.showToast({
        title: "请先选择商品",
        icon: "none"
      });
      return;
    }
    
    // 设置为加入购物车模式
    this.setData({ selectorMode: "addCart" });
    // 显示商品选择弹窗
    this.showProductSelector();
  },

  // 确认加入购物车
  confirmAddToCart() {
    if (!this.data.productId) return;
    const db = wx.cloud.database();
    const cart = db.collection("cart");

    const productSnapshot = {
      productId: this.data.productId,
      name: this.data.product.name,
      coverImage: this.data.product.coverImage,
      price: this.data.product.price,
      category: this.data.product.category
    };

    cart
      .where({
        productId: this.data.productId
      })
      .get()
      .then((res) => {
        if (res.data && res.data.length > 0) {
          const docId = res.data[0]._id;
          return cart.doc(docId).update({
            data: {
              quantity: res.data[0].quantity + this.data.quantity,
              message: this.data.message,
              updatedAt: new Date()
            }
          });
        } else {
          // 获取当前用户的最大sort值
          const openid = wx.getStorageSync('openid') || '';
          return cart.where({ _openid: openid, isDelete: false }).orderBy('sort', 'desc').limit(1).get().then(sortRes => {
            let sort = 1;
            if (sortRes.data && sortRes.data.length > 0) {
              sort = sortRes.data[0].sort + 1;
            }
            return cart.add({
              data: {
                productId: this.data.productId,
                quantity: this.data.quantity,
                message: this.data.message,
                checked: true,
                productSnapshot,
                isDelete: false,
                sort: sort,
                createdAt: new Date(),
                updatedAt: new Date()
              }
            });
          });
        }
      })
      .then(() => {
        wx.showToast({
          title: "已加入购物车",
          icon: "success"
        });
        this.hideProductSelector();
      })
      .catch((err) => {
        console.error("加入购物车失败", err);
        wx.showToast({
          title: "加入购物车失败",
          icon: "none"
        });
      });
  },

  handleBuyNow() {
    const id = this.data.productId;
    if (!id) return;
    
    // 检查是否在商品选择弹窗中点击
    if (this.data.showProductSelectorModal) {
      this.hideProductSelector();
    }
    
    wx.navigateTo({
      url: `/pages/order-confirm/index?productId=${id}&quantity=${this.data.quantity}&message=${encodeURIComponent(this.data.message)}`
    });
  },

  // 处理立即购买按钮点击
  handleBuyNowBtn() {
    // 检查是否已选择商品
    if (!this.data.productId || !this.data.product.name) {
      wx.showToast({
        title: "请先选择商品",
        icon: "none"
      });
      return;
    }
    
    // 设置为立即购买模式
    this.setData({ selectorMode: "buyNow" });
    // 显示商品选择弹窗
    this.showProductSelector();
  },

  // 显示购物车预览
  showCartPreview() {
    this.setData({
      showCartPreview: true
    });
  },

  // 关闭购物车预览
  closeCartPreview() {
    this.setData({
      showCartPreview: false
    });
  },

  // 跳转到购物车
  goToCart() {
    wx.switchTab({
      url: '/pages/cart/index'
    });
  },



  // 长按扫码
  scanQRCode() {
    scanQRCode();
  },

  // 处理客服消息回调
  handleContact(e) {
    console.log('用户从客服会话返回', e.detail);
    // e.detail.path: 用户点击的消息路径
    // e.detail.query: 用户点击的消息参数
  },

  // 获取商品封面图的临时URL
  getCoverImageUrl(coverImage) {
    if (coverImage) {
      wx.cloud.getTempFileURL({
        fileList: [coverImage],
        success: (res) => {
          if (res.fileList && res.fileList.length > 0) {
            this.setData({
              coverImageUrl: res.fileList[0].tempFileURL
            });
          }
        },
        fail: (err) => {
          console.error('获取临时文件URL失败', err);
        }
      });
    }
  },

  // 补货提醒
  handleRestockReminder() {
    const product = this.data.product;
    if (!product || !product._id) {
      wx.showToast({
        title: '商品信息错误',
        icon: 'none'
      });
      return;
    }

    // 获取用户信息
    wx.getSetting({
      success: (res) => {
        if (res.authSetting['scope.userInfo']) {
          wx.getUserInfo({
            success: (userInfoRes) => {
              this.saveRestockReminder(product, userInfoRes.userInfo);
            },
            fail: () => {
              this.saveRestockReminder(product, null);
            }
          });
        } else {
          this.saveRestockReminder(product, null);
        }
      }
    });
  },

  // 保存补货提醒到数据库
  saveRestockReminder(product, userInfo) {
    const db = wx.cloud.database();
    const replenishment = db.collection('replenishment');
    
    // 构建用户信息
    const userData = {
      openid: wx.getStorageSync('openid') || 'unknown',
      nickName: userInfo ? userInfo.nickName : '匿名用户',
      avatarUrl: userInfo ? userInfo.avatarUrl : '',
      requestCount: 1,
      requestTime: new Date()
    };

    // 构建商品信息
    const productData = {
      productId: product._id,
      name: product.name,
      coverImage: product.coverImage,
      price: product.price,
      categoryId: product.categoryId,
      isReplenished: false
    };

    // 查询是否存在该商品的未补货记录
    replenishment
      .where({
        'productData.productId': product._id,
        'productData.isReplenished': false
      })
      .get()
      .then((res) => {
        if (res.data && res.data.length > 0) {
          // 存在未补货记录
          const existingRecord = res.data[0];
          const users = existingRecord.users || [];
          
          // 检查用户是否已经存在
          const userIndex = users.findIndex(user => user.openid === userData.openid);
          
          if (userIndex !== -1) {
            // 用户已存在
            const user = users[userIndex];
            if (user.requestCount >= 3) {
              // 已达到最大请求次数
              wx.showToast({
                title: '已发起补货提醒',
                icon: 'none'
              });
            } else {
              // 增加请求次数
              user.requestCount += 1;
              user.requestTime = new Date();
              
              // 更新记录
              replenishment
                .doc(existingRecord._id)
                .update({
                  data: {
                    users: users,
                    updatedAt: new Date()
                  }
                })
                .then(() => {
                  wx.showToast({
                    title: '补货提醒已更新',
                    icon: 'success'
                  });
                })
                .catch((err) => {
                  console.error('更新补货提醒失败', err);
                  wx.showToast({
                    title: '操作失败，请稍后重试',
                    icon: 'none'
                  });
                });
            }
          } else {
            // 用户不存在，添加新用户
            users.push(userData);
            
            // 更新记录
            replenishment
              .doc(existingRecord._id)
              .update({
                data: {
                  users: users,
                  updatedAt: new Date()
                }
              })
              .then(() => {
                wx.showToast({
                  title: '已设置补货提醒',
                  icon: 'success'
                });
              })
              .catch((err) => {
                console.error('更新补货提醒失败', err);
                wx.showToast({
                  title: '操作失败，请稍后重试',
                  icon: 'none'
                });
              });
          }
        } else {
          // 不存在未补货记录，创建新记录
          replenishment
            .add({
              data: {
                productData: productData,
                users: [userData],
                createdAt: new Date(),
                updatedAt: new Date()
              }
            })
            .then(() => {
              wx.showToast({
                title: '已设置补货提醒',
                icon: 'success'
              });
            })
            .catch((err) => {
              console.error('创建补货提醒失败', err);
              wx.showToast({
                title: '操作失败，请稍后重试',
                icon: 'none'
              });
            });
        }
      })
      .catch((err) => {
        console.error('查询补货提醒失败', err);
        wx.showToast({
          title: '操作失败，请稍后重试',
          icon: 'none'
        });
      });
  },

  // 处理图片点击，显示预览
  handleImageTap(e) {
    const currentIndex = parseInt(e.currentTarget.dataset.index) || 0;
    wx.previewImage({
      current: this.data.previewImageUrls[currentIndex],
      urls: this.data.previewImageUrls
    });
  },

  // 滑动切换图片时更新索引
  swiperChange(e) {
    this.setData({
      currentIndex: e.detail.current
    });
  },

  // 处理轮播图触摸开始事件
  handleSwiperTouchStart(e) {
    this.setData({
      touchStartTime: e.timeStamp
    });
  },

  // 处理轮播图触摸结束事件
  handleSwiperTouchEnd(e) {
    this.setData({
      touchEndTime: e.timeStamp
    });
  },

  // 显示分享选项
  showShareOptions() {
    showShareOptions(this);
  },

  // 隐藏分享选项
  hideShareOptions() {
    hideShareOptions(this);
  },

  // 分享给微信好友
  shareToFriend() {
    shareToFriend(this);
  },

  // 分享到朋友圈
  shareToTimeline() {
    shareToTimeline(this);
  },

  // 生成海报
  generatePoster() {
    generatePoster(this);
  },

  // 分享给微信好友的配置
  onShareAppMessage() {
    const product = this.data.product;
    return getShareAppMessageConfig(product, this.data.productId);
  },

  // 分享到朋友圈的配置
  onShareTimeline() {
    const product = this.data.product;
    return getShareTimelineConfig(product, this.data.productId);
  },

  // 切换商品名称展开/收起状态
  toggleTitleExpanded() {
    this.setData({
      isTitleExpanded: !this.data.isTitleExpanded
    });
  },

  // 切换商品描述展开/收起状态
  toggleDescExpanded() {
    this.setData({
      isDescExpanded: !this.data.isDescExpanded
    });
  },

  // 获取同布料的商品
  fetchSameMaterialProducts(materialId) {
    console.log('开始获取同布料商品，materialId:', materialId);
    const products = getCollection("products");
    const productTypes = getCollection("product_types");
    
    console.log('开始查询同布料商品，materialId:', materialId);
    products
      .where({ materialId: materialId })
      .get()
      .then((res) => {
        console.log('查询结果:', res);
        const sameMaterialProducts = res.data || [];
        console.log('获取到同布料商品:', sameMaterialProducts.length);
        console.log('商品详情:', sameMaterialProducts);
        
        // 分离当前商品和其他同布料商品
        const currentProduct = this.data.product;
        const otherProducts = sameMaterialProducts.filter(product => product._id !== currentProduct._id);
        
        // 构建分组结果
        const groupedProducts = [];
        
        // 添加当前商品区域
        groupedProducts.push({
          type: '当前商品',
          products: [currentProduct]
        });
        
        // 如果有其他同布料商品，添加布料同款区域
        if (otherProducts.length > 0) {
          // 按类型分组
          const typeGroupedProducts = {};
          
          // 先获取所有类型信息
          const typeIds = [...new Set(otherProducts.map(product => product.typeId).filter(Boolean))];
          console.log('类型ID:', typeIds);
          
          if (typeIds.length === 0) {
            console.log('没有类型ID，按默认分组');
            // 没有类型ID时，将所有商品放在默认分组
            groupedProducts.push({
              type: '布料同款',
              products: otherProducts
            });
            this.setData({
              groupedProducts: groupedProducts
            });
            return;
          }
          
          const typePromises = typeIds.map(typeId => productTypes.doc(typeId).get());
          
          Promise.all(typePromises)
            .then((typeResults) => {
              const typeMap = {};
              typeResults.forEach(result => {
                if (result.data) {
                  typeMap[result.data._id] = result.data;
                }
              });
              console.log('类型信息:', typeMap);
              
              // 再获取所有父类型信息
              const parentTypeIds = [...new Set(Object.values(typeMap).map(type => type.parentId).filter(Boolean))];
              console.log('父类型ID:', parentTypeIds);
              
              if (parentTypeIds.length === 0) {
                console.log('没有父类型ID，按默认分组');
                // 没有父类型ID时，将所有商品放在默认分组
                groupedProducts.push({
                  type: '布料同款',
                  products: otherProducts
                });
                this.setData({
                  groupedProducts: groupedProducts
                });
                return;
              }
              
              const parentTypePromises = parentTypeIds.map(parentId => productTypes.doc(parentId).get());
              
              Promise.all(parentTypePromises)
                .then((parentTypeResults) => {
                  const parentTypeMap = {};
                  parentTypeResults.forEach(result => {
                    if (result.data) {
                      parentTypeMap[result.data._id] = result.data;
                    }
                  });
                  console.log('父类型信息:', parentTypeMap);
                  
                  // 按父类型分组
                  const ungroupedProducts = [];
                  
                  otherProducts.forEach(product => {
                    const type = typeMap[product.typeId];
                    console.log('处理商品:', product.name, 'typeId:', product.typeId, 'type:', type);
                    if (type && type.parentId) {
                      const parentType = parentTypeMap[type.parentId];
                      console.log('父类型:', parentType);
                      if (parentType) {
                        const parentTypeName = parentType.name;
                        if (!typeGroupedProducts[parentTypeName]) {
                          typeGroupedProducts[parentTypeName] = {
                            type: parentTypeName,
                            products: []
                          };
                        }
                        typeGroupedProducts[parentTypeName].products.push(product);
                        console.log('添加商品到分组:', parentTypeName, product.name);
                      } else {
                        // 父类型不存在，加入未分组商品
                        ungroupedProducts.push(product);
                      }
                    } else {
                      // 类型不存在或没有父类型，加入未分组商品
                      ungroupedProducts.push(product);
                    }
                  });
                  
                  // 创建布料同款分组
                  const fabricSameGroup = {
                    type: '布料同款',
                    subGroups: []
                  };
                  
                  // 将分组后的商品添加到布料同款分组
                  const fabricSameProducts = Object.values(typeGroupedProducts);
                  if (fabricSameProducts.length > 0) {
                    fabricSameGroup.subGroups.push(...fabricSameProducts);
                  }
                  
                  // 将未分组商品添加到布料同款分组
                  if (ungroupedProducts.length > 0) {
                    fabricSameGroup.subGroups.push({
                      type: '其他',
                      products: ungroupedProducts
                    });
                  }
                  
                  // 添加布料同款分组到结果中
                  if (fabricSameGroup.subGroups.length > 0) {
                    groupedProducts.push(fabricSameGroup);
                  }
                  
                  console.log('最终分组结果:', groupedProducts);
                  this.setData({
                    groupedProducts: groupedProducts
                  });
                })
                .catch((err) => {
                  console.error("获取父类型信息失败", err);
                  // 出错时，将所有商品放在布料同款分组
                  groupedProducts.push({
                    type: '布料同款',
                    products: otherProducts
                  });
                  this.setData({
                    groupedProducts: groupedProducts
                  });
                });
          })
          .catch((err) => {
            console.error("获取类型信息失败", err);
            // 出错时，将所有商品放在布料同款分组
            groupedProducts.push({
              type: '布料同款',
              products: otherProducts
            });
            this.setData({
              groupedProducts: groupedProducts
            });
          });
      } else {
        // 没有其他同布料商品
        console.log('没有其他同布料商品');
        this.setData({
          groupedProducts: groupedProducts
        });
      }
      })
      .catch((err) => {
        console.error("获取同布料商品失败", err);
        // 出错时，只显示当前商品
        const currentProduct = this.data.product;
        this.setData({
          groupedProducts: [{
            type: '当前商品',
            products: [currentProduct]
          }]
        });
      });
  },

  // 显示商品选择器
  showProductSelector() {
    this.setData({
      showProductSelectorModal: true
    });
  },

  // 隐藏商品选择器
  hideProductSelector() {
    this.setData({
      showProductSelectorModal: false,
      selectorMode: ""
    });
  },

  // 选择商品
  selectProduct(e) {
    const selectedProduct = e.currentTarget.dataset.product;
    
    // 确保images字段是一个数组
    if (!selectedProduct.images || !Array.isArray(selectedProduct.images)) {
      selectedProduct.images = [];
    }
    
    // 构建预览图片数组
    let previewImageUrls = [selectedProduct.coverImage];
    if (selectedProduct.images.length > 0) {
      previewImageUrls = previewImageUrls.concat(selectedProduct.images);
    }
    
    // 计算总图片数量
    let totalImages = 1 + selectedProduct.images.length;
    
    // 计算价格
    let displayPrice = "0.00";
    if (typeof selectedProduct.price === "number") {
      displayPrice = selectedProduct.price.toFixed(2);
    }
    
    // 计算库存
    const stock = typeof selectedProduct.stock === "number" ? selectedProduct.stock : 99;
    
    this.setData({
      product: selectedProduct,
      productId: selectedProduct._id,
      displayPrice,
      maxQuantity: stock > 0 ? stock : 1,
      quantity: 1, // 重置数量为1
      totalImages,
      previewImageUrls,
      currentIndex: 0
    });
    
    // 重新计算运费
    this.calculateShippingFee();
  },

  // 处理商品选择模态框中图片点击
  handleOptionImageTap(e) {
    const product = e.currentTarget.dataset.product;
    const currentIndex = parseInt(e.currentTarget.dataset.index) || 0;
    
    // 构建预览图片数组
    let previewImageUrls = [product.coverImage];
    if (product.images && Array.isArray(product.images)) {
      previewImageUrls = previewImageUrls.concat(product.images);
    }
    
    wx.previewImage({
      current: previewImageUrls[currentIndex],
      urls: previewImageUrls
    });
  },

  // 阻止事件冒泡
  stopPropagation() {
    // 空方法，用于阻止事件冒泡
  },

  // 处理商品选择模态框顶部已选商品图片点击
  handleSelectedImageTap() {
    wx.previewImage({
      current: this.data.previewImageUrls[0],
      urls: this.data.previewImageUrls
    });
  },

  // 处理商品详情图片点击
  handleDetailImageTap(e) {
    const currentIndex = parseInt(e.currentTarget.dataset.index) || 0;
    wx.previewImage({
      current: this.data.previewImageUrls[currentIndex],
      urls: this.data.previewImageUrls
    });
  }
});