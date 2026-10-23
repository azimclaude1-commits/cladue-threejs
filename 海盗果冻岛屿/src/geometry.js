// Every mesh in the diorama, built procedurally into one big vertex/index buffer.
import { Builder, X, MAT, hex, mix3 } from './builder.js';
import { HALF, WATER, groundHeight, seaFloor, islandE, COVE, PLACES, PALMS, SKULL, skullLocal, skullSdf, skullToWorld, GRIN_Y, noise3, fbm2 } from './world.js';
import { clamp, smoothstep, mulberry32 } from './math.js';

export const OBJ = { STATIC: 0, SHIP: 1, LID: 2, CHAIN: 3, NCHAIN: 30 };
OBJ.BALL = OBJ.CHAIN + OBJ.NCHAIN; OBJ.NBALL = 20;
OBJ.BARREL = OBJ.BALL + OBJ.NBALL; OBJ.NBARREL = 8;
OBJ.COIN = OBJ.BARREL + OBJ.NBARREL; OBJ.NCOIN = 36;
OBJ.COUNT = OBJ.COIN + OBJ.NCOIN;

export const SIZES = { ball: 0.045, barrel: 0.058, barrelH: 0.15, coin: 0.03 };

const C = {
  sand: hex('#e6cf98'), rock: hex('#8d8478'), rockDark: hex('#5f574e'), wood: hex('#7a4a2a'), woodDark: hex('#4a2d1a'),
  woodLight: hex('#a9764a'), iron: hex('#2a2a2d'), gold: hex('#f2c14e'), black: hex('#1a191c'), ochre: hex('#c4932f'),
  red: hex('#8e2b22'), sail: hex('#efe4c9'), rope: hex('#3b2d20'), cream: hex('#efe6d2'), bone: hex('#f1ead6'),
};

const g = (x, z) => groundHeight(x, z);

/** Simple surface nets over a box (used for the skull). */
function surfaceNets(sdf, mn, mx, h) {
  const nx = Math.ceil((mx[0] - mn[0]) / h) + 1, ny = Math.ceil((mx[1] - mn[1]) / h) + 1, nz = Math.ceil((mx[2] - mn[2]) / h) + 1;
  const F = new Float32Array(nx * ny * nz);
  const id = (i, j, k) => (k * ny + j) * nx + i;
  // coarse pass first; only points near the surface get the exact field
  const S = 4, cx = Math.ceil(nx / S) + 1, cy = Math.ceil(ny / S) + 1, cz = Math.ceil(nz / S) + 1;
  const Cf = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) Cf[(k * cy + j) * cx + i] = sdf(mn[0] + i * S * h, mn[1] + j * S * h, mn[2] + k * S * h);
  const band = S * h * 1.6;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = Cf[(Math.round(k / S) * cy + Math.round(j / S)) * cx + Math.round(i / S)];
    F[id(i, j, k)] = Math.abs(c) > band ? c : sdf(mn[0] + i * h, mn[1] + j * h, mn[2] + k * h);
  }
  const cv = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cor = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let m = 0;
    for (let c = 0; c < 8; c++) { const v = F[id(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))]; cor[c] = v; if (v < 0) m |= 1 << c; }
    if (m === 0 || m === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      if ((cor[a] < 0) === (cor[b] < 0)) continue;
      const t = cor[a] / (cor[a] - cor[b]);
      sx += (a & 1) + t * ((b & 1) - (a & 1)); sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1)); sz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1)); n++;
    }
    cv[id(i, j, k)] = pos.length / 3;
    pos.push(mn[0] + (i + sx / n) * h, mn[1] + (j + sy / n) * h, mn[2] + (k + sz / n) * h);
  }
  const tris = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) { const t = b; b = d; d = t; } tris.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const in0 = F[id(i, j, k)] < 0;
    if (in0 !== (F[id(i + 1, j, k)] < 0)) quad(cv[id(i, j, k)], cv[id(i, j - 1, k)], cv[id(i, j - 1, k - 1)], cv[id(i, j, k - 1)], !in0);
    if (in0 !== (F[id(i, j + 1, k)] < 0)) quad(cv[id(i, j, k)], cv[id(i, j, k - 1)], cv[id(i - 1, j, k - 1)], cv[id(i - 1, j, k)], !in0);
    if (in0 !== (F[id(i, j, k + 1)] < 0)) quad(cv[id(i, j, k)], cv[id(i - 1, j, k)], cv[id(i - 1, j - 1, k)], cv[id(i, j - 1, k)], !in0);
  }
  // project + normals
  const nrm = new Float32Array(pos.length);
  const e = h * 0.25;
  for (let v = 0; v < pos.length; v += 3) {
    let x = pos[v], y = pos[v + 1], z = pos[v + 2];
    let gx = 0, gy = 1, gz = 0;
    for (let it = 0; it < 1; it++) {
      const d = sdf(x, y, z);
      gx = (sdf(x + e, y, z) - sdf(x - e, y, z)) / (2 * e); gy = (sdf(x, y + e, z) - sdf(x, y - e, z)) / (2 * e); gz = (sdf(x, y, z + e) - sdf(x, y, z - e)) / (2 * e);
      const l2 = gx * gx + gy * gy + gz * gz || 1;
      const s = clamp(d / l2, -h, h);
      x -= gx * s; y -= gy * s; z -= gz * s;
    }
    const l = Math.hypot(gx, gy, gz) || 1;
    pos[v] = x; pos[v + 1] = y; pos[v + 2] = z;
    nrm[v] = gx / l; nrm[v + 1] = gy / l; nrm[v + 2] = gz / l;
  }
  return { pos, nrm, tris };
}

// ---------------------------------------------------------------------------- pieces --

function terrain(B) {
  B.set(X.I(), OBJ.STATIC);
  const N = 230, d = (2 * HALF) / N;
  const H = new Float32Array((N + 3) * (N + 3));
  const at = (i, j) => H[(j + 1) * (N + 3) + (i + 1)];
  for (let j = -1; j <= N + 1; j++) for (let i = -1; i <= N + 1; i++) H[(j + 1) * (N + 3) + (i + 1)] = g(-HALF + i * d, -HALF + j * d);
  const base = B.count;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const hx = (at(i + 1, j) - at(i - 1, j)) / (2 * d), hz = (at(i, j + 1) - at(i, j - 1)) / (2 * d);
    B.v([-HALF + i * d, at(i, j), -HALF + j * d], [-hx, 1, -hz], C.sand, MAT.TERRAIN);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = base + j * (N + 1) + i, b = a + 1, c = a + N + 1, e = c + 1;
    B.tri(a, c, b); B.tri(b, c, e);
  }
}

