// The dragon, as voxel parts in a local frame where +x is forward and +y is up.
import { Grid, meshGrid } from '../voxel.js';

function line(G, a, b, c) {
  const n = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2])) * 1.5) + 1;
  for (let i = 0; i <= n; i++) { const t = i / n; G.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, c); }
}

/** one body segment, two voxels long, radius r */
export function segmentGeoms(P, r, spike, parity) {
  const G = new Grid([-1, -r - 2, -r - 3], [0, r + 4, r + 3]);
  const C = (n) => P.get(n);
  for (let x = -1; x <= 0; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
    if (y * y + z * z > (r + 0.45) * (r + 0.45)) continue;
    let c;
    if (y < -r * 0.3) c = ((x + parity) & 1) ? 'belly' : 'mane2';
    else if (y >= r - 0.5 && Math.abs(z) <= 1) c = 'jade3';
    else c = ((y + z + x + parity) & 1) ? 'jade1' : 'jade2';
    G.set(x, y, z, C(c));
  }
  if (spike) { G.set(0, r + 1, 0, C('mane')); G.set(0, r + 2, 0, C('mane2')); if (r >= 2) G.set(-1, r + 1, 0, C('mane')); }
  return meshGrid(G, P, { offset: [0, -0.5, -0.5] });
}

export function headGeoms(P) {
  const G = new Grid([-12, -10, -14], [14, 14, 14]);
  const C = (n) => P.get(n);
  const jade = (x, y, z) => C(((x + y + z) & 1) ? 'jade1' : 'jade2');
  // skull and brow
  G.sphere(1, 1, 0, 3.6, (x, y, z) => jade(x, y, z), false, 0.85);
  for (let z = -3; z <= 3; z++) G.set(4, 4, z, C('jade3'));
  // snout and nose
  for (let x = 3; x <= 10; x++) for (let y = 0; y <= 2; y++) for (let z = -2; z <= 2; z++) {
    if (y === 2 && Math.abs(z) === 2 && x > 6) continue;
    G.set(x, y, z, jade(x, y, z));
  }
  for (let z = -2; z <= 2; z++) G.set(11, 1, z, C('jade3'));
  G.set(11, 2, -1, C('pupil')); G.set(11, 2, 1, C('pupil'));
  // open jaw: red mouth, white teeth, a gilded chin
  for (let x = 3; x <= 9; x++) for (let z = -2; z <= 2; z++) {
    G.set(x, -2, z, Math.abs(z) <= 1 && x >= 4 ? C('mouth') : jade(x, -2, z));
    G.set(x, -3, z, C(Math.abs(z) <= 1 ? 'belly' : 'jade3'));
    if (Math.abs(z) === 2 && x % 2 === 0) { G.set(x, -1, z, C('teeth')); G.set(x, 0 - 0, z, jade(x, 0, z)); }
  }
  for (let z = -1; z <= 1; z++) G.set(4, -1, z, C('mouth'));
  // eyes that glow
  for (const s of [-1, 1]) { G.set(4, 3, s * 3, C('eye')); G.set(5, 3, s * 3, C('eye')); G.set(5, 2, s * 3, C('pupil')); G.set(3, 3, s * 3, C('jade3')); }
  // antler horns
  for (const s of [-1, 1]) {
    line(G, [1, 4, s * 2], [-5, 9, s * 4], C('horn'));
    line(G, [-2, 6.5, s * 3], [-2, 10, s * 3.5], C('horn'));
    line(G, [-5, 9, s * 4], [-8, 10, s * 5], C('horn'));
  }
  // mane around the neck
  for (let a = 0; a < 18; a++) {
    const t = (a / 18) * Math.PI * 2, rr = 4 + (a % 3);
    const y = Math.sin(t) * rr, z = Math.cos(t) * rr;
    line(G, [-1, y * 0.6, z * 0.6], [-5 - (a % 2) * 2, y, z], C(a % 2 ? 'mane' : 'mane2'));
  }
  // long whiskers and a beard
  for (const s of [-1, 1]) {
    line(G, [9, 0, s * 2.5], [5, -2, s * 8], C('mane2'));
    line(G, [5, -2, s * 8], [-3, -4, s * 11], C('mane2'));
    line(G, [-3, -4, s * 11], [-10, -3, s * 12], C('mane'));
  }
  line(G, [5, -4, 0], [2, -7, 0], C('mane')); line(G, [6, -4, 0], [4, -6, 0], C('mane2'));
  return meshGrid(G, P, { offset: [0, -0.5, -0.5] });
}

export function legGeoms(P) {
  const G = new Grid([-4, -8, -2], [6, 2, 8]);
  const C = (n) => P.get(n);
  line(G, [0, 0, 1], [1, -3, 3], C('jade1'));
  line(G, [1, 0, 1], [2, -3, 3], C('jade2'));
  line(G, [1, -3, 3], [3, -5, 4], C('jade1'));
  for (const [dx, dz] of [[2, -1], [2, 1], [3, 0]]) line(G, [3, -5, 4], [3 + dx, -6, 4 + dz], C('horn'));
  G.set(0, 0, 2, C('mane')); G.set(-1, -1, 2, C('mane2'));
  return meshGrid(G, P, { offset: [-0.5, -0.5, -0.5] });
}

export function tailGeoms(P) {
  const G = new Grid([-10, -8, -2], [1, 8, 2]);
  const C = (n) => P.get(n);
  for (let i = 0; i < 7; i++) {
    const a = -0.9 + i * 0.3;
    line(G, [0, 0, 0], [-6 - (i % 2) * 2, Math.sin(a) * 6, 0], C(i % 2 ? 'mane' : 'mane2'));
  }
  return meshGrid(G, P, { offset: [0, -0.5, -0.5] });
}
