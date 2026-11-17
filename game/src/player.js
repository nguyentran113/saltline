// Movement and collision for every body in the game, player and bots alike:
// velocity with ground acceleration and friction, gravity, jumping, crouching,
// and axis-by-axis resolution against the world's boxes with a small step-up so
// curbs and crate lips do not snag. The player adds mouse look and recoil on
// top of the same physics, so a bot's body obeys exactly the rules yours does.
import { S, clamp, eyeHeight, hearNoise } from './state.js';
import { currentWeapon } from './state.js';

const RADIUS = 0.34;
const STEP_UP = 0.56;
const GRAVITY = 22;

export function actorHeight(actor) {
  return actor.crouch ? 1.32 : 1.8;
}

function overlaps(world, actor, x, y, z) {
  const h = actorHeight(actor);
  for (const c of world.colliders) {
    if (x + RADIUS <= c.x0 || x - RADIUS >= c.x1 || z + RADIUS <= c.z0 || z - RADIUS >= c.z1) continue;
    if (y >= c.y1 || y + h <= c.y0) continue;
    return c;
  }
  return null;
}

// Move one axis, with step-up: if a low lip blocks, try standing on it.
function moveAxis(world, actor, axis, amount) {
  if (amount === 0) return;
  if (axis === 'x') actor.x += amount;
  else if (axis === 'z') actor.z += amount;
  else actor.y += amount;
  const hit = overlaps(world, actor, actor.x, actor.y, actor.z);
  if (!hit) return;
  if (axis !== 'y' && actor.onGround && hit.y1 - actor.y <= STEP_UP && hit.y1 > actor.y) {
    const savedY = actor.y;
    actor.y = hit.y1;
    if (!overlaps(world, actor, actor.x, actor.y, actor.z)) return; // stepped up
    actor.y = savedY;
  }
  // Push back out along the axis of motion.
  if (axis === 'x') actor.x = amount > 0 ? hit.x0 - RADIUS - 0.001 : hit.x1 + RADIUS + 0.001;
  else if (axis === 'z') actor.z = amount > 0 ? hit.z0 - RADIUS - 0.001 : hit.z1 + RADIUS + 0.001;
  else if (amount < 0) {
    actor.y = hit.y1;
    actor.vy = 0;
    actor.onGround = true;
  } else {
    actor.y = hit.y0 - actorHeight(actor) - 0.001;
    actor.vy = Math.min(actor.vy, 0);
  }
}

// Integrate one actor for dt. wishX/wishZ is a unit wish direction in world
// space, wishSpeed the speed it wants, jump a one-step flag.
export function moveActor(world, actor, dt, wishX, wishZ, wishSpeed, jump) {
  const accel = actor.onGround ? 42 : 4.5;
  const friction = actor.onGround ? 9 : 0.12;
  // Friction first (ground), then accelerate toward the wish velocity.
  const f = Math.max(0, 1 - friction * dt);
  if (actor.onGround && wishSpeed === 0) {
    actor.vx *= f;
    actor.vz *= f;
  }
  const wishVx = wishX * wishSpeed;
  const wishVz = wishZ * wishSpeed;
  const dvx = wishVx - actor.vx;
  const dvz = wishVz - actor.vz;
  const dv = Math.hypot(dvx, dvz);
  const maxDv = accel * dt;
  if (dv > 0) {
    const scale = Math.min(1, maxDv / dv);
    actor.vx += dvx * scale;
    actor.vz += dvz * scale;
  }
  if (jump && actor.onGround) {
    actor.vy = 7.4;
    actor.onGround = false;
  }
  actor.vy -= GRAVITY * dt;
  if (actor.vy < -30) actor.vy = -30;

  const wasGround = actor.onGround;
  actor.onGround = false;
  moveAxis(world, actor, 'x', actor.vx * dt);
  moveAxis(world, actor, 'z', actor.vz * dt);
  moveAxis(world, actor, 'y', actor.vy * dt);
  if (!actor.onGround) {
    // Standing still on a floor or a crate top also counts as grounded.
    const support = world.groundHeightAt(actor.x, actor.z, actor.y + 0.01);
    if (actor.vy <= 0 && actor.y <= support + 0.02) {
      actor.y = support;
      actor.vy = 0;
      actor.onGround = true;
    }
  }
  if (!wasGround && actor.onGround) actor.justLanded = true;
  actor.groundSpeed = Math.hypot(actor.vx, actor.vz);
}

// ---------------------------------------------------------------------------
// The player: mouse look with recoil that kicks and recovers, footstep noise,
// and the noise the player's own movement makes for bots to hear.

export function createPlayerController(actor) {
  const recoil = { pitch: 0, yaw: 0 }; // view kick, recovers toward 0
  let stepAcc = 0;

  return {
    recoil,
    look(dx, dy) {
      const sens = actor.scoped ? 0.00075 : 0.0021;
      actor.yaw -= dx * sens;
      actor.pitch -= dy * sens;
      actor.pitch = clamp(actor.pitch, -1.45, 1.45);
    },
    kick(pitch, yaw) {
      recoil.pitch += pitch;
      recoil.yaw += yaw;
    },
    step(world, dt, input) {
      recoil.pitch += (0 - recoil.pitch) * Math.min(1, dt * 7);
      recoil.yaw += (0 - recoil.yaw) * Math.min(1, dt * 7);
      const keys = input.state.keys;
      let fwd = 0, strafe = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) fwd += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) fwd -= 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1;
      const walking = keys.has('ShiftLeft') || keys.has('ShiftRight');
      actor.crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
      const ws = currentWeapon(actor);
      const topSpeed = (ws ? ws.def.moveSpeed : 5.3) * (actor.crouch ? 0.48 : walking ? 0.55 : 1);
      const sin = Math.sin(actor.yaw), cos = Math.cos(actor.yaw);
      let wx = (-sin * fwd + cos * strafe);
      let wz = (-cos * fwd - sin * strafe);
      const len = Math.hypot(wx, wz);
      if (len > 0) { wx /= len; wz /= len; }
      const jump = keys.has('Space');
      moveActor(world, actor, dt, wx, wz, len > 0 ? topSpeed : 0, jump);
      // Footsteps: running is loud, walking quiet, crouching near silent.
      if (actor.onGround && actor.groundSpeed > 0.6) {
        stepAcc += dt * actor.groundSpeed;
        if (stepAcc > 2.6) {
          stepAcc = 0;
          const radius = actor.crouch ? 2 : walking ? 4.5 : 12;
          hearNoise(actor.x, actor.z, radius);
          if (S.hooks.onPlayerStep) S.hooks.onPlayerStep(actor.groundSpeed > 4 ? 0 : 14);
        }
      }
      actor.eyeY = actor.y + eyeHeight(actor);
    },
    viewPitch() {
      return actor.pitch + recoil.pitch;
    },
    viewYaw() {
      return actor.yaw + recoil.yaw;
    },
  };
}
