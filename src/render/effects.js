// Transient effects: rail trails (core beam + spiral), impact sparks and
// scorch marks, gibs, spawn and jump pad flashes.

import * as THREE from '../../vendor/three.js';
import { scorchTexture } from './textures.js';

const V = () => new THREE.Vector3();
const _v1 = V(), _v2 = V(), _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

const SPIRAL_VERT = `
  attribute float t;
  attribute vec3 offset;
  uniform float uAge, uScale;
  varying float vA;
  void main() {
    float grow = 1.0 + uAge * 5.0;
    vec3 p = position + offset * grow + vec3(0.0, uAge * 6.0, 0.0);
    vA = (1.0 - uAge) * (1.0 - uAge);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (3.4 + uAge * 5.0) * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const SPIRAL_FRAG = `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vA;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(uColor, t.a * vA * uOpacity);
  }`;

const PARTICLE_VERT = `
  attribute vec3 color;
  attribute float size;
  attribute float alpha;
  uniform float uScale;
  varying vec3 vColor;
  varying float vA;
  void main() {
    vColor = color;
    vA = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const PARTICLE_FRAG = `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vA;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor, t.a * vA);
  }`;

export class Effects {
  constructor(scene, world, glow, quality) {
    this.scene = scene;
    this.world = world;
    this.glow = glow;
    this.quality = quality;
    this.trails = [];
    this.decals = [];
    this.gibs = [];
    this.flashes = [];
    this.lights = [];
    this.pixelScale = 400;
    this.scorch = scorchTexture();
    this.coreGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    this.coreGeo.translate(0, 0.5, 0);
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.gibGeos = [new THREE.BoxGeometry(5, 5, 5), new THREE.BoxGeometry(7, 3, 4), new THREE.IcosahedronGeometry(3.5, 0)];
    this.gibMat = new THREE.MeshStandardMaterial({ color: 0x5a0a08, roughness: 0.55, metalness: 0.1, emissive: 0x200000 });
    this.initParticles();
    // a small pool of point lights for muzzle flashes and impacts
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 400, 1.5);
      l.userData.life = 0;
      scene.add(l);
      this.lights.push(l);
    }
  }

  initParticles() {
    const N = 3000;
    this.pN = N;
    this.pPos = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3);
    this.pCol = new Float32Array(N * 3);
    this.pSize = new Float32Array(N);
    this.pAlpha = new Float32Array(N);
    this.pLife = new Float32Array(N);
    this.pMax = new Float32Array(N);
    this.pGrav = new Float32Array(N);
    this.pNext = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.pAlpha, 1));
    this.pGeo = geo;
    this.pMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: this.glow }, uScale: { value: 400 } },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, this.pMat);
    pts.frustumCulled = false;
    this.scene.add(pts);
  }

  particle(pos, vel, color, size, life, gravity = 0) {
    const i = this.pNext;
    this.pNext = (this.pNext + 1) % this.pN;
    this.pPos.set(pos, i * 3);
    this.pVel.set(vel, i * 3);
    this.pCol[i * 3] = color.r;
    this.pCol[i * 3 + 1] = color.g;
    this.pCol[i * 3 + 2] = color.b;
    this.pSize[i] = size;
    this.pLife[i] = life;
    this.pMax[i] = life;
    this.pGrav[i] = gravity;
    this.pAlpha[i] = 1;
  }

  flashLight(pos, color, intensity, life) {
    const l = this.lights.reduce((a, b) => (a.userData.life < b.userData.life ? a : b));
    l.position.set(pos[0], pos[1], pos[2]);
    l.color.set(color);
    l.userData.life = life;
    l.userData.max = life;
    l.userData.intensity = intensity;
  }

  rail(start, end, colorHex, normal, hitWorld) {
    const color = new THREE.Color(colorHex);
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    const dir = _v1.subVectors(b, a);
    const len = dir.length();
    if (len < 1) return;
    dir.normalize();
    const group = new THREE.Group();

    // core beam: bright thin cylinder plus a softer outer glow
    _q.setFromUnitVectors(_up, dir);
    const hot = color.clone().lerp(new THREE.Color(1, 1, 1), 0.55).multiplyScalar(3);
    const core = new THREE.Mesh(this.coreGeo, new THREE.MeshBasicMaterial({ color: hot, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.position.copy(a);
    core.quaternion.copy(_q);
    core.scale.set(0.9, len, 0.9);
    group.add(core);
    const outer = new THREE.Mesh(this.coreGeo, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.2), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    outer.position.copy(a);
    outer.quaternion.copy(_q);
    outer.scale.set(3.5, len, 3.5);
    group.add(outer);

    // spiral around the beam
    const step = this.quality.low ? 9 : 5;
    const count = Math.min(1600, Math.floor(len / step));
    const pos = new Float32Array(count * 3);
    const off = new Float32Array(count * 3);
    const tt = new Float32Array(count);
    const u = _v2.set(1, 0, 0);
    if (Math.abs(dir.x) > 0.9) u.set(0, 0, 1);
    u.crossVectors(dir, u).normalize();
    const w = new THREE.Vector3().crossVectors(dir, u);
    const radius = 4;
    for (let i = 0; i < count; i++) {
      const d = i * step;
      const ang = d * 0.12;
      const c = Math.cos(ang) * radius, s = Math.sin(ang) * radius;
      pos[i * 3] = a.x + dir.x * d;
      pos[i * 3 + 1] = a.y + dir.y * d;
      pos[i * 3 + 2] = a.z + dir.z * d;
      off[i * 3] = u.x * c + w.x * s;
      off[i * 3 + 1] = u.y * c + w.y * s;
      off[i * 3 + 2] = u.z * c + w.z * s;
      tt[i] = d / len;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('offset', new THREE.BufferAttribute(off, 3));
    geo.setAttribute('t', new THREE.BufferAttribute(tt, 1));
    const smat = new THREE.ShaderMaterial({
      uniforms: {
        uAge: { value: 0 },
        uScale: { value: this.pixelScale },
        uMap: { value: this.glow },
        uColor: { value: color.clone().multiplyScalar(1.8) },
        uOpacity: { value: 1 },
      },
      vertexShader: SPIRAL_VERT,
      fragmentShader: SPIRAL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const spiral = new THREE.Points(geo, smat);
    spiral.frustumCulled = false;
    group.add(spiral);
    this.scene.add(group);
    this.trails.push({ group, core, outer, spiral, age: 0, life: 1.4 });

    // impact
    if (hitWorld) {
      const n = new THREE.Vector3(...normal);
      for (let i = 0; i < 26; i++) {
        const v = n.clone().multiplyScalar(80 + Math.random() * 180);
        v.x += (Math.random() - 0.5) * 260;
        v.y += (Math.random() - 0.3) * 260;
        v.z += (Math.random() - 0.5) * 260;
        const c = Math.random() < 0.5 ? hot : new THREE.Color(1.6, 0.9, 0.4);
        this.particle([b.x, b.y, b.z], [v.x, v.y, v.z], c, 3 + Math.random() * 3, 0.3 + Math.random() * 0.5, 600);
      }
      for (let i = 0; i < 6; i++) {
        const v = n.clone().multiplyScalar(20 + Math.random() * 30);
        this.particle([b.x, b.y, b.z], [v.x, v.y + 10, v.z], new THREE.Color(0.25, 0.22, 0.2), 30 + Math.random() * 20, 1.2, -20);
      }
      this.particle([b.x, b.y, b.z], [0, 0, 0], hot, 60, 0.18);
      this.decal(b, n, color);
      this.flashLight([b.x + n.x * 10, b.y + n.y * 10, b.z + n.z * 10], color, 30000, 0.25);
    }
  }

  decal(pos, normal, color) {
    const mat = new THREE.MeshBasicMaterial({
      map: this.scorch,
      color: color.clone().multiplyScalar(2),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    const burn = new THREE.MeshBasicMaterial({
      map: this.scorch,
      color: 0x000000,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    const g = new THREE.Group();
    const m1 = new THREE.Mesh(this.decalGeo, burn);
    m1.scale.setScalar(26);
    const m2 = new THREE.Mesh(this.decalGeo, mat);
    m2.scale.setScalar(16);
    g.add(m1, m2);
    g.position.copy(pos).addScaledVector(normal, 0.3);
    g.lookAt(pos.clone().add(normal));
    g.rotateZ(Math.random() * Math.PI * 2);
    this.scene.add(g);
    this.decals.push({ g, glowMat: mat, burnMat: burn, age: 0 });
    if (this.decals.length > 48) this.removeDecal(this.decals.shift());
  }

  removeDecal(d) {
    this.scene.remove(d.g);
    d.glowMat.dispose();
    d.burnMat.dispose();
  }

  gib(pos, vel, colorHex) {
    const color = new THREE.Color(colorHex);
    const armor = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.5 });
    const count = this.quality.low ? 8 : 14;
    for (let i = 0; i < count; i++) {
      const geo = this.gibGeos[i % this.gibGeos.length];
      const m = new THREE.Mesh(geo, i % 3 === 0 ? armor : this.gibMat);
      m.castShadow = !this.quality.low;
      m.position.set(pos[0] + (Math.random() - 0.5) * 20, pos[1] + Math.random() * 40 - 10, pos[2] + (Math.random() - 0.5) * 20);
      this.scene.add(m);
      this.gibs.push({
        m,
        vel: new THREE.Vector3(vel[0] * 0.6 + (Math.random() - 0.5) * 380, vel[1] * 0.5 + 150 + Math.random() * 300, vel[2] * 0.6 + (Math.random() - 0.5) * 380),
        spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12),
        age: 0,
        life: 3 + Math.random() * 1.5,
        armor: i === 0 ? armor : null,
      });
    }
    const blood = new THREE.Color(0.55, 0.02, 0.01);
    for (let i = 0; i < 40; i++) {
      this.particle(
        [pos[0], pos[1] + Math.random() * 40 - 10, pos[2]],
        [(Math.random() - 0.5) * 260 + vel[0] * 0.3, Math.random() * 220, (Math.random() - 0.5) * 260 + vel[2] * 0.3],
        blood,
        14 + Math.random() * 16,
        0.6 + Math.random() * 0.5,
        300,
      );
    }
    this.particle([pos[0], pos[1] + 10, pos[2]], [0, 0, 0], color.clone().multiplyScalar(1.5), 110, 0.25);
  }

  spawnFx(pos, colorHex) {
    const c = new THREE.Color(colorHex).multiplyScalar(1.6);
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      this.particle([pos[0] + Math.cos(a) * 24, pos[1] - 20, pos[2] + Math.sin(a) * 24], [0, 60 + Math.random() * 140, 0], c, 6, 0.7);
    }
    this.particle([pos[0], pos[1], pos[2]], [0, 0, 0], c, 120, 0.3);
    this.flashLight(pos, c, 20000, 0.35);
  }

  padFx(pos) {
    const c = new THREE.Color(0.3, 1.4, 2.2);
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 10 + Math.random() * 30;
      this.particle([pos[0] + Math.cos(a) * r, pos[1] + 4, pos[2] + Math.sin(a) * r], [Math.cos(a) * 40, 200 + Math.random() * 200, Math.sin(a) * 40], c, 5, 0.6);
    }
  }

  update(dt, pixelScale) {
    this.pixelScale = pixelScale;
    this.pMat.uniforms.uScale.value = pixelScale;
    // trails
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i];
      t.age += dt;
      const f = t.age / t.life;
      if (f >= 1) {
        this.scene.remove(t.group);
        t.spiral.geometry.dispose();
        t.spiral.material.dispose();
        t.core.material.dispose();
        t.outer.material.dispose();
        this.trails.splice(i, 1);
        continue;
      }
      t.core.material.opacity = Math.max(0, 1 - f * 2.2);
      t.outer.material.opacity = 0.35 * (1 - f) * (1 - f);
      t.spiral.material.uniforms.uAge.value = f;
      t.spiral.material.uniforms.uScale.value = pixelScale;
    }
    // decals fade out slowly
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.age += dt;
      d.glowMat.opacity = Math.max(0, 1 - d.age / 2.5);
      if (d.age > 10) d.burnMat.opacity = Math.max(0, 0.8 * (1 - (d.age - 10) / 3));
      if (d.age > 13) {
        this.removeDecal(d);
        this.decals.splice(i, 1);
      }
    }
    // gibs bounce around
    const start = [0, 0, 0], end = [0, 0, 0], zero = [0, 0, 0];
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const g = this.gibs[i];
      g.age += dt;
      if (g.age > g.life) {
        this.scene.remove(g.m);
        if (g.armor) g.armor.dispose();
        this.gibs.splice(i, 1);
        continue;
      }
      if (!g.rest) {
        g.vel.y -= 800 * dt;
        start[0] = g.m.position.x; start[1] = g.m.position.y; start[2] = g.m.position.z;
        end[0] = start[0] + g.vel.x * dt; end[1] = start[1] + g.vel.y * dt; end[2] = start[2] + g.vel.z * dt;
        const tr = this.world.trace(start, end, zero, zero);
        if (tr.fraction < 1 && !tr.startsolid) {
          const n = tr.normal;
          const vn = g.vel.x * n[0] + g.vel.y * n[1] + g.vel.z * n[2];
          g.vel.x -= 1.6 * vn * n[0];
          g.vel.y -= 1.6 * vn * n[1];
          g.vel.z -= 1.6 * vn * n[2];
          g.vel.multiplyScalar(0.55);
          g.spin.multiplyScalar(0.6);
          g.m.position.set(tr.endpos[0] + n[0] * 0.5, tr.endpos[1] + n[1] * 0.5, tr.endpos[2] + n[2] * 0.5);
          if (n[1] > 0.7 && g.vel.length() < 40) g.rest = true;
        } else {
          g.m.position.set(end[0], end[1], end[2]);
        }
        g.m.rotation.x += g.spin.x * dt;
        g.m.rotation.y += g.spin.y * dt;
        g.m.rotation.z += g.spin.z * dt;
      }
      const s = g.age > g.life - 0.5 ? (g.life - g.age) / 0.5 : 1;
      g.m.scale.setScalar(Math.max(0.01, s));
    }
    // particles
    const N = this.pN;
    for (let i = 0; i < N; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) {
        this.pAlpha[i] = 0;
        continue;
      }
      const k = i * 3;
      this.pVel[k + 1] -= this.pGrav[i] * dt;
      this.pPos[k] += this.pVel[k] * dt;
      this.pPos[k + 1] += this.pVel[k + 1] * dt;
      this.pPos[k + 2] += this.pVel[k + 2] * dt;
      this.pAlpha[i] = this.pLife[i] / this.pMax[i];
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate = true;
    this.pGeo.attributes.size.needsUpdate = true;
    this.pGeo.attributes.alpha.needsUpdate = true;
    // flash lights
    for (const l of this.lights) {
      if (l.userData.life > 0) {
        l.userData.life -= dt;
        l.intensity = Math.max(0, l.userData.life / l.userData.max) * l.userData.intensity;
      } else {
        l.intensity = 0;
      }
    }
  }

  clear() {
    for (const t of this.trails) this.scene.remove(t.group);
    for (const d of this.decals) this.removeDecal(d);
    for (const g of this.gibs) this.scene.remove(g.m);
    this.trails = [];
    this.decals = [];
    this.gibs = [];
    this.pLife.fill(0);
    this.pAlpha.fill(0);
  }
}
