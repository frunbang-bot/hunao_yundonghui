import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, actGame, viewGame } from '../lib/game.mjs';
import { ROLES, RULESET } from '../public/roles.js';

const players = n => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `选手${i}` }));
export function seeded(seed) {
  let x = seed >>> 0;
  return (min, max) => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return min + Math.floor((x / 4294967296) * (max - min)); };
}
function race(roles, positions = [], round = 1) {
  const s = createGame(players(roles.length), seeded(42));
  Object.assign(s, { phase: 'turn', round, turn: 0, turnStart: positions[0] ?? 0, turnNumber: 1, skipReason: null });
  s.players.forEach((p, i) => Object.assign(p, { role: roles[i], position: positions[i] ?? 0, hand: [], used: [roles[i]] }));
  return s;
}
function roll(s, number, option = 'normal') {
  const id = s.players[s.turn].id;
  const after = actGame(s, id, 'roll', {}, () => number);
  return actGame(after, id, 'accept', { option });
}

test('12 unique characters and distinct four-card hands', () => {
  assert.equal(new Set(ROLES.map(r => r.id)).size, 12);
  for (const count of [2, 3]) {
    const s = createGame(players(count), seeded(1));
    const hands = s.players.flatMap(p => p.hand);
    assert.equal(hands.length, count * 4); assert.equal(new Set(hands).size, count * 4);
  }
  assert.throws(() => createGame(players(4)), /2—3/);
});
test('choices are secret until all players lock; others cannot select your cards', () => {
  let s = createGame(players(3), seeded(1));
  const first = s.players[0].hand[0];
  assert.throws(() => actGame(s, 'p1', 'select', { role: first }), /不在/);
  s = actGame(s, 'p0', 'select', { role: first });
  const view = viewGame(s, 'p1');
  assert.equal(view.selections, undefined); assert.equal(view.mySelection, null);
  assert.equal(view.players[0].hand, undefined); assert.equal(view.players[0].role, null);
  assert.ok(!JSON.stringify(view.events).includes(first));
  assert.throws(() => actGame(s, 'p0', 'select', { role: first }), /已锁定/);
  s = actGame(s, 'p1', 'select', { role: s.players[1].hand[0] });
  s = actGame(s, 'p2', 'select', { role: s.players[2].hand[0] });
  assert.equal(s.phase, 'turn'); assert.equal(s.players[0].role, first);
  assert.equal(s.players[0].hand.length, 3);
});
test('invalid and out-of-turn commands leave original state untouched', () => {
  const s = race(['legs', 'gunk']); const before = JSON.stringify(s);
  assert.throws(() => actGame(s, 'p1', 'roll'), /没轮到/);
  assert.throws(() => actGame(s, 'p0', 'accept'), /阶段/);
  assert.throws(() => actGame(s, 'p0', 'nonsense'), /阶段/);
  assert.throws(() => actGame(s, 'unknown', 'roll'), /座位/);
  assert.equal(JSON.stringify(s), before);
});
test('alchemist may take either original roll or four and still receives modifiers', () => {
  const s = race(['alchemist', 'coach'], [0, 0]);
  assert.equal(roll(s, 2, 'transmute').players[0].position, 5);
  assert.equal(roll(s, 2).players[0].position, 3);
  assert.throws(() => roll(s, 3, 'transmute'), /不能炼金/);
});
test('blimp uses turn-start side of second corner', () => {
  assert.equal(roll(race(['blimp', 'magician'], [14, 0]), 2).players[0].position, 19);
  assert.equal(roll(race(['blimp', 'magician'], [15, 0]), 2).players[0].position, 16);
  assert.equal(roll(race(['blimp', 'gunk'], [15, 0]), 1).players[0].position, 15);
});
test('coach applies on the same cell including self, but not to others elsewhere', () => {
  assert.equal(roll(race(['coach', 'magician'], [2, 0]), 3).players[0].position, 6);
  assert.equal(roll(race(['magician', 'coach'], [2, 2]), 3).players[0].position, 6);
  assert.equal(roll(race(['magician', 'coach'], [2, 3]), 3).players[0].position, 5);
});
test('hare gets +2 then skips only when alone ahead at the start of its turn', () => {
  let s = race(['hare', 'magician'], [0, 0]);
  s = roll(s, 1); assert.equal(s.players[0].position, 3);
  s = roll(s, 1); assert.equal(s.turn, 0); assert.equal(s.skipReason, '兔子独自领先');
  assert.throws(() => actGame(s, 'p0', 'roll'), /只能确认跳过/);
  s = actGame(s, 'p0', 'skip'); assert.equal(s.players[0].position, 3);
  s = roll(s, 2); assert.equal(s.skipReason, null); // tied at three
});
test('legs fixed move is main movement and never fabricates a die roll', () => {
  let s = actGame(race(['legs', 'gunk', 'lackey']), 'p0', 'fixed');
  assert.equal(s.players[0].position, 4); assert.equal(s.players[2].position, 0);
  s = actGame(race(['legs', 'coach']), 'p0', 'fixed');
  assert.equal(s.players[0].position, 6);
  assert.throws(() => actGame(race(['coach', 'gunk']), 'p0', 'fixed'), /大长腿/);
});
test('magician has at most two rerolls; discarded ones and sixes trigger no dice reaction', () => {
  let s = actGame(race(['magician', 'lackey', 'inchworm']), 'p0', 'roll', {}, () => 6);
  assert.equal(s.players[1].position, 0);
  s = actGame(s, 'p0', 'reroll', {}, () => 1); assert.equal(s.players[2].position, 0);
  s = actGame(s, 'p0', 'reroll', {}, () => 4);
  assert.throws(() => actGame(s, 'p0', 'reroll'), /不能再重掷/);
  s = actGame(s, 'p0', 'accept');
  assert.equal(s.players[0].position, 4); assert.equal(s.players[1].position, 0); assert.equal(s.players[2].position, 0);
});
test('rocket choice doubles dice base, applies gunk once, and trips after moving', () => {
  let s = roll(race(['rocket', 'gunk']), 4, 'double');
  assert.equal(s.players[0].position, 7); assert.equal(s.players[0].tripped, true);
  s = roll(s, 2); assert.equal(s.skipReason, '摔倒恢复'); assert.equal(s.players[0].tripped, false);
  s = actGame(s, 'p0', 'skip'); assert.equal(s.players[0].position, 7);
  assert.equal(roll(race(['rocket', 'gunk']), 4).players[0].tripped, false);
});
test('gunk does not alter the six that activates lackey', () => {
  const s = roll(race(['magician', 'gunk', 'lackey']), 6);
  assert.equal(s.players[0].position, 5); assert.equal(s.players[2].position, 2);
  const movements = s.events.filter(e => e.kind === 'move');
  assert.match(movements[0].text, /选手2/); assert.match(movements[1].text, /选手0/);
});
test('inchworm cancels whole main move on a final one, including hare bonus and optional conversion', () => {
  let s = roll(race(['hare', 'inchworm']), 1);
  assert.equal(s.players[0].position, 0); assert.equal(s.players[1].position, 1);
  s = roll(race(['alchemist', 'inchworm']), 1, 'transmute');
  assert.equal(s.players[0].position, 0); assert.equal(s.players[1].position, 1);
  s = roll(race(['inchworm', 'gunk']), 1); assert.equal(s.players[0].position, 0);
});
test('banana trips on strict overtaking, not tying or starting alongside', () => {
  assert.equal(roll(race(['magician', 'banana'], [0, 2]), 3).players[0].tripped, true);
  assert.equal(roll(race(['magician', 'banana'], [0, 2]), 2).players[0].tripped, false);
  assert.equal(roll(race(['magician', 'banana'], [2, 2]), 3).players[0].tripped, false);
});
test('heckler uses turn origin, works on its own turn, and counts recovery turns', () => {
  let s = roll(race(['magician', 'heckler'], [20, 0]), 1);
  assert.equal(s.players[1].position, 2);
  s = roll(race(['heckler', 'magician'], [10, 0]), 1);
  assert.equal(s.players[0].position, 13);
  s = race(['magician', 'heckler'], [10, 0]); s.skipReason = '摔倒恢复';
  s = actGame(s, 'p0', 'skip'); assert.equal(s.players[1].position, 2);
});
test('ordinary track is plain; special track awards stars, arrows, and trips only on stopping', () => {
  assert.equal(roll(race(['magician', 'legs']), 4).players[0].score, 0);
  assert.equal(roll(race(['magician', 'legs'], [0, 0], 2), 4).players[0].score, 1);
  assert.equal(roll(race(['magician', 'legs'], [5, 0], 2), 2).players[0].position, 9);
  assert.equal(roll(race(['magician', 'legs'], [19, 0], 2), 2).players[0].position, 19);
  assert.equal(roll(race(['magician', 'legs'], [10, 0], 2), 2).players[0].tripped, true);
  assert.equal(roll(race(['magician', 'legs'], [10, 0], 2), 3).players[0].tripped, false);
});
test('second-place reactive finish ends race before active racer can move', () => {
  const s = race(['magician', 'lackey', 'gunk'], [10, 28, 30]);
  s.players[2].finish = 1; s.players[2].score = 3; s.finishers = ['p2'];
  const after = roll(s, 6);
  assert.equal(after.phase, 'roundEnd'); assert.equal(after.players[0].position, 10);
  assert.deepEqual(after.finishers, ['p2', 'p1']); assert.equal(after.players[1].score, 1);
});
test('finished passive characters stop affecting the race', () => {
  const s = race(['legs', 'gunk', 'banana'], [0, 30, 8]);
  s.players[1].finish = 1; s.finishers = ['p1'];
  assert.equal(actGame(s, 'p0', 'fixed').players[0].position, 5);
});
test('finishing second does not also run heckler or rocket penalties', () => {
  const s = race(['rocket', 'heckler', 'banana'], [29, 0, 30]);
  s.players[2].finish = 1; s.finishers = ['p2'];
  const a = roll(s, 1, 'double');
  assert.equal(a.phase, 'roundEnd'); assert.equal(a.players[1].position, 0); assert.equal(a.players[0].tripped, false);
});
test('round transition waits for every player and keeps score, resets positions and trips', () => {
  let s = race(['magician', 'legs'], [29, 30]); s.players[1].finish = 1; s.finishers = ['p1'];
  s.players[0].hand = ['gunk']; s.players[1].hand = ['banana'];
  s = roll(s, 2); assert.equal(s.phase, 'roundEnd');
  s = actGame(s, 'p0', 'ready'); assert.equal(s.phase, 'roundEnd');
  assert.throws(() => actGame(s, 'p0', 'ready'), /已确认/);
  s = actGame(s, 'p1', 'ready'); assert.equal(s.phase, 'select'); assert.equal(s.round, 2);
  s = actGame(s, 'p0', 'select', { role: 'gunk' }); s = actGame(s, 'p1', 'select', { role: 'banana' });
  assert.deepEqual(s.players.map(p => p.position), [0, 0]); assert.equal(s.players[0].score, 1);
});

