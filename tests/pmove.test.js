import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap } from '../src/sim/map.js';
import { World, boxBrush } from '../src/sim/collision.js';
import { createPlayerState, pmove, PM } from '../src/sim/pmove.js';

const DT = 1 / 125;
const map = buildMap();
const world = map.world;
// a huge empty floor for tests that need open space
const flat = new World([boxBrush([-20000, -64, -20000], [20000, 0, 20000])]);

function player(origin, yaw = 0) {
  const ps = createPlayerState();
  ps.origin = origin.slice();
  ps.yaw = yaw;
  return ps;
}

function run(ps, cmd, seconds, each, w = world) {
  for (let i = 0; i < seconds / DT; i++) {
    if (each) each(ps, i);
    pmove(ps, cmd, w, DT);
  }
}

const hspeed = (ps) => Math.hypot(ps.velocity[0], ps.velocity[2]);

test('settles on the floor and stays there', () => {
  const ps = player([0, 60, -700]);
  run(ps, { forward: 0, right: 0, up: 0 }, 1);
  assert.ok(ps.onGround);
  assert.ok(Math.abs(ps.origin[1] - 24.125) < 0.2, `y=${ps.origin[1]}`);
});

test('running accelerates to the ground speed cap', () => {
  const ps = player([0, 24.125, 0]);
  run(ps, { forward: 1, right: 0, up: 0 }, 0.8, null, flat);
  assert.ok(Math.abs(hspeed(ps) - PM.speed) < 2, `speed=${hspeed(ps)}`);
  // and friction stops you quickly
  run(ps, { forward: 0, right: 0, up: 0 }, 0.4, null, flat);
  assert.ok(hspeed(ps) < 1, `still sliding at ${hspeed(ps)}`);
});

test('jump height matches Quake 3 (about 45 units)', () => {
  const ps = player([0, 24.125, -700]);
  run(ps, { forward: 0, right: 0, up: 0 }, 0.2);
  let top = ps.origin[1];
  run(ps, { forward: 0, right: 0, up: 1 }, 0.02);
  run(ps, { forward: 0, right: 0, up: 0 }, 1, (p) => (top = Math.max(top, p.origin[1])));
  const h = top - 24.125;
  assert.ok(h > 42 && h < 48, `jump height ${h}`);
  assert.ok(ps.onGround);
});

test('walls stop movement', () => {
  const ps = player([0, 216.125, -900], 0); // on the north balcony facing the wall
  run(ps, { forward: 1, right: 0, up: 0 }, 1.5);
  assert.ok(ps.origin[2] > -1024 + 14.5, `z=${ps.origin[2]}`);
  assert.ok(ps.origin[2] < -1000);
});

test('ramps lead up to the balcony', () => {
  const ps = player([-384, 24.125, -360], 0);
  run(ps, { forward: 1, right: 0, up: 0 }, 2.2);
  assert.ok(Math.abs(ps.origin[1] - 216.125) < 1, `y=${ps.origin[1]}`);
  assert.ok(ps.onGround);
});

test('small ledges are stepped up, tall crates are not', () => {
  // plinth around the pillar is 16 high: walk straight onto it
  const a = player([-608, 24.125, -420], 0);
  run(a, { forward: 1, right: 0, up: 0 }, 0.5);
  assert.ok(a.origin[1] > 24.125 + 15, `stepped y=${a.origin[1]}`);
  // the 40 high crate blocks walking
  const b = player([208, 24.125, -640], 0);
  run(b, { forward: 1, right: 0, up: 0 }, 1);
  assert.ok(Math.abs(b.origin[1] - 24.125) < 0.5, `crate y=${b.origin[1]}`);
  assert.ok(b.origin[2] > -752);
});

test('strafe jumping builds speed beyond the run cap', () => {
  const ps = player([0, 24.125, 0]);
  run(ps, { forward: 1, right: 0, up: 0 }, 0.5, null, flat);
  let maxSpeed = 0;
  // hold forward + strafe + jump and turn the view smoothly towards the strafe side
  run(ps, { forward: 1, right: 1, up: 1 }, 4, (p) => {
    p.yaw -= 0.0042;
    maxSpeed = Math.max(maxSpeed, hspeed(p));
  }, flat);
  assert.ok(maxSpeed > 400, `max speed ${maxSpeed}`);
});

test('jump pads carry players to the spire', () => {
  const pad = map.pads.find((p) => p.center[1] === 0);
  const ps = player([pad.center[0], 24.125, pad.center[2]]);
  let peak = 0;
  for (let i = 0; i < 3 / DT; i++) {
    const o = ps.origin;
    if (o[0] + 15 >= pad.mins[0] && o[0] - 15 <= pad.maxs[0] && o[2] + 15 >= pad.mins[2] && o[2] - 15 <= pad.maxs[2] && o[1] - 24 <= pad.maxs[1]) {
      ps.velocity = pad.velocity.slice();
      ps.onGround = false;
    }
    pmove(ps, { forward: 0, right: 0, up: 0 }, world, DT);
    peak = Math.max(peak, ps.origin[1]);
  }
  assert.ok(ps.onGround);
  assert.ok(Math.abs(ps.origin[1] - (256 + 24.125)) < 1, `landed at y=${ps.origin[1]}`);
  assert.ok(Math.abs(ps.origin[0]) < 128 && Math.abs(ps.origin[2]) < 128, 'landed on the spire top');
});
