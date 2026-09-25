import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, TICK, RAIL_RELOAD } from '../src/sim/game.js';
import { buildMap } from '../src/sim/map.js';
import { NavGraph } from '../src/sim/nav.js';

const map = buildMap();
const nav = new NavGraph(map);

// deterministic pseudo random numbers so failures are reproducible
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function newGame(opts = {}) {
  const g = new Game({ map, nav, random: seeded(1234), ...opts });
  g.time = g.phaseEnd; // skip the countdown
  g.step(TICK, null);
  g.events.length = 0;
  return g;
}

function place(p, origin, yaw = 0, pitch = 0) {
  p.ps.origin = origin.slice();
  p.ps.velocity = [0, 0, 0];
  p.ps.yaw = yaw;
  p.ps.pitch = pitch;
}

const IDLE = { forward: 0, right: 0, up: 0, fire: false };
const FIRE = { forward: 0, right: 0, up: 0, fire: true };

test('one rail hit kills, and the rail passes through several players', () => {
  const g = newGame({ botCount: 2 });
  const [me, a, b] = g.players;
  for (const bot of [a, b]) bot.brain.think = () => IDLE;
  place(me, [-200, 24.125, 700], 0); // facing -z (north)
  place(a, [-200, 24.125, 560]);
  place(b, [-200, 24.125, 440]);
  g.step(TICK, FIRE);
  assert.equal(a.alive, false);
  assert.equal(b.alive, false);
  assert.equal(me.score, 2);
  assert.equal(me.impressive, 1, 'a double hit is impressive');
  assert.ok(g.events.some((e) => e.type === 'award' && e.kind === 'excellent'), 'two frags in quick succession is excellent');
  assert.ok(Math.abs(me.reload - RAIL_RELOAD) < 0.02);
});

test('walls block rails and the gun has to recharge', () => {
  const g = newGame({ botCount: 1 });
  const [me, bot] = g.players;
  bot.brain.think = () => IDLE;
  place(me, [0, 24.125, -700], Math.PI); // facing the spire
  place(bot, [0, 24.125, 700]); // behind the spire
  g.step(TICK, FIRE);
  assert.equal(bot.alive, true);
  assert.equal(me.shots, 1);
  g.step(TICK, FIRE);
  assert.equal(me.shots, 1, 'no second shot while reloading');
});

test('lava and the void kill, suicides cost a frag', () => {
  const g = newGame({ botCount: 1 });
  const [me] = g.players;
  place(me, [0, 24.125, -250]); // above the lava pool
  for (let i = 0; i < 125 && me.alive; i++) g.step(TICK, IDLE);
  assert.equal(me.alive, false);
  assert.equal(me.score, -1);
  assert.ok(g.events.some((e) => e.type === 'frag' && e.cause === 'lava'));
});

test('dead players respawn on request, at a spawn point', () => {
  const g = newGame({ botCount: 1 });
  const [me] = g.players;
  g.kill(me, null, 'suicide');
  g.step(TICK, IDLE);
  for (let i = 0; i < 0.5 / TICK; i++) g.step(TICK, IDLE);
  assert.equal(me.alive, false, 'waits for the respawn delay');
  for (let i = 0; i < 1 / TICK; i++) g.step(TICK, IDLE);
  g.step(TICK, FIRE);
  assert.equal(me.alive, true);
  assert.ok(map.spawns.some((s) => Math.hypot(s.pos[0] - me.ps.origin[0], s.pos[2] - me.ps.origin[2]) < 1));
});

test('the match ends at the frag limit', () => {
  const g = newGame({ botCount: 1, fragLimit: 3 });
  const [me, bot] = g.players;
  for (let i = 0; i < 3; i++) {
    if (!bot.alive) g.spawn(bot);
    g.kill(bot, me, 'rail');
  }
  g.step(TICK, IDLE);
  assert.equal(g.phase, 'intermission');
  assert.equal(g.winner, me);
});

test('a tie at the time limit goes to sudden death', () => {
  const g = newGame({ botCount: 1, timeLimit: 1, fragLimit: 0 });
  const [me, bot] = g.players;
  bot.brain.think = () => IDLE;
  for (let i = 0; i < 1.2 / TICK; i++) g.step(TICK, IDLE);
  assert.equal(g.phase, 'playing');
  assert.equal(g.suddenDeath, true);
  g.kill(bot, me, 'rail');
  g.step(TICK, IDLE);
  assert.equal(g.phase, 'intermission');
  assert.equal(g.winner, me);
});

test('every spawn point can reach the spire top and every balcony', () => {
  const top = nav.nearest([0, 280, 0]);
  for (const s of map.spawns) {
    const start = nav.nearestReachable(s.pos);
    assert.ok(start, `no node near spawn ${s.pos}`);
    assert.ok(nav.findPath(start.id, top.id), `no path from ${s.pos} to the spire`);
    for (const t of map.spawns) {
      const goal = nav.nearestReachable(t.pos);
      assert.ok(nav.findPath(start.id, goal.id), `no path ${s.pos} -> ${t.pos}`);
    }
  }
});

test('bots play a full match without falling into the lava', () => {
  const g = new Game({ map, nav, spectator: true, botCount: 6, skill: 3, fragLimit: 0, timeLimit: 0, random: seeded(99) });
  let frags = 0;
  let hazards = 0;
  const visited = new Set();
  for (let i = 0; i < 120 / TICK; i++) {
    g.step(TICK, null);
    for (const e of g.events) {
      if (e.type === 'frag') {
        if (e.cause === 'rail') frags++;
        else hazards++;
      }
    }
    g.events.length = 0;
    if (i % 25 === 0) for (const p of g.players) if (p.alive) visited.add(Math.round(p.ps.origin[1] / 100));
  }
  assert.ok(frags > 30, `only ${frags} frags in two minutes`);
  assert.ok(hazards <= 1, `${hazards} bots died in the lava or void`);
  assert.ok(visited.has(2) && visited.has(3), 'bots use the balconies and the spire');
});
