// The orange as a signed distance field, plus its anatomy, all in the shared rest frame.
// Rest frame: stem (polar) axis along +x, centre at the origin, seat toward -y.
import { mulberry32 } from './math.js';

export const POLAR = 1.27; // polar half-length (x)
export const EQUATOR = 1.36; // equatorial radius (y, z)
export const SEAT_Y = -EQUATOR + 0.09; // softly flattened seat
export const SEAT_K = 0.32;
export const EDGE_K = 0.085; // rounding of fresh cut edges
export const ZEST = 0.07;
export const PITH = 0.19;
export const SEGMENTS = 11;
export const PIP_COUNT = 16;
export const PIP_HALF = [0.085, 0.032, 0.05]; // along inward dir, tangential, axial
export const MAX_PIECES = 30;

export function smax(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

export function ellipsoidSdf(x, y, z) {
  const ax = x / POLAR, ay = y / EQUATOR, az = z / EQUATOR;
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const bx = x / (POLAR * POLAR), by = y / (EQUATOR * EQUATOR), bz = z / (EQUATOR * EQUATOR);
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  if (k1 < 1e-6) return -Math.min(POLAR, EQUATOR);
  return (k0 * (k0 - 1)) / k1;
}

export function orangeSdf(x, y, z) {
  return smax(ellipsoidSdf(x, y, z), SEAT_Y - y, SEAT_K);
}

/** planes: flat array [nx, ny, nz, c, ...]; the piece keeps n·X <= c. */
export function pieceSdf(planes, x, y, z) {
  let d = orangeSdf(x, y, z);
  for (let i = 0; i < planes.length; i += 4) {
    d = smax(d, planes[i] * x + planes[i + 1] * y + planes[i + 2] * z - planes[i + 3], EDGE_K);
  }
  return d;
}

export function sdfGrad(f, x, y, z, e = 0.003) {
  const gx = f(x + e, y, z) - f(x - e, y, z);
  const gy = f(x, y + e, z) - f(x, y - e, z);
  const gz = f(x, y, z + e) - f(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}

/** Lowest point of the orange in rest space (where it touches the floor). */
export function restBottom() {
  let lo = -2, hi = 0;
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2;
    if (orangeSdf(0, m, 0) > 0) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

export const ORANGE_VOLUME = (4 / 3) * Math.PI * POLAR * EQUATOR * EQUATOR;

/** Seeded anatomy shared by the renderer (walls, pips, bubbles). */
export function makeAnatomy(seed = 32) {
  const rand = mulberry32(seed);
  const walls = [];
  for (let k = 0; k < SEGMENTS; k++) {
    walls.push({
      base: ((2 * Math.PI) / SEGMENTS) * (k + 0.5) + (rand() - 0.5) * 0.11,
      bow: (rand() - 0.5) * 0.14,
      wander: 0.025 + rand() * 0.04,
      phase: rand() * Math.PI * 2,
    });
  }
  const pips = [];
  for (let i = 0; i < PIP_COUNT; i++) {
    const k = Math.floor(rand() * SEGMENTS);
    const a0 = walls[k].base, a1 = walls[(k + 1) % SEGMENTS].base + (k === SEGMENTS - 1 ? Math.PI * 2 : 0);
    const ang = (a0 + a1) / 2 + (rand() - 0.5) * 0.12;
    const r = 0.24 + rand() * 0.16;
    const x = (rand() - 0.5) * 1.15;
    const dir = [0, -Math.cos(ang), -Math.sin(ang)]; // pointed end inward, toward the axis
    pips.push({ pos: [x, r * Math.cos(ang), r * Math.sin(ang)], dir, owner: 0 });
  }
  const bubbles = [];
  for (let i = 0; i < 7; i++) {
    const ang = rand() * Math.PI * 2, r = 0.45 + rand() * 0.6, x = (rand() - 0.5) * 1.6;
    bubbles.push([x, r * Math.cos(ang), r * Math.sin(ang), 0.016 + rand() * 0.026]);
  }
  return { walls, pips, bubbles };
}

/** How far a pip reaches along unit direction n (support of its ellipsoid). */
export function pipExtent(pip, n) {
  const d = pip.dir;
  const t = [0, -d[2], d[1]]; // tangential (perpendicular to dir and x)
  const a = (d[0] * n[0] + d[1] * n[1] + d[2] * n[2]) * PIP_HALF[0];
  const b = (t[0] * n[0] + t[1] * n[1] + t[2] * n[2]) * PIP_HALF[1];
  const c = n[0] * PIP_HALF[2];
  return Math.sqrt(a * a + b * b + c * c);
}

export const VARIETIES = {
  navel: {
    zestAbs: [0.9, 9.0, 32.0], pithAbs: [0.3, 0.55, 1.4], memAbs: [0.15, 0.32, 0.9],
    fleshAbs: [0.08, 0.62, 2.4], fleshAbs2: [0.1, 0.85, 2.9], glow: [1.0, 0.45, 0.08],
    stem: [0.32, 0.5, 0.12], blush: [0.0, 0.0, 0.0], shadowTint: [1.0, 0.52, 0.16],
  },
  blood: {
    zestAbs: [1.0, 12.0, 30.0], pithAbs: [0.3, 0.7, 1.3], memAbs: [0.18, 0.55, 0.9],
    fleshAbs: [0.15, 3.2, 2.6], fleshAbs2: [0.3, 4.4, 3.4], glow: [0.95, 0.12, 0.08],
    stem: [0.3, 0.46, 0.12], blush: [0.0, 2.5, 1.5], shadowTint: [0.95, 0.22, 0.14],
  },
  caracara: {
    zestAbs: [0.9, 8.5, 30.0], pithAbs: [0.28, 0.5, 1.2], memAbs: [0.15, 0.36, 0.7],
    fleshAbs: [0.07, 1.25, 1.3], fleshAbs2: [0.1, 1.6, 1.6], glow: [1.0, 0.42, 0.32],
    stem: [0.33, 0.5, 0.13], blush: [0.0, 0.0, 0.0], shadowTint: [1.0, 0.45, 0.33],
  },
};
