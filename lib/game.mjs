import { randomInt } from 'node:crypto';
import { ROLES, ROLE_BY_ID, RULESET } from '../public/roles.js';
import { assert } from './rooms.mjs';

const active = p => p.finish === null;
const byId = (s, id) => s.players.find(p => p.id === id);
const role = p => p.role;
const running = s => s.phase === 'turn' || s.phase === 'decision';
const log = (s, text, kind = 'info') => {
  s.events.push({ seq: ++s.eventSeq, round: s.round, kind, text });
};
const ordered = s => [...s.players.slice(s.turn), ...s.players.slice(0, s.turn)];
const aliveRole = (s, id) => s.players.find(p => active(p) && role(p) === id);
const die = rng => rng(1, 7);
const shuffled = (array, rng) => {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) { const j = rng(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
function awardFinish(s, p, reason = '冲线') {
  p.finish = s.finishers.length + 1;
  s.finishers.push(p.id);
  const points = s.config.prizes[s.round - 1][p.finish - 1];
  p.score += points;
  log(s, `${p.name}${reason}，获得第 ${p.finish} 名和 ${points} 分。`, 'finish');
  if (s.finishers.length === 2) {
    s.phase = 'roundEnd'; s.pending = null;
    const minimum = Math.min(...s.players.filter(active).map(p => p.position));
    // Test rule: ties use the fixed seat order; for two racers the second-place player starts.
    const last = s.players.find(p => active(p) && p.position === minimum) ?? byId(s, s.finishers[1]);
    s.nextStarter = s.players.indexOf(last);
    s.results.push({ round: s.round, finishers: [...s.finishers], standings: s.players.map(p => ({ id: p.id, position: p.position, finish: p.finish, score: p.score })) });
    log(s, `第 ${s.round} 场结束，所有选手确认后继续。`, 'finish');
  }
}
function trip(s, p, reason) {
  if (!active(p) || !running(s)) return;
  p.tripped = true; log(s, `${p.name}因${reason}摔倒，下次跳过主移动。`, 'power');
}
function move(s, p, amount, source, depth = 0) {
  if (!running(s) || !active(p) || amount === 0) return;
  assert(depth < 30, '测试赛道发生意外循环；本次操作未提交', 422);
  const from = p.position;
  const to = Math.max(0, Math.min(s.config.finish, from + amount));
  if (to === from) return;
  const banana = aliveRole(s, 'banana');
  const passedBanana = banana && banana.id !== p.id && from < banana.position && to > banana.position;
  p.position = to;
  log(s, `${p.name}因${source}从 ${from} 移到 ${to}。`, 'move');
  if (to === s.config.finish) { awardFinish(s, p); return; }
  const cell = s.round % 2 === 0 ? s.config.special[to] : null;
  if (cell?.type === 'star') { p.score++; log(s, `${p.name}停在星星格，获得 1 分。`, 'power'); }
  if (cell?.type === 'trip') trip(s, p, '赛道陷阱');
  if (cell?.type === 'arrow') move(s, p, cell.amount, '赛道箭头', depth + 1);
  if (passedBanana) trip(s, p, '超过香蕉');
}
function mainMove(s, p, base, double = false) {
  let distance = base;
  if (role(p) === 'blimp') distance += s.turnStart < s.config.secondCorner ? 3 : -1;
  if (role(p) === 'hare') distance += 2;
  const coach = aliveRole(s, 'coach');
  if (coach && coach.position === p.position) distance++;
  if (role(p) !== 'gunk' && aliveRole(s, 'gunk')) distance--;
  distance = Math.max(0, distance);
  log(s, `${p.name}主移动基础 ${base}，修正后 ${distance} 格。`, 'roll');
  move(s, p, distance, '主移动');
  if (double) trip(s, p, '火箭冲刺');
}
function finishTurn(s, p) {
  if (!running(s)) return;
  if (Math.abs(p.position - s.turnStart) <= 1) {
    const h = aliveRole(s, 'heckler');
    if (h) { log(s, `${p.name}本回合净位移不超过 1 格，毒舌喷子前进。`, 'power'); move(s, h, 2, '毒舌喷子能力'); }
  }
  if (!running(s)) return;
  do { s.turn = (s.turn + 1) % s.players.length; } while (!active(s.players[s.turn]));
  beginTurn(s);
}
function beginTurn(s) {
  s.phase = 'turn'; s.pending = null;
  const p = s.players[s.turn]; s.turnStart = p.position; s.turnNumber++;
  if (role(p) === 'hare' && s.finishers.length === 1 && s.players.filter(active).length === 1) {
    s.completionReason = '仅剩兔子无法继续主移动，按已确认的测试规则递补第二名。';
    awardFinish(s, p, '作为剩余选手递补');
    return;
  }
  log(s, `轮到 ${p.name}（${ROLE_BY_ID[p.role].name}）。`, 'turn');
  s.skipReason = null;
  if (p.tripped) { p.tripped = false; s.skipReason = '摔倒恢复'; }
  else if (role(p) === 'hare' && s.players.filter(q => active(q) && q.id !== p.id).every(q => p.position > q.position)) s.skipReason = '兔子独自领先';
  if (s.skipReason) log(s, `${p.name}因${s.skipReason}跳过主移动，请确认结束回合。`, 'power');
}
function startRace(s) {
  s.finishers = []; s.ready = []; s.completionReason = null; s.lastRoll = null;
  for (const p of s.players) {
    p.role = s.selections[p.id]; p.hand = p.hand.filter(r => r !== p.role);
    p.used.push(p.role); p.position = 0; p.finish = null; p.tripped = false;
  }
  s.selections = {};
  log(s, `第 ${s.round} 场开始：${s.round % 2 ? '普通测试赛道' : '特殊测试赛道'}。`, 'round');
  beginTurn(s);
}

export function createGame(players, rng = randomInt) {
  assert(players.length >= 2 && players.length <= 3, '12 角色原型支持 2—3 人');
  const deck = shuffled(ROLES.map(r => r.id), rng);
  const s = {
    ruleset: RULESET.id, config: structuredClone(RULESET), phase: 'select', round: 1,
    players: players.map((p, i) => ({ ...p, hand: deck.slice(i * 4, i * 4 + 4), used: [], role: null, score: 0, position: 0, finish: null, tripped: false })),
    selections: {}, ready: [], turn: rng(0, players.length), turnStart: 0, turnNumber: 0,
    skipReason: null, pending: null, lastRoll: null, finishers: [], results: [], events: [], eventSeq: 0,
  };
  log(s, '每人随机获得四名不重复选手。请秘密选择第一场角色。', 'round');
  return s;
}

export function actGame(state, playerId, action, data = {}, rng = randomInt) {
  const s = structuredClone(state); const p = byId(s, playerId);
  assert(p, '没有该座位', 403);
  assert(data && typeof data === 'object' && !Array.isArray(data), '操作参数无效');
  if (action === 'select') {
    assert(s.phase === 'select', '当前不能选角色');
    assert(!s.selections[p.id], '已锁定角色，等待其他选手');
    assert(typeof data.role === 'string' && p.hand.includes(data.role), '该角色不在你的待选队伍中');
    s.selections[p.id] = data.role;
    if (Object.keys(s.selections).length === s.players.length) startRace(s);
    return s;
  }
  if (action === 'ready') {
    assert(s.phase === 'roundEnd', '当前不是场间结算');
    assert(!s.ready.includes(p.id), '已确认，请等待其他选手');
    s.ready.push(p.id);
    if (s.ready.length === s.players.length) {
      if (s.round === 4) { s.phase = 'finished'; log(s, '四场结束，总分相同的选手并列获胜。', 'finish'); }
      else { s.round++; s.phase = 'select'; s.turn = s.nextStarter; s.selections = {}; s.ready = []; log(s, `请选择第 ${s.round} 场选手。`, 'round'); }
    }
    return s;
  }
  assert(running(s), '当前不能执行回合操作');
  assert(s.players[s.turn].id === p.id, '还没轮到你', 403);
  if (action === 'skip') {
    assert(s.phase === 'turn' && s.skipReason, '当前不能跳过'); finishTurn(s, p); return s;
  }
  assert(!s.skipReason, '本回合只能确认跳过');
  if (action === 'fixed') {
    assert(s.phase === 'turn' && role(p) === 'legs', '只有大长腿可以选择固定移动');
    mainMove(s, p, 5); finishTurn(s, p); return s;
  }
  if (action === 'roll' || action === 'reroll') {
    if (action === 'roll') assert(s.phase === 'turn', '已经掷骰，请选择保留或技能');
    else assert(s.phase === 'decision' && role(p) === 'magician' && s.pending.rerolls < 2, '不能再重掷');
    const rerolls = action === 'roll' ? 0 : s.pending.rerolls + 1;
    const value = die(rng);
    s.pending = { roll: value, rerolls }; s.lastRoll = value; s.phase = 'decision';
    log(s, `${p.name}${action === 'reroll' ? '重掷' : '掷出'} ${value} 点。`, 'roll');
    return s;
  }
  assert(action === 'accept' && s.phase === 'decision', '操作不适用于当前阶段');
  const raw = s.pending.roll; const option = data.option ?? 'normal';
  assert(['normal', 'transmute', 'double'].includes(option), '未知能力选择');
  if (option === 'transmute') assert(role(p) === 'alchemist' && raw <= 2, '当前不能炼金');
  if (option === 'double') assert(role(p) === 'rocket', '当前不能翻倍');
  s.phase = 'turn'; s.pending = null;
  let stolen = false;
  for (const q of ordered(s)) {
    if (!running(s)) break;
    if (!active(q) || q.id === p.id) continue;
    if (raw === 6 && role(q) === 'lackey') move(s, q, 2, '跟班能力');
    if (raw === 1 && role(q) === 'inchworm') { stolen = true; log(s, `${p.name}的 1 点主移动被尺蠖接管。`, 'power'); move(s, q, 1, '尺蠖能力'); }
  }
  if (running(s) && !stolen) mainMove(s, p, option === 'transmute' ? 4 : option === 'double' ? raw * 2 : raw, option === 'double');
  finishTurn(s, p);
  return s;
}

export function viewGame(s, playerId) {
  return {
    ...s,
    selections: undefined,
    chosen: Object.keys(s.selections),
    mySelection: s.selections[playerId] ?? null,
    players: s.players.map(p => {
      const visible = { ...p, handCount: p.hand.length };
      if (p.id !== playerId) delete visible.hand;
      return visible;
    }),
    events: s.events.slice(-80),
  };
}
export const gameAdapter = { create: createGame, act: actGame, view: viewGame };
