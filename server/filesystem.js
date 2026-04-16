/**
 * filesystem.js v4
 * - writeFile: 临时文件 → 日志占位 → rename原子替换
 * - sanitizePath: 返回 path.relative 规范化相对路径
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const WORKSPACE_ROOT = path.join(__dirname, 'workspace');
const IGNORE_FILE = '.workspace-ignore';
const DEFAULT_IGNORE = ['node_modules', '.git', '__pycache__', '.DS_Store'];
const VALID_ACTIONS = ['write', 'upload', 'mkdir', 'delete', 'create_project'];

function ensureWorkspaceDir() {
  if (!fs.existsSync(WORKSPACE_ROOT)) fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
}

function parseIgnoreFile(projectPath) {
  const p = path.join(projectPath, IGNORE_FILE);
  if (!fs.existsSync(p)) return DEFAULT_IGNORE;
  try {
    return [...DEFAULT_IGNORE, ...fs.readFileSync(p, 'utf-8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))];
  } catch { return DEFAULT_IGNORE; }
}

function isIgnored(name, patterns) {
  return patterns.some(p => p.startsWith('*') ? name.endsWith(p.slice(1)) : name === p);
}

/**
 * sanitizePath - 返回规范化相对路径
 */
function sanitizePath(inputPath) {
  if (inputPath === '') return { valid: true, resolved: WORKSPACE_ROOT, relative: '' };
  if (inputPath == null || typeof inputPath !== 'string') return { valid: false, error: 'Path is required' };
  inputPath = inputPath.replace(/\\/g, '/');
  if (inputPath.includes('\0')) return { valid: false, error: 'Null byte in path' };
  if (path.isAbsolute(inputPath)) return { valid: false, error: 'Absolute path not allowed' };
  const resolved = path.resolve(WORKSPACE_ROOT, inputPath);
  if (!resolved.startsWith(WORKSPACE_ROOT + path.sep) && resolved !== WORKSPACE_ROOT) {
    return { valid: false, error: 'Path traversal detected' };
  }
  // 规范化相对路径
  const relative = path.relative(WORKSPACE_ROOT, resolved).replace(/\\/g, '/');
  return { valid: true, resolved, relative };
}

function validateProjectName(name) {
  if (!name || typeof name !== 'string') return { valid: false, error: 'Project name is required' };
  name = name.trim();
  if (name.length === 0 || name.length > 64) return { valid: false, error: 'Project name length invalid (1-64)' };
  if (!/^[a-zA-Z0-9\u4e00-\u9fa5_-]+$/.test(name)) return { valid: false, error: 'Project name contains invalid characters' };
  const check = sanitizePath(name);
  if (!check.valid) return { valid: false, error: 'Invalid project name' };
  return { valid: true };
}

function initDatabase(db) {
  db.run(`CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.run(`CREATE TABLE IF NOT EXISTS file_ops (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, action TEXT NOT NULL, path TEXT NOT NULL, timestamp TEXT NOT NULL DEFAULT (datetime('now')), detail TEXT, version INTEGER)`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_file_ops_path_version ON file_ops(path, version) WHERE version IS NOT NULL`);
}

function getFileVersion(db, filePath) {
  return new Promise(resolve => {
    db.get('SELECT MAX(version) as version FROM file_ops WHERE path = ? AND action IN (?, ?)', [filePath, 'write', 'upload'], (err, row) => {
      resolve(row && row.version != null ? row.version : 0);
    });
  });
}

function logFileOp(db, userId, action, filePath, detail = null) {
  return new Promise((resolve, reject) => {
    if (!VALID_ACTIONS.includes(action)) return reject(new Error(`Invalid action: ${action}`));
    if (action === 'write' || action === 'upload') {
      db.get('SELECT MAX(version) as version FROM file_ops WHERE path = ? AND action IN (?, ?)', [filePath, 'write', 'upload'], (err, row) => {
        const version = (row && row.version != null ? row.version : 0) + 1;
        db.run('INSERT INTO file_ops (user_id, action, path, detail, version) VALUES (?, ?, ?, ?, ?)', [userId, action, filePath, detail, version], function (err2) {
          if (err2) {
            if (err2.message && err2.message.includes('UNIQUE')) return reject({ conflict: true, message: 'Version conflict' });
            return reject(err2);
          }
          resolve(version);
        });
      });
    } else {
      db.run('INSERT INTO file_ops (user_id, action, path, detail, version) VALUES (?, ?, ?, ?, NULL)', [userId, action, filePath, detail], (err2) => {
        if (err2) reject(err2); else resolve(null);
      });
    }
  });
}

