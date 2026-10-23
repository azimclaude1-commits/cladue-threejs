// A small procedural mesh builder. Every vertex: pos3 nrm3 col3 mat ex0 ex1 obj = 13 floats.
import { m3inv } from './math.js';

export const VF = 13;

export const MAT = {
  DIFFUSE: 0, TERRAIN: 1, WALL: 2, SKULL: 3, FROND: 4, TRUNK: 5, SAIL: 6, FLAG: 7, GOLD: 8, METAL: 9,
  WINDOW: 10, EMBER: 11, KELP: 12, GLASS: 13, BUBBLE: 14, LANTERN: 15, GUMMY: 16, GEM: 17, ROCK: 18, WOOD: 19, TEETH: 20,
};

// ---- affine transforms {m: row-major 3x3, t: [x,y,z]} ------------------------------------
export const X = {
  I: () => ({ m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }),
  T: (x, y, z) => ({ m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [x, y, z] }),
  S: (x, y = x, z = x) => ({ m: [x, 0, 0, 0, y, 0, 0, 0, z], t: [0, 0, 0] }),
  RX: (a) => { const c = Math.cos(a), s = Math.sin(a); return { m: [1, 0, 0, 0, c, -s, 0, s, c], t: [0, 0, 0] }; },
  RY: (a) => { const c = Math.cos(a), s = Math.sin(a); return { m: [c, 0, s, 0, 1, 0, -s, 0, c], t: [0, 0, 0] }; },
  RZ: (a) => { const c = Math.cos(a), s = Math.sin(a); return { m: [c, -s, 0, s, c, 0, 0, 0, 1], t: [0, 0, 0] }; },
  /** Basis from axes (columns) + origin. */
  B: (ax, ay, az, o) => ({ m: [ax[0], ay[0], az[0], ax[1], ay[1], az[1], ax[2], ay[2], az[2]], t: o.slice() }),
  /** compose: mul(A, B, C...) applies the rightmost first */
  mul(...xs) {
    return xs.reduce((A, B) => {
      const m = new Array(9);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 3 + c] = A.m[r * 3] * B.m[c] + A.m[r * 3 + 1] * B.m[3 + c] + A.m[r * 3 + 2] * B.m[6 + c];
      const t = [0, 1, 2].map((r) => A.m[r * 3] * B.t[0] + A.m[r * 3 + 1] * B.t[1] + A.m[r * 3 + 2] * B.t[2] + A.t[r]);
      return { m, t };
    });
  },
  p(A, p) { return [0, 1, 2].map((r) => A.m[r * 3] * p[0] + A.m[r * 3 + 1] * p[1] + A.m[r * 3 + 2] * p[2] + A.t[r]); },
  /** to column-major mat4 (Float32Array) */
  toM4(A, out = new Float32Array(16), o = 0) {
    out[o] = A.m[0]; out[o + 1] = A.m[3]; out[o + 2] = A.m[6]; out[o + 3] = 0;
    out[o + 4] = A.m[1]; out[o + 5] = A.m[4]; out[o + 6] = A.m[7]; out[o + 7] = 0;
    out[o + 8] = A.m[2]; out[o + 9] = A.m[5]; out[o + 10] = A.m[8]; out[o + 11] = 0;
    out[o + 12] = A.t[0]; out[o + 13] = A.t[1]; out[o + 14] = A.t[2]; out[o + 15] = 1;
    return out;
  },
};

