// Procedural textures (no image assets): gothic stone, worn metal, grates,
// hazard crates and glowing trims, each with a matching normal map.

import * as THREE from '../../vendor/three.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable value noise, `cells` lattice points across the texture.
function valueNoise(size, cells, seed) {
  const r = rng(seed);
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = r();
  const out = new Float32Array(size * size);
  const scale = cells / size;
  for (let y = 0; y < size; y++) {
    const fy = y * scale;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    const r0 = (y0 % cells) * cells;
    const r1 = ((y0 + 1) % cells) * cells;
    for (let x = 0; x < size; x++) {
      const fx = x * scale;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const c0 = x0 % cells;
      const c1 = (x0 + 1) % cells;
      const a = lattice[r0 + c0] + (lattice[r0 + c1] - lattice[r0 + c0]) * sx;
      const b = lattice[r1 + c0] + (lattice[r1 + c1] - lattice[r1 + c0]) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  }
  return out;
}

function fbm(size, baseCells, octaves, seed) {
  const out = new Float32Array(size * size);
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(size, baseCells << o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

class Tex {
  constructor(size) {
    this.size = size;
    this.color = new Float32Array(size * size * 3);
    this.height = new Float32Array(size * size);
    this.emit = null;
  }
  set(i, r, g, b, h) {
    this.color[i * 3] = r;
    this.color[i * 3 + 1] = g;
    this.color[i * 3 + 2] = b;
    this.height[i] = h;
  }
  glow(i, r, g, b) {
    if (!this.emit) this.emit = new Float32Array(this.size * this.size * 3);
    this.emit[i * 3] = r;
    this.emit[i * 3 + 1] = g;
    this.emit[i * 3 + 2] = b;
  }
}

function toCanvas(size, data, channels = 3) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    for (let k = 0; k < 3; k++) img.data[i * 4 + k] = Math.max(0, Math.min(255, data[i * channels + k] * 255));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function normalCanvas(size, height, strength) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const h = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (-dx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---- individual texture painters -----------------------------------------

function stoneBlocks(size, seed, base, opts = {}) {
  const t = new Tex(size);
  const n = fbm(size, 8, 5, seed);
  const n2 = fbm(size, 32, 3, seed + 7);
  const rows = opts.rows || 4;
  const bh = size / rows;
  const r = rng(seed + 3);
  const offsets = Array.from({ length: rows }, (_, i) => (i % 2 ? 0.5 : 0) + (r() - 0.5) * 0.2);
  const cols = opts.cols || 2;
  const tint = Array.from({ length: rows * cols * 2 }, () => 0.85 + r() * 0.3);
  const mortar = opts.mortar || 3;
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / bh);
    const yy = y - row * bh;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const bw = size / cols;
      const xs = (x + offsets[row] * bw + size) % size;
      const col = Math.floor(xs / bw);
      const xx = xs - col * bw;
      const edge = Math.min(yy, bh - yy, xx, bw - xx);
      const noise = n[i] * 0.7 + n2[i] * 0.3;
      let h = Math.min(1, edge / (mortar * 2.5)) * 0.6 + noise * 0.4;
      let k = tint[row * cols + col] * (0.65 + noise * 0.55);
      if (edge < mortar) {
        k *= 0.35;
        h = 0.05 + noise * 0.1;
      } else if (edge < mortar + 2) {
        k *= 0.8;
      }
      // grime towards block bottoms
      k *= 1 - Math.max(0, yy / bh - 0.7) * 0.4;
      t.set(i, base[0] * k, base[1] * k, base[2] * k, h);
    }
  }
  return t;
}

function metalPlates(size, seed, base, opts = {}) {
  const t = new Tex(size);
  const n = fbm(size, 8, 5, seed);
  const scratch = fbm(size, 64, 2, seed + 9);
  const plate = opts.plate || size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const px = x % plate, py = y % plate;
      const edge = Math.min(px, py, plate - px, plate - py);
      let k = 0.55 + n[i] * 0.45 + (scratch[i] > 0.62 ? 0.12 : 0);
      let h = 0.6 + n[i] * 0.1;
      if (edge < 2) {
        k *= 0.3;
        h = 0.1;
      } else if (edge < 5) {
        k *= 1.15;
        h = 0.75;
      }
      // rivets
      const rv = [[10, 10], [plate - 10, 10], [10, plate - 10], [plate - 10, plate - 10]];
      for (const [rx, ry] of rv) {
        const d = Math.hypot(px - rx, py - ry);
        if (d < 4) {
          h = 0.9 - d * 0.05;
          k = 0.9 - d * 0.08;
        }
      }
      if (opts.tread) {
        // diamond tread pattern
        const u = (x + y) % 16, v = (x - y + 1024) % 16;
        if (Math.abs(u - 8) < 2 && Math.abs(v - 8) < 5) {
          h += 0.2;
          k *= 1.2;
        }
      }
      const rust = Math.max(0, n[i] - 0.58) * 2.2;
      t.set(i, base[0] * k + rust * 0.28, base[1] * k + rust * 0.1, base[2] * k, h);
    }
  }
  return t;
}

