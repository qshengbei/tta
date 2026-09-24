// utils/confirm.js
// 统一确认弹窗调用入口：Promise 版，替代业务确认类的 wx.showModal
//
// 使用方式（页面需在 json 注册组件、wxml 末尾放一个 <confirm-dialog id="confirm-dialog" />）：
//   const res = await confirm({ title: '取消订单', content: '确定要取消这个订单吗？', tone: 'danger' });
//   if (!res.confirm) return;
//
// 返回结构与 wx.showModal 一致：{ confirm, cancel }

/**
 * 取当前页面上的确认弹窗实例
 */
function getConfirmDialog() {
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  if (!page || typeof page.selectComponent !== 'function') {
    return null;
  }
  return page.selectComponent('#confirm-dialog');
}

/**
 * 打开确认弹窗
 * @param {object} options
 * @param {string} options.title 标题
 * @param {string} options.content 内容
 * @param {string} [options.confirmText='确定'] 确认按钮文案
 * @param {string} [options.cancelText='取消'] 取消按钮文案
 * @param {boolean} [options.showCancel=true] 是否显示取消按钮（false 时为单按钮提示）
 * @param {string} [options.tone='default'] 确认按钮语义色：default(黑) | info(蓝) | success(绿) | danger(红，删除等不可逆操作)
 * @param {boolean} [options.maskClosable=true] 点击遮罩是否等同取消
 * @returns {Promise<{confirm: boolean, cancel: boolean}>}
 */
export function confirm(options = {}) {
  const dialog = getConfirmDialog();

  if (!dialog) {
    // 页面未注册组件时退回系统弹窗，保证功能可用
    console.warn('[confirm] 当前页面未注册 confirm-dialog 组件，已退回 wx.showModal');
    return new Promise((resolve) => {
      wx.showModal({
        title: options.title,
        content: options.content,
        confirmText: options.confirmText,
        cancelText: options.cancelText,
        showCancel: options.showCancel !== false,
        success: (res) => resolve({ confirm: !!res.confirm, cancel: !!res.cancel }),
        fail: () => resolve({ confirm: false, cancel: true })
      });
    });
  }

  return dialog.open(options);
}
