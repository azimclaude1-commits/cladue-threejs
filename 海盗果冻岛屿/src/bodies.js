// Rigid bodies: cannonballs, barrels and doubloons. Spheres for collision, with a little
// orientation behaviour on top (barrels float on their side, coins flutter and settle flat).
import { HALF, WATER, groundHeight, skullSdf, PALMS } from './world.js';
import { OBJ, SIZES } from './geometry.js';
import { X } from './builder.js';

const TYPES = {
  ball: { r: SIZES.ball, density: 7.5, rest: 0.12, pool: [OBJ.BALL, OBJ.NBALL] },
  barrel: { r: SIZES.barrel, density: 0.42, rest: 0.25, pool: [OBJ.BARREL, OBJ.NBARREL] },
  coin: { r: SIZES.coin * 0.55, density: 8.5, rest: 0.2, pool: [OBJ.COIN, OBJ.NCOIN] },
};

function qmul(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
function qnorm(q) { const l = Math.hypot(...q) || 1; return q.map((x) => x / l); }
function qrot(q, v) { // rotate v by q
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
function qToM(q) {
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
/** Rotate q so that its local axis a turns toward world direction b by fraction k. */
function alignAxis(q, a, b, k) {
  const ca = qrot(q, a);
  let ax = [ca[1] * b[2] - ca[2] * b[1], ca[2] * b[0] - ca[0] * b[2], ca[0] * b[1] - ca[1] * b[0]];
  const s = Math.hypot(...ax), c = ca[0] * b[0] + ca[1] * b[1] + ca[2] * b[2];
  if (s < 1e-6) return q;
  const ang = Math.atan2(s, c) * k;
  ax = ax.map((v) => v / s);
  const h = ang / 2, sh = Math.sin(h);
  return qnorm(qmul([ax[0] * sh, ax[1] * sh, ax[2] * sh, Math.cos(h)], q));
}

export class Bodies {
  constructor(world) {
    this.w = world; // {sea, ship, colliders, fx}
    this.list = [];
    this.free = {};
    for (const [k, t] of Object.entries(TYPES)) this.free[k] = Array.from({ length: t.pool[1] }, (_, i) => t.pool[0] + i);
  }
  reset() {
    for (const b of this.list) this.free[b.type].push(b.obj);
    this.list = [];
  }

  spawn(type, pos, vel, opts = {}) {
    const T = TYPES[type];
    let obj = this.free[type].pop();
    if (obj === undefined) {
      const old = this.list.find((b) => b.type === type);
      this.list.splice(this.list.indexOf(old), 1);
      obj = old.obj;
    }
    const b = {
      type, obj, r: T.r, density: T.density, rest: T.rest,
      p: pos.slice(), v: vel.slice(), q: opts.q || [0, 0, 0, 1], w: opts.w || [0, 0, 0],
      inWater: false, onGround: false, age: 0, held: false, phase: Math.random() * 10, landed: false,
    };
    if (type === 'barrel') b.q = qnorm([Math.random() - 0.5, 0, Math.random() - 0.5, 1]);
    if (type === 'coin') b.q = qnorm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, 1]);
    this.list.push(b);
    return b;
  }

  matrices(out) {
    // hide every pooled object, then place the live ones
    for (const [, t] of Object.entries(TYPES)) for (let i = 0; i < t.pool[1]; i++) {
      const o = (t.pool[0] + i) * 16;
      out.fill(0, o, o + 16);
    }
    for (const b of this.list) {
      const m = qToM(b.q);
      X.toM4({ m, t: b.p }, out, b.obj * 16);
    }
  }

  insideBlock(p, m = 0) { return Math.abs(p[0]) < HALF - m && Math.abs(p[2]) < HALF - m; }

  update(dt) {
    const sub = 3, h = dt / sub;
    for (let s = 0; s < sub; s++) for (const b of this.list) this.stepBody(b, h);
    // body-body
    const L = this.list;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], c = L[j];
      const dx = c.p[0] - a.p[0], dy = c.p[1] - a.p[1], dz = c.p[2] - a.p[2];
      const d = Math.hypot(dx, dy, dz), m = a.r + c.r;
      if (d >= m || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d, nz = dz / d, pen = m - d;
      const wa = 1 / a.density, wc = 1 / c.density, ws = wa + wc;
      a.p[0] -= nx * pen * wa / ws; a.p[1] -= ny * pen * wa / ws; a.p[2] -= nz * pen * wa / ws;
      c.p[0] += nx * pen * wc / ws; c.p[1] += ny * pen * wc / ws; c.p[2] += nz * pen * wc / ws;
      const rv = (c.v[0] - a.v[0]) * nx + (c.v[1] - a.v[1]) * ny + (c.v[2] - a.v[2]) * nz;
      if (rv < 0) {
        const j2 = -(1.3 * rv) / ws;
        a.v[0] -= nx * j2 * wa; a.v[1] -= ny * j2 * wa; a.v[2] -= nz * j2 * wa;
        c.v[0] += nx * j2 * wc; c.v[1] += ny * j2 * wc; c.v[2] += nz * j2 * wc;
      }
    }
  }

  stepBody(b, h) {
    const { sea, ship, fx } = this.w;
    b.age += h;
    if (b.held) return;
    const p = b.p, v = b.v, r = b.r;
    const inside = this.insideBlock(p);
    const surf = inside ? WATER + sea.height(p[0], p[2]) : -1e9;
    const wasIn = b.inWater;
    const sub = Math.max(0, Math.min(1, (surf - (p[1] - r)) / (2 * r)));
    b.inWater = sub > 0.5;
    // gravity + buoyancy
    v[1] -= 9.8 * h;
    if (sub > 0) {
      v[1] += (9.8 * sub) / b.density * h;
      // the jelly is thick: strong drag
      const drag = b.type === 'coin' ? 20 : b.type === 'ball' ? 2.2 : 3.5;
      const k = Math.exp(-drag * sub * h);
      v[0] *= k; v[1] *= k; v[2] *= k;
      if (b.type === 'coin') {
        // flutter while sinking
        const t = b.age * 7 + b.phase;
        v[0] += Math.cos(t) * 1.6 * h; v[2] += Math.sin(t * 0.8) * 1.6 * h;
        b.w[0] = Math.cos(t) * 5; b.w[2] = Math.sin(t) * 5;
      }
      if (b.type === 'barrel') {
        // float on its side
        b.q = alignAxis(b.q, [0, 1, 0], horizontalOf(qrot(b.q, [0, 1, 0])), 4 * h);
      }
    }
    if (!wasIn && b.inWater && v[1] < -0.4) {
      const speed = -v[1];
      sea.disturb(p[0], p[2], 0.06 + r, -Math.min(0.12, speed * 0.028) * (b.type === 'coin' ? 0.2 : 1));
      fx.splash(p, speed, b.type);
    }
    if (wasIn && b.inWater && Math.random() < 0.02 && b.type !== 'barrel' && p[1] < surf - 0.05) fx.bubble(p);
    p[0] += v[0] * h; p[1] += v[1] * h; p[2] += v[2] * h;

    // ---- collisions
    b.onGround = false;
    if (this.insideBlock(p, -r)) {
      const gh = groundHeight(p[0], p[2]);
      if (p[1] - r < gh) {
        const e = 0.01;
        const gx = (groundHeight(p[0] + e, p[2]) - groundHeight(p[0] - e, p[2])) / (2 * e);
        const gz = (groundHeight(p[0], p[2] + e) - groundHeight(p[0], p[2] - e)) / (2 * e);
        const n = norm([-gx, 1, -gz]);
        this.resolve(b, n, gh - (p[1] - r), true);
        if (!b.landed && !b.inWater && Math.abs(v[1]) > 0.5 && gh > WATER) fx.sandPuff(p);
        b.landed = true;
      }
      // skull rock
      const ds = skullSdf(p[0], p[1], p[2]) - r;
      if (ds < 0) {
        const e = 0.008;
        const n = norm([skullSdf(p[0] + e, p[1], p[2]) - skullSdf(p[0] - e, p[1], p[2]), skullSdf(p[0], p[1] + e, p[2]) - skullSdf(p[0], p[1] - e, p[2]), skullSdf(p[0], p[1], p[2] + e) - skullSdf(p[0], p[1], p[2] - e)]);
        this.resolve(b, n, -ds, false);
      }
      // palm trunks (capsules)
      for (let i = 0; i < PALMS.length; i++) {
        const [px, pz, ph, la, ln] = PALMS[i];
        const bend = this.w.palmBend?.[i] || [0, 0];
        const y0 = groundHeight(px, pz);
        const top = [px + Math.cos(la) * ln * ph + bend[0], y0 + ph, pz + Math.sin(la) * ln * ph + bend[1]];
        const q = closestOnSeg([px, y0, pz], top, p);
        const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
        const dl = Math.hypot(...d);
        if (dl < r + 0.035 && dl > 1e-6) this.resolve(b, d.map((x) => x / dl), r + 0.035 - dl, false);
      }
      // props
      for (const c of this.w.colliders) {
        if (c.type === 'sphere') {
          const d = [p[0] - c.c[0], p[1] - c.c[1], p[2] - c.c[2]], dl = Math.hypot(...d);
          if (dl < c.r + r && dl > 1e-6) this.resolve(b, d.map((x) => x / dl), c.r + r - dl, false);
        } else if (c.type === 'box') {
          const m = c.xf.m, t = c.xf.t;
          const rel = [p[0] - t[0], p[1] - t[1], p[2] - t[2]];
          const l = [m[0] * rel[0] + m[3] * rel[1] + m[6] * rel[2], m[1] * rel[0] + m[4] * rel[1] + m[7] * rel[2], m[2] * rel[0] + m[5] * rel[1] + m[8] * rel[2]];
          const cl = l.map((x, i) => Math.max(-c.half[i], Math.min(c.half[i], x)));
          const d = [l[0] - cl[0], l[1] - cl[1], l[2] - cl[2]], dl = Math.hypot(...d);
          if (dl < r && dl > 1e-6) {
            const nl = d.map((x) => x / dl);
            this.resolve(b, [m[0] * nl[0] + m[1] * nl[1] + m[2] * nl[2], m[3] * nl[0] + m[4] * nl[1] + m[5] * nl[2], m[6] * nl[0] + m[7] * nl[1] + m[8] * nl[2]], r - dl, false);
          }
        }
      }
      // the ship's hull (ellipsoid in her frame)
      const xf = ship.xf(), R = ship.info.radii;
      const rel = [p[0] - xf.t[0], p[1] - xf.t[1], p[2] - xf.t[2]];
      const m = xf.m;
      const l = [m[0] * rel[0] + m[3] * rel[1] + m[6] * rel[2], m[1] * rel[0] + m[4] * rel[1] + m[7] * rel[2], m[2] * rel[0] + m[5] * rel[1] + m[8] * rel[2]];
      const q = Math.hypot(l[0] / (R[0] + r), l[1] / (R[1] + r), l[2] / (R[2] + r));
      if (q < 1 && l[1] < 0.15) {
        const nl = norm([l[0] / (R[0] * R[0]), l[1] / (R[1] * R[1]), l[2] / (R[2] * R[2])]);
        const n = [m[0] * nl[0] + m[1] * nl[1] + m[2] * nl[2], m[3] * nl[0] + m[4] * nl[1] + m[5] * nl[2], m[6] * nl[0] + m[7] * nl[1] + m[8] * nl[2]];
        const pen = (1 - q) * Math.min(R[0], R[2]);
        const vn = v[0] * n[0] + v[2] * n[2];
        this.resolve(b, n, pen, false);
        if (vn < 0) { ship.vx += vn * n[0] * 0.04 / b.density * 7; ship.vz += vn * n[2] * 0.04 / b.density * 7; }
      }
      // jelly walls: below the surface the jelly holds things in
      if (p[1] < surf) {
        const lim = HALF - r;
        for (const a of [0, 2]) if (Math.abs(p[a]) > lim) { p[a] = Math.sign(p[a]) * lim; if (v[a] * Math.sign(p[a]) > 0) v[a] *= -0.3; }
      }
    } else {
      // outside the block: the studio floor and the block's outer walls
      if (p[1] - r < 0) this.resolve(b, [0, 1, 0], r - p[1], true);
      const ox = Math.abs(p[0]) - HALF, oz = Math.abs(p[2]) - HALF;
      if (p[1] < WATER && ox < r && oz < r) {
        if (ox > oz) { p[0] = Math.sign(p[0]) * (HALF + r); if (v[0] * Math.sign(p[0]) < 0) v[0] *= -0.3; }
        else { p[2] = Math.sign(p[2]) * (HALF + r); if (v[2] * Math.sign(p[2]) < 0) v[2] *= -0.3; }
      }
    }
    // orientation
    const w = b.w;
    if (b.type === 'ball' && b.onGround) { w[0] = v[2] / r; w[2] = -v[0] / r; w[1] = 0; }
    if (b.type === 'coin' && b.onGround) {
      b.q = alignAxis(b.q, [0, 1, 0], [0, 1, 0], 10 * h);
      w[0] *= 0.8; w[1] *= 0.8; w[2] *= 0.8;
    }
    if (b.type === 'barrel' && b.onGround && !b.inWater) {
      b.q = alignAxis(b.q, [0, 1, 0], horizontalOf(qrot(b.q, [0, 1, 0])), 6 * h);
      const ax = qrot(b.q, [0, 1, 0]);
      // roll about its own axis with the ground speed across it
      const roll = (v[0] * -ax[2] + v[2] * ax[0]) / r;
      b.q = qnorm(qmul([ax[0] * Math.sin(roll * h / 2), ax[1] * Math.sin(roll * h / 2), ax[2] * Math.sin(roll * h / 2), Math.cos(roll * h / 2)], b.q));
    }
    const wl = Math.hypot(...w);
    if (wl > 1e-5) {
      const ang = wl * h, s = Math.sin(ang / 2) / wl;
      b.q = qnorm(qmul([w[0] * s, w[1] * s, w[2] * s, Math.cos(ang / 2)], b.q));
      if (b.inWater) { w[0] *= 0.98; w[1] *= 0.98; w[2] *= 0.98; }
    }
  }

  resolve(b, n, pen, ground) {
    const p = b.p, v = b.v;
    p[0] += n[0] * pen; p[1] += n[1] * pen; p[2] += n[2] * pen;
    const vn = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
    if (vn < 0) {
      const bounce = (1 + b.rest) * vn;
      v[0] -= n[0] * bounce; v[1] -= n[1] * bounce; v[2] -= n[2] * bounce;
      // friction
      const fr = b.type === 'ball' ? 0.985 : b.type === 'coin' ? 0.8 : 0.93;
      v[0] *= fr; v[2] *= fr;
    }
    if (n[1] > 0.5) b.onGround = true;
  }

  /** counts for the tally */
  tally() {
    let afloat = 0, sunk = 0;
    for (const b of this.list) {
      if (!this.insideBlock(b.p)) continue;
      const surf = WATER + this.w.sea.height(b.p[0], b.p[2]);
      if (b.p[1] < surf + b.r && b.p[1] > surf - b.r * 1.6) afloat++;
      else if (b.p[1] < surf - b.r * 1.6 && b.onGround) sunk++;
    }
    return { afloat, sunk };
  }
}

function norm(a) { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); }
function horizontalOf(a) { const h = [a[0], 0, a[2]]; const l = Math.hypot(...h); return l < 1e-3 ? [1, 0, 0] : h.map((x) => x / l); }
function closestOnSeg(a, b, p) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
  return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
}
