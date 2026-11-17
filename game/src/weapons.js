// Weapon definitions, per-actor weapon state, the spread/recoil model and the
// first-person viewmodel. Accuracy is the heart of the gunplay: a shot's spread
// grows with the shooter's speed, with being airborne and with shots fired in a
// burst, and shrinks to near nothing crouched and still — stopping to aim pays,
// exactly as the bounty asks.
import * as THREE from 'three';
import { PALETTE, mat } from './palette.js';
import { clamp } from './state.js';

// damage is per bullet at the chest; the head multiplier and leg multiplier live
// in combat.js. spread is in radians at rest; moveSpread is added at full run
// speed, airSpread while airborne, bloom per shot in a burst (recovering).
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', slot: 'sidearm', price: 0,
    damage: 34, rpm: 320, auto: false, magSize: 12, reserveStart: 48,
    reloadTime: 1.5, spread: 0.006, moveSpread: 0.028, airSpread: 0.06,
    bloom: 0.004, bloomMax: 0.02, recoil: 0.011, falloff: 22, pellets: 1,
    moveSpeed: 5.5, zoom: 0, sound: 'pistol',
  },
  smg: {
    id: 'smg', name: 'Ripper SMG', slot: 'primary', price: 1100,
    damage: 24, rpm: 760, auto: true, magSize: 30, reserveStart: 90,
    reloadTime: 2.1, spread: 0.011, moveSpread: 0.03, airSpread: 0.06,
    bloom: 0.0028, bloomMax: 0.026, recoil: 0.008, falloff: 16, pellets: 1,
    moveSpeed: 5.4, zoom: 0, sound: 'smg',
  },
  shotgun: {
    id: 'shotgun', name: 'Boomstick Scattergun', slot: 'primary', price: 1200,
    damage: 13, rpm: 68, auto: false, magSize: 6, reserveStart: 24,
    reloadTime: 0.55, // per shell, interruptible — see combat/rounds reload flow
    reloadFull: 3.4, spread: 0.035, moveSpread: 0.02, airSpread: 0.04,
    bloom: 0.0, bloomMax: 0.0, recoil: 0.05, falloff: 9, pellets: 8,
    moveSpeed: 5.2, zoom: 0, sound: 'shotgun', perShell: true,
  },
  rifle: {
    id: 'rifle', name: 'Longarm Rifle', slot: 'primary', price: 2500,
    damage: 36, rpm: 600, auto: true, magSize: 30, reserveStart: 90,
    reloadTime: 2.4, spread: 0.004, moveSpread: 0.034, airSpread: 0.07,
    bloom: 0.0035, bloomMax: 0.024, recoil: 0.013, falloff: 30, pellets: 1,
    moveSpeed: 5.15, zoom: 0, sound: 'rifle',
  },
  sniper: {
    id: 'sniper', name: 'Farshot Marksman', slot: 'primary', price: 4300,
    damage: 112, rpm: 42, auto: false, magSize: 5, reserveStart: 30,
    reloadTime: 3.1, spread: 0.0008, moveSpread: 0.09, airSpread: 0.12,
    bloom: 0.0, bloomMax: 0.0, recoil: 0.075, falloff: 60, pellets: 1,
    moveSpeed: 4.8, zoom: 22, sound: 'sniper', // zoom is the scoped field of view
  },
};

export const GRENADES = {
  he: { id: 'he', name: 'Frag Charge', price: 300 },
  flash: { id: 'flash', name: 'Flash Charge', price: 200 },
  smoke: { id: 'smoke', name: 'Smoke Charge', price: 300 },
};

export function makeWeaponState(def) {
  return {
    def,
    mag: def.magSize,
    reserve: def.reserveStart,
    reloading: false,
    reloadT: 0,
    nextShotT: 0, // S.time at which the next shot may leave
    bloom: 0, // accumulated spread from firing, recovers when idle
    shotsFired: 0,
  };
}

// The spread of the next shot, in radians, for an actor in this state.
export function currentSpread(actor, ws) {
  const def = ws.def;
  const speedFrac = clamp(actor.groundSpeed / 5.5, 0, 1.4);
  let s = def.spread + def.moveSpread * speedFrac * speedFrac;
  if (!actor.onGround) s += def.airSpread;
  if (actor.crouch && actor.onGround) s *= 0.72;
  s += ws.bloom;
  if (actor.slot === 'primary' && def.zoom && actor.scoped) s *= 0.25;
  return s;
}

// Called for every shot that leaves the barrel: bloom climbs, then recovers in
// stepWeapon while the trigger is released.
export function registerShot(ws) {
  ws.bloom = Math.min(ws.def.bloomMax, ws.bloom + ws.def.bloom);
  ws.shotsFired += 1;
}

export function stepWeapon(actor, ws, dt, firing) {
  if (!firing || ws.mag === 0) ws.bloom = Math.max(0, ws.bloom - dt * 0.045);
  if (ws.reloading) {
    ws.reloadT -= dt;
    if (ws.reloadT <= 0) finishReload(actor, ws);
  }
}

