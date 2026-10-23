// One particle system for flames, embers, smoke, muzzle flash, gunsmoke, spray, sand, glints,
// fireflies and bubbles. Simulated on the CPU, drawn as camera-facing sprites.
import { WATER, HALF } from './world.js';

export const KIND = { FLAME: 0, EMBER: 1, SMOKE: 2, GLINT: 3, GLOW: 4, SPRAY: 5, SAND: 6, BUBBLE: 7 };
const MAX = 2600;
const FLOATS = 12;

export class Particles {
  constructor() {
    this.n = 0;
    this.p = new Float32Array(MAX * 3); this.v = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX); this.max = new Float32Array(MAX);
    this.size = new Float32Array(MAX * 2); this.col = new Float32Array(MAX * 8);
    this.kind = new Uint8Array(MAX); this.rot = new Float32Array(MAX * 2);
    this.drag = new Float32Array(MAX); this.lift = new Float32Array(MAX);
    this.out = new Float32Array(MAX * FLOATS);
    this.under = 0; this.count = 0;
    this.scale = 1;
  }

  emit(kind, pos, vel, life, s0, s1, c0, c1, drag = 1, lift = 0) {
    if (this.n >= MAX) return;
    const i = this.n++;
    this.p.set(pos, i * 3); this.v.set(vel, i * 3);
    this.life[i] = life; this.max[i] = life;
    this.size[i * 2] = s0; this.size[i * 2 + 1] = s1;
    this.col.set(c0, i * 8); this.col.set(c1, i * 8 + 4);
    this.kind[i] = kind;
    this.rot[i * 2] = Math.random() * 6.28; this.rot[i * 2 + 1] = (Math.random() - 0.5) * 2;
    this.drag[i] = drag; this.lift[i] = lift;
  }

  update(dt, surfAt) {
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      const l = this.life[i] - dt;
      if (l <= 0) continue;
      const k = this.kind[i];
      let px = this.p[i * 3], py = this.p[i * 3 + 1], pz = this.p[i * 3 + 2];
      let vx = this.v[i * 3], vy = this.v[i * 3 + 1], vz = this.v[i * 3 + 2];
      const d = Math.exp(-this.drag[i] * dt);
      vx *= d; vy *= d; vz *= d;
      vy += this.lift[i] * dt;
      if (k === KIND.FLAME || k === KIND.SMOKE) { vx += (Math.random() - 0.5) * 0.6 * dt; vz += (Math.random() - 0.5) * 0.6 * dt; }
      if (k === KIND.GLOW && this.lift[i] === 0) { vx += (Math.random() - 0.5) * 0.8 * dt; vy += (Math.random() - 0.5) * 0.8 * dt; vz += (Math.random() - 0.5) * 0.8 * dt; }
      px += vx * dt; py += vy * dt; pz += vz * dt;
      if (k === KIND.BUBBLE && py > surfAt(px, pz) - 0.01) continue;
      // copy down
      this.p[j * 3] = px; this.p[j * 3 + 1] = py; this.p[j * 3 + 2] = pz;
      this.v[j * 3] = vx; this.v[j * 3 + 1] = vy; this.v[j * 3 + 2] = vz;
      this.life[j] = l; this.max[j] = this.max[i];
      this.size[j * 2] = this.size[i * 2]; this.size[j * 2 + 1] = this.size[i * 2 + 1];
      for (let c = 0; c < 8; c++) this.col[j * 8 + c] = this.col[i * 8 + c];
      this.kind[j] = k;
      this.rot[j * 2] = this.rot[i * 2] + this.rot[i * 2 + 1] * dt; this.rot[j * 2 + 1] = this.rot[i * 2 + 1];
      this.drag[j] = this.drag[i]; this.lift[j] = this.lift[i];
      j++;
    }
    this.n = j;
  }

  /** Pack instances: underwater ones first (drawn before the jelly), then the rest. */
  pack(surfAt) {
    const o = this.out;
    let w = 0;
    const put = (i) => {
      const t = 1 - this.life[i] / this.max[i];
      const s = this.size[i * 2] + (this.size[i * 2 + 1] - this.size[i * 2]) * t;
      const b = i * 8, q = w * FLOATS;
      o[q] = this.p[i * 3]; o[q + 1] = this.p[i * 3 + 1]; o[q + 2] = this.p[i * 3 + 2]; o[q + 3] = s;
      const fadeIn = Math.min(1, (this.max[i] - this.life[i]) / 0.08);
      for (let c = 0; c < 4; c++) o[q + 4 + c] = this.col[b + c] + (this.col[b + 4 + c] - this.col[b + c]) * t;
      o[q + 7] *= fadeIn;
      o[q + 8] = this.rot[i * 2]; o[q + 9] = this.kind[i]; o[q + 10] = i * 0.37; o[q + 11] = 0;
      w++;
    };
    const isUnder = (i) => {
      const x = this.p[i * 3], z = this.p[i * 3 + 2];
      return Math.abs(x) < HALF && Math.abs(z) < HALF && this.p[i * 3 + 1] < surfAt(x, z);
    };
    for (let i = 0; i < this.n; i++) if (isUnder(i)) put(i);
    this.under = w;
    for (let i = 0; i < this.n; i++) if (!isUnder(i)) put(i);
    this.count = w;
    return o;
  }
}
