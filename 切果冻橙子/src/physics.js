// XPBD jelly: per-piece hex lattices with co-rotational shape matching + tet volume constraints,
// edge + deformation damping, floor contact with Coulomb friction, piece-piece contact against
// each other's exact rest shape (in a best-fit frame), sleeping, and a knife collider.
import { extractRotation, m3tmulv, m3mulv } from './math.js';
import { pieceSdf } from './orange.js';
import { locate } from './mesher.js';

export const STEP = 1 / 60;
export const UNIT_CM = 3; // 1 unit = 3 cm
export const DENSITY = 1.3; // g / cm^3
export const GRAMS_PER_UNIT3 = UNIT_CM ** 3 * DENSITY;

let nextId = 1;

export class Body {
  constructor(piece, x, v) {
    this.id = nextId++;
    this.piece = piece;
    const L = piece.lattice;
    this.L = L;
    this.n = L.restPos.length / 3;
    this.x = Float32Array.from(x);
    this.v = v ? Float32Array.from(v) : new Float32Array(this.n * 3);
    this.p = new Float32Array(this.n * 3);
    this.w = new Float32Array(this.n);
    this.m = L.mass;
    let M = 0;
    for (let i = 0; i < this.n; i++) { this.w[i] = 1 / L.mass[i]; M += L.mass[i]; }
    this.M = M;
    // shape-matching rest offsets per cell (equal weights)
    const nc = L.cellCount;
    this.cellQ = new Float32Array(nc * 4);
    this.cellRest = new Float32Array(nc * 24);
    // mass-weighted, so shape matching conserves linear and angular momentum
    this.cellInvM = new Float32Array(nc);
    for (let c = 0; c < nc; c++) {
      let sx = 0, sy = 0, sz = 0, cm = 0;
      for (let q = 0; q < 8; q++) {
        const n = L.cells[c * 8 + q], mi = L.mass[n];
        sx += mi * L.restPos[n * 3]; sy += mi * L.restPos[n * 3 + 1]; sz += mi * L.restPos[n * 3 + 2]; cm += mi;
      }
      sx /= cm; sy /= cm; sz /= cm;
      this.cellInvM[c] = 1 / cm;
      for (let q = 0; q < 8; q++) {
        const n = L.cells[c * 8 + q];
        this.cellRest[c * 24 + q * 3] = L.restPos[n * 3] - sx;
        this.cellRest[c * 24 + q * 3 + 1] = L.restPos[n * 3 + 1] - sy;
        this.cellRest[c * 24 + q * 3 + 2] = L.restPos[n * 3 + 2] - sz;
      }
      this.cellQ[c * 4 + 3] = 1;
    }
    // whole-body rest centre of mass
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < this.n; i++) { cx += L.mass[i] * L.restPos[i * 3]; cy += L.mass[i] * L.restPos[i * 3 + 1]; cz += L.mass[i] * L.restPos[i * 3 + 2]; }
    this.restCom = [cx / M, cy / M, cz / M];
    this.fitQ = [0, 0, 0, 1];
    this.R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    this.com = [0, 0, 0];
    this.radius = 0;
    this.sleeping = false;
    this.sleepTimer = 0;
    this.onFloor = false;
    this.side = 0; // knife wedge side during a cut
    this.contacts = [];
    this.updateFit();
  }

  /** Best-fit rigid frame: world = R (rest - restCom) + com. */
  updateFit() {
    const { x, m, n } = this, X = this.L.restPos, C = this.restCom;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += m[i] * x[i * 3]; cy += m[i] * x[i * 3 + 1]; cz += m[i] * x[i * 3 + 2]; }
    cx /= this.M; cy /= this.M; cz /= this.M;
    const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    let r2 = 0;
    for (let i = 0; i < n; i++) {
      const px = x[i * 3] - cx, py = x[i * 3 + 1] - cy, pz = x[i * 3 + 2] - cz;
      const qx = X[i * 3] - C[0], qy = X[i * 3 + 1] - C[1], qz = X[i * 3 + 2] - C[2];
      const mi = m[i];
      A[0] += mi * px * qx; A[1] += mi * px * qy; A[2] += mi * px * qz;
      A[3] += mi * py * qx; A[4] += mi * py * qy; A[5] += mi * py * qz;
      A[6] += mi * pz * qx; A[7] += mi * pz * qy; A[8] += mi * pz * qz;
      const d = px * px + py * py + pz * pz;
      if (d > r2) r2 = d;
    }
    const R = extractRotation(A, this.fitQ, 8);
    for (let k = 0; k < 9; k++) this.R[k] = R[k];
    this.com[0] = cx; this.com[1] = cy; this.com[2] = cz;
    this.radius = Math.sqrt(r2) + 0.05;
  }

  worldToRest(p, out = [0, 0, 0]) {
    m3tmulv(this.R, p[0] - this.com[0], p[1] - this.com[1], p[2] - this.com[2], out);
    out[0] += this.restCom[0]; out[1] += this.restCom[1]; out[2] += this.restCom[2];
    return out;
  }
  restToWorld(p, out = [0, 0, 0]) {
    m3mulv(this.R, p[0] - this.restCom[0], p[1] - this.restCom[1], p[2] - this.restCom[2], out);
    out[0] += this.com[0]; out[1] += this.com[1]; out[2] += this.com[2];
    return out;
  }
  restDirToWorld(d, out = [0, 0, 0]) { return m3mulv(this.R, d[0], d[1], d[2], out); }
  worldDirToRest(d, out = [0, 0, 0]) { return m3tmulv(this.R, d[0], d[1], d[2], out); }

  sdfRest(x, y, z) { return pieceSdf(this.piece.planes, x, y, z); }

  wake() { this.sleeping = false; this.sleepTimer = 0; }

  kinetic() {
    let e = 0;
    for (let i = 0; i < this.n; i++) {
      const vx = this.v[i * 3], vy = this.v[i * 3 + 1], vz = this.v[i * 3 + 2];
      e += 0.5 * this.m[i] * (vx * vx + vy * vy + vz * vz);
    }
    return e;
  }

  currentVolume() {
    const { tets } = this.L, x = this.x;
    let v = 0;
    for (let t = 0; t < tets.length; t += 4) {
      const a = tets[t] * 3, b = tets[t + 1] * 3, c = tets[t + 2] * 3, d = tets[t + 3] * 3;
      const e1x = x[b] - x[a], e1y = x[b + 1] - x[a + 1], e1z = x[b + 2] - x[a + 2];
      const e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
      const e3x = x[d] - x[a], e3y = x[d + 1] - x[a + 1], e3z = x[d + 2] - x[a + 2];
      v += (e1x * (e2y * e3z - e2z * e3y) - e1y * (e2x * e3z - e2z * e3x) + e1z * (e2x * e3y - e2y * e3x)) / 6;
    }
    return v;
  }
  restVolume() {
    if (this._rv === undefined) { let s = 0; for (const v of this.L.tetRestVol) s += v; this._rv = s; }
    return this._rv;
  }

  /** Deformed position + velocity at a rest-space point (barycentric in the lattice). */
  sample(restP, outX, outV) {
    const loc = this._loc || (this._loc = { tet: 0, bary: [0, 0, 0, 0] });
    locate(this.L, restP[0], restP[1], restP[2], loc);
    const T = this.L.tets;
    outX[0] = outX[1] = outX[2] = 0;
    if (outV) outV[0] = outV[1] = outV[2] = 0;
    for (let q = 0; q < 4; q++) {
      const n = T[loc.tet * 4 + q], b = loc.bary[q];
      outX[0] += b * this.x[n * 3]; outX[1] += b * this.x[n * 3 + 1]; outX[2] += b * this.x[n * 3 + 2];
      if (outV) { outV[0] += b * this.v[n * 3]; outV[1] += b * this.v[n * 3 + 1]; outV[2] += b * this.v[n * 3 + 2]; }
    }
  }
}

