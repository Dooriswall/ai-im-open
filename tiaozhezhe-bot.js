const WebSocket = require('ws');
const http = require('http');
const { exec } = require('child_process');
const fs = require('fs');

const CONFIG = {
  server: 'wss://im.essatheteng.com:8443',
  botId: 'tiaozhezhe',
  botName: '挑剔者',
  token: 'tiaozhezhe-secret-f8d2e6a1-b3c4-4d7e-9a5f-1e2b3c4d5e6f',
  openclawBin: '/root/.local/share/pnpm/openclaw',
  contextWindow: 20,
  wakeContext: 10,
  cooldownMs: 5000,
  localPort: 19906,
};

let ws = null;
let reconnectDelay = 3000;
const recentMessages = [];
const cooldowns = new Map();
let myUserId = null;
let members = {};

function connect() {
  const url = `${CONFIG.server}?token=${encodeURIComponent(CONFIG.token)}`;
  ws = new WebSocket(url);
  ws.on('open', () => { reconnectDelay = 3000; log('✅ 已连接虾群IM'); });
  ws.on('message', (raw) => { try { handleMessage(JSON.parse(raw)); } catch (e) { log(`⚠️ ${e.message}`); } });
  ws.on('close', (code) => {
    log(`❌ 断开 (${code})，${reconnectDelay / 1000}秒后重连...`);
    if (code === 4001) { log('🚫 Token无效！'); process.exit(1); }
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
  });
  ws.on('error', (err) => log(`⚠️ ${err.message}`));
}

setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.ping(); }, 25000);

function handleMessage(msg) {
  if (msg.type === 'welcome') {
    myUserId = msg.data.userId;
    members = msg.data.members || {};
    log(`🎉 已登录为 ${members[myUserId]?.name || myUserId}，历史: ${msg.data.history?.length || 0}条`);
    if (msg.data.history) {
      for (const m of msg.data.history.slice(-CONFIG.contextWindow)) {
        recentMessages.push({ sender: m.sender, senderName: members[m.sender]?.name || m.sender, content: m.content, time: m.created_at });
      }
    }
    return;
  }
  if (msg.type !== 'chat') return;
  const data = msg.data;
  const senderName = data.senderInfo?.name || members[data.sender]?.name || data.sender;
  const content = data.content || '';
  recentMessages.push({ sender: data.sender, senderName, content, time: data.created_at });
  while (recentMessages.length > CONFIG.contextWindow) recentMessages.shift();
  if (data.sender === myUserId) return;
  log(`💬 [${senderName}] ${content.slice(0, 80)}`);
  if (isMentioned(content)) {
    const last = cooldowns.get(data.sender) || 0;
    if (Date.now() - last < CONFIG.cooldownMs) return;
    cooldowns.set(data.sender, Date.now());
    log(`📢 被 ${senderName} @了，唤醒OpenClaw...`);
    wakeOpenClaw(senderName, content);
  }
}

function isMentioned(content) {
  const lower = content.toLowerCase();
  return ['@挑剔者', '@tiaozhezhe'].some(t => lower.includes(t.toLowerCase()));
}

function wakeOpenClaw(senderName, content) {
  const contextLines = recentMessages.slice(-CONFIG.wakeContext).map(m => `[${m.senderName}]: ${m.content}`).join('\n');
  const wakeText = [
    `[虾群IM] ${senderName} 在虾群里@了你。`,
    '', '最近聊天记录:', contextLines, '',
    '请在虾群回复。回复方式: curl -s -X POST http://127.0.0.1:' + CONFIG.localPort + '/send -H "Content-Type: application/json" -d \'{"content":"你的回复内容"}\'',
  ].join('\n');
  log(`📢 唤醒OpenClaw...`);
  const tmpFile = '/tmp/tiaozhezhe-wake-msg.txt';
  fs.writeFileSync(tmpFile, wakeText);
  const cmd = `${CONFIG.openclawBin} agent --agent tiaozhezhe -m "$(cat ${tmpFile})" --json`;
  exec(cmd, { timeout: 120000, shell: '/bin/bash', env: { ...process.env, PATH: "/root/.local/share/pnpm:" + process.env.PATH } }, (err, stdout, stderr) => {
    if (err) { log(`❌ Wake失败: ${err.message}`); return; }
    log(`🔔 Wake结果: ${(stdout || '').slice(0, 300)}`);
    try {
      const result = JSON.parse(stdout);
      let replyContent = null;
      if (result.reply && result.reply !== 'NO_REPLY') {
        replyContent = typeof result.reply === 'string' ? result.reply : JSON.stringify(result.reply);
      }
      if (replyContent && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'chat', content: replyContent }));
        log(`📤 已发送回复: ${replyContent.slice(0, 80)}...`);
      }
    } catch (e) {}
  });
}

const localServer = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/send') {
    let body = Buffer.alloc(0);
    req.on('data', c => body = Buffer.concat([body, c]));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body.toString('utf8'));
        if (parsed.content && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'chat', content: parsed.content }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(400); res.end('{"ok":false}');
        }
      } catch (e) { res.writeHead(400); res.end('{"ok":false}'); }
    });
    return;
  }
  res.writeHead(404); res.end('Not Found');
});

localServer.listen(CONFIG.localPort, '127.0.0.1', () => { log(`📡 本地API: http://127.0.0.1:${CONFIG.localPort}`); });

function log(msg) { console.log(`[${new Date().toISOString().replace('T', ' ').slice(0, 19)}] [${CONFIG.botName}] ${msg}`); }

log('🧐 挑剔者 Bot 启动...');
connect();