function listDirectory(relativePath, depth = 1) {
  const check = sanitizePath(relativePath);
  if (!check.valid) return { error: check.error };
  if (!fs.existsSync(check.resolved)) return { error: 'Directory not found', status: 404 };
  if (!fs.statSync(check.resolved).isDirectory()) return { error: 'Not a directory', status: 400 };

  const projName = (check.relative || '').split('/')[0] || '';
  const projPath = projName ? path.join(WORKSPACE_ROOT, projName) : WORKSPACE_ROOT;
  const ignores = fs.existsSync(projPath) ? parseIgnoreFile(projPath) : DEFAULT_IGNORE;

  function readDir(dir, relBase, d) {
    const entries = [];
    let items; try { items = fs.readdirSync(dir); } catch { return entries; }
    for (const item of items) {
      if (isIgnored(item, ignores)) continue;
      const fp = path.join(dir, item);
      const rp = relBase ? `${relBase}/${item}` : item;
      let st; try { st = fs.statSync(fp); } catch { continue; }
      const e = { name: item, path: rp, type: st.isDirectory() ? 'dir' : 'file', size: st.isFile() ? st.size : 0, modified: st.mtime.toISOString() };
      if (st.isDirectory() && d !== 1) e.children = readDir(fp, rp, d - 1);
      entries.push(e);
    }
    return entries;
  }
  return { entries: readDir(check.resolved, check.relative, depth === -1 ? Infinity : depth) };
}

function readFile(relativePath) {
  const check = sanitizePath(relativePath);
  if (!check.valid) return { error: check.error };
  if (!fs.existsSync(check.resolved)) return { error: 'File not found', status: 404 };
  const stat = fs.statSync(check.resolved);
  if (stat.isDirectory()) return { error: 'Path is a directory', status: 400 };
  const ext = path.extname(check.resolved).toLowerCase();
  const BIN = ['.png','.jpg','.jpeg','.gif','.svg','.zip','.xlsx','.xls','.pdf','.doc','.docx'];
  const MIME = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.zip':'application/zip','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.xls':'application/vnd.ms-excel','.pdf':'application/pdf','.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
  if (BIN.includes(ext)) return { type:'binary', ext, mime:MIME[ext]||'application/octet-stream', downloadUrl:`/api/files/raw?path=${encodeURIComponent(check.relative)}`, size:stat.size, modified:stat.mtime.toISOString() };
  try { return { type:'text', content:fs.readFileSync(check.resolved,'utf-8'), ext, path:check.relative, size:stat.size, modified:stat.mtime.toISOString() }; }
  catch { return { error:'Failed to read file', status:500 }; }
}

/**
 * writeFile: 临时文件 → 日志占位 → rename原子替换
 * 并发冲突时失败方不改变磁盘内容
 */
