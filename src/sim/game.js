// Game rules for instagib deathmatch: railguns only, one hit kills,
// frag limit / time limit, awards, spawning and the world triggers.

import { buildMap } from './map.js';
import { NavGraph } from './nav.js';
import { createPlayerState, pmove, viewAngleVectors, PLAYER_MINS, PLAYER_MAXS } from './pmove.js';
import { rayAABB, TraceResult } from './collision.js';
import { BotBrain } from './bot.js';

export const TICK = 1 / 125;
export const RAIL_RELOAD = 1.5;
export const RAIL_RANGE = 8192;
const EXCELLENT_TIME = 3;
const COUNTDOWN = 3;

export const BOT_PROFILES = [
  { name: 'Vex', color: '#ff3b3b' },
  { name: 'Kraal', color: '#3bb4ff' },
  { name: 'Nyx', color: '#ffd23b' },
  { name: 'Morrow', color: '#ff3bf2' },
  { name: 'Hexa', color: '#3bffe8' },
  { name: 'Talon', color: '#ff8a1f' },
  { name: 'Sable', color: '#b46bff' },
  { name: 'Cinder', color: '#f0f0f0' },
  { name: 'Grimm', color: '#9dff3b' },
];

const DEATH_TEXT = {
  rail: (v, a) => `${v} was railed by ${a}`,
  lava: (v) => `${v} took a lava bath`,
  void: (v) => `${v} fell into the void`,
  suicide: (v) => `${v} gave up`,
};

export class Game {
  constructor(opts = {}) {
    this.opts = {
      fragLimit: 20,
      timeLimit: 600,
      botCount: 5,
      skill: 3,
      playerName: 'Player',
      playerColor: '#33ff77',
      spectator: false,
      random: Math.random,
      ...opts,
    };
    this.random = this.opts.random;
    // the map and its nav graph are immutable, so games can share them
    this.map = this.opts.map || buildMap();
    this.world = this.map.world;
    this.nav = this.opts.nav || new NavGraph(this.map);
    this.players = [];
    this.events = [];
    this.time = 0;
    this.matchTime = 0;
    this.phase = 'countdown';
    this.phaseEnd = COUNTDOWN;
    this.lastCount = COUNTDOWN + 1;
    this.suddenDeath = false;
    this.winner = null;
    this.local = null;
    this.leadState = null;
    this.fragsLeftAnnounced = new Set();
    this.timeAnnounced = new Set();
    this._tr = new TraceResult();

    if (!this.opts.spectator) {
      this.local = this.addPlayer({ name: this.opts.playerName, color: this.opts.playerColor, isBot: false });
    }
    const profiles = shuffle(BOT_PROFILES.slice(), this.random);
    for (let i = 0; i < this.opts.botCount; i++) {
      const prof = profiles[i % profiles.length];
      this.addPlayer({ name: prof.name, color: prof.color, isBot: true, skill: this.opts.skill });
    }
    for (const p of this.players) this.spawn(p, true);
    this.emit({ type: 'phase', phase: this.phase });
  }

  addPlayer({ name, color, isBot, skill }) {
    const p = {
      id: this.players.length,
      name,
      color,
      isBot,
      ps: createPlayerState(),
      prevOrigin: [0, 0, 0],
      alive: false,
      respawnAt: 0,
      deathTime: 0,
      spawnTime: 0,
      score: 0,
      deaths: 0,
      shots: 0,
      hits: 0,
      reload: 0,
      lastKillTime: -99,
      railStreak: 0,
      excellent: 0,
      impressive: 0,
      killer: null,
      stepAccum: 0,
      lastPad: null,
      lastPadTime: -9,
      padFlight: false,
      firing: false,
    };
    if (isBot) p.brain = new BotBrain(this, p, skill);
    this.players.push(p);
    return p;
  }

  emit(ev) {
    this.events.push(ev);
  }

  eye(p) {
    return [p.ps.origin[0], p.ps.origin[1] + p.ps.viewheight, p.ps.origin[2]];
  }

  // Line of sight between two points (world only).
  visible(a, b) {
    return this.world.trace(a, b, ZERO, ZERO, this._tr).fraction === 1;
  }

