// The one place game state lives, plus the match constants and small math helpers
// every module shares. Modules read and write S; nothing keeps a private copy of
// round, score, money or actor state, so the HUD, the bots and the round machine
// can never disagree about what is true.
import { WEAPONS, makeWeaponState } from './weapons.js';

export const CFG = {
  roundTime: 100, // seconds of live play before the defence wins on the clock
  buyTime: 12, // frozen seconds at each round start, buy menu open
  endTime: 5, // banner pause between rounds
  bombTime: 40, // from planted to detonation
  plantTime: 3.25, // channel to plant the charge
  defuseTime: 5, // channel to defuse it
  roundsToWin: 7, // first to 7 takes the match
  startMoney: 800,
  maxMoney: 16000,
  winReward: 3250,
  plantReward: 300, // to every attacker when the charge goes down
  killReward: 300,
  lossBase: 1400, // losing side's income, +500 per loss in a row, capped
  lossStep: 500,
  lossCap: 2900,
};

export function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// Shortest signed turn from a to b, in radians.
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export const lerpAngle = (a, b, t) => a + angleDelta(a, b) * t;
export const dist2d = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// The match state. phase walks menu -> buy -> live -> (planted) -> over -> buy ...
// and matchover at the end. Actors are plain objects made by makeActor below.
export const S = {
  time: 0, // simulation seconds since boot; every cooldown reads this clock
  phase: 'menu',
  phaseT: 0, // seconds left in the current phase, where a phase is timed
  round: 0,
  scores: { atk: 0, def: 0 },
  lossStreak: { atk: 0, def: 0 },
  actors: [],
  player: null,
  bomb: {
    state: 'carried', // carried | dropped | planted | exploded | defused
    carrier: null, // actor holding it, when carried
    x: 0,
    z: 0, // ground position when dropped or planted
    site: null, // 'A' | 'B' once planted
    timer: 0, // seconds to detonation, once planted
    channel: null, // { actor, kind: 'plant'|'defuse', t, need } while channelling
  },
  noises: [], // { x, z, radius, t } — gunfire and footsteps bots can hear
  smokes: [], // { x, y, z, r, until } — volumes that block sight lines
  winner: null, // 'atk' | 'def' for the round just ended
  winReason: '',
  matchWinner: null,
  plan: { site: 'A' }, // the attack's chosen site this round
  rng: mulberry32(1),
  hooks: {}, // wired by main.js: { onKill(victim, attacker), onPlant(site), ... }
};

export function hearNoise(x, z, radius) {
  S.noises.push({ x, z, radius, t: S.time });
  if (S.noises.length > 24) S.noises.shift();
}

// One combatant, bot or player. pos is the feet; the eye and the hit volumes are
// derived from pos, crouch and the constants in combat.js, so movement, shooting
// and rendering all agree on where a body is.
export function makeActor(team, name, isPlayer) {
  return {
    team, // 'atk' (Jackals, they plant) | 'def' (Wardens, they stop them)
    name,
    isPlayer: !!isPlayer,
    alive: true,
    health: 100,
    armor: 0, // 0..100 points of vest; absorbs 50% of damage while it lasts
    hasArmor: false,
    money: CFG.startMoney,
    kills: 0,
    deaths: 0,
    x: 0,
    y: 0, // feet height above the yard floor (jumping, crate tops)
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0, // facing; for the player this is the camera yaw
    pitch: 0,
    crouch: false,
    onGround: true,
    groundSpeed: 0, // horizontal speed last step, drives spread and noise
    weapons: { primary: null, sidearm: makeWeaponState(WEAPONS.pistol) },
    slot: 'sidearm', // which weapon is in hand: 'primary' | 'sidearm' | 'grenade'
    grenades: { he: 0, flash: 0, smoke: 0 },
    grenadeType: 'he', // the grenade in hand when slot is 'grenade'
    drawT: 0, // seconds until the drawn weapon can fire
    lastHurtT: -9,
    lastHurtYaw: 0, // world yaw the last damage came from, for the HUD arc
    blindUntil: 0, // flash grenade: cannot see (bots) / white screen (player)
    mesh: null, // bot render group, set by bots.js
    brain: null, // bot decision state, set by bots.js
  };
}

export function currentWeapon(actor) {
  if (actor.slot === 'grenade') return null;
  return actor.weapons[actor.slot];
}

export function eyeHeight(actor) {
  return actor.crouch ? 1.18 : 1.62;
}

export function teamAlive(team) {
  let n = 0;
  for (const a of S.actors) if (a.team === team && a.alive) n += 1;
  return n;
}
