# TASKS.md v2 - 虾群IM文件管理系统

## [项目边界]
1. 不做独立部署，嵌入现有虾群IM
2. 不做数据库迁移，文件元数据用sql.js
3. 不做实时协同编辑（只做只读预览+权限写入）
4. 不做版本控制（文件历史只记录操作日志）

## [技术栈]
- 后端：Node.js + Express + sql.js + ws（现有）
- 前端：原生JS + CSS（与现有index.html风格一致）
- 文件预览：Prism.js（代码高亮）+ marked.js（Markdown）+ SheetJS（Excel）

## [安全加固]（采纳挑剔者意见）

### S0: 路径穿越防护
- 所有path参数必须经过sanitize：禁止`../`、绝对路径、空字节
- 校验path在workspace根目录内，否则返回403
- 使用path.resolve + startsWith双重校验

### S1: XSS防护
- 文件预览使用沙箱iframe（sandbox属性）隔离
- 聊天文件链接只允许项目内路径，过滤javascript:协议
- 文件名过滤特殊字符，防止注入

### S2: 权限校验全在后端
- 前端只做UI禁用（灰显按钮），后端必须独立校验
- 每个文件API都要经过authMiddleware + permissionMiddleware

### S3: 文件大小与存储限制
- 单文件上传限制50MB（现有multer配置）
- 项目总存储配额500MB
- 文件名长度限制255字符

## [执行步骤]

### Task 0: 后端 - 文件系统数据模型与API框架
- 新建 `server/filesystem.js` 模块
- 数据库表：`projects`（项目）、`files`（文件元数据）、`file_ops`（操作日志）
- 项目标准结构：src/、docs/、reviews/、tasks/、README.md
- API路由骨架：`/api/files/tree`、`/api/files/list`、`/api/files/read`、`/api/files/write`、`/api/files/mkdir`、`/api/files/delete`、`/api/files/history`、`/api/files/upload`
- 验证：`curl /api/files/tree` 返回空项目列表

### Task 1: 后端 - 路径安全与权限校验
- 新建 `server/permissions.js` 模块
- 路径sanitize函数：过滤`../`、绝对路径、空字节
- 权限矩阵：
  - read：所有人 ✅
  - write：智虾→src/+docs/（非reviews/）、审核员/挑剔者→reviews/下自己的文件、火山星人→reviews/下审批文件、老板→全部
  - mkdir：智虾+老板
  - delete：仅老板
- 后端中间件集成（不依赖前端）
- 验证：路径穿越返回403，无权限写操作返回403

### Task 2: 后端 - 文件CRUD操作实现
- `GET /api/files/tree`：返回完整目录树（递归，路径校验）
- `GET /api/files/list?path=`：列出目录内容（名称、大小、类型、修改时间）
- `GET /api/files/read?path=`：读取文件内容（文本返回内容，二进制返回base64）
- `POST /api/files/write`：写入文件（body: {path, content}，权限校验）
- `POST /api/files/mkdir`：创建目录（权限校验）
- `DELETE /api/files/delete?path=`：删除文件/目录（仅老板）
- 物理文件存储：`server/workspace/{projectName}/` 目录
- 验证：完整CRUD流程测试

### Task 3: 后端 - 文件上传与历史记录
- `POST /api/files/upload`：multer上传，指定目标项目+路径
- `GET /api/files/history?path=`：返回操作日志（谁、何时、做了什么）
- 操作日志写入 `file_ops` 表
- 文件上传后自动发聊天通知（WebSocket广播）
- 验证：上传xlsx文件，history返回操作记录

### Task 4: 后端 - 项目初始化与管理
- `POST /api/files/project`：创建项目（生成标准目录结构src/docs/reviews/tasks/）
- `GET /api/files/project`：列出所有项目
- 项目创建时自动生成README.md
- 验证：创建项目后tree返回标准结构

### Task 5: 前端 - 工作台Tab与布局
- 在index.html顶部Tab栏添加「📁 工作台」按钮
- 工作台布局：左侧项目导航树 + 右侧文件列表/预览区
- 面包屑导航（工作台 > 虾群IM > src）
- Tab切换：💬聊天 / 📁工作台
- 验证：点击工作台Tab显示文件管理界面

### Task 6: 前端 - 目录树与文件列表
- 左侧：递归渲染项目目录树（点击展开/折叠）
- 右侧：点击目录显示文件列表（图标区分文件类型）
- 文件列表字段：图标、名称、大小、修改时间
- 验证：点击项目展开目录，点击目录显示文件列表

### Task 7: 前端 - 文件预览（XSS安全）
- 代码文件（.py .js .ts .css .html）：Prism.js代码高亮
- Markdown（.md）：marked.js渲染
- Excel（.xlsx .csv）：SheetJS表格渲染
- 图片（.png .jpg .svg）：img标签预览
- JSON/YAML：格式化显示
- 所有预览在sandbox iframe内隔离
- 只读模式标注当前编辑者
- 验证：点击各类型文件正确预览，XSS payload被隔离

### Task 8: 前端 - 文件操作（上传、新建、编辑）
- 拖拽上传文件
- 新建文件/文件夹按钮
- 代码文件编辑器（简单textarea + 保存按钮）
- 操作前权限检查（无权限按钮灰显，后端也校验）
- 验证：上传文件、新建文件、编辑保存

### Task 9: 聊天与文件系统联动
- 聊天中文件路径（如 `虾群IM/src/main.py`）自动变成可点击链接
- 点击链接跳转到工作台并打开对应文件
- 文件操作（上传、写入、删除）自动发聊天通知
- 文件链接过滤：只允许项目内路径，禁止javascript:协议
- 验证：聊天中出现文件路径可点击，XSS链接被过滤

### Task 10: 集成测试与文档
- 后端API测试（路径穿越、权限校验、CRUD、上传、XSS）
- 前端功能测试
- README更新：文件系统API文档、权限矩阵说明
- 验证：npm test通过