function walls(B) {
  B.set(X.I(), OBJ.STATIC);
  const sides = [[[0, 0, 1], [1, 0, 0]], [[1, 0, 0], [0, 0, -1]], [[0, 0, -1], [-1, 0, 0]], [[-1, 0, 0], [0, 0, 1]]];
  for (const [n, t] of sides) {
    B.surface(200, 6, (u, v) => {
      const a = -HALF + u * 2 * HALF;
      const x = n[0] * HALF + t[0] * a, z = n[2] * HALF + t[2] * a;
      return { p: [x, v * g(x, z), z], c: C.sand };
    }, MAT.WALL);
  }
}

function skull(B) {
  const s = SKULL.scale;
  const base = skullToWorld(0, 0, 0);
  const mn = [base[0] - 0.62 * s * 1.3, base[1] - 0.6 * s, base[2] - 0.62 * s * 1.3];
  const mx = [base[0] + 0.62 * s * 1.3, base[1] + 1.2 * s, base[2] + 0.62 * s * 1.3];
  mn[1] = Math.min(mn[1], 0.75);
  const mesh = surfaceNets(skullSdf, mn, mx, 0.0125);
  B.set(X.I(), OBJ.STATIC);
  const c = Math.cos(SKULL.yaw), sn = Math.sin(SKULL.yaw);
  const base0 = B.count;
  for (let i = 0; i < mesh.pos.length; i += 3) {
    const x = mesh.pos[i], y = mesh.pos[i + 1], z = mesh.pos[i + 2];
    // skull-local, for the eye glow mask
    const dx = x - SKULL.x, dz = z - SKULL.z;
    const lx = (c * dx - sn * dz) / s, ly = (y - base[1]) / s, lz = (sn * dx + c * dz) / s;
    let glow = 0;
    for (const e of [-1, 1]) glow = Math.max(glow, smoothstep(0.15, 0.085, Math.hypot(lx - e * 0.18, ly - 0.47)) * smoothstep(0.5, 0.42, lz));
    // cavity occlusion from the field: how open is the space just off the surface?
    const e = 0.045 * s;
    const occ = Math.max(0, Math.min(1, skullSdf(x + mesh.nrm[i] * e, y + mesh.nrm[i + 1] * e, z + mesh.nrm[i + 2] * e) / e));
    B.v([x, y, z], [mesh.nrm[i], mesh.nrm[i + 1], mesh.nrm[i + 2]], [0.25 + 0.75 * occ, 0, 0], MAT.SKULL, glow, ly);
  }
  for (let i = 0; i < mesh.tris.length; i += 3) B.tri(base0 + mesh.tris[i], base0 + mesh.tris[i + 1], base0 + mesh.tris[i + 2]);
  // teeth: two rows of boxes set into the grin
  const rand = mulberry32(9);
  for (const row of [1, -1]) {
    for (let i = 0; i < 6; i++) {
      const lx = -0.2 + i * 0.08;
      const ly = GRIN_Y(lx) + row * 0.03;
      // find the face surface just outside the groove
      let zf = 0.3;
      for (let zz = 0.75; zz > 0.1; zz -= 0.005) { if (skullLocal(lx, ly + row * 0.07, zz) < 0) { zf = zz; break; } }
      const yaw = Math.asin(clamp(lx / 0.55, -1, 1));
      const w = skullToWorld(lx, ly, zf - 0.035);
      B.set(X.mul(X.T(...w), X.RY(SKULL.yaw), X.RY(yaw), X.RZ((rand() - 0.5) * 0.15), X.S(s)), OBJ.STATIC);
      B.box(0.066, 0.058, 0.07, mix3(C.bone, hex('#d8caa6'), rand() * 0.6), MAT.TEETH);
    }
  }
}

function palm(B, idx, [px, pz, h, leanA, lean], rand) {
  const y0 = g(px, pz) - 0.03;
  const ld = [Math.cos(leanA), 0, Math.sin(leanA)];
  const P = (t) => [px + ld[0] * lean * h * Math.pow(t, 1.6), y0 + t * h, pz + ld[2] * lean * h * Math.pow(t, 1.6)];
  const pts = []; for (let i = 0; i <= 10; i++) pts.push(P(i / 10));
  const rings = Math.round(h * 26);
  const light = hex('#c08a4e'), dark = hex('#7b4f2c');
  B.set(X.I(), OBJ.STATIC);
  B.tube(pts, (t) => (0.036 - 0.013 * t) * (1 + 0.14 * Math.pow(Math.max(0, Math.sin(t * rings * Math.PI * 2)), 3)), 10, light, MAT.TRUNK, {
    e0: (t) => t, e1: idx + 1, colorFn: (t) => mix3(dark, light, smoothstep(0.2, 0.8, Math.abs(((t * rings) % 1) - 0.5) * 2)),
  });
  const top = P(1);
  // coconuts
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + rand();
    B.set(X.T(top[0] + Math.cos(a) * 0.025, top[1] - 0.02, top[2] + Math.sin(a) * 0.025));
    B.sphere(0.02, 6, hex('#5a3a1e'), MAT.TRUNK, { e0: 1, e1: idx + 1 });
  }
  B.set(X.I());
  const nf = 8 + Math.floor(rand() * 2);
  for (let k = 0; k < nf; k++) {
    const a = (k / nf) * Math.PI * 2 + rand() * 0.4;
    const L = (0.3 + rand() * 0.1) * (h / 0.75);
    const d = [Math.cos(a), 0, Math.sin(a)], side = [-d[2], 0, d[0]];
    const rise = 0.12 + rand() * 0.1;
    const base = mix3(hex('#2f7d32'), hex('#4f9d3a'), rand());
    B.surface(14, 4, (u, v) => {
      const s = u, w = 0.085 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05)), 0.7) * (0.6 + 0.4 * Math.pow(Math.abs(Math.sin(s * 30)), 0.4)) * (L / 0.32);
      const vv = v * 2 - 1;
      const yOff = (rise * s - 0.42 * s * s) * L * 1.5 - 0.3 * Math.abs(vv) * w;
      return {
        p: [top[0] + d[0] * s * L + side[0] * vv * w, top[1] + yOff, top[2] + d[2] * s * L + side[2] * vv * w],
        c: mix3(base, hex('#a8c94a'), s * 0.45), e0: s, e1: idx + 1,
      };
    }, MAT.FROND);
  }
}

function lumpy(B, at, r, color, mat, seed, squash = 1) {
  B.set(X.mul(X.T(...at), X.S(1, squash, 1)));
  B.sphere(r, 9, color, mat, { deform: (x, y, z) => 1 + (noise3(x * 2.5 + seed, y * 2.5, z * 2.5) - 0.5) * 0.5 });
}

