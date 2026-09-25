// Bot AI. Bots produce the same movement commands a human would and aim by
// turning their view, so their accuracy comes from reaction time, tracking
// lag and aim error rather than from dice rolls.

import { viewAngleVectors } from './pmove.js';

const DEG = Math.PI / 180;

// Tuning per skill level (1 = easiest, 5 = hardest).
const SKILLS = [
  null,
  { reaction: 0.8, lag: 0.34, predict: 0.0, err: 13, decay: 1.2, floor: 2.6, turn: 260, snap: 5, cone: 3.2, fov: 100, strafe: 0.35, hop: 0.05, patience: 0.9 },
  { reaction: 0.55, lag: 0.25, predict: 0.2, err: 10, decay: 1.8, floor: 1.9, turn: 380, snap: 7, cone: 2.6, fov: 115, strafe: 0.6, hop: 0.15, patience: 0.6 },
  { reaction: 0.4, lag: 0.18, predict: 0.4, err: 8, decay: 2.5, floor: 1.3, turn: 520, snap: 9, cone: 2.0, fov: 130, strafe: 0.85, hop: 0.3, patience: 0.4 },
  { reaction: 0.28, lag: 0.12, predict: 0.6, err: 6, decay: 3.4, floor: 0.9, turn: 700, snap: 12, cone: 1.6, fov: 150, strafe: 1.0, hop: 0.5, patience: 0.25 },
  { reaction: 0.2, lag: 0.08, predict: 0.8, err: 4.5, decay: 4.5, floor: 0.55, turn: 900, snap: 16, cone: 1.2, fov: 170, strafe: 1.0, hop: 0.7, patience: 0.12 },
];

