// 鹏 — the great bird. Local frame: +z forward, +y up, wings along x.
import * as THREE from 'three';
import { NOISE, FOG } from './noise.glsl.js';
import { share } from './shared.js';
import { T, smooth, clamp } from './timeline.js';

export const PENG_SPAN = 118;

function buildGeometry() {
  const pos = [], kind = [], fe = [], seed = [], idx = [];
  const strip = (nA, nB, f, k, sd) => {
    const base = pos.length / 3;
    for (let i = 0; i <= nA; i++) for (let j = 0; j <= nB; j++) { const [x, y, z, a, b] = f(i / nA, j / nB); pos.push(x, y, z); kind.push(k); fe.push(a, b); seed.push(sd); }
    for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) { const a = base + i * (nB + 1) + j, b = a + 1, c = a + nB + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  };
  // body: a lathe along z, slightly flattened
  const prof = (z) => {
    if (z < -36) return 0.5;
    if (z < 4) return 2.5 + 8.5 * Math.sin(((z + 36) / 40) * Math.PI / 2);
    if (z < 22) return 11 - 6 * ((z - 4) / 18);
    if (z < 33) return 5 + 1.3 * Math.sin(((z - 22) / 11) * Math.PI);
    return Math.max(0.2, 5 * (1 - (z - 33) / 4));
  };
  strip(60, 28, (a, b) => {
    const z = -36 + a * 73, r = prof(z), th = b * Math.PI * 2;
    return [Math.sin(th) * r, Math.cos(th) * r * 0.85 + (z > 20 ? (z - 20) * 0.22 : 0), z, a, 0];
  }, 0, 0);
  // beak
  strip(8, 12, (a, b) => {
    const z = 36 + a * 11, r = 2.6 * (1 - a) + 0.15, th = b * Math.PI * 2;
    return [Math.sin(th) * r, 3.2 + Math.cos(th) * r * 0.7 - a * a * 2.5, z, a, 0];
  }, 3, 0);
  // crest plumes
  for (let i = 0; i < 3; i++) {
    strip(10, 2, (a, b) => {
      const w = 1.4 * (1 - a), side = (b - 0.5) * 2;
      return [side * w + (i - 1) * 1.5, 7 + a * 9 + Math.sin(a * 3) * 2 - i, 30 - a * 22 - i * 2, a, side];
    }, 2, 10 + i);
  }
  // wings
  let fid = 0;
  for (const s of [-1, 1]) {
    const lead = [[6, 3, 7], [42, 5, 4], [68, 6, -1], [PENG_SPAN, 3, -20]];
    const leadAt = (a) => {
      const f = a * 3, i = Math.min(2, Math.floor(f)), k = f - i;
      const p = lead[i], q = lead[i + 1];
      return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
    };
    // coverts: a smooth membrane behind the leading edge
    strip(40, 6, (a, b) => {
      const p = leadAt(a * 0.86);
      const depth = 24 * Math.pow(1 - a, 0.6) + 7;
      return [s * p[0], p[1] - b * 1.2 + Math.sin(b * Math.PI) * 1.2, p[2] - b * depth, a, b];
    }, 4, 0);
    // secondaries along the arm
    for (let i = 0; i < 15; i++) {
      const a = 0.03 + (i / 14) * 0.6;
      const p = leadAt(a);
      const len = 40 - i * 0.3, ang = 0.05 + a * 0.25;
      const d = [Math.sin(ang), -0.04, -Math.cos(ang)];
      strip(12, 2, (t, b) => {
        const w = 5.2 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.05)), 0.5) * (1 - 0.25 * t), side = (b - 0.5) * 2;
        return [s * (p[0] + d[0] * len * t + side * w * Math.cos(ang)), p[1] - 1.5 + d[1] * len * t - t * t * 2.5, p[2] - 10 + d[2] * len * t + side * w * Math.sin(ang), t, side];
      }, 1, fid++);
    }
    // primaries fanning out from the wrist: the "fingers"
    for (let i = 0; i < 10; i++) {
      const a = 0.64 + (i / 9) * 0.34;
      const p = leadAt(a);
      const ang = 0.55 + (i / 9) * 0.95;
      const len = 46 + Math.sin((i / 9) * Math.PI) * 18;
      const d = [Math.sin(ang), -0.03, -Math.cos(ang)];
      strip(14, 2, (t, b) => {
        const w = 4.6 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.04)), 0.45) * (1 - 0.45 * t), side = (b - 0.5) * 2;
        return [s * (p[0] + d[0] * len * t + side * w * Math.cos(ang)), p[1] - 2 + d[1] * len * t - t * t * 4, p[2] - 4 + d[2] * len * t + side * w * Math.sin(ang), t, side];
      }, 1, fid++);
    }
  }
  // long streaming tail plumes
  for (let i = 0; i < 7; i++) {
    const spread = (i - 3) / 3;
    const len = 80 + (3 - Math.abs(i - 3)) * 16;
    strip(30, 2, (t, b) => {
      const w = 3.2 * (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.05))) + (t > 0.82 ? 4 * Math.sin(((t - 0.82) / 0.18) * Math.PI) : 0), side = (b - 0.5) * 2;
      return [spread * (6 + t * len * 0.38) + side * w, -1 - t * 8 + Math.sin(t * 4 + i) * 4, -34 - t * len, t, side];
    }, 2, 20 + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('kind', new THREE.Float32BufferAttribute(kind, 1));
  g.setAttribute('fe', new THREE.Float32BufferAttribute(fe, 2));
  g.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Wing flap, fold and tail wave. Shared with the transformation particles. */
