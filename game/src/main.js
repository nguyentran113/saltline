// SALTLINE — boot and the one loop. A fixed 60 Hz simulation (rounds, player,
// bots, grenades) feeds rendering at the display's rate; the camera, viewmodel
// and HUD are refreshed from state after each step, never the other way round.
// ?shot=start|play|end with &seed=N poses a deterministic frame for captures:
// it plays the real systems for a few steps, poses the cover moment, renders
// twice and freezes with window.__shotReady set.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { S, makeActor, currentWeapon, mulberry32 } from './state.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayerController } from './player.js';
import { createViewmodel, currentSpread, stepWeapon, startReload, WEAPONS, makeWeaponState } from './weapons.js';
import { createFx } from './fx.js';
import { createCombat } from './combat.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
if (shot) S.rng = mulberry32(seed * 7919 + 101);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 30, 95);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 220);
scene.add(camera);

const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(PALETTE.sun, 1.9);
sun.position.set(34, 42, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
sun.shadow.camera.far = 120;
sun.shadow.bias = -0.0006;
scene.add(sun);

const audio = createAudio();
const world = createWorld(scene);
S.worldSites = world.sites;
const fx = createFx(scene);
const combat = createCombat(world, fx, audio);
const hud = createHud();

const player = makeActor('atk', 'You', true);
S.player = player;
S.actors.push(player);
player.x = world.spawns.atk[0][0];
player.z = world.spawns.atk[0][1];

const bots = createBots(scene, world, combat);
const rounds = createRounds(world, bots, combat, hud, audio);
const controller = createPlayerController(player);
const viewmodel = createViewmodel(camera);
let paused = false;
let started = false;
let frozen = false;

// ---------------------------------------------------------------------------
// Hooks: what combat and the bots report back to the rest of the game.

const PLACES = [
  [(x, z) => Math.hypot(x + 23, z + 4) < 9, 'the Kiln Yard'],
  [(x, z) => Math.hypot(x - 23, z - 4) < 9, 'the Pump House'],
  [(x, z) => Math.abs(x) < 6, 'the Canal'],
  [(x, z) => z > 15, 'the Dock'],
  [(x, z) => z < -15, 'the Office Yard'],
  [(x, z) => x < -9, 'the west lanes'],
  [(x, z) => x > 9, 'the east lanes'],
];
function placeName(x, z) {
  for (const [test, name] of PLACES) if (test(x, z)) return name;
  return 'Mid';
}
const RADIO_WORDS = ['Contact', 'Eyes on', 'Hostile', 'Movement'];

S.hooks.onKill = (victim, attacker, part) => rounds.onKill(victim, attacker, part);
S.hooks.onPlayerShoot = (ws, hit, kill) => {
  viewmodel.kick(ws.def.recoil);
  controller.kick(ws.def.recoil * (0.8 + S.rng() * 0.4), (S.rng() * 2 - 1) * ws.def.recoil * 0.35);
  if (hit) {
    hud.hitmarker(kill);
    audio.hit(kill);
  }
};
S.hooks.onPlayerHurt = (dmg, yaw) => {
  hud.damageFrom(yaw);
  fx.addShake(Math.min(0.22, dmg * 0.004));
  audio.hurt();
};
S.hooks.onPlayerFlash = (strength) => hud.flash(strength);
S.hooks.onPlayerStep = (dist) => audio.step(dist);
S.hooks.radio = (bot, enemy) => {
  hud.radio(bot.name, `${RADIO_WORDS[Math.floor(S.rng() * RADIO_WORDS.length)]} — ${placeName(enemy.x, enemy.z)}!`);
};

// ---------------------------------------------------------------------------
// Input and the player's own actions.

const input = createInput(renderer.domElement, (locked) => {
  if (shot) return;
  if (locked) {
    paused = false;
    hud.hideOverlay();
  } else if (started && S.phase !== 'menu' && S.phase !== 'matchover') {
    paused = true;
    hud.showOverlay('pause');
  }
});
hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (S.phase === 'menu' || S.phase === 'matchover') {
    started = true;
    rounds.startMatch();
  }
  paused = false;
  hud.hideOverlay();
  input.requestLock();
});

