const express = require('express');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const db = require('./db');

const VALID_MESSAGE_TYPES = ['text', 'file', 'voice'];


// Rate limiting for health endpoint
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 60 seconds
const RATE_LIMIT_MAX = 30;

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    entry = { count: 1, windowStart: now };
    rateLimitMap.set(ip, entry);
    return true;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return false;
  return true;
}

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW * 2) rateLimitMap.delete(ip);
  }
}, 300000);

const app = express();

// HTTP server (redirect to HTTPS)
const httpServer = http.createServer(app);

// HTTPS server
let httpsServer = null;
try {
  const sslCertPath = config.sslCertPath || '/etc/letsencrypt/live/im.essatheteng.com/fullchain.pem';
  const sslKeyPath = config.sslKeyPath || '/etc/letsencrypt/live/im.essatheteng.com/privkey.pem';
  const sslCert = fs.readFileSync(sslCertPath);
  const sslKey = fs.readFileSync(sslKeyPath);
  httpsServer = https.createServer({ cert: sslCert, key: sslKey }, app);
  console.log('SSL certificates loaded');
} catch (e) {
  console.warn('SSL certificates not found, HTTPS not available:', e.message);
}

const wss = new WebSocketServer({ server: httpsServer || httpServer });

// HTTP -> HTTPS redirect
app.use((req, res, next) => {
  // 检查是否是WebSocket升级请求
  const isWebSocketUpgrade = req.headers.upgrade === 'websocket' && 
                            req.headers.connection && 
                            req.headers.connection.toLowerCase().includes('upgrade');
  
  // 调试日志
  if (isWebSocketUpgrade) {
    console.log(`[DEBUG] WebSocket upgrade detected: ${req.url}, upgrade: ${req.headers.upgrade}, connection: ${req.headers.connection}`);
  }
  
  if (req.secure || req.headers['x-forwarded-proto'] === 'https' || isWebSocketUpgrade) {
    return next();
  }
  res.redirect(301, 'https://im.essatheteng.com:8443' + req.url);
});

app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); next(); });
app.use(express.json());
// 静态文件服务，跳过WebSocket升级请求
app.use((req, res, next) => {
  const isWebSocketUpgrade = req.headers.upgrade === 'websocket' && 
                          req.headers.connection && 
                          req.headers.connection.toLowerCase().includes('upgrade');
  if (isWebSocketUpgrade) {
    return next(); // WebSocket请求跳过静态文件处理
  }
  express.static(path.join(__dirname, 'public'))(req, res, next);
});

// 初始化数据库
db.init().then(() => {
  console.log('📦 Database initialized');
  
  // 导入种子用户（如果配置了且用户表为空）
  if (config.seedUsers !== false) {
    const seedResult = db.seedUsers();
    if (seedResult.seeded) {
      console.log(`🌱 Seeded ${seedResult.count} users from config`);
    } else {
      console.log(`📝 ${seedResult.message}`);
    }
  }
  
  // 数据库就绪后启动服务器
  startServers();
}).catch(err => {
  console.error('❌ Database init failed:', err);
  process.exit(1);
});

// ========== 文件上传配置 ==========
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ========== 认证 ==========

function authenticateToken(token) {
  const user = db.getUserByToken(token);
  return user ? user.username : null;
}

// 从数据库获取用户信息（格式与config.members兼容）
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

const onlineClients = new Map(); // userId -> Set<ws>

// 从数据库获取所有用户信息（格式与config.members兼容）
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


function isValidDmChannel(channelName, userId) {
  if (!channelName || !channelName.startsWith('dm:')) return false;
  const parts = channelName.slice(3).split('_');
  if (parts.length !== 2) return false;
  const [user1, user2] = parts;
  // Verify both users exist
  const allUsernames = Object.keys(config.members || {}).concat(Object.keys(config.tokens || {}));
  if (!allUsernames.includes(user1) || !allUsernames.includes(user2)) return false;
  // Verify current user is a participant
  if (userId !== user1 && userId !== user2) return false;
  // Enforce alphabetical order
  return user1 < user2;
}

// Get authenticated user from HTTP request
function getUserIdFromRequest(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const user = db.getUserByToken(token);
  return user ? user.username : null;
}