function vegetation(B, rand) {
  // bushes with flowers
  const greens = ['#3f8f3a', '#5aa83c', '#2f7a45', '#6bb544'].map(hex);
  const flowers = ['#ff6f91', '#ffd23f', '#ff4f4f', '#f7a8ff'].map(hex);
  const avoid = (x, z) => Math.hypot(x - PLACES.fire.x, z - PLACES.fire.z) < 0.35 || Math.hypot(x - PLACES.chest.x, z - PLACES.chest.z) < 0.25 || Math.hypot(x - PLACES.xmark.x, z - PLACES.xmark.z) < 0.25 || Math.hypot(x - 0.4, z + 1.05) < 0.4;
  let placed = 0;
  for (let i = 0; i < 400 && placed < 18; i++) {
    const x = -2.0 + rand() * 3.0, z = -2.1 + rand() * 1.6;
    const e = islandE(x, z);
    if (e > 0.82 || e < 0.25 || avoid(x, z)) continue;
    placed++;
    const y = g(x, z);
    const n = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const r = 0.045 + rand() * 0.045;
      const ox = (rand() - 0.5) * 0.12, oz = (rand() - 0.5) * 0.12;
      lumpy(B, [x + ox, y + r * 0.5, z + oz], r, greens[Math.floor(rand() * greens.length)], MAT.GUMMY, rand() * 10, 0.85);
      for (let f = 0; f < 2; f++) {
        const a = rand() * 6.28, b = rand() * 1.2;
        B.set(X.T(x + ox + Math.cos(a) * Math.sin(b) * r, y + r * 0.5 + Math.cos(b) * r * 0.85, z + oz + Math.sin(a) * Math.sin(b) * r));
        B.sphere(0.012, 5, flowers[Math.floor(rand() * flowers.length)], MAT.GUMMY);
      }
    }
  }
  // ferns + beach grass
  for (let i = 0, ferns = 0; i < 300 && ferns < 26; i++) {
    const x = -2.0 + rand() * 3.0, z = -2.1 + rand() * 1.7;
    const e = islandE(x, z);
    if (e > 0.9 || avoid(x, z)) continue;
    ferns++;
    const y = g(x, z) - 0.005;
    const grass = e > 0.6;
    const n = grass ? 7 : 5;
    B.set(X.I());
    for (let k = 0; k < n; k++) {
      const a = rand() * 6.28;
      const L = grass ? 0.06 + rand() * 0.05 : 0.09 + rand() * 0.05;
      const d = [Math.cos(a), 0, Math.sin(a)], side = [-d[2], 0, d[0]];
      const col = grass ? mix3(hex('#9fb54a'), hex('#d8c27a'), rand()) : mix3(hex('#2f7d32'), hex('#5c9e3a'), rand());
      B.surface(grass ? 3 : 8, 2, (u, v) => {
        const s = u, vv = v * 2 - 1;
        const w = grass ? 0.006 * (1 - s) : 0.03 * Math.sin(Math.PI * s) * (0.6 + 0.4 * Math.abs(Math.sin(s * 22)));
        const out = grass ? 0.25 + 0.6 * s * s : 0.9;
        return { p: [x + d[0] * s * L * out + side[0] * vv * w, y + (grass ? s * L * 1.6 : s * L * 0.6 - s * s * L * 0.55), z + d[2] * s * L * out + side[2] * vv * w], c: mix3(col, hex('#c9dc6a'), s * 0.3), e0: s * 0.5, e1: 0 };
      }, MAT.FROND);
    }
  }
  // rocks around the shore
  for (let i = 0, n = 0; i < 600 && n < 16; i++) {
    const x = -2.3 + rand() * 3.6, z = -2.3 + rand() * 2.4;
    const e = islandE(x, z);
    if (e < 0.92 || e > 1.15 || avoid(x, z)) continue;
    if (Math.hypot(x - PLACES.rowboat.x, z - PLACES.rowboat.z) < 0.3) continue;
    n++;
    const r = 0.035 + rand() * 0.05;
    lumpy(B, [x, g(x, z) + r * 0.15, z], r, mix3(C.rock, C.rockDark, rand()), MAT.ROCK, rand() * 10, 0.7);
  }
}

// ---- the ship --------------------------------------------------------------------------
export const SHIP = {
  L: 1.3,
  beam(s) { return s >= 0 ? 0.2 * Math.sqrt(Math.max(0, 1 - Math.pow(s, 2.4))) : 0.2 - 0.05 * s * s; },
  top(s) { return 0.13 + 0.06 * s * s + 0.09 * smoothstep(-0.38, -0.58, s); },
  keel(s) { return -0.16 * (1 - 0.35 * s * s) + Math.max(0, s - 0.7) * 0.4; },
};
function hullPoint(s, th) {
  const b = SHIP.beam(s), top = SHIP.top(s), keel = SHIP.keel(s);
  const st = Math.sin(th);
  const y = top - (top - keel) * Math.pow(st, 0.8);
  const tumble = 1 - 0.1 * (1 - st) * (y > 0.05 ? 1 : 0);
  return [s * SHIP.L / 2, y, -b * Math.cos(th) * tumble];
}
function hullColor(y, s) {
  const top = SHIP.top(s);
  if (top - y < 0.012) return C.ochre;
  if (y < -0.005) return C.red;
  if (y > 0.034 && y < 0.074) return C.ochre;
  return C.black;
}

export function shipInfo() {
  const guns = [];
  for (const side of [1, -1]) for (const s of [-0.25, 0.02, 0.28, 0.52]) guns.push({ side, s, pos: [s * SHIP.L / 2, 0.054, side * (SHIP.beam(s) * 0.93 + 0.04)], dir: [0, 0.08, side] });
  const buoy = [];
  for (const s of [-0.8, -0.4, 0, 0.4, 0.75]) for (const z of [-1, 1]) buoy.push([s * SHIP.L / 2, -0.06, z * SHIP.beam(s) * 0.6]);
  return { guns, buoy, hawse: [0.6, 0.09, 0], radii: [0.68, 0.24, 0.23], lantern: [-0.69, SHIP.top(-1) + 0.1, 0] };
}

