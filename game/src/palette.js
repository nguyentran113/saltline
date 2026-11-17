// SALTLINE's look in one place: a dusk salt refinery — pale salt crust, rusted iron,
// teal machinery paint and the two team colours. Every material in the game is
// built from these values so the scene reads as one chosen palette.
export const PALETTE = {
  sky: 0x2e3d4d, // dusk blue-grey over the yard
  fog: 0x3a4a58,
  sun: 0xffd9a0,
  hemiSky: 0x8fb4c7,
  hemiGround: 0x5c5148,
  salt: 0xd8d2c4, // ground crust
  saltDark: 0xb9b09c,
  concrete: 0x8d9299,
  concreteDark: 0x646a71,
  iron: 0x707880,
  ironDark: 0x454b52,
  rust: 0xa85f32,
  rustDark: 0x7c4222,
  teal: 0x2e7f86, // machinery paint, Warden colour
  tealDark: 0x1d565c,
  wood: 0x9a7a52,
  woodDark: 0x6f5638,
  water: 0x2c5d6e,
  atk: 0xd97c2e, // Jackals: rust orange
  atkDark: 0x9c5518,
  def: 0x2e9db0, // Wardens: teal blue
  defDark: 0x1d6a78,
  skin: 0xc9a186,
  dark: 0x23272c,
  bomb: 0xd8402e,
  siteA: 0xe8b13c,
  siteB: 0x4cc2d4,
  tracerAtk: 0xffc37a,
  tracerDef: 0x9ae6ff,
  flash: 0xfff3c4,
};

// Shared materials, built once: the game never allocates a material per mesh.
import * as THREE from 'three';

const cache = new Map();
export function mat(color, roughness = 0.9, metalness = 0.0) {
  const key = `${color}|${roughness}|${metalness}`;
  let found = cache.get(key);
  if (!found) {
    found = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    cache.set(key, found);
  }
  return found;
}