export function startReload(actor, ws) {
  if (ws.reloading || ws.mag >= ws.def.magSize || ws.reserve <= 0) return false;
  ws.reloading = true;
  ws.reloadT = ws.def.perShell ? ws.def.reloadFull : ws.def.reloadTime;
  return true;
}

function finishReload(actor, ws) {
  ws.reloading = false;
  const take = Math.min(ws.def.magSize - ws.mag, ws.reserve);
  ws.mag += take;
  ws.reserve -= take;
}

// ---------------------------------------------------------------------------
// The viewmodel: a low-poly gun built from boxes, parented to the camera. One
// group per weapon class, rebuilt only when the player changes weapon class;
// recoil, draw and reload are transforms on the group, so nothing is allocated
// per frame.

const VIEW_BUILDERS = {
  pistol: (g) => {
    addBox(g, 0, 0, 0, 0.075, 0.11, 0.24, PALETTE.dark);
    addBox(g, 0, 0.075, -0.06, 0.06, 0.05, 0.2, PALETTE.ironDark);
    addBox(g, 0, -0.1, 0.03, 0.07, 0.12, 0.09, PALETTE.woodDark);
  },
  smg: (g) => {
    addBox(g, 0, 0, 0, 0.08, 0.1, 0.42, PALETTE.dark);
    addBox(g, 0, 0.02, -0.3, 0.045, 0.045, 0.2, PALETTE.ironDark);
    addBox(g, 0, -0.11, -0.02, 0.055, 0.13, 0.08, PALETTE.iron);
    addBox(g, 0, -0.02, 0.2, 0.06, 0.14, 0.08, PALETTE.woodDark);
  },
  shotgun: (g) => {
    addBox(g, 0, 0, 0, 0.09, 0.1, 0.52, PALETTE.woodDark);
    addBox(g, 0, 0.045, -0.2, 0.055, 0.055, 0.42, PALETTE.ironDark);
    addBox(g, 0, -0.03, -0.05, 0.085, 0.06, 0.24, PALETTE.wood);
  },
  rifle: (g) => {
    addBox(g, 0, 0, 0, 0.085, 0.1, 0.56, PALETTE.dark);
    addBox(g, 0, 0.03, -0.36, 0.05, 0.05, 0.24, PALETTE.ironDark);
    addBox(g, 0, -0.12, 0.02, 0.06, 0.15, 0.09, PALETTE.iron);
    addBox(g, 0, 0.02, 0.24, 0.07, 0.09, 0.16, PALETTE.woodDark);
    addBox(g, 0, 0.1, -0.05, 0.05, 0.05, 0.12, PALETTE.iron); // carry handle / sight
  },
  sniper: (g) => {
    addBox(g, 0, 0, 0, 0.08, 0.09, 0.72, PALETTE.tealDark);
    addBox(g, 0, 0.02, -0.48, 0.04, 0.04, 0.3, PALETTE.ironDark);
    addBox(g, 0, -0.11, 0.05, 0.055, 0.13, 0.08, PALETTE.iron);
    addBox(g, 0, 0.11, -0.08, 0.055, 0.07, 0.2, PALETTE.dark); // scope tube
    addBox(g, 0, 0.02, 0.26, 0.06, 0.12, 0.14, PALETTE.woodDark);
  },
};

function addBox(g, x, y, z, w, h, d, color) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, 0.6, 0.25));
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

export function createViewmodel(camera) {
  const group = new THREE.Group();
  group.position.set(0.26, -0.24, -0.58);
  camera.add(group);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: PALETTE.flash, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  flash.position.set(0, 0.03, -0.62);
  group.add(flash);
  let builtFor = null;
  let kick = 0;
  let drawT = 1;
  let flashT = 0;

  return {
    group,
    setWeapon(def) {
      if (builtFor === def.id) return;
      builtFor = def.id;
      for (let i = group.children.length - 1; i >= 0; i -= 1) {
        if (group.children[i] !== flash) group.remove(group.children[i]);
      }
      const inner = new THREE.Group();
      VIEW_BUILDERS[def.id](inner);
      group.add(inner);
      drawT = 0;
    },
    kick(amount) {
      kick = Math.min(0.09, kick + amount * 1.6);
      flashT = 0.045;
      flash.material.opacity = 0.9;
      flash.rotation.z = Math.random() * Math.PI;
    },
    update(dt, reloading) {
      kick = Math.max(0, kick - dt * 0.55);
      drawT = Math.min(1, drawT + dt * 3.2);
      if (flashT > 0) {
        flashT -= dt;
        if (flashT <= 0) flash.material.opacity = 0;
      }
      const drawDip = (1 - drawT) * (1 - drawT) * -0.24;
      const reloadDip = reloading ? -0.16 : 0;
      group.position.y = -0.24 + drawDip + reloadDip - kick * 0.4;
      group.position.z = -0.58 + kick;
      group.rotation.x = kick * 1.7 + (reloading ? 0.5 : 0);
    },
  };
}
