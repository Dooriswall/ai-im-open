const fs = require('fs');
const path = require('path');
const envFile = path.join(__dirname, '.env');
const env = {};
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) env[k.trim()] = v.join('=').trim();
  });
}
module.exports = {
  apps: [{
    name: 'shrimp-im',
    script: 'index.js',
    cwd: __dirname,
    env: env,
    autorestart: true,
    max_restarts: 50,
  }]
};
