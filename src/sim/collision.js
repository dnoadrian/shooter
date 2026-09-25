// Quake 3 style collision: the world is a set of convex brushes (each an
// intersection of half-spaces) and movement is done by sweeping an axis
// aligned box through them (CM_TraceThroughBrush).

export const SURFACE_CLIP_EPSILON = 0.125;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Clip a convex polygon against the half-space n·p <= d.
function clipPolygon(poly, n, d) {
  const eps = 0.01;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = dot(a, n) - d;
    const db = dot(b, n) - d;
    if (da <= eps) out.push(a);
    if ((da < -eps && db > eps) || (da > eps && db < -eps)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

function planeBasePolygon(n, d) {
  const S = 65536;
  const up = Math.abs(n[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  // u = up x n, v = n x u  => u x v = n, so the quad winds CCW seen from the front.
  let u = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
  const ul = Math.hypot(u[0], u[1], u[2]);
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const c = [n[0] * d, n[1] * d, n[2] * d];
  const p = (su, sv) => [c[0] + u[0] * su + v[0] * sv, c[1] + u[1] * su + v[1] * sv, c[2] + u[2] * su + v[2] * sv];
  return [p(-S, -S), p(S, -S), p(S, S), p(-S, S)];
}

export class Brush {
  // planes: [{ n: [x, y, z] (unit, pointing out of the brush), d }]
  constructor(planes, opts = {}) {
    this.planes = planes.map((p) => ({ n: p.n.slice(), d: p.d }));
    this.solid = opts.solid !== false;
    this.visible = opts.visible !== false;
    this.castShadow = opts.castShadow !== false;
    this.mat = opts.mat || 'stone';
    this.top = opts.top || this.mat;
    this.bottom = opts.bottom || this.mat;
    this.side = opts.side || this.mat;
    this.buildFaces();
  }

  buildFaces() {
    this.faces = [];
    const mins = [Infinity, Infinity, Infinity];
    const maxs = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.planes.length; i++) {
      const { n, d } = this.planes[i];
      let poly = planeBasePolygon(n, d);
      for (let j = 0; j < this.planes.length && poly.length >= 3; j++) {
        if (j !== i) poly = clipPolygon(poly, this.planes[j].n, this.planes[j].d);
      }
      if (poly.length < 3) continue;
      // Drop degenerate (zero area) faces such as the low end of a wedge.
      let area = 0;
      for (let k = 1; k + 1 < poly.length; k++) {
        const a = poly[0], b = poly[k], c = poly[k + 1];
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        area += Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
      }
      if (area < 1) continue;
      for (const p of poly) {
        for (let k = 0; k < 3; k++) {
          if (p[k] < mins[k]) mins[k] = p[k];
          if (p[k] > maxs[k]) maxs[k] = p[k];
        }
      }
      const mat = n[1] > 0.7 ? this.top : n[1] < -0.7 ? this.bottom : this.side;
      this.faces.push({ n, d, poly, mat });
    }
    this.mins = mins;
    this.maxs = maxs;
  }
}

// Axis aligned box brush.
export function boxBrush(min, max, opts) {
  return new Brush(
    [
      { n: [1, 0, 0], d: max[0] },
      { n: [-1, 0, 0], d: -min[0] },
      { n: [0, 1, 0], d: max[1] },
      { n: [0, -1, 0], d: -min[1] },
      { n: [0, 0, 1], d: max[2] },
      { n: [0, 0, -1], d: -min[2] },
    ],
    opts,
  );
}

// Wedge / ramp: footprint min..max on x and z, floor at min[1], the top
// surface rises from `low` to `high` towards `dir` ('+x', '-x', '+z', '-z').
export function rampBrush(min, max, low, high, dir, opts) {
  const axis = dir[1] === 'x' ? 0 : 2;
  const sign = dir[0] === '+' ? 1 : -1;
  const len = max[axis] - min[axis];
  const rise = high - low;
  // Top plane normal: up, tilted away from the rising direction.
  const n = [0, len, 0];
  n[axis] = -sign * rise;
  const l = Math.hypot(n[0], n[1], n[2]);
  n[0] /= l; n[1] /= l; n[2] /= l;
  const lowPoint = [0, low, 0];
  lowPoint[axis] = sign > 0 ? min[axis] : max[axis];
  const planes = [
    { n: [1, 0, 0], d: max[0] },
    { n: [-1, 0, 0], d: -min[0] },
    { n: [0, 0, 1], d: max[2] },
    { n: [0, 0, -1], d: -min[2] },
    { n: [0, -1, 0], d: -min[1] },
    { n, d: n[0] * lowPoint[0] + n[1] * lowPoint[1] + n[2] * lowPoint[2] },
  ];
  return new Brush(planes, opts);
}

// Rotate a brush by k * 90 degrees about the vertical axis through the origin.
export function rotateBrush(brush, k) {
  const planes = brush.planes.map(({ n, d }) => ({ n: rotY(n, k), d }));
  return new Brush(planes, {
    solid: brush.solid,
    visible: brush.visible,
    castShadow: brush.castShadow,
    mat: brush.mat,
    top: brush.top,
    bottom: brush.bottom,
    side: brush.side,
  });
}

// (x, z) -> (-z, x) applied k times.
export function rotY(v, k) {
  let x = v[0], z = v[2];
  for (let i = 0; i < (((k % 4) + 4) % 4); i++) {
    const nx = -z;
    z = x;
    x = nx;
  }
  return [x, v[1], z];
}

export class TraceResult {
  constructor() {
    this.fraction = 1;
    this.endpos = [0, 0, 0];
    this.normal = [0, 1, 0];
    this.startsolid = false;
    this.allsolid = false;
    this.brush = null;
  }
}

export class World {
  constructor(brushes) {
    this.brushes = brushes;
    this.solids = brushes.filter((b) => b.solid);
  }

  // Sweep the box [mins, maxs] from start to end. Mirrors CM_BoxTrace.
  trace(start, end, mins, maxs, out = new TraceResult()) {
    out.fraction = 1;
    out.startsolid = false;
    out.allsolid = false;
    out.brush = null;
    out.normal[0] = 0; out.normal[1] = 1; out.normal[2] = 0;
    const bmin0 = Math.min(start[0], end[0]) + mins[0] - 1;
    const bmin1 = Math.min(start[1], end[1]) + mins[1] - 1;
    const bmin2 = Math.min(start[2], end[2]) + mins[2] - 1;
    const bmax0 = Math.max(start[0], end[0]) + maxs[0] + 1;
    const bmax1 = Math.max(start[1], end[1]) + maxs[1] + 1;
    const bmax2 = Math.max(start[2], end[2]) + maxs[2] + 1;
    const solids = this.solids;
    for (let i = 0; i < solids.length; i++) {
      const b = solids[i];
      if (b.mins[0] > bmax0 || b.maxs[0] < bmin0 || b.mins[1] > bmax1 || b.maxs[1] < bmin1 || b.mins[2] > bmax2 || b.maxs[2] < bmin2) continue;
      traceBrush(out, b, start, end, mins, maxs);
      if (out.allsolid) break;
    }
    const f = out.fraction;
    out.endpos[0] = start[0] + (end[0] - start[0]) * f;
    out.endpos[1] = start[1] + (end[1] - start[1]) * f;
    out.endpos[2] = start[2] + (end[2] - start[2]) * f;
    return out;
  }
}

function traceBrush(tw, brush, start, end, mins, maxs) {
  let enterFrac = -1;
  let leaveFrac = 1;
  let clipPlane = null;
  let getout = false;
  let startout = false;
  const planes = brush.planes;
  for (let i = 0; i < planes.length; i++) {
    const p = planes[i];
    const n = p.n;
    // Push the plane out by the box extents (the corner deepest into the plane).
    const ox = n[0] < 0 ? maxs[0] : mins[0];
    const oy = n[1] < 0 ? maxs[1] : mins[1];
    const oz = n[2] < 0 ? maxs[2] : mins[2];
    const dist = p.d - (ox * n[0] + oy * n[1] + oz * n[2]);
    const d1 = start[0] * n[0] + start[1] * n[1] + start[2] * n[2] - dist;
    const d2 = end[0] * n[0] + end[1] * n[1] + end[2] * n[2] - dist;
    if (d2 > 0) getout = true;
    if (d1 > 0) startout = true;
    // completely in front of face, no intersection with the entire brush
    if (d1 > 0 && (d2 >= SURFACE_CLIP_EPSILON || d2 >= d1)) return;
    // completely behind the face
    if (d1 <= 0 && d2 <= 0) continue;
    if (d1 > d2) {
      // entering
      let f = (d1 - SURFACE_CLIP_EPSILON) / (d1 - d2);
      if (f < 0) f = 0;
      if (f > enterFrac) {
        enterFrac = f;
        clipPlane = p;
      }
    } else {
      // leaving
      let f = (d1 + SURFACE_CLIP_EPSILON) / (d1 - d2);
      if (f > 1) f = 1;
      if (f < leaveFrac) leaveFrac = f;
    }
  }
  if (!startout) {
    tw.startsolid = true;
    if (!getout) {
      tw.allsolid = true;
      tw.fraction = 0;
      tw.brush = brush;
    }
    return;
  }
  if (enterFrac < leaveFrac && enterFrac > -1 && enterFrac < tw.fraction) {
    if (enterFrac < 0) enterFrac = 0;
    tw.fraction = enterFrac;
    tw.normal[0] = clipPlane.n[0];
    tw.normal[1] = clipPlane.n[1];
    tw.normal[2] = clipPlane.n[2];
    tw.brush = brush;
  }
}

// Ray vs axis aligned box (slab test). Returns entry distance along the unit
// direction or -1 when missed.
export function rayAABB(o, dir, bmin, bmax, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-9) {
      if (o[i] < bmin[i] || o[i] > bmax[i]) return -1;
    } else {
      const inv = 1 / dir[i];
      let t1 = (bmin[i] - o[i]) * inv;
      let t2 = (bmax[i] - o[i]) * inv;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}