function grate(size, seed) {
  const t = new Tex(size);
  const n = fbm(size, 8, 4, seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const gx = x % 32, gy = y % 32;
      const bar = gx < 6 || gy < 4;
      const k = bar ? 0.5 + n[i] * 0.4 : 0.06 + n[i] * 0.05;
      const h = bar ? 0.8 : 0.0;
      t.set(i, k * 0.8, k * 0.75, k * 0.68, h);
    }
  }
  return t;
}

function pillar(size, seed) {
  const t = new Tex(size);
  const n = fbm(size, 8, 5, seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const fl = (x % 32) / 32;
      const groove = Math.sin(fl * Math.PI);
      const band = y % 128 < 10;
      let k = (0.5 + n[i] * 0.4) * (0.6 + groove * 0.4);
      let h = groove * 0.7 + n[i] * 0.2;
      if (band) {
        k = 0.35 + n[i] * 0.2;
        h = 0.9;
      }
      t.set(i, k * 0.62, k * 0.55, k * 0.48, h);
    }
  }
  return t;
}

function towerPanels(size, seed) {
  const t = metalPlates(size, seed, [0.3, 0.3, 0.33], { plate: size / 4 });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const cx = x % 128;
      const glow = Math.abs(cx - 64) < 3 && y % 128 > 16 && y % 128 < 112;
      if (glow) {
        const k = 1 - Math.abs(cx - 64) / 3;
        t.set(i, 1, 0.5, 0.15, 0.3);
        t.glow(i, 1.0 * k + 0.3, 0.38 * k + 0.1, 0.08);
      }
    }
  }
  return t;
}

function crate(size, seed) {
  const t = metalPlates(size, seed, [0.42, 0.4, 0.36], { plate: size });
  const b = 40;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const edge = Math.min(x, y, size - x, size - y);
      if (edge < b) {
        const stripe = Math.floor((x + y) / 24) % 2 === 0;
        const k = 0.8 + Math.random() * 0.1;
        if (stripe) t.set(i, 0.85 * k, 0.62 * k, 0.08, 0.7);
        else t.set(i, 0.08, 0.08, 0.08, 0.7);
      } else if (Math.abs(x - y) < 10 || Math.abs(x + y - size) < 10) {
        t.set(i, 0.3, 0.29, 0.27, 0.9);
      }
    }
  }
  return t;
}

function lavaRock(size, seed) {
  const t = new Tex(size);
  const n = fbm(size, 6, 5, seed);
  const cracks = fbm(size, 12, 4, seed + 5);
  for (let i = 0; i < size * size; i++) {
    const c = Math.abs(cracks[i] - 0.5);
    const k = 0.2 + n[i] * 0.25;
    if (c < 0.025) {
      const g = 1 - c / 0.025;
      t.set(i, 0.8, 0.3, 0.05, 0.1);
      t.glow(i, 1.2 * g, 0.35 * g, 0.03 * g);
    } else {
      t.set(i, k * 0.9, k * 0.6, k * 0.5, 0.5 + n[i] * 0.5);
    }
  }
  return t;
}

