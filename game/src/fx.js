// Transient visuals, all pooled: tracers, impact puffs, bot muzzle flashes, the
// charge's explosion and smoke clouds. Nothing here allocates in the frame
// loop — pools are built once and recycled — and every effect is cosmetic: the
// simulation in combat.js never reads it back.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export function createFx(scene) {
  // Tracers: one stretched, additive plane per shot, gone in 60 ms.
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  const tracers = [];
  for (let i = 0; i < 28; i += 1) {
    const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
    m.visible = false;
    scene.add(m);
    tracers.push({ mesh: m, life: 0 });
  }
  let tracerIdx = 0;
  const mid = new THREE.Vector3();
  const dirV = new THREE.Vector3();

  // Impact puffs: a small sphere that swells and fades where a bullet lands.
  const puffs = [];
  for (let i = 0; i < 20; i += 1) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0 }));
    m.visible = false;
    scene.add(m);
    puffs.push({ mesh: m, life: 0, max: 0.28 });
  }
  let puffIdx = 0;

  // Bot muzzle flashes: a bright quad at the gun tip for a few frames.
  const flashes = [];
  for (let i = 0; i < 12; i += 1) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ color: PALETTE.flash, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    flashes.push({ mesh: m, life: 0 });
  }
  let flashIdx = 0;

  // The explosion: one expanding fireball, one light, and camera shake.
  const fireball = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffa63e, transparent: true, opacity: 0 }));
  fireball.visible = false;
  scene.add(fireball);
  const boomLight = new THREE.PointLight(0xff9a3e, 0, 30, 1.6);
  scene.add(boomLight);
  let boomT = 0;
  let boomScale = 1;
  let shakeAmp = 0;

  // Smoke clouds: a cluster of soft spheres per grenade, matching the sight
  // blocking volume combat.js keeps in S.smokes.
  const smokeGroup = new THREE.Group();
  scene.add(smokeGroup);
  const smokeMat = new THREE.MeshLambertMaterial({ color: 0xb9bec2, transparent: true, opacity: 0.5, depthWrite: false });
  const smokeMeshes = new Map(); // smoke object -> group

  return {
    tracer(x0, y0, z0, x1, y1, z1, color) {
      const t = tracers[tracerIdx];
      tracerIdx = (tracerIdx + 1) % tracers.length;
      mid.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      dirV.set(x1 - x0, y1 - y0, z1 - z0);
      const len = dirV.length() || 1;
      t.mesh.position.copy(mid);
      t.mesh.scale.set(1, 1, len);
      t.mesh.lookAt(x1, y1, z1);
      t.mesh.material.color.setHex(color);
      t.mesh.material.opacity = 0.75;
      t.mesh.visible = true;
      t.life = 0.06;
    },
    impact(x, y, z, kind) {
      const p = puffs[puffIdx];
      puffIdx = (puffIdx + 1) % puffs.length;
      p.mesh.position.set(x, y, z);
      p.mesh.material.color.setHex(kind === 'flesh' ? 0x8e2f22 : kind === 'metal' ? 0xd8c98a : 0xcfc8b8);
      p.mesh.material.opacity = 0.85;
      p.mesh.scale.setScalar(0.6);
      p.mesh.visible = true;
      p.life = p.max;
    },
    muzzle(x, y, z) {
      const f = flashes[flashIdx];
      flashIdx = (flashIdx + 1) % flashes.length;
      f.mesh.position.set(x, y, z);
      f.mesh.material.opacity = 0.95;
      f.mesh.visible = true;
      f.life = 0.045;
    },
    explosion(x, y, z, scale = 1) {
      fireball.position.set(x, y, z);
      fireball.visible = true;
      boomLight.position.set(x, y + 1.2, z);
      boomT = 0.7;
      boomScale = scale;
      shakeAmp = Math.min(0.6, 0.2 + scale * 0.18);
    },
    addShake(amount) {
      shakeAmp = Math.min(0.6, shakeAmp + amount);
    },
    shake() {
      return shakeAmp;
    },
    addSmoke(smoke) {
      const g = new THREE.Group();
      const rng = smoke.rng;
      for (let i = 0; i < 8; i += 1) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(1.5 + rng() * 1.6, 8, 6), smokeMat);
        s.position.set(smoke.x + (rng() * 2 - 1) * 2.6, 0.9 + rng() * 1.6, smoke.z + (rng() * 2 - 1) * 2.6);
        g.add(s);
      }
      smokeGroup.add(g);
      smokeMeshes.set(smoke, g);
    },
    removeSmoke(smoke) {
      const g = smokeMeshes.get(smoke);
      if (g) {
        smokeGroup.remove(g);
        smokeMeshes.delete(smoke);
      }
    },
    clearSmokes() {
      for (const g of smokeMeshes.values()) smokeGroup.remove(g);
      smokeMeshes.clear();
    },
    update(dt, camera) {
      for (const t of tracers) {
        if (t.life <= 0) continue;
        t.life -= dt;
        t.mesh.material.opacity = Math.max(0, t.life / 0.06) * 0.75;
        if (t.life <= 0) t.mesh.visible = false;
      }
      for (const p of puffs) {
        if (p.life <= 0) continue;
        p.life -= dt;
        const k = Math.max(0, p.life / p.max);
        p.mesh.material.opacity = k * 0.85;
        p.mesh.scale.setScalar(0.6 + (1 - k) * 1.5);
        if (p.life <= 0) p.mesh.visible = false;
      }
      for (const f of flashes) {
        if (f.life <= 0) continue;
        f.life -= dt;
        f.mesh.material.opacity = Math.max(0, f.life / 0.045) * 0.95;
        f.mesh.lookAt(camera.position);
        if (f.life <= 0) f.mesh.visible = false;
      }
      if (boomT > 0) {
        boomT -= dt;
        const k = Math.max(0, boomT / 0.7);
        fireball.scale.setScalar((1 + (1 - k) * 9) * boomScale);
        fireball.material.opacity = k * 0.9;
        boomLight.intensity = k * 260 * boomScale;
        if (boomT <= 0) {
          fireball.visible = false;
          boomLight.intensity = 0;
        }
      }
      shakeAmp = Math.max(0, shakeAmp - dt * 1.4);
    },
  };
}
