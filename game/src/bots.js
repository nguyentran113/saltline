// The nine bots: four Jackals beside the player, five Wardens against them.
// Each has a body built from boxes in its team colour, and a brain that runs on
// a simple loop — perceive (sight lines and gunfire noise), remember, decide,
// move. They walk the world's waypoint graph, hold angles on defence, escort
// the charge on attack, fight in bursts with human reaction delays, and rotate
// when the charge goes down. Their bodies obey the same movement, spread and
// damage rules as the player's.
import * as THREE from 'three';
import { S, clamp, lerpAngle, angleDelta, eyeHeight, makeActor } from './state.js';
import { WEAPONS, makeWeaponState, startReload, stepWeapon } from './weapons.js';
import { PALETTE, mat } from './palette.js';
import { moveActor } from './player.js';

const ATK_NAMES = ['Vex', 'Mako', 'Rune', 'Sable'];
const DEF_NAMES = ['Hollis', 'Petra', 'Ivo', 'Marsh', 'Quill'];
const RADIO = ['Contact', 'Eyes on', 'Hostile', 'Movement'];

function buildBotMesh(team) {
  const main = team === 'atk' ? PALETTE.atk : PALETTE.def;
  const dark = team === 'atk' ? PALETTE.atkDark : PALETTE.defDark;
  const g = new THREE.Group();
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.78, 0.2), mat(PALETTE.dark, 0.95));
  legL.position.set(-0.13, 0.39, 0);
  const legR = legL.clone();
  legR.position.x = 0.13;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.66, 0.3), mat(main, 0.85));
  torso.position.y = 1.12;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.44, 0.34), mat(dark, 0.9));
  vest.position.y = 1.16;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 10, 8), mat(PALETTE.skin, 0.7));
  head.position.y = 1.66;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.3), mat(dark, 0.9));
  cap.position.y = 1.78;
  const gunPivot = new THREE.Group();
  gunPivot.position.set(0.2, 1.38, 0);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.62), mat(PALETTE.dark, 0.6, 0.3));
  gun.position.z = -0.24;
  gunPivot.add(gun);
  for (const m of [legL, legR, torso, vest, head, cap]) {
    m.castShadow = true;
    g.add(m);
  }
  g.add(gunPivot);
  return { group: g, legL, legR, torso, vest, head, cap, gunPivot };
}

