// Scene setup and per-frame drawing: world, players, first person railgun,
// camera effects (bob, landing dip, step smoothing, death cam) and bloom.

import * as THREE from '../../vendor/three.js';
import { EffectComposer, RenderPass, UnrealBloomPass, OutputPass } from '../../vendor/three.js';
import { buildWorld } from './world.js';
import { buildSky } from './sky.js';
import { buildPlayerModel, buildRailgun } from './models.js';
import { Effects } from './effects.js';
import { RAIL_RELOAD } from '../sim/game.js';

const lerp = (a, b, t) => a + (b - a) * t;

export class Renderer {
  constructor(canvas, map, settings) {
    this.settings = settings;
    this.map = map;
    this.canvas = canvas;
    this.quality = { low: settings.quality === 'low', anisotropy: settings.quality === 'low' ? 1 : 8 };
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.quality.low, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.low ? 1 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !this.quality.low;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.autoClear = false;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x1a0a0c, 0.00018);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(90, 1, 3, 12000);
    this.camera.rotation.order = 'YXZ';

    // lighting: dim sky fill, a moonlight key with shadows, lava + lamps
    scene.add(new THREE.HemisphereLight(0x8a7fa8, 0x4a2a1a, 1.1));
    const moon = new THREE.DirectionalLight(0xc8c4ff, 1.5);
    moon.position.set(-900, 1600, -600);
    moon.target.position.set(0, 0, 0);
    moon.castShadow = !this.quality.low;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera;
    sc.left = -1250; sc.right = 1250; sc.top = 1250; sc.bottom = -1250;
    sc.near = 100; sc.far = 4000;
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 1.5;
    scene.add(moon, moon.target);
    const fill = new THREE.DirectionalLight(0xff7040, 0.35);
    fill.position.set(700, 300, 900);
    scene.add(fill);

    this.world = buildWorld(map, scene, this.quality);
    this.sky = buildSky(scene);
    this.effects = new Effects(scene, map.world, this.world.glow, this.quality);

    // first person weapon lives in its own scene so it never clips walls
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(54, 1, 0.5, 200);
    this.viewScene.add(new THREE.HemisphereLight(0xb0a8c8, 0x402418, 1.4));
    const vkey = new THREE.DirectionalLight(0xfff0e0, 2.2);
    vkey.position.set(-1, 2, 1);
    this.viewScene.add(vkey);
    this.viewLight = new THREE.PointLight(0xffffff, 0, 60, 1.5);
    this.viewLight.position.set(4, 0, -30);
    this.viewScene.add(this.viewLight);
    this.viewGun = buildRailgun(settings.color, true, 1.1);
    this.viewGun.scale.setScalar(0.5);
    this.viewGun.traverse((o) => (o.castShadow = false));
    this.viewScene.add(this.viewGun);
    this.gunKick = 0;

    this.models = new Map();
    this.game = null;
    this.time = 0;
    this.bob = 0;
    this.landDip = 0;
    this.landVel = 0;
    this.stepOffset = 0;
    this.lastLocalY = null;
    this.zoom = 0;
    this.orbit = 0;

    this.setupComposer();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setupComposer() {
    const r = this.renderer;
    this.composer = new EffectComposer(r);
    const main = new RenderPass(this.scene, this.camera);
    this.composer.addPass(main);
    const view = new RenderPass(this.viewScene, this.viewCamera);
    view.clear = false;
    view.clearDepth = true;
    this.viewPass = view;
    this.composer.addPass(view);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.aspect = w / h;
    this.viewCamera.aspect = this.aspect;
    this.viewCamera.updateProjectionMatrix();
    this.height = h;
  }

  setGame(game) {
    this.game = game;
    for (const m of this.models.values()) this.scene.remove(m);
    this.models.clear();
    for (const p of game.players) {
      const m = buildPlayerModel(p.color);
      m.visible = false;
      this.scene.add(m);
      this.models.set(p.id, m);
    }
    this.effects.clear();
    this.lastLocalY = null;
    this.deathCam = null;
  }

  setViewColor(color) {
    this.viewGun.userData.setColor(color);
  }

