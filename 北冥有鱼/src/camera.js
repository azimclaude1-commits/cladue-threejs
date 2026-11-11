// The shot list: camera position, target and lens as pure functions of t.
import * as THREE from 'three';
import { T, smooth, lerp } from './timeline.js';
import { kunHead } from './kun.js';
import { pengPos, helixAngle, AXIS } from './peng.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const mix = (a, b, k) => a.clone().lerp(b, k);

export const CUTS = [16, 23.5, 30, 40, 50, 64, 72];

export function shot(t) {
  let pos, tgt, fov;
  if (t < 16) {
    // 北冥: the dark, and something vast coming out of it
    const h = kunHead(t);
    pos = V(-8 - t * 2.1, -42 - t * 0.5, 120 - t * 2.1);
    tgt = V(h.x * 0.6 - 92, -60 - Math.sin(t * 0.2) * 3, 0);
    fov = 50;
  } else if (t < 23.5) {
    // 其名为鲲: the eye goes by like a moon
    const h = kunHead(t), e = V(h.x - 12, h.y + 2, 9);
    pos = V(-24 + (t - 16) * 5, -52 + Math.sin(t * 0.5) * 0.8, 66);
    tgt = V(pos.x + (e.x - pos.x) * 0.6, e.y - 2, e.z);
    fov = 40;
  } else if (t < 30) {
    // 鲲之大: from far below, against the light
    const h = kunHead(t), k = t - 23.5;
    pos = V(18 + k * 5, -168 + k * 2, 96 - k * 1.5);
    tgt = V(h.x - 62, -52, 0);
    fov = 56;
  } else if (t < 40) {
    // 海运: rise with it, and break the surface just ahead of it
    const h = kunHead(t), k = t - 30;
    const y = -32 + 22 * smooth(30, 36.2, t) + 44 * smooth(36.2, 37.4, t);
    pos = V(168 + k * 3.6, y, 116 + k * 1.0);
    tgt = mix(V(h.x - 10, h.y + 6, h.z), V(258, Math.max(h.y * 0.55, 0) + 14, -18), smooth(35, 37.2, t));
    if (t > T.breach && t < T.breach + 1.5) { const s = (1 - (t - T.breach) / 1.5) * 0.9; pos.x += Math.sin(t * 41) * s; pos.y += Math.sin(t * 37 + 1) * s; }
    fov = 50;
  } else if (t < 50) {
    // 化而为鸟
    const k = smooth(40, 49, t);
    pos = V(lerp(150, 205, k), lerp(70, 196, k), lerp(290, 300, k));
    tgt = mix(V(268, 105, -20), V(300, 214, -18), smooth(40, 48, t));
    fov = lerp(48, 44, k);
  } else if (t < 64) {
    // 扶摇: circle the climb, a little behind and below, out through the clouds
    const b = pengPos(t), phi = helixAngle(t) - 1.25, rc = 300 + 140 * smooth(56, 64, t);
    pos = V(AXIS.x + Math.cos(phi) * rc, b.y - 70 + 150 * smooth(58.5, 64, t), AXIS.y + Math.sin(phi) * rc);
    tgt = b.clone().add(V(0, 20, 0));
    fov = 52;
  } else if (t < 72) {
    // 南冥: fly alongside
    const b = pengPos(t), k = smooth(64, 72, t);
    pos = b.clone().add(V(lerp(-170, -260, k), lerp(-10, 50, k), lerp(-230, 60, k)));
    tgt = b.clone().add(V(0, 10, 90));
    fov = 50;
  } else {
    // 天池: let her go on toward the sun
    const c0 = pengPos(72).add(V(-150, 46, -250));
    pos = c0.add(V(0, (t - 72) * 2, (t - 72) * 9));
    const sun = V(-0.12, 0.13, 1).normalize();
    tgt = mix(pengPos(t), pos.clone().addScaledVector(sun, 1500), 0.35 + 0.4 * smooth(75, 82, t));
    fov = lerp(50, 44, smooth(72, 86, t));
  }
  return { pos, tgt, fov };
}

/** Brief dip at each cut, 0..1 */
export function dipAt(t) {
  let d = 0;
  for (const c of CUTS) d = Math.max(d, 1 - smooth(0, 0.24, Math.abs(t - c)));
  return d;
}
