// 鲲 — the great fish. Built in "spine space" and bent along a path that the CPU solves each frame.
import * as THREE from 'three';
import { NOISE, FOG } from './noise.glsl.js';
import { share } from './shared.js';
import { T } from './timeline.js';

export const KUN_L = 160;
const NSPINE = 64, UMAX = 1.22;

// head trajectory keys: [t, x, y, z]
const KEYS = [
  [0, -390, -64, 0], [10, -150, -62, 0], [19.5, 0, -60, 0], [29, 125, -58, 0], [33, 190, -46, -6],
  [36, 230, -20, -12], [T.breach, 252, 0, -16], [39.5, 264, 70, -20], [41.2, 278, 130, -24], [43.5, 292, 170, -27], [47, 305, 185, -30],
];
function hermite(t) {
  const K = KEYS;
  if (t <= K[0][0]) { const a = K[0], b = K[1], f = (t - a[0]) / (b[0] - a[0]); return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f]; }
  if (t >= K[K.length - 1][0]) { const a = K[K.length - 2], b = K[K.length - 1], f = (t - a[0]) / (b[0] - a[0]); return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f]; }
  let i = 0; while (K[i + 1][0] < t) i++;
  const p0 = K[Math.max(0, i - 1)], p1 = K[i], p2 = K[i + 1], p3 = K[Math.min(K.length - 1, i + 2)];
  const h = p2[0] - p1[0], s = (t - p1[0]) / h;
  const out = [0, 0, 0];
  for (let k = 1; k <= 3; k++) {
    const m1 = ((p2[k] - p0[k]) / (p2[0] - p0[0] || 1)) * h, m2 = ((p3[k] - p1[k]) / (p3[0] - p1[0] || 1)) * h;
    const s2 = s * s, s3 = s2 * s;
    out[k - 1] = (2 * s3 - 3 * s2 + 1) * p1[k] + (s3 - 2 * s2 + s) * m1 + (-2 * s3 + 3 * s2) * p2[k] + (s3 - s2) * m2;
  }
  return out;
}
// dense trajectory with arc length, so the body follows the head's path like a train
const DT = 0.02, T0 = -10, T1 = 50;
const TRAJ = [], ARC = [];
{ let s = 0, prev = null; for (let t = T0; t <= T1; t += DT) { const p = hermite(t); if (prev) s += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]); TRAJ.push(p); ARC.push(s); prev = p; } }
function posAtArc(s) {
  if (s <= ARC[0]) { const a = TRAJ[0], b = TRAJ[1], d = ARC[1] - ARC[0]; const f = (s - ARC[0]) / d; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
  let lo = 0, hi = ARC.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ARC[m] < s) lo = m; else hi = m; }
  const f = (s - ARC[lo]) / (ARC[hi] - ARC[lo] || 1), a = TRAJ[lo], b = TRAJ[hi];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
function arcAtTime(t) { const i = Math.min(ARC.length - 2, Math.max(0, Math.floor((t - T0) / DT))); const f = (t - T0) / DT - i; return ARC[i] + (ARC[i + 1] - ARC[i]) * Math.min(1, Math.max(0, f)); }
export function kunHead(t) { return new THREE.Vector3(...hermite(t)); }

function R(u) {
  let r;
  // a blunt, whale-like head that rounds smoothly into the body
  if (u < 0.45) r = Math.pow(Math.sin(Math.min(u / 0.2, 1) * Math.PI / 2), 0.5) * (1 - 0.06 * Math.max(0, (u - 0.2) / 0.25));
  else if (u < 0.9) r = 0.94 * Math.pow(Math.cos(((u - 0.45) / 0.45) * Math.PI / 2), 1.15) + 0.05;
  else r = 0.05 * Math.max(0.2, 1 - (u - 0.9) * 3);
  return r * KUN_L * 0.115;
}
export const H = (u) => R(u);
export const W = (u) => R(u) * 0.82;

