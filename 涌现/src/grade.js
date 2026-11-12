// Light, sky and the state of the land over time.
import * as THREE from 'three';
import { T, smooth, lerp } from './timeline.js';

const C = (r, g, b) => new THREE.Color(r, g, b);
const sunDir = (azX, azZ, elevDeg) => { const e = (elevDeg * Math.PI) / 180, h = Math.cos(e); const l = Math.hypot(azX, azZ); return new THREE.Vector3((azX / l) * h, Math.sin(e), (azZ / l) * h); };
// colour keys: [t, zen, hor, glow, sun colour]
const KEYS = [
  [44.0, C(0.002, 0.003, 0.008), C(0.01, 0.01, 0.02), C(0, 0, 0), C(1.0, 0.82, 0.65).multiplyScalar(1.6)],
  [48.5, C(0.03, 0.05, 0.14), C(0.55, 0.3, 0.25), C(0.9, 0.35, 0.12), C(1.0, 0.55, 0.3).multiplyScalar(1.4)],
  [53.0, C(0.1, 0.22, 0.5), C(0.7, 0.62, 0.6), C(0.5, 0.25, 0.1), C(1.0, 0.82, 0.62).multiplyScalar(1.9)],
  [60.0, C(0.11, 0.26, 0.6), C(0.55, 0.68, 0.84), C(0.12, 0.08, 0.04), C(1.0, 0.95, 0.88).multiplyScalar(2.1)],
  [68.0, C(0.1, 0.2, 0.46), C(0.78, 0.66, 0.55), C(0.45, 0.22, 0.08), C(1.0, 0.8, 0.55).multiplyScalar(2.0)],
  [76.0, C(0.07, 0.1, 0.26), C(1.0, 0.5, 0.25), C(1.0, 0.38, 0.12), C(1.0, 0.55, 0.25).multiplyScalar(2.0)],
  [84.0, C(0.04, 0.05, 0.14), C(0.85, 0.3, 0.14), C(1.0, 0.25, 0.06), C(1.0, 0.35, 0.12).multiplyScalar(1.6)],
  [89.0, C(0.008, 0.012, 0.035), C(0.12, 0.06, 0.07), C(0.25, 0.06, 0.03), C(0.5, 0.2, 0.1).multiplyScalar(0.6)],
  [92.0, C(0.003, 0.005, 0.016), C(0.016, 0.022, 0.05), C(0, 0, 0), C(0.32, 0.38, 0.55).multiplyScalar(0.55)],
];
function colours(t) {
  if (t <= KEYS[0][0]) return KEYS[0].slice(1).map((c) => c.clone());
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i], b = KEYS[i + 1];
    if (t <= b[0]) { const k = smooth(a[0], b[0], t); return [1, 2, 3, 4].map((j) => a[j].clone().lerp(b[j], k)); }
  }
  return KEYS[KEYS.length - 1].slice(1).map((c) => c.clone());
}

export const MOON = sunDir(-0.4, 1, 38);

export function grade(t) {
  const g = {};
  const [zen, hor, glow, sun] = colours(t);
  g.zen = zen; g.hor = hor; g.glow = glow; g.sunCol = sun;
  // the sun: a raking key light over the pattern, then a real sun that rises, crosses and sets
  let dir;
  if (t < 46) dir = sunDir(-0.85, 0.5, 13);
  else if (t < 72) {
    const k = smooth(46, 72, t);
    dir = sunDir(lerp(-0.6, 0.15, k), 1, lerp(-3, 9, smooth(46, 51, t)) + 22 * Math.sin(Math.PI * smooth(50, 72, t)));
  } else dir = sunDir(0.25, 1, lerp(9, -4, smooth(72, 89, t)));
  g.sun = dir;
  const night = smooth(88.5, 92, t);
  if (night > 0) { g.sun = dir.clone().lerp(MOON, night).normalize(); }
  g.moon = MOON;
  g.stars = smooth(86, 92, t);
  g.void = 1 - smooth(46, 50.5, t);
  g.earth = smooth(45, 50, t);
  g.uplift = Math.pow(smooth(T.rise, T.world + 2, t), 1.3);
  g.rdAmp = 1;
  g.water = t > T.rise + 0.5 ? lerp(-8, 0, smooth(T.rise + 0.5, T.rise + 4, t)) : -1000;
  g.fog = t < 46 ? 0.0028 : lerp(0.0028, 0.0002, smooth(46, 51, t)) + 0.00015 * smooth(70, 80, t) + 0.0002 * smooth(88, 92, t);
  g.cloud = 0.55 * smooth(49, 54, t) * (1 - 0.3 * smooth(88, 92, t));
  g.bio = 1 - smooth(44, 48, t);
  g.worldVis = smooth(30.4, 31.6, t);
  g.exposure = t < 46 ? 1.25 : t < 88 ? lerp(1.25, 0.82, smooth(46, 50, t)) + 0.12 * smooth(72, 80, t) : lerp(0.94, 1.05, smooth(88, 92, t));
  return g;
}
