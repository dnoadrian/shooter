// Navigation graph for the bots: a 64 unit grid of standing spots sampled
// from the collision world, linked where a player can walk (or drop), plus
// one-way links through the jump pads.

import { TraceResult } from './collision.js';
import { PLAYER_MINS, PLAYER_MAXS, PM } from './pmove.js';

const GRID = 64;
const STEP = PM.stepSize + 0.5;
const MAX_DROP = 420;

function boxesTouch(amin, amax, bmin, bmax) {
  return amin[0] <= bmax[0] && amax[0] >= bmin[0] && amin[1] <= bmax[1] && amax[1] >= bmin[1] && amin[2] <= bmax[2] && amax[2] >= bmin[2];
}

export class NavGraph {
  constructor(map) {
    this.map = map;
    this.world = map.world;
    this.nodes = [];
    this._tr = new TraceResult();
    this.build();
  }

  // Where a player standing at (x, z) would rest, searching down from `fromY`.
  ground(x, z, fromY, out = {}) {
    const tr = this.world.trace([x, fromY, z], [x, -1000, z], PLAYER_MINS, PLAYER_MAXS, this._tr);
    if (tr.allsolid || tr.startsolid || tr.fraction === 1) return null;
    out.y = tr.endpos[1];
    out.ny = tr.normal[1];
    return out;
  }

  inHazard(x, y, z) {
    const mins = [x + PLAYER_MINS[0], y + PLAYER_MINS[1], z + PLAYER_MINS[2]];
    const maxs = [x + PLAYER_MAXS[0], y + PLAYER_MAXS[1], z + PLAYER_MAXS[2]];
    for (const h of this.map.hazards) if (boxesTouch(mins, maxs, h.mins, h.maxs)) return true;
    return false;
  }

  padAt(x, y, z) {
    const mins = [x + PLAYER_MINS[0] - 2, y + PLAYER_MINS[1] - 2, z + PLAYER_MINS[2] - 2];
    const maxs = [x + PLAYER_MAXS[0] + 2, y + PLAYER_MAXS[1], z + PLAYER_MAXS[2] + 2];
    for (const p of this.map.pads) if (boxesTouch(mins, maxs, p.mins, p.maxs)) return p;
    return null;
  }