let prevFiring = false;
function playerActions(dt) {
  const pressed = input.drainPressed();
  const wheel = input.drainWheel();
  S.channelHeld = input.state.keys.has('KeyE');
  const ws = currentWeapon(player);
  // Scoping the marksman.
  player.scoped = !!(input.state.aiming && ws && ws.def.zoom && player.slot === 'primary' && player.alive);
  // Weapon selection.
  const draw = (slot) => {
    if (player.slot === slot) return;
    if (slot === 'primary' && !player.weapons.primary) return;
    player.slot = slot;
    player.drawT = 0.32;
    audio.draw();
    if (slot !== 'grenade') viewmodel.setWeapon(player.weapons[slot].def);
  };
  for (const code of pressed) {
    if (code === 'Digit1') draw('primary');
    else if (code === 'Digit2') draw('sidearm');
    else if (code === 'Digit4') {
      // Grenade in hand; pressing again cycles the type among those carried.
      const owned = ['he', 'flash', 'smoke'].filter((t) => player.grenades[t] > 0);
      if (owned.length) {
        if (player.slot !== 'grenade') {
          player.slot = 'grenade';
          player.grenadeType = owned.includes(player.grenadeType) ? player.grenadeType : owned[0];
          player.drawT = 0.25;
        } else {
          const next = owned[(owned.indexOf(player.grenadeType) + 1) % owned.length];
          player.grenadeType = next;
        }
      }
    } else if (code === 'KeyR') {
      if (ws && startReload(player, ws)) audio.reload();
    } else if (code === 'KeyG') {
      const owned = ['he', 'flash', 'smoke'].filter((t) => player.grenades[t] > 0);
      if (owned.length && player.alive) {
        if (!owned.includes(player.grenadeType)) player.grenadeType = owned[0];
        if (combat.throwGrenade(player)) player.drawT = 0.45;
      }
    }
  }
  if (wheel !== 0 && player.weapons.primary) draw(player.slot === 'primary' ? 'sidearm' : 'primary');
  // Buy phase purchases ride the number keys.
  if (S.phase === 'buy') {
    const buyKeys = { Digit1: 'smg', Digit2: 'shotgun', Digit3: 'rifle', Digit4: 'sniper', Digit5: 'armor', Digit6: 'he', Digit7: 'flash', Digit8: 'smoke', Digit9: 'ammo' };
    for (const code of pressed) {
      const item = buyKeys[code];
      if (item) {
        if (rounds.buy(item)) audio.click();
        else audio.denied();
      }
    }
  }
  // Firing and throwing.
  const firing = input.state.firing;
  const triggerEdge = firing && !prevFiring;
  prevFiring = firing;
  if (player.alive && (S.phase === 'live' || S.phase === 'planted')) {
    if (player.slot === 'grenade') {
      if (triggerEdge && player.drawT <= 0) {
        if (combat.throwGrenade(player)) {
          player.drawT = 0.45;
          player.slot = player.weapons.primary ? 'primary' : 'sidearm';
          viewmodel.setWeapon(currentWeapon(player).def);
        }
      }
    } else if (ws && firing && (ws.def.auto || triggerEdge)) {
      camera.getWorldDirection(tmpDir);
      combat.fire(player, tmpDir.x, tmpDir.y, tmpDir.z);
    }
  }
  if (ws) stepWeapon(player, ws, dt, firing);
  if (player.drawT > 0) player.drawT -= dt;
}
const tmpDir = new THREE.Vector3();

// ---------------------------------------------------------------------------
// The fixed-step simulation.

function step(dt) {
  S.time += dt;
  rounds.update(dt);
  if (S.phase !== 'menu') {
    const look = input.takeLook();
    if (!shot) controller.look(look.x, look.y);
    playerActions(dt);
    if (player.alive && S.phase !== 'buy') controller.step(world, dt, input);
    bots.update(dt);
    combat.updateGrenades(dt);
  }
  world.update(dt);
}

function syncCamera(dt) {
  if (player.alive) {
    camera.position.set(player.x, player.y + (player.crouch ? 1.18 : 1.62), player.z);
    camera.rotation.set(controller.viewPitch(), controller.viewYaw(), 0, 'YXZ');
  } else {
    camera.position.set(player.x, player.y + 2.4, player.z);
    camera.rotation.set(-0.5, player.yaw, 0, 'YXZ');
  }
  const shake = fx.shake();
  if (shake > 0.001) {
    camera.position.x += (Math.random() * 2 - 1) * shake * 0.14;
    camera.position.y += (Math.random() * 2 - 1) * shake * 0.14;
  }
  const targetFov = player.scoped ? currentWeapon(player).def.zoom : 74;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 11);
  camera.updateProjectionMatrix();
  viewmodel.group.visible = player.alive && !player.scoped;
  const ws = currentWeapon(player);
  if (ws && player.slot !== 'grenade') viewmodel.setWeapon(ws.def);
  viewmodel.update(dt, ws ? ws.reloading : false);
}

let accumulator = 0;
let lastTime = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen && !paused) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
  }
  syncCamera(dt);
  fx.update(dt, camera);
  const ws = currentWeapon(player);
  const spreadPx = ws ? (currentSpread(player, ws) * (window.innerHeight / 2)) / Math.tan((camera.fov * Math.PI) / 360) : 4;
  hud.sync(controller.viewYaw(), spreadPx);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Screenshot scenes: real systems, posed covers.

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function bot(name) {
  return S.actors.find((a) => a.name === name);
}

