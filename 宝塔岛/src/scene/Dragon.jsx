// The dragon: a voxel head, forty-six body segments and four legs, riding a looping path around the island
// with a travelling wave down its body.
import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { PAL } from '../world/index.js';
import { headGeoms, segmentGeoms, legGeoms, tailGeoms } from '../world/dragon.js';
import { VoxelMesh } from './VoxelMesh.jsx';
import { U } from './materials.js';

const N = 46, DS = 0.029, SPEED = 0.09;
const radius = (i) => 1.0 + 2.25 * Math.pow(1 - i / (N - 1), 0.72);
function path(s, out) {
  const R = 74 + 8 * Math.sin(2 * s + 0.5);
  return out.set(Math.cos(s) * R, 40 + 13 * Math.sin(3 * s) + 4 * Math.sin(5 * s + 1), Math.sin(s) * R);
}
const LEGS = { 7: 1, 25: 1 };

export function Dragon() {
  const parts = useMemo(() => {
    const segs = {};
    for (const r of [1, 2, 3]) for (const sp of [0, 1]) for (const par of [0, 1]) segs[`${r}${sp}${par}`] = segmentGeoms(PAL, r, sp, par);
    return { segs, head: headGeoms(PAL), leg: legGeoms(PAL), tail: tailGeoms(PAL) };
  }, []);
  const segRefs = useRef([]), head = useRef(), tmp = useMemo(() => Array.from({ length: N + 2 }, () => new THREE.Vector3()), []);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const X = useMemo(() => new THREE.Vector3(), []), Y = useMemo(() => new THREE.Vector3(), []), Z = useMemo(() => new THREE.Vector3(), []), UP = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const legRefs = useRef([]);

  useFrame(() => {
    const t = U.uTime.value, s0 = t * SPEED;
    // spine positions, head first, with a wave travelling toward the tail
    for (let i = -1; i <= N; i++) {
      const p = tmp[i + 1];
      path(s0 - i * DS, p);
      const s = s0 - i * DS;
      const radial = X.set(Math.cos(s), 0, Math.sin(s));
      p.y += Math.sin(i * 0.42 - t * 2.4) * 1.9 * Math.min(1, i / 4 + 0.2);
      p.addScaledVector(radial, Math.cos(i * 0.31 - t * 1.8) * 1.4);
    }
    const orient = (obj, i, scl) => {
      const p = tmp[i + 1], q = tmp[i];
      X.subVectors(q, p).normalize();
      Y.copy(UP).addScaledVector(X, -UP.dot(X)).normalize();
      Z.crossVectors(X, Y);
      m.makeBasis(X, Y, Z);
      obj.quaternion.setFromRotationMatrix(m);
      obj.position.copy(p);
      if (scl) obj.scale.set(1, scl, scl);
    };
    for (let i = 0; i < N; i++) {
      const g = segRefs.current[i]; if (!g) continue;
      const r = radius(i), ri = Math.max(1, Math.min(3, Math.round(r)));
      orient(g, i, r / ri);
    }
    if (head.current) { orient(head.current, 0, 0); head.current.position.addScaledVector(X, 1.2); }
    legRefs.current.forEach((l, k) => { if (l) l.rotation.z = Math.sin(t * 2.2 + k * 1.7) * 0.45; });
  });

  return (
    <group>
      <group ref={head}><VoxelMesh geoms={parts.head} /></group>
      {Array.from({ length: N }, (_, i) => {
        const r = radius(i), ri = Math.max(1, Math.min(3, Math.round(r)));
        const g = parts.segs[`${ri}${i % 2 === 0 ? 1 : 0}${i % 2}`];
        return (
          <group key={i} ref={(el) => { segRefs.current[i] = el; }}>
            <VoxelMesh geoms={g} />
            {LEGS[i] && [1, -1].map((side, k) => (
              <group key={k} position={[0, -ri * 0.55, side * ri * 0.75]} scale={[1, 1, side]} ref={(el) => { legRefs.current[(i > 10 ? 2 : 0) + k] = el; }}>
                <VoxelMesh geoms={parts.leg} />
              </group>
            ))}
            {i === N - 1 && <VoxelMesh geoms={parts.tail} />}
          </group>
        );
      })}
    </group>
  );
}