/** Build the body + fins in local spine space: X = forward (-u*L), Y = up, Z = side. */
function buildGeometry() {
  const L = KUN_L;
  const pos = [], uv = [], kind = [], fin = [], idx = [];
  const NU = 230, NS = 72;
  // body
  for (let i = 0; i <= NU; i++) {
    const u = (i / NU) * 1.0;
    for (let j = 0; j <= NS; j++) {
      const th = (j / NS) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const y = c * H(u) * (c < 0 ? 0.82 : 1), z = s * W(u);
      pos.push(-u * L, y, z); uv.push(u, j / NS); kind.push(0); fin.push(0);
    }
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NS; j++) { const a = i * (NS + 1) + j, b = a + 1, c = a + NS + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const surf = (nA, nB, f, k) => {
    const base = pos.length / 3;
    for (let i = 0; i <= nA; i++) for (let j = 0; j <= nB; j++) { const [x, y, z, u, b] = f(i / nA, j / nB); pos.push(x, y, z); uv.push(u, b); kind.push(k); fin.push(b); }
    for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) { const a = base + i * (nB + 1) + j, b = a + 1, c = a + nB + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  };
  // long, wing-like pectoral fins (a hint of the wings to come)
  for (const s of [-1, 1]) {
    surf(18, 26, (a, b) => {
      const u0 = 0.19 + 0.08 * a;
      const root = [-u0 * L, -0.28 * H(u0), s * W(u0) * 0.86];
      const span = 0.42 * L * (1 - 0.55 * a);
      const d = [-0.55, -0.22, s * 1.0], dl = Math.hypot(...d);
      const x = root[0] + (d[0] / dl) * b * span - b * b * 0.07 * L - a * b * 0.04 * L;
      const y = root[1] + (d[1] / dl) * b * span - Math.sin(b * Math.PI) * 2.5;
      const z = root[2] + (d[2] / dl) * b * span;
      return [x, y, z, -x / L, b];
    }, 1);
  }
  // dorsal ridge
  surf(30, 8, (a, b) => {
    const u = 0.3 + 0.32 * a;
    return [-u * L - b * 0.06 * L, H(u) * 0.95 + b * 0.085 * L * Math.pow(Math.sin(Math.PI * a), 0.7), 0, u, b];
  }, 1);
  // crescent tail
  surf(40, 20, (a, b) => {
    const v = a * 2 - 1;
    const uEdge = 1.04 + 0.13 * Math.pow(Math.abs(v), 0.8);
    const u = 0.88 + (uEdge - 0.88) * b;
    const y = v * (H(0.88) * 0.6 + 0.33 * L * Math.pow(b, 0.85));
    return [-u * L, y, 0, u, b];
  }, 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('kind', new THREE.Float32BufferAttribute(kind, 1));
  g.setAttribute('finB', new THREE.Float32BufferAttribute(fin, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export const SPINE_GLSL = /* glsl */ `
#define NSPINE ${NSPINE}
uniform vec3 uSpineP[NSPINE];
uniform vec3 uSpineT[NSPINE];
uniform vec3 uSpineU[NSPINE];
const float UMAX = ${UMAX.toFixed(3)};
const float KUN_L = ${KUN_L.toFixed(1)};
// local (X forward, Y up, Z side) -> world; also rotates a local normal
vec3 kunWorld(vec3 lp, inout vec3 n) {
  float u = clamp(-lp.x / KUN_L, 0.0, UMAX);
  float f = u / UMAX * float(NSPINE - 1);
  int i = int(floor(f)); int j = min(i + 1, NSPINE - 1); float k = f - float(i);
  vec3 P = mix(uSpineP[i], uSpineP[j], k);
  vec3 Tt = normalize(mix(uSpineT[i], uSpineT[j], k));
  vec3 Up = normalize(mix(uSpineU[i], uSpineU[j], k));
  vec3 S = normalize(cross(Tt, Up));
  n = normalize(n.x * Tt + n.y * Up + n.z * S);
  return P + Up * lp.y + S * lp.z;
}
`;

const VS = /* glsl */ `
${SPINE_GLSL}
uniform float uTime;
attribute float kind;
attribute float finB;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec2 vUv;
varying float vKind;
varying float vFin;
void main() {
  vec3 lp = position;
  // fins move slowly, like a bird's wing under water
  if (kind > 0.5 && kind < 1.5 && abs(lp.z) > 8.0) lp.y += sin(uTime * 0.55 + lp.x * 0.01) * finB * finB * 9.0;
  vec3 n = normal;
  vec3 wp = kunWorld(lp, n);
  vWorld = wp; vNormal = n; vLocal = lp; vUv = uv; vKind = kind; vFin = finB;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FS = /* glsl */ `
${NOISE}
${FOG}
uniform float uTime;
uniform float uDissolveT0;
uniform float uWet;
uniform float uLight;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec2 vUv;
varying float vKind;
varying float vFin;

float H(float u) {
  float r;
  if (u < 0.45) r = pow(sin(min(u / 0.2, 1.0) * 1.5708), 0.5) * (1.0 - 0.06 * max(0.0, (u - 0.2) / 0.25));
  else if (u < 0.9) r = 0.94 * pow(cos(((u - 0.45) / 0.45) * 1.5708), 1.15) + 0.05;
  else r = 0.05;
  return r * 160.0 * 0.115;
}

void main() {
  float u = vUv.x;
  // dissolve head-to-tail into the particles of the coming bird
  float th = uDissolveT0 + u * 3.0 + snoise(vLocal * 0.06) * 0.6;
  if (uTime > th) discard;
  float edge = 1.0 - smoothstep(0.0, 0.12, th - uTime);

  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCam - vWorld);
  float hgt = vLocal.y / max(H(u), 1.0);
  vec3 back = vec3(0.025, 0.055, 0.075), belly = vec3(0.2, 0.3, 0.31);
  vec3 col = mix(belly, back, smoothstep(-0.55, 0.25, hgt));
  // brush texture: long strokes along the body
  float stroke = fbm(vec3(u * 26.0, vUv.y * 7.0, 3.0));
  col *= 0.8 + 0.45 * stroke;
  // scales: offset rows of arcs, with a slow pulse of light running toward the tail
  vec2 g = vec2(u * 95.0, vUv.y * 44.0);
  g.y += floor(g.x) * 0.5;
  vec2 f = fract(g) - vec2(0.0, 0.5);
  float arc = abs(length(f * vec2(1.0, 1.7)) - 0.55);
  float scaleLine = (1.0 - smoothstep(0.0, 0.07, arc)) * smoothstep(0.03, 0.12, u) * (1.0 - smoothstep(0.82, 0.9, u));
  float pulse = pow(0.5 + 0.5 * sin(u * 34.0 - uTime * 1.3), 8.0);
  vec3 glow = vec3(0.25, 0.85, 0.8) * scaleLine * (0.12 + 0.9 * pulse) * (0.4 + 0.6 * smoothstep(-0.2, 0.6, hgt));
  // the golden lateral line
  float lateral = 1.0 - smoothstep(0.0, 0.05, abs(hgt - 0.05 + 0.04 * sin(u * 20.0)));
  glow += vec3(0.95, 0.7, 0.3) * lateral * smoothstep(0.1, 0.2, u) * (1.0 - smoothstep(0.75, 0.88, u)) * (0.2 + 0.45 * pulse);
  // the long mouth: a dark seam from the snout back under the eye
  float mouthY = -0.2 - 0.25 * smoothstep(0.0, 0.13, u);
  float mouth = (1.0 - smoothstep(0.0, 0.035, abs(hgt - mouthY))) * smoothstep(0.004, 0.02, u) * (1.0 - smoothstep(0.11, 0.135, u));
  col *= 1.0 - mouth * 0.8;
  if (vKind > 0.5) {
    // fins: lighter, with rays and a glowing rim
    float rays = 1.0 - smoothstep(0.0, 0.18, abs(fract(vUv.y * 0.0 + vLocal.x * 0.12 + vLocal.z * 0.12) - 0.5));
    col = mix(vec3(0.09, 0.17, 0.2), vec3(0.03, 0.06, 0.08), vFin) * (0.8 + 0.4 * stroke);
    glow = vec3(0.3, 0.85, 0.85) * (rays * 0.12 + smoothstep(0.85, 1.0, vFin) * 0.6) * (0.5 + 0.5 * pulse);
  }
  // light from above: diffuse, plus caustics on the back while under water
  vec3 Ld = normalize(mix(vec3(0.2, 1.0, 0.1), vec3(0.3, 0.6, 0.7), 1.0 - uUnder));
  float diff = max(dot(N, Ld), 0.0);
  float caus = pow(abs(snoise(vec3(vWorld.xz * 0.05, uTime * 0.35))), 0.25);
  caus = pow(1.0 - caus, 6.0) * uUnder * smoothstep(-90.0, -20.0, vWorld.y) * max(N.y, 0.0);
  vec3 lit = col * (0.25 + diff * 0.9) * uLight + vec3(0.4, 0.9, 0.85) * caus * 0.5;
  // rim haze
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  lit += mix(vec3(0.18, 0.4, 0.45), vec3(0.8, 0.75, 0.65), 1.0 - uUnder) * fres * 0.55;
  // wet sheen in the air
  vec3 Hh = normalize(Ld + V);
  lit += vec3(1.0, 0.95, 0.85) * pow(max(dot(N, Hh), 0.0), 60.0) * uWet * 1.4;
  // the eye: a moon in the dark
  float eu = 0.075;
  vec3 eyeC = vec3(-eu * 160.0, 0.18 * H(eu), sign(vLocal.z) * 0.8 * H(eu) * 0.95);
  float ed = length(vLocal - eyeC) / 3.6;
  if (ed < 1.4 && vKind < 0.5) {
    float iris = 1.0 - smoothstep(0.92, 1.0, ed);
    float ring = smoothstep(0.55, 1.0, ed) * iris;
    vec2 ep = (vLocal - eyeC).xy / 3.6;
    float pupil = 1.0 - smoothstep(0.1, 0.16, abs(ep.x) * 1.0 + ep.y * ep.y * 0.12);
    pupil *= 1.0 - smoothstep(0.75, 0.85, ed);
    vec3 ic = mix(vec3(1.0, 0.82, 0.42), vec3(0.95, 0.5, 0.15), ring);
    ic += vec3(0.6, 0.35, 0.1) * fbm(vec3(ep * 6.0, uTime * 0.2)) * 0.6;
    vec3 eye = mix(ic * 1.25, vec3(0.0), pupil);
    float hl = 1.0 - smoothstep(0.0, 0.14, length(ep - vec2(-0.28, 0.32)));
    eye += vec3(1.4) * hl;
    lit = mix(lit, eye, iris);
    lit += vec3(1.0, 0.7, 0.3) * (1.0 - smoothstep(1.0, 1.4, ed)) * 0.2;
    glow *= 1.0 - iris;
  }
  lit += glow;
  lit = mix(lit, vec3(1.3, 0.9, 0.4), edge * 0.8);
  gl_FragColor = vec4(applyFog(lit, vWorld), 1.0);
}
`;

export class Kun {
  constructor() {
    this.geometry = buildGeometry();
    this.spineP = Array.from({ length: NSPINE }, () => new THREE.Vector3());
    this.spineT = Array.from({ length: NSPINE }, () => new THREE.Vector3(1, 0, 0));
    this.spineU = Array.from({ length: NSPINE }, () => new THREE.Vector3(0, 1, 0));
    this.uniforms = share({
      uSpineP: { value: this.spineP }, uSpineT: { value: this.spineT }, uSpineU: { value: this.spineU },
      uDissolveT0: { value: T.dissolve }, uWet: { value: 0 },
    });
    this.material = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: this.uniforms, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }
  /** Solve the spine for time t: positions follow the head's path by arc length, plus a slow swimming wave. */
  update(t) {
    const L = KUN_L;
    const sHead = arcAtTime(t);
    const P = [];
    for (let i = 0; i < NSPINE; i++) {
      const u = (i / (NSPINE - 1)) * UMAX;
      P.push(posAtArc(sHead - u * L));
    }
    let up = new THREE.Vector3(0, 1, 0);
    const roll = Math.sin(Math.max(0, t - 30) * 0.4) * 0.25 * Math.min(1, Math.max(0, (t - 30) / 4));
    for (let i = 0; i < NSPINE; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(NSPINE - 1, i + 1)];
      const Tt = new THREE.Vector3(a[0] - b[0], a[1] - b[1], a[2] - b[2]).normalize(); // toward the head
      // parallel-transport the up vector down the body
      up.addScaledVector(Tt, -up.dot(Tt));
      if (up.lengthSq() < 1e-6) up.set(0, 1, 0).addScaledVector(Tt, -Tt.y);
      up.normalize();
      const side = new THREE.Vector3().crossVectors(Tt, up);
      const u = (i / (NSPINE - 1)) * UMAX;
      // swimming: the tail sweeps side to side in a travelling wave
      const sway = L * 0.04 * u * u * Math.sin(Math.PI * 2 * (u * 0.85 - t * 0.3));
      this.spineP[i].set(P[i][0], P[i][1], P[i][2]).addScaledVector(side, sway);
      this.spineT[i].copy(Tt);
      this.spineU[i].copy(up).applyAxisAngle(Tt, roll);
    }
    this.uniforms.uWet.value = t > T.breach - 0.2 ? 1 : 0;
    this.mesh.visible = t < T.dissolve + 4.5;
  }
}
