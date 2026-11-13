// The island, the rocks that float with it, the lantern lights and the spray of the waterfall.
import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { buildWorld, PAL } from '../world/index.js';
import { islet } from '../world/extras.js';
import { VoxelMesh } from './VoxelMesh.jsx';
import { U } from './materials.js';

const ROCKS = [
  [47, 9, -15, 3, 'bush', 31], [-45, 19, -21, 4, 'pine', 32], [-39, -7, 35, 3, 'rocks', 33], [37, 25, 31, 2, 'rocks', 34],
  [9, -13, 50, 3, 'lantern', 35], [-7, 31, -49, 4, 'sakura', 36], [53, -5, 19, 2, 'rocks', 37],
];

function FloatingRock({ data }) {
  const [x, y, z, R, decor, seed] = data;
  const geoms = useMemo(() => islet(PAL, seed, R, decor), [seed, R, decor]);
  const ref = useRef();
  useFrame(() => {
    const t = U.uTime.value;
    ref.current.position.y = y + Math.sin(t * 0.5 + seed) * 1.6;
    ref.current.rotation.y = Math.sin(t * 0.15 + seed) * 0.4;
  });
  return <group ref={ref} position={[x, y, z]}><VoxelMesh geoms={geoms} /></group>;
}

function Spray({ fall }) {
  const N = 260;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const s = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) s[i] = Math.random();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aS', new THREE.BufferAttribute(s, 4));
    return g;
  }, []);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uC: { value: new THREE.Vector3(fall.x + 0.5, 2, fall.z + 0.5) }, uPx: { value: 700 } },
    vertexShader: /* glsl */ `
      attribute vec4 aS; uniform float uTime, uPx; uniform vec3 uC; varying float vA;
      void main() {
        float L = 58.0, d = mod(uTime * (7.0 + aS.y * 5.0) + aS.x * L, L);
        float a = aS.z * 6.2832, r = 0.6 + d * (0.05 + aS.w * 0.07);
        vec3 p = uC + vec3(cos(a) * r - d * 0.05, -d, sin(a) * r + d * 0.03);
        vA = smoothstep(0.0, 3.0, d) * (1.0 - smoothstep(30.0, 56.0, d)) * 0.45;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp((1.2 + d * 0.06) * uPx / -mv.z, 1.0, 40.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `varying float vA; void main() { float r = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vec3(1.0, 0.96, 0.95) * 1.1, vA * (1.0 - smoothstep(0.3, 1.0, r))); }`,
    transparent: true, depthWrite: false,
  }), [fall]);
  useFrame(({ size, camera }) => { mat.uniforms.uPx.value = size.height / (2 * Math.tan((camera.fov * Math.PI) / 360)); });
  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={6} />;
}

export function Island({ spin }) {
  const W = useMemo(() => buildWorld(), []);
  const ref = useRef();
  useFrame((_, dt) => { if (spin.current) ref.current.rotation.y += Math.min(dt, 0.1) * 0.055; });
  // for screenshots: window.__hold(angle) stops the turning at a given angle
  window.__hold = (a) => { spin.wanted = false; spin.current = false; spin.locked = true; ref.current.rotation.y = a; };
  // a few warm lights: the stone lanterns and the lowest pagoda lanterns
  const lights = [...W.lanterns.slice(0, 4), W.paper[0], W.paper[3]];
  return (
    <group ref={ref}>
      <VoxelMesh geoms={W.geoms} />
      {lights.map((p, i) => <pointLight key={i} position={p} color={i < 4 ? '#ffb45a' : '#ff8448'} intensity={i < 4 ? 26 : 34} distance={22} decay={1.6} />)}
      {ROCKS.map((r) => <FloatingRock key={r[5]} data={r} />)}
      <Spray fall={W.fall} />
    </group>
  );
}
