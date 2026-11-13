// Cherry trees, black pines, bushes: grown from a few rules and a seed.
import { hash3 } from '../voxel.js';
import { rng } from './noise.js';

function line(G, a, b, c, thick = 0) {
  const n = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2])) * 1.5) + 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
    G.set(x, y, z, c);
    if (thick) for (const [dx, dz] of [[1, 0], [0, 1], [1, 1]]) G.set(x + dx, y, z + dz, c);
  }
}

export function sakura(G, P, x, y, z, size, seed) {
  const r = rng(seed), C = (n) => P.get(n);
  const lean = [(r() - 0.5) * 0.5, (r() - 0.5) * 0.5];
  const h = Math.round(6 + size * 3);
  const topP = [x + lean[0] * h, y + h, z + lean[1] * h];
  line(G, [x, y + 1, z], [x + lean[0] * h * 0.5, y + h * 0.5, z + lean[1] * h * 0.5], C('barkS'), 1);
  line(G, [x + lean[0] * h * 0.5, y + h * 0.5, z + lean[1] * h * 0.5], topP, C('barkS'), 0);
  // roots flaring into the grass
  for (const [dx, dz] of [[-1, 0], [2, 0], [0, -1], [0, 2]]) G.set(x + dx, y + 1, z + dz, C('bark1'));
  const ends = [topP];
  const nb = 4 + Math.floor(r() * 3);
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + r() * 0.8, start = y + h * (0.45 + r() * 0.4);
    const len = 4 + size * 2.2 + r() * 2;
    const s = [x + lean[0] * (start - y), start, z + lean[1] * (start - y)];
    const e = [s[0] + Math.cos(a) * len, start + len * (0.35 + r() * 0.35), s[2] + Math.sin(a) * len];
    line(G, s, e, C(r() < 0.5 ? 'barkS' : 'bark1'));
    ends.push(e);
  }
  const shades = ['sak1', 'sak1', 'sak1', 'sak2', 'sak2', 'sak3', 'sak3', 'sak4', 'sak5'];
  for (const e of ends) {
    const rad = 2.6 + size * 1.1 + r() * 1.2;
    G.sphere(Math.round(e[0]), Math.round(e[1]), Math.round(e[2]), rad, (dx, dy, dz) => {
      const X = Math.round(e[0]) + dx, Y = Math.round(e[1]) + dy, Z = Math.round(e[2]) + dz;
      if (hash3(X, Y, Z) < 0.14 && dx * dx + dy * dy + dz * dz > (rad - 1.5) ** 2) return 0;
      let s = shades[Math.floor(hash3(Z, X, Y) * shades.length)];
      if (dy > rad * 0.4 && hash3(X, Z, Y) < 0.35) s = 'sak3';
      if (dy < -rad * 0.3 && hash3(Y, X, Z) < 0.4) s = 'sak5';
      return C(s);
    }, true, 0.72);
    // a few drooping sprays
    for (let k = 0; k < 3; k++) {
      const dx = Math.round((r() - 0.5) * rad * 1.6), dz = Math.round((r() - 0.5) * rad * 1.6), L = 1 + Math.floor(r() * 3);
      for (let j = 0; j < L; j++) G.put(Math.round(e[0]) + dx, Math.round(e[1] - rad * 0.7) - j, Math.round(e[2]) + dz, C(j === L - 1 ? 'sak4' : 'sak1'));
    }
  }
}

export function pine(G, P, x, y, z, size, seed) {
  const r = rng(seed), C = (n) => P.get(n);
  let p = [x, y + 1, z], dir = [(r() - 0.5) * 0.6, 1, (r() - 0.5) * 0.6];
  const h = Math.round(7 + size * 4);
  const pads = [];
  for (let i = 0; i < h; i++) {
    const q = [p[0] + dir[0], p[1] + 1, p[2] + dir[2]];
    line(G, p, q, C('barkP'), i < h * 0.4 ? 1 : 0);
    p = q;
    dir = [dir[0] + (r() - 0.5) * 0.5, 1, dir[2] + (r() - 0.5) * 0.5];
    if (i > h * 0.35 && i % 2 === 0) {
      const a = r() * Math.PI * 2, len = 3 + size * 2 + r() * 2;
      const e = [p[0] + Math.cos(a) * len, p[1] + r() * 1.5, p[2] + Math.sin(a) * len];
      line(G, p, e, C('barkP'));
      pads.push([e, 2.6 + size * 0.9 + r()]);
    }
  }
  pads.push([p, 3 + size]);
  for (const [e, rad] of pads) {
    const cx = Math.round(e[0]), cy = Math.round(e[1]), cz = Math.round(e[2]);
    for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) for (let dz = -Math.ceil(rad); dz <= Math.ceil(rad); dz++) for (let dy = -1; dy <= 1; dy++) {
      const d = Math.hypot(dx, dz) / rad + Math.abs(dy) * 0.45;
      if (d > 1 + (hash3(cx + dx, cy + dy, cz + dz) - 0.5) * 0.25) continue;
      G.put(cx + dx, cy + dy, cz + dz, C(dy > 0 ? 'pine2' : dy < 0 ? 'pine3' : (hash3(dx, cy, dz) < 0.5 ? 'pine1' : 'pine2')));
    }
  }
}

export function bush(G, P, x, y, z, size, seed, flowers = true) {
  const r = rng(seed), C = (n) => P.get(n);
  const rad = 1.6 + size;
  G.sphere(x, y + Math.round(rad * 0.6), z, rad, (dx, dy, dz) => {
    const X = x + dx, Y = y + dy, Z = z + dz;
    if (flowers && dy >= 0 && hash3(X, Y, Z) < 0.22) return C(hash3(Z, Y, X) < 0.5 ? 'azalea1' : 'azalea2');
    return C(['bush1', 'bush2', 'bush3'][Math.floor(hash3(Y, Z, X) * 3)]);
  }, true, 0.75);
  void r;
}

export function plantIsland(G, P, W) {
  const near = [];
  const ok = (x, z, clear) => {
    const k = W.kind.get(x + ',' + z);
    if (k !== 'grass') return false;
    for (const [nx, nz, nr] of near) if (Math.hypot(nx - x, nz - z) < nr + clear) return false;
    return true;
  };
  const place = (fn, x, z, size, seed, clear) => { const y = W.topY(x, z); fn(G, P, x, y, z, size, seed); near.push([x, z, clear]); };
  // cherry trees
  place(sakura, -14, 9, 1.4, 11, 7); place(sakura, 21, 13, 1.0, 12, 6); place(sakura, -5, -20, 1.1, 13, 6);
  place(sakura, 10, 27, 0.6, 14, 4); place(sakura, 25, -21, 0.8, 15, 5); place(sakura, -23, 17, 0.7, 16, 5);
  // black pines
  place(pine, -17, -16, 1.3, 21, 6); place(pine, -28, -2, 0.8, 22, 4); place(pine, 26, 1, 0.9, 23, 4); place(pine, -11, 26, 0.5, 24, 3); place(pine, 13, -24, 0.7, 25, 4);
  // bushes, wherever there is room
  let s = 100;
  for (let i = 0; i < 400 && s < 132; i++) {
    const x = Math.round(Math.sin(i * 12.9898) * 30), z = Math.round(Math.cos(i * 78.233) * 30);
    if (Math.hypot(x, z) > 29 || !ok(x, z, 2.5)) continue;
    place(bush, x, z, 0.3 + hash3(x, 0, z) * 0.9, s++, 2.5);
  }
}
