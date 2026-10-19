/* 의존성 없는 로컬 정적 서버. file:// 로도 동작하지만(에셋 base64 내장), 같은 와이파이의 폰에서
 * 열어보려면 이걸 띄운다:  node tools/serve.js [port]  →  http://<PC-IP>:8080/
 * (폰 접속이 안 되면 Windows 방화벽의 Node.js 인바운드 규칙을 확인 — MINIGAME_BUILD_TEMPLATE §7-4) */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2]) || 8080;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.md': 'text/plain; charset=utf-8',
};

http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, '0.0.0.0', () => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  console.log('사과 깎기 dev server');
  console.log('  PC   : http://localhost:' + PORT + '/');
  ips.forEach((ip) => console.log('  phone: http://' + ip + ':' + PORT + '/'));
});
