// The Saltline Works: an original dusk salt refinery. Two plant sites — the Kiln
// Yard (A) in the west and the Pump House (B) in the east — a canal down the
// middle crossed by two bridges, a loading dock in the south where the Jackals
// start and the Wardens' office yard in the north. This module builds the
// meshes, the collision boxes, the waypoint graph the bots walk, and the ray
// queries shooting and sight use. Geometry and collision come from the same
// helper, so what you see is exactly what blocks you.
import * as THREE from 'three';
import { PALETTE, mat } from './palette.js';

const BOUND = 32; // the yard wall, metres from the centre

function canvasTexture(size, draw, repeat = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function groundTexture() {
  return canvasTexture(512, (g, s) => {
    g.fillStyle = '#cfc8b4';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 5200; i += 1) {
      const v = 185 + Math.random() * 60;
      g.fillStyle = `rgba(${v},${v - 6},${v - 30},${0.25 + Math.random() * 0.4})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2.2, 2.2);
    }
    g.strokeStyle = 'rgba(120,110,88,0.35)';
    g.lineWidth = 3;
    for (let i = 0; i <= 4; i += 1) {
      g.beginPath(); g.moveTo((i * s) / 4, 0); g.lineTo((i * s) / 4, s); g.stroke();
      g.beginPath(); g.moveTo(0, (i * s) / 4); g.lineTo(s, (i * s) / 4); g.stroke();
    }
  }, 9);
}

function containerTexture(base, label) {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    for (let x = 8; x < s; x += 24) g.fillRect(x, 0, 9, s);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = 'bold 30px system-ui, sans-serif';
    g.fillText(label, 22, 52);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, s - 26, s, 26);
  });
}

function wallTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#878d94';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(40,44,50,0.5)';
    g.lineWidth = 2;
    for (let i = 0; i <= 2; i += 1) {
      g.beginPath(); g.moveTo((i * s) / 2, 0); g.lineTo((i * s) / 2, s); g.stroke();
      g.beginPath(); g.moveTo(0, (i * s) / 2); g.lineTo(s, (i * s) / 2); g.stroke();
    }
    for (let i = 0; i < 700; i += 1) {
      g.fillStyle = `rgba(60,58,50,${Math.random() * 0.16})`;
      g.fillRect(Math.random() * s, Math.random() * s, 3, 3);
    }
  }, 2);
}

export function createWorld(scene) {
  const colliders = [];
  const group = new THREE.Group();
  scene.add(group);

  const texGround = groundTexture();
  const texWall = wallTexture();
  const texContRust = containerTexture('#9c5518', 'SALTLINE');
  const texContTeal = containerTexture('#1d6a78', 'SALTLINE');

  function box(x, z, w, d, h, material, { y = 0, collide = true, castShadow = true } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: y, y1: y + h });
    return mesh;
  }
  function cylinder(x, z, r, h, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 18), material);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push({ x0: x - r * 0.92, x1: x + r * 0.92, z0: z - r * 0.92, z1: z + r * 0.92, y0: 0, y1: h });
    return mesh;
  }
  const wallMat = new THREE.MeshStandardMaterial({ map: texWall, roughness: 0.95 });
  const contRust = new THREE.MeshStandardMaterial({ map: texContRust, roughness: 0.8, metalness: 0.2 });
  const contTeal = new THREE.MeshStandardMaterial({ map: texContTeal, roughness: 0.8, metalness: 0.2 });

  // Ground and canal.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), new THREE.MeshStandardMaterial({ map: texGround, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  const waterMat = new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.25, metalness: 0.4 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(5, 56), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.14, 0);
  group.add(water);
  // Bridge decks over the canal (flat, walkable; the curbs are visual).
  box(0, 9, 6.4, 3.4, 0.18, mat(PALETTE.woodDark), { collide: false, castShadow: false });
  box(0, -11, 6.4, 3.4, 0.18, mat(PALETTE.woodDark), { collide: false, castShadow: false });
  // Silt gates across the canal: they break the spawn-to-spawn sightline, so a
  // round does not open with both teams already in each other's scopes.
  box(0, 14.8, 5.6, 0.6, 3.2, wallMat);
  box(0, -16, 5.6, 0.6, 3.2, wallMat);

  // The yard wall.
  box(0, -BOUND - 1, 2 * BOUND + 4, 2, 5.5, wallMat);
  box(0, BOUND + 1, 2 * BOUND + 4, 2, 5.5, wallMat);
  box(-BOUND - 1, 0, 2, 2 * BOUND + 4, 5.5, wallMat);
  box(BOUND + 1, 0, 2, 2 * BOUND + 4, 5.5, wallMat);

  // Solid blocks that carve the lanes: warehouse (SW), storehouse (NW), office (NE).
  box(-19, 19, 18, 14, 6, contRust); // warehouse
  box(-20, -20, 16, 12, 5.5, wallMat); // storehouse
  box(19, -19, 18, 14, 6, contTeal); // office block
  // Salt tanks (SE).
  cylinder(18, 21, 3.4, 6.5, mat(PALETTE.iron, 0.5, 0.5));
  cylinder(25.5, 17.5, 3.4, 6.5, mat(PALETTE.iron, 0.5, 0.5));

  // The kiln at A: tower, chimney and a low ring of evaporation-pan walls.
  cylinder(-28, -5, 3, 13, mat(PALETTE.rustDark, 0.85, 0.15));
  cylinder(-28, -5, 1.1, 17, mat(PALETTE.ironDark, 0.6, 0.4));
  box(-21.5, -11.5, 7, 0.5, 1.0, mat(PALETTE.saltDark));
  box(-25, -0.5, 0.5, 6, 1.0, mat(PALETTE.saltDark));
  box(-18.5, -8, 0.5, 7, 1.0, mat(PALETTE.saltDark));

  // The Pump House at B: a shell with two west doors and a south door, machinery inside.
  const ph = mat(PALETTE.tealDark, 0.85, 0.1);
  box(24, -4.5, 13, 0.6, 3.6, ph); // north wall
  box(30.2, 4, 0.6, 17.6, 3.6, ph); // east wall
  box(24, 12.5, 13, 0.6, 3.6, ph); // south wall
  box(17.8, -1.5, 0.6, 5.4, 3.6, ph); // west wall, north of the doors
  box(17.8, 9.8, 0.6, 4.8, 3.6, ph); // west wall, south of the doors
  box(21.5, 3.5, 4.5, 3, 1.7, mat(PALETTE.teal, 0.6, 0.3)); // pump block (cover)
  box(26.5, 7.5, 3.4, 2.4, 1.15, mat(PALETTE.iron, 0.55, 0.4)); // manifold (cover)
  cylinder(27.5, -1.5, 1.15, 4.6, mat(PALETTE.rust, 0.6, 0.3)); // riser pipe

  // Mid house, west of the canal: two rooms' worth of walls with door gaps.
  const mh = wallMat;
  box(-7, -8.5, 7, 0.55, 3.4, mh);
  box(-10.3, -3, 0.55, 11.5, 3.4, mh);
  box(-7, 2.8, 7, 0.55, 3.4, mh);
  box(-3.7, -6.4, 0.55, 4.6, 3.4, mh);
  box(-3.7, 0.8, 0.55, 4.4, 3.4, mh);
  box(-7, -2.8, 2.6, 2.2, 1.1, mat(PALETTE.iron, 0.55, 0.4)); // compressor (cover)

  // Containers and crates: tall lane blocks and crouch-height cover.
  const crate = mat(PALETTE.wood, 0.9);
  const crateDark = mat(PALETTE.woodDark, 0.9);
  const tall = [
    [-24, 8, 4.6, 2.2, contRust], [13, 10.5, 4.6, 2.2, contTeal],
    [-12, -14.5, 4.6, 2.2, contTeal], [12.5, -15.5, 4.6, 2.2, contRust],
    [6.5, 20, 2.2, 4.6, contTeal], [-6.5, -21, 2.2, 4.6, contRust],
    [8.5, -6, 2.2, 4.6, contTeal],
  ];
  for (const [x, z, w, d, m] of tall) box(x, z, w, d, 2.6, m);
  const cover = [
    // site A
    [-20.5, -1.2, 2.2], [-26.5, -9.5, 2.0], [-19.5, -6.5, 1.7],
    // site B and its yard
    [21, 0.5, 2.0], [24.5, 8.5, 2.2], [15.5, 5.5, 1.8], [20.5, 14.5, 2.0],
    // mid and bridges
    [-4.5, 9, 1.8], [4.5, -11, 1.8], [-6, -12.8, 2.0], [6, 3.5, 1.8],
    // lanes
    [-16.5, 3.5, 2.0], [16, -8, 2.0], [-9, 15.5, 1.8], [10.5, 16.5, 1.8],
    // spawns
    [-4, 25.5, 2.0], [4.5, -25.5, 2.0], [-13, -24, 1.8], [13.5, 24.5, 1.8],
  ];
  cover.forEach(([x, z, w], i) => box(x, z, w, w * 0.8, 1.06, i % 2 ? crate : crateDark));
  // Salt piles: bright cones, visual landmarks that also block.
  for (const [x, z, r] of [[-14, -6, 2.6], [9, -18, 2.4], [-24, 12, 2.8], [14, 21, 2.2]]) {
    const pile = new THREE.Mesh(new THREE.ConeGeometry(r, r * 0.62, 14), mat(PALETTE.salt, 1));
    pile.position.set(x, r * 0.31, z);
    pile.castShadow = true;
    pile.receiveShadow = true;
    group.add(pile);
    colliders.push({ x0: x - r * 0.8, x1: x + r * 0.8, z0: z - r * 0.8, z1: z + r * 0.8, y0: 0, y1: r * 0.62 });
  }
  // Lamp poles: thin, no collision worth modelling, with emissive heads.
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  for (const [x, z] of [[-23, -4], [23, 4], [0, 0], [-8, 22], [8, -22]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 5.6, 6), mat(PALETTE.ironDark, 0.6, 0.4));
    pole.position.set(x + 1.6, 2.8, z + 1.6);
    group.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), lampMat);
    lamp.position.set(x + 1.6, 5.7, z + 1.6);
    group.add(lamp);
  }
  // Distant refinery silhouettes beyond the wall, for the skyline.
  for (const [x, z, w, h] of [[-44, -20, 14, 16], [40, -30, 18, 12], [-40, 26, 16, 10], [46, 18, 12, 20], [0, -48, 30, 14]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 8), mat(PALETTE.concreteDark, 1));
    m.position.set(x, h / 2, z);
    group.add(m);
  }

  // Site decals: a painted ring and letter on the ground at each site.
  function siteDecal(x, z, color, letter) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(5.6, 6.4, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.03, z);
    group.add(ring);
    const tex = canvasTexture(128, (g, s) => {
      g.clearRect(0, 0, s, s);
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.font = `bold ${s * 0.72}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(letter, s / 2, s / 2 + 4);
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.8 }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x, 0.04, z);
    group.add(disc);
  }
  const sites = {
    A: { x: -23, z: -4, r: 6.5, name: 'Kiln Yard' },
    B: { x: 23, z: 4, r: 6.5, name: 'Pump House' },
  };
  siteDecal(sites.A.x, sites.A.z, PALETTE.siteA, 'A');
  siteDecal(sites.B.x, sites.B.z, PALETTE.siteB, 'B');

  const spawns = {
    atk: [[0, 28.5], [-3.5, 29.5], [3.5, 29.5], [-7, 27.5], [7, 27.5]],
    def: [[0, -28.5], [3.5, -29.5], [-3.5, -29.5], [7, -27.5], [-7, -27.5]],
  };

  // Waypoints: the graph bots walk. Tags mark spawns, sites and the positions a
  // defender holds. Edges join nodes with a clear walk between them.
  const N = (x, z, tags = []) => ({ x, z, tags });
  const waypoints = [
    N(0, 28.5, ['spawn', 'atk']), N(-7.5, 23), N(10, 23), N(0, 17.5), N(-4, 24),
    N(-17, 10.5), N(-19, 7), N(-14, -1), N(-23.5, -3.5, ['siteA']), N(-24.5, -10.5, ['holdA']),
    N(-13, -12.5), N(0, 9), N(0, -1), N(0, -11), N(-1.8, -2.8, ['mid']),
    N(7, -3), N(19, 9.5), N(22.5, 8.5, ['siteB']), N(26, -3.5, ['holdB']), N(13, -10.5),
    N(16, 15.5), N(0, -19), N(-9, -23.5), N(9, -23.5), N(0, -28.5, ['spawn', 'def']),
    N(11, 19), N(-19, -12.8, ['holdA']), N(19.5, -1, ['holdB']), N(-16.8, -3.2, ['holdA']),
    N(21.5, 10.5, ['holdB']), N(4.5, 13), N(-4.5, -16.5), N(11, 4), N(-11, 5.5),
    N(-7, 10.5), N(17.8, 4.3), N(-16.5, -11.8),
  ];
  // A walk segment is clear when it misses every solid footprint (low cover
  // included: nobody paths through a crate) padded by a body radius.
  function walkClear(ax, az, bx, bz) {
    for (const c of colliders) {
      if (c.y1 < 0.6) continue;
      const x0 = c.x0 - 0.38, x1 = c.x1 + 0.38, z0 = c.z0 - 0.38, z1 = c.z1 + 0.38;
      if (segmentHitsBox(ax, az, bx, bz, x0, x1, z0, z1)) return false;
    }
    return true;
  }
  function segmentHitsBox(ax, az, bx, bz, x0, x1, z0, z1) {
    // Slab test in 2D.
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dz = bz - az;
    if (Math.abs(dx) < 1e-9) { if (ax < x0 || ax > x1) return false; }
    else {
      let ta = (x0 - ax) / dx, tb = (x1 - ax) / dx;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
    if (Math.abs(dz) < 1e-9) { if (az < z0 || az > z1) return false; }
    else {
      let ta = (z0 - az) / dz, tb = (z1 - az) / dz;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
    return true;
  }
  const edges = waypoints.map(() => []);
  for (let i = 0; i < waypoints.length; i += 1) {
    for (let j = i + 1; j < waypoints.length; j += 1) {
      const a = waypoints[i], b = waypoints[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d <= 16 && walkClear(a.x, a.z, b.x, b.z)) {
        edges[i].push(j);
        edges[j].push(i);
      }
    }
  }
  function nearestNode(x, z) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < waypoints.length; i += 1) {
      const d = Math.hypot(waypoints[i].x - x, waypoints[i].z - z);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  // Breadth-first hops between two positions, returned as a list of points.
  function findPath(x0, z0, x1, z1) {
    const start = nearestNode(x0, z0);
    const goal = nearestNode(x1, z1);
    if (start === goal) return [{ x: x1, z: z1 }];
    const prev = new Array(waypoints.length).fill(-1);
    const queue = [start];
    prev[start] = start;
    while (queue.length) {
      const cur = queue.shift();
      if (cur === goal) break;
      for (const next of edges[cur]) {
        if (prev[next] === -1) { prev[next] = cur; queue.push(next); }
      }
    }
    if (prev[goal] === -1) return [{ x: x1, z: z1 }];
    const path = [];
    let cur = goal;
    while (cur !== start) {
      path.push({ x: waypoints[cur].x, z: waypoints[cur].z });
      cur = prev[cur];
    }
    path.reverse();
    path.push({ x: x1, z: z1 });
    return path;
  }

  // 3D ray against every collider plus the ground plane; the nearest hit wins.
  const hitOut = { dist: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, hit: false };
  function rayHit(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist;
    let nx = 0, ny = 0, nz = 0, found = false;
    if (dy < -1e-9) {
      const t = -oy / dy;
      if (t > 0 && t < best) { best = t; nx = 0; ny = 1; nz = 0; found = true; }
    }
    for (const c of colliders) {
      let tmin = 0, tmax = best;
      let axis = -1, sign = 0;
      // X slab
      if (Math.abs(dx) < 1e-9) { if (ox < c.x0 || ox > c.x1) continue; }
      else {
        let ta = (c.x0 - ox) / dx, tb = (c.x1 - ox) / dx, s = -1;
        if (ta > tb) { [ta, tb] = [tb, ta]; s = 1; }
        if (ta > tmin) { tmin = ta; axis = 0; sign = s; }
        tmax = Math.min(tmax, tb);
        if (tmin > tmax) continue;
      }
      // Y slab
      if (Math.abs(dy) < 1e-9) { if (oy < c.y0 || oy > c.y1) continue; }
      else {
        let ta = (c.y0 - oy) / dy, tb = (c.y1 - oy) / dy, s = -1;
        if (ta > tb) { [ta, tb] = [tb, ta]; s = 1; }
        if (ta > tmin) { tmin = ta; axis = 1; sign = s; }
        tmax = Math.min(tmax, tb);
        if (tmin > tmax) continue;
      }
      // Z slab
      if (Math.abs(dz) < 1e-9) { if (oz < c.z0 || oz > c.z1) continue; }
      else {
        let ta = (c.z0 - oz) / dz, tb = (c.z1 - oz) / dz, s = -1;
        if (ta > tb) { [ta, tb] = [tb, ta]; s = 1; }
        if (ta > tmin) { tmin = ta; axis = 2; sign = s; }
        tmax = Math.min(tmax, tb);
        if (tmin > tmax) continue;
      }
      if (axis >= 0 && tmin > 0 && tmin < best) {
        best = tmin; found = true;
        nx = axis === 0 ? sign : 0;
        ny = axis === 1 ? sign : 0;
        nz = axis === 2 ? sign : 0;
      }
    }
    hitOut.dist = best;
    hitOut.x = ox + dx * best;
    hitOut.y = oy + dy * best;
    hitOut.z = oz + dz * best;
    hitOut.nx = nx; hitOut.ny = ny; hitOut.nz = nz;
    hitOut.hit = found;
    return hitOut;
  }

  // Is the straight sight line between two points blocked by the world?
  function losBlocked(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.001) return false;
    const hit = rayHit(ax, ay, az, dx / d, dy / d, dz / d, d - 0.15);
    return hit.hit;
  }

  // The height of the highest solid top under a point that a body standing at
  // feetY could step or land on; 0 is the yard floor.
  function groundHeightAt(x, z, feetY) {
    let top = 0;
    for (const c of colliders) {
      if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1 && c.y1 <= feetY + 0.56 && c.y1 > top) top = c.y1;
    }
    return top;
  }

  let waterPhase = 0;
  return {
    colliders,
    waypoints,
    edges,
    sites,
    spawns,
    rayHit,
    losBlocked,
    groundHeightAt,
    findPath,
    update(dt) {
      waterPhase += dt * 0.05;
      waterMat.color.setHSL(0.54, 0.42, 0.3 + Math.sin(waterPhase * 6) * 0.02);
    },
  };
}
