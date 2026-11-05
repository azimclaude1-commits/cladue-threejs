// Helpers to build chunky low-poly meshes with per-vertex colours and merge them.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
export const col = (h) => new THREE.Color(h);

export function paint(g, color) {
  g = g.index ? g.toNonIndexed() : g;
  const c = color instanceof THREE.Color ? color : new THREE.Color(color);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}
export function xform(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _s.set(sx, sy, sz); _p.set(x, y, z);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

export class Kit {
  constructor() { this.parts = []; }
  add(g, color, m) { g = paint(g, color); if (m) g.applyMatrix4(m); this.parts.push(g); return this; }
  box(w, h, d, color, x, y, z, ry = 0, rx = 0, rz = 0) { return this.add(new THREE.BoxGeometry(w, h, d), color, xform(x, y, z, ry, rx, rz)); }
  cyl(rt, rb, h, seg, color, x, y, z, ry = 0, rx = 0, rz = 0) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, xform(x, y, z, ry, rx, rz)); }
  rock(r, color, x, y, z, seed = 0, sy = 0.75) {
    const g = new THREE.DodecahedronGeometry(r, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const f = 1 + 0.18 * Math.sin(p.getX(i) * 3.1 + seed) * Math.cos(p.getZ(i) * 2.7 + seed * 1.3);
      p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * sy, p.getZ(i) * f);
    }
    return this.add(g, color, xform(x, y, z, seed));
  }
  /** Line of boxes from a to b (a beam, a rope, a pole). */
  beam(a, b, t, color) {
    const d = new THREE.Vector3().subVectors(b, a), L = d.length();
    const g = new THREE.BoxGeometry(t, L, t);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    return this.add(g, color, m);
  }
  mesh(mat, { cast = true, receive = true } = {}) {
    const g = mergeGeometries(this.parts, false);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = cast; m.receiveShadow = receive;
    return m;
  }
}

export const lambert = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
