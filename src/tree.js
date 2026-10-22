import * as THREE from 'three';
import { ISLAND } from './layout.js';
import { taperedTube, makePuffGeometry, mulberry32 } from './utils.js';
import { PuffField } from './bank.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const LEAF_COLORS = ['#d42a1c', '#e8331f', '#c22218', '#f04128', '#b81d16', '#e83a26', '#d93520', '#f2552e'];

export function buildTree(rand = mulberry32(5)) {
  const group = new THREE.Group();
  const bx = ISLAND.x, bz = ISLAND.z;
  // build relative to the trunk base, then place at the island
  const o = (x, y, z) => V(x - bx, y, z - bz);

  const barkMat = new THREE.MeshStandardMaterial({ color: 0x6e4535, roughness: 0.88 });

  const branches = [
    { pts: [o(3.55, 0.5, -2.85), o(3.55, 1.3, -2.8), o(3.25, 2.2, -2.65), o(2.7, 2.95, -2.35), o(2.0, 3.5, -2.05), o(1.1, 3.9, -1.75)], r: [0.3, 0.08], flare: 0.7 },
    { pts: [o(3.15, 2.35, -2.68), o(3.55, 3.0, -2.8), o(3.95, 3.45, -2.55), o(4.2, 3.8, -2.25)], r: [0.12, 0.045] },
    { pts: [o(2.75, 2.9, -2.4), o(2.65, 3.45, -2.95), o(2.45, 3.85, -3.4)], r: [0.1, 0.04] },
    { pts: [o(3.42, 1.9, -2.76), o(3.85, 2.25, -2.45), o(4.3, 2.45, -1.95)], r: [0.1, 0.04] },
    { pts: [o(2.2, 3.4, -2.15), o(2.05, 3.65, -1.5), o(1.85, 3.8, -0.95)], r: [0.08, 0.035] },
    { pts: [o(1.5, 3.75, -1.9), o(0.75, 4.15, -2.2), o(0.15, 4.25, -1.95)], r: [0.075, 0.035] },
  ];
  branches.forEach((b, i) => {
    const { geometry } = taperedTube(b.pts, b.r[0], b.r[1], { flare: b.flare ?? 0.15, seed: i * 3 });
    const m = new THREE.Mesh(geometry, barkMat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  });

  // foliage: clusters of fluffy red pom-poms
  const clumps = [
    [1.1, 4.1, -1.75, 0.72], [0.15, 4.4, -1.95, 0.6], [0.6, 4.4, -2.65, 0.55], [1.85, 3.95, -0.95, 0.6],
    [2.0, 4.25, -2.25, 0.7], [2.45, 4.1, -3.4, 0.62], [3.05, 4.0, -2.95, 0.6], [4.2, 4.05, -2.25, 0.62],
    [3.7, 3.65, -1.95, 0.5], [4.3, 2.7, -1.95, 0.52], [3.95, 3.3, -3.15, 0.5], [1.35, 3.65, -1.15, 0.45],
    [2.8, 3.45, -1.8, 0.48], [1.5, 4.5, -2.4, 0.55], [3.3, 4.35, -2.4, 0.5],
  ];
  const puffGeo = makePuffGeometry(9, 2, 0.32, 4.0);
  const puffMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.75, sheen: 0.5, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xff6a50),
  });
  const foliage = new PuffField(puffGeo, puffMat, 3600);
  const v = new THREE.Vector3();
  const canopyPoints = [];
  for (const [cx, cy, cz, r] of clumps) {
    const n = Math.round(r * r * 420);
    const c = o(cx, cy, cz);
    for (let i = 0; i < n; i++) {
      // points on a squashed sphere shell, biased upward
      const u = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const rr = r * (0.55 + 0.45 * Math.cbrt(rand()));
      v.set(Math.cos(a) * s * rr, (u * 0.72 + 0.08) * rr, Math.sin(a) * s * rr).add(c);
      const sz = 0.075 + rand() * 0.07;
      foliage.add(v, sz, LEAF_COLORS[Math.floor(rand() * LEAF_COLORS.length)], rand);
      if (u < -0.2 && rand() < 0.4) canopyPoints.push(v.clone());
    }
  }
  foliage.finish();
  const canopy = new THREE.Group();
  canopy.add(foliage.mesh);
  group.add(canopy);

  group.position.set(bx, 0, bz);

  return {
    group,
    /** World-space point on the underside of the canopy, for falling leaves. */
    randomCanopyPoint(out = new THREE.Vector3()) {
      const p = canopyPoints[Math.floor(Math.random() * canopyPoints.length)];
      out.copy(p).applyQuaternion(canopy.quaternion).add(group.position);
      return out;
    },
    update(t) {
      canopy.rotation.z = Math.sin(t * 0.7) * 0.006 + Math.sin(t * 1.9) * 0.002;
      canopy.rotation.x = Math.sin(t * 0.55 + 1) * 0.005;
    },
  };
}