  selectSpawn(p) {
    const enemies = this.players.filter((o) => o !== p && o.alive);
    const spots = this.map.spawns.map((s) => {
      let nearest = Infinity;
      for (const o of enemies) {
        const d = Math.hypot(o.ps.origin[0] - s.pos[0], o.ps.origin[1] - s.pos[1], o.ps.origin[2] - s.pos[2]);
        if (d < nearest) nearest = d;
      }
      return { s, nearest };
    });
    const free = spots.filter((x) => x.nearest > 80);
    const list = (free.length ? free : spots).sort((a, b) => b.nearest - a.nearest);
    // random pick among the furthest half, like SelectRandomFurthestSpawnPoint
    const half = Math.max(1, Math.ceil(list.length / 2));
    return list[Math.floor(this.random() * half)].s;
  }

  spawn(p, initial = false) {
    const s = this.selectSpawn(p);
    const ps = createPlayerState();
    ps.origin = s.pos.slice();
    ps.yaw = s.yaw;
    ps.pitch = 0;
    p.ps = ps;
    p.prevOrigin = ps.origin.slice();
    p.alive = true;
    p.spawnTime = this.time;
    p.reload = initial ? 0 : 0.5;
    p.railStreak = 0;
    p.padFlight = false;
    p.firing = false;
    if (p.brain) p.brain.onSpawn();
    this.emit({ type: 'spawn', player: p, initial });
  }

  step(dt, localCmd) {
    this.time += dt;
    this.updatePhase();
    const frozen = this.phase !== 'playing';
    for (const p of this.players) {
      p.prevOrigin[0] = p.ps.origin[0];
      p.prevOrigin[1] = p.ps.origin[1];
      p.prevOrigin[2] = p.ps.origin[2];
      if (!p.alive) {
        this.checkRespawn(p, localCmd);
        continue;
      }
      let cmd = p.isBot ? p.brain.think(dt) : localCmd || NO_CMD;
      if (frozen) cmd = NO_CMD;
      const startPos = p.ps.origin.slice();
      const wasGround = p.ps.onGround;
      const ev = pmove(p.ps, cmd, this.world, dt);
      if (ev.jumped) this.emit({ type: 'jump', player: p });
      if (ev.landed > 180 && !wasGround) this.emit({ type: 'land', player: p, speed: ev.landed });
      if (p.ps.onGround) {
        p.padFlight = false;
        const moved = Math.hypot(p.ps.origin[0] - startPos[0], p.ps.origin[2] - startPos[2]);
        if (moved / dt > 150 && !p.ps.ducked) {
          p.stepAccum += moved;
          if (p.stepAccum > 88) {
            p.stepAccum = 0;
            this.emit({ type: 'footstep', player: p });
          }
        }
      }
      this.touchTriggers(p);
      if (!p.alive) continue;
      p.reload = Math.max(0, p.reload - dt);
      p.firing = !!cmd.fire;
      if (cmd.fire && p.reload <= 0 && !frozen) this.fireRail(p);
    }
    this.checkLimits();
  }

  updatePhase() {
    if (this.phase === 'countdown') {
      const left = Math.ceil(this.phaseEnd - this.time);
      if (left < this.lastCount && left > 0) {
        this.lastCount = left;
        this.emit({ type: 'countdown', n: left });
      }
      if (this.time >= this.phaseEnd) {
        this.phase = 'playing';
        this.matchStart = this.time;
        this.emit({ type: 'phase', phase: 'playing' });
        this.emit({ type: 'announce', text: 'FIGHT!', voice: 'Fight!' });
      }
    } else if (this.phase === 'playing') {
      this.matchTime = this.time - this.matchStart;
      const left = this.opts.timeLimit - this.matchTime;
      if (this.opts.timeLimit) {
        if (left <= 300 && this.opts.timeLimit > 300 && !this.timeAnnounced.has(5)) {
          this.timeAnnounced.add(5);
          this.emit({ type: 'announce', text: '5 minutes remaining', voice: 'Five minutes remaining', small: true });
        }
        if (left <= 60 && this.opts.timeLimit > 60 && !this.timeAnnounced.has(1)) {
          this.timeAnnounced.add(1);
          this.emit({ type: 'announce', text: '1 minute remaining', voice: 'One minute remaining', small: true });
        }
      }
    }
  }

