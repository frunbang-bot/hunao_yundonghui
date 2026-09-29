import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { RoomStore } from '../lib/rooms.mjs';
import { gameAdapter } from '../lib/game.mjs';
import { makeServer } from '../server.mjs';

async function fixture(fn) {
  const store = new RoomStore(null, gameAdapter);
  const server = makeServer(store); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (path, method = 'GET', body, token) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  };
  try { await fn({ base, req, store }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test('HTTP clients create, join, start and select privately; replay cannot roll twice', async () => fixture(async ({ req }) => {
  const a = (await req('/api/rooms', 'POST', { name: '甲', requestId: randomUUID() })).data;
  const path = `/api/rooms/${a.code}`;
  const b = (await req(`${path}/join`, 'POST', { name: '乙', requestId: randomUUID() })).data;
  assert.equal((await req(path)).status, 401);
  const send = (token, version, action, data) => req(`${path}/actions`, 'POST', { requestId: randomUUID(), version, action, data }, token);
  assert.equal((await send(b.token, 1, 'start')).status, 403);
  let va = (await send(a.token, 1, 'start')).data;
  const ah = va.game.players.find(p => p.id === va.me).hand;
  assert.equal(va.game.players.find(p => p.id !== va.me).hand, undefined);
  va = (await send(a.token, va.version, 'select', { role: ah[0] })).data;
  let vb = (await req(path, 'GET', null, b.token)).data;
  assert.equal(vb.game.mySelection, null); assert.equal(vb.game.players[0].role, null);
  const bh = vb.game.players.find(p => p.id === vb.me).hand;
  vb = (await send(b.token, vb.version, 'select', { role: bh[0] })).data;
  const token = vb.game.players[vb.game.turn].id === vb.me ? b.token : a.token;
  const command = { requestId: randomUUID(), version: vb.version, action: 'roll' };
  const first = await req(`${path}/actions`, 'POST', command, token);
  const retry = await req(`${path}/actions`, 'POST', command, token);
  assert.equal(first.status, 200); assert.equal(retry.status, 200);
  assert.equal(first.data.version, retry.data.version);
  assert.equal(first.data.game.lastRoll, retry.data.game.lastRoll);
  const serialized = JSON.stringify(retry.data);
  assert.ok(!serialized.includes(a.token)); assert.ok(!serialized.includes(b.token));
}));
test('HTTP rejects malformed bodies, cross-origin writes and private file requests', async () => fixture(async ({ base, req }) => {
  assert.equal((await req('/api/rooms', 'POST', { name: '', requestId: randomUUID() })).status, 400);
  assert.equal((await fetch(base + '/api/rooms', { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(base + '/data/rooms.json')).status, 404);
  assert.equal((await fetch(base + '/lib/game.mjs')).status, 404);
  const page = await fetch(base); assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  for (const file of ['/app.js', '/roles.js', '/styles.css']) assert.equal((await fetch(base + file)).status, 200);
}));
