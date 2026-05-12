const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

function normalizeDateInput(raw) {
  if (!raw) return null;
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw === 'object') {
    if (raw._type === 'Date' && typeof raw._value !== 'undefined') {
      const d = new Date(raw._value);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof raw.getTime === 'function') {
      const d = new Date(raw.getTime());
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof raw.toDate === 'function') {
      const d = raw.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    }
    if (raw.$date) return normalizeDateInput(raw.$date);
    if (raw.date) return normalizeDateInput(raw.date);
    if (raw.value) return normalizeDateInput(raw.value);
    return null;
  }
  if (typeof raw === 'number') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    let d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d;

    const cleaned = trimmed
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/GMT([+-]\d{2})(\d{2})/, 'GMT$1:$2');
    d = new Date(cleaned);
    if (!Number.isNaN(d.getTime())) return d;

    d = new Date(cleaned.replace(/-/g, '/'));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

exports.main = async (event, context) => {
  const { messageId } = event || {};
  const { OPENID } = cloud.getWXContext();

  const syncSessionLastMessageRevoked = async (messageDoc) => {
    if (!messageDoc || !messageDoc.sessionId || !messageDoc._id) return;
    try {
      const sessionRes = await db.collection('sessions').doc(messageDoc.sessionId).get();
      const sessionDoc = sessionRes && sessionRes.data;
      if (!sessionDoc || !sessionDoc.lastMessage || sessionDoc.lastMessage._id !== messageDoc._id) {
        return;
      }

      const nextLastMessage = {
        ...sessionDoc.lastMessage,
        status: 'revoked'
      };

      await db.collection('sessions').doc(messageDoc.sessionId).update({
        data: {
          lastMessage: nextLastMessage
        }
      });
    } catch (e) {
      console.error('同步会话摘要撤回状态失败', e);
    }
  };

  try {
    if (!messageId) {
      return { success: false, error: '消息ID缺失' };
    }

    const res = await db.collection('messages').where({ _id: messageId }).limit(1).get();
    const doc = res && res.data && res.data[0];
    if (!doc) {
      return { success: false, error: '消息不存在或已删除' };
    }

    if (doc.openid !== OPENID) {
      return { success: false, error: '只能撤回本人消息' };
    }

    if (doc.status === 'revoked') {
      await syncSessionLastMessageRevoked(doc);
      return { success: true, alreadyRevoked: true };
    }

    const createDate = normalizeDateInput(doc.createTime);
    if (!createDate) {
      return { success: false, error: '消息时间解析失败' };
    }

    const diff = Date.now() - createDate.getTime();
    if (diff < 0 || diff > 2 * 60 * 1000) {
      return { success: false, error: '消息超过2分钟，无法撤回' };
    }

    const updateRes = await db.collection('messages').doc(doc._id).update({
      data: {
        status: 'revoked',
        updateTime: db.serverDate()
      }
    });

    const updated = (updateRes && updateRes.stats && Number(updateRes.stats.updated)) || (updateRes && Number(updateRes.updated)) || 0;
    if (!updated) {
      const verify = await db.collection('messages').doc(doc._id).get();
      if (!verify || !verify.data || verify.data.status !== 'revoked') {
        return { success: false, error: '数据库更新失败' };
      }
    }

    await syncSessionLastMessageRevoked({ ...doc, status: 'revoked' });

    return { success: true };
  } catch (err) {
    console.error('revokeMessage 云函数失败', err);
    return { success: false, error: err && err.message ? err.message : '撤回失败' };
  }
};