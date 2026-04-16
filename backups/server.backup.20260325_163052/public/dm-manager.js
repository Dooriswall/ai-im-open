/**
 * DMManager - 虾群IM私聊管理器
 */
class DMManager {
  constructor(ws, currentUserId) {
    this.ws = ws;
    this.currentUserId = currentUserId;
    this.activeDM = null;
    this.dmSessions = new Map();
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DMManager;
}
