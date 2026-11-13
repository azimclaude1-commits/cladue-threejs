// Small deterministic noise helpers.
import { hash3 } from '../voxel.js';
const sm = (t) => t * t * (3 - 2 * t);
export function vnoise(x, z, seed = 0) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = sm(x - xi), fz = sm(z - zi);
  const a = hash3(xi, seed, zi), b = hash3(xi + 1, seed, zi), c = hash3(xi, seed, zi + 1), d = hash3(xi + 1, seed, zi + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
export function fbm(x, z, oct = 4, seed = 0) { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f, seed + i * 17); n += a; a *= 0.5; f *= 2.03; } return s / n; }
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