function ship(B, rand) {
  B.set(X.I(), OBJ.SHIP);
  // hull (both sides, one surface from port rail under the keel to starboard rail)
  B.surface(36, 64, (u, v) => {
    const th = u * Math.PI, s = -1 + v * 2;
    const p = hullPoint(s, th);
    return { p, c: hullColor(p[1], s) };
  }, MAT.DIFFUSE, { flip: false });
  // transom
  const tr = [];
  for (let i = 0; i <= 24; i++) tr.push(hullPoint(-1, (i / 24) * Math.PI));
  const ctr = [-SHIP.L / 2, (SHIP.top(-1) + SHIP.keel(-1)) / 2, 0];
  for (let i = 0; i < 24; i++) B.flatTri(ctr, tr[i + 1], tr[i], tr[i][1] < -0.005 ? C.red : C.black, MAT.DIFFUSE);
  // stern windows + trim
  const tTop = SHIP.top(-1);
  for (let i = -1; i <= 1; i++) {
    B.set(X.T(-SHIP.L / 2 - 0.004, tTop - 0.075, i * 0.055), OBJ.SHIP); B.box(0.006, 0.034, 0.036, hex('#ffcf7a'), MAT.WINDOW);
    B.set(X.T(-SHIP.L / 2 - 0.002, tTop - 0.075, i * 0.055), OBJ.SHIP); B.box(0.006, 0.044, 0.046, C.ochre, MAT.DIFFUSE);
  }
  B.set(X.T(-SHIP.L / 2 - 0.003, tTop - 0.035, 0), OBJ.SHIP); B.box(0.006, 0.01, 0.2, C.ochre, MAT.DIFFUSE);
  // stern lantern on a post
  B.set(X.T(-SHIP.L / 2 - 0.02, tTop, 0), OBJ.SHIP); B.cylinder(0.005, 0.07, 6, C.iron, MAT.METAL);
  B.set(X.T(-SHIP.L / 2 - 0.02, tTop + 0.1, 0), OBJ.SHIP); B.sphere(0.022, 8, hex('#ffd27a'), MAT.LANTERN);
  B.set(X.T(-SHIP.L / 2 - 0.02, tTop + 0.128, 0), OBJ.SHIP); B.cylinder((t) => 0.018 * (1 - t), 0.03, 8, C.iron, MAT.METAL);
  // deck
  B.set(X.I(), OBJ.SHIP);
  B.surface(8, 60, (u, v) => {
    const s = -0.98 + v * 1.94, b = SHIP.beam(s) * 0.86;
    const x = s * SHIP.L / 2, z = (u * 2 - 1) * b;
    const plank = Math.floor((z + 0.3) * 60) % 2;
    return { p: [x, SHIP.top(s) - 0.02, z], c: plank ? hex('#8a5a34') : hex('#7a4e2c') };
  }, MAT.WOOD, { flip: true });
  // gunports + cannons
  for (const gun of shipInfo().guns) {
    const z = gun.side * SHIP.beam(gun.s) * 0.93;
    B.set(X.T(gun.pos[0], 0.054, z), OBJ.SHIP); B.box(0.05, 0.036, 0.01, hex('#120f0e'), MAT.DIFFUSE);
    B.set(X.mul(X.T(gun.pos[0], 0.054, z), X.RX(gun.side * Math.PI / 2)), OBJ.SHIP); B.cylinder((t) => 0.011 - 0.003 * t, 0.055, 8, C.iron, MAT.METAL);
  }
  // masts, yards, tops
  const masts = [{ x: 0.33, h: 1.05 }, { x: 0.0, h: 1.25 }, { x: -0.36, h: 0.92 }];
  for (const m of masts) {
    const y0 = SHIP.top(m.x / (SHIP.L / 2)) - 0.02;
    B.set(X.T(m.x, y0, 0), OBJ.SHIP); B.cylinder((t) => 0.016 - 0.007 * t, m.h - y0, 8, hex('#3d2614'), MAT.WOOD);
  }
  const yard = (x, y, w) => { B.set(X.mul(X.T(x, y, -w / 2), X.RX(Math.PI / 2)), OBJ.SHIP); B.cylinder((t) => 0.007 * (1 - 0.5 * Math.abs(t - 0.5)), w, 6, hex('#3d2614'), MAT.WOOD, { caps: false }); };
  const squareSail = (x, yTop, yBot, wTop, wBot, belly) => {
    B.set(X.I(), OBJ.SHIP);
    B.surface(10, 8, (u, v) => {
      const w = wTop + (wBot - wTop) * v;
      const bw = Math.sin(Math.PI * u) * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, v * 0.9 + 0.1)));
      return { p: [x - 0.02 - belly * bw, yTop + (yBot - yTop) * v, (u - 0.5) * w], c: mix3(C.sail, hex('#d9c9a3'), v * 0.4 + (noise3(u * 6, v * 6, x) - 0.5) * 0.3), e0: bw };
    }, MAT.SAIL);
  };
  // fore: course + topsail
  yard(0.33, 0.5, 0.46); yard(0.33, 0.84, 0.34);
  squareSail(0.33, 0.5, 0.25, 0.44, 0.48, 0.08); squareSail(0.33, 0.84, 0.53, 0.32, 0.42, 0.07);
  // main: course + topsail
  yard(0.0, 0.58, 0.52); yard(0.0, 1.0, 0.38);
  squareSail(0.0, 0.58, 0.27, 0.5, 0.54, 0.09); squareSail(0.0, 1.0, 0.61, 0.36, 0.48, 0.08);
  // fighting tops
  for (const [x, y] of [[0.33, 0.78], [0.0, 0.92]]) { B.set(X.T(x, y, 0), OBJ.SHIP); B.cylinder(0.04, 0.012, 10, hex('#3d2614'), MAT.WOOD); }
  // mizzen gaff sail
  const mz = -0.36;
  B.set(X.I(), OBJ.SHIP);
  const P00 = [mz - 0.01, 0.3], P10 = [mz - 0.42, 0.29], P01 = [mz - 0.01, 0.74], P11 = [mz - 0.36, 0.86];
  B.surface(8, 8, (u, v) => {
    const x = (P00[0] * (1 - u) + P10[0] * u) * (1 - v) + (P01[0] * (1 - u) + P11[0] * u) * v;
    const y = (P00[1] * (1 - u) + P10[1] * u) * (1 - v) + (P01[1] * (1 - u) + P11[1] * u) * v;
    const bw = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
    return { p: [x, y, 0.05 * bw], c: mix3(C.sail, hex('#d9c9a3'), (noise3(u * 5, v * 5, 3) - 0.3) * 0.5), e0: bw * 0.7 };
  }, MAT.SAIL);
  for (const [a, b] of [[P00, P10], [P01, P11]]) B.set(X.I(), OBJ.SHIP).tube([[a[0], a[1], 0], [b[0], b[1], 0]], 0.006, 5, hex('#3d2614'), MAT.WOOD);
  // bowsprit + jib
  B.set(X.I(), OBJ.SHIP).tube([[0.58, 0.18, 0], [1.0, 0.36, 0]], (t) => 0.013 - 0.006 * t, 6, hex('#3d2614'), MAT.WOOD);
  const J0 = [0.35, 0.92], J1 = [0.97, 0.35], J2 = [0.62, 0.22];
  B.set(X.I(), OBJ.SHIP);
  B.surface(8, 6, (u, v) => {
    const ax = J0[0] + (J1[0] - J0[0]) * u, ay = J0[1] + (J1[1] - J0[1]) * u;
    const bx = J2[0], by = J2[1];
    const w = v * (1 - u * 0.0);
    const x = ax + (bx - ax) * w * (u * 0.95 + 0.05) * 0 + (bx - ax) * w * (1 - Math.abs(u - 0.6)) * 0.9;
    const y = ay + (by - ay) * w * (1 - Math.abs(u - 0.6)) * 0.9;
    const bw = Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v));
    return { p: [x, y, 0.035 * bw], c: C.sail, e0: bw * 0.6 };
  }, MAT.SAIL);
  // rigging: shrouds and stays
  const rope = (a, b) => B.set(X.I(), OBJ.SHIP).tube([a, b], 0.0028, 4, C.rope, MAT.DIFFUSE);
  for (const m of masts) {
    const s = m.x / (SHIP.L / 2);
    for (const side of [-1, 1]) for (const dx of [-0.07, 0, 0.07]) rope([m.x, m.h * 0.78, side * 0.01], [m.x + dx, SHIP.top(s + dx / 0.65), side * SHIP.beam(s + dx / 0.65) * 0.9]);
  }
  rope([0.33, 1.02, 0], [1.0, 0.36, 0]); rope([0.0, 1.2, 0], [0.33, 0.8, 0]); rope([-0.36, 0.9, 0], [0.0, 0.7, 0]);
  rope([0.0, 1.2, 0], [-0.36, 0.9, 0]);
  // Jolly Roger at the main truck, streaming aft
  B.set(X.T(0.0, 1.22, 0), OBJ.SHIP).cylinder(0.004, 0.07, 5, C.iron, MAT.METAL);
  B.set(X.I(), OBJ.SHIP);
  B.surface(14, 6, (u, v) => ({ p: [-0.012 - u * 0.26, 1.29 - v * 0.16, 0], c: C.black, e0: u, e1: v }), MAT.FLAG);
  // bow hawse ring
  const hw = shipInfo().hawse;
  B.set(X.T(hw[0], hw[1], 0.0), OBJ.SHIP).sphere(0.012, 6, C.iron, MAT.METAL);
  // a figure: a captain on the quarterdeck
  B.set(X.T(-0.48, SHIP.top(-0.75) - 0.02, 0.03), OBJ.SHIP).cylinder((t) => 0.02 - 0.006 * t, 0.07, 8, hex('#7a1f1f'), MAT.DIFFUSE);
  B.set(X.T(-0.48, SHIP.top(-0.75) + 0.065, 0.03), OBJ.SHIP).sphere(0.016, 7, hex('#e2b48a'), MAT.DIFFUSE);
  B.set(X.mul(X.T(-0.48, SHIP.top(-0.75) + 0.078, 0.03), X.S(1.6, 0.5, 1.2)), OBJ.SHIP).sphere(0.018, 7, C.black, MAT.DIFFUSE);
}