  // Horizontal FOV at 4:3 (like Quake's cg_fov) -> vertical FOV, Hor+ style.
  fovY(hfov) {
    return (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) * 0.75) * 180) / Math.PI;
  }

  handleEvent(ev) {
    const g = this.game;
    const local = g.local;
    switch (ev.type) {
      case 'rail': {
        let start = ev.start;
        if (ev.player === local && local.alive && !this.thirdPerson) {
          // start the local trail at the first person muzzle
          const m = this.viewGun.userData.muzzle.clone();
          this.viewGun.localToWorld(m);
          // view space -> world: view camera sits at the origin of the view scene
          m.applyMatrix4(this.camera.matrixWorld);
          start = [m.x, m.y, m.z];
          this.gunKick = 1;
          this.viewLight.color.set(ev.player.color);
          this.viewLight.intensity = 40;
        }
        this.effects.rail(start, ev.end, ev.player.color, ev.normal, ev.hitWorld);
        this.effects.flashLight(ev.start, ev.player.color, 6000, 0.12);
        break;
      }
      case 'frag':
        if (ev.cause === 'rail' || ev.cause === 'lava') this.effects.gib(ev.pos, ev.vel, ev.victim.color);
        if (ev.victim === local) {
          const killer = ev.attacker;
          this.deathCam = { pos: this.camera.position.clone(), yaw: local.ps.yaw, pitch: local.ps.pitch, killer, t: 0 };
        }
        break;
      case 'spawn':
        if (!ev.initial) this.effects.spawnFx(ev.player.ps.origin, ev.player.color);
        if (ev.player === local) {
          this.deathCam = null;
          this.lastLocalY = null;
        }
        break;
      case 'pad':
        this.effects.padFx(ev.pad.center);
        break;
      case 'land':
        if (ev.player === local) this.landVel = -Math.min(1, ev.speed / 800) * 60;
        break;
    }
  }

  render(alpha, dt, opts = {}) {
    const g = this.game;
    this.time += dt;
    const cam = this.camera;
    const local = g.local;
    const pixelScale = this.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
    this.world.update(this.time, pixelScale);
    this.effects.update(dt, pixelScale);

    // camera
    let hfov = this.settings.fov;
    const zoomTarget = opts.zoom ? 1 : 0;
    this.zoom += (zoomTarget - this.zoom) * Math.min(1, dt * 14);
    let showGun = false;
    if (opts.spectate || !local || g.phase === 'intermission') {
      this.orbit += dt * 0.08;
      const r = 820;
      cam.position.set(Math.sin(this.orbit) * r, 470 + Math.sin(this.orbit * 0.7) * 60, Math.cos(this.orbit) * r);
      cam.lookAt(0, 120, 0);
      cam.rotation.order = 'YXZ';
    } else if (!local.alive && this.deathCam) {
      // lie on the floor and turn to watch the killer
      const d = this.deathCam;
      d.t += dt;
      const o = local.ps.origin;
      cam.position.set(o[0], lerp(d.pos.y, o[1] - 14, Math.min(1, d.t * 3)), o[2]);
      let yaw = d.yaw, pitch = d.pitch * (1 - Math.min(1, d.t * 2));
      if (d.killer && d.killer.alive) {
        const k = d.killer.ps.origin;
        const tyaw = Math.atan2(-(k[0] - o[0]), -(k[2] - o[2]));
        let dy = tyaw - d.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        d.yaw += dy * Math.min(1, dt * 3);
        yaw = d.yaw;
      }
      cam.rotation.set(pitch, yaw, Math.min(1, d.t * 2) * 0.35, 'YXZ');
    } else {
      showGun = true;
      const ps = local.ps;
      const o = [lerp(local.prevOrigin[0], ps.origin[0], alpha), lerp(local.prevOrigin[1], ps.origin[1], alpha), lerp(local.prevOrigin[2], ps.origin[2], alpha)];
      // smooth out stair steps
      if (this.lastLocalY !== null && ps.onGround) {
        const dy = o[1] - this.lastLocalY;
        if (dy > 1 && dy < 20) this.stepOffset -= dy;
      }
      this.lastLocalY = o[1];
      this.stepOffset *= Math.exp(-dt * 14);
      // landing dip spring
      this.landDip += this.landVel * dt;
      this.landVel += (-this.landDip * 180 - this.landVel * 18) * dt;
      const speed = Math.hypot(ps.velocity[0], ps.velocity[2]);
      if (ps.onGround) this.bob += dt * speed * 0.028;
      const bobAmt = ps.onGround ? Math.min(1, speed / 320) : 0;
      const bobY = Math.abs(Math.sin(this.bob)) * 1.4 * bobAmt * this.settings.bob;
      cam.position.set(o[0], o[1] + ps.viewheight + this.stepOffset + this.landDip + bobY, o[2]);
      const roll = Math.sin(this.bob) * 0.006 * bobAmt * this.settings.bob;
      cam.rotation.set(ps.pitch, ps.yaw, roll, 'YXZ');
      hfov = lerp(hfov, 30, this.zoom);

      // weapon sway / bob / kick
      const gun = this.viewGun;
      this.gunKick = Math.max(0, this.gunKick - dt * 3.5);
      const kick = Math.pow(this.gunKick, 2);
      const sway = Math.sin(this.bob) * 0.8 * bobAmt;
      const lift = Math.abs(Math.cos(this.bob)) * 0.6 * bobAmt;
      const hand = this.settings.hand === 'left' ? -1 : 1;
      gun.position.set(hand * (7.2 + sway * 0.5), -7.6 + lift * 0.5 - this.landDip * 0.05 - kick * 0.8, -13 + kick * 4);
      gun.rotation.set(0.04 + kick * 0.2, hand * 0.1, hand * -0.06);
      gun.userData.setCharge(1 - local.reload / RAIL_RELOAD);
      this.viewLight.intensity = Math.max(0, this.viewLight.intensity - dt * 400);
      gun.visible = this.zoom < 0.6 && this.settings.drawGun;
    }
    cam.fov = this.fovY(hfov);
    cam.aspect = this.aspect;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.sky.update(this.time, cam.position);

    // player models
    for (const p of g.players) {
      const m = this.models.get(p.id);
      if (!m) continue;
      const visible = p.alive && (p !== local || !showGun) && !(p === local && !opts.spectate && g.phase !== 'intermission');
      m.visible = visible;
      if (!visible) continue;
      const ps = p.ps;
      m.position.set(lerp(p.prevOrigin[0], ps.origin[0], alpha), lerp(p.prevOrigin[1], ps.origin[1], alpha) - 24, lerp(p.prevOrigin[2], ps.origin[2], alpha));
      m.userData.animate(ps.yaw, ps.pitch, ps.velocity, ps.onGround, ps.ducked, dt);
      m.userData.gun.userData.setCharge(1 - p.reload / RAIL_RELOAD);
      // spawn shimmer
      const since = g.time - p.spawnTime;
      m.scale.setScalar(since < 0.25 ? 0.6 + since * 1.6 : 1);
    }

    this.viewPass.enabled = showGun;
    this.bloom.enabled = this.settings.bloom;
    this.composer.render(dt);
  }
}
