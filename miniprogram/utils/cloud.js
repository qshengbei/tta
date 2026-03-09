// utils/cloud.js

const db = wx.cloud.database();

export function getDB() {
  return db;
}

export function getCollection(collectionName) {
  return db.collection(collectionName);
}

export function callFunction(name, data = {}) {
  return wx.cloud.callFunction({
    name,
    data
  });
}

export function uploadFile(cloudPath, filePath) {
  return wx.cloud.uploadFile({
    cloudPath,
    filePath
  });
}