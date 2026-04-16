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
      return null;
    }

    const participants = [this.currentUserId, targetUserId].sort();
    const channel = `dm:${participants[0]}:${participants[1]}`;

    this.activeDM = { userId: targetUserId, channel };

    if (!this.dmSessions.has(targetUserId)) {
      this.dmSessions.set(targetUserId, {
        channel,
        unreadCount: 0,
        lastOpened: Date.now(),
        lastActivity: Date.now()
      });
    } else {
      const session = this.dmSessions.get(targetUserId);
      session.unreadCount = 0;
      session.lastOpened = Date.now();
      session.lastActivity = Date.now();
    }

    return channel;
  }

  sendDM(targetUserId, content, metadata = null, messageType = 'text') {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    if (!targetUserId || !content || content.trim() === '') return false;

    if (!this.dmSessions.has(targetUserId)) {
      this.openDM(targetUserId);
    }

    try {
      this.ws.send(JSON.stringify({
        type: 'send_message',
        to: targetUserId,
        content: content.trim(),
        metadata,
        messageType
      }));

      const session = this.dmSessions.get(targetUserId);
      if (session) session.lastActivity = Date.now();
      return true;
    } catch (error) {
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

    const sender = message.data.sender;
    const otherUserId = sender === this.currentUserId
      ? (parts[1] === this.currentUserId ? parts[2] : parts[1])
      : sender;

    if (this.activeDM && this.activeDM.userId === otherUserId) {
      const session = this.dmSessions.get(otherUserId);
      if (session) {
        session.unreadCount = 0;
        session.lastActivity = Date.now();
      } else {
        this.dmSessions.set(otherUserId, {
          channel,
          unreadCount: 0,
          lastOpened: Date.now(),
          lastActivity: Date.now()
        });
      }
      return true;
    }

    const session = this.dmSessions.get(otherUserId);
    if (session) {
      session.unreadCount = (session.unreadCount || 0) + 1;
      session.lastActivity = Date.now();
    } else {
      this.dmSessions.set(otherUserId, {
        channel,
        unreadCount: 1,
        lastOpened: 0,
        lastActivity: Date.now()
      });
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