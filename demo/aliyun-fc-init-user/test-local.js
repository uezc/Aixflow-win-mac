/**
 * 本地测试（需先启动 PostgreSQL 或 mock）
 * node test-local.js
 */
const http = require('http');

const BODY = JSON.stringify({ username: 'test-machine-id-001' });

const req = http.request(
  {
    hostname: 'localhost',
    port: process.env.PORT || 9000,
    path: '/init-user',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': BODY.length },
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => console.log(res.statusCode, data));
  }
);
req.on('error', (e) => console.error(e));
req.write(BODY);
req.end();