// ---- camp ------------------------------------------------------------------------------
function campfire(B, rand) {
  const { x, z } = PLACES.fire;
  const y = g(x, z);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    lumpy(B, [x + Math.cos(a) * 0.085, y + 0.008, z + Math.sin(a) * 0.085], 0.024, mix3(C.rock, C.rockDark, rand()), MAT.ROCK, i * 3, 0.75);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const foot = [x + Math.cos(a) * 0.055, y, z + Math.sin(a) * 0.055];
    B.set(X.I()).tube([foot, [x, y + 0.11, z]], 0.011, 6, C.woodDark, MAT.EMBER, { e0: (t) => 1 - t, colorFn: (t) => mix3(hex('#2a1a10'), C.wood, t) });
  }
  // tripod + pot
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.9;
    B.set(X.I()).tube([[x + Math.cos(a) * 0.13, y, z + Math.sin(a) * 0.13], [x, y + 0.24, z]], 0.005, 5, C.woodDark, MAT.WOOD);
  }
  B.set(X.mul(X.T(x, y + 0.155, z), X.S(1, 0.85, 1))).sphere(0.04, 9, C.iron, MAT.METAL);
  B.set(X.I()).tube([[x, y + 0.24, z], [x, y + 0.19, z]], 0.002, 4, C.iron, MAT.METAL);
  // seating logs
  for (const [a, r] of [[2.6, 0.22], [-0.9, 0.24]]) {
    const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r, ta = a + Math.PI / 2;
    const d = [Math.cos(ta) * 0.12, 0, Math.sin(ta) * 0.12];
    const yy = g(cx, cz) + 0.028;
    B.set(X.I()).tube([[cx - d[0], yy, cz - d[2]], [cx + d[0], yy, cz + d[2]]], 0.03, 10, hex('#6b4426'), MAT.WOOD, { colorFn: (t, u) => mix3(hex('#5a3820'), hex('#7a5232'), (Math.sin(u * 40) * 0.5 + 0.5) * 0.5) });
  }
}

export function chestInfo() {
  const { x, z, yaw } = PLACES.chest;
  return { x, z, yaw, y: g(x, z) - 0.005, w: 0.21, h: 0.11, d: 0.13 };
}

