// Player movement, ported from Quake 3's bg_pmove.c (Y is up here).
// Keeps the things that make Q3 movement feel like Q3: ground friction,
// weak air acceleration (strafe jumping), step-slide moves and ramps.

import { TraceResult } from './collision.js';

export const PM = {
  stopspeed: 100,
  duckScale: 0.25,
  accelerate: 10,
  airaccelerate: 1,
  friction: 6,
  speed: 320,
  gravity: 800,
  jumpVelocity: 270,
  stepSize: 18,
  minWalkNormal: 0.7,
  overclip: 1.001,
};

export const PLAYER_MINS = [-15, -24, -15];
export const PLAYER_MAXS = [15, 32, 15];
export const CROUCH_MAXS_Y = 16;
export const VIEWHEIGHT = 26;
export const CROUCH_VIEWHEIGHT = 12;

const MAX_CLIP_PLANES = 5;

export function createPlayerState() {
  return {
    origin: [0, 0, 0],
    velocity: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    mins: PLAYER_MINS.slice(),
    maxs: PLAYER_MAXS.slice(),
    viewheight: VIEWHEIGHT,
    ducked: false,
    onGround: false,
    groundNormal: [0, 1, 0],
    jumpHeld: false,
  };
}

// cmd: { forward, right, up } each in [-1, 1]; yaw/pitch taken from ps.
export function pmove(ps, cmd, world, dt, autoHop = true) {
  const pml = {
    frametime: dt,
    walking: false,
    groundPlane: false,
    groundTrace: new TraceResult(),
    impactSpeed: 0,
    events: { jumped: false, landed: 0, stepped: false },
    forward: [0, 0, 0],
    right: [0, 0, 0],
    cmd: { forward: cmd.forward, right: cmd.right, up: cmd.up },
    world,
    ps,
    autoHop,
  };

  if (cmd.up < 0.1) ps.jumpHeld = false;

  // angle vectors (yaw 0 looks down -z, pitch > 0 looks up)
  const cy = Math.cos(ps.yaw), sy = Math.sin(ps.yaw);
  const cp = Math.cos(ps.pitch), sp = Math.sin(ps.pitch);
  pml.forward[0] = -sy * cp; pml.forward[1] = sp; pml.forward[2] = -cy * cp;
  pml.right[0] = cy; pml.right[1] = 0; pml.right[2] = -sy;

  const wasOnGround = ps.onGround;
  checkDuck(pml);
  groundTrace(pml, wasOnGround);
  if (pml.walking) walkMove(pml);
  else airMove(pml);
  groundTrace(pml, ps.onGround);
  return pml.events;
}

function cmdScale(cmd) {
  const max = Math.max(Math.abs(cmd.forward), Math.abs(cmd.right), Math.abs(cmd.up));
  if (!max) return 0;
  const total = Math.sqrt(cmd.forward * cmd.forward + cmd.right * cmd.right + cmd.up * cmd.up);
  return (PM.speed * max) / total;
}

function clipVelocity(inv, n, out, overbounce) {
  let backoff = inv[0] * n[0] + inv[1] * n[1] + inv[2] * n[2];
  if (backoff < 0) backoff *= overbounce;
  else backoff /= overbounce;
  out[0] = inv[0] - n[0] * backoff;
  out[1] = inv[1] - n[1] * backoff;
  out[2] = inv[2] - n[2] * backoff;
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (l) { v[0] /= l; v[1] /= l; v[2] /= l; }
  return l;
}

function checkDuck(pml) {
  const ps = pml.ps;
  ps.mins[0] = PLAYER_MINS[0]; ps.mins[1] = PLAYER_MINS[1]; ps.mins[2] = PLAYER_MINS[2];
  ps.maxs[0] = PLAYER_MAXS[0]; ps.maxs[2] = PLAYER_MAXS[2];
  if (pml.cmd.up < 0) {
    ps.ducked = true;
  } else if (ps.ducked) {
    // try to stand up
    const tr = pml.world.trace(ps.origin, ps.origin, ps.mins, PLAYER_MAXS);
    if (!tr.allsolid) ps.ducked = false;
  }
  if (ps.ducked) {
    ps.maxs[1] = CROUCH_MAXS_Y;
    ps.viewheight = CROUCH_VIEWHEIGHT;
  } else {
    ps.maxs[1] = PLAYER_MAXS[1];
    ps.viewheight = VIEWHEIGHT;
  }
}

