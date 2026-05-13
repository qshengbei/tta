/**
 * 消息实时监听适配层
 * 
 * 使用方式：
 * import { MessageListener } from '../../utils/messageListener';
 * 
 * // 在 page 中
 * this.messageListener = new MessageListener(this);
 * this.messageListener.startMessageListener(sessionId);
 * this.messageListener.startSessionListener();
 */

import { watch, unwatch } from './realtimeListener';

const MESSAGE_LISTENER_KEY = 'messages_watch';
const SESSION_LISTENER_KEY = 'sessions_watch';

class MessageListener {
  constructor(page) {
    this.page = page;
    this.messageListenerKey = MESSAGE_LISTENER_KEY;
    this.sessionListenerKey = SESSION_LISTENER_KEY;
    this.lastMessageId = null;
    this.messageBuffer = []; // 缓冲未处理的消息
    this.isMessageListenerActive = false;
    this.isSessionListenerActive = false;
  }

  /**
   * 启动消息监听
   * @param {string} sessionId - 会话 ID
   */
  startMessageListener(sessionId) {
    if (!sessionId) {
      console.error('[MessageListener] sessionId 不能为空');
      return;
    }

    const callback = (changes, meta) => {
      this.handleMessageChanges(changes, meta, sessionId);
    };

    try {
      watch(this.messageListenerKey, { sessionId }, callback, {
        collectionName: 'messages',
        dedupeKey: '_id',
        maxReconnectAttempts: 5
      });

      this.isMessageListenerActive = true;
      console.log('[MessageListener] 消息监听已启动，会话:', sessionId);
    } catch (error) {
      console.error('[MessageListener] 启动消息监听失败:', error);
    }
  }

  /**
   * 启动会话监听
   */
  startSessionListener() {
    const openid = wx.getStorageSync('openid');
    if (!openid) {
      console.error('[MessageListener] 获取 openid 失败');
      return;
    }

    const callback = (changes, meta) => {
      this.handleSessionChanges(changes, meta);
    };

    try {
      watch(this.sessionListenerKey, { userId: openid }, callback, {
        collectionName: 'sessions',
        dedupeKey: '_id',
        maxReconnectAttempts: 5
      });

      this.isSessionListenerActive = true;
      console.log('[MessageListener] 会话监听已启动');
    } catch (error) {
      console.error('[MessageListener] 启动会话监听失败:', error);
    }
  }

  /**
   * 处理消息变化
   */
  handleMessageChanges(changes, meta, sessionId) {
    const { added, modified, removed } = changes;
    const { messages = [], messageListReady = true } = this.page.data;

    // 如果页面未准备好，缓冲消息
    if (!messageListReady) {
      if (added && added.length > 0) {
        this.messageBuffer.push(...added);
      }
      return;
    }

    let hasChanges = false;
    let newMessages = [...messages];

    // 处理新增消息（关键：避免本人消息重复）
    if (added && added.length > 0) {
      added.forEach((msg) => {
        // 检查是否已存在（去重）
        const existIndex = newMessages.findIndex(m => m._id === msg._id);
        
        if (existIndex === -1) {
          // 检查是否是本人消息（本人消息已在本地即时追加）
          const isOwnMessage = msg.openid === this.page.data.openid || 
                             msg.role === this.page.data.messageRole;
          
          if (!isOwnMessage) {
            newMessages.push(msg);
            hasChanges = true;
            console.log('[MessageListener] 接收新消息');
            
            // 清除未读标记（对端消息）
            this.clearUnreadCount(sessionId);
          }
        }
      });
    }

    // 处理消息修改（撤回、编辑等）
    if (modified && modified.length > 0) {
      modified.forEach((msg) => {
        const existIndex = newMessages.findIndex(m => m._id === msg._id);
        if (existIndex !== -1) {
          const oldMsg = newMessages[existIndex];
          newMessages[existIndex] = {
            ...oldMsg,
            ...msg
          };
          hasChanges = true;

          // 检测消息撤回
          if (oldMsg.status !== 'revoked' && msg.status === 'revoked') {
            console.log('[MessageListener] 消息已撤回');
          }
        }
      });
    }

    // 处理消息删除
    if (removed && removed.length > 0) {
      removed.forEach((msg) => {
        const existIndex = newMessages.findIndex(m => m._id === msg._id);
        if (existIndex !== -1) {
          newMessages.splice(existIndex, 1);
          hasChanges = true;
        }
      });
    }

    // 更新页面数据
    if (hasChanges) {
      this.page.setData({
        messages: newMessages,
        groupedMessages: this.page.groupMessages ? this.page.groupMessages(newMessages) : newMessages
      });

      // 滚动到底部显示最新消息
      this.scrollToBottom();
    }
  }

