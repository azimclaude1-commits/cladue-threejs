// The mind: neurons grow out of starlight, connect, and fire in time with the bells of the score.
import * as THREE from 'three';
import { T, smooth } from './timeline.js';
import { BELLS } from './music.js';

const SPEED = 170;     // signal speed, world units per second
const GROW = 38;       // growth speed

export class Neurons {
  constructor(centre, count = 16) {
    let s = 4242;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const rv = () => { let x, y, z; do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 1); return new THREE.Vector3(x, y, z); };
    this.centre = centre.clone();
    // somata spread through an ellipsoid, not too close to each other
    const somas = [];
    while (somas.length < count) {
      const p = rv().multiply(new THREE.Vector3(270, 150, 270)).add(centre);
      if (somas.every((q) => q.distanceTo(p) > 95)) somas.push(p);
    }
    this.somas = somas;
    this.start = somas.map((p, i) => T.mind + 0.6 + (i / count) * 3.2 + rnd() * 0.6);
    const segs = [];   // [p0, p1, d0, d1, neuron, kind, depth]
    const grow = (n, from, dir, len, depth, d0) => {
      let p = from.clone(), d = dir.clone().normalize(), dist = d0;
      for (let i = 0; i < len; i++) {
        d.add(rv().multiplyScalar(0.38)).normalize();
        const step = 6 + rnd() * 3;
        const q = p.clone().addScaledVector(d, step);
        segs.push([p.clone(), q.clone(), dist, dist + step, n, 0, depth]);
        dist += step; p = q;
        if (depth < 3 && rnd() < 0.085 - depth * 0.015) {
          const nd = d.clone().add(rv().multiplyScalar(1.1)).normalize();
          grow(n, p, nd, Math.floor(len * (0.4 + rnd() * 0.35)), depth + 1, dist);
        }
      }
      // a little fork at the end
      if (depth < 2) for (let k = 0; k < 2; k++) grow(n, p, d.clone().add(rv().multiplyScalar(0.9)), 3 + Math.floor(rnd() * 4), 3, dist);
    };
    somas.forEach((p, n) => {
      const prim = 6 + Math.floor(rnd() * 4);
      for (let k = 0; k < prim; k++) grow(n, p, rv(), 14 + Math.floor(rnd() * 16), 0, 0);
    });
    // axons: to one or two neighbours, a long gentle curve
    this.axons = [];
    somas.forEach((p, n) => {
      const order = somas.map((q, m) => [q.distanceTo(p), m]).filter(([, m]) => m !== n).sort((a, b) => a[0] - b[0]);
      const k = 1 + (rnd() < 0.5 ? 1 : 0);
      for (let j = 0; j < k; j++) {
        const m = order[j + Math.floor(rnd() * 2)][1], q = somas[m];
        const ctrl = p.clone().add(q).multiplyScalar(0.5).add(rv().multiplyScalar(p.distanceTo(q) * 0.45));
        const steps = Math.max(8, Math.floor(p.distanceTo(q) / 8));
        let prev = p.clone(), dist = 0;
        for (let i = 1; i <= steps; i++) {
          const u = i / steps;
          const pt = p.clone().multiplyScalar((1 - u) * (1 - u)).add(ctrl.clone().multiplyScalar(2 * u * (1 - u))).add(q.clone().multiplyScalar(u * u));
          pt.add(rv().multiplyScalar(1.5));
          const len = pt.distanceTo(prev);
          segs.push([prev.clone(), pt.clone(), dist, dist + len, n, 1, 1]);
          dist += len; prev = pt;
        }
        this.axons.push({ from: n, to: m, len: dist });
      }
    });
    this.segs = segs;
    this.totalLen = segs.reduce((a, g) => a + g[0].distanceTo(g[1]), 0);

    // pulses: every bell fires a neuron; the signal runs down its axons into the next one
    this.pulses = [];
    for (const b of BELLS) {
      const n = b.neuron % count;
      this.pulses.push([n, b.t]);
      for (const a of this.axons) if (a.from === n) this.pulses.push([a.to, b.t + a.len / SPEED]);
    }
    this.pulses.sort((a, b) => a[1] - b[1]);

