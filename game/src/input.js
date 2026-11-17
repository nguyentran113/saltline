// Keyboard and mouse, with pointer lock. Held keys live in state.keys; keys that
// must fire once (buy menu, weapon slots, reload) go to state.justPressed, which
// main.js drains once per frame. Mouse look accumulates into a buffer the player
// consumes, so look speed never depends on event rate.
export function createInput(domElement, onLockChange) {
  const state = {
    keys: new Set(),
    justPressed: new Set(),
    firing: false,
    aiming: false, // right mouse held: the marksman's scope
    locked: false,
    wheel: 0, // accumulated wheel delta since last drain
  };
  let lookX = 0;
  let lookY = 0;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') e.preventDefault();
    if (!e.repeat) state.justPressed.add(e.code);
    state.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => state.keys.delete(e.code));
  window.addEventListener('blur', () => {
    state.keys.clear();
    state.firing = false;
    state.aiming = false;
  });

  domElement.addEventListener('mousedown', (e) => {
    if (!state.locked) return;
    if (e.button === 0) state.firing = true;
    if (e.button === 2) state.aiming = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.firing = false;
    if (e.button === 2) state.aiming = false;
  });
  domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('wheel', (e) => {
    if (state.locked) state.wheel += Math.sign(e.deltaY);
  }, { passive: true });

  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === domElement;
    if (!state.locked) {
      state.firing = false;
      state.aiming = false;
    }
    onLockChange(state.locked);
  });
  document.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    lookX += e.movementX || 0;
    lookY += e.movementY || 0;
  });

  return {
    state,
    requestLock() {
      domElement.requestPointerLock();
    },
    takeLook() {
      const out = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return out;
    },
    drainPressed() {
      const out = [...state.justPressed];
      state.justPressed.clear();
      return out;
    },
    drainWheel() {
      const w = state.wheel;
      state.wheel = 0;
      return w;
    },
  };
}
