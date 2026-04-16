const initSqlJs = require('sql.js');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const config = require('./config');

let db = null;

function parseJsonSafe(value) {
  if (!value || typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    return value;
  }
}

function parseMessageRow(row) {
  if (!row) return row;
  if (typeof row.metadata === 'string') {
    row.metadata = parseJsonSafe(row.metadata);
  }
  return row;
}

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();
  const dbPath = config.dbPath;

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

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
      created_by TEXT,
      is_private INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  try { db.run('ALTER TABLE channels ADD COLUMN created_by TEXT'); } catch(e) {}
  try { db.run('ALTER TABLE channels ADD COLUMN is_private INTEGER DEFAULT 0'); } catch(e) {}
  db.run(`INSERT OR IGNORE INTO channels (name, description, created_by, is_private) VALUES ('general', '虾群大厅 - 所有人的公共频道', 'system', 0)`);

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

  db.run(`
    CREATE TABLE IF NOT EXISTS channel_members (
      channel_name TEXT NOT NULL,
      username TEXT NOT NULL,
      added_by TEXT,
      added_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (channel_name, username)
    )
  `);

  // 关键新增：附件表
  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      ext TEXT,
      mime TEXT,
      size INTEGER NOT NULL,
      uploader TEXT NOT NULL,
      channel TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_files_channel ON files(channel)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_files_uploader ON files(uploader)`);

  saveToFile();
  return db;
}

function saveToFile() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(config.dbPath, buffer);
}

setInterval(() => {
  saveToFile();
}, 10000);

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
    const result = db.exec(`SELECT last_insert_rowid() as id`);
    return { lastInsertRowid: result[0].values[0][0] };
  },

  getHistory(channel = 'general', limit = 200) {
    const stmt = db.prepare(`SELECT * FROM messages WHERE channel = ? ORDER BY id DESC LIMIT ?`);
    stmt.bind([channel, limit]);
    const rows = [];
    while (stmt.step()) rows.push(parseMessageRow(stmt.getAsObject()));
    stmt.free();
    return rows.reverse();
  },

  getAllHistory(limit = 500) {
    const stmt = db.prepare(`SELECT * FROM messages ORDER BY id DESC LIMIT ?`);
    stmt.bind([limit]);
    const rows = [];
    while (stmt.step()) rows.push(parseMessageRow(stmt.getAsObject()));
    stmt.free();
    return rows.reverse();
  },

  getMessagesSince(channel = 'general', lastId = 0) {
    const stmt = db.prepare(`SELECT * FROM messages WHERE channel = ? AND id > ? ORDER BY id ASC`);
    stmt.bind([channel, lastId]);
    const rows = [];
    while (stmt.step()) rows.push(parseMessageRow(stmt.getAsObject()));
    stmt.free();
    return rows;
  },

  createUser({ username, displayName, emoji = '👤', role = 'human', engine = null, location = null, avatarUrl = null }) {
    const id = uuidv4();
    const token = crypto.randomBytes(16).toString('hex');

    db.run(
      `INSERT INTO users (id, username, display_name, token, emoji, role, engine, location, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [id, username, displayName, token, emoji, role, engine, location, avatarUrl]
    );
    saveToFile();

    return { id, username, displayName, token, emoji, role, engine, location, avatarUrl };
  },

  getUserByToken(token) {
    const stmt = db.prepare(`SELECT * FROM users WHERE token = ?`);
    stmt.bind([token]);
    let user = null;
    if (stmt.step()) user = stmt.getAsObject();
    stmt.free();
    return user;
  },

  getUserById(id) {
    const stmt = db.prepare(`SELECT * FROM users WHERE id = ?`);
    stmt.bind([id]);
    let user = null;
    if (stmt.step()) user = stmt.getAsObject();
    stmt.free();
    return user;
  },

  getUserByUsername(username) {
    const stmt = db.prepare(`SELECT * FROM users WHERE username = ?`);
    stmt.bind([username]);
    let user = null;
    if (stmt.step()) user = stmt.getAsObject();
    stmt.free();
    return user;
  },

  getAllUsers() {
    const stmt = db.prepare(`SELECT * FROM users ORDER BY created_at DESC`);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  },

  updateLastSeen(userId) {
    db.run(`UPDATE users SET last_seen = datetime('now') WHERE id = ?`, [userId]);
    saveToFile();
  },

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
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  },

  getChannelByName(name) {
    const stmt = db.prepare(`SELECT * FROM channels WHERE name = ?`);
    stmt.bind([name]);
    let channel = null;
    if (stmt.step()) channel = stmt.getAsObject();
    stmt.free();
    return channel;
  },

  deleteChannel(name, userId) {
    const channel = this.getChannelByName(name);
    if (!channel) return { deleted: false, error: 'Channel not found' };

    const user = this.getUserById(userId) || this.getUserByUsername(userId);
    if (channel.created_by !== userId && (!user || user.role !== 'boss')) {
      return { deleted: false, error: 'Permission denied' };
    }

    db.run('DELETE FROM messages WHERE channel = ?', [name]);
    db.run('DELETE FROM channel_members WHERE channel_name = ?', [name]);
    db.run('DELETE FROM channels WHERE name = ?', [name]);
    saveToFile();
    return { deleted: true, name };
  },

  createDM(user1, user2) {
    const [sorted1, sorted2] = [user1, user2].sort();

    const stmt = db.prepare(`SELECT * FROM dm_conversations WHERE user1 = ? AND user2 = ?`);
    stmt.bind([sorted1, sorted2]);
    let conversation = null;
    if (stmt.step()) conversation = stmt.getAsObject();
    stmt.free();

    if (conversation) return conversation;

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
    while (stmt.step()) rows.push(stmt.getAsObject());
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

  seedUsers() {
    let seededCount = 0;
    const { tokens, members } = config;

    for (const [username, token] of Object.entries(tokens)) {
      const memberInfo = members[username];
      if (!memberInfo) continue;

      // 检查是否已存在（按用户名）
      const existingByUsername = this.getUserByUsername(username);
      if (existingByUsername) continue;
      
      // 检查是否已存在（按token）
      const existingByToken = this.getUserByToken(token);
      if (existingByToken) continue;

      db.run(
        `INSERT INTO users (id, username, display_name, token, emoji, role, engine, location, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [uuidv4(), username, memberInfo.name, token, memberInfo.emoji || '👤', memberInfo.role || 'human', memberInfo.engine || null, memberInfo.location || null]
      );
      seededCount++;
    }

    if (seededCount > 0) {
      saveToFile();
    }
    return { seeded: seededCount > 0, count: seededCount };
  },

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
    const stmt = db.prepare('SELECT 1 FROM channel_members WHERE channel_name = ? AND username = ?');
    stmt.bind([channelName, username]);
    const isMember = stmt.step();
    stmt.free();
    return isMember;
  },

  searchMessages(query, channel, limit) {
    let sql, params;
    if (channel) {
      sql = 'SELECT * FROM messages WHERE channel = ? AND content LIKE ? ORDER BY id DESC LIMIT ?';
      params = [channel, '%' + query + '%', limit];
    } else {
      sql = 'SELECT * FROM messages WHERE content LIKE ? ORDER BY id DESC LIMIT ?';
      params = ['%' + query + '%', limit];
    }
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(parseMessageRow(stmt.getAsObject()));
    stmt.free();
    return rows;
  },

  deleteUser(username) {
    db.run('DELETE FROM users WHERE username = ?', [username]);
    db.run('DELETE FROM messages WHERE sender = ?', [username]);
    db.run('DELETE FROM dm_conversations WHERE user1 = ? OR user2 = ?', [username, username]);
    db.run('DELETE FROM channel_members WHERE username = ?', [username]);
    db.run('DELETE FROM files WHERE uploader = ?', [username]);
    saveToFile();
    return { deleted: true, username };
  },

  createFileRecord({ id, originalName, storedName, ext, mime, size, uploader, channel }) {
    db.run(
      `INSERT INTO files (id, original_name, stored_name, ext, mime, size, uploader, channel, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [id, originalName, storedName, ext, mime, size, uploader, channel]
    );
    saveToFile();
    return { id, originalName, storedName, ext, mime, size, uploader, channel };
  },

  getFileById(id) {
    const stmt = db.prepare(`SELECT * FROM files WHERE id = ?`);
    stmt.bind([id]);
    let row = null;
    if (stmt.step()) row = stmt.getAsObject();
    stmt.free();
    return row;
  },
};