// 初始化商品类型数据
const db = wx.cloud.database();
const productTypes = db.collection('product_types');

// 商品类型数据
const typeData = [
  // 一级类型
  { _id: 'type_001', name: '发圈', parentId: null, level: 1, sort: 10, createdAt: new Date() },
  { _id: 'type_002', name: '发夹', parentId: null, level: 1, sort: 20, createdAt: new Date() },
  { _id: 'type_003', name: '布包', parentId: null, level: 1, sort: 30, createdAt: new Date() },
  
  // 二级类型 - 发圈
  { _id: 'type_004', name: '小号单层发圈', parentId: 'type_001', level: 2, sort: 10, createdAt: new Date() },
  { _id: 'type_005', name: '单层发圈', parentId: 'type_001', level: 2, sort: 20, createdAt: new Date() },
  { _id: 'type_006', name: '双层发圈', parentId: 'type_001', level: 2, sort: 30, createdAt: new Date() },
  { _id: 'type_007', name: '方巾', parentId: 'type_001', level: 2, sort: 40, createdAt: new Date() },
  
  // 二级类型 - 发夹
  { _id: 'type_008', name: '蝴蝶结发夹', parentId: 'type_002', level: 2, sort: 10, createdAt: new Date() },
  { _id: 'type_009', name: '堆堆夹', parentId: 'type_002', level: 2, sort: 20, createdAt: new Date() },
  
  // 二级类型 - 布包
  { _id: 'type_010', name: '挂件耳机包', parentId: 'type_003', level: 2, sort: 10, createdAt: new Date() },
  { _id: 'type_011', name: '纽扣耳机包', parentId: 'type_003', level: 2, sort: 20, createdAt: new Date() },
  { _id: 'type_012', name: '卡包', parentId: 'type_003', level: 2, sort: 30, createdAt: new Date() },
  { _id: 'type_013', name: '福袋包', parentId: 'type_003', level: 2, sort: 40, createdAt: new Date() },
  { _id: 'type_014', name: '手机挎包', parentId: 'type_003', level: 2, sort: 50, createdAt: new Date() },
  { _id: 'type_015', name: '单肩包', parentId: 'type_003', level: 2, sort: 60, createdAt: new Date() }
];

// 批量添加数据
async function initProductTypes() {
  try {
    console.log('开始初始化商品类型数据...');
    console.log('数据总量:', typeData.length);
    
    // 先清空集合，确保数据一致性
    try {
      const result = await productTypes.get();
      console.log('当前集合数据量:', result.data.length);
      for (const item of result.data) {
        await productTypes.doc(item._id).remove();
        console.log('删除旧数据:', item.name);
      }
      console.log('旧数据已清空');
    } catch (err) {
      console.error('清空旧数据失败:', err);
    }
    
    // 重新添加所有数据
    let successCount = 0;
    for (const item of typeData) {
      try {
        await productTypes.add({ data: item });
        console.log(`添加成功: ${item.name}`);
        successCount++;
      } catch (err) {
        console.error(`添加失败: ${item.name}`, err);
      }
    }
    
    console.log(`商品类型数据初始化完成！成功添加 ${successCount} 条数据`);
    
    // 验证数据是否添加成功
    try {
      const result = await productTypes.get();
      console.log('验证: 集合数据量:', result.data.length);
      console.log('验证: 数据列表:', result.data.map(item => item.name));
    } catch (err) {
      console.error('验证数据失败:', err);
    }
    
  } catch (err) {
    console.error('初始化商品类型数据失败:', err);
  }
}

// 导出函数
module.exports = { initProductTypes };
