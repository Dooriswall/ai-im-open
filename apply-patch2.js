const fs = require('fs');
const path = require('path');
const serverDir = path.join(process.env.HOME, 'shrimp-im/server');

// ===== PATCH index.js =====
let code = fs.readFileSync(path.join(serverDir, 'index.js'), 'utf8');

// 1. Boss gets unlimited history on welcome
code = code.replace(
  `history: db.getHistory('general', config.historyLimit),`,
  `history: db.getHistory('general', userId === 'boss' ? 99999 : config.historyLimit),`
);

// 2. Boss gets unlimited history on GET /api/messages
code = code.replace(
  /app\.get\('\/api\/messages', authMiddleware, \(req, res\) => \{[\s\S]*?const limit = Math\.min\(parseInt\(req\.query\.limit\) \|\| 100, 500\);/,
  `app.get('/api/messages', authMiddleware, (req, res) => {
  const channel = req.query.channel || 'general';
  const maxLimit = req.userId === 'boss' ? 99999 : 500;
  const limit = Math.min(parseInt(req.query.limit) || 100, maxLimit);`
);

// 3. Add search API (before health check)
if (!code.includes('/api/messages/search')) {
  code = code.replace(
    `// 频道成员管理 API`,
    `// 消息搜索 API
app.get('/api/messages/search', authMiddleware, (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) return res.status(400).json({ error: 'Search query (q) is required' });
  const channel = req.query.channel || null; // null = search all channels
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  
  try {
    const messages = db.searchMessages(query, channel, limit);
    res.json({ ok: true, query, messages });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// 频道成员管理 API`
  );
}

fs.writeFileSync(path.join(serverDir, 'index.js'), code);
console.log('✅ index.js patched (boss history + search API)');

// ===== PATCH db.js =====
let dbCode = fs.readFileSync(path.join(serverDir, 'db.js'), 'utf8');

// Add searchMessages method
if (!dbCode.includes('searchMessages')) {
  dbCode = dbCode.replace(
    /\n};[\s]*$/,
    `

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
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  },
};
`
  );
}

fs.writeFileSync(path.join(serverDir, 'db.js'), dbCode);
console.log('✅ db.js patched (searchMessages)');

console.log('🦐 Done! Restart with: pm2 restart shrimp-im');
