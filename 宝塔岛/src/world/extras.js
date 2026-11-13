// Clouds, floating rocks and the small islands in the distance.
import { Grid, meshGrid, hash3 } from '../voxel.js';
import { fbm, rng } from './noise.js';
import { sakura, pine, bush } from './flora.js';

export function cloudGeoms(P, seed) {
  const r = rng(seed), C = (n) => P.get(n);
  const G = new Grid([-22, -6, -10], [22, 9, 10]);
  const n = 3 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const cx = Math.round((i - (n - 1) / 2) * (3 + r() * 2.5)), cy = Math.round(r() * 2), cz = Math.round((r() - 0.5) * 4);
    const rad = 2.8 + r() * 3.2;
    G.sphere(cx, cy, cz, rad, (dx, dy) => C(dy + cy > 2 ? 'cloud1' : dy + cy < 0 ? 'cloud3' : 'cloud2'), true, 0.62);
  }
  // flat underside
  for (let x = -22; x <= 22; x++) for (let z = -10; z <= 10; z++) G.set(x, -3, z, 0);
  return meshGrid(G, P, { aoStrength: 0.6 });
}

/** a small floating island: grass on top, soil and rock tapering to a point, with something growing on it */
export function islet(P, seed, R, decor) {
  const r = rng(seed), C = (n) => P.get(n);
  const D = Math.ceil(R * 2.6);
  const G = new Grid([-R - 6, -D - 8, -R - 6], [R + 6, 26, R + 6]);
  const tops = {};
  for (let x = -R - 1; x <= R + 1; x++) for (let z = -R - 1; z <= R + 1; z++) {
    const rr = Math.hypot(x, z) / (R + (fbm(x * 0.4 + seed, z * 0.4, 2, seed) - 0.5) * 2.5);
    if (rr > 1) continue;
    const h = Math.round((1 - rr * rr) * 1.5 + (hash3(x, seed, z) - 0.5));
    const bottom = -Math.round(2 + D * Math.pow(1 - rr, 0.8) * (0.8 + 0.4 * hash3(z, seed, x)));
    tops[x + ',' + z] = h;
    for (let y = bottom; y <= h; y++) {
      const d = h - y;
      const c = d === 0 ? ['grass1', 'grass2', 'grass3', 'grass4'][Math.floor(hash3(x, y, z) * 4)] : d < 3 ? 'soil1' : ['rock1', 'rock2', 'rock3'][Math.floor((y + 30) / 2) % 3];
      G.set(x, y, z, C(c));
    }
    if (rr > 0.7 && hash3(x, 9, z) < 0.1) for (let i = 1; i < 2 + hash3(x, 8, z) * 5; i++) G.put(x, bottom - i, z, C(hash3(z, 1, x) < 0.5 ? 'vine' : 'root'));
  }
  const top = (x, z) => tops[x + ',' + z] ?? 0;
  if (decor === 'sakura') sakura(G, P, 0, top(0, 0), 0, 0.5 + r() * 0.4, seed);
  if (decor === 'pine') pine(G, P, 0, top(0, 0), 0, 0.5, seed);
  if (decor === 'bush') { bush(G, P, -1, top(-1, 0), 0, 0.8, seed); bush(G, P, 2, top(2, 1), 1, 0.4, seed + 1, false); }
  if (decor === 'shrine') {
    // a tiny shrine: stone base, vermilion posts, a dark roof
    const y = top(0, 0);
    G.box(-2, y + 1, -2, 2, y + 1, 2, C('wall1'));
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) G.box(dx, y + 2, dz, dx, y + 4, dz, C('vermilion'));
    G.box(-1, y + 2, -1, 1, y + 4, 1, C('plaster'));
    G.box(-3, y + 5, -3, 3, y + 5, 3, C('tile2')); G.box(-2, y + 6, -2, 2, y + 6, 2, C('tile1')); G.box(-1, y + 7, 0, 1, y + 7, 0, C('ridge'));
    G.set(-3, y + 6, -3, C('gold')); G.set(3, y + 6, 3, C('gold')); G.set(-3, y + 6, 3, C('gold')); G.set(3, y + 6, -3, C('gold'));
  }
  if (decor === 'lantern') {
    const y = top(0, 0);
    G.set(0, y + 1, 0, C('lampStone')); G.set(0, y + 2, 0, C('lampStone')); G.set(0, y + 3, 0, C('lampGlow'));
    G.box(-1, y + 4, -1, 1, y + 4, 1, C('lampStone')); G.set(0, y + 5, 0, C('lampStone'));
    bush(G, P, 2, top(2, 0), -1, 0.3, seed + 3, true);
  }
  if (decor === 'rocks') { G.sphere(1, top(1, 0) + 1, 0, 1.6, C('boulder'), true, 0.8); G.sphere(-1, top(-1, 1) + 1, 1, 1.1, C('boulder2'), true, 0.8); }
  return meshGrid(G, P);
}