const TAUNTS = ['too easy', 'sit down', 'next', 'you blinked', 'predictable', 'gg no re', 'stay down', 'is that all?'];
const GRUMBLES = ['lucky', 'lag!', 'hmph', 'next time', 'nice shot', 'not again'];

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class BotBrain {
  constructor(game, player, skill = 3) {
    this.game = game;
    this.p = player;
    this.setSkill(skill);
    this.path = null;
    this.pathIndex = 0;
    this.goal = null;
    this.target = null;
    this.targetSeen = -99;
    this.targetFirstSeen = 0;
    this.lastSeenPos = null;
    this.perceived = null;
    this.errYaw = 0;
    this.errPitch = 0;
    this.dodge = 1;
    this.dodgeUntil = 0;
    this.nextThink = 0;
    this.nextSmooth = 0;
    this.progressCheck = 0;
    this.progressDist = Infinity;
    this.lookAt = null;
    this.lookUntil = 0;
    this.nextChat = 0;
    this.cmd = { forward: 0, right: 0, up: 0, fire: false };
  }

  setSkill(level) {
    const lo = Math.max(1, Math.min(5, Math.floor(level)));
    const hi = Math.min(5, lo + 1);
    const f = Math.max(0, Math.min(1, level - lo));
    const s = {};
    for (const k of Object.keys(SKILLS[1])) s[k] = SKILLS[lo][k] * (1 - f) + SKILLS[hi][k] * f;
    this.s = s;
  }

  rand() {
    return this.game.random();
  }

  onSpawn() {
    this.path = null;
    this.target = null;
    this.perceived = null;
    this.lookAt = null;
    this.stuckTime = 0;
  }

  onDeath() {
    this.path = null;
    this.target = null;
    if (this.p.killer && !this.p.killer.isBot && this.rand() < 0.12) this.say(GRUMBLES);
  }

  onKill(victim) {
    if (!victim.isBot && this.rand() < 0.15) this.say(TAUNTS);
  }

  say(lines) {
    if (this.game.time < this.nextChat) return;
    this.nextChat = this.game.time + 20;
    const text = lines[Math.floor(this.rand() * lines.length)];
    this.game.emit({ type: 'chat', player: this.p, text });
  }

  heardShot(shooter, start, end) {
    if (!this.p.alive || this.target) return;
    const o = this.p.ps.origin;
    const d = Math.hypot(start[0] - o[0], start[1] - o[1], start[2] - o[2]);
    if (d < 1600) {
      this.lookAt = start.slice();
      this.lookUntil = this.game.time + 1.2 + this.rand();
    }
  }

  // ---- perception -------------------------------------------------------

  canSee(o) {
    const g = this.game;
    const eye = g.eye(this.p);
    const t = o.ps.origin;
    const dx = t[0] - eye[0], dz = t[2] - eye[2];
    const yawTo = Math.atan2(-dx, -dz);
    const inFov = Math.abs(angleDiff(yawTo, this.p.ps.yaw)) < (this.s.fov * DEG) / 2;
    // something right next to us is always noticed
    if (!inFov && Math.hypot(dx, dz) > 180 && o !== this.target) return false;
    return g.visible(eye, [t[0], t[1] + 20, t[2]]) || g.visible(eye, [t[0], t[1] - 10, t[2]]);
  }

  pickTarget() {
    const g = this.game;
    let best = null;
    let bestScore = Infinity;
    const o = this.p.ps.origin;
    for (const e of g.players) {
      if (e === this.p || !e.alive) continue;
      if (g.time - e.spawnTime < 0.15) continue;
      if (!this.canSee(e)) continue;
      let score = Math.hypot(e.ps.origin[0] - o[0], e.ps.origin[1] - o[1], e.ps.origin[2] - o[2]);
      if (e === this.target) score -= 350;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) {
      if (best !== this.target || g.time - this.targetSeen > 1.0) {
        // (re)acquired: start a new reaction period and aim error
        this.targetFirstSeen = g.time;
        const a = this.rand() * Math.PI * 2;
        const mag = this.s.err * (0.6 + this.rand() * 0.6) * DEG;
        this.errYaw = Math.cos(a) * mag;
        this.errPitch = Math.sin(a) * mag * 0.6;
        if (best !== this.target || !this.perceived) this.perceived = best.ps.origin.slice();
      }
      this.target = best;
      this.targetSeen = g.time;
      this.lastSeenPos = best.ps.origin.slice();
    } else if (this.target && (g.time - this.targetSeen > 2.5 || !this.target.alive)) {
      this.target = null;
    }
  }

  // ---- navigation -------------------------------------------------------

  chooseGoal() {
    const nav = this.game.nav;
    const nodes = nav.valid;
    for (let tries = 0; tries < 6; tries++) {
      const n = nodes[Math.floor(this.rand() * nodes.length)];
      // the spire top is exposed: don't camp it
      if (n.pos[1] > 260 && this.rand() < 0.6) continue;
      const o = this.p.ps.origin;
      if (Math.hypot(n.pos[0] - o[0], n.pos[2] - o[2]) < 400) continue;
      return n;
    }
    return nodes[Math.floor(this.rand() * nodes.length)];
  }

  replan() {
    const nav = this.game.nav;
    const start = nav.nearestReachable(this.p.ps.origin);
    if (!start) {
      this.path = null;
      return;
    }
    for (let i = 0; i < 4; i++) {
      this.goal = this.chooseGoal();
      const path = nav.findPath(start.id, this.goal.id);
      if (path && path.length > 1) {
        this.path = path;
        this.pathIndex = 0;
        this.progressCheck = this.game.time + 1.5;
        this.progressDist = Infinity;
        return;
      }
    }
    this.path = null;
  }

  // Direction (unit, xz) the path wants us to move in, or null.
  followPath() {
    const g = this.game;
    const nav = g.nav;
    const ps = this.p.ps;
    const o = ps.origin;
    if (!this.path) this.replan();
    if (!this.path) return null;

    // riding a jump pad: let it carry us, the landing node is next
    if (this.p.padFlight) {
      while (this.pathIndex < this.path.length && nav.nodes[this.path[this.pathIndex]].pad) this.pathIndex++;
      return null;
    }
    if (!ps.onGround) {
      const node = nav.nodes[this.path[this.pathIndex]];
      if (!node) return null;
      const dx = node.pos[0] - o[0], dz = node.pos[2] - o[2];
      const l = Math.hypot(dx, dz) || 1;
      return [dx / l, dz / l];
    }

    let node = nav.nodes[this.path[this.pathIndex]];
    for (;;) {
      if (!node) {
        this.path = null;
        return null;
      }
      const dx = node.pos[0] - o[0], dz = node.pos[2] - o[2];
      const dh = Math.hypot(dx, dz);
      const dy = Math.abs(node.pos[1] - o[1]);
      if (!node.pad && dh < 28 && dy < 40) {
        this.pathIndex++;
        if (this.pathIndex >= this.path.length) {
          this.path = null;
          return null;
        }
        node = nav.nodes[this.path[this.pathIndex]];
        this.progressDist = Infinity;
        continue;
      }
      break;
    }

    // string pulling: skip nodes we can walk past directly
    if (g.time >= this.nextSmooth) {
      this.nextSmooth = g.time + 0.2;
      while (this.pathIndex + 1 < this.path.length) {
        const cur = nav.nodes[this.path[this.pathIndex]];
        const next = nav.nodes[this.path[this.pathIndex + 1]];
        if (cur.pad) break;
        if (!nav.walkable(o, next.pos, next.pad)) break;
        this.pathIndex++;
        node = next;
      }
    }

    // progress / stuck detection
    const dist = Math.hypot(node.pos[0] - o[0], node.pos[2] - o[2]);
    if (dist < this.progressDist - 12) {
      this.progressDist = dist;
      this.progressCheck = g.time + 1.5;
    } else if (g.time > this.progressCheck) {
      this.stuckJump = true;
      this.replan();
      return null;
    }
    const dx = node.pos[0] - o[0], dz = node.pos[2] - o[2];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  }

  // ---- aiming -----------------------------------------------------------

  aim(dt) {
    const g = this.game;
    const ps = this.p.ps;
    const s = this.s;
    let idealYaw = ps.yaw;
    let idealPitch = 0;
    let aimPoint = null;
    const eye = g.eye(this.p);

    if (this.target && g.time - this.targetSeen < 0.6) {
      const t = this.target;
      // low-pass the target position: the bot sees where you *were*
      const k = 1 - Math.exp(-dt / s.lag);
      const tp = t.ps.origin;
      for (let i = 0; i < 3; i++) this.perceived[i] += (tp[i] - this.perceived[i]) * k;
      const v = t.ps.velocity;
      aimPoint = [
        this.perceived[0] + v[0] * s.lag * s.predict,
        this.perceived[1] + 8 + v[1] * s.lag * s.predict * 0.5,
        this.perceived[2] + v[2] * s.lag * s.predict,
      ];
      // aim error shrinks while tracking
      const decay = Math.exp(-s.decay * dt);
      this.errYaw *= decay;
      this.errPitch *= decay;
      const floor = s.floor * DEG;
      this.errYaw += (this.rand() - 0.5) * floor * 6 * dt;
      this.errPitch += (this.rand() - 0.5) * floor * 4 * dt;
      this.errYaw = Math.max(-floor * 8, Math.min(floor * 8, this.errYaw));
      const dx = aimPoint[0] - eye[0], dy = aimPoint[1] - eye[1], dz = aimPoint[2] - eye[2];
      idealYaw = Math.atan2(-dx, -dz) + this.errYaw;
      idealPitch = Math.atan2(dy, Math.hypot(dx, dz)) + this.errPitch;
    } else if (this.target && this.lastSeenPos) {
      const p = this.lastSeenPos;
      const dx = p[0] - eye[0], dy = p[1] + 20 - eye[1], dz = p[2] - eye[2];
      idealYaw = Math.atan2(-dx, -dz);
      idealPitch = Math.atan2(dy, Math.hypot(dx, dz)) * 0.5;
    } else if (this.lookAt && g.time < this.lookUntil) {
      const p = this.lookAt;
      const dx = p[0] - eye[0], dy = p[1] - eye[1], dz = p[2] - eye[2];
      idealYaw = Math.atan2(-dx, -dz);
      idealPitch = Math.atan2(dy, Math.hypot(dx, dz)) * 0.5;
    } else if (this.moveDir) {
      idealYaw = Math.atan2(-this.moveDir[0], -this.moveDir[1]);
      idealPitch = 0;
    }

    // turn toward the ideal angles with limited speed
    const maxTurn = s.turn * DEG * dt;
    const k = 1 - Math.exp(-s.snap * dt);
    let dyaw = angleDiff(idealYaw, ps.yaw) * k;
    let dpitch = (idealPitch - ps.pitch) * k;
    const mag = Math.hypot(dyaw, dpitch);
    if (mag > maxTurn) {
      dyaw *= maxTurn / mag;
      dpitch *= maxTurn / mag;
    }
    ps.yaw = angleDiff(ps.yaw + dyaw, 0);
    ps.pitch = Math.max(-1.5, Math.min(1.5, ps.pitch + dpitch));
    return aimPoint;
  }

  wantsFire(aimPoint) {
    const g = this.game;
    if (!aimPoint || this.p.reload > 0) return false;
    if (g.time - this.targetFirstSeen < this.s.reaction) return false;
    const eye = g.eye(this.p);
    const dx = aimPoint[0] - eye[0], dy = aimPoint[1] - eye[1], dz = aimPoint[2] - eye[2];
    const d = Math.hypot(dx, dy, dz) || 1;
    const { forward } = viewAngleVectors(this.p.ps.yaw, this.p.ps.pitch);
    const cos = (forward[0] * dx + forward[1] * dy + forward[2] * dz) / d;
    // be pickier at range, where the target is small
    const cone = Math.max(this.s.cone * DEG * Math.min(1, 700 / d), 0.6 * DEG);
    return Math.acos(Math.min(1, cos)) < cone + Math.atan(12 / d);
  }

  // ---- main -------------------------------------------------------------

  think(dt) {
    const g = this.game;
    const ps = this.p.ps;
    const nav = g.nav;
    const s = this.s;
    const cmd = this.cmd;
    cmd.forward = 0;
    cmd.right = 0;
    cmd.up = 0;
    cmd.fire = false;

    if (g.time >= this.nextThink) {
      this.nextThink = g.time + 0.05 + this.rand() * 0.03;
      this.pickTarget();
    }

    let dir = this.followPath();
    const inCombat = this.target && g.time - this.targetSeen < 0.6;

    if (inCombat && ps.onGround && !this.p.padFlight) {
      // strafe dodge around the path direction
      if (g.time > this.dodgeUntil) {
        this.dodge = this.rand() < 0.5 ? -1 : 1;
        this.dodgeUntil = g.time + 0.3 + this.rand() * 0.9 * (1.2 - s.strafe * 0.5);
      }
      const t = this.target.ps.origin;
      const tx = t[0] - ps.origin[0], tz = t[2] - ps.origin[2];
      const tl = Math.hypot(tx, tz) || 1;
      const side = [(-tz / tl) * this.dodge, (tx / tl) * this.dodge];
      const w = s.strafe;
      let mx = side[0] * w + (dir ? dir[0] * 0.8 : 0);
      let mz = side[1] * w + (dir ? dir[1] * 0.8 : 0);
      const ml = Math.hypot(mx, mz);
      if (ml > 0.01) {
        mx /= ml;
        mz /= ml;
        if (nav.safeAhead(ps.origin, mx, mz, 48) && nav.safeAhead(ps.origin, mx, mz, 96)) {
          dir = [mx, mz];
        } else {
          this.dodge = -this.dodge;
          this.dodgeUntil = g.time + 0.4;
        }
      }
    }

    // don't walk (or slide) off ledges and into the lava, unless the path
    // deliberately drops down or leads onto a jump pad
    if (ps.onGround && !this.p.padFlight && !this.onPathEdge()) {
      const v = ps.velocity;
      const sp = Math.hypot(v[0], v[2]);
      if (dir && !nav.safeAhead(ps.origin, dir[0], dir[1], 40 + sp * 0.2)) dir = null;
      if (sp > 40) {
        const vx = v[0] / sp, vz = v[2] / sp;
        if (!nav.safeAhead(ps.origin, vx, vz, 20 + sp * 0.2)) dir = [-vx, -vz];
      }
    }
    this.moveDir = dir;

    const aimPoint = this.aim(dt);

    if (dir) {
      const cy = Math.cos(ps.yaw), sy = Math.sin(ps.yaw);
      let f = dir[0] * -sy + dir[1] * -cy;
      let r = dir[0] * cy + dir[1] * -sy;
      const m = Math.max(Math.abs(f), Math.abs(r)) || 1;
      cmd.forward = f / m;
      cmd.right = r / m;
      // hop around in fights, and to get unstuck
      const hopChance = inCombat ? s.hop : s.hop * 0.25;
      if (ps.onGround && (this.stuckJump || this.rand() < hopChance * dt * 2.5)) {
        this.stuckJump = false;
        if (this.safeJump(dir)) cmd.up = 1;
      }
    }

    if (inCombat && this.wantsFire(aimPoint)) cmd.fire = true;
    return cmd;
  }

  // Walking off an edge is fine when the path itself drops down there.
  onPathEdge() {
    if (!this.path) return false;
    const node = this.game.nav.nodes[this.path[this.pathIndex]];
    return node && (node.pad || node.pos[1] < this.p.ps.origin[1] - 30);
  }

  // Only jump when both the wish direction and our momentum land safely.
  safeJump(dir) {
    const nav = this.game.nav;
    const ps = this.p.ps;
    const o = ps.origin;
    if (nav.nearHazard(o, 280)) return false;
    const v = ps.velocity;
    const speed = Math.hypot(v[0], v[2]);
    const reach = Math.max(speed, 320) * 0.75 + 48;
    const dirs = [dir];
    if (speed > 50) dirs.push([v[0] / speed, v[2] / speed]);
    for (const d of dirs) {
      for (let s = 48; s <= reach; s += 48) if (!nav.safeAhead(o, d[0], d[1], s)) return false;
    }
    return true;
  }
}
