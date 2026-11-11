// Light and colour of the world over time.
import * as THREE from 'three';
import { T, smooth, lerp } from './timeline.js';

const C = (r, g, b) => new THREE.Color(r, g, b);
const mixC = (a, b, k) => a.clone().lerp(b, k);
const mixV = (a, b, k) => a.clone().lerp(b, k).normalize();

const DEEP = { fog: C(0.006, 0.02, 0.027), far: C(0.045, 0.13, 0.14) };
const STORM = {
  fog: C(0.4, 0.41, 0.41), far: C(0.78, 0.72, 0.6), top: C(0.14, 0.15, 0.17), hor: C(0.45, 0.45, 0.44),
  sun: C(1.0, 0.88, 0.72).multiplyScalar(0.7), dir: new THREE.Vector3(0.25, 0.32, -1).normalize(),
};
const GOLD = {
  fog: C(0.8, 0.63, 0.44), far: C(1.0, 0.66, 0.32), top: C(0.09, 0.13, 0.22), hor: C(0.88, 0.7, 0.48),
  sun: C(1.0, 0.76, 0.44).multiplyScalar(1.35), dir: new THREE.Vector3(-0.12, 0.13, 1).normalize(),
};

export function grade(t, camY) {
  const g = {};
  if (camY < 0) {
    g.fogColor = DEEP.fog.clone(); g.fogFar = DEEP.far.clone();
    // deeper and darker at the start, lighter as we rise
    const lift = smooth(28, 36.5, t);
    g.fogColor.lerp(C(0.02, 0.06, 0.07), lift); g.fogFar.lerp(C(0.12, 0.28, 0.28), lift);
    g.fogDensity = t < 23.5 ? 0.0062 : t < 30 ? 0.0046 : 0.0052;
    g.sunDir = new THREE.Vector3(0.2, 1, 0.1).normalize();
    g.sunColor = C(0.6, 0.85, 0.85); g.skyTop = STORM.top.clone(); g.skyHor = STORM.hor.clone();
    g.light = 1; g.under = 1; g.sea = 1; g.disc = C(1, 1, 1);
  } else {
    const k = smooth(55, 61, t), kEnd = smooth(72, 80, t);
    g.fogColor = mixC(STORM.fog, GOLD.fog, k); g.fogFar = mixC(STORM.far, GOLD.far, k);
    g.fogDensity = lerp(lerp(t < 50 ? 0.0011 : 0.0008, 0.00032, k), 0.00011, smooth(66, 74, t));
    g.skyTop = mixC(STORM.top, GOLD.top, k); g.skyHor = mixC(STORM.hor, GOLD.hor, k);
    g.sunColor = mixC(STORM.sun, GOLD.sun, k).multiplyScalar(1 + kEnd * 0.3);
    g.sunDir = mixV(STORM.dir, GOLD.dir, k);
    g.light = lerp(0.95, 1.15, k); g.under = 0;
    // a pale sun in the storm, a cinnabar one over the Lake of Heaven
    g.disc = mixC(C(1.6, 1.55, 1.45), C(1.25, 0.36, 0.14), smooth(60, 68, t));
    g.sea = 1 + 0.6 * smooth(48, 53, t) * (1 - smooth(60, 64, t));
  }
  return g;
}
