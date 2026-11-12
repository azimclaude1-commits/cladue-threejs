// The camera, shot by shot, as functions of t.
import * as THREE from 'three';
import { T, smooth, lerp, bar } from './timeline.js';
import { flockCentre } from './flock.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const NET = new THREE.Vector3(560, 790, 1900);   // where the mind grows
const orbit = (r, yaw, pitch, c = V(0, 0, 0)) => V(c.x + Math.cos(yaw) * Math.cos(pitch) * r, c.y + Math.sin(pitch) * r, c.z + Math.sin(yaw) * Math.cos(pitch) * r);

export function shot(t) {
  let pos, tgt, fov = 45, focus = null;
  if (t < T.land) {
    // chaos: circle the cloud, closer on each new attractor
    const k = Math.max(0, t - T.bang);
    const r = t < T.bang ? 260 : lerp(230, 420, smooth(T.bang, T.bang + 3, t)) - 40 * smooth(12, 28, t) + 30 * Math.sin(t * 0.35);
    pos = orbit(r, 0.9 + k * 0.11, 0.18 + 0.22 * Math.sin(k * 0.13));
    tgt = V(0, 0, 0);
    focus = r;
  } else if (t < 33) {
    // landing: rise and look down as the cloud lies flat
    const k = smooth(T.land, 32.6, t);
    const k0 = Math.max(0, T.land - T.bang);
    const r0 = orbit(lerp(230, 420, 1) - 40 + 30 * Math.sin(T.land * 0.35), 0.9 + k0 * 0.11, 0.18 + 0.22 * Math.sin(k0 * 0.13));
    pos = r0.clone().lerp(V(-60, 250, 250), k);
    tgt = V(0, 0, 0);
  } else if (t < 72) {
    const s = path(t);
    pos = s.pos; tgt = s.tgt; fov = s.fov;
  } else if (t < T.flyThrough) {
    // the flock against the sunset, from the south shore
    const k = smooth(72, T.flyThrough, t);
    pos = V(lerp(320, -60, k), lerp(46, 36, k), lerp(300, 440, k));
    tgt = V(-60, 60, 760).lerp(flockCentre(t).add(V(0, 10, 0)), smooth(72, 75.5, t));
    fov = lerp(50, 46, k);
  } else if (t < 86) {
    // through the flock
    // a straight line through the middle of the flock, then a look back at it
    const dir = V(0.6, 0.06, 1).normalize(), mid = flockCentre(83);
    pos = mid.clone().addScaledVector(dir, (t - 83) * 85).add(V(0, -6, 0));
    tgt = pos.clone().addScaledVector(dir, 200).lerp(flockCentre(t), 0.5 * (1 - smooth(81.5, 83, t)) + 0.85 * smooth(83.6, 85.6, t));
    fov = 58;
  } else if (t < T.mind) {
    // look up as the light goes
    const k = smooth(86, T.mind, t);
    const dir = V(0.6, 0.06, 1).normalize(), p0 = flockCentre(83).addScaledVector(dir, 3 * 85).add(V(0, -6, 0));
    pos = p0.clone().lerp(V(410, 440, 1190), k);
    tgt = p0.clone().addScaledVector(dir, 200).lerp(flockCentre(86), 0.85).lerp(NET, smooth(87, T.mind, t));
    fov = lerp(58, 50, k);
  } else if (t < T.text) {
    // the mind: rise, then circle it
    const k = smooth(T.mind, 100, t);
    const a = lerp(-1.2, 0.35, smooth(99, T.text, t));
    const orb = V(NET.x + Math.sin(a) * 430, NET.y - 90 + 40 * Math.sin(t * 0.3), NET.z - Math.cos(a) * 430);
    pos = V(410, 440, 1190).lerp(V(440, 570, 1320), k).lerp(orb, smooth(98, 102, t));
    tgt = NET.clone();
    fov = 50;
  } else {
    // the word, and the end
    const a = 0.35;
    pos = V(NET.x + Math.sin(a) * 430, NET.y - 90 + 40 * Math.sin(T.text * 0.3), NET.z - Math.cos(a) * 430);
    pos.lerp(NET, 0.08 * smooth(T.text, 120, t));
    tgt = NET.clone();
    fov = 50;
  }
  return { pos, tgt, fov, focus: focus ?? pos.distanceTo(tgt) };
}

// keyframes after the landing: [t, pos, target, fov]
const KF = [
  [32.6, V(-60, 250, 250), V(0, 0, 0), 45],
  [36.0, V(70, 70, 150), V(0, 0, 30), 45],
  [40.0, V(130, 24, 30), V(30, 2, -40), 42],
  [44.4, V(40, 34, -120), V(-50, 4, -40), 44],
  [48.0, V(10, 150, -270), V(0, 40, 300), 48],
  [50.4, V(0, 200, -190), V(-40, 60, 600), 50],
  [54.0, V(-80, 120, 300), V(-220, 50, 900), 50],
  [58.0, V(-280, 140, 780), V(-600, 120, 1400), 52],
  [62.0, V(-500, 390, 1180), V(-760, 300, 1750), 52],
  [66.0, V(-220, 420, 1760), V(400, 200, 1450), 54],
  [70.0, V(560, 160, 1220), V(250, 40, 600), 52],
  [72.0, V(320, 46, 300), V(-60, 60, 760), 50],
];
function catmull(p0, p1, p2, p3, s) {
  const s2 = s * s, s3 = s2 * s;
  return p1.clone().multiplyScalar(2).add(p2.clone().sub(p0).multiplyScalar(s)).add(p0.clone().multiplyScalar(2).sub(p1.clone().multiplyScalar(5)).add(p2.clone().multiplyScalar(4)).sub(p3).multiplyScalar(s2)).add(p1.clone().multiplyScalar(3).sub(p0).sub(p2.clone().multiplyScalar(3)).add(p3).multiplyScalar(s3)).multiplyScalar(0.5);
}
export function path(t) {
  let i = 0;
  while (i < KF.length - 2 && KF[i + 1][0] < t) i++;
  const a = KF[Math.max(0, i - 1)], b = KF[i], c = KF[i + 1], d = KF[Math.min(KF.length - 1, i + 2)];
  const s = Math.min(1, Math.max(0, (t - b[0]) / (c[0] - b[0])));
  const e = s * s * (3 - 2 * s) * 0.35 + s * 0.65;
  return { pos: catmull(a[1], b[1], c[1], d[1], e), tgt: catmull(a[2], b[2], c[2], d[2], e), fov: lerp(b[3], c[3], s) };
}
export { KF };
