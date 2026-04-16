/**
 * permissions.js v5 - 兼容虾群IM成员结构
 * config.members = { id: { name, role }, ... }
 * 也支持 db.getUserByUsername() 返回的 { role }
 */

function getRoleFromUserId(userId, config) {
  if (!userId) return null;
  
  // 从config.members获取（虾群IM格式：{ id: { name, role } }）
  if (config && config.members) {
    const member = config.members[userId];
    if (member) {
      if (member.role === 'boss' || member.boss) return 'boss';
      return member.role || null;
    }
  }
  
  return null;
}

function checkPermission(role, action, filePath) {
  if (action === 'read') return true;
  if (action === 'delete') return role === 'boss';
  if (action === 'mkdir') return role === 'boss' || role === '智虾';
  if (action === 'write') {
    if (role === 'boss') return true;
    if (role === '智虾') return filePath.startsWith('src/') || filePath.startsWith('docs/') || filePath.startsWith('tasks/') || filePath === 'README.md';
    if (['审核员', '挑剔者', '火山星人'].includes(role)) return filePath.startsWith('reviews/') && filePath.includes('/' + role + '/');
    return false;
  }
  return false;
}

function extractTargetPath(req) {
  let rawPath = req.body && req.body.path;
  if (!rawPath && req.query && req.query.path) rawPath = req.query.path;
  if (!rawPath && req.body && req.body.project && req.body.path) rawPath = `${req.body.project}/${req.body.path}`;
  if (rawPath) rawPath = rawPath.replace(/\\/g, '/').split('/').filter(p => p && p !== '.').join('/');
  return rawPath || '';
}

function permissionMiddleware(action) {
  return (req, res, next) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // 从app.locals获取config，也尝试从req.userInfo获取role
    const config = req.app.locals.config || {};
    let role = getRoleFromUserId(userId, config);
    
    // fallback: 从req.userInfo.role获取（数据库查出来的）
    if (!role && req.userInfo && req.userInfo.role) {
      role = req.userInfo.role;
    }
    
    if (!role) return res.status(403).json({ error: 'Unknown user role' });
    
    const rawPath = extractTargetPath(req);
    const { sanitizePath } = require('./filesystem');
    const check = sanitizePath(rawPath);
    if (!check.valid) return res.status(403).json({ error: check.error });
    if (!checkPermission(role, action, check.relative)) return res.status(403).json({ error: 'Permission denied', role, action });
    req.userRole = role;
    req.sanitizedPath = check.relative;
    next();
  };
}

module.exports = { getRoleFromUserId, checkPermission, permissionMiddleware, extractTargetPath };
