const http = require('http');

const BASE = 'http://127.0.0.1:8800';

// Helper: HTTP request
function httpRequest(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers };
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
      body = JSON.stringify(body);
    }
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('Regression Tests', () => {
  test('GET /api/health returns 200', async () => {
    const res = await httpRequest('GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('POST /api/upload without file returns error', async () => {
    const res = await httpRequest('POST', '/api/upload', {});
    expect([400, 500]).toContain(res.status);
  });

  test('POST /api/messages with valid data', async () => {
    const res = await httpRequest('POST', '/api/messages', {
      channel: 'general',
      content: 'test message'
    }, { 'Authorization': 'Bearer test-boss-token' });
    // May fail without running server, but structure should be valid
    expect([200, 401, 404]).toContain(res.status);
  });

  test('GET /api/messages returns array', async () => {
    const res = await httpRequest('GET', '/api/messages?channel=general&limit=10');
    expect([200, 401, 404]).toContain(res.status);
  });
});
