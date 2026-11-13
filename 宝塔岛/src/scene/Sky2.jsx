// Clouds drifting around the island, and small islands far away in the haze.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { PAL } from '../world/index.js';
import { cloudGeoms, islet } from '../world/extras.js';
import { VoxelMesh } from './VoxelMesh.jsx';
import { U } from './materials.js';

const FAR = [
  [-185, 8, -120, 9, 'shrine', 41], [205, -16, -85, 8, 'sakura', 42], [150, 32, 175, 7, 'pine', 43], [-165, -28, 160, 6, 'lantern', 44], [35, 46, -235, 7, 'bush', 45],
];

function Cloud({ seed, r, y, a0, sc, speed }) {
  const geoms = useMemo(() => cloudGeoms(PAL, seed), [seed]);
  const ref = useRef();
  useFrame(() => {
    const t = U.uTime.value, a = a0 + t * speed;
    ref.current.position.set(Math.cos(a) * r, y + Math.sin(t * 0.3 + seed) * 2, Math.sin(a) * r);
    ref.current.rotation.y = -a;
  });
  return <group ref={ref} scale={sc}><VoxelMesh geoms={geoms} cast={false} /></group>;
}

function FarIsland({ data }) {
  const [x, y, z, R, decor, seed] = data;
  const geoms = useMemo(() => islet(PAL, seed, R, decor), [seed, R, decor]);
  const ref = useRef();
  useFrame(() => { const t = U.uTime.value; ref.current.position.y = y + Math.sin(t * 0.35 + seed) * 2.5; ref.current.rotation.y = t * 0.02 + seed; });
  return <group ref={ref} position={[x, y, z]}><VoxelMesh geoms={geoms} cast={false} /></group>;
}

export function Clouds() {
  const list = useMemo(() => Array.from({ length: 14 }, (_, i) => ({
    seed: 60 + i, r: 72 + (i * 37) % 95, y: -34 + ((i * 53) % 110), a0: i * 2.39, sc: 0.9 + ((i * 7) % 5) * 0.2, speed: (i % 2 ? 1 : -1) * (0.008 + (i % 3) * 0.004),
  })), []);
  return (
    <group>
      {list.map((c) => <Cloud key={c.seed} {...c} />)}
      {FAR.map((d) => <FarIsland key={d[5]} data={d} />)}
    </group>
  );
}
