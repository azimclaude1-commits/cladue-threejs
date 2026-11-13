import * as THREE from 'three';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, SoftShadows } from '@react-three/drei';
import { Sky, SUN, FOG } from './scene/Sky.jsx';
import { Island } from './scene/Island.jsx';
import { Dragon } from './scene/Dragon.jsx';
import { Petals } from './scene/Petals.jsx';
import { Clouds } from './scene/Sky2.jsx';
import { Effects } from './scene/Effects.jsx';
import { U } from './scene/materials.js';

const HOME = { pos: new THREE.Vector3(152, 90, 168), target: new THREE.Vector3(0, 17, 0) };
const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

function Clock() {
  useFrame((_, dt) => { U.uTime.value += Math.min(dt, 0.1); });
  return null;
}

function Sun({ high }) {
  const ref = useRef();
  const { scene } = useThree();
  useEffect(() => { if (ref.current) { ref.current.target.position.set(0, 4, 0); scene.add(ref.current.target); } }, [scene]);
  const p = SUN.clone().multiplyScalar(150);
  const S = 74;
  return (
    <directionalLight ref={ref} position={p} color="#ffbf86" intensity={3.8} castShadow
      shadow-mapSize={[high ? 4096 : 2048, high ? 4096 : 2048]} shadow-bias={-0.0003} shadow-normalBias={0.05}
      shadow-camera-left={-S} shadow-camera-right={S} shadow-camera-top={S} shadow-camera-bottom={-S} shadow-camera-near={20} shadow-camera-far={320} />
  );
}

function Rig({ controls, spin, target, resetKey }) {
  const { camera, size } = useThree();
  const idle = useRef(0);
  useEffect(() => {
    // narrow screens start a little further back so the whole island fits
    const k = Math.pow(Math.max(1, 1.5 / (size.width / size.height)), 0.55);
    camera.position.copy(HOME.target).addScaledVector(HOME.pos.clone().sub(HOME.target), k);
    if (controls.current) { controls.current.target.copy(HOME.target); controls.current.update(); }
    // for screenshots and tests: window.__view([x, y, z], [tx, ty, tz])
    window.__view = (p, t) => { camera.position.set(...p); if (controls.current) { controls.current.target.set(...t); controls.current.update(); } };
  }, [resetKey, camera, controls]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dt) => {
    if (controls.current) target.current.copy(controls.current.target);
    // resume turning a few seconds after the user lets go
    if (spin.wanted) { idle.current += dt; spin.current = !spin.holding && idle.current > 2.5; }
    else spin.current = false;
    if (spin.holding) idle.current = 0;
  });
  return null;
}

export default function App() {
  const [rotate, setRotate] = useState(true);
  const [petals, setPetals] = useState(true);
  const [dof, setDof] = useState(true);
  const [high, setHigh] = useState(!coarse);
  const [resetKey, setReset] = useState(0);
  const controls = useRef();
  const target = useRef(HOME.target.clone());
  const spin = useRef({ current: true, wanted: true, holding: false }).current;
  if (!spin.locked) spin.wanted = rotate;

  return (
    <>
      <Canvas shadows flat dpr={high ? [1, 2] : [1, 1.25]} gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{ fov: 30, near: 1, far: 4000, position: HOME.pos.toArray() }}>
        <color attach="background" args={['#e9a58f']} />
        <fog attach="fog" args={[FOG, 230, 760]} />
        <Clock />
        {high && <SoftShadows size={16} samples={20} focus={0.6} />}
        <Sky />
        <hemisphereLight args={['#ffd0dc', '#b07a55', 0.42]} />
        <ambientLight intensity={0.12} color="#ffe2d6" />
        <Sun high={high} />
        <Suspense fallback={null}>
          <Island spin={spin} />
          <Dragon />
          {petals && <Petals count={high ? 520 : 260} />}
          <Clouds />
        </Suspense>
        <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.06} rotateSpeed={0.55} zoomSpeed={0.8} panSpeed={0.6}
          minDistance={42} maxDistance={320} maxPolarAngle={Math.PI * 0.72} target={HOME.target.toArray()}
          onStart={() => { spin.holding = true; }} onEnd={() => { spin.holding = false; }} />
        <Rig controls={controls} spin={spin} target={target} resetKey={resetKey} />
        <Effects high={high} dof={dof} target={target} />
      </Canvas>
      <header className="title">
        <h1>宝塔浮岛</h1>
        <p>Voxel Pagoda Isle</p>
      </header>
      <nav className="panel" aria-label="场景设置">
        <button type="button" className={rotate ? 'on' : ''} onClick={() => setRotate((v) => !v)}>自转</button>
        <button type="button" className={petals ? 'on' : ''} onClick={() => setPetals((v) => !v)}>花瓣</button>
        <button type="button" className={dof && high ? 'on' : ''} disabled={!high} onClick={() => setDof((v) => !v)}>景深</button>
        <button type="button" className={high ? 'on' : ''} onClick={() => setHigh((v) => !v)}>{high ? '高画质' : '流畅'}</button>
        <button type="button" onClick={() => setReset((k) => k + 1)}>复位视角</button>
      </nav>
      <footer className="hint">拖动环绕 · 滚轮或双指缩放 · 右键平移</footer>
    </>
  );
}