function chest(B, rand) {
  const ci = chestInfo();
  const T0 = X.mul(X.T(ci.x, ci.y, ci.z), X.RY(ci.yaw));
  const wood = hex('#6a3a1e');
  B.set(X.mul(T0, X.T(0, ci.h / 2, 0))).box(ci.w, ci.h, ci.d, wood, MAT.WOOD);
  for (const bx of [-0.075, 0.075]) { B.set(X.mul(T0, X.T(bx, ci.h / 2, 0))).box(0.014, ci.h + 0.004, ci.d + 0.006, C.iron, MAT.METAL); }
  B.set(X.mul(T0, X.T(0, 0.012, 0))).box(ci.w + 0.006, 0.012, ci.d + 0.006, C.iron, MAT.METAL);
  B.set(X.mul(T0, X.T(0, ci.h - 0.022, ci.d / 2 + 0.004))).box(0.03, 0.035, 0.006, C.gold, MAT.GOLD);
  // the heap of gold inside (only seen when the lid is open)
  for (let i = 0; i < 46; i++) {
    const px = (rand() - 0.5) * (ci.w - 0.03), pz = (rand() - 0.5) * (ci.d - 0.03);
    const py = ci.h - 0.01 + 0.03 * (1 - Math.hypot(px / 0.1, pz / 0.06)) + rand() * 0.008;
    B.set(X.mul(T0, X.T(px, py, pz), X.RX((rand() - 0.5) * 1.2), X.RZ((rand() - 0.5) * 1.2))).cylinder(0.014, 0.004, 10, C.gold, MAT.GOLD);
  }
  const gems = ['#e8203a', '#18b06b', '#2f6bff', '#b04cff'].map(hex);
  for (let i = 0; i < 9; i++) {
    const px = (rand() - 0.5) * (ci.w - 0.05), pz = (rand() - 0.5) * (ci.d - 0.05);
    B.set(X.mul(T0, X.T(px, ci.h + 0.02, pz), X.RY(rand() * 3))).sphere(0.011, 2, gems[i % 4], MAT.GEM);
  }
  // the lid, on its own object so it can swing (built in hinge space)
  B.set(X.I(), OBJ.LID);
  const r = ci.d / 2;
  B.surface(12, 8, (u, v) => {
    const a = Math.PI * (1 - v);
    return { p: [(u - 0.5) * ci.w, Math.sin(a) * r * 0.75, r + Math.cos(a) * r], c: wood };
  }, MAT.WOOD, { flip: true });
  for (const side of [-1, 1]) {
    B.surface(8, 1, (u, v) => { const a = Math.PI * (1 - u); return { p: [side * ci.w / 2, Math.sin(a) * r * 0.75 * v, r + Math.cos(a) * r * v], c: wood }; }, MAT.WOOD, { flip: side > 0 });
  }
  for (const bx of [-0.075, 0.075]) {
    B.surface(10, 1, (u, v) => { const a = Math.PI * (1 - u); return { p: [bx + (v - 0.5) * 0.014, Math.sin(a) * r * 0.75 + 0.002, r + Math.cos(a) * (r + 0.002)], c: C.iron }; }, MAT.METAL, { flip: true });
  }
}

function props(B, rand) {
  // shovel in a sand heap
  {
    const { x, z } = PLACES.shovel, y = g(x, z);
    lumpy(B, [x, y - 0.01, z], 0.085, hex('#e2c98f'), MAT.DIFFUSE, 4, 0.42);
    const T0 = X.mul(X.T(x + 0.01, y + 0.02, z), X.RY(0.4), X.RZ(-0.45));
    B.set(T0).cylinder(0.008, 0.3, 6, hex('#8a5a32'), MAT.WOOD);
    B.set(X.mul(T0, X.T(0, 0.3, 0))).box(0.05, 0.012, 0.012, hex('#8a5a32'), MAT.WOOD);
    B.set(X.mul(T0, X.T(0, -0.02, 0))).box(0.062, 0.075, 0.005, hex('#6e6e72'), MAT.METAL);
  }
  // barrels
  const barrelProfile = [[0.0, 0], [0.048, 0], [0.056, 0.04], [0.06, 0.075], [0.056, 0.11], [0.048, 0.15], [0.0, 0.15]];
  const barrelColor = (u, v, y) => (Math.abs(y - 0.02) < 0.008 || Math.abs(y - 0.13) < 0.008 || Math.abs(y - 0.06) < 0.005 || Math.abs(y - 0.09) < 0.005 ? C.iron : mix3(hex('#7d4e2a'), hex('#5e3a1e'), (Math.sin(u * 90) * 0.5 + 0.5) * 0.4));
  for (const [x, z] of PLACES.barrels) { B.set(X.T(x, g(x, z) - 0.005, z)).lathe(barrelProfile, 16, C.wood, MAT.WOOD, { colorFn: barrelColor }); }
  // crate
  {
    const { x, z, yaw } = PLACES.crate, y = g(x, z);
    const T0 = X.mul(X.T(x, y + 0.06, z), X.RY(yaw));
    B.set(T0).box(0.12, 0.12, 0.12, hex('#a87a46'), MAT.WOOD);
    for (const [sx, sy, sz] of [[0.125, 0.018, 0.125], [0.018, 0.125, 0.125], [0.125, 0.125, 0.018]]) B.set(T0).box(sx, sy, sz, hex('#7a5530'), MAT.WOOD);
  }
  // pyramid of round shot
  {
    const { x, z } = PLACES.shot, y = g(x, z);
    const r = 0.022;
    for (let L = 0; L < 3; L++) {
      const n = 3 - L;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        B.set(X.T(x + (i - (n - 1) / 2) * r * 2, y + r + L * r * 1.42, z + (j - (n - 1) / 2) * r * 2)).sphere(r, 7, C.iron, MAT.METAL);
      }
    }
  }
  // rum bottle
  {
    const { x, z } = PLACES.rum, y = g(x, z) - 0.004;
    const prof = [[0, 0], [0.022, 0], [0.023, 0.06], [0.012, 0.08], [0.008, 0.088], [0.008, 0.115], [0, 0.115]];
    B.set(X.mul(X.T(x, y, z), X.RZ(0.12))).lathe(prof, 14, hex('#1d3a1a'), MAT.GLASS, { colorFn: (u, v, yy) => (yy > 0.02 && yy < 0.045 ? hex('#e8d7a8') : yy > 0.105 ? hex('#a77b4d') : hex('#1d3a1a')) });
  }
  // X scored in the sand
  {
    const { x, z } = PLACES.xmark;
    B.set(X.I());
    for (const a of [0.7, -0.7]) {
      const d = [Math.cos(a), Math.sin(a)], n = [-d[1], d[0]];
      B.surface(10, 1, (u, v) => {
        const px = x + d[0] * (u - 0.5) * 0.2 + n[0] * (v - 0.5) * 0.022, pz = z + d[1] * (u - 0.5) * 0.2 + n[1] * (v - 0.5) * 0.022;
        return { p: [px, g(px, pz) + 0.003, pz], c: hex('#7a2d18') };
      }, MAT.DIFFUSE, { flip: true });
    }
  }
}