export const PENG_DEFORM = /* glsl */ `
uniform float uFlapPhase;
uniform float uFlapAmp;
uniform float uFlapBase;
uniform float uFold;
uniform float uTailPhase;
vec3 pengDeform(vec3 p, float kind, vec2 fe, inout vec3 n) {
  if (kind > 0.5 && kind < 1.5 || kind > 3.5) {
    float s = p.x < 0.0 ? -1.0 : 1.0;
    float r = abs(p.x);
    float k = smoothstep(4.0, 30.0, r);
    float a = (uFlapBase + uFlapAmp * sin(uFlapPhase - r * 0.014)) * k * (0.6 + 0.4 * smoothstep(20.0, 110.0, r));
    a -= uFold * 1.1 * smoothstep(5.0, 60.0, r);
    float c = cos(a), sn = sin(a);
    vec2 q = vec2(r * c - p.y * sn, r * sn + p.y * c);
    vec2 m = vec2(s * n.x, n.y);
    m = vec2(m.x * c - m.y * sn, m.x * sn + m.y * c);
    p = vec3(s * q.x, q.y, p.z);
    n = normalize(vec3(s * m.x, m.y, n.z));
    // folding also sweeps the wing back along the body
    float sw = uFold * smoothstep(8.0, 90.0, r);
    p.z -= sw * r * 0.55; p.x *= 1.0 - sw * 0.5;
  } else if (kind > 1.5 && kind < 2.5) {
    float t = fe.x;
    p.y += sin(uTailPhase - t * 5.0) * t * t * 10.0;
    p.x += cos(uTailPhase * 0.7 - t * 4.0) * t * t * 7.0;
  }
  return p;
}
`;

const VS = /* glsl */ `
${PENG_DEFORM}
attribute float kind;
attribute vec2 fe;
attribute float seed;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec2 vFe;
varying float vKind;
varying float vSeed;
void main() {
  vec3 n = normal;
  vec3 p = pengDeform(position, kind, fe, n);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz; vNormal = normalize(mat3(modelMatrix) * n); vLocal = position; vFe = fe; vKind = kind; vSeed = seed;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FS = /* glsl */ `
