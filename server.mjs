import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { RoomStore, UserError, assert } from './lib/rooms.mjs';
import { gameAdapter } from './lib/game.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'], '/roles.js': ['roles.js', 'text/javascript'] };
async function readBody(req) {
  assert(req.headers['content-type']?.includes('application/json'), '需要 JSON 请求', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length; assert(size <= 8192, '请求过大', 413); chunks.push(chunk);
  }
  try { const value = JSON.parse(Buffer.concat(chunks).toString()); assert(value && typeof value === 'object' && !Array.isArray(value), '请求内容无效'); return value; }
  catch (e) { if (e instanceof UserError) throw e; throw new UserError('JSON 格式不正确'); }
}
export function makeServer(store) {
  const rates = new Map();
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/health' && req.method === 'GET') { send(200, { ok: true, mode: 'local-prototype' }); return; }
      if (url.pathname.startsWith('/api/')) {
        const origin = req.headers.origin;
        if (origin) assert(origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`, '不接受其他网站的请求', 403);
        const token = req.headers.authorization?.replace(/^Bearer /, '');
        const m = /^\/api\/rooms\/([A-Z0-9]{6})(?:\/(join|actions))?$/.exec(url.pathname);
        if (req.method === 'GET' && m && !m[2]) { send(200, store.view(m[1], token)); return; }
        assert(req.method === 'POST', '接口不存在', 404);
        const ip = req.socket.remoteAddress;
        const now = Date.now();
        for (const [key, entry] of rates) if (now - entry.start > 60000) rates.delete(key);
        const rate = rates.get(ip) ?? { start: now, count: 0 };
        rates.set(ip, rate); assert(++rate.count <= 300, '操作过快，请稍后再试', 429);
        const body = await readBody(req);
        if (url.pathname === '/api/rooms') { send(201, await store.create(body.name, body.requestId)); return; }
        if (m?.[2] === 'join') { send(200, await store.join(m[1], body.name, body.requestId)); return; }
        if (m?.[2] === 'actions') { send(200, await store.act(m[1], token, body)); return; }
        throw new UserError('接口不存在', 404);
      }
      assert(req.method === 'GET' && Object.hasOwn(files, url.pathname), '页面不存在', 404);
      const [name, type] = files[url.pathname];
      const content = await readFile(join(root, 'public', name));
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(content);
    } catch (e) {
      if (res.headersSent || res.destroyed) return;
      if (!(e instanceof UserError)) console.error('Request failed:', e.message);
      send(e.status ?? 500, { error: e instanceof UserError ? e.message : '服务暂时无法保存，请稍后重试；未提交的操作不会生效' });
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const store = new RoomStore(process.env.RACE_DATA_FILE || join(root, 'data', 'rooms.json'), gameAdapter);
  await store.load();
  const port = Number(process.env.PORT || 3100);
  // Intentionally local-only while publication and permissions are unresolved.
  const server = makeServer(store);
  server.listen(port, '127.0.0.1', () => console.log(`本地竞速原型：http://127.0.0.1:${port}`));
}
