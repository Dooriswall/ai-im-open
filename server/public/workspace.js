class WorkspaceManager {
  constructor() {
    this.currentPath = '';
    this.projects = [];
    this.currentFileVersion = 0;
    this.userRole = null;
  }

  async init() {
    this.detectRole();
    this.renderShell();
    await this.loadProjects();
  }

  detectRole() {
    try {
      var uid = '';
      if (window.currentUser && window.currentUser.id) uid = window.currentUser.id;
      if (window.currentUserId) uid = window.currentUserId;
      if (uid === 'boss') this.userRole = 'boss';
    } catch(e) {}
  }

  renderShell() {
    var c = document.getElementById('workspace-container');
    if (!c) return;
    var isBoss = this.userRole === 'boss';
    var deleteBtn = isBoss ? '<button onclick="workspaceManager.deleteSelected()" style="background:#8b0000;border:1px solid #a00;color:#e0e0e0;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:13px;">🗑️ 删除</button>' : '';
    c.innerHTML = '<div style="display:flex;flex-direction:column;height:100%;width:100%;">' +
      '<div style="display:flex;align-items:center;padding:8px 16px;background:#252536;border-bottom:1px solid #333;gap:8px;">' +
        '<button onclick="switchTab(\'chat\')" style="background:#e94560;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:13px;">← 返回聊天</button>' +
        '<span style="color:#7c7cff;font-size:14px;font-weight:bold;">📁 工作台</span>' +
        '<span id="ws-breadcrumb" style="margin-left:12px;font-size:13px;color:#aaa;"></span>' +
      '</div>' +
      '<div style="display:flex;flex:1;overflow:hidden;">' +
        '<div style="width:200px;min-width:150px;background:#1e1e2e;border-right:1px solid #333;overflow-y:auto;flex-shrink:0;">' +
          '<div style="padding:12px;font-weight:bold;color:#e0e0e0;border-bottom:1px solid #333;font-size:14px;">📁 项目</div>' +
          '<div id="project-list" style="padding:4px 0;"></div>' +
        '</div>' +
        '<div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">' +
          '<div id="ws-toolbar" style="padding:6px 16px;display:flex;gap:8px;background:#252536;border-bottom:1px solid #333;">' +
            '<button onclick="workspaceManager.createNewFile()" style="background:#333;border:1px solid #444;color:#e0e0e0;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:13px;">📄+ 新建文件</button>' +
            '<button onclick="workspaceManager.createNewDir()" style="background:#333;border:1px solid #444;color:#e0e0e0;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:13px;">📁+ 新建文件夹</button>' +
            '<button onclick="workspaceManager.triggerUpload()" style="background:#333;border:1px solid #444;color:#e0e0e0;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:13px;">📤 上传</button>' +
            deleteBtn +
          '</div>' +
          '<div id="file-list" style="flex:1;overflow-y:auto;padding:8px;"></div>' +
          '<div id="file-preview" style="flex:1;overflow:auto;display:none;flex-direction:column;"></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  async loadProjects() {
    try {
      var resp = await fetch('/api/files/project', { headers: { 'Authorization': 'Bearer ' + this.getToken() } });
      var data = await resp.json();
      this.projects = data.projects || [];
      this.renderProjectList();
    } catch(e) { console.error('loadProjects failed:', e); }
  }

  renderProjectList() {
    var list = document.getElementById('project-list');
    if (!list) return;
    if (this.projects.length === 0) {
      list.innerHTML = '<div style="color:#666;text-align:center;padding:20px;font-size:13px;">暂无项目</div>';
      return;
    }
    var self = this;
    list.innerHTML = '';
    this.projects.forEach(function(p) {
      var div = document.createElement('div');
      div.style.cssText = 'padding:8px 16px;cursor:pointer;color:#aaa;font-size:13px;';
      div.textContent = '📂 ' + p.name;
      div.onmouseover = function() { this.style.background = '#2a2a3e'; };
      div.onmouseout = function() { this.style.background = ''; };
      div.onclick = function() { self.navigate(p.path || p.name); };
      list.appendChild(div);
    });
  }

  async navigate(p) {
    this.currentPath = p;
    this.updateBreadcrumb(p);
    await this.loadFileList(p);
    this.hidePreview();
  }

  updateBreadcrumb(p) {
    var bc = document.getElementById('ws-breadcrumb');
    if (!bc) return;
    if (!p) { bc.innerHTML = ''; return; }
    var parts = p.split('/');
    bc.innerHTML = '';
    var self = this;
    var acc = '';
    parts.forEach(function(part, i) {
      acc = acc ? acc + '/' + part : part;
      if (i > 0) {
        var sep = document.createElement('span');
        sep.style.color = '#666';
        sep.textContent = ' › ';
        bc.appendChild(sep);
      }
      var span = document.createElement('span');
      span.style.cssText = 'cursor:pointer;color:#7c7cff;';
      span.textContent = part;
      var path = acc;
      span.onclick = function() { self.navigate(path); };
      bc.appendChild(span);
    });
  }

  async loadFileList(p) {
    var list = document.getElementById('file-list');
    if (!list) return;
    list.innerHTML = '<div style="color:#666;padding:20px;">加载中...</div>';
    try {
      var resp = await fetch('/api/files/list?path=' + encodeURIComponent(p) + '&depth=1', { headers: { 'Authorization': 'Bearer ' + this.getToken() } });
      var data = await resp.json();
      if (data.error) { list.innerHTML = '<div style="color:#e94560;padding:20px;">' + this.esc(data.error) + '</div>'; return; }
      var entries = data.entries || [];
      if (entries.length === 0) { list.innerHTML = '<div style="color:#666;padding:20px;font-size:13px;">空目录</div>'; return; }
      entries.sort(function(a, b) { return a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name); });
      list.innerHTML = '';
      var self = this;
      entries.forEach(function(e) {
        var icon = e.type === 'dir' ? '📁' : self.icon(e.name);
        var div = document.createElement('div');
        div.style.cssText = 'display:flex;align-items:center;padding:6px 12px;cursor:pointer;gap:10px;border-radius:4px;';
        div.innerHTML = '<span style="font-size:16px;">' + icon + '</span><span style="flex:1;font-size:13px;color:#e0e0e0;">' + self.esc(e.name) + '</span>' + (e.type === 'file' ? '<span style="font-size:11px;color:#666;">' + self.fmtSize(e.size) + '</span>' : '');
        div.onmouseover = function() { this.style.background = '#2a2a3e'; };
        div.onmouseout = function() { this.style.background = ''; };
        if (e.type === 'dir') {
          div.onclick = function() { self.navigate(e.path); };
        } else {
          var fp = e.path;
          div.onclick = function() { self.previewFile(fp); };
        }
        list.appendChild(div);
      });
    } catch(e) { list.innerHTML = '<div style="color:#e94560;padding:20px;">加载失败</div>'; }
  }

  async previewFile(filePath) {
    var preview = document.getElementById('file-preview');
    var fileList = document.getElementById('file-list');
    var toolbar = document.getElementById('ws-toolbar');
    if (!preview) return;
    // Show preview, hide file list
    if (fileList) fileList.style.display = 'none';
    preview.style.display = 'flex';
    preview.innerHTML = '<div style="color:#666;padding:20px;">加载中...</div>';

    try {
      var resp = await fetch('/api/files/read?path=' + encodeURIComponent(filePath), { headers: { 'Authorization': 'Bearer ' + this.getToken() } });
      var data = await resp.json();
      if (data.error) { preview.innerHTML = '<div style="color:#e94560;padding:20px;">' + this.esc(data.error) + '</div>'; return; }

      var content = data.content || '';
      var fileName = filePath.split('/').pop();
      var ext = fileName.split('.').pop().toLowerCase();

      // Build header with back button and file info
      var header = '<div style="display:flex;align-items:center;padding:8px 12px;background:#1e1e2e;border-bottom:1px solid #333;gap:8px;flex-shrink:0;">' +
        '<button onclick="workspaceManager.hidePreview()" style="background:#333;border:1px solid #444;color:#e0e0e0;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:13px;">← 返回列表</button>' +
        '<span style="color:#7c7cff;font-size:13px;font-weight:bold;">' + this.icon(fileName) + ' ' + this.esc(fileName) + '</span>' +
        '<span style="color:#666;font-size:11px;">' + this.fmtSize(data.size || content.length) + '</span>' +
        (this.userRole === 'boss' ? '<button onclick="workspaceManager.editFile(\'' + this.esc(filePath) + '\')" style="background:#333;border:1px solid #444;color:#e0e0e0;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:13px;margin-left:auto;">✏️ 编辑</button>' : '') +
      '</div>';

      // Render content based on file type
      var body = '';
      if (ext === 'md') {
        // Markdown: render as formatted HTML
        body = '<div style="flex:1;overflow:auto;padding:20px;color:#e0e0e0;line-height:1.6;font-size:14px;">' + this.renderMarkdown(content) + '</div>';
      } else if (['js','ts','py','css','html','json','yaml','yml','sh','bash','sql','java','c','cpp','h','go','rs','rb','php'].indexOf(ext) >= 0) {
        // Code files: show with line numbers
        body = '<div style="flex:1;overflow:auto;padding:0;background:#111;">' + this.renderCode(content, ext) + '</div>';
      } else if (['png','jpg','jpeg','gif','svg','webp','bmp'].indexOf(ext) >= 0) {
        // Images
        body = '<div style="flex:1;overflow:auto;padding:20px;text-align:center;"><img src="/api/files/download?path=' + encodeURIComponent(filePath) + '" style="max-width:100%;max-height:100%;border-radius:4px;"></div>';
      } else if (['xlsx','xls','csv'].indexOf(ext) >= 0) {
        // Spreadsheet hint
        body = '<div style="flex:1;overflow:auto;padding:20px;"><div style="color:#aaa;font-size:13px;">📊 表格文件，原始内容：</div><pre style="color:#e0e0e0;font-size:12px;white-space:pre-wrap;margin-top:10px;">' + this.esc(content.substring(0, 5000)) + '</pre></div>';
      } else {
        // Plain text
        body = '<div style="flex:1;overflow:auto;padding:20px;"><pre style="color:#e0e0e0;font-size:13px;white-space:pre-wrap;word-break:break-all;">' + this.esc(content) + '</pre></div>';
      }

      preview.innerHTML = header + body;
      this.currentFileVersion = data.version || 0;
    } catch(e) {
      preview.innerHTML = '<div style="color:#e94560;padding:20px;">加载失败: ' + this.esc(e.message) + '</div>';
    }
  }

  renderMarkdown(text) {
    // Simple markdown renderer
    var html = this.esc(text);
    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3 style="color:#7c7cff;margin:16px 0 8px;">$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2 style="color:#7c7cff;margin:20px 0 10px;">$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1 style="color:#e94560;margin:24px 0 12px;">$1</h1>');
    // Bold and italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre style="background:#111;padding:12px;border-radius:4px;overflow-x:auto;font-size:12px;margin:8px 0;">$2</pre>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code style="background:#333;padding:2px 6px;border-radius:3px;font-size:12px;">$1</code>');
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#7c7cff;" target="_blank">$1</a>');
    // Lists
    html = html.replace(/^- (.+)$/gm, '<div style="padding-left:16px;">• $1</div>');
    html = html.replace(/^\* (.+)$/gm, '<div style="padding-left:16px;">• $1</div>');
    // Paragraphs (double newline)
    html = html.replace(/\n\n/g, '</p><p style="margin:8px 0;">');
    // Single newline
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  renderCode(text, lang) {
    var lines = text.split('\n');
    var html = '<table style="width:100%;border-collapse:collapse;font-size:13px;font-family:monospace;">';
    for (var i = 0; i < lines.length; i++) {
      html += '<tr><td style="color:#555;padding:0 12px;text-align:right;user-select:none;border-right:1px solid #333;min-width:40px;">' + (i+1) + '</td><td style="padding:0 12px;color:#e0e0e0;white-space:pre;">' + this.esc(lines[i]) + '</td></tr>';
    }
    html += '</table>';
    return html;
  }

  async editFile(filePath) {
    var preview = document.getElementById('file-preview');
    if (!preview) return;
    try {
      var resp = await fetch('/api/files/read?path=' + encodeURIComponent(filePath), { headers: { 'Authorization': 'Bearer ' + this.getToken() } });
      var data = await resp.json();
      if (data.error) { alert(data.error); return; }

      var content = data.content || '';
      var fileName = filePath.split('/').pop();

      var header = '<div style="display:flex;align-items:center;padding:8px 12px;background:#1e1e2e;border-bottom:1px solid #333;gap:8px;flex-shrink:0;">' +
        '<button onclick="workspaceManager.previewFile(\'' + this.esc(filePath) + '\')" style="background:#333;border:1px solid #444;color:#e0e0e0;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:13px;">← 取消</button>' +
        '<span style="color:#e94560;font-size:13px;font-weight:bold;">✏️ 编辑: ' + this.esc(fileName) + '</span>' +
        '<button onclick="workspaceManager.saveFile(\'' + this.esc(filePath) + '\')" style="background:#2d8b2d;border:1px solid #3a3;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:13px;margin-left:auto;">💾 保存</button>' +
      '</div>';

      var body = '<div style="flex:1;overflow:hidden;display:flex;"><textarea id="ws-editor" style="flex:1;background:#111;color:#e0e0e0;border:none;padding:12px;font-size:13px;font-family:monospace;resize:none;outline:none;line-height:1.5;" spellcheck="false">' + this.esc(content) + '</textarea></div>';

      preview.innerHTML = header + body;
      this.currentFileVersion = data.version || 0;
    } catch(e) { alert('加载失败'); }
  }

  async saveFile(filePath) {
    var editor = document.getElementById('ws-editor');
    if (!editor) return;
    var content = editor.value;
    try {
      var resp = await fetch('/api/files/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.getToken() },
        body: JSON.stringify({ path: filePath, content: content, version: this.currentFileVersion })
      });
      var data = await resp.json();
      if (data.error) { alert('保存失败: ' + data.error); return; }
      alert('保存成功！');
      this.previewFile(filePath);
    } catch(e) { alert('保存失败'); }
  }

  hidePreview() {
    var preview = document.getElementById('file-preview');
    var fileList = document.getElementById('file-list');
    if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
    if (fileList) fileList.style.display = '';
  }

  async createNewFile() {
    var name = prompt('文件名：'); if (!name) return;
    var fp = this.currentPath ? this.currentPath + '/' + name : name;
    var resp = await fetch('/api/files/write', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.getToken() }, body: JSON.stringify({ path: fp, content: '' }) });
    var data = await resp.json();
    if (data.error) alert(data.error); else await this.loadFileList(this.currentPath);
  }

  async createNewDir() {
    var name = prompt('文件夹名：'); if (!name) return;
    var dp = this.currentPath ? this.currentPath + '/' + name : name;
    var resp = await fetch('/api/files/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.getToken() }, body: JSON.stringify({ path: dp }) });
    var data = await resp.json();
    if (data.error) alert(data.error); else await this.loadFileList(this.currentPath);
  }

  async deleteSelected() {
    if (!this.currentPath) { alert('请先进入要删除的目录'); return; }
    var name = this.currentPath.split('/').pop();
    if (!confirm('确定要删除「' + name + '」吗？')) return;
    var resp = await fetch('/api/files/delete?path=' + encodeURIComponent(this.currentPath), { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + this.getToken() } });
    var data = await resp.json();
    if (data.error) { alert('删除失败: ' + data.error); return; }
    alert('已删除');
    var parts = this.currentPath.split('/');
    parts.pop();
    this.navigate(parts.join('/'));
  }

  triggerUpload() {
    var input = document.createElement('input'); input.type = 'file'; input.multiple = true;
    var self = this;
    input.onchange = function() { self.uploadFiles(input.files); }; input.click();
  }

  async uploadFiles(files) {
    var project = this.currentPath.split('/')[0];
    if (!project) { alert('请先进入一个项目'); return; }
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var relPath = this.currentPath.indexOf('/') >= 0 ? this.currentPath.substring(this.currentPath.indexOf('/') + 1) + '/' + file.name : file.name;
      var fd = new FormData(); fd.append('file', file); fd.append('path', relPath); fd.append('project', project);
      var resp = await fetch('/api/files/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + this.getToken() }, body: fd });
      var data = await resp.json();
      if (data.error) alert('上传失败: ' + data.error);
    }
    await this.loadFileList(this.currentPath);
  }

  handleFileNotification(d) {
    var map = { upload: '上传了', write: '修改了', delete: '删除了', mkdir: '创建了目录' };
    if (window.appendMessage) window.appendMessage({ type: 'system', content: '📢 ' + d.user + '(' + d.role + ') ' + (map[d.action]||d.action) + '：' + d.path });
  }

  static renderFileLinks(text) { return text; }
  switchToWorkspace() { switchTab('workspace'); }

  getToken() { return localStorage.getItem('shrimp-token') || ''; }
  esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }
  icon(n) { var e=n.split('.').pop().toLowerCase(); return {js:'📜',ts:'📜',py:'🐍',css:'🎨',html:'🌐',json:'📋',md:'📝',txt:'📄',xlsx:'📊',png:'🖼️',jpg:'🖼️',svg:'🖼️',zip:'📦',pdf:'📕'}[e]||'📄'; }
  fmtSize(b) { return b<1024?b+'B':b<1048576?(b/1024).toFixed(1)+'KB':(b/1048576).toFixed(1)+'MB'; }
}

window.WorkspaceManager = WorkspaceManager;
