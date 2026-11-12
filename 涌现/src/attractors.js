// Four strange attractors, normalised on the CPU so they share one world frame.
import * as THREE from 'three';

export const ATTRACTORS = [
  { name: 'Lorenz', dt: 0.004, speed: 1.4, f: ([x, y, z]) => [10 * (y - x), x * (28 - z) - y, x * y - (8 / 3) * z],
    glsl: 'vec3(10.0 * (q.y - q.x), q.x * (28.0 - q.z) - q.y, q.x * q.y - 2.6666667 * q.z)', axis: [0, 0, 1], yaw: -Math.PI / 4 },
  { name: 'Aizawa', dt: 0.01, speed: 1.0, f: ([x, y, z]) => [(z - 0.7) * x - 3.5 * y, 3.5 * x + (z - 0.7) * y, 0.6 + 0.95 * z - (z * z * z) / 3 - (x * x + y * y) * (1 + 0.25 * z) + 0.1 * z * x * x * x],
    glsl: 'vec3((q.z - 0.7) * q.x - 3.5 * q.y, 3.5 * q.x + (q.z - 0.7) * q.y, 0.6 + 0.95 * q.z - q.z * q.z * q.z / 3.0 - (q.x * q.x + q.y * q.y) * (1.0 + 0.25 * q.z) + 0.1 * q.z * q.x * q.x * q.x)', axis: [0, 0, 1], yaw: 0.0 },
  { name: 'Halvorsen', dt: 0.004, speed: 0.9, f: ([x, y, z]) => [-1.89 * x - 4 * y - 4 * z - y * y, -1.89 * y - 4 * z - 4 * x - z * z, -1.89 * z - 4 * x - 4 * y - x * x],
    glsl: 'vec3(-1.89 * q.x - 4.0 * q.y - 4.0 * q.z - q.y * q.y, -1.89 * q.y - 4.0 * q.z - 4.0 * q.x - q.z * q.z, -1.89 * q.z - 4.0 * q.x - 4.0 * q.y - q.x * q.x)', axis: [-1, -1, -1], yaw: 0.3 },
  { name: 'Thomas', dt: 0.04, speed: 1.25, f: ([x, y, z]) => [Math.sin(y) - 0.19 * x, Math.sin(z) - 0.19 * y, Math.sin(x) - 0.19 * z],
    glsl: 'vec3(sin(q.y) - 0.19 * q.x, sin(q.z) - 0.19 * q.y, sin(q.x) - 0.19 * q.z)', axis: [1, 1, 1], yaw: 0.0 },
];

const RMS = 100;        // every attractor is scaled to this rms radius (world units)
const WSPEED = 70;      // and to this mean speed (world units per second)

function rk4(f, p, h) {
  const k1 = f(p), a = p.map((v, i) => v + k1[i] * h / 2);
  const k2 = f(a), b = p.map((v, i) => v + k2[i] * h / 2);
  const k3 = f(b), c = p.map((v, i) => v + k3[i] * h);
  const k4 = f(c);
  return p.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

/** Integrate each attractor once: centre, scale, speed and an orientation that stands its axis up. */
export function normalise() {
  for (const A of ATTRACTORS) {
    let p = [0.1, 0.05, 0.02];
    if (A.name === 'Thomas') p = [1.1, 0.3, -0.4];
    if (A.name === 'Halvorsen') p = [-5, 0, 0];
    for (let i = 0; i < 3000; i++) p = rk4(A.f, p, A.dt);
    const pts = [];
    let sx = 0, sy = 0, sz = 0, sp = 0;
    for (let i = 0; i < 60000; i++) {
      p = rk4(A.f, p, A.dt);
      if (i % 4 === 0) { pts.push(p); sx += p[0]; sy += p[1]; sz += p[2]; const v = A.f(p); sp += Math.hypot(...v); }
    }
    const n = pts.length, c = [sx / n, sy / n, sz / n];
    let r2 = 0; for (const q of pts) r2 += (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2;
    const k = RMS / Math.sqrt(r2 / n);
    A.center = new THREE.Vector3(...c);
    A.k = k;
    A.vel = (WSPEED / ((sp / n) * k)) * A.speed;   // time multiplier
    // rotation: attractor axis -> world up, then a yaw
    const q1 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...A.axis).normalize(), new THREE.Vector3(0, 1, 0));
    const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), A.yaw);
    A.rot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q2.multiply(q1)));
    A.samples = pts;
  }
  return ATTRACTORS;
}

/** World-space positions of attractor i's samples. */
export function worldSamples(i) {
  const A = ATTRACTORS[i], v = new THREE.Vector3();
  return A.samples.map((q) => v.set(q[0], q[1], q[2]).sub(A.center).multiplyScalar(A.k).applyMatrix3(A.rot).toArray());
}