/** The rowing boat, pulled up with its bow on the sand. Returns its collider. */
function rowboat(B) {
  // find the shoreline from the cove centre toward the placement
  const dx = PLACES.rowboat.x - COVE.x, dz = PLACES.rowboat.z - COVE.z;
  const dl = Math.hypot(dx, dz);
  let sx = COVE.x, sz = COVE.z;
  for (let t = 0; t < 2; t += 0.01) { sx = COVE.x + (dx / dl) * t; sz = COVE.z + (dz / dl) * t; if (g(sx, sz) > WATER + 0.01) break; }
  // bow points up the beach (away from the cove), stern into the water
  const dir = [dx / dl, dz / dl];
  const bow = [sx + dir[0] * 0.08, sz + dir[1] * 0.08], stern = [sx - dir[0] * 0.32, sz - dir[1] * 0.32];
  const bowY = g(bow[0], bow[1]) + 0.045, sternY = Math.max(WATER + 0.02, g(stern[0], stern[1]) + 0.04);
  const mid = [(bow[0] + stern[0]) / 2, (bowY + sternY) / 2, (bow[1] + stern[1]) / 2];
  const L = Math.hypot(bow[0] - stern[0], bowY - sternY, bow[1] - stern[1]);
  const ax = [(bow[0] - stern[0]) / L, (bowY - sternY) / L, (bow[1] - stern[1]) / L];
  const az = [-ax[2], 0, ax[0]]; const al = Math.hypot(...az); az[0] /= al; az[2] /= al;
  const ay = [az[1] * ax[2] - az[2] * ax[1], az[2] * ax[0] - az[0] * ax[2], az[0] * ax[1] - az[1] * ax[0]];
  const T0 = X.mul(X.B(ax, ay, az, mid), X.RX(0.18));
  B.set(T0);
  const len = 0.42;
  B.surface(16, 20, (u, v) => {
    const s = -1 + v * 2, th = u * Math.PI;
    const b = 0.085 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(s), 2.5))) + (s < 0 ? 0.02 * (1 + s) : 0) * 0;
    const top = 0.045 + 0.02 * s * s, keel = -0.03;
    const y = top - (top - keel) * Math.pow(Math.sin(th), 0.8);
    return { p: [s * len / 2, y, -b * Math.cos(th)], c: top - y < 0.01 ? hex('#d9c28e') : hex('#4f6f7f') };
  }, MAT.WOOD);
  B.surface(16, 20, (u, v) => {
    const s = -0.96 + v * 1.92, th = u * Math.PI;
    const b = 0.078 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(s), 2.5)));
    const top = 0.04 + 0.02 * s * s, keel = -0.022;
    const y = top - (top - keel) * Math.pow(Math.sin(th), 0.8);
    return { p: [s * len / 2, y, -b * Math.cos(th)], c: hex('#9c6a3c') };
  }, MAT.WOOD, { flip: true });
  for (const sx2 of [-0.06, 0.07]) B.set(X.mul(T0, X.T(sx2, 0.03, 0))).box(0.03, 0.008, 0.15, hex('#b0804a'), MAT.WOOD);
  for (const sd of [-1, 1]) {
    B.set(X.mul(T0, X.T(0.02, 0.04, sd * 0.03), X.RZ(Math.PI / 2 + 0.05), X.RX(sd * 0.1))).cylinder(0.005, 0.36, 5, hex('#c19a62'), MAT.WOOD);
    B.set(X.mul(T0, X.T(-0.17, 0.045, sd * 0.03))).box(0.08, 0.004, 0.03, hex('#c19a62'), MAT.WOOD);
  }
  return { type: 'box', xf: T0, half: [len / 2, 0.05, 0.09] };
}

// ---- under the sea ----------------------------------------------------------------------
function wreck(B, rand) {
  const { x, z, yaw } = PLACES.wreck;
  const y = seaFloor(x, z);
  const T0 = X.mul(X.T(x, y + 0.13, z), X.RY(yaw), X.RX(1.35), X.S(0.85));
  const old = hex('#4c3b2b'), algae = hex('#4f6b2a');
  // planks with gaps and a ragged broken end
  const bands = 14;
  for (let k = 0; k < bands; k++) {
    if (k === 4 || k === 9 || k === 10) continue;
    const sEnd = -0.05 - rand() * 0.35;
    B.set(T0);
    B.surface(2, 14, (u, v) => {
      const th = ((k + 0.08 + u * 0.84) / bands) * Math.PI;
      const s = 1 - v * (1 - sEnd);
      const p = hullPoint(s, th);
      return { p, c: mix3(old, algae, smoothstep(0.3, 1.0, noise3(p[0] * 9, p[1] * 9, p[2] * 9 + k))) };
    }, MAT.WOOD);
  }
  // ribs
  for (let s = 0.85; s > -0.45; s -= 0.17) {
    const pts = []; for (let i = 0; i <= 10; i++) pts.push(hullPoint(s, (i / 10) * Math.PI).map((v, j) => (j === 2 ? v * 0.97 : v)));
    B.set(T0).tube(pts, 0.011, 5, hex('#3a2c20'), MAT.WOOD);
  }
  // broken mast beside it
  const mx = x + Math.cos(yaw) * 0.1 + 0.25, mz = z - 0.32;
  B.set(X.mul(X.T(mx, seaFloor(mx, mz) + 0.015, mz), X.RY(yaw + 0.9), X.RZ(Math.PI / 2 - 0.06)));
  B.cylinder((t) => 0.017 * (t > 0.96 ? 0.5 + Math.sin(t * 300) * 0.3 : 1), 0.62, 8, hex('#3d2c1e'), MAT.WOOD);
  return [{ type: 'sphere', c: X.p(T0, [0.3, 0, 0]), r: 0.22 }, { type: 'sphere', c: X.p(T0, [0.0, 0, 0]), r: 0.2 }];
}

function seabed(B, rand) {
  // kelp
  for (let i = 0, n = 0; i < 400 && n < 13; i++) {
    const x = -2.4 + rand() * 4.8, z = -1.0 + rand() * 3.4;
    if (g(x, z) > WATER - 0.55) continue;
    if (Math.hypot(x - PLACES.ship.x, z - PLACES.ship.z) < 0.5) continue;
    n++;
    for (let k = 0; k < 3; k++) {
      const bx = x + (rand() - 0.5) * 0.1, bz = z + (rand() - 0.5) * 0.1;
      const H = 0.3 + rand() * 0.3;
      const a = rand() * 6.28;
      const y0 = g(bx, bz) - 0.01;
      B.set(X.I()).surface(3, 14, (u, v) => {
        const w = 0.028 * (0.4 + Math.sin(Math.PI * Math.min(1, v * 1.2))) * (1 + 0.25 * Math.sin(v * 40));
        const off = (u - 0.5) * w;
        const bend = 0.04 * Math.sin(v * 5 + k);
        return { p: [bx + Math.cos(a) * off + bend, y0 + v * H, bz + Math.sin(a) * off], c: mix3(hex('#4f5d1c'), hex('#8a7a2a'), v), e0: v, e1: k + n * 3 };
      }, MAT.KELP);
    }
  }
  // doubloons lying about
  for (let i = 0; i < 7; i++) {
    const x = PLACES.wreck.x + (rand() - 0.3) * 0.7, z = PLACES.wreck.z + (rand() - 0.6) * 0.5;
    B.set(X.mul(X.T(x, g(x, z) + 0.004, z), X.RX((rand() - 0.5) * 0.3))).cylinder(SIZES.coin, 0.006, 12, C.gold, MAT.GOLD);
  }
  // bubbles caught in the jelly
  for (let i = 0, n = 0; i < 400 && n < 34; i++) {
    const x = -2.4 + rand() * 4.8, z = -2.4 + rand() * 4.8;
    const lo = g(x, z) + 0.06;
    if (lo > WATER - 0.1) continue;
    n++;
    const y = lo + rand() * (WATER - 0.06 - lo);
    B.set(X.T(x, y, z)).sphere(0.006 + rand() * 0.014, 6, hex('#ffffff'), MAT.BUBBLE);
  }
}

