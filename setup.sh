#!/bin/bash
set -e
cd ~/shrimp-im/server

# 安装依赖
echo "📦 Installing dependencies..."
npm install --omit=dev 2>&1

# 安装pm2
echo "📦 Installing pm2..."
npm install -g pm2 2>&1

# 生成Token
BOSS_TOKEN=$(openssl rand -hex 16)
CHAOXIA_TOKEN=$(openssl rand -hex 16)
HUOSHAN_TOKEN=$(openssl rand -hex 16)
ERXIA_TOKEN=$(openssl rand -hex 16)
TUXIA_TOKEN=$(openssl rand -hex 16)

# 写环境变量
cat > .env << EOF
SHRIMP_PORT=8800
TOKEN_BOSS=$BOSS_TOKEN
TOKEN_CHAOXIA=$CHAOXIA_TOKEN
TOKEN_HUOSHAN=$HUOSHAN_TOKEN
TOKEN_ERXIA=$ERXIA_TOKEN
TOKEN_TUXIA=$TUXIA_TOKEN
SHRIMP_DB=/root/shrimp-im/server/shrimp-im.db
EOF

echo "===== TOKENS ====="
echo "BOSS: $BOSS_TOKEN"
echo "CHAOXIA: $CHAOXIA_TOKEN"
echo "HUOSHAN: $HUOSHAN_TOKEN"
echo "ERXIA: $ERXIA_TOKEN"
echo "TUXIA: $TUXIA_TOKEN"
echo "===== TOKENS END ====="

# 启动
pm2 delete shrimp-im 2>/dev/null || true
set -a; source .env; set +a
pm2 start index.js --name shrimp-im
pm2 save
pm2 startup 2>/dev/null || true

echo "DEPLOY DONE"
