// A small voxel engine: a dense grid of palette indices and a mesher that emits only exposed faces,
// with ambient occlusion baked into the vertex colours and a per-face uv for crisp voxel edges.
import * as THREE from 'three';

/** Palette: name -> { index, color (linear), mat, jitter } */
export class Palette {
  constructor() { this.list = [null]; this.byName = {}; }
  add(name, hex, mat = 'solid', jitter = 0.05) {
    const c = new THREE.Color(hex);
    this.byName[name] = this.list.length;
    this.list.push({ name, r: c.r, g: c.g, b: c.b, mat, jitter });
    return this.byName[name];
  }
  get(name) { const i = this.byName[name]; if (i == null) throw new Error('no colour ' + name); return i; }
}

export class Grid {
  constructor(min, max) {
    this.min = min; this.sx = max[0] - min[0] + 1; this.sy = max[1] - min[1] + 1; this.sz = max[2] - min[2] + 1;
    this.data = new Uint16Array(this.sx * this.sy * this.sz);
  }
  i(x, y, z) { return ((x - this.min[0]) * this.sy + (y - this.min[1])) * this.sz + (z - this.min[2]); }
  inside(x, y, z) { return x >= this.min[0] && y >= this.min[1] && z >= this.min[2] && x < this.min[0] + this.sx && y < this.min[1] + this.sy && z < this.min[2] + this.sz; }
  get(x, y, z) { return this.inside(x, y, z) ? this.data[this.i(x, y, z)] : 0; }
  set(x, y, z, c) { x = Math.round(x); y = Math.round(y); z = Math.round(z); if (this.inside(x, y, z)) this.data[this.i(x, y, z)] = c; }
  /** set only where empty */
  put(x, y, z, c) { x = Math.round(x); y = Math.round(y); z = Math.round(z); if (this.inside(x, y, z) && !this.data[this.i(x, y, z)]) this.data[this.i(x, y, z)] = c; }
  box(x0, y0, z0, x1, y1, z1, c) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.set(x, y, z, c);
  }
  sphere(cx, cy, cz, r, c, onlyEmpty = false, sy = 1) {
    const R = Math.ceil(r);
    for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) {
      if (x * x + (y / sy) * (y / sy) + z * z <= r * r) (onlyEmpty ? this.put : this.set).call(this, cx + x, cy + y, cz + z, typeof c === 'function' ? c(x, y, z) : c);
    }
  }
}

export const hash3 = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295; };

// faces: normal and the four corners, counter-clockwise seen from outside
const FACES = [
  { n: [1, 0, 0], u: 2, v: 1, c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], u: 2, v: 1, c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], u: 0, v: 2, c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], u: 0, v: 2, c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], u: 0, v: 1, c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], u: 0, v: 1, c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];
const AO = [0.48, 0.66, 0.83, 1.0];
const MATS = ['solid', 'leaf', 'glow', 'gold', 'water'];

/**
 * Mesh a grid. Returns { solid, leaf, glow, gold, water } BufferGeometries (null when empty).
 * Faces between two voxels are culled unless one of them is water (which is see-through).
 */
export function meshGrid(grid, pal, opts = {}) {
  const { offset = [0, 0, 0], aoStrength = 1 } = opts;
  const out = {}; for (const m of MATS) out[m] = { p: [], n: [], c: [], uv: [], idx: [], sway: [] };
  const { sx, sy, sz, min, data } = grid;
  const L = pal.list;
  const solidAt = (x, y, z) => { const v = grid.get(x, y, z); return v !== 0 && L[v].mat !== 'water'; };
  for (let ix = 0; ix < sx; ix++) for (let iy = 0; iy < sy; iy++) for (let iz = 0; iz < sz; iz++) {
    const v = data[(ix * sy + iy) * sz + iz];
    if (!v) continue;
    const x = ix + min[0], y = iy + min[1], z = iz + min[2];
    const P = L[v], isWater = P.mat === 'water';
    const B = out[P.mat];
    const j = 1 + (hash3(x, y, z) - 0.5) * 2 * P.jitter;
    for (const F of FACES) {
      const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
      const w = grid.get(nx, ny, nz);
      // cull faces between voxels that move together; keep them where one sways and the other does not
      if (w) { const Wm = L[w].mat; if (isWater || (Wm !== 'water' && (Wm === 'leaf') === (P.mat === 'leaf'))) continue; }
      // corner occlusion from the three voxels around each corner, one step out from the face
      const ao = [];
      for (const c of F.c) {
        const du = [0, 0, 0], dv = [0, 0, 0];
        du[F.u] = c[F.u] ? 1 : -1; dv[F.v] = c[F.v] ? 1 : -1;
        let a = 3;
        if (!isWater) {
          const s1 = solidAt(nx + du[0], ny + du[1], nz + du[2]) ? 1 : 0;
          const s2 = solidAt(nx + dv[0], ny + dv[1], nz + dv[2]) ? 1 : 0;
          const cc = solidAt(nx + du[0] + dv[0], ny + du[1] + dv[1], nz + du[2] + dv[2]) ? 1 : 0;
          a = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
        }
        ao.push(a);
      }
      const base = B.p.length / 3;
      F.c.forEach((c, k) => {
        B.p.push(x + c[0] + offset[0], y + c[1] + offset[1], z + c[2] + offset[2]);
        B.n.push(F.n[0], F.n[1], F.n[2]);
        const f = (1 - aoStrength) + aoStrength * AO[ao[k]];
        B.c.push(P.r * j * f, P.g * j * f, P.b * j * f);
        B.uv.push(k === 1 || k === 2 ? 1 : 0, k === 2 || k === 3 ? 1 : 0);
        B.sway.push(y + c[1]);
      });
      if (ao[0] + ao[2] > ao[1] + ao[3]) B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else B.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    }
  }
  const res = {};
  for (const m of MATS) {
    const B = out[m];
    if (!B.idx.length) { res[m] = null; continue; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
    g.setAttribute('fuv', new THREE.Float32BufferAttribute(B.uv, 2));
    g.setIndex(B.idx.length > 65535 ? new THREE.Uint32BufferAttribute(B.idx, 1) : new THREE.Uint16BufferAttribute(B.idx, 1));
    g.computeBoundingSphere();
    res[m] = g;
  }
  return res;
}

/** for tests: check the winding of every face */
export function _checkFaces() {
  return FACES.map((F) => {
    const [a, b, c] = F.c;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    return n.join(',') === F.n.join(',');
  });
}
