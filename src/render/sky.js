// Procedural sky dome: a crimson nebula, a star field and a distant planet.

import * as THREE from '../../vendor/three.js';

export function buildSky(scene) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float noise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), u.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), u.x), u.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), u.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), u.x), u.y), u.z);
      }
      float fbm(vec3 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 6; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(vec3(0.05, 0.015, 0.02), vec3(0.01, 0.008, 0.03), smoothstep(-0.1, 0.8, h));
        // nebula
        float n = fbm(d * 2.2 + vec3(0.0, uTime * 0.003, 0.0));
        float n2 = fbm(d * 4.5 + n * 1.5);
        float neb = smoothstep(0.35, 0.85, n2) * smoothstep(-0.2, 0.3, h + 0.15);
        col += vec3(0.55, 0.08, 0.1) * neb * 0.9;
        col += vec3(0.25, 0.05, 0.35) * smoothstep(0.5, 0.9, n) * 0.8;
        col += vec3(0.9, 0.35, 0.1) * pow(smoothstep(0.55, 0.95, n2 * n * 1.6), 2.0) * 0.6;
        // stars
        vec3 sp = d * 380.0;
        vec3 cell = floor(sp);
        float s = hash(cell);
        if (s > 0.985) {
          vec3 c = cell + vec3(hash(cell + 1.3), hash(cell + 2.7), hash(cell + 4.1));
          float dist = length(sp - c);
          float tw = 0.7 + 0.3 * sin(uTime * (1.0 + s * 3.0) + s * 40.0);
          col += vec3(1.0, 0.9, 0.85) * smoothstep(0.45, 0.0, dist) * tw * (1.0 - neb * 0.7) * 1.5;
        }
        // planet
        vec3 pd = normalize(vec3(-0.55, 0.32, -0.77));
        float pa = dot(d, pd);
        float r = 0.16;
        float edge = acos(clamp(pa, -1.0, 1.0));
        if (edge < r) {
          vec3 up = normalize(cross(pd, vec3(0.0, 1.0, 0.0)));
          vec3 lp = d - pd;
          float band = fbm(vec3(dot(lp, up) * 3.0, dot(lp, cross(pd, up)) * 26.0, 1.0));
          float lit = smoothstep(-0.2, 0.9, dot(normalize(d - pd * cos(edge)), normalize(vec3(0.9, 0.3, 0.2))));
          vec3 pc = mix(vec3(0.35, 0.12, 0.06), vec3(0.9, 0.55, 0.3), band) * (0.08 + lit * 0.9);
          col = mix(col, pc, smoothstep(r, r - 0.004, edge));
        }
        col += vec3(1.0, 0.45, 0.2) * pow(max(0.0, 1.0 - abs(edge - r) * 40.0), 3.0) * 0.4;
        // horizon glow from the lava
        col += vec3(0.35, 0.08, 0.02) * pow(1.0 - abs(h), 8.0) * 0.6;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  return {
    mesh: sky,
    update(t, camPos) {
      mat.uniforms.uTime.value = t;
      sky.position.copy(camPos);
    },
  };
}