export function hex(h) {
  const n = parseInt(h.replace('#', ''), 16);
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}
export const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class Builder {
  constructor() {
    this.data = [];
    this.idx = [];
    this.count = 0;
    this.set(X.I(), 0);
  }
  set(xf, obj = 0) {
    this.xf = xf;
    this.obj = obj;
    const inv = m3inv(xf.m) || [1, 0, 0, 0, 1, 0, 0, 0, 1];
    this.nm = [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]]; // inverse transpose
    return this;
  }
  v(p, n, c, mat, e0 = 0, e1 = 0) {
    const P = X.p(this.xf, p);
    const M = this.nm;
    let nx = M[0] * n[0] + M[1] * n[1] + M[2] * n[2], ny = M[3] * n[0] + M[4] * n[1] + M[5] * n[2], nz = M[6] * n[0] + M[7] * n[1] + M[8] * n[2];
    const l = Math.hypot(nx, ny, nz) || 1;
    this.data.push(P[0], P[1], P[2], nx / l, ny / l, nz / l, c[0], c[1], c[2], mat, e0, e1, this.obj);
    return this.count++;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }

  /**
   * Parametric surface. f(u, v) -> {p, c, e0?, e1?, mat?}. u, v in [0, 1].
   * Normals from the cross product of the partial derivatives (dp/du x dp/dv), flipped if flip.
   */
  surface(nu, nv, f, mat, { flip = false, closeU = false } = {}) {
    const base = this.count;
    const eps = 1e-3;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv;
        const s = f(u, v);
        const pu1 = f(Math.min(1, u + eps), v).p, pu0 = f(Math.max(0, u - eps), v).p;
        const pv1 = f(u, Math.min(1, v + eps)).p, pv0 = f(u, Math.max(0, v - eps)).p;
        const du = [pu1[0] - pu0[0], pu1[1] - pu0[1], pu1[2] - pu0[2]];
        const dv = [pv1[0] - pv0[0], pv1[1] - pv0[1], pv1[2] - pv0[2]];
        let n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
        if (Math.hypot(...n) < 1e-12) n = s.n || [0, 1, 0];
        if (flip) n = [-n[0], -n[1], -n[2]];
        this.v(s.p, n, s.c, s.mat ?? mat, s.e0 ?? 0, s.e1 ?? 0);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
        if (flip) { this.tri(a, b, c); this.tri(b, d, c); } else { this.tri(a, c, b); this.tri(b, c, d); }
      }
    }
    return this;
  }

  /** Flat-shaded triangle soup helper (used for small faceted things). */
  flatTri(p0, p1, p2, c, mat, e0 = 0, e1 = 0) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const a = this.v(p0, n, c, mat, e0, e1), b = this.v(p1, n, c, mat, e0, e1), d = this.v(p2, n, c, mat, e0, e1);
    this.tri(a, b, d);
  }

  box(sx, sy, sz, c, mat, e0 = 0, e1 = 0) {
    const h = [sx / 2, sy / 2, sz / 2];
    const faces = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    ];
    for (const [n, a, b] of faces) {
      const ctr = n.map((v, i) => v * h[i]);
      const P = (s, t) => ctr.map((v, i) => v + a[i] * h[i] * s + b[i] * h[i] * t);
      const i0 = this.v(P(-1, -1), n, c, mat, e0, e1), i1 = this.v(P(1, -1), n, c, mat, e0, e1);
      const i2 = this.v(P(1, 1), n, c, mat, e0, e1), i3 = this.v(P(-1, 1), n, c, mat, e0, e1);
      this.tri(i0, i1, i2); this.tri(i0, i2, i3);
    }
    return this;
  }

  /** Cylinder along +y from y=0 to y=h. r may be a function of t in [0,1]. */
  cylinder(r, h, seg, c, mat, { caps = true, e0 = 0, e1 = 0, colorFn = null } = {}) {
    const rf = typeof r === 'function' ? r : () => r;
    this.surface(seg, Math.max(1, Math.round(h / 0.05)), (u, v) => {
      const a = u * Math.PI * 2, rr = rf(v);
      return { p: [Math.cos(a) * rr, v * h, Math.sin(a) * rr], c: colorFn ? colorFn(u, v) : c, e0: typeof e0 === 'function' ? e0(v) : e0, e1 };
    }, mat, { flip: true });
    if (caps) {
      for (const [y, rr, ny] of [[0, rf(0), -1], [h, rf(1), 1]]) {
        const ctr = this.v([0, y, 0], [0, ny, 0], c, mat, typeof e0 === 'function' ? e0(y / h) : e0, e1);
        const ring = [];
        for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; ring.push(this.v([Math.cos(a) * rr, y, Math.sin(a) * rr], [0, ny, 0], c, mat, typeof e0 === 'function' ? e0(y / h) : e0, e1)); }
        for (let i = 0; i < seg; i++) { if (ny > 0) this.tri(ctr, ring[i + 1], ring[i]); else this.tri(ctr, ring[i], ring[i + 1]); }
      }
    }
    return this;
  }

  sphere(r, seg, c, mat, { deform = null, e0 = 0, e1 = 0, colorFn = null } = {}) {
    const rf = (x, y, z) => (deform ? deform(x, y, z) : 1) * r;
    this.surface(seg * 2, seg, (u, v) => {
      const th = u * Math.PI * 2, ph = v * Math.PI;
      const x = Math.sin(ph) * Math.cos(th), y = Math.cos(ph), z = Math.sin(ph) * Math.sin(th);
      const rr = rf(x, y, z);
      return { p: [x * rr, y * rr, z * rr], c: colorFn ? colorFn(x, y, z) : c, e0, e1, n: [x, y, z] };
    }, mat);
    return this;
  }

  /** Tube through points (array of [x,y,z]); radius(t), color(t). */
  tube(points, radius, seg, c, mat, { e0 = 0, e1 = 0, colorFn = null, caps = false } = {}) {
    const n = points.length;
    const rf = typeof radius === 'function' ? radius : () => radius;
    const at = (t) => {
      const f = t * (n - 1), i = Math.min(n - 2, Math.floor(f)), k = f - i;
      const a = points[i], b = points[i + 1];
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    };
    const tang = (t) => {
      const a = at(Math.max(0, t - 0.01)), b = at(Math.min(1, t + 0.01));
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const l = Math.hypot(...d) || 1;
      return d.map((x) => x / l);
    };
    let ref = Math.abs(tang(0)[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const frame = (t) => {
      const T = tang(t);
      let N = [ref[1] * T[2] - ref[2] * T[1], ref[2] * T[0] - ref[0] * T[2], ref[0] * T[1] - ref[1] * T[0]];
      let l = Math.hypot(...N);
      if (l < 1e-4) { ref = [0, 0, 1]; N = [ref[1] * T[2] - ref[2] * T[1], ref[2] * T[0] - ref[0] * T[2], ref[0] * T[1] - ref[1] * T[0]]; l = Math.hypot(...N); }
      N = N.map((x) => x / l);
      const Bv = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
      return [N, Bv];
    };
    const steps = Math.max(2, (n - 1) * 4);
    this.surface(seg, steps, (u, v) => {
      const P = at(v), [N, Bv] = frame(v), a = u * Math.PI * 2, r = rf(v);
      const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
      return { p: [P[0] + N[0] * ca + Bv[0] * sa, P[1] + N[1] * ca + Bv[1] * sa, P[2] + N[2] * ca + Bv[2] * sa], c: colorFn ? colorFn(v, u) : c, e0: typeof e0 === 'function' ? e0(v) : e0, e1 };
    }, mat);
    if (caps) {
      const P = at(1), r = rf(1);
      this.set(X.mul(this.xf, X.T(...P)), this.obj);
      this.sphere(r, 6, colorFn ? colorFn(1, 0) : c, mat, { e0: typeof e0 === 'function' ? e0(1) : e0, e1 });
    }
    return this;
  }

  /** Lathe around +y. profile: [[r, y], ...] */
  lathe(profile, seg, c, mat, { colorFn = null, e0 = 0, e1 = 0 } = {}) {
    const n = profile.length;
    this.surface(seg, n - 1, (u, v) => {
      const f = v * (n - 1), i = Math.min(n - 2, Math.floor(f)), k = f - i;
      const r = profile[i][0] + (profile[i + 1][0] - profile[i][0]) * k;
      const y = profile[i][1] + (profile[i + 1][1] - profile[i][1]) * k;
      const a = u * Math.PI * 2;
      return { p: [Math.cos(a) * r, y, Math.sin(a) * r], c: colorFn ? colorFn(u, v, y) : c, e0, e1 };
    }, mat, { flip: true });
    return this;
  }

  build() {
    return { vertices: new Float32Array(this.data), indices: new Uint32Array(this.idx), count: this.count };
  }
}