function correctAllSolid(pml) {
  const ps = pml.ps;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (let k = -1; k <= 1; k++) {
        const p = [ps.origin[0] + i, ps.origin[1] + j, ps.origin[2] + k];
        const tr = pml.world.trace(p, p, ps.mins, ps.maxs);
        if (!tr.allsolid) {
          const down = [ps.origin[0], ps.origin[1] - 0.25, ps.origin[2]];
          pml.world.trace(ps.origin, down, ps.mins, ps.maxs, pml.groundTrace);
          return true;
        }
      }
    }
  }
  ps.onGround = false;
  pml.groundPlane = false;
  pml.walking = false;
  return false;
}

function groundTrace(pml, wasOnGround) {
  const ps = pml.ps;
  const point = [ps.origin[0], ps.origin[1] - 0.25, ps.origin[2]];
  const trace = pml.world.trace(ps.origin, point, ps.mins, ps.maxs, pml.groundTrace);
  if (trace.allsolid && !correctAllSolid(pml)) return;
  if (trace.fraction === 1) {
    ps.onGround = false;
    pml.groundPlane = false;
    pml.walking = false;
    return;
  }
  // check if getting thrown off the ground
  const v = ps.velocity, n = trace.normal;
  if (v[1] > 0 && v[0] * n[0] + v[1] * n[1] + v[2] * n[2] > 10) {
    ps.onGround = false;
    pml.groundPlane = false;
    pml.walking = false;
    return;
  }
  // slopes that are too steep will not be considered onground
  if (n[1] < PM.minWalkNormal) {
    ps.onGround = false;
    pml.groundPlane = true;
    pml.walking = false;
    return;
  }
  pml.groundPlane = true;
  pml.walking = true;
  if (!wasOnGround && !ps.onGround) {
    // just hit the ground
    pml.events.landed = Math.max(pml.events.landed, -v[1]);
  }
  ps.onGround = true;
  ps.groundNormal[0] = n[0]; ps.groundNormal[1] = n[1]; ps.groundNormal[2] = n[2];
}

function checkJump(pml) {
  const ps = pml.ps;
  if (pml.cmd.up < 0.1) return false;
  if (ps.jumpHeld && !pml.autoHop) {
    pml.cmd.up = 0;
    return false;
  }
  pml.groundPlane = false;
  pml.walking = false;
  ps.jumpHeld = true;
  ps.onGround = false;
  ps.velocity[1] = PM.jumpVelocity;
  pml.events.jumped = true;
  return true;
}

function friction(pml) {
  const ps = pml.ps;
  const vel = ps.velocity;
  const speed = pml.walking ? Math.hypot(vel[0], vel[2]) : Math.hypot(vel[0], vel[1], vel[2]);
  if (speed < 1) {
    vel[0] = 0;
    vel[2] = 0;
    return;
  }
  let drop = 0;
  if (pml.walking) {
    const control = speed < PM.stopspeed ? PM.stopspeed : speed;
    drop += control * PM.friction * pml.frametime;
  }
  let newspeed = speed - drop;
  if (newspeed < 0) newspeed = 0;
  newspeed /= speed;
  vel[0] *= newspeed;
  vel[1] *= newspeed;
  vel[2] *= newspeed;
}

function accelerate(pml, wishdir, wishspeed, accel) {
  const v = pml.ps.velocity;
  const currentspeed = v[0] * wishdir[0] + v[1] * wishdir[1] + v[2] * wishdir[2];
  const addspeed = wishspeed - currentspeed;
  if (addspeed <= 0) return;
  let accelspeed = accel * pml.frametime * wishspeed;
  if (accelspeed > addspeed) accelspeed = addspeed;
  v[0] += accelspeed * wishdir[0];
  v[1] += accelspeed * wishdir[1];
  v[2] += accelspeed * wishdir[2];
}