// 发送消息给指定用户列表
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
    console.log(`[AUTH] Token authentication failed for token: ${token ? token.substring(0, 10) + '...' : 'empty'}`);
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

  // 注册在线
  if (!onlineClients.has(userId)) onlineClients.set(userId, new Set());
  onlineClients.get(userId).add(ws);

  console.log(`[+] ${userInfo.name} (${userId}) connected`);

  // 发送欢迎消息
  ws.send(JSON.stringify({
    type: 'welcome',
    data: {
      userId,
      userInfo,
      members: getAllMembersFromDb(),
      history: db.getHistory("general", config.historyLimit),
    }
  }));

  broadcastOnlineList();

  // 处理消息
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleWsMessage(ws, userId, msg);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', data: 'Invalid JSON' }));
    }
  });

  // 心跳
  ws.on('pong', () => { ws.isAlive = true; });

  // 断开
  ws.on('close', (code, reason) => {
    console.log(`[-] ${ws.userInfo?.name || userId} (${userId}) disconnected, code: ${code}, reason: ${reason || 'none'}`);
    onlineClients.get(userId)?.delete(ws);
    if (onlineClients.get(userId)?.size === 0) onlineClients.delete(userId);
    broadcastOnlineList();
  });
});

function handleWsMessage(ws, userId, msg) {
  switch (msg.type) {
    case 'chat': {
      const uid = uuidv4();
      const channel = msg.channel || 'general';
      const content = (msg.content || '').trim();
      const msgType = VALID_MESSAGE_TYPES.includes(msg.messageType) ? msg.messageType : 'text';
      if (!content && msgType === 'text') return;  // 允许文件/语音消息content为空
      if (content.length > config.maxMessageLength) {
        ws.send(JSON.stringify({ type: 'error', data: 'Message too long (max 10000 chars)' }));
        return;
      }

      // 权限校验：私聊频道只能由参与者发送
      if (isValidDmChannel(channel, ws.userId)) {
        const parts = channel.split(':');
        if (parts.length < 3 || (parts[1] !== userId && parts[2] !== userId)) {
          ws.send(JSON.stringify({ type: 'error', data: 'Access denied to this DM channel' }));
          return;
        }
      }

      const saved = db.saveMessage({
        uid,
        sender: userId,
        channel,
        content,
        type: msgType,
        metadata: msg.metadata || null,
      });

      const outMsg = {
        type: 'chat',
        data: {
          id: saved.lastInsertRowid,
          uid,
          sender: userId,
          senderInfo: getUserInfoFromDb(userId),
          channel,
          content,
          type: msgType,
          metadata: msg.metadata || null,
          created_at: new Date().toISOString(),
        }
      };

      // 私聊消息处理
      if (isValidDmChannel(channel, ws.userId)) {
        // 解析私聊参与者
        const parts = channel.split(':');
        if (parts.length >= 3) {
          const user1 = parts[1];
          const user2 = parts[2];
          
          // 更新私聊会话时间
          const conversation = db.createDM(user1, user2);
          if (conversation && conversation.id) {
            db.updateDMTime(conversation.id);
          }
          
          // 只发送给私聊双方
          sendToUsers([user1, user2], outMsg, ws);
        } else {
          // 格式错误，降级为广播
          broadcast(outMsg);
        }
      } else {
        // 普通频道消息，广播给所有人
        broadcast(outMsg);
      }
      
      dispatchWebhooks(outMsg, channel, ws.userId);
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
      const targetUser = msg.to;
      const content = (msg.content || '').trim();
      const msgType = VALID_MESSAGE_TYPES.includes(msg.messageType) ? msg.messageType : 'text';
      if (!targetUser || !content) return;
      if (content.length > config.maxMessageLength) {
        ws.send(JSON.stringify({ type: 'error', data: 'Message too long (max 10000 chars)' }));
        return;
      }

      // 生成 dm 频道名
      const participants = [userId, targetUser].sort();
      const channel = `dm:${participants[0]}:${participants[1]}`;
      
      // 保存消息
      const uid = uuidv4();
      const saved = db.saveMessage({
        uid,
        sender: userId,
        channel,
        content,
        type: msgType,
        metadata: msg.metadata || null,
      });

      const outMsg = {
        type: 'chat',
        data: {
          id: saved.lastInsertRowid,
          uid,
          sender: userId,
          senderInfo: getUserInfoFromDb(userId),
          channel,
          content,
          type: msgType,
          metadata: msg.metadata || null,
          created_at: new Date().toISOString(),
        }
      };

      // 更新私聊会话并仅发送给双方
      const conversation = db.createDM(participants[0], participants[1]);
      if (conversation?.id) db.updateDMTime(conversation.id);
      sendToUsers(participants, outMsg, ws);
      dispatchWebhooks(outMsg, channel, ws.userId);
      break;
    }
  }
}

