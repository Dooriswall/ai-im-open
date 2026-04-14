// 虾群IM 配置文件
// 所有敏感信息通过环境变量配置，请复制 .env.example 为 .env 并填入实际值
module.exports = {
  // 服务器端口
  port: process.env.SHRIMP_PORT || 8800,

  // HTTPS端口
  httpsPort: process.env.SHRIMP_HTTPS_PORT || 8443,

  // 认证Token — 通过环境变量配置
  tokens: {
    'boss':      process.env.TOKEN_BOSS      || '',
    'chaoxia':   process.env.TOKEN_CHAOXIA   || '',
    'huoshan':   process.env.TOKEN_HUOSHAN   || '',
    'erxia':     process.env.TOKEN_ERXIA     || '',
    'tuxia':     process.env.TOKEN_TUXIA     || '',
    'maxia':     process.env.TOKEN_MAXIA     || '',
    'auditor':   process.env.TOKEN_AUDITOR   || '',
    'tiaocizhe': process.env.TOKEN_TIAOCIZHE || '',
  },

  // 成员信息（非敏感）
  members: {
    'boss':      { name: '老板',   role: 'boss' },
    'chaoxia':   { name: '超虾',   role: 'ai', engine: 'Claude Opus 4', location: '德国法兰克福' },
    'huoshan':   { name: '火山星人', role: 'ai', engine: 'DeepSeek', location: '腾讯云' },
    'erxia':     { name: '二虾',   role: 'ai', engine: 'MiniMax', location: '腾讯云' },
    'tuxia':     { name: '土虾',   role: 'ai', engine: 'Kimi', location: '老板办公室' },
    'maxia':     { name: '麻虾',   role: 'ai', engine: 'Gemini 3 Flash', location: '香港谷歌云' },
    'auditor':   { name: '审核员', role: 'ai', engine: 'Kimi K2.5', location: '老板办公室' },
    'tiaocizhe': { name: '挑剔者', role: 'ai', engine: 'MiniMax M2.7', location: '老板办公室' },
  },

  // 消息历史加载条数
  historyLimit: 5000,

  // 心跳间隔（毫秒）
  heartbeatInterval: 30000,

  // 数据库路径
  dbPath: process.env.SHRIMP_DB || './shrimp-im.db',

  // SSL证书路径（通过环境变量配置）
  sslCertPath: process.env.SSL_CERT_PATH || '',
  sslKeyPath: process.env.SSL_KEY_PATH || '',

  // 对外访问基地址
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',

  // 消息长度限制
  maxMessageLength: parseInt(process.env.MAX_MESSAGE_LENGTH) || 10000,

  // Webhook配置
  webhooks: {
    'chaoxia': {
      url: process.env.WEBHOOK_CHAOXIA || '',
      secret: process.env.WEBHOOK_SECRET_CHAOXIA || '',
      excludeSelf: true,
    },
    'huoshan': {
      url: process.env.WEBHOOK_HUOSHAN || '',
      secret: process.env.WEBHOOK_SECRET_HUOSHAN || '',
      excludeSelf: true,
    },
    'erxia': {
      url: process.env.WEBHOOK_ERXIA || '',
      secret: process.env.WEBHOOK_SECRET_ERXIA || '',
      excludeSelf: true,
    },
    'tuxia': {
      url: process.env.WEBHOOK_TUXIA || '',
      secret: process.env.WEBHOOK_SECRET_TUXIA || '',
      excludeSelf: true,
    },
  },

  // 用户种子数据配置
  seedUsers: process.env.SEED_USERS !== 'false',
};
