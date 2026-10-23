import { Renderer, GRID } from './renderer.js';
import { buildScene, OBJ, chestInfo, anchorInfo, SIZES } from './geometry.js';
import { X } from './builder.js';
import { HALF, WATER, PLACES, PALMS, groundHeight, skullSdf } from './world.js';
import { Sea } from './sea.js';
import { Ship } from './ship.js';
import { Bodies } from './bodies.js';
import { Particles, KIND } from './particles.js';
import { m4, v3, clamp, lerp, smoothstep } from './math.js';
import { STRINGS, applyLang } from './i18n.js';

const $ = (id) => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- time of day keyframes -----------------------------------------------------------
const TOD = [
  { dir: [-0.35, 0.9, -0.25], col: [1.0, 0.97, 0.92], I: 3.0, sky: [0.42, 0.45, 0.5], top: [0.62, 0.6, 0.57], bot: [0.8, 0.77, 0.72], stars: 0, night: 0, fire: 0.55, exp: 1.0 },
  { dir: [-0.55, 0.72, -0.3], col: [1.0, 0.92, 0.8], I: 2.8, sky: [0.42, 0.42, 0.44], top: [0.66, 0.6, 0.55], bot: [0.84, 0.76, 0.68], stars: 0, night: 0, fire: 0.55, exp: 1.0 },
  { dir: [-0.82, 0.38, -0.3], col: [1.0, 0.74, 0.45], I: 2.5, sky: [0.42, 0.35, 0.32], top: [0.86, 0.62, 0.46], bot: [0.96, 0.78, 0.6], stars: 0, night: 0, fire: 0.75, exp: 1.0 },
  { dir: [-0.93, 0.12, -0.28], col: [1.0, 0.5, 0.28], I: 1.8, sky: [0.34, 0.25, 0.26], top: [0.58, 0.36, 0.42], bot: [0.95, 0.58, 0.44], stars: 0, night: 0.15, fire: 1.1, exp: 1.05 },
  { dir: [0.3, 0.55, -0.5], col: [0.55, 0.5, 0.75], I: 0.55, sky: [0.15, 0.13, 0.22], top: [0.17, 0.14, 0.28], bot: [0.42, 0.3, 0.4], stars: 0.35, night: 0.6, fire: 1.9, exp: 1.15 },
  { dir: [0.45, 0.75, -0.48], col: [0.55, 0.65, 0.95], I: 0.42, sky: [0.06, 0.07, 0.13], top: [0.02, 0.03, 0.08], bot: [0.05, 0.06, 0.13], stars: 0.9, night: 1, fire: 2.6, exp: 1.25 },
  { dir: [0.5, 0.82, -0.3], col: [0.5, 0.6, 0.95], I: 0.32, sky: [0.04, 0.05, 0.1], top: [0.01, 0.015, 0.05], bot: [0.03, 0.035, 0.09], stars: 1, night: 1, fire: 2.8, exp: 1.3 },
];
function todAt(t) {
  const f = clamp(t, 0, 1) * (TOD.length - 1);
  const i = Math.min(TOD.length - 2, Math.floor(f)), k = smoothstep(0, 1, f - i);
  const a = TOD[i], b = TOD[i + 1];
  const L = (x, y) => (Array.isArray(x) ? x.map((v, j) => lerp(v, y[j], k)) : lerp(x, y, k));
  const o = {};
  for (const key of Object.keys(a)) o[key] = L(a[key], b[key]);
  o.dir = v3.norm(o.dir);
  return o;
}

const FLAVOURS = {
  turquoise: { absorb: [1.7, 0.36, 0.3], scatter: 0.35, color: [0.25, 0.78, 0.76], foam: 1 },
  rum: { absorb: [0.22, 0.75, 1.75], scatter: 0.45, color: [0.9, 0.52, 0.16], foam: 0.95 },
  kraken: { absorb: [0.95, 1.5, 0.35], scatter: 0.4, color: [0.52, 0.3, 0.86], foam: 0.9 },
};

class OrbitCam {
  constructor() { this.reset(); }
  reset() { this.az = Math.PI / 4; this.el = (27 * Math.PI) / 180; this.dist = 13.6; this.target = [0.35, 1.05, -0.35]; }
  update(aspect) {
    const ce = Math.cos(this.el);
    const dist = this.dist * (aspect < 0.8 ? 1.12 : 1);
    this.pos = [this.target[0] + Math.sin(this.az) * ce * dist, this.target[1] + Math.sin(this.el) * dist, this.target[2] + Math.cos(this.az) * ce * dist];
    const fov = (30 * Math.PI) / 180;
    const f2 = aspect < 1 ? 2 * Math.atan(Math.tan(fov / 2) / Math.max(aspect, 0.5)) : fov;
    this.viewProj = m4.mul(m4.perspective(f2, aspect, 0.1, 80), m4.lookAt(this.pos, this.target, [0, 1, 0]));
    this.invViewProj = m4.invert(this.viewProj);
  }
  ray(el, sx, sy) {
    const r = el.getBoundingClientRect();
    const nx = ((sx - r.left) / r.width) * 2 - 1, ny = 1 - ((sy - r.top) / r.height) * 2;
    const a = m4.transformPoint(this.invViewProj, [nx, ny, 0]), b = m4.transformPoint(this.invViewProj, [nx, ny, 1]);
    return { o: a, d: v3.norm(v3.sub(b, a)) };
  }
}

