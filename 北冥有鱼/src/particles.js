// Ink and water in motion: the transformation, the breach spray and the whirlwind.
import * as THREE from 'three';
import { NOISE, FOG } from './noise.glsl.js';
import { share } from './shared.js';
import { T } from './timeline.js';
import { SPINE_GLSL } from './kun.js';
import { PENG_DEFORM, AXIS } from './peng.js';

let seedState = 7;
const rnd = () => ((seedState = (seedState * 16807) % 2147483647) / 2147483647);

/** Area-weighted random points on an indexed geometry; returns per point the vertex-interpolated attributes. */
function sampleSurface(geo, n, attrs) {
  const pos = geo.attributes.position, idx = geo.index.array;
  const nt = idx.length / 3, cum = new Float32Array(nt);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let acc = 0;
  for (let i = 0; i < nt; i++) {
    a.fromBufferAttribute(pos, idx[i * 3]); b.fromBufferAttribute(pos, idx[i * 3 + 1]); c.fromBufferAttribute(pos, idx[i * 3 + 2]);
    acc += b.sub(a).cross(c.sub(a)).length() * 0.5; cum[i] = acc;
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    const r = rnd() * acc;
    let lo = 0, hi = nt - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
    let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v, i0 = idx[lo * 3], i1 = idx[lo * 3 + 1], i2 = idx[lo * 3 + 2];
    const s = { p: [0, 0, 0] };
    for (let d = 0; d < 3; d++) s.p[d] = pos.array[i0 * 3 + d] * w + pos.array[i1 * 3 + d] * u + pos.array[i2 * 3 + d] * v;
    for (const name of attrs) {
      const at = geo.attributes[name], sz = at.itemSize;
      // flags (kind) take the dominant vertex; the rest interpolate
      if (name === 'kind' || name === 'seed') { const best = w >= u && w >= v ? i0 : u >= v ? i1 : i2; s[name] = Array.from({ length: sz }, (_, d) => at.array[best * sz + d]); }
      else s[name] = Array.from({ length: sz }, (_, d) => at.array[i0 * sz + d] * w + at.array[i1 * sz + d] * u + at.array[i2 * sz + d] * v);
    }
    out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------- 化而为鸟
export function makeTransform(kun, peng, N = 90000) {
  const ks = sampleSurface(kun.geometry, N, ['uv']).map((s) => ({ ...s, u: s.uv[0] + (rnd() - 0.5) * 0.04 }));
  const ps = sampleSurface(peng.geometry, N, ['kind', 'fe']).map((s) => ({ ...s, rn: Math.min(1, Math.hypot(s.p[0], s.p[2]) / 120) + (rnd() - 0.5) * 0.08 }));
  ks.sort((a, b) => a.u - b.u); ps.sort((a, b) => a.rn - b.rn);
  const aKun = new Float32Array(N * 3), aPeng = new Float32Array(N * 3), aPk = new Float32Array(N * 3), aT = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const k = ks[i], p = ps[i];
    aKun.set(k.p, i * 3); aPeng.set(p.p, i * 3);
    aPk.set([p.kind[0], p.fe[0], p.fe[1]], i * 3);
    const td = T.dissolve + Math.min(1.2, Math.max(0, k.u)) * 3 + (rnd() - 0.5) * 0.5;
    const ta = Math.max(td + 1.5, T.dissolve + 2.2 + Math.max(0, p.rn) * 3.5 + rnd() * 0.5);
    aT.set([td, ta, rnd()], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(aKun, 3));
  g.setAttribute('aPeng', new THREE.BufferAttribute(aPeng, 3));
  g.setAttribute('aPk', new THREE.BufferAttribute(aPk, 3));
  g.setAttribute('aT', new THREE.BufferAttribute(aT, 3));
  const uniforms = share({
    uSpineP: kun.uniforms.uSpineP, uSpineT: kun.uniforms.uSpineT, uSpineU: kun.uniforms.uSpineU,
    uFlapPhase: peng.uniforms.uFlapPhase, uFlapAmp: peng.uniforms.uFlapAmp, uFlapBase: peng.uniforms.uFlapBase,
    uFold: peng.uniforms.uFold, uTailPhase: peng.uniforms.uTailPhase,
    uPengM: { value: new THREE.Matrix4() }, uPx: { value: 500 },
  });
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${NOISE}
      ${SPINE_GLSL}
      ${PENG_DEFORM}
      uniform float uTime; uniform float uPx; uniform mat4 uPengM;
      attribute vec3 aPeng; attribute vec3 aPk; attribute vec3 aT;
      varying float vA; varying float vGold; varying vec3 vWorld;
      void main() {
        float td = aT.x, ta = aT.y, r = aT.z;
        if (uTime < td - 0.15 || uTime > ta + 1.2) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
        vec3 n = vec3(0.0, 1.0, 0.0);
        vec3 A = kunWorld(position, n);
        vec3 n2 = vec3(0.0, 1.0, 0.0);
        vec3 B = (uPengM * vec4(pengDeform(aPeng, aPk.x, aPk.yz, n2), 1.0)).xyz;
        float s = clamp((uTime - td) / (ta - td), 0.0, 1.0);
        float e = s * s * (3.0 - 2.0 * s);
        vec3 P = mix(A, B, e);
        // the ink billows: a curl of noise and a lift, strongest mid-flight
        float bell = sin(3.14159 * e);
        vec3 q = P * 0.012 + vec3(0.0, uTime * 0.25, r * 3.0);
        vec3 curl = vec3(snoise(q), snoise(q + 19.1), snoise(q + 37.7));
        P += (curl * 34.0 + vec3(0.0, 26.0, 0.0) + normalize(n) * 10.0) * bell;
        vGold = step(0.93, r);
        vA = smoothstep(td - 0.15, td + 0.25, uTime) * (1.0 - smoothstep(ta, ta + 1.2, uTime)) * (0.45 + 0.55 * bell + vGold * 0.5);
        vWorld = P;
        vec4 mv = viewMatrix * vec4(P, 1.0);
        gl_PointSize = clamp((0.9 + r * 1.0 + bell * 1.0) * uPx / max(-mv.z, 1.0), 1.0, 14.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${FOG}
      varying float vA; varying float vGold; varying vec3 vWorld;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = (1.0 - smoothstep(0.25, 0.5, d)) * vA;
        vec3 ink = vec3(0.025, 0.03, 0.035), gold = vec3(1.7, 1.15, 0.5);
        vec3 c = mix(ink, gold, vGold);
        gl_FragColor = vec4(applyFog(c, vWorld), a * (vGold > 0.5 ? 0.9 : 0.85));
      }`,
    transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.renderOrder = 30;
  pts.update = (t) => { pts.visible = t > T.dissolve - 0.3 && t < T.formed + 3; uniforms.uPengM.value.copy(peng.matrix); };
  return pts;
}

// ---------------------------------------------------------------- 水击 — the breach spray
export function makeSpray(kun) {
  const P0 = [], V0 = [], TL = [];
  const add = (p, v, t0, size) => { P0.push(...p); V0.push(...v); TL.push(t0, size); };
  // the crown
  for (let i = 0; i < 3500; i++) {
    const a = rnd() * Math.PI * 2, r = 14 + rnd() * 22, up = 20 + rnd() * rnd() * 75, out = 12 + rnd() * 34;
    add([252 + Math.cos(a) * r, 0, -16 + Math.sin(a) * r], [Math.cos(a) * out, up, Math.sin(a) * out], T.breach - 0.1 + rnd() * 1.1, 0.6 + rnd() * 1.6);
  }
  // water pouring off the rising body: sample the spine at many times
  for (let ts = T.breach; ts < T.dissolve + 3.2; ts += 0.08) {
    kun.update(ts);
    const S = kun.spineP, n = S.length;
    kun.update(ts + 0.05);
    const S2 = kun.spineP.map((v) => v.clone());
    kun.update(ts);
    for (let k = 0; k < 40; k++) {
      const i = Math.floor(rnd() * (n - 2));
      const u = (i / (n - 1)) * 1.22;
      if (u > 1.05 || S[i].y < 2) continue;
      if (u * 3 + T.dissolve < ts) continue; // already gone to ink
      const rad = 12 * (u < 0.9 ? 1 : 0.3);
      const a = rnd() * Math.PI * 2;
      const vel = S2[i].clone().sub(S[i]).multiplyScalar(1 / 0.05);
      add([S[i].x + Math.cos(a) * rad, S[i].y + Math.sin(a) * rad * 0.8, S[i].z + Math.sin(a) * rad],
        [vel.x * 0.4 + (rnd() - 0.5) * 8, vel.y * 0.2 + rnd() * 4, vel.z * 0.4 + (rnd() - 0.5) * 8], ts, 0.4 + rnd() * 0.9);
    }
  }
  const N = TL.length / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P0, 3));
  g.setAttribute('aV', new THREE.Float32BufferAttribute(V0, 3));
  g.setAttribute('aTL', new THREE.Float32BufferAttribute(TL, 2));
  const mat = new THREE.ShaderMaterial({
    uniforms: share({ uPx: { value: 500 } }),
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uPx;
      attribute vec3 aV; attribute vec2 aTL;
      varying float vA; varying vec3 vWorld;
      void main() {
        float dt = uTime - aTL.x;
        vec3 p = position + aV * dt + vec3(0.0, -25.0, 0.0) * dt * dt;
        vA = step(0.0, dt) * step(-1.0, p.y) * (1.0 - smoothstep(2.5, 4.0, dt));
        vWorld = p;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = vA > 0.0 ? clamp(aTL.y * uPx / max(-mv.z, 1.0), 1.0, 18.0) : 0.0;
        gl_Position = vA > 0.0 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${FOG}
      varying float vA; varying vec3 vWorld;
      void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(applyFog(vec3(0.74, 0.76, 0.75), vWorld), vA * (1.0 - smoothstep(0.2, 0.5, d)) * 0.5); }`,
    transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.renderOrder = 31;
  pts.update = (t) => { pts.visible = t > T.breach - 0.2 && t < T.dissolve + 8; };
  pts.count = N;
  return pts;
}

// ---------------------------------------------------------------- 扶摇 — the whirlwind, drawn as streaks of wind
export function makeWhirlwind(N = 16000) {
  const sd = new Float32Array(N * 2 * 4), end = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const a = [rnd(), rnd(), rnd(), rnd()];
    for (let e = 0; e < 2; e++) { sd.set(a, (i * 2 + e) * 4); end[i * 2 + e] = e; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
  g.setAttribute('aS', new THREE.BufferAttribute(sd, 4));
  g.setAttribute('aE', new THREE.BufferAttribute(end, 1));
  const uniforms = share({ uPx: { value: 500 }, uWhirl: { value: 0 }, uAxis: { value: AXIS } });
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uWhirl; uniform vec2 uAxis; uniform vec3 uCam;
      attribute vec4 aS; attribute float aE;
      varying float vA; varying float vInk; varying vec3 vWorld;
      void main() {
        const float H = 1250.0;
        float tt = uTime - 48.0;
        float h = mod(aS.x * H + tt * (40.0 + aS.y * 80.0), H);
        // a funnel: narrow at the sea, opening upward
        float rad = 40.0 + h * 0.09 + aS.z * aS.z * 90.0 + sin(h * 0.012 + aS.w * 6.0) * 10.0;
        float w = (1.1 + 0.6 * (1.0 - h / H)) * (70.0 / rad + 0.35);
        // streaks gather into three spiral arms
        float arm = floor(aS.w * 3.0) / 3.0 + fract(aS.w * 3.0) * 0.09;
        float ang = arm * 6.2832 + tt * w - h * 0.006 - aE * (0.16 + aS.y * 0.2) * min(w, 2.0);
        vec3 p = vec3(uAxis.x + cos(ang) * rad, h - 10.0 - aE * 6.0, uAxis.y + sin(ang) * rad);
        vInk = step(0.6, aS.y);
        float base = 1.0 - smoothstep(0.0, 80.0, h);
        float dc = length(p - uCam);
        vA = uWhirl * smoothstep(-10.0, 30.0, h) * (1.0 - smoothstep(H - 250.0, H, h)) * (0.45 + 0.4 * base) * smoothstep(40.0, 160.0, dc) * (1.0 - aE * 0.95);
        vWorld = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${FOG}
      uniform vec3 uSunColor;
      varying float vA; varying float vInk; varying vec3 vWorld;
      void main() {
        vec3 c = mix(vec3(0.92, 0.91, 0.88) * (0.75 + 0.25 * uSunColor), vec3(0.08, 0.09, 0.1), vInk * 0.85);
        gl_FragColor = vec4(applyFog(c, vWorld), vA);
      }`,
    transparent: true, depthWrite: false,
  });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false; lines.renderOrder = 32;
  lines.update = (t) => {
    const w = Math.min(1, Math.max(0, (t - 48.5) / 3.5)) * (1 - Math.min(1, Math.max(0, (t - 62) / 5)));
    uniforms.uWhirl.value = w; lines.visible = w > 0.001;
  };
  return lines;
}
