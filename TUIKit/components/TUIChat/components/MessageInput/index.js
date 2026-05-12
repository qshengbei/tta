import logger from '../../../../utils/logger';
import constant from '../../../../utils/constant';
// eslint-disable-next-line no-undef
Component({
  /**
   * 组件的属性列表
   */
  properties: {
    conversation: {
      type: Object,
      value: {},
      observer(newVal) {
        this.setData({
          conversation: newVal,
        });
      },
    },
    hasCallKit: {
      type: Boolean,
      value: false,
      observer(hasCallKit) {
        this.setData({
          hasCallKit,
        });
      },
    },
    currentChatType: {
      type: String,
      value: '',
      observer(currentChatType) {
        const { CONVERSATION_TYPE } = constant;
        if (currentChatType === CONVERSATION_TYPE.CUSTOMER_SERVICE) {
          this.setData({
            showCallExtension: false,
          });
        }
      },
    },
  },

  /**
   * 组件的初始数据
   */
  data: {
    conversation: {},
    message: '',
    extensionArea: false,
    sendMessageBtn: false,
    displayFlag: '',
    bottomVal: 0,
    commonFunction: [
      { name: '常用语', key: '0' },
      { name: '发送订单', key: '1' },
      { name: '服务评价', key: '2' },
    ],
    displayServiceEvaluation: false,
    showErrorImageFlag: 0,
    messageList: [],
    isFirstSendTyping: true,
    time: 0,
    focus: false,
    isEmoji: false,
    fileList: [],
    hasCallKit: false,
    textareaHeight: 0,
    showCallExtension: true,
  },

  lifetimes: {
    attached() {
      // 组件初始化
    },
  },

  /**
   * 组件的方法列表
   */
  methods: {
    // 获取消息列表来判断是否发送正在输入状态
    getMessageList(conversation) {
      wx.$TUIKit.getMessageList({
        conversationID: conversation.conversationID,
        nextReqMessageID: this.data.nextReqMessageID,
        count: 15,
      }).then((res) => {
        const { messageList } = res.data;
        this.setData({
          messageList,
        });
      });
    },

    // 选中表情消息
    handleEmoji() {
      let targetFlag = 'emoji';
      if (this.data.displayFlag === 'emoji') {
        targetFlag = '';
      }
      
      // 显示或隐藏表情弹窗
      this.setData({
        isEmoji: true,
        displayFlag: targetFlag,
      }, () => {
        // 触发输入高度变化事件，通知父组件更新布局
        this.triggerEvent('inputHeightChange', {});
      });
    },

    // 选自定义消息
    handleExtensions() {
      let targetFlag = 'extension';
      if (this.data.displayFlag === 'extension') {
        targetFlag = '';
      }
      this.triggerEvent('inputHeightChange', {});
      this.setData({
        displayFlag: targetFlag,
      });
    },

    error(e) {
      console.log(e.detail);
    },

    handleSendPicture() {
      this.sendMediaMessage('camera', 'image');
    },

    handleSendImage() {
      this.sendMediaMessage('album', 'image');
    },

    sendMediaMessage(type, mediaType) {
      const { fileList } = this.data;
      wx.chooseMedia({
        count: 9,
        sourceType: [type],
        mediaType: [mediaType],
        success: (res) => {
          const mediaInfoList = res.tempFiles;
          mediaInfoList.forEach((mediaInfo) => {
            fileList.push({ type: res.type, tempFiles: [{ tempFilePath: mediaInfo.tempFilePath }] });
          });
          fileList.forEach((file) => {
            if (file.type === 'image') {
              this.handleSendImageMessage(file);
            }
            if (file.type === 'video') {
              this.handleSendVideoMessage(file);
            }
          });
          this.data.fileList = [];
        },
      });
    },

    // 发送图片消息
    handleSendImageMessage(file) {
      const message = wx.$TUIKit.createImageMessage({
        to: this.getToAccount(),
        conversationType: this.data.conversation.type,
        payload: {
          file,
        },
        onProgress: (percent) => {
          message.percent = percent;
        },
      });
      this.$sendTIMMessage(message);
    },

    // 发送视频消息
    handleSendVideoMessage(file) {
      const message = wx.$TUIKit.createVideoMessage({
        to: this.getToAccount(),
        conversationType: this.data.conversation.type,
        payload: {
          file,
        },
        onProgress: (percent) => {
          message.percent = percent;
        },
      });
      this.$sendTIMMessage(message);
    },

    handleShootVideo() {
      this.sendMediaMessage('camera', 'video');
    },

    handleSendVideo() {
      this.sendMediaMessage('album', 'video');
    },

    handleCommonFunctions(e) {
      switch (e.target.dataset.function.key) {
        case '0':
          this.setData({
            displayCommonWords: true,
          });
          break;
        case '1':
          this.setData({
            displayOrderList: true,
          });
          break;
        case '2':
          this.setData({
            displayServiceEvaluation: true,
          });
          break;
        default:
          break;
      }
    },

    handleSendOrder() {
      this.setData({
        displayOrderList: true,
      });
    },

    appendMessage(e) {
      this.setData({
        message: this.data.message + e.detail.message,
        sendMessageBtn: true,
      });
    },

    getToAccount() {
      if (!this.data.conversation || !this.data.conversation.conversationID) {
        return '';
      }
      switch (this.data.conversation.type) {
        case wx.TencentCloudChat.TYPES.CONV_C2C:
          return this.data.conversation.conversationID.replace(wx.TencentCloudChat.TYPES.CONV_C2C, '');
        case wx.TencentCloudChat.TYPES.CONV_GROUP:
          return this.data.conversation.conversationID.replace(wx.TencentCloudChat.TYPES.CONV_GROUP, '');
        default:
          return this.data.conversation.conversationID;
      }
    },
    async handleCheckAuthorize(e) {
      const type = e.currentTarget.dataset.value;
      wx.getSetting({
        success: async (res) => {
          const isRecord = res.authSetting['scope.record'];
          const isCamera = res.authSetting['scope.camera'];
          if (!isRecord && type === 1) {
            const title = '麦克风权限授权';
            const content = '使用语音通话，需要在设置中对麦克风进行授权允许';
            try {
              await wx.authorize({ scope: 'scope.record' });
              this.handleCalling(e);
            } catch (e) {
              this.handleShowModal(title, content);
            }
            return;
          }
          if ((!isRecord || !isCamera) && type === 2) {
            const title = '麦克风、摄像头权限授权';
            const content = '使用视频通话，需要在设置中对麦克风、摄像头进行授权允许';
            try {
              await wx.authorize({ scope: 'scope.record' });
              await wx.authorize({ scope: 'scope.camera' });
              this.handleCalling(e);
            } catch (e) {
              this.handleShowModal(title, content);
            }
            return;
          }
          this.handleCalling(e);
        },
      });
    },

    handleShowModal(title, content) {
      wx.showModal({
        title,
        content,
        confirmText: '去设置',
        success: (res) => {
          if (res.confirm) {
            wx.openSetting();
          }
        },
      });
    },

    handleCalling(e) {
      if (!this.data.hasCallKit) {
        wx.showToast({
          title: '请先集成 TUICallKit 组件',
          icon: 'none',
        });
        return;
      }
      const type = e.currentTarget.dataset.value;
      const conversationType = this.data.conversation.type;
      if (conversationType === wx.TencentCloudChat.TYPES.CONV_GROUP) {
        this.triggerEvent('handleCall', {
          type,
          conversationType,
        });
      }
      if (conversationType === wx.TencentCloudChat.TYPES.CONV_C2C) {
        const { userID } = this.data.conversation.userProfile;
        this.triggerEvent('handleCall', {
          conversationType,
          type,
          userID,
        });
      }
      this.setData({
        displayFlag: '',
      });
    },

    sendTextMessage(msg, flag) {
      const to = this.getToAccount();
      const text = flag ? msg : this.data.message;
      const { FEAT_NATIVE_CODE } = constant;
      const message = wx.$TUIKit.createTextMessage({
        to,
        conversationType: this.data.conversation.type,
        payload: {
          text,
        },
        cloudCustomData: JSON.stringify({ messageFeature:
        {
          needTyping: FEAT_NATIVE_CODE.FEAT_TYPING,
          version: FEAT_NATIVE_CODE.NATIVE_VERSION,
        },
        }),
      });
      this.setData({
        message: '',
        sendMessageBtn: false,
      });
      this.$sendTIMMessage(message);
    },

    // 监听输入框value值变化
    onInputValueChange(event) {
      const query = wx.createSelectorQuery().in(this);
      query.select('#textarea').boundingClientRect();
      query.exec((res) => {
        // 获取 textarea 组件的实际高度
        const { height } = res[0];
        if (this.data.textareaHeight !== height) {
          this.triggerEvent('inputHeightChange', {});
          this.setData({
            textareaHeight: height,
          });
        }
      });
      if (event.detail.message || event.detail.value) {
        this.setData({
          message: event.detail.message || event.detail.value,
          sendMessageBtn: true,
        });
      } else {
        this.setData({
          sendMessageBtn: false,
        });
      }
      event.detail.value && this.sendTypingStatusMessage();
    },

    // 发送正在输入状态消息
    sendTypingStatusMessage() {
      if (this.data.conversation.type === wx.TencentCloudChat.TYPES.CONV_GROUP) {
        return;
      }
      const { BUSINESS_ID_TEXT, FEAT_NATIVE_CODE } = constant;
      // 创建正在输入状态消息, "typingStatus":1,正在输入中1,  输入结束0, "version": 1 兼容老版本,userAction:0, // 14表示正在输入,actionParam:"EIMAMSG_InputStatus_Ing" //"EIMAMSG_InputStatus_Ing" 表示正在输入, "EIMAMSG_InputStatus_End" 表示输入结束
      const typingMessage = wx.$TUIKit.createCustomMessage({
        to: this.getToAccount(),
        conversationType: this.data.conversation.type,
        payload: {
          data: JSON.stringify({
            businessID: BUSINESS_ID_TEXT.USER_TYPING,
            typingStatus: FEAT_NATIVE_CODE.ISTYPING_STATUS,
            version: FEAT_NATIVE_CODE.NATIVE_VERSION,
            userAction: FEAT_NATIVE_CODE.ISTYPING_ACTION,
            actionParam: constant.TYPE_INPUT_STATUS_ING,
          }),
          description: '',
          extension: '',
        },
        cloudCustomData: JSON.stringify({
          messageFeature: {
            needTyping: FEAT_NATIVE_CODE.FEAT_TYPING,
            version: FEAT_NATIVE_CODE.NATIVE_VERSION,
          },
        }),
      });
        // 在消息列表中过滤出对方的消息，并且获取最新消息的时间。
      const inList =  this.data.messageList.filter(item => item.flow === 'in');
      if (inList.length === 0) return;
      const sortList = inList.sort((firstItem, secondItem) => secondItem.time - firstItem.time);
      const newMessageTime = sortList[0].time * 1000;
      // 发送正在输入状态消息的触发条件。
      const isSendTypingMessage = this.data.messageList.every((item) => {
        try {
          const sendTypingMessage = JSON.parse(item.cloudCustomData);
          return sendTypingMessage.messageFeature.needTyping;
        } catch (error) {
          return false;
        }
      });
        // 获取当前编辑时间，与收到对方最新的一条消息时间相比，时间小于30s则发送正在输入状态消息/
      const now = new Date().getTime();
      const timeDifference =  (now  - newMessageTime);

      if (isSendTypingMessage && timeDifference > (1000 * 30)) return;
      if (this.data.isFirstSendTyping) {
        this.$sendTypingMessage(typingMessage);
        this.setData({
          isFirstSendTyping: false,
        });
      } else {
        this.data.time = setTimeout(() => {
          this.$sendTypingMessage(typingMessage);
        }, (1000 * 4));
      }
    },

    // 监听是否获取焦点，有焦点则向父级传值，动态改变input组件的高度。
    inputBindFocus(event) {
      const wasEmojiVisible = this.data.displayFlag === 'emoji';
      const inputEvent = event;
      // 兼容(webview 渲染模式正常) skyline 渲染模式下，键盘高度失效，event.detail.height = 0;
      inputEvent.detail.height = inputEvent.detail.height > 0 ? inputEvent.detail.height : 350;
      this.setData({
        focus: true,
      });
      this.getMessageList(this.data.conversation);
      
      // 有焦点则关闭除键盘之外的操作界面，例如表情组件。
      this.handleClose();
      
      // 如果刚才表情弹窗是显示的，则先收起表情弹窗的布局调整，再应用键盘的布局调整
      if (wasEmojiVisible) {
        this.triggerEvent('downKeysBoards', {});
        setTimeout(() => {
          this.triggerEvent('pullKeysBoards', {
            event: inputEvent,
          });
        }, 200);
      } else {
        this.triggerEvent('pullKeysBoards', {
          event: inputEvent,
        });
      }
    },

    // 监听是否失去焦点
    inputBindBlur(event) {
      const { BUSINESS_ID_TEXT, FEAT_NATIVE_CODE } = constant;
      const typingMessage = wx.$TUIKit.createCustomMessage({
        to: this.getToAccount(),
        conversationType: this.data.conversation.type,
        payload: {
          data: JSON.stringify({
            businessID: BUSINESS_ID_TEXT.USER_TYPING,
            typingStatus: FEAT_NATIVE_CODE.NOTTYPING_STATUS,
            version: FEAT_NATIVE_CODE.NATIVE_VERSION,
            userAction: FEAT_NATIVE_CODE.NOTTYPING_ACTION,
            actionParam: constant.TYPE_INPUT_STATUS_END,
          }),
          cloudCustomData: JSON.stringify({ messageFeature:
              {
                needTyping: FEAT_NATIVE_CODE.FEAT_TYPING,
                version: FEAT_NATIVE_CODE.NATIVE_VERSION,
              },
          }),
          description: '',
          extension: '',
        },
      });
      this.$sendTypingMessage(typingMessage);
      this.setData({
        isFirstSendTyping: true,
      });
      clearTimeout(this.data.time);
      this.triggerEvent('downKeysBoards', {
        event,
      });
    },

    $handleSendTextMessage(event) {
      this.sendTextMessage(event.detail.message, true);
      this.setData({
        displayCommonWords: false,
      });
    },

    $handleSendCustomMessage(e) {
      const message = wx.$TUIKit.createCustomMessage({
        to: this.getToAccount(),
        conversationType: this.data.conversation.type,
        payload: e.detail.payload,
      });
      this.$sendTIMMessage(message);
      this.setData({
        displayOrderList: false,
        displayCommonWords: false,
      });
    },

    $handleCloseCards(e) {
      switch (e.detail.key) {
        case '0':
          this.setData({
            displayCommonWords: false,
          });
          break;
        case '1':
          this.setData({
            displayOrderList: false,
          });
          break;
        case '2':
          this.setData({
            displayServiceEvaluation: false,
          });
          break;
        default:
          break;
      }
    },
    // 发送正在输入消息
    $sendTypingMessage(message) {
      if (this.data.conversation.type === wx.TencentCloudChat.TYPES.CONV_GROUP) {
        return;
      }
      wx.$TUIKit.sendMessage(message, {
        onlineUserOnly: true,
      });
    },

    $sendTIMMessage(message) {
      this.triggerEvent('sendMessage', {
        message,
      });
      wx.$TUIKit.sendMessage(message, {
        offlinePushInfo: {
          disablePush: true,
        },
      }).then((res) => {
        this.triggerEvent('sendMessage', {
          message: res.data.message,
        });
      }).catch((error) => {
        logger.log(`| TUI-chat | message-input | sendMessageError: ${error.code} `);
        this.triggerEvent('showMessageErrorImage', {
          showErrorImageFlag: error.code,
          message,
        });
      });
      this.setData({
        displayFlag: '',
      });
    },

    handleClose() {
      this.setData({
        displayFlag: '',
        focus: true,
      });
    },

    handleServiceEvaluation() {
      this.setData({
        displayServiceEvaluation: true,
      });
    },

    // 处理输入框点击事件，关闭表情弹窗并让输入框获得焦点
    handleInputClick() {
      const wasEmojiVisible = this.data.displayFlag === 'emoji';
      // 关闭表情弹窗并设置focus为true
      this.setData({
        displayFlag: '',
        focus: true,
      }, () => {
        if (wasEmojiVisible) {
          // 如果刚才表情弹窗是显示的，则像键盘收起一样调整布局
          this.triggerEvent('downKeysBoards', {});
        }
        // 立即让输入框获得焦点
        setTimeout(() => {
          const query = wx.createSelectorQuery().in(this);
          query.select('#textarea').focus();
          query.exec();
        }, 100);
      });
    },

    // 处理表情区域点击事件，阻止事件冒泡
    handleEmojiAreaClick() {
      // 什么都不做，只是为了阻止事件冒泡
    },
  },
});
