// The knife: a nakiri mesh, the stroke -> blade-plane logic, and the cut sequence
// (line up, press a groove, cut straight down, lift) while new pieces build incrementally.
import { buildPiece } from './mesher.js';
import { bodyFromParent } from './physics.js';
import { MAX_PIECES, pipExtent } from './orange.js';

export function buildKnifeMesh() {
  const out = [];
  const tri = (a, b, c, mat) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) out.push(p[0], p[1], p[2], nx, ny, nz, mat);
  };
  const quad = (a, b, c, d, mat) => { tri(a, b, c, mat); tri(a, c, d, mat); };
  // blade: profile in (y, z), extruded along x. Edge at y = 0, spine at y = 1.2.
  const prof = [[0, 0], [0.05, 0.004], [0.2, 0.011], [0.7, 0.016], [1.18, 0.018], [1.2, 0.012]];
  const ring = [...prof.map(([y, z]) => [y, z]), ...prof.slice().reverse().map(([y, z]) => [y, -z])];
  const x0 = -2.0, x1 = 2.0;
  // nakiri: square tip, the heel corner slightly rounded
  const xAt = (end, y) => (end ? x1 : x0) + (end ? 0 : 0) - (y > 1.05 ? (end ? (y - 1.05) * 0.4 : -(y - 1.05) * 0.4) : 0);
  for (let i = 0; i < ring.length - 1; i++) {
    const [ya, za] = ring[i], [yb, zb] = ring[i + 1];
    quad([xAt(0, ya), ya, za], [xAt(1, ya), ya, za], [xAt(1, yb), yb, zb], [xAt(0, yb), yb, zb], 0);
  }
  for (const end of [0, 1]) {
    const c = [end ? x1 : x0, 0.6, 0];
    for (let i = 0; i < ring.length - 1; i++) {
      const [ya, za] = ring[i], [yb, zb] = ring[i + 1];
      const a = [xAt(end, ya), ya, za], b = [xAt(end, yb), yb, zb];
      if (end) tri(c, a, b, 0); else tri(c, b, a, 0);
    }
  }
  // ferrule + octagonal wa handle
  const prism = (xa, xb, cy, r, sides, mat) => {
    for (let i = 0; i < sides; i++) {
      const a0 = ((i + 0.5) / sides) * Math.PI * 2, a1 = ((i + 1.5) / sides) * Math.PI * 2;
      const p = (x, a) => [x, cy + Math.cos(a) * r, Math.sin(a) * r];
      quad(p(xa, a0), p(xb, a0), p(xb, a1), p(xa, a1), mat);
      tri([xa, cy, 0], p(xa, a1), p(xa, a0), mat);
      tri([xb, cy, 0], p(xb, a0), p(xb, a1), mat);
    }
  };
  prism(1.98, 2.3, 0.98, 0.115, 8, 2);
  prism(2.3, 4.7, 0.98, 0.105, 8, 1);
  return new Float32Array(out);
}

const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

export class Cutter {
  constructor(app) {
    this.app = app;
    this.state = null;
  }
  get busy() { return !!this.state; }

  /** Work out the blade plane for a screen stroke (CSS px), or null if it misses. */
  plan(p0, p1, samples = 40) {
    const { world, camera } = this.app;
    const hits = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const ray = camera.ray(p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t);
      const h = world.raycast(ray.origin, ray.dir);
      if (h) { h.origin = ray.origin; h.dir = ray.dir; hits.push(h); }
    }
    if (!hits.length) return null;
    // read the stroke on the top of what it crosses
    const top = Math.max(...hits.map((h) => h.point[1]));
    const onTop = (sx, sy) => {
      const r = camera.ray(sx, sy);
      if (Math.abs(r.dir[1]) < 1e-3) return null;
      const t = (top - r.origin[1]) / r.dir[1];
      if (t < 0) return null;
      return [r.origin[0] + r.dir[0] * t, top, r.origin[2] + r.dir[2] * t];
    };
    let A = onTop(p0[0], p0[1]), B = onTop(p1[0], p1[1]);
    if (!A || !B) { A = hits[0].point; B = hits[hits.length - 1].point; }
    let dx = B[0] - A[0], dz = B[2] - A[2];
    const len = Math.hypot(dx, dz);
    if (len < 0.25) return null;
    dx /= len; dz /= len;
    const dir = [dx, 0, dz];
    const n = [-dz, 0, dx]; // dir x up
    // The blade passes through the stroke where it runs through the middle of each
    // piece it crosses (closest approach of each hit ray to that piece's centre).
    let hx = 0, hz = 0;
    for (const h of hits) {
      const b = h.body, o = h.origin, d = h.dir;
      const t = (b.com[0] - o[0]) * d[0] + (b.com[1] - o[1]) * d[1] + (b.com[2] - o[2]) * d[2];
      hx += o[0] + d[0] * t; hz += o[2] + d[2] * t;
    }
    hx /= hits.length; hz /= hits.length;
    const c = n[0] * hx + n[2] * hz;
    const aA = dx * A[0] + dz * A[2], aB = dx * B[0] + dz * B[2];
    const a0 = Math.min(aA, aB) - 0.12, a1 = Math.max(aA, aB) + 0.12;