${NOISE}
${FOG}
uniform float uTime;
uniform vec3 uSunColor;
uniform vec3 uSkyHorizon;
uniform float uFormT0;
uniform float uLight;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec2 vFe;
varying float vKind;
varying float vSeed;
void main() {
  // forms from the body outward as the particles arrive
  float rn = clamp(length(vLocal.xz) / 120.0, 0.0, 1.0);
  float th = uFormT0 + rn * 3.5 + snoise(vLocal * 0.06) * 0.5;
  if (uTime < th) discard;
  float edge = 1.0 - smoothstep(0.0, 0.25, uTime - th);

  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCam - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  float t = vFe.x, side = vFe.y;
  vec3 ink = vec3(0.02, 0.025, 0.03), mid = vec3(0.1, 0.12, 0.13), ash = vec3(0.3, 0.29, 0.27);
  vec3 col;
  float rim = 0.0;
  if (vKind < 0.5) {
    col = mix(mid * 0.6, ink, 0.6) * (0.85 + 0.3 * fbm(vLocal * 0.15));
  } else if (vKind > 2.5 && vKind < 3.5) {
    col = vec3(0.85, 0.62, 0.22);
  } else if (vKind > 3.5) {
    // coverts: soft ash with brush texture and a hint of the five colours
    col = mix(ash * 0.75, mid, vFe.y) * (0.8 + 0.35 * fbm(vec3(vLocal.xz * 0.06, 2.0)));
    vec3 five = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + vLocal.x * 0.004 + 0.2));
    col = mix(col, col * five * 1.6, 0.18);
  } else {
    // feathers: ash at the root, ink at the tip, a pale shaft, gilded edges
    col = mix(ash * 0.8, ink, smoothstep(0.15, 0.85, t));
    col = mix(col, mid, (1.0 - smoothstep(0.0, 0.08, abs(side))) * 0.6 * (1.0 - t));
    vec3 five = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + vSeed * 0.07));
    col = mix(col, col * five * 1.8, 0.14 * (1.0 - t));
    rim = smoothstep(0.82, 0.98, abs(side)) + smoothstep(0.93, 1.0, t);
    // the tail's golden eyes
    if (vKind > 1.5 && vKind < 2.5 && vSeed > 15.0) {
      float e = length(vec2((t - 0.9) * 9.0, side * 1.1));
      col = mix(col, vec3(0.9, 0.62, 0.2), 1.0 - smoothstep(0.55, 0.7, e));
      col = mix(col, vec3(0.05, 0.25, 0.3), 1.0 - smoothstep(0.25, 0.35, e));
    }
    col *= 0.85 + 0.3 * fbm(vec3(t * 9.0, side * 2.0, vSeed));
  }
  vec3 L = normalize(uSunDir);
  float diff = max(dot(N, L) * 0.6 + 0.4, 0.0);
  vec3 lit = col * (0.35 + diff * uSunColor * 0.9) * uLight;
  // back light through the feathers and a haze rim
  float back = pow(max(dot(-V, L), 0.0), 3.0) * (vKind > 0.5 ? 1.0 : 0.3);
  lit += uSunColor * back * 0.35 * (1.0 - t * 0.5);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  lit += uSkyHorizon * fres * 0.4;
  lit += vec3(1.0, 0.78, 0.4) * rim * (0.25 + back * 2.0);
  // the eye
  vec3 eyeC = vec3(sign(vLocal.x) * 4.6, 6.0, 32.5);
  float ed = length(vLocal - eyeC);
  if (vKind < 0.5) lit = mix(lit, vec3(2.4, 1.6, 0.6), 1.0 - smoothstep(0.9, 1.3, ed));
  lit = mix(lit, vec3(1.3, 0.9, 0.4), edge * 0.7);
  gl_FragColor = vec4(applyFog(lit, vWorld), 1.0);
}
`;

// ---- flight: path keys [t, x, y, z] ----------------------------------------------------
export const AXIS = new THREE.Vector2(300, 80); // the whirlwind's axis (x, z)
const PKEYS = [[T.dissolve, 288, 175, -26], [T.formed, 300, 215, -20], [T.climb, 318, 240, -6]];
export const helixAngle = (t) => -1.36 + (t - T.climb) * 0.62;
for (let i = 1; i <= 14; i++) {
  const t = T.climb + i, a = helixAngle(t), rad = 88 - i * 1.2;
  PKEYS.push([t, AXIS.x + Math.cos(a) * rad, 240 + i * i * 4.2, AXIS.y + Math.sin(a) * rad]);
}
PKEYS.push([T.glide + 2, 330, 1085, 330], [T.glide + 7, 300, 1070, 700], [T.endFade, 260, 1050, 1250], [90, 220, 1040, 2100]);
function hermite(K, t) {
  if (t <= K[0][0]) return K[0].slice(1);
  if (t >= K[K.length - 1][0]) return K[K.length - 1].slice(1);
  let i = 0; while (K[i + 1][0] < t) i++;
  const p0 = K[Math.max(0, i - 1)], p1 = K[i], p2 = K[i + 1], p3 = K[Math.min(K.length - 1, i + 2)];
  const h = p2[0] - p1[0], s = (t - p1[0]) / h, out = [];
  for (let k = 1; k <= 3; k++) {
    const m1 = ((p2[k] - p0[k]) / (p2[0] - p0[0] || 1)) * h, m2 = ((p3[k] - p1[k]) / (p3[0] - p1[0] || 1)) * h;
    const s2 = s * s, s3 = s2 * s;
    out.push((2 * s3 - 3 * s2 + 1) * p1[k] + (s3 - 2 * s2 + s) * m1 + (-2 * s3 + 3 * s2) * p2[k] + (s3 - s2) * m2);
  }
  return out;
}
export const pengPos = (t) => new THREE.Vector3(...hermite(PKEYS, t));

/** Flap phase is the integral of the flap rate, so scrubbing stays consistent. */
function flapRate(t) { return t < T.formed ? 0.6 : t < T.climb ? 1.2 : t < T.glide - 1 ? 1.75 : 0.5; }
function flapPhase(t) {
  let ph = 0; const step = 0.05;
  for (let x = T.dissolve; x < t; x += step) ph += flapRate(x) * step * Math.PI;
  return ph;
}

/** Film times of each downstroke, for the score. */
export function flapTimes() {
  const out = []; let ph = 0, last = 0; const step = 0.01;
  for (let x = T.dissolve; x < T.endFade; x += step) {
    ph += flapRate(x) * step * Math.PI;
    const k = Math.floor((ph + Math.PI / 2) / (Math.PI * 2));
    if (k > last) { last = k; if (x > T.formed) out.push(x); }
  }
  return out;
}

export class Peng {
  constructor() {
    this.geometry = buildGeometry();
    this.uniforms = share({
      uFlapPhase: { value: 0 }, uFlapAmp: { value: 0 }, uFlapBase: { value: 0 }, uFold: { value: 1 }, uTailPhase: { value: 0 },
      uFormT0: { value: T.dissolve + 2.2 },
    });
    this.material = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: this.uniforms, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }
  update(t) {
    const p = pengPos(t);
    const ahead = pengPos(t + 0.25), behind = pengPos(t - 0.25);
    const fwd = ahead.clone().sub(behind);
    if (fwd.lengthSq() < 1e-4) fwd.set(1, 0.1, 0);
    fwd.normalize();
    // while forming she faces the way the fish was going, then turns south
    const accel = ahead.clone().add(behind).addScaledVector(p, -2);
    const bank = clamp(accel.dot(new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0))) * 0.08, -0.6, 0.6);
    const z = fwd.clone().multiplyScalar(1);
    const x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), z).normalize();
    let y = new THREE.Vector3().crossVectors(z, x).normalize();
    x.applyAxisAngle(z, bank); y.applyAxisAngle(z, bank);
    const m = new THREE.Matrix4().makeBasis(x, y, z).setPosition(p);
    this.mesh.matrix.copy(m);
    this.mesh.matrixWorld.copy(m);
    this.matrix = m;
    const Uf = this.uniforms;
    Uf.uFold.value = 1 - smooth(T.dissolve + 4.5, T.formed + 1.5, t);
    Uf.uFlapAmp.value = t < T.climb ? 0.25 + 0.35 * smooth(T.formed, T.climb, t) : t < T.glide - 1 ? 0.62 : 0.62 - 0.52 * smooth(T.glide - 1, T.glide + 3, t);
    Uf.uFlapBase.value = t < T.glide ? 0.05 : -0.02;
    Uf.uFlapPhase.value = flapPhase(t);
    Uf.uTailPhase.value = t * 2.2;
    this.mesh.visible = t > T.dissolve + 2;
  }
}