// ========== Webhook推送 ==========

async function dispatchWebhooks(chatMsg, channel, senderId) {
  const sender = chatMsg.data.sender;
  
  // 确定需要发送webhook的用户列表
  let targetUsers = Object.keys(config.webhooks);
  
  // 如果是私聊消息，只发送给私聊对方
  if (channel && senderId && isValidDmChannel(channel, senderId)) {
    const parts = channel.split(':');
    if (parts.length >= 3) {
      const user1 = parts[1];
      const user2 = parts[2];
      // 发送给私聊对方（排除自己）
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
      const payload = JSON.stringify({
        type: 'new_message',
        message: chatMsg.data,
        timestamp: Date.now(),
      });

      const headers = {
        'Content-Type': 'application/json',
      };
      if (hook.secret) {
        headers['X-Webhook-Secret'] = hook.secret;
      }

      // 使用Node原生http/https发请求
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

// 心跳检测
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, config.heartbeatInterval);

// ========== HTTP API（供AI客户端使用） ==========

// 发消息
app.post('/api/messages', authMiddleware, (req, res) => {
  const { content, channel = 'general' } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
  if (content.length > config.maxMessageLength) return res.status(400).json({ error: 'Message too long' });
  
  // 权限校验：私聊频道只能由参与者发送
  if (isValidDmChannel(channel, getUserIdFromRequest(req))) {
    const parts = channel.split(':');
    if (parts.length < 3 || (parts[1] !== req.userId && parts[2] !== req.userId)) {
      return res.status(403).json({ error: 'Access denied to this DM channel' });
    }
  }

  const uid = uuidv4();
  const saved = db.saveMessage({
    uid,
    sender: req.userId,
    channel,
    content: content.trim(),
    type: VALID_MESSAGE_TYPES.includes(msg.messageType) ? msg.messageType : 'text',
  });

  const outMsg = {
    type: 'chat',
    data: {
      id: saved.lastInsertRowid,
      uid,
      sender: req.userId,
      senderInfo: req.userInfo,
      channel,
      content: content.trim(),
      type: VALID_MESSAGE_TYPES.includes(msg.messageType) ? msg.messageType : 'text',
      created_at: new Date().toISOString(),
    }
  };

  broadcast(outMsg);
  dispatchWebhooks(outMsg);
  res.json({ ok: true, message: outMsg.data });
});

// 获取历史消息
app.get('/api/messages', authMiddleware, (req, res) => {
  let channel = req.query.channel || 'general';
  
  // 权限校验：私聊频道只能由参与者访问
  if (isValidDmChannel(channel, getUserIdFromRequest(req))) {
    const parts = channel.split(':');
    if (parts.length < 3 || (parts[1] !== req.userId && parts[2] !== req.userId)) {
      return res.status(403).json({ error: 'Access denied to this DM channel' });
    }
  }
  
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  res.json({ ok: true, messages: db.getHistory(channel, limit) });
});

// 获取新消息（轮询用）
app.get('/api/messages/since/:lastId', authMiddleware, (req, res) => {
  let channel = req.query.channel || 'general';
  
  // 权限校验：私聊频道只能由参与者访问
  if (isValidDmChannel(channel, getUserIdFromRequest(req))) {
    const parts = channel.split(':');
    if (parts.length < 3 || (parts[1] !== req.userId && parts[2] !== req.userId)) {
      return res.status(403).json({ error: 'Access denied to this DM channel' });
    }
  }
  
  const lastId = parseInt(req.params.lastId) || 0;
  res.json({ ok: true, messages: db.getMessagesSince(channel, lastId) });
});

// 成员列表（从数据库获取）
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

// 频道管理 API
// 创建频道
app.post('/api/channels', authMiddleware, (req, res) => {
  const { name, description = '', is_private = false } = req.body;
  
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Channel name is required' });
  }
  
  // 频道名称格式校验（字母数字下划线短横线，3-30字符）
  if (!/^[a-zA-Z0-9_-]{3,30}$/.test(name)) {
    return res.status(400).json({ error: 'Channel name must be 3-30 chars, alphanumeric, underscore, or hyphen' });
  }
  
  // 检查频道是否已存在
  const existingChannel = db.getChannelByName(name);
  if (existingChannel) {
    return res.status(409).json({ error: 'Channel already exists' });
  }
  
  try {
    const channel = db.createChannel({
      name,
      description: description.trim(),
      created_by: req.userId,
      is_private: is_private ? 1 : 0,
    });
    
    res.json({
      ok: true,
      channel
    });
  } catch (error) {
    console.error('Channel creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 获取频道列表
app.get('/api/channels', authMiddleware, (req, res) => {
  const channels = db.getChannels();
  const user = db.getUserByUsername(req.userId);
  
  // 过滤频道：公开频道 + 用户创建的私有频道 + 老板可看到所有频道
  const filtered = channels.filter(channel => {
    if (channel.is_private === 0) return true; // 公开频道
    if (channel.created_by === req.userId) return true; // 用户创建的私有频道
    if (user && user.role === 'boss') return true; // 老板可看到所有频道
    return false;
  });
  
  res.json({ ok: true, channels: filtered });
});

// 删除频道
app.delete('/api/channels/:name', authMiddleware, (req, res) => {
  const { name } = req.params;
  
  const channel = db.getChannelByName(name);
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  
  // 权限检查：只有创建者可以删除（system创建的频道如general只能由boss删除）
  if (channel.created_by !== req.userId && channel.created_by !== 'system') {
    return res.status(403).json({ error: 'Only channel creator can delete' });
  }
  
  // 不能删除默认general频道
  if (name === 'general') {
    return res.status(403).json({ error: 'Cannot delete the general channel' });
  }
  
  const result = db.deleteChannel(name, req.userId);
  if (!result.deleted) {
    return res.status(result.error === 'Permission denied' ? 403 : 404).json({ error: result.error || 'Failed to delete channel' });
  }
  res.json({ ok: true, result });
});

// 私聊管理 API
// 获取我的私聊列表
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
  
  // 检查目标用户是否存在
  const targetUser = db.getUserByUsername(targetUserId);
  if (!targetUser) {
    return res.status(404).json({ error: 'Target user not found' });
  }
  
  // 不能和自己私聊（可选，可以允许）
  if (targetUserId === req.userId) {
    return res.status(400).json({ error: 'Cannot start DM with yourself' });
  }
  
  try {
    // 创建或获取现有私聊会话
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

// 用户注册（无需认证）
app.post('/api/register', (req, res) => {
  const { username, displayName, emoji = '👤' } = req.body;
  
  // 参数校验
  if (!username || !displayName) {
    return res.status(400).json({ error: 'username and displayName are required' });
  }
  
  // 用户名格式校验（字母数字下划线）
  if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
    return res.status(400).json({ error: 'username must be 3-30 chars, alphanumeric, underscore, or hyphen' });
  }
  
  // 检查用户名是否已存在
  const existingUser = db.getUserByUsername(username);
  if (existingUser) {
    return res.status(409).json({ error: 'username already exists' });
  }
  
  try {
    // 创建用户
    const user = db.createUser({
      username,
      displayName,
      emoji,
      role: 'human', // 默认人类用户，AI用户可以通过其他方式创建
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

// 文件上传
app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  
  // 构造文件访问URL和元数据
  const fileUrl = `/uploads/${req.file.filename}`;
  const fileInfo = {
    fileId: req.file.filename,
    originalName: req.file.originalname,
    fileName: req.file.filename,
    ext: path.extname(req.file.originalname).slice(1),
    size: req.file.size,
    mime: req.file.mimetype,
    downloadUrl: fileUrl,
    downloadUrlAbsolute: `${config.publicBaseUrl || ''}${fileUrl}`
  };
  
  res.json({ ok: true, file: fileInfo });
});

// 静态文件服务，让上传的文件可访问
app.use('/uploads', express.static(uploadDir));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: '虾群IM', version: '0.1.0', uptime: process.uptime() });
});

// 启动服务器函数
function startServers() {
  // HTTP -> HTTPS redirect
  httpServer.listen(config.port, '0.0.0.0', () => {
    console.log(`HTTP (redirect) listening on port ${config.port}`);
  });

  // HTTPS server
  if (httpsServer) {
    httpsServer.listen(8443, '0.0.0.0', () => {
      console.log(`HTTPS: https://im.essatheteng.com:8443`);
    });
  } else {
    httpServer.close();
    httpServer.listen(config.port, '0.0.0.0', () => {
      console.log('HTTP only (no SSL)');
    });
  }
}
