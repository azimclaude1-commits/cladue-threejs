// Linear shallow-water waves on a staggered grid (eta at cell centres, u/v on faces),
// with a little surface tension so the jelly springs back, and a body force for sloshing.
import { HALF, WATER, groundHeight, skullSdf } from './world.js';

export class Sea {
  constructor(N = 128) {
    this.N = N;
    this.dx = (2 * HALF) / N;
    this.eta = new Float32Array(N * N);
    this.u = new Float32Array((N + 1) * N);
    this.v = new Float32Array(N * (N + 1));
    this.D = new Float32Array(N * N);
    this.lap = new Float32Array(N * N);
    this.disp = new Float32Array(N * N); // displacement handed in by floating hulls
    this.dispPrev = new Float32Array(N * N);
    this.params = { g: 4.0, tension: 0.0002, damping: 0.35 };
    this.accel = [0, 0]; // body force (from tipping), block-local
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -HALF + (i + 0.5) * this.dx, z = -HALF + (j + 0.5) * this.dx;
      let d = WATER - groundHeight(x, z);
      if (skullSdf(x, WATER, z) < 0) d = 0;
      this.D[j * N + i] = d > 0.012 ? d : 0;
    }
    this.acc = 0;
  }

  idx(x, z) {
    const N = this.N;
    const i = Math.floor((x + HALF) / this.dx), j = Math.floor((z + HALF) / this.dx);
    if (i < 0 || j < 0 || i >= N || j >= N) return -1;
    return j * N + i;
  }

  /** Surface height (offset from still water) at block-local (x, z), bilinear. */
  height(x, z) {
    const N = this.N;
    let fx = (x + HALF) / this.dx - 0.5, fz = (z + HALF) / this.dx - 0.5;
    fx = Math.min(N - 1.001, Math.max(0, fx)); fz = Math.min(N - 1.001, Math.max(0, fz));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const e = this.eta, k = j * N + i;
    return (e[k] * (1 - tx) + e[k + 1] * tx) * (1 - tz) + (e[k + N] * (1 - tx) + e[k + N + 1] * tx) * tz;
  }

  /** Add a smooth bump (amount > 0) or dent (amount < 0) of radius r. */
  disturb(x, z, r, amount) {
    const N = this.N, dx = this.dx;
    const i0 = Math.max(0, Math.floor((x - 2 * r + HALF) / dx)), i1 = Math.min(N - 1, Math.ceil((x + 2 * r + HALF) / dx));
    const j0 = Math.max(0, Math.floor((z - 2 * r + HALF) / dx)), j1 = Math.min(N - 1, Math.ceil((z + 2 * r + HALF) / dx));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * N + i;
      if (!this.D[k]) continue;
      const px = -HALF + (i + 0.5) * dx - x, pz = -HALF + (j + 0.5) * dx - z;
      this.eta[k] += amount * Math.exp(-(px * px + pz * pz) / (r * r));
    }
  }

  /** A hull pressing an elliptical footprint (in its own frame) into the sea. */
  addFootprint(cx, cz, yaw, a, b, depth) {
    const N = this.N, dx = this.dx;
    const R = Math.max(a, b) + dx;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const i0 = Math.max(0, Math.floor((cx - R + HALF) / dx)), i1 = Math.min(N - 1, Math.ceil((cx + R + HALF) / dx));
    const j0 = Math.max(0, Math.floor((cz - R + HALF) / dx)), j1 = Math.min(N - 1, Math.ceil((cz + R + HALF) / dx));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = -HALF + (i + 0.5) * dx - cx, pz = -HALF + (j + 0.5) * dx - cz;
      // into the hull's frame (RY(yaw): local x maps to (c, -s))
      const lx = c * px - s * pz, lz = s * px + c * pz;
      const q = (lx / a) ** 2 + (lz / b) ** 2;
      if (q < 1) this.disp[j * N + i] += depth * (1 - q);
    }
  }

  step(dt) {
    const { N, dx, eta, u, v, D, lap } = this;
    const g = this.params.g, sig = this.params.tension, damp = Math.exp(-this.params.damping * dt);
    const ax = this.accel[0], az = this.accel[1];
    // hand the hulls' displacement back to the sea
    for (let k = 0; k < N * N; k++) {
      if (D[k]) eta[k] -= (this.disp[k] - this.dispPrev[k]) * 0.6;
      this.dispPrev[k] = this.disp[k];
    }
    // laplacian for the surface tension
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (!D[k]) { lap[k] = 0; continue; }
      const c = eta[k];
      const l = i > 0 && D[k - 1] ? eta[k - 1] : c, r = i < N - 1 && D[k + 1] ? eta[k + 1] : c;
      const d = j > 0 && D[k - N] ? eta[k - N] : c, t = j < N - 1 && D[k + N] ? eta[k + N] : c;
      lap[k] = (l + r + d + t - 4 * c) / (dx * dx);
    }
    // momentum
    for (let j = 0; j < N; j++) for (let i = 1; i < N; i++) {
      const f = j * (N + 1) + i, a = j * N + i - 1, b = a + 1;
      if (!D[a] || !D[b]) { u[f] = 0; continue; }
      u[f] = (u[f] + dt * (-g * (eta[b] - eta[a]) / dx + sig * (lap[b] - lap[a]) / dx + ax)) * damp;
    }
    for (let j = 1; j < N; j++) for (let i = 0; i < N; i++) {
      const f = j * N + i, a = (j - 1) * N + i, b = j * N + i;
      if (!D[a] || !D[b]) { v[f] = 0; continue; }
      v[f] = (v[f] + dt * (-g * (eta[b] - eta[a]) / dx + sig * (lap[b] - lap[a]) / dx + az)) * damp;
    }
    // continuity
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (!D[k]) continue;
      const Dl = i > 0 ? Math.min(D[k], D[k - 1]) : 0, Dr = i < N - 1 ? Math.min(D[k], D[k + 1]) : 0;
      const Dd = j > 0 ? Math.min(D[k], D[k - N]) : 0, Dt = j < N - 1 ? Math.min(D[k], D[k + N]) : 0;
      const fl = u[j * (N + 1) + i] * Dl, fr = u[j * (N + 1) + i + 1] * Dr;
      const fd = v[j * N + i] * Dd, ft = v[(j + 1) * N + i] * Dt;
      eta[k] -= (dt * (fr - fl + ft - fd)) / dx;
      if (eta[k] > 0.4) eta[k] = 0.4; else if (eta[k] < -0.4) eta[k] = -0.4;
    }
  }

  update(dt) {
    this.acc += Math.min(dt, 0.05);
    const h = 1 / 120;
    let n = 0;
    while (this.acc >= h && n < 6) { this.step(h); this.acc -= h; n++; }
    // keep the mean level from drifting (impulses are not mass-conserving)
    if (n) {
      let s = 0, c = 0;
      for (let k = 0; k < this.eta.length; k++) if (this.D[k]) { s += this.eta[k]; c++; }
      const m = s / c;
      for (let k = 0; k < this.eta.length; k++) if (this.D[k]) this.eta[k] -= m * 0.05;
    }
    this.disp.fill(0);
  }

  energy() {
    let s = 0, c = 0;
    for (let k = 0; k < this.eta.length; k += 3) if (this.D[k]) { s += this.eta[k] * this.eta[k]; c++; }
    return Math.sqrt(s / Math.max(c, 1));
  }
}