  /**
   * 处理会话变化
   */
  handleSessionChanges(changes, meta) {
    const { added, modified, removed } = changes;
    const { sessions = [] } = this.page.data;

    let newSessions = [...sessions];
    let hasChanges = false;

    // 处理新增会话
    if (added && added.length > 0) {
      added.forEach((session) => {
        const existIndex = newSessions.findIndex(s => s._id === session._id);
        if (existIndex === -1) {
          newSessions.unshift(session);
          hasChanges = true;
          console.log('[MessageListener] 新增会话:', session._id);
        }
      });
    }

    // 处理会话修改（未读计数、最后消息等）
    if (modified && modified.length > 0) {
      modified.forEach((session) => {
        const existIndex = newSessions.findIndex(s => s._id === session._id);
        if (existIndex !== -1) {
          const oldSession = newSessions[existIndex];
          
          // 检测未读计数变化
          if (oldSession.unreadCount !== session.unreadCount) {
            console.log(`[MessageListener] 会话未读计数变更: ${session._id} ${oldSession.unreadCount} -> ${session.unreadCount}`);
          }

          newSessions[existIndex] = {
            ...oldSession,
            ...session
          };
          hasChanges = true;
        }
      });
    }

    // 处理会话删除
    if (removed && removed.length > 0) {
      removed.forEach((session) => {
        const existIndex = newSessions.findIndex(s => s._id === session._id);
        if (existIndex !== -1) {
          console.log('[MessageListener] 会话删除:', session._id);
          newSessions.splice(existIndex, 1);
          hasChanges = true;
        }
      });
    }

    // 更新页面数据
    if (hasChanges) {
      this.page.setData({ sessions: newSessions });
    }
  }

  /**
   * 滚动到底部
   */
  scrollToBottom() {
    if (this.page.data.scrollTop !== undefined) {
      this.page.setData({
        scrollTop: 999999
      });
    }
  }

  /**
   * 清除未读计数
   */
  clearUnreadCount(sessionId) {
    // 异步调用云函数（不阻塞 UI）
    wx.cloud.callFunction({
      name: 'clearUnreadCount',
      data: { sessionId }
    }).catch(error => {
      console.error('[MessageListener] 清除未读计数失败:', error);
    });
  }

  /**
   * 处理缓冲的消息
   */
  flushMessageBuffer() {
    if (this.messageBuffer.length > 0) {
      const buffer = this.messageBuffer;
      this.messageBuffer = [];
      
      const changes = {
        added: buffer,
        modified: [],
        removed: []
      };

      this.handleMessageChanges(changes, {}, this.page.data.sessionId);
      console.log(`[MessageListener] 已处理缓冲消息 ${buffer.length} 条`);
    }
  }

  /**
   * 停止消息监听
   */
  stopMessageListener() {
    if (!this.isMessageListenerActive) {
      console.warn('[MessageListener] 消息监听未启动');
      return;
    }

    unwatch(this.messageListenerKey);
    this.isMessageListenerActive = false;
    console.log('[MessageListener] 消息监听已停止');
  }

  /**
   * 停止会话监听
   */
  stopSessionListener() {
    if (!this.isSessionListenerActive) {
      console.warn('[MessageListener] 会话监听未启动');
      return;
    }

    unwatch(this.sessionListenerKey);
    this.isSessionListenerActive = false;
    console.log('[MessageListener] 会话监听已停止');
  }

  /**
   * 停止所有监听
   */
  stopAll() {
    this.stopMessageListener();
    this.stopSessionListener();
  }

  /**
   * 获取监听状态
   */
  getStatus() {
    return {
      messageListenerActive: this.isMessageListenerActive,
      sessionListenerActive: this.isSessionListenerActive,
      messageBufferSize: this.messageBuffer.length
    };
  }
}

export { MessageListener };