function walkMove(pml) {
  const ps = pml.ps;
  if (checkJump(pml)) {
    airMove(pml);
    return;
  }
  friction(pml);
  const fmove = pml.cmd.forward;
  const smove = pml.cmd.right;
  const scale = cmdScale(pml.cmd);

  const n = pml.groundTrace.normal;
  const forward = [pml.forward[0], 0, pml.forward[2]];
  const right = [pml.right[0], 0, pml.right[2]];
  clipVelocity(forward, n, forward, PM.overclip);
  clipVelocity(right, n, right, PM.overclip);
  normalize(forward);
  normalize(right);

  const wishdir = [
    forward[0] * fmove + right[0] * smove,
    forward[1] * fmove + right[1] * smove,
    forward[2] * fmove + right[2] * smove,
  ];
  let wishspeed = normalize(wishdir) * scale;
  if (ps.ducked && wishspeed > PM.speed * PM.duckScale) wishspeed = PM.speed * PM.duckScale;

  accelerate(pml, wishdir, wishspeed, PM.accelerate);

  const v = ps.velocity;
  const vel = Math.hypot(v[0], v[1], v[2]);
  // slide along the ground plane, keeping speed on slopes
  clipVelocity(v, n, v, PM.overclip);
  normalize(v);
  v[0] *= vel; v[1] *= vel; v[2] *= vel;

  if (!v[0] && !v[2]) return;
  stepSlideMove(pml, false);
}

function airMove(pml) {
  const ps = pml.ps;
  friction(pml);
  const fmove = pml.cmd.forward;
  const smove = pml.cmd.right;
  const scale = cmdScale(pml.cmd);
  const forward = [pml.forward[0], 0, pml.forward[2]];
  const right = [pml.right[0], 0, pml.right[2]];
  normalize(forward);
  normalize(right);
  const wishdir = [forward[0] * fmove + right[0] * smove, 0, forward[2] * fmove + right[2] * smove];
  const wishspeed = normalize(wishdir) * scale;
  accelerate(pml, wishdir, wishspeed, PM.airaccelerate);
  // we may have a ground plane that is very steep, even though we don't have
  // a ground entity: slide along the steep plane
  if (pml.groundPlane) clipVelocity(ps.velocity, pml.groundTrace.normal, ps.velocity, PM.overclip);
  stepSlideMove(pml, true);
}

const _tr = new TraceResult();