  checkRespawn(p, localCmd) {
    if (this.phase === 'intermission') return;
    if (p.isBot) {
      if (this.time >= p.respawnAt) this.spawn(p);
      return;
    }
    const wants = localCmd && (localCmd.fire || localCmd.up > 0);
    if (!wants) p.respawnReleased = true;
    if (this.time >= p.respawnAt + 3.5 || (this.time >= p.respawnAt && wants && p.respawnReleased)) this.spawn(p);
  }

  touchTriggers(p) {
    const o = p.ps.origin;
    const mins = [o[0] + p.ps.mins[0], o[1] + p.ps.mins[1], o[2] + p.ps.mins[2]];
    const maxs = [o[0] + p.ps.maxs[0], o[1] + p.ps.maxs[1], o[2] + p.ps.maxs[2]];
    for (const pad of this.map.pads) {
      if (touches(mins, maxs, pad.mins, pad.maxs)) {
        p.ps.velocity[0] = pad.velocity[0];
        p.ps.velocity[1] = pad.velocity[1];
        p.ps.velocity[2] = pad.velocity[2];
        p.ps.onGround = false;
        p.padFlight = true;
        if (p.lastPad !== pad || this.time - p.lastPadTime > 0.5) {
          this.emit({ type: 'pad', player: p, pad });
        }
        p.lastPad = pad;
        p.lastPadTime = this.time;
      }
    }
    for (const h of this.map.hazards) {
      if (touches(mins, maxs, h.mins, h.maxs)) {
        this.kill(p, null, h.kind);
        return;
      }
    }
    if (o[1] < this.map.killY) this.kill(p, null, 'void');
  }

  fireRail(p) {
    p.reload = RAIL_RELOAD;
    p.shots++;
    const start = this.eye(p);
    const { forward, right } = viewAngleVectors(p.ps.yaw, p.ps.pitch);
    const end = [start[0] + forward[0] * RAIL_RANGE, start[1] + forward[1] * RAIL_RANGE, start[2] + forward[2] * RAIL_RANGE];
    const tr = this.world.trace(start, end, ZERO, ZERO, this._tr);
    const wallDist = tr.fraction * RAIL_RANGE;
    const hitWorld = tr.fraction < 1;
    const normal = tr.normal.slice();
    const hits = [];
    for (const o of this.players) {
      if (o === p || !o.alive) continue;
      const bmin = [o.ps.origin[0] + o.ps.mins[0], o.ps.origin[1] + o.ps.mins[1], o.ps.origin[2] + o.ps.mins[2]];
      const bmax = [o.ps.origin[0] + o.ps.maxs[0], o.ps.origin[1] + o.ps.maxs[1], o.ps.origin[2] + o.ps.maxs[2]];
      const t = rayAABB(start, forward, bmin, bmax, wallDist);
      if (t >= 0) hits.push({ o, t });
    }
    hits.sort((a, b) => a.t - b.t);
    const muzzle = [
      start[0] + forward[0] * 18 + right[0] * 7,
      start[1] + forward[1] * 18 - 8,
      start[2] + forward[2] * 18 + right[2] * 7,
    ];
    const endPos = [start[0] + forward[0] * wallDist, start[1] + forward[1] * wallDist, start[2] + forward[2] * wallDist];
    this.emit({
      type: 'rail',
      player: p,
      start: muzzle,
      eye: start,
      end: endPos,
      dir: forward,
      normal,
      hitWorld,
      hits: hits.map((h) => h.o),
    });
    // the rail goes through everyone in its path
    for (const h of hits) this.kill(h.o, p, 'rail', forward);
    for (const o of this.players) if (o.brain && o !== p) o.brain.heardShot(p, start, endPos);
    if (hits.length) {
      p.hits++;
      p.railStreak += hits.length >= 2 ? 2 : 1;
      if (p.railStreak >= 2) {
        p.railStreak -= 2;
        p.impressive++;
        this.emit({ type: 'award', player: p, kind: 'impressive' });
      }
    } else {
      p.railStreak = 0;
    }
  }