    // which pieces does the stroke cross?
    const crossed = [];
    let lo = Infinity, hi = -Infinity, topY = 0;
    for (const b of world.bodies) {
      let mn = Infinity, mx = -Infinity, inSeg = false, bTop = 0, blo = Infinity, bhi = -Infinity;
      for (let i = 0; i < b.n; i++) {
        const x = b.x[i * 3], y = b.x[i * 3 + 1], z = b.x[i * 3 + 2];
        const s = n[0] * x + n[2] * z - c;
        if (s < mn) mn = s; if (s > mx) mx = s;
        const al = dx * x + dz * z;
        if (Math.abs(s) < 0.15 && al > a0 && al < a1) { inSeg = true; if (y > bTop) bTop = y; if (al < blo) blo = al; if (al > bhi) bhi = al; }
      }
      if (inSeg && mn < -0.07 && mx > 0.07) {
        crossed.push(b);
        lo = Math.min(lo, blo); hi = Math.max(hi, bhi); topY = Math.max(topY, bTop);
      }
    }
    if (!crossed.length) return null;
    const mid = (lo + hi) / 2;
    return { n, c, dir, crossed, lo, hi, top: topY, center: [n[0] * c + dx * mid, 0, n[2] * c + dz * mid] };
  }

  /** Hover the knife where a stroke in progress would cut. */
  preview(p0, p1) {
    if (this.state) return;
    this.ghost = p0 ? this.plan(p0, p1, 16) : null;
  }

  /** p0, p1: screen points (CSS px). Returns true if a cut started. */
  tryStroke(p0, p1) {
    const { world } = this.app;
    this.ghost = null;
    if (this.state) return false;
    const P = this.plan(p0, p1);
    if (!P) return false;
    const { n, c, dir, crossed, lo, hi, top: topY } = P;
    const room = MAX_PIECES - world.bodies.length;
    if (room <= 0) { this.app.toast?.('max'); return false; }
    crossed.length = Math.min(crossed.length, room);

    const jobs = crossed.map((b) => {
      b.wake();
      b.updateFit();
      const nr = b.worldDirToRest(n);
      const l = Math.hypot(nr[0], nr[1], nr[2]);
      nr[0] /= l; nr[1] /= l; nr[2] /= l;
      const cr = c - (n[0] * b.com[0] + n[2] * b.com[2]) + (nr[0] * b.restCom[0] + nr[1] * b.restCom[1] + nr[2] * b.restCom[2]);
      const planes = b.piece.planes;
      return {
        body: b, nr, cr,
        genA: buildPiece([...planes, nr[0], nr[1], nr[2], cr]),
        genB: buildPiece([...planes, -nr[0], -nr[1], -nr[2], -cr]),
        resA: null, resB: null,
      };
    });
    this.state = {
      phase: 'align', t: 0, n, c, dir, a0: lo - 0.3, a1: hi + 0.3, top: topY,
      center: P.center,
      edgeY: topY + 1.5, jobs, children: [],
    };
    return true;
  }

  buildsDone() {
    return this.state.jobs.every((j) => j.resA && j.resB);
  }

  runBuilds(budgetMs) {
    const t0 = performance.now();
    for (const j of this.state.jobs) {
      while (!j.resA && performance.now() - t0 < budgetMs) { const r = j.genA.next(); if (r.done) j.resA = r.value; }
      while (!j.resB && performance.now() - t0 < budgetMs) { const r = j.genB.next(); if (r.done) j.resB = r.value; }
      if (performance.now() - t0 >= budgetMs) return;
    }
  }

  update(dt) {
    const S = this.state;
    if (!S) return;
    const world = this.app.world;
    this.runBuilds(this.app.buildBudget || 9);
    S.t += dt;
    const knifeBase = { n: S.n, c: S.c, dir: S.dir, a0: S.a0, a1: S.a1 };
    if (S.phase === 'align') {
      S.edgeY = S.top + 1.5 - (1.5 - 0.12) * ease(S.t / 0.42);
      if (S.t >= 0.42) { S.phase = 'press'; S.t = 0; }
    } else if (S.phase === 'press') {
      S.edgeY = S.top + 0.12 - 0.27 * ease(S.t / 0.38);
      world.knife = { ...knifeBase, mode: 'groove', edgeY: S.edgeY, targets: new Set(S.jobs.map((j) => j.body)) };
      if (S.t >= 0.38 && this.buildsDone()) { this.swap(); S.phase = 'cut'; S.t = 0; S.start = S.edgeY; }
    } else if (S.phase === 'cut') {
      const k = Math.min(1, S.t / 0.32);
      S.edgeY = S.start + (-0.03 - S.start) * (k * k);
      world.knife = { ...knifeBase, mode: 'wedge', edgeY: S.edgeY };
      if (S.t >= 0.5) { S.phase = 'lift'; S.t = 0; world.knife = null; for (const b of S.children) b.side = 0; }
    } else if (S.phase === 'lift') {
      S.edgeY = -0.03 + (S.top + 1.8) * ease(S.t / 0.45);
      if (S.t >= 0.45) { this.state = null; world.knife = null; }
    }
  }

  swap() {
    const S = this.state;
    const { world, anatomy } = this.app;
    let changed = false;
    this.app.lastCut = S.jobs.map((j) => ({ a: j.resA?.sliver, b: j.resB?.sliver, va: j.resA?.volume, vb: j.resB?.volume, nr: j.nr, cr: j.cr }));
    for (const j of S.jobs) {
      const { body, resA, resB, nr, cr } = j;
      if (!resA || !resB || resA.sliver || resB.sliver) continue;
      if (world.bodies.length + 1 > MAX_PIECES) continue;
      const idx = world.bodies.indexOf(body);
      if (idx < 0) continue;
      const bA = bodyFromParent(resA, body);
      const bB = bodyFromParent(resB, body);
      bA.side = -1; bB.side = 1;
      // the blade wedges the faces apart
      for (const [b, sgn] of [[bA, -1], [bB, 1]]) {
        for (let i = 0; i < b.n; i++) {
          const s = S.n[0] * b.x[i * 3] + S.n[2] * b.x[i * 3 + 2] - S.c;
          const f = Math.max(0, 1 - Math.abs(s) / 0.6);
          b.v[i * 3] += S.n[0] * sgn * 0.3 * f;
          b.v[i * 3 + 2] += S.n[2] * sgn * 0.3 * f;
        }
      }
      world.bodies.splice(idx, 1, bA, bB);
      if (world.grab?.body === body) world.grab = null;
      // pips: kept by the side holding their centre, eased just under the new face
      for (const pip of anatomy.pips) {
        if (pip.owner !== body.id) continue;
        const s = nr[0] * pip.pos[0] + nr[1] * pip.pos[1] + nr[2] * pip.pos[2] - cr;
        const margin = pipExtent(pip, nr) + 0.035;
        if (s <= 0) {
          pip.owner = bA.id;
          if (s > -margin) for (let a = 0; a < 3; a++) pip.pos[a] -= nr[a] * (s + margin);
        } else {
          pip.owner = bB.id;
          if (s < margin) for (let a = 0; a < 3; a++) pip.pos[a] += nr[a] * (margin - s);
        }
      }
      S.children.push(bA, bB);
      changed = true;
    }
    if (changed) this.app.onBodiesChanged();
    else this.app.toast?.('thin');
  }

  /** Column-major model matrix of the knife, or null when hidden. */
  model() {
    const S = this.state || (this.ghost && { ...this.ghost, edgeY: this.ghost.top + 0.45 });
    if (!S) return null;
    const d = S.dir, n = S.n;
    const m = new Float32Array(16);
    m[0] = d[0]; m[1] = 0; m[2] = d[2];
    m[4] = 0; m[5] = 1; m[6] = 0;
    m[8] = n[0]; m[9] = 0; m[10] = n[2];
    m[12] = S.center[0]; m[13] = S.edgeY; m[14] = S.center[2]; m[15] = 1;
    return m;
  }
}
