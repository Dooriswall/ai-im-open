/**
 * DMManager - 虾群IM私聊管理器
 */
class DMManager {
  constructor(ws, currentUserId) {
    this.ws = ws;
    this.currentUserId = currentUserId;
    this.activeDM = null;
    this.dmSessions = new Map();
    // 内存中的消息缓存（按channel存储）
    this.messageCache = new Map();
  }

  openDM(targetUserId) {
    if (!targetUserId || targetUserId === this.currentUserId) {
      console.error('无效的目标用户ID');
      return null;
    }

    const participants = [this.currentUserId, targetUserId].sort();
    const channel = `dm:${participants[0]}:${participants[1]}`;

    this.activeDM = { userId: targetUserId, channel };

    if (!this.dmSessions.has(targetUserId)) {
      this.dmSessions.set(targetUserId, {
        channel,
        lastOpened: Date.now(),
        unreadCount: 0
      });
    } else {
      this.dmSessions.get(targetUserId).unreadCount = 0;
      this.dmSessions.get(targetUserId).lastOpened = Date.now();
    }

    console.log(`打开私聊会话: ${this.currentUserId} ↔ ${targetUserId}, 频道: ${channel}`);
    return channel;
  }

  /**
   * 加载私聊历史消息
   * @param {string} targetUserId - 目标用户ID
   * @returns {Promise<{messages: Array}>}
   */
  async loadDMHistory(targetUserId) {
    if (!targetUserId) {
      console.error('loadDMHistory: 目标用户ID不能为空');
      return { messages: [] };
    }

    const participants = [this.currentUserId, targetUserId].sort();
    const channel = `dm:${participants[0]}:${participants[1]}`;

    try {
      // 从服务器获取私聊历史
      const token = localStorage.getItem('shrimp-token');
      if (!token) {
        console.error('loadDMHistory: 未登录');
        return { messages: [] };
      }

      const response = await fetch(`/api/messages?channel=${encodeURIComponent(channel)}&limit=100`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        console.error('loadDMHistory: 获取历史失败', response.status);
        return { messages: [] };
      }

      const data = await response.json();
      if (data.ok && data.messages) {
        console.log(`从服务器加载私聊历史: ${channel}, ${data.messages.length}条消息`);
        // 更新缓存
        this.messageCache.set(channel, data.messages);
        return { messages: data.messages };
      }
    } catch (error) {
      console.error('loadDMHistory: 请求失败', error);
    }

    // 兜底：从本地缓存获取 (禁用本地缓存，强制从服务器获取)
    // if (this.messageCache.has(channel)) {
    //   console.log(`从缓存加载私聊历史: ${channel}`);
    //   return { messages: this.messageCache.get(channel) };
    // }

    // 兜底：返回空数组
    console.log(`暂无私聊历史: ${channel}`);
    return { messages: [] };
  }

  /**
   * 缓存私聊消息
   * @param {string} channel - 频道ID
   * @param {Object} message - 消息对象
   */
  cacheMessage(channel, message) {
    if (!this.messageCache.has(channel)) {
      this.messageCache.set(channel, []);
    }
    this.messageCache.get(channel).push(message);
    // 限制缓存数量，防止内存无限增长
    const maxCacheSize = 100;
    const messages = this.messageCache.get(channel);
    if (messages.length > maxCacheSize) {
      this.messageCache.set(channel, messages.slice(-maxCacheSize));
    }
  }

  sendDM(targetUserId, content) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket连接未就绪');
      return false;
    }
    if (!targetUserId || !content || content.trim() === '') {
      console.error('目标用户ID和消息内容不能为空');
      return false;
    }

    if (!this.dmSessions.has(targetUserId)) {
      this.openDM(targetUserId);
    }

    const message = {
      type: 'send_message',
      to: targetUserId,
      content: content.trim()
    };

    try {
      this.ws.send(JSON.stringify(message));
      const session = this.dmSessions.get(targetUserId);
      if (session) session.lastActivity = Date.now();
      
      // 缓存自己发送的消息
      const participants = [this.currentUserId, targetUserId].sort();
      const channel = `dm:${participants[0]}:${participants[1]}`;
      this.cacheMessage(channel, {
        id: Date.now(),
        sender: this.currentUserId,
        content: content.trim(),
        channel: channel,
        timestamp: new Date().toISOString()
      });
      
      return true;
    } catch (error) {
      console.error('发送私聊消息失败:', error);
      return false;
    }
  }

  getDMChannel(targetUserId) {
    if (!targetUserId) return null;
    if (this.dmSessions.has(targetUserId)) {
      return this.dmSessions.get(targetUserId).channel;
    }
    const participants = [this.currentUserId, targetUserId].sort();
    return `dm:${participants[0]}:${participants[1]}`;
  }

  handleIncomingMessage(message) {
    if (message.type !== 'chat' || !message.data || !message.data.channel) return false;
    const channel = message.data.channel;
    if (!channel.startsWith('dm:')) return false;

    // 缓存收到的消息
    this.cacheMessage(channel, message.data);

    const parts = channel.split(':');
    if (parts.length < 3) return false;

    const user1 = parts[1];
    const user2 = parts[2];
    const sender = message.data.sender;
    const otherUserId = sender === this.currentUserId
      ? (user1 === this.currentUserId ? user2 : user1)
      : sender;

    if (!this.activeDM || this.activeDM.userId !== otherUserId) {
      const session = this.dmSessions.get(otherUserId);
      if (session) {
        session.unreadCount = (session.unreadCount || 0) + 1;
        session.lastActivity = Date.now();
      } else {
        this.dmSessions.set(otherUserId, {
          channel,
          lastActivity: Date.now(),
          unreadCount: 1
        });
      }
    }
    return true;
  }

  getUnreadCount(targetUserId) {
    const session = this.dmSessions.get(targetUserId);
    return session ? (session.unreadCount || 0) : 0;
  }

  clearUnreadCount(targetUserId) {
    const session = this.dmSessions.get(targetUserId);
    if (session) session.unreadCount = 0;
  }

  closeDM(targetUserId) {
    if (this.dmSessions.has(targetUserId)) {
      this.dmSessions.delete(targetUserId);
      if (this.activeDM?.userId === targetUserId) this.activeDM = null;
    }
  }
}

// 导出到全局
window.DMManager = DMManager;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DMManager;
}
window.DMManager = DMManager;
