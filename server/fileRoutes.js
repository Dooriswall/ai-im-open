/**
 * fileRoutes.js v4
 * - raw: image/text inline, others attachment
 * - upload: 临时文件→日志→rename
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { ensureWorkspaceDir, sanitizePath, listDirectory, readFile, writeFile, mkdir, deletePath, getFileHistory, getFileVersion, logFileOp, createProject, listProjects, WORKSPACE_ROOT } = require('./filesystem');
const { permissionMiddleware } = require('./permissions');

const router = express.Router();
const TMP_DIR = path.join(__dirname, 'uploads', 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
const upload = multer({ dest: TMP_DIR, limits: { fileSize: 50 * 1024 * 1024 } });

const MIME_MAP = {
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml',
  '.zip':'application/zip','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls':'application/vnd.ms-excel','.pdf':'application/pdf','.doc':'application/msword',
  '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt':'text/plain','.md':'text/markdown','.json':'application/json','.js':'text/javascript',
  '.ts':'text/typescript','.py':'text/x-python','.css':'text/css','.html':'text/html',
  '.yaml':'text/yaml','.yml':'text/yaml'
};

router.get('/list', permissionMiddleware('read'), (req, res) => {
  const r = listDirectory(req.sanitizedPath, parseInt(req.query.depth || '1'));
  if (r.error) return res.status(r.status || 400).json({ error: r.error });
  res.json(r);
});

router.get('/read', permissionMiddleware('read'), (req, res) => {
  const filePath = req.sanitizedPath;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });
  const r = readFile(filePath);
  if (r.error) return res.status(r.status || 400).json({ error: r.error });
  res.json(r);
});

// raw: image/text用inline，其他attachment
router.get('/raw', permissionMiddleware('read'), (req, res) => {
  const filePath = req.sanitizedPath;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });
  const check = sanitizePath(filePath);
  if (!check.valid) return res.status(403).json({ error: check.error });
  if (!fs.existsSync(check.resolved)) return res.status(404).json({ error: 'File not found' });
  const stat = fs.statSync(check.resolved);
  if (stat.isDirectory()) return res.status(400).json({ error: 'Path is a directory' });
  const ext = path.extname(check.resolved).toLowerCase();
  const mime = MIME_MAP[ext] || 'application/octet-stream';
  const isInline = mime.startsWith('image/') || mime.startsWith('text/');
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `${isInline ? 'inline' : 'attachment'}; filename="${path.basename(check.resolved)}"`);
  fs.createReadStream(check.resolved).pipe(res);
});

router.post('/write', permissionMiddleware('write'), async (req, res) => {
  const filePath = req.sanitizedPath;
  const { content, version } = req.body;
  if (!filePath || content === undefined) return res.status(400).json({ error: 'Path and content are required' });
  const db = req.app.locals.db;
  const result = await writeFile(db, filePath, content, req.userId, version);
  if (result.error) {
    const resp = { error: result.error };
    if (result.status === 409) { resp.currentVersion = result.currentVersion; resp.message = '文件已被其他人修改，请刷新后重试'; }
    return res.status(result.status || 500).json(resp);
  }
  broadcastFileNotification(req, 'write', filePath);
  res.json(result);
});

router.post('/mkdir', permissionMiddleware('mkdir'), async (req, res) => {
  const dirPath = req.sanitizedPath;
  if (!dirPath) return res.status(400).json({ error: 'Path is required' });
  const r = mkdir(dirPath);
  if (r.error) return res.status(r.status || 500).json({ error: r.error });
  await logFileOp(req.app.locals.db, req.userId, 'mkdir', dirPath);
  broadcastFileNotification(req, 'mkdir', dirPath);
  res.json(r);
});

router.delete('/delete', permissionMiddleware('delete'), async (req, res) => {
  const filePath = req.sanitizedPath;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });
  const r = deletePath(filePath);
  if (r.error) return res.status(r.status || 500).json({ error: r.error });
  await logFileOp(req.app.locals.db, req.userId, 'delete', filePath);
  broadcastFileNotification(req, 'delete', filePath);
  res.json(r);
});

router.get('/history', permissionMiddleware('read'), async (req, res) => {
  const history = await getFileHistory(req.app.locals.db, req.sanitizedPath);
  res.json({ history });
});

// upload: 临时文件→日志→rename
router.post('/upload', upload.single('file'), permissionMiddleware('write'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const project = req.body.project;
  const targetPath = req.body.path;
  if (!targetPath || !project) { try { fs.unlinkSync(req.file.path); } catch {} return res.status(400).json({ error: 'Path and project are required' }); }

  const fullPath = `${project}/${targetPath}`;
  const check = sanitizePath(fullPath);
  if (!check.valid) { try { fs.unlinkSync(req.file.path); } catch {} return res.status(403).json({ error: check.error }); }

  const dirPath = path.dirname(check.resolved);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

  const db = req.app.locals.db;
  const newVersion = (await getFileVersion(db, check.relative)) + 1;

  // Step 1: 日志占位
  try {
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO file_ops (user_id, action, path, detail, version) VALUES (?, ?, ?, ?, ?)',
        [req.userId, 'upload', check.relative, `Uploaded ${req.file.originalname}`, newVersion],
        function (err) {
          if (err) { if (err.message && err.message.includes('UNIQUE')) return reject({ conflict: true }); return reject(err); }
          resolve();
        });
    });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    if (err.conflict) return res.status(409).json({ error: 'Version conflict - concurrent upload detected' });
    return res.status(500).json({ error: 'Failed to log operation' });
  }

  // Step 2: rename原子替换
  try {
    fs.renameSync(req.file.path, check.resolved);
    broadcastFileNotification(req, 'upload', check.relative);
    res.json({ success: true, path: check.relative, version: newVersion });
  } catch (err) {
    db.run('DELETE FROM file_ops WHERE path = ? AND version = ?', [check.relative, newVersion]);
    try { fs.unlinkSync(req.file.path); } catch {}
    if (err.code === 'ENOSPC') return res.status(507).json({ error: 'Insufficient storage' });
    res.status(500).json({ error: 'Failed to save file' });
  }
});

router.post('/project', permissionMiddleware('mkdir'), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  const r = createProject(name);
  if (r.error) return res.status(r.status || 500).json({ error: r.error });
  const db = req.app.locals.db;
  db.run('INSERT OR IGNORE INTO projects (name, created_by) VALUES (?, ?)', [name, req.userId]);
  await logFileOp(db, req.userId, 'create_project', name);
  broadcastFileNotification(req, 'mkdir', name);
  res.json(r);
});

router.get('/project', permissionMiddleware('read'), (req, res) => {
  res.json({ projects: listProjects().map(p => ({ name: p.name, path: p.path || p.name })) });
});

function broadcastFileNotification(req, action, filePath) {
  const wss = req.app.locals.wss;
  if (!wss) return;
  const n = { type: 'file_notification', data: { action, user: req.userId || 'unknown', role: req.userRole || 'unknown', path: filePath, project: filePath.split('/')[0] || '', timestamp: new Date().toISOString() } };
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(n)); });
}

module.exports = router;
