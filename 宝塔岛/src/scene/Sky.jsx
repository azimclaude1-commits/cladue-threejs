// A sunset sky, also used to light the scene (environment map for the gilding and the water).
import * as THREE from 'three';
import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';

export const SUN = new THREE.Vector3(0.78, 0.36, 0.52).normalize();
export const FOG = '#efb39e';

const skyMaterial = () => new THREE.ShaderMaterial({
  uniforms: { uSun: { value: SUN } },
  vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uSun; varying vec3 vDir;
    float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n2(p); p *= 2.07; a *= 0.5; } return s; }
    void main() {
      vec3 d = normalize(vDir);
      float y = d.y;
      vec3 top = vec3(0.10, 0.13, 0.32), mid = vec3(0.62, 0.30, 0.42), hor = vec3(1.0, 0.52, 0.30), low = vec3(0.72, 0.36, 0.34);
      vec3 c = mix(hor, mid, smoothstep(0.0, 0.28, y));
      c = mix(c, top, smoothstep(0.22, 0.85, y));
      if (y < 0.0) {
        // a sea of clouds far below, lit from the low sun
        vec2 uv = d.xz / (-y + 0.03) * 0.9;
        float cl = fbm(uv * 0.55 + vec2(3.1, 1.7));
        float cl2 = fbm(uv * 1.7 + 9.0);
        vec3 shade = vec3(0.42, 0.22, 0.34), lit = vec3(1.0, 0.62, 0.52);
        float sunSide = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0), 2.0);
        vec3 sea = mix(shade, lit, smoothstep(0.35, 0.75, cl + cl2 * 0.25) * (0.55 + 0.45 * sunSide));
        c = mix(hor, sea, smoothstep(0.0, -0.12, y));
        c = mix(c, low * 0.8, smoothstep(-0.4, -0.95, y) * 0.5);
      }
      float s = max(dot(d, uSun), 0.0);
      c += vec3(1.0, 0.55, 0.25) * pow(s, 6.0) * 0.55 + vec3(1.0, 0.75, 0.45) * pow(s, 60.0) * 0.9;
      c += vec3(1.0, 0.9, 0.7) * smoothstep(0.9993, 0.9997, s) * 12.0;
      // long sunset cloud streaks near the horizon
      vec2 q = d.xz / (abs(y) + 0.18);
      float k = fbm(q * vec2(0.8, 2.4) + 3.0);
      float band = smoothstep(0.55, 0.8, k) * smoothstep(-0.05, 0.08, y) * (1.0 - smoothstep(0.25, 0.5, y));
      vec3 cc = mix(vec3(0.85, 0.42, 0.5), vec3(1.0, 0.72, 0.4), pow(s, 3.0));
      c = mix(c, cc, band * 0.55);
      gl_FragColor = vec4(c, 1.0);
    }`,
  side: THREE.BackSide, depthWrite: false, fog: false,
});

export function Sky() {
  const mat = useMemo(skyMaterial, []);
  const { gl, scene } = useThree();
  useEffect(() => {
    // light the world from the same sky
    const pm = new THREE.PMREMGenerator(gl);
    const s = new THREE.Scene();
    s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), mat));
    const rt = pm.fromScene(s, 0.02);
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.42;
    return () => { scene.environment = null; rt.dispose(); pm.dispose(); };
  }, [gl, scene, mat]);
  return <mesh material={mat} scale={2400} frustumCulled={false} renderOrder={-10}><sphereGeometry args={[1, 48, 24]} /></mesh>;
}
