// Builds one jelly piece from its clipped SDF:
//   1. surface-nets render skin on a 0.042 grid, projected onto the field
//   2. volume, centroid and principal frame
//   3. hex lattice in the principal frame, boundary nodes snapped to the surface
//   4. barycentric embedding of every render vertex into a lattice tet
// Written as a generator so it can be spread over several frames.
import { pieceSdf, orangeSdf, PITH, ORANGE_VOLUME } from './orange.js';
import { eigenSym3, m3inv } from './math.js';

export const GRID = 0.042;

// 5-tet split of a hex; corner index = dx + 2*dy + 4*dz. Parity alternates between cells.
const TETS_EVEN = [[1, 2, 4, 7], [0, 1, 2, 4], [3, 1, 2, 7], [5, 1, 4, 7], [6, 2, 4, 7]];
const TETS_ODD = [[0, 3, 5, 6], [1, 0, 3, 5], [2, 0, 3, 6], [4, 0, 5, 6], [7, 3, 5, 6]];

function tetVolume(P, a, b, c, d) {
  const ax = P[b * 3] - P[a * 3], ay = P[b * 3 + 1] - P[a * 3 + 1], az = P[b * 3 + 2] - P[a * 3 + 2];
  const bx = P[c * 3] - P[a * 3], by = P[c * 3 + 1] - P[a * 3 + 1], bz = P[c * 3 + 2] - P[a * 3 + 2];
  const cx = P[d * 3] - P[a * 3], cy = P[d * 3 + 1] - P[a * 3 + 1], cz = P[d * 3 + 2] - P[a * 3 + 2];
  return (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
}

/**
 * planes: flat [nx, ny, nz, c, ...] in rest space.
 * Yields while working; returns the piece data (or {sliver: true}).
 */
export function* buildPiece(planes, opts = {}) {
  const sdf = (x, y, z) => pieceSdf(planes, x, y, z);
  const g = GRID;

  // --- bounds from a coarse pass -------------------------------------------
  const cg = g * 3;
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let z = -1.5; z <= 1.5; z += cg) {
    for (let y = -1.5; y <= 1.5; y += cg) {
      for (let x = -1.4; x <= 1.4; x += cg) {
        if (sdf(x, y, z) < cg) {
          if (x < mn[0]) mn[0] = x; if (y < mn[1]) mn[1] = y; if (z < mn[2]) mn[2] = z;
          if (x > mx[0]) mx[0] = x; if (y > mx[1]) mx[1] = y; if (z > mx[2]) mx[2] = z;
        }
      }
    }
    yield;
  }
  if (mn[0] > mx[0]) return { sliver: true };
  for (let a = 0; a < 3; a++) { mn[a] -= cg; mx[a] += cg; }

  // --- fine field ----------------------------------------------------------
  const nx = Math.ceil((mx[0] - mn[0]) / g) + 1;
  const ny = Math.ceil((mx[1] - mn[1]) / g) + 1;
  const nz = Math.ceil((mx[2] - mn[2]) / g) + 1;
  const F = new Float32Array(nx * ny * nz);
  const idx = (i, j, k) => (k * ny + j) * nx + i;
  let vol = 0, cx = 0, cy = 0, cz = 0;
  const C = [0, 0, 0, 0, 0, 0]; // xx xy xz yy yz zz (raw second moments)
  for (let k = 0; k < nz; k++) {
    const z = mn[2] + k * g;
    for (let j = 0; j < ny; j++) {
      const y = mn[1] + j * g;
      for (let i = 0; i < nx; i++) {
        const x = mn[0] + i * g;
        const d = sdf(x, y, z);
        F[idx(i, j, k)] = d;
        if (d < 0) {
          vol++; cx += x; cy += y; cz += z;
          C[0] += x * x; C[1] += x * y; C[2] += x * z; C[3] += y * y; C[4] += y * z; C[5] += z * z;
        }
      }
    }
    if (k % 3 === 2) yield;
  }
  const cellV = g * g * g;
  const volume = vol * cellV;
  const minVolume = opts.minVolume ?? ORANGE_VOLUME * 0.0035;
  if (volume < minVolume) return { sliver: true, volume };
  cx /= vol; cy /= vol; cz /= vol;
  const cov = [
    C[0] / vol - cx * cx, C[1] / vol - cx * cy, C[2] / vol - cx * cz,
    C[1] / vol - cx * cy, C[3] / vol - cy * cy, C[4] / vol - cy * cz,
    C[2] / vol - cx * cz, C[4] / vol - cy * cz, C[5] / vol - cz * cz,
  ];
  const eig = eigenSym3(cov);
  // a thin piece is a sliver
  const minStd = Math.sqrt(Math.max(0, Math.min(...eig.values)));
  if (minStd < (opts.minThickness ?? 0.045)) return { sliver: true, volume };
  // principal axes as columns of E (row-major); make it right-handed
  const E = eig.vectors.slice();
  const e0 = [E[0], E[3], E[6]], e1 = [E[1], E[4], E[7]];
  const e2 = [e0[1] * e1[2] - e0[2] * e1[1], e0[2] * e1[0] - e0[0] * e1[2], e0[0] * e1[1] - e0[1] * e1[0]];
  E[2] = e2[0]; E[5] = e2[1]; E[8] = e2[2];

  // --- surface nets ----------------------------------------------------------
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * nz).fill(-1);
  const cidx = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i;
  const verts = [];
  const corner = new Float32Array(8);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = F[idx(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a], vb = corner[b];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          sx += (a & 1) + t * ((b & 1) - (a & 1));
          sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
          sz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1));
          n++;
        }
        cellVert[cidx(i, j, k)] = verts.length / 3;
        verts.push(mn[0] + (i + sx / n) * g, mn[1] + (j + sy / n) * g, mn[2] + (k + sz / n) * g);
      }
    }
    if (k % 4 === 3) yield;
  }
  const tris = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) { const t = b; b = d; d = t; }
    tris.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const v0 = F[idx(i, j, k)];
        const in0 = v0 < 0;
        // x edge
        if (i < nx - 1 && in0 !== (F[idx(i + 1, j, k)] < 0)) {
          quad(cellVert[cidx(i, j, k)], cellVert[cidx(i, j - 1, k)], cellVert[cidx(i, j - 1, k - 1)], cellVert[cidx(i, j, k - 1)], !in0);
        }
        if (j < ny - 1 && in0 !== (F[idx(i, j + 1, k)] < 0)) {
          quad(cellVert[cidx(i, j, k)], cellVert[cidx(i, j, k - 1)], cellVert[cidx(i - 1, j, k - 1)], cellVert[cidx(i - 1, j, k)], !in0);
        }
        if (k < nz - 1 && in0 !== (F[idx(i, j, k + 1)] < 0)) {
          quad(cellVert[cidx(i, j, k)], cellVert[cidx(i - 1, j, k)], cellVert[cidx(i - 1, j - 1, k)], cellVert[cidx(i, j - 1, k)], !in0);
        }
      }
    }
    if (k % 6 === 5) yield;
  }

  // project onto the field, compute normals
  const nv = verts.length / 3;
  const pos = new Float32Array(verts);
  const nrm = new Float32Array(nv * 3);
  const e = 0.0025;
  for (let v = 0; v < nv; v++) {
    let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    let gx = 0, gy = 0, gz = 1;
    for (let it = 0; it < 3; it++) {
      const d = sdf(x, y, z);
      gx = (sdf(x + e, y, z) - sdf(x - e, y, z)) / (2 * e);
      gy = (sdf(x, y + e, z) - sdf(x, y - e, z)) / (2 * e);
      gz = (sdf(x, y, z + e) - sdf(x, y, z - e)) / (2 * e);
      const l2 = gx * gx + gy * gy + gz * gz;
      if (l2 < 1e-8) break;
      let s = d / l2;
      s = Math.max(-g, Math.min(g, s));
      x -= gx * s; y -= gy * s; z -= gz * s;
      if (Math.abs(d) < 1e-5) break;
    }
    const l = Math.hypot(gx, gy, gz) || 1;
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    nrm[v * 3] = gx / l; nrm[v * 3 + 1] = gy / l; nrm[v * 3 + 2] = gz / l;
    if (v % 3000 === 2999) yield;
  }
  const index = new Uint32Array(tris);

  // --- hex lattice in the principal frame -------------------------------------
  const frac = volume / ORANGE_VOLUME;
  const targetCells = (opts.cellBudget ?? 600) * frac + 22;
  const h = Math.max(0.085, Math.min(0.235, Math.cbrt(volume / targetCells)));
  // extents of the inside points in frame coordinates
  const toFrame = (x, y, z, out) => {
    const dx = x - cx, dy = y - cy, dz = z - cz;
    out[0] = E[0] * dx + E[3] * dy + E[6] * dz;
    out[1] = E[1] * dx + E[4] * dy + E[7] * dz;
    out[2] = E[2] * dx + E[5] * dy + E[8] * dz;
    return out;
  };
  const fromFrame = (a, b, c, out) => {
    out[0] = cx + E[0] * a + E[1] * b + E[2] * c;
    out[1] = cy + E[3] * a + E[4] * b + E[5] * c;
    out[2] = cz + E[6] * a + E[7] * b + E[8] * c;
    return out;
  };
  const fmn = [1e9, 1e9, 1e9], fmx = [-1e9, -1e9, -1e9], tmp = [0, 0, 0];
  for (let v = 0; v < nv; v++) {
    toFrame(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], tmp);
    for (let a = 0; a < 3; a++) { if (tmp[a] < fmn[a]) fmn[a] = tmp[a]; if (tmp[a] > fmx[a]) fmx[a] = tmp[a]; }
  }
  const lo = [0, 0, 0], dims = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const n = Math.max(1, Math.ceil((fmx[a] - fmn[a]) / h));
    dims[a] = n;
    lo[a] = (fmn[a] + fmx[a]) / 2 - (n * h) / 2;
  }
  const [cnx, cny, cnz] = dims;
  const cellId = new Int32Array(cnx * cny * cnz).fill(-1);
  const cells = [];
  const cellFrac = [];
  const p = [0, 0, 0];
  for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) {
    fromFrame(lo[0] + (i + 0.5) * h, lo[1] + (j + 0.5) * h, lo[2] + (k + 0.5) * h, p);
    if (sdf(p[0], p[1], p[2]) > h * 0.42) continue;
    // inside fraction from 3^3 sub-samples
    let inside = 0;
    for (let s = 0; s < 27; s++) {
      fromFrame(lo[0] + (i + ((s % 3) + 0.5) / 3) * h, lo[1] + (j + ((((s / 3) | 0) % 3) + 0.5) / 3) * h, lo[2] + (k + (((s / 9) | 0) + 0.5) / 3) * h, p);
      if (sdf(p[0], p[1], p[2]) < 0) inside++;
    }
    if (inside === 0) continue;
    cellId[(k * cny + j) * cnx + i] = cells.length;
    cells.push([i, j, k]);
    cellFrac.push(inside / 27);
  }
  yield;
  if (cells.length < (opts.minCells ?? 3)) return { sliver: true, volume };

  // nodes
  const nodeMap = new Map();
  const nodeGrid = [];
  const cellNodes = new Int32Array(cells.length * 8);
  cells.forEach(([i, j, k], c) => {
    for (let q = 0; q < 8; q++) {
      const key = (i + (q & 1)) + (j + ((q >> 1) & 1)) * 4096 + (k + ((q >> 2) & 1)) * 16777216;
      let id = nodeMap.get(key);
      if (id === undefined) {
        id = nodeGrid.length;
        nodeMap.set(key, id);
        nodeGrid.push([i + (q & 1), j + ((q >> 1) & 1), k + ((q >> 2) & 1)]);
      }
      cellNodes[c * 8 + q] = id;
    }
  });
  const nn = nodeGrid.length;
  const gridPos = new Float32Array(nn * 3);
  const restPos = new Float32Array(nn * 3);
  for (let n = 0; n < nn; n++) {
    const [i, j, k] = nodeGrid[n];
    fromFrame(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h, p);
    gridPos.set(p, n * 3);
    restPos.set(p, n * 3);
  }
  // snap boundary nodes onto the surface
  const nodeSdf = new Float32Array(nn);
  for (let n = 0; n < nn; n++) {
    let x = restPos[n * 3], y = restPos[n * 3 + 1], z = restPos[n * 3 + 2];
    let d = sdf(x, y, z);
    nodeSdf[n] = d;
    if (d <= 0) continue;
    for (let it = 0; it < 8 && d > 1e-4; it++) {
      const gx = (sdf(x + e, y, z) - sdf(x - e, y, z)) / (2 * e);
      const gy = (sdf(x, y + e, z) - sdf(x, y - e, z)) / (2 * e);
      const gz = (sdf(x, y, z + e) - sdf(x, y, z - e)) / (2 * e);
      const l2 = gx * gx + gy * gy + gz * gz || 1;
      x -= (gx * d) / l2; y -= (gy * d) / l2; z -= (gz * d) / l2;
      d = sdf(x, y, z);
    }
    restPos[n * 3] = x; restPos[n * 3 + 1] = y; restPos[n * 3 + 2] = z;
  }
  // tets; undo snapping that squashes a tet
  const tets = new Int32Array(cells.length * 20);
  const ideal = (h * h * h) / 6;
  cells.forEach(([i, j, k], c) => {
    const T = (i + j + k) % 2 === 0 ? TETS_EVEN : TETS_ODD;
    for (let t = 0; t < 5; t++) for (let q = 0; q < 4; q++) tets[c * 20 + t * 4 + q] = cellNodes[c * 8 + T[t][q]];
  });
  // orient tets positively
  const ntet = tets.length / 4;
  const tetRestVol = new Float32Array(ntet);
  const tetWeak = new Uint8Array(ntet); // squashed by snapping: no volume constraint, last choice for embedding
  for (let t = 0; t < ntet; t++) {
    const g0 = tetVolume(gridPos, tets[t * 4], tets[t * 4 + 1], tets[t * 4 + 2], tets[t * 4 + 3]);
    let v = tetVolume(restPos, tets[t * 4], tets[t * 4 + 1], tets[t * 4 + 2], tets[t * 4 + 3]);
    if (v * Math.sign(g0) < Math.abs(g0) * 0.12) tetWeak[t] = 1;
    if (v < 0) { const s = tets[t * 4 + 1]; tets[t * 4 + 1] = tets[t * 4 + 2]; tets[t * 4 + 2] = s; v = -v; }
    tetRestVol[t] = Math.max(v, ideal * 0.02);
  }
  // masses (unit density = volume units) and firmness (zest + pith are firmer)
  const mass = new Float32Array(nn);
  const cellFirm = new Float32Array(cells.length);
  cells.forEach(([i, j, k], c) => {
    const m = cellFrac[c] * h * h * h;
    for (let q = 0; q < 8; q++) mass[cellNodes[c * 8 + q]] += m / 8;
    fromFrame(lo[0] + (i + 0.5) * h, lo[1] + (j + 0.5) * h, lo[2] + (k + 0.5) * h, p);
    const depth = -orangeSdf(p[0], p[1], p[2]);
    cellFirm[c] = depth < PITH + h * 0.3 ? 1 : 0;
  });
  // scale so the lattice carries the piece's true volume worth of mass
  let msum = 0;
  for (let n = 0; n < nn; n++) msum += mass[n];
  for (let n = 0; n < nn; n++) mass[n] = Math.max(mass[n] * (volume / msum), 1e-5);
  // boundary nodes (for piece-piece contact)
  const boundary = [];
  for (let n = 0; n < nn; n++) {
    if (sdf(restPos[n * 3], restPos[n * 3 + 1], restPos[n * 3 + 2]) > -h * 0.55) boundary.push(n);
  }
  // unique lattice edges (for damping + "show mesh")
  const edgeSet = new Set();
  const edges = [];
  const HEX_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let c = 0; c < cells.length; c++) {
    for (const [a, b] of HEX_EDGES) {
      const u = cellNodes[c * 8 + a], w = cellNodes[c * 8 + b];
      const key = u < w ? u * 1048576 + w : w * 1048576 + u;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      edges.push(u, w);
    }
  }
  yield;

  const lattice = {
    h, E, origin: [cx, cy, cz], lo, dims, cellId, cells: cellNodes, cellFirm, cellCount: cells.length,
    cellGrid: cells, restPos, mass, tets, tetRestVol, tetWeak, boundary: Int32Array.from(boundary), edges: Uint32Array.from(edges),
  };
  lattice.dmInv = computeDmInv(lattice);

  // --- embed render vertices --------------------------------------------------
  const embTet = new Uint32Array(nv * 4);
  const embBary = new Float32Array(nv * 4);
  const embDm = new Float32Array(nv * 9);
  const loc = { tet: 0, bary: [0, 0, 0, 0] };
  for (let v = 0; v < nv; v++) {
    locate(lattice, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], loc);
    for (let q = 0; q < 4; q++) {
      embTet[v * 4 + q] = tets[loc.tet * 4 + q];
      embBary[v * 4 + q] = loc.bary[q];
    }
    embDm.set(lattice.dmInv.subarray(loc.tet * 9, loc.tet * 9 + 9), v * 9);
    if (v % 4000 === 3999) yield;
  }

  return {
    sliver: false,
    planes: planes.slice(),
    volume,
    centroid: [cx, cy, cz],
    mesh: { pos, nrm, index, embTet, embBary, embDm },
    lattice,
  };
}