  // Can a player walk (or step / drop down) in a straight line from a to b?
  walkable(a, b, targetPad = null) {
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / 16));
    let prevY = a[1];
    let dropped = 0;
    const g = {};
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = a[0] + dx * t;
      const z = a[2] + dz * t;
      if (!this.ground(x, z, Math.max(prevY, b[1]) + 40, g)) return false;
      if (g.ny < PM.minWalkNormal) return false;
      if (g.y - prevY > STEP) return false;
      if (prevY - g.y > STEP) {
        dropped += prevY - g.y;
        if (dropped > MAX_DROP) return false;
      }
      if (this.inHazard(x, g.y, z)) return false;
      const pad = this.padAt(x, g.y, z);
      if (pad && pad !== targetPad) return false;
      prevY = g.y;
    }
    return Math.abs(prevY - b[1]) < 24;
  }

  // Horizontal distance from pos to the closest hazard volume below it.
  nearHazard(pos, margin) {
    for (const h of this.map.hazards) {
      if (pos[1] < h.mins[1]) continue;
      const dx = Math.max(h.mins[0] - pos[0], 0, pos[0] - h.maxs[0]);
      const dz = Math.max(h.mins[2] - pos[2], 0, pos[2] - h.maxs[2]);
      if (Math.hypot(dx, dz) < margin) return true;
    }
    return false;
  }

  // Is standing at `pos` + dir * dist safe (ground not far below, no lava)?
  safeAhead(pos, dx, dz, dist) {
    const x = pos[0] + dx * dist;
    const z = pos[2] + dz * dist;
    const g = this.ground(x, z, pos[1] + 30, {});
    if (!g) return true; // blocked by a wall: not a ledge
    if (pos[1] - g.y > 70) return false;
    return !this.inHazard(x, g.y, z);
  }

  build() {
    const { bounds } = this.map;
    const g = {};
    const index = new Map();
    for (let x = bounds.min[0] + GRID / 2; x < bounds.max[0]; x += GRID) {
      for (let z = bounds.min[2] + GRID / 2; z < bounds.max[2]; z += GRID) {
        if (!this.ground(x, z, 1200, g)) continue;
        if (g.ny < PM.minWalkNormal || g.y < -40) continue;
        // center must be supported too (no nodes hanging over ledges)
        const tr = this.world.trace([x, g.y, z], [x, g.y - 60, z], [0, 0, 0], [0, 0, 0], this._tr);
        if (tr.fraction === 1 || g.y - tr.endpos[1] > 44) continue;
        if (this.inHazard(x, g.y, z) || this.padAt(x, g.y, z)) continue;
        const node = { id: this.nodes.length, pos: [x, g.y, z], links: [], pad: null };
        this.nodes.push(node);
        index.set(`${x},${z}`, node);
      }
    }
    // walk links between grid neighbours
    for (const n of this.nodes) {
      for (let ix = -1; ix <= 1; ix++) {
        for (let iz = -1; iz <= 1; iz++) {
          if (!ix && !iz) continue;
          const m = index.get(`${n.pos[0] + ix * GRID},${n.pos[2] + iz * GRID}`);
          if (m && this.walkable(n.pos, m.pos)) {
            n.links.push({ to: m.id, cost: Math.hypot(m.pos[0] - n.pos[0], m.pos[1] - n.pos[1], m.pos[2] - n.pos[2]) });
          }
        }
      }
    }
    // jump pads: walk onto the pad, fly to the landing spot
    for (const pad of this.map.pads) {
      const pos = [pad.center[0], pad.center[1] + 24.125, pad.center[2]];
      const node = { id: this.nodes.length, pos, links: [], pad };
      const landing = this.nearest([pad.target[0], pad.target[1] + 24, pad.target[2]], 200);
      if (!landing) continue;
      this.nodes.push(node);
      node.links.push({ to: landing.id, cost: pad.time * PM.speed, pad: true });
      for (const m of this.nodes) {
        if (m === node || m.pad) continue;
        const d = Math.hypot(m.pos[0] - pos[0], m.pos[2] - pos[2]);
        if (d < GRID * 1.6 && Math.abs(m.pos[1] - pos[1]) < 30 && this.walkable(m.pos, pos, pad)) {
          m.links.push({ to: node.id, cost: d });
        }
      }
    }
    this.reachability();
  }

  // Drop nodes that can't reach the main network (and aren't reachable).
  reachability() {
    const start = this.nearest([0, 24, -560], 400);
    if (!start) return;
    const forward = this.flood(start.id, false);
    const backward = this.flood(start.id, true);
    for (const n of this.nodes) n.valid = forward.has(n.id) && backward.has(n.id);
    this.valid = this.nodes.filter((n) => n.valid);
  }

  flood(startId, reverse) {
    const seen = new Set([startId]);
    const stack = [startId];
    let rev = null;
    if (reverse) {
      rev = this.nodes.map(() => []);
      for (const n of this.nodes) for (const l of n.links) rev[l.to].push(n.id);
    }
    while (stack.length) {
      const id = stack.pop();
      const next = reverse ? rev[id] : this.nodes[id].links.map((l) => l.to);
      for (const t of next) {
        if (!seen.has(t)) {
          seen.add(t);
          stack.push(t);
        }
      }
    }
    return seen;
  }

  nearest(pos, maxDist = Infinity, onlyValid = false) {
    let best = null;
    let bestD = maxDist;
    for (const n of this.nodes) {
      if (onlyValid && !n.valid) continue;
      if (n.pad) continue;
      const dy = Math.abs(n.pos[1] - pos[1]);
      const d = Math.hypot(n.pos[0] - pos[0], n.pos[2] - pos[2]) + dy * 3;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  // Nearest valid node the player at `pos` can walk to directly.
  nearestReachable(pos) {
    const cands = [];
    for (const n of this.nodes) {
      if (!n.valid || n.pad) continue;
      const dy = Math.abs(n.pos[1] - pos[1]);
      if (dy > 200) continue;
      cands.push({ n, d: Math.hypot(n.pos[0] - pos[0], n.pos[2] - pos[2]) + dy * 3 });
    }
    cands.sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(cands.length, 8); i++) {
      if (this.walkable(pos, cands[i].n.pos)) return cands[i].n;
    }
    return cands.length ? cands[0].n : null;
  }

  // A* over the graph, returns node ids from start to goal (inclusive).
  findPath(startId, goalId) {
    if (startId === goalId) return [startId];
    const nodes = this.nodes;
    const goal = nodes[goalId].pos;
    const h = (id) => {
      const p = nodes[id].pos;
      return Math.hypot(p[0] - goal[0], p[1] - goal[1], p[2] - goal[2]) * 0.9;
    };
    const gScore = new Map([[startId, 0]]);
    const came = new Map();
    const open = new Heap();
    open.push(startId, h(startId));
    const closed = new Set();
    while (open.size) {
      const cur = open.pop();
      if (cur === goalId) {
        const path = [cur];
        let c = cur;
        while (came.has(c)) {
          c = came.get(c);
          path.push(c);
        }
        return path.reverse();
      }
      if (closed.has(cur)) continue;
      closed.add(cur);
      const gc = gScore.get(cur);
      for (const l of nodes[cur].links) {
        if (!nodes[l.to].valid) continue;
        const ng = gc + l.cost;
        if (ng < (gScore.get(l.to) ?? Infinity)) {
          gScore.set(l.to, ng);
          came.set(l.to, cur);
          open.push(l.to, ng + h(l.to));
        }
      }
    }
    return null;
  }
}

class Heap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(value, priority) {
    const a = this.items;
    a.push({ value, priority });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].priority <= a[i].priority) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].priority < a[m].priority) m = l;
        if (r < a.length && a[r].priority < a[m].priority) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.value;
  }
}
