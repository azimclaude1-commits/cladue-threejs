import { Renderer } from './renderer.js';
import { World, bodyFromRest } from './physics.js';
import { buildPiece } from './mesher.js';
import { makeAnatomy, restBottom, VARIETIES, PIP_COUNT } from './orange.js';
import { Cutter, buildKnifeMesh } from './knife.js';
import { m4, v3, clamp } from './math.js';
import { STRINGS, applyLang } from './i18n.js';

const $ = (id) => document.getElementById(id);

class OrbitCamera {
  constructor(el) {
    this.el = el;
    this.target = [0, 0.95, 0];
    this.az = 0.62;
    this.el_ = 0.6;
    this.dist = 8.2;
    this.fov = (34 * Math.PI) / 180;
    this.update(1);
  }
  update(aspect) {
    this.aspect = aspect;
    const ce = Math.cos(this.el_), se = Math.sin(this.el_);
    this.pos = [this.target[0] + Math.sin(this.az) * ce * this.dist, this.target[1] + se * this.dist, this.target[2] + Math.cos(this.az) * ce * this.dist];
    // narrow screens: back off so the orange still fits
    const fov = aspect < 1 ? 2 * Math.atan(Math.tan(this.fov / 2) / Math.max(aspect, 0.55)) : this.fov;
    this.view = m4.lookAt(this.pos, this.target, [0, 1, 0]);
    this.proj = m4.perspective(fov, aspect, 0.1, 80);
    this.viewProj = m4.mul(this.proj, this.view);
    this.invViewProj = m4.invert(this.viewProj);
  }
  /** World ray through a CSS-pixel point on the canvas. */
  ray(sx, sy) {
    const r = this.el.getBoundingClientRect();
    const nx = ((sx - r.left) / r.width) * 2 - 1, ny = 1 - ((sy - r.top) / r.height) * 2;
    const a = m4.transformPoint(this.invViewProj, [nx, ny, 0]);
    const b = m4.transformPoint(this.invViewProj, [nx, ny, 1]);
    return { origin: a, dir: v3.norm(v3.sub(b, a)) };
  }
  forward() { return v3.norm(v3.sub(this.target, this.pos)); }
}

class App {
  constructor() {
    this.lang = (navigator.language || '').startsWith('zh') ? 'zh' : 'en';
    try { const s = localStorage.getItem('orange-lang'); if (s) this.lang = s; } catch {}
    this.S = applyLang(this.lang);
    this.tool = 'hand';
    this.variety = 'navel';
    this.paused = false;
    this.slow = false;
    this.showMesh = false;
    this.world = new World();
    this.anatomy = makeAnatomy();
    this.cutter = new Cutter(this);
    this.canvas = $('gpu');
    this.overlay = $('overlay');
    this.stage = $('stage');
    this.camera = new OrbitCamera(this.canvas);
    this.frame = 0;
    this.time = 0;
    this.pipData = new Float32Array(PIP_COUNT * 8);
    this.renderScale = 1;
    this.frameTimes = [];
    this.bindUI();
  }

  async start() {
    try {
      this.renderer = await Renderer.create(this.canvas);
    } catch (e) {
      console.warn('WebGPU unavailable:', e);
      this.fallback();
      return;
    }
    this.renderer.setKnifeMesh(buildKnifeMesh());
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.stage);
    // build the whole orange incrementally so the page stays responsive
    const gen = buildPiece([]);
    await new Promise((resolve) => {
      const tick = () => {
        const t0 = performance.now();
        let r;
        do { r = gen.next(); } while (!r.done && performance.now() - t0 < 14);
        if (r.done) { this.basePiece = r.value; resolve(); } else requestAnimationFrame(tick);
      };
      tick();
    });
    this.reset();
    $('loading').hidden = true;
    this.setPill('live');
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  fallback() {
    $('loading').hidden = true;
    $('fallback').hidden = false;
    $('hint').hidden = true;
    this.setPill('offline');
  }

  setPill(state) {
    const p = $('pill');
    p.classList.toggle('off', state === 'offline');
    p.classList.toggle('wait', false);
    $('pillText').dataset.i18n = state;
    $('pillText').textContent = this.S[state];
  }

  reset() {
    this.cutter.state = null;
    this.world.knife = null;
    this.world.grab = null;
    this.anatomy = makeAnatomy();
    const lift = -restBottom() + 0.004;
    const b = bodyFromRest(this.basePiece, [0, lift, 0]);
    this.world.bodies = [b];
    for (const p of this.anatomy.pips) p.owner = b.id;
    this.onBodiesChanged();
  }

  onBodiesChanged() {
    this.renderer?.setBodies(this.world.bodies);
  }