test('user ruling: sole remaining hare inherits second place instead of skipping forever', () => {
  const s = race(['magician', 'hare'], [29, 7]);
  const after = roll(s, 2);
  assert.equal(after.phase, 'roundEnd');
  assert.deepEqual(after.finishers, ['p0', 'p1']);
  assert.equal(after.players[1].position, 7);
  assert.equal(after.players[1].finish, 2); assert.equal(after.players[1].score, 1);
  assert.match(after.completionReason, /递补第二名/);
  assert.equal(s.players[1].finish, null);
});

export function simulate(seed, count) {
  const rng = seeded(seed); let s = createGame(players(count), rng); let commands = 0;
  while (s.phase !== 'finished' && commands < 5000) {
    commands++;
    if (s.phase === 'select') {
      const p = s.players.find(p => !s.selections[p.id]);
      s = actGame(s, p.id, 'select', { role: p.hand[rng(0, p.hand.length)] }, rng);
    } else if (s.phase === 'roundEnd') {
      s = actGame(s, s.players.find(p => !s.ready.includes(p.id)).id, 'ready', {}, rng);
    } else {
      const p = s.players[s.turn];
      if (s.skipReason) s = actGame(s, p.id, 'skip', {}, rng);
      else if (s.phase === 'turn') s = actGame(s, p.id, p.role === 'legs' && rng(0, 2) ? 'fixed' : 'roll', {}, rng);
      else if (p.role === 'magician' && s.pending.rerolls < 2 && rng(0, 2)) s = actGame(s, p.id, 'reroll', {}, rng);
      else {
        const option = p.role === 'alchemist' && s.pending.roll <= 2 && rng(0, 2) ? 'transmute' : p.role === 'rocket' && rng(0, 2) ? 'double' : 'normal';
        s = actGame(s, p.id, 'accept', { option }, rng);
      }
    }
    for (const p of s.players) {
      assert.ok(Number.isSafeInteger(p.position) && p.position >= 0 && p.position <= RULESET.finish, `position seed ${seed}`);
      assert.ok(Number.isSafeInteger(p.score) && p.score >= 0, `score seed ${seed}`);
      assert.equal(new Set(p.used).size, p.used.length, `reused character seed ${seed}`);
    }
    if (['turn', 'decision'].includes(s.phase)) assert.equal(s.players[s.turn].finish, null);
    assert.equal(new Set(s.finishers).size, s.finishers.length);
    assert.ok(s.finishers.length <= 2);
  }
  assert.equal(s.phase, 'finished', `did not finish: seed ${seed}, ${count} players`);
  assert.equal(s.results.length, 4); s.players.forEach(p => assert.equal(p.used.length, 4));
  const minimumPrizes = RULESET.prizes.flat().reduce((a, b) => a + b, 0);
  assert.ok(s.players.reduce((n, p) => n + p.score, 0) >= minimumPrizes);
  return { commands, events: s.events.length };
}
test('500 seeded full games: 250 two-player and 250 three-player, four rounds each', () => {
  for (let seed = 1; seed <= 250; seed++) { simulate(seed, 2); simulate(seed + 1000, 3); }
});