class App {
  constructor() {
    this.lang = (navigator.language || '').startsWith('zh') ? 'zh' : 'en';
    try { const s = localStorage.getItem('pj-lang'); if (s) this.lang = s; } catch {}
    this.S = applyLang(this.lang);
    this.canvas = $('gpu');
    this.cam = new OrbitCam();
    this.flavour = 'turquoise';
    this.tod = 0.12;
    this.firm = 0.5;
    this.paused = false;
    this.time = 0;
    this.motion = reduced ? 0.3 : 1;
    this.shots = 0;
    this.fireBoost = 0;
    this.lid = 0; this.lidV = 0; this.lidOpen = false;
    this.palmBend = PALMS.map(() => [0, 0, 0, 0]); // x, z, vx, vz
    this.tilt = { ax: 0, az: 0, vax: 0, vaz: 0, tax: 0, taz: 0 };
    this.wob = { sx: 0, sz: 0, vsx: 0, vsz: 0, sq: 0, vsq: 0 };
    this.objects = new Float32Array(OBJ.COUNT * 16);
    this.bindUI();
  }

  async start() {
    try { this.r = await Renderer.create(this.canvas); }
    catch (e) { console.warn(e); return this.fallback(); }
    await new Promise((res) => setTimeout(res, 30));
    const scene = buildScene();
    this.colliders = scene.colliders;
    this.r.setScene(scene.mesh);
    // static ground height texture (with the skull's footprint) for foam and the walls
    const gd = new Float32Array(256 * 256);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const x = -HALF + ((i + 0.5) / 256) * 2 * HALF, z = -HALF + ((j + 0.5) / 256) * 2 * HALF;
      let h = groundHeight(x, z);
      if (skullSdf(x, WATER, z) < 0) h = Math.max(h, WATER + 0.3);
      gd[j * 256 + i] = h;
    }
    this.r.setGround(gd);
    this.sea = new Sea(GRID);
    this.ship = new Ship(this.sea);
    this.fx = new Particles();
    this.fxApi = this.makeFx();
    this.bodies = new Bodies({ sea: this.sea, ship: this.ship, colliders: this.colliders, fx: this.fxApi, palmBend: this.palmBend });
    this.resize();
    addEventListener('resize', () => this.resize());
    $('loading').hidden = true;
    this.setPill();
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  fallback() {
    document.body.classList.add('unavailable');
    $('loading').hidden = true;
    $('fallback').hidden = false;
    this.setPill('unavailable');
  }

  setPill(force) {
    const k = force || (this.paused ? 'paused' : 'live');
    const p = $('pill');
    p.classList.toggle('paused', k === 'paused');
    p.classList.toggle('off', k === 'unavailable');
    $('pillText').dataset.i18n = k;
    $('pillText').textContent = this.S[k];
  }

  resize() {
    if (!this.r) return;
    let dpr = Math.min(devicePixelRatio || 1, 2);
    const w = innerWidth, h = innerHeight;
    const maxPx = 3.0e6;
    if (w * h * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (w * h));
    this.r.resize(Math.max(2, Math.round(w * dpr)), Math.max(2, Math.round(h * dpr)));
  }

