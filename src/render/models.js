// Player and railgun models built from primitives. Players use "bright
// skins" (flat, glowing team colour) like competitive instagib configs.

import * as THREE from '../../vendor/three.js';

const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

// Railgun: body, barrel, side rails and a row of coils that glow while charged.
export function buildRailgun(color, detail = false, glow = 2.4) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.35, metalness: 0.85 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.3, metalness: 0.9 });
  const coilMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(color), emissiveIntensity: 2.5, roughness: 0.4, metalness: 0.3 });
  const seg = detail ? 16 : 8;

  const body = box(5, 6, 22, dark);
  body.position.set(0, 0, 4);
  g.add(body);
  const stock = box(4, 5, 10, dark);
  stock.position.set(0, -1, 18);
  g.add(stock);
  const grip = box(3, 8, 4, dark);
  grip.position.set(0, -6, 10);
  grip.rotation.x = 0.3;
  g.add(grip);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 34, seg), steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 1, -20);
  g.add(barrel);
  for (const sx of [-2.6, 2.6]) {
    const rail = box(1, 1.6, 30, steel);
    rail.position.set(sx, 1, -18);
    g.add(rail);
  }
  const coils = [];
  for (let i = 0; i < 6; i++) {
    const m = coilMat.clone();
    const coil = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.9, detail ? 8 : 5, seg), m);
    coil.position.set(0, 1, -8 - i * 4.8);
    g.add(coil);
    coils.push(coil);
  }
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 1.6, 3, seg), dark);
  tip.rotation.x = Math.PI / 2;
  tip.position.set(0, 1, -37);
  g.add(tip);
  const sight = box(1.2, 2.4, 6, dark);
  sight.position.set(0, 4, 2);
  g.add(sight);
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  g.userData = {
    coils,
    muzzle: new THREE.Vector3(0, 1, -39),
    // charge: 0 just fired .. 1 ready
    setCharge(charge) {
      coils.forEach((c, i) => {
        const lit = charge >= 1 ? 1 : Math.max(0, Math.min(1, charge * 6 - i));
        c.material.emissiveIntensity = (charge >= 1 ? 1 : 0.03 + lit * 0.55) * glow;
      });
    },
    setColor(col) {
      coils.forEach((c) => c.material.emissive.set(col));
    },
  };
  return g;
}

export function buildPlayerModel(colorHex) {
  const color = new THREE.Color(colorHex);
  const root = new THREE.Group();
  const armor = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.5, metalness: 0.6 });
  const skin = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.5, metalness: 0.2 });
  const visorMat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.2) });

  const lower = new THREE.Group(); // hips + legs, turns towards movement
  root.add(lower);
  const hips = box(16, 6, 10, armor);
  hips.position.y = 27;
  lower.add(hips);
  const legs = [];
  for (const sx of [-5, 5]) {
    const leg = new THREE.Group();
    leg.position.set(sx, 27, 0);
    const thigh = box(7, 14, 7, skin);
    thigh.position.y = -7;
    leg.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -14;
    const shin = box(6.5, 12, 6.5, armor);
    shin.position.y = -6;
    knee.add(shin);
    const boot = box(7, 3, 11, armor);
    boot.position.set(0, -11.5, -2);
    knee.add(boot);
    leg.add(knee);
    lower.add(leg);
    legs.push({ leg, knee });
  }

  const upper = new THREE.Group(); // torso, head, arms, gun: faces the view yaw
  upper.position.y = 30;
  root.add(upper);
  const torso = box(18, 16, 11, skin);
  torso.position.y = 8;
  upper.add(torso);
  const chest = box(14, 9, 3, armor);
  chest.position.set(0, 10, -6);
  upper.add(chest);
  for (const sx of [-11.5, 11.5]) {
    const pad = box(7, 5, 10, armor);
    pad.position.set(sx, 15, 0);
    pad.rotation.z = sx < 0 ? 0.25 : -0.25;
    upper.add(pad);
  }
  const neck = new THREE.Group();
  neck.position.y = 17;
  upper.add(neck);
  const head = box(10, 10, 10, armor);
  head.position.y = 5.5;
  neck.add(head);
  const visor = box(8.5, 3, 1, visorMat);
  visor.position.set(0, 6.5, -5.2);
  neck.add(visor);
  const crest = box(2, 3, 9, skin);
  crest.position.set(0, 11.5, 0.5);
  neck.add(crest);

  const arms = new THREE.Group(); // pitches with the aim
  arms.position.y = 13;
  upper.add(arms);
  for (const sx of [-10, 10]) {
    const arm = box(5, 5, 14, skin);
    arm.position.set(sx * 0.9, -2, -5);
    arm.rotation.y = sx < 0 ? -0.35 : 0.3;
    arms.add(arm);
  }
  const gun = buildRailgun(colorHex);
  gun.scale.setScalar(0.62);
  gun.position.set(4, -1, -12);
  arms.add(gun);

  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });

  let phase = 0;
  root.userData = {
    gun,
    legs,
    // yaw/pitch: view angles; vel: velocity; onGround; ducked; dt
    animate(yaw, pitch, vel, onGround, ducked, dt) {
      const speed = Math.hypot(vel[0], vel[2]);
      upper.rotation.y = yaw;
      arms.rotation.x = pitch * 0.9;
      neck.rotation.x = pitch * 0.5;
      // legs face the movement direction (backpedal keeps facing forward)
      let legYaw = yaw;
      if (speed > 40) {
        const moveYaw = Math.atan2(-vel[0], -vel[2]);
        let d = moveYaw - yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) > Math.PI / 2) d = d > 0 ? d - Math.PI : d + Math.PI;
        legYaw = yaw + d * 0.8;
      }
      let ld = legYaw - lower.rotation.y;
      while (ld > Math.PI) ld -= Math.PI * 2;
      while (ld < -Math.PI) ld += Math.PI * 2;
      lower.rotation.y += ld * Math.min(1, dt * 12);

      const crouch = ducked ? 12 : 0;
      upper.position.y += (30 - crouch - upper.position.y) * Math.min(1, dt * 15);
      lower.position.y = -crouch * 0.6;
      if (!onGround) {
        legs[0].leg.rotation.x = -0.9;
        legs[0].knee.rotation.x = 1.3;
        legs[1].leg.rotation.x = -0.2;
        legs[1].knee.rotation.x = 0.6;
        return;
      }
      phase += (speed / 42) * dt;
      const amp = Math.min(1, speed / 300) * 0.75;
      // walking backwards: reverse the cycle
      const back = speed > 40 && Math.cos(Math.atan2(-vel[0], -vel[2]) - yaw) < -0.2 ? -1 : 1;
      for (let i = 0; i < 2; i++) {
        const s = Math.sin(phase * back + i * Math.PI);
        legs[i].leg.rotation.x = s * amp - (ducked ? 0.8 : 0);
        legs[i].knee.rotation.x = Math.max(0, -Math.cos(phase * back + i * Math.PI)) * amp * 1.2 + (ducked ? 1.4 : 0);
      }
      upper.position.y += Math.abs(Math.sin(phase)) * amp * 1.5;
    },
    setColor(col) {
      const c = new THREE.Color(col);
      skin.color.copy(c);
      skin.emissive.copy(c);
      visorMat.color.copy(c).multiplyScalar(2.2);
      gun.userData.setColor(col);
    },
  };
  return root;
}
