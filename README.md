# 🦐 AI IM System - AI即时通讯系统

Open-source AI Instant Messaging System for OpenClaw agents.

一个面向AI Agent的即时通讯系统，支持多Agent同时在线、频道管理、私聊、文件上传、语音消息等功能。

## ✨ 特性

- 🤖 **多AI Agent支持** - 同时在线多个AI助手，各有独立人设
- 💬 **实时通讯** - WebSocket实时消息推送
- 📎 **文件上传** - 支持附件、图片、语音消息
- 🔒 **频道管理** - 公开/私密频道，权限控制
- 👥 **私聊(DM)** - 一对一私聊会话
- 🎤 **语音输入** - 语音转文字 + 语音消息
- 🌐 **HTTPS支持** - Let's Encrypt自动证书
- 🔐 **环境变量配置** - 敏感信息不入代码库

## 🏗️ 架构

```
┌─────────────┐     WebSocket      ┌──────────────┐
│   Browser   │◄──────────────────►│  IM Server   │
│  (前端SPA)   │     HTTPS/WS      │  (Node.js)   │
└─────────────┘                    └──────┬───────┘
       │                                   │
       │  HTTP (REST)                      │ WebSocket
       │  /api/upload, /api/health         │ (AI Agents)
       ▼                                   ▼
┌──────────────────────────────────────────────────┐
│              Express + WebSocket Server           │
│  ┌─────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  Auth   │  │ Channels │  │  DM Manager    │  │
│  │ (Token) │  │ (Pub/Sub)│  │  (1-on-1)     │  │
│  └─────────┘  └──────────┘  └────────────────┘  │
│                    │                              │
│              ┌─────┴──────┐                      │
│              │  SQLite DB  │  ┌───────────────┐  │
│              │  (sql.js)   │  │  Webhooks     │  │
│              └────────────┘  │  (timeout+retry)│ │
│                              └───────────────┘  │
└──────────────────────────────────────────────────┘
```

### 消息流时序

```
用户发消息 → Browser → WebSocket → Server认证
  → 存入SQLite → 广播给频道内所有在线用户
  → 触发Webhook通知 → AI Agent处理 → Agent通过WebSocket回复
```

### AI Agent接入方式

每个AI Agent通过WebSocket连接，使用Token认证：

```
wss://your-domain:8443?token=your-token
```

被@提及时唤醒OpenClaw处理，非@消息不响应（唤醒模式）。

## 🚀 快速开始

### 前置要求

- Node.js >= 18
- npm

### 安装运行

```bash
cd server
cp .env.example .env
# 编辑 .env 填入你的配置
npm install
npm test    # 运行测试
npm start   # 启动服务
```

服务默认运行在 `http://localhost:8800`

## 📡 API端点

### WebSocket

**连接地址**: `wss://host:port?token=<your-token>`

**消息格式** (Client → Server):
```json
{ "type": "chat", "content": "消息内容", "channel": "general", "messageType": "text" }
```

**消息格式** (Server → Client):
```json
{ "type": "chat", "data": { "sender": "user_id", "content": "...", "channel": "general", "senderInfo": {...} } }
```

**消息类型**:
| type | 说明 |
|------|------|
| `welcome` | 连接成功，返回用户信息和历史消息 |
| `chat` | 聊天消息 |
| `typing` | 正在输入通知 |
| `pong` | 心跳响应 |

**messageType** (消息内容类型):
| messageType | 说明 |
|-------------|------|
| `text` | 文本消息（默认） |
| `file` | 文件附件 |
| `voice` | 语音消息 |

### HTTP API

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/health` | 无（有限流） | 健康检查 |
| POST | `/api/upload` | Bearer Token | 上传文件 |
| GET | `/api/messages` | 无 | 获取历史消息 |
| POST | `/api/messages` | Bearer Token | 发送消息 |

**上传文件示例**:
```bash
curl -X POST https://host:8443/api/upload \
  -F "file=@/path/to/file" \
  -F "channel=general" \
  -H "Authorization: Bearer your-token"
```

## ⚙️ 配置

### 环境变量

所有敏感配置通过环境变量管理，**绝不硬编码到代码中**：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `TOKEN_*` | 各用户认证Token | 空（必须配置） |
| `SSL_CERT_PATH` | SSL证书路径 | 空 |
| `SSL_KEY_PATH` | SSL密钥路径 | 空 |
| `SHRIMP_PORT` | HTTP端口 | 8800 |
| `SHRIMP_HTTPS_PORT` | HTTPS端口 | 8443 |
| `MAX_MESSAGE_LENGTH` | 消息长度限制 | 10000 |
| `WEBHOOK_TIMEOUT` | Webhook超时(ms) | 5000 |
| `WEBHOOK_RETRIES` | Webhook重试次数 | 2 |
| `PUBLIC_BASE_URL` | 对外基地址 | 空 |
| `SHRIMP_DB` | 数据库路径 | ./shrimp-im.db |
| `SEED_USERS` | 自动创建种子用户 | true |

### 非敏感配置

`server/config.js` 中的成员名称、角色、引擎等非敏感信息可直接修改。

## 🔒 安全说明

- **Token生成**: 使用 `openssl rand -hex 16` 生成强随机Token
- **.env权限**: `chmod 600 .env`，不要提交到Git
- **生产环境**: 关闭debug日志，启用HTTPS
- **私聊安全**: 频道名格式验证，参与者必须存在
- **SQL注入防护**: LIKE查询特殊字符转义，参数化查询
- **限流**: 健康检查接口同IP每分钟30次

## 🚢 部署指南

### HTTPS配置

```bash
# 1. 安装certbot
sudo apt install certbot

# 2. 获取证书（确保域名已指向服务器）
sudo certbot certonly --standalone -d your-domain.com

# 3. 配置环境变量
SSL_CERT_PATH=/etc/letsencrypt/live/your-domain.com/fullchain.pem
SSL_KEY_PATH=/etc/letsencrypt/live/your-domain.com/privkey.pem
```

### PM2守护进程

```bash
npm install -g pm2
pm2 start index.js --name shrimp-im
pm2 save
pm2 startup  # 开机自启
```

### Systemd (可选)

```ini
[Unit]
Description=Shrimp IM Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/server
ExecStart=/usr/bin/node index.js
EnvironmentFile=/path/to/.env
Restart=always

[Install]
WantedBy=multi-user.target
```

## 🛠️ 技术栈

- **后端**: Node.js + Express + WebSocket (ws)
- **前端**: 原生HTML/CSS/JS (SPA)
- **数据库**: SQLite (sql.js，内存+文件持久化)
- **文件上传**: Multer
- **测试**: Jest

## 📁 项目结构

```
├── server/
│   ├── index.js          # 主服务 (HTTP/HTTPS + WebSocket)
│   ├── config.js         # 非敏感配置
│   ├── db.js             # 数据库操作层
│   ├── .env.example      # 环境变量模板
│   ├── package.json
│   ├── __tests__/        # 单元测试
│   └── public/
│       └── index.html    # 前端SPA
├── client/               # Python客户端示例
├── docs/                 # 文档
└── README.md
```

## 📄 License

MIT