function trim(size, seed) {
  const t = metalPlates(size, seed, [0.45, 0.42, 0.4], { plate: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const d = Math.abs((y % 64) - 32);
      if (d < 4) {
        const g = 1 - d / 4;
        t.set(i, 1, 0.55, 0.2, 0.4);
        t.glow(i, 1.1 * g + 0.2, 0.45 * g + 0.05, 0.1 * g);
      }
    }
  }
  return t;
}

const PAINTERS = {
  floor: () => metalPlates(512, 11, [0.46, 0.42, 0.38], { plate: 128 }),
  metal: () => metalPlates(256, 12, [0.44, 0.44, 0.46], { plate: 128, tread: true }),
  stone: () => stoneBlocks(512, 13, [0.52, 0.45, 0.38], { rows: 4, cols: 2 }),
  stone2: () => stoneBlocks(512, 14, [0.44, 0.38, 0.34], { rows: 8, cols: 4 }),
  wall: () => stoneBlocks(512, 15, [0.5, 0.42, 0.36], { rows: 3, cols: 2, mortar: 4 }),
  grate: () => grate(256, 16),
  pillar: () => pillar(256, 17),
  tower: () => towerPanels(512, 18),
  crate: () => crate(256, 19),
  lavarock: () => lavaRock(256, 20),
  trim: () => trim(128, 21),
};

const MATERIAL_PARAMS = {
  floor: { roughness: 0.55, metalness: 0.55, normal: 2.5, scale: 256 },
  metal: { roughness: 0.5, metalness: 0.6, normal: 3, scale: 128 },
  stone: { roughness: 0.9, metalness: 0.0, normal: 4, scale: 256 },
  stone2: { roughness: 0.9, metalness: 0.0, normal: 4, scale: 256 },
  wall: { roughness: 0.92, metalness: 0.0, normal: 4, scale: 384 },
  grate: { roughness: 0.6, metalness: 0.6, normal: 4, scale: 64 },
  pillar: { roughness: 0.85, metalness: 0.05, normal: 3, scale: 128 },
  tower: { roughness: 0.45, metalness: 0.65, normal: 2.5, scale: 256 },
  crate: { roughness: 0.6, metalness: 0.4, normal: 2, scale: 80 },
  lavarock: { roughness: 0.95, metalness: 0.0, normal: 3, scale: 192 },
  trim: { roughness: 0.4, metalness: 0.6, normal: 2, scale: 64 },
};

export function makeMaterials(anisotropy = 4) {
  const mats = {};
  for (const [name, painter] of Object.entries(PAINTERS)) {
    const t = painter();
    const params = MATERIAL_PARAMS[name];
    const setup = (canvas, srgb) => {
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = anisotropy;
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };
    const mat = new THREE.MeshStandardMaterial({
      map: setup(toCanvas(t.size, t.color), true),
      normalMap: setup(normalCanvas(t.size, t.height, params.normal), false),
      roughness: params.roughness,
      metalness: params.metalness,
    });
    if (t.emit) {
      mat.emissiveMap = setup(toCanvas(t.size, t.emit), true);
      mat.emissive = new THREE.Color(0xffffff);
      mat.emissiveIntensity = 1.6;
    }
    mat.userData.scale = params.scale;
    mats[name] = mat;
  }
  return mats;
}

// Soft round sprite used by particles, glows and flares.
export function glowTexture(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Scorch mark left by a rail on a wall: dark burn plus a glowing ring.
export function scorchTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.25)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Jump pad top: concentric rings with arrows.
export function padTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  const cx = size / 2;
  ctx.strokeStyle = '#fff';
  for (const [r, w, a] of [[0.46, 10, 1], [0.34, 5, 0.7], [0.22, 4, 0.5]]) {
    ctx.globalAlpha = a;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(cx, cx, r * size, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, size * 0.2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