function slideMove(pml, gravity) {
  const ps = pml.ps;
  const world = pml.world;
  const v = ps.velocity;
  const planes = [];
  const endVelocity = v.slice();
  const clipVel = [0, 0, 0];
  const endClipVel = [0, 0, 0];
  const dir = [0, 0, 0];

  if (gravity) {
    endVelocity[1] -= PM.gravity * pml.frametime;
    v[1] = (v[1] + endVelocity[1]) * 0.5;
    if (pml.groundPlane) clipVelocity(v, pml.groundTrace.normal, v, PM.overclip);
  }
  let timeLeft = pml.frametime;
  if (pml.groundPlane) planes.push(pml.groundTrace.normal.slice());
  const nv = v.slice();
  normalize(nv);
  planes.push(nv);

  let bumpcount;
  const end = [0, 0, 0];
  for (bumpcount = 0; bumpcount < 4; bumpcount++) {
    end[0] = ps.origin[0] + timeLeft * v[0];
    end[1] = ps.origin[1] + timeLeft * v[1];
    end[2] = ps.origin[2] + timeLeft * v[2];
    const trace = world.trace(ps.origin, end, ps.mins, ps.maxs, _tr);
    if (trace.allsolid) {
      v[1] = 0;
      return true;
    }
    if (trace.fraction > 0) {
      ps.origin[0] = trace.endpos[0];
      ps.origin[1] = trace.endpos[1];
      ps.origin[2] = trace.endpos[2];
    }
    if (trace.fraction === 1) break;
    timeLeft -= timeLeft * trace.fraction;
    if (planes.length >= MAX_CLIP_PLANES) {
      v[0] = v[1] = v[2] = 0;
      return true;
    }
    const tn = trace.normal;
    // if this is the same plane we hit before, nudge velocity out along it
    let i;
    for (i = 0; i < planes.length; i++) {
      const p = planes[i];
      if (tn[0] * p[0] + tn[1] * p[1] + tn[2] * p[2] > 0.99) {
        v[0] += tn[0]; v[1] += tn[1]; v[2] += tn[2];
        break;
      }
    }
    if (i < planes.length) continue;
    planes.push(tn.slice());

    // modify velocity so it parallels all of the clip planes
    for (i = 0; i < planes.length; i++) {
      const pi = planes[i];
      const into = v[0] * pi[0] + v[1] * pi[1] + v[2] * pi[2];
      if (into >= 0.1) continue;
      if (-into > pml.impactSpeed) pml.impactSpeed = -into;
      clipVelocity(v, pi, clipVel, PM.overclip);
      clipVelocity(endVelocity, pi, endClipVel, PM.overclip);
      let stop = false;
      for (let j = 0; j < planes.length; j++) {
        if (j === i) continue;
        const pj = planes[j];
        if (clipVel[0] * pj[0] + clipVel[1] * pj[1] + clipVel[2] * pj[2] >= 0.1) continue;
        clipVelocity(clipVel, pj, clipVel, PM.overclip);
        clipVelocity(endClipVel, pj, endClipVel, PM.overclip);
        if (clipVel[0] * pi[0] + clipVel[1] * pi[1] + clipVel[2] * pi[2] >= 0) continue;
        // slide the original velocity along the crease
        dir[0] = pi[1] * pj[2] - pi[2] * pj[1];
        dir[1] = pi[2] * pj[0] - pi[0] * pj[2];
        dir[2] = pi[0] * pj[1] - pi[1] * pj[0];
        normalize(dir);
        let d = dir[0] * v[0] + dir[1] * v[1] + dir[2] * v[2];
        clipVel[0] = dir[0] * d; clipVel[1] = dir[1] * d; clipVel[2] = dir[2] * d;
        d = dir[0] * endVelocity[0] + dir[1] * endVelocity[1] + dir[2] * endVelocity[2];
        endClipVel[0] = dir[0] * d; endClipVel[1] = dir[1] * d; endClipVel[2] = dir[2] * d;
        for (let k = 0; k < planes.length; k++) {
          if (k === i || k === j) continue;
          const pk = planes[k];
          if (clipVel[0] * pk[0] + clipVel[1] * pk[1] + clipVel[2] * pk[2] >= 0.1) continue;
          // stop dead at a triple plane interaction
          stop = true;
          break;
        }
        if (stop) break;
      }
      if (stop) {
        v[0] = v[1] = v[2] = 0;
        return true;
      }
      v[0] = clipVel[0]; v[1] = clipVel[1]; v[2] = clipVel[2];
      endVelocity[0] = endClipVel[0]; endVelocity[1] = endClipVel[1]; endVelocity[2] = endClipVel[2];
      break;
    }
  }
  if (gravity) {
    v[0] = endVelocity[0]; v[1] = endVelocity[1]; v[2] = endVelocity[2];
  }
  return bumpcount !== 0;
}

function stepSlideMove(pml, gravity) {
  const ps = pml.ps;
  const world = pml.world;
  const startO = ps.origin.slice();
  const startV = ps.velocity.slice();
  if (!slideMove(pml, gravity)) return; // got exactly where we wanted first try

  const down = [startO[0], startO[1] - PM.stepSize, startO[2]];
  let trace = world.trace(startO, down, ps.mins, ps.maxs, _tr);
  // never step up when you still have up velocity
  if (ps.velocity[1] > 0 && (trace.fraction === 1 || trace.normal[1] < 0.7)) return;

  const up = [startO[0], startO[1] + PM.stepSize, startO[2]];
  trace = world.trace(startO, up, ps.mins, ps.maxs, _tr);
  if (trace.allsolid) return; // can't step up
  const stepSize = trace.endpos[1] - startO[1];
  ps.origin[0] = trace.endpos[0]; ps.origin[1] = trace.endpos[1]; ps.origin[2] = trace.endpos[2];
  ps.velocity[0] = startV[0]; ps.velocity[1] = startV[1]; ps.velocity[2] = startV[2];
  slideMove(pml, gravity);

  // push down the final amount
  const down2 = [ps.origin[0], ps.origin[1] - stepSize, ps.origin[2]];
  trace = world.trace(ps.origin, down2, ps.mins, ps.maxs, _tr);
  if (!trace.allsolid) {
    ps.origin[0] = trace.endpos[0]; ps.origin[1] = trace.endpos[1]; ps.origin[2] = trace.endpos[2];
  }
  if (trace.fraction < 1) clipVelocity(ps.velocity, trace.normal, ps.velocity, PM.overclip);
  if (ps.origin[1] - startO[1] > 2) pml.events.stepped = true;
}

export function viewAngleVectors(yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return {
    forward: [-sy * cp, sp, -cy * cp],
    right: [cy, 0, -sy],
  };
}
