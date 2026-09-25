// Turns the map description into three.js meshes: brush faces batched per
// material with world-projected UVs, plus lava, jump pads, lamps and lights.

import * as THREE from '../../vendor/three.js';
import { makeMaterials, glowTexture, padTexture } from './textures.js';
import { rotY } from '../sim/collision.js';

export function buildWorld(map, scene, quality) {
  const mats = makeMaterials(quality.anisotropy);
  const groups = new Map();
  for (const brush of map.brushes) {
    if (!brush.visible) continue;
    for (const f of brush.faces) {
      const key = f.mat + (brush.castShadow ? '' : ':ns');
      if (!groups.has(key)) groups.set(key, { mat: f.mat, cast: brush.castShadow, pos: [], nrm: [], uv: [] });
      const g = groups.get(key);
      const scale = mats[f.mat].userData.scale;
      const n = f.n;
      const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      const uvOf = (p) => {
        if (ay >= ax && ay >= az) return [p[0] / scale, p[2] / scale];
        if (ax >= az) return [p[2] / scale, p[1] / scale];
        return [p[0] / scale, p[1] / scale];
      };
      for (let k = 1; k + 1 < f.poly.length; k++) {
        for (const p of [f.poly[0], f.poly[k], f.poly[k + 1]]) {
          g.pos.push(p[0], p[1], p[2]);
          g.nrm.push(n[0], n[1], n[2]);
          g.uv.push(...uvOf(p));
        }
      }
    }
  }
  const root = new THREE.Group();
  for (const g of groups.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    const mesh = new THREE.Mesh(geo, mats[g.mat]);
    mesh.castShadow = g.cast;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  scene.add(root);

  const glow = glowTexture();
  const updaters = [];

  // ---- lava ---------------------------------------------------------------
  const lavaMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vPos;
      void main() {
        vPos = (modelMatrix * vec4(position, 1.0)).xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vPos;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
        return v;
      }
      void main() {
        vec2 p = vPos / 90.0;
        vec2 q = vec2(fbm(p + uTime * 0.05), fbm(p + vec2(5.2, 1.3) - uTime * 0.04));
        float f = fbm(p + 2.5 * q + uTime * 0.03);
        float crust = smoothstep(0.42, 0.62, f);
        float veins = smoothstep(0.08, 0.0, abs(f - 0.36));
        vec3 hot = mix(vec3(0.9, 0.22, 0.02), vec3(1.5, 0.7, 0.12), veins);
        vec3 col = mix(hot, vec3(0.09, 0.025, 0.02), crust);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const ext = map.lavaExtent;
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(ext * 2, ext * 2, 1, 1), lavaMat);
  lava.rotation.x = -Math.PI / 2;
  lava.position.y = map.lavaLevel;
  scene.add(lava);
  updaters.push((t) => (lavaMat.uniforms.uTime.value = t));

  // rising embers above the lava
  const EMBERS = 160;
  const emberGeo = new THREE.BufferGeometry();
  const ep = new Float32Array(EMBERS * 3);
  const eseed = new Float32Array(EMBERS);
  for (let i = 0; i < EMBERS; i++) {
    let x, z;
    do {
      x = (Math.random() * 2 - 1) * ext;
      z = (Math.random() * 2 - 1) * ext;
    } while (Math.abs(x) < 140 && Math.abs(z) < 140);
    ep[i * 3] = x;
    ep[i * 3 + 1] = map.lavaLevel;
    ep[i * 3 + 2] = z;
    eseed[i] = Math.random();
  }
  emberGeo.setAttribute('position', new THREE.BufferAttribute(ep, 3));
  emberGeo.setAttribute('seed', new THREE.BufferAttribute(eseed, 1));
  const emberMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: glow }, uScale: { value: 400 } },
    vertexShader: `
      attribute float seed;
      uniform float uTime, uScale;
      varying float vA;
      void main() {
        float life = fract(uTime * (0.12 + seed * 0.1) + seed * 7.0);
        vec3 p = position;
        p.y += life * (260.0 + seed * 200.0);
        p.x += sin(uTime * 1.3 + seed * 30.0) * 12.0 * life;
        p.z += cos(uTime * 1.1 + seed * 20.0) * 12.0 * life;
        vA = (1.0 - life) * smoothstep(0.0, 0.1, life);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (3.0 + seed * 4.0) * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      varying float vA;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vec3(1.0, 0.45, 0.1) * 2.0, t.a * vA);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const embers = new THREE.Points(emberGeo, emberMat);
  embers.frustumCulled = false;
  scene.add(embers);
  updaters.push((t, px) => {
    emberMat.uniforms.uTime.value = t;
    emberMat.uniforms.uScale.value = px;
  });

  // glowing strip around the pool rim and along the balcony edges
  const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.7, 0.15) });
  const strips = new THREE.Group();
  const addStrip = (min, max) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]), stripMat);
    m.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    strips.add(m);
  };
  for (let k = 0; k < 4; k++) {
    const r = (p) => rotY(p, k);
    const boxR = (a, b) => {
      const ra = r(a), rb = r(b);
      addStrip([Math.min(ra[0], rb[0]), a[1], Math.min(ra[2], rb[2])], [Math.max(ra[0], rb[0]), b[1], Math.max(ra[2], rb[2])]);
    };
    boxR([-320, -6, -321.5], [320, -2, -320]); // pool rim
    boxR([-1024, 180, -800], [-448, 184, -798.5]); // balcony edge
    boxR([-320, 180, -800], [800, 184, -798.5]);
    boxR([-128, 240, -129.5], [128, 244, -128]); // spire crown
  }
  scene.add(strips);

  // ---- jump pads ----------------------------------------------------------
  const padTex = padTexture();
  const padBaseMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.4, metalness: 0.8 });
  for (const pad of map.pads) {
    const radius = (pad.maxs[0] - pad.mins[0]) / 2;
    const g = new THREE.Group();
    g.position.set(pad.center[0], pad.center[1], pad.center[2]);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(radius + 6, radius + 10, 3, 32), padBaseMat);
    base.position.y = 1.5;
    base.receiveShadow = true;
    g.add(base);
    const topMat = new THREE.MeshBasicMaterial({ map: padTex, color: new THREE.Color(0.3, 1.6, 2.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const top = new THREE.Mesh(new THREE.CircleGeometry(radius + 4, 32), topMat);
    top.rotation.x = -Math.PI / 2;
    top.position.y = 3.2;
    g.add(top);
    // rising rings
    const rings = [];
    for (let i = 0; i < 3; i++) {
      const rm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.1, 1.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 6, radius, 32), rm);
      ring.rotation.x = -Math.PI / 2;
      g.add(ring);
      rings.push(ring);
    }
    updaters.push((t) => {
      rings.forEach((ring, i) => {
        const f = (t * 0.9 + i / 3) % 1;
        ring.position.y = 4 + f * 70;
        ring.scale.setScalar(1 - f * 0.4);
        ring.material.opacity = (1 - f) * 0.8;
      });
      topMat.opacity = 0.75 + Math.sin(t * 6) * 0.25;
    });
    scene.add(g);
  }

  // ---- lamps & lights -----------------------------------------------------
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.7) });
  const lampFrame = new THREE.MeshStandardMaterial({ color: 0x33302c, roughness: 0.5, metalness: 0.8 });
  for (const l of map.lamps) {
    const g = new THREE.Group();
    g.position.set(l.pos[0], l.pos[1], l.pos[2]);
    g.lookAt(l.pos[0] + l.normal[0], l.pos[1], l.pos[2] + l.normal[2]);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(56, 72, 10), lampFrame);
    g.add(frame);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(40, 56, 4), lampMat);
    bulb.position.z = 5;
    g.add(bulb);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffa860, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(220, 220, 1);
    halo.position.z = 14;
    g.add(halo);
    scene.add(g);
  }
  for (const l of map.lights) {
    const light = new THREE.PointLight(l.color, l.intensity, l.distance, 1.2);
    light.position.set(l.pos[0], l.pos[1], l.pos[2]);
    // three's physically based units: scale so intensities stay readable
    light.intensity = l.intensity * 800;
    scene.add(light);
  }

  return {
    update(t, pixelScale) {
      for (const u of updaters) u(t, pixelScale);
    },
    materials: mats,
    glow,
  };
}
