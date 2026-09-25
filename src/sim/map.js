// "The Molten Spire" – a four-way symmetric arena: a lava pool with a tall
// spire in the middle (reached by jump pads), a ground ring with pillars,
// and a raised balcony running around the walls.
//
// Everything is authored for one quadrant (the north side, -z) and then
// rotated four times around the vertical axis. The map has no overhangs, so
// every (x, z) column has a single walkable surface; navigation relies on it.

import { boxBrush, rampBrush, rotateBrush, rotY, World } from './collision.js';
import { PM } from './pmove.js';

export const MAP_NAME = 'The Molten Spire';

const BALCONY = 192;
const TOWER = 256;

function quadrantBrushes() {
  return [
    // floor ring piece (pinwheel)
    boxBrush([-1088, -64, -1088], [320, 0, -320], { top: 'floor', side: 'stone', bottom: 'stone' }),
    // outer wall
    boxBrush([-1088, 0, -1088], [1024, 704, -1024], { mat: 'wall', top: 'stone' }),
    // balcony
    boxBrush([-1024, 0, -1024], [800, BALCONY, -800], { top: 'metal', side: 'stone2' }),
    // ramp from the ground ring up to the balcony
    rampBrush([-448, 0, -800], [-320, BALCONY, -416], 0, BALCONY, '-z', { top: 'grate', side: 'stone2' }),
    // big pillar on the ground ring
    boxBrush([-672, 0, -672], [-544, 448, -544], { mat: 'pillar', top: 'stone' }),
    boxBrush([-688, 0, -688], [-528, 16, -528], { mat: 'stone2', top: 'metal' }),
    // crates at the foot of the balcony
    boxBrush([96, 0, -800], [176, 64, -736], { mat: 'crate' }),
    boxBrush([176, 0, -800], [240, 40, -752], { mat: 'crate' }),
    // wall buttresses above the balcony
    boxBrush([-600, BALCONY, -1024], [-552, 704, -1004], { mat: 'pillar' }),
    boxBrush([168, BALCONY, -1024], [216, 704, -1004], { mat: 'pillar' }),
    // cover wall on the balcony
    boxBrush([-240, BALCONY, -904], [-224, BALCONY + 56, -800], { mat: 'metal', top: 'trim' }),
  ];
}

// Purely visual detail: battlements, pilasters, pillar capitals.
function quadrantDecor() {
  const deco = { solid: false };
  const out = [];
  for (let x = -1072; x < 1024; x += 96) {
    out.push(boxBrush([x, 704, -1088], [x + 48, 752, -1024], { ...deco, mat: 'wall', top: 'stone' }));
  }
  out.push(boxBrush([-1088, 688, -1032], [1024, 704, -1016], { ...deco, mat: 'stone2' }));
  for (const x of [-736, -560, -224, 32, 304, 528, 736]) {
    out.push(boxBrush([x - 14, 0, -800], [x + 14, 176, -794], { ...deco, mat: 'pillar' }));
  }
  out.push(boxBrush([-684, 448, -684], [-532, 472, -532], { ...deco, mat: 'stone2', top: 'metal' }));
  out.push(boxBrush([-640, 472, -640], [-576, 488, -576], { ...deco, mat: 'trim' }));
  return out;
}

function centerBrushes() {
  const posts = [];
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const a = [x < 0 ? -128 : 104, TOWER, z < 0 ? -128 : 104];
    posts.push(boxBrush(a, [a[0] + 24, TOWER + 72, a[2] + 24], { mat: 'tower', top: 'trim' }));
  }
  return [
    // the spire, with a post on each corner of its top
    boxBrush([-128, -64, -128], [128, TOWER, 128], { side: 'tower', top: 'metal', bottom: 'stone' }),
    ...posts,
    // lava pool bottom
    boxBrush([-320, -128, -320], [320, -64, 320], { mat: 'lavarock' }),
  ];
}

// Launch velocity that carries a player from `from` to `to` (both origins)
// peaking `arc` units above the higher of the two.
export function padVelocity(from, to, arc) {
  const g = PM.gravity;
  const apex = Math.max(from[1], to[1]) + arc;
  const vy = Math.sqrt(2 * g * (apex - from[1]));
  const tUp = vy / g;
  const tDown = Math.sqrt((2 * (apex - to[1])) / g);
  const t = tUp + tDown;
  const dx = to[0] - from[0], dz = to[2] - from[2];
  return { velocity: [dx / t, vy, dz / t], time: t };
}

function makePad(center, halfSize, target, arc) {
  const from = [center[0], center[1] + 24, center[2]];
  const to = [target[0], target[1] + 24, target[2]];
  const { velocity, time } = padVelocity(from, to, arc);
  return {
    center,
    target,
    velocity,
    time,
    mins: [center[0] - halfSize, center[1], center[2] - halfSize],
    maxs: [center[0] + halfSize, center[1] + 12, center[2] + halfSize],
  };
}

export function buildMap() {
  const brushes = [];
  const pads = [];
  const spawns = [];
  const lights = [];
  const lamps = [];
  for (let k = 0; k < 4; k++) {
    for (const b of quadrantBrushes()) brushes.push(k ? rotateBrush(b, k) : b);
    for (const b of quadrantDecor()) brushes.push(k ? rotateBrush(b, k) : b);
    const r = (p) => rotY(p, k);
    // ground pad -> top of the spire
    pads.push(makePad(r([0, 0, -560]), 40, r([0, TOWER, -40]), 140));
    // spire pad -> balcony
    pads.push(makePad(r([0, TOWER, -96]), 32, r([0, BALCONY, -880]), 160));
    spawns.push(r([400, BALCONY, -912]), r([-176, 0, -704]), r([224, 0, -448]));
    lights.push({ pos: r([0, 24, -224]), color: 0xff5a1a, intensity: 5.5, distance: 900 });
    lamps.push({ pos: r([-208, 440, -1020]), normal: r([0, 0, 1]) });
    lamps.push({ pos: r([576, 440, -1020]), normal: r([0, 0, 1]) });
    lights.push({ pos: r([-208, 420, -960]), color: 0xffa060, intensity: 3.5, distance: 1100 });
  }
  for (const b of centerBrushes()) brushes.push(b);

  const world = new World(brushes);
  return {
    name: MAP_NAME,
    world,
    brushes,
    pads,
    spawns: spawns.map((p) => ({ pos: [p[0], p[1] + 24.125, p[2]], yaw: Math.atan2(p[0], p[2]) })),
    // touching these kills
    hazards: [{ mins: [-320, -200, -320], maxs: [320, -14, 320], kind: 'lava' }],
    lavaLevel: -20,
    lavaExtent: 320,
    killY: -700,
    lights,
    lamps,
    bounds: { min: [-1024, -64, -1024], max: [1024, 704, 1024] },
    intermissionCam: { pos: [760, 520, 760], look: [0, 120, 0] },
  };
}