function runShot(name) {
  started = true;
  hud.hideOverlay();
  rounds.startMatch(); // round 1, buy phase, everyone at their spawns
  if (name === 'start') {
    // The cover: buy phase at the dock, rifle in hand, the menu open, the
    // squad around you and the yard opening to the north-west.
    player.weapons.primary = makeWeaponState(WEAPONS.rifle);
    player.slot = 'primary';
    player.money = 800;
    player.yaw = 0.55;
    player.pitch = 0.02;
    viewmodel.setWeapon(WEAPONS.rifle);
    settle(24);
  } else if (name === 'play') {
    // Mid-round at the canal: the charge is down at A, a Warden crosses the
    // canal into your sights, another fires from the mid house door.
    settle(2);
    S.phase = 'live';
    S.phaseT = 61;
    player.weapons.primary = makeWeaponState(WEAPONS.rifle);
    player.slot = 'primary';
    player.hasArmor = true;
    player.armor = 64;
    player.health = 78;
    player.money = 3150;
    player.x = 0.6; player.z = 10.5; player.yaw = -0.1; player.pitch = 0.01;
    S.bomb.state = 'planted';
    S.bomb.site = 'A';
    S.bomb.x = -22.5; S.bomb.z = -5;
    S.bomb.timer = 23.4;
    S.phase = 'planted';
    settle(26); // let the round breathe from the spawns before posing anyone
    // Pose the moment itself: no sim steps run after this, so nobody drifts
    // and nobody shoots the player while the shutter is open.
    const ivo = bot('Ivo');
    ivo.alive = true; ivo.health = 100;
    ivo.x = 2.4; ivo.z = -1.5; ivo.yaw = Math.PI - 0.2;
    const petra = bot('Petra');
    petra.x = -4.6; petra.z = -4.4; petra.yaw = Math.PI + 0.5;
    const vex = bot('Vex');
    vex.x = -3.4; vex.z = 13.5; vex.yaw = 0.3;
    const mako = bot('Mako');
    mako.x = 13.5; mako.z = 6; mako.yaw = -0.7;
    const hollis = bot('Hollis');
    hollis.x = -18.5; hollis.z = -9.5; hollis.yaw = 2.4;
    hollis.brain.role = 'defuse';
    player.alive = true;
    player.health = 78;
    player.armor = 64;
    player.x = 0.6; player.z = 10.5; player.yaw = -0.1; player.pitch = 0.01;
    const eyeY = player.y + 1.62;
    const dx = ivo.x - player.x, dy = ivo.y + 1.15 - eyeY, dz = ivo.z - player.z;
    const dl = Math.hypot(dx, dy, dz);
    combat.fire(player, dx / dl, dy / dl, dz / dl);
    hud.hitmarker(false);
    hud.clearFeed();
    hud.killfeed(`— Round ${S.round} · the call is site ${S.plan.site} —`, 'sys');
    hud.killfeed('📻 Rune: Holding A-long!', 'radio');
    hud.killfeed('📻 Vex: Charge is down — cover me!', 'radio');
    hud.banner('CHARGE PLANTED', 'Site A — Kiln Yard');
  } else if (name === 'end') {
    // The round just won at the Kiln Yard: smoke over the crater, a Warden
    // down, your Jackals standing in the site as the banner lands.
    S.scores.atk = 5;
    S.scores.def = 3;
    S.round = 8;
    S.phase = 'over';
    S.winner = 'atk';
    player.weapons.primary = makeWeaponState(WEAPONS.rifle);
    player.slot = 'primary';
    player.x = -15.5; player.z = 2.5; player.yaw = 0.85; player.pitch = -0.02;
    player.money = 6400;
    const vex = bot('Vex');
    vex.x = -21.5; vex.z = -7.5; vex.yaw = -0.6;
    const rune = bot('Rune');
    rune.x = -24.8; rune.z = -6.8; rune.yaw = 1.9;
    const marsh = bot('Marsh');
    marsh.alive = false;
    marsh.health = 0;
    marsh.x = -23.5; marsh.z = -3.4;
    marsh.brain.fallT = 1;
    const smoke = { x: -27.5, y: 1.5, z: -3, r: 2.6, until: S.time + 999, rng: S.rng };
    S.smokes.push(smoke);
    fx.addSmoke(smoke);
    settle(16);
    hud.banner('ROUND WON', 'Charge detonated — Kiln Yard');
  }
  syncCamera(0.016);
  const ws = currentWeapon(player);
  const spreadPx = ws ? (currentSpread(player, ws) * (window.innerHeight / 2)) / Math.tan((camera.fov * Math.PI) / 360) : 4;
  hud.sync(controller.viewYaw(), spreadPx);
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera(0.016);
    fx.update(0.016, camera);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Backdrop for the menu: a squad standing at the dock, round not yet started.
S.round = 1;
S.plan.site = 'A';
S.bomb.carrier = player;
bots.resetForRound();
bots.update(0.016); // settle the meshes onto their spawn points for the backdrop
player.yaw = 0.55;

if (shot) runShot(shot);
else requestAnimationFrame(frame);
