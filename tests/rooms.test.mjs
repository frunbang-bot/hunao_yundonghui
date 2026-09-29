import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RoomStore } from '../lib/rooms.mjs';

const game = {
  create: players => ({ players, count: 0 }),
  act: state => ({ ...state, count: state.count + 1 }),
  view: state => state,
};
const setup = async options => {
  const s = new RoomStore(null, game, options);
  const a = await s.create('甲', randomUUID());
  const b = await s.join(a.code, '乙', randomUUID());
  return { s, a, b };
};
const cmd = (version, action = 'start') => ({ requestId: randomUUID(), version, action });

test('room credentials are private; invalid tokens fail', async () => {
  const { s, a, b } = await setup();
  const view = s.view(a.code, a.token);
  assert.equal(view.players.length, 2);
  assert.ok(!JSON.stringify(view).includes(b.token));
  assert.throws(() => s.view(a.code, 'x'.repeat(48)), /凭证/);
});
test('create and join retry do not allocate another room or seat', async () => {
  const s = new RoomStore(null, game); const k = randomUUID();
  const a = await s.create('甲', k); assert.deepEqual(await s.create('甲', k), a);
  const j = randomUUID(); const b = await s.join(a.code, '乙', j);
  assert.deepEqual(await s.join(a.code, '乙', j), b);
  assert.equal(s.view(a.code, a.token).players.length, 2);
});
test('host only, stale commands, idempotent repeated actions and closed joining', async () => {
  const { s, a, b } = await setup(); const start = cmd(1);
  await assert.rejects(s.act(a.code, b.token, start), /房主/);
  await s.act(a.code, a.token, start);
  assert.equal((await s.act(a.code, a.token, start)).version, 2);
  await assert.rejects(s.act(a.code, a.token, { ...start, action: 'other' }), /不同操作/);
  await assert.rejects(s.act(a.code, a.token, cmd(1, 'other')), /状态已更新/);
  await assert.rejects(s.join(a.code, '丙', randomUUID()), /已经开始/);
});
test('concurrent commands with the same version commit only once', async () => {
  const { s, a } = await setup(); await s.act(a.code, a.token, cmd(1));
  const results = await Promise.allSettled([s.act(a.code, a.token, cmd(2, 'tick')), s.act(a.code, a.token, cmd(2, 'tick'))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(s.view(a.code, a.token).game.count, 1);
});
test('failed persistence rolls back mutation and later requests can recover', async () => {
  let fail = false;
  const { s, a } = await setup({ persist: () => { if (fail) throw new Error('disk failed'); } });
  fail = true; await assert.rejects(s.act(a.code, a.token, cmd(1)), /disk failed/);
  assert.equal(s.view(a.code, a.token).game, null);
  fail = false; await s.act(a.code, a.token, cmd(1));
  assert.ok(s.view(a.code, a.token).game);
});
test('room and identity survive service restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'race-test-'));
  try {
    const file = join(dir, 'rooms.json'); const s = new RoomStore(file, game);
    const a = await s.create('甲', randomUUID());
    await s.join(a.code, '乙', randomUUID()); await s.act(a.code, a.token, cmd(1));
    const restored = new RoomStore(file, game); await restored.load();
    assert.deepEqual(restored.view(a.code, a.token), s.view(a.code, a.token));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