  // ---- UI ------------------------------------------------------------------------------
  bindUI() {
    $('lang').onclick = () => {
      this.lang = this.lang === 'en' ? 'zh' : 'en';
      try { localStorage.setItem('pj-lang', this.lang); } catch {}
      this.S = applyLang(this.lang);
      this.setPill(this.r ? undefined : 'unavailable');
      $('bPause').textContent = this.paused ? this.S.resume : this.S.pause;
      this.updateLabels();
    };
    $('bFire').onclick = () => this.fireGun();
    $('bCoins').onclick = () => this.dropCoins();
    $('bBarrel').onclick = () => this.dropBarrel();
    $('bReset').onclick = () => this.reset();
    $('bView').onclick = () => this.cam.reset();
    $('bPause').onclick = () => {
      this.paused = !this.paused;
      $('bPause').dataset.i18n = this.paused ? 'resume' : 'pause';
      $('bPause').textContent = this.paused ? this.S.resume : this.S.pause;
      this.setPill();
    };
    $('sheet').onclick = () => document.body.classList.toggle('sheet-open');
    for (const b of $('flavours').children) b.onclick = () => {
      this.flavour = b.dataset.flavour;
      document.body.dataset.flavour = this.flavour;
      for (const o of $('flavours').children) o.setAttribute('aria-pressed', o === b);
    };
    $('sFirm').oninput = () => { this.firm = +$('sFirm').value; this.updateLabels(); };
    $('sDamp').oninput = () => this.updateLabels();
    $('sTod').oninput = () => { this.tod = +$('sTod').value; this.updateLabels(); };
    addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); this.fireGun(); }
    });
    this.updateLabels();
    this.bindPointer();
  }

  updateLabels() {
    $('oFirm').textContent = Math.round(+$('sFirm').value * 100);
    $('oDamp').textContent = Math.round(+$('sDamp').value * 100);
    const names = this.S.times;
    $('oTod').textContent = names[Math.round(this.tod * (names.length - 1))];
    $('ticks').innerHTML = [names[0], names[3], names[6]].map((n) => `<span>${n}</span>`).join('');
  }

  reset() {
    if (!this.r) return;
    this.sea.eta.fill(0); this.sea.u.fill(0); this.sea.v.fill(0);
    this.ship.reset();
    this.bodies.reset();
    this.fx.n = 0;
    this.shots = 0;
    this.lid = 0; this.lidV = 0; this.lidOpen = false;
    for (const p of this.palmBend) p.fill(0);
    Object.assign(this.tilt, { ax: 0, az: 0, vax: 0, vaz: 0, tax: 0, taz: 0 });
    Object.assign(this.wob, { sx: 0, sz: 0, vsx: 0, vsz: 0, sq: 0, vsq: 0 });
  }

  // ---- block transform (tip + jelly wobble) ---------------------------------------------------
  blockXf() {
    const T = this.tilt, W = this.wob;
    const R = X.mul(X.RX(T.ax), X.RZ(T.az));
    const shear = { m: [1 + W.sq * -0.5, W.sx, 0, 0, 1 + W.sq, 0, 0, W.sz, 1 + W.sq * -0.5], t: [0, 0, 0] };
    const M = X.mul(R, shear);
    let lift = 0;
    for (const cx of [-HALF, HALF]) for (const cz of [-HALF, HALF]) lift = Math.max(lift, -X.p(M, [cx, 0, cz])[1]);
    return X.mul(X.T(0, lift, 0), M);
  }

  toLocal(p) { return m4.transformPoint(this.blockInv, p); }
  dirToLocal(d) {
    const a = m4.transformPoint(this.blockInv, [0, 0, 0]), b = m4.transformPoint(this.blockInv, d);
    return v3.norm(v3.sub(b, a));
  }

  // ---- effects ----------------------------------------------------------------------------
  makeFx() {
    const P = () => this.fx;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const k = () => (reduced ? 0.5 : 1);
    return {
      splash: (p, speed, type) => {
        const n = Math.round(Math.min(34, 8 + speed * 9) * k() * (type === 'coin' ? 0.3 : 1));
        const s = WATER + this.sea.height(p[0], p[2]);
        for (let i = 0; i < n; i++) {
          const a = rnd(0, 6.28), r = rnd(0.2, 0.9) * Math.min(1.6, 0.4 + speed * 0.3);
          P().emit(KIND.SPRAY, [p[0], s + 0.01, p[2]], [Math.cos(a) * r * 0.5, rnd(0.6, 1.4) * Math.min(1.8, 0.5 + speed * 0.35), Math.sin(a) * r * 0.5], rnd(0.5, 0.9), 0.012, 0.03, [0.95, 0.97, 1, 0.85], [0.95, 0.97, 1, 0], 0.6, -7);
        }
        for (let i = 0; i < n * 0.6; i++) P().emit(KIND.BUBBLE, [p[0] + rnd(-0.05, 0.05), s - rnd(0.03, 0.2), p[2] + rnd(-0.05, 0.05)], [0, rnd(0.1, 0.3), 0], rnd(1.5, 3), rnd(0.006, 0.016), 0.012, [0.9, 0.97, 1, 0.7], [0.9, 0.97, 1, 0.5], 1.2, 0.4);
        this.wob.vsq -= 0.02 * Math.min(speed, 4); this.wob.vsx += (Math.random() - 0.5) * 0.02; this.wob.vsz += (Math.random() - 0.5) * 0.02;
      },
      bubble: (p) => P().emit(KIND.BUBBLE, p.slice(), [0, 0.2, 0], 2.5, 0.008, 0.012, [0.9, 0.97, 1, 0.7], [0.9, 0.97, 1, 0.4], 1.0, 0.3),
      sandPuff: (p) => {
        for (let i = 0; i < 10 * k(); i++) { const a = rnd(0, 6.28); P().emit(KIND.SAND, [p[0], p[1] - 0.02, p[2]], [Math.cos(a) * 0.25, rnd(0.1, 0.35), Math.sin(a) * 0.25], rnd(0.6, 1.0), 0.02, 0.07, [0.86, 0.75, 0.55, 0.55], [0.86, 0.75, 0.55, 0], 2.5, -0.3); }
      },
    };
  }

  fireGun() {
    if (!this.r) return;
    const camL = this.toLocal(this.cam.pos);
    const side = this.ship.sideFacing(camL);
    const s = this.ship.fire(side);
    const muzzle = v3.add(s.pos, v3.scale(s.dir, 0.06));
    this.bodies.spawn('ball', muzzle, s.vel);
    this.shots++;
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < 10; i++) this.fx.emit(KIND.GLOW, v3.add(muzzle, v3.scale(s.dir, rnd(0, 0.06))), v3.scale(s.dir, rnd(0.3, 1.0)), rnd(0.06, 0.14), rnd(0.05, 0.1), 0.02, [1.0, 0.75, 0.35, 1], [1.0, 0.35, 0.1, 0], 6, 0);
    for (let i = 0; i < 18 * (reduced ? 0.5 : 1); i++) {
      const sp = rnd(0.1, 0.6);
      this.fx.emit(KIND.SMOKE, v3.add(muzzle, [rnd(-0.02, 0.02), rnd(-0.02, 0.02), rnd(-0.02, 0.02)]), [s.dir[0] * sp + rnd(-0.05, 0.05), s.dir[1] * sp + rnd(0.02, 0.12), s.dir[2] * sp + rnd(-0.05, 0.05)], rnd(1.8, 3.2), rnd(0.03, 0.06), rnd(0.14, 0.26), [0.95, 0.95, 0.93, 0.55], [0.9, 0.9, 0.9, 0], 2.2, 0.06);
    }
    for (let i = 0; i < 6; i++) this.fx.emit(KIND.EMBER, muzzle, v3.add(v3.scale(s.dir, rnd(0.8, 1.6)), [rnd(-0.2, 0.2), rnd(0, 0.3), rnd(-0.2, 0.2)]), rnd(0.2, 0.4), 0.008, 0.004, [1, 0.8, 0.4, 1], [1, 0.4, 0.1, 0], 1, -3);
    this.sea.disturb(this.ship.x, this.ship.z, 0.25, -0.01);
    this.wob.vsx += s.dir[0] * -0.01; this.wob.vsz += s.dir[2] * -0.01;
  }

  dropCoins(at) {
    if (!this.r) return;
    for (let i = 0; i < 6; i++) {
      const x = at ? at[0] : 0.2 + (Math.random() - 0.5) * 2.2, z = at ? at[2] : 0.9 + (Math.random() - 0.5) * 1.4;
      const v = at ? [(Math.random() - 0.5) * 0.6, 1.4 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6] : [0, -0.2, 0];
      const y = at ? at[1] + 0.03 : WATER + 1.1 + Math.random() * 0.5;
      this.bodies.spawn('coin', [x + (at ? 0 : 0), y, z], v, { w: [(Math.random() - 0.5) * 20, 0, (Math.random() - 0.5) * 20] });
      if (at) break;
    }
  }
  dropBarrel() {
    if (!this.r) return;
    const x = 0.2 + (Math.random() - 0.5) * 2.0, z = 1.0 + (Math.random() - 0.5) * 1.2;
    this.bodies.spawn('barrel', [x, WATER + 1.3, z], [0, -0.2, 0], { w: [(Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4] });
  }
  roar() {
    this.fireBoost = 1.6;
    const f = this.firePos();
    for (let i = 0; i < 40; i++) this.fx.emit(KIND.EMBER, [f[0], f[1] + 0.05, f[2]], [(Math.random() - 0.5) * 0.9, 0.8 + Math.random() * 1.2, (Math.random() - 0.5) * 0.9], 1 + Math.random() * 1.5, 0.01, 0.004, [1, 0.75, 0.3, 1], [1, 0.3, 0.05, 0], 0.8, -0.4);
  }
  popX() {
    const { x, z } = PLACES.xmark;
    const y = groundHeight(x, z);
    for (let i = 0; i < 3; i++) setTimeout(() => this.dropCoins([x + (Math.random() - 0.5) * 0.05, y, z + (Math.random() - 0.5) * 0.05]), i * 120);
    this.fxApi.sandPuff([x, y + 0.02, z]);
  }
  firePos() { const { x, z } = PLACES.fire; return [x, groundHeight(x, z) + 0.06, z]; }

  // ---- picking -------------------------------------------------------------------------------
  pick(sx, sy) {
    const ray = this.cam.ray(this.canvas, sx, sy);
    const o = this.toLocal(ray.o), d = this.dirToLocal(ray.d);
    const hits = [];
    const sphere = (c, r, what, extra) => {
      const oc = v3.sub(o, c), b = v3.dot(oc, d), cc = v3.dot(oc, oc) - r * r, h = b * b - cc;
      if (h > 0) { const t = -b - Math.sqrt(h); if (t > 0) hits.push({ t, what, ...extra }); }
    };
    // ship (ellipsoid around hull and rig)
    {
      const xf = this.ship.xf(), m = xf.m;
      const rel = v3.sub(o, xf.t);
      const tl = (v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
      const lo = v3.sub(tl(rel), [0, 0.35, 0]), ld = tl(d);
      const R = [0.75, 0.75, 0.3];
      const so = lo.map((v, i) => v / R[i]), sd = ld.map((v, i) => v / R[i]);
      const a = v3.dot(sd, sd), b = v3.dot(so, sd), c = v3.dot(so, so) - 1, h = b * b - a * c;
      if (h > 0) { const t = (-b - Math.sqrt(h)) / a; if (t > 0) hits.push({ t, what: 'ship' }); }
    }
    const ci = chestInfo();
    sphere([ci.x, ci.y + 0.08, ci.z], 0.15, 'chest');
    sphere(this.firePos(), 0.15, 'fire');
    { const { x, z } = PLACES.xmark; sphere([x, groundHeight(x, z) + 0.02, z], 0.13, 'xmark'); }
    for (const b of this.bodies.list) sphere(b.p, b.r * 1.8 + 0.02, 'body', { body: b });
    PALMS.forEach((p, i) => {
      const y0 = groundHeight(p[0], p[1]);
      const pb = this.palmBend[i];
      const top = [p[0] + Math.cos(p[3]) * p[4] * p[2] + pb[0], y0 + p[2], p[1] + Math.sin(p[3]) * p[4] * p[2] + pb[1]];
      for (let k = 0; k <= 8; k++) sphere(v3.add([p[0], y0, p[1]], v3.scale(v3.sub(top, [p[0], y0, p[1]]), k / 8)), k === 8 ? 0.16 : 0.06, 'palm', { palm: i, top });
    });
    // terrain (march) and water
    let tGround = Infinity;
    for (let t = 0; t < 30; t += 0.02) {
      const p = v3.add(o, v3.scale(d, t));
      if (Math.abs(p[0]) > HALF + 0.01 || Math.abs(p[2]) > HALF + 0.01) { if (t > 1 && p[1] < 0) break; continue; }
      if (p[1] < groundHeight(p[0], p[2])) { tGround = t; break; }
    }
    if (tGround < Infinity) hits.push({ t: tGround, what: 'ground', p: v3.add(o, v3.scale(d, tGround)) });
    if (Math.abs(d[1]) > 1e-4) {
      const t = (WATER - o[1]) / d[1], p = v3.add(o, v3.scale(d, t));
      if (t > 0 && Math.abs(p[0]) < HALF && Math.abs(p[2]) < HALF && groundHeight(p[0], p[2]) < WATER) hits.push({ t, what: 'water', p });
    }
    // block sides (for tipping)
    {
      const inv = d.map((v) => 1 / v);
      const t0 = [(-HALF - o[0]) * inv[0], (0 - o[1]) * inv[1], (-HALF - o[2]) * inv[2]];
      const t1 = [(HALF - o[0]) * inv[0], (WATER - o[1]) * inv[1], (HALF - o[2]) * inv[2]];
      const tmin = [0, 1, 2].map((i) => Math.min(t0[i], t1[i])), tmax = [0, 1, 2].map((i) => Math.max(t0[i], t1[i]));
      const tn = Math.max(...tmin), tf = Math.min(...tmax);
      if (tf > tn && tn > 0) {
        const axis = tmin.indexOf(tn);
        if (axis !== 1) {
          const n = [0, 0, 0]; n[axis] = Math.sign(o[axis]);
          hits.push({ t: tn, what: 'side', n, p: v3.add(o, v3.scale(d, tn)) });
        }
      }
    }
    hits.sort((a, b) => a.t - b.t);
    return { hit: hits[0] || null, o, d, ray };
  }

  bindPointer() {
    const c = this.canvas;
    const pointers = new Map();
    let drag = null, pinch = null;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      if (!this.r) return;
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), dist: this.cam.dist };
        drag = null;
        return;
      }
      const orbitOnly = e.button === 2 || e.button === 1;
      const { hit } = orbitOnly ? { hit: null } : this.pick(e.clientX, e.clientY);
      drag = { kind: 'orbit', hit, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: 0, t0: performance.now() };
      if (hit) {
        if (hit.what === 'ship') drag.kind = 'ship';
        else if (hit.what === 'body') { drag.kind = 'body'; drag.body = hit.body; hit.body.held = true; drag.trail = []; drag.planeY = hit.body.p[1]; }
        else if (hit.what === 'palm') { drag.kind = 'palm'; this.dragPalm = hit.palm; }
        else if (hit.what === 'water') drag.kind = 'water';
        else if (hit.what === 'side') { drag.kind = 'side'; drag.n = hit.n; }
        else if (hit.what === 'chest' || hit.what === 'fire' || hit.what === 'xmark') drag.kind = 'tap';
      }
      document.body.classList.add('dragging');
    });
    c.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        this.cam.dist = clamp(pinch.dist * pinch.d / Math.max(20, Math.hypot(a[0] - b[0], a[1] - b[1])), 6, 22);
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.hypot(dx, dy);
      drag.x = e.clientX; drag.y = e.clientY;
      const K = drag.kind;
      if (K === 'orbit' || (K === 'tap' && drag.moved > 8)) {
        drag.kind = 'orbit';
        this.cam.az -= dx * 0.006;
        this.cam.el = clamp(this.cam.el + dy * 0.005, 0.08, 1.3);
      } else if (K === 'ship' && drag.moved > 6) {
        const { o, d } = this.pick(e.clientX, e.clientY);
        if (Math.abs(d[1]) > 1e-3) { const t = (WATER - o[1]) / d[1]; const p = v3.add(o, v3.scale(d, t)); this.ship.tow = [clamp(p[0], -1.8, 1.8), clamp(p[2], -1.8, 1.8)]; }
      } else if (K === 'body') {
        const { o, d } = this.pick(e.clientX, e.clientY);
        const y = Math.max(drag.planeY, WATER + 0.12);
        if (Math.abs(d[1]) > 1e-3) {
          const t = (y - o[1]) / d[1];
          const p = v3.add(o, v3.scale(d, t));
          const b = drag.body;
          p[1] = y;
          b.p = p; b.v = [0, 0, 0];
          drag.trail.push([performance.now(), p]);
          if (drag.trail.length > 6) drag.trail.shift();
        }
      } else if (K === 'palm') {
        const i = drag.hit.palm;
        const { o, d } = this.pick(e.clientX, e.clientY);
        const top = drag.hit.top;
        const t = (top[1] - o[1]) / (d[1] || 1e-3);
        const p = v3.add(o, v3.scale(d, t));
        let bx = p[0] - (top[0] - this.palmBend[i][0]), bz = p[2] - (top[2] - this.palmBend[i][1]);
        const l = Math.hypot(bx, bz), mx = 0.3;
        if (l > mx) { bx *= mx / l; bz *= mx / l; }
        this.palmBend[i][0] = bx; this.palmBend[i][1] = bz; this.palmBend[i][2] = 0; this.palmBend[i][3] = 0;
      } else if (K === 'water') {
        const { o, d } = this.pick(e.clientX, e.clientY);
        if (Math.abs(d[1]) > 1e-3) {
          const t = (WATER - o[1]) / d[1], p = v3.add(o, v3.scale(d, t));
          if (Math.abs(p[0]) < HALF && Math.abs(p[2]) < HALF) {
            const sp = Math.min(40, Math.hypot(dx, dy));
            this.sea.disturb(p[0], p[2], 0.09, -0.0035 * sp);
            if (sp > 18 && Math.random() < 0.3) this.fxApi.splash([p[0], WATER, p[2]], 0.6, 'hand');
          }
        }
      } else if (K === 'side') {
        const amt = clamp(-(e.clientY - drag.y0) * 0.004, -0.32, 0.32);
        const n = drag.n;
        if (n[0]) this.tilt.taz = amt * n[0]; else this.tilt.tax = -amt * n[2];
      }
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!drag) return;
      const tap = drag.moved < 8 && performance.now() - drag.t0 < 600;
      const h = drag.hit;
      if (drag.kind === 'ship') { if (tap) this.fireGun(); this.ship.tow = null; }
      if (drag.kind === 'tap' && tap) {
        if (h.what === 'chest') { this.lidOpen = !this.lidOpen; this.lidV += this.lidOpen ? 9 : -4; }
        if (h.what === 'fire') this.roar();
        if (h.what === 'xmark') this.popX();
      }
      if (drag.kind === 'body') {
        const b = drag.body; b.held = false;
        const tr = drag.trail;
        if (tr.length >= 2) {
          const [t0, p0] = tr[0], [t1, p1] = tr[tr.length - 1];
          const dt = Math.max(0.016, (t1 - t0) / 1000);
          b.v = [(p1[0] - p0[0]) / dt, 0.4, (p1[2] - p0[2]) / dt].map((v) => clamp(v, -4, 4));
        }
      }
      if (drag.kind === 'water' && tap && h.p) this.sea.disturb(h.p[0], h.p[2], 0.07, -0.05);
      if (drag.kind === 'side') { this.tilt.tax = 0; this.tilt.taz = 0; }
      this.dragPalm = null;
      drag = null;
      document.body.classList.remove('dragging');
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.cam.dist = clamp(this.cam.dist * Math.exp(e.deltaY * 0.001), 6, 22); }, { passive: false });
  }

  // ---- loop --------------------------------------------------------------------------------
  loop(now) {
    const dtR = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    const dt = this.paused ? 0 : dtR;
    this.time += dt;
    if (dt > 0) this.simulate(dt);
    this.draw(now);
    requestAnimationFrame((t) => this.loop(t));
  }

  simulate(dt) {
    const firm = this.firm;
    this.sea.params.g = 2.6 + 3.4 * firm;
    this.sea.params.tension = 0.00008 + 0.00016 * firm; // keep omega*dt < 1 at the grid scale
    this.sea.params.damping = 0.05 + 1.6 * +$('sDamp').value;
    // tipping: a spring toward the drag target, released it sloshes back
    const T = this.tilt;
    for (const [a, v, t] of [['ax', 'vax', 'tax'], ['az', 'vaz', 'taz']]) {
      const acc = (T[t] - T[a]) * 40 - T[v] * 6;
      T[v] += acc * dt; T[a] += T[v] * dt;
      // the jelly shears against the tilt acceleration
      if (a === 'az') this.wob.vsx -= acc * 0.0045; else this.wob.vsz += acc * 0.0045;
    }
    // gravity in the tilted block drives the sea sideways
    const g = this.sea.params.g;
    this.sea.accel = [-Math.sin(T.az) * g * 1.6, Math.sin(T.ax) * g * 1.6];
    // jelly wobble springs (shear + squash)
    const W = this.wob, k = 90 + 320 * firm, c = 3.2 + 4 * (1 - firm) * 0.2;
    W.vsx += (-W.sx * k - W.vsx * c) * dt; W.sx += W.vsx * dt;
    W.vsz += (-W.sz * k - W.vsz * c) * dt; W.sz += W.vsz * dt;
    W.vsq += (-W.sq * k * 1.4 - W.vsq * c) * dt; W.sq += W.vsq * dt;
    W.sx = clamp(W.sx, -0.08, 0.08); W.sz = clamp(W.sz, -0.08, 0.08); W.sq = clamp(W.sq, -0.06, 0.06);

    this.ship.update(dt, 1);
    this.sea.update(dt);
    this.bodies.update(dt);
    // chest lid with a bounce
    const target = this.lidOpen ? 1.95 : 0;
    this.lidV += ((target - this.lid) * 70 - this.lidV * 5) * dt;
    this.lid += this.lidV * dt;
    if (this.lid < 0) { this.lid = 0; this.lidV = Math.abs(this.lidV) * 0.35; }
    if (this.lid > 2.1) { this.lid = 2.1; this.lidV = -Math.abs(this.lidV) * 0.4; }
    // palms spring back
    this.palmBend.forEach((p, i) => {
      if (this.dragPalm === i) return;
      p[2] += (-p[0] * 60 - p[2] * 3) * dt; p[3] += (-p[1] * 60 - p[3] * 3) * dt;
      p[0] += p[2] * dt; p[1] += p[3] * dt;
    });
    this.emitAmbient(dt);
    this.fx.update(dt, (x, z) => WATER + this.sea.height(x, z));
    this.fireBoost = Math.max(0, this.fireBoost - dt * 0.8);
  }

  emitAmbient(dt) {
    const tod = todAt(this.tod);
    const fx = this.fx, rnd = (a, b) => a + Math.random() * (b - a);
    const f = this.firePos();
    const inten = 0.7 + this.fireBoost;
    const m = reduced ? 0.5 : 1;
    const emitN = (rate) => { let n = rate * dt; let k = Math.floor(n); if (Math.random() < n - k) k++; return k; };
    for (let i = 0; i < emitN(46 * inten * m); i++) {
      const a = rnd(0, 6.28), r = rnd(0, 0.03);
      fx.emit(KIND.FLAME, [f[0] + Math.cos(a) * r, f[1] - 0.02, f[2] + Math.sin(a) * r], [rnd(-0.03, 0.03), rnd(0.25, 0.45) * (1 + this.fireBoost * 0.4), rnd(-0.03, 0.03)], rnd(0.4, 0.75), rnd(0.035, 0.055) * (1 + this.fireBoost * 0.3), 0.008, [3.2, 1.7, 0.5, 0.9], [2.0, 0.4, 0.08, 0], 1.0, 0.2);
    }
    for (let i = 0; i < emitN(5 * inten * m); i++) fx.emit(KIND.EMBER, [f[0], f[1], f[2]], [rnd(-0.12, 0.12), rnd(0.4, 0.8), rnd(-0.12, 0.12)], rnd(1.2, 2.4), 0.007, 0.003, [1, 0.7, 0.3, 1], [1, 0.3, 0.05, 0], 0.6, -0.1);
    const w = this.ship.wind();
    for (let i = 0; i < emitN(6 * m); i++) fx.emit(KIND.SMOKE, [f[0] + rnd(-0.02, 0.02), f[1] + 0.16, f[2] + rnd(-0.02, 0.02)], [w[0] * 0.08 + rnd(-0.02, 0.02), rnd(0.14, 0.24), w[1] * 0.08 + rnd(-0.02, 0.02)], rnd(3, 5), 0.04, rnd(0.18, 0.3), [0.42, 0.4, 0.38, 0.32], [0.55, 0.55, 0.55, 0], 0.25, 0.02);
    // gold glints over the open chest
    if (this.lid > 0.6) {
      const ci = chestInfo();
      for (let i = 0; i < emitN(10); i++) {
        const lx = rnd(-0.09, 0.09), lz = rnd(-0.05, 0.05), c = Math.cos(ci.yaw), s = Math.sin(ci.yaw);
        fx.emit(KIND.GLINT, [ci.x + c * lx + s * lz, ci.y + ci.h + rnd(0.01, 0.05), ci.z - s * lx + c * lz], [0, rnd(0.01, 0.05), 0], rnd(0.3, 0.6), rnd(0.02, 0.035), 0.0, [1, 0.88, 0.5, 1], [1, 0.8, 0.4, 0], 1, 0);
      }
    }
    // fireflies at night
    if (tod.night > 0.5) {
      for (let i = 0; i < emitN(5 * tod.night * m); i++) {
        const x = rnd(-1.6, 0.9), z = rnd(-1.8, -0.6);
        const gh = groundHeight(x, z);
        if (gh < WATER + 0.02) continue;
        fx.emit(KIND.GLOW, [x, gh + rnd(0.08, 0.4), z], [0, 0, 0], rnd(3, 6), 0.012, 0.012, [0.75, 1.0, 0.35, 0.9], [0.75, 1.0, 0.35, 0], 0.5, 0);
      }
    }
  }

  draw(now) {
    const r = this.r;
    const aspect = r.width / r.height;
    this.cam.update(aspect);
    const bxf = this.blockXf();
    const block = X.toM4(bxf);
    this.blockInv = m4.invert(block);
    // objects
    const O = this.objects;
    O.fill(0);
    X.toM4(X.I(), O, OBJ.STATIC * 16);
    X.toM4(this.ship.xf(), O, OBJ.SHIP * 16);
    const ci = chestInfo();
    X.toM4(X.mul(X.T(ci.x, ci.y + ci.h, ci.z), X.RY(ci.yaw), X.T(0, 0, -ci.d / 2), X.RX(-this.lid)), O, OBJ.LID * 16);
    this.chainMatrices(O);
    this.bodies.matrices(O);
    // the sea
    r.setEta(this.sea.eta);
    const tod = todAt(this.tod);
    const flick = 0.75 + 0.25 * Math.sin(this.time * 17) * Math.sin(this.time * 7.3 + 1) + 0.1 * Math.sin(this.time * 31);
    const fireI = tod.fire * (1 + this.fireBoost) * flick;
    const fl = FLAVOURS[this.flavour];
    const w = this.ship.wind();
    document.body.classList.toggle('night', tod.night > 0.5);
    this.lastState = {
      camera: this.cam, block, blockInv: this.blockInv, time: this.time,
      light: { dir: tod.dir, intensity: tod.I, color: tod.col },
      night: tod.night,
      ambSky: tod.sky, ambGround: tod.sky.map((v, i) => v * [0.75, 0.62, 0.5][i]),
      fire: { pos: this.firePos(), intensity: fireI, color: [1.0, 0.55, 0.22], flicker: flick },
      backTop: tod.top, backBot: tod.bot, stars: tod.stars,
      jelly: fl, wind: [w[0], w[1], 0.6 + 0.4 * Math.sin(this.time * 0.3), 0],
      motion: this.motion, lantern: tod.night, skullGlow: tod.night,
      palms: this.palmBend.map((p) => [p[0], p[1], 0, 0]),
      objects: O,
      particles: (() => { const data = this.fx.pack((x, z) => WATER + this.sea.height(x, z)); return { data, under: this.fx.under, count: this.fx.count }; })(),
      exposure: tod.exp,
    };
    r.render(this.lastState);
    if (!this._uiT || now - this._uiT > 150) { this._uiT = now; this.updateHud(); }
  }

  chainMatrices(O) {
    const a = this.ship.hawseWorld();
    const b = anchorInfo().ring;
    const n = OBJ.NCHAIN;
    const span = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const slack = Math.max(0.05, this.ship.rode + 0.25 - span);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      p[1] -= Math.sin(Math.PI * t) * slack * 0.9;
      const gh = groundHeight(p[0], p[2]) + 0.01;
      if (p[1] < gh) p[1] = gh;
      pts.push(p);
    }
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[i + 1];
      const d = v3.norm(v3.sub(q, p));
      let s = v3.norm(v3.cross(d, [0, 1, 0]));
      if (!Number.isFinite(s[0])) s = [1, 0, 0];
      let u = v3.cross(s, d);
      if (i % 2) { const t = s; s = u; u = t.map((x) => -x); }
      X.toM4(X.B(d, u, s, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]), O, (OBJ.CHAIN + i) * 16);
    }
  }

  updateHud() {
    const t = this.bodies.tally();
    $('tShots').textContent = this.shots;
    $('tAfloat').textContent = t.afloat;
    $('tSunk').textContent = t.sunk;
    let ke = 0;
    for (const b of this.bodies.list) ke += v3.dot(b.v, b.v);
    const live = clamp(this.sea.energy() * 30 + ke * 0.05 + this.fireBoost * 0.25 + Math.hypot(this.tilt.ax, this.tilt.az) * 2 + Math.hypot(this.ship.vx, this.ship.vz) * 0.8, 0, 1);
    $('meter').style.width = `${Math.round(6 + live * 94)}%`;
  }
}

const app = new App();
window.__app = app;
app.start();