function computeDmInv(L) {
  const { tets, restPos: P } = L;
  const ntet = tets.length / 4;
  const out = new Float32Array(ntet * 9);
  for (let t = 0; t < ntet; t++) {
    const a = tets[t * 4], b = tets[t * 4 + 1], c = tets[t * 4 + 2], d = tets[t * 4 + 3];
    // Dm columns = edges (row-major storage)
    const Dm = [
      P[b * 3] - P[a * 3], P[c * 3] - P[a * 3], P[d * 3] - P[a * 3],
      P[b * 3 + 1] - P[a * 3 + 1], P[c * 3 + 1] - P[a * 3 + 1], P[d * 3 + 1] - P[a * 3 + 1],
      P[b * 3 + 2] - P[a * 3 + 2], P[c * 3 + 2] - P[a * 3 + 2], P[d * 3 + 2] - P[a * 3 + 2],
    ];
    const inv = m3inv(Dm) || [1, 0, 0, 0, 1, 0, 0, 0, 1];
    out.set(inv, t * 9);
  }
  return out;
}

/** Find the lattice tet (and barycentric weights) that best contains rest point (x,y,z). */
export function locate(L, x, y, z, out) {
  const { h, E, origin, lo, dims, cellId, tets, restPos: P } = L;
  const dx = x - origin[0], dy = y - origin[1], dz = z - origin[2];
  const fa = (E[0] * dx + E[3] * dy + E[6] * dz - lo[0]) / h;
  const fb = (E[1] * dx + E[4] * dy + E[7] * dz - lo[1]) / h;
  const fc = (E[2] * dx + E[5] * dy + E[8] * dz - lo[2]) / h;
  const ci = Math.floor(fa), cj = Math.floor(fb), ck = Math.floor(fc);
  let best = -1, bestScore = -Infinity;
  const bary = [0, 0, 0, 0];
  const weak = L.tetWeak;
  let allowWeak = false;
  const tryCell = (c) => {
    for (let t = 0; t < 5; t++) {
      const ti = c * 5 + t;
      if (weak && weak[ti] && !allowWeak) continue;
      baryOf(P, tets, ti, x, y, z, bary);
      const s = Math.min(bary[0], bary[1], bary[2], bary[3]);
      if (s > bestScore) { bestScore = s; best = ti; out.bary[0] = bary[0]; out.bary[1] = bary[1]; out.bary[2] = bary[2]; out.bary[3] = bary[3]; }
    }
  };
  for (let r = 0; r <= 3 && bestScore < -1e-4; r++) {
    for (let k = ck - r; k <= ck + r; k++) for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(k - ck)) !== r) continue;
      if (i < 0 || j < 0 || k < 0 || i >= dims[0] || j >= dims[1] || k >= dims[2]) continue;
      const c = cellId[(k * dims[1] + j) * dims[0] + i];
      if (c >= 0) tryCell(c);
    }
    if (best >= 0 && r >= 1) break;
  }
  if (best < 0 && weak) {
    allowWeak = true;
    for (let k = ck - 1; k <= ck + 1; k++) for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      if (i < 0 || j < 0 || k < 0 || i >= dims[0] || j >= dims[1] || k >= dims[2]) continue;
      const c = cellId[(k * dims[1] + j) * dims[0] + i];
      if (c >= 0) tryCell(c);
    }
  }
  if (best < 0) {
    // fall back to the nearest node's first tet
    let bd = Infinity, bn = 0;
    for (let n = 0; n < P.length / 3; n++) {
      const d = (P[n * 3] - x) ** 2 + (P[n * 3 + 1] - y) ** 2 + (P[n * 3 + 2] - z) ** 2;
      if (d < bd) { bd = d; bn = n; }
    }
    for (let t = 0; t < tets.length / 4; t++) {
      if (tets[t * 4] === bn || tets[t * 4 + 1] === bn || tets[t * 4 + 2] === bn || tets[t * 4 + 3] === bn) {
        best = t; baryOf(P, tets, t, x, y, z, out.bary); break;
      }
    }
  }
  out.tet = best;
  return out;
}

