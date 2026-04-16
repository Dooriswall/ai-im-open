// Run this on the remote server to patch db.js and index.js
const fs = require('fs');
const path = require('path');

const serverDir = path.join(process.env.HOME, 'shrimp-im/server');

// ===== PATCH db.js =====
let dbCode = fs.readFileSync(path.join(serverDir, 'db.js'), 'utf8');

// 1. Add channel_members table creation (after dm_conversations)
if (!dbCode.includes('channel_members')) {
  const insertAfter = "saveToFile();\n  return db;\n}";
  const tableCreation = `
  // Channel members table
  db.run(\`
    CREATE TABLE IF NOT EXISTS channel_members (
      channel_name TEXT NOT NULL,
      username TEXT NOT NULL,
      added_by TEXT,
      added_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (channel_name, username)
    )
  \`);

  saveToFile();
  return db;
}`;
  dbCode = dbCode.replace(insertAfter, tableCreation);
}

// 2. Add channel member methods to module.exports (before the closing });)
if (!dbCode.includes('addChannelMember')) {
  const closingBrace = '\n};';
  const newMethods = `

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
};`;
  dbCode = dbCode.replace(/\n};[\s]*$/, newMethods);
}

fs.writeFileSync(path.join(serverDir, 'db.js'), dbCode);
console.log('✅ db.js patched');

// ===== PATCH index.js =====
let indexCode = fs.readFileSync(path.join(serverDir, 'index.js'), 'utf8');

// Add channel member API endpoints (before the health check endpoint)
if (!indexCode.includes('/api/channels/:name/members')) {
  const healthCheck = "// 健康检查\napp.get('/api/health'";
  const newEndpoints = `// 频道成员管理 API
// 获取频道成员
app.get('/api/channels/:name/members', authMiddleware, (req, res) => {
  const { name } = req.params;
  const channel = db.getChannelByName(name);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  
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
  
  // Only channel creator or boss can add members
  const user = db.getUserByUsername(req.userId);
  if (channel.created_by !== req.userId && (!user || user.role !== 'boss')) {
    return res.status(403).json({ error: 'Permission denied' });
  }
  
  // Check target user exists
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
  
  // Only channel creator or boss can remove members
  const user = db.getUserByUsername(req.userId);
  if (channel.created_by !== req.userId && (!user || user.role !== 'boss')) {
    return res.status(403).json({ error: 'Permission denied' });
  }
  
  const result = db.removeChannelMember(name, username);
  res.json({ ok: true, ...result });
});

// 健康检查
app.get('/api/health'`;
  indexCode = indexCode.replace(healthCheck, newEndpoints);
}

fs.writeFileSync(path.join(serverDir, 'index.js'), indexCode);
console.log('✅ index.js patched');

console.log('🦐 All patches applied! Restart shrimp-im with: pm2 restart shrimp-im');