    // ---- ribbons
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const A = new Float32Array(segs.length * 3), B = new Float32Array(segs.length * 3), D = new Float32Array(segs.length * 4);
    segs.forEach(([p0, p1, d0, d1, n, kind, depth], i) => { A.set(p0.toArray(), i * 3); B.set(p1.toArray(), i * 3); D.set([d0, d1, n + kind * 100, depth], i * 4); });
    g.setAttribute('aA', new THREE.InstancedBufferAttribute(A, 3));
    g.setAttribute('aB', new THREE.InstancedBufferAttribute(B, 3));
    g.setAttribute('aD', new THREE.InstancedBufferAttribute(D, 4));
    g.instanceCount = segs.length;
    this.uniforms = {
      uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uPR: { value: 1 }, uAlpha: { value: 1 },
      uStart: { value: new Float32Array(32) }, uPulse: { value: Array.from({ length: 24 }, () => new THREE.Vector2(-1, -100)) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        uniform float uTime, uPR;
        uniform vec2 uRes;
        uniform float uStart[32];
        uniform vec2 uPulse[24];
        attribute vec3 aA, aB;
        attribute vec4 aD;
        varying float vX; varying vec3 vCol;
        void main() {
          int n = int(mod(aD.z, 100.0));
          bool axon = aD.z >= 100.0;
          float grown = (uTime - uStart[n]) * ${GROW.toFixed(1)} - (axon ? 70.0 : 0.0);
          float vis = smoothstep(aD.x - 2.0, aD.y, grown);
          float d = mix(aD.x, aD.y, position.x);
          // signals travelling outward from the soma
          float sig = 0.0;
          for (int i = 0; i < 24; i++) {
            if (int(uPulse[i].x) != n) continue;
            float front = (uTime - uPulse[i].y) * ${SPEED.toFixed(1)};
            float x = d - front;
            sig += exp(-x * x / 180.0) * step(-30.0, x) * exp(-max(front - d, 0.0) * 0.0);
          }
          vec4 ca = projectionMatrix * viewMatrix * vec4(aA, 1.0), cb = projectionMatrix * viewMatrix * vec4(aB, 1.0);
          vec4 c = mix(ca, cb, position.x);
          vec2 sa = ca.xy / ca.w * uRes, sb = cb.xy / cb.w * uRes;
          vec2 dir = normalize(sb - sa + 1e-4);
          vec2 nrm = vec2(-dir.y, dir.x);
          float w = (axon ? 1.1 : 1.9 - aD.w * 0.35) * uPR * (1.0 + sig * 1.4) * vis;
          c.xy += nrm * position.y * (w + 1.0 * uPR) / uRes * c.w;
          vX = position.y;
          float tipGlow = smoothstep(18.0, 0.0, abs(grown - d)) * step(d, grown + 2.0);
          vec3 base = axon ? vec3(0.35, 0.3, 1.0) : vec3(0.2, 0.55, 1.0);
          vCol = (base * (0.06 + 0.035 * (3.0 - aD.w)) + vec3(0.8, 0.9, 1.0) * tipGlow * 0.5 + vec3(1.0, 0.7, 0.32) * sig * 1.6) * vis;
          gl_Position = c;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        varying float vX; varying vec3 vCol;
        void main() { float a = exp(-vX * vX * 3.0); gl_FragColor = vec4(vCol * a * uAlpha, 1.0); }`,
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 40;

    // somata: glowing points that flare when they fire
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(somas.flatMap((p) => p.toArray()), 3));
    sg.setAttribute('aI', new THREE.Float32BufferAttribute(somas.map((_, i) => i), 1));
    this.somaU = { uTime: this.uniforms.uTime, uStart: this.uniforms.uStart, uFlare: { value: new Float32Array(32) }, uPx: { value: 800 }, uAlpha: this.uniforms.uAlpha };
    this.somaMesh = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: this.somaU,
      vertexShader: /* glsl */ `
        uniform float uTime, uPx; uniform float uStart[32]; uniform float uFlare[32];
        attribute float aI; varying float vI;
        void main() {
          int n = int(aI);
          float born = smoothstep(uStart[n] - 2.5, uStart[n] - 0.5, uTime);
          vI = born * (0.6 + 0.4 * sin(uTime * 3.0 + aI * 7.0) * (1.0 - smoothstep(uStart[n] - 0.5, uStart[n] + 1.0, uTime))) + uFlare[n] * 1.4;
          vec4 mv = viewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp((6.0 + uFlare[n] * 7.0) * uPx / -mv.z, 2.0, 40.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAlpha; varying float vI;
        void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float g = exp(-r * r * 12.0) * 1.2 + exp(-r * 4.0) * 0.18; gl_FragColor = vec4(vec3(0.75, 0.85, 1.0) * g * vI * uAlpha, 1.0); }`,
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.somaMesh.frustumCulled = false; this.somaMesh.renderOrder = 41;
    this.group = new THREE.Group();
    this.group.add(this.mesh, this.somaMesh);
  }
  update(t, W, H, PR, px) {
    const u = this.uniforms;
    u.uTime.value = t; u.uRes.value.set(W * PR / 2, H * PR / 2); u.uPR.value = PR;
    this.start.forEach((v, i) => { u.uStart.value[i] = v; });
    // the most recent pulses
    let k = 0;
    for (let i = this.pulses.length - 1; i >= 0 && k < 24; i--) {
      const [n, te] = this.pulses[i];
      if (te <= t && t - te < 3.5) { u.uPulse.value[k].set(n, te); k++; }
    }
    for (; k < 24; k++) u.uPulse.value[k].set(-1, -100);
    // flares when a signal leaves or arrives
    const fl = this.somaU.uFlare.value; fl.fill(0);
    for (const [n, te] of this.pulses) { const dt = t - te; if (dt >= 0 && dt < 1.5) fl[n] = Math.max(fl[n], Math.exp(-dt * 4)); }
    this.somaU.uPx.value = px;
    u.uAlpha.value = smooth(T.mind - 0.5, T.mind + 1, t) * (1 - smooth(T.dissolve, T.dissolve + 1.4, t));
    this.group.visible = u.uAlpha.value > 0.001;
  }
  /** count points spread evenly along the branches (for the particles to start from) */
  samples(count) {
    const out = new Float32Array(count * 4);
    const cum = []; let acc = 0;
    for (const g of this.segs) { acc += g[0].distanceTo(g[1]); cum.push(acc); }
    let s = 777; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      const r = rnd() * acc; let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
      const g = this.segs[lo], u = rnd();
      out[i * 4] = g[0].x + (g[1].x - g[0].x) * u + (rnd() - 0.5) * 2;
      out[i * 4 + 1] = g[0].y + (g[1].y - g[0].y) * u + (rnd() - 0.5) * 2;
      out[i * 4 + 2] = g[0].z + (g[1].z - g[0].z) * u + (rnd() - 0.5) * 2;
      out[i * 4 + 3] = 1;
    }
    return out;
  }
}
