const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const config = require('./config');

let db = null;
let bindPatchApplied = false;

async function getDb() {
  if (db) {
    return db;
  }
  
  const SQL = await initSqlJs();
  const dbPath = config.dbPath;
  
  // 如果数据库文件存在，加载它
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // 建表
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL,
      sender TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'general',
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      metadata TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel, created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender)`);
  db.run(`
    CREATE TABLE IF NOT EXISTS channels (
      name TEXT PRIMARY KEY,
      description TEXT,
      created_by TEXT,  -- 创建者用户ID
      is_private INTEGER DEFAULT 0,  -- 0=公开, 1=私密
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // 迁移：确保created_by和is_private字段存在（如果表已存在但缺少这些字段）
  try { db.run('ALTER TABLE channels ADD COLUMN created_by TEXT'); } catch(e) {}
  try { db.run('ALTER TABLE channels ADD COLUMN is_private INTEGER DEFAULT 0'); } catch(e) {}
  db.run(`INSERT OR IGNORE INTO channels (name, description, created_by, is_private) VALUES ('general', '虾群大厅 - 所有人的公共频道', 'system', 0)`);
  
  // 用户表
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      emoji TEXT DEFAULT '👤',
      role TEXT DEFAULT 'human',
      engine TEXT,
      location TEXT,
      avatar_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_seen TEXT
    )
  `);
  
  // 私聊会话表
  db.run(`
    CREATE TABLE IF NOT EXISTS dm_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user1 TEXT NOT NULL,
      user2 TEXT NOT NULL,
      last_message_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user1, user2)
    )
  `);
  
  
  // Channel members table
  db.run(`
    CREATE TABLE IF NOT EXISTS channel_members (
      channel_name TEXT NOT NULL,
      username TEXT NOT NULL,
      added_by TEXT,
      added_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (channel_name, username)
    )
  `);

  saveToFile();
  // 猴子补丁：清理undefined绑定参数
  const originalPrepare = db.prepare;
  db.prepare = function(sql) {
    const stmt = originalPrepare.call(this, sql);
    const originalBind = stmt.bind;
    stmt.bind = function(params) {
      // 将undefined转换为null
      const cleaned = params.map(p => (p === undefined ? null : p));
      return originalBind.call(this, cleaned);
    };
    return stmt;
  };
  // 包装db.run以处理undefined参数（sql.js兼容性补丁，仅在init时应用一次）
  const originalRun = db.run;
  db.run = function(sql, params) {
    if (params) {
      const cleaned = params.map(p => (p === undefined ? null : p));
      return originalRun.call(this, sql, cleaned);
    }
    return originalRun.call(this, sql);
  };

function saveToFile() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(config.dbPath, buffer);
}

// 定期保存到磁盘
setInterval(() => {
  saveToFile();
}, 10000);

// Escape special LIKE characters to prevent injection
function escapeLike(str) {
  return str.replace(/\\/g, '\\\\\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

module.exports = {
  async init() {
    return getDb();
  },

  saveMessage({ uid, sender, channel = 'general', content, type = 'text', metadata = null }) {
    db.run(
      `INSERT INTO messages (uid, sender, channel, content, type, metadata) VALUES (?, ?, ?, ?, ?, ?)`,
      [uid, sender, channel, content, type, metadata ? JSON.stringify(metadata) : null]
    );
    saveToFile();
    // 获取最后插入的ID
    const result = db.exec(`SELECT last_insert_rowid() as id`);
    return { lastInsertRowid: result[0].values[0][0] };
  },

  getHistory(channel = 'general', limit = 200) {
    const stmt = db.prepare(`SELECT * FROM messages WHERE channel = ? ORDER BY id DESC LIMIT ?`);
    stmt.bind([channel, limit]);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows.reverse();
  },

  getAllHistory(limit = 500) {
    const stmt = db.prepare(`SELECT * FROM messages ORDER BY id DESC LIMIT ?`);
    stmt.bind([limit]);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows.reverse();
  },

  getMessagesSince(channel = 'general', lastId = 0) {
    const stmt = db.prepare(`SELECT * FROM messages WHERE channel = ? AND id > ? ORDER BY id ASC`);
    stmt.bind([channel, lastId]);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  },

  // 用户管理方法
  createUser({ username, displayName, emoji = '👤', role = 'human', engine = null, location = null, avatarUrl = null }) {
    const id = uuidv4();
    // 生成32字符随机token
    const token = crypto.randomBytes(16).toString('hex');
    
    db.run(
      `INSERT INTO users (id, username, display_name, token, emoji, role, engine, location, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [id, username, displayName, token, emoji, role, engine, location, avatarUrl]
    );
    saveToFile();
    
    return { id, username, displayName, token, emoji, role, engine, location, avatarUrl };
  },

  getUserByToken(token) {
    if (!token) return null;
    const stmt = db.prepare(`SELECT * FROM users WHERE token = ?`);
    stmt.bind([token]);
    let user = null;
    if (stmt.step()) {
      user = stmt.getAsObject();
    }
    stmt.free();
    return user;
  },

  getUserById(id) {
    if (!id) return null;
    const stmt = db.prepare(`SELECT * FROM users WHERE id = ?`);
    stmt.bind([id]);
    let user = null;
    if (stmt.step()) {
      user = stmt.getAsObject();
    }
    stmt.free();
    return user;
  },

  getUserByUsername(username) {
    if (!username) return null;
    const stmt = db.prepare(`SELECT * FROM users WHERE username = ?`);
    stmt.bind([username]);
    let user = null;
    if (stmt.step()) {
      user = stmt.getAsObject();
    }
    stmt.free();
    return user;
  },

  getAllUsers() {
    const stmt = db.prepare(`SELECT * FROM users ORDER BY created_at DESC`);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  },

  updateLastSeen(userId) {
    db.run(`UPDATE users SET last_seen = datetime('now') WHERE id = ?`, [userId]);
    saveToFile();
  },

  // 频道管理方法
  createChannel({ name, description, created_by, is_private = 0 }) {
    db.run(
      `INSERT INTO channels (name, description, created_by, is_private, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
      [name, description, created_by, is_private]
    );
    saveToFile();
    return { name, description, created_by, is_private };
  },

  getChannels() {
    const stmt = db.prepare(`SELECT * FROM channels ORDER BY created_at DESC`);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  },

  getChannelByName(name) {
    if (!name) return null;
    const stmt = db.prepare(`SELECT * FROM channels WHERE name = ?`);
    stmt.bind([name]);
    let channel = null;
    if (stmt.step()) {
      channel = stmt.getAsObject();
    }
    stmt.free();
    return channel;
  },

  deleteChannel(name, userId) {
    const channel = this.getChannelByName(name);
    if (!channel) return { deleted: false, error: 'Channel not found' };
    
    // boss可以删任何频道
    const user = this.getUserById(userId) || this.getUserByUsername(userId);
    if (channel.created_by !== userId && (!user || user.role !== 'boss')) {
      return { deleted: false, error: 'Permission denied' };
    }
    
    // 删除该频道的所有消息
    db.run('DELETE FROM messages WHERE channel = ?', [name]);
    db.run('DELETE FROM channels WHERE name = ?', [name]);
    saveToFile();
    return { deleted: true, name };
  },

  // 私聊会话管理
  createDM(user1, user2) {
    if (!user1 || !user2) return null;
    // 排序保证唯一性：按字母顺序
    const [sorted1, sorted2] = [user1, user2].sort();
    
    // 检查是否已存在
    const stmt = db.prepare(`SELECT * FROM dm_conversations WHERE user1 = ? AND user2 = ?`);
    stmt.bind([sorted1, sorted2]);
    let conversation = null;
    if (stmt.step()) {
      conversation = stmt.getAsObject();
    }
    stmt.free();
    
    if (conversation) {
      return conversation;
    }
    
    // 创建新会话
    db.run(
      `INSERT INTO dm_conversations (user1, user2, last_message_at, created_at) VALUES (?, ?, datetime('now'), datetime('now'))`,
      [sorted1, sorted2]
    );
    
    const newStmt = db.prepare(`SELECT * FROM dm_conversations WHERE user1 = ? AND user2 = ?`);
    newStmt.bind([sorted1, sorted2]);
    newStmt.step();
    const newConversation = newStmt.getAsObject();
    newStmt.free();
    
    saveToFile();
    return newConversation;
  },

  getDMList(userId) {
    if (!userId) return [];
    // 获取用户参与的所有私聊会话，带对方用户信息
    const stmt = db.prepare(`
      SELECT 
        c.*,
        CASE 
          WHEN c.user1 = ? THEN c.user2
          ELSE c.user1
        END as partner_id,
        u.username as partner_username,
        u.display_name as partner_display_name,
        u.emoji as partner_emoji,
        u.role as partner_role,
        u.engine as partner_engine,
        u.location as partner_location
      FROM dm_conversations c
      LEFT JOIN users u ON u.username = CASE 
        WHEN c.user1 = ? THEN c.user2
        ELSE c.user1
      END
      WHERE c.user1 = ? OR c.user2 = ?
      ORDER BY c.last_message_at DESC
    `);
    stmt.bind([userId, userId, userId, userId]);
    
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  },

  updateDMTime(conversationId) {
    db.run(
      `UPDATE dm_conversations SET last_message_at = datetime('now') WHERE id = ?`,
      [conversationId]
    );
    saveToFile();
  },

  // 导入种子用户（从config.js的硬编码数据）
  seedUsers() {
    const stmt = db.prepare(`SELECT COUNT(*) as count FROM users`);
    stmt.step();
    const count = stmt.getAsObject().count;
    stmt.free();
    
    if (count > 0) {
      return { seeded: false, message: 'Users table already has data, skipping seed' };
    }
    
    let seededCount = 0;
    const { tokens, members } = config;
    
    for (const [username, token] of Object.entries(tokens)) {
      const memberInfo = members[username];
      if (!memberInfo) continue;
      
      // 检查是否已存在
      const existing = this.getUserByToken(token);
      if (existing) continue;
      
      // 插入用户
      db.run(
        `INSERT INTO users (id, username, display_name, token, emoji, role, engine, location, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [uuidv4(), username, memberInfo.name, token, memberInfo.emoji || '👤', memberInfo.role || 'human', memberInfo.engine || null, memberInfo.location || null]
      );
      seededCount++;
    }
    
    saveToFile();
    return { seeded: true, count: seededCount };
  },

  // Channel member management
  addChannelMember(channelName, username, addedBy) {
    db.run(
      'INSERT OR IGNORE INTO channel_members (channel_name, username, added_by) VALUES (?, ?, ?)',
      [channelName, username, addedBy]
    );
    saveToFile();
    return { added: true, channelName, username };
  },

  removeChannelMember(channelName, username) {
    db.run('DELETE FROM channel_members WHERE channel_name = ? AND username = ?', [channelName, username]);
    saveToFile();
    return { removed: true };
  },

  getChannelMembers(channelName) {
    if (!channelName) return [];
    const stmt = db.prepare(
      'SELECT cm.*, u.display_name, u.emoji, u.role, u.engine FROM channel_members cm LEFT JOIN users u ON u.username = cm.username WHERE cm.channel_name = ?'
    );
    stmt.bind([channelName]);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  },

  isChannelMember(channelName, username) {
    if (!channelName || !username) return false;
    const stmt = db.prepare('SELECT 1 FROM channel_members WHERE channel_name = ? AND username = ?');
    stmt.bind([channelName, username]);
    const isMember = stmt.step();
    stmt.free();
    return isMember;
  },

  searchMessages(query, channel, limit) {
    if (!query) return [];
    const safeLimit = limit || 50;
    let sql, params;
    if (channel) {
      sql = 'SELECT * FROM messages WHERE channel = ? AND content LIKE ? ESCAPE '\\\\' ORDER BY id DESC LIMIT ?';
      params = [channel, '%' + escapeLike(query) + '%', safeLimit];
    } else {
      sql = 'SELECT * FROM messages WHERE content LIKE ? ESCAPE '\\\\' ORDER BY id DESC LIMIT ?';
      params = ['%' + escapeLike(query) + '%', safeLimit];
    }
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  },

  deleteUser(username) {
    db.run('DELETE FROM users WHERE username = ?', [username]);
    db.run('DELETE FROM messages WHERE sender = ?', [username]);
    db.run('DELETE FROM dm_conversations WHERE user1 = ? OR user2 = ?', [username, username]);
    db.run('DELETE FROM channel_members WHERE username = ?', [username]);
    saveToFile();
    return { deleted: true, username };
  },
};
