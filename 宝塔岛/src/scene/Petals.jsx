// Cherry petals tumbling down past the island. Stateless: each petal's path is a function of time.
import * as THREE from 'three';
import { useMemo } from 'react';
import { U } from './materials.js';

export function Petals({ count = 900 }) {
  const geo = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    // a small rounded petal: a hexagon fan
    const pts = [0, 0, 0];
    for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI * 2; pts.push(Math.cos(a) * 0.5, Math.sin(a) * 0.32, 0); }
    const idx = []; for (let i = 1; i <= 6; i++) idx.push(0, i, i + 1);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setIndex(idx);
    const s = new Float32Array(count * 4);
    for (let i = 0; i < count * 4; i++) s[i] = Math.random();
    g.setAttribute('aS', new THREE.InstancedBufferAttribute(s, 4));
    g.instanceCount = count;
    return g;
  }, [count]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute vec4 aS; uniform float uTime; varying vec3 vCol; varying float vA;
      mat3 rot(vec3 a, float t) { float c = cos(t), s = sin(t), k = 1.0 - c; return mat3(c + a.x*a.x*k, a.y*a.x*k + a.z*s, a.z*a.x*k - a.y*s, a.x*a.y*k - a.z*s, c + a.y*a.y*k, a.z*a.y*k + a.x*s, a.x*a.z*k + a.y*s, a.y*a.z*k - a.x*s, c + a.z*a.z*k); }
      void main() {
        float H = 120.0, sp = 2.6 + aS.y * 2.6;
        float y = 72.0 - mod(uTime * sp + aS.x * H, H);
        float ang = aS.z * 6.2832 + uTime * 0.035, r = 3.0 + aS.w * 44.0;
        vec3 c = vec3(cos(ang) * r, y, sin(ang) * r);
        c.x += sin(uTime * 0.6 + aS.x * 40.0) * 3.5 + (72.0 - y) * 0.22;
        c.z += cos(uTime * 0.5 + aS.y * 30.0) * 2.5;
        mat3 R = rot(normalize(vec3(aS.y - 0.5, 0.7, aS.w - 0.5)), uTime * (1.2 + aS.z * 2.4) + aS.x * 20.0);
        vec3 p = R * (position * (0.55 + aS.w * 0.4)) + c;
        vec3 n = R * vec3(0.0, 0.0, 1.0);
        float l = 0.55 + 0.6 * abs(dot(n, normalize(vec3(0.78, 0.36, 0.52))));
        vCol = mix(vec3(0.95, 0.36, 0.55), vec3(1.0, 0.62, 0.74), aS.y) * l * 0.9;
        vA = smoothstep(72.0, 66.0, y) * smoothstep(-48.0, -30.0, y);
        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      varying vec3 vCol; varying float vA;
      void main() {
        gl_FragColor = vec4(vCol, vA);
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
  }), []);
  mat.uniforms.uTime = U.uTime;
  return <mesh geometry={geo} material={mat} frustumCulled={false} renderOrder={7} />;
}
