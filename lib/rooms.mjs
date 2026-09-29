import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const assert = (condition, message, status = 400) => { if (!condition) throw new UserError(message, status); };
const secret = () => randomBytes(24).toString('hex');
const requestId = value => {
  assert(typeof value === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(value), '请求编号无效');
  return value;
};
const cleanName = name => {
  assert(typeof name === 'string', '请填写昵称');
  const value = name.trim();
  assert(value.length >= 1 && value.length <= 16 && !/[\u0000-\u001f]/.test(value), '昵称需为 1—16 个字符');
  return value;
};

// Save a complete candidate before publishing it in memory. A failed write cannot advance the game.
export class RoomStore {
  constructor(file, game, { capacity = 3, persist } = {}) {
    this.file = file; this.game = game; this.capacity = capacity;
    this.rooms = {}; this.queue = Promise.resolve(); this.persistOverride = persist;
  }
  async load() {
    if (!this.file) return;
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      assert(saved.schema === 1 && saved.rooms && typeof saved.rooms === 'object', '存档格式不兼容', 500);
      this.rooms = saved.rooms;
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  async persist(rooms) {
    if (this.persistOverride) return this.persistOverride(rooms);
    if (!this.file) return;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify({ schema: 1, rooms }), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
  }
  transact(fn) {
    const result = this.queue.then(async () => {
      const candidate = structuredClone(this.rooms);
      const answer = fn(candidate);
      await this.persist(candidate);
      this.rooms = candidate;
      return answer;
    });
    this.queue = result.catch(() => {});
    return result;
  }
  room(code, rooms = this.rooms) {
    assert(typeof code === 'string' && /^[A-Z0-9]{6}$/.test(code), '房间码应为 6 位字母或数字');
    assert(Object.hasOwn(rooms, code), '房间不存在', 404);
    return rooms[code];
  }
  player(room, token) {
    assert(typeof token === 'string' && token.length === 48, '请重新进入房间', 401);
    const p = room.players.find(p => p.token === token);
    assert(p, '座位凭证无效', 401);
    return p;
  }
  async create(name, key) {
    name = cleanName(name); key = requestId(key);
    return this.transact(rooms => {
      const existing = Object.values(rooms).find(r => r.createKey === key);
      if (existing) return { code: existing.code, token: existing.players[0].token };
      assert(Object.keys(rooms).length < 200, '测试服务器房间已满', 503);
      let code;
      do { code = randomBytes(3).toString('hex').toUpperCase(); } while (Object.hasOwn(rooms, code));
      const player = { id: randomUUID(), name, token: secret() };
      rooms[code] = { code, createKey: key, version: 0, createdAt: Date.now(), updatedAt: Date.now(), players: [player], joins: {}, requests: [], game: null };
      return { code, token: player.token };
    });
  }
  async join(code, name, key) {
    name = cleanName(name); key = requestId(key);
    return this.transact(rooms => {
      const room = this.room(code, rooms);
      if (Object.hasOwn(room.joins, key)) return { code, token: room.joins[key] };
      assert(!room.game, '比赛已经开始，不能加入');
      assert(room.players.length < this.capacity, `首版房间最多 ${this.capacity} 人`);
      const p = { id: randomUUID(), name, token: secret() };
      room.players.push(p); room.joins[key] = p.token;
      room.version++; room.updatedAt = Date.now();
      return { code, token: p.token };
    });
  }
  view(code, token) {
    const room = this.room(code); const me = this.player(room, token);
    return {
      code, version: room.version, capacity: this.capacity, me: me.id,
      host: room.players[0].id,
      players: room.players.map(({ id, name }) => ({ id, name })),
      game: room.game ? this.game.view(room.game, me.id) : null,
    };
  }
  async act(code, token, command) {
    assert(command && typeof command === 'object' && !Array.isArray(command), '操作格式无效');
    const key = requestId(command.requestId);
    await this.transact(rooms => {
      const room = this.room(code, rooms); const me = this.player(room, token);
      const previous = room.requests.find(r => r.id === key && r.player === me.id);
      const signature = JSON.stringify({ action: command.action, data: command.data ?? {} });
      if (previous) { assert(previous.signature === signature, '同一请求编号不能用于不同操作', 409); return; }
      assert(Number.isSafeInteger(command.version) && room.version === command.version, '状态已更新，请重试', 409);
      if (command.action === 'start') {
        assert(me.id === room.players[0].id, '只有房主可以开始', 403);
        assert(!room.game && room.players.length >= 2, '需要至少 2 人，且比赛尚未开始');
        room.game = this.game.create(room.players.map(({ id, name }) => ({ id, name })));
      } else {
        assert(room.game, '比赛尚未开始');
        room.game = this.game.act(room.game, me.id, command.action, command.data ?? {});
      }
      room.requests.push({ id: key, player: me.id, signature });
      // Old requests still carry old versions, so eviction cannot replay a committed action.
      if (room.requests.length > 512) room.requests.shift();
      room.version++; room.updatedAt = Date.now();
    });
    return this.view(code, token);
  }
}