  kill(victim, attacker, cause, dir = null) {
    if (!victim.alive || this.phase === 'intermission') return;
    victim.alive = false;
    victim.deaths++;
    victim.deathTime = this.time;
    victim.respawnAt = this.time + (victim.isBot ? 1.4 + this.random() * 1.2 : 1.2);
    victim.respawnReleased = false;
    victim.killer = attacker && attacker !== victim ? attacker : null;
    const vname = victim.name;
    let text;
    if (attacker && attacker !== victim) {
      attacker.score++;
      text = DEATH_TEXT[cause](vname, attacker.name);
      if (this.time - attacker.lastKillTime < EXCELLENT_TIME) {
        attacker.excellent++;
        this.emit({ type: 'award', player: attacker, kind: 'excellent' });
      }
      attacker.lastKillTime = this.time;
    } else {
      victim.score--;
      text = DEATH_TEXT[cause](vname);
    }
    const v = victim.ps.velocity;
    this.emit({
      type: 'frag',
      victim,
      attacker: victim.killer,
      cause,
      text,
      pos: victim.ps.origin.slice(),
      vel: [v[0] + (dir ? dir[0] * 250 : 0), v[1] + 120 + (dir ? dir[1] * 250 : 0), v[2] + (dir ? dir[2] * 250 : 0)],
    });
    if (victim.brain) victim.brain.onDeath();
    if (attacker && attacker.brain && attacker !== victim) attacker.brain.onKill(victim);
    this.onScoreChange(attacker && attacker !== victim ? attacker : victim);
  }

  ranking() {
    return this.players.slice().sort((a, b) => b.score - a.score || a.deaths - b.deaths || a.id - b.id);
  }

  rankOf(p) {
    let rank = 1;
    let tied = false;
    for (const o of this.players) {
      if (o === p) continue;
      if (o.score > p.score) rank++;
      else if (o.score === p.score) tied = true;
    }
    return { rank, tied };
  }

  onScoreChange(changed) {
    // lead announcements for the local player
    if (this.local) {
      const { rank, tied } = this.rankOf(this.local);
      const state = rank === 1 ? (tied ? 'tied' : 'lead') : 'behind';
      if (state !== this.leadState && this.phase === 'playing') {
        if (state === 'lead') this.emit({ type: 'announce', text: 'You have taken the lead', voice: 'You have taken the lead', small: true });
        else if (state === 'tied') this.emit({ type: 'announce', text: 'You are tied for the lead', voice: 'You are tied for the lead', small: true });
        else if (this.leadState) this.emit({ type: 'announce', text: 'You have lost the lead', voice: 'You have lost the lead', small: true });
      }
      this.leadState = state;
    }
    const top = Math.max(...this.players.map((p) => p.score));
    const left = this.opts.fragLimit - top;
    if (this.opts.fragLimit && left >= 1 && left <= 3 && !this.fragsLeftAnnounced.has(left) && changed.score === top) {
      this.fragsLeftAnnounced.add(left);
      const words = ['', 'One frag left', 'Two frags left', 'Three frags left'];
      this.emit({ type: 'announce', text: words[left], voice: words[left], small: true });
    }
  }

  checkLimits() {
    if (this.phase !== 'playing') return;
    const ranking = this.ranking();
    const top = ranking[0];
    const tie = ranking.length > 1 && ranking[1].score === top.score;
    if (this.opts.fragLimit && top.score >= this.opts.fragLimit) {
      this.endMatch(top, 'Fraglimit hit');
      return;
    }
    if (this.opts.timeLimit && this.matchTime >= this.opts.timeLimit) {
      if (tie) {
        if (!this.suddenDeath) {
          this.suddenDeath = true;
          this.emit({ type: 'announce', text: 'SUDDEN DEATH', voice: 'Sudden death' });
        }
      } else {
        this.endMatch(top, 'Timelimit hit');
      }
    }
  }

  endMatch(winner, reason) {
    this.phase = 'intermission';
    this.winner = winner;
    this.endReason = reason;
    this.intermissionStart = this.time;
    this.emit({ type: 'phase', phase: 'intermission', winner, reason });
  }
}

export const NO_CMD = { forward: 0, right: 0, up: 0, fire: false };
const ZERO = [0, 0, 0];

function touches(amin, amax, bmin, bmax) {
  return amin[0] <= bmax[0] && amax[0] >= bmin[0] && amin[1] <= bmax[1] && amax[1] >= bmin[1] && amin[2] <= bmax[2] && amax[2] >= bmin[2];
}

function shuffle(a, random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export { PLAYER_MINS, PLAYER_MAXS };