export function anchorInfo() {
  const { x, z } = PLACES.anchor;
  const y = seaFloor(x, z);
  const T0 = X.mul(X.T(x, y + 0.02, z), X.RY(0.9), X.RX(Math.PI / 2 - 0.1), X.T(0, -0.15, 0));
  return { T0, ring: X.p(T0, [0, 0.33, 0]) };
}
function anchor(B) {
  const { T0 } = anchorInfo();
  B.set(T0).cylinder(0.013, 0.3, 8, C.iron, MAT.METAL);
  const arm = []; for (let i = 0; i <= 8; i++) { const a = Math.PI * (1.15 + (i / 8) * 0.7); arm.push([Math.cos(a) * 0.13, 0.13 + Math.sin(a) * 0.13, 0]); }
  B.set(T0).tube(arm, 0.012, 6, C.iron, MAT.METAL);
  for (const s of [-1, 1]) B.set(X.mul(T0, X.T(s * 0.12, 0.08, 0), X.RZ(s * 0.5))).box(0.05, 0.06, 0.012, C.iron, MAT.METAL);
  B.set(X.mul(T0, X.T(0, 0.27, -0.12), X.RX(Math.PI / 2))).cylinder(0.008, 0.24, 6, C.iron, MAT.METAL);
  const ring = []; for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI * 2; ring.push([Math.cos(a) * 0.025, 0.33 + Math.sin(a) * 0.025, 0]); }
  B.set(T0).tube(ring, 0.006, 5, C.iron, MAT.METAL);
}

function pools(B) {
  for (let i = 0; i < OBJ.NCHAIN; i++) {
    const ring = []; for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI * 2; ring.push([Math.cos(a) * 0.017, Math.sin(a) * 0.009, 0]); }
    B.set(X.I(), OBJ.CHAIN + i).tube(ring, 0.0042, 5, hex('#3a3632'), MAT.METAL);
  }
  for (let i = 0; i < OBJ.NBALL; i++) B.set(X.I(), OBJ.BALL + i).sphere(SIZES.ball, 9, hex('#26262a'), MAT.METAL);
  const prof = [[0, -0.075], [0.048, -0.075], [0.056, -0.035], [0.06, 0], [0.056, 0.035], [0.048, 0.075], [0, 0.075]];
  for (let i = 0; i < OBJ.NBARREL; i++) {
    B.set(X.I(), OBJ.BARREL + i).lathe(prof, 14, C.wood, MAT.WOOD, { colorFn: (u, v, y) => (Math.abs(Math.abs(y) - 0.055) < 0.008 || Math.abs(y) < 0.005 ? C.iron : mix3(hex('#8a5530'), hex('#5e3a1e'), (Math.sin(u * 90) * 0.5 + 0.5) * 0.4)) });
  }
  for (let i = 0; i < OBJ.NCOIN; i++) B.set(X.T(0, -0.003, 0), OBJ.COIN + i).cylinder(SIZES.coin, 0.006, 12, C.gold, MAT.GOLD);
}

export function buildScene() {
  const rand = mulberry32(2024);
  const B = new Builder();
  const colliders = [];
  const prof = globalThis.__geomProfile ? [] : null;
  let t0 = performance.now();
  const mark = (k) => { if (prof) { const t = performance.now(); prof.push(k + ':' + (t - t0).toFixed(0)); t0 = t; } };
  terrain(B);
  mark('terrain(B);');
  walls(B);
  mark('walls(B);');
  skull(B);
  mark('skull(B);');
  PALMS.forEach((p, i) => palm(B, i, p, rand));
  mark('PALMS.forEach((p, ');
  vegetation(B, rand);
  mark('vegetation(B, rand');
  campfire(B, rand);
  mark('campfire(B, rand);');
  chest(B, rand);
  mark('chest(B, rand);');
  props(B, rand);
  mark('props(B, rand);');
  colliders.push(rowboat(B));
  mark('colliders.push(row');
  colliders.push(...wreck(B, rand));
  mark('colliders.push(...');
  seabed(B, rand);
  mark('seabed(B, rand);');
  anchor(B);
  mark('anchor(B);');
  ship(B, rand);
  mark('ship(B, rand);');
  pools(B);
  mark('pools(B);');
  if (prof) console.log(prof.join(" "));
  // static colliders for the rigid bodies
  const ci = chestInfo();
  colliders.push({ type: 'box', xf: X.mul(X.T(ci.x, ci.y + ci.h / 2, ci.z), X.RY(ci.yaw)), half: [ci.w / 2, ci.h / 2 + 0.03, ci.d / 2] });
  colliders.push({ type: 'sphere', c: [PLACES.fire.x, g(PLACES.fire.x, PLACES.fire.z) + 0.03, PLACES.fire.z], r: 0.1 });
  for (const [x, z] of PLACES.barrels) colliders.push({ type: 'sphere', c: [x, g(x, z) + 0.07, z], r: 0.065 });
  colliders.push({ type: 'box', xf: X.mul(X.T(PLACES.crate.x, g(PLACES.crate.x, PLACES.crate.z) + 0.06, PLACES.crate.z), X.RY(PLACES.crate.yaw)), half: [0.065, 0.065, 0.065] });
  colliders.push({ type: 'sphere', c: [PLACES.shot.x, g(PLACES.shot.x, PLACES.shot.z) + 0.03, PLACES.shot.z], r: 0.07 });
  colliders.push({ type: 'sphere', c: anchorInfo().ring, r: 0.1 });
  return { mesh: B.build(), colliders };
}
