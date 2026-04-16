const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, 'public')));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const MAX_FILE_SIZE = 16 * 1024 * 1024; // 16MB

const ALLOWED_EXTENSIONS = new Set([
  'py', 'js', 'ts', 'jsx', 'tsx', 'java', 'cpp', 'cc', 'cxx', 'c', 'h', 'hpp',
  'cs', 'go', 'rs', 'php', 'rb', 'swift', 'kt', 'kts', 'scala', 'sh', 'bash',
  'sql', 'html', 'css', 'scss', 'less', 'vue',
  'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'md',
  'pdf', 'doc', 'docx', 'txt',
  'zip', 'rar', '7z'
]);

function getFileExt(filename = '') {
  const idx = filename.lastIndexOf('.');
  if (idx < 0) return '';
  return filename.slice(idx + 1).toLowerCase();
}

function isAllowedFile(filename) {
  return ALLOWED_EXTENSIONS.has(getFileExt(filename));
}

function getBaseUrl(req = null) {
  if (config.publicBaseUrl) return config.publicBaseUrl.replace(/\/$/, '');
  if (req) {
    const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
    return `${proto}://${req.headers.host}`;
  }
  return `http://127.0.0.1:${config.port}`;
}

function canAccessChannel(userId, channel) {
  if (!channel) return false;

  if (channel.startsWith('dm:')) {
    const parts = channel.split(':');
    if (parts.length < 3) return false;
    return parts[1] === userId || parts[2] === userId;
  }

  const ch = db.getChannelByName(channel);
  if (!ch) return false;

  if (Number(ch.is_private) === 0) return true;

  if (ch.created_by === userId) return true;

  const user = db.getUserByUsername(userId);
  if (user && user.role === 'boss') return true;

  return db.isChannelMember(channel, userId);
}