export function createBots(scene, world, combat) {
  const bots = [];
  function addBot(team, name) {
    const actor = makeActor(team, name, false);
    actor.mesh = buildBotMesh(team);
    scene.add(actor.mesh.group);
    actor.brain = {
      role: 'hold',
      state: 'hold',
      path: [],
      pathI: 0,
      goalX: 0, goalZ: 0,
      holdYaw: 0,
      seen: new Map(), // actor -> { x, z, t }
      visible: null,
      lastKnown: null, // { x, z, t }
      nextThink: Math.random() * 0.2,
      nextPerceive: Math.random() * 0.12,
      acquireT: 0,
      burstLeft: 0,
      burstPauseUntil: 0,
      strafeDir: 1,
      strafeUntil: 0,
      repathT: 0,
      stuckT: 0,
      lastX: 0, lastZ: 0,
      skill: 0.35 + Math.random() * 0.45,
      radioDone: false,
      grenadeT: 8 + Math.random() * 14,
      walkPhase: Math.random() * 6,
      fallT: 0,
      crouchWish: false,
    };
    bots.push(actor);
    S.actors.push(actor);
    return actor;
  }
  for (const n of ATK_NAMES) addBot('atk', n);
  for (const n of DEF_NAMES) addBot('def', n);

  function giveLoadout(actor, primaryId, { armor = false, he = 0, flash = 0, smoke = 0 } = {}) {
    actor.weapons.primary = primaryId ? makeWeaponState(WEAPONS[primaryId]) : null;
    actor.weapons.sidearm = makeWeaponState(WEAPONS.pistol);
    actor.slot = primaryId ? 'primary' : 'sidearm';
    actor.hasArmor = armor;
    actor.armor = armor ? 100 : 0;
    actor.grenades = { he, flash, smoke };
  }

  // Round setup: positions, loadouts by round number, and each side's plan.
  function resetForRound() {
    const rng = S.rng;
    const planSite = S.plan.site;
    const otherSite = planSite === 'A' ? 'B' : 'A';
    const atkSpawns = world.spawns.atk;
    const defSpawns = world.spawns.def;
    let ai = 1; // slot 0 of the attack spawns is the player's own spot
    let di = 0;
    for (const a of S.actors) {
      if (a.isPlayer) continue;
      const spawn = a.team === 'atk' ? atkSpawns[ai++ % atkSpawns.length] : defSpawns[di++ % defSpawns.length];
      a.x = spawn[0] + (rng() * 1.6 - 0.8);
      a.z = spawn[1] + (rng() * 1.6 - 0.8);
      a.y = 0; a.vx = 0; a.vy = 0; a.vz = 0;
      a.alive = true;
      a.health = 100;
      a.yaw = a.team === 'atk' ? 0 : Math.PI; // attackers face north, defenders south
      a.pitch = 0;
      a.crouch = false;
      a.blindUntil = 0;
      a.mesh.group.rotation.set(0, a.yaw, 0);
      a.mesh.group.visible = true;
      const b = a.brain;
      b.path = []; b.pathI = 0; b.seen.clear(); b.visible = null; b.lastKnown = null;
      b.radioDone = false; b.fallT = 0; b.state = 'advance'; b.crouchWish = rng() < 0.35;
    }
    // Loadouts grow with the rounds, mirroring what the money would buy.
    const r = S.round;
    const atkBots = bots.filter((a) => a.team === 'atk');
    const defBots = bots.filter((a) => a.team === 'def');
    atkBots.forEach((a, i) => {
      if (r === 1) giveLoadout(a, null);
      else if (r === 2) giveLoadout(a, i < 2 ? 'smg' : 'rifle', { armor: i < 3, flash: i === 0 ? 1 : 0 });
      else giveLoadout(a, i === 3 ? 'smg' : 'rifle', { armor: true, he: i === 1 ? 1 : 0, flash: i === 0 ? 1 : 0, smoke: i === 2 ? 1 : 0 });
    });
    defBots.forEach((a, i) => {
      if (r === 1) giveLoadout(a, null);
      else if (r === 2) giveLoadout(a, i < 3 ? 'rifle' : 'smg', { armor: i < 4 });
      else giveLoadout(a, i === 4 ? 'sniper' : 'rifle', { armor: true, he: i === 2 ? 1 : 0, smoke: i === 0 ? 1 : 0 });
    });
    // Attack plan: two escort the carrier's site, one works mid, one lurks wide.
    atkBots.forEach((a, i) => {
      const b = a.brain;
      if (S.bomb.carrier === a) { b.role = 'carrier'; b.goalSite = planSite; }
      else if (i < 2) { b.role = 'escort'; b.goalSite = planSite; }
      else if (i === 2) { b.role = 'mid'; b.goalSite = planSite; }
      else { b.role = 'lurk'; b.goalSite = otherSite; }
      setGoal(a, sitePoint(world, b.goalSite, rng));
    });
    // Defence: two hold each site, one floats mid.
    const holdsA = world.waypoints.filter((w) => w.tags.includes('holdA'));
    const holdsB = world.waypoints.filter((w) => w.tags.includes('holdB'));
    defBots.forEach((a, i) => {
      const b = a.brain;
      b.role = 'hold';
      const pool = i < 2 ? holdsA : i < 4 ? holdsB : null;
      if (pool) {
        const spot = pool[i % pool.length];
        b.goalX = spot.x; b.goalZ = spot.z;
        b.holdYaw = Math.atan2(-(0 - spot.x), -(0 - spot.z)); // roughly toward mid
        b.state = 'advance'; // walks to the hold, then holds
        setGoal(a, spot);
      } else {
        b.goalX = 0; b.goalZ = -14;
        b.holdYaw = Math.PI;
        setGoal(a, { x: 0, z: -14 });
      }
    });
  }

  function sitePoint(worldRef, site, rng) {
    const s = worldRef.sites[site];
    return { x: s.x + (rng() * 4 - 2), z: s.z + (rng() * 4 - 2) };
  }

  function setGoal(a, point) {
    const b = a.brain;
    b.goalX = point.x;
    b.goalZ = point.z;
    b.path = world.findPath(a.x, a.z, point.x, point.z);
    b.pathI = 0;
    b.repathT = S.time + 4;
  }

  function perceive(a) {
    const b = a.brain;
    b.visible = null;
    if (S.time < a.blindUntil) return;
    const eyeY = a.y + eyeHeight(a);
    let bestD = Infinity;
    for (const e of S.actors) {
      if (e.team === a.team || !e.alive) continue;
      const d = Math.hypot(e.x - a.x, e.z - a.z);
      if (d > 62) continue;
      // Field of view: wide, but not through the back of the head.
      const dirYaw = Math.atan2(-(e.x - a.x), -(e.z - a.z));
      if (d > 4 && Math.abs(angleDelta(a.yaw, dirYaw)) > 1.15) continue;
      const chestY = e.y + (e.crouch ? 0.85 : 1.15);
      if (!combat.losClear(a.x, eyeY, a.z, e.x, chestY, e.z)) continue;
      b.seen.set(e, { x: e.x, z: e.z, t: S.time });
      if (d < bestD) { bestD = d; b.visible = e; }
    }
    // Hearing: fresh noise inside its radius pulls attention.
    for (const n of S.noises) {
      if (S.time - n.t > 0.4) continue;
      const d = Math.hypot(n.x - a.x, n.z - a.z);
      if (d < n.radius && d > 3) {
        if (!b.lastKnown || S.time - b.lastKnown.t > 1.5) b.lastKnown = { x: n.x, z: n.z, t: S.time };
      }
    }
    if (b.visible) {
      b.lastKnown = { x: b.visible.x, z: b.visible.z, t: S.time };
      if (!b.radioDone && S.hooks.radio && S.rng() < 0.5 && Math.hypot(b.visible.x - a.x, b.visible.z - a.z) < 42) {
        b.radioDone = true;
        S.hooks.radio(a, b.visible);
      }
    }
  }

  function think(a) {
    const b = a.brain;
    const phase = S.phase;
    if (phase !== 'live' && phase !== 'planted') { b.state = 'hold'; return; }
    // The designated defuser runs the defuse errand above all else.
    if (b.role === 'defuse') {
      b.state = 'defuse';
      setGoal(a, { x: S.bomb.x, z: S.bomb.z });
      return;
    }
    if (b.visible) { b.state = 'engage'; return; }
    if (phase === 'planted') {
      // Attackers fall back onto the site; defenders converge on it.
      const s = world.sites[S.bomb.site];
      if (a.team === 'atk') {
        if (Math.hypot(a.x - s.x, a.z - s.z) > 9) { b.state = 'advance'; setGoal(a, sitePoint(world, S.bomb.site, S.rng)); }
        else b.state = 'hold';
      } else {
        b.state = 'advance';
        setGoal(a, sitePoint(world, S.bomb.site, S.rng));
      }
      return;
    }
    // Live, nothing seen: work the plan, or search the last known position.
    if (b.lastKnown && S.time - b.lastKnown.t < 4 && b.state !== 'search') {
      b.state = 'search';
      setGoal(a, { x: b.lastKnown.x, z: b.lastKnown.z });
      return;
    }
    if (b.role === 'hold') {
      const atHold = Math.hypot(a.x - b.goalX, a.z - b.goalZ) < 1.6;
      b.state = atHold ? 'hold' : 'advance';
      if (!atHold && (!b.path.length || b.pathI >= b.path.length)) setGoal(a, { x: b.goalX, z: b.goalZ });
      return;
    }
    if (b.role === 'carrier' || b.role === 'escort' || b.role === 'mid' || b.role === 'lurk') {
      const s = world.sites[b.goalSite];
      const inSite = Math.hypot(a.x - s.x, a.z - s.z) < s.r;
      if (b.role === 'lurk' && S.time > 55 && !inSite) b.goalSite = S.plan.site; // late rotate
      if (inSite) b.state = 'hold';
      else {
        b.state = 'advance';
        if (!b.path.length || b.pathI >= b.path.length || S.time > b.repathT) setGoal(a, sitePoint(world, b.goalSite, S.rng));
      }
      return;
    }
    b.state = 'advance';
  }

  // Steering + firing for one bot, every simulation step.
  function act(a, dt) {
    const b = a.brain;
    const ws = a.weapons[a.slot === 'grenade' ? 'sidearm' : a.slot] || a.weapons.sidearm;
    let wishX = 0, wishZ = 0, wishSpeed = 0;
    let firing = false;

    if (!a.alive || S.phase === 'buy' || S.phase === 'menu') {
      moveActor(world, a, dt, 0, 0, 0, false);
      syncMesh(a, dt);
      return;
    }

    if (b.state === 'engage' && b.visible && b.visible.alive) {
      const t = b.visible;
      const dx = t.x - a.x, dz = t.z - a.z;
      const d = Math.hypot(dx, dz) || 1;
      const targetYaw = Math.atan2(-dx, -dz);
      a.yaw = lerpAngle(a.yaw, targetYaw, Math.min(1, dt * 9));
      const chestY = t.y + (t.crouch ? 0.85 : 1.12);
      a.pitch = clamp(Math.atan2(chestY - (a.y + eyeHeight(a)), d), -1.2, 1.2);
      // Keep the weapon's favourite range band; strafe inside it.
      const band = ws.def.id === 'shotgun' ? [3, 9] : ws.def.id === 'sniper' ? [18, 42] : ws.def.id === 'smg' ? [5, 15] : [9, 26];
      if (S.time > b.strafeUntil) {
        b.strafeDir = S.rng() < 0.5 ? -1 : 1;
        b.strafeUntil = S.time + 0.6 + S.rng() * 0.9;
      }
      let mx = 0, mz = 0;
      if (d > band[1]) { mx = dx / d; mz = dz / d; }
      else if (d < band[0]) { mx = -dx / d; mz = -dz / d; }
      else { mx = (-dz / d) * b.strafeDir; mz = (dx / d) * b.strafeDir; }
      wishX = mx; wishZ = mz;
      wishSpeed = ws.def.moveSpeed * (d > band[1] ? 0.98 : 0.62);
      a.crouch = b.crouchWish && d > 13;
      // Fire control: reaction delay, then bursts with a thinking pause.
      const eyeY = a.y + eyeHeight(a);
      const canSee = combat.losClear(a.x, eyeY, a.z, t.x, chestY, t.z);
      if (canSee && S.time >= b.acquireT && S.time >= ws.nextShotT) {
        if (b.burstLeft <= 0 && S.time >= b.burstPauseUntil) {
          b.burstLeft = ws.def.id === 'sniper' || ws.def.id === 'shotgun' ? 1 : 3 + Math.floor(S.rng() * 3);
        }
        if (b.burstLeft > 0) {
          // Aim error: skill, target speed and own speed all open it up.
          const err = (0.052 - b.skill * 0.034) + t.groundSpeed * 0.0035 + a.groundSpeed * 0.002;
          const aimYaw = targetYaw + (S.rng() * 2 - 1) * err;
          const aimPitch = a.pitch + (S.rng() * 2 - 1) * err * 0.7 + (S.rng() < 0.22 ? 0.055 : 0); // sometimes the head
          const dirX = -Math.sin(aimYaw) * Math.cos(aimPitch);
          const dirY = Math.sin(aimPitch);
          const dirZ = -Math.cos(aimYaw) * Math.cos(aimPitch);
          const cur = a.weapons[a.slot];
          if (cur && !cur.reloading && cur.mag > 0) {
            if (combat.fire(a, dirX, dirY, dirZ)) {
              firing = true;
              b.burstLeft -= 1;
              if (b.burstLeft <= 0) b.burstPauseUntil = S.time + 0.32 + S.rng() * 0.45;
            }
          } else if (cur && cur.mag === 0) startReload(a, cur);
        }
      }
      // A grenade lobbed at a mid-range target breaks a stalemate.
      if (d > 9 && d < 24 && S.time > b.grenadeT && (a.grenades.he > 0 || a.grenades.flash > 0)) {
        b.grenadeT = S.time + 16 + S.rng() * 14;
        a.grenadeType = a.grenades.he > 0 ? 'he' : 'flash';
        a.pitch = clamp(Math.atan2(chestY - (a.y + eyeHeight(a)), d) + d * 0.012, -1, 1);
        combat.throwGrenade(a);
      }
    } else if (b.state === 'hold') {
      a.yaw = lerpAngle(a.yaw, b.holdYaw + Math.sin(S.time * 0.35 + b.walkPhase) * 0.4, Math.min(1, dt * 3));
      a.pitch = lerpPitch(a.pitch, 0, dt);
      a.crouch = b.crouchWish;
    } else {
      // advance / search / defuse: walk the path.
      a.crouch = b.state === 'search' && b.lastKnown && Math.hypot(b.lastKnown.x - a.x, b.lastKnown.z - a.z) < 8;
      if (b.pathI < b.path.length) {
        const p = b.path[b.pathI];
        const dx = p.x - a.x, dz = p.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.15) b.pathI += 1;
        else {
          wishX = dx / d; wishZ = dz / d;
          wishSpeed = (ws.def.moveSpeed || 5.2) * (a.crouch ? 0.5 : 0.97);
          a.yaw = lerpAngle(a.yaw, Math.atan2(-dx, -dz), Math.min(1, dt * 5));
          a.pitch = lerpPitch(a.pitch, 0, dt);
        }
      } else if (b.state === 'defuse') {
        a.crouch = true; // at the charge, working on it
      } else if (b.state !== 'hold') {
        b.state = a.team === 'def' ? 'hold' : b.state;
        if (a.team === 'atk') think(a);
      }
      // Stuck? Replan once, then hop.
      const moved = Math.hypot(a.x - b.lastX, a.z - b.lastZ);
      if (wishSpeed > 0 && moved < 0.05) {
        b.stuckT += dt;
        if (b.stuckT > 1.3) {
          b.stuckT = 0;
          setGoal(a, { x: b.goalX, z: b.goalZ });
          moveActor(world, a, dt, wishX, wishZ, wishSpeed, true);
        }
      } else b.stuckT = 0;
    }
    b.lastX = a.x; b.lastZ = a.z;

    // Reload discipline and bloom recovery for the held weapon.
    const cur = a.weapons[a.slot];
    if (cur) {
      if (cur.mag === 0 && !cur.reloading) startReload(a, cur);
      else if (cur.mag < cur.def.magSize * 0.3 && b.state !== 'engage' && !cur.reloading && cur.reserve > 0) startReload(a, cur);
      stepWeapon(a, cur, dt, firing);
    }
    if (a.drawT > 0) a.drawT -= dt;
    moveActor(world, a, dt, wishX, wishZ, wishSpeed, false);
    syncMesh(a, dt);
  }

  function lerpPitch(pitch, target, dt) {
    return pitch + (target - pitch) * Math.min(1, dt * 5);
  }

  function syncMesh(a, dt) {
    const m = a.mesh;
    const g = m.group;
    if (!a.alive) {
      a.brain.fallT = Math.min(1, a.brain.fallT + dt * 2.4);
      g.rotation.x = -Math.PI / 2 * a.brain.fallT * 0.92;
      g.position.set(a.x, a.y + 0.06, a.z);
      return;
    }
    g.rotation.x = 0;
    const speed = a.groundSpeed;
    a.brain.walkPhase += dt * speed * 1.9;
    const swing = Math.sin(a.brain.walkPhase) * clamp(speed / 5, 0, 1) * 0.5;
    m.legL.rotation.x = swing;
    m.legR.rotation.x = -swing;
    const crouchDrop = a.crouch ? 0.34 : 0;
    m.torso.position.y = 1.12 - crouchDrop;
    m.vest.position.y = 1.16 - crouchDrop;
    m.head.position.y = 1.66 - crouchDrop;
    m.cap.position.y = 1.78 - crouchDrop;
    m.gunPivot.position.y = 1.38 - crouchDrop;
    m.gunPivot.rotation.x = -a.pitch;
    g.position.set(a.x, a.y + (a.onGround ? Math.abs(Math.sin(a.brain.walkPhase)) * 0.035 * clamp(speed / 5, 0, 1) : 0), a.z);
    g.rotation.y = a.yaw;
  }

  function update(dt) {
    for (const a of bots) {
      const b = a.brain;
      if (a.alive && S.time >= b.nextPerceive) {
        b.nextPerceive = S.time + 0.12;
        const wasVisible = b.visible;
        perceive(a);
        if (b.visible && !wasVisible) b.acquireT = S.time + 0.42 - b.skill * 0.22;
        if (!b.visible && wasVisible) b.acquireT = 0;
      }
      if (a.alive && S.time >= b.nextThink) {
        b.nextThink = S.time + 0.2;
        think(a);
      }
      act(a, dt);
    }
  }

  // Rounds calls these when the charge changes hands mid-round.
  function makeCarrier(a) {
    const b = a.brain;
    b.role = 'carrier';
    b.goalSite = S.plan.site;
    b.state = 'advance';
    setGoal(a, sitePoint(world, S.plan.site, S.rng));
  }
  function makeDefuser(a) {
    a.brain.role = 'defuse';
    a.brain.state = 'defuse';
  }

  return { bots, resetForRound, update, makeCarrier, makeDefuser };
}