  resize() {
    if (!this.renderer) return;
    const r = this.stage.getBoundingClientRect();
    let dpr = Math.min(window.devicePixelRatio || 1, 2) * this.renderScale;
    const maxPx = 2.6e6 * this.renderScale * this.renderScale;
    if (r.width * r.height * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (r.width * r.height));
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    this.renderer.resize(w, h);
    this.overlay.width = Math.round(r.width * (window.devicePixelRatio || 1));
    this.overlay.height = Math.round(r.height * (window.devicePixelRatio || 1));
  }

  toast(key) {
    const t = $('toast');
    t.textContent = key === 'max' ? this.S.maxPieces : key === 'thin' ? this.S.tooThin : key;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---- UI ----------------------------------------------------------------------------
  bindUI() {
    $('lang').onclick = () => {
      this.lang = this.lang === 'en' ? 'zh' : 'en';
      try { localStorage.setItem('orange-lang', this.lang); } catch {}
      this.S = applyLang(this.lang);
      $('pause').textContent = this.paused ? this.S.resume : this.S.pause;
      this.updateHint();
      this.updateSliderLabels();
    };
    for (const b of $('tools').querySelectorAll('button')) {
      b.onclick = () => this.setTool(b.dataset.tool);
    }
    for (const b of $('varieties').querySelectorAll('button')) {
      b.onclick = () => {
        this.variety = b.dataset.variety;
        for (const o of $('varieties').querySelectorAll('button')) o.setAttribute('aria-pressed', o === b);
      };
    }
    $('firm').oninput = () => { this.world.params.firmness = +$('firm').value; this.wakeAll(); this.updateSliderLabels(); };
    $('damp').oninput = () => { this.world.params.damping = +$('damp').value; this.updateSliderLabels(); };
    this.updateSliderLabels();
    $('nudge').onclick = () => { if (this.world.bodies.length) this.world.nudge(); };
    $('reset').onclick = () => { if (this.basePiece) this.reset(); };
    $('pause').onclick = () => {
      this.paused = !this.paused;
      $('pause').dataset.i18n = this.paused ? 'resume' : 'pause';
      $('pause').textContent = this.paused ? this.S.resume : this.S.pause;
    };
    $('slow').onchange = () => { this.slow = $('slow').checked; };
    $('mesh').onchange = () => { this.showMesh = $('mesh').checked; };
    this.bindPointer();
    this.updateHint();
  }

  updateSliderLabels() {
    $('firmOut').textContent = Math.round(+$('firm').value * 100);
    $('dampOut').textContent = Math.round(+$('damp').value * 100);
  }

  wakeAll() { for (const b of this.world.bodies) b.wake(); }

  setTool(t) {
    this.tool = t;
    this.stage.dataset.tool = t;
    for (const o of $('tools').querySelectorAll('button')) o.setAttribute('aria-pressed', o.dataset.tool === t);
    this.updateHint();
  }

  updateHint() {
    const h = $('hint');
    const key = this.cutter.busy ? 'hintBusy' : this.tool === 'knife' ? 'hintKnife' : 'hintHand';
    h.dataset.i18n = key;
    h.textContent = this.S[key];
  }

  bindPointer() {
    const c = this.canvas;
    let mode = null, last = null, stroke = null, grabPlane = null;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      if (!this.renderer || !this.basePiece) return;
      c.setPointerCapture(e.pointerId);
      last = [e.clientX, e.clientY];
      const orbitBtn = e.button === 2 || e.button === 1 || e.shiftKey;
      if (this.tool === 'knife' && !orbitBtn) {
        if (this.cutter.busy) { mode = null; return; }
        mode = 'stroke';
        stroke = [[e.clientX, e.clientY], [e.clientX, e.clientY]];
        return;
      }
      if (this.tool === 'hand' && !orbitBtn) {
        const ray = this.camera.ray(e.clientX, e.clientY);
        const hit = this.world.raycast(ray.origin, ray.dir);
        if (hit && this.world.startGrab(hit)) {
          mode = 'grab';
          const n = this.camera.forward();
          grabPlane = { n, d: v3.dot(n, hit.point) };
          this.stage.classList.add('grabbing');
          return;
        }
      }
      mode = 'orbit';
    });
    c.addEventListener('pointermove', (e) => {
      if (!mode) return;
      if (mode === 'orbit') {
        const dx = e.clientX - last[0], dy = e.clientY - last[1];
        this.camera.az -= dx * 0.006;
        this.camera.el_ = clamp(this.camera.el_ + dy * 0.005, 0.08, 1.35);
      } else if (mode === 'grab' && this.world.grab) {
        const ray = this.camera.ray(e.clientX, e.clientY);
        const den = v3.dot(grabPlane.n, ray.dir);
        if (Math.abs(den) > 1e-4) {
          const t = (grabPlane.d - v3.dot(grabPlane.n, ray.origin)) / den;
          const p = v3.add(ray.origin, v3.scale(ray.dir, t));
          p[1] = Math.max(p[1], 0.05);
          this.world.grab.target = p;
        }
      } else if (mode === 'stroke') {
        stroke[1] = [e.clientX, e.clientY];
        this.drawStroke(stroke);
        const [a, b] = stroke;
        const now = performance.now();
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 12 && now - (this._lastPreview || 0) > 50) {
          this._lastPreview = now;
          this.cutter.preview(a, b);
        }
      }
      last = [e.clientX, e.clientY];
    });
    const end = () => {
      if (mode === 'grab') { this.world.grab = null; this.stage.classList.remove('grabbing'); }
      if (mode === 'stroke') this.cutter.preview(null);
      if (mode === 'stroke' && stroke) {
        const [a, b] = stroke;
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 12) {
          if (this.cutter.tryStroke(a, b)) this.updateHint();
        }
        this.fadeStroke(stroke);
      }
      mode = null; stroke = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camera.dist = clamp(this.camera.dist * Math.exp(e.deltaY * 0.001), 3.6, 16);
    }, { passive: false });
  }

  drawStroke(s, alpha = 1) {
    const ctx = this.overlay.getContext('2d');
    const r = this.overlay.getBoundingClientRect();
    const k = this.overlay.width / r.width;
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!s) return;
    const [a, b] = s.map((p) => [(p[0] - r.left) * k, (p[1] - r.top) * k]);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(29,26,22,0.18)';
    ctx.lineWidth = 7 * k;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.strokeStyle = '#fffaf2';
    ctx.lineWidth = 2 * k;
    ctx.setLineDash([10 * k, 7 * k]);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#e0661f';
    for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p[0], p[1], 3.5 * k, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  fadeStroke(s) {
    const t0 = performance.now();
    const step = () => {
      const a = 1 - (performance.now() - t0) / 450;
      if (a <= 0) { this.drawStroke(null); return; }
      this.drawStroke(s, a);
      requestAnimationFrame(step);
    };
    step();
  }

  // ---- loop -------------------------------------------------------------------------
  loop(now) {
    const dtReal = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.adaptResolution(dtReal);
    const dt = this.paused ? 0 : dtReal * (this.slow ? 0.25 : 1);
    this.time += dt;
    const wasBusy = this.cutter.busy;
    this.cutter.update(dt);
    if (!this.paused) this.world.advance(dt);
    if (wasBusy !== this.cutter.busy) this.updateHint();

    const r = this.renderer;
    const aspect = r.width / r.height;
    this.camera.update(aspect);
    r.updateNodes(this.world.bodies);
    // pips -> owning slot
    const slotOf = new Map(this.world.bodies.map((b, i) => [b.id, i]));
    this.anatomy.pips.forEach((p, i) => {
      const s = slotOf.has(p.owner) ? slotOf.get(p.owner) : -10;
      this.pipData.set([p.pos[0], p.pos[1], p.pos[2], s, p.dir[0], p.dir[1], p.dir[2], 0], i * 8);
    });
    const knifeModel = this.cutter.model();
    this.lastState = {
      camera: this.camera,
      light: { dir: v3.norm([-0.55, 1.0, 0.42]), intensity: 3.2 },
      time: now / 1000,
      frame: this.frame,
      variety: VARIETIES[this.variety],
      anatomy: this.anatomy,
      pips: this.pipData,
      showMesh: this.showMesh,
      knife: knifeModel ? { model: knifeModel } : null,
      exposure: 1.0,
    };
    r.render(this.lastState);
    if (this.frame % 8 === 0) this.updateReadouts();
    this.frame++;
    requestAnimationFrame((t) => this.loop(t));
  }

  /** Dynamic resolution: keep the volumetric march near 60 fps on smaller GPUs. */
  adaptResolution(dt) {
    if (this.fixedScale) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 40) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    let s = this.renderScale;
    if (avg > 1 / 40) s = Math.max(0.5, s * 0.85);
    else if (avg < 1 / 57 && s < 1) s = Math.min(1, s * 1.1);
    if (Math.abs(s - this.renderScale) > 0.01) { this.renderScale = s; this.resize(); }
  }

  updateReadouts() {
    const s = this.world.stats();
    $('rMass').textContent = s.massG.toFixed(0);
    $('rVol').textContent = s.volumePct.toFixed(1);
    $('rKe').textContent = s.kineticMJ < 10 ? s.kineticMJ.toFixed(2) : s.kineticMJ.toFixed(1);
    $('rPieces').textContent = String(s.pieces);
  }
}

const app = new App();
window.__app = app;
app.start();