function baryOf(P, tets, t, x, y, z, out) {
  const a = tets[t * 4] * 3, b = tets[t * 4 + 1] * 3, c = tets[t * 4 + 2] * 3, d = tets[t * 4 + 3] * 3;
  const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
  const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
  const e3x = P[d] - P[a], e3y = P[d + 1] - P[a + 1], e3z = P[d + 2] - P[a + 2];
  const px = x - P[a], py = y - P[a + 1], pz = z - P[a + 2];
  const det = e1x * (e2y * e3z - e2z * e3y) - e1y * (e2x * e3z - e2z * e3x) + e1z * (e2x * e3y - e2y * e3x);
  if (Math.abs(det) < 1e-12) { out[0] = 1; out[1] = out[2] = out[3] = -1; return out; }
  const id = 1 / det;
  const u = (px * (e2y * e3z - e2z * e3y) - py * (e2x * e3z - e2z * e3x) + pz * (e2x * e3y - e2y * e3x)) * id;
  const v = (e1x * (py * e3z - pz * e3y) - e1y * (px * e3z - pz * e3x) + e1z * (px * e3y - py * e3x)) * id;
  const w = (e1x * (e2y * pz - e2z * py) - e1y * (e2x * pz - e2z * px) + e1z * (e2x * py - e2y * px)) * id;
  out[0] = 1 - u - v - w; out[1] = u; out[2] = v; out[3] = w;
  return out;
}

/** Run a generator to completion synchronously. */
export function runSync(gen) {
  let r;
  do { r = gen.next(); } while (!r.done);
  return r.value;
}