/** Make a body for a fresh (uncut) piece, placed by a rigid offset. */
export function bodyFromRest(piece, offset) {
  const P = piece.lattice.restPos;
  const x = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) { x[i] = P[i] + offset[0]; x[i + 1] = P[i + 1] + offset[1]; x[i + 2] = P[i + 2] + offset[2]; }
  return new Body(piece, x);
}

/** A child piece inherits position and velocity of the jelly it came from. */
export function bodyFromParent(piece, parent) {
  const P = piece.lattice.restPos;
  const n = P.length / 3;
  const x = new Float32Array(n * 3), v = new Float32Array(n * 3);
  const ox = [0, 0, 0], ov = [0, 0, 0], rp = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    rp[0] = P[i * 3]; rp[1] = P[i * 3 + 1]; rp[2] = P[i * 3 + 2];
    parent.sample(rp, ox, ov);
    x.set(ox, i * 3); v.set(ov, i * 3);
  }
  const b = new Body(piece, x, v);
  return b;
}

export class World {
  constructor() {
    this.bodies = [];
    this.gravity = 16;
    this.substeps = 5;
    this.params = { firmness: 0.55, damping: 0.45 };
    this.friction = { static: 0.75, kinetic: 0.55 };
    this.rolling = 3.0;
    this.grab = null;
    this.knife = null; // {n:[x,0,z], c, edgeY, a0, a1, dir, mode:'groove'|'wedge', depth}
    this.acc = 0;
    this.time = 0;
  }