async function writeFile(db, relativePath, content, userId, version = null) {
  const check = sanitizePath(relativePath);
  if (!check.valid) return { error: check.error, status: 403 };

  if (version !== null) {
    const cur = await getFileVersion(db, check.relative);
    if (version !== cur) return { error: 'Version conflict', status: 409, currentVersion: cur };
  }

  const dirPath = path.dirname(check.resolved);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

  const currentMaxVersion = await getFileVersion(db, check.relative);
  const newVersion = currentMaxVersion + 1;

  // Step 1: 写临时文件
  const tmpFile = path.join(os.tmpdir(), `ws_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  try {
    fs.writeFileSync(tmpFile, content, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOSPC') return { error: 'Insufficient storage', status: 507 };
    return { error: 'Failed to write temp file', status: 500 };
  }

  // Step 2: 插入日志占位（唯一索引保证并发安全）
  try {
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO file_ops (user_id, action, path, detail, version) VALUES (?, ?, ?, ?, ?)',
        [userId, 'write', check.relative, null, newVersion],
        function (err) {
          if (err) {
            if (err.message && err.message.includes('UNIQUE')) return reject({ conflict: true });
            return reject(err);
          }
          resolve();
        });
    });
  } catch (err) {
    // 清理临时文件
    try { fs.unlinkSync(tmpFile); } catch {}
    if (err.conflict) return { error: 'Version conflict - concurrent write detected', status: 409 };
    return { error: 'Failed to log operation', status: 500 };
  }

  // Step 3: rename原子替换正式文件
  try {
    fs.renameSync(tmpFile, check.resolved);
    return { success: true, path: check.relative, version: newVersion };
  } catch (err) {
    // rename失败，回滚日志
    db.run('DELETE FROM file_ops WHERE path = ? AND version = ?', [check.relative, newVersion]);
    try { fs.unlinkSync(tmpFile); } catch {}
    if (err.code === 'ENOSPC') return { error: 'Insufficient storage', status: 507 };
    return { error: 'Failed to write file', status: 500 };
  }
}

function mkdir(relativePath) {
  const check = sanitizePath(relativePath);
  if (!check.valid) return { error: check.error, status: 403 };
  if (fs.existsSync(check.resolved)) return { error: 'Path already exists', status: 409 };
  try { fs.mkdirSync(check.resolved, { recursive: true }); return { success: true, path: check.relative }; }
  catch { return { error: 'Failed to create directory', status: 500 }; }
}

function deletePath(relativePath) {
  const check = sanitizePath(relativePath);
  if (!check.valid) return { error: check.error, status: 403 };
  if (!fs.existsSync(check.resolved)) return { error: 'Path not found', status: 404 };
  try { const s = fs.statSync(check.resolved); if (s.isDirectory()) fs.rmSync(check.resolved, { recursive: true }); else fs.unlinkSync(check.resolved); return { success: true, path: check.relative }; }
  catch { return { error: 'Failed to delete', status: 500 }; }
}

function getFileHistory(db, relativePath) {
  return new Promise(resolve => {
    if (relativePath) db.all('SELECT * FROM file_ops WHERE path LIKE ? ORDER BY timestamp DESC LIMIT 100', [relativePath + '%'], (e, r) => resolve(r || []));
    else db.all('SELECT * FROM file_ops ORDER BY timestamp DESC LIMIT 100', [], (e, r) => resolve(r || []));
  });
}

function createProject(name) {
  const v = validateProjectName(name);
  if (!v.valid) return { error: v.error, status: 400 };
  const pp = path.join(WORKSPACE_ROOT, name);
  if (fs.existsSync(pp)) return { error: 'Project already exists', status: 409 };
  try {
    for (const d of ['src','docs','reviews','tasks']) fs.mkdirSync(path.join(pp, d), { recursive: true });
    fs.writeFileSync(path.join(pp, 'README.md'), `# ${name}\n\nCreated by 虾群IM文件管理系统\n`, 'utf-8');
    fs.writeFileSync(path.join(pp, IGNORE_FILE), DEFAULT_IGNORE.join('\n') + '\n', 'utf-8');
    return { success: true, name, path: name };
  } catch { return { error: 'Failed to create project', status: 500 }; }
}

function listProjects() {
  ensureWorkspaceDir();
  return fs.readdirSync(WORKSPACE_ROOT, { withFileTypes: true })
    .filter(e => e.isDirectory() && !isIgnored(e.name, DEFAULT_IGNORE))
    .map(e => ({ name: e.name, path: e.name }));
}

module.exports = {
  WORKSPACE_ROOT, ensureWorkspaceDir, initDatabase, sanitizePath, validateProjectName,
  listDirectory, readFile, writeFile, mkdir, deletePath, getFileHistory,
  getFileVersion, logFileOp, createProject, listProjects, DEFAULT_IGNORE, VALID_ACTIONS
};
