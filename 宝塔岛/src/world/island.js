// The floating island: layered terrain, a terrace for the pagoda, a spring that runs down in small
// cascades under a bridge and falls off the edge, a stone path with steps, a torii and stone lanterns.
import { Grid, hash3 } from '../voxel.js';
import { fbm, rng } from './noise.js';

export const PAGODA = { x: 0, z: -3, y: 7 };     // pagoda centre and terrace height
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// the stream: a polyline with the water level along it
const STREAM = [[17, -12, 5], [16.5, -6, 5], [16, -1, 5], [15.5, 3, 4], [15, 8, 4], [12.5, 13, 2], [6, 16, 2], [0, 16.5, 2], [-7, 18, 2], [-14, 20.5, 2], [-20, 23, 2], [-27, 26, 2]];

function streamInfo(x, z) {
  // distance to the polyline, and the water level at the nearest point
  let best = 1e9, lvl = 0, t = 0;
  for (let i = 0; i < STREAM.length - 1; i++) {
    const [ax, az, al] = STREAM[i], [bx, bz, bl] = STREAM[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const u = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
    const d = Math.hypot(x - ax - dx * u, z - az - dz * u);
    // levels change in steps: keep the upstream level until the last 30% of the segment
    const l = u < 0.7 ? al : bl;
    if (d < best) { best = d; lvl = l; t = i + u; }
  }
  return { d: best, lvl, t };
}

export function buildIsland(P) {
  const G = new Grid([-46, -62, -46], [46, 84, 46]);
  const C = (n) => P.get(n);
  const R0 = 33;
  const edge = (th) => R0 + 2.6 * Math.sin(3 * th + 0.7) + 1.8 * Math.sin(5 * th + 2.1) + 1.1 * Math.sin(9 * th + 0.4);
  const top = new Map();       // "x,z" -> top y
  const kind = new Map();      // "x,z" -> what the surface is (grass, path, terrace, water...)
  const key = (x, z) => x + ',' + z;
  const isPath = (x, z) => (Math.abs(x) <= 1 && z >= 10 && z <= 31);
  const onTerrace = (x, z) => Math.abs(x - PAGODA.x) <= 12 && Math.abs(z - PAGODA.z) <= 12;

  // ---- heights
  for (let x = -45; x <= 45; x++) for (let z = -45; z <= 45; z++) {
    const r = Math.hypot(x, z), th = Math.atan2(z, x), R = edge(th);
    if (r > R + 0.5) continue;
    let h = 3 - 1.6 * ss(0.72, 1.0, r / R);
    // the pine hill at the back left
    const dh = Math.hypot(x + 17, z + 16);
    h = Math.max(h, 3 + 10.5 * Math.pow(Math.max(0, 1 - dh / 13), 1.35));
    // a plateau for the spring at the back right
    const dp = Math.hypot(x - 17, z + 12);
    h = Math.max(h, 3 + 3 * clamp((11.5 - dp) / 3, 0, 1));
    h += (fbm(x * 0.13, z * 0.13, 3, 5) - 0.5) * 2.6;
    let k = 'grass';
    if (onTerrace(x, z)) { h = PAGODA.y; k = 'terrace'; }
    if (isPath(x, z)) {
      h = 3; k = 'path';
      if (z === 10) h = 6; if (z === 11) h = 5; if (z === 12) h = 4;
      if (z >= 10 && z <= 12) k = 'step';
    }
    // the spring and its stream
    const s = streamInfo(x, z), pond = Math.hypot(x - 17, z + 12);
    let water = 0;
    if (pond < 4.6) { water = 5; }
    else if (s.d < 2.3 && s.t > 0.3) water = s.lvl;
    if (water) { h = water - 2; k = 'water'; }
    else if (s.d < 3.4 && s.t > 0.3 && !onTerrace(x, z)) { h = Math.min(Math.round(h), s.lvl + 1); }
    h = Math.round(h);
    top.set(key(x, z), h); kind.set(key(x, z), water ? 'water:' + water : k);

    // ---- the column: grass, soil, then banded rock down to a jagged point
    const rr = r / R;
    const depth = 5 + 36 * Math.pow(Math.max(0, 1 - rr), 0.75) + (fbm(x * 0.2, z * 0.2, 3, 9) - 0.5) * 9 + (hash3(x, 7, z) > 0.985 ? 6 : 0);
    const bottom = Math.round(-depth);
    const soilD = 2 + Math.round(fbm(x * 0.3, z * 0.3, 2, 3) * 3);
    for (let y = bottom; y <= h; y++) {
      const d = h - y;
      let c;
      if (d === 0 && k === 'grass') {
        const n = fbm(x * 0.18, z * 0.18, 2, 11) + (hash3(x, 1, z) - 0.5) * 0.25;
        c = n < 0.38 ? 'grass2' : n < 0.55 ? 'grass1' : n < 0.68 ? 'grass3' : 'grass4';
        if (h >= 9) c = hash3(x, 2, z) < 0.5 ? 'moss' : 'grass2';
      } else if (d <= soilD && y > bottom + 2) c = d === 1 && k === 'grass' && hash3(x, y, z) < 0.4 ? 'grass2' : ['soil1', 'soil2', 'soil3'][Math.floor(hash3(x, y, z) * 3)];
      else {
        const band = Math.floor((y + Math.round(fbm(x * 0.1, z * 0.1, 2, 2) * 4)) / 3) % 4;
        c = ['rock1', 'rock2', 'rock3', 'rock2'][(band + 4) % 4];
        if (y < bottom + 3) c = y === bottom ? 'rock5' : 'rock4';
      }
      G.set(x, y, z, C(c));
    }
    // dangling roots and vines under the rim
    if (rr > 0.8 && hash3(x, 3, z) < 0.04) {
      const len = 2 + Math.floor(hash3(x, 4, z) * 6), vine = hash3(x, 5, z) < 0.5;
      for (let i = 1; i <= len; i++) G.put(x, bottom - i + Math.round(depth * 0.15 * 0), z, C(vine ? 'vine' : 'root'));
    }
  }
  const topY = (x, z) => top.get(key(Math.round(x), Math.round(z))) ?? -99;

  // ---- surfaces: stone path with mossy joints, steps, terrace paving, water
  for (const [k, v] of kind) {
    const [x, z] = k.split(',').map(Number), h = top.get(k);
    if (v === 'path') {
      // big slabs in a running bond, with moss creeping into the joints
      const row = Math.floor((z + 31) / 2), off = row % 2;
      const joint = (z % 2 === 0) || ((x + off + 3) % 3 === 0 && hash3(x, 9, z) < 0.5);
      G.set(x, h, z, C(joint ? (hash3(x, 8, z) < 0.55 ? 'moss' : 'slab2') : ['slab1', 'slab3', 'slab2'][row % 3]));
    } else if (v === 'step') {
      for (let y = 3; y <= h; y++) G.set(x, y, z, C(y === h ? 'slab3' : 'wall2'));
    } else if (v === 'terrace') {
      // retaining wall on the edge, gravel courtyard inside
      const ex = Math.abs(x - PAGODA.x) === 12 || Math.abs(z - PAGODA.z) === 12;
      if (ex) for (let y = 1; y <= h; y++) G.set(x, y, z, C(((y + (x + z) * 0) % 2 === 0) !== ((x + z) % 3 === 0) ? 'wall1' : 'wall2'));
      else G.set(x, h, z, C(((x + z) & 1) ? 'slab2' : 'slab1'));
    } else if (v.startsWith('water')) {
      const lvl = Number(v.split(':')[1]);
      G.set(x, h, z, C('rock2'));
      for (let y = h + 1; y <= lvl; y++) G.set(x, y, z, C('water'));
    }
  }
  // foam where the stream steps down
  for (const [k, v] of kind) {
    if (!v.startsWith('water')) continue;
    const [x, z] = k.split(',').map(Number), lvl = Number(v.split(':')[1]);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = kind.get(key(x + dx, z + dz));
      if (n && n.startsWith('water') && Number(n.split(':')[1]) < lvl) { G.set(x, lvl, z, C('foam')); for (let y = Number(n.split(':')[1]) + 1; y <= lvl; y++) G.set(x + dx, y, z + dz, C('foam')); }
    }
  }

  // ---- the waterfall: water pours over the rim and falls into the sky below
  const fall = { x: -28, z: 27 };
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    for (let y = -58; y <= 2; y++) {
      const x = fall.x + dx, z = fall.z + dz;
      if (!G.get(x, y, z)) G.set(x, y, z, C(y > -2 && hash3(x, y, z) < 0.5 ? 'foam' : 'water'));
    }
  }
  // the lip of the fall
  for (let s = 0; s < 6; s++) { const x = Math.round(-24 - s * 0.7), z = Math.round(24.5 + s * 0.45); for (let dx = -1; dx <= 1; dx++) { if (!G.get(x + dx, 2, z)) G.set(x + dx, 2, z, C('water')); if (G.get(x + dx, 1, z) === 0) G.set(x + dx, 1, z, C('rock2')); } }

  // ---- the arched bridge where the path crosses the stream
  for (let z = 12; z <= 21; z++) {
    const u = (z - 12) / 9, y = 3 + Math.round(Math.sin(Math.PI * u) * 2.6);
    for (let x = -2; x <= 2; x++) {
      G.set(x, y, z, C(Math.abs(x) === 2 ? 'vermilionDk' : (z % 2 ? 'wood' : 'woodDk')));
      for (let yy = y - 1; yy >= 3 && Math.abs(x) <= 1; yy--) if (!G.get(x, yy, z) || P.list[G.get(x, yy, z)].mat === 'water') { /* keep the arch open */ }
    }
    // railings with posts
    for (const x of [-2, 2]) {
      G.set(x, y + 1, z, C(z % 3 === 0 ? 'vermilion' : 'vermilionDk'));
      if (z % 3 === 0) { G.set(x, y + 2, z, C('vermilion')); if (z === 12 || z === 21) G.set(x, y + 3, z, C('gold')); }
      else G.set(x, y + 2, z, C('vermilion'));
    }
    // the supports under the arch ends
    if (z <= 13 || z >= 20) for (let yy = 0; yy < y; yy++) for (const x of [-2, 2]) G.set(x, yy, z, C('woodDk'));
  }

  // ---- torii at the head of the path
  const tz = 27, ty = topY(0, tz);
  for (const x of [-4, 4]) { for (let y = ty + 1; y <= ty + 10; y++) G.set(x, y, tz, C('vermilion')); G.set(x, ty + 1, tz, C('woodDk')); }
  for (let x = -6; x <= 6; x++) { G.set(x, ty + 11, tz, C('vermilion')); G.set(x, ty + 12, tz, C('lanternCap')); }
  for (const x of [-7, 7]) G.set(x, ty + 13, tz, C('lanternCap'));
  for (const x of [-6, 6]) G.set(x, ty + 13, tz, C('lanternCap'));
  for (let x = -5; x <= 5; x++) G.set(x, ty + 8, tz, C('vermilion'));
  G.set(0, ty + 9, tz, C('lanternCap')); G.set(0, ty + 10, tz, C('gold'));

  // ---- stone lanterns (tōrō)
  const lanterns = [];
  const toro = (x, z) => {
    const y = topY(x, z);
    G.box(x - 1, y + 1, z - 1, x + 1, y + 1, z + 1, C('lampStone'));
    G.box(x, y + 2, z, x, y + 4, z, C('lampStone'));
    G.box(x - 1, y + 5, z - 1, x + 1, y + 5, z + 1, C('lampStone'));
    G.box(x - 1, y + 6, z - 1, x + 1, y + 6, z + 1, C('lampGlow'));
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) G.set(x + cx, y + 6, z + cz, C('lampStone'));
    G.box(x - 2, y + 7, z - 2, x + 2, y + 7, z + 2, C('lampStone'));
    for (const [cx, cz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) G.set(x + cx, y + 8, z + cz, C('lampStone'));
    G.box(x - 1, y + 8, z - 1, x + 1, y + 8, z + 1, C('lampStone'));
    G.set(x, y + 9, z, C('lampStone'));
    lanterns.push([x + 0.5, y + 6.5, z + 0.5]);
  };
  toro(-4, 14); toro(4, 14); toro(-4, 23); toro(4, 23); toro(-9, 7); toro(9, 7);

  // ---- boulders: around the pond, on the hill, on the rim
  const rand = rng(77);
  const boulder = (x, z, r) => { const y = topY(x, z); G.sphere(x, y + Math.round(r * 0.3), z, r, () => (rand() < 0.5 ? C('boulder') : C('boulder2')), true, 0.8); };
  for (let a = 0; a < 7; a++) { const t = a / 7 * Math.PI * 2 + 0.3; boulder(Math.round(17 + Math.cos(t) * 5.6), Math.round(-12 + Math.sin(t) * 5.6), 1.2 + rand() * 0.9); }
  boulder(-12, -20, 2.4); boulder(-23, -9, 2.0); boulder(-20, -22, 1.6); boulder(22, 9, 1.8); boulder(-27, 12, 2.2); boulder(26, -3, 1.6); boulder(8, 27, 1.5);

  // ---- grass tufts and small flowers
  for (const [k, v] of kind) {
    if (v !== 'grass') continue;
    const [x, z] = k.split(',').map(Number), h = top.get(k);
    if (G.get(x, h + 1, z)) continue;
    const r = hash3(x, 21, z);
    if (r < 0.035) G.set(x, h + 1, z, C(['flowerW', 'flowerY', 'flowerP', 'flowerK'][Math.floor(hash3(x, 22, z) * 4)]));
    else if (r < 0.11) { G.set(x, h + 1, z, C(r < 0.07 ? 'tuft' : 'tuft2')); if (hash3(x, 23, z) < 0.3) G.set(x, h + 2, z, C('tuft2')); }
  }
  return { grid: G, topY, kind, lanterns, fall, stream: STREAM };
}