  // ---- stepping --------------------------------------------------------------
  advance(dt) {
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= STEP && n < 2) { this.step(); this.acc -= STEP; n++; }
    if (n >= 2) this.acc = Math.min(this.acc, STEP);
    return n;
  }

  step() {
    const S = this.substeps;
    const h = STEP / S;
    const awake = this.bodies.filter((b) => !b.sleeping);
    for (const b of this.bodies) b.updateFit();
    for (let s = 0; s < S; s++) {
      for (const b of awake) this.integrate(b, h);
      if (this.grab) this.solveGrab(h);
      for (const b of awake) this.solveCells(b, h);
      for (const b of awake) this.solveVolume(b, h);
      if (this.knife) this.solveKnife(h);
      this.solveContacts(awake);
      for (const b of awake) this.solveFloor(b);
      for (const b of awake) this.finishSubstep(b, h);
    }
    for (const b of awake) {
      this.edgeDamping(b, STEP);
      this.deformationDamping(b);
      this.rollingResistance(b);
      this.updateSleep(b);
    }
    this.time += STEP;
  }

  integrate(b, h) {
    const { x, v, p, n } = b;
    const g = this.gravity * h;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      v[k + 1] -= g;
      p[k] = x[k]; p[k + 1] = x[k + 1]; p[k + 2] = x[k + 2];
      x[k] += v[k] * h; x[k + 1] += v[k + 1] * h; x[k + 2] += v[k + 2] * h;
    }
  }

  stiffness() {
    // firmness 0..1 -> shape-matching stiffness k (1/s^2)
    const f = this.params.firmness;
    return 3000 * Math.pow(10, f);
  }

  solveCells(b, h) {
    const L = b.L, x = b.x, cells = L.cells, rest = b.cellRest, Q = b.cellQ, m = b.m, icm = b.cellInvM;
    const kBase = this.stiffness();
    const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const q = [0, 0, 0, 1];
    for (let c = 0; c < L.cellCount; c++) {
      const k = kBase * (L.cellFirm[c] ? 2.6 : 1);
      const kd = k * h * h;
      const s = kd / (1 + kd);
      let cx = 0, cy = 0, cz = 0;
      const o = c * 8;
      for (let j = 0; j < 8; j++) { const ni = cells[o + j], n = ni * 3, mi = m[ni]; cx += mi * x[n]; cy += mi * x[n + 1]; cz += mi * x[n + 2]; }
      const ic = icm[c];
      cx *= ic; cy *= ic; cz *= ic;
      for (let j = 0; j < 9; j++) A[j] = 0;
      for (let j = 0; j < 8; j++) {
        const ni = cells[o + j], n = ni * 3, r = c * 24 + j * 3, mi = m[ni];
        const px = (x[n] - cx) * mi, py = (x[n + 1] - cy) * mi, pz = (x[n + 2] - cz) * mi;
        const qx = rest[r], qy = rest[r + 1], qz = rest[r + 2];
        A[0] += px * qx; A[1] += px * qy; A[2] += px * qz;
        A[3] += py * qx; A[4] += py * qy; A[5] += py * qz;
        A[6] += pz * qx; A[7] += pz * qy; A[8] += pz * qz;
      }
      q[0] = Q[c * 4]; q[1] = Q[c * 4 + 1]; q[2] = Q[c * 4 + 2]; q[3] = Q[c * 4 + 3];
      const R = extractRotation(A, q, 2);
      Q[c * 4] = q[0]; Q[c * 4 + 1] = q[1]; Q[c * 4 + 2] = q[2]; Q[c * 4 + 3] = q[3];
      for (let j = 0; j < 8; j++) {
        const n = cells[o + j] * 3, r = c * 24 + j * 3;
        const qx = rest[r], qy = rest[r + 1], qz = rest[r + 2];
        const gx = cx + R[0] * qx + R[1] * qy + R[2] * qz;
        const gy = cy + R[3] * qx + R[4] * qy + R[5] * qz;
        const gz = cz + R[6] * qx + R[7] * qy + R[8] * qz;
        x[n] += (gx - x[n]) * s; x[n + 1] += (gy - x[n + 1]) * s; x[n + 2] += (gz - x[n + 2]) * s;
      }
    }
  }

  solveVolume(b, h) {
    const { x, w } = b, T = b.L.tets, V0 = b.L.tetRestVol, weak = b.L.tetWeak;
    const alpha = 4e-9 / (h * h);
    for (let t = 0, ti = 0; t < T.length; t += 4, ti++) {
      if (weak[ti]) continue;
      const a = T[t] * 3, bb = T[t + 1] * 3, c = T[t + 2] * 3, d = T[t + 3] * 3;
      const e1x = x[bb] - x[a], e1y = x[bb + 1] - x[a + 1], e1z = x[bb + 2] - x[a + 2];
      const e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
      const e3x = x[d] - x[a], e3y = x[d + 1] - x[a + 1], e3z = x[d + 2] - x[a + 2];
      // gradients (times 6)
      const g1x = e2y * e3z - e2z * e3y, g1y = e2z * e3x - e2x * e3z, g1z = e2x * e3y - e2y * e3x;
      const g2x = e3y * e1z - e3z * e1y, g2y = e3z * e1x - e3x * e1z, g2z = e3x * e1y - e3y * e1x;
      const g3x = e1y * e2z - e1z * e2y, g3y = e1z * e2x - e1x * e2z, g3z = e1x * e2y - e1y * e2x;
      const vol = (e1x * g1x + e1y * g1y + e1z * g1z) / 6;
      const C = vol - V0[ti];
      const g0x = -(g1x + g2x + g3x) / 6, g0y = -(g1y + g2y + g3y) / 6, g0z = -(g1z + g2z + g3z) / 6;
      const wa = w[T[t]], wb = w[T[t + 1]], wc = w[T[t + 2]], wd = w[T[t + 3]];
      const den = wa * (g0x * g0x + g0y * g0y + g0z * g0z)
        + (wb * (g1x * g1x + g1y * g1y + g1z * g1z) + wc * (g2x * g2x + g2y * g2y + g2z * g2z) + wd * (g3x * g3x + g3y * g3y + g3z * g3z)) / 36
        + alpha;
      if (den < 1e-12) continue;
      const l = -C / den;
      x[a] += l * wa * g0x; x[a + 1] += l * wa * g0y; x[a + 2] += l * wa * g0z;
      x[bb] += (l * wb * g1x) / 6; x[bb + 1] += (l * wb * g1y) / 6; x[bb + 2] += (l * wb * g1z) / 6;
      x[c] += (l * wc * g2x) / 6; x[c + 1] += (l * wc * g2y) / 6; x[c + 2] += (l * wc * g2z) / 6;
      x[d] += (l * wd * g3x) / 6; x[d + 1] += (l * wd * g3y) / 6; x[d + 2] += (l * wd * g3z) / 6;
    }
  }

  solveFloor(b) {
    const { x, p, n } = b;
    const mus = this.friction.static, muk = this.friction.kinetic;
    let touching = false;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const pen = -x[k + 1];
      if (pen <= 0) continue;
      touching = true;
      x[k + 1] = 0;
      const dx = x[k] - p[k], dz = x[k + 2] - p[k + 2];
      const dt = Math.hypot(dx, dz);
      if (dt < mus * pen) { x[k] = p[k]; x[k + 2] = p[k + 2]; }
      else if (dt > 0) {
        const f = Math.min(1, (muk * pen) / dt);
        x[k] -= dx * f; x[k + 2] -= dz * f;
      }
    }
    b.onFloor = touching;
  }

  solveContacts(awake) {
    const bodies = this.bodies;
    if (bodies.length < 2) return;
    const rp = [0, 0, 0], gw = [0, 0, 0], tmp = [0, 0, 0];
    const loc = { tet: 0, bary: [0, 0, 0, 0] };
    const margin = 0.0, e = 0.004;
    for (const A of awake) {
      for (const B of bodies) {
        if (A === B) continue;
        const dx = A.com[0] - B.com[0], dy = A.com[1] - B.com[1], dz = A.com[2] - B.com[2];
        const rr = A.radius + B.radius;
        if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
        const bd = A.L.boundary, x = A.x;
        for (let q = 0; q < bd.length; q++) {
          const i = bd[q], k = i * 3;
          // quick reject by distance to B's centre
          const ex = x[k] - B.com[0], ey = x[k + 1] - B.com[1], ez = x[k + 2] - B.com[2];
          if (ex * ex + ey * ey + ez * ez > B.radius * B.radius) continue;
          tmp[0] = x[k]; tmp[1] = x[k + 1]; tmp[2] = x[k + 2];
          B.worldToRest(tmp, rp);
          const d = B.sdfRest(rp[0], rp[1], rp[2]);
          if (d >= margin) continue;
          const gx = B.sdfRest(rp[0] + e, rp[1], rp[2]) - B.sdfRest(rp[0] - e, rp[1], rp[2]);
          const gy = B.sdfRest(rp[0], rp[1] + e, rp[2]) - B.sdfRest(rp[0], rp[1] - e, rp[2]);
          const gz = B.sdfRest(rp[0], rp[1], rp[2] + e) - B.sdfRest(rp[0], rp[1], rp[2] - e);
          const gl = Math.hypot(gx, gy, gz) || 1;
          B.restDirToWorld([gx / gl, gy / gl, gz / gl], gw);
          const push = Math.min(margin - d, 0.05) * 0.8;
          if (B.sleeping && push > 0.02) {
            const sp = Math.hypot(A.v[k], A.v[k + 1], A.v[k + 2]);
            if (sp > 0.35) B.wake();
          }
          const wa = A.w[i];
          locate(B.L, rp[0], rp[1], rp[2], loc);
          let wb = 0;
          for (let t = 0; t < 4; t++) { const bb = Math.max(0, loc.bary[t]); wb += bb * bb * B.w[B.L.tets[loc.tet * 4 + t]]; }
          const sum = wa + wb || 1;
          const sa = (push * wa) / sum, sb = (push * wb) / sum;
          x[k] += gw[0] * sa; x[k + 1] += gw[1] * sa; x[k + 2] += gw[2] * sa;
          if (B.sleeping) {
            // a resting piece is a static obstacle: the moving one takes the full push
            x[k] += gw[0] * sb; x[k + 1] += gw[1] * sb; x[k + 2] += gw[2] * sb;
          } else if (false) {
            for (let t = 0; t < 4; t++) {
              const nb = B.L.tets[loc.tet * 4 + t], bb = Math.max(0, loc.bary[t]);
              const f = (sb * bb * B.w[nb]) / (wb || 1);
              B.x[nb * 3] -= gw[0] * f; B.x[nb * 3 + 1] -= gw[1] * f; B.x[nb * 3 + 2] -= gw[2] * f;
            }
          }
          // remember the contact so the separating velocity can be killed (no bounce, no jitter)
          if (A.contacts.length < 6000) A.contacts.push(i, gw[0], gw[1], gw[2]);
          // a little friction between pieces
          const fx = x[k] - A.p[k], fy = x[k + 1] - A.p[k + 1], fz = x[k + 2] - A.p[k + 2];
          const vn = fx * gw[0] + fy * gw[1] + fz * gw[2];
          const tx = fx - vn * gw[0], ty = fy - vn * gw[1], tz = fz - vn * gw[2];
          x[k] -= tx * 0.25; x[k + 1] -= ty * 0.25; x[k + 2] -= tz * 0.25;
        }
      }
    }
  }

  solveGrab(h) {
    const g = this.grab;
    const b = g.body;
    if (b.sleeping) b.wake();
    const x = b.x;
    const kd = 9000 * h * h;
    const s = kd / (1 + kd);
    for (let q = 0; q < g.nodes.length; q++) {
      const i = g.nodes[q], k = i * 3, wgt = g.weights[q] * s;
      const tx = g.target[0] + g.offsets[q * 3], ty = g.target[1] + g.offsets[q * 3 + 1], tz = g.target[2] + g.offsets[q * 3 + 2];
      x[k] += (tx - x[k]) * wgt; x[k + 1] += (ty - x[k + 1]) * wgt; x[k + 2] += (tz - x[k + 2]) * wgt;
    }
  }

  solveKnife() {
    const K = this.knife;
    for (const b of this.bodies) {
      if (K.mode === 'wedge' && !b.side) continue;
      if (K.mode === 'groove' && !K.targets.has(b)) continue;
      const x = b.x;
      let touched = false;
      for (let i = 0; i < b.n; i++) {
        const k = i * 3;
        const y = x[k + 1];
        if (y < K.edgeY - 0.02) continue;
        const s = K.n[0] * x[k] + K.n[2] * x[k + 2] - K.c;
        const along = K.dir[0] * x[k] + K.dir[2] * x[k + 2];
        if (along < K.a0 || along > K.a1) continue;
        if (K.mode === 'groove') {
          // the blade presses a soft V-shaped groove into the top
          const w = 0.16;
          if (Math.abs(s) > w) continue;
          const floorY = K.edgeY + (s / w) * (s / w) * w * 1.6;
          if (y > floorY) { x[k + 1] = floorY; touched = true; }
        } else {
          // the wedge-shaped blade pushes the two new faces apart
          const half = Math.min(0.045, Math.max(0, (y - K.edgeY) * 0.1)) + 0.008;
          if (b.side < 0 && s > -half) { x[k] -= K.n[0] * (s + half); x[k + 2] -= K.n[2] * (s + half); touched = true; }
          if (b.side > 0 && s < half) { x[k] += K.n[0] * (half - s); x[k + 2] += K.n[2] * (half - s); touched = true; }
        }
      }
      if (touched && b.sleeping) b.wake();
    }
  }

  finishSubstep(b, h) {
    const { x, v, p, n } = b;
    const ih = 1 / h;
    for (let k = 0; k < n * 3; k++) v[k] = (x[k] - p[k]) * ih;
    // piece-piece contacts are inelastic: drop the separating normal speed they produced
    const C = b.contacts;
    for (let q = 0; q < C.length; q += 4) {
      const k = C[q] * 3, nx = C[q + 1], ny = C[q + 2], nz = C[q + 3];
      const vn = v[k] * nx + v[k + 1] * ny + v[k + 2] * nz;
      if (vn > 0) { v[k] -= nx * vn * 0.85; v[k + 1] -= ny * vn * 0.85; v[k + 2] -= nz * vn * 0.85; }
      // and some tangential damping while touching
      v[k] *= 0.97; v[k + 1] *= 0.97; v[k + 2] *= 0.97;
    }
    C.length = 0;
  }

  edgeDamping(b, h) {
    const E = b.L.edges, v = b.v, x = b.x;
    const kd = Math.min(0.9, (0.2 + this.params.damping * 6) * h * 6.5);
    for (let e = 0; e < E.length; e += 2) {
      const a = E[e] * 3, c = E[e + 1] * 3;
      let dx = x[c] - x[a], dy = x[c + 1] - x[a + 1], dz = x[c + 2] - x[a + 2];
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      const rv = (v[c] - v[a]) * dx + (v[c + 1] - v[a + 1]) * dy + (v[c + 2] - v[a + 2]) * dz;
      const d = rv * kd * 0.5;
      v[a] += dx * d; v[a + 1] += dy * d; v[a + 2] += dz * d;
      v[c] -= dx * d; v[c + 1] -= dy * d; v[c + 2] -= dz * d;
    }
  }

  /** Blend each cell's velocities toward its rigid motion (damps wobble, keeps tumbling). */
  deformationDamping(b) {
    const L = b.L, v = b.v, x = b.x, cells = L.cells;
    const k = this.params.damping * 0.35;
    if (k <= 0) return;
    for (let c = 0; c < L.cellCount; c++) {
      const o = c * 8;
      let cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
      for (let j = 0; j < 8; j++) { const n = cells[o + j] * 3; cx += x[n]; cy += x[n + 1]; cz += x[n + 2]; vx += v[n]; vy += v[n + 1]; vz += v[n + 2]; }
      cx /= 8; cy /= 8; cz /= 8; vx /= 8; vy /= 8; vz /= 8;
      // angular momentum and inertia about the cell centre
      let Lx = 0, Ly = 0, Lz = 0;
      let I00 = 0, I01 = 0, I02 = 0, I11 = 0, I12 = 0, I22 = 0;
      for (let j = 0; j < 8; j++) {
        const n = cells[o + j] * 3;
        const rx = x[n] - cx, ry = x[n + 1] - cy, rz = x[n + 2] - cz;
        const ux = v[n] - vx, uy = v[n + 1] - vy, uz = v[n + 2] - vz;
        Lx += ry * uz - rz * uy; Ly += rz * ux - rx * uz; Lz += rx * uy - ry * ux;
        I00 += ry * ry + rz * rz; I11 += rx * rx + rz * rz; I22 += rx * rx + ry * ry;
        I01 -= rx * ry; I02 -= rx * rz; I12 -= ry * rz;
      }
      // solve I w = L
      const det = I00 * (I11 * I22 - I12 * I12) - I01 * (I01 * I22 - I12 * I02) + I02 * (I01 * I12 - I11 * I02);
      let wx = 0, wy = 0, wz = 0;
      if (Math.abs(det) > 1e-12) {
        const id = 1 / det;
        wx = ((I11 * I22 - I12 * I12) * Lx + (I02 * I12 - I01 * I22) * Ly + (I01 * I12 - I02 * I11) * Lz) * id;
        wy = ((I02 * I12 - I01 * I22) * Lx + (I00 * I22 - I02 * I02) * Ly + (I01 * I02 - I00 * I12) * Lz) * id;
        wz = ((I01 * I12 - I02 * I11) * Lx + (I01 * I02 - I00 * I12) * Ly + (I00 * I11 - I01 * I01) * Lz) * id;
      }
      for (let j = 0; j < 8; j++) {
        const n = cells[o + j] * 3;
        const rx = x[n] - cx, ry = x[n + 1] - cy, rz = x[n + 2] - cz;
        const tx = vx + wy * rz - wz * ry, ty = vy + wz * rx - wx * rz, tz = vz + wx * ry - wy * rx;
        v[n] += (tx - v[n]) * k; v[n + 1] += (ty - v[n + 1]) * k; v[n + 2] += (tz - v[n + 2]) * k;
      }
    }
  }

  rollingResistance(b) {
    if (!b.onFloor) return;
    const { x, v, m, n } = b;
    let cx = 0, cy = 0, cz = 0, px = 0, py = 0, pz = 0;
    for (let i = 0; i < n; i++) { cx += m[i] * x[i * 3]; cy += m[i] * x[i * 3 + 1]; cz += m[i] * x[i * 3 + 2]; px += m[i] * v[i * 3]; py += m[i] * v[i * 3 + 1]; pz += m[i] * v[i * 3 + 2]; }
    cx /= b.M; cy /= b.M; cz /= b.M; px /= b.M; py /= b.M; pz /= b.M;
    let Lx = 0, Ly = 0, Lz = 0, I = 0;
    for (let i = 0; i < n; i++) {
      const rx = x[i * 3] - cx, ry = x[i * 3 + 1] - cy, rz = x[i * 3 + 2] - cz;
      const ux = v[i * 3] - px, uy = v[i * 3 + 1] - py, uz = v[i * 3 + 2] - pz;
      Lx += m[i] * (ry * uz - rz * uy); Ly += m[i] * (rz * ux - rx * uz); Lz += m[i] * (rx * uy - ry * ux);
      I += m[i] * (rx * rx + ry * ry + rz * rz) * (2 / 3);
    }
    const wx = Lx / I, wy = Ly / I, wz = Lz / I;
    const k = Math.min(1, this.rolling * STEP);
    for (let i = 0; i < n; i++) {
      const rx = x[i * 3] - cx, ry = x[i * 3 + 1] - cy, rz = x[i * 3 + 2] - cz;
      v[i * 3] -= (wy * rz - wz * ry) * k; v[i * 3 + 1] -= (wz * rx - wx * rz) * k; v[i * 3 + 2] -= (wx * ry - wy * rx) * k;
    }
  }

  updateSleep(b) {
    if (this.grab && this.grab.body === b) { b.sleepTimer = 0; return; }
    if (this.knife && (this.knife.targets?.has(b) || b.side)) { b.sleepTimer = 0; return; }
    let maxV2 = 0;
    for (let i = 0; i < b.n * 3; i += 3) {
      const s = b.v[i] * b.v[i] + b.v[i + 1] * b.v[i + 1] + b.v[i + 2] * b.v[i + 2];
      if (s > maxV2) maxV2 = s;
    }
    if (maxV2 < 0.01) {
      b.sleepTimer += STEP;
      if (b.sleepTimer > 0.6) { b.sleeping = true; b.v.fill(0); }
    } else b.sleepTimer = 0;
  }

  // ---- interaction -------------------------------------------------------------
  /** Ray-cast every body by sphere tracing its rest SDF in the best-fit frame. */
  raycast(origin, dir) {
    let best = null;
    const o = [0, 0, 0], d = [0, 0, 0], p = [0, 0, 0];
    for (const b of this.bodies) {
      b.updateFit();
      // bounding sphere
      const ox = origin[0] - b.com[0], oy = origin[1] - b.com[1], oz = origin[2] - b.com[2];
      const B = ox * dir[0] + oy * dir[1] + oz * dir[2];
      const Cc = ox * ox + oy * oy + oz * oz - b.radius * b.radius;
      const disc = B * B - Cc;
      if (disc < 0) continue;
      let t = Math.max(0, -B - Math.sqrt(disc));
      const tEnd = -B + Math.sqrt(disc);
      b.worldToRest(origin, o);
      b.worldDirToRest(dir, d);
      for (let it = 0; it < 96 && t < tEnd; it++) {
        p[0] = o[0] + d[0] * t; p[1] = o[1] + d[1] * t; p[2] = o[2] + d[2] * t;
        const s = b.sdfRest(p[0], p[1], p[2]);
        if (s < 0.002) {
          if (!best || t < best.t) best = { body: b, t, rest: p.slice(), point: [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t] };
          break;
        }
        t += Math.max(s * 0.9, 0.004);
      }
    }
    return best;
  }

  startGrab(hit) {
    const b = hit.body;
    b.wake();
    const nodes = [], weights = [], offsets = [];
    const R = 0.5;
    for (let i = 0; i < b.n; i++) {
      const dx = b.x[i * 3] - hit.point[0], dy = b.x[i * 3 + 1] - hit.point[1], dz = b.x[i * 3 + 2] - hit.point[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > R) continue;
      nodes.push(i);
      const t = 1 - d / R;
      weights.push(t * t);
      offsets.push(dx, dy, dz);
    }
    if (!nodes.length) return false;
    this.grab = { body: b, nodes, weights, offsets: Float32Array.from(offsets), target: hit.point.slice() };
    return true;
  }

  nudge(rand = Math.random) {
    for (const b of this.bodies) {
      b.wake();
      const ang = rand() * Math.PI * 2;
      const sp = 1.2 + rand() * 1.0;
      const lin = [Math.cos(ang) * sp, 3.2 + rand() * 1.5, Math.sin(ang) * sp];
      const w = [(rand() - 0.5) * 6, (rand() - 0.5) * 6, (rand() - 0.5) * 6];
      for (let i = 0; i < b.n; i++) {
        const rx = b.x[i * 3] - b.com[0], ry = b.x[i * 3 + 1] - b.com[1], rz = b.x[i * 3 + 2] - b.com[2];
        b.v[i * 3] += lin[0] + w[1] * rz - w[2] * ry;
        b.v[i * 3 + 1] += lin[1] + w[2] * rx - w[0] * rz;
        b.v[i * 3 + 2] += lin[2] + w[0] * ry - w[1] * rx;
      }
    }
  }

  // ---- readouts -----------------------------------------------------------------
  stats() {
    let vol = 0, cur = 0, rest = 0, ke = 0;
    for (const b of this.bodies) {
      vol += b.piece.volume;
      cur += b.currentVolume();
      rest += b.restVolume();
      ke += b.kinetic();
    }
    // kinetic: mass in kg (volume units * g/unit^3 / 1000), speed in m/s (units * 0.03)
    const keJ = ke * (GRAMS_PER_UNIT3 / 1000) * (UNIT_CM / 100) ** 2;
    return { massG: vol * GRAMS_PER_UNIT3, volumePct: rest ? (cur / rest) * 100 : 100, kineticMJ: keJ * 1000, pieces: this.bodies.length };
  }
}