const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function(req, file, cb) {
    const safeName = file.originalname.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
    cb(null, `${Date.now()}-${uuidv4()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!isAllowedFile(file.originalname)) {
      return cb(new Error('FILE_TYPE_OR_SIZE_LIMIT'));
    }
    cb(null, true);
  }
});

db.init().then(() => {
  console.log('📦 Database initialized');

  if (config.seedUsers !== false) {
    const seedResult = db.seedUsers();
    if (seedResult.seeded) {
      console.log(`🌱 Seeded ${seedResult.count} users from config`);
    } else {
      console.log(`📝 ${seedResult.message}`);
    }
  }

  const lorenzoUser = db.getUserByUsername('lorenzo');
  if (lorenzoUser) {
    console.log(`🗑️  Deleting test account lorenzo (${lorenzoUser.display_name})`);
    const result = db.deleteUser('lorenzo');
    console.log(`✅ ${result.deleted ? 'Deleted' : 'Failed to delete'} lorenzo`);
  }
}).catch(err => {
  console.error('❌ Database init failed:', err);
  process.exit(1);
});

// ========== 认证 ==========

function authenticateToken(token) {
  const user = db.getUserByToken(token);
  return user ? user.username : null;
}

function getUserInfoFromDb(username) {
  const user = db.getUserByUsername(username);
  if (!user) return null;

  return {
    name: user.display_name,
    emoji: user.emoji,
    role: user.role,
    engine: user.engine,
    location: user.location,
    avatar_url: user.avatar_url
  };
}

function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
  const userId = authenticateToken(token);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  req.userId = userId;
  req.userInfo = getUserInfoFromDb(userId);
  next();
}

// ========== 在线状态 ==========

const onlineClients = new Map();

function getAllMembersFromDb() {
  const users = db.getAllUsers();
  const members = {};
  users.forEach(user => {
    members[user.username] = {
      name: user.display_name,
      emoji: user.emoji,
      role: user.role,
      engine: user.engine,
      location: user.location,
      avatar_url: user.avatar_url
    };
  });
  return members;
}

function broadcastOnlineList() {
  const online = {};
  for (const [userId, sockets] of onlineClients) {
    if (sockets.size > 0) {
      const userInfo = getUserInfoFromDb(userId);
      if (userInfo) {
        online[userId] = { ...userInfo, connections: sockets.size };
      }
    }
  }
  broadcast({ type: 'online', data: online });
}

function broadcast(msg, excludeWs = null) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client !== excludeWs && client.readyState === 1) {
      client.send(data);
    }
  });
}

function sendToUsers(userIds, msg, excludeWs = null) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client !== excludeWs && client.readyState === 1 && userIds.includes(client.userId)) {
      client.send(data);
    }
  });
}

// ========== WebSocket ==========

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  const userId = authenticateToken(token);

  if (!userId) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  const userInfo = getUserInfoFromDb(userId);
  if (!userInfo) {
    ws.close(4002, 'User not found in database');
    return;
  }

  ws.userId = userId;
  ws.userInfo = userInfo;
  ws.isAlive = true;

  if (!onlineClients.has(userId)) onlineClients.set(userId, new Set());
  onlineClients.get(userId).add(ws);

  console.log(`[+] ${userInfo.name} (${userId}) connected`);

  ws.send(JSON.stringify({
    type: 'welcome',
    data: {
      userId,
      userInfo,
      members: getAllMembersFromDb(),
      history: db.getHistory('general', userId === 'boss' ? 99999 : config.historyLimit),
    }
  }));

  broadcastOnlineList();

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleWsMessage(ws, userId, msg);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', data: 'Invalid JSON' }));
    }
  });

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('close', () => {
    console.log(`[-] ${ws.userInfo?.name || userId} (${userId}) disconnected`);
    onlineClients.get(userId)?.delete(ws);
    if (onlineClients.get(userId)?.size === 0) onlineClients.delete(userId);
    broadcastOnlineList();
  });
});

function buildOutMessage(savedId, uid, userId, channel, content, messageType, metadata) {
  return {
    type: 'chat',
    data: {
      id: savedId,
      uid,
      sender: userId,
      senderInfo: getUserInfoFromDb(userId),
      channel,
      content,
      type: messageType,
      metadata: metadata || null,
      created_at: new Date().toISOString(),
    }
  };
}

function handleWsMessage(ws, userId, msg) {
  switch (msg.type) {
    case 'chat': {
      const uid = uuidv4();
      const channel = msg.channel || 'general';
      const content = (msg.content || '').trim();
      const messageType = msg.messageType || 'text';
      const metadata = msg.metadata || null;

      if (!content) return;
      if (content.length > 10000) {
        ws.send(JSON.stringify({ type: 'error', data: 'Message too long (max 10000 chars)' }));
        return;
      }

      if (!canAccessChannel(userId, channel)) {
        ws.send(JSON.stringify({ type: 'error', data: 'No permission for this channel' }));
        return;
      }

      const saved = db.saveMessage({
        uid,
        sender: userId,
        channel,
        content,
        type: messageType,
        metadata,
      });

      const outMsg = buildOutMessage(saved.lastInsertRowid, uid, userId, channel, content, messageType, metadata);

      if (channel.startsWith('dm:')) {
        const parts = channel.split(':');
        if (parts.length >= 3) {
          const user1 = parts[1];
          const user2 = parts[2];

          const conversation = db.createDM(user1, user2);
          if (conversation && conversation.id) {
            db.updateDMTime(conversation.id);
          }

          sendToUsers([user1, user2], outMsg);
        } else {
          broadcast(outMsg);
        }
      } else {
        broadcast(outMsg);
      }

      dispatchWebhooks(outMsg, channel);
      break;
    }

    case 'typing': {
      broadcast({
        type: 'typing',
        data: { userId, userInfo: getUserInfoFromDb(userId) }
      }, ws);
      break;
    }

    case 'ping': {
      ws.send(JSON.stringify({ type: 'pong', data: Date.now() }));
      break;
    }

    case 'send_message': {
      const targetUserId = msg.to;
      const content = (msg.content || '').trim();
      const messageType = msg.messageType || 'text';
      const metadata = msg.metadata || null;

      if (!targetUserId || !content) {
        ws.send(JSON.stringify({ type: 'error', data: 'to and content are required for send_message' }));
        return;
      }

      if (content.length > 10000) {
        ws.send(JSON.stringify({ type: 'error', data: 'Message too long (max 10000 chars)' }));
        return;
      }

      const targetUser = db.getUserByUsername(targetUserId);
      if (!targetUser) {
        ws.send(JSON.stringify({ type: 'error', data: 'Target user not found' }));
        return;
      }

      if (targetUserId === userId) {
        ws.send(JSON.stringify({ type: 'error', data: 'Cannot send message to yourself' }));
        return;
      }

      const uid = uuidv4();
      const participants = [userId, targetUserId].sort();
      const channel = `dm:${participants[0]}:${participants[1]}`;

      const saved = db.saveMessage({
        uid,
        sender: userId,
        channel,
        content,
        type: messageType,
        metadata,
      });

      const conversation = db.createDM(userId, targetUserId);
      if (conversation && conversation.id) {
        db.updateDMTime(conversation.id);
      }

      const outMsg = buildOutMessage(saved.lastInsertRowid, uid, userId, channel, content, messageType, metadata);

      sendToUsers([userId, targetUserId], outMsg);
      dispatchWebhooks(outMsg, channel);
      break;
    }
  }
}

// ========== Webhook推送 ==========

async function dispatchWebhooks(chatMsg, channel) {
  const sender = chatMsg.data.sender;
  let targetUsers = Object.keys(config.webhooks);

  if (channel && channel.startsWith('dm:')) {
    const parts = channel.split(':');
    if (parts.length >= 3) {
      const user1 = parts[1];
      const user2 = parts[2];
      targetUsers = targetUsers.filter(userId =>
        (userId === user1 || userId === user2) && userId !== sender
      );
    }
  }

  for (const userId of targetUsers) {
    const hook = config.webhooks[userId];
    if (!hook || !hook.url) continue;
    if (hook.excludeSelf && userId === sender) continue;

    try {
      const messageForWebhook = JSON.parse(JSON.stringify(chatMsg.data));

      // 关键新增：附件消息带绝对下载地址
      if (
        messageForWebhook &&
        messageForWebhook.type === 'file' &&
        messageForWebhook.metadata &&
        messageForWebhook.metadata.downloadUrl
      ) {
        const baseUrl = getBaseUrl();
        messageForWebhook.metadata.downloadUrlAbsolute =
          baseUrl + messageForWebhook.metadata.downloadUrl;
      }

      const payload = JSON.stringify({
        type: 'new_message',
        message: messageForWebhook,
        timestamp: Date.now(),
      });

      const headers = {
        'Content-Type': 'application/json',
      };
      if (hook.secret) {
        headers['X-Webhook-Secret'] = hook.secret;
      }

      const url = new URL(hook.url);
      const lib = url.protocol === 'https:' ? require('https') : require('http');

      const req = lib.request(url, {
        method: 'POST',
        headers,
        timeout: 10000,
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          console.log(`[webhook] -> ${userId} (${res.statusCode})`);
        });
      });

      req.on('error', (err) => {
        console.error(`[webhook] -> ${userId} FAILED: ${err.message}`);
      });

      req.write(payload);
      req.end();
    } catch (err) {
      console.error(`[webhook] -> ${userId} ERROR: ${err.message}`);
    }
  }
}

setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, config.heartbeatInterval);

// ========== HTTP API ==========

// 上传附件
app.post('/api/upload', authMiddleware, (req, res) => {
  upload.single('file')(req, res, function(err) {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE' || err.message === 'FILE_TYPE_OR_SIZE_LIMIT') {
        return res.status(400).json({ error: '文件类型/大小超限' });
      }
      console.error('Upload error:', err);
      return res.status(500).json({ error: '上传失败' });
    }

    if (!req.file) {
      return res.status(400).json({ error: '文件类型/大小超限' });
    }

    const ext = getFileExt(req.file.originalname);
    const fileId = uuidv4();
    const channel = req.body.channel || 'general';

    if (!canAccessChannel(req.userId, channel)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(403).json({ error: '无权限上传到该会话/频道' });
    }

    db.createFileRecord({
      id: fileId,
      originalName: req.file.originalname,
      storedName: req.file.filename,
      ext,
      mime: req.file.mimetype,
      size: req.file.size,
      uploader: req.userId,
      channel,
    });

    const downloadUrl = `/api/files/${fileId}/download`;

    res.json({
      ok: true,
      file: {
        fileId,
        originalName: req.file.originalname,
        ext,
        size: req.file.size,
        mime: req.file.mimetype,
        downloadUrl,
        downloadUrlAbsolute: getBaseUrl(req) + downloadUrl,
      }
    });
  });
});

// 鉴权下载附件
app.get('/api/files/:fileId/download', authMiddleware, (req, res) => {
  const { fileId } = req.params;
  const file = db.getFileById(fileId);
  if (!file) return res.status(404).send('File not found');

  if (!canAccessChannel(req.userId, file.channel)) {
    return res.status(403).send('Forbidden');
  }

  const fullPath = path.join(uploadsDir, file.stored_name);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).send('File missing');
  }

  res.download(fullPath, file.original_name);
});

// 发消息
app.post('/api/messages', authMiddleware, (req, res) => {
  const { content, channel = 'general', messageType = 'text', metadata = null } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
  if (content.length > 10000) return res.status(400).json({ error: 'Message too long' });

  if (!canAccessChannel(req.userId, channel)) {
    return res.status(403).json({ error: 'No permission for this channel' });
  }

  const uid = uuidv4();
  const saved = db.saveMessage({
    uid,
    sender: req.userId,
    channel,
    content: content.trim(),
    type: messageType,
    metadata,
  });

  const outMsg = buildOutMessage(saved.lastInsertRowid, uid, req.userId, channel, content.trim(), messageType, metadata);

  if (channel.startsWith('dm:')) {
    const parts = channel.split(':');
    if (parts.length >= 3) {
      const user1 = parts[1];
      const user2 = parts[2];
      const conversation = db.createDM(user1, user2);
      if (conversation && conversation.id) db.updateDMTime(conversation.id);
      sendToUsers([user1, user2], outMsg);
    } else {
      broadcast(outMsg);
    }
  } else {
    broadcast(outMsg);
  }

  dispatchWebhooks(outMsg, channel);
  res.json({ ok: true, message: outMsg.data });
});

// 获取历史消息
app.get('/api/messages', authMiddleware, (req, res) => {
  const channel = req.query.channel || 'general';
  const maxLimit = req.userId === 'boss' ? 99999 : 500;
  const limit = Math.min(parseInt(req.query.limit) || 100, maxLimit);

  if (req.userId === 'boss' && channel === 'all') {
    return res.json({ ok: true, messages: db.getAllHistory(limit), isAll: true });
  }

  if (!canAccessChannel(req.userId, channel)) {
    return res.status(403).json({ error: 'No permission for this channel' });
  }

  res.json({ ok: true, messages: db.getHistory(channel, limit) });
});

// 获取新消息
app.get('/api/messages/since/:lastId', authMiddleware, (req, res) => {
  const channel = req.query.channel || 'general';
  const lastId = parseInt(req.params.lastId) || 0;

  if (!canAccessChannel(req.userId, channel)) {
    return res.status(403).json({ error: 'No permission for this channel' });
  }

  res.json({ ok: true, messages: db.getMessagesSince(channel, lastId) });
});

// 成员列表
app.get('/api/members', authMiddleware, (req, res) => {
  const online = {};
  for (const [userId, sockets] of onlineClients) {
    if (sockets.size > 0) online[userId] = true;
  }
  const users = db.getAllUsers();
  const members = users.map(user => ({
    id: user.username,
    name: user.display_name,
    emoji: user.emoji,
    role: user.role,
    engine: user.engine,
    location: user.location,
    avatar_url: user.avatar_url,
    online: !!online[user.username],
    created_at: user.created_at,
    last_seen: user.last_seen,
  }));
  res.json({ ok: true, members });
});

// 注册/更新Webhook
app.post('/api/webhook', authMiddleware, (req, res) => {
  const { url, secret } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  config.webhooks[req.userId] = {
    url,
    secret: secret || '',
    excludeSelf: true,
  };

  console.log(`[webhook] Registered for ${req.userId}: ${url}`);
  res.json({ ok: true, userId: req.userId, url });
});

// 查看Webhook状态
app.get('/api/webhook', authMiddleware, (req, res) => {
  const hook = config.webhooks[req.userId];
  res.json({ ok: true, webhook: hook || null });
});

// 删除Webhook
app.delete('/api/webhook', authMiddleware, (req, res) => {
  if (config.webhooks[req.userId]) {
    config.webhooks[req.userId].url = '';
  }
  res.json({ ok: true });
});

// 创建频道
app.post('/api/channels', authMiddleware, (req, res) => {
  const { name, description = '' } = req.body;
  const isPrivateValue = typeof req.body.is_private !== 'undefined' ? req.body.is_private : req.body.isPrivate;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Channel name is required' });
  }

  if (!/^[a-zA-Z0-9_-]{3,30}$/.test(name)) {
    return res.status(400).json({ error: 'Channel name must be 3-30 chars, alphanumeric, underscore, or hyphen' });
  }

  const existingChannel = db.getChannelByName(name);
  if (existingChannel) {
    return res.status(409).json({ error: 'Channel already exists' });
  }

  try {
    const channel = db.createChannel({
      name,
      description: description.trim(),
      created_by: req.userId,
      is_private: isPrivateValue ? 1 : 0,
    });

    res.json({ ok: true, channel });
  } catch (error) {
    console.error('Channel creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 获取频道列表
app.get('/api/channels', authMiddleware, (req, res) => {
  const channels = db.getChannels();
  const user = db.getUserByUsername(req.userId);

  const filtered = channels.filter(channel => {
    if (channel.is_private === 0) return true;
    if (channel.created_by === req.userId) return true;
    if (user && user.role === 'boss') return true;
    return db.isChannelMember(channel.name, req.userId);
  });

  res.json({ ok: true, channels: filtered });
});

// 删除频道
app.delete('/api/channels/:name', authMiddleware, (req, res) => {
  const { name } = req.params;
  const channel = db.getChannelByName(name);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  if (name === 'general') {
    return res.status(403).json({ error: 'Cannot delete the general channel' });
  }

  const result = db.deleteChannel(name, req.userId);
  if (!result.deleted) {
    return res.status(result.error === 'Permission denied' ? 403 : 404).json({ error: result.error || 'Failed to delete channel' });
  }
  res.json({ ok: true, result });
});

// 私聊列表
app.get('/api/dm', authMiddleware, (req, res) => {
  try {
    const dmList = db.getDMList(req.userId);
    res.json({ ok: true, conversations: dmList });
  } catch (error) {
    console.error('Get DM list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 创建或打开私聊
app.post('/api/dm', authMiddleware, (req, res) => {
  const { targetUserId } = req.body;

  if (!targetUserId || targetUserId.trim() === '') {
    return res.status(400).json({ error: 'targetUserId is required' });
  }

  const targetUser = db.getUserByUsername(targetUserId);
  if (!targetUser) {
    return res.status(404).json({ error: 'Target user not found' });
  }

  if (targetUserId === req.userId) {
    return res.status(400).json({ error: 'Cannot start DM with yourself' });
  }

  try {
    const conversation = db.createDM(req.userId, targetUserId);

    res.json({
      ok: true,
      conversation: {
        ...conversation,
        partner: {
          id: targetUser.id,
          username: targetUser.username,
          displayName: targetUser.display_name,
          emoji: targetUser.emoji,
          role: targetUser.role,
          engine: targetUser.engine,
          location: targetUser.location,
        }
      }
    });
  } catch (error) {
    console.error('Create DM error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 注册
app.post('/api/register', (req, res) => {
  const { username, displayName, emoji = '👤' } = req.body;

  if (!username || !displayName) {
    return res.status(400).json({ error: 'username and displayName are required' });
  }

  if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
    return res.status(400).json({ error: 'username must be 3-30 chars, alphanumeric, underscore, or hyphen' });
  }

  const existingUser = db.getUserByUsername(username);
  if (existingUser) {
    return res.status(409).json({ error: 'username already exists' });
  }

  try {
    const user = db.createUser({
      username,
      displayName,
      emoji,
      role: 'human',
    });

    res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        token: user.token,
        emoji: user.emoji,
        role: user.role,
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 搜索消息
app.get('/api/messages/search', authMiddleware, (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) return res.status(400).json({ error: 'Search query (q) is required' });
  const channel = req.query.channel || null;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  try {
    if (channel && !canAccessChannel(req.userId, channel)) {
      return res.status(403).json({ error: 'No permission for this channel' });
    }
    const messages = db.searchMessages(query, channel, limit);
    res.json({ ok: true, query, messages });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// 获取频道成员
app.get('/api/channels/:name/members', authMiddleware, (req, res) => {
  const { name } = req.params;
  const channel = db.getChannelByName(name);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  if (!canAccessChannel(req.userId, name)) {
    return res.status(403).json({ error: 'Permission denied' });
  }

  const members = db.getChannelMembers(name);
  res.json({ ok: true, channel: name, members });
});

// 添加频道成员
app.post('/api/channels/:name/members', authMiddleware, (req, res) => {
  const { name } = req.params;
  const { username } = req.body;

  if (!username) return res.status(400).json({ error: 'username is required' });

  const channel = db.getChannelByName(name);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  const user = db.getUserByUsername(req.userId);
  if (channel.created_by !== req.userId && (!user || user.role !== 'boss')) {
    return res.status(403).json({ error: 'Permission denied' });
  }

  const targetUser = db.getUserByUsername(username);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  const result = db.addChannelMember(name, username, req.userId);
  res.json({ ok: true, ...result });
});

// 移除频道成员
app.delete('/api/channels/:name/members/:username', authMiddleware, (req, res) => {
  const { name, username } = req.params;

  const channel = db.getChannelByName(name);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  const user = db.getUserByUsername(req.userId);
  if (channel.created_by !== req.userId && (!user || user.role !== 'boss')) {
    return res.status(403).json({ error: 'Permission denied' });
  }

  const result = db.removeChannelMember(name, username);
  res.json({ ok: true, ...result });
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: '虾群IM', version: '0.1.0', uptime: process.uptime() });
});

// 启动
server.listen(config.port, '0.0.0.0', () => {
  console.log(`
🦐 虾群IM 服务器启动!
📡 端口: ${config.port}
🌐 Web UI: http://0.0.0.0:${config.port}
📊 API: http://0.0.0.0:${config.port}/api/health
  `);
});