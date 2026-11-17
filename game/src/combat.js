// Shooting, damage and grenades. A shot is a ray from the shooter's eye: it is
// tested against the world's boxes and against every enemy body — a head
// sphere above a body capsule — and the nearer hit wins. Damage falls off with
// distance, the head pays four times the chest and the legs three quarters,
// and a vest halves what reaches health while it lasts. Grenades are small
// ballistic bodies with a fuse: frag damages through a radius, flash blinds
// whoever faces it, smoke raises a volume that sight lines cannot cross.
import { S, currentWeapon, eyeHeight, hearNoise, clamp } from './state.js';
import { currentSpread, registerShot, startReload } from './weapons.js';
import { PALETTE } from './palette.js';

const HEAD_MULT = 4;
const LEG_MULT = 0.75;

export function createCombat(world, fx, audio) {
  const grenades = []; // { x,y,z, vx,vy,vz, type, from, fuse }

  function eyeOf(actor) {
    return { x: actor.x, y: actor.y + eyeHeight(actor), z: actor.z };
  }

  // Does the segment pass through any live smoke volume?
  function smokeBlocks(ax, ay, az, bx, by, bz) {
    for (const s of S.smokes) {
      // Closest distance from the smoke centre to the segment.
      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const len2 = abx * abx + aby * aby + abz * abz || 1;
      let t = ((s.x - ax) * abx + (s.y - ay) * aby + (s.z - az) * abz) / len2;
      t = clamp(t, 0, 1);
      const dx = ax + abx * t - s.x, dy = ay + aby * t - s.y, dz = az + abz * t - s.z;
      if (dx * dx + dy * dy + dz * dz < s.r * s.r * 0.85) return true;
    }
    return false;
  }

  function losClear(ax, ay, az, bx, by, bz) {
    if (world.losBlocked(ax, ay, az, bx, by, bz)) return false;
    return !smokeBlocks(ax, ay, az, bx, by, bz);
  }

  // Ray vs one body: returns { t, part } or null. The head is a sphere; the
  // body a vertical capsule segment, split into legs below the knee line.
  function rayBody(actor, ox, oy, oz, dx, dy, dz, maxT) {
    const crouch = actor.crouch;
    const headY = actor.y + (crouch ? 1.08 : 1.53);
    // Head sphere, radius 0.23.
    const hx = actor.x - ox, hy = headY - oy, hz = actor.z - oz;
    const th = hx * dx + hy * dy + hz * dz;
    let best = null;
    if (th > 0 && th < maxT) {
      const px = ox + dx * th - actor.x, py = oy + dy * th - headY, pz = oz + dz * th - actor.z;
      if (px * px + py * py + pz * pz < 0.23 * 0.23) best = { t: th, part: 'head' };
    }
    // Body capsule: segment from hips to chest, radius 0.37.
    const y0 = actor.y + 0.3, y1 = actor.y + (crouch ? 0.92 : 1.34);
    // Closest approach between the ray and the vertical segment.
    const segLen = y1 - y0;
    let bestD2 = Infinity, bestT = 0, bestY = y0;
    for (let i = 0; i <= 4; i += 1) {
      const cy = y0 + (segLen * i) / 4;
      const cx = actor.x - ox, cz = actor.z - oz, cyy = cy - oy;
      const t = cx * dx + cyy * dy + cz * dz;
      if (t < 0 || t > maxT) continue;
      const px = ox + dx * t - actor.x, py = oy + dy * t - cy, pz = oz + dz * t - actor.z;
      const d2 = px * px + py * py + pz * pz;
      if (d2 < bestD2) { bestD2 = d2; bestT = t; bestY = cy; }
    }
    if (bestD2 < 0.37 * 0.37 && (!best || bestT < best.t)) {
      best = { t: bestT, part: bestY < actor.y + 0.55 ? 'legs' : 'body' };
    }
    return best;
  }

  function applyDamage(target, amount, attacker, part) {
    if (!target.alive || S.phase === 'over' || S.phase === 'matchover') return false;
    let dmg = amount;
    if (target.hasArmor && target.armor > 0) {
      const absorbed = Math.min(target.armor, dmg * 0.5);
      target.armor -= absorbed;
      dmg -= absorbed;
    }
    target.health -= dmg;
    target.lastHurtT = S.time;
    if (attacker) target.lastHurtYaw = Math.atan2(-(attacker.x - target.x), -(attacker.z - target.z));
    if (target.isPlayer && S.hooks.onPlayerHurt) S.hooks.onPlayerHurt(dmg, target.lastHurtYaw);
    if (target.health <= 0) {
      target.health = 0;
      target.alive = false;
      target.deaths += 1;
      if (attacker && attacker !== target) attacker.kills += 1;
      if (S.hooks.onKill) S.hooks.onKill(target, attacker, part);
      return true;
    }
    return false;
  }

  // Fire one trigger pull (all pellets). Caller aims the base direction; this
  // applies spread, bloom, ammo, sound, tracers and damage. Returns true when
  // a shot actually left the barrel.
  function fire(actor, dx, dy, dz) {
    const ws = currentWeapon(actor);
    if (!ws || ws.reloading || actor.drawT > 0 || !actor.alive) return false;
    if (S.time < ws.nextShotT) return false;
    if (ws.mag <= 0) {
      ws.nextShotT = S.time + 0.3;
      if (actor.isPlayer) audio.dryFire();
      startReload(actor, ws);
      return false;
    }
    const def = ws.def;
    ws.mag -= 1;
    ws.nextShotT = S.time + 60 / def.rpm;
    registerShot(ws);
    const eye = eyeOf(actor);
    const spread = currentSpread(actor, ws);
    // Orthonormal basis around the aim direction, for the spread cone.
    const ux = -dz, uz = dx; // horizontal perpendicular
    const uLen = Math.hypot(ux, uz) || 1;
    const px = ux / uLen, pz = uz / uLen;
    // The second spread axis, v = d x p.
    const vxx = dy * pz, vyy = dz * px - dx * pz, vzz = -dy * px;
    const muzzle = {
      x: eye.x + dx * 0.55 + px * 0.18,
      y: eye.y - 0.14 + dy * 0.55,
      z: eye.z + dz * 0.55 + pz * 0.18,
    };
    if (!actor.isPlayer) fx.muzzle(muzzle.x, muzzle.y, muzzle.z);
    let anyHit = false;
    let anyKill = false;
    for (let p = 0; p < def.pellets; p += 1) {
      const a1 = (S.rng() * 2 - 1) * spread;
      const a2 = (S.rng() * 2 - 1) * spread;
      let sx = dx + px * a1 + vxx * a2;
      let sy = dy + vyy * a2;
      let sz = dz + pz * a1 + vzz * a2;
      const sl = Math.hypot(sx, sy, sz) || 1;
      sx /= sl; sy /= sl; sz /= sl;
      const wall = world.rayHit(eye.x, eye.y, eye.z, sx, sy, sz, 120);
      let bestT = wall.hit ? wall.dist : 120;
      let bestActor = null;
      let bestPart = 'body';
      for (const other of S.actors) {
        if (other === actor || !other.alive || other.team === actor.team) continue;
        const hit = rayBody(other, eye.x, eye.y, eye.z, sx, sy, sz, bestT);
        if (hit && hit.t < bestT) {
          bestT = hit.t;
          bestActor = other;
          bestPart = hit.part;
        }
      }
      const endX = eye.x + sx * bestT, endY = eye.y + sy * bestT, endZ = eye.z + sz * bestT;
      fx.tracer(muzzle.x, muzzle.y, muzzle.z, endX, endY, endZ, actor.team === 'atk' ? PALETTE.tracerAtk : PALETTE.tracerDef);
      if (bestActor) {
        const fall = bestT <= def.falloff ? 1 : Math.max(0.35, 1 - (bestT - def.falloff) / 55);
        const mult = bestPart === 'head' ? HEAD_MULT : bestPart === 'legs' ? LEG_MULT : 1;
        const killed = applyDamage(bestActor, def.damage * fall * mult, actor, bestPart);
        fx.impact(endX, endY, endZ, 'flesh');
        anyHit = true;
        if (killed) anyKill = true;
      } else if (wall.hit) {
        fx.impact(wall.x, wall.y, wall.z, 'wall');
      }
    }
    const distToPlayer = S.player ? Math.hypot(S.player.x - actor.x, S.player.z - actor.z) : 0;
    audio.shot(def.sound, actor.isPlayer ? 0 : distToPlayer);
    hearNoise(actor.x, actor.z, 30); // gunfire carries across the yard
    if (actor.isPlayer && S.hooks.onPlayerShoot) S.hooks.onPlayerShoot(ws, anyHit, anyKill);
    if (ws.mag === 0) startReload(actor, ws);
    return true;
  }

  function throwGrenade(actor) {
    const type = actor.grenadeType;
    if (actor.grenades[type] <= 0 || !actor.alive) return false;
    actor.grenades[type] -= 1;
    const eye = eyeOf(actor);
    const sin = Math.sin(actor.yaw), cos = Math.cos(actor.yaw);
    const cp = Math.cos(actor.pitch);
    const dx = -sin * cp, dy = Math.sin(actor.pitch) + 0.32, dz = -cos * cp;
    grenades.push({
      x: eye.x + dx * 0.4, y: eye.y - 0.1, z: eye.z + dz * 0.4,
      vx: dx * 15, vy: dy * 15, vz: dz * 15,
      type, from: actor, fuse: 1.6,
    });
    if (actor.isPlayer) audio.throwWhoosh();
    return true;
  }

  function explodeFrag(g) {
    fx.explosion(g.x, g.y + 0.3, g.z, 0.55);
    audio.explosion();
    for (const a of S.actors) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - g.x, a.z - g.z);
      if (d > 6.5) continue;
      const chestY = a.y + 1.0;
      if (!losClear(g.x, g.y + 0.4, g.z, a.x, chestY, a.z) && d > 1.2) continue;
      const dmg = 92 * Math.pow(1 - d / 6.5, 1.15) + 4;
      applyDamage(a, dmg, g.from, 'body');
    }
  }

  function popFlash(g) {
    fx.muzzle(g.x, g.y, g.z);
    audio.flashPop();
    for (const a of S.actors) {
      if (!a.alive) continue;
      const eye = eyeOf(a);
      const d = Math.hypot(g.x - eye.x, g.y - eye.y, g.z - eye.z);
      if (d > 19) continue;
      if (world.losBlocked(eye.x, eye.y, eye.z, g.x, g.y, g.z)) continue;
      // Facing factor: 1 looking straight at it, 0 looking away.
      const fx2 = -Math.sin(a.yaw) * Math.cos(a.pitch);
      const fz2 = -Math.cos(a.yaw) * Math.cos(a.pitch);
      const fy2 = Math.sin(a.pitch);
      const tx = (g.x - eye.x) / d, ty = (g.y - eye.y) / d, tz = (g.z - eye.z) / d;
      const facing = fx2 * tx + fy2 * ty + fz2 * tz;
      const strength = clamp((facing + 0.35) / 1.35, 0, 1) * clamp(1 - d / 22, 0.25, 1);
      if (strength <= 0.05 && d > 3) continue;
      const dur = 0.6 + strength * 3.6;
      a.blindUntil = Math.max(a.blindUntil, S.time + dur);
      if (a.isPlayer && S.hooks.onPlayerFlash) S.hooks.onPlayerFlash(strength);
    }
  }

  function updateGrenades(dt) {
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      if (g.fuse <= 0) {
        grenades.splice(i, 1);
        if (g.type === 'he') explodeFrag(g);
        else if (g.type === 'flash') popFlash(g);
        else {
          const smoke = { x: g.x, y: 1.5, z: g.z, r: 4.3, until: S.time + 14, rng: S.rng };
          S.smokes.push(smoke);
          fx.addSmoke(smoke);
        }
        continue;
      }
      g.vy -= 13 * dt;
      const nx = g.x + g.vx * dt, ny = g.y + g.vy * dt, nz = g.z + g.vz * dt;
      const dx = nx - g.x, dy = ny - g.y, dz = nz - g.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 0) {
        const hit = world.rayHit(g.x, g.y, g.z, dx / d, dy / d, dz / d, d);
        if (hit.hit) {
          g.x = hit.x - (dx / d) * 0.05;
          g.y = Math.max(0.16, hit.y - (dy / d) * 0.05);
          g.z = hit.z - (dz / d) * 0.05;
          g.vx = 0; g.vy = 0; g.vz = 0;
          continue;
        }
      }
      g.x = nx; g.y = ny; g.z = nz;
      if (g.y < 0.16) {
        g.y = 0.16;
        g.vy = Math.abs(g.vy) > 1.5 ? -g.vy * 0.35 : 0;
        g.vx *= 0.7;
        g.vz *= 0.7;
      }
    }
    // Retire expired smoke.
    for (let i = S.smokes.length - 1; i >= 0; i -= 1) {
      if (S.time > S.smokes[i].until) {
        fx.removeSmoke(S.smokes[i]);
        S.smokes.splice(i, 1);
      }
    }
  }

  // The planted charge going off: lethal close in, heavy damage to 11 m.
  function explodeCharge(x, z) {
    fx.explosion(x, 1.1, z, 2.6);
    audio.explosion();
    for (const a of S.actors) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - x, a.z - z);
      if (d > 11) continue;
      const dmg = d < 4.5 ? 300 : 160 * (1 - (d - 4.5) / 6.5);
      applyDamage(a, dmg, null, 'body');
    }
  }

  return { fire, losClear, throwGrenade, updateGrenades, explodeCharge, eyeOf };
}
