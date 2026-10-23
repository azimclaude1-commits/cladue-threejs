// Layout of the diorama in block-local coordinates: origin at the centre of the block's base,
// y up, the block spans x, z in [-HALF, HALF]. The camera looks in at the (+x, +z) corner.
import { clamp, smoothstep, mulberry32 } from './math.js';

export const HALF = 2.6;
export const WATER = 1.55; // still-water level
export const STRATA = { choc: 0.28, caramel: 0.47, shell: 0.55 };

// ---- value noise (2D / 3D) ------------------------------------------------------
function hash2(i, j) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function hash3(i, j, k) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * (3 - 2 * t);
export function noise2(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = fade(x - i), fy = fade(y - j);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export function noise3(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = fade(x - i), fy = fade(y - j), fz = fade(z - k);
  const L = (a, b, t) => a + (b - a) * t;
  return L(
    L(L(hash3(i, j, k), hash3(i + 1, j, k), fx), L(hash3(i, j + 1, k), hash3(i + 1, j + 1, k), fx), fy),
    L(L(hash3(i, j, k + 1), hash3(i + 1, j, k + 1), fx), L(hash3(i, j + 1, k + 1), hash3(i + 1, j + 1, k + 1), fx), fy),
    fz
  );
}
export function fbm2(x, y, o = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < o; i++) { s += a * noise2(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

// ---- island ------------------------------------------------------------------------
export const ISLAND = { cx: -0.4, cz: -1.15, ax: 1.75, az: 0.92 };
export const COVE = { x: 0.42, z: -0.22, r: 0.6 };

/** 0 at the island's middle, ~1 at the shoreline (with a cove bitten out of the front). */
export function islandE(x, z) {
  const dx = (x - ISLAND.cx) / ISLAND.ax, dz = (z - ISLAND.cz) / ISLAND.az;
  let e = Math.hypot(dx, dz);
  const ang = Math.atan2(dz, dx);
  e *= 1 + 0.07 * Math.sin(ang * 3 + 1.1) + 0.05 * Math.sin(ang * 5 + 0.3) + (fbm2(x * 1.6 + 3, z * 1.6) - 0.5) * 0.18;
  // the cove: a round bay facing the viewer
  const c = Math.hypot(x - COVE.x, z - COVE.z) / COVE.r;
  if (c < 1.3) e = Math.max(e, smoothstep(1.3, 0.35, c) * 1.25);
  return e;
}

export function seaFloor(x, z) {
  const n = fbm2(x * 0.9 + 11, z * 0.9 - 4);
  // deeper toward the front, shallower toward the island
  const front = smoothstep(-2.6, 2.6, (x + z) * 0.6);
  return 0.86 + (n - 0.5) * 0.12 - front * 0.12 + 0.04 * Math.sin(x * 2.3) * Math.sin(z * 1.9);
}

/** Terrain height (sea floor + island), without the skull. */
export function groundHeight(x, z) {
  const floor = seaFloor(x, z);
  const e = islandE(x, z);
  // beach shelf rising out of the water
  const beach = WATER + 0.07 + (fbm2(x * 3, z * 3) - 0.5) * 0.03;
  let h = floor + (beach - floor) * smoothstep(1.22, 0.9, e);
  // jungle hump toward the back of the island
  const hx = (x - (ISLAND.cx - 0.25)) / 1.05, hz = (z - (ISLAND.cz - 0.42)) / 0.5;
  const he = Math.hypot(hx, hz) * (1 + (fbm2(x * 2.2, z * 2.2 + 7) - 0.5) * 0.35);
  h += 0.5 * smoothstep(1.0, 0.15, he) + 0.06 * smoothstep(1.0, 0.4, he) * (fbm2(x * 5, z * 5) - 0.5);
  // keep a margin from the walls so the island never touches them
  const edge = Math.max(Math.abs(x), Math.abs(z));
  if (edge > HALF - 0.25) h = Math.min(h, floor + (h - floor) * smoothstep(HALF - 0.02, HALF - 0.25, edge));
  return h;
}

// ---- skull rock ---------------------------------------------------------------------
export const SKULL = { x: -2.0, z: -0.62, y: 0.0, scale: 0.7, yaw: 0.55 }; // faces roughly toward the viewer

const smin = (a, b, k) => { const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h); };
const smaxs = (a, b, k) => -smin(-a, -b, k);
const sdEll = (x, y, z, rx, ry, rz) => {
  const k0 = Math.hypot(x / rx, y / ry, z / rz), k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 < 1e-6 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
};
const sdSph = (x, y, z, r) => Math.hypot(x, y, z) - r;
const sdRBox = (x, y, z, bx, by, bz, r) => {
  const qx = Math.abs(x) - bx, qy = Math.abs(y) - by, qz = Math.abs(z) - bz;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
};
function sdHeart2(x, y) {
  // classic heart, point down, ~unit size
  x = Math.abs(x);
  if (x + y > 1) return Math.hypot(x - 0.25, y - 0.75) - Math.SQRT2 / 4;
  const a = (x, y) => x * x + y * y;
  const m = 0.5 * Math.max(x + y, 0);
  return Math.sqrt(Math.min(a(x, y - 1), a(x - m, y - m))) * Math.sign(x - y);
}
// grin: a smiling curve in the face plane
export const GRIN_Y = (x) => 0.16 + 0.55 * x * x;

/** Skull SDF in skull-local units (about 1 tall, facing +z, base at y = -0.25). */
export function skullLocal(x, y, z) {
  let d = sdEll(x, y - 0.66, z + 0.02, 0.5, 0.46, 0.48); // cranium
  d = smin(d, sdEll(x, y - 0.33, z - 0.1, 0.43, 0.33, 0.4), 0.12); // face
  d = smin(d, sdSph(Math.abs(x) - 0.28, y - 0.34, z - 0.27, 0.13), 0.08); // cheekbones
  // jaw, slightly tapered
  const jw = 0.3 - 0.08 * clamp((0.15 - y) / 0.3, 0, 1);
  d = smin(d, sdRBox(x, y - 0.06, z - 0.12, jw, 0.12, 0.28, 0.07), 0.1);
  // rock pedestal flaring into the sea
  const ped = sdEll(x, y + 0.22, z - 0.02, 0.62 + 0.05 * Math.sin(z * 6), 0.32, 0.6);
  d = smin(d, ped, 0.18);
  // rock column down to the sea floor
  d = smin(d, sdEll(x, y + 0.85, z, 0.62 + 0.06 * Math.sin(y * 9), 0.7, 0.6 + 0.05 * Math.cos(y * 7)), 0.2);
  // eye sockets (deep)
  for (const s of [-1, 1]) {
    d = smaxs(d, -sdEll(x - s * 0.18, y - 0.47, z - 0.47, 0.135, 0.13, 0.3), 0.025);
  }
  // heart-shaped nose
  if (z > 0.2) {
    const h2 = sdHeart2((x / 0.085), (0.34 - y) / 0.085 + 0.05) * 0.085;
    const nose = Math.max(h2, Math.abs(z - 0.48) - 0.12);
    d = smaxs(d, -nose, 0.015);
  }
  // carved grin
  {
    const gy = GRIN_Y(x);
    const groove = Math.max(Math.abs(y - gy) - 0.055, Math.abs(x) - 0.26, 0.28 - z);
    d = smaxs(d, -groove, 0.02);
  }
  // crack on the crown: a zigzag groove running front to back
  if (y > 0.8) {
    const t = clamp((z + 0.4) / 0.8, 0, 1);
    const cx = 0.12 + 0.06 * Math.sin(t * 15) * (0.4 + t);
    const groove = Math.abs(x - cx) - (0.01 + 0.008 * t);
    d = smaxs(d, -Math.max(groove, Math.abs(z) - 0.42), 0.01);
  }
  // rock strata + noise
  d += 0.0035 * Math.sin(y * 42 + noise3(x * 3, y * 3, z * 3) * 4) + (noise3(x * 7, y * 7, z * 7) - 0.5) * 0.018;
  return d;
}

export function skullToLocal(x, y, z) {
  const s = SKULL.scale, c = Math.cos(SKULL.yaw), sn = Math.sin(SKULL.yaw);
  const dx = x - SKULL.x, dz = z - SKULL.z;
  // rotate world -> skull (skull faces +z after rotating by yaw)
  const lx = c * dx - sn * dz, lz = sn * dx + c * dz;
  return [lx / s, (y - (seaFloor(SKULL.x, SKULL.z) + 0.1)) / s - 0.0 + 0.25 * 0, lz / s];
}
export function skullBaseY() { return WATER - 0.07; } // jaw at the waterline, eyes above
/** Skull SDF in block-local world units. */
export function skullSdf(x, y, z) {
  const s = SKULL.scale, c = Math.cos(SKULL.yaw), sn = Math.sin(SKULL.yaw);
  const dx = x - SKULL.x, dz = z - SKULL.z;
  const lx = c * dx - sn * dz, lz = sn * dx + c * dz;
  return skullLocal(lx / s, (y - skullBaseY()) / s, lz / s) * s;
}
export function skullToWorld(lx, ly, lz) {
  const s = SKULL.scale, c = Math.cos(SKULL.yaw), sn = Math.sin(SKULL.yaw);
  const x = lx * s, z = lz * s;
  return [SKULL.x + c * x + sn * z, ly * s + skullBaseY(), SKULL.z - sn * x + c * z];
}

// ---- places --------------------------------------------------------------------------
export const PLACES = {
  ship: { x: 1.05, z: 0.75, heading: -2.3 }, // bow toward the island, stern to the viewer
  anchor: { x: 0.2, z: 0.05 },
  fire: { x: 0.28, z: -0.92 },
  chest: { x: -0.22, z: -0.88, yaw: 0.65 },
  xmark: { x: -0.18, z: -0.58 },
  shovel: { x: -0.02, z: -0.5 },
  rowboat: { x: 1.02, z: -0.36, yaw: 2.2 },
  barrels: [[0.62, -0.98], [0.72, -0.86]],
  crate: { x: 0.8, z: -1.06, yaw: 0.3 },
  shot: { x: 0.52, z: -1.12 },
  rum: { x: 0.12, z: -0.76 },
  wreck: { x: -0.8, z: 1.3, yaw: 0.4 },
};

// Palms: [x, z, height, lean dir (rad), lean amount]
export const PALMS = [
  [-0.32, -1.12, 0.72, 1.1, 0.38], // leaning over the chest
  [-1.05, -1.35, 0.78, 2.2, 0.15],
  [-0.15, -1.55, 0.82, -0.6, 0.12],
  [0.35, -1.6, 0.7, -0.2, 0.18],
  [-1.45, -0.98, 0.62, 2.6, 0.22],
  [-0.62, -1.62, 0.86, 1.8, 0.1],
  [0.72, -1.38, 0.6, 0.4, 0.3],
  [-1.25, -1.6, 0.7, 3.4, 0.14],
  [0.15, -1.25, 0.66, 0.1, 0.12],
];

export function rngFor(seed) { return mulberry32(seed); }
